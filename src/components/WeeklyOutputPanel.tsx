import { brigadeLayoutClass } from '../lib/brigadeLayout'
import type { BrigadeWeeklyOutputCard, BrigadeWeeklyOutputPoint } from '../lib/reports'

type WeeklyOutputPanelProps = {
  cards: BrigadeWeeklyOutputCard[]
  brigadeLayoutCount?: number
}

const CHART_WIDTH = 320
const CHART_HEIGHT = 132
const PLOT_TOP = 18
// Снизу — две строки подписи периода (начало и конец недели), поэтому запас больше.
const PLOT_BOTTOM = CHART_HEIGHT - 30
const PLOT_LEFT = 8
const PLOT_RIGHT = CHART_WIDTH - 8

function formatPerWorker(value: number | null) {
  if (value == null) return '—'
  const rounded = Math.round(value * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace('.', ',')
  return `${text} м³/чел`
}

function formatWeekLabel(weekStart: string) {
  const [, month, day] = weekStart.split('-')
  return `${day}.${month}`
}

function formatWeekRangeLabel(weekStart: string, weekEnd: string) {
  return `${formatWeekLabel(weekStart)}–${formatWeekLabel(weekEnd)}`
}

function formatTrendBadge(trend: BrigadeWeeklyOutputCard['trend']) {
  if (!trend) return null
  const perWeek = Math.round(trend.slope * 10) / 10
  if (perWeek === 0) return { text: 'тренд: без изменений', className: 'dynamics-delta-neutral' }
  const sign = perWeek > 0 ? '+' : ''
  const text = Number.isInteger(perWeek) ? String(perWeek) : perWeek.toFixed(1).replace('.', ',')
  return {
    text: `тренд: ${sign}${text} м³/чел в неделю`,
    className: perWeek > 0 ? 'dynamics-delta-up' : 'dynamics-delta-down',
  }
}

function pointTitle(point: BrigadeWeeklyOutputPoint) {
  const week = formatWeekRangeLabel(point.week_start, point.week_end)
  if (point.per_worker_m3 == null) {
    if (point.volume_m3 != null) return `Неделя ${week}: объём ${point.volume_m3} м³, нет данных о численности`
    return `Неделя ${week}: нет данных`
  }
  const headcount = point.headcount_fixed
    ? `расчёт на ${point.avg_workers} чел.`
    : `в среднем ${point.avg_workers} чел/день`
  return `Неделя ${week}: ${formatPerWorker(point.per_worker_m3)} (объём ${point.volume_m3} м³, ${headcount})`
}

function OutputChart({ card }: { card: BrigadeWeeklyOutputCard }) {
  const points = card.points
  const count = points.length
  if (count === 0) return null

  const maxValue = Math.max(...points.map((point) => point.per_worker_m3 ?? 0), 1)
  const plotWidth = PLOT_RIGHT - PLOT_LEFT
  const plotHeight = PLOT_BOTTOM - PLOT_TOP
  const step = plotWidth / count
  const barWidth = Math.min(28, step - 6)

  const xCenter = (index: number) => PLOT_LEFT + step * index + step / 2
  const yFor = (value: number) => PLOT_BOTTOM - (Math.max(0, value) / maxValue) * plotHeight

  return (
    <svg
      className="weekly-output-chart"
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      role="img"
      aria-label="Выработка на человека по неделям"
    >
      <line
        x1={PLOT_LEFT}
        y1={PLOT_BOTTOM}
        x2={PLOT_RIGHT}
        y2={PLOT_BOTTOM}
        className="weekly-output-baseline"
      />

      {points.map((point, index) => {
        const value = point.per_worker_m3
        const x = xCenter(index) - barWidth / 2
        return (
          <g key={point.week_start}>
            {value != null ? (
              <rect
                x={x}
                y={yFor(value)}
                width={barWidth}
                height={Math.max(2, PLOT_BOTTOM - yFor(value))}
                rx={3}
                className="weekly-output-bar"
              >
                <title>{pointTitle(point)}</title>
              </rect>
            ) : (
              <rect
                x={x}
                y={PLOT_BOTTOM - 2}
                width={barWidth}
                height={2}
                className="weekly-output-bar-empty"
              >
                <title>{pointTitle(point)}</title>
              </rect>
            )}
            {value != null ? (
              <text x={xCenter(index)} y={yFor(value) - 5} className="weekly-output-value" textAnchor="middle">
                {String(value).replace('.', ',')}
              </text>
            ) : null}
            <text x={xCenter(index)} y={CHART_HEIGHT - 20} className="weekly-output-week" textAnchor="middle">
              {formatWeekLabel(point.week_start)}
            </text>
            <text x={xCenter(index)} y={CHART_HEIGHT - 9} className="weekly-output-week" textAnchor="middle">
              {formatWeekLabel(point.week_end)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function OutputCard({ card }: { card: BrigadeWeeklyOutputCard }) {
  const trendBadge = formatTrendBadge(card.trend)
  const hasData = card.points.some((point) => point.per_worker_m3 != null)

  return (
    <article className="dynamics-card">
      <div className="dynamics-card-head">
        <strong>{card.supervisor_name}</strong>
        <span className="dynamics-card-kicker">Выработка на человека</span>
      </div>

      <div className="dynamics-day">
        <div className="dynamics-day-main">
          <span className="dynamics-day-label">Последняя неделя</span>
          <strong className="dynamics-day-value">{formatPerWorker(card.last_per_worker_m3)}</strong>
        </div>
        {trendBadge ? (
          <div className={`dynamics-delta ${trendBadge.className}`}>
            <span>{trendBadge.text}</span>
          </div>
        ) : null}
      </div>

      {hasData ? (
        <OutputChart card={card} />
      ) : (
        <div className="empty-state">Нет данных об объёмах за эти недели</div>
      )}
    </article>
  )
}

export function WeeklyOutputPanel({ cards, brigadeLayoutCount }: WeeklyOutputPanelProps) {
  return (
    <div className={brigadeLayoutClass('dynamics-grid', brigadeLayoutCount ?? cards.length)}>
      {cards.map((card) => (
        <OutputCard key={card.supervisor_name} card={card} />
      ))}
    </div>
  )
}
