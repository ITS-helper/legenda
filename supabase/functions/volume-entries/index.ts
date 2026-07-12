import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSettingsAuthRole } from '../_shared/settingsAuth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-settings-password',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
}

type VolumeEntryInput = {
  label?: string
  value_text?: string
  note?: string | null
  sort_order?: number
}

type SavePayload = {
  report_date?: string
  entries?: VolumeEntryInput[]
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
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return null
  }

  return createClient(supabaseUrl, serviceRoleKey)
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function cleanText(value: unknown, maxLen: number) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLen)
}

function normalizeEntries(entries: VolumeEntryInput[]) {
  return entries
    .map((entry, index) => ({
      label: cleanText(entry.label, 200),
      value_text: cleanText(entry.value_text, 500),
      note: cleanText(entry.note, 1000) || null,
      sort_order: Number.isFinite(entry.sort_order) ? Number(entry.sort_order) : index,
    }))
    .filter((entry) => entry.value_text.length > 0)
}

function normalizeReportDate(value: string | null) {
  if (!value) return ''
  return value.trim().slice(0, 10)
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
    const role = getSettingsAuthRole(request)
    if (!role) {
      return jsonResponse({ error: 'Неверный пароль' }, 401)
    }

    const reportDate = normalizeReportDate(new URL(request.url).searchParams.get('date'))

    if (reportDate) {
      if (!isIsoDate(reportDate)) {
        return jsonResponse({ error: 'Некорректная дата' }, 400)
      }

      const { data, error } = await supabase
        .schema('analytics')
        .from('volume_entries')
        .select('id, report_date, label, value_text, note, sort_order, updated_at')
        .eq('report_date', reportDate)
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true })

      if (error) {
        return jsonResponse({ error: error.message }, 500)
      }

      return jsonResponse({ report_date: reportDate, entries: data ?? [] })
    }

    const { data, error } = await supabase
      .schema('analytics')
      .from('volume_entries')
      .select('report_date')
      .order('report_date', { ascending: false })

    if (error) {
      return jsonResponse({ error: error.message }, 500)
    }

    const dates = [...new Set((data ?? []).map((row) => normalizeReportDate(String(row.report_date))))].filter(Boolean)
    return jsonResponse({ dates })
  }

  if (request.method === 'PUT') {
    const auth = isAuthorized(request)
    if (!auth.ok) {
      return auth.response
    }

    const payload = (await request.json().catch(() => null)) as SavePayload | null
    const reportDate = payload?.report_date?.trim() ?? ''
    const entries = Array.isArray(payload?.entries) ? payload.entries : null

    if (!isIsoDate(reportDate)) {
      return jsonResponse({ error: 'Некорректная дата' }, 400)
    }

    if (!entries) {
      return jsonResponse({ error: 'Некорректный список записей' }, 400)
    }

    const normalized = normalizeEntries(entries)

    const { error: deleteError } = await supabase
      .schema('analytics')
      .from('volume_entries')
      .delete()
      .eq('report_date', reportDate)

    if (deleteError) {
      return jsonResponse({ error: deleteError.message }, 500)
    }

    if (normalized.length === 0) {
      return jsonResponse({ report_date: reportDate, entries: [] })
    }

    const { data, error: insertError } = await supabase
      .schema('analytics')
      .from('volume_entries')
      .insert(
        normalized.map((entry) => ({
          report_date: reportDate,
          label: entry.label,
          value_text: entry.value_text,
          note: entry.note,
          sort_order: entry.sort_order,
        })),
      )
      .select('id, report_date, label, value_text, note, sort_order, updated_at')
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true })

    if (insertError) {
      return jsonResponse({ error: insertError.message }, 500)
    }

    return jsonResponse({ report_date: reportDate, entries: data ?? [] })
  }

  return jsonResponse({ error: 'Method not allowed' }, 405)
})
