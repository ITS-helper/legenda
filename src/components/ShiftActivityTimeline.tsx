import type { CSSProperties } from 'react'
import { formatMskTimeFromMinutes } from '../lib/mskTime'
import {
  segmentLeftPct,
  segmentWidthPct,
  timelineAxisTicks,
  type ShiftTimelineRow,
  type TimelineSegment,
} from '../lib/shiftActivityTimeline'

type Props = {
  stripSegments: TimelineSegment[]
  rows: ShiftTimelineRow[]
  axisStartMin: number
  axisEndMin: number
  title?: string
  shiftStartMin?: number | null
  shiftEndMin?: number | null
}

type ShiftMarker = { id: string; label: string; frac: number; className: string }

const LEGEND_ITEMS = [
  { label: 'Активность', colorClass: 'shift-timeline-work' },
  { label: 'Ходьба между зонами', colorClass: 'shift-timeline-strip-go' },
  { label: 'Слабая активность', colorClass: 'shift-timeline-weak' },
  { label: 'Нет телеметрии', colorClass: 'shift-timeline-none' },
  { label: 'Длительный простой', colorClass: 'shift-timeline-long-idle' },
  { label: 'Бездействие в зоне', colorClass: 'shift-timeline-not-worn' },
]

function buildShiftMarkers(
  axisStartMin: number,
  axisEndMin: number,
  shiftStartMin?: number | null,
  shiftEndMin?: number | null,
): ShiftMarker[] {
  const span = axisEndMin - axisStartMin
  if (span <= 0) return []

  const markers: ShiftMarker[] = []
  const push = (id: string, label: string, className: string, min?: number | null) => {
    if (min == null || min < axisStartMin || min > axisEndMin) return
    markers.push({ id, label, className, frac: (min - axisStartMin) / span })
  }

  push('shift-start', 'начало смены', 'shift-timeline-marker-start', shiftStartMin)
  push('shift-end', 'конец смены', 'shift-timeline-marker-end', shiftEndMin)
  return markers
}

function renderSegments(
  segments: TimelineSegment[],
  fallbackColorClass: string,
  axisStartMin: number,
  axisEndMin: number,
) {
  return segments.map((segment) => (
    <div
      key={`${segment.startMin}-${segment.endMin}-${segment.colorClass ?? fallbackColorClass}`}
      className={`shift-timeline-segment ${segment.colorClass ?? fallbackColorClass}`}
      style={{
        left: `${segmentLeftPct(segment.startMin, axisStartMin, axisEndMin)}%`,
        width: `${segmentWidthPct(segment.startMin, segment.endMin, axisStartMin, axisEndMin)}%`,
      }}
      title={segment.label}
    />
  ))
}

export function ShiftActivityTimeline({
  stripSegments,
  rows,
  axisStartMin,
  axisEndMin,
  title,
  shiftStartMin,
  shiftEndMin,
}: Props) {
  const ticks = timelineAxisTicks(axisStartMin, axisEndMin, 60)
  const markers = buildShiftMarkers(axisStartMin, axisEndMin, shiftStartMin, shiftEndMin)

  return (
    <div className="shift-timeline" aria-label={title ?? 'Анализ активности по часам смены'}>
      {title ? <h4 className="shift-timeline-title">{title}</h4> : null}

      <div className="shift-timeline-chart">
        <div className="shift-timeline-inner">
          {markers.map((marker) => (
            <div
              key={marker.id}
              className={`shift-timeline-marker ${marker.className}`}
              style={{ '--marker-frac': marker.frac } as CSSProperties}
            >
              <span
                className={`shift-timeline-marker-label${
                  marker.frac > 0.92
                    ? ' shift-timeline-marker-label-edge-end'
                    : marker.frac < 0.08
                      ? ' shift-timeline-marker-label-edge-start'
                      : ''
                }`}
              >
                {marker.label}
              </span>
              <span className="shift-timeline-marker-line" />
            </div>
          ))}

          <div className="shift-timeline-axis-row" aria-hidden="true">
            <div className="shift-timeline-axis-spacer" />
            <div className="shift-timeline-axis">
              {ticks.map((tick) => (
                <span
                  key={tick}
                  className="shift-timeline-axis-tick"
                  style={{ left: `${segmentLeftPct(tick, axisStartMin, axisEndMin)}%` }}
                >
                  {formatMskTimeFromMinutes(tick)}
                </span>
              ))}
            </div>
          </div>

          <div className="shift-timeline-rows">
            <div className="shift-timeline-row" key="strip">
              <div className="shift-timeline-row-label">Хронология смены</div>
              <div className="shift-timeline-row-track shift-timeline-strip-track">
                {renderSegments(stripSegments, 'shift-timeline-none', axisStartMin, axisEndMin)}
              </div>
            </div>

            {rows.map((row) => (
              <div className="shift-timeline-row" key={row.id}>
                <div className="shift-timeline-row-label">{row.label}</div>
                <div className="shift-timeline-row-track">
                  {renderSegments(row.segments, row.colorClass, axisStartMin, axisEndMin)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="shift-timeline-legend">
        {LEGEND_ITEMS.map((item) => (
          <span className="shift-timeline-legend-item" key={item.label}>
            <span className={`shift-timeline-legend-swatch ${item.colorClass}`} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  )
}
