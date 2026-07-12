import { HIDDEN_ZONES, KPP_ZONE, parseZone, ZONE_NAMES } from './zones'

export const ZONE_IDS = Object.keys(ZONE_NAMES)
  .map(Number)
  .sort((left, right) => left - right)

export function buildDefaultZoneVisibility(): Record<number, boolean> {
  const result: Record<number, boolean> = {}
  for (const zoneId of ZONE_IDS) {
    result[zoneId] = !HIDDEN_ZONES.has(zoneId) && zoneId !== KPP_ZONE
  }
  return result
}

export const DEFAULT_ZONE_VISIBILITY = buildDefaultZoneVisibility()

export function normalizeZoneVisibility(value: unknown): Record<number, boolean> {
  const result = { ...DEFAULT_ZONE_VISIBILITY }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  for (const zoneId of ZONE_IDS) {
    const key = String(zoneId)
    if (key in (value as Record<string, unknown>)) {
      result[zoneId] = (value as Record<string, boolean>)[key] !== false
    }
  }
  return result
}

export function isZoneVisibleInDistribution(
  value: string | number | null | undefined,
  zoneVisibility: Record<number, boolean> = DEFAULT_ZONE_VISIBILITY,
) {
  const zone = parseZone(value)
  if (zone === null) return false
  return zoneVisibility[zone] !== false
}

export function filterDistributionZoneRows<T extends { zona: number }>(
  rows: T[],
  zoneVisibility: Record<number, boolean> = DEFAULT_ZONE_VISIBILITY,
) {
  return rows.filter((row) => isZoneVisibleInDistribution(row.zona, zoneVisibility))
}

export function zoneVisibilityLabel(zoneId: number) {
  return `${zoneId}. ${ZONE_NAMES[zoneId] ?? `Зона ${zoneId}`}`
}
