# TaskNest UX/IA proposal: marketplace-faithful

- **Angle:** stay as close as possible to the TaskRabbit flow while using the TaskNest API. That means discovery starts from a category, then a task-details wizard, tasker cards with price, reviews and availability, then booking with a card hold. Only interaction patterns are borrowed. TaskNest keeps its own name, brand, colours, illustrations and wording.
- **Repo:** `helix-fintech-apps/tasknest` at `65a45d8`, read-only. No edits were made.
- **Inputs:**
  - The five reader reports in this folder: `backend.md`, `frontend.md`, `stripe.md`, `taskrabbit.md`, `platform.md`.
  - `OWNER-NOTES.md`.
  - The repo's `README.md`, `docs/SPEC.md`, `docs/API.md` and `.coderabbit.yaml`, plus `src/` (routes, `data-testid`s, `lib/api.ts`, `lib/preview.ts`) and `_shared/domain/config.ts`.
- **Sources:**
  - **Stripe:** every fact comes from docs.stripe.com pages fetched on 2026-10-29 and is cited inline as **[Sx]**. The list is in §14.
  - **TaskRabbit:** patterns come from taskrabbit.com and support.taskrabbit.com, cited as **[Tx]**. Two pages were re-fetched for this proposal. The rest are cited from `taskrabbit.md`, which fetched them today.
- **Owner decisions that shape this proposal** (`OWNER-NOTES.md`, verbatim: "we will use simulated keys"):
  - By default the app runs on the deterministic `fake` provider.
  - Every Stripe touchpoint gets a simulated twin, labelled **Simulated** on screen, so the whole product works end to end without keys. The twins cover:
    - a card form that mirrors the Payment Element, with test cards, a 3DS challenge and declines
    - Connect onboarding
    - webhooks
    - payouts
  - Real Stripe test mode switches on only when keys are set.

---

## Contents

0. [Principles](#0-principles)
1. [Information architecture and navigation](#1-information-architecture-and-navigation)
2. [Core journeys (end to end)](#2-core-journeys-end-to-end)
3. [Booking and payment status model (what users see)](#3-booking-and-payment-status-model-what-users-see)
4. [Screen catalogue](#4-screen-catalogue)
   - 4.1 Public
   - 4.2 Booking wizard
   - 4.3 Client
   - 4.4 Tasker
   - 4.5 Support agent and admin console
5. [Stripe touchpoints (and their simulated twins)](#5-stripe-touchpoints-and-their-simulated-twins)
6. [Interaction states: global patterns and error mapping](#6-interaction-states-global-patterns-and-error-mapping)
7. [Design system and brand](#7-design-system-and-brand)
8. [Phone behaviour](#8-phone-behaviour)
9. [Accessibility](#9-accessibility)
10. [Backend: existing vs new endpoints](#10-backend-existing-vs-new-endpoints)
11. [`data-testid` migration](#11-data-testid-migration)
12. [Build order](#12-build-order)
13. [Open product decisions](#13-open-product-decisions)
14. [Sources](#14-sources)

---

## 0. Principles

1. **Follow the marketplace order.** The order is: category → task details (address, size, description) → compare taskers (price, rating, tasks done, next free time) → pick a time from the tasker's calendar → review and pay → tasker confirms → task day → completion and invoice → rate and tip. This is TaskRabbit's documented booking order [T3]. The one change: TaskNest lets visitors browse before signing in, and asks them to sign in at the review step (see §13 D1).
2. **Show money exactly as the server will settle it.**
   - Every amount on screen comes from `POST /quote`, a server response, or an `@domain` helper. The UI never adds up money itself (`.coderabbit.yaml`, `src/**`).
   - Buttons show **what the card is held or charged**, not the gross total.
   - Fee, cancellation, tip and points text is rendered from the booking's `money_policies` row. Helix reads that text as published terms.
3. **Say "hold" when it is a hold.** A hold is placed at booking and captured at completion. Stripe notes that some issuers show holds like charges, which "can sometimes confuse customers" [S2]. So every hold carries a "Hold, not a charge" chip, its amount and its release date.
4. **Label every simulated step.**
   - In fake mode, every payment surface carries a **Simulated** badge and accepts **only** Stripe's documented test values [S7][S12].
   - The app therefore never collects a real card number or SSN in a form TaskNest built itself.
5. **Original brand.** No TaskRabbit names, logo, colours, illustrations, program names or copy. Patterns only. All microcopy in this file is TaskNest's own.
6. **Keep the test surface.** Every existing `data-testid` keeps working or gets an explicit migration (§11). The 23 mocked e2e tests are the baseline.

---

## 1. Information architecture and navigation

### 1.1 Sitemap

```
PUBLIC (no sign-in)
/                         Home: hero, category tabs, popular projects ("from $X/hr"), how it works, trust, stats
/services                 All categories
/services/:category       Category landing: sub-tasks, from-price, top taskers, FAQs from policy
/book/:category           Booking wizard  ── step 1 Details  (/book/:category)
                                           ├─ step 2 Taskers  (/book/:category/taskers)
                                           ├─ step 3 Time     (/book/:category/time?tasker=:id)
                                           └─ step 4 Review & pay (/book/:category/review)  ← sign-in gate
/taskers/:id              Public tasker profile (reviews, skills, next free times)
/pricing                  Published terms (existing; stays the single source of truth)
/help, /help/:slug        Help centre, articles render policy numbers
/safety                   Trust & safety (screening, on-platform payments, reporting)
/become-a-tasker          Supply-side landing → /signup?as=tasker
/signin /signup /verify-email /reset-password
*                         404 page (replaces today's silent redirect)

CLIENT
/bookings                 My tasks: Needs action · Upcoming · Past
/bookings/:id             Task page: timeline, money panel, actions, messages
/bookings/:id/confirmed   Post-booking confirmation
/messages                 Inbox (one thread per booking)            [new backend]
/rewards                  Points (today's /points; old path redirects)
/account                  Profile · Addresses · Payment methods · Notifications · Security
/help/requests            My support requests                        [new backend]

TASKER
/tasker                   Today: invitations (countdown), today's jobs, setup banners
/tasker/jobs, /tasker/jobs/:id   Requests · Upcoming · Past; job page
/tasker/calendar          Weekly availability + date overrides       [new backend]
/tasker/earnings          Balance, statement, transfers, bank payouts
/tasker/payouts/setup     Payout account (Connect onboarding / simulated)
/tasker/profile           Public profile, skills & rate, preview card [new backend]
/tasker/apply             New-tasker wizard: profile → rate → availability → payouts → review
/account                  Shared account area

STAFF (support agent + admin)
/console/queue            Support requests + client refund requests  [new backend]
/console/bookings, /console/bookings/:id
/console/disputes
/console/taskers, /console/taskers/:id
/console/ledger
ADMIN ONLY
/console/payouts          Run all / one tasker, results, transfer + bank payout status
/console/policies         Versions, publish new version
/console/health           integrity_violations, trial balance, webhook log, provider badge
/console/test-tools       Fake provider only: disputes, points grant, test clock, simulated events
```

### 1.2 Navigation per role

| Role | Desktop header (≥1024 px) | Phone (<768 px) |
|---|---|---|
| **Public** | Logo · Services (menu of categories) · How it works · Pricing · Help · Become a tasker · Sign in · **Book a task** (primary) | Logo + menu button (drawer with the same links). A sticky **Book a task** bar on Home and category pages |
| **Client** | Logo · Book a task · My tasks (badge = Needs action count) · Messages (unread badge) · Rewards · Avatar menu (Account, Payment methods, Help, Pricing & policies, Sign out) | Bottom tab bar: **Book · Tasks · Messages · Rewards · Account** |
| **Tasker** | Logo · Today · Jobs · Calendar · Earnings · Avatar menu (Profile, Payout account, Help, Pricing, Sign out) | Bottom tab bar: **Today · Jobs · Calendar · Earnings · Account** |
| **Support agent** | Console sidebar: Queue · Bookings · Disputes · Taskers · Ledger | Top bar with a section switcher (select) and list → detail stack navigation |
| **Admin** | Sidebar adds: Payouts · Policies · Health · Test tools (Test tools only when `provider = fake`) | Same as agent |

Rules:
- **Role switch and staff browsing.** Admins and agents can open public pages and `/taskers/:id` (they can today). The booking CTA is hidden for staff, since `POST /bookings` returns `403 forbidden` for non-clients.
- **Provider badge.** Signed-in staff always see a badge in the header: `Payments: Simulated` or `Payments: Stripe test`, from `GET /health` `provider`. Clients and taskers see the **Simulated** badge only on payment surfaces.
- **Page titles.** Every route sets `document.title` as `<Page> · TaskNest` (today every page is "TaskNest") and moves focus to the `h1` on navigation (§9).
- **Deep links.**
  - Console tabs move from component state to URL segments.
  - Wizard steps keep their state in the URL (`category`, `minutes`, `date`, `tasker`) plus a session-storage draft.
  - Refreshing the page or pressing back never loses a booking in progress.

### 1.3 Breadcrumb and stepper in the booking wizard

`Details › Taskers › Time › Review & pay`.
- Earlier steps can be clicked.
- Later steps unlock once the current step is valid.
- On a phone, the stepper collapses to "Step 2 of 4 · Choose a tasker" with a back arrow.

---

## 2. Core journeys (end to end)

### 2.1 Client books a task (happy path, hold now)

```
Home ─► category tile "Mounting & hanging"
  └► /book/mounting           Details: address (ZIP + street), task size (S/M/L → minutes), description
      └► /book/mounting/taskers   Filter: date chips, time of day, price; sort; TaskerCards (rate, ★, tasks, next free)
          └► (optional) /taskers/:id profile sheet → "Choose Tara"
              └► /book/mounting/time?tasker=tara   Day strip (14 days) + slot grid (free/busy from server)
                  └► /book/mounting/review   [sign-in / sign-up gate if anonymous]
                       Summary · promo · points · PAYMENT (saved card or Payment Element / Simulated form)
                       consent checkbox · hold disclosure · cancellation summary (server preview text)
                       Button: "Request Tara · hold $83.50"
                       └► POST /bookings {confirmationTokenId | paymentMethodId, saveConsent}
                            ├─ 201 status=requested → /bookings/:id/confirmed
                            └─ requires_action → stripe.handleNextAction → POST /bookings/:id/payment/confirm → confirmed
```

- **Confirmation screen.** "Request sent. Tara has until Thu 9:14 AM to confirm." The deadline is `created_at + booking.taskerResponseHours`; the server returns it, the UI does not compute it.
- **When the tasker accepts.** The status becomes **Confirmed**. The client gets an in-app notification and an email. The "Booked" stage of the timeline fills in.

The task only counts as scheduled once the tasker confirms. TaskRabbit works the same way and shows the confirmation in the task's chat [T3].

### 2.2 Client books further ahead (save card now, hold later)

- **Why.** A card hold lasts about 7 days for a customer-initiated payment. A merchant-initiated Visa hold lasts **4 days 18 hours** [S2], and if a hold expires before capture "the funds are released and the payment status changes to `canceled`" [S2]. So a booking more than a few days out can't rely on one hold.
- **Who decides.** The **server** picks the plan and returns it with the quote (new `paymentPlan` field, §10). The UI only renders it:
  - `hold_now`: the Payment Element is mounted in `mode: 'payment'` with `captureMethod: 'manual'` and `setupFutureUsage: 'off_session'`. Button: "Request Tara · hold $83.50".
  - `save_card_hold_later`: the Payment Element is mounted in `mode: 'setup'`. Button: "Request Tara · save card". The disclosure reads: "We'll place a hold of $83.50 on Nov 9, about 2 days before your task. Nothing is charged until the task is done."
- **If the later hold needs approval.** The job that places the hold runs without the customer (off-session). If it needs authentication, the booking moves to **Payment needs your approval** (§2.4).

### 2.3 Task day, completion, receipt, rate and tip

1. The tasker taps **Start**, then **Complete**.
   - The complete form takes extra time (a 15-minute stepper; the domain still bills per minute) and expenses.
   - A live preview from `@domain` shows the extras charge.
2. The server:
   - captures `amount_to_capture` up to the hold ("A partial capture automatically releases the remaining amount" [S2])
   - charges extras as a **separate** charge on the saved card, off-session
3. The client's task page switches to **Receipt**. It shows:
   - booked time, extra time, the service fee on extras, expenses
   - points used, promo
   - the card amount captured, the card amount for extras
   - the amount released from the hold
4. The **Rate & tip** sheet opens: stars, then an optional review, then an optional tip.
   - Tip presets are 10 / 15 / 20 % of the subtotal, computed by the domain, plus a custom amount and the live "up to $X more" (`tipRoom()`).
   - The tip uses the saved card, on-session. A 3DS challenge, if one appears, is handled in place.
   - This mirrors TaskRabbit's rate-then-tip ordering [T7]. TaskNest keeps its own policy numbers: the cap is 25 % of the **subtotal** and the window is **30 days**.

### 2.4 Payment needs your approval (off-session failure)

- **Trigger.** A re-hold, extras charge or later tip is declined with `authentication_required`.
- **Stripe's guidance:**
  - "You must notify your customer to return to your application to complete the payment (for example, by sending an email or in-app notification)."
  - Then "use the declined PaymentIntent's client secret with confirmPayment to allow the customer to authenticate the payment" [S5].
- **UI:**
  - The booking gets a red **Payment needs your approval** chip.
  - The **Needs action** tab badge increments.
  - An email and an in-app notification link to `/bookings/:id?pay=1`.
  - The sheet shows the amount and reason, and offers:
    - **Approve with •••• 4242**: `stripe.confirmPayment` with the client secret from `POST /bookings/:id/payment/retry`
    - **Use another card**: mounts the Payment Element in the sheet
- **Simulated twin.** The same sheet with a simulated bank-check dialog (Complete / Fail).

### 2.5 Cancel and reschedule

- **Cancel sheet** (client):
  - Calls `GET /bookings/:id/cancel-preview`. That endpoint exists, but today's dialog uses only the browser preview.
  - Leads with the refund in large type ("You'll get back $51.75"), then the tier sentence rendered from the policy ("Cancelled 24–48 h before the original start: 50 % refund"), then the per-tender split.
  - Confirm button: **Cancel and refund $51.75**.
- **Reschedule sheet:**
  - The same day strip and slot grid as booking.
  - A fixed note: "Your cancellation terms stay tied to the original time, Tue Nov 4, 9:00 AM." This shows the `original_start_at` rule, which the API already enforces.
  - If mutual agreement inside 24 h is adopted (§13 D4), it becomes **Propose new time** and the other party accepts. This follows TaskRabbit's rule that both parties agree inside 24 h [T11].
- **Tasker cancelled:**
  - The task page shows "Tara cancelled. You've been fully refunded." and a **Find another tasker** button.
  - The button reopens `/book/:category/taskers` with the address, size and description prefilled. This is TaskRabbit's rebook pattern [T13].

### 2.6 Tasker joins and gets paid

```
/become-a-tasker → /signup?as=tasker → /tasker/apply
  1 Profile (photo, headline, bio)  2 Category & hourly rate  3 Availability (weekly blocks)
  4 Payout account: Connect embedded onboarding (Stripe test) or Simulated onboarding
  5 Review → status "pending" (admin activates; kyc_verified_at set)
→ /tasker (Today) with banners until active + payouts ready
```

- **Earnings.** The ledger balance moves to **Available for transfer** after `payouts.holdDays` (3) once the booking is settled. The payout run creates a transfer to the tasker's connected account. Stripe then pays the bank on the account's schedule.
- **Two separate statuses.** The tasker sees the **TaskNest transfer** status and the **bank payout** status (`pending` → `in_transit` → `paid`, or `failed` / `canceled`) [S9].

### 2.7 Something went wrong (support)

- **Entry points.** From a booking, **Get help with this task** opens a form prefilled with the booking, tasker and amount. Kinds:
  - "Tasker didn't show"
  - "Problem with the work"
  - "Charge looks wrong"
  - "Damage or safety"
  - "Other"
- **What happens next.** The request lands in the **Queue** (`/console/queue`) together with the client refund requests that today only reach `audit_log` (backend F14). An agent opens it, sees the booking's money panel, previews a refund (`POST /bookings/:id/refund-preview`) and issues it.
- **Patterns from TaskRabbit:** invoice disputes go to support with the task named [T20], and no-shows are handled through support with a free cancel [T14].

---

## 3. Booking and payment status model (what users see)

There are two layers. The **booking status** already exists (`domain/booking.ts`, 10 values). The **payment state** is new, set from Stripe and fake-provider events (§10).

| User-facing chip | Shown to | Derived from | Tone | Primary next action |
|---|---|---|---|---|
| **Finishing payment** | client | `payment_state = requires_action` on a booking not yet requested | warning | Finish card check |
| **Waiting for {tasker}** · countdown | client, tasker | `status = requested` | info | Client: Cancel. Tasker: Accept / Decline |
| **Confirmed** | both | `accepted` | success | Message, Reschedule, Cancel |
| **Hold scheduled** | client | `accepted` / `requested` + `payment_state = card_saved` | neutral | Change card |
| **Payment needs your approval** | client (tasker sees "Client payment pending") | `payment_state = action_required` | danger | Approve payment |
| **In progress** | both | `in_progress` | info | Tasker: Complete. Client: Get help |
| **Completed** | both | `completed` | success | Client: Rate & tip, Request refund |
| **Cancelled by you / by {tasker}** | both | `canceled_client` / `canceled_tasker` | neutral | Rebook |
| **Declined** | both | `declined` | neutral | Find another tasker |
| **No-show (client / tasker)** | both | `no_show_client` / `no_show_tasker` | neutral / danger | Get help |
| **Card dispute open** | both (read-only), staff | `disputed` + `disputes.status` | danger | Staff only |
| **Refund pending / Refund failed** | client, staff | refund status (new) | warning / danger | Staff: retry or contact |

The money panel on the task page keeps a separate **hold chip**:
- "Hold $83.50 · placed Nov 2 · releases by Nov 9". The release date comes from the charge's `capture_before`, which "indicates when the authorization expires" [S2]. Today the repo computes now + 7 days instead (stripe.md #8).
- After capture: "Charged $83.50 · $0.00 released", or "$12.00 released" after a partial capture.

---
## 4. Screen catalogue

**How to read each entry.**
- **API:** ✓ = existing endpoint or RLS read; ★ = new (detailed in §10); ◐ = existing endpoint that needs an extension.
- **States** lists loading / empty / error / success. The shared patterns are in §6.
- **Test ids:** existing ids are in `code`. New ids are marked *new*.

### 4.1 Public

#### P1. Home `/`
- **Purpose.** Start a booking in one tap from a category. Prove trust. Show a starting price for each kind of project. The structure follows TaskRabbit's home page [T1]:
  - category tabs with quick-booking links
  - popular projects with a starting price
  - a three-step "how it works"
  - a trust and guarantee block
  - stats
  - a footer of services by city
- **Components:**
  - `HeroSearch`: a combobox "What do you need help with?" that suggests categories and sub-tasks
  - `CategoryTabs`: a tab list; each panel holds 4–6 `TaskChip` quick links into `/book/:category?task=…`
  - `ProjectCard` grid: an illustration in TaskNest style, the task name, "from $X/hr"
  - `HowItWorks`: 3 steps, original copy: "Tell us the job" · "Pick your tasker and time" · "Pay when it's done"
  - `TrustStrip`: ID-verified taskers, payments stay on TaskNest, published pricing → `/pricing`
  - `StatsRow`: shown only when real counts exist (from `category_summary`); otherwise hidden. No invented numbers.
  - `Footer`
- **API:**
  - ★ `categories` table + `category_summary` view (category, slug, icon, `from_rate_cents` = min `hourly_rate_cents` of active taskers, active tasker count, completed count). Until it exists, the from-price can be read from `taskers` with ✓ anon RLS and shown as a rate, not computed.
  - ✓ `money_policies` for the trust strip text.
- **States:**
  - *Loading:* skeleton tiles; prices are never shown as "$0".
  - *Empty category* (no active taskers): tile shows "Coming soon", not bookable.
  - *Error:* the categories still render from a static list, without prices.
- **Copy rule.** The price is always a floor ("from $45/hr"), never a quote. TaskRabbit shows its starting prices the same way [T1].
- **Test ids:** *new* `home-hero-search`, `category-tab-<slug>`, `project-card-<slug>`.

#### P2. Services `/services` and category landing `/services/:category`
- **Purpose.** SEO-friendly category pages that explain the category and lead into the wizard.
- **Components:**
  - `CategoryHeader` (name, from-price, **Book now**)
  - sub-task chips
  - a `TopTaskers` carousel of three `TaskerCard`s by rating
  - an FAQ accordion whose answers render policy numbers (cancellation tiers, fee %)
- **API:**
  - ★ `category_summary`
  - ★ `tasker_public_stats` view
  - ✓ `taskers`
  - ✓ `money_policies`
- **States:** an unknown slug shows the 404 page.

#### P3. Public tasker profile `/taskers/:id` (also a sheet inside the wizard)
- **Purpose.** Help the client decide. TaskRabbit's profile shows skills, experience, rate, reviews for the category, photos, tools and minimums [T3][T4].
- **Components:**
  - `ProfileHeader`: avatar, name, `VerifiedBadge` (from `kyc_verified_at`), optional `ProBadge` ("Nest Pro"), rate, ★ average, review count, tasks completed
  - `About` (bio, headline)
  - `SkillsList` (tools and vehicle flags)
  - `NextAvailable`: three slot chips from the availability endpoint
  - `ReviewsList`: stars, first name, date, category, text; paginated 10 at a time; a rating histogram
  - sticky `ChooseTaskerBar`: "Choose Tara · $45/hr"
- **API:**
  - ✓ `taskers`, ✓ `display_names`
  - ★ `tasker_public_stats` and ★ `public_reviews` views. These fix the confirmed bug where other clients and anon users can't see a tasker's reviews (`taskerReviews()` joins through RLS-restricted `bookings`; `getTasker()` hard-codes `rating: null, reviews: 0`).
  - ★ `GET /taskers/:id/availability`
- **States:**
  - *No reviews:* "New on TaskNest". The rating is not shown as 0.
  - *Pending or suspended tasker reached by URL:* "This tasker isn't taking bookings right now" plus **See other taskers**. The full booking form is no longer rendered and greyed out (fixes frontend P1 #10 / shot `11c`).
- **Test ids:** keep `tasker-name`, `tasker-category`, `tasker-rate`. *New* `tasker-rating`, `tasker-reviews`, `choose-tasker`.

#### P4. Pricing & policies `/pricing` (existing, restyled)
- **Purpose.** The published terms Helix reads.
- **Content and API.** Unchanged (✓ `money_policies`).
- **Changes:**
  - Restyle only.
  - Add anchors (`#fees`, `#cancellation`, `#tips`, `#points`, `#refunds`, `#holds`).
  - Add a **Card holds** section stating hold timing in the policy's own terms.
  - Make the cancellation table a focusable scroll region (fixes the axe `scrollable-region-focusable` failure).
  - Inside the wizard, pricing opens in a **side sheet** via a router link. It no longer navigates with a plain `<a>` and loses the form (fixes frontend P1 #13).
- **Test ids:** keep all `pricing-*`, `curve-*` and `policy-version`.

#### P5. Help centre `/help`, `/help/:slug`
- **Purpose.** Self-serve answers. The structure follows TaskRabbit's help centre: search, audience sections, task-titled articles, then submit a request [T25].
- **Components:**
  - `HelpSearch`
  - `AudienceTabs`: For clients / For taskers / Payments & policies
  - `ArticleList`
  - `Article`: MDX with `<PolicyValue path="cancellation.tiers[1]"/>` tokens, so the numbers always match the policy row
  - **Still need help?** → support request form
- **Starter articles** (all answerable from today's policy and API):
  - How card holds work
  - What happens if I cancel
  - Rescheduling and the original-time rule
  - Extra time and expenses
  - Tips
  - Points
  - Refunds
  - For taskers: responding in time, strikes, payouts and the 3-day hold
- **API:**
  - ✓ `money_policies`
  - ★ `POST /support/requests`

#### P6. Become a tasker `/become-a-tasker`
- **Purpose.** Supply-side landing.
- **Content.** What you earn: rate set by you, a commission rendered from the policy (`taskerCommissionBps`), tips 100 % yours, payout timing. How payouts work. Requirements. CTA **Apply** → `/signup?as=tasker`.
- **API.** ✓ `money_policies`.

#### P7. Sign in / Sign up / Verify email / Reset password
- **Sign in** (existing): keep `signin-email`, `signin-password`, `signin-submit` and `demo-accounts` (`demo-<name>`). The demo list sits in a collapsible "Test accounts" panel, labelled **Simulated environment**.
- **Sign up** (★ Supabase Auth `signUp`; the trigger already maps `role=tasker` from metadata): name, email, password, a role toggle (Book help / Become a tasker), and terms consent.
- **Verify email:** "Check your inbox" with a resend button. A banner on `/book/*/review` handles `403 unverified` with **Resend link**. Today the UI has no way through it.
- **Reset password:** standard Supabase flow.
- **States:** wrong password (inline, focus moves to the error), rate limited, email already used.

#### P8. 404 `*`
- **Purpose.** Replace the silent redirect to `/taskers`.
- **Content.** "We couldn't find that page." with links Home / My tasks / Help. Sets title and focus.

### 4.2 Booking wizard

The wizard draft is `{category, address, minutes, sizeKey, description, taskerId, localStart, tz}`. It lives in the URL plus session storage, never in global memory only.

#### W1. Details `/book/:category`
- **Purpose.** Collect what's needed to find taskers and price the job. TaskRabbit asks for the address first, then shows taskers [T3].
- **Components:**
  - `AddressField`: ZIP + street with a `Combobox` of saved addresses for signed-in users. A "Why we ask" hint: used to find nearby taskers; the full address goes to your tasker only after they confirm.
  - `TaskSizePicker`: radio cards Small (about 1 h) / Medium (about 2–3 h) / Large (4 h+) / Custom hours (30-minute steps). Each maps to `minutes`. Pricing uses minutes, so no money is computed here.
  - `DescriptionField`: textarea with prompts (what, where in the home, access and parking, tools you have). Keeps `booking-description`.
  - `TimeZoneNote`: derived from the address (or the existing `booking-tz` select as a fallback until addresses exist).
  - Footer **See taskers & prices** (*new* `wizard-next`).
- **API.** None until the step is submitted. ★ `addresses` (own rows, RLS) for saved addresses.
- **Validation.** ZIP format; description 1–2000 chars (server limit). Errors appear inline with `aria-describedby`.
- **Backend dependency.** `bookings` has no address columns (backend §6). Until ★ `bookings.address_*` and service area exist, the field is collected, stored in the draft and sent as `addressId` once supported. A note says "Address sharing coming soon" in fake mode. (§13 D2)

#### W2. Choose a tasker `/book/:category/taskers`
- **Purpose.** Compare and pick. TaskRabbit offers filters for date, time of day and price [T3], and its cards show rating, tasks done in the category, skills and minimums [T4].
- **Layout:**
  - Desktop: a left `FilterRail` and a results column.
  - Phone: a **Filters** button opens a full-height `FilterSheet`; the active filters show as removable chips.
- **Filters:**
  - Date chips: Today · Next 3 days · This week · Pick a date
  - Time of day: Morning 8–12 · Afternoon 12–5 · Evening 5–9:30
  - Hourly rate range (dual slider plus number inputs)
  - "Nest Pro only" (if adopted)
- **Sort.** Recommended (default) · Lowest rate · Highest rated · Most tasks. The default sort is a TaskNest rule (rating × review count, then rate), not something TaskRabbit documents ([taskrabbit.md caveat]).
- **`TaskerCard`:**
  - avatar, name, `VerifiedBadge`
  - ★ average + review count, "N tasks completed"
  - **$45/hr**
  - a two-line pitch (headline)
  - a top review snippet
  - **Next free: Tomorrow 9:00 AM**
  - primary **Choose Tara**, secondary **View profile**
  - Keeps `tasker-card-<firstname>` on the card root.
- **Estimated total line on each card.** "About $103.50 for 2 h, before promo and points". It comes from the server (★ batch `POST /quote/estimate` or the existing ✓ `POST /quote` per visible card, debounced). The UI never multiplies.
- **API:**
  - ✓ `taskers` (+ `display_names`)
  - ★ `tasker_public_stats`
  - ★ `GET /taskers/availability?category&date&timeOfDay` (batch: first free slot per tasker)
  - ✓/★ quote estimate
- **States:**
  - *Loading:* 4 card skeletons.
  - *Empty after filters:* "No taskers free then" with **Clear filters** and **Try another day**.
  - *Empty category:* "No taskers in your area yet" with **Notify me** (optional).
  - *Error:* banner with retry; previous results kept.
- **Test ids:** keep `tasker-list`, `tasker-search` (now the name filter in the rail), `tasker-card-*`.

#### W3. Pick a time `/book/:category/time?tasker=:id`
- **Purpose.** Book a real free time from the tasker's calendar. TaskRabbit allows up to 14 days ahead [T3].
- **Components:**
  - `TaskerMiniCard` (change link)
  - `DayStrip`: 14 days, a scrollable radio group; days with no slots disabled; "Today" and "Tomorrow" labels
  - `SlotGrid`: 30-minute starts; free / taken / unavailable; taken slots are greyed and have `aria-disabled` plus a text reason
  - `SelectedSlotSummary`: "Tue Nov 4, 9:00–11:00 AM (Pacific)"
  - **Continue**
- **API.** ★ `GET /taskers/:id/availability?from&days=14&minutes=`. The server subtracts active bookings, because clients can't read other clients' bookings under RLS.
- **Fallback until availability exists.** A `datetime-local` limited to the future, with an explicit note: "We'll check this time when you request it." It keeps `booking-start`. A `409 slot_taken` on submit returns the user here with the slot greyed.
- **States:** no free slots in 14 days → "Tara is fully booked. See other taskers."

#### W4. Review & pay `/book/:category/review`
- **Purpose.** Confirm everything, choose the payment method, see exactly what is held, and request the booking.
- **Sign-in gate.** Anonymous users see a compact **Sign in / Create account** panel in place of the payment section. The draft is kept, and after auth they return to this step.
- **Layout:**
  - Desktop: two columns; on the right a sticky `QuotePanel` (`quote-panel`).
  - Phone: a single column with a **sticky bottom bar** showing "Hold $83.50" and an expand chevron that opens the breakdown sheet **above** the button. This fixes the price breakdown sitting under the Book button (P1 #11).
- **Sections, in order:**
  1. `BookingSummary`: category, tasker, date and time (with tz), address, size, description, each with **Edit**.
  2. `PromoField` (`promo-input`, `promo-error`) and `PointsToggle` (`points-toggle`, `points-input`, `points-error`, `points-available`). The points input gets a visible label (axe fix).
  3. `PaymentSection` (§5.1). It shows saved cards first (radio list "Visa •••• 4242, exp 12/34"), then **Add a card**, which mounts the Payment Element. In fake mode the `SimulatedCardForm` is shown under a **Simulated** badge.
  4. `CardConsent` checkbox, required: "Save this card to my TaskNest account. I allow TaskNest to charge it for this task's extra time and expenses, to re-place the hold before my task, and for tips I choose to add." It links to `/pricing#holds`. Stripe requires terms, explicit consent and a record of it [S3].
  5. `HoldDisclosure`:
     - `hold_now`: "We'll place a temporary hold of **$83.50** on your card now. You're charged only after the task is done; anything unused is released."
     - `save_card_hold_later`: the copy from §2.2.
  6. `CancellationSummary`: rendered from the policy's tiers relative to the chosen time: "Free to cancel until Sun Nov 2, 9:00 AM. After that, 50 % until …".
  7. `QuotePanel` (existing): rate × time, subtotal, service fee, tax, promo, points, wallet, **card**. Also "Server quote matches" or a mismatch warning (`quote-server-status`, `quote-mismatch`, `quote-tenders`).
  8. Submit `book-submit`: **Request Tara · hold $83.50**. The label shows the **card amount**, not the total (fixes P1 #12). If disabled, a `RequirementsList` above it says exactly what is missing: "Add a task description", "Choose a payment method", "Accept card terms", "Fix promo code" (fixes P1 #10).
- **API:**
  - ✓ `POST /quote`, ◐ extended with `paymentPlan`
  - ◐ `POST /bookings` with `confirmationTokenId | paymentMethodId | simulatedToken`, plus `saveConsent`, and later `addressId`
  - ★ `POST /payments/customer-session`
  - ★ `POST /bookings/:id/payment/confirm`
  - Always with an `Idempotency-Key` (existing `useAction`). The key is kept across network errors, 5xx and 409 busy, so retries cannot double-hold.
- **States:**
  - *Submitting:* the button shows a spinner and "Placing hold…", and all inputs are disabled.
  - *3DS:* the Stripe challenge modal (or the simulated one).
  - *Decline (402):* an inline message under the payment section mapped from `decline_code` (§6). Card details stay; points and promo are released by the server.
  - *409 slot_taken:* toast "That time was just booked" and route back to W3 with the slot refreshed.
  - *409 tasker_unavailable:* back to W2.
  - *403 unverified:* verify banner.
  - *Success:* replace history with `/bookings/:id/confirmed`, so Back doesn't resubmit.

#### W5. Confirmation `/bookings/:id/confirmed`
- **Content:**
  - Check illustration and "Request sent to Tara".
  - `ResponseCountdown`: deadline from the server.
  - A "What happens next" list: Tara confirms → you'll get a message → on the day → you're charged after the task.
  - A hold chip.
  - **View task**, **Add to calendar** (.ics), **Book another**.
- **API.** ✓ booking read (`bookings` RLS).
- **Note.** No money is recomputed. The figures come from the `POST /bookings` response held in navigation state, with a re-read fallback. The flash is cleared from history, which fixes P1 #15.

### 4.3 Client

#### C1. My tasks `/bookings`
- **Purpose.** One list with clear next actions.
- **Tabs** (ARIA tablist; URL `?tab=`):
  - **Needs action**: payment approval, rate & tip, tasker response expired, reschedule proposals
  - **Upcoming**
  - **Past**
- **`BookingCard`** (`booking-card`):
  - category icon, task title, tasker avatar and name, date and time, status chip
  - one-line money: "Hold $83.50", "Paid $121.38", "Refunded $51.75" (`booking-total` shows the card amount incl. extras via `bookingFigures`)
  - a primary contextual action
  - **Cards stay a single column on every screen size.** That fixes the uneven reflow on split-tender cards (P1 phone).
- **API.** ✓ `myBookings()` + `bundleBookings()`; ★ `payment_state` column; ★ `notifications` for badges.
- **States:**
  - *Empty Upcoming:* "Nothing booked yet" with **Book a task** (a real link, fixing the P2 dead-end).
  - *Empty Needs action:* "You're all caught up."

#### C2. Task page `/bookings/:id`
- **Purpose.** The task's single record: status, money, people, actions, messages.
- **Components:**
  - `TaskHeader`: title, status chip, date, address.
  - `StatusTimeline`: Requested → Confirmed → Started → Completed → Reviewed. Cancel and dispute branches are shown as terminal steps. Each step has a timestamp.
  - `TaskerPanel`: avatar, rating, **Message**, **View profile**.
  - `MoneyPanel` (*new* `money-panel`):
    - *before capture:* the hold chip plus `TenderBreakdown` (`booking-tenders`)
    - *after completion:* `Receipt`: booked labor, extra labor, service fee(s), tax, expenses, promo, points, card captured, extras charged, released, tips
    - refund rows with status
    - a dispute row (`booking-dispute`)
    - All figures come from `bookingFigures()` / `paidParts()` / `refundedParts()` (`@domain` via `lib/preview.ts`).
  - `ActionsBar`:
    - **Reschedule** (`reschedule-open`)
    - **Cancel** (`cancel-open`)
    - **Rate & tip** (`review-open` / `tip-open`, combined sheet; ids stay on the two sub-steps)
    - **Request a refund** (`refund-open`)
    - **Get help**
    - **My tasker didn't show** (★, shown after `start_at` + 15 min while not `in_progress`)
  - `MessagesPanel` (★ chat; until then a "Messaging is coming soon" placeholder, hidden in tests).
- **Dialogs and sheets.** Each existing dialog becomes an accessible `Sheet` on phone and a `Dialog` on desktop, keeping the existing ids:
  - Cancel: `cancel-reason`, `cancel-tier`, `cancel-confirm`. It now uses ✓ `GET /bookings/:id/cancel-preview`; the browser preview shows only while loading.
  - Reschedule: `reschedule-input` → slot grid, `reschedule-confirm`.
  - Tip: `tip-input`, `tip-room`, `tip-error`, `tip-confirm`, plus preset chips (*new* `tip-preset-10|15|20`).
  - Review: `review-rating` (a radio group of 5 stars, replacing the `<select>`), `review-body`, `review-submit`.
  - Refund request: `refund-kind`, `refund-amount`, `refund-reason`, `refund-submit`, `refund-error`, `refund-preview`, `refund-paused`. The copy says it is a **request** (202).
- **API:**
  - ✓ `reschedule`, `cancel-preview`, `cancel`, `tip` (◐ `paymentMethodId`, may return `requires_action`), `review`, `refund` (client 202)
  - ★ `POST /bookings/:id/payment/retry`
  - ★ `POST /bookings/:id/report-no-show`
  - ★ `POST /support/requests`
  - ★ messages
- **States:**
  - *Booking not visible* (404 under RLS): "We couldn't find this task" plus **My tasks**.
  - *Disputed:* refunds are paused (existing `refund-paused`) with the explanation "A card dispute is open with the bank; refunds wait for it to close."

#### C3. Payment approval sheet (`/bookings/:id?pay=1`)
- **Purpose.** Recover a declined off-session payment (§2.4).
- **Content:** what failed and why ("Your bank asked you to approve the $38.38 extra time charge"), the card, **Approve**, **Use another card**, and **Get help**.
- **API:** ★ `POST /bookings/:id/payment/retry` → `{clientSecret}` → `stripe.confirmPayment` [S5]; then a server re-read. A webhook `payment_intent.succeeded` closes the state.
- **States:** success toast "Payment approved"; a failure keeps the sheet open with the decline message.

#### C4. Messages `/messages` (★ backend)
- **Purpose.** Conversation per booking. TaskRabbit treats chat as the task's record [T12].
- **Components:**
  - `ThreadList` (avatar, last message, unread dot)
  - `Thread`: messages, day separators, a composer with a 2000-char limit, photo attach later
  - System messages ("Tara confirmed your task", "Hold placed")
- **Guardrail.** A soft warning when a message contains a phone number or email: "Keep payments on TaskNest so you're covered by our refund policy." This is an off-platform guard; TaskRabbit prohibits off-platform payment [T6].
- **API:** ★ `messages` table (RLS: the two parties and staff), Supabase Realtime.

#### C5. Rewards `/rewards` (today's `/points`)
- Existing content, restyled. Keeps `points-available`, `points-lots`, `points-history`.
- Phone: the tables become list rows; the 2 px overflow is fixed.

#### C6. Account `/account/*`
- **Profile:** full name and home time zone (the existing column grant).
- **Addresses** (★ `addresses`): list, add, edit, default.
- **Payment methods** (★ endpoints):
  - Saved cards list (brand, last 4, expiry, "Used for 2 upcoming tasks").
  - **Add card**: Payment Element in `mode: 'setup'` → ★ `POST /payments/setup-intent` → confirm.
  - **Remove**: blocked with an explanation while the card backs an upcoming hold or a scheduled hold.
  - Fake mode: a simulated list, with add and remove using test cards.
  - Stripe's CustomerSession can also enable `payment_method_remove` and `payment_method_redisplay` inside the Element [S1]. We use our own list here, so the "used by upcoming tasks" rule can be enforced.
- **Notifications:** email toggles (payment approval emails are always on and say why).
- **Security:** change password, sign out everywhere.

#### C7. My support requests `/help/requests` (★)
- List with status (Open / Waiting on you / Resolved) and the thread with support.

### 4.4 Tasker

#### K1. Today `/tasker`
- **Purpose.** Respond fast and run today's jobs. TaskRabbit gives invitations countdown timers, and a missed window loses the task [B3].
- **Components:**
  - `SetupBanners`, in priority order:
    - account `pending` ("We're reviewing your profile")
    - payout account not ready (**Set up payouts**)
    - Stripe `notification-banner` (embedded) when requirements are due after onboarding [S11]
    - strikes or suspension (existing)
  - `InvitationCard` list (`job-card`): client first name, task, date and time, duration, area (ZIP), your earnings "You'll earn about $76.50", from ✓ `quote.taskerNet` stored on the booking. A `CountdownChip` shows "Respond in 5 h 12 m". Actions **Accept** (`accept`) and **Decline** (`decline`). Once the window has passed, the card shows "Expired" and the actions are hidden.
  - `TodayList`: next job first, with **Start** (`start`).
  - `StatTiles`, reading **from the ledger**: "Balance" (✓ `tasker_balances`), "Next transfer" (★), "This week's earnings" (★ statement view). This replaces the UI-computed "Earnings (net)" that misses extras (frontend P1 #8).
- **API:**
  - ✓ `accept`, `decline`, `start`
  - ✓ `tasker_balances`, `tasker_strikes`
  - ★ Realtime on `bookings` for new requests (today a reload is needed)
  - ★ `POST /tasker/account-session` (notification banner)
- **States:** *No invitations:* "No new requests. Keep your calendar up to date to get more." with **Edit calendar**.

#### K2. Jobs `/tasker/jobs`, job page `/tasker/jobs/:id`
- **Job page components:**
  - Header and status.
  - Client card (first name), address (★ revealed after accept).
  - Description, timeline, and messages (★).
  - `EarningsPanel` from booking figures: labor net of commission, extras, expenses, tips, clawbacks.
- **Actions:**
  - **Accept / Decline** (requested)
  - **Start** (accepted, from start − 30 min)
  - **Complete** (`complete-open` → sheet with `complete-extra-minutes` as a 15-minute stepper, `complete-expenses`, `complete-preview`, `complete-confirm`). The preview says "The client's card will be charged $38.38 more, separately."
  - **Client didn't show** (✓ `POST /no-show {who:"client"}`, after `start_at`; today there is no UI for it)
  - **Cancel** (`tasker-cancel-open`, `tasker-cancel-reason`, `tasker-cancel-confirm`), with a strike warning from `previewTaskerCancel()`: "This adds a strike and a $10.00 fee. 2 of 3 strikes in 30 days."
  - **Reschedule**
- **Payment-state awareness.** If the client's payment needs approval, the tasker sees "Client payment pending: you can still start; we'll collect it." Whether to allow starting is §13 D5.
- **Test ids:** keep `tasker-history` on the Past list.

#### K3. Calendar `/tasker/calendar` (★)
- **Purpose.** Publish availability so clients can book real times. TaskRabbit taskers keep a calendar up to 17 days out [B2].
- **Components:**
  - `WeekRulesGrid`: Mon–Sun × 30-minute rows; drag to paint blocks; on phone a per-day list with "Add hours".
  - `DateOverrides`: block a day or add hours.
  - `SameDayToggle`.
  - Booked jobs overlaid read-only.
- **API:** ★ `tasker_availability` (weekly rules) + `tasker_availability_overrides`, written via ★ `PUT /tasker/availability`.

#### K4. Earnings `/tasker/earnings`
- **Purpose.** Answer "what did I earn, what's on hold, when is it paid, did it reach my bank".
- **Components:**
  - `BalanceSummary`: **Balance** (✓ `tasker_balances`), split by ★ statement view into *On hold until …* (the `payouts.holdDays` rule) and *Ready for next transfer*.
  - `NextTransfer`: "Transfers run daily; next run Thu 6:00 AM", from ★ config.
  - `Statement`: per booking: labor net, extra labor net, expenses, tips, cancellation pay, clawbacks, penalties; filter by month; CSV export. From ★ `tasker_statement` view over own `tasker_payable` ledger lines (✓ RLS already allows own lines).
  - `Transfers` (`tasker-payouts`): TaskNest → your payout account, with status (★ real `pending` / `paid` / `failed` instead of always `paid`).
  - `BankPayouts`: Stripe test mode uses Connect embedded `payouts` or `payouts-list` [S10]. Fake mode uses a simulated list. Statuses are `pending` / `in_transit` / `paid` / `failed` / `canceled`. "When a payout fails, the external account involved is disabled" [S9], so a failure shows **Update bank account**.
  - `StrikesTable` (`tasker-strikes-table`).
- **States:**
  - *No payout account:* the transfers area is replaced by **Set up payouts to get paid** (the API's `blockedReason`).
  - *Negative balance:* "You owe $12.00 from a refund. It'll be deducted from your next earnings." The reason comes from the statement.

#### K5. Payout account `/tasker/payouts/setup`
- **Purpose.** Connect onboarding (§5.5).
- **`PayoutStatusCard` states:**
  - Not started
  - In progress (`details_submitted` false)
  - Under review
  - Action needed (`currently_due` / `past_due`)
  - Ready (`stripe_transfers` active)
  - Payouts paused (`payout.failed`)
- **Body:**
  - Stripe test mode: embedded `account-onboarding` [S6].
  - Fake mode: `SimulatedOnboarding`.
- **After exit:** re-read status (★ `GET /tasker/payout-account`).
- **Manage later.** Account details through the embedded `account-management` component [S10].

#### K6. Profile & rate `/tasker/profile` (★)
- **Fields:**
  - photo
  - headline (existing column)
  - bio
  - skills, tools and vehicle flags
  - hourly rate within admin-set bounds, with a note "Changes apply to new bookings only". Bookings already snapshot `rate_cents`.
  - category (today one per tasker; multi-category is §13 D6)
- Live `TaskerCard` preview.
- **API:** ★ `POST /tasker/profile`; ★ `tasker_profile` columns (bio, avatar_url, skills jsonb, flags).

#### K7. Apply wizard `/tasker/apply` (★)
- **Steps:**
  1. Profile (K6 fields).
  2. Category & rate.
  3. Availability (K3, simplified).
  4. Payout account (K5).
  5. Review & submit → `taskers.status = pending`; an admin activates.
- **API:** ★ `POST /taskers/apply`, which creates the `taskers` row. Today nothing creates `taskers` rows outside the seed.

### 4.5 Support agent and admin console

General layout:
- **Desktop:** sidebar + list/detail split view.
- **Phone:** list → detail stack with a back button, `min-w-0` on every grid child. This fixes the 550 px page width at 390.
- **Rows** are links or buttons, so they are keyboard operable (fixes P1 #16).
- **People are shown by name;** IDs appear in mono with copy buttons (fixes P1 #17).
- **Lists paginate** with a cursor (today they are capped at 50–100 rows).

#### S1. Queue `/console/queue` (★)
- **Purpose.** Work support requests and client refund requests in one place (fixes F14).
- **Columns:** age, kind, booking, client, tasker, amount at stake, status, assignee.
- **Actions:** Assign to me, Open booking, Resolve (with note), Reply.
- **API:** ★ `support_requests` (+ backfill from `audit_log` `refund_requested`), ★ `POST /support/requests/:id/{assign,reply,resolve}`.

#### S2. Bookings `/console/bookings` and `/console/bookings/:id` (existing, restyled)
- **List.** Keeps `console-bookings`, `console-search`, `console-search-submit`, `console-status` (now labelled), `console-booking-row`. The **Total** column includes extras via `bookingFigures()` (fixes P1 #9).
- **Detail** (`console-booking-detail`):
  - money panel
  - tenders
  - Stripe object ids (`pi_`, `ch_`, `re_`, `tr_`; links to the Stripe test Dashboard in Stripe mode)
  - payment state
  - ledger entries (`view-ledger` → `/console/ledger?booking=`)
  - audit trail
  - messages (read-only)
- **Refund panel** (existing): `console-refund-kind`, `-amount`, `-reason`, `-approver`, `-preview`, `-checking`, `-fallback`, `-error`, `-submit`. Server preview first (✓ `refund-preview`). The approver picker appears when above `refunds.agentLimitCents`.
- **Admin-only actions:**
  - **Decline request** (✓ `decline`, today not in the UI)
  - **Tasker no-show** (✓ `no-show {who:"tasker"}`)
  - **Simulate dispute** (fake only; `dispute-won`, `dispute-lost`, *new* `dispute-open`; ◐ add inquiry statuses)

#### S3. Disputes `/console/disputes` (★ view)
- **List** of disputes with Stripe's status vocabulary: inquiry (`warning_*`), `needs_response`, `under_review`, `won`, `lost`, `prevented` (backend §7). Also amount, fee, the booking, and "recovered from tasker".
- **Filters:** open / closed.
- **Detail** links to the booking.

#### S4. Taskers `/console/taskers`, `/console/taskers/:id`
- **List** (`console-taskers`, `console-tasker-row`): status, KYC, **payout account status** (★), strikes, balance.
- **Detail:**
  - Activate / Suspend / Set pending (`tasker-activate`, `tasker-suspend`, `tasker-status-reason`; ◐ adds `pending`, which the API supports and the UI doesn't)
  - profile
  - statement
  - transfers
  - **Run payout for this tasker** (✓ `POST /payouts/run {taskerId}`, admin)

#### S5. Ledger `/console/ledger`
- Existing (`ledger-txns`, `ledger-txn`, `ledger-totals`, `ledger-booking`), with party names instead of UUID prefixes, filters by kind and date, and pagination.

#### S6. Payouts `/console/payouts` (admin)
- **Run payouts** (`payout-run`).
- The result is a **table**, not raw JSON (`payout-result`): tasker, amount, bookings, transfer id, balance after, blocked reason.
- Per-tasker failures are shown without stopping the run (needs backend F6 isolation).
- Bank payout failures come from `payout.failed` (★).

#### S7. Policies `/console/policies` (admin)
- **Versions** list (effective dates; current is marked).
- **Version view:** rendered like `/pricing`.
- **New version** form:
  - a JSON editor plus guided fields
  - `effectiveFrom` ≥ now
  - a required reason
  - a diff against the current version
- **API:** ✓ `POST /admin/policies`. A `422 invalid_policy` shows `details` as a field-mapped error list.

#### S8. Money health `/console/health` (admin; read-only for agents)
- **Checks:**
  - `integrity_violations` (must be empty; a big green check or a red count)
  - `ledger_trial_balance`
  - `ledger_unbalanced_txns`
  - `points_integrity`
- **Webhook log:** `stripe_events` (type, object, handled, received). ★ Replay is added once payloads are stored.
- **Provider and build:** from ✓ `GET /health` (`provider`, `build`).
- **API:** ✓ staff RLS reads of the views.

#### S9. Test tools `/console/test-tools` (admin, `provider = fake` only)
- ✓ Dispute simulate (open/won/lost + amount)
- ✓ Points grant
- ✓ Test clock token
- ★ **Send simulated event**: `payment_intent.payment_failed` with `authentication_required`, `payment_intent.canceled` (hold expired), `refund.failed`, `account.updated` (requirements due), `payout.paid` / `payout.failed`. These go through the same processing path as real webhooks, like today's dispute simulator.
- Every control carries a **Simulated** badge.

---
## 5. Stripe touchpoints (and their simulated twins)

The backend design (separate charges and transfers, Customers, `capture_before`, webhooks, API version `2026-10-28.endive`) is in `stripe.md` and `backend.md` §9. This section covers only **where Stripe shows up in the UI** and what the user sees.

### 5.0 Runtime switch

- ★ `GET /payments/config` → `{provider: "fake"|"stripe", publishableKey?, simulated: boolean}`.
- In **Stripe mode** the app calls `loadStripe(pk_test_…)` once at app start. Stripe recommends including Stripe.js "on every page, not just the checkout page" for fraud detection, and loading it "directly from `https://js.stripe.com`, rather than included in a bundle" [S14]. The npm loader loads it asynchronously by default [S14].
- In **fake mode** Stripe.js is not loaded at all.
- Build and CI refuse a `pk_live_` key (extends `check-live-keys.sh`; `stripe.md` #27).

### 5.1 Payment Element at Review & pay (W4)

| Item | Stripe test mode | Simulated twin (fake) |
|---|---|---|
| Mount | `<Elements stripe={stripePromise} options={{mode, amount, currency:'usd', captureMethod:'manual', setupFutureUsage:'off_session', allowedPaymentMethodTypes:['card'], customerSessionClientSecret, appearance}}>` + `<PaymentElement layout="accordion"/>`. The deferred-intent options and React provider come from [S1]. `mode: 'setup'` is used for `save_card_hold_later` and for card = $0 (§13 D3) | `SimulatedCardForm`: number / expiry / CVC / ZIP fields styled like the rest of the form. Quick-fill chips list Stripe's documented test cards [S7] |
| Options must match server | "Make sure the Elements options you provide (such as `captureMethod`, `setupFutureUsage`, and `paymentMethodOptions`) match the equivalent parameters you pass when creating and confirming the Intent" [S1] | n/a |
| Amount changes (promo, points) | Re-render the provider with the new `amount` from `POST /quote` (`elements.update` pattern for the deferred flow) [S1] | Re-render |
| Submit | `elements.submit()` → `stripe.createConfirmationToken({elements})` → `POST /bookings {confirmationTokenId}`. "You must immediately use the created ConfirmationToken … if unused, it expires after 12 hours" [S1] | The form maps the test number to a scenario token `sim_ct_<scenario>` **in the browser**; the card number is never sent to the server |
| 3DS | Server returns `requires_action` + client secret → `stripe.handleNextAction({clientSecret})` [S1] → `POST /bookings/:id/payment/confirm` | `SimulatedBankCheck` dialog (Approve / Fail), labelled Simulated |
| Saved cards | ★ `POST /payments/customer-session` creates a CustomerSession with `components.payment_element` features [S1]. The server always sets `setup_future_usage=off_session` because extras need it, so we **don't** set `payment_method_save_usage`. Stripe says: "If you intend to specify `setup_future_usage`, don't set `payment_method_save_usage` in the same payment transaction" [S1][S3]. Use `payment_method_redisplay` (show saved cards) and `payment_method_remove`; our own consent checkbox stays mandatory | Simulated saved-card list |
| Consent | Required checkbox (W4 §4). The server records consent text version + timestamp (★ `card_consents`) [S3] | Same |
| Errors | The Element shows field errors inline; our summary under it maps `decline_code` (§6) | Same messages, triggered by test numbers |

Accepted simulated inputs, from Stripe's testing page [S7]. Anything else is rejected with "Simulated mode accepts Stripe test card numbers only." Expiry: any future date. CVC: any 3 digits [S7].

| Test card | Scenario in TaskNest |
|---|---|
| `4242 4242 4242 4242` | Hold succeeds |
| `4000 0000 0000 0002` | Generic decline (`card_declined`) |
| `4000 0000 0000 9995` | Insufficient funds |
| `4000 0000 0000 0127` | Incorrect CVC |
| `4000 0000 0000 0069` | Expired card |
| `4000 0084 0000 0027` | 3DS required (US), then succeeds |
| `4000 0025 0000 3155` | 3DS at setup, later off-session charges succeed |
| `4000 0027 6000 3184` | 3DS always, so later off-session extras land in **Payment needs your approval** |
| `4000 0000 0000 0259` | Booking later gets a fraudulent dispute (staff can see it in Disputes) |

The fake provider's decline token should become `pm_card_visa_chargeDeclined`, matching Stripe's id [S7]. Today it is `pm_card_chargeDeclined` (backend F10).

### 5.2 Holds on the task page

| Moment | UI | Data |
|---|---|---|
| Hold placed | Chip **Hold $83.50 · releases by Nov 9** + an info popover: "This is a temporary hold, not a charge. Some banks show it like a charge until it drops off." The popover paraphrases Stripe's note that issuer statements may not distinguish holds [S2] | ★ `bookings.capture_before` (from `latest_charge.payment_method_details.card.capture_before` [S2]) |
| Hold scheduled (far booking) | **Card saved · hold on Nov 9** | ★ `payment_state = card_saved`, `hold_at` |
| Hold expired unexpectedly | Staff only: health alert. Client: nothing, unless re-hold fails → §2.4 | ★ `payment_intent.canceled` webhook |
| Captured | Receipt, with "Released $X" when partial. "A partial capture automatically releases the remaining amount" [S2] | ✓ `captured_cents` |

### 5.3 Off-session charges (extras, re-hold) and tips

- **Extras and re-hold** are charged off-session on the saved card. That needs `customer`, `payment_method`, `off_session=true` and `confirm=true` [S3].
- **If authentication is required,** the C3 sheet handles it [S5].
- **Tips** are on-session. The client is present, so the saved card is confirmed in the sheet, and a challenge is handled inline.
- **Amounts below Stripe's minimum.** Stripe's minimum USD charge is **$0.50** [S13]. The tip sheet blocks smaller tips, and the domain should reject a card tender between 1¢ and 49¢ (stripe.md #20). The UI shows the domain's message; it does not hard-code 50¢.

### 5.4 Refunds and disputes (client and staff)

- **Refund status rows:** Requested (client 202) → Issued → *Pending at bank* → Succeeded, or **Failed** (red, staff alerted).
  - Refunds can turn `failed` later and fire `refund.failed` (stripe.md §2.7). They need ★ refund status columns and webhook handling.
- **Disputes:** the client sees "Card dispute open with your bank. Refunds are paused until it closes." Staff see the Stripe status vocabulary (S3 screen).

### 5.5 Connect onboarding (tasker, K5)

| Item | Stripe test mode | Simulated twin |
|---|---|---|
| Account | Server creates the connected account on first visit (Accounts v2 recipient, Express dashboard, platform liable for fees and losses; stripe.md §2.5) | Server creates `acct_sim_<uuid>` |
| Session | ★ `POST /tasker/account-session` → Account Session with `components.account_onboarding.enabled` (and `notification_banner`, `payouts`, `account_management` as needed) [S6][S8] | Returns a simulated session |
| Render | `loadConnectAndInitialize({publishableKey, fetchClientSecret, appearance})` once per session; `<ConnectComponentsProvider>` with `ConnectAccountOnboarding onExit={refetchStatus}` [S8][S6]. `fetchClientSecret` "should always create a new account session" and is used to refresh expired sessions [S8] | `SimulatedOnboarding`: 4 steps (identity, address, bank, review), labelled Simulated |
| User authentication | May open a Stripe-owned popup; "You can't customize the embedded component to eliminate such popups" [S8]. The app must not set `Cross-Origin-Opener-Policy: same-origin`, which "break[s] user authentication" [S8] | n/a |
| Test data | Stripe's Connect sandbox values [S12]: SMS code `000-000`, phone `0000000000`, ID `000000000` (success) / `111111111` (mismatch), DOB `1901-01-01`, address line 1 `address_full_match`, routing `110000000` + account `000123456789` (payouts succeed) or `000111111116` (payout fails `no_account`) | The simulated form **accepts only these values** and maps them to the same outcomes. It never collects a real SSN or bank account |
| After exit | Re-read ★ `GET /tasker/payout-account`. Status follows `account.updated` (send the account back through onboarding while it has `currently_due` or `eventually_due` requirements; `past_due` means the account may be disabled) [S6] | Same endpoint |
| Ongoing | `notification-banner` on Today and Earnings. It "renders only when the connected account must respond to risk interventions or provide currently due requirements", and only after `details_submitted` [S11]. `onNotificationsChange({total, actionRequired})` drives our own "Action needed" tab badge [S11] | Simulated banner driven by a simulated `account.updated` |
| Bank payouts | `payouts` / `payouts-list` embedded components [S10] or our own list from `payout.*` events. Statuses `pending`, `in_transit`, `paid` ("typically … 1-2 business days after submission" for standard payouts), `failed`, `canceled` [S9] | Simulated payouts list; routing/account `000111111116` produces a failed payout |
| CSP (if added) | `frame-src` / `script-src` `https://connect-js.stripe.com` `https://js.stripe.com`, `img-src https://*.stripe.com` [S8] | n/a |
| Hosted fallback | Account Links (`type=account_onboarding`, refresh and return URLs). Links are single-use; reaching the return URL doesn't mean onboarding is complete (stripe.md §2.5) | n/a |

---

## 6. Interaction states: global patterns and error mapping

### 6.1 Patterns

| State | Pattern | Money-specific rule |
|---|---|---|
| **Loading** | Skeletons shaped like the final layout (cards, rows, receipt lines); a page-level `aria-busy`; spinners only inside buttons | Amounts are never shown as `$0.00` while loading. A money skeleton is used instead |
| **Empty** | `EmptyState`: a small illustration, one sentence, one primary action that leads somewhere useful | — |
| **Error (recoverable)** | Inline `Banner tone=error role=alert` near the failed region, plus **Try again**. Retries reuse the Idempotency-Key on network errors, 5xx and 409 busy (existing `useAction` / `keepsIdempotencyKey`) | After a 5xx on a money action, show "We're checking whether this went through…" and re-read the booking before offering a retry |
| **Error (page)** | The existing `ErrorBoundary`, restyled: "Something went wrong" + reload + Help | — |
| **Success** | A toast (`role=status`, auto-dismiss after 6 s, pausable, with a dismiss button) **and** updated server data on the page | The toast states the server's figure ("Refund of $51.75 issued") |
| **Optimistic UI** | Only for non-money actions (send message, toggle availability) | Never for money |
| **Live updates** | Supabase Realtime on own bookings, notifications and messages | — |

### 6.2 API error → user message (existing codes from `docs/API.md`, plus new ones)

| Code | Where | Message pattern | Action |
|---|---|---|---|
| `402 card_declined` + `decline_code=insufficient_funds` | W4, tip, C3 | "Your card was declined for insufficient funds. Try another card." | Focus the payment section |
| `402` + `expired_card` / `incorrect_cvc` / generic | same | "Your card has expired." / "The security code is incorrect." / "Your bank declined this card." | same |
| ★ `authentication_required` (off-session) | C3 | "Your bank needs you to approve this payment." | Approve sheet |
| `403 unverified` | W4 | "Confirm your email to book. We sent a link to a•••@…" | Resend |
| `409 slot_taken` | W4, reschedule | "That time was just booked." | Back to slots, refreshed |
| `409 tasker_unavailable` | W2–W4 | "{Name} isn't taking bookings right now." | See other taskers |
| `409 response_window_expired` | K1 | "This request expired." | Card removed |
| `409 illegal_state` | any action | "This task has changed. We've refreshed it." | Re-read |
| `409 busy` / `request_in_progress` | any | Not shown; auto-retry ×3 with the same key (existing), then "Still working on it…" | — |
| `409 dispute_open` / refund paused | C2, S2 | "Refunds are paused while a card dispute is open." | — |
| `422 rule_violation` | promo, points, tip, refund | The domain's own message (already typed) | Inline at the field |
| `422 idempotency_key_reused` | any | "Something didn't match. Please try again." + logged as a client bug | New key |
| `503 payments_misconfigured` | staff header | Red banner for staff: "Payments are misconfigured (live key refused)." | — |
| network / 5xx | any | "Connection problem. Your request may still be processing." | Re-read, then retry with the same key |

---

## 7. Design system and brand

### 7.1 Brand: TaskNest

- **Personality:** neighbourly, calm, precise about money. The visual idea is a **nest**: woven lines that hold something safe. That ties to "your money is held, not taken".
- **Logo mark ("the Nest"):**
  - three nested arcs forming a shallow bowl, drawn with one continuous 2.5-stroke line, with a single filled circle (the "yolk") resting in the bowl
  - built on a 24-unit grid; works at 16 px
  - wordmark "TaskNest" in the display face, with a capital N
  - no animals, no green
  - it replaces today's `⌂` glyph
- **Colour story:**
  - **Dusk** (indigo-violet): primary actions and links
  - **Yolk** (warm amber): highlights, "held funds", ratings
  - **Twig** (warm greys): text and surfaces
  - TaskRabbit's brand green is deliberately avoided
- **Illustration:** flat geometric scenes made of the same arcs and circles, on a 2-colour palette (Dusk + Yolk on Twig-50). People are abstract silhouettes, never stock photos. Category icons come from an open-source icon set (Lucide, ISC licence), not drawn to match any competitor.
- **Voice:** short, verb-led sentences. Money sentences always give a number and a date ("Hold $83.50 · releases by Nov 9").

### 7.2 Tokens (CSS variables in the Tailwind v4 `@theme`)

The ratios below were computed with the WCAG 2.x formula for this proposal. Text pairs used in the UI are all ≥ 4.5:1, and borders and focus rings ≥ 3:1.

```css
@theme {
  /* Brand ramps */
  --color-dusk-50:#F2F1FD; --color-dusk-100:#E3E1FB; --color-dusk-200:#C7C3F6; --color-dusk-300:#A29CEF;
  --color-dusk-400:#7C73E6; --color-dusk-500:#5B50DA; --color-dusk-600:#4A3FC8; --color-dusk-700:#3C32A6;
  --color-dusk-800:#2F2884; --color-dusk-900:#221D5F;
  --color-yolk-50:#FFF6E0; --color-yolk-300:#FFD98A; --color-yolk-400:#FFC857; --color-yolk-500:#F2A900; --color-yolk-800:#7A4E00;
  --color-twig-0:#FFFFFF; --color-twig-25:#FBFAF8; --color-twig-50:#F5F3EF; --color-twig-100:#EBE8E2;
  --color-twig-200:#D9D4CB; --color-twig-300:#BDB6AA; --color-twig-400:#958D80; --color-twig-500:#7A7266;
  --color-twig-600:#5F584E; --color-twig-700:#47413A; --color-twig-800:#2E2A25; --color-twig-900:#1C1915;
  --color-night-800:#1E1B26; --color-night-900:#14121A;

  /* Semantic (light) */
  --color-bg:            var(--color-twig-25);
  --color-surface:       var(--color-twig-0);
  --color-surface-muted: var(--color-twig-50);
  --color-text:          var(--color-twig-900);   /* 16.8:1 on bg */
  --color-text-muted:    var(--color-twig-600);   /* 7.0:1 on white, 6.3:1 on twig-50 */
  --color-text-subtle:   var(--color-twig-500);   /* 4.7:1 on white: minimum for any text */
  --color-border:        var(--color-twig-200);   /* decorative dividers only */
  --color-border-input:  var(--color-twig-400);   /* 3.3:1 on white: input boundaries (WCAG 1.4.11) */
  --color-primary:       var(--color-dusk-600);   /* 7.4:1 white text on it */
  --color-primary-hover: var(--color-dusk-700);
  --color-on-primary:    #FFFFFF;
  --color-link:          var(--color-dusk-700);   /* 9.6:1 */
  --color-focus:         var(--color-dusk-500);   /* 5.8:1 ring on white */
  --color-success:#1F7A4D;  --color-success-bg:#E8F5EE;   /* 4.7:1 */
  --color-warning:#8A4B00;  --color-warning-bg:#FFF4E5;   /* 6.3:1 */
  --color-danger:#B42318;   --color-danger-bg:#FEF0EE;    /* 5.9:1 */
  --color-info:   var(--color-dusk-700); --color-info-bg: var(--color-dusk-50); /* 8.5:1 */
  --color-hold:   var(--color-yolk-800); --color-hold-bg: var(--color-yolk-50); /* 6.7:1: "held funds" chips */
  --color-rating: var(--color-yolk-500);          /* star fill: decorative, always paired with a number */
  --color-simulated-fg: var(--color-twig-700); --color-simulated-stripe: var(--color-twig-200);

  /* Type */
  --font-display: "Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif;
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
  /* Spacing: 4 px base (Tailwind default scale) */
  --radius-sm:6px; --radius-md:10px; --radius-lg:16px; --radius-xl:24px; --radius-pill:999px;
  --shadow-1:0 1px 2px rgb(28 25 21 / .06), 0 1px 1px rgb(28 25 21 / .04);
  --shadow-2:0 4px 12px rgb(28 25 21 / .08);
  --shadow-3:0 12px 32px rgb(28 25 21 / .14);
  --ease-standard:cubic-bezier(.2,0,0,1); --dur-fast:120ms; --dur-base:200ms; --dur-slow:320ms;
}
```

**Dark theme** (`prefers-color-scheme: dark` plus a manual toggle in Account):

| Token | Value | Contrast |
|---|---|---|
| `bg` | `night-900` | — |
| `surface` | `night-800` | — |
| `text` | `twig-50` | 16.8:1 |
| `text-muted` | `twig-300` | 8.4:1 on `night-800` |
| `primary` | `dusk-300` with `on-primary` `night-900` | 7.6:1 |
| `link` | `dusk-300` | 6.9:1 on `night-800` |
| `border-input` | `#6E6779` | 3.1:1 |
| `focus` | `dusk-400` | 4.8:1 |
| `danger` | `#FDA29B` | 9.6:1 |
| `success` | `#6CD3A0` | 10.1:1 |
| `hold` | `yolk-300` | 13.7:1 |

Today the app sets `color-scheme: light` only.

**Type scale:**

| Size / line height | Use |
|---|---|
| 12/16 | Caption |
| 14/20 | Small, table |
| 16/24 | Body, inputs; minimum 16 px on phone |
| 18/28 | Lead |
| 20/28 | H4 |
| 24/32 | H3 |
| 30/36 | H2 |
| 36/44 | H1 |
| 48/56 | Display, home hero only |

Other type rules:
- Display face for H1–H2 and hero; Inter for everything else.
- **All money uses `font-variant-numeric: tabular-nums`** (keep today's `MoneyRow` behaviour). The negative sign stays `−`.
- IDs (`pi_…`) use mono.

**Layout:**
- Container max 1200 px.
- 12-column grid at ≥1024 px, 8 columns at 768–1023 px, 4 columns below.
- Gutters 16 px (phone), 24 px (tablet and desktop).
- Booking pages use a 7/5 split: content and sticky quote panel.

### 7.3 Stripe Appearance mapping (Payment Element)

From the Appearance API [S4]:
- Themes are `stripe`, `night` and `flat`.
- `colorPrimary`, `colorBackground`, `colorText`, `colorSuccess`, `colorDanger` and `colorWarning` "don't support `rgba()` or the `var(--myVariable)` syntax". So the app resolves tokens to hex at runtime.
- "Make sure that you choose a font size of at least 16px for input fields on mobile."

```ts
const appearance = {
  theme: isDark ? 'night' : 'stripe',
  variables: {
    colorPrimary: isDark ? '#A29CEF' : '#4A3FC8',
    colorBackground: isDark ? '#1E1B26' : '#FFFFFF',
    colorText: isDark ? '#F5F3EF' : '#1C1915',
    colorDanger: isDark ? '#FDA29B' : '#B42318',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSizeBase: '16px',
    spacingUnit: '4px',
    borderRadius: '10px',
    focusBoxShadow: '0 0 0 3px #5B50DA',
  },
};
// Elements `fonts: [{ cssSrc: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap' }]`
```

**Connect embedded components:**
- Use `appearance.variables` (`colorPrimary`, `fontFamily`) and `overlays: 'dialog'` in `loadConnectAndInitialize`.
- Their "font family and background color … are inherited from the parent HTML container", so the container sits on `surface` [S8].
- Custom fonts are passed via `fonts` (`cssSrc`) [S8].

### 7.4 Components

Each component lists its key variants and states, and its accessibility contract.

| Component | Variants / states | A11y contract |
|---|---|---|
| `Button` | primary, secondary, ghost, danger, link; sm (36 px) / md (44 px, default on touch) / lg; loading (spinner + label kept), disabled with reason | `<button>`; `aria-busy` while loading; never icon-only without `aria-label` |
| `AppHeader` / `BottomTabBar` / `Drawer` | per role (§1.2); badges | `<nav aria-label>`; current page `aria-current="page"`; badge text in `sr-only` ("3 tasks need action") |
| `Stepper` | 4 steps; complete / current / upcoming | `<ol>`; current `aria-current="step"` |
| `CategoryTile`, `ProjectCard`, `TaskChip` | default / hover / focus / coming soon | Whole card is one link; heading inside |
| `TaskerCard` | list / compact / skeleton; badges | `<article>` with a heading; rating read as "4.9 out of 5, 127 reviews" |
| `RatingStars` | display / input | Display: `role="img"` + label. Input: radio group of 5, arrow keys |
| `FilterRail` / `FilterSheet` / `Chip` | selected / removable | Chips are toggle buttons with `aria-pressed`; the sheet is a modal dialog |
| `DayStrip` / `SlotGrid` | available / selected / taken / unavailable | Radio groups with roving tabindex; arrows move, Home/End jump; taken slots are announced as "9:00 AM, booked" |
| `AddressField`, `Combobox` | suggestions, empty, error | WAI-ARIA combobox pattern |
| `QuotePanel`, `MoneyRow`, `TenderBreakdown`, `Receipt` | loading skeleton, mismatch warning | Totals in a `<dl>`; a polite live region announces the new card amount after a quote update ("Hold now $83.50") |
| `HoldChip` | held / scheduled / captured / released / expired | Text, not colour, carries meaning; popover is a disclosure button |
| `PaymentSection` | saved list / Element / simulated / error | Fieldset with legend "Payment"; Stripe iframes sit inside a labelled region |
| `SimulatedBadge` | inline / banner | Text "Simulated" (never icon-only); a striped background is decoration only |
| `CountdownChip` | normal / urgent (<1 h) / expired | Text updates each minute, **not** live-announced; the deadline's absolute time is in the accessible name |
| `StatusChip` | the tones in §3 | Text label always present |
| `StatusTimeline` | linear / branched (cancel) | `<ol>` with each step's state in text |
| `Dialog` / `Sheet` | centred dialog ≥768 px; bottom sheet below | `role="dialog" aria-modal="true"`, labelled by the title; focus moves in, Tab is trapped, Esc closes, focus returns to the trigger; background is inert and scroll-locked |
| `Toast` | success / info / error | `role="status"` (error: `alert`); pausable; dismiss button ≥ 24 px |
| `Banner` | info / success / warning / error / simulated | Error `role="alert"` |
| `Tabs` | URL-synced | WAI-ARIA tabs (fixes console tabs) |
| `DataTable` → `ListRows` | table ≥768 px, stacked rows below | Rows are links or buttons, never `<tr onClick>` |
| `EmptyState`, `Skeleton`, `Avatar` (photo or initials on `dusk-100`) | — | Skeletons are `aria-hidden`; the container is `aria-busy` |
| `CardConsent` | required checkbox + linked terms | Error tied via `aria-describedby` |

---

## 8. Phone behaviour

Breakpoints are Tailwind's defaults: `sm` 640, `md` 768, `lg` 1024, `xl` 1280. Designs are made at 390 px and 1280 px.

| Area | Behaviour |
|---|---|
| Header | 56 px, one row: logo, a page title on inner pages, notifications. Navigation moves to the **bottom tab bar** (64 px + `env(safe-area-inset-bottom)`). This fixes the ~225 px wrapping header |
| Wizard | Full-width steps; the step header shows "Step 2 of 4"; **sticky bottom CTA bar** with the primary action and, on W4, the hold amount; the breakdown opens as a sheet above the bar |
| Filters | **Filters (2)** button → full-screen sheet with Apply / Clear; active filters as a horizontally scrollable chip row (scroll is inside the row only, never the page) |
| Tasker cards | Single column; the photo sits left at 56 px; the CTA is full width |
| Day strip / slots | Day strip scrolls horizontally inside its own region (focusable, labelled); slots in a 3-column grid of 44 px buttons |
| Dialogs | Bottom sheets with a drag handle and a close button (≥44 px); max height 90 vh; inner scroll |
| Tables | Become stacked list rows below `md` (tasker history, points lots, console lists, ledger) |
| Stat tiles | 2-up grid on phone (not 1-up) |
| Console | List → detail stack with a back button; every grid child gets `min-w-0`; long IDs use `overflow-wrap:anywhere`. Target `scrollWidth == 390` |
| Inputs | ≥16 px font (prevents iOS zoom; Stripe recommends the same for the Payment Element [S4]); `inputmode` set for money (`decimal`) and ZIP (`numeric`); `autocomplete` attributes on name, email, address |
| Tap targets | ≥44×44 px for primary controls, ≥24×24 px minimum for everything (WCAG 2.5.8); inline links get vertical padding |
| Performance | Route-level code splitting (today one 488 kB chunk). Stripe.js loads via the async loader in Stripe mode only. Image avatars are lazy with explicit size |
| Offline / poor network | Money actions are never queued offline; show "You're offline. Reconnect to book." |

---

## 9. Accessibility

The target is **WCAG 2.2 AA**. The CI gate is axe-core in Playwright on every route at 390 and 1280, light and dark. Frontend.md found these failures to fix: `color-contrast` (26 states), `select-name` (critical) and `scrollable-region-focusable`.

1. **Structure.**
   - A skip link to `#main`.
   - One `h1` per page.
   - Landmarks: `header`, `nav` (labelled), `main`, `aside` (quote panel), `footer`.
2. **Route changes.** Update `document.title`, move focus to the `h1` (`tabIndex=-1`), and announce through a polite live region ("My tasks, page loaded").
3. **Forms.**
   - Every control has a visible label: the points input and the category/status selects (axe fix).
   - Errors are linked with `aria-describedby` and summarised at the top on submit, with links to fields.
   - Disabled submit buttons always come with the visible `RequirementsList`.
4. **Dialogs and sheets.** Focus is trapped and returned, Esc closes, the background is inert, and the close button is ≥24 px. This fixes the 12-Tab escape found in `kbd.spec.ts`.
5. **Keyboard.**
   - Slot grid, day strip, stars and tabs use roving tabindex with arrow keys.
   - Console rows are focusable links.
   - Visible focus ring everywhere: 3 px `--color-focus`, offset 2 px. Today links have `outline: none`.
6. **Colour.**
   - Every text and border pair in §7.2 meets AA.
   - Status never relies on colour alone: chips always carry text, and the dispute row has an icon plus text.
   - Stars always have the numeric rating next to them.
7. **Money for screen readers.**
   - Amounts are read as currency ("$83.50").
   - The minus sign (`−`) gets an `aria-label` of "minus" inside `MoneyRow`.
   - Hold chips read "Hold of $83.50, releases by November 9".
8. **Timers.** Countdowns don't announce every tick. The absolute deadline is in text. TaskNest sets no session timeouts during checkout.
9. **Motion.** `prefers-reduced-motion` turns off sheet slide and skeleton shimmer.
10. **Third-party frames.**
    - The Payment Element and Connect components are Stripe iframes inside our labelled region.
    - Our own error summary repeats the Element's error text, so it is reachable outside the iframe.
    - The Connect authentication popup is announced before it opens ("A Stripe window will open to verify you").
11. **Language and dates.** `lang="en-US"`. Times always include the zone abbreviation when it differs from the viewer's ("9:00 AM PT"). This fixes the mixed-zone tables.

---
## 10. Backend: existing vs new endpoints

**Legend.** ✓ used as-is · ◐ existing, needs an extension · ★ new.

Money writes stay in the `api` Edge Function (service role, Idempotency-Key, `tn_apply`, balanced ledger). Non-money tables (addresses, messages, availability, support requests) can be written directly under RLS, or through `api` for validation; the choice is noted per row.

### 10.1 Existing endpoints and reads (keep)

| Endpoint / read | Screens | Change |
|---|---|---|
| ✓ `GET /health` | staff header, S8 | none |
| ◐ `POST /quote` | W2 estimates, W4 | Add `paymentPlan: {mode:'hold_now'|'save_card_hold_later', holdAt?, amountCents}` and `responseDeadline` preview. Optional batch variant ★ `POST /quote/estimate {taskerIds[], minutes}` for result cards |
| ◐ `POST /bookings` | W4 | Accept `confirmationTokenId` / `paymentMethodId` / `simulatedToken`, `saveConsent` (+ consent text version), later `addressId`. Return `payment: {status, clientSecret?}`. Drop the silent `pm_card_visa` fallback (stripe.md #2) |
| ✓ `accept` / ✓ `decline` / ✓ `start` | K1, K2, S2 (admin decline) | Decline is newly exposed to admins in the UI |
| ◐ `reschedule` | C2, K2 | Validate against availability (`409 tasker_unavailable_at_time`); re-check the hold plan |
| ✓ `GET cancel-preview` | C2 cancel sheet | Now actually used by the UI |
| ✓ `cancel` | C2, K2 | none |
| ✓ `no-show` | K2 (client didn't show), S2 (tasker no-show) | Newly exposed in the UI |
| ◐ `complete` | K2 | Response adds `payment.status` for the extras charge (may be `action_required`) |
| ◐ `tip` | C2 | Accept `paymentMethodId`; may return `requires_action` + `clientSecret` |
| ✓ `refund-preview`, ✓ `refund` | C2 (202 request), S2 | Refunds gain a status (★ columns) |
| ✓ `review` | C2 | none |
| ✓ `POST /payouts/run` (+`taskerId`) | S6, S4 | Per-tasker error isolation (backend F6) |
| ◐ `POST /admin/taskers/:id/status` | S4 | UI adds `pending` |
| ✓ `POST /admin/policies` | S7 | Newly exposed |
| ◐ `POST /admin/disputes/simulate` | S2, S9 | Add inquiry statuses; the UI adds `open` |
| ✓ `/admin/points/grant`, `/admin/test-clock` | S9 | Newly exposed in Test tools |
| ✓ RLS reads | everywhere | `taskers`, `display_names`, `bookings` (+ tenders, refunds, tips, disputes), `points_*`, `payouts`, `tasker_strikes`, `tasker_balances`, `ledger_*`, `money_policies`, staff views |

### 10.2 New: discovery and booking

| ★ Endpoint / object | Purpose | Notes |
|---|---|---|
| `categories` table + `category_summary` view (anon read) | Home, Services, W1 | slug, name, icon, sort; `from_rate_cents` = min active rate (a read, not UI math) |
| `tasker_public_stats` view (anon read) | Cards, profile | avg rating (×100 integer), review count, completed count. Fixes the confirmed ratings bug |
| `public_reviews` view (anon read) | Profile | tasker_id, rating, body, created_at, reviewer first name, category. No client id |
| `GET /taskers/:id/availability?from&days&minutes` | W3, reschedule | Free slots = availability rules − overrides − active bookings (service role; never exposes other clients' ids) |
| `GET /taskers/availability?category&date&timeOfDay&minutes` | W2 | First free slot per tasker (batch) |
| `addresses` table (own rows, RLS write) + `bookings.address_id`, `bookings.category` | W1, C6, K2 | Address revealed to the tasker after accept (view or RLS rule) |
| `notifications` table + Realtime | badges, C3 | Kinds: request_received, accepted, payment_action_required, refund_status, payout_failed, message |
| `messages` table + Realtime (parties + staff) | C4, K2 | Insert via RLS (non-money) |
| `POST /bookings/:id/report-no-show` (client) | C2 | Creates a support request. Whether it auto-refunds is a money rule (§13 D7) |
| `reschedule_requests` + `POST /bookings/:id/reschedule-requests`, `POST /reschedule-requests/:id/{accept,decline}` | C2, K2 | Only if §13 D4 is adopted |
| Auto-decline job (cron) | K1, C1 | Known gap in BACKEND_NOTES; makes "Expired" real |

### 10.3 New: payments (client)

| ★ Endpoint / object | Purpose | Stripe mode | Fake mode |
|---|---|---|---|
| `GET /payments/config` | 5.0 | `{provider:'stripe', publishableKey}` | `{provider:'fake', simulated:true}` |
| `POST /payments/customer-session` | W4, C6 | Creates the Customer if missing (`profiles.stripe_customer_id`), then a CustomerSession [S1] | Simulated saved cards |
| `GET /payments/methods`, `DELETE /payments/methods/:id` | C6 | Lists and detaches the customer's cards; refuses while one backs an upcoming hold | Simulated |
| `POST /payments/setup-intent` (+ confirm) | C6 add card, `save_card_hold_later` | SetupIntent `usage=off_session` confirmed with a ConfirmationToken | Simulated |
| `POST /bookings/:id/payment/confirm` | W4 after 3DS | Re-reads the PI; `requires_capture` → booking `requested` + ledger hold | Same, from the scenario |
| `POST /bookings/:id/payment/retry` | C3 | Returns the declined PI's client secret for `confirmPayment` [S5], or takes a new `paymentMethodId` | Simulated |
| `bookings.payment_state`, `capture_before`, `hold_at`, `stripe_charge_id`, `payment_method_id` | §3, §5.2 | From the PI / charge / webhooks | From the fake provider |
| `card_consents` (user, text version, timestamp, booking) | W4 | Record of consent [S3] | Same |
| Hold-placement job (cron) | §2.2 | Places the off-session hold before start; on `authentication_required` → `action_required` + notification [S5] | Simulated by the test clock |
| Refund status columns (`refunds.provider_status`, ids) | C2, S2 | `refund.*` webhooks | Simulated events |

### 10.4 New: tasker and Connect

| ★ Endpoint / object | Purpose | Notes |
|---|---|---|
| `POST /taskers/apply` | K7 | Creates a `taskers` row `pending` (category, rate within bounds, headline) |
| `POST /tasker/profile` + profile columns (bio, avatar_url, skills, flags) | K6 | Rate change affects new bookings only (bookings already snapshot `rate_cents`) |
| `tasker_availability`, `tasker_availability_overrides` + `PUT /tasker/availability` | K3 | Enforced by `POST /bookings` and `reschedule` |
| `GET /tasker/payout-account` | K5, K1, S4 | `{state, requirementsDue[], transfersActive, bankLast4?, disabledReason?}` |
| `POST /tasker/account-session` | K5, K1, K4 | Account Session with the needed components [S6][S8][S11]; fake → simulated session |
| `POST /sim/connect/onboarding` (fake only) | K5 simulated | Accepts only Stripe's documented test values [S12] |
| `tasker_statement` view (own rows) | K4, K1 tiles | Per-booking earnings from own `tasker_payable` lines |
| `transfers` (rename of `payouts`, real `pending/paid/failed`) + `connected_payouts` (`payout.*`) | K4, S6 | Transfer vs bank payout statuses [S9] |
| Connect webhook destination (`account.updated`, `payout.*`) | K5, K4 | stripe.md §2.9 |

### 10.5 New: support and staff

| ★ Endpoint / object | Purpose |
|---|---|
| `support_requests` (+ replies) and `POST /support/requests`, `POST /support/requests/:id/{assign,reply,resolve}` | P5, C7, S1. Backfill client refund requests (today only in `audit_log`) |
| `disputes` status widened to Stripe's 10 values (backend F2) | S3 |
| `stripe_events.payload` + `POST /admin/stripe-events/:id/replay` | S8 |
| `POST /admin/sim/events {type, bookingId|taskerId, scenario}` (fake only) | S9 |
| `Idempotency-Key` **required** on every ✓-marked route (backend F5) | All money actions; the UI always sends one already |

### 10.6 UI-only work (no backend change)

- Use `GET cancel-preview` in the cancel sheet.
- Expose no-show, admin decline, `pending` status, policy publish, per-tasker payout, and dispute `open`.
- Compute tasker earnings and the console Total from ledger / `bookingFigures()` instead of ad-hoc sums.
- Route titles, the 404 page, focus management, axe fixes, phone layout.
- The provider badge from `/health`.
- `/pricing` opening in a side sheet inside the wizard.

### 10.7 Money-rule changes this proposal does *not* make

These are policy items. Each needs a domain change, unit tests, `/pricing`, and a new `money_policies` version, and is never applied retroactively:
- billing minimum and increments
- the 5-minute free-cancel grace
- itemised expenses with a per-item cap
- the review window
- the booking horizon (`maxAdvanceDays`)
- an `invoiced` state before capture

The UI is built so that it renders whatever the policy says (`taskrabbit.md` §8 P2).

---

## 11. `data-testid` migration

All existing ids are kept on their equivalent control, so `e2e/ui.spec.ts` keeps passing. Where a control moves, the id moves with it.

| Existing ids | New home |
|---|---|
| `signin-*`, `demo-accounts`, `demo-<name>`, `nav-signin`, `sign-out`, `current-user`, `main-nav`, `nav-*` (`nav-taskers` → Book, `nav-bookings` → Tasks, `nav-points` → Rewards, `nav-tasker`, `nav-console`, `nav-pricing`) | P7, `AppHeader`, and **duplicated** on `BottomTabBar` items at phone width. Only one of the two is rendered per breakpoint, so ids stay unique |
| `tasker-list`, `tasker-search`, `tasker-card-<first>`, `tasker-name`, `tasker-category`, `tasker-rate` | W2 results, P3 profile |
| `booking-start`, `booking-tz`, `booking-duration`, `booking-description` | W3 fallback input, W1 tz fallback, W1 size/custom hours, W1 description |
| `quote-panel`, `quote-tenders`, `quote-server-status`, `quote-mismatch`, `promo-input`, `promo-error`, `points-toggle`, `points-input`, `points-error`, `book-submit` | W4 |
| `booking-card`, `booking-total`, `booking-tenders`, `booking-dispute`, `cancel-*`, `reschedule-*`, `tip-*`, `review-*`, `refund-*` | C1 / C2 and its sheets (`review-rating` becomes a radio group, so the e2e step changes from `selectOption` to `check`; this is the only test edit) |
| `points-available`, `points-lots`, `points-history` | C5 |
| `job-card`, `accept`, `decline`, `start`, `complete-*`, `tasker-cancel-*`, `tasker-history`, `tasker-payouts`, `tasker-strikes-table` | K1, K2, K4 |
| `console-*`, `tab-<k>` (now link tabs), `tasker-activate`, `tasker-suspend`, `tasker-status-reason`, `dispute-won`, `dispute-lost`, `payout-run`, `payout-result`, `view-ledger`, `ledger-*` | S1–S6 |
| `pricing-*`, `curve-*`, `policy-version` | P4 |
| `page-error` | ErrorBoundary |

New tests to add with the redesign:
- the wizard happy path (fake)
- `hold_now` vs `save_card_hold_later` copy
- the simulated 3DS approve and fail
- a decline by test number
- the payment-approval recovery
- cancel using the server preview
- tasker earnings from the ledger
- Connect simulated onboarding success, and a failed payout account
- axe on every route at both widths
- keyboard dialog focus

Stripe test-mode runs stay behind `E2E_BACKEND=1`, using `pm_card_*` ids [S7].

---

## 12. Build order

| Phase | Scope | Unblocks |
|---|---|---|
| **1. Foundation** (UI only) | Tokens and themes, `AppHeader` / `BottomTabBar`, Dialog/Sheet, Tabs, Toast, Skeleton, route titles and focus, the 404 page, axe fixes, console phone layout, code splitting, the provider badge | Everything; fixes most of frontend P1/P2 |
| **2. Discovery** | Home, Services, wizard W1–W2 with existing data; ★ `tasker_public_stats`, `public_reviews`, `category_summary` | Ratings bug fixed; TaskRabbit-like browse |
| **3. Book with simulated payments** | W3 (fallback picker), W4 with `SimulatedCardForm`, consent, hold copy, W5, C1–C2 with the server cancel preview; ◐ `POST /bookings` scenario tokens; ★ `payment_state`, `/payments/config`, `/payment/confirm` | End-to-end booking in fake mode, labelled Simulated (owner decision) |
| **4. Tasker side** | K1 (Realtime), K2 incl. no-show, K4 from the ledger, K5 simulated onboarding, K6/K7; ★ apply/profile, `tasker_statement`, payout-account endpoints | Supply side works end to end |
| **5. Availability and support** | ★ availability (K3, W3 real slots), support requests (P5, C7, S1), report no-show, notifications | TaskRabbit-faithful scheduling and help |
| **6. Real Stripe test mode** | Payment Element + CustomerSession + ConfirmationToken + `handleNextAction`; C3 recovery; C6 payment methods; Connect embedded onboarding / banner / payouts; webhooks (stripe.md §7 order) | Switch on with `sk_test_` / `pk_test_` keys |
| **7. Chat and polish** | Messages, reschedule proposals (if D4), help articles, dark mode QA | — |

---

## 13. Open product decisions

| # | Decision | Recommendation |
|---|---|---|
| D1 | Browse before sign-in? TaskRabbit's web flow starts with log-in [T3] | Allow anonymous browse through W3; gate at W4. Drafts survive sign-up |
| D2 | Address and service area | Collect ZIP + street now. Add `bookings.address_id` and a tasker service-area radius in Phase 5. Until then, label results "Taskers serving your area" only when that's true |
| D3 | Card tender = $0 (points/promo cover all) | Still require a saved card (setup mode), because extras are charged off-session after the task |
| D4 | Reschedule inside 24 h needs the other party to agree (TaskRabbit [T11]) | Adopt with `reschedule_requests`; outside 24 h keep the single-party reschedule |
| D5 | Can a tasker start when the client's payment needs approval? | Yes for re-hold failures (the client is notified; capture retries at completion); show the tasker a neutral notice |
| D6 | One category per tasker vs several (TaskRabbit sets rates per category [B1]) | Keep one in Phase 4; plan `tasker_skills` with per-category rates later |
| D7 | Client-reported tasker no-show | Phase 5: creates a support request; staff run the existing admin no-show. An automatic full refund would be a money-rule change |
| D8 | Hosted vs embedded Connect onboarding | Embedded (keeps the tasker in TaskNest), with Account Links as the fallback |
| D9 | "Nest Pro" badge | Only with published rules (minimum tasks, rating) computed server-side; otherwise omit |

---

## 14. Sources

**Stripe** (all fetched on 2026-10-29 for this proposal):

| Ref | Page |
|---|---|
| [S1] | Finalize payments on the server (deferred intent, Elements options, ConfirmationToken, `handleNextAction`, CustomerSession features, `elements.update`): https://docs.stripe.com/payments/finalize-payments-on-the-server.md?platform=web&type=payment |
| [S2] | Place a hold on a payment method (validity windows, `capture_before`, expiry → `canceled`, partial capture releases the rest, issuer statements): https://docs.stripe.com/payments/place-a-hold-on-a-payment-method |
| [S3] | Save a payment method during payment (compliance, consent, off-session params, `setup_future_usage` vs `payment_method_save_usage`): https://docs.stripe.com/payments/save-during-payment.md?payment-ui=elements |
| [S4] | Elements Appearance API (themes, variables, no `var()`/`rgba()` for colour variables, ≥16 px inputs on mobile): https://docs.stripe.com/elements/appearance-api.md?api-integration=paymentintents |
| [S5] | Save and reuse (notify the customer, `authentication_required` → `confirmPayment` with the declined PI's client secret): https://docs.stripe.com/payments/save-and-reuse.md?payment-ui=elements |
| [S6] | Embedded onboarding (Account Session `account_onboarding`, `setOnExit`, requirements remediation): https://docs.stripe.com/connect/embedded-onboarding |
| [S7] | Testing (test cards, `pm_card_*` ids, expiry/CVC rules, dispute cards): https://docs.stripe.com/testing |
| [S8] | Get started with Connect embedded components, web (`loadConnectAndInitialize`, `fetchClientSecret`, appearance, fonts, popups, COOP, CSP): https://docs.stripe.com/connect/get-started-connect-embedded-components.md?platform=web |
| [S9] | Manage connected account payouts (statuses, failed payout disables external account, `payout.*` events, v1-only events): https://docs.stripe.com/connect/payouts-connected-accounts |
| [S10] | Supported Connect embedded components, web (account management, onboarding, notification banner, payouts, payouts list, balances): https://docs.stripe.com/connect/supported-embedded-components.md?platform=web |
| [S11] | Notification banner (when it renders, `onNotificationsChange`, needs `details_submitted`): https://docs.stripe.com/connect/supported-embedded-components/notification-banner |
| [S12] | Connect testing (sandbox onboarding values, test bank accounts and payout failures): https://docs.stripe.com/connect/testing |
| [S13] | Supported currencies (0.50 USD minimum charge): https://docs.stripe.com/currencies |
| [S14] | Including Stripe.js (load from js.stripe.com, every page, npm loader is async): https://docs.stripe.com/js/including |

Backend-side Stripe facts referenced as "stripe.md §x" were fetched today by the Stripe reader and are cited with URLs in `stripe.md` §9. They cover the API version `2026-10-28.endive`, the Endive changes, separate charges and transfers, Accounts v2, webhooks, refunds and disputes.

**TaskRabbit** (patterns only; nothing copied):

| Ref | Page | Fetched |
|---|---|---|
| [T1] | Home page structure: category tabs with quick links, popular projects with starting prices, stats, testimonials, trust block, 3-step how-it-works, footer by city. https://www.taskrabbit.com/ | Re-fetched for this proposal |
| [T3] | How do I hire a Tasker: web/app steps, 14-day window, "scheduled" when the tasker confirms. https://support.taskrabbit.com/hc/en-us/articles/210861763-How-Do-I-Hire-a-Tasker | Re-fetched for this proposal |
| [T4] | What tasker cards and profiles show. https://support.taskrabbit.com/hc/articles/360050012971 | Via `taskrabbit.md` (H2) |
| [T6] | How do I pay my Tasker (on-platform only). https://support.taskrabbit.com/hc/en-us/articles/204411560-How-Do-I-Pay-My-Tasker | Via `taskrabbit.md` (H4) |
| [T7] | Tipping (after the review, 100 % to the tasker). https://support.taskrabbit.com/hc/en-us/articles/216901546-Tipping-Taskers | Via `taskrabbit.md` (H7) |
| [T11] | Reschedule policy (mutual within 24 h). https://support.taskrabbit.com/hc/en-us/articles/46260435128091-Schedule-Availability-Reschedule-Policy | Via `taskrabbit.md` (H11) |
| [T12] | Chat as the task's record. https://support.taskrabbit.com/hc/en-ca/articles/46260518656667-Why-Should-I-Use-the-Chat-Thread | Via `taskrabbit.md` (H16) |
| [T13] | Tasker cancelled → find another tasker. https://support.taskrabbit.com/hc/en-us/articles/360036115891 | Via `taskrabbit.md` (H13) |
| [T14] | Tasker late / no-show. https://support.taskrabbit.com/hc/en-us/articles/204239574 | Via `taskrabbit.md` (H14) |
| [T20] | Invoice incorrect → support. https://support.taskrabbit.com/hc/en-us/articles/17962682219149-My-Invoice-Is-Incorrect-What-Should-I-Do | Via `taskrabbit.md` (H20) |
| [T25] | Help centre structure. https://support.taskrabbit.com/hc/en-us | Via `taskrabbit.md` (H25) |
| [B1] | Pricing and tasker earnings (rate per category). https://www.taskrabbit.com/blog/how-pricing-works-on-taskrabbit-and-what-it-means-for-your-earnings/ | Via `taskrabbit.md` |
| [B2] | Tasker calendar up to 17 days. https://www.taskrabbit.com/blog/?p=16444 | Via `taskrabbit.md` |
| [B3] | Invitation countdown timers. https://www.taskrabbit.com/blog/turn-every-invite-into-income-start-with-these-4-tips/ | Via `taskrabbit.md` |

**Repo evidence:** `README.md`, `docs/SPEC.md`, `docs/API.md`, `.coderabbit.yaml`, `src/App.tsx`, `src/lib/{api,data,preview}.ts`, `supabase/functions/_shared/domain/config.ts`, the existing `data-testid` inventory (grep of `src/`), and the five reader reports in this folder.

**Contrast ratios** in §7.2 were computed with `tools/contrast.py` in this folder (WCAG 2.x relative-luminance formula).
