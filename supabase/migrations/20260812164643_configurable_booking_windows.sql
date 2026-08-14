-- Booking lead time belongs to the professional, while the days and horizon
-- belong to each service. This keeps the public promise and slot generation
-- aligned without creating a second availability calendar.
alter table public.coach_profiles
  add column if not exists min_booking_notice_minutes integer not null default 30;

alter table public.coach_profiles
  drop constraint if exists coach_profiles_min_booking_notice_check;
alter table public.coach_profiles
  add constraint coach_profiles_min_booking_notice_check
  check (min_booking_notice_minutes between 0 and 10080);

alter table public.coach_services
  add column if not exists booking_window_days integer not null default 31,
  add column if not exists available_weekdays smallint[] not null default array[0, 1, 2, 3, 4, 5, 6]::smallint[],
  add column if not exists available_start_time time not null default time '00:00',
  add column if not exists available_end_time time not null default time '23:59:59';

alter table public.coach_services
  drop constraint if exists coach_services_booking_window_check;
alter table public.coach_services
  add constraint coach_services_booking_window_check
  check (booking_window_days between 7 and 365);

alter table public.coach_services
  drop constraint if exists coach_services_available_weekdays_check;
alter table public.coach_services
  add constraint coach_services_available_weekdays_check
  check (
    cardinality(available_weekdays) between 1 and 7
    and available_weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
  );

alter table public.coach_services
  drop constraint if exists coach_services_available_time_check;
alter table public.coach_services
  add constraint coach_services_available_time_check
  check (available_start_time < available_end_time);

comment on column public.coach_profiles.min_booking_notice_minutes is
  'Minimum lead time required before the start of any bookable session.';
comment on column public.coach_services.booking_window_days is
  'Maximum number of days into the future for which this service is bookable.';
comment on column public.coach_services.available_weekdays is
  'ISO weekday indexes (Monday=0) on which this service can use the coach availability rules.';
comment on column public.coach_services.available_start_time is
  'Earliest local start time at which this service can use a coach availability window.';
comment on column public.coach_services.available_end_time is
  'Latest local end time at which this service can use a coach availability window.';
