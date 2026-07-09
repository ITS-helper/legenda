import {
  VOLUME_DYNAMICS_SPARKLINE_DAYS,
  formatFullDate,
  formatShortDate,
  type BrigadeVolumeDynamicsCard,
} from '../lib/reports'
import { formatVolumeDelta, formatVolumeM3 } from '../lib/volumes'

type VolumeDynamicsPanelProps = {
  referenceDate: string
  cards: BrigadeVolumeDynamicsCard[]
}

function deltaClass(delta: number | null) {
  if (delta == null || delta === 0) return 'dynamics-delta-neutral'
  return delta > 0 ? 'dynamics-delta-up' : 'dynamics-delta-down'
}

function Sparkline({
  points,
  referenceDate,
}: {
  points: BrigadeVolumeDynamicsCard['sparkline']
  referenceDate: string
}) {
  const numericValues = points
    .map((point) => point.volume_m3)
    .filter((value): value is number => value != null)

  if (numericValues.length < 2) {
    return (
      <div className="dynamics-sparkline dynamics-sparkline-empty">
        Мало данных за {VOLUME_DYNAMICS_SPARKLINE_DAYS} дней
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
          const hasValue = point.volume_m3 != null
          const heightPct = hasValue ? ((point.volume_m3! - min) / range) * 100 : 0

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

function DynamicsCard({ card, referenceDate }: { card: BrigadeVolumeDynamicsCard; referenceDate: string }) {
  return (
    <article className="dynamics-card">
      <div className="dynamics-card-head">
        <strong>{card.supervisor_name}</strong>
        <span className="dynamics-card-kicker">Выполненный объём</span>
      </div>

      <div className="dynamics-day">
        <div className="dynamics-day-main">
          <span className="dynamics-day-label">За день</span>
          <strong className="dynamics-day-value">
            {card.today_m3 != null ? formatVolumeM3(card.today_m3) : '—'}
          </strong>
        </div>
        <div className={`dynamics-delta ${deltaClass(card.day_delta)}`}>
          <span>{formatVolumeDelta(card.day_delta)}</span>
          <small>
            {card.yesterday_m3 != null
              ? `к вчера (${formatVolumeM3(card.yesterday_m3)})`
              : 'нет данных за вчера'}
          </small>
        </div>
      </div>

      <div className="dynamics-sparkline-wrap">
        <span className="dynamics-sparkline-title">
          {VOLUME_DYNAMICS_SPARKLINE_DAYS} дней до {formatFullDate(referenceDate)}
        </span>
        <Sparkline points={card.sparkline} referenceDate={referenceDate} />
      </div>
    </article>
  )
}

export function VolumeDynamicsPanel({ referenceDate, cards }: VolumeDynamicsPanelProps) {
  return (
    <div className="dynamics-grid">
      {cards.map((card) => (
        <DynamicsCard key={card.supervisor_name} card={card} referenceDate={referenceDate} />
      ))}
    </div>
  )
}
