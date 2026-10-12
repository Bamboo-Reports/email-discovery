-- Migration: admins granted from the admin dashboard. Additive + idempotent.
-- Emails in the ADMIN_EMAILS env var stay permanent "owner" admins; this
-- table holds everyone promoted from the UI on top of them.
-- Only the service-role client reads/writes it (RLS on, no policies).
-- Paste into the Supabase SQL editor and run.

create table if not exists public.app_admins (
  email      text primary key,
  granted_by text,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
