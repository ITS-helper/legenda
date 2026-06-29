import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as XLSX from 'https://esm.sh/xlsx@0.18.5'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-settings-password',
}

const DEFAULT_STORAGE_BUCKET = 'admin-imports'

type UploadAction = 'sign-upload' | 'import'

type UploadPayload = {
  action?: UploadAction
  reportDate?: string
  fileName?: string
  storageBucket?: string
  storagePath?: string
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

  for (const batch of chunk(rows, 1000)) {
    const { error } = await supabase.from(table).insert(batch)
    if (error) {
      throw error
    }
  }
}

function pickSheet(workbook: XLSX.WorkBook) {
  if (workbook.Sheets.Sheet2) {
    return workbook.Sheets.Sheet2
  }

  const firstSheetName = workbook.SheetNames[0]
  return firstSheetName ? workbook.Sheets[firstSheetName] : null
}

function parseBleRows(fileBytes: Uint8Array) {
  const workbook = XLSX.read(fileBytes, { type: 'array', cellDates: true })
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

async function ensureStorageBucket(supabase: NonNullable<ReturnType<typeof getAdminClient>>, bucketName: string) {
  const { data: bucketData, error: bucketLookupError } = await supabase.storage.getBucket(bucketName)

  if (!bucketLookupError && bucketData) {
    return
  }

  const { error: createBucketError } = await supabase.storage.createBucket(bucketName, {
    public: false,
    fileSizeLimit: 52_428_800,
    allowedMimeTypes: [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
  })

  if (createBucketError && !createBucketError.message.toLowerCase().includes('already')) {
    throw new Error(`Не удалось подготовить Storage bucket: ${createBucketError.message}`)
  }
}

async function signUpload(
  supabase: NonNullable<ReturnType<typeof getAdminClient>>,
  reportDate: string,
  fileName: string,
  storageBucket: string,
  storagePath: string,
) {
  await ensureStorageBucket(supabase, storageBucket)

  const { data, error } = await supabase.storage.from(storageBucket).createSignedUploadUrl(storagePath, {
    upsert: true,
  })

  if (error || !data?.token) {
    throw new Error(error?.message ?? 'Не удалось создать подписанную загрузку')
  }

  return jsonResponse({
    ok: true,
    action: 'sign-upload',
    reportDate,
    fileName,
    storageBucket,
    storagePath,
    token: data.token,
    signedUrl: data.signedUrl,
  })
}

async function importReport(
  supabase: NonNullable<ReturnType<typeof getAdminClient>>,
  reportDate: string,
  fileName: string,
  storageBucket: string,
  storagePath: string,
) {
  const { data: fileBlob, error: downloadError } = await supabase.storage.from(storageBucket).download(storagePath)

  if (downloadError) {
    throw new Error(`Не удалось скачать файл из Storage: ${downloadError.message}`)
  }

  const fileBytes = new Uint8Array(await fileBlob.arrayBuffer())
  const bleRows = parseBleRows(fileBytes)

  if (bleRows.length === 0) {
    return jsonResponse({ error: 'Файл не содержит строк для импорта' }, 400)
  }

  const fileDates = [...new Set(bleRows.map((row) => row.report_date).filter(Boolean))]

  if (fileDates.length !== 1 || fileDates[0] !== reportDate) {
    return jsonResponse(
      {
        error: `Дата в файле не совпадает с выбранной. В файле: ${fileDates[0] ?? 'не определена'}, выбрано: ${reportDate}`,
      },
      400,
    )
  }

  const invalidRows = bleRows.filter(
    (row) => !Number.isFinite(row.ww_shift_id) || !Number.isFinite(row.tech_session_id) || !row.event_at,
  )

  if (invalidRows.length > 0) {
    return jsonResponse({ error: 'В файле есть строки без ww_shift_id, tech_session_id или event_at' }, 400)
  }

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
    raw_storage_path: `${storageBucket}/${storagePath}`,
  })

  if (importFileError) {
    throw importFileError
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

  await supabase.storage.from(storageBucket).remove([storagePath])

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
    importedRows: bleRows.length,
  })
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
  const action = payload?.action
  const reportDate = payload?.reportDate?.trim()
  const fileName = payload?.fileName?.trim()
  const storageBucket = payload?.storageBucket?.trim() || DEFAULT_STORAGE_BUCKET
  const storagePath = payload?.storagePath?.trim()

  if (!action || (action !== 'sign-upload' && action !== 'import')) {
    return jsonResponse({ error: 'Не указано действие функции' }, 400)
  }

  if (!reportDate || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    return jsonResponse({ error: 'Нужна дата отчета в формате YYYY-MM-DD' }, 400)
  }

  if (!fileName) {
    return jsonResponse({ error: 'Не указано имя файла' }, 400)
  }

  if (!storagePath) {
    return jsonResponse({ error: 'Не передан путь к файлу в Storage' }, 400)
  }

  try {
    if (action === 'sign-upload') {
      return await signUpload(supabase, reportDate, fileName, storageBucket, storagePath)
    }

    return await importReport(supabase, reportDate, fileName, storageBucket, storagePath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return jsonResponse({ error: message }, 500)
  }
})
