-- CoachConnect MVP: auth bootstrap, catalog, scheduling, chat, payments and storage.

alter table public.profiles
  add column if not exists avatar_url text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.coach_profiles
  add column if not exists languages text[] not null default array['es']::text[],
  add column if not exists years_experience integer not null default 0 check (years_experience >= 0),
  add column if not exists latitude numeric(9,6),
  add column if not exists longitude numeric(9,6),
  add column if not exists video_path text,
  add column if not exists verification_note text,
  add column if not exists preferred_video_provider text not null default 'meet'
    check (preferred_video_provider in ('meet', 'zoom', 'custom'));

alter table public.bookings
  add column if not exists notes text not null default '',
  add column if not exists meeting_provider text not null default 'meet'
    check (meeting_provider in ('meet', 'zoom', 'custom')),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.credential_documents (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coach_profiles(user_id) on delete cascade,
  kind text not null default 'qualification'
    check (kind in ('qualification', 'identity', 'insurance', 'other')),
  title text not null,
  storage_path text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coach_profiles(user_id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  available boolean not null default false,
  label text not null default '',
  check (ends_at > starts_at)
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  consumer_id uuid not null references public.profiles(id) on delete cascade,
  coach_id uuid not null references public.coach_profiles(user_id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (consumer_id, coach_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '',
  attachment_path text,
  read_at timestamptz,
  reported_at timestamptz,
  created_at timestamptz not null default now(),
  check (char_length(body) > 0 or attachment_path is not null),
  check (char_length(body) <= 4000)
);

create table if not exists public.booking_packages (
  id uuid primary key default gen_random_uuid(),
  consumer_id uuid not null references public.profiles(id),
  coach_id uuid not null references public.coach_profiles(user_id),
  service_id uuid not null references public.coach_services(id),
  total_sessions integer not null check (total_sessions > 1),
  used_sessions integer not null default 0 check (used_sessions >= 0),
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'active' check (status in ('pending', 'active', 'used', 'expired', 'refunded')),
  created_at timestamptz not null default now(),
  check (used_sessions <= total_sessions)
);

alter table public.bookings
  add column if not exists package_id uuid references public.booking_packages(id) on delete set null;

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid unique references public.bookings(id) on delete cascade,
  package_id uuid unique references public.booking_packages(id) on delete cascade,
  consumer_id uuid not null references public.profiles(id),
  coach_id uuid not null references public.coach_profiles(user_id),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  amount_cents integer not null check (amount_cents > 0),
  platform_fee_cents integer not null check (platform_fee_cents >= 0),
  currency text not null default 'eur',
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'refunded', 'partially_refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((booking_id is not null)::integer + (package_id is not null)::integer = 1)
);

create table if not exists public.cancellations (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid unique not null references public.bookings(id) on delete cascade,
  cancelled_by uuid not null references public.profiles(id),
  reason text not null default '',
  refund_cents integer not null default 0 check (refund_cents >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  action_url text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('google', 'zoom', 'custom')),
  encrypted_access_token text,
  encrypted_refresh_token text,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id),
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  reported_user_id uuid references public.profiles(id) on delete set null,
  reason text not null,
  details text not null default '',
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- New Auth users always start as consumers. Role elevation is server/admin-only.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, locale)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), nullif(split_part(new.email, '@', 1), ''), 'Usuario'),
    coalesce(nullif(new.raw_user_meta_data ->> 'locale', ''), 'es')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure private.handle_new_user();

-- Public catalog seed. Parent references are resolved by slug, never generated IDs.
insert into public.categories (slug, name_es, name_en, sort_order)
values
  ('fitness', 'Fitness y fuerza', 'Fitness & strength', 10),
  ('martial', 'Artes marciales', 'Martial arts', 20),
  ('running', 'Running y resistencia', 'Running & endurance', 30),
  ('mobility', 'Movilidad y cuerpo', 'Mobility & body', 40),
  ('sport', 'PreparaciÃ³n deportiva', 'Sports performance', 50),
  ('dance', 'Danza y movimiento', 'Dance & movement', 60),
  ('outdoor', 'Entrenamiento exterior', 'Outdoor training', 70),
  ('wellbeing', 'Bienestar aplicado', 'Applied wellbeing', 80)
on conflict (slug) do update set
  name_es = excluded.name_es,
  name_en = excluded.name_en,
  sort_order = excluded.sort_order,
  active = true;

with child(parent_slug, slug, name_es, name_en, sort_order) as (
  values
    ('fitness','musculacion','MusculaciÃ³n','Strength training',11),
    ('fitness','perdida-peso','PÃ©rdida de peso','Weight loss',12),
    ('fitness','funcional','Entrenamiento funcional','Functional training',13),
    ('fitness','calistenia','Calistenia','Calisthenics',14),
    ('martial','muay-thai','Muay Thai','Muay Thai',21),
    ('martial','boxeo','Boxeo','Boxing',22),
    ('martial','karate','Karate','Karate',23),
    ('martial','kung-fu','Kung fu','Kung fu',24),
    ('martial','judo','Judo','Judo',25),
    ('martial','mma','MMA','MMA',26),
    ('running','running-road','Running','Running',31),
    ('running','trail','Trail','Trail running',32),
    ('running','ciclismo','Ciclismo','Cycling',33),
    ('running','natacion','NataciÃ³n','Swimming',34),
    ('mobility','yoga','Yoga','Yoga',41),
    ('mobility','pilates','Pilates','Pilates',42),
    ('mobility','flexibilidad','Flexibilidad','Flexibility',43),
    ('mobility','movilidad','Movilidad','Mobility',44),
    ('sport','futbol','FÃºtbol','Football',51),
    ('sport','padel','PÃ¡del','Padel',52),
    ('sport','tenis','Tenis','Tennis',53),
    ('sport','rendimiento','Rendimiento','Performance',54),
    ('dance','danza-urbana','Danza urbana','Urban dance',61),
    ('dance','ballet','Ballet','Ballet',62),
    ('dance','contemporaneo','ContemporÃ¡neo','Contemporary',63),
    ('outdoor','parque','Entrenamiento en parque','Park training',71),
    ('outdoor','grupo','Entreno en grupo','Group training',72),
    ('wellbeing','nutricion','NutriciÃ³n deportiva','Sports nutrition',81),
    ('wellbeing','habitos','HÃ¡bitos','Habits',82),
    ('wellbeing','recuperacion','RecuperaciÃ³n','Recovery',83)
)
insert into public.categories (slug, name_es, name_en, parent_id, sort_order)
select child.slug, child.name_es, child.name_en, parent.id, child.sort_order
from child
join public.categories parent on parent.slug = child.parent_slug
on conflict (slug) do update set
  name_es = excluded.name_es,
  name_en = excluded.name_en,
  parent_id = excluded.parent_id,
  sort_order = excluded.sort_order,
  active = true;

-- RLS on every exposed table.
alter table public.credential_documents enable row level security;
alter table public.availability_exceptions enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.booking_packages enable row level security;
alter table public.payments enable row level security;
alter table public.cancellations enable row level security;
alter table public.notifications enable row level security;
alter table public.integration_connections enable row level security;
alter table public.reports enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles public coach read" on public.profiles for select to anon, authenticated
using (exists (
  select 1 from public.coach_profiles cp
  where cp.user_id = profiles.id
    and cp.verification_status in ('credentials_submitted', 'under_review', 'verified')
));

create policy "coach profiles insert own" on public.coach_profiles for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'coach')
);

create policy "credentials own read" on public.credential_documents for select to authenticated
using (coach_id = (select auth.uid()));
create policy "credentials own insert" on public.credential_documents for insert to authenticated
with check (coach_id = (select auth.uid()));
create policy "credentials own delete" on public.credential_documents for delete to authenticated
using (coach_id = (select auth.uid()) and status <> 'approved');

create policy "exceptions public or own read" on public.availability_exceptions for select to anon, authenticated
using (
  coach_id = (select auth.uid())
  or exists (select 1 from public.coach_profiles cp where cp.user_id = coach_id and cp.verification_status = 'verified')
);
create policy "exceptions own insert" on public.availability_exceptions for insert to authenticated
with check (coach_id = (select auth.uid()));
create policy "exceptions own update" on public.availability_exceptions for update to authenticated
using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));
create policy "exceptions own delete" on public.availability_exceptions for delete to authenticated
using (coach_id = (select auth.uid()));

create policy "conversation participants read" on public.conversations for select to authenticated
using (consumer_id = (select auth.uid()) or coach_id = (select auth.uid()));
create policy "consumer starts conversation" on public.conversations for insert to authenticated
with check (
  consumer_id = (select auth.uid())
  and exists (select 1 from public.coach_profiles cp where cp.user_id = coach_id and cp.verification_status = 'verified')
);
create policy "conversation participants update" on public.conversations for update to authenticated
using (consumer_id = (select auth.uid()) or coach_id = (select auth.uid()))
with check (consumer_id = (select auth.uid()) or coach_id = (select auth.uid()));

create policy "message participants read" on public.messages for select to authenticated
using (exists (
  select 1 from public.conversations c where c.id = conversation_id
  and (c.consumer_id = (select auth.uid()) or c.coach_id = (select auth.uid()))
));
create policy "message participants insert" on public.messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and exists (
    select 1 from public.conversations c where c.id = conversation_id
    and (c.consumer_id = (select auth.uid()) or c.coach_id = (select auth.uid()))
  )
);

create policy "package participants read" on public.booking_packages for select to authenticated
using (consumer_id = (select auth.uid()) or coach_id = (select auth.uid()));
create policy "payment participants read" on public.payments for select to authenticated
using (consumer_id = (select auth.uid()) or coach_id = (select auth.uid()));
create policy "cancellation participants read" on public.cancellations for select to authenticated
using (exists (
  select 1 from public.bookings b where b.id = booking_id
  and (b.consumer_id = (select auth.uid()) or b.coach_id = (select auth.uid()))
));
create policy "notifications own read" on public.notifications for select to authenticated
using (user_id = (select auth.uid()));
create policy "notifications own update" on public.notifications for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "integrations own read" on public.integration_connections for select to authenticated
using (user_id = (select auth.uid()));
create policy "reports own insert" on public.reports for insert to authenticated
with check (reporter_id = (select auth.uid()));
create policy "reports own read" on public.reports for select to authenticated
using (reporter_id = (select auth.uid()));

drop policy if exists "reviews consumer insert" on public.reviews;
create policy "reviews consumer insert" on public.reviews for insert to authenticated
with check (
  consumer_id = (select auth.uid())
  and exists (
    select 1 from public.bookings b
    where b.id = booking_id and b.consumer_id = (select auth.uid())
      and b.coach_id = reviews.coach_id and b.status = 'completed'
  )
);

-- Users cannot elevate their own role through the Data API.
revoke update on public.profiles from anon, authenticated;
grant update (display_name, locale, avatar_url, updated_at) on public.profiles to authenticated;

grant usage on schema public to anon, authenticated;
grant select on public.categories, public.coach_profiles, public.coach_services,
  public.availability_rules, public.availability_exceptions, public.reviews to anon, authenticated;
grant select, insert, update on public.profiles, public.conversations to authenticated;
grant select, insert on public.messages, public.reports to authenticated;
grant select on public.bookings, public.booking_packages, public.payments, public.cancellations,
  public.notifications, public.integration_connections, public.credential_documents to authenticated;

-- Storage buckets and folder-based policies. All are private.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('credentials', 'credentials', false, 10485760, array['application/pdf','image/jpeg','image/png']),
  ('coach-videos', 'coach-videos', false, 104857600, array['video/mp4','video/webm']),
  ('chat-files', 'chat-files', false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "credential owner upload" on storage.objects for insert to authenticated
with check (bucket_id = 'credentials' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "credential owner read" on storage.objects for select to authenticated
using (bucket_id = 'credentials' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "credential owner delete" on storage.objects for delete to authenticated
using (bucket_id = 'credentials' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "coach video owner upload" on storage.objects for insert to authenticated
with check (bucket_id = 'coach-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "coach video owner read" on storage.objects for select to authenticated
using (bucket_id = 'coach-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "coach video owner update" on storage.objects for update to authenticated
using (bucket_id = 'coach-videos' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'coach-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "chat participant upload" on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-files'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and exists (
    select 1 from public.conversations c
    where c.id::text = (storage.foldername(name))[1]
      and (c.consumer_id = (select auth.uid()) or c.coach_id = (select auth.uid()))
  )
);
create policy "chat participant read" on storage.objects for select to authenticated
using (
  bucket_id = 'chat-files'
  and exists (
    select 1 from public.conversations c
    where c.id::text = (storage.foldername(name))[1]
      and (c.consumer_id = (select auth.uid()) or c.coach_id = (select auth.uid()))
  )
);

create index if not exists credential_documents_coach_idx on public.credential_documents(coach_id);
create index if not exists availability_exceptions_coach_time_idx on public.availability_exceptions(coach_id, starts_at);
create index if not exists conversations_consumer_idx on public.conversations(consumer_id, last_message_at desc);
create index if not exists conversations_coach_idx on public.conversations(coach_id, last_message_at desc);
create index if not exists messages_conversation_time_idx on public.messages(conversation_id, created_at);
create index if not exists booking_packages_consumer_idx on public.booking_packages(consumer_id);
create index if not exists booking_packages_coach_idx on public.booking_packages(coach_id);
create index if not exists payments_consumer_idx on public.payments(consumer_id);
create index if not exists payments_coach_idx on public.payments(coach_id);
create index if not exists notifications_user_time_idx on public.notifications(user_id, created_at desc);
create index if not exists reports_reporter_idx on public.reports(reporter_id);
create index if not exists reports_status_idx on public.reports(status, created_at);
create index if not exists audit_logs_actor_idx on public.audit_logs(actor_id, created_at desc);
create index if not exists bookings_package_idx on public.bookings(package_id);

-- Realtime delivery for chat and notifications.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

;
