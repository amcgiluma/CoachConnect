-- Keep a single permissive SELECT policy for reports to avoid evaluating
-- overlapping policies for authenticated users.

drop policy if exists "reports admin read" on public.reports;
drop policy if exists "reports own read" on public.reports;

create policy "reports own or admin read"
on public.reports
for select
to authenticated
using (
  reporter_id = (select auth.uid())
  or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
);
