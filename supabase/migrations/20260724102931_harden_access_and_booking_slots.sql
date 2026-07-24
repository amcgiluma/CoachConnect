-- Align Data API privileges with the API-first architecture and make booking
-- creation concurrency-safe. Browser writes remain limited to explicitly
-- documented profile, notification and Storage operations.

create extension if not exists btree_gist;

-- New public objects are private until a migration grants access explicitly.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;

-- Coaches must be able to inspect their own non-public profile and disabled
-- services. UPDATE policies require a matching SELECT policy.
drop policy if exists "coach profiles read own" on public.coach_profiles;
create policy "coach profiles read own"
on public.coach_profiles
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "coach services read own" on public.coach_services;
create policy "coach services read own"
on public.coach_services
for select
to authenticated
using (coach_id = (select auth.uid()));

-- Explicit browser-facing grants. All business writes go through FastAPI,
-- except profile fields, notification read state and private Storage uploads.
revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;

grant select on public.categories, public.coach_profiles, public.coach_services,
  public.availability_rules, public.availability_exceptions, public.reviews
to anon, authenticated;

grant select on public.profiles, public.conversations, public.messages,
  public.bookings, public.booking_packages, public.payments, public.cancellations,
  public.notifications, public.integration_connections, public.credential_documents,
  public.reports
to authenticated;

grant update (display_name, locale, avatar_url, updated_at)
on public.profiles to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- The secret key is backend-only and intentionally receives the complete CRUD
-- surface. FastAPI remains responsible for ownership and admin checks.
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Exact-start uniqueness does not stop 10:00–11:00 overlapping 10:30–11:30.
drop index if exists public.bookings_no_double_slot;

alter table public.bookings
  drop constraint if exists bookings_valid_interval;
alter table public.bookings
  add constraint bookings_valid_interval check (ends_at > starts_at);

alter table public.bookings
  drop constraint if exists bookings_no_overlapping_slots;
alter table public.bookings
  add constraint bookings_no_overlapping_slots
  exclude using gist (
    coach_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (status in ('pending_payment', 'confirmed'));

create or replace function public.create_pending_booking(
  p_consumer_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_notes text default '',
  p_meeting_provider text default 'meet',
  p_platform_fee_percent numeric default 15
)
returns public.bookings
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_service public.coach_services%rowtype;
  selected_coach public.coach_profiles%rowtype;
  created_booking public.bookings%rowtype;
  calculated_end timestamptz;
begin
  if p_starts_at <= now() then
    raise exception 'La reserva debe ser futura' using errcode = '22023';
  end if;
  if p_meeting_provider not in ('meet', 'zoom', 'custom') then
    raise exception 'Proveedor de videollamada no válido' using errcode = '22023';
  end if;
  if p_platform_fee_percent < 0 or p_platform_fee_percent > 100 then
    raise exception 'Comisión de plataforma no válida' using errcode = '22023';
  end if;

  select *
  into selected_service
  from public.coach_services
  where id = p_service_id and active = true;

  if not found then
    raise exception 'Servicio no encontrado' using errcode = 'P0002';
  end if;

  select *
  into selected_coach
  from public.coach_profiles
  where user_id = selected_service.coach_id;

  if not found or selected_coach.verification_status <> 'verified' then
    raise exception 'El entrenador no está verificado' using errcode = 'P0001';
  end if;
  if selected_coach.stripe_account_id is null then
    raise exception 'El entrenador no ha completado Stripe Connect' using errcode = 'P0001';
  end if;

  calculated_end := p_starts_at + make_interval(mins => selected_service.duration_minutes);

  insert into public.bookings (
    consumer_id,
    coach_id,
    service_id,
    starts_at,
    ends_at,
    amount_cents,
    platform_fee_cents,
    notes,
    meeting_provider
  )
  values (
    p_consumer_id,
    selected_service.coach_id,
    selected_service.id,
    p_starts_at,
    calculated_end,
    selected_service.price_cents,
    round(selected_service.price_cents * p_platform_fee_percent / 100),
    left(coalesce(p_notes, ''), 500),
    p_meeting_provider
  )
  returning * into created_booking;

  return created_booking;
exception
  when exclusion_violation then
    raise exception 'Ese horario acaba de ocuparse' using errcode = '23P01';
end;
$$;

revoke all on function public.create_pending_booking(uuid, uuid, timestamptz, text, text, numeric)
from public, anon, authenticated;
grant execute on function public.create_pending_booking(uuid, uuid, timestamptz, text, text, numeric)
to service_role;

create or replace function public.create_package_booking(
  p_consumer_id uuid,
  p_package_id uuid,
  p_starts_at timestamptz,
  p_meeting_provider text default 'meet'
)
returns public.bookings
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_package public.booking_packages%rowtype;
  selected_service public.coach_services%rowtype;
  created_booking public.bookings%rowtype;
begin
  select * into selected_package
  from public.booking_packages
  where id = p_package_id and consumer_id = p_consumer_id
  for update;

  if not found or selected_package.status <> 'active'
    or selected_package.used_sessions >= selected_package.total_sessions then
    raise exception 'El bono no está disponible' using errcode = 'P0001';
  end if;

  select * into selected_service
  from public.coach_services
  where id = selected_package.service_id and active = true;

  if p_starts_at <= now() then
    raise exception 'La reserva debe ser futura' using errcode = '22023';
  end if;
  if p_meeting_provider not in ('meet', 'zoom', 'custom') then
    raise exception 'Proveedor de videollamada no válido' using errcode = '22023';
  end if;

  insert into public.bookings (
    consumer_id, coach_id, service_id, package_id, starts_at, ends_at,
    status, amount_cents, platform_fee_cents, meeting_provider
  )
  values (
    p_consumer_id, selected_package.coach_id, selected_package.service_id,
    selected_package.id, p_starts_at,
    p_starts_at + make_interval(mins => selected_service.duration_minutes),
    'confirmed', 0, 0, p_meeting_provider
  )
  returning * into created_booking;

  update public.booking_packages
  set used_sessions = used_sessions + 1,
      status = case when used_sessions + 1 >= total_sessions then 'used' else 'active' end
  where id = selected_package.id;

  return created_booking;
exception
  when exclusion_violation then
    raise exception 'Ese horario acaba de ocuparse' using errcode = '23P01';
end;
$$;

revoke all on function public.create_package_booking(uuid, uuid, timestamptz, text)
from public, anon, authenticated;
grant execute on function public.create_package_booking(uuid, uuid, timestamptz, text)
to service_role;

create table if not exists public.blocked_users (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public.matching_settings (
  id smallint primary key default 1 check (id = 1),
  specialty_weight smallint not null default 65 check (specialty_weight between 0 and 100),
  goal_weight smallint not null default 10 check (goal_weight between 0 and 100),
  mode_weight smallint not null default 10 check (mode_weight between 0 and 100),
  availability_weight smallint not null default 10 check (availability_weight between 0 and 100),
  reputation_weight smallint not null default 5 check (reputation_weight between 0 and 100),
  updated_at timestamptz not null default now(),
  check (specialty_weight + goal_weight + mode_weight + availability_weight + reputation_weight = 100)
);

insert into public.matching_settings (id) values (1) on conflict (id) do nothing;

alter table public.blocked_users enable row level security;
alter table public.matching_settings enable row level security;

create policy "blocked relationships own read"
on public.blocked_users for select to authenticated
using (blocker_id = (select auth.uid()) or blocked_id = (select auth.uid()));
create policy "users block others"
on public.blocked_users for insert to authenticated
with check (blocker_id = (select auth.uid()));
create policy "users remove own blocks"
on public.blocked_users for delete to authenticated
using (blocker_id = (select auth.uid()));

create policy "matching settings public read"
on public.matching_settings for select to anon, authenticated
using (true);

grant select on public.matching_settings to anon, authenticated;
grant select on public.blocked_users to authenticated;
grant select, insert, update, delete on public.blocked_users, public.matching_settings to service_role;

alter table public.coach_profiles
  add column if not exists video_status text not null default 'not_submitted'
    check (video_status in ('not_submitted', 'pending', 'approved', 'rejected')),
  add column if not exists video_review_note text,
  add column if not exists custom_video_url text;

create table if not exists public.stripe_webhook_events (
  id text primary key,
  event_type text not null,
  status text not null default 'processing' check (status in ('processing', 'processed')),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

grant select, insert, update, delete on public.stripe_webhook_events to service_role;

-- The original migration was applied through a Windows shell. Keep the
-- canonical taxonomy deterministic on both remote and local resets.
update public.categories as category
set name_es = corrected.name_es
from (
  values
    ('sport', 'Preparación deportiva'),
    ('musculacion', 'Musculación'),
    ('perdida-peso', 'Pérdida de peso'),
    ('natacion', 'Natación'),
    ('futbol', 'Fútbol'),
    ('padel', 'Pádel'),
    ('contemporaneo', 'Contemporáneo'),
    ('nutricion', 'Nutrición deportiva'),
    ('habitos', 'Hábitos'),
    ('recuperacion', 'Recuperación')
) as corrected(slug, name_es)
where category.slug = corrected.slug;
