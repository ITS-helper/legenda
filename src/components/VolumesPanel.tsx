import { useEffect, useState } from 'react'
import { formatFullDate } from '../lib/reports'
import {
  draftsFromEntries,
  loadVolumeEntries,
  saveVolumeEntries,
  type VolumeEntryDraft,
} from '../lib/volumes'

type VolumesPanelProps = {
  password: string
  reportDate: string
  onSaved?: () => void
}

function emptyDraft(): VolumeEntryDraft {
  return { label: '', value_text: '', note: '' }
}

export function VolumesPanel({ password, reportDate, onSaved }: VolumesPanelProps) {
  const [drafts, setDrafts] = useState<VolumeEntryDraft[]>([emptyDraft()])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const [saveError, setSaveError] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!reportDate) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError(null)
      setSaveStatus(null)
      setSaveError(false)
      try {
        const entries = await loadVolumeEntries(password, reportDate)
        if (cancelled) return
        setDrafts(draftsFromEntries(entries))
        setDirty(false)
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [reportDate, password])

  function updateDraft(index: number, patch: Partial<VolumeEntryDraft>) {
    setDrafts((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)))
    setDirty(true)
    setSaveStatus(null)
    setSaveError(false)
  }

  function addRow() {
    setDrafts((current) => [...current, emptyDraft()])
    setDirty(true)
    setSaveStatus(null)
    setSaveError(false)
  }

  function removeRow(index: number) {
    setDrafts((current) => {
      const next = current.filter((_, rowIndex) => rowIndex !== index)
      return next.length > 0 ? next : [emptyDraft()]
    })
    setDirty(true)
    setSaveStatus(null)
    setSaveError(false)
  }

  async function handleSave() {
    const trimmedPassword = password.trim()
    if (!trimmedPassword) {
      setSaveError(true)
      setSaveStatus('Сессия истекла. Войдите снова.')
      return
    }

    const payload = drafts
      .map((row) => ({
        ...row,
        label: row.label.trim(),
        value_text: row.value_text.trim(),
        note: row.note.trim(),
      }))
      .filter((row) => row.value_text.length > 0)

    setSaving(true)
    setSaveError(false)
    setSaveStatus(null)

    try {
      const saved = await saveVolumeEntries(trimmedPassword, reportDate, payload)
      setDrafts(draftsFromEntries(saved))
      setDirty(false)
      setSaveStatus(saved.length > 0 ? `Сохранено записей: ${saved.length}` : 'Записи за день удалены')
      onSaved?.()
    } catch (error) {
      setSaveError(true)
      setSaveStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="volumes-panel">
      <p className="volumes-panel-hint">
        Введите показатели объёмов за {reportDate ? formatFullDate(reportDate) : 'выбранный день'}: значение может содержать цифры и символы (например, «125 м³» или «12,5 т»).
      </p>

      {loading ? <div className="empty-state">Загружаем объёмы...</div> : null}
      {loadError ? <div className="empty-state error-state">Ошибка загрузки: {loadError}</div> : null}

      {!loading && !loadError ? (
        <>
          <div className="volumes-table-wrap">
            <table className="volumes-table">
              <thead>
                <tr>
                  <th>Показатель</th>
                  <th>Значение</th>
                  <th>Пояснение</th>
                  <th aria-label="Действия" />
                </tr>
              </thead>
              <tbody>
                {drafts.map((row, index) => (
                  <tr key={row.id ?? `draft-${index}`}>
                    <td>
                      <input
                        type="text"
                        className="volumes-input"
                        value={row.label}
                        onChange={(event) => updateDraft(index, { label: event.target.value })}
                        placeholder="Например, бетон"
                        maxLength={200}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="volumes-input volumes-input-value"
                        value={row.value_text}
                        onChange={(event) => updateDraft(index, { value_text: event.target.value })}
                        placeholder="125 м³"
                        maxLength={500}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="volumes-input"
                        value={row.note}
                        onChange={(event) => updateDraft(index, { note: event.target.value })}
                        placeholder="Комментарий"
                        maxLength={1000}
                      />
                    </td>
                    <td className="volumes-actions-cell">
                      <button type="button" className="volumes-remove-button" onClick={() => removeRow(index)} aria-label="Удалить строку">
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="volumes-toolbar">
            <button type="button" className="editor-action" onClick={addRow} disabled={saving}>
              Добавить строку
            </button>
            <button
              type="button"
              className="editor-action settings-publish-button"
              onClick={() => void handleSave()}
              disabled={saving || !dirty}
            >
              {saving ? 'Сохраняем...' : 'Сохранить'}
            </button>
          </div>

          {saveStatus ? (
            <p className={`editor-saved${saveError ? ' settings-status-error' : ''}`}>{saveStatus}</p>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
