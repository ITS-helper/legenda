const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export function getEdgeFunctionUrl(functionName: string) {
  return new URL(`/functions/v1/${functionName}`, import.meta.env.VITE_SUPABASE_URL).toString()
}

export function getEdgeFunctionHeaders(password?: string, contentType = false) {
  if (!publishableKey) {
    throw new Error('Не задан VITE_SUPABASE_PUBLISHABLE_KEY')
  }

  const headers: Record<string, string> = {
    apikey: publishableKey,
    Authorization: `Bearer ${publishableKey}`,
  }

  if (contentType) {
    headers['Content-Type'] = 'application/json'
  }

  const trimmedPassword = password?.trim()
  if (trimmedPassword) {
    headers['x-settings-password'] = trimmedPassword
  }

  return headers
}

export function formatEdgeFunctionError(message: string) {
  if (message === 'Invalid settings password' || message === 'Неверный пароль админки') {
    return 'Неверный пароль админки. Используйте SETTINGS_ADMIN_PASSWORD из GitHub Secrets / Supabase.'
  }
  if (message === 'SETTINGS_ADMIN_PASSWORD is not configured') {
    return 'На сервере не настроен пароль админки (SETTINGS_ADMIN_PASSWORD).'
  }
  if (message === 'Supabase service credentials are missing') {
    return 'У edge function нет доступа к Supabase (service role).'
  }
  return message
}

export async function readEdgeFunctionJson<T>(response: Response) {
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null
  if (!response.ok) {
    throw new Error(formatEdgeFunctionError(payload?.error ?? `HTTP ${response.status}`))
  }
  return payload
}
