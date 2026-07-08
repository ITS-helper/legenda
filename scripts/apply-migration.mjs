import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import dotenv from 'dotenv'
import pg from 'pg'

dotenv.config({ path: '.env.local' })

const migrationFile = process.argv[2]
if (!migrationFile) {
  console.error('Usage: node scripts/apply-migration.mjs <migration-file.sql>')
  process.exit(1)
}

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('SUPABASE_DB_URL is missing in .env.local')
  process.exit(1)
}

const url = new URL(dbUrl)
const projectRef = url.hostname.replace(/^db\./, '').replace(/\.supabase\.co$/, '')
const dbPassword =
  process.env.SUPABASE_DB_PASSWORD?.trim() || decodeURIComponent(url.password || '')
const sql = readFileSync(resolve(migrationFile), 'utf8')

const client = new pg.Client({
  host: 'aws-0-eu-west-1.pooler.supabase.com',
  port: 6543,
  user: `postgres.${projectRef}`,
  password: dbPassword,
  database: url.pathname.replace(/^\//, '') || 'postgres',
  ssl: { rejectUnauthorized: false },
})

try {
  await client.connect()
  await client.query(sql)
  console.log(`Applied migration: ${migrationFile}`)
} catch (error) {
  console.error('Migration failed:', error instanceof Error ? error.message : error)
  console.error('Fallback: open Supabase SQL Editor and run the file manually.')
  process.exit(1)
} finally {
  await client.end().catch(() => undefined)
}
