-- Add "Ходьба между зонами" (go_sec) as a first-class metric in brigade views
-- Views are dropped first because create-or-replace cannot insert a column in the middle.

drop view if exists analytics.brigade_daily_metrics;
drop view if exists analytics.brigade_weekly_metrics;

create view analytics.brigade_daily_metrics as
select
  report_date,
  coalesce(supervisor_name, 'Без начальника') as supervisor_name,
  count(*) as workers,
  sum(work_sec_total) as work_sec,
  sum(idle_sec_total) as idle_sec,
  sum(go_sec_total) as go_sec,
  sum(total_sec_total) as total_sec,
  sum(sleep_sec_total) as sleep_sec,
  sum(pv_sec_total) as pv_sec,
  sum(kpp_sec_total) as kpp_sec,
  count(*) filter (where kpp_sec_total > 0) as kpp_workers,
  case when sum(total_sec_total) > 0
    then round(100.0 * sum(work_sec_total) / sum(total_sec_total), 1)
    else 0 end as activity_pct,
  case when sum(total_sec_total) > 0
    then round(100.0 * sum(idle_sec_total) / sum(total_sec_total), 1)
    else 0 end as idle_pct,
  case when sum(total_sec_total) > 0
    then round(100.0 * sum(go_sec_total) / sum(total_sec_total), 1)
    else 0 end as go_pct
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
  sum(idle_sec_total) as idle_sec,
  sum(go_sec_total) as go_sec,
  sum(total_sec_total) as total_sec,
  sum(sleep_sec_total) as sleep_sec,
  sum(pv_sec_total) as pv_sec,
  sum(kpp_sec_total) as kpp_sec,
  count(*) filter (where kpp_sec_total > 0) as kpp_shifts,
  case when sum(total_sec_total) > 0
    then round(100.0 * sum(work_sec_total) / sum(total_sec_total), 1)
    else 0 end as activity_pct,
  case when sum(total_sec_total) > 0
    then round(100.0 * sum(idle_sec_total) / sum(total_sec_total), 1)
    else 0 end as idle_pct,
  case when sum(total_sec_total) > 0
    then round(100.0 * sum(go_sec_total) / sum(total_sec_total), 1)
    else 0 end as go_pct
from analytics.shift_daily_metrics
group by 1, 2, 3;

grant select on analytics.brigade_daily_metrics to anon, authenticated, service_role;
grant select on analytics.brigade_weekly_metrics to anon, authenticated, service_role;
