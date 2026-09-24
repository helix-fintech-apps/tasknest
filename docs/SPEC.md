# TaskNest — build spec (shared by all agents)

TaskRabbit-style service marketplace used as a Helix test subject. Money correctness is the point.

## Ground rules
- Money = integer cents; points = integers. Never floats for money.
- All money logic lives in `supabase/functions/_shared/domain/*.ts` (already written + 27 passing unit tests in `tests/unit/`). Reuse it; do not duplicate logic in the UI or the API.
- Imports inside `supabase/functions` use explicit `.ts` extensions (Deno). The Vite app imports the same files via the alias `@domain` → `supabase/functions/_shared/domain`.
- Policy: `DEFAULT_POLICY` (config.ts) = `money_policies` row version 1. Bookings store `policy_version`; always evaluate a booking with ITS version.
- Writes to money tables happen ONLY in the `api` Edge Function with the service role. Browser reads via supabase-js under RLS.
- Every money event posts a balanced ledger txn (`ledger.ts` → `ledger_txns` + `ledger_lines`; DB trigger rejects unbalanced txns).
- Every mutating endpoint accepts an `Idempotency-Key` header; repeats return the first result.
- Payments provider interface with two implementations: `stripe` (test mode, used when `STRIPE_SECRET_KEY` starts with `sk_test_`) and `fake` (deterministic in-memory/DB, used in CI and local dev when no key). Refuse to run with a live key (`sk_live_`).

## Supabase
- Project: `tasknest` id `pfqvqencsbxauafahezw` (us-west-1). Migrations in `supabase/migrations/` (schema, RLS, policy seed).
- Demo users (seed): client `ava@tasknest.test`, client `ben@tasknest.test`, taskers `tara@tasknest.test` (Handyman $45/h, active), `leo@tasknest.test` (Cleaning $38/h, active), `pia@tasknest.test` (Moving $60/h, pending KYC), admin `admin@tasknest.test`, support `agent@tasknest.test`. Password for all: `TaskNest!2026` (test only).

## API (Edge Function `api`, JSON, auth = Supabase JWT)
| Method + path | Who | Does |
|---|---|---|
| POST /quote `{taskerId, minutes, promoCode?, pointsRequested?}` | client | Quote + tender allocation preview |
| POST /bookings `{taskerId, localStart:"YYYY-MM-DDTHH:mm", tz, minutes, description, promoCode?, pointsRequested?}` | verified client | Validate tasker active + slot free; allocate tenders; reserve points; authorize card (manual capture); insert booking + tenders; ledger |
| POST /bookings/:id/accept · /decline | tasker | State change; decline → release auth + points |
| POST /bookings/:id/reschedule `{localStart}` | client/tasker | New start_at; original_start_at unchanged |
| POST /bookings/:id/cancel `{reason}` | client or tasker | Client: curve (cancellation.ts) + refundAfterRetention; Tasker: full refund + strike + fee; suspend at 3 strikes/30d |
| POST /bookings/:id/no-show `{who}` | tasker/admin | Client or tasker no-show rules |
| POST /bookings/:id/start · /complete `{extraMinutes?, expensesCents?}` | tasker | Capture card (≤ authorized; extras as separate charge), redeem reserved points, earn points (pending 7d), post ledger |
| POST /bookings/:id/tip `{amountCents}` | client | validateTip; card only; 100% to tasker |
| POST /bookings/:id/refund `{kind, amountCents, reason, approvedBy?}` | client(request)/support/admin | planRefund → per-tender refunds, points returned, earned points clawed back, tasker clawback, ledger |
| POST /bookings/:id/review `{rating, body}` | client | Only for completed; bonus points once |
| POST /payouts/run | admin / cron | planPayout per tasker |
| POST /webhooks/stripe | Stripe | Verify signature; process each event id once (`stripe_events`); disputes created/closed → disputeLost/won |
| POST /admin/taskers/:id/status `{status, reason}` | admin | Suspend/activate; audit log |
| POST /admin/disputes/simulate `{bookingId, outcome}` | admin (fake provider only) | Test hook for dispute flows |

Errors: `{error: {code, message}}` with 4xx.

## UI (Vite + React + TS + Tailwind, light theme, blue accent)
Pages: Sign in · Browse taskers · Tasker profile + book (quote panel showing subtotal, service fee, tax, promo, points, wallet, card) · My bookings (cancel shows the exact refund before confirming; reschedule; tip; review; request refund) · Points (available, pending, history, expiring) · Tasker dashboard (requests, accept/decline, start/complete with extras, earnings, balance, payouts, strikes) · Admin/support console (bookings search, refunds incl. goodwill with approval, suspend tasker, disputes simulate, ledger view) · Pricing & policies page rendered from the active money policy (fees, cancellation curve, tips, points rules) — Helix reads this as "published terms".
Use `data-testid` attributes on key controls for Playwright.
