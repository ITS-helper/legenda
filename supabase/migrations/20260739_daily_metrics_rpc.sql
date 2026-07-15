-- PostgREST cannot always push report_date into nested views → full scan + statement timeout.
-- Dashboard uses RPC with explicit date parameters (same pattern as zone_daily_metrics_for_date).

create or replace function analytics.shift_daily_metrics_for_dates(
  p_date_from date,
  p_date_to date default null
)
returns table (
  report_date date,
  ww_shift_id bigint,
  employee_number text,
  full_name text,
  profession text,
  supervisor_name text,
  schedule_name text,
  on_watch_duration_seconds integer,
  late_seconds integer,
  early_return_seconds integer,
  telemetry_rows bigint,
  idle_sec_total bigint,
  long_idle_sec_total bigint,
  weak_activity_sec_total bigint,
  go_sec_total bigint,
  work_sec_total bigint,
  total_sec_total bigint,
  wear_sec_total bigint,
  not_worn_sec_total bigint,
  not_worn_eligible_sec_total bigint,
  not_worn_shift_min_sec integer,
  pv_sec_total bigint,
  outside_pv_sec_total bigint,
  kpp_sec_total bigint
)
language sql
stable
security definer
set search_path = analytics, public, pg_temp
as $$
  select
    s.report_date,
    s.ww_shift_id,
    e.employee_number,
    e.full_name,
    e.profession,
    sup.name as supervisor_name,
    sch.name as schedule_name,
    s.on_watch_duration_seconds,
    s.late_seconds,
    s.early_return_seconds,
    count(b.id) as telemetry_rows,
    coalesce(sum(b.idle_sec), 0)::bigint as idle_sec_total,
    coalesce(max(ep.long_idle_sec_total), 0)::bigint as long_idle_sec_total,
    greatest(
      coalesce(sum(b.idle_sec), 0) - coalesce(max(ep.long_idle_sec_total), 0),
      0
    )::bigint as weak_activity_sec_total,
    coalesce(sum(b.go_sec), 0)::bigint as go_sec_total,
    coalesce(sum(b.work_sec), 0)::bigint as work_sec_total,
    coalesce(sum(b.total_sec), 0)::bigint as total_sec_total,
    coalesce(sum(case when b.wear = 1 then b.total_sec else 0 end), 0)::bigint as wear_sec_total,
    0::bigint as not_worn_sec_total,
    coalesce(
      sum(
        case
          when analytics.is_not_worn_eligible_zone(b.zona)
            and not analytics.is_lunch_minute(b.event_at)
          then b.total_sec
          else 0
        end
      ),
      0
    )::bigint as not_worn_eligible_sec_total,
    analytics.not_worn_min_sec_for(e.profession)::integer as not_worn_shift_min_sec,
    coalesce(sum(case when b.zona = '1' then b.total_sec else 0 end), 0)::bigint as pv_sec_total,
    coalesce(sum(case when b.zona is not null and b.zona <> '1' then b.total_sec else 0 end), 0)::bigint as outside_pv_sec_total,
    coalesce(
      sum(case when analytics.is_kpp_metric_minute(b.zona, b.event_at) then b.total_sec else 0 end),
      0
    )::bigint as kpp_sec_total
  from analytics.shifts s
  join analytics.employees e on e.id = s.employee_id
  left join analytics.supervisors sup on sup.id = s.supervisor_id
  left join analytics.schedules sch on sch.id = s.schedule_id
  left join analytics.ble_minute_facts b
    on b.ww_shift_id = s.ww_shift_id
   and b.report_date = s.report_date
   and analytics.is_ble_shift_window_minute(b.event_at)
  left join (
    select
      ie.ww_shift_id,
      ie.report_date,
      coalesce(sum(ie.duration_min), 0) * 60 as long_idle_sec_total
    from analytics.idle_episodes ie
    where ie.duration_min >= analytics.long_idle_threshold_min()
      and ie.report_date >= p_date_from
      and ie.report_date <= coalesce(p_date_to, p_date_from)
    group by ie.ww_shift_id, ie.report_date
  ) ep on ep.ww_shift_id = s.ww_shift_id and ep.report_date = s.report_date
  where s.report_date >= p_date_from
    and s.report_date <= coalesce(p_date_to, p_date_from)
  group by
    s.report_date,
    s.ww_shift_id,
    e.employee_number,
    e.full_name,
    e.profession,
    sup.name,
    sch.name,
    s.on_watch_duration_seconds,
    s.late_seconds,
    s.early_return_seconds;
$$;

create or replace function analytics.shift_daily_metrics_for_date(p_report_date date)
returns table (
  report_date date,
  ww_shift_id bigint,
  employee_number text,
  full_name text,
  profession text,
  supervisor_name text,
  schedule_name text,
  on_watch_duration_seconds integer,
  late_seconds integer,
  early_return_seconds integer,
  telemetry_rows bigint,
  idle_sec_total bigint,
  long_idle_sec_total bigint,
  weak_activity_sec_total bigint,
  go_sec_total bigint,
  work_sec_total bigint,
  total_sec_total bigint,
  wear_sec_total bigint,
  not_worn_sec_total bigint,
  not_worn_eligible_sec_total bigint,
  not_worn_shift_min_sec integer,
  pv_sec_total bigint,
  outside_pv_sec_total bigint,
  kpp_sec_total bigint
)
language sql
stable
security definer
set search_path = analytics, public, pg_temp
as $$
  select * from analytics.shift_daily_metrics_for_dates(p_report_date, p_report_date);
$$;

create or replace function analytics.brigade_daily_metrics_for_dates(
  p_date_from date,
  p_date_to date default null
)
returns table (
  report_date date,
  supervisor_name text,
  workers bigint,
  work_sec bigint,
  weak_activity_sec bigint,
  long_idle_sec bigint,
  go_sec bigint,
  total_sec bigint,
  pv_sec bigint,
  kpp_sec bigint,
  not_worn_sec bigint,
  not_worn_eligible_sec bigint,
  kpp_workers bigint,
  not_worn_workers bigint,
  activity_pct numeric,
  weak_activity_pct numeric,
  long_idle_pct numeric,
  go_pct numeric,
  not_worn_pct numeric,
  avg_shift_duration_sec integer
)
language sql
stable
security definer
set search_path = analytics, public, pg_temp
as $$
  select
    m.report_date,
    coalesce(m.supervisor_name, 'Без начальника') as supervisor_name,
    count(*)::bigint as workers,
    coalesce(sum(m.work_sec_total) filter (
      where analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total)
    ), 0)::bigint as work_sec,
    coalesce(sum(m.weak_activity_sec_total) filter (
      where analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total)
    ), 0)::bigint as weak_activity_sec,
    coalesce(sum(m.long_idle_sec_total) filter (
      where analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total)
    ), 0)::bigint as long_idle_sec,
    coalesce(sum(m.go_sec_total) filter (
      where analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total)
    ), 0)::bigint as go_sec,
    coalesce(sum(m.total_sec_total) filter (
      where analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total)
    ), 0)::bigint as total_sec,
    coalesce(sum(m.pv_sec_total) filter (
      where analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total)
    ), 0)::bigint as pv_sec,
    coalesce(sum(m.kpp_sec_total) filter (
      where analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total)
    ), 0)::bigint as kpp_sec,
    coalesce(sum(m.not_worn_sec_total) filter (
      where analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total)
    ), 0)::bigint as not_worn_sec,
    coalesce(sum(m.not_worn_eligible_sec_total) filter (
      where analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total)
    ), 0)::bigint as not_worn_eligible_sec,
    count(*) filter (where m.kpp_sec_total > 0)::bigint as kpp_workers,
    count(*) filter (
      where m.not_worn_sec_total >= m.not_worn_shift_min_sec
        and analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total)
    )::bigint as not_worn_workers,
    case
      when coalesce(sum(m.total_sec_total) filter (
        where analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total)
      ), 0) > 0
      then round(
        100.0 * coalesce(sum(m.work_sec_total) filter (
          where analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total)
        ), 0) / coalesce(sum(m.total_sec_total) filter (
          where analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total)
        ), 0),
        1
      )
      else 0
    end as activity_pct,
    case
      when coalesce(sum(m.total_sec_total) filter (
        where analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total)
      ), 0) > 0
      then round(
        100.0 * coalesce(sum(m.weak_activity_sec_total) filter (
          where analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total)
        ), 0) / coalesce(sum(m.total_sec_total) filter (
          where analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total)
        ), 0),
        1
      )
      else 0
    end as weak_activity_pct,
    case
      when coalesce(sum(m.total_sec_total) filter (
        where analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total)
      ), 0) > 0
      then round(
        100.0 * coalesce(sum(m.long_idle_sec_total) filter (
          where analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total)
        ), 0) / coalesce(sum(m.total_sec_total) filter (
          where analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total)
        ), 0),
        1
      )
      else 0
    end as long_idle_pct,
    case
      when coalesce(sum(m.total_sec_total) filter (
        where analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total)
      ), 0) > 0
      then round(
        100.0 * coalesce(sum(m.go_sec_total) filter (
          where analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total)
        ), 0) / coalesce(sum(m.total_sec_total) filter (
          where analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total)
        ), 0),
        1
      )
      else 0
    end as go_pct,
    case
      when coalesce(sum(m.not_worn_eligible_sec_total) filter (
        where analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total)
      ), 0) > 0
      then round(
        100.0 * coalesce(sum(m.not_worn_sec_total) filter (
          where analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total)
        ), 0) / coalesce(sum(m.not_worn_eligible_sec_total) filter (
          where analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total)
        ), 0),
        1
      )
      else 0
    end as not_worn_pct,
    coalesce(
      round(avg(m.on_watch_duration_seconds) filter (where m.on_watch_duration_seconds > 0)),
      0
    )::integer as avg_shift_duration_sec
  from analytics.shift_daily_metrics_for_dates(p_date_from, p_date_to) m
  group by m.report_date, coalesce(m.supervisor_name, 'Без начальника');
$$;

create or replace function analytics.brigade_daily_metrics_for_date(p_report_date date)
returns table (
  report_date date,
  supervisor_name text,
  workers bigint,
  work_sec bigint,
  weak_activity_sec bigint,
  long_idle_sec bigint,
  go_sec bigint,
  total_sec bigint,
  pv_sec bigint,
  kpp_sec bigint,
  not_worn_sec bigint,
  not_worn_eligible_sec bigint,
  kpp_workers bigint,
  not_worn_workers bigint,
  activity_pct numeric,
  weak_activity_pct numeric,
  long_idle_pct numeric,
  go_pct numeric,
  not_worn_pct numeric,
  avg_shift_duration_sec integer
)
language sql
stable
security definer
set search_path = analytics, public, pg_temp
as $$
  select * from analytics.brigade_daily_metrics_for_dates(p_report_date, p_report_date);
$$;

create or replace function analytics.idle_episodes_daily_for_date(p_report_date date)
returns table (
  report_date date,
  ww_shift_id bigint,
  session_id bigint,
  employee_number text,
  full_name text,
  supervisor_name text,
  dt_start timestamptz,
  dt_end timestamptz,
  duration_min integer,
  ble_tag_zone integer
)
language sql
stable
security definer
set search_path = analytics, public, pg_temp
as $$
  with shift_metrics as (
    select *
    from analytics.shift_daily_metrics_for_date(p_report_date)
  )
  select
    ie.report_date,
    ie.ww_shift_id,
    ie.session_id,
    ie.employee_number,
    ie.full_name,
    coalesce(sup.name, 'Без начальника') as supervisor_name,
    ie.dt_start,
    ie.dt_end,
    ie.duration_min,
    ie.ble_tag_zone
  from analytics.idle_episodes ie
  join analytics.shifts s
    on s.ww_shift_id = ie.ww_shift_id
   and s.report_date = ie.report_date
  left join analytics.supervisors sup on sup.id = s.supervisor_id
  join shift_metrics m
    on m.ww_shift_id = ie.ww_shift_id
   and m.report_date = ie.report_date
  where ie.report_date = p_report_date
    and ie.duration_min >= analytics.long_idle_threshold_min()
    and analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total);
$$;

-- list_not_worn: не джойнить view shift_daily_metrics (полный скан ~15 с).
create or replace function analytics.list_not_worn_shifts_for_date(p_report_date date)
returns table (
  ww_shift_id bigint,
  employee_number text,
  full_name text,
  profession text,
  supervisor_name text,
  not_worn_sec_total bigint,
  not_worn_eligible_sec_total bigint,
  not_worn_shift_min_sec integer
)
language sql
stable
security definer
set search_path = analytics, public, pg_temp
as $$
  with shift_metrics as (
    select ww_shift_id, not_worn_eligible_sec_total
    from analytics.shift_daily_metrics_for_date(p_report_date)
  )
  select
    s.ww_shift_id,
    e.employee_number,
    e.full_name,
    e.profession,
    coalesce(sup.name, 'Без начальника') as supervisor_name,
    nw.not_worn_sec_total,
    m.not_worn_eligible_sec_total,
    analytics.not_worn_min_sec_for(e.profession)::integer as not_worn_shift_min_sec
  from analytics.shifts s
  join analytics.employees e on e.id = s.employee_id
  left join analytics.supervisors sup on sup.id = s.supervisor_id
  join analytics.not_worn_episode_totals_for_date(p_report_date) nw on nw.ww_shift_id = s.ww_shift_id
  join shift_metrics m on m.ww_shift_id = s.ww_shift_id
  where s.report_date = p_report_date;
$$;

grant execute on function analytics.shift_daily_metrics_for_dates(date, date) to anon, authenticated, service_role;
grant execute on function analytics.shift_daily_metrics_for_date(date) to anon, authenticated, service_role;
grant execute on function analytics.brigade_daily_metrics_for_dates(date, date) to anon, authenticated, service_role;
grant execute on function analytics.brigade_daily_metrics_for_date(date) to anon, authenticated, service_role;
grant execute on function analytics.idle_episodes_daily_for_date(date) to anon, authenticated, service_role;
