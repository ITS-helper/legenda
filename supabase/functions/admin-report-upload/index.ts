import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-settings-password',
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

type UploadPayload = {
  reportDate?: string
  fileName?: string
  rows?: BleRow[]
}

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders })
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
  const rows = payload?.rows

  if (!reportDate || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    return jsonResponse({ error: 'Нужна дата отчета в формате YYYY-MM-DD' }, 400)
  }

  if (!fileName) {
    return jsonResponse({ error: 'Не указано имя файла' }, 400)
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return jsonResponse({ error: 'Не переданы строки отчета' }, 400)
  }

  const fileDates = [...new Set(rows.map((row) => row.report_date).filter(Boolean))]
  if (fileDates.length !== 1 || fileDates[0] !== reportDate) {
    return jsonResponse(
      {
        error: `Дата в файле не совпадает с выбранной. В файле: ${fileDates[0] ?? 'не определена'}, выбрано: ${reportDate}`,
      },
      400,
    )
  }

  const invalidRows = rows.filter(
    (row) => !Number.isFinite(row.ww_shift_id) || !Number.isFinite(row.tech_session_id) || !row.event_at,
  )

  if (invalidRows.length > 0) {
    return jsonResponse({ error: 'В файле есть строки без ww_shift_id, tech_session_id или event_at' }, 400)
  }

  try {
    const sourceDayKey = `admin-aa-ble:${reportDate}`

    const { data: batchRow, error: batchError } = await supabase
      .from('import_batches')
      .upsert(
        {
          report_date: reportDate,
          source_day_key: sourceDayKey,
          status: 'importing',
          notes: 'AA_BLE uploaded from admin panel',
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

    const { error: deleteFactsError } = await supabase.from('ble_minute_facts').delete().eq('report_date', reportDate)
    if (deleteFactsError) {
      throw deleteFactsError
    }

    const { error: deleteFilesError } = await supabase
      .from('import_files')
      .delete()
      .eq('report_date', reportDate)
      .eq('source_type', 'aa_ble')

    if (deleteFilesError) {
      throw deleteFilesError
    }

    const { error: importFileError } = await supabase.from('import_files').insert({
      batch_id: batchId,
      source_type: 'aa_ble',
      report_date: reportDate,
      file_name: fileName,
      mime_type: fileName.toLowerCase().endsWith('.xls')
        ? 'application/vnd.ms-excel'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      imported_at: new Date().toISOString(),
      parse_status: 'parsed',
    })

    if (importFileError) {
      throw importFileError
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
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return jsonResponse({ error: message }, 500)
  }
})
