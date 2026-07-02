import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

type LongIdleRow = {
  employee_number: string | null
  customer_tab_number: string | null
  full_name: string | null
  area_name: string | null
  supervisor_name: string | null
  profession: string | null
  object_name: string | null
  report_date: string | null
  shift_begin_at: string | null
  shift_end_at: string | null
  on_watch_duration_text: string | null
  schedule_name: string | null
  ww_shift_id: number
  eui_device_id: string | null
  tech_session_id: number
  full_go: number | null
  real_go: number | null
  full_work: number | null
  real_work: number | null
  full_idle: number | null
  real_idle: number | null
  full_idle_seconds: number
  real_idle_seconds: number
  full_go_seconds: number
  real_go_seconds: number
  full_work_seconds: number
  real_work_seconds: number
  full_total_seconds: number
  real_total_seconds: number
  full_long_idle_seconds: number
  full_common_idle_seconds: number
  long_data_idle_seconds: number
  long_data_total_seconds: number
  real_common_idle: number | null
  real_long_idle: number | null
}

type UploadPayload = {
  reportDate?: string
  fileName?: string
  faceFileName?: string
  longIdleFileName?: string
  rows?: BleRow[]
  faceRows?: FaceRow[] | null
  longIdleRows?: LongIdleRow[] | null
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-settings-password',
}

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders })
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const message = Reflect.get(error, 'message')
    const details = Reflect.get(error, 'details')
    const hint = Reflect.get(error, 'hint')
    const code = Reflect.get(error, 'code')
    const parts = [code, message, details, hint].filter((part) => typeof part === 'string' && part)
    if (parts.length > 0) return parts.join(' | ')
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return String(error)
}

function isAuthorized(request: Request) {
  const expectedPassword = Deno.env.get('SETTINGS_ADMIN_PASSWORD')
  const requestPassword = request.headers.get('x-settings-password')

  if (!expectedPassword) {
    return { ok: false, response: jsonResponse({ error: 'SETTINGS_ADMIN_PASSWORD is not configured' }, 500) }
  }

  if (!requestPassword || requestPassword !== expectedPassword) {
    return { ok: false, response: jsonResponse({ error: 'Invalid settings password' }, 401) }
  }

  return { ok: true as const }
}

function getAdminClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return null
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'analytics' },
  })
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

async function chunkedInsert(
  supabase: NonNullable<ReturnType<typeof getAdminClient>>,
  table: string,
  rows: Record<string, unknown>[],
) {
  if (rows.length === 0) {
    return
  }

  for (const batch of chunk(rows, 500)) {
    const { error } = await supabase.from(table).insert(batch)
    if (error) {
      throw error
    }
  }
}

async function chunkedUpsert(
  supabase: NonNullable<ReturnType<typeof getAdminClient>>,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
) {
  if (rows.length === 0) {
    return
  }

  const dedupedRows = dedupeRows(rows, (row) =>
    onConflict
      .split(',')
      .map((column) => String(row[column.trim()]))
      .join('::'),
  )

  for (const batch of chunk(dedupedRows, 500)) {
    const { error } = await supabase.from(table).upsert(batch, { onConflict })
    if (error) {
      throw error
    }
  }
}

async function fetchLookupMap(
  supabase: NonNullable<ReturnType<typeof getAdminClient>>,
  table: string,
  keyColumn: string,
  values: Array<string | null>,
) {
  const uniqueValues = [...new Set(values.filter(Boolean))]
  if (uniqueValues.length === 0) {
    return new Map<string, number>()
  }

  const { data, error } = await supabase
    .from(table)
    .select(`id, ${keyColumn}`)
    .in(keyColumn, uniqueValues)

  if (error) {
    throw error
  }

  return new Map((data ?? []).map((row) => [String(row[keyColumn]), Number(row.id)]))
}

function assertSingleReportDate(rows: { report_date: string | null }[], reportDate: string, label: string) {
  const fileDates = [...new Set(rows.map((row) => row.report_date).filter(Boolean))]
  if (fileDates.length !== 1 || fileDates[0] !== reportDate) {
    throw new Error(`Дата в ${label} не совпадает с выбранной. В файле: ${fileDates[0] ?? 'не определена'}, выбрано: ${reportDate}`)
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const auth = isAuthorized(request)
  if (!auth.ok) {
    return auth.response
  }

  const supabase = getAdminClient()
  if (!supabase) {
    return jsonResponse({ error: 'Supabase service credentials are missing' }, 500)
  }

  const payload = (await request.json().catch(() => null)) as UploadPayload | null
  const reportDate = payload?.reportDate?.trim()
  const fileName = payload?.fileName?.trim()
  const faceFileName = payload?.faceFileName?.trim()
  const longIdleFileName = payload?.longIdleFileName?.trim()
  const rows = payload?.rows
  const faceRows = payload?.faceRows
  const longIdleRows = payload?.longIdleRows

  if (!reportDate || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    return jsonResponse({ error: 'Нужна дата отчета в формате YYYY-MM-DD' }, 400)
  }

  if (!fileName || !faceFileName || !longIdleFileName) {
    return jsonResponse({ error: 'Нужны имена всех трех файлов' }, 400)
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return jsonResponse({ error: 'Не переданы строки AA_BLE' }, 400)
  }

  if (!Array.isArray(faceRows) || faceRows.length === 0) {
    return jsonResponse({ error: 'Не переданы строки faceID' }, 400)
  }

  if (!Array.isArray(longIdleRows) || longIdleRows.length === 0) {
    return jsonResponse({ error: 'Не переданы строки LongIDLE' }, 400)
  }

  try {
    assertSingleReportDate(rows, reportDate, 'AA_BLE')
    assertSingleReportDate(faceRows, reportDate, 'faceID')
    assertSingleReportDate(longIdleRows, reportDate, 'LongIDLE')
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, 400)
  }

  const invalidBleRows = rows.filter(
    (row) => !Number.isFinite(row.ww_shift_id) || !Number.isFinite(row.tech_session_id) || !row.event_at,
  )

  if (invalidBleRows.length > 0) {
    return jsonResponse({ error: 'В AA_BLE есть строки без ww_shift_id, tech_session_id или event_at' }, 400)
  }

  const invalidLongIdleRows = longIdleRows.filter(
    (row) => !Number.isFinite(row.ww_shift_id) || !Number.isFinite(row.tech_session_id),
  )

  if (invalidLongIdleRows.length > 0) {
    return jsonResponse({ error: 'В LongIDLE есть строки без ww_shift_id или tech_session_id' }, 400)
  }

  try {
    const sourceDayKey = `admin:${reportDate}`

    const { data: batchRow, error: batchError } = await supabase
      .from('import_batches')
      .upsert(
        {
          report_date: reportDate,
          source_day_key: sourceDayKey,
          status: 'importing',
          notes: 'faceID + AA_BLE + LongIDLE uploaded from admin panel',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'report_date,source_day_key' },
      )
      .select('id')
      .single<{ id: string }>()

    if (batchError) {
      throw batchError
    }

    const batchId = batchRow.id

    for (const table of ['long_idle_facts', 'ble_minute_facts', 'import_files', 'shifts']) {
      const { error } = await supabase.from(table).delete().eq('batch_id', batchId)
      if (error) {
        throw error
      }
    }

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

    const supervisorMap = await fetchLookupMap(supabase, 'supervisors', 'name', faceRows.map((row) => row.supervisor_name))
    const scheduleMap = await fetchLookupMap(supabase, 'schedules', 'name', faceRows.map((row) => row.schedule_name))
    const employeeMap = await fetchLookupMap(supabase, 'employees', 'employee_number', faceRows.map((row) => row.employee_number))

    await chunkedInsert(
      supabase,
      'import_files',
      [
        {
          batch_id: batchId,
          source_type: 'faceid',
          report_date: reportDate,
          file_name: faceFileName,
          imported_at: new Date().toISOString(),
          parse_status: 'parsed',
        },
        {
          batch_id: batchId,
          source_type: 'aa_ble',
          report_date: reportDate,
          file_name: fileName,
          imported_at: new Date().toISOString(),
          parse_status: 'parsed',
        },
        {
          batch_id: batchId,
          source_type: 'long_idle',
          report_date: reportDate,
          file_name: longIdleFileName,
          imported_at: new Date().toISOString(),
          parse_status: 'parsed',
        },
      ],
    )

    const shiftRows = faceRows.map((row) => ({
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
    })).filter((row) => row.employee_id)

    await chunkedUpsert(supabase, 'shifts', shiftRows, 'ww_shift_id')

    const { data: shiftData, error: shiftSelectError } = await supabase
      .from('shifts')
      .select('id, ww_shift_id')
      .in('ww_shift_id', shiftRows.map((row) => Number(row.ww_shift_id)))

    if (shiftSelectError) {
      throw shiftSelectError
    }

    const shiftMap = new Map((shiftData ?? []).map((row) => [Number(row.ww_shift_id), Number(row.id)]))

    const shiftIds = [...shiftMap.values()]
    if (shiftIds.length > 0) {
      const { error: sessionDeleteError } = await supabase.from('sessions').delete().in('shift_id', shiftIds)
      if (sessionDeleteError) {
        throw sessionDeleteError
      }
    }

    const sessionRows = faceRows.flatMap((row) =>
      row.tech_session_ids.map((techSessionId) => ({
        shift_id: shiftMap.get(row.ww_shift_id),
        tech_session_id: techSessionId,
      })),
    ).filter((row) => row.shift_id)

    if (sessionRows.length > 0) {
      await chunkedUpsert(supabase, 'sessions', sessionRows, 'tech_session_id')
    }

    await chunkedInsert(
      supabase,
      'ble_minute_facts',
      rows.map((row) => ({
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

    await chunkedInsert(
      supabase,
      'long_idle_facts',
      longIdleRows.map((row) => ({
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
      })),
    )

    const { error: readyError } = await supabase
      .from('import_batches')
      .update({
        status: 'ready',
        updated_at: new Date().toISOString(),
      })
      .eq('id', batchId)

    if (readyError) {
      throw readyError
    }

    return jsonResponse({
      ok: true,
      batchId,
      reportDate,
      importedRows: rows.length,
      importedBleRows: rows.length,
      importedFaceRows: faceRows.length,
      importedLongIdleRows: longIdleRows.length,
    })
  } catch (error) {
    const message = getErrorMessage(error)
    return jsonResponse({ error: message }, 500)
  }
})
