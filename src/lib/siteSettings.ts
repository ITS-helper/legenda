import { defaultUiText, type UiText } from '../content/uiText'
import { supabase } from './supabase'
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
  token?: string
  signedUrl?: string
  storageBucket?: string
  storagePath?: string
}

type SettingsRequestOptions = {
  method?: 'GET' | 'PUT' | 'POST'
  password?: string
  value?: UiText
}

const REPORT_UPLOAD_BUCKET = 'admin-imports'

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

function buildReportStoragePath(reportDate: string, fileName: string) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-')
  return `aa-ble/${reportDate}/${Date.now()}-${safeName}`
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

async function requestReportUpload(payload: Record<string, unknown>, password: string) {
  const response = await fetch(getFunctionUrl('admin-report-upload'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-settings-password': password.trim(),
    },
    body: JSON.stringify(payload),
  })

  const body = (await response.json().catch(() => null)) as ReportUploadResponse | null

  if (!response.ok) {
    throw new Error(body?.error ?? `HTTP ${response.status}`)
  }

  return body
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
  const storagePath = buildReportStoragePath(reportDate, file.name)
  const signPayload = await requestReportUpload(
    {
      action: 'sign-upload',
      reportDate,
      fileName: file.name,
      storageBucket: REPORT_UPLOAD_BUCKET,
      storagePath,
    },
    password,
  )

  if (!signPayload?.token || !signPayload.storageBucket || !signPayload.storagePath) {
    throw new Error('Не удалось получить подписанную загрузку для файла')
  }

  const { error: uploadError } = await supabase.storage
    .from(signPayload.storageBucket)
    .uploadToSignedUrl(signPayload.storagePath, signPayload.token, file, {
      cacheControl: '60',
      contentType: file.type || 'application/octet-stream',
      upsert: true,
    })

  if (uploadError) {
    throw new Error(`Не удалось загрузить файл в Storage: ${uploadError.message}`)
  }

  const importPayload = await requestReportUpload(
    {
      action: 'import',
      reportDate,
      fileName: file.name,
      storageBucket: signPayload.storageBucket,
      storagePath: signPayload.storagePath,
    },
    password,
  )

  if (!importPayload?.ok || !importPayload.batchId || !importPayload.reportDate || typeof importPayload.importedRows !== 'number') {
    throw new Error(importPayload?.error ?? 'Импорт не вернул ожидаемый результат')
  }

  return importPayload as ReportUploadResult
}
