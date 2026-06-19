import { useEffect, useMemo, useState } from 'react'
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
  sleepRatio: number
}

type CompareMetric = 'productivity' | 'work' | 'idle' | 'sleep'
type SortDirection = 'asc' | 'desc'
type SortKey =
  | 'full_name'
  | 'supervisor_name'
  | 'work_sec_total'
  | 'idle_sec_total'
  | 'total_sec_total'
  | 'sleep_sec_total'
  | 'productivity'

function formatSeconds(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  return `${hours}ч ${String(minutes).padStart(2, '0')}м`
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`
}

function getRowProductivity(row: ShiftMetricRow) {
  return row.total_sec_total ? (row.work_sec_total / row.total_sec_total) * 100 : 0
}

function buildBrigades(rows: ShiftMetricRow[]) {
  return Array.from(
    rows.reduce((map, row) => {
      const key = row.supervisor_name ?? 'Без начальника'
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
    }, new Map<string, Omit<BrigadeRow, 'productivity' | 'idleRatio' | 'sleepRatio'>>()),
  )
    .map(([, value]) => ({
      ...value,
      productivity: value.totalSec ? (value.workSec / value.totalSec) * 100 : 0,
      idleRatio: value.totalSec ? (value.idleSec / value.totalSec) * 100 : 0,
      sleepRatio: value.totalSec ? (value.sleepSec / value.totalSec) * 100 : 0,
    }))
    .sort((left, right) => right.productivity - left.productivity)
}

function App() {
  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedSupervisor, setSelectedSupervisor] = useState('all')
  const [compareMetric, setCompareMetric] = useState<CompareMetric>('productivity')
  const [sortKey, setSortKey] = useState<SortKey>('work_sec_total')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [rows, setRows] = useState<ShiftMetricRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadDates() {
      setLoading(true)
      setError(null)

      const { data, error: datesError } = await supabase
        .schema('analytics')
        .from('shift_daily_metrics')
        .select('report_date')
        .order('report_date', { ascending: false })

      if (datesError) {
        if (!cancelled) {
          setError(datesError.message)
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

  const supervisorOptions = useMemo(
    () => ['all', ...new Set(rows.map((row) => row.supervisor_name ?? 'Без начальника'))],
    [rows],
  )

  const filteredRows = useMemo(
    () =>
      selectedSupervisor === 'all'
        ? rows
        : rows.filter((row) => (row.supervisor_name ?? 'Без начальника') === selectedSupervisor),
    [rows, selectedSupervisor],
  )

  const brigadeRows = useMemo(() => buildBrigades(rows), [rows])
  const compareBrigades = brigadeRows.slice(0, 2)

  const compareMetricMax = Math.max(
    ...compareBrigades.map((brigade) => {
      if (compareMetric === 'work') return brigade.workSec
      if (compareMetric === 'idle') return brigade.idleSec
      if (compareMetric === 'sleep') return brigade.sleepSec
      return brigade.productivity
    }),
    1,
  )

  const totalWorkers = filteredRows.length
  const totalWorkSeconds = filteredRows.reduce((sum, row) => sum + row.work_sec_total, 0)
  const totalIdleSeconds = filteredRows.reduce((sum, row) => sum + row.idle_sec_total, 0)
  const totalTrackedSeconds = filteredRows.reduce((sum, row) => sum + row.total_sec_total, 0)
  const totalSleepSeconds = filteredRows.reduce((sum, row) => sum + row.sleep_sec_total, 0)

  const workRatio = totalTrackedSeconds ? (totalWorkSeconds / totalTrackedSeconds) * 100 : 0
  const idleRatio = totalTrackedSeconds ? (totalIdleSeconds / totalTrackedSeconds) * 100 : 0
  const sleepRatio = totalTrackedSeconds ? (totalSleepSeconds / totalTrackedSeconds) * 100 : 0

  const topWorkers = filteredRows
    .map((row) => ({ ...row, productivity: getRowProductivity(row) }))
    .sort((left, right) => right.productivity - left.productivity)
    .slice(0, 5)

  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((left, right) => {
      const leftValue =
        sortKey === 'productivity'
          ? getRowProductivity(left)
          : sortKey === 'supervisor_name'
            ? left.supervisor_name ?? 'Без начальника'
            : left[sortKey]
      const rightValue =
        sortKey === 'productivity'
          ? getRowProductivity(right)
          : sortKey === 'supervisor_name'
            ? right.supervisor_name ?? 'Без начальника'
            : right[sortKey]

      if (typeof leftValue === 'string' && typeof rightValue === 'string') {
        return sortDirection === 'asc'
          ? leftValue.localeCompare(rightValue, 'ru')
          : rightValue.localeCompare(leftValue, 'ru')
      }

      const leftNumeric = Number(leftValue ?? 0)
      const rightNumeric = Number(rightValue ?? 0)
      return sortDirection === 'asc' ? leftNumeric - rightNumeric : rightNumeric - leftNumeric
    })
  }, [filteredRows, sortDirection, sortKey])

  function toggleSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }

    setSortKey(nextKey)
    setSortDirection(nextKey === 'full_name' || nextKey === 'supervisor_name' ? 'asc' : 'desc')
  }

  function getCompareMetricLabel() {
    if (compareMetric === 'work') return 'Рабочее время'
    if (compareMetric === 'idle') return 'Idle'
    if (compareMetric === 'sleep') return 'Сон'
    return 'Продуктивность'
  }

  function getCompareMetricValue(brigade: BrigadeRow) {
    if (compareMetric === 'work') return brigade.workSec
    if (compareMetric === 'idle') return brigade.idleSec
    if (compareMetric === 'sleep') return brigade.sleepSec
    return brigade.productivity
  }

  function formatCompareMetric(brigade: BrigadeRow) {
    if (compareMetric === 'productivity') return formatPercent(brigade.productivity)
    if (compareMetric === 'work') return formatSeconds(brigade.workSec)
    if (compareMetric === 'idle') return formatSeconds(brigade.idleSec)
    return formatSeconds(brigade.sleepSec)
  }

  return (
    <main className="app-shell">
      <section className="hero-block dashboard-hero">
        <div className="hero-main">
          <p className="eyebrow">Legenda Analytics</p>
          <h1>Сравнение двух бригад по работе, idle, сну и продуктивности.</h1>
          <p className="hero-copy">
            Верхний блок теперь ориентирован именно на сравнение бригад. Ниже можно
            провалиться в людей и отсортировать смены под нужный разрез.
          </p>

          <div className="filter-row">
            <label className="filter-field">
              <span>Дата</span>
              <select value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)}>
                {availableDates.map((date) => (
                  <option key={date} value={date}>
                    {date}
                  </option>
                ))}
              </select>
            </label>

            <label className="filter-field">
              <span>Начальник</span>
              <select
                value={selectedSupervisor}
                onChange={(event) => setSelectedSupervisor(event.target.value)}
              >
                {supervisorOptions.map((supervisor) => (
                  <option key={supervisor} value={supervisor}>
                    {supervisor === 'all' ? 'Все бригады' : supervisor}
                  </option>
                ))}
              </select>
            </label>

            <label className="filter-field">
              <span>Метрика сравнения</span>
              <select
                value={compareMetric}
                onChange={(event) => setCompareMetric(event.target.value as CompareMetric)}
              >
                <option value="productivity">Продуктивность</option>
                <option value="work">Рабочее время</option>
                <option value="idle">Idle</option>
                <option value="sleep">Сон</option>
              </select>
            </label>
          </div>
        </div>

        <div className="hero-compare">
          <div className="compare-head">
            <span>Сравнение бригад</span>
            <strong>{selectedDate || 'Дата не выбрана'}</strong>
            <p className="compare-subtitle">{getCompareMetricLabel()}</p>
          </div>

          {compareBrigades.length > 0 ? (
            <div className="compare-chart">
              {compareBrigades.map((brigade) => {
                const metricValue = getCompareMetricValue(brigade)
                const height = `${Math.max((metricValue / compareMetricMax) * 100, 12)}%`
                const workHeight = `${brigade.totalSec ? (brigade.workSec / brigade.totalSec) * 100 : 0}%`
                const idleHeight = `${brigade.totalSec ? (brigade.idleSec / brigade.totalSec) * 100 : 0}%`
                const sleepHeight = `${brigade.totalSec ? (brigade.sleepSec / brigade.totalSec) * 100 : 0}%`

                return (
                  <div className="compare-card" key={brigade.supervisorName}>
                    <div className="compare-bar-wrap">
                      <div className="compare-bar" style={{ height }}>
                        {compareMetric === 'work' ? <div className="compare-bar-work compare-fill" /> : null}
                        {compareMetric === 'idle' ? <div className="compare-bar-idle compare-fill" /> : null}
                        {compareMetric === 'sleep' ? <div className="compare-bar-sleep compare-fill" /> : null}
                        {compareMetric === 'productivity' ? (
                          <>
                            <div className="compare-bar-sleep" style={{ height: sleepHeight }} />
                            <div className="compare-bar-idle" style={{ height: idleHeight }} />
                            <div className="compare-bar-work" style={{ height: workHeight }} />
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="compare-meta">
                      <strong>{brigade.supervisorName}</strong>
                      <span>{brigade.workers} сотрудников</span>
                      <p>{formatCompareMetric(brigade)}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="compare-empty">Пока нет данных по бригадам.</div>
          )}
        </div>
      </section>

      {loading ? <section className="empty-state">Загружаем аналитику из Supabase...</section> : null}
      {error ? <section className="empty-state error-state">Ошибка загрузки: {error}</section> : null}
      {!loading && !error && rows.length === 0 ? (
        <section className="empty-state">Нет загруженных отчетных дней.</section>
      ) : null}

      {!loading && !error && rows.length > 0 ? (
        <>
          <section className="metrics-grid">
            <article className="metric-card">
              <span className="metric-label">Сотрудники в выборке</span>
              <strong className="metric-value">{totalWorkers}</strong>
              <p className="metric-note">
                {selectedSupervisor === 'all' ? 'Все бригады в выборке' : selectedSupervisor}
              </p>
            </article>
            <article className="metric-card">
              <span className="metric-label">Рабочее время</span>
              <strong className="metric-value">{formatSeconds(totalWorkSeconds)}</strong>
              <p className="metric-note">{formatPercent(workRatio)} от трекаемого времени</p>
            </article>
            <article className="metric-card">
              <span className="metric-label">Idle время</span>
              <strong className="metric-value">{formatSeconds(totalIdleSeconds)}</strong>
              <p className="metric-note">{formatPercent(idleRatio)} от трекаемого времени</p>
            </article>
            <article className="metric-card">
              <span className="metric-label">Сон по устройствам</span>
              <strong className="metric-value">{formatSeconds(totalSleepSeconds)}</strong>
              <p className="metric-note">{formatPercent(sleepRatio)} от трекаемого времени</p>
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
                      <span>{formatSeconds(brigade.workSec)} работа</span>
                      <span>{formatSeconds(brigade.idleSec)} idle</span>
                      <span>{formatSeconds(brigade.sleepSec)} сон</span>
                      <span>{formatPercent(brigade.productivity)} продуктивность</span>
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
                <p className="panel-kicker">Смены</p>
                <h2>Сортируемая таблица за день</h2>
              </div>
            </div>

            <div className="table-wrap">
              <table className="analytics-table">
                <thead>
                  <tr>
                    <th><button type="button" className="sort-button" onClick={() => toggleSort('full_name')}>Сотрудник</button></th>
                    <th><button type="button" className="sort-button" onClick={() => toggleSort('supervisor_name')}>Начальник</button></th>
                    <th><button type="button" className="sort-button" onClick={() => toggleSort('work_sec_total')}>Работа</button></th>
                    <th><button type="button" className="sort-button" onClick={() => toggleSort('idle_sec_total')}>Idle</button></th>
                    <th><button type="button" className="sort-button" onClick={() => toggleSort('total_sec_total')}>Всего</button></th>
                    <th><button type="button" className="sort-button" onClick={() => toggleSort('productivity')}>Продуктивность</button></th>
                    <th><button type="button" className="sort-button" onClick={() => toggleSort('sleep_sec_total')}>Сон</button></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row) => (
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
                      <td>{formatPercent(getRowProductivity(row))}</td>
                      <td>{formatSeconds(row.sleep_sec_total)}</td>
                    </tr>
                  ))}
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
