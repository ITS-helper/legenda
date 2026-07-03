import { useEffect, useMemo, useState } from 'react'
import type { UiText } from '../content/uiText'
import { CollapsibleBlock } from '../components/CollapsibleBlock'
import { ActivityDynamicsPanel } from '../components/ActivityDynamicsPanel'
import { AttentionPanel } from '../components/AttentionPanel'
import { TopActivityPanel } from '../components/TopActivityPanel'
import {
  aggregateLowActivityWeekly,
  filterLowActivityDaily,
  formatFullDate,
  formatMinutes,
  formatPercent,
  formatSeconds,
  formatShiftHeadcount,
  formatBrigadeShiftHeadcount,
  formatWeekRange,
  loadAvailableDates,
  loadAvailableWeeks,
  loadBrigadeActivityDynamics,
  loadBrigadeDaily,
  loadBrigadeWeekly,
  loadIdleEpisodes,
  loadKppEmployees,
  loadShiftRows,
  loadShiftRowsForRange,
  loadZoneDaily,
  ratio,
  sumDaily,
  topActivityDaily,
  topActivityWeekly,
  type BrigadeDailyRow,
  type BrigadeDynamicsCard,
  type BrigadeWeeklyRow,
  type IdleEpisode,
  type KppEmployee,
  type ShiftMetricRow,
  type ZoneDailyRow,
} from '../lib/reports'
import { isAlertZone } from '../lib/zones'

type SortKey = 'full_name' | 'supervisor_name' | 'work_sec_total' | 'weak_activity_sec_total' | 'long_idle_sec_total' | 'total_sec_total' | 'productivity' | 'kpp_sec_total'
type SortDirection = 'asc' | 'desc'

const NO_SUPERVISOR = 'Без начальника'

function getRowProductivity(row: ShiftMetricRow) {
  return ratio(row.work_sec_total, row.total_sec_total)
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
  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [availableWeeks, setAvailableWeeks] = useState<{ week_start: string; week_end: string }[]>([])
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedWeek, setSelectedWeek] = useState('')
  const [detailDate, setDetailDate] = useState('')
  const [dynamicsDate, setDynamicsDate] = useState('')

  const [dailyRows, setDailyRows] = useState<BrigadeDailyRow[]>([])
  const [kppEmployees, setKppEmployees] = useState<KppEmployee[]>([])
  const [shiftRows, setShiftRows] = useState<ShiftMetricRow[]>([])
  const [detailShiftRows, setDetailShiftRows] = useState<ShiftMetricRow[]>([])
  const [zoneRows, setZoneRows] = useState<ZoneDailyRow[]>([])
  const [idleEpisodes, setIdleEpisodes] = useState<IdleEpisode[]>([])
  const [weeklyRows, setWeeklyRows] = useState<BrigadeWeeklyRow[]>([])
  const [weeklyShiftRows, setWeeklyShiftRows] = useState<ShiftMetricRow[]>([])
  const [dynamicsCards, setDynamicsCards] = useState<BrigadeDynamicsCard[]>([])

  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const [dailyLoading, setDailyLoading] = useState(true)
  const [dailyError, setDailyError] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [dynamicsLoading, setDynamicsLoading] = useState(false)
  const [dynamicsError, setDynamicsError] = useState<string | null>(null)
  const [weeklyLoading, setWeeklyLoading] = useState(true)
  const [weeklyError, setWeeklyError] = useState<string | null>(null)

  const [sortKey, setSortKey] = useState<SortKey>('productivity')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [kppOpen, setKppOpen] = useState(false)
  const [topDailyOpen, setTopDailyOpen] = useState(false)
  const [attentionOpen, setAttentionOpen] = useState(false)
  const [topWeeklyOpen, setTopWeeklyOpen] = useState(false)
  const [weeklyAttentionOpen, setWeeklyAttentionOpen] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      try {
        const [dates, weeks] = await Promise.all([loadAvailableDates(), loadAvailableWeeks()])
        if (cancelled) return
        setAvailableDates(dates)
        setAvailableWeeks(weeks)
        setSelectedDate((current) => current || dates[0] || '')
        setDetailDate((current) => current || dates[0] || '')
        setDynamicsDate((current) => current || dates[0] || '')
        setSelectedWeek((current) => current || weeks[0]?.week_start || '')
      } catch (error) {
        if (!cancelled) setBootstrapError(error instanceof Error ? error.message : String(error))
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

    async function loadDay() {
      setDailyLoading(true)
      setDailyError(null)
      try {
        const [brigades, kpp, shifts, zones, episodes] = await Promise.all([
          loadBrigadeDaily(selectedDate),
          loadKppEmployees(selectedDate),
          loadShiftRows(selectedDate),
          loadZoneDaily(selectedDate),
          loadIdleEpisodes(selectedDate),
        ])
        if (cancelled) return
        setDailyRows(brigades)
        setKppEmployees(kpp)
        setShiftRows(shifts)
        setZoneRows(zones)
        setIdleEpisodes(episodes)
      } catch (error) {
        if (!cancelled) setDailyError(error instanceof Error ? error.message : String(error))
      } finally {
        if (!cancelled) setDailyLoading(false)
      }
    }

    void loadDay()
    return () => {
      cancelled = true
    }
  }, [selectedDate])

  useEffect(() => {
    if (!selectedWeek) return
    let cancelled = false

    async function loadWeek() {
      setWeeklyLoading(true)
      setWeeklyError(null)
      try {
        const brigades = await loadBrigadeWeekly(selectedWeek)
        const weekMeta = availableWeeks.find((week) => week.week_start === selectedWeek)
        const shifts = weekMeta
          ? await loadShiftRowsForRange(weekMeta.week_start, weekMeta.week_end)
          : []
        if (cancelled) return
        setWeeklyRows(brigades)
        setWeeklyShiftRows(shifts)
      } catch (error) {
        if (!cancelled) setWeeklyError(error instanceof Error ? error.message : String(error))
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
    let cancelled = false

    async function loadDetail() {
      setDetailLoading(true)
      setDetailError(null)
      try {
        const shifts = await loadShiftRows(detailDate)
        if (cancelled) return
        setDetailShiftRows(shifts)
      } catch (error) {
        if (!cancelled) setDetailError(error instanceof Error ? error.message : String(error))
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    }

    void loadDetail()
    return () => {
      cancelled = true
    }
  }, [detailDate])

  useEffect(() => {
    if (!dynamicsDate) return
    let cancelled = false

    async function loadDynamics() {
      setDynamicsLoading(true)
      setDynamicsError(null)
      try {
        const cards = await loadBrigadeActivityDynamics(dynamicsDate)
        if (cancelled) return
        setDynamicsCards(cards)
      } catch (error) {
        if (!cancelled) setDynamicsError(error instanceof Error ? error.message : String(error))
      } finally {
        if (!cancelled) setDynamicsLoading(false)
      }
    }

    void loadDynamics()
    return () => {
      cancelled = true
    }
  }, [dynamicsDate])

  const lowActivityDaily = useMemo(() => filterLowActivityDaily(shiftRows), [shiftRows])
  const lowActivityWeekly = useMemo(() => aggregateLowActivityWeekly(weeklyShiftRows), [weeklyShiftRows])
  const topDaily = useMemo(() => topActivityDaily(shiftRows), [shiftRows])
  const topWeekly = useMemo(() => topActivityWeekly(weeklyShiftRows), [weeklyShiftRows])

  const dailyTotals = useMemo(() => sumDaily(dailyRows), [dailyRows])
  const dailyActivity = ratio(dailyTotals.work_sec, dailyTotals.total_sec)
  const dailyWeakActivity = ratio(dailyTotals.weak_activity_sec, dailyTotals.total_sec)
  const dailyLongIdle = ratio(dailyTotals.long_idle_sec, dailyTotals.total_sec)
  const dailyGo = ratio(dailyTotals.go_sec, dailyTotals.total_sec)

  const zoneTotalSec = useMemo(() => zoneRows.reduce((sum, row) => sum + row.sec, 0), [zoneRows])

  const idleByZone = useMemo(() => {
    const map = new Map<string, { zonaName: string; minutes: number; count: number; alert: boolean }>()
    for (const episode of idleEpisodes) {
      const key = episode.zonaName
      const current = map.get(key) ?? { zonaName: key, minutes: 0, count: 0, alert: isAlertZone(episode.ble_tag_zone) }
      current.minutes += episode.duration_min
      current.count += 1
      map.set(key, current)
    }
    return [...map.values()].sort((left, right) => right.minutes - left.minutes)
  }, [idleEpisodes])

  const idleTotalMin = useMemo(() => idleEpisodes.reduce((sum, e) => sum + e.duration_min, 0), [idleEpisodes])

  const selectedWeekMeta = availableWeeks.find((week) => week.week_start === selectedWeek) ?? null

  const sortedShiftRows = useMemo(() => {
    return [...detailShiftRows].sort((left, right) => {
      const leftValue =
        sortKey === 'productivity'
          ? getRowProductivity(left)
          : sortKey === 'supervisor_name'
            ? left.supervisor_name ?? NO_SUPERVISOR
            : sortKey === 'full_name'
              ? left.full_name
              : left[sortKey]
      const rightValue =
        sortKey === 'productivity'
          ? getRowProductivity(right)
          : sortKey === 'supervisor_name'
            ? right.supervisor_name ?? NO_SUPERVISOR
            : sortKey === 'full_name'
              ? right.full_name
              : right[sortKey]

      if (typeof leftValue === 'string' && typeof rightValue === 'string') {
        return sortDirection === 'asc' ? leftValue.localeCompare(rightValue, 'ru') : rightValue.localeCompare(leftValue, 'ru')
      }

      return sortDirection === 'asc'
        ? Number(leftValue ?? 0) - Number(rightValue ?? 0)
        : Number(rightValue ?? 0) - Number(leftValue ?? 0)
    })
  }, [detailShiftRows, sortKey, sortDirection])

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

  return (
    <>
      <section className="hero-block dashboard-hero reveal-block">
        <p className="hero-copy hero-copy-compact">
          Дашборд разбит на пять блоков: ежедневная сводка, еженедельная аналитика, динамика активности, местоположение и простои и детализация по сотрудникам.
        </p>
      </section>

      {bootstrapError ? (
        <section className="empty-state error-state">Ошибка загрузки: {bootstrapError}</section>
      ) : null}

      {/* БЛОК 1 — ЕЖЕДНЕВНАЯ АНАЛИТИКА */}
      <CollapsibleBlock
        kicker="Блок 1 · Ежедневно"
        title="Ежедневная аналитика"
        description="Сколько человек вышло на смену по бригадам, активность, слабая активность, длительный простой и ходьба между зонами за выбранный день. Проценты считаются от общего времени трекинга."
      >
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
          <div className="filter-caption">
            <span>Выбранный день</span>
            <strong>{selectedDate ? formatFullDate(selectedDate) : '—'}</strong>
          </div>
        </div>

        {dailyLoading ? <div className="empty-state">Загружаем дневную аналитику...</div> : null}
        {dailyError ? <div className="empty-state error-state">Ошибка: {dailyError}</div> : null}

        {!dailyLoading && !dailyError && dailyRows.length === 0 ? (
          <div className="empty-state">Нет данных за выбранный день.</div>
        ) : null}

        {!dailyLoading && !dailyError && dailyRows.length > 0 ? (
          <>
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
                <p className="metric-note">бездействие от 10 минут, от общего времени</p>
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
            </div>

            <div className="brigade-grid">
              {dailyRows.map((brigade) => (
                <article className="brigade-card" key={brigade.supervisor_name}>
                  <div className="brigade-card-head">
                    <div>
                      <strong>{brigade.supervisor_name}</strong>
                      <p>{formatBrigadeShiftHeadcount(brigade.supervisor_name, brigade.workers)} на смене</p>
                    </div>
                    <div className={`brigade-badge${brigade.activity_pct < 40 ? ' brigade-badge-warn' : ''}`}>
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

            <TopActivityPanel
              employees={topDaily}
              periodLabel="за день"
              open={topDailyOpen}
              onToggle={() => setTopDailyOpen((current) => !current)}
            />

            <AttentionPanel
              employees={lowActivityDaily}
              open={attentionOpen}
              onToggle={() => setAttentionOpen((current) => !current)}
              emptyMessage="Нет сотрудников с активностью ниже 30% за этот день."
              periodLabel="за день"
            />

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
          </>
        ) : null}
      </CollapsibleBlock>

      {/* БЛОК 2 — ЕЖЕНЕДЕЛЬНАЯ АНАЛИТИКА */}
      <CollapsibleBlock
        kicker="Блок 2 · Еженедельно"
        title="Еженедельная аналитика"
        description="Сводка по бригадам за неделю (Пн–Вс): среднесписочная численность, активность, слабая активность, длительный простой и ходьба."
      >
        <div className="filter-row">
          <label className="filter-field">
            <span>Неделя</span>
            <select value={selectedWeek} onChange={(event) => setSelectedWeek(event.target.value)}>
              {availableWeeks.map((week) => (
                <option key={week.week_start} value={week.week_start}>
                  {formatWeekRange(week.week_start, week.week_end)}
                </option>
              ))}
            </select>
          </label>
          <div className="filter-caption">
            <span>Период</span>
            <strong>{selectedWeekMeta ? formatWeekRange(selectedWeekMeta.week_start, selectedWeekMeta.week_end) : '—'}</strong>
          </div>
        </div>

        {weeklyLoading ? <div className="empty-state">Загружаем недельную аналитику...</div> : null}
        {weeklyError ? <div className="empty-state error-state">Ошибка: {weeklyError}</div> : null}

        {!weeklyLoading && !weeklyError && weeklyRows.length === 0 ? (
          <div className="empty-state">Нет данных за выбранную неделю.</div>
        ) : null}

        {!weeklyLoading && !weeklyError && weeklyRows.length > 0 ? (
          <div className="brigade-grid">
            {weeklyRows.map((brigade) => (
              <article className="brigade-card" key={brigade.supervisor_name}>
                <div className="brigade-card-head">
                  <div>
                    <strong>{brigade.supervisor_name}</strong>
                    <p>≈ {brigade.avg_workers} чел./день · {brigade.unique_employees} уникальных</p>
                  </div>
                  <div className={`brigade-badge${brigade.activity_pct < 40 ? ' brigade-badge-warn' : ''}`}>
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
                  <div className={`brigade-stat${brigade.kpp_shifts > 0 ? ' brigade-stat-alert' : ''}`}>
                    <span>Замечены на КПП</span>
                    <strong>{brigade.kpp_shifts > 0 ? brigade.kpp_shifts : 'нет'}</strong>
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

        {!weeklyLoading && !weeklyError && weeklyRows.length > 0 ? (
          <TopActivityPanel
            employees={topWeekly}
            periodLabel="за неделю"
            open={topWeeklyOpen}
            onToggle={() => setTopWeeklyOpen((current) => !current)}
          />
        ) : null}

        {!weeklyLoading && !weeklyError && weeklyRows.length > 0 ? (
          <AttentionPanel
            employees={lowActivityWeekly}
            open={weeklyAttentionOpen}
            onToggle={() => setWeeklyAttentionOpen((current) => !current)}
            emptyMessage="Нет сотрудников со средней активностью ниже 30% за неделю."
            periodLabel="за неделю"
          />
        ) : null}
      </CollapsibleBlock>

      {/* БЛОК 3 — ДИНАМИКА АКТИВНОСТИ */}
      <CollapsibleBlock
        kicker="Блок 3 · Динамика"
        title="Динамика показателей активности"
        description="Сравнение активности бригад Джалол и ЛИ СОН ХАК: выбранный день против вчера и тренд за 7 дней."
      >
        <div className="filter-row">
          <label className="filter-field">
            <span>Дата</span>
            <select value={dynamicsDate} onChange={(event) => setDynamicsDate(event.target.value)}>
              {availableDates.map((date) => (
                <option key={date} value={date}>
                  {date}
                </option>
              ))}
            </select>
          </label>
          <div className="filter-caption">
            <span>Выбранный день</span>
            <strong>{dynamicsDate ? formatFullDate(dynamicsDate) : '—'}</strong>
          </div>
        </div>

        {dynamicsLoading ? <div className="empty-state">Загружаем динамику активности...</div> : null}
        {dynamicsError ? <div className="empty-state error-state">Ошибка: {dynamicsError}</div> : null}

        {!dynamicsLoading && !dynamicsError && dynamicsDate ? (
          <ActivityDynamicsPanel referenceDate={dynamicsDate} cards={dynamicsCards} />
        ) : null}
      </CollapsibleBlock>

      {/* БЛОК 4 — МЕСТОПОЛОЖЕНИЕ И ПРОСТОИ */}
      <CollapsibleBlock
        kicker="Блок 4 · Зоны"
        title="Местоположение и простои"
        description="Где сотрудники проводили время за день и эпизоды длительного бездействия от 10 минут с привязкой к зоне."
      >
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
          <div className="filter-caption">
            <span>Выбранный день</span>
            <strong>{selectedDate ? formatFullDate(selectedDate) : '—'}</strong>
          </div>
        </div>

        {dailyLoading ? <div className="empty-state">Загружаем данные по зонам и простоям...</div> : null}
        {dailyError ? <div className="empty-state error-state">Ошибка: {dailyError}</div> : null}

        {!dailyLoading && !dailyError && selectedDate ? (
          <div className="zones-idle-grid">
            <div className="zone-panel">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">Местоположение</p>
                  <h3>Распределение времени по зонам</h3>
                  <p className="panel-description">Где сотрудники проводили время за день.</p>
                </div>
              </div>
              {zoneRows.length > 0 ? (
                <div className="zone-list">
                  {zoneRows.map((zone) => (
                    <div className={`zone-row${isAlertZone(zone.zona) ? ' zone-row-alert' : ''}`} key={zone.zona}>
                      <div className="zone-row-head">
                        <span className="zone-name">{zone.zonaName}</span>
                        <span className="zone-value">{formatPercent(ratio(zone.sec, zoneTotalSec))}</span>
                      </div>
                      <div className="zone-bar">
                        <div
                          className={`zone-bar-fill${isAlertZone(zone.zona) ? ' zone-bar-fill-alert' : ''}`}
                          style={{ width: `${Math.max(ratio(zone.sec, zoneTotalSec), 1)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="kpp-empty">Нет данных по зонам за выбранный день.</p>
              )}
            </div>

            <div className={`zone-panel${idleEpisodes.length > 0 ? ' kpp-panel-alert' : ''}`}>
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">Простои</p>
                  <h3>Длительные простои</h3>
                  <p className="panel-description">Эпизоды бездействия от 10 минут с привязкой к зоне.</p>
                </div>
                {idleEpisodes.length > 0 ? (
                  <div className="zone-summary">
                    <strong>{idleEpisodes.length}</strong>
                    <span>эпизодов · {formatMinutes(idleTotalMin * 60)}</span>
                  </div>
                ) : null}
              </div>
              {idleEpisodes.length > 0 ? (
                <div className="zone-list">
                  {idleByZone.map((zone) => (
                    <div className={`zone-row${zone.alert ? ' zone-row-alert' : ''}`} key={zone.zonaName}>
                      <div className="zone-row-head">
                        <span className="zone-name">{zone.zonaName}</span>
                        <span className="zone-value">{zone.count} эп. · {zone.minutes} мин</span>
                      </div>
                      <div className="zone-bar">
                        <div
                          className={`zone-bar-fill${zone.alert ? ' zone-bar-fill-alert' : ''}`}
                          style={{ width: `${Math.max(ratio(zone.minutes, idleTotalMin), 1)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="kpp-empty">Данные о длительных простоях за этот день не загружены или простоев нет.</p>
              )}
            </div>
          </div>
        ) : null}
      </CollapsibleBlock>

      {/* БЛОК 5 — ДЕТАЛИЗАЦИЯ */}
      <CollapsibleBlock
        kicker="Блок 5 · Детализация"
        title="Расшифровка по сотрудникам"
        description="Полная таблица смен за выбранный день: работа, слабая активность, длительный простой, всего, активность и КПП."
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
          <div className="filter-caption">
            <span>Выбранный день</span>
            <strong>{detailDate ? formatFullDate(detailDate) : '—'}</strong>
          </div>
        </div>

        {detailLoading ? <div className="empty-state">Загружаем детализацию...</div> : null}
        {detailError ? <div className="empty-state error-state">Ошибка: {detailError}</div> : null}

        {!detailLoading && !detailError && detailShiftRows.length > 0 ? (
          <article className="panel panel-wide">
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
                    <th><button type="button" className="sort-button" onClick={() => toggleSort('full_name', 'asc')}>{sortLabel(uiText.table.worker, 'full_name')}</button></th>
                    <th><button type="button" className="sort-button" onClick={() => toggleSort('supervisor_name', 'asc')}>{sortLabel(uiText.table.supervisor, 'supervisor_name')}</button></th>
                    <th><button type="button" className="sort-button" onClick={() => toggleSort('work_sec_total')}>{sortLabel(uiText.table.work, 'work_sec_total')}</button></th>
                    <th><button type="button" className="sort-button" onClick={() => toggleSort('weak_activity_sec_total')}>Слабая активность</button></th>
                    <th><button type="button" className="sort-button" onClick={() => toggleSort('long_idle_sec_total')}>Длительный простой</button></th>
                    <th><button type="button" className="sort-button" onClick={() => toggleSort('total_sec_total')}>{sortLabel(uiText.table.total, 'total_sec_total')}</button></th>
                    <th><button type="button" className="sort-button" onClick={() => toggleSort('productivity')}>{sortLabel(uiText.table.activity, 'productivity')}</button></th>
                    <th><button type="button" className="sort-button" onClick={() => toggleSort('kpp_sec_total')}>{sortLabel('КПП', 'kpp_sec_total')}</button></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedShiftRows.map((row) => (
                    <tr key={row.ww_shift_id} className={row.kpp_sec_total > 0 ? 'row-alert' : undefined}>
                      <td>
                        <div className="employee-cell">
                          <strong>{row.full_name}</strong>
                          <span>#{row.employee_number}</span>
                        </div>
                      </td>
                      <td>{row.supervisor_name ?? NO_SUPERVISOR}</td>
                      <td>{formatSeconds(row.work_sec_total)}</td>
                      <td>{formatSeconds(row.weak_activity_sec_total)}</td>
                      <td>{formatSeconds(row.long_idle_sec_total)}</td>
                      <td>{formatSeconds(row.total_sec_total)}</td>
                      <td>{formatPercent(getRowProductivity(row))}</td>
                      <td>{row.kpp_sec_total > 0 ? 'да' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        ) : null}

        {!detailLoading && !detailError && detailDate && detailShiftRows.length === 0 ? (
          <div className="empty-state">Нет смен за выбранный день.</div>
        ) : null}
      </CollapsibleBlock>
    </>
  )
}
