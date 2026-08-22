drop index if exists public.communication_deliveries_operations_unique_idx;

alter table public.communication_deliveries
  drop constraint if exists communication_deliveries_event_id_user_id_channel_template_key_key;
alter table public.communication_deliveries
  add constraint communication_deliveries_event_user_channel_template_key
  unique nulls not distinct (event_id, user_id, channel, template_key);
