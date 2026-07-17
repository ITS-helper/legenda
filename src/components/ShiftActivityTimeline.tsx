import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
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
  { label: 'Длительный простой', colorClass: 'shift-timeline-long-idle' },
  { label: 'Нет телеметрии', colorClass: 'shift-timeline-none' },
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

const ZOOM_LEVELS = [1, 2, 4, 8]

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

  const [zoom, setZoom] = useState(1)
  const chartRef = useRef<HTMLDivElement>(null)
  const pendingCenterRatio = useRef<number | null>(null)

  const changeZoom = (next: number) => {
    const el = chartRef.current
    if (el && el.scrollWidth > 0) {
      pendingCenterRatio.current = (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth
    }
    setZoom(next)
  }

  useLayoutEffect(() => {
    const el = chartRef.current
    const ratio = pendingCenterRatio.current
    if (el && ratio != null) {
      el.scrollLeft = ratio * el.scrollWidth - el.clientWidth / 2
      pendingCenterRatio.current = null
    }
  }, [zoom])

  const zoomIndex = ZOOM_LEVELS.indexOf(zoom)

  return (
    <div className="shift-timeline" aria-label={title ?? 'Анализ активности по часам смены'}>
      <div className="shift-timeline-head">
        {title ? <h4 className="shift-timeline-title">{title}</h4> : <span />}
        <div className="shift-timeline-zoom">
          <button
            type="button"
            onClick={() => changeZoom(ZOOM_LEVELS[zoomIndex - 1])}
            disabled={zoomIndex <= 0}
            aria-label="Отдалить"
          >
            −
          </button>
          <span className="shift-timeline-zoom-value">{zoom}×</span>
          <button
            type="button"
            onClick={() => changeZoom(ZOOM_LEVELS[zoomIndex + 1])}
            disabled={zoomIndex >= ZOOM_LEVELS.length - 1}
            aria-label="Приблизить"
          >
            +
          </button>
        </div>
      </div>

      <div className="shift-timeline-chart" ref={chartRef}>
        <div className="shift-timeline-inner" style={{ width: `${zoom * 100}%` }}>
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
