-- Исключить из аналитики (дашборд, рассылки) смены с активностью ниже порога.
-- shift_daily_metrics и сырые данные не меняются.

alter table analytics.metric_settings
  add column if not exists analytics_min_activity_pct integer not null default 11
  check (analytics_min_activity_pct between 0 and 100);

create or replace function analytics.analytics_min_activity_pct()
returns integer
language sql
stable
security definer
set search_path = analytics, public, pg_temp
as $$
  select coalesce(
    (select analytics_min_activity_pct from analytics.metric_settings order by id limit 1),
    11
  );
$$;

create or replace function analytics.is_analytics_eligible_shift(p_work_sec bigint, p_total_sec bigint)
returns boolean
language sql
stable
security definer
set search_path = analytics, public, pg_temp
as $$
  select coalesce(p_total_sec, 0) > 0
     and 100.0 * coalesce(p_work_sec, 0) / p_total_sec >= analytics.analytics_min_activity_pct();
$$;

create or replace function analytics.set_metric_settings(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = analytics, public, pg_temp
as $$
declare
  r analytics.metric_settings;
begin
  update analytics.metric_settings set
    long_idle_min = coalesce((p->>'long_idle_min')::int, long_idle_min),
    low_activity_pct = coalesce((p->>'low_activity_pct')::int, low_activity_pct),
    analytics_min_activity_pct = coalesce((p->>'analytics_min_activity_pct')::int, analytics_min_activity_pct),
    brigade_warn_pct = coalesce((p->>'brigade_warn_pct')::int, brigade_warn_pct),
    shift_target_total = coalesce((p->>'shift_target_total')::int, shift_target_total),
    brigade_target_jalol = coalesce((p->>'brigade_target_jalol')::int, brigade_target_jalol),
    brigade_target_li_son_hak = coalesce((p->>'brigade_target_li_son_hak')::int, brigade_target_li_son_hak),
    kpp_lunch_start_min = coalesce((p->>'kpp_lunch_start_min')::int, kpp_lunch_start_min),
    kpp_lunch_end_min = coalesce((p->>'kpp_lunch_end_min')::int, kpp_lunch_end_min),
    activity_sparkline_days = coalesce((p->>'activity_sparkline_days')::int, activity_sparkline_days),
    volume_sparkline_days = coalesce((p->>'volume_sparkline_days')::int, volume_sparkline_days),
    not_worn_min_sec = coalesce((p->>'not_worn_min_sec')::int, not_worn_min_sec),
    not_worn_warn_pct = coalesce((p->>'not_worn_warn_pct')::int, not_worn_warn_pct),
    not_worn_idle_sec_min = coalesce((p->>'not_worn_idle_sec_min')::int, not_worn_idle_sec_min),
    not_worn_active_sec_max = coalesce((p->>'not_worn_active_sec_max')::int, not_worn_active_sec_max),
    not_worn_min_interval_sec = coalesce((p->>'not_worn_min_interval_sec')::int, not_worn_min_interval_sec),
    not_worn_profession_rules = case
      when p ? 'not_worn_profession_rules' then coalesce(p->'not_worn_profession_rules', '{}'::jsonb)
      else not_worn_profession_rules
    end,
    block_1_enabled = coalesce((p->>'block_1_enabled')::boolean, block_1_enabled),
    block_2_enabled = coalesce((p->>'block_2_enabled')::boolean, block_2_enabled),
    block_3_enabled = coalesce((p->>'block_3_enabled')::boolean, block_3_enabled),
    block_4_enabled = coalesce((p->>'block_4_enabled')::boolean, block_4_enabled),
    block_5_enabled = coalesce((p->>'block_5_enabled')::boolean, block_5_enabled),
    block_6_enabled = coalesce((p->>'block_6_enabled')::boolean, block_6_enabled),
    block_7_enabled = coalesce((p->>'block_7_enabled')::boolean, block_7_enabled),
    comparison_brigades = coalesce(
      (
        select jsonb_agg(trim(value))
        from jsonb_array_elements_text(coalesce(p->'comparison_brigades', comparison_brigades)) as value
        where trim(value) <> ''
      ),
      comparison_brigades
    ),
    subblock_visibility = case
      when p ? 'subblock_visibility' then coalesce(subblock_visibility, '{}'::jsonb) || coalesce(p->'subblock_visibility', '{}'::jsonb)
      else subblock_visibility
    end,
    zone_visibility = case
      when p ? 'zone_visibility' then coalesce(zone_visibility, '{}'::jsonb) || coalesce(p->'zone_visibility', '{}'::jsonb)
      else zone_visibility
    end,
    updated_at = now()
  where id
  returning * into r;

  return to_jsonb(r) - 'id';
end;
$$;

grant execute on function analytics.set_metric_settings(jsonb) to service_role;

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
  where s.report_date = p_report_date
    and analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total);
$$;

drop view if exists analytics.brigade_weekly_metrics;
drop view if exists analytics.brigade_daily_metrics;
drop view if exists analytics.zone_daily_metrics;
drop view if exists analytics.idle_episodes_daily;

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
where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
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
  count(*) filter (where kpp_sec_total > 0) as kpp_shifts,
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
where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
group by date_trunc('week', report_date), coalesce(supervisor_name, 'Без начальника');

create view analytics.zone_daily_metrics as
select
  b.report_date,
  coalesce(sup.name, 'Без начальника') as supervisor_name,
  b.zona,
  sum(
    case
      when analytics.is_kpp_metric_minute(b.zona, b.event_at) then b.total_sec
      when b.zona = '13' then 0
      else b.total_sec
    end
  ) as sec,
  count(
    distinct case
      when b.zona = '13' and not analytics.is_kpp_metric_minute(b.zona, b.event_at) then null
      else b.ww_shift_id
    end
  ) as shifts
from analytics.ble_minute_facts b
join analytics.shift_daily_metrics m
  on m.ww_shift_id = b.ww_shift_id
 and m.report_date = b.report_date
left join analytics.shifts s on s.ww_shift_id = b.ww_shift_id
left join analytics.supervisors sup on sup.id = s.supervisor_id
where b.zona is not null
  and analytics.is_ble_shift_window_minute(b.event_at)
  and analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total)
group by b.report_date, coalesce(sup.name, 'Без начальника'), b.zona;

create view analytics.idle_episodes_daily as
select
  ie.*,
  coalesce(sup.name, 'Без начальника') as supervisor_name
from analytics.idle_episodes ie
join analytics.shifts s on s.ww_shift_id = ie.ww_shift_id and s.report_date = ie.report_date
join analytics.shift_daily_metrics m
  on m.ww_shift_id = ie.ww_shift_id
 and m.report_date = ie.report_date
left join analytics.supervisors sup on sup.id = s.supervisor_id
where ie.duration_min >= analytics.long_idle_threshold_min()
  and analytics.is_analytics_eligible_shift(m.work_sec_total, m.total_sec_total);

grant select on analytics.brigade_daily_metrics to anon, authenticated, service_role;
grant select on analytics.brigade_weekly_metrics to anon, authenticated, service_role;
grant select on analytics.zone_daily_metrics to anon, authenticated, service_role;
grant select on analytics.idle_episodes_daily to anon, authenticated, service_role;
