# Local Import

## Purpose

Импорт трёх ежедневных отчётов в Supabase:

- `faceID`
- `AA_BLE`
- `LongIDLE`

## Command

```bash
npm run import:reports -- --face "C:\path\to\faceID.xlsx" --ble "C:\path\to\AA_BLE.xlsx" --long-idle "C:\path\to\LongIDLE.xlsx"
```

If file paths are omitted, the script will try:

- `LOCAL_FACEID_REPORT_PATH`
- `LOCAL_AA_BLE_REPORT_PATH`
- `LOCAL_LONG_IDLE_REPORT_PATH`
- matching files in the user's `Downloads` folder

Optional:

```bash
npm run import:reports -- --date 2026-07-01
```

## Required Env

- `VITE_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional:

- `LOCAL_FACEID_REPORT_PATH`
- `LOCAL_AA_BLE_REPORT_PATH`
- `LOCAL_LONG_IDLE_REPORT_PATH`

## What It Does

1. Reads `Sheet2` from all three XLSX files
2. Validates that all files belong to the same report date
3. Creates or reuses one daily `import_batches` record (`manual:YYYY-MM-DD`)
4. Replaces imported rows for that batch
5. Upserts lookup data: employees, supervisors, schedules
6. Upserts shifts and sessions from faceID
7. Inserts BLE minute facts and long idle facts
8. Marks the batch as `ready`

## Automatic Drive Import

For scheduled import from Google Drive see [drive-sync.md](./drive-sync.md).

## Inspect Headers

```bash
npm run inspect:report -- --file "C:\path\to\report.xlsx"
```
