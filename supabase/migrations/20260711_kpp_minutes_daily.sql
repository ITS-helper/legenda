-- Дашборд читает минуты КПП через view (базовая таблица недоступна anon из‑за RLS).

create or replace view analytics.kpp_minutes_daily as
select
  report_date,
  ww_shift_id,
  event_at
from analytics.ble_minute_facts
where zona = '13';

grant select on analytics.kpp_minutes_daily to anon, authenticated, service_role;
