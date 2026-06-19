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

type BrigadeRow = {
  supervisorName: string
  workers: number
  workSec: number
  idleSec: number
  totalSec: number
  sleepSec: number
  productivity: number
  idleRatio: number
}

function formatSeconds(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  return `${hours}h ${String(minutes).padStart(2, '0')}m`
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`
}

function buildBrigades(rows: ShiftMetricRow[]) {
  return Array.from(
    rows.reduce((map, row) => {
      const key = row.supervisor_name ?? 'No supervisor'
      const entry = map.get(key) ?? {
        supervisorName: key,
        workers: 0,
        workSec: 0,
        idleSec: 0,
        totalSec: 0,
        sleepSec: 0,
      }

      entry.workers += 1
      entry.workSec += row.work_sec_total
      entry.idleSec += row.idle_sec_total
      entry.totalSec += row.total_sec_total
      entry.sleepSec += row.sleep_sec_total
      map.set(key, entry)
      return map
    }, new Map<string, Omit<BrigadeRow, 'productivity' | 'idleRatio'>>()),
  )
    .map(([, value]) => ({
      ...value,
      productivity: value.totalSec ? (value.workSec / value.totalSec) * 100 : 0,
      idleRatio: value.totalSec ? (value.idleSec / value.totalSec) * 100 : 0,
    }))
    .sort((left, right) => right.productivity - left.productivity)
}

function App() {
  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [selectedSupervisor, setSelectedSupervisor] = useState<string>('all')
  const [rows, setRows] = useState<ShiftMetricRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadDates() {
      setLoading(true)
      setError(null)

      const { data, error: batchError } = await supabase
        .schema('analytics')
        .from('import_batches')
        .select('report_date')
        .eq('status', 'ready')
        .order('report_date', { ascending: false })

      if (batchError) {
        if (!cancelled) {
          setError(batchError.message)
          setLoading(false)
        }
        return
      }

      const dates = [...new Set((data ?? []).map((row) => row.report_date))]

      if (!cancelled) {
        setAvailableDates(dates)
        setSelectedDate((current) => current || dates[0] || '')
        setLoading(false)
      }
    }

    void loadDates()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedDate) {
      setRows([])
      return
    }

    let cancelled = false

    async function loadRows() {
      setLoading(true)
      setError(null)

      const { data, error: metricsError } = await supabase
        .schema('analytics')
        .from('shift_daily_metrics')
        .select('*')
        .eq('report_date', selectedDate)
        .order('work_sec_total', { ascending: false })

      if (metricsError) {
        if (!cancelled) {
          setError(metricsError.message)
          setLoading(false)
        }
        return
      }

      if (!cancelled) {
        setRows(data ?? [])
        setLoading(false)
      }
    }

    void loadRows()

    return () => {
      cancelled = true
    }
  }, [selectedDate])

  const supervisorOptions = ['all', ...new Set(rows.map((row) => row.supervisor_name ?? 'No supervisor'))]
  const filteredRows =
    selectedSupervisor === 'all'
      ? rows
      : rows.filter((row) => (row.supervisor_name ?? 'No supervisor') === selectedSupervisor)

  const brigadeRows = buildBrigades(rows)
  const compareBrigades = brigadeRows.slice(0, 2)
  const compareMaxSeconds = Math.max(...compareBrigades.map((brigade) => brigade.totalSec), 1)

  const totalWorkers = filteredRows.length
  const totalWorkSeconds = filteredRows.reduce((sum, row) => sum + row.work_sec_total, 0)
  const totalIdleSeconds = filteredRows.reduce((sum, row) => sum + row.idle_sec_total, 0)
  const totalTrackedSeconds = filteredRows.reduce((sum, row) => sum + row.total_sec_total, 0)
  const totalSleepSeconds = filteredRows.reduce((sum, row) => sum + row.sleep_sec_total, 0)

  const workRatio = totalTrackedSeconds ? (totalWorkSeconds / totalTrackedSeconds) * 100 : 0
  const idleRatio = totalTrackedSeconds ? (totalIdleSeconds / totalTrackedSeconds) * 100 : 0
  const sleepRatio = totalTrackedSeconds ? (totalSleepSeconds / totalTrackedSeconds) * 100 : 0

  const topWorkers = filteredRows.slice(0, 5).map((row) => ({
    ...row,
    productivity: row.total_sec_total ? (row.work_sec_total / row.total_sec_total) * 100 : 0,
  }))

  return (
    <main className="app-shell">
      <section className="hero-block dashboard-hero">
        <div className="hero-main">
          <p className="eyebrow">Legenda Analytics</p>
          <h1>Shift intelligence for comparing the two brigades.</h1>
          <p className="hero-copy">
            The dashboard now reads live Supabase data, switches by report date,
            filters by supervisor, and keeps the top section focused on brigade-to-brigade comparison.
          </p>

          <div className="filter-row">
            <label className="filter-field">
              <span>Date</span>
              <select value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)}>
                {availableDates.map((date) => (
                  <option key={date} value={date}>
                    {date}
                  </option>
                ))}
              </select>
            </label>

            <label className="filter-field">
              <span>Supervisor</span>
              <select
                value={selectedSupervisor}
                onChange={(event) => setSelectedSupervisor(event.target.value)}
              >
                {supervisorOptions.map((supervisor) => (
                  <option key={supervisor} value={supervisor}>
                    {supervisor === 'all' ? 'All brigades' : supervisor}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="hero-compare">
          <div className="compare-head">
            <span>Brigade Compare</span>
            <strong>{selectedDate || 'No date selected'}</strong>
          </div>

          {compareBrigades.length > 0 ? (
            <div className="compare-chart">
              {compareBrigades.map((brigade) => {
                const height = `${Math.max((brigade.totalSec / compareMaxSeconds) * 100, 12)}%`
                const workHeight = `${brigade.totalSec ? (brigade.workSec / brigade.totalSec) * 100 : 0}%`
                const idleHeight = `${brigade.totalSec ? (brigade.idleSec / brigade.totalSec) * 100 : 0}%`

                return (
                  <div className="compare-card" key={brigade.supervisorName}>
                    <div className="compare-bar-wrap">
                      <div className="compare-bar" style={{ height }}>
                        <div className="compare-bar-work" style={{ height: workHeight }} />
                        <div className="compare-bar-idle" style={{ height: idleHeight }} />
                      </div>
                    </div>
                    <div className="compare-meta">
                      <strong>{brigade.supervisorName}</strong>
                      <span>{brigade.workers} workers</span>
                      <p>{formatPercent(brigade.productivity)} productivity</p>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="compare-empty">No brigade data yet.</div>
          )}
        </div>
      </section>

      {loading ? <section className="empty-state">Loading analytics from Supabase...</section> : null}
      {error ? <section className="empty-state error-state">Load error: {error}</section> : null}
      {!loading && !error && rows.length === 0 ? (
        <section className="empty-state">No imported report days yet.</section>
      ) : null}

      {!loading && !error && rows.length > 0 ? (
        <>
          <section className="metrics-grid">
            <article className="metric-card">
              <span className="metric-label">Visible workers</span>
              <strong className="metric-value">{totalWorkers}</strong>
              <p className="metric-note">
                {selectedSupervisor === 'all' ? 'All brigades in scope' : selectedSupervisor}
              </p>
            </article>
            <article className="metric-card">
              <span className="metric-label">Work time</span>
              <strong className="metric-value">{formatSeconds(totalWorkSeconds)}</strong>
              <p className="metric-note">{formatPercent(workRatio)} of tracked time</p>
            </article>
            <article className="metric-card">
              <span className="metric-label">Idle time</span>
              <strong className="metric-value">{formatSeconds(totalIdleSeconds)}</strong>
              <p className="metric-note">{formatPercent(idleRatio)} of tracked time</p>
            </article>
            <article className="metric-card">
              <span className="metric-label">Sleep signal</span>
              <strong className="metric-value">{formatSeconds(totalSleepSeconds)}</strong>
              <p className="metric-note">{formatPercent(sleepRatio)} of tracked time</p>
            </article>
          </section>

          <section className="content-grid">
            <article className="panel panel-wide">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">Brigades</p>
                  <h2>Supervisor leaderboard</h2>
                </div>
              </div>
              <div className="brigade-list">
                {brigadeRows.map((brigade) => (
                  <div className="brigade-row" key={brigade.supervisorName}>
                    <div>
                      <strong>{brigade.supervisorName}</strong>
                      <p>{brigade.workers} workers in report</p>
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
                  <p className="panel-kicker">Top 5</p>
                  <h2>Strongest shifts</h2>
                </div>
              </div>
              <div className="leaderboard">
                {topWorkers.map((row, index) => (
                  <div className="leader-row" key={row.ww_shift_id}>
                    <span className="leader-rank">{String(index + 1).padStart(2, '0')}</span>
                    <div className="leader-main">
                      <strong>{row.full_name}</strong>
                      <p>{row.supervisor_name ?? 'No supervisor'}</p>
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
                <p className="panel-kicker">Shifts</p>
                <h2>Daily shift table</h2>
              </div>
            </div>

            <div className="table-wrap">
              <table className="analytics-table">
                <thead>
                  <tr>
                    <th>Worker</th>
                    <th>Supervisor</th>
                    <th>Work</th>
                    <th>Idle</th>
                    <th>Total</th>
                    <th>Productivity</th>
                    <th>Sleep</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
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
                        <td>{row.supervisor_name ?? 'No supervisor'}</td>
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
