import { formatEdgeFunctionError, getEdgeFunctionHeaders, getEdgeFunctionUrl, readEdgeFunctionJson } from './edgeFunctions'

export type AuthRole = 'admin' | 'viewer'

const AUTH_STORAGE_KEY = 'legenda_settings_password'
const AUTH_ROLE_KEY = 'legenda_auth_role'

export function getStoredPassword() {
  return sessionStorage.getItem(AUTH_STORAGE_KEY)?.trim() ?? ''
}

export function getStoredAuthRole(): AuthRole | null {
  const role = sessionStorage.getItem(AUTH_ROLE_KEY)
  return role === 'admin' || role === 'viewer' ? role : null
}

export function setStoredPassword(password: string) {
  sessionStorage.setItem(AUTH_STORAGE_KEY, password.trim())
}

function setStoredAuthRole(role: AuthRole) {
  sessionStorage.setItem(AUTH_ROLE_KEY, role)
}

export function clearStoredPassword() {
  sessionStorage.removeItem(AUTH_STORAGE_KEY)
  sessionStorage.removeItem(AUTH_ROLE_KEY)
}

async function requestAuthRole(password: string): Promise<AuthRole> {
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

  const payload = await readEdgeFunctionJson<{ ok?: boolean; role?: AuthRole }>(response)
  if (!payload?.ok || (payload.role !== 'admin' && payload.role !== 'viewer')) {
    throw new Error(formatEdgeFunctionError('Неверный пароль'))
  }

  return payload.role
}

export async function verifyPassword(password: string): Promise<AuthRole> {
  const role = await requestAuthRole(password)
  setStoredPassword(password.trim())
  setStoredAuthRole(role)
  return role
}

export async function restoreAuthSession(): Promise<{ password: string; role: AuthRole } | null> {
  const stored = getStoredPassword()
  if (!stored) return null

  const role = await requestAuthRole(stored)
  setStoredAuthRole(role)
  return { password: stored, role }
}
