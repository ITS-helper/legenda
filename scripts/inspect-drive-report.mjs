import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { google } from 'googleapis'
import xlsx from 'xlsx'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(projectRoot, '.env.local') })
dotenv.config({ path: path.join(projectRoot, '.env') })

function getArg(flag) {
  const i = process.argv.indexOf(flag)
  return i === -1 ? null : process.argv[i + 1] ?? null
}

function normalizePrivateKey(raw) {
  if (!raw) return ''
  let key = raw.trim()
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1)
  return key.replace(/\\n/g, '\n')
}

function getDrive() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = normalizePrivateKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)
  const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/drive.readonly'] })
  return google.drive({ version: 'v3', auth })
}

async function listChildren(drive, parent) {
  const items = []
  let pageToken
  do {
    const res = await drive.files.list({
      q: `'${parent}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType)',
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })
    items.push(...(res.data.files ?? []))
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)
  return items
}

async function findXlsxRecursive(drive, root, namePattern) {
  const folders = [root]
  while (folders.length) {
    const folderId = folders.pop()
    const children = await listChildren(drive, folderId)
    for (const item of children) {
      if (item.mimeType === 'application/vnd.google-apps.folder') folders.push(item.id)
      else if (/\.xlsx?$/i.test(item.name ?? '') && namePattern.test(item.name ?? '')) return item
    }
  }
  return null
}

async function main() {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID ?? '1GozRP1VvLFkZooW9dQYuI_O-c5tqmRfO'
  const pattern = new RegExp(getArg('--pattern') ?? '10_report_10', 'i')
  const drive = getDrive()

  // Look inside the matching root archive folder first, else whole tree.
  const roots = await listChildren(drive, folderId)
  console.log('Root items:')
  for (const r of roots) console.log(' -', r.mimeType === 'application/vnd.google-apps.folder' ? '[dir]' : '[file]', r.name)

  const file = await findXlsxRecursive(drive, folderId, pattern)
  if (!file) {
    console.error('No file matching', pattern)
    process.exit(1)
  }
  console.log('\nFound:', file.name, file.id)

  const res = await drive.files.get({ fileId: file.id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' })
  const tmp = path.join(os.tmpdir(), file.name)
  fs.writeFileSync(tmp, Buffer.from(res.data))

  const wb = xlsx.readFile(tmp, { cellDates: true })
  for (const sheetName of wb.SheetNames) {
    const rows = xlsx.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null, raw: true })
    console.log(`\n=== ${sheetName} (${Math.max(0, rows.length - 1)} data rows) ===`)
    console.log('Headers:', (rows[0] ?? []).map((v, i) => `${i}:${v}`).join(' | '))
    for (const r of rows.slice(1, 3)) console.log('Sample:', JSON.stringify(r))
  }
  fs.rmSync(tmp, { force: true })
}

main().catch((e) => {
  console.error(e?.message ?? e)
  process.exitCode = 1
})
