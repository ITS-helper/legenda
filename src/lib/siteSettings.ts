import { defaultUiText, type UiText } from '../content/uiText'
import { supabase } from './supabase'
import { deepMergeUiText } from './uiTextEditor'

const SITE_SETTINGS_KEY = 'front_ui_text'

type SiteSettingsRow = {
  key: string
  value: Partial<UiText> | null
}

function getSiteSettingsFunctionUrl() {
  const supabaseUrl = new URL(import.meta.env.VITE_SUPABASE_URL)
  return `${supabaseUrl.origin}/functions/v1/site-settings`
}

export async function loadPublishedUiText() {
  const { data, error } = await supabase
    .schema('analytics')
    .from('site_settings')
    .select('key,value')
    .eq('key', SITE_SETTINGS_KEY)
    .maybeSingle<SiteSettingsRow>()

  if (error) {
    throw error
  }

  return deepMergeUiText(defaultUiText, data?.value ?? undefined)
}

export async function publishUiText(value: UiText, password: string) {
  const response = await fetch(getSiteSettingsFunctionUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-settings-password': password,
    },
    body: JSON.stringify({
      key: SITE_SETTINGS_KEY,
      value,
    }),
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error ?? `HTTP ${response.status}`)
  }

  return deepMergeUiText(defaultUiText, value)
}
