-- Email engine: per-user verification audit log.
-- Run this in the Supabase SQL editor (or `supabase db push`).

create table if not exists public.verifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  user_email    text,
  created_at    timestamptz not null default now(),
  kind          text not null check (kind in ('find', 'verify')),
  source        text not null default 'manual' check (source in ('manual', 'bulk')),
  first_name    text,
  last_name     text,
  domain        text,
  email         text not null default '',
  status        text not null check (status in ('valid', 'accept-all', 'invalid', 'not found')),
  confidence    numeric not null default 0,
  pattern_index int,
  api_calls     int not null default 0,
  credits_left  int
);

create index if not exists verifications_user_created_idx
  on public.verifications (user_id, created_at desc);
create index if not exists verifications_status_idx on public.verifications (status);
create index if not exists verifications_domain_idx on public.verifications (domain);
create index if not exists verifications_email_idx  on public.verifications (email);

-- Row Level Security: each user sees and writes only their own rows.
-- The admin dashboard reads via the secret (service-role) key, which bypasses RLS.
alter table public.verifications enable row level security;

drop policy if exists "own rows: select" on public.verifications;
create policy "own rows: select" on public.verifications
  for select using (auth.uid() = user_id);

drop policy if exists "own rows: insert" on public.verifications;
create policy "own rows: insert" on public.verifications
  for insert with check (auth.uid() = user_id);

-- Bulk-feature access, controlled from the admin panel. Opt-in: a row with
-- enabled=true grants the bulk CSV feature. RLS on + no policies => only the
-- service-role key (admin client) can read/write it.
create table if not exists public.bulk_access (
  email      text primary key,
  enabled    boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.bulk_access enable row level security;
