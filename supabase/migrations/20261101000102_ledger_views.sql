-- Marketplace money views and the unit of work's table list (plan 5 WS7, 7.2).
--
--   * tn_apply: the whitelist of tables a unit of work may write now includes the marketplace tables that the
--     API (service role) writes. Same body as before otherwise. Notifications are a non-money op inside the
--     same transaction as the event that causes them.
--   * integrity_violations: 'pending_payment' bookings are OPEN (their non-card tenders are held),
--     'payment_abandoned' bookings are FINISHED (everything released).
--   * booking_statement / tasker_statement: the ledger lines a client / tasker may see, with the transaction
--     kind and time (clients and taskers cannot read ledger_txns directly). They run as the view owner and
--     filter on auth.uid(), so a caller only ever sees their own rows (staff see all).
--   * reconciliation_by_booking: ledger card_clearing vs the Stripe balance transactions we stored.

create or replace function tn_apply(ops jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  op jsonb;
  kind text;
  tbl text;
  cols text;
  n int;
  expect int;
  txn_ids jsonb := '[]'::jsonb;
  v_id uuid;
  allowed text[] := array['bookings','booking_tenders','refunds','tips','disputes','points_lots',
    'points_movements','promo_redemptions','payouts','reviews','tasker_strikes','taskers','audit_log',
    'stripe_events',
    -- marketplace tables the API writes (docs/contracts.md 4.1)
    'payment_intents','card_consents','transfers','connected_payouts','stripe_balance_transactions',
    'notifications','messages','support_requests','support_replies','refund_approvals'];
  r jsonb;
  overlap int;
begin
  for op in select * from jsonb_array_elements(ops) loop
    kind := op->>'op';
    tbl := op->>'table';
    if tbl is not null and not (tbl = any(allowed)) then
      raise exception 'invalid: table % not allowed', tbl;
    end if;

    if kind = 'insert' then
      for r in select * from jsonb_array_elements(coalesce(op->'rows', jsonb_build_array(op->'row'))) loop
        select string_agg(format('%I', key), ',') into cols from jsonb_object_keys(r) key;
        execute format('insert into %I (%s) select %s from jsonb_populate_record(null::%I, $1)', tbl, cols, cols, tbl)
          using r;
      end loop;

    elsif kind = 'update' then
      select string_agg(format('%I = s.%I', key, key), ', ') into cols from jsonb_object_keys(op->'set') key;
      execute format('update %I t set %s from jsonb_populate_record(null::%I, $1) s where %s',
        tbl, cols, tbl, tn_where_sql(op->'where')) using op->'set';
      get diagnostics n = row_count;
      expect := coalesce((op->>'expect')::int, 1);
      if expect >= 0 and n <> expect then
        raise exception 'conflict: % % expected % row(s), matched %', kind, tbl, expect, n;
      end if;

    elsif kind = 'inc' then
      execute format('update %I t set %I = t.%I + $1 where %s', tbl, op->>'col', op->>'col', tn_where_sql(op->'where'))
        using (op->>'by')::bigint;
      get diagnostics n = row_count;
      expect := coalesce((op->>'expect')::int, 1);
      if expect >= 0 and n <> expect then
        raise exception 'conflict: % %.% expected % row(s), matched %', kind, tbl, op->>'col', expect, n;
      end if;

    elsif kind = 'delete' then
      execute format('delete from %I t where %s', tbl, tn_where_sql(op->'where'));
      get diagnostics n = row_count;
      expect := coalesce((op->>'expect')::int, -1);
      if expect >= 0 and n <> expect then
        raise exception 'conflict: delete % expected % row(s), matched %', tbl, expect, n;
      end if;

    elsif kind = 'ledger' then
      v_id := post_ledger_txn(op->>'kind', nullif(op->>'booking_id', '')::uuid, op->>'idempotency_key', op->'lines');
      txn_ids := txn_ids || to_jsonb(v_id);

    elsif kind = 'assert_slot_free' then
      -- Serialize bookings per tasker, then reject any overlapping active booking.
      perform pg_advisory_xact_lock(hashtext('tasker_slot:' || (op->>'tasker_id')));
      select count(*) into overlap from bookings b
       where b.tasker_id = (op->>'tasker_id')::uuid
         and b.status in ('requested', 'accepted', 'in_progress')
         and b.id::text is distinct from (op->>'exclude_booking_id')
         and tstzrange(b.start_at, b.start_at + make_interval(mins => b.est_minutes))
          && tstzrange((op->>'start_at')::timestamptz, (op->>'start_at')::timestamptz + make_interval(mins => (op->>'minutes')::int));
      if overlap > 0 then
        raise exception 'conflict: slot_taken: tasker already has a booking in that time slot';
      end if;

    elsif kind = 'lock' then
      perform pg_advisory_xact_lock(hashtext(op->>'key'));

    else
      raise exception 'invalid: unknown op %', kind;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'ledger_txn_ids', txn_ids);
end $$;

-- Only the API (service role) may call it (create or replace keeps the earlier grants; restated for clarity).
revoke execute on function tn_apply(jsonb) from public, anon, authenticated;
grant execute on function tn_apply(jsonb) to service_role;

-- ---------------------------------------------------------------------------------------------------------
-- integrity_violations: open = pending_payment, requested, accepted, in_progress
-- ---------------------------------------------------------------------------------------------------------
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
   where b.status not in ('pending_payment', 'requested', 'accepted', 'in_progress') and h.held <> 0
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
   where b.status in ('pending_payment', 'requested', 'accepted', 'in_progress') and coalesce(h.held, 0) <> coalesce(nc.amount, 0)
) v
where current_user not in ('anon', 'authenticated') or (select private.is_staff());

revoke all on public.integrity_violations from anon, public;
grant select on public.integrity_violations to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------
-- Statements (definer views filtered by auth.uid(); anon gets nothing)
-- ---------------------------------------------------------------------------------------------------------
-- What a client sees of a booking's ledger: the card, held-funds, points, wallet and credit lines.
create view public.booking_statement as
select t.booking_id, t.id as txn_id, t.kind, t.created_at,
       l.account, l.unit, l.debit, l.credit, l.party
  from public.ledger_txns t
  join public.ledger_lines l on l.txn_id = t.id
  join public.bookings b on b.id = t.booking_id
 where (
         (b.client_id = (select auth.uid())
          and l.account in ('card_clearing','client_funds_held','points_liability','wallet_liability',
                            'promo_expense','points_outstanding'))
         or (select private.is_staff())
       );

-- A tasker's own payable lines (earnings, clawbacks, strike fees, payouts) with what caused them.
create view public.tasker_statement as
select l.party as tasker_id, t.booking_id, t.id as txn_id, t.kind, t.created_at,
       l.debit, l.credit, (l.credit - l.debit)::bigint as net_cents
  from public.ledger_lines l
  join public.ledger_txns t on t.id = l.txn_id
 where l.account = 'tasker_payable' and l.unit = 'USD'
   and (l.party = (select auth.uid()) or (select private.is_staff()));

revoke all on public.booking_statement, public.tasker_statement from public, anon, authenticated;
grant select on public.booking_statement, public.tasker_statement to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------
-- Reconciliation: card money per booking, ledger vs Stripe (staff only through RLS on both sources)
-- ---------------------------------------------------------------------------------------------------------
-- ledger_card_cents: net debit on card_clearing (card money in, less refunds, fees and disputes).
-- stripe_net_cents:  sum of balance-transaction net (amount - fee) we stored for the booking.
-- Only bookings with at least one stored balance transaction are listed. drift_cents <> 0 needs a look.
create view public.reconciliation_by_booking with (security_invoker = true) as
select b.id as booking_id,
       coalesce(lg.card_cents, 0)::bigint as ledger_card_cents,
       bt.net_cents::bigint as stripe_net_cents,
       (coalesce(lg.card_cents, 0) - bt.net_cents)::bigint as drift_cents
  from public.bookings b
  join (select booking_id, sum(net_cents)::bigint as net_cents
          from public.stripe_balance_transactions
         where booking_id is not null group by booking_id) bt on bt.booking_id = b.id
  left join (select t.booking_id, sum(l.debit - l.credit)::bigint as card_cents
               from public.ledger_lines l join public.ledger_txns t on t.id = l.txn_id
              where l.account = 'card_clearing' and l.unit = 'USD' and t.booking_id is not null
              group by t.booking_id) lg on lg.booking_id = b.id;

revoke all on public.reconciliation_by_booking from public, anon;
grant select on public.reconciliation_by_booking to authenticated, service_role;
