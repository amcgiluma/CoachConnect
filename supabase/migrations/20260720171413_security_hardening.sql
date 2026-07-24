alter table public.categories enable row level security;
alter table public.availability_rules enable row level security;

create policy "categories public read"
on public.categories
for select
to anon, authenticated
using (active = true);

create policy "availability public or own read"
on public.availability_rules
for select
to anon, authenticated
using (
  coach_id = (select auth.uid())
  or exists (
    select 1
    from public.coach_profiles
    where coach_profiles.user_id = availability_rules.coach_id
      and coach_profiles.verification_status = 'verified'
  )
);

create policy "availability insert own"
on public.availability_rules
for insert
to authenticated
with check (coach_id = (select auth.uid()));

create policy "availability update own"
on public.availability_rules
for update
to authenticated
using (coach_id = (select auth.uid()))
with check (coach_id = (select auth.uid()));

create policy "availability delete own"
on public.availability_rules
for delete
to authenticated
using (coach_id = (select auth.uid()));

drop policy if exists "profiles read own" on public.profiles;
create policy "profiles read own"
on public.profiles
for select
to authenticated
using (id = (select auth.uid()));

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own"
on public.profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists "coach profiles update own" on public.coach_profiles;
create policy "coach profiles update own"
on public.coach_profiles
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "coach services own write" on public.coach_services;

create policy "coach services insert own"
on public.coach_services
for insert
to authenticated
with check (coach_id = (select auth.uid()));

create policy "coach services update own"
on public.coach_services
for update
to authenticated
using (coach_id = (select auth.uid()))
with check (coach_id = (select auth.uid()));

create policy "coach services delete own"
on public.coach_services
for delete
to authenticated
using (coach_id = (select auth.uid()));

drop policy if exists "bookings participants read" on public.bookings;
create policy "bookings participants read"
on public.bookings
for select
to authenticated
using (
  consumer_id = (select auth.uid())
  or coach_id = (select auth.uid())
);

create index if not exists categories_parent_id_idx
  on public.categories(parent_id);
create index if not exists coach_services_coach_id_idx
  on public.coach_services(coach_id);
create index if not exists coach_services_category_id_idx
  on public.coach_services(category_id);
create index if not exists availability_rules_coach_id_idx
  on public.availability_rules(coach_id);
create index if not exists bookings_consumer_id_idx
  on public.bookings(consumer_id);
create index if not exists bookings_service_id_idx
  on public.bookings(service_id);
create index if not exists reviews_consumer_id_idx
  on public.reviews(consumer_id);
create index if not exists reviews_coach_id_idx
  on public.reviews(coach_id);
;
