import { google } from 'npm:googleapis@140.0.1'
import { DRIVE_ARCHIVE_FOLDERS, REPORT_FILE_PATTERNS, type SourceType } from './parsers.ts'

const REQUIRED_SOURCES: SourceType[] = ['aa_ble', 'long_idle']
const OPTIONAL_SOURCES: SourceType[] = ['faceid', 'idle_episode']
const ALL_SOURCES: SourceType[] = [...REQUIRED_SOURCES, ...OPTIONAL_SOURCES]

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

function getDriveClient() {
  const { email, privateKey } = getServiceAccountCredentials()
  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  })
  return google.drive({ version: 'v3', auth })
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

export async function downloadDriveFile(fileId: string) {
  const drive = getDriveClient()
  const response = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' },
  )
  return new Uint8Array(response.data as ArrayBuffer)
}

export function getRequiredMissingSources(
  reportFiles: Awaited<ReturnType<typeof findReportFilesForDate>>,
) {
  return REQUIRED_SOURCES.filter((sourceType) => !reportFiles[sourceType])
}
