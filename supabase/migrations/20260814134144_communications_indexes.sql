-- Cover relationship lookups reported by the Supabase performance advisor.
create index booking_private_locations_confirmed_by_idx
  on public.booking_private_locations(confirmed_by);
create index booking_reschedule_requests_proposed_by_idx
  on public.booking_reschedule_requests(proposed_by);
create index booking_reschedule_requests_decided_by_idx
  on public.booking_reschedule_requests(decided_by)
  where decided_by is not null;
create index communication_events_actor_id_idx
  on public.communication_events(actor_id)
  where actor_id is not null;
create index conversation_read_states_user_id_idx
  on public.conversation_read_states(user_id);
create index conversation_read_states_last_message_idx
  on public.conversation_read_states(last_read_message_id)
  where last_read_message_id is not null;

-- NULL user IDs identify operations deliveries and need their own idempotency
-- guard because regular unique constraints consider NULL values distinct.
create unique index communication_deliveries_operations_unique_idx
  on public.communication_deliveries(event_id, channel, template_key)
  where user_id is null;
