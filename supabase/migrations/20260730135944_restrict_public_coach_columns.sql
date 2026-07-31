-- Public coach data is served through FastAPI DTOs. Direct table access would
-- expose private operational columns such as Stripe account IDs, review notes,
-- exact coordinates and custom meeting URLs because RLS only filters rows.
revoke select on public.coach_profiles, public.coach_services,
  public.availability_rules, public.availability_exceptions
from anon, authenticated;

-- The backend remains the only reader/writer for these tables.
grant select, insert, update, delete on public.coach_profiles, public.coach_services,
  public.availability_rules, public.availability_exceptions
to service_role;

-- Keep RLS safe as defence in depth if browser grants are reintroduced later.
drop policy if exists "coach profiles public or own read" on public.coach_profiles;
create policy "coach profiles verified or own read"
on public.coach_profiles
for select
to anon, authenticated
using (
  verification_status = 'verified'
  or user_id = (select auth.uid())
);

drop policy if exists "coach services public or own read" on public.coach_services;
create policy "coach services verified or own read"
on public.coach_services
for select
to anon, authenticated
using (
  coach_id = (select auth.uid())
  or (
    active = true
    and exists (
      select 1
      from public.coach_profiles
      where coach_profiles.user_id = coach_services.coach_id
        and coach_profiles.verification_status = 'verified'
    )
  )
);
