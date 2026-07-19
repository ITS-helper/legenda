import { google } from 'npm:googleapis@140.0.1'
import { DRIVE_ARCHIVE_FOLDERS, REPORT_FILE_PATTERNS, type SourceType } from './parsers.ts'

const REQUIRED_SOURCES: SourceType[] = ['aa_ble', 'long_idle']
const OPTIONAL_SOURCES: SourceType[] = ['faceid', 'idle_episode']
const ALL_SOURCES: SourceType[] = [...REQUIRED_SOURCES, ...OPTIONAL_SOURCES]

/**
 * Постоянная буферная Google-таблица в корне LEGENDA: files.update заливает в неё
 * очередной XLSX (Drive конвертирует на месте), Sheets API отдаёт значения
 * постранично. Так edge-функция не разбирает XLSX сама (это упиралось в
 * WORKER_RESOURCE_LIMIT) и не плодит копий (удалять их у сервисного аккаунта прав нет).
 */
const SYNC_BUFFER_NAME = 'zz-tech-sync-buffer (не удалять)'
const DATA_SHEET = 'Sheet2'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export type DriveFile = {
  id: string
  name: string
  md5Checksum?: string | null
  mimeType?: string | null
}

function normalizePrivateKey(raw: string) {
  let key = raw.trim()
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
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
  const jsonSecret = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')?.trim()
  if (jsonSecret) {
    const parsed = JSON.parse(jsonSecret) as { client_email?: string; private_key?: string }
    const email = parsed.client_email
    const privateKey = normalizePrivateKey(parsed.private_key ?? '')
    if (!email || !privateKey) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON must include client_email and private_key')
    }
    return { email, privateKey }
  }

  const email = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL')?.trim()
  const privateKey = normalizePrivateKey(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY') ?? '')
  if (!email || !privateKey) {
    throw new Error('Google service account credentials are not configured')
  }
  return { email, privateKey }
}

function getGoogleAuth() {
  const { email, privateKey } = getServiceAccountCredentials()
  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets.readonly',
    ],
  })
}

function getDriveClient() {
  return google.drive({ version: 'v3', auth: getGoogleAuth() })
}

function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: getGoogleAuth() })
}

async function listDriveChildren(drive: ReturnType<typeof getDriveClient>, parentFolderId: string) {
  const items: DriveFile[] = []
  let pageToken: string | undefined

  do {
    const response = await drive.files.list({
      q: `'${parentFolderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, md5Checksum, modifiedTime)',
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })

    for (const file of response.data.files ?? []) {
      if (file.id && file.name) {
        items.push({
          id: file.id,
          name: file.name,
          md5Checksum: file.md5Checksum,
          mimeType: file.mimeType,
        })
      }
    }
    pageToken = response.data.nextPageToken ?? undefined
  } while (pageToken)

  return items
}

async function listXlsxFilesRecursively(drive: ReturnType<typeof getDriveClient>, rootFolderId: string) {
  const files: DriveFile[] = []
  const folders = [rootFolderId]

  while (folders.length > 0) {
    const folderId = folders.pop()!
    const children = await listDriveChildren(drive, folderId)
    for (const item of children) {
      if (item.mimeType === 'application/vnd.google-apps.folder') {
        folders.push(item.id)
        continue
      }
      if (/\.xlsx?$/i.test(item.name)) {
        files.push(item)
      }
    }
  }

  return files
}

async function resolveArchiveFolderIds(drive: ReturnType<typeof getDriveClient>, rootFolderId: string) {
  const children = await listDriveChildren(drive, rootFolderId)
  const foldersByName = new Map(
    children
      .filter((item) => item.mimeType === 'application/vnd.google-apps.folder')
      .map((item) => [item.name.toLowerCase(), item.id]),
  )

  const archiveFolderIds: Partial<Record<SourceType, string>> = {}
  for (const sourceType of ALL_SOURCES) {
    const folderName = DRIVE_ARCHIVE_FOLDERS[sourceType]
    const folderId = foldersByName.get(folderName.toLowerCase())
    if (!folderId) {
      if (REQUIRED_SOURCES.includes(sourceType)) {
        throw new Error(`В корне LEGENDA не найдена папка архива: ${folderName}`)
      }
      continue
    }
    archiveFolderIds[sourceType] = folderId
  }
  return archiveFolderIds
}

function findReportFileForDate(files: DriveFile[], sourceType: SourceType, reportDate: string) {
  const pattern = REPORT_FILE_PATTERNS[sourceType]
  for (const file of files) {
    const match = file.name.match(pattern)
    if (match?.[1] === reportDate) return file
  }
  return null
}

export async function findReportFilesForDate(rootFolderId: string, reportDate: string) {
  const drive = getDriveClient()
  const archiveFolderIds = await resolveArchiveFolderIds(drive, rootFolderId)
  const filesBySource: Partial<Record<SourceType, DriveFile[]>> = {}

  for (const sourceType of ALL_SOURCES) {
    const folderId = archiveFolderIds[sourceType]
    filesBySource[sourceType] = folderId ? await listXlsxFilesRecursively(drive, folderId) : []
  }

  return {
    faceid: findReportFileForDate(filesBySource.faceid ?? [], 'faceid', reportDate),
    aa_ble: findReportFileForDate(filesBySource.aa_ble ?? [], 'aa_ble', reportDate),
    long_idle: findReportFileForDate(filesBySource.long_idle ?? [], 'long_idle', reportDate),
    idle_episode: findReportFileForDate(filesBySource.idle_episode ?? [], 'idle_episode', reportDate),
  }
}

export function getRequiredMissingSources(
  reportFiles: Awaited<ReturnType<typeof findReportFilesForDate>>,
) {
  return REQUIRED_SOURCES.filter((sourceType) => !reportFiles[sourceType])
}

/** Найти буферную таблицу в корне LEGENDA; создать, если её ещё нет. */
export async function ensureSyncBuffer(rootFolderId: string) {
  const drive = getDriveClient()
  const children = await listDriveChildren(drive, rootFolderId)
  const existing = children.find((item) => item.name === SYNC_BUFFER_NAME)
  if (existing) return existing.id

  const created = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: SYNC_BUFFER_NAME,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [rootFolderId],
    },
    fields: 'id',
  })
  if (!created.data.id) throw new Error('Не удалось создать буферную таблицу')
  return created.data.id
}

async function getAccessToken() {
  const auth = getGoogleAuth()
  const { token } = await auth.getAccessToken()
  if (!token) throw new Error('Не удалось получить Google access token')
  return token
}

/**
 * Залить XLSX из Drive в буфер: скачиваем байты и заменяем содержимое (конверсия
 * на месте). Нарочно чистый fetch — media-upload через googleapis использует
 * node-стримы и роняет воркер edge-рантайма.
 */
export async function loadFileIntoBuffer(bufferId: string, sourceFileId: string) {
  const token = await getAccessToken()

  const download = await fetch(
    `https://www.googleapis.com/drive/v3/files/${sourceFileId}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!download.ok) {
    throw new Error(`Drive download ${download.status}: ${(await download.text()).slice(0, 200)}`)
  }
  const bytes = new Uint8Array(await download.arrayBuffer())

  const upload = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${bufferId}?uploadType=media&supportsAllDrives=true`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': XLSX_MIME },
      body: bytes,
    },
  )
  if (!upload.ok) {
    throw new Error(`Drive upload ${upload.status}: ${(await upload.text()).slice(0, 200)}`)
  }
}

/** Число строк в листе данных буфера (включая заголовок). */
export async function getBufferDataRowCount(bufferId: string) {
  const sheets = getSheetsClient()
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: bufferId,
    fields: 'sheets(properties(title,gridProperties(rowCount)))',
  })
  const tab = (meta.data.sheets ?? []).find((sheet) => sheet.properties?.title === DATA_SHEET)
  if (!tab) throw new Error(`В буфере нет листа ${DATA_SHEET}`)
  return tab.properties?.gridProperties?.rowCount ?? 0
}

/** Значения строк данных буфера: строки с fromRow по toRow включительно (1-based). */
export async function readBufferRows(bufferId: string, fromRow: number, toRow: number) {
  const sheets = getSheetsClient()
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: bufferId,
    range: `'${DATA_SHEET}'!A${fromRow}:AZ${toRow}`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  })
  // deno-lint-ignore no-explicit-any
  return (response.data.values ?? []) as any[][]
}
