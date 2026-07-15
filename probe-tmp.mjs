import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local', quiet: true })
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { db: { schema: 'analytics' } })
const DATE = '2026-07-14'

async function time(label, fn) {
  const t0 = Date.now()
  const r = await fn()
  const ms = Date.now() - t0
  console.log(`${label}: ${ms} ms`, r.error ? ('ERROR ' + r.error.message) : `rows=${(r.data||[]).length}`)
  return ms
}

// warm-up + 3 runs each
for (let i=0;i<3;i++){
  await time(`shift_daily_metrics_for_date #${i}`, () =>
    supabase.rpc('shift_daily_metrics_for_date', { p_report_date: DATE }))
}
console.log('---')
for (let i=0;i<3;i++){
  await time(`not_worn_episode_ranges_for_date(all) #${i}`, () =>
    supabase.rpc('not_worn_episode_ranges_for_date', { p_report_date: DATE, p_shift_ids: null }))
}
process.exit(0)
