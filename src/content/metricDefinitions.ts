import type { NumericMetricSettingKey } from '../lib/metricSettings'
import { formatMskTimeFromMinutes, parseMskTimeToMinutes } from '../lib/mskTime'

export const MSK_TIME_ZONE = 'Europe/Moscow'

export type MetricConfigFieldKey = NumericMetricSettingKey

export type MetricDefinition = {
  id: string
  block: string
  title: string
  description: string
  sources: string[]
  formula: string
  notes?: string
  configFields?: Array<{
    key: MetricConfigFieldKey
    label: string
    unit?: string
    min: number
    max: number
    step?: number
    hint?: string
  }>
}

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    id: 'workers',
    block: 'Блок 1 · Ежедневная аналитика',
    title: 'Вышло на смену',
    description: 'Число смен (уникальных ww_shift_id) по бригаде за выбранный день.',
    sources: [
      'View `analytics.brigade_daily_metrics` → поле `workers`',
      'Смены из отчёта faceID (или LongIDLE, если faceID ещё не импортирован)',
    ],
    formula: 'workers = COUNT(*) по сменам бригады за report_date',
    configFields: [
      { key: 'shiftTargetTotal', label: 'Целевой показатель (всего)', unit: 'чел.', min: 1, max: 500 },
      { key: 'brigadeTargetJalol', label: 'Цель · бригада Джалол', unit: 'чел.', min: 1, max: 200 },
      { key: 'brigadeTargetLiSonHak', label: 'Цель · бригада ЛИ СОН ХАК', unit: 'чел.', min: 1, max: 200 },
    ],
    notes: 'На карточках отображается «факт / цель», например 30 / 50.',
  },
  {
    id: 'activity',
    block: 'Блок 1 · Ежедневная аналитика',
    title: 'Активность',
    description: 'Доля времени в активной работе от общего времени телеметрии BLE.',
    sources: [
      'Отчёт 11 · AA_BLE → `ble_minute_facts.work_sec`',
      'View `analytics.shift_daily_metrics` → `work_sec_total`, `total_sec_total`',
      'View `analytics.brigade_daily_metrics` → `activity_pct`',
    ],
    formula: 'activity_pct = 100 × Σ(work_sec) / Σ(total_sec)',
    notes: 'Проценты по бригаде — сумма секунд всех смен бригады, не среднее арифметическое процентов.',
  },
  {
    id: 'weak_activity',
    block: 'Блок 1 · Ежедневная аналитика',
    title: 'Слабая активность',
    description: 'Простой без длительных эпизодов: общий idle минус длительный простой.',
    sources: [
      'AA_BLE → `idle_sec` по минутам',
      'Отчёт 10 · idle_episodes → эпизоды ≥ порога длительного простоя',
    ],
    formula:
      'weak_activity_sec = max(idle_sec_total − long_idle_sec_total, 0)\nweak_activity_pct = 100 × weak_activity_sec / total_sec',
    notes:
      'В системе мониторинга это поле `idle_sec` (простой / бездействие по датчику). В Legenda «слабая активность» — остаток простоя после вычитания длительных эпизодов: короткие паузы и минуты с низким движением, не попавшие в порог длительного простоя.',
  },
  {
    id: 'long_idle',
    block: 'Блок 1 · Ежедневная аналитика',
    title: 'Длительный простой',
    description: 'Суммарное время эпизодов бездействия не короче заданного порога.',
    sources: [
      'Отчёт 10 · `idle_episodes` (файл long_idle_arh)',
      'View `analytics.shift_daily_metrics` → `long_idle_sec_total`',
    ],
    formula:
      'long_idle_sec = Σ(duration_min × 60) WHERE duration_min ≥ порог\nlong_idle_pct = 100 × long_idle_sec / total_sec',
    configFields: [
      {
        key: 'longIdleMin',
        label: 'Порог длительного простоя',
        unit: 'мин',
        min: 1,
        max: 180,
        hint: 'Эпизоды короче порога идут в «слабую активность»',
      },
    ],
  },
  {
    id: 'go',
    block: 'Блок 1 · Ежедневная аналитика',
    title: 'Ходьба между зонами',
    description: 'Время перемещения между BLE-зонами (GO).',
    sources: ['AA_BLE → `ble_minute_facts.go_sec`'],
    formula: 'go_pct = 100 × Σ(go_sec) / Σ(total_sec)',
  },
  {
    id: 'kpp',
    block: 'Блок 1 · Ежедневная аналитика',
    title: 'Замечены на КПП',
    description: 'Сотрудники с ненулевым временем в зоне 13 (контрольно-пропускной пункт).',
    sources: ['AA_BLE → минуты с zona = 13', 'Функция `analytics.is_kpp_metric_minute`'],
    formula: 'kpp_workers = COUNT смен WHERE kpp_sec_total > 0',
    configFields: [
      {
        key: 'kppLunchStartMin',
        label: 'Начало обеда (не считать КПП)',
        min: 0,
        max: 1439,
      },
      {
        key: 'kppLunchEndMin',
        label: 'Конец обеда (не считать КПП)',
        min: 1,
        max: 1440,
      },
    ],
    notes: 'Время обеда задаётся по Москве (МСК). По умолчанию 13:00–14:00 — минуты КПП в этом интервале не учитываются.',
  },
  {
    id: 'pv',
    block: 'Блок 1 · Ежедневная аналитика',
    title: 'В рабочей зоне (ПВ)',
    description: 'Доля времени в производственной зоне (zona = 1).',
    sources: ['AA_BLE → `ble_minute_facts` WHERE zona = 1', 'View `zone_daily_metrics` для детализации по зонам'],
    formula: 'pv_pct = 100 × pv_sec / Σ(секунды по всем видимым зонам, кроме скрытых)',
    notes: 'Зона 0 скрыта из UI. Зона 13 (КПП) в блоке «Местоположение» показывается отдельно.',
  },
  {
    id: 'shift_duration',
    block: 'Блок 1 · Ежедневная аналитика',
    title: 'Длительность смены',
    description: 'Среднее время «в часах» по сменам бригады.',
    sources: ['faceID / LongIDLE → `shifts.on_watch_duration_seconds`'],
    formula: 'avg_shift_duration_sec = AVG(on_watch_duration_seconds) WHERE > 0',
  },
  {
    id: 'attention',
    block: 'Блок 1 · Ежедневная аналитика',
    title: 'Требуют внимания',
    description: 'Сотрудники с активностью ниже порога за день или неделю.',
    sources: ['View `shift_daily_metrics` / `brigade_weekly_metrics`'],
    formula: 'productivity = 100 × work_sec_total / total_sec_total\nотбор: productivity < low_activity_pct',
    configFields: [
      {
        key: 'lowActivityPct',
        label: 'Порог низкой активности',
        unit: '%',
        min: 1,
        max: 100,
      },
    ],
  },
  {
    id: 'brigade_warn',
    block: 'Блок 1 · Ежедневная аналитика',
    title: 'Предупреждение на карточке бригады',
    description: 'Жёлтый бейдж, если активность бригады ниже порога.',
    sources: ['`brigade_daily_metrics.activity_pct`'],
    formula: 'badge-warn если activity_pct < brigade_warn_pct',
    configFields: [
      {
        key: 'brigadeWarnPct',
        label: 'Порог предупреждения бригады',
        unit: '%',
        min: 1,
        max: 100,
      },
    ],
  },
  {
    id: 'weekly',
    block: 'Блок 2 · Еженедельная аналитика',
    title: 'Недельные показатели',
    description: 'Те же метрики (активность, слабая активность, длительный простой, GO, КПП), агрегированные за неделю Пн–Вс.',
    sources: ['View `analytics.brigade_weekly_metrics`'],
    formula:
      'week_start = date_trunc(week, report_date)\nПроценты считаются от суммы секунд за все дни недели\navg_workers = COUNT(смен) / COUNT(DISTINCT report_date)',
  },
  {
    id: 'activity_dynamics',
    block: 'Блок 3 · Динамика',
    title: 'Динамика активности',
    description: 'Сравнение активности выбранных бригад: сегодня vs вчера, sparkline за N дней.',
    sources: ['`brigade_daily_metrics` по списку comparisonBrigades из настроек'],
    formula: 'delta = activity_pct(день) − activity_pct(день−1)',
    configFields: [
      {
        key: 'activitySparklineDays',
        label: 'Количество дней на карточке',
        unit: 'дней',
        min: 3,
        max: 60,
      },
    ],
  },
  {
    id: 'volume_dynamics',
    block: 'Блок 3 · Динамика',
    title: 'Динамика выполненных объёмов',
    description: 'Сравнение суммарных м³ по бригадам из загруженных GPR-файлов.',
    sources: ['Таблица `analytics.volume_entries`', 'Парсер Excel GPR (вкладка ЛВ2_монолит К2)'],
    formula: 'delta_m3 = volume(день) − volume(день−1)',
    configFields: [
      {
        key: 'volumeSparklineDays',
        label: 'Количество дней на карточке',
        unit: 'дней',
        min: 3,
        max: 60,
      },
    ],
  },
  {
    id: 'zones',
    block: 'Блок 4 · Местоположение и простои',
    title: 'Распределение по зонам',
    description: 'Сколько времени каждая бригада провела в каждой BLE-зоне.',
    sources: ['AA_BLE → группировка по zona', 'View `zone_daily_metrics`', 'Справочник зон — `zones.ts`'],
    formula: 'sec по зоне = Σ(total_sec) WHERE zona = N\nПроцент = sec_зоны / sec_всех_зон бригады',
    notes: 'Какие зоны показывать — в настройках блока 4 (галочки по каждой BLE-зоне). По умолчанию скрыты зона 0 и КПП (13).',
  },
  {
    id: 'idle_episodes',
    block: 'Блок 4 · Местоположение и простои',
    title: 'Эпизоды длительного простоя по зонам',
    description: 'Список эпизодов бездействия с привязкой к зоне BLE.',
    sources: ['`idle_episodes` + view `idle_episodes_daily`', 'Фильтр duration_min ≥ порог'],
    formula: 'Отбор эпизодов с duration_min ≥ long_idle_min, группировка по ble_tag_zone',
    configFields: [
      {
        key: 'longIdleMin',
        label: 'Порог длительного простоя',
        unit: 'мин',
        min: 1,
        max: 180,
      },
    ],
  },
  {
    id: 'volumes',
    block: 'Блок 5 · Объёмы',
    title: 'Выполненные объёмы (м³)',
    description: 'Фактические объёмы монолита по бригадам из Excel заказчика или ручного ввода.',
    sources: ['Таблица `volume_entries`', 'Импорт GPR Excel / ручное редактирование на дашборде'],
    formula: 'volume_m3 = SUM(value) GROUP BY report_date, brigade_name',
    notes: 'СНГ → бригада Джалол; КНДР → ЛИ СОН ХАК (правила парсера GPR).',
  },
  {
    id: 'shift_table',
    block: 'Блок 6 · Детализация',
    title: 'Таблица смен',
    description: 'Построчная детализация: профессия, работа, слабая активность, длительный простой, всего, активность %, КПП.',
    sources: ['View `shift_daily_metrics`'],
    formula:
      'productivity = 100 × work_sec_total / total_sec_total\nКПП: «да», если kpp_sec_total > 0',
  },
  {
    id: 'not_worn',
    block: 'Блок 7 · Не носил',
    title: 'Не носил часы',
    description:
      'Поведенческая оценка: минуты почти полного простоя без движения вне зон отдыха (столовые, курилки, отдых, стройгородок — zona 2, 4, 5, 14). Датчик wear не используется. Обед 13:00–14:00 МСК не учитывается.',
    sources: [
      'Отчёт 11 · AA_BLE → `idle_sec`, `work_sec`, `go_sec`, `zona`, `event_at`',
      'Функции `analytics.is_rest_zone`, `analytics.is_lunch_minute`, `analytics.is_not_worn_metric_minute`',
      'View `analytics.shift_daily_metrics` → `not_worn_sec_total`, `not_worn_eligible_sec_total`',
      'View `analytics.not_worn_minutes_daily` → интервалы в списке сотрудников',
    ],
    formula:
      'Подозрительная минута вне зон отдыха (не обед): idle_sec ≥ порог И work_sec + go_sec ≤ порог\nnot_worn_pct = 100 × not_worn_sec / eligible_sec',
    configFields: [
      {
        key: 'notWornIdleSecMin',
        label: 'Минимум простоя в минуте',
        unit: 'сек',
        min: 30,
        max: 60,
        hint: 'Обычно 54 (= 90% минуты). Минута считается «мёртвой», если idle_sec не ниже порога',
      },
      {
        key: 'notWornActiveSecMax',
        label: 'Максимум активности в минуте',
        unit: 'сек',
        min: 0,
        max: 30,
        hint: 'work_sec + go_sec должны быть не выше этого значения',
      },
      {
        key: 'notWornMinSec',
        label: 'Минимум за смену для списка',
        unit: 'сек',
        min: 60,
        max: 7200,
        hint: 'Сотрудник попадает в список, если сумма подозрительных минут ≥ порога (по умолчанию 15 мин)',
      },
      {
        key: 'notWornWarnPct',
        label: 'Порог предупреждения',
        unit: '%',
        min: 1,
        max: 100,
        hint: 'Подсветка карточки бригады и сотрудника при превышении доли',
      },
    ],
    notes: 'В рассылку не входит. Только дашборд. На старых часах wear ненадёжен — метрика строится по простою и отсутствию движения. Ниже в блоке — отдельные пороги по профессиям.',
  },
]

export const METRIC_BLOCKS = [...new Set(METRIC_DEFINITIONS.map((m) => m.block))]

export function formatMinutesFromMidnight(minutes: number) {
  return formatMskTimeFromMinutes(minutes)
}

export function parseTimeToMinutes(value: string) {
  return parseMskTimeToMinutes(value)
}
