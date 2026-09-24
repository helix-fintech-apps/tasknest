# Backend notes

How the TaskNest backend is built and run: the decisions behind it, how money is recorded, how the payments provider behaves, the environment, and what is left to do. The API contract is in [`API.md`](API.md).

## Shape of a request

```
HTTP -> api/index.ts: route, auth (JWT -> profile role), test clock, Idempotency-Key
     -> handler: take leases (op_locks) -> load fresh rows -> plan with _shared/domain
     -> payment provider (fake or Stripe test mode)
     -> UnitOfWork.commit(): ONE Postgres transaction via the tn_apply RPC
        (booking/tender/points/refund rows + every ledger txn + audit rows)
```

- **One money rulebook.** Every amount comes from `supabase/functions/_shared/domain` (quote, tender allocation, cancellation curve, refund plan, tips, points, disputes, payouts). The UI previews with the same functions. The API adds bookkeeping only.
- **Atomic writes.** Handlers never write tables directly. They collect whitelisted row operations (insert / guarded update / increment / delete / ledger txn / slot check) and send them to `tn_apply(ops jsonb)` (migration `…05_api_backend`), which runs them in a single transaction. Any error rolls everything back. PL/pgSQL helpers do only generic, validated bookkeeping, so the money logic is not duplicated in SQL.
  - Status changes are guarded (`update … where id = $1 and status = <expected>`, exactly one row), so a stale read cannot move a booking twice.
  - `refund_le_paid`, `points_remaining >= 0` (except debt lots) and `bookings_no_double_slot` are database CHECKs/indexes, so even a logic slip cannot over-refund, overspend points or double-book.
  - Ledger txns are checked twice: in TypeScript (`txn()` asserts balance per unit) and by the deferred `ledger_balanced` constraint trigger at commit.
- **Validation before money moves.** Each handler plans every row and validates every rule before it calls the provider, then commits. The provider call happens before the commit (Stripe needs it first), so a failure after it can only be an infrastructure error. Those return 5xx, the Idempotency-Key is released, and a retry with the same key replays the provider call with the same provider idempotency key (Stripe returns the same object) before committing.
- **Leases (`op_locks`, migration `…223437`).** `withLocks()` takes short database leases (TTL 60 s, waits up to 5 s, then `409 busy`) that cover the provider call and the transaction. Keys: `booking:<id>` (every booking operation and dispute event), `points:<client>` (point spending, refunds and clawbacks, grants), `tasker:<id>` (strike counting), `payout:<tasker>` (payout runs). Two concurrent refunds, tips or payouts therefore cannot both pass their checks. The tests fire them in parallel to prove it.
- **Idempotency** (`idempotency_keys`): the key is scoped to the user, and the stored request hash covers method, path, body and test clock. Final 2xx/4xx responses are stored and replayed; 5xx and `busy` are not.

## Ledger model

Double entry, per unit (`USD` cents, `POINTS`). The chart of accounts is in `domain/ledger.ts` and the postings are in `_shared/postings.ts`.

| Event (`ledger_txns.kind`)                                    | Lines                                                                                                                                                                                                                |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `booking_hold` (booking created with points / wallet / promo) | Dr `points_liability`, `wallet_liability`, `promo_expense` / Cr `client_funds_held`[client]; POINTS Dr `points_outstanding`[client] / Cr `points_issued`                                                             |
| card authorization                                            | **no ledger entry**: an authorization moves no money. It is recorded on the booking (`stripe_payment_intent_id`, `auth_expires_at`) and never reaches `card_clearing`, which reconciles to captures                  |
| `booking_completed`                                           | Dr `card_clearing` / Cr `client_funds_held` (captured card), then Dr `client_funds_held` (total) / Cr `tasker_payable`[tasker] (subtotal − commission), `platform_revenue` (service fee + commission), `tax_payable` |
| `extras_charged`                                              | Dr `card_clearing` / Cr `tasker_payable` (extra labor − commission + expenses), `platform_revenue`, `tax_payable`                                                                                                    |
| `cancellation_fee`, `no_show_fee`                             | like `booking_completed` for the kept amount only                                                                                                                                                                    |
| `booking_release` (decline, cancellation, tasker fault)       | reverse of `booking_hold` for the released tenders                                                                                                                                                                   |
| `points_earned`, `points_review_bonus`, `points_grant`        | POINTS Dr `points_issued` / Cr `points_outstanding`; USD Dr `promo_expense` / Cr `points_liability`                                                                                                                  |
| `tip`                                                         | Dr `card_clearing` / Cr `tasker_payable` (100%)                                                                                                                                                                      |
| `tasker_penalty`                                              | Dr `tasker_payable` / Cr `platform_revenue`                                                                                                                                                                          |
| `refund_{full,partial,goodwill}`                              | Dr `tasker_payable` (tasker share) + `refund_expense` / Cr each tender (`card_clearing`, `points_liability`, …); points returned and clawed back on POINTS                                                           |
| `dispute_lost`                                                | Dr `tasker_payable` (recovered share) + `dispute_loss` / Cr `card_clearing` (reversal + fee); earned points clawed back                                                                                              |
| `payout`                                                      | Dr `tasker_payable` / Cr `payouts_clearing`                                                                                                                                                                          |

Invariants, all checked by `select * from integrity_violations` (migrations `…225645` and `…230530`), which must return no rows:

1. Every txn balances per unit.
2. No tender is refunded more than it paid.
3. Points lots are explained by points movements, per user.
4. POINTS ledger `points_outstanding` per user equals the user's lots. Reserved points leave both at booking time.
5. A finished booking holds nothing in `client_funds_held`.
6. An open booking holds exactly its non-card tenders.

`ledger_trial_balance` and `ledger_unbalanced_txns` remain for dashboards. `tasker_balances` is each tasker's `tasker_payable` (it can be negative after a dispute or clawback).

## Points

Lots (`earn`, `bonus`, `reissue`, `debt`) and signed movements (`reserve`, `release`, `redeem`, `return`, `reissue`, `expire`, `clawback`, `earn`, `bonus`); `points-store.ts` keeps movements summing to lots.

- **Reserve** at booking (oldest-expiring available lots first). **Redeem** at capture. **Release** on decline or cancellation: if the lot expired while the points were on hold, the points expire and are reissued with `reissueDaysOnExpiredRefund` (the same domain rule as refunds, `pointsToReturn`).
- **Earn** on card cash excluding tax and tips, pending `pendingDays`. **Return** refunded points to their lot, or reissue if it expired.
- **Clawback** of points earned on reversed card cash, rounded up and cumulative per booking. It is taken from the booking's earn lot first; the rest becomes a negative `debt` lot. The net balance (`points_balances.available`, `/quote` `points.available`) then goes negative and redemptions are refused until the debt is covered.

## Refunds, disputes, payouts

- The tasker's refund share follows `planRefund`: `floor(amount × (subtotal − commission) / total)`. The figures include extras charged at completion (`figures.ts`: extra labor and expenses in the subtotal, the commission on each part, extras in the total), so a full refund recovers exactly what the tasker earned. Goodwill is paid by the platform. `POST /bookings/:id/refund-preview` returns the server's plan.
- Disputes arrive as `charge.dispute.*` webhooks (or `POST /admin/disputes/simulate` with the fake provider). A lost dispute reverses the card (counted as refunded on the card tender so it cannot be refunded again), books the $15 fee, recovers the tasker's proportional share (which can make their balance negative) and claws back points. A won dispute restores `completed`. Refunds are blocked while a dispute is open and after it is lost.
- Payouts (`planPayout`): only bookings past the hold whose card money is settled (not `disputed`), plus all balance adjustments, so a negative balance blocks the payout. Payout ids and transfer idempotency keys are derived from the ledger state, and the per-tasker lease makes concurrent runs pay once.

## Payments providers

`_shared/provider/index.ts` `selectProvider()`:

| `PAYMENTS_PROVIDER` | `STRIPE_SECRET_KEY`       | Provider                                                                          |
| ------------------- | ------------------------- | --------------------------------------------------------------------------------- |
| unset / `auto`      | unset                     | **fake** (the default for the hosted demo, CI and local dev)                      |
| unset / `auto`      | `sk_test_…`               | stripe (test mode)                                                                |
| `fake`              | anything but live         | fake                                                                              |
| `stripe`            | `sk_test_…` / `rk_test_…` | stripe; errors without a key                                                      |
| any                 | `sk_live_…` / `rk_live_…` | **refused**: every request fails with `503 payments_misconfigured`; nothing moves |

- **fake** never moves money. Ids are derived from the idempotency key (`pi_fake_…`, `re_fake_…`, `tr_fake_…`), so retries return the same id. `paymentMethod: "pm_card_chargeDeclined"` simulates a decline (`402 card_declined`). It enables the test hooks: the test clock (with an admin-minted token), dispute simulation and points grants.
- **stripe** (test mode) uses the REST API with `Idempotency-Key` on every call:
  - Booking: `PaymentIntent` with `capture_method=manual` and `confirm=true` (default `pm_card_visa`).
  - Completion: capture with `amount_to_capture`. An authorization past `auth_expires_at` is charged again (`kind: reauth`).
  - Extras and tips: separate automatic-capture `PaymentIntent`s.
  - Refunds and payouts: `/refunds` against the main payment first, then the extras payment; payouts are `/transfers` to the tasker's `stripe_account_id` (Connect).
  - The test hooks are disabled.

### Switching the hosted project to Stripe test mode

1. In the Stripe dashboard (test mode), copy the secret key `sk_test_…`. For payouts, give each tasker a Connect test account and set `taskers.stripe_account_id` (the seed uses placeholder `acct_fake_*` ids that only work with the fake provider).
2. `supabase secrets set --project-ref pfqvqencsbxauafahezw STRIPE_SECRET_KEY=sk_test_... PAYMENTS_PROVIDER=stripe`
3. Add a webhook endpoint `https://pfqvqencsbxauafahezw.supabase.co/functions/v1/stripe-webhook` for `charge.dispute.created`, `charge.dispute.updated` and `charge.dispute.closed`, then `supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...`.
4. `GET /health` now reports `"provider": "stripe"`. To go back: `supabase secrets unset STRIPE_SECRET_KEY PAYMENTS_PROVIDER` (the fake provider is the default).

Never set a live key: the function refuses to run with one, and `scripts/ci/check-live-keys.sh` blocks deploys.

## Environment

| Variable                    | Where                                | Notes                                                                                                                                                       |
| --------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`              | functions (injected), tests          | Project URL                                                                                                                                                 |
| `SUPABASE_ANON_KEY`         | functions (injected), tests          | Publishable / anon key (public)                                                                                                                             |
| `SUPABASE_SERVICE_ROLE_KEY` | functions (injected); tests optional | **Never commit.** The functions use it for all writes and as the test-clock HMAC key. In tests it only enables the "service key may only run payouts" check |
| `API_BASE_URL`              | tests                                | Default `${SUPABASE_URL}/functions/v1/api`                                                                                                                  |
| `PAYMENTS_PROVIDER`         | functions                            | `fake` / `stripe` / unset (auto: fake without a test key)                                                                                                   |
| `STRIPE_SECRET_KEY`         | functions secret                     | `sk_test_…` only                                                                                                                                            |
| `STRIPE_WEBHOOK_SECRET`     | functions secret                     | `whsec_…` for `stripe-webhook`                                                                                                                              |
| `TEST_CLOCK_SECRET`         | functions secret, optional           | HMAC key for test-clock tokens (defaults to the service-role key)                                                                                           |

## Security

- **RLS** (migration `…223409`): every policy names its roles and wraps `auth.uid()` / `private.is_staff()` in `(select …)`. anon has its own narrow policy on `taskers`. A real bug fixed there: anonymous reads of `taskers` failed with `permission denied for function is_staff`, because `…04` revoked anon's execute on it but the policy still called it.
- **Names** (migration `…223422`, closes the UI's RLS gap): `taskers.display_name` (the tasker's public name) and `display_names`, kept in sync from `profiles` by triggers. A tasker's full name is public while they are active. A client's **first name** is visible only to the taskers they have a booking with. Staff see everyone. Emails live only in `auth.users`.
- **Test clock**: `x-test-now` only works with the fake provider AND an admin-minted, user-bound, expiring HMAC token, so clients cannot time-travel past cancellation tiers.
- **Service key** callers are accepted only on `/payouts/run` (for cron).
- **Money functions** (`tn_apply`, `post_ledger_txn`, `acquire_op_lock`, `release_op_lock`, `publish_money_policy`) are executable by `service_role` only.
- **Advisors** (after these migrations): no security or performance warnings except
  - "Leaked Password Protection Disabled": an Auth dashboard setting (Authentication → Policies), not SQL.
  - INFO "unused index" on the new foreign-key indexes, which are expected on a new, small database.

## Database migrations

All migrations are applied to the hosted project and their SQL matches the files (compared with comments and whitespace stripped).

| File                                                               | Remote version                                                          | What                                                                    |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `20260924000001_schema.sql` … `20260924000006_integrity_views.sql` | `20260924213606`, `…213620`, `…213628`, `…213654`, `…213815`, `…215930` | Applied earlier by `apply_migration`, which recorded its own timestamps |
| `20260924223409_rls_advisor_fixes.sql`                             | same                                                                    | RLS rewrite, anon fix, FK indexes                                       |
| `20260924223422_display_names.sql`                                 | same                                                                    | `display_names`, `taskers.display_name`                                 |
| `20260924223437_op_locks_and_policy_publish.sql`                   | same                                                                    | Leases, `publish_money_policy`                                          |
| `20260924225645_integrity_violations.sql`                          | same                                                                    | Invariant view                                                          |
| `20260924230530_integrity_violations_staff_only.sql`               | same                                                                    | Staff-only view                                                         |

**Action needed before `supabase db push` (deploy-staging) can work.** The hosted history lists 0001–0006 under the timestamps above, plus `20260924215040 deploy_bundles_bucket`, a leftover from an earlier deploy attempt: an empty private storage bucket `deploy-bundles` with two admin policies on `storage.objects`. Neither is in the repo. I was not permitted to rewrite the hosted migration history or drop that bucket, so a maintainer should run:

```bash
supabase link --project-ref pfqvqencsbxauafahezw
supabase migration repair --status reverted 20260924213606 20260924213620 20260924213628 20260924213654 20260924213815 20260924215930 20260924215040
supabase migration repair --status applied 20260924000001 20260924000002 20260924000003 20260924000004 20260924000005 20260924000006
supabase migration list   # local and remote columns should now match
```

Then remove the leftover bucket in SQL: `drop policy "deploy bundles: admin read" on storage.objects; drop policy "deploy bundles: admin write" on storage.objects;`, and delete the empty `deploy-bundles` bucket in the dashboard (Storage).

All migrations plus `seed.sql` and `scripts/ci/db_checks.sql` replay cleanly on an empty Postgres 17. This was verified with an in-process Postgres (PGlite) and Supabase-like stubs; CI's `db` job does the same with the real local stack.

## Seed and demo users

`supabase/seed.sql` (idempotent; loaded by `supabase db reset` and `supabase start`):

- The seed inserts the demo users into `auth.users` and `auth.identities` (bcrypt via `extensions.crypt(…, gen_salt('bf'))`, email confirmed). The signup trigger creates their profiles, and the admin and support roles are set by `update` afterwards.
- Tara and Leo are active taskers (they have `acct_fake_*` payout accounts); Pia is pending KYC.
- Ava starts with 5,000 bonus points and Ben with 600, posted to the ledger.
- Password for all demo users: `TaskNest!2026`.

It is applied to the hosted project, and sign-in works for all seven users through `POST /auth/v1/token?grant_type=password`.

## Deploying the functions

- With the CLI: `supabase functions deploy api` and `supabase functions deploy stripe-webhook --no-verify-jwt` (the per-function `verify_jwt` settings are also in `supabase/config.toml`).
- Tools that take a single inline file (the Supabase MCP `deploy_edge_function`): run `scripts/bundle-edge-functions.sh`, which writes `dist/functions/{api,stripe-webhook}/index.js`, one ESM file each, `npm:` imports external. The script re-quotes strings and proves the result is semantically identical, so the content needs almost no JSON escaping. Deploy it as `index.js` (entrypoint `index.js`, `verify_jwt` true for `api` and false for `stripe-webhook`).
- `GET /health` returns the `build` string (`BUILD` in `api/index.ts`).

## Domain bugs fixed (with regression tests in `tests/unit/domain-fixes.test.ts`)

1. **Cancellation pay split** (`clientCancellation`, `clientNoShow`). With a percentage tier and a refundable service fee, the tasker was paid 85% of the whole retained amount, including the platform's retained share of the service fee and any tax. At 50% on Tara's $103.50 booking the tasker got $43.99 instead of $38.25; with tax, tax money would have gone to the tasker. The tasker is now paid for the unrefunded labor only (less commission), and the rest stays with the platform. The refund to the client is unchanged.
2. **`planRefund` with `kind: "full"`** on a booking with nothing left to refund returned an all-zero plan (the database rejected the zero refund later). It now throws `nothing left to refund`.

## Known limitations / follow-ups

- **Wallet** tender: supported end to end in the domain, postings and schema, but there is no wallet balance source yet (the API allocates `walletCents: 0`).
- **Points expiry** is enforced at read time (expired lots are not spendable); there is no sweep job that posts `points_expired` to the ledger (breakage).
- **Auto-decline** when a tasker does not respond within `taskerResponseHours`: `accept` refuses after the window, but nothing declines the booking automatically. A cron job could call `decline` as admin.
- **Refunds of a cancellation fee** use the booking-level tasker share (the domain's `planRefund`), which can differ slightly from the share the tasker got from that fee.
- **Cancellation fees under a taxed policy**: the domain's outcome has no tax field, so tax retained on a percentage-tier fee is booked as platform revenue (policy v1 has no tax).
- **The test hooks** (`/admin/points/grant`, `/admin/disputes/simulate`, `/admin/test-clock`) exist only with the fake provider.
