import { useEffect, useMemo, useState } from 'react'
import { MetricDeepDivePanel } from '../components/MetricDeepDivePanel'
import { MskTimeInput } from '../components/MskTimeInput'
import { getMetricDeepDive } from '../content/metricDeepDives'
import { useAuth } from '../context/AuthContext'
import { useMetricSettings } from '../context/MetricSettingsContext'
import {
  DEFAULT_SUBBLOCK_VISIBILITY,
  getSubblocksForBlock,
  type SubblockId,
} from '../content/dashboardSubblocks'
import {
  blockSettingsKey,
  getDashboardBlock,
  METRIC_BLOCK_ID_BY_TITLE,
} from '../content/dashboardBlocks'
import {
  METRIC_BLOCKS,
  METRIC_DEFINITIONS,
  type MetricDefinition,
} from '../content/metricDefinitions'
import {
  areMetricSettingsEqual,
  cloneMetricSettings,
  DEFAULT_METRIC_SETTINGS,
  saveMetricSettings,
  type BooleanBlockSettingKey,
  type MetricSettings,
  type NumericMetricSettingKey,
} from '../lib/metricSettings'
import {
  brigadesSectionMatchesSearch,
  buildDefaultOpenSections,
  CollapsibleMetricSection,
  METRIC_SETTINGS_BRIGADES_SECTION_ID,
  metricBlockSectionId,
  metricBlockDisplayTitle,
  metricMatchesSearch,
} from '../lib/metricSettingsPageUi'
import { brigadeNamesMatch, loadAvailableSupervisorNames, loadAvailableProfessions } from '../lib/reports'
import {
  DEFAULT_ZONE_VISIBILITY,
  ZONE_IDS,
  zoneVisibilityLabel,
} from '../lib/zoneVisibility'
import { NotWornProfessionRulesEditor } from '../components/NotWornProfessionRulesEditor'

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

const LEAVE_CONFIRM_MESSAGE = 'Есть несохранённые изменения. Уйти без сохранения?'

function parseConfigInput(_key: NumericMetricSettingKey, raw: string) {
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null
}

function MetricCard({
  metric,
  settings,
  onChange,
}: {
  metric: MetricDefinition
  settings: MetricSettings
  onChange: (key: NumericMetricSettingKey, value: number) => void
}) {
  return (
    <article className="metric-settings-card" id={`metric-card-${metric.id}`}>
      <header className="metric-settings-card-head">
        <h4>{metric.title}</h4>
      </header>
      <p className="metric-settings-desc">{metric.description}</p>

      <div className="metric-settings-block">
        <p className="metric-settings-label">Откуда берётся</p>
        <ul className="metric-settings-list">
          {metric.sources.map((source) => (
            <li key={source}>{source}</li>
          ))}
        </ul>
      </div>

      <div className="metric-settings-block">
        <p className="metric-settings-label">Формула</p>
        <pre className="metric-settings-formula">{metric.formula}</pre>
      </div>

      {metric.notes ? <p className="metric-settings-note">{metric.notes}</p> : null}

      {(() => {
        const DeepDive = getMetricDeepDive(metric.id)
        return DeepDive ? (
          <MetricDeepDivePanel>
            <DeepDive />
          </MetricDeepDivePanel>
        ) : null
      })()}

      {metric.configFields && metric.configFields.length > 0 ? (
        <div className="metric-settings-config">
          <p className="metric-settings-label">Настройка</p>
          <div className="metric-settings-config-grid">
            {metric.configFields.map((field) => {
              const value = settings[field.key]
              const isTime = field.key === 'kppLunchStartMin' || field.key === 'kppLunchEndMin'
              return (
                <label key={`${metric.id}-${field.key}`} className="metric-settings-field">
                  <span>{field.label}</span>
                  <div className="metric-settings-field-row">
                    {isTime ? (
                      <MskTimeInput
                        value={value as number}
                        min={field.min}
                        max={field.max}
                        onChange={(minutes) => onChange(field.key, minutes)}
                      />
                    ) : (
                      <>
                        <input
                          type="number"
                          min={field.min}
                          max={field.max}
                          step={field.step ?? 1}
                          value={value as number}
                          onChange={(event) => {
                            const parsed = parseConfigInput(field.key, event.target.value)
                            if (parsed != null) onChange(field.key, parsed)
                          }}
                        />
                        {field.unit ? <span className="metric-settings-unit">{field.unit}</span> : null}
                      </>
                    )}
                  </div>
                  {field.hint ? <small className="metric-settings-hint">{field.hint}</small> : null}
                </label>
              )
            })}
          </div>
        </div>
      ) : null}
    </article>
  )
}

export function MetricSettingsPage() {
  const { password } = useAuth()
  const { settings: published, refresh, setLocalSettings } = useMetricSettings()
  const [draft, setDraft] = useState<MetricSettings>(published)
  const [availableSupervisors, setAvailableSupervisors] = useState<string[]>([])
  const [availableProfessions, setAvailableProfessions] = useState<string[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [openSections, setOpenSections] = useState(buildDefaultOpenSections)

  useEffect(() => {
    setDraft(published)
  }, [published])

  useEffect(() => {
    let cancelled = false

    async function loadSupervisors() {
      try {
        const [names, professions] = await Promise.all([
          loadAvailableSupervisorNames(),
          loadAvailableProfessions(),
        ])
        if (!cancelled) {
          setAvailableSupervisors(names)
          setAvailableProfessions(professions)
        }
      } catch {
        if (!cancelled) {
          setAvailableSupervisors([])
          setAvailableProfessions([])
        }
      }
    }

    void loadSupervisors()
    return () => {
      cancelled = true
    }
  }, [])

  const normalizedSearch = searchQuery.trim().toLowerCase()
  const isSearching = normalizedSearch.length > 0
  const isDirty = useMemo(() => !areMetricSettingsEqual(draft, published), [draft, published])

  useEffect(() => {
    if (!isDirty) return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  useEffect(() => {
    if (!isDirty) return

    const handleNavigationClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return

      const link = target.closest('.topbar-link')
      if (!link) return

      const href = link.getAttribute('href')
      if (href === '#/metrics') return

      if (!window.confirm(LEAVE_CONFIRM_MESSAGE)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    document.addEventListener('click', handleNavigationClick, true)
    return () => document.removeEventListener('click', handleNavigationClick, true)
  }, [isDirty])

  const visibleMetricsByBlock = useMemo(() => {
    const map = new Map<string, MetricDefinition[]>()
    for (const block of METRIC_BLOCKS) {
      const metrics = METRIC_DEFINITIONS.filter(
        (metric) => metric.block === block && metricMatchesSearch(metric, normalizedSearch),
      )
      map.set(block, metrics)
    }
    return map
  }, [normalizedSearch])

  const visibleMetricCount = useMemo(() => {
    return [...visibleMetricsByBlock.values()].reduce((sum, metrics) => sum + metrics.length, 0)
  }, [visibleMetricsByBlock])

  const showBrigadesSection = brigadesSectionMatchesSearch(normalizedSearch)

  function updateField(key: NumericMetricSettingKey, value: number) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function updateBlockEnabled(blockKey: BooleanBlockSettingKey, enabled: boolean) {
    setDraft((current) => ({ ...current, [blockKey]: enabled }))
  }

  function toggleComparisonBrigade(name: string, checked: boolean) {
    setDraft((current) => {
      if (checked) {
        if (current.comparisonBrigades.some((brigade) => brigadeNamesMatch(brigade, name))) {
          return current
        }
        return {
          ...current,
          comparisonBrigades: [...current.comparisonBrigades, name].sort((left, right) =>
            left.localeCompare(right, 'ru'),
          ),
        }
      }

      const next = current.comparisonBrigades.filter((brigade) => !brigadeNamesMatch(brigade, name))
      if (next.length === 0) return current
      return { ...current, comparisonBrigades: next }
    })
  }

  function updateSubblockEnabled(subblockId: SubblockId, enabled: boolean) {
    setDraft((current) => ({
      ...current,
      subblockVisibility: {
        ...current.subblockVisibility,
        [subblockId]: enabled,
      },
    }))
  }

  function updateZoneVisibility(zoneId: number, enabled: boolean) {
    setDraft((current) => {
      const next = { ...current.zoneVisibility, [zoneId]: enabled }
      const enabledCount = ZONE_IDS.filter((id) => next[id] !== false).length
      if (enabledCount === 0) return current
      return { ...current, zoneVisibility: next }
    })
  }

  function updateNotWornProfessionRules(rules: MetricSettings['notWornProfessionRules']) {
    setDraft((current) => ({ ...current, notWornProfessionRules: rules }))
  }

  function toggleSection(sectionId: string) {
    setOpenSections((current) => ({ ...current, [sectionId]: !current[sectionId] }))
  }

  function expandAllSections() {
    setOpenSections(() => {
      const next = buildDefaultOpenSections()
      for (const key of Object.keys(next)) next[key] = true
      return next
    })
  }

  function collapseAllSections() {
    setOpenSections(() => {
      const next = buildDefaultOpenSections()
      for (const key of Object.keys(next)) next[key] = false
      return next
    })
  }

  function scrollToSection(sectionId: string) {
    setOpenSections((current) => ({ ...current, [sectionId]: true }))
    window.requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const supervisorOptions = [...new Set([...availableSupervisors, ...draft.comparisonBrigades])].sort((left, right) =>
    left.localeCompare(right, 'ru'),
  )

  async function handleSave() {
    try {
      setBusy(true)
      setError(false)
      setStatus(null)
      const saved = await saveMetricSettings(draft, password ?? '')
      setLocalSettings(saved)
      await refresh()
      setStatus('Настройки сохранены. Дашборд и рассылка применят изменения при следующей загрузке.')
    } catch (saveError) {
      setError(true)
      setStatus(getErrorMessage(saveError))
    } finally {
      setBusy(false)
    }
  }

  function handleRevert() {
    setDraft(cloneMetricSettings(published))
    setStatus('Изменения отменены')
    setError(false)
  }

  function handleReset() {
    setDraft({
      ...DEFAULT_METRIC_SETTINGS,
      comparisonBrigades: [...DEFAULT_METRIC_SETTINGS.comparisonBrigades],
      subblockVisibility: { ...DEFAULT_SUBBLOCK_VISIBILITY },
      zoneVisibility: { ...DEFAULT_ZONE_VISIBILITY },
    })
    setStatus('Сброшено к значениям по умолчанию (ещё не сохранено)')
    setError(false)
  }

  return (
    <section className="editor-panel settings-page metric-settings-page">
      <div className="editor-panel-head settings-head">
        <div>
          <p className="panel-kicker">Справочник</p>
          <h2>Настройки метрик</h2>
          <p>
            Описание каждой метрики дашборда: источник данных, формула расчёта и настраиваемые пороги.
            Блок и отдельные подблоки (например «Требуют внимания») можно отключить — они исчезнут с дашборда.
          </p>
        </div>
        <div className="editor-actions">
          {isDirty ? (
            <span className="metric-settings-dirty-badge">Есть несохранённые изменения</span>
          ) : null}
          <button type="button" className="editor-action" onClick={handleRevert} disabled={busy || !isDirty}>
            Отменить изменения
          </button>
          <button type="button" className="editor-action" onClick={handleReset} disabled={busy}>
            Сбросить
          </button>
          <button
            type="button"
            className="editor-action settings-publish-button"
            onClick={handleSave}
            disabled={busy || !isDirty}
          >
            {busy ? 'Сохраняем…' : 'Сохранить настройки'}
          </button>
        </div>
      </div>

      {status ? (
        <p className={error ? 'settings-status settings-status-error' : 'settings-status'}>{status}</p>
      ) : null}

      <div className="metric-settings-layout">
        <aside className="metric-settings-nav" aria-label="Навигация по разделам">
          <label className="metric-settings-nav-search">
            <span>Поиск по метрикам</span>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Активность, КПП, зоны…"
              autoComplete="off"
            />
          </label>
          {isSearching ? (
            <p className="metric-settings-nav-hint">
              {visibleMetricCount > 0 || showBrigadesSection
                ? `Найдено: ${visibleMetricCount}${showBrigadesSection ? ' + бригады' : ''}`
                : 'Ничего не найдено'}
            </p>
          ) : null}

          <nav className="metric-settings-nav-list">
            {showBrigadesSection ? (
              <button
                type="button"
                className="metric-settings-nav-link"
                onClick={() => scrollToSection(METRIC_SETTINGS_BRIGADES_SECTION_ID)}
              >
                Бригады для сравнения
              </button>
            ) : null}
            {METRIC_BLOCKS.map((block) => {
              const sectionId = metricBlockSectionId(block)
              const count = visibleMetricsByBlock.get(block)?.length ?? 0
              if (isSearching && count === 0) return null
              return (
                <button
                  key={block}
                  type="button"
                  className="metric-settings-nav-link"
                  onClick={() => scrollToSection(sectionId)}
                >
                  {metricBlockDisplayTitle(block)}
                  {isSearching ? <span className="metric-settings-nav-count">{count}</span> : null}
                </button>
              )
            })}
          </nav>

          <div className="metric-settings-nav-actions">
            <button type="button" className="metric-settings-nav-action" onClick={expandAllSections}>
              Развернуть все
            </button>
            <button type="button" className="metric-settings-nav-action" onClick={collapseAllSections}>
              Свернуть все
            </button>
          </div>
        </aside>

        <div className="metric-settings-main">
          <CollapsibleMetricSection
            id={METRIC_SETTINGS_BRIGADES_SECTION_ID}
            title="Бригады для сравнения"
            open={openSections[METRIC_SETTINGS_BRIGADES_SECTION_ID] ?? true}
            onToggle={() => toggleSection(METRIC_SETTINGS_BRIGADES_SECTION_ID)}
            hidden={!showBrigadesSection}
          >
            <p className="metric-settings-block-note metric-settings-section-lead">
              Выберите бригадиров, чьи карточки и динамика показываются на дашборде и в блоках сравнения рассылки.
            </p>
            {supervisorOptions.length > 0 ? (
              <div className="metric-settings-brigades-grid">
                {supervisorOptions.map((name) => {
                  const checked = draft.comparisonBrigades.some((brigade) => brigadeNamesMatch(brigade, name))
                  return (
                    <label key={name} className="metric-settings-brigade-toggle">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => toggleComparisonBrigade(name, event.target.checked)}
                      />
                      <span>{name}</span>
                    </label>
                  )
                })}
              </div>
            ) : (
              <p className="metric-settings-note">Список бригад появится после первого импорта данных.</p>
            )}
          </CollapsibleMetricSection>

          {METRIC_BLOCKS.map((block) => {
            const blockId = METRIC_BLOCK_ID_BY_TITLE[block]
            const blockMeta = blockId ? getDashboardBlock(blockId) : null
            const blockKey = blockId ? blockSettingsKey(blockId) : null
            const blockEnabled = blockKey ? Boolean(draft[blockKey]) : true
            const sectionId = metricBlockSectionId(block)
            const visibleMetrics = visibleMetricsByBlock.get(block) ?? []

            if (isSearching && visibleMetrics.length === 0) return null

            return (
              <CollapsibleMetricSection
                key={block}
                id={sectionId}
                title={metricBlockDisplayTitle(block)}
                subtitle={blockMeta?.inReports}
                open={openSections[sectionId] ?? false}
                onToggle={() => toggleSection(sectionId)}
                headerExtra={
                  blockKey ? (
                    <label
                      className="settings-schedule-toggle metric-settings-block-toggle"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={blockEnabled}
                        onChange={(event) => updateBlockEnabled(blockKey, event.target.checked)}
                      />
                      <span>{blockEnabled ? 'Блок включён' : 'Блок отключён'}</span>
                    </label>
                  ) : null
                }
              >
                {blockId && blockEnabled && getSubblocksForBlock(blockId).length > 0 ? (
                  <div className="metric-settings-subblocks">
                    <p className="metric-settings-label">Подблоки на дашборде</p>
                    <div className="metric-settings-brigades-grid">
                      {getSubblocksForBlock(blockId).map((subblock) => (
                        <label key={subblock.id} className="metric-settings-brigade-toggle" title={subblock.note}>
                          <input
                            type="checkbox"
                            checked={draft.subblockVisibility[subblock.id] !== false}
                            onChange={(event) => updateSubblockEnabled(subblock.id, event.target.checked)}
                          />
                          <span>{subblock.title}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
                {blockId === 'block4' && blockEnabled ? (
                  <div className="metric-settings-subblocks metric-settings-zones">
                    <p className="metric-settings-label">Видимые BLE-зоны</p>
                    <p className="metric-settings-block-note">
                      Какие зоны показывать в «Распределении по зонам» на дашборде и в рассылке. По умолчанию скрыты
                      зона 0 и КПП (13).
                    </p>
                    <div className="metric-settings-zones-grid">
                      {ZONE_IDS.map((zoneId) => (
                        <label key={zoneId} className="metric-settings-zone-toggle">
                          <input
                            type="checkbox"
                            checked={draft.zoneVisibility[zoneId] !== false}
                            onChange={(event) => updateZoneVisibility(zoneId, event.target.checked)}
                          />
                          <span>{zoneVisibilityLabel(zoneId)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
                {blockId === 'block1' && blockEnabled ? (
                  <NotWornProfessionRulesEditor
                    professions={availableProfessions}
                    globalDefaults={draft}
                    rules={draft.notWornProfessionRules}
                    onChange={updateNotWornProfessionRules}
                  />
                ) : null}
                <div className="metric-settings-grid">
                  {visibleMetrics.map((metric) => (
                    <MetricCard key={metric.id} metric={metric} settings={draft} onChange={updateField} />
                  ))}
                </div>
              </CollapsibleMetricSection>
            )
          })}

          {isSearching && visibleMetricCount === 0 && !showBrigadesSection ? (
            <div className="empty-state">По запросу «{searchQuery.trim()}» ничего не найдено.</div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
