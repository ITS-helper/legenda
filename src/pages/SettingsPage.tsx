import { useEffect, useState } from 'react'
import { DatePickerField } from '../components/DatePickerField'
import { useAuth } from '../context/AuthContext'
import {
  formatWeekRange,
  loadAvailableDates,
  loadAvailableWeeks,
  TRACKED_BRIGADES,
} from '../lib/reports'
import {
  loadRecipients,
  loadSchedule,
  saveRecipients,
  saveSchedule,
  sendReport,
  type EmailRecipient,
  type ReportAudience,
  type ReportSchedule,
} from '../lib/emailReports'

const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Понедельник' },
  { value: 2, label: 'Вторник' },
  { value: 3, label: 'Среда' },
  { value: 4, label: 'Четверг' },
  { value: 5, label: 'Пятница' },
  { value: 6, label: 'Суббота' },
  { value: 7, label: 'Воскресенье' },
]

const DEFAULT_SCHEDULE: ReportSchedule = {
  daily_enabled: true,
  daily_hour: 8,
  daily_minute: 0,
  weekly_enabled: true,
  weekly_dow: 1,
  weekly_hour: 8,
  weekly_minute: 0,
}

function toTimeValue(hour: number, minute: number) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function fromTimeValue(value: string) {
  const [hour, minute] = value.split(':').map((part) => Number(part))
  return {
    hour: Number.isFinite(hour) ? hour : 0,
    minute: Number.isFinite(minute) ? minute : 0,
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

export function SettingsPage() {
  const { password } = useAuth()
  const [busyAction, setBusyAction] = useState<
    | 'load-recipients'
    | 'save-recipients'
    | 'send-daily'
    | 'send-weekly'
    | 'preview-daily'
    | 'preview-weekly'
    | 'save-schedule'
    | null
  >(null)
  const [schedule, setSchedule] = useState<ReportSchedule>(DEFAULT_SCHEDULE)
  const [scheduleLoaded, setScheduleLoaded] = useState(false)
  const [scheduleStatus, setScheduleStatus] = useState<string | null>(null)
  const [scheduleError, setScheduleError] = useState(false)
  const [recipients, setRecipients] = useState<EmailRecipient[]>([])
  const [recipientAudience, setRecipientAudience] = useState<ReportAudience>('managers')
  const [selectedBrigade, setSelectedBrigade] = useState(TRACKED_BRIGADES[0] ?? '')
  const [previewAudience, setPreviewAudience] = useState<ReportAudience>('managers')
  const [previewBrigade, setPreviewBrigade] = useState(TRACKED_BRIGADES[0] ?? '')
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

  useEffect(() => {
    let cancelled = false

    async function bootstrapSchedule() {
      const value = password.trim()
      if (!value) return
      try {
        const loaded = await loadSchedule(value)
        if (!cancelled && loaded) {
          setSchedule({ ...DEFAULT_SCHEDULE, ...loaded })
        }
      } catch {
        /* schedule stays at defaults until user saves */
      } finally {
        if (!cancelled) setScheduleLoaded(true)
      }
    }

    void bootstrapSchedule()
    return () => {
      cancelled = true
    }
  }, [password])

  useEffect(() => {
    let cancelled = false

    async function bootstrapRecipients() {
      const value = password.trim()
      if (!value) return
      try {
        const loaded = await loadRecipients(value, {
          audience: recipientAudience,
          brigadeName: recipientAudience === 'foremen' ? selectedBrigade : undefined,
        })
        if (!cancelled) {
          setRecipients(loaded)
          setRecipientsStatus(
            loaded.length > 0 ? `Загружено получателей: ${loaded.length}` : 'Список получателей пуст',
          )
          setRecipientsError(false)
        }
      } catch (error) {
        if (!cancelled) {
          setRecipientsError(true)
          setRecipientsStatus(getErrorMessage(error))
        }
      }
    }

    void bootstrapRecipients()
    return () => {
      cancelled = true
    }
  }, [password, recipientAudience, selectedBrigade])

  async function handleSaveSchedule() {
    try {
      setBusyAction('save-schedule')
      setScheduleError(false)
      setScheduleStatus(null)
      const saved = await saveSchedule(requirePassword(), schedule)
      if (saved) setSchedule({ ...DEFAULT_SCHEDULE, ...saved })
      setScheduleStatus('Расписание сохранено. Автоматическая рассылка обновлена.')
    } catch (error) {
      setScheduleError(true)
      setScheduleStatus(getErrorMessage(error))
    } finally {
      setBusyAction(null)
    }
  }

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
      const loaded = await loadRecipients(requirePassword(), {
        audience: recipientAudience,
        brigadeName: recipientAudience === 'foremen' ? selectedBrigade : undefined,
      })
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
      const saved = await saveRecipients(requirePassword(), recipients, {
        audience: recipientAudience,
        brigadeName: recipientAudience === 'foremen' ? selectedBrigade : undefined,
      })
      setRecipients(saved)
      const segmentLabel =
        recipientAudience === 'managers' ? 'руководители' : `бригадир ${selectedBrigade}`
      setRecipientsStatus(`Сохранено получателей (${segmentLabel}): ${saved.length}`)
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
        audience: preview ? previewAudience : undefined,
        brigadeName: preview && previewAudience === 'foremen' ? previewBrigade : undefined,
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
          <p className="panel-kicker">Рассылка</p>
          <h2>Рассылка отчётов</h2>
          <p>Управление получателями и ручная отправка ежедневных и еженедельных отчётов.</p>
        </div>
      </div>

      <div className="settings-layout">
        <section className="settings-upload-card">
          <div className="settings-upload-head">
            <div>
              <p className="panel-kicker">Расписание</p>
              <h3>Время рассылки</h3>
              <p>Когда автоматически отправлять отчёты. Время указывается по Москве (МСК).</p>
            </div>
            <div className="editor-actions">
              <button
                type="button"
                className="editor-action settings-publish-button"
                onClick={handleSaveSchedule}
                disabled={busyAction !== null || !scheduleLoaded}
              >
                {busyAction === 'save-schedule' ? 'Сохраняем...' : 'Сохранить расписание'}
              </button>
            </div>
          </div>

          <div className="settings-send-grid">
            <div className="settings-send-block">
              <label className="settings-schedule-toggle">
                <input
                  type="checkbox"
                  checked={schedule.daily_enabled}
                  onChange={(event) => setSchedule((s) => ({ ...s, daily_enabled: event.target.checked }))}
                />
                <span>Ежедневный отчёт</span>
              </label>
              <label className="settings-password-field">
                <span>Время (МСК)</span>
                <input
                  type="time"
                  value={toTimeValue(schedule.daily_hour, schedule.daily_minute)}
                  disabled={!schedule.daily_enabled}
                  onChange={(event) => {
                    const { hour, minute } = fromTimeValue(event.target.value)
                    setSchedule((s) => ({ ...s, daily_hour: hour, daily_minute: minute }))
                  }}
                />
              </label>
            </div>

            <div className="settings-send-block">
              <label className="settings-schedule-toggle">
                <input
                  type="checkbox"
                  checked={schedule.weekly_enabled}
                  onChange={(event) => setSchedule((s) => ({ ...s, weekly_enabled: event.target.checked }))}
                />
                <span>Недельный отчёт</span>
              </label>
              <label className="filter-field settings-filter-field">
                <span>День недели</span>
                <select
                  value={schedule.weekly_dow}
                  disabled={!schedule.weekly_enabled}
                  onChange={(event) => setSchedule((s) => ({ ...s, weekly_dow: Number(event.target.value) }))}
                >
                  {WEEKDAYS.map((day) => (
                    <option key={day.value} value={day.value}>
                      {day.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-password-field">
                <span>Время (МСК)</span>
                <input
                  type="time"
                  value={toTimeValue(schedule.weekly_hour, schedule.weekly_minute)}
                  disabled={!schedule.weekly_enabled}
                  onChange={(event) => {
                    const { hour, minute } = fromTimeValue(event.target.value)
                    setSchedule((s) => ({ ...s, weekly_hour: hour, weekly_minute: minute }))
                  }}
                />
              </label>
            </div>
          </div>

          <p className={`editor-saved${scheduleError ? ' settings-status-error' : ''}`}>
            {scheduleStatus ??
              (scheduleLoaded
                ? 'Изменения применяются к автоматической рассылке (Supabase pg_cron).'
                : 'Загружаем текущее расписание...')}
          </p>
        </section>

        <section className="settings-upload-card">
          <div className="settings-upload-head">
            <div>
              <p className="panel-kicker">Получатели</p>
              <h3>Кому отправлять отчёты</h3>
              <p>Настройте рассылку отдельно для руководителей и для каждого бригадира.</p>
            </div>
            <div className="editor-actions">
              <button type="button" className="editor-action" onClick={handleLoadRecipients} disabled={busyAction !== null}>
                {busyAction === 'load-recipients' ? 'Загружаем...' : 'Обновить список'}
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

          <div className="segmented-nav settings-audience-tabs">
            <button
              type="button"
              className={recipientAudience === 'managers' ? 'segmented-link segmented-link-active' : 'segmented-link'}
              onClick={() => setRecipientAudience('managers')}
            >
              Руководители
            </button>
            <button
              type="button"
              className={recipientAudience === 'foremen' ? 'segmented-link segmented-link-active' : 'segmented-link'}
              onClick={() => setRecipientAudience('foremen')}
            >
              Бригадиры
            </button>
          </div>

          {recipientAudience === 'foremen' ? (
            <label className="filter-field settings-filter-field">
              <span>Бригадир</span>
              <select value={selectedBrigade} onChange={(event) => setSelectedBrigade(event.target.value)}>
                {TRACKED_BRIGADES.map((brigade) => (
                  <option key={brigade} value={brigade}>
                    {brigade}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="settings-send-caption">Полная аналитика по всем бригадам, как в текущей рассылке.</p>
          )}

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
            {recipientsStatus ??
              (recipientAudience === 'managers'
                ? 'Получатели руководителей загружаются автоматически.'
                : `Получатели бригадира «${selectedBrigade}» загружаются автоматически.`)}
          </p>
        </section>

        <section className="settings-upload-card">
          <div className="settings-upload-head">
            <div>
              <p className="panel-kicker">Отправка</p>
              <h3>Ручная рассылка</h3>
              <p>Отправка идёт всем активным получателям: руководителям и каждому бригадиру отдельно.</p>
            </div>
          </div>

          <div className="settings-send-grid settings-preview-filters">
            <div className="settings-send-block">
              <p className="settings-send-caption">Предпросмотр</p>
              <label className="filter-field settings-filter-field">
                <span>Тип рассылки</span>
                <select
                  value={previewAudience}
                  onChange={(event) => setPreviewAudience(event.target.value as ReportAudience)}
                >
                  <option value="managers">Руководители</option>
                  <option value="foremen">Бригадиры</option>
                </select>
              </label>
              {previewAudience === 'foremen' ? (
                <label className="filter-field settings-filter-field">
                  <span>Бригадир</span>
                  <select value={previewBrigade} onChange={(event) => setPreviewBrigade(event.target.value)}>
                    {TRACKED_BRIGADES.map((brigade) => (
                      <option key={brigade} value={brigade}>
                        {brigade}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          </div>

          <div className="settings-send-grid">
            <div className="settings-send-block">
              <DatePickerField
                label="День"
                value={selectedDate}
                dates={availableDates}
                onChange={setSelectedDate}
                disabled={!availableDates.length}
              />
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
              <label className="filter-field settings-filter-field">
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
            {sendStatus ?? 'Автоматическая рассылка по расписанию работает через Supabase pg_cron.'}
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
