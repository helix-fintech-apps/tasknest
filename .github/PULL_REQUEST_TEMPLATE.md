## What & why

<!-- One or two sentences. Link the issue: Closes #123 -->

## Money impact

<!-- Tick exactly one. "Yes" requires the money checklist below. -->

- [ ] **None** - no change to amounts, tenders, points, refunds, payouts, tips, fees or the ledger
- [ ] **Yes** - describe the before/after with a worked example in cents:

<!--
Example: booking $45/h x 60 min, 15% fee
before: client pays 5175, tasker nets 3825
after:  ...
-->

### Money checklist (required if money impact = yes)

- [ ] All amounts are integer cents / integer points (no floats, no `toFixed` on money)
- [ ] Every money event posts one **balanced** ledger txn (debits = credits per unit)
- [ ] Mutating endpoints honour `Idempotency-Key`; a replay returns the first result
- [ ] Refunds never exceed paid minus already refunded, per tender
- [ ] Booking is evaluated with its own `policy_version`
- [ ] Logic lives in `supabase/functions/_shared/domain/` (not duplicated in UI/handlers)
- [ ] Only Stripe **test** keys / fake provider touched

## Database migration

- [ ] No migration
- [ ] New migration in `supabase/migrations/` (never edit a merged one)
  - [ ] RLS enabled + policies for any new table
  - [ ] Money columns are `bigint` cents
  - [ ] Backwards compatible with the currently deployed `api` function (deploy order: DB first, then function)
  - [ ] `scripts/ci/db_checks.sql` updated if a new invariant was added

## Tests

- [ ] Unit tests (`tests/unit`) for domain changes, including boundary cases
- [ ] API tests (`tests/api`) for endpoint/idempotency/authorization changes
- [ ] E2E (`e2e/`) for user-visible flows; new controls have `data-testid`
- [ ] N/A - explain:

## Rollout

- [ ] Safe to deploy to staging on merge (no manual steps)
- [ ] Needs manual steps / secrets / config (describe):

## Screenshots

<!-- UI changes only -->
