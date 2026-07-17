# Report Sources

> Полные определения всех метрик и полей — в [metrics-reference.md](./metrics-reference.md)
> (перенос официального «Описания метрик Workwatch»). Этот файл описывает только
> практическую структуру импортируемых XLS. При расхождениях приоритет у
> `metrics-reference.md`.
>
> **Важно (по документу):** поля `sleep`, `wear`, `working_hours`, `work_code`,
> `chosen_metka`, `chosen_mapped_metka` в отчёте 11 (AA/BLE) **не используются** —
> не показывать их как метрики. Активность = `work_sec`, ходьба = `go_sec`,
> простой = `idle_sec` (включает «слабую активность»).
>
> **Часовые пояса источников РАЗНЫЕ.** Времена в файлах «наивные» (без пояса):
> отчёты **6 (faceID), 8 (LongIDLE), 10 (простои) — МСК**; отчёт **11 (AA/BLE,
> колонка `date`) — UTC**. Проверено по файлам за 2026-07-14: выдача часов
> `07:10:49` (МСК, faceID) соответствует первой минуте телеметрии `04:10` (UTC,
> AA/BLE). Парсеры (`scripts/lib/report-parsers.mjs`,
> `supabase/functions/sync-drive/parsers.ts`) обязаны использовать
> `parseMskDateValue` / `parseUtcDateValue` с явным смещением; парсить через
> таймзону машины нельзя — cron (UTC) и локальные запуски дают разные данные.

## Current Source Files

Validated against real files dated `2026-06-17` and `2026-07-01`:

- `11_отчет по АА_BLE со склейкой_LEGENDA_!NEW!_2026-06-17.xlsx`
- `6_report_6_faceID - по сменам_LEGENDA_!NEW!_2026-06-17.xlsx`
- `8_report_8_LongIDLE_LEGENDA_!NEW!_2026-07-01.xlsx`

## Business Context

- Two brigades wear smart watches during the work shift.
- `AA_BLE` is the main telemetry source from the watches.
- `faceID` is the people and attendance source.

## Google Drive Archive Layout

Root folder `LEGENDA` contains archive subfolders:

| Source | Archive folder | Обязательный |
|--------|----------------|--------------|
| faceID | `6_report_6_faceID_arh` | да |
| AA_BLE | `aa_ble_arh` | да |
| LongIDLE | `8_report_8_LongIDLE_arh` | да |
| Отчёт 10 (длительные простои) | `10_report_10_long_idle_arh` | нет (опционально) |

Не используется:

- `100_report_alerts_arh`

## Shared Summary Sheet

Both files contain `Sheet1` with the same daily summary:

- `Дата статистики`
- `Количество смен`
- `Количество тех. сессий`
- `Количество тех. сессий открытых`
- `Количество тех. сессий без графика`
- `Количество тех. сессий с фичами`
- `Количество тех. сессий с BB`
- `Количество обработанных тех. сессий`
- `Количество необработанных тех. сессий`

Sample for `2026-06-17`:

- shifts: `44`
- tech sessions: `43`
- unprocessed tech sessions: `43`

This summary should be stored as a daily import snapshot, but not used as the main analytical grain.

## Source 1: faceID

`Sheet2` contains one row per shift / person attendance record.

### Grain

One row per employee shift for one day.

### Observed Columns

1. `Дата смены`
2. `ID смены WW`
3. `Номер`
4. `ФИО`
5. `Объект`
6. `ТН-заказчика`
7. `Участок`
8. `Начальник`
9. `Профессия`
10. `График`
11. `План начало смены`
12. `План конец смены`
13. `Время получения часов`
14. `Время сдачи часов`
15. `Итого находился в часах`
16. `Итого находился в часах (c)`
17. `Смена больше 18 часов`
18. `на сколько опоздал (с)`
19. `на сколько раньше сдал (c)`
20. `ID тех. сессий`
21. `Хэш расчета`

### Meaning

This file should be treated as:

- employee reference source
- attendance source
- shift registry
- supervisor / brigade attribution source
- link source to technical sessions

### Observed Real Data Notes

- `43` shift rows for `2026-06-17`
- all visible rows belong to object `Легенда`
- observed supervisors:
  - `ЛИ СОН ХАК` with `24` shifts
  - `Джалол` with `19` shifts
- observed schedule:
  - `Дневная смена Васильевский`

### Key Fields For Modeling

- employee key: likely `Номер`
- shift key: `ID смены WW`
- session linkage: `ID тех. сессий`
- reporting day: `Дата смены`

## Source 2: AA_BLE

`Sheet2` contains minute-level telemetry from smart watches during technical sessions.

### Grain

One row per minute-like event within a technical session.

### Observed Columns

1. `ТН`
2. `user_id`
3. `ID смены WW`
4. `День смены`
5. `ID сессии`
6. `idle_sec`
7. `go_sec`
8. `work_sec`
9. `total_sec`
10. `ble_tags`
11. `metka`
12. `zona`
13. `chosen_metka`
14. `chosen_mapped_metka`
15. `Дата на объекте`
16. `Время на объекте`
17. `working_hours`
18. `work_code`
19. `sleep`
20. `wear`
21. `date`

### Meaning

This file should be treated as the main telemetry fact source:

- movement / presence state
- work / idle / go seconds
- watch wearing state
- sleep state
- beacon or zone tag attribution
- time-series behavior during a shift

### Observed Real Data Notes

- `41101` telemetry rows for `2026-06-17`
- `43` unique employees
- `43` unique shift IDs
- `43` unique session IDs
- each observed row has `total_sec = 60`, so the current sample behaves like one-minute buckets

### Key Fields For Modeling

- employee key: `ТН`
- shift key: `ID смены WW`
- session key: `ID сессии`
- event timestamp: `date`
- event local date and time:
  - `Дата на объекте`
  - `Время на объекте`

## Join Strategy

The core join path should be:

- `faceID.ID смены WW` -> `AA_BLE.ID смены WW`

Secondary join:

- `faceID.ID тех. сессий` -> `AA_BLE.ID сессии`

This means:

- `faceID` supplies the who and planned shift context
- `AA_BLE` supplies the behavioral telemetry inside that shift

## Recommended Database Shape

### Dimension / Registry Tables

- `employees`
- `supervisors`
- `brigades`
- `shift_schedules`
- `shifts`
- `sessions`
- `import_files`

### Fact Tables

- `attendance_facts`
  - one row per employee shift from `faceID`

- `ble_minute_facts`
  - one row per telemetry event from `AA_BLE`

- `ble_daily_shift_facts`
  - derived aggregates by employee and shift

## First Derived Metrics We Can Build

From `faceID`:

- attendance count
- late arrival seconds
- early return seconds
- total watch possession time
- overtime / over-18-hours flag

From `AA_BLE`:

- total idle seconds
- total moving seconds
- total working seconds
- wear ratio
- sleep ratio
- zone / marker distribution
- active minutes by shift

Combined:

- attendance vs telemetry completeness
- shift duration vs actual telemetry duration
- supervisor comparison
- brigade comparison
- employee ranking by productive time

## Source 4: Report 10 (Длительные простои)

Опционально импортируется из папки `10_report_10_long_idle_arh`.
Файл: `10_report_10_длительные_простои_LEGENDA_!NEW!_YYYY-MM-DD.xlsx`, лист `Sheet2`.

Одна строка = один эпизод длительного простоя (≥ 5 мин). Колонки (0-based):
`ID смены WW`, `session_id`, `plan_work_begin`, `ТН`, `ФИО`, `dt_start`, `dt_end`,
`duration` (мин), `work_type`, `work_code`, `chosen_ble_tag_number`,
`chosen_ble_tag_zone`, `ble_label`. Пишется в таблицу `analytics.idle_episodes`.
Полные определения — в [metrics-reference.md](./metrics-reference.md), зоны — в
[zones-reference.md](./zones-reference.md).

## Importer Rules We Should Implement

- import all three files as one daily batch
- require matching report date across files
- create one `shift` record from `faceID`
- attach one or more `session` records to the shift
- store raw BLE rows before aggregation
- store LongIDLE session aggregates in `long_idle_facts`
- calculate daily and shift aggregates after raw import succeeds

## Source 3: LongIDLE

Validated against real file dated `2026-07-01`:

- `8_report_8_LongIDLE_LEGENDA_!NEW!_2026-07-01.xlsx`

### Grain

One row per technical session with aggregated idle / long-idle metrics for the shift day.

### Observed Columns (`Sheet2`)

1. `ТН`
2. `ТН Заказчика`
3. `ФИО`
4. `Участок`
5. `Начальник`
6. `Профессия`
7. `Объект смены`
8. `date` (report day)
9. `date_begin`
10. `date_end`
11. `Итого находился в часах`
12. `График работы`
13. `ID смены WW`
14. `EUI часов`
15. `session_id`
16. `full_go`
17. `real_go`
18. `full_work`
19. `real_work`
20. `full_idle`
21. `real_idle`
22. `full_idle_seconds`
23. `real_idle_seconds`
24. `full_go_seconds`
25. `real_go_seconds`
26. `full_work_seconds`
27. `real_work_seconds`
28. `full_total_seconds`
29. `real_total_seconds`
30. `full_long_idle_seconds`
31. `full_common_idle_seconds`
32. `long_data__idle_seconds`
33. `long_data__total_seconds`
34. `real_comon_idle`
35. `real_long_idle`

### Meaning

LongIDLE supplements AA_BLE with session-level idle analytics, including long idle duration and common idle share.

### Key Fields For Modeling

- employee key: `ТН`
- shift key: `ID смены WW`
- session key: `session_id`
- reporting day: `date`

## Important Product Decision

The dashboard should not be built directly around spreadsheet tabs.

It should be built around business views:

- attendance
- shift execution
- watch usage
- productivity
- brigade comparison
