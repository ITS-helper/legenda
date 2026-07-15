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
}

export function ShiftActivityTimeline({ rows, axisStartMin, axisEndMin, title }: Props) {
  const ticks = timelineAxisTicks(axisStartMin, axisEndMin, 60)

  return (
    <div className="shift-timeline" aria-label={title ?? 'Анализ активности по часам смены'}>
      {title ? <h4 className="shift-timeline-title">{title}</h4> : null}

      <div className="shift-timeline-chart">
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
  )
}
