-- Resolve actionable security/performance advisor warnings.

alter extension btree_gist set schema extensions;

create index if not exists blocked_users_blocked_id_idx
  on public.blocked_users(blocked_id);

drop policy if exists "coach profiles public read" on public.coach_profiles;
drop policy if exists "coach profiles read own" on public.coach_profiles;
drop policy if exists "coach profiles public or own read" on public.coach_profiles;
create policy "coach profiles public or own read"
on public.coach_profiles
for select
to anon, authenticated
using (
  verification_status in ('credentials_submitted', 'under_review', 'verified')
  or user_id = (select auth.uid())
);

drop policy if exists "active services public read" on public.coach_services;
drop policy if exists "coach services read own" on public.coach_services;
drop policy if exists "coach services public or own read" on public.coach_services;
create policy "coach services public or own read"
on public.coach_services
for select
to anon, authenticated
using (
  active = true
  or coach_id = (select auth.uid())
);
