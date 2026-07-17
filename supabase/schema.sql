-- Email engine: per-user verification audit log.
-- Run this in the Supabase SQL editor (or `supabase db push`).

-- Recreated to add per-provider columns (RR + MV "BOTH" mode). Drops existing data.
drop table if exists public.verifications cascade;

create table public.verifications (
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
  -- headline verdict (reacher in BOTH mode, otherwise the single active provider)
  status        text not null check (status in ('valid', 'accept-all', 'invalid', 'not found')),
  confidence    numeric not null default 0,
  pattern_index int,
  api_calls     int not null default 0,
  credits_left  int,
  -- per-provider verdicts; null when that provider didn't run
  reacher_status             text,
  reacher_confidence         numeric,
  millionverifier_status     text,
  millionverifier_confidence numeric
);

create index if not exists verifications_user_created_idx
  on public.verifications (user_id, created_at desc);
create index if not exists verifications_status_idx on public.verifications (status);
create index if not exists verifications_domain_idx on public.verifications (domain);
-- Composite (email, created_at desc) also serves plain email lookups and backs
-- the verification cache (newest fresh row per email).
create index if not exists verifications_email_created_idx
  on public.verifications (email, created_at desc);

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

-- Completed bulk CSV exports. Files live in the private Supabase Storage
-- bucket below; this table stores user-scoped metadata for history/download UI.
create table if not exists public.bulk_exports (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  user_email       text,
  created_at       timestamptz not null default now(),
  mode             text not null check (mode in ('discovery', 'verification')),
  filename         text not null,
  storage_path     text not null unique,
  row_count        int not null,
  valid_count      int not null default 0,
  accept_all_count int not null default 0,
  invalid_count    int not null default 0,
  not_found_count  int not null default 0
);

create index if not exists bulk_exports_user_created_idx
  on public.bulk_exports (user_id, created_at desc);

alter table public.bulk_exports enable row level security;

drop policy if exists "own bulk exports: select" on public.bulk_exports;
create policy "own bulk exports: select" on public.bulk_exports
  for select using (auth.uid() = user_id);

drop policy if exists "own bulk exports: insert" on public.bulk_exports;
create policy "own bulk exports: insert" on public.bulk_exports
  for insert with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('bulk-exports', 'bulk-exports', false)
on conflict (id) do update set public = excluded.public;
