-- Marketplace + Stripe schema contract (docs/contracts.md 4.1). Wave 0 / WS7-a.
--
-- Adds every table, column and constraint the marketplace workstreams (WS1..WS7) build on. NO behaviour
-- uses them yet: every new column is nullable or defaulted, every new table is empty, and the existing
-- tables keep their current constraints (bookings_no_double_slot only gains a status that nothing writes).
-- Views are NOT created here; each is created by the migration of the workstream that owns it.
--
-- Conventions (same as the earlier migrations): money is bigint cents; every new table has row level
-- security enabled with explicit policies named per role; policies use (select auth.uid()) and
-- (select private.is_staff()); tables written only by the `api` Edge Function (service role) have no write
-- policies and their write privileges are revoked from anon/authenticated.

-- ---------------------------------------------------------------------------------------------------
-- bookings: payment plan and state, address, hold bookkeeping
-- ---------------------------------------------------------------------------------------------------
-- A slot stays held while 3DS completes ('pending_payment'). Recreated here (not in the enum migration)
-- because it needs the committed enum value.
drop index public.bookings_no_double_slot;
create unique index bookings_no_double_slot on public.bookings (tasker_id, start_at)
  where status in ('pending_payment','requested','accepted','in_progress');

alter table public.bookings
  add column category_slug text,
  add column address_id uuid,
  add column payment_plan text
    constraint bookings_payment_plan_check
    check (payment_plan in ('hold_now','save_card_hold_later','card_not_needed')),
  add column payment_state text not null default 'none'
    constraint bookings_payment_state_check
    check (payment_state in ('none','requires_action','card_saved','hold_active','action_required',
                             'hold_expired','captured','released','failed')),
  add column hold_at timestamptz,
  add column capture_before timestamptz,      -- replaces the computed auth_expires_at for new bookings
  add column stripe_charge_id text,
  add column stripe_customer_id text,
  add column payment_method_id text,
  add column setup_intent_id text,
  add column payment_expires_at timestamptz;  -- pending_payment TTL (created_at + 30 min)

-- ---------------------------------------------------------------------------------------------------
-- profiles / taskers
-- ---------------------------------------------------------------------------------------------------
-- The column-level UPDATE grant on profiles stays (full_name, home_tz): users cannot write these; the API does.
alter table public.profiles
  add column stripe_customer_id text,
  add column default_payment_method_id text;
create unique index profiles_stripe_customer_id_key on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

alter table public.taskers
  add column bio text,
  add column avatar_url text,
  add column skills jsonb not null default '[]'::jsonb,
  add column service_zips text[] not null default '{}',
  add column transfers_capability text,
  add column payouts_enabled boolean not null default false,
  add column details_submitted boolean not null default false,
  add column requirements_due jsonb not null default '[]'::jsonb,
  add column disabled_reason text,
  add column onboarding_completed_at timestamptz;

-- Connect readiness (requirements, disabled reason, capability state) is for the tasker and staff, served by
-- the API. Taskers are readable by everyone, so read access moves to an explicit column list: the columns
-- that were readable before plus the public profile columns. Explicit selects keep working; `select *` on
-- taskers no longer does (the frontend and tests already list their columns).
revoke select on public.taskers from anon, authenticated;
grant select (id, headline, category, hourly_rate_cents, status, stripe_account_id, kyc_verified_at,
              suspended_at, created_at, display_name, bio, avatar_url, skills, service_zips)
  on public.taskers to anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- refunds / tips / disputes / stripe_events
-- ---------------------------------------------------------------------------------------------------
alter table public.refunds
  add column provider_refund_id text,
  add column provider_status text
    constraint refunds_provider_status_check
    check (provider_status in ('pending','succeeded','failed','canceled','requires_action')),
  add column failure_reason text,
  add column payment_intent_id text;

alter table public.tips
  add column stripe_charge_id text,
  add column refunded_cents bigint not null default 0
    constraint tips_refunded_le_amount check (refunded_cents >= 0 and refunded_cents <= amount_cents);

-- Stripe's dispute statuses. The two values used so far (needs_response, under_review) are kept.
-- disputes.fee_cents already exists (the dispute fee actually charged).
alter table public.disputes drop constraint disputes_status_check;
alter table public.disputes
  add constraint disputes_status_check
  check (status in ('warning_needs_response','warning_under_review','warning_closed','needs_response',
                    'under_review','won','lost','prevented')),
  add column is_inquiry boolean not null default false,
  add column countered_fee_cents bigint not null default 0,
  add column evidence_due_by timestamptz,
  add column evidence_submitted_at timestamptz,
  add column payment_intent_id text;

-- payouts is kept as is: one row per payout run per tasker. status 'paid' means "transfers created"
-- (the UI says "Sent to payout account"); the bank leg is tracked in connected_payouts.
comment on column public.payouts.status is
  'paid = transfers created (UI: "Sent to payout account"). The bank payout is connected_payouts.';

alter table public.stripe_events
  add column payload jsonb,
  add column livemode boolean,
  add column api_version text,
  add column account text,
  add column scope text
    constraint stripe_events_scope_check check (scope in ('platform','connect','simulated')),
  add column processed_at timestamptz,
  add column attempts int not null default 0,
  add column last_error text;

-- ---------------------------------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------------------------------
create table public.payment_intents (
  id text primary key,                         -- pi_... or sim_pi_...
  booking_id uuid not null references public.bookings(id),
  kind text not null check (kind in ('hold','rehold','extras','tip','fee')),
  amount_cents bigint not null check (amount_cents > 0),
  status text not null,
  charge_id text,
  capture_before timestamptz,
  created_at timestamptz not null default now()
);
create index payment_intents_booking_id_idx on public.payment_intents (booking_id);
alter table public.payment_intents enable row level security;
revoke insert, update, delete, truncate on public.payment_intents from anon, authenticated;
create policy "payment intents: client and staff" on public.payment_intents for select to authenticated
  using (
    exists (select 1 from public.bookings b where b.id = booking_id and b.client_id = (select auth.uid()))
    or (select private.is_staff())
  );

create table public.card_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  payment_method_id text not null,
  booking_id uuid references public.bookings(id),
  text_version text not null,
  text_sha256 text not null,
  created_at timestamptz not null default now()
);
create index card_consents_user_id_idx on public.card_consents (user_id);
create index card_consents_booking_id_idx on public.card_consents (booking_id);
alter table public.card_consents enable row level security;
revoke insert, update, delete, truncate on public.card_consents from anon, authenticated;
create policy "card consents: own and staff" on public.card_consents for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_staff()));

create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references public.payouts(id),
  booking_id uuid not null references public.bookings(id),
  stripe_transfer_id text,
  source_transaction text,                     -- ch_... funding this transfer, when it has one
  transfer_group text,
  amount_cents bigint not null check (amount_cents > 0),
  reversed_cents bigint not null default 0,
  status text not null default 'pending' check (status in ('pending','created','failed','reversed')),
  created_at timestamptz not null default now(),
  constraint transfers_reversed_le_amount check (reversed_cents >= 0 and reversed_cents <= amount_cents)
);
create index transfers_payout_id_idx on public.transfers (payout_id);
create index transfers_booking_id_idx on public.transfers (booking_id);
alter table public.transfers enable row level security;
revoke insert, update, delete, truncate on public.transfers from anon, authenticated;
create policy "transfers: own tasker and staff" on public.transfers for select to authenticated
  using (
    exists (select 1 from public.payouts p where p.id = payout_id and p.tasker_id = (select auth.uid()))
    or (select private.is_staff())
  );

create table public.connected_payouts (
  id text primary key,                         -- po_... or sim_po_...
  tasker_id uuid not null references public.taskers(id),
  amount_cents bigint not null check (amount_cents > 0),
  status text not null default 'pending'
    check (status in ('pending','in_transit','paid','failed','canceled')),
  arrival_date date,
  failure_code text,
  created_at timestamptz not null default now()
);
create index connected_payouts_tasker_id_idx on public.connected_payouts (tasker_id);
alter table public.connected_payouts enable row level security;
revoke insert, update, delete, truncate on public.connected_payouts from anon, authenticated;
create policy "connected payouts: own tasker and staff" on public.connected_payouts for select to authenticated
  using (tasker_id = (select auth.uid()) or (select private.is_staff()));

create table public.stripe_balance_transactions (
  id text primary key,                         -- txn_...
  source_id text,
  booking_id uuid references public.bookings(id),
  type text not null,
  amount_cents bigint not null,                -- signed: refunds and fees are negative
  fee_cents bigint not null default 0,
  net_cents bigint not null,
  available_on timestamptz,
  created_at timestamptz not null default now()
);
create index stripe_balance_transactions_booking_id_idx on public.stripe_balance_transactions (booking_id);
create index stripe_balance_transactions_source_id_idx on public.stripe_balance_transactions (source_id);
alter table public.stripe_balance_transactions enable row level security;
revoke insert, update, delete, truncate on public.stripe_balance_transactions from anon, authenticated;
create policy "balance transactions: staff" on public.stripe_balance_transactions for select to authenticated
  using ((select private.is_staff()));

-- ---------------------------------------------------------------------------------------------------
-- Discovery and booking inputs
-- ---------------------------------------------------------------------------------------------------
create table public.categories (
  slug text primary key,
  name text not null,
  icon text not null default '',
  sort int not null default 0,
  active boolean not null default true
);
alter table public.categories enable row level security;
revoke insert, update, delete, truncate on public.categories from anon, authenticated;
create policy "categories: active (anon)" on public.categories for select to anon
  using (active);
create policy "categories: active and staff" on public.categories for select to authenticated
  using (active or (select private.is_staff()));

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text not null default '',
  line1 text not null,
  line2 text,
  city text not null,
  state text not null,
  zip text not null,
  tz text not null default 'America/Los_Angeles',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index addresses_user_id_idx on public.addresses (user_id);
create unique index addresses_one_default_per_user on public.addresses (user_id) where is_default;
alter table public.addresses enable row level security;
revoke truncate on public.addresses from anon, authenticated;
revoke all on public.addresses from anon;
create policy "addresses: own read and staff" on public.addresses for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_staff()));
create policy "addresses: own insert" on public.addresses for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "addresses: own update" on public.addresses for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "addresses: own delete" on public.addresses for delete to authenticated
  using (user_id = (select auth.uid()));

-- bookings.address_id (added above) can now reference addresses.
alter table public.bookings
  add constraint bookings_address_id_fkey foreign key (address_id) references public.addresses(id);
create index bookings_address_id_idx on public.bookings (address_id);

create table public.tasker_availability (
  id bigint generated always as identity primary key,
  tasker_id uuid not null references public.taskers(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),   -- 0 = Sunday
  start_minute int not null check (start_minute >= 0 and start_minute < 1440),
  end_minute int not null check (end_minute > 0 and end_minute <= 1440),
  constraint tasker_availability_range check (end_minute > start_minute)
);
create index tasker_availability_tasker_id_idx on public.tasker_availability (tasker_id);
alter table public.tasker_availability enable row level security;
revoke insert, update, delete, truncate on public.tasker_availability from anon, authenticated;
create policy "availability: active taskers (anon)" on public.tasker_availability for select to anon
  using (exists (select 1 from public.taskers t where t.id = tasker_id and t.status = 'active'));
create policy "availability: active, own and staff" on public.tasker_availability for select to authenticated
  using (
    exists (select 1 from public.taskers t where t.id = tasker_id and t.status = 'active')
    or tasker_id = (select auth.uid())
    or (select private.is_staff())
  );

create table public.tasker_availability_overrides (
  id bigint generated always as identity primary key,
  tasker_id uuid not null references public.taskers(id) on delete cascade,
  date date not null,
  kind text not null check (kind in ('block','add')),
  start_minute int not null check (start_minute >= 0 and start_minute < 1440),
  end_minute int not null check (end_minute > 0 and end_minute <= 1440),
  constraint tasker_availability_overrides_range check (end_minute > start_minute)
);
create index tasker_availability_overrides_tasker_id_idx
  on public.tasker_availability_overrides (tasker_id, date);
alter table public.tasker_availability_overrides enable row level security;
revoke insert, update, delete, truncate on public.tasker_availability_overrides from anon, authenticated;
create policy "availability overrides: active taskers (anon)" on public.tasker_availability_overrides
  for select to anon
  using (exists (select 1 from public.taskers t where t.id = tasker_id and t.status = 'active'));
create policy "availability overrides: active, own and staff" on public.tasker_availability_overrides
  for select to authenticated
  using (
    exists (select 1 from public.taskers t where t.id = tasker_id and t.status = 'active')
    or tasker_id = (select auth.uid())
    or (select private.is_staff())
  );

-- ---------------------------------------------------------------------------------------------------
-- Notifications and messages
-- ---------------------------------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  booking_id uuid references public.bookings(id),
  title text not null,
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_id_idx on public.notifications (user_id, created_at desc);
create index notifications_booking_id_idx on public.notifications (booking_id);
alter table public.notifications enable row level security;
revoke insert, update, delete, truncate on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;     -- users may only mark their own as read
create policy "notifications: own read" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "notifications: own mark read" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id),
  sender_id uuid references public.profiles(id),
  body text not null check (char_length(body) between 1 and 2000),
  system boolean not null default false,
  created_at timestamptz not null default now()
);
create index messages_booking_id_idx on public.messages (booking_id, created_at);
create index messages_sender_id_idx on public.messages (sender_id);
alter table public.messages enable row level security;
revoke update, delete, truncate on public.messages from anon, authenticated;
revoke all on public.messages from anon;
create policy "messages: parties and staff read" on public.messages for select to authenticated
  using (
    exists (select 1 from public.bookings b where b.id = booking_id
              and (b.client_id = (select auth.uid()) or b.tasker_id = (select auth.uid())))
    or (select private.is_staff())
  );
create policy "messages: parties insert" on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid()) and not system
    and exists (select 1 from public.bookings b where b.id = booking_id
                  and (b.client_id = (select auth.uid()) or b.tasker_id = (select auth.uid())))
  );

-- ---------------------------------------------------------------------------------------------------
-- Support and refund approvals
-- ---------------------------------------------------------------------------------------------------
create table public.support_requests (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id),
  requester_id uuid not null references public.profiles(id),
  kind text not null check (kind in ('no_show','work_problem','charge_wrong','damage_safety','refund_request','other')),
  status text not null default 'open' check (status in ('open','waiting_on_customer','resolved')),
  assignee_id uuid references public.profiles(id),
  amount_at_stake_cents bigint not null default 0 check (amount_at_stake_cents >= 0),
  due_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index support_requests_booking_id_idx on public.support_requests (booking_id);
create index support_requests_requester_id_idx on public.support_requests (requester_id);
create index support_requests_assignee_id_idx on public.support_requests (assignee_id);
create index support_requests_status_due_idx on public.support_requests (status, due_at);
alter table public.support_requests enable row level security;
revoke insert, update, delete, truncate on public.support_requests from anon, authenticated;
create policy "support requests: requester and staff" on public.support_requests for select to authenticated
  using (requester_id = (select auth.uid()) or (select private.is_staff()));

create table public.support_replies (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.support_requests(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null check (length(trim(body)) > 0),
  internal boolean not null default false,
  created_at timestamptz not null default now()
);
create index support_replies_request_id_idx on public.support_replies (request_id, created_at);
create index support_replies_author_id_idx on public.support_replies (author_id);
alter table public.support_replies enable row level security;
revoke insert, update, delete, truncate on public.support_replies from anon, authenticated;
create policy "support replies: public part to requester, all to staff" on public.support_replies
  for select to authenticated
  using (
    (select private.is_staff())
    or (not internal and exists (select 1 from public.support_requests r
                                  where r.id = request_id and r.requester_id = (select auth.uid())))
  );

create table public.refund_approvals (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id),
  requested_by uuid not null references public.profiles(id),
  kind text not null,
  amount_cents bigint not null check (amount_cents > 0),
  reason text not null check (length(trim(reason)) > 0),
  preview jsonb not null,                       -- the server preview shown to the approver, frozen
  status text not null default 'pending' check (status in ('pending','approved','rejected','executed')),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  -- The approver must not be the requester (the API checks too; this makes it impossible to bypass).
  constraint refund_approvals_distinct_approver check (decided_by is null or decided_by <> requested_by)
);
create index refund_approvals_booking_id_idx on public.refund_approvals (booking_id);
create index refund_approvals_requested_by_idx on public.refund_approvals (requested_by);
create index refund_approvals_decided_by_idx on public.refund_approvals (decided_by);
alter table public.refund_approvals enable row level security;
revoke insert, update, delete, truncate on public.refund_approvals from anon, authenticated;
create policy "refund approvals: staff" on public.refund_approvals for select to authenticated
  using ((select private.is_staff()));
