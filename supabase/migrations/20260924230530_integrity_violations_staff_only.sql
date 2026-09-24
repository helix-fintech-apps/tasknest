-- integrity_violations is a staff tool. Under RLS a client sees their own points lots but not the
-- ledger, which made the view report false "points_ledger_vs_lots" rows to non-staff callers.
-- Signed-in users now get rows only if they are staff (admin / support_agent); anon cannot select it;
-- the service role and SQL sessions (CI checks, Helix) still see everything.

create or replace view public.integrity_violations with (security_invoker = true) as
select v.check_name, v.subject, v.detail
from (
  select 'ledger_unbalanced'::text as check_name, x.txn_id::text as subject,
         x.unit || ' off by ' || x.net as detail
    from (select txn_id, unit, sum(debit) - sum(credit) as net
            from public.ledger_lines group by txn_id, unit having sum(debit) <> sum(credit)) x
  union all
  select 'tender_over_refunded', t.booking_id::text || ':' || t.tender::text,
         t.refunded_cents || ' refunded > ' || t.amount_cents || ' paid'
    from public.booking_tenders t where t.refunded_cents > t.amount_cents
  union all
  select 'points_lots_vs_movements', p.user_id::text,
         'lots ' || p.lots_total || ' != movements ' || p.movements_total
    from public.points_integrity p where p.lots_total <> p.movements_total
  union all
  select 'points_ledger_vs_lots', coalesce(l.user_id, g.user_id)::text,
         'ledger ' || coalesce(g.points, 0) || ' != lots ' || coalesce(l.points, 0)
    from (select user_id, sum(points_remaining)::bigint as points from public.points_lots group by user_id) l
    full join (select party as user_id, (sum(credit) - sum(debit))::bigint as points
                 from public.ledger_lines
                where account = 'points_outstanding' and unit = 'POINTS' group by party) g using (user_id)
   where coalesce(l.points, 0) <> coalesce(g.points, 0)
  union all
  select 'closed_booking_holds_funds', b.id::text, b.status::text || ' booking holds ' || h.held
    from public.bookings b
    join (select t.booking_id, (sum(l.credit) - sum(l.debit))::bigint as held
            from public.ledger_lines l join public.ledger_txns t on t.id = l.txn_id
           where l.account = 'client_funds_held' and l.unit = 'USD' and t.booking_id is not null
           group by t.booking_id) h on h.booking_id = b.id
   where b.status not in ('requested', 'accepted', 'in_progress') and h.held <> 0
  union all
  select 'open_booking_hold_mismatch', b.id::text,
         'held ' || coalesce(h.held, 0) || ' != non-card tenders ' || coalesce(nc.amount, 0)
    from public.bookings b
    left join (select t.booking_id, (sum(l.credit) - sum(l.debit))::bigint as held
                 from public.ledger_lines l join public.ledger_txns t on t.id = l.txn_id
                where l.account = 'client_funds_held' and l.unit = 'USD' and t.booking_id is not null
                group by t.booking_id) h on h.booking_id = b.id
    left join (select booking_id, sum(amount_cents)::bigint as amount
                 from public.booking_tenders where tender <> 'card' group by booking_id) nc on nc.booking_id = b.id
   where b.status in ('requested', 'accepted', 'in_progress') and coalesce(h.held, 0) <> coalesce(nc.amount, 0)
) v
where current_user not in ('anon', 'authenticated') or (select private.is_staff());

revoke all on public.integrity_violations from anon, public;
grant select on public.integrity_violations to authenticated, service_role;
