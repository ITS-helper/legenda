import { formatSeconds } from '../lib/reports'

export type ShiftDurationRow = {
  supervisor_name: string
  avg_shift_duration_sec: number
}

type ShiftDurationPanelProps = {
  brigades: ShiftDurationRow[]
  open: boolean
  onToggle: () => void
  periodLabel: string
  emptyMessage: string
}

export function ShiftDurationPanel({ brigades, open, onToggle, periodLabel, emptyMessage }: ShiftDurationPanelProps) {
  const withData = brigades.filter((row) => row.avg_shift_duration_sec > 0)

  return (
    <div className={`shift-duration-panel${open ? ' shift-duration-panel-open' : ' shift-duration-panel-closed'}`}>
      <div className="kpp-panel-head">
        <button type="button" className="kpp-panel-toggle" onClick={onToggle} aria-expanded={open}>
          <span className={`kpp-panel-chevron${open ? ' kpp-panel-chevron-open' : ''}`} aria-hidden="true">
            ▸
          </span>
          <span className="kpp-panel-titles">
            <span className="panel-kicker">Длительность смены</span>
            <span className="kpp-panel-title">
              {withData.length > 0 ? `Среднее время смены ${periodLabel}` : `Нет данных о сменах ${periodLabel}`}
            </span>
          </span>
        </button>
        {withData.length > 0 ? <span className="kpp-count">{withData.length}</span> : null}
      </div>
      {open ? (
        withData.length > 0 ? (
          <div className="kpp-list">
            {withData.map((brigade) => (
              <div className="kpp-row" key={brigade.supervisor_name}>
                <div className="kpp-main">
                  <strong>{brigade.supervisor_name}</strong>
                </div>
                <div className="shift-duration-value">{formatSeconds(brigade.avg_shift_duration_sec)}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="kpp-empty">{emptyMessage}</p>
        )
      ) : null}
    </div>
  )
}
