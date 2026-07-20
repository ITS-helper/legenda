-- zone_daily_metrics_for_dates: на недельном диапазоне (~170к строк ble_minute_facts)
-- вызов иногда вис по 2+ минуты (до statement_timeout) вместо секунды — воспроизведено
-- и диагностировано:
--   1) как language sql функция, она не инлайнится планировщиком при вызове с
--      параметрами (p_date_from/p_date_to) — Postgres строит ОДИН обобщённый план
--      без знания реальных дат и получает грубый промах в оценке строк (rows=1
--      вместо факта 172131), из-за чего иногда выбирается провальный план;
--      тот же SQL с датами-литералами напрямую отрабатывает за ~1-5 секунд;
--   2) внутри is_kpp_metric_minute — скалярный подзапрос к metric_settings,
--      вызываемый на каждой из ~170к строк;
--   3) count(distinct case ...) в group by вынуждал Sort вместо HashAggregate.
-- Исправление:
--   - функция переведена на plpgsql с EXECUTE format(...): даты подставляются
--     как литералы в SQL-текст на каждый вызов, поэтому планировщик ВСЕГДА видит
--     реальные значения и строит нормальный план (устраняет п.1);
--   - граница обеда читается один раз в CTE, а не подзапросом на строку (п.2);
--   - count(distinct) убран через промежуточную агрегацию по (дата, начальник,
--     зона, смена) перед финальной суммой (п.3).
-- Семантика расчёта sec/shifts не изменилась (сверено построчно со старой версией
-- на нескольких диапазонах перед деплоем). Однодневная версия
-- (zone_daily_metrics_for_date) не трогается — на дне данных мало и проблема
-- не проявляется.

create or replace function analytics.zone_daily_metrics_for_dates(
  p_date_from date,
  p_date_to date default null
)
returns table (
  report_date date,
  supervisor_name text,
  zona text,
  sec bigint,
  shifts bigint
)
language plpgsql
stable
security definer
set search_path = analytics, public, pg_temp
as $function$
begin
  return query execute format(
    $sql$
    with lunch as (
      select
        coalesce(kpp_lunch_start_min, 780) as lunch_start,
        coalesce(kpp_lunch_end_min, 840) as lunch_end
      from analytics.metric_settings
      where id
      limit 1
    ),
    ble_window as (
      select
        b.report_date,
        b.ww_shift_id,
        b.zona,
        b.total_sec,
        b.work_sec,
        coalesce(sup.name, 'Без начальника') as supervisor_name,
        (
          b.zona = '13'
          and not (
            (extract(hour from b.event_at at time zone 'Europe/Moscow') * 60
              + extract(minute from b.event_at at time zone 'Europe/Moscow'))::int >= l.lunch_start
            and (extract(hour from b.event_at at time zone 'Europe/Moscow') * 60
              + extract(minute from b.event_at at time zone 'Europe/Moscow'))::int < l.lunch_end
          )
        ) as is_kpp_minute
      from analytics.ble_minute_facts b
      cross join lunch l
      join analytics.shifts s
        on s.ww_shift_id = b.ww_shift_id
       and s.report_date = b.report_date
      left join analytics.supervisors sup on sup.id = s.supervisor_id
      where b.report_date >= %L::date
        and b.report_date <= %L::date
        and b.zona is not null
        and analytics.is_ble_shift_window_minute(b.event_at)
    ),
    shift_totals as (
      select
        ww_shift_id,
        report_date,
        coalesce(sum(work_sec), 0) as work_sec_total,
        coalesce(sum(total_sec), 0) as total_sec_total
      from ble_window
      group by ww_shift_id, report_date
    ),
    eligible_shifts as (
      select ww_shift_id, report_date
      from shift_totals
      where analytics.is_analytics_eligible_shift(work_sec_total, total_sec_total)
    ),
    per_shift_zone as (
      select
        w.report_date,
        w.supervisor_name,
        w.zona,
        w.ww_shift_id,
        sum(
          case
            when w.is_kpp_minute then w.total_sec
            when w.zona = '13' then 0
            else w.total_sec
          end
        ) as sec_sum,
        bool_or(not (w.zona = '13' and not w.is_kpp_minute)) as countable
      from ble_window w
      join eligible_shifts e
        on e.ww_shift_id = w.ww_shift_id
       and e.report_date = w.report_date
      group by w.report_date, w.supervisor_name, w.zona, w.ww_shift_id
    )
    select
      report_date,
      supervisor_name,
      zona,
      sum(sec_sum)::bigint as sec,
      count(*) filter (where countable)::bigint as shifts
    from per_shift_zone
    group by report_date, supervisor_name, zona
    $sql$,
    p_date_from,
    coalesce(p_date_to, p_date_from)
  );
end;
$function$;

grant execute on function analytics.zone_daily_metrics_for_dates(date, date) to anon, authenticated, service_role;
