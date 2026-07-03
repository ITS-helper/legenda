import {
  addDaysIso,
  formatDeltaPp,
  formatFullDate,
  formatPercent,
  formatShortDate,
  formatWeekRange,
  getWeekStart,
  type BrigadeDynamicsCard,
} from '../lib/reports'

type ActivityDynamicsPanelProps = {
  referenceDate: string
  cards: BrigadeDynamicsCard[]
}

function deltaClass(delta: number | null) {
  if (delta == null || delta === 0) return 'dynamics-delta-neutral'
  return delta > 0 ? 'dynamics-delta-up' : 'dynamics-delta-down'
}

function Sparkline({ points }: { points: BrigadeDynamicsCard['sparkline'] }) {
  if (points.length < 2) {
    return <div className="dynamics-sparkline dynamics-sparkline-empty">Мало данных за 7 дней</div>
  }

  const width = 168
  const height = 44
  const padding = 4
  const values = points.map((point) => point.activity_pct)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const coords = values.map((value, index) => {
    const x = padding + (index / (values.length - 1)) * (width - padding * 2)
    const y = height - padding - ((value - min) / range) * (height - padding * 2)
    return { x, y, value, date: points[index].report_date }
  })

  const polyline = coords.map((point) => `${point.x},${point.y}`).join(' ')
  const last = coords[coords.length - 1]

  return (
    <div className="dynamics-sparkline">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
        <polyline className="dynamics-sparkline-line" points={polyline} />
        <circle className="dynamics-sparkline-dot" cx={last.x} cy={last.y} r="3.5" />
      </svg>
      <div className="dynamics-sparkline-labels">
        <span>{formatShortDate(points[0].report_date)}</span>
        <span>{formatShortDate(points[points.length - 1].report_date)}</span>
      </div>
    </div>
  )
}

function DynamicsCard({ card, referenceDate }: { card: BrigadeDynamicsCard; referenceDate: string }) {
  const weekStart = getWeekStart(referenceDate)
  const weekEnd = addDaysIso(weekStart, 6)
  const prevWeekStart = addDaysIso(weekStart, -7)
  const prevWeekEnd = addDaysIso(weekStart, -1)

  return (
    <article className="dynamics-card">
      <div className="dynamics-card-head">
        <strong>{card.supervisor_name}</strong>
        <span className="dynamics-card-kicker">Активность</span>
      </div>

      <div className="dynamics-day">
        <div className="dynamics-day-main">
          <span className="dynamics-day-label">За день</span>
          <strong className="dynamics-day-value">
            {card.today_pct != null ? formatPercent(card.today_pct) : '—'}
          </strong>
        </div>
        <div className={`dynamics-delta ${deltaClass(card.day_delta)}`}>
          <span>{formatDeltaPp(card.day_delta)}</span>
          <small>
            {card.yesterday_pct != null
              ? `к вчера (${formatPercent(card.yesterday_pct)})`
              : 'нет данных за вчера'}
          </small>
        </div>
      </div>

      <div className="dynamics-week">
        <span>Неделя {formatWeekRange(weekStart, weekEnd)}</span>
        <strong>{card.week_pct != null ? formatPercent(card.week_pct) : '—'}</strong>
        <span className={`dynamics-week-delta ${deltaClass(card.week_delta)}`}>
          {card.week_delta != null
            ? `${formatDeltaPp(card.week_delta)} к ${formatWeekRange(prevWeekStart, prevWeekEnd)}`
            : `нет сравнения с ${formatWeekRange(prevWeekStart, prevWeekEnd)}`}
        </span>
      </div>

      <div className="dynamics-sparkline-wrap">
        <span className="dynamics-sparkline-title">7 дней до {formatFullDate(referenceDate)}</span>
        <Sparkline points={card.sparkline} />
      </div>
    </article>
  )
}

export function ActivityDynamicsPanel({ referenceDate, cards }: ActivityDynamicsPanelProps) {
  return (
    <div className="dynamics-grid">
      {cards.map((card) => (
        <DynamicsCard key={card.supervisor_name} card={card} referenceDate={referenceDate} />
      ))}
    </div>
  )
}
