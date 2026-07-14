-- Оптимизация block7: один проход по минутам за дату вместо not_worn_sec_for_shift на каждую смену.

create or replace function analytics.not_worn_episode_minutes_for_date(
  p_report_date date,
  p_shift_ids bigint[] default null
)
returns table (
  ww_shift_id bigint,
  event_at timestamptz,
  total_sec integer
)
language sql
stable
security definer
set search_path = analytics, public, pg_temp
as $$
  with suspicious as (
    select
      b.ww_shift_id,
      b.event_at,
      coalesce(b.total_sec, 60) as total_sec
    from analytics.ble_minute_facts b
    join analytics.shifts s on s.ww_shift_id = b.ww_shift_id and s.report_date = b.report_date
    join analytics.employees e on e.id = s.employee_id
    where b.report_date = p_report_date
      and (p_shift_ids is null or b.ww_shift_id = any(p_shift_ids))
      and analytics.is_not_worn_metric_minute(
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
      ww_shift_id,
      event_at,
      total_sec,
      case
        when lag(event_at) over (partition by ww_shift_id order by event_at) is null
          or event_at - lag(event_at) over (partition by ww_shift_id order by event_at) > interval '90 seconds'
        then 1
        else 0
      end as is_new_episode
    from suspicious
  ),
  grouped as (
    select
      ww_shift_id,
      event_at,
      total_sec,
      sum(is_new_episode) over (partition by ww_shift_id order by event_at) as episode_id
    from marked
  ),
  qualifying as (
    select ww_shift_id, episode_id
    from grouped
    group by ww_shift_id, episode_id
    having sum(total_sec) >= analytics.not_worn_min_interval_sec()
  )
  select g.ww_shift_id, g.event_at, g.total_sec::integer
  from grouped g
  inner join qualifying q using (ww_shift_id, episode_id);
$$;

create or replace function analytics.not_worn_episode_totals_for_date(p_report_date date)
returns table (
  ww_shift_id bigint,
  not_worn_sec_total bigint
)
language sql
stable
security definer
set search_path = analytics, public, pg_temp
as $$
  select
    m.ww_shift_id,
    sum(m.total_sec)::bigint as not_worn_sec_total
  from analytics.not_worn_episode_minutes_for_date(p_report_date, null) m
  group by m.ww_shift_id
  having sum(m.total_sec) > 0;
$$;

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

grant execute on function analytics.not_worn_episode_minutes_for_date(date, bigint[]) to anon, authenticated, service_role;
grant execute on function analytics.not_worn_episode_totals_for_date(date) to anon, authenticated, service_role;
grant execute on function analytics.list_not_worn_shifts_for_date(date) to anon, authenticated, service_role;
