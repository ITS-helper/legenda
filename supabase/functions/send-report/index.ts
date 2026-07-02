import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

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
  idle_sec: number
  total_sec: number
  kpp_sec: number
  kpp_workers: number
  activity_pct: number
  idle_pct: number
}

type BrigadeWeeklyRow = {
  week_start: string
  week_end: string
  supervisor_name: string
  days: number
  unique_employees: number
  avg_workers: number
  work_sec: number
  idle_sec: number
  total_sec: number
  kpp_sec: number
  kpp_shifts: number
  activity_pct: number
  idle_pct: number
}

type KppRow = {
  full_name: string
  employee_number: string
  supervisor_name: string | null
  kpp_sec_total: number
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-settings-password',
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
    return { ok: false, response: jsonResponse({ error: 'Invalid settings password' }, 401) }
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

function formatMinutes(totalSeconds: number) {
  return `${Math.round(Math.max(0, totalSeconds) / 60)} мин`
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

const EMAIL_WRAP_START = `<div style="font-family:Arial,Helvetica,sans-serif;background:#f4f6f5;padding:24px;color:#1c2b26;">
<div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8e4;">`
const EMAIL_WRAP_END = `<div style="padding:16px 24px;background:#0d211c;color:#9eb6ae;font-size:12px;">Legenda Analytics — автоматический отчёт</div></div></div>`

function metricCell(label: string, value: string, alert = false) {
  return `<td style="padding:12px 14px;border:1px solid #e2e8e4;border-radius:12px;">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#7a8f88;">${label}</div>
    <div style="font-size:20px;font-weight:700;color:${alert ? '#c0392b' : '#12332a'};margin-top:4px;">${value}</div>
  </td>`
}

function brigadeTableDaily(rows: BrigadeDailyRow[]) {
  const body = rows
    .map(
      (row) => `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #eef2f0;font-weight:600;">${escapeHtml(row.supervisor_name)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eef2f0;text-align:center;">${row.workers}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eef2f0;text-align:center;">${pct(row.activity_pct)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eef2f0;text-align:center;">${pct(row.idle_pct)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eef2f0;text-align:center;color:${row.kpp_workers > 0 ? '#c0392b' : '#12332a'};">${row.kpp_workers > 0 ? `${row.kpp_workers} (${formatMinutes(row.kpp_sec)})` : '—'}</td>
    </tr>`,
    )
    .join('')

  return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:8px;">
    <thead><tr style="background:#f0f5f2;color:#3f554d;text-align:left;">
      <th style="padding:10px 12px;">Бригада</th>
      <th style="padding:10px 12px;text-align:center;">Вышло</th>
      <th style="padding:10px 12px;text-align:center;">Активность</th>
      <th style="padding:10px 12px;text-align:center;">Простой</th>
      <th style="padding:10px 12px;text-align:center;">КПП</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`
}

function brigadeTableWeekly(rows: BrigadeWeeklyRow[]) {
  const body = rows
    .map(
      (row) => `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #eef2f0;font-weight:600;">${escapeHtml(row.supervisor_name)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eef2f0;text-align:center;">${row.avg_workers}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eef2f0;text-align:center;">${row.unique_employees}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eef2f0;text-align:center;">${pct(row.activity_pct)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eef2f0;text-align:center;">${pct(row.idle_pct)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eef2f0;text-align:center;color:${row.kpp_shifts > 0 ? '#c0392b' : '#12332a'};">${row.kpp_shifts > 0 ? row.kpp_shifts : '—'}</td>
    </tr>`,
    )
    .join('')

  return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:8px;">
    <thead><tr style="background:#f0f5f2;color:#3f554d;text-align:left;">
      <th style="padding:10px 12px;">Бригада</th>
      <th style="padding:10px 12px;text-align:center;">Чел./день</th>
      <th style="padding:10px 12px;text-align:center;">Уникальных</th>
      <th style="padding:10px 12px;text-align:center;">Активность</th>
      <th style="padding:10px 12px;text-align:center;">Простой</th>
      <th style="padding:10px 12px;text-align:center;">Смены КПП</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`
}

function kppBlock(rows: KppRow[]) {
  if (rows.length === 0) {
    return `<div style="margin-top:16px;padding:14px 16px;background:#eefaf3;border-radius:12px;color:#2f6b52;">На КПП (зона 13) никто не фиксировался.</div>`
  }

  const items = rows
    .map(
      (row) => `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f6d9d5;">${escapeHtml(row.full_name)} <span style="color:#8a9a94;">#${escapeHtml(row.employee_number)}</span></td>
      <td style="padding:8px 12px;border-bottom:1px solid #f6d9d5;">${escapeHtml(row.supervisor_name ?? 'Без начальника')}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f6d9d5;text-align:right;font-weight:700;color:#c0392b;">${formatMinutes(row.kpp_sec_total)}</td>
    </tr>`,
    )
    .join('')

  return `<div style="margin-top:16px;padding:16px;background:#fdecea;border-radius:12px;border:1px solid #f3c4bd;">
    <div style="font-weight:700;color:#c0392b;margin-bottom:8px;">⚠ На КПП зафиксированы сотрудники (${rows.length})</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">${items}</table>
  </div>`
}

async function buildDailyHtml(supabase: ReturnType<typeof getAdminClient>, date: string) {
  const { data: brigadesData, error: brigadesError } = await supabase!
    .from('brigade_daily_metrics')
    .select('*')
    .eq('report_date', date)
    .order('supervisor_name', { ascending: true })
  if (brigadesError) throw brigadesError
  const brigades = (brigadesData ?? []) as BrigadeDailyRow[]

  const { data: kppData, error: kppError } = await supabase!
    .from('shift_daily_metrics')
    .select('full_name, employee_number, supervisor_name, kpp_sec_total')
    .eq('report_date', date)
    .gt('kpp_sec_total', 0)
    .order('kpp_sec_total', { ascending: false })
  if (kppError) throw kppError
  const kpp = (kppData ?? []) as KppRow[]

  const totals = brigades.reduce(
    (acc, row) => {
      acc.workers += row.workers
      acc.work_sec += row.work_sec
      acc.idle_sec += row.idle_sec
      acc.total_sec += row.total_sec
      acc.kpp_workers += row.kpp_workers
      return acc
    },
    { workers: 0, work_sec: 0, idle_sec: 0, total_sec: 0, kpp_workers: 0 },
  )
  const activity = totals.total_sec > 0 ? (totals.work_sec / totals.total_sec) * 100 : 0
  const idle = totals.total_sec > 0 ? (totals.idle_sec / totals.total_sec) * 100 : 0

  const html = `${EMAIL_WRAP_START}
    <div style="padding:24px 24px 8px;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.12em;color:#7fbca0;">Ежедневный отчёт</div>
      <h1 style="margin:6px 0 0;font-size:22px;color:#12332a;">Смена за ${ru(date)}</h1>
    </div>
    <div style="padding:8px 24px;">
      <table style="width:100%;border-collapse:separate;border-spacing:8px;">
        <tr>
          ${metricCell('Вышло на смену', String(totals.workers))}
          ${metricCell('Активность', pct(activity))}
          ${metricCell('Простой', pct(idle))}
          ${metricCell('Были на КПП', String(totals.kpp_workers), totals.kpp_workers > 0)}
        </tr>
      </table>
      <h3 style="margin:20px 0 0;color:#12332a;">По бригадам</h3>
      ${brigadeTableDaily(brigades)}
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

  const totals = brigades.reduce(
    (acc, row) => {
      acc.work_sec += row.work_sec
      acc.idle_sec += row.idle_sec
      acc.total_sec += row.total_sec
      acc.kpp_shifts += row.kpp_shifts
      return acc
    },
    { work_sec: 0, idle_sec: 0, total_sec: 0, kpp_shifts: 0 },
  )
  const activity = totals.total_sec > 0 ? (totals.work_sec / totals.total_sec) * 100 : 0
  const idle = totals.total_sec > 0 ? (totals.idle_sec / totals.total_sec) * 100 : 0

  const html = `${EMAIL_WRAP_START}
    <div style="padding:24px 24px 8px;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.12em;color:#7fbca0;">Еженедельный отчёт</div>
      <h1 style="margin:6px 0 0;font-size:22px;color:#12332a;">Неделя ${ruShort(weekStart)} — ${ruShort(weekEnd)}</h1>
    </div>
    <div style="padding:8px 24px;">
      <table style="width:100%;border-collapse:separate;border-spacing:8px;">
        <tr>
          ${metricCell('Активность', pct(activity))}
          ${metricCell('Простой', pct(idle))}
          ${metricCell('Смены на КПП', String(totals.kpp_shifts), totals.kpp_shifts > 0)}
        </tr>
      </table>
      <h3 style="margin:20px 0 0;color:#12332a;">По бригадам за неделю</h3>
      ${brigadeTableWeekly(brigades)}
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

  const client = new SMTPClient({
    connection: {
      hostname,
      port,
      tls: useTls,
      auth: { username, password },
    },
  })

  try {
    for (const to of recipients) {
      await client.send({ from, to, subject, html, content: 'text/html' })
    }
  } finally {
    await client.close()
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
        previewHtml: report.html,
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
