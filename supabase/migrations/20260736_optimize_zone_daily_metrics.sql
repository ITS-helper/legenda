-- zone_daily_metrics joined shift_daily_metrics (full per-shift BLE aggregation) and timed out on dashboard.
-- Eligible shifts: lightweight CTE over ble_minute_facts; zone totals: single BLE scan per date.

create index if not exists idx_ble_facts_report_shift
  on analytics.ble_minute_facts(report_date, ww_shift_id);

drop view if exists analytics.zone_daily_metrics;

create view analytics.zone_daily_metrics as
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
  where b.zona is not null
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
  ) as sec,
  count(
    distinct case
      when w.zona = '13' and not analytics.is_kpp_metric_minute(w.zona, w.event_at) then null
      else w.ww_shift_id
    end
  ) as shifts
from ble_window w
join eligible_shifts e
  on e.ww_shift_id = w.ww_shift_id
 and e.report_date = w.report_date
group by w.report_date, w.supervisor_name, w.zona;

grant select on analytics.zone_daily_metrics to anon, authenticated, service_role;
