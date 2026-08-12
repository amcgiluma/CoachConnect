-- Let coaches decide whether a prepaid plan repeats a fixed weekly pattern or
-- lets the customer combine any published dates. Existing plans remain fixed.
alter table public.coach_services
  add column if not exists recurring_schedule_mode text not null default 'fixed';

alter table public.coach_services
  add constraint coach_services_recurring_schedule_mode_check
  check (recurring_schedule_mode in ('fixed', 'flexible'));

alter table public.coach_services
  drop constraint if exists coach_services_offer_configuration_check;
alter table public.coach_services
  add constraint coach_services_offer_configuration_check check (
    (offer_type = 'single' and package_size = 1 and expiry_days is null and cadence_weeks is null)
    or (offer_type = 'flex_pack' and package_size between 2 and 24 and expiry_days between 30 and 365 and cadence_weeks is null)
    or (offer_type = 'recurring_plan' and package_size between 2 and 24 and expiry_days between 30 and 365
      and (
        (recurring_schedule_mode = 'fixed' and cadence_weeks in (1, 2))
        or (recurring_schedule_mode = 'flexible' and cadence_weeks is null)
      ))
  );

-- A flexible series deliberately has no weekly cadence. The existing check
-- already accepts NULL; only the legacy NOT NULL flag needs relaxing.
alter table public.booking_series
  alter column cadence_weeks drop not null;

-- Preserve any historical self-booking that exposed the bug, while rejecting
-- every new one at the database boundary as defence in depth.
alter table public.bookings
  add constraint bookings_parties_are_distinct check (consumer_id <> coach_id) not valid;
alter table public.booking_packages
  add constraint booking_packages_parties_are_distinct check (consumer_id <> coach_id) not valid;
alter table public.booking_series
  add constraint booking_series_parties_are_distinct check (consumer_id <> coach_id) not valid;
alter table public.session_credits
  add constraint session_credits_parties_are_distinct check (consumer_id <> coach_id) not valid;

comment on column public.coach_services.recurring_schedule_mode is
  'fixed generates a weekly/fortnightly pattern; flexible lets the customer choose every occurrence before checkout';
