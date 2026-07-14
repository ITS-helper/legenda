import { useEffect, useMemo, useState } from 'react'
import type { UiText } from '../content/uiText'
import { CollapsibleBlock } from '../components/CollapsibleBlock'
import { ActivityDynamicsPanel } from '../components/ActivityDynamicsPanel'
import { DatePickerField } from '../components/DatePickerField'
import { AttentionPanel } from '../components/AttentionPanel'
import { TopActivityPanel } from '../components/TopActivityPanel'
import { VolumeDynamicsPanel } from '../components/VolumeDynamicsPanel'
import { VolumesPanel } from '../components/VolumesPanel'
import { useAuth } from '../context/AuthContext'
import { useMetricSettings } from '../context/MetricSettingsContext'
import { DASHBOARD_BLOCK_NAV, dashboardBlockDomId, type DashboardBlockId } from '../content/dashboardBlocks'
import { getErrorMessage } from '../lib/errors'
import { isBlockEnabled, isSubblockEnabled } from '../lib/metricSettings'
import {
  aggregateLowActivityWeekly,
  brigadeNamesMatch,
  filterComparisonBrigades,
  filterLowActivityDaily,
  formatEpisodeCount,
  formatPercent,
  formatSeconds,
  formatShiftHeadcount,
  formatBrigadeShiftHeadcount,
  formatWeekRange,
  loadAvailableDates,
  buildAvailableWeeksFromDates,
  loadBrigadeActivityDynamics,
  loadBrigadeVolumeDynamics,
  loadBrigadeDaily,
  enrichBrigadeWeeklyWithShiftStats,
  loadBrigadeWeekly,
  loadBrigadeWeeklyVolumeTotals,
  loadIdleEpisodes,
  loadKppEmployees,
  loadNotWornEmployees,
  loadShiftRows,
  loadShiftRowsForRange,
  loadZoneDaily,
  loadZoneDailyByBrigade,
  pvPercentFromZoneRows,
  ratio,
  NO_SUPERVISOR,
  sumDaily,
  topActivityDaily,
  topActivityWeekly,
  type BrigadeZoneDaily,
  type BrigadeDailyRow,
  type BrigadeDynamicsCard,
  type BrigadeVolumeDynamicsCard,
  type BrigadeWeeklyRow,
  type IdleEpisode,
  type KppEmployee,
  type NotWornEmployee,
  type ShiftMetricRow,
  type ZoneDailyRow,
} from '../lib/reports'
import {
  formatVolumeCardSummary,
  formatVolumeM3,
  loadVolumeDates,
  loadVolumeEntries,
  mergeDateLists,
  normalizeReportDate,
  type VolumeEntry,
} from '../lib/volumes'
import { isAlertZone } from '../lib/zones'
import { filterDistributionZoneRows } from '../lib/zoneVisibility'
import { brigadeLayoutClass } from '../lib/brigadeLayout'
import { resolveNotWornRule } from '../lib/notWornProfessionRules'

type SortKey = 'full_name' | 'profession' | 'long_idle_sec_total' | 'total_sec_total' | 'productivity'
type SortDirection = 'asc' | 'desc'

function getRowProductivity(row: ShiftMetricRow) {
  return ratio(row.work_sec_total, row.total_sec_total)
}

const DETAIL_ROW_ACTIVITY_WARN_PCT = 30
const DETAIL_ROW_LONG_IDLE_WARN_SEC = 2 * 60 * 60
const DETAIL_ROW_SHIFT_MIN_SEC = 6 * 60 * 60

function isDetailShiftRowAlert(row: ShiftMetricRow) {
  return (
    getRowProductivity(row) < DETAIL_ROW_ACTIVITY_WARN_PCT ||
    row.long_idle_sec_total > DETAIL_ROW_LONG_IDLE_WARN_SEC ||
    row.total_sec_total < DETAIL_ROW_SHIFT_MIN_SEC
  )
}

function getShiftSortValue(row: ShiftMetricRow, sortKey: SortKey) {
  if (sortKey === 'productivity') return getRowProductivity(row)
  if (sortKey === 'full_name') return row.full_name
  if (sortKey === 'profession') return row.profession ?? ''
  return row[sortKey]
}

function compareShiftRows(
  left: ShiftMetricRow,
  right: ShiftMetricRow,
  sortKey: SortKey,
  sortDirection: SortDirection,
) {
  const leftValue = getShiftSortValue(left, sortKey)
  const rightValue = getShiftSortValue(right, sortKey)

  if (typeof leftValue === 'string' && typeof rightValue === 'string') {
    return sortDirection === 'asc'
      ? leftValue.localeCompare(rightValue, 'ru')
      : rightValue.localeCompare(leftValue, 'ru')
  }

  return sortDirection === 'asc'
    ? Number(leftValue ?? 0) - Number(rightValue ?? 0)
    : Number(rightValue ?? 0) - Number(leftValue ?? 0)
}

function sortShiftRows(rows: ShiftMetricRow[], sortKey: SortKey, sortDirection: SortDirection) {
  return [...rows].sort((left, right) => compareShiftRows(left, right, sortKey, sortDirection))
}

function StructureBar({
  workSec,
  weakSec,
  longIdleSec,
  goSec,
  totalSec,
}: {
  workSec: number
  weakSec: number
  longIdleSec: number
  goSec: number
  totalSec: number
}) {
  const workWidth = `${ratio(workSec, totalSec)}%`
  const weakWidth = `${ratio(weakSec, totalSec)}%`
  const longIdleWidth = `${ratio(longIdleSec, totalSec)}%`
  const goWidth = `${ratio(goSec, totalSec)}%`
  return (
    <div className="structure-bar">
      <div className="structure-segment structure-work" style={{ width: workWidth }} title="Активность" />
      <div className="structure-segment structure-weak" style={{ width: weakWidth }} title="Слабая активность" />
      <div className="structure-segment structure-long-idle" style={{ width: longIdleWidth }} title="Длительный простой" />
      <div className="structure-segment structure-go" style={{ width: goWidth }} title="Ходьба между зонами" />
    </div>
  )
}

function StructureLegend() {
  return (
    <div className="structure-legend">
      <span><i className="legend-dot structure-work" /> Активность</span>
      <span><i className="legend-dot structure-weak" /> Слабая активность</span>
      <span><i className="legend-dot structure-long-idle" /> Длительный простой</span>
      <span><i className="legend-dot structure-go" /> Ходьба между зонами</span>
    </div>
  )
}

export function DashboardPage({ uiText }: { uiText: UiText }) {
  const { settings, loaded: metricSettingsLoaded } = useMetricSettings()
  const showBlock1 = isBlockEnabled('block1', settings)
  const showBlock2 = isBlockEnabled('block2', settings)
  const showBlock3 = isBlockEnabled('block3', settings)
  const showBlock4 = isBlockEnabled('block4', settings)
  const showBlock5 = isBlockEnabled('block5', settings)
  const showBlock6 = isBlockEnabled('block6', settings)
  const showBlock7 = isBlockEnabled('block7', settings)
  const showBlock1Summary = isSubblockEnabled('block1_summary', settings)
  const showBlock1Brigades = isSubblockEnabled('block1_brigades', settings)
  const showBlock1Top = isSubblockEnabled('block1_top_activity', settings)
  const showBlock1Attention = isSubblockEnabled('block1_attention', settings)
  const showBlock1Kpp = isSubblockEnabled('block1_kpp_panel', settings)
  const showBlock1VolumeCard = isSubblockEnabled('block1_volume_card', settings)
  const showBlock2Brigades = isSubblockEnabled('block2_brigades', settings)
  const showBlock2Top = isSubblockEnabled('block2_top_activity', settings)
  const showBlock2Attention = isSubblockEnabled('block2_attention', settings)
  const showBlock3Activity = isSubblockEnabled('block3_activity_dynamics', settings)
  const showBlock3Volume = isSubblockEnabled('block3_volume_dynamics', settings)
  const showBlock4Location = isSubblockEnabled('block4_location', settings)
  const showBlock4Idle = isSubblockEnabled('block4_idle', settings)
  const showBlock7Summary = isSubblockEnabled('block7_summary', settings)
  const showBlock7Brigades = isSubblockEnabled('block7_brigades', settings)
  const showBlock7Employees = isSubblockEnabled('block7_employees', settings)
  const comparisonBrigades = settings.comparisonBrigades
  const trackedBrigadeCount = comparisonBrigades.filter((name) => name.trim().length > 0).length || 2
  const comparisonBrigadesLabel =
    comparisonBrigades.length > 0 ? comparisonBrigades.join(', ') : 'выбранные бригады'
  const longIdleLabel = `бездействие от ${settings.longIdleMin} минут, от общего времени`
  const longIdleBlockNote = `от ${settings.longIdleMin} минут`
  const { password, isAdmin } = useAuth()
  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [volumeDates, setVolumeDates] = useState<string[]>([])
  const [availableWeeks, setAvailableWeeks] = useState<{ week_start: string; week_end: string }[]>([])
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedWeek, setSelectedWeek] = useState('')
  const [detailDate, setDetailDate] = useState('')
  const [detailSearch, setDetailSearch] = useState('')
  const [dynamicsDate, setDynamicsDate] = useState('')
  const [volumesDate, setVolumesDate] = useState('')

  const [dailyRows, setDailyRows] = useState<BrigadeDailyRow[]>([])
  const [kppEmployees, setKppEmployees] = useState<KppEmployee[]>([])
  const [notWornEmployees, setNotWornEmployees] = useState<NotWornEmployee[]>([])
  const [shiftRows, setShiftRows] = useState<ShiftMetricRow[]>([])
  const [detailShiftRows, setDetailShiftRows] = useState<ShiftMetricRow[]>([])
  const [zoneRows, setZoneRows] = useState<ZoneDailyRow[]>([])
  const [zoneRowsByBrigade, setZoneRowsByBrigade] = useState<BrigadeZoneDaily[]>([])
  const [idleEpisodes, setIdleEpisodes] = useState<IdleEpisode[]>([])
  const [weeklyRows, setWeeklyRows] = useState<BrigadeWeeklyRow[]>([])
  const [weeklyShiftRows, setWeeklyShiftRows] = useState<ShiftMetricRow[]>([])
  const [weeklyVolumeTotals, setWeeklyVolumeTotals] = useState<Array<{ supervisor_name: string; week_m3: number | null }>>([])
  const [dynamicsCards, setDynamicsCards] = useState<BrigadeDynamicsCard[]>([])
  const [volumeDynamicsCards, setVolumeDynamicsCards] = useState<BrigadeVolumeDynamicsCard[]>([])
  const [volumeEntries, setVolumeEntries] = useState<VolumeEntry[]>([])

  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const [dailyLoading, setDailyLoading] = useState(true)
  const [dailyError, setDailyError] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [dynamicsLoading, setDynamicsLoading] = useState(false)
  const [dynamicsError, setDynamicsError] = useState<string | null>(null)
  const [volumeDynamicsLoading, setVolumeDynamicsLoading] = useState(false)
  const [volumeDynamicsError, setVolumeDynamicsError] = useState<string | null>(null)
  const [weeklyLoading, setWeeklyLoading] = useState(false)
  const [weeklyError, setWeeklyError] = useState<string | null>(null)
  const [notWornLoading, setNotWornLoading] = useState(false)
  const [notWornError, setNotWornError] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedDate) return
    setVolumesDate(selectedDate)
  }, [selectedDate])

  const [sortKey, setSortKey] = useState<SortKey>('productivity')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [kppOpen, setKppOpen] = useState(false)
  const [notWornOpen, setNotWornOpen] = useState(false)
  const [topDailyOpen, setTopDailyOpen] = useState(false)
  const [attentionOpen, setAttentionOpen] = useState(false)
  const [topWeeklyOpen, setTopWeeklyOpen] = useState(false)
  const [weeklyAttentionOpen, setWeeklyAttentionOpen] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      try {
        const passwordValue = password.trim()
        const [dates, savedVolumeDates] = await Promise.all([
          loadAvailableDates(),
          passwordValue ? loadVolumeDates(passwordValue).catch(() => [] as string[]) : Promise.resolve([] as string[]),
        ])
        if (cancelled) return
        setAvailableDates(dates)
        setVolumeDates(savedVolumeDates)
        const mergedDates = mergeDateLists(dates, savedVolumeDates)
        setSelectedDate((current) => current || mergedDates[0] || '')
        setDetailDate((current) => current || mergedDates[0] || '')
        setDynamicsDate((current) => current || mergedDates[0] || '')
        setVolumesDate((current) => current || mergedDates[0] || '')
        setAvailableWeeks(buildAvailableWeeksFromDates(dates))
      } catch (error) {
        if (!cancelled) setBootstrapError(getErrorMessage(error))
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [password])

  useEffect(() => {
    if (!selectedDate || !password.trim()) return
    let cancelled = false

    async function loadDay() {
      setDailyLoading(true)
      setDailyError(null)
      try {
        const [brigades, kpp, shifts, zones, zonesByBrigade, episodes, volumes] = await Promise.all([
          loadBrigadeDaily(selectedDate),
          loadKppEmployees(selectedDate),
          loadShiftRows(selectedDate),
          loadZoneDaily(selectedDate),
          loadZoneDailyByBrigade(selectedDate),
          loadIdleEpisodes(selectedDate),
          loadVolumeEntries(password, selectedDate).catch(() => [] as VolumeEntry[]),
        ])
        if (cancelled) return
        setDailyRows(brigades)
        setKppEmployees(kpp)
        setShiftRows(shifts)
        setZoneRows(zones)
        setZoneRowsByBrigade(zonesByBrigade)
        setIdleEpisodes(episodes)
        setVolumeEntries(volumes)
      } catch (error) {
        if (!cancelled) setDailyError(getErrorMessage(error))
      } finally {
        if (!cancelled) setDailyLoading(false)
      }
    }

    void loadDay()
    return () => {
      cancelled = true
    }
  }, [selectedDate, password])

  useEffect(() => {
    if (!selectedDate || !showBlock7) {
      setNotWornEmployees([])
      setNotWornLoading(false)
      setNotWornError(null)
      return
    }

    let cancelled = false

    async function loadNotWorn() {
      setNotWornLoading(true)
      setNotWornError(null)
      try {
        const employees = await loadNotWornEmployees(selectedDate)
        if (!cancelled) setNotWornEmployees(employees)
      } catch (error) {
        if (!cancelled) setNotWornError(getErrorMessage(error))
      } finally {
        if (!cancelled) setNotWornLoading(false)
      }
    }

    void loadNotWorn()
    return () => {
      cancelled = true
    }
  }, [selectedDate, showBlock7, settings.notWornMinSec, settings.notWornProfessionRules])

  async function refreshVolumesForBlock(date: string) {
    const normalized = normalizeReportDate(date)
    if (!normalized || !password.trim()) return
    try {
      const entries = await loadVolumeEntries(password, normalized)
      if (normalizeReportDate(selectedDate) === normalized) setVolumeEntries(entries)
      const dates = await loadVolumeDates(password)
      setVolumeDates(dates)
      if (normalizeReportDate(dynamicsDate) === normalized) {
        const cards = await loadBrigadeVolumeDynamics(normalized)
        setVolumeDynamicsCards(cards)
      }
    } catch {
      if (normalizeReportDate(selectedDate) === normalized) setVolumeEntries([])
    }
  }

  useEffect(() => {
    if (!selectedWeek) {
      setWeeklyRows([])
      setWeeklyShiftRows([])
      setWeeklyVolumeTotals([])
      setWeeklyError(null)
      setWeeklyLoading(false)
      return
    }

    if (availableWeeks.length === 0) return

    const weekMeta = availableWeeks.find((week) => week.week_start === selectedWeek)
    if (!weekMeta) return
    const weekStart = weekMeta.week_start
    const weekEnd = weekMeta.week_end

    let cancelled = false

    async function loadWeek() {
      setWeeklyLoading(true)
      setWeeklyError(null)
      try {
        const [brigades, volumeTotals] = await Promise.all([
          loadBrigadeWeekly(weekStart, weekEnd),
          loadBrigadeWeeklyVolumeTotals(weekStart, weekEnd).catch(() => [] as Array<{ supervisor_name: string; week_m3: number | null }>),
        ])
        if (cancelled) return
        setWeeklyVolumeTotals(volumeTotals)
        setWeeklyRows(brigades)

        try {
          const shifts = await loadShiftRowsForRange(weekStart, weekEnd)
          if (cancelled) return
          setWeeklyShiftRows(shifts)
          setWeeklyRows(enrichBrigadeWeeklyWithShiftStats(brigades, shifts))
        } catch (shiftError) {
          if (!cancelled) {
            setWeeklyShiftRows([])
            setWeeklyError(getErrorMessage(shiftError))
          }
        }
      } catch (error) {
        if (!cancelled) setWeeklyError(getErrorMessage(error))
      } finally {
        if (!cancelled) setWeeklyLoading(false)
      }
    }

    void loadWeek()
    return () => {
      cancelled = true
    }
  }, [selectedWeek, availableWeeks])

  useEffect(() => {
    if (!detailDate) return
    if (detailDate === selectedDate && shiftRows.length > 0) {
      setDetailShiftRows(shiftRows)
      setDetailLoading(false)
      setDetailError(null)
      return
    }

    let cancelled = false

    async function loadDetail() {
      setDetailLoading(true)
      setDetailError(null)
      try {
        const shifts = await loadShiftRows(detailDate)
        if (cancelled) return
        setDetailShiftRows(shifts)
      } catch (error) {
        if (!cancelled) setDetailError(getErrorMessage(error))
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    }

    void loadDetail()
    return () => {
      cancelled = true
    }
  }, [detailDate, selectedDate, shiftRows])

  useEffect(() => {
    if (!dynamicsDate || !metricSettingsLoaded) return
    let cancelled = false

    async function loadDynamics() {
      setDynamicsLoading(true)
      setDynamicsError(null)
      try {
        const cards = await loadBrigadeActivityDynamics(dynamicsDate)
        if (cancelled) return
        setDynamicsCards(cards)
      } catch (error) {
        if (!cancelled) setDynamicsError(getErrorMessage(error))
      } finally {
        if (!cancelled) setDynamicsLoading(false)
      }
    }

    void loadDynamics()
    return () => {
      cancelled = true
    }
  }, [dynamicsDate, comparisonBrigades, metricSettingsLoaded])

  useEffect(() => {
    if (!dynamicsDate || !metricSettingsLoaded) return
    let cancelled = false

    async function loadVolumeDynamics() {
      setVolumeDynamicsLoading(true)
      setVolumeDynamicsError(null)
      try {
        const cards = await loadBrigadeVolumeDynamics(dynamicsDate)
        if (cancelled) return
        setVolumeDynamicsCards(cards)
      } catch (error) {
        if (!cancelled) setVolumeDynamicsError(getErrorMessage(error))
      } finally {
        if (!cancelled) setVolumeDynamicsLoading(false)
      }
    }

    void loadVolumeDynamics()
    return () => {
      cancelled = true
    }
  }, [dynamicsDate, comparisonBrigades, metricSettingsLoaded])

  const visibleDailyRows = useMemo(
    () => filterComparisonBrigades(dailyRows, comparisonBrigades),
    [dailyRows, comparisonBrigades],
  )
  const visibleWeeklyRows = useMemo(
    () => filterComparisonBrigades(weeklyRows, comparisonBrigades),
    [weeklyRows, comparisonBrigades],
  )
  const visibleVolumeEntries = useMemo(
    () =>
      volumeEntries.filter((entry) =>
        comparisonBrigades.some((name) => brigadeNamesMatch(entry.label, name)),
      ),
    [volumeEntries, comparisonBrigades],
  )

  const weeklyVolumeByBrigade = useMemo(() => {
    const map = new Map<string, number | null>()
    for (const row of weeklyVolumeTotals) {
      map.set(row.supervisor_name, row.week_m3)
    }
    return map
  }, [weeklyVolumeTotals])

  function formatWeeklyBrigadeVolume(supervisorName: string) {
    const direct = weeklyVolumeByBrigade.get(supervisorName)
    if (direct != null) return formatVolumeM3(direct)
    for (const [name, weekM3] of weeklyVolumeByBrigade.entries()) {
      if (brigadeNamesMatch(name, supervisorName) && weekM3 != null) {
        return formatVolumeM3(weekM3)
      }
    }
    return '—'
  }

  const lowActivityDaily = useMemo(() => filterLowActivityDaily(shiftRows), [shiftRows])
  const lowActivityWeekly = useMemo(() => aggregateLowActivityWeekly(weeklyShiftRows), [weeklyShiftRows])
  const topDaily = useMemo(() => topActivityDaily(shiftRows), [shiftRows])
  const topWeekly = useMemo(() => topActivityWeekly(weeklyShiftRows), [weeklyShiftRows])

  const dailyTotals = useMemo(() => sumDaily(visibleDailyRows), [visibleDailyRows])
  const dailyActivity = ratio(dailyTotals.work_sec, dailyTotals.total_sec)
  const dailyWeakActivity = ratio(dailyTotals.weak_activity_sec, dailyTotals.total_sec)
  const dailyLongIdle = ratio(dailyTotals.long_idle_sec, dailyTotals.total_sec)
  const dailyGo = ratio(dailyTotals.go_sec, dailyTotals.total_sec)
  const dailyPv = useMemo(
    () => pvPercentFromZoneRows(zoneRows),
    [zoneRows, settings.zoneVisibility],
  )

  const visibleNotWornEmployees = useMemo(
    () =>
      notWornEmployees.filter((employee) =>
        comparisonBrigades.some((name) => brigadeNamesMatch(employee.supervisor_name, name)),
      ),
    [notWornEmployees, comparisonBrigades],
  )

  const notWornEligibleSec = useMemo(
    () =>
      shiftRows
        .filter((row) =>
          comparisonBrigades.some((name) => brigadeNamesMatch(row.supervisor_name ?? NO_SUPERVISOR, name)),
        )
        .reduce((sum, row) => sum + Number(row.not_worn_eligible_sec_total ?? 0), 0),
    [shiftRows, comparisonBrigades],
  )

  const notWornSecTotal = useMemo(
    () => visibleNotWornEmployees.reduce((sum, employee) => sum + employee.not_worn_sec, 0),
    [visibleNotWornEmployees],
  )

  const block7NotWornPct = ratio(notWornSecTotal, notWornEligibleSec)

  function brigadeNotWornStat(supervisorName: string) {
    const workers = visibleNotWornEmployees.filter((employee) =>
      brigadeNamesMatch(employee.supervisor_name, supervisorName),
    )
    const not_worn_sec = workers.reduce((sum, employee) => sum + employee.not_worn_sec, 0)
    const eligible = shiftRows
      .filter((row) => brigadeNamesMatch(row.supervisor_name ?? NO_SUPERVISOR, supervisorName))
      .reduce((sum, row) => sum + Number(row.not_worn_eligible_sec_total ?? 0), 0)

    return {
      not_worn_workers: workers.length,
      not_worn_sec,
      not_worn_pct: ratio(not_worn_sec, eligible),
    }
  }

  const calendarDates = useMemo(() => mergeDateLists(availableDates, volumeDates), [availableDates, volumeDates])

  const zoneRowsByBrigadeMap = useMemo(() => {
    return new Map(zoneRowsByBrigade.map((row) => [row.supervisor_name, row.rows]))
  }, [zoneRowsByBrigade])

  const idleByBrigade = useMemo(() => {
    const brigadeMap = new Map<string, { byZone: Array<{ zonaName: string; minutes: number; count: number; alert: boolean }>; totalMin: number; totalEpisodes: number }>()
    const zoneMaps = new Map<string, Map<string, { zonaName: string; minutes: number; count: number; alert: boolean }>>()

    for (const episode of idleEpisodes) {
      const supervisor = episode.supervisor_name
      const supervisorZones = zoneMaps.get(supervisor) ?? new Map<string, { zonaName: string; minutes: number; count: number; alert: boolean }>()
      const key = episode.zonaName
      const current = supervisorZones.get(key) ?? {
        zonaName: key,
        minutes: 0,
        count: 0,
        alert: isAlertZone(episode.ble_tag_zone),
      }
      current.minutes += episode.duration_min
      current.count += 1
      supervisorZones.set(key, current)
      zoneMaps.set(supervisor, supervisorZones)
    }

    for (const [supervisor, zones] of zoneMaps.entries()) {
      const byZone = [...zones.values()].sort((left, right) => right.minutes - left.minutes)
      brigadeMap.set(supervisor, {
        byZone,
        totalMin: byZone.reduce((sum, row) => sum + row.minutes, 0),
        totalEpisodes: byZone.reduce((sum, row) => sum + row.count, 0),
      })
    }

    return brigadeMap
  }, [idleEpisodes])

  const filteredDetailRows = useMemo(() => {
    const query = detailSearch.trim().toLowerCase()
    const brigadeRows = detailShiftRows.filter((row) =>
      comparisonBrigades.some((name) => brigadeNamesMatch(row.supervisor_name ?? NO_SUPERVISOR, name)),
    )
    if (!query) return brigadeRows
    return brigadeRows.filter((row) => {
      const haystack = [
        row.full_name,
        row.employee_number,
        row.supervisor_name ?? NO_SUPERVISOR,
        row.profession ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [detailShiftRows, detailSearch, comparisonBrigades])

  const sortedShiftRows = useMemo(
    () => sortShiftRows(filteredDetailRows, sortKey, sortDirection),
    [filteredDetailRows, sortKey, sortDirection],
  )

  const detailSupervisorGroups = useMemo(() => {
    const grouped = new Map<string, ShiftMetricRow[]>()

    for (const row of sortedShiftRows) {
      const supervisorName = row.supervisor_name ?? NO_SUPERVISOR
      const rows = grouped.get(supervisorName) ?? []
      rows.push(row)
      grouped.set(supervisorName, rows)
    }

    return [...grouped.entries()]
      .sort(([leftName], [rightName]) => leftName.localeCompare(rightName, 'ru'))
      .map(([supervisorName, rows]) => ({ supervisorName, rows }))
  }, [sortedShiftRows])

  function toggleSort(key: SortKey, defaultDirection: SortDirection = 'desc') {
    if (sortKey === key) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDirection(defaultDirection)
    }
  }

  function sortLabel(label: string, key: SortKey) {
    if (sortKey !== key) return label
    return `${label} ${sortDirection === 'asc' ? '↑' : '↓'}`
  }

  const visibleDashboardNav = useMemo(() => {
    const enabled: Record<DashboardBlockId, boolean> = {
      block1: showBlock1,
      block2: showBlock2,
      block3: showBlock3,
      block4: showBlock4,
      block5: showBlock5,
      block6: showBlock6,
      block7: showBlock7,
    }
    return DASHBOARD_BLOCK_NAV.filter((item) => enabled[item.id])
  }, [showBlock1, showBlock2, showBlock3, showBlock4, showBlock5, showBlock6, showBlock7])

  function scrollToDashboardBlock(blockId: DashboardBlockId) {
    window.requestAnimationFrame(() => {
      document.getElementById(dashboardBlockDomId(blockId))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  return (
    <>
      {visibleDashboardNav.length > 0 ? (
        <nav className="dashboard-block-nav" aria-label="Навигация по блокам дашборда">
          {visibleDashboardNav.map((item) => (
            <button
              key={item.id}
              type="button"
              className="dashboard-block-nav-link"
              onClick={() => scrollToDashboardBlock(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      ) : null}

      {bootstrapError ? (
        <section className="empty-state error-state">Ошибка загрузки: {bootstrapError}</section>
      ) : null}

      {/* БЛОК 1 — ЕЖЕДНЕВНАЯ АНАЛИТИКА */}
      {showBlock1 ? (
      <CollapsibleBlock
        id={dashboardBlockDomId('block1')}
        title="Ежедневная аналитика"
        description="Сколько человек вышло на смену по бригадам, активность, слабая активность, длительный простой и ходьба между зонами за выбранный день. Проценты считаются от общего времени смены."
      >
        <div className="filter-row">
          <DatePickerField
            label="Дата"
            value={selectedDate}
            dates={availableDates}
            onChange={setSelectedDate}
            disabled={!availableDates.length}
          />
        </div>

        {dailyLoading ? <div className="empty-state">Загружаем дневную аналитику...</div> : null}
        {dailyError ? <div className="empty-state error-state">Ошибка: {dailyError}</div> : null}

        {!dailyLoading && !dailyError && visibleDailyRows.length === 0 ? (
          <div className="empty-state">Нет данных за выбранный день.</div>
        ) : null}

        {!dailyLoading && !dailyError && visibleDailyRows.length > 0 ? (
          <>
            {showBlock1Summary ? (
            <div className="metrics-grid">
              <article className="metric-card metric-card-accent">
                <span className="metric-label">Вышло на смену</span>
                <p className="metric-note">человек по всем бригадам</p>
                <strong className="metric-value">{formatShiftHeadcount(dailyTotals.workers)}</strong>
              </article>
              <article className="metric-card">
                <span className="metric-label">Активность</span>
                <p className="metric-note">доля активной работы от общего времени</p>
                <strong className="metric-value">{formatPercent(dailyActivity)}</strong>
              </article>
              <article className="metric-card">
                <span className="metric-label">Слабая активность</span>
                <p className="metric-note">микродвижения при работе, от общего времени</p>
                <strong className="metric-value">{formatPercent(dailyWeakActivity)}</strong>
              </article>
              <article className="metric-card">
                <span className="metric-label">Длительный простой</span>
                <p className="metric-note">{longIdleLabel}</p>
                <strong className="metric-value">{formatPercent(dailyLongIdle)}</strong>
              </article>
              <article className="metric-card">
                <span className="metric-label">Ходьба между зонами</span>
                <p className="metric-note">перемещения между зонами от общего времени</p>
                <strong className="metric-value">{formatPercent(dailyGo)}</strong>
              </article>
              <article className={`metric-card${dailyTotals.kpp_workers > 0 ? ' metric-card-alert' : ''}`}>
                <span className="metric-label">Замечены на КПП</span>
                <p className="metric-note">{dailyTotals.kpp_workers > 0 ? 'чел. в зоне КПП' : 'в зоне КПП никого (обед 13:00–14:00 не учитывается)'}</p>
                <strong className="metric-value">{dailyTotals.kpp_workers}</strong>
              </article>
              <article className="metric-card">
                <span className="metric-label">В рабочей зоне (ПВ)</span>
                <p className="metric-note">рабочая зона, от общего количества времени на смене</p>
                <strong className="metric-value">{zoneRows.length > 0 ? formatPercent(dailyPv) : '—'}</strong>
              </article>
              {showBlock5 && showBlock1VolumeCard ? (
              <a className="metric-card metric-card-link" href={`#${dashboardBlockDomId('block5')}`}>
                <span className="metric-label">Объёмы</span>
                <p className="metric-note">
                  {visibleVolumeEntries.length > 0
                    ? 'сумма по бригадам за день'
                    : dailyLoading
                      ? 'загрузка...'
                      : 'добавьте значения в блоке 5'}
                </p>
                <strong className="metric-value">{formatVolumeCardSummary(visibleVolumeEntries)}</strong>
              </a>
              ) : null}
            </div>
            ) : null}

            {showBlock1Brigades ? (
            <div className={brigadeLayoutClass('brigade-grid', visibleDailyRows.length)}>
              {visibleDailyRows.map((brigade) => (
                <article className="brigade-card" key={brigade.supervisor_name}>
                  <div className="brigade-card-head">
                    <div>
                      <strong>{brigade.supervisor_name}</strong>
                      <p>{formatBrigadeShiftHeadcount(brigade.supervisor_name, brigade.workers)} на смене</p>
                    </div>
                    <div className={`brigade-badge${brigade.activity_pct < settings.brigadeWarnPct ? ' brigade-badge-warn' : ''}`}>
                      {formatPercent(brigade.activity_pct)}
                    </div>
                  </div>
                  <StructureBar
                    workSec={brigade.work_sec}
                    weakSec={brigade.weak_activity_sec}
                    longIdleSec={brigade.long_idle_sec}
                    goSec={brigade.go_sec}
                    totalSec={brigade.total_sec}
                  />
                  <StructureLegend />
                  <div className="brigade-stats-grid">
                    <div className="brigade-stat">
                      <span>Активность</span>
                      <strong>{formatPercent(brigade.activity_pct)}</strong>
                    </div>
                    <div className="brigade-stat">
                      <span>Слабая активность</span>
                      <strong>{formatPercent(brigade.weak_activity_pct)}</strong>
                    </div>
                    <div className="brigade-stat">
                      <span>Длительный простой</span>
                      <strong>{formatPercent(brigade.long_idle_pct)}</strong>
                    </div>
                    <div className="brigade-stat">
                      <span>Ходьба между зонами</span>
                      <strong>{formatPercent(brigade.go_pct)}</strong>
                    </div>
                  </div>
                  <div className="brigade-card-footer">
                    <div className={`brigade-stat${brigade.kpp_workers > 0 ? ' brigade-stat-alert' : ''}`}>
                      <span>На КПП</span>
                      <strong>{brigade.kpp_workers > 0 ? `${brigade.kpp_workers} чел.` : 'нет'}</strong>
                    </div>
                    <div className="brigade-stat">
                      <span>Длительность смены</span>
                      <strong>
                        {brigade.avg_shift_duration_sec > 0 ? formatSeconds(brigade.avg_shift_duration_sec) : '—'}
                      </strong>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            ) : null}

            {showBlock1Top ? (
            <TopActivityPanel
              employees={topDaily}
              periodLabel="за день"
              open={topDailyOpen}
              onToggle={() => setTopDailyOpen((current) => !current)}
            />
            ) : null}

            {showBlock1Attention ? (
            <AttentionPanel
              employees={lowActivityDaily}
              open={attentionOpen}
              onToggle={() => setAttentionOpen((current) => !current)}
              emptyMessage={`Нет сотрудников с активностью ниже ${settings.lowActivityPct}% за этот день.`}
              periodLabel="за день"
              lowActivityPct={settings.lowActivityPct}
            />
            ) : null}

            {showBlock1Kpp ? (
            <div className={`kpp-panel${kppEmployees.length > 0 ? ' kpp-panel-alert' : ''}${kppOpen ? ' kpp-panel-open' : ' kpp-panel-closed'}`}>
              <div className="kpp-panel-head">
                <button
                  type="button"
                  className="kpp-panel-toggle"
                  onClick={() => setKppOpen((current) => !current)}
                  aria-expanded={kppOpen}
                >
                  <span className={`kpp-panel-chevron${kppOpen ? ' kpp-panel-chevron-open' : ''}`} aria-hidden="true">
                    ▸
                  </span>
                  <span className="kpp-panel-titles">
                    <span className="panel-kicker">Контроль КПП</span>
                    <span className="kpp-panel-title">{kppEmployees.length > 0 ? 'Сотрудники в зоне КПП' : 'На КПП никого не было'}</span>
                  </span>
                </button>
                {kppEmployees.length > 0 ? <span className="kpp-count">{kppEmployees.length}</span> : null}
              </div>
              {kppOpen ? (
                kppEmployees.length > 0 ? (
                  <div className="kpp-list">
                    {kppEmployees.map((employee) => (
                      <div className="kpp-row" key={employee.ww_shift_id}>
                        <div className="kpp-main">
                          <strong>{employee.full_name}</strong>
                          <span>
                            #{employee.employee_number} · {employee.supervisor_name}
                          </span>
                        </div>
                        <div className="kpp-metrics">
                          <div className="kpp-time">{employee.kpp_time}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="kpp-empty">Никто не фиксировался в зоне КПП за этот день.</p>
                )
              ) : null}
            </div>
            ) : null}
          </>
        ) : null}
      </CollapsibleBlock>
      ) : null}

      {/* БЛОК 2 — ЕЖЕНЕДЕЛЬНАЯ АНАЛИТИКА */}
      {showBlock2 ? (
      <CollapsibleBlock
        id={dashboardBlockDomId('block2')}
        title="Еженедельная аналитика"
        description="Сводка по бригадам за неделю (Пн–Вс): среднесписочная численность, активность, слабая активность, длительный простой и ходьба."
      >
        <div className="filter-row">
          <label className="filter-field">
            <span>Неделя</span>
            <select value={selectedWeek} onChange={(event) => setSelectedWeek(event.target.value)}>
              <option value="">Выберите неделю</option>
              {availableWeeks.map((week) => (
                <option key={week.week_start} value={week.week_start}>
                  {formatWeekRange(week.week_start, week.week_end)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!selectedWeek ? (
          <div className="empty-state">Выберите неделю, чтобы загрузить сводку по бригадам.</div>
        ) : null}

        {selectedWeek && weeklyLoading ? <div className="empty-state">Загружаем недельную аналитику...</div> : null}
        {selectedWeek && weeklyError ? <div className="empty-state error-state">Ошибка: {weeklyError}</div> : null}

        {selectedWeek && !weeklyLoading && !weeklyError && visibleWeeklyRows.length === 0 ? (
          <div className="empty-state">Нет данных за выбранную неделю.</div>
        ) : null}

        {selectedWeek && !weeklyLoading && !weeklyError && visibleWeeklyRows.length > 0 && showBlock2Brigades ? (
          <div className={brigadeLayoutClass('brigade-grid', visibleWeeklyRows.length)}>
            {visibleWeeklyRows.map((brigade) => (
              <article className="brigade-card" key={brigade.supervisor_name}>
                <div className="brigade-card-head">
                  <div>
                    <strong>{brigade.supervisor_name}</strong>
                    <p>≈ {brigade.avg_workers} чел./день · {brigade.unique_employees} уникальных</p>
                  </div>
                  <div className={`brigade-badge${brigade.activity_pct < settings.brigadeWarnPct ? ' brigade-badge-warn' : ''}`}>
                    {formatPercent(brigade.activity_pct)}
                  </div>
                </div>
                <StructureBar
                  workSec={brigade.work_sec}
                  weakSec={brigade.weak_activity_sec}
                  longIdleSec={brigade.long_idle_sec}
                  goSec={brigade.go_sec}
                  totalSec={brigade.total_sec}
                />
                <StructureLegend />
                <div className="brigade-stats-grid">
                  <div className="brigade-stat">
                    <span>Активность</span>
                    <strong>{formatPercent(brigade.activity_pct)}</strong>
                  </div>
                  <div className="brigade-stat">
                    <span>Слабая активность</span>
                    <strong>{formatPercent(brigade.weak_activity_pct)}</strong>
                  </div>
                  <div className="brigade-stat">
                    <span>Длительный простой</span>
                    <strong>{formatPercent(brigade.long_idle_pct)}</strong>
                  </div>
                  <div className="brigade-stat">
                    <span>Ходьба между зонами</span>
                    <strong>{formatPercent(brigade.go_pct)}</strong>
                  </div>
                </div>
                <div className="brigade-card-footer">
                  <div className="brigade-stat brigade-stat-volume">
                    <span>Выполненный объём за неделю</span>
                    <strong>{formatWeeklyBrigadeVolume(brigade.supervisor_name)}</strong>
                  </div>
                  <div className="brigade-stat">
                    <span>Длительность смены</span>
                    <strong>
                      {brigade.avg_shift_duration_sec > 0 ? formatSeconds(brigade.avg_shift_duration_sec) : '—'}
                    </strong>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {selectedWeek && !weeklyLoading && !weeklyError && visibleWeeklyRows.length > 0 && showBlock2Top ? (
          <TopActivityPanel
            employees={topWeekly}
            periodLabel="за неделю"
            open={topWeeklyOpen}
            onToggle={() => setTopWeeklyOpen((current) => !current)}
          />
        ) : null}

        {selectedWeek && !weeklyLoading && !weeklyError && visibleWeeklyRows.length > 0 && showBlock2Attention ? (
          <AttentionPanel
            employees={lowActivityWeekly}
            open={weeklyAttentionOpen}
            onToggle={() => setWeeklyAttentionOpen((current) => !current)}
            emptyMessage={`Нет сотрудников со средней активностью ниже ${settings.lowActivityPct}% за неделю.`}
            periodLabel="за неделю"
            lowActivityPct={settings.lowActivityPct}
          />
        ) : null}
      </CollapsibleBlock>
      ) : null}

      {/* БЛОК 3 — ДИНАМИКА АКТИВНОСТИ И ВЫПОЛНЕННЫХ РАБОТ */}
      {showBlock3 ? (
      <CollapsibleBlock
        id={dashboardBlockDomId('block3')}
        title="Динамика активности и выполненных работ"
        description={`Сравнение активности и выполненных объёмов бригад ${comparisonBrigadesLabel}: выбранный день против вчера и тренд за ${settings.activitySparklineDays} дней.`}
      >
        <div className="filter-row">
          <DatePickerField
            label="Дата"
            value={dynamicsDate}
            dates={availableDates}
            onChange={setDynamicsDate}
            disabled={!availableDates.length}
          />
        </div>

        {dynamicsLoading ? <div className="empty-state">Загружаем динамику активности...</div> : null}
        {dynamicsError ? <div className="empty-state error-state">Ошибка: {dynamicsError}</div> : null}

        {!dynamicsLoading && !dynamicsError && dynamicsDate && showBlock3Activity ? (
          <ActivityDynamicsPanel
            referenceDate={dynamicsDate}
            cards={dynamicsCards}
            brigadeLayoutCount={trackedBrigadeCount}
          />
        ) : null}

        {showBlock5 && showBlock3Volume ? (
        <div className="volumes-dynamics-section">
          <h3 className="volumes-dynamics-title">Динамика выполненных объёмов</h3>

          {volumeDynamicsLoading ? <div className="empty-state">Загружаем динамику объёмов...</div> : null}
          {volumeDynamicsError ? <div className="empty-state error-state">Ошибка: {volumeDynamicsError}</div> : null}

          {!volumeDynamicsLoading && !volumeDynamicsError && dynamicsDate ? (
            <VolumeDynamicsPanel
              referenceDate={dynamicsDate}
              cards={volumeDynamicsCards}
              brigadeLayoutCount={trackedBrigadeCount}
            />
          ) : null}
        </div>
        ) : null}
      </CollapsibleBlock>
      ) : null}

      {/* БЛОК 4 — МЕСТОПОЛОЖЕНИЕ И ПРОСТОИ */}
      {showBlock4 ? (
      <CollapsibleBlock
        id={dashboardBlockDomId('block4')}
        title="Местоположение и простои"
        description={`Где сотрудники каждой бригады проводили время за день и эпизоды длительного бездействия ${longIdleBlockNote} с привязкой к зоне.`}
      >
        <div className="filter-row">
          <DatePickerField
            label="Дата"
            value={selectedDate}
            dates={availableDates}
            onChange={setSelectedDate}
            disabled={!availableDates.length}
          />
        </div>

        {dailyLoading ? <div className="empty-state">Загружаем данные по зонам и простоям...</div> : null}
        {dailyError ? <div className="empty-state error-state">Ошибка: {dailyError}</div> : null}

        {!dailyLoading && !dailyError && selectedDate ? (
          <div className={brigadeLayoutClass('zones-brigade-matrix', visibleDailyRows.length)}>
            {visibleDailyRows.map((brigade) => {
              const brigadeZones = filterDistributionZoneRows(
                zoneRowsByBrigadeMap.get(brigade.supervisor_name) ?? [],
                settings.zoneVisibility,
              )
              const brigadeZoneTotalSec = brigadeZones.reduce((sum, row) => sum + row.sec, 0)
              const brigadeIdle = idleByBrigade.get(brigade.supervisor_name)

              return (
                <div className="zones-brigade-column" key={brigade.supervisor_name}>
                  <div className="zones-brigade-matrix-head">
                    <strong>{brigade.supervisor_name}</strong>
                  </div>

                  {showBlock4Location ? (
                  <div className="zone-panel zone-panel--location">
                    <div className="panel-head">
                      <div>
                        <p className="panel-kicker">Местоположение</p>
                        <h3>Распределение времени по зонам</h3>
                        <p className="panel-description">Где сотрудники бригады проводили время за день.</p>
                      </div>
                    </div>
                    {brigadeZones.length > 0 ? (
                      <div className="zone-list">
                        {brigadeZones.map((zone) => (
                          <div className={`zone-row${isAlertZone(zone.zona) ? ' zone-row-alert' : ''}`} key={`${brigade.supervisor_name}-${zone.zona}`}>
                            <div className="zone-row-head">
                              <span className="zone-name">{zone.zonaName}</span>
                              <span className="zone-value">{formatPercent(ratio(zone.sec, brigadeZoneTotalSec))}</span>
                            </div>
                            <div className="zone-bar">
                              <div
                                className={`zone-bar-fill${isAlertZone(zone.zona) ? ' zone-bar-fill-alert' : ''}`}
                                style={{ width: `${Math.max(ratio(zone.sec, brigadeZoneTotalSec), 1)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="kpp-empty">Нет данных по зонам за выбранный день.</p>
                    )}
                  </div>
                  ) : null}

                  {showBlock4Idle ? (
                  <div
                    className={`zone-panel zone-panel--idle${(brigadeIdle?.totalEpisodes ?? 0) > 0 ? ' kpp-panel-alert' : ''}`}
                  >
                    <div className="panel-head">
                      <div>
                        <p className="panel-kicker">Простои</p>
                        <h3>Длительные простои</h3>
                        <p className="panel-description">Эпизоды бездействия {longIdleBlockNote} с привязкой к зоне.</p>
                      </div>
                      {brigadeIdle && brigadeIdle.totalEpisodes > 0 ? (
                        <div className="zone-summary">
                          <span className="zone-summary-kicker">Всего за день</span>
                          <strong>{formatEpisodeCount(brigadeIdle.totalEpisodes)}</strong>
                          <span>{brigadeIdle.totalMin} мин суммарно</span>
                        </div>
                      ) : null}
                    </div>
                    {brigadeIdle && brigadeIdle.byZone.length > 0 ? (
                      <div className="zone-list">
                        {brigadeIdle.byZone.map((zone) => (
                          <div className={`zone-row${zone.alert ? ' zone-row-alert' : ''}`} key={`${brigade.supervisor_name}-${zone.zonaName}`}>
                            <div className="zone-row-head">
                              <span className="zone-name">{zone.zonaName}</span>
                              <span className="zone-value">{formatEpisodeCount(zone.count)} · {zone.minutes} мин</span>
                            </div>
                            <div className="zone-bar">
                              <div
                                className={`zone-bar-fill${zone.alert ? ' zone-bar-fill-alert' : ''}`}
                                style={{ width: `${Math.max(ratio(zone.minutes, brigadeIdle.totalMin), 1)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="kpp-empty">Данные о длительных простоях за этот день не загружены или простоев нет.</p>
                    )}
                  </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : null}
      </CollapsibleBlock>
      ) : null}

      {/* БЛОК 5 — ОБЪЁМЫ */}
      {showBlock5 ? (
      <CollapsibleBlock
        id={dashboardBlockDomId('block5')}
        title="Объёмы"
        description="Показатели объёмов за выбранный день. Загрузка Excel ГПР обновляет все дни из файла; при выборе даты на дашборде показываются сохранённые объёмы."
      >
        <div className="filter-row">
          <label className="filter-field">
            <span>Дата</span>
            <input
              type="date"
              list="dashboard-volume-dates"
              value={volumesDate}
              onChange={(event) => setVolumesDate(event.target.value)}
            />
            <datalist id="dashboard-volume-dates">
              {calendarDates.map((date) => (
                <option key={date} value={date} />
              ))}
            </datalist>
          </label>
        </div>

        {volumesDate ? (
          <VolumesPanel
            password={password}
            reportDate={volumesDate}
            readOnly={!isAdmin}
            brigadeLayoutCount={visibleVolumeEntries.length || comparisonBrigades.filter((name) => name.trim()).length}
            onSaved={() => void refreshVolumesForBlock(volumesDate)}
          />
        ) : (
          <div className="empty-state">Выберите дату.</div>
        )}
      </CollapsibleBlock>
      ) : null}

      {/* БЛОК 7 — НЕ НОСИЛ */}
      {showBlock7 ? (
      <CollapsibleBlock
        id={dashboardBlockDomId('block7')}
        title="Не носил"
        description="Подозрительное бездействие вне зон отдыха: минуты с высоким простоем и почти без движения (AA_BLE). Зоны отдыха (столовые, курилки, отдых, стройгородок) не учитываются."
        defaultOpen={visibleNotWornEmployees.length > 0}
      >
        <div className="filter-row">
          <DatePickerField
            label="Дата"
            value={selectedDate}
            dates={availableDates}
            onChange={setSelectedDate}
            disabled={!availableDates.length}
          />
        </div>

        {dailyLoading || notWornLoading ? <div className="empty-state">Загружаем данные по ношению часов...</div> : null}
        {dailyError ? <div className="empty-state error-state">Ошибка: {dailyError}</div> : null}
        {notWornError ? <div className="empty-state error-state">Ошибка: {notWornError}</div> : null}

        {!dailyLoading && !dailyError && !notWornLoading && visibleDailyRows.length === 0 ? (
          <div className="empty-state">Нет данных за выбранный день.</div>
        ) : null}

        {!dailyLoading && !dailyError && visibleDailyRows.length > 0 ? (
          <>
            {showBlock7Summary ? (
            <div className="metrics-grid">
              <article className={`metric-card${block7NotWornPct >= settings.notWornWarnPct ? ' metric-card-alert' : ''}`}>
                <span className="metric-label">Не носил</span>
                <p className="metric-note">простой без движения вне зон отдыха</p>
                <strong className="metric-value">{formatPercent(block7NotWornPct)}</strong>
              </article>
              <article className={`metric-card${visibleNotWornEmployees.length > 0 ? ' metric-card-alert' : ''}`}>
                <span className="metric-label">Сотрудников</span>
                <p className="metric-note">
                  {visibleNotWornEmployees.length > 0
                    ? `≥ ${Math.round(settings.notWornMinSec / 60)} мин подозрительного простоя`
                    : 'без длительного простоя без движения'}
                </p>
                <strong className="metric-value">{visibleNotWornEmployees.length}</strong>
              </article>
            </div>
            ) : null}

            {showBlock7Brigades ? (
            <div className={brigadeLayoutClass('brigade-grid', visibleDailyRows.length)}>
              {visibleDailyRows.map((brigade) => {
                const notWorn = brigadeNotWornStat(brigade.supervisor_name)
                return (
                <article className="brigade-card" key={brigade.supervisor_name}>
                  <div className="brigade-card-head">
                    <div>
                      <strong>{brigade.supervisor_name}</strong>
                      <p>{brigade.workers} чел. · {notWorn.not_worn_workers} не носил</p>
                    </div>
                    <div className={`brigade-badge${notWorn.not_worn_pct >= settings.notWornWarnPct ? ' brigade-badge-warn' : ''}`}>
                      {formatPercent(notWorn.not_worn_pct)}
                    </div>
                  </div>
                  <div className="brigade-stats-grid">
                    <div className="brigade-stat">
                      <span>Не носил</span>
                      <strong>{formatPercent(notWorn.not_worn_pct)}</strong>
                    </div>
                    <div className="brigade-stat">
                      <span>Сотрудников</span>
                      <strong>{notWorn.not_worn_workers}</strong>
                    </div>
                    <div className="brigade-stat">
                      <span>Подозрительный простой</span>
                      <strong>{formatSeconds(notWorn.not_worn_sec)}</strong>
                    </div>
                  </div>
                </article>
              )})}
            </div>
            ) : null}

            {showBlock7Employees ? (
            <div className={`kpp-panel not-worn-panel${visibleNotWornEmployees.length > 0 ? ' kpp-panel-alert' : ''}${notWornOpen ? ' kpp-panel-open' : ' kpp-panel-closed'}`}>
              <div className="kpp-panel-head">
                <button
                  type="button"
                  className="kpp-panel-toggle"
                  onClick={() => setNotWornOpen((current) => !current)}
                  aria-expanded={notWornOpen}
                >
                  <span className={`kpp-panel-chevron${notWornOpen ? ' kpp-panel-chevron-open' : ''}`} aria-hidden="true">
                    ▸
                  </span>
                  <span className="kpp-panel-titles">
                    <span className="panel-kicker">Контроль ношения</span>
                    <span className="kpp-panel-title">
                      {visibleNotWornEmployees.length > 0
                        ? 'Сотрудники с подозрительным простоем'
                        : 'Подозрительного простоя не было'}
                    </span>
                  </span>
                </button>
                {visibleNotWornEmployees.length > 0 ? (
                  <span className="kpp-count">{visibleNotWornEmployees.length}</span>
                ) : null}
              </div>
              {notWornOpen ? (
                visibleNotWornEmployees.length > 0 ? (
                  <div className="kpp-list">
                    {visibleNotWornEmployees.map((employee) => {
                      const warnPct = resolveNotWornRule(employee.profession, settings).warnPct
                      const isAlert = employee.not_worn_pct >= warnPct
                      return (
                      <div className={`kpp-row${isAlert ? ' kpp-row-alert' : ''}`} key={employee.ww_shift_id}>
                        <div className="kpp-main">
                          <strong>{employee.full_name}</strong>
                          <span>
                            {employee.profession?.trim() || '—'} · #{employee.employee_number} · {employee.supervisor_name}
                          </span>
                        </div>
                        <div className="kpp-metrics">
                          <div className="kpp-time">{employee.not_worn_time}</div>
                          <div className="kpp-time kpp-time-secondary">
                            {formatSeconds(employee.not_worn_sec)} · {formatPercent(employee.not_worn_pct)}
                          </div>
                        </div>
                      </div>
                    )})}
                  </div>
                ) : (
                  <p className="kpp-empty">Никто не превысил порог подозрительного простоя за этот день.</p>
                )
              ) : null}
            </div>
            ) : null}
          </>
        ) : null}
      </CollapsibleBlock>
      ) : null}

      {/* БЛОК 6 — ДЕТАЛИЗАЦИЯ */}
      {showBlock6 ? (
      <CollapsibleBlock
        id={dashboardBlockDomId('block6')}
        title="Расшифровка по сотрудникам"
        description="Смены по бригадам: профессия, длительный простой, длительность смены и активность."
        defaultOpen={false}
      >
        <div className="filter-row">
          <label className="filter-field">
            <span>Дата</span>
            <select value={detailDate} onChange={(event) => setDetailDate(event.target.value)}>
              {availableDates.map((date) => (
                <option key={date} value={date}>
                  {date}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field filter-field-search">
            <span>Поиск</span>
            <input
              type="search"
              value={detailSearch}
              onChange={(event) => setDetailSearch(event.target.value)}
              placeholder="ФИО, табельный, бригада, профессия"
              autoComplete="off"
            />
          </label>
        </div>

        {detailLoading ? <div className="empty-state">Загружаем детализацию...</div> : null}
        {detailError ? <div className="empty-state error-state">Ошибка: {detailError}</div> : null}

        {!detailLoading && !detailError && detailShiftRows.length > 0 && sortedShiftRows.length === 0 ? (
          <div className="empty-state">По запросу «{detailSearch.trim()}» ничего не найдено.</div>
        ) : null}

        {!detailLoading && !detailError && sortedShiftRows.length > 0 ? (
          <>
            <div className="detail-sort-row">
              <span className="detail-sort-label">Сортировка</span>
              <button type="button" className="sort-button" onClick={() => toggleSort('full_name', 'asc')}>
                {sortLabel(uiText.table.worker, 'full_name')}
              </button>
              <button type="button" className="sort-button" onClick={() => toggleSort('profession', 'asc')}>
                {sortLabel(uiText.table.profession, 'profession')}
              </button>
              <button type="button" className="sort-button" onClick={() => toggleSort('long_idle_sec_total')}>
                {sortLabel('Длительный простой', 'long_idle_sec_total')}
              </button>
              <button type="button" className="sort-button" onClick={() => toggleSort('total_sec_total')}>
                {sortLabel('Длительность смены', 'total_sec_total')}
              </button>
              <button type="button" className="sort-button" onClick={() => toggleSort('productivity')}>
                {sortLabel(uiText.table.activity, 'productivity')}
              </button>
              {detailSearch.trim() ? (
                <span className="detail-sort-note">
                  Показано {sortedShiftRows.length} из {detailShiftRows.length}
                </span>
              ) : null}
            </div>

            <div className={brigadeLayoutClass('detail-brigade-matrix', detailSupervisorGroups.length)}>
              {detailSupervisorGroups.map((group) => (
                <section className="detail-brigade-column" key={group.supervisorName}>
                  <div className="detail-brigade-matrix-head">
                    <strong>{group.supervisorName}</strong>
                    <span>{group.rows.length} чел.</span>
                  </div>
                  <div className="table-wrap">
                    <table className="analytics-table analytics-table-compact">
                      <thead>
                        <tr>
                          <th>{uiText.table.worker}</th>
                          <th>{uiText.table.profession}</th>
                          <th>Длительный простой</th>
                          <th>Длительность смены</th>
                          <th>{uiText.table.activity}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row) => (
                          <tr key={row.ww_shift_id} className={isDetailShiftRowAlert(row) ? 'row-alert' : undefined}>
                            <td>
                              <div className="employee-cell">
                                <strong>{row.full_name}</strong>
                                <span>#{row.employee_number}</span>
                              </div>
                            </td>
                            <td>{row.profession?.trim() || '—'}</td>
                            <td>{formatSeconds(row.long_idle_sec_total)}</td>
                            <td>{formatSeconds(row.total_sec_total)}</td>
                            <td>{formatPercent(getRowProductivity(row))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>
          </>
        ) : null}

        {!detailLoading && !detailError && detailDate && detailShiftRows.length === 0 ? (
          <div className="empty-state">Нет смен за выбранный день.</div>
        ) : null}
      </CollapsibleBlock>
      ) : null}
    </>
  )
}
