# TaskRabbit UX research, mapped to TaskNest

Researched 2026-10-29 from TaskRabbit's public site and help center. Every TaskRabbit claim below is paraphrased and cites its page. The mapping is against `helix-fintech-apps/tasknest` as cloned at `/home/user/tasknest`: `docs/API.md`, `docs/SPEC.md`, `docs/BACKEND_NOTES.md`, `supabase/migrations/*`, `supabase/functions/_shared/domain/config.ts` and `src/`.

**Don't copy.** Borrow interaction patterns only. TaskNest keeps its own name, logo, colours, illustrations and wording. All microcopy notes below describe what a message does; none of it is TaskRabbit's text to reuse. Don't reuse TaskRabbit's program names (its protection program, "Elite" tier, fee names) either. Suggested TaskNest names are given where useful.

**Status legend (backend):** **S** = supported by today's API/schema · **P** = partly supported · **M** = missing.

---

## 0. Sources and caveats

| # | Page | Used for |
|---|------|----------|
| T1 | https://www.taskrabbit.com/ | Home page structure, categories, "from $X" project cards, 3-step pitch, trust strip |
| T2 | https://www.taskrabbit.com/how-it-works | Client steps, pay-after-completion, free changes with 24 h notice |
| H1 | https://support.taskrabbit.com/hc/en-us/articles/210861763 | Booking flow (app + web), filters, 14-day window, "scheduled" means the tasker confirmed |
| H2 | https://support.taskrabbit.com/hc/articles/360050012971 | What tasker cards and profiles show |
| H3 | https://support.taskrabbit.com/hc/en-us/articles/360050015351-Can-I-book-a-Same-Day-Task | Same-day via the date filter |
| H4 | https://support.taskrabbit.com/hc/en-us/articles/204411560-How-Do-I-Pay-My-Tasker | Charge within 24 h of invoice, hours + expenses, on-platform only |
| H5 | https://support.taskrabbit.com/hc/en-us/articles/46260462243611-Why-Was-I-Charged-Right-After-Booking | One-hour deposit at booking (web, General Marketplace), settled against the invoice |
| H6 | https://support.taskrabbit.com/hc/en-us/articles/204411570-How-Do-I-Reimburse-My-Tasker-For-Expenses | Expenses: receipt photo in chat, $100 cap per expense |
| H7 | https://support.taskrabbit.com/hc/en-us/articles/216901546-Tipping-Taskers | Tip after review, 24 h window, 100% to tasker, separate statement line |
| H8 | https://support.taskrabbit.com/hc/articles/34731404108813 | Tipping policy: cap 25% of task total |
| H9 | https://support.taskrabbit.com/hc/articles/213301766 | Reviews: 1–5 stars, public text, within 30 days, one per task |
| H10 | https://support.taskrabbit.com/hc/articles/360035010972 | Client cancellation policy and tasker compensation |
| H11 | https://support.taskrabbit.com/hc/en-us/articles/46260435128091-Schedule-Availability-Reschedule-Policy | Reschedule rules (mutual within 24 h, no fee dodging) |
| H12 | https://support.taskrabbit.com/hc/articles/204411530 | How to reschedule (chat first, then Task Info) |
| H13 | https://support.taskrabbit.com/hc/en-us/articles/360036115891 | Tasker canceled: "find another tasker" rebook |
| H14 | https://support.taskrabbit.com/hc/en-us/articles/204239574 | Tasker late / no-show handling |
| H15 | https://support.taskrabbit.com/hc/en-us/articles/204409290 | Chat and masked calling |
| H16 | https://support.taskrabbit.com/hc/en-ca/articles/46260518656667-Why-Should-I-Use-the-Chat-Thread | Chat as the task's record |
| H17 | https://support.taskrabbit.com/hc/articles/204940570 | Trust & Support fee (client-side, % of hourly rate) |
| H18 | https://support.taskrabbit.com/hc/en-us/articles/35682300983181-Tasker-Rates-Minimum-Hours-Policy | 1 h minimum, optional 2 h minimum, 15-minute increments |
| H19 | https://support.taskrabbit.com/hc/en-us/articles/34799128396301 | Invoicing policy (24 h to invoice, cancel if no work) |
| H20 | https://support.taskrabbit.com/hc/en-us/articles/17962682219149-My-Invoice-Is-Incorrect-What-Should-I-Do | Client invoice dispute goes to support |
| H21 | https://support.taskrabbit.com/hc/en-us/articles/207813543-Overview-of-Trust-and-Safety | Screening, protection program, reporting channels |
| H22 | https://support.taskrabbit.com/hc/en-us/articles/115005156463-Identity-Verification-Process | ID verification through third parties |
| H23 | https://support.taskrabbit.com/hc/en-us/articles/360035570011 | Older "Happiness Pledge" article (cap stated differently, see caveat) |
| H24 | https://support.taskrabbit.com/hc/en-us/articles/360032937071-Setting-Up-Your-Direct-Deposit | Tasker payouts: checking account only |
| H25 | https://support.taskrabbit.com/hc/en-us | Help center structure |
| B1 | https://www.taskrabbit.com/blog/how-pricing-works-on-taskrabbit-and-what-it-means-for-your-earnings/ | Tasker sets rate per category, keeps 100% of rate and tips, payouts through Stripe in 1–3 business days |
| B2 | https://www.taskrabbit.com/blog/?p=16444 | Tasker calendar up to 17 days ahead, 2.5 h minimum blocks, scheduling blocks the calendar (2023 post) |
| B3 | https://www.taskrabbit.com/blog/turn-every-invite-into-income-start-with-these-4-tips/ | Invitation countdown timers, a missed window loses the task (2026 post) |

Caveats:
- **Protection cap is inconsistent across pages.** The US home page (T1) shows the current program with coverage up to $1,000. The older Happiness Pledge article (H23) says up to $10,000. Treat the amount as unknown. TaskNest doesn't need it anyway.
- **Sort options** (recommended, price, reviews, tasks done) come from a third-party review, not from TaskRabbit. H1 only confirms date, time and price-range filters in the app. Treat the sort list as a sensible default, not a sourced fact.
- **Response windows** (1 h for same-day, otherwise end of day) appear only in a search snippet of a TaskRabbit blog table that I couldn't read as text (B2 shows it as an image). Not used as fact.
- The **US service fee percentage** isn't published on the pages I read (H17 only says it's a percentage of the hourly rate per hour worked).

---

## 1. Client journey

### 1.1 Entry: pick a category

**TaskRabbit pattern** (T1, T2, H1)
- The home page opens with a value line and a row of one-tap popular tasks. Category tabs are Assembly, Mounting, Moving, Cleaning, Outdoor Help, Home Repairs, Painting and Trending (T1).
- "Popular projects" cards each show a **starting price** (for example "from $49") (T1).
- A three-step explainer covers choosing a tasker, scheduling, then chat, pay, tip and review in one place (T1).
- A trust strip covers the protection program, background checks and support (T1).
- On the web, the booking flow begins after login with a category pick (H1).

**Screens/components:** hero with search, category tab bar, project cards with a "from" price, 3-step explainer, trust strip, city/service footer links.
**Microcopy pattern:** short verb-led task names ("Mount a TV" style). Price is shown as a floor ("from"), never a quote. Trust claims are short with a link to the policy.

**TaskNest today:** `/taskers` has a free-text search and a category `<select>` built from the categories of active taskers (`src/pages/Taskers.tsx`). There is no landing page. `/signin` is the entry for logged-out users.

| Need | Backend | Notes |
|---|---|---|
| Category list | **P** | `taskers.category` is free text, one per tasker. There is no `categories` table, no icons or descriptions, and no per-category "from" price. A "from" price can be computed client-side as `min(hourly_rate_cents)` over active taskers in the category; the RLS read is allowed (`taskers` is public for active rows). |
| Public landing (logged out) | **P** | `taskers`, `reviews` and `money_policies` are anon-readable (API.md "Reading data"). Booking needs auth. |
| Search box | **S** (client-side) | Filter over `listTaskers()`. |

### 1.2 Describe the task: size, details, location

**TaskRabbit pattern** (H1, T2)
- The app asks for the **task address** first, and some tasks need a start and an end address. Then "Continue" or "See Taskers & Prices" (H1).
- Free-text details come *after* picking a tasker and time: supplies, parking, time or budget limits (H1).
- Cleaning tasks can set a recurring frequency at review (H1).

**Screens/components:** address field with autocomplete, optional second address (moving), task-size selector (small/medium/large style), details textarea with prompts, recurring toggle (cleaning).
**Microcopy pattern:** short helper hints under the textarea saying what to include (access, parking, tools). The address is explained as needed to find nearby taskers.

**TaskNest mapping**

| Need | Backend | Notes |
|---|---|---|
| Free-text description | **S** | `POST /bookings {description}` → `bookings.description`. |
| Duration / "task size" | **S** | `minutes` (any positive integer) drives `quote()`. A UI size picker can map to minutes (for example small 60 / medium 120 / large 240). |
| Time zone | **S** | `tz` and `localStart` are converted with DST handled. |
| Address / location | **M** | No address, zip or geo columns on `bookings` or `taskers`. Only `location_tz`. There is no service-area concept, so "taskers near you" can't be filtered on the server. |
| Two addresses (moving) | **M** | |
| Recurring tasks | **M** | One booking = one slot. |
| Task photos | **M** | No storage bucket or attachments table. |

### 1.3 Browse taskers: filter and sort

**TaskRabbit pattern** (H1, H2, H3, T2)
- A list of taskers with their hourly rates (T2). Filters for date, time of day and price range (H1).
- Same-day is just the date filter set to today, and depends on availability (H3).
- Each card shows: an "elite" badge if earned, the star rating out of 5, **how many tasks done in this category**, past-job photos, and notes on skills, tools, vehicles and hourly minimums (H2).
- The guidance is to decide what matters (rating vs price) and open profiles before choosing (H2).

**Screens/components:** left filter rail on web (date chips: today / within 3 days / within a week / pick date; time-of-day buckets; price slider), sort dropdown, tasker cards (photo, name, badge, rate/h, rating, review count, category task count, short "how I can help" pitch, a top review snippet, primary "Select & Continue" action), a "view profile" link.
**Microcopy pattern:** each card has a short first-person pitch from the tasker. Counts are scoped to the category ("N tasks in this category"). Hourly minimums are shown on the card, so there are no surprises later.

**TaskNest mapping**

| Need | Backend | Notes |
|---|---|---|
| List active taskers | **S** | `taskers` (public under RLS) + `display_names`. |
| Filter by category / price | **S** (client-side) | `hourly_rate_cents` is on the row. |
| Rating + review count | **P (confirmed gap)** | `reviews` is public (RLS `reviews: public`), but it has no `tasker_id`. `taskerReviews()` in `src/lib/data.ts` first selects the tasker's completed `bookings`, and RLS limits those to the caller's own bookings. So a client sees only *their own* reviews of a tasker, and anon users see none. `getTasker()` hard-codes `rating: null, reviews: 0`. Fix: a public `tasker_rating_summary` view (tasker_id, avg, count) plus a public reviews view exposing `tasker_id`, rating, body, created_at and no client id. |
| Tasks completed (in category) | **M/P** | Not exposed publicly. Needs a view like `tasker_stats (tasker_id, completed_count)`. TaskNest taskers have a single category, so "in category" equals the total for now. |
| Filter by date/time availability | **M** | No availability calendar. The only conflict check is overlap with active bookings (`tn_apply` slot check with `tstzrange`, migration `…05_api_backend`). |
| Sort by recommended | **M** | No ranking signal. Default to rating × count, or keep it simple: rating then price. |
| Photo / pitch / skills / tools / vehicle | **P** | `taskers.headline` exists. No avatar, bio, skills list, tools/vehicle flags or portfolio photos. |
| Badge (top-tier tasker) | **M** | Name it something TaskNest-specific, for example "Nest Pro". Needs rules (min tasks, min rating) and a computed flag. |
| Hourly minimum shown on card | **M** | Domain bills per minute (`laborCents(rate, minutes)` rounds half-up, `domain/pricing.ts`). No minimum or increment rule (see §1.9). |

### 1.4 Tasker profile

**TaskRabbit pattern** (H1, H2): the profile shows skills, experience, hourly rate and **category-specific** reviews (H1), plus photos and details on tools, vehicles and minimums (H2).

**Screens/components:** header (photo, name, badge, rate, rating, tasks done), "About me" / "Skills & experience", photo gallery, reviews list (stars, first name, date, task type, text), sticky "Select & Continue" panel.

**TaskNest today:** `/taskers/:id` (`src/pages/TaskerProfile.tsx`) shows name, category, rate, and a booking form with date/time, tz, duration, promo, points and description, plus a live quote panel (subtotal, service fee, tax, promo, points, card) and a server-vs-preview mismatch warning. TaskNest's quote transparency **already goes further than TaskRabbit's**, which shows rate up front and fees on the receipt (H17). Keep it.

| Need | Backend | Notes |
|---|---|---|
| Name, rate, category, headline | **S** | |
| Reviews list | **P** | See the rating readability note in §1.3. Reviewer name = first name via `display_names` (only visible to the other party of a shared booking, so public reviews may need an anonymised "Verified client" label or a reviewer-first-name column on a public view). |
| Bio, gallery, skills | **M** | |

### 1.5 Pick date and time

**TaskRabbit pattern** (H1, B2)
- Pick a day and time from the tasker's calendar, at most **14 days ahead** (H1).
- Taskers publish availability up to 17 days out, in blocks of at least 2.5 h so they appear in search (B2).
- Booking a slot blocks the estimated time on the tasker's calendar (B2).

**Screens/components:** horizontal day picker (next 14 days), time-slot grid with unavailable slots greyed out, a selected-slot summary, "Select & Continue".
**Microcopy pattern:** one line explaining that times come from the tasker's calendar, and a note that the tasker confirms in chat.

| Need | Backend | Notes |
|---|---|---|
| Book a specific local start | **S** | `localStart` + `tz`. Rejects impossible dates and the past (`422`). |
| Prevent double booking | **S** | `409 slot_taken` (overlap check under a per-tasker lock). |
| Show free/busy slots | **P/M** | A client can't read other clients' bookings (RLS), so busy times are invisible. Needs a `tasker_busy` view (start/end only, no ids) or a `GET /taskers/:id/availability` endpoint. |
| Tasker-defined availability | **M** | No `tasker_availability` table. |
| Max advance window (14 days) | **M** | Not in `MoneyPolicy.booking`. Add `booking.maxAdvanceDays` if TaskNest wants it. |

### 1.6 Review and confirm, then chat

**TaskRabbit pattern** (H1, H15, H16)
- A "Review task" step lets the client change the payment method, add a promo code or set recurrence, then "Confirm and chat" (H1).
- **A task only counts as scheduled once the tasker schedules it**, and that confirmation appears in the chat thread (H1).
- Chat is the task's system of record: timestamped messages, photos and calls, visible to the platform (H16). Calls go through a masked number (H16, H15).

**Screens/components:** review summary card (tasker, time, address, details, rate, payment method, promo field), "Confirm" action, then a task detail page with a chat thread, a status timeline and a Task Info sheet.
**Microcopy pattern:** say plainly that the booking is a *request* until the tasker confirms, and that the card is not charged until the work is done (or say what *is* held).

| Need | Backend | Notes |
|---|---|---|
| Review summary + promo + points | **S** | `POST /quote` and the domain preview. The promo errors are typed (`422 rule_violation`, `404`). |
| Choose / save a payment method | **P** | `POST /bookings` takes an optional `paymentMethod`. Stripe mode defaults to `pm_card_visa` (BACKEND_NOTES "Payments providers"). There is no card-collection UI, no saved payment methods and no Stripe Customer. This is for the Stripe research agent. |
| Requested → tasker confirms | **S** | `status: requested`. Tasker `accept` within `booking.taskerResponseHours` (24 h), else `409 response_window_expired`. No auto-decline job yet (BACKEND_NOTES "Known limitations"). |
| Chat thread | **M** | No messages table, no realtime channel. Needed for reschedule agreement (§2), expense receipts (§1.9) and support evidence. |
| Masked calling | **M** | Out of scope. Show "Message" only. |

### 1.7 Payment hold

**TaskRabbit pattern** (T2, H4, H5)
- The marketing page says you pay by card in-app **after** the task (T2). The card is charged automatically within 24 h of the tasker's invoice (H4).
- For some web bookings a **one-hour deposit is charged at booking**, then settled against the final invoice: extra time is billed separately and nothing more is charged if it matches (H5).
- Cash and off-platform payment are prohibited (H4).

**TaskNest:** **S, and stricter.** `POST /bookings` authorizes the full card portion with **manual capture** (`capture_method=manual`), records `auth_expires_at`, and posts a `booking_hold` ledger txn. `complete` captures up to the authorized amount, charges again if the auth expired (`needsReauth`), and bills extras as a **separate** charge, the same shape as TaskRabbit's deposit-plus-difference (H5).

**UI pattern to adopt:** on the review step and the booking card, state "Card authorized for $X, charged when the task is complete". Show the hold expiry for long-lead bookings (the policy `auth.validityDays` = 7). If `needsReauth` is true, say the card will be re-authorized near the date.

### 1.8 Task in progress

**TaskRabbit pattern** (H14): chat is used for arrival times. If the tasker doesn't show, the client notes it in chat and cancels free, then rebooks the same or another tasker (H14).

**Screens/components:** a status timeline (Requested → Confirmed → On the way/Started → Invoice ready → Paid → Reviewed), an ETA banner, and "Message" and "Get help" actions.

| Need | Backend | Notes |
|---|---|---|
| Started state | **S** | `POST /bookings/:id/start` → `in_progress`. |
| Tasker no-show | **P** | `POST /bookings/:id/no-show {who:"tasker"}` is **admin-only** (API.md). There is no client-initiated "my tasker didn't show". Add a client report that goes to support, or allow a client to cancel with a full refund after `start_at` + grace when the booking is not `in_progress`. |
| Client no-show | **S** | Tasker or admin, `who:"client"`, after start. `noShowRefundBps` = 0 in v1. |

### 1.9 Completion: hours, extra expenses, invoice

**TaskRabbit pattern** (H4, H6, H18, H19, H20)
- The tasker invoices **hours worked plus approved expenses** within 24 h of finishing (H19, H4).
- Billing is a **1-hour minimum, then 15-minute increments** (H18, H19).
- Each expense is capped at $100 and needs a receipt photo in chat (H6).
- The card is charged within 24 h of the invoice (H4). Wrong invoices go through chat (open 24 h) or support for an amended invoice (H19, H20).
- The Trust & Support fee is a separate receipt line, a percentage of the hourly rate per hour, with expenses excluded (H17).

**Screens/components:** tasker "Submit invoice" form (hours worked with 15-min steps, expenses with amount, description and receipt photo), client invoice view (line items: hours × rate, fee, expenses, total, already-paid deposit, amount due), "Something wrong?" link to support.

| Need | Backend | Notes |
|---|---|---|
| Extra time | **S** | `complete {extraMinutes}` → extra labor at the booking rate plus service fee, a separate charge. |
| Expenses | **P** | `complete {expensesCents}` passes through 100% to the tasker. There are no line items, no description, no receipt, **no per-expense cap** (TR: $100 each) and no client approval. Consider `policy.expenses.maxPerItemCents` and an `expenses` table. |
| Fee excludes expenses | **S** | API.md: extras = extra labor + service fee, *plus* expenses passed through (fee not applied to expenses). Matches H17. |
| 1 h minimum / 15-min increments | **M** | `laborCents` bills per minute. If adopted, it belongs in the domain (`pricing.ts`) and `MoneyPolicy` (`billing.minMinutes`, `billing.incrementMinutes`) with unit tests, never in the UI. |
| Invoice review window before capture | **M** | TaskNest captures immediately on `complete`. TaskRabbit charges within 24 h of the invoice (H4). Optional: a `invoiced` state with a 24 h client dispute window before capture. That would change the state machine and ledger, so flag it as a product decision. |
| Client disputes invoice | **P** | The client can `POST /refund` (a 202 request only) and support resolves it in `/console`. That covers the "contact support" path (H20). |

### 1.10 Tip

**TaskRabbit pattern** (H7, H8): tipping opens after the invoice, **after the client reviews**, within **24 h**. The tasker keeps 100%. The tip is a separate statement line (H7). Tips are capped at **25% of the task total**, and larger tips go through support (H8).

**TaskNest:** **S.** `POST /bookings/:id/tip`, card only, 100% to the tasker (`platform_fee_cents = 0` CHECK), a separate PaymentIntent, cap `tips.capBpsOfSubtotal = 2500` across **all tips on the booking**, window `tips.windowDays = 30`.

Differences worth documenting on `/pricing` (these are policy choices, not bugs):
- Cap base: TaskNest uses **subtotal**, TaskRabbit uses **task total** (H8).
- Window: TaskNest 30 days vs TaskRabbit 24 h (H7).
- Ordering: TaskRabbit requires the review before the tip (H7). TaskNest allows either order. A combined "Review & tip" step is a good UI pattern, but don't make review a server requirement unless the policy says so.

**UI pattern:** preset chips (for example 10% / 15% / 20% of subtotal, rounded to cents by the domain) + custom amount + live "up to $X more" from `tipRoom()`. Show the existing cap message from `tipProblem()`.

### 1.11 Review

**TaskRabbit pattern** (H9): a 1–5 star rating plus a public written review, posted within 30 days of completion, one per task. Guidance asks reviewers to stay factual and not trade tips for reviews (H9).

**TaskNest:** **S.** `POST /bookings/:id/review {rating, body}` only for `completed`, once (`409 already_reviewed`), and it grants `points.reviewBonusPoints` (100). **M:** no review window (TR: 30 days). Add `reviews.windowDays` to the policy if wanted. Note the review-bonus points: that incentive pattern is exactly what TaskRabbit's guidance warns against (trading value for reviews), so keep the bonus independent of the rating and say so in the copy.

---

## 2. Cancellation and rescheduling

**TaskRabbit pattern**
- **Client cancel** (H10, T2): free with 24 h+ notice. Within 24 h, or on a client no-show, the fee is about 1 hour at the tasker's rate plus platform fees (or a partner minimum). Exemptions: canceled within 5 minutes of booking, the tasker didn't show, or the tasker already invoiced. The tasker may be compensated about 1 hour of their rate, unless they have recent ToS violations.
- **Reschedule** (H11, H12, T2): chat first, then Task Info → Reschedule → new slot → confirm. Within 24 h of start, **both parties must agree in chat**. Excessive reschedules are not allowed, and **rescheduling to dodge the fee is prohibited**. Greyed slots mean the tasker is unavailable.
- **Tasker cancels** (H13): the client gets a "find another tasker" flow that carries the task details over.

**TaskNest mapping**

| Rule | TaskNest | Status |
|---|---|---|
| Fee tiers | Policy v1: ≥48 h 100% refund, ≥24 h 50%, <24 h charge 60 min of rate (`cancellation.tiers`). Stricter than TR's single 24 h line. | **S** (different policy) |
| Exact fee shown before confirming | `GET /bookings/:id/cancel-preview`, already used in `/bookings`. A better pattern than TR's after-the-fact "Why was I charged?" (H10). | **S** |
| Anti fee-dodging via reschedule | `original_start_at` never moves; the cancellation curve is measured from it (API.md). That is the server-side version of H11's rule. | **S** |
| 5-minute free cancel grace | Not in `clientCancellation()`. | **M** (domain + policy `cancellation.graceMinutesAfterBooking`) |
| Free cancel if tasker no-show | Only through admin `no-show {who:"tasker"}`. | **P** |
| Reschedule mutual agreement within 24 h | Either party can reschedule alone, any time before start (`handlers/bookings.ts` `reschedule`). No proposal/accept step, no limit on count. | **M** (add `reschedule_requests` with propose/accept, or require counter-party accept when `start_at − now < 24h`; add `booking.maxReschedules`) |
| Reschedule respects availability | Overlap check only (`assertSlotFree`). | **P** |
| Tasker cancel → client compensation | Full refund to client; tasker gets a strike + $10 fee, suspension at 3 strikes in 30 days. | **S** |
| Tasker cancel → "find another tasker" | No rebook-from-booking flow. The UI can prefill `/taskers?category=…` with the old description/duration (client-side only). | **P** |
| Client-cancel compensation to tasker | `taskerPayCents` = unrefunded labor less commission (domain fix #1, BACKEND_NOTES). | **S** |

**Microcopy patterns:** in the cancel dialog, lead with the refund amount and the reason tier ("more than 48 hours before: full refund"), then the breakdown per tender (card / points / promo), then the confirm button labelled with the consequence. In the reschedule dialog, explain that the cancellation deadline stays tied to the original time. That's TaskNest-specific and important for Helix's "published terms" checks.

---

## 3. Tasker journey

**TaskRabbit pattern**
- **Profile, skills and rates** (B1, H18): taskers pick categories and set an hourly rate per category (Performance → Skills & Rates). They keep 100% of the rate and tips. They can opt into a 2-hour minimum, which is shown in the app and must be stated in chat.
- **Availability** (B2, H11): a calendar up to 17 days out in blocks of at least 2.5 h. Taskers must keep it accurate (H11).
- **Invitations** (B3, H1): invites have countdown timers, and a missed window loses the task. A booking is "scheduled" once the tasker schedules it, which blocks the calendar and confirms to the client.
- **Invoicing** (H19): bill all hours plus approved expenses within 24 h. Cancel instead of invoicing if no work was done. Billing increments are 15 minutes after the first hour.
- **Earnings and payouts** (B1, H24): payouts go through Stripe, mostly in 1–3 business days, to a checking account only. Tips are included.
- **Cancellation compensation** (H10): about 1 h of rate for qualifying late client cancellations, appearing within up to 8 business days in transaction history.

**Screens/components:** tasker home (today's tasks, new invitations with countdown, same-day toggle), calendar editor (week grid, drag blocks), Skills & Rates (category list with a rate input each, minimum-hours toggle), task detail (chat, Start, Submit invoice), Earnings (period totals, per-task lines, tips, adjustments, payout history, next payout date), Payout settings (bank account), Performance (ratings, response rate, cancellations/strikes).

| Need | Backend | Notes |
|---|---|---|
| Accept / decline with deadline | **S** | `accept` within 24 h (`taskerResponseHours`), `decline` releases the auth and points. The countdown can be computed from `created_at + taskerResponseHours`. Auto-decline: **M** (cron). |
| Start / complete with extras | **S** | |
| Earnings, balance, payouts | **S** | `tasker_balances`, `payouts`, a tasker's own `tasker_payable` ledger lines (RLS). `POST /payouts/run` (admin/cron), `payouts.holdDays = 3`. The `/tasker` page already shows earnings, balance, payouts and strikes. |
| Strikes / suspension banner | **S** | `tasker_strikes`, status `pending/active/suspended`, pending-KYC banner. |
| Rates per category | **M** | One `category` and one `hourly_rate_cents` per tasker, set by seed or admin. No tasker-side edit endpoint (`taskers` writes go only through `POST /admin/taskers/:id/status`). |
| Multiple skills/categories | **M** | Needs a `tasker_skills (tasker_id, category, rate_cents, min_minutes)` table. Booking would then snapshot the category rate (it already snapshots `rate_cents`). |
| Availability calendar | **M** | `tasker_availability` (weekly rules + date overrides) and a same-day toggle. |
| Payout account onboarding | **P** | `taskers.stripe_account_id` exists. The seed uses `acct_fake_*`. There is no onboarding flow (Connect onboarding is for the Stripe agent). A missing account blocks payout (`blockedReason`). |
| Per-task earnings lines incl. tips and cancellation pay | **P** | Derivable from the ledger. No tasker-facing "statement" view; add a view or API for per-booking earnings (labor net, extras, expenses, tips, clawbacks). |
| Tasker invoice deadline (24 h) | **M** | `complete` has no deadline. |
| Performance metrics (response rate, rating) | **M** | |

---

## 4. Trust and safety

**TaskRabbit pattern** (T1, T2, H21, H22, H4, H16)
- **Screening:** US taskers pass an identity check and a criminal background check (H21). ID verification goes through third-party providers (H22).
- **Protection program:** it sits behind the client's own insurance, and claims are due within 30 days (H21). The cap differs between pages (see caveats).
- **On-platform only:** payments and chat stay on the platform. Cash is banned, and so is sharing contact info to move off-platform (H4, H16).
- **Reporting:** damage, injury and invoice disputes go to support, with photos/receipts as evidence (H21). Support is reachable by chat, phone and email (H21).

**Screens/components:** "verified" badge on tasker cards with a tooltip explaining the checks, a trust strip on landing and checkout, "Report a problem" on the task page, a safety page.

| Need | Backend | Notes |
|---|---|---|
| Verified tasker gate | **S** | `taskers.status` (`pending` = KYC pending), `kyc_verified_at`. Only active taskers are bookable (`409 tasker_unavailable`). Real ID/background checks: **M** (out of scope; show "ID verified" only from `kyc_verified_at`). |
| Suspension | **S** | Admin status endpoint, auto-suspend on strikes, audited. |
| Card disputes (chargebacks) | **S** | `stripe-webhook` handles `charge.dispute.*`; dispute status is shown on bookings. |
| Damage claim / report a problem | **M** | No claims or tickets table. A minimal version: a `support_requests` table (booking_id, kind, body, attachments) readable in `/console`. Client refund requests already land in `audit_log` as `refund_requested`. |
| Off-platform payment guard | **M** | No chat, so nothing to filter. If chat is added, flag phone numbers and emails in messages. |
| PII minimisation | **S** | `display_names`: taskers by full name, others by first name only. Emails are never exposed (API.md). |

**Naming:** don't reuse TaskRabbit's program name. Something like "TaskNest Cover" works, and the page must not promise any dollar amount the backend can't settle. Helix treats rendered terms as published terms.

---

## 5. Support and help center

**TaskRabbit pattern** (H25, H20, H21): the help center home is a "How can we help?" search, then audience sections (Client, Tasker, Registration, Account, Policy Center) and a "Submit a request" link (H25). Articles are short, task-titled ("My Tasker canceled, what should I do?") with steps for app and web, and they link to the relevant policy. Contacting support means including the task name, the tasker and what looks wrong (H20, H10).

**TaskNest mapping**
- `/pricing` already renders the active `money_policies` row: fees, cancellation curve, tips, points, refund order. That is TaskNest's "Policy Center" and should stay the single source of truth.
- **M:** a `/help` page with question-titled articles. Each article should **render numbers from the policy row**, not hard-code them, so help text can't drift from what the server settles (the same rule the README sets for `/pricing`).
- **M:** "Get help with this booking" on each booking. It prefills booking id, tasker and amount, and posts to a support request (see §4). Staff work it in `/console` (bookings search, refund preview, refunds with approval, disputes: all **S**).
- Suggested starter articles (all answerable from today's policy row and API): How booking holds work · What happens if I cancel (live curve) · Rescheduling and the original-time rule · Extra time and expenses · Tips (cap, window, 100% to tasker) · Points (earn, pending, expiry, redemption) · Refunds (order across card/points/promo, request vs issued) · For taskers: accepting within the response window, strikes, payouts and the hold period.

---

## 6. Policy side-by-side (for QA and the Pricing page)

| Topic | TaskRabbit (cited) | TaskNest policy v1 (`domain/config.ts`) |
|---|---|---|
| Client fee | % of hourly rate per hour, separate receipt line; CA/MA show "Service Fee" only (H17) | `clientServiceFeeBps` 1500 (15%) on subtotal |
| Tasker take | 100% of rate + tips (B1) | `taskerCommissionBps` 1500 deducted; tips 100% |
| Charge timing | Within 24 h of invoice (H4); 1 h deposit on some web bookings (H5) | Full auth at booking, capture at `complete`; extras separate |
| Minimum / increments | 1 h min, 15-min steps (H18) | Per-minute, no minimum |
| Free cancel | ≥24 h; also within 5 min of booking (H10, T2) | ≥48 h 100%; 24–48 h 50%; <24 h 60 min of rate |
| Late-cancel fee | ~1 h of rate + fees (H10) | 50% tier, or 60 min of rate |
| Reschedule within 24 h | Mutual, confirmed in chat; no fee dodging (H11) | Either party alone; fee anchored to `original_start_at` |
| Tip cap | 25% of task total (H8) | 25% of subtotal, all tips summed |
| Tip window | 24 h after invoice (H7) | 30 days after completion |
| Review | 1–5 stars, within 30 days, one per task (H9) | 1–5, once, no window, +100 points |
| Expenses | ≤$100 each, receipt in chat (H6) | `expensesCents` lump sum, no cap |
| Booking horizon | 14 days (H1) | No limit |
| Tasker response | Countdown, missed = lost (B3) | 24 h, then `409`; no auto-decline |
| Payout timing | Mostly 1–3 business days via Stripe (B1) | `payouts.holdDays` 3, then `POST /payouts/run` |

---

## 7. Proposed TaskNest screen inventory (UI build)

| Route | Screen | Uses | Backend status |
|---|---|---|---|
| `/` | Landing: hero search, category tiles with "from $X", 3-step explainer, trust strip | anon reads of `taskers`, `money_policies` | S (from-price client-side) |
| `/book/:category` | Task details step: size → minutes, description, tz (address placeholder) | client state | P (no address) |
| `/taskers?category&date&price&sort` | Results: filter rail, sort, tasker cards | `taskers`, ratings view | P (ratings/stats view, availability M) |
| `/taskers/:id` | Profile: header, about, reviews, sticky "Select & continue" | `taskers`, `reviews` | P |
| `/book/:taskerId/time` | Day strip (14 days) + slot grid | busy-times view/endpoint | M |
| `/book/:taskerId/review` | Summary, promo, points, payment method, live quote, "Request booking" | `POST /quote`, `POST /bookings` | S (card UI is Stripe topic) |
| `/bookings` | Tabs: Upcoming / Needs action / Past; status chips | `bookings` + bundle | S |
| `/bookings/:id` | Task page: timeline, hold/charges panel, actions (reschedule, cancel with preview, tip, review, get help), chat area | lifecycle endpoints | S except chat (M), help request (M) |
| `/tasker` | Home: invitations with countdown, today, upcoming | accept/decline/start | S |
| `/tasker/bookings/:id` | Start, Complete (extra time stepper, expenses), cancel | `start`, `complete` | S (itemised expenses M) |
| `/tasker/earnings` | Balance, per-task lines, tips, clawbacks, payouts, next payout | `tasker_balances`, `payouts`, ledger lines | S/P (statement view) |
| `/tasker/profile` | Skills & rates, availability calendar, payout account | — | M |
| `/help`, `/help/:slug` | Help center rendered from policy | `money_policies` | M (content only) |
| `/pricing` | Published terms | `money_policies` | S |
| `/console` | Staff | existing | S |

**Shared components:** CategoryTile, TaskerCard (rating, count, rate, badge, pitch), FilterRail, SortMenu, DayStrip, SlotGrid, QuotePanel (exists), MoneyBreakdown (per-tender, reuse preview.ts), StatusTimeline, HoldNotice, CancelDialog (exists), RescheduleDialog (exists), TipChips, StarRating, EmptyState, Toast. Keep `data-testid`s on all money controls. The e2e suite (`e2e/ui.spec.ts`) depends on the existing ids (`tasker-card-*`, `quote-panel`, `cancel-open`, `tip-open`, etc.), so the redesign must keep or migrate them.

---

## 8. Backend gaps, prioritised for a TaskRabbit-like UX

**P0 (needed for the core flow to feel real, no money-rule changes)**
1. Public **tasker stats/rating view** (avg rating, review count, completed count). Today reviews of a tasker can't be listed by other clients or by anon users, because the join goes through RLS-restricted `bookings` (`src/lib/data.ts` `taskerReviews`).
2. **Busy-times** read for a tasker (start/end only, no ids) to grey out slots.
3. **Payment method collection** for Stripe mode. Today the default is `pm_card_visa` (Stripe research agent).
4. **Auto-decline** cron for expired requests (listed in BACKEND_NOTES).

**P1 (new product surfaces)**
5. Booking **messages** (chat) with RLS for the two parties and staff.
6. **Support requests** / report a problem, worked in `/console`.
7. **Tasker profile editing**: bio, avatar, headline, and rate within admin-set bounds (a new tasker endpoint; rate changes must not touch existing bookings, which already snapshot `rate_cents`).
8. **Availability** table + same-day toggle; enforce on `POST /bookings` and `reschedule` (`409 tasker_unavailable_at_time`).
9. **Reschedule proposals** (counter-party accept within 24 h) and `maxReschedules`.

**P2 (money-rule changes: domain + policy + unit tests + `/pricing` + new policy version, never retroactive)**
10. Billing minimum and increments (`billing.minMinutes`, `billing.incrementMinutes`).
11. Cancellation grace minutes after booking.
12. Itemised expenses with a per-item cap and receipts.
13. Review window, booking horizon (`maxAdvanceDays`).
14. Optional `invoiced` state with a client review window before capture.
15. Address/service area, multi-category skills with per-category rates, recurring bookings.

P2 items change what Helix checks as "published terms". Each one needs a new `money_policies` version via `POST /admin/policies`, and old bookings keep their version.
