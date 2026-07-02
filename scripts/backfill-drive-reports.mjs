import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

function getArg(flagName) {
  const index = process.argv.indexOf(flagName)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

function parseDate(value) {
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDate(date) {
  return date.toISOString().slice(0, 10)
}

const fromDate = parseDate(getArg('--from') ?? '2026-06-16')
const toDate = parseDate(getArg('--to') ?? '2026-07-01')
const force = process.argv.includes('--force')

if (!fromDate || !toDate || fromDate > toDate) {
  console.error('Usage: node scripts/backfill-drive-reports.mjs --from YYYY-MM-DD --to YYYY-MM-DD [--force]')
  process.exit(1)
}

const results = []

for (let cursor = new Date(fromDate); cursor <= toDate; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
  const reportDate = formatDate(cursor)
  const args = ['scripts/sync-drive-reports.mjs', '--date', reportDate]
  if (force) {
    args.push('--force')
  }

  console.log(`\n>>> ${reportDate}`)
  const run = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    env: process.env,
  })

  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim()
  if (output) {
    console.log(output)
  }

  results.push({
    reportDate,
    ok: run.status === 0,
    exitCode: run.status ?? 1,
  })
}

console.log('\n=== Backfill summary ===')
for (const item of results) {
  console.log(`${item.ok ? 'OK' : 'FAIL'} ${item.reportDate}`)
}

const failed = results.filter((item) => !item.ok)
process.exitCode = failed.length > 0 ? 1 : 0
if (failed.length > 0) {
  console.log(`\nFailed dates: ${failed.map((item) => item.reportDate).join(', ')}`)
}
