-- Лёгкая численность бригад по дням для графика выработки на человека:
-- счёт смен из analytics.shifts, без тяжёлой view shift_daily_metrics
-- (RPC brigade_daily_metrics_for_dates на диапазоне 8 недель не отвечает за разумное время).

create or replace function analytics.brigade_daily_headcount(
  p_date_from date,
  p_date_to date
)
returns table (
  report_date date,
  supervisor_name text,
  workers bigint
)
language sql
stable
security definer
set search_path = analytics, public, pg_temp
as $$
  select
    s.report_date,
    coalesce(sup.name, 'Без начальника') as supervisor_name,
    count(*) as workers
  from analytics.shifts s
  left join analytics.supervisors sup on sup.id = s.supervisor_id
  where s.report_date between p_date_from and p_date_to
  group by s.report_date, coalesce(sup.name, 'Без начальника');
$$;

grant execute on function analytics.brigade_daily_headcount(date, date) to anon, authenticated, service_role;
