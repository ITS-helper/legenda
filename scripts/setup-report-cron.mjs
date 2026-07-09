import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const required = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'REPORT_CRON_SECRET',
]

for (const key of required) {
  if (!process.env[key]?.trim()) {
    console.error(`Missing ${key} in .env.local`)
    process.exit(1)
  }
}

const projectUrl = process.env.VITE_SUPABASE_URL.trim().replace(/'/g, "''")
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY.trim().replace(/'/g, "''")
const cronSecret = process.env.REPORT_CRON_SECRET.trim().replace(/'/g, "''")

function runSql(label, sql) {
  const file = resolve('.tmp-report-cron-setup.sql')
  writeFileSync(file, sql, 'utf8')
  try {
    console.log(`\n=== ${label} ===`)
    const env = {
      ...process.env,
      SUPABASE_DB_PASSWORD:
        process.env.SUPABASE_DB_PASSWORD?.trim() ||
        decodeDbPassword(process.env.SUPABASE_DB_URL),
    }
    execSync(`supabase db query --linked -f "${file}"`, { stdio: 'inherit', env })
  } finally {
    unlinkSync(file)
  }
}

function decodeDbPassword(dbUrl) {
  if (!dbUrl) return ''
  try {
    return decodeURIComponent(new URL(dbUrl).password)
  } catch {
    return ''
  }
}

function runSqlFile(label, relativePath) {
  const sql = readFileSync(resolve(relativePath), 'utf8')
  runSql(label, sql)
}

const vaultUpsert = (name, value, description) => `
do $vault$
declare
  secret_id uuid;
begin
  select id into secret_id from vault.secrets where name = '${name}' limit 1;
  if secret_id is null then
    perform vault.create_secret('${value}', '${name}', '${description}');
  else
    perform vault.update_secret(secret_id, '${value}', '${name}', '${description}');
  end if;
end;
$vault$;
`

try {
  runSqlFile('Migrations pg_cron', 'supabase/migrations/20260714_report_send_pg_cron.sql')
  runSqlFile('Migration cron auth', 'supabase/migrations/20260715_report_cron_auth_fix.sql')
  runSqlFile('Migration drive sync cron', 'supabase/migrations/20260718_drive_sync_pg_cron.sql')

  runSql('Vault secrets', [
    vaultUpsert('report_cron_project_url', projectUrl, 'Legenda send-report base URL'),
    vaultUpsert('report_cron_anon_key', anonKey, 'Legenda send-report anon key'),
    vaultUpsert('report_cron_secret', cronSecret, 'Legenda send-report cron secret'),
    `select name, length(trim(decrypted_secret)) as secret_len
     from vault.decrypted_secrets
     where name like 'report_cron_%'
     order by name;`,
    `select jobname, schedule, active
     from cron.job
     where jobname like 'legenda-%'
     order by jobname;`,
  ].join('\n'))

  runSql('Test invoke send-report', `
select analytics.invoke_scheduled_send_report('daily') as request_id;
select pg_sleep(3);
select id, status_code, left(content, 200) as content
from net._http_response
order by id desc
limit 1;
`)

  const googleJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()
  const googleEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim()
  const googlePrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim()
  const driveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim() ?? '1GozRP1VvLFkZooW9dQYuI_O-c5tqmRfO'
  const hasGoogleCreds = Boolean(googleJson || (googleEmail && googlePrivateKey))

  try {
    const secretsFile = resolve('.tmp-supabase-secrets.env')
    const secretLines = [
      `REPORT_CRON_SECRET=${cronSecret}`,
      `GOOGLE_DRIVE_FOLDER_ID=${driveFolderId}`,
    ]
    if (googleJson) {
      secretLines.push(`GOOGLE_SERVICE_ACCOUNT_JSON=${JSON.stringify(googleJson)}`)
    } else if (googleEmail && googlePrivateKey) {
      secretLines.push(`GOOGLE_SERVICE_ACCOUNT_EMAIL=${googleEmail}`)
      secretLines.push(`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=${JSON.stringify(googlePrivateKey)}`)
    }
    writeFileSync(secretsFile, secretLines.join('\n'), 'utf8')

    try {
      execSync(`supabase secrets set --env-file "${secretsFile}"`, {
        stdio: 'inherit',
        shell: true,
      })
    } finally {
      unlinkSync(secretsFile)
    }
    execSync('supabase functions deploy send-report --no-verify-jwt', { stdio: 'pipe' })
    console.log('send-report deployed')
    if (hasGoogleCreds) {
      execSync('supabase functions deploy sync-drive --no-verify-jwt', { stdio: 'pipe' })
      console.log('sync-drive deployed')
      runSql('Test invoke sync-drive', `
select analytics.invoke_scheduled_sync_drive(null) as request_id;
select pg_sleep(5);
select id, status_code, left(content, 300) as content
from net._http_response
order by id desc
limit 1;
`)
    } else {
      console.warn('Google credentials not in .env.local — sync-drive not deployed')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('PostHog') || message.includes('Deployed Functions')) {
      console.warn('Supabase CLI warning (ignored):', message)
    } else {
      throw error
    }
  }
} catch (error) {
  console.error('Setup failed:', error instanceof Error ? error.message : error)
  process.exit(1)
}

console.log('\nCron setup complete (send-report + sync-drive).')
