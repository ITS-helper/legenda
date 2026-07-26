-- Лёгкая активность бригад по неделям для графика «активность и выработка» с начала проекта.
-- brigade_daily_metrics_for_dates на диапазоне в несколько месяцев не отвечает за разумное время:
-- здесь только суммы work_sec/total_sec из ble_minute_facts, без not_worn/КПП/простоев.

create or replace function analytics.brigade_weekly_activity(
  p_date_from date,
  p_date_to date
)
returns table (
  week_start date,
  supervisor_name text,
  work_sec bigint,
  total_sec bigint,
  activity_pct numeric
)
language sql
stable
security definer
set search_path = analytics, public, pg_temp
as $$
  with shift_totals as (
    select
      s.report_date,
      s.ww_shift_id,
      coalesce(sup.name, 'Без начальника') as supervisor_name,
      coalesce(sum(b.work_sec), 0)::bigint as work_sec,
      coalesce(sum(b.total_sec), 0)::bigint as total_sec
    from analytics.shifts s
    left join analytics.supervisors sup on sup.id = s.supervisor_id
    left join analytics.ble_minute_facts b
      on b.ww_shift_id = s.ww_shift_id
     and b.report_date = s.report_date
     and analytics.is_ble_shift_window_minute(b.event_at)
    where s.report_date between p_date_from and p_date_to
    group by s.report_date, s.ww_shift_id, coalesce(sup.name, 'Без начальника')
  )
  select
    (date_trunc('week', t.report_date))::date as week_start,
    t.supervisor_name,
    coalesce(sum(t.work_sec) filter (
      where analytics.is_analytics_eligible_shift(t.work_sec, t.total_sec)
    ), 0)::bigint as work_sec,
    coalesce(sum(t.total_sec) filter (
      where analytics.is_analytics_eligible_shift(t.work_sec, t.total_sec)
    ), 0)::bigint as total_sec,
    case
      when coalesce(sum(t.total_sec) filter (
        where analytics.is_analytics_eligible_shift(t.work_sec, t.total_sec)
      ), 0) > 0
      then round(
        100.0 * coalesce(sum(t.work_sec) filter (
          where analytics.is_analytics_eligible_shift(t.work_sec, t.total_sec)
        ), 0) / coalesce(sum(t.total_sec) filter (
          where analytics.is_analytics_eligible_shift(t.work_sec, t.total_sec)
        ), 0),
        1
      )
      else 0
    end as activity_pct
  from shift_totals t
  group by 1, 2;
$$;

grant execute on function analytics.brigade_weekly_activity(date, date) to anon, authenticated, service_role;
