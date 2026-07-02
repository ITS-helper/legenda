# Google Drive Sync

## Purpose

Автоматически забирает три ежедневных отчета из Google Drive и загружает их в Supabase:

- `6_report_6_faceID - по сменам_LEGENDA_!NEW!_YYYY-MM-DD.xlsx`
- `11_отчет по АА_BLE со склейкой_LEGENDA_!NEW!_YYYY-MM-DD.xlsx`
- `8_report_8_LongIDLE_LEGENDA_!NEW!_YYYY-MM-DD.xlsx`

Папка-источник: [Google Drive folder LEGENDA](https://drive.google.com/drive/folders/1GozRP1VvLFkZooW9dQYuI_O-c5tqmRfO)

В корне лежат архивные подпапки. Скрипт смотрит **только** в три нужные папки и игнорирует остальные:

| Источник | Папка в Drive |
|----------|----------------|
| faceID | `6_report_6_faceID_arh` |
| AA_BLE | `aa_ble_arh` |
| LongIDLE | `8_report_8_LongIDLE_arh` |

Игнорируются:

- `100_report_alerts_arh`
- `10_report_10_long_idle_arh`

Внутри каждой архивной папки скрипт рекурсивно ищет `.xlsx` с нужной датой в имени файла.

## Расписание

GitHub Actions workflow [`.github/workflows/sync-drive-reports.yml`](../.github/workflows/sync-drive-reports.yml) запускается:

- `06:00 UTC` — 09:00 МСК
- `07:00 UTC` — 10:00 МСК (повтор)
- `08:00 UTC` — 11:00 МСК (повтор)

По умолчанию импортируется **вчерашний день по Europe/Moscow**.

## Required Env

- `VITE_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_DRIVE_FOLDER_ID` (по умолчанию `1GozRP1VvLFkZooW9dQYuI_O-c5tqmRfO`)
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`

## Service Account Setup

1. Создайте service account в Google Cloud Console.
2. Включите Google Drive API.
3. Скачайте JSON-ключ и возьмите `client_email` и `private_key`.
4. Расшарьте папку Drive на email service account с правом «Просмотр».
5. Добавьте secrets в GitHub:
   - `GOOGLE_DRIVE_FOLDER_ID`
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (с `\n` вместо переносов строк)

Для локального запуска добавьте те же переменные в `.env.local`.

## Commands

```bash
# Импорт вчерашнего дня по МСК
npm run sync:drive

# Импорт конкретной даты
npm run sync:drive -- --date 2026-07-01

# Принудительный переимпорт
npm run sync:drive -- --date 2026-07-01 --force
```

## Idempotency

- Batch key: `drive:YYYY-MM-DD`
- Если batch уже `ready` и `google_file_id` трёх файлов не изменились — импорт пропускается
- `--force` перезаписывает batch независимо от статуса

## Manual Backfill

В GitHub Actions откройте workflow **Sync Drive Reports** → **Run workflow**:

- `report_date`: `2026-07-01`
- `force`: `true` при необходимости переимпорта

## Troubleshooting

| Симптом | Что проверить |
|---------|----------------|
| `Не найдены файлы за YYYY-MM-DD` | Файлы ещё не появились в нужной архивной папке или дата в имени не совпадает |
| `invalid_grant` / auth error | `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` с корректными `\n` |
| `permission denied` | Папка расшарена на service account email |
| `long_idle_facts does not exist` | Применить `supabase/migrations/20260702_long_idle_and_drive.sql` в SQL Editor |

## Inspect Report Structure

```bash
npm run inspect:report -- --file "C:\path\to\8_report_8_LongIDLE_LEGENDA_!NEW!_2026-07-01.xlsx"
```
