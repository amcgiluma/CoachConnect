create extension if not exists "pgcrypto";

create type public.user_role as enum ('consumer', 'coach', 'admin');
create type public.verification_status as enum ('draft', 'credentials_submitted', 'under_review', 'verified', 'rejected', 'suspended');
create type public.service_mode as enum ('online', 'presencial', 'hibrido');
create type public.booking_status as enum ('pending_payment', 'confirmed', 'cancelled', 'completed', 'disputed', 'refunded');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'consumer',
  display_name text not null,
  locale text not null default 'es',
  created_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name_es text not null,
  name_en text not null,
  parent_id uuid references public.categories(id) on delete cascade,
  sort_order integer not null default 0,
  active boolean not null default true
);

create table public.coach_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  headline text not null default '',
  bio text not null default '',
  city text,
  travel_radius_km integer,
  mode public.service_mode not null default 'online',
  verification_status public.verification_status not null default 'draft',
  responds_now boolean not null default false,
  rating numeric(2,1) not null default 0,
  review_count integer not null default 0,
  stripe_account_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.coach_services (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coach_profiles(user_id) on delete cascade,
  category_id uuid references public.categories(id),
  name text not null,
  description text not null default '',
  mode public.service_mode not null,
  duration_minutes integer not null check (duration_minutes > 0),
  price_cents integer not null check (price_cents > 0),
  package_size integer not null default 1 check (package_size > 0),
  active boolean not null default true
);

create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coach_profiles(user_id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  timezone text not null default 'Europe/Madrid'
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  consumer_id uuid not null references public.profiles(id),
  coach_id uuid not null references public.coach_profiles(user_id),
  service_id uuid not null references public.coach_services(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.booking_status not null default 'pending_payment',
  amount_cents integer not null,
  platform_fee_cents integer not null,
  stripe_payment_intent_id text,
  video_url text,
  created_at timestamptz not null default now()
);

create unique index bookings_no_double_slot on public.bookings(coach_id, starts_at) where status in ('pending_payment', 'confirmed');

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid unique not null references public.bookings(id),
  consumer_id uuid not null references public.profiles(id),
  coach_id uuid not null references public.coach_profiles(user_id),
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '',
  published boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.coach_profiles enable row level security;
alter table public.coach_services enable row level security;
alter table public.bookings enable row level security;
alter table public.reviews enable row level security;

create policy "profiles read own" on public.profiles for select using (auth.uid() = id);
create policy "profiles update own" on public.profiles for update using (auth.uid() = id);
create policy "coach profiles public read" on public.coach_profiles for select using (verification_status in ('credentials_submitted', 'under_review', 'verified'));
create policy "coach profiles update own" on public.coach_profiles for update using (auth.uid() = user_id);
create policy "active services public read" on public.coach_services for select using (active = true);
create policy "coach services own write" on public.coach_services for all using (auth.uid() = coach_id) with check (auth.uid() = coach_id);
create policy "bookings participants read" on public.bookings for select using (auth.uid() = consumer_id or auth.uid() = coach_id);
create policy "reviews public read" on public.reviews for select using (published = true);
;
