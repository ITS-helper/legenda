import { getEdgeFunctionHeaders, getEdgeFunctionUrl, readEdgeFunctionJson } from './edgeFunctions'
import { brigadeNamesMatch, TRACKED_BRIGADES } from './reports'

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

type LoadVolumeResponse = {
  report_date?: string
  entries?: VolumeEntry[]
}

type LoadVolumeDatesResponse = {
  dates?: string[]
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

function parseVolumeM3(valueText: string) {
  const normalized = valueText.trim().replace(',', '.')
  const match = normalized.match(/(\d+(?:\.\d+)?)/)
  if (!match) return 0
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : 0
}

function formatVolumeM3Total(value: number) {
  if (value <= 0) return '—'
  const rounded = Math.round(value * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace('.', ',')
  return `${text} м³`
}

export function formatVolumeCardSummary(entries: VolumeEntry[]) {
  if (entries.length === 0) return '—'

  const total = entries.reduce((sum, entry) => sum + parseVolumeM3(entry.value_text), 0)
  if (total <= 0) return '—'

  return formatVolumeM3Total(total)
}

function mapVolumeEntry(row: VolumeEntry): VolumeEntry {
  return {
    ...row,
    report_date: normalizeReportDate(row.report_date),
  }
}

function volumeEntriesUrl(reportDate?: string) {
  const url = new URL(getEdgeFunctionUrl('volume-entries'))
  const date = normalizeReportDate(reportDate)
  if (date) {
    url.searchParams.set('date', date)
  }
  return url.toString()
}

async function fetchVolumeApi<T>(password: string, reportDate?: string) {
  const trimmedPassword = password.trim()
  if (!trimmedPassword) {
    throw new Error('Сессия истекла. Войдите снова.')
  }

  let response: Response
  try {
    response = await fetch(volumeEntriesUrl(reportDate), {
      method: 'GET',
      headers: getEdgeFunctionHeaders(trimmedPassword),
    })
  } catch {
    throw new Error('Не удалось связаться с сервером. Обновите страницу и попробуйте снова.')
  }

  return readEdgeFunctionJson<T>(response)
}

export async function loadVolumeDates(password: string) {
  const payload = await fetchVolumeApi<LoadVolumeDatesResponse>(password)
  return (payload?.dates ?? []).map(normalizeReportDate).filter(Boolean)
}

export async function loadVolumeEntries(password: string, reportDate: string) {
  const date = normalizeReportDate(reportDate)
  if (!date) return []

  const payload = await fetchVolumeApi<LoadVolumeResponse>(password, date)
  return (payload?.entries ?? []).map((row) => mapVolumeEntry(row as VolumeEntry))
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
  return (payload?.entries ?? []).map((row) => mapVolumeEntry(row as VolumeEntry))
}

export async function saveVolumeEntriesForDays(
  password: string,
  days: Array<{ reportDate: string; entries: VolumeEntryDraft[] }>,
) {
  for (const day of days) {
    await saveVolumeEntries(password, day.reportDate, day.entries)
  }
}

export function brigadeVolumeDraftsFromEntries(entries: VolumeEntry[]): VolumeEntryDraft[] {
  return TRACKED_BRIGADES.map((brigade) => {
    const match = entries.find((entry) => brigadeNamesMatch(entry.label, brigade))
    return {
      id: match?.id,
      label: brigade,
      value_text: match?.value_text ?? '',
      note: match?.note ?? '',
    }
  })
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
