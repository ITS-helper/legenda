import { useState } from 'react'
import { sendReport, type ReportType } from '../lib/emailReports'

type SendReportControlProps = {
  type: ReportType
  date?: string
  weekStart?: string
  disabled?: boolean
}

const PASSWORD_STORAGE_KEY = 'legenda-admin-password'

function readStoredPassword() {
  try {
    return sessionStorage.getItem(PASSWORD_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function storePassword(value: string) {
  try {
    sessionStorage.setItem(PASSWORD_STORAGE_KEY, value)
  } catch {
    /* ignore storage errors */
  }
}

export function SendReportControl({ type, date, weekStart, disabled }: SendReportControlProps) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState(readStoredPassword)
  const [busy, setBusy] = useState<'send' | 'preview' | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)

  const label = type === 'daily' ? 'Отправить дневной отчёт' : 'Отправить недельный отчёт'

  async function handleSend(preview: boolean) {
    if (!password.trim()) {
      setIsError(true)
      setStatus('Введите пароль админки')
      return
    }

    try {
      setBusy(preview ? 'preview' : 'send')
      setStatus(null)
      setIsError(false)
      storePassword(password)

      const result = await sendReport({ type, password, date, weekStart, preview })

      if (preview && result.previewHtml) {
        const previewWindow = window.open('', '_blank')
        if (previewWindow) {
          previewWindow.document.write(result.previewHtml)
          previewWindow.document.close()
        }
        setStatus('Предпросмотр открыт в новой вкладке')
      } else {
        setStatus(
          result.recipients.length > 0
            ? `Отправлено (${result.recipients.length}): ${result.recipients.join(', ')}`
            : 'Нет активных получателей для этого типа рассылки',
        )
      }
    } catch (error) {
      setIsError(true)
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  if (!open) {
    return (
      <button type="button" className="send-report-open" onClick={() => setOpen(true)} disabled={disabled}>
        {label}
      </button>
    )
  }

  return (
    <div className="send-report-panel">
      <div className="send-report-row">
        <input
          type="password"
          className="send-report-input"
          placeholder="Пароль админки"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="button" className="send-report-send" onClick={() => handleSend(false)} disabled={busy !== null}>
          {busy === 'send' ? 'Отправляем...' : 'Отправить'}
        </button>
        <button type="button" className="send-report-preview" onClick={() => handleSend(true)} disabled={busy !== null}>
          {busy === 'preview' ? '...' : 'Предпросмотр'}
        </button>
        <button type="button" className="send-report-close" onClick={() => setOpen(false)} disabled={busy !== null}>
          Скрыть
        </button>
      </div>
      {status ? <p className={`send-report-status${isError ? ' send-report-status-error' : ''}`}>{status}</p> : null}
    </div>
  )
}
