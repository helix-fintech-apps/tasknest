-- Concurrency control and policy publishing for the `api` Edge Function (service role only).
--
-- op_locks: short leases that serialize money operations across Edge Function instances
-- (per booking, per client's points, per tasker payout). A lease covers the whole request,
-- including the payment provider call that happens before the database transaction, so two
-- concurrent refunds / tips / payouts can never both pass their checks and both move money.
-- Leases expire on their own (TTL), so a crashed request cannot block a booking for long.
--
-- publish_money_policy(): the only way to add a money policy version. Versions are sequential,
-- never retroactive (effective_from >= now()), and every publish is audited.

create table public.op_locks (
  key text primary key,
  token uuid not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.op_locks enable row level security;
-- No policies: only the service role (which bypasses RLS) touches this table.
revoke all on public.op_locks from anon, authenticated;

create or replace function public.acquire_op_lock(p_key text, p_token uuid, p_ttl_seconds int default 60)
returns boolean language plpgsql security invoker set search_path = public as $$
begin
  if p_ttl_seconds < 1 or p_ttl_seconds > 300 then
    raise exception 'invalid: lock ttl must be between 1 and 300 seconds';
  end if;
  insert into op_locks as l (key, token, expires_at)
  values (p_key, p_token, clock_timestamp() + make_interval(secs => p_ttl_seconds))
  on conflict (key) do update
    set token = excluded.token, acquired_at = clock_timestamp(), expires_at = excluded.expires_at
    where l.expires_at < clock_timestamp() or l.token = excluded.token;
  return found;
end $$;

create or replace function public.release_op_lock(p_key text, p_token uuid)
returns void language sql security invoker set search_path = public as $$
  delete from op_locks where key = p_key and token = p_token;
$$;

create or replace function public.publish_money_policy(p_policy jsonb, p_effective_from timestamptz, p_actor uuid, p_reason text)
returns int language plpgsql security invoker set search_path = public as $$
declare
  v int;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'invalid: a reason is required to publish a money policy';
  end if;
  if p_effective_from < now() then
    raise exception 'invalid: effective_from must not be in the past (policies never apply retroactively)';
  end if;
  if jsonb_typeof(p_policy) <> 'object' then
    raise exception 'invalid: policy must be a JSON object';
  end if;
  lock table money_policies in share row exclusive mode;
  select coalesce(max(version), 0) + 1 into v from money_policies;
  insert into money_policies (version, policy, effective_from)
  values (v, jsonb_set(p_policy, '{version}', to_jsonb(v)), p_effective_from);
  insert into audit_log (actor_id, action, entity, entity_id, reason, data)
  values (p_actor, 'policy_published', 'money_policy', v::text, p_reason,
          jsonb_build_object('effective_from', p_effective_from));
  return v;
end $$;

revoke execute on function public.acquire_op_lock(text, uuid, int) from public, anon, authenticated;
revoke execute on function public.release_op_lock(text, uuid) from public, anon, authenticated;
revoke execute on function public.publish_money_policy(jsonb, timestamptz, uuid, text) from public, anon, authenticated;
grant execute on function public.acquire_op_lock(text, uuid, int) to service_role;
grant execute on function public.release_op_lock(text, uuid) to service_role;
grant execute on function public.publish_money_policy(jsonb, timestamptz, uuid, text) to service_role;
