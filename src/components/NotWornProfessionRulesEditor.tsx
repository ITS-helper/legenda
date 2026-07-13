import type { MetricSettings } from '../lib/metricSettings'
import {
  hasNotWornProfessionOverride,
  type NotWornProfessionRuleValues,
  type NotWornProfessionRules,
  resolveNotWornRule,
} from '../lib/notWornProfessionRules'

type FieldKey = keyof NotWornProfessionRuleValues

const FIELD_DEFS: Array<{
  key: FieldKey
  label: string
  unit: string
  min: number
  max: number
  globalKey: keyof Pick<
    MetricSettings,
    'notWornIdleSecMin' | 'notWornActiveSecMax' | 'notWornMinSec' | 'notWornWarnPct'
  >
}> = [
  { key: 'idleSecMin', label: 'Минимум простоя в минуте', unit: 'сек', min: 30, max: 60, globalKey: 'notWornIdleSecMin' },
  { key: 'activeSecMax', label: 'Максимум активности в минуте', unit: 'сек', min: 0, max: 30, globalKey: 'notWornActiveSecMax' },
  { key: 'shiftMinSec', label: 'Минимум за смену для списка', unit: 'сек', min: 60, max: 7200, globalKey: 'notWornMinSec' },
  { key: 'warnPct', label: 'Порог предупреждения', unit: '%', min: 1, max: 100, globalKey: 'notWornWarnPct' },
]

type Props = {
  professions: string[]
  globalDefaults: MetricSettings
  rules: NotWornProfessionRules
  onChange: (rules: NotWornProfessionRules) => void
}

export function NotWornProfessionRulesEditor({ professions, globalDefaults, rules, onChange }: Props) {
  const professionList = [...new Set([...professions, ...Object.keys(rules)])]
    .map((name) => name.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, 'ru'))

  function updateProfessionField(profession: string, field: FieldKey, raw: string) {
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return

    const def = FIELD_DEFS.find((item) => item.key === field)
    if (!def) return

    const value = Math.min(def.max, Math.max(def.min, Math.trunc(parsed)))
    onChange({
      ...rules,
      [profession]: {
        ...rules[profession],
        [field]: value,
      },
    })
  }

  function resetProfession(profession: string) {
    const next = { ...rules }
    delete next[profession]
    onChange(next)
  }

  return (
    <div className="metric-settings-subblocks not-worn-profession-rules">
      <p className="metric-settings-label">Параметры по профессиям</p>
      <p className="metric-settings-block-note">
        Для каждой профессии можно переопределить пороги блока «Не носил». Пустые значения берутся из общих
        настроек карточки метрики ниже.
      </p>
      {professionList.length === 0 ? (
        <p className="metric-settings-note">Список профессий появится после первого импорта данных.</p>
      ) : (
      <div className="not-worn-profession-rules-list">
        {professionList.map((profession) => {
          const hasOverride = hasNotWornProfessionOverride(rules, profession)
          const effective = resolveNotWornRule(profession, {
            ...globalDefaults,
            notWornProfessionRules: rules,
          })

          return (
            <details key={profession} className="not-worn-profession-rule" open={hasOverride}>
              <summary className="not-worn-profession-rule-summary">
                <span>{profession}</span>
                {hasOverride ? <span className="not-worn-profession-rule-badge">свои пороги</span> : null}
              </summary>
              <div className="metric-settings-config-grid">
                {FIELD_DEFS.map((field) => (
                  <label key={`${profession}-${field.key}`} className="metric-settings-field">
                    <span>{field.label}</span>
                    <div className="metric-settings-field-row">
                      <input
                        type="number"
                        min={field.min}
                        max={field.max}
                        value={effective[field.key]}
                        onChange={(event) => updateProfessionField(profession, field.key, event.target.value)}
                      />
                      <span className="metric-settings-unit">{field.unit}</span>
                    </div>
                    <small className="metric-settings-hint">
                      По умолчанию: {globalDefaults[field.globalKey]}
                      {field.unit === 'сек' && field.key === 'shiftMinSec'
                        ? ` (${Math.round(Number(globalDefaults[field.globalKey]) / 60)} мин)`
                        : ''}
                    </small>
                  </label>
                ))}
              </div>
              {hasOverride ? (
                <button type="button" className="metric-settings-nav-action" onClick={() => resetProfession(profession)}>
                  Сбросить к общим значениям
                </button>
              ) : null}
            </details>
          )
        })}
      </div>
      )}
    </div>
  )
}
