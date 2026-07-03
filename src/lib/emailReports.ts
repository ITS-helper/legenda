import {
  formatEdgeFunctionError,
  getEdgeFunctionHeaders,
  getEdgeFunctionUrl,
  readEdgeFunctionJson,
} from './edgeFunctions'

export type ReportType = 'daily' | 'weekly'

export type EmailRecipient = {
  id?: number
  email: string
  label: string | null
  daily: boolean
  weekly: boolean
  active: boolean
}

export type SendReportResult = {
  ok: true
  reportType: ReportType
  periodKey: string
  recipients: string[]
  previewHtml?: string
}

type RecipientsResponse = {
  recipients?: EmailRecipient[]
}

type SendResponse = {
  ok?: boolean
  reportType?: ReportType
  periodKey?: string
  recipients?: string[]
  previewHtml?: string
}

function withResource(url: string, resource: string) {
  const next = new URL(url)
  next.searchParams.set('resource', resource)
  return next.toString()
}

export async function loadRecipients(password: string) {
  const response = await fetch(withResource(getEdgeFunctionUrl('send-report'), 'recipients'), {
    method: 'GET',
    headers: getEdgeFunctionHeaders(password),
  })

  const payload = await readEdgeFunctionJson<RecipientsResponse>(response)
  return payload?.recipients ?? []
}

export async function saveRecipients(password: string, recipients: EmailRecipient[]) {
  let response: Response
  try {
    response = await fetch(withResource(getEdgeFunctionUrl('send-report'), 'recipients'), {
      method: 'PUT',
      headers: getEdgeFunctionHeaders(password, true),
      body: JSON.stringify({ recipients }),
    })
  } catch {
    throw new Error('Не удалось связаться с сервером (сеть или CORS). Обновите страницу и попробуйте снова.')
  }

  const payload = await readEdgeFunctionJson<RecipientsResponse>(response)
  return payload?.recipients ?? []
}

type SendReportOptions = {
  type: ReportType
  password: string
  date?: string
  weekStart?: string
  preview?: boolean
}

export async function sendReport(options: SendReportOptions) {
  const response = await fetch(getEdgeFunctionUrl('send-report'), {
    method: 'POST',
    headers: getEdgeFunctionHeaders(options.password, true),
    body: JSON.stringify({
      type: options.type,
      date: options.date,
      weekStart: options.weekStart,
      preview: options.preview ?? false,
    }),
  })

  const payload = await readEdgeFunctionJson<SendResponse>(response)
  if (!payload?.ok) {
    throw new Error(formatEdgeFunctionError('Не удалось отправить отчёт'))
  }

  return payload as SendReportResult
}
