import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-settings-password',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders })
}

function isAuthorized(request: Request) {
  const expectedPassword = Deno.env.get('SETTINGS_ADMIN_PASSWORD')
  const requestPassword = request.headers.get('x-settings-password')

  if (!expectedPassword) {
    return { ok: false, response: jsonResponse({ error: 'SETTINGS_ADMIN_PASSWORD is not configured' }, 500) }
  }
  if (!requestPassword || requestPassword !== expectedPassword) {
    return { ok: false, response: jsonResponse({ error: 'Неверный пароль админки' }, 401) }
  }
  return { ok: true as const }
}

function getAdminClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'analytics' },
  })
}

const BOOL_FIELDS = [
  'block_1_enabled',
  'block_2_enabled',
  'block_3_enabled',
  'block_4_enabled',
  'block_5_enabled',
  'block_6_enabled',
  'block_7_enabled',
] as const

const SUBBLOCK_IDS = [
  'block1_summary',
  'block1_brigades',
  'block1_top_activity',
  'block1_attention',
  'block1_kpp_panel',
  'block1_volume_card',
  'block2_brigades',
  'block2_top_activity',
  'block2_attention',
  'block3_activity_dynamics',
  'block3_volume_dynamics',
  'block4_location',
  'block4_idle',
  'block7_summary',
  'block7_brigades',
  'block7_employees',
] as const

const ZONE_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const

const INT_FIELDS: Array<[string, number, number]> = [
  ['long_idle_min', 1, 180],
  ['low_activity_pct', 1, 100],
  ['brigade_warn_pct', 1, 100],
  ['shift_target_total', 1, 500],
  ['brigade_target_jalol', 1, 200],
  ['brigade_target_li_son_hak', 1, 200],
  ['kpp_lunch_start_min', 0, 1439],
  ['kpp_lunch_end_min', 1, 1440],
  ['activity_sparkline_days', 3, 60],
  ['volume_sparkline_days', 3, 60],
  ['not_worn_min_sec', 60, 7200],
  ['not_worn_warn_pct', 1, 100],
  ['not_worn_idle_sec_min', 30, 60],
  ['not_worn_active_sec_max', 0, 30],
]

function validatePayload(body: Record<string, unknown>): string | null {
  for (const key of BOOL_FIELDS) {
    if (body[key] === undefined || body[key] === null) continue
    if (typeof body[key] !== 'boolean') {
      return `Некорректное значение ${key}: ожидается true/false`
    }
  }
  for (const [key, min, max] of INT_FIELDS) {
    if (body[key] === undefined || body[key] === null) continue
    const value = Number(body[key])
    if (!Number.isInteger(value) || value < min || value > max) {
      return `Некорректное значение ${key}: ожидается ${min}–${max}`
    }
  }
  if (
    typeof body.kpp_lunch_start_min === 'number' &&
    typeof body.kpp_lunch_end_min === 'number' &&
    body.kpp_lunch_end_min <= body.kpp_lunch_start_min
  ) {
    return 'Конец обеда КПП должен быть позже начала'
  }
  if (body.comparison_brigades !== undefined && body.comparison_brigades !== null) {
    if (!Array.isArray(body.comparison_brigades)) {
      return 'comparison_brigades: ожидается массив строк'
    }
    if (body.comparison_brigades.length === 0) {
      return 'Нужна хотя бы одна бригада для сравнения'
    }
    for (const item of body.comparison_brigades) {
      if (typeof item !== 'string' || !item.trim()) {
        return 'comparison_brigades: каждый элемент должен быть непустой строкой'
      }
    }
  }
  if (body.subblock_visibility !== undefined && body.subblock_visibility !== null) {
    if (typeof body.subblock_visibility !== 'object' || Array.isArray(body.subblock_visibility)) {
      return 'subblock_visibility: ожидается объект'
    }
    for (const [key, value] of Object.entries(body.subblock_visibility as Record<string, unknown>)) {
      if (!SUBBLOCK_IDS.includes(key as (typeof SUBBLOCK_IDS)[number])) {
        return `subblock_visibility: неизвестный подблок ${key}`
      }
      if (typeof value !== 'boolean') {
        return `subblock_visibility.${key}: ожидается true/false`
      }
    }
  }
  if (body.zone_visibility !== undefined && body.zone_visibility !== null) {
    if (typeof body.zone_visibility !== 'object' || Array.isArray(body.zone_visibility)) {
      return 'zone_visibility: ожидается объект'
    }
    for (const [key, value] of Object.entries(body.zone_visibility as Record<string, unknown>)) {
      const zone = Number(key)
      if (!Number.isInteger(zone) || !ZONE_IDS.includes(zone as (typeof ZONE_IDS)[number])) {
        return `zone_visibility: неизвестная зона ${key}`
      }
      if (typeof value !== 'boolean') {
        return `zone_visibility.${key}: ожидается true/false`
      }
    }
  }
  if (body.not_worn_profession_rules !== undefined && body.not_worn_profession_rules !== null) {
    if (typeof body.not_worn_profession_rules !== 'object' || Array.isArray(body.not_worn_profession_rules)) {
      return 'not_worn_profession_rules: ожидается объект'
    }
    for (const [profession, rawRule] of Object.entries(body.not_worn_profession_rules as Record<string, unknown>)) {
      if (!profession.trim()) return 'not_worn_profession_rules: пустое имя профессии'
      if (!rawRule || typeof rawRule !== 'object' || Array.isArray(rawRule)) {
        return `not_worn_profession_rules.${profession}: ожидается объект`
      }
      for (const [field, value] of Object.entries(rawRule as Record<string, unknown>)) {
        if (!['idle_sec_min', 'active_sec_max', 'shift_min_sec', 'warn_pct'].includes(field)) {
          return `not_worn_profession_rules.${profession}.${field}: неизвестное поле`
        }
        const parsed = Number(value)
        if (!Number.isInteger(parsed)) {
          return `not_worn_profession_rules.${profession}.${field}: ожидается целое число`
        }
      }
    }
  }
  return null
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = getAdminClient()
  if (!supabase) {
    return jsonResponse({ error: 'Supabase service credentials are missing' }, 500)
  }

  if (request.method === 'GET') {
    const { data, error } = await supabase.rpc('get_metric_settings')
    if (error) return jsonResponse({ error: error.message }, 500)
    return jsonResponse({ settings: data ?? {} })
  }

  if (request.method === 'PUT') {
    const auth = isAuthorized(request)
    if (!auth.ok) return auth.response

    const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!payload) return jsonResponse({ error: 'Ожидается объект настроек' }, 400)

    const invalid = validatePayload(payload)
    if (invalid) return jsonResponse({ error: invalid }, 400)

    const { data, error } = await supabase.rpc('set_metric_settings', { p: payload })
    if (error) return jsonResponse({ error: error.message }, 500)
    return jsonResponse({ settings: data })
  }

  return jsonResponse({ error: 'Method not allowed' }, 405)
})
