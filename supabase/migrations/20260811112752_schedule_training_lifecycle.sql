-- Advance completed sessions, bilateral outcomes and review reveal windows
-- independently from API traffic. The named job is safe to update/re-run.
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'coachconnect-training-lifecycle',
  '* * * * *',
  'select public.advance_training_lifecycle()'
);
