export type SettingsAuthRole = 'admin' | 'viewer'

export function getSettingsViewerPassword() {
  return Deno.env.get('SETTINGS_VIEWER_PASSWORD')?.trim() || 'LEGENDA_2026'
}

export function getSettingsAuthRole(request: Request): SettingsAuthRole | null {
  const requestPassword = request.headers.get('x-settings-password')?.trim()
  if (!requestPassword) return null

  const adminPassword = Deno.env.get('SETTINGS_ADMIN_PASSWORD')?.trim()
  if (adminPassword && requestPassword === adminPassword) return 'admin'

  if (requestPassword === getSettingsViewerPassword()) return 'viewer'

  return null
}
