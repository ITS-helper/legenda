import { formatPercent } from '../lib/reports'
import type { AttentionEmployee } from '../lib/reports'

type AttentionPanelProps = {
  employees: AttentionEmployee[]
  open: boolean
  onToggle: () => void
  emptyMessage: string
  periodLabel: string
  lowActivityPct: number
}

export function AttentionPanel({
  employees,
  open,
  onToggle,
  emptyMessage,
  periodLabel,
  lowActivityPct,
}: AttentionPanelProps) {
  return (
    <div className={`kpp-panel${employees.length > 0 ? ' kpp-panel-alert' : ''}${open ? ' kpp-panel-open' : ' kpp-panel-closed'}`}>
      <div className="kpp-panel-head">
        <button type="button" className="kpp-panel-toggle" onClick={onToggle} aria-expanded={open}>
          <span className={`kpp-panel-chevron${open ? ' kpp-panel-chevron-open' : ''}`} aria-hidden="true">
            ▸
          </span>
          <span className="kpp-panel-titles">
            <span className="panel-kicker">Требуют внимания</span>
            <span className="kpp-panel-title">
              {employees.length > 0
                ? `Активность ниже ${lowActivityPct}% ${periodLabel}`
                : `Низкой активности ${periodLabel} нет`}
            </span>
          </span>
        </button>
        {employees.length > 0 ? <span className="kpp-count">{employees.length}</span> : null}
      </div>
      {open ? (
        employees.length > 0 ? (
          <div className="kpp-list">
            {employees.map((employee) => (
              <div className="kpp-row" key={`${employee.employee_number}-${employee.full_name}`}>
                <div className="kpp-main">
                  <strong>{employee.full_name}</strong>
                  <span>
                    #{employee.employee_number} · {employee.supervisor_name}
                  </span>
                </div>
                <div className="kpp-time">{formatPercent(employee.activity_pct)}</div>
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
