import { brigadeLayoutClass } from '../lib/brigadeLayout'
import { brigadeNamesMatch, formatPercent, type AttentionEmployee } from '../lib/reports'

type AttentionPanelProps = {
  employees: AttentionEmployee[]
  brigades: string[]
  open: boolean
  onToggle: () => void
  emptyMessage: string
  periodLabel: string
  lowActivityPct: number
}

export function AttentionPanel({
  employees,
  brigades,
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
          <div className={brigadeLayoutClass('zones-brigade-matrix attention-brigade-matrix', brigades.length)}>
            {brigades.map((brigadeName) => {
              const brigadeEmployees = employees.filter((employee) =>
                brigadeNamesMatch(employee.supervisor_name, brigadeName),
              )

              return (
                <div className="zones-brigade-column" key={brigadeName}>
                  <div className="zones-brigade-matrix-head">
                    <strong>{brigadeName}</strong>
                  </div>

                  <div className="zone-panel zone-panel--idle">
                    {brigadeEmployees.length > 0 ? (
                      <div className="kpp-list">
                        {brigadeEmployees.map((employee) => (
                          <div className="kpp-row" key={`${employee.employee_number}-${employee.full_name}`}>
                            <div className="kpp-main">
                              <strong>{employee.full_name}</strong>
                              <span>{employee.profession?.trim() || '—'} · #{employee.employee_number}</span>
                            </div>
                            <div className="kpp-time">{formatPercent(employee.activity_pct)}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="kpp-empty">Низкой активности нет.</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="kpp-empty">{emptyMessage}</p>
        )
      ) : null}
    </div>
  )
}
