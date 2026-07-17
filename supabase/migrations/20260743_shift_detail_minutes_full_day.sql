-- Детализация смены: минуты телеметрии отдаём за все сутки смены, без окна 07:00–23:00.
-- Хронология в диалоге должна показывать реальные начало и конец работы часов; окно
-- 07:00–23:00 остаётся только в агрегатах (shift_daily_metrics и пр.), где считаются проценты.
-- Остальные части ответа (границы смены, эпизоды) — без изменений относительно 20260742.

create or replace function analytics.shift_inactivity_detail_for_shift(
  p_report_date date,
  p_ww_shift_id bigint
)
returns json
language sql
stable
security definer
set search_path = analytics, public, pg_temp
as $$
  select json_build_object(
    'shift_start',
    (
      select s.watch_received_at
      from analytics.shifts s
      where s.report_date = p_report_date
        and s.ww_shift_id = p_ww_shift_id
      limit 1
    ),
    'shift_end',
    (
      select s.watch_returned_at
      from analytics.shifts s
      where s.report_date = p_report_date
        and s.ww_shift_id = p_ww_shift_id
      limit 1
    ),
    'idle_episodes',
    coalesce(
      (
        select json_agg(
          json_build_object(
            'session_id', ie.session_id,
            'dt_start', ie.dt_start,
            'dt_end', ie.dt_end,
            'duration_min', ie.duration_min,
            'ble_tag_zone', ie.ble_tag_zone
          )
          order by ie.dt_start
        )
        from analytics.idle_episodes ie
        where ie.report_date = p_report_date
          and ie.ww_shift_id = p_ww_shift_id
          and ie.duration_min >= analytics.long_idle_threshold_min()
      ),
      '[]'::json
    ),
    'not_worn_episodes',
    coalesce(
      (
        select json_agg(
          json_build_object(
            'episode_start', r.episode_start,
            'episode_end', r.episode_end,
            'episode_sec', r.episode_sec
          )
          order by r.episode_start
        )
        from analytics.not_worn_episode_ranges_for_date(p_report_date, array[p_ww_shift_id]) r
      ),
      '[]'::json
    ),
    'minutes',
    coalesce(
      (
        select json_agg(
          json_build_object(
            'event_at', b.event_at,
            'work_sec', b.work_sec,
            'go_sec', b.go_sec,
            'idle_sec', b.idle_sec,
            'total_sec', b.total_sec,
            'zona', b.zona
          )
          order by b.event_at
        )
        from analytics.ble_minute_facts b
        where b.report_date = p_report_date
          and b.ww_shift_id = p_ww_shift_id
      ),
      '[]'::json
    )
  );
$$;

grant execute on function analytics.shift_inactivity_detail_for_shift(date, bigint) to anon, authenticated, service_role;
