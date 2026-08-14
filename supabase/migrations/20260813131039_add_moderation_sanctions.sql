-- Complete the moderation workflow with auditable, expiring restrictions.
-- Business writes remain server-only. RLS still limits any direct read access
-- granted in the future to authenticated administrators.

alter table public.reports
  add column if not exists resolved_by uuid references public.profiles(id) on delete set null,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution_note text not null default '';

alter table public.reports
  drop constraint if exists reports_reason_length_check;
alter table public.reports
  add constraint reports_reason_length_check
  check (char_length(btrim(reason)) between 3 and 120) not valid;

alter table public.reports
  drop constraint if exists reports_details_length_check;
alter table public.reports
  add constraint reports_details_length_check
  check (char_length(details) <= 1200) not valid;

alter table public.reports
  drop constraint if exists reports_parties_are_distinct;
alter table public.reports
  add constraint reports_parties_are_distinct
  check (reported_user_id is null or reporter_id <> reported_user_id) not valid;

create table public.moderation_sanctions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('account', 'messaging', 'training')),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  report_id uuid references public.reports(id) on delete set null,
  imposed_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  revocation_reason text not null default '' check (char_length(revocation_reason) <= 500),
  created_at timestamptz not null default now(),
  check (expires_at > starts_at),
  check (revoked_at is null or revoked_at >= starts_at)
);

comment on table public.moderation_sanctions is
  'Temporary manual restrictions imposed by administrators, with revocation history.';
comment on column public.moderation_sanctions.kind is
  'Restricted capability: full account, messaging, or participation in training.';

alter table public.moderation_sanctions enable row level security;

create policy "moderation sanctions admin read"
on public.moderation_sanctions
for select
to authenticated
using (exists (
  select 1
  from public.profiles p
  where p.id = (select auth.uid()) and p.role = 'admin'
));

create policy "reports admin read"
on public.reports
for select
to authenticated
using (exists (
  select 1
  from public.profiles p
  where p.id = (select auth.uid()) and p.role = 'admin'
));

create index moderation_sanctions_active_user_kind_idx
  on public.moderation_sanctions(user_id, kind, expires_at)
  where revoked_at is null;
create index moderation_sanctions_report_id_idx
  on public.moderation_sanctions(report_id)
  where report_id is not null;
create index moderation_sanctions_imposed_by_idx
  on public.moderation_sanctions(imposed_by)
  where imposed_by is not null;
create index moderation_sanctions_revoked_by_idx
  on public.moderation_sanctions(revoked_by)
  where revoked_by is not null;
create index reports_resolved_by_idx
  on public.reports(resolved_by)
  where resolved_by is not null;

revoke all on public.moderation_sanctions from anon, authenticated;
grant select, insert, update, delete on public.moderation_sanctions to service_role;
