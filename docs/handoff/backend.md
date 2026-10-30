# TaskNest backend and money domain: review

Repo: `helix-fintech-apps/tasknest` at `65a45d8` (read-only review). All claims about TaskNest come from the code and docs in the repo (file:line given where useful). All Stripe facts come from docs.stripe.com / stripe.com pages fetched on 2026-10-29 (listed in Sources). TaskRabbit facts come from support.taskrabbit.com, and only UX patterns are borrowed from them.

---

## 0. Summary

The backend is in good shape for a test subject. It has one `api` Edge Function (Deno) for every write and a separate `stripe-webhook` function. Money rules live in pure, unit-tested domain modules (`_shared/domain`). All writes go through an atomic `tn_apply` RPC. The double-entry ledger is checked twice (in TypeScript and by a deferred DB trigger). Idempotency is scoped per user. Leases (`op_locks`) serialize money operations. A view, `integrity_violations`, must always be empty. 29 API tests and 32 unit tests cover the money flows.

**The Stripe provider is a test-mode stub and can't take real cards.** It always confirms server-side with the magic test PaymentMethod `pm_card_visa`. It creates no Customer, saves no PaymentMethod, has no client-side confirmation (3DS) and no Connect onboarding. It listens only to dispute webhooks. The ledger also ignores Stripe processing fees. Making Stripe real needs backend work (section 9), plus the UI pieces listed in section 8.

Most important findings (detail in section 10):

1. **No real payment method path (blocker for "real Stripe").** `authorize()` and `charge()` default to `pm_card_visa` (`_shared/provider/stripe.ts:80,117`). The DB has no `stripe_customer_id` and no saved payment method. Three charges happen later without the customer present: re-auth at completion, extras, and tips. Stripe requires a Customer, a saved PaymentMethod and `off_session=true` for these [S4].
2. **Dispute webhook gaps against the real Stripe lifecycle:**
   - Inquiry statuses (`warning_*`), `prevented` and appeals are not modelled. The DB CHECK on `disputes.status` only allows 4 values [S6].
   - A `charge.dispute.closed` with `warning_closed` leaves the booking `disputed` forever. That blocks its refunds and the tasker's payout for it.
   - A second close (Stripe documents "late win" lost→won, and duplicate Event objects) makes the endpoint answer `409`. Stripe then retries for up to 3 days and the late win is never applied [S3][S5].
3. **The dispute fee is booked at the wrong time and only on loss.** Stripe debits the disputed amount plus a non-refundable $15 "dispute received" fee when the dispute opens. It charges another $15 "countered" fee if you respond, refunded only on a win [S5][S7]. TaskNest posts nothing on open or on win (`_shared/disputes.ts:19,60-70`).
4. **Stripe processing fees (2.9% + 30¢) are not in the ledger** [S7]. `card_clearing` is booked gross, so it can never reconcile to Stripe balance transactions, and `platform_revenue` is overstated. Refunds don't return the original fee [S8].
5. **Idempotency-Key is optional on the server** (`api/index.ts:320`). Without it, provider idempotency keys come from a random `opKey`. A client retry after a 5xx can then double-authorize, double-tip or double-refund at Stripe. The UI always sends a key, but the API contract should require one on money routes.
6. **A failed Stripe transfer aborts the whole payout run** (`api/handlers/admin.ts:174`: no per-tasker try/catch). Transfers are created without `source_transaction`. By default Stripe fails a transfer when it exceeds the platform's available balance and doesn't retry it [S9].
7. **The pinned API version is `2024-06-20`** (`stripe.ts:55`). The current version is `2026-10-28.endive`, and webhook payloads use the account default version unless the endpoint pins one [S10].
8. **The fake decline token `pm_card_chargeDeclined` is not in Stripe's current test list.** The generic decline is `pm_card_visa_chargeDeclined` [S11]. Decline tests written against the fake provider won't carry over to Stripe test mode unchanged.
9. **The UI doesn't expose several capabilities:** no-show, cancel-preview from the server, admin decline, policy publishing, dispute "open", per-tasker payout, the client refund-request queue for staff, integrity views, and anything Stripe-specific (cards, Connect onboarding). See section 8.

---

## 1. Request path and architecture

```
Browser (supabase-js, anon key + user JWT)
  ├─ reads  → PostgREST under RLS (tables/views in §6)
  └─ writes → POST {SUPABASE_URL}/functions/v1/api/...   (src/lib/api.ts)
                 api/index.ts: CORS → route → readJson → authenticate (JWT → profiles.role)
                   → provider() (fake|stripe; live key ⇒ 503) → test clock → Idempotency-Key begin
                   → handler (api/handlers/*.ts):
                        withLocks(op_locks) → load fresh rows → plan with _shared/domain
                        → provider call(s) → UnitOfWork.commit() = ONE tn_apply RPC
                   → Idempotency-Key finish (store 2xx/4xx; drop 5xx, busy, request_in_progress)
Stripe → POST /functions/v1/stripe-webhook (verify_jwt=false) → handleStripeWebhook (signature) → disputes
```

- Function config: `supabase/config.toml` sets `[functions.api] verify_jwt = true` and `[functions.stripe-webhook] verify_jwt = false`.
- `BUILD = "tasknest-api 2026-09-24.3"` (`api/index.ts`).
- Provider selection (`_shared/provider/index.ts`):
  - A `sk_live_`/`rk_live_` key is refused, and every request returns `503 payments_misconfigured`.
  - `PAYMENTS_PROVIDER=fake|stripe` forces the choice.
  - Otherwise Stripe is used if the key starts with `sk_test_`, and fake if not.
- A service-role key used as the bearer token is accepted **only** on `/payouts/run`, as a system admin for cron (`api/index.ts` `SYSTEM_ROUTES`).

---

## 2. Cross-cutting conventions (verified in code)

| Concern | Behaviour | Where |
| --- | --- | --- |
| Auth | Bearer JWT → `auth.getUser` → role from `profiles` (`401 unauthorized`, `403 no_profile`). Non-parties on a booking get `404 not_found` | `api/index.ts` `authenticate`, `api/context.ts` `requireParty` |
| Roles | `client`, `tasker`, `admin`, `support_agent`. Staff = admin or support_agent | `context.ts` |
| Idempotency | Header `Idempotency-Key`, 8–200 chars, scoped `(user_id, key)`. Hash = method + path + body + test-now. Same key and same request → replay with `Idempotent-Replayed: true`. Different request → `422 idempotency_key_reused`. Still running → `409 request_in_progress`. Rows `in_progress` > 60 s are deleted and re-run. 5xx, `busy` and `request_in_progress` are not stored. **The header is optional**: routes run without it | `api/index.ts` `idemBegin`/`idemFinish`, table `idempotency_keys` |
| Provider idempotency | Stripe `Idempotency-Key` on every call. Keys are `${opKey}:auth`, `${opKey}:tip`, `${opKey}:refund:main/extra`, `${bookingId}:capture`, `:extras`, `:reauth`, `:cancel`, and `payout:${payoutId}`. `opKey = req:<user>:<Idempotency-Key>`, or a random UUID when there is no header | handlers, `stripe.ts` |
| Leases | `withLocks()` → `acquire_op_lock` (TTL 60 s, wait 5 s, then `409 busy`). Keys: `booking:<id>`, `points:<client>`, `tasker:<id>`, `payout:<tasker>` | `_shared/db.ts`, migration `…223437` |
| Atomic writes | `UnitOfWork` collects ops (`insert`, `update` with expected row count, `inc`, `delete`, `ledger`, `assert_slot_free`, `lock`) and sends them to `tn_apply(ops jsonb)`. Tables are whitelisted. A wrong row count raises `conflict:` (409) | `_shared/db.ts`, migration `…05` |
| Errors | `{error:{code,message[,details]}}`. Plain domain `Error` → `422 rule_violation`. PG 23505 → `409 duplicate`/`slot_taken`, 23514 → `409 constraint_violation`, 23503 → `422 invalid_reference`, other → `500 db_error`. `PaymentError` uses its own status (402 decline, 502 provider) | `_shared/http.ts` |
| Money | Integer cents. Half-up bps rounding in `money.ts`. Lint bans `parseFloat`/`toFixed` in functions | `domain/money.ts`, `docs/CI.md` |
| Policy versioning | A booking stores `policy_version`, and every later calculation loads that version. New quotes use the highest version with `effective_from <= now` | `_shared/db.ts` `loadPolicy` |
| Test clock | `x-test-now` only with the fake provider plus an admin-minted HMAC token `x-test-clock` bound to the user. With Stripe → `400 test_clock_disabled` | `api/test-clock.ts`, `api/index.ts` `requestClock` |
| Provider-before-commit | Plan and validate → provider call → commit. If the commit fails after an authorization at booking, the authorization is voided. Elsewhere the 5xx releases the Idempotency-Key, and a retry replays the provider call with the same provider key | handlers |

Stripe's own idempotency layer, for comparison [S2]:
- Keys can be up to 255 chars and may be pruned after they are at least 24 h old.
- A reused key with different parameters is an error.
- **Stripe saves and replays the first response for a key "including `500` errors"**. So a "retry with the same provider key" after a Stripe 500 replays that 500 until the key ages out.
- The longest TaskNest key is `req:` + 36 + `:` + 200 + `:refund:extra` = 254 chars, just under 255.

---

## 3. Endpoint catalogue

Base URL: `${SUPABASE_URL}/functions/v1/api`. ✓ = stored under the Idempotency-Key. All bodies are JSON objects; a non-object body gives `400 bad_json`.

| # | Method + path | Who | ✓ | Request | Response | Main errors | Money side effects |
| - | --- | --- | - | --- | --- | --- | --- |
| 1 | `GET /health` (also `/`) | anyone who passes the gateway (no function-level auth) | | – | `{ok, service, build, provider}` | – | none |
| 2 | `POST /quote` | any signed-in user | | `{taskerId, minutes 1..1440, promoCode?, pointsRequested?}` | `{quote, allocation, discountCents, promoCode, policyVersion, points:{available,pending}}` | 404 tasker/promo, 409 `tasker_unavailable`, 422 promo/points rules | none |
| 3 | `POST /bookings` | client with confirmed email | ✓ | `{taskerId, localStart "YYYY-MM-DDTHH:mm", tz, minutes, description≤2000, promoCode?, pointsRequested?, paymentMethod?}` | 201 `{booking, tenders, quote, allocation, discountCents, policyVersion, needsReauth}` | 400 date/tz, 403 `forbidden`/`unverified`, 409 `slot_taken`/`tasker_unavailable`, 422 past/self/points, 402 `card_declined` | lock `points:<client>` if points are used. `provider.authorize(card part, manual capture)`. Insert booking and tenders, reserve points (FIFO by expiry), promo redemption, ledger `booking_hold`. Void the authorization if the commit fails |
| 4 | `POST /bookings/:id/accept` | the booking's tasker | ✓ | `{}` | `{booking, tenders}` | 409 `illegal_state`, `response_window_expired` (> `taskerResponseHours`), `tasker_unavailable` | status only |
| 5 | `POST /bookings/:id/decline` | tasker, admin | ✓ | `{reason?}` | `{booking, tenders, outcome, refund, strike:null}` | 409 `illegal_state` | release points and promo, ledger `booking_release`. After the commit, `provider.cancel(PI)` (errors swallowed, `bookings.ts:568`) |
| 6 | `POST /bookings/:id/reschedule` | client, tasker | ✓ | `{localStart}` (in `location_tz`) | `{booking, tenders}` | 409 not requested/accepted, `slot_taken`; 422 past | `start_at` only. `original_start_at` stays fixed. Authorization validity is **not** re-checked |
| 7 | `GET /bookings/:id/cancel-preview` | client, tasker, staff | | – | `{who, policyVersion, outcome, refund:{refundCents,retainedCents,perTender,kept}}` | 404 | none |
| 8 | `POST /bookings/:id/cancel` | client or tasker | ✓ | `{reason?}` | `{booking, tenders, outcome, refund, strike?}` | 409 `illegal_state` (tasker must decline a `requested` booking) | **Client:** `clientCancellation` and `refundAfterRetention`. Capture the kept card amount, redeem kept points, release the rest, ledger `cancellation_fee` and `booking_release`. If no card is kept, cancel the PI. **Tasker:** full release, strike, `$10` `tasker_penalty`, suspension at 3 strikes in 30 days (lock `tasker:<id>`) |
| 9 | `POST /bookings/:id/no-show` | tasker (`who:client`), admin (either) | ✓ | `{who:"client"\|"tasker", reason?}` | as cancel | 409 `too_early` (before `start_at`), 403 tasker reporting a tasker no-show | client: `clientNoShow` (default 0% refund, `no_show_fee`). Tasker: same as a tasker cancel |
| 10 | `POST /bookings/:id/start` | tasker | ✓ | `{}` | `{booking, tenders}` | 409 | status only |
| 11 | `POST /bookings/:id/complete` | tasker | ✓ | `{extraMinutes?≤1440, expensesCents?≤1,000,000}` | `{booking, tenders, captured:{cardCents,extrasCents,pointsRedeemed}, pointsEarned}` | 409 not `in_progress` | capture `paid.card` (≤ authorized). If the authorization expired or there is no PI → `charge(kind:"reauth")`. Extras → separate `charge(kind:"extras")`. Redeem points, earn points (pending 7 days). Ledger `booking_completed`, `extras_charged`, `points_earned` |
| 12 | `POST /bookings/:id/tip` | client | ✓ | `{amountCents≥1, tender?="card", paymentMethod?}` | `{tip:{id,amountCents,taskerGets,platformFee,paymentIntentId,tippedTotalCents}}` | 422 not completed, window closed, over cap (cap counts all tips together), non-card | `charge(kind:"tip")`, ledger `tip` (100% to `tasker_payable`) |
| 13 | `POST /bookings/:id/refund-preview` | staff | | `{kind, amountCents, reason, approvedBy?}` | `{refundableCents, plan:{perTender,taskerClawbackCents,platformCostCents,requiresApproval,amountCents}, pointsReturned, pointsClawedBack, policyVersion}` | 404 non-staff, 409/422 as refund | none |
| 14 | `POST /bookings/:id/refund` | client (request only), staff | ✓ | `{kind:"full"\|"partial"\|"goodwill", amountCents, reason, approvedBy?}` | client: **202** `{requested:true, bookingId, kind, amountCents}` (audit row only). Staff: `{refund:{…providerRefundIds}, booking, tenders}` | 409 nothing captured, open dispute (via the domain → 422), 422 over refundable, agent over the $100 limit without an admin approver, past the 30-day window (non-admin) | lock `points:<client>`. `planRefund` with the booking's figures including extras. `refunded_cents` per tender (DB CHECK `refund_le_paid`). Return or reissue points, claw back earned points (may create a `debt` lot). Provider refund on the main PI first, then the extras PI. Ledger `refund_{kind}` |
| 15 | `POST /bookings/:id/review` | client | ✓ | `{rating 1..5, body≤5000}` | `{review, bonusPoints}` | 409 not completed, `already_reviewed` | bonus lot plus `points_review_bonus` (PK on `reviews.booking_id` keeps it once-only) |
| 16 | `POST /payouts/run` | admin, or the service key (cron) | ✓ | `{taskerId?}` | `{payouts:[{taskerId, payoutId?, amountCents, bookingIds?, transferId?, balanceCents, blockedReason?}]}` | 404 tasker | per tasker, under lease `payout:<id>`: `planPayout` (hold 3 days, settled = not `disputed`, adjustments). Blocked if no `stripe_account_id`. `provider.transfer` with a deterministic payout id, then the `payouts` row and ledger `payout` |
| 17 | `POST /admin/taskers/:id/status` | admin | ✓ | `{status:"active"\|"suspended"\|"pending", reason}` | `{tasker}` | 404, 400 | audit |
| 18 | `POST /admin/policies` | admin | ✓ | `{policy: full MoneyPolicy, effectiveFrom ISO ≥ now, reason}` | `{version, effectiveFrom, policy}` | 422 `invalid_policy` (lists every problem in `details`), 422 retroactive | `publish_money_policy` RPC (sequential version, audited) |
| 19 | `POST /admin/disputes/simulate` | admin, fake provider only | ✓ | `{bookingId, outcome:"open"\|"won"\|"lost", amountCents?}` | `{dispute, booking, events, taskerBalanceCents, refundableCents}` | 403 `fake_provider_only`, 409 `dispute_open`, 422 nothing captured | synthesizes `charge.dispute.created/closed` through the same `processStripeEvent` path |
| 20 | `POST /admin/points/grant` | admin, fake only | ✓ | `{userId, points≤1e6, reason?}` | `{lotId, points}` | 403 | bonus lot, ledger `points_grant` |
| 21 | `POST /admin/test-clock` | admin, fake only | | `{userId, ttlSeconds? 60..86400}` | `{userId, token, expiresAt}` | 403 | none |
| 22 | `POST /webhooks/stripe` (inside `api`, local use only), and `POST /functions/v1/stripe-webhook` | Stripe (signature) | event-id dedupe | raw Stripe Event | `{received:true, handled?, duplicate?, …}` | 400 `bad_signature`/`bad_json`/`bad_event`, 503 `webhook_not_configured`, 409 `dispute_closed` (see finding F2) | see section 7 |

An unknown path gives `404 not_found`. A known path with the wrong method gives `405 method_not_allowed`. A malformed uuid in the path gives `400`.

---

## 4. Domain modules (`supabase/functions/_shared/domain`, also imported by the UI as `@domain`)

| Module | Exports | What it enforces |
| --- | --- | --- |
| `money.ts` | `divRoundHalfUp`, `applyBps`, `assertCents`, `formatCents` | integer cents, half-up rounding of bps. (`formatCents` divides by 100 for display only) |
| `config.ts` | `MoneyPolicy`, `DEFAULT_POLICY` (v1) | v1 values:<br>• 15% service fee, 15% tasker commission, 0% tax<br>• cancellation tiers: ≥48 h 100%, ≥24 h 50%, <24 h one hour of the rate; no-show refund 0%<br>• tasker cancel: $10 fee, 3 strikes in 30 days → suspended<br>• tips: cap 25% of subtotal, 30 days, card only, 0% platform fee<br>• points: 1¢ each, 1 per $1 of card spend, minimum 500, pending 7 days, expire after 12 months, +100 for a review<br>• tender orders: use promo → points → wallet → card; refund and retain card → wallet → points → promo<br>• payout hold 3 days; agent refund limit $100; refund window 30 days<br>• authorization valid 7 days with a 1-day buffer; tasker response window 24 h |
| `pricing.ts` | `laborCents`, `quote` | subtotal = rate × minutes / 60 (half-up). Fee, tax and commission come from bps. `total = subtotal + fee + tax` (also a DB CHECK) |
| `tender.ts` | `allocateTenders`, `splitRefund`, `refundAfterRetention`, `partsTotal` | split tender in policy order, points minimum, cap and balance. Refund per tender ≤ paid − refunded. Retention follows `retentionOrder` |
| `cancellation.ts` | `clientCancellation`, `taskerCancellation`, `clientNoShow`, `shouldSuspend` | inclusive tier boundaries measured from `original_start_at`. The tasker is paid only for retained labor, less commission (bug fix #1). Strike window |
| `refunds.ts` | `planRefund`, `disputeLost`, `serviceFeeShare` | reason required, positive amount, no refund while a dispute is open, window (admin may override), refundable bound, approval above the agent limit. Tasker clawback = `floor(amount × (subtotal − commission)/total)`. Goodwill = platform only. Dispute-lost split. "Full refund with nothing left" throws (bug fix #2) |
| `tips.ts` | `validateTip` | positive, completed, inside the window, allowed tender, under the cap. Platform fee comes from the policy (must be 0) |
| `points.ts` | `pointsEarned`, `newEarnLot`, `consumeFifo`, `clawbackPoints`, `pointsToReturn`, … | earn on card cash excluding pro-rata tax. FIFO by expiry. Clawback rounded **up**, cumulative. Expired points are reissued with a 30-day life |
| `payouts.ts` | `planPayout` | tasker must be active; items past the hold and settled. Adjustments can block a payout (balance ≤ 0) |
| `booking.ts` | `BookingStatus`, `canTransition`, `needsReauth` | state machine: requested → accepted / declined / canceled_client. accepted → in_progress / cancels / no-shows. in_progress → completed / no_show_client. completed and no_show_client → disputed. disputed → completed |
| `promo.ts` | `promoDiscount` | already used, expired, first task only. Fixed or percent (value in bps), max discount, never above the subtotal |
| `ledger.ts` | `Account`, `txn`, `dr`, `cr`, `assertBalanced` | balanced per unit (USD, POINTS), non-negative integer lines |
| `time.ts` | `localToUtc` (DST re-check), `addDays`, `addMonths`, `hoursBetween` | wall clock in the task's time zone → UTC |

Shared server helpers outside the domain:
- `_shared/postings.ts`: ledger postings per event.
- `_shared/points-store.ts`: lot and movement bookkeeping. Invariant: Σ movements = Σ lots.
- `_shared/figures.ts`: booking figures including extras.
- `_shared/disputes.ts`: open and close a dispute; `DISPUTE_FEE_CENTS = 1500`.

---

## 5. Ledger

Chart of accounts (`domain/ledger.ts`):
- USD: `client_funds_held`[client], `card_clearing`, `platform_revenue`, `tasker_payable`[tasker], `tips_payable` (declared but **unused**: tips go straight to `tasker_payable`), `tax_payable`, `points_liability`, `promo_expense`, `wallet_liability`[client], `refund_expense`, `dispute_loss`, `payouts_clearing`[tasker].
- POINTS: `points_outstanding`[user], `points_issued`.

| `ledger_txns.kind` | Lines (`_shared/postings.ts`) |
| --- | --- |
| `booking_hold` | Dr points_liability / wallet_liability / promo_expense; Cr client_funds_held[client]. POINTS: Dr points_outstanding[client], Cr points_issued |
| card authorization | **no entry** (recorded on the booking only) |
| `booking_completed` / `cancellation_fee` / `no_show_fee` | Dr card_clearing, Cr client_funds_held (captured card). Then Dr client_funds_held (recognized), Cr tasker_payable, platform_revenue, tax_payable |
| `extras_charged` | Dr card_clearing; Cr tasker_payable (extra labor − commission + expenses), platform_revenue, tax_payable |
| `booking_release` | reverse of the hold for the released tenders |
| `points_earned` / `points_review_bonus` / `points_grant` | POINTS Dr points_issued, Cr points_outstanding. USD Dr promo_expense, Cr points_liability |
| `tip` | Dr card_clearing, Cr tasker_payable |
| `tasker_penalty` | Dr tasker_payable, Cr platform_revenue |
| `refund_full/partial/goodwill` | Dr tasker_payable (clawback) + refund_expense; Cr card_clearing / wallet_liability / points_liability / promo_expense. Points returned and clawed back |
| `dispute_lost` | Dr tasker_payable (recovered) + dispute_loss; Cr card_clearing (reversed + fee). Points clawback |
| `payout` | Dr tasker_payable, Cr payouts_clearing[tasker] |

Invariants checked in `integrity_violations` (staff-only view):
- Every txn balances.
- No tender is over-refunded.
- Lots equal movements.
- POINTS ledger equals lots.
- Closed bookings hold 0 in `client_funds_held`.
- Open bookings hold exactly their non-card tenders.

`scripts/ci/db_checks.sql` additionally mutation-tests the trigger, the CHECKs and the slot index.

**Not modelled, but needed for real Stripe:**

1. Processing fees (2.9% + 30¢ US card [S7]), which Stripe doesn't return on refund [S8]. Suggest a `processor_fees` expense line per charge, taken from the charge's balance transaction.
2. Dispute received fee at dispute *open* and countered fee on response, refunded only on a win [S5][S7]. Today the $15 is posted only on loss.
3. Dispute funds withdrawn at open and reinstated on a win [S5]. Today nothing posts until close.
4. Pending versus available balance, and `payouts_clearing` → Stripe transfer settlement. A transfer reversal account is needed if refunds after payout are recovered from connected accounts [S9].

---

## 6. Database schema (migrations `20260924000001` … `20260924230530`)

Enums:
- `user_role` (client, tasker, admin, support_agent)
- `tasker_status` (pending, active, suspended)
- `booking_status` (10 values, matching `domain/booking.ts`)
- `tender` (card, points, wallet, promo)

| Table | Key columns and constraints |
| --- | --- |
| `money_policies` | `version` PK, `policy jsonb`, `effective_from`. New versions only through `publish_money_policy()` (≥ now, audited) |
| `profiles` | `id`→auth.users, `role`, `full_name`, `home_tz`. Users may update only `full_name` and `home_tz` (column grant). The signup trigger takes role `tasker` from user metadata (staff roles are never granted at signup) |
| `taskers` | `id`→profiles, `category`, `hourly_rate_cents > 0`, `status`, `stripe_account_id`, `kyc_verified_at`, `suspended_at`, `display_name` |
| `bookings` | money columns are bigint cents:<br>• base amounts (`subtotal`, `service_fee`, `tax`, `total`); CHECK `total_adds_up`<br>• extras (`extra`, `extra_labor`, `extra_service_fee`, `extra_tax`, `expenses`); CHECK `extra_adds_up`<br>• `captured_cents`, `provider_refunded_cents`<br><br>Other columns: `policy_version` FK, `start_at`, `original_start_at`, `location_tz`, `est_minutes`, `points_reserved`, `points_earned`, `promo_code`, `stripe_payment_intent_id`, `extra_payment_intent_id`, `auth_expires_at`, lifecycle timestamps.<br><br>Partial unique index `bookings_no_double_slot (tasker_id, start_at)` while active; overlap also checked in `tn_apply` under an advisory lock. **No address, no category and no Stripe customer or payment-method columns** |
| `booking_tenders` | PK `(booking_id, tender)`, `amount_cents`, `refunded_cents`, `points`. CHECK `refund_le_paid` |
| `refunds` | `kind` ∈ full / partial / goodwill / cancellation, `amount_cents > 0`, `per_tender jsonb`, `tasker_clawback_cents`, actor, `approved_by`, `reason` (non-empty), `idempotency_key` unique. **No Stripe refund id or status** (the ids are returned in the response only) |
| `tips` | `amount_cents > 0`, `platform_fee_cents = 0`, `stripe_payment_intent_id` |
| `disputes` | `stripe_dispute_id` unique, `amount_cents`, `fee_cents`, `status` ∈ {needs_response, under_review, won, lost}, `recovered_from_tasker_cents` |
| `points_lots` | kind earn / bonus / reissue / debt, `points_remaining ≥ 0` unless debt, `available_at`, `expires_at` |
| `points_movements` | signed `points`, kind reserve / release / redeem / return / clawback / expire / reissue / earn / bonus |
| `promo_codes`, `promo_redemptions` | redemption PK `(code, user_id)`; deleted again on cancel or decline when the promo was not kept |
| `payouts` | `amount_cents > 0`, `booking_ids uuid[]`, `stripe_transfer_id`, status pending / paid / failed (only `paid` is ever written) |
| `reviews` | PK `booking_id`, rating 1..5 |
| `tasker_strikes` | `fee_cents`, `created_at` (indexed with tasker) |
| `ledger_txns`, `ledger_lines` | `idempotency_key` unique on txns. Lines have `unit` ∈ USD/POINTS and non-negative debit and credit. Deferred constraint trigger `ledger_balanced` |
| `audit_log` | actor, action, entity, reason, data |
| `stripe_events` | `id` PK (event id), `type`, `object_id` |
| `idempotency_keys` | PK `(user_id, key)`, `request_hash`, status, stored response |
| `op_locks` | key PK, token, `expires_at` (no RLS policies; service role only) |
| `display_names` | public name per profile, maintained by triggers |

Views (all `security_invoker`):
- `points_balances`
- `tasker_balances` (Σ `tasker_payable`)
- `ledger_trial_balance`
- `ledger_unbalanced_txns`
- `points_integrity`
- `booking_money_summary`
- `integrity_violations` (staff, or a SQL session)

RPCs, executable by `service_role` only: `tn_apply`, `tn_where_sql`, `post_ledger_txn`, `acquire_op_lock`, `release_op_lock`, `publish_money_policy`. `private.is_staff()` lives in a schema PostgREST doesn't expose.

### RLS (final state after `…223409`, `…223422`, `…230530`)

| Data | anon | client | tasker | staff |
| --- | --- | --- | --- | --- |
| `money_policies`, `reviews` | read | read | read | read |
| `taskers` | active only | active plus own | active plus own | all |
| `display_names` | active taskers | self, active taskers, booking counterparties (first name only for clients) | same | all |
| `profiles` | – | own | own | all |
| `promo_codes` | – | read **all codes** | read all | read |
| `bookings`, `booking_tenders`, `refunds`, `tips`, `disputes` | – | own bookings | own bookings | all |
| `points_lots`, `points_movements`, `promo_redemptions` | – | own | own | all |
| `payouts`, `tasker_strikes` | – | – | own | all |
| `ledger_lines` | – | – | own `tasker_payable` lines | all |
| `ledger_txns`, `audit_log`, `stripe_events`, `idempotency_keys` | – | – | – | all |
| writes | none from the browser except `profiles.full_name`/`home_tz`; all money writes go through the service role in `api` |

Note: `promo_codes` is readable by every signed-in user, so all codes can be listed. That is harmless for a demo but worth knowing.

---

## 7. Payment provider interface and the Stripe adapter

`_shared/provider/types.ts`:

```ts
interface PaymentsProvider {
  name: "fake" | "stripe";
  authorize({amountCents, bookingId, description, paymentMethod?, idempotencyKey}): Promise<{id,status,amountCents}>; // manual capture
  capture(paymentIntentId, amountCents, idempotencyKey): Promise<{id,status,amountCents}>;            // amount_to_capture
  cancel(paymentIntentId, idempotencyKey): Promise<void>;                                              // void auth
  charge({amountCents, bookingId, description, paymentMethod?, idempotencyKey, kind:"extras"|"tip"|"reauth"}): Promise<…>; // auto capture
  refund(paymentIntentId, amountCents, idempotencyKey): Promise<{id}>;
  transfer({amountCents, destination, payoutId, idempotencyKey}): Promise<{id}>;
}
```

- **fake**: deterministic ids (`pi_fake_`, `re_fake_`, `tr_fake_`) derived from the idempotency key. `pm_card_chargeDeclined` simulates a decline (`402 card_declined`). Rejects non-integer or non-positive amounts. Never moves money.
- **stripe**: raw `fetch` to `https://api.stripe.com/v1`, form-encoded, `Stripe-Version: 2024-06-20`, `Idempotency-Key` on every call. Stripe 402 → `PaymentError` 402 with `decline_code`/`code`; any other error → 502.

| Interface call | Stripe request in the code | What the Stripe docs say | Gap |
| --- | --- | --- | --- |
| `authorize` | `POST /payment_intents` with `capture_method=manual`, `confirm=true`, `payment_method=pm_card_visa` (default), `payment_method_types[]=card`, `transfer_group=<bookingId>`, metadata. Throws unless `requires_capture` | Manual capture leaves the PI in `requires_capture`. Online card authorizations are "typically" valid 7 days (Visa CIT 7 days, Visa MIT 4 days 18 h). `payment_method_details.card.capture_before` gives the real expiry. An expired authorization becomes `canceled` [S1] | Needs a real PaymentMethod from the client (Payment Element) or client-side confirmation for 3DS (`requires_action` [S12]). `auth_expires_at` is computed as now + 7 days instead of read from `capture_before` |
| `capture` | `POST /payment_intents/:id/capture` with `amount_to_capture` | A partial capture releases the rest automatically; usually only one capture per authorization [S1] | Fine. One capture means extras must stay a separate charge (as coded) |
| `cancel` | `POST /payment_intents/:id/cancel` | A PI can be canceled in `requires_capture`, `requires_action`, … but not after it has succeeded [S8] | Errors are swallowed after decline and cancellation (`bookings.ts:464,568`). A failed void is invisible |
| `charge` (extras, tip, reauth) | new PI with `confirm=true` and the default `pm_card_visa`, no customer | To charge later without the customer: a Customer plus a saved PaymentMethod (`setup_future_usage=off_session`), then `off_session=true`, `confirm=true`, `customer`, `payment_method`. You also need terms and consent to save the card [S4] | **Blocker.** No customer or saved card exists, so real off-session charges are impossible. Extras happen at completion (customer absent), which is an off-session charge |
| `refund` | `POST /refunds` with `payment_intent`, `amount` | Several partial refunds are allowed up to the charge amount. Refunds can turn `failed` later (`refund.failed`). Fees are not returned. Uncaptured PIs must be canceled, not refunded [S8] | Refund id and status are not persisted. No `refund.failed` handling |
| `transfer` | `POST /transfers` with `amount`, `destination`, metadata | Separate charges and transfers: the platform's balance pays fees, refunds and chargebacks. A transfer fails if it exceeds the available balance, with no automatic retry. Use `source_transaction` to tie it to a charge. Reverse transfers to recover refunds or disputes [S9] | No `source_transaction`. No reversal path. Destination ids are seeded `acct_fake_*`. No onboarding (Account Links, `account.updated` [S13]) |
| webhook | HMAC-SHA256 over `t.payload`, `v1` only, 5-minute tolerance, constant-time compare. Dedupe on `stripe_events.id` in the same transaction | Exactly as documented, including ignoring non-`v1` schemes and the 5-minute library default. Stripe also recommends deduping by `data.object.id` + `type`, because separate Event objects can be sent for the same change. Order is not guaranteed. Return 2xx fast. Sandbox retries 3 times over a few hours, live mode for up to 3 days [S3] | Handles only `charge.dispute.created/updated/closed`. Missing: `payment_intent.canceled` (authorization expired), `payment_intent.payment_failed`, `refund.failed`/`refund.updated`, `charge.dispute.funds_withdrawn/funds_reinstated`, `account.updated`. A duplicate or late close returns 409, which makes Stripe retry |

Dispute object facts [S6]:
- `status` ∈ `warning_needs_response`, `warning_under_review`, `warning_closed`, `needs_response`, `under_review`, `appeal_needs_response`, `appeal_under_review`, `won`, `lost`, `prevented`.
- `payment_intent` is nullable.
- `is_charge_refundable` exists.

TaskNest's mapping:
- It looks up the booking by `payment_intent`, matching only the main or extras PI. **A dispute on a tip PI is recorded and ignored.**
- It always inserts `needs_response`.
- It treats close events only as `won` or `lost`.

---

## 8. What the current UI exposes versus what the API offers

`src/lib/api.ts` wraps 16 calls. The pages call 14 of them; `noShow` is defined but unused.

| API capability | Exposed in UI? | Where / note |
| --- | --- | --- |
| `POST /quote` | yes | `TaskerProfile` (server quote compared with the browser preview; a warning shows on mismatch) |
| `POST /bookings` | yes | `TaskerProfile`. No card entry: `paymentMethod` is never sent |
| accept / decline / start / complete (+extras) | yes | `TaskerDashboard` |
| reschedule | yes (client and tasker) | `MyBookings` `RescheduleDialog`, reused in `TaskerDashboard` |
| cancel (client, tasker) | yes | `MyBookings`, `TaskerDashboard`. The preview is computed in the browser (`lib/preview.ts`), not from `GET cancel-preview` |
| `GET /bookings/:id/cancel-preview` | **no** | the browser domain preview is used instead |
| `POST /bookings/:id/no-show` | **no** | `api.noShow` exists but no page calls it (no "client didn't show" for taskers, no admin tasker no-show) |
| decline by admin | **no** | the console has no decline |
| tip | yes | `MyBookings`. Card only, no card choice |
| review | yes | `MyBookings` |
| refund (client request, 202) | yes | `MyBookings` says it is a request |
| refund requests visible to staff | **no** | requests land only in `audit_log` (`refund_requested`), and no page reads `audit_log` |
| refund (staff) + refund-preview | yes | `Console` (full, partial, goodwill, approver picker, server preview with a browser fallback) |
| `POST /payouts/run` | yes (admin, all taskers) | `Console` Payouts tab. No `taskerId` filter |
| `POST /admin/taskers/:id/status` | partly | `Console` Taskers tab: active and suspended only, not `pending` |
| `POST /admin/disputes/simulate` | partly | `Console`: `won` and `lost` only. No `open`, no `amountCents` |
| `POST /admin/policies` | **no** | the Pricing page only renders the active policy; there is no publish UI |
| `POST /admin/points/grant`, `/admin/test-clock` | no (test hooks) | fine to leave out of the product UI |
| `GET /health` (provider name) | **no** | worth a small "Payments: fake / Stripe test" badge for staff |
| reads: ledger, tasker balance, payouts, strikes, points lots and movements, disputes | yes | `Console` ledger view, `TaskerDashboard`, `Points` |
| reads: `integrity_violations`, `ledger_trial_balance`, `booking_money_summary`, `stripe_events` | **no** | a staff "Money health" panel would make Helix runs easy to inspect |
| sign-up and onboarding (client sign-up, tasker apply/KYC) | **no** | only sign-in with demo accounts. Nothing creates `taskers` rows |
| Stripe card collection, saved cards, 3DS | **no** (no backend support yet) | see section 9 |
| Stripe Connect payout onboarding for taskers | **no** (no backend support yet) | see section 9 |
| booking address, task category, task details | **no** (no schema columns) | `bookings` has only `description` and `location_tz` |

---

## 9. Backend work to make Stripe real (grounded in the docs)

What "use real Stripe" means for TaskNest. These are design proposals only; no edits were made, since the repo is read-only for this workflow.

### 9.1 Client cards (Customer + Payment Element)
- Add `profiles.stripe_customer_id`, and optionally a `payment_methods` cache. Add `bookings.stripe_payment_method_id` and `bookings.stripe_charge_id`.
- New endpoint, `POST /payments/setup` or similar. It creates or reuses the Customer, plus a CustomerSession with the `payment_element` component enabled (`payment_method_save`, `payment_method_save_usage: off_session`), and returns the client secrets [S4].
- Booking flow:
  - `POST /bookings` creates the PI with `capture_method=manual`, `customer`, `setup_future_usage=off_session` (or `payment_method_options[card][setup_future_usage]`) and `transfer_group`. It returns `client_secret` and a booking in a new pre-auth state.
  - The browser confirms with Stripe.js, which handles 3DS (`requires_action` [S12]).
  - Then either the server confirms on `payment_intent.amount_capturable_updated` [S1], or the client calls `POST /bookings/:id/confirm`. That step posts the hold and marks the booking `requested`.
  - This replaces the hard-coded `pm_card_visa`.
- Compliance: show the save-card terms and record consent, as required by [S4].

### 9.2 Off-session charges (extras, tips, re-auth)
- `charge()` must pass `customer`, the saved `payment_method`, `off_session=true` and `confirm=true` [S4].
- Handle `authentication_required` and other declines. Move the booking to "payment needed", show the client a pay-now action, and retry on-session.
- Tips could instead be on-session, since the client is present in the UI.
- Re-auth: store `capture_before` from the charge [S1] instead of `now + 7d`. Re-check it on reschedule. Note that Visa merchant-initiated (MIT) authorizations last only about 4 days 18 hours, so a re-authorization made off-session for a task several days away can expire before the task.

### 9.3 Connect payouts (taskers)
- Create connected accounts with controller properties. Request the `transfers` capability. Onboard with Account Links (`type=account_onboarding`, `refresh_url`, `return_url`). The links are single-use and expire after a few minutes, and reaching `return_url` does **not** mean onboarding is complete [S13].
- Track `account.updated` and the requirements fields (`currently_due`, `past_due`). Gate `taskers.status=active` and payouts on that state [S13].
- Transfers:
  - Pass `source_transaction=<charge id>` per booking so a transfer can't fail on available balance [S9].
  - Wrap each tasker in a try/catch so one failure doesn't abort the run, and persist `payouts.status='failed'`.
  - Recover refunds and lost disputes after a payout with transfer reversals, or keep today's negative-balance netting [S9].

### 9.4 Webhooks
- Subscribe to the following events and process each idempotently by event id, plus object id + type [S3]:
  - `payment_intent.amount_capturable_updated`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`
  - `charge.refunded`, `refund.updated`, `refund.failed`
  - `charge.dispute.created`, `.updated`, `.closed`, `.funds_withdrawn`, `.funds_reinstated`
  - `account.updated`
- Disputes:
  - Store Stripe's real `status` (widen the CHECK to the 10 values [S6]).
  - Treat `warning_*` inquiries without moving funds.
  - Make `closed` idempotent: return 200 when already in that state.
  - Support lost → won "late win" [S5].
  - Map disputes on tip PIs too.
  - Post funds withdrawn and the $15 fee at open, and reinstate on a win [S5][S7].
- Pin the webhook endpoint's API version to the same version the code sends, and bump `Stripe-Version` from `2024-06-20` to a current release (current: `2026-10-28.endive`) [S10].

### 9.5 Ledger additions
- `processor_fees` per charge, taken from the balance transaction (2.9% + 30¢ domestic [S7]). It is not reversed on refund [S8].
- `dispute_fee` at dispute creation; `dispute_countered_fee` on response, refunded on a win [S5][S7].
- Funds withdrawn and reinstated on disputes.
- Transfer reversals.

### 9.6 API hardening
- Require `Idempotency-Key` on all ✓ routes (`400` if missing).
- Persist provider refund ids and statuses on `refunds`.
- Surface failed authorization voids in `audit_log` instead of swallowing them.
- Align the fake decline token with Stripe's `pm_card_visa_chargeDeclined` [S11], or accept both.
- Use the Stripe test cards for scenario tests:
  - 3DS: `pm_card_threeDSecure2Required`
  - always requires authentication: `pm_card_authenticationRequired`
  - disputes: `pm_card_createDispute`, `pm_card_createDisputeInquiry`, with `winning_evidence` / `losing_evidence`
  - refund failure: `pm_card_refundFail`
  - available balance: `pm_card_bypassPending` [S11]

### 9.7 TaskRabbit UX patterns that touch the backend (patterns only, no copy)
- TaskRabbit charges the card "within 24 hours of your Tasker submitting their invoice", and tips can be added in that same window [T1].
  - TaskNest captures immediately on `complete`. A "tasker submits invoice → client review window → capture" step would match the pattern. That means a new `invoiced` state, plus a scheduled capture before `capture_before`.
- TaskRabbit's late-cancel fee is "one hour of the Tasker's hourly rate plus any Taskrabbit fees" within 24 h of the start [T2].
  - TaskNest's v1 policy charges one hour under 24 h, and refunds 50% between 24 and 48 h. It is policy-driven, so no code change is needed, only a product decision.

---

## 10. Verified findings (code issues and risks)

| ID | Severity | Finding | Evidence |
| --- | --- | --- | --- |
| F1 | High (for real Stripe) | `authorize` and `charge` default to `pm_card_visa`. No Customer or saved PaymentMethod. Extras, tips and re-auth can't run off-session against real cards | `stripe.ts:80,117`; schema has no customer or PM columns; [S4] |
| F2 | High | Webhook dispute handling: `warning_closed` and other non-won/lost closes leave the booking `disputed` forever, which blocks its refunds and its payout. A repeated or late close throws `409 dispute_closed`, so the webhook returns non-2xx and Stripe retries for up to 3 days | `stripe-webhook.ts:81-88`, `disputes.ts:62`; [S3][S5][S6] |
| F3 | High (ledger accuracy) | The dispute fee is posted only on loss, and nothing is posted at open. Stripe debits amount plus fee at open; the received fee is non-refundable and the countered fee comes back only on a win | `disputes.ts:19,66-70`; [S5][S7] |
| F4 | Medium | Processing fees are not modelled, so `card_clearing` and `platform_revenue` won't reconcile to Stripe | `postings.ts`; [S7][S8] |
| F5 | Medium | Idempotency-Key is optional. Without it, provider keys are random per attempt, so retries after a 5xx can double-move money at Stripe | `api/index.ts:320`, `context.ts` `opKey` |
| F6 | Medium | `runPayouts` has no per-tasker error isolation. One failed transfer aborts the run and later taskers are skipped. Transfers have no `source_transaction` | `admin.ts:171-176`; [S9] |
| F7 | Medium | `auth_expires_at = now + validityDays` is assumed rather than read from `capture_before`. Reschedule doesn't re-check authorization validity | `bookings.ts:254`, `reschedule`; [S1] |
| F8 | Low | Failed authorization voids are swallowed (`.catch(() => {})`) | `bookings.ts:321,464,568` |
| F9 | Low | Stale `Stripe-Version 2024-06-20`; webhook payload version not pinned | `stripe.ts:55`; [S10] |
| F10 | Low | Fake decline token `pm_card_chargeDeclined` doesn't match the documented `pm_card_visa_chargeDeclined` | `fake.ts:15`; [S11] |
| F11 | Low | Disputes on tip PIs are never linked to a booking (lookup covers only the main and extras PI) | `stripe-webhook.ts:23-31` |
| F12 | Low | An idempotency row `in_progress` older than 60 s is deleted and re-run, while the lease TTL is also 60 s. A provider call slower than 60 s could overlap with its own retry. Provider keys keep that safe only when the key is deterministic | `api/index.ts:188` |
| F13 | Info | `tips_payable` account is declared but unused. `payouts.status` `pending`/`failed` are never written. `GET /health` has no function-level auth | `ledger.ts`, `admin.ts`, `index.ts` |
| F14 | Info | Client refund requests are write-only (`audit_log`); staff have no queue | `money.ts` `refund`, UI |

Known limitations already listed in `docs/BACKEND_NOTES.md`:
- no wallet balance source
- no points-expiry sweep
- no auto-decline after the tasker response window
- the cancellation-fee refund share is approximate
- tax on cancellation fees
- test hooks only with the fake provider

---

## 11. Tests (what already guards the backend)

- **Unit tests:** `tests/unit/money-core.test.ts` (27) and `domain-fixes.test.ts` (5).
- **API tests:** 29 tests against the local stack with the fake provider:
  - access and RLS (4)
  - money flows (19): booking with points and extras, tier boundaries, reschedule anchor, decline, tasker strikes and suspension, tip cap, partial refunds, agent approval, concurrent refunds, points debt, idempotency replay and reuse, double-booking races, review bonus, policy versioning, payout races and dispute after payout, unsigned webhook, invariants
  - provider and signature (6)
- **Not covered, and needed for real Stripe:** any Stripe test-mode run (CI forces `PAYMENTS_PROVIDER=fake`), inquiry and late-win dispute events, transfer failure, `refund.failed`.

---

## Sources

Stripe (fetched 2026-10-29):
- [S1] Place a hold on a payment method: https://docs.stripe.com/payments/place-a-hold-on-a-payment-method
- [S2] Idempotent requests: https://docs.stripe.com/api/idempotent_requests
- [S3] Receive Stripe events in your webhook endpoint: https://docs.stripe.com/webhooks
- [S4] Save a customer's payment method during payment (Payment Intents): https://docs.stripe.com/payments/save-during-payment?payment-ui=elements
- [S5] How disputes work: https://docs.stripe.com/disputes/how-disputes-work
- [S6] The Dispute object: https://docs.stripe.com/api/disputes/object
- [S7] Stripe pricing (US): https://stripe.com/pricing
- [S8] Refund and cancel payments: https://docs.stripe.com/refunds
- [S9] Create separate charges and transfers: https://docs.stripe.com/connect/separate-charges-and-transfers?platform=web&integration=custom&ui=elements&api-integration=paymentintents
- [S10] API versioning: https://docs.stripe.com/api/versioning
- [S11] Testing (test cards and PaymentMethods): https://docs.stripe.com/testing
- [S12] How Payment Intents and Setup Intents work: https://docs.stripe.com/payments/paymentintents/lifecycle
- [S13] Stripe-hosted onboarding (Account Links): https://docs.stripe.com/connect/hosted-onboarding (plus the overview https://docs.stripe.com/connect/onboarding)

TaskRabbit (patterns only):
- [T1] How Do I Pay My Tasker?: https://support.taskrabbit.com/hc/en-us/articles/204411560-How-Do-I-Pay-My-Tasker
- [T2] My Task was Canceled, Why Was I Charged?: https://support.taskrabbit.com/hc/en-us/articles/46260490101275-My-Task-was-Canceled-Why-Was-I-Charged
