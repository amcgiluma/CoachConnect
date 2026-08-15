-- A review is eligible as soon as the client has confirmed their own
-- attendance, even while the bilateral outcome window is still open.

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
    and (
      b.outcome_status in ('attended', 'attended_with_issues', 'assumed_attended')
      or exists (
        select 1 from public.session_reports sr
        where sr.booking_id = b.id
          and sr.author_id = p_consumer_id
          and sr.outcome in ('attended', 'attended_with_issues')
      )
    );

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
      '/cuenta#cliente-rewards',
      'client-reward:' || p_consumer_id::text || ':' || next_tier
    )
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
  end if;
end;
$$;

revoke all on function private.refresh_client_reward(uuid)
from public, anon, authenticated, service_role;

update public.notifications
set action_url = '/cuenta#cliente-rewards'
where kind = 'client_reward'
  and action_url = '/reservas#cliente-rewards';

notify pgrst, 'reload schema';
