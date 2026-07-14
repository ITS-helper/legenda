-- Список «Бездействие в зоне проведения работ» включает смены ниже analytics_min_activity_pct.
-- Агрегаты бригад и остальная аналитика по-прежнему без них.

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
  join analytics.shift_daily_metrics m
    on m.report_date = s.report_date
   and m.ww_shift_id = s.ww_shift_id
  where s.report_date = p_report_date;
$$;

grant execute on function analytics.list_not_worn_shifts_for_date(date) to anon, authenticated, service_role;
