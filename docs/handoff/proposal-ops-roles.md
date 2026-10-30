# TaskNest UX/IA proposal: roles and operations first

**Angle.** This proposal designs TaskNest from the people who run the money: taskers, support agents and admins. It gives taskers a full workspace (requests, calendar, invoices, earnings, payouts, payout-account setup) and gives staff a CRM-style console (queues, filterable tables, a Booking 360 page, refunds with approvals, disputes with an evidence builder, a ledger explorer, reconciliation and money health). The client flow is complete and solid, but it gets less space here than in the other two proposals (`proposal-marketplace.md`, `proposal-money-clarity.md`).

- **Repo:** `helix-fintech-apps/tasknest` at `65a45d8`, read-only. Nothing in the repo was changed.
- **Inputs:** `README.md`, `docs/SPEC.md`, `docs/API.md`, `docs/BACKEND_NOTES.md`, `docs/CI.md`, `.coderabbit.yaml`, `src/` (routes, `lib/api.ts`, `lib/data.ts`, the pages and their `data-testid`s), `supabase/migrations/…0001_schema.sql`, plus the five reader reports in this folder (`backend.md`, `frontend.md`, `stripe.md`, `taskrabbit.md`, `platform.md`) and `OWNER-NOTES.md`.
- **Stripe facts** were fetched from docs.stripe.com on 2026-10-29 for this proposal and are cited as `[S#]`. The URL list is in §16. The one non-docs page is Stripe's US dispute-fee support article `[S9]`.
- **TaskRabbit facts** are patterns only, paraphrased, cited as `[T#]` (fetched today for this proposal) or `[TR:H#]` (fetched today by the TaskRabbit reader, listed in `taskrabbit.md`). No TaskRabbit name, logo, illustration, program name or copy is used. TaskNest keeps its own name and brand.

**Owner decision that shapes every screen** (`OWNER-NOTES.md`, 29 Oct, "we will use simulated keys"):
- The default runtime is the deterministic `fake` provider. The Stripe integration is built correctly per the docs, but runs only when the owner sets test keys.
- Every Stripe touchpoint therefore has a **simulated twin**: a simulated card form that behaves like the Payment Element (test card numbers, a 3-D Secure challenge, declines), simulated Connect onboarding, simulated webhooks and simulated payouts. Every simulated step carries a visible **Simulated** label.
- Live keys are refused today on the server (`provider/index.ts`, `stripe.ts`) and in CI (`scripts/ci/check-live-keys.sh`). The UI adds a `pk_live_` refusal (§9.10).

---

## Contents

0. [Principles](#0-principles)
1. [Roles, permissions and what each role sees](#1-roles-permissions-and-what-each-role-sees)
2. [Information architecture and navigation](#2-information-architecture-and-navigation)
3. [Shared status vocabulary (booking, payment, payout, Connect, dispute)](#3-shared-status-vocabulary)
4. [Tasker workspace: every screen](#4-tasker-workspace)
5. [Support and admin console: every screen](#5-support-and-admin-console)
6. [Client and public: every screen](#6-client-and-public-screens)
7. [Interaction states](#7-interaction-states)
8. [Error codes to messages](#8-error-codes-to-messages)
9. [Stripe touchpoints and their simulated twins](#9-stripe-touchpoints-and-their-simulated-twins)
10. [Design system: brand, tokens, type, components](#10-design-system)
11. [Phone behaviour](#11-phone-behaviour)
12. [Accessibility](#12-accessibility)
13. [Backend: existing vs new endpoints](#13-backend-existing-vs-new)
14. [Test-id continuity](#14-test-id-continuity)
15. [Build order](#15-build-order)
16. [Sources](#16-sources)

---

## 0. Principles

1. **Work arrives as queues, not lists.** Taskers open the app to "what needs me now" (requests about to expire, jobs today, invoices to send, payout setup to finish). Staff open the console to a work queue with due dates, not to a table of every booking. Lists and tables still exist for search and audit.
2. **One object, one page, one timeline.** A booking has exactly one page per role: the client's Task page, the tasker's Job page, and the staff Booking 360. Each shows the same event timeline, filtered by what that role may see under RLS.
3. **The server owns every number.** The UI shows money only from API responses, ledger rows, server views or the shared `@domain` helpers run on the booking's own `policy_version` (the rule `.coderabbit.yaml` sets for `src/**`). Two current bugs come from breaking this rule: the tasker's "Earnings (net)" leaves out extras (`frontend.md` P1 #8) and the console Total ignores extras (P1 #9). In the new design, earnings come from the tasker's own `tasker_payable` ledger lines and totals come from a server view.
4. **Preview, reason, confirm, record.** Every staff or tasker action that moves money:
   - shows the server's preview first (`refund-preview`, `cancel-preview`, and a new payout preview);
   - requires a reason;
   - states who approves when a limit applies;
   - confirms with a button that names the consequence ("Refund $70.00 to card and points");
   - links to the audit row and the ledger transaction afterwards.
5. **Hold, charge, refund and pay out are different words, used exactly.** A **hold** is an authorization. A **charge** is a capture or an automatic-capture payment. A **refund** goes back to the original payment method. A **transfer** moves money from TaskNest to the tasker's Stripe balance. A **payout** moves money from that balance to the tasker's bank. Stripe's docs keep transfers and payouts separate [S18][S19], and so does every TaskNest screen.
6. **Simulated is always visible.** An environment bar and per-component **Simulated** badges show which provider is active (`GET /health` returns `provider`). Staff never have to guess whether a refund touched Stripe.
7. **Role-scoped embeds.** Stripe says to map your own user roles to the components and features you enable in an Account Session [S11]. TaskNest only ever creates Account Sessions for the signed-in tasker's own connected account. Staff see Connect state as read-only data plus a link to the Stripe Dashboard.
8. **Keep every existing `data-testid`.** The 23 mocked e2e tests depend on them. §14 maps old ids to new screens.

---

## 1. Roles, permissions and what each role sees

TaskNest has four authenticated roles (`profiles.role` = `client`, `tasker`, `admin`, `support_agent`) plus anonymous visitors. Taskers have three standings (`taskers.status` = `pending`, `active`, `suspended`), and the workspace changes with each one.

### 1.1 Capability matrix

✓ = allowed today by the API. ★ = needs a new endpoint or view (§13). — = not allowed.

| Capability | Public | Client | Tasker | Support agent | Admin |
|---|---|---|---|---|---|
| Browse taskers, profiles, ratings | ★ (ratings view) | ✓ (+★ ratings) | own profile | ✓ | ✓ |
| Quote (`POST /quote`) | — | ✓ | — | ✓ (any signed-in user) | ✓ |
| Book (`POST /bookings`) | — | ✓ verified email | — | — | — |
| Save cards, Payment Element | — | ★ | — | view metadata only | view metadata only |
| Accept, decline, start, complete | — | — | ✓ own bookings | — | decline ✓ |
| Reschedule | — | ✓ | ✓ | — | — |
| Cancel (with preview) | — | ✓ | ✓ (strike) | preview ✓ | preview ✓ |
| No-show | — | report ★ | `who:"client"` ✓ | — | ✓ both |
| Tip, review | — | ✓ | — | — | — |
| Refund | — | request (202) ✓ | — | ✓ up to $100 without approver | ✓ |
| Approve an agent's refund over the limit | — | — | — | — | ✓ (today as `approvedBy`), ★ as a queue |
| Disputes: view | — | own (status) | own (status) | ✓ | ✓ |
| Disputes: respond with evidence, accept | — | — | — | ★ draft | ★ submit |
| Payout run (`POST /payouts/run`) | — | — | — | — | ✓ (all or `taskerId`) |
| Payout account onboarding (Connect) | — | — | ★ | read-only ★ | read-only ★ |
| Tasker status (`active`/`suspended`/`pending`) | — | — | — | — | ✓ |
| Publish money policy | — | — | — | — | ✓ (no UI today) |
| Ledger, trial balance, integrity views | — | — | own `tasker_payable` lines | ✓ | ✓ |
| Audit log, Stripe events | — | — | — | ✓ | ✓ |
| Test hooks (dispute simulate, points grant, test clock) | — | — | — | — | ✓ fake provider only |

Notes:
- The agent refund limit is `refunds.agentLimitCents` = $100 in policy v1, and only admins may refund past `refunds.windowDays` = 30 (`docs/API.md`, `domain/config.ts`).
- Staff reads already work under RLS (`backend.md` §6). The console does not need new permissions for reading; it needs new **views** that join names, totals and payment state (§13.3).

### 1.2 Tasker standing changes the workspace

| Standing | What the workspace shows | What is blocked |
|---|---|---|
| `pending` (applied, not verified) | Setup checklist: profile, rate, availability, **payout account**. A banner explains that clients can't book until TaskNest activates the account. | Not listed publicly (RLS shows only active taskers). Booking returns `409 tasker_unavailable`. |
| `active` | Full workspace. A Stripe notification banner appears if Stripe needs more information [S14]. | Payouts are blocked while the payout account can't receive transfers (`blockedReason`, and ★ a transfers-capability gate, `stripe.md` gap #5). |
| `suspended` | Read-only workspace: history, earnings, payouts, standing. A banner gives the reason (from `audit_log`) and a "Contact support" action. | Accept and new bookings are blocked. Existing balances still pay out unless an admin holds them. |

---

## 2. Information architecture and navigation

### 2.1 Sitemap

`(★)` = needs new backend. `[S]` = has a simulated twin.

```
PUBLIC
/                              Home: search, categories, "from $X/h", how it works, trust strip
/services/:category            Category page: taskers in category, "from" price
/taskers/:id                   Public tasker profile (ratings ★ view)
/pricing                       Published terms (exists; rendered from money_policies)
/help, /help/:slug             Help centre, numbers rendered from the policy row
/become-a-tasker               Supply-side landing → sign up as tasker
/signin /signup /verify /reset Auth
*                              404 (today: silent redirect)

CLIENT  (bottom tabs on phone: Book · Tasks · Inbox · Account)
/book/:category                Step 1 Details (size → minutes, address ★, description)
/book/:category/taskers        Step 2 Choose a tasker
/book/:category/time           Step 3 Pick a time (availability ★)
/book/:category/review         Step 4 Review & pay (Payment Element [S])
/bookings                      My tasks: Needs action · Upcoming · Past
/bookings/:id                  Task page: timeline, money panel, actions, messages ★
/bookings/:id/pay              Payment approval (3DS / re-hold) [S]
/inbox                         Messages ★ and notifications
/account                       Profile, addresses ★, notifications
/account/cards                 Saved cards [S]
/points                        Points (exists)
/help/requests                 My support requests ★

TASKER  (bottom tabs on phone: Today · Requests · Calendar · Earnings · More)
/tasker                        Today
/tasker/requests               Requests inbox with countdowns
/tasker/calendar               Calendar: jobs + availability ★
/tasker/jobs                   All jobs (table / list)
/tasker/jobs/:id               Job page: start, invoice (complete), no-show, cancel, reschedule
/tasker/invoices               Invoices sent (completed jobs with extras and expenses)
/tasker/earnings               Statement: per-job lines from the ledger
/tasker/payouts                Payout pipeline + transfers + bank payouts [S]
/tasker/payouts/setup          Payout account onboarding (Connect) [S]
/tasker/profile                Profile, skills & rate ★
/tasker/standing               Rating, response rate ★, strikes, suspension rules
/tasker/tax                    Tax documents (Stripe Documents component) [S]
/tasker/apply                  Application wizard ★

CONSOLE  (support_agent and admin; left rail on desktop)
/console                       Work queue (default)
/console/bookings              Bookings table (saved views, filters)
/console/bookings/:id          Booking 360
/console/refund-requests       Client refund requests ★ (today only in audit_log)
/console/approvals             Refund approvals (admin) ★
/console/disputes              Disputes table
/console/disputes/:id          Dispute workspace: evidence builder, deadline
/console/clients[/:id]         Clients table / Client 360 ★ view
/console/taskers[/:id]         Taskers table / Tasker 360 (Connect state ★)
/console/payouts               Payout runs, eligibility preview ★, failed transfers ★ (admin)
/console/ledger                Ledger explorer (txns, accounts, trial balance)
/console/reconciliation        Ledger vs Stripe balance ★ (admin)
/console/health                Money health: integrity views, webhook backlog
/console/events                Stripe events log
/console/audit                 Audit log
/console/policies              Policy versions, diff, publish (admin)
/console/promos                Promo codes (read; admin create ★)
/console/team                  Staff and roles ★ (admin)
/console/test-tools            Simulated only: dispute, webhook, payout outcome, points, test clock
```

### 2.2 Navigation per role

| Role | Desktop | Phone (≤ 640 px) | Home after sign-in |
|---|---|---|---|
| Public | Top bar: logo, Services, Pricing, Help, "Become a tasker", Sign in, **Book a task** button | Top bar with logo + menu sheet; sticky "Book a task" | `/` |
| Client | Top bar: Book, My tasks (badge = needs action), Inbox, Points, avatar menu (Account, Cards, Help, Sign out) | Bottom tabs: Book, Tasks, Inbox, Account | `/bookings` if any booking needs action, else `/` |
| Tasker | Left rail: Today, Requests (badge = open), Calendar, Jobs, Invoices, Earnings, Payouts, Profile, Standing, Tax. A setup meter sits at the top of the rail until the checklist is done | Bottom tabs: Today, Requests, Calendar, Earnings, More (sheet) | `/tasker` |
| Support agent | Left rail: Queue (count), Bookings, Refund requests, Disputes, Clients, Taskers, Ledger, Health, Events, Audit. Global search and command palette (`Ctrl/⌘ K`). | Top bar + "Queue" and "Search" only; tables become lists; actions limited (§11.3) | `/console` |
| Admin | Agent rail plus Approvals, Payouts, Reconciliation, Policies, Promos, Team, Test tools (simulated only) | As agent | `/console` |

Global elements on every signed-in page:
- **Environment bar** (thin, top): "Payments: **Simulated** · no real money" (fake provider) or "Stripe **test mode** · API 2026-10-28.endive" (Stripe provider; the current API version per [S24]). Source: `GET /health`. Live mode is never shown because the server refuses live keys.
- **Notification bell**: in-app notifications ★ (request expiring, payment needs approval, payout failed, dispute due).
- **Skip link**, route-specific `<title>`, and focus moved to the page `<h1>` after navigation (§12).

### 2.3 URL rules

- Console tabs, filters, sorting and the selected row are in the URL (`/console/bookings?status=disputed&sort=-start_at&view=my-open`). Today the tabs are component state and can't be deep-linked (`frontend.md` P1 #18).
- Every object id in the console links to its 360 page. The ledger's "party" column shows names, not UUID prefixes (`frontend.md` P1 #17).
- Unknown routes render a 404 with links home, instead of silently landing on `/taskers`.

---

## 3. Shared status vocabulary

Every role sees the same words. Colours come from the status tokens in §10.2; the text label is always present, so colour is never the only signal.

### 3.1 Booking status (exists: `domain/booking.ts`, 10 values)

| `booking_status` | Client label | Tasker label | Staff label |
|---|---|---|---|
| `requested` | Waiting for tasker | New request (countdown) | Requested |
| `accepted` | Confirmed | Scheduled | Accepted |
| `declined` | Tasker declined | Declined | Declined |
| `in_progress` | In progress | In progress | In progress |
| `completed` | Done | Invoiced / Paid | Completed |
| `canceled_client` | You canceled | Client canceled | Canceled (client) |
| `canceled_tasker` | Tasker canceled | You canceled (strike) | Canceled (tasker) |
| `no_show_client` | Marked no-show | Client no-show | No-show (client) |
| `no_show_tasker` | Tasker didn't show | No-show (strike) | No-show (tasker) |
| `disputed` | Card dispute open | Payment disputed | Disputed |

### 3.2 Payment state (★ `bookings.payment_state`, proposed in `stripe.md` §5)

This is the layer that clients and staff need to see and that the schema lacks today.

| Payment state | Meaning | Who sees what |
|---|---|---|
| `hold_active` | Card authorized, manual capture. The real expiry is `capture_before` on the charge [S1]. | Client: "Hold $83.50 · expires Nov 5". Staff: same, plus the PaymentIntent id. |
| `hold_expiring` | `capture_before` is before the expected completion. A re-hold is due. | Staff queue item. Client: nothing yet. |
| `card_saved_no_hold` | Booking more than ~4 days ahead: card saved, hold placed later off-session (`stripe.md` §2.3). The 4 days come from Visa's merchant-initiated window, 4 days 18 hours [S1]. | Client: "Card saved · hold placed 2 days before". |
| `action_required` | An off-session charge or re-hold failed with `authentication_required`; the client must come back on-session [S4]. | Client: **Needs action** tab + notification. Staff queue. Tasker: "Client payment pending" (no card details). |
| `captured` | Main charge captured, maybe with an extras charge. | All: receipt. |
| `refund_pending` / `refund_failed` | Stripe refunds can be pending when the balance is short, and can fail up to 30 days later (`refund.failed`) [S5]. | Client: "Refund on its way" / "Refund failed, support will contact you". Staff queue for failed. |
| `disputed` | A card dispute is open (see §3.5). | Client: "Your bank is reviewing a dispute". Staff: dispute workspace. |

### 3.3 Tasker money pipeline (one strip used on Today, Earnings, Payouts, Tasker 360)

```
Earned ──▶ On hold (3 days) ──▶ Ready ──▶ Sent to payout account ──▶ Paying out to bank ──▶ In your bank
 ledger      policy payouts.    planPayout   Stripe Transfer (tr_)       Payout pending /        Payout paid
 tasker_     holdDays = 3       eligible     ★ source_transaction        in_transit              (or Failed)
 payable                                     [S19]                       [S18]                   [S18]
```

- **Earned** is the sum of the tasker's `tasker_payable` credits: net labour, extras net of commission, expenses, tips at 100% (`backend.md` §5).
- **On hold** follows `payouts.holdDays` (3) and dispute blocking in `planPayout`.
- **Sent to payout account** is a Transfer. With `source_transaction`, the transfer request succeeds immediately, but the funds become available in the tasker's Stripe balance only when the charge's funds are available to the platform [S19]. The UI says "Sent · becomes available when the card payment settles", never "Paid".
- **Paying out to bank** mirrors the Payout object's status: `pending`, `in_transit`, `paid`, `failed`, `canceled`. A standard payout is typically `paid` 1–2 business days after submission. A failed payout disables the bank account until it is updated [S18]. Connected-account balances pay out on a daily rolling basis by default [S18].
- Today the repo writes `payouts.status = 'paid'` when the transfer is created (`stripe.md` gap #18). The new design renames that row a **transfer** in the UI and tracks bank payouts separately (★ `connected_payouts`, from `payout.*` events [S18]).

### 3.4 Payout account (Connect) status

Derived from the account's requirements and capabilities, which arrive through `account.updated` (v1) [S12][S17]. The tasker sees the left column; staff see both.

| Tasker label | Condition (server-side) | Primary action |
|---|---|---|
| Not started | No `stripe_account_id`, or a seeded `acct_fake_*` | "Set up payouts" |
| In progress | Account exists, `details_submitted = false` | "Continue setup" |
| In review | Submitted; requirements pending verification | none; "We'll email you" |
| Action needed by {date} | `requirements.currently_due` not empty; `current_deadline` set | "Add missing info" (opens onboarding) |
| Payouts paused | `requirements.past_due` not empty: "the corresponding functionality is disabled" [S12] | "Fix now" |
| Ready | transfers capability active, `payouts_enabled = true` [S13] | "Manage payout account" |
| Bank account needs updating | last `payout.failed`; the external account is disabled [S18] | "Update bank account" |

Stripe says to send an account back through onboarding whenever it has `currently_due` or `eventually_due` requirements; the component knows what to collect [S12][S17].

### 3.5 Dispute status (all 10 Stripe values)

The repo stores only 4 (`disputes.status` CHECK), and `backend.md` F2 shows how that leaves bookings stuck. The console shows Stripe's real status [S6]:

| Stripe status | Console label | Due-date chip | Money (per [S6][S9]) |
|---|---|---|---|
| `warning_needs_response` | Inquiry · respond | yes | Answering with evidence, or a full refund, resolves it without a dispute fee; an unanswered inquiry can escalate to a likely unwinnable chargeback [S6]. |
| `warning_under_review` | Inquiry · submitted | — | — |
| `warning_closed` | Inquiry closed (120 days, no escalation) | — | Must release the booking (fixes F2). |
| `needs_response` | Chargeback · respond | yes (usually 7–21 days [S6][S7]) | Amount + $15 received fee debited at open [S6][S9]. |
| `under_review` | Chargeback · submitted | decision usually 60–75 days [S6] | +$15 countered fee if contested, returned on a win [S9]. |
| `won` | Won | — | Amount returned; received fee kept [S6][S7]. |
| `lost` | Lost | — | Permanent. Tasker clawback runs (existing domain). |
| `prevented`, `appeal_needs_response`, `appeal_under_review` | Shown as returned by Stripe, with a "see Stripe" link | — | Not modelled in the domain yet. |

A rare `lost → won` **late win** can happen [S6]; the dispute page shows it as a new timeline event, not an error (fixes the 409 retry loop in F2).

## 4. Tasker workspace

**Design goal.** A tasker should run their whole business from a phone in a van: answer requests before the timer runs out, see today's jobs, send an accurate invoice on site, know exactly where every dollar is, and finish payout setup without leaving TaskNest.

**Patterns borrowed (paraphrased, no copy):**
- Invitations carry countdown timers, and a missed window loses the task, so taskers keep notifications on and reply quickly. Taskers should mark only times they can really work and leave buffer time [T2].
- Invoices are due within 24 hours of finishing and cover hours worked plus eligible expenses. After a one-hour minimum, time is billed in 15-minute steps. If no work happened, the tasker cancels instead of invoicing [T1].
- Taskers set a rate per category and keep 100% of the rate and tips. Payouts go through Stripe and mostly arrive in 1–3 business days [T4].
- Bank payouts go to a checking account only [T3].

TaskNest keeps its own policy numbers. Its v1 policy bills per minute with no minimum, takes a 15% commission, and gives a 24-hour response window. The 1-hour minimum and 15-minute steps would be a money-policy change: a new `money_policies` version, domain unit tests and `/pricing`, never UI arithmetic (`taskrabbit.md` §8 P2).

Each screen below lists: **purpose**, **components**, **reads** (PostgREST under RLS) and **writes** (the `api` function, always with an `Idempotency-Key`), **states**, and any **Stripe** touchpoint. ★ marks new backend.

### T1. Today `/tasker`

- **Purpose:** the tasker's start screen. It answers "what needs me now, and where is my money".
- **Components:**
  - **Setup meter** (until done): Profile ✓, Rate ✓, Availability, Payout account. Each row deep-links to its screen. Hidden once all are done.
  - **Stripe notification banner** (Connect embedded `notification-banner`) for an `active` tasker. It "renders only when the connected account must respond to risk interventions or provide currently due requirements" after initial onboarding, and renders nothing before `details_submitted` [S14]. Simulated twin: a banner driven by the simulated requirements state, badged **Simulated**.
  - **Needs you now** list, ordered by deadline:
    - requests with a countdown (`created_at + taskerResponseHours`);
    - jobs starting within 2 h ("Start job");
    - finished jobs with no invoice yet ("Send invoice");
    - "Client payment pending" on jobs whose client has `action_required`.
  - **Today's jobs** as cards: time, client first name, short address ★, duration, booked amount (net), Start button.
  - **Money strip** (§3.3) with four amounts: Earned this week · On hold · Sent · Next bank payout. Each opens Earnings or Payouts.
  - **Standing chip:** rating ★, strikes in the last 30 days ("1 of 3"), status.
- **Reads:** `bookings` (own, `status in (requested, accepted, in_progress)`, today ± 1 day), `tasker_balances`, ★ `tasker_money_summary` view (earned, on hold, ready, sent, paying out), `tasker_strikes`, ★ `tasker_connect_status`.
- **Writes:** Accept / Decline inline (`POST /bookings/:id/accept|decline`).
- **States:**
  - Loading: skeleton cards.
  - Empty day: "No jobs today", plus "Open more hours" (→ Calendar) and "Share your profile".
  - Error: inline banner with Retry. Cached data stays visible, marked "as of 09:41".
  - Suspended: everything read-only, with a reason banner.
- **Phone:** this is the primary phone screen. The "Needs you now" list sits above the fold, and the money strip scrolls horizontally with snap.

### T2. Requests inbox `/tasker/requests`

- **Purpose:** decide on every new request inside the response window.
- **Components:**
  - **Request card:**
    - client first name and task description;
    - date and time in the task's time zone, with the zone label;
    - duration and address area ★;
    - **your earnings for the booked time**, from the booking's quote: `subtotal − commission`, the same as `taskerNet` in `POST /quote`;
    - a **countdown ring** with an "expires 3:12 PM" text.
  - **Accept** (primary) and **Decline** (secondary, opens a sheet with optional reason chips).
  - A **conflict warning** if the slot overlaps another job (client-side check over own bookings; the server's `slot_taken` check stays authoritative).
- **Reads:** own `bookings` where `status = requested`, `display_names`.
- **Writes:** `POST /bookings/:id/accept`, `POST /bookings/:id/decline {reason?}` (both exist).
- **States:**
  - Empty: "No requests waiting. Requests appear here as soon as a client books you."
  - Expired: the card greys out with "Window closed". Accept returns `409 response_window_expired`; the UI never offers the button after expiry.
  - Auto-decline ★: today there is no auto-decline job (`BACKEND_NOTES.md` known limitations). Until it exists, expired requests sit in an "Expired, waiting for the system" group.
- **Accessibility:** the countdown is text ("expires in 2 h 14 min"). A polite live region speaks only at thresholds (1 h, 15 min, 5 min), never every second (§12).

### T3. Calendar `/tasker/calendar` ★

- **Purpose:** publish when you can work, and see booked jobs against it.
- **Components:**
  - Week view (desktop) / agenda view (phone).
  - **Availability blocks** (weekly rules + date overrides) shown as a light fill; **jobs** as solid blocks showing status colour and client name.
  - "Add hours", "Block time off", copy-last-week.
  - A same-day toggle.
  - Conflict badges where a job falls outside published hours.
- **Reads:** own `bookings`, ★ `tasker_availability`.
- **Writes:** ★ `PUT /tasker/availability {weeklyRules[], overrides[]}`.
- **Why it matters for money:** the client's time step needs free slots (`taskrabbit.md` §1.5). The server should also enforce availability on `POST /bookings` and `reschedule` (★ `409 tasker_unavailable_at_time`).
- **States:** empty ("Add your first hours, or clients can't book you"), saving (optimistic with rollback on error), conflict (inline).

### T4. Jobs `/tasker/jobs` and Job page `/tasker/jobs/:id`

- **Jobs list:** filter chips Upcoming · In progress · To invoice · Done · Canceled. Columns: date, client, task, booked net, status, money state. Rows are links (keyboard-operable).
- **Job page purpose:** everything about one job, in time order.
- **Components:**
  - **Header:** status pill, date and time with zone, address ★, client first name.
  - **Primary action bar**, which changes with status:
    - `accepted`: Start job · Reschedule · More (Cancel job, Client didn't show).
    - `in_progress`: **Send invoice** (opens T5) · Client didn't show.
    - `completed`: View invoice · Message client.
  - **Timeline:** Requested → Accepted → Started → Invoiced → Card charged → (Tip) → Transfer sent → Paid out. Each event has a time, and staff-only events are filtered out.
  - **Your money for this job** (from ledger lines on this booking): labour net, extras net, expenses, tips, clawbacks, and the transfer it was paid in.
  - **Messages** ★ (thread with the client).
- **Reads:** own booking, `booking_tenders`, `tips`, `disputes`, own `ledger_lines` (`tasker_payable`), `payouts`.
- **Writes (all exist):**
  - `POST /bookings/:id/start`
  - `POST /bookings/:id/reschedule {localStart}`
  - `POST /bookings/:id/cancel {reason}`. The preview comes from `GET /bookings/:id/cancel-preview` (the server), not the browser domain preview used today (`frontend.md` §4).
  - `POST /bookings/:id/no-show {who:"client"}`. `api.noShow` exists but no page calls it today (`backend.md` §8).
- **Tasker cancel sheet:**
  - Leads with the consequence: "The client gets a full refund. You get a strike and a $10.00 fee." The amounts come from the policy row.
  - Shows "This is strike 2 of 3 in 30 days", and, if it applies, "Your account will be suspended", from the preview's `strike`.
  - Keeps `tasker-cancel-open`, `tasker-cancel-reason`, `tasker-cancel-confirm`.
- **Client no-show sheet:**
  - Enabled only after `start_at`. Before that, the server returns `409 too_early`, so the UI shows "Available from 9:00 AM".
  - Shows what the tasker will be paid for unrefunded labour (from the no-show preview ★ `GET /bookings/:id/no-show-preview`). It mirrors `cancel-preview` and reuses `clientNoShow()`.

### T5. Send invoice (complete) sheet

- **Purpose:** record extra time and expenses and trigger the capture. This is the tasker's highest-stakes action: it charges the client's card.
- **Components:**
  - **Booked time** (read-only) and **Extra time** stepper (minutes). If a future policy adds billing increments, the stepper snaps to them.
  - **Expenses**: today one amount (`expensesCents`). ★ Itemised rows (description, amount, receipt photo) with a per-item cap need a new policy version (`taskrabbit.md` §1.9).
  - A **preview panel** computed with `@domain` on the booking's policy version, labelled "estimate". After submit it is replaced by the server's `captured` figures:
    - "Client is charged $103.50 (held) + $38.38 extras".
    - "You earn $76.50 + $31.62".
  - An **Off-session note**: "Extras are charged to the client's saved card." If the client's card needs authentication, the job completes and the extras charge waits for the client (`action_required`, §9.4).
  - Confirm button: **"Send invoice and charge $141.88"**. Keeps `complete-open`, `complete-extra-minutes`, `complete-expenses`, `complete-preview`, `complete-confirm`.
- **Writes:** `POST /bookings/:id/complete {extraMinutes, expensesCents}` (exists).
- **Example (policy v1, Tara $45/h):** 2 h booked = $90.00 subtotal; commission $13.50; net $76.50. Extra 30 min = $22.50 labour + $3.38 service fee; $12.50 expenses. Extras charge $38.38; tasker extras net = $22.50 − $3.38 commission + $12.50 = $31.62. Figures from `docs/API.md` and `frontend.md` P1 #8.
- **States:**
  - Submitting: the button keeps its label, and a spinner sits in the button.
  - `409 busy`: auto-retried with the same key (exists in `api.ts`).
  - `402` on extras: "Extras couldn't be charged yet. The client has been asked to approve." The booking still completes.
  - Success: a toast ("Invoice sent"), and the Job page timeline updates.

### T6. Invoices `/tasker/invoices`

- **Purpose:** a list of what each client was charged for the tasker's work, for disputes and taxes.
- **Columns:** date · client · booked time · extra time · expenses · client charged (card + extras) · your net · status (charged, refunded partly, disputed).
- **Reads:** own `bookings` (`completed`, `disputed`) with figures from ★ `booking_money_summary` (exists as a staff-only view today; add a tasker-scoped version without client card details).
- **Actions:** open the Job page; download CSV ★ (client-side from the same rows, no money maths).

### T7. Earnings `/tasker/earnings`

- **Purpose:** a statement the tasker can trust, built from the ledger, so it always matches payouts.
- **Components:**
  - Period picker (this week, last week, month, custom).
  - **KPI tiles:** Earned · Tips · Adjustments (clawbacks, penalties) · Net. Each value is a sum of own `tasker_payable` ledger lines in the period.
  - **Statement table:** date · job · type (Labour, Extras, Expenses, Tip, Cancellation pay, Refund clawback, Dispute recovery, Strike fee, Transfer) · amount (± with a sign, never colour alone) · running balance.
  - "Why is this negative?" explainer when the balance is below zero, linking the clawback's booking.
- **Reads:** own `ledger_lines` joined to `ledger_txns.kind` (RLS already allows a tasker's own `tasker_payable` lines), `tasker_balances`. ★ `tasker_statement` view to add booking ids and readable kinds.
- **Fixes:** replaces the dashboard's "Earnings (net)", which ignores extras and expenses ($229.50 shown vs $261.12 true, `frontend.md` P1 #8).

### T8. Payouts `/tasker/payouts`

- **Purpose:** answer "when does my money reach my bank, and if not, why".
- **Components:**
  - **Pipeline strip** (§3.3) with amounts and counts.
  - **Next transfer** card: amount ready now, the next run time ("Payout runs daily at 06:00 UTC" ★ cron), and the blocked reason if any. Blocked reasons come from `planPayout`, plus ★ Connect gating:
    - "balance is zero or negative"
    - "account not active"
    - "payout account not ready"
  - **Transfers** table: date · amount · jobs included (expand) · transfer id · state (Sent, Reversed ★).
  - **Bank payouts**: in Stripe mode, the Connect embedded **Payouts** component. It "renders the balance summary, the payout schedule, and a list of payouts" and can allow instant or manual payouts [S15]. TaskNest enables `payouts` with `instant_payouts=false`, `standard_payouts=false`, `edit_payout_schedule=false` and `external_account_collection=true`, so taskers can see and fix their bank account but can't change the schedule. Instant payouts need extra platform setup and eligibility [S15], so they are out of scope.
  - In simulated mode, a native table shows the same columns (status `pending`, `in_transit`, `paid`, `failed`, `canceled`, from [S18]), badged **Simulated**.
  - **Payout failed** banner: "Your bank rejected the payout. Update your bank account to receive $X." This matches Stripe: a failed payout disables the external account until it is updated [S18].
- **Reads:** `payouts` (own; displayed as transfers), ★ `connected_payouts`, `tasker_balances`, ★ `tasker_connect_status`.
- **Writes:** ★ `POST /tasker/connect/account-session` (components `payouts`, `notification_banner`); ★ `POST /tasker/connect/dashboard-link` ("Open Stripe Express dashboard", a single-use login link [S20]).

### T9. Payout account setup `/tasker/payouts/setup` (Connect onboarding)

- **Purpose:** get the tasker able to receive transfers, inside TaskNest.
- **Recommended:** **embedded onboarding**, the Connect `account-onboarding` component.
  - It is a "themeable onboarding UI with limited Stripe branding" that handles identity verification, document upload and bank accounts [S12].
  - The server creates an Account Session with `components[account_onboarding][enabled]=true` and returns its client secret [S12].
  - When `onExit` fires, the client must **re-fetch the account** and check `details_submitted`, `charges_enabled`, `payouts_enabled` and the requested capabilities; exiting does not mean done [S13].
  - Stripe user authentication is a popup and can't be removed for accounts where Stripe collects requirements [S11][S13].
- **Fallback:** **hosted onboarding** with Account Links (`type=account_onboarding`).
  - A link is single-use and expires after a few minutes; `refresh_url` must mint a new one.
  - Reaching `return_url` "doesn't mean that all information has been collected".
  - Never email or text the link; hand it only to the signed-in account holder [S17].
- **Screen layout:**
  1. **Before:** a short explainer card ("TaskNest pays you through Stripe. You'll confirm your identity and add a checking account."). This follows the checking-account-only pattern [T3]; Stripe itself validates which external accounts are allowed. Then a privacy note and a **Start** button.
  2. **During:** the embedded component inside a full-width card. TaskNest renders its own skeleton until `onLoaderStart` fires [S11]. If load fails before the loader starts, TaskNest must render its own error UI [S11].
  3. **After exit:** a status panel from ★ `POST /tasker/connect/refresh`, mapped to §3.4 ("Ready", "In review", "Action needed by Nov 12").
- **Account model** (backend, from `stripe.md` §2.5): Stripe-collected requirements, Express dashboard, platform pays fees and owns losses. On v1 that is `controller[stripe_dashboard][type]=express`, `controller[fees][payer]=application` and `controller[losses][payments]=application`, as in Stripe's onboarding examples [S12][S17]. `stripe.md` recommends the Accounts v2 equivalent; the UI is the same either way.
- **Simulated twin:**
  - A TaskNest-built 4-step form (Identity · Address · Bank · Review), every step badged **Simulated**.
  - It accepts Stripe's documented sandbox values so the same scripts work in Stripe test mode later [S23]:
    - ID number `000000000` (`111111111` = mismatch → "Action needed")
    - DOB `1901-01-01`
    - address line 1 `address_full_match` (`address_no_match` → "Action needed")
    - SMS code `000-000`
    - routing `110000000` with account `000123456789` (success) or `000111111116` (payout fails, `no_account`).
  - The simulated server stores the resulting state and emits a simulated `account.updated`.
- **Writes:** ★ `POST /tasker/connect/account-session`, ★ `POST /tasker/connect/account-link`, ★ `POST /tasker/connect/refresh`.
- **Staff view:** Tasker 360 shows the same status read-only, with the requirement names and the deadline.

### T10. Profile, skills and rate `/tasker/profile` ★

- **Purpose:** what clients see on cards and profiles.
- **Components:** photo, display name, headline (`taskers.headline` exists), bio, category, hourly rate input (bounded by admin limits ★), tools and vehicle chips, service area ★, a public-preview toggle.
- **Rule:** a rate change applies only to new quotes. Existing bookings keep their own `rate_cents` snapshot (`taskrabbit.md` §8 P1 #7). The UI says so next to the field.
- **Writes:** ★ `PATCH /tasker/profile`.

### T11. Standing `/tasker/standing`

- **Components:**
  - Rating ★ (public summary view);
  - response rate ★;
  - strikes table (exists: `tasker_strikes`);
  - "3 strikes in 30 days suspends your account" rule text, rendered from `policy.taskerCancel`;
  - each strike's date, booking and the $10.00 fee.
- **Reads:** `tasker_strikes`, ★ `tasker_rating_summary`.

### T12. Tax documents `/tasker/tax`

- Stripe mode: the Connect embedded **Documents** component, which "renders a list of tax invoices available for download" and is the place for 1099 forms [S16]. Account Session component `documents`.
- Simulated mode: an empty state ("Tax forms appear here in January when Stripe issues them"), badged **Simulated**.

### T13. Apply `/tasker/apply` ★ and `/become-a-tasker`

- A 4-step wizard: Account (sign up with role tasker; the signup trigger already maps metadata role `tasker`, `backend.md` §6) → Category & rate → Profile → Availability. It ends on the Today screen in `pending` standing, with the setup meter pointing at the payout account.
- **Writes:** ★ `POST /tasker/apply`.

---

## 5. Support and admin console

**Design goal.** A support agent should resolve any client or tasker problem from one queue and one Booking 360 page, without SQL. Every money action is previewed by the server, reasoned, limit-checked and audited. An admin additionally runs payouts, approves large refunds, answers disputes, publishes policy and watches money health.

**Patterns borrowed:** help-centre structure with audience sections and a "Submit a request" entry [T5]. Support requests should carry the task, the tasker and what looks wrong (`taskrabbit.md` §5). TaskNest's console exceeds this by showing the exact ledger effect before any refund.

### 5.0 Console shell

- **Left rail** (collapsible; icons + labels): Queue (count), Bookings, Refund requests (count), Approvals (admin, count), Disputes (count due), Clients, Taskers, Payouts (admin), Ledger, Reconciliation (admin), Health (dot: green when `integrity_violations` is empty), Events, Audit, Policies (admin), Promos, Team (admin), Test tools (admin, simulated only).
- **Top bar:** environment bar (§2.2) · global search · command palette (`Ctrl/⌘ K`) · notifications · user menu showing the role ("Support agent · refund limit $100.00").
- **Global search:** booking id, PaymentIntent id (`pi_…`), refund id, transfer id, dispute id, client or tasker name, email ★ (staff only). Results are grouped by type, and each opens a 360 page.
- **Command palette:** "Refund booking…", "Open dispute…", "Run payout for tasker…" (admin), "Suspend tasker…" (admin). Every command opens the same previewed drawer as the button would.
- **Keyboard shortcuts** (discoverable with `?`; single-key shortcuts can be turned off in settings, WCAG 2.1.4): `/` search, `g q` queue, `g b` bookings, `j/k` move between rows, `Enter` open, `Esc` close drawer.
- **Density:** Compact (32 px rows) by default on desktop; Comfortable (44 px) by toggle and on touch devices.

### S1. Work queue `/console` (default)

- **Purpose:** one prioritised list of everything that needs a human, with due dates.
- **Queue item types** (★ `ops_queue` view, built from existing tables plus new ones):

| Item | Source | Due | Default owner |
|---|---|---|---|
| Client refund request | ★ `refund_requests` (today only an `audit_log` row `refund_requested`, F14) | policy SLA (e.g. 2 business days) | agent |
| Agent refund needs admin approval | ★ `refund_approvals` | 1 business day | admin |
| Dispute needs response | `disputes` with Stripe `status` `needs_response` / `warning_needs_response` | `evidence_details.due_by` [S8] | admin |
| Payment needs client approval | ★ `payment_state = action_required` | `capture_before` or task start | agent (contact client) |
| Hold expiring before task | ★ `payment_state = hold_expiring` | `capture_before` [S1] | system; agent if re-hold failed |
| Refund failed | ★ `refunds.stripe_status = failed` (`refund.failed` can arrive up to 30 days later [S5]) | 2 business days | agent |
| Transfer failed / payout failed | ★ `payouts.status = failed`, ★ `connected_payouts.status = failed` | 2 business days | admin |
| Tasker pending verification | `taskers.status = pending` | — | admin |
| Request past response window | `bookings.status = requested` and older than `taskerResponseHours` (no auto-decline yet) | now | agent |
| Report a problem / tasker no-show | ★ `support_cases` | 1 business day | agent |
| Integrity violation | `integrity_violations` (must be empty) | now | admin |

- **Layout:** a filter bar (type, owner: me / unassigned / all, due: overdue / today / this week), then the queue table: type icon · subject · booking · amount · due (relative, red when overdue) · assignee · age. Selecting a row opens a **right drawer** with a summary and the primary action. "Open full page" goes to the 360.
- **Writes:** ★ `POST /ops/queue/:id/assign {userId}`, ★ `POST /ops/queue/:id/snooze {until, reason}`. Resolving happens through the real action (refund, approve, submit evidence), which closes the item server-side.
- **States:**
  - Empty: "Queue clear", with the time of the last check and a link to Health.
  - Error: banner + Retry, with the stale list kept and dimmed.
  - Realtime ★: new items slide in and are announced politely ("2 new items"). Focus is never stolen.

### S2. Bookings table `/console/bookings`

- **Purpose:** search and audit every booking. CRM-style.
- **Filter bar:** text (id, name, `pi_`), status (multi), payment state ★, date range (start or created), tasker, client, category, policy version, amount range, "has dispute", "has refund", "has extras".
- **Saved views** (stored per staff user ★ `staff_views`): "Open disputes", "Refund requested", "Starts in 48 h with hold expiring", "My assigned".
- **Columns** (choosable; the order is saved in the view):
  - id (short + copy) · created · start (zone label) · client · tasker · status pill · payment pill;
  - **Total charged** = card captured + extras + tips. This comes from ★ `booking_search` view, fixing the extras-blind Total (`frontend.md` P1 #9);
  - refunded · disputed · policy v.
- **Table behaviour:**
  - Sortable headers (`aria-sort`). The first cell is a link, so rows work with the keyboard (fixes P1 #16).
  - A checkbox column for bulk **Export CSV** and **Assign**. There is no bulk money action, on purpose.
  - Server pagination (keyset on `created_at, id`), 50 rows per page, "Showing 1–50 of 1,284". Today lists are capped at 50–100 rows with no paging.
- **Reads:** ★ `booking_search` view (staff RLS): joins `bookings`, `display_names`, tender totals, refund totals, latest dispute status, `payment_state`.
- **Keeps:** `console-bookings`, `console-search`, `console-search-submit`, `console-status`, `console-booking-row`.

### S3. Booking 360 `/console/bookings/:id`

- **Purpose:** everything about one booking, and every staff action on it, on one page.
- **Layout** (desktop, three areas):
  - **Header:** id, status and payment pills, client → tasker, start time with zone, policy version (links to the policy), and an action menu (Refund, Decline (admin, `requested` only), Tasker no-show (admin), Cancel preview, Add note).
  - **Left: Money panel** (the "money rail", §10.4):
    - Quote: subtotal, service fee, tax, total.
    - Extras: extra labour, extra fee, expenses.
    - Tenders: card / points / wallet / promo, each with paid, refunded, refundable.
    - Card objects: main PaymentIntent (hold amount, `capture_before`, captured), extras PaymentIntent, tip PaymentIntents, refunds (id, amount, **status**, ARN when available [S5]).
    - Tasker side: net, clawbacks, and the transfer it was paid in.
    - Every figure comes from the booking row, `booking_tenders`, `refunds`, `tips`, `disputes` or ★ `booking_money_summary`. Nothing is computed in the browser.
  - **Centre: Timeline** of every event: API actions (with actor and Idempotency-Key replay flag), Stripe events (type, id, livemode), ledger txns (kind, links), audit rows, internal notes ★ and messages ★. Filter chips: Money · Status · Stripe · Notes.
  - **Right: Context:** client card (name, email for staff, bookings count, refunds count, disputes count → Client 360), tasker card (status, Connect status, strikes → Tasker 360), open queue items for this booking.
- **Ledger tab:** the transactions for this booking (exists: `LedgerTab` with `ledger-booking`, `ledger-txn`, `ledger-totals`), shown as debit and credit lines per unit (USD and POINTS never netted).
- **Writes:** `POST /bookings/:id/refund` and `refund-preview` (exist), `POST /bookings/:id/decline` (admin, exists, no UI today), `POST /bookings/:id/no-show {who}` (admin, exists, no UI today), `GET /bookings/:id/cancel-preview` (exists), ★ `POST /bookings/:id/notes`.
- **States:**
  - Loading: skeleton per panel.
  - Partial failure: one panel shows an error with Retry; the others render.
  - Not found: 404 card with search.
- **Keeps:** `console-booking-detail`, `view-ledger`.

### S4. Refund drawer (from S3, S1 or S6)

- **Purpose:** issue a full, partial or goodwill refund with an exact preview.
- **Steps in one drawer:**
  1. **Kind:** Full · Partial · Goodwill (radio cards, each with a one-line meaning; "Goodwill: paid by TaskNest, the tasker keeps their share").
  2. **Amount:** prefilled with the refundable amount for Full. A money input in dollars, parsed to cents with the existing `parseDollars` (no floats).
  3. **Reason:** required. Reason chips ("Quality issue", "Tasker late", "Duplicate", "Goodwill") plus free text.
  4. **Server preview** (`POST /bookings/:id/refund-preview`, debounced):
     - per tender ("To card $63.50 · To points 650 pts ($6.50)");
     - tasker clawback;
     - platform cost;
     - points returned and clawed back;
     - and **"Needs admin approval"** when an agent goes over $100 (`requiresApproval`).
     - The browser fallback preview stays, clearly labelled "Estimate: server unreachable" (keeps `console-refund-fallback`).
  5. **Approval:**
     - Today: an admin picker for `approvedBy` (keeps `console-refund-approver`).
     - Proposed ★: "Request approval" creates a `refund_approvals` row and puts it in the admin's queue. The admin approves in S5, which executes the refund with `approvedBy` = that admin. This removes the need for an agent to pick an admin who hasn't seen the case.
  6. **Confirm:** a button naming the consequence, "Refund $70.00 (card $63.50, points $6.50)".
- **Stripe facts shown in the drawer** (small print under the card line):
  - "Card refunds usually reach the client in 5–10 business days" [S5].
  - "Stripe doesn't return its processing fee" [S5].
  - "A refund can fail later; you'll see it in the queue" [S5].
  - If the booking is `disputed`: the drawer is disabled with "Refunds are blocked while a card dispute is open" (domain rule, and Stripe's: you can't refund outside the dispute process while it's open [S6]).
- **Result:** a success panel listing refund ids with their status, the ledger txn link and the audit link. In simulated mode, ids are `re_fake_…` with a **Simulated** badge.
- **Keeps:** `console-refund-kind`, `-amount`, `-reason`, `-approver`, `-preview`, `-checking`, `-error`, `-fallback`, `-submit`.

### S5. Approvals `/console/approvals` (admin) ★

- **Purpose:** decide on agent refunds above the limit.
- **Card per request:** requester, booking, amount, kind, reason, the server preview frozen at request time **and** re-run now ("Preview changed since request: tasker clawback $51.73 → $48.10"), Approve / Reject (reason required).
- **Writes:** ★ `POST /refund-approvals/:id/approve` (executes `POST /bookings/:id/refund` server-side with `approvedBy`), ★ `POST /refund-approvals/:id/reject {reason}`.
- **Rules enforced by the server:** an approver must be an admin and not the requester (existing domain rule).

### S6. Client refund requests `/console/refund-requests` ★

- **Purpose:** turn client requests (`202 {requested:true}`) into decisions.
- **Table:** requested at · client · booking · kind · amount asked · reason · age · status (Open, Refunded, Declined).
- **Row drawer:** the client's words, the booking money panel, **Refund** (opens S4 prefilled with the request), **Decline** (reason required; the client is notified ★).
- **Backend:** ★ a `refund_requests` table written by `POST /bookings/:id/refund` when the caller is a client, and ★ `POST /refund-requests/:id/decline`. Today the request lives only in `audit_log` and no page reads it (`backend.md` F14).

### S7. Disputes `/console/disputes` and Dispute workspace `/console/disputes/:id`

- **Table columns:** opened · booking · client · amount · Stripe status (§3.5) · reason · **due by** (countdown, red under 72 h) · fee posted · outcome.
- **Workspace purpose:** respond once, well, before the deadline. Stripe allows **one** submission, and you can't edit or add after submitting [S7].
- **Components:**
  - **Header:** amount, reason category, status, due date, and the money effect so far ("Amount + $15.00 fee withdrawn at open" [S6][S9]).
  - **Decision panel:**
    - **Accept** ("You won't contest. The client keeps $X. TaskNest recovers the tasker's share as a clawback.").
    - **Counter**: "A $15.00 countered fee applies and comes back if you win" [S9]. The decision usually takes 2–3 months [S6].
    - For inquiries (`warning_*`), accepting doesn't resolve them; submit evidence instead [S7].
  - **Evidence builder:**
    - a checklist prefilled from TaskNest data: service date, task description, the client's booking confirmation, messages ★, the invoice (T5), the published cancellation and refund policy rendered from the booking's `policy_version`, and the tasker's completion time;
    - text fields map to Stripe's evidence fields; files are uploaded with purpose `dispute_evidence` [S8];
    - counters for the 150,000-character text limit [S8] and the Dashboard's 4.5 MB combined file guidance [S7].
  - **Save draft** (staged, not submitted) and **Submit evidence** (admin only; a final confirmation dialog says "You can't change or add evidence after this" [S7]).
  - **Timeline:** `charge.dispute.created`, `funds_withdrawn`, `updated`, `closed`, `funds_reinstated`, plus any late win [S6].
- **Writes:** ★ `POST /admin/disputes/:id/evidence {fields, fileIds, submit:false}`, ★ `POST /admin/disputes/:id/submit`, ★ `POST /admin/disputes/:id/accept`, ★ `POST /files {purpose:"dispute_evidence"}`.
- **Simulated twin:** "Simulate outcome" buttons (Won / Lost / Inquiry closed / Late win) appear on simulated disputes, calling the extended `POST /admin/disputes/simulate`. Today it supports `open`, `won` and `lost`; the UI exposes only won and lost. Stripe test mode uses `winning_evidence`, `losing_evidence` or `escalate_inquiry_evidence` in `uncategorized_text` to drive outcomes [S22], and the builder fills these in when the provider is Stripe test.
- **Keeps:** `dispute-won`, `dispute-lost` (moved into the simulated outcome group).

### S8. Clients `/console/clients` and Client 360 ★

- **Table:** name · email · joined · verified · bookings · total charged · refunds · disputes · points balance (exists: `points_balances`).
- **Client 360:**
  - bookings table;
  - payments: saved cards as **brand + last 4 + expiry only**, from ★ `GET /admin/clients/:id/payment-methods`. Staff never see card numbers (Stripe holds them);
  - refunds, disputes, points lots and movements (exist), support cases ★, notes ★.
- **Actions:** grant points (simulated only, exists `POST /admin/points/grant`), resend verification ★.

### S9. Taskers `/console/taskers` and Tasker 360

- **Table:** name · category · rate · status (pending, active, suspended) · **payout account** (§3.4) · rating ★ · jobs (30 d) · strikes (30 d) · balance (`tasker_balances`) · last transfer. Keeps `console-taskers`, `console-tasker-row`.
- **Tasker 360:**
  - **Header actions (admin):** Activate · Suspend · Set pending, each with a required reason (`POST /admin/taskers/:id/status`, which supports `pending` but today's UI exposes only active and suspended). Keeps `tasker-activate`, `tasker-suspend`, `tasker-status-reason`.
  - **Payout account card:** status, `requirements.currently_due` / `past_due` field names, `current_deadline`, capabilities, the account id (copy), "Open in Stripe Dashboard" (Stripe mode). Read-only: staff never open the tasker's onboarding.
  - **Money:** balance, the pipeline strip (§3.3), transfers, bank payouts, and **Payout preview** ★ (a dry run of `planPayout`: eligible bookings, held bookings with release dates, adjustments, blocked reason).
  - **Standing:** strikes, cancellations, no-shows, response rate ★.
  - **Jobs** table.
- **Writes:** existing status endpoint; `POST /payouts/run {taskerId}` (admin; exists but the UI has no per-tasker run); ★ `GET /payouts/preview?taskerId`.

### S10. Payouts `/console/payouts` (admin)

- **Purpose:** run, watch and repair payouts.
- **Components:**
  - **Run panel:** "Preview run" ★ shows every tasker with eligible amount, held amount and blocked reason, then "Run payouts for N taskers ($X)". Keeps `payout-run`.
  - The result renders as a table, not raw JSON in a `<pre>` (today, `frontend.md` P1 #17). Keeps `payout-result`. Each row shows tasker · amount · transfer id · bookings · balance after · blocked reason.
  - **Per-row isolation:** one tasker's failure shows as a failed row, and the others continue. This needs the backend fix F6 (per-tasker try/catch, `payouts.status = 'failed'`).
  - **Failed transfers** list with **Retry** ★ (`POST /payouts/:id/retry`, same deterministic idempotency key) and a reason.
  - **Bank payouts** list (★ `connected_payouts`): tasker · amount · status · arrival date · failure code [S18].
  - **Schedule:** shows the cron schedule (service-role call to `/payouts/run`) and the last run's time and result.
- **Stripe note** (shown as help text): "Transfers use the charge as `source_transaction`, so they succeed even before the card funds settle, and become available to the tasker when they do. Without it, a transfer larger than the platform's available balance fails and is not retried" [S19].

### S11. Ledger explorer `/console/ledger`

- **Tabs:** Transactions · Accounts · Trial balance.
  - **Transactions:** filter by kind, booking, party (name), date; each txn expands to its lines (account, party, unit, debit, credit). Keeps `ledger-txns`, `ledger-txn`, `ledger-booking`, `ledger-totals`.
  - **Accounts:** the chart of accounts from `domain/ledger.ts`, with balances per account and per party (`tasker_payable` by tasker, `client_funds_held` by client). Clicking a balance filters Transactions.
  - **Trial balance:** `ledger_trial_balance` view (exists), with USD and POINTS in separate sections.
- **Read only.** No staff action writes the ledger directly; only API actions post transactions.

### S12. Reconciliation `/console/reconciliation` (admin) ★

- **Purpose:** prove that TaskNest's books match Stripe's balance.
- **Layout:** per day, TaskNest's `card_clearing` movements vs Stripe balance transactions (charges, refunds, dispute withdrawals and reinstatements, fees, transfers), with a variance column and a drill-down to unmatched items.
- **Known gaps, shown as banners until fixed:**
  - Processing fees aren't in the ledger, so every charge shows a fee-sized variance (`backend.md` F4; Stripe doesn't return fees on refunds [S5]).
  - Dispute fees are booked only on loss, but Stripe debits the amount and the $15 received fee at open (F3; [S6][S9]).
- **Backend:** ★ `POST /admin/reconcile/run {date}` pulls balance transactions (Stripe mode) or the fake provider's journal (simulated mode). Results land in ★ `recon_items`.

### S13. Money health `/console/health`

- **Tiles:**
  - `integrity_violations` (must be 0; it shows the violating rows if not);
  - `ledger_unbalanced_txns` (0);
  - `points_integrity`;
  - webhook backlog ★ (events received but not processed, oldest age);
  - failed provider voids ★ (today swallowed by `.catch(() => {})`, F8);
  - payouts blocked;
  - provider and API version (`GET /health`).
- Each tile links to the rows behind it.
- Agents can read; admins can also re-run checks.

### S14. Stripe events `/console/events`

- **Table:** received · type · object id · booking · livemode (must be false) · handled · duplicate. Source: `stripe_events` (exists), plus ★ `payload`, `api_version`, `account` and `processed_at` columns (`stripe.md` §5).
- **Row drawer:** the JSON viewer (collapsible, copyable) and the linked booking.
- **Admin action:** ★ Replay (re-process a stored event idempotently).
- **Simulated mode:** a **Simulated** badge, and events whose ids start with `evt_fake_`.

### S15. Audit log `/console/audit`

- **Columns:** time · actor (name + role) · action · entity (link) · reason · data (expandable).
- **Filters:** actor, action, entity type, date.
- **Source:** `audit_log` (exists, staff-only).

### S16. Policies `/console/policies` (admin)

- **Purpose:** publish a new money policy version safely. `POST /admin/policies` exists, but there is no UI.
- **Components:**
  - a version list (version, effective from, published by, reason, "active" or "scheduled" pill);
  - a **structured editor** grouped like `/pricing` (Fees, Cancellation tiers, Tips, Points, Refunds, Payouts, Auth, Booking);
  - a **diff view** against the active version;
  - an **effective from** picker (must be ≥ now; the server rejects retroactive dates);
  - a reason field;
  - **Validate** ★ (`POST /admin/policies/validate`, a dry run that returns the same `invalid_policy` details) and **Publish**.
- **Copy:** "Existing bookings keep their own version. New quotes use this version from {date}." The rule is in `docs/API.md`.
- **Keeps:** `policy-version` (on `/pricing`).

### S17. Promos `/console/promos`

- Read-only table of `promo_codes` (readable by staff). Create and expire ★ (admin). Note: every signed-in user can read all promo codes today (`backend.md` §6); the console flags this.

### S18. Team `/console/team` (admin) ★

- Staff list with role (admin, support agent); invite; change role; deactivate. The writes are audited. Today staff roles are never granted at signup (`backend.md` §6), so this needs ★ `POST /admin/staff/:userId/role`.

### S19. Test tools `/console/test-tools` (admin, simulated only)

Visible only when `GET /health` says `provider: "fake"`. Each tool is badged **Simulated**, and the whole page is hidden in Stripe mode (the API already returns `403 fake_provider_only` there).

| Tool | Endpoint | Notes |
|---|---|---|
| Dispute: open / won / lost / inquiry ★ / late win ★ | `POST /admin/disputes/simulate` (exists; extend outcomes) | Same code path as real webhooks |
| Fire a simulated webhook ★ | `POST /sim/webhooks {type, objectId}` | e.g. `payment_intent.canceled` (hold expired), `refund.failed`, `payout.failed`, `account.updated` |
| Payout outcome ★ | `POST /sim/payouts/:id/outcome {status, failureCode?}` | `paid`, `failed:no_account`, … mirrors [S18][S23] |
| Connect requirements ★ | `POST /sim/connect/:taskerId/requirements {state}` | Drives §3.4 states |
| Grant points | `POST /admin/points/grant` (exists) | |
| Test clock token | `POST /admin/test-clock` (exists) | Shows the token once, with copy and expiry |

## 6. Client and public screens

The client flow is complete but compact. It follows a booking order borrowed from TaskRabbit as a pattern only: category and address first, then compare taskers and prices with date, time and price filters, pick a time from the tasker's calendar (at most 14 days ahead), add details, review with payment method and promo, then confirm. The booking counts as scheduled only when the tasker confirms [T6]. TaskNest's live quote panel and exact cancel preview already go further than that pattern, so they stay.

### 6.1 Public

| Screen | Purpose and components | Reads / writes |
|---|---|---|
| **P1 Home `/`** | Search ("What do you need done?"), category tiles with "from $X/h" (minimum `hourly_rate_cents` of active taskers in the category), a 3-step "how it works", a trust strip (verified taskers from `kyc_verified_at`, published terms, card held not charged), "Become a tasker" | anon reads: `taskers` (active), `money_policies`. ★ `categories` table for icons and descriptions (today `taskers.category` is free text) |
| **P2 Category `/services/:category`** | Tasker cards for the category, plus filters | as P1 + ★ `tasker_rating_summary` |
| **P3 Tasker profile `/taskers/:id`** | Header (photo ★, name, rating ★, jobs done ★, rate), about, skills ★, reviews with first name and date ★, sticky "Book" | `taskers`, ★ public reviews view. Today `taskerReviews()` goes through RLS-restricted `bookings`, so other clients and anon visitors see no reviews (`taskrabbit.md` §1.3) |
| **P4 Pricing `/pricing`** | Exists. Published terms from the active policy row. Add anchors (`#fees`, `#cancel`, `#tips`) for deep links from tooltips | `money_policies` |
| **P5 Help `/help`, `/help/:slug`** | Search, audience sections (Clients, Taskers, Payments, Account, Policies), "Submit a request". Pattern from [T5]. Every number in an article is rendered from the policy row | `money_policies`; ★ `support_cases` for requests |
| **P6 Become a tasker** | Earnings explainer (rate you set, 15% commission from policy, tips 100%), steps, Apply | policy row |
| **P7 Auth** | Sign in (keeps demo-account buttons in non-production), sign up (client or tasker), verify email (the API returns `403 unverified` until verified), reset password | Supabase Auth |
| **P8 404** | Friendly page with links home and to search | — |

### 6.2 Booking stepper (client)

| Step | Components | API |
|---|---|---|
| **W1 Details `/book/:category`** | Task size chips mapped to minutes (Small 60 · Medium 120 · Large 240, or custom), address ★ with autocomplete, description with prompts (access, parking, tools) | client state |
| **W2 Choose a tasker** | Filter rail (date, time of day, price), sort (rating, price, jobs done; a sensible default, not sourced from TaskRabbit), tasker cards (photo, name, rating and count, jobs done, rate, top skills, Select) | `taskers`, ★ ratings view, ★ availability |
| **W3 Pick a time** | Day strip (next 14 days ★ policy `booking.maxAdvanceDays`), slot grid with unavailable slots disabled and labelled, time-zone label | ★ `GET /taskers/:id/availability?from&to` |
| **W4 Review & pay** | Summary card (tasker, time, address, details), promo, points toggle and amount, **quote panel** (exists; keeps `quote-panel`, `quote-tenders`, `quote-server-status`, `quote-mismatch`), **Payment Element** (§9.1) or the simulated card form, consent checkbox for saving the card, hold disclosure, **Request booking · $83.50 on card** (the button shows the card portion, not the total; fixes P1 #12; keeps `book-submit`) | `POST /quote` (exists), ★ `POST /payments/customer-session`, `POST /bookings` (extended with `confirmationTokenId`, `saveCard`, `consentVersion`) |
| **W5 Confirmation `/bookings/:id?new=1`** | "Request sent to Tara. She has until 3:12 PM tomorrow to confirm." Hold chip "Hold $83.50 · expires Nov 5". Next steps, add to calendar | booking from the `POST /bookings` response |

On phone the quote panel becomes a **sticky bottom bar** ("Card $83.50 · Details ▲"). It expands into a sheet, so the price is visible next to the button (fixes P1 #11). The "pricing & policies" link opens a sheet instead of reloading the page and losing the form (fixes P1 #13).

### 6.3 Client account

| Screen | Purpose and components | Reads / writes |
|---|---|---|
| **C1 My tasks `/bookings`** | Tabs: **Needs action** (payment approval, review & tip, refund decision) · Upcoming · Past. Cards keep `booking-card`, `booking-total`, `booking-tenders`, `booking-dispute` | `bookings` + bundle (exists) |
| **C2 Task page `/bookings/:id`** | Status timeline, **money panel** (hold or charges, extras, tips, refunds with status), actions: Reschedule (keeps `reschedule-*`), Cancel with the **server** preview (`GET cancel-preview`; keeps `cancel-*`), Rate & tip (one sheet; keeps `review-*`, `tip-*`), Request a refund (keeps `refund-*`; says it is a request), **Report a problem** ★ (includes "Tasker didn't show"), Messages ★ | lifecycle endpoints (exist), ★ `POST /support/cases`, ★ messages |
| **C3 Payment approval `/bookings/:id/pay`** | Shown when `payment_state = action_required`. One sentence ("Your bank needs you to approve $38.38 for extra time"), the amount, then Stripe's `confirmPayment` with the declined PaymentIntent's client secret [S4]. Simulated: a challenge modal labelled **Simulated** with Approve / Fail | ★ `POST /bookings/:id/payment/session` → `clientSecret` |
| **C4 Cards `/account/cards`** | Saved cards inside the Payment Element via a CustomerSession with `payment_method_redisplay` and `payment_method_remove` [S3]. Simulated: a list of `pm_fake_…` cards with Remove | ★ `POST /payments/customer-session` |
| **C5 Points `/points`** | Exists (`points-lots`, `points-history`); fix the 2 px overflow at 390 px | exists |
| **C6 Account, addresses ★, notifications ★** | Name and home time zone (the only `profiles` columns users may update today) | `profiles` (exists) |
| **C7 Inbox ★** | Message threads per booking + notifications | ★ `messages`, ★ `notifications` |
| **C8 My requests `/help/requests` ★** | Support cases and refund requests with status | ★ `support_cases`, ★ `refund_requests` |

The combined **Rate & tip** sheet puts rating first, then a tip with chips (10/15/20% of subtotal, rounded by the domain) and a custom amount. The live "up to $X more" comes from `tipRoom()`, and the existing cap message from `tipProblem()`. TaskRabbit requires the rating before a tip and closes tipping 24 hours after the invoice [T7]. TaskNest's policy v1 allows either order within 30 days, with a cap of 25% of the subtotal. The sheet uses TaskNest's rules and says so.

---

## 7. Interaction states

### 7.1 Global patterns

| State | Pattern | Notes |
|---|---|---|
| **Loading (first)** | Skeletons shaped like the final layout (table rows, cards, money rail lines). Never a full-page spinner after the first paint | Today `Spinner` is the text "Loading…" |
| **Loading (refresh)** | Keep old data, dim it slightly, show a thin progress bar at the top of the panel | Staff tables keep scroll position |
| **Empty** | One sentence explaining why, plus the next action as a button ("No requests yet. Make sure your calendar has open hours → Calendar") | Every empty state has a next step (today they don't) |
| **Error (read)** | An inline banner in the panel that failed, with Retry. Other panels keep working | `role="alert"` only for errors the user caused or must act on |
| **Error (write)** | The dialog or drawer stays open with the message next to the button. The form keeps its values | Idempotency-Key rules from `api.ts` are unchanged |
| **Busy (409 busy / request_in_progress)** | Auto-retry with the same key (exists, 400/800/1600 ms), shown as "Still working…" on the button | Never show it as an error unless all retries fail |
| **Network / 5xx** | "We couldn't confirm this went through. Try again: it's safe, it won't run twice." The key is reused | The message is true because of the Idempotency-Key replay |
| **Success** | A toast (auto-dismiss 6 s, pausable, with an Undo where the domain allows it, which is none for money) plus an in-place update. Money actions also show the receipt line and the links | Flash messages no longer reappear on refresh (P1 #15) |
| **Stale** | "Updated 2 min ago · Refresh" on long-lived pages (Queue, Today). Realtime ★ removes most of this | |
| **Simulated** | A violet **Simulated** badge on every simulated component and result id; the environment bar is always on | Owner decision |
| **Permission** | Hidden when a role can never do the action. Disabled **with a reason** when it's temporarily blocked ("Refunds are blocked while a dispute is open") | Fixes the unexplained disabled Book button (P1 #10) |
| **Offline (phone)** | A banner, read-only cached data; actions disabled with "You're offline" | Tasker workspace mainly |

### 7.2 Key screens

| Screen | Loading | Empty | Error | Success |
|---|---|---|---|---|
| T1 Today | skeleton cards + strip | "No jobs today" + Calendar CTA | per-panel retry | Accept → card moves to "Scheduled", toast |
| T2 Requests | skeleton cards | "No requests waiting" | `409 response_window_expired` → card greys out, "Window closed" | Accept: toast "Scheduled with Ava, Tue 9:00 AM" |
| T5 Send invoice | — | — | `402` extras → booking completes, extras pending client approval | Toast + timeline "Invoiced · card charged $103.50 · extras $38.38" |
| T8 Payouts | skeleton | "No transfers yet. Your first one is sent 3 days after your first job" (from `holdDays`) | Connect component load error before the loader starts → TaskNest's own error card [S11] | "Payout account ready" chip |
| T9 Setup | own skeleton until `onLoaderStart` [S11] | — | load error → retry + "Use the Stripe-hosted form instead" (Account Link) | status panel after re-fetch |
| S1 Queue | skeleton rows | "Queue clear" + last check time | banner, stale rows kept | item leaves the queue with "Resolved by you" |
| S4 Refund drawer | "Checking with server…" (`console-refund-checking`) | — | preview failed → domain estimate labelled "Estimate" (`console-refund-fallback`); submit errors inline (`console-refund-error`) | refund ids + status + ledger link |
| S7 Dispute | skeleton | — | evidence upload failed per file, with retry | "Evidence submitted. Decision usually in 60–75 days" [S6] |
| S10 Payouts run | preview skeleton | "No tasker is eligible today" + reasons | a failed row per tasker; others continue | results table |
| W4 Review & pay | Element skeleton until ready | — | decline message from Stripe shown under the Element (it shows localized messages for decline codes, `frontend.md` §8) | → W5 |
| C3 Payment approval | — | — | still failing → "Use another card" (Element with saved cards) | "Approved. Your tasker can finish the job." |

---

## 8. Error codes to messages

Existing codes are from `docs/API.md`; ★ are new codes proposed in §13.

| Code | Where | Message (role-appropriate) | UI behaviour |
|---|---|---|---|
| `401 unauthorized` | any | "Your session ended. Sign in again." | Go to `/signin?next=` |
| `403 unverified` | book | "Confirm your email to book. We sent a link to a***@…" | Resend button |
| `403 forbidden` | any | "Your role can't do this." | Should never show; log it |
| `403 fake_provider_only` | test tools | hidden in Stripe mode | — |
| `404 not_found` | booking | "We couldn't find that booking." | Search |
| `402 card_declined` | book, tip | Stripe's decline message under the Element; simulated: "Card declined (Simulated)" | Keep the form; suggest another card |
| `409 slot_taken` | book, reschedule | "That time was just taken. Pick another." | Refresh slots |
| `409 tasker_unavailable` | quote, book | "This tasker isn't taking bookings right now." | Back to W2 |
| `409 response_window_expired` | accept | "The response window closed." | Grey out the card |
| `409 too_early` | no-show | "You can report a no-show from {start time}." | Disabled with that reason |
| `409 already_reviewed` | review | "You've already reviewed this task." | Hide the action |
| `409 illegal_state` | lifecycle | "This booking changed. Refreshing…" | Reload the booking |
| `409 dispute_open` | refund, simulate | "Refunds are blocked while a card dispute is open." | Disable with reason |
| `409 busy`, `request_in_progress` | writes | (auto-retry) "Still working…" | Same key |
| `422 rule_violation` | tip, refund, points, promo | The domain message, verbatim (it is already user-readable) | Inline under the field |
| `422 idempotency_key_reused` | writes | "Something went wrong with this request. Please try again." | New key |
| `422 invalid_policy` | policies | Lists every `details` item next to its field | Inline |
| `502` provider | money writes | "Payment provider didn't answer. Try again: it won't charge twice." | Same key |
| `503 payments_misconfigured` | any money write | Staff: "Payments are misconfigured (live key refused)." Others: "Payments are unavailable right now." | Environment bar turns red |
| ★ `requires_action` (200 with `status`) | book, pay | (no message) opens 3-D Secure via `handleNextAction` [S2] | — |
| ★ `authentication_required` | extras, re-hold (server) | Client notification: "Approve $X for {task}" | Booking → `action_required` |
| ★ `payout_account_not_ready` | payout run | "Payout account not ready ({first requirement})" | Tasker 360 link |
| ★ `tasker_unavailable_at_time` | book | "Tara isn't available then. Here are her open times." | Slots |
| ★ `amount_below_minimum` | book, tip, extras | "Card amounts must be at least $0.50, or $0." (Stripe's USD minimum, `stripe.md` §2.13) | Inline |

---

## 9. Stripe touchpoints and their simulated twins

### 9.1 Map

| Where | Stripe piece | Server objects | Events that change the UI | Simulated twin |
|---|---|---|---|---|
| W4 Review & pay | **Payment Element**, deferred intent, finalize on server with a ConfirmationToken [S2] | Customer, CustomerSession, manual-capture PaymentIntent with `setup_future_usage=off_session` | `payment_intent.amount_capturable_updated` (hold placed) [S1] | Simulated card form (§9.2) |
| C4 Cards | Payment Element saved methods (`payment_method_redisplay`, `payment_method_remove`) [S3] | CustomerSession | — | `pm_fake_*` list |
| C3 Payment approval | `confirmPayment` with the declined PaymentIntent's client secret [S4]; `handleNextAction` for 3DS [S2] | PaymentIntent | `payment_intent.succeeded` / `payment_failed` | Simulated challenge modal |
| T5 Send invoice | none client-side; the server captures and charges extras off-session [S1][S3] | capture, extras PaymentIntent | `payment_intent.succeeded`, `payment_failed` | fake provider |
| T8, T9, T11, T12 | Connect embedded: `account-onboarding`, `notification-banner`, `payouts`, `documents` [S10][S12][S14][S15][S16]; Express dashboard login link [S20]; fallback Account Links [S17] | connected account, Account Session | `account.updated`, `payout.*`, `account.external_account.updated` [S12][S18] | Simulated onboarding form, banner, payouts table |
| S4, C2 | Refunds API [S5] | Refund | `refund.created`, `refund.updated`, `refund.failed`, `charge.refunded` [S5] | `re_fake_*`, simulated `refund.failed` |
| S7 | Disputes API, file upload [S8] | Dispute, File | `charge.dispute.created/updated/closed/funds_withdrawn/funds_reinstated` [S5][S6] | extended dispute simulator |
| S10 | Transfers with `source_transaction` [S19]; payouts on connected accounts [S18] | Transfer, Payout | `transfer.*`, `payout.*` | simulated payout outcomes |
| S12 | Balance transactions | — | — | fake provider journal |

### 9.2 Payment Element at W4 (Stripe test mode) and its simulated twin

**Stripe mode** (facts from [S2], [S3], [S1]):
- Stripe.js is loaded from `js.stripe.com`, never bundled ("Always load Stripe.js directly from js.stripe.com to remain PCI compliant") [S2]. On endive the script URL is `https://js.stripe.com/endive/stripe.js` [S2].
- Elements is created **before** any PaymentIntent with:
  - `mode:'payment'`, `amount` = the card portion from the server quote (for example 8350), `currency:'usd'`;
  - `captureMethod:'manual'`, `setupFutureUsage:'off_session'`;
  - `customerSessionClientSecret` so saved cards show.
  - Stripe: "Make sure the Elements options you provide (such as `captureMethod`, `setupFutureUsage` …) match the equivalent parameters you pass when creating and confirming the Intent" [S2].
- When promo or points change the card portion, the page calls `elements.update({amount})` with the **server's** new figure [S2]. It never computes the amount itself.
- On submit:
  1. `elements.submit()`;
  2. `stripe.createConfirmationToken(...)`;
  3. `POST /bookings {…, confirmationTokenId, saveCard, consentVersion}`.
  - The token must be used right away; unused, it expires after 12 hours [S2].
- If the response has `status: "requires_action"`, the page calls `stripe.handleNextAction({clientSecret})` (3DS) and then ★ `POST /bookings/:id/payment/confirm` [S2].
- **Consent and terms** (Stripe compliance for saved payment methods):
  - terms that say how the saved card is used (extras, re-holds before the task, tips if chosen);
  - an explicit checkbox ("Save this card for extra time, expenses and holds on this booking");
  - a stored record of the agreement [S3].
  - TaskNest stores `consentVersion` and the time on the booking ★.
- **Hold disclosure** right under the Element: "We'll place a hold of $83.50 now. You're charged when the task is done. Some banks show holds like charges until they drop off." Stripe notes that statements don't always distinguish authorizations from captures, which can confuse customers [S1].
- Appearance: see §10.6.

**Simulated twin** (default runtime):
- It looks and behaves like the Element: card number, expiry, CVC, ZIP; a saved-card list; a "Save this card" checkbox.
- A **Simulated** badge sits in its header, and a helper link lists the test numbers.
- It accepts Stripe's documented test numbers and maps them to the same outcomes [S22]:

| Number | Simulated outcome |
|---|---|
| 4242 4242 4242 4242 | Hold placed |
| 4000 0000 0000 0002 | Declined (generic) |
| 4000 0000 0000 9995 | Declined (insufficient funds) |
| 4000 0000 0000 0127 | Incorrect CVC |
| 4000 0000 0000 3220 | 3DS challenge, then hold |
| 4000 0025 0000 3155 | 3DS at booking, later off-session charges succeed |
| 4000 0027 6000 3184 | Off-session charges always need approval (drives C3) |
| 4000 0000 0000 0259 | Dispute opens after capture |
| 4000 0000 0000 5126 | Refunds succeed, then fail later |

- It never sends card data anywhere. It produces a `pm_fake_*` token mapped to the matching fake outcome. `stripe.md` gap #31 asks to align the fake decline id with `pm_card_visa_chargeDeclined` [S22].

### 9.3 Holds

- Show on C2 and S3: amount, "expires {capture_before}", and "released automatically if not used".
  - The authoritative expiry is `payment_method_details.card.capture_before`; when a hold expires the funds are released and the PaymentIntent becomes `canceled` [S1].
  - Today the server stores `now + 7 days` (F7); the UI must read the new `capture_before` field ★.
- Card-not-present windows: 7 days for customer-initiated holds on Visa, Mastercard, Amex and Discover; merchant-initiated Visa holds last 4 days 18 hours [S1]. That is why far-future bookings save the card and hold later (`card_saved_no_hold`).
- Capture is one-shot: a partial capture releases the rest, and most payments allow one capture [S1]. Extras are therefore a separate charge, which matches the repo.

### 9.4 Off-session charges (extras, re-holds)

- The server charges the saved card with `off_session=true`, `confirm=true` and the customer and payment method. "If the conditions for exemption aren't met, the PaymentIntent might throw an error" [S3].
- On `authentication_required`, Stripe says to notify the customer to come back and to use the declined PaymentIntent's client secret with `confirmPayment` [S4]. TaskNest does this with an in-app notification + email ★, the **Needs action** tab and C3.
- The tasker sees only "Client payment pending" and the job still completes.

### 9.5 Refunds

- Staff copy and states come from [S5]:
  - Refunds use the **available** balance; card refunds wait as `pending` when it's short.
  - Clients usually see the credit in 5–10 business days.
  - A refund can fail up to 30 days later (`refund.failed`), and the money returns to the balance.
  - Processing fees aren't returned.
  - An uncaptured PaymentIntent is canceled, not refunded.
- Staff can give clients a trace reference (ARN, STAN or RRN), available up to 7 business days after the refund [S5]. S3 shows it when present.

### 9.6 Disputes

See S7. Facts used:
- Debit of amount + fee at open [S6]; US fees $15 received (kept) and $15 countered (returned on a win) [S9].
- Response window usually 7–21 days; a single submission; decision 60–75 days; late wins possible [S6][S7].
- Evidence through the API with `dispute_evidence` file uploads [S8].

### 9.7 Connect onboarding and payout status

See T8, T9 and §3.4.
- Embedded components need one `StripeConnectInstance` per session, created with `loadConnectAndInitialize({publishableKey, fetchClientSecret, appearance})`. `fetchClientSecret` must always create a new Account Session; it is also used to refresh an expired session [S11].
- Call `logout()` only when the user signs out of TaskNest [S11].
- Components can't run inside embedded web views in mobile apps [S11], so a future native app would link out to the web.

### 9.8 Webhooks that drive the UI

Two event destinations, as recommended in `stripe.md` §2.9: the platform account, and connected accounts (for `account.updated` and `payout.*`). The endpoints are created on the pinned API version, `2026-10-28.endive` today [S24]. Each processed event appears in S14 and on the matching timeline (C2, T4, S3).

### 9.9 Content-Security-Policy and headers

If TaskNest adds a CSP, it must allow, for Connect embedded components [S11]:
- `frame-src https://connect-js.stripe.com https://js.stripe.com`
- `script-src https://connect-js.stripe.com https://js.stripe.com`
- `img-src https://*.stripe.com`
- the documented style hash

Keep `Cross-Origin-Opener-Policy` at `unsafe-none` (the default), because `same-origin` breaks Stripe user authentication popups [S11]. The SPA rewrite and CSP belong in the planned `vercel.json` (`platform.md`).

### 9.10 Keys

- The browser receives only `VITE_STRIPE_PUBLISHABLE_KEY`.
- The build fails on `pk_live_` (★, extends `check-live-keys.sh`), and the environment bar refuses to render a live key.
- With no key set, the app runs simulated.

## 10. Design system

### 10.1 Brand: an original TaskNest look ("calm ledger")

- **Idea:** TaskNest is the place where work and money are kept in order. The look is closer to a well-kept workshop logbook than a consumer app: warm paper surfaces, a deep harbour blue for actions, and one ember accent for "needs you now". It is deliberately different from TaskRabbit's green brand and from the indigo/amber looks in the two sibling proposals, so the owner has a real choice.
- **Mark: "the woven N".** Two strokes cross like woven twigs and form an N inside a rounded square. A small filled square, the "task", sits in the lower bowl.
  - Single colour, a 2 px stroke on a 24-unit grid, legible at 16 px (favicon).
  - Wordmark "TaskNest" in Public Sans 700 with a capital N.
  - It replaces today's `⌂` glyph in a blue square.
- **Illustration:** none near money. Empty states use simple line icons (Lucide, ISC licence) in harbour blue on linen. There are no people illustrations, so nothing resembles a competitor's art.
- **Voice:**
  - Short, verb-first sentences.
  - Money sentences always carry a number and a date ("Hold $83.50 · expires Nov 5").
  - Staff copy names the consequence ("Refund $70.00 to card and points").
  - No jokes in money or error states.
- **Signature element:** the **money rail**, a ruled column with tabular figures, used on every money surface (quote panel, Job money, Booking 360, refund drawer). Holds get a dashed rule; captured amounts a solid one; refunds a minus sign and an info tint.

### 10.2 Colour tokens

Semantic CSS variables in Tailwind v4's `@theme`, with a dark set under `prefers-color-scheme` and a manual override. The contrast ratios below were computed for this proposal with the WCAG 2.x formula (`tools/contrast_ops.py` in this folder):
- every text pair is at least 4.5:1;
- input borders and focus rings are at least 3:1;
- `--border` (1.66:1 light) is for decorative dividers only, never for input edges.

| Token | Light | Dark | Use | Check (light / dark) |
|---|---|---|---|---|
| `--bg` | `#FAF8F5` linen | `#0D131B` | page | — |
| `--surface` | `#FFFFFF` | `#141C27` | cards, tables | — |
| `--sunk` | `#F2EEE8` | `#0A0F15` | table header, wells | — |
| `--text` | `#14202E` | `#E7ECF2` | body | 16.46 / 14.43 on surface |
| `--muted` | `#56606B` | `#A3AFBD` | secondary text, hints | 6.40 / 7.69 on surface; 5.54 on sunk (light) |
| `--primary` | `#1F4E79` harbour | `#8CB8EA` | buttons, links, focus | 8.66 / 8.29 on surface |
| `--on-primary` | `#FFFFFF` | `#0D131B` | text on primary | 8.66 / 9.02 |
| `--primary-subtle` | `#E8F0F8` | `#16263A` | selected rows, active nav | primary text on it 7.53 / 7.40 |
| `--accent` | `#B4430F` ember | `#FF9C66` | "needs you now" text, countdown | 5.60 / 8.32 on surface |
| `--accent-fill` | `#F47A3A` | `#F47A3A` | badges and dots, with `--text` (light) or `--bg` (dark) on top | 6.03 light |
| `--border` | `#CFC8BD` | `#2C3848` | dividers (decorative) | 1.66 / 1.44 |
| `--border-strong` | `#7D766D` | `#6B7A8C` | input borders, table outlines | 4.48 / 3.91 |
| `--focus` | `#1F4E79` | `#8CB8EA` | 2 px focus ring + 2 px offset | 8.66 / 8.29 |
| `--success` / `-subtle` | `#1E6B45` / `#E6F3EB` | `#6CCB95` / `#11291D` | paid, ready | 5.67 / 7.81 on subtle |
| `--warning` / `-subtle` | `#8A4B00` / `#FFF3DE` | `#F2B45A` / `#2E2210` | action needed | 6.20 / 8.47 |
| `--danger` / `-subtle` | `#B42318` / `#FDECEA` | `#F49A90` / `#341716` | failed, disputed, destructive | 5.75 / 7.71 |
| `--info` / `-subtle` | `#1D4F91` / `#EAF1FB` | `#8DB7F2` / `#12233A` | refunds, neutral notices | 7.16 / 7.68 |
| `--held` / `-subtle` | `#7A4A00` / `#FFF1D6` | `#F6C46A` / `#2E2410` | holds, "on hold" money | 6.70 / 9.46 |
| `--sim` / `-subtle` | `#5B3CC4` / `#F0ECFD` | `#BBA8FA` / `#221A3D` | **Simulated** badge only | 6.27 / 7.87 |

**Status pill mapping:**
- held → `held`
- captured, completed → `primary`
- paid out, ready → `success`
- action needed, expiring → `warning`
- refunded → `info`
- failed, disputed, suspended → `danger`
- simulated → `sim` (never used for anything else)

Every pill carries text and an icon, so status never depends on colour alone.

### 10.3 Type

- **UI:** Public Sans (SIL OFL), weights 400/500/600/700, with `font-variant-numeric: tabular-nums` on every money and table cell.
- **IDs and JSON:** JetBrains Mono 400 (OFL).
- **Display:** Public Sans 700 with tight tracking. One family keeps the console dense and consistent.

| Token | Size / line height | Use |
|---|---|---|
| `--text-xs` | 12 / 16 | table meta, badges (never body) |
| `--text-sm` | 14 / 20 | console tables (Compact density), hints |
| `--text-base` | 16 / 24 | body, **all inputs** (Stripe recommends at least 16 px input text on mobile [S21]) |
| `--text-lg` | 18 / 28 | card titles |
| `--text-xl` | 20 / 28 | section headings |
| `--text-2xl` | 24 / 32 | page titles (console) |
| `--text-3xl` | 30 / 36 | page titles (client, tasker) |
| `--text-money-xl` | 36 / 40, 700, tabular | KPI tiles, hero amounts |

### 10.4 Space, radius, elevation, motion, density

- **Space:** 4 px base (`--s-1` 4, `--s-2` 8, `--s-3` 12, `--s-4` 16, `--s-6` 24, `--s-8` 32, `--s-12` 48). Page gutter is 16 px on phone and 24–32 px on desktop.
- **Radius:** 6 px inputs and buttons, 10 px cards and drawers, 999 px pills.
- **Elevation:** 0 (flat, bordered), 1 (cards: 0 1px 2px rgb(20 32 46 / .06)), 2 (drawers and sheets), 3 (dialogs).
- **Motion:** 120 ms for state changes, 200 ms for drawers and sheets, ease-out. Countdown rings tick at most once per minute visually. All motion is off under `prefers-reduced-motion`.
- **Density:** `data-density="compact|comfortable"` on the console root. It changes row height (32/44 px), cell padding and `--text-sm`/`--text-base` in tables. Touch devices force Comfortable.

### 10.5 Components

Existing primitives in `src/components/ui.tsx` (Card, Button, Input, Select, Textarea, Field, Banner, Badge, MoneyRow, Stat, Modal, Empty, Spinner, `useLoad`, `useAction`) are kept and restyled onto the tokens. New components:

| Group | Component | Notes |
|---|---|---|
| Layout | **AppShell** (top bar, left rail, bottom tabs), **EnvBar**, **PageHeader** (title, meta, actions), **SplitView** (list + drawer) | the rail collapses to icons at 1024 px |
| Navigation | **Tabs** (ARIA tablist, arrows, URL-synced), **Breadcrumbs**, **Stepper**, **CommandPalette** (combobox pattern) | replaces button tabs |
| Data | **DataTable** (native `<table>`, `aria-sort`, sticky header, column chooser, keyset pager, row checkbox, first-cell link, compact/comfortable), **FilterBar** + **FilterChip**, **SavedViews** menu, **EmptyState**, **Skeleton** | phone: renders as **ListRow** cards |
| Money | **MoneyRail** (ruled lines, dashed hold line), **MoneyRow** (exists), **AmountInput** (dollars → cents via `parseDollars`), **TenderSplit** (card/points/wallet/promo bar + list), **PipelineStrip** (§3.3), **KPI tile** (value, delta, link) | no float maths anywhere |
| Status | **StatusPill** (text + icon + token), **Countdown** (text + ring, threshold announcements), **DueChip**, **SimulatedBadge** | |
| Timeline | **EventTimeline** (grouped by day, filter chips, actor, links to ledger and audit) | used in C2, T4, S3, S7 |
| Overlays | **Dialog** (focus trap, `aria-modal`, return focus, Esc, scroll lock; bottom sheet under 640 px), **Drawer** (right, 480–640 px; full-screen sheet on phone), **Toast** (polite region, pausable), **Popover**, **Tooltip** (also on focus) | fixes the Modal focus bugs (`frontend.md` §6) |
| Forms | **RadioCard** (refund kind), **ReasonPicker** (chips + text), **StarRating** (radio group), **TimeSlotGrid**, **DayStrip**, **AddressField** ★ (combobox), **FileDrop** (evidence; per-file progress and error) | |
| Ops | **QueueItem**, **ApprovalCard** (frozen vs live preview), **EvidenceChecklist** (counters for text and file size), **DiffView** (policy versions), **JsonViewer** (events), **AuditRow**, **AssigneePicker** | |
| Stripe wrappers | **PaymentElementCard** (Element + consent + hold disclosure + Simulated twin switch), **ConnectEmbed** (one `StripeConnectInstance`, own skeleton until `onLoaderStart`, own error UI before it [S11], Simulated twin switch) | one switch reads `GET /health` |

### 10.6 Stripe appearance mapping

**Payment Element** (Appearance API [S21]):
```js
const appearance = {
  theme: prefersDark ? 'night' : 'stripe',
  labels: 'above',
  variables: {
    colorPrimary: '#1F4E79',      // dark: '#8CB8EA'
    colorBackground: '#FFFFFF',   // dark: '#141C27'
    colorText: '#14202E',         // dark: '#E7ECF2'
    colorDanger: '#B42318',       // dark: '#F49A90'
    fontFamily: 'Public Sans, system-ui, sans-serif',
    fontSizeBase: '16px',
    spacingUnit: '4px',
    borderRadius: '6px',
  },
  rules: { '.Input': { borderColor: '#7D766D' }, '.Input:focus': { outline: '2px solid #1F4E79' } },
};
```
- The colour variables must be literal hex: `colorPrimary`, `colorBackground`, `colorText`, `colorDanger` etc. "don't support `rgba()` or the `var(--myVariable)` syntax" [S21]. A build step copies the token hex values into this object.
- Custom fonts go through the Elements `fonts` option [S21].

**Connect embedded components** [S11]:
- They inherit the font family and background colour from the parent container; everything else is set with the `appearance` option on `loadConnectAndInitialize` (for example `colorPrimary`).
- Self-hosted fonts are passed in `fonts` (`cssSrc` or `src`). A CSS font URL must be allowed by `connect-src` if a CSP exists.
- Some flows (Stripe user authentication) always open a Stripe popup and can't be restyled [S11].

---

## 11. Phone behaviour

Reference width 390 px. 16 px side gutters, no horizontal page scroll (`min-w-0` on grid children fixes the console's 550 px overflow, `frontend.md` §7).

### 11.1 Tasker (phone-first)

- **Bottom tabs:** Today · Requests (badge) · Calendar · Earnings · More (Jobs, Invoices, Payouts, Profile, Standing, Tax, Help, Sign out). Each tab is 48 px tall.
- **Today:** "Needs you now" comes first; the money strip is a horizontal snap list; job cards have a full-width Start button.
- **Requests:** large cards; Accept and Decline are full-width, 48 px tall, with 8 px between them to avoid mis-taps.
- **Job page:** a sticky bottom action bar with the one primary action for the status. "More" opens a bottom sheet (Reschedule, Cancel job, Client didn't show).
- **Send invoice:** a full-screen sheet; steppers instead of number fields; the money rail is pinned above the confirm button.
- **Calendar:** agenda list by day, with long-press to add a block (and an "Add hours" button as the accessible path).
- **Payout setup:** the onboarding component is full-width (embedded components are mobile-optimized [S10]). The page has no other chrome during onboarding except Back.

### 11.2 Client

- **Bottom tabs:** Book · Tasks (badge) · Inbox · Account.
- **Booking stepper:** one step per screen, with a progress bar. The quote is a sticky bottom bar with the card amount; the Element sits in a full-width card.
- **Dialogs** (cancel, reschedule, rate & tip, request refund) become bottom sheets with a drag handle and a visible Close button.

### 11.3 Staff

The console is desktop-first, and phone is "read and respond":
- The top bar has Queue, Search and Menu.
- The Queue renders as a list of cards (type, subject, amount, due). Tapping one opens a full-screen 360.
- Tables render as **ListRow** cards with the three most important columns. Filters open in a sheet. Saved views are a select.
- Allowed actions on phone: assign, snooze, add note, **refund up to the agent limit**, approve or reject (admin). Dispute evidence submission and policy publishing show "Open on a larger screen", because one-shot, irreversible actions need room to review.
- The ledger and reconciliation are read-only lists.

### 11.4 Touch targets

All controls are at least 44 × 44 px on touch, and never below 24 × 24 px anywhere (WCAG 2.5.8). Today the header Sign out link is 54 × 20, the points checkbox 13 × 13 and the modal ✕ 13 × 24 (`frontend.md` §6).

---

## 12. Accessibility

Target: WCAG 2.2 AA, checked with axe in CI on every route at 1280 and 390 px. The harness already exists in `shotrun/`.

1. **Fix the three failing axe rules first:**
   - colour contrast (the token set above);
   - unlabeled selects (`Field` labels everywhere; `aria-label` only where a visible label is impossible);
   - the keyboard-unreachable scroll region on `/pricing` (`tabIndex=0`, `role="region"`, `aria-label`).
2. **Dialogs and drawers:**
   - focus moves into them;
   - Tab is trapped;
   - `aria-modal="true"`;
   - Esc closes them;
   - focus returns to the trigger;
   - background scroll is locked.
   - The probe today found 12 Tab presses landing behind the dialog.
3. **Routing:** a per-route `<title>` ("Booking 6f2c… · Console · TaskNest"); focus moves to the `<h1>` on navigation; a polite live region announces the page; a skip link goes to main.
4. **Tables:**
   - native `<table>` with `<th scope>`;
   - sortable headers are buttons inside `<th>` with `aria-sort`;
   - each row's first cell is a real link (no `<tr onClick>`);
   - selection checkboxes are labelled with the row subject;
   - the pager announces "Page 2 of 26".
5. **Tabs:** `role="tablist"`, `aria-selected`, arrow keys, Home/End, and URL sync.
6. **Countdowns and realtime:**
   - countdowns are text, not only a ring;
   - announcements are polite and only at thresholds (1 h, 15 min, 5 min) or when the state changes ("Window closed");
   - new queue items are announced as a count, and focus is never moved;
   - the response window is a business rule enforced by the server (an essential time limit in WCAG 2.2.1 terms), so the UI states the deadline in text, warns ahead of it, and never hides it.
7. **Character-key shortcuts** in the console can be turned off or remapped, and are active only when focus is not in a text field (WCAG 2.1.4).
8. **Money:**
   - amounts are text with a sign ("−$51.73"), never colour alone;
   - screen readers get the full currency ("minus 51 dollars 73 cents") through `aria-label` on MoneyRow when the visual uses the "−" glyph;
   - holds read "Hold, not charged: $83.50".
9. **Forms:**
   - every input has a visible label and hints tied with `aria-describedby`;
   - errors are inline and summarised at the top with links;
   - required fields are marked in text;
   - AmountInput uses `inputmode="decimal"`.
10. **Stripe iframes:**
    - the Payment Element and Connect components handle their own internal accessibility;
    - TaskNest gives the wrapping region a heading and a label ("Card details", "Payout account setup");
    - the Stripe authentication popup is announced before it opens ("A Stripe window will open to confirm it's you").
11. **Ratings:** StarRating is a radio group with labels "1 star" … "5 stars". Today it is a `<select>` that reads "black star" five times.
12. **Motion and zoom:**
    - `prefers-reduced-motion` respected;
    - layouts reflow at 400% zoom (320 CSS px) with no two-dimensional scroll except inside data tables, which get a labelled, focusable scroll region.
13. **Simulated badge:** "Simulated" is real text in the badge, so assistive tech announces it, not just a colour.

---

## 13. Backend: existing vs new

### 13.1 Existing endpoints and where the new UI uses them

| Endpoint (exists) | New UI location | Change needed? |
|---|---|---|
| `GET /health` | EnvBar, S13, Stripe-wrapper switch | No (add `apiVersion` field ★ nice-to-have) |
| `POST /quote` | W4 quote panel | No |
| `POST /bookings` | W4 | **Yes:** accept `confirmationTokenId` / `paymentMethodId`, `saveCard`, `consentVersion`; return `requires_action` + `clientSecret`; drop the `pm_card_visa` fallback (`stripe.md` #1, #2, #7) |
| `POST /bookings/:id/accept`, `/decline` | T1, T2; S3 (admin decline) | No |
| `POST /bookings/:id/reschedule` | C2, T4 | Later: availability check ★, mutual-agreement window (policy) |
| `GET /bookings/:id/cancel-preview` | C2, T4, S3 | No (the UI switches from the browser preview to this) |
| `POST /bookings/:id/cancel` | C2, T4 | No |
| `POST /bookings/:id/no-show` | T4 (client no-show), S3 (admin, either) | No; ★ add a matching preview |
| `POST /bookings/:id/start` | T4 | No |
| `POST /bookings/:id/complete` | T5 | Off-session extras with saved card (`stripe.md` #3); later itemised expenses (policy) |
| `POST /bookings/:id/tip` | C2 Rate & tip | Use the saved card on-session; minimum $0.50 ★ |
| `POST /bookings/:id/refund-preview` | S4, S5 | No |
| `POST /bookings/:id/refund` | S4 (staff), C2 (client request) | Client branch writes ★ `refund_requests`; persist refund ids and status |
| `POST /bookings/:id/review` | C2 | No |
| `POST /payouts/run` | S10, S9 (per tasker) | Per-tasker isolation, `failed` status, `source_transaction`, Connect gating (F6, `stripe.md` #5, #6) |
| `POST /admin/taskers/:id/status` | S9 | No (the UI adds `pending`) |
| `POST /admin/policies` | S16 | No |
| `POST /admin/disputes/simulate` | S7, S19 | Add `inquiry`, `inquiry_closed`, `late_win` outcomes |
| `POST /admin/points/grant`, `/admin/test-clock` | S8, S19 | No |
| `POST /webhooks/stripe`, `stripe-webhook` | S14 | More event types, idempotent closes, `livemode` check (F2, `stripe.md` #10–#13) |

### 13.2 New endpoints

All are POST unless noted, require a JWT, are role-checked server-side, and money-touching ones **require** an `Idempotency-Key` (`backend.md` F5 recommends requiring it on all money routes).

**Client payments**

| Endpoint | Who | Purpose |
|---|---|---|
| `POST /payments/customer-session` | client | Create or reuse the Customer; return a CustomerSession client secret with `payment_method_redisplay`, `payment_method_save`, `payment_method_remove` [S3], plus `{mode: "simulated"\|"stripe_test", publishableKey?}` |
| `POST /bookings/:id/payment/confirm` | client | After `handleNextAction`: verify `requires_capture`, post `booking_hold`, mark `requested` |
| `POST /bookings/:id/payment/session` | client | For `action_required`: return the declined PaymentIntent's client secret for `confirmPayment` [S4] |
| `GET /me/payment-methods` | client | Brand, last 4, expiry (for the Account page without the Element) |

**Tasker**

| Endpoint | Who | Purpose |
|---|---|---|
| `POST /tasker/apply` | new tasker | Create the `taskers` row (`pending`) |
| `PATCH /tasker/profile` | tasker | headline, bio, rate (bounded), skills, area |
| `PUT /tasker/availability` | tasker | weekly rules + overrides |
| `GET /taskers/:id/availability?from&to` | anyone signed in (public ★ optional) | free slots, no booking ids |
| `POST /tasker/connect/account-session` | tasker | Create the connected account if missing; Account Session with only `account_onboarding`, `notification_banner`, `payouts` (features as in T8), `documents` [S12][S14][S15][S16] |
| `POST /tasker/connect/account-link` | tasker | Hosted fallback (`account_onboarding`, `refresh_url`, `return_url`) [S17] |
| `POST /tasker/connect/refresh` | tasker | Re-fetch the account; update ★ `tasker_connect_status` |
| `POST /tasker/connect/dashboard-link` | tasker | Express dashboard single-use login link [S20] |
| `GET /bookings/:id/no-show-preview` | tasker, admin | Mirrors `cancel-preview` |

**Support and ops**

| Endpoint | Who | Purpose |
|---|---|---|
| `POST /support/cases` | client, tasker | Report a problem, tasker no-show, invoice question |
| `POST /refund-requests/:id/decline` | staff | Close a client request with a reason |
| `POST /refund-approvals` / `/:id/approve` / `/:id/reject` | agent / admin | Approval workflow; approve executes the refund with `approvedBy` |
| `POST /bookings/:id/notes` | staff | Internal notes (audited) |
| `POST /ops/queue/:id/assign`, `/snooze` | staff | Queue ownership |
| `POST /admin/disputes/:id/evidence`, `/submit`, `/accept` | staff (submit/accept: admin) | Evidence staging, single submission, accept [S7][S8] |
| `POST /files` | staff | Upload with purpose `dispute_evidence` [S8] |
| `GET /payouts/preview?taskerId` | admin | Dry run of `planPayout` |
| `POST /payouts/:id/retry` | admin | Retry a failed transfer with the same key |
| `POST /admin/policies/validate` | admin | Dry-run validation |
| `POST /admin/reconcile/run` | admin | Pull balance transactions / fake journal |
| `POST /admin/webhooks/:eventId/replay` | admin | Re-process a stored event |
| `POST /admin/staff/:userId/role` | admin | Grant or revoke staff roles |
| `GET /admin/clients/:id/payment-methods` | staff | Brand, last 4, expiry only |

**Simulated only** (return `403 fake_provider_only` in Stripe mode, like today's test hooks)

| Endpoint | Purpose |
|---|---|
| `POST /sim/webhooks` | Emit a simulated event through the real handler |
| `POST /sim/payouts/:id/outcome` | Move a simulated bank payout to paid or failed |
| `POST /sim/connect/:taskerId/requirements` | Set a simulated requirements state |
| `POST /sim/connect/onboarding` | Back end of the simulated onboarding form (accepts Stripe's sandbox test values [S23]) |

### 13.3 New reads (views and tables, all with RLS)

| Object | Readers | Purpose |
|---|---|---|
| `booking_search` (view) | staff | Names, status, payment state, totals **including extras and tips**, refunded, disputed |
| `ops_queue` (view) | staff | The S1 queue items with due dates |
| `tasker_money_summary`, `tasker_statement` (views) | own tasker, staff | §3.3 strip and T7 statement from the ledger |
| `tasker_connect_status` (table) | own tasker, staff | Status, requirements, deadline, capabilities |
| `tasker_rating_summary`, `public_reviews` (views) | everyone | Fixes the hidden-ratings bug (`taskrabbit.md` §1.3) |
| `tasker_availability` (table) | own tasker (write via API), public free/busy via endpoint | Calendar |
| `refund_requests`, `refund_approvals`, `support_cases`, `booking_notes` (tables) | parties as appropriate, staff | Ops workflows |
| `connected_payouts` (table) | own tasker, staff | Bank payouts from `payout.*` |
| `recon_items` (table) | admin | Reconciliation |
| `staff_views` (table) | own staff user | Saved views |
| `messages`, `notifications` (tables) | booking parties, staff | Chat and alerts |

### 13.4 Schema additions (summary; details in `stripe.md` §5 and `backend.md` §9)

- `profiles.stripe_customer_id`.
- `bookings`: `payment_state`, `capture_before`, `stripe_charge_id`, `stripe_payment_method_id`, `save_card_consent_at`, `consent_version`, `address` ★, `category` ★.
- `refunds`: `stripe_refund_ids` with status.
- `payouts` → shown as transfers: `source_transaction`, `transfer_group`, `status` written as `failed` too.
- `disputes.status`: widened to the 10 Stripe values [S6].
- `stripe_events`: `payload`, `livemode`, `api_version`, `account`, `processed_at`.

### 13.5 Which changes need a new money-policy version

These change what Helix reads as published terms, so each needs domain code, unit tests, `/pricing` rendering and a new `money_policies` version (never retroactive). The UI must not implement any of them on its own:
- billing minimum and increments;
- itemised expenses with a per-item cap;
- the client cancellation grace period;
- the booking horizon (`maxAdvanceDays`);
- the review window;
- an `invoiced` state with a client review window before capture;
- mutual reschedules inside 24 h.

---

## 14. Test-id continuity

The 23 mocked UI tests (`e2e/ui.spec.ts`) must keep passing through the redesign. Rule: **every existing `data-testid` stays on the control that does the same job**, even when the control moves. New screens add ids in the same naming style.

| Existing ids | New home |
|---|---|
| `main-nav`, `nav-*`, `current-user`, `sign-out`, `nav-signin`, `nav-pricing` | AppShell: top bar (desktop) and bottom tabs / menu sheet (phone). Ids stay on the visible copy for the current width |
| `signin-*`, `demo-accounts`, `demo-*` | P7 Sign in |
| `tasker-list`, `tasker-search`, `tasker-category`, `tasker-card-*` | P2 / W2 cards |
| `tasker-name`, `tasker-rate`, `booking-*`, `points-*`, `promo-*`, `quote-*`, `book-submit` | W1–W4 (the stepper keeps the inputs mounted per step) |
| `booking-card`, `booking-total`, `booking-tenders`, `booking-dispute`, `cancel-*`, `reschedule-*`, `tip-*`, `review-*`, `refund-*` | C1 / C2 |
| `points-lots`, `points-history` | C5 |
| `job-card`, `accept`, `decline`, `start`, `complete-*`, `tasker-cancel-*`, `reschedule-open`, `tasker-history`, `tasker-payouts`, `tasker-strikes-table`, `tasker-status-banner`, `flash`, `action-error` | T1 / T2 / T4 / T5 / T7 / T8 / T11 |
| `console-*`, `tab-*`, `dispute-won`, `dispute-lost`, `ledger-*`, `view-ledger`, `payout-run`, `payout-result`, `tasker-activate`, `tasker-suspend`, `tasker-status-reason` | S2 / S3 / S4 / S7 / S9 / S10 / S11. `tab-*` move to the rail links |
| `pricing-*`, `curve-*`, `policy-version` | P4 |
| `page-error` | ErrorBoundary (kept per route) |

New e2e coverage to add alongside: the simulated card outcomes (§9.2 table), simulated onboarding states (§3.4), the payout pipeline states, the refund approval flow, dispute evidence staging and submission, and axe on every route.

---

## 15. Build order

Each phase ships behind the simulated provider first. Stripe test mode is switched on later by setting keys.

1. **Shell and tokens:** AppShell, EnvBar, tokens and dark mode, Dialog/Drawer/Toast/Tabs/DataTable/Skeleton, per-route titles, 404, the three axe fixes. Restyle the existing pages with all test ids kept.
2. **Console foundations:** Queue (with today's data: requests past window, disputes, pending taskers, integrity), Bookings table on `booking_search`, Booking 360, the Refund drawer (exists, moved), Ledger explorer, Health, Events, Audit. Backend: `booking_search`, `ops_queue`, `refund_requests`.
3. **Tasker workspace:** Today, Requests, Jobs and Job page (with no-show and the server cancel preview), Send invoice, Earnings from the ledger, Payouts (transfers). Backend: `tasker_statement`, `tasker_money_summary`.
4. **Payments (simulated first):** simulated card form + consent + hold disclosure at W4; C3 payment approval; saved cards. Then the Stripe path: Customer, CustomerSession, ConfirmationToken, `handleNextAction`, off-session extras (`stripe.md` priority 1–3).
5. **Connect (simulated first):** T9 simulated onboarding, §3.4 states, notification banner twin, bank payouts twin, S9 payout account card. Then Stripe embedded components and Account Links (`stripe.md` priority 5), plus per-tasker payout isolation and `source_transaction`.
6. **Disputes and approvals:** widened statuses, idempotent closes, the evidence builder, the approvals queue.
7. **Client depth:** public landing and categories, ratings view, availability and slots, address, messages, support cases.
8. **Admin depth:** Policies editor with diff and validate, Reconciliation (after the ledger gains Stripe fees and dispute-fee timing, F3/F4), Team, Promos.

---

## 16. Sources

### Stripe (docs.stripe.com, fetched 2026-10-29 for this proposal)

| Key | Page | Used for |
|---|---|---|
| S1 | https://docs.stripe.com/payments/place-a-hold-on-a-payment-method | `capture_before`, validity windows (Visa MIT 4 d 18 h), expiry → `canceled`, partial capture, one capture, statement confusion, `amount_capturable_updated` |
| S2 | https://docs.stripe.com/payments/finalize-payments-on-the-server.md?platform=web&type=payment | deferred-intent Elements options, matching options, `elements.update`, ConfirmationToken (12 h), `handleNextAction`, js.stripe.com loading, endive script URL |
| S3 | https://docs.stripe.com/payments/save-during-payment.md?payment-ui=elements | saving compliance (terms, consent, record), CustomerSession features, off-session charging, test cards 3155 / 3184 |
| S4 | https://docs.stripe.com/payments/save-and-reuse.md?payment-ui=elements | `authentication_required` recovery with `confirmPayment`; notify the customer to return |
| S5 | https://docs.stripe.com/refunds | refund statuses, pending on low balance, 5–10 business days, failures up to 30 days, fees not returned, cancel vs refund, ARN/STAN/RRN, refund events |
| S6 | https://docs.stripe.com/disputes/how-disputes-work | debit at open, inquiries and `warning_*`, 120-day close, 7–21 day response, 60–75 day decision, no refunds during a dispute, late wins |
| S7 | https://docs.stripe.com/disputes/responding | one submission only, accept vs counter, inquiries can't be accepted to resolve them, 4.5 MB evidence guidance |
| S8 | https://docs.stripe.com/disputes/api | evidence fields, `dispute_evidence` uploads, 150,000-character limit, `evidence_details.due_by` |
| S9 | https://support.stripe.com/questions/june-2025-pricing-updates-for-disputes | US $15 received fee; $15 countered fee returned on a win |
| S10 | https://docs.stripe.com/connect/supported-embedded-components.md?platform=web | component list (account onboarding, management, notification banner, payouts, balances, documents, …), mobile-optimized |
| S11 | https://docs.stripe.com/connect/get-started-connect-embedded-components.md?platform=web | Account Session, `loadConnectAndInitialize`, `fetchClientSecret` refresh, role mapping, appearance and fonts, `logout`, CSP and COOP, user-authentication popups, load errors, `onLoaderStart`, no web views |
| S12 | https://docs.stripe.com/connect/embedded-onboarding | embedded onboarding scope, Account Session `account_onboarding`, controller properties, requirement remediation, `past_due` disabling |
| S13 | https://docs.stripe.com/connect/supported-embedded-components/account-onboarding.md?platform=web | `onExit` → re-fetch `details_submitted` / `charges_enabled` / `payouts_enabled`; collection options; user-auth defaults |
| S14 | https://docs.stripe.com/connect/supported-embedded-components/notification-banner.md | when the banner renders; nothing before `details_submitted` |
| S15 | https://docs.stripe.com/connect/supported-embedded-components/payouts.md?platform=web | payouts component content and features; Instant Payouts prerequisites |
| S16 | https://docs.stripe.com/connect/supported-embedded-components/documents.md | tax invoices and 1099 forms |
| S17 | https://docs.stripe.com/connect/hosted-onboarding | Account Links: single use, expiry, `refresh_url`, `return_url` meaning, don't email links |
| S18 | https://docs.stripe.com/connect/payouts-connected-accounts | daily rolling default, payout statuses, 1–2 business days, failure disables the bank account, `payout.*` events (v1 only) |
| S19 | https://docs.stripe.com/connect/separate-charges-and-transfers.md?platform=web&integration=custom&ui=elements&api-integration=paymentintents | platform pays fees, refunds and chargebacks; `source_transaction`; failures over available balance; reversals need the connected balance |
| S20 | https://docs.stripe.com/connect/express-dashboard | Express dashboard features; single-use login links; sandbox accounts only via login links |
| S21 | https://docs.stripe.com/elements/appearance-api.md?api-integration=paymentintents | themes, variables, labels, ≥ 16 px inputs on mobile, no `rgba()`/`var()` in colour variables |
| S22 | https://docs.stripe.com/testing | test card numbers and PaymentMethods, dispute evidence test values |
| S23 | https://docs.stripe.com/connect/testing | Connect sandbox test identity, address, SMS and bank values |
| S24 | https://docs.stripe.com/api/versioning | "The current version is 2026-10-28.endive"; webhook endpoint versions |

### TaskRabbit (patterns only; paraphrased; fetched 2026-10-29)

| Key | Page | Pattern used |
|---|---|---|
| T1 | https://support.taskrabbit.com/hc/en-us/articles/34799128396301 | invoice within 24 h; hours + eligible expenses; 1 h minimum then 15-min steps; cancel instead of invoicing when no work |
| T2 | https://www.taskrabbit.com/blog/turn-every-invite-into-income-start-with-these-4-tips/ | invitation countdowns; a missed window loses the task; accurate calendars, buffer time |
| T3 | https://support.taskrabbit.com/hc/en-us/articles/360032937071-Setting-Up-Your-Direct-Deposit | payouts to open checking accounts only |
| T4 | https://www.taskrabbit.com/blog/how-pricing-works-on-taskrabbit-and-what-it-means-for-your-earnings/ | rates per category; tasker keeps rate and tips; Stripe payouts mostly in 1–3 business days |
| T5 | https://support.taskrabbit.com/hc/en-us | help-centre layout: search, audience sections, "Submit a request" |
| T6 | https://support.taskrabbit.com/hc/en-us/articles/210861763-How-Do-I-Hire-a-Tasker | booking order, filters, 14-day horizon, scheduled once the tasker confirms |
| T7 | https://support.taskrabbit.com/hc/en-us/articles/216901546-Tipping-Taskers | rate before tip, 24 h tip window, 100% to tasker, separate statement lines |
| TR:H# | listed in `taskrabbit.md` §0 (fetched the same day by the TaskRabbit reader) | comparison and policy tables referenced through that file |

No TaskRabbit brand name, logo, colour, illustration, program name or copy is used in any proposed screen. The name "TaskRabbit" appears only in this document's attributions and citations, never in proposed UI copy.

### Repo and research inputs

- `/home/user/tasknest`: `README.md`, `docs/SPEC.md`, `docs/API.md`, `docs/BACKEND_NOTES.md`, `docs/CI.md`, `.coderabbit.yaml`, `src/App.tsx`, `src/lib/api.ts`, `src/lib/data.ts`, `src/pages/*` (test ids), `supabase/migrations/20260924000001_schema.sql`, `supabase/functions/_shared/domain/{booking,config}.ts`.
- This folder: `backend.md` (F1–F14), `frontend.md` (P0–P2, axe, phone), `stripe.md` (31 gaps, target flows), `taskrabbit.md` (journeys, policy table), `platform.md` (deploy state, CSP/SPA notes), `OWNER-NOTES.md` (simulated-by-default decision), `tools/contrast_ops.py` (contrast check for §10.2).
