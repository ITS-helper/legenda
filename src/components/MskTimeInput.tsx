import { useEffect, useState } from 'react'
import { formatMskTimeFromMinutes, parseMskTimeToMinutes } from '../lib/mskTime'

type MskTimeInputProps = {
  value: number
  onChange: (minutes: number) => void
  disabled?: boolean
  className?: string
  min?: number
  max?: number
}

function clampMinutes(value: number, min?: number, max?: number) {
  let next = value
  if (min != null) next = Math.max(min, next)
  if (max != null) next = Math.min(max, next)
  return next
}

export function MskTimeInput({ value, onChange, disabled, className, min, max }: MskTimeInputProps) {
  const [draft, setDraft] = useState(() => formatMskTimeFromMinutes(value))

  useEffect(() => {
    setDraft(formatMskTimeFromMinutes(value))
  }, [value])

  function commit(raw: string) {
    const parsed = parseMskTimeToMinutes(raw)
    if (parsed == null) {
      setDraft(formatMskTimeFromMinutes(value))
      return
    }
    const next = clampMinutes(parsed, min, max)
    onChange(next)
    setDraft(formatMskTimeFromMinutes(next))
  }

  return (
    <div className={`msk-time-input${className ? ` ${className}` : ''}`}>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        placeholder="ЧЧ:ММ"
        disabled={disabled}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit(draft)
          }
        }}
      />
      <span className="msk-time-input-label">МСК</span>
    </div>
  )
}
