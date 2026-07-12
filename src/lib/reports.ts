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
  idle_sec_total: number
  weak_activity_sec_total: number
  long_idle_sec_total: number
  go_sec_total: number
  work_sec_total: number
  total_sec_total: number
  pv_sec_total: number
  outside_pv_sec_total: number
  kpp_sec_total: number
}

export type KppEmployee = {
  ww_shift_id: number
  employee_number: string
  full_name: string
  supervisor_name: string
  kpp_sec: number
  kpp_time: string
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

function formatKppRanges(eventTimes: string[]) {
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
  if (metric.length > 0) return formatKppRanges(metric)

  if (sorted.length > 0) {
    const lunch = formatKppRanges(sorted)
    return lunch ? `${lunch} (обед)` : '—'
  }

  return '—'
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

export function filterAnalyticsShiftRows<T extends { supervisor_name: string | null }>(rows: T[]) {
  return rows.filter((row) => isAnalyticsSupervisor(row.supervisor_name))
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
  const { data, error } = await supabase
    .schema('analytics')
    .from('brigade_daily_metrics')
    .select('report_date')
    .order('report_date', { ascending: false })

  if (error) throw error
  return [...new Set((data ?? []).map((row) => row.report_date as string))]
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
    .from('brigade_daily_metrics')
    .select('*')
    .eq('report_date', reportDate)
    .order('supervisor_name', { ascending: true })

  if (error) throw error
  return filterAnalyticsSupervisors((data ?? []) as BrigadeDailyRow[])
}

export async function loadBrigadeDailyForRange(weekStart: string, weekEnd: string) {
  const dates = listDatesInclusive(weekStart, weekEnd)
  const rows: BrigadeDailyRow[] = []

  for (const reportDate of dates) {
    rows.push(...(await loadBrigadeDaily(reportDate)))
  }

  return rows
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
  const uniqueByBrigade = new Map<string, Set<string>>()
  const shiftCountByBrigade = new Map<string, number>()
  const kppByBrigade = new Map<string, number>()

  for (const row of shifts) {
    const supervisorName = row.supervisor_name ?? NO_SUPERVISOR
    const unique = uniqueByBrigade.get(supervisorName) ?? new Set<string>()
    unique.add(row.employee_number)
    uniqueByBrigade.set(supervisorName, unique)
    shiftCountByBrigade.set(supervisorName, (shiftCountByBrigade.get(supervisorName) ?? 0) + 1)
    if (row.kpp_sec_total > 0) {
      kppByBrigade.set(supervisorName, (kppByBrigade.get(supervisorName) ?? 0) + 1)
    }
  }

  return weeklyRows.map((row) => {
    const days = row.days
    const shiftCount = shiftCountByBrigade.get(row.supervisor_name) ?? 0
    return {
      ...row,
      unique_employees: uniqueByBrigade.get(row.supervisor_name)?.size ?? row.unique_employees,
      avg_workers: days > 0 ? Math.round((shiftCount / days) * 10) / 10 : row.avg_workers,
      kpp_shifts: kppByBrigade.get(row.supervisor_name) ?? row.kpp_shifts,
    }
  })
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
    .from('brigade_daily_metrics')
    .select('report_date, supervisor_name, activity_pct')
    .gte('report_date', sparklineStart)
    .lte('report_date', referenceDate)
    .order('report_date', { ascending: true })

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
  employee_number: string
  full_name: string
  supervisor_name: string
  activity_pct: number
}

export function getShiftProductivity(row: Pick<ShiftMetricRow, 'work_sec_total' | 'total_sec_total'>) {
  return ratio(row.work_sec_total, row.total_sec_total)
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
    .filter((row) => row.total_sec_total > 0 && getShiftProductivity(row) < threshold)
    .map(
      (row) =>
        ({
          employee_number: row.employee_number,
          full_name: row.full_name,
          supervisor_name: row.supervisor_name ?? NO_SUPERVISOR,
          activity_pct: getShiftProductivity(row),
        }) satisfies AttentionEmployee,
    )
    .sort((left, right) => left.activity_pct - right.activity_pct)
}

const WEEKLY_SHIFT_ROW_COLUMNS =
  'employee_number, full_name, supervisor_name, work_sec_total, total_sec_total, kpp_sec_total'

async function loadShiftRowsForDay(reportDate: string) {
  const { data, error } = await supabase
    .schema('analytics')
    .from('shift_daily_metrics')
    .select(WEEKLY_SHIFT_ROW_COLUMNS)
    .eq('report_date', reportDate)

  if (error) throw error
  return (data ?? []) as ShiftMetricRow[]
}

export async function loadShiftRowsForRange(weekStart: string, weekEnd: string) {
  const dates = listDatesInclusive(weekStart, weekEnd)
  const rows: ShiftMetricRow[] = []

  for (const reportDate of dates) {
    const dayRows = await loadShiftRowsForDay(reportDate)
    rows.push(...dayRows)
  }

  return filterAnalyticsShiftRows(rows)
}

function aggregateShiftActivity(rows: ShiftMetricRow[]) {
  const totals = new Map<
    string,
    { work_sec: number; total_sec: number; full_name: string; supervisor_name: string }
  >()

  for (const row of rows) {
    const current = totals.get(row.employee_number) ?? {
      work_sec: 0,
      total_sec: 0,
      full_name: row.full_name,
      supervisor_name: row.supervisor_name ?? NO_SUPERVISOR,
    }
    current.work_sec += row.work_sec_total
    current.total_sec += row.total_sec_total
    totals.set(row.employee_number, current)
  }

  return [...totals.entries()].map(([employee_number, row]) => ({
    employee_number,
    full_name: row.full_name,
    supervisor_name: row.supervisor_name,
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
          employee_number: row.employee_number,
          full_name: row.full_name,
          supervisor_name: row.supervisor_name ?? NO_SUPERVISOR,
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

export async function loadShiftRows(reportDate: string) {
  const { data, error } = await supabase
    .schema('analytics')
    .from('shift_daily_metrics')
    .select('*')
    .eq('report_date', reportDate)

  if (error) throw error
  return filterAnalyticsShiftRows((data ?? []) as ShiftMetricRow[])
}

export async function loadKppEmployees(reportDate: string) {
  const { data, error } = await supabase
    .schema('analytics')
    .from('shift_daily_metrics')
    .select('ww_shift_id, employee_number, full_name, supervisor_name, kpp_sec_total')
    .eq('report_date', reportDate)
    .gt('kpp_sec_total', 0)
    .order('kpp_sec_total', { ascending: false })

  if (error) throw error

  const employees = filterAnalyticsShiftRows(
    (data ?? []).map((row) => ({
      ww_shift_id: Number(row.ww_shift_id),
      employee_number: String(row.employee_number),
      full_name: String(row.full_name),
      supervisor_name: (row.supervisor_name as string | null) ?? NO_SUPERVISOR,
      kpp_sec: Number(row.kpp_sec_total),
    })),
  )

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

export async function loadZoneDaily(reportDate: string, supervisor?: string) {
  let query = supabase
    .schema('analytics')
    .from('zone_daily_metrics')
    .select('zona, sec, shifts, supervisor_name')
    .eq('report_date', reportDate)

  if (supervisor && supervisor !== 'all') {
    query = query.eq('supervisor_name', supervisor)
  }

  const { data, error } = await query
  if (error) throw error

  const totals = new Map<number, { sec: number; shifts: number }>()
  for (const row of data ?? []) {
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

export async function loadZoneDailyByBrigade(reportDate: string) {
  const { data, error } = await supabase
    .schema('analytics')
    .from('zone_daily_metrics')
    .select('zona, sec, shifts, supervisor_name')
    .eq('report_date', reportDate)

  if (error) throw error

  const supervisors = new Map<string, Map<number, { sec: number; shifts: number }>>()
  for (const row of data ?? []) {
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

export async function loadIdleEpisodes(reportDate: string) {
  const { data, error } = await supabase
    .schema('analytics')
    .from('idle_episodes_daily')
    .select('ww_shift_id, session_id, employee_number, full_name, dt_start, dt_end, duration_min, ble_tag_zone')
    .eq('report_date', reportDate)
    .order('duration_min', { ascending: false })

  if (error) throw error

  const { data: shifts, error: shiftsError } = await supabase
    .schema('analytics')
    .from('shift_daily_metrics')
    .select('ww_shift_id, supervisor_name')
    .eq('report_date', reportDate)

  if (shiftsError) throw shiftsError

  const supervisorByShift = new Map<number, string>()
  for (const row of shifts ?? []) {
    supervisorByShift.set(Number(row.ww_shift_id), (row.supervisor_name as string | null) ?? NO_SUPERVISOR)
  }

  return (data ?? [])
    .filter((row) => isZoneVisibleInDistribution(row.ble_tag_zone as number | null, getMetricSettings().zoneVisibility))
    .map((row) => ({
      ww_shift_id: Number(row.ww_shift_id),
      session_id: row.session_id === null ? null : Number(row.session_id),
      employee_number: (row.employee_number as string | null) ?? null,
      full_name: (row.full_name as string | null) ?? null,
      supervisor_name: supervisorByShift.get(Number(row.ww_shift_id)) ?? NO_SUPERVISOR,
      dt_start: (row.dt_start as string | null) ?? null,
      dt_end: (row.dt_end as string | null) ?? null,
      duration_min: Number(row.duration_min),
      ble_tag_zone: row.ble_tag_zone === null ? null : Number(row.ble_tag_zone),
      zonaName: zoneName(row.ble_tag_zone as number | null),
    }))
    .filter((row) => isAnalyticsSupervisor(row.supervisor_name)) satisfies IdleEpisode[]
}
