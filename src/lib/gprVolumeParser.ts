import * as XLSX from 'xlsx'
import { type VolumeEntryDraft } from './volumes'

const TARGET_SHEET_PARTS = ['лв2', 'монолит', 'к2'] as const

const SECTION_BRIGADES: Record<string, string> = {
  СНГ: 'Джалол',
  КНДР: 'ЛИ СОН ХАК',
}

type SheetRow = Array<string | number | Date | null | undefined>

export type GprVolumeDayResult = {
  reportDate: string
  entries: VolumeEntryDraft[]
}

export type GprVolumeBulkParseResult = {
  sheetName: string
  monthLabel: string
  days: GprVolumeDayResult[]
  warnings: string[]
}

function cellText(value: unknown) {
  if (value == null) return ''
  return String(value).trim()
}

function cellNumber(value: unknown) {
  if (value == null || value === '') return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeSheetName(value: string) {
  return value.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
}

function toIsoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function findGprMonolithSheetName(sheetNames: string[]) {
  return (
    sheetNames.find((name) => {
      const normalized = normalizeSheetName(name)
      return TARGET_SHEET_PARTS.every((part) => normalized.includes(part))
    }) ?? null
  )
}

function parseExcelDateParts(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1000) {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed?.y && parsed?.m) {
      return { year: parsed.y, month: parsed.m }
    }
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { year: value.getFullYear(), month: value.getMonth() + 1 }
  }

  const text = cellText(value)
  if (!text) return null

  const isoMatch = text.match(/^(\d{4})-(\d{2})/)
  if (isoMatch) {
    return { year: Number(isoMatch[1]), month: Number(isoMatch[2]) }
  }

  const dottedMatch = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/)
  if (dottedMatch) {
    return { year: Number(dottedMatch[3]), month: Number(dottedMatch[2]) }
  }

  const monthYearMatch = text.match(/([A-Za-zА-Яа-я]+)\.?(\d{2,4})/)
  if (monthYearMatch) {
    const yearToken = monthYearMatch[2]
    const year = yearToken.length === 2 ? 2000 + Number(yearToken) : Number(yearToken)
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    const monthLabel = monthYearMatch[1].slice(0, 3).toLowerCase()
    const monthIndex = monthNames.indexOf(monthLabel)
    if (monthIndex >= 0) {
      return { year, month: monthIndex + 1 }
    }
  }

  return null
}

function buildDayColumnMap(dayRow: SheetRow) {
  const map = new Map<number, number>()
  for (let column = 7; column < dayRow.length; column += 1) {
    const day = Math.floor(cellNumber(dayRow[column]))
    if (day >= 1 && day <= 31) {
      map.set(day, column)
    }
  }
  return map
}

function isFactRow(row: SheetRow) {
  return cellText(row[6]).toLowerCase() === 'факт'
}

function isSectionMarker(value: string) {
  return value in SECTION_BRIGADES
}

function formatVolumeM3(value: number) {
  if (value <= 0) return '0 м³'
  const rounded = Math.round(value * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace('.', ',')
  return `${text} м³`
}

function formatWorkNote(works: Array<{ name: string; volume: number }>) {
  if (works.length === 0) return 'Нет выполненных объёмов за день'
  return works.map((work) => `${work.name} — ${formatVolumeM3(work.volume)}`).join('; ')
}

function findDailyFactRow(rows: SheetRow[], startIndex: number, endIndex: number) {
  for (let rowIndex = startIndex; rowIndex < endIndex; rowIndex += 1) {
    if (cellText(rows[rowIndex]?.[2]).toLowerCase() === 'факт ежедневный') {
      return rowIndex
    }
  }
  return null
}

function parseSectionFactsForDay(options: {
  rows: SheetRow[]
  startIndex: number
  endIndex: number
  dayColumn: number
}) {
  const works: Array<{ name: string; volume: number }> = []
  let total = 0

  for (let rowIndex = options.startIndex; rowIndex < options.endIndex; rowIndex += 1) {
    const row = options.rows[rowIndex]
    if (!row || !isFactRow(row)) continue

    const volume = cellNumber(row[options.dayColumn])
    if (volume <= 0) continue

    const workName = cellText(row[1]) || cellText(options.rows[rowIndex - 1]?.[1])
    if (!workName) continue

    total += volume
    works.push({ name: workName, volume })
  }

  return { total, works }
}

type ParsedSection = {
  name: string
  brigadeName: string
  monthStart: { year: number; month: number }
  dayColumns: Map<number, number>
  dataStart: number
  dataEnd: number
  dailyFactRowIndex: number | null
}

function parseSectionMeta(options: {
  rows: SheetRow[]
  markerIndex: number
  endIndex: number
  sectionName: string
}): ParsedSection {
  const headerRow = options.rows[options.markerIndex + 1]
  const dayRow = options.rows[options.markerIndex + 2]
  if (!headerRow || !dayRow) {
    throw new Error(`Не удалось прочитать шапку таблицы в секции ${options.sectionName}`)
  }

  const dataStart = options.markerIndex + 3
  const monthStart = parseExcelDateParts(headerRow[7])
  if (!monthStart) {
    throw new Error(`Не удалось определить месяц ГПР в секции ${options.sectionName}`)
  }

  return {
    name: options.sectionName,
    brigadeName: SECTION_BRIGADES[options.sectionName],
    monthStart,
    dayColumns: buildDayColumnMap(dayRow),
    dataStart,
    dataEnd: options.endIndex,
    dailyFactRowIndex: findDailyFactRow(options.rows, dataStart, options.endIndex),
  }
}

function sheetRowsFromWorkbook(workbook: XLSX.WorkBook, sheetName: string) {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    throw new Error(`Вкладка «${sheetName}» не найдена`)
  }

  return XLSX.utils.sheet_to_json<SheetRow>(sheet, {
    header: 1,
    defval: null,
    raw: true,
  })
}

export function parseGprVolumeRows(rows: SheetRow[], sheetName: string): GprVolumeBulkParseResult {
  const sectionMarkers: Array<{ name: string; index: number }> = []

  rows.forEach((row, index) => {
    const marker = cellText(row?.[0])
    if (isSectionMarker(marker)) {
      sectionMarkers.push({ name: marker, index })
    }
  })

  if (sectionMarkers.length === 0) {
    throw new Error('На вкладке не найдены секции СНГ и КНДР')
  }

  const sections = sectionMarkers.map((section, sectionIndex) =>
    parseSectionMeta({
      rows,
      markerIndex: section.index,
      endIndex: sectionMarkers[sectionIndex + 1]?.index ?? rows.length,
      sectionName: section.name,
    }),
  )

  const referenceMonth = sections[0].monthStart
  for (const section of sections.slice(1)) {
    if (section.monthStart.year !== referenceMonth.year || section.monthStart.month !== referenceMonth.month) {
      throw new Error('Секции СНГ и КНДР в файле относятся к разным месяцам')
    }
  }

  const allDays = new Set<number>()
  for (const section of sections) {
    for (const day of section.dayColumns.keys()) {
      allDays.add(day)
    }
  }

  const warnings: string[] = []
  const days: GprVolumeDayResult[] = []

  for (const dayOfMonth of [...allDays].sort((left, right) => left - right)) {
    const entries: VolumeEntryDraft[] = []
    let dayHasVolume = false

    for (const section of sections) {
      const dayColumn = section.dayColumns.get(dayOfMonth)
      if (dayColumn == null) continue

      const facts = parseSectionFactsForDay({
        rows,
        startIndex: section.dataStart,
        endIndex: section.dataEnd,
        dayColumn,
      })

      const summaryTotal =
        section.dailyFactRowIndex == null
          ? 0
          : cellNumber(rows[section.dailyFactRowIndex]?.[dayColumn])
      const total = summaryTotal > 0 ? summaryTotal : facts.total

      if (total > 0) {
        dayHasVolume = true
      }

      entries.push({
        label: section.brigadeName,
        value_text: formatVolumeM3(total),
        note: formatWorkNote(facts.works),
      })
    }

    if (!dayHasVolume) continue

    days.push({
      reportDate: toIsoDate(referenceMonth.year, referenceMonth.month, dayOfMonth),
      entries,
    })
  }

  if (days.length === 0) {
    warnings.push('В файле нет выполненных объёмов по дням')
  }

  return {
    sheetName,
    monthLabel: `${String(referenceMonth.month).padStart(2, '0')}.${referenceMonth.year}`,
    days,
    warnings,
  }
}

export async function parseGprVolumeFile(file: File): Promise<GprVolumeBulkParseResult> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })
  const sheetName = findGprMonolithSheetName(workbook.SheetNames)

  if (!sheetName) {
    throw new Error('В файле нет вкладки «ЛВ2_монолит К2»')
  }

  const rows = sheetRowsFromWorkbook(workbook, sheetName)
  return parseGprVolumeRows(rows, sheetName)
}
