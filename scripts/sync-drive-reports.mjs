import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'
import {
  getBatchImportFiles,
  getReadyBatch,
  importDailyBatch,
  markImportBatchFailed,
} from './lib/import-batch.mjs'
import {
  DRIVE_ARCHIVE_FOLDERS,
  normalizeReportDateInput,
  parseBleRows,
  parseFaceRows,
  parseLongIdleRows,
  REPORT_FILE_PATTERNS,
} from './lib/report-parsers.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(projectRoot, '.env.local') })
dotenv.config({ path: path.join(projectRoot, '.env') })

const REQUIRED_SOURCES = ['faceid', 'aa_ble', 'long_idle']

function getArg(flagName) {
  const index = process.argv.indexOf(flagName)
  if (index === -1) {
    return null
  }

  return process.argv[index + 1] ?? null
}

function hasFlag(flagName) {
  return process.argv.includes(flagName)
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

function normalizePrivateKey(raw) {
  if (!raw) {
    return ''
  }

  let key = raw.trim()
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1)
  }

  key = key.replace(/\\n/g, '\n')

  if (!key.includes('\n') && key.includes('-----BEGIN PRIVATE KEY-----')) {
    key = key
      .replace('-----BEGIN PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----\n')
      .replace('-----END PRIVATE KEY-----', '\n-----END PRIVATE KEY-----\n')
  }

  return key
}

function getServiceAccountCredentials() {
  const jsonSecret = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()
  if (jsonSecret) {
    const parsed = JSON.parse(jsonSecret)
    const email = parsed.client_email
    const privateKey = normalizePrivateKey(parsed.private_key)

    if (!email || !privateKey) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON must include client_email and private_key')
    }

    return { email, privateKey }
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim()
  const privateKey = normalizePrivateKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)

  if (!email || !privateKey) {
    throw new Error(
      'Set GOOGLE_SERVICE_ACCOUNT_JSON or both GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
    )
  }

  return { email, privateKey }
}

function getDriveClient() {
  const { email, privateKey } = getServiceAccountCredentials()

  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  })

  return google.drive({ version: 'v3', auth })
}

async function listDriveChildren(drive, parentFolderId) {
  const items = []
  let pageToken

  do {
    const response = await drive.files.list({
      q: `'${parentFolderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, md5Checksum, modifiedTime)',
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })

    items.push(...(response.data.files ?? []))
    pageToken = response.data.nextPageToken ?? undefined
  } while (pageToken)

  return items
}

async function listXlsxFilesRecursively(drive, rootFolderId) {
  const files = []
  const folders = [rootFolderId]

  while (folders.length > 0) {
    const folderId = folders.pop()
    const children = await listDriveChildren(drive, folderId)

    for (const item of children) {
      if (item.mimeType === 'application/vnd.google-apps.folder') {
        folders.push(item.id)
        continue
      }

      if (/\.xlsx?$/i.test(item.name ?? '')) {
        files.push(item)
      }
    }
  }

  return files
}

async function resolveArchiveFolderIds(drive, rootFolderId) {
  const children = await listDriveChildren(drive, rootFolderId)
  const foldersByName = new Map(
    children
      .filter((item) => item.mimeType === 'application/vnd.google-apps.folder' && item.name && item.id)
      .map((item) => [item.name.toLowerCase(), item.id]),
  )

  const archiveFolderIds = {}

  for (const sourceType of REQUIRED_SOURCES) {
    const folderName = DRIVE_ARCHIVE_FOLDERS[sourceType]
    const folderId = foldersByName.get(folderName.toLowerCase())

    if (!folderId) {
      throw new Error(`В корне LEGENDA не найдена папка архива: ${folderName}`)
    }

    archiveFolderIds[sourceType] = folderId
  }

  return archiveFolderIds
}

async function listReportFilesFromArchives(drive, rootFolderId) {
  const archiveFolderIds = await resolveArchiveFolderIds(drive, rootFolderId)
  const filesBySource = {}

  for (const sourceType of REQUIRED_SOURCES) {
    filesBySource[sourceType] = await listXlsxFilesRecursively(drive, archiveFolderIds[sourceType])
  }

  return filesBySource
}

function findReportFileForDate(files, sourceType, reportDate) {
  const pattern = REPORT_FILE_PATTERNS[sourceType]

  for (const file of files) {
    const match = file.name?.match(pattern)
    if (match?.[1] === reportDate) {
      return file
    }
  }

  return null
}

function findReportFilesForDate(filesBySource, reportDate) {
  return {
    faceid: findReportFileForDate(filesBySource.faceid, 'faceid', reportDate),
    aa_ble: findReportFileForDate(filesBySource.aa_ble, 'aa_ble', reportDate),
    long_idle: findReportFileForDate(filesBySource.long_idle, 'long_idle', reportDate),
  }
}

async function downloadDriveFile(drive, file, targetDir) {
  const targetPath = path.join(targetDir, file.name)
  const response = await drive.files.get(
    { fileId: file.id, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' },
  )

  fs.writeFileSync(targetPath, Buffer.from(response.data))
  return targetPath
}

function filesUnchanged(existingFiles, nextFiles) {
  if (existingFiles.length !== nextFiles.length) {
    return false
  }

  const existingMap = new Map(existingFiles.map((file) => [file.source_type, file.google_file_id ?? '']))
  return nextFiles.every((file) => existingMap.get(file.sourceType) === (file.googleFileId ?? ''))
}

async function main() {
  const reportDate = normalizeReportDateInput(getArg('--date')) ?? getYesterdayMoscowDate()
  const force = hasFlag('--force')
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID ?? '1GozRP1VvLFkZooW9dQYuI_O-c5tqmRfO'
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'analytics' },
  })

  const sourceDayKey = `drive:${reportDate}`
  const drive = getDriveClient()
  const filesBySource = await listReportFilesFromArchives(drive, folderId)
  const reportFiles = findReportFilesForDate(filesBySource, reportDate)

  const missingSources = REQUIRED_SOURCES.filter((sourceType) => !reportFiles[sourceType])
  if (missingSources.length > 0) {
    const folderHints = missingSources
      .map((sourceType) => `${sourceType} → ${DRIVE_ARCHIVE_FOLDERS[sourceType]}`)
      .join('; ')
    const message = `Не найдены файлы за ${reportDate}: ${missingSources.join(', ')} (${folderHints})`
    await markImportBatchFailed(supabase, reportDate, sourceDayKey, message)
    throw new Error(message)
  }

  const nextFileMeta = REQUIRED_SOURCES.map((sourceType) => ({
    sourceType,
    fileName: reportFiles[sourceType].name,
    googleFileId: reportFiles[sourceType].id,
    fileChecksum: reportFiles[sourceType].md5Checksum ?? null,
    mimeType: reportFiles[sourceType].mimeType ?? null,
  }))

  if (!force) {
    const existingBatch = await getReadyBatch(supabase, reportDate, sourceDayKey)
    if (existingBatch?.status === 'ready') {
      const existingFiles = await getBatchImportFiles(supabase, existingBatch.id)
      if (filesUnchanged(existingFiles, nextFileMeta)) {
        console.log(
          JSON.stringify(
            {
              skipped: true,
              reportDate,
              reason: 'Batch already imported with the same Google file ids',
            },
            null,
            2,
          ),
        )
        return
      }
    }
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legenda-drive-import-'))
  try {
    const facePath = await downloadDriveFile(drive, reportFiles.faceid, tempDir)
    const blePath = await downloadDriveFile(drive, reportFiles.aa_ble, tempDir)
    const longIdlePath = await downloadDriveFile(drive, reportFiles.long_idle, tempDir)

    const faceRows = parseFaceRows(facePath)
    const bleRows = parseBleRows(blePath)
    const longIdleRows = parseLongIdleRows(longIdlePath)

    const result = await importDailyBatch(supabase, {
      reportDate,
      sourceDayKey,
      notes: 'Imported from Google Drive',
      faceRows,
      bleRows,
      longIdleRows,
      files: nextFileMeta,
    })

    console.log(JSON.stringify({ ...result, skipped: false }, null, 2))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await markImportBatchFailed(supabase, reportDate, sourceDayKey, message)
    throw error
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
