// Zone dictionary — source of truth: docs/zones-reference.md

export const ZONE_NAMES: Record<number, string> = {
  0: 'Вне зоны / без привязки',
  1: 'Зоны проведения работ',
  2: 'Столовые',
  3: 'Опасные зоны',
  4: 'Курилки',
  5: 'Зоны отдыха / обогрева',
  6: 'ВЖГ (запретная)',
  7: 'Туалеты',
  8: 'Остановки автобусов',
  9: 'Административные помещения',
  10: 'Зона выдачи WW',
  11: 'Склад',
  12: 'Мастерские',
  13: 'КПП',
  14: 'Стройгородок (отдых)',
}

export const HIDDEN_ZONES = new Set<number>([0])
export const ALERT_ZONES = new Set<number>([3, 6, 13])
export const KPP_ZONE = 13

/** Зоны, которые не показываем в email/PDF-отчётах. */
export const REPORT_EXCLUDED_ZONES = new Set<number>([KPP_ZONE])

export function parseZone(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null
}

export function zoneName(value: string | number | null | undefined): string {
  const zone = parseZone(value)
  if (zone === null) return 'Не определено'
  return ZONE_NAMES[zone] ?? `Зона ${zone}`
}

export function isHiddenZone(value: string | number | null | undefined): boolean {
  const zone = parseZone(value)
  return zone !== null && HIDDEN_ZONES.has(zone)
}

export function isReportExcludedZone(value: string | number | null | undefined): boolean {
  const zone = parseZone(value)
  return zone !== null && REPORT_EXCLUDED_ZONES.has(zone)
}

export function visibleReportZoneRows(rows: ZoneRow[]): ZoneRow[] {
  return rows.filter((row) => !isReportExcludedZone(row.zona))
}

export function isAlertZone(value: string | number | null | undefined): boolean {
  const zone = parseZone(value)
  return zone !== null && ALERT_ZONES.has(zone)
}

export type ZoneRow = {
  zona: number
  zonaName: string
  sec: number
}

export type IdleZoneRow = {
  zonaName: string
  count: number
  minutes: number
  alert: boolean
}

export function ratio(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : 0
}

export function formatPercent(value: number) {
  return `${Math.round(value)}%`
}

function episodeWord(count: number) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'эпизод'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'эпизода'
  return 'эпизодов'
}

export function formatEpisodeCount(count: number) {
  return `${count} ${episodeWord(count)}`
}
