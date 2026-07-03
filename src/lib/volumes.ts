import { getEdgeFunctionHeaders, getEdgeFunctionUrl, readEdgeFunctionJson } from './edgeFunctions'
import { supabase } from './supabase'

export type VolumeEntry = {
  id: number
  report_date: string
  label: string
  value_text: string
  note: string | null
  sort_order: number
  updated_at?: string
}

export type VolumeEntryDraft = {
  id?: number
  label: string
  value_text: string
  note: string
}

type SaveVolumeResponse = {
  report_date?: string
  entries?: VolumeEntry[]
}

export function formatVolumeEntryCount(count: number) {
  if (count === 0) return '—'
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod100 >= 11 && mod100 <= 19) return `${count} записей`
  if (mod10 === 1) return `${count} запись`
  if (mod10 >= 2 && mod10 <= 4) return `${count} записи`
  return `${count} записей`
}

export function mergeDateLists(...lists: string[][]) {
  return [...new Set(lists.flat().map(normalizeReportDate).filter(Boolean))].sort((left, right) =>
    right.localeCompare(left),
  )
}

export function normalizeReportDate(value: string | null | undefined) {
  if (!value) return ''
  return value.slice(0, 10)
}

export function formatVolumeCardSummary(entries: VolumeEntry[]) {
  if (entries.length === 0) return '—'
  const preview = entries
    .slice(0, 2)
    .map((entry) => entry.value_text.trim())
    .filter(Boolean)
    .join(' · ')
  if (!preview) return '—'
  return entries.length > 2 ? `${preview} …` : preview
}

export async function loadVolumeDates() {
  const { data, error } = await supabase
    .schema('analytics')
    .from('volume_entries')
    .select('report_date')
    .order('report_date', { ascending: false })

  if (error) throw error
  return [...new Set((data ?? []).map((row) => normalizeReportDate(row.report_date as string)))]
}

export async function loadVolumeEntries(reportDate: string) {
  const date = normalizeReportDate(reportDate)
  if (!date) return []

  const { data, error } = await supabase
    .schema('analytics')
    .from('volume_entries')
    .select('id, report_date, label, value_text, note, sort_order, updated_at')
    .eq('report_date', date)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true })

  if (error) throw error
  return (data ?? []).map((row) => ({
    ...(row as VolumeEntry),
    report_date: normalizeReportDate(row.report_date as string),
  }))
}

export async function saveVolumeEntries(password: string, reportDate: string, entries: VolumeEntryDraft[]) {
  let response: Response
  try {
    response = await fetch(getEdgeFunctionUrl('volume-entries'), {
      method: 'PUT',
      headers: getEdgeFunctionHeaders(password, true),
      body: JSON.stringify({
        report_date: normalizeReportDate(reportDate),
        entries: entries.map((entry, index) => ({
          label: entry.label,
          value_text: entry.value_text,
          note: entry.note.trim() || null,
          sort_order: index,
        })),
      }),
    })
  } catch {
    throw new Error('Не удалось связаться с сервером. Обновите страницу и попробуйте снова.')
  }

  const payload = await readEdgeFunctionJson<SaveVolumeResponse>(response)
  return payload?.entries ?? []
}

export function draftsFromEntries(entries: VolumeEntry[]): VolumeEntryDraft[] {
  if (entries.length === 0) {
    return [{ label: '', value_text: '', note: '' }]
  }

  return entries.map((entry) => ({
    id: entry.id,
    label: entry.label,
    value_text: entry.value_text,
    note: entry.note ?? '',
  }))
}
