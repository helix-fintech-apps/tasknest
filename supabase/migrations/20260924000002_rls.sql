-- Row-level security. Reads are scoped to the user; all money writes go through the `api`
-- Edge Function using the service role, never directly from the browser.

alter table profiles enable row level security;
alter table taskers enable row level security;
alter table tasker_strikes enable row level security;
alter table bookings enable row level security;
alter table booking_tenders enable row level security;
alter table refunds enable row level security;
alter table tips enable row level security;
alter table disputes enable row level security;
alter table points_lots enable row level security;
alter table points_movements enable row level security;
alter table promo_codes enable row level security;
alter table promo_redemptions enable row level security;
alter table payouts enable row level security;
alter table reviews enable row level security;
alter table ledger_txns enable row level security;
alter table ledger_lines enable row level security;
alter table audit_log enable row level security;
alter table stripe_events enable row level security;
alter table money_policies enable row level security;

create or replace function is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('admin','support_agent'));
$$;

create policy "own profile" on profiles for select using (id = auth.uid() or is_staff());
create policy "update own profile" on profiles for update using (id = auth.uid()) with check (id = auth.uid());
-- Users can change their name and time zone, never their role.
revoke update on profiles from authenticated;
grant update (full_name, home_tz) on profiles to authenticated;
create policy "active taskers are public" on taskers for select using (status = 'active' or id = auth.uid() or is_staff());
create policy "policies are public" on money_policies for select using (true);
create policy "promo codes readable" on promo_codes for select using (auth.uid() is not null);

create policy "bookings: parties and staff" on bookings for select
  using (client_id = auth.uid() or tasker_id = auth.uid() or is_staff());
create policy "tenders: parties and staff" on booking_tenders for select
  using (exists (select 1 from bookings b where b.id = booking_id and (b.client_id = auth.uid() or b.tasker_id = auth.uid())) or is_staff());
create policy "refunds: parties and staff" on refunds for select
  using (exists (select 1 from bookings b where b.id = booking_id and (b.client_id = auth.uid() or b.tasker_id = auth.uid())) or is_staff());
create policy "tips: parties and staff" on tips for select
  using (exists (select 1 from bookings b where b.id = booking_id and (b.client_id = auth.uid() or b.tasker_id = auth.uid())) or is_staff());
create policy "disputes: staff" on disputes for select using (is_staff());
create policy "reviews: public" on reviews for select using (true);
create policy "points: own" on points_lots for select using (user_id = auth.uid() or is_staff());
create policy "points movements: own" on points_movements for select using (user_id = auth.uid() or is_staff());
create policy "promo redemptions: own" on promo_redemptions for select using (user_id = auth.uid() or is_staff());
create policy "payouts: own" on payouts for select using (tasker_id = auth.uid() or is_staff());
create policy "strikes: own" on tasker_strikes for select using (tasker_id = auth.uid() or is_staff());
create policy "ledger: staff" on ledger_txns for select using (is_staff());
create policy "ledger lines: staff" on ledger_lines for select using (is_staff());
create policy "audit: staff" on audit_log for select using (is_staff());

-- New auth users get a profile row.
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''),
          case when new.raw_user_meta_data->>'role' = 'tasker' then 'tasker'::user_role else 'client'::user_role end);
  -- Staff roles are only granted by an admin, never at signup.
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();
