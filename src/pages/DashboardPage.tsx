
import { useEffect, useMemo, useState } from 'react'
import type { UiText } from '../content/uiText'
import { supabase } from '../lib/supabase'

type ShiftMetricRow = {
  report_date: string
  ww_shift_id: number
  employee_number: string
  full_name: string
  supervisor_name: string | null
  late_seconds: number | null
  early_return_seconds: number | null
  work_sec_total: number
  idle_sec_total: number
  total_sec_total: number
  sleep_sec_total: number
  pv_sec_total?: number | null
  outside_pv_sec_total?: number | null
}

type BleZoneRow = {
  ww_shift_id: number
  zona: string | null
  total_sec: number
}

type TimelineRow = {
  report_date: string
  workers: number
  workSec: number
  idleSec: number
  sleepSec: number
  totalSec: number
  productivity: number
  discipline: number
}

type BrigadeRow = {
  supervisorName: string
  workers: number
  workSec: number
  idleSec: number
  totalSec: number
  sleepSec: number
  pvSec: number
  outsidePvSec: number
  absenceSec: number
  lowActivityWorkers: number
  lostActivitySec: number
  productivity: number
  avgIdleSec: number
  avgOutsidePvSec: number
  avgAbsenceSec: number
  discipline: number
  pvRatio: number
  lowActivityShare: number
}

type ProblemShiftRow = ShiftMetricRow & {
  productivity: number
  absenceSec: number
  lostActivitySec: number
  riskScore: number
}

type WarningCard = {
  title: string
  value: string
  note: string
}

type CompareMetric = 'productivity' | 'avgIdle' | 'pv' | 'outsidePv' | 'discipline' | 'absence' | 'lowActivityShare' | 'lostActivity'
type TimelineMetric = 'productivity' | 'discipline' | 'workers'
type SortDirection = 'asc' | 'desc'
type SortKey = 'full_name' | 'supervisor_name' | 'work_sec_total' | 'idle_sec_total' | 'total_sec_total' | 'sleep_sec_total' | 'productivity'

function formatSeconds(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  return `${hours}ч ${String(minutes).padStart(2, '0')}м`
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`
}

function formatSignedPercent(value: number) {
  const rounded = Math.round(value)
  return rounded === 0 ? '0%' : `${rounded > 0 ? '+' : ''}${rounded}%`
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' }).format(new Date(value))
}

function getRowProductivity(row: ShiftMetricRow) {
  return row.total_sec_total ? (row.work_sec_total / row.total_sec_total) * 100 : 0
}

function getRowAbsenceSec(row: ShiftMetricRow) {
  return (row.late_seconds ?? 0) + (row.early_return_seconds ?? 0)
}

function getRowLostActivitySec(row: ShiftMetricRow) {
  return Math.max(0, row.total_sec_total * 0.4 - row.work_sec_total)
}

function getMetricWidth(value: number, max: number, higherIsBetter: boolean) {
  if (max <= 0) return '10%'
  const ratio = higherIsBetter ? value / max : 1 - value / max
  return `${Math.max(ratio * 100, 10)}%`
}

function buildAreaPath(values: number[], width: number, height: number) {
  if (values.length === 0) return ''
  const max = Math.max(...values, 1)
  const stepX = values.length > 1 ? width / (values.length - 1) : width
  const line = values.map((value, index) => {
    const x = index * stepX
    const y = height - (value / max) * height
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
  }).join(' ')
  return `${line} L ${width} ${height} L 0 ${height} Z`
}
async function loadBleZoneRows(reportDate: string) {
  const allRows: BleZoneRow[] = []
  const pageSize = 1000

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .schema('analytics')
      .from('ble_minute_facts')
      .select('ww_shift_id,zona,total_sec')
      .eq('report_date', reportDate)
      .range(from, from + pageSize - 1)

    if (error) throw error
    allRows.push(...((data ?? []) as BleZoneRow[]))
    if (!data || data.length < pageSize) return allRows
  }
}

function mergeZoneMetrics(rows: ShiftMetricRow[], zoneRows: BleZoneRow[]) {
  const zoneMap = zoneRows.reduce((map, row) => {
    const current = map.get(row.ww_shift_id) ?? { pvSec: 0, outsidePvSec: 0 }
    // ponytail: zona=1 is inferred as PV from current data; replace with a zone dictionary when available.
    if (row.zona === '1') current.pvSec += row.total_sec
    else if (row.zona !== null) current.outsidePvSec += row.total_sec
    map.set(row.ww_shift_id, current)
    return map
  }, new Map<number, { pvSec: number; outsidePvSec: number }>())

  return rows.map((row) => ({
    ...row,
    pv_sec_total: row.pv_sec_total ?? zoneMap.get(row.ww_shift_id)?.pvSec ?? 0,
    outside_pv_sec_total: row.outside_pv_sec_total ?? zoneMap.get(row.ww_shift_id)?.outsidePvSec ?? 0,
  }))
}

function buildTimeline(rows: ShiftMetricRow[]) {
  const grouped = rows.reduce((map, row) => {
    const current = map.get(row.report_date) ?? {
      report_date: row.report_date,
      workers: 0,
      workSec: 0,
      idleSec: 0,
      sleepSec: 0,
      totalSec: 0,
      badWorkers: 0,
    }
    current.workers += 1
    current.workSec += row.work_sec_total
    current.idleSec += row.idle_sec_total
    current.sleepSec += row.sleep_sec_total
    current.totalSec += row.total_sec_total
    current.badWorkers += getRowAbsenceSec(row) > 0 ? 1 : 0
    map.set(row.report_date, current)
    return map
  }, new Map<string, { report_date: string; workers: number; workSec: number; idleSec: number; sleepSec: number; totalSec: number; badWorkers: number }>())

  return Array.from(grouped.values())
    .sort((left, right) => left.report_date.localeCompare(right.report_date))
    .map((row) => ({
      report_date: row.report_date,
      workers: row.workers,
      workSec: row.workSec,
      idleSec: row.idleSec,
      sleepSec: row.sleepSec,
      totalSec: row.totalSec,
      productivity: row.totalSec ? (row.workSec / row.totalSec) * 100 : 0,
      discipline: row.workers ? ((row.workers - row.badWorkers) / row.workers) * 100 : 0,
    }))
}

function buildBrigades(rows: ShiftMetricRow[], noSupervisorLabel: string) {
  const grouped = rows.reduce((map, row) => {
    const key = row.supervisor_name ?? noSupervisorLabel
    const entry = map.get(key) ?? {
      supervisorName: key,
      workers: 0,
      workSec: 0,
      idleSec: 0,
      totalSec: 0,
      sleepSec: 0,
      pvSec: 0,
      outsidePvSec: 0,
      absenceSec: 0,
      lowActivityWorkers: 0,
      lostActivitySec: 0,
      badWorkers: 0,
    }
    entry.workers += 1
    entry.workSec += row.work_sec_total
    entry.idleSec += row.idle_sec_total
    entry.totalSec += row.total_sec_total
    entry.sleepSec += row.sleep_sec_total
    entry.pvSec += row.pv_sec_total ?? 0
    entry.outsidePvSec += row.outside_pv_sec_total ?? 0
    entry.absenceSec += getRowAbsenceSec(row)
    entry.lowActivityWorkers += getRowProductivity(row) < 40 ? 1 : 0
    entry.lostActivitySec += getRowLostActivitySec(row)
    entry.badWorkers += getRowAbsenceSec(row) > 0 ? 1 : 0
    map.set(key, entry)
    return map
  }, new Map<string, { supervisorName: string; workers: number; workSec: number; idleSec: number; totalSec: number; sleepSec: number; pvSec: number; outsidePvSec: number; absenceSec: number; lowActivityWorkers: number; lostActivitySec: number; badWorkers: number }>())

  return Array.from(grouped.values())
    .map((value) => ({
      supervisorName: value.supervisorName,
      workers: value.workers,
      workSec: value.workSec,
      idleSec: value.idleSec,
      totalSec: value.totalSec,
      sleepSec: value.sleepSec,
      pvSec: value.pvSec,
      outsidePvSec: value.outsidePvSec,
      absenceSec: value.absenceSec,
      lowActivityWorkers: value.lowActivityWorkers,
      lostActivitySec: value.lostActivitySec,
      productivity: value.totalSec ? (value.workSec / value.totalSec) * 100 : 0,
      avgIdleSec: value.workers ? value.idleSec / value.workers : 0,
      avgOutsidePvSec: value.workers ? value.outsidePvSec / value.workers : 0,
      avgAbsenceSec: value.workers ? value.absenceSec / value.workers : 0,
      discipline: value.workers ? ((value.workers - value.badWorkers) / value.workers) * 100 : 0,
      pvRatio: value.totalSec ? (value.pvSec / value.totalSec) * 100 : 0,
      lowActivityShare: value.workers ? (value.lowActivityWorkers / value.workers) * 100 : 0,
    }))
    .sort((left, right) => right.discipline - left.discipline)
}
export function DashboardPage({ uiText }: { uiText: UiText }) {
  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedSupervisor, setSelectedSupervisor] = useState('all')
  const [compareMetric, setCompareMetric] = useState<CompareMetric>('discipline')
  const [timelineMetric, setTimelineMetric] = useState<TimelineMetric>('productivity')
  const [sortKey, setSortKey] = useState<SortKey>('work_sec_total')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [showShiftTable, setShowShiftTable] = useState(true)
  const [rows, setRows] = useState<ShiftMetricRow[]>([])
  const [timelineRows, setTimelineRows] = useState<TimelineRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      setLoading(true)
      setError(null)
      try {
        const { data, error: historyError } = await supabase
          .schema('analytics')
          .from('shift_daily_metrics')
          .select('*')
          .order('report_date', { ascending: false })

        if (historyError) throw historyError
        const allRows = (data ?? []) as ShiftMetricRow[]
        const dates = [...new Set(allRows.map((row) => row.report_date))]

        if (!cancelled) {
          setAvailableDates(dates)
          setTimelineRows(buildTimeline(allRows))
          setSelectedDate((current) => current || dates[0] || '')
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError))
          setLoading(false)
        }
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedDate) return
    let cancelled = false

    async function loadRows() {
      setLoading(true)
      setError(null)
      try {
        const { data, error: metricsError } = await supabase
          .schema('analytics')
          .from('shift_daily_metrics')
          .select('*')
          .eq('report_date', selectedDate)

        if (metricsError) throw metricsError
        const zoneRows = await loadBleZoneRows(selectedDate)

        if (!cancelled) {
          setRows(mergeZoneMetrics((data ?? []) as ShiftMetricRow[], zoneRows))
          setLoading(false)
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError))
          setLoading(false)
        }
      }
    }

    void loadRows()
    return () => {
      cancelled = true
    }
  }, [selectedDate])

  const supervisorOptions = useMemo(
    () => ['all', ...new Set(rows.map((row) => row.supervisor_name ?? uiText.table.noSupervisor))],
    [rows, uiText.table.noSupervisor],
  )

  const filteredRows = useMemo(
    () => selectedSupervisor === 'all'
      ? rows
      : rows.filter((row) => (row.supervisor_name ?? uiText.table.noSupervisor) === selectedSupervisor),
    [rows, selectedSupervisor, uiText.table.noSupervisor],
  )

  const brigadeRows = useMemo(
    () => buildBrigades(rows, uiText.table.noSupervisor),
    [rows, uiText.table.noSupervisor],
  )

  function getCompareMetricValue(brigade: BrigadeRow) {
    if (compareMetric === 'avgIdle') return brigade.avgIdleSec
    if (compareMetric === 'pv') return brigade.pvRatio
    if (compareMetric === 'outsidePv') return brigade.avgOutsidePvSec
    if (compareMetric === 'discipline') return brigade.discipline
    if (compareMetric === 'absence') return brigade.avgAbsenceSec
    if (compareMetric === 'lowActivityShare') return brigade.lowActivityShare
    if (compareMetric === 'lostActivity') return brigade.lostActivitySec
    return brigade.productivity
  }

  const compareHigherIsBetter = ['productivity', 'pv', 'discipline'].includes(compareMetric)
  const compareBrigades = [...brigadeRows]
    .sort((left, right) => compareHigherIsBetter ? getCompareMetricValue(right) - getCompareMetricValue(left) : getCompareMetricValue(left) - getCompareMetricValue(right))
    .slice(0, 2)
  const compareMetricMax = Math.max(...compareBrigades.map(getCompareMetricValue), 1)

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

  const selectedTimelineEntry = timelineRows.find((row) => row.report_date === selectedDate) ?? null
  const selectedTimelineIndex = selectedTimelineEntry
    ? timelineRows.findIndex((row) => row.report_date === selectedDate)
    : -1
  const previousTimelineEntry = selectedTimelineIndex > 0 ? timelineRows[selectedTimelineIndex - 1] : null
  const bestDay = [...timelineRows].sort((left, right) => right.productivity - left.productivity)[0] ?? null

  const timelineMetricLabel = timelineMetric === 'discipline' ? 'Дисциплина' : timelineMetric === 'workers' ? 'Сотрудники' : 'Продуктивность'
  const timelineValues = timelineRows.map((row) => timelineMetric === 'discipline' ? row.discipline : timelineMetric === 'workers' ? row.workers : row.productivity)
  const timelinePath = buildAreaPath(timelineValues, 560, 160)
  const maxWorkers = Math.max(...timelineRows.map((row) => row.workers), 1)

  const problematicRows: ProblemShiftRow[] = [...filteredRows]
    .map((row) => {
      const absenceSec = getRowAbsenceSec(row)
      const lostActivitySec = getRowLostActivitySec(row)
      const productivity = getRowProductivity(row)
      return {
        ...row,
        productivity,
        absenceSec,
        lostActivitySec,
        riskScore: absenceSec + lostActivitySec + row.idle_sec_total,
      }
    })
    .sort((left, right) => right.riskScore - left.riskScore)
    .slice(0, 5)

  const worstBrigades = [...brigadeRows]
    .sort((left, right) => right.lowActivityShare - left.lowActivityShare)
    .slice(0, 3)

  const todayWarnings: WarningCard[] = [
    selectedTimelineEntry && previousTimelineEntry && selectedTimelineEntry.productivity < previousTimelineEntry.productivity
      ? {
          title: 'Продуктивность просела',
          value: formatSignedPercent(selectedTimelineEntry.productivity - previousTimelineEntry.productivity),
          note: `${formatPercent(selectedTimelineEntry.productivity)} против ${formatPercent(previousTimelineEntry.productivity)}`,
        }
      : null,
    selectedTimelineEntry && previousTimelineEntry && selectedTimelineEntry.discipline < previousTimelineEntry.discipline
      ? {
          title: 'Дисциплина хуже',
          value: formatSignedPercent(selectedTimelineEntry.discipline - previousTimelineEntry.discipline),
          note: `${formatPercent(selectedTimelineEntry.discipline)} против ${formatPercent(previousTimelineEntry.discipline)}`,
        }
      : null,
    worstBrigades[0]
      ? {
          title: 'Риск по бригаде',
          value: worstBrigades[0].supervisorName,
          note: `${formatPercent(worstBrigades[0].lowActivityShare)} смен ниже 40%`,
        }
      : null,
  ].filter(Boolean) as WarningCard[]

  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((left, right) => {
      const leftValue = sortKey === 'productivity'
        ? getRowProductivity(left)
        : sortKey === 'supervisor_name'
          ? left.supervisor_name ?? uiText.table.noSupervisor
          : left[sortKey]
      const rightValue = sortKey === 'productivity'
        ? getRowProductivity(right)
        : sortKey === 'supervisor_name'
          ? right.supervisor_name ?? uiText.table.noSupervisor
          : right[sortKey]

      if (typeof leftValue === 'string' && typeof rightValue === 'string') {
        return sortDirection === 'asc'
          ? leftValue.localeCompare(rightValue, 'ru')
          : rightValue.localeCompare(leftValue, 'ru')
      }

      return sortDirection === 'asc'
        ? Number(leftValue ?? 0) - Number(rightValue ?? 0)
        : Number(rightValue ?? 0) - Number(leftValue ?? 0)
    })
  }, [filteredRows, sortDirection, sortKey, uiText.table.noSupervisor])

  function getSortLabel(label: string, key: SortKey) {
    if (sortKey !== key) return label
    return `${label} ${sortDirection === 'asc' ? '^' : 'v'}`
  }

  const compareMetricLabel =
    compareMetric === 'avgIdle' ? uiText.compareMetrics.avgIdle :
    compareMetric === 'pv' ? uiText.compareMetrics.pv :
    compareMetric === 'outsidePv' ? uiText.compareMetrics.outsidePv :
    compareMetric === 'discipline' ? uiText.compareMetrics.discipline :
    compareMetric === 'absence' ? uiText.compareMetrics.absence :
    compareMetric === 'lowActivityShare' ? uiText.compareMetrics.lowActivityShare :
    compareMetric === 'lostActivity' ? uiText.compareMetrics.lostActivity :
    uiText.compareMetrics.productivity
  return (
    <>
      <section className="hero-block dashboard-hero reveal-block">
        <div className="hero-main">
          <p className="eyebrow">{uiText.brand}</p>
          <h1>{uiText.heroTitle}</h1>
          <p className="hero-copy">{uiText.heroDescription}</p>
          <div className="filter-row">
            <label className="filter-field">
              <span>{uiText.filters.date}</span>
              <select value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)}>
                {availableDates.map((date) => <option key={date} value={date}>{date}</option>)}
              </select>
            </label>
            <label className="filter-field">
              <span>{uiText.filters.supervisor}</span>
              <select value={selectedSupervisor} onChange={(event) => setSelectedSupervisor(event.target.value)}>
                {supervisorOptions.map((supervisor) => <option key={supervisor} value={supervisor}>{supervisor === 'all' ? uiText.filters.allBrigades : supervisor}</option>)}
              </select>
            </label>
            <label className="filter-field">
              <span>{uiText.filters.compareMetric}</span>
              <select value={compareMetric} onChange={(event) => setCompareMetric(event.target.value as CompareMetric)}>
                <option value="productivity">{uiText.compareMetrics.productivity}</option>
                <option value="avgIdle">{uiText.compareMetrics.avgIdle}</option>
                <option value="pv">{uiText.compareMetrics.pv}</option>
                <option value="outsidePv">{uiText.compareMetrics.outsidePv}</option>
                <option value="discipline">{uiText.compareMetrics.discipline}</option>
                <option value="absence">{uiText.compareMetrics.absence}</option>
                <option value="lowActivityShare">{uiText.compareMetrics.lowActivityShare}</option>
                <option value="lostActivity">{uiText.compareMetrics.lostActivity}</option>
              </select>
            </label>
            <label className="filter-field">
              <span>График</span>
              <select value={timelineMetric} onChange={(event) => setTimelineMetric(event.target.value as TimelineMetric)}>
                <option value="productivity">Продуктивность</option>
                <option value="discipline">Дисциплина</option>
                <option value="workers">Сотрудники</option>
              </select>
            </label>
          </div>
        </div>
        <div className="hero-compare">
          <div className="compare-head">
            <span>{uiText.compareTitle}</span>
            <div className="compare-head-meta">
              <strong>{selectedDate || uiText.compareDateFallback}</strong>
              <p className="compare-subtitle">{compareMetricLabel}</p>
            </div>
          </div>
          {compareBrigades.length > 0 ? (
            <div className="compare-chart compare-chart-rows">
              {compareBrigades.map((brigade, index) => {
                const metricWidth = getMetricWidth(getCompareMetricValue(brigade), compareMetricMax, compareHigherIsBetter)
                const workWidth = `${brigade.totalSec ? (brigade.workSec / brigade.totalSec) * 100 : 0}%`
                const idleWidth = `${brigade.totalSec ? (brigade.idleSec / brigade.totalSec) * 100 : 0}%`
                const sleepWidth = `${brigade.totalSec ? (brigade.sleepSec / brigade.totalSec) * 100 : 0}%`
                const metricValue = ['productivity', 'discipline', 'pv', 'lowActivityShare'].includes(compareMetric)
                  ? formatPercent(getCompareMetricValue(brigade))
                  : formatSeconds(getCompareMetricValue(brigade))

                return (
                  <div className={`compare-card ${index === 0 ? 'compare-card-leading' : ''}`} key={brigade.supervisorName}>
                    <div className="compare-card-head">
                      <div className="compare-card-title">
                        <strong>{brigade.supervisorName}</strong>
                        <span>{brigade.workers} {uiText.compareMeta.workersSuffix}</span>
                      </div>
                      <p>{metricValue}</p>
                    </div>
                    <div className="compare-bar-horizontal">
                      <div
                        className={`${['avgIdle', 'outsidePv', 'absence', 'lowActivityShare', 'lostActivity'].includes(compareMetric) ? 'compare-bar-idle' : 'compare-bar-work'} compare-fill`}
                        style={{ width: metricWidth }}
                      />
                    </div>
                    <div className="compare-structure-row compare-structure-row-compact">
                      <div className="compare-structure-head">
                        <strong>Структура дня</strong>
                        <span>{formatSeconds(brigade.totalSec)}</span>
                      </div>
                      <div className="compare-structure-bar">
                        <div className="compare-structure-segment compare-bar-work" style={{ width: workWidth }} />
                        <div className="compare-structure-segment compare-bar-idle" style={{ width: idleWidth }} />
                        <div className="compare-structure-segment compare-bar-sleep" style={{ width: sleepWidth }} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : <div className="compare-empty">{uiText.compareEmpty}</div>}
        </div>
      </section>

      {loading ? <section className="empty-state">{uiText.loading}</section> : null}
      {error ? <section className="empty-state error-state">{uiText.loadErrorPrefix} {error}</section> : null}
      {!loading && !error && rows.length === 0 ? <section className="empty-state">{uiText.noData}</section> : null}

      {!loading && !error && rows.length > 0 ? (
        <>
          <section className="metrics-grid reveal-block">
            <article className="metric-card metric-card-accent">
              <span className="metric-label">{uiText.metrics.workersTitle}</span>
              <strong className="metric-value">{totalWorkers}</strong>
              <p className="metric-note">{selectedSupervisor === 'all' ? uiText.metrics.workersAllNote : selectedSupervisor}</p>
            </article>
            <article className="metric-card reveal-delay-1">
              <span className="metric-label">{uiText.metrics.workTitle}</span>
              <strong className="metric-value">{formatSeconds(totalWorkSeconds)}</strong>
              <p className="metric-note">{formatPercent(workRatio)} {uiText.metrics.workNote}</p>
            </article>
            <article className="metric-card reveal-delay-2">
              <span className="metric-label">{uiText.metrics.idleTitle}</span>
              <strong className="metric-value">{formatSeconds(totalIdleSeconds)}</strong>
              <p className="metric-note">{formatPercent(idleRatio)} {uiText.metrics.idleNote}</p>
            </article>
            <article className="metric-card reveal-delay-3">
              <span className="metric-label">{uiText.metrics.sleepTitle}</span>
              <strong className="metric-value">{formatSeconds(totalSleepSeconds)}</strong>
              <p className="metric-note">{formatPercent(sleepRatio)} {uiText.metrics.sleepNote}</p>
            </article>
          </section>

          <section className="content-grid reveal-block">
            <article className="panel panel-wide panel-timeline">
              <div className="panel-head timeline-head">
                <div>
                  <p className="panel-kicker">Динамика</p>
                  <h2>История смен по датам</h2>
                  <p className="panel-description">Показывает {timelineMetricLabel.toLowerCase()} по дням, изменение к предыдущему дню и объем выборки.</p>
                </div>
                <div className="timeline-summary">
                  <div className="timeline-summary-item">
                    <span>Продуктивность</span>
                    <strong>{selectedTimelineEntry ? formatPercent(selectedTimelineEntry.productivity) : '0%'}</strong>
                    <p>{previousTimelineEntry ? formatSignedPercent(selectedTimelineEntry!.productivity - previousTimelineEntry.productivity) : 'Нет предыдущего дня'}</p>
                  </div>
                  <div className="timeline-summary-item">
                    <span>Дисциплина</span>
                    <strong>{selectedTimelineEntry ? formatPercent(selectedTimelineEntry.discipline) : '0%'}</strong>
                    <p>{previousTimelineEntry ? formatSignedPercent(selectedTimelineEntry!.discipline - previousTimelineEntry.discipline) : 'Нет предыдущего дня'}</p>
                  </div>
                  <div className="timeline-summary-item">
                    <span>Лучший день</span>
                    <strong>{bestDay ? formatShortDate(bestDay.report_date) : 'Нет данных'}</strong>
                    <p>{bestDay ? formatPercent(bestDay.productivity) : '0%'}</p>
                  </div>
                </div>
              </div>
              <div className="timeline-stage">
                <div className="timeline-chart-shell">
                  <svg className="timeline-chart" viewBox="0 0 560 160" preserveAspectRatio="none" aria-hidden="true">
                    <defs>
                      <linearGradient id="timelineArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgba(183,240,208,0.7)" />
                        <stop offset="100%" stopColor="rgba(183,240,208,0.04)" />
                      </linearGradient>
                    </defs>
                    <path d={timelinePath} fill="url(#timelineArea)" className="timeline-area" />
                  </svg>
                  <div className="timeline-columns">
                    {timelineRows.map((row) => {
                      const columnPercent = timelineMetric === 'workers'
                        ? (row.workers / maxWorkers) * 100
                        : timelineMetric === 'discipline'
                          ? row.discipline
                          : row.productivity
                      const tooltipValue = timelineMetric === 'workers'
                        ? row.workers
                        : formatPercent(timelineMetric === 'discipline' ? row.discipline : row.productivity)
                      return (
                        <button
                          type="button"
                          key={row.report_date}
                          className={`timeline-column${row.report_date === selectedDate ? ' timeline-column-active' : ''}`}
                          onClick={() => setSelectedDate(row.report_date)}
                          title={`${row.report_date}: ${tooltipValue}`}
                        >
                          <span className="timeline-bar" style={{ height: `${Math.max(columnPercent, 8)}%` }} />
                          <span className="timeline-date">{formatShortDate(row.report_date)}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
                {selectedTimelineEntry ? (
                  <div className="timeline-insights-grid">
                    <article className="timeline-insight-card">
                      <span>Работа за день</span>
                      <strong>{formatSeconds(selectedTimelineEntry.workSec)}</strong>
                      <p>{selectedTimelineEntry.workers} сотрудников в выборке</p>
                    </article>
                    <article className="timeline-insight-card">
                      <span>Простой</span>
                      <strong>{formatSeconds(selectedTimelineEntry.idleSec)}</strong>
                      <p>{formatPercent(selectedTimelineEntry.totalSec ? (selectedTimelineEntry.idleSec / selectedTimelineEntry.totalSec) * 100 : 0)} от tracked time</p>
                    </article>
                    <article className="timeline-insight-card">
                      <span>Сон устройств</span>
                      <strong>{formatSeconds(selectedTimelineEntry.sleepSec)}</strong>
                      <p>{formatPercent(selectedTimelineEntry.totalSec ? (selectedTimelineEntry.sleepSec / selectedTimelineEntry.totalSec) * 100 : 0)} от tracked time</p>
                    </article>
                  </div>
                ) : null}
              </div>
            </article>

            <article className="panel panel-side-accent">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">Ухудшения</p>
                  <h2>Что ухудшилось сегодня</h2>
                </div>
              </div>
              <div className="warning-grid">
                {todayWarnings.length > 0 ? todayWarnings.map((warning) => (
                  <article className="warning-card" key={warning.title}>
                    <span>{warning.title}</span>
                    <strong>{warning.value}</strong>
                    <p>{warning.note}</p>
                  </article>
                )) : <div className="panel-collapsed-note">Сильных ухудшений по сравнению с предыдущим днем не видно.</div>}
              </div>
            </article>

            <article className="panel panel-wide">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">{uiText.sections.brigadesKicker}</p>
                  <h2>{uiText.sections.brigadesTitle}</h2>
                  <p className="panel-description">{uiText.sections.brigadesDescription}</p>
                </div>
              </div>
              <div className="brigade-legend">
                <span>{uiText.sections.brigadesLegendTitle}</span>
                <div className="brigade-legend-items">
                  <div className="brigade-legend-item"><i className="legend-swatch brigade-visual-work" /><span>{uiText.table.work}</span></div>
                  <div className="brigade-legend-item"><i className="legend-swatch brigade-visual-idle" /><span>{uiText.table.idle}</span></div>
                  <div className="brigade-legend-item"><i className="legend-swatch brigade-visual-sleep" /><span>{uiText.table.sleep}</span></div>
                </div>
              </div>
              <div className="brigade-card-grid">
                {brigadeRows.map((brigade) => (
                  <article className="brigade-card" key={brigade.supervisorName}>
                    <div className="brigade-card-head">
                      <div>
                        <strong>{brigade.supervisorName}</strong>
                        <p>{brigade.workers} {uiText.compareMeta.workersSuffix} {uiText.compareMeta.inReportSuffix}</p>
                      </div>
                      <div className="brigade-badge">{formatPercent(brigade.discipline)}</div>
                    </div>
                    <div className="brigade-stack">
                      <div className="brigade-stack-segment brigade-visual-work" style={{ width: `${brigade.totalSec ? (brigade.workSec / brigade.totalSec) * 100 : 0}%` }} />
                      <div className="brigade-stack-segment brigade-visual-idle" style={{ width: `${brigade.totalSec ? (brigade.idleSec / brigade.totalSec) * 100 : 0}%` }} />
                      <div className="brigade-stack-segment brigade-visual-sleep" style={{ width: `${brigade.totalSec ? (brigade.sleepSec / brigade.totalSec) * 100 : 0}%` }} />
                    </div>
                    <div className="brigade-total-line"><span>{uiText.compareMeta.trackedSuffix}</span><strong>{formatSeconds(brigade.totalSec)}</strong></div>
                    <div className="brigade-stats-grid">
                      <div className="brigade-stat"><span>{uiText.table.activity}</span><strong>{formatPercent(brigade.productivity)}</strong></div>
                      <div className="brigade-stat"><span>{uiText.table.pv}</span><strong>{formatPercent(brigade.pvRatio)}</strong></div>
                      <div className="brigade-stat"><span>{uiText.table.outsidePv}</span><strong>{formatSeconds(brigade.avgOutsidePvSec)}</strong></div>
                      <div className="brigade-stat"><span>{uiText.table.lowActivityShare}</span><strong>{formatPercent(brigade.lowActivityShare)}</strong></div>
                      <div className="brigade-stat"><span>{uiText.table.lostActivity}</span><strong>{formatSeconds(brigade.lostActivitySec)}</strong></div>
                      <div className="brigade-stat"><span>{uiText.table.absence}</span><strong>{formatSeconds(brigade.avgAbsenceSec)}</strong></div>
                    </div>
                  </article>
                ))}
              </div>
            </article>

            <article className="panel panel-side-accent">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">Риски</p>
                  <h2>Проблемные смены</h2>
                </div>
              </div>
              <div className="leaderboard">
                {problematicRows.map((row, index) => (
                  <div className="leader-row warning-row" key={row.ww_shift_id}>
                    <span className="leader-rank">{String(index + 1).padStart(2, '0')}</span>
                    <div className="leader-main">
                      <strong>{row.full_name}</strong>
                      <p>{row.supervisor_name ?? uiText.table.noSupervisor}</p>
                    </div>
                    <div className="leader-metric">
                      <strong>{formatPercent(row.productivity)}</strong>
                      <span>{formatSeconds(row.absenceSec + row.lostActivitySec)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel panel-side-accent">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">{uiText.sections.topKicker}</p>
                  <h2>{uiText.sections.topTitle}</h2>
                </div>
              </div>
              <div className="leaderboard">
                {topWorkers.map((row, index) => (
                  <div className="leader-row" key={row.ww_shift_id}>
                    <span className="leader-rank">{String(index + 1).padStart(2, '0')}</span>
                    <div className="leader-main">
                      <strong>{row.full_name}</strong>
                      <p>{row.supervisor_name ?? uiText.table.noSupervisor}</p>
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

          <section className="panel reveal-block">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">{uiText.sections.shiftsKicker}</p>
                <h2>{uiText.sections.shiftsTitle}</h2>
              </div>
              <button type="button" className="panel-toggle" onClick={() => setShowShiftTable((current) => !current)}>
                {showShiftTable ? uiText.sections.shiftsHide : uiText.sections.shiftsShow}
              </button>
            </div>
            {showShiftTable ? (
              <div className="table-wrap">
                <table className="analytics-table">
                  <thead>
                    <tr>
                      <th><button type="button" className="sort-button" onClick={() => { setSortKey('full_name'); setSortDirection(sortKey === 'full_name' && sortDirection === 'asc' ? 'desc' : 'asc') }}>{getSortLabel(uiText.table.worker, 'full_name')}</button></th>
                      <th><button type="button" className="sort-button" onClick={() => { setSortKey('supervisor_name'); setSortDirection(sortKey === 'supervisor_name' && sortDirection === 'asc' ? 'desc' : 'asc') }}>{getSortLabel(uiText.table.supervisor, 'supervisor_name')}</button></th>
                      <th><button type="button" className="sort-button" onClick={() => { setSortKey('work_sec_total'); setSortDirection(sortKey === 'work_sec_total' && sortDirection === 'desc' ? 'asc' : 'desc') }}>{getSortLabel(uiText.table.work, 'work_sec_total')}</button></th>
                      <th><button type="button" className="sort-button" onClick={() => { setSortKey('idle_sec_total'); setSortDirection(sortKey === 'idle_sec_total' && sortDirection === 'desc' ? 'asc' : 'desc') }}>{getSortLabel(uiText.table.idle, 'idle_sec_total')}</button></th>
                      <th><button type="button" className="sort-button" onClick={() => { setSortKey('total_sec_total'); setSortDirection(sortKey === 'total_sec_total' && sortDirection === 'desc' ? 'asc' : 'desc') }}>{getSortLabel(uiText.table.total, 'total_sec_total')}</button></th>
                      <th><button type="button" className="sort-button" onClick={() => { setSortKey('productivity'); setSortDirection(sortKey === 'productivity' && sortDirection === 'desc' ? 'asc' : 'desc') }}>{getSortLabel(uiText.table.productivity, 'productivity')}</button></th>
                      <th><button type="button" className="sort-button" onClick={() => { setSortKey('sleep_sec_total'); setSortDirection(sortKey === 'sleep_sec_total' && sortDirection === 'desc' ? 'asc' : 'desc') }}>{getSortLabel(uiText.table.sleep, 'sleep_sec_total')}</button></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((row) => (
                      <tr key={row.ww_shift_id}>
                        <td><div className="employee-cell"><strong>{row.full_name}</strong><span>#{row.employee_number}</span></div></td>
                        <td>{row.supervisor_name ?? uiText.table.noSupervisor}</td>
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
            ) : <div className="panel-collapsed-note">{uiText.sections.shiftsHiddenNote}</div>}
          </section>
        </>
      ) : null}
    </>
  )
}
