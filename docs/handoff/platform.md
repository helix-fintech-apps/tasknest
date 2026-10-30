# TaskNest: platform and ops review

Repo: `helix-fintech-apps/tasknest` (public), `main` at `65a45d8` (2026-09-25, "ci: pin runners to ubuntu-24.04"). This review was read-only: nothing was edited, committed or pushed. Checked on 2026-10-29.

## TL;DR

1. **The code is healthy.** `npm ci`, typecheck, lint, Prettier, the unit tests (32/32), `vite build` and the mocked Playwright UI suite (23/23) all pass locally. CI on GitHub is green for all 7 required jobs, including `db`, `api` and `e2e` against a local Supabase stack.
2. **Nothing is deployed by the pipeline.** Both `Deploy staging` runs on `main` passed only because each half skipped: the `staging` environment has none of the Supabase or Vercel secrets. The Vercel preview job also skips (it runs for about 9 s). There is no frontend deployment anywhere.
3. **The hosted backend is down.** Supabase project `pfqvqencsbxauafahezw` has status **`INACTIVE`**, which means it is paused. Its hostname does not resolve (DNS NXDOMAIN), and the DB-backed MCP calls (`list_migrations`, `list_tables`) fail with "Database is possibly not accessible". Free-plan projects are paused after 7 days of low activity, and a paused project can be restored for up to 1 year ([Supabase: Project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)).
4. **Migration history on the hosted project is out of sync with the repo** (as documented in `docs/BACKEND_NOTES.md`). Migrations 0001–0006 are recorded under other timestamps, and there is a stray `20260924215040 deploy_bundles_bucket`. `supabase db push` in `deploy-staging` will fail until someone runs `supabase migration repair`. I could not re-verify this live because the DB is paused.
5. **Stripe is server-side only, and only test-like.** The `stripe` provider exists (REST, Idempotency-Key, manual capture, transfers, signed webhook). But the browser never collects a card: there is no Stripe.js, no publishable key, and every PaymentIntent falls back to `payment_method=pm_card_visa`. "Add Stripe for payments" therefore needs a frontend Payment Element, Customers and saved payment methods for later off-session charges, and Connect onboarding for taskers. Details are in §6.

## 1. Local check results (this run)

| Command                                        | Result                | Notes                                                                                                                       |
| ---------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                       | pass                  | Node 22 (`.nvmrc`)                                                                                                          |
| `npm run typecheck` (`tsc --noEmit`)           | pass                  |                                                                                                                             |
| `npm run lint` (`eslint . --max-warnings=0`)   | pass                  |                                                                                                                             |
| `npx prettier --check .`                       | pass                  |                                                                                                                             |
| `npm test` (`vitest run tests/unit`)           | **32/32 pass**        | `money-core.test.ts` 27, `domain-fixes.test.ts` 5                                                                           |
| `vite build` (placeholder env)                 | pass                  | JS 488 kB (139 kB gzip), CSS 23 kB                                                                                          |
| `playwright test e2e/ui.spec.ts` (mocked API)  | **23/23 pass** (58 s) | Uses the preinstalled `/opt/pw-browsers/chromium`                                                                           |
| `e2e/backend.spec.ts`                          | not run               | Needs `E2E_BACKEND=1` and a live backend, and the hosted one is paused                                                      |
| `db` / `api` jobs (`supabase start`)           | not run locally       | No Docker daemon in this sandbox. GitHub CI runs them; the last green run was #38403922309 on 2026-10-13                    |
| `deno check` (Edge Functions)                  | not run locally       | `deno` is not installed here. CI's `typecheck` job runs it, and it was green                                                |
| `npm audit`                                    | 2+ moderate           | `react-router` 6.x (open-redirect advisory GHSA-wrjc-x8rr-h8h6; the fix is a v7 major), and esbuild/vite dev-server only     |

## 2. CI/CD as built

Workflows (`.github/workflows/`):

| Workflow             | Trigger                       | State                                                                                                                                                                                      |
| -------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ci.yml`             | PR, push main, merge_group    | 7 required jobs: `lint typecheck unit db api e2e build`. `PAYMENTS_PROVIDER=fake`, no secrets needed. Green                                                                                |
| `codeql.yml`         | PR, main, weekly              | JS/TS + actions, `security-extended`. Green (weekly 2026-10-26)                                                                                                                            |
| `preview.yml`        | PR                            | Vercel preview. **Skips**: no `VERCEL_*` secrets                                                                                                                                           |
| `deploy-staging.yml` | push main                     | Supabase `link → db push → secrets set → functions deploy api / stripe-webhook --no-verify-jwt`, then Vercel. **Both halves skipped** on every run (annotations: missing `SUPABASE_*` / `VERCEL_*`) |
| `release.yml`        | tag `v*`                      | GitHub release plus a list of migrations. Never triggered                                                                                                                                  |

- Supabase CLI is pinned to `2.117.0`. Vercel CLI is `vercel@latest` (unpinned) in both deploy workflows; pin it.
- Guard rail: `scripts/ci/check-live-keys.sh` refuses `sk_live_` / `rk_live_`. `StripeProvider` refuses them too, and also refuses any key that is not `sk_test_` / `rk_test_`.
- Open PRs: #15 Helix money-gate ("do not merge" demo); #11, #17 Dependabot (green); #12–#14 (vitest 5, coverage-v8 5, vite 8) **failing CI**, because they are major bumps that need coordinated upgrades.
- CODEOWNERS and the ruleset docs reference `@nizamali1-coder`. Confirm that is the intended owner for the `helix-fintech-apps` org.

## 3. Hosted Supabase (`pfqvqencsbxauafahezw`, us-west-1, PG 17.6)

Source: Supabase MCP, read-only calls only.

| Check                            | Result                                                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get_project`                    | `status: INACTIVE` (paused); created 2026-09-24                                                                                                              |
| `list_edge_functions`            | `api` v2 ACTIVE `verify_jwt:true`; `stripe-webhook` v2 ACTIVE `verify_jwt:false`. Both were deployed as a single bundled `index.js` (MCP deploy) on 2026-09-24 22:54 / 23:07 UTC |
| `list_migrations`                | **failed**: "Connection terminated due to connection timeout" (DB paused)                                                                                    |
| `list_tables`                    | **failed**: "Database is possibly not accessible"                                                                                                            |
| `get_advisors` (security)        | `[]`. Probably not meaningful while the DB is paused                                                                                                         |
| HTTPS `/functions/v1/api/health` | unreachable: `pfqvqencsbxauafahezw.supabase.co` returns NXDOMAIN while paused                                                                                |

**Is it in sync with the repo?**

- **Functions:** probably yes, but this is not verified byte-for-byte. The last commits touching `supabase/functions` (`f52b712`, `82f4689`) were committed at 23:18–23:27 UTC, a few minutes after the deploys, and the last of them is Prettier-only. Nothing in `supabase/functions` has changed since 2026-09-24. Confirm with `GET /health` (it returns the `BUILD` string) after restoring the project.
- **Migrations:** not in sync by version id. Per `docs/BACKEND_NOTES.md`, the SQL content matches, but 0001–0006 are recorded as `20260924213606…215930`, and there is an extra `20260924215040 deploy_bundles_bucket` with a leftover `deploy-bundles` bucket and two `storage.objects` policies. `supabase db push` will try to re-apply 0001–0006 and fail. The fix (a maintainer runs it once, after restoring):
  ```bash
  supabase link --project-ref pfqvqencsbxauafahezw
  supabase migration repair --status reverted 20260924213606 20260924213620 20260924213628 20260924213654 20260924213815 20260924215930 20260924215040
  supabase migration repair --status applied 20260924000001 20260924000002 20260924000003 20260924000004 20260924000005 20260924000006
  supabase migration list
  ```
  Then drop the two `deploy bundles:` policies and delete the empty `deploy-bundles` bucket.
- **Secrets:** unknown. Per the docs the hosted functions run with the fake provider (no `STRIPE_SECRET_KEY`).
- **Keys:** `.env.example` uses the new `sb_publishable_…` key, but the functions read the legacy `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY`. Both are still injected by default, alongside `SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS` ([Supabase: Function secrets](https://supabase.com/docs/guides/functions/secrets)). If the project ever disables its legacy JWT keys, `_shared/db.ts` must move to the new variables.

## 4. Frontend deployment

- The target is **Vercel**, through the GitHub workflows (`vercel pull/build/deploy --prebuilt`). There is no `vercel.json`, no `netlify.toml` and no `.vercel/`, and no Vercel project is linked (no secrets).
- **Missing SPA rewrite.** React Router routes (`/taskers/:id`, `/bookings`, `/console`, …) will 404 on refresh or deep link. Vercel's docs: "If your Vite app is configured to deploy as a Single Page Application (SPA), deep linking won't work out of the box", and the fix is a `vercel.json` with `{"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}` ([Vercel: Vite](https://vercel.com/docs/frameworks/frontend/vite)).
- Build env in the Vercel project: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Once Stripe is on the frontend, also `VITE_STRIPE_PUBLISHABLE_KEY` (`pk_test_…`).
- Note: `src/lib/supabase.ts` silently falls back to the hosted URL when `VITE_SUPABASE_URL` is unset, so a misconfigured preview would point at the shared project.

## 5. Environment variables (complete list)

| Where                               | Name                                                                                                         | Status                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| Vercel project (preview/production) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`                                                                | not set (no project)                   |
| Vercel (new, for Stripe)            | `VITE_STRIPE_PUBLISHABLE_KEY` (`pk_test_…`)                                                                  | does not exist yet                     |
| GitHub env `staging`                | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`                                      | **missing**                            |
| GitHub env `staging`                | `STRIPE_SECRET_KEY` (`sk_test_`/`rk_test_`), `STRIPE_WEBHOOK_SECRET` (`whsec_`)                              | missing (falls back to fake)           |
| GitHub env `staging` + `preview`    | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`; optional var `STAGING_DOMAIN`                          | **missing**                            |
| Supabase function secrets           | `PAYMENTS_PROVIDER`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, optional `TEST_CLOCK_SECRET`              | set by `deploy-staging`                |
| Supabase (injected)                 | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`                          | automatic                              |
| Local / CI                          | `E2E_BASE_URL`, `E2E_BACKEND`, `PW_CHROMIUM_PATH`, `API_BASE_URL`                                            | optional                               |

`supabase secrets set` with `--env-file` pushes every secret in the file, and functions pick up new secrets without being redeployed ([Supabase: Function secrets](https://supabase.com/docs/guides/functions/secrets)).

## 6. Stripe: what the platform needs (from docs.stripe.com, fetched 2026-10-29)

### Already correct in the repo

- **Test keys.** Sandbox keys are `pk_test_`, `rk_test_` and `sk_test_`; live keys are `pk_live_`, `rk_live_` and `sk_live_`. Only `pk_` is safe to expose. Stripe recommends restricted keys (RAKs) over secret keys ([Stripe: API keys](https://docs.stripe.com/keys)). TaskNest accepts `rk_test_`, so give staging a RAK with only PaymentIntents, Refunds, Transfers, Customers and Disputes (read) permissions.
- **Idempotency.** "all `POST` requests accept idempotency keys", keys are up to 255 characters, and they "can be removed … after they're at least 24 hours old", after which a reused key creates a new request ([Stripe: Idempotent requests](https://docs.stripe.com/api/idempotent_requests)). The derived keys in the repo are fine. A retry more than 24 h later would create a new request, and the server-side `idempotency_keys` table covers that case.
- **Webhook signature.** The repo verifies `t=`/`v1=` HMAC-SHA256 over the raw body (`req.text()`) with a 300 s tolerance. That matches Stripe's manual scheme: ignore non-`v1` schemes, compare in constant time, and the libraries' default tolerance is 5 minutes ([Stripe: Webhooks](https://docs.stripe.com/webhooks)). `stripe-webhook` deployed with `verify_jwt=false` is correct, because Stripe sends no Supabase JWT.
- **Manual capture.** `capture_method=manual` → `requires_capture`. `amount_to_capture` partial capture "automatically releases the remaining amount", and you can only capture once on most payments ([Stripe: Place a hold](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method)).

### Gaps to close before "real Stripe" works end to end

1. **No card collection in the UI.** The server always defaults to `pm_card_visa`. Add `@stripe/stripe-js` and `@stripe/react-stripe-js` and the Payment Element. React needs `@stripe/react-stripe-js` ≥ 5.0.0 and `@stripe/stripe-js` ≥ 8.0.0. Stripe now recommends Checkout Sessions (`ui_mode: "elements"`) over raw PaymentIntents for most integrations; Payment Intents is still documented ([Stripe: Accept a payment](https://docs.stripe.com/payments/accept-a-payment.md?payment-ui=elements&api-integration=checkout)). The client secret "can complete the charge. Don't log it, embed it in URLs…" ([Stripe: Separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers.md?platform=web&integration=custom&ui=elements&api-integration=paymentintents)). The checkout page must be `https://` for live mode.
2. **Authorization windows and later charges.** An online card hold typically lasts 7 days (Visa MIT: 5 days, exactly 4 days 18 hours). An uncaptured expired authorization becomes `canceled` ([Stripe: Place a hold](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method)). TaskNest's re-authorization at completion, the extras and the tips are all **later charges without the customer present**. With real cards these need a Stripe Customer plus `setup_future_usage=off_session` at booking, then `off_session=true, confirm=true, customer, payment_method` ([Stripe: Save during payment](https://docs.stripe.com/payments/save-during-payment.md?payment-ui=elements)). Schema impact: a `stripe_customer_id` on `profiles`, and a saved `payment_method` id on the booking. TaskRabbit's public help center describes the same pattern: a pending authorization at booking that clears at completion or within 7 business days, and the charge made within 24 h of the invoice ([TaskRabbit: What's this charge after I booked?](https://support.taskrabbit.com/hc/en-gb/articles/204411580-What-s-This-Charge-After-I-Booked), [TaskRabbit: How do I pay my Tasker?](https://support.taskrabbit.com/hc/en-us/articles/204411560-How-Do-I-Pay-My-Tasker)).
3. **Tasker payouts (Connect).** Separate charges and transfers: "Your account balance is debited for the cost of the Stripe fees, refunds, and chargebacks", and Stripe recommends this charge type "only when you're responsible for negative balances of your connected accounts" ([Stripe: Separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers.md?platform=web&integration=custom&ui=elements&api-integration=paymentintents)). Needed:
   - Connect enabled on the Stripe account.
   - Tasker onboarding that writes the real `acct_…` to `taskers.stripe_account_id`. The seed has `acct_fake_*`, which only works with the fake provider.
   - `transfer_group` on the booking's PaymentIntent.
   - A second webhook destination scoped to **Connected accounts** if account-onboarding events matter ([Stripe: Webhooks](https://docs.stripe.com/webhooks)).
4. **Webhook endpoint.** Create it in Workbench → Webhooks (or `POST /v2/core/event_destinations`). Use the snapshot payload with `charge.dispute.created`, `charge.dispute.updated` and `charge.dispute.closed`. Copy the `whsec_` into `STRIPE_WEBHOOK_SECRET`. Each mode has a different secret.
   - Sandbox retries happen "three times over the course of a few hours". Live mode retries for up to 3 days.
   - Events can arrive out of order or duplicated, so dedupe on `event.id`.
   - Use `stripe listen --forward-to` for local testing ([Stripe: Webhooks](https://docs.stripe.com/webhooks)).
   - The endpoint must be the separate `stripe-webhook` function, not `/functions/v1/api/webhooks/stripe` (that one requires a JWT).
   - Set the endpoint's API version explicitly. Webhook events use the version set at endpoint creation, or else the account default. Requests pin `Stripe-Version: 2024-06-20`. Stripe's current version is `2026-10-28.endive`, and since `2024-09-30.acacia` it ships monthly releases plus twice-yearly breaking majors ([Stripe: Versioning](https://docs.stripe.com/api/versioning)). Pick one version for both the requests and the endpoint, so dispute payloads match what `_shared/stripe-webhook.ts` parses.
5. **Testing.**
   - `pm_card_visa` is valid.
   - The repo's decline sentinel `pm_card_chargeDeclined` is only a **fake-provider** string. Stripe's generic decline PaymentMethod is `pm_card_visa_chargeDeclined`.
   - Disputes: `pm_card_createDispute`, or card `4061219946393810` (async). Win or lose with `winning_evidence` / `losing_evidence` ([Stripe: Testing](https://docs.stripe.com/testing)).
   - Sandbox transactions "don't move funds".
   - Extend `tests/api/provider.test.ts` with a Stripe-sandbox job that is gated on a secret, so it never runs for forks.
6. **Key hygiene.** Use dashboard rotation, where the old and new keys both work for up to 7 days. Optional access policies (IP/ASN) can be added later, but Supabase Edge egress IPs are not fixed, so an ASN/country policy is the realistic option ([Stripe: API keys](https://docs.stripe.com/keys)).

## 7. Ordered steps to get a working, deployed app for the owner

**A. Bring the backend back** (owner, dashboard)

1. Restore `pfqvqencsbxauafahezw` in Supabase Studio. Consider Pro, because "Projects under a paid plan cannot be paused" ([Supabase: Project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)). Otherwise, add a scheduled health ping and expect pauses.
2. Run the `migration repair` block from §3, then `supabase migration list` and `supabase db push --dry-run`. The dry run should show nothing pending.
3. Drop the leftover `deploy-bundles` policies and bucket.
4. Check `GET /functions/v1/api/health`, `select * from integrity_violations` (it should return 0 rows) and sign-in for the demo users. Run `get_advisors` again.
5. Turn on Auth leaked-password protection (the advisor warning noted in BACKEND_NOTES).

**B. Wire CI/CD**

6. In the GitHub `staging` environment, add `SUPABASE_ACCESS_TOKEN` (ideally a bot account), `SUPABASE_PROJECT_REF=pfqvqencsbxauafahezw` and `SUPABASE_DB_PASSWORD`.
7. Create a Vercel project (Vite preset), run `vercel link`, and add `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` to `staging` and `preview`. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel's Preview environment, because the workflows pull `--environment=preview`.
8. PR: add `vercel.json` with the SPA rewrite, and pin `vercel@<version>` in `preview.yml` and `deploy-staging.yml`.
9. Re-run `Deploy staging` with workflow_dispatch and confirm that both halves actually deploy.

**C. Stripe, in a sandbox**

10. Create a Stripe sandbox, a RAK `rk_test_…` and `pk_test_…`. Enable Connect.
11. Create the webhook destination at `https://pfqvqencsbxauafahezw.supabase.co/functions/v1/stripe-webhook` for the three `charge.dispute.*` events, with an explicit API version. Store `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in GitHub `staging`; the deploy job sets `PAYMENTS_PROVIDER=stripe`.
12. Code PRs:
    - Payment Element on the booking form.
    - A server endpoint that creates the Customer and PaymentIntent with `capture_method=manual`, `setup_future_usage=off_session` and `transfer_group`.
    - Off-session flags on the re-auth, extras and tip intents.
    - Stripe Connect onboarding for taskers.
    - `VITE_STRIPE_PUBLISHABLE_KEY`.
    - Keep the fake provider as the default for CI.
13. Stripe smoke test on staging: book with 4242 → complete (capture) → tip → refund → `pm_card_createDispute` → `losing_evidence` → check the ledger and `integrity_violations`.

**D. Hygiene (not blocking)**

14. Decide on the failing Dependabot majors (#12–#14). Plan react-router 7 for the open-redirect advisory.
15. Optionally add a `production` environment and Vercel production deploy on tags (`release.yml` currently only creates the GitHub release).

## Sources

- Stripe: [Webhooks](https://docs.stripe.com/webhooks) · [API keys](https://docs.stripe.com/keys) · [Idempotent requests](https://docs.stripe.com/api/idempotent_requests) · [Place a hold](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method) · [Testing](https://docs.stripe.com/testing) · [Accept a payment (Elements)](https://docs.stripe.com/payments/accept-a-payment.md?payment-ui=elements&api-integration=checkout) · [Separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers.md?platform=web&integration=custom&ui=elements&api-integration=paymentintents) · [Save during payment](https://docs.stripe.com/payments/save-during-payment.md?payment-ui=elements) · [Versioning](https://docs.stripe.com/api/versioning)
- Supabase: [Project pausing](https://supabase.com/docs/guides/platform/free-project-pausing) · [Upgrading / restore window](https://supabase.com/docs/guides/platform/upgrading) · [Function secrets](https://supabase.com/docs/guides/functions/secrets)
- Vercel: [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite)
- TaskRabbit (payment-timing pattern only): [What's this charge after I booked?](https://support.taskrabbit.com/hc/en-gb/articles/204411580-What-s-This-Charge-After-I-Booked) · [How do I pay my Tasker?](https://support.taskrabbit.com/hc/en-us/articles/204411560-How-Do-I-Pay-My-Tasker)
- GitHub runs: CI [#38403922309](https://github.com/helix-fintech-apps/tasknest/actions/runs/38403922309) (all 7 green) · Deploy staging [#36179244625](https://github.com/helix-fintech-apps/tasknest/actions/runs/36179244625) (both halves skipped: missing secrets)
