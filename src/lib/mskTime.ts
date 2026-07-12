/** Все пользовательские временные рамки в проекте — по Europe/Moscow (МСК). */
export const MSK_TIME_ZONE = 'Europe/Moscow'

/** Минуты от полуночи МСК → «ЧЧ:ММ» (24-часовой формат). */
export function formatMskTimeFromMinutes(minutes: number) {
  const normalized = Math.max(0, Math.min(1440, Math.trunc(minutes)))
  if (normalized === 1440) return '24:00'
  const hour = Math.floor(normalized / 60)
  const minute = normalized % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** «ЧЧ:ММ» (24-часовой формат, МСК) → минуты от полуночи. */
export function parseMskTimeToMinutes(value: string) {
  const trimmed = value.trim()
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed)
  if (!match) return null

  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  if (hour === 24 && minute === 0) return 1440
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return hour * 60 + minute
}

export function minutesToHourMinute(minutes: number) {
  const normalized = Math.max(0, Math.min(1439, Math.trunc(minutes)))
  return {
    hour: Math.floor(normalized / 60),
    minute: normalized % 60,
  }
}

export function hourMinuteToMinutes(hour: number, minute: number) {
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return hour * 60 + minute
}
