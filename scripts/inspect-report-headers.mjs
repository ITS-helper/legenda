import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import xlsx from 'xlsx'

function getArg(flagName) {
  const index = process.argv.indexOf(flagName)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

const filePath = getArg('--file') ?? process.argv[2]

if (!filePath || !fs.existsSync(filePath)) {
  console.error('Usage: node scripts/inspect-report-headers.mjs --file <path-to-xlsx>')
  process.exit(1)
}

const workbook = xlsx.readFile(filePath, { cellDates: true })

for (const sheetName of workbook.SheetNames) {
  const sheet = workbook.Sheets[sheetName]
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true })
  const header = rows[0] ?? []
  const sample = rows.slice(1, 4)

  console.log(`\n=== ${sheetName} (${rows.length - 1} data rows) ===`)
  console.log('Headers:', header.map((value, index) => `${index}: ${value}`).join(' | '))
  console.log('Sample rows:')
  for (const row of sample) {
    console.log(row)
  }
}
