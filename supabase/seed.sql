-- TaskNest demo data (TEST ONLY). Password for every user: TaskNest!2026
-- Idempotent: safe to run more than once. Requires the migrations to be applied first.
-- Users are inserted straight into auth.users + auth.identities (what GoTrue expects for
-- email/password sign-in). The on_auth_user_created trigger creates each profile; roles for
-- staff are set afterwards with an UPDATE (signup can never grant staff roles).

with demo(id, email, full_name, meta_role) as (
  values
    ('00000000-0000-4000-a000-000000000001'::uuid, 'ava@tasknest.test',   'Ava Client',    'client'),
    ('00000000-0000-4000-a000-000000000002'::uuid, 'ben@tasknest.test',   'Ben Client',    'client'),
    ('00000000-0000-4000-a000-000000000011'::uuid, 'tara@tasknest.test',  'Tara Tasker',   'tasker'),
    ('00000000-0000-4000-a000-000000000012'::uuid, 'leo@tasknest.test',   'Leo Tasker',    'tasker'),
    ('00000000-0000-4000-a000-000000000013'::uuid, 'pia@tasknest.test',   'Pia Tasker',    'tasker'),
    ('00000000-0000-4000-a000-000000000021'::uuid, 'admin@tasknest.test', 'Ada Admin',     'client'),
    ('00000000-0000-4000-a000-000000000022'::uuid, 'agent@tasknest.test', 'Sam Support',   'client')
)
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select '00000000-0000-0000-0000-000000000000', d.id, 'authenticated', 'authenticated', d.email,
       extensions.crypt('TaskNest!2026', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('full_name', d.full_name, 'role', d.meta_role, 'email_verified', true),
       now(), now(), '', '', '', '', '', '', '', ''
from demo d
on conflict (id) do nothing;

insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id::text, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
       'email', now(), now(), now()
from auth.users u
where u.email like '%@tasknest.test'
  and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

-- Profiles are created by the trigger; make sure they exist even if the trigger was absent.
insert into public.profiles (id, full_name, role)
select u.id, coalesce(u.raw_user_meta_data->>'full_name', ''),
       case when u.raw_user_meta_data->>'role' = 'tasker' then 'tasker'::user_role else 'client'::user_role end
from auth.users u where u.email like '%@tasknest.test'
on conflict (id) do nothing;

-- Staff roles: granted only by update after insert.
update public.profiles set role = 'admin' where id = '00000000-0000-4000-a000-000000000021';
update public.profiles set role = 'support_agent' where id = '00000000-0000-4000-a000-000000000022';

insert into public.taskers (id, headline, category, hourly_rate_cents, status, stripe_account_id, kyc_verified_at) values
  ('00000000-0000-4000-a000-000000000011', 'Shelves, TVs, furniture assembly', 'Handyman', 4500, 'active',  'acct_fake_tara', now()),
  ('00000000-0000-4000-a000-000000000012', 'Deep cleans and move-outs',        'Cleaning', 3800, 'active',  'acct_fake_leo',  now()),
  ('00000000-0000-4000-a000-000000000013', 'Two-person moving crew',           'Moving',   6000, 'pending', null,             null)
on conflict (id) do nothing;

-- Starting loyalty points: Ava 5,000 (available), Ben 600 (available). Posted to the ledger like any
-- other issuance so the POINTS unit stays in step with the lots.
do $$
declare v_txn uuid;
begin
  if not exists (select 1 from public.points_lots where user_id = '00000000-0000-4000-a000-000000000001' and kind = 'bonus' and booking_id is null) then
    insert into public.points_lots (id, user_id, kind, points_initial, points_remaining, available_at, expires_at)
    values ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001', 'bonus', 5000, 5000, now() - interval '1 day', now() + interval '12 months'),
           ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002', 'bonus', 600, 600, now() - interval '1 day', now() + interval '12 months');
    insert into public.points_movements (user_id, lot_id, kind, points) values
      ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-b000-000000000001', 'bonus', 5000),
      ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-b000-000000000002', 'bonus', 600);
    v_txn := public.post_ledger_txn('points_bonus', null, 'seed:points_bonus', jsonb_build_array(
      jsonb_build_object('account','points_issued','party','','unit','POINTS','debit',5600,'credit',0),
      jsonb_build_object('account','points_outstanding','party','00000000-0000-4000-a000-000000000001','unit','POINTS','debit',0,'credit',5000),
      jsonb_build_object('account','points_outstanding','party','00000000-0000-4000-a000-000000000002','unit','POINTS','debit',0,'credit',600),
      jsonb_build_object('account','promo_expense','party','','unit','USD','debit',5600,'credit',0),
      jsonb_build_object('account','points_liability','party','','unit','USD','debit',0,'credit',5600)
    ));
  end if;
end $$;
