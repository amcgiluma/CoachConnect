-- Bilateral training outcomes, reputation and recurring packages.
-- Business writes remain API-first; browser roles only receive explicitly listed reads.

alter table public.coach_services
  add column if not exists offer_type text not null default 'single',
  add column if not exists booking_mode text not null default 'instant',
  add column if not exists expiry_days integer,
  add column if not exists cadence_weeks smallint,
  add column if not exists acceptance_window_hours smallint not null default 12;

update public.coach_services
set offer_type = case when package_size > 1 then 'flex_pack' else 'single' end
where offer_type = 'single' and package_size > 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'coach_services_offer_type_check') then
    alter table public.coach_services add constraint coach_services_offer_type_check
      check (offer_type in ('single', 'flex_pack', 'recurring_plan'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'coach_services_booking_mode_check') then
    alter table public.coach_services add constraint coach_services_booking_mode_check
      check (booking_mode in ('instant', 'request'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'coach_services_offer_configuration_check') then
    alter table public.coach_services add constraint coach_services_offer_configuration_check check (
      (offer_type = 'single' and package_size = 1 and expiry_days is null and cadence_weeks is null)
      or (offer_type = 'flex_pack' and package_size between 2 and 24 and expiry_days between 30 and 365 and cadence_weeks is null)
      or (offer_type = 'recurring_plan' and package_size between 2 and 24 and expiry_days between 30 and 365 and cadence_weeks in (1, 2))
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'coach_services_acceptance_window_check') then
    alter table public.coach_services add constraint coach_services_acceptance_window_check
      check (acceptance_window_hours between 1 and 24);
  end if;
end $$;

alter table public.booking_packages drop constraint if exists booking_packages_status_check;
alter table public.booking_packages
  add column if not exists offer_type text not null default 'flex_pack',
  add column if not exists expires_at timestamptz,
  add column if not exists reschedule_until timestamptz,
  add column if not exists cadence_weeks smallint,
  add column if not exists terms_snapshot jsonb not null default '{}'::jsonb;
alter table public.booking_packages add constraint booking_packages_status_check
  check (status in ('pending', 'awaiting_coach', 'active', 'used', 'expired', 'cancelled', 'refunded'));

create table public.booking_series (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null unique references public.booking_packages(id) on delete cascade,
  consumer_id uuid not null references public.profiles(id),
  coach_id uuid not null references public.coach_profiles(user_id),
  service_id uuid not null references public.coach_services(id),
  timezone text not null default 'Europe/Madrid',
  cadence_weeks smallint not null check (cadence_weeks in (1, 2)),
  session_count smallint not null check (session_count between 2 and 24),
  status text not null default 'holding' check (status in ('holding', 'awaiting_coach', 'confirmed', 'completed', 'cancelled', 'expired')),
  hold_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bookings
  add column if not exists series_id uuid references public.booking_series(id) on delete set null,
  add column if not exists request_expires_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists outcome_window_ends_at timestamptz,
  add column if not exists outcome_status text,
  add column if not exists outcome_finalized_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_outcome_status_check') then
    alter table public.bookings add constraint bookings_outcome_status_check check (
      outcome_status is null or outcome_status in (
        'assumed_attended', 'attended', 'attended_with_issues', 'client_no_show',
        'coach_no_show', 'mutually_rescheduled', 'technical_failure', 'disputed'
      )
    );
  end if;
end $$;

-- Active payment/request holds use pending_payment and block the complete time range.
alter table public.bookings drop constraint if exists bookings_no_overlapping_slots;
alter table public.bookings add constraint bookings_no_overlapping_slots
  exclude using gist (
    coach_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('pending_payment', 'confirmed'));

create table public.session_credits (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references public.booking_packages(id) on delete cascade,
  source_booking_id uuid references public.bookings(id) on delete set null,
  booking_id uuid unique references public.bookings(id) on delete set null,
  consumer_id uuid not null references public.profiles(id),
  coach_id uuid not null references public.coach_profiles(user_id),
  service_id uuid not null references public.coach_services(id),
  ordinal smallint not null check (ordinal between 1 and 24),
  status text not null default 'available' check (status in ('available', 'reserved', 'consumed', 'expired', 'refunded')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (package_id, source_booking_id, ordinal)
);

create table public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid unique references public.bookings(id) on delete cascade,
  package_id uuid unique references public.booking_packages(id) on delete cascade,
  series_id uuid unique references public.booking_series(id) on delete cascade,
  consumer_id uuid not null references public.profiles(id),
  coach_id uuid not null references public.coach_profiles(user_id),
  status text not null default 'awaiting_payment' check (status in ('awaiting_payment', 'awaiting_coach', 'accepted', 'rejected', 'expired', 'cancelled')),
  expires_at timestamptz not null,
  decided_at timestamptz,
  reason_code text,
  created_at timestamptz not null default now(),
  check ((booking_id is not null)::integer + (package_id is not null)::integer = 1),
  check ((series_id is null) or (package_id is not null))
);

create table public.session_reports (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  outcome text not null check (outcome in (
    'attended', 'attended_with_issues', 'client_no_show', 'coach_no_show',
    'mutually_rescheduled', 'technical_failure'
  )),
  circumstances text[] not null default '{}'::text[],
  note text not null default '' check (char_length(note) <= 1200),
  response_due_at timestamptz not null default (now() + interval '48 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id, author_id)
);

-- Generalise the existing consumer->coach review table without losing data.
alter table public.reviews drop constraint if exists reviews_booking_id_key;
alter table public.reviews
  add column if not exists author_id uuid references public.profiles(id),
  add column if not exists subject_id uuid references public.profiles(id),
  add column if not exists target_role public.user_role,
  add column if not exists punctuality smallint,
  add column if not exists communication smallint,
  add column if not exists respect smallint,
  add column if not exists quality smallint,
  add column if not exists personalization smallint,
  add column if not exists safety smallint,
  add column if not exists commitment smallint,
  add column if not exists reveal_after timestamptz not null default (now() + interval '14 days'),
  add column if not exists revealed_at timestamptz,
  add column if not exists moderation_status text not null default 'visible',
  add column if not exists updated_at timestamptz not null default now();

update public.reviews
set author_id = consumer_id,
    subject_id = coach_id,
    target_role = 'coach',
    revealed_at = coalesce(revealed_at, created_at)
where author_id is null or subject_id is null or target_role is null;

alter table public.reviews
  alter column author_id set not null,
  alter column subject_id set not null,
  alter column target_role set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reviews_booking_author_key') then
    alter table public.reviews add constraint reviews_booking_author_key unique (booking_id, author_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reviews_dimensions_check') then
    alter table public.reviews add constraint reviews_dimensions_check check (
      (punctuality is null or punctuality between 1 and 5)
      and (communication is null or communication between 1 and 5)
      and (respect is null or respect between 1 and 5)
      and (quality is null or quality between 1 and 5)
      and (personalization is null or personalization between 1 and 5)
      and (safety is null or safety between 1 and 5)
      and (commitment is null or commitment between 1 and 5)
      and author_id <> subject_id
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reviews_moderation_status_check') then
    alter table public.reviews add constraint reviews_moderation_status_check
      check (moderation_status in ('visible', 'reported', 'hidden'));
  end if;
end $$;

create table public.review_replies (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null unique references public.reviews(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 1200),
  moderation_status text not null default 'visible' check (moderation_status in ('visible', 'reported', 'hidden')),
  created_at timestamptz not null default now()
);

create table public.reputation_summaries (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  role public.user_role not null,
  star_rating numeric(3,2),
  unique_reviewers integer not null default 0,
  review_count integer not null default 0,
  reliability_percent numeric(5,2),
  completed_sessions integer not null default 0,
  late_cancellations integer not null default 0,
  no_shows integer not null default 0,
  median_response_minutes integer,
  updated_at timestamptz not null default now()
);

create table public.coach_response_samples (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  coach_id uuid not null references public.coach_profiles(user_id) on delete cascade,
  first_customer_message_at timestamptz not null,
  first_coach_response_at timestamptz not null,
  response_minutes integer not null check (response_minutes >= 0),
  created_at timestamptz not null default now()
);

alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments
  add column if not exists capture_method text not null default 'automatic',
  add column if not exists authorization_expires_at timestamptz,
  add column if not exists stripe_refund_id text,
  add column if not exists idempotency_key text;
alter table public.payments add constraint payments_status_check
  check (status in ('pending', 'authorized', 'paid', 'failed', 'cancelled', 'refunded', 'partially_refunded'));

create table public.lifecycle_jobs (
  id bigint generated always as identity primary key,
  kind text not null,
  entity_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts smallint not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (kind, entity_id)
);

-- Index every foreign key/filter used by API queries and RLS checks.
create index booking_series_consumer_idx on public.booking_series(consumer_id, created_at desc);
create index booking_series_coach_idx on public.booking_series(coach_id, created_at desc);
create index booking_series_service_idx on public.booking_series(service_id);
create index bookings_series_idx on public.bookings(series_id) where series_id is not null;
create index bookings_due_completion_idx on public.bookings(ends_at) where status = 'confirmed';
create index bookings_due_outcome_idx on public.bookings(outcome_window_ends_at) where status = 'completed' and outcome_finalized_at is null;
create index credits_package_status_idx on public.session_credits(package_id, status);
create index credits_consumer_status_idx on public.session_credits(consumer_id, status, expires_at);
create index credits_coach_idx on public.session_credits(coach_id);
create index credits_service_idx on public.session_credits(service_id);
create index credits_source_booking_idx on public.session_credits(source_booking_id) where source_booking_id is not null;
create index booking_requests_consumer_idx on public.booking_requests(consumer_id, created_at desc);
create index booking_requests_coach_status_idx on public.booking_requests(coach_id, status, expires_at);
create index reports_booking_idx on public.session_reports(booking_id);
create index reports_author_idx on public.session_reports(author_id);
create index reviews_author_idx on public.reviews(author_id);
create index reviews_subject_revealed_idx on public.reviews(subject_id, revealed_at desc) where published = true and moderation_status = 'visible';
create index review_replies_author_idx on public.review_replies(author_id);
create index coach_response_samples_recent_idx on public.coach_response_samples(coach_id, first_coach_response_at desc);
create index lifecycle_jobs_pending_idx on public.lifecycle_jobs(available_at, id) where status = 'pending';

-- Refresh star aggregates using one equal vote per author/relationship.
create or replace function private.refresh_reputation(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role public.user_role;
  average_rating numeric(3,2);
  reviewer_count integer;
  total_reviews integer;
begin
  select role into target_role from public.profiles where id = p_profile_id;
  if not found then return; end if;

  with per_author as (
    select author_id, avg(rating)::numeric as author_average, count(*) as review_total
    from public.reviews
    where subject_id = p_profile_id
      and published = true
      and moderation_status = 'visible'
      and revealed_at is not null
      and created_at >= now() - interval '24 months'
    group by author_id
  )
  select round(avg(author_average), 2), count(*)::integer, coalesce(sum(review_total), 0)::integer
  into average_rating, reviewer_count, total_reviews
  from per_author;

  insert into public.reputation_summaries(profile_id, role, star_rating, unique_reviewers, review_count, updated_at)
  values (p_profile_id, target_role, average_rating, coalesce(reviewer_count, 0), coalesce(total_reviews, 0), now())
  on conflict (profile_id) do update set
    role = excluded.role,
    star_rating = excluded.star_rating,
    unique_reviewers = excluded.unique_reviewers,
    review_count = excluded.review_count,
    updated_at = now();

  if target_role = 'coach' then
    update public.coach_profiles
    set rating = coalesce(average_rating, 0), review_count = coalesce(reviewer_count, 0), updated_at = now()
    where user_id = p_profile_id;
  end if;
end;
$$;

revoke all on function private.refresh_reputation(uuid) from public, anon, authenticated, service_role;

create or replace function private.on_review_reputation_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.refresh_reputation(coalesce(new.subject_id, old.subject_id));
  if tg_op = 'UPDATE' and old.subject_id is distinct from new.subject_id then
    perform private.refresh_reputation(old.subject_id);
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function private.on_review_reputation_change() from public, anon, authenticated, service_role;

create trigger reviews_refresh_reputation
after insert or update or delete on public.reviews
for each row execute function private.on_review_reputation_change();

-- Atomic recurring-plan hold. FastAPI is responsible for ownership and Stripe.
create or replace function public.create_recurring_package_hold(
  p_consumer_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz[],
  p_timezone text default 'Europe/Madrid',
  p_meeting_provider text default 'meet'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_service public.coach_services%rowtype;
  selected_coach public.coach_profiles%rowtype;
  created_package public.booking_packages%rowtype;
  created_series public.booking_series%rowtype;
  occurrence timestamptz;
  created_booking public.bookings%rowtype;
  booking_ids uuid[] := array[]::uuid[];
  position smallint := 0;
  package_expiry timestamptz;
begin
  select * into selected_service from public.coach_services where id = p_service_id and active = true for share;
  if not found or selected_service.offer_type <> 'recurring_plan' then
    raise exception 'Plan recurrente no encontrado' using errcode = 'P0002';
  end if;
  if cardinality(p_starts_at) <> selected_service.package_size then
    raise exception 'La serie no contiene todas las sesiones del plan' using errcode = '22023';
  end if;
  if p_meeting_provider not in ('meet', 'zoom', 'custom') then
    raise exception 'Proveedor de videollamada no válido' using errcode = '22023';
  end if;
  select * into selected_coach from public.coach_profiles where user_id = selected_service.coach_id;
  if not found or selected_coach.verification_status <> 'verified' then
    raise exception 'El entrenador no está verificado' using errcode = 'P0001';
  end if;

  foreach occurrence in array p_starts_at loop
    if occurrence <= now() then raise exception 'Todas las sesiones deben ser futuras' using errcode = '22023'; end if;
  end loop;

  package_expiry := greatest(p_starts_at[cardinality(p_starts_at)] + interval '30 days', now() + make_interval(days => selected_service.expiry_days));
  insert into public.booking_packages(
    consumer_id, coach_id, service_id, total_sessions, amount_cents, status,
    offer_type, expires_at, reschedule_until, cadence_weeks, terms_snapshot
  ) values (
    p_consumer_id, selected_service.coach_id, selected_service.id, selected_service.package_size,
    selected_service.price_cents, 'pending', 'recurring_plan', package_expiry,
    p_starts_at[cardinality(p_starts_at)] + interval '30 days', selected_service.cadence_weeks,
    jsonb_build_object('price_cents', selected_service.price_cents, 'session_count', selected_service.package_size,
      'expiry_days', selected_service.expiry_days, 'cadence_weeks', selected_service.cadence_weeks,
      'booking_mode', selected_service.booking_mode)
  ) returning * into created_package;

  insert into public.booking_series(package_id, consumer_id, coach_id, service_id, timezone, cadence_weeks, session_count, hold_expires_at)
  values (created_package.id, p_consumer_id, selected_service.coach_id, selected_service.id, p_timezone,
    selected_service.cadence_weeks, selected_service.package_size, now() + interval '30 minutes')
  returning * into created_series;

  foreach occurrence in array p_starts_at loop
    position := position + 1;
    insert into public.bookings(
      consumer_id, coach_id, service_id, package_id, series_id, starts_at, ends_at,
      status, amount_cents, platform_fee_cents, meeting_provider
    ) values (
      p_consumer_id, selected_service.coach_id, selected_service.id, created_package.id, created_series.id,
      occurrence, occurrence + make_interval(mins => selected_service.duration_minutes), 'pending_payment',
      0, 0, p_meeting_provider
    ) returning * into created_booking;
    booking_ids := array_append(booking_ids, created_booking.id);
    insert into public.session_credits(package_id, booking_id, consumer_id, coach_id, service_id, ordinal, status, expires_at)
    values (created_package.id, created_booking.id, p_consumer_id, selected_service.coach_id,
      selected_service.id, position, 'reserved', package_expiry);
  end loop;

  return jsonb_build_object('package_id', created_package.id, 'series_id', created_series.id,
    'booking_ids', booking_ids, 'status', 'pending', 'hold_expires_at', created_series.hold_expires_at);
exception when exclusion_violation then
  raise exception 'Una o más fechas acaban de ocuparse' using errcode = '23P01';
end;
$$;

revoke all on function public.create_recurring_package_hold(uuid, uuid, timestamptz[], text, text)
from public, anon, authenticated;
grant execute on function public.create_recurring_package_hold(uuid, uuid, timestamptz[], text, text)
to service_role;

create or replace function private.refresh_reliability()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.reputation_summaries(
    profile_id, role, reliability_percent, completed_sessions, late_cancellations, no_shows, updated_at
  )
  select cp.user_id, 'coach'::public.user_role,
    case when stats.completed + stats.late_cancelled + stats.no_show = 0 then null
      else round(100.0 * stats.completed / (stats.completed + stats.late_cancelled + stats.no_show), 2) end,
    stats.completed, stats.late_cancelled, stats.no_show, now()
  from public.coach_profiles cp
  cross join lateral (
    select
      count(*) filter (where b.status = 'completed' and b.outcome_status in ('attended', 'attended_with_issues', 'assumed_attended'))::integer as completed,
      count(*) filter (where b.outcome_status = 'coach_no_show')::integer as no_show,
      count(*) filter (where c.cancelled_by = cp.user_id and c.created_at > b.starts_at - interval '24 hours')::integer as late_cancelled
    from public.bookings b
    left join public.cancellations c on c.booking_id = b.id
    where b.coach_id = cp.user_id and b.starts_at >= now() - interval '12 months'
  ) stats
  on conflict (profile_id) do update set
    role = excluded.role, reliability_percent = excluded.reliability_percent,
    completed_sessions = excluded.completed_sessions, late_cancellations = excluded.late_cancellations,
    no_shows = excluded.no_shows, updated_at = now();

  insert into public.reputation_summaries(
    profile_id, role, reliability_percent, completed_sessions, late_cancellations, no_shows, updated_at
  )
  select p.id, 'consumer'::public.user_role,
    case when stats.completed + stats.no_show = 0 then null
      else round(100.0 * stats.completed / (stats.completed + stats.no_show), 2) end,
    stats.completed, 0, stats.no_show, now()
  from public.profiles p
  cross join lateral (
    select
      count(*) filter (where b.status = 'completed' and b.outcome_status in ('attended', 'attended_with_issues', 'assumed_attended'))::integer as completed,
      count(*) filter (where b.outcome_status = 'client_no_show')::integer as no_show
    from public.bookings b
    where b.consumer_id = p.id and b.starts_at >= now() - interval '12 months'
  ) stats
  where p.role = 'consumer'
  on conflict (profile_id) do update set
    role = excluded.role, reliability_percent = excluded.reliability_percent,
    completed_sessions = excluded.completed_sessions, late_cancellations = excluded.late_cancellations,
    no_shows = excluded.no_shows, updated_at = now();
end;
$$;
revoke all on function private.refresh_reliability() from public, anon, authenticated, service_role;

-- Deterministic lifecycle advancement; safe to call repeatedly from Cron and reads.
create or replace function public.advance_training_lifecycle()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  completed_count integer := 0;
  finalized_count integer := 0;
  revealed_count integer := 0;
  expired_count integer := 0;
begin
  with changed as (
    update public.bookings
    set status = 'completed', completed_at = coalesce(completed_at, ends_at),
        outcome_status = coalesce(outcome_status, 'assumed_attended'),
        outcome_window_ends_at = coalesce(outcome_window_ends_at, ends_at + interval '48 hours'),
        updated_at = now()
    where status = 'confirmed' and ends_at <= now()
    returning id
  ) select count(*) into completed_count from changed;

  with changed as (
    update public.bookings b
    set outcome_status = case
          when reports.report_count = 1 then reports.only_outcome
          else coalesce(nullif(b.outcome_status, 'assumed_attended'), 'attended')
        end,
        outcome_finalized_at = now(), updated_at = now()
    from (
      select booking_id, count(*) as report_count, min(outcome) as only_outcome,
        bool_and(outcome = first_value) as reports_agree
      from (
        select booking_id, outcome, first_value(outcome) over (partition by booking_id order by created_at) as first_value
        from public.session_reports
      ) report_rows
      group by booking_id
    ) reports
    where b.id = reports.booking_id and b.status = 'completed' and b.outcome_finalized_at is null
      and ((reports.report_count = 2 and reports.reports_agree)
        or (reports.report_count = 1 and exists (
          select 1 from public.session_reports sr where sr.booking_id = b.id and sr.response_due_at <= now()
        )))
    returning b.id
  ) select count(*) into finalized_count from changed;

  with defaults as (
    update public.bookings
    set outcome_status = 'attended', outcome_finalized_at = now(), updated_at = now()
    where status = 'completed' and outcome_finalized_at is null and outcome_window_ends_at <= now()
      and not exists (select 1 from public.session_reports sr where sr.booking_id = bookings.id)
    returning id
  ) select finalized_count + count(*) into finalized_count from defaults;

  update public.bookings b set outcome_status = 'disputed', status = 'disputed', updated_at = now()
  where b.status = 'completed' and b.outcome_finalized_at is null
    and exists (
      select 1 from public.session_reports a join public.session_reports c
        on c.booking_id = a.booking_id and c.author_id <> a.author_id and c.outcome <> a.outcome
      where a.booking_id = b.id
    );

  with changed as (
    update public.reviews r set revealed_at = now(), updated_at = now()
    where revealed_at is null and (
      reveal_after <= now() or (
        select count(*) from public.reviews pair where pair.booking_id = r.booking_id
      ) >= 2
    )
    returning subject_id
  ) select count(*) into revealed_count from changed;

  with expired as (
    update public.booking_requests set status = 'expired'
    where status = 'awaiting_coach' and expires_at <= now()
    returning id
  ) select count(*) into expired_count from expired;

  insert into public.lifecycle_jobs(kind, entity_id, payload)
  select 'cancel_authorization', coalesce(br.package_id, br.booking_id), jsonb_build_object('request_id', br.id)
  from public.booking_requests br
  where br.status = 'expired'
  on conflict (kind, entity_id) do nothing;

  perform private.refresh_reliability();

  return jsonb_build_object('completed', completed_count, 'finalized', finalized_count,
    'revealed', revealed_count, 'expired_requests', expired_count);
end;
$$;

revoke all on function public.advance_training_lifecycle() from public, anon, authenticated;
grant execute on function public.advance_training_lifecycle() to service_role;

-- Claim side-effecting jobs safely when more than one API/cron worker is active.
create or replace function public.claim_lifecycle_job()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claimed public.lifecycle_jobs;
begin
  with candidate as (
    select id from public.lifecycle_jobs
    where status = 'pending' and available_at <= now()
    order by available_at, id
    for update skip locked
    limit 1
  )
  update public.lifecycle_jobs job
  set status = 'processing', locked_at = now(), attempts = attempts + 1
  from candidate
  where job.id = candidate.id
  returning job.* into claimed;
  if claimed.id is null then
    return null;
  end if;
  return to_jsonb(claimed);
end;
$$;

create or replace function public.finish_lifecycle_job(p_job_id bigint, p_error text default null)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  with changed as (
    update public.lifecycle_jobs
    set status = case when p_error is null then 'completed' else 'failed' end,
        completed_at = case when p_error is null then now() else null end,
        last_error = p_error
    where id = p_job_id and status = 'processing'
    returning id
  )
  select exists(select 1 from changed);
$$;

revoke all on function public.claim_lifecycle_job() from public, anon, authenticated;
revoke all on function public.finish_lifecycle_job(bigint, text) from public, anon, authenticated;
grant execute on function public.claim_lifecycle_job() to service_role;
grant execute on function public.finish_lifecycle_job(bigint, text) to service_role;

-- RLS defense in depth.
alter table public.booking_series enable row level security;
alter table public.session_credits enable row level security;
alter table public.booking_requests enable row level security;
alter table public.session_reports enable row level security;
alter table public.review_replies enable row level security;
alter table public.reputation_summaries enable row level security;
alter table public.coach_response_samples enable row level security;
alter table public.lifecycle_jobs enable row level security;

create policy "series participants read" on public.booking_series for select to authenticated
using (consumer_id = (select auth.uid()) or coach_id = (select auth.uid()));
create policy "credits participants read" on public.session_credits for select to authenticated
using (consumer_id = (select auth.uid()) or coach_id = (select auth.uid()));
create policy "requests participants read" on public.booking_requests for select to authenticated
using (consumer_id = (select auth.uid()) or coach_id = (select auth.uid()));
create policy "reports participants read" on public.session_reports for select to authenticated
using (exists (
  select 1 from public.bookings b where b.id = booking_id
    and (b.consumer_id = (select auth.uid()) or b.coach_id = (select auth.uid()))
));
create policy "coach review replies public read" on public.review_replies for select to anon, authenticated
using (moderation_status = 'visible' and exists (
  select 1 from public.reviews r where r.id = review_id and r.target_role = 'coach'
    and r.published = true and r.revealed_at is not null and r.moderation_status = 'visible'
));
create policy "coach reputation public client reputation related" on public.reputation_summaries for select to authenticated
using (
  role = 'coach'
  or profile_id = (select auth.uid())
  or exists (
    select 1 from public.bookings b where b.consumer_id = reputation_summaries.profile_id
      and b.coach_id = (select auth.uid())
  )
  or exists (
    select 1 from public.conversations c where c.consumer_id = reputation_summaries.profile_id
      and c.coach_id = (select auth.uid())
  )
);

drop policy if exists "reviews public read" on public.reviews;
create policy "revealed coach reviews public related client reviews" on public.reviews for select to anon, authenticated
using (
  published = true and moderation_status = 'visible' and revealed_at is not null and (
    target_role = 'coach'
    or subject_id = (select auth.uid())
    or (
      target_role = 'consumer' and exists (
        select 1 from public.bookings b where b.consumer_id = reviews.subject_id
          and b.coach_id = (select auth.uid())
      )
    )
  )
);

-- Backend service role owns mutations. Browser grants remain deliberately read-only.
grant select, insert, update, delete on public.booking_series, public.session_credits,
  public.booking_requests, public.session_reports, public.review_replies,
  public.reputation_summaries, public.coach_response_samples, public.lifecycle_jobs to service_role;
grant usage, select on sequence public.lifecycle_jobs_id_seq to service_role;
grant select on public.booking_series, public.session_credits, public.booking_requests,
  public.session_reports, public.review_replies, public.reputation_summaries to authenticated;
grant select on public.review_replies to anon;
