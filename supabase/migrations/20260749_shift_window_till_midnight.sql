-- Смену рабочим продлили до 24:00 с 04.08.2026.
--
-- Метрики считаются на лету из минутных фактов, поэтому окно сделано зависящим от даты смены:
-- иначе пересчиталась бы вся история и цифры разошлись бы с уже отправленными отчётами
-- (после 23:00 телеметрия есть, например, за 30.07 — 12,6 ч и за 03.08 — 6,3 ч).
--
-- Дата перехода — константа в immutable-функции: планировщик её инлайнит, и стоимость
-- проверки не меняется. Следующий сдвиг графика — новая миграция с новой датой.

create or replace function analytics.shift_window_end_min(p_msk_date date)
returns int
language sql
immutable
parallel safe
as $$
  select case when p_msk_date >= date '2026-08-04' then 1440 else 1380 end;
$$;

comment on function analytics.shift_window_end_min(date) is
  'Конец окна рабочей смены в минутах от полуночи МСК: до 03.08.2026 — 23:00, с 04.08.2026 — 24:00.';

create or replace function analytics.is_ble_shift_window_minute(p_event_at timestamptz)
returns boolean
language sql
immutable
parallel safe
as $$
  select (
    (extract(hour from p_event_at at time zone 'Europe/Moscow') * 60
      + extract(minute from p_event_at at time zone 'Europe/Moscow'))::int >= 420
    and (extract(hour from p_event_at at time zone 'Europe/Moscow') * 60
      + extract(minute from p_event_at at time zone 'Europe/Moscow'))::int
        < analytics.shift_window_end_min((p_event_at at time zone 'Europe/Moscow')::date)
  );
$$;

grant execute on function analytics.shift_window_end_min(date) to anon, authenticated, service_role;
