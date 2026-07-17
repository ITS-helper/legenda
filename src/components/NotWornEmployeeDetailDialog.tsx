import { useEffect, useState } from 'react'
import {
  buildNotWornEpisodeTimeLabel,
  formatPercent,
  formatSeconds,
  type ShiftDetailEmployee,
} from '../lib/reports'
import {
  loadShiftInactivityDetail,
  type ShiftInactivityDetail,
} from '../lib/shiftActivityTimeline'
import { ShiftActivityTimeline } from './ShiftActivityTimeline'

type Props = {
  employee: ShiftDetailEmployee | null
  reportDate: string
  open: boolean
  onClose: () => void
}

function formatReportDateLabel(reportDate: string) {
  const [year, month, day] = reportDate.split('-')
  if (!year || !month || !day) return reportDate
  return `${day}.${month}.${year}`
}

export function NotWornEmployeeDetailDialog({ employee, reportDate, open, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<ShiftInactivityDetail | null>(null)

  useEffect(() => {
    if (!open || !employee) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, employee, onClose])

  useEffect(() => {
    if (!open || !employee) {
      setDetail(null)
      setError(null)
      setLoading(false)
      return
    }

    let cancelled = false
    const shiftId = employee.ww_shift_id

    async function loadDetail() {
      setLoading(true)
      setError(null)
      try {
        const payload = await loadShiftInactivityDetail(reportDate, shiftId)
        if (!cancelled) setDetail(payload)
      } catch (loadError) {
        if (!cancelled) {
          setDetail(null)
          setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить детализацию')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadDetail()
    return () => {
      cancelled = true
    }
  }, [open, employee, reportDate])

  if (!open || !employee) return null

  return (
    <div className="detail-dialog-overlay" onClick={onClose}>
      <div
        className="detail-dialog detail-dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="not-worn-detail-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="detail-dialog-head">
          <div>
            <p className="detail-dialog-kicker">Детализация смены</p>
            <h2 id="not-worn-detail-title">{employee.full_name}</h2>
            <p className="detail-dialog-subtitle">
              {employee.profession?.trim() || '—'} · #{employee.employee_number} · {employee.supervisor_name}
            </p>
            <div className="detail-dialog-metrics">
              <div className="detail-dialog-metric">
                <span className="detail-dialog-metric-label">Активность</span>
                <span className="detail-dialog-metric-value">{formatPercent(employee.activity_pct)}</span>
              </div>
              <div className="detail-dialog-metric">
                <span className="detail-dialog-metric-label">Слабая активность</span>
                <span className="detail-dialog-metric-value">{formatPercent(employee.weak_activity_pct)}</span>
              </div>
              <div className="detail-dialog-metric">
                <span className="detail-dialog-metric-label">Длительный простой</span>
                <span className="detail-dialog-metric-value">{formatPercent(employee.long_idle_pct)}</span>
              </div>
              <div className="detail-dialog-metric">
                <span className="detail-dialog-metric-label">Ходьба между зонами</span>
                <span className="detail-dialog-metric-value">{formatPercent(employee.go_pct)}</span>
              </div>
              <div className="detail-dialog-metric">
                <span className="detail-dialog-metric-label">Длительность смены</span>
                <span className="detail-dialog-metric-value">
                  {employee.on_watch_duration_seconds && employee.on_watch_duration_seconds > 0
                    ? formatSeconds(employee.on_watch_duration_seconds)
                    : '—'}
                </span>
              </div>
            </div>
          </div>
          <button type="button" className="detail-dialog-close" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </header>

        {loading ? (
          <p className="detail-dialog-empty">Загружаем детализацию...</p>
        ) : error ? (
          <p className="detail-dialog-empty error-state">Ошибка: {error}</p>
        ) : detail ? (
          <>
            <section className="detail-dialog-section">
              <ShiftActivityTimeline
                stripSegments={detail.stripSegments}
                rows={detail.timelineRows}
                axisStartMin={detail.axisStartMin}
                axisEndMin={detail.axisEndMin}
                shiftStartMin={detail.shiftStartMin}
                shiftEndMin={detail.shiftEndMin}
                title={`Анализ активности по часам смены ${formatReportDateLabel(reportDate)}`}
              />
              <p className="detail-dialog-note">
                Лента хронологии закрашивает каждую минуту смены: активность, ходьба, слабая
                активность или «нет телеметрии» (серый — часы не передавали данные).
                «Длительный простой» — эпизоды отчёта 10 целиком (неподвижность более 90%
                эпизода), поэтому внутри полосы возможны рабочие минуты — микродвижения.
                Проценты в карточках считаются в окне 07:00–23:00 МСК.
              </p>
            </section>

            {detail.notWornEpisodes.length > 0 ? (
              <section className="detail-dialog-section">
                <h3>Бездействие в зоне</h3>
                <p className="detail-dialog-note">
                  Поминутный отбор: почти нулевая активность в учитываемых зонах, эпизоды от 30 мин.
                </p>
                <div className="detail-dialog-highlight">
                  <strong>{buildNotWornEpisodeTimeLabel(detail.notWornEpisodes)}</strong>
                  <span>
                    {formatSeconds(
                      detail.notWornEpisodes.reduce(
                        (sum, episode) => sum + Number(episode.episode_sec ?? 0),
                        0,
                      ),
                    )}
                  </span>
                </div>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}
