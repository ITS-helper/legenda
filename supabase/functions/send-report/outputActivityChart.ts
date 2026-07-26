// Две кривые «активность и выработка» по неделям с начала проекта — только для PDF-версии
// отчёта (в теле письма блок не показываем: почтовые клиенты вырезают SVG).
// Здесь считается геометрия линий, рисует её pdf.ts. Модуль без Deno-зависимостей.
export type OutputActivityPoint = {
  week_start: string
  week_end: string
  /** Активность бригады за неделю, %. */
  activity_pct: number | null
  /** Выработка на человека за неделю, м³/чел. */
  per_worker_m3: number | null
}

export type OutputActivityCard = {
  supervisor_name: string
  points: OutputActivityPoint[]
}

const LINE_CHART_WIDTH = 660
const LINE_CHART_HEIGHT = 260
const GRID_LINES = 5
const MAX_X_LABELS = 10
const AXIS_PADDING_RATIO = 0.15
const ACTIVITY_AXIS_MIN_SPAN = 10
const ACTIVITY_AXIS_PADDING_MIN = 3

function ruShort(dateIso: string) {
  const [, month, day] = dateIso.split('-')
  return `${day}.${month}`
}

function formatNumber(value: number, digits = 1) {
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(digits).replace('.', ',')
}

function formatActivity(value: number) {
  return `${formatNumber(value, 0)}%`
}

function formatOutput(value: number) {
  return `${formatNumber(value, 1)} м³/чел`
}

/** Диапазон оси с отступом сверху/снизу, чтобы линии не упирались в края. */
function axisRange(values: number[], options: { floor: number; minSpan: number; minPadding: number }) {
  const dataMin = Math.min(...values)
  const dataMax = Math.max(...values)
  const padding = Math.max((dataMax - dataMin) * AXIS_PADDING_RATIO, options.minPadding)

  let min = Math.max(options.floor, Math.floor(dataMin - padding))
  let max = Math.ceil(dataMax + padding)

  if (max - min < options.minSpan) {
    const mid = (dataMin + dataMax) / 2
    min = Math.max(options.floor, Math.floor(mid - options.minSpan / 2))
    max = Math.ceil(min + options.minSpan)
  }

  return { min, max }
}

function chartAxes(points: OutputActivityPoint[]) {
  const activityValues = points.flatMap((point) => (point.activity_pct != null ? [point.activity_pct] : []))
  const outputValues = points.flatMap((point) => (point.per_worker_m3 != null ? [point.per_worker_m3] : []))
  if (activityValues.length < 2 && outputValues.length < 2) return null

  return {
    activity: activityValues.length
      ? axisRange(activityValues, {
          floor: 0,
          minSpan: ACTIVITY_AXIS_MIN_SPAN,
          minPadding: ACTIVITY_AXIS_PADDING_MIN,
        })
      : { min: 0, max: 100 },
    output: outputValues.length
      ? axisRange(outputValues, { floor: 0, minSpan: 1, minPadding: 0.5 })
      : { min: 0, max: 1 },
  }
}

export type OutputActivityGeometry = {
  width: number
  height: number
  plot: { left: number; top: number; width: number; height: number }
  gridLines: Array<{ y: number; activityLabel: string; outputLabel: string; solid: boolean }>
  /** Подпись недели в две строки: начало и конец периода. */
  xLabels: Array<{ x: number; lines: [string, string] }>
  series: Array<{
    key: 'activity' | 'output'
    label: string
    /** SVG path с началом координат в левом верхнем углу графика. */
    path: string
    dots: Array<{ x: number; y: number }>
    end: { x: number; y: number; valueText: string } | null
  }>
}

/** Плавная линия по точкам (Catmull-Rom → кубические Безье), с разрывами на пропусках. */
function smoothPath(points: Array<{ x: number; y: number } | null>) {
  const segments: Array<Array<{ x: number; y: number }>> = []
  let current: Array<{ x: number; y: number }> = []
  for (const point of points) {
    if (point) {
      current.push(point)
    } else if (current.length) {
      segments.push(current)
      current = []
    }
  }
  if (current.length) segments.push(current)

  return segments
    .map((segment) => {
      if (segment.length === 1) {
        return `M ${segment[0].x.toFixed(1)} ${segment[0].y.toFixed(1)} l 0.01 0`
      }
      let path = `M ${segment[0].x.toFixed(1)} ${segment[0].y.toFixed(1)}`
      for (let i = 0; i < segment.length - 1; i += 1) {
        const p0 = segment[i - 1] ?? segment[i]
        const p1 = segment[i]
        const p2 = segment[i + 1]
        const p3 = segment[i + 2] ?? p2
        const c1x = p1.x + (p2.x - p0.x) / 6
        const c1y = p1.y + (p2.y - p0.y) / 6
        const c2x = p2.x - (p3.x - p1.x) / 6
        const c2y = p2.y - (p3.y - p1.y) / 6
        path += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
      }
      return path
    })
    .join(' ')
}

/** Есть ли что рисовать: нужны минимум две точки хотя бы по одному ряду. */
export function hasOutputActivityChart(points: OutputActivityPoint[]) {
  return chartAxes(points) != null
}

export function buildOutputActivityGeometry(
  points: OutputActivityPoint[],
  options?: { width?: number; height?: number },
): OutputActivityGeometry | null {
  const axes = chartAxes(points)
  if (!axes) return null

  const width = options?.width ?? LINE_CHART_WIDTH
  const height = options?.height ?? LINE_CHART_HEIGHT
  // Справа два слоя подписей: шкала выработки и названия линий на их концах.
  const padding = { top: 18, right: Math.round(width * 0.23), bottom: 34, left: 48 }
  const endLabelOffset = Math.round(padding.right * 0.32)
  const plot = {
    left: padding.left,
    top: padding.top,
    width: width - padding.left - padding.right,
    height: height - padding.top - padding.bottom,
  }

  const xAt = (index: number) =>
    points.length > 1
      ? plot.left + (index * plot.width) / (points.length - 1)
      : plot.left + plot.width / 2
  const yAt = (value: number, axis: { min: number; max: number }) => {
    const range = axis.max - axis.min || 1
    const share = Math.min(Math.max((value - axis.min) / range, 0), 1)
    return plot.top + plot.height - share * plot.height
  }

  const gridLines = Array.from({ length: GRID_LINES }, (_, index) => {
    const share = index / (GRID_LINES - 1)
    return {
      y: plot.top + plot.height - share * plot.height,
      activityLabel: formatActivity(axes.activity.min + (axes.activity.max - axes.activity.min) * share),
      outputLabel: formatNumber(axes.output.min + (axes.output.max - axes.output.min) * share, 1),
      solid: index === 0,
    }
  })

  // Подписи недель: при длинной истории показываем каждую вторую/третью, но всегда последнюю.
  const labelStep = Math.ceil(points.length / MAX_X_LABELS)
  const xLabels = points.flatMap((point, index) =>
    index % labelStep === 0 || index === points.length - 1
      ? [{ x: xAt(index), lines: [ruShort(point.week_start), ruShort(point.week_end)] as [string, string] }]
      : [],
  )

  const series = (
    [
      {
        key: 'activity' as const,
        label: 'Активность',
        axis: axes.activity,
        values: points.map((point) => point.activity_pct),
        format: formatActivity,
      },
      {
        key: 'output' as const,
        label: 'Выработка',
        axis: axes.output,
        values: points.map((point) => point.per_worker_m3),
        format: formatOutput,
      },
    ]
  ).map((line) => {
    const coords = line.values.map((value, index) =>
      value != null ? { x: xAt(index), y: yAt(value, line.axis) } : null,
    )
    const lastIndex = line.values.reduce((last, value, index) => (value != null ? index : last), -1)

    return {
      key: line.key,
      label: line.label,
      path: smoothPath(coords),
      dots: coords.flatMap((coord) => (coord ? [coord] : [])),
      end:
        lastIndex >= 0
          ? {
              x: plot.left + plot.width + endLabelOffset,
              y: yAt(line.values[lastIndex]!, line.axis),
              valueText: line.format(line.values[lastIndex]!),
            }
          : null,
    }
  })

  return { width, height, plot, gridLines, xLabels, series }
}

/**
 * Убирает крайние недели, где ни у одного прораба нет ни активности, ни выработки
 * (телеметрия и объёмы стартовали в разные дни). Ось X у всех карточек остаётся общей.
 */
export function trimEmptyOutputActivityWeeks(cards: OutputActivityCard[]): OutputActivityCard[] {
  const weekCount = cards[0]?.points.length ?? 0
  if (weekCount === 0) return cards

  const hasData = (index: number) =>
    cards.some(
      (card) => card.points[index]?.activity_pct != null || card.points[index]?.per_worker_m3 != null,
    )

  let first = 0
  while (first < weekCount && !hasData(first)) first += 1
  let last = weekCount - 1
  while (last >= first && !hasData(last)) last -= 1
  if (first > last) return cards.map((card) => ({ ...card, points: [] }))

  return cards.map((card) => ({ ...card, points: card.points.slice(first, last + 1) }))
}
