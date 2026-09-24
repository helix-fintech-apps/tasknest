# TaskNest

TaskNest is a TaskRabbit-style marketplace: clients book local taskers by the hour, pay with a card, loyalty points or promo credit, and can cancel, reschedule, tip, review and request refunds. Taskers accept jobs, finish them and get paid out. Support agents and admins handle refunds, suspensions, disputes and payouts.

It is a **test subject for a fintech QA product**, so money correctness is the point: amounts are integer cents, every money event posts a balanced double-entry ledger transaction, and the published terms on the Pricing page are rendered from the same policy row the server settles with.

See [`docs/SPEC.md`](docs/SPEC.md) for the full build spec and API contract.

## Stack

| Layer        | Tech                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------- |
| Frontend     | Vite 5, React 18, TypeScript, Tailwind CSS v4, React Router 6                            |
| Backend      | Supabase (Postgres + RLS, Auth), Edge Function `api` (Deno)                              |
| Money domain | `supabase/functions/_shared/domain/*.ts`, shared by the API and the UI (`@domain` alias) |
| Payments     | Stripe test mode, or a deterministic `fake` provider for CI and local dev                |
| Tests        | Vitest (domain unit tests), Playwright (e2e)                                             |

### How the frontend handles money

- **Reads** go straight to Postgres through `supabase-js`, under row-level security. Other people's names come from `display_names` (a tasker's full name, everyone else's first name) and `taskers.display_name`; `profiles` is private and only read for the signed-in user.
- **Writes** always go to the `api` Edge Function (`src/lib/api.ts`). Each request carries the user's JWT and an `Idempotency-Key`. The key is reused when the request may not have run to completion: a network error, a 5xx, or `409 busy` / `409 request_in_progress` (which the client also retries automatically a few times, with the same key). Any other 4xx is a final answer, so the next attempt gets a new key. A retry therefore cannot double-charge.
- **Refunds**: a client's refund is only a request (`202 {requested: true}`) and the UI says so; support and admins issue refunds from the console.
- **Previews** (the quote panel, cancel refund, tip cap, refund split) call the shared domain functions (`quote`, `allocateTenders`, `promoDiscount`, `clientCancellation`, `refundAfterRetention`, `validateTip`, `planRefund`). They use the booking's own `policy_version`, and the tip cap counts the tips already paid on the booking. The console's refund preview asks the server (`POST /bookings/:id/refund-preview`) and falls back to the domain preview, with the extras charged at completion included, when that endpoint can't be reached. The server remains the source of truth, and the booking page shows a warning if the server's quote doesn't match the preview.
- **Policy versions**: the active policy (pricing page, new quotes) is the highest version whose `effective_from` has passed, the same rule as the API, so a version published for a future date never shows early.

## Pages

| Route                      | Who                  | What                                                                                                                       |
| -------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `/signin`                  | everyone             | Email/password sign-in and the list of demo accounts                                                                       |
| `/taskers`, `/taskers/:id` | client               | Browse taskers, profile, booking form with a live quote panel                                                              |
| `/bookings`                | client               | Cancel (shows the exact refund before you confirm), reschedule, tip, review, request a refund                              |
| `/points`                  | client               | Available, pending and expiring points, lots, history                                                                      |
| `/tasker`                  | tasker               | Requests (accept/decline), start/complete with extra time and expenses, earnings, balance, payouts, strikes, status banner |
| `/console`                 | admin, support_agent | Booking search, refunds (full/partial/goodwill, approver), tasker suspend/activate, dispute simulation, payout run, ledger |
| `/pricing`                 | public               | Fees, cancellation curve, tips, points, refund order, rendered from the active `money_policies` row                        |

## Run locally

```bash
npm install
cp .env.example .env     # Supabase URL + publishable key
npm run dev              # http://localhost:5173
```

### Environment

| Variable                 | Purpose                                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`      | Supabase project URL (`https://pfqvqencsbxauafahezw.supabase.co`)                                                                                   |
| `VITE_SUPABASE_ANON_KEY` | Publishable/anon key. It is public, and RLS protects the data.                                                                                      |
| `E2E_BASE_URL`           | Playwright target. When unset, Playwright starts `npm run dev`.                                                                                     |
| `E2E_BACKEND=1`          | Also run the e2e tests that need the live backend (`e2e/backend.spec.ts`)                                                                           |
| `PW_CHROMIUM_PATH`       | Optional Chromium binary. Defaults to `/opt/pw-browsers/chromium` if it exists, otherwise the Playwright cache (`npx playwright install chromium`). |

Never commit `.env` or any service-role or Stripe secret. The browser only ever needs the publishable key.

## Demo accounts

All demo accounts use the password `TaskNest!2026`. They are for the test environment only.

| Email               | Role                               |
| ------------------- | ---------------------------------- |
| ava@tasknest.test   | client                             |
| ben@tasknest.test   | client                             |
| tara@tasknest.test  | tasker: Handyman, $45/h, active    |
| leo@tasknest.test   | tasker: Cleaning, $38/h, active    |
| pia@tasknest.test   | tasker: Moving, $60/h, pending KYC |
| admin@tasknest.test | admin                              |
| agent@tasknest.test | support agent                      |

For example, Tara for 2 hours is a $90.00 subtotal plus a $13.50 service fee (15%), for a $103.50 total.

## Scripts

| Script                            | Does                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| `npm run dev`                     | Vite dev server                                                                      |
| `npm run build`                   | Typecheck and production build to `dist/`                                            |
| `npm run preview`                 | Serve the build                                                                      |
| `npm run lint`                    | ESLint, zero warnings allowed                                                        |
| `npm run format` / `format:write` | Prettier check / write                                                               |
| `npm run typecheck`               | `tsc --noEmit`                                                                       |
| `npm test` / `npm run test:unit`  | Vitest unit tests for the money domain                                               |
| `npm run test:coverage`           | Unit tests with v8 coverage                                                          |
| `npm run test:api`                | API tests (`tests/api`) against `SUPABASE_URL` + `SUPABASE_ANON_KEY` (fake payments) |
| `npm run test:e2e`                | Playwright tests                                                                     |
| `npm run db:check`                | Database invariants (`scripts/ci/db_checks.sql`) against the local stack             |
| `npm run check:functions`         | `deno check` for the Edge Functions                                                  |
| `npm run bundle:functions`        | One-file bundles of the Edge Functions (for single-file deploy tools)                |

### E2E tests

- `e2e/ui.spec.ts` runs against a mocked Supabase and API (`e2e/mock-backend.ts`), so it needs no backend. It covers sign-in, role-based navigation, the Tara 2h quote, booking with a points and card split, promo codes, the cancel preview at every tier, the tip cap message (including tips already paid), tasker accept and complete with extras, the pending-tasker banner, the pricing curve, the agent refund approval, public display names, the server refund preview for a booking with extras and its browser fallback, `409 busy` retries with the same Idempotency-Key, client refund requests, dispute status on bookings, and a future policy version that must not be active yet.
- `e2e/backend.spec.ts` runs against the real project and is skipped unless `E2E_BACKEND=1`.

## Repo layout

```
src/                     React app (pages/, components/, lib/api.ts, lib/supabase.ts, lib/preview.ts)
supabase/functions/      Edge Functions; _shared/domain is the money core
supabase/migrations/     Schema, RLS, policy seed
tests/unit/              Domain unit tests
e2e/                     Playwright tests
docs/SPEC.md             Build spec shared by all agents
```
