import { getEdgeFunctionHeaders, getEdgeFunctionUrl, readEdgeFunctionJson } from './edgeFunctions'
import type { DashboardBlockId } from '../content/dashboardBlocks'
import { DEFAULT_BLOCK_VISIBILITY } from '../content/dashboardBlocks'
import {
  DEFAULT_SUBBLOCK_VISIBILITY,
  SUBBLOCK_IDS,
  type SubblockId,
} from '../content/dashboardSubblocks'
import { DEFAULT_ZONE_VISIBILITY, normalizeZoneVisibility } from './zoneVisibility'
import {
  normalizeNotWornProfessionRules,
  toNotWornProfessionRulesPayload,
  type NotWornProfessionRules,
} from './notWornProfessionRules'

export type MetricSettings = {
  longIdleMin: number
  lowActivityPct: number
  brigadeWarnPct: number
  shiftTargetTotal: number
  brigadeTargetJalol: number
  brigadeTargetLiSonHak: number
  kppLunchStartMin: number
  kppLunchEndMin: number
  activitySparklineDays: number
  volumeSparklineDays: number
  notWornMinSec: number
  notWornWarnPct: number
  notWornIdleSecMin: number
  notWornActiveSecMax: number
  notWornMinIntervalSec: number
  notWornProfessionRules: NotWornProfessionRules
  comparisonBrigades: string[]
  subblockVisibility: Record<SubblockId, boolean>
  zoneVisibility: Record<number, boolean>
  block1Enabled: boolean
  block2Enabled: boolean
  block3Enabled: boolean
  block4Enabled: boolean
  block5Enabled: boolean
  block6Enabled: boolean
  block7Enabled: boolean
}

export type BooleanBlockSettingKey =
  | 'block1Enabled'
  | 'block2Enabled'
  | 'block3Enabled'
  | 'block4Enabled'
  | 'block5Enabled'
  | 'block6Enabled'
  | 'block7Enabled'

export type NumericMetricSettingKey = Exclude<
  keyof MetricSettings,
  BooleanBlockSettingKey | 'comparisonBrigades' | 'subblockVisibility' | 'zoneVisibility' | 'notWornProfessionRules'
>

type MetricSettingsRow = {
  long_idle_min?: number
  low_activity_pct?: number
  brigade_warn_pct?: number
  shift_target_total?: number
  brigade_target_jalol?: number
  brigade_target_li_son_hak?: number
  kpp_lunch_start_min?: number
  kpp_lunch_end_min?: number
  activity_sparkline_days?: number
  volume_sparkline_days?: number
  not_worn_min_sec?: number
  not_worn_warn_pct?: number
  not_worn_idle_sec_min?: number
  not_worn_active_sec_max?: number
  not_worn_min_interval_sec?: number
  not_worn_profession_rules?: Record<string, unknown>
  block_7_enabled?: boolean
  block_1_enabled?: boolean
  block_2_enabled?: boolean
  block_3_enabled?: boolean
  block_4_enabled?: boolean
  block_5_enabled?: boolean
  block_6_enabled?: boolean
  comparison_brigades?: string[]
  subblock_visibility?: Record<string, boolean>
  zone_visibility?: Record<string, boolean>
}

export const DEFAULT_COMPARISON_BRIGADES = ['Джалол', 'ЛИ СОН ХАК'] as const

export const DEFAULT_METRIC_SETTINGS: MetricSettings = {
  longIdleMin: 10,
  lowActivityPct: 30,
  brigadeWarnPct: 40,
  shiftTargetTotal: 50,
  brigadeTargetJalol: 20,
  brigadeTargetLiSonHak: 23,
  kppLunchStartMin: 13 * 60,
  kppLunchEndMin: 14 * 60,
  activitySparklineDays: 14,
  volumeSparklineDays: 14,
  notWornMinSec: 900,
  notWornWarnPct: 5,
  notWornIdleSecMin: 54,
  notWornActiveSecMax: 6,
  notWornMinIntervalSec: 1800,
  notWornProfessionRules: {},
  comparisonBrigades: [...DEFAULT_COMPARISON_BRIGADES],
  subblockVisibility: { ...DEFAULT_SUBBLOCK_VISIBILITY },
  zoneVisibility: { ...DEFAULT_ZONE_VISIBILITY },
  block1Enabled: DEFAULT_BLOCK_VISIBILITY.block1,
  block2Enabled: DEFAULT_BLOCK_VISIBILITY.block2,
  block3Enabled: DEFAULT_BLOCK_VISIBILITY.block3,
  block4Enabled: DEFAULT_BLOCK_VISIBILITY.block4,
  block5Enabled: DEFAULT_BLOCK_VISIBILITY.block5,
  block6Enabled: DEFAULT_BLOCK_VISIBILITY.block6,
  block7Enabled: false,
}

const BLOCK_SETTINGS_KEY: Record<DashboardBlockId, BooleanBlockSettingKey> = {
  block1: 'block1Enabled',
  block2: 'block2Enabled',
  block3: 'block3Enabled',
  block4: 'block4Enabled',
  block5: 'block5Enabled',
  block6: 'block6Enabled',
}

let activeSettings: MetricSettings = { ...DEFAULT_METRIC_SETTINGS }

export function getMetricSettings() {
  return activeSettings
}

export function applyMetricSettings(settings: MetricSettings) {
  activeSettings = { ...settings }
}

export function isBlockEnabled(blockId: DashboardBlockId, settings = activeSettings) {
  return settings[BLOCK_SETTINGS_KEY[blockId]]
}

export function isSubblockEnabled(subblockId: SubblockId, settings = activeSettings) {
  return settings.subblockVisibility[subblockId] !== false
}

export function getComparisonBrigades(settings = activeSettings): string[] {
  const brigades = settings.comparisonBrigades.filter((name) => name.trim().length > 0)
  return brigades.length > 0 ? brigades : [...DEFAULT_COMPARISON_BRIGADES]
}

export function getBrigadeShiftTargets(settings = activeSettings): Record<string, number> {
  return {
    Джалол: settings.brigadeTargetJalol,
    'ЛИ СОН ХАК': settings.brigadeTargetLiSonHak,
  }
}

/** @deprecated use getComparisonBrigades() */
export const TRACKED_BRIGADES = DEFAULT_COMPARISON_BRIGADES

function normalizeComparisonBrigades(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_COMPARISON_BRIGADES]
  const names = value.map((item) => String(item).trim()).filter(Boolean)
  return names.length > 0 ? names : [...DEFAULT_COMPARISON_BRIGADES]
}

function normalizeSubblockVisibility(value: unknown): Record<SubblockId, boolean> {
  const result = { ...DEFAULT_SUBBLOCK_VISIBILITY }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  const raw = value as Record<string, unknown>
  for (const id of SUBBLOCK_IDS) {
    if (id in raw) {
      result[id] = raw[id] !== false
    }
  }
  if ('block1_kpp_panel' in raw && !('block1_not_worn_panel' in raw)) {
    result.block1_not_worn_panel = raw.block1_kpp_panel !== false
  }
  return result
}

function normalizeRow(row: MetricSettingsRow | null | undefined): MetricSettings {
  return {
    longIdleMin: row?.long_idle_min ?? DEFAULT_METRIC_SETTINGS.longIdleMin,
    lowActivityPct: row?.low_activity_pct ?? DEFAULT_METRIC_SETTINGS.lowActivityPct,
    brigadeWarnPct: row?.brigade_warn_pct ?? DEFAULT_METRIC_SETTINGS.brigadeWarnPct,
    shiftTargetTotal: row?.shift_target_total ?? DEFAULT_METRIC_SETTINGS.shiftTargetTotal,
    brigadeTargetJalol: row?.brigade_target_jalol ?? DEFAULT_METRIC_SETTINGS.brigadeTargetJalol,
    brigadeTargetLiSonHak: row?.brigade_target_li_son_hak ?? DEFAULT_METRIC_SETTINGS.brigadeTargetLiSonHak,
    kppLunchStartMin: row?.kpp_lunch_start_min ?? DEFAULT_METRIC_SETTINGS.kppLunchStartMin,
    kppLunchEndMin: row?.kpp_lunch_end_min ?? DEFAULT_METRIC_SETTINGS.kppLunchEndMin,
    activitySparklineDays: row?.activity_sparkline_days ?? DEFAULT_METRIC_SETTINGS.activitySparklineDays,
    volumeSparklineDays: row?.volume_sparkline_days ?? DEFAULT_METRIC_SETTINGS.volumeSparklineDays,
    notWornMinSec: row?.not_worn_min_sec ?? DEFAULT_METRIC_SETTINGS.notWornMinSec,
    notWornWarnPct: row?.not_worn_warn_pct ?? DEFAULT_METRIC_SETTINGS.notWornWarnPct,
    notWornIdleSecMin: row?.not_worn_idle_sec_min ?? DEFAULT_METRIC_SETTINGS.notWornIdleSecMin,
    notWornActiveSecMax: row?.not_worn_active_sec_max ?? DEFAULT_METRIC_SETTINGS.notWornActiveSecMax,
    notWornMinIntervalSec: row?.not_worn_min_interval_sec ?? DEFAULT_METRIC_SETTINGS.notWornMinIntervalSec,
    notWornProfessionRules: normalizeNotWornProfessionRules(row?.not_worn_profession_rules),
    comparisonBrigades: normalizeComparisonBrigades(row?.comparison_brigades),
    subblockVisibility: normalizeSubblockVisibility(row?.subblock_visibility),
    zoneVisibility: normalizeZoneVisibility(row?.zone_visibility),
    block1Enabled: row?.block_1_enabled ?? DEFAULT_METRIC_SETTINGS.block1Enabled,
    block2Enabled: row?.block_2_enabled ?? DEFAULT_METRIC_SETTINGS.block2Enabled,
    block3Enabled: row?.block_3_enabled ?? DEFAULT_METRIC_SETTINGS.block3Enabled,
    block4Enabled: row?.block_4_enabled ?? DEFAULT_METRIC_SETTINGS.block4Enabled,
    block5Enabled: row?.block_5_enabled ?? DEFAULT_METRIC_SETTINGS.block5Enabled,
    block6Enabled: row?.block_6_enabled ?? DEFAULT_METRIC_SETTINGS.block6Enabled,
    block7Enabled: row?.block_7_enabled ?? DEFAULT_METRIC_SETTINGS.block7Enabled,
  }
}

export function cloneMetricSettings(settings: MetricSettings): MetricSettings {
  return {
    ...settings,
    comparisonBrigades: [...settings.comparisonBrigades],
    subblockVisibility: { ...settings.subblockVisibility },
    zoneVisibility: { ...settings.zoneVisibility },
    notWornProfessionRules: { ...settings.notWornProfessionRules },
  }
}

function stablePayload(settings: MetricSettings) {
  const payload = toPayload(settings) as Record<string, unknown>
  if (Array.isArray(payload.comparison_brigades)) {
    payload.comparison_brigades = [...payload.comparison_brigades].sort((left, right) =>
      String(left).localeCompare(String(right), 'ru'),
    )
  }
  return payload
}

export function areMetricSettingsEqual(left: MetricSettings, right: MetricSettings) {
  return JSON.stringify(stablePayload(left)) === JSON.stringify(stablePayload(right))
}

function toPayload(settings: MetricSettings): Record<string, unknown> {
  const zoneVisibilityPayload: Record<string, boolean> = {}
  for (const [zoneId, enabled] of Object.entries(settings.zoneVisibility)) {
    zoneVisibilityPayload[String(zoneId)] = enabled
  }

  return {
    long_idle_min: settings.longIdleMin,
    low_activity_pct: settings.lowActivityPct,
    brigade_warn_pct: settings.brigadeWarnPct,
    shift_target_total: settings.shiftTargetTotal,
    brigade_target_jalol: settings.brigadeTargetJalol,
    brigade_target_li_son_hak: settings.brigadeTargetLiSonHak,
    kpp_lunch_start_min: settings.kppLunchStartMin,
    kpp_lunch_end_min: settings.kppLunchEndMin,
    activity_sparkline_days: settings.activitySparklineDays,
    volume_sparkline_days: settings.volumeSparklineDays,
    not_worn_min_sec: settings.notWornMinSec,
    not_worn_warn_pct: settings.notWornWarnPct,
    not_worn_idle_sec_min: settings.notWornIdleSecMin,
    not_worn_active_sec_max: settings.notWornActiveSecMax,
    not_worn_min_interval_sec: settings.notWornMinIntervalSec,
    not_worn_profession_rules: toNotWornProfessionRulesPayload(settings.notWornProfessionRules),
    comparison_brigades: settings.comparisonBrigades,
    subblock_visibility: settings.subblockVisibility,
    zone_visibility: zoneVisibilityPayload,
    block_1_enabled: settings.block1Enabled,
    block_2_enabled: settings.block2Enabled,
    block_3_enabled: settings.block3Enabled,
    block_4_enabled: settings.block4Enabled,
    block_5_enabled: settings.block5Enabled,
    block_6_enabled: settings.block6Enabled,
    block_7_enabled: settings.block7Enabled,
  }
}

type MetricSettingsResponse = {
  settings?: MetricSettingsRow
  error?: string
}

export async function loadMetricSettings() {
  const response = await fetch(getEdgeFunctionUrl('metric-settings'), {
    headers: getEdgeFunctionHeaders(),
  })
  const payload = await readEdgeFunctionJson<MetricSettingsResponse>(response)
  const settings = normalizeRow(payload?.settings)
  applyMetricSettings(settings)
  return settings
}

export async function saveMetricSettings(settings: MetricSettings, password: string) {
  const response = await fetch(getEdgeFunctionUrl('metric-settings'), {
    method: 'PUT',
    headers: getEdgeFunctionHeaders(password, true),
    body: JSON.stringify(toPayload(settings)),
  })
  const payload = await readEdgeFunctionJson<MetricSettingsResponse>(response)
  const saved = normalizeRow(payload?.settings)
  applyMetricSettings(saved)
  return saved
}

/** @deprecated use getMetricSettings().longIdleMin */
export const LONG_IDLE_THRESHOLD_MIN = DEFAULT_METRIC_SETTINGS.longIdleMin
/** @deprecated use getMetricSettings().lowActivityPct */
export const LOW_ACTIVITY_THRESHOLD = DEFAULT_METRIC_SETTINGS.lowActivityPct
/** @deprecated use getMetricSettings().shiftTargetTotal */
export const SHIFT_TARGET_WORKERS = DEFAULT_METRIC_SETTINGS.shiftTargetTotal
/** @deprecated use getMetricSettings().activitySparklineDays */
export const ACTIVITY_DYNAMICS_SPARKLINE_DAYS = DEFAULT_METRIC_SETTINGS.activitySparklineDays
/** @deprecated use getMetricSettings().volumeSparklineDays */
export const VOLUME_DYNAMICS_SPARKLINE_DAYS = DEFAULT_METRIC_SETTINGS.volumeSparklineDays
