import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  formatWeekRange,
  loadAvailableDates,
  loadAvailableWeeks,
} from '../lib/reports'
import {
  loadRecipients,
  saveRecipients,
  sendReport,
  type EmailRecipient,
} from '../lib/emailReports'

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

export function SettingsPage() {
  const { password } = useAuth()
  const [busyAction, setBusyAction] = useState<
    'load-recipients' | 'save-recipients' | 'send-daily' | 'send-weekly' | 'preview-daily' | 'preview-weekly' | null
  >(null)
  const [recipients, setRecipients] = useState<EmailRecipient[]>([])
  const [recipientsStatus, setRecipientsStatus] = useState<string | null>(null)
  const [recipientsError, setRecipientsError] = useState(false)
  const [sendStatus, setSendStatus] = useState<string | null>(null)
  const [sendError, setSendError] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)

  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [availableWeeks, setAvailableWeeks] = useState<{ week_start: string; week_end: string }[]>([])
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedWeek, setSelectedWeek] = useState('')

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
      } catch {
        /* dates are optional for manual send */
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  function requirePassword() {
    const value = password.trim()
    if (!value) {
      throw new Error('Сессия истекла. Войдите снова.')
    }
    return value
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

  async function handleSend(type: 'daily' | 'weekly', preview: boolean) {
    const busyKey = preview
      ? type === 'daily'
        ? 'preview-daily'
        : 'preview-weekly'
      : type === 'daily'
        ? 'send-daily'
        : 'send-weekly'

    try {
      setBusyAction(busyKey)
      setSendError(false)
      setSendStatus(null)
      if (!preview) setPreviewHtml(null)

      const result = await sendReport({
        type,
        password: requirePassword(),
        date: type === 'daily' ? selectedDate : undefined,
        weekStart: type === 'weekly' ? selectedWeek : undefined,
        preview,
      })

      if (preview && result.previewHtml) {
        setPreviewHtml(result.previewHtml)
        setSendStatus('Предпросмотр отображён ниже')
      } else {
        const recipientText =
          result.recipients.length > 0
            ? `Отправлено (${result.recipients.length}): ${result.recipients.join(', ')}`
            : 'Нет активных получателей для этого типа рассылки'
        const pdfText =
          result.recipients.length === 0
            ? ''
            : result.pdfAttached === true
              ? ' PDF приложен.'
              : result.pdfAttached === false
                ? ` PDF не приложен${result.pdfError ? `: ${result.pdfError}` : ''}.`
                : ''
        setSendStatus(`${recipientText}${pdfText}`)
      }
    } catch (error) {
      setSendError(true)
      setSendStatus(getErrorMessage(error))
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

  const selectedWeekMeta = availableWeeks.find((week) => week.week_start === selectedWeek) ?? null

  return (
    <section className="editor-panel settings-page">
      <div className="editor-panel-head settings-head">
        <div>
          <p className="panel-kicker">Настройки</p>
          <h2>Рассылка отчётов</h2>
          <p>Управление получателями и ручная отправка ежедневных и еженедельных отчётов.</p>
        </div>
      </div>

      <div className="settings-layout">
        <section className="settings-upload-card">
          <div className="settings-upload-head">
            <div>
              <p className="panel-kicker">Получатели</p>
              <h3>Кому отправлять отчёты</h3>
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

        <section className="settings-upload-card">
          <div className="settings-upload-head">
            <div>
              <p className="panel-kicker">Отправка</p>
              <h3>Ручная рассылка</h3>
              <p>Выберите период и отправьте отчёт активным получателям.</p>
            </div>
          </div>

          <div className="settings-send-grid">
            <div className="settings-send-block">
              <label className="settings-password-field">
                <span>День</span>
                <select value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} disabled={!availableDates.length}>
                  {availableDates.map((date) => (
                    <option key={date} value={date}>
                      {date}
                    </option>
                  ))}
                </select>
              </label>
              <div className="settings-inline-actions">
                <button
                  type="button"
                  className="editor-action settings-publish-button"
                  onClick={() => handleSend('daily', false)}
                  disabled={busyAction !== null || !selectedDate}
                >
                  {busyAction === 'send-daily' ? 'Отправляем...' : 'Отправить дневной'}
                </button>
                <button
                  type="button"
                  className="editor-action"
                  onClick={() => handleSend('daily', true)}
                  disabled={busyAction !== null || !selectedDate}
                >
                  {busyAction === 'preview-daily' ? '...' : 'Предпросмотр'}
                </button>
              </div>
            </div>

            <div className="settings-send-block">
              <label className="settings-password-field">
                <span>Неделя</span>
                <select value={selectedWeek} onChange={(event) => setSelectedWeek(event.target.value)} disabled={!availableWeeks.length}>
                  {availableWeeks.map((week) => (
                    <option key={week.week_start} value={week.week_start}>
                      {formatWeekRange(week.week_start, week.week_end)}
                    </option>
                  ))}
                </select>
              </label>
              {selectedWeekMeta ? (
                <p className="settings-send-caption">{formatWeekRange(selectedWeekMeta.week_start, selectedWeekMeta.week_end)}</p>
              ) : null}
              <div className="settings-inline-actions">
                <button
                  type="button"
                  className="editor-action settings-publish-button"
                  onClick={() => handleSend('weekly', false)}
                  disabled={busyAction !== null || !selectedWeek}
                >
                  {busyAction === 'send-weekly' ? 'Отправляем...' : 'Отправить недельный'}
                </button>
                <button
                  type="button"
                  className="editor-action"
                  onClick={() => handleSend('weekly', true)}
                  disabled={busyAction !== null || !selectedWeek}
                >
                  {busyAction === 'preview-weekly' ? '...' : 'Предпросмотр'}
                </button>
              </div>
            </div>
          </div>

          <p className={`editor-saved${sendError ? ' settings-status-error' : ''}`}>
            {sendStatus ?? 'Автоматическая рассылка по расписанию продолжает работать через GitHub Actions.'}
          </p>

          {previewHtml ? (
            <section className="settings-preview-card">
              <div className="settings-preview-head">
                <div>
                  <p className="panel-kicker">Предпросмотр</p>
                  <h3>Как будет выглядеть письмо</h3>
                </div>
                <button type="button" className="editor-action" onClick={() => setPreviewHtml(null)}>
                  Закрыть
                </button>
              </div>
              <iframe className="settings-preview-frame" title="Предпросмотр письма" srcDoc={previewHtml} />
            </section>
          ) : null}
        </section>
      </div>
    </section>
  )
}
