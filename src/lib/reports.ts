import { supabase } from './supabase'
import { parseVolumeM3 } from './volumes'
import { zoneName } from './zones'
import { filterDistributionZoneRows, isZoneVisibleInDistribution } from './zoneVisibility'
import {
  DEFAULT_METRIC_SETTINGS,
  getBrigadeShiftTargets,
  getComparisonBrigades,
  getMetricSettings,
} from './metricSettings'

export { getComparisonBrigades, TRACKED_BRIGADES } from './metricSettings'

export type BrigadeDailyRow = {
  report_date: string
  supervisor_name: string
  workers: number
  work_sec: number
  weak_activity_sec: number
  long_idle_sec: number
  go_sec: number
  total_sec: number
  pv_sec: number
  kpp_sec: number
  kpp_workers: number
  activity_pct: number
  weak_activity_pct: number
  long_idle_pct: number
  go_pct: number
  avg_shift_duration_sec: number
  not_worn_sec: number
  not_worn_eligible_sec: number
  not_worn_workers: number
  not_worn_pct: number
}

export type BrigadeWeeklyRow = {
  week_start: string
  week_end: string
  supervisor_name: string
  days: number
  unique_employees: number
  avg_workers: number
  work_sec: number
  weak_activity_sec: number
  long_idle_sec: number
  go_sec: number
  total_sec: number
  pv_sec: number
  kpp_sec: number
  kpp_shifts: number
  activity_pct: number
  weak_activity_pct: number
  long_idle_pct: number
  go_pct: number
  avg_shift_duration_sec: number
}

export type ZoneDailyRow = {
  zona: number
  zonaName: string
  sec: number
  shifts: number
}

export type BrigadeZoneDaily = {
  supervisor_name: string
  rows: ZoneDailyRow[]
}

export type IdleEpisode = {
  ww_shift_id: number
  session_id: number | null
  employee_number: string | null
  full_name: string | null
  supervisor_name: string
  dt_start: string | null
  dt_end: string | null
  duration_min: number
  ble_tag_zone: number | null
  zonaName: string
}

export type ShiftMetricRow = {
  report_date: string
  ww_shift_id: number
  employee_number: string
  full_name: string
  profession: string | null
  supervisor_name: string | null
  schedule_name: string | null
  on_watch_duration_seconds: number | null
  late_seconds: number | null
  early_return_seconds: number | null
  telemetry_rows?: number
  idle_sec_total: number
  weak_activity_sec_total: number
  long_idle_sec_total: number
  go_sec_total: number
  work_sec_total: number
  total_sec_total: number
  pv_sec_total: number
  outside_pv_sec_total: number
  kpp_sec_total: number
  not_worn_sec_total: number
  not_worn_eligible_sec_total: number
  not_worn_shift_min_sec?: number
}

export type KppEmployee = {
  ww_shift_id: number
  employee_number: string
  full_name: string
  supervisor_name: string
  kpp_sec: number
  kpp_time: string
}

export type NotWornEmployee = {
  ww_shift_id: number
  employee_number: string
  full_name: string
  profession: string | null
  supervisor_name: string
  not_worn_sec: number
  not_worn_pct: number
  not_worn_time: string
  activity_pct: number
  weak_activity_pct: number
  long_idle_pct: number
  go_pct: number
}

import { MSK_TIME_ZONE } from './mskTime'

export function isKppMetricMinuteAt(eventAt: string) {
  const { kppLunchStartMin, kppLunchEndMin } = getMetricSettings()
  const minutes = getMoscowMinutesFromIso(eventAt)
  return !(minutes >= kppLunchStartMin && minutes < kppLunchEndMin)
}

function getMoscowMinutesFromIso(iso: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: MSK_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso))
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

export function formatMoscowTime(iso: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: MSK_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

function formatEventTimeRanges(eventTimes: string[]) {
  if (eventTimes.length === 0) return ''

  const ranges: Array<{ start: string; end: string }> = []
  for (const iso of eventTimes) {
    const timestamp = new Date(iso).getTime()
    const last = ranges[ranges.length - 1]
    if (last && timestamp - new Date(last.end).getTime() <= 90_000) {
      last.end = iso
    } else {
      ranges.push({ start: iso, end: iso })
    }
  }

  return ranges
    .map((range) => {
      const start = formatMoscowTime(range.start)
      const end = formatMoscowTime(range.end)
      return start === end ? start : `${start}–${end}`
    })
    .join(', ')
}

export function buildKppTimeLabel(eventTimes: string[]) {
  const sorted = [...eventTimes]
    .filter((iso) => Boolean(iso))
    .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())

  const metric = sorted.filter(isKppMetricMinuteAt)
  if (metric.length > 0) return formatEventTimeRanges(metric)

  if (sorted.length > 0) {
    const lunch = formatEventTimeRanges(sorted)
    return lunch ? `${lunch} (обед)` : '—'
  }

  return '—'
}

export function buildNotWornTimeLabel(eventTimes: string[]) {
  const sorted = [...eventTimes]
    .filter((iso) => Boolean(iso))
    .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())

  return sorted.length > 0 ? formatEventTimeRanges(sorted) : '—'
}

export function buildNotWornEpisodeTimeLabel(
  episodes: Array<{ episode_start: string; episode_end: string }>,
) {
  if (episodes.length === 0) return '—'

  return episodes
    .sort((left, right) => new Date(left.episode_start).getTime() - new Date(right.episode_start).getTime())
    .map(({ episode_start, episode_end }) => {
      const start = formatMoscowTime(episode_start)
      const end = formatMoscowTime(episode_end)
      return start === end ? start : `${start}–${end}`
    })
    .join(', ')
}

const NO_SUPERVISOR = 'Без начальника'

export { NO_SUPERVISOR }

export function isAnalyticsSupervisor(supervisorName: string | null | undefined) {
  if (supervisorName == null || supervisorName.trim() === '') return false
  return !brigadeNamesMatch(supervisorName, NO_SUPERVISOR)
}

export function filterAnalyticsSupervisors<T extends { supervisor_name: string }>(rows: T[]) {
  return rows.filter((row) => isAnalyticsSupervisor(row.supervisor_name))
}

export function filterAnalyticsShiftRows<
  T extends { supervisor_name: string | null; work_sec_total: number; total_sec_total: number },
>(rows: T[]) {
  const minPct = getMetricSettings().analyticsMinActivityPct
  return rows.filter((row) => {
    if (!isAnalyticsSupervisor(row.supervisor_name)) return false
    if (row.total_sec_total <= 0) return false
    return ratio(row.work_sec_total, row.total_sec_total) >= minPct
  })
}

export function formatSeconds(totalSeconds: number) {
  const safe = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  return `${hours}ч ${String(minutes).padStart(2, '0')}м`
}

export function formatMinutes(totalSeconds: number) {
  const minutes = Math.round(Math.max(0, totalSeconds) / 60)
  return `${minutes} мин`
}

function getBrigadeShiftTarget(supervisorName: string) {
  const targets = getBrigadeShiftTargets()
  const match = Object.entries(targets).find(([name]) => brigadeNamesMatch(name, supervisorName))
  return match?.[1] ?? null
}

export function formatBrigadeShiftHeadcount(supervisorName: string, actual: number) {
  const target = getBrigadeShiftTarget(supervisorName)
  return target == null ? String(actual) : `${actual} / ${target}`
}

export function formatShiftHeadcount(actual: number) {
  return `${actual} / ${getMetricSettings().shiftTargetTotal}`
}

export function brigadeNamesMatch(left: string, right: string) {
  return (
    left.localeCompare(right, 'ru', { sensitivity: 'accent' }) === 0 || left.toUpperCase() === right.toUpperCase()
  )
}

export function filterComparisonBrigades<T extends { supervisor_name: string }>(
  rows: T[],
  brigades = getComparisonBrigades(),
): T[] {
  if (brigades.length === 0) return rows
  return rows.filter((row) => brigades.some((name) => brigadeNamesMatch(row.supervisor_name, name)))
}

export function filterComparisonBrigadeLabels<T extends { label: string }>(
  rows: T[],
  brigades = getComparisonBrigades(),
): T[] {
  if (brigades.length === 0) return rows
  return rows.filter((row) => brigades.some((name) => brigadeNamesMatch(row.label, name)))
}

export async function loadAvailableSupervisorNames() {
  const { data, error } = await supabase
    .schema('analytics')
    .from('brigade_daily_metrics')
    .select('supervisor_name')

  if (error) throw error

  const names = [...new Set((data ?? []).map((row) => String(row.supervisor_name ?? '').trim()))]
    .filter((name) => name.length > 0 && isAnalyticsSupervisor(name))
    .sort((left, right) => left.localeCompare(right, 'ru'))

  return names
}

export function addDaysIso(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** @deprecated use getMetricSettings().shiftTargetTotal */
export const SHIFT_TARGET_WORKERS = DEFAULT_METRIC_SETTINGS.shiftTargetTotal

export function formatPercent(value: number) {
  return `${Math.round(value)}%`
}

function episodeWord(count: number) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'эпизод'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'эпизода'
  return 'эпизодов'
}

export function formatEpisodeCount(count: number) {
  return `${count} ${episodeWord(count)}`
}

export function formatDecimalPercent(value: number) {
  return `${Number(value).toFixed(1)}%`
}

export function formatDeltaPercent(delta: number | null) {
  if (delta == null || Number.isNaN(delta)) return '—'
  const rounded = Math.round(delta * 10) / 10
  if (rounded === 0) return '0%'
  const sign = rounded > 0 ? '+' : ''
  return `${sign}${rounded}%`
}

export function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(new Date(value))
}

export function formatFullDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(value))
}

export function formatWeekRange(weekStart: string, weekEnd: string) {
  return `${formatShortDate(weekStart)} — ${formatShortDate(weekEnd)}`
}

/** ISO week start (Monday) for a given YYYY-MM-DD date, returned as YYYY-MM-DD. */
export function getWeekStart(dateIso: string) {
  const date = new Date(`${dateIso}T00:00:00Z`)
  const day = date.getUTCDay()
  const diff = (day === 0 ? -6 : 1) - day
  date.setUTCDate(date.getUTCDate() + diff)
  return date.toISOString().slice(0, 10)
}

export async function loadAvailableDates() {
  const { data, error } = await supabase.schema('analytics').rpc('list_report_dates')

  if (error) throw error

  return (data ?? []).map((value: string) => String(value).slice(0, 10))
}

export function buildAvailableWeeksFromDates(dates: string[]) {
  const seen = new Map<string, { week_start: string; week_end: string }>()
  for (const reportDate of dates) {
    const weekStart = getWeekStart(reportDate)
    if (!seen.has(weekStart)) {
      seen.set(weekStart, { week_start: weekStart, week_end: addDaysIso(weekStart, 6) })
    }
  }
  return [...seen.values()].sort((left, right) => right.week_start.localeCompare(left.week_start))
}

/** Список недель из дат отчётов — без полного скана view brigade_weekly_metrics. */
export async function loadAvailableWeeks() {
  const dates = await loadAvailableDates()
  return buildAvailableWeeksFromDates(dates)
}

export async function loadBrigadeDaily(reportDate: string) {
  const { data, error } = await supabase
    .schema('analytics')
    .rpc('brigade_daily_metrics_for_date', { p_report_date: reportDate })

  if (error) throw error
  return filterAnalyticsSupervisors((data ?? []) as BrigadeDailyRow[]).sort((left, right) =>
    left.supervisor_name.localeCompare(right.supervisor_name, 'ru'),
  )
}

export async function loadBrigadeDailyForRange(weekStart: string, weekEnd: string) {
  const { data, error } = await supabase
    .schema('analytics')
    .rpc('brigade_daily_metrics_for_dates', { p_date_from: weekStart, p_date_to: weekEnd })

  if (error) throw error
  return (data ?? []) as BrigadeDailyRow[]
}

function roundPct(part: number, total: number) {
  return total > 0 ? Math.round((1000 * part) / total) / 10 : 0
}

export function aggregateBrigadeDailyToWeekly(
  weekStart: string,
  weekEnd: string,
  dailyRows: BrigadeDailyRow[],
): BrigadeWeeklyRow[] {
  const byBrigade = new Map<string, BrigadeDailyRow[]>()

  for (const row of dailyRows) {
    const rows = byBrigade.get(row.supervisor_name) ?? []
    rows.push(row)
    byBrigade.set(row.supervisor_name, rows)
  }

  return [...byBrigade.entries()]
    .map(([supervisor_name, rows]) => {
      const days = new Set(rows.map((row) => row.report_date)).size
      const workers = rows.reduce((sum, row) => sum + row.workers, 0)
      const work_sec = rows.reduce((sum, row) => sum + row.work_sec, 0)
      const weak_activity_sec = rows.reduce((sum, row) => sum + row.weak_activity_sec, 0)
      const long_idle_sec = rows.reduce((sum, row) => sum + row.long_idle_sec, 0)
      const go_sec = rows.reduce((sum, row) => sum + row.go_sec, 0)
      const total_sec = rows.reduce((sum, row) => sum + row.total_sec, 0)
      const pv_sec = rows.reduce((sum, row) => sum + row.pv_sec, 0)
      const kpp_sec = rows.reduce((sum, row) => sum + row.kpp_sec, 0)
      const kpp_shifts = rows.reduce((sum, row) => sum + row.kpp_workers, 0)
      const durationRows = rows.filter((row) => row.avg_shift_duration_sec > 0)
      const durationWorkers = durationRows.reduce((sum, row) => sum + row.workers, 0)
      const avg_shift_duration_sec =
        durationWorkers > 0
          ? Math.round(
              durationRows.reduce(
                (sum, row) => sum + row.avg_shift_duration_sec * row.workers,
                0,
              ) / durationWorkers,
            )
          : 0

      return {
        week_start: weekStart,
        week_end: weekEnd,
        supervisor_name,
        days,
        unique_employees: 0,
        avg_workers: days > 0 ? Math.round((workers / days) * 10) / 10 : 0,
        work_sec,
        weak_activity_sec,
        long_idle_sec,
        go_sec,
        total_sec,
        pv_sec,
        kpp_sec,
        kpp_shifts,
        activity_pct: roundPct(work_sec, total_sec),
        weak_activity_pct: roundPct(weak_activity_sec, total_sec),
        long_idle_pct: roundPct(long_idle_sec, total_sec),
        go_pct: roundPct(go_sec, total_sec),
        avg_shift_duration_sec,
      } satisfies BrigadeWeeklyRow
    })
    .sort((left, right) => left.supervisor_name.localeCompare(right.supervisor_name, 'ru'))
}

export function enrichBrigadeWeeklyWithShiftStats(
  weeklyRows: BrigadeWeeklyRow[],
  shifts: ShiftMetricRow[],
): BrigadeWeeklyRow[] {
  const kppByBrigade = new Map<string, number>()

  for (const row of shifts) {
    const supervisorName = row.supervisor_name ?? NO_SUPERVISOR
    if (row.kpp_sec_total > 0) {
      kppByBrigade.set(supervisorName, (kppByBrigade.get(supervisorName) ?? 0) + 1)
    }
  }

  return weeklyRows.map((row) => ({
    ...row,
    kpp_shifts: kppByBrigade.get(row.supervisor_name) ?? row.kpp_shifts,
  }))
}

/** Агрегирует дневные метрики бригад за неделю — без тяжёлого view brigade_weekly_metrics. */
export async function loadBrigadeWeekly(weekStart: string, weekEnd?: string) {
  const end = weekEnd ?? addDaysIso(weekStart, 6)
  const dailyRows = await loadBrigadeDailyForRange(weekStart, end)
  return aggregateBrigadeDailyToWeekly(weekStart, end, dailyRows)
}

export type BrigadeDynamicsPoint = {
  report_date: string
  activity_pct: number | null
}

export const ACTIVITY_DYNAMICS_CHART_MAX = 60

function getActivitySparklineDays() {
  return getMetricSettings().activitySparklineDays
}

export function listDatesInclusive(startIso: string, endIso: string) {
  const dates: string[] = []
  let current = startIso
  while (current <= endIso) {
    dates.push(current)
    current = addDaysIso(current, 1)
  }
  return dates
}

function buildBrigadeSparkline(
  brigadeDaily: Array<{ report_date: string; activity_pct: number }>,
  referenceDate: string,
) {
  const sparklineStart = addDaysIso(referenceDate, -(getActivitySparklineDays() - 1))
  const byDate = new Map(brigadeDaily.map((row) => [row.report_date, row.activity_pct]))
  return listDatesInclusive(sparklineStart, referenceDate).map((report_date) => ({
    report_date,
    activity_pct: byDate.get(report_date) ?? null,
  }))
}

export type BrigadeDynamicsCard = {
  supervisor_name: string
  today_pct: number | null
  yesterday_pct: number | null
  day_delta: number | null
  sparkline: BrigadeDynamicsPoint[]
}

export async function loadBrigadeActivityDynamics(referenceDate: string) {
  const sparklineStart = addDaysIso(referenceDate, -(getActivitySparklineDays() - 1))
  const yesterday = addDaysIso(referenceDate, -1)

  const { data: dailyData, error: dailyError } = await supabase
    .schema('analytics')
    .rpc('brigade_daily_metrics_for_dates', {
      p_date_from: sparklineStart,
      p_date_to: referenceDate,
    })

  if (dailyError) throw dailyError

  const dailyRows = (dailyData ?? []) as Array<{
    report_date: string
    supervisor_name: string
    activity_pct: number
  }>

  return getComparisonBrigades().map((brigadeName) => {
    const brigadeDaily = dailyRows.filter((row) => brigadeNamesMatch(row.supervisor_name, brigadeName))
    const todayRow = brigadeDaily.find((row) => row.report_date === referenceDate) ?? null
    const yesterdayRow = brigadeDaily.find((row) => row.report_date === yesterday) ?? null

    const todayPct = todayRow?.activity_pct ?? null
    const yesterdayPct = yesterdayRow?.activity_pct ?? null

    return {
      supervisor_name: brigadeName,
      today_pct: todayPct,
      yesterday_pct: yesterdayPct,
      day_delta: todayPct != null && yesterdayPct != null ? todayPct - yesterdayPct : null,
      sparkline: buildBrigadeSparkline(brigadeDaily, referenceDate),
    } satisfies BrigadeDynamicsCard
  })
}

export const VOLUME_DYNAMICS_CHART_MAX = 200

function getVolumeSparklineDays() {
  return getMetricSettings().volumeSparklineDays
}

export type BrigadeVolumeDynamicsPoint = {
  report_date: string
  volume_m3: number | null
}

export type BrigadeVolumeDynamicsCard = {
  supervisor_name: string
  today_m3: number | null
  yesterday_m3: number | null
  day_delta: number | null
  sparkline: BrigadeVolumeDynamicsPoint[]
}

type VolumeEntryRow = {
  report_date: string
  label: string
  value_text: string
}

function sumBrigadeVolumeM3(rows: VolumeEntryRow[], brigadeName: string, reportDate: string) {
  const total = rows
    .filter((row) => row.report_date === reportDate && brigadeNamesMatch(row.label, brigadeName))
    .reduce((sum, row) => sum + parseVolumeM3(row.value_text), 0)
  return total > 0 ? total : null
}

function sumBrigadeVolumeForDates(rows: VolumeEntryRow[], brigadeName: string, dates: string[]) {
  const total = dates.reduce((sum, date) => sum + (sumBrigadeVolumeM3(rows, brigadeName, date) ?? 0), 0)
  return total > 0 ? total : null
}

export async function loadBrigadeWeeklyVolumeTotals(weekStart: string, weekEnd: string) {
  const { data, error } = await supabase
    .schema('analytics')
    .from('volume_entries')
    .select('report_date, label, value_text')
    .gte('report_date', weekStart)
    .lte('report_date', weekEnd)
    .order('report_date', { ascending: true })

  if (error) throw error

  const rows = (data ?? []).map((row) => ({
    report_date: String(row.report_date).slice(0, 10),
    label: row.label,
    value_text: row.value_text,
  }))
  const weekDates = listDatesInclusive(weekStart, weekEnd)

  return getComparisonBrigades().map((brigadeName) => ({
    supervisor_name: brigadeName,
    week_m3: sumBrigadeVolumeForDates(rows, brigadeName, weekDates),
  }))
}

function buildBrigadeVolumeSparkline(
  brigadeRows: VolumeEntryRow[],
  brigadeName: string,
  referenceDate: string,
) {
  const sparklineStart = addDaysIso(referenceDate, -(getVolumeSparklineDays() - 1))
  return listDatesInclusive(sparklineStart, referenceDate).map((report_date) => ({
    report_date,
    volume_m3: sumBrigadeVolumeM3(brigadeRows, brigadeName, report_date),
  }))
}

export async function loadBrigadeVolumeDynamics(referenceDate: string) {
  const sparklineStart = addDaysIso(referenceDate, -(getVolumeSparklineDays() - 1))
  const yesterday = addDaysIso(referenceDate, -1)

  const { data, error } = await supabase
    .schema('analytics')
    .from('volume_entries')
    .select('report_date, label, value_text')
    .gte('report_date', sparklineStart)
    .lte('report_date', referenceDate)
    .order('report_date', { ascending: true })

  if (error) throw error

  const rows = (data ?? []).map((row) => ({
    report_date: String(row.report_date).slice(0, 10),
    label: row.label,
    value_text: row.value_text,
  }))

  return getComparisonBrigades().map((brigadeName) => {
    const brigadeRows = rows.filter((row) => brigadeNamesMatch(row.label, brigadeName))
    const todayM3 = sumBrigadeVolumeM3(brigadeRows, brigadeName, referenceDate)
    const yesterdayM3 = sumBrigadeVolumeM3(brigadeRows, brigadeName, yesterday)

    return {
      supervisor_name: brigadeName,
      today_m3: todayM3,
      yesterday_m3: yesterdayM3,
      day_delta: todayM3 != null && yesterdayM3 != null ? todayM3 - yesterdayM3 : null,
      sparkline: buildBrigadeVolumeSparkline(brigadeRows, brigadeName, referenceDate),
    } satisfies BrigadeVolumeDynamicsCard
  })
}

export type AttentionEmployee = {
  ww_shift_id?: number
  employee_number: string
  full_name: string
  supervisor_name: string
  profession: string | null
  activity_pct: number
}

export type NoTelemetryEmployee = {
  ww_shift_id: number
  employee_number: string
  full_name: string
  supervisor_name: string
  profession: string | null
}

export function isNoTelemetryShift(
  row: Pick<ShiftMetricRow, 'total_sec_total' | 'telemetry_rows'>,
) {
  return Number(row.total_sec_total) <= 0 || Number(row.telemetry_rows ?? 0) <= 0
}

/** Смена с телеметрией и низкой активностью — часы носил, но работал слабо; не путать с «не носил часы». */
export function isLowActivityWithWatch(
  row: Pick<ShiftMetricRow, 'total_sec_total' | 'telemetry_rows' | 'work_sec_total'>,
  lowActivityPct = getMetricSettings().lowActivityPct,
) {
  if (isNoTelemetryShift(row)) return false
  return getShiftProductivity(row) < lowActivityPct
}

/**
 * Пересечение с блоком «Активность ниже low_activity_pct»: смена в аналитике (≥ analytics_min)
 * и при этом низкая активность. Таких не дублируем в «Бездействие в зоне».
 * Ниже analytics_min (11%) в «низкой активности» не показываем — эпизод not_worn остаётся здесь.
 */
export function isLowActivityAttentionOverlap(
  row: Pick<ShiftMetricRow, 'total_sec_total' | 'telemetry_rows' | 'work_sec_total'>,
  lowActivityPct = getMetricSettings().lowActivityPct,
) {
  if (!isAnalyticsEligibleShift(row)) return false
  return isLowActivityWithWatch(row, lowActivityPct)
}

export function filterNoTelemetryDaily(rows: ShiftMetricRow[]) {
  return rows
    .filter((row) => isNoTelemetryShift(row) && isAnalyticsSupervisor(row.supervisor_name))
    .map(
      (row) =>
        ({
          ww_shift_id: row.ww_shift_id,
          employee_number: row.employee_number,
          full_name: row.full_name,
          supervisor_name: row.supervisor_name ?? NO_SUPERVISOR,
          profession: row.profession ?? null,
        }) satisfies NoTelemetryEmployee,
    )
    .sort((left, right) => left.full_name.localeCompare(right.full_name, 'ru'))
}

export function getShiftProductivity(row: Pick<ShiftMetricRow, 'work_sec_total' | 'total_sec_total'>) {
  return ratio(row.work_sec_total, row.total_sec_total)
}

export function isAnalyticsEligibleShift(row: Pick<ShiftMetricRow, 'work_sec_total' | 'total_sec_total'>) {
  if (row.total_sec_total <= 0) return false
  return getShiftProductivity(row) >= getMetricSettings().analyticsMinActivityPct
}

/** @deprecated use getMetricSettings().lowActivityPct */
export const LOW_ACTIVITY_THRESHOLD = DEFAULT_METRIC_SETTINGS.lowActivityPct

/** @deprecated use getMetricSettings().longIdleMin */
export const LONG_IDLE_THRESHOLD_MIN = DEFAULT_METRIC_SETTINGS.longIdleMin

/** @deprecated use getMetricSettings().activitySparklineDays */
export const ACTIVITY_DYNAMICS_SPARKLINE_DAYS = DEFAULT_METRIC_SETTINGS.activitySparklineDays

/** @deprecated use getMetricSettings().volumeSparklineDays */
export const VOLUME_DYNAMICS_SPARKLINE_DAYS = DEFAULT_METRIC_SETTINGS.volumeSparklineDays

export function filterLowActivityDaily(rows: ShiftMetricRow[]) {
  const threshold = getMetricSettings().lowActivityPct
  return rows
    .filter((row) => isLowActivityWithWatch(row, threshold))
    .map(
      (row) =>
        ({
          ww_shift_id: row.ww_shift_id,
          employee_number: String(row.employee_number),
          full_name: row.full_name,
          supervisor_name: row.supervisor_name ?? NO_SUPERVISOR,
          profession: row.profession ?? null,
          activity_pct: getShiftProductivity(row),
        }) satisfies AttentionEmployee,
    )
    .sort((left, right) => left.activity_pct - right.activity_pct)
}


export async function loadShiftRowsForRange(weekStart: string, weekEnd: string) {
  const { data, error } = await supabase
    .schema('analytics')
    .rpc('shift_daily_metrics_for_dates', { p_date_from: weekStart, p_date_to: weekEnd })

  if (error) throw error
  return filterAnalyticsShiftRows((data ?? []) as ShiftMetricRow[])
}

function aggregateShiftActivity(rows: ShiftMetricRow[]) {
  const totals = new Map<
    string,
    { work_sec: number; total_sec: number; full_name: string; supervisor_name: string; profession: string | null }
  >()

  for (const row of rows) {
    const current = totals.get(row.employee_number) ?? {
      work_sec: 0,
      total_sec: 0,
      full_name: row.full_name,
      supervisor_name: row.supervisor_name ?? NO_SUPERVISOR,
      profession: row.profession ?? null,
    }
    current.work_sec += row.work_sec_total
    current.total_sec += row.total_sec_total
    if (!current.profession && row.profession) {
      current.profession = row.profession
    }
    totals.set(row.employee_number, current)
  }

  return [...totals.entries()].map(([employee_number, row]) => ({
    employee_number,
    full_name: row.full_name,
    supervisor_name: row.supervisor_name,
    profession: row.profession,
    activity_pct: ratio(row.work_sec, row.total_sec),
    total_sec: row.total_sec,
  }))
}

export function topActivityDaily(rows: ShiftMetricRow[], limit = 3) {
  return rows
    .filter((row) => row.total_sec_total > 0)
    .map(
      (row) =>
        ({
          ww_shift_id: row.ww_shift_id,
          employee_number: String(row.employee_number),
          full_name: row.full_name,
          supervisor_name: row.supervisor_name ?? NO_SUPERVISOR,
          profession: row.profession ?? null,
          activity_pct: getShiftProductivity(row),
        }) satisfies AttentionEmployee,
    )
    .sort((left, right) => right.activity_pct - left.activity_pct)
    .slice(0, limit)
}

export function topActivityWeekly(rows: ShiftMetricRow[], limit = 3) {
  return aggregateShiftActivity(rows)
    .filter((row) => row.total_sec > 0)
    .sort((left, right) => right.activity_pct - left.activity_pct)
    .slice(0, limit)
    .map(({ total_sec: _total, ...row }) => row)
}

export function aggregateLowActivityWeekly(rows: ShiftMetricRow[]) {
  const threshold = getMetricSettings().lowActivityPct
  return aggregateShiftActivity(rows)
    .filter((row) => row.total_sec > 0 && row.activity_pct < threshold)
    .map(({ total_sec: _total, ...row }) => row)
    .sort((left, right) => left.activity_pct - right.activity_pct)
}

export async function loadAllShiftRowsForDate(reportDate: string) {
  const { data, error } = await supabase
    .schema('analytics')
    .rpc('shift_daily_metrics_for_date', { p_report_date: reportDate })

  if (error) throw error
  return (data ?? []) as ShiftMetricRow[]
}

export async function loadShiftRows(reportDate: string) {
  return filterAnalyticsShiftRows(await loadAllShiftRowsForDate(reportDate))
}

export async function loadKppEmployees(reportDate: string) {
  const { data, error } = await supabase
    .schema('analytics')
    .rpc('shift_daily_metrics_for_date', { p_report_date: reportDate })

  if (error) throw error

  const employees = filterAnalyticsShiftRows((data ?? []) as ShiftMetricRow[])
    .filter((row) => row.kpp_sec_total > 0)
    .map((row) => ({
      ww_shift_id: Number(row.ww_shift_id),
      employee_number: String(row.employee_number),
      full_name: String(row.full_name),
      supervisor_name: (row.supervisor_name as string | null) ?? NO_SUPERVISOR,
      kpp_sec: Number(row.kpp_sec_total),
      work_sec_total: Number(row.work_sec_total),
      total_sec_total: Number(row.total_sec_total),
    }))
    .sort((left, right) => right.kpp_sec - left.kpp_sec)

  if (employees.length === 0) return [] satisfies KppEmployee[]

  const shiftIds = employees.map((employee) => employee.ww_shift_id)
  const { data: minuteData, error: minuteError } = await supabase
    .schema('analytics')
    .from('kpp_minutes_daily')
    .select('ww_shift_id, event_at')
    .eq('report_date', reportDate)
    .in('ww_shift_id', shiftIds)
    .limit(10_000)

  if (minuteError) throw minuteError

  const minutesByShift = new Map<number, string[]>()
  for (const row of minuteData ?? []) {
    if (!row.event_at) continue
    const shiftId = Number(row.ww_shift_id)
    const events = minutesByShift.get(shiftId) ?? []
    events.push(String(row.event_at))
    minutesByShift.set(shiftId, events)
  }

  return employees.map((employee) => ({
    ...employee,
    kpp_time: buildKppTimeLabel(minutesByShift.get(employee.ww_shift_id) ?? []),
  })) satisfies KppEmployee[]
}

export function getNotWornPct(row: Pick<ShiftMetricRow, 'not_worn_sec_total' | 'not_worn_eligible_sec_total'>) {
  return ratio(row.not_worn_sec_total, row.not_worn_eligible_sec_total)
}

export async function loadAvailableProfessions() {
  const { data, error } = await supabase
    .schema('analytics')
    .from('shift_daily_metrics')
    .select('profession')
    .not('profession', 'is', null)

  if (error) throw error

  const names = [...new Set((data ?? []).map((row) => String(row.profession ?? '').trim()))]
    .filter((name) => name.length > 0)
    .sort((left, right) => left.localeCompare(right, 'ru'))

  return names
}

export async function loadNotWornEmployees(reportDate: string, cachedShifts?: ShiftMetricRow[]) {
  const settings = getMetricSettings()

  const shiftPromise = cachedShifts
    ? Promise.resolve(cachedShifts)
    : loadAllShiftRowsForDate(reportDate)

  const [{ data: episodeData, error: episodeError }, shiftData] = await Promise.all([
    supabase.schema('analytics').rpc('not_worn_episode_ranges_for_date', {
      p_report_date: reportDate,
      p_shift_ids: null,
    }),
    shiftPromise,
  ])

  if (episodeError) throw episodeError

  type NotWornEpisodeRow = {
    ww_shift_id: number | string
    episode_start: string
    episode_end: string
    episode_sec: number | string
  }

  const episodesByShift = new Map<number, Array<{ episode_start: string; episode_end: string }>>()
  const totalSecByShift = new Map<number, number>()

  for (const row of (episodeData ?? []) as NotWornEpisodeRow[]) {
    if (!row.episode_start || !row.episode_end) continue
    const shiftId = Number(row.ww_shift_id)
    const episodeSec = Number(row.episode_sec ?? 0)
    totalSecByShift.set(shiftId, (totalSecByShift.get(shiftId) ?? 0) + episodeSec)
    const episodes = episodesByShift.get(shiftId) ?? []
    episodes.push({
      episode_start: String(row.episode_start),
      episode_end: String(row.episode_end),
    })
    episodesByShift.set(shiftId, episodes)
  }

  type NotWornCandidate = NotWornEmployee

  const employees = (shiftData as ShiftMetricRow[])
    .filter((row) => isAnalyticsSupervisor(row.supervisor_name))
    .flatMap((row) => {
      const shiftMinSec = Number(row.not_worn_shift_min_sec ?? settings.notWornMinSec)
      const not_worn_sec = totalSecByShift.get(row.ww_shift_id) ?? 0
      const hasNotWornEpisode = not_worn_sec >= shiftMinSec
      if (!hasNotWornEpisode) return [] satisfies NotWornCandidate[]
      if (isLowActivityAttentionOverlap(row, settings.lowActivityPct)) return [] satisfies NotWornCandidate[]

      const episodes = episodesByShift.get(row.ww_shift_id) ?? []
      const episodeLabel = buildNotWornEpisodeTimeLabel(episodes)

      return [
        {
          ww_shift_id: row.ww_shift_id,
          employee_number: String(row.employee_number),
          full_name: String(row.full_name),
          profession: row.profession ?? null,
          supervisor_name: (row.supervisor_name as string | null) ?? NO_SUPERVISOR,
          not_worn_sec,
          not_worn_pct: getNotWornPct({
            not_worn_sec_total: not_worn_sec,
            not_worn_eligible_sec_total: Number(row.not_worn_eligible_sec_total ?? 0),
          }),
          not_worn_time: episodeLabel !== '—' ? episodeLabel : '—',
          activity_pct: ratio(row.work_sec_total, row.total_sec_total),
          weak_activity_pct: ratio(row.weak_activity_sec_total, row.total_sec_total),
          // Длительный простой (отчёт 10) может превышать общий простой телеметрии, если эпизоды
          // тянутся после обрыва телеметрии — ограничиваем idle_sec_total, чтобы доля была ≤100%.
          long_idle_pct: ratio(
            Math.min(row.long_idle_sec_total, row.idle_sec_total),
            row.total_sec_total,
          ),
          go_pct: ratio(row.go_sec_total, row.total_sec_total),
        } satisfies NotWornCandidate,
      ]
    })

  return employees.sort(
    (left, right) => right.not_worn_sec - left.not_worn_sec || left.full_name.localeCompare(right.full_name, 'ru'),
  )
}

export function formatIdleEpisodeTimeLabel(dtStart: string | null, dtEnd: string | null) {
  if (!dtStart || !dtEnd) return '—'
  const start = formatMoscowTime(dtStart)
  const end = formatMoscowTime(dtEnd)
  return start === end ? start : `${start}–${end}`
}

/** Длительные простои по отчёту 10 для смены (без фильтра analytics_min). */
export async function loadLongIdleEpisodesForShift(reportDate: string, wwShiftId: number) {
  const threshold = getMetricSettings().longIdleMin

  const { data, error } = await supabase
    .schema('analytics')
    .from('idle_episodes_daily')
    .select('ww_shift_id, session_id, employee_number, full_name, dt_start, dt_end, duration_min, ble_tag_zone')
    .eq('report_date', reportDate)
    .eq('ww_shift_id', wwShiftId)
    .gte('duration_min', threshold)
    .order('dt_start')

  if (error) throw error

  return (data ?? []).map((row) => ({
    ww_shift_id: Number(row.ww_shift_id),
    session_id: row.session_id === null ? null : Number(row.session_id),
    employee_number: row.employee_number ?? null,
    full_name: row.full_name ?? null,
    supervisor_name: NO_SUPERVISOR,
    dt_start: row.dt_start ?? null,
    dt_end: row.dt_end ?? null,
    duration_min: Number(row.duration_min),
    ble_tag_zone: row.ble_tag_zone === null ? null : Number(row.ble_tag_zone),
    zonaName: zoneName(row.ble_tag_zone),
  })) satisfies IdleEpisode[]
}

export function sumDaily(rows: BrigadeDailyRow[]) {
  return rows.reduce(
    (acc, row) => {
      acc.workers += row.workers
      acc.work_sec += row.work_sec
      acc.weak_activity_sec += row.weak_activity_sec
      acc.long_idle_sec += row.long_idle_sec
      acc.go_sec += row.go_sec
      acc.total_sec += row.total_sec
      acc.pv_sec += row.pv_sec
      acc.kpp_sec += row.kpp_sec
      acc.kpp_workers += row.kpp_workers
      acc.not_worn_sec += row.not_worn_sec
      acc.not_worn_eligible_sec += row.not_worn_eligible_sec
      acc.not_worn_workers += row.not_worn_workers
      return acc
    },
    {
      workers: 0,
      work_sec: 0,
      weak_activity_sec: 0,
      long_idle_sec: 0,
      go_sec: 0,
      total_sec: 0,
      pv_sec: 0,
      kpp_sec: 0,
      kpp_workers: 0,
      not_worn_sec: 0,
      not_worn_eligible_sec: 0,
      not_worn_workers: 0,
    },
  )
}

export function ratio(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : 0
}

/** Зона проведения работ (ПВ) — zona=1, см. docs/zones-reference.md */
export const PV_ZONE = 1

/** Доля ПВ от суммы времени по видимым зонам. */
export function pvPercentFromZoneRows(zoneRows: ZoneDailyRow[]) {
  const visibleRows = filterDistributionZoneRows(zoneRows, getMetricSettings().zoneVisibility)
  const totalSec = visibleRows.reduce((sum, row) => sum + row.sec, 0)
  const pvSec = visibleRows.find((row) => row.zona === PV_ZONE)?.sec ?? 0
  return ratio(pvSec, totalSec)
}

type ZoneDailyMetricRow = {
  zona: number | string
  sec: number | string
  shifts: number | string
  supervisor_name: string | null
}

async function fetchZoneDailyRows(reportDate: string, supervisor?: string) {
  const { data, error } = await supabase
    .schema('analytics')
    .rpc('zone_daily_metrics_for_date', { p_report_date: reportDate })

  if (error) throw error

  const rows = (data ?? []) as ZoneDailyMetricRow[]
  if (!supervisor || supervisor === 'all') return rows
  return rows.filter((row) => (row.supervisor_name ?? NO_SUPERVISOR) === supervisor)
}

function aggregateZoneDailyFromRows(rows: ZoneDailyMetricRow[], supervisor?: string) {
  const totals = new Map<number, { sec: number; shifts: number }>()
  for (const row of rows) {
    const supervisorName = (row.supervisor_name as string | null) ?? NO_SUPERVISOR
    if (!supervisor || supervisor === 'all') {
      if (!isAnalyticsSupervisor(supervisorName)) continue
    }
    const zona = Number(row.zona)
    if (!Number.isFinite(zona) || !isZoneVisibleInDistribution(zona, getMetricSettings().zoneVisibility)) continue
    const current = totals.get(zona) ?? { sec: 0, shifts: 0 }
    current.sec += Number(row.sec)
    current.shifts = Math.max(current.shifts, Number(row.shifts))
    totals.set(zona, current)
  }

  return [...totals.entries()]
    .map(([zona, value]) => ({ zona, zonaName: zoneName(zona), sec: value.sec, shifts: value.shifts }))
    .sort((left, right) => right.sec - left.sec) satisfies ZoneDailyRow[]
}

function aggregateZoneDailyByBrigadeFromRows(rows: ZoneDailyMetricRow[]) {
  const supervisors = new Map<string, Map<number, { sec: number; shifts: number }>>()
  for (const row of rows) {
    const supervisorName = (row.supervisor_name as string | null) ?? NO_SUPERVISOR
    if (!isAnalyticsSupervisor(supervisorName)) continue
    const zona = Number(row.zona)
    if (!Number.isFinite(zona) || !isZoneVisibleInDistribution(zona, getMetricSettings().zoneVisibility)) continue
    const supervisorTotals = supervisors.get(supervisorName) ?? new Map<number, { sec: number; shifts: number }>()
    const current = supervisorTotals.get(zona) ?? { sec: 0, shifts: 0 }
    current.sec += Number(row.sec)
    current.shifts = Math.max(current.shifts, Number(row.shifts))
    supervisorTotals.set(zona, current)
    supervisors.set(supervisorName, supervisorTotals)
  }

  return [...supervisors.entries()]
    .map(([supervisor_name, totals]) => ({
      supervisor_name,
      rows: [...totals.entries()]
        .map(([zona, value]) => ({ zona, zonaName: zoneName(zona), sec: value.sec, shifts: value.shifts }))
        .sort((left, right) => right.sec - left.sec),
    }))
    .sort((left, right) => left.supervisor_name.localeCompare(right.supervisor_name, 'ru')) satisfies BrigadeZoneDaily[]
}

export async function loadZoneDaily(reportDate: string, supervisor?: string) {
  const rows = await fetchZoneDailyRows(reportDate, supervisor)
  return aggregateZoneDailyFromRows(rows, supervisor)
}

export async function loadZoneDailyBundle(reportDate: string) {
  const rows = await fetchZoneDailyRows(reportDate)
  return {
    daily: aggregateZoneDailyFromRows(rows),
    byBrigade: aggregateZoneDailyByBrigadeFromRows(rows),
  }
}

export async function loadZoneDailyByBrigade(reportDate: string) {
  const rows = await fetchZoneDailyRows(reportDate)
  return aggregateZoneDailyByBrigadeFromRows(rows)
}

export async function loadIdleEpisodes(reportDate: string) {
  type IdleEpisodeRpcRow = {
    ble_tag_zone: number | null
    ww_shift_id: number | string
    session_id: number | string | null
    employee_number: string | null
    full_name: string | null
    supervisor_name: string | null
    dt_start: string | null
    dt_end: string | null
    duration_min: number | string
  }

  const { data, error } = await supabase
    .schema('analytics')
    .rpc('idle_episodes_daily_for_date', { p_report_date: reportDate })

  if (error) throw error

  const rows = (data ?? []) as IdleEpisodeRpcRow[]

  return rows
    .filter((row) => isZoneVisibleInDistribution(row.ble_tag_zone, getMetricSettings().zoneVisibility))
    .map((row) => ({
      ww_shift_id: Number(row.ww_shift_id),
      session_id: row.session_id === null ? null : Number(row.session_id),
      employee_number: row.employee_number ?? null,
      full_name: row.full_name ?? null,
      supervisor_name: row.supervisor_name ?? NO_SUPERVISOR,
      dt_start: row.dt_start ?? null,
      dt_end: row.dt_end ?? null,
      duration_min: Number(row.duration_min),
      ble_tag_zone: row.ble_tag_zone === null ? null : Number(row.ble_tag_zone),
      zonaName: zoneName(row.ble_tag_zone),
    }))
    .sort((left, right) => right.duration_min - left.duration_min)
    .filter((row) => isAnalyticsSupervisor(row.supervisor_name)) satisfies IdleEpisode[]
}
