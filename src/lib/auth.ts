import { formatEdgeFunctionError, getEdgeFunctionHeaders, getEdgeFunctionUrl, readEdgeFunctionJson } from './edgeFunctions'

const AUTH_STORAGE_KEY = 'legenda_settings_password'

export function getStoredPassword() {
  return sessionStorage.getItem(AUTH_STORAGE_KEY)?.trim() ?? ''
}

export function setStoredPassword(password: string) {
  sessionStorage.setItem(AUTH_STORAGE_KEY, password.trim())
}

export function clearStoredPassword() {
  sessionStorage.removeItem(AUTH_STORAGE_KEY)
}

export async function verifyPassword(password: string) {
  const trimmed = password.trim()
  if (!trimmed) {
    throw new Error('Введите пароль')
  }

  const url = new URL(getEdgeFunctionUrl('site-settings'))
  url.searchParams.set('action', 'verify')

  let response: Response
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: getEdgeFunctionHeaders(trimmed),
    })
  } catch {
    throw new Error('Не удалось связаться с сервером. Проверьте интернет и попробуйте снова.')
  }

  const payload = await readEdgeFunctionJson<{ ok?: boolean }>(response)
  if (!payload?.ok) {
    throw new Error(formatEdgeFunctionError('Неверный пароль'))
  }

  setStoredPassword(trimmed)
}
