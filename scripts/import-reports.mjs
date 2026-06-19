import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import xlsx from 'xlsx'
import { createClient } from '@supabase/supabase-js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(projectRoot, '.env.local') })
dotenv.config({ path: path.join(projectRoot, '.env') })

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Missing Supabase server environment variables')
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: 'analytics' },
})

function resolveInputPath(cliValue, envValue, fallbackPattern) {
  const candidate = cliValue || envValue
  if (candidate) {
    return path.resolve(candidate)
  }

  const downloadsDir = path.join(process.env.USERPROFILE ?? '', 'Downloads')
  if (!downloadsDir || !fs.existsSync(downloadsDir)) {
    return null
  }

  const match = fs
    .readdirSync(downloadsDir)
    .find((fileName) => fallbackPattern.test(fileName))

  return match ? path.join(downloadsDir, match) : null
}

function getArg(flagName) {
  const index = process.argv.indexOf(flagName)
  if (index === -1) {
    return null
  }

  return process.argv[index + 1] ?? null
}

function normalizeText(value) {
  if (value === undefined || value === null) {
    return null
  }

  const text = String(value).trim()
  return text === '' ? null : text
}

function normalizeInteger(value) {
  if (value === undefined || value === null || value === '') {
    return 0
  }

  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.trunc(numeric) : 0
}

function normalizeNumeric(value) {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function normalizeBoolean(value) {
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

function parseDateValue(value) {
  if (!value) {
    return null
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString()
  }

  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function parseReportDate(value) {
  if (!value) {
    return null
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }

  const text = String(value).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

function parseSessionIds(value) {
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

function parseBleTags(value) {
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

function sheetToRows(filePath, sheetName) {
  const workbook = xlsx.readFile(filePath, { cellDates: true })
  const sheet = workbook.Sheets[sheetName]

  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" not found in ${filePath}`)
  }

  return xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: true,
  })
}

function parseFaceRows(filePath) {
  return sheetToRows(filePath, 'Sheet2')
    .slice(1)
    .filter((row) => row.some((value) => value !== null && value !== ''))
    .map((row) => ({
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
    }))
}

function parseBleRows(filePath) {
  return sheetToRows(filePath, 'Sheet2')
    .slice(1)
    .filter((row) => row.some((value) => value !== null && value !== ''))
    .map((row) => ({
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
    }))
}

function assertFileExists(filePath, label) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`${label} file not found: ${filePath ?? 'undefined'}`)
  }
}

function chunk(array, size) {
  const chunks = []
  for (let index = 0; index < array.length; index += size) {
    chunks.push(array.slice(index, index + size))
  }
  return chunks
}

function dedupeRows(rows, keyBuilder) {
  return [...new Map(rows.map((row) => [keyBuilder(row), row])).values()]
}

async function chunkedUpsert(table, rows, options) {
  const dedupedRows = options?.onConflict
    ? dedupeRows(rows, (row) =>
        options.onConflict
          .split(',')
          .map((column) => String(row[column.trim()]))
          .join('::'),
      )
    : rows

  for (const batch of chunk(dedupedRows, 1000)) {
    const { error } = await supabase.from(table).upsert(batch, options)
    if (error) {
      throw error
    }
  }
}

async function chunkedInsert(table, rows) {
  for (const batch of chunk(rows, 1000)) {
    const { error } = await supabase.from(table).insert(batch)
    if (error) {
      throw error
    }
  }
}

async function fetchLookupMap(table, keyColumn, values) {
  if (values.length === 0) {
    return new Map()
  }

  const uniqueValues = [...new Set(values.filter(Boolean))]
  const { data, error } = await supabase
    .from(table)
    .select(`id, ${keyColumn}`)
    .in(keyColumn, uniqueValues)

  if (error) {
    throw error
  }

  return new Map(data.map((row) => [row[keyColumn], row.id]))
}

async function main() {
  const facePath = resolveInputPath(
    getArg('--face'),
    process.env.LOCAL_FACEID_REPORT_PATH,
    /faceID.*\.xlsx$/i,
  )
  const blePath = resolveInputPath(
    getArg('--ble'),
    process.env.LOCAL_AA_BLE_REPORT_PATH,
    /BLE.*\.xlsx$/i,
  )

  assertFileExists(facePath, 'faceID')
  assertFileExists(blePath, 'AA_BLE')

  const faceRows = parseFaceRows(facePath)
  const bleRows = parseBleRows(blePath)

  if (faceRows.length === 0 || bleRows.length === 0) {
    throw new Error('One of the report files did not produce any rows')
  }

  const reportDate = faceRows[0].report_date
  const bleReportDate = bleRows[0].report_date

  if (!reportDate || reportDate !== bleReportDate) {
    throw new Error(`Report dates do not match: faceID=${reportDate}, AA_BLE=${bleReportDate}`)
  }

  const sourceDayKey = `manual:${reportDate}`

  const { data: batchRow, error: batchError } = await supabase
    .from('import_batches')
    .upsert(
      {
        report_date: reportDate,
        source_day_key: sourceDayKey,
        status: 'importing',
        notes: 'Imported from local XLSX files',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'report_date,source_day_key' },
    )
    .select('id')
    .single()

  if (batchError) {
    throw batchError
  }

  const batchId = batchRow.id

  for (const table of ['ble_minute_facts', 'import_files', 'shifts']) {
    const { error } = await supabase.from(table).delete().eq('batch_id', batchId)
    if (error) {
      throw error
    }
  }

  await chunkedUpsert(
    'supervisors',
    faceRows
      .filter((row) => row.supervisor_name)
      .map((row) => ({ name: row.supervisor_name })),
    { onConflict: 'name' },
  )

  await chunkedUpsert(
    'schedules',
    faceRows
      .filter((row) => row.schedule_name)
      .map((row) => ({ name: row.schedule_name })),
    { onConflict: 'name' },
  )

  await chunkedUpsert(
    'employees',
    faceRows.map((row) => ({
      employee_number: row.employee_number,
      full_name: row.full_name,
      object_name: row.object_name,
      customer_tab_number: row.customer_tab_number,
      area_name: row.area_name,
      profession: row.profession,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: 'employee_number' },
  )

  const supervisorMap = await fetchLookupMap(
    'supervisors',
    'name',
    faceRows.map((row) => row.supervisor_name),
  )
  const scheduleMap = await fetchLookupMap(
    'schedules',
    'name',
    faceRows.map((row) => row.schedule_name),
  )
  const employeeMap = await fetchLookupMap(
    'employees',
    'employee_number',
    faceRows.map((row) => row.employee_number),
  )

  await chunkedInsert('import_files', [
    {
      batch_id: batchId,
      source_type: 'faceid',
      report_date: reportDate,
      file_name: path.basename(facePath),
      imported_at: new Date().toISOString(),
      parse_status: 'parsed',
    },
    {
      batch_id: batchId,
      source_type: 'aa_ble',
      report_date: reportDate,
      file_name: path.basename(blePath),
      imported_at: new Date().toISOString(),
      parse_status: 'parsed',
    },
  ])

  const shiftRows = faceRows.map((row) => ({
    batch_id: batchId,
    report_date: row.report_date,
    ww_shift_id: row.ww_shift_id,
    employee_id: employeeMap.get(row.employee_number),
    supervisor_id: row.supervisor_name ? supervisorMap.get(row.supervisor_name) : null,
    schedule_id: row.schedule_name ? scheduleMap.get(row.schedule_name) : null,
    planned_start_at: row.planned_start_at,
    planned_end_at: row.planned_end_at,
    watch_received_at: row.watch_received_at,
    watch_returned_at: row.watch_returned_at,
    on_watch_duration_text: row.on_watch_duration_text,
    on_watch_duration_seconds: row.on_watch_duration_seconds,
    shift_over_18_hours: row.shift_over_18_hours,
    late_seconds: row.late_seconds,
    early_return_seconds: row.early_return_seconds,
    calc_hash: row.calc_hash,
  }))

  await chunkedUpsert('shifts', shiftRows, { onConflict: 'ww_shift_id' })

  const { data: shiftData, error: shiftSelectError } = await supabase
    .from('shifts')
    .select('id, ww_shift_id')
    .in(
      'ww_shift_id',
      shiftRows.map((row) => row.ww_shift_id),
    )

  if (shiftSelectError) {
    throw shiftSelectError
  }

  const shiftMap = new Map(shiftData.map((row) => [row.ww_shift_id, row.id]))

  const { error: sessionDeleteError } = await supabase
    .from('sessions')
    .delete()
    .in('shift_id', [...shiftMap.values()])

  if (sessionDeleteError) {
    throw sessionDeleteError
  }

  const sessionRows = faceRows.flatMap((row) =>
    row.tech_session_ids.map((techSessionId) => ({
      shift_id: shiftMap.get(row.ww_shift_id),
      tech_session_id: techSessionId,
    })),
  )

  if (sessionRows.length > 0) {
    await chunkedUpsert('sessions', sessionRows, { onConflict: 'tech_session_id' })
  }

  await chunkedInsert(
    'ble_minute_facts',
    bleRows.map((row) => ({
      batch_id: batchId,
      report_date: row.report_date,
      ww_shift_id: row.ww_shift_id,
      tech_session_id: row.tech_session_id,
      employee_number: row.employee_number,
      user_id: row.user_id,
      event_at: row.event_at,
      object_date: row.object_date,
      object_time: row.object_time,
      idle_sec: row.idle_sec,
      go_sec: row.go_sec,
      work_sec: row.work_sec,
      total_sec: row.total_sec,
      ble_tags: row.ble_tags,
      metka: row.metka,
      zona: row.zona,
      chosen_metka: row.chosen_metka,
      chosen_mapped_metka: row.chosen_mapped_metka,
      working_hours: row.working_hours,
      work_code: row.work_code,
      sleep: row.sleep,
      wear: row.wear,
    })),
  )

  const { error: batchReadyError } = await supabase
    .from('import_batches')
    .update({
      status: 'ready',
      updated_at: new Date().toISOString(),
    })
    .eq('id', batchId)

  if (batchReadyError) {
    throw batchReadyError
  }

  console.log(
    JSON.stringify(
      {
        reportDate,
        batchId,
        importedFaceRows: faceRows.length,
        importedBleRows: bleRows.length,
        shifts: shiftRows.length,
        sessions: sessionRows.length,
      },
      null,
      2,
    ),
  )
}

main().catch(async (error) => {
  console.error(error)
  process.exitCode = 1
})
