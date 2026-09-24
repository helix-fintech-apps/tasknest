-- TaskNest core schema. All money is integer cents (bigint). Points are integers.

create type user_role as enum ('client', 'tasker', 'admin', 'support_agent');
create type tasker_status as enum ('pending', 'active', 'suspended');
create type booking_status as enum (
  'requested','accepted','in_progress','completed','canceled_client','canceled_tasker',
  'declined','no_show_client','no_show_tasker','disputed');
create type tender as enum ('card','points','wallet','promo');

-- Versioned money policy. Bookings snapshot the version they were created under.
create table money_policies (
  version int primary key,
  policy jsonb not null,
  effective_from timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'client',
  full_name text not null default '',
  home_tz text not null default 'America/Los_Angeles',
  created_at timestamptz not null default now()
);

create table taskers (
  id uuid primary key references profiles(id) on delete cascade,
  headline text not null default '',
  category text not null,
  hourly_rate_cents bigint not null check (hourly_rate_cents > 0),
  status tasker_status not null default 'pending',
  stripe_account_id text,
  kyc_verified_at timestamptz,
  suspended_at timestamptz,
  created_at timestamptz not null default now()
);

create table tasker_strikes (
  id bigserial primary key,
  tasker_id uuid not null references taskers(id),
  booking_id uuid,
  reason text not null,
  fee_cents bigint not null default 0,
  created_at timestamptz not null default now()
);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references profiles(id),
  tasker_id uuid not null references taskers(id),
  policy_version int not null references money_policies(version),
  status booking_status not null default 'requested',
  description text not null default '',
  location_tz text not null,
  start_at timestamptz not null,
  original_start_at timestamptz not null,          -- cancellation cutoff anchor (reschedules keep it)
  est_minutes int not null check (est_minutes > 0),
  rate_cents bigint not null,
  subtotal_cents bigint not null,
  service_fee_cents bigint not null,
  tax_cents bigint not null default 0,
  total_cents bigint not null,
  extra_cents bigint not null default 0,           -- extra hours/expenses charged at completion
  points_reserved int not null default 0,
  points_earned int not null default 0,
  promo_code text,
  stripe_payment_intent_id text,
  auth_expires_at timestamptz,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  completed_at timestamptz,
  canceled_at timestamptz,
  constraint total_adds_up check (total_cents = subtotal_cents + service_fee_cents + tax_cents)
);
create index on bookings (tasker_id, start_at);
create index on bookings (client_id);

-- One active booking per tasker per start time (prevents double-booking the same slot).
create unique index bookings_no_double_slot on bookings (tasker_id, start_at)
  where status in ('requested','accepted','in_progress');

-- What each tender paid and how much of it has been refunded.
create table booking_tenders (
  booking_id uuid not null references bookings(id) on delete cascade,
  tender tender not null,
  amount_cents bigint not null check (amount_cents >= 0),
  refunded_cents bigint not null default 0 check (refunded_cents >= 0),
  points int not null default 0,
  primary key (booking_id, tender),
  constraint refund_le_paid check (refunded_cents <= amount_cents)
);

create table refunds (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id),
  kind text not null check (kind in ('full','partial','goodwill','cancellation')),
  amount_cents bigint not null check (amount_cents > 0),
  per_tender jsonb not null,
  tasker_clawback_cents bigint not null default 0,
  actor_id uuid references profiles(id),
  actor_role text not null,
  approved_by uuid references profiles(id),
  reason text not null check (length(trim(reason)) > 0),
  idempotency_key text unique,
  created_at timestamptz not null default now()
);

create table tips (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id),
  amount_cents bigint not null check (amount_cents > 0),
  platform_fee_cents bigint not null default 0 check (platform_fee_cents = 0),
  stripe_payment_intent_id text,
  created_at timestamptz not null default now()
);

create table disputes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id),
  stripe_dispute_id text unique,
  amount_cents bigint not null,
  fee_cents bigint not null default 0,
  status text not null check (status in ('needs_response','under_review','won','lost')),
  recovered_from_tasker_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

-- Loyalty points lots (earned, bonus, reissued). Spending is tracked in points_movements.
create table points_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  kind text not null check (kind in ('earn','bonus','reissue')),
  booking_id uuid references bookings(id),
  points_initial int not null check (points_initial > 0),
  points_remaining int not null check (points_remaining >= 0),
  available_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table points_movements (
  id bigserial primary key,
  user_id uuid not null references profiles(id),
  booking_id uuid references bookings(id),
  lot_id uuid references points_lots(id),
  kind text not null check (kind in ('earn','bonus','reserve','release','redeem','return','clawback','expire','reissue')),
  points int not null,              -- signed: + adds to balance, - removes
  created_at timestamptz not null default now()
);

create table promo_codes (
  code text primary key,
  kind text not null check (kind in ('fixed','percent')),
  value int not null,
  first_task_only boolean not null default false,
  max_discount_cents bigint,
  expires_at timestamptz
);

create table promo_redemptions (
  code text not null references promo_codes(code),
  user_id uuid not null references profiles(id),
  booking_id uuid not null references bookings(id),
  discount_cents bigint not null,
  created_at timestamptz not null default now(),
  primary key (code, user_id)           -- one redemption per user per code
);

create table payouts (
  id uuid primary key default gen_random_uuid(),
  tasker_id uuid not null references taskers(id),
  amount_cents bigint not null check (amount_cents > 0),
  booking_ids uuid[] not null,
  stripe_transfer_id text,
  status text not null default 'pending' check (status in ('pending','paid','failed')),
  created_at timestamptz not null default now()
);

create table reviews (
  booking_id uuid primary key references bookings(id),
  rating int not null check (rating between 1 and 5),
  body text not null default '',
  created_at timestamptz not null default now()
);

-- Double-entry ledger.
create table ledger_txns (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  booking_id uuid references bookings(id),
  idempotency_key text unique,
  created_at timestamptz not null default now()
);

create table ledger_lines (
  id bigserial primary key,
  txn_id uuid not null references ledger_txns(id) on delete cascade,
  account text not null,
  party uuid,
  unit text not null check (unit in ('USD','POINTS')),
  debit bigint not null default 0 check (debit >= 0),
  credit bigint not null default 0 check (credit >= 0)
);
create index on ledger_lines (txn_id);
create index on ledger_lines (account, party);

-- Every transaction must balance per unit at commit time.
create or replace function ledger_assert_balanced() returns trigger language plpgsql as $$
declare bad record;
begin
  select unit, sum(debit) - sum(credit) as net into bad
  from ledger_lines where txn_id = coalesce(new.txn_id, old.txn_id)
  group by unit having sum(debit) <> sum(credit) limit 1;
  if found then
    raise exception 'ledger txn % unbalanced for % by %', coalesce(new.txn_id, old.txn_id), bad.unit, bad.net;
  end if;
  return null;
end $$;

create constraint trigger ledger_balanced
  after insert or update or delete on ledger_lines
  deferrable initially deferred
  for each row execute function ledger_assert_balanced();

create table audit_log (
  id bigserial primary key,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  reason text,
  data jsonb,
  created_at timestamptz not null default now()
);

create table stripe_events (
  id text primary key,            -- Stripe event id: processed once
  type text not null,
  object_id text,
  received_at timestamptz not null default now()
);

-- Views used by the UI.
create view points_balances as
select user_id,
  coalesce(sum(points_remaining) filter (where available_at <= now() and expires_at > now()), 0)::int as available,
  coalesce(sum(points_remaining) filter (where available_at > now()), 0)::int as pending
from points_lots group by user_id;

create view tasker_balances as
select party as tasker_id, sum(credit) - sum(debit) as balance_cents
from ledger_lines where account = 'tasker_payable' and unit = 'USD'
group by party;
