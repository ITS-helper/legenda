export function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message
    }
    if (typeof record.error_description === 'string' && record.error_description.trim()) {
      return record.error_description
    }
    if (typeof record.details === 'string' && record.details.trim()) {
      return record.details
    }
  }

  return 'Не удалось загрузить данные'
}
