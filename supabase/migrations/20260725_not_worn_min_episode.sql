-- «Не носил»: учитывать только непрерывные эпизоды подозрительного простоя от 30 минут.

alter table analytics.metric_settings
  add column if not exists not_worn_min_interval_sec integer not null default 1800
  check (not_worn_min_interval_sec between 60 and 14400);

create or replace function analytics.not_worn_min_interval_sec()
returns integer
language sql
stable
security definer
set search_path = analytics, public, pg_temp
as $$
  select coalesce(
    (select not_worn_min_interval_sec from analytics.metric_settings order by id limit 1),
    1800
  );
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

drop view if exists analytics.idle_episodes_daily;
drop view if exists analytics.brigade_weekly_metrics;
drop view if exists analytics.brigade_daily_metrics;
drop view if exists analytics.shift_daily_metrics;
drop view if exists analytics.not_worn_minutes_daily;

create view analytics.not_worn_minutes_daily as
with suspicious as (
  select
    b.report_date,
    b.ww_shift_id,
    b.event_at,
    coalesce(b.total_sec, 60) as total_sec
  from analytics.ble_minute_facts b
  join analytics.shifts s on s.ww_shift_id = b.ww_shift_id and s.report_date = b.report_date
  join analytics.employees e on e.id = s.employee_id
  where analytics.is_not_worn_metric_minute(
    b.idle_sec,
    b.work_sec,
    b.go_sec,
    b.total_sec,
    b.zona,
    e.profession,
    b.event_at
  )
),
marked as (
  select
    report_date,
    ww_shift_id,
    event_at,
    total_sec,
    case
      when lag(event_at) over (partition by report_date, ww_shift_id order by event_at) is null
        or event_at - lag(event_at) over (partition by report_date, ww_shift_id order by event_at) > interval '90 seconds'
      then 1
      else 0
    end as is_new_episode
  from suspicious
),
grouped as (
  select
    report_date,
    ww_shift_id,
    event_at,
    total_sec,
    sum(is_new_episode) over (partition by report_date, ww_shift_id order by event_at) as episode_id
  from marked
),
qualifying as (
  select report_date, ww_shift_id, episode_id
  from grouped
  group by report_date, ww_shift_id, episode_id
  having sum(total_sec) >= analytics.not_worn_min_interval_sec()
)
select g.report_date, g.ww_shift_id, g.event_at, g.total_sec
from grouped g
inner join qualifying q using (report_date, ww_shift_id, episode_id);

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
  coalesce(nw.not_worn_sec_total, 0) as not_worn_sec_total,
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
left join (
  select report_date, ww_shift_id, sum(total_sec) as not_worn_sec_total
  from analytics.not_worn_minutes_daily
  group by report_date, ww_shift_id
) nw on nw.report_date = s.report_date and nw.ww_shift_id = s.ww_shift_id
left join analytics.ble_minute_facts b on b.ww_shift_id = s.ww_shift_id
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
  s.early_return_seconds,
  nw.not_worn_sec_total;

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
grant select on analytics.not_worn_minutes_daily to anon, authenticated, service_role;
