import { MSK_TIME_ZONE, formatMskTimeFromMinutes } from './mskTime'
import { supabase } from './supabase'
import { PV_ZONE } from './reports'
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

const SHIFT_WINDOW_START_MIN = 7 * 60
const SHIFT_WINDOW_END_MIN = 23 * 60
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

function minuteInSegments(minute: number, segments: TimelineSegment[]) {
  return segments.some((segment) => minute >= segment.startMin && minute < segment.endMin)
}

function dominantMinuteKind(minute: RawMinute) {
  const work = Number(minute.work_sec ?? 0)
  const go = Number(minute.go_sec ?? 0)
  const idle = Number(minute.idle_sec ?? 0)
  if (work >= go && work >= idle && work > 0) return 'work'
  if (go >= work && go >= idle && go > 0) return 'go'
  if (idle > 0) return 'weak'
  return null
}

function buildMinuteRowSegments(
  minutes: RawMinute[],
  excludeWhen: (minute: number) => boolean,
  pickKind: (minute: RawMinute) => string | null,
) {
  const items: Array<{ startMin: number; endMin: number }> = []

  for (const minute of minutes) {
    const startMin = isoToMskMinutes(minute.event_at)
    const endMin = startMin + 1
    if (excludeWhen(startMin)) continue
    if (pickKind(minute) === null) continue
    items.push({ startMin, endMin })
  }

  return mergeMinuteSegments(items)
}

export function buildShiftActivityTimeline(payload: {
  minutes: RawMinute[]
  idleEpisodes: RawIdleEpisode[]
  notWornEpisodes: RawNotWornEpisode[]
}): ShiftTimelineRow[] {
  const notWornSegments = episodeToSegments(
    payload.notWornEpisodes.map((episode) => ({
      start: episode.episode_start,
      end: episode.episode_end,
      endSec: Number(episode.episode_sec ?? 60),
    })),
  )

  const longIdlePvSegments = episodeToSegments(
    payload.idleEpisodes
      .filter((episode) => Number(episode.ble_tag_zone) === PV_ZONE)
      .map((episode) => ({ start: episode.dt_start, end: episode.dt_end })),
  )

  const longIdleOtherSegments = episodeToSegments(
    payload.idleEpisodes
      .filter((episode) => Number(episode.ble_tag_zone) !== PV_ZONE)
      .map((episode) => ({ start: episode.dt_start, end: episode.dt_end })),
  )

  const excludeBusy = (minute: number) =>
    minuteInSegments(minute, notWornSegments) || minuteInSegments(minute, longIdlePvSegments)

  const workSegments = buildMinuteRowSegments(
    payload.minutes,
    excludeBusy,
    (minute) => (dominantMinuteKind(minute) === 'work' ? 'work' : null),
  )

  const goSegments = buildMinuteRowSegments(
    payload.minutes,
    (minute) => excludeBusy(minute) || minuteInSegments(minute, workSegments),
    (minute) => (dominantMinuteKind(minute) === 'go' ? 'go' : null),
  )

  const weakSegments = buildMinuteRowSegments(
    payload.minutes,
    (minute) =>
      excludeBusy(minute) ||
      minuteInSegments(minute, workSegments) ||
      minuteInSegments(minute, goSegments) ||
      minuteInSegments(minute, longIdleOtherSegments),
    (minute) => (dominantMinuteKind(minute) === 'weak' ? 'weak' : null),
  )

  const shiftWindowSegments: TimelineSegment[] = [
    {
      startMin: SHIFT_WINDOW_START_MIN,
      endMin: SHIFT_WINDOW_END_MIN,
      label: `${formatMskTimeFromMinutes(SHIFT_WINDOW_START_MIN)}–${formatMskTimeFromMinutes(SHIFT_WINDOW_END_MIN)}`,
    },
  ]

  const rows: ShiftTimelineRow[] = [
    {
      id: 'shift_window',
      label: 'Окно аналитики',
      colorClass: 'shift-timeline-window',
      segments: shiftWindowSegments,
    },
    {
      id: 'long_idle_pv',
      label: 'Длительный простой в ПВ',
      colorClass: 'shift-timeline-long-idle',
      segments: longIdlePvSegments,
    },
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
    {
      id: 'go',
      label: 'Ходьба между зонами',
      colorClass: 'shift-timeline-go',
      segments: goSegments,
    },
  ]

  if (longIdleOtherSegments.length > 0) {
    rows.splice(2, 0, {
      id: 'long_idle_other',
      label: 'Длительный простой (другие зоны)',
      colorClass: 'shift-timeline-long-idle-other',
      segments: longIdleOtherSegments,
    })
  }

  return rows.filter((row) => row.id === 'shift_window' || row.segments.length > 0)
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
  const timelineRows = buildShiftActivityTimeline({
    minutes: payload.minutes ?? [],
    idleEpisodes: payload.idle_episodes ?? [],
    notWornEpisodes,
  })

  return {
    idleEpisodes,
    notWornEpisodes,
    timelineRows,
    axisStartMin: AXIS_START_MIN,
    axisEndMin: AXIS_END_MIN,
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
