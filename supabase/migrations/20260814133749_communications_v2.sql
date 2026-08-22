-- Durable, channel-aware communications, calendar sync and private logistics.
-- Public tables are explicitly protected with RLS. Operational/private tables
-- remain service-role only and deliberately have no user policies.

alter table public.profiles
  add column if not exists timezone text not null default 'Europe/Madrid';

alter table public.coach_services
  add column if not exists location_policy text not null default 'agreed',
  add column if not exists public_area_label text;

alter table public.coach_services
  drop constraint if exists coach_services_location_policy_check;
alter table public.coach_services
  add constraint coach_services_location_policy_check
  check (location_policy in ('fixed_private', 'travel', 'agreed'));

alter table public.payments
  add column if not exists stripe_receipt_url text;

alter table public.integration_connections
  add column if not exists calendar_enabled boolean not null default false,
  add column if not exists calendar_id text not null default 'primary';

create table public.notification_preferences (
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category in ('reminders', 'chat', 'reviews', 'summaries')),
  email_enabled boolean not null default true,
  in_app_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, category)
);

create table public.conversation_read_states (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  last_read_message_id uuid references public.messages(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table public.service_private_locations (
  service_id uuid primary key references public.coach_services(id) on delete cascade,
  address_line text not null,
  locality text not null,
  postal_code text not null default '',
  latitude numeric,
  longitude numeric,
  instructions text not null default '',
  updated_at timestamptz not null default now(),
  check (char_length(btrim(address_line)) between 3 and 240),
  check (char_length(btrim(locality)) between 2 and 120),
  check (char_length(instructions) <= 1000)
);

create table public.booking_private_locations (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  source text not null check (source in ('service_snapshot', 'coach_confirmed')),
  address_line text not null,
  locality text not null,
  postal_code text not null default '',
  latitude numeric,
  longitude numeric,
  instructions text not null default '',
  confirmed_by uuid not null references public.profiles(id),
  confirmed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(btrim(address_line)) between 3 and 240),
  check (char_length(btrim(locality)) between 2 and 120),
  check (char_length(instructions) <= 1000)
);

create table public.booking_reschedule_requests (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  proposed_by uuid not null references public.profiles(id),
  proposed_starts_at timestamptz not null,
  proposed_ends_at timestamptz not null,
  reason text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'expired', 'cancelled')),
  expires_at timestamptz not null,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (proposed_ends_at > proposed_starts_at),
  check (char_length(reason) <= 500)
);

create unique index booking_reschedule_one_pending_idx
  on public.booking_reschedule_requests(booking_id)
  where status = 'pending';
create index booking_reschedule_participant_time_idx
  on public.booking_reschedule_requests(booking_id, created_at desc);

create table public.communication_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  aggregate_type text not null,
  aggregate_id uuid,
  actor_id uuid references public.profiles(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts smallint not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index communication_events_pending_idx
  on public.communication_events(available_at, created_at)
  where status = 'pending';

create table public.communication_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.communication_events(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  channel text not null check (channel in ('in_app', 'email', 'calendar', 'operations')),
  template_key text not null,
  locale text not null default 'es',
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'delivered', 'skipped', 'failed', 'dead')),
  attempts smallint not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, user_id, channel, template_key)
);

create index communication_deliveries_pending_idx
  on public.communication_deliveries(available_at, created_at)
  where status = 'pending';
create index communication_deliveries_provider_idx
  on public.communication_deliveries(provider_message_id)
  where provider_message_id is not null;
create index communication_deliveries_user_idx
  on public.communication_deliveries(user_id, created_at desc)
  where user_id is not null;

create table public.calendar_event_links (
  booking_id uuid not null references public.bookings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'google' check (provider = 'google'),
  external_event_id text not null,
  calendar_id text not null default 'primary',
  ical_uid text not null,
  sequence integer not null default 0 check (sequence >= 0),
  sync_status text not null default 'synced'
    check (sync_status in ('pending', 'synced', 'failed', 'deleted')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (booking_id, user_id, provider)
);
create index calendar_event_links_user_idx
  on public.calendar_event_links(user_id, updated_at desc);

create table public.email_suppressions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('hard_bounce', 'complaint', 'manual')),
  provider_event_id text,
  created_at timestamptz not null default now()
);

create table public.resend_webhook_events (
  id text primary key,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.notifications
  add column if not exists event_id uuid references public.communication_events(id) on delete set null,
  add column if not exists category text not null default 'transactional',
  add column if not exists priority text not null default 'normal',
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.notifications
  drop constraint if exists notifications_priority_check;
alter table public.notifications
  add constraint notifications_priority_check check (priority in ('low', 'normal', 'high', 'critical'));

create unique index notifications_event_user_kind_idx
  on public.notifications(event_id, user_id, kind);

alter table public.notification_preferences enable row level security;
alter table public.conversation_read_states enable row level security;
alter table public.service_private_locations enable row level security;
alter table public.booking_private_locations enable row level security;
alter table public.booking_reschedule_requests enable row level security;
alter table public.communication_events enable row level security;
alter table public.communication_deliveries enable row level security;
alter table public.calendar_event_links enable row level security;
alter table public.email_suppressions enable row level security;
alter table public.resend_webhook_events enable row level security;
alter table public.stripe_webhook_events enable row level security;

create policy "notification preferences own read" on public.notification_preferences
  for select to authenticated using (user_id = (select auth.uid()));
create policy "notification preferences own insert" on public.notification_preferences
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "notification preferences own update" on public.notification_preferences
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "conversation read states own read" on public.conversation_read_states
  for select to authenticated using (user_id = (select auth.uid()));
create policy "conversation read states own insert" on public.conversation_read_states
  for insert to authenticated with check (
    user_id = (select auth.uid()) and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and ((select auth.uid()) in (c.consumer_id, c.coach_id))
    )
  );
create policy "conversation read states own update" on public.conversation_read_states
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "reschedule participants read" on public.booking_reschedule_requests
  for select to authenticated using (exists (
    select 1 from public.bookings b where b.id = booking_id
      and ((select auth.uid()) in (b.consumer_id, b.coach_id))
  ));

grant select, insert, update on public.notification_preferences to authenticated;
grant select, insert, update on public.conversation_read_states to authenticated;
grant select on public.booking_reschedule_requests to authenticated;

grant all on public.notification_preferences, public.conversation_read_states,
  public.service_private_locations, public.booking_private_locations,
  public.booking_reschedule_requests, public.communication_events,
  public.communication_deliveries, public.calendar_event_links,
  public.email_suppressions, public.resend_webhook_events to service_role;

create or replace function public.claim_communication_event()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claimed public.communication_events;
begin
  with candidate as (
    select id from public.communication_events
    where status = 'pending' and available_at <= now()
    order by available_at, created_at
    for update skip locked
    limit 1
  )
  update public.communication_events event
  set status = 'processing', locked_at = now(), attempts = attempts + 1
  from candidate
  where event.id = candidate.id
  returning event.* into claimed;
  return case when claimed.id is null then null else to_jsonb(claimed) end;
end;
$$;

create or replace function public.finish_communication_event(p_event_id uuid, p_error text default null)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  with changed as (
    update public.communication_events
    set status = case when p_error is null then 'completed'
                      when attempts >= 5 then 'failed' else 'pending' end,
        available_at = case when p_error is null or attempts >= 5 then available_at
                            else now() + (array['1 minute','5 minutes','30 minutes','2 hours']::interval[])[least(attempts, 4)] end,
        completed_at = case when p_error is null then now() else null end,
        locked_at = null,
        last_error = p_error
    where id = p_event_id and status = 'processing'
    returning id
  ) select exists(select 1 from changed);
$$;

create or replace function public.claim_communication_delivery()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claimed public.communication_deliveries;
begin
  with candidate as (
    select id from public.communication_deliveries
    where status = 'pending' and available_at <= now()
    order by available_at, created_at
    for update skip locked
    limit 1
  )
  update public.communication_deliveries delivery
  set status = 'processing', locked_at = now(), attempts = attempts + 1, updated_at = now()
  from candidate
  where delivery.id = candidate.id
  returning delivery.* into claimed;
  return case when claimed.id is null then null else to_jsonb(claimed) end;
end;
$$;

create or replace function public.finish_communication_delivery(
  p_delivery_id uuid,
  p_status text,
  p_provider_message_id text default null,
  p_error text default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed_count integer;
begin
  if p_status not in ('sent', 'delivered', 'skipped', 'failed') then
    raise exception 'Invalid delivery status' using errcode = '22023';
  end if;
  update public.communication_deliveries
  set status = case when p_status = 'failed' and attempts < 5 then 'pending'
                    when p_status = 'failed' then 'dead' else p_status end,
      available_at = case when p_status = 'failed' and attempts < 5
        then now() + (array['1 minute','5 minutes','30 minutes','2 hours']::interval[])[least(attempts, 4)]
        else available_at end,
      sent_at = case when p_status in ('sent', 'delivered') then now() else sent_at end,
      provider_message_id = coalesce(p_provider_message_id, provider_message_id),
      last_error = p_error,
      locked_at = null,
      updated_at = now()
  where id = p_delivery_id and status = 'processing';
  get diagnostics changed_count = row_count;
  return changed_count = 1;
end;
$$;

create or replace function public.accept_booking_reschedule(p_request_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  requested public.booking_reschedule_requests;
  booked public.bookings;
begin
  select * into requested from public.booking_reschedule_requests
  where id = p_request_id for update;
  if requested.id is null or requested.status <> 'pending' then
    raise exception 'Solicitud de cambio no disponible' using errcode = 'P0001';
  end if;
  select * into booked from public.bookings where id = requested.booking_id for update;
  if p_user_id not in (booked.consumer_id, booked.coach_id) or p_user_id = requested.proposed_by then
    raise exception 'No puedes aceptar esta solicitud' using errcode = '42501';
  end if;
  if booked.status <> 'confirmed' or requested.expires_at <= now()
    or least(booked.starts_at, requested.proposed_starts_at) <= now() + interval '24 hours' then
    raise exception 'La solicitud ha caducado o está fuera de plazo' using errcode = 'P0001';
  end if;
  update public.bookings set starts_at = requested.proposed_starts_at,
    ends_at = requested.proposed_ends_at, updated_at = now()
  where id = booked.id;
  update public.booking_reschedule_requests set status = 'accepted', decided_by = p_user_id,
    decided_at = now(), updated_at = now() where id = requested.id;
  return jsonb_build_object('request_id', requested.id, 'booking_id', booked.id,
    'old_starts_at', booked.starts_at, 'new_starts_at', requested.proposed_starts_at,
    'new_ends_at', requested.proposed_ends_at);
end;
$$;

revoke all on function public.claim_communication_event() from public, anon, authenticated;
revoke all on function public.finish_communication_event(uuid, text) from public, anon, authenticated;
revoke all on function public.claim_communication_delivery() from public, anon, authenticated;
revoke all on function public.finish_communication_delivery(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.accept_booking_reschedule(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_communication_event() to service_role;
grant execute on function public.finish_communication_event(uuid, text) to service_role;
grant execute on function public.claim_communication_delivery() to service_role;
grant execute on function public.finish_communication_delivery(uuid, text, text, text) to service_role;
grant execute on function public.accept_booking_reschedule(uuid, uuid) to service_role;
