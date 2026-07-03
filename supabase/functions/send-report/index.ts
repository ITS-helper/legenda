import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@6.9.16'

type ReportType = 'daily' | 'weekly'

type Recipient = {
  email: string
  label: string | null
  daily: boolean
  weekly: boolean
  active: boolean
}

type BrigadeDailyRow = {
  supervisor_name: string
  workers: number
  work_sec: number
  weak_activity_sec: number
  long_idle_sec: number
  go_sec: number
  total_sec: number
  kpp_sec: number
  kpp_workers: number
  activity_pct: number
  weak_activity_pct: number
  long_idle_pct: number
  go_pct: number
  avg_shift_duration_sec: number
}

type BrigadeWeeklyRow = {
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
  kpp_sec: number
  kpp_shifts: number
  activity_pct: number
  weak_activity_pct: number
  long_idle_pct: number
  go_pct: number
  avg_shift_duration_sec: number
}

type KppRow = {
  full_name: string
  employee_number: string
  supervisor_name: string | null
  kpp_sec_total: number
  kpp_time: string
}

type ShiftMetricRow = {
  employee_number: string
  full_name: string
  supervisor_name: string | null
  work_sec_total: number
  total_sec_total: number
}

type AttentionRow = {
  full_name: string
  employee_number: string
  supervisor_name: string | null
  activity_pct: number
}

const LOW_ACTIVITY_THRESHOLD = 30

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-settings-password',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders })
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const message = Reflect.get(error, 'message')
    if (typeof message === 'string') return message
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return String(error)
}

function isAuthorized(request: Request) {
  const expectedPassword = Deno.env.get('SETTINGS_ADMIN_PASSWORD')
  const requestPassword = request.headers.get('x-settings-password')

  if (!expectedPassword) {
    return { ok: false, response: jsonResponse({ error: 'SETTINGS_ADMIN_PASSWORD is not configured' }, 500) }
  }
  if (!requestPassword || requestPassword !== expectedPassword) {
    return { ok: false, response: jsonResponse({ error: 'Неверный пароль админки' }, 401) }
  }
  return { ok: true as const }
}

function getAdminClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return null
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'analytics' },
  })
}

function moscowTodayIso() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  return parts
}

function yesterdayMoscowIso() {
  const today = new Date(`${moscowTodayIso()}T00:00:00Z`)
  today.setUTCDate(today.getUTCDate() - 1)
  return today.toISOString().slice(0, 10)
}

function weekStartIso(dateIso: string) {
  const date = new Date(`${dateIso}T00:00:00Z`)
  const day = date.getUTCDay()
  const diff = (day === 0 ? -6 : 1) - day
  date.setUTCDate(date.getUTCDate() + diff)
  return date.toISOString().slice(0, 10)
}

function previousWeekStartIso() {
  const thisWeek = new Date(`${weekStartIso(moscowTodayIso())}T00:00:00Z`)
  thisWeek.setUTCDate(thisWeek.getUTCDate() - 7)
  return thisWeek.toISOString().slice(0, 10)
}

function addDaysIso(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
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

function isKppMetricMinuteAt(eventAt: string) {
  const minutes = getMoscowMinutesFromIso(eventAt)
  return !(minutes >= KPP_LUNCH_START_MIN && minutes < KPP_LUNCH_END_MIN)
}

function formatMoscowTime(iso: string) {
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

function buildKppTimeLabel(eventTimes: string[]) {
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

async function loadKppRows(supabase: ReturnType<typeof getAdminClient>, date: string) {
  const { data: kppData, error: kppError } = await supabase!
    .from('shift_daily_metrics')
    .select('ww_shift_id, full_name, employee_number, supervisor_name, kpp_sec_total')
    .eq('report_date', date)
    .gt('kpp_sec_total', 0)
    .order('kpp_sec_total', { ascending: false })
  if (kppError) throw kppError

  const rows = (kppData ?? []) as Array<KppRow & { ww_shift_id: number }>
  if (rows.length === 0) return [] as KppRow[]

  const shiftIds = rows.map((row) => row.ww_shift_id)
  const { data: minuteData, error: minuteError } = await supabase!
    .from('ble_minute_facts')
    .select('ww_shift_id, event_at')
    .eq('report_date', date)
    .eq('zona', '13')
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

  return rows.map((row) => ({
    full_name: row.full_name,
    employee_number: row.employee_number,
    supervisor_name: row.supervisor_name,
    kpp_sec_total: row.kpp_sec_total,
    kpp_time: buildKppTimeLabel(minutesByShift.get(row.ww_shift_id) ?? []),
  }))
}

function formatShiftDuration(totalSeconds: number) {
  const safe = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  return `${hours}ч ${String(minutes).padStart(2, '0')}м`
}

function pct(value: number) {
  return `${Math.round(value)}%`
}

function ru(dateIso: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(dateIso))
}

function ruShort(dateIso: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(new Date(dateIso))
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function wrapEmailHtml(innerHtml: string) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Work Watch Analytics</title>
</head>
<body style="margin:0;padding:0;background:#eef1f6;">
${innerHtml}
</body>
</html>`
}

const COLORS = {
  page: '#eef1f6',
  surface: '#ffffff',
  surface2: '#f5f7fb',
  text: '#33404f',
  textH: '#0f1b2d',
  textMuted: '#6b7a8d',
  kicker: '#8a97a8',
  brand: '#004ecf',
  brandSoft: 'rgba(0, 78, 207, 0.08)',
  border: 'rgba(15, 27, 45, 0.1)',
  alert: '#d1495b',
  alertSoft: 'rgba(209, 73, 91, 0.1)',
  alertBorder: 'rgba(209, 73, 91, 0.45)',
  work: '#00d5b4',
  workSoft: 'rgba(0, 213, 180, 0.1)',
  workBorder: 'rgba(0, 213, 180, 0.45)',
}

const EMAIL_WRAP_START = `<div style="font-family:'Segoe UI',Arial,Helvetica,sans-serif;background:${COLORS.page};padding:24px;color:${COLORS.text};">
<div style="max-width:720px;margin:0 auto;background:${COLORS.surface};border-radius:20px;overflow:hidden;border:1px solid ${COLORS.border};box-shadow:0 8px 24px rgba(15,27,45,0.06);">`
const EMAIL_WRAP_END = `<div style="padding:16px 24px;background:${COLORS.surface2};color:${COLORS.textMuted};font-size:12px;border-top:1px solid ${COLORS.border};">Work Watch Analytics</div></div></div>`

const BRIGADE_SHIFT_TARGETS: Record<string, number> = {
  Джалол: 20,
  'ЛИ СОН ХАК': 22,
}

const TRACKED_BRIGADES = Object.keys(BRIGADE_SHIFT_TARGETS)

function brigadeNamesMatch(left: string, right: string) {
  return (
    left.localeCompare(right, 'ru', { sensitivity: 'accent' }) === 0 || left.toUpperCase() === right.toUpperCase()
  )
}

function formatDeltaPercent(delta: number | null) {
  if (delta == null || Number.isNaN(delta)) return '—'
  const rounded = Math.round(delta * 10) / 10
  if (rounded === 0) return '0%'
  const sign = rounded > 0 ? '+' : ''
  return `${sign}${rounded}%`
}

const SHIFT_TARGET_WORKERS = 50

function getBrigadeShiftTarget(supervisorName: string) {
  const match = Object.entries(BRIGADE_SHIFT_TARGETS).find(
    ([name]) =>
      name.localeCompare(supervisorName, 'ru', { sensitivity: 'accent' }) === 0 ||
      name.toUpperCase() === supervisorName.toUpperCase(),
  )
  return match?.[1] ?? null
}

function formatBrigadeShiftHeadcount(supervisorName: string, actual: number) {
  const target = getBrigadeShiftTarget(supervisorName)
  return target == null ? String(actual) : `${actual} / ${target}`
}

function formatShiftHeadcount(actual: number) {
  return `${actual} / ${SHIFT_TARGET_WORKERS}`
}

function metricCell(label: string, value: string, alert = false, width = '20%') {
  return `<td style="width:${width};vertical-align:top;padding:0;">
    <div style="padding:14px 16px;border:1px solid ${COLORS.border};border-radius:16px;background:${COLORS.surface2};height:110px;box-sizing:border-box;position:relative;overflow:hidden;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:${COLORS.textMuted};line-height:1.35;height:42px;overflow:hidden;">${label}</div>
      <div style="position:absolute;left:14px;right:14px;bottom:14px;text-align:center;font-size:24px;font-weight:700;color:${alert ? COLORS.alert : COLORS.textH};line-height:1.1;">${value}</div>
    </div>
  </td>`
}

function shiftActivityPct(row: Pick<ShiftMetricRow, 'work_sec_total' | 'total_sec_total'>) {
  return row.total_sec_total > 0 ? (row.work_sec_total / row.total_sec_total) * 100 : 0
}

function filterLowActivityDaily(rows: ShiftMetricRow[]) {
  return rows
    .filter((row) => row.total_sec_total > 0 && shiftActivityPct(row) < LOW_ACTIVITY_THRESHOLD)
    .map((row) => ({
      full_name: row.full_name,
      employee_number: row.employee_number,
      supervisor_name: row.supervisor_name,
      activity_pct: shiftActivityPct(row),
    }))
    .sort((left, right) => left.activity_pct - right.activity_pct)
}

function aggregateLowActivityWeekly(rows: ShiftMetricRow[]) {
  const totals = new Map<
    string,
    { work_sec: number; total_sec: number; full_name: string; supervisor_name: string | null }
  >()

  for (const row of rows) {
    const current = totals.get(row.employee_number) ?? {
      work_sec: 0,
      total_sec: 0,
      full_name: row.full_name,
      supervisor_name: row.supervisor_name,
    }
    current.work_sec += row.work_sec_total
    current.total_sec += row.total_sec_total
    totals.set(row.employee_number, current)
  }

  return [...totals.entries()]
    .map(([employee_number, row]) => ({
      employee_number,
      full_name: row.full_name,
      supervisor_name: row.supervisor_name,
      activity_pct: row.total_sec > 0 ? (row.work_sec / row.total_sec) * 100 : 0,
      total_sec: row.total_sec,
    }))
    .filter((row) => row.total_sec > 0 && row.activity_pct < LOW_ACTIVITY_THRESHOLD)
    .map(({ total_sec: _total, ...row }) => row)
    .sort((left, right) => left.activity_pct - right.activity_pct)
}

function aggregateShiftActivity(rows: ShiftMetricRow[]) {
  const totals = new Map<
    string,
    { work_sec: number; total_sec: number; full_name: string; supervisor_name: string | null }
  >()

  for (const row of rows) {
    const current = totals.get(row.employee_number) ?? {
      work_sec: 0,
      total_sec: 0,
      full_name: row.full_name,
      supervisor_name: row.supervisor_name,
    }
    current.work_sec += row.work_sec_total
    current.total_sec += row.total_sec_total
    totals.set(row.employee_number, current)
  }

  return [...totals.entries()].map(([employee_number, row]) => ({
    employee_number,
    full_name: row.full_name,
    supervisor_name: row.supervisor_name,
    activity_pct: row.total_sec > 0 ? (row.work_sec / row.total_sec) * 100 : 0,
    total_sec: row.total_sec,
  }))
}

function topActivityDaily(rows: ShiftMetricRow[], limit = 3) {
  return rows
    .filter((row) => row.total_sec_total > 0)
    .map((row) => ({
      full_name: row.full_name,
      employee_number: row.employee_number,
      supervisor_name: row.supervisor_name,
      activity_pct: shiftActivityPct(row),
    }))
    .sort((left, right) => right.activity_pct - left.activity_pct)
    .slice(0, limit)
}

function topActivityWeekly(rows: ShiftMetricRow[], limit = 3) {
  return aggregateShiftActivity(rows)
    .filter((row) => row.total_sec > 0)
    .sort((left, right) => right.activity_pct - left.activity_pct)
    .slice(0, limit)
    .map(({ total_sec: _total, ...row }) => row)
}

function topActivityBlock(rows: AttentionRow[], periodLabel: string) {
  if (rows.length === 0) {
    return `<div style="margin-top:16px;padding:14px 16px;background:${COLORS.surface2};border-radius:16px;color:${COLORS.textMuted};border:1px solid ${COLORS.border};">Нет данных для топа по активности ${periodLabel}.</div>`
  }

  const items = rows
    .map(
      (row, index) => `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-bottom:8px;border:1px solid ${COLORS.border};border-radius:14px;background:${COLORS.surface};border-collapse:separate;">
      <tr>
        <td width="44" style="padding:12px 0 12px 14px;vertical-align:middle;">
          <div style="width:28px;height:28px;border-radius:10px;background:${COLORS.surface2};color:${COLORS.textH};font-weight:700;text-align:center;line-height:28px;font-size:14px;">${index + 1}</div>
        </td>
        <td style="padding:12px 8px;vertical-align:middle;">
          <div style="font-weight:700;color:${COLORS.textH};">${escapeHtml(row.full_name)}</div>
          <div style="font-size:13px;color:${COLORS.textMuted};margin-top:4px;">#${escapeHtml(row.employee_number)} &#183; ${escapeHtml(row.supervisor_name ?? 'Без начальника')}</div>
        </td>
        <td align="right" style="padding:12px 14px 12px 8px;vertical-align:middle;font-weight:700;color:${COLORS.textH};white-space:nowrap;">${pct(row.activity_pct)}</td>
      </tr>
    </table>`,
    )
    .join('')

  return `<details style="margin-top:16px;border:1px solid ${COLORS.workBorder};border-radius:20px;background:${COLORS.workSoft};overflow:hidden;">
    <summary style="padding:16px 20px;font-weight:700;color:${COLORS.textH};cursor:pointer;list-style:none;">
      <span style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:${COLORS.textMuted};display:block;margin-bottom:4px;">Топ 3 по активности</span>
      ${periodLabel}
    </summary>
    <div style="padding:0 16px 16px;">${items}</div>
  </details>`
}

function shiftDurationBlock(
  rows: Array<{ supervisor_name: string; avg_shift_duration_sec: number }>,
  periodLabel: string,
) {
  const withData = rows.filter((row) => row.avg_shift_duration_sec > 0)
  if (withData.length === 0) {
    return `<div style="margin-top:16px;padding:14px 16px;background:${COLORS.surface2};border-radius:16px;color:${COLORS.textMuted};border:1px solid ${COLORS.border};">Нет данных о длительности смены ${periodLabel}.</div>`
  }

  const items = withData
    .map(
      (row) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:14px;background:${COLORS.surface};border:1px solid ${COLORS.border};margin-bottom:8px;">
      <div style="font-weight:700;color:${COLORS.textH};">${escapeHtml(row.supervisor_name)}</div>
      <div style="font-weight:700;color:${COLORS.textH};white-space:nowrap;">${formatShiftDuration(row.avg_shift_duration_sec)}</div>
    </div>`,
    )
    .join('')

  return `<details style="margin-top:16px;border:1px solid ${COLORS.border};border-radius:20px;background:${COLORS.surface2};overflow:hidden;">
    <summary style="padding:16px 20px;font-weight:700;color:${COLORS.textH};cursor:pointer;list-style:none;">
      <span style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:${COLORS.textMuted};display:block;margin-bottom:4px;">Длительность смены</span>
      Среднее время смены ${periodLabel}
    </summary>
    <div style="padding:0 16px 16px;">${items}</div>
  </details>`
}

function attentionBlock(rows: AttentionRow[], periodLabel: string) {
  if (rows.length === 0) {
    return `<div style="margin-top:16px;padding:14px 16px;background:${COLORS.surface2};border-radius:16px;color:${COLORS.textMuted};border:1px solid ${COLORS.border};">Сотрудников с активностью ниже 30% ${periodLabel} нет.</div>`
  }

  const items = rows
    .map(
      (row) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:14px;background:${COLORS.surface};border:1px solid ${COLORS.border};margin-bottom:8px;">
      <div>
        <div style="font-weight:700;color:${COLORS.textH};">${escapeHtml(row.full_name)}</div>
        <div style="font-size:13px;color:${COLORS.textMuted};margin-top:4px;">#${escapeHtml(row.employee_number)} &#183; ${escapeHtml(row.supervisor_name ?? 'Без начальника')}</div>
      </div>
      <div style="font-weight:700;color:${COLORS.alert};white-space:nowrap;">${pct(row.activity_pct)}</div>
    </div>`,
    )
    .join('')

  return `<details style="margin-top:16px;border:1px solid ${COLORS.alertBorder};border-radius:20px;background:${COLORS.alertSoft};overflow:hidden;">
    <summary style="padding:16px 20px;font-weight:700;color:${COLORS.alert};cursor:pointer;list-style:none;">
      <span style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:${COLORS.textMuted};display:block;margin-bottom:4px;">Требуют внимания</span>
      Активность ниже 30% ${periodLabel}
    </summary>
    <div style="padding:0 16px 16px;">${items}</div>
  </details>`
}

function brigadeTableDaily(rows: BrigadeDailyRow[]) {
  const body = rows
    .map(
      (row) => `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid ${COLORS.border};font-weight:600;color:${COLORS.textH};">${escapeHtml(row.supervisor_name)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid ${COLORS.border};text-align:center;">${formatBrigadeShiftHeadcount(row.supervisor_name, row.workers)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid ${COLORS.border};text-align:center;">${pct(row.activity_pct)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid ${COLORS.border};text-align:center;">${pct(row.weak_activity_pct)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid ${COLORS.border};text-align:center;">${pct(row.long_idle_pct)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid ${COLORS.border};text-align:center;">${pct(row.go_pct)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid ${COLORS.border};text-align:center;color:${row.kpp_workers > 0 ? COLORS.alert : COLORS.textH};">${row.kpp_workers > 0 ? row.kpp_workers : '—'}</td>
    </tr>`,
    )
    .join('')

  return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px;">
    <thead><tr style="background:${COLORS.surface2};color:${COLORS.textMuted};text-align:left;">
      <th style="padding:10px 12px;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">Бригада</th>
      <th style="padding:10px 12px;text-align:center;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">Вышло</th>
      <th style="padding:10px 12px;text-align:center;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">Активность</th>
      <th style="padding:10px 12px;text-align:center;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">Слабая активность</th>
      <th style="padding:10px 12px;text-align:center;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">Длительный простой</th>
      <th style="padding:10px 12px;text-align:center;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">Ходьба между зонами</th>
      <th style="padding:10px 12px;text-align:center;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">На КПП</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`
}

function brigadeTableWeekly(rows: BrigadeWeeklyRow[]) {
  const body = rows
    .map(
      (row) => `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid ${COLORS.border};font-weight:600;color:${COLORS.textH};">${escapeHtml(row.supervisor_name)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid ${COLORS.border};text-align:center;">${row.avg_workers}</td>
      <td style="padding:10px 12px;border-bottom:1px solid ${COLORS.border};text-align:center;">${pct(row.activity_pct)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid ${COLORS.border};text-align:center;">${pct(row.weak_activity_pct)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid ${COLORS.border};text-align:center;">${pct(row.long_idle_pct)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid ${COLORS.border};text-align:center;">${pct(row.go_pct)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid ${COLORS.border};text-align:center;color:${row.kpp_shifts > 0 ? COLORS.alert : COLORS.textH};">${row.kpp_shifts > 0 ? row.kpp_shifts : '—'}</td>
    </tr>`,
    )
    .join('')

  return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px;">
    <thead><tr style="background:${COLORS.surface2};color:${COLORS.textMuted};text-align:left;">
      <th style="padding:10px 12px;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">Бригада</th>
      <th style="padding:10px 12px;text-align:center;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">Чел./день</th>
      <th style="padding:10px 12px;text-align:center;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">Активность</th>
      <th style="padding:10px 12px;text-align:center;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">Слабая активность</th>
      <th style="padding:10px 12px;text-align:center;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">Длительный простой</th>
      <th style="padding:10px 12px;text-align:center;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">Ходьба между зонами</th>
      <th style="padding:10px 12px;text-align:center;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">Замечены на КПП</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`
}

type BrigadeDynamicsPoint = {
  report_date: string
  activity_pct: number
}

type BrigadeDynamicsCard = {
  supervisor_name: string
  today_pct: number | null
  prior_pct: number | null
  delta: number | null
  sparkline?: BrigadeDynamicsPoint[]
}

function deltaColor(delta: number | null) {
  if (delta == null || delta === 0) return COLORS.textMuted
  return delta > 0 ? COLORS.work : COLORS.alert
}

const SPARKLINE_BAR_SOFT = 'rgba(0, 78, 207, 0.35)'

function buildSparklineEmail(points: BrigadeDynamicsPoint[]) {
  if (points.length < 2) {
    return `<div style="font-size:12px;color:${COLORS.textMuted};padding:8px 0;">Мало данных за 7 дней</div>`
  }

  const chartHeight = 44
  const barWidth = Math.max(10, Math.min(16, Math.floor(168 / points.length) - 2))
  const values = points.map((point) => point.activity_pct)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  const bars = values
    .map((value, index) => {
      const barHeight = Math.max(6, Math.round(((value - min) / range) * (chartHeight - 10)) + 6)
      const isLast = index === values.length - 1
      return `<td valign="bottom" style="padding:0 2px;height:${chartHeight}px;">
        <div style="width:${barWidth}px;height:${barHeight}px;background:${isLast ? COLORS.brand : SPARKLINE_BAR_SOFT};border-radius:4px 4px 0 0;font-size:0;line-height:0;">&nbsp;</div>
      </td>`
    })
    .join('')

  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;"><tr>${bars}</tr></table>`
}

function dynamicsCardHtml(
  card: BrigadeDynamicsCard,
  options: { periodLabel: string; comparePrefix: string; emptyCompare: string; sparklineTitle?: string },
) {
  const compareText =
    card.prior_pct != null
      ? `${options.comparePrefix} (${pct(card.prior_pct)})`
      : options.emptyCompare

  const sparkline = card.sparkline ?? []
  const sparklineLabels =
    sparkline.length >= 2
      ? `<table cellpadding="0" cellspacing="0" border="0" width="100%" role="presentation" style="margin-top:4px;">
        <tr>
          <td align="left" style="font-size:11px;color:${COLORS.textMuted};">${ruShort(sparkline[0].report_date)}</td>
          <td align="right" style="font-size:11px;color:${COLORS.textMuted};">${ruShort(sparkline[sparkline.length - 1].report_date)}</td>
        </tr>
      </table>`
      : ''
  const sparklineSection = options.sparklineTitle
    ? `<div>
      <div style="color:${COLORS.textMuted};font-size:12px;margin-bottom:8px;">${options.sparklineTitle}</div>
      ${buildSparklineEmail(sparkline)}
      ${sparklineLabels}
    </div>`
    : ''

  return `<div style="padding:20px;border-radius:20px;border:1px solid ${COLORS.border};background:${COLORS.surface};">
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:16px;">
      <strong style="font-size:18px;color:${COLORS.textH};">${escapeHtml(card.supervisor_name)}</strong>
      <span style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:${COLORS.textMuted};">Активность</span>
    </div>
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding:16px;border-radius:16px;background:${COLORS.surface2};${sparklineSection ? 'margin-bottom:16px;' : ''}">
      <div>
        <span style="display:block;color:${COLORS.textMuted};font-size:12px;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">${options.periodLabel}</span>
        <strong style="font-size:32px;line-height:1;color:${COLORS.textH};">${card.today_pct != null ? pct(card.today_pct) : '—'}</strong>
      </div>
      <div style="text-align:right;">
        <div style="font-weight:700;font-size:18px;color:${deltaColor(card.delta)};">${formatDeltaPercent(card.delta)}</div>
        <div style="color:${COLORS.textMuted};font-size:12px;margin-top:4px;">${compareText}</div>
      </div>
    </div>
    ${sparklineSection}
  </div>`
}

function activityDynamicsBlock(
  cards: BrigadeDynamicsCard[],
  options: {
    periodLabel: string
    comparePrefix: string
    emptyCompare: string
    sparklineTitle?: string
  },
) {
  const cells = cards
    .map(
      (card) =>
        `<td width="50%" valign="top" style="padding:0 6px;">${dynamicsCardHtml(card, options)}</td>`,
    )
    .join('')

  return `<div style="margin-top:20px;">
    <h3 style="margin:0 0 12px;color:${COLORS.textH};font-size:16px;">Динамика показателей активности</h3>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>${cells}</tr></table>
  </div>`
}

async function loadBrigadeActivityDynamics(supabase: ReturnType<typeof getAdminClient>, referenceDate: string) {
  const sparklineStart = addDaysIso(referenceDate, -6)
  const priorDate = addDaysIso(referenceDate, -1)

  const { data, error } = await supabase!
    .from('brigade_daily_metrics')
    .select('report_date, supervisor_name, activity_pct')
    .gte('report_date', sparklineStart)
    .lte('report_date', referenceDate)
    .order('report_date', { ascending: true })
  if (error) throw error

  const dailyRows = (data ?? []) as Array<{
    report_date: string
    supervisor_name: string
    activity_pct: number
  }>

  return TRACKED_BRIGADES.map((brigadeName) => {
    const brigadeDaily = dailyRows.filter((row) => brigadeNamesMatch(row.supervisor_name, brigadeName))
    const todayRow = brigadeDaily.find((row) => row.report_date === referenceDate) ?? null
    const priorRow = brigadeDaily.find((row) => row.report_date === priorDate) ?? null
    const todayPct = todayRow?.activity_pct ?? null
    const priorPct = priorRow?.activity_pct ?? null

    return {
      supervisor_name: brigadeName,
      today_pct: todayPct,
      prior_pct: priorPct,
      delta: todayPct != null && priorPct != null ? todayPct - priorPct : null,
      sparkline: brigadeDaily.map((row) => ({
        report_date: row.report_date,
        activity_pct: row.activity_pct,
      })),
    } satisfies BrigadeDynamicsCard
  })
}

async function loadBrigadeWeeklyActivityDynamics(supabase: ReturnType<typeof getAdminClient>, weekStart: string) {
  const priorWeekStart = addDaysIso(weekStart, -7)

  const { data, error } = await supabase!
    .from('brigade_weekly_metrics')
    .select('week_start, supervisor_name, activity_pct')
    .in('week_start', [weekStart, priorWeekStart])
  if (error) throw error

  const weeklyRows = (data ?? []) as Array<{
    week_start: string
    supervisor_name: string
    activity_pct: number
  }>

  return TRACKED_BRIGADES.map((brigadeName) => {
    const brigadeWeekly = weeklyRows.filter((row) => brigadeNamesMatch(row.supervisor_name, brigadeName))
    const weekRow = brigadeWeekly.find((row) => row.week_start === weekStart) ?? null
    const priorRow = brigadeWeekly.find((row) => row.week_start === priorWeekStart) ?? null
    const weekPct = weekRow?.activity_pct ?? null
    const priorPct = priorRow?.activity_pct ?? null

    return {
      supervisor_name: brigadeName,
      today_pct: weekPct,
      prior_pct: priorPct,
      delta: weekPct != null && priorPct != null ? weekPct - priorPct : null,
    } satisfies BrigadeDynamicsCard
  })
}

function kppBlock(rows: KppRow[]) {
  if (rows.length === 0) {
    return `<div style="margin-top:16px;padding:14px 16px;background:${COLORS.surface2};border-radius:16px;color:${COLORS.textMuted};border:1px solid ${COLORS.border};">На КПП никого не фиксировалось.</div>`
  }

  const items = rows
    .map(
      (row) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:14px;background:${COLORS.surface};border:1px solid ${COLORS.border};margin-bottom:8px;">
      <div>
        <div style="font-weight:700;color:${COLORS.textH};">${escapeHtml(row.full_name)}</div>
        <div style="font-size:13px;color:${COLORS.textMuted};margin-top:4px;">#${escapeHtml(row.employee_number)} &#183; ${escapeHtml(row.supervisor_name ?? 'Без начальника')}</div>
      </div>
      <div style="text-align:right;white-space:nowrap;">
        <div style="font-size:14px;font-weight:600;color:${COLORS.textH};">${escapeHtml(row.kpp_time)}</div>
      </div>
    </div>`,
    )
    .join('')

  return `<details style="margin-top:16px;border:1px solid ${COLORS.alertBorder};border-radius:20px;background:${COLORS.alertSoft};overflow:hidden;">
    <summary style="padding:16px 20px;font-weight:700;color:${COLORS.alert};cursor:pointer;list-style:none;">
      <span style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:${COLORS.textMuted};display:block;margin-bottom:4px;">Контроль КПП</span>
      Сотрудники в зоне КПП
    </summary>
    <div style="padding:0 16px 16px;">${items}</div>
  </details>`
}

async function buildDailyHtml(supabase: ReturnType<typeof getAdminClient>, date: string) {
  const { data: brigadesData, error: brigadesError } = await supabase!
    .from('brigade_daily_metrics')
    .select('*')
    .eq('report_date', date)
    .order('supervisor_name', { ascending: true })
  if (brigadesError) throw brigadesError
  const brigades = (brigadesData ?? []) as BrigadeDailyRow[]

  const kpp = await loadKppRows(supabase, date)

  const { data: shiftData, error: shiftError } = await supabase!
    .from('shift_daily_metrics')
    .select('full_name, employee_number, supervisor_name, work_sec_total, total_sec_total')
    .eq('report_date', date)
  if (shiftError) throw shiftError
  const attention = filterLowActivityDaily((shiftData ?? []) as ShiftMetricRow[])
  const topActivity = topActivityDaily((shiftData ?? []) as ShiftMetricRow[])
  const dynamics = await loadBrigadeActivityDynamics(supabase, date)

  const totals = brigades.reduce(
    (acc, row) => {
      acc.workers += row.workers
      acc.work_sec += row.work_sec
      acc.weak_activity_sec += row.weak_activity_sec
      acc.long_idle_sec += row.long_idle_sec
      acc.go_sec += row.go_sec
      acc.total_sec += row.total_sec
      acc.kpp_workers += row.kpp_workers
      return acc
    },
    { workers: 0, work_sec: 0, weak_activity_sec: 0, long_idle_sec: 0, go_sec: 0, total_sec: 0, kpp_workers: 0 },
  )
  const activity = totals.total_sec > 0 ? (totals.work_sec / totals.total_sec) * 100 : 0
  const weakActivity = totals.total_sec > 0 ? (totals.weak_activity_sec / totals.total_sec) * 100 : 0
  const longIdle = totals.total_sec > 0 ? (totals.long_idle_sec / totals.total_sec) * 100 : 0
  const go = totals.total_sec > 0 ? (totals.go_sec / totals.total_sec) * 100 : 0

  const html = `${EMAIL_WRAP_START}
    <div style="padding:24px 24px 8px;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.12em;color:${COLORS.kicker};">Ежедневный отчёт</div>
      <h1 style="margin:6px 0 0;font-size:22px;color:${COLORS.textH};font-weight:700;">Смена за ${ru(date)}</h1>
    </div>
    <div style="padding:8px 24px 24px;">
      <table style="width:100%;border-collapse:separate;border-spacing:8px;table-layout:fixed;">
        <tr>
          ${metricCell('Вышло на смену', formatShiftHeadcount(totals.workers), false, '33.33%')}
          ${metricCell('Активность', pct(activity), false, '33.33%')}
          ${metricCell('Слабая активность', pct(weakActivity), false, '33.33%')}
        </tr>
        <tr>
          ${metricCell('Длительный простой', pct(longIdle), false, '33.33%')}
          ${metricCell('Ходьба между зонами', pct(go), false, '33.33%')}
          ${metricCell('Замечены на КПП', String(totals.kpp_workers), totals.kpp_workers > 0, '33.33%')}
        </tr>
      </table>
      <h3 style="margin:20px 0 0;color:${COLORS.textH};font-size:16px;">По бригадам</h3>
      ${brigadeTableDaily(brigades)}
      ${activityDynamicsBlock(dynamics, {
        periodLabel: 'За день',
        comparePrefix: 'к вчера',
        emptyCompare: 'нет данных за вчера',
        sparklineTitle: `7 дней до ${ru(date)}`,
      })}
      ${shiftDurationBlock(brigades, 'за день')}
      ${topActivityBlock(topActivity, 'за день')}
      ${attentionBlock(attention, 'за день')}
      ${kppBlock(kpp)}
    </div>
  ${EMAIL_WRAP_END}`

  const subject = `Ежедневный отчёт Legenda — ${ruShort(date)}`
  return { html, subject, periodKey: date, hasData: brigades.length > 0 }
}

async function buildWeeklyHtml(supabase: ReturnType<typeof getAdminClient>, weekStart: string) {
  const { data, error } = await supabase!
    .from('brigade_weekly_metrics')
    .select('*')
    .eq('week_start', weekStart)
    .order('supervisor_name', { ascending: true })
  if (error) throw error
  const brigades = (data ?? []) as BrigadeWeeklyRow[]
  const weekEnd = brigades[0]?.week_end ?? addDaysIso(weekStart, 6)

  const { data: shiftData, error: shiftError } = await supabase!
    .from('shift_daily_metrics')
    .select('full_name, employee_number, supervisor_name, work_sec_total, total_sec_total')
    .gte('report_date', weekStart)
    .lte('report_date', weekEnd)
  if (shiftError) throw shiftError
  const attention = aggregateLowActivityWeekly((shiftData ?? []) as ShiftMetricRow[])
  const topActivity = topActivityWeekly((shiftData ?? []) as ShiftMetricRow[])
  const dynamics = await loadBrigadeWeeklyActivityDynamics(supabase, weekStart)

  const totals = brigades.reduce(
    (acc, row) => {
      acc.work_sec += row.work_sec
      acc.weak_activity_sec += row.weak_activity_sec
      acc.long_idle_sec += row.long_idle_sec
      acc.go_sec += row.go_sec
      acc.total_sec += row.total_sec
      acc.kpp_shifts += row.kpp_shifts
      return acc
    },
    { work_sec: 0, weak_activity_sec: 0, long_idle_sec: 0, go_sec: 0, total_sec: 0, kpp_shifts: 0 },
  )
  const activity = totals.total_sec > 0 ? (totals.work_sec / totals.total_sec) * 100 : 0
  const weakActivity = totals.total_sec > 0 ? (totals.weak_activity_sec / totals.total_sec) * 100 : 0
  const longIdle = totals.total_sec > 0 ? (totals.long_idle_sec / totals.total_sec) * 100 : 0
  const go = totals.total_sec > 0 ? (totals.go_sec / totals.total_sec) * 100 : 0

  const html = `${EMAIL_WRAP_START}
    <div style="padding:24px 24px 8px;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.12em;color:${COLORS.kicker};">Еженедельный отчёт</div>
      <h1 style="margin:6px 0 0;font-size:22px;color:${COLORS.textH};font-weight:700;">Неделя ${ruShort(weekStart)} — ${ruShort(weekEnd)}</h1>
    </div>
    <div style="padding:8px 24px 24px;">
      <table style="width:100%;border-collapse:separate;border-spacing:8px;table-layout:fixed;">
        <tr>
          ${metricCell('Активность', pct(activity), false, '20%')}
          ${metricCell('Слабая активность', pct(weakActivity), false, '20%')}
          ${metricCell('Длительный простой', pct(longIdle), false, '20%')}
          ${metricCell('Ходьба между зонами', pct(go), false, '20%')}
          ${metricCell('Замечены на КПП', String(totals.kpp_shifts), totals.kpp_shifts > 0, '20%')}
        </tr>
      </table>
      <h3 style="margin:20px 0 0;color:${COLORS.textH};font-size:16px;">По бригадам за неделю</h3>
      ${brigadeTableWeekly(brigades)}
      ${activityDynamicsBlock(dynamics, {
        periodLabel: 'За неделю',
        comparePrefix: 'к прошлой неделе',
        emptyCompare: 'нет данных за прошлую неделю',
      })}
      ${shiftDurationBlock(brigades, 'за неделю')}
      ${topActivityBlock(topActivity, 'за неделю')}
      ${attentionBlock(attention, 'за неделю')}
    </div>
  ${EMAIL_WRAP_END}`

  const subject = `Еженедельный отчёт Legenda — неделя ${ruShort(weekStart)}`
  return { html, subject, periodKey: weekStart, hasData: brigades.length > 0 }
}

async function listRecipients(supabase: ReturnType<typeof getAdminClient>) {
  const { data, error } = await supabase!
    .from('email_recipients')
    .select('id, email, label, daily, weekly, active')
    .order('email', { ascending: true })
  if (error) throw error
  return data ?? []
}

async function replaceRecipients(supabase: ReturnType<typeof getAdminClient>, recipients: Recipient[]) {
  const cleaned = recipients
    .map((row) => ({
      email: String(row.email ?? '').trim().toLowerCase(),
      label: row.label ? String(row.label).trim() : null,
      daily: row.daily !== false,
      weekly: row.weekly !== false,
      active: row.active !== false,
    }))
    .filter((row) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email))

  const { error: deleteError } = await supabase!.from('email_recipients').delete().gte('id', 0)
  if (deleteError) throw deleteError

  if (cleaned.length > 0) {
    const { error: insertError } = await supabase!.from('email_recipients').insert(cleaned)
    if (insertError) throw insertError
  }

  return listRecipients(supabase)
}

async function sendEmails(subject: string, html: string, recipients: string[]) {
  const hostname = Deno.env.get('SMTP_HOST')
  const port = Number(Deno.env.get('SMTP_PORT') ?? '465')
  const username = Deno.env.get('SMTP_USER')
  const password = Deno.env.get('SMTP_PASSWORD')
  const from = Deno.env.get('SMTP_FROM') ?? username
  const useTls = (Deno.env.get('SMTP_TLS') ?? 'true') !== 'false'

  if (!hostname || !username || !password || !from) {
    throw new Error('SMTP настройки не заданы (SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM)')
  }

  const transporter = nodemailer.createTransport({
    host: hostname,
    port,
    secure: useTls && port !== 587,
    auth: { user: username, pass: password },
  })

  const fullHtml = wrapEmailHtml(html)

  try {
    for (const to of recipients) {
      await transporter.sendMail({
        from,
        to,
        subject,
        html: fullHtml,
      })
    }
  } finally {
    transporter.close()
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const auth = isAuthorized(request)
  if (!auth.ok) return auth.response

  const supabase = getAdminClient()
  if (!supabase) return jsonResponse({ error: 'Supabase service credentials are missing' }, 500)

  const url = new URL(request.url)
  const resource = url.searchParams.get('resource')

  try {
    if (resource === 'recipients') {
      if (request.method === 'GET') {
        return jsonResponse({ recipients: await listRecipients(supabase) })
      }
      if (request.method === 'PUT') {
        const payload = (await request.json().catch(() => null)) as { recipients?: Recipient[] } | null
        if (!Array.isArray(payload?.recipients)) {
          return jsonResponse({ error: 'Ожидается массив recipients' }, 400)
        }
        return jsonResponse({ recipients: await replaceRecipients(supabase, payload!.recipients) })
      }
      return jsonResponse({ error: 'Method not allowed' }, 405)
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405)
    }

    const payload = (await request.json().catch(() => null)) as {
      type?: ReportType
      date?: string
      weekStart?: string
      preview?: boolean
    } | null

    const type = payload?.type
    if (type !== 'daily' && type !== 'weekly') {
      return jsonResponse({ error: 'type должен быть daily или weekly' }, 400)
    }

    const report =
      type === 'daily'
        ? await buildDailyHtml(supabase, payload?.date?.trim() || yesterdayMoscowIso())
        : await buildWeeklyHtml(supabase, payload?.weekStart?.trim() || previousWeekStartIso())

    if (payload?.preview) {
      return jsonResponse({
        ok: true,
        reportType: type,
        periodKey: report.periodKey,
        recipients: [],
        previewHtml: wrapEmailHtml(report.html),
      })
    }

    if (!report.hasData) {
      return jsonResponse({ error: `Нет данных за период ${report.periodKey}` }, 400)
    }

    const allRecipients = await listRecipients(supabase)
    const targets = allRecipients
      .filter((row) => row.active && (type === 'daily' ? row.daily : row.weekly))
      .map((row) => row.email as string)

    if (targets.length === 0) {
      return jsonResponse({ ok: true, reportType: type, periodKey: report.periodKey, recipients: [] })
    }

    try {
      await sendEmails(report.subject, report.html, targets)
      await supabase.from('email_log').insert({
        report_type: type,
        period_key: report.periodKey,
        recipients: targets,
        status: 'sent',
        triggered_by: request.headers.get('x-triggered-by') ?? 'manual',
      })
    } catch (sendError) {
      await supabase.from('email_log').insert({
        report_type: type,
        period_key: report.periodKey,
        recipients: targets,
        status: 'failed',
        error_message: getErrorMessage(sendError),
        triggered_by: request.headers.get('x-triggered-by') ?? 'manual',
      })
      throw sendError
    }

    return jsonResponse({ ok: true, reportType: type, periodKey: report.periodKey, recipients: targets })
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, 500)
  }
})
