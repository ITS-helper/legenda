// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { SourceType } from './parsers.ts'

type ImportFileMeta = {
  sourceType: SourceType
  fileName: string
  googleFileId?: string | null
  fileChecksum?: string | null
  mimeType?: string | null
}

function chunk<T>(array: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < array.length; index += size) {
    chunks.push(array.slice(index, index + size))
  }
  return chunks
}

function dedupeRows<T>(rows: T[], keyBuilder: (row: T) => string) {
  return [...new Map(rows.map((row) => [keyBuilder(row), row])).values()]
}

async function chunkedInsert(supabase: SupabaseClient, table: string, rows: any[], batchSize = 500) {
  if (rows.length === 0) return
  for (const batch of chunk(rows, batchSize)) {
    const { error } = await supabase.from(table).insert(batch)
    if (error) throw error
  }
}

async function chunkedUpsert(
  supabase: SupabaseClient,
  table: string,
  rows: any[],
  onConflict: string,
  batchSize = 500,
) {
  if (rows.length === 0) return
  const dedupedRows = dedupeRows(rows, (row) =>
    onConflict
      .split(',')
      .map((column) => String(row[column.trim()]))
      .join('::'),
  )
  for (const batch of chunk(dedupedRows, batchSize)) {
    const { error } = await supabase.from(table).upsert(batch, { onConflict })
    if (error) throw error
  }
}

async function fetchLookupMap(
  supabase: SupabaseClient,
  table: string,
  keyColumn: string,
  values: Array<string | null | undefined>,
) {
  const uniqueValues = [...new Set(values.filter(Boolean) as string[])]
  if (uniqueValues.length === 0) return new Map<string, number>()
  const { data, error } = await supabase.from(table).select(`id, ${keyColumn}`).in(keyColumn, uniqueValues)
  if (error) throw error
  return new Map((data ?? []).map((row) => [String(row[keyColumn]), Number(row.id)]))
}

function buildImportFileRecords(batchId: number, reportDate: string, files: ImportFileMeta[]) {
  return files.map((file) => ({
    batch_id: batchId,
    source_type: file.sourceType,
    report_date: reportDate,
    google_file_id: file.googleFileId ?? null,
    file_name: file.fileName,
    mime_type: file.mimeType ?? null,
    file_checksum: file.fileChecksum ?? null,
    imported_at: new Date().toISOString(),
    parse_status: 'parsed',
  }))
}

function mapLongIdleFactRows(batchId: number, rows: any[]) {
  return rows.map((row) => ({
    batch_id: batchId,
    report_date: row.report_date,
    ww_shift_id: row.ww_shift_id,
    employee_number: row.employee_number,
    customer_tab_number: row.customer_tab_number,
    full_name: row.full_name,
    area_name: row.area_name,
    supervisor_name: row.supervisor_name,
    profession: row.profession,
    object_name: row.object_name,
    shift_begin_at: row.shift_begin_at,
    shift_end_at: row.shift_end_at,
    on_watch_duration_text: row.on_watch_duration_text,
    schedule_name: row.schedule_name,
    eui_device_id: row.eui_device_id,
    tech_session_id: row.tech_session_id,
    full_go: row.full_go,
    real_go: row.real_go,
    full_work: row.full_work,
    real_work: row.real_work,
    full_idle: row.full_idle,
    real_idle: row.real_idle,
    full_idle_seconds: row.full_idle_seconds,
    real_idle_seconds: row.real_idle_seconds,
    full_go_seconds: row.full_go_seconds,
    real_go_seconds: row.real_go_seconds,
    full_work_seconds: row.full_work_seconds,
    real_work_seconds: row.real_work_seconds,
    full_total_seconds: row.full_total_seconds,
    real_total_seconds: row.real_total_seconds,
    full_long_idle_seconds: row.full_long_idle_seconds,
    full_common_idle_seconds: row.full_common_idle_seconds,
    long_data_idle_seconds: row.long_data_idle_seconds,
    long_data_total_seconds: row.long_data_total_seconds,
    real_common_idle: row.real_common_idle,
    real_long_idle: row.real_long_idle,
  }))
}

function validateBleRows(rows: any[]) {
  const invalid = rows.filter(
    (row) => !Number.isFinite(row.ww_shift_id) || !Number.isFinite(row.tech_session_id) || !row.event_at,
  )
  if (invalid.length > 0) {
    throw new Error('В AA_BLE есть строки без ww_shift_id, tech_session_id или event_at')
  }
}

function validateLongIdleRows(rows: any[]) {
  const invalid = rows.filter((row) => !Number.isFinite(row.ww_shift_id) || !Number.isFinite(row.tech_session_id))
  if (invalid.length > 0) {
    throw new Error('В LongIDLE есть строки без ww_shift_id или tech_session_id')
  }
}

export async function importDailyBatch(
  supabase: SupabaseClient,
  options: {
    reportDate: string
    sourceDayKey: string
    notes?: string
    faceRows?: any[]
    bleRows?: any[]
    longIdleRows?: any[]
    idleEpisodeRows?: any[]
    files: ImportFileMeta[]
  },
) {
  const {
    reportDate,
    sourceDayKey,
    notes,
    faceRows = [],
    bleRows = [],
    longIdleRows = [],
    idleEpisodeRows = [],
    files,
  } = options

  if (!reportDate || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    throw new Error('Нужна дата отчета в формате YYYY-MM-DD')
  }
  if (bleRows.length === 0) throw new Error('AA_BLE не содержит строк для импорта')
  if (faceRows.length === 0) throw new Error('faceID не содержит строк для импорта')
  if (longIdleRows.length === 0) throw new Error('LongIDLE не содержит строк для импорта')

  validateBleRows(bleRows)
  validateLongIdleRows(longIdleRows)

  const { data: batchRow, error: batchError } = await supabase
    .from('import_batches')
    .upsert(
      {
        report_date: reportDate,
        source_day_key: sourceDayKey,
        status: 'importing',
        notes: notes ?? 'Daily report import',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'report_date,source_day_key' },
    )
    .select('id')
    .single()

  if (batchError) throw batchError
  const batchId = batchRow.id as number

  const { data: existingShifts, error: existingShiftsError } = await supabase
    .from('shifts')
    .select('id')
    .eq('report_date', reportDate)
  if (existingShiftsError) throw existingShiftsError

  const existingShiftIds = (existingShifts ?? []).map((row) => row.id)
  if (existingShiftIds.length > 0) {
    const { error } = await supabase.from('sessions').delete().in('shift_id', existingShiftIds)
    if (error) throw error
  }

  for (const table of ['idle_episodes', 'long_idle_facts', 'ble_minute_facts', 'shifts']) {
    const { error } = await supabase.from(table).delete().eq('report_date', reportDate)
    if (error) throw error
  }

  const { error: importFilesDeleteError } = await supabase.from('import_files').delete().eq('batch_id', batchId)
  if (importFilesDeleteError) throw importFilesDeleteError

  await chunkedUpsert(
    supabase,
    'supervisors',
    faceRows.filter((row) => row.supervisor_name).map((row) => ({ name: row.supervisor_name })),
    'name',
  )
  await chunkedUpsert(
    supabase,
    'schedules',
    faceRows.filter((row) => row.schedule_name).map((row) => ({ name: row.schedule_name })),
    'name',
  )
  await chunkedUpsert(
    supabase,
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
    'employee_number',
  )

  const supervisorMap = await fetchLookupMap(
    supabase,
    'supervisors',
    'name',
    faceRows.map((row) => row.supervisor_name),
  )
  const scheduleMap = await fetchLookupMap(
    supabase,
    'schedules',
    'name',
    faceRows.map((row) => row.schedule_name),
  )
  const employeeMap = await fetchLookupMap(
    supabase,
    'employees',
    'employee_number',
    faceRows.map((row) => row.employee_number),
  )

  await chunkedInsert(supabase, 'import_files', buildImportFileRecords(batchId, reportDate, files))

  const shiftRows = faceRows
    .map((row) => ({
      batch_id: batchId,
      report_date: row.report_date,
      ww_shift_id: row.ww_shift_id,
      employee_id: row.employee_number ? employeeMap.get(row.employee_number) : null,
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
    .filter((row) => row.employee_id)

  await chunkedUpsert(supabase, 'shifts', shiftRows, 'ww_shift_id')

  const { data: shiftData, error: shiftSelectError } = await supabase
    .from('shifts')
    .select('id, ww_shift_id')
    .in('ww_shift_id', shiftRows.map((row) => Number(row.ww_shift_id)))
  if (shiftSelectError) throw shiftSelectError

  const shiftMap = new Map((shiftData ?? []).map((row) => [Number(row.ww_shift_id), Number(row.id)]))
  const shiftIds = [...shiftMap.values()]
  if (shiftIds.length > 0) {
    const { error } = await supabase.from('sessions').delete().in('shift_id', shiftIds)
    if (error) throw error
  }

  const sessionRows = faceRows
    .flatMap((row) =>
      row.tech_session_ids.map((techSessionId: number) => ({
        shift_id: shiftMap.get(row.ww_shift_id),
        tech_session_id: techSessionId,
      })),
    )
    .filter((row) => row.shift_id)

  if (sessionRows.length > 0) {
    await chunkedUpsert(supabase, 'sessions', sessionRows, 'tech_session_id')
  }

  await chunkedInsert(
    supabase,
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

  await chunkedInsert(supabase, 'long_idle_facts', mapLongIdleFactRows(batchId, longIdleRows))

  if (idleEpisodeRows.length > 0) {
    await chunkedInsert(
      supabase,
      'idle_episodes',
      idleEpisodeRows
        .filter((row) => Number.isFinite(row.ww_shift_id) && row.report_date)
        .map((row) => ({
          batch_id: batchId,
          report_date: row.report_date,
          ww_shift_id: row.ww_shift_id,
          session_id: Number.isFinite(row.session_id) ? row.session_id : null,
          employee_number: row.employee_number,
          full_name: row.full_name,
          dt_start: row.dt_start,
          dt_end: row.dt_end,
          duration_min: row.duration_min,
          work_type: row.work_type,
          work_code: row.work_code,
          ble_tag_number: row.ble_tag_number,
          ble_tag_zone: row.ble_tag_zone,
          ble_label: row.ble_label,
        })),
    )
  }

  const { error: readyError } = await supabase
    .from('import_batches')
    .update({ status: 'ready', updated_at: new Date().toISOString() })
    .eq('id', batchId)
  if (readyError) throw readyError

  return {
    batchId,
    reportDate,
    importedFaceRows: faceRows.length,
    importedBleRows: bleRows.length,
    importedLongIdleRows: longIdleRows.length,
    importedIdleEpisodes: idleEpisodeRows.length,
    importedRows: bleRows.length,
    shifts: shiftRows.length,
    sessions: sessionRows.length,
  }
}

export async function markImportBatchFailed(
  supabase: SupabaseClient,
  reportDate: string,
  sourceDayKey: string,
  errorMessage: string,
) {
  await supabase.from('import_batches').upsert(
    {
      report_date: reportDate,
      source_day_key: sourceDayKey,
      status: 'failed',
      notes: errorMessage,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'report_date,source_day_key' },
  )
}

export async function getReadyBatch(supabase: SupabaseClient, reportDate: string, sourceDayKey: string) {
  const { data, error } = await supabase
    .from('import_batches')
    .select('id, status')
    .eq('report_date', reportDate)
    .eq('source_day_key', sourceDayKey)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function getBatchImportFiles(supabase: SupabaseClient, batchId: number) {
  const { data, error } = await supabase
    .from('import_files')
    .select('source_type, google_file_id, file_name')
    .eq('batch_id', batchId)
  if (error) throw error
  return data ?? []
}

export function filesUnchanged(
  existingFiles: Array<{ source_type: string; google_file_id: string | null }>,
  nextFiles: ImportFileMeta[],
) {
  if (existingFiles.length !== nextFiles.length) return false
  const existingMap = new Map(existingFiles.map((file) => [file.source_type, file.google_file_id ?? '']))
  return nextFiles.every((file) => existingMap.get(file.sourceType) === (file.googleFileId ?? ''))
}
