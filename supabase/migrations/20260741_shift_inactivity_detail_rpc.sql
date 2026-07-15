-- Детализация бездействия: поминутная телеметрия + простои (отчёт 10) + not_worn для одной смены.

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
          and analytics.is_ble_shift_window_minute(b.event_at)
      ),
      '[]'::json
    )
  );
$$;

grant execute on function analytics.shift_inactivity_detail_for_shift(date, bigint) to anon, authenticated, service_role;
