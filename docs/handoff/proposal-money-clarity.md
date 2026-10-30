# TaskNest UX/IA proposal: money clarity first

- **Angle:** before every money action, show exactly what the server will settle. After it, show exactly what the server did settle. This covers every price, hold, capture, fee, points or promo tender, cancellation fee, refund and payout, in the same words, in the same order, down to the cent. This proposal is built for a fintech QA subject (Helix): a person or a test can read every number off the screen and match it to a ledger transaction and a Stripe object.
- **Repo:** `helix-fintech-apps/tasknest` at `65a45d8`, read-only. Nothing in the repo was changed.
- **Inputs:** the five reviews in this folder (`backend.md`, `frontend.md`, `stripe.md`, `taskrabbit.md`, `platform.md`), `OWNER-NOTES.md`, `README.md`, `docs/SPEC.md`, `docs/API.md`, `docs/BACKEND_NOTES.md`, `.coderabbit.yaml` and `src/`.
- **Stripe facts:** fetched from docs.stripe.com on 2026-10-29 and cited inline as [S#]. The list is in §14. Where a fact comes only from the Stripe reviewer's fetch (in `stripe.md`), it says so.
- **TaskRabbit:** only UX patterns are borrowed, cited as [T#]. TaskNest keeps its own name, brand, colours, illustrations and wording. No TaskRabbit copy, program names, logo or art are used.
- **Owner decision (OWNER-NOTES.md, 29 Oct):** "we will use simulated keys".
  - The default runtime is the deterministic `fake` provider.
  - The fake provider includes a simulated card form that mirrors the Payment Element flow, simulated 3DS, simulated Connect onboarding, simulated webhooks and simulated payouts.
  - Every simulated step is labelled **Simulated** on screen.
  - Real Stripe test mode switches on only when the owner sets keys.
  - This proposal designs every Stripe touchpoint twice: once for real Stripe and once as its simulated twin.

---

## Contents

1. Money-clarity rules (the contract every screen follows)
2. Money vocabulary and the state labels users see
3. Information architecture and navigation per role
4. Screens: public
5. Screens: client
6. Screens: tasker
7. Screens: support agent and admin (console)
8. Interaction states (loading, empty, error, success) and the error-code map
9. Stripe touchpoints (real and simulated)
10. Design system: brand, tokens, type, components
11. Phone behaviour
12. Accessibility
13. Backend: existing endpoints vs new ones, schema, policy-versioned changes
14. Build order and test hooks
15. Sources

---

## 1. Money-clarity rules

These ten rules are the product. Each screen section later says how it applies them.

| # | Rule | What it means on screen | Why it matters for Helix |
|---|---|---|---|
| R1 | **The server is the only source of numbers.** | Every amount comes from a server preview (`/quote`, `cancel-preview`, `refund-preview`, plus the new previews in §13), a server response, or a server statement. Domain previews (`src/lib/preview.ts`) may render first for speed, but they are labelled *Estimate* until the server figure arrives, and they are replaced by it. | Removes UI-side money math, which `.coderabbit.yaml` already asks for. It also fixes the two known UI math bugs: tasker "Earnings (net)" shows $229.50 instead of $261.12, and the console Total column ignores extras (`frontend.md` P1 #8, #9). |
| R2 | **Before → Confirm → After, always.** | Every money action is one `MoneyActionSheet`: a *Before* panel (server preview), a confirm button that names the consequence ("Cancel and get $51.75 back"), then an *After* panel built from the response. | The After panel and the receipt can be compared line by line with the preview. |
| R3 | **Preview and result are reconciled on screen.** | After the action, the sheet compares preview and result line by line. If they match it shows "Settled as previewed". If not, it shows a `SettledDifferently` banner listing both values. It never hides a difference. | A mismatch is visible evidence a QA run can assert on. |
| R4 | **Tenders are always split.** | Any total that more than one tender paid shows the split: Card, Points, Promo credit (and Wallet only when it is non-zero; it has no balance source today, `BACKEND_NOTES.md`). The order follows the policy (`tenderUseOrder` at checkout; `refundOrder` and `retentionOrder` for refunds and fees). | Makes `allocateTenders`, `refundAfterRetention` and `splitRefund` observable. |
| R5 | **A hold is never shown as a charge.** | Holds use their own visual (dashed outline, "Hold" label, expiry). A capture turns the line solid ("Charged"). Released amounts say "Released". Stripe itself warns that some card statements don't tell authorizations from captures, which confuses customers [S1], so the UI explains the difference where the hold is placed. | Distinguishes `requires_capture` from `succeeded` and `canceled`. |
| R6 | **Every money line has a time, a status and a source.** | Each line shows when it happened (in the task's time zone, with the zone named), its status (Pending, Succeeded, Failed and so on) and, for staff, its ledger txn and provider object id (`pi_…`, `re_…`, `tr_…`, `po_…`). | Each line traces to `ledger_txns` and to Stripe. |
| R7 | **The policy version is always visible.** | Every booking shows "Policy v1" as a link to that version's terms on `/pricing?v=1` (not the current version). Preview sheets say which tier or rule applies ("48 h or more before the original start: 100% refund"). | A booking is evaluated with *its* `policy_version` (API.md); the screen proves which one. |
| R8 | **Money never moves silently.** | Off-session events (re-hold, extras charge, refund failed, transfer, payout failed, dispute) appear in an Activity feed and on the booking timeline, and raise a "Needs action" badge when the user must act. | Covers webhook-driven state that the UI never sees today. |
| R9 | **Amounts are machine-readable.** | Every rendered amount carries `data-money-cents`, `data-money-kind`, `data-tender`, `data-source="estimate|server-preview|server-result|statement"` and `data-policy-version`. | Helix and Playwright can read exact cents without parsing "$1,234.50". |
| R10 | **Simulated is labelled.** | With the fake provider, every card form, 3DS prompt, onboarding step, webhook-driven change and payout carries a **Simulated** badge. A provider badge from `GET /health` sits in the footer for everyone and in the console header for staff. | The owner's rule (OWNER-NOTES.md). |

### 1.1 The worked example used throughout

Taken from `docs/API.md` and the demo seed. Ava books Tara (Handyman, $45.00/h) for 2 h with promo `WELCOME10` and 1,000 points.

| Line | Cents | Source |
|---|---|---|
| Labor: 2 h × $45.00 | 9000 | `quote.subtotal` |
| Service fee (15%) | 1350 | `quote.serviceFee` (`clientServiceFeeBps` 1500) |
| Tax | 0 | `quote.tax` (`taxBps` 0) |
| **Task total** | **10350** | `quote.total` |
| Promo credit WELCOME10 | −1000 | `allocation.parts.promo` |
| Points (1,000 pts) | −1000 | `allocation.parts.points` |
| **Card hold today** | **8350** | `allocation.parts.card` |

At completion Tara adds 30 extra minutes and $12.50 of expenses:

| Line | Cents | Source |
|---|---|---|
| Extra labor (30 min) | 2250 | `extra_labor_cents` |
| Service fee on extra labor | 338 | `extra_service_fee_cents` |
| Expenses (passed through) | 1250 | `expenses_cents` |
| **Extra card charge** | **3838** | `extra_cents` (separate charge) |
| Points earned (pending 7 days) | 121 pts | 1 pt per $1 of card cash (12188 ¢), excluding tax and tips |

Tara's side of that booking:

| Line | Cents |
|---|---|
| Labor less 15% commission | 7650 |
| Extra labor 2250 less 338 commission | 1912 |
| Expenses | 1250 |
| **Tasker earnings** | **10812** (+ any tip, 100% to the tasker) |

Check: the client paid 10350 + 3838 = 14188. That is card 12188 + promo 1000 + points 1000, and it splits into tasker 10812 + platform 3376 (fees 1350 + 338, commission 1350 + 338).

Cancel example (API.md): 47.99 h before the original start puts the booking in the 50% tier.
- Kept: $51.75. It comes from the card first, per `retentionOrder`.
- Refund: $51.75, made up of $31.75 card released, 1,000 points returned and the WELCOME10 credit returned.
- Tasker: $38.25 (labor that wasn't refunded, less commission).
- Stripe: partial capture of 5175. "A partial capture automatically releases the remaining amount" [S1].

---

## 2. Money vocabulary and state labels

One glossary, used everywhere: UI copy, help articles and `/pricing`. Each term has one meaning and one visual.

| Term (UI) | Meaning | Visual token | Backed by |
|---|---|---|---|
| **Hold** | Card authorization, not yet charged | `--money-hold` dashed outline, clock icon | PI `requires_capture`, `bookings.stripe_payment_intent_id`, `capture_before` (new) |
| **Charged** | Money captured from the card | `--money-charged` solid | capture / automatic PI `succeeded` |
| **Released** | Part or all of a hold let go, never charged | `--money-released` | partial capture remainder, PI `canceled` |
| **Hold expired** | The authorization lapsed before capture | warning tone | PI `canceled` after `capture_before` [S1] |
| **Points reserved / used / returned / clawed back / earned (pending) / expired** | Movements of points | `--money-points` | `points_movements.kind` |
| **Promo credit** | Discount funded by TaskNest | `--money-promo` | `promo_redemptions`, `booking_tenders(promo)` |
| **Service fee** | Client fee, % of labor | neutral | `service_fee_cents` |
| **Commission** | Tasker-side fee, % of labor (shown to taskers and staff only) | neutral | `taskerCommissionBps` |
| **Extras** | Extra time + fee + expenses, a separate card charge | `--money-charged` | `extra_*` columns |
| **Tip** | Card-only, 100% to the tasker | `--money-charged` + heart icon | `tips` |
| **Cancellation fee / No-show fee** | The kept part of a hold under the policy curve | `--money-charged` | `refunds(kind=cancellation)`, ledger `cancellation_fee`, `no_show_fee` |
| **Refund** | Money returned after a charge; has a status | `--money-refund` | `refunds` + provider refund status (new) |
| **Transfer** | TaskNest → tasker's payout account (Stripe balance) | `--money-payout` | today's `payouts` row (`tr_…`) |
| **Bank payout** | Tasker's payout account → their bank | `--money-payout` | connected-account `po_…` (new) |
| **Clawback** | A tasker's share taken back after a refund or lost dispute | danger tone | ledger `tasker_payable` debits |
| **Disputed** | The cardholder's bank is reviewing a charge | danger tone | `disputes` |

### 2.1 Payment state labels (client-facing)

The mapping from Stripe objects to the words users see. The left column comes from Stripe docs; the right is TaskNest copy (original).

| Object and status (Stripe) | Client label | Detail line |
|---|---|---|
| PI `requires_action` | **Approve with your bank** | "Your bank wants to confirm this hold. Nothing is held until you approve." |
| PI `requires_payment_method` (after a decline) | **Card declined** | The decline reason in plain words; offers to try another card |
| PI `requires_capture` | **Hold · $83.50** | "Held on Visa ··4242 until Tue 3 Nov, 9:00 AM PST. You're charged after the task." The date is Stripe's `capture_before` [S1] |
| PI `canceled` (we voided) | **Hold released · $83.50** | "Released on …; your bank may take a few days to drop it." |
| PI `canceled` (expired) | **Hold expired** | "We'll place a new hold before your task" or "Confirm your card" (§9.4) |
| PI `succeeded` (capture) | **Charged · $83.50** | "Captured on … from the $83.50 hold." |
| Extras PI failed with `authentication_required` | **Payment needs your approval · $38.38** | Button: "Review and approve" (§5.8) |
| Refund `pending` | **Refund on its way** | "Card refunds usually show as a credit in about 5–10 business days, depending on your bank" [S9] |
| Refund `succeeded` | **Refunded** | Adds a bank reference (ARN) when Stripe provides one. Stripe says it can take up to 7 business days to receive it [S9] |
| Refund `failed` | **Refund failed** | "Your bank couldn't accept the refund. Support has been notified." [S9]: `refund.failed` can come up to 30 days later |
| Refund (reversal) | **Refunded (charge removed)** | "Your bank removed the original charge instead of adding a credit" [S9] |
| Dispute open | **Disputed with your bank** | "Refunds are paused while your bank reviews this payment" [S10] |

Tasker-facing payout labels use the Stripe payout statuses `pending`, `in_transit`, `paid`, `failed` and `canceled` [S12] (§6.5).

---

## 3. Information architecture and navigation

### 3.1 Site map

```
PUBLIC
/                      Landing (services, from-prices, how it works, pricing promise)
/services/:category    Category page (taskers in category, from-price, sample price math)
/taskers               Browse (public, read-only cards)            ← today: sign-in only
/taskers/:id           Tasker profile (rate, rating, reviews, sample quote)
/pricing[?v=N]         Published terms (any version)               ← exists
/help, /help/:slug     Help centre; numbers rendered from the policy row
/signin /signup /verify /reset
/become-a-tasker       Tasker sign-up entry
*                      404

CLIENT
/book/:taskerId/details → /time → /review   Booking stepper (Review & pay hosts the card form)
/book/done/:bookingId                       Booking result (hold receipt)
/bookings              Tabs: Needs action · Upcoming · Past
/bookings/:id          Task page: timeline, Money panel, actions, messages
/bookings/:id/receipt  Printable statement
/bookings/:id/approve  Payment needs your approval (3DS / off-session recovery)
/money                 Activity · Holds · Cards · Refunds
/points                Points (exists, restyled)
/account               Profile, addresses, consents, sign-out

TASKER
/tasker                Today: invitations with countdown, today's jobs, needs action
/tasker/jobs/:id       Job page: start, complete (extras preview), cancel (strike preview), no-show
/tasker/earnings       Statement: per-booking lines, balance, holds release dates
/tasker/payouts        Transfers + bank payouts; payout account status
/tasker/payouts/setup  Payout account onboarding (Connect)
/tasker/profile        Rate, skills, availability
/tasker/standing       Strikes, suspension rules

STAFF (/console)
/console               Queues home
/console/bookings[/:id]     Search; booking money timeline, ledger, Stripe objects, refund tool
/console/refund-requests    Client refund requests queue
/console/taskers[/:id]      Status, balance, strikes, payout account
/console/clients/:id        Points, bookings, refunds
/console/disputes           Open and recent disputes
/console/payouts            (admin) Preview and run, results, failures
/console/policies           (admin) Versions, draft, diff, publish
/console/health             (staff) Integrity views, trial balance, webhook backlog, provider
/console/test-tools         (admin, fake provider only) Simulate dispute, refund fail, hold expiry, payout fail, test clock, points grant
```

Every route sets `document.title` ("Bookings · TaskNest") and moves focus to its `h1`. This fixes "all titles are the same" (`frontend.md` §6).

### 3.2 Navigation per role

| Role | Desktop header (left → right) | Phone bottom tab bar (4–5 items, labels always shown) | Header right |
|---|---|---|---|
| Public | Logo · Services · Pricing · Help · Become a tasker | none (header with Sign in + menu sheet) | Sign in, Get started |
| Client | Logo · Book · Bookings (badge) · Money (badge) · Points · Help | Book · Bookings · Money · Account | Avatar menu (Account, Pricing, Sign out) |
| Tasker | Logo · Today · Jobs · Earnings · Payouts (badge) · Profile | Today · Jobs · Earnings · Payouts · Profile | Status chip (Active / Pending / Suspended) |
| Support agent | Logo · Queues · Bookings · Refund requests · Taskers · Disputes · Health | Queues · Bookings · Requests · More | Provider badge, name |
| Admin | Support set + Payouts · Policies · Test tools (fake only) | Queues · Bookings · Payouts · More | Provider badge, name |

**Badges** count items that need the user. The counts come from the new "needs action" read (§13). They are text, not colour alone: "Bookings, 2 need action".

- **Client:** approvals pending, expired holds, failed refunds.
- **Tasker:** expiring invitations, payout account requirements, failed bank payouts.
- **Staff:** refund requests, open disputes, failed refunds, failed transfers.

**Footer (all roles):** Pricing & terms · Help · "Payments: Simulated" or "Payments: Stripe test mode" (from `GET /health` `provider`) · Policy v{N} in effect.

---

## 4. Screens: public

### 4.1 Landing `/`

- **Purpose:** explain TaskNest and its pricing promise before sign-in. Today `/` redirects to sign-in (`frontend.md` P0 #3).
- **Pattern borrowed** [T1][T2]: category entry first, browse taskers with visible hourly rates, a short how-it-works, then trust.
- **Components:**
  - `Hero`: search field plus category chips, original TaskNest illustration.
  - `CategoryTile` × N: name and "from $38/h". The from-price is the minimum `hourly_rate_cents` of active taskers in that category, read under RLS.
  - `HowItWorks`, 3 steps: "Pick a tasker and time", "We hold, you approve", "Pay for the time worked".
  - `PricingPromise` block: a mini worked example rendered live from the active policy. "2 h at $45/h = $90.00 labor + $13.50 service fee (15%). Cancel 48 h or more ahead: full refund." All numbers come from `money_policies`, never hard-coded.
  - `TrustStrip`, under the TaskNest name: identity-checked taskers (from `kyc_verified_at`) and "Every charge shown before it happens". No dollar promise the backend can't settle (`taskrabbit.md` §4).
- **API:** anon reads of `taskers` (active), `money_policies`. No writes.
- **States:**
  - Loading: skeleton tiles.
  - Empty (no active taskers): "No taskers available yet."
  - Error: policy can't load, so hide the PricingPromise block and link to `/pricing`.

### 4.2 Category `/services/:category` and Browse `/taskers`

- **Purpose:** compare taskers. Public read-only; booking requires sign-in.
- **Pattern** [T3]: browse taskers; filter by date, time and price; open profiles before choosing.
- **Components:**
  - `FilterBar`: category, price range, date (once availability exists).
  - `SortMenu`: rating, then price (default).
  - `TaskerCard`: avatar, name, category, **rate per hour**, rating and count, completed tasks, headline, "ID verified".
  - `SamplePrice` line on each card: "2 h ≈ $103.50 incl. 15% service fee". It comes from `POST /quote` for signed-in users. For anon users it is labelled *Estimate* and computed with the domain `quote()` from the active policy, the only allowed client-side estimate (R1).
- **API:**
  - Existing: `taskers`, `display_names`.
  - **New:** `tasker_public_stats` view (rating avg, count, completed). Today `getTasker()` hard-codes `rating: null, reviews: 0`, and reviews can't be read by other clients (`taskrabbit.md` §1.3).
- **States:** a no-match empty state with a "Clear filters" action. Rows use skeletons while loading.
- **Test ids:** keep `tasker-list`, `tasker-search`, `tasker-category`, `tasker-card-<first>`, `tasker-name`, `tasker-rate`.

### 4.3 Tasker profile `/taskers/:id`

- **Purpose:** decide, and see the price before starting the stepper.
- **Components:**
  - `ProfileHeader`
  - `ReviewsList`: stars, reviewer first name or "Verified client", date
  - `RateCard`: rate, service fee %, a sample quote for 1/2/3 h, the cancellation curve summary and "Policy v1" link
  - Sticky `BookCTA` ("Choose a time"), disabled with a visible reason when not bookable (fixes `frontend.md` P1 #10): "Tara isn't taking bookings yet (pending verification)."
- **API:** reads, plus `POST /quote` (signed in) for the sample quote. **New:** public reviews view with `tasker_id`.

### 4.4 Pricing `/pricing[?v=N]` (exists; extended)

- **Purpose:** the published terms. Helix reads this page as the terms.
- **Additions:**
  - `?v=N` renders any version. Bookings link to their own version.
  - A version switcher with an "effective from" date for each version.
  - A "Holds and charges" section: hold at booking, capture at completion, extras as a separate charge, hold expiry windows. Copy is TaskNest's; the windows come from Stripe [S1].
  - A worked example generated by the domain from the selected version.
- **Also:**
  - Fix the axe `scrollable-region-focusable` failure on the curve table (`frontend.md` §6).
  - Keep `pricing-*`, `curve-row`, `curve-fee`, `curve-refund` and `policy-version`.

### 4.5 Help `/help`, `/help/:slug`

- **Purpose:** short, task-titled articles [T6] whose numbers render from the booking's or the active policy row, so help text can't drift from what is settled.
- **Starter articles:**
  - How holds work
  - What happens if I cancel
  - Rescheduling and the original-time rule
  - Extra time and expenses
  - Tips
  - Points
  - Refunds and how long they take [S9]
  - Disputes with your bank
  - For taskers: payouts, holds and clawbacks
- **API:** `money_policies` read. Content is static MDX with policy placeholders.

### 4.6 Auth: `/signin`, `/signup`, `/verify`, `/reset`, `/become-a-tasker`

- **Purpose:** sign-up and email verification. Today the API rejects unverified clients with `403 unverified`, and the UI has no way to verify (`frontend.md` P0 #4).
- **API:**
  - Supabase Auth directly (`signUp`, `verifyOtp`, `resetPasswordForEmail`).
  - The existing signup trigger sets role `tasker` from metadata; staff roles are never granted at signup (`backend.md` §6).
  - **New:** `POST /tasker/apply` creates the `taskers` row in `pending`, with category and rate inside admin bounds.
- **Keep:** `signin-*`, `demo-accounts`, `demo-<name>`. The demo list stays on a "Test accounts" disclosure for QA.

---

## 5. Screens: client

### 5.1 Booking stepper `/book/:taskerId/{details,time,review}`

- **Pattern** [T3]: choose a tasker, then date and time (up to a booking horizon), then task details, then review (payment method, promo), then confirm. The tasker's confirmation makes it scheduled.
- **The stepper:**
  - Shows 3 steps with progress.
  - Keeps state in the URL plus `sessionStorage`, so the "pricing & policies" link no longer drops the form (`frontend.md` P1 #13). The link opens `/pricing` in a sheet.
  - Shows the **Price rail** on every step (desktop right column; phone sticky bottom bar, §11).

**Step 1: Details**
- Duration presets (1 h, 2 h, 3 h, Custom in minutes), description (required, with a counter), time zone (auto from the browser; editable), address.
- Address is **new**: there is no column today, so it is stored as text in a new `bookings.address` field.

**Step 2: Time**
- `DayStrip` (next N days) plus `SlotGrid`. Today only `datetime-local` exists; the grid needs **new** availability.
- Rule: "The cancellation clock starts from this time even if you reschedule later" (R7; `original_start_at` never moves).
- Hold-window note:
  - When the start is beyond the hold window: "We'll save your card now and place the hold closer to the date."
  - Otherwise: "We'll place a hold today."
  - The rule is in §9.2.

**Step 3: Review & pay** (the core money screen)

```
┌ Review & pay ───────────────────────────────┬ Price (Policy v1) ───────────────┐
│ Tara R. · Handyman · Mon 2 Nov, 9:00 AM PST │ Labor 2 h × $45.00        $90.00 │
│ 123 Pine St (change)  · "Mount a TV" (edit) │ Service fee 15%           $13.50 │
│                                             │ Tax                        $0.00 │
│ Promo code [WELCOME10      ] ✓ −$10.00      │ Task total               $103.50 │
│ Use points [1,000] of 3,100  ✓ −$10.00      │ ─ Paid with ──────────────────── │
│                                             │ Promo credit WELCOME10   −$10.00 │
│ Card                          [Simulated]   │ Points (1,000)           −$10.00 │
│ ┌ Payment Element / simulated card form ┐   │ ┊ Card hold today         $83.50┊ │
│ └────────────────────────────────────────┘  │ ─ Later, only if it happens ──── │
│ ☑ Save this card so TaskNest can charge     │ Extra time: $45.00/h + 15% fee   │
│   extra time, expenses and re-holds for     │ Expenses: at cost, receipt shown │
│   this booking. (Terms)                     │ Cancel ≥48 h before: full refund │
│                                             │ 24–48 h: 50% · <24 h: 1 h of rate│
│ [ Place $83.50 hold and request Tara ]      │ ✓ Server quote matches           │
└─────────────────────────────────────────────┴──────────────────────────────────┘
```

- **Components:**
  - `PriceRail`: `MoneyLine` × n, `TenderSplit`, `HoldLine`, a `LaterCharges` disclosure, `PolicyRef`, `QuoteStatus`.
  - `PromoField`, `PointsField` (with available and pending balances), `PaymentForm` (§9.1), `SaveCardConsent`, `ConsequenceButton`.
- **API (existing):**
  - `POST /quote` on every input change (400 ms debounce, as today).
  - `POST /bookings` with an `Idempotency-Key`.
- **API (new):**
  - `POST /payments/customer-session` loads saved cards into the Element.
  - `POST /bookings` gains `confirmationTokenId` and `saveConsent`, and can return `payment.status = requires_action` with a `clientSecret`.
  - `POST /bookings/:id/payment/confirm` runs after 3DS.
- **Button label** = the card amount and the consequence, never the total. This fixes `frontend.md` P1 #12.
  - "Place $83.50 hold and request Tara"
  - If card = 0: "Request Tara (no card hold; card saved for extras)"
- **Validation shown inline before submit:**
  - The card tender must be $0.00 or at least $0.50. That is Stripe's USD minimum [S8]; the domain doesn't enforce it today (`stripe.md` #20). Message: "Card amount can't be between $0.01 and $0.49. Use 50 fewer points or none."
  - Points below the 500 minimum.
  - Promo rule errors (`422`, `404`).
- **Disabled-state reasons** are always written under the button (`aria-describedby`).
- **Keep:** `quote-panel`, `quote-tenders`, `quote-server-status`, `quote-mismatch`, `promo-input`, `promo-error`, `points-toggle`, `points-input`, `points-error`, `booking-start`, `booking-tz`, `booking-duration`, `booking-description`, `book-submit`. **Add:** `hold-amount`, `save-card-consent`, `payment-form`, `card-min-error`.

### 5.2 Booking result `/book/done/:bookingId`

- **Purpose:** the *After* of booking. A receipt of what was actually set aside.
- **Content, from the `POST /bookings` response:**
  - Status chip "Requested: waiting for Tara (responds by Tue 9:00 AM)". The deadline is `created_at + taskerResponseHours`.
  - The `TenderSplit` as settled.
  - The hold line with Stripe `capture_before` (**new** field) or "Card saved; hold placed on …".
  - "Points reserved 1,000 (not spent until the task is done)".
  - "Promo WELCOME10 applied".
- **Reconciliation:** the quote shown on step 3 versus the response `quote` and `allocation` (R3).
- **Next steps:** view booking, message (when chat exists), add to calendar.
- **Errors:**
  - `402 card_declined`: back to step 3 with the card form focused and the decline reason. The booking was never created, and reserved points were released (API.md: "If anything fails, the authorization is voided").
  - `409 slot_taken`: back to step 2 with that slot struck through and the reason.

### 5.3 Bookings list `/bookings`

- **Tabs** (URL-driven, `role="tablist"`):
  - **Needs action**: approval needed, hold expired, refund failed, tip window closing.
  - **Upcoming**
  - **Past**
- **Card:** tasker, date and time with zone, status chip, `PaymentStateChip` (Hold $83.50 · Charged $121.88 · Refund on its way $51.75) and policy version.
- **Total on the card:** the **net card charged to date** plus a tender mini-bar.
  - Both come from the server statement (R1).
  - The card no longer shows `total_cents` as if it were paid. That was misleading for split-tender bookings and missed extras (`frontend.md` P1 #9).
- **API:**
  - Reads as today (`myBookings`, `bundleBookings`).
  - **New:** `booking_statement` read for the chips, and a `needs_action` read for the tab count.
- **Empty states with a next step:**
  - "No upcoming bookings. Browse handymen and cleaners." (link)
  - "Nothing needs your attention."
- **Keep:** `booking-card`, `booking-total` (now = the net card charged, documented), `booking-tenders`, `booking-dispute`.

### 5.4 Task page `/bookings/:id`

- **Purpose:** one place for the booking's life and all its money.

```
┌ Mount a TV · Tara R. · Mon 2 Nov 9:00 AM PST · Policy v1 ─────────────────────┐
│ Timeline  ● Requested  ● Accepted  ● Started  ● Completed  ○ Reviewed          │
├ Money ──────────────────────────────────────────────────────────────────────── │
│ Task total                                   $103.50                           │
│   Promo credit WELCOME10           used      −$10.00                           │
│   Points 1,000                     used      −$10.00                           │
│   Card ··4242  hold $83.50 → charged         $83.50   Mon 2 Nov 11:04 AM       │
│ Extras (separate charge)                     $38.38   Mon 2 Nov 11:04 AM       │
│   30 min × $45.00 = $22.50 · fee $3.38 · expenses $12.50                       │
│ Tip                                          $20.00   Mon 2 Nov 6:12 PM        │
│ ─────────────────────────────────────────────────────                          │
│ Card total charged                           $141.88                           │
│ Points earned 121 · available Mon 9 Nov                                        │
│ [Download receipt]                                                             │
├ Actions ───────────────────────────────────────────────────────────────────────│
│ [Rate & tip]  [Request a refund]  [Get help]                                   │
└────────────────────────────────────────────────────────────────────────────────┘
```

- **Components:** `StatusTimeline`, `MoneyStatement` (grouped: Booking, Extras, Tips, Refunds, Points, Disputes), `ActionBar` (contextual), `MessageThread` (**new**, P1 product surface), `PolicyRef`.
- **Actions by status:**

| Status | Client actions (each opens a `MoneyActionSheet`) | API |
|---|---|---|
| requested / accepted | Reschedule, Cancel | `POST …/reschedule` (+ **new** `reschedule-preview`); `GET …/cancel-preview` (existing, unused today) → `POST …/cancel` |
| accepted, past start, not started | Report tasker didn't arrive | **new** client report (§13) |
| completed | Rate & tip, Request a refund, Get help | `POST …/review`, `POST …/tip` (+ **new** `tip-preview`), `POST …/refund` (202 request) |
| disputed | none (shows dispute status) | reads `disputes` |
| any with "needs action" | Approve payment, Confirm card | **new** payment recover (§5.8) |

- **Keep:** `cancel-open`, `cancel-confirm`, `cancel-reason`, `cancel-tier`, `reschedule-open/input/confirm`, `tip-open/input/confirm/room/error`, `review-open/rating/body/submit`, `refund-open/kind/amount/reason/submit/preview/error/paused`.

### 5.5 Cancel sheet (client)

- **Before**, from `GET /bookings/:id/cancel-preview`, the server. Today the UI uses only the browser preview (`backend.md` §8).
  - **Headline:** "You'll get $51.75 back."
  - **Rule:** "24–48 h before the original start (Mon 2 Nov 9:00 AM): 50% refund. Policy v1." The rule comes from `outcome.tierIndex` plus the booking's own policy version.
  - **Split** (from `refund.perTender` and `refund.kept`):

    | Tender | Kept | Back to you |
    |---|---|---|
    | Card | $51.75 charged | $31.75 released from the hold |
    | Points | none | 1,000 points returned |
    | Promo credit | none | WELCOME10 returned |

  - **Tasker gets** (shown to the client for transparency; it is in the preview payload): $38.25.
- **Confirm:** "Cancel and get $51.75 back". It is disabled until a reason is entered.
- **After**, from `POST …/cancel` `outcome` and `refund`:
  - The same table, now titled "Settled".
  - The hold line reads "Charged $51.75 · Released $31.75".
  - Reconciliation status (R3).
- **Clock source:** the preview is time-dependent. The sheet shows "Preview as of 10:42:07 AM". If the tier boundary is less than 10 minutes away it warns "This changes to <next tier> at 9:00 AM" and re-fetches on confirm. If the result tier differs, R3 shows it.

### 5.6 Reschedule sheet

- **Before**, from **new** `POST /bookings/:id/reschedule-preview {localStart}` (or the domain plus booking fields as an *Estimate* until it exists):
  - The new start.
  - "Cancellation fees still count from Mon 2 Nov 9:00 AM (original time)."
  - The hold effect: "Your hold expires Tue 3 Nov. Moving to Fri 6 Nov means we'll place a new hold before the task" (§9.2). Today `reschedule` doesn't re-check hold validity (`backend.md` F7); the preview must say what will happen.
- **After:** the updated timeline, plus a `HoldLine` with any re-hold plan.

### 5.7 Rate & tip sheet (combined, after completion)

- **Pattern** [T5]: rating first, then tip, in one flow. TaskNest keeps its own policy numbers (cap 25% of subtotal, 30-day window).
- **Before**, from **new** `POST /bookings/:id/tip-preview {amountCents}` (domain `validateTip` and `tipRoom` until it exists):
  - Chips 10/15/20% of subtotal, rounded by the domain.
  - Custom amount via `AmountInput` (cents-safe, `parseDollars`).
  - "Up to $22.50 more (25% of $90.00 labor, all tips together)".
  - "100% goes to Tara".
  - "Charged to Visa ··4242" (saved card) or "Use another card" (Payment Element, §9.1).
- **Below $0.50:** blocked inline [S8].
- **After:** `tip.amountCents`, `taskerGets`, `platformFee` = 0, and `paymentIntentId` (staff only), with the charge status.
- **Review bonus copy:** "+100 points for reviewing, whatever rating you give." It keeps the incentive independent of the rating (`taskrabbit.md` §1.11).

### 5.8 Payment needs your approval `/bookings/:id/approve`

- **Purpose:** recover an off-session charge the bank stopped. Stripe: "If the conditions for exemption aren't met, the PaymentIntent might throw an error" [S2]. Its recovery is to confirm the declined PaymentIntent on-session with its client secret (`stripe.md` §2.4, citing docs.stripe.com/payments/save-and-reuse).
- **Content:**
  - What was attempted: "Extra time and expenses $38.38".
  - When it was attempted.
  - Why the bank stopped it (`authentication_required`).
  - Buttons: Approve (Stripe.js on the declined PI; simulated 3DS in fake mode) or use another card.
- **API (new):** `GET /bookings/:id/payment` (pending items), then `POST /bookings/:id/payment/recover` (returns `clientSecret`), then `POST …/payment/confirm`.
- **After:** the extras line turns "Charged" and the "Needs action" badge clears.

### 5.9 Request a refund sheet (client)

- The current behaviour is correct and stays: a client refund is a **request** (`202`).
- The sheet:
  - Shows what's refundable ("Up to $141.88 card, plus points and promo"; **new** `refundable` field in the statement).
  - States "Support reviews requests; nothing is refunded until they approve."
  - After submitting, shows a request record with status "Submitted · ref RR-…". This is **new**: requests get a table and a status, instead of only an `audit_log` row (`backend.md` F14).
- **When resolved:** the sheet's request shows the settled refund and its split, for example "Refunded $70.00 (card $63.50, points 650)" from the API.md example, with a link to the refund line.

### 5.10 Money `/money`

- **Purpose:** the client's money across all bookings (R8).
- **Tabs:**
  - **Activity**: a chronological feed of every hold, charge, release, refund, point movement and dispute, each linking to its booking.
  - **Holds**: active holds with their expiry.
  - **Cards**: saved cards, with the Payment Element in `setup` mode to add one and CustomerSession `payment_method_remove` to remove [S2][S3].
  - **Refunds**: each refund with status and reference.
- **Consent record:** each saved card shows "Saved on 29 Oct for charges on your bookings (extras, re-holds, tips you approve)". Stripe requires that you "Keep a record of your customer's written agreement to your terms" [S2].
- **API (new):** `GET /me/money-activity` (or a `client_money_activity` view), `POST /payments/customer-session`, `POST /payments/setup-intent`, `GET /payments/methods`.

### 5.11 Points `/points` (exists, restyled)

- Keep the stats, lots and history.
- Add the pending → available date for each earn lot, debt explained ("You owe 63 points from a refund; redemptions are paused until you earn them back"), and links from each movement to its booking.
- Keep `points-available`, `points-lots`, `points-history`.

### 5.12 Account `/account`

- Profile fields: `full_name` and `home_tz` (the only writable columns today).
- Addresses (**new**).
- Consents (saved-card agreements, with revoke = remove card).
- Email verification status, password.

---

## 6. Screens: tasker

### 6.1 Today `/tasker`

- **Invitations** with a countdown to `created_at + taskerResponseHours`. The pattern of response timers comes from [T7]. Each invitation shows:
  - **"You'd earn $76.50"** (labor less commission), from the server statement or the quote figures `taskerNet`
  - the client's first name, time, duration and description
  - Accept and Decline buttons
  - Decline shows "Client's hold is released; no strike for declining."
- **Today's jobs:** Start; Complete.
- **Needs action:** payout account requirements (Connect notification banner component [S5]), failed bank payout, strike warnings.
- **API:**
  - Existing: `accept`, `decline`, `start`.
  - **New:** auto-decline job (BACKEND_NOTES known gap).
  - Expired invitations show "Expired. The client's hold was released at …" once that exists. Until then they show "Response window passed (accept will fail)".
- **Keep:** `job-card`, `accept`, `decline`, `start`.

### 6.2 Job page `/tasker/jobs/:id`, Complete sheet

- **Before**, from **new** `POST /bookings/:id/complete-preview {extraMinutes, expensesCents}`. Today `complete-preview` is a browser preview.

  | Client pays | | You earn | |
  |---|---|---|---|
  | Booked card hold captured | $83.50 | Labor 2 h | $90.00 |
  | Extra 30 min × $45.00 | $22.50 | Commission 15% | −$13.50 |
  | Service fee on extra | $3.38 | Extra labor | $22.50 |
  | Expenses | $12.50 | Commission on extra | −$3.38 |
  | **Extra card charge** | **$38.38** | Expenses (100%) | $12.50 |
  | | | **This job** | **$108.12** |

  Note under the table: "Available for payout after a 3-day hold (Thu 5 Nov), if not disputed." That comes from `payouts.holdDays`.
- **Confirm:** "Complete and charge $38.38 extra".
- **After** (from `captured`, `extrasCents`, `pointsRedeemed`):
  - If the extras charge needs client approval (`authentication_required`): "Waiting for client approval: $38.38". The tasker's earning line shows *Pending client approval*. It is never shown as earned until it settles.
- **Keep:** `complete-open`, `complete-extra-minutes`, `complete-expenses`, `complete-preview`, `complete-confirm`.

### 6.3 Tasker cancel sheet and Client no-show sheet

- **Cancel**, from `GET …/cancel-preview` (`who` = tasker):
  - "Client gets everything back."
  - "You'll be charged a $10.00 fee and get a strike (2 of 3 in 30 days; 3 suspends your account)."
  - **After:** the `strike` object.
  - Keep `tasker-cancel-*`.
- **Client didn't show:** exposes the unused `POST /bookings/:id/no-show {who:"client"}` (`frontend.md` §4).
  - Available after the start time.
  - **Before**, from **new** `GET …/no-show-preview?who=client`: "No refund under Policy v1: the client's $83.50 card hold is charged and the points and promo are used; you earn $76.50."
  - **After:** the outcome.

### 6.4 Earnings `/tasker/earnings`

- **Purpose:** a statement that reconciles to `tasker_balances`. It replaces the UI-computed "Earnings (net)", which is wrong (`frontend.md` P1 #8).
- **Layout:**
  - Balance header: **Available to pay out** · **On hold until …** · **Owed back** (a negative balance after clawbacks).
  - A per-booking statement: date, booking, line type (labor net, extras net, expenses, tip, cancellation pay, no-show pay, tasker penalty, refund clawback, dispute recovery, transfer), amount, running balance.
  - Each line links to its booking.
- **API (new):** `tasker_statement` view or `GET /tasker/statement?from&to`, built from the tasker's own `tasker_payable` ledger lines. Those lines are already readable by RLS (API.md); they lack labels and booking links. The balance comes from `tasker_balances` (existing).
- **Keep:** `tasker-history`, `tasker-payouts`.

### 6.5 Payouts `/tasker/payouts` and setup `/tasker/payouts/setup`

- **Two stages, named honestly:**
  1. **Transfers** (TaskNest → your payout account). Today's `payouts` rows, but status is shown truthfully: a transfer is "Sent to your payout account", not "Paid" (`stripe.md` #18).
  2. **Bank payouts** (payout account → your bank). Stripe statuses `pending`, `in_transit`, `paid` (typically 1–2 business days after submission), `failed`, `canceled`. A failed payout disables the bank account until it is updated [S12].
- **Payout account card:** status (Not set up / Information needed / Verifying / Ready / Restricted), the requirements list, and the action.
  - **Real Stripe:** the embedded `account-onboarding` component, on an Account Session with `components[account_onboarding][enabled]=true`. After `onExit`, check `details_submitted`, `payouts_enabled` and the capabilities [S6]. The Notifications banner for outstanding requirements, and Payouts / Payouts list components for bank payout history, are listed as supported embedded components [S5].
  - Hosted Account Links stay a fallback. Links are single-use and short-lived, and are never emailed (`stripe.md` §2.5).
  - **Simulated:** a TaskNest-built form that mirrors the onboarding steps and accepts Stripe's documented test values [S7]:
    - ID `000000000` (success) or `111111111` (mismatch)
    - DOB `1901-01-01`
    - address line 1 `address_full_match`
    - phone `0000000000`
    - SMS code `000-000`
    - bank routing `110000000`, account `000123456789` (payout succeeds), `000111111116` (fails with `no_account`), `000111111113` (`account_closed`)
- **Blocked state:** with no payout account, the payout run returns `blockedReason` (API.md). The tasker sees "Payouts paused: finish payout setup (2 items)" with the amount waiting.
- **API (new):** `POST /tasker/payout-account`, `POST /tasker/payout-account/session`, `POST /tasker/payout-account/link`, `GET /tasker/payout-account`; webhooks `account.updated` / v2 account events and `payout.*` (§13).

### 6.6 Profile `/tasker/profile`, Standing `/tasker/standing`

- **Profile (new endpoints):** rate within admin bounds, with the note "New rate applies to new bookings only; existing bookings keep their rate". That is already true: the booking snapshots `rate_cents`. Also skills, availability and bio.
- **Standing:** strikes in window, fee history, suspension rule from the policy. Keep `tasker-strikes-table`.

---

## 7. Screens: support agent and admin (console)

The design principle for staff is **one booking, one money timeline**: every row is a ledger txn, enriched with the tender, the provider object and the policy rule.

### 7.1 Queues `/console`

- **Cards with counts and oldest-age:**
  - Refund requests (new table)
  - Payments needing client approval
  - Refunds pending or failed
  - Open disputes (with evidence due dates)
  - Failed transfers or bank payouts
  - Integrity violations (must be 0; red if not)
- **Provider badge** from `GET /health` ("Simulated", or "Stripe test mode · 2026-10-28.endive").

### 7.2 Booking detail `/console/bookings/:id`

```
┌ Booking 7f3c… · Ava → Tara · completed · Policy v1 · [Simulated] ─────────────────────────┐
│ Money timeline                                                                             │
│ 29 Oct 10:41  booking_hold      Points 1,000 reserved · Promo $10.00 · Card hold $83.50    │
│               pi_fake_… requires_capture · capture_before 5 Nov 10:41 · txn 1a2b…          │
│ 2 Nov 11:04   booking_completed Card captured $83.50; $103.50 recognized → tasker $76.50 · platform $27.00 │
│ 2 Nov 11:04   extras_charged    $38.38 (labor $22.50 · fee $3.38 · expenses $12.50)        │
│ 2 Nov 11:04   points_earned     121 pts pending → 9 Nov                                     │
│ 2 Nov 18:12   tip               $20.00 → tasker $20.00 · pi_fake_…                          │
│ [Show ledger lines]  Dr/Cr per account, balanced ✓                                          │
├ Refund tool ──────────────────────────────────────────────────────────────────────────────│
│ Kind [Partial ▾]  Amount [$70.00]  Reason [.....]  Approver [— ▾]                          │
│ Server preview (figures from the API.md example): card $63.50 · points 650 · clawback $51.73 · platform $18.27 │
│ Requires approval: no (limit $100.00)                                                       │
│ [Refund $70.00]                                                                             │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **API:**
  - Existing: `searchBookings`, `ledger`, `disputesFor`, `POST …/refund-preview`, `POST …/refund`, `POST /admin/disputes/simulate` (now including `open` and `amountCents`), `POST …/decline` (admin, not exposed today), `POST …/no-show {who:"tasker"}` (admin).
  - **New:** the `booking_statement` read with provider ids and statuses.
- **Refund tool:**
  - The server preview is primary.
  - The browser fallback stays, labelled *Estimate (server unavailable)*, as today.
  - After issuing: per-provider refund ids and **statuses** (new). Today ids are returned but not stored (`backend.md` §6).
- **Dispute panel** (from `disputes` plus the widened statuses; `backend.md` F2):
  - The status in Stripe's words (inquiry or chargeback).
  - Amount withdrawn and fee. The fees per Stripe: a $15 dispute received fee, non-refundable, and a $15 countered fee if contested, returned on a win [S10][S11].
  - The evidence response window (usually 7–21 days) and the decision window (usually 60–75 days) [S10].
  - A note that a rare "late win" can flip `lost` → `won` [S10].
- **Keep:** `console-*`, `ledger-*`, `dispute-won`, `dispute-lost`, `view-ledger`. **Add:** `dispute-open`.

### 7.3 Refund requests `/console/refund-requests`

- **Purpose:** the missing staff queue for client requests (`backend.md` F14).
- **Each row:** client, booking, requested kind and amount, reason, age.
- **Actions:**
  - "Open in refund tool" prefills the tool.
  - "Decline with reason" sends a message to the client.
- **API (new):** a `refund_requests` table, `GET /admin/refund-requests` and `POST /admin/refund-requests/:id/resolve`.

### 7.4 Taskers `/console/taskers[/:id]`, Clients `/console/clients/:id`

- **Taskers:**
  - Status actions: active, suspended and **pending** (pending isn't exposed today), via `POST /admin/taskers/:id/status`.
  - Balance from `tasker_balances` and the statement.
  - Strikes.
  - Payout account status and requirements.
  - A "Run payout for this tasker" action (`POST /payouts/run {taskerId}`, which exists but isn't exposed).
- **Clients:** points (lots, debt), bookings, refunds, saved-card consents.

### 7.5 Payouts `/console/payouts` (admin)

- **Before:** **new** `POST /payouts/preview {taskerId?}` returns `planPayout` with no side effects. It lists each tasker's eligible bookings, hold release dates, adjustments, and blocked reasons ("no payout account", "balance zero or negative", "suspended").
- **Confirm:** "Send $X to N taskers".
- **After:** a per-tasker result (`payoutId`, `transferId`, `amountCents`, `blockedReason`), shown as a table rather than today's raw JSON `<pre>` (`frontend.md` P1 #17).
  - The run must not abort on one failure. That needs a backend fix (`backend.md` F6), and failed rows show as failed.

### 7.6 Policies `/console/policies` (admin)

- Version list with effective dates.
- "Draft new version": form editors for every `MoneyPolicy` field, in friendly units with bps shown alongside.
- **Before:** **new** `POST /admin/policies/validate` returns validation `details` and a field-by-field diff against the current version, plus a sample-booking comparison ("Tara 2 h: total $103.50 → $105.75").
- **Confirm:** `POST /admin/policies` (existing; not exposed today), with `effectiveFrom` at or after now. The copy says "Never retroactive. Existing bookings keep their version."

### 7.7 Money health `/console/health`

- **Existing staff-readable views** (API.md "Reading data"): `integrity_violations` (must be empty), `ledger_trial_balance`, `ledger_unbalanced_txns`, `points_integrity`, `booking_money_summary`, `stripe_events` (recent, handled or not).
- These need no new endpoints, just screens.

### 7.8 Test tools `/console/test-tools` (admin, fake provider only, all labelled Simulated)

- **Existing:** disputes simulate (open, won, lost, with amount), points grant, test-clock token mint.
- **New fake-only hooks**, mirroring Stripe test cards so the same scenarios exist in both modes:
  - **Hold expiry** (Stripe has no test helper for this; time-based tests stay on the fake provider, `stripe.md` §2.11).
  - **Refund fails later**, mirroring `pm_card_refundFail` [S4].
  - **Off-session needs authentication**, mirroring `4000002760003184` / `pm_card_authenticationRequired` [S4].
  - **Bank payout fails**, mirroring `000111111116` [S7].
  - **Transfer fails.**

---

## 8. Interaction states

### 8.1 Global patterns

| State | Pattern | Money-specific rule |
|---|---|---|
| Loading (first) | `Skeleton` with the final shape (rows for money lines, never spinners inside amounts) | A money line never shows "$0.00" while loading. It shows a skeleton and `aria-busy`. |
| Loading (refresh/preview) | Keep old numbers, dim them, show "Updating…" in `QuoteStatus` | The confirm button is disabled until the server preview for the *current* inputs arrives (prevents confirming a stale preview) |
| Submitting | Button shows progress text ("Placing hold…"); sheet locked; Idempotency-Key kept for retries (existing `useAction`) | Automatic retry on `409 busy` / `request_in_progress` with the same key (existing). A banner says "Still working; you won't be charged twice." |
| Empty | Sentence + next action | Statements show "No money has moved on this booking yet." |
| Error | Inline next to the field for 4xx; banner for 5xx/network with Retry (same key) | Never shows a partial After panel. If the result is unknown (network error after submit), it says so and re-reads the statement. |
| Success | After panel (R2) + toast "Settled as previewed" (R3) | Receipt link |
| Replayed | When the response has `Idempotent-Replayed: true`, show "Already done earlier; showing that result" | Makes idempotency visible to testers |

### 8.2 Error code → UI message map

Codes are from API.md. The copy is TaskNest's.

| Code | Where | Message pattern | Recovery |
|---|---|---|---|
| `402 card_declined` (+ decline code) | Book, tip, approve | "Your card was declined (insufficient funds)." | Focus the card form; offer another card |
| `403 unverified` | Book | "Verify your email to book." | Resend verification |
| `409 slot_taken` | Book, reschedule | "That time was just taken." | Return to time step; slot marked |
| `409 tasker_unavailable` | Quote, book | "Tara isn't taking bookings right now." | Back to browse |
| `409 response_window_expired` | Accept | "This request expired at …" | Remove card |
| `409 illegal_state` | Any action | "This booking is now {status}; refresh to see what changed." | Re-read statement |
| `409 dispute_open` / refund paused | Refund | "Refunds are paused while the bank reviews this payment." | Link to dispute status |
| `409 busy`, `request_in_progress` | Any write | "Still working…" | Auto-retry, same key |
| `422 rule_violation` | Previews, writes | The domain message verbatim, plus the policy rule link | Fix the input |
| `422 idempotency_key_reused` | Any write | "This request changed after it was sent. Please review and try again." | New key |
| `5xx`, network | Any write | "We couldn't confirm the result. Nothing is charged twice if you retry." | Retry with the same key; re-read statement |
| `503 payments_misconfigured` | Any money write | "Payments are unavailable." (staff see the reason) | none |

### 8.3 Booking payment state machine (UI view)

```
quote ─► [card form] ─► POST /bookings
                         ├─ 402 ──────────────► Card declined (no booking; points released)
                         ├─ requires_action ──► Approve with your bank ─► confirm ─► Hold active
                         ├─ setup only ───────► Card saved · hold scheduled ─► (job) Hold active | Needs approval
                         └─ requires_capture ─► Hold active ─┬─ capture ─► Charged (+ Released remainder)
                                                             ├─ cancel/decline ─► Released
                                                             └─ capture_before passes ─► Hold expired ─► re-hold | Needs approval
Extras / re-hold off-session ─┬─ succeeded ─► Charged
                              └─ authentication_required ─► Needs approval (§5.8)
Refund ─► pending ─► succeeded | failed (≤30 days later [S9]) ─► support follow-up
```

---

## 9. Stripe touchpoints

### 9.1 Card collection: where the Payment Element appears

TaskNest owns the price (quote, tenders, points), so the card form uses Stripe's "finalize payments on the server" flow [S3]:

- **Client:**
  - Render `<Elements>` with `mode`, `amount` and `currency`.
  - On submit, call `elements.submit()`, then `stripe.createConfirmationToken(...)`, then send the token id to the server.
- **Server:** create and confirm the PaymentIntent with `confirmation_token`.
- **3DS:** if the status is `requires_action`, the client calls `stripe.handleNextAction`.
- **Constraints from the docs** [S3]:
  - "You must immediately use the created ConfirmationToken … if unused, it expires after 12 hours."
  - "Make sure the Elements options you provide (such as `captureMethod`, `setupFutureUsage` …) match the equivalent parameters you pass when creating and confirming the Intent."
  - When the amount changes (promo or points edits), call `elements.update({amount})`. In React, re-render the provider with the new amount.
- **Loading Stripe.js:** always from `https://js.stripe.com`, never bundled. Stripe recommends including it on every page for fraud signals [S13]. The docs show the versioned URL `https://js.stripe.com/endive/stripe.js` [S3]. The npm loader `@stripe/stripe-js` loads it from Stripe.
- **API version:** current is `2026-10-28.endive` [S14]. Pin server requests and webhook endpoints to it. Endive removes `payment_method_types`, which the repo sends today (`stripe.md` #4).

| Screen | Elements options | Server call | Notes |
|---|---|---|---|
| Review & pay (start within the hold window, card ≥ 50¢) | `{mode:'payment', amount: card, currency:'usd', captureMethod:'manual', setupFutureUsage:'off_session', customerSessionClientSecret, appearance}` | `POST /bookings {…, confirmationTokenId, saveConsent}` → PI `capture_method=manual`, `customer`, `setup_future_usage=off_session`, `confirmation_token`, `confirm=true` | Manual capture puts the PI in `requires_capture` [S1] |
| Review & pay (card = 0, or start beyond the window) | `{mode:'setup', currency:'usd', customerSessionClientSecret, appearance}` | `POST /bookings` with a SetupIntent; hold placed later (§9.2) | Card saved for extras; consent required [S2] |
| Payment needs approval | Stripe.js on the declined PI's client secret | `POST …/payment/recover` → `…/confirm` | (`stripe.md` §2.4) |
| Money → Cards → Add card | `{mode:'setup', …}` | **new** `POST /payments/setup-intent` | CustomerSession `payment_method_remove` for removal [S2] |
| Rate & tip (another card) | `{mode:'payment', amount: tip, currency:'usd', captureMethod:'automatic'}` | `POST /bookings/:id/tip {amountCents, confirmationTokenId}` | Default is the saved card, on-session |

**Saved cards and consent** [S2]:
- The CustomerSession `payment_element` features (`payment_method_redisplay`, `payment_method_save`, `payment_method_save_usage: 'off_session'`, `payment_method_remove`) show saved cards and the save checkbox.
- Stripe's compliance list requires all of these:
  - terms saying how saved details are used, including "anticipated timing and frequency of payments" and "how you determine the payment amount"
  - use only for the stated purpose
  - explicit consent
  - a record of the agreement
- Because TaskNest *must* save the card for off-session extras, it sets `setup_future_usage` on the PaymentIntent. Stripe says that if you set `setup_future_usage`, "don't set `payment_method_save_usage` in the same payment transaction". So the save checkbox is TaskNest's own `SaveCardConsent` above the Element, and the Booking button stays disabled until it is ticked when a later charge is possible.
- Consent text (TaskNest's own):

  > Save this card so TaskNest can charge it for this booking's extra time and expenses, a new hold if your task is more than a few days away, and tips you choose. Amounts follow Policy v1. You'll see every charge on the booking page.

**Appearance mapping** [S6a]:
- Themes: `stripe`, `night`, `flat`.
- Variables: `colorPrimary`, `colorBackground`, `colorText`, `colorDanger`, `fontFamily`, `spacingUnit`, `borderRadius`, `fontSizeBase`; also `focusOutline`, `inputColorBorder`, `labelFontWeight`.
- Use `labels: 'above'`.
- `colorPrimary`, `colorBackground`, `colorText` and `colorDanger` **don't accept `rgba()` or `var(--…)`**, so TaskNest passes resolved hex values from its tokens for each theme.
- Stripe advises "a font size of at least 16px for input fields on mobile", so `fontSizeBase: '16px'`.

**Simulated twin (`SimulatedCardForm`, fake provider):**
- The same component interface as the Payment Element wrapper (`PaymentForm` with `submit() → {token}`), so screens don't branch.
- Fields: number, expiry, CVC, ZIP. Inputs map to the fake provider with Stripe's documented test numbers [S4]:
  - `4242 4242 4242 4242`: success
  - `4000 0000 0000 0002`: generic decline (sent as `pm_card_visa_chargeDeclined`; the fake provider should accept this id, which is Stripe's documented one, alongside its current `pm_card_chargeDeclined`)
  - `4000 0000 0000 9995`: insufficient funds
  - `4000 0000 0000 3220`: 3DS required, handled by a "Simulated bank check" modal with Approve and Fail
  - `4000 0027 6000 3184`: always needs authentication, so off-session extras need approval later
  - `4000 0025 0000 3155`: authenticate once at setup, then off-session succeeds
  - `4000 0000 0000 0259`: disputed
- A "Test cards" disclosure lists these, and the whole form carries the **Simulated** badge.

### 9.2 Holds

- **Validity** [S1]:
  - Card-not-present holds are 7 days for customer-initiated payments on all four brands.
  - Merchant-initiated holds are 7 days, except Visa: 5 days, and "The exact authorization window is 4 days and 18 hours."
  - The network classifies CIT vs MIT on signals, "not solely on API parameters like `off_session`".
  - The authoritative expiry is `payment_method_details.card.capture_before` on the charge.
  - "If the authorization expires before you capture the funds, the funds are released and the payment status changes to `canceled`."
  - Most payments allow one capture; a partial capture releases the rest [S1].
- **UI rule:**
  - Show `capture_before` (new column), never `now + 7d` (`backend.md` F7).
  - When the start is beyond the window, the stepper says "Card saved; hold placed on <date>". The plan is that a scheduled job holds off-session before the start and budgets for Visa MIT 4 d 18 h (`stripe.md` §2.3).
  - The timeline shows "Hold scheduled", then "Hold placed", or "Needs approval".
- **Where holds appear:** Review & pay (planned), booking result (placed), booking card chip, task page Money panel, Money → Holds, and the console timeline (with `capture_before`).
- **Release language:** "Released. Your bank may take a few days to drop it."

### 9.3 Off-session charges

- **Off-session charges:** extras at completion, re-holds, and an optional saved-card tip.
- **How they are made:** `customer` + `payment_method` + `off_session=true` + `confirm=true` [S2].
- **On failure:** the client gets "Needs approval" (§5.8), and the tasker sees "Pending client approval". Neither side shows money as settled before it is.

### 9.4 Refunds (UI facts from Stripe)

- An uncaptured PI "can't be refunded directly. You must cancel the PaymentIntent" [S9]. So cancellations before capture are labelled **Released**, not **Refunded**.
- Card refunds show as a credit about 5–10 business days later, depending on the bank [S9].
- A refund issued shortly after the charge may appear as a reversal instead [S9].
- A failed refund returns funds to TaskNest; this can take up to 30 days, with `refund.failed` [S9].
- "Stripe's processing fees from the original transaction aren't returned" [S9]. That is a staff-only note in the console refund tool, with the ledger addition in §13.

### 9.5 Connect onboarding and payout status

- **Account model and charge type:** separate charges and transfers. Stripe: "Transfer and charge amounts don't have to match", and "Your account balance is debited for the cost of the Stripe fees, refunds, and chargebacks" [S15].
- **Transfers:** created with `source_transaction` so they "return success regardless of your available balance" [S15]. Without it, "Attempting a transfer that exceeds the available balance fails with an error" [S15].
- **Refunds:** "refunding a charge has no impact on any associated transfers". Recover by netting or by transfer reversal [S15]. The tasker statement shows clawbacks as their own lines (§6.4).
- **Onboarding:**
  - The embedded `account-onboarding` component.
  - The Notifications banner component for requirements.
  - Payouts, Balances, Payouts list and Payout details components for bank payouts [S5][S6].
  - The simulated twin uses Stripe's test values [S7].
- **Payout statuses and events:** `payout.created`, `payout.updated`, `payout.paid`, `payout.failed`, and `account.external_account.updated` on failure. Payouts "trigger only the v1 events" even with Accounts v2 [S12].

### 9.6 Webhook-driven UI changes (R8)

| Event (Stripe) | UI effect |
|---|---|
| `payment_intent.amount_capturable_updated` | Hold active |
| `payment_intent.canceled` | Released / Hold expired |
| `payment_intent.payment_failed` | Needs approval / Card declined |
| `refund.updated`, `refund.failed` [S9] | Refund status, ARN |
| `charge.dispute.created/updated/closed`, `funds_withdrawn/reinstated` [S9][S10] | Disputed panel, refunds paused, client chip |
| `account.updated` / v2 account events | Tasker payout account status |
| `payout.*` [S12] | Bank payouts list, failure banner |

In simulated mode the fake provider raises the same events internally, and the UI marks them **Simulated**.

---

## 10. Design system

### 10.1 Brand: an original TaskNest look

- **Name and voice:** "TaskNest". Plain, number-first, calm. Sentences lead with the amount and the consequence ("You'll get $51.75 back"). No jokes near money. Use "hold" and "charge" exactly as in §2.
- **Mark:** three short, slightly curved strokes stacked like twigs, forming a shallow cup, with a small filled circle resting in it (the "task"). Colour: Nest Indigo on light, Indigo 200 on dark.
  - It is drawn as a single-colour SVG and works at 16 px (favicon).
  - Wordmark "tasknest" in lowercase Bricolage Grotesque 700, tight tracking.
  - No animal motif, no green-dominant palette, and no reuse of any marketplace's logo, illustration style or program names.
- **Illustration style:** flat geometric home objects (shelf, box, plant, drill) in indigo, ember and paper tones, with a 2 px stroke. Used only on landing, empty states and help, never next to money figures.
- **Signature element:** the **Price rail**, a ruled, receipt-like column with tabular figures and a dashed "hold" line. It appears on every money screen, so the brand *is* the clarity.

### 10.2 Colour tokens

All text pairs were checked against WCAG 2.2 with a contrast script. Ratios are listed; every text pair is at least 4.5:1, and every non-text border at least 3:1.

**Light**

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `--canvas` | `#F7F5F0` | page background (warm paper) | none |
| `--surface` | `#FFFFFF` | cards, sheets | none |
| `--ink` | `#16182D` | primary text | 17.46 on surface, 16.03 on canvas |
| `--ink-muted` | `#4B5068` | secondary text, hints (replaces `slate-400`, which fails axe) | 7.93 / 7.28 |
| `--line` | `#7A7F99` | input borders, dividers that carry meaning | 3.94 (non-text) |
| `--brand` (Nest Indigo) | `#3A35A8` | primary buttons, links, focus | white on brand 9.31 |
| `--ember` | `#9A4A12` | accent text, highlights | 6.25 |
| `--money-hold-fg/bg/border` | `#0B5A86` / `#E3F1FB` / `#3F86B8` dashed | holds | 6.47; border 3.95 |
| `--money-charged-fg/bg` | `#16182D` / `#ECEBF6` | charged | 14.78 |
| `--money-released-fg/bg` | `#4B5068` / `#EFEFF2` | released | 6.91 |
| `--money-refund-fg/bg` | `#0A6670` / `#DDF2F3` | refunds | 5.74 |
| `--money-payout-fg/bg` | `#23672B` / `#E4F3E2` | transfers, payouts | 5.98 |
| `--money-points-fg/bg` | `#5B23B8` / `#EFE8FC` | points | 7.41 |
| `--money-promo-fg/bg` | `#9A1A4F` / `#FCE8F1` | promo credit | 6.81 |
| `--danger-fg/bg` | `#B0261B` / `#FDECEA` | errors, clawbacks, disputes | 5.85 |
| `--warning-fg/bg` | `#8F4A00` / `#FFF1DC` | expiring, needs action | 5.99 |
| `--sim-fg/bg` | `#5C3B00` / `#FFE7A3` | Simulated badge | 8.27 |

**Dark** (under `prefers-color-scheme: dark` and `[data-theme=dark]`)

| Token | Hex | Contrast |
|---|---|---|
| `--canvas` / `--surface` | `#121323` / `#1B1D31` | none |
| `--ink` / `--ink-muted` | `#ECEBF5` / `#A9ACC4` | 14.03 / 7.41 on surface |
| `--brand` | `#A8A4FF` (button text `#121323`) | 8.24 |
| `--money-hold` | `#9FD3F7` on `#0E2C40`, border `#5E9FD0` | 9.04; border 5.8 |
| `--money-charged` | `#ECEBF5` on `#2A2B45` | 11.61 |
| `--money-released` | `#B9BCCF` on `#26283A` | 7.71 |
| `--money-refund` | `#86DCE3` on `#0D3236` | 8.75 |
| `--money-payout` | `#9BDDA0` on `#143018` | 9.04 |
| `--money-points` | `#CDB6FF` on `#2C1A4F` | 8.58 |
| `--money-promo` | `#FFA8CB` on `#40142A` | 8.67 |
| `--danger` | `#FFB4AB` on `#3F1310` | 9.43 |
| `--warning` | `#FFC98A` on `#3A2405` | 9.74 |
| `--sim` | `#FFE7A3` on `#3A2A00` | 11.39 |

- **Colour is never the only signal.** Each money kind also has a label ("Hold", "Refund") and an icon. Holds also use a dashed border; clawbacks use a minus sign and the word "Clawback".
- **Implementation:** Tailwind v4 `@theme` maps these tokens to utilities (`bg-money-hold`, `text-ink-muted`), replacing the scattered raw `blue-600`/`slate-*` (`frontend.md` §3). The Payment Element gets resolved hex per theme (§9.1).

### 10.3 Type

| Role | Font | Size / line height (rem at 16px) | Notes |
|---|---|---|---|
| Display (h1 landing) | Bricolage Grotesque 700 | 2.5 / 1.1 (phone 2.0) | Google Fonts |
| h1 page | Bricolage Grotesque 600 | 1.75 / 1.2 | |
| h2 section | Inter 600 | 1.25 / 1.3 | one heading style for sections (fixes ad hoc `H2` vs uppercase) |
| Body | Inter 400 | 1.0 / 1.5 | inputs are 16 px minimum (avoids iOS zoom; matches Stripe's guidance [S6a]) |
| Small / hint | Inter 400 | 0.875 / 1.4 | never below 0.875 for money labels |
| **Money** | Inter 500/600 with `font-variant-numeric: tabular-nums lining-nums` | inherits; totals at 1.125 or 1.25 | right-aligned; minus sign is U+2212; currency always shown |
| IDs (staff) | JetBrains Mono 400 | 0.8125 | `pi_…`, `re_…`, txn ids; copy button |

Money formatting stays in `src/lib/format.ts` (`money()` from `@domain formatCents`, `parseDollars`, `fmtDateTime` with the zone shown). Tables also show the zone label, fixing the browser-zone tables (`frontend.md` P2).

### 10.4 Spacing, radius, elevation, motion

- **Spacing:** 4 px base (`--space-1` … `--space-12`). Cards use 20 px padding (16 px on phone), with no per-page overrides.
- **Radius:** 8 px for inputs and buttons, 12 px for cards, 16 px for sheets. The Payment Element gets `borderRadius: '8px'`.
- **Elevation:** two levels. Cards have a 1 px border and no shadow; sheets have a shadow plus a scrim.
- **Motion:** 150–200 ms ease-out for sheets and toasts. Amount changes don't animate their digits; a 1 s background flash on changed `MoneyLine`s is enough. `prefers-reduced-motion` turns motion off.

### 10.5 Components

**Money primitives (new; these carry R1–R10):**

| Component | Props / behaviour |
|---|---|
| `Money` | `cents`, `kind`, `tender?`, `source`, `policyVersion?`. Renders formatted text with `data-money-*` (R9). Negative amounts get an `aria-label` like "minus 10 dollars". |
| `MoneyLine` | label, `Money`, optional detail ("2 h × $45.00"), status chip, timestamp, staff-only provider id. |
| `PriceRail` | Ordered `MoneyLine`s + `TenderSplit` + `HoldLine` + `LaterCharges` + `QuoteStatus`. Sticky desktop aside; phone bottom bar (§11). |
| `TenderSplit` | Stacked bar + list (Card/Points/Promo/Wallet-if-nonzero) in policy order; bar is decorative (`aria-hidden`), list is the content. |
| `HoldLine` | Dashed style; amount; card brand and last 4; "until {capture_before}"; states planned/active/expired/released/charged. |
| `PaymentStateChip` | One of the §2.1 labels; icon + text. |
| `MoneyActionSheet` | Before (preview) → Confirm (`ConsequenceButton`) → After (result) with `ReconcileBanner`. Owns the Idempotency-Key via `useAction`. Preview staleness timer. |
| `ReconcileBanner` | "Settled as previewed" or a two-column diff of mismatched lines. |
| `ConsequenceButton` | Label must include amount and verb; disabled reasons rendered and linked by `aria-describedby`. |
| `PolicyRef` | "Policy v1 · 50% tier" → opens `/pricing?v=1#cancellation` in a sheet. |
| `MoneyStatement` | Grouped sections from the statement read; printable. |
| `AmountInput` | Dollars entry → integer cents via `parseDollars`; never floats; shows min/max inline. |
| `SaveCardConsent` | Checkbox + terms link; records consent version and timestamp (new). |
| `PaymentForm` | Wrapper with two adapters: `StripePaymentElement` and `SimulatedCardForm`; same `submit()` contract. |
| `SimulatedBadge` | "Simulated" pill with tooltip "No real money moves in this environment." |
| `LedgerTrail` (staff) | Txn kind, lines Dr/Cr per account and unit, balanced check. |
| `ProviderRef` (staff) | Object id with status and copy button; links to Stripe dashboard in test mode only. |

**General (new or rebuilt):**
- `Dialog` and `Sheet` (focus trap, `aria-modal`, scroll lock, return focus; bottom sheet under `sm`)
- `Tabs` (ARIA, arrow keys, URL-synced)
- `Toast` (polite live region, dismissible)
- `Skeleton`, `EmptyState`, `ErrorState`
- `Avatar`, `Stars` (radio group for input; text "4.8 out of 5, 23 reviews" for display)
- `TaskerCard`, `CategoryTile`, `FilterBar`, `SortMenu`
- `DayStrip`, `SlotGrid`, `Stepper`, `StatusTimeline`, `CountdownChip` (with an `aria-live="off"` countdown and a static deadline in text)
- `DataTable`, which becomes a list on phone, with keyboard-selectable rows (fixes `<tr onClick>`)
- `Pagination`, `Banner`, `Badge`, `SkipLink`

---

## 11. Phone behaviour (390 px reference)

| Area | Behaviour | Fixes |
|---|---|---|
| Shell | Compact header (logo, page title, avatar) of 56 px + bottom tab bar of 64 px + safe-area insets; `min-w-0` on all grid children | Header ≈225 px today; console 550 px wide page at 390 px (`frontend.md` §7) |
| Price rail | Becomes a **sticky bottom bar**: "Card hold today $83.50 · Total $103.50 ⌃". Tapping it expands the full rail as a sheet; the primary button sits in the same bar, so the amount and the button are always seen together | Breakdown below the button today (P1 #11) |
| Money action sheets | Full-height bottom sheets; Before panel scrolls; Confirm pinned at bottom with the amount in its label | Centred modals over a tall header |
| Tables | Statements, history and console lists become stacked rows: label left, amount right, meta line under | Tables wrapping dates into 3 lines |
| Stat tiles | 2-up grid; balance header in a single row that scrolls horizontally with snap points (labelled region, focusable) | 1-up stats filling the screen |
| Inputs | 16 px font, `inputmode="decimal"` for amounts, `autocomplete` on address and name fields, 44 px minimum targets | Points checkbox 13×13, links under 24 px |
| Payment Element | Accordion layout on phone (`layout: {type:'accordion'}`) [S3]; tabs on desktop | none |
| Stripe 3DS | Opens over the sheet; on return, the sheet re-reads booking payment status and shows the After panel | none |
| Console | Usable on phone for queues and booking detail; ledger lines collapse per txn | none |
| Width | No horizontal page scroll at 320–390 px (checked in e2e with `scrollWidth === clientWidth`) | `/points` 2 px overflow |

---

## 12. Accessibility (WCAG 2.2 AA)

**Fixes for the current audit findings** (`frontend.md` §6):
- Contrast: tokens §10.2 (no `slate-400` text).
- `select-name`: every select gets a visible `<label>`.
- `scrollable-region-focusable`: wide regions are `role="region"` + `aria-label` + `tabIndex=0`.
- Modal focus: trap, initial focus on the sheet heading, `aria-modal`, Escape, return focus.
- Visible focus on links and cards: a 2 px `--brand` outline with a 2 px offset.
- Tabs with ARIA.
- Keyboard-operable rows.
- Tap targets at least 24×24 everywhere and 44×44 for primary controls.
- A skip link.
- Per-route titles and focus on `h1`.
- The review rating as a radio group.

**Money-specific rules:**
1. **Amounts read correctly.** `Money` renders a visible "−$10.00" with `aria-label="minus $10.00, promo credit"`. Totals are `<strong>` with a text label, never just bold.
2. **Previews announce changes politely and once.** The `PriceRail` has an `aria-live="polite"` summary line ("Card hold today $83.50") updated only after the server quote settles. Individual lines are not live regions, to avoid chatter.
3. **Confirm buttons state the consequence in text.** Colour (danger) is secondary.
4. **Errors:** an error summary at the top of the sheet links to the fields. Card errors from Stripe render inside the Element, and TaskNest mirrors the message in its own `role="alert"` region outside the iframe, so the button's `aria-describedby` can point to it.
5. **Timers:** invitation countdowns and preview staleness never auto-submit. A static deadline time is always in text (WCAG 2.2.1).
6. **Stripe iframes:** the Payment Element and Connect components handle their own fields. TaskNest wraps them in a labelled `fieldset` ("Card details") and gives the 3DS step a heading and focus return.
7. **Reduced motion** and **dark mode** are respected. Print styles exist for receipts.
8. **Tests:** axe-core in Playwright on every route at 1280 and 390 (the scratchpad harness `shotrun/` already does this), plus a keyboard-only booking, cancel and refund run.

---

## 13. Backend: existing vs new

### 13.1 Existing endpoints and where the UI uses them

| Endpoint | Screens (this proposal) | Exposed today? |
|---|---|---|
| `GET /health` | Footer provider badge, console header | no |
| `POST /quote` | Browse sample price, profile rate card, stepper price rail | yes |
| `POST /bookings` | Review & pay (extended, §13.2) | yes (no card) |
| `POST /bookings/:id/accept`, `/decline` | Tasker Today; console (admin decline) | tasker yes, admin no |
| `POST /bookings/:id/reschedule` | Reschedule sheet (client and tasker) | yes |
| `GET /bookings/:id/cancel-preview` | Cancel sheets (client and tasker) as the **primary** Before | **no** (browser preview used) |
| `POST /bookings/:id/cancel` | Cancel sheets | yes |
| `POST /bookings/:id/no-show` | Tasker "Client didn't show"; admin tasker no-show | **no** |
| `POST /bookings/:id/start`, `/complete` | Tasker job page | yes |
| `POST /bookings/:id/tip` | Rate & tip | yes |
| `POST /bookings/:id/refund-preview`, `/refund` | Console refund tool; client request sheet | yes |
| `POST /bookings/:id/review` | Rate & tip | yes |
| `POST /payouts/run` (+`taskerId`) | Console payouts; tasker detail "Run for this tasker" | all only |
| `POST /admin/taskers/:id/status` | Console taskers (+ `pending`) | partly |
| `POST /admin/policies` | Console policies | **no** |
| `POST /admin/disputes/simulate` | Test tools (+ `open`, `amountCents`) | partly |
| `POST /admin/points/grant`, `/admin/test-clock` | Test tools | no |
| Reads: `integrity_violations`, `ledger_trial_balance`, `ledger_unbalanced_txns`, `points_integrity`, `booking_money_summary`, `stripe_events` | Console health | **no** |

### 13.2 New endpoints and reads

Grouped by why money clarity needs them. ★ = needed for the first money-clarity release in simulated mode.

| # | New | Purpose | Notes |
|---|---|---|---|
| ★N1 | `booking_statement` view or `GET /bookings/:id/statement` | One server-computed money statement per booking: each money line with kind, tender, amount, status, time, policy rule, ledger txn id, provider id/status; plus `refundableCents`, `netCardChargedCents`, `taskerEarnedCents` (role-filtered) | Replaces UI math (R1). Built from ledger txns + tenders + provider records |
| ★N2 | `needs_action` read (per role) | Badge counts and the Needs action tab | Client: approvals, expired holds, failed refunds. Tasker: invitations, payout requirements. Staff: queues |
| ★N3 | `POST /bookings/:id/complete-preview` | Extras breakdown + tasker earnings before completing | Same domain code path as `complete`, no side effects |
| ★N4 | `POST /bookings/:id/tip-preview` | Cap, room, platform fee (0), charge method | Mirrors `validateTip` |
| ★N5 | `GET /bookings/:id/no-show-preview?who=` | Before panel for no-show | Mirrors `clientNoShow` / tasker rules |
| ★N6 | `POST /bookings/:id/reschedule-preview` | New start, unchanged anchor, hold validity effect | Also fixes reschedule not re-checking the hold (`backend.md` F7) |
| ★N7 | `POST /payouts/preview` | `planPayout` without side effects | Plus per-tasker error isolation in `run` (`backend.md` F6) |
| ★N8 | `tasker_statement` view or `GET /tasker/statement` | Labelled per-booking earnings lines + running balance | Fixes the wrong "Earnings (net)" |
| ★N9 | `refund_requests` table + `GET /admin/refund-requests` + `POST …/:id/resolve`; client `POST /bookings/:id/refund` writes it | Staff queue and client-visible request status | Today only `audit_log` (`backend.md` F14) |
| ★N10 | `POST /admin/policies/validate` | Validation + diff + sample-booking comparison before publish | Uses the existing validator |
| ★N11 | Fake-only hooks: `POST /admin/sim/{hold-expire,refund-fail,offsession-auth-required,transfer-fail,payout-fail}` | Exercise every Needs action state with no keys | Same pattern as `disputes/simulate`; 403 with Stripe |
| N12 | `POST /payments/customer-session` | Create or reuse a Customer; return `customerSessionClientSecret` [S2][S3] | Simulated: returns a fake session and saved fake cards |
| N13 | `POST /payments/setup-intent`, `GET /payments/methods` | Add a card (setup mode), list saved cards | Removal via CustomerSession `payment_method_remove` [S2] |
| N14 | `POST /bookings` extended | Accept `confirmationTokenId`, `saveConsent {version, at}`, return `payment {status, clientSecret?, captureBefore}`; new pre-requested state while `requires_action` | Drops the silent `pm_card_visa` fallback (`stripe.md` #2) |
| N15 | `POST /bookings/:id/payment/confirm`, `GET /bookings/:id/payment`, `POST /bookings/:id/payment/recover` | Finish 3DS; list pending payment items; recover `authentication_required` | (§5.8) |
| N16 | `POST /tasker/payout-account`, `…/session`, `…/link`, `GET /tasker/payout-account` | Connect account, Account Session for embedded components [S6], hosted link fallback, status | Simulated: TaskNest form with Stripe test values [S7] |
| N17 | Webhook handlers: `payment_intent.*`, `refund.*`, `charge.dispute.funds_*`, `account.updated` / v2, `payout.*` (Connect endpoint) | Drive R8 states | `stripe.md` §2.9; inquiry statuses and idempotent close (`backend.md` F2) |
| N18 | `tasker_public_stats` view, public reviews view, `GET /taskers/:id/availability` | Ratings on cards, slot grid | `taskrabbit.md` P0 #1–2 |
| N19 | `POST /tasker/apply`, `PUT /tasker/profile`, `PUT /tasker/availability` | Supply side | Rate changes don't affect existing bookings |
| N20 | `POST /bookings/:id/report` (client: tasker didn't arrive, problem) + `support_requests` | Client path for tasker no-show and problems | Staff resolve via admin `no-show {who:"tasker"}` or refund |
| N21 | `GET /me/money-activity` (or view) | Client Money → Activity | Could be a union view over statement lines |

**API hardening the UI depends on** (`backend.md` §9.6):
- Require `Idempotency-Key` on every mutating route (`400` if missing; F5). Without it, retries after a 5xx can double-move money.
- Store provider refund ids and statuses.
- Surface failed voids instead of swallowing them (F8).
- Pin `Stripe-Version: 2026-10-28.endive` [S14].

### 13.3 Schema additions (summary)

| Table | Additions |
|---|---|
| `profiles` | `stripe_customer_id`, `default_payment_method_id` |
| `payment_consents` (new) | user, payment method, consent text version, accepted_at, scope |
| `bookings` | `address`, `category`, `stripe_charge_id`, `capture_before`, `payment_state`, `setup_intent_id`, `hold_scheduled_for` |
| `refunds` | `provider_refunds jsonb` (`re_` id, status, failure_reason, reference/ARN) |
| `refund_requests`, `support_requests` (new) | client, booking, kind, amount, reason, status, resolution, refund_id |
| `taskers` | real `stripe_account_id`, `payout_account_status`, `requirements_due jsonb`, `onboarding_completed_at` |
| `payouts` → transfers | `source_transaction`, `transfer_group`, `reversed_cents`, real status |
| `connected_payouts` (new) | `po_` id, tasker, amount, status, arrival date, failure_code |
| `disputes` | widen `status` to Stripe's 10 values; `evidence_due_by`; fee lines |
| `stripe_events` | `payload`, `livemode`, `api_version`, `account`, `processed_at` |

### 13.4 Ledger additions (so the statement can be exact)

- A `processor_fees` expense per charge, from the balance transaction. Fees are not returned on refund [S9].
- Dispute received fee at open, countered fee on response, and its return on a win [S10][S11].
- Funds withdrawn and reinstated on disputes.
- Transfer reversals.
- These are staff-visible lines. Clients never see processor fees.

### 13.5 Which changes need a new policy version

Policy versions are required whenever a money rule changes (`taskrabbit.md` P2; API.md "Policy versions").

- **No new policy version** for anything in this proposal's UI or for N1–N21 above. They expose or record what the existing rules already settle.
- **New policy version required** (domain + unit tests + `/pricing` + `POST /admin/policies`, never retroactive):
  - A card-tender minimum (`card.minChargeCents = 50`, Stripe's USD minimum [S8]). It changes `allocateTenders` outcomes, so it must be versioned. Until then, the UI blocks 1–49¢ card amounts with a message (§5.1) and the server should return `422`.
  - Optional TaskRabbit-like changes (billing minimum and increments, 5-minute grace, per-expense cap, review window, booking horizon, invoice window). All listed in `taskrabbit.md` §8 P2. Product decisions; not required for money clarity.

---

## 14. Build order and test hooks

1. **Tokens + shell + accessible primitives.** Covers `Dialog`/`Sheet`, `Tabs`, `Toast`, `Skeleton`, titles, phone tab bar, and the axe fixes. Keep every existing `data-testid` so the 23 mocked e2e tests keep passing.
2. **Money primitives** (`Money`, `MoneyLine`, `PriceRail`, `TenderSplit`, `HoldLine`, `MoneyActionSheet`, `ReconcileBanner`) on the existing screens:
   - Switch the cancel sheet to the server `cancel-preview`.
   - Fix the button label (card amount) and the phone sticky rail.
3. **Statements:** N1, N2, N8, with the booking task page, `/money`, tasker earnings and console timeline. Fixes the earnings and console Total bugs.
4. **Previews and queues:** N3–N7, N9, N10, plus no-show UI, admin decline, policy publishing and money health.
5. **Simulated payments parity:** `SimulatedCardForm`, simulated 3DS, simulated onboarding with Stripe test values, N11 hooks, Simulated badges everywhere. This completes the owner's default mode.
6. **Real Stripe (test mode, when keys exist):** N12–N17, endive pin, two webhook endpoints, Customers, CustomerSession, ConfirmationTokens, `capture_before`, off-session extras, Connect embedded onboarding, `source_transaction` transfers.
7. **Discovery and supply:** landing, public browse, ratings view, availability, stepper address and time, tasker apply and profile, chat.

**Test hooks:**
- **Keep** all current ids (listed in `frontend.md` and checked against `src/` today: `quote-*`, `book-submit`, `cancel-*`, `tip-*`, `refund-*`, `console-*`, `ledger-*`, `payout-*`, `pricing-*`, `curve-*`, `points-*`, `tasker-*`, `demo-*`, `tab-*`).
- **Add:**
  - `hold-amount`, `hold-expiry`, `payment-state`, `reconcile-status`, `save-card-consent`, `payment-form`, `sim-badge`
  - `statement-line-<kind>`, `needs-action-count`
  - `complete-server-preview`, `tip-server-preview`, `noshow-open`, `noshow-confirm`
  - `payout-account-status`, `payout-preview`, `refund-request-row`, `policy-diff`, `health-violations`
- **R9 attributes** (`data-money-cents`, `data-money-kind`, `data-tender`, `data-source`, `data-policy-version`) let Helix assert, for example, that the After panel's `data-money-cents` equals the ledger txn amount.
- **Scenario matrix** in simulated mode, each also runnable in Stripe test mode with the listed card [S4]:

  | Scenario | Card |
  |---|---|
  | Success | 4242 |
  | Decline | 0002 |
  | Insufficient funds | 9995 |
  | 3DS | 3220 |
  | Off-session approval | 3184 |
  | Set up once, then off-session succeeds | 3155 |
  | Dispute | 0259 |
  | Refund fail | 5126 |

  Payout success and failure use bank accounts `000123456789` and `000111111116` [S7].
- **Time-based cases** (tier boundaries, hold expiry) stay on the fake provider with the test clock. Stripe test clocks cover Billing objects only (`stripe.md` §2.11).

---

## 15. Sources

### Stripe (fetched 2026-10-29 for this proposal unless noted)

- [S1] Place a hold on a payment method: https://docs.stripe.com/payments/place-a-hold-on-a-payment-method
- [S2] Save a customer's payment method during payment (Payment Intents, Elements): https://docs.stripe.com/payments/save-during-payment?payment-ui=elements
- [S3] Finalize payments on the server (Payment Element, ConfirmationToken, handleNextAction, elements.update, js.stripe.com/endive): https://docs.stripe.com/payments/finalize-payments-on-the-server?platform=web&type=payment
- [S4] Testing (test cards and `pm_card_*` ids; `pm_card_chargeDeclined` not listed): https://docs.stripe.com/testing
- [S5] Supported Connect embedded components (web): https://docs.stripe.com/connect/supported-embedded-components?platform=web
- [S6] Account onboarding embedded component (Account Session, `onExit`, `details_submitted`, `payouts_enabled`): https://docs.stripe.com/connect/supported-embedded-components/account-onboarding?platform=web
- [S6a] Elements Appearance API (Payment Intents): https://docs.stripe.com/elements/appearance-api?api-integration=paymentintents
- [S7] Connect testing (onboarding test values, payout test bank accounts): https://docs.stripe.com/connect/testing
- [S8] Supported currencies, minimum charge amounts (0.50 USD): https://docs.stripe.com/currencies
- [S9] Refund and cancel payments (timing, statuses, failures, references, fees not returned, cancel vs refund, events): https://docs.stripe.com/refunds
- [S10] How disputes work (funds and fees at open, inquiries, timelines, late win): https://docs.stripe.com/disputes/how-disputes-work
- [S11] US dispute fees ($15 received; $15 countered, returned on win): https://support.stripe.com/questions/june-2025-pricing-updates-for-disputes
- [S12] Manage connected account payouts (statuses, events, failure disables external account): https://docs.stripe.com/connect/payouts-connected-accounts
- [S13] Including Stripe.js: https://docs.stripe.com/js/including
- [S14] API versioning (current version `2026-10-28.endive`): https://docs.stripe.com/api/versioning
- [S15] Separate charges and transfers (`source_transaction`, available balance, refunds and reversals): https://docs.stripe.com/connect/separate-charges-and-transfers?platform=web&integration=custom&ui=elements&api-integration=paymentintents
- Via `stripe.md` (fetched 2026-10-29 by the Stripe reviewer):
  - recovering `authentication_required` with the declined PaymentIntent's client secret: https://docs.stripe.com/payments/save-and-reuse?payment-ui=elements
  - Endive removing `payment_method_types`: https://docs.stripe.com/changelog/endive
  - Accounts v2 recipient configuration: https://docs.stripe.com/connect/accounts-v2

### TaskRabbit (UX patterns only; paraphrased; no copy, brand or program names reused)

- [T1] Home page structure (categories, from-prices, how it works, trust strip): https://www.taskrabbit.com/ (via `taskrabbit.md`)
- [T2] How it works (pick, compare by rate, skills and reviews, message, pay after the task in-app, free changes with 24 h notice): https://www.taskrabbit.com/how-it-works (fetched for this proposal)
- [T3] Hiring flow (category → address → browse and filter → profile → date and time up to 14 days → details → review → confirm; scheduled once the tasker confirms): https://support.taskrabbit.com/hc/en-us/articles/210861763-How-Do-I-Hire-a-Tasker (fetched for this proposal)
- [T4] Paying after completion: https://support.taskrabbit.com/hc/en-us/articles/204411560-How-Do-I-Pay-My-Tasker (via `taskrabbit.md`)
- [T5] Tipping after the review: https://support.taskrabbit.com/hc/en-us/articles/216901546-Tipping-Taskers (via `taskrabbit.md`)
- [T6] Help centre structure: https://support.taskrabbit.com/hc/en-us (via `taskrabbit.md`)
- [T7] Invitation countdowns: https://www.taskrabbit.com/blog/turn-every-invite-into-income-start-with-these-4-tips/ (via `taskrabbit.md`)

### Repo and research inputs

- `/home/user/tasknest`: `README.md`, `docs/SPEC.md`, `docs/API.md`, `docs/BACKEND_NOTES.md`, `.coderabbit.yaml`, `supabase/functions/_shared/domain/{config,booking}.ts`, `src/` (test ids grepped)
- This folder: `backend.md`, `frontend.md`, `stripe.md`, `taskrabbit.md`, `platform.md`, `OWNER-NOTES.md`
