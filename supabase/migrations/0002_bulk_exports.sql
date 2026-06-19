-- Migration: persist completed bulk CSV exports.

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
