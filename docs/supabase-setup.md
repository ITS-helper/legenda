# Supabase Setup

## Current State

The project is locally configured for Supabase with:

- frontend publishable client env variables
- server-side secret env variable
- direct database URL stored only in local `.env.local`
- initial SQL schema in `supabase/schema.sql`

## Files

- `.env.example`
- `src/lib/supabase.ts`
- `supabase/schema.sql`

## Applying The Schema

Preferred option:

1. Open the Supabase project dashboard
2. Go to SQL Editor
3. Paste the contents of `supabase/schema.sql`
4. Run the query

## Why Manual SQL Editor May Be Needed

Direct `psql` access from the current environment failed before authentication because the database host resolved to an IPv6 address and the TCP connection was denied at the network layer.

That means:

- credentials may still be correct
- the blocker is network routing from this machine/session

## What The Schema Creates

- `analytics.import_batches`
- `analytics.import_files`
- `analytics.supervisors`
- `analytics.schedules`
- `analytics.employees`
- `analytics.shifts`
- `analytics.sessions`
- `analytics.ble_minute_facts`
- `analytics.shift_daily_metrics` view

## Next Step After Schema

1. Apply `supabase/migrations/20260702_long_idle_and_drive.sql` if the database was created before LongIDLE support.
2. Apply `supabase/migrations/20260707_weak_activity_long_idle.sql` — колонки `weak_activity_*` и `long_idle_*` в view (без неё на дашборде будет `NaN%`).
3. Configure Google Drive secrets for `npm run sync:drive` (see [docs/drive-sync.md](./drive-sync.md)).
4. Import a full day with `npm run import:reports` or wait for the scheduled GitHub Actions workflow.

### Как применить миграцию

**Вариант A — SQL Editor (надёжнее):**

1. Откройте [SQL Editor проекта legenda](https://supabase.com/dashboard/project/jcgurjybdipalekotphw/sql/new)
2. Вставьте содержимое файла `supabase/migrations/20260707_weak_activity_long_idle.sql`
3. Нажмите Run

**Вариант B — локально (если pooler доступен):**

```bash
npm install pg --no-save
npm run db:migrate -- supabase/migrations/20260707_weak_activity_long_idle.sql
```

Если `password authentication failed` — обновите пароль БД в Supabase Dashboard → Settings → Database и пропишите его в `SUPABASE_DB_URL` в `.env.local`.
