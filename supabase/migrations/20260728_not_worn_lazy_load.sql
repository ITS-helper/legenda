-- Убрать not_worn из shift_daily_metrics (дорого); block7 грузит через RPC.

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
  with base as (
    select
      s.ww_shift_id,
      e.employee_number,
      e.full_name,
      e.profession,
      coalesce(sup.name, 'Без начальника') as supervisor_name,
      analytics.not_worn_sec_for_shift(s.report_date, s.ww_shift_id) as not_worn_sec_total,
      (
        select coalesce(sum(b.total_sec), 0)::bigint
        from analytics.ble_minute_facts b
        where b.report_date = s.report_date
          and b.ww_shift_id = s.ww_shift_id
          and not analytics.is_rest_zone(b.zona)
          and not analytics.is_lunch_minute(b.event_at)
      ) as not_worn_eligible_sec_total,
      analytics.not_worn_min_sec_for(e.profession)::integer as not_worn_shift_min_sec
    from analytics.shifts s
    join analytics.employees e on e.id = s.employee_id
    left join analytics.supervisors sup on sup.id = s.supervisor_id
    where s.report_date = p_report_date
  )
  select *
  from base
  where not_worn_sec_total > 0;
$$;

grant execute on function analytics.list_not_worn_shifts_for_date(date) to anon, authenticated, service_role;

drop view if exists analytics.idle_episodes_daily;
drop view if exists analytics.brigade_weekly_metrics;
drop view if exists analytics.brigade_daily_metrics;
drop view if exists analytics.shift_daily_metrics;

create view analytics.shift_daily_metrics as
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
  coalesce(sum(b.idle_sec), 0) as idle_sec_total,
  coalesce(max(ep.long_idle_sec_total), 0) as long_idle_sec_total,
  greatest(
    coalesce(sum(b.idle_sec), 0) - coalesce(max(ep.long_idle_sec_total), 0),
    0
  ) as weak_activity_sec_total,
  coalesce(sum(b.go_sec), 0) as go_sec_total,
  coalesce(sum(b.work_sec), 0) as work_sec_total,
  coalesce(sum(b.total_sec), 0) as total_sec_total,
  coalesce(sum(case when b.wear = 1 then b.total_sec else 0 end), 0) as wear_sec_total,
  0::bigint as not_worn_sec_total,
  coalesce(
    sum(
      case
        when not analytics.is_rest_zone(b.zona)
          and not analytics.is_lunch_minute(b.event_at)
        then b.total_sec
        else 0
      end
    ),
    0
  ) as not_worn_eligible_sec_total,
  analytics.not_worn_min_sec_for(e.profession) as not_worn_shift_min_sec,
  coalesce(sum(case when b.zona = '1' then b.total_sec else 0 end), 0) as pv_sec_total,
  coalesce(sum(case when b.zona is not null and b.zona <> '1' then b.total_sec else 0 end), 0) as outside_pv_sec_total,
  coalesce(
    sum(case when analytics.is_kpp_metric_minute(b.zona, b.event_at) then b.total_sec else 0 end),
    0
  ) as kpp_sec_total
from analytics.shifts s
join analytics.employees e on e.id = s.employee_id
left join analytics.supervisors sup on sup.id = s.supervisor_id
left join analytics.schedules sch on sch.id = s.schedule_id
left join analytics.ble_minute_facts b on b.ww_shift_id = s.ww_shift_id and b.report_date = s.report_date
left join (
  select
    ww_shift_id,
    report_date,
    coalesce(sum(duration_min), 0) * 60 as long_idle_sec_total
  from analytics.idle_episodes
  where duration_min >= analytics.long_idle_threshold_min()
  group by ww_shift_id, report_date
) ep on ep.ww_shift_id = s.ww_shift_id and ep.report_date = s.report_date
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

create view analytics.brigade_daily_metrics as
select
  report_date,
  coalesce(supervisor_name, 'Без начальника') as supervisor_name,
  count(*) as workers,
  sum(work_sec_total) as work_sec,
  sum(weak_activity_sec_total) as weak_activity_sec,
  sum(long_idle_sec_total) as long_idle_sec,
  sum(go_sec_total) as go_sec,
  sum(total_sec_total) as total_sec,
  sum(pv_sec_total) as pv_sec,
  sum(kpp_sec_total) as kpp_sec,
  sum(not_worn_sec_total) as not_worn_sec,
  sum(not_worn_eligible_sec_total) as not_worn_eligible_sec,
  count(*) filter (where kpp_sec_total > 0) as kpp_workers,
  count(*) filter (where not_worn_sec_total >= not_worn_shift_min_sec) as not_worn_workers,
  case when sum(total_sec_total) > 0
    then round(100.0 * sum(work_sec_total) / sum(total_sec_total), 1)
    else 0 end as activity_pct,
  case when sum(total_sec_total) > 0
    then round(100.0 * sum(weak_activity_sec_total) / sum(total_sec_total), 1)
    else 0 end as weak_activity_pct,
  case when sum(total_sec_total) > 0
    then round(100.0 * sum(long_idle_sec_total) / sum(total_sec_total), 1)
    else 0 end as long_idle_pct,
  case when sum(total_sec_total) > 0
    then round(100.0 * sum(go_sec_total) / sum(total_sec_total), 1)
    else 0 end as go_pct,
  case when sum(not_worn_eligible_sec_total) > 0
    then round(100.0 * sum(not_worn_sec_total) / sum(not_worn_eligible_sec_total), 1)
    else 0 end as not_worn_pct,
  coalesce(
    round(avg(on_watch_duration_seconds) filter (where on_watch_duration_seconds > 0)),
    0
  )::integer as avg_shift_duration_sec
from analytics.shift_daily_metrics
group by report_date, coalesce(supervisor_name, 'Без начальника');

create view analytics.brigade_weekly_metrics as
select
  (date_trunc('week', report_date))::date as week_start,
  ((date_trunc('week', report_date))::date + 6) as week_end,
  coalesce(supervisor_name, 'Без начальника') as supervisor_name,
  count(distinct report_date) as days,
  count(distinct employee_number) as unique_employees,
  round(count(*)::numeric / nullif(count(distinct report_date), 0), 1) as avg_workers,
  sum(work_sec_total) as work_sec,
  sum(weak_activity_sec_total) as weak_activity_sec,
  sum(long_idle_sec_total) as long_idle_sec,
  sum(go_sec_total) as go_sec,
  sum(total_sec_total) as total_sec,
  sum(pv_sec_total) as pv_sec,
  sum(kpp_sec_total) as kpp_sec,
  count(*) filter (where kpp_sec_total > 0) as kpp_workers,
  case when sum(total_sec_total) > 0
    then round(100.0 * sum(work_sec_total) / sum(total_sec_total), 1)
    else 0 end as activity_pct,
  case when sum(total_sec_total) > 0
    then round(100.0 * sum(weak_activity_sec_total) / sum(total_sec_total), 1)
    else 0 end as weak_activity_pct,
  case when sum(total_sec_total) > 0
    then round(100.0 * sum(long_idle_sec_total) / sum(total_sec_total), 1)
    else 0 end as long_idle_pct,
  case when sum(total_sec_total) > 0
    then round(100.0 * sum(go_sec_total) / sum(total_sec_total), 1)
    else 0 end as go_pct,
  coalesce(
    round(avg(on_watch_duration_seconds) filter (where on_watch_duration_seconds > 0)),
    0
  )::integer as avg_shift_duration_sec
from analytics.shift_daily_metrics
group by date_trunc('week', report_date), coalesce(supervisor_name, 'Без начальника');

create view analytics.idle_episodes_daily as
select
  ie.*,
  coalesce(sup.name, 'Без начальника') as supervisor_name
from analytics.idle_episodes ie
join analytics.shifts s on s.ww_shift_id = ie.ww_shift_id and s.report_date = ie.report_date
left join analytics.supervisors sup on sup.id = s.supervisor_id
where ie.duration_min >= analytics.long_idle_threshold_min();

grant select on analytics.shift_daily_metrics to anon, authenticated, service_role;
grant select on analytics.brigade_daily_metrics to anon, authenticated, service_role;
grant select on analytics.brigade_weekly_metrics to anon, authenticated, service_role;
grant select on analytics.idle_episodes_daily to anon, authenticated, service_role;
