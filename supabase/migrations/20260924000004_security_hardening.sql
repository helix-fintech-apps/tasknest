-- Fixes from the Supabase security advisor.

-- 1. Views run with the querying user's permissions and RLS (not the view owner's).
alter view points_balances set (security_invoker = true);
alter view tasker_balances set (security_invoker = true);

-- Taskers need to read their own payable lines so `tasker_balances` works for them under RLS.
create policy "ledger lines: own tasker payable" on ledger_lines for select
  using (account = 'tasker_payable' and party = auth.uid());

-- 2. Pin search_path on the ledger balance trigger function.
alter function ledger_assert_balanced() set search_path = public;

-- 3. SECURITY DEFINER helpers must not be callable through /rest/v1/rpc.
--    Move them to a schema PostgREST does not expose. Policies/triggers reference them by OID,
--    so they keep working after the move.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

alter function public.is_staff() set schema private;
alter function private.is_staff() set search_path = public;
revoke execute on function private.is_staff() from public, anon;
grant execute on function private.is_staff() to authenticated, service_role;

alter function public.handle_new_user() set schema private;
revoke execute on function private.handle_new_user() from public, anon, authenticated;
-- GoTrue inserts into auth.users as supabase_auth_admin; keep the signup trigger working for it.
grant usage on schema private to supabase_auth_admin;
grant execute on function private.handle_new_user() to supabase_auth_admin;

-- 4. stripe_events is written only by the service role; staff may read it.
create policy "stripe events: staff" on stripe_events for select using (private.is_staff());
