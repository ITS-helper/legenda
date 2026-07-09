import {
  VOLUME_DYNAMICS_CHART_MAX,
  VOLUME_DYNAMICS_SPARKLINE_DAYS,
  formatFullDate,
  type BrigadeVolumeDynamicsCard,
} from '../lib/reports'
import { formatVolumeDelta, formatVolumeM3 } from '../lib/volumes'
import { DynamicsBarChart } from './DynamicsBarChart'

type VolumeDynamicsPanelProps = {
  referenceDate: string
  cards: BrigadeVolumeDynamicsCard[]
}

function deltaClass(delta: number | null) {
  if (delta == null || delta === 0) return 'dynamics-delta-neutral'
  return delta > 0 ? 'dynamics-delta-up' : 'dynamics-delta-down'
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
        <DynamicsBarChart
          points={card.sparkline.map((point) => ({
            report_date: point.report_date,
            value: point.volume_m3,
          }))}
          referenceDate={referenceDate}
          maxValue={VOLUME_DYNAMICS_CHART_MAX}
          fewDataLabel={`Мало данных за ${VOLUME_DYNAMICS_SPARKLINE_DAYS} дней`}
        />
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
