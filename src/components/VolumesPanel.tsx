import { useEffect, useRef, useState } from 'react'
import { formatFullDate } from '../lib/reports'
import { parseGprVolumeFile } from '../lib/gprVolumeParser'
import {
  brigadeVolumeDraftsFromEntries,
  loadVolumeEntries,
  saveVolumeEntries,
  saveVolumeEntriesForDays,
  type VolumeEntryDraft,
} from '../lib/volumes'

type VolumesPanelProps = {
  password: string
  reportDate: string
  onSaved?: () => void
}

export function VolumesPanel({ password, reportDate, onSaved }: VolumesPanelProps) {
  const [drafts, setDrafts] = useState<VolumeEntryDraft[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const [saveError, setSaveError] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [importStatus, setImportStatus] = useState<string | null>(null)
  const [importError, setImportError] = useState(false)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
        setDrafts(brigadeVolumeDraftsFromEntries(entries))
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

  async function handleImportGpr(file: File) {
    const trimmedPassword = password.trim()
    if (!trimmedPassword) {
      setImportError(true)
      setImportStatus('Сессия истекла. Войдите снова.')
      return
    }

    setImporting(true)
    setImportError(false)
    setImportStatus(null)

    try {
      const result = await parseGprVolumeFile(file)
      if (result.days.length === 0) {
        throw new Error('В файле нет выполненных объёмов по дням')
      }

      await saveVolumeEntriesForDays(trimmedPassword, result.days)

      if (reportDate) {
        const entries = await loadVolumeEntries(trimmedPassword, reportDate)
        setDrafts(brigadeVolumeDraftsFromEntries(entries))
        setDirty(false)
      }

      setSaveStatus(null)
      setSaveError(false)
      onSaved?.()

      const dateRange =
        result.days.length === 1
          ? result.days[0].reportDate
          : `${result.days[0].reportDate} — ${result.days[result.days.length - 1].reportDate}`
      const warningText = result.warnings.length > 0 ? ` ${result.warnings.join(' ')}` : ''
      setImportStatus(
        `Из «${result.sheetName}» (${result.monthLabel}) обновлено дней: ${result.days.length} (${dateRange}).${warningText}`,
      )
    } catch (error) {
      setImportError(true)
      setImportStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setImporting(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
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
      setDrafts(brigadeVolumeDraftsFromEntries(saved))
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
        Загрузите файл ГПР (вкладка «ЛВ2_монолит К2») — объёмы сохранятся по всем дням из файла. Секция СНГ — Джалол, КНДР — ЛИ СОН ХАК.
      </p>

      <div className="volumes-import-row">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="volumes-import-input"
          disabled={importing || saving}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void handleImportGpr(file)
          }}
        />
        <button
          type="button"
          className="editor-action"
          disabled={importing || saving}
          onClick={() => fileInputRef.current?.click()}
        >
          {importing ? 'Читаем ГПР...' : 'Загрузить ГПР (Excel)'}
        </button>
      </div>

      {importStatus ? (
        <p className={`editor-saved${importError ? ' settings-status-error' : ''}`}>{importStatus}</p>
      ) : null}

      {loading ? <div className="empty-state">Загружаем объёмы...</div> : null}
      {loadError ? <div className="empty-state error-state">Ошибка загрузки: {loadError}</div> : null}

      {!loading && !loadError ? (
        <>
          <p className="volumes-day-caption">
            Объёмы за {reportDate ? formatFullDate(reportDate) : 'выбранный день'} по бригадам
          </p>

          <div className="volumes-brigade-grid">
            {drafts.map((row, index) => (
              <article key={row.label} className="volumes-brigade-card">
                <div className="volumes-brigade-card-head">
                  <h4>{row.label}</h4>
                  <span className="volumes-brigade-unit">м³</span>
                </div>

                <label className="volumes-field">
                  <span>Выполнено</span>
                  <input
                    type="text"
                    className="volumes-input volumes-input-value"
                    value={row.value_text}
                    onChange={(event) => updateDraft(index, { value_text: event.target.value })}
                    placeholder="0 м³"
                    maxLength={500}
                  />
                </label>

                <label className="volumes-field">
                  <span>Виды работ</span>
                  <textarea
                    className="volumes-textarea"
                    value={row.note}
                    onChange={(event) => updateDraft(index, { note: event.target.value })}
                    placeholder="Какие работы выполнены за день"
                    maxLength={1000}
                    rows={6}
                  />
                </label>
              </article>
            ))}
          </div>

          <div className="volumes-toolbar">
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
