// Локальная сборка полного еженедельного отчёта (письмо + PDF) без отправки.
// Данные и разметка — те же функции, что и в edge function send-report.
//
// Запуск: npm run preview:weekly -- 2026-06-15
// Результат: preview/weekly-report-<неделя>.html и preview/weekly-report-<неделя>.pdf
import { mkdirSync, writeFileSync } from 'node:fs'
import dotenv from 'dotenv'
import { buildWeeklyHtml, wrapEmailHtml } from '../supabase/functions/send-report/index.ts'
import { renderReportPdf } from '../supabase/functions/send-report/pdf.ts'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const weekStart = process.argv.slice(2).find((arg) => !arg.startsWith('--'))
if (!weekStart) throw new Error('Укажите понедельник недели: npm run preview:weekly -- 2026-06-15')

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: 'analytics' },
})

console.log(`собираю отчёт за неделю ${weekStart}...`)
const started = Date.now()
const report = await buildWeeklyHtml(supabase, weekStart)
console.log(`отчёт собран за ${Math.round((Date.now() - started) / 1000)} с; данные есть: ${report.hasData}`)
console.log(`тема письма: ${report.subject}`)

writeFileSync('preview/last-pdf-payload.json', JSON.stringify(report.pdfPayload), 'utf8')
const pdfBytes = await renderReportPdf(report.pdfPayload)

mkdirSync('preview', { recursive: true })
const htmlFile = `preview/weekly-report-${weekStart}.html`
const pdfFile = `preview/weekly-report-${weekStart}.pdf`
writeFileSync(htmlFile, wrapEmailHtml(report.html), 'utf8')
writeFileSync(pdfFile, pdfBytes)
console.log(`готово: ${htmlFile}`)
console.log(`готово: ${pdfFile} (${report.pdfFilename})`)
