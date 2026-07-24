-- Advisor follow-up: remove overlapping policies and cover all foreign keys.

drop policy if exists "profiles read own" on public.profiles;
drop policy if exists "profiles public coach read" on public.profiles;
create policy "profiles own or public coach read"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1 from public.coach_profiles cp
    where cp.user_id = profiles.id
      and cp.verification_status in ('credentials_submitted', 'under_review', 'verified')
  )
);

create policy "profiles public coach read anon"
on public.profiles
for select
to anon
using (exists (
  select 1 from public.coach_profiles cp
  where cp.user_id = profiles.id
    and cp.verification_status in ('credentials_submitted', 'under_review', 'verified')
));

create policy "audit admin read"
on public.audit_logs
for select
to authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = (select auth.uid()) and p.role = 'admin'
));

create index if not exists booking_packages_service_idx on public.booking_packages(service_id);
create index if not exists cancellations_cancelled_by_idx on public.cancellations(cancelled_by);
create index if not exists conversations_booking_idx on public.conversations(booking_id);
create index if not exists messages_sender_idx on public.messages(sender_id);
create index if not exists reports_conversation_idx on public.reports(conversation_id);
create index if not exists reports_message_idx on public.reports(message_id);
create index if not exists reports_reported_user_idx on public.reports(reported_user_id);

;
