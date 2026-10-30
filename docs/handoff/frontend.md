# TaskNest frontend review

Repo: `helix-fintech-apps/tasknest` at `65a45d8`, cloned at `/home/user/tasknest`. Nothing in the repo was edited, committed or pushed. The screenshot and audit harness lives in the scratchpad (`shotrun/`) and reuses the repo's own `e2e/mock-backend.ts`.

## 0. Verdict in one paragraph

The frontend is a working internal tool, not a consumer marketplace. Its money flows are careful and well tested: domain previews, server cross-checks, idempotency keys, and 23 of 23 mocked e2e tests pass. As a TaskRabbit-style product, though, it is missing most of the client journey:
- No public landing or category browsing.
- No address field.
- No availability-based scheduling.
- No card collection at all. The Stripe provider silently uses `pm_card_visa` on the server.
- No chat.
- No ratings on tasker cards.
- No sign-up.
- No tasker onboarding or payout setup.

The phone layout breaks in the header on every signed-in page, and in the console. There are 3 axe rule failures, one of them critical, plus modal focus problems.

## 1. How it was run (evidence)

| Step | Result |
| --- | --- |
| `npm ci` | OK, 288 packages |
| `npm run build` (`tsc --noEmit && vite build`) | OK. One JS chunk of **488.58 kB (139.31 kB gzip)** with no route-level code splitting. CSS is 22.86 kB. |
| `npx eslint . --max-warnings=0` | OK, 0 warnings |
| `npx playwright test e2e/ui.spec.ts` (mock backend, Vite dev on :5173) | **23 passed** (1.9 min) |
| Screenshot and audit run (`shotrun/shots.spec.ts`) | 8 tests passed, 28 states × 2 viewports = **56 PNGs** |
| Axe-core 4.10.2 (wcag2a/aa, 21a/aa, 22aa, best-practice) on 40 page states | 3 rules fail (see §6) |
| Keyboard probe (`shotrun/kbd.spec.ts`) | Modal focus is not managed, all titles are the same, an unknown route silently redirects |

Screenshots are in `/tmp/claude-0/-home-user-harbor/b6aa7a3d-5f07-5939-92a9-7994a9568488/scratchpad/tasknest/shots-current/` as `<name>-1280.png` and `<name>-390.png`. Per-state metrics (overflow, tap targets, axe) are in `metrics.jsonl` in the same folder.

| # | State | # | State |
| --- | --- | --- | --- |
| 01 | sign in | 13 | points |
| 01b | sign-in error | 14 | pricing (signed in) |
| 02 | pricing (public) | 20 | tasker dashboard (Tara) |
| 03 | `/taskers` logged out → redirect | 20b | complete-task dialog with extras |
| 10 | browse taskers | 20c | tasker cancel dialog |
| 10b | browse, no match | 21 | pending-KYC tasker (Pia) |
| 11 | tasker profile + quote | 30 | console bookings |
| 11b | profile with points + promo filled | 30b | console booking detail + refund preview |
| 11c | profile of a *pending* tasker | 31 | console taskers |
| 12 | my bookings | 32 | console payouts |
| 12b–f | cancel / reschedule / tip-over-cap / review / refund-request dialogs | 33 | console ledger |
| | | 34 | admin browsing taskers |
| | | 35 | support-agent console |

## 2. Route map

From `src/App.tsx`. `RequireRole` waits for the session and profile, then redirects to `homeFor(role)`.

| Route | Roles | Page | Notes |
| --- | --- | --- | --- |
| `/` | any | `Home` | Redirects to `/signin` or the role home. **There is no landing page.** |
| `/signin` | public | `SignIn.tsx` | Email and password, plus 7 demo-account "Use" buttons. No sign-up, password reset or email verification, although the API returns `403 unverified`. |
| `/pricing` | public | `Pricing.tsx` | Published terms rendered from the active `money_policies` row. This is the only public content page. |
| `/taskers` | client, admin, support_agent | `Taskers.tsx` | Search plus a category select. Logged-out visitors are sent to sign-in. |
| `/taskers/:id` | client, admin, support_agent | `TaskerProfile.tsx` | Profile, booking form and sticky "Price details" quote panel |
| `/bookings` | client | `MyBookings.tsx` | Upcoming and Past lists. Five dialogs: cancel, reschedule, tip, review, refund request. |
| `/points` | client | `Points.tsx` | Stats, lots and history |
| `/tasker` | tasker | `TaskerDashboard.tsx` | Stats, requests, upcoming, history, payouts and strikes. Dialogs: complete, cancel, reschedule. |
| `/console` | admin, support_agent | `Console.tsx` | Tabs (local state, not URL): Bookings & refunds, Taskers, Payouts (admin only), Ledger |
| `*` | – | – | `Navigate to "/"`. **There is no 404.** `/nope-404` lands on `/taskers` with no message. |

Navigation (`NAV` in `App.tsx`):
- **Client:** Find a tasker, My bookings, Points, plus Pricing.
- **Tasker:** Dashboard.
- **Staff:** Console.
- The header also shows the user's name with their role and a Sign out button.

## 3. Components and design system

`src/components/ui.tsx` (316 lines) is the whole kit:
- **Layout and text:** `Card`, `H1(sub)`, `H2`.
- **Controls:** `Button` with variants primary, secondary, danger and ghost. `Input`, `Select` and `Textarea` share one `inputCls`. `Label` and `Field(label, hint, id)`.
- **Feedback:** `Banner` with tones info, success, warning and error. Error uses `role="alert"`, the others `role="status"`.
- **Display:** `Badge` maps status to colour and falls back to grey. `MoneyRow` uses tabular figures and a `−` sign for negatives. `Stat`.
- **Overlays and states:** `Modal`, `Empty`, `Spinner` (text only).
- **Hooks:** `useLoad(fn, deps)` handles load and reload. `useAction(fn)` runs a mutation with an Idempotency-Key, keeping the key on network, 5xx or 409 busy errors and rotating it otherwise.

Also present:
- `src/components/ErrorBoundary.tsx`: one boundary around `<main>`, with a "Try again" button.
- `src/index.css`: Tailwind v4 `@import "tailwindcss"`. The only theme token is `--font-sans`. Body is `bg-slate-50 text-slate-800`. Global `table/th/td` styles. `color-scheme: light`.

Design-system observations:
- **No tokens.** Colours are raw Tailwind classes (`blue-600`, `slate-*`) scattered across pages. There is no semantic token layer (primary, surface, danger, success) and no dark mode, both of which a rebrand would need.
- **Inconsistent spacing.** `Card` uses `p-5` by default, but there are 8 overrides with `!p-0` and `!p-4`. Typography is ad hoc: section headings are sometimes `H2` and sometimes an uppercase `text-sm` `<h2>`.
- **Missing primitives** a marketplace needs:
  - Avatar or photo (only a letter in a circle today)
  - Rating stars component
  - Tabs with ARIA
  - Stepper / progress
  - Date and time-slot picker
  - Chip / filter pill
  - Toast (flashes are banners that never dismiss)
  - Skeleton loaders
  - Drawer / bottom sheet for phone
  - Accessible Combobox / Autocomplete for the address and category search
  - Pagination (console lists are capped at 50–100 rows with no paging)
- **Weak brand mark.** The logo is a `⌂` glyph in a blue square.
- **Formatting is consistent.** `src/lib/format.ts` is the single place for money and dates: `money()` comes from `@domain formatCents`, `parseDollars` avoids floats, and `fmtDateTime` is time-zone aware.

## 4. State and data flow

```
                ┌──────────── reads (supabase-js, RLS) ────────────┐
React page ──── useLoad ──► src/lib/data.ts ──► PostgREST tables/views
   │                                            (taskers, bookings, booking_tenders, refunds, tips,
   │                                             reviews, disputes, display_names, points_lots,
   │                                             points_movements, payouts, tasker_strikes,
   │                                             tasker_balances, ledger_txns/lines, promo_codes,
   │                                             promo_redemptions, money_policies)
   ├── previews ──► src/lib/preview.ts ──► @domain (quote, allocateTenders, promoDiscount,
   │                                             clientCancellation, refundAfterRetention, validateTip,
   │                                             planRefund, pointsSummary) with the booking's policy_version
   └── writes ──── useAction ──► src/lib/api.ts ──► Edge Function `api` (JWT + Idempotency-Key,
                                                     auto-retry 409 busy ×3 with same key)
```

- **Auth.** `src/lib/auth.tsx` keeps `{session, profile}` in context and reads `profiles` for your own row. `onAuthStateChange` clears the profile on sign-out, but it does **not** reload the profile on a token refresh or on sign-in from another tab.
- **No query cache.** Every page refetches on mount, and each `useLoad` is independent. The tasker dashboard fires 5 parallel loads plus 1 policy load, and `bundleBookings` fans out 6 more queries. There is no SWR or React Query, and nothing refreshes live (no realtime), so a tasker never sees a new request without reloading.
- **Server cross-checks.** The quote panel calls `POST /quote` after a 400 ms debounce and shows "Server quote matches" or a mismatch warning. The console refund calls `POST /bookings/:id/refund-preview` and falls back to the browser preview.
- **Unused API endpoints:**
  - **Cancel preview.** `GET /bookings/:id/cancel-preview` exists, but `CancelDialog` uses only the browser preview.
  - **No-show.** `POST /bookings/:id/no-show`: `api.noShow` is defined in `api.ts:230` but **no UI calls it**, so this is a stub flow.
  - **Health.** `GET /health`: the provider (`fake` or `stripe`) is never shown, so a QA user can't tell which one is active.
  - **Admin tools.** `/admin/policies`, `/admin/points/grant` and `/admin/test-clock` have no console UI.
- **`needsReauth`** in the `POST /bookings` response is ignored.

## 5. UX gaps, broken and stub flows

Severity: **P0** blocks the "full working TaskRabbit-like UI with Stripe" goal, **P1** is a visible defect, **P2** is polish.

### P0: missing core marketplace flows

1. **No payment-method capture anywhere.** The booking button says "Your card is authorized now…", but there is no card field. The server's Stripe provider uses `payment_method: i.paymentMethod ?? "pm_card_visa"` (`supabase/functions/_shared/provider/stripe.ts:80,117`), so every real-Stripe booking would be charged to Stripe's test Visa. The client never enters a card, never sees a saved card, and never handles 3-D Secure. See §7 for what Stripe requires.
2. **No task address or location.** A booking stores only a time zone (`booking-tz` select of 6 zones). TaskRabbit's flow starts with category plus address ([Hire a Tasker](https://support.taskrabbit.com/hc/en-us/articles/210861763-How-Do-I-Hire-a-Tasker)).
3. **No public discovery.** `/` and `/taskers` require sign-in, there is no landing page or category directory, and logged-out visitors see only sign-in and pricing (shot `03`). TaskRabbit puts categories, popular projects with "starting at" prices, and how-it-works up front ([taskrabbit.com](https://www.taskrabbit.com/)).
4. **No sign-up or account flows.** There is no register, forgot password, email verification, profile, address book or payment-methods page. The API rejects unverified clients with `403 unverified`, but the UI has no way to verify.
5. **Scheduling is a raw `datetime-local`.**
   - No tasker availability or time slots.
   - No minimum time, so you can pick a past date and find out only from the server's 422.
   - No booking horizon. TaskRabbit allows up to 14 days ahead ([Hire a Tasker](https://support.taskrabbit.com/hc/en-us/articles/210861763-How-Do-I-Hire-a-Tasker)). That window matters for card holds, which last about 7 days (§7).
6. **No messaging.** TaskRabbit's step 3 is "chat, confirm and book" ([How it works](https://www.taskrabbit.com/how-it-works)). TaskNest has no chat, notifications or activity feed.
7. **No tasker side beyond the job queue.** Taskers can't edit their profile, rate, skills, categories or availability. There is no KYC or payout-account onboarding: the pending banner says "pending verification (KYC)" but offers no action. The API notes say "a missing payout account blocks the payout" (`docs/API.md` §payouts), and the UI has no Stripe Connect onboarding (§7).

### P1: broken or misleading in the current UI

8. **Tasker "Earnings (net)" is understated.** `TaskerDashboard.tsx` sums `subtotal − commission` over completed bookings and ignores `extra_labor_cents` and `expenses_cents`. In the mock data, the "Hang shelves" job's $22.50 extra labor (net $19.12 after a $3.38 commission) and $12.50 expenses are missing, so the card shows $229.50 instead of $261.12. It also computes money in the UI, which `.coderabbit.yaml` (`src/**`) asks to avoid. Use the ledger (`tasker_balances`) or a server figure instead.
9. **Console "Total" column ignores extras.** In shot `30`, every row shows $103.50, including the booking whose card was charged $141.88. The detail panel is right; the list is wrong.
10. **Disabled "Request booking" gives no reason.** The button is disabled when the description is empty, the tasker isn't active, the promo is invalid or the role isn't client, but no hint says why (shot `11c`: a pending tasker's full form is rendered and greyed out). A pending tasker's profile can also be reached by URL.
11. **Price details sit below the button on phone** (shot `11b-390`). The client taps "Request booking · $103.50" before seeing the breakdown.
12. **The button label shows the total, not what the card is charged.** With WELCOME10 plus 1,000 points, the button still says $103.50 while the card portion is $83.50.
13. **"pricing & policies" in the booking form is a plain `<a href="/pricing">`** (`TaskerProfile.tsx`). It reloads the whole page and throws away the form.
14. **Tasker cards show no rating, review count or tasks completed.** `listTaskers()` hard-codes `rating: null, reviews: 0`. Reviews appear only on the profile, as bare star glyphs with no reviewer name or date.
15. **The flash message comes back on refresh.** `MyBookings` reads the flash from `location.state`, and browser history keeps that state.
16. **The console list is not keyboard operable.** Rows are `<tr onClick>`. Selecting a row on phone shows the detail far below with no scroll.
17. **Payouts and ledger show raw IDs.** Payouts show `tasker_id.slice(0,8)` and the payout run prints raw JSON in a `<pre>`. Ledger "party" is a UUID prefix.
18. **Console tabs live in component state.** They can't be deep-linked and reset on reload. "View ledger entries" works only inside the same session.
19. **There is no tasker no-show button** (see §4), although `no_show_client` bookings have a client "Request a refund" path.
20. **Busy and loading states are thin.** `Spinner` is the text "Loading…" and there are no skeletons. Dialog buttons show "Canceling…" but there is no global pending indicator.

### P2: polish

- **Static page title.** `<title>` is always "TaskNest" on every route (probe result).
- **Empty states have no next step.** For example, "No bookings yet. Find a tasker to get started." has no link.
- **Review rating is a `<select>` of `★★★★★ (5)`.** Screen readers read "black star" five times. Use a radio group of stars.
- **Dates are inconsistent.** `fmtDateTime` shows the location time zone on cards, but tables use the browser's zone with no zone label.

## 6. Accessibility

Axe-core results across 40 page states at both widths:

| Rule | Impact | Where | Fix |
| --- | --- | --- | --- |
| `color-contrast` | serious | 26 states. `text-slate-400` (role suffix "(client)", muted `MoneyRow` rows such as "Wallet $0.00", "Policy v1", hints), the demo password `code` chip and `quote-promo` | Use slate-500 or darker for text on white |
| `select-name` | **critical** | `/taskers` category select, console status select | Add a `<label>` or `aria-label` |
| `scrollable-region-focusable` | serious | `/pricing` cancellation table wrapper at 390 px | Add `tabIndex=0`, `role="region"` and `aria-label` to `.overflow-x-auto` |

Keyboard and screen-reader probe (`shotrun/kbd.spec.ts`):
- **`Modal` doesn't manage focus.** Opening the cancel dialog leaves focus on the trigger. Twelve presses of Tab all landed *behind* the dialog. It has no `aria-modal`, doesn't lock background scroll, and doesn't return focus to the trigger on close. The ✕ close button is 13×24 px.
- **No visible focus on links.** Tasker card links have no focus style (computed `outline: none` when focused). Buttons rely on the browser default outline. Inputs do have a ring.
- **Tabs aren't tabs.** Console tabs are plain buttons with no `role="tablist"`, `aria-selected` or arrow-key support.
- **Small tap targets.** Below 24×24 px (WCAG 2.5.8): the header "Sign out" (54×20) and "Sign in" (45×20) links, the points checkbox (13×13), the inline "pricing & policies" link (97×15) and the modal ✕ (13×24). Almost all controls are under 44 px tall (buttons are about 36 px).
- **Other gaps:**
  - The points input has no label.
  - There is no skip link.
  - Route changes aren't announced, because the title never changes and focus isn't moved to the h1.
  - Status uses colour plus a text Badge, which is OK, but red dispute text is the only signal in the tasker history table.

## 7. Phone layout (390 px)

| Problem | Evidence |
| --- | --- |
| **The header doesn't collapse.** The nav wraps into a column, giving a header about 225 px tall on client pages (shots `10/11/12/13-390`). Labels such as "My bookings" and "Pricing & policies" break onto two lines, and the user name and "Sign out" are squeezed. | `App.tsx` `Shell` uses `flex` with `flex-wrap` and has no hamburger, drawer or bottom tab bar |
| **Horizontal scroll in the console** (page `scrollWidth` 550 px on bookings, booking detail and the agent console). The `1fr` grid column doesn't shrink because there is no `min-w-0`, so the table and form push the whole page wide. The header stays at 390 px, which shows as a misaligned right edge. | `30-390`, `30b-390`, `35-390`; `metrics.jsonl` `wide` entries |
| **2 px horizontal overflow on `/points`.** The cards are 392 px wide. | `13-390` |
| **The quote panel follows the form** and the sticky aside doesn't become a sticky bottom bar, so the total and Book button aren't visible together. | `11b-390` |
| **Booking cards reflow unevenly.** The total jumps below the text on split-tender cards. | `12-390`, third card |
| **Wide tables in narrow cards.** Tasker history and points tables wrap dates into 3 lines. They should become list rows on phone. | `20-390`, `13-390` |
| **Stat tiles stack 1-up,** so the 4 dashboard stats take a full screen. | `20-390` |
| **Modals are centred dialogs.** The cancel dialog fits but sits over the tall header. A bottom sheet would suit phone better. | `12b-390` |

## 8. Stripe: what the frontend must add

All facts below were fetched from docs.stripe.com during this review.

**Load Stripe.js from Stripe.** Stripe.js "should always be loaded directly from `https://js.stripe.com`, rather than included in a bundle or hosted yourself". Stripe also recommends including it on every page for fraud signals. The `@stripe/stripe-js` npm module is the supported loader. Source: [docs.stripe.com/js/including](https://docs.stripe.com/js/including).
- The current `index.html` and Vite config need no CSP today. If a CSP is added, it must allow `js.stripe.com`.

**Collect the card with the Payment Element.** It is an embeddable UI for 100+ payment methods that validates input and handles errors. It is mounted with `stripe.elements({ clientSecret, appearance })` and `elements.create('payment', { layout })`. Source: [docs.stripe.com/payments/payment-element](https://docs.stripe.com/payments/payment-element).
- **Errors.** It shows localized messages for decline codes such as `card_declined`, `insufficient_funds` and `incorrect_cvc` during client confirmation.
- **Styling.** The Appearance API (`theme`, `variables`) is how it should match TaskNest's tokens, which is another reason to add a token layer (§3).
- **Which API.** The page says Stripe recommends Checkout Sessions with the Payment Element "for most integrations". Payment Intents fit when you "own your checkout flow end-to-end". TaskNest already owns its pricing, tender split, manual capture, extras and ledger, so **Payment Intents** match the existing `stripe.ts` provider. This is a backend decision to confirm.

**Place a hold (manual capture).** `capture_method=manual` (or `payment_method_options[card][capture_method]=manual`) puts the PaymentIntent in `requires_capture` after confirmation. Source: [docs.stripe.com/payments/place-a-hold-on-a-payment-method](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method).
- **Validity.** Online card authorizations are "typically" valid for 7 days. A customer-initiated Visa authorization is valid for 7 days. A merchant-initiated Visa authorization is valid for 5 days, exactly "4 days and 18 hours". This matches `auth.validityDays: 7`, but bookings can be scheduled further out than 7 days.
- **Capture rules.** Capture uses `amount_to_capture`, and "a partial capture automatically releases the remaining amount". Most payments allow only one capture. Release a hold by canceling the PaymentIntent.
- **UI copy implications.**
  - The booking confirmation should say "hold, not a charge" and show when it expires.
  - For far-future bookings, the UI must collect a reusable card so the server can authorize or charge again (`needsReauth`).
  - Some issuers show holds like charges. Stripe notes this confuses customers, so the booking page should explain it.

**Save the card for later off-session charges.** TaskNest needs this for extras, re-authorization past the hold window, and tips. Source: [docs.stripe.com/payments/save-during-payment](https://docs.stripe.com/payments/save-during-payment.md?payment-ui=elements).
- **How.** Create a CustomerSession with `components.payment_element` features (`payment_method_save`, `payment_method_redisplay`, `payment_method_save_usage: 'off_session'`), and pass `customerSessionClientSecret` to `stripe.elements`. Or set `setup_future_usage` / `payment_method_options[card][setup_future_usage]=off_session`. Later charges use `off_session=true, confirm=true`.
- **Compliance the UI must show.** The docs require "terms … that state how you plan to save payment method details", "explicit consent … e.g. a 'Save my payment method for future' checkbox", and a record of the agreement. The booking screen must therefore state that extras, tips and re-authorizations may be charged to the saved card.

**3-D Secure.** Today the server confirms with `confirm: true` and throws `authorization_failed` for any status other than `requires_capture` (`stripe.ts`). A card that needs authentication would simply fail, because there is no client step to complete it.
- **Fix.** Confirm on the client (`stripe.confirmPayment` / `confirmSetup` via the Payment Element), or return the client secret when the status is `requires_action` so the browser can finish 3DS.
- **Test cards** ([docs.stripe.com/testing](https://docs.stripe.com/testing)):
  - `4242424242424242` succeeds.
  - `4000000000000002` is a generic decline.
  - `4000000000009995` is insufficient funds.
  - `4000008400000027` requires 3DS (US).
  - `4000002500003155` "requires authentication for off-session payments unless you set it up for future payments".
- **Test PaymentMethods** on that page include `pm_card_visa`, `pm_card_visa_chargeDeclined` and `pm_card_threeDSecure2Required`. The fake provider's decline token `pm_card_chargeDeclined` was **not** found on that page, so align the name if e2e should also run against Stripe test mode.

**Tasker payouts: Connect onboarding.** The API notes say payouts are `/transfers` to `taskers.stripe_account_id` (`docs/BACKEND_NOTES.md:85`). The tasker side needs an onboarding screen. Source: [docs.stripe.com/connect/embedded-onboarding](https://docs.stripe.com/connect/embedded-onboarding).
- **Embedded option.** The server creates an Account Session with `components[account_onboarding][enabled]=true`, and the client renders `stripeConnectInstance.create('account-onboarding')` with `setOnExit`.
- **Hosted option.** Stripe-hosted Account Links are the alternative.
- **Remediation.** Requirements that are `currently_due` or `past_due` (from `account.updated`) should send the tasker back to onboarding. This replaces the dead-end "pending verification (KYC)" banner.

## 9. TaskRabbit UX patterns to borrow (patterns only, not brand, copy or art)

| Pattern (source) | TaskNest today | Proposed TaskNest version |
| --- | --- | --- |
| **Homepage:** category tabs or hero, quick-task chips, "popular projects starting at $X" cards, social-proof counts, how-it-works in 3 steps, guarantee block ([taskrabbit.com](https://www.taskrabbit.com/)) | None (redirects to sign-in) | Public `/` with TaskNest's own categories (Handyman, Cleaning, Moving), "from $X/h" derived from live tasker rates, 3-step explainer, and a link to `/pricing` as the published-terms trust block |
| **Booking order:** category and address → see taskers and prices → filter by date, time and price → profile → select → date and time (≤14 days, tasker availability) → task details (supplies, parking) → review summary (change payment method, promo) → confirm ([Hire a Tasker](https://support.taskrabbit.com/hc/en-us/articles/210861763-How-Do-I-Hire-a-Tasker)) | One page with all fields, no address, no availability, no payment step | Stepper: `/book/:category` (task size, address, details) → `/book/:category/taskers` (filters, sortable cards) → time-slot picker → **Review & pay** with the existing quote panel, Payment Element, promo, points and consent → confirmation page |
| **Comparing taskers:** star rating, tasks completed in category, work photos, skills, tools and vehicle, hourly minimum, Elite badge ([Which Tasker is best](https://support.taskrabbit.com/hc/en-us/articles/46260459709723-How-Do-I-Know-Which-Tasker-Is-Best-for-My-Task)) | Name, category, rate, headline | Card: avatar, rating and count, completed tasks, rate, top skills, "Book" CTA. The profile adds a reviews list with reviewer first name and date, plus skills and tools. |
| **Post-booking:** chat to confirm details; payment in-app after completion; free reschedule/cancel with 24 h notice ([How it works](https://www.taskrabbit.com/how-it-works)) | No chat; cancel and reschedule dialogs exist with exact refund previews (stronger than TaskRabbit) | Booking detail page `/bookings/:id` with a timeline (requested → accepted → in progress → completed), message thread, receipt, and the existing cancel and refund previews |
| **Payment timing:** a pending authorization at booking that drops off after completion or within 7 business days; the card is charged about 24 h after the tasker submits an invoice ([How do I pay](https://support.taskrabbit.com/hc/en-us/articles/204411560-How-Do-I-Pay-My-Tasker); search summary of [Why was I charged right after booking](https://support.taskrabbit.com/hc/en-ca/articles/204411580-Why-Was-I-Charged-Right-After-Booking)) | Hold at booking, capture at completion, extras as a separate charge | Same model. Show a "Hold: $X, expires <date>" chip on the booking, and an itemised receipt (booked time, extras, expenses, fee, tip) after completion. |
| **Tips:** added after the invoice from the review flow, rate first, then tip, within 24 h ([How do I tip](https://support.taskrabbit.com/hc/en-us/articles/46260486399643-How-Do-I-Tip-My-Tasker)); capped at 25% of the task total ([Tipping Policy](https://support.taskrabbit.com/hc/en-us/articles/46260517853979-Tipping-Policy)) | Separate tip and review buttons; cap 25% of **subtotal**, 30-day window (policy v1) | Combine into one "Rate & tip" sheet after completion. Keep TaskNest's own policy numbers. The policy row is the source of truth, and the comparison is only informational. |
| **Fee disclosure:** the Trust & Support fee is a percentage of the hourly rate per hour worked, excludes expenses, and is a separate line on the receipt ([Trust & Support fee](https://support.taskrabbit.com/hc/en-us/articles/46260504648731-What-s-the-Taskrabbit-Trust-Support-Fee)) | "Service fee (15%)" line in the quote panel, already from policy | Keep it, and add an info tooltip linking to `/pricing#fees` |
| **Supply side:** "Become a Tasker" entry in the header ([taskrabbit.com](https://www.taskrabbit.com/)) | None | `/become-a-tasker` → sign-up → profile, skills and rate → availability → Connect onboarding (§8) |

## 10. Recommended frontend work (ordered)

1. **Shell and design tokens.**
   - Add semantic CSS variables in `@theme` and a phone nav (bottom tab bar or drawer).
   - Make `Modal` a proper dialog: focus trap and restore, `aria-modal`, scroll lock, and a bottom sheet under `sm`.
   - Add accessible `Tabs`, `Stars`, `Avatar`, `TimeSlotPicker`, `Stepper`, `Toast` and `Skeleton` components.
   - Fix the 3 axe rules and the tap targets.
   - Set `document.title` per route.
   - Add `min-w-0` on grid children.
   - Add lazy route chunks.
2. **Public landing, category pages and a 404.** Allow logged-out browsing of `/taskers` if RLS permits (`display_names` and taskers are readable for active taskers per `data.ts`).
3. **Booking stepper**, with address, availability and a Review & pay step using the Payment Element plus consent copy. Keep every existing `data-testid` (`quote-*`, `book-submit`, `points-*`, `promo-*`) so the 23 e2e tests keep passing, and add Stripe test-card e2e behind `E2E_BACKEND=1`.
4. **Booking detail page** with timeline, receipt, hold expiry, tip and review combined, and a no-show action for the tasker.
5. **Account area:** sign-up, verify email, reset password, profile and addresses, saved cards (CustomerSession `payment_method_remove`).
6. **Tasker area:** profile editor, availability, Connect onboarding and payouts view. Fix earnings to come from server or ledger figures (P1 #8).
7. **Console:** URL-based tabs, keyboard-selectable rows, the extras-inclusive Total (P1 #9), names instead of IDs, pagination, and a provider badge from `/health`.

## 11. Sources

Stripe (fetched 2026-10-29):
- https://docs.stripe.com/js/including
- https://docs.stripe.com/payments/payment-element
- https://docs.stripe.com/payments/place-a-hold-on-a-payment-method
- https://docs.stripe.com/payments/save-during-payment.md?payment-ui=elements
- https://docs.stripe.com/testing
- https://docs.stripe.com/connect/embedded-onboarding

TaskRabbit (UX patterns only, fetched 2026-10-29):
- https://www.taskrabbit.com/
- https://www.taskrabbit.com/how-it-works
- https://support.taskrabbit.com/hc/en-us/articles/210861763-How-Do-I-Hire-a-Tasker
- https://support.taskrabbit.com/hc/en-us/articles/46260459709723-How-Do-I-Know-Which-Tasker-Is-Best-for-My-Task
- https://support.taskrabbit.com/hc/en-us/articles/204411560-How-Do-I-Pay-My-Tasker
- https://support.taskrabbit.com/hc/en-us/articles/46260486399643-How-Do-I-Tip-My-Tasker
- https://support.taskrabbit.com/hc/en-us/articles/46260517853979-Tipping-Policy
- https://support.taskrabbit.com/hc/en-us/articles/46260504648731-What-s-the-Taskrabbit-Trust-Support-Fee
- https://support.taskrabbit.com/hc/en-ca/articles/204411580-Why-Was-I-Charged-Right-After-Booking (search-result summary only, not fetched directly)

Repo files read: `README.md`, `docs/SPEC.md`, `docs/API.md`, `docs/BACKEND_NOTES.md` (payments sections), `docs/CI.md` (grep only), `.coderabbit.yaml`, all of `src/`, `e2e/mock-backend.ts`, `e2e/ui.spec.ts` (head), `playwright.config.ts`, `vite.config.ts`, `index.html`, `supabase/functions/_shared/provider/stripe.ts` (authorize, capture, charge), `supabase/functions/_shared/domain/config.ts`.
