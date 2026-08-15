-- Configurable request lead time, durable feedback reminders and customer rewards.
-- Browser access remains read-only; all mutations are owned by the trusted API
-- or by narrowly scoped database triggers.

alter table public.coach_services
  add column if not exists request_booking_notice_minutes integer not null default 2160;

alter table public.coach_services
  drop constraint if exists coach_services_request_booking_notice_check;
alter table public.coach_services
  add constraint coach_services_request_booking_notice_check check (
    request_booking_notice_minutes between 60 and 10080
    and request_booking_notice_minutes >= acceptance_window_hours * 60
  );

comment on column public.coach_services.request_booking_notice_minutes is
  'Minimum lead time for services that require coach approval; instant services use coach_profiles.min_booking_notice_minutes.';

alter table public.notifications
  add column if not exists dedupe_key text;

create unique index if not exists notifications_dedupe_key_idx
  on public.notifications(dedupe_key)
  where dedupe_key is not null;

alter table public.payments
  add column if not exists platform_fee_rate_bps integer,
  add column if not exists client_reward_tier text not null default 'standard';

update public.payments
set platform_fee_rate_bps = least(10000, greatest(0, round(platform_fee_cents::numeric * 10000 / amount_cents)::integer))
where platform_fee_rate_bps is null;

alter table public.payments
  alter column platform_fee_rate_bps set default 1500,
  alter column platform_fee_rate_bps set not null;

alter table public.payments
  drop constraint if exists payments_platform_fee_rate_bps_check;
alter table public.payments
  add constraint payments_platform_fee_rate_bps_check
  check (platform_fee_rate_bps between 0 and 10000);

alter table public.payments
  drop constraint if exists payments_client_reward_tier_check;
alter table public.payments
  add constraint payments_client_reward_tier_check
  check (client_reward_tier in ('standard', 'bronze', 'silver', 'gold'));

create table if not exists public.client_rewards (
  consumer_id uuid primary key references public.profiles(id) on delete cascade,
  qualifying_review_count integer not null default 0 check (qualifying_review_count >= 0),
  tier text not null default 'standard' check (tier in ('standard', 'bronze', 'silver', 'gold')),
  commission_discount_bps integer not null default 0 check (commission_discount_bps in (0, 100, 200, 300)),
  updated_at timestamptz not null default now()
);

alter table public.client_rewards enable row level security;

drop policy if exists "client rewards own or related coach read" on public.client_rewards;
create policy "client rewards own or related coach read"
on public.client_rewards for select to authenticated
using (
  consumer_id = (select auth.uid())
  or exists (
    select 1 from public.bookings b
    where b.consumer_id = client_rewards.consumer_id
      and b.coach_id = (select auth.uid())
  )
  or exists (
    select 1 from public.booking_requests br
    where br.consumer_id = client_rewards.consumer_id
      and br.coach_id = (select auth.uid())
  )
);

revoke all on public.client_rewards from anon, authenticated;
grant select on public.client_rewards to authenticated;
grant select, insert, update, delete on public.client_rewards to service_role;

create or replace function private.refresh_client_reward(p_consumer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  review_total integer := 0;
  previous_tier text := 'standard';
  next_tier text := 'standard';
  next_discount integer := 0;
  previous_rank integer := 0;
  next_rank integer := 0;
begin
  if p_consumer_id is null or not exists (
    select 1 from public.profiles where id = p_consumer_id
  ) then
    return;
  end if;

  select count(distinct r.booking_id)::integer
  into review_total
  from public.reviews r
  join public.bookings b on b.id = r.booking_id
  where r.author_id = p_consumer_id
    and r.target_role = 'coach'
    and r.published = true
    and r.moderation_status = 'visible'
    and b.status = 'completed'
    and b.outcome_status in ('attended', 'attended_with_issues', 'assumed_attended');

  if review_total >= 50 then
    next_tier := 'gold'; next_discount := 300; next_rank := 3;
  elsif review_total >= 25 then
    next_tier := 'silver'; next_discount := 200; next_rank := 2;
  elsif review_total >= 10 then
    next_tier := 'bronze'; next_discount := 100; next_rank := 1;
  end if;

  select tier,
    case tier when 'gold' then 3 when 'silver' then 2 when 'bronze' then 1 else 0 end
  into previous_tier, previous_rank
  from public.client_rewards
  where consumer_id = p_consumer_id;

  previous_tier := coalesce(previous_tier, 'standard');
  previous_rank := coalesce(previous_rank, 0);

  insert into public.client_rewards(
    consumer_id, qualifying_review_count, tier, commission_discount_bps, updated_at
  ) values (
    p_consumer_id, review_total, next_tier, next_discount, now()
  )
  on conflict (consumer_id) do update set
    qualifying_review_count = excluded.qualifying_review_count,
    tier = excluded.tier,
    commission_discount_bps = excluded.commission_discount_bps,
    updated_at = now();

  if next_rank > previous_rank then
    insert into public.notifications(user_id, kind, title, body, action_url, dedupe_key)
    values (
      p_consumer_id,
      'client_reward',
      'Has alcanzado el nivel ' || initcap(next_tier),
      'Tus próximas reservas ayudan al entrenador a pagar menos comisión cuando entrena contigo.',
      '/reservas#cliente-rewards',
      'client-reward:' || p_consumer_id::text || ':' || next_tier
    )
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
  end if;
end;
$$;

revoke all on function private.refresh_client_reward(uuid)
from public, anon, authenticated, service_role;

create or replace function private.on_review_client_reward_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.target_role = 'coach' then
      perform private.refresh_client_reward(old.author_id);
    end if;
  elsif tg_op = 'INSERT' then
    if new.target_role = 'coach' then
      perform private.refresh_client_reward(new.author_id);
    end if;
  else
    if old.target_role = 'coach'
       and (new.author_id is distinct from old.author_id or new.target_role is distinct from old.target_role) then
      perform private.refresh_client_reward(old.author_id);
    end if;
    if new.target_role = 'coach' then
      perform private.refresh_client_reward(new.author_id);
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function private.on_review_client_reward_change()
from public, anon, authenticated, service_role;

drop trigger if exists reviews_refresh_client_reward on public.reviews;
create trigger reviews_refresh_client_reward
after insert or update or delete on public.reviews
for each row execute function private.on_review_client_reward_change();

insert into public.client_rewards(consumer_id)
select id from public.profiles
on conflict (consumer_id) do nothing;

do $$
declare
  profile_row record;
begin
  for profile_row in select id from public.profiles loop
    perform private.refresh_client_reward(profile_row.id);
  end loop;
end;
$$;

create or replace function private.on_booking_completed_feedback()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed' and old.status is distinct from new.status then
    insert into public.notifications(user_id, kind, title, body, action_url, dedupe_key)
    values
      (
        new.consumer_id,
        'training_feedback',
        '¿Cómo ha ido tu entrenamiento?',
        'Confirma que la sesión se realizó y valora a tu entrenador.',
        '/reservas?booking=' || new.id::text || '&feedback=1',
        'training-feedback:' || new.id::text || ':' || new.consumer_id::text
      ),
      (
        new.coach_id,
        'training_feedback',
        'Cierra la sesión con tu cliente',
        'Confirma el resultado y deja tu valoración cuando corresponda.',
        '/profesional?tab=reviews&booking=' || new.id::text,
        'training-feedback:' || new.id::text || ':' || new.coach_id::text
      )
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
  end if;
  return new;
end;
$$;

revoke all on function private.on_booking_completed_feedback()
from public, anon, authenticated, service_role;

drop trigger if exists bookings_enqueue_feedback on public.bookings;
create trigger bookings_enqueue_feedback
after update of status on public.bookings
for each row execute function private.on_booking_completed_feedback();

-- Backfill one reminder per participant only when an action is still possible.
insert into public.notifications(user_id, kind, title, body, action_url, dedupe_key)
select participant.user_id,
  'training_feedback',
  case participant.perspective
    when 'consumer' then '¿Cómo ha ido tu entrenamiento?'
    else 'Cierra la sesión con tu cliente'
  end,
  case participant.perspective
    when 'consumer' then 'Confirma que la sesión se realizó y valora a tu entrenador.'
    else 'Confirma el resultado y deja tu valoración cuando corresponda.'
  end,
  case participant.perspective
    when 'consumer' then '/reservas?booking=' || b.id::text || '&feedback=1'
    else '/profesional?tab=reviews&booking=' || b.id::text
  end,
  'training-feedback:' || b.id::text || ':' || participant.user_id::text
from public.bookings b
cross join lateral (
  values (b.consumer_id, 'consumer'::text), (b.coach_id, 'coach'::text)
) as participant(user_id, perspective)
where b.status = 'completed'
  and (
    (b.outcome_finalized_at is null and not exists (
      select 1 from public.session_reports sr
      where sr.booking_id = b.id and sr.author_id = participant.user_id
    ))
    or (
      coalesce(b.outcome_finalized_at, b.ends_at) + interval '14 days' >= now()
      and not exists (
        select 1 from public.reviews r
        where r.booking_id = b.id and r.author_id = participant.user_id
      )
      and (
        b.outcome_status in ('attended', 'attended_with_issues', 'assumed_attended')
        or exists (
          select 1 from public.session_reports sr
          where sr.booking_id = b.id and sr.author_id = participant.user_id
            and sr.outcome in ('attended', 'attended_with_issues')
        )
      )
    )
  )
on conflict (dedupe_key) where dedupe_key is not null do nothing;

notify pgrst, 'reload schema';
