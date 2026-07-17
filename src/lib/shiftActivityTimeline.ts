import { MSK_TIME_ZONE, formatMskTimeFromMinutes } from './mskTime'
import { supabase } from './supabase'
import { zoneName } from './zones'

export type TimelineSegment = {
  startMin: number
  endMin: number
  label: string
  /** Цвет конкретного сегмента (для ленты хронологии); если нет — берётся цвет строки. */
  colorClass?: string
}

export type ShiftTimelineRow = {
  id: string
  label: string
  colorClass: string
  segments: TimelineSegment[]
}

export type ShiftInactivityDetail = {
  idleEpisodes: Array<{
    session_id: number | null
    dt_start: string
    dt_end: string
    duration_min: number
    ble_tag_zone: number | null
    zonaName: string
  }>
  notWornEpisodes: Array<{
    episode_start: string
    episode_end: string
    episode_sec: number
  }>
  /** Сплошная лента хронологии: каждая минута смены окрашена, без пустот. */
  stripSegments: TimelineSegment[]
  /** Строки эпизодов (длительный простой, бездействие в зоне). */
  timelineRows: ShiftTimelineRow[]
  axisStartMin: number
  axisEndMin: number
  /**
   * Границы смены: самое раннее/позднее из факта часов (отчёт 6) и телеметрии.
   * Телеметрия не может оказаться за пределами меток.
   */
  shiftStartMin: number | null
  shiftEndMin: number | null
}

type RawMinute = {
  event_at: string
  work_sec: number
  go_sec: number
  idle_sec: number
  total_sec: number
  zona: string | null
}

type RawIdleEpisode = {
  session_id: number | null
  dt_start: string
  dt_end: string
  duration_min: number
  ble_tag_zone: number | null
}

type RawNotWornEpisode = {
  episode_start: string
  episode_end: string
  episode_sec: number
}

const FALLBACK_AXIS_START_MIN = 6 * 60
const FALLBACK_AXIS_END_MIN = 24 * 60

export function isoToMskMinutes(iso: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: MSK_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso))

  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

function isoToMskMinutesEnd(iso: string, fallbackSec = 60) {
  const start = isoToMskMinutes(iso)
  return start + Math.max(1, Math.round(fallbackSec / 60))
}

function segmentLabel(startMin: number, endMin: number, prefix?: string) {
  const range = `${formatMskTimeFromMinutes(startMin)}–${formatMskTimeFromMinutes(endMin)}`
  return prefix ? `${prefix}: ${range}` : range
}

function mergeMinuteSegments(items: Array<{ startMin: number; endMin: number }>) {
  if (items.length === 0) return [] satisfies TimelineSegment[]

  const sorted = [...items].sort((left, right) => left.startMin - right.startMin)
  const merged: TimelineSegment[] = []

  for (const item of sorted) {
    const last = merged[merged.length - 1]
    if (last && item.startMin <= last.endMin + 1) {
      last.endMin = Math.max(last.endMin, item.endMin)
      last.label = segmentLabel(last.startMin, last.endMin)
    } else {
      merged.push({
        startMin: item.startMin,
        endMin: item.endMin,
        label: segmentLabel(item.startMin, item.endMin),
      })
    }
  }

  return merged
}

function episodeToSegments(
  episodes: Array<{ start: string; end: string; endSec?: number }>,
): TimelineSegment[] {
  return mergeMinuteSegments(
    episodes.map((episode) => ({
      startMin: isoToMskMinutes(episode.start),
      endMin: isoToMskMinutesEnd(episode.end, episode.endSec ?? 60),
    })),
  )
}

// Порог «доминирующего» состояния минуты (секунд на минуту).
const ACTIVE_WORK_SEC = 20

type StripKind = 'work' | 'go' | 'weak' | 'none'

const STRIP_KIND_META: Record<StripKind, { label: string; colorClass: string }> = {
  work: { label: 'Активность', colorClass: 'shift-timeline-work' },
  go: { label: 'Ходьба между зонами', colorClass: 'shift-timeline-strip-go' },
  weak: { label: 'Слабая активность', colorClass: 'shift-timeline-weak' },
  none: { label: 'Нет телеметрии', colorClass: 'shift-timeline-none' },
}

function minuteStripKind(minute: RawMinute): Exclude<StripKind, 'none'> {
  const work = Number(minute.work_sec) || 0
  if (work >= ACTIVE_WORK_SEC) return 'work'
  const go = Number(minute.go_sec) || 0
  if (go >= ACTIVE_WORK_SEC) return 'go'
  // Всё остальное — «слабая активность»: idle-минуты и микродвижения
  // (как в карточке метрики: простой, не попавший в длительные эпизоды).
  return 'weak'
}

function makeStripSegment(startMin: number, endMin: number, kind: StripKind): TimelineSegment {
  const meta = STRIP_KIND_META[kind]
  return {
    startMin,
    endMin,
    label: segmentLabel(startMin, endMin, meta.label),
    colorClass: meta.colorClass,
  }
}

/**
 * Сплошная лента хронологии: каждая минута между началом и концом смены получает
 * категорию (активность / ходьба / слабая), разрывы телеметрии закрашиваются
 * «Нет телеметрии» — пустых мест на ленте не остаётся.
 */
export function buildShiftStrip(
  minutes: RawMinute[],
  coverStartMin: number | null,
  coverEndMin: number | null,
): TimelineSegment[] {
  const perMinute = minutes
    .map((minute) => ({ startMin: isoToMskMinutes(minute.event_at), kind: minuteStripKind(minute) }))
    .sort((left, right) => left.startMin - right.startMin)

  const segments: TimelineSegment[] = []
  let cursor = coverStartMin

  const pushGapUntil = (min: number) => {
    if (cursor != null && min > cursor) segments.push(makeStripSegment(cursor, min, 'none'))
  }

  for (const item of perMinute) {
    if (cursor != null && item.startMin < cursor) continue
    pushGapUntil(item.startMin)

    const last = segments[segments.length - 1]
    if (
      last &&
      last.colorClass === STRIP_KIND_META[item.kind].colorClass &&
      item.startMin <= last.endMin
    ) {
      last.endMin = item.startMin + 1
      last.label = segmentLabel(last.startMin, last.endMin, STRIP_KIND_META[item.kind].label)
    } else {
      segments.push(makeStripSegment(item.startMin, item.startMin + 1, item.kind))
    }
    cursor = item.startMin + 1
  }

  if (coverEndMin != null) pushGapUntil(coverEndMin)

  return segments
}

export function buildEpisodeRows(payload: {
  idleEpisodes: RawIdleEpisode[]
  notWornEpisodes: RawNotWornEpisode[]
}): ShiftTimelineRow[] {
  // Длительный простой (отчёт 10) — эпизоды как есть, без изъятий по активности:
  // порог idle >90% относится к эпизоду целиком, поэтому отдельные рабочие
  // минуты внутри полосы — норма (микродвижения).
  const longIdleSegments = episodeToSegments(
    payload.idleEpisodes.map((episode) => ({ start: episode.dt_start, end: episode.dt_end })),
  )

  // episode_end — фактическая метка конца эпизода; длительность (episode_sec) НЕ добавляем к концу.
  const notWornSegments = episodeToSegments(
    payload.notWornEpisodes.map((episode) => ({
      start: episode.episode_start,
      end: episode.episode_end,
    })),
  )

  const rows: ShiftTimelineRow[] = [
    {
      id: 'long_idle',
      label: 'Длительный простой',
      colorClass: 'shift-timeline-long-idle',
      segments: longIdleSegments,
    },
    {
      id: 'not_worn',
      label: 'Бездействие в зоне',
      colorClass: 'shift-timeline-not-worn',
      segments: notWornSegments,
    },
  ]

  return rows.filter((row) => row.segments.length > 0)
}

function minDefined(values: Array<number | null>) {
  const defined = values.filter((value): value is number => value != null)
  return defined.length > 0 ? Math.min(...defined) : null
}

function maxDefined(values: Array<number | null>) {
  const defined = values.filter((value): value is number => value != null)
  return defined.length > 0 ? Math.max(...defined) : null
}

export async function loadShiftInactivityDetail(
  reportDate: string,
  wwShiftId: number,
): Promise<ShiftInactivityDetail> {
  const { data, error } = await supabase.schema('analytics').rpc('shift_inactivity_detail_for_shift', {
    p_report_date: reportDate,
    p_ww_shift_id: wwShiftId,
  })

  if (error) throw error

  const payload = (data ?? {
    minutes: [],
    idle_episodes: [],
    not_worn_episodes: [],
  }) as {
    minutes: RawMinute[]
    idle_episodes: RawIdleEpisode[]
    not_worn_episodes: RawNotWornEpisode[]
    shift_start?: string | null
    shift_end?: string | null
  }

  const idleEpisodes = (payload.idle_episodes ?? []).map((episode) => ({
    session_id: episode.session_id,
    dt_start: episode.dt_start,
    dt_end: episode.dt_end,
    duration_min: Number(episode.duration_min),
    ble_tag_zone: episode.ble_tag_zone,
    zonaName: zoneName(episode.ble_tag_zone),
  }))

  const notWornEpisodes = payload.not_worn_episodes ?? []
  const minutes = payload.minutes ?? []

  // Границы смены: факт часов (отчёт 6) расширяем телеметрией — если часы писали
  // данные раньше отметки выдачи (или позже сдачи), смена по факту уже шла.
  const watchStartMin = payload.shift_start ? isoToMskMinutes(payload.shift_start) : null
  const watchEndMin = payload.shift_end ? isoToMskMinutes(payload.shift_end) : null
  const minuteStarts = minutes.map((minute) => isoToMskMinutes(minute.event_at))
  const telemetryStartMin = minuteStarts.length > 0 ? Math.min(...minuteStarts) : null
  const telemetryEndMin = minuteStarts.length > 0 ? Math.max(...minuteStarts) + 1 : null

  const shiftStartMin = minDefined([watchStartMin, telemetryStartMin])
  const shiftEndMin = maxDefined([watchEndMin, telemetryEndMin])

  const stripSegments = buildShiftStrip(minutes, shiftStartMin, shiftEndMin)
  const timelineRows = buildEpisodeRows({
    idleEpisodes: payload.idle_episodes ?? [],
    notWornEpisodes,
  })

  // Ось — по границам смены с запасом до целого часа; без данных — окно 06:00–24:00.
  const axisStartMin =
    shiftStartMin != null
      ? Math.max(0, Math.floor((shiftStartMin - 10) / 60) * 60)
      : FALLBACK_AXIS_START_MIN
  const axisEndMin =
    shiftEndMin != null
      ? Math.min(24 * 60, Math.ceil((shiftEndMin + 10) / 60) * 60)
      : FALLBACK_AXIS_END_MIN

  return {
    idleEpisodes,
    notWornEpisodes,
    stripSegments,
    timelineRows,
    axisStartMin,
    axisEndMin,
    shiftStartMin,
    shiftEndMin,
  }
}

export function timelineAxisTicks(startMin: number, endMin: number, stepMin = 60) {
  const ticks: number[] = []
  for (let minute = startMin; minute <= endMin; minute += stepMin) {
    ticks.push(minute)
  }
  return ticks
}

export function segmentLeftPct(startMin: number, axisStartMin: number, axisEndMin: number) {
  const span = axisEndMin - axisStartMin
  if (span <= 0) return 0
  return ((startMin - axisStartMin) / span) * 100
}

export function segmentWidthPct(startMin: number, endMin: number, axisStartMin: number, axisEndMin: number) {
  const span = axisEndMin - axisStartMin
  if (span <= 0) return 0
  return (Math.max(1, endMin - startMin) / span) * 100
}
