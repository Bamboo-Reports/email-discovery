-- Migration: aggregate admin usage stats in the database.
-- The admin dashboard previously fetched every verification row and
-- aggregated in JS, which silently broke past PostgREST's 1000-row cap.
-- Paste into the Supabase SQL editor and run.

create or replace function public.admin_user_stats()
returns table (
  user_email text,
  total bigint,
  valid bigint,
  accept_all bigint,
  invalid bigint,
  not_found bigint,
  api_calls bigint,
  last_active timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(user_email, user_id::text)                        as user_email,
    count(*)                                                   as total,
    count(*) filter (where status = 'valid')                   as valid,
    count(*) filter (where status = 'accept-all')              as accept_all,
    count(*) filter (where status = 'invalid')                 as invalid,
    count(*) filter (where status not in
      ('valid', 'accept-all', 'invalid'))                      as not_found,
    coalesce(sum(api_calls), 0)                                as api_calls,
    max(created_at)                                            as last_active
  from public.verifications
  group by 1
  order by total desc;
$$;

-- Org-wide stats: only the service-role (admin) client may call this.
revoke execute on function public.admin_user_stats() from public;
revoke execute on function public.admin_user_stats() from anon;
revoke execute on function public.admin_user_stats() from authenticated;
grant execute on function public.admin_user_stats() to service_role;
