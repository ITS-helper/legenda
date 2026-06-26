import { useRef, useState } from 'react'
import { defaultUiText, type UiText } from '../content/uiText'
import { deepMergeUiText, downloadUiTextJson } from '../lib/uiTextEditor'

type SettingsPageProps = {
  initialUiText: UiText
  onPublish: (value: UiText, password: string) => Promise<void>
}

function setValueAtPath(source: UiText, path: string, value: string) {
  const next = structuredClone(source)
  const keys = path.split('.')
  let target: Record<string, unknown> = next as unknown as Record<string, unknown>

  for (let index = 0; index < keys.length - 1; index += 1) {
    target = target[keys[index]] as Record<string, unknown>
  }

  target[keys[keys.length - 1]] = value
  return next
}

export function SettingsPage({ initialUiText, onPublish }: SettingsPageProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [draft, setDraft] = useState<UiText>(initialUiText)
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function handleUiTextChange(path: string, value: string) {
    setDraft((current) => setValueAtPath(current, path, value))
  }

  function handleReset() {
    setDraft(defaultUiText)
    setStatus(null)
  }

  function handleRestorePublished() {
    setDraft(initialUiText)
    setStatus(null)
  }

  async function handleImportText(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const raw = await file.text()
    const parsed = JSON.parse(raw) as Partial<UiText>
    setDraft(deepMergeUiText(defaultUiText, parsed))
    setStatus('JSON загружен в черновик')
    event.target.value = ''
  }

  async function handlePublishClick() {
    if (!password.trim()) {
      setStatus('Нужен пароль публикации')
      return
    }

    setSaving(true)
    setStatus(null)

    try {
      await onPublish(draft, password)
      setStatus('Настройки опубликованы')
    } catch (publishError) {
      const message = publishError instanceof Error ? publishError.message : String(publishError)
      setStatus(`Не удалось опубликовать настройки: ${message}`)
    } finally {
      setSaving(false)
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

  return (
    <section className="editor-panel settings-page">
      <div className="editor-panel-head settings-head">
        <div>
          <p className="panel-kicker">Админка фронта</p>
          <h2>Настройки сайта</h2>
          <p>
            Здесь редактируются опубликованные тексты интерфейса. Изменения сохраняются в Supabase и потом читаются основным дашбордом.
          </p>
        </div>
        <div className="editor-actions">
          <button type="button" className="editor-action" onClick={handleRestorePublished}>
            Вернуть опубликованное
          </button>
          <button type="button" className="editor-action" onClick={handleReset}>
            Сбросить к дефолту
          </button>
          <button type="button" className="editor-action" onClick={() => downloadUiTextJson(draft)}>
            Скачать JSON
          </button>
          <button type="button" className="editor-action" onClick={() => fileInputRef.current?.click()}>
            Загрузить JSON
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

      <div className="settings-publish-row">
        <label className="settings-password-field">
          <span>Пароль публикации</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Вводится только для публикации"
          />
        </label>
        <button
          type="button"
          className="editor-action settings-publish-button"
          onClick={handlePublishClick}
          disabled={saving}
        >
          {saving ? 'Публикуем...' : 'Опубликовать'}
        </button>
      </div>

      <p className="editor-saved">{status ?? 'Черновик еще не опубликован'}</p>

      <div className="editor-grid">
        {renderEditorField('Бренд', 'brand', draft.brand)}
        {renderEditorField('Главный заголовок', 'heroTitle', draft.heroTitle)}
        {renderEditorField('Описание', 'heroDescription', draft.heroDescription)}
        {renderEditorField('Заголовок сравнения', 'compareTitle', draft.compareTitle)}
        {renderEditorField('Пустое состояние сравнения', 'compareEmpty', draft.compareEmpty)}
        {renderEditorField('Фильтр: дата', 'filters.date', draft.filters.date)}
        {renderEditorField('Фильтр: руководитель', 'filters.supervisor', draft.filters.supervisor)}
        {renderEditorField('Фильтр: метрика', 'filters.compareMetric', draft.filters.compareMetric)}
        {renderEditorField('Фильтр: все бригады', 'filters.allBrigades', draft.filters.allBrigades)}
        {renderEditorField('Секция: бригады', 'sections.brigadesTitle', draft.sections.brigadesTitle)}
        {renderEditorField('Секция: смены', 'sections.shiftsTitle', draft.sections.shiftsTitle)}
      </div>
    </section>
  )
}
