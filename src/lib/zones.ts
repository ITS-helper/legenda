// Zone dictionary — source of truth: docs/zones-reference.md
// Значение zona (отчёт 11) и chosen_ble_tag_zone (отчёт 10).

export const ZONE_NAMES: Record<number, string> = {
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

export type ZoneGroup = 'work' | 'rest' | 'service' | 'sanitary' | 'alert' | 'unknown'

export const ZONE_GROUP_LABELS: Record<ZoneGroup, string> = {
  work: 'Рабочая зона (ПВ)',
  rest: 'Отдых / перерывы',
  service: 'Служебные',
  sanitary: 'Санитарные',
  alert: 'Контроль / нарушения',
  unknown: 'Не определено',
}

const ZONE_GROUP_MAP: Record<number, ZoneGroup> = {
  1: 'work',
  2: 'rest',
  4: 'rest',
  5: 'rest',
  14: 'rest',
  7: 'sanitary',
  8: 'service',
  9: 'service',
  10: 'service',
  11: 'service',
  12: 'service',
  3: 'alert',
  6: 'alert',
  13: 'alert',
}

/** КПП и другие зоны, которые стоит подсвечивать как потенциальные нарушения. */
export const ALERT_ZONES = new Set<number>([3, 6, 13])
export const KPP_ZONE = 13

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

export function zoneGroup(value: string | number | null | undefined): ZoneGroup {
  const zone = parseZone(value)
  if (zone === null) return 'unknown'
  return ZONE_GROUP_MAP[zone] ?? 'service'
}

export function isAlertZone(value: string | number | null | undefined): boolean {
  const zone = parseZone(value)
  return zone !== null && ALERT_ZONES.has(zone)
}
