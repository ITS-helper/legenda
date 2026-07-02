import { supabase } from './supabase'

export type BrigadeDailyRow = {
  report_date: string
  supervisor_name: string
  workers: number
  work_sec: number
  idle_sec: number
  total_sec: number
  sleep_sec: number
  pv_sec: number
  kpp_sec: number
  kpp_workers: number
  activity_pct: number
  idle_pct: number
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
  total_sec: number
  sleep_sec: number
  pv_sec: number
  kpp_sec: number
  kpp_shifts: number
  activity_pct: number
  idle_pct: number
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
  sleep_sec_total: number
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
      acc.total_sec += row.total_sec
      acc.kpp_sec += row.kpp_sec
      acc.kpp_workers += row.kpp_workers
      return acc
    },
    { workers: 0, work_sec: 0, idle_sec: 0, total_sec: 0, kpp_sec: 0, kpp_workers: 0 },
  )
}

export function ratio(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : 0
}
