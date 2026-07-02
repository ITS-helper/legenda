-- Dashboard reads Report 10 via a public view (base table is blocked for anon by RLS).

create or replace view analytics.idle_episodes_daily as
select
  report_date,
  ww_shift_id,
  session_id,
  employee_number,
  full_name,
  dt_start,
  dt_end,
  duration_min,
  ble_tag_zone
from analytics.idle_episodes;

grant select on analytics.idle_episodes_daily to anon, authenticated, service_role;
