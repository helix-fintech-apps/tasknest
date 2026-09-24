-- Backend support for the `api` Edge Function:
--   * idempotency_keys: Idempotency-Key replay store
--   * extra booking columns for capture / extras / provider refunds
--   * points "debt" lots so clawbacks can take a user's balance negative
--   * post_ledger_txn(): balanced ledger insert (one txn + its lines)
--   * tn_apply(): atomic unit of work. The API computes everything with the shared domain code,
--     then sends a list of whitelisted row operations that run in ONE database transaction
--     (PostgREST wraps each RPC call in a transaction; any error rolls everything back, and the
--     deferred ledger_balanced trigger re-checks every ledger txn at commit).

-- ---------------------------------------------------------------------------------------------
create table idempotency_keys (
  user_id uuid not null,
  key text not null,
  method text not null,
  path text not null,
  request_hash text not null,
  status text not null default 'in_progress' check (status in ('in_progress', 'done')),
  response_status int,
  response_body jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table idempotency_keys enable row level security;
create policy "idempotency: staff" on idempotency_keys for select using (private.is_staff());

-- ---------------------------------------------------------------------------------------------
alter table bookings
  add column started_at timestamptz,
  add column captured_cents bigint not null default 0,            -- captured on the booking's main card PI
  add column extra_labor_cents bigint not null default 0,
  add column extra_service_fee_cents bigint not null default 0,
  add column extra_tax_cents bigint not null default 0,
  add column expenses_cents bigint not null default 0,
  add column extra_payment_intent_id text,
  add column provider_refunded_cents bigint not null default 0,   -- card refunded at the provider (main PI first, then extras PI)
  add constraint extra_adds_up check (extra_cents = extra_labor_cents + extra_service_fee_cents + extra_tax_cents + expenses_cents);

-- ---------------------------------------------------------------------------------------------
-- A "debt" lot carries a negative balance created by a clawback that exceeded what the user had.
-- It is always "available", so points_balances.available goes negative and redemptions are blocked.
alter table points_lots drop constraint if exists points_lots_kind_check;
alter table points_lots drop constraint if exists points_lots_points_remaining_check;
alter table points_lots add constraint points_lots_kind_check check (kind in ('earn', 'bonus', 'reissue', 'debt'));
alter table points_lots add constraint points_lots_points_remaining_check check (points_remaining >= 0 or kind = 'debt');
create index on points_lots (user_id);
create index on points_movements (booking_id);
create index on ledger_txns (booking_id);

-- ---------------------------------------------------------------------------------------------
create or replace function post_ledger_txn(p_kind text, p_booking_id uuid, p_idem_key text, p_lines jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
  bad record;
begin
  if p_idem_key is not null then
    select id into v_id from ledger_txns where idempotency_key = p_idem_key;
    if found then return v_id; end if;
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'invalid: ledger txn % has no lines', p_kind;
  end if;
  select l->>'unit' as unit, sum((l->>'debit')::bigint - (l->>'credit')::bigint) as net into bad
    from jsonb_array_elements(p_lines) l group by l->>'unit'
    having sum((l->>'debit')::bigint - (l->>'credit')::bigint) <> 0 limit 1;
  if found then
    raise exception 'invalid: ledger txn % unbalanced for % by %', p_kind, bad.unit, bad.net;
  end if;
  insert into ledger_txns (kind, booking_id, idempotency_key) values (p_kind, p_booking_id, p_idem_key)
    returning id into v_id;
  insert into ledger_lines (txn_id, account, party, unit, debit, credit)
  select v_id, l->>'account', nullif(l->>'party', '')::uuid, l->>'unit',
         (l->>'debit')::bigint, (l->>'credit')::bigint
    from jsonb_array_elements(p_lines) l;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------
create or replace function tn_where_sql(p_where jsonb) returns text
language plpgsql immutable set search_path = public as $$
declare
  k text; v jsonb; parts text[] := '{}';
begin
  if p_where is null or p_where = '{}'::jsonb then
    raise exception 'invalid: where clause required';
  end if;
  for k, v in select * from jsonb_each(p_where) loop
    if jsonb_typeof(v) = 'array' then
      parts := parts || format('t.%I::text in (select jsonb_array_elements_text(%L::jsonb))', k, v::text);
    elsif jsonb_typeof(v) = 'null' then
      parts := parts || format('t.%I is null', k);
    else
      parts := parts || format('t.%I::text = %L', k, v #>> '{}');
    end if;
  end loop;
  return array_to_string(parts, ' and ');
end $$;

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
    'stripe_events'];
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

-- Only the API (service role) may call these.
revoke execute on function post_ledger_txn(text, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function tn_apply(jsonb) from public, anon, authenticated;
revoke execute on function tn_where_sql(jsonb) from public, anon, authenticated;
grant execute on function post_ledger_txn(text, uuid, text, jsonb) to service_role;
grant execute on function tn_apply(jsonb) to service_role;
grant execute on function tn_where_sql(jsonb) to service_role;
