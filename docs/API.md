# TaskNest API

The `api` Edge Function is the only way money moves in TaskNest. The browser reads data straight from Postgres through `supabase-js` under row-level security, and sends every write to this API. Design notes, the ledger model and operations are in [`BACKEND_NOTES.md`](BACKEND_NOTES.md); the product rules are in [`SPEC.md`](SPEC.md).

|                   |                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base URL (hosted) | `https://pfqvqencsbxauafahezw.supabase.co/functions/v1/api`                                                                                                      |
| Base URL (local)  | `http://127.0.0.1:54321/functions/v1/api` (`supabase functions serve`)                                                                                           |
| Stripe webhook    | `https://pfqvqencsbxauafahezw.supabase.co/functions/v1/stripe-webhook` (separate function, no JWT)                                                               |
| Source            | `supabase/functions/api/` (handlers), `supabase/functions/_shared/` (DB, ledger postings, points, providers), `supabase/functions/_shared/domain/` (money rules) |

## Conventions

- **Auth.** Send `Authorization: Bearer <Supabase access token>` and `apikey: <publishable key>`. The gateway verifies the JWT (`verify_jwt = true`); the function then loads the caller's role from `profiles`. Only the tasker, client or staff on a booking can act on it; anyone else gets `404 not_found`.
- **Money** is integer cents; **points** are integers. Every response amount is an integer.
- **Idempotency.** Every mutating endpoint (marked ✓ below) accepts `Idempotency-Key: <8–200 chars>`, scoped to the caller.
  - A repeat with the same key and the same body returns the first response (same status and body) with the header `Idempotent-Replayed: true`. Nothing runs twice.
  - The same key with a different body or path returns `422 idempotency_key_reused`.
  - While the first request is still running, a repeat returns `409 request_in_progress`.
  - `5xx` responses and `409 busy` are never stored, so retrying with the same key is always safe. The UI reuses the key after network errors and 5xx.
- **Concurrency.** Requests that touch the same booking (or the same client's points, or the same tasker's payouts) are serialized with short leases. A request that waits more than ~5 s gets `409 busy` (retryable).
- **Errors** are always `{"error": {"code": "...", "message": "..."}}` with a 4xx/5xx status (`details` is added for policy validation). Rule violations from the money domain (tip over the cap, refund over the refundable amount, below-minimum points, and so on) are `422 rule_violation` with the domain's message.
- **Policy versions.** A booking stores `policy_version` when it is created and every later calculation (cancel, refund, tip, no-show, dispute) uses that version. New quotes and bookings use the policy in effect at the time (highest version whose `effective_from` has passed).

### Status codes

| Status | Codes                                                                                                                                                                                                                                                     |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `bad_request` (missing/invalid field, invalid date, bad uuid), `bad_json`, `test_clock_disabled`                                                                                                                                                          |
| 401    | `unauthorized` (no or invalid session)                                                                                                                                                                                                                    |
| 402    | `card_declined` and other card errors from the provider                                                                                                                                                                                                   |
| 403    | `forbidden` (wrong role), `unverified` (email not confirmed), `test_clock_forbidden`, `fake_provider_only`                                                                                                                                                |
| 404    | `not_found` (unknown route, booking not visible to the caller, unknown tasker)                                                                                                                                                                            |
| 405    | `method_not_allowed`                                                                                                                                                                                                                                      |
| 409    | `illegal_state` (state machine), `slot_taken`, `tasker_unavailable`, `response_window_expired`, `too_early`, `already_reviewed`, `dispute_open`, `dispute_closed`, `provider_mismatch`, `conflict`, `constraint_violation`, `busy`, `request_in_progress` |
| 422    | `rule_violation`, `invalid`, `invalid_policy`, `idempotency_key_reused`                                                                                                                                                                                   |
| 5xx    | `db_error`, `misconfigured`, `payments_misconfigured` (e.g. a live Stripe key), `webhook_not_configured`, provider errors (502)                                                                                                                           |

### Test clock (fake provider only)

Tests need to act at exact times (for example exactly 48 h before a start). A request may send `x-test-now: <ISO timestamp>`, but only together with `x-test-clock: <token>`. An admin mints that token for one user with `POST /admin/test-clock`. A bare `x-test-now` is rejected with `403 test_clock_forbidden`; otherwise any client could claim a different time and dodge cancellation fees. With the Stripe provider the clock is disabled entirely (`400 test_clock_disabled`).

## Endpoints

| Method and path                     | Who                                    | ✓   | What it does                                                                   |
| ----------------------------------- | -------------------------------------- | --- | ------------------------------------------------------------------------------ |
| `GET /health`                       | any signed-in user                     |     | `{ok, service, build, provider}` (`provider` is `fake` or `stripe`)            |
| `POST /quote`                       | signed-in user                         |     | Price and tender split preview                                                 |
| `POST /bookings`                    | client, verified email                 | ✓   | Book a tasker (201)                                                            |
| `POST /bookings/:id/accept`         | tasker                                 | ✓   | `requested → accepted`, within `booking.taskerResponseHours` of booking        |
| `POST /bookings/:id/decline`        | tasker, admin                          | ✓   | `requested → declined`; releases the card authorization and reserved points    |
| `POST /bookings/:id/reschedule`     | client, tasker                         | ✓   | Move `start_at`; `original_start_at` (the cancellation anchor) never moves     |
| `GET /bookings/:id/cancel-preview`  | client, tasker, staff                  |     | Exactly what `cancel` would do now                                             |
| `POST /bookings/:id/cancel`         | client, tasker                         | ✓   | Client: cancellation curve. Tasker: full refund, strike, fee, maybe suspension |
| `POST /bookings/:id/no-show`        | tasker (`who: client`), admin          | ✓   | Client or tasker no-show rules                                                 |
| `POST /bookings/:id/start`          | tasker                                 | ✓   | `accepted → in_progress`                                                       |
| `POST /bookings/:id/complete`       | tasker                                 | ✓   | Capture, extras charge, redeem points, earn points                             |
| `POST /bookings/:id/tip`            | client                                 | ✓   | Card-only tip, 100% to the tasker                                              |
| `POST /bookings/:id/refund-preview` | support agent, admin                   |     | The exact refund plan, no side effects                                         |
| `POST /bookings/:id/refund`         | client (request), support agent, admin | ✓   | Refund (staff) or refund request (client, 202)                                 |
| `POST /bookings/:id/review`         | client                                 | ✓   | Rating; review bonus points once                                               |
| `POST /payouts/run`                 | admin, or the service-role key (cron)  | ✓   | Pay out eligible tasker balances                                               |
| `POST /admin/taskers/:id/status`    | admin                                  | ✓   | Suspend / activate a tasker (audited)                                          |
| `POST /admin/policies`              | admin                                  | ✓   | Publish a new money policy version (never retroactive)                         |
| `POST /admin/disputes/simulate`     | admin, fake provider                   | ✓   | Open / win / lose a card dispute                                               |
| `POST /admin/points/grant`          | admin, fake provider                   | ✓   | Test helper: grant bonus points                                                |
| `POST /admin/test-clock`            | admin, fake provider                   |     | Mint a test clock token for a user                                             |

### `POST /quote`

```json
{ "taskerId": "uuid", "minutes": 120, "promoCode": "WELCOME10", "pointsRequested": 1000 }
```

Response (Tara, 2 h, `WELCOME10`, 1,000 points):

```json
{
  "quote": {
    "rateCents": 4500,
    "minutes": 120,
    "subtotal": 9000,
    "serviceFee": 1350,
    "tax": 0,
    "total": 10350,
    "taskerCommission": 1350,
    "taskerNet": 7650,
    "platformRevenue": 2700
  },
  "allocation": {
    "parts": { "card": 8350, "points": 1000, "wallet": 0, "promo": 1000 },
    "pointsUsed": 1000
  },
  "discountCents": 1000,
  "promoCode": "WELCOME10",
  "policyVersion": 1,
  "points": { "available": 3100, "pending": 131 }
}
```

`quote` and `allocation` come straight from the domain (`quote()`, `promoDiscount()`, `allocateTenders()`). `points.available` is the net balance, and it is negative while the client owes clawed-back points. Errors: `409 tasker_unavailable`, `422 rule_violation` (promo already used/expired/first task only, below minimum redemption, not enough points), `404` unknown promo code.

### `POST /bookings`

```json
{
  "taskerId": "uuid",
  "localStart": "2026-11-02T09:00",
  "tz": "America/Los_Angeles",
  "minutes": 120,
  "description": "Mount a TV",
  "promoCode": "FIRST20",
  "pointsRequested": 500
}
```

`localStart` is wall-clock time in `tz` and must be a real calendar date and time (`2026-02-30T10:00` is rejected). It is converted to UTC with DST handled.

In one database transaction, the booking checks the tasker is active and the slot is free, allocates tenders, reserves points (oldest-expiring lots first), authorizes the card portion (manual capture), and inserts the booking, its tenders, the promo redemption and the `booking_hold` ledger txn. If anything fails, the authorization is voided.

`201`:

```json
{
  "booking": {
    "id": "uuid",
    "status": "requested",
    "policy_version": 1,
    "start_at": "...",
    "original_start_at": "...",
    "subtotal_cents": 9000,
    "service_fee_cents": 1350,
    "tax_cents": 0,
    "total_cents": 10350,
    "points_reserved": 500,
    "stripe_payment_intent_id": "pi_...",
    "auth_expires_at": "...",
    "...": "..."
  },
  "tenders": [
    {
      "booking_id": "uuid",
      "tender": "card",
      "amount_cents": 9850,
      "refunded_cents": 0,
      "points": 0
    },
    {
      "booking_id": "uuid",
      "tender": "points",
      "amount_cents": 500,
      "refunded_cents": 0,
      "points": 500
    }
  ],
  "quote": { "...": "..." },
  "allocation": { "...": "..." },
  "discountCents": 0,
  "policyVersion": 1,
  "needsReauth": false
}
```

Errors: `403 forbidden` (not a client), `403 unverified`, `409 slot_taken` (overlapping active booking, also under races), `409 tasker_unavailable`, `422 rule_violation` (start in the past, booking yourself, points rules), `402 card_declined` (fake provider: `paymentMethod: "pm_card_chargeDeclined"`).

### Lifecycle: accept, decline, reschedule, start

Body: `{}` (`decline` takes an optional `reason`; `reschedule` takes `{ "localStart": "YYYY-MM-DDTHH:mm" }` in the booking's time zone). Response: `{ booking, tenders }`. `decline` also returns `refund` (everything back) and `strike: null`. Illegal transitions (for example completing a booking that was never started) are `409 illegal_state`.

### `GET /bookings/:id/cancel-preview` and `POST /bookings/:id/cancel`

Cancel body: `{ "reason": "plans changed" }`.

- **Client.** `clientCancellation()` with the booking's policy version, measured from `original_start_at`. Tier boundaries are inclusive (exactly 48 h before is the 100% tier, one second less is 50%). The fee comes from the tenders in `retentionOrder` (card first) and only the kept card amount is captured. Kept points are redeemed and the rest are released. The tasker is paid for unrefunded labor only (less commission).
- **Tasker.** The client gets everything back and the tasker gets a strike and the `$10.00` fee (`taskerPenalty`). With `strikesToSuspend` strikes inside `strikeWindowDays` the tasker is suspended. A `requested` booking must be declined instead (`409`).

```json
{
  "booking": { "status": "canceled_client", "captured_cents": 5175, "...": "..." },
  "tenders": ["..."],
  "outcome": {
    "tierIndex": 1,
    "hoursBefore": 47.99,
    "retainedCents": 5175,
    "refundCents": 5175,
    "taskerPayCents": 3825,
    "platformCents": 1350
  },
  "refund": {
    "refundCents": 5175,
    "retainedCents": 5175,
    "perTender": { "card": 5175, "points": 0, "wallet": 0, "promo": 0 },
    "kept": { "card": 5175, "points": 0, "wallet": 0, "promo": 0 }
  },
  "strike": { "feeCents": 1000, "strikesInWindow": 2, "suspended": false }
}
```

`strike` is only present for tasker cancellations. The preview returns `{ who, policyVersion, outcome, refund }` and changes nothing.

### `POST /bookings/:id/no-show`

`{ "who": "client" | "tasker", "reason"?: "..." }`, only after the start time. `who: "client"` (the tasker or an admin reports it) keeps `100% - noShowRefundBps` and pays the tasker for the unrefunded labor. `who: "tasker"` is admin-only and works like a tasker cancellation (strike and fee).

### `POST /bookings/:id/complete`

`{ "extraMinutes"?: 30, "expensesCents"?: 1250 }`. The card is captured up to the authorized amount; an authorization past its validity is charged again instead. Extras (extra time at the booking's rate plus the service fee, plus expenses passed through 100% to the tasker) are a **separate** card charge. Reserved points are redeemed and points are earned on the card cash (excluding tax and tips), pending `points.pendingDays`.

```json
{
  "booking": {
    "status": "completed",
    "captured_cents": 9350,
    "extra_cents": 3838,
    "extra_labor_cents": 2250,
    "extra_service_fee_cents": 338,
    "expenses_cents": 1250,
    "extra_payment_intent_id": "pi_...",
    "points_earned": 131
  },
  "tenders": ["..."],
  "captured": { "cardCents": 9350, "extrasCents": 3838, "pointsRedeemed": 1000 },
  "pointsEarned": 131
}
```

### `POST /bookings/:id/tip`

`{ "amountCents": 2000 }` (the optional `tender` must be `card`). Only on `completed` bookings, within `tips.windowDays` of completion. The cap (`tips.capBpsOfSubtotal` of the subtotal) applies to **all tips on the booking together**. The tasker gets 100%.

```json
{
  "tip": {
    "id": "uuid",
    "amountCents": 2000,
    "taskerGets": 2000,
    "platformFee": 0,
    "paymentIntentId": "pi_...",
    "tippedTotalCents": 2000
  }
}
```

### `POST /bookings/:id/refund-preview` and `POST /bookings/:id/refund`

Body: `{ "kind": "full" | "partial" | "goodwill", "amountCents": 3000, "reason": "...", "approvedBy"?: "<admin profile uuid>" }`. For `full`, the refundable amount is refunded whatever `amountCents` says (the UI sends the refundable amount).

- **Client** → `202 { "requested": true, "bookingId", "kind", "amountCents" }`. This is a request only; it is recorded in `audit_log` as `refund_requested` for support.
- **Support agent / admin** → `planRefund()` with the booking's figures including extras:
  - Split across tenders in `refundOrder` (card, wallet, points, promo) and never more per tender than it paid (also a database CHECK).
  - Card money goes back through the provider (main payment first, then the extras payment).
  - Returned points go back to their lot, or are reissued with a 30-day expiry if that lot has expired.
  - Points earned on the reversed card cash are clawed back. When the client doesn't have them any more the balance goes negative, which blocks redemptions.
  - The tasker's proportional share (`floor(amount × (subtotal − commission) / total)`) is clawed back. `goodwill` is paid entirely by the platform.
  - An agent above `refunds.agentLimitCents` needs `approvedBy`, which must be an admin other than themself. Only admins can refund after `refunds.windowDays`.
  - A booking with an open dispute cannot be refunded.

```json
{
  "refund": {
    "id": "uuid",
    "kind": "partial",
    "amountCents": 7000,
    "perTender": { "card": 6350, "points": 650, "wallet": 0, "promo": 0 },
    "taskerClawbackCents": 5173,
    "platformCostCents": 1827,
    "requiresApproval": false,
    "approvedBy": null,
    "pointsReturned": 650,
    "pointsClawedBack": 63,
    "pointsDebt": 0,
    "providerRefundIds": ["re_..."]
  },
  "booking": { "...": "..." },
  "tenders": ["..."]
}
```

The preview returns `{ refundableCents, plan: { perTender, taskerClawbackCents, platformCostCents, requiresApproval, amountCents }, pointsReturned, pointsClawedBack, policyVersion }` and is exactly what `refund` then does. Errors: `422` (`refund exceeds refundable amount (…)`, `nothing left to refund`, `agent refund above limit needs approval`, `refund window has passed`, `approvedBy must be an admin`), `409 illegal_state` (nothing captured, or disputed).

### `POST /bookings/:id/review`

`{ "rating": 1-5, "body": "..." }`. Only for `completed` bookings, once (`409 already_reviewed`). It grants `points.reviewBonusPoints` bonus points, available immediately. Response: `{ review, bonusPoints }`.

### `POST /payouts/run`

Admin, or a scheduled job calling with the service-role key (which is accepted on this route only). Optional `{ "taskerId": "uuid" }`. For each tasker, `planPayout()` over the unpaid bookings whose hold (`payouts.holdDays`) has passed and whose card money is settled (not disputed), plus every other balance adjustment (clawbacks, disputes lost after a payout, penalties). A negative or zero balance, a non-active tasker, or a missing payout account blocks the payout.

```json
{
  "payouts": [
    {
      "taskerId": "uuid",
      "payoutId": "uuid",
      "amountCents": 12345,
      "bookingIds": ["..."],
      "transferId": "tr_...",
      "balanceCents": 0
    },
    {
      "taskerId": "uuid",
      "amountCents": 0,
      "balanceCents": -7650,
      "blockedReason": "balance is zero or negative"
    }
  ]
}
```

Concurrent runs cannot pay twice: a lease per tasker covers the transfer and the ledger write, and the payout id and transfer idempotency key are derived from the ledger state.

### Admin

- `POST /admin/taskers/:id/status` `{ "status": "active" | "suspended" | "pending", "reason": "..." }` → `{ tasker }` (audited).
- `POST /admin/policies` `{ "policy": <full MoneyPolicy>, "effectiveFrom": "ISO", "reason": "..." }` → `{ version, effectiveFrom, policy }`. The policy is validated (bps ranges, tender orders, `tips.platformFeeBps` must be 0, …; `422 invalid_policy` lists every problem). `effectiveFrom` may not be in the past, and the version is the next integer.
- `POST /admin/disputes/simulate` `{ "bookingId": "uuid", "outcome": "won" | "lost" | "open", "amountCents"?: n }` → `{ dispute, booking, events, taskerBalanceCents, refundableCents }`. Fake provider only; this runs the same code path as real `charge.dispute.*` webhooks. A lost dispute reverses the card portion, charges the `$15.00` dispute fee, recovers the tasker's proportional share (their balance may go negative) and claws back earned points. A won dispute restores `completed`.
- `POST /admin/points/grant` `{ "userId": "uuid", "points": n, "reason"? }` → `{ lotId, points }` (fake provider only).
- `POST /admin/test-clock` `{ "userId": "uuid", "ttlSeconds"?: 3600 }` → `{ userId, token, expiresAt }` (fake provider only, TTL ≤ 24 h).

### Stripe webhook (`stripe-webhook` function)

`POST /functions/v1/stripe-webhook`, deployed with `verify_jwt = false`. Every event must carry a valid `Stripe-Signature` (HMAC-SHA256 with `STRIPE_WEBHOOK_SECRET`, 5-minute tolerance), otherwise `400 bad_signature`; without the secret it returns `503 webhook_not_configured`. Each event id is processed once (`stripe_events`, in the same transaction as its effects). `charge.dispute.created`, `.updated` (`under_review`) and `.closed` (`won`/`lost`) drive the dispute flow; other events are recorded and ignored. The `api` function also routes `POST /webhooks/stripe`, but the hosted `api` requires a JWT, so Stripe must use the `stripe-webhook` URL.

## Reading data (PostgREST, under RLS)

| Table / view                                                                                                          | Readable by                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `money_policies`, `reviews`                                                                                           | everyone (anon included)                                                                                                                                                                |
| `taskers`                                                                                                             | active taskers: everyone; own row; staff                                                                                                                                                |
| `display_names` (`id`, `display_name`)                                                                                | self; staff; everyone for active taskers; the other party of a shared booking. A tasker's name is their full name; everyone else shows as **first name only**. Emails are never exposed |
| `profiles`                                                                                                            | own row; staff                                                                                                                                                                          |
| `bookings`, `booking_tenders`, `refunds`, `tips`, `disputes`                                                          | the booking's client and tasker; staff                                                                                                                                                  |
| `points_lots`, `points_movements`, `promo_redemptions`, `points_balances`                                             | own rows; staff                                                                                                                                                                         |
| `payouts`, `tasker_strikes`, `tasker_balances`                                                                        | own tasker rows; staff                                                                                                                                                                  |
| `ledger_lines`                                                                                                        | staff; a tasker's own `tasker_payable` lines                                                                                                                                            |
| `ledger_txns`, `audit_log`, `stripe_events`, `idempotency_keys`                                                       | staff                                                                                                                                                                                   |
| `integrity_violations`, `ledger_trial_balance`, `ledger_unbalanced_txns`, `points_integrity`, `booking_money_summary` | staff (views run with the caller's RLS)                                                                                                                                                 |

`select * from integrity_violations` must always be empty (see `BACKEND_NOTES.md`).
