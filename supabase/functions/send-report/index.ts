import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@6.9.16'
import { Buffer } from 'node:buffer'
import type { ReportPdfPayload } from './pdf.ts'
import {
  emailBrandingHeader,
  emailHtmlForPreview,
  REPORT_ESSENCE_DAILY,
  REPORT_ESSENCE_WEEKLY,
  REPORT_OBJECT_NAME,
} from './email-branding.ts'
import {
  formatEpisodeCount,
  formatPercent,
  isAlertZone,
  isZoneVisibleInDistribution,
  normalizeZoneVisibility,
  ratio,
  visibleReportZoneRows,
  zoneName,
  type IdleZoneRow,
  type ZoneRow,
} from './zones.ts'
import { isHorizontalBrigadeLayout } from './brigadeLayout.ts'

type ReportType = 'daily' | 'weekly'
type ReportAudience = 'managers' | 'foremen'

type Recipient = {
  email: string
  label: string | null
  daily: boolean
  weekly: boolean
  active: boolean
  audience?: ReportAudience
  brigade_name?: string | null
}

type ReportBuildOptions = {
  brigadeFilter?: string
}

type BlockVisibility = {
  block1: boolean
  block2: boolean
  block3: boolean
  block4: boolean
  block5: boolean
  block6: boolean
}

const DEFAULT_BLOCK_VISIBILITY: BlockVisibility = {
  block1: true,
  block2: true,
  block3: true,
  block4: true,
  block5: true,
  block6: true,
}

async function loadZoneVisibility(supabase: ReturnType<typeof getAdminClient>) {
  const { data, error } = await supabase!.rpc('get_metric_settings')
  if (error || !data || typeof data !== 'object') return normalizeZoneVisibility(null)
  return normalizeZoneVisibility((data as Record<string, unknown>).zone_visibility)
}

async function loadBlockVisibility(supabase: ReturnType<typeof getAdminClient>): Promise<BlockVisibility> {
  const { data, error } = await supabase!.rpc('get_metric_settings')
  if (error || !data || typeof data !== 'object') return DEFAULT_BLOCK_VISIBILITY
  const row = data as Record<string, unknown>
  return {
    block1: row.block_1_enabled !== false,
    block2: row.block_2_enabled !== false,
    block3: row.block_3_enabled !== false,
    block4: row.block_4_enabled !== false,
    block5: row.block_5_enabled !== false,
    block6: row.block_6_enabled !== false,
  }
}

type BrigadeDailyRow = {
  report_date: string
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
  profession: string | null
  work_sec_total: number
  total_sec_total: number
}

type AttentionRow = {
  full_name: string
  employee_number: string
  supervisor_name: string | null
  profession: string | null
  activity_pct: number
}

const DEFAULT_LOW_ACTIVITY_PCT = 30
const DEFAULT_ANALYTICS_MIN_ACTIVITY_PCT = 11

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
  const cronSecret = Deno.env.get('REPORT_CRON_SECRET')
  const requestCronSecret = request.headers.get('x-report-cron-secret')
  if (requestCronSecret) {
    if (!cronSecret || requestCronSecret !== cronSecret) {
      return { ok: false, response: jsonResponse({ error: 'Неверный cron-секрет' }, 401) }
    }
    return { ok: true as const }
  }

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

function listDatesInclusive(startIso: string, endIso: string) {
  const dates: string[] = []
  let current = startIso
  while (current <= endIso) {
    dates.push(current)
    current = addDaysIso(current, 1)
  }
  return dates
}

function roundPct(part: number, total: number) {
  return total > 0 ? Math.round((1000 * part) / total) / 10 : 0
}

function aggregateBrigadeDailyToWeekly(
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
        // brigade_daily_metrics_for_dates группирует по (день, бригада) и не хранит
        // employee_number — уникальных подставляет enrichWeeklyUniqueEmployees ниже
        // из посменных строк, которые для недельного письма и так загружаются.
        unique_employees: 0,
        avg_workers: days > 0 ? Math.round((workers / days) * 10) / 10 : 0,
        work_sec,
        weak_activity_sec,
        long_idle_sec,
        go_sec,
        total_sec,
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

/** Считает unique_employees по посменным строкам недели (зеркалит фронтовый enrichBrigadeWeeklyWithShiftStats). */
function enrichWeeklyUniqueEmployees(
  weeklyRows: BrigadeWeeklyRow[],
  shifts: Array<Pick<ShiftMetricRow, 'employee_number' | 'supervisor_name'>>,
): BrigadeWeeklyRow[] {
  const employeesByBrigade = new Map<string, Set<string>>()
  for (const row of shifts) {
    const supervisorName = row.supervisor_name ?? NO_SUPERVISOR
    const employees = employeesByBrigade.get(supervisorName) ?? new Set<string>()
    employees.add(row.employee_number)
    employeesByBrigade.set(supervisorName, employees)
  }
  return weeklyRows.map((row) => ({
    ...row,
    unique_employees: employeesByBrigade.get(row.supervisor_name)?.size ?? row.unique_employees,
  }))
}

function weeklyActivityPctFromDaily(
  dailyRows: Array<Pick<BrigadeDailyRow, 'report_date' | 'supervisor_name' | 'work_sec' | 'total_sec'>>,
  weekStart: string,
  weekEnd: string,
  brigadeName: string,
) {
  const rows = dailyRows.filter(
    (row) =>
      row.report_date >= weekStart &&
      row.report_date <= weekEnd &&
      brigadeNamesMatch(row.supervisor_name, brigadeName),
  )
  const work_sec = rows.reduce((sum, row) => sum + row.work_sec, 0)
  const total_sec = rows.reduce((sum, row) => sum + row.total_sec, 0)
  return total_sec > 0 ? roundPct(work_sec, total_sec) : null
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

function getMoscowMinutesNow() {
  return getMoscowMinutesFromIso(new Date().toISOString())
}

// Окно, в котором принимается автоматическая рассылка относительно настроенного времени (МСК).
const SCHEDULE_WINDOW_BEFORE_MIN = 15
// +4 ч после настроенного времени — GitHub Actions cron часто опаздывает на 2–3 часа.
const SCHEDULE_WINDOW_AFTER_MIN = 240
// post-import: крайний срок отправки после успешного импорта (МСК, минуты от полуночи).
const POST_IMPORT_DEADLINE_MIN = 14 * 60
// Ручная отправка: не повторять тот же отчёт за тот же период, если он ушёл только что.
// Снимается флагом `force` в теле запроса.
const MANUAL_DEDUP_WINDOW_MIN = 2

type ReportScheduleRow = {
  daily_enabled: boolean
  daily_hour: number
  daily_minute: number
  weekly_enabled: boolean
  weekly_dow: number
  weekly_hour: number
  weekly_minute: number
}

// deno-lint-ignore no-explicit-any
async function loadReportSchedule(supabase: any): Promise<ReportScheduleRow | null> {
  try {
    const { data } = await supabase.rpc('get_report_schedule')
    return (data as ReportScheduleRow) ?? null
  } catch {
    return null
  }
}

function validateSchedulePayload(body: Record<string, unknown>): string | null {
  const intFields: Array<[string, number, number]> = [
    ['daily_hour', 0, 23],
    ['daily_minute', 0, 59],
    ['weekly_hour', 0, 23],
    ['weekly_minute', 0, 59],
    ['weekly_dow', 1, 7],
  ]
  for (const [key, min, max] of intFields) {
    if (body[key] === undefined || body[key] === null) continue
    const value = Number(body[key])
    if (!Number.isInteger(value) || value < min || value > max) {
      return `Некорректное значение поля ${key}`
    }
  }
  return null
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

async function loadZoneRowsByBrigade(
  supabase: ReturnType<typeof getAdminClient>,
  dateStart: string,
  dateEnd: string,
  zoneVisibility: Record<number, boolean>,
) {
  const { data, error } =
    dateStart === dateEnd
      ? await supabase!.rpc('zone_daily_metrics_for_date', { p_report_date: dateStart })
      : await supabase!.rpc('zone_daily_metrics_for_dates', { p_date_from: dateStart, p_date_to: dateEnd })
  if (error) throw error

  const totals = new Map<string, Map<number, number>>()
  for (const row of data ?? []) {
    const supervisorName = (row.supervisor_name as string | null) ?? NO_SUPERVISOR
    if (!isAnalyticsSupervisor(supervisorName)) continue
    const zona = Number(row.zona)
    if (!Number.isFinite(zona) || !isZoneVisibleInDistribution(zona, zoneVisibility)) continue
    const byZone = totals.get(supervisorName) ?? new Map<number, number>()
    byZone.set(zona, (byZone.get(zona) ?? 0) + Number(row.sec))
    totals.set(supervisorName, byZone)
  }

  return new Map(
    [...totals.entries()].map(([supervisor, byZone]) => [
      supervisor,
      [...byZone.entries()]
        .map(([zona, sec]) => ({ zona, zonaName: zoneName(zona), sec }))
        .sort((left, right) => right.sec - left.sec),
    ]),
  )
}

type IdleEpisodeRow = {
  ww_shift_id: number
  duration_min: number
  ble_tag_zone: number | null
  supervisor_name: string
}

async function loadIdleEpisodes(
  supabase: ReturnType<typeof getAdminClient>,
  dateStart: string,
  dateEnd: string,
  zoneVisibility: Record<number, boolean>,
): Promise<IdleEpisodeRow[]> {
  const { data, error } =
    dateStart === dateEnd
      ? await supabase!.rpc('idle_episodes_daily_for_date', { p_report_date: dateStart })
      : await supabase!.rpc('idle_episodes_daily_for_dates', { p_date_from: dateStart, p_date_to: dateEnd })
  if (error) throw error

  return (data ?? [])
    .filter((row) => isZoneVisibleInDistribution(row.ble_tag_zone as number | null, zoneVisibility))
    .map((row) => ({
      ww_shift_id: Number(row.ww_shift_id),
      duration_min: Number(row.duration_min),
      ble_tag_zone: row.ble_tag_zone === null ? null : Number(row.ble_tag_zone),
      supervisor_name: (row.supervisor_name as string | null) ?? NO_SUPERVISOR,
    }))
    .filter((episode) => isAnalyticsSupervisor(episode.supervisor_name))
}

function aggregateIdleByZone(episodes: IdleEpisodeRow[]): IdleZoneRow[] {
  const map = new Map<string, IdleZoneRow>()
  for (const episode of episodes) {
    const name = zoneName(episode.ble_tag_zone)
    const current = map.get(name) ?? {
      zonaName: name,
      minutes: 0,
      count: 0,
      alert: isAlertZone(episode.ble_tag_zone),
    }
    current.minutes += episode.duration_min
    current.count += 1
    map.set(name, current)
  }
  return [...map.values()].sort((left, right) => right.minutes - left.minutes)
}

function aggregateIdleByZoneByBrigade(episodes: IdleEpisodeRow[]) {
  const byBrigade = new Map<string, IdleEpisodeRow[]>()
  for (const episode of episodes) {
    const current = byBrigade.get(episode.supervisor_name) ?? []
    current.push(episode)
    byBrigade.set(episode.supervisor_name, current)
  }
  return new Map([...byBrigade.entries()].map(([supervisor, rows]) => [supervisor, aggregateIdleByZone(rows)]))
}

function zoneBarEmail(widthPct: number, alert = false) {
  const fill = alert ? COLORS.alert : COLORS.brand
  const track = '#e8ebf0'
  const width = Math.max(Math.min(widthPct, 100), widthPct > 0 ? 1 : 0)
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;background:${track};border-radius:999px;overflow:hidden;">
    <tr><td width="${width}%" style="background:${fill};height:10px;font-size:0;line-height:0;">&nbsp;</td>${width < 100 ? '<td style="font-size:0;line-height:0;">&nbsp;</td>' : ''}</tr>
  </table>`
}

function zoneRowEmail(name: string, value: string, barPct: number, alert = false) {
  const nameColor = alert ? COLORS.alert : COLORS.textH
  const valueColor = alert ? COLORS.alert : COLORS.textMuted
  return `<div style="margin-bottom:10px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
      <tr>
        <td style="font-size:14px;font-weight:600;color:${nameColor};">${escapeHtml(name)}</td>
        <td align="right" style="font-size:14px;color:${valueColor};white-space:nowrap;">${escapeHtml(value)}</td>
      </tr>
    </table>
    <div style="margin-top:6px;">${zoneBarEmail(barPct, alert)}</div>
  </div>`
}

function zonesPanelEmail(options: {
  kicker: string
  title: string
  description: string
  summaryHtml?: string
  rowsHtml: string
  emptyText: string
  alertBorder?: boolean
  minHeight?: number
}) {
  const border = options.alertBorder ? COLORS.alertBorder : COLORS.border
  const background = options.alertBorder ? COLORS.alertSoft : COLORS.surface
  const minHeightStyle = options.minHeight ? `min-height:${options.minHeight}px;` : ''

  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border:1px solid ${border};border-radius:20px;background:${background};border-collapse:separate;${minHeightStyle}">
    <tr><td style="padding:18px 20px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-bottom:14px;">
        <tr>
          <td valign="top">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:${COLORS.textMuted};">${options.kicker}</div>
            <div style="font-size:16px;font-weight:700;color:${COLORS.textH};margin-top:6px;">${options.title}</div>
            <div style="font-size:13px;color:${COLORS.textMuted};margin-top:6px;">${options.description}</div>
          </td>
          ${options.summaryHtml ? `<td align="right" valign="top">${options.summaryHtml}</td>` : ''}
        </tr>
      </table>
      ${options.rowsHtml || `<div style="font-size:13px;color:${COLORS.textMuted};">${options.emptyText}</div>`}
    </td></tr>
  </table>`
}

function estimateZonePanelEmailHeight(rowCount: number, hasSummary: boolean) {
  const headerHeight = hasSummary ? 118 : 92
  const rowsHeight = rowCount > 0 ? rowCount * 40 + 8 : 28
  return headerHeight + rowsHeight + 36
}

function zonesBlockEmail(options: {
  periodLabel: string
  locationDescription: string
  idleDescription: string
  idleSummaryLabel: string
  sections: Array<{
    supervisor_name: string
    zoneRows: ZoneRow[]
    idleByZone: IdleZoneRow[]
    idleEpisodeCount: number
    idleTotalMin: number
  }>
}) {
  const prepared = options.sections.map((section) => {
    const zoneTotalSec = section.zoneRows.reduce((sum, row) => sum + row.sec, 0)
    const locationRows =
      section.zoneRows.length > 0
        ? section.zoneRows
            .map((zone) =>
              zoneRowEmail(
                zone.zonaName,
                formatPercent(ratio(zone.sec, zoneTotalSec)),
                ratio(zone.sec, zoneTotalSec),
                isAlertZone(zone.zona),
              ),
            )
            .join('')
        : ''
    const idleRows =
      section.idleByZone.length > 0
        ? section.idleByZone
            .map((zone) =>
              zoneRowEmail(
                zone.zonaName,
                `${formatEpisodeCount(zone.count)} · ${zone.minutes} мин`,
                ratio(zone.minutes, section.idleTotalMin),
                false,
              ),
            )
            .join('')
        : ''
    const idleSummary =
      section.idleEpisodeCount > 0
        ? `<div style="text-align:right;">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:${COLORS.textMuted};">${options.idleSummaryLabel}</div>
            <div style="font-size:18px;font-weight:700;color:${COLORS.textH};margin-top:4px;">${formatEpisodeCount(section.idleEpisodeCount)}</div>
            <div style="font-size:13px;color:${COLORS.textMuted};margin-top:4px;">${section.idleTotalMin} мин суммарно</div>
          </div>`
        : ''

    return {
      supervisor_name: section.supervisor_name,
      locationRows,
      idleRows,
      idleSummary,
      idleEpisodeCount: section.idleEpisodeCount,
      locationHeight: estimateZonePanelEmailHeight(section.zoneRows.length, false),
      idleHeight: estimateZonePanelEmailHeight(section.idleByZone.length, section.idleEpisodeCount > 0),
    }
  })

  const maxLocationHeight = Math.max(...prepared.map((section) => section.locationHeight), 0)
  const maxIdleHeight = Math.max(...prepared.map((section) => section.idleHeight), 0)

  if (isHorizontalBrigadeLayout(prepared.length)) {
    const sectionsHtml = prepared
      .map((section) => {
        const locationPanel = zonesPanelEmail({
          kicker: 'Местоположение',
          title: 'Распределение времени по зонам',
          description: options.locationDescription,
          rowsHtml: section.locationRows,
          emptyText: `Нет данных по зонам ${options.periodLabel}.`,
        })
        const idlePanel = zonesPanelEmail({
          kicker: 'Простои',
          title: 'Длительные простои',
          description: options.idleDescription,
          summaryHtml: section.idleSummary,
          rowsHtml: section.idleRows,
          emptyText: `Данные о длительных простоях ${options.periodLabel} не загружены или простоев нет.`,
        })

        return `<div style="margin-bottom:20px;">
          <div style="font-size:15px;font-weight:700;color:${COLORS.textH};margin-bottom:12px;">${escapeHtml(section.supervisor_name)}</div>
          <div style="margin-bottom:12px;">${locationPanel}</div>
          ${idlePanel}
        </div>`
      })
      .join('')

    return `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-top:20px;">
      <tr><td>
        <h3 style="margin:0 0 8px;color:${COLORS.textH};font-size:16px;">Местоположение и простои</h3>
        <p style="margin:0 0 16px;color:${COLORS.textMuted};font-size:13px;line-height:1.45;">Где сотрудники проводили время ${options.periodLabel} и эпизоды длительного бездействия от 10 минут с привязкой к зоне.</p>
        ${sectionsHtml}
      </td></tr>
    </table>`
  }

  const columnWidth = Math.floor(100 / Math.max(prepared.length, 1))

  const headerCells = prepared
    .map(
      (section) =>
        `<td width="${columnWidth}%" valign="top" style="padding:0 6px 8px;">
          <div style="font-size:15px;font-weight:700;color:${COLORS.textH};">${escapeHtml(section.supervisor_name)}</div>
        </td>`,
    )
    .join('')

  const locationCells = prepared
    .map((section) => {
      const panel = zonesPanelEmail({
        kicker: 'Местоположение',
        title: 'Распределение времени по зонам',
        description: options.locationDescription,
        rowsHtml: section.locationRows,
        emptyText: `Нет данных по зонам ${options.periodLabel}.`,
        minHeight: maxLocationHeight,
      })
      return `<td width="${columnWidth}%" valign="top" style="padding:0 6px;">${panel}</td>`
    })
    .join('')

  const idleCells = prepared
    .map((section) => {
      const panel = zonesPanelEmail({
        kicker: 'Простои',
        title: 'Длительные простои',
        description: options.idleDescription,
        summaryHtml: section.idleSummary,
        rowsHtml: section.idleRows,
        emptyText: `Данные о длительных простоях ${options.periodLabel} не загружены или простоев нет.`,
        minHeight: maxIdleHeight,
      })
      return `<td width="${columnWidth}%" valign="top" style="padding:0 6px;">${panel}</td>`
    })
    .join('')

  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-top:20px;">
    <tr><td>
      <h3 style="margin:0 0 8px;color:${COLORS.textH};font-size:16px;">Местоположение и простои</h3>
      <p style="margin:0 0 16px;color:${COLORS.textMuted};font-size:13px;line-height:1.45;">Где сотрудники проводили время ${options.periodLabel} и эпизоды длительного бездействия от 10 минут с привязкой к зоне.</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-bottom:12px;"><tr>${headerCells}</tr></table>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-bottom:12px;"><tr>${locationCells}</tr></table>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation"><tr>${idleCells}</tr></table>
    </td></tr>
  </table>`
}

function zonesPdfPayload(options: {
  periodLabel: string
  locationDescription: string
  idleDescription: string
  idleSummaryLabel: string
  sections: Array<{
    supervisor_name: string
    zoneRows: ZoneRow[]
    idleByZone: IdleZoneRow[]
    idleEpisodeCount: number
    idleTotalMin: number
  }>
}) {
  return {
    zonesTitle: 'Местоположение и простои',
    zonesBrigadeSections: options.sections.map((section) => {
      const zoneTotalSec = section.zoneRows.reduce((sum, row) => sum + row.sec, 0)
      return {
        supervisor_name: section.supervisor_name,
        zonesPeriodLabel: options.periodLabel,
        zonesLocationDescription: options.locationDescription,
        zonesIdleDescription: options.idleDescription,
        zonesIdleSummaryLabel: options.idleSummaryLabel,
        zonesLocationRows: section.zoneRows.map((zone) => ({
          name: zone.zonaName,
          value: formatPercent(ratio(zone.sec, zoneTotalSec)),
          barPct: ratio(zone.sec, zoneTotalSec),
          alert: isAlertZone(zone.zona),
        })),
        zonesIdleSummary:
          section.idleEpisodeCount > 0
            ? { episodes: section.idleEpisodeCount, minutes: section.idleTotalMin }
            : undefined,
        zonesIdleRows: section.idleByZone.map((zone) => ({
          name: zone.zonaName,
          value: `${formatEpisodeCount(zone.count)} · ${zone.minutes} мин`,
          barPct: ratio(zone.minutes, section.idleTotalMin),
          alert: false,
        })),
      }
    }),
  }
}

async function loadKppRows(
  supabase: ReturnType<typeof getAdminClient>,
  date: string,
  minActivityPct: number,
) {
  const { data: kppData, error: kppError } = await supabase!
    .rpc('shift_daily_metrics_for_date', { p_report_date: date })
  if (kppError) throw kppError

  const rows = ((kppData ?? []) as Array<KppRow & { ww_shift_id: number }>)
    .filter((row) => Number(row.kpp_sec_total) > 0)
    .sort((left, right) => Number(right.kpp_sec_total) - Number(left.kpp_sec_total))
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

  return filterAnalyticsShiftRows(
    rows.map((row) => ({
      full_name: row.full_name,
      employee_number: row.employee_number,
      supervisor_name: row.supervisor_name,
      kpp_sec_total: row.kpp_sec_total,
      kpp_time: buildKppTimeLabel(minutesByShift.get(row.ww_shift_id) ?? []),
      work_sec_total: Number(row.work_sec_total),
      total_sec_total: Number(row.total_sec_total),
    })),
    minActivityPct,
  )
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

const EMAIL_LAYOUT_WIDTH = 720

function wrapEmailHtml(innerHtml: string) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no" />
<title>LEGENDA</title>
<style type="text/css">
  body { margin: 0 !important; padding: 0 !important; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table { border-collapse: collapse; mso-table-lspace: 0; mso-table-rspace: 0; }
  img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
  .email-scroll { overflow-x: auto !important; overflow-y: visible !important; -webkit-overflow-scrolling: touch !important; width: 100% !important; max-width: 100% !important; }
  .email-canvas { width: ${EMAIL_LAYOUT_WIDTH}px !important; min-width: ${EMAIL_LAYOUT_WIDTH}px !important; }
</style>
</head>
<body style="margin:0;padding:0;background:#eef1f6;width:100%;">
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

const EMAIL_WRAP_START = `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="font-family:'Segoe UI',Arial,Helvetica,sans-serif;background:${COLORS.page};color:${COLORS.text};width:100%;">
<tr><td align="center" style="padding:12px;">
<div class="email-scroll" style="overflow-x:auto;overflow-y:visible;-webkit-overflow-scrolling:touch;width:100%;max-width:100%;">
<table class="email-canvas" width="${EMAIL_LAYOUT_WIDTH}" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:${EMAIL_LAYOUT_WIDTH}px;min-width:${EMAIL_LAYOUT_WIDTH}px;background:${COLORS.surface};border-radius:20px;border:1px solid ${COLORS.border};border-collapse:separate;box-shadow:0 8px 24px rgba(15,27,45,0.06);">`
const EMAIL_WRAP_END = `</table>
</div>
</td></tr></table>`

function personRowHtml(name: string, meta: string, value: string, alert = false) {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-bottom:8px;border:1px solid ${COLORS.border};border-radius:14px;background:${COLORS.surface};border-collapse:separate;">
    <tr>
      <td style="padding:12px 14px;vertical-align:top;">
        <div style="font-weight:700;color:${COLORS.textH};word-break:break-word;">${name}</div>
        <div style="font-size:13px;color:${COLORS.textMuted};margin-top:4px;word-break:break-word;">${meta}</div>
        <div class="person-value" style="font-weight:700;color:${alert ? COLORS.alert : COLORS.textH};margin-top:8px;">${value}</div>
      </td>
    </tr>
  </table>`
}

const BRIGADE_SHIFT_TARGETS: Record<string, number> = {
  Джалол: 20,
  'ЛИ СОН ХАК': 23,
}

const DEFAULT_COMPARISON_BRIGADES = ['Джалол', 'ЛИ СОН ХАК']

async function loadComparisonBrigades(supabase: ReturnType<typeof getAdminClient>): Promise<string[]> {
  const { data, error } = await supabase!.rpc('get_metric_settings')
  if (error || !data || typeof data !== 'object') return DEFAULT_COMPARISON_BRIGADES
  const row = data as Record<string, unknown>
  const brigades = row.comparison_brigades
  if (!Array.isArray(brigades)) return DEFAULT_COMPARISON_BRIGADES
  const names = brigades.map((item) => String(item).trim()).filter(Boolean)
  return names.length > 0 ? names : DEFAULT_COMPARISON_BRIGADES
}

function brigadeNamesMatch(left: string, right: string) {
  return (
    left.localeCompare(right, 'ru', { sensitivity: 'accent' }) === 0 || left.toUpperCase() === right.toUpperCase()
  )
}

const NO_SUPERVISOR = 'Без начальника'

function isAnalyticsSupervisor(supervisorName: string | null | undefined) {
  if (supervisorName == null || supervisorName.trim() === '') return false
  return !brigadeNamesMatch(supervisorName, NO_SUPERVISOR)
}

function filterAnalyticsSupervisors<T extends { supervisor_name: string }>(rows: T[]) {
  return rows.filter((row) => isAnalyticsSupervisor(row.supervisor_name))
}

function filterAnalyticsShiftRows<T extends {
  supervisor_name: string | null
  work_sec_total: number
  total_sec_total: number
}>(rows: T[], minActivityPct: number) {
  return rows.filter(
    (row) =>
      isAnalyticsSupervisor(row.supervisor_name) &&
      isAnalyticsEligibleShift(row, minActivityPct),
  )
}

function formatDeltaPercent(delta: number | null) {
  if (delta == null || Number.isNaN(delta)) return '—'
  const rounded = Math.round(delta * 10) / 10
  if (rounded === 0) return '0%'
  const sign = rounded > 0 ? '+' : ''
  return `${sign}${rounded}%`
}

function parseVolumeM3(valueText: string) {
  const normalized = valueText.trim().replace(',', '.')
  const match = normalized.match(/(\d+(?:\.\d+)?)/)
  if (!match) return 0
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : 0
}

function formatVolumeM3(value: number) {
  if (value <= 0) return '—'
  const rounded = Math.round(value * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace('.', ',')
  return `${text} м³`
}

function formatVolumeDelta(delta: number | null) {
  if (delta == null || Number.isNaN(delta)) return '—'
  const rounded = Math.round(delta * 10) / 10
  if (rounded === 0) return '0 м³'
  const sign = rounded > 0 ? '+' : ''
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace('.', ',')
  return `${sign}${text} м³`
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

function metricCell(label: string, value: string, alert = false, width = '33.33%') {
  return `<td style="width:${width};vertical-align:top;padding:0;">
    <div style="padding:14px 16px;border:1px solid ${COLORS.border};border-radius:16px;background:${COLORS.surface2};height:110px;box-sizing:border-box;position:relative;overflow:hidden;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:${COLORS.textMuted};line-height:1.35;height:42px;overflow:hidden;">${label}</div>
      <div style="position:absolute;left:14px;right:14px;bottom:14px;text-align:center;font-size:24px;font-weight:700;color:${alert ? COLORS.alert : COLORS.textH};line-height:1.1;">${value}</div>
    </div>
  </td>`
}

function metricsGrid(rows: string[][]) {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:separate;border-spacing:8px;table-layout:fixed;">
    ${rows.map((row) => `<tr>${row.join('')}</tr>`).join('')}
  </table>`
}

const STRUCTURE_COLORS = {
  work: '#00d5b4',
  weak: '#f5a623',
  longIdle: '#d1495b',
  go: '#004ecf',
  track: '#e8ebf0',
}

function structureShare(part: number, total: number) {
  if (total <= 0) return 0
  return Math.round((part / total) * 1000) / 10
}

function structureBarEmail(workSec: number, weakSec: number, longIdleSec: number, goSec: number, totalSec: number) {
  if (totalSec <= 0) {
    return `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation"><tr><td style="height:16px;background:${STRUCTURE_COLORS.track};border-radius:999px;font-size:0;line-height:0;">&nbsp;</td></tr></table>`
  }

  const segments = [
    { width: structureShare(workSec, totalSec), color: STRUCTURE_COLORS.work },
    { width: structureShare(weakSec, totalSec), color: STRUCTURE_COLORS.weak },
    { width: structureShare(longIdleSec, totalSec), color: STRUCTURE_COLORS.longIdle },
    { width: structureShare(goSec, totalSec), color: STRUCTURE_COLORS.go },
  ].filter((segment) => segment.width > 0)

  const cells = segments
    .map(
      (segment) =>
        `<td width="${segment.width}%" style="background:${segment.color};height:16px;font-size:0;line-height:0;">&nbsp;</td>`,
    )
    .join('')

  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;background:${STRUCTURE_COLORS.track};border-radius:999px;overflow:hidden;"><tr>${cells}</tr></table>`
}

function structureLegendEmail() {
  const items: Array<[string, string]> = [
    [STRUCTURE_COLORS.work, 'Активность'],
    [STRUCTURE_COLORS.weak, 'Слабая активность'],
    [STRUCTURE_COLORS.longIdle, 'Длительный простой'],
    [STRUCTURE_COLORS.go, 'Ходьба между зонами'],
  ]

  const cell = ([color, label]: [string, string]) =>
    `<td width="50%" style="padding:0 4px 8px 0;vertical-align:top;">
      <table cellpadding="0" cellspacing="0" border="0" role="presentation">
        <tr>
          <td width="12" height="12" bgcolor="${color}" style="width:12px;height:12px;font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</td>
          <td style="padding:0 0 0 8px;font-size:11px;line-height:1.35;color:${COLORS.textMuted};font-family:'Segoe UI',Arial,Helvetica,sans-serif;">${label}</td>
        </tr>
      </table>
    </td>`

  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
    <tr>${cell(items[0])}${cell(items[1])}</tr>
    <tr>${cell(items[2])}${cell(items[3])}</tr>
  </table>`
}

function brigadeStatCellEmail(label: string, value: string, alert = false) {
  const background = alert ? COLORS.alertSoft : COLORS.surface2
  const border = alert ? COLORS.alertBorder : COLORS.border
  const valueColor = alert ? COLORS.alert : COLORS.textH

  return `<td width="50%" style="padding:0 5px 10px 0;vertical-align:top;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border:1px solid ${border};border-radius:16px;background:${background};border-collapse:separate;">
      <tr><td style="padding:12px;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:${COLORS.textMuted};">${label}</div>
        <div style="font-size:18px;font-weight:700;color:${valueColor};margin-top:6px;">${value}</div>
      </td></tr>
    </table>
  </td>`
}

function brigadeStatCellEmailRight(label: string, value: string) {
  return `<td width="50%" style="padding:0 0 10px 5px;vertical-align:top;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border:1px solid ${COLORS.border};border-radius:16px;background:${COLORS.surface2};border-collapse:separate;">
      <tr><td style="padding:12px;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:${COLORS.textMuted};">${label}</div>
        <div style="font-size:18px;font-weight:700;color:${COLORS.textH};margin-top:6px;">${value}</div>
      </td></tr>
    </table>
  </td>`
}

function brigadeBadgeEmail(activityPct: number) {
  const warn = activityPct < 40
  const background = warn ? COLORS.alertSoft : COLORS.brandSoft
  const color = warn ? COLORS.alert : COLORS.brand
  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" align="right">
    <tr>
      <td align="center" style="padding:8px 12px;background:${background};color:${color};font-weight:700;font-size:14px;line-height:1.2;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">${pct(activityPct)}</td>
    </tr>
  </table>`
}

function pairedCardsEmailRows(cardsHtml: string[]) {
  if (cardsHtml.length === 2) {
    return `<tr>
      <td width="50%" valign="top" style="padding:0 6px 0 0;">${cardsHtml[0]}</td>
      <td width="50%" valign="top" style="padding:0 0 0 6px;">${cardsHtml[1]}</td>
    </tr>`
  }

  return cardsHtml.map((html) => `<tr><td style="padding:0 0 12px;">${html}</td></tr>`).join('')
}

function brigadeCardsEmailLayout(cardsHtml: string[]) {
  const rows = isHorizontalBrigadeLayout(cardsHtml.length)
    ? cardsHtml.map((html) => `<tr><td style="padding:0 0 12px;">${html}</td></tr>`).join('')
    : pairedCardsEmailRows(cardsHtml)

  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">${rows}</table>`
}

function brigadeCardEmail(card: {
  supervisor_name: string
  subtitle: string
  activity_pct: number
  work_sec: number
  weak_activity_sec: number
  long_idle_sec: number
  go_sec: number
  total_sec: number
  weak_activity_pct: number
  long_idle_pct: number
  go_pct: number
  shift_duration: string
  volume_total?: string
}) {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-bottom:16px;border:1px solid ${COLORS.border};border-radius:20px;background:${COLORS.surface2};border-collapse:separate;">
    <tr><td style="padding:18px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-bottom:14px;">
        <tr>
          <td valign="middle" style="padding-right:12px;">
            <div style="font-size:16px;font-weight:700;color:${COLORS.textH};line-height:1.3;">${escapeHtml(card.supervisor_name)}</div>
            <div style="font-size:13px;color:${COLORS.textMuted};margin-top:6px;line-height:1.35;">${escapeHtml(card.subtitle)}</div>
          </td>
          <td align="right" valign="middle" width="88" style="white-space:nowrap;">${brigadeBadgeEmail(card.activity_pct)}</td>
        </tr>
      </table>
      ${structureBarEmail(card.work_sec, card.weak_activity_sec, card.long_idle_sec, card.go_sec, card.total_sec)}
      <div style="margin-top:10px;">${structureLegendEmail()}</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-top:6px;">
        <tr>
          ${brigadeStatCellEmail('Активность', pct(card.activity_pct))}
          ${brigadeStatCellEmailRight('Слабая активность', pct(card.weak_activity_pct))}
        </tr>
        <tr>
          ${brigadeStatCellEmail('Длительный простой', pct(card.long_idle_pct))}
          ${brigadeStatCellEmailRight('Ходьба между зонами', pct(card.go_pct))}
        </tr>
        <tr>
          ${brigadeStatCellEmail('Длительность смены', card.shift_duration)}
          ${card.volume_total ? brigadeStatCellEmailRight('Выполненный объём', card.volume_total) : ''}
        </tr>
      </table>
    </td></tr>
  </table>`
}

function brigadeCardPayloadDaily(row: BrigadeDailyRow) {
  return {
    supervisor_name: row.supervisor_name,
    subtitle: `${formatBrigadeShiftHeadcount(row.supervisor_name, row.workers)} на смене`,
    activity_pct: row.activity_pct,
    work_sec: row.work_sec,
    weak_activity_sec: row.weak_activity_sec,
    long_idle_sec: row.long_idle_sec,
    go_sec: row.go_sec,
    total_sec: row.total_sec,
    weak_activity_pct: row.weak_activity_pct,
    long_idle_pct: row.long_idle_pct,
    go_pct: row.go_pct,
    shift_duration: row.avg_shift_duration_sec > 0 ? formatShiftDuration(row.avg_shift_duration_sec) : '—',
  }
}

function brigadeCardPayloadWeekly(row: BrigadeWeeklyRow, weekVolumeM3: number | null) {
  return {
    supervisor_name: row.supervisor_name,
    subtitle: `≈ ${row.avg_workers} чел./день · ${row.unique_employees} уникальных`,
    activity_pct: row.activity_pct,
    work_sec: row.work_sec,
    weak_activity_sec: row.weak_activity_sec,
    long_idle_sec: row.long_idle_sec,
    go_sec: row.go_sec,
    total_sec: row.total_sec,
    weak_activity_pct: row.weak_activity_pct,
    long_idle_pct: row.long_idle_pct,
    go_pct: row.go_pct,
    shift_duration: row.avg_shift_duration_sec > 0 ? formatShiftDuration(row.avg_shift_duration_sec) : '—',
    volume_total: weekVolumeM3 != null ? formatVolumeM3(weekVolumeM3) : '—',
  }
}

function weekVolumeM3ForBrigade(cards: BrigadeVolumeDynamicsCard[], supervisorName: string) {
  const card = cards.find((row) => brigadeNamesMatch(row.supervisor_name, supervisorName))
  return card?.today_m3 ?? null
}

function sumWeekVolumeM3(cards: BrigadeVolumeDynamicsCard[]) {
  const totals = cards.map((card) => card.today_m3).filter((value): value is number => value != null)
  if (totals.length === 0) return null
  return totals.reduce((sum, value) => sum + value, 0)
}

function brigadeCardsEmailDaily(rows: BrigadeDailyRow[]) {
  return brigadeCardsEmailLayout(rows.map((row) => brigadeCardEmail(brigadeCardPayloadDaily(row))))
}

function brigadeCardsEmailWeekly(rows: BrigadeWeeklyRow[], volumeCards: BrigadeVolumeDynamicsCard[]) {
  return brigadeCardsEmailLayout(
    rows.map((row) =>
      brigadeCardEmail(brigadeCardPayloadWeekly(row, weekVolumeM3ForBrigade(volumeCards, row.supervisor_name))),
    ),
  )
}

async function loadAnalyticsMinActivityPct(supabase: ReturnType<typeof getAdminClient>) {
  const { data, error } = await supabase!.rpc('get_metric_settings')
  if (error || !data || typeof data !== 'object') return DEFAULT_ANALYTICS_MIN_ACTIVITY_PCT
  const value = Number((data as Record<string, unknown>).analytics_min_activity_pct)
  return Number.isFinite(value) ? value : DEFAULT_ANALYTICS_MIN_ACTIVITY_PCT
}

function shiftActivityPct(row: Pick<ShiftMetricRow, 'work_sec_total' | 'total_sec_total'>) {
  return row.total_sec_total > 0 ? (row.work_sec_total / row.total_sec_total) * 100 : 0
}

function isAnalyticsEligibleShift(
  row: Pick<ShiftMetricRow, 'work_sec_total' | 'total_sec_total'>,
  minActivityPct: number,
) {
  if (row.total_sec_total <= 0) return false
  return shiftActivityPct(row) >= minActivityPct
}

async function loadLowActivityPct(supabase: ReturnType<typeof getAdminClient>) {
  const { data, error } = await supabase!.rpc('get_metric_settings')
  if (error || !data || typeof data !== 'object') return DEFAULT_LOW_ACTIVITY_PCT
  const value = Number((data as Record<string, unknown>).low_activity_pct)
  return Number.isFinite(value) ? value : DEFAULT_LOW_ACTIVITY_PCT
}

async function loadShiftRowsForDate(
  supabase: ReturnType<typeof getAdminClient>,
  date: string,
  minActivityPct: number,
) {
  const { data, error } = await supabase!
    .rpc('shift_daily_metrics_for_date', { p_report_date: date })
  if (error) throw error
  return filterAnalyticsShiftRows((data ?? []) as ShiftMetricRow[], minActivityPct)
}

async function loadShiftRowsForRange(
  supabase: ReturnType<typeof getAdminClient>,
  dateStart: string,
  dateEnd: string,
  minActivityPct: number,
) {
  const { data, error } = await supabase!
    .rpc('shift_daily_metrics_for_dates', { p_date_from: dateStart, p_date_to: dateEnd })
  if (error) throw error
  return filterAnalyticsShiftRows((data ?? []) as ShiftMetricRow[], minActivityPct)
}

function filterLowActivityForReport(
  rows: AttentionRow[],
  brigadeFilter: string | undefined,
  comparisonBrigades: string[],
) {
  if (brigadeFilter) {
    return rows.filter((row) => brigadeNamesMatch(row.supervisor_name ?? NO_SUPERVISOR, brigadeFilter))
  }
  return rows.filter((row) =>
    comparisonBrigades.some((name) => brigadeNamesMatch(row.supervisor_name ?? NO_SUPERVISOR, name)),
  )
}

function filterLowActivityDaily(rows: ShiftMetricRow[], lowActivityPct: number) {
  return rows
    .filter((row) => row.total_sec_total > 0 && shiftActivityPct(row) < lowActivityPct)
    .map((row) => ({
      full_name: row.full_name,
      employee_number: row.employee_number,
      supervisor_name: row.supervisor_name,
      profession: row.profession ?? null,
      activity_pct: shiftActivityPct(row),
    }))
    .sort((left, right) => left.activity_pct - right.activity_pct)
}

function aggregateLowActivityWeekly(rows: ShiftMetricRow[], lowActivityPct: number) {
  const totals = new Map<
    string,
    {
      work_sec: number
      total_sec: number
      full_name: string
      supervisor_name: string | null
      profession: string | null
    }
  >()

  for (const row of rows) {
    const current = totals.get(row.employee_number) ?? {
      work_sec: 0,
      total_sec: 0,
      full_name: row.full_name,
      supervisor_name: row.supervisor_name,
      profession: row.profession ?? null,
    }
    current.work_sec += row.work_sec_total
    current.total_sec += row.total_sec_total
    if (!current.profession && row.profession) {
      current.profession = row.profession
    }
    totals.set(row.employee_number, current)
  }

  return [...totals.entries()]
    .map(([employee_number, row]) => ({
      employee_number,
      full_name: row.full_name,
      supervisor_name: row.supervisor_name,
      profession: row.profession,
      activity_pct: row.total_sec > 0 ? (row.work_sec / row.total_sec) * 100 : 0,
      total_sec: row.total_sec,
    }))
    .filter((row) => row.total_sec > 0 && row.activity_pct < lowActivityPct)
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
        <td align="right" style="padding:12px 14px 12px 8px;vertical-align:middle;font-weight:700;color:${COLORS.textH};">${pct(row.activity_pct)}</td>
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

function attentionBlock(rows: AttentionRow[], periodLabel: string, lowActivityPct: number) {
  if (rows.length === 0) {
    return `<div style="margin-top:16px;padding:14px 16px;background:${COLORS.surface2};border-radius:16px;color:${COLORS.textMuted};border:1px solid ${COLORS.border};">Сотрудников с активностью ниже ${lowActivityPct}% ${periodLabel} нет.</div>`
  }

  const items = rows
    .map(
      (row) =>
        personRowHtml(
          escapeHtml(row.full_name),
          `${escapeHtml(row.profession?.trim() || '—')} &#183; #${escapeHtml(row.employee_number)} &#183; ${escapeHtml(row.supervisor_name ?? 'Без начальника')}`,
          pct(row.activity_pct),
          true,
        ),
    )
    .join('')

  return `<details style="margin-top:16px;border:1px solid ${COLORS.alertBorder};border-radius:20px;background:${COLORS.alertSoft};overflow:hidden;">
    <summary style="padding:16px 20px;font-weight:700;color:${COLORS.alert};cursor:pointer;list-style:none;">
      <span style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:${COLORS.textMuted};display:block;margin-bottom:4px;">Требуют внимания</span>
      Активность ниже ${lowActivityPct}% ${periodLabel}
    </summary>
    <div style="padding:0 16px 16px;">${items}</div>
  </details>`
}

function attentionPdfSection(rows: AttentionRow[], periodLabel: string, lowActivityPct: number) {
  return {
    title: 'Требуют внимания',
    description: `Активность ниже ${lowActivityPct}% ${periodLabel}`,
    rows: rows.map((row) => ({
      name: row.full_name,
      meta: `${row.profession?.trim() || '—'} · #${row.employee_number} · ${row.supervisor_name ?? 'Без начальника'}`,
      value: pct(row.activity_pct),
    })),
    emptyText: `Сотрудников с активностью ниже ${lowActivityPct}% ${periodLabel} нет.`,
  }
}

type BrigadeDynamicsPoint = {
  report_date: string
  activity_pct: number | null
}

const ACTIVITY_DYNAMICS_SPARKLINE_DAYS = 14
const ACTIVITY_DYNAMICS_CHART_MAX = 60
const VOLUME_DYNAMICS_CHART_MAX = 200
const SPARKLINE_CHART_HEIGHT = 56
const SPARKLINE_BAR_SOFT = 'rgba(0, 78, 207, 0.35)'
const SPARKLINE_AXIS_MIN_SPAN = 10
const SPARKLINE_AXIS_PADDING_RATIO = 0.15
const SPARKLINE_AXIS_PADDING_MIN = 3

function computeSparklineAxisRange(values: number[], floor: number, ceiling: number) {
  const dataMin = Math.min(...values)
  const dataMax = Math.max(...values)
  const span = dataMax - dataMin
  const padding = Math.max(span * SPARKLINE_AXIS_PADDING_RATIO, SPARKLINE_AXIS_PADDING_MIN)

  let min = Math.floor(dataMin - padding)
  let max = Math.ceil(dataMax + padding)

  min = Math.max(floor, min)
  max = Math.min(ceiling, max)

  if (max - min < SPARKLINE_AXIS_MIN_SPAN) {
    const mid = (dataMin + dataMax) / 2
    min = Math.max(floor, Math.floor(mid - SPARKLINE_AXIS_MIN_SPAN / 2))
    max = Math.min(ceiling, Math.ceil(mid + SPARKLINE_AXIS_MIN_SPAN / 2))
  }

  return { min, max }
}

function sparklineBarHeightPx(
  value: number | null,
  axisMin: number,
  axisMax: number,
  chartHeight: number,
) {
  if (value == null) return 0
  const range = axisMax - axisMin
  if (range <= 0) return chartHeight
  const heightPct = Math.min(Math.max(((value - axisMin) / range) * 100, 0), 100)
  if (heightPct <= 0) return 0
  return Math.max(3, Math.round((heightPct / 100) * chartHeight))
}

type DynamicsSparklineEmailPoint = {
  report_date: string
  value: number | null
}

function buildDynamicsSparklineEmail(
  points: DynamicsSparklineEmailPoint[],
  options: {
    maxValue: number
    minValue?: number
    formatAxisValue?: (value: number) => string
    fewDataLabel: string
  },
) {
  const values = points.flatMap((point) => (point.value != null ? [point.value] : []))
  if (values.length < 2) {
    return `<div style="font-size:12px;color:${COLORS.textMuted};padding:8px 0;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">${options.fewDataLabel}</div>`
  }

  const formatAxisValue = options.formatAxisValue ?? String
  const minValue = options.minValue ?? 0
  const { min: axisMin, max: axisMax } = computeSparklineAxisRange(values, minValue, options.maxValue)
  const chartHeight = SPARKLINE_CHART_HEIGHT
  const referenceIndex = points.length - 1
  const columnWidth = Math.floor(100 / points.length)

  const bars = points
    .map((point, index) => {
      const isReference = index === referenceIndex
      const barHeight = sparklineBarHeightPx(point.value, axisMin, axisMax, chartHeight)
      const spacerHeight = Math.max(0, chartHeight - barHeight)
      const barColor =
        point.value == null
          ? STRUCTURE_COLORS.track
          : isReference
            ? COLORS.brand
            : SPARKLINE_BAR_SOFT

      return `<td align="center" valign="bottom" style="padding:0 3px;vertical-align:bottom;width:${columnWidth}%;">
        <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="width:100%;max-width:28px;margin:0 auto;">
          <tr><td height="${spacerHeight}" style="font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</td></tr>
          <tr><td height="${barHeight}" style="height:${barHeight}px;background-color:${barColor};border-radius:4px 4px 0 0;font-size:0;line-height:0;mso-line-height-rule:exactly;overflow:hidden;">&nbsp;</td></tr>
        </table>
        <div style="font-size:9px;line-height:1.2;color:${isReference ? COLORS.brand : COLORS.textMuted};${isReference ? 'font-weight:700;' : ''}margin-top:5px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">${ruShort(point.report_date)}</div>
      </td>`
    })
    .join('')

  const axisMaxLabel = escapeHtml(formatAxisValue(axisMax))
  const axisMinLabel = escapeHtml(formatAxisValue(axisMin))

  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%">
    <tr>
      <td width="36" valign="top" style="padding-right:8px;">
        <table cellpadding="0" cellspacing="0" border="0" role="presentation" height="${chartHeight}" style="height:${chartHeight}px;">
          <tr><td valign="top" style="font-size:9px;line-height:1;color:${COLORS.textMuted};font-family:'Segoe UI',Arial,Helvetica,sans-serif;">${axisMaxLabel}</td></tr>
          <tr><td valign="bottom" style="font-size:9px;line-height:1;color:${COLORS.textMuted};font-family:'Segoe UI',Arial,Helvetica,sans-serif;">${axisMinLabel}</td></tr>
        </table>
      </td>
      <td style="border-top:1px solid ${COLORS.border};border-bottom:1px solid ${COLORS.border};padding:0 2px;">
        <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%"><tr valign="bottom">${bars}</tr></table>
      </td>
    </tr>
  </table>`
}

type BrigadeDynamicsCard = {
  supervisor_name: string
  today_pct: number | null
  prior_pct: number | null
  delta: number | null
  sparkline?: BrigadeDynamicsPoint[]
}

function buildBrigadeSparkline(
  brigadeDaily: Array<{ report_date: string; activity_pct: number }>,
  referenceDate: string,
) {
  const sparklineStart = addDaysIso(referenceDate, -(ACTIVITY_DYNAMICS_SPARKLINE_DAYS - 1))
  const byDate = new Map(brigadeDaily.map((row) => [row.report_date, row.activity_pct]))
  return listDatesInclusive(sparklineStart, referenceDate).map((report_date) => ({
    report_date,
    activity_pct: byDate.get(report_date) ?? null,
  }))
}

function deltaColor(delta: number | null) {
  if (delta == null || delta === 0) return COLORS.textMuted
  return delta > 0 ? COLORS.work : COLORS.alert
}

function buildSparklineEmail(points: BrigadeDynamicsPoint[]) {
  return buildDynamicsSparklineEmail(
    points.map((point) => ({ report_date: point.report_date, value: point.activity_pct })),
    {
      maxValue: ACTIVITY_DYNAMICS_CHART_MAX,
      formatAxisValue: (value) => `${value}%`,
      fewDataLabel: `Мало данных за ${ACTIVITY_DYNAMICS_SPARKLINE_DAYS} дней`,
    },
  )
}

function capitalizeCompareLabel(text: string) {
  if (!text) return text
  return text.toLocaleUpperCase('ru-RU')
}

function dynamicsCardHtml(
  card: BrigadeDynamicsCard,
  options: { periodLabel: string; comparePrefix: string; emptyCompare: string; sparklineTitle?: string },
) {
  const compareText =
    card.prior_pct != null
      ? capitalizeCompareLabel(`${options.comparePrefix} (${pct(card.prior_pct)})`)
      : options.emptyCompare

  const sparkline = card.sparkline ?? []
  const sparklineSection = options.sparklineTitle
    ? `<div>
      <div style="color:${COLORS.textMuted};font-size:12px;margin-bottom:8px;">${options.sparklineTitle}</div>
      ${buildSparklineEmail(sparkline)}
    </div>`
    : ''

  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border:1px solid ${COLORS.border};border-radius:20px;background:${COLORS.surface};border-collapse:separate;">
    <tr><td style="padding:20px;">
      <div style="font-size:18px;font-weight:700;color:${COLORS.textH};margin-bottom:4px;">${escapeHtml(card.supervisor_name)}</div>
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:${COLORS.textMuted};margin-bottom:16px;">Активность</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-radius:16px;background:${COLORS.surface2};${sparklineSection ? 'margin-bottom:16px;' : ''}">
        <tr>
          <td valign="top" style="padding:16px 12px 16px 16px;">
            <div style="color:${COLORS.textMuted};font-size:12px;letter-spacing:0.06em;margin-bottom:6px;">
              <div style="text-transform:uppercase;">${options.periodLabel}</div>
              <div style="text-transform:uppercase;margin-top:4px;">${compareText}</div>
            </div>
            <div style="font-size:32px;line-height:1;font-weight:700;color:${COLORS.textH};">${card.today_pct != null ? pct(card.today_pct) : '—'}</div>
          </td>
          <td align="right" valign="top" style="padding:16px 16px 16px 12px;">
            <div style="font-weight:700;font-size:18px;color:${deltaColor(card.delta)};">${formatDeltaPercent(card.delta)}</div>
          </td>
        </tr>
      </table>
      ${sparklineSection}
    </td></tr>
  </table>`
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
  const rows = isHorizontalBrigadeLayout(cards.length)
    ? cards.map((card) => `<tr><td style="padding:0 0 12px;">${dynamicsCardHtml(card, options)}</td></tr>`).join('')
    : pairedCardsEmailRows(cards.map((card) => dynamicsCardHtml(card, options)))

  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-top:20px;">
    <tr><td>
      <h3 style="margin:0 0 12px;color:${COLORS.textH};font-size:16px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">Динамика показателей активности</h3>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">${rows}</table>
    </td></tr>
  </table>`
}

function buildVolumeSparklineEmail(points: BrigadeVolumeDynamicsPoint[]) {
  return buildDynamicsSparklineEmail(
    points.map((point) => ({ report_date: point.report_date, value: point.volume_m3 })),
    {
      maxValue: VOLUME_DYNAMICS_CHART_MAX,
      fewDataLabel: 'Мало данных за период',
    },
  )
}

function volumeDynamicsCardHtml(
  card: BrigadeVolumeDynamicsCard,
  options: { periodLabel: string; comparePrefix: string; emptyCompare: string; sparklineTitle?: string },
) {
  const compareText =
    card.prior_m3 != null
      ? capitalizeCompareLabel(`${options.comparePrefix} (${formatVolumeM3(card.prior_m3)})`)
      : options.emptyCompare

  const sparkline = card.sparkline ?? []
  const sparklineSection = options.sparklineTitle
    ? `<div>
      <div style="color:${COLORS.textMuted};font-size:12px;margin-bottom:8px;">${options.sparklineTitle}</div>
      ${buildVolumeSparklineEmail(sparkline)}
    </div>`
    : ''

  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border:1px solid ${COLORS.border};border-radius:20px;background:${COLORS.surface};border-collapse:separate;">
    <tr><td style="padding:20px;">
      <div style="font-size:18px;font-weight:700;color:${COLORS.textH};margin-bottom:4px;">${escapeHtml(card.supervisor_name)}</div>
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:${COLORS.textMuted};margin-bottom:16px;">Выполненный объём</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-radius:16px;background:${COLORS.surface2};${sparklineSection ? 'margin-bottom:16px;' : ''}">
        <tr>
          <td valign="top" style="padding:16px 12px 16px 16px;">
            <div style="color:${COLORS.textMuted};font-size:12px;letter-spacing:0.06em;margin-bottom:6px;">
              <div style="text-transform:uppercase;">${options.periodLabel}</div>
              <div style="text-transform:uppercase;margin-top:4px;">${compareText}</div>
            </div>
            <div style="font-size:32px;line-height:1;font-weight:700;color:${COLORS.textH};">${card.today_m3 != null ? formatVolumeM3(card.today_m3) : '—'}</div>
          </td>
          <td align="right" valign="top" style="padding:16px 16px 16px 12px;">
            <div style="font-weight:700;font-size:18px;color:${deltaColor(card.delta)};">${formatVolumeDelta(card.delta)}</div>
          </td>
        </tr>
      </table>
      ${sparklineSection}
    </td></tr>
  </table>`
}

function volumeDynamicsBlock(
  cards: BrigadeVolumeDynamicsCard[],
  options: {
    periodLabel: string
    comparePrefix: string
    emptyCompare: string
    sparklineTitle?: string
  },
) {
  const rows = isHorizontalBrigadeLayout(cards.length)
    ? cards.map((card) => `<tr><td style="padding:0 0 12px;">${volumeDynamicsCardHtml(card, options)}</td></tr>`).join('')
    : pairedCardsEmailRows(cards.map((card) => volumeDynamicsCardHtml(card, options)))

  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-top:20px;">
    <tr><td>
      <h3 style="margin:0 0 12px;color:${COLORS.textH};font-size:16px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">Динамика выполненных объёмов</h3>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">${rows}</table>
    </td></tr>
  </table>`
}

async function loadBrigadeActivityDynamics(
  supabase: ReturnType<typeof getAdminClient>,
  referenceDate: string,
  comparisonBrigades: string[],
) {
  const sparklineStart = addDaysIso(referenceDate, -(ACTIVITY_DYNAMICS_SPARKLINE_DAYS - 1))
  const priorDate = addDaysIso(referenceDate, -1)

  const { data, error } = await supabase!
    .rpc('brigade_daily_metrics_for_dates', {
      p_date_from: sparklineStart,
      p_date_to: referenceDate,
    })
  if (error) throw error

  const dailyRows = (data ?? []) as Array<{
    report_date: string
    supervisor_name: string
    activity_pct: number
  }>

  return comparisonBrigades.map((brigadeName) => {
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
      sparkline: buildBrigadeSparkline(brigadeDaily, referenceDate),
    } satisfies BrigadeDynamicsCard
  })
}

async function loadBrigadeWeeklyActivityDynamics(
  supabase: ReturnType<typeof getAdminClient>,
  weekStart: string,
  weekEnd: string,
  comparisonBrigades: string[],
) {
  const priorWeekStart = addDaysIso(weekStart, -7)
  const priorWeekEnd = addDaysIso(priorWeekStart, 6)
  const weekDates = listDatesInclusive(weekStart, weekEnd)

  const { data: dailyData, error: dailyError } = await supabase!
    .rpc('brigade_daily_metrics_for_dates', { p_date_from: priorWeekStart, p_date_to: weekEnd })
  if (dailyError) throw dailyError

  const dailyRows = (dailyData ?? []) as Array<{
    report_date: string
    supervisor_name: string
    activity_pct: number
    work_sec: number
    total_sec: number
  }>

  return comparisonBrigades.map((brigadeName) => {
    const brigadeDaily = dailyRows.filter((row) => brigadeNamesMatch(row.supervisor_name, brigadeName))
    const weekPct = weeklyActivityPctFromDaily(dailyRows, weekStart, weekEnd, brigadeName)
    const priorPct = weeklyActivityPctFromDaily(dailyRows, priorWeekStart, priorWeekEnd, brigadeName)
    const dailyByDate = new Map(brigadeDaily.map((row) => [row.report_date, row.activity_pct]))

    return {
      supervisor_name: brigadeName,
      today_pct: weekPct,
      prior_pct: priorPct,
      delta: weekPct != null && priorPct != null ? weekPct - priorPct : null,
      sparkline: weekDates.map((date) => ({
        report_date: date,
        activity_pct: dailyByDate.get(date) ?? 0,
      })),
    } satisfies BrigadeDynamicsCard
  })
}

type BrigadeVolumeDynamicsPoint = {
  report_date: string
  volume_m3: number | null
}

type BrigadeVolumeDynamicsCard = {
  supervisor_name: string
  today_m3: number | null
  prior_m3: number | null
  delta: number | null
  sparkline?: BrigadeVolumeDynamicsPoint[]
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
  const dailyTotals = dates
    .map((date) => sumBrigadeVolumeM3(rows, brigadeName, date))
    .filter((value): value is number => value != null)
  if (dailyTotals.length === 0) return null
  return dailyTotals.reduce((sum, value) => sum + value, 0)
}

async function loadBrigadeWeeklyVolumeDynamics(
  supabase: ReturnType<typeof getAdminClient>,
  weekStart: string,
  weekEnd: string,
  comparisonBrigades: string[],
) {
  const priorWeekStart = addDaysIso(weekStart, -7)
  const priorWeekEnd = addDaysIso(weekStart, -1)
  const weekDates = listDatesInclusive(weekStart, weekEnd)
  const priorWeekDates = listDatesInclusive(priorWeekStart, priorWeekEnd)

  const { data, error } = await supabase!
    .from('volume_entries')
    .select('report_date, label, value_text')
    .gte('report_date', priorWeekStart)
    .lte('report_date', weekEnd)
    .order('report_date', { ascending: true })
  if (error) throw error

  const rows = (data ?? []).map((row) => ({
    report_date: String(row.report_date).slice(0, 10),
    label: row.label,
    value_text: row.value_text,
  }))

  return comparisonBrigades.map((brigadeName) => {
    const brigadeRows = rows.filter((row) => brigadeNamesMatch(row.label, brigadeName))
    const weekM3 = sumBrigadeVolumeForDates(brigadeRows, brigadeName, weekDates)
    const priorM3 = sumBrigadeVolumeForDates(brigadeRows, brigadeName, priorWeekDates)
    const dailyByDate = new Map(
      weekDates.map((date) => [date, sumBrigadeVolumeM3(brigadeRows, brigadeName, date)] as const),
    )

    return {
      supervisor_name: brigadeName,
      today_m3: weekM3,
      prior_m3: priorM3,
      delta: weekM3 != null && priorM3 != null ? weekM3 - priorM3 : null,
      sparkline: weekDates.map((report_date) => ({
        report_date,
        volume_m3: dailyByDate.get(report_date) ?? null,
      })),
    } satisfies BrigadeVolumeDynamicsCard
  })
}

function dynamicsPdfCards(
  cards: BrigadeDynamicsCard[],
  options: { comparePrefix: string; emptyCompare: string },
  sparklineTitle?: string,
) {
  return cards.map((card) => ({
    name: card.supervisor_name,
    value: card.today_pct != null ? pct(card.today_pct) : '—',
    delta: formatDeltaPercent(card.delta),
    compare:
      card.prior_pct != null
        ? capitalizeCompareLabel(`${options.comparePrefix} (${pct(card.prior_pct)})`)
        : options.emptyCompare,
    sparkline: (card.sparkline ?? []).map((point) => ({
      label: ruShort(point.report_date),
      value: point.activity_pct ?? 0,
      empty: point.activity_pct == null,
    })),
    sparklineTitle,
  }))
}

function volumeDynamicsPdfCards(
  cards: BrigadeVolumeDynamicsCard[],
  options: { comparePrefix: string; emptyCompare: string },
  sparklineTitle?: string,
) {
  return cards.map((card) => ({
    name: card.supervisor_name,
    value: card.today_m3 != null ? formatVolumeM3(card.today_m3) : '—',
    delta: formatVolumeDelta(card.delta),
    compare:
      card.prior_m3 != null
        ? capitalizeCompareLabel(`${options.comparePrefix} (${formatVolumeM3(card.prior_m3)})`)
        : options.emptyCompare,
    sparkline: (card.sparkline ?? []).map((point) => ({
      label: ruShort(point.report_date),
      value: point.volume_m3 ?? 0,
      empty: point.volume_m3 == null,
    })),
    sparklineTitle,
  }))
}

function personPdfRows(rows: Array<{ full_name: string; employee_number?: string; supervisor_name?: string | null; activity_pct?: number; kpp_time?: string }>, mode: 'activity' | 'kpp') {
  return rows.map((row) => ({
    name: row.full_name,
    meta:
      mode === 'kpp'
        ? `#${row.employee_number ?? '—'} · ${row.supervisor_name ?? 'Без начальника'}`
        : `#${row.employee_number ?? '—'} · ${row.supervisor_name ?? 'Без начальника'}`,
    value: mode === 'kpp' ? (row.kpp_time ?? '—') : pct(row.activity_pct ?? 0),
  }))
}

function dailyPdfFilename(date: string) {
  return `legenda-daily-${date}.pdf`
}

function weeklyPdfFilename(weekStart: string) {
  return `legenda-weekly-${weekStart}.pdf`
}

function kppBlock(rows: KppRow[]) {
  if (rows.length === 0) {
    return `<div style="margin-top:16px;padding:14px 16px;background:${COLORS.surface2};border-radius:16px;color:${COLORS.textMuted};border:1px solid ${COLORS.border};">На КПП никого не фиксировалось.</div>`
  }

  const items = rows
    .map(
      (row) =>
        personRowHtml(
          escapeHtml(row.full_name),
          `#${escapeHtml(row.employee_number)} &#183; ${escapeHtml(row.supervisor_name ?? 'Без начальника')}`,
          escapeHtml(row.kpp_time),
        ),
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

function filterRowsByBrigade<T extends { supervisor_name: string }>(rows: T[], brigadeFilter?: string) {
  const analyticsRows = filterAnalyticsSupervisors(rows)
  if (!brigadeFilter) return analyticsRows
  return analyticsRows.filter((row) => brigadeNamesMatch(row.supervisor_name, brigadeFilter))
}

function brigadeReportLabel(brigadeFilter?: string) {
  if (!brigadeFilter) return ''
  return ` — бригада ${brigadeFilter}`
}

async function buildDailyHtml(
  supabase: ReturnType<typeof getAdminClient>,
  date: string,
  options: ReportBuildOptions = {},
) {
  const { brigadeFilter } = options
  const blocks = await loadBlockVisibility(supabase)
  const comparisonBrigades = await loadComparisonBrigades(supabase)
  const zoneVisibility = await loadZoneVisibility(supabase)
  const { data: brigadesData, error: brigadesError } = await supabase!
    .rpc('brigade_daily_metrics_for_date', { p_report_date: date })
  if (brigadesError) throw brigadesError
  let brigades = filterRowsByBrigade((brigadesData ?? []) as BrigadeDailyRow[], brigadeFilter)
    .sort((left, right) => left.supervisor_name.localeCompare(right.supervisor_name, 'ru'))
  if (!brigadeFilter) {
    brigades = brigades.filter((row) =>
      comparisonBrigades.some((name) => brigadeNamesMatch(row.supervisor_name, name)),
    )
  }

  const dynamics = blocks.block3
    ? filterRowsByBrigade(await loadBrigadeActivityDynamics(supabase, date, comparisonBrigades), brigadeFilter)
    : []
  const zoneRowsByBrigade = blocks.block4 ? await loadZoneRowsByBrigade(supabase, date, date, zoneVisibility) : new Map<string, ZoneRow[]>()
  const idleEpisodes = blocks.block4
    ? filterRowsByBrigade(await loadIdleEpisodes(supabase, date, date, zoneVisibility), brigadeFilter)
    : []
  const idleByZoneByBrigade = aggregateIdleByZoneByBrigade(idleEpisodes)
  const zoneSections = blocks.block4
    ? brigades.map((brigade) => {
        const idleByZone = idleByZoneByBrigade.get(brigade.supervisor_name) ?? []
        return {
          supervisor_name: brigade.supervisor_name,
          zoneRows: visibleReportZoneRows(zoneRowsByBrigade.get(brigade.supervisor_name) ?? [], zoneVisibility),
          idleByZone,
          idleEpisodeCount: idleByZone.reduce((sum, row) => sum + row.count, 0),
          idleTotalMin: idleByZone.reduce((sum, row) => sum + row.minutes, 0),
        }
      })
    : []

  const totals = brigades.reduce(
    (acc, row) => {
      acc.workers += row.workers
      acc.work_sec += row.work_sec
      acc.weak_activity_sec += row.weak_activity_sec
      acc.long_idle_sec += row.long_idle_sec
      acc.go_sec += row.go_sec
      acc.total_sec += row.total_sec
      return acc
    },
    { workers: 0, work_sec: 0, weak_activity_sec: 0, long_idle_sec: 0, go_sec: 0, total_sec: 0 },
  )
  const activity = totals.total_sec > 0 ? (totals.work_sec / totals.total_sec) * 100 : 0
  const weakActivity = totals.total_sec > 0 ? (totals.weak_activity_sec / totals.total_sec) * 100 : 0
  const longIdle = totals.total_sec > 0 ? (totals.long_idle_sec / totals.total_sec) * 100 : 0
  const go = totals.total_sec > 0 ? (totals.go_sec / totals.total_sec) * 100 : 0

  const brigadeLabel = brigadeReportLabel(brigadeFilter)
  const brigadeSectionTitle = brigadeFilter ? `Бригада ${brigadeFilter}` : 'По бригадам'

  const minActivityPct = await loadAnalyticsMinActivityPct(supabase)
  const lowActivityPct = await loadLowActivityPct(supabase)
  const shiftRows = await loadShiftRowsForDate(supabase, date, minActivityPct)
  const lowActivityRows = filterLowActivityForReport(
    filterLowActivityDaily(shiftRows, lowActivityPct),
    brigadeFilter,
    comparisonBrigades,
  )

  const htmlParts: string[] = []
  if (blocks.block1) {
    htmlParts.push(
      metricsGrid([
        [
          metricCell(
            'Вышло на смену',
            brigadeFilter ? formatBrigadeShiftHeadcount(brigadeFilter, totals.workers) : formatShiftHeadcount(totals.workers),
            false,
            '20%',
          ),
          metricCell('Активность', pct(activity), false, '20%'),
          metricCell('Слабая активность', pct(weakActivity), false, '20%'),
          metricCell('Длительный простой', pct(longIdle), false, '20%'),
          metricCell('Ходьба между зонами', pct(go), false, '20%'),
        ],
      ]),
      `<h3 style="margin:28px 0 14px;color:${COLORS.textH};font-size:16px;">${brigadeSectionTitle}</h3>`,
      brigadeCardsEmailDaily(brigades),
      attentionBlock(lowActivityRows, 'за день', lowActivityPct),
    )
  }
  if (blocks.block3) {
    htmlParts.push(
      activityDynamicsBlock(dynamics, {
        periodLabel: 'За день',
        comparePrefix: 'к вчера',
        emptyCompare: 'нет данных за вчера',
        sparklineTitle: `${ACTIVITY_DYNAMICS_SPARKLINE_DAYS} дней до ${ru(date)}`,
      }),
    )
  }
  if (blocks.block4) {
    htmlParts.push(
      zonesBlockEmail({
        periodLabel: 'за день',
        locationDescription: 'Где сотрудники проводили время за день.',
        idleDescription: 'Эпизоды бездействия от 10 минут с привязкой к зоне.',
        idleSummaryLabel: 'Всего за день',
        sections: zoneSections,
      }),
    )
  }

  const html = `${EMAIL_WRAP_START}
    ${emailBrandingHeader(COLORS, REPORT_ESSENCE_DAILY, `Смена за ${ru(date)}${brigadeLabel}`)}
    <tr><td style="padding:8px 24px 24px;">
      ${htmlParts.join('')}
    </td></tr>
  ${EMAIL_WRAP_END}`

  const pdfPayload: ReportPdfPayload = {
    title: 'Ежедневный отчёт',
    reportEssence: REPORT_ESSENCE_DAILY,
    reportObjectName: REPORT_OBJECT_NAME,
    subtitle: `Смена за ${ru(date)}${brigadeLabel}`,
    singlePage: true,
  }

  if (blocks.block1) {
    pdfPayload.metrics = [
      {
        label: 'Вышло на смену',
        value: brigadeFilter ? formatBrigadeShiftHeadcount(brigadeFilter, totals.workers) : formatShiftHeadcount(totals.workers),
      },
      { label: 'Активность', value: pct(activity) },
      { label: 'Слабая активность', value: pct(weakActivity) },
      { label: 'Длительный простой', value: pct(longIdle) },
      { label: 'Ходьба между зонами', value: pct(go) },
    ]
    pdfPayload.metricsColumns = 5
    pdfPayload.brigadeSectionTitle = brigadeSectionTitle
    pdfPayload.brigadeCards = brigades.map(brigadeCardPayloadDaily)
    pdfPayload.attentionSection = attentionPdfSection(lowActivityRows, 'за день', lowActivityPct)
  }
  if (blocks.block3) {
    pdfPayload.dynamicsTitle = 'Динамика показателей активности'
    pdfPayload.dynamicsPeriodLabel = 'За день'
    pdfPayload.dynamicsCards = dynamicsPdfCards(
      dynamics,
      {
        comparePrefix: 'к вчера',
        emptyCompare: 'нет данных за вчера',
      },
      `${ACTIVITY_DYNAMICS_SPARKLINE_DAYS} дней до ${ru(date)}`,
    )
  }
  if (blocks.block4) {
    Object.assign(
      pdfPayload,
      zonesPdfPayload({
        periodLabel: 'за день',
        locationDescription: 'Где сотрудники проводили время за день.',
        idleDescription: 'Эпизоды бездействия от 10 минут с привязкой к зоне.',
        idleSummaryLabel: 'Всего за день',
        sections: zoneSections,
      }),
    )
  }

  const subject = `Ежедневный отчёт Legenda — ${ruShort(date)}${brigadeLabel}`
  return {
    html,
    subject,
    periodKey: date,
    hasData: brigades.length > 0,
    pdfPayload,
    pdfFilename: brigadeFilter ? `legenda-daily-${date}-${brigadeFilter.replace(/\s+/g, '-').toLowerCase()}.pdf` : dailyPdfFilename(date),
  }
}

async function buildWeeklyHtml(
  supabase: ReturnType<typeof getAdminClient>,
  weekStart: string,
  options: ReportBuildOptions = {},
) {
  const { brigadeFilter } = options
  const blocks = await loadBlockVisibility(supabase)
  const comparisonBrigades = await loadComparisonBrigades(supabase)
  const zoneVisibility = await loadZoneVisibility(supabase)
  const weekEnd = addDaysIso(weekStart, 6)
  const { data: dailyData, error } = await supabase!
    .rpc('brigade_daily_metrics_for_dates', { p_date_from: weekStart, p_date_to: weekEnd })
  if (error) throw error
  const minActivityPct = await loadAnalyticsMinActivityPct(supabase)
  const lowActivityPct = await loadLowActivityPct(supabase)
  const weeklyShiftRows = await loadShiftRowsForRange(supabase, weekStart, weekEnd, minActivityPct)
  let brigades = filterRowsByBrigade(
    enrichWeeklyUniqueEmployees(
      aggregateBrigadeDailyToWeekly(weekStart, weekEnd, (dailyData ?? []) as BrigadeDailyRow[]),
      weeklyShiftRows,
    ),
    brigadeFilter,
  )
  if (!brigadeFilter) {
    brigades = brigades.filter((row) =>
      comparisonBrigades.some((name) => brigadeNamesMatch(row.supervisor_name, name)),
    )
  }
  const weekEndResolved = brigades[0]?.week_end ?? weekEnd

  const dynamics = blocks.block3
    ? filterRowsByBrigade(
        await loadBrigadeWeeklyActivityDynamics(supabase, weekStart, weekEndResolved, comparisonBrigades),
        brigadeFilter,
      )
    : []
  const volumeDynamics = blocks.block5
    ? filterRowsByBrigade(
        await loadBrigadeWeeklyVolumeDynamics(supabase, weekStart, weekEndResolved, comparisonBrigades),
        brigadeFilter,
      )
    : []
  const zoneRowsByBrigade = blocks.block4
    ? await loadZoneRowsByBrigade(supabase, weekStart, weekEndResolved, zoneVisibility)
    : new Map<string, ZoneRow[]>()
  const idleEpisodes = blocks.block4
    ? filterRowsByBrigade(await loadIdleEpisodes(supabase, weekStart, weekEndResolved, zoneVisibility), brigadeFilter)
    : []
  const idleByZoneByBrigade = aggregateIdleByZoneByBrigade(idleEpisodes)
  const zoneSections = blocks.block4
    ? brigades.map((brigade) => {
        const idleByZone = idleByZoneByBrigade.get(brigade.supervisor_name) ?? []
        return {
          supervisor_name: brigade.supervisor_name,
          zoneRows: visibleReportZoneRows(zoneRowsByBrigade.get(brigade.supervisor_name) ?? [], zoneVisibility),
          idleByZone,
          idleEpisodeCount: idleByZone.reduce((sum, row) => sum + row.count, 0),
          idleTotalMin: idleByZone.reduce((sum, row) => sum + row.minutes, 0),
        }
      })
    : []

  const totals = brigades.reduce(
    (acc, row) => {
      acc.work_sec += row.work_sec
      acc.weak_activity_sec += row.weak_activity_sec
      acc.long_idle_sec += row.long_idle_sec
      acc.go_sec += row.go_sec
      acc.total_sec += row.total_sec
      return acc
    },
    { work_sec: 0, weak_activity_sec: 0, long_idle_sec: 0, go_sec: 0, total_sec: 0 },
  )
  const activity = totals.total_sec > 0 ? (totals.work_sec / totals.total_sec) * 100 : 0
  const weakActivity = totals.total_sec > 0 ? (totals.weak_activity_sec / totals.total_sec) * 100 : 0
  const longIdle = totals.total_sec > 0 ? (totals.long_idle_sec / totals.total_sec) * 100 : 0
  const go = totals.total_sec > 0 ? (totals.go_sec / totals.total_sec) * 100 : 0
  const totalWeekVolume = blocks.block5 ? sumWeekVolumeM3(volumeDynamics) : null

  const brigadeLabel = brigadeReportLabel(brigadeFilter)
  const brigadeSectionTitle = brigadeFilter ? `Бригада ${brigadeFilter}` : 'По бригадам за неделю'

  const lowActivityRows = filterLowActivityForReport(
    aggregateLowActivityWeekly(weeklyShiftRows, lowActivityPct),
    brigadeFilter,
    comparisonBrigades,
  )

  const htmlParts: string[] = []
  if (blocks.block2) {
    const metricCells = [
      metricCell('Активность', pct(activity), false, blocks.block5 ? '20%' : '25%'),
      metricCell('Слабая активность', pct(weakActivity), false, blocks.block5 ? '20%' : '25%'),
      metricCell('Длительный простой', pct(longIdle), false, blocks.block5 ? '20%' : '25%'),
      metricCell('Ходьба между зонами', pct(go), false, blocks.block5 ? '20%' : '25%'),
    ]
    if (blocks.block5) {
      metricCells.push(
        metricCell(
          'Выполненный объём',
          totalWeekVolume != null ? formatVolumeM3(totalWeekVolume) : '—',
          false,
          '20%',
        ),
      )
    }
    htmlParts.push(
      metricsGrid([metricCells]),
      `<h3 style="margin:28px 0 14px;color:${COLORS.textH};font-size:16px;">${brigadeSectionTitle}</h3>`,
      brigadeCardsEmailWeekly(brigades, blocks.block5 ? volumeDynamics : []),
      attentionBlock(lowActivityRows, 'за неделю', lowActivityPct),
    )
  }
  if (blocks.block3) {
    htmlParts.push(
      activityDynamicsBlock(dynamics, {
        periodLabel: 'За неделю',
        comparePrefix: 'к прошлой недели',
        emptyCompare: 'нет данных за прошлую неделю',
        sparklineTitle: `Дни недели ${ruShort(weekStart)} — ${ruShort(weekEnd)}`,
      }),
    )
  }
  if (blocks.block5) {
    htmlParts.push(
      volumeDynamicsBlock(volumeDynamics, {
        periodLabel: 'За неделю',
        comparePrefix: 'к прошлой недели',
        emptyCompare: 'нет данных за прошлую неделю',
        sparklineTitle: `Дни недели ${ruShort(weekStart)} — ${ruShort(weekEnd)}`,
      }),
    )
  }
  if (blocks.block4) {
    htmlParts.push(
      zonesBlockEmail({
        periodLabel: 'за неделю',
        locationDescription: 'Где сотрудники проводили время за неделю.',
        idleDescription: 'Эпизоды бездействия от 10 минут за неделю с привязкой к зоне.',
        idleSummaryLabel: 'Всего за неделю',
        sections: zoneSections,
      }),
    )
  }

  const html = `${EMAIL_WRAP_START}
    ${emailBrandingHeader(COLORS, REPORT_ESSENCE_WEEKLY, `Неделя ${ruShort(weekStart)} — ${ruShort(weekEnd)}${brigadeLabel}`)}
    <tr><td style="padding:8px 24px 24px;">
      ${htmlParts.join('')}
    </td></tr>
  ${EMAIL_WRAP_END}`

  const pdfPayload: ReportPdfPayload = {
    title: 'Еженедельный отчёт',
    reportEssence: REPORT_ESSENCE_WEEKLY,
    reportObjectName: REPORT_OBJECT_NAME,
    subtitle: `Неделя ${ruShort(weekStart)} — ${ruShort(weekEnd)}${brigadeLabel}`,
    singlePage: true,
  }

  if (blocks.block2) {
    const metrics = [
      { label: 'Активность', value: pct(activity) },
      { label: 'Слабая активность', value: pct(weakActivity) },
      { label: 'Длительный простой', value: pct(longIdle) },
      { label: 'Ходьба между зонами', value: pct(go) },
    ]
    if (blocks.block5) {
      metrics.push({
        label: 'Выполненный объём',
        value: totalWeekVolume != null ? formatVolumeM3(totalWeekVolume) : '—',
      })
    }
    pdfPayload.metrics = metrics
    pdfPayload.metricsColumns = metrics.length
    pdfPayload.brigadeSectionTitle = brigadeSectionTitle
    pdfPayload.brigadeCards = brigades.map((row) =>
      brigadeCardPayloadWeekly(
        row,
        blocks.block5 ? weekVolumeM3ForBrigade(volumeDynamics, row.supervisor_name) : null,
      ),
    )
    pdfPayload.attentionSection = attentionPdfSection(lowActivityRows, 'за неделю', lowActivityPct)
  }
  if (blocks.block3) {
    pdfPayload.dynamicsTitle = 'Динамика показателей активности'
    pdfPayload.dynamicsPeriodLabel = 'За неделю'
    pdfPayload.dynamicsCards = dynamicsPdfCards(
      dynamics,
      {
        comparePrefix: 'к прошлой недели',
        emptyCompare: 'нет данных за прошлую неделю',
      },
      `Дни недели ${ruShort(weekStart)} — ${ruShort(weekEnd)}`,
    )
  }
  if (blocks.block5) {
    pdfPayload.volumeDynamicsTitle = 'Динамика выполненных объёмов'
    pdfPayload.volumeDynamicsPeriodLabel = 'За неделю'
    pdfPayload.volumeDynamicsCards = volumeDynamicsPdfCards(
      volumeDynamics,
      {
        comparePrefix: 'к прошлой недели',
        emptyCompare: 'нет данных за прошлую неделю',
      },
      `Дни недели ${ruShort(weekStart)} — ${ruShort(weekEnd)}`,
    )
  }
  if (blocks.block4) {
    Object.assign(
      pdfPayload,
      zonesPdfPayload({
        periodLabel: 'за неделю',
        locationDescription: 'Где сотрудники проводили время за неделю.',
        idleDescription: 'Эпизоды бездействия от 10 минут за неделю с привязкой к зоне.',
        idleSummaryLabel: 'Всего за неделю',
        sections: zoneSections,
      }),
    )
  }

  const subject = `Еженедельный отчёт Legenda — неделя ${ruShort(weekStart)}${brigadeLabel}`
  return {
    html,
    subject,
    periodKey: weekStart,
    hasData: brigades.length > 0,
    pdfPayload,
    pdfFilename: brigadeFilter
      ? `legenda-weekly-${weekStart}-${brigadeFilter.replace(/\s+/g, '-').toLowerCase()}.pdf`
      : weeklyPdfFilename(weekStart),
  }
}

async function listRecipients(
  supabase: ReturnType<typeof getAdminClient>,
  audience?: ReportAudience,
  brigadeName?: string | null,
) {
  let query = supabase!
    .from('email_recipients')
    .select('id, email, label, daily, weekly, active, audience, brigade_name')
    .order('email', { ascending: true })

  if (audience) query = query.eq('audience', audience)
  if (audience === 'foremen' && brigadeName) query = query.eq('brigade_name', brigadeName)

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

async function replaceRecipients(
  supabase: ReturnType<typeof getAdminClient>,
  recipients: Recipient[],
  audience: ReportAudience,
  brigadeName: string | null,
) {
  if (audience === 'foremen' && !brigadeName) {
    throw new Error('Для рассылки бригадирам нужно указать бригаду')
  }

  const cleaned = recipients
    .map((row) => ({
      email: String(row.email ?? '').trim().toLowerCase(),
      label: row.label ? String(row.label).trim() : null,
      daily: row.daily !== false,
      weekly: row.weekly !== false,
      active: row.active !== false,
      audience,
      brigade_name: audience === 'foremen' ? brigadeName : null,
    }))
    .filter((row) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email))

  let deleteQuery = supabase!.from('email_recipients').delete().eq('audience', audience)
  if (audience === 'foremen') {
    deleteQuery = deleteQuery.eq('brigade_name', brigadeName)
  } else {
    deleteQuery = deleteQuery.is('brigade_name', null)
  }
  const { error: deleteError } = await deleteQuery
  if (deleteError) throw deleteError

  if (cleaned.length > 0) {
    const { error: insertError } = await supabase!.from('email_recipients').insert(cleaned)
    if (insertError) throw insertError
  }

  return listRecipients(supabase, audience, brigadeName)
}

type SendBatch = {
  audience: ReportAudience
  brigadeName: string | null
  recipients: string[]
}

function filterSendBatches(
  batches: SendBatch[],
  audience?: ReportAudience,
  brigadeName?: string,
): SendBatch[] {
  if (!audience) return batches

  return batches.filter((batch) => {
    if (batch.audience !== audience) return false
    if (audience === 'foremen' && brigadeName) {
      return batch.brigadeName != null && brigadeNamesMatch(batch.brigadeName, brigadeName)
    }
    return true
  })
}

function buildSendBatches(recipients: Recipient[], type: ReportType): SendBatch[] {
  const active = recipients.filter((row) => row.active && (type === 'daily' ? row.daily : row.weekly))
  const batches: SendBatch[] = []

  const managerEmails = active.filter((row) => (row.audience ?? 'managers') === 'managers').map((row) => row.email)
  if (managerEmails.length > 0) {
    batches.push({ audience: 'managers', brigadeName: null, recipients: managerEmails })
  }

  for (const brigadeName of [
    ...new Set(
      active
        .filter((row) => row.audience === 'foremen' && row.brigade_name)
        .map((row) => row.brigade_name as string),
    ),
  ]) {
    const emails = active
      .filter(
        (row) =>
          row.audience === 'foremen' &&
          row.brigade_name &&
          brigadeNamesMatch(row.brigade_name, brigadeName),
      )
      .map((row) => row.email)
    if (emails.length > 0) {
      batches.push({ audience: 'foremen', brigadeName, recipients: emails })
    }
  }

  return batches
}

async function wasReportAlreadySent(
  supabase: ReturnType<typeof getAdminClient>,
  type: ReportType,
  periodKey: string,
  audience: ReportAudience,
  brigadeName: string | null,
) {
  let query = supabase!
    .from('email_log')
    .select('id')
    .eq('report_type', type)
    .eq('period_key', periodKey)
    .eq('status', 'sent')
    .eq('audience', audience)

  query = brigadeName ? query.eq('brigade_name', brigadeName) : query.is('brigade_name', null)

  const { data } = await query.limit(1).maybeSingle()
  return Boolean(data)
}

/**
 * Защита ручной отправки от дублей: тот же отчёт за тот же период уже ушёл только что.
 * У ручной отправки нет проверки `wasReportAlreadySent` (чтобы можно было переслать письмо),
 * поэтому два обращения подряд давали два одинаковых письма. Окно короткое — осознанный
 * повтор через пару минут по-прежнему возможен, а флаг `force` снимает проверку сразу.
 */
async function wasReportSentRecently(
  supabase: ReturnType<typeof getAdminClient>,
  type: ReportType,
  periodKey: string,
  audience: ReportAudience,
  brigadeName: string | null,
  withinMinutes: number,
) {
  const since = new Date(Date.now() - withinMinutes * 60_000).toISOString()

  let query = supabase!
    .from('email_log')
    .select('id')
    .eq('report_type', type)
    .eq('period_key', periodKey)
    .eq('status', 'sent')
    .eq('audience', audience)
    .gte('created_at', since)

  query = brigadeName ? query.eq('brigade_name', brigadeName) : query.is('brigade_name', null)

  const { data } = await query.limit(1).maybeSingle()
  return Boolean(data)
}

async function sendReportBatch(
  supabase: ReturnType<typeof getAdminClient>,
  type: ReportType,
  periodKey: string,
  batch: SendBatch,
  buildOptions: { date?: string; weekStart?: string },
  triggeredBy: string,
) {
  const report =
    type === 'daily'
      ? await buildDailyHtml(
          supabase,
          buildOptions.date ?? yesterdayMoscowIso(),
          batch.audience === 'foremen' && batch.brigadeName ? { brigadeFilter: batch.brigadeName } : {},
        )
      : await buildWeeklyHtml(
          supabase,
          buildOptions.weekStart ?? previousWeekStartIso(),
          batch.audience === 'foremen' && batch.brigadeName ? { brigadeFilter: batch.brigadeName } : {},
        )

  if (!report.hasData) {
    return { skipped: true as const, reason: 'no_data', recipients: batch.recipients, periodKey: report.periodKey }
  }

  let pdfAttachment: { filename: string; content: Uint8Array } | undefined
  let pdfAttached = false
  let pdfError: string | null = null

  try {
    const { renderReportPdf } = await import('./pdf.ts')
    const pdfBytes = await renderReportPdf(report.pdfPayload)
    if (pdfBytes.byteLength < 100) {
      throw new Error(`PDF слишком маленький (${pdfBytes.byteLength} байт)`)
    }
    pdfAttachment = { filename: report.pdfFilename, content: pdfBytes }
    pdfAttached = true
  } catch (error) {
    pdfError = getErrorMessage(error)
    console.error('PDF generation failed:', pdfError)
    throw new Error(`Письмо не отправлено: не удалось создать PDF (${pdfError})`)
  }

  await sendEmails(report.subject, report.html, batch.recipients, pdfAttachment)
  await supabase!.from('email_log').insert({
    report_type: type,
    period_key: report.periodKey,
    recipients: batch.recipients,
    status: 'sent',
    audience: batch.audience,
    brigade_name: batch.brigadeName,
    triggered_by: triggeredBy,
    error_message: pdfAttached ? null : pdfError ? `PDF не создан: ${pdfError}` : null,
  })

  return {
    skipped: false as const,
    recipients: batch.recipients,
    periodKey: report.periodKey,
    pdfAttached,
    pdfError,
  }
}

async function sendEmails(
  subject: string,
  html: string,
  recipients: string[],
  pdfAttachment?: { filename: string; content: Uint8Array },
) {
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
        attachments: [
          ...(pdfAttachment
            ? [
                {
                  filename: pdfAttachment.filename,
                  content: Buffer.from(pdfAttachment.content),
                  contentType: 'application/pdf',
                  contentDisposition: 'attachment',
                },
              ]
            : []),
        ],
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
      const audienceParam = url.searchParams.get('audience')
      const brigadeName = url.searchParams.get('brigade_name')
      const audience =
        audienceParam === 'managers' || audienceParam === 'foremen' ? (audienceParam as ReportAudience) : undefined

      if (request.method === 'GET') {
        return jsonResponse({ recipients: await listRecipients(supabase, audience, brigadeName) })
      }
      if (request.method === 'PUT') {
        const payload = (await request.json().catch(() => null)) as {
          recipients?: Recipient[]
          audience?: ReportAudience
          brigade_name?: string | null
        } | null
        if (!Array.isArray(payload?.recipients)) {
          return jsonResponse({ error: 'Ожидается массив recipients' }, 400)
        }
        const saveAudience = payload?.audience ?? audience
        if (saveAudience !== 'managers' && saveAudience !== 'foremen') {
          return jsonResponse({ error: 'audience должен быть managers или foremen' }, 400)
        }
        const saveBrigadeName = saveAudience === 'foremen' ? payload?.brigade_name ?? brigadeName ?? null : null
        if (saveAudience === 'foremen' && !saveBrigadeName) {
          return jsonResponse({ error: 'Для бригадиров нужно указать brigade_name' }, 400)
        }
        return jsonResponse({
          recipients: await replaceRecipients(supabase, payload!.recipients, saveAudience, saveBrigadeName),
        })
      }
      return jsonResponse({ error: 'Method not allowed' }, 405)
    }

    if (resource === 'schedule') {
      if (request.method === 'GET') {
        const { data, error } = await supabase.rpc('get_report_schedule')
        if (error) return jsonResponse({ error: error.message }, 500)
        return jsonResponse({ schedule: data })
      }
      if (request.method === 'PUT') {
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
        if (!body) return jsonResponse({ error: 'Ожидается объект расписания' }, 400)
        const invalid = validateSchedulePayload(body)
        if (invalid) return jsonResponse({ error: invalid }, 400)
        const { data, error } = await supabase.rpc('set_report_schedule', { p: body })
        if (error) return jsonResponse({ error: error.message }, 500)
        return jsonResponse({ schedule: data })
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
      audience?: ReportAudience
      brigadeName?: string
      force?: boolean
    } | null

    const type = payload?.type
    if (type !== 'daily' && type !== 'weekly') {
      return jsonResponse({ error: 'type должен быть daily или weekly' }, 400)
    }

    const date = payload?.date?.trim() || yesterdayMoscowIso()
    const weekStart = payload?.weekStart?.trim() || previousWeekStartIso()
    const previewAudience = payload?.audience
    const previewBrigadeName = payload?.brigadeName?.trim() || undefined

    if (payload?.preview) {
      const report =
        type === 'daily'
          ? await buildDailyHtml(
              supabase,
              date,
              previewAudience === 'foremen' && previewBrigadeName ? { brigadeFilter: previewBrigadeName } : {},
            )
          : await buildWeeklyHtml(
              supabase,
              weekStart,
              previewAudience === 'foremen' && previewBrigadeName ? { brigadeFilter: previewBrigadeName } : {},
            )

      return jsonResponse({
        ok: true,
        reportType: type,
        periodKey: report.periodKey,
        recipients: [],
        previewHtml: wrapEmailHtml(emailHtmlForPreview(report.html)),
      })
    }

    const triggeredBy = request.headers.get('x-triggered-by') ?? 'manual'
    const nowMin = getMoscowMinutesNow()

    if (triggeredBy === 'schedule') {
      const schedule = await loadReportSchedule(supabase)
      const scheduledMin =
        type === 'daily'
          ? (schedule?.daily_hour ?? 8) * 60 + (schedule?.daily_minute ?? 0)
          : (schedule?.weekly_hour ?? 8) * 60 + (schedule?.weekly_minute ?? 0)

      if (nowMin < scheduledMin - SCHEDULE_WINDOW_BEFORE_MIN || nowMin > scheduledMin + SCHEDULE_WINDOW_AFTER_MIN) {
        return jsonResponse({
          ok: true,
          skipped: true,
          reason: 'outside_send_window',
          reportType: type,
          periodKey: type === 'daily' ? date : weekStart,
        })
      }
    } else if (triggeredBy === 'post-import') {
      if (nowMin > POST_IMPORT_DEADLINE_MIN) {
        return jsonResponse({
          ok: true,
          skipped: true,
          reason: 'after_post_import_deadline',
          reportType: type,
          periodKey: type === 'daily' ? date : weekStart,
        })
      }
    }

    const manualAudience =
      triggeredBy !== 'schedule' &&
      triggeredBy !== 'post-import' &&
      (payload?.audience === 'managers' || payload?.audience === 'foremen')
        ? payload.audience
        : undefined
    const manualBrigadeName = manualAudience === 'foremen' ? payload?.brigadeName?.trim() || undefined : undefined
    if (manualAudience === 'foremen' && !manualBrigadeName) {
      return jsonResponse({ error: 'Для рассылки бригадирам нужно указать brigadeName' }, 400)
    }

    const allRecipients = await listRecipients(supabase)
    const batches = filterSendBatches(buildSendBatches(allRecipients, type), manualAudience, manualBrigadeName)

    if (batches.length === 0) {
      return jsonResponse({
        ok: true,
        reportType: type,
        periodKey: type === 'daily' ? date : weekStart,
        recipients: [],
      })
    }

    const sentRecipients: string[] = []
    const skippedRecently: string[] = []
    let pdfAttached: boolean | undefined
    let pdfError: string | null | undefined
    let periodKey = type === 'daily' ? date : weekStart
    const isScheduled = triggeredBy === 'schedule' || triggeredBy === 'post-import'

    for (const batch of batches) {
      if (isScheduled) {
        const alreadySent = await wasReportAlreadySent(supabase, type, periodKey, batch.audience, batch.brigadeName)
        if (alreadySent) continue
      } else if (!payload?.force) {
        // Ручная отправка: отсекаем дубль, если этот же отчёт ушёл минуту-две назад.
        const justSent = await wasReportSentRecently(
          supabase,
          type,
          periodKey,
          batch.audience,
          batch.brigadeName,
          MANUAL_DEDUP_WINDOW_MIN,
        )
        if (justSent) {
          skippedRecently.push(...batch.recipients)
          continue
        }
      }

      try {
        const result = await sendReportBatch(
          supabase,
          type,
          periodKey,
          batch,
          { date, weekStart },
          triggeredBy,
        )
        periodKey = result.periodKey
        if (!result.skipped) {
          sentRecipients.push(...result.recipients)
          pdfAttached = result.pdfAttached
          pdfError = result.pdfError
        }
      } catch (sendError) {
        await supabase.from('email_log').insert({
          report_type: type,
          period_key: periodKey,
          recipients: batch.recipients,
          status: 'failed',
          audience: batch.audience,
          brigade_name: batch.brigadeName,
          error_message: getErrorMessage(sendError),
          triggered_by: triggeredBy,
        })
        throw sendError
      }
    }

    return jsonResponse({
      ok: true,
      reportType: type,
      periodKey,
      recipients: sentRecipients,
      pdfAttached,
      pdfError,
      // Ничего не ушло только потому, что этот отчёт отправлен пару минут назад —
      // фронт по этому признаку предлагает отправить повторно принудительно.
      ...(sentRecipients.length === 0 && skippedRecently.length > 0
        ? {
            skipped: true,
            reason: 'recently_sent',
            skippedRecipients: skippedRecently,
            dedupWindowMin: MANUAL_DEDUP_WINDOW_MIN,
          }
        : {}),
    })
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, 500)
  }
})
