// Локальный предпросмотр блока «Активность и выработка по неделям» из PDF еженедельного отчёта.
// Данные берутся из Supabase тем же способом, что и в edge function send-report,
// отрисовка — настоящим рендерером supabase/functions/send-report/pdf.ts.
//
// Запуск: npm run preview:report-chart [-- 2026-07-13]
// Результат: preview/weekly-output-activity.pdf
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { trimEmptyOutputActivityWeeks } from '../supabase/functions/send-report/outputActivityChart.ts'
import { renderReportPdf } from '../supabase/functions/send-report/pdf.ts'

dotenv.config({ path: '.env.local' })

const MAX_WEEKS = 26
const COLORS = {
  page: '#eef1f6',
  surface: '#ffffff',
  surface2: '#f5f7fb',
  text: '#33404f',
  textH: '#0f1b2d',
  textMuted: '#6b7a8d',
  kicker: '#8a97a8',
  brand: '#004ecf',
  border: 'rgba(15, 27, 45, 0.1)',
  alert: '#d1495b',
  work: '#00d5b4',
}

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: 'analytics' },
})

function addDaysIso(dateIso, days) {
  const date = new Date(`${dateIso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function weekStartIso(dateIso) {
  const date = new Date(`${dateIso}T00:00:00Z`)
  const day = date.getUTCDay()
  date.setUTCDate(date.getUTCDate() + ((day === 0 ? -6 : 1) - day))
  return date.toISOString().slice(0, 10)
}

function listDatesInclusive(startIso, endIso) {
  const dates = []
  for (let current = startIso; current <= endIso; current = addDaysIso(current, 1)) dates.push(current)
  return dates
}

function ruShort(dateIso) {
  return `${dateIso.slice(8)}.${dateIso.slice(5, 7)}`
}

function normalizeName(value) {
  return String(value ?? '').trim().toLocaleLowerCase('ru-RU')
}

function brigadeNamesMatch(left, right) {
  return normalizeName(left) === normalizeName(right)
}

function parseVolumeM3(valueText) {
  const match = String(valueText ?? '').replace(',', '.').match(/-?\d+(\.\d+)?/)
  return match ? Number(match[0]) : 0
}

function sumVolumeForDates(rows, brigadeName, dates) {
  const totals = dates
    .map((date) =>
      rows
        .filter((row) => row.report_date === date && brigadeNamesMatch(row.label, brigadeName))
        .reduce((sum, row) => sum + parseVolumeM3(row.value_text), 0),
    )
    .filter((value) => value > 0)
  return totals.length ? totals.reduce((sum, value) => sum + value, 0) : null
}

/** Активность по неделям: лёгкий RPC, а если миграция ещё не применена — понедельный расчёт. */
async function loadWeeklyActivity(weeks, searchFrom, searchTo) {
  const rpc = await supabase.rpc('brigade_weekly_activity', {
    p_date_from: searchFrom,
    p_date_to: searchTo,
  })
  if (!rpc.error) {
    console.log('активность: RPC brigade_weekly_activity')
    return (rpc.data ?? []).map((row) => ({
      week_start: String(row.week_start).slice(0, 10),
      supervisor_name: row.supervisor_name,
      activity_pct: row.activity_pct != null ? Number(row.activity_pct) : null,
      total_sec: Number(row.total_sec) || 0,
    }))
  }

  console.log(`активность: fallback по неделям (${rpc.error.message})`)
  const rows = []
  for (const { week_start, week_end } of weeks) {
    const { data, error } = await supabase.rpc('brigade_daily_metrics_for_dates', {
      p_date_from: week_start,
      p_date_to: week_end,
    })
    if (error) throw error
    const byBrigade = new Map()
    for (const row of data ?? []) {
      const key = row.supervisor_name
      const acc = byBrigade.get(key) ?? { work_sec: 0, total_sec: 0 }
      acc.work_sec += Number(row.work_sec) || 0
      acc.total_sec += Number(row.total_sec) || 0
      byBrigade.set(key, acc)
    }
    for (const [supervisor_name, acc] of byBrigade) {
      rows.push({
        week_start,
        supervisor_name,
        activity_pct: acc.total_sec > 0 ? Math.round((1000 * acc.work_sec) / acc.total_sec) / 10 : null,
        total_sec: acc.total_sec,
      })
    }
    console.log(`  неделя ${week_start} готова`)
  }
  return rows
}

const weekStartArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'))
const weekStart = weekStartArg ?? weekStartIso(addDaysIso(new Date().toISOString().slice(0, 10), -7))
const weekEnd = addDaysIso(weekStart, 6)
const searchFrom = addDaysIso(weekStart, -7 * (MAX_WEEKS - 1))

const [volumeResult, headcountResult] = await Promise.all([
  supabase
    .from('volume_entries')
    .select('report_date, label, value_text')
    .gte('report_date', searchFrom)
    .lte('report_date', weekEnd),
  supabase.rpc('brigade_daily_headcount', { p_date_from: searchFrom, p_date_to: weekEnd }),
])
if (volumeResult.error) throw volumeResult.error
if (headcountResult.error) throw headcountResult.error

const volumeRows = (volumeResult.data ?? []).map((row) => ({
  report_date: String(row.report_date).slice(0, 10),
  label: row.label,
  value_text: row.value_text,
}))
const headcountRows = (headcountResult.data ?? []).map((row) => ({
  report_date: String(row.report_date).slice(0, 10),
  supervisor_name: row.supervisor_name,
  workers: Number(row.workers) || 0,
}))

const firstDataDate = headcountRows
  .map((row) => row.report_date)
  .concat(volumeRows.map((row) => row.report_date))
  .sort()[0]
if (!firstDataDate) throw new Error('Нет данных за период')

const weeks = []
for (let week = weekStartIso(firstDataDate); week <= weekStart; week = addDaysIso(week, 7)) {
  weeks.push({ week_start: week, week_end: addDaysIso(week, 6) })
}
const trimmedWeeks = weeks.slice(-MAX_WEEKS)
console.log(`недель с начала проекта: ${trimmedWeeks.length} (${trimmedWeeks[0].week_start} — ${weekEnd})`)

// Понедельный fallback тянется минутами, поэтому кэшируем результат до `--refresh`.
const cacheFile = 'preview/activity-cache.json'
const cacheKey = `${trimmedWeeks[0].week_start}_${weekEnd}`
const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {}
let activityRows = process.argv.includes('--refresh') ? null : cache[cacheKey]
if (activityRows) {
  console.log('активность: из кэша preview/activity-cache.json')
} else {
  activityRows = await loadWeeklyActivity(trimmedWeeks, searchFrom, weekEnd)
  mkdirSync('preview', { recursive: true })
  writeFileSync(cacheFile, JSON.stringify({ ...cache, [cacheKey]: activityRows }), 'utf8')
}

const brigades = [...new Set(headcountRows.map((row) => row.supervisor_name))].filter(
  (name) => normalizeName(name) !== 'без начальника',
)
console.log('бригадиры:', brigades.join(', '))

const cards = brigades.map((brigadeName) => ({
  supervisor_name: brigadeName,
  points: trimmedWeeks.map(({ week_start, week_end }) => {
    const activityRow = activityRows.find(
      (row) => row.week_start === week_start && brigadeNamesMatch(row.supervisor_name, brigadeName),
    )
    const weekDates = listDatesInclusive(week_start, week_end)
    const volume = sumVolumeForDates(volumeRows, brigadeName, weekDates)
    const brigadeDaily = headcountRows.filter(
      (row) =>
        row.report_date >= week_start &&
        row.report_date <= week_end &&
        row.workers > 0 &&
        brigadeNamesMatch(row.supervisor_name, brigadeName),
    )
    const days = new Set(brigadeDaily.map((row) => row.report_date)).size
    const avgWorkers = days > 0 ? brigadeDaily.reduce((sum, row) => sum + row.workers, 0) / days : null
    const perWorker = volume != null && avgWorkers ? volume / avgWorkers : null
    return {
      week_start,
      week_end,
      activity_pct:
        activityRow && activityRow.total_sec > 0 && activityRow.activity_pct != null
          ? activityRow.activity_pct
          : null,
      per_worker_m3: perWorker != null ? Math.round(perWorker * 10) / 10 : null,
    }
  }),
}))

const outputActivityCards = trimEmptyOutputActivityWeeks(cards)
  .filter((card) => card.points.some((point) => point.activity_pct != null || point.per_worker_m3 != null))
  .map((card) => ({ name: card.supervisor_name, points: card.points }))
if (outputActivityCards.length === 0) throw new Error('Нет активности и выработки за период')

// Минимальный weekly-payload: только заголовок и наш блок, остальные секции пустые.
const pdfBytes = await renderReportPdf({
  title: 'Еженедельный отчёт',
  reportEssence: 'Еженедельный отчёт по интенсивности работы',
  reportObjectName: 'Легенда Васильевского, корпус 2',
  subtitle: `Неделя ${ruShort(weekStart)} - ${ruShort(weekEnd)} (предпросмотр блока)`,
  weeklyLayout: true,
  singlePage: true,
  metrics: [],
  brigadeSectionTitle: '',
  brigadeCards: [],
  dynamicsTitle: '',
  dynamicsPeriodLabel: 'За неделю',
  dynamicsCards: [],
  outputActivityTitle: 'Активность и выработка по неделям',
  outputActivityCards,
  zonesTitle: '',
  zonesBrigadeSections: [],
})

mkdirSync('preview', { recursive: true })
writeFileSync('preview/weekly-output-activity.pdf', pdfBytes)
console.log('готово: preview/weekly-output-activity.pdf')
