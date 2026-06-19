# Legenda Analytics Architecture

## Goal

Build a customizable analytics site that replaces the current spreadsheet-based workflow and automatically ingests daily `.xls` reports from Google Drive into a database.

## Product Shape

The system should have three layers:

1. Frontend analytics app
2. Backend API
3. Data ingestion pipeline

## Recommended Stack

### Frontend

- React
- TypeScript
- Vite
- TanStack Router
- TanStack Query
- ECharts or Apache Superset-like chart layer built in-app

### Backend

- Node.js
- Fastify
- PostgreSQL
- Prisma

### Background Jobs

- Node worker with scheduled jobs
- Google Drive API for file discovery and download
- `xlsx` / SheetJS for parsing Excel reports

## Why This Shape

- The current repo already has a Vite React frontend, so we keep momentum there.
- Daily XLS ingestion needs a server-side process and should not live in the browser.
- PostgreSQL gives us reliable historical storage by date and room for derived aggregates.
- A dedicated worker lets us re-import, validate, and backfill reports safely.

## Data Flow

1. A scheduled worker checks a Google Drive folder once or several times per day.
2. The worker lists files and finds new reports by `google_file_id` or checksum.
3. Each new file is downloaded and stored as a raw import record.
4. The parser extracts rows from the XLS file into a staging table.
5. Validation rules check headers, date columns, required fields, and metric formats.
6. A transformer maps staging rows into normalized analytical tables.
7. The system upserts day-level facts into PostgreSQL.
8. The frontend reads prepared API endpoints for tables, filters, and charts.

## Google Drive Ingestion

### Source of Truth

We should treat the XLS files in Google Drive as the operational source and the database as the analytical source.

### Access Strategy

Best option:

- A dedicated Google service account with access to the target folder

Fallback option:

- OAuth with a technical Google user if service-account access is not possible

### Import Strategy

- Keep one configured Drive folder ID in server config
- Poll Drive on a schedule, for example every day at `06:00`, `09:00`, and `12:00`
- Save file metadata:
  - `google_file_id`
  - `file_name`
  - `modified_time`
  - `md5_checksum` if available
  - `report_date`
- Skip already imported files
- Allow manual re-import from admin UI later

## Parsing Strategy

We should assume the XLS format may drift over time. Because of that, import must be version-aware.

### Import Stages

1. `raw_imports`
   - one row per uploaded Drive file
   - stores metadata, import status, parser version, and error log

2. `staging_rows`
   - row-by-row copy of parsed spreadsheet content
   - minimal transformation

3. `fact tables`
   - normalized, validated business data

### Validation Rules

- required sheet names exist
- required columns exist
- report date can be determined
- rows with empty key identifiers are skipped or flagged
- numeric metrics are parsed consistently
- duplicates for the same entity and day are handled deterministically

## Proposed Data Model

The exact schema will depend on the final XLS columns, but this is the right baseline.

### Core Tables

- `report_files`
  - imported file registry

- `report_days`
  - one row per reporting day

- `employees`
  - employee reference data

- `teams`
  - team / group / supervisor structure

- `metrics`
  - metric dictionary
  - examples: conversion, calls, revenue, rank, score

- `daily_metric_values`
  - fact table with one metric value per entity per day

- `daily_snapshots`
  - optional denormalized snapshot for fast dashboard loading

### Important Principle

Do not hardcode the spreadsheet layout directly into dashboard components.

Instead:

- parse spreadsheet columns into a stable internal model
- map raw columns to metric keys
- let the UI read metrics by semantic IDs

That makes report changes survivable.

## Customizable Analytics UI

The site should support flexible analytics instead of a single hardcoded report page.

### MVP Capabilities

- date range filter
- employee / team / supervisor filters
- selectable metrics
- sortable table
- trend charts by day
- comparison widgets
- saved dashboard presets

### Recommended UI Model

Use dashboard configuration objects:

- widget type
- metric key
- grouping
- filters
- chart options

This will let us add constructor-like customization later without rebuilding the whole frontend.

## API Shape

### Read Endpoints

- `GET /api/dashboards`
- `GET /api/metrics`
- `GET /api/filters`
- `GET /api/analytics/table`
- `GET /api/analytics/timeseries`
- `GET /api/analytics/distribution`

### Admin Endpoints

- `POST /api/imports/run`
- `GET /api/imports`
- `GET /api/imports/:id`
- `POST /api/imports/:id/reprocess`

## Risks We Should Design For

- XLS column names change
- different files have slightly different sheet structure
- one day may be regenerated several times
- historical backfill may arrive later
- some metrics may be percentages, ranks, or formatted strings

## MVP Delivery Order

1. Freeze one sample XLS structure
2. Design the database schema
3. Build a local importer for one XLS file
4. Connect Google Drive polling
5. Expose analytics API
6. Build the first dashboard page
7. Add dashboard customization

## Immediate Next Step

We should get 2 to 5 real sample XLS reports from different dates and build the importer against real files before investing in the full UI.
