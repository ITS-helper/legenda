import { formatPercent } from '../lib/reports'
import type { AttentionEmployee } from '../lib/reports'

type TopActivityPanelProps = {
  employees: AttentionEmployee[]
  periodLabel: string
}

export function TopActivityPanel({ employees, periodLabel }: TopActivityPanelProps) {
  if (employees.length === 0) {
    return (
      <div className="top-activity-panel">
        <div className="top-activity-head">
          <span className="panel-kicker">Топ 3 по активности</span>
          <span className="top-activity-title">{periodLabel}</span>
        </div>
        <p className="kpp-empty">Нет данных об активности за выбранный период.</p>
      </div>
    )
  }

  return (
    <div className="top-activity-panel">
      <div className="top-activity-head">
        <span className="panel-kicker">Топ 3 по активности</span>
        <span className="top-activity-title">{periodLabel}</span>
      </div>
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
    </div>
  )
}
