import { supabase } from './supabase'
import { zoneName, isHiddenZone } from './zones'

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

export type IdleEpisode = {
  ww_shift_id: number
  session_id: number | null
  employee_number: string | null
  full_name: string | null
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

const KPP_LUNCH_START_MIN = 13 * 60
const KPP_LUNCH_END_MIN = 14 * 60

function getMoscowMinutesFromIso(iso: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso))
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

export function isKppMetricMinuteAt(eventAt: string) {
  const minutes = getMoscowMinutesFromIso(eventAt)
  return !(minutes >= KPP_LUNCH_START_MIN && minutes < KPP_LUNCH_END_MIN)
}

export function formatMoscowTime(iso: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
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

const BRIGADE_SHIFT_TARGETS: Record<string, number> = {
  Джалол: 20,
  'ЛИ СОН ХАК': 22,
}

export const TRACKED_BRIGADES = Object.keys(BRIGADE_SHIFT_TARGETS)

export function brigadeNamesMatch(left: string, right: string) {
  return (
    left.localeCompare(right, 'ru', { sensitivity: 'accent' }) === 0 || left.toUpperCase() === right.toUpperCase()
  )
}

export function addDaysIso(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export const SHIFT_TARGET_WORKERS = 50

function getBrigadeShiftTarget(supervisorName: string) {
  const match = Object.entries(BRIGADE_SHIFT_TARGETS).find(([name]) => brigadeNamesMatch(name, supervisorName))
  return match?.[1] ?? null
}

export function formatBrigadeShiftHeadcount(supervisorName: string, actual: number) {
  const target = getBrigadeShiftTarget(supervisorName)
  return target == null ? String(actual) : `${actual} / ${target}`
}

export function formatShiftHeadcount(actual: number) {
  return `${actual} / ${SHIFT_TARGET_WORKERS}`
}

export function formatPercent(value: number) {
  return `${Math.round(value)}%`
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

export async function loadAvailableWeeks() {
  const { data, error } = await supabase
    .schema('analytics')
    .from('brigade_weekly_metrics')
    .select('week_start, week_end')
    .order('week_start', { ascending: false })

  if (error) throw error

  const seen = new Map<string, { week_start: string; week_end: string }>()
  for (const row of data ?? []) {
    const key = row.week_start as string
    if (!seen.has(key)) {
      seen.set(key, { week_start: key, week_end: row.week_end as string })
    }
  }
  return [...seen.values()]
}

export async function loadBrigadeDaily(reportDate: string) {
  const { data, error } = await supabase
    .schema('analytics')
    .from('brigade_daily_metrics')
    .select('*')
    .eq('report_date', reportDate)
    .order('supervisor_name', { ascending: true })

  if (error) throw error
  return (data ?? []) as BrigadeDailyRow[]
}

export async function loadBrigadeWeekly(weekStart: string) {
  const { data, error } = await supabase
    .schema('analytics')
    .from('brigade_weekly_metrics')
    .select('*')
    .eq('week_start', weekStart)
    .order('supervisor_name', { ascending: true })

  if (error) throw error
  return (data ?? []) as BrigadeWeeklyRow[]
}

export type BrigadeDynamicsPoint = {
  report_date: string
  activity_pct: number
}

export type BrigadeDynamicsCard = {
  supervisor_name: string
  today_pct: number | null
  yesterday_pct: number | null
  day_delta: number | null
  sparkline: BrigadeDynamicsPoint[]
}

export async function loadBrigadeActivityDynamics(referenceDate: string) {
  const sparklineStart = addDaysIso(referenceDate, -6)
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

  return TRACKED_BRIGADES.map((brigadeName) => {
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
      sparkline: brigadeDaily.map((row) => ({
        report_date: row.report_date,
        activity_pct: row.activity_pct,
      })),
    } satisfies BrigadeDynamicsCard
  })
}

export type AttentionEmployee = {
  employee_number: string
  full_name: string
  supervisor_name: string
  activity_pct: number
}

export const LOW_ACTIVITY_THRESHOLD = 30

/** Порог длительного простоя в отчёте 10 (минуты). */
export const LONG_IDLE_THRESHOLD_MIN = 10

export function getShiftProductivity(row: Pick<ShiftMetricRow, 'work_sec_total' | 'total_sec_total'>) {
  return ratio(row.work_sec_total, row.total_sec_total)
}

export function filterLowActivityDaily(rows: ShiftMetricRow[]) {
  return rows
    .filter((row) => row.total_sec_total > 0 && getShiftProductivity(row) < LOW_ACTIVITY_THRESHOLD)
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

export async function loadShiftRowsForRange(weekStart: string, weekEnd: string) {
  const { data, error } = await supabase
    .schema('analytics')
    .from('shift_daily_metrics')
    .select('*')
    .gte('report_date', weekStart)
    .lte('report_date', weekEnd)

  if (error) throw error
  return (data ?? []) as ShiftMetricRow[]
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
  return aggregateShiftActivity(rows)
    .filter((row) => row.total_sec > 0 && row.activity_pct < LOW_ACTIVITY_THRESHOLD)
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
  return (data ?? []) as ShiftMetricRow[]
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

  const employees = (data ?? []).map((row) => ({
    ww_shift_id: Number(row.ww_shift_id),
    employee_number: String(row.employee_number),
    full_name: String(row.full_name),
    supervisor_name: (row.supervisor_name as string | null) ?? NO_SUPERVISOR,
    kpp_sec: Number(row.kpp_sec_total),
  }))

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

/** Доля ПВ от суммы времени по зонам без zone=0 (как в блоке «Местоположение»). */
export function pvPercentFromZoneRows(zoneRows: ZoneDailyRow[]) {
  const totalSec = zoneRows.reduce((sum, row) => sum + row.sec, 0)
  const pvSec = zoneRows.find((row) => row.zona === PV_ZONE)?.sec ?? 0
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
    const zona = Number(row.zona)
    if (!Number.isFinite(zona) || isHiddenZone(zona)) continue
    const current = totals.get(zona) ?? { sec: 0, shifts: 0 }
    current.sec += Number(row.sec)
    current.shifts = Math.max(current.shifts, Number(row.shifts))
    totals.set(zona, current)
  }

  return [...totals.entries()]
    .map(([zona, value]) => ({ zona, zonaName: zoneName(zona), sec: value.sec, shifts: value.shifts }))
    .sort((left, right) => right.sec - left.sec) satisfies ZoneDailyRow[]
}

export async function loadIdleEpisodes(reportDate: string) {
  const { data, error } = await supabase
    .schema('analytics')
    .from('idle_episodes_daily')
    .select('ww_shift_id, session_id, employee_number, full_name, dt_start, dt_end, duration_min, ble_tag_zone')
    .eq('report_date', reportDate)
    .gte('duration_min', LONG_IDLE_THRESHOLD_MIN)
    .order('duration_min', { ascending: false })

  if (error) throw error

  return (data ?? [])
    .filter((row) => !isHiddenZone(row.ble_tag_zone as number | null))
    .map((row) => ({
    ww_shift_id: Number(row.ww_shift_id),
    session_id: row.session_id === null ? null : Number(row.session_id),
    employee_number: (row.employee_number as string | null) ?? null,
    full_name: (row.full_name as string | null) ?? null,
    dt_start: (row.dt_start as string | null) ?? null,
    dt_end: (row.dt_end as string | null) ?? null,
    duration_min: Number(row.duration_min),
    ble_tag_zone: row.ble_tag_zone === null ? null : Number(row.ble_tag_zone),
    zonaName: zoneName(row.ble_tag_zone as number | null),
  })) satisfies IdleEpisode[]
}
