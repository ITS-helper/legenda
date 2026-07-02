import { useRef, useState } from 'react'
import { defaultUiText, type UiText } from '../content/uiText'
import {
  loadUiTextSnapshot,
  saveDraftUiText,
  type SettingsSnapshot,
  uploadDailyReports,
} from '../lib/siteSettings'
import { loadRecipients, saveRecipients, type EmailRecipient } from '../lib/emailReports'
import { deepMergeUiText, downloadUiTextJson } from '../lib/uiTextEditor'

type SettingsPageProps = {
  initialUiText: UiText
  onPublish: (value: UiText, password: string) => Promise<SettingsSnapshot>
}

function formatUiText(value: UiText) {
  return JSON.stringify(value, null, 2)
}

function parseUiTextDraft(raw: string) {
  const parsed = JSON.parse(raw) as Partial<UiText>

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON должен быть объектом')
  }

  return deepMergeUiText(defaultUiText, parsed)
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return 'Еще не сохранено'
  }

  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const message = Reflect.get(error, 'message')
    if (typeof message === 'string') return message
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return String(error)
}
export function SettingsPage({ initialUiText, onPublish }: SettingsPageProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const reportFileInputRef = useRef<HTMLInputElement | null>(null)
  const faceFileInputRef = useRef<HTMLInputElement | null>(null)
  const longIdleFileInputRef = useRef<HTMLInputElement | null>(null)
  const [draftText, setDraftText] = useState(() => formatUiText(initialUiText))
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<'load' | 'save' | 'publish' | 'upload-report' | 'load-recipients' | 'save-recipients' | null>(null)
  const [recipients, setRecipients] = useState<EmailRecipient[]>([])
  const [recipientsStatus, setRecipientsStatus] = useState<string | null>(null)
  const [recipientsError, setRecipientsError] = useState(false)
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<string | null>(null)
  const [publishedUpdatedAt, setPublishedUpdatedAt] = useState<string | null>(null)
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [reportFile, setReportFile] = useState<File | null>(null)
  const [faceFile, setFaceFile] = useState<File | null>(null)
  const [longIdleFile, setLongIdleFile] = useState<File | null>(null)
  const [reportStatus, setReportStatus] = useState<string | null>(null)

  function setEditorText(nextText: string) {
    setDraftText(nextText)
    setStatus(null)

    try {
      parseUiTextDraft(nextText)
      setValidationError(null)
    } catch (error) {
      const message = getErrorMessage(error)
      setValidationError(message)
    }
  }

  function requirePassword() {
    if (password.trim()) {
      return password.trim()
    }

    throw new Error('Нужен пароль админки')
  }

  function readDraftFromEditor() {
    const parsed = parseUiTextDraft(draftText)
    setValidationError(null)
    return parsed
  }

  async function handleLoadRecipients() {
    try {
      setBusyAction('load-recipients')
      setRecipientsError(false)
      setRecipientsStatus(null)
      const loaded = await loadRecipients(requirePassword())
      setRecipients(loaded)
      setRecipientsStatus(loaded.length > 0 ? `Загружено получателей: ${loaded.length}` : 'Список получателей пуст')
    } catch (error) {
      setRecipientsError(true)
      setRecipientsStatus(getErrorMessage(error))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleSaveRecipients() {
    try {
      setBusyAction('save-recipients')
      setRecipientsError(false)
      setRecipientsStatus(null)
      const saved = await saveRecipients(requirePassword(), recipients)
      setRecipients(saved)
      setRecipientsStatus(`Сохранено получателей: ${saved.length}`)
    } catch (error) {
      setRecipientsError(true)
      setRecipientsStatus(getErrorMessage(error))
    } finally {
      setBusyAction(null)
    }
  }

  function updateRecipient(index: number, patch: Partial<EmailRecipient>) {
    setRecipients((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)))
  }

  function addRecipient() {
    setRecipients((current) => [...current, { email: '', label: '', daily: true, weekly: true, active: true }])
  }

  function removeRecipient(index: number) {
    setRecipients((current) => current.filter((_, rowIndex) => rowIndex !== index))
  }

  function handleReset() {
    setEditorText(formatUiText(defaultUiText))
  }

  function handleRestorePublished() {
    setEditorText(formatUiText(initialUiText))
  }

  function handleFormatJson() {
    try {
      setEditorText(formatUiText(readDraftFromEditor()))
      setStatus('JSON отформатирован')
    } catch (error) {
      const message = getErrorMessage(error)
      setValidationError(message)
      setStatus(null)
    }
  }

  async function handleImportText(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const raw = await file.text()
      const parsed = parseUiTextDraft(raw)
      setEditorText(formatUiText(parsed))
      setStatus('JSON загружен в черновик')
    } catch (error) {
      const message = getErrorMessage(error)
      setValidationError(message)
      setStatus(null)
    } finally {
      event.target.value = ''
    }
  }

  async function handleLoadDraftClick() {
    try {
      setBusyAction('load')
      setStatus(null)
      const snapshot = await loadUiTextSnapshot('draft', requirePassword())
      setEditorText(formatUiText(snapshot.value))
      setDraftUpdatedAt(snapshot.updatedAt)
      setStatus('Черновик загружен с сервера')
    } catch (error) {
      const message = getErrorMessage(error)
      setStatus(`Не удалось загрузить черновик: ${message}`)
    } finally {
      setBusyAction(null)
    }
  }

  async function handleSaveDraftClick() {
    try {
      setBusyAction('save')
      setStatus(null)
      const snapshot = await saveDraftUiText(readDraftFromEditor(), requirePassword())
      setDraftUpdatedAt(snapshot.updatedAt)
      setStatus('Черновик сохранен в Supabase')
    } catch (error) {
      const message = getErrorMessage(error)
      setStatus(`Не удалось сохранить черновик: ${message}`)
    } finally {
      setBusyAction(null)
    }
  }

  async function handlePublishClick() {
    try {
      setBusyAction('publish')
      setStatus(null)
      const snapshot = await onPublish(readDraftFromEditor(), requirePassword())
      setPublishedUpdatedAt(snapshot.updatedAt)
      setDraftUpdatedAt(snapshot.updatedAt)
      setEditorText(formatUiText(snapshot.value))
      setStatus('Настройки опубликованы')
    } catch (error) {
      const message = getErrorMessage(error)
      setStatus(`Не удалось опубликовать настройки: ${message}`)
    } finally {
      setBusyAction(null)
    }
  }

  async function handleReportUploadClick() {
    try {
      const adminPassword = requirePassword()

      if (!reportDate) {
        throw new Error('Выберите дату отчета')
      }

      if (!reportFile) {
        throw new Error('Выберите файл AA_BLE.xls или AA_BLE.xlsx')
      }

      if (!faceFile) {
        throw new Error('Выберите файл faceID за ту же дату')
      }

      if (!longIdleFile) {
        throw new Error('Выберите файл LongIDLE за ту же дату')
      }

      setBusyAction('upload-report')
      setReportStatus(null)
      const result = await uploadDailyReports(reportDate, reportFile, faceFile, longIdleFile, adminPassword)
      setReportStatus(
        `Загружены faceID + AA_BLE + LongIDLE: ${result.importedFaceRows ?? 0} смен, ${result.importedBleRows ?? result.importedRows} BLE-строк и ${result.importedLongIdleRows ?? 0} LongIDLE-строк за ${result.reportDate}`,
      )
      setReportFile(null)
      setFaceFile(null)
      setLongIdleFile(null)

      if (reportFileInputRef.current) {
        reportFileInputRef.current.value = ''
      }
      if (faceFileInputRef.current) {
        faceFileInputRef.current.value = ''
      }
      if (longIdleFileInputRef.current) {
        longIdleFileInputRef.current.value = ''
      }
    } catch (error) {
      const message = getErrorMessage(error)
      setReportStatus(`Не удалось загрузить отчет: ${message}`)
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <section className="editor-panel settings-page">
      <div className="editor-panel-head settings-head">
        <div>
          <p className="panel-kicker">Админка фронта</p>
          <h2>Настройки сайта</h2>
          <p>
            Здесь редактируется весь JSON интерфейса. Можно держать черновик в Supabase, возвращаться к
            опубликованной версии и выпускать изменения отдельно.
          </p>
        </div>
        <div className="editor-actions">
          <button type="button" className="editor-action" onClick={handleRestorePublished}>
            Вернуть опубликованное
          </button>
          <button type="button" className="editor-action" onClick={handleReset}>
            Сбросить к дефолту
          </button>
          <button type="button" className="editor-action" onClick={handleFormatJson}>
            Форматировать JSON
          </button>
          <button type="button" className="editor-action" onClick={() => downloadUiTextJson(readDraftFromEditor())}>
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

      <div className="settings-layout">
        <div className="settings-summary-grid">
          <article className="settings-card">
            <span>Опубликовано</span>
            <strong>{formatTimestamp(publishedUpdatedAt)}</strong>
            <p>Эта версия читается дашбордом.</p>
          </article>
          <article className="settings-card">
            <span>Черновик</span>
            <strong>{formatTimestamp(draftUpdatedAt)}</strong>
            <p>Загружается и сохраняется по паролю админки.</p>
          </article>
          <article className="settings-card">
            <span>Гибкость</span>
            <strong>{Object.keys(defaultUiText).length} верхних секций</strong>
            <p>Редактируется весь JSON, а не только заранее прошитые поля.</p>
          </article>
        </div>

        <div className="settings-publish-row">
          <label className="settings-password-field">
            <span>Пароль админки</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Нужен для загрузки черновика, сохранения, публикации и импорта отчетов"
            />
          </label>
          <div className="settings-inline-actions">
            <button
              type="button"
              className="editor-action"
              onClick={handleLoadDraftClick}
              disabled={busyAction !== null}
            >
              {busyAction === 'load' ? 'Загружаем...' : 'Загрузить черновик'}
            </button>
            <button
              type="button"
              className="editor-action"
              onClick={handleSaveDraftClick}
              disabled={busyAction !== null}
            >
              {busyAction === 'save' ? 'Сохраняем...' : 'Сохранить черновик'}
            </button>
            <button
              type="button"
              className="editor-action settings-publish-button"
              onClick={handlePublishClick}
              disabled={busyAction !== null}
            >
              {busyAction === 'publish' ? 'Публикуем...' : 'Опубликовать'}
            </button>
          </div>
        </div>

        <p className={`editor-saved${validationError ? ' settings-status-error' : ''}`}>
          {validationError ?? status ?? 'Черновик пока не изменялся'}
        </p>

        <section className="settings-upload-card">
          <div className="settings-upload-head">
            <div>
              <p className="panel-kicker">Импорт отчетов</p>
              <h3>Архивная загрузка за день</h3>
              <p>
                Загрузите все три файла за один день: <strong>faceID</strong>, <strong>AA_BLE</strong> и{' '}
                <strong>LongIDLE</strong>.
              </p>
            </div>
          </div>
          <div className="settings-upload-grid">
            <label className="settings-password-field">
              <span>Дата отчета</span>
              <input type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} />
            </label>
            <label className="settings-password-field">
              <span>AA_BLE</span>
              <input
                ref={reportFileInputRef}
                type="file"
                accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => setReportFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <label className="settings-password-field">
              <span>faceID</span>
              <input
                ref={faceFileInputRef}
                type="file"
                accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => setFaceFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <label className="settings-password-field">
              <span>LongIDLE</span>
              <input
                ref={longIdleFileInputRef}
                type="file"
                accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => setLongIdleFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <div className="settings-upload-actions">
              <button
                type="button"
                className="editor-action settings-publish-button"
                onClick={handleReportUploadClick}
                disabled={busyAction !== null}
              >
                {busyAction === 'upload-report' ? 'Загружаем отчет...' : 'Загрузить отчеты'}
              </button>
            </div>
          </div>
          <p className={`editor-saved${reportStatus?.startsWith('Не удалось') ? ' settings-status-error' : ''}`}>
            {reportStatus ?? 'Нужны все три файла за одну дату: faceID, AA_BLE и LongIDLE.'}
          </p>
        </section>

        <section className="settings-upload-card">
          <div className="settings-upload-head">
            <div>
              <p className="panel-kicker">Рассылка</p>
              <h3>Получатели отчётов</h3>
              <p>
                Кому отправлять ежедневный и еженедельный отчёты. Управление требует пароль админки. Отправка идёт с дашборда
                или автоматически по расписанию.
              </p>
            </div>
            <div className="editor-actions">
              <button type="button" className="editor-action" onClick={handleLoadRecipients} disabled={busyAction !== null}>
                {busyAction === 'load-recipients' ? 'Загружаем...' : 'Загрузить список'}
              </button>
              <button
                type="button"
                className="editor-action settings-publish-button"
                onClick={handleSaveRecipients}
                disabled={busyAction !== null}
              >
                {busyAction === 'save-recipients' ? 'Сохраняем...' : 'Сохранить список'}
              </button>
            </div>
          </div>

          <div className="recipients-table">
            <div className="recipients-row recipients-head">
              <span>Email</span>
              <span>Имя / метка</span>
              <span>Ежедневно</span>
              <span>Еженедельно</span>
              <span>Активен</span>
              <span></span>
            </div>
            {recipients.map((recipient, index) => (
              <div className="recipients-row" key={index}>
                <input
                  type="email"
                  value={recipient.email}
                  placeholder="mail@company.ru"
                  onChange={(event) => updateRecipient(index, { email: event.target.value })}
                />
                <input
                  type="text"
                  value={recipient.label ?? ''}
                  placeholder="Заказчик"
                  onChange={(event) => updateRecipient(index, { label: event.target.value })}
                />
                <input
                  type="checkbox"
                  checked={recipient.daily}
                  onChange={(event) => updateRecipient(index, { daily: event.target.checked })}
                />
                <input
                  type="checkbox"
                  checked={recipient.weekly}
                  onChange={(event) => updateRecipient(index, { weekly: event.target.checked })}
                />
                <input
                  type="checkbox"
                  checked={recipient.active}
                  onChange={(event) => updateRecipient(index, { active: event.target.checked })}
                />
                <button type="button" className="recipients-remove" onClick={() => removeRecipient(index)}>
                  Удалить
                </button>
              </div>
            ))}
            {recipients.length === 0 ? (
              <p className="panel-collapsed-note">Список пуст. Загрузите существующий или добавьте получателя.</p>
            ) : null}
          </div>

          <div className="settings-upload-actions">
            <button type="button" className="editor-action" onClick={addRecipient} disabled={busyAction !== null}>
              + Добавить получателя
            </button>
          </div>

          <p className={`editor-saved${recipientsError ? ' settings-status-error' : ''}`}>
            {recipientsStatus ?? 'Сначала загрузите список, затем редактируйте и сохраните.'}
          </p>
        </section>

        <label className="settings-json-field">
          <span>JSON настроек интерфейса</span>
          <textarea
            value={draftText}
            onChange={(event) => setEditorText(event.target.value)}
            spellCheck={false}
          />
        </label>
      </div>
    </section>
  )
}



