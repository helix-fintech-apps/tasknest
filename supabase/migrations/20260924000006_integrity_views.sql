-- Read-only integrity views (staff only via RLS on the underlying tables; security_invoker).
-- Used by tests/api and by Helix to assert money invariants.

-- Per-unit trial balance: total debits must equal total credits.
create view ledger_trial_balance with (security_invoker = true) as
select unit, sum(debit)::bigint as debits, sum(credit)::bigint as credits, count(distinct txn_id)::int as txns
from ledger_lines group by unit;

-- Any transaction that does not balance per unit (must always be empty).
create view ledger_unbalanced_txns with (security_invoker = true) as
select txn_id, unit, sum(debit)::bigint - sum(credit)::bigint as net
from ledger_lines group by txn_id, unit having sum(debit) <> sum(credit);

-- Points bookkeeping: movements must explain lot balances exactly, per user.
create view points_integrity with (security_invoker = true) as
select coalesce(l.user_id, m.user_id) as user_id,
       coalesce(l.lots_total, 0)::bigint as lots_total,
       coalesce(m.movements_total, 0)::bigint as movements_total
from (select user_id, sum(points_remaining) as lots_total from points_lots group by user_id) l
full join (select user_id, sum(points) as movements_total from points_movements group by user_id) m using (user_id);

-- Per-tender invariant: never refund more than was paid (also a CHECK constraint) — exposed for dashboards.
create view booking_money_summary with (security_invoker = true) as
select b.id as booking_id, b.status, b.total_cents, b.extra_cents,
       coalesce(sum(t.amount_cents), 0)::bigint as paid_cents,
       coalesce(sum(t.refunded_cents), 0)::bigint as refunded_cents
from bookings b left join booking_tenders t on t.booking_id = b.id
group by b.id;
