# Legenda

Фронтенд дашборда собирается Vite и публикуется на GitHub Pages. Данные аналитики и опубликованные настройки интерфейса хранятся в Supabase.

> **Архитектура проекта:** [docs/project-architecture.md](docs/project-architecture.md) — стек, потоки данных, блоки дашборда, view, edge functions.  
> **Определения метрик:** [docs/metrics-reference.md](docs/metrics-reference.md) — единый источник правды для подписей на сайте и в письмах.

## Что есть сейчас

- `#/` — дашборд из шести сворачиваемых блоков: ежедневная и еженедельная аналитика, динамика, зоны и простои, объёмы (ручной ввод), детализация по сотрудникам
- `#/settings` — настройки фронта, импорт отчётов и управление получателями рассылки
- Рассылка отчётов заказчику на почту (ежедневно/еженедельно) — см. [docs/email-reports.md](docs/email-reports.md)
- Справочник метрик (4 отчёта Workwatch) — [docs/metrics-reference.md](docs/metrics-reference.md)
- `npm run import:reports` — локальный импорт faceID + AA_BLE + LongIDLE
- `npm run sync:drive` — автоимпорт трёх файлов из Google Drive
- `supabase/site-settings.sql` — SQL для таблицы опубликованных настроек
- `supabase/migrations/20260702_long_idle_and_drive.sql` — LongIDLE и расширение `import_files`
- `supabase/migrations/20260703_dashboard_and_email.sql` — КПП, метрики по бригадам (день/неделя), получатели и лог рассылки
- `supabase/functions/site-settings/index.ts` — edge function для защищенной публикации настроек
- `supabase/functions/send-report/index.ts` — edge function рассылки отчётов (SMTP)
- `supabase/functions/volume-entries/index.ts` — ручной ввод объёмов за день
- `supabase/migrations/20260712_volume_entries.sql`, `20260713_volume_entries_rls.sql` — таблица объёмов и RLS

## Переменные окружения

Пример лежит в `.env.example`.

Обязательные для фронта:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Обязательные для backend-части настроек:

- `SUPABASE_SERVICE_ROLE_KEY`
- `SETTINGS_ADMIN_PASSWORD`

## Настройка Supabase для страницы настроек

1. Применить схему аналитики, если она еще не применена:
   - `supabase/schema.sql`
2. Применить таблицу настроек:
   - `supabase/site-settings.sql`
3. Задеплоить edge function `site-settings`.
4. Задать секрет edge function:
   - `SETTINGS_ADMIN_PASSWORD`
5. Убедиться, что фронтовой проект собран с `VITE_SUPABASE_URL` и `VITE_SUPABASE_PUBLISHABLE_KEY`.

### Пример команд Supabase CLI

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push
supabase db execute --file supabase/site-settings.sql
supabase secrets set SETTINGS_ADMIN_PASSWORD=<strong-password>
supabase functions deploy site-settings --no-verify-jwt
```

Если `db push` уже применяет `schema.sql` через миграции в вашем процессе, достаточно отдельно выполнить только `site-settings.sql`.

## Как работает публикация настроек

- Дашборд читает опубликованные тексты из `analytics.site_settings` по ключу `front_ui_text`.
- Страница `#/settings` редактирует черновик в браузере.
- Публикация идет через edge function с заголовком `x-settings-password`.
- Пароль не хранится в собранном фронте, он проверяется на стороне Supabase function.

## Деплой фронта

GitHub Pages workflow уже использует:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Для рабочего деплоя после добавления страницы настроек достаточно, чтобы эти secrets были заданы в GitHub Actions.
