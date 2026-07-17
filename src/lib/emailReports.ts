import {
  formatEdgeFunctionError,
  getEdgeFunctionHeaders,
  getEdgeFunctionUrl,
  readEdgeFunctionJson,
} from './edgeFunctions'

export type ReportType = 'daily' | 'weekly'
export type ReportAudience = 'managers' | 'foremen'

export type EmailRecipient = {
  id?: number
  email: string
  label: string | null
  daily: boolean
  weekly: boolean
  active: boolean
  audience?: ReportAudience
  brigade_name?: string | null
}

export type SendReportResult = {
  ok: true
  reportType: ReportType
  periodKey: string
  recipients: string[]
  previewHtml?: string
  pdfAttached?: boolean
  pdfError?: string | null
  /** Отправка отменена: этот же отчёт ушёл несколько минут назад (снимается флагом force). */
  skipped?: boolean
  reason?: 'recently_sent'
  skippedRecipients?: string[]
  dedupWindowMin?: number
}

export type ReportSchedule = {
  daily_enabled: boolean
  daily_hour: number
  daily_minute: number
  weekly_enabled: boolean
  weekly_dow: number
  weekly_hour: number
  weekly_minute: number
}

type RecipientsResponse = {
  recipients?: EmailRecipient[]
}

type ScheduleResponse = {
  schedule?: ReportSchedule
}

type SendResponse = {
  ok?: boolean
  reportType?: ReportType
  periodKey?: string
  recipients?: string[]
  previewHtml?: string
  pdfAttached?: boolean
  pdfError?: string | null
  skipped?: boolean
  reason?: 'recently_sent'
  skippedRecipients?: string[]
  dedupWindowMin?: number
}

function withResource(url: string, resource: string, params?: Record<string, string | undefined>) {
  const next = new URL(url)
  next.searchParams.set('resource', resource)
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value) next.searchParams.set(key, value)
  }
  return next.toString()
}

type RecipientQuery = {
  audience?: ReportAudience
  brigadeName?: string
}

export async function loadRecipients(password: string, query: RecipientQuery = {}) {
  const response = await fetch(
    withResource(getEdgeFunctionUrl('send-report'), 'recipients', {
      audience: query.audience,
      brigade_name: query.brigadeName,
    }),
    {
      method: 'GET',
      headers: getEdgeFunctionHeaders(password),
    },
  )

  const payload = await readEdgeFunctionJson<RecipientsResponse>(response)
  return payload?.recipients ?? []
}

export async function saveRecipients(
  password: string,
  recipients: EmailRecipient[],
  query: { audience: ReportAudience; brigadeName?: string },
) {
  let response: Response
  try {
    response = await fetch(withResource(getEdgeFunctionUrl('send-report'), 'recipients'), {
      method: 'PUT',
      headers: getEdgeFunctionHeaders(password, true),
      body: JSON.stringify({
        recipients,
        audience: query.audience,
        brigade_name: query.audience === 'foremen' ? query.brigadeName ?? null : null,
      }),
    })
  } catch {
    throw new Error('Не удалось связаться с сервером (сеть или CORS). Обновите страницу и попробуйте снова.')
  }

  const payload = await readEdgeFunctionJson<RecipientsResponse>(response)
  return payload?.recipients ?? []
}

export async function loadSchedule(password: string) {
  const response = await fetch(withResource(getEdgeFunctionUrl('send-report'), 'schedule'), {
    method: 'GET',
    headers: getEdgeFunctionHeaders(password),
  })

  const payload = await readEdgeFunctionJson<ScheduleResponse>(response)
  return payload?.schedule ?? null
}

export async function saveSchedule(password: string, schedule: ReportSchedule) {
  let response: Response
  try {
    response = await fetch(withResource(getEdgeFunctionUrl('send-report'), 'schedule'), {
      method: 'PUT',
      headers: getEdgeFunctionHeaders(password, true),
      body: JSON.stringify(schedule),
    })
  } catch {
    throw new Error('Не удалось связаться с сервером (сеть или CORS). Обновите страницу и попробуйте снова.')
  }

  const payload = await readEdgeFunctionJson<ScheduleResponse>(response)
  return payload?.schedule ?? null
}

type SendReportOptions = {
  type: ReportType
  password: string
  date?: string
  weekStart?: string
  preview?: boolean
  audience?: ReportAudience
  brigadeName?: string
  /** Отправить, даже если такой же отчёт уже уходил пару минут назад. */
  force?: boolean
}

export async function sendReport(options: SendReportOptions) {
  let response: Response
  try {
    response = await fetch(getEdgeFunctionUrl('send-report'), {
      method: 'POST',
      headers: getEdgeFunctionHeaders(options.password, true),
      body: JSON.stringify({
        type: options.type,
        date: options.date,
        weekStart: options.weekStart,
        preview: options.preview ?? false,
        audience: options.audience,
        brigadeName: options.brigadeName,
        force: options.force ?? false,
      }),
    })
  } catch {
    throw new Error('Не удалось связаться с сервером (сеть, CORS или таймаут). Проверьте деплой send-report и попробуйте снова.')
  }

  const payload = await readEdgeFunctionJson<SendResponse>(response)
  if (!payload?.ok) {
    throw new Error(formatEdgeFunctionError('Не удалось отправить отчёт'))
  }

  return payload as SendReportResult
}
