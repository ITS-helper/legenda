import { defaultUiText, type UiText } from '../content/uiText'
import { deepMergeUiText } from './uiTextEditor'

export type SettingsScope = 'published' | 'draft'

export type SettingsSnapshot = {
  scope: SettingsScope
  value: UiText
  updatedAt: string | null
}

export type ReportUploadResult = {
  ok: true
  batchId: string
  reportDate: string
  importedRows: number
}

type SiteSettingsResponse = {
  scope?: SettingsScope
  value?: Partial<UiText> | null
  updatedAt?: string | null
  error?: string
}

type ReportUploadResponse = {
  ok?: boolean
  batchId?: string
  reportDate?: string
  importedRows?: number
  error?: string
}

type SettingsRequestOptions = {
  method?: 'GET' | 'PUT' | 'POST'
  password?: string
  value?: UiText
}

function normalizeUiText(value?: Partial<UiText> | null) {
  return deepMergeUiText(defaultUiText, value ?? undefined)
}

function getSiteSettingsFunctionUrl(scope: SettingsScope) {
  const url = new URL('/functions/v1/site-settings', import.meta.env.VITE_SUPABASE_URL)
  url.searchParams.set('scope', scope)
  return url.toString()
}

function getFunctionUrl(functionName: string) {
  return new URL(`/functions/v1/${functionName}`, import.meta.env.VITE_SUPABASE_URL).toString()
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('Не удалось прочитать файл'))
        return
      }

      const commaIndex = result.indexOf(',')
      resolve(commaIndex === -1 ? result : result.slice(commaIndex + 1))
    }

    reader.onerror = () => {
      reject(reader.error ?? new Error('Не удалось прочитать файл'))
    }

    reader.readAsDataURL(file)
  })
}

async function requestSiteSettings(scope: SettingsScope, options: SettingsRequestOptions = {}) {
  const headers: Record<string, string> = {}

  if (options.password?.trim()) {
    headers['x-settings-password'] = options.password.trim()
  }

  if (options.value) {
    headers['Content-Type'] = 'application/json'
  }

  const response = await fetch(getSiteSettingsFunctionUrl(scope), {
    method: options.method ?? 'GET',
    headers,
    body: options.value ? JSON.stringify({ value: options.value }) : undefined,
  })

  const payload = (await response.json().catch(() => null)) as SiteSettingsResponse | null

  if (!response.ok) {
    throw new Error(payload?.error ?? `HTTP ${response.status}`)
  }

  return {
    scope,
    value: normalizeUiText(payload?.value),
    updatedAt: payload?.updatedAt ?? null,
  } satisfies SettingsSnapshot
}

export async function loadPublishedUiText() {
  const snapshot = await requestSiteSettings('published')
  return snapshot.value
}

export function loadUiTextSnapshot(scope: SettingsScope, password?: string) {
  return requestSiteSettings(scope, { password })
}

export function saveDraftUiText(value: UiText, password: string) {
  return requestSiteSettings('draft', { method: 'PUT', password, value })
}

export function publishUiText(value: UiText, password: string) {
  return requestSiteSettings('published', { method: 'POST', password, value })
}

export async function uploadAaBleReport(reportDate: string, file: File, password: string) {
  const response = await fetch(getFunctionUrl('admin-report-upload'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-settings-password': password.trim(),
    },
    body: JSON.stringify({
      reportDate,
      fileName: file.name,
      fileBase64: await readFileAsBase64(file),
    }),
  })

  const payload = (await response.json().catch(() => null)) as ReportUploadResponse | null

  if (!response.ok || !payload?.ok || !payload.batchId || !payload.reportDate || typeof payload.importedRows !== 'number') {
    throw new Error(payload?.error ?? `HTTP ${response.status}`)
  }

  return payload as ReportUploadResult
}
