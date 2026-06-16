-- Migration: add bulk-feature access control. Additive + idempotent —
-- safe to run on a database that already has data. Paste into the Supabase
-- SQL editor and run.

create table if not exists public.bulk_access (
  email      text primary key,
  enabled    boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.bulk_access enable row level security;
