# Local Import

## Purpose

This is the first importer for real daily reports:

- `faceID`
- `AA_BLE`

It loads one day of XLSX data into `Supabase` tables inside the `analytics` schema.

## Command

```bash
npm run import:reports -- --face "C:\path\to\faceID.xlsx" --ble "C:\path\to\AA_BLE.xlsx"
```

If file paths are omitted, the script will try:

- `LOCAL_FACEID_REPORT_PATH`
- `LOCAL_AA_BLE_REPORT_PATH`
- matching files in the user's `Downloads` folder

## Required Env

- `VITE_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional:

- `LOCAL_FACEID_REPORT_PATH`
- `LOCAL_AA_BLE_REPORT_PATH`

## What It Does

1. Reads `Sheet2` from both XLSX files
2. Validates that both files belong to the same report date
3. Creates or reuses one daily `import_batches` record
4. Replaces imported rows for that batch
5. Upserts lookup data:
   - employees
   - supervisors
   - schedules
6. Upserts:
   - shifts
   - sessions
   - ble minute facts
7. Marks the batch as `ready`

## Current Scope

This importer is local-first and intended for the validated sample files.

Next iteration:

- Drive folder polling
- automatic file download
- better parser versioning
- stronger validation and import logs
