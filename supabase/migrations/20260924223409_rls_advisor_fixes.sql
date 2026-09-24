-- RLS and index fixes from the Supabase advisors (security + performance), plus one real bug:
--
-- * BUG: anonymous reads of `taskers` failed with "permission denied for function is_staff"
--   (20260924000004 revoked anon's EXECUTE on private.is_staff(), but the policy still called it for
--   every role). anon now has its own policy that never calls is_staff().
-- * auth_rls_initplan: auth.uid() / private.is_staff() are wrapped in (select ...) so they are
--   evaluated once per statement instead of once per row.
-- * Every policy names its roles (anon only where the data is public).
-- * multiple_permissive_policies: ledger_lines had two SELECT policies; merged into one.
-- * disputes: the client and tasker of a booking may now read its disputes (was staff only).
-- * unindexed_foreign_keys: covering indexes for every foreign key.
-- Not fixable in SQL: "Leaked Password Protection Disabled" is an Auth setting (dashboard).

-- profiles ----------------------------------------------------------------------------------------
drop policy "own profile" on public.profiles;
create policy "profiles: own and staff" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_staff()));
drop policy "update own profile" on public.profiles;
create policy "profiles: update own" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- taskers -----------------------------------------------------------------------------------------
drop policy "active taskers are public" on public.taskers;
create policy "taskers: active (anon)" on public.taskers for select to anon
  using (status = 'active');
create policy "taskers: active, own and staff" on public.taskers for select to authenticated
  using (status = 'active' or id = (select auth.uid()) or (select private.is_staff()));

-- public reference data ------------------------------------------------------------------------------
drop policy "policies are public" on public.money_policies;
create policy "money policies: public" on public.money_policies for select to anon, authenticated
  using (true);
drop policy "promo codes readable" on public.promo_codes;
create policy "promo codes: signed-in users" on public.promo_codes for select to authenticated
  using (true);
drop policy "reviews: public" on public.reviews;
create policy "reviews: public" on public.reviews for select to anon, authenticated
  using (true);

-- bookings and their children --------------------------------------------------------------------
drop policy "bookings: parties and staff" on public.bookings;
create policy "bookings: parties and staff" on public.bookings for select to authenticated
  using (client_id = (select auth.uid()) or tasker_id = (select auth.uid()) or (select private.is_staff()));

drop policy "tenders: parties and staff" on public.booking_tenders;
create policy "tenders: parties and staff" on public.booking_tenders for select to authenticated
  using (
    exists (select 1 from public.bookings b where b.id = booking_id
              and (b.client_id = (select auth.uid()) or b.tasker_id = (select auth.uid())))
    or (select private.is_staff())
  );

drop policy "refunds: parties and staff" on public.refunds;
create policy "refunds: parties and staff" on public.refunds for select to authenticated
  using (
    exists (select 1 from public.bookings b where b.id = booking_id
              and (b.client_id = (select auth.uid()) or b.tasker_id = (select auth.uid())))
    or (select private.is_staff())
  );

drop policy "tips: parties and staff" on public.tips;
create policy "tips: parties and staff" on public.tips for select to authenticated
  using (
    exists (select 1 from public.bookings b where b.id = booking_id
              and (b.client_id = (select auth.uid()) or b.tasker_id = (select auth.uid())))
    or (select private.is_staff())
  );

drop policy "disputes: staff" on public.disputes;
create policy "disputes: parties and staff" on public.disputes for select to authenticated
  using (
    exists (select 1 from public.bookings b where b.id = booking_id
              and (b.client_id = (select auth.uid()) or b.tasker_id = (select auth.uid())))
    or (select private.is_staff())
  );

-- per-user data -------------------------------------------------------------------------------------
drop policy "points: own" on public.points_lots;
create policy "points lots: own and staff" on public.points_lots for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_staff()));
drop policy "points movements: own" on public.points_movements;
create policy "points movements: own and staff" on public.points_movements for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_staff()));
drop policy "promo redemptions: own" on public.promo_redemptions;
create policy "promo redemptions: own and staff" on public.promo_redemptions for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_staff()));
drop policy "payouts: own" on public.payouts;
create policy "payouts: own and staff" on public.payouts for select to authenticated
  using (tasker_id = (select auth.uid()) or (select private.is_staff()));
drop policy "strikes: own" on public.tasker_strikes;
create policy "strikes: own and staff" on public.tasker_strikes for select to authenticated
  using (tasker_id = (select auth.uid()) or (select private.is_staff()));

-- ledger and back-office data -------------------------------------------------------------------------
drop policy "ledger: staff" on public.ledger_txns;
create policy "ledger txns: staff" on public.ledger_txns for select to authenticated
  using ((select private.is_staff()));
drop policy "ledger lines: staff" on public.ledger_lines;
drop policy "ledger lines: own tasker payable" on public.ledger_lines;
create policy "ledger lines: staff and own tasker payable" on public.ledger_lines for select to authenticated
  using ((select private.is_staff()) or (account = 'tasker_payable' and party = (select auth.uid())));
drop policy "audit: staff" on public.audit_log;
create policy "audit log: staff" on public.audit_log for select to authenticated
  using ((select private.is_staff()));
drop policy "stripe events: staff" on public.stripe_events;
create policy "stripe events: staff" on public.stripe_events for select to authenticated
  using ((select private.is_staff()));
drop policy "idempotency: staff" on public.idempotency_keys;
create policy "idempotency keys: staff" on public.idempotency_keys for select to authenticated
  using ((select private.is_staff()));

-- covering indexes for foreign keys ------------------------------------------------------------------
create index if not exists bookings_policy_version_idx on public.bookings (policy_version);
create index if not exists disputes_booking_id_idx on public.disputes (booking_id);
create index if not exists payouts_tasker_id_idx on public.payouts (tasker_id);
create index if not exists points_lots_booking_id_idx on public.points_lots (booking_id);
create index if not exists points_movements_lot_id_idx on public.points_movements (lot_id);
create index if not exists points_movements_user_id_idx on public.points_movements (user_id);
create index if not exists promo_redemptions_booking_id_idx on public.promo_redemptions (booking_id);
create index if not exists promo_redemptions_user_id_idx on public.promo_redemptions (user_id);
create index if not exists refunds_actor_id_idx on public.refunds (actor_id);
create index if not exists refunds_approved_by_idx on public.refunds (approved_by);
create index if not exists refunds_booking_id_idx on public.refunds (booking_id);
create index if not exists tasker_strikes_tasker_id_created_at_idx on public.tasker_strikes (tasker_id, created_at);
create index if not exists tips_booking_id_idx on public.tips (booking_id);
