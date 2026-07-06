import {
  ACTIVITY_DYNAMICS_SPARKLINE_DAYS,
  formatDeltaPercent,
  formatFullDate,
  formatPercent,
  formatShortDate,
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

function Sparkline({
  points,
  referenceDate,
}: {
  points: BrigadeDynamicsCard['sparkline']
  referenceDate: string
}) {
  const numericValues = points
    .map((point) => point.activity_pct)
    .filter((value): value is number => value != null)

  if (numericValues.length < 2) {
    return (
      <div className="dynamics-sparkline dynamics-sparkline-empty">
        Мало данных за {ACTIVITY_DYNAMICS_SPARKLINE_DAYS} дней
      </div>
    )
  }

  const min = Math.min(...numericValues)
  const max = Math.max(...numericValues)
  const range = max - min || 1

  return (
    <div className="dynamics-sparkline dynamics-sparkline-bars">
      <div
        className="dynamics-sparkline-chart"
        style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
      >
        {points.map((point) => {
          const isReference = point.report_date === referenceDate
          const hasValue = point.activity_pct != null
          const heightPct = hasValue ? ((point.activity_pct! - min) / range) * 100 : 0

          return (
            <div
              className={`dynamics-sparkline-day${isReference ? ' dynamics-sparkline-day-ref' : ''}`}
              key={point.report_date}
            >
              <div className="dynamics-sparkline-bar-track">
                <div
                  className={`dynamics-sparkline-bar${hasValue ? '' : ' dynamics-sparkline-bar-empty'}`}
                  style={{ height: hasValue ? `${Math.max(heightPct, 10)}%` : '0%' }}
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
  )
}

function DynamicsCard({ card, referenceDate }: { card: BrigadeDynamicsCard; referenceDate: string }) {
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
          <span>{formatDeltaPercent(card.day_delta)}</span>
          <small>
            {card.yesterday_pct != null
              ? `к вчера (${formatPercent(card.yesterday_pct)})`
              : 'нет данных за вчера'}
          </small>
        </div>
      </div>

      <div className="dynamics-sparkline-wrap">
        <span className="dynamics-sparkline-title">
          {ACTIVITY_DYNAMICS_SPARKLINE_DAYS} дней до {formatFullDate(referenceDate)}
        </span>
        <Sparkline points={card.sparkline} referenceDate={referenceDate} />
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
