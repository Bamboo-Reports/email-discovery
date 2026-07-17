-- Composite index for the verification cache lookup:
-- newest row for an email within the freshness window.
create index if not exists verifications_email_created_idx
  on public.verifications (email, created_at desc);

-- Superseded by the composite index above.
drop index if exists public.verifications_email_idx;
