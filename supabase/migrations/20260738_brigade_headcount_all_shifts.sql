-- workers / avg_workers: все смены за день; проценты и суммы секунд — только eligible (analytics_min_activity_pct).

drop view if exists analytics.brigade_weekly_metrics;
drop view if exists analytics.brigade_daily_metrics;

create view analytics.brigade_daily_metrics as
select
  report_date,
  coalesce(supervisor_name, 'Без начальника') as supervisor_name,
  count(*) as workers,
  coalesce(sum(work_sec_total) filter (
    where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
  ), 0) as work_sec,
  coalesce(sum(weak_activity_sec_total) filter (
    where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
  ), 0) as weak_activity_sec,
  coalesce(sum(long_idle_sec_total) filter (
    where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
  ), 0) as long_idle_sec,
  coalesce(sum(go_sec_total) filter (
    where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
  ), 0) as go_sec,
  coalesce(sum(total_sec_total) filter (
    where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
  ), 0) as total_sec,
  coalesce(sum(pv_sec_total) filter (
    where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
  ), 0) as pv_sec,
  coalesce(sum(kpp_sec_total) filter (
    where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
  ), 0) as kpp_sec,
  coalesce(sum(not_worn_sec_total) filter (
    where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
  ), 0) as not_worn_sec,
  coalesce(sum(not_worn_eligible_sec_total) filter (
    where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
  ), 0) as not_worn_eligible_sec,
  count(*) filter (where kpp_sec_total > 0) as kpp_workers,
  count(*) filter (
    where not_worn_sec_total >= not_worn_shift_min_sec
      and analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
  ) as not_worn_workers,
  case
    when coalesce(sum(total_sec_total) filter (
      where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
    ), 0) > 0
    then round(
      100.0 * coalesce(sum(work_sec_total) filter (
        where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
      ), 0) / coalesce(sum(total_sec_total) filter (
        where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
      ), 0),
      1
    )
    else 0
  end as activity_pct,
  case
    when coalesce(sum(total_sec_total) filter (
      where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
    ), 0) > 0
    then round(
      100.0 * coalesce(sum(weak_activity_sec_total) filter (
        where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
      ), 0) / coalesce(sum(total_sec_total) filter (
        where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
      ), 0),
      1
    )
    else 0
  end as weak_activity_pct,
  case
    when coalesce(sum(total_sec_total) filter (
      where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
    ), 0) > 0
    then round(
      100.0 * coalesce(sum(long_idle_sec_total) filter (
        where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
      ), 0) / coalesce(sum(total_sec_total) filter (
        where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
      ), 0),
      1
    )
    else 0
  end as long_idle_pct,
  case
    when coalesce(sum(total_sec_total) filter (
      where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
    ), 0) > 0
    then round(
      100.0 * coalesce(sum(go_sec_total) filter (
        where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
      ), 0) / coalesce(sum(total_sec_total) filter (
        where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
      ), 0),
      1
    )
    else 0
  end as go_pct,
  case
    when coalesce(sum(not_worn_eligible_sec_total) filter (
      where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
    ), 0) > 0
    then round(
      100.0 * coalesce(sum(not_worn_sec_total) filter (
        where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
      ), 0) / coalesce(sum(not_worn_eligible_sec_total) filter (
        where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
      ), 0),
      1
    )
    else 0
  end as not_worn_pct,
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
  coalesce(sum(work_sec_total) filter (
    where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
  ), 0) as work_sec,
  coalesce(sum(weak_activity_sec_total) filter (
    where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
  ), 0) as weak_activity_sec,
  coalesce(sum(long_idle_sec_total) filter (
    where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
  ), 0) as long_idle_sec,
  coalesce(sum(go_sec_total) filter (
    where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
  ), 0) as go_sec,
  coalesce(sum(total_sec_total) filter (
    where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
  ), 0) as total_sec,
  coalesce(sum(pv_sec_total) filter (
    where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
  ), 0) as pv_sec,
  coalesce(sum(kpp_sec_total) filter (
    where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
  ), 0) as kpp_sec,
  count(*) filter (where kpp_sec_total > 0) as kpp_shifts,
  case
    when coalesce(sum(total_sec_total) filter (
      where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
    ), 0) > 0
    then round(
      100.0 * coalesce(sum(work_sec_total) filter (
        where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
      ), 0) / coalesce(sum(total_sec_total) filter (
        where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
      ), 0),
      1
    )
    else 0
  end as activity_pct,
  case
    when coalesce(sum(total_sec_total) filter (
      where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
    ), 0) > 0
    then round(
      100.0 * coalesce(sum(weak_activity_sec_total) filter (
        where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
      ), 0) / coalesce(sum(total_sec_total) filter (
        where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
      ), 0),
      1
    )
    else 0
  end as weak_activity_pct,
  case
    when coalesce(sum(total_sec_total) filter (
      where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
    ), 0) > 0
    then round(
      100.0 * coalesce(sum(long_idle_sec_total) filter (
        where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
      ), 0) / coalesce(sum(total_sec_total) filter (
        where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
      ), 0),
      1
    )
    else 0
  end as long_idle_pct,
  case
    when coalesce(sum(total_sec_total) filter (
      where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
    ), 0) > 0
    then round(
      100.0 * coalesce(sum(go_sec_total) filter (
        where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
      ), 0) / coalesce(sum(total_sec_total) filter (
        where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
      ), 0),
      1
    )
    else 0
  end as go_pct,
  coalesce(
    round(avg(on_watch_duration_seconds) filter (where on_watch_duration_seconds > 0)),
    0
  )::integer as avg_shift_duration_sec
from analytics.shift_daily_metrics
group by date_trunc('week', report_date), coalesce(supervisor_name, 'Без начальника');

grant select on analytics.brigade_daily_metrics to anon, authenticated, service_role;
grant select on analytics.brigade_weekly_metrics to anon, authenticated, service_role;
