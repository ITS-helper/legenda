import { formatPercent } from '../lib/reports'
import type { AttentionEmployee } from '../lib/reports'

type TopActivityPanelProps = {
  employees: AttentionEmployee[]
  periodLabel: string
  open: boolean
  onToggle: () => void
}

export function TopActivityPanel({ employees, periodLabel, open, onToggle }: TopActivityPanelProps) {
  return (
    <div className={`top-activity-panel${open ? ' top-activity-panel-open' : ' top-activity-panel-closed'}`}>
      <div className="kpp-panel-head">
        <button type="button" className="kpp-panel-toggle" onClick={onToggle} aria-expanded={open}>
          <span className={`kpp-panel-chevron${open ? ' kpp-panel-chevron-open' : ''}`} aria-hidden="true">
            ▸
          </span>
          <span className="kpp-panel-titles">
            <span className="panel-kicker">Топ 3 по активности</span>
            <span className="top-activity-title">
              {employees.length > 0 ? periodLabel : `Нет данных об активности ${periodLabel}`}
            </span>
          </span>
        </button>
        {employees.length > 0 ? <span className="top-activity-count">{employees.length}</span> : null}
      </div>
      {open ? (
        employees.length > 0 ? (
          <div className="top-activity-list">
            {employees.map((employee, index) => (
              <div className="top-activity-row" key={`${employee.employee_number}-${employee.full_name}`}>
                <span className="top-activity-rank">{index + 1}</span>
                <div className="top-activity-main">
                  <strong>{employee.full_name}</strong>
                  <span>
                    #{employee.employee_number} · {employee.supervisor_name}
                  </span>
                </div>
                <div className="top-activity-value">{formatPercent(employee.activity_pct)}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="kpp-empty">Нет данных об активности за выбранный период.</p>
        )
      ) : null}
    </div>
  )
}
