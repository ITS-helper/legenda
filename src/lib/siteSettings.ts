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
  importedFaceRows?: number
  importedBleRows?: number
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
  importedFaceRows?: number
  importedBleRows?: number
  error?: string
}

type SettingsRequestOptions = {
  method?: 'GET' | 'PUT' | 'POST'
  password?: string
  value?: UiText
}

type FaceRow = {
  report_date: string | null
  ww_shift_id: number
  employee_number: string | null
  full_name: string | null
  object_name: string | null
  customer_tab_number: string | null
  area_name: string | null
  supervisor_name: string | null
  profession: string | null
  schedule_name: string | null
  planned_start_at: string | null
  planned_end_at: string | null
  watch_received_at: string | null
  watch_returned_at: string | null
  on_watch_duration_text: string | null
  on_watch_duration_seconds: number
  shift_over_18_hours: boolean | null
  late_seconds: number
  early_return_seconds: number
  tech_session_ids: number[]
  calc_hash: string | null
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

function normalizeBoolean(value: unknown) {
  if (typeof value === 'boolean') return value
  if (value === 'True' || value === 'true' || value === 1) return true
  if (value === 'False' || value === 'false' || value === 0) return false
  return null
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

function parseSessionIds(value: unknown) {
  const text = normalizeText(value)
  if (!text) return []

  return text
    .replace(/[{}]/g, '')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part))
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

async function readSheetRows(file: File) {
  const bytes = await file.arrayBuffer()
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: true })
  const sheet = pickSheet(workbook)

  if (!sheet) {
    throw new Error(`В файле ${file.name} не найден ни один лист`)
  }

  return XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
  })
}

async function parseFaceIdFile(file: File) {
  const rows = await readSheetRows(file)

  return rows
    .slice(1)
    .filter((row) => row.some((value) => value !== null && value !== ''))
    .map(
      (row): FaceRow => ({
        report_date: parseReportDate(row[0]),
        ww_shift_id: Number(row[1]),
        employee_number: normalizeText(row[2]),
        full_name: normalizeText(row[3]),
        object_name: normalizeText(row[4]),
        customer_tab_number: normalizeText(row[5]),
        area_name: normalizeText(row[6]),
        supervisor_name: normalizeText(row[7]),
        profession: normalizeText(row[8]),
        schedule_name: normalizeText(row[9]),
        planned_start_at: parseDateValue(row[10]),
        planned_end_at: parseDateValue(row[11]),
        watch_received_at: parseDateValue(row[12]),
        watch_returned_at: parseDateValue(row[13]),
        on_watch_duration_text: normalizeText(row[14]),
        on_watch_duration_seconds: normalizeInteger(row[15]),
        shift_over_18_hours: normalizeBoolean(row[16]),
        late_seconds: normalizeInteger(row[17]),
        early_return_seconds: normalizeInteger(row[18]),
        tech_session_ids: parseSessionIds(row[19]),
        calc_hash: normalizeText(row[20]),
      }),
    )
}

async function parseAaBleFile(file: File) {
  const rows = await readSheetRows(file)

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

function assertSingleReportDate(rows: { report_date: string | null }[], reportDate: string, label: string) {
  const fileDates = [...new Set(rows.map((row) => row.report_date).filter(Boolean))]
  if (fileDates.length !== 1 || fileDates[0] !== reportDate) {
    throw new Error(`Дата в ${label} не совпадает с выбранной. В файле: ${fileDates[0] ?? 'не определена'}, выбрано: ${reportDate}`)
  }
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

export async function uploadAaBleReport(reportDate: string, bleFile: File, password: string, faceFile?: File | null) {
  const [rows, faceRows] = await Promise.all([
    parseAaBleFile(bleFile),
    faceFile ? parseFaceIdFile(faceFile) : Promise.resolve(null),
  ])

  if (rows.length === 0) {
    throw new Error('AA_BLE не содержит строк для импорта')
  }

  assertSingleReportDate(rows, reportDate, 'AA_BLE')

  if (faceRows) {
    if (faceRows.length === 0) {
      throw new Error('faceID не содержит строк для импорта')
    }

    assertSingleReportDate(faceRows, reportDate, 'faceID')
  }

  const response = await fetch(getFunctionUrl('admin-report-upload'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-settings-password': password.trim(),
    },
    body: JSON.stringify({
      reportDate,
      fileName: bleFile.name,
      faceFileName: faceFile?.name,
      rows,
      faceRows,
    }),
  })

  const payload = (await response.json().catch(() => null)) as ReportUploadResponse | null

  if (!response.ok || !payload?.ok || !payload.batchId || !payload.reportDate || typeof payload.importedRows !== 'number') {
    throw new Error(payload?.error ?? `HTTP ${response.status}`)
  }

  return payload as ReportUploadResult
}


