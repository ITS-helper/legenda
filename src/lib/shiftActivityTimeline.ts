import { MSK_TIME_ZONE, formatMskTimeFromMinutes } from './mskTime'
import { supabase } from './supabase'
import { zoneName } from './zones'

export type TimelineSegment = {
  startMin: number
  endMin: number
  label: string
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
  timelineRows: ShiftTimelineRow[]
  axisStartMin: number
  axisEndMin: number
  /**
   * Факт получения и сдачи часов (отчёт 6) в минутах МСК от начала суток.
   * null — факта нет, метку не рисуем (подстановки по плану/телеметрии не делаем).
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

const AXIS_START_MIN = 6 * 60
const AXIS_END_MIN = 24 * 60

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

function mergeMinuteSegments(items: Array<{ startMin: number; endMin: number }>) {
  if (items.length === 0) return [] satisfies TimelineSegment[]

  const sorted = [...items].sort((left, right) => left.startMin - right.startMin)
  const merged: TimelineSegment[] = []

  for (const item of sorted) {
    const last = merged[merged.length - 1]
    if (last && item.startMin <= last.endMin + 1) {
      last.endMin = Math.max(last.endMin, item.endMin)
      last.label = `${formatMskTimeFromMinutes(last.startMin)}–${formatMskTimeFromMinutes(last.endMin)}`
    } else {
      merged.push({
        startMin: item.startMin,
        endMin: item.endMin,
        label: `${formatMskTimeFromMinutes(item.startMin)}–${formatMskTimeFromMinutes(item.endMin)}`,
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

// Порог активной минуты в детализации (секунд работы на минуту).
const ACTIVE_WORK_SEC = 20

// Собирает поминутные сегменты по предикату (получает минуту и её начало в минутах МСК).
function collectMinuteSegments(
  minutes: RawMinute[],
  include: (minute: RawMinute, startMin: number) => boolean,
) {
  const items: Array<{ startMin: number; endMin: number }> = []

  for (const minute of minutes) {
    const startMin = isoToMskMinutes(minute.event_at)
    if (!include(minute, startMin)) continue
    items.push({ startMin, endMin: startMin + 1 })
  }

  return mergeMinuteSegments(items)
}

export function buildShiftActivityTimeline(payload: {
  minutes: RawMinute[]
  idleEpisodes: RawIdleEpisode[]
  notWornEpisodes: RawNotWornEpisode[]
}): ShiftTimelineRow[] {
  // episode_end — фактическая метка конца эпизода; длительность (episode_sec) НЕ добавляем к концу.
  const notWornSegments = episodeToSegments(
    payload.notWornEpisodes.map((episode) => ({
      start: episode.episode_start,
      end: episode.episode_end,
    })),
  )

  // Минута попадает в «Бездействие в зоне» — активность/слабая её не показывают,
  // чтобы не противоречить выводу «человек бездействовал» (активность и бездействие не пересекаются).
  const inNotWorn = (startMin: number) =>
    notWornSegments.some((segment) => startMin >= segment.startMin && startMin < segment.endMin)

  const workSegments = collectMinuteSegments(
    payload.minutes,
    (minute, startMin) => !inNotWorn(startMin) && (Number(minute.work_sec) || 0) >= ACTIVE_WORK_SEC,
  )

  const weakSegments = collectMinuteSegments(payload.minutes, (minute, startMin) => {
    if (inNotWorn(startMin)) return false
    const work = Number(minute.work_sec) || 0
    return work > 0 && work < ACTIVE_WORK_SEC
  })

  const rows: ShiftTimelineRow[] = [
    {
      id: 'not_worn',
      label: 'Бездействие в зоне',
      colorClass: 'shift-timeline-not-worn',
      segments: notWornSegments,
    },
    {
      id: 'work',
      label: 'Активность',
      colorClass: 'shift-timeline-work',
      segments: workSegments,
    },
    {
      id: 'weak',
      label: 'Слабая активность',
      colorClass: 'shift-timeline-weak',
      segments: weakSegments,
    },
  ]

  return rows.filter((row) => row.id === 'work' || row.segments.length > 0)
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
  const timelineRows = buildShiftActivityTimeline({
    minutes,
    idleEpisodes: payload.idle_episodes ?? [],
    notWornEpisodes,
  })

  // Границы смены — только факт: когда получил и когда сдал часы (отчёт 6).
  // Никаких подстановок по плану или краям телеметрии: нет факта — нет метки.
  const shiftStartMin = payload.shift_start ? isoToMskMinutes(payload.shift_start) : null
  const shiftEndMin = payload.shift_end ? isoToMskMinutes(payload.shift_end) : null

  return {
    idleEpisodes,
    notWornEpisodes,
    timelineRows,
    axisStartMin: AXIS_START_MIN,
    axisEndMin: AXIS_END_MIN,
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
