import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { DRIVE_ARCHIVE_FOLDERS } from './parsers.ts'
import {
  downloadDriveFile,
  findReportFilesForDate,
  getRequiredMissingSources,
} from './drive.ts'
import {
  filesUnchanged,
  getBatchImportFiles,
  getReadyBatch,
  importDailyBatch,
  markImportBatchFailed,
} from './import-batch.ts'
import {
  normalizeReportDateInput,
  parseBleRowsFromBuffer,
  parseFaceRowsFromBuffer,
  parseIdleEpisodeRowsFromBuffer,
  parseLongIdleRowsFromBuffer,
  type SourceType,
} from './parsers.ts'

const ALL_SOURCES: SourceType[] = ['faceid', 'aa_ble', 'long_idle', 'idle_episode']

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

async function triggerPostImportSend(reportDate: string) {
  const url = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('VITE_SUPABASE_PUBLISHABLE_KEY')
  const cronSecret = Deno.env.get('REPORT_CRON_SECRET')
  const adminPassword = Deno.env.get('SETTINGS_ADMIN_PASSWORD')

  if (!url) return

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

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

async function syncDriveReport(options: { reportDate: string; force: boolean }) {
  const { reportDate, force } = options
  const folderId = Deno.env.get('GOOGLE_DRIVE_FOLDER_ID') ?? '1GozRP1VvLFkZooW9dQYuI_O-c5tqmRfO'
  const supabase = getAdminClient()
  if (!supabase) throw new Error('Supabase service credentials are missing')

  const sourceDayKey = `drive:${reportDate}`
  const reportFiles = await findReportFilesForDate(folderId, reportDate)
  const missingSources = getRequiredMissingSources(reportFiles)

  if (missingSources.length > 0) {
    const folderHints = missingSources.map((sourceType) => `${sourceType} → ${DRIVE_ARCHIVE_FOLDERS[sourceType]}`).join('; ')
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

  let faceRows: ReturnType<typeof parseFaceRowsFromBuffer> = []
  if (reportFiles.faceid) {
    const faceBytes = await downloadDriveFile(reportFiles.faceid.id)
    faceRows = parseFaceRowsFromBuffer(faceBytes)
  }

  const bleBytes = await downloadDriveFile(reportFiles.aa_ble!.id)
  const longIdleBytes = await downloadDriveFile(reportFiles.long_idle!.id)

  const bleRows = parseBleRowsFromBuffer(bleBytes)
  const longIdleRows = parseLongIdleRowsFromBuffer(longIdleBytes)

  let idleEpisodeRows: ReturnType<typeof parseIdleEpisodeRowsFromBuffer> = []
  if (reportFiles.idle_episode) {
    const idleEpisodeBytes = await downloadDriveFile(reportFiles.idle_episode.id)
    idleEpisodeRows = parseIdleEpisodeRowsFromBuffer(idleEpisodeBytes)
  }

  const result = await importDailyBatch(supabase, {
    reportDate,
    sourceDayKey,
    notes: 'Imported from Google Drive (Supabase cron)',
    faceRows,
    bleRows,
    longIdleRows,
    idleEpisodeRows,
    files: nextFileMeta,
  })

  return { ok: true as const, skipped: false as const, ...result }
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
    const payload = (await request.json().catch(() => ({}))) as { date?: string; force?: boolean }
    const reportDate = normalizeReportDateInput(payload.date) ?? getYesterdayMoscowDate()
    const result = await syncDriveReport({ reportDate, force: payload.force === true })

    if (!result.ok) {
      return jsonResponse(result, 400)
    }

    if (!result.skipped) {
      await triggerPostImportSend(reportDate)
    }

    return jsonResponse(result)
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, 500)
  }
})
