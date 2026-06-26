# Legenda

Фронтенд дашборда собирается Vite и публикуется на GitHub Pages. Данные аналитики и опубликованные настройки интерфейса хранятся в Supabase.

## Что есть сейчас

- `#/` — основной дашборд
- `#/settings` — отдельная страница настроек фронта
- `supabase/site-settings.sql` — SQL для таблицы опубликованных настроек
- `supabase/functions/site-settings/index.ts` — edge function для защищенной публикации настроек

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
