import { brigadeLayoutClass } from '../lib/brigadeLayout'
import { brigadeNamesMatch, type NoTelemetryEmployee } from '../lib/reports'

type NoTelemetryPanelProps = {
  employees: NoTelemetryEmployee[]
  brigades: string[]
  open: boolean
  onToggle: () => void
  emptyMessage: string
}

export function NoTelemetryPanel({
  employees,
  brigades,
  open,
  onToggle,
  emptyMessage,
}: NoTelemetryPanelProps) {
  return (
    <div className={`kpp-panel no-telemetry-panel${open ? ' kpp-panel-open' : ' kpp-panel-closed'}`}>
      <div className="kpp-panel-head">
        <button type="button" className="kpp-panel-toggle" onClick={onToggle} aria-expanded={open}>
          <span className={`kpp-panel-chevron${open ? ' kpp-panel-chevron-open' : ''}`} aria-hidden="true">
            ▸
          </span>
          <span className="kpp-panel-titles">
            <span className="panel-kicker">Нет телеметрии</span>
            <span className="kpp-panel-title">
              {employees.length > 0 ? 'Не сдали часы' : 'Все сдали часы'}
            </span>
          </span>
        </button>
        {employees.length > 0 ? <span className="kpp-count">{employees.length}</span> : null}
      </div>
      {open ? (
        employees.length > 0 ? (
          <div className={brigadeLayoutClass('zones-brigade-matrix no-telemetry-brigade-matrix', brigades.length)}>
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
                          <div className="kpp-row" key={employee.ww_shift_id}>
                            <div className="kpp-main">
                              <strong>{employee.full_name}</strong>
                              <span>{employee.profession?.trim() || '—'} · #{employee.employee_number}</span>
                            </div>
                            <div className="kpp-time">нет минут</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="kpp-empty">Смен без телеметрии нет.</p>
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
