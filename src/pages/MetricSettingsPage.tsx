import { useEffect, useState } from 'react'
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
  DEFAULT_METRIC_SETTINGS,
  saveMetricSettings,
  type BooleanBlockSettingKey,
  type MetricSettings,
  type NumericMetricSettingKey,
} from '../lib/metricSettings'
import { brigadeNamesMatch, loadAvailableSupervisorNames } from '../lib/reports'
import {
  DEFAULT_ZONE_VISIBILITY,
  ZONE_IDS,
  zoneVisibilityLabel,
} from '../lib/zoneVisibility'

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

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
    <article className="metric-settings-card">
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
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setDraft(published)
  }, [published])

  useEffect(() => {
    let cancelled = false

    async function loadSupervisors() {
      try {
        const names = await loadAvailableSupervisorNames()
        if (!cancelled) setAvailableSupervisors(names)
      } catch {
        if (!cancelled) setAvailableSupervisors([])
      }
    }

    void loadSupervisors()
    return () => {
      cancelled = true
    }
  }, [])

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
          <button type="button" className="editor-action" onClick={handleReset} disabled={busy}>
            Сбросить
          </button>
          <button type="button" className="editor-action settings-publish-button" onClick={handleSave} disabled={busy}>
            {busy ? 'Сохраняем…' : 'Сохранить настройки'}
          </button>
        </div>
      </div>

      {status ? (
        <p className={error ? 'settings-status settings-status-error' : 'settings-status'}>{status}</p>
      ) : null}

      <section className="metric-settings-brigades-section">
        <div className="metric-settings-block-head">
          <div>
            <h3 className="metric-settings-block-title">Бригады для сравнения</h3>
            <p className="metric-settings-block-note">
              Выберите бригадиров, чьи карточки и динамика показываются на дашборде и в блоках сравнения рассылки.
            </p>
          </div>
        </div>
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
      </section>

      {METRIC_BLOCKS.map((block) => {
        const blockId = METRIC_BLOCK_ID_BY_TITLE[block]
        const blockMeta = blockId ? getDashboardBlock(blockId) : null
        const blockKey = blockId ? blockSettingsKey(blockId) : null
        const blockEnabled = blockKey ? Boolean(draft[blockKey]) : true

        return (
          <section key={block} className="metric-settings-block-section">
            <div className="metric-settings-block-head">
              <div>
                <h3 className="metric-settings-block-title">{block}</h3>
                {blockMeta ? <p className="metric-settings-block-note">{blockMeta.inReports}</p> : null}
              </div>
              {blockKey ? (
                <label className="settings-schedule-toggle metric-settings-block-toggle">
                  <input
                    type="checkbox"
                    checked={blockEnabled}
                    onChange={(event) => updateBlockEnabled(blockKey, event.target.checked)}
                  />
                  <span>{blockEnabled ? 'Блок включён' : 'Блок отключён'}</span>
                </label>
              ) : null}
            </div>
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
                  Какие зоны показывать в «Распределении по зонам» на дашборде и в рассылке. По умолчанию скрыты зона 0 и КПП (13).
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
            <div className="metric-settings-grid">
              {METRIC_DEFINITIONS.filter((metric) => metric.block === block).map((metric) => (
                <MetricCard key={metric.id} metric={metric} settings={draft} onChange={updateField} />
              ))}
            </div>
          </section>
        )
      })}
    </section>
  )
}
