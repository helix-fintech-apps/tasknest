-- TaskNest database invariants, run by the `db` CI job after all migrations are applied.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/ci/db_checks.sql
--
-- Every check raises an exception on failure, so psql exits non-zero and the job fails.
-- All fixtures are created inside one transaction that is rolled back at the end: the
-- script leaves the database exactly as it found it and is safe to re-run.

\set ON_ERROR_STOP on
\pset pager off
set client_min_messages = notice;

begin;

-- ---------------------------------------------------------------------------
-- 1. RLS is enabled on every table in the public schema.
-- ---------------------------------------------------------------------------
do $$
declare missing text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')          -- ordinary + partitioned tables (views are excluded)
    and not c.relrowsecurity;
  if missing is not null then
    raise exception 'FAIL rls_enabled: RLS is disabled on public tables: %', missing;
  end if;
  raise notice 'PASS rls_enabled: every public table has row level security enabled';
end $$;

-- ---------------------------------------------------------------------------
-- 2. No floating-point columns anywhere in public (money is integer cents).
-- ---------------------------------------------------------------------------
do $$
declare bad text;
begin
  select string_agg(format('%s.%s (%s)', table_name, column_name, data_type), ', ') into bad
  from information_schema.columns
  where table_schema = 'public'
    and data_type in ('real', 'double precision', 'money');
  if bad is not null then
    raise exception 'FAIL no_float_money: floating-point/money-type columns found: %', bad;
  end if;
  raise notice 'PASS no_float_money: no real/double precision/money columns in public';
end $$;

-- ---------------------------------------------------------------------------
-- 3. The objects the behavioural checks rely on exist (clear failure if renamed).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'ledger_balanced'
                 and tgrelid = 'public.ledger_lines'::regclass and tgdeferrable) then
    raise exception 'FAIL ledger_trigger_exists: deferrable constraint trigger ledger_balanced on ledger_lines is missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'refund_le_paid'
                 and conrelid = 'public.booking_tenders'::regclass and contype = 'c') then
    raise exception 'FAIL refund_le_paid_exists: check constraint refund_le_paid on booking_tenders is missing';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public'
                 and indexname = 'bookings_no_double_slot' and indexdef ilike 'create unique index%') then
    raise exception 'FAIL no_double_slot_exists: unique index bookings_no_double_slot is missing';
  end if;
  raise notice 'PASS schema_objects: ledger_balanced trigger, refund_le_paid, bookings_no_double_slot exist';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Ledger trigger rejects an unbalanced transaction and accepts a balanced one.
--    The trigger is DEFERRABLE INITIALLY DEFERRED, so we force it to fire with
--    SET CONSTRAINTS ... IMMEDIATE inside a sub-block.
-- ---------------------------------------------------------------------------
do $$
declare t uuid; msg text;
begin
  -- Unbalanced USD txn: 100 debit, 99 credit.
  begin
    insert into ledger_txns (kind, idempotency_key) values ('ci_check_unbalanced', 'ci-unbalanced')
      returning id into t;
    insert into ledger_lines (txn_id, account, unit, debit, credit) values
      (t, 'client_receivable', 'USD', 100, 0),
      (t, 'tasker_payable',    'USD', 0,  99);
    set constraints ledger_balanced immediate;
    raise exception 'FAIL ledger_unbalanced: unbalanced txn % was accepted', t;
  exception
    when raise_exception then
      get stacked diagnostics msg = message_text;
      if msg like 'FAIL%' or msg not ilike '%unbalanced%' then
        raise exception '%', case when msg like 'FAIL%' then msg
          else 'FAIL ledger_unbalanced: unexpected error: ' || msg end;
      end if;
  end;
  set constraints ledger_balanced deferred;

  -- Balanced per unit but mixing units must still be rejected (USD and POINTS never net).
  begin
    insert into ledger_txns (kind, idempotency_key) values ('ci_check_mixed_units', 'ci-mixed')
      returning id into t;
    insert into ledger_lines (txn_id, account, unit, debit, credit) values
      (t, 'client_receivable', 'USD',    100, 0),
      (t, 'points_liability',  'POINTS', 0,   100);
    set constraints ledger_balanced immediate;
    raise exception 'FAIL ledger_mixed_units: txn % netting USD against POINTS was accepted', t;
  exception
    when raise_exception then
      get stacked diagnostics msg = message_text;
      if msg like 'FAIL%' or msg not ilike '%unbalanced%' then
        raise exception '%', case when msg like 'FAIL%' then msg
          else 'FAIL ledger_mixed_units: unexpected error: ' || msg end;
      end if;
  end;
  set constraints ledger_balanced deferred;

  -- Balanced txn is accepted.
  insert into ledger_txns (kind, idempotency_key) values ('ci_check_balanced', 'ci-balanced')
    returning id into t;
  insert into ledger_lines (txn_id, account, unit, debit, credit) values
    (t, 'client_receivable', 'USD', 4500, 0),
    (t, 'tasker_payable',    'USD', 0, 3825),
    (t, 'platform_revenue',  'USD', 0,  675);
  set constraints ledger_balanced immediate;
  set constraints ledger_balanced deferred;

  raise notice 'PASS ledger_balanced: unbalanced and mixed-unit txns rejected, balanced txn accepted';
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures for the booking checks: one client, one active tasker (via auth.users so
-- the handle_new_user trigger creates profiles exactly as production does).
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000c1c1', 'ci-client@tasknest.test', '{"role":"client"}'),
  ('00000000-0000-4000-8000-00000000c2c2', 'ci-tasker@tasknest.test', '{"role":"tasker"}');

insert into profiles (id, role)
  values ('00000000-0000-4000-8000-00000000c1c1', 'client'),
         ('00000000-0000-4000-8000-00000000c2c2', 'tasker')
  on conflict (id) do nothing;

insert into taskers (id, category, hourly_rate_cents, status)
  values ('00000000-0000-4000-8000-00000000c2c2', 'Handyman', 4500, 'active');

-- ---------------------------------------------------------------------------
-- 5. refund_le_paid: a tender can never be refunded more than it paid.
-- ---------------------------------------------------------------------------
do $$
declare b uuid; cname text;
begin
  insert into bookings (client_id, tasker_id, policy_version, status, location_tz, start_at,
                        original_start_at, est_minutes, rate_cents, subtotal_cents,
                        service_fee_cents, tax_cents, total_cents)
  values ('00000000-0000-4000-8000-00000000c1c1', '00000000-0000-4000-8000-00000000c2c2',
          (select min(version) from money_policies), 'completed', 'America/Los_Angeles',
          '2030-01-14 17:00:00+00', '2030-01-14 17:00:00+00', 60, 4500, 4500, 675, 0, 5175)
  returning id into b;

  insert into booking_tenders (booking_id, tender, amount_cents, refunded_cents)
    values (b, 'card', 5175, 0);

  -- Refunding exactly what was paid is allowed.
  update booking_tenders set refunded_cents = 5175 where booking_id = b and tender = 'card';

  -- One cent more is not.
  begin
    update booking_tenders set refunded_cents = 5176 where booking_id = b and tender = 'card';
    raise exception 'FAIL refund_le_paid: refunded_cents 5176 > amount_cents 5175 was accepted';
  exception
    when check_violation then
      get stacked diagnostics cname = constraint_name;
      if cname is distinct from 'refund_le_paid' then
        raise exception 'FAIL refund_le_paid: expected refund_le_paid, got constraint %', cname;
      end if;
  end;

  -- Same rule on insert.
  begin
    insert into booking_tenders (booking_id, tender, amount_cents, refunded_cents)
      values (b, 'wallet', 100, 101);
    raise exception 'FAIL refund_le_paid: inserting refunded 101 > paid 100 was accepted';
  exception
    when check_violation then
      get stacked diagnostics cname = constraint_name;
      if cname is distinct from 'refund_le_paid' then
        raise exception 'FAIL refund_le_paid: expected refund_le_paid, got constraint %', cname;
      end if;
  end;

  raise notice 'PASS refund_le_paid: over-refund rejected on update and insert, full refund allowed';
end $$;

-- ---------------------------------------------------------------------------
-- 6. bookings_no_double_slot: a tasker cannot hold two active bookings at the same
--    start time, but a canceled/declined booking frees the slot.
-- ---------------------------------------------------------------------------
do $$
declare iname text;
begin
  insert into bookings (client_id, tasker_id, policy_version, status, location_tz, start_at,
                        original_start_at, est_minutes, rate_cents, subtotal_cents,
                        service_fee_cents, tax_cents, total_cents)
  values ('00000000-0000-4000-8000-00000000c1c1', '00000000-0000-4000-8000-00000000c2c2',
          (select min(version) from money_policies), 'accepted', 'America/Los_Angeles',
          '2030-01-15 17:00:00+00', '2030-01-15 17:00:00+00', 60, 4500, 4500, 675, 0, 5175);

  begin
    insert into bookings (client_id, tasker_id, policy_version, status, location_tz, start_at,
                          original_start_at, est_minutes, rate_cents, subtotal_cents,
                          service_fee_cents, tax_cents, total_cents)
    values ('00000000-0000-4000-8000-00000000c1c1', '00000000-0000-4000-8000-00000000c2c2',
            (select min(version) from money_policies), 'requested', 'America/Los_Angeles',
            '2030-01-15 17:00:00+00', '2030-01-15 17:00:00+00', 60, 4500, 4500, 675, 0, 5175);
    raise exception 'FAIL no_double_slot: second active booking for the same tasker + start_at was accepted';
  exception
    when unique_violation then
      get stacked diagnostics iname = constraint_name;
      if iname is distinct from 'bookings_no_double_slot' then
        raise exception 'FAIL no_double_slot: expected bookings_no_double_slot, got %', iname;
      end if;
  end;

  -- Inactive bookings in the same slot are fine (history is kept).
  insert into bookings (client_id, tasker_id, policy_version, status, location_tz, start_at,
                        original_start_at, est_minutes, rate_cents, subtotal_cents,
                        service_fee_cents, tax_cents, total_cents)
  values ('00000000-0000-4000-8000-00000000c1c1', '00000000-0000-4000-8000-00000000c2c2',
          (select min(version) from money_policies), 'canceled_client', 'America/Los_Angeles',
          '2030-01-15 17:00:00+00', '2030-01-15 17:00:00+00', 60, 4500, 4500, 675, 0, 5175);

  raise notice 'PASS no_double_slot: double-booking rejected, canceled booking in same slot allowed';
end $$;

-- Leave no trace.
rollback;

\echo 'All database invariant checks passed.'
