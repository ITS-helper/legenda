import { useEffect, useMemo, useState } from 'react'
import type { UiText } from '../content/uiText'
import { CollapsibleBlock } from '../components/CollapsibleBlock'
import { SendReportControl } from '../components/SendReportControl'
import {
  formatFullDate,
  formatMinutes,
  formatPercent,
  formatSeconds,
  formatWeekRange,
  loadAvailableDates,
  loadAvailableWeeks,
  loadBrigadeDaily,
  loadBrigadeWeekly,
  loadIdleEpisodes,
  loadKppEmployees,
  loadShiftRows,
  loadZoneDaily,
  ratio,
  sumDaily,
  type BrigadeDailyRow,
  type BrigadeWeeklyRow,
  type IdleEpisode,
  type KppEmployee,
  type ShiftMetricRow,
  type ZoneDailyRow,
} from '../lib/reports'
import { isAlertZone } from '../lib/zones'

type SortKey = 'full_name' | 'supervisor_name' | 'work_sec_total' | 'idle_sec_total' | 'total_sec_total' | 'productivity' | 'kpp_sec_total'
type SortDirection = 'asc' | 'desc'

const NO_SUPERVISOR = 'Без начальника'

function getRowProductivity(row: ShiftMetricRow) {
  return ratio(row.work_sec_total, row.total_sec_total)
}

function StructureBar({ workSec, idleSec, goSec, totalSec }: { workSec: number; idleSec: number; goSec: number; totalSec: number }) {
  const workWidth = `${ratio(workSec, totalSec)}%`
  const idleWidth = `${ratio(idleSec, totalSec)}%`
  const goWidth = `${ratio(goSec, totalSec)}%`
  return (
    <div className="structure-bar">
      <div className="structure-segment structure-work" style={{ width: workWidth }} title="Работа" />
      <div className="structure-segment structure-idle" style={{ width: idleWidth }} title="Простой" />
      <div className="structure-segment structure-go" style={{ width: goWidth }} title="Ходьба между зонами" />
    </div>
  )
}

function StructureLegend() {
  return (
    <div className="structure-legend">
      <span><i className="legend-dot structure-work" /> Работа</span>
      <span><i className="legend-dot structure-idle" /> Простой</span>
      <span><i className="legend-dot structure-go" /> Ходьба между зонами</span>
    </div>
  )
}

export function DashboardPage({ uiText }: { uiText: UiText }) {
  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [availableWeeks, setAvailableWeeks] = useState<{ week_start: string; week_end: string }[]>([])
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedWeek, setSelectedWeek] = useState('')

  const [dailyRows, setDailyRows] = useState<BrigadeDailyRow[]>([])
  const [kppEmployees, setKppEmployees] = useState<KppEmployee[]>([])
  const [shiftRows, setShiftRows] = useState<ShiftMetricRow[]>([])
  const [zoneRows, setZoneRows] = useState<ZoneDailyRow[]>([])
  const [idleEpisodes, setIdleEpisodes] = useState<IdleEpisode[]>([])
  const [weeklyRows, setWeeklyRows] = useState<BrigadeWeeklyRow[]>([])

  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const [dailyLoading, setDailyLoading] = useState(true)
  const [dailyError, setDailyError] = useState<string | null>(null)
  const [weeklyLoading, setWeeklyLoading] = useState(true)
  const [weeklyError, setWeeklyError] = useState<string | null>(null)

  const [sortKey, setSortKey] = useState<SortKey>('productivity')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      try {
        const [dates, weeks] = await Promise.all([loadAvailableDates(), loadAvailableWeeks()])
        if (cancelled) return
        setAvailableDates(dates)
        setAvailableWeeks(weeks)
        setSelectedDate((current) => current || dates[0] || '')
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
        if (cancelled) return
        setWeeklyRows(brigades)
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
  }, [selectedWeek])

  const dailyTotals = useMemo(() => sumDaily(dailyRows), [dailyRows])
  const dailyActivity = ratio(dailyTotals.work_sec, dailyTotals.total_sec)
  const dailyIdle = ratio(dailyTotals.idle_sec, dailyTotals.total_sec)
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
    return [...shiftRows].sort((left, right) => {
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
  }, [shiftRows, sortKey, sortDirection])

  const topWorkers = useMemo(
    () =>
      [...shiftRows]
        .map((row) => ({ ...row, productivity: getRowProductivity(row) }))
        .sort((left, right) => right.productivity - left.productivity)
        .slice(0, 5),
    [shiftRows],
  )

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
        <p className="eyebrow">{uiText.brand}</p>
        <h1>Аналитика смен и рассылки</h1>
        <p className="hero-copy">
          Дашборд разбит на три блока: ежедневная сводка для рассылки, еженедельная аналитика и детализация по сотрудникам.
          Дневной и недельный блоки можно отправить заказчику на почту прямо отсюда.
        </p>
      </section>

      {bootstrapError ? (
        <section className="empty-state error-state">Ошибка загрузки: {bootstrapError}</section>
      ) : null}

      {/* БЛОК 1 — ЕЖЕДНЕВНАЯ АНАЛИТИКА */}
      <CollapsibleBlock
        kicker="Блок 1 · Ежедневно"
        title="Ежедневная аналитика"
        description="Сколько человек вышло на смену по бригадам, активность (work_sec), простой (idle_sec) и ходьба (go_sec) за выбранный день. Проценты считаются от общего времени трекинга. Этот блок уходит в ежедневную рассылку."
        actions={<SendReportControl type="daily" date={selectedDate} disabled={!selectedDate} />}
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
                <strong className="metric-value">{dailyTotals.workers}</strong>
                <p className="metric-note">человек по всем бригадам</p>
              </article>
              <article className="metric-card">
                <span className="metric-label">Активность</span>
                <strong className="metric-value">{formatPercent(dailyActivity)}</strong>
                <p className="metric-note">активная работа (work_sec) от общего времени</p>
              </article>
              <article className="metric-card">
                <span className="metric-label">Простой</span>
                <strong className="metric-value">{formatPercent(dailyIdle)}</strong>
                <p className="metric-note">бездействие (idle_sec), включая слабую активность</p>
              </article>
              <article className="metric-card">
                <span className="metric-label">Ходьба между зонами</span>
                <strong className="metric-value">{formatPercent(dailyGo)}</strong>
                <p className="metric-note">перемещения (go_sec) от общего времени</p>
              </article>
              <article className={`metric-card${dailyTotals.kpp_workers > 0 ? ' metric-card-alert' : ''}`}>
                <span className="metric-label">Были на КПП</span>
                <strong className="metric-value">{dailyTotals.kpp_workers}</strong>
                <p className="metric-note">{dailyTotals.kpp_workers > 0 ? `в зоне КПП (zona 13), суммарно ${formatMinutes(dailyTotals.kpp_sec)}` : 'в зоне КПП (zona 13) никого'}</p>
              </article>
            </div>

            <div className="brigade-grid">
              {dailyRows.map((brigade) => (
                <article className="brigade-card" key={brigade.supervisor_name}>
                  <div className="brigade-card-head">
                    <div>
                      <strong>{brigade.supervisor_name}</strong>
                      <p>{brigade.workers} человек на смене</p>
                    </div>
                    <div className={`brigade-badge${brigade.activity_pct < 40 ? ' brigade-badge-warn' : ''}`}>
                      {formatPercent(brigade.activity_pct)}
                    </div>
                  </div>
                  <StructureBar workSec={brigade.work_sec} idleSec={brigade.idle_sec} goSec={brigade.go_sec} totalSec={brigade.total_sec} />
                  <StructureLegend />
                  <div className="brigade-stats-grid">
                    <div className="brigade-stat">
                      <span>Активность</span>
                      <strong>{formatPercent(brigade.activity_pct)}</strong>
                    </div>
                    <div className="brigade-stat">
                      <span>Простой</span>
                      <strong>{formatPercent(brigade.idle_pct)}</strong>
                    </div>
                    <div className="brigade-stat">
                      <span>Ходьба между зонами</span>
                      <strong>{formatPercent(brigade.go_pct)}</strong>
                    </div>
                    <div className={`brigade-stat${brigade.kpp_workers > 0 ? ' brigade-stat-alert' : ''}`}>
                      <span>На КПП</span>
                      <strong>{brigade.kpp_workers > 0 ? `${brigade.kpp_workers} чел.` : 'нет'}</strong>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <div className={`kpp-panel${kppEmployees.length > 0 ? ' kpp-panel-alert' : ''}`}>
              <div className="kpp-panel-head">
                <div>
                  <p className="panel-kicker">Контроль КПП</p>
                  <h3>{kppEmployees.length > 0 ? 'Сотрудники в зоне КПП' : 'На КПП никого не было'}</h3>
                </div>
                {kppEmployees.length > 0 ? <span className="kpp-count">{kppEmployees.length}</span> : null}
              </div>
              {kppEmployees.length > 0 ? (
                <div className="kpp-list">
                  {kppEmployees.map((employee) => (
                    <div className="kpp-row" key={employee.ww_shift_id}>
                      <div className="kpp-main">
                        <strong>{employee.full_name}</strong>
                        <span>
                          #{employee.employee_number} · {employee.supervisor_name}
                        </span>
                      </div>
                      <div className="kpp-time">{formatMinutes(employee.kpp_sec)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="kpp-empty">Никто не фиксировался в зоне КПП (зона 13) за этот день.</p>
              )}
            </div>

            <div className="zone-panel">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">Местоположение</p>
                  <h3>Распределение времени по зонам</h3>
                  <p className="panel-description">Где сотрудники проводили время за день (по BLE-меткам, zona).</p>
                </div>
              </div>
              {zoneRows.length > 0 ? (
                <div className="zone-list">
                  {zoneRows.map((zone) => (
                    <div className={`zone-row${isAlertZone(zone.zona) ? ' zone-row-alert' : ''}`} key={zone.zona}>
                      <div className="zone-row-head">
                        <span className="zone-name">{zone.zonaName}</span>
                        <span className="zone-value">{formatSeconds(zone.sec)} · {formatPercent(ratio(zone.sec, zoneTotalSec))}</span>
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
                  <p className="panel-kicker">Отчёт 10</p>
                  <h3>Длительные простои</h3>
                  <p className="panel-description">Эпизоды бездействия от 5 минут с привязкой к зоне.</p>
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
                <p className="kpp-empty">Отчёт 10 за этот день не загружен или простоев нет.</p>
              )}
            </div>
          </>
        ) : null}
      </CollapsibleBlock>

      {/* БЛОК 2 — ЕЖЕНЕДЕЛЬНАЯ АНАЛИТИКА */}
      <CollapsibleBlock
        kicker="Блок 2 · Еженедельно"
        title="Еженедельная аналитика"
        description="Сводка по бригадам за неделю (Пн–Вс): среднесписочная численность, активность, простой и ходьба. Этот блок уходит в еженедельную рассылку по понедельникам."
        actions={<SendReportControl type="weekly" weekStart={selectedWeek} disabled={!selectedWeek} />}
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
                <StructureBar workSec={brigade.work_sec} idleSec={brigade.idle_sec} goSec={brigade.go_sec} totalSec={brigade.total_sec} />
                <StructureLegend />
                <div className="brigade-stats-grid">
                  <div className="brigade-stat">
                    <span>Активность</span>
                    <strong>{formatPercent(brigade.activity_pct)}</strong>
                  </div>
                  <div className="brigade-stat">
                    <span>Простой</span>
                    <strong>{formatPercent(brigade.idle_pct)}</strong>
                  </div>
                  <div className="brigade-stat">
                    <span>Ходьба между зонами</span>
                    <strong>{formatPercent(brigade.go_pct)}</strong>
                  </div>
                  <div className="brigade-stat">
                    <span>Дней в отчёте</span>
                    <strong>{brigade.days}</strong>
                  </div>
                  <div className={`brigade-stat${brigade.kpp_shifts > 0 ? ' brigade-stat-alert' : ''}`}>
                    <span>Смены на КПП</span>
                    <strong>{brigade.kpp_shifts > 0 ? brigade.kpp_shifts : 'нет'}</strong>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </CollapsibleBlock>

      {/* БЛОК 3 — ДЕТАЛИЗАЦИЯ */}
      <CollapsibleBlock
        kicker="Блок 3 · Детализация"
        title="Расшифровка по сотрудникам"
        description="Полная таблица смен за выбранный день (работа / простой / всего / активность / КПП) и топ по активности. Не входит в рассылку."
        defaultOpen={false}
      >
        {dailyLoading ? <div className="empty-state">Загружаем детализацию...</div> : null}

        {!dailyLoading && shiftRows.length > 0 ? (
          <div className="detail-grid">
            <article className="panel">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">Топ 5</p>
                  <h2>Самые активные смены</h2>
                </div>
              </div>
              <div className="leaderboard">
                {topWorkers.map((row, index) => (
                  <div className="leader-row" key={row.ww_shift_id}>
                    <span className="leader-rank">{String(index + 1).padStart(2, '0')}</span>
                    <div className="leader-main">
                      <strong>{row.full_name}</strong>
                      <p>{row.supervisor_name ?? NO_SUPERVISOR}</p>
                    </div>
                    <div className="leader-metric">
                      <strong>{formatPercent(row.productivity)}</strong>
                      <span>{formatSeconds(row.work_sec_total)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </article>

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
                      <th><button type="button" className="sort-button" onClick={() => toggleSort('idle_sec_total')}>{sortLabel(uiText.table.idle, 'idle_sec_total')}</button></th>
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
                        <td>{formatSeconds(row.idle_sec_total)}</td>
                        <td>{formatSeconds(row.total_sec_total)}</td>
                        <td>{formatPercent(getRowProductivity(row))}</td>
                        <td>{row.kpp_sec_total > 0 ? formatMinutes(row.kpp_sec_total) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        ) : null}

        {!dailyLoading && shiftRows.length === 0 ? <div className="empty-state">Нет смен за выбранный день.</div> : null}
      </CollapsibleBlock>
    </>
  )
}
