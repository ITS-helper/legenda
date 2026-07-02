import fs from 'node:fs'
import xlsx from 'xlsx'

export function normalizeText(value) {
  if (value === undefined || value === null) {
    return null
  }

  const text = String(value).trim()
  return text === '' ? null : text
}

export function normalizeInteger(value) {
  if (value === undefined || value === null || value === '') {
    return 0
  }

  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.trunc(numeric) : 0
}

export function normalizeNumeric(value) {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

export function normalizeBoolean(value) {
  if (typeof value === 'boolean') {
    return value
  }

  if (value === 'True' || value === 'true' || value === 1) {
    return true
  }

  if (value === 'False' || value === 'false' || value === 0) {
    return false
  }

  return null
}

export function parseDateValue(value) {
  if (!value) {
    return null
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString()
  }

  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export function parseReportDate(value) {
  if (!value) {
    return null
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }

  const text = String(value).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

export function parseSessionIds(value) {
  const text = normalizeText(value)
  if (!text) {
    return []
  }

  return text
    .replace(/[{}]/g, '')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part))
}

export function parseBleTags(value) {
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

function pickSheet(workbook) {
  if (workbook.Sheets.Sheet2) {
    return workbook.Sheets.Sheet2
  }

  const firstSheetName = workbook.SheetNames[0]
  return firstSheetName ? workbook.Sheets[firstSheetName] : null
}

export function sheetToRowsFromPath(filePath, sheetName = 'Sheet2') {
  const workbook = xlsx.readFile(filePath, { cellDates: true })
  const sheet = sheetName ? workbook.Sheets[sheetName] : pickSheet(workbook)

  if (!sheet) {
    throw new Error(`Sheet "${sheetName ?? 'Sheet2'}" not found in ${filePath}`)
  }

  return xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: true,
  })
}

export async function sheetToRowsFromBuffer(bytes, sheetName = 'Sheet2') {
  const workbook = xlsx.read(bytes, { type: 'array', cellDates: true })
  const sheet = sheetName ? workbook.Sheets[sheetName] : pickSheet(workbook)

  if (!sheet) {
    throw new Error(`Sheet "${sheetName ?? 'Sheet2'}" not found`)
  }

  return xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: true,
  })
}

export function sheetToRowsFromPathAuto(filePath) {
  const workbook = xlsx.readFile(filePath, { cellDates: true })
  const sheet = pickSheet(workbook)

  if (!sheet) {
    throw new Error(`No data sheet found in ${filePath}`)
  }

  return xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: true,
  })
}

function mapFaceRow(row) {
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

function mapBleRow(row) {
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

function mapLongIdleRow(row) {
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

function filterDataRows(rows) {
  return rows
    .slice(1)
    .filter((row) => row.some((value) => value !== null && value !== ''))
}

export function parseFaceRowsFromSheet(rows) {
  return filterDataRows(rows).map(mapFaceRow)
}

export function parseBleRowsFromSheet(rows) {
  return filterDataRows(rows).map(mapBleRow)
}

export function parseLongIdleRowsFromSheet(rows) {
  return filterDataRows(rows).map(mapLongIdleRow)
}

export function parseFaceRows(filePath) {
  return parseFaceRowsFromSheet(sheetToRowsFromPath(filePath, 'Sheet2'))
}

export function parseBleRows(filePath) {
  return parseBleRowsFromSheet(sheetToRowsFromPath(filePath, 'Sheet2'))
}

export function parseLongIdleRows(filePath) {
  return parseLongIdleRowsFromSheet(sheetToRowsFromPath(filePath, 'Sheet2'))
}

export function parseFaceRowsFromBuffer(bytes) {
  return sheetToRowsFromBuffer(bytes, 'Sheet2').then(parseFaceRowsFromSheet)
}

export function parseBleRowsFromBuffer(bytes) {
  return sheetToRowsFromBuffer(bytes, 'Sheet2').then(parseBleRowsFromSheet)
}

export function parseLongIdleRowsFromBuffer(bytes) {
  return sheetToRowsFromBuffer(bytes, 'Sheet2').then(parseLongIdleRowsFromSheet)
}

export function assertSingleReportDate(rows, reportDate, label) {
  const fileDates = [...new Set(rows.map((row) => row.report_date).filter(Boolean))]
  if (fileDates.length !== 1 || fileDates[0] !== reportDate) {
    throw new Error(
      `Дата в ${label} не совпадает с выбранной. В файле: ${fileDates[0] ?? 'не определена'}, выбрано: ${reportDate}`,
    )
  }
}

export function assertFileExists(filePath, label) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`${label} file not found: ${filePath ?? 'undefined'}`)
  }
}

export const REPORT_FILE_PATTERNS = {
  faceid: /6_report_6_faceID.*LEGENDA.*!NEW!.*(\d{4}-\d{2}-\d{2})/i,
  aa_ble: /11_отчет по АА_BLE.*LEGENDA.*!NEW!.*(\d{4}-\d{2}-\d{2})/i,
  long_idle: /8_report_8_LongIDLE.*LEGENDA.*!NEW!.*(\d{4}-\d{2}-\d{2})/i,
}

/** Archive subfolders inside the LEGENDA Drive root (case-insensitive match). */
export const DRIVE_ARCHIVE_FOLDERS = {
  faceid: '6_report_6_faceID_arh',
  aa_ble: 'aa_ble_arh',
  long_idle: '8_report_8_LongIDLE_arh',
}

/** Root archive folders that must be skipped during Drive sync. */
export const DRIVE_IGNORED_ARCHIVE_FOLDERS = new Set([
  '100_report_alerts_arh',
  '10_report_10_long_idle_arh',
])

export function normalizeReportDateInput(value) {
  if (!value) {
    return null
  }

  const trimmed = value.trim()

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed
  }

  const dotted = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (dotted) {
    return `${dotted[3]}-${dotted[2]}-${dotted[1]}`
  }

  const slashed = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (slashed) {
    return `${slashed[3]}-${slashed[2]}-${slashed[1]}`
  }

  throw new Error(`Некорректная дата "${value}". Используйте YYYY-MM-DD, например 2026-07-01`)
}

export function extractReportDateFromFileName(fileName) {
  for (const pattern of Object.values(REPORT_FILE_PATTERNS)) {
    const match = fileName.match(pattern)
    if (match?.[1]) {
      return match[1]
    }
  }

  return null
}

export function classifyReportFileName(fileName) {
  for (const [sourceType, pattern] of Object.entries(REPORT_FILE_PATTERNS)) {
    if (pattern.test(fileName)) {
      return sourceType
    }
  }

  return null
}
