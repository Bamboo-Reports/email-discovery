-- Migration: org-wide usage bucketed by day / week / month / year for the
-- admin dashboard. Periods are cut in IST (Asia/Kolkata) so "today" matches
-- the team's calendar; weeks start Monday (Postgres date_trunc).
-- Empty periods are returned as zero rows, starting no earlier than the first
-- verification ever recorded.
-- Paste into the Supabase SQL editor and run.

create or replace function public.admin_period_stats(
  p_grain   text,
  p_periods int,
  p_tz      text default 'Asia/Kolkata'
)
returns table (
  period_start date,
  total        bigint,
  valid        bigint,
  accept_all   bigint,
  invalid      bigint,
  not_found    bigint,
  api_calls    bigint,
  active_users bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with grain as (
    -- anything else yields no rows (date_trunc(null, ...) is null)
    select case when p_grain in ('day', 'week', 'month', 'year') then p_grain end as g
  ),
  bounds as (
    select
      g,
      date_trunc(g, now() at time zone p_tz) as cur,
      greatest(
        date_trunc(g, now() at time zone p_tz) - ((greatest(p_periods, 1) - 1) || ' ' || g)::interval,
        (select date_trunc(g, min(created_at) at time zone p_tz) from public.verifications)
      ) as first
    from grain
  ),
  periods as (
    select generate_series(first, cur, ('1 ' || g)::interval) as p
    from bounds
  ),
  agg as (
    select
      date_trunc(b.g, v.created_at at time zone p_tz)              as p,
      count(*)                                                    as total,
      count(*) filter (where v.status = 'valid')                  as valid,
      count(*) filter (where v.status = 'accept-all')             as accept_all,
      count(*) filter (where v.status = 'invalid')                as invalid,
      count(*) filter (where v.status not in
        ('valid', 'accept-all', 'invalid'))                       as not_found,
      coalesce(sum(v.api_calls), 0)                               as api_calls,
      count(distinct coalesce(v.user_email, v.user_id::text))     as active_users
    from public.verifications v, bounds b
    where v.created_at >= b.first at time zone p_tz
    group by 1
  )
  select
    periods.p::date,
    coalesce(agg.total, 0),
    coalesce(agg.valid, 0),
    coalesce(agg.accept_all, 0),
    coalesce(agg.invalid, 0),
    coalesce(agg.not_found, 0),
    coalesce(agg.api_calls, 0),
    coalesce(agg.active_users, 0)
  from periods
  left join agg using (p)
  order by 1 desc;
$$;

-- Org-wide stats: only the service-role (admin) client may call this.
revoke execute on function public.admin_period_stats(text, int, text) from public;
revoke execute on function public.admin_period_stats(text, int, text) from anon;
revoke execute on function public.admin_period_stats(text, int, text) from authenticated;
grant execute on function public.admin_period_stats(text, int, text) to service_role;

-- Range scans on created_at alone (the existing index leads with user_id).
create index if not exists verifications_created_idx
  on public.verifications (created_at desc);
