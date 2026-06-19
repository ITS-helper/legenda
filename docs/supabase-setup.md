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

Build the first importer that:

1. reads local XLS files
2. parses `faceID` and `AA_BLE`
3. upserts rows into Supabase
4. computes day-level aggregates
