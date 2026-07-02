import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { importDailyBatch } from './lib/import-batch.mjs'
import {
  assertFileExists,
  assertSingleReportDate,
  parseBleRows,
  parseFaceRows,
  parseLongIdleRows,
} from './lib/report-parsers.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(projectRoot, '.env.local') })
dotenv.config({ path: path.join(projectRoot, '.env') })

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Missing Supabase server environment variables')
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: 'analytics' },
})

function getArg(flagName) {
  const index = process.argv.indexOf(flagName)
  if (index === -1) {
    return null
  }

  return process.argv[index + 1] ?? null
}

function resolveInputPath(cliValue, envValue, fallbackPattern) {
  const candidate = cliValue || envValue
  if (candidate) {
    return path.resolve(candidate)
  }

  const downloadsDir = path.join(process.env.USERPROFILE ?? '', 'Downloads')
  if (!downloadsDir || !fs.existsSync(downloadsDir)) {
    return null
  }

  const match = fs
    .readdirSync(downloadsDir)
    .find((fileName) => fallbackPattern.test(fileName))

  return match ? path.join(downloadsDir, match) : null
}

async function main() {
  const facePath = resolveInputPath(
    getArg('--face'),
    process.env.LOCAL_FACEID_REPORT_PATH,
    /faceID.*LEGENDA.*\.xlsx$/i,
  )
  const blePath = resolveInputPath(
    getArg('--ble'),
    process.env.LOCAL_AA_BLE_REPORT_PATH,
    /BLE.*LEGENDA.*\.xlsx$/i,
  )
  const longIdlePath = resolveInputPath(
    getArg('--long-idle'),
    process.env.LOCAL_LONG_IDLE_REPORT_PATH,
    /LongIDLE.*LEGENDA.*\.xlsx$/i,
  )

  assertFileExists(facePath, 'faceID')
  assertFileExists(blePath, 'AA_BLE')
  assertFileExists(longIdlePath, 'LongIDLE')

  const faceRows = parseFaceRows(facePath)
  const bleRows = parseBleRows(blePath)
  const longIdleRows = parseLongIdleRows(longIdlePath)

  if (faceRows.length === 0 || bleRows.length === 0 || longIdleRows.length === 0) {
    throw new Error('One of the report files did not produce any rows')
  }

  const reportDate = getArg('--date') ?? faceRows[0].report_date

  assertSingleReportDate(faceRows, reportDate, 'faceID')
  assertSingleReportDate(bleRows, reportDate, 'AA_BLE')
  assertSingleReportDate(longIdleRows, reportDate, 'LongIDLE')

  const sourceDayKey = `manual:${reportDate}`

  const result = await importDailyBatch(supabase, {
    reportDate,
    sourceDayKey,
    notes: 'Imported from local XLSX files',
    faceRows,
    bleRows,
    longIdleRows,
    files: [
      { sourceType: 'faceid', fileName: path.basename(facePath) },
      { sourceType: 'aa_ble', fileName: path.basename(blePath) },
      { sourceType: 'long_idle', fileName: path.basename(longIdlePath) },
    ],
  })

  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
