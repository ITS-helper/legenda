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
  error?: string
}

type SendResponse = {
  ok?: boolean
  reportType?: ReportType
  periodKey?: string
  recipients?: string[]
  previewHtml?: string
  error?: string
}

function getFunctionUrl(functionName: string) {
  return new URL(`/functions/v1/${functionName}`, import.meta.env.VITE_SUPABASE_URL).toString()
}

function withResource(url: string, resource: string) {
  const next = new URL(url)
  next.searchParams.set('resource', resource)
  return next.toString()
}

export async function loadRecipients(password: string) {
  const response = await fetch(withResource(getFunctionUrl('send-report'), 'recipients'), {
    method: 'GET',
    headers: { 'x-settings-password': password.trim() },
  })

  const payload = (await response.json().catch(() => null)) as RecipientsResponse | null
  if (!response.ok) {
    throw new Error(payload?.error ?? `HTTP ${response.status}`)
  }

  return payload?.recipients ?? []
}

export async function saveRecipients(password: string, recipients: EmailRecipient[]) {
  const response = await fetch(withResource(getFunctionUrl('send-report'), 'recipients'), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-settings-password': password.trim(),
    },
    body: JSON.stringify({ recipients }),
  })

  const payload = (await response.json().catch(() => null)) as RecipientsResponse | null
  if (!response.ok) {
    throw new Error(payload?.error ?? `HTTP ${response.status}`)
  }

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
  const response = await fetch(getFunctionUrl('send-report'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-settings-password': options.password.trim(),
    },
    body: JSON.stringify({
      type: options.type,
      date: options.date,
      weekStart: options.weekStart,
      preview: options.preview ?? false,
    }),
  })

  const payload = (await response.json().catch(() => null)) as SendResponse | null
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error ?? `HTTP ${response.status}`)
  }

  return payload as SendReportResult
}
