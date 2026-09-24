-- Public display names. Closes the RLS gap where clients could not read tasker names
-- (profiles is readable only by its owner and staff).
--
-- * taskers.display_name: the tasker's public name, kept in sync with profiles.full_name.
--   Readable wherever the taskers row is readable (active taskers are public).
-- * display_names: one row per profile with the only name other users may see:
--   a tasker's full name, everyone else's FIRST name only. Readable by the user themself,
--   staff, anyone (incl. anon) for active taskers, and the counterparty on a shared booking
--   (a client sees their taskers, a tasker sees the first name of their clients).
--   Emails live only in auth.users and are never exposed.
-- Both are maintained by triggers; nobody but the database writes them.

alter table public.taskers add column display_name text not null default '';

create table public.display_names (
  id uuid primary key references public.profiles(id) on delete cascade,
  display_name text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.display_names enable row level security;
revoke insert, update, delete, truncate on public.display_names from anon, authenticated;

create or replace function private.display_name_for(p_role public.user_role, p_full_name text)
returns text language sql immutable set search_path = '' as $$
  select case when p_role = 'tasker' then btrim(coalesce(p_full_name, ''))
              else split_part(btrim(coalesce(p_full_name, '')), ' ', 1) end
$$;

create or replace function private.sync_display_name() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.display_names (id, display_name, updated_at)
  values (new.id, private.display_name_for(new.role, new.full_name), now())
  on conflict (id) do update
    set display_name = excluded.display_name, updated_at = excluded.updated_at
    where public.display_names.display_name is distinct from excluded.display_name;
  update public.taskers t set display_name = btrim(new.full_name)
   where t.id = new.id and t.display_name is distinct from btrim(new.full_name);
  return null;
end $$;

create trigger profiles_sync_display_name after insert or update of full_name, role on public.profiles
  for each row execute function private.sync_display_name();

create or replace function private.tasker_display_name_default() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.display_name, '') = '' then
    select btrim(p.full_name) into new.display_name from public.profiles p where p.id = new.id;
    new.display_name := coalesce(new.display_name, '');
  end if;
  return new;
end $$;

create trigger taskers_display_name_default before insert on public.taskers
  for each row execute function private.tasker_display_name_default();

revoke execute on function private.display_name_for(public.user_role, text) from public, anon, authenticated;
revoke execute on function private.sync_display_name() from public, anon, authenticated;
revoke execute on function private.tasker_display_name_default() from public, anon, authenticated;

-- Backfill existing rows.
insert into public.display_names (id, display_name)
select p.id, private.display_name_for(p.role, p.full_name) from public.profiles p
on conflict (id) do update set display_name = excluded.display_name, updated_at = now();
update public.taskers t set display_name = btrim(p.full_name) from public.profiles p where p.id = t.id;

-- anon cannot execute private.is_staff(), so anon gets its own (narrower) policy.
create policy "display names: active taskers (anon)" on public.display_names for select to anon
  using (exists (select 1 from public.taskers t where t.id = display_names.id and t.status = 'active'));

create policy "display names: self, staff, active taskers, booking counterparties" on public.display_names
  for select to authenticated using (
    id = (select auth.uid())
    or (select private.is_staff())
    or exists (select 1 from public.taskers t where t.id = display_names.id and t.status = 'active')
    or exists (
      select 1 from public.bookings b
       where (b.client_id = (select auth.uid()) and b.tasker_id = display_names.id)
          or (b.tasker_id = (select auth.uid()) and b.client_id = display_names.id)
    )
  );
