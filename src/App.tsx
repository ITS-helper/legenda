import { useEffect, useMemo, useRef, useState } from 'react'
import { defaultUiText, type UiText } from './content/uiText'
import { supabase } from './lib/supabase'
import {
  applyUiTextToSource,
  clearUiTextOverrides,
  deepMergeUiText,
  downloadUiTextJson,
  loadUiTextOverrides,
  saveUiTextOverrides,
} from './lib/uiTextEditor'
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
  pv_sec_total?: number | null
  outside_pv_sec_total?: number | null
}

type BleZoneRow = {
  ww_shift_id: number
  zona: string | null
  total_sec: number
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
  lateSec: number
  earlyReturnSec: number
  lateWorkers: number
  earlyReturnWorkers: number
  disciplineBadWorkers: number
  lowActivityWorkers: number
  lostActivitySec: number
  productivity: number
  avgWorkSec: number
  avgIdleSec: number
  avgOutsidePvSec: number
  avgAbsenceSec: number
  avgLateSec: number
  avgEarlyReturnSec: number
  discipline: number
  pvRatio: number
  lowActivityShare: number
}

type BrigadeAccumulator = Omit<
  BrigadeRow,
  | 'productivity'
  | 'avgWorkSec'
  | 'avgIdleSec'
  | 'avgOutsidePvSec'
  | 'avgAbsenceSec'
  | 'avgLateSec'
  | 'avgEarlyReturnSec'
  | 'discipline'
  | 'pvRatio'
  | 'lowActivityShare'
>

type CompareMetric =
  | 'productivity'
  | 'avgWork'
  | 'avgIdle'
  | 'pv'
  | 'outsidePv'
  | 'discipline'
  | 'absence'
  | 'lowActivityShare'
  | 'lostActivity'
  | 'avgLate'
  | 'avgEarlyReturn'
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

function getMetricWidth(value: number, max: number, higherIsBetter: boolean) {
  if (max <= 0) {
    return '10%'
  }

  const ratio = higherIsBetter ? value / max : 1 - value / max
  return `${Math.max(ratio * 100, 10)}%`
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

    if (error) {
      throw error
    }

    allRows.push(...((data ?? []) as BleZoneRow[]))

    if (!data || data.length < pageSize) {
      return allRows
    }
  }
}

function mergeZoneMetrics(rows: ShiftMetricRow[], zoneRows: BleZoneRow[]) {
  const zoneMap = zoneRows.reduce((map, row) => {
    const current = map.get(row.ww_shift_id) ?? { pvSec: 0, outsidePvSec: 0 }

    // ponytail: zona=1 is inferred as PV from current data; replace with a zone dictionary when available.
    if (row.zona === '1') {
      current.pvSec += row.total_sec
    } else if (row.zona !== null) {
      current.outsidePvSec += row.total_sec
    }

    map.set(row.ww_shift_id, current)
    return map
  }, new Map<number, { pvSec: number; outsidePvSec: number }>())

  return rows.map((row) => {
    const zoneMetric = zoneMap.get(row.ww_shift_id)
    return {
      ...row,
      pv_sec_total: row.pv_sec_total ?? zoneMetric?.pvSec ?? 0,
      outside_pv_sec_total: row.outside_pv_sec_total ?? zoneMetric?.outsidePvSec ?? 0,
    }
  })
}

function buildBrigades(rows: ShiftMetricRow[], noSupervisorLabel: string) {
  return Array.from(
    rows.reduce((map, row) => {
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
        lateSec: 0,
        earlyReturnSec: 0,
        lateWorkers: 0,
        earlyReturnWorkers: 0,
        disciplineBadWorkers: 0,
        lowActivityWorkers: 0,
        lostActivitySec: 0,
      }

      entry.workers += 1
      entry.workSec += row.work_sec_total
      entry.idleSec += row.idle_sec_total
      entry.totalSec += row.total_sec_total
      entry.sleepSec += row.sleep_sec_total
      entry.pvSec += row.pv_sec_total ?? 0
      entry.outsidePvSec += row.outside_pv_sec_total ?? 0
      entry.absenceSec += getRowAbsenceSec(row)
      entry.lateSec += row.late_seconds ?? 0
      entry.earlyReturnSec += row.early_return_seconds ?? 0
      entry.lateWorkers += row.late_seconds && row.late_seconds > 0 ? 1 : 0
      entry.earlyReturnWorkers += row.early_return_seconds && row.early_return_seconds > 0 ? 1 : 0
      entry.lowActivityWorkers += row.total_sec_total > 0 && getRowProductivity(row) < 40 ? 1 : 0
      entry.lostActivitySec += getRowLostActivitySec(row)
      entry.disciplineBadWorkers +=
        (row.late_seconds && row.late_seconds > 0) || (row.early_return_seconds && row.early_return_seconds > 0)
          ? 1
          : 0
      map.set(key, entry)
      return map
    }, new Map<string, BrigadeAccumulator>()),
  )
    .map(([, value]) => ({
      ...value,
      productivity: value.totalSec ? (value.workSec / value.totalSec) * 100 : 0,
      avgWorkSec: value.workers ? value.workSec / value.workers : 0,
      avgIdleSec: value.workers ? value.idleSec / value.workers : 0,
      avgOutsidePvSec: value.workers ? value.outsidePvSec / value.workers : 0,
      avgAbsenceSec: value.workers ? value.absenceSec / value.workers : 0,
      avgLateSec: value.workers ? value.lateSec / value.workers : 0,
      avgEarlyReturnSec: value.workers ? value.earlyReturnSec / value.workers : 0,
      discipline: value.workers
        ? ((value.workers - value.disciplineBadWorkers) / value.workers) * 100
        : 0,
      pvRatio: value.totalSec ? (value.pvSec / value.totalSec) * 100 : 0,
      lowActivityShare: value.workers ? (value.lowActivityWorkers / value.workers) * 100 : 0,
    }))
    .sort((left, right) => right.discipline - left.discipline)
}

function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedSupervisor, setSelectedSupervisor] = useState('all')
  const [compareMetric, setCompareMetric] = useState<CompareMetric>('discipline')
  const [sortKey, setSortKey] = useState<SortKey>('work_sec_total')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [showShiftTable, setShowShiftTable] = useState(true)
  const [rows, setRows] = useState<ShiftMetricRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorDraft, setEditorDraft] = useState<UiText>(() =>
    deepMergeUiText(defaultUiText, loadUiTextOverrides() ?? undefined),
  )
  const [editorStatus, setEditorStatus] = useState<string | null>(null)

  const uiText = editorDraft

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
      return
    }

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

        if (metricsError) {
          throw metricsError
        }

        if (!cancelled) {
          const zoneRows = await loadBleZoneRows(selectedDate)
          if (!cancelled) {
            setRows(mergeZoneMetrics((data ?? []) as ShiftMetricRow[], zoneRows))
            setLoading(false)
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          const message = loadError instanceof Error ? loadError.message : String(loadError)
          setError(message)
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
    () =>
      selectedSupervisor === 'all'
        ? rows
        : rows.filter(
            (row) => (row.supervisor_name ?? uiText.table.noSupervisor) === selectedSupervisor,
          ),
    [rows, selectedSupervisor, uiText.table.noSupervisor],
  )

  const brigadeRows = useMemo(
    () => buildBrigades(rows, uiText.table.noSupervisor),
    [rows, uiText.table.noSupervisor],
  )

  function getCompareMetricValue(brigade: BrigadeRow) {
    if (compareMetric === 'avgWork') return brigade.avgWorkSec
    if (compareMetric === 'avgIdle') return brigade.avgIdleSec
    if (compareMetric === 'pv') return brigade.pvRatio
    if (compareMetric === 'outsidePv') return brigade.avgOutsidePvSec
    if (compareMetric === 'discipline') return brigade.discipline
    if (compareMetric === 'absence') return brigade.avgAbsenceSec
    if (compareMetric === 'lowActivityShare') return brigade.lowActivityShare
    if (compareMetric === 'lostActivity') return brigade.lostActivitySec
    if (compareMetric === 'avgLate') return brigade.avgLateSec
    if (compareMetric === 'avgEarlyReturn') return brigade.avgEarlyReturnSec
    return brigade.productivity
  }

  const compareHigherIsBetter =
    compareMetric === 'productivity' ||
    compareMetric === 'avgWork' ||
    compareMetric === 'pv' ||
    compareMetric === 'discipline'

  const compareBrigades = [...brigadeRows]
    .sort((left, right) => {
      const leftValue = getCompareMetricValue(left)
      const rightValue = getCompareMetricValue(right)
      return compareHigherIsBetter ? rightValue - leftValue : leftValue - rightValue
    })
    .slice(0, 2)

  const compareMetricMax = Math.max(...compareBrigades.map((brigade) => getCompareMetricValue(brigade)), 1)

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
            ? left.supervisor_name ?? uiText.table.noSupervisor
            : left[sortKey]
      const rightValue =
        sortKey === 'productivity'
          ? getRowProductivity(right)
          : sortKey === 'supervisor_name'
            ? right.supervisor_name ?? uiText.table.noSupervisor
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
  }, [filteredRows, sortDirection, sortKey, uiText.table.noSupervisor])

  function toggleSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }

    setSortKey(nextKey)
    setSortDirection(nextKey === 'full_name' || nextKey === 'supervisor_name' ? 'asc' : 'desc')
  }

  function handleUiTextChange(path: string, value: string) {
    setEditorDraft((current) => {
      const next = structuredClone(current)
      const keys = path.split('.')
      let target: Record<string, unknown> = next as unknown as Record<string, unknown>

      for (let index = 0; index < keys.length - 1; index += 1) {
        target = target[keys[index]] as Record<string, unknown>
      }

      target[keys[keys.length - 1]] = value
      saveUiTextOverrides(next)
      return next
    })
  }

  function handleResetText() {
    clearUiTextOverrides()
    setEditorDraft(defaultUiText)
    setEditorStatus(null)
  }

  function handleExportText() {
    downloadUiTextJson(editorDraft)
  }

  async function handleImportText(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const raw = await file.text()
    const parsed = JSON.parse(raw) as Partial<UiText>
    const merged = deepMergeUiText(defaultUiText, parsed)
    saveUiTextOverrides(merged)
    setEditorDraft(merged)
    setEditorStatus(null)
    event.target.value = ''
  }

  async function handleApplyToFile() {
    try {
      await applyUiTextToSource(editorDraft)
      setEditorStatus(uiText.editor.applySuccess)
    } catch (applyError) {
      const message = applyError instanceof Error ? applyError.message : String(applyError)
      setEditorStatus(`${uiText.editor.applyErrorPrefix} ${message}`)
    }
  }

  function renderEditorField(label: string, path: string, value: string) {
    return (
      <label className="editor-field" key={path}>
        <span>{label}</span>
        <textarea value={value} onChange={(event) => handleUiTextChange(path, event.target.value)} />
      </label>
    )
  }

  function getCompareMetricLabel() {
    if (compareMetric === 'avgWork') return uiText.compareMetrics.avgWork
    if (compareMetric === 'avgIdle') return uiText.compareMetrics.avgIdle
    if (compareMetric === 'pv') return uiText.compareMetrics.pv
    if (compareMetric === 'outsidePv') return uiText.compareMetrics.outsidePv
    if (compareMetric === 'discipline') return uiText.compareMetrics.discipline
    if (compareMetric === 'absence') return uiText.compareMetrics.absence
    if (compareMetric === 'lowActivityShare') return uiText.compareMetrics.lowActivityShare
    if (compareMetric === 'lostActivity') return uiText.compareMetrics.lostActivity
    if (compareMetric === 'avgLate') return uiText.compareMetrics.avgLate
    if (compareMetric === 'avgEarlyReturn') return uiText.compareMetrics.avgEarlyReturn
    return uiText.compareMetrics.productivity
  }

  function formatCompareMetric(brigade: BrigadeRow) {
    const value = getCompareMetricValue(brigade)
    if (
      compareMetric === 'productivity' ||
      compareMetric === 'discipline' ||
      compareMetric === 'pv' ||
      compareMetric === 'lowActivityShare'
    ) {
      return formatPercent(value)
    }
    return formatSeconds(value)
  }

  function getSortLabel(label: string, key: SortKey) {
    if (sortKey !== key) {
      return label
    }

    return `${label} ${sortDirection === 'asc' ? '^' : 'v'}`
  }

  return (
    <main className="app-shell">
      <div className="editor-toggle-row">
        <button type="button" className="editor-toggle" onClick={() => setEditorOpen((current) => !current)}>
          {editorOpen ? uiText.editor.close : uiText.editor.open}
        </button>
      </div>

      {editorOpen ? (
        <section className="editor-panel">
          <div className="editor-panel-head">
            <div>
              <h2>{uiText.editor.title}</h2>
              <p>{uiText.editor.description}</p>
            </div>
            <div className="editor-actions">
              <button type="button" className="editor-action" onClick={handleResetText}>
                {uiText.editor.reset}
              </button>
              <button type="button" className="editor-action" onClick={handleExportText}>
                {uiText.editor.saveJson}
              </button>
              <button type="button" className="editor-action" onClick={() => fileInputRef.current?.click()}>
                {uiText.editor.import}
              </button>
              <button type="button" className="editor-action" onClick={handleApplyToFile}>
                {uiText.editor.applyToFile}
              </button>
              <input
                ref={fileInputRef}
                hidden
                type="file"
                accept="application/json"
                onChange={handleImportText}
              />
            </div>
          </div>
          <p className="editor-saved">{editorStatus ?? uiText.editor.saved}</p>
          <div className="editor-grid">
            {renderEditorField(uiText.editorFields.brand, 'brand', editorDraft.brand)}
            {renderEditorField(uiText.editorFields.heroTitle, 'heroTitle', editorDraft.heroTitle)}
            {renderEditorField(
              uiText.editorFields.heroDescription,
              'heroDescription',
              editorDraft.heroDescription,
            )}
            {renderEditorField(uiText.editorFields.compareTitle, 'compareTitle', editorDraft.compareTitle)}
            {renderEditorField(uiText.editorFields.compareEmpty, 'compareEmpty', editorDraft.compareEmpty)}
            {renderEditorField(uiText.editorFields.filtersDate, 'filters.date', editorDraft.filters.date)}
            {renderEditorField(
              uiText.editorFields.filtersSupervisor,
              'filters.supervisor',
              editorDraft.filters.supervisor,
            )}
            {renderEditorField(
              uiText.editorFields.filtersCompareMetric,
              'filters.compareMetric',
              editorDraft.filters.compareMetric,
            )}
            {renderEditorField(
              uiText.editorFields.filtersAllBrigades,
              'filters.allBrigades',
              editorDraft.filters.allBrigades,
            )}
            {renderEditorField(
              uiText.editorFields.brigadesTitle,
              'sections.brigadesTitle',
              editorDraft.sections.brigadesTitle,
            )}
            {renderEditorField(
              uiText.editorFields.shiftsTitle,
              'sections.shiftsTitle',
              editorDraft.sections.shiftsTitle,
            )}
          </div>
        </section>
      ) : null}

      <section className="hero-block dashboard-hero">
        <div className="hero-main">
          <p className="eyebrow">{uiText.brand}</p>
          <h1>{editorDraft.heroTitle}</h1>
          <p className="hero-copy">{editorDraft.heroDescription}</p>

          <div className="filter-row">
            <label className="filter-field">
              <span>{uiText.filters.date}</span>
              <select value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)}>
                {availableDates.map((date) => (
                  <option key={date} value={date}>
                    {date}
                  </option>
                ))}
              </select>
            </label>

            <label className="filter-field">
              <span>{uiText.filters.supervisor}</span>
              <select
                value={selectedSupervisor}
                onChange={(event) => setSelectedSupervisor(event.target.value)}
              >
                {supervisorOptions.map((supervisor) => (
                  <option key={supervisor} value={supervisor}>
                    {supervisor === 'all' ? uiText.filters.allBrigades : supervisor}
                  </option>
                ))}
              </select>
            </label>

            <label className="filter-field">
              <span>{uiText.filters.compareMetric}</span>
              <select
                value={compareMetric}
                onChange={(event) => setCompareMetric(event.target.value as CompareMetric)}
              >
                <option value="productivity">{uiText.compareMetrics.productivity}</option>
                <option value="avgWork">{uiText.compareMetrics.avgWork}</option>
                <option value="avgIdle">{uiText.compareMetrics.avgIdle}</option>
                <option value="pv">{uiText.compareMetrics.pv}</option>
                <option value="outsidePv">{uiText.compareMetrics.outsidePv}</option>
                <option value="discipline">{uiText.compareMetrics.discipline}</option>
                <option value="absence">{uiText.compareMetrics.absence}</option>
                <option value="lowActivityShare">{uiText.compareMetrics.lowActivityShare}</option>
                <option value="lostActivity">{uiText.compareMetrics.lostActivity}</option>
                <option value="avgLate">{uiText.compareMetrics.avgLate}</option>
                <option value="avgEarlyReturn">{uiText.compareMetrics.avgEarlyReturn}</option>
              </select>
            </label>
          </div>
        </div>

        <div className="hero-compare">
          <div className="compare-head">
            <span>{uiText.compareTitle}</span>
            <div className="compare-head-meta">
              <strong>{selectedDate || uiText.compareDateFallback}</strong>
              <p className="compare-subtitle">{getCompareMetricLabel()}</p>
            </div>
          </div>

          {compareBrigades.length > 0 ? (
            <div className="compare-layout">
              <div className="compare-chart compare-chart-rows">
                {compareBrigades.map((brigade, index) => {
                  const metricWidth = getMetricWidth(
                    getCompareMetricValue(brigade),
                    compareMetricMax,
                    compareHigherIsBetter,
                  )
                  const workWidth = `${brigade.totalSec ? (brigade.workSec / brigade.totalSec) * 100 : 0}%`
                  const idleWidth = `${brigade.totalSec ? (brigade.idleSec / brigade.totalSec) * 100 : 0}%`
                  const sleepWidth = `${brigade.totalSec ? (brigade.sleepSec / brigade.totalSec) * 100 : 0}%`

                  return (
                    <div className={`compare-card ${index === 0 ? 'compare-card-leading' : ''}`} key={brigade.supervisorName}>
                      <div className="compare-card-head">
                        <div className="compare-card-title">
                          <strong>{brigade.supervisorName}</strong>
                          <span>{brigade.workers} {uiText.compareMeta.workersSuffix}</span>
                        </div>
                        <p>{formatCompareMetric(brigade)}</p>
                      </div>

                      <div className="compare-bar-horizontal">
                        <div
                          className={
                            compareMetric === 'avgIdle' ||
                            compareMetric === 'outsidePv' ||
                            compareMetric === 'absence' ||
                            compareMetric === 'lowActivityShare' ||
                            compareMetric === 'lostActivity' ||
                            compareMetric === 'avgLate' ||
                            compareMetric === 'avgEarlyReturn'
                              ? 'compare-bar-idle compare-fill compare-fill-with-tooltip'
                              : 'compare-bar-work compare-fill compare-fill-with-tooltip'
                          }
                          style={{ width: metricWidth }}
                          data-tooltip={getCompareMetricLabel()}
                          title={`${getCompareMetricLabel()}: ${formatCompareMetric(brigade)}`}
                        />
                      </div>

                      <div className="compare-structure-row compare-structure-row-compact">
                        <div className="compare-structure-head">
                          <strong>Структура дня</strong>
                          <span>{formatSeconds(brigade.totalSec)}</span>
                        </div>
                        <div className="compare-structure-bar">
                          <div
                            className="compare-structure-segment compare-bar-work compare-segment-tooltip"
                            style={{ width: workWidth }}
                            data-tooltip={uiText.table.work}
                            title={`${uiText.table.work}: ${formatSeconds(brigade.workSec)}`}
                          />
                          <div
                            className="compare-structure-segment compare-bar-idle compare-segment-tooltip"
                            style={{ width: idleWidth }}
                            data-tooltip={uiText.table.idle}
                            title={`${uiText.table.idle}: ${formatSeconds(brigade.idleSec)}`}
                          />
                          <div
                            className="compare-structure-segment compare-bar-sleep compare-segment-tooltip"
                            style={{ width: sleepWidth }}
                            data-tooltip={uiText.table.sleep}
                            title={`${uiText.table.sleep}: ${formatSeconds(brigade.sleepSec)}`}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="compare-empty">{uiText.compareEmpty}</div>
          )}
        </div>
      </section>

      {loading ? <section className="empty-state">{uiText.loading}</section> : null}
      {error ? <section className="empty-state error-state">{uiText.loadErrorPrefix} {error}</section> : null}
      {!loading && !error && rows.length === 0 ? <section className="empty-state">{uiText.noData}</section> : null}

      {!loading && !error && rows.length > 0 ? (
        <>
          <section className="metrics-grid">
            <article className="metric-card">
              <span className="metric-label">{uiText.metrics.workersTitle}</span>
              <strong className="metric-value">{totalWorkers}</strong>
              <p className="metric-note">
                {selectedSupervisor === 'all' ? uiText.metrics.workersAllNote : selectedSupervisor}
              </p>
            </article>
            <article className="metric-card">
              <span className="metric-label">{uiText.metrics.workTitle}</span>
              <strong className="metric-value">{formatSeconds(totalWorkSeconds)}</strong>
              <p className="metric-note">{formatPercent(workRatio)} {uiText.metrics.workNote}</p>
            </article>
            <article className="metric-card">
              <span className="metric-label">{uiText.metrics.idleTitle}</span>
              <strong className="metric-value">{formatSeconds(totalIdleSeconds)}</strong>
              <p className="metric-note">{formatPercent(idleRatio)} {uiText.metrics.idleNote}</p>
            </article>
            <article className="metric-card">
              <span className="metric-label">{uiText.metrics.sleepTitle}</span>
              <strong className="metric-value">{formatSeconds(totalSleepSeconds)}</strong>
              <p className="metric-note">{formatPercent(sleepRatio)} {uiText.metrics.sleepNote}</p>
            </article>
          </section>

          <section className="content-grid">
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
                  <div className="brigade-legend-item">
                    <i className="legend-swatch brigade-visual-work" />
                    <span>{uiText.table.work}</span>
                  </div>
                  <div className="brigade-legend-item">
                    <i className="legend-swatch brigade-visual-idle" />
                    <span>{uiText.table.idle}</span>
                  </div>
                  <div className="brigade-legend-item">
                    <i className="legend-swatch brigade-visual-sleep" />
                    <span>{uiText.table.sleep}</span>
                  </div>
                </div>
              </div>

              <div className="brigade-card-grid">
                {brigadeRows.map((brigade) => (
                  <article className="brigade-card" key={brigade.supervisorName}>
                    <div className="brigade-card-head">
                      <div>
                        <strong>{brigade.supervisorName}</strong>
                        <p>
                          {brigade.workers} {uiText.compareMeta.workersSuffix} {uiText.compareMeta.inReportSuffix}
                        </p>
                      </div>
                      <div className="brigade-badge">{formatPercent(brigade.discipline)}</div>
                    </div>

                    <div className="brigade-stack">
                      <div
                        className="brigade-stack-segment brigade-visual-work"
                        style={{ width: `${brigade.totalSec ? (brigade.workSec / brigade.totalSec) * 100 : 0}%` }}
                      />
                      <div
                        className="brigade-stack-segment brigade-visual-idle"
                        style={{ width: `${brigade.totalSec ? (brigade.idleSec / brigade.totalSec) * 100 : 0}%` }}
                      />
                      <div
                        className="brigade-stack-segment brigade-visual-sleep"
                        style={{ width: `${brigade.totalSec ? (brigade.sleepSec / brigade.totalSec) * 100 : 0}%` }}
                      />
                    </div>

                    <div className="brigade-total-line">
                      <span>{uiText.compareMeta.trackedSuffix}</span>
                      <strong>{formatSeconds(brigade.totalSec)}</strong>
                    </div>

                    <div className="brigade-stats-grid">
                      <div className="brigade-stat">
                        <span>{uiText.table.activity}</span>
                        <strong>{formatPercent(brigade.productivity)}</strong>
                      </div>
                      <div className="brigade-stat">
                        <span>{uiText.table.pv}</span>
                        <strong>{formatPercent(brigade.pvRatio)}</strong>
                      </div>
                      <div className="brigade-stat">
                        <span>{uiText.table.outsidePv}</span>
                        <strong>{formatSeconds(brigade.avgOutsidePvSec)}</strong>
                      </div>
                      <div className="brigade-stat">
                        <span>{uiText.table.lowActivityShare}</span>
                        <strong>{formatPercent(brigade.lowActivityShare)}</strong>
                      </div>
                      <div className="brigade-stat">
                        <span>{uiText.table.lostActivity}</span>
                        <strong>{formatSeconds(brigade.lostActivitySec)}</strong>
                      </div>
                      <div className="brigade-stat">
                        <span>{uiText.table.absence}</span>
                        <strong>{formatSeconds(brigade.avgAbsenceSec)}</strong>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </article>

            <article className="panel">
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

          <section className="panel">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">{uiText.sections.shiftsKicker}</p>
                <h2>{uiText.sections.shiftsTitle}</h2>
              </div>
              <button
                type="button"
                className="panel-toggle"
                onClick={() => setShowShiftTable((current) => !current)}
              >
                {showShiftTable ? uiText.sections.shiftsHide : uiText.sections.shiftsShow}
              </button>
            </div>

            {showShiftTable ? (
              <div className="table-wrap">
                <table className="analytics-table">
                  <thead>
                    <tr>
                      <th>
                        <button type="button" className="sort-button" onClick={() => toggleSort('full_name')}>
                          {getSortLabel(uiText.table.worker, 'full_name')}
                        </button>
                      </th>
                      <th>
                        <button type="button" className="sort-button" onClick={() => toggleSort('supervisor_name')}>
                          {getSortLabel(uiText.table.supervisor, 'supervisor_name')}
                        </button>
                      </th>
                      <th>
                        <button type="button" className="sort-button" onClick={() => toggleSort('work_sec_total')}>
                          {getSortLabel(uiText.table.work, 'work_sec_total')}
                        </button>
                      </th>
                      <th>
                        <button type="button" className="sort-button" onClick={() => toggleSort('idle_sec_total')}>
                          {getSortLabel(uiText.table.idle, 'idle_sec_total')}
                        </button>
                      </th>
                      <th>
                        <button type="button" className="sort-button" onClick={() => toggleSort('total_sec_total')}>
                          {getSortLabel(uiText.table.total, 'total_sec_total')}
                        </button>
                      </th>
                      <th>
                        <button type="button" className="sort-button" onClick={() => toggleSort('productivity')}>
                          {getSortLabel(uiText.table.productivity, 'productivity')}
                        </button>
                      </th>
                      <th>
                        <button type="button" className="sort-button" onClick={() => toggleSort('sleep_sec_total')}>
                          {getSortLabel(uiText.table.sleep, 'sleep_sec_total')}
                        </button>
                      </th>
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
            ) : (
              <div className="panel-collapsed-note">{uiText.sections.shiftsHiddenNote}</div>
            )}
          </section>
        </>
      ) : null}
    </main>
  )
}

export default App
