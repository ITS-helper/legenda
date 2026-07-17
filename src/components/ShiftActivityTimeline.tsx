import type { CSSProperties } from 'react'
import { formatMskTimeFromMinutes } from '../lib/mskTime'
import {
  segmentLeftPct,
  segmentWidthPct,
  timelineAxisTicks,
  type ShiftTimelineRow,
} from '../lib/shiftActivityTimeline'

type Props = {
  rows: ShiftTimelineRow[]
  axisStartMin: number
  axisEndMin: number
  title?: string
  shiftStartMin?: number | null
  shiftEndMin?: number | null
}

type ShiftMarker = { id: string; label: string; frac: number; className: string }

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

  push('shift-start', 'получил часы', 'shift-timeline-marker-start', shiftStartMin)
  push('shift-end', 'сдал часы', 'shift-timeline-marker-end', shiftEndMin)
  return markers
}

export function ShiftActivityTimeline({
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
              <span className="shift-timeline-marker-label">{marker.label}</span>
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
            {rows.map((row) => (
              <div className="shift-timeline-row" key={row.id}>
                <div className="shift-timeline-row-label">{row.label}</div>
                <div className="shift-timeline-row-track">
                  {row.segments.map((segment) => (
                    <div
                      key={`${row.id}-${segment.startMin}-${segment.endMin}`}
                      className={`shift-timeline-segment ${row.colorClass}`}
                      style={{
                        left: `${segmentLeftPct(segment.startMin, axisStartMin, axisEndMin)}%`,
                        width: `${segmentWidthPct(segment.startMin, segment.endMin, axisStartMin, axisEndMin)}%`,
                      }}
                      title={segment.label}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
