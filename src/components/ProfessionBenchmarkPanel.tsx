import { useState } from 'react'
import { formatPercent, ratio, type ProfessionBenchmarkRow } from '../lib/reports'
import { brigadeLayoutClass } from '../lib/brigadeLayout'

type ProfessionBenchmarkPanelProps = {
  rows: ProfessionBenchmarkRow[]
}

function formatEmployeesUsed(count: number) {
  if (count === 1) return '1 сотрудник'
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod100 >= 11 && mod100 <= 19) return `${count} сотрудников`
  if (mod10 >= 2 && mod10 <= 4) return `${count} сотрудника`
  return `${count} сотрудников`
}

function BenchmarkBar({ row }: { row: ProfessionBenchmarkRow }) {
  const workWidth = `${ratio(row.activityPct, 100)}%`
  const weakWidth = `${ratio(row.weakActivityPct, 100)}%`
  const longIdleWidth = `${ratio(row.longIdlePct, 100)}%`
  const goWidth = `${ratio(row.goPct, 100)}%`
  return (
    <div className="structure-bar">
      <div className="structure-segment structure-work" style={{ width: workWidth }} title="Активность" />
      <div className="structure-segment structure-weak" style={{ width: weakWidth }} title="Слабая активность" />
      <div className="structure-segment structure-long-idle" style={{ width: longIdleWidth }} title="Длительный простой" />
      <div className="structure-segment structure-go" style={{ width: goWidth }} title="Ходьба между зонами" />
    </div>
  )
}

function BenchmarkCard({ row }: { row: ProfessionBenchmarkRow }) {
  return (
    <article className="brigade-card">
      <div className="brigade-card-head">
        <div>
          <strong>{row.profession}</strong>
          <p>Топ по активности · {formatEmployeesUsed(row.employeesUsed)}</p>
        </div>
        <div className="brigade-badge">{formatPercent(row.activityPct)}</div>
      </div>
      <BenchmarkBar row={row} />
      <div className="detail-dialog-metrics">
        <div className="detail-dialog-metric">
          <span className="detail-dialog-metric-label">Активность</span>
          <span className="detail-dialog-metric-value">{formatPercent(row.activityPct)}</span>
        </div>
        <div className="detail-dialog-metric">
          <span className="detail-dialog-metric-label">Слабая активность</span>
          <span className="detail-dialog-metric-value">{formatPercent(row.weakActivityPct)}</span>
        </div>
        <div className="detail-dialog-metric">
          <span className="detail-dialog-metric-label">Длительный простой</span>
          <span className="detail-dialog-metric-value">{formatPercent(row.longIdlePct)}</span>
        </div>
        <div className="detail-dialog-metric">
          <span className="detail-dialog-metric-label">Ходьба между зонами</span>
          <span className="detail-dialog-metric-value">{formatPercent(row.goPct)}</span>
        </div>
      </div>
    </article>
  )
}

export function ProfessionBenchmarkPanel({ rows }: ProfessionBenchmarkPanelProps) {
  const [selectedProfession, setSelectedProfession] = useState('')

  if (rows.length === 0) {
    return <div className="empty-state">Нет данных по профессиям за этот период.</div>
  }

  const found = selectedProfession ? rows.find((row) => row.profession === selectedProfession) ?? null : null

  return (
    <div className="profession-benchmark">
      <label className="profession-benchmark-select">
        <span>Профессия</span>
        <select value={selectedProfession} onChange={(event) => setSelectedProfession(event.target.value)}>
          <option value="">Выберите профессию</option>
          {rows.map((row) => (
            <option key={row.profession} value={row.profession}>
              {row.profession}
            </option>
          ))}
        </select>
      </label>

      {selectedProfession && !found ? (
        <div className="empty-state profession-benchmark-result">Нет данных по профессии «{selectedProfession}».</div>
      ) : null}

      {found ? (
        <div className={`profession-benchmark-result ${brigadeLayoutClass('brigade-grid', 1)}`}>
          <BenchmarkCard row={found} />
        </div>
      ) : null}
    </div>
  )
}
