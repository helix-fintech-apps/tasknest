# TaskNest build: ON HOLD (owner request, 30 Oct 2026)

The TaskRabbit-style UI/UX + Stripe build was paused by the owner. Nothing here is merged to `main`.

## What exists
- **Plan:** `PLAN.md` (final build plan: Wave 0, frozen contracts, 7 workstreams, Stripe design, tests, integration order, 12 open owner decisions). Research: `stripe.md` (official Stripe docs, cited), `taskrabbit.md`, `backend.md`, `frontend.md`, `platform.md`, three UX proposals, `OWNER-NOTES.md`.
- **Owner decision:** *simulated keys*. The default runtime is the fake payments provider and a simulated card form; real Stripe test mode only when keys are set. Everything simulated is labelled "Simulated".
- **Saved work branches** (on GitHub, not merged):
  | Branch | What | State |
  |---|---|---|
  | `hold/wave0-WS7-a` | Wave 0 backend split + schema contract (one migration with all new tables) | done, committed |
  | `hold/wave0-WS1-a` | Wave 0 frontend split (route table, API client, mock backend split, deps) | done, committed |
  | `hold/wave0-base` | the two Wave 0 branches merged | done |
  | `hold/ws-WS7-b` | WS7-b backend core: money policy v2 domain, ledger postings, card bridge, discovery/ledger migrations | partly built (WIP commit) |
  | `hold/ws-WS1-b` | WS1-b design system and shell | partly built (WIP commit) |
- **Not started:** WS2 discovery/booking wizard, WS3 bookings management, WS4 Stripe payments, WS5 Connect + tasker workspace, WS6 support console; integration; verification; PR.

## To resume
1. Read `PLAN.md` sections 0, 3, 5 and 9. 2. Check out `hold/wave0-base`, finish WS7-b and WS1-b from their branches, then run the remaining workstreams (plan section 5) in separate git worktrees. 3. Merge in the plan's section 9 order, run lint/typecheck/unit/api/e2e, adversarially verify, then open one PR.
Workflow script (session-local, may be gone): `tasknest-build`. Rebuild from this plan if needed.
