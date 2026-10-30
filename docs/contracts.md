# TaskNest contracts (frozen at the end of Wave 0)

This is the single source for the marketplace + Stripe contracts: schema, booking status and payment state,
endpoint catalogue, provider interface, money rendering and component contracts. It is owned by WS7.
The build plan is the rationale; **this file wins** if they ever differ.
The provider interface below is a sketch; `_shared/provider/types.ts` is its typed form.

To change a contract, open a PR against this file and tag the affected workstream owners. Do not change a
contract inside a feature PR. Section numbers (4.1 ... 4.6) are the plan's and are kept so references hold.

## Wave 0 (WS7-a) implementation notes

What exists on `main` after WS7-a, and where it differs in detail from the text below.

**Migrations.** Two files, in this order:

1. `20261031235900_marketplace_enum_values.sql` adds `booking_status` `pending_payment` and `payment_abandoned`.
   It is separate because Postgres cannot use a new enum value in the transaction that added it.
2. `20261101000000_marketplace_contract.sql` is the contract: every new column and table in 4.1, RLS on every
   new table, `bookings_no_double_slot` recreated with `pending_payment`. No views (each is created by the
   migration of its owner). No data. Nothing reads or writes any of it yet.

Details the table in 4.1 leaves open:

- `disputes.fee_cents` already existed (the dispute fee actually charged); only the other dispute columns are new.
- Extra checks: `bookings.payment_plan` and `bookings.payment_state` are check-constrained to the values in 4.2;
  `tips.refunded_cents` is also `>= 0`; `transfers.reversed_cents` is between 0 and `amount_cents`;
  `refund_approvals` has `decided_by <> requested_by` so the "approver is not the requester" rule cannot be bypassed.
- `transfers.booking_id` is `not null` (transfers are per booking, 7.3); `support_requests.booking_id` is nullable
  (kind `other`).
- API-written tables have no write policies and their INSERT/UPDATE/DELETE are revoked from `anon`/`authenticated`.
  User-writable: `addresses` (own CRUD), `messages` (insert as a party, never `system`), `notifications`
  (`read_at` only).
- **`taskers` read access is now an explicit column list.** Connect state (`requirements_due`, `disabled_reason`,
  `transfers_capability`, `payouts_enabled`, `details_submitted`, `onboarding_completed_at`) must not be public, and
  taskers are readable by everyone. `anon` and `authenticated` may select: `id, headline, category,
hourly_rate_cents, status, stripe_account_id, kyc_verified_at, suspended_at, created_at, display_name, bio,
avatar_url, skills, service_zips`. `select *` on `taskers` therefore fails with "permission denied" for those
  roles; list columns (the frontend and tests already do). The Connect fields are served by the API
  (`GET /tasker/payout-account`, service role). A later migration that adds a public `taskers` column must
  also `grant select (col)`.
- Not done in Wave 0 (WS7 does them with the behaviour): the `booking_status` transitions in
  `domain/booking.ts` (4.2), the `tn_apply` table whitelist for the new tables, and seeding `categories`.

**Backend layout.** Behaviour is unchanged; the files moved.

| Area                                                | Where                                                                                                                                                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dispatcher, auth, idempotency, test clock           | `supabase/functions/api/index.ts`                                                                                                                                                        |
| Route type and helpers (`Route`, `ID`, `booking()`) | `api/route.ts`                                                                                                                                                                           |
| Route table                                         | `api/routes.ts` concatenates `api/routes/{booking,actions,money,discovery,jobs,payments,tasker,connect,payouts,support,admin,sim}.ts`, each exporting `routes: Route[]`                  |
| Handlers                                            | `api/handlers/{bookings,money,admin,payouts}.ts` (existing code) and empty `{payments,connect,tasker,support,sim,discovery}.ts`                                                          |
| Jobs                                                | `api/jobs/index.ts`: `jobs` registry (WS7: `auto-decline-requests`, `expire-pending-payments`) and `runJob` behind `POST /jobs/:name`                                                    |
| Provider                                            | `_shared/provider/types.ts` (the 4.4 interface), `stripe/{http,payments,connect,index}.ts`, `fake/{payments,connect,scenarios,index}.ts`, `index.ts` re-exports the same names as before |
| Webhooks                                            | `_shared/webhooks/index.ts` (verify, store, dispatch registry), `payments.ts`, `refunds.ts`, `disputes.ts`, `connect.ts`                                                                 |

Conventions the later workstreams rely on:

- **Adding a route.** Append to `routes` in the area file you own. `Route` has `method` (`GET|POST|PUT|DELETE`),
  an anchored `pattern`, `handler`, `idempotent`, and optional `params`: the names of the capture groups, in order
  (default `["id"]`). A name that is `id` or ends in `Id` must be a uuid (400 `bad_request` otherwise) and is
  lowercased; other names are passed through. Example: `/bookings/:id/tips/:tipId/refund` uses `params: ["id", "tipId"]`.
  Request bodies are read for POST and PUT. CORS allows GET, POST, PUT, DELETE.
- **Jobs.** `POST /jobs/:name` accepts only the function's service-role key (cron) and is in the system-route set,
  so the service key can call `/payouts/run` and `/jobs/*` and nothing else. Register a job by adding it to `jobs`.
  An unknown name is 404 `not_found`.
- **Provider methods.** The deprecated `authorize`, `charge` and `transfer(TransferInput)` still work as before. The
  new methods exist on both providers and throw `PaymentError("not_implemented", ..., 501)` until WS4 (payments
  group) or WS5 (Connect group) fills them in. `TransferInput` gained optional `transferGroup`,
  `sourceTransaction` and `bookingId`; WS5 makes them required when the payout handler moves to per-booking
  transfers. The Stripe API version header is unchanged (`2024-06-20`); WS4 moves it to the version in 6.1.
- **Webhook events.** Add a type to the `handlers` map of the area file that owns it (`payments.ts`, `refunds.ts`,
  `disputes.ts`, `connect.ts`). A handler gets an `EventCtx` (`db`, `ev`, `now`, `lockHeld`, `recordOnly`) and returns
  the JSON body. Two handlers for one type fail at startup. Unregistered types are stored and acknowledged
  (`{received: true, handled: false}`) as before. `StripeEvent` already has optional `livemode`, `api_version` and
  `account`; enforcing `livemode` and filling the `stripe_events` columns is WS4's job.
- **Idempotent replay.** `Idempotent-Replayed: true` is already sent on replays and exposed to browsers; nothing to add.

---

## Shared contracts

### 4.1 Schema contract (migration `20261101000000_marketplace_contract.sql`)

All money columns are `bigint` cents. Every new table has `enable row level security` and explicit policies.

**Enums and status**

- `booking_status` gains `'pending_payment'` and `'payment_abandoned'`. Add them in a migration of their own, before anything uses them, because Postgres can't use a new enum value inside the transaction that added it (§10 R1).
- `bookings_no_double_slot` is recreated to include `'pending_payment'`, so a slot is held while 3DS completes.

**`bookings` (new columns)**

| Column               | Type                                                                | Meaning                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `category_slug`      | text null                                                           | Category the booking came from                                                                                                           |
| `address_id`         | uuid null → `addresses`                                             | Task address                                                                                                                             |
| `payment_plan`       | text check in (`hold_now`,`save_card_hold_later`,`card_not_needed`) | Chosen by the server at booking                                                                                                          |
| `payment_state`      | text not null default `'none'`                                      | §4.2                                                                                                                                     |
| `hold_at`            | timestamptz null                                                    | When the scheduled hold should be placed                                                                                                 |
| `capture_before`     | timestamptz null                                                    | From `latest_charge.payment_method_details.card.capture_before` [S2]. Replaces the computed `auth_expires_at`, which is kept for v1 rows |
| `stripe_charge_id`   | text null                                                           | `ch_` of the live hold                                                                                                                   |
| `stripe_customer_id` | text null                                                           | `cus_`                                                                                                                                   |
| `payment_method_id`  | text null                                                           | `pm_` (or `sim_pm_*`)                                                                                                                    |
| `setup_intent_id`    | text null                                                           | `seti_` for `save_card_hold_later`                                                                                                       |
| `payment_expires_at` | timestamptz null                                                    | `pending_payment` TTL                                                                                                                    |

**Other changed tables**

- `profiles`: `stripe_customer_id text`, `default_payment_method_id text`. The column grant stays: users can't write these; the API does.
- `taskers`: `bio text`, `avatar_url text`, `skills jsonb default '[]'`, `service_zips text[] default '{}'`, `transfers_capability text`, `payouts_enabled bool default false`, `details_submitted bool default false`, `requirements_due jsonb default '[]'`, `disabled_reason text`, `onboarding_completed_at timestamptz`.
- `refunds`: `provider_refund_id text`, `provider_status text check in (pending,succeeded,failed,canceled,requires_action)`, `failure_reason text`, `payment_intent_id text`.
- `tips`: `stripe_charge_id text`, `refunded_cents bigint not null default 0 check (refunded_cents <= amount_cents)`.
- `disputes`: status check widened to Stripe's values `warning_needs_response, warning_under_review, warning_closed, needs_response, under_review, won, lost, prevented` [S16]. New columns `is_inquiry bool`, `fee_cents bigint`, `countered_fee_cents bigint`, `evidence_due_by timestamptz`, `evidence_submitted_at timestamptz`, `payment_intent_id text`.
- `payouts` (kept; one row per payout run per tasker). Status semantics: `paid` = **transfers created**. The UI label is "Sent to payout account".
- `stripe_events`: `payload jsonb`, `livemode bool`, `api_version text`, `account text`, `scope text check in (platform,connect,simulated)`, `processed_at timestamptz`, `attempts int default 0`, `last_error text`.

**New tables**

| Table                           | Key columns                                                                                                                                                                                                                                                                         | RLS                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `payment_intents`               | `id` (pi_/sim_pi_), `booking_id`, `kind` (`hold`,`rehold`,`extras`,`tip`,`fee`), `amount_cents`, `status`, `charge_id`, `capture_before`, `created_at`                                                                                                                              | Staff read. Client reads own booking's rows  |
| `card_consents`                 | `id`, `user_id`, `payment_method_id`, `booking_id null`, `text_version`, `text_sha256`, `created_at`                                                                                                                                                                                | Own read; API writes                         |
| `transfers`                     | `id`, `payout_id`, `booking_id`, `stripe_transfer_id`, `source_transaction null`, `transfer_group`, `amount_cents`, `reversed_cents`, `status` (`pending`,`created`,`failed`,`reversed`)                                                                                            | Tasker own, staff                            |
| `connected_payouts`             | `id` (po_), `tasker_id`, `amount_cents`, `status` (`pending`,`in_transit`,`paid`,`failed`,`canceled`) [S9], `arrival_date`, `failure_code`, `created_at`                                                                                                                            | Tasker own, staff                            |
| `stripe_balance_transactions`   | `id` (txn_), `source_id`, `booking_id`, `type`, `amount_cents`, `fee_cents`, `net_cents`, `available_on`, `created_at`                                                                                                                                                              | Staff                                        |
| `categories`                    | `slug` pk, `name`, `icon`, `sort`, `active`                                                                                                                                                                                                                                         | Anon read                                    |
| `addresses`                     | `id`, `user_id`, `label`, `line1`, `line2`, `city`, `state`, `zip`, `tz`, `is_default`                                                                                                                                                                                              | Own CRUD                                     |
| `tasker_availability`           | `tasker_id`, `weekday` 0–6, `start_minute`, `end_minute`                                                                                                                                                                                                                            | Anon read; tasker own write via API          |
| `tasker_availability_overrides` | `tasker_id`, `date`, `kind` (`block`,`add`), `start_minute`, `end_minute`                                                                                                                                                                                                           | Same                                         |
| `notifications`                 | `id`, `user_id`, `kind`, `booking_id`, `title`, `body`, `read_at`, `created_at`                                                                                                                                                                                                     | Own read and update of `read_at`             |
| `messages`                      | `id`, `booking_id`, `sender_id`, `body` (≤2000), `system bool`, `created_at`                                                                                                                                                                                                        | The two parties + staff read; parties insert |
| `support_requests`              | `id`, `booking_id`, `requester_id`, `kind` (`no_show`,`work_problem`,`charge_wrong`,`damage_safety`,`refund_request`,`other`), `status` (`open`,`waiting_on_customer`,`resolved`), `assignee_id`, `amount_at_stake_cents`, `due_at`, `resolution_note`, `created_at`, `resolved_at` | Requester own, staff                         |
| `support_replies`               | `id`, `request_id`, `author_id`, `body`, `internal bool`, `created_at`                                                                                                                                                                                                              | Requester sees non-internal; staff all       |
| `refund_approvals`              | `id`, `booking_id`, `requested_by`, `kind`, `amount_cents`, `reason`, `preview jsonb` (frozen), `status` (`pending`,`approved`,`rejected`,`executed`), `decided_by`, `decided_at`                                                                                                   | Staff                                        |

**Views** (each created by its owner's migration):

| View                        | Owner | Notes                                                                               |
| --------------------------- | ----- | ----------------------------------------------------------------------------------- |
| `category_summary`          | WS7   | anon; `from_rate_cents` = min active rate                                           |
| `tasker_public_stats`       | WS7   | anon; avg rating ×100 integer, review count, completed count. Fixes the ratings bug |
| `public_reviews`            | WS7   | anon; no client id, first name only                                                 |
| `booking_statement`         | WS7   | per-booking money lines from the ledger                                             |
| `tasker_statement`          | WS7   | own `tasker_payable` lines                                                          |
| `reconciliation_by_booking` | WS7   | ledger `card_clearing` vs Stripe balance transactions                               |
| `ops_queue`                 | WS6   | union of due items                                                                  |

### 4.2 Booking status and payment state

**`booking_status` transitions** (domain `booking.ts`, WS7). New rows are **bold**:

| From                  | To                                        |
| --------------------- | ----------------------------------------- |
| **`pending_payment`** | `requested`, **`payment_abandoned`**      |
| `requested`           | `accepted`, `declined`, `canceled_client` |
| everything else       | unchanged from today                      |

**`payment_state`** (WS4 writes it; everyone reads it):

| Value             | Meaning                                                                             | Set by                                     |
| ----------------- | ----------------------------------------------------------------------------------- | ------------------------------------------ |
| `none`            | No card involvement yet, or a v1 booking                                            | default                                    |
| `requires_action` | 3DS pending on the initial payment (`pending_payment`)                              | `POST /bookings`                           |
| `card_saved`      | `save_card_hold_later`: card saved, no hold yet (`hold_at` set)                     | `POST /bookings`, `setup_intent.succeeded` |
| `hold_active`     | Manual-capture PaymentIntent in `requires_capture`; `capture_before` set            | booking, hold job, webhook                 |
| `action_required` | Off-session hold, extras or fee charge declined with `authentication_required` [S5] | jobs, `complete`, webhook                  |
| `hold_expired`    | PaymentIntent `canceled` by expiry before capture [S2]                              | `payment_intent.canceled`                  |
| `captured`        | Main card amount captured                                                           | `complete`, cancel fee, no-show            |
| `released`        | Hold canceled with no capture                                                       | cancel, decline                            |
| `failed`          | Unrecoverable (staff alerted)                                                       | jobs                                       |

**Rule for capturing with no live hold.** If a money action needs to take card money (completion, cancellation fee, no-show fee) and there is no live hold (`card_saved`, `hold_expired`), the server charges the saved card **off-session** for exactly that amount. It uses `customer`, `payment_method`, `off_session=true`, `confirm=true` [S3]. On `authentication_required` it sets `action_required` and notifies the client [S5]. The ledger posts the same txn kinds and amounts as a capture would.

### 4.3 Endpoint catalogue (new ★ and changed ◐)

Errors keep the shape `{error:{code,message,details?}}`. Every POST that moves money requires `Idempotency-Key`. A replay returns the stored response plus the `Idempotent-Replayed: true` header (WS7).

| Method + path                                                                         | Owner                               | Who                | Request → response (shape)                                                                                                                                                                   |
| ------------------------------------------------------------------------------------- | ----------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ◐ `POST /quote`                                                                       | WS7                                 | client, anon       | adds `categorySlug?`, `localStart?`, `tz?` → adds `paymentPlan:{mode:'hold_now'                                                                                                              | 'save_card_hold_later'                                                                                              | 'card_not_needed', holdAt?, cardCents, reason}`, `cardMinimumApplied:boolean`, `responseDeadline`                                                                                                                                                                                                          |
| ★ `POST /quote/estimate`                                                              | WS7                                 | anon               | `{taskerIds[], minutes}` → `{estimates:[{taskerId,totalCents,policyVersion}]}`. Used by the W2 cards                                                                                         |
| ◐ `POST /bookings`                                                                    | WS7 (WS4 supplies the payment step) | verified client    | adds `categorySlug?`, `addressId?`, `payment?: {kind:'confirmation_token',id}                                                                                                                | {kind:'saved_method',paymentMethodId}                                                                               | {kind:'simulated',token}`, `consent?:{textVersion}`. Legacy `paymentMethod`is still accepted. **No`payment`and no saved default card →`422 payment_method_required`** (the silent `pm_card_visa`fallback is removed;`stripe.md`#2). Response adds`payment:{state, clientSecret?, captureBefore?, holdAt?}` |
| ★ `POST /bookings/:id/payment/confirm`                                                | WS4                                 | client             | after `handleNextAction` → `{booking, payment}`. Moves `pending_payment` → `requested`                                                                                                       |
| ★ `POST /bookings/:id/payment/retry`                                                  | WS4                                 | client             | `{paymentMethodId?}` → `{clientSecret}` for `stripe.confirmPayment` [S5], or the result                                                                                                      |
| ★ `GET /payments/config`                                                              | WS4                                 | any                | `{provider:'fake'                                                                                                                                                                            | 'stripe', simulated:boolean, apiVersion}`                                                                           |
| ★ `POST /payments/customer-session`                                                   | WS4                                 | client             | → `{customerSessionClientSecret}`, or `{simulated:true}`                                                                                                                                     |
| ★ `GET /payments/methods`                                                             | WS4                                 | client             | → `{methods:[{id,brand,last4,expMonth,expYear,isDefault,usedByUpcoming:number,simulated}]}`                                                                                                  |
| ★ `DELETE /payments/methods/:id`                                                      | WS4                                 | client             | `409 method_in_use` while it backs an upcoming hold or a scheduled hold                                                                                                                      |
| ★ `POST /payments/setup-intent`                                                       | WS4                                 | client             | `{confirmationTokenId                                                                                                                                                                        | simulatedToken, consent}`→`{status, clientSecret?, paymentMethodId?}`                                               |
| ★ `POST /bookings/:id/complete-preview`                                               | WS7                                 | tasker             | `{extraMinutes, expensesCents}` → `{extraLaborCents, extraFeeCents, expensesCents, extrasCardCents, captureCardCents, releaseCents, taskerNetDeltaCents, problem?}`                          |
| ★ `POST /bookings/:id/tip-preview`                                                    | WS7                                 | client             | `{amountCents}` → `{capCents, alreadyTippedCents, roomCents, problem?, windowEndsAt}`                                                                                                        |
| ★ `GET /bookings/:id/no-show-preview?who=`                                            | WS7                                 | tasker, admin      | → outcome per tender, fee                                                                                                                                                                    |
| ★ `POST /bookings/:id/reschedule-preview`                                             | WS7                                 | client, tasker     | `{localStart}` → `{slotFree, cancellationAnchor, holdPlanChange?}`                                                                                                                           |
| ◐ `POST /bookings/:id/complete`                                                       | WS7                                 | tasker             | response adds `payment:{extras:{state, clientSecret?}}`                                                                                                                                      |
| ◐ `POST /bookings/:id/tip`                                                            | WS7                                 | client             | uses the booking's saved card by default; optional `paymentMethodId`; may return `requires_action` + `clientSecret`. **The body `{amountCents}` alone must still work** (e2e uses `toEqual`) |
| ★ `POST /bookings/:id/tips/:tipId/refund`                                             | WS7                                 | support, admin     | full tip refund + tasker clawback                                                                                                                                                            |
| ★ `POST /bookings/:id/report-no-show`                                                 | WS7                                 | client             | creates `support_requests` kind `no_show`. No automatic refund (owner decision D7)                                                                                                           |
| ★ `GET /taskers/:id/availability?from&days=14&minutes`                                | WS7                                 | anon               | `{tz, days:[{date, slots:[{start,status:'free'                                                                                                                                               | 'taken'                                                                                                             | 'unavailable'}]}]}`. Never exposes other clients                                                                                                                                                                                                                                                           |
| ★ `GET /taskers/availability?category&date&timeOfDay&minutes`                         | WS7                                 | anon               | first free slot per tasker                                                                                                                                                                   |
| ★ `POST /jobs/:name`                                                                  | WS7 (registry)                      | system             | jobs in §5 WS4/WS5/WS7                                                                                                                                                                       |
| ★ `GET /tasker/payout-account`                                                        | WS5                                 | tasker             | `{state:'not_started'                                                                                                                                                                        | 'in_progress'                                                                                                       | 'under_review'                                                                                                                                                                                                                                                                                             | 'action_needed'                                                             | 'ready' | 'payouts_paused', requirementsDue[], transfersActive, payoutsEnabled, bankLast4?, disabledReason?, simulated}` |
| ★ `POST /tasker/account-session`                                                      | WS5                                 | tasker             | `{components:['account_onboarding'                                                                                                                                                           | 'notification_banner'                                                                                               | 'payouts'                                                                                                                                                                                                                                                                                                  | 'account_management']}`→`{clientSecret}` (a new session on every call [S8]) |
| ★ `POST /tasker/account-link`                                                         | WS5                                 | tasker             | hosted fallback → `{url}`                                                                                                                                                                    |
| ★ `POST /sim/connect/onboarding`                                                      | WS5                                 | tasker (fake only) | accepts only Stripe Connect test values [S12]                                                                                                                                                |
| ★ `POST /taskers/apply`, `POST /tasker/profile`, `PUT /tasker/availability`           | WS5                                 | tasker             | profile, rate within admin bounds, rules                                                                                                                                                     |
| ◐ `POST /payouts/run`                                                                 | WS5                                 | admin, cron        | per-tasker isolation; per-booking `transfers` rows (§7.3)                                                                                                                                    |
| ★ `POST /payouts/preview`                                                             | WS5                                 | admin              | same plan, no side effects                                                                                                                                                                   |
| ★ `POST /support/requests`, `POST /support/requests/:id/{assign,reply,resolve}`       | WS6                                 | client, staff      |                                                                                                                                                                                              |
| ★ `POST /admin/refund-approvals`, `POST /admin/refund-approvals/:id/{approve,reject}` | WS6                                 | agent → admin      | approver must be an admin **and** not the requester (server check)                                                                                                                           |
| ★ `POST /admin/disputes/:id/evidence`                                                 | WS6                                 | admin              | Stripe mode: one submission only [S17]; fake: sets the outcome from `winning_evidence` / `losing_evidence`                                                                                   |
| ◐ `POST /admin/disputes/simulate`                                                     | WS6                                 | admin (fake)       | adds `open`, inquiry statuses and `amountCents`                                                                                                                                              |
| ★ `POST /admin/sim/events`                                                            | WS6                                 | admin (fake)       | `{type, bookingId                                                                                                                                                                            | taskerId, scenario}`→ builds a Stripe-shaped event and calls WS4's`processEvent()` (the same path as real webhooks) |
| ★ `POST /admin/stripe-events/:id/replay`                                              | WS6                                 | admin              | re-processes a stored payload                                                                                                                                                                |
| ★ `POST /admin/policies/validate`                                                     | WS6                                 | admin              | dry run of publish                                                                                                                                                                           |

### 4.4 Provider interface (`_shared/provider/types.ts`, owned by WS4, defined in Wave 0)

```ts
type PaymentInput =
  | { kind: "confirmation_token"; id: string } // ctoken_… from stripe.createConfirmationToken
  | { kind: "saved_method"; paymentMethodId: string } // pm_… on the customer
  | { kind: "simulated"; token: SimToken }; // fake provider only
interface IntentResult {
  id: string;
  status:
    "requires_action" | "requires_capture" | "succeeded" | "canceled" | "requires_payment_method";
  amountCents: number;
  clientSecret?: string;
  chargeId?: string;
  captureBefore?: string;
  paymentMethodId?: string;
  declineCode?: string;
  balanceTxn?: BalanceTxn;
}
interface PaymentsProvider {
  readonly name: "fake" | "stripe";
  ensureCustomer(userId: string, email: string): Promise<{ customerId: string }>;
  customerSession(customerId: string): Promise<{ clientSecret: string } | { simulated: true }>;
  holdOnSession(i: {
    amountCents;
    customerId;
    payment: PaymentInput;
    bookingId;
    idempotencyKey;
  }): Promise<IntentResult>;
  setupOnSession(i: {
    customerId;
    payment: PaymentInput;
    idempotencyKey;
  }): Promise<{ status; clientSecret?; paymentMethodId?; setupIntentId }>;
  holdOffSession(i: {
    amountCents;
    customerId;
    paymentMethodId;
    bookingId;
    kind: "hold" | "rehold";
    idempotencyKey;
  }): Promise<IntentResult>;
  chargeOffSession(i: {
    amountCents;
    customerId;
    paymentMethodId;
    bookingId;
    kind: "extras" | "fee" | "capture_fallback";
    idempotencyKey;
  }): Promise<IntentResult>;
  chargeOnSession(i: {
    amountCents;
    customerId;
    paymentMethodId;
    bookingId;
    kind: "tip";
    idempotencyKey;
  }): Promise<IntentResult>;
  retrieveIntent(id: string): Promise<IntentResult>;
  capture(piId: string, amountCents: number, idempotencyKey: string): Promise<IntentResult>;
  cancel(piId: string, idempotencyKey: string): Promise<IntentResult>; // errors are thrown, never swallowed
  refund(piId: string, amountCents: number, idempotencyKey: string): Promise<{ id; status }>;
  listMethods(customerId: string): Promise<Method[]>;
  detachMethod(pmId: string): Promise<void>;
  // Connect (implemented in stripe/connect.ts and fake/connect.ts by WS5)
  createConnectedAccount(i: { taskerId; email; idempotencyKey }): Promise<{ accountId }>;
  accountSession(accountId: string, components: ConnectComponent[]): Promise<{ clientSecret }>;
  accountLink(accountId: string, refreshUrl: string, returnUrl: string): Promise<{ url }>;
  retrieveAccount(accountId: string): Promise<AccountStatus>;
  transfer(i: {
    amountCents;
    destination;
    transferGroup;
    sourceTransaction?;
    payoutId;
    bookingId;
    idempotencyKey;
  }): Promise<{ id }>;
  reverseTransfer(transferId: string, amountCents: number, idempotencyKey: string): Promise<{ id }>;
}
```

The old `authorize`, `charge` and `transfer(TransferInput)` stay as deprecated wrappers until WS7 has moved its handlers over. They are deleted in Wave 2.

### 4.5 Money rendering contract (`src/components/ui/Money.tsx`, WS1)

`<Money cents kind tender? source policyVersion? sign? />` renders:

```html
<span
  data-money-cents="8350"
  data-money-kind="card_hold"
  data-tender="card"
  data-source="server"
  data-policy-version="2"
  >$83.50</span
>
```

- `kind` values: `subtotal, service_fee, tax, total, promo, points, wallet, card_hold, card_charge, card_capture, released, extras, expenses, tip, refund, refund_pending, tasker_net, commission, fee, balance, transfer, bank_payout, dispute_amount, dispute_fee`.
- `source` is `server` | `browser`.
- Existing test ids such as `quote-card` and `booking-total` are put **on** the `<Money>` element, so `toHaveText` keeps working.
- Negative values use `−` with `aria-label="minus"`. All money uses `tabular-nums`.

### 4.6 Component contracts between workstreams

| Component              | Owner | Used by                                              | Props / behaviour                                                                                                                              |
| ---------------------- | ----- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `PaymentSection`       | WS4   | WS2 (W4, direct-book panel), WS3 (tip, approval)     | `{purpose:'booking'                                                                                                                            | 'tip' | 'add_card', plan, amountCents, onChange(state:{ready:boolean, payment?:PaymentInput, consent?:{textVersion}, problem?:string}), testIdPrefix?}`. Shows saved cards first (radio list), "Add a card" mounts the Payment Element or the `SimulatedCardForm`, and includes `CardConsent`and`HoldDisclosure`. **Ava's and Ben's seeded simulated card is preselected**, with its consent already on file |
| `useConfirmPayment()`  | WS4   | WS2, WS3                                             | handles `payment.state === 'requires_action'`: `stripe.handleNextAction({clientSecret})` or `SimulatedBankCheck`, then `POST /payment/confirm` |
| `PaymentApprovalSheet` | WS4   | WS3 (`/bookings/:id?pay=1`), WS1 (header badge link) | §2.4 of the winner proposal                                                                                                                    |
| `HoldChip`             | WS1   | WS2, WS3, WS5, WS6                                   | `{state, amountCents, captureBefore?, holdAt?}` → "Hold $83.50 · releases by Nov 9", with a "Hold, not a charge" popover [S2]                  |
| `ReconcileBanner`      | WS1   | WS3, WS5, WS6                                        | `{preview, result}` → "Settled as previewed" or a diff table                                                                                   |
| `RequirementsList`     | WS1   | WS2, WS3, WS5                                        | lists the reasons a submit button is disabled                                                                                                  |
| `MessagesPanel`        | WS3   | WS5 (job page)                                       | `{bookingId, role}`                                                                                                                            |
| `ConnectProvider`      | WS5   | WS5                                                  | one `loadConnectAndInitialize` per session [S8]; `logout()` only at sign-out (WS1's `signOut` calls the registered hook)                       |
| `StatusChip` tone map  | WS1   | all                                                  | §12                                                                                                                                            |

### 4.7 WS7-b additions (additive, no frozen contract changed)

- Job `expire-pending-payments` (`POST /jobs/expire-pending-payments`, system only, every 5 min): `pending_payment` bookings past `payment_expires_at` become `payment_abandoned` through the no-fault release path (slot freed, points and promo returned, PaymentIntent canceled, no fee, no strike). Optional body `{bookingId}`. Response `{checked, abandoned[], errors[]}`.
- Notification kind `payment_abandoned`.
