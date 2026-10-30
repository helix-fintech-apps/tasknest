# TaskNest: final build plan (marketplace UI/UX + Stripe)

- **Repo:** `helix-fintech-apps/tasknest` at `65a45d8`. Read-only during planning; nothing was changed.
- **Base design:** the winning proposal, `proposal-marketplace.md`, with every gap the two judges found fixed (§1.2) and the best ideas from `proposal-money-clarity.md` and `proposal-ops-roles.md` added (§1.3).
- **Owner asks (verbatim):** "I need a set of agents to review Task Nest repo and put a full working Ui / ux like task rabbit...read the repo" · "we will need add stripe for payments to task nest" · "use real sripe documentation" · "we will use simulated keys" (OWNER-NOTES.md).
- **Sources:** every Stripe fact comes from docs.stripe.com pages fetched on 2026-10-29 and is cited inline as **[Sx]** (list in §13). TaskRabbit facts come from taskrabbit.com and support.taskrabbit.com, cited as **[Tx]**. TaskRabbit is used for **UX patterns only**. TaskNest keeps its own name, logo (the "Nest" mark), Dusk/Yolk/Twig palette, illustrations and wording. No TaskRabbit brand, logo, illustration, program name or copy is used.
- **Who executes it:** 7 builders working in parallel in separate git worktrees. Wave 0 (§3) moves files apart first, so in Waves 1 and 2 every file has exactly one owner.

---

## Contents

0. [How to use this plan](#0-how-to-use-this-plan)
1. [What we are building](#1-what-we-are-building)
2. [Rules every builder follows](#2-rules-every-builder-follows)
3. [Wave 0: split the shared files, freeze the contracts](#3-wave-0-split-the-shared-files-freeze-the-contracts)
4. [Shared contracts (schema, statuses, endpoints, components)](#4-shared-contracts)
5. [Workstreams WS1–WS7](#5-workstreams)
6. [Stripe: objects, flows, version, webhooks, env, test cards, owner setup](#6-stripe)
7. [Money changes (policy v2, ledger, transfers) with a worked example](#7-money-changes)
8. [Test plan and the existing e2e baseline](#8-test-plan-and-the-existing-e2e-baseline)
9. [Integration order](#9-integration-order)
10. [Risks](#10-risks)
11. [Open owner decisions](#11-open-owner-decisions)
12. [Glossary of UI states](#12-glossary-of-ui-states)
13. [Sources](#13-sources)

---

## 0. How to use this plan

- Each builder reads §1–§4, their own workstream in §5, §6 if they touch payments or Connect, and §8–§9.
- **Ownership is strict.**
  - "Owns" means only you edit the file.
  - "Additive only" means you may append (new exports, new rows, new handlers) but must not change or delete existing lines.
  - Anything else needs a note to the owner of that file.
- **Contracts in §4 are frozen at the end of Wave 0.** If you need a contract change, open a PR against `docs/contracts.md` (owned by WS7) and tag the affected owners. Do not change the contract inside your feature PR.
- **Default runtime is simulated.** The `fake` provider runs everything end to end with no keys. Every simulated surface is labelled **Simulated**. Real Stripe test mode switches on only when the owner sets keys (§6.8).

---

## 1. What we are building

### 1.1 Product in one paragraph

TaskNest becomes a TaskRabbit-style marketplace. Booking follows TaskRabbit's documented web order [T3]: pick a category, enter the address and task size, compare taskers with date, time and price filters, pick a time up to 14 days ahead, describe the task, review and pay. The task counts as scheduled once the tasker confirms. Payment is a **card hold** (Stripe manual capture) placed now, or for far-off tasks a **saved card with the hold placed later**; the server picks which. After the job the hold is captured, extras are charged separately on the saved card, and the client rates and then tips, in that order [T7]. Taskers onboard to Stripe Connect (embedded onboarding, or a simulated twin) and get paid by transfers with `source_transaction`, followed by bank payouts. Support staff work in a CRM-style console: a queue with due dates, Booking 360, disputes, refunds with approvals, payouts, reconciliation and simulated test tools. Every amount on screen comes from the server or the shared `@domain` code and carries machine-readable `data-money-*` attributes, so Helix can assert exact cents.

### 1.2 Judge gaps, and how this plan fixes each

| # | Gap (from the judges) | Fix in this plan | Where |
|---|---|---|---|
| G1 | The e2e migration claim was wrong. `review-rating` is never driven by `selectOption`; `booking-duration` is, 5 times, and every booking test runs on `/taskers/:id` | **`/taskers/:id` keeps a direct-booking panel** (the "book this tasker again" path) with a native `<select data-testid="booking-duration">` and every existing quote, points, promo and `book-submit` id. The wizard is a second entry point that shares the same components. After booking, the app navigates to `/bookings` and shows the confirmation in a banner fed by navigation state, so the URL still matches `/\/bookings$/`. Seeded simulated saved cards mean `book-submit` works with no payment step. Result: **zero edits to `e2e/ui.spec.ts` and `e2e/backend.spec.ts`** | §8.2 |
| G2 | The wizard asked for the description before the tasker was chosen; TaskRabbit asks after the time [T3] | Wizard order: **Task (address + size) → Taskers → Time → Details (description) → Review & pay** | WS2 |
| G3 | The 50¢ card minimum was treated as a plain domain fix | **Money policy v2** adds `card.minChargeCents = 50`, `tips.minCents = 50` and an extras rule, each with unit tests and a `/pricing` update. Bookings on v1 keep v1 behaviour. Stripe's USD minimum is 0.50 [S13] | §7.1 |
| G4 | Ledger changes were only referenced (processing fees, dispute fee at open, countered fee, reversals); no reconciliation view | New ledger accounts and postings (§7.2), a `stripe_balance_transactions` table, a `reconciliation_by_booking` view and a Reconciliation console page | WS7, WS6 |
| G5 | Abandoned 3DS (`requires_action`) bookings left the slot, the points and the PaymentIntent hanging | New booking status `pending_payment` with `payment_expires_at = created_at + 30 min`. The `expire-pending-payments` job cancels the PaymentIntent, releases points and promo (`booking_release`) and sets `payment_abandoned` | §4.2, WS4 |
| G6 | Tip refunds weren't addressed (the repo never refunds tips) | Client refund requests and "refundable" figures **exclude tips**. Staff get a separate **Refund tip** action: `POST /bookings/:id/tips/:tipId/refund` refunds the tip PaymentIntent, claws back 100% from the tasker and posts a `tip_refund` txn | WS7, WS6 |
| G7 | No server preview for complete, tip, no-show or reschedule | Side-effect-free previews: `complete-preview`, `tip-preview`, `no-show-preview`, `reschedule-preview`, `payouts/preview`, `policies/validate` | WS7, WS5, WS6 |
| G8 | No rule for splitting a transfer when the tasker's share exceeds the card charge | `planTransfers()` in the domain: per-booking transfers with `source_transaction` up to each charge's remaining amount; any remainder (points or promo funded) comes from the platform's available balance | §7.3 |
| G9 | Connect readiness gated on `charges_enabled`, which a transfers-only account never gets | Gate transfers on `capabilities.transfers = active`, and bank payouts on `payouts_enabled` | WS5 |
| G10 | CustomerSession enabled `payment_method_save`, which hands control of `setup_future_usage` to Stripe's checkbox | CustomerSession enables **only** `payment_method_redisplay` and `payment_method_remove`. The server always sets `setup_future_usage=off_session`, and TaskNest's own consent checkbox is mandatory | §6.2 |
| G11 | Suspended taskers' balances were said to pay out | The plan follows `planPayout`: any non-`active` status blocks payout (`domain/payouts.ts:26`). The UI shows "Payouts paused while your account is suspended" | WS5 |
| G12 | Confirm labels merged capture and the new extras charge, and used the gross total | Every money button shows **what the card is charged now**, from the server preview: "Complete · client card charged $38.38 more" | WS5 |
| G13 | v1 vs v2 Accounts was left undecided | **Decision: v1 Accounts with controller properties** (Express-equivalent), Account Sessions and v1 Account Links. One API surface, all on `2026-10-28.endive`. Reasoning and alternative in §6.5 | §6.5 |
| G14 | Scope too large, and client UX arrived last | Client discovery and booking (WS2) and booking management (WS3) run in Wave 1 against the simulated provider. Chat, availability calendar, help articles and the dispute evidence builder sit behind feature flags and may land in Wave 2 | §9 |
| G15 | The cancel sheet showed the client what the tasker earns | Clients never see tasker net. Taskers see "You'll earn" figures only | WS3 |

### 1.3 Ideas brought in from the other proposals

- **From money-clarity:**
  - **R1–R10 money contract.** Every money action goes Before (server preview) → Confirm → After. The After step shows a `ReconcileBanner`: "Settled as previewed" or a line-by-line diff.
  - **`data-money-*` attributes** on every amount (§4.5): the best Helix hook.
  - **Server previews.** `booking_statement` view.
  - "Released, not refunded" wording for pre-capture cancellations. A `requires_capture` PaymentIntent "can't be refunded directly. You must cancel" [S15].
  - Refund timing copy from Stripe: credit in about 5–10 business days; an ARN can take up to 7 business days; a failed refund can come back up to 30 days later [S15].
  - "Already done earlier" when the API replays an idempotent result (new `Idempotent-Replayed: true` header).
  - Every booking links to its policy version (`/pricing?v=N`).
- **From ops-roles:**
  - Ops **Queue with due dates**: dispute `evidence_details.due_by`, hold `capture_before`, refunds that failed, requests near expiry.
  - **Booking 360**: one timeline of API actions, Stripe events (with `livemode`), ledger txns and audit rows.
  - **Refund approvals queue.** The approver must not be the requester, enforced on the server.
  - Tasker **money pipeline**: Earned → On hold 3 days → Ready → Sent to payout account → Paying out to bank → In your bank. It says "Sent", never "Paid", for transfers.
  - **Reconciliation** page comparing `card_clearing` with Stripe balance transactions.
  - Notification banner only after `details_submitted`, with `onNotificationsChange` driving badges [S11].
  - Dispute workspace using Stripe's status vocabulary and test evidence keywords [S7][S16].
  - On phones, staff can read and respond but cannot take one-shot irreversible actions (dispute submit, policy publish).

---

## 2. Rules every builder follows

1. **Money is integer cents.** No floats. Only `_shared/domain/money.ts` rounds (half-up bps) (`.coderabbit.yaml`).
2. **The UI never computes money.** Amounts come from an API response or an `@domain` helper (via `src/lib/preview.ts`), and are formatted at render time only. A browser preview is allowed only while the server preview loads, and is marked `data-source="browser"`.
3. **Every money write** goes through the `api` Edge Function with an `Idempotency-Key`, inside one `tn_apply` transaction with a balanced ledger txn. Webhook handlers dedupe on the Stripe event id (`stripe_events`).
4. **Policy versioning.** A booking is always evaluated with **its** `policy_version`. New money rules ship as a new `money_policies` version, never as an edit to v1.
5. **Simulated means labelled.** Every fake-provider payment, Connect or payout surface shows a `SimulatedBadge`. Simulated forms accept **only** Stripe's documented test values [S7][S12]. A card number never leaves the browser (§6.6).
6. **Test ids are an API.** Every existing `data-testid` keeps working (§8.2). Every new interactive control gets a `data-testid`.
7. **Privacy.**
   - Other people's names come from `display_names` only. `profiles` is read only for the signed-in user's own row (enforced by an e2e test).
   - A tasker sees a client's first name, and the full address only after accepting.
   - A client never sees tasker net earnings.
8. **Brand.** TaskNest's own name, logo, colours, illustrations and copy. Category icons come from Lucide (ISC licence). Nothing is copied from TaskRabbit.
9. **Accessibility.** WCAG 2.2 AA, checked by axe in Playwright on every route at 390 px and 1280 px, in light and dark.
10. **No secrets in git.** Only `pk_test_` publishable keys may appear in frontend env, and never in source (§6.7).
11. **Required CI job names** (`lint`, `typecheck`, `unit`, `db`, `api`, `e2e`, `build`) are never renamed (docs/CI.md).

---

## 3. Wave 0: split the shared files, freeze the contracts

Two builders run Wave 0 at the same time, in separate worktrees with no file overlap: **WS1-a** (frontend split) and **WS7-a** (backend split + schema contract). **Wave 0 changes no behaviour.** All seven CI jobs must stay green with no test edits. Merge WS7-a first, then WS1-a.

### 3.1 WS7-a: backend split and schema contract

| Change | Detail |
|---|---|
| Route table split | `api/index.ts` keeps auth, idempotency and the dispatcher. Routes move into `api/routes.ts`, which concatenates `api/routes/{booking,actions,money,discovery,jobs,payments,tasker,connect,payouts,support,admin,sim}.ts`. Each file exports `Route[]`; the new ones start empty. Same behaviour |
| Handler split | `handlers/admin.ts`: `runPayouts` moves to `handlers/payouts.ts`. New empty `handlers/{payments,connect,tasker,support,sim,discovery}.ts` |
| Provider split | `provider/stripe.ts` → `provider/stripe/{http.ts, payments.ts, connect.ts, index.ts}`; `provider/fake.ts` → `provider/fake/{payments.ts, connect.ts, scenarios.ts, index.ts}`. `provider/index.ts` re-exports the same names, so `tests/api/provider.test.ts` still passes |
| Provider contract | Write the new `provider/types.ts` interface (§4.4) **with the old methods kept** as deprecated wrappers, so handlers compile unchanged |
| Webhook split | `_shared/stripe-webhook.ts` → `_shared/webhooks/{index.ts (verify, livemode, store, dispatch registry), payments.ts, refunds.ts, disputes.ts, connect.ts}`. Today's dispute handling moves into `disputes.ts` unchanged |
| Jobs scaffold | `api/jobs/index.ts`: registry plus `POST /jobs/:name`, system-only (service key), added to `SYSTEM_ROUTES`. No jobs yet |
| Schema contract migration | `supabase/migrations/20261101000000_marketplace_contract.sql`: every new table, column and enum value in §4.1, with RLS enabled and policies. **No behaviour uses them yet.** `scripts/ci/db_checks.sql` must still pass |
| Contract doc | `docs/contracts.md`: a copy of §4 of this plan, now the single source. Owned by WS7 |

### 3.2 WS1-a: frontend split and harness

| Change | Detail |
|---|---|
| Routes | `src/App.tsx` → shell + `src/routes/index.tsx`, composed from `src/routes/{public,client,tasker,staff}.tsx`. Each exports `<Route>` elements. The current pages are mounted unchanged |
| API client | `src/lib/api.ts` → `src/lib/api/core.ts` (request, `ApiError`, idempotency, retry, `useAction`) plus area modules `src/lib/api/{booking,bookingActions,tasker,admin,payments,connect,support}.ts`. `src/lib/api/index.ts` composes `export const api = {...}` with the same method names. `src/lib/api.ts` stays as a one-line re-export so imports don't change |
| Data reads | `src/lib/data.ts` → `src/lib/data/{discovery,bookings,tasker,console,common}.ts` + `index.ts` re-export |
| UI kit | `src/components/ui.tsx` → `src/components/ui/*.tsx` + `index.ts` re-export (same names) |
| Payment stub | `src/features/payments/PaymentSection.tsx`: a stub with the §4.6 props, rendering nothing. WS4 replaces it |
| Dependencies | **All** new npm dependencies are added now, at exact versions current on the day: `@stripe/stripe-js`, `@stripe/react-stripe-js`, `@stripe/connect-js`, `@stripe/react-connect-js`, `@axe-core/playwright`, `lucide-react`. After Wave 0, `package.json` and the lockfile are frozen; changes need WS1. (`stripe.md` saw `@stripe/stripe-js@10.2.0` and `@stripe/react-stripe-js@7.0.1` on npm on 2026-10-29.) |
| Mock backend | `e2e/mock-backend.ts` keeps its exports (`mockBackend`, `signIn`, `IDS`, `makeDb`). Add `e2e/mocks/registry.ts` (an `extraHandlers` hook called before the default 404) and empty `e2e/mocks/{discovery,bookings,payments,tasker,console}.ts` |
| Playwright | Add a `phone` project (390×844) for new specs only. The existing specs stay on Desktop Chrome via `testMatch` |

---

## 4. Shared contracts

### 4.1 Schema contract (migration `20261101000000_marketplace_contract.sql`)

All money columns are `bigint` cents. Every new table has `enable row level security` and explicit policies.

**Enums and status**

- `booking_status` gains `'pending_payment'` and `'payment_abandoned'`. Add them in a migration of their own, before anything uses them, because Postgres can't use a new enum value inside the transaction that added it (§10 R1).
- `bookings_no_double_slot` is recreated to include `'pending_payment'`, so a slot is held while 3DS completes.

**`bookings` (new columns)**

| Column | Type | Meaning |
|---|---|---|
| `category_slug` | text null | Category the booking came from |
| `address_id` | uuid null → `addresses` | Task address |
| `payment_plan` | text check in (`hold_now`,`save_card_hold_later`,`card_not_needed`) | Chosen by the server at booking |
| `payment_state` | text not null default `'none'` | §4.2 |
| `hold_at` | timestamptz null | When the scheduled hold should be placed |
| `capture_before` | timestamptz null | From `latest_charge.payment_method_details.card.capture_before` [S2]. Replaces the computed `auth_expires_at`, which is kept for v1 rows |
| `stripe_charge_id` | text null | `ch_` of the live hold |
| `stripe_customer_id` | text null | `cus_` |
| `payment_method_id` | text null | `pm_` (or `sim_pm_*`) |
| `setup_intent_id` | text null | `seti_` for `save_card_hold_later` |
| `payment_expires_at` | timestamptz null | `pending_payment` TTL |

**Other changed tables**

- `profiles`: `stripe_customer_id text`, `default_payment_method_id text`. The column grant stays: users can't write these; the API does.
- `taskers`: `bio text`, `avatar_url text`, `skills jsonb default '[]'`, `service_zips text[] default '{}'`, `transfers_capability text`, `payouts_enabled bool default false`, `details_submitted bool default false`, `requirements_due jsonb default '[]'`, `disabled_reason text`, `onboarding_completed_at timestamptz`.
- `refunds`: `provider_refund_id text`, `provider_status text check in (pending,succeeded,failed,canceled,requires_action)`, `failure_reason text`, `payment_intent_id text`.
- `tips`: `stripe_charge_id text`, `refunded_cents bigint not null default 0 check (refunded_cents <= amount_cents)`.
- `disputes`: status check widened to Stripe's values `warning_needs_response, warning_under_review, warning_closed, needs_response, under_review, won, lost, prevented` [S16]. New columns `is_inquiry bool`, `fee_cents bigint`, `countered_fee_cents bigint`, `evidence_due_by timestamptz`, `evidence_submitted_at timestamptz`, `payment_intent_id text`.
- `payouts` (kept; one row per payout run per tasker). Status semantics: `paid` = **transfers created**. The UI label is "Sent to payout account".
- `stripe_events`: `payload jsonb`, `livemode bool`, `api_version text`, `account text`, `scope text check in (platform,connect,simulated)`, `processed_at timestamptz`, `attempts int default 0`, `last_error text`.

**New tables**

| Table | Key columns | RLS |
|---|---|---|
| `payment_intents` | `id` (pi_/sim_pi_), `booking_id`, `kind` (`hold`,`rehold`,`extras`,`tip`,`fee`), `amount_cents`, `status`, `charge_id`, `capture_before`, `created_at` | Staff read. Client reads own booking's rows |
| `card_consents` | `id`, `user_id`, `payment_method_id`, `booking_id null`, `text_version`, `text_sha256`, `created_at` | Own read; API writes |
| `transfers` | `id`, `payout_id`, `booking_id`, `stripe_transfer_id`, `source_transaction null`, `transfer_group`, `amount_cents`, `reversed_cents`, `status` (`pending`,`created`,`failed`,`reversed`) | Tasker own, staff |
| `connected_payouts` | `id` (po_), `tasker_id`, `amount_cents`, `status` (`pending`,`in_transit`,`paid`,`failed`,`canceled`) [S9], `arrival_date`, `failure_code`, `created_at` | Tasker own, staff |
| `stripe_balance_transactions` | `id` (txn_), `source_id`, `booking_id`, `type`, `amount_cents`, `fee_cents`, `net_cents`, `available_on`, `created_at` | Staff |
| `categories` | `slug` pk, `name`, `icon`, `sort`, `active` | Anon read |
| `addresses` | `id`, `user_id`, `label`, `line1`, `line2`, `city`, `state`, `zip`, `tz`, `is_default` | Own CRUD |
| `tasker_availability` | `tasker_id`, `weekday` 0–6, `start_minute`, `end_minute` | Anon read; tasker own write via API |
| `tasker_availability_overrides` | `tasker_id`, `date`, `kind` (`block`,`add`), `start_minute`, `end_minute` | Same |
| `notifications` | `id`, `user_id`, `kind`, `booking_id`, `title`, `body`, `read_at`, `created_at` | Own read and update of `read_at` |
| `messages` | `id`, `booking_id`, `sender_id`, `body` (≤2000), `system bool`, `created_at` | The two parties + staff read; parties insert |
| `support_requests` | `id`, `booking_id`, `requester_id`, `kind` (`no_show`,`work_problem`,`charge_wrong`,`damage_safety`,`refund_request`,`other`), `status` (`open`,`waiting_on_customer`,`resolved`), `assignee_id`, `amount_at_stake_cents`, `due_at`, `resolution_note`, `created_at`, `resolved_at` | Requester own, staff |
| `support_replies` | `id`, `request_id`, `author_id`, `body`, `internal bool`, `created_at` | Requester sees non-internal; staff all |
| `refund_approvals` | `id`, `booking_id`, `requested_by`, `kind`, `amount_cents`, `reason`, `preview jsonb` (frozen), `status` (`pending`,`approved`,`rejected`,`executed`), `decided_by`, `decided_at` | Staff |

**Views** (each created by its owner's migration):

| View | Owner | Notes |
|---|---|---|
| `category_summary` | WS7 | anon; `from_rate_cents` = min active rate |
| `tasker_public_stats` | WS7 | anon; avg rating ×100 integer, review count, completed count. Fixes the ratings bug |
| `public_reviews` | WS7 | anon; no client id, first name only |
| `booking_statement` | WS7 | per-booking money lines from the ledger |
| `tasker_statement` | WS7 | own `tasker_payable` lines |
| `reconciliation_by_booking` | WS7 | ledger `card_clearing` vs Stripe balance transactions |
| `ops_queue` | WS6 | union of due items |

### 4.2 Booking status and payment state

**`booking_status` transitions** (domain `booking.ts`, WS7). New rows are **bold**:

| From | To |
|---|---|
| **`pending_payment`** | `requested`, **`payment_abandoned`** |
| `requested` | `accepted`, `declined`, `canceled_client` |
| everything else | unchanged from today |

**`payment_state`** (WS4 writes it; everyone reads it):

| Value | Meaning | Set by |
|---|---|---|
| `none` | No card involvement yet, or a v1 booking | default |
| `requires_action` | 3DS pending on the initial payment (`pending_payment`) | `POST /bookings` |
| `card_saved` | `save_card_hold_later`: card saved, no hold yet (`hold_at` set) | `POST /bookings`, `setup_intent.succeeded` |
| `hold_active` | Manual-capture PaymentIntent in `requires_capture`; `capture_before` set | booking, hold job, webhook |
| `action_required` | Off-session hold, extras or fee charge declined with `authentication_required` [S5] | jobs, `complete`, webhook |
| `hold_expired` | PaymentIntent `canceled` by expiry before capture [S2] | `payment_intent.canceled` |
| `captured` | Main card amount captured | `complete`, cancel fee, no-show |
| `released` | Hold canceled with no capture | cancel, decline |
| `failed` | Unrecoverable (staff alerted) | jobs |

**Rule for capturing with no live hold.** If a money action needs to take card money (completion, cancellation fee, no-show fee) and there is no live hold (`card_saved`, `hold_expired`), the server charges the saved card **off-session** for exactly that amount. It uses `customer`, `payment_method`, `off_session=true`, `confirm=true` [S3]. On `authentication_required` it sets `action_required` and notifies the client [S5]. The ledger posts the same txn kinds and amounts as a capture would.

### 4.3 Endpoint catalogue (new ★ and changed ◐)

Errors keep the shape `{error:{code,message,details?}}`. Every POST that moves money requires `Idempotency-Key`. A replay returns the stored response plus the `Idempotent-Replayed: true` header (WS7).

| Method + path | Owner | Who | Request → response (shape) |
|---|---|---|---|
| ◐ `POST /quote` | WS7 | client, anon | adds `categorySlug?`, `localStart?`, `tz?` → adds `paymentPlan:{mode:'hold_now'|'save_card_hold_later'|'card_not_needed', holdAt?, cardCents, reason}`, `cardMinimumApplied:boolean`, `responseDeadline` |
| ★ `POST /quote/estimate` | WS7 | anon | `{taskerIds[], minutes}` → `{estimates:[{taskerId,totalCents,policyVersion}]}`. Used by the W2 cards |
| ◐ `POST /bookings` | WS7 (WS4 supplies the payment step) | verified client | adds `categorySlug?`, `addressId?`, `payment?: {kind:'confirmation_token',id} | {kind:'saved_method',paymentMethodId} | {kind:'simulated',token}`, `consent?:{textVersion}`. Legacy `paymentMethod` is still accepted. **No `payment` and no saved default card → `422 payment_method_required`** (the silent `pm_card_visa` fallback is removed; `stripe.md` #2). Response adds `payment:{state, clientSecret?, captureBefore?, holdAt?}` |
| ★ `POST /bookings/:id/payment/confirm` | WS4 | client | after `handleNextAction` → `{booking, payment}`. Moves `pending_payment` → `requested` |
| ★ `POST /bookings/:id/payment/retry` | WS4 | client | `{paymentMethodId?}` → `{clientSecret}` for `stripe.confirmPayment` [S5], or the result |
| ★ `GET /payments/config` | WS4 | any | `{provider:'fake'|'stripe', simulated:boolean, apiVersion}` |
| ★ `POST /payments/customer-session` | WS4 | client | → `{customerSessionClientSecret}`, or `{simulated:true}` |
| ★ `GET /payments/methods` | WS4 | client | → `{methods:[{id,brand,last4,expMonth,expYear,isDefault,usedByUpcoming:number,simulated}]}` |
| ★ `DELETE /payments/methods/:id` | WS4 | client | `409 method_in_use` while it backs an upcoming hold or a scheduled hold |
| ★ `POST /payments/setup-intent` | WS4 | client | `{confirmationTokenId | simulatedToken, consent}` → `{status, clientSecret?, paymentMethodId?}` |
| ★ `POST /bookings/:id/complete-preview` | WS7 | tasker | `{extraMinutes, expensesCents}` → `{extraLaborCents, extraFeeCents, expensesCents, extrasCardCents, captureCardCents, releaseCents, taskerNetDeltaCents, problem?}` |
| ★ `POST /bookings/:id/tip-preview` | WS7 | client | `{amountCents}` → `{capCents, alreadyTippedCents, roomCents, problem?, windowEndsAt}` |
| ★ `GET /bookings/:id/no-show-preview?who=` | WS7 | tasker, admin | → outcome per tender, fee |
| ★ `POST /bookings/:id/reschedule-preview` | WS7 | client, tasker | `{localStart}` → `{slotFree, cancellationAnchor, holdPlanChange?}` |
| ◐ `POST /bookings/:id/complete` | WS7 | tasker | response adds `payment:{extras:{state, clientSecret?}}` |
| ◐ `POST /bookings/:id/tip` | WS7 | client | uses the booking's saved card by default; optional `paymentMethodId`; may return `requires_action` + `clientSecret`. **The body `{amountCents}` alone must still work** (e2e uses `toEqual`) |
| ★ `POST /bookings/:id/tips/:tipId/refund` | WS7 | support, admin | full tip refund + tasker clawback |
| ★ `POST /bookings/:id/report-no-show` | WS7 | client | creates `support_requests` kind `no_show`. No automatic refund (owner decision D7) |
| ★ `GET /taskers/:id/availability?from&days=14&minutes` | WS7 | anon | `{tz, days:[{date, slots:[{start,status:'free'|'taken'|'unavailable'}]}]}`. Never exposes other clients |
| ★ `GET /taskers/availability?category&date&timeOfDay&minutes` | WS7 | anon | first free slot per tasker |
| ★ `POST /jobs/:name` | WS7 (registry) | system | jobs in §5 WS4/WS5/WS7 |
| ★ `GET /tasker/payout-account` | WS5 | tasker | `{state:'not_started'|'in_progress'|'under_review'|'action_needed'|'ready'|'payouts_paused', requirementsDue[], transfersActive, payoutsEnabled, bankLast4?, disabledReason?, simulated}` |
| ★ `POST /tasker/account-session` | WS5 | tasker | `{components:['account_onboarding'|'notification_banner'|'payouts'|'account_management']}` → `{clientSecret}` (a new session on every call [S8]) |
| ★ `POST /tasker/account-link` | WS5 | tasker | hosted fallback → `{url}` |
| ★ `POST /sim/connect/onboarding` | WS5 | tasker (fake only) | accepts only Stripe Connect test values [S12] |
| ★ `POST /taskers/apply`, `POST /tasker/profile`, `PUT /tasker/availability` | WS5 | tasker | profile, rate within admin bounds, rules |
| ◐ `POST /payouts/run` | WS5 | admin, cron | per-tasker isolation; per-booking `transfers` rows (§7.3) |
| ★ `POST /payouts/preview` | WS5 | admin | same plan, no side effects |
| ★ `POST /support/requests`, `POST /support/requests/:id/{assign,reply,resolve}` | WS6 | client, staff | |
| ★ `POST /admin/refund-approvals`, `POST /admin/refund-approvals/:id/{approve,reject}` | WS6 | agent → admin | approver must be an admin **and** not the requester (server check) |
| ★ `POST /admin/disputes/:id/evidence` | WS6 | admin | Stripe mode: one submission only [S17]; fake: sets the outcome from `winning_evidence` / `losing_evidence` |
| ◐ `POST /admin/disputes/simulate` | WS6 | admin (fake) | adds `open`, inquiry statuses and `amountCents` |
| ★ `POST /admin/sim/events` | WS6 | admin (fake) | `{type, bookingId|taskerId, scenario}` → builds a Stripe-shaped event and calls WS4's `processEvent()` (the same path as real webhooks) |
| ★ `POST /admin/stripe-events/:id/replay` | WS6 | admin | re-processes a stored payload |
| ★ `POST /admin/policies/validate` | WS6 | admin | dry run of publish |

### 4.4 Provider interface (`_shared/provider/types.ts`, owned by WS4, defined in Wave 0)

```ts
type PaymentInput =
  | { kind: "confirmation_token"; id: string }          // ctoken_… from stripe.createConfirmationToken
  | { kind: "saved_method"; paymentMethodId: string }   // pm_… on the customer
  | { kind: "simulated"; token: SimToken };             // fake provider only
interface IntentResult { id: string; status: "requires_action"|"requires_capture"|"succeeded"|"canceled"|"requires_payment_method";
  amountCents: number; clientSecret?: string; chargeId?: string; captureBefore?: string; paymentMethodId?: string;
  declineCode?: string; balanceTxn?: BalanceTxn }
interface PaymentsProvider {
  readonly name: "fake" | "stripe";
  ensureCustomer(userId: string, email: string): Promise<{ customerId: string }>;
  customerSession(customerId: string): Promise<{ clientSecret: string } | { simulated: true }>;
  holdOnSession(i: { amountCents; customerId; payment: PaymentInput; bookingId; idempotencyKey }): Promise<IntentResult>;
  setupOnSession(i: { customerId; payment: PaymentInput; idempotencyKey }): Promise<{ status; clientSecret?; paymentMethodId?; setupIntentId }>;
  holdOffSession(i: { amountCents; customerId; paymentMethodId; bookingId; kind: "hold"|"rehold"; idempotencyKey }): Promise<IntentResult>;
  chargeOffSession(i: { amountCents; customerId; paymentMethodId; bookingId; kind: "extras"|"fee"|"capture_fallback"; idempotencyKey }): Promise<IntentResult>;
  chargeOnSession(i: { amountCents; customerId; paymentMethodId; bookingId; kind: "tip"; idempotencyKey }): Promise<IntentResult>;
  retrieveIntent(id: string): Promise<IntentResult>;
  capture(piId: string, amountCents: number, idempotencyKey: string): Promise<IntentResult>;
  cancel(piId: string, idempotencyKey: string): Promise<IntentResult>;          // errors are thrown, never swallowed
  refund(piId: string, amountCents: number, idempotencyKey: string): Promise<{ id; status }>;
  listMethods(customerId: string): Promise<Method[]>; detachMethod(pmId: string): Promise<void>;
  // Connect (implemented in stripe/connect.ts and fake/connect.ts by WS5)
  createConnectedAccount(i: { taskerId; email; idempotencyKey }): Promise<{ accountId }>;
  accountSession(accountId: string, components: ConnectComponent[]): Promise<{ clientSecret }>;
  accountLink(accountId: string, refreshUrl: string, returnUrl: string): Promise<{ url }>;
  retrieveAccount(accountId: string): Promise<AccountStatus>;
  transfer(i: { amountCents; destination; transferGroup; sourceTransaction?; payoutId; bookingId; idempotencyKey }): Promise<{ id }>;
  reverseTransfer(transferId: string, amountCents: number, idempotencyKey: string): Promise<{ id }>;
}
```

The old `authorize`, `charge` and `transfer(TransferInput)` stay as deprecated wrappers until WS7 has moved its handlers over. They are deleted in Wave 2.

### 4.5 Money rendering contract (`src/components/ui/Money.tsx`, WS1)

`<Money cents kind tender? source policyVersion? sign? />` renders:

```html
<span data-money-cents="8350" data-money-kind="card_hold" data-tender="card"
      data-source="server" data-policy-version="2">$83.50</span>
```

- `kind` values: `subtotal, service_fee, tax, total, promo, points, wallet, card_hold, card_charge, card_capture, released, extras, expenses, tip, refund, refund_pending, tasker_net, commission, fee, balance, transfer, bank_payout, dispute_amount, dispute_fee`.
- `source` is `server` | `browser`.
- Existing test ids such as `quote-card` and `booking-total` are put **on** the `<Money>` element, so `toHaveText` keeps working.
- Negative values use `−` with `aria-label="minus"`. All money uses `tabular-nums`.

### 4.6 Component contracts between workstreams

| Component | Owner | Used by | Props / behaviour |
|---|---|---|---|
| `PaymentSection` | WS4 | WS2 (W4, direct-book panel), WS3 (tip, approval) | `{purpose:'booking'|'tip'|'add_card', plan, amountCents, onChange(state:{ready:boolean, payment?:PaymentInput, consent?:{textVersion}, problem?:string}), testIdPrefix?}`. Shows saved cards first (radio list), "Add a card" mounts the Payment Element or the `SimulatedCardForm`, and includes `CardConsent` and `HoldDisclosure`. **Ava's and Ben's seeded simulated card is preselected**, with its consent already on file |
| `useConfirmPayment()` | WS4 | WS2, WS3 | handles `payment.state === 'requires_action'`: `stripe.handleNextAction({clientSecret})` or `SimulatedBankCheck`, then `POST /payment/confirm` |
| `PaymentApprovalSheet` | WS4 | WS3 (`/bookings/:id?pay=1`), WS1 (header badge link) | §2.4 of the winner proposal |
| `HoldChip` | WS1 | WS2, WS3, WS5, WS6 | `{state, amountCents, captureBefore?, holdAt?}` → "Hold $83.50 · releases by Nov 9", with a "Hold, not a charge" popover [S2] |
| `ReconcileBanner` | WS1 | WS3, WS5, WS6 | `{preview, result}` → "Settled as previewed" or a diff table |
| `RequirementsList` | WS1 | WS2, WS3, WS5 | lists the reasons a submit button is disabled |
| `MessagesPanel` | WS3 | WS5 (job page) | `{bookingId, role}` |
| `ConnectProvider` | WS5 | WS5 | one `loadConnectAndInitialize` per session [S8]; `logout()` only at sign-out (WS1's `signOut` calls the registered hook) |
| `StatusChip` tone map | WS1 | all | §12 |

---

## 5. Workstreams

Each workstream lists:
- **Owns**: files only it edits
- **Additive only**: shared files it may append to
- **Provides / consumes**: its contract with the others
- **Acceptance**
- **Tests**
- **Stripe docs**: the pages it must read

### WS1: Design system, app shell and harness

**Goal:** the TaskNest brand and component kit, role-aware navigation, accessibility plumbing, and the test harness everyone builds on.

**Owns**
- `src/main.tsx`, `src/App.tsx`, `src/index.css` (Tailwind v4 `@theme` tokens: Dusk/Yolk/Twig ramps, semantic tokens, light and dark; values from the winner proposal §7.2, checked with `tools/contrast.py`)
- `src/routes/index.tsx`
- `src/components/ui/**`: `Button`, `Dialog`, `Sheet`, `Tabs` (URL-synced), `Toast` (renders `data-testid="flash"`; `refund-flash` variant), `Banner`, `DataTable` (always a `<table>`; under `md`, CSS restyles rows as stacked cards, so the `tr` selectors in tests still match), `Money`, `HoldChip`, `StatusChip`, `SimulatedBadge`, `RequirementsList`, `ReconcileBanner`, `Stepper`, `EmptyState`, `Skeleton`, `Avatar`, `RatingStars` (display + radio-group input), `Combobox`, `CountdownChip`, `Field`
- `src/components/shell/**`: `AppHeader`, `BottomTabBar`, `Drawer`, `Footer`, `Logo` (the Nest mark, SVG), `ProviderBadge` (from `GET /health`), `NotificationBell` (reads `notifications`), `SkipLink`, `RouteAnnouncer`
- `src/components/ErrorBoundary.tsx`, `src/pages/NotFound.tsx`
- `src/lib/api/core.ts`, `src/lib/api/index.ts`, `src/lib/auth.tsx`, `src/lib/supabase.ts` (row types for §4.1), `src/lib/format.ts`
- `public/fonts/**` (self-hosted Inter and Bricolage Grotesque, OFL)
- `package.json`, `package-lock.json`, `playwright.config.ts`, `eslint.config.js`, `vite.config.ts`
- `e2e/mock-backend.ts` (core), `e2e/mocks/registry.ts`, `e2e/a11y.spec.ts`, `e2e/shell.spec.ts`
- `e2e/ui.spec.ts` and `e2e/backend.spec.ts`: **frozen**; WS1 is the guardian

**Additive only:** `src/lib/preview.ts` (the others append helpers; WS1 reviews).

**Provides**
- every component in §4.5–§4.6
- `useAction` with idempotency (existing behaviour kept: same key on network errors, 5xx and 409 `busy`)
- the "checking whether this went through" re-read after a money 5xx
- the replay toast "Already done earlier" when `Idempotent-Replayed` is set
- `document.title` "<Page> · TaskNest" and focus moved to the `h1` on navigation

**Navigation**

| Role | Desktop | Phone |
|---|---|---|
| Public | Logo · Services · How it works · Pricing · Help · Become a tasker · Sign in · **Book a task** | Drawer + sticky Book bar |
| Client | Book a task (`nav-taskers` → `/taskers`) · My tasks (`nav-bookings`, Needs-action badge) · Messages · Rewards (`nav-points` → `/rewards`; `/points` redirects) · avatar menu | Bottom tabs: Book · Tasks · Messages · Rewards · Account |
| Tasker | Today (`nav-tasker`) · Jobs · Calendar · Earnings · avatar menu | Bottom tabs |
| Staff | Sidebar (`nav-console`): Queue · Bookings · Disputes · Taskers · Ledger · (admin) Payouts · Policies · Health · Reconciliation · Test tools | Section switcher |

- `nav-pricing`, `current-user`, `sign-out`, `nav-signin` and `main-nav` keep their ids.
- On phone, the bottom tab bar carries the same ids. Only one of the two navs is rendered per breakpoint, so ids stay unique.

**Acceptance**
1. All existing e2e pass unmodified.
2. axe reports 0 violations on every route, at 390 and 1280, light and dark. This fixes the `color-contrast`, `select-name` and `scrollable-region-focusable` failures.
3. No horizontal scroll at 390 px (`scrollWidth == 390`) on every route.
4. Every dialog traps focus, closes on Esc, returns focus, and sets the background `inert`.
5. Route-level code splitting: no chunk over 250 kB gzip.
6. The `ProviderBadge` shows "Payments: Simulated" or "Payments: Stripe test" for staff.
7. 404 page in place of the silent redirect.

**Tests**
- unit: `tests/unit/money-component.test.tsx` (attributes, sign, aria)
- e2e: `e2e/a11y.spec.ts` (axe on every route, both projects), `e2e/shell.spec.ts` (nav per role, titles, focus, toasts, 404, dark mode)

**Stripe docs:** Appearance API [S4] (WS4 maps tokens to Elements `appearance`; no `var()` or `rgba()` in colour variables; inputs at least 16 px on mobile).

### WS2: Client discovery and booking

**Goal:** the TaskRabbit-style front of the marketplace, with booking done end to end on simulated payments.

**Owns**
- `src/routes/public.tsx`
- `src/pages/{Home,Services,Category,Taskers,TaskerProfile,Pricing,SignIn,SignUp,VerifyEmail,ResetPassword,Help,HelpArticle,Safety,BecomeTasker}.tsx`
- `src/features/discovery/**` (`HeroSearch`, `CategoryTabs`, `ProjectCard`, `TaskerCard`, `FilterRail`, `FilterSheet`, `TopTaskers`)
- `src/features/booking/**` (`BookingWizard`, `TaskStep`, `TaskSizePicker`, `AddressField`, `TaskersStep`, `TimeStep` with `DayStrip` and `SlotGrid`, `DetailsStep`, `ReviewStep`, `QuotePanel`, `CancellationSummary`, `DirectBookPanel`, `ConfirmationBanner`)
- `src/content/help/**` (MDX articles with `<PolicyValue path=…/>`)
- `src/lib/api/booking.ts`, `src/lib/data/discovery.ts`
- `e2e/mocks/discovery.ts`, `e2e/discovery.spec.ts`, `e2e/wizard.spec.ts`

**Additive only:** `e2e/mock-backend.ts`, to add `paymentPlan` to the `/quote` mock response.

**Routes and screens**
- `/`: Home with a hero search, category tabs with quick links, project cards "from $X/hr" (a floor, from `category_summary`; never invented), a 3-step how-it-works in TaskNest's own copy, a trust strip, and a stats row **only when real counts exist**. Structure from [T1].
- `/services` and `/services/:category`.
- `/taskers` (signed-in client home; `tasker-list`, `tasker-search`, `tasker-card-<first>`).
  - **The whole `TaskerCard` root is a link**, so `click()` on its centre navigates. The e2e test relies on this.
  - The card shows rating (from `tasker_public_stats`), tasks done, the rate, "Next free" and the server estimate.
- `/taskers/:id`: public profile (`tasker-name`, `tasker-category`, `tasker-rate`, new `tasker-rating`, `tasker-reviews`, `choose-tasker`) **plus `DirectBookPanel`**:
  - native `<select data-testid="booking-duration">` (values in minutes, including `"120"` and `"180"`)
  - `booking-start` (`datetime-local`), `booking-tz`, `booking-description`
  - `QuotePanel` (`quote-panel`, `quote-subtotal`, `quote-service-fee`, `quote-tax`, `quote-total`, `quote-card`, `quote-points`, `quote-promo`, `quote-tenders`, `quote-server-status`, `quote-mismatch`; "Policy v1" text)
  - `promo-input`, `promo-error`, `points-toggle`, `points-input`, `points-error`, `points-available`
  - `PaymentSection`
  - `book-submit`
  - A pending or suspended tasker shows "This tasker isn't taking bookings right now". The form is not rendered.
- `/book/:category` wizard: **Task → Taskers → Time → Details → Review & pay**.
  - State lives in the URL plus a `sessionStorage` draft.
  - Anonymous users can browse up to Review; sign-in or sign-up happens there and the draft survives.
  - Time step: 14-day `DayStrip` [T3] and a `SlotGrid` from `GET /taskers/:id/availability`.
  - Until availability data exists (flag `availability`), the Time step falls back to a validated `datetime-local`.
- **Review & pay:**
  - summary with Edit links, promo and points, `PaymentSection`, hold disclosure, cancellation summary rendered from the policy
  - `QuotePanel` (desktop sticky; phone sticky bottom bar with the breakdown sheet opening **above** the button)
  - `RequirementsList`
  - button label from `paymentPlan`: "Request Tara · hold $83.50" or "Request Tara · save card", always the **card** amount
- **After success:** `navigate('/bookings', {state:{confirmedBookingId, booking, payment}})`. WS3 renders `ConfirmationBanner`, which WS2 owns and WS3 imports: "Request sent to Tara. Tara has until Thu 9:14 AM to confirm" (deadline from the server), a hold chip, View task, Add to calendar (.ics), Book another.
- **Errors:**

  | Error | Handling |
  |---|---|
  | `402` decline | Message mapped from `decline_code` |
  | `409 slot_taken` | Back to Time with the slot refreshed |
  | `409 tasker_unavailable` | Back to Taskers |
  | `403 unverified` | Verify banner with resend |
  | `422 payment_method_required` | Focus moves to the payment section |
  | `422 rule_violation` | Shown at the field |
- `/pricing`: restyle only; keeps every `pricing-*`, `curve-*`, `policy-version` and `fee-client`, `example-total`, `tips-*`, `points-min`, `refund-order` id. Adds anchors (`#holds`, `#refunds`, …), a **Card holds** section, `?v=N` to view an older version, and v2's minimum-charge text. In the wizard it opens in a side sheet.
- `/signup` (role toggle; Supabase `signUp`), `/verify-email`, `/reset-password`, `/help`, `/safety`, `/become-a-tasker`. The demo accounts panel (`demo-accounts`, `demo-<name>`) sits under "Test accounts · Simulated environment".

**Provides:** `ConfirmationBanner`, `TaskerCard` (WS6 reuses the compact variant).
**Consumes:** `PaymentSection`, `useConfirmPayment` (WS4); quote, availability and estimate endpoints (WS7); UI kit (WS1).

**Acceptance**
1. Anonymous → category → address + size → taskers filtered by date, time of day and price → time → details → sign up → simulated 4242 card → booking `requested` → banner on `/bookings`. Works in fake mode with no keys.
2. The same flow with `4000 0084 0000 0027` shows the simulated 3DS dialog. Approve → `requested`; Fail → `payment_abandoned` with points released.
3. Decline cards show their mapped messages and keep promo and points intact.
4. All existing booking e2e pass unmodified.
5. A tasker card with no reviews says "New on TaskNest", never "0 ★".
6. No money arithmetic in `src/features/booking` (ESLint rule `no-restricted-syntax` against `*` and `/` on identifiers ending in `Cents`; WS1 adds the rule).

**Tests**
- e2e mock: `wizard.spec.ts` (happy path, 3DS approve and fail, each decline card, slot taken, anonymous gate, phone sticky bar, back-button draft restore); `discovery.spec.ts` (home tabs, filters, sort, empty states, profile reviews visible to anon)
- api: covered by WS7

**Stripe docs:** [S1] (deferred intent, ConfirmationToken, `handleNextAction`), [S2] (hold copy), [S13] (minimum), [S14] (Stripe.js on every page).

### WS3: Client bookings management, messages and account

**Goal:** everything after booking, for the client.

**Owns**
- `src/routes/client.tsx`
- `src/pages/{MyBookings,BookingDetail,Messages,Rewards,SupportRequests}.tsx`, `src/pages/account/{Profile,Addresses,Notifications,Security}.tsx`
- `src/features/bookings/**` (`BookingCard`, `StatusTimeline`, `MoneyPanel`, `Receipt`, `CancelSheet`, `RescheduleSheet`, `RateAndTipSheet`, `RefundRequestSheet`, `GetHelpSheet`, `NoShowReport`)
- `src/features/messages/**`
- `src/features/account/**` (not payment methods)
- `src/lib/api/bookingActions.ts`, `src/lib/data/bookings.ts`
- `e2e/mocks/bookings.ts`, `e2e/bookings.spec.ts`
- Existing `src/pages/MyBookings.tsx` and `src/pages/Points.tsx` (moved)

**Screens**
- **`/bookings`:** tabs **Needs action** (payment approval, rate & tip, expired requests), **Upcoming**, **Past**, as URL-synced tabs.
  - **Default tab rule (e2e safety):** while any booking used by the current test fixtures is visible, the default tab shows **all** active and recent bookings ("All" chip selected). The e2e tests click cards by `data-booking-id` without choosing tabs.
  - `BookingCard` (`booking-card[data-booking-id]`) keeps **visible** buttons `cancel-open`, `reschedule-open`, `tip-open`, `review-open`, `refund-open` when allowed, plus `booking-total` and `booking-tenders`. `booking-dispute` text stays exactly "Card dispute under review · $103.50", with `data-dispute-status`. `refund-open` is hidden while a dispute is open.
  - `ConfirmationBanner` from navigation state.
- **`/bookings/:id`:**
  - header, `StatusTimeline`, tasker panel (Message, View profile)
  - `MoneyPanel` (`money-panel`): hold chip, or after capture a `Receipt` with captured, extras, released, tips and refund rows with Stripe-sourced status (Pending at bank / Succeeded / Failed)
  - actions; messages; policy link `/pricing?v=N`
- **Sheets.** The ids `cancel-*`, `reschedule-*`, `tip-*`, `review-*`, `refund-*` and `flash` are kept.
  - **Cancel:** loads `GET cancel-preview` first. The browser preview shows only while loading (`data-source`). It leads with the refund amount and the tier sentence, and labels pre-capture amounts **"Released"**, never "Refunded" [S15]. No tasker earnings are shown (G15).
  - **Reschedule:** `reschedule-input` prefilled with the current start (the e2e test confirms without editing), slot grid when available, and the note "Your cancellation terms stay tied to the original time …" via `reschedule-preview`.
  - **Rate & tip:** stars first (`review-rating` is a radio group), then review, then tip [T7].
    - Tip presets `tip-preset-10|15|20` come from `tip-preview`.
    - `tip-input`, `tip-room`, `tip-error` and `tip-confirm` behave exactly as today. The error strings are kept verbatim: "Tip can't be more than $22.50 (25% of the $90.00 task subtotal)".
    - The body stays `{amountCents}`. A different card adds `paymentMethodId`.
  - **Refund request:** the copy says it is a **request** (202). "Refundable" **excludes tips** (G6).
  - **Get help** (`support_requests`) and **My tasker didn't show** (after `start_at` + 15 min).
- `?pay=1` opens WS4's `PaymentApprovalSheet`.
- **Messages** (flag `chat`): thread per booking, Supabase Realtime, 2000-char limit, and a soft warning when a phone number or email is typed: "Keep payments on TaskNest so you're covered by our refund policy" (pattern from [T6]).
- **`/rewards`**: `points-available`, `points-lots`, `points-history`.
- **`/account/*`**: profile, addresses (CRUD under RLS), notification toggles, security. Payment methods is WS4.

**Consumes:** WS7 previews and actions, WS4 approval sheet, WS6 support endpoints, WS1 kit.
**Provides:** `MessagesPanel`.

**Acceptance**
1. Every existing cancellation, tip, refund-request, idempotency, dispute and names e2e passes unmodified.
2. Cancel uses the server preview, and after confirm a `ReconcileBanner` says "Settled as previewed".
3. A refund that fails (simulated `refund.failed`) shows "Refund failed. Our team has been alerted" to the client and appears in the staff queue.
4. Payment-approval recovery works with simulated `4000 0027 6000 3184` (always authenticate).

**Tests**
- e2e mock `bookings.spec.ts`: server cancel preview, reschedule preview anchor, rate-then-tip order, tip presets, refund request excludes tip, support request, no-show report, payment approval, messages, phone layouts
- unit: none (no money logic in UI)

**Stripe docs:** [S15] (refund timing and statuses, cancel vs refund), [S5] (`authentication_required` recovery).

### WS4: Stripe payments (checkout UI + provider + webhooks + payment jobs)

**Goal:** correct, documented Stripe payments, plus a deterministic simulated twin that behaves the same way.

**Owns**
- **Client:** `src/features/payments/**` (`PaymentSection`, `StripePaymentElement`, `SimulatedCardForm`, `simulatedCards.ts`, `SimulatedBankCheck`, `CardConsent` with text version `card-consent-v1`, `HoldDisclosure`, `PaymentApprovalSheet`, `SavedCardsList`, `stripeLoader.ts`, `appearance.ts`, `useConfirmPayment.ts`), `src/pages/account/PaymentMethods.tsx`, `src/lib/api/payments.ts`
- **Provider:** `supabase/functions/_shared/provider/**` except `stripe/connect.ts` and `fake/connect.ts`
- **Webhooks:** `_shared/webhooks/{index,payments,refunds,disputes}.ts`, `supabase/functions/stripe-webhook/index.ts`
- **API:** `api/handlers/payments.ts`, `api/routes/payments.ts`
- **Jobs:** `api/jobs/{expirePendingPayments,placeScheduledHolds,processStripeEvents,reconcilePaymentObjects}.ts`
- **Migrations:** `supabase/migrations/202611010002xx_*.sql`
- **CI:** `scripts/ci/check-live-keys.sh`, `.github/workflows/deploy-staging.yml` (additive: new secrets; job ids unchanged)
- **Tests:** `tests/api/{provider,payments,webhooks}.test.ts`, `tests/unit/{simulated-cards,stripe-encode,webhook-verify}.test.ts`, `e2e/mocks/payments.ts`, `e2e/payments.spec.ts`, `e2e/stripe/*.spec.ts`
- **Docs:** `docs/api/payments.md`

**Additive only:** `supabase/seed.sql` (each seeded client gets `default_payment_method_id='sim_pm_success'` and a `card_consents` row, **fake mode only**), `e2e/mock-backend.ts`.

**Server behaviour**
1. **Version and transport.**
   - `Stripe-Version: 2026-10-28.endive` on every request [S18].
   - Replace `payment_method_types[]` with `allowed_payment_method_types[]=card`; Endive removed `payment_method_types` with a 400 `payment_method_types_no_longer_supported` [S19].
   - Fix `formEncode` for deep nesting and `expand[]`.
   - Map errors: 402 card error → 402; 400 invalid request → 4xx final; 409 idempotency → 409; 429, 5xx and network → retryable (`stripe.md` #21).
   - Assert `livemode === false` on every response.
   - Accept `rk_test_` as well as `sk_test_` in `selectProvider` auto mode; refuse `*_live_`.
2. **Booking payment** (called from WS7's `createBooking`):
   - `ensureCustomer`.
   - `paymentPlan.mode` → `holdOnSession` (manual capture, `setup_future_usage=off_session`, `confirmation_token`, `customer`, `transfer_group=booking:<id>`, `metadata[booking_id]`, `expand[]=latest_charge`), or `setupOnSession` (SetupIntent `usage=off_session`).
   - Store `capture_before` from `latest_charge.payment_method_details.card.capture_before` [S2].
   - `requires_action` → `pending_payment` + `clientSecret`.
   - Any other failure → cancel the PaymentIntent (errors logged and queued, never swallowed; `stripe.md` #23), and WS7 rolls back points.
   - Record `card_consents`.
3. **Off-session:** `holdOffSession`, `chargeOffSession` with `off_session=true`, `confirm=true`, `customer`, `payment_method` [S3]. A decline with `authentication_required` → `action_required` + notification; `payment/retry` returns the declined PaymentIntent's client secret for `confirmPayment` [S5].
4. **Idempotency keys** for provider calls stay deterministic (`${bookingId}:${kind}:${seq}`). Because Stripe may prune keys after 24 h [S20], the provider id is **persisted in `payment_intents` before commit**, and a retry first looks up an existing PaymentIntent for `(booking, kind, seq)` (`stripe.md` #22).
5. **Webhooks:**
   - verify the signature on the raw body against `STRIPE_WEBHOOK_SECRET` or `STRIPE_CONNECT_WEBHOOK_SECRET` (record which one matched as `scope`)
   - reject `livemode: true`
   - insert into `stripe_events` with the payload, then **ack 2xx immediately** and process in the `process-stripe-events` job [S21]
   - dedupe by event id and by `(data.object.id, type)` [S21]
   - map PaymentIntent → booking through `payment_intents` (fixes disputes on tip and re-hold PaymentIntents; `stripe.md` #16)
   - handlers: §6.4. Connect events are dispatched to WS5's `webhooks/connect.ts`. Dispute money goes to WS7's `_shared/disputes.ts`.
6. **Jobs:**

   | Job | Schedule | What it does |
   |---|---|---|
   | `expire-pending-payments` | every 5 min | G5 |
   | `place-scheduled-holds` | every 15 min | Places holds at `hold_at`, and re-holds when `capture_before < start_at + est + policy.auth.captureBufferHours` |
   | `process-stripe-events` | every minute | Processes stored webhook events |
   | `reconcile-payment-objects` | hourly | Retrieves PaymentIntents and refunds in non-terminal states, because sandbox webhooks are retried only "three times over the course of a few hours" [S21] |
7. **Fake provider:**
   - Deterministic `sim_*` ids. Scenario tokens per §6.6.
   - Simulated `capture_before` = auth time + 7 days (on-session) or + 4 d 18 h (off-session), mirroring [S2].
   - Balance transactions with fee = `FAKE_STRIPE_FEE_BPS` (default 0) + `FAKE_STRIPE_FEE_FIXED_CENTS` (default 0).
   - `FAKE_DECLINE_PM` becomes `pm_card_visa_chargeDeclined` (Stripe's id [S7]); the old value is still accepted as an alias.

**Client behaviour**
- `PaymentSection` per §6.2. Stripe.js loads only in Stripe mode, with `loadStripe` called outside render [S1].
- The Elements `appearance` maps to TaskNest tokens resolved to hex [S4].
- `/account/payment-methods`: list, add (setup mode), remove (blocked while in use).
- `SimulatedCardForm` per §6.6.

**Acceptance**
1. **Fake mode:** every row of the §6.6 table behaves as listed in UI and API.
2. Abandoned 3DS releases the slot, points and promo within 30 min (test clock).
3. `save_card_hold_later` places the hold at `hold_at`.
4. An expired hold leads to an off-session re-hold; with the auth-required card it goes to `action_required` → approval sheet → `hold_active`.
5. A webhook with `livemode:true` is stored as rejected and has no effect.
6. The same event delivered twice is processed once.
7. **Stripe test mode** (owner keys): the §6.6 scenarios pass in `e2e/stripe/*.spec.ts` and `tests/api/stripe-sandbox.test.ts`.
8. `check-live-keys.sh` fails on `pk_live_` in `VITE_STRIPE_PUBLISHABLE_KEY` and on `sk_live_` or `rk_live_`.

**Tests**
- unit: simulated card map (only documented numbers accepted; Luhn-valid non-test numbers rejected), form encoding, signature verify (multiple `v1`, 5-minute tolerance, never 0 [S21])
- api (fake): booking with each scenario token, confirm and retry, pending-payment expiry, scheduled hold, re-hold, `authentication_required` path, webhook dedupe and livemode, refund pending → failed reversal posting (with WS7)
- e2e mock: `payments.spec.ts`
- Stripe sandbox (skipped unless `STRIPE_SECRET_KEY` is a test key and `E2E_STRIPE=1`): Payment Element filled through `frameLocator`, 3DS test challenge, `pm_card_*` server-side cases [S7]

**Stripe docs:** [S1] [S2] [S3] [S5] [S7] [S13] [S14] [S15] [S18] [S19] [S20] [S21] [S22].

### WS5: Connect onboarding, tasker workspace and payouts

**Goal:** the supply side: apply, profile, calendar, jobs, earnings, Connect onboarding (embedded, or simulated), transfers and bank payouts.

**Owns**
- `src/routes/tasker.tsx`
- `src/pages/tasker/{Today,Jobs,JobDetail,Calendar,Earnings,PayoutSetup,Profile,Apply}.tsx` (existing `TaskerDashboard.tsx` moves into `Today`)
- `src/features/tasker/**` (`InvitationCard`, `CompleteSheet`, `TaskerCancelSheet`, `ClientNoShow`, `EarningsPipeline`, `Statement`, `TransfersTable`, `BankPayouts`, `StrikesTable`, `WeekRulesGrid`, `DateOverrides`)
- `src/features/connect/**` (`ConnectProvider`, `EmbeddedOnboarding`, `SimulatedOnboarding`, `PayoutStatusCard`, `NotificationBannerSlot`, `EmbeddedPayouts`)
- `src/lib/api/{tasker,connect}.ts`
- `api/handlers/{tasker,connect,payouts}.ts`, `api/routes/{tasker,connect,payouts}.ts`
- `_shared/provider/stripe/connect.ts`, `_shared/provider/fake/connect.ts`, `_shared/webhooks/connect.ts`
- `supabase/migrations/202611010003xx_*.sql`
- `tests/api/{connect,payouts,tasker}.test.ts`, `e2e/mocks/tasker.ts`, `e2e/tasker.spec.ts`, `docs/api/connect.md`

**Screens**
- **`/tasker` (Today).** The e2e test lands here and expects these, so they stay on this page:
  - `tasker-balance` (from `tasker_balances`; $76.50 in the mock)
  - `tasker-status-banner`
  - `job-card[data-booking-id]` for requests, today and in-progress jobs, with `accept`, `decline`, `start`, `complete-open`
  - a **Recent jobs** `DataTable` `tasker-history` whose rows are `tr[data-booking-id]` containing `booking-dispute`
  - `InvitationCard` with a `CountdownChip` to `created_at + taskerResponseHours`. When expired it shows "Expired" and hides the actions (pattern [B3])
  - setup banners in priority order: pending review → payout account not ready → Stripe notification banner (only after `details_submitted` [S11]) → strikes or suspension
- **Complete sheet:** `complete-extra-minutes` (an `<input type=number step=15>` that accepts `fill("30")`), `complete-expenses`, `complete-extra-labor`, `complete-expense-amount`, `complete-preview` (from WS7 `complete-preview`), `complete-confirm`. The confirm label is "Complete · client card charged $38.38 more" (G12). If extras would be 1–49¢ under policy v2, the sheet shows the domain message.
- **Job page** `/tasker/jobs/:id`: timeline, client first name, address after accept, `MessagesPanel`, client no-show (after `start_at`; uses `no-show-preview`), tasker cancel with a strike warning, reschedule. "Client payment pending: you can still start; we'll collect it" when `action_required` (D5).
- **Calendar** (flag `availability`): weekly rules plus date overrides, up to 14 days visible to clients [T3].
- **Earnings:**
  - `EarningsPipeline`: Earned → On hold until <date> (`payouts.holdDays`) → Ready → **Sent** to payout account (`transfers`) → Paying out to bank (`connected_payouts.in_transit`) → In your bank (`paid`; "typically … 1-2 business days after submission" for standard payouts [S9])
  - `Statement` from `tasker_statement`; `tasker-payouts` (transfers), `BankPayouts`, `tasker-strikes-table`
  - Suspended → "Payouts paused while your account is suspended" (G11)
  - `payout.failed` → "Update bank account": "When a payout fails, the external account involved is disabled" [S9]
- **Payout setup** `/tasker/payouts/setup`: `PayoutStatusCard` (state from `GET /tasker/payout-account`). Stripe mode renders `<ConnectAccountOnboarding onExit={refetch}>` [S23]; fake mode renders `SimulatedOnboarding`.
- **Apply** wizard: profile → category & rate → availability → payout account → review → `taskers.status = pending`. **Profile** has a live `TaskerCard` preview.

**Server behaviour**
- `createConnectedAccount`: v1 `POST /v1/accounts` with `controller[stripe_dashboard][type]=express`, `controller[fees][payer]=application`, `controller[losses][payments]=application`, `capabilities[transfers][requested]=true`, `country=US`, `email` [S24]. Idempotent per tasker.
- `accountSession`: `components[account_onboarding][enabled]=true`, plus `notification_banner`, `payouts` (features: `standard_payouts` off, `instant_payouts` off, `edit_payout_schedule` off, `external_account_collection` on [S25]) and `account_management`. Return the client secret; a new session every call [S8].
- Status: `retrieveAccount` + `account.updated` (Connect scope) → `details_submitted`, `payouts_enabled`, `capabilities.transfers`, `requirements.currently_due`/`past_due`, `disabled_reason`. **Ready = `transfers` active** (G9). Bank payouts additionally need `payouts_enabled`.
- `payouts/run`:
  - `planPayout` (unchanged rules: non-`active` status blocks)
  - `planTransfers` (WS7 domain, §7.3)
  - one `transfers` row per transfer, with `transfer_group=booking:<id>` and `source_transaction=<ch_>` when charge-backed [S26]
  - per-tasker try/catch, so one failure does not stop the run
  - clawbacks are netted, or reversed with `POST /v1/transfers/:id/reversals` only when the connected account's available balance covers it [S26]
- Connect webhooks: `account.updated`, `account.external_account.updated`, `payout.created|updated|paid|failed|canceled` → `connected_payouts`. "Regardless of the Accounts API version … payouts trigger only the v1 events" [S9].
- **Simulated twin.** `SimulatedOnboarding` steps (identity, address, bank, review) accept only:
  - SMS `000-000`, phone `0000000000`
  - ID `000000000` (match) or `111111111` (mismatch → `currently_due`)
  - DOB `1901-01-01`
  - address line 1 `address_full_match` / `address_no_match`
  - routing `110000000` with account `000123456789` (payouts succeed), `000111111116` (`no_account`), `000111111113` (`account_closed`), `000222222227` (`insufficient_funds`) [S12]

  Any other value → "Simulated mode accepts Stripe's Connect test values only." Never a real SSN or bank number.
- **Embedded components rules:**
  - one `loadConnectAndInitialize` per session
  - `logout()` only at sign-out
  - never set `Cross-Origin-Opener-Policy: same-origin` (it "break[s] user authentication")
  - if a CSP is added: `frame-src`/`script-src` `https://connect-js.stripe.com https://js.stripe.com`, `img-src https://*.stripe.com`
  - render our own error UI for failures before `onLoaderStart`
  - authentication popups can't be removed [S8]

**Acceptance**
1. Existing tasker e2e (accept, complete with extras, pending banner, history dispute) pass unmodified.
2. Simulated onboarding success → Ready. The mismatch ID → Action needed. `000111111116` → after a payout run, a simulated `payout.failed` → "Update bank account".
3. A payout run with one failing tasker still pays the others and shows the failure in the result table.
4. Transfer amounts per booking match §7.3 exactly.
5. Stripe test mode: embedded onboarding with the sandbox values reaches `transfers: active`.

**Tests**
- api: apply → activate → onboarding (sim) → complete booking → hold days (test clock) → run → transfers rows with `source_transaction` → simulated `payout.paid` / `failed`; suspended tasker blocked; isolation; reversal vs netting
- e2e mock: `tasker.spec.ts` (Today, countdown expiry, complete preview label, earnings pipeline, simulated onboarding paths, calendar)
- Stripe sandbox: account create + session (no UI automation of Stripe-hosted steps)

**Stripe docs:** [S8] [S9] [S11] [S12] [S23] [S24] [S25] [S26] [S27].

### WS6: Support and admin console (CRM-style tables)

**Goal:** staff tools to run the marketplace and test money edge cases.

**Owns**
- `src/routes/staff.tsx`
- `src/pages/console/{Queue,Bookings,Booking360,Disputes,DisputeDetail,Taskers,TaskerDetail,Ledger,Payouts,Policies,Health,Reconciliation,Approvals,TestTools}.tsx` (existing `Console.tsx` is split into these)
- `src/features/console/**`, `src/lib/api/admin.ts`, `src/lib/api/support.ts`, `src/lib/data/console.ts`
- `api/handlers/{admin,support,sim}.ts`, `api/routes/{admin,support,sim}.ts`
- `supabase/migrations/202611010004xx_*.sql` (views `ops_queue` etc.)
- `tests/api/{support,console}.test.ts`, `e2e/mocks/console.ts`, `e2e/console.spec.ts`, `docs/api/console.md`

**Screens** (all lists are `DataTable` with cursor pagination, filters in the URL, names instead of UUID prefixes, IDs in mono with copy buttons, and rows that are links)

- **`/console`** = **Bookings list** (`console-bookings`, `console-search`, `console-search-submit`, `console-status` (labelled), `console-booking-row[data-booking-id]`). The e2e test clicks a row right after landing.
  - Total column = card incl. extras from `booking_statement`.
  - Clicking a row opens Booking 360 inline on desktop (`console-booking-detail`), which keeps the refund panel ids: `console-refund-kind|amount|reason|approver|preview|checking|fallback|error|submit|clawback|platform`, `refund-flash`.
  - **Approver flow:** the existing select (`console-refund-approver`) stays and the API keeps accepting `approvedBy` (tests). The server now rejects `approvedBy == actor` and non-admin approvers. New default UI path: **"Send for approval"** → `refund_approvals` (frozen preview); an admin approves on `/console/approvals`, seeing the frozen preview next to a fresh one.
  - **Refund tip** action (G6). Admin-only Decline request, Tasker no-show, Simulate dispute.
- **`/console/queue`:** `ops_queue` sorted by `due_at`:
  - support requests
  - client refund requests
  - disputes needing response (`evidence_due_by`)
  - holds near `capture_before`
  - `action_required` older than 24 h
  - failed refunds
  - failed payouts

  Actions: Assign to me, Reply, Resolve.
- **Booking 360:** money panel, tenders, Stripe ids (`pi_`, `ch_`, `re_`, `tr_`, with test-Dashboard links in Stripe mode), payment state, and a unified timeline of audit rows, `stripe_events` (type, `livemode`, scope), ledger txns, messages (read-only) and the `ReconcileBanner` for each money action.
- **Disputes:**
  - The 10 statuses with labels.
  - Money effects: amount + fee debited at open; "You can't issue a refund outside the dispute process while the dispute is open"; response window "usually 7-21 days"; decision "usually 60-75 days"; inquiries close after 120 days; the countered fee is returned on a win; the received fee is not; late wins can happen [S16].
  - Evidence form: text (`uncategorized_text`) + file list. One submission only [S17]. In fake or Stripe test mode the hint is "type `winning_evidence` or `losing_evidence`" [S7].
- **Taskers:** status (Activate, Suspend, Set pending; `tasker-activate`, `tasker-suspend`, `tasker-status-reason`), payout account state, strikes, balance, statement, Run payout for this tasker.
- **Ledger:** `ledger-txns`, `ledger-txn`, `ledger-totals`, `ledger-booking`, with filters.
- **Payouts:** `payout-run`, preview first, `payout-result` as a table.
- **Policies:** versions, view, new version with validate → diff → publish (desktop only).
- **Health:** `integrity_violations`, trial balance, unbalanced txns, points integrity, webhook log (with replay).
- **Reconciliation:** `reconciliation_by_booking`, with known-gap banners (fake mode fee knob is 0; dispute fee timing).
- **Test tools** (fake only, every control Simulated): dispute simulate (`dispute-won`, `dispute-lost`, `dispute-open`), points grant, test clock, **Run job** (each job in §5 WS4/WS5/WS7), **Send simulated event** (`payment_intent.payment_failed` with `authentication_required`, `payment_intent.canceled`, `refund.failed`, `refund.updated` succeeded, `account.updated` requirements due, `payout.paid`, `payout.failed`, `charge.dispute.created` / `closed`).

**Acceptance**
1. Existing console e2e (agent approver, refund preview server and fallback) pass unmodified.
2. An agent cannot approve their own refund (API 403 `approver_is_requester`).
3. Each simulated event changes the right booking or tasker state through WS4's `processEvent` and appears in Booking 360.
4. Reconciliation shows zero drift in fake mode after the money-flows suite.
5. On phones, staff can read and reply, and Publish / Submit evidence are hidden with "Use a larger screen for this action".

**Tests:** api `support.test.ts` (requests lifecycle, approvals, tip refund auth), `console.test.ts` (sim events end to end); e2e `console.spec.ts`.

**Stripe docs:** [S7] [S15] [S16] [S17] [S21].

### WS7: Backend core (domain v2, schema, previews, availability, jobs, docs)

**Goal:** the money rules and core API that everyone else builds on.

**Owns**
- `supabase/functions/_shared/domain/**` (new: `availability.ts`, `paymentPlan.ts`, `transfers.ts`)
- `_shared/{postings,disputes,figures,points-store,db,http}.ts`
- `api/index.ts`, `api/context.ts`, `api/routes.ts`, `api/routes/{booking,actions,money,discovery,jobs}.ts`
- `api/handlers/{bookings,money,discovery}.ts`, `api/jobs/{index,autoDecline}.ts`, `api/test-clock.ts`
- `supabase/migrations/20261101000000_marketplace_contract.sql` and `202611010001xx_*.sql` (policy v2 seed, views, `pg_cron` schedules)
- `supabase/seed.sql` (core rows; WS4 adds payment rows additively)
- `scripts/ci/db_checks.sql`
- `tests/unit/**` (except WS4's files), `tests/api/{helpers,money-flows,access}.ts`, new `tests/api/{money-v2,previews,availability,discovery,jobs}.test.ts`
- `docs/API.md` (index linking `docs/api/*.md`), `docs/BACKEND_NOTES.md`, `docs/SPEC.md`, `docs/contracts.md`

**Work**
1. **Policy v2** (§7.1): domain changes in `tender.ts`, `tips.ts`, `pricing.ts` (extras), `paymentPlan.ts`; config types; `/pricing` data via the existing policy row. Seed v2 with `effective_from = now()` at migration time.
2. **createBooking:** `pending_payment` path, `paymentPlan`, address and category, availability check (`409 tasker_unavailable_at_time`), card-minimum enforcement, consent pass-through to WS4, legacy `paymentMethod` support. **No silent fallback.**
3. **The rule for capturing with no live hold** (§4.2) in `complete`, `cancel` and `no-show`.
4. **Previews:** `complete-`, `tip-`, `no-show-`, `reschedule-preview`, `quote/estimate`, all side-effect free and reusing the domain functions.
5. **Ledger** (§7.2): `stripe_fees` and `dispute_fees` accounts; dispute postings at open, countered, won, lost; `refund_failed` reversal; `tip_refund`; fee lines from balance transactions; `transfer_reversal`. **Update the integrity views** for `pending_payment` and `payment_abandoned` (open vs finished booking invariants 5 and 6).
6. **Availability:** `domain/availability.ts` (rules − overrides − active bookings), endpoints.
7. **Discovery views** and categories seed (matching seeded taskers: Handyman, Cleaning, Moving, plus empty "Coming soon" categories).
8. **Jobs:** `auto-decline-requests` (fixes the BACKEND_NOTES gap), registry, `pg_cron` + `pg_net` schedules calling `POST /jobs/:name` with a service key stored in Supabase Vault (owner step §6.8). Locally and in fake mode, jobs run from Test tools.
9. `Idempotent-Replayed: true` header on replays. **Notifications** inserted inside `tn_apply` as a whitelisted non-money op.
10. **Tip refund** endpoint and posting.

**Acceptance**
1. `tests/unit` covers every v2 rule at boundaries: card 0, 1, 49, 50, 51; points minimum; promo-only bookings; tips at 49, 50 and the cap; extras below minimum.
2. **`tests/api/money-flows.test.ts` passes with exactly one listed edit** (§8.3). Ledger amounts in all other assertions are unchanged.
3. `select * from integrity_violations` returns no rows after the full api suite.
4. `scripts/ci/db_checks.sql` passes (RLS on all new tables, bigint money, triggers intact).
5. All previews match the actual action results exactly (property test: preview, then act, then compare).

**Tests:** unit (domain v2, `planTransfers`, `paymentPlan`, availability); api (`money-v2`, `previews`, `availability`, `discovery`, `jobs` with test clock).

**Stripe docs:** [S2] (hold windows behind `paymentPlan`), [S13] (minimum), [S15] (refunds), [S16] (dispute money), [S26] (transfers), [S20] (idempotency).

---

## 6. Stripe

### 6.1 API version and libraries

- **Pin `Stripe-Version: 2026-10-28.endive` on every server request.** "The current version is 2026-10-28.endive." Requests without the header use the account default, and "Webhook events also use your account's default API version unless you set an API version during endpoint creation" [S18].
- Endive breaking changes that hit this repo:
  - `payment_method_types` is removed from PaymentIntents and SetupIntents (400 `payment_method_types_no_longer_supported`). Use `allowed_payment_method_types` or dynamic payment methods [S19].
  - Elements `paymentMethodTypes` is removed (use `allowedPaymentMethodTypes`) [S19].
  - v2 Account Links lost `configurations` [S28]. Not used here, because we use v1.
- **Server transport:** keep the repo's raw `fetch` (Deno) with the pinned header. No SDK, so there is no SDK-version-to-API-version coupling.
- **Browser:**
  - `@stripe/stripe-js` + `@stripe/react-stripe-js` (Stripe.js loads from js.stripe.com: "Don't include the script in a bundle or host a copy of it yourself"; endive script `https://js.stripe.com/endive/stripe.js`) [S1]
  - `@stripe/connect-js` + `@stripe/react-connect-js` [S8]
  - exact versions pinned in Wave 0

### 6.2 Objects and flows

| Flow | Stripe objects and parameters | Source |
|---|---|---|
| Client identity | v1 **Customer** per client (`profiles.stripe_customer_id`). Stripe also documents customer-configured v2 Accounts as an alternative; v1 keeps one API surface (§11 D9) | [S1] |
| Show and remove saved cards in the Element | **CustomerSession** `components.payment_element.enabled=true`, `features.payment_method_redisplay=enabled`, `features.payment_method_remove=enabled`. **Not** `payment_method_save` and **not** `payment_method_save_usage`: "If you intend to specify `setup_future_usage`, don't set `payment_method_save_usage` in the same payment transaction because `setup_future_usage` controls the save behavior", and with `payment_method_save` "Stripe.js automatically controls setting setup_future_usage … depending on whether the customer checked the box" | [S1] |
| Hold now (`hold_now`) | Elements `{mode:'payment', amount:<card cents>, currency:'usd', captureMethod:'manual', setupFutureUsage:'off_session', allowedPaymentMethodTypes:['card'], customerSessionClientSecret, appearance}` → `elements.submit()` → `stripe.createConfirmationToken({elements})` → server `POST /v1/payment_intents` `amount, currency=usd, capture_method=manual, confirm=true, confirmation_token, customer, setup_future_usage=off_session, allowed_payment_method_types[]=card, transfer_group, metadata[booking_id], expand[]=latest_charge`. The options must match: "Make sure the Elements options you provide (such as captureMethod, setupFutureUsage …) match the equivalent parameters you pass when creating and confirming the Intent." The ConfirmationToken "expires after 12 hours". `requires_action` → `stripe.handleNextAction({clientSecret})` | [S1] |
| Amount changes (promo, points) | Re-render the Elements provider with the new `amount` from `POST /quote` (deferred flow: `elements.update`) | [S1] |
| Save card, hold later (`save_card_hold_later`, or `card_not_needed` with card = $0) | Elements `{mode:'setup', currency:'usd', …}` → ConfirmationToken → server **SetupIntent** `usage=off_session, confirm=true, confirmation_token, customer, allowed_payment_method_types[]=card`. The builder confirms that every Elements setup-mode option matches the SetupIntent, per the matching rule | [S1][S3] |
| Hold windows | CIT 7 days; Visa MIT "5 days*", exactly "4 days and 18 hours"; classification "based on signals … not solely on API parameters like off_session". Expiry: "the funds are released and the payment status changes to `canceled`". Deadline: `payment_method_details.card.capture_before`. `paymentPlan` (policy v2): `hold_now` if the start is ≤ 96 h away, otherwise hold at start − 48 h | [S2] |
| Off-session hold, extras, fees | `POST /v1/payment_intents` `customer, payment_method, off_session=true, confirm=true` (+ `capture_method=manual` for holds). "If the conditions for exemption aren't met, the PaymentIntent might throw an error" | [S3] |
| `authentication_required` | "You must notify your customer to return to your application to complete the payment … use the declined PaymentIntent's client secret with confirmPayment" | [S5] |
| Capture | `POST /v1/payment_intents/:id/capture` `amount_to_capture`. "A partial capture automatically releases the remaining amount." "You can only perform one capture … for most payments" | [S2] |
| Cancel a hold | `POST /v1/payment_intents/:id/cancel`. A `requires_capture` PaymentIntent "can't be refunded directly. You must cancel" | [S15] |
| Refund | `POST /v1/refunds` `payment_intent, amount`. Never more than the charge in total. Processing fees aren't returned. Short balance → card refund `pending`. Failure can arrive "up to 30 days" later (`refund.failed`). Customer sees the credit in about 5–10 business days. Platform refunds on separate charges and transfers are debited from the platform: "Reverse the transfers … to recover" | [S15] |
| Tip | On-session confirm with the saved `payment_method` (the client is present). 3DS handled in place | [S3] |
| Connect account | v1 controller properties `stripe_dashboard.type=express`, `fees.payer=application`, `losses.payments=application` (Express-equivalent), `capabilities[transfers][requested]=true`, `country=US`. `losses.payments=application` "requires you to review and acknowledge your responsibilities in the Dashboard" | [S24] |
| Onboarding | Account Session `components[account_onboarding][enabled]=true` → `ConnectAccountOnboarding onExit` → retrieve the account (`details_submitted`, `payouts_enabled`, capabilities). Fallback: v1 Account Link `type=account_onboarding` | [S23][S8] |
| Transfers (separate charges and transfers) | `POST /v1/transfers` `amount, currency, destination, transfer_group, source_transaction`. "To prevent a transfer from executing before the funds from the associated charge are available, use the transfer's `source_transaction`." "You can create multiple transfers with the same `source_transaction`, as long as the sum … doesn't exceed the source charge." It must be set at creation. Reversal "only possible … if the connected account's available balance is greater than the reversal amount" | [S26] |
| Bank payouts | Connected account default "daily rolling basis". Statuses `pending, in_transit, paid, failed, canceled`. `payout.*` are v1 events only | [S9] |
| Disputes | Opening debits "the disputed amount, plus a dispute fee"; no refunds while open; inquiries `warning_*`; countered fee returned on a win; received fee not returned | [S16] |

**Why separate charges and transfers (not destination charges):**
- One booking has up to three charges (hold, extras, tip) and platform-funded tenders (points, promo).
- The ledger's 3-day hold and netting logic decide when and how much to transfer.
- Separate charges and transfers allow "Transfer and charge amounts don't have to match" [S26].

### 6.3 Payment Element appearance

Map the TaskNest tokens to `appearance.variables` as **hex** values:
- light: `colorPrimary #4A3FC8`, `colorBackground #FFFFFF`, `colorText #1C1915`, `colorDanger #B42318`
- dark (theme `night`): `#A29CEF`, `#1E1B26`, `#F5F3EF`, `#FDA29B`
- `fontSizeBase 16px`, `borderRadius 10px`, `spacingUnit 4px`, `fontFamily Inter`

The colour variables don't support `rgba()` or `var(--…)`, and mobile inputs need at least 16 px [S4]. Connect components get `appearance.variables` and `overlays:'dialog'`; font and background are inherited from the parent container [S8].

### 6.4 Webhooks

Use **two snapshot event destinations**, both pinned to `2026-10-28.endive`, both pointing at `https://pfqvqencsbxauafahezw.supabase.co/functions/v1/stripe-webhook` (`verify_jwt=false` already in `config.toml`):

| Destination | Events | Handler (owner) |
|---|---|---|
| **Your account** (`STRIPE_WEBHOOK_SECRET`) | `payment_intent.amount_capturable_updated`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.requires_action`, `payment_intent.canceled`, `setup_intent.succeeded`, `setup_intent.setup_failed`, `charge.refunded`, `charge.expired`, `refund.created`, `refund.updated`, `refund.failed`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`, `transfer.created`, `transfer.updated`, `transfer.reversed` | `webhooks/{payments,refunds,disputes}.ts` (WS4) → domain postings (WS7) |
| **Connected accounts** (`STRIPE_CONNECT_WEBHOOK_SECRET`) | `account.updated`, `account.external_account.updated`, `payout.created`, `payout.updated`, `payout.paid`, `payout.failed`, `payout.canceled` | `webhooks/connect.ts` (WS5) |

All event names were checked against Stripe's event type list [S29]. Connect scope: v1 `account.updated` arrives on **Connected accounts** even for v2 Accounts; each event has a top-level `account` [S22].

**Processing rules:**
- Raw body verification; ignore non-`v1` schemes; 5-minute tolerance (never 0); multiple `v1` signatures during a secret roll.
- Reject `livemode:true`: "your production webhook URLs receive both live and test webhooks … check the `livemode` value" [S22].
- Store, then ack 2xx fast, then process async.
- Dedupe by event id and by object id + type.
- Never rely on ordering; re-retrieve the object when in doubt [S21].
- **Why snapshot payloads, not thin:** thin payloads are recommended for new integrations [S21], but the existing verified handler reads `data.object`. Snapshot is supported for v1 resources. Moving to thin is a later option (§11 D10).

### 6.5 Accounts v1 vs v2 (decision G13)

- `stripe.md` recommended Accounts v2 `recipient`. This plan chooses **v1 Accounts with controller properties**:
  1. Everything else is v1 on `2026-10-28.endive`. v2 requests use the `…preview` version header in Stripe's own examples [S21], which would mean two version pins.
  2. Account Sessions, Account Links and transfers are all v1.
  3. `payout.*` and `account.updated` are v1 events regardless [S9][S22].
- **Not chosen:** `tos_acceptance[service_agreement]=recipient`. That agreement is "available in select countries" and adds 24 h before transfers are available [S27]. Revisit with the owner (D9).

### 6.6 Test cards and the simulated twin

The simulated form (`simulatedCards.ts`) accepts **only** these numbers. Any future expiry and any 3-digit CVC are accepted [S7]. The number is mapped in the browser to a token: **only `sim_pm_<scenario>` is sent to the server.** Stripe mode uses the real Payment Element with the same numbers, and the `pm_card_*` ids in server tests [S7].

| Card | Stripe behaviour [S7] | `pm_` id [S7] | TaskNest scenario / expected UI |
|---|---|---|---|
| `4242 4242 4242 4242` | succeeds | `pm_card_visa` | Hold placed |
| `4000 0000 0000 0077` | succeeds, funds straight to available | `pm_card_bypassPending` | Use in Stripe test mode so transfers without `source_transaction` succeed |
| `4000 0000 0000 0002` | generic decline | `pm_card_visa_chargeDeclined` | "Your bank declined this card." |
| `4000 0000 0000 9995` | insufficient funds | `pm_card_visa_chargeDeclinedInsufficientFunds` | "…declined for insufficient funds." |
| `4000 0000 0000 0127` | incorrect CVC | `pm_card_chargeDeclinedIncorrectCvc` | "The security code is incorrect." |
| `4000 0000 0000 0069` | expired card | `pm_card_chargeDeclinedExpiredCard` | "Your card has expired." |
| `4000 0084 0000 0027` | 3DS required (US) | — | 3DS challenge, then hold |
| `4000 0000 0000 3220` | 3DS required (IE) | — | same |
| `4000 0025 0000 3155` | needs auth off-session unless set up | `pm_card_authenticationRequiredOnSetup` | Auth at booking, later extras succeed off-session |
| `4000 0027 6000 3184` | auth on all transactions | `pm_card_authenticationRequired` | Extras / re-hold → **Payment needs your approval** |
| `4000 0000 0000 0259` | fraudulent dispute | `pm_card_createDispute` | Staff see a dispute |
| `4000 0000 0000 1976` | inquiry | `pm_card_createDisputeInquiry` | `warning_needs_response` |
| `4000 0000 0000 5126` | refund succeeded → failed | `pm_card_refundFail` | Refund Failed row + queue item |
| `4000 0000 0000 7726` | refund pending → succeeded | `pm_card_pendingRefund` | "Pending at bank" → Succeeded |

Dispute evidence keywords: `winning_evidence` (closes as won, credits amount and fees) and `losing_evidence` [S7]. Connect test values are in WS5 [S12]. **Test clocks are Billing-only**, so authorization expiry and the cancellation tiers are tested on the fake provider with the repo's test clock (`stripe.md` §2.11).

### 6.7 Environment variables (never committed)

| Variable | Where it lives | Value | Notes |
|---|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Frontend env (existing) | — | Public |
| `VITE_STRIPE_PUBLISHABLE_KEY` | **Frontend env:** local `.env` (gitignored by `.env` and `.env.*`), Vercel project env for preview and staging | `pk_test_…` | Publishable keys are "safe to expose" [S30]. The build **fails** on `pk_live_` (`check-live-keys.sh` + Vite plugin). Unset → simulated UI |
| `PAYMENTS_PROVIDER` | **Supabase secret** | `fake` (default) / `stripe` | Owner decision: simulated by default |
| `STRIPE_SECRET_KEY` | **Supabase secret** (+ GitHub secret for deploy-staging) | `rk_test_…` preferred, or `sk_test_…` | Stripe recommends restricted keys: "Use restricted API keys (RAKs) for most use cases" [S30]. `*_live_` is refused |
| `STRIPE_WEBHOOK_SECRET` | **Supabase secret** | `whsec_…` (Your account destination) | Per-endpoint secret [S21] |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | **Supabase secret** | `whsec_…` (Connected accounts destination) | New |
| `STRIPE_API_VERSION` | Supabase secret (optional) | `2026-10-28.endive` | Code constant; override only to test an upgrade |
| `APP_BASE_URL` | Supabase secret | e.g. the staging domain | `return_url` / `refresh_url` for Account Links |
| `JOBS_SERVICE_KEY` | Supabase **Vault** | service role key | Used by `pg_cron` to call `/jobs/*` |
| `FAKE_STRIPE_FEE_BPS`, `FAKE_STRIPE_FEE_FIXED_CENTS`, `FAKE_DISPUTE_FEE_CENTS` | Supabase secret (optional) | `0`, `0`, `1500` | Simulation knobs. `1500` matches the repo's existing dispute constant (`disputes.ts`) |

- **Local dev:** Edge Functions read `supabase/functions/.env`, which is gitignored [S31].
- **Production:** `supabase secrets set …` or the Dashboard Edge Function Secrets page [S31].
- Stripe: "Don't put keys in source code or configuration files checked into version control" [S30].

### 6.8 Owner setup steps (when switching from simulated to Stripe test mode)

1. **Sandbox.** In the Stripe Dashboard, create or select a **sandbox**; sandbox keys start `pk_test_`, `rk_test_`, `sk_test_` [S30]. Use one sandbox for staging and a separate one for local dev.
2. **Keys** (Dashboard → API keys):
   - Copy the publishable key.
   - Create a **restricted key** with write access to: PaymentIntents, SetupIntents, Customers, CustomerSessions, Refunds, Transfers, Accounts, Account Sessions and Account Links. Read access to: ConfirmationTokens, Charges, Balance transactions, Disputes, Payouts and Events.
   - Give dispute write access only if staff will submit evidence from TaskNest.
3. **Payment methods settings:** make sure **Cards** are on. TaskNest also restricts to cards per request with `allowed_payment_method_types[]=card` [S19].
4. **Connect:**
   - Complete platform onboarding at dashboard.stripe.com/connect.
   - In the platform profile, **acknowledge responsibility for negative balances**, required for `losses.payments=application` [S24].
   - Set the platform name, icon and colour for onboarding in Connect branding settings.
5. **Webhooks** (Workbench → Webhooks → Create an event destination [S21]):
   - a. **Your account**, payload **Snapshot**, API version **2026-10-28.endive**, the events in §6.4, URL `https://pfqvqencsbxauafahezw.supabase.co/functions/v1/stripe-webhook`. Reveal and copy the `whsec_`.
   - b. **Connected accounts**, same settings, the Connect events in §6.4, same URL. Copy its `whsec_`.
6. **Supabase secrets:**
   ```
   supabase secrets set --project-ref pfqvqencsbxauafahezw \
     PAYMENTS_PROVIDER=stripe STRIPE_SECRET_KEY=rk_test_... \
     STRIPE_WEBHOOK_SECRET=whsec_... STRIPE_CONNECT_WEBHOOK_SECRET=whsec_... \
     APP_BASE_URL=https://<staging-domain>
   ```
   Add the same names as GitHub Actions secrets for `deploy-staging.yml`. Put the service key in Vault as `JOBS_SERVICE_KEY`.
7. **Frontend:** set `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_…` in the Vercel project env (preview and staging) and in local `.env`.
8. **Local webhooks:** `stripe listen --forward-to localhost:54321/functions/v1/stripe-webhook` and `stripe listen --forward-connect-to localhost:54321/functions/v1/stripe-webhook`. Each prints a `whsec_`; put them in `supabase/functions/.env` [S21][S22].
9. **Verify:**
   - `GET /health` → `"provider":"stripe"`.
   - Staff header shows "Payments: Stripe test".
   - Run `E2E_STRIPE=1 npm run test:e2e -- e2e/stripe` and `npm run test:api -- stripe-sandbox`.
10. **Roll back:** `supabase secrets unset PAYMENTS_PROVIDER STRIPE_SECRET_KEY` (back to fake, the owner's default).

---

## 7. Money changes

### 7.1 Policy v2 (new `money_policies` row; v1 is untouched)

| Field | v1 | v2 | Domain effect |
|---|---|---|---|
| `card.minChargeCents` | (absent = 0) | 50 | `allocateTenders`: if the card share would be 1–49¢, reduce non-card tenders in reverse `tenderUseOrder` (wallet, then points, then promo) by the shortfall, so card = 50. This always works when total ≥ 50¢, because the non-card tenders then hold at least the shortfall. A booking whose total is 1–49¢ is rejected (`422 rule_violation`). Card is always 0 or ≥ 50 [S13] |
| `tips.minCents` | (absent) | 50 | `validateTip` rejects 1–49¢ |
| `extras.minCardChargeCents` | (absent) | 50 | `complete` rejects extras whose card charge is 1–49¢ (`422 rule_violation` with a message). Zero extras is fine |
| `auth.holdNowMaxHoursBeforeStart` | — | 96 | `paymentPlan`: `hold_now` if the start is ≤ 96 h away (inside the 7-day CIT window [S2]) |
| `auth.scheduledHoldLeadHours` | — | 48 | `hold_at = start − 48 h`. An off-session hold lasts at least 4 d 18 h [S2], so it covers start + 2 d 18 h |
| `auth.captureBufferHours` | — | 24 | Re-hold if `capture_before < start + est + 24 h` |
| `consent.textVersion` | — | `card-consent-v1` | Text: "Save this card to my TaskNest account. I allow TaskNest to place and re-place the hold for this task, and to charge it for extra time and expenses, cancellation or no-show fees under the published policy, and tips I choose." Owner/legal approval needed (D8). Stripe requires stated terms, explicit consent and a record [S3] |

Everything else is copied from v1 (15% fee and commission, the tiers, the $10 strike fee, the 25% tip cap, 30-day tip window, 3 hold days, …), so the e2e and pricing expectations don't move.

### 7.2 Ledger additions (WS7)

| Txn kind | Lines | When |
|---|---|---|
| `stripe_fee` | Dr `stripe_fees` / Cr `card_clearing` | From `balance_transaction.fee` on capture, charge or refund (Stripe mode; fake fee knob) |
| `dispute_opened` | Dr `dispute_hold` (amount) + `dispute_fees` (fee) / Cr `card_clearing` | `charge.dispute.created` / `funds_withdrawn`: "Debits the disputed amount, plus a dispute fee" [S16] |
| `dispute_countered` | Dr `dispute_fees` / Cr `card_clearing` | Evidence submitted (Stripe mode: countered fee from the balance txn) |
| `dispute_won` | Dr `card_clearing` / Cr `dispute_hold` (+ countered fee back to `dispute_fees`) | `funds_reinstated` / closed won. The received fee is not returned [S16] |
| `dispute_lost` | Dr `tasker_payable` (recovered share) + `dispute_loss` / Cr `dispute_hold` | Closed lost. Keeps today's tasker clawback and points clawback |
| `refund_failed` | Reverse of the refund lines | `refund.failed` (up to 30 days later [S15]) |
| `tip_refund` | Dr `tasker_payable` / Cr `card_clearing` | Staff tip refund |
| `transfer_reversal` | Dr `payouts_clearing` / Cr `tasker_payable` | Transfer reversed |

`reconciliation_by_booking`: per booking, `card_clearing` net vs Σ Stripe balance transactions (`amount − fee`) mapped through `payment_intents`. Drift ≠ 0 is listed in Reconciliation and in the ops queue.

### 7.3 Transfers per booking (`domain/transfers.ts`, G8)

```
planTransfers(taskerShareCents, charges=[{chargeId, amountCents, alreadyTransferredCents}] ordered main→extras→tip):
  remaining = taskerShareCents
  for c in charges: t = min(remaining, c.amountCents − c.alreadyTransferredCents); if t>0 emit {sourceTransaction:c.chargeId, amount:t}; remaining −= t
  if remaining>0 emit {sourceTransaction:null, amount:remaining}   // funded from platform available balance (points/promo-funded share)
```

Negative adjustments (clawbacks, strike fees, disputes) are netted against the last transfers first. If the net is ≤ 0, nothing is sent, as `planPayout` already does.

### 7.4 Worked example (policy figures as in v1 and v2; checked by the judges against `DEFAULT_POLICY`)

- **Quote:** Tara $45/h × 2 h = subtotal 9000 + 15% fee 1350 = **total 10350**. Promo 1000 + points 1000 → **card hold 8350** (≥ 50, so v2 changes nothing).
- **Completion with 30 min extra + $12.50 expenses:** extra labour 2250 + fee 338 (half-up of 337.5) + expenses 1250 = **extras card charge 3838**. Captured 8350 (released 0).
- **Tasker share:** 7650 (9000 − 1350) + 1912 (2250 − 338) + 1250 = **10812**. **Platform:** 1350 + 1350 + 338 + 338 = **3376**. Check: 10812 + 3376 = 14188 = 10350 + 3838.
- **Transfers:** T1 `source_transaction=ch_main` **8350**, T2 `source_transaction=ch_extras` **2462** (10812 − 8350), remainder 0.
- **Same booking with card = 0** (points and promo cover 10350 under v2 with `card_not_needed`): T1 has no `source_transaction` and is **7650** from the platform's available balance. In Stripe test mode, fund the balance with `4000 0000 0000 0077` charges [S7].
- **Refundable to the client later:** main + extras = 12188 card (+ points/promo per `refundOrder`). **Tips are excluded** (G6).
- **v2 edge case:** total 10350 with points 10320 requested → the card would be 30¢ → points reduced to 10300 so card = 50.

---

## 8. Test plan and the existing e2e baseline

### 8.1 Layers

| Layer | Runs in CI | What |
|---|---|---|
| Unit (`tests/unit`) | yes (`unit`) | Domain v2 boundaries, `planTransfers`, `paymentPlan`, availability, simulated card map, encoder, signature verify, `Money` attributes |
| API (`tests/api`) | yes (`api`, local stack, fake provider) | Every endpoint in §4.3, jobs with the test clock, webhooks via `processEvent` and signed payloads, `integrity_violations` empty at the end |
| E2E mock (`e2e/*.spec.ts`) | yes (`e2e`) | Existing specs **unchanged** + one spec per workstream + axe on all routes (desktop + phone projects) |
| E2E live backend | opt-in (`E2E_BACKEND=1`) | Existing `backend.spec.ts` unchanged; works because seeded clients have a simulated saved card |
| Stripe sandbox | opt-in (`E2E_STRIPE=1`, test keys) | `e2e/stripe/checkout.spec.ts` (Payment Element via `frameLocator`, 3DS, declines), `tests/api/stripe-sandbox.test.ts` (`pm_card_*`, capture, refund pending/fail, transfer with `source_transaction`, dispute keywords). **Never in CI** (CI has no secrets by design; docs/CI.md) |

### 8.2 Keeping `e2e/ui.spec.ts` and `e2e/backend.spec.ts` green with no edits

| Test expectation | How the redesign keeps it |
|---|---|
| Client sign-in lands on `/taskers`; staff on `/console`; tasker on `/tasker` | `homeFor` unchanged. `/taskers` is the signed-in Book page |
| `tasker-card-tara` click → profile | Whole card root is a link (WS2) |
| `booking-duration.selectOption("120"/"180")` ×5 on `/taskers/:id` | `DirectBookPanel` keeps the native select (WS2) |
| `book-submit` with no payment step, then URL `/bookings$`; request body `toMatchObject({...})` | Seeded simulated saved card preselected (WS4 seed + mock); navigation state carries the confirmation; extra body fields are allowed by `toMatchObject` |
| Cancel, tip, refund and reschedule buttons on `booking-card` in the list | `BookingCard` keeps them visible; the default view lists all fixture bookings (WS3) |
| `tip` body `toEqual({amountCents})`; `complete` body `toEqual({extraMinutes, expensesCents})` | The saved card is used by default; no extra fields (WS3, WS5) |
| `flash` / `refund-flash` text | `Toast` renders those test ids with the same phrases (WS1) |
| `[data-testid=tasker-history] tr[data-booking-id]` on `/tasker` | `DataTable` always renders `<table>`; Recent jobs stays on Today (WS1, WS5) |
| `console-refund-approver.selectOption(adminId)` | Native select kept (WS6) |
| `profiles` reads only for own id; `display_names` used | New reads use `display_names` and public views (rule 7) |
| `review-rating` | Not used by any test; becomes a radio group freely |

### 8.3 The one API test edit

`tests/api/money-flows.test.ts:160` expects `stripe_payment_intent_id` to match `/^pi_fake_/` at booking. `freeSlot()` picks a slot ≥ 20 days ahead, so v2 chooses `save_card_hold_later` and no PaymentIntent exists yet. **Edit (WS7):**

```ts
expect(["hold_active", "card_saved"]).toContain(b.body.payment.state);
```

Add new tests for both plans. Any other edit a builder finds must be listed in the PR description with a reason; ledger amounts must not change.

---

## 9. Integration order

| Wave | Who | Merge order | Gate |
|---|---|---|---|
| **0: split + contracts** (1–2 days) | WS7-a, WS1-a in parallel | WS7-a → WS1-a | All 7 CI jobs green, **no test edits**, `docs/contracts.md` merged |
| **1: build** (parallel worktrees, rebasing daily on `main`) | WS1, WS7, WS4, WS2, WS3, WS5, WS6 | **WS1** (kit; others start on Wave-0 primitives) → **WS7** (policy v2, previews, availability, jobs, the single API test edit) → **WS4** (provider, payment endpoints, webhooks, `PaymentSection`, seed card) → **WS2** (discovery + booking) → **WS3** (management) → **WS5** (tasker + Connect + payouts) → **WS6** (console + sim tools) | Each PR: 7 CI jobs green; `integrity_violations` empty; axe clean on touched routes; no edits outside its owned or additive list; CODEOWNERS review on money code |
| **2: integrate + harden** | all, with WS6 coordinating | Flags `chat`, `availability`, `dispute_evidence`, `help_articles` switched on one by one; remove the deprecated provider wrappers; full phone and dark pass; `docs/` refresh | Full suite in fake mode; Stripe sandbox suites green with the owner's keys (§6.8); Helix runs as a non-required check (docs/CI.md "Helix drop-in") |

**Feature flags:** `src/lib/flags.ts` (WS1) reads `GET /health.features` (WS7). This lets Wave-1 PRs merge dark.

**If a dependency isn't merged yet:** build against the contract with `e2e/mocks/*`, and keep the real call behind the flag.

---

## 10. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | `alter type booking_status add value` can't be used in the same transaction that adds it | Add the enum values in their own migration file before any function, index or view uses them |
| R2 | Moving to `save_card_hold_later` changes booking-time behaviour that API tests assert | §8.3: one edit; the no-live-hold capture rule keeps every ledger amount identical |
| R3 | Visa merchant-initiated holds last 4 d 18 h, and classification isn't decided by `off_session` alone [S2] | Always trust `capture_before`; re-hold job with buffer; capture fallback off-session |
| R4 | Extended authorization is unlikely to be available to this business (IC+ only, restricted categories; `stripe.md` §2.3) | Not used |
| R5 | Sandbox webhooks are retried only 3 times in a few hours [S21] | Store-then-process, plus the hourly `reconcile-payment-objects` job |
| R6 | Points- or promo-funded tasker share needs **platform available balance** for transfers without `source_transaction`; test-mode charges land as pending | Use `4000 0000 0000 0077` in sandbox runs [S7]; payout run reports "insufficient platform balance" per tasker without aborting |
| R7 | Transfer reversals fail when the connected account's available balance is short [S26] | Net against future transfers by default; reverse only when covered |
| R8 | Embedded Connect needs popups, COOP `unsafe-none`, and doesn't work in embedded web views [S8] | No COOP header; CSP list ready; hosted Account Link fallback |
| R9 | The simulated card form could be mistaken for a real one, or accept a real PAN | Accepts only the documented numbers (unit-tested, including Luhn-valid non-test numbers); PAN never sent; Simulated badge; hidden in Stripe mode |
| R10 | Live keys leak into preview or staging | Server refuses `*_live_`; build refuses `pk_live_`; webhook `livemode` rejection; response `livemode` assertion; gitleaks in CodeRabbit |
| R11 | Idempotency keys older than 24 h may be pruned, so a late retry could double-charge [S20] | Persist provider ids in `payment_intents` before commit; look up before re-calling |
| R12 | Off-session charges for cancellation and no-show fees need clear consent | Consent text v1 names them; owner and legal approve (D8); `card_consents` record |
| R13 | Shared-file conflicts across 7 worktrees | Wave 0 split; strict ownership; package.json frozen; contracts doc PR process |
| R14 | Scope (chat, calendar, help, evidence builder) delays the core | Behind flags, Wave 2; core booking, management, payments and payouts land first |
| R15 | Dispute amount can differ from the charge [S16] | Ledger uses the dispute's amount and balance-transaction fee, never the booking total |
| R16 | v1 vs v2 Accounts: Stripe promotes v2 | Isolated in `provider/stripe/connect.ts`; revisit (D9) |
| R17 | Fake processing fee 0 hides fee-related reconciliation bugs in CI | Add one API test run with `FAKE_STRIPE_FEE_BPS=290` and `FAKE_STRIPE_FEE_FIXED_CENTS=30` as **arbitrary simulation values** (not a claim about Stripe pricing) to exercise fee lines |
| R18 | Test clocks don't move PaymentIntent expiry | Time-based tests stay on the fake provider |
| R19 | The 50¢ rule changes allocations for existing promo and points users | v2 only applies to new bookings; `/pricing` shows the rule; v1 bookings unchanged |

---

## 11. Open owner decisions

| # | Decision | Default in this plan |
|---|---|---|
| D1 | Browse before sign-in (TaskRabbit's web flow starts with log-in [T3]) | Allowed; sign-in at Review |
| D2 | Address and service area | ZIP + street collected; `addresses` table; service ZIPs on taskers; results say "serving your area" only when true |
| D3 | Card = $0 bookings | Still save a card (setup mode) for extras and fees |
| D4 | Reschedule inside 24 h needs both parties (TaskRabbit [T11]) | Deferred; single-party reschedule as today |
| D5 | Tasker may start while the client's payment needs approval | Yes, with a neutral notice |
| D6 | One category per tasker | Kept; multi-category later |
| D7 | Client-reported tasker no-show auto-refunds | No: support request; staff run the admin no-show |
| D8 | Consent text `card-consent-v1` | Needs owner and legal approval |
| D9 | Accounts v1 controller properties vs v2 recipient; Customer vs customer-configured Account | v1 for both |
| D10 | Snapshot vs thin webhooks | Snapshot now |
| D11 | Remove the direct `approvedBy` refund path in favour of the approvals queue only | Keep both until the owner decides; removing it edits `money-flows.test.ts:542-565` |
| D12 | Show "Nest Pro" badges | Only with published server-side rules; otherwise omitted |

---

## 12. Glossary of UI states

| Chip (text always shown) | Tone | Source |
|---|---|---|
| Finishing payment | warning | `pending_payment` |
| Payment not completed | neutral | `payment_abandoned` |
| Waiting for {tasker} · countdown | info | `requested` |
| Confirmed | success | `accepted` |
| Card saved · hold on {date} | neutral | `payment_state=card_saved` |
| Hold $X · releases by {date} | hold | `hold_active` + `capture_before` |
| Payment needs your approval | danger | `action_required` |
| In progress | info | `in_progress` |
| Completed | success | `completed` |
| Cancelled by you / by {tasker} | neutral | `canceled_*` |
| Declined / Expired | neutral | `declined` |
| No-show | neutral / danger | `no_show_*` |
| Card dispute {status} · $X | danger | `disputed` + `disputes.status` |
| Released $X | neutral | pre-capture cancel |
| Refund pending at bank / Refunded / Refund failed | warning / success / danger | `refunds.provider_status` |
| Sent to payout account / Paying out / In your bank / Payout failed | neutral / info / success / danger | `transfers`, `connected_payouts` |

---

## 13. Sources

**Stripe** (all fetched 2026-10-29 for this plan, or re-verified by Judge 2 the same day):

| Ref | Page |
|---|---|
| S1 | https://docs.stripe.com/payments/finalize-payments-on-the-server.md?platform=web&type=payment |
| S2 | https://docs.stripe.com/payments/place-a-hold-on-a-payment-method |
| S3 | https://docs.stripe.com/payments/save-during-payment.md?payment-ui=elements |
| S4 | https://docs.stripe.com/elements/appearance-api.md?api-integration=paymentintents |
| S5 | https://docs.stripe.com/payments/save-and-reuse.md?payment-ui=elements |
| S7 | https://docs.stripe.com/testing |
| S8 | https://docs.stripe.com/connect/get-started-connect-embedded-components.md?platform=web |
| S9 | https://docs.stripe.com/connect/payouts-connected-accounts |
| S11 | https://docs.stripe.com/connect/supported-embedded-components/notification-banner |
| S12 | https://docs.stripe.com/connect/testing |
| S13 | https://docs.stripe.com/currencies |
| S14 | https://docs.stripe.com/js/including |
| S15 | https://docs.stripe.com/refunds |
| S16 | https://docs.stripe.com/disputes/how-disputes-work |
| S17 | https://docs.stripe.com/disputes/responding |
| S18 | https://docs.stripe.com/api/versioning |
| S19 | https://docs.stripe.com/changelog/endive/2026-09-30/removes-the-payment-method-types-parameter-from-payment-intents-and-setup-intents |
| S20 | https://docs.stripe.com/api/idempotent_requests |
| S21 | https://docs.stripe.com/webhooks |
| S22 | https://docs.stripe.com/connect/webhooks |
| S23 | https://docs.stripe.com/connect/supported-embedded-components/account-onboarding.md?platform=web |
| S24 | https://docs.stripe.com/connect/migrate-to-controller-properties |
| S25 | https://docs.stripe.com/connect/supported-embedded-components/payouts.md?platform=web |
| S26 | https://docs.stripe.com/connect/separate-charges-and-transfers.md?platform=web&integration=custom&ui=elements&api-integration=paymentintents |
| S27 | https://docs.stripe.com/connect/service-agreement-types |
| S28 | https://docs.stripe.com/changelog/endive/2026-09-30/removes-configurations-parameter-from-v2-core-account-links-api |
| S29 | https://docs.stripe.com/api/events/types |
| S30 | https://docs.stripe.com/keys |
| S31 | https://supabase.com/docs/guides/functions/secrets (Supabase, for secrets handling) |

**TaskRabbit** (UX patterns only; nothing copied):

| Ref | Page |
|---|---|
| T1 | https://www.taskrabbit.com/ (home page structure) |
| T3 | https://support.taskrabbit.com/hc/en-us/articles/210861763-How-Do-I-Hire-a-Tasker (re-fetched 2026-10-29: category → details incl. address → "See Taskers & Prices" → choose tasker → date and time → describe task → review; up to 14 days ahead; scheduled once the tasker schedules it) |
| T6 | https://support.taskrabbit.com/hc/en-us/articles/204411560-How-Do-I-Pay-My-Tasker |
| T7 | https://support.taskrabbit.com/hc/en-us/articles/216901546-Tipping-Taskers (rating before tip; 100% to tasker) |
| T11 | https://support.taskrabbit.com/hc/en-us/articles/46260435128091-Schedule-Availability-Reschedule-Policy |
| B3 | https://www.taskrabbit.com/blog/turn-every-invite-into-income-start-with-these-4-tips/ (invitation countdowns) |

**Repo evidence:** `README.md`, `docs/{SPEC,API,BACKEND_NOTES,CI}.md`, `.coderabbit.yaml`, `src/App.tsx`, `src/lib/{api,preview}.ts`, `supabase/functions/_shared/{domain/config.ts,domain/booking.ts,domain/payouts.ts,provider/*}`, `supabase/migrations/20260924000001_schema.sql`, `e2e/{ui,backend}.spec.ts`, `tests/api/{helpers,money-flows}.ts`, `scripts/ci/check-live-keys.sh`, `.github/workflows/deploy-staging.yml`.

**Inputs in this folder:** `proposal-marketplace.md` (winner), `proposal-money-clarity.md`, `proposal-ops-roles.md`, `judge-2.md`, `stripe.md`, `taskrabbit.md`, `OWNER-NOTES.md`.
