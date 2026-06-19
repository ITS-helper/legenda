import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import './App.css'

type ShiftMetricRow = {
  report_date: string
  ww_shift_id: number
  employee_number: string
  full_name: string
  supervisor_name: string | null
  schedule_name: string | null
  on_watch_duration_seconds: number | null
  late_seconds: number | null
  early_return_seconds: number | null
  telemetry_rows: number
  idle_sec_total: number
  go_sec_total: number
  work_sec_total: number
  total_sec_total: number
  wear_sec_total: number
  sleep_sec_total: number
}

type DashboardState = {
  reportDate: string | null
  rows: ShiftMetricRow[]
}

function formatSeconds(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  return `${hours}h ${String(minutes).padStart(2, '0')}m`
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`
}

function App() {
  const [dashboard, setDashboard] = useState<DashboardState>({ reportDate: null, rows: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadDashboard() {
      setLoading(true)
      setError(null)

      const { data: batchData, error: batchError } = await supabase
        .schema('analytics')
        .from('import_batches')
        .select('report_date')
        .eq('status', 'ready')
        .order('report_date', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (batchError) {
        if (!cancelled) {
          setError(batchError.message)
          setLoading(false)
        }
        return
      }

      if (!batchData?.report_date) {
        if (!cancelled) {
          setDashboard({ reportDate: null, rows: [] })
          setLoading(false)
        }
        return
      }

      const { data: metricRows, error: metricsError } = await supabase
        .schema('analytics')
        .from('shift_daily_metrics')
        .select('*')
        .eq('report_date', batchData.report_date)
        .order('work_sec_total', { ascending: false })

      if (metricsError) {
        if (!cancelled) {
          setError(metricsError.message)
          setLoading(false)
        }
        return
      }

      if (!cancelled) {
        setDashboard({
          reportDate: batchData.report_date,
          rows: metricRows ?? [],
        })
        setLoading(false)
      }
    }

    void loadDashboard()

    return () => {
      cancelled = true
    }
  }, [])

  const rows = dashboard.rows
  const totalWorkers = rows.length
  const totalWorkSeconds = rows.reduce((sum, row) => sum + row.work_sec_total, 0)
  const totalIdleSeconds = rows.reduce((sum, row) => sum + row.idle_sec_total, 0)
  const totalTrackedSeconds = rows.reduce((sum, row) => sum + row.total_sec_total, 0)
  const totalSleepSeconds = rows.reduce((sum, row) => sum + row.sleep_sec_total, 0)

  const workRatio = totalTrackedSeconds ? (totalWorkSeconds / totalTrackedSeconds) * 100 : 0
  const idleRatio = totalTrackedSeconds ? (totalIdleSeconds / totalTrackedSeconds) * 100 : 0
  const sleepRatio = totalTrackedSeconds ? (totalSleepSeconds / totalTrackedSeconds) * 100 : 0

  const brigadeRows = Array.from(
    rows.reduce((map, row) => {
      const key = row.supervisor_name ?? 'Без начальника'
      const entry = map.get(key) ?? {
        supervisorName: key,
        workers: 0,
        workSec: 0,
        idleSec: 0,
        totalSec: 0,
      }

      entry.workers += 1
      entry.workSec += row.work_sec_total
      entry.idleSec += row.idle_sec_total
      entry.totalSec += row.total_sec_total
      map.set(key, entry)
      return map
    }, new Map<string, { supervisorName: string; workers: number; workSec: number; idleSec: number; totalSec: number }>()),
  )
    .map(([, value]) => ({
      ...value,
      productivity: value.totalSec ? (value.workSec / value.totalSec) * 100 : 0,
    }))
    .sort((left, right) => right.productivity - left.productivity)

  const topWorkers = rows.slice(0, 5).map((row) => ({
    ...row,
    productivity: row.total_sec_total ? (row.work_sec_total / row.total_sec_total) * 100 : 0,
  }))

  return (
    <main className="app-shell">
      <section className="hero-block">
        <div className="hero-copyblock">
          <p className="eyebrow">Legenda Analytics</p>
          <h1>Живая аналитика по сменам, людям и телеметрии часов.</h1>
          <p className="hero-copy">
            Первый экран уже читает реальные данные из `Supabase` и собирает
            картину по смене за день: продуктивность, idle, сон и распределение
            по бригадам.
          </p>
        </div>
        <div className="hero-badge">
          <span>Активный день</span>
          <strong>{dashboard.reportDate ?? 'нет данных'}</strong>
        </div>
      </section>

      {loading ? <section className="empty-state">Загружаем аналитику из Supabase...</section> : null}
      {error ? <section className="empty-state error-state">Ошибка загрузки: {error}</section> : null}
      {!loading && !error && rows.length === 0 ? (
        <section className="empty-state">Данных пока нет. Сначала загрузи хотя бы один отчетный день.</section>
      ) : null}

      {!loading && !error && rows.length > 0 ? (
        <>
          <section className="metrics-grid">
            <article className="metric-card">
              <span className="metric-label">Сотрудники в дне</span>
              <strong className="metric-value">{totalWorkers}</strong>
              <p className="metric-note">По фактическим сменам с телеметрией</p>
            </article>
            <article className="metric-card">
              <span className="metric-label">Рабочее время</span>
              <strong className="metric-value">{formatSeconds(totalWorkSeconds)}</strong>
              <p className="metric-note">{formatPercent(workRatio)} от трекаемых секунд</p>
            </article>
            <article className="metric-card">
              <span className="metric-label">Idle время</span>
              <strong className="metric-value">{formatSeconds(totalIdleSeconds)}</strong>
              <p className="metric-note">{formatPercent(idleRatio)} от всего потока</p>
            </article>
            <article className="metric-card">
              <span className="metric-label">Сон по устройствам</span>
              <strong className="metric-value">{formatSeconds(totalSleepSeconds)}</strong>
              <p className="metric-note">{formatPercent(sleepRatio)} от телеметрии</p>
            </article>
          </section>

          <section className="content-grid">
            <article className="panel panel-wide">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">Бригады</p>
                  <h2>Сравнение по начальникам</h2>
                </div>
              </div>
              <div className="brigade-list">
                {brigadeRows.map((brigade) => (
                  <div className="brigade-row" key={brigade.supervisorName}>
                    <div>
                      <strong>{brigade.supervisorName}</strong>
                      <p>{brigade.workers} сотрудников в отчете</p>
                    </div>
                    <div className="brigade-stats">
                      <span>{formatSeconds(brigade.workSec)} work</span>
                      <span>{formatSeconds(brigade.idleSec)} idle</span>
                      <span>{formatPercent(brigade.productivity)} product</span>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">Топ 5</p>
                  <h2>Самые продуктивные смены</h2>
                </div>
              </div>
              <div className="leaderboard">
                {topWorkers.map((row, index) => (
                  <div className="leader-row" key={row.ww_shift_id}>
                    <span className="leader-rank">{String(index + 1).padStart(2, '0')}</span>
                    <div className="leader-main">
                      <strong>{row.full_name}</strong>
                      <p>{row.supervisor_name ?? 'Без начальника'}</p>
                    </div>
                    <div className="leader-metric">
                      <strong>{formatPercent(row.productivity)}</strong>
                      <span>{formatSeconds(row.work_sec_total)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">Сотрудники</p>
                <h2>Таблица смен за день</h2>
              </div>
            </div>

            <div className="table-wrap">
              <table className="analytics-table">
                <thead>
                  <tr>
                    <th>Сотрудник</th>
                    <th>Начальник</th>
                    <th>Work</th>
                    <th>Idle</th>
                    <th>Всего</th>
                    <th>Продуктивность</th>
                    <th>Сон</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const productivity = row.total_sec_total
                      ? (row.work_sec_total / row.total_sec_total) * 100
                      : 0

                    return (
                      <tr key={row.ww_shift_id}>
                        <td>
                          <div className="employee-cell">
                            <strong>{row.full_name}</strong>
                            <span>#{row.employee_number}</span>
                          </div>
                        </td>
                        <td>{row.supervisor_name ?? 'Без начальника'}</td>
                        <td>{formatSeconds(row.work_sec_total)}</td>
                        <td>{formatSeconds(row.idle_sec_total)}</td>
                        <td>{formatSeconds(row.total_sec_total)}</td>
                        <td>{formatPercent(productivity)}</td>
                        <td>{formatSeconds(row.sleep_sec_total)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </main>
  )
}

export default App
