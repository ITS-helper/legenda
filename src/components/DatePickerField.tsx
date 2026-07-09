import { useEffect, useMemo, useRef, useState } from 'react'
import { formatFullDate } from '../lib/reports'

type DatePickerFieldProps = {
  label: string
  value: string
  dates: string[]
  onChange: (value: string) => void
  disabled?: boolean
}

const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

const MONTH_LABELS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
]

function parseIsoParts(iso: string) {
  const [year, month, day] = iso.split('-').map(Number)
  return { year, month, day }
}

function toIso(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function mondayBasedWeekday(year: number, month: number, day: number) {
  const weekday = new Date(year, month - 1, day).getDay()
  return weekday === 0 ? 6 : weekday - 1
}

function buildMonthGrid(year: number, month: number) {
  const firstWeekday = mondayBasedWeekday(year, month, 1)
  const daysInMonth = new Date(year, month, 0).getDate()
  const cells: Array<{ iso: string; day: number; inMonth: boolean }> = []

  for (let index = 0; index < firstWeekday; index += 1) {
    cells.push({ iso: '', day: 0, inMonth: false })
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ iso: toIso(year, month, day), day, inMonth: true })
  }
  while (cells.length % 7 !== 0) {
    cells.push({ iso: '', day: 0, inMonth: false })
  }
  return cells
}

export function DatePickerField({ label, value, dates, onChange, disabled = false }: DatePickerFieldProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const available = useMemo(() => new Set(dates), [dates])
  const initialMonth = value || dates[0] || new Date().toISOString().slice(0, 10)
  const [viewIso, setViewIso] = useState(initialMonth)

  useEffect(() => {
    if (value) setViewIso(value)
  }, [value])

  useEffect(() => {
    if (!open) return
    function handleOutsideClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [open])

  const { year, month } = parseIsoParts(viewIso.slice(0, 7) + '-01')
  const cells = buildMonthGrid(year, month)

  function shiftMonth(delta: number) {
    const next = new Date(year, month - 1 + delta, 1)
    setViewIso(toIso(next.getFullYear(), next.getMonth() + 1, 1))
  }

  const displayValue = value ? formatFullDate(value) : 'Выберите дату'

  return (
    <div className={`date-picker${open ? ' date-picker-open' : ''}`} ref={rootRef}>
      <label className="filter-field date-picker-field">
        <span>{label}</span>
        <button
          type="button"
          className="date-picker-trigger"
          disabled={disabled || dates.length === 0}
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <span>{displayValue}</span>
          <span className="date-picker-chevron" aria-hidden="true">
            ▾
          </span>
        </button>
      </label>

      {open ? (
        <div className="date-picker-popover" role="dialog" aria-label="Выбор даты">
          <div className="date-picker-popover-head">
            <button type="button" className="date-picker-nav" onClick={() => shiftMonth(-1)} aria-label="Предыдущий месяц">
              ‹
            </button>
            <strong>
              {MONTH_LABELS[month - 1]} {year}
            </strong>
            <button type="button" className="date-picker-nav" onClick={() => shiftMonth(1)} aria-label="Следующий месяц">
              ›
            </button>
          </div>
          <div className="date-picker-weekdays">
            {WEEKDAY_LABELS.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>
          <div className="date-picker-grid">
            {cells.map((cell, index) => {
              if (!cell.inMonth) {
                return <span key={`empty-${index}`} className="date-picker-day date-picker-day-empty" />
              }
              const isAvailable = available.has(cell.iso)
              const isSelected = cell.iso === value
              return (
                <button
                  key={cell.iso}
                  type="button"
                  className={[
                    'date-picker-day',
                    isSelected ? 'date-picker-day-selected' : '',
                    isAvailable ? '' : 'date-picker-day-disabled',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  disabled={!isAvailable}
                  onClick={() => {
                    onChange(cell.iso)
                    setOpen(false)
                  }}
                >
                  {cell.day}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
