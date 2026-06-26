import type { UiText } from '../content/uiText'

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
