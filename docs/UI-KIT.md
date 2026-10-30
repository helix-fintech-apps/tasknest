# TaskNest UI kit and app shell (WS1)

The living style guide is the `/design-system` route: every component below in every state, in light and dark. The axe suite checks it too.

## Tokens and themes

- `src/index.css` holds the Tailwind v4 `@theme`: the **Dusk** (indigo-violet), **Yolk** (amber) and **Twig** (warm grey) ramps, plus semantic tokens (`bg-bg`, `bg-surface`, `text-fg`, `text-muted`, `border-line`, `bg-primary`, `text-danger`, `bg-hold-bg`, ...).
- The theme is the `data-theme` attribute on `<html>`. An inline script in `index.html` sets it before first paint (saved choice, else the OS setting). `src/lib/theme.ts` (`useTheme`) changes it; the account menu offers System, Light and Dark and stores the choice in `localStorage` (`tn-theme`).
- Older pages still use Tailwind's stock `blue-*` and `slate-*` classes. The theme maps those onto Dusk and Twig and flips them in dark mode, so they follow the theme with no edits. New code should use the semantic tokens.
- Fonts are self-hosted in `public/fonts` (Inter and Bricolage Grotesque, SIL OFL; licences alongside).
- Inputs are at least 16 px on phones. Motion respects `prefers-reduced-motion`.

## Components (`src/components/ui`)

| Component | Notes |
|---|---|
| `Button` | variants `primary`, `accent`, `secondary`, `danger`, `ghost`; sizes; `loading` |
| `Dialog`, `Sheet`, `Modal` | Native `<dialog>` + `showModal()`: background inert, Esc closes, Tab and Shift+Tab wrap, backdrop click closes, focus returns to the opener. `Modal` is the old name |
| `Tabs` | URL-synced (`?tab=`), arrow/Home/End keys |
| `ToastProvider`, `useToast()` | `show(message, {tone, kind})`; `kind` `flash` (default) or `refund-flash` sets the test id. Also shows "Already done earlier" whenever the API sends `Idempotent-Replayed: true` |
| `Banner`, `Badge`, `StatusChip` | `StatusChip` has the glossary vocabulary (plan section 12); text is always shown |
| `DataTable` | Always a `<table>`; under `md` each `<tr>` becomes a stacked card (`td[data-label]`). `rowProps` adds `data-*` to rows |
| `Money` | See below |
| `HoldChip` | "Hold $83.50 · releases by Nov 9" with a "Hold, not a charge" popover |
| `ReconcileBanner` | "Settled as previewed" or a diff table |
| `RequirementsList` | The reasons a submit button is disabled |
| `SimulatedBadge` | Mark every fake-provider surface with it |
| `Stepper`, `EmptyState`, `Skeleton`, `Avatar` (initials), `RatingStars` (display, or a radio group with `onChange`), `Combobox`, `CountdownChip`, `Field` (label, hint, error wired with `aria-describedby`) | |

### `<Money>`

```html
<span data-money-cents="8350" data-money-kind="card_hold" data-tender="card"
      data-source="server" data-policy-version="2">$83.50</span>
```

- `data-money-cents` is the **magnitude**. A negative display adds `data-money-sign="minus"` and a `−` (U+2212) with `role="img" aria-label="minus"`.
- Put test ids **on** the element (`testId`), so `toHaveText("$103.50")` keeps matching.
- `source="browser"` marks a preview shown while the server's number loads.
- The UI never computes money. In `src/features/booking`, ESLint forbids `*` and `/` on identifiers ending in `Cents`.

## Shell (`src/components/shell`)

- `AppHeader` renders one navigation per breakpoint, with the same test ids:
  - Public: Services, How it works, Pricing, Help, Become a tasker, Sign in, **Book a task**. On phones: a drawer and a sticky Book bar.
  - Client: Book a task (`nav-taskers`), My tasks (`nav-bookings`, with a "needs action" badge), Messages, Rewards (`nav-points`). Phones: bottom tabs Book, Tasks, Messages, Rewards, Account.
  - Tasker: Today (`nav-tasker`), Jobs, Calendar, Earnings. Phones: bottom tabs.
  - Staff: a sidebar (`nav-console`: Queue, Bookings, Disputes, Taskers, Ledger; admins also Payouts, Policies, Health, Reconciliation, Test tools). Phones: a section switcher.
- `ProviderBadge` reads `GET /health` and shows "Payments: Simulated" or "Payments: Stripe test" to staff. `src/lib/health.tsx` shares that read; `src/lib/flags.ts` exposes `useFlag(name)` from `health.features`.
- `RouteAnnouncer` sets `document.title` to "<Page> · TaskNest", moves focus to the page `h1` on navigation and announces the page. `SkipLink` is the first tab stop.
- Pages that are in the product plan but not built yet (`/services`, `/help`, `/messages`, `/console/ledger`, ...) show "Coming soon" instead of a 404. Any other unknown path shows "Page not found".
- `registerSignOutHook(fn)` in `src/lib/auth.tsx` runs `fn` on sign-out (Stripe Connect's `logout()` will use it).
- `useAction(fn, {recheck})` keeps its idempotency behaviour; after a failure that may have gone through (network error, 5xx) it runs `recheck`, shows "Checking whether this went through…", then tells the user that retrying is safe.

## Tests

- `tests/unit/money-component.test.tsx`, `tests/unit/ui-kit.test.tsx`: attributes, sign, aria, chips, reconcile, nav ids.
- `e2e/a11y.spec.ts`: axe (WCAG 2.2 AA) on every route, light and dark, at 1280 (`chromium` project) and 390 (`phone` project); no horizontal scroll; no console errors.
- `e2e/shell.spec.ts`: navigation per role and breakpoint, titles and focus, 404, toasts, dark mode, dialogs, notifications, the kit.
- `e2e/ui.spec.ts` and `e2e/backend.spec.ts` are frozen and run on the desktop project only.
- `npm run build` fails if any chunk is over 250 kB gzip (`scripts/check-bundle-size.mjs`).
