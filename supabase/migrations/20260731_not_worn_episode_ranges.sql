-- Интервалы «Не носил»: диапазоны эпизодов вместо поминутной выгрузки (обход лимита PostgREST ~1000 строк).

create or replace function analytics.not_worn_episode_ranges_for_date(
  p_report_date date,
  p_shift_ids bigint[] default null
)
returns table (
  ww_shift_id bigint,
  episode_start timestamptz,
  episode_end timestamptz,
  episode_sec bigint
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
  select
    g.ww_shift_id,
    min(g.event_at) as episode_start,
    max(g.event_at) as episode_end,
    sum(g.total_sec)::bigint as episode_sec
  from grouped g
  inner join qualifying q using (ww_shift_id, episode_id)
  group by g.ww_shift_id, g.episode_id
  order by g.ww_shift_id, min(g.event_at);
$$;

grant execute on function analytics.not_worn_episode_ranges_for_date(date, bigint[]) to anon, authenticated, service_role;
