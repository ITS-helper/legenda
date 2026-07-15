import { useEffect, useState } from 'react'
import {
  formatIdleEpisodeTimeLabel,
  formatMinutes,
  formatSeconds,
  PV_ZONE,
  type NotWornEmployee,
} from '../lib/reports'
import {
  loadShiftInactivityDetail,
  type ShiftInactivityDetail,
} from '../lib/shiftActivityTimeline'
import { ShiftActivityTimeline } from './ShiftActivityTimeline'

type Props = {
  employee: NotWornEmployee | null
  reportDate: string
  longIdleMin: number
  open: boolean
  onClose: () => void
}

function formatReportDateLabel(reportDate: string) {
  const [year, month, day] = reportDate.split('-')
  if (!year || !month || !day) return reportDate
  return `${day}.${month}.${year}`
}

export function NotWornEmployeeDetailDialog({ employee, reportDate, longIdleMin, open, onClose }: Props) {
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

  const pvIdleEpisodes = detail?.idleEpisodes.filter((episode) => episode.ble_tag_zone === PV_ZONE) ?? []
  const pvTotalMin = pvIdleEpisodes.reduce((sum, episode) => sum + episode.duration_min, 0)

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
            <p className="detail-dialog-kicker">Детализация бездействия</p>
            <h2 id="not-worn-detail-title">{employee.full_name}</h2>
            <p className="detail-dialog-subtitle">
              {employee.profession?.trim() || '—'} · #{employee.employee_number} · {employee.supervisor_name}
            </p>
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
                rows={detail.timelineRows}
                axisStartMin={detail.axisStartMin}
                axisEndMin={detail.axisEndMin}
                title={`Анализ активности по часам смены ${formatReportDateLabel(reportDate)}`}
              />
            </section>

            <section className="detail-dialog-section">
              <h3>Бездействие в зоне (наша модель)</h3>
              <p className="detail-dialog-note">
                Поминутный отбор: почти нулевая активность в учитываемых зонах, эпизоды от 30 мин.
              </p>
              <div className="detail-dialog-highlight">
                <strong>{employee.not_worn_time}</strong>
                <span>{formatSeconds(employee.not_worn_sec)}</span>
              </div>
            </section>

            <section className="detail-dialog-section">
              <h3>Длительные простои в ПВ (отчёт 10)</h3>
              <p className="detail-dialog-note">
                Эпизоды ≥ {longIdleMin} мин в зоне проведения работ — как «простои» на основном фронте.
                {pvTotalMin > 0 ? ` Всего: ${formatMinutes(pvTotalMin * 60)}.` : ''}
              </p>
              {pvIdleEpisodes.length > 0 ? (
                <div className="detail-dialog-episodes">
                  {pvIdleEpisodes.map((episode) => (
                    <div className="detail-dialog-episode" key={`${episode.session_id}-${episode.dt_start}`}>
                      <div className="detail-dialog-episode-main">
                        <strong>{formatIdleEpisodeTimeLabel(episode.dt_start, episode.dt_end)}</strong>
                        <span>{episode.zonaName}</span>
                      </div>
                      <div className="detail-dialog-episode-duration">{formatMinutes(episode.duration_min * 60)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="detail-dialog-empty">Длительных простоев в ПВ нет.</p>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  )
}
