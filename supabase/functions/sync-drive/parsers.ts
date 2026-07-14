import xlsx from 'npm:xlsx@0.18.5'

export const REPORT_FILE_PATTERNS = {
  faceid: /6_report_6_faceID.*LEGENDA.*!NEW!.*(\d{4}-\d{2}-\d{2})/i,
  aa_ble: /11_отчет по [AА]{2}_BLE.*LEGENDA.*!NEW!.*(\d{4}-\d{2}-\d{2})/i,
  long_idle: /8_report_8_LongIDLE.*LEGENDA.*!NEW!.*(\d{4}-\d{2}-\d{2})/i,
  idle_episode: /10_report_10.*LEGENDA.*!NEW!.*(\d{4}-\d{2}-\d{2})/i,
} as const

export const DRIVE_ARCHIVE_FOLDERS = {
  faceid: '6_report_6_faceID_arh',
  aa_ble: 'aa_ble_arh',
  long_idle: '8_report_8_LongIDLE_arh',
  idle_episode: '10_report_10_long_idle_arh',
} as const

export type SourceType = keyof typeof REPORT_FILE_PATTERNS

function normalizeText(value: unknown) {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  return text === '' ? null : text
}

function normalizeInteger(value: unknown) {
  if (value === undefined || value === null || value === '') return 0
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.trunc(numeric) : 0
}

function normalizeNumeric(value: unknown) {
  if (value === undefined || value === null || value === '') return null
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
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function parseReportDate(value: unknown) {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
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
  if (!text || text === 'None') return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function pickSheet(workbook: xlsx.WorkBook) {
  if (workbook.Sheets.Sheet2) return workbook.Sheets.Sheet2
  const firstSheetName = workbook.SheetNames[0]
  return firstSheetName ? workbook.Sheets[firstSheetName] : null
}

function sheetToRowsFromBuffer(bytes: Uint8Array, sheetName = 'Sheet2') {
  const workbook = xlsx.read(bytes, { type: 'array', cellDates: true })
  const sheet = sheetName ? workbook.Sheets[sheetName] : pickSheet(workbook)
  if (!sheet) throw new Error(`Sheet "${sheetName ?? 'Sheet2'}" not found`)
  return xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true })
}

function filterDataRows(rows: unknown[][]) {
  return rows.slice(1).filter((row) => row.some((value) => value !== null && value !== ''))
}

// deno-lint-ignore no-explicit-any
type Row = any[]

function mapFaceRow(row: Row) {
  return {
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
  }
}

function mapBleRow(row: Row) {
  return {
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
  }
}

function mapIdleEpisodeRow(row: Row) {
  return {
    ww_shift_id: Number(row[0]),
    session_id: Number(row[1]),
    report_date: parseReportDate(row[2]) ?? parseReportDate(row[5]),
    employee_number: normalizeText(row[3]),
    full_name: normalizeText(row[4]),
    dt_start: parseDateValue(row[5]),
    dt_end: parseDateValue(row[6]),
    duration_min: normalizeInteger(row[7]),
    work_type: normalizeInteger(row[8]),
    work_code: normalizeInteger(row[9]),
    ble_tag_number: normalizeInteger(row[10]),
    ble_tag_zone: normalizeInteger(row[11]),
    ble_label: normalizeText(row[12]),
  }
}

function mapLongIdleRow(row: Row) {
  return {
    employee_number: normalizeText(row[0]),
    customer_tab_number: normalizeText(row[1]),
    full_name: normalizeText(row[2]),
    area_name: normalizeText(row[3]),
    supervisor_name: normalizeText(row[4]),
    profession: normalizeText(row[5]),
    object_name: normalizeText(row[6]),
    report_date: parseReportDate(row[7]),
    shift_begin_at: parseDateValue(row[8]),
    shift_end_at: parseDateValue(row[9]),
    on_watch_duration_text: normalizeText(row[10]),
    schedule_name: normalizeText(row[11]),
    ww_shift_id: Number(row[12]),
    eui_device_id: normalizeText(row[13]),
    tech_session_id: Number(row[14]),
    full_go: normalizeNumeric(row[15]),
    real_go: normalizeNumeric(row[16]),
    full_work: normalizeNumeric(row[17]),
    real_work: normalizeNumeric(row[18]),
    full_idle: normalizeNumeric(row[19]),
    real_idle: normalizeNumeric(row[20]),
    full_idle_seconds: normalizeInteger(row[21]),
    real_idle_seconds: normalizeInteger(row[22]),
    full_go_seconds: normalizeInteger(row[23]),
    real_go_seconds: normalizeInteger(row[24]),
    full_work_seconds: normalizeInteger(row[25]),
    real_work_seconds: normalizeInteger(row[26]),
    full_total_seconds: normalizeInteger(row[27]),
    real_total_seconds: normalizeInteger(row[28]),
    full_long_idle_seconds: normalizeInteger(row[29]),
    full_common_idle_seconds: normalizeInteger(row[30]),
    long_data_idle_seconds: normalizeInteger(row[31]),
    long_data_total_seconds: normalizeInteger(row[32]),
    real_common_idle: normalizeNumeric(row[33]),
    real_long_idle: normalizeNumeric(row[34]),
  }
}

export function parseFaceRowsFromBuffer(bytes: Uint8Array) {
  return filterDataRows(sheetToRowsFromBuffer(bytes, 'Sheet2')).map(mapFaceRow)
}

export function parseBleRowsFromBuffer(bytes: Uint8Array) {
  return filterDataRows(sheetToRowsFromBuffer(bytes, 'Sheet2')).map(mapBleRow)
}

export function parseLongIdleRowsFromBuffer(bytes: Uint8Array) {
  return filterDataRows(sheetToRowsFromBuffer(bytes, 'Sheet2')).map(mapLongIdleRow)
}

export function parseIdleEpisodeRowsFromBuffer(bytes: Uint8Array) {
  return filterDataRows(sheetToRowsFromBuffer(bytes, 'Sheet2')).map(mapIdleEpisodeRow)
}

export function normalizeReportDateInput(value: string | null | undefined) {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const dotted = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (dotted) return `${dotted[3]}-${dotted[2]}-${dotted[1]}`
  const slashed = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (slashed) return `${slashed[3]}-${slashed[2]}-${slashed[1]}`
  throw new Error(`Некорректная дата "${value}". Используйте YYYY-MM-DD`)
}
