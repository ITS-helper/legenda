import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-settings-password',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders })
  }

  const expectedPassword = Deno.env.get('SETTINGS_ADMIN_PASSWORD')
  const requestPassword = request.headers.get('x-settings-password')

  if (!expectedPassword) {
    return Response.json({ error: 'SETTINGS_ADMIN_PASSWORD is not configured' }, { status: 500, headers: corsHeaders })
  }

  if (!requestPassword || requestPassword !== expectedPassword) {
    return Response.json({ error: 'Invalid settings password' }, { status: 401, headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return Response.json({ error: 'Supabase service credentials are missing' }, { status: 500, headers: corsHeaders })
  }

  const payload = await request.json().catch(() => null) as { key?: string; value?: unknown } | null
  if (!payload?.key || typeof payload.value !== 'object' || payload.value === null || Array.isArray(payload.value)) {
    return Response.json({ error: 'Invalid payload' }, { status: 400, headers: corsHeaders })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const { error } = await supabase
    .schema('analytics')
    .from('site_settings')
    .upsert({ key: payload.key, value: payload.value }, { onConflict: 'key' })

  if (error) {
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders })
  }

  return Response.json({ ok: true }, { headers: corsHeaders })
})
