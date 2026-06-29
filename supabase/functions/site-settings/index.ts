import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-settings-password',
}

const PUBLISHED_KEY = 'front_ui_text'
const DRAFT_KEY = 'front_ui_text_draft'

type SiteSettingsScope = 'published' | 'draft'

type SiteSettingsPayload = {
  value?: unknown
}

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders })
}

function getScope(request: Request): SiteSettingsScope | null {
  const scope = new URL(request.url).searchParams.get('scope') ?? 'published'
  return scope === 'published' || scope === 'draft' ? scope : null
}

function getKey(scope: SiteSettingsScope) {
  return scope === 'draft' ? DRAFT_KEY : PUBLISHED_KEY
}

function isValidValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isAuthorized(request: Request) {
  const expectedPassword = Deno.env.get('SETTINGS_ADMIN_PASSWORD')
  const requestPassword = request.headers.get('x-settings-password')

  if (!expectedPassword) {
    return { ok: false, response: jsonResponse({ error: 'SETTINGS_ADMIN_PASSWORD is not configured' }, 500) }
  }

  if (!requestPassword || requestPassword !== expectedPassword) {
    return { ok: false, response: jsonResponse({ error: 'Invalid settings password' }, 401) }
  }

  return { ok: true as const }
}

function getAdminClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return null
  }

  return createClient(supabaseUrl, serviceRoleKey)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const scope = getScope(request)
  if (!scope) {
    return jsonResponse({ error: 'Invalid scope' }, 400)
  }

  const supabase = getAdminClient()
  if (!supabase) {
    return jsonResponse({ error: 'Supabase service credentials are missing' }, 500)
  }

  if (request.method === 'GET') {
    if (scope === 'draft') {
      const auth = isAuthorized(request)
      if (!auth.ok) {
        return auth.response
      }
    }

    const { data, error } = await supabase
      .schema('analytics')
      .from('site_settings')
      .select('value,updated_at')
      .eq('key', getKey(scope))
      .maybeSingle<{ value: Record<string, unknown> | null; updated_at: string | null }>()

    if (error) {
      return jsonResponse({ error: error.message }, 500)
    }

    return jsonResponse({
      scope,
      value: data?.value ?? {},
      updatedAt: data?.updated_at ?? null,
    })
  }

  if (request.method !== 'PUT' && request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const auth = isAuthorized(request)
  if (!auth.ok) {
    return auth.response
  }

  const payload = (await request.json().catch(() => null)) as SiteSettingsPayload | null
  const value = payload?.value

  if (!isValidValue(value)) {
    return jsonResponse({ error: 'Invalid payload' }, 400)
  }

  if (request.method === 'PUT') {
    const { data, error } = await supabase
      .schema('analytics')
      .from('site_settings')
      .upsert({ key: DRAFT_KEY, value }, { onConflict: 'key' })
      .select('value,updated_at')
      .single<{ value: Record<string, unknown>; updated_at: string | null }>()

    if (error) {
      return jsonResponse({ error: error.message }, 500)
    }

    return jsonResponse({
      scope: 'draft',
      value: data.value,
      updatedAt: data.updated_at,
    })
  }

  const { data, error } = await supabase
    .schema('analytics')
    .from('site_settings')
    .upsert(
      [
        { key: PUBLISHED_KEY, value },
        { key: DRAFT_KEY, value },
      ],
      { onConflict: 'key' },
    )
    .select('key,value,updated_at')

  if (error) {
    return jsonResponse({ error: error.message }, 500)
  }

  const publishedRow = data.find((row) => row.key === PUBLISHED_KEY)

  return jsonResponse({
    scope: 'published',
    value: publishedRow?.value ?? value,
    updatedAt: publishedRow?.updated_at ?? null,
  })
})
