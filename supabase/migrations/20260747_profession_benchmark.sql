-- Эталонные значения по профессиям: топ-3 сотрудника по активности за весь период
-- (от начала данных по выбранную дату включительно), усреднённые по метрикам.
-- Период растёт каждый день (кумулятивно), поэтому сразу пишем на plpgsql с
-- EXECUTE format() и литеральной датой — уроки zone_daily_metrics_for_dates
-- (миграция 20260746): language sql функция не инлайнится при вызове с
-- параметром, планировщик строит один обобщённый план и на растущем объёме
-- данных это гарантированно сломается.

create or replace function analytics.profession_benchmark_for_date(
  p_report_date date
)
returns table (
  profession text,
  employees_used integer,
  activity_pct numeric,
  weak_activity_pct numeric,
  long_idle_pct numeric,
  go_pct numeric
)
language plpgsql
stable
security definer
set search_path = analytics, public, pg_temp
as $function$
begin
  return query execute format(
    $sql$
    with shift_days as (
      select
        s.report_date,
        s.ww_shift_id,
        e.employee_number,
        e.profession,
        coalesce(sum(b.work_sec), 0) as work_sec,
        coalesce(sum(b.go_sec), 0) as go_sec,
        coalesce(sum(b.total_sec), 0) as total_sec,
        greatest(
          coalesce(sum(b.idle_sec), 0) - coalesce(max(ep.long_idle_sec_total), 0),
          0
        ) as weak_activity_sec,
        coalesce(max(ep.long_idle_sec_total), 0) as long_idle_sec
      from analytics.shifts s
      join analytics.employees e on e.id = s.employee_id
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
          and ie.report_date <= %1$L::date
        group by ie.ww_shift_id, ie.report_date
      ) ep on ep.ww_shift_id = s.ww_shift_id and ep.report_date = s.report_date
      where s.report_date <= %1$L::date
        and e.profession is not null
      group by s.report_date, s.ww_shift_id, e.employee_number, e.profession
    ),
    eligible_days as (
      select *
      from shift_days
      where analytics.is_analytics_eligible_shift(work_sec, total_sec)
    ),
    per_employee as (
      select
        profession,
        employee_number,
        sum(work_sec) as work_sec,
        sum(weak_activity_sec) as weak_activity_sec,
        sum(long_idle_sec) as long_idle_sec,
        sum(go_sec) as go_sec,
        sum(total_sec) as total_sec
      from eligible_days
      group by profession, employee_number
      having sum(total_sec) > 0
    ),
    ranked as (
      select
        profession,
        100.0 * work_sec / total_sec as activity_pct,
        100.0 * weak_activity_sec / total_sec as weak_activity_pct,
        100.0 * long_idle_sec / total_sec as long_idle_pct,
        100.0 * go_sec / total_sec as go_pct,
        row_number() over (
          partition by profession
          order by 100.0 * work_sec / total_sec desc
        ) as rn
      from per_employee
    ),
    top3 as (
      select * from ranked where rn <= 3
    )
    select
      profession,
      count(*)::int as employees_used,
      round(avg(activity_pct), 1) as activity_pct,
      round(avg(weak_activity_pct), 1) as weak_activity_pct,
      round(avg(long_idle_pct), 1) as long_idle_pct,
      round(avg(go_pct), 1) as go_pct
    from top3
    group by profession
    order by profession
    $sql$,
    p_report_date
  );
end;
$function$;

grant execute on function analytics.profession_benchmark_for_date(date) to anon, authenticated, service_role;
