import {
  ACTIVITY_DYNAMICS_CHART_MAX,
  ACTIVITY_DYNAMICS_SPARKLINE_DAYS,
  formatDeltaPercent,
  formatFullDate,
  formatPercent,
  type BrigadeDynamicsCard,
} from '../lib/reports'
import { brigadeLayoutClass } from '../lib/brigadeLayout'
import { DynamicsBarChart } from './DynamicsBarChart'

type ActivityDynamicsPanelProps = {
  referenceDate: string
  cards: BrigadeDynamicsCard[]
  brigadeLayoutCount?: number
}

function deltaClass(delta: number | null) {
  if (delta == null || delta === 0) return 'dynamics-delta-neutral'
  return delta > 0 ? 'dynamics-delta-up' : 'dynamics-delta-down'
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
        <DynamicsBarChart
          points={card.sparkline.map((point) => ({
            report_date: point.report_date,
            value: point.activity_pct,
          }))}
          referenceDate={referenceDate}
          maxValue={ACTIVITY_DYNAMICS_CHART_MAX}
          formatAxisValue={(value) => `${value}%`}
          fewDataLabel={`Мало данных за ${ACTIVITY_DYNAMICS_SPARKLINE_DAYS} дней`}
        />
      </div>
    </article>
  )
}

export function ActivityDynamicsPanel({ referenceDate, cards, brigadeLayoutCount }: ActivityDynamicsPanelProps) {
  return (
    <div className={brigadeLayoutClass('dynamics-grid', brigadeLayoutCount ?? cards.length)}>
      {cards.map((card) => (
        <DynamicsCard key={card.supervisor_name} card={card} referenceDate={referenceDate} />
      ))}
    </div>
  )
}
