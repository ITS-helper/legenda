import { formatShortDate } from '../lib/reports'

export type DynamicsBarPoint = {
  report_date: string
  value: number | null
}

type DynamicsBarChartProps = {
  points: DynamicsBarPoint[]
  referenceDate: string
  maxValue: number
  minValue?: number
  formatAxisValue?: (value: number) => string
  fewDataLabel: string
}

const MIN_AXIS_SPAN = 10
const AXIS_PADDING_RATIO = 0.15
const AXIS_PADDING_MIN = 3

function computeAxisRange(values: number[], floor: number, ceiling: number) {
  const dataMin = Math.min(...values)
  const dataMax = Math.max(...values)
  const span = dataMax - dataMin
  const padding = Math.max(span * AXIS_PADDING_RATIO, AXIS_PADDING_MIN)

  let min = Math.floor(dataMin - padding)
  let max = Math.ceil(dataMax + padding)

  min = Math.max(floor, min)
  max = Math.min(ceiling, max)

  if (max - min < MIN_AXIS_SPAN) {
    const mid = (dataMin + dataMax) / 2
    min = Math.max(floor, Math.floor(mid - MIN_AXIS_SPAN / 2))
    max = Math.min(ceiling, Math.ceil(mid + MIN_AXIS_SPAN / 2))
  }

  return { min, max }
}

function barHeightPercent(value: number, axisMin: number, axisMax: number) {
  const range = axisMax - axisMin
  if (range <= 0) return 100
  return Math.min(Math.max(((value - axisMin) / range) * 100, 0), 100)
}

export function DynamicsBarChart({
  points,
  referenceDate,
  maxValue,
  minValue = 0,
  formatAxisValue = String,
  fewDataLabel,
}: DynamicsBarChartProps) {
  const values = points.flatMap((point) => (point.value != null ? [point.value] : []))
  const hasAnyValue = values.length > 0

  if (!hasAnyValue) {
    return <div className="dynamics-sparkline dynamics-sparkline-empty">{fewDataLabel}</div>
  }

  const { min: axisMin, max: axisMax } = computeAxisRange(values, minValue, maxValue)

  return (
    <div className="dynamics-sparkline dynamics-sparkline-bars">
      <div className="dynamics-sparkline-layout">
        <div className="dynamics-sparkline-y-axis" aria-hidden="true">
          <span>{formatAxisValue(axisMax)}</span>
          <span>{formatAxisValue(axisMin)}</span>
        </div>
        <div className="dynamics-sparkline-chart-wrap">
          <div
            className="dynamics-sparkline-chart"
            style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
          >
            {points.map((point) => {
              const isReference = point.report_date === referenceDate
              const hasValue = point.value != null
              const heightPct = hasValue ? barHeightPercent(point.value!, axisMin, axisMax) : 0

              return (
                <div
                  className={`dynamics-sparkline-day${isReference ? ' dynamics-sparkline-day-ref' : ''}`}
                  key={point.report_date}
                >
                  <div className="dynamics-sparkline-bar-track">
                    <div
                      className={`dynamics-sparkline-bar${hasValue ? '' : ' dynamics-sparkline-bar-empty'}`}
                      style={{ height: hasValue ? `${heightPct}%` : '0%' }}
                    />
                  </div>
                  <span className={`dynamics-sparkline-date${isReference ? ' dynamics-sparkline-date-ref' : ''}`}>
                    {formatShortDate(point.report_date)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
