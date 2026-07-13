import type { MetricSettings } from './metricSettings'

export type NotWornProfessionRuleValues = {
  idleSecMin: number
  activeSecMax: number
  shiftMinSec: number
  warnPct: number
}

export type NotWornProfessionRules = Record<string, Partial<NotWornProfessionRuleValues>>

type NotWornProfessionRuleRow = {
  idle_sec_min?: number
  active_sec_max?: number
  shift_min_sec?: number
  warn_pct?: number
}

function normalizeRulePart(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

export function resolveNotWornRule(
  profession: string | null | undefined,
  settings: MetricSettings,
): NotWornProfessionRuleValues {
  const key = profession?.trim() ?? ''
  const override = key ? settings.notWornProfessionRules[key] : undefined

  return {
    idleSecMin: normalizeRulePart(override?.idleSecMin, settings.notWornIdleSecMin, 30, 60),
    activeSecMax: normalizeRulePart(override?.activeSecMax, settings.notWornActiveSecMax, 0, 30),
    shiftMinSec: normalizeRulePart(override?.shiftMinSec, settings.notWornMinSec, 60, 7200),
    warnPct: normalizeRulePart(override?.warnPct, settings.notWornWarnPct, 1, 100),
  }
}

export function normalizeNotWornProfessionRules(value: unknown): NotWornProfessionRules {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const result: NotWornProfessionRules = {}
  for (const [profession, rawRule] of Object.entries(value as Record<string, unknown>)) {
    const name = profession.trim()
    if (!name || !rawRule || typeof rawRule !== 'object' || Array.isArray(rawRule)) continue

    const row = rawRule as NotWornProfessionRuleRow
    const rule: Partial<NotWornProfessionRuleValues> = {}

    if (row.idle_sec_min != null) rule.idleSecMin = Number(row.idle_sec_min)
    if (row.active_sec_max != null) rule.activeSecMax = Number(row.active_sec_max)
    if (row.shift_min_sec != null) rule.shiftMinSec = Number(row.shift_min_sec)
    if (row.warn_pct != null) rule.warnPct = Number(row.warn_pct)

    if (Object.keys(rule).length > 0) result[name] = rule
  }

  return result
}

export function toNotWornProfessionRulesPayload(rules: NotWornProfessionRules): Record<string, NotWornProfessionRuleRow> {
  const payload: Record<string, NotWornProfessionRuleRow> = {}

  for (const [profession, rule] of Object.entries(rules)) {
    const name = profession.trim()
    if (!name || !rule) continue

    const row: NotWornProfessionRuleRow = {}
    if (rule.idleSecMin != null) row.idle_sec_min = rule.idleSecMin
    if (rule.activeSecMax != null) row.active_sec_max = rule.activeSecMax
    if (rule.shiftMinSec != null) row.shift_min_sec = rule.shiftMinSec
    if (rule.warnPct != null) row.warn_pct = rule.warnPct

    if (Object.keys(row).length > 0) payload[name] = row
  }

  return payload
}

export function hasNotWornProfessionOverride(rules: NotWornProfessionRules, profession: string) {
  const override = rules[profession.trim()]
  return Boolean(override && Object.keys(override).length > 0)
}
