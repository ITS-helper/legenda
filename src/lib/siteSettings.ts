import { defaultUiText, type UiText } from '../content/uiText'
import { deepMergeUiText } from './uiTextEditor'
import * as XLSX from 'xlsx'

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

type BleRow = {
  employee_number: string | null
  user_id: string | null
  ww_shift_id: number
  report_date: string | null
  tech_session_id: number
  idle_sec: number
  go_sec: number
  work_sec: number
  total_sec: number
  ble_tags: unknown
  metka: string | null
  zona: string | null
  chosen_metka: string | null
  chosen_mapped_metka: string | null
  object_date: string | null
  object_time: string | null
  working_hours: number | null
  work_code: string | null
  sleep: number
  wear: number
  event_at: string | null
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

function normalizeText(value: unknown) {
  if (value === undefined || value === null) {
    return null
  }

  const text = String(value).trim()
  return text === '' ? null : text
}

function normalizeInteger(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return 0
  }

  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.trunc(numeric) : 0
}

function normalizeNumeric(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function parseDateValue(value: unknown) {
  if (!value) {
    return null
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString()
  }

  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function parseReportDate(value: unknown) {
  if (!value) {
    return null
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }

  const text = String(value).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

function parseBleTags(value: unknown) {
  const text = normalizeText(value)
  if (!text || text === 'None') {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function pickSheet(workbook: XLSX.WorkBook) {
  if (workbook.Sheets.Sheet2) {
    return workbook.Sheets.Sheet2
  }

  const firstSheetName = workbook.SheetNames[0]
  return firstSheetName ? workbook.Sheets[firstSheetName] : null
}

async function parseAaBleFile(file: File) {
  const bytes = await file.arrayBuffer()
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: true })
  const sheet = pickSheet(workbook)

  if (!sheet) {
    throw new Error('В файле не найден ни один лист')
  }

  const rows = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
  })

  return rows
    .slice(1)
    .filter((row) => row.some((value) => value !== null && value !== ''))
    .map(
      (row): BleRow => ({
        employee_number: normalizeText(row[0]),
        user_id: normalizeText(row[1]),
        ww_shift_id: Number(row[2]),
        report_date: parseReportDate(row[3]),
        tech_session_id: Number(row[4]),
        idle_sec: normalizeInteger(row[5]),
        go_sec: normalizeInteger(row[6]),
        work_sec: normalizeInteger(row[7]),
        total_sec: normalizeInteger(row[8]),
        ble_tags: parseBleTags(row[9]),
        metka: normalizeText(row[10]),
        zona: normalizeText(row[11]),
        chosen_metka: normalizeText(row[12]),
        chosen_mapped_metka: normalizeText(row[13]),
        object_date: parseReportDate(row[14]),
        object_time: normalizeText(row[15]),
        working_hours: normalizeNumeric(row[16]),
        work_code: normalizeText(row[17]),
        sleep: normalizeInteger(row[18]),
        wear: normalizeInteger(row[19]),
        event_at: parseDateValue(row[20]),
      }),
    )
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
  const rows = await parseAaBleFile(file)

  if (rows.length === 0) {
    throw new Error('Файл не содержит строк для импорта')
  }

  const fileDates = [...new Set(rows.map((row) => row.report_date).filter(Boolean))]
  if (fileDates.length !== 1 || fileDates[0] !== reportDate) {
    throw new Error(`Дата в файле не совпадает с выбранной. В файле: ${fileDates[0] ?? 'не определена'}, выбрано: ${reportDate}`)
  }

  const response = await fetch(getFunctionUrl('admin-report-upload'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-settings-password': password.trim(),
    },
    body: JSON.stringify({
      reportDate,
      fileName: file.name,
      rows,
    }),
  })

  const payload = (await response.json().catch(() => null)) as ReportUploadResponse | null

  if (!response.ok || !payload?.ok || !payload.batchId || !payload.reportDate || typeof payload.importedRows !== 'number') {
    throw new Error(payload?.error ?? `HTTP ${response.status}`)
  }

  return payload as ReportUploadResult
}
