-- The application communication scheduler now owns post-session prompts so
-- user preferences and channel idempotency are applied consistently.
drop trigger if exists bookings_enqueue_feedback on public.bookings;
