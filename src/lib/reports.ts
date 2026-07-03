import { supabase } from './supabase'
import { zoneName } from './zones'

export type BrigadeDailyRow = {
  report_date: string
  supervisor_name: string
  workers: number
  work_sec: number
  idle_sec: number
  go_sec: number
  total_sec: number
  pv_sec: number
  kpp_sec: number
  kpp_workers: number
  activity_pct: number
  idle_pct: number
  go_pct: number
}

export type BrigadeWeeklyRow = {
  week_start: string
  week_end: string
  supervisor_name: string
  days: number
  unique_employees: number
  avg_workers: number
  work_sec: number
  idle_sec: number
  go_sec: number
  total_sec: number
  pv_sec: number
  kpp_sec: number
  kpp_shifts: number
  activity_pct: number
  idle_pct: number
  go_pct: number
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

export const SHIFT_TARGET_WORKERS = 50

export function formatShiftHeadcount(actual: number) {
  return `${actual} / ${SHIFT_TARGET_WORKERS}`
}

export function formatPercent(value: number) {
  return `${Math.round(value)}%`
}

export function formatDecimalPercent(value: number) {
  return `${Number(value).toFixed(1)}%`
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

  return (data ?? []).map((row) => ({
    ww_shift_id: Number(row.ww_shift_id),
    employee_number: String(row.employee_number),
    full_name: String(row.full_name),
    supervisor_name: (row.supervisor_name as string | null) ?? NO_SUPERVISOR,
    kpp_sec: Number(row.kpp_sec_total),
  })) satisfies KppEmployee[]
}

export function sumDaily(rows: BrigadeDailyRow[]) {
  return rows.reduce(
    (acc, row) => {
      acc.workers += row.workers
      acc.work_sec += row.work_sec
      acc.idle_sec += row.idle_sec
      acc.go_sec += row.go_sec
      acc.total_sec += row.total_sec
      acc.kpp_sec += row.kpp_sec
      acc.kpp_workers += row.kpp_workers
      return acc
    },
    { workers: 0, work_sec: 0, idle_sec: 0, go_sec: 0, total_sec: 0, kpp_sec: 0, kpp_workers: 0 },
  )
}

export function ratio(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : 0
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
    if (!Number.isFinite(zona)) continue
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
    .order('duration_min', { ascending: false })

  if (error) throw error

  return (data ?? []).map((row) => ({
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
