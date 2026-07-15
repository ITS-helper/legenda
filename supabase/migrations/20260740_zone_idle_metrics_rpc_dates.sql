-- Диапазон дат для рассылки (недельные отчёты).

create or replace function analytics.zone_daily_metrics_for_dates(
  p_date_from date,
  p_date_to date default null
)
returns table (
  report_date date,
  supervisor_name text,
  zona text,
  sec bigint,
  shifts bigint
)
language sql
stable
security definer
set search_path = analytics, public, pg_temp
as $$
  with ble_window as (
    select
      b.report_date,
      b.ww_shift_id,
      b.zona,
      b.event_at,
      b.total_sec,
      b.work_sec,
      coalesce(sup.name, 'Без начальника') as supervisor_name
    from analytics.ble_minute_facts b
    join analytics.shifts s
      on s.ww_shift_id = b.ww_shift_id
     and s.report_date = b.report_date
    left join analytics.supervisors sup on sup.id = s.supervisor_id
    where b.report_date >= p_date_from
      and b.report_date <= coalesce(p_date_to, p_date_from)
      and b.zona is not null
      and analytics.is_ble_shift_window_minute(b.event_at)
  ),
  shift_totals as (
    select
      ww_shift_id,
      report_date,
      coalesce(sum(work_sec), 0) as work_sec_total,
      coalesce(sum(total_sec), 0) as total_sec_total
    from ble_window
    group by ww_shift_id, report_date
  ),
  eligible_shifts as (
    select ww_shift_id, report_date
    from shift_totals
    where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
  )
  select
    w.report_date,
    w.supervisor_name,
    w.zona,
    sum(
      case
        when analytics.is_kpp_metric_minute(w.zona, w.event_at) then w.total_sec
        when w.zona = '13' then 0
        else w.total_sec
      end
    )::bigint as sec,
    count(
      distinct case
        when w.zona = '13' and not analytics.is_kpp_metric_minute(w.zona, w.event_at) then null
        else w.ww_shift_id
      end
    )::bigint as shifts
  from ble_window w
  join eligible_shifts e
    on e.ww_shift_id = w.ww_shift_id
   and e.report_date = w.report_date
  group by w.report_date, w.supervisor_name, w.zona;
$$;

create or replace function analytics.idle_episodes_daily_for_dates(
  p_date_from date,
  p_date_to date default null
)
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
    from analytics.shift_daily_metrics_for_dates(p_date_from, coalesce(p_date_to, p_date_from))
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
  where ie.report_date >= p_date_from
    and ie.report_date <= coalesce(p_date_to, p_date_from)
    and ie.duration_min >= analytics.long_idle_threshold_min()
    and analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total);
$$;

grant execute on function analytics.zone_daily_metrics_for_dates(date, date) to anon, authenticated, service_role;
grant execute on function analytics.idle_episodes_daily_for_dates(date, date) to anon, authenticated, service_role;
