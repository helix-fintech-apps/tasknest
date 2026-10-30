-- Discovery: categories (reference data) and the anon-readable views behind browse pages (docs/contracts.md 4.1).
--
--   categories            Handyman / Cleaning / Moving match the seeded taskers; the rest are "coming soon"
--                         (no active taskers yet, which category_summary.tasker_count shows as 0)
--   category_summary      one row per active category: how many active taskers, and the lowest hourly rate
--   tasker_public_stats   average rating (x100, an integer), review count and completed count per active tasker
--   public_reviews        reviews with the client's FIRST name only and no client or booking id
--
-- The views read tables anon cannot read directly (reviews/bookings/profiles), so they run as the view owner and
-- expose only the columns listed here, for active taskers only.

insert into public.categories (slug, name, icon, sort) values
  ('handyman',           'Handyman',           'wrench',      10),
  ('cleaning',           'Cleaning',           'sparkles',    20),
  ('moving',             'Moving',             'truck',       30),
  ('furniture-assembly', 'Furniture assembly', 'sofa',        40),
  ('yard-work',          'Yard work',          'leaf',        50),
  ('painting',           'Painting',           'paint-roller', 60)
on conflict (slug) do nothing;

create view public.category_summary as
select c.slug, c.name, c.icon, c.sort,
       count(t.id)::int as tasker_count,
       min(t.hourly_rate_cents)::bigint as from_rate_cents
  from public.categories c
  left join public.taskers t
    on t.status = 'active' and lower(t.category) in (c.slug, lower(c.name))
 where c.active
 group by c.slug, c.name, c.icon, c.sort;

create view public.tasker_public_stats as
select t.id as tasker_id,
       (select round(avg(r.rating) * 100)::int
          from public.reviews r join public.bookings b on b.id = r.booking_id
         where b.tasker_id = t.id) as avg_rating_x100,
       (select count(*)::int
          from public.reviews r join public.bookings b on b.id = r.booking_id
         where b.tasker_id = t.id) as review_count,
       (select count(*)::int from public.bookings b
         where b.tasker_id = t.id and b.completed_at is not null) as completed_count
  from public.taskers t
 where t.status = 'active';

create view public.public_reviews as
select b.tasker_id, r.rating, r.body, r.created_at,
       split_part(btrim(p.full_name), ' ', 1) as client_first_name
  from public.reviews r
  join public.bookings b on b.id = r.booking_id
  join public.profiles p on p.id = b.client_id
  join public.taskers t on t.id = b.tasker_id and t.status = 'active';

revoke all on public.category_summary, public.tasker_public_stats, public.public_reviews
  from public, anon, authenticated;
grant select on public.category_summary, public.tasker_public_stats, public.public_reviews
  to anon, authenticated, service_role;
