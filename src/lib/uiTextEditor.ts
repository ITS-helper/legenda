import type { UiText } from '../content/uiText'

const STORAGE_KEY = 'legenda-ui-text-overrides'

function normalizeLegacyUiText(value: Partial<UiText>): Partial<UiText> {
  const next = structuredClone(value) as Record<string, unknown> & {
    metrics?: Record<string, string>
    compareMeta?: Record<string, string>
    compareInsights?: Record<string, string>
  }

  if (next.metrics) {
    if (next.metrics.workNote === 'от трекаемого времени' || next.metrics.workNote === 'от времени в часах') {
      next.metrics.workNote = 'от общего времени'
    }

    if (next.metrics.idleNote === 'от трекаемого времени' || next.metrics.idleNote === 'от времени в часах') {
      next.metrics.idleNote = 'от общего времени'
    }

    if (next.metrics.sleepNote === 'от трекаемого времени' || next.metrics.sleepNote === 'от времени в часах') {
      next.metrics.sleepNote = 'от общего времени'
    }
  }

  if (next.compareMeta?.trackedSuffix === 'трекалось' || next.compareMeta?.trackedSuffix === 'под наблюдением') {
    next.compareMeta.trackedSuffix = 'время в часах'
  }

  if (next.compareInsights?.tracked === 'Под наблюдением') {
    next.compareInsights.tracked = 'Время в часах'
  }

  return next as Partial<UiText>
}

export function loadUiTextOverrides(): Partial<UiText> | null {
  if (typeof window === 'undefined') {
    return null
  }

  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<UiText>
    const normalized = normalizeLegacyUiText(parsed)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized, null, 2))
    return normalized
  } catch {
    return null
  }
}

export function saveUiTextOverrides(value: Partial<UiText>) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value, null, 2))
}

export function clearUiTextOverrides() {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.removeItem(STORAGE_KEY)
}

export function deepMergeUiText<T>(base: T, overrides?: Partial<T>): T {
  if (!overrides) {
    return base
  }

  const output = { ...base } as Record<string, unknown>

  for (const [key, value] of Object.entries(overrides as Record<string, unknown>)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof output[key] === 'object' &&
      output[key] !== null
    ) {
      output[key] = deepMergeUiText(
        output[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      )
    } else if (value !== undefined) {
      output[key] = value
    }
  }

  return output as T
}

export function downloadUiTextJson(value: Partial<UiText>) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'legenda-ui-text.json'
  link.click()
  URL.revokeObjectURL(url)
}

export async function applyUiTextToSource(value: UiText) {
  const response = await fetch('/__ui-text/apply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(value),
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error ?? `HTTP ${response.status}`)
  }

  return response.json()
}
