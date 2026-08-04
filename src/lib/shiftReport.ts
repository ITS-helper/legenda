// Отчёт по смене: страница на бригаду со строкой на каждого сотрудника —
// лента хронологии и автокомментарий по метрикам. Данные собираем здесь (тем же
// загрузчиком, что и диалог детализации), PDF рисует edge function send-report.
import { formatEdgeFunctionError, getEdgeFunctionHeaders, getEdgeFunctionUrl } from './edgeFunctions'
import { formatMskTimeFromMinutes } from './mskTime'
import {
  formatSeconds,
  getShiftActivityPercents,
  NO_SUPERVISOR,
  type ShiftMetricRow,
} from './reports'
import { loadShiftInactivityDetail, type ShiftInactivityDetail, type TimelineSegment } from './shiftActivityTimeline'

export type ShiftReportSegmentKind = 'work' | 'go' | 'weak' | 'long_idle' | 'none' | 'lunch' | 'not_worn'

type ShiftReportSegment = { startMin: number; endMin: number; kind: ShiftReportSegmentKind }

type ShiftReportEmployee = {
  full_name: string
  employee_number: string
  profession: string | null
  shift_label: string
  activity_pct: number
  axisStartMin: number
  axisEndMin: number
  shiftStartMin: number | null
  shiftEndMin: number | null
  strip: ShiftReportSegment[]
  lunch: ShiftReportSegment[]
  comment: string[]
}

export type ShiftReportPayload = {
  reportDate: string
  reportDateLabel: string
  objectName: string
  brigades: Array<{ supervisor_name: string; employees: ShiftReportEmployee[] }>
}

const OBJECT_NAME = 'Легенда Васильевского, корпус 2'
/** Сколько смен грузим одновременно: RPC детализации тяжёлый, но по одной — долго. */
const DETAIL_CONCURRENCY = 4
/** Разрыв между последней активной минутой и концом смены, о котором стоит написать. */
const IDLE_TAIL_MIN = 30

const COLOR_CLASS_TO_KIND: Record<string, ShiftReportSegmentKind> = {
  'shift-timeline-work': 'work',
  'shift-timeline-strip-go': 'go',
  'shift-timeline-weak': 'weak',
  'shift-timeline-long-idle': 'long_idle',
  'shift-timeline-none': 'none',
  'shift-timeline-not-worn': 'not_worn',
  'shift-timeline-lunch': 'lunch',
}

function toSegments(segments: TimelineSegment[], fallback: ShiftReportSegmentKind): ShiftReportSegment[] {
  return segments.map((segment) => ({
    startMin: segment.startMin,
    endMin: segment.endMin,
    kind: (segment.colorClass ? COLOR_CLASS_TO_KIND[segment.colorClass] : undefined) ?? fallback,
  }))
}

function formatShiftLabel(detail: ShiftInactivityDetail, row: ShiftMetricRow) {
  const duration = formatSeconds(row.total_sec_total)
  if (detail.shiftStartMin == null || detail.shiftEndMin == null) return `Телеметрия: ${duration}`
  return `${formatMskTimeFromMinutes(detail.shiftStartMin)} – ${formatMskTimeFromMinutes(detail.shiftEndMin)} · ${duration}`
}

/** Последняя минута, где сотрудник реально работал (активность или ходьба между зонами). */
function lastActiveMin(strip: ShiftReportSegment[]) {
  const active = strip.filter((segment) => segment.kind === 'work' || segment.kind === 'go')
  return active.length > 0 ? Math.max(...active.map((segment) => segment.endMin)) : null
}

/** Автотекст: только факты из наших метрик, без оценок «хорошо/плохо». */
function buildComment(
  row: ShiftMetricRow,
  detail: ShiftInactivityDetail,
  strip: ShiftReportSegment[],
): string[] {
  const percents = getShiftActivityPercents(row)
  const lines: string[] = [
    `Активность ${Math.round(percents.activity_pct)}%, слабая ${Math.round(percents.weak_activity_pct)}%, ` +
      `длительный простой ${Math.round(percents.long_idle_pct)}%.`,
  ]

  const lastActive = lastActiveMin(strip)
  if (lastActive != null && detail.shiftEndMin != null && detail.shiftEndMin - lastActive >= IDLE_TAIL_MIN) {
    lines.push(
      `После ${formatMskTimeFromMinutes(lastActive)} активной работы нет ` +
        `(до конца смены ${formatSeconds((detail.shiftEndMin - lastActive) * 60)}).`,
    )
  }

  const longest = [...detail.idleEpisodes].sort((left, right) => right.duration_min - left.duration_min)[0]
  if (longest) {
    lines.push(
      `Длинный простой ${formatSeconds(longest.duration_min * 60)} ` +
        `(${formatMskTimeFromMinutes(isoMinutes(longest.dt_start))}–${formatMskTimeFromMinutes(isoMinutes(longest.dt_end))}), ` +
        `зона: ${longest.zonaName}.`,
    )
    if (detail.idleEpisodes.length > 1) {
      const totalMin = detail.idleEpisodes.reduce((sum, episode) => sum + episode.duration_min, 0)
      lines.push(`Всего эпизодов простоя: ${detail.idleEpisodes.length} на ${formatSeconds(totalMin * 60)}.`)
    }
  }

  if (row.total_sec_total === 0) lines.push('Телеметрии за смену нет.')

  return lines
}

function isoMinutes(iso: string) {
  const date = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0')
  return hour * 60 + minute
}

function formatReportDateLabel(reportDate: string) {
  const [year, month, day] = reportDate.split('-')
  return year && month && day ? `${day}.${month}.${year.slice(2)}` : reportDate
}

/** Загружает детализацию по каждой смене и собирает payload для рендера PDF. */
export async function buildShiftReportPayload(
  reportDate: string,
  rows: ShiftMetricRow[],
  onProgress?: (done: number, total: number) => void,
): Promise<ShiftReportPayload> {
  const employees: Array<{ supervisor_name: string; employee: ShiftReportEmployee }> = []
  let done = 0

  const queue = [...rows]
  async function worker() {
    for (;;) {
      const row = queue.shift()
      if (!row) return
      const detail = await loadShiftInactivityDetail(reportDate, Number(row.ww_shift_id))
      const strip = toSegments(detail.stripSegments, 'none')
      const lunchRow = detail.timelineRows.find((timelineRow) => timelineRow.id === 'lunch')

      employees.push({
        supervisor_name: row.supervisor_name ?? NO_SUPERVISOR,
        employee: {
          full_name: row.full_name,
          employee_number: String(row.employee_number ?? ''),
          profession: row.profession ?? null,
          shift_label: formatShiftLabel(detail, row),
          activity_pct: getShiftActivityPercents(row).activity_pct,
          axisStartMin: detail.axisStartMin,
          axisEndMin: detail.axisEndMin,
          shiftStartMin: detail.shiftStartMin,
          shiftEndMin: detail.shiftEndMin,
          strip,
          lunch: toSegments(lunchRow?.segments ?? [], 'lunch'),
          comment: buildComment(row, detail, strip),
        },
      })
      done += 1
      onProgress?.(done, rows.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, rows.length) }, worker))

  const byBrigade = new Map<string, ShiftReportEmployee[]>()
  for (const item of employees) {
    const list = byBrigade.get(item.supervisor_name) ?? []
    list.push(item.employee)
    byBrigade.set(item.supervisor_name, list)
  }

  return {
    reportDate,
    reportDateLabel: formatReportDateLabel(reportDate),
    objectName: OBJECT_NAME,
    brigades: [...byBrigade.entries()]
      .map(([supervisor_name, list]) => ({
        supervisor_name,
        employees: list.sort((left, right) => left.full_name.localeCompare(right.full_name, 'ru')),
      }))
      .sort((left, right) => left.supervisor_name.localeCompare(right.supervisor_name, 'ru')),
  }
}

/** Просит edge function нарисовать PDF и отдаёт его как Blob. */
export async function requestShiftReportPdf(payload: ShiftReportPayload, password: string) {
  const url = new URL(getEdgeFunctionUrl('send-report'))
  url.searchParams.set('resource', 'shift-report')

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: getEdgeFunctionHeaders(password, true),
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const message = await response
      .json()
      .then((body: { error?: string }) => body.error ?? `HTTP ${response.status}`)
      .catch(() => `HTTP ${response.status}`)
    throw new Error(formatEdgeFunctionError(message))
  }

  return response.blob()
}

export function downloadBlob(blob: Blob, fileName: string) {
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(href)
}
