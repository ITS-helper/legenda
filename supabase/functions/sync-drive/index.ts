import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { DRIVE_ARCHIVE_FOLDERS } from './parsers.ts'
import {
  ensureSyncBuffer,
  findReportFilesForDate,
  getBufferDataRowCount,
  getRequiredMissingSources,
  loadFileIntoBuffer,
  readBufferRows,
} from './drive.ts'
import {
  filesUnchanged,
  finalizeDailyBatch,
  getActiveImportingBatch,
  getBatchImportFiles,
  getReadyBatch,
  insertBleRowsChunk,
  markImportBatchFailed,
  prepareDailyBatch,
  touchImportBatch,
} from './import-batch.ts'
import {
  filterDataRows,
  mapBleRow,
  mapFaceRow,
  mapIdleEpisodeRow,
  mapLongIdleRow,
  normalizeReportDateInput,
  type SourceType,
} from './parsers.ts'

const ALL_SOURCES: SourceType[] = ['faceid', 'aa_ble', 'long_idle', 'idle_episode']

/** Строк AA_BLE на одно звено цепочки — каждое звено в своих лимитах CPU/памяти. */
const BLE_CHUNK_ROWS = 6000

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-settings-password, x-report-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders })
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

function isAuthorized(request: Request) {
  const cronSecret = Deno.env.get('REPORT_CRON_SECRET')
  const requestCronSecret = request.headers.get('x-report-cron-secret')
  if (requestCronSecret) {
    if (!cronSecret || requestCronSecret !== cronSecret) {
      return { ok: false, response: jsonResponse({ error: 'Неверный cron-секрет' }, 401) }
    }
    return { ok: true as const }
  }

  const expectedPassword = Deno.env.get('SETTINGS_ADMIN_PASSWORD')
  const requestPassword = request.headers.get('x-settings-password')
  if (!expectedPassword) {
    return { ok: false, response: jsonResponse({ error: 'SETTINGS_ADMIN_PASSWORD is not configured' }, 500) }
  }
  if (!requestPassword || requestPassword !== expectedPassword) {
    return { ok: false, response: jsonResponse({ error: 'Неверный пароль админки' }, 401) }
  }
  return { ok: true as const }
}

function getAdminClient() {
  const url = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'analytics' },
  })
}

type BleChainState = {
  phase: 'ble'
  date: string
  batch_id: number
  buffer_id: string
  next_row: number
  total_rows: number
  inserted: number
  faceid_pending: boolean
}

/** Следующее звено цепочки: pg_net из базы вызывает эту же функцию с состоянием. */
async function enqueueContinuation(supabase: NonNullable<ReturnType<typeof getAdminClient>>, state: BleChainState) {
  const { error } = await supabase.rpc('invoke_sync_drive_payload', { p_body: state })
  if (error) throw new Error(`Не удалось поставить продолжение импорта: ${error.message}`)
}

/**
 * Рассылка после импорта: по умолчанию ВЫКЛЮЧЕНА — письма отправляются вручную
 * из админки. Включается только секретом SEND_AFTER_IMPORT=true.
 */
async function triggerPostImportSend(reportDate: string) {
  if (Deno.env.get('SEND_AFTER_IMPORT') !== 'true') return

  const url = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('VITE_SUPABASE_PUBLISHABLE_KEY')
  const cronSecret = Deno.env.get('REPORT_CRON_SECRET')
  const adminPassword = Deno.env.get('SETTINGS_ADMIN_PASSWORD')

  if (!url) return

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cronSecret) {
    headers['x-report-cron-secret'] = cronSecret
  } else if (anonKey && adminPassword) {
    headers.apikey = anonKey
    headers.Authorization = `Bearer ${anonKey}`
    headers['x-settings-password'] = adminPassword
  } else {
    return
  }
  headers['x-triggered-by'] = 'post-import'

  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/functions/v1/send-report`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'daily', date: reportDate }),
    })
    const body = await response.text()
    console.log('post-import send-report:', response.status, body)
  } catch (error) {
    console.error('post-import send-report failed:', getErrorMessage(error))
  }
}

function getYesterdayMoscowDate() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const moscowToday = formatter.format(new Date())
  const todayUtc = new Date(`${moscowToday}T00:00:00Z`)
  todayUtc.setUTCDate(todayUtc.getUTCDate() - 1)
  return todayUtc.toISOString().slice(0, 10)
}

/** Стартовая фаза: файлы, мелкие источники, подготовка батча, запуск цепочки AA_BLE. */
async function startSync(options: { reportDate: string; force: boolean }) {
  const { reportDate, force } = options
  const folderId = Deno.env.get('GOOGLE_DRIVE_FOLDER_ID') ?? '1GozRP1VvLFkZooW9dQYuI_O-c5tqmRfO'
  const supabase = getAdminClient()
  if (!supabase) throw new Error('Supabase service credentials are missing')

  const sourceDayKey = `drive:${reportDate}`

  // Цепочка уже идёт (heartbeat свежий) — не запускать параллельный импорт.
  if (!force) {
    const active = await getActiveImportingBatch(supabase, reportDate, sourceDayKey)
    if (active) {
      return { ok: true as const, skipped: true as const, reportDate, reason: 'Импорт уже выполняется' }
    }
  }

  const reportFiles = await findReportFilesForDate(folderId, reportDate)
  const missingSources = getRequiredMissingSources(reportFiles)

  if (missingSources.length > 0) {
    const folderHints = missingSources
      .map((sourceType) => `${sourceType} → ${DRIVE_ARCHIVE_FOLDERS[sourceType]}`)
      .join('; ')
    const message = `Не найдены файлы за ${reportDate}: ${missingSources.join(', ')} (${folderHints})`
    await markImportBatchFailed(supabase, reportDate, sourceDayKey, message)
    return { ok: false as const, skipped: false as const, reportDate, error: message }
  }

  const presentSources = ALL_SOURCES.filter((sourceType) => reportFiles[sourceType])
  const nextFileMeta = presentSources.map((sourceType) => {
    const file = reportFiles[sourceType]!
    return {
      sourceType,
      fileName: file.name,
      googleFileId: file.id,
      fileChecksum: file.md5Checksum ?? null,
      mimeType: file.mimeType ?? null,
    }
  })

  if (!force) {
    const existingBatch = await getReadyBatch(supabase, reportDate, sourceDayKey)
    if (existingBatch?.status === 'ready') {
      const existingFiles = await getBatchImportFiles(supabase, existingBatch.id as number)
      if (filesUnchanged(existingFiles, nextFileMeta)) {
        return {
          ok: true as const,
          skipped: true as const,
          reportDate,
          reason: 'Batch already imported with the same Google file ids',
        }
      }
    }
  }

  const bufferId = await ensureSyncBuffer(folderId)

  const readSource = async (fileId: string) => {
    await loadFileIntoBuffer(bufferId, fileId)
    const rowCount = await getBufferDataRowCount(bufferId)
    if (rowCount < 2) return []
    return filterDataRows(await readBufferRows(bufferId, 2, rowCount))
  }

  const faceRows = reportFiles.faceid ? (await readSource(reportFiles.faceid.id)).map(mapFaceRow) : []
  const longIdleRows = (await readSource(reportFiles.long_idle!.id)).map(mapLongIdleRow)
  const idleEpisodeRows = reportFiles.idle_episode
    ? (await readSource(reportFiles.idle_episode.id)).map(mapIdleEpisodeRow)
    : []

  // AA_BLE — последним: его содержимое остаётся в буфере для звеньев цепочки.
  await loadFileIntoBuffer(bufferId, reportFiles.aa_ble!.id)
  const bleTotalRows = await getBufferDataRowCount(bufferId)
  if (bleTotalRows < 2) {
    const message = 'AA_BLE не содержит строк для импорта'
    await markImportBatchFailed(supabase, reportDate, sourceDayKey, message)
    return { ok: false as const, skipped: false as const, reportDate, error: message }
  }

  const prepared = await prepareDailyBatch(supabase, {
    reportDate,
    sourceDayKey,
    notes: 'Imported from Google Drive (Supabase cron)',
    faceRows,
    longIdleRows,
    idleEpisodeRows,
    files: nextFileMeta,
  })

  await enqueueContinuation(supabase, {
    phase: 'ble',
    date: reportDate,
    batch_id: prepared.batchId,
    buffer_id: bufferId,
    next_row: 2,
    total_rows: bleTotalRows,
    inserted: 0,
    faceid_pending: prepared.faceidPending,
  })

  return {
    ok: true as const,
    skipped: false as const,
    chained: true,
    reportDate,
    ...prepared,
    bleTotalRows: bleTotalRows - 1,
  }
}

/** Звено цепочки: одна порция AA_BLE, затем следующее звено или финализация. */
async function continueBleImport(state: BleChainState) {
  const supabase = getAdminClient()
  if (!supabase) throw new Error('Supabase service credentials are missing')

  const sourceDayKey = `drive:${state.date}`

  try {
    const toRow = Math.min(state.next_row + BLE_CHUNK_ROWS - 1, state.total_rows)
    const rows = filterDataRows(await readBufferRows(state.buffer_id, state.next_row, toRow))
    const bleRows = rows.map(mapBleRow)
    await insertBleRowsChunk(supabase, state.batch_id, bleRows)

    const inserted = state.inserted + bleRows.length
    const nextRow = toRow + 1

    if (nextRow <= state.total_rows) {
      await touchImportBatch(supabase, state.batch_id)
      await enqueueContinuation(supabase, { ...state, next_row: nextRow, inserted })
      return {
        ok: true as const,
        phase: 'ble' as const,
        chained: true,
        reportDate: state.date,
        insertedSoFar: inserted,
        totalRows: state.total_rows - 1,
      }
    }

    await finalizeDailyBatch(supabase, state.batch_id)
    await triggerPostImportSend(state.date)
    console.log(
      `sync-drive done: ${state.date}, ble rows ${inserted}, faceid_pending ${state.faceid_pending}`,
    )
    return {
      ok: true as const,
      phase: 'ble' as const,
      chained: false,
      reportDate: state.date,
      importedBleRows: inserted,
      faceidPending: state.faceid_pending,
    }
  } catch (error) {
    const message = `AA_BLE импорт прерван на строке ${state.next_row}: ${getErrorMessage(error)}`
    await markImportBatchFailed(supabase, state.date, sourceDayKey, message)
    throw new Error(message)
  }
}

/** Диагностика по шагам: {"debug":N,"date":"YYYY-MM-DD"} — до какого шага доходит. */
async function runDebugSteps(level: number, reportDate: string) {
  const folderId = Deno.env.get('GOOGLE_DRIVE_FOLDER_ID') ?? '1GozRP1VvLFkZooW9dQYuI_O-c5tqmRfO'
  const timings: Record<string, number> = {}
  const mark = (name: string, start: number) => {
    timings[name] = Date.now() - start
  }

  let t = Date.now()
  const reportFiles = await findReportFilesForDate(folderId, reportDate)
  mark('find_files', t)
  if (level <= 1) return { timings, files: Object.fromEntries(Object.entries(reportFiles).map(([k, v]) => [k, v?.name ?? null])) }

  t = Date.now()
  const bufferId = await ensureSyncBuffer(folderId)
  mark('ensure_buffer', t)
  if (level <= 2) return { timings, bufferId }

  t = Date.now()
  await loadFileIntoBuffer(bufferId, reportFiles.long_idle!.id)
  mark('load_long_idle', t)
  if (level <= 3) return { timings }

  t = Date.now()
  const rowCount = await getBufferDataRowCount(bufferId)
  const rows = filterDataRows(await readBufferRows(bufferId, 2, rowCount))
  const longIdleRows = rows.map(mapLongIdleRow)
  mark('read_long_idle', t)
  if (level <= 4) return { timings, longIdleRows: longIdleRows.length }

  t = Date.now()
  await loadFileIntoBuffer(bufferId, reportFiles.aa_ble!.id)
  mark('load_aa_ble', t)
  if (level <= 5) return { timings }

  t = Date.now()
  const bleTotal = await getBufferDataRowCount(bufferId)
  const blePage = filterDataRows(await readBufferRows(bufferId, 2, 2001)).map(mapBleRow)
  mark('read_ble_page', t)
  return { timings, bleTotal, blePageRows: blePage.length, sample: blePage[0] ?? null }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const auth = isAuthorized(request)
  if (!auth.ok) return auth.response

  try {
    const payload = (await request.json().catch(() => ({}))) as {
      date?: string
      force?: boolean
      phase?: string
      debug?: number
    } & Partial<BleChainState>

    if (typeof payload.debug === 'number') {
      const reportDate = normalizeReportDateInput(payload.date) ?? getYesterdayMoscowDate()
      const result = await runDebugSteps(payload.debug, reportDate)
      return jsonResponse({ ok: true, debug: payload.debug, ...result })
    }

    if (payload.phase === 'ble') {
      const result = await continueBleImport(payload as BleChainState)
      return jsonResponse(result)
    }

    const reportDate = normalizeReportDateInput(payload.date) ?? getYesterdayMoscowDate()
    const result = await startSync({ reportDate, force: payload.force === true })
    return jsonResponse(result, result.ok ? 200 : 400)
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, 500)
  }
})
