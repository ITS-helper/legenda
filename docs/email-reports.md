# Email Reports

Рассылка ежедневного и еженедельного отчётов заказчику на почту.

## Архитектура

Сайт статический (GitHub Pages), поэтому отправка идёт через Supabase Edge Function
[`supabase/functions/send-report/index.ts`](../supabase/functions/send-report/index.ts):

- собирает данные из view `brigade_daily_metrics` / `brigade_weekly_metrics` и `shift_daily_metrics` (КПП);
- рендерит HTML-письмо;
- отправляет через SMTP (denomailer);
- пишет результат в `analytics.email_log`.

Список получателей хранится в `analytics.email_recipients` и управляется через ту же функцию (эндпоинт `?resource=recipients`), доступ по паролю админки.

```mermaid
flowchart TD
  site["Дашборд / Settings"] -->|"x-settings-password"| fn["Edge function send-report"]
  cron["GitHub Actions cron"] -->|"schedule"| fn
  fn --> views["Supabase views (brigade daily/weekly, КПП)"]
  fn --> smtp["SMTP"]
  fn --> log["analytics.email_log"]
```

## Что в письме

- Ежедневный: вышло на смену (всего и по бригадам), активность %, простой %, список сотрудников на КПП (зона 13).
- Еженедельный: по бригадам за неделю (Пн–Вс) — чел./день, уникальные сотрудники, активность %, простой %, смены на КПП.

## Секреты

Edge function (через `supabase secrets set`):

- `SETTINGS_ADMIN_PASSWORD` — общий пароль админки (уже есть)
- `SMTP_HOST`, `SMTP_PORT` (по умолчанию 465), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_TLS` (`true`/`false`)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — проставляются платформой автоматически

GitHub Actions (для авторассылки):

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SETTINGS_ADMIN_PASSWORD` (уже есть)

## Деплой функции

```bash
supabase functions deploy send-report --no-verify-jwt
supabase secrets set SMTP_HOST=... SMTP_PORT=465 SMTP_USER=... SMTP_PASSWORD=... SMTP_FROM=... SMTP_TLS=true
```

## Расписание

Workflow [`.github/workflows/send-reports.yml`](../.github/workflows/send-reports.yml) (после импорта из Drive в **07:50 МСК**, см. [drive-sync.md](drive-sync.md)):

- `05:00 UTC` ежедневно (**08:00 МСК**) — первая попытка дневного отчёта за вчера;
- `05:30 UTC` по понедельникам (**08:30 МСК**) — недельный отчёт за прошлую неделю;
- `06:00 UTC` (**09:00 МСК**) — резервная попытка, если основной запуск пропущен.

Повторная отправка за тот же период по расписанию пропускается (см. `email_log`, `skipped: already_sent`).

Ручной запуск: Actions → **Send Reports** → Run workflow → выбрать `daily`/`weekly`.

## Ручная отправка с сайта

Страница **Настройки** (`#/settings`):

- загрузить список получателей (нужен пароль `SETTINGS_ADMIN_PASSWORD`);
- отправить дневной или недельный отчёт, либо открыть предпросмотр.

Пароль тот же, что в GitHub Secrets → `SETTINGS_ADMIN_PASSWORD` и в Supabase secrets.

## Управление получателями

Страница `#/settings` → блок «Получатели отчётов»:

- загрузить список (по паролю), отредактировать email/метку и флаги `Ежедневно` / `Еженедельно` / `Активен`, сохранить.
- флаги определяют, в какую рассылку попадёт адрес.

## Troubleshooting

| Симптом | Причина |
|---------|---------|
| `SMTP настройки не заданы` | Не проставлены секреты SMTP_* у функции |
| `Нет данных за период` | За выбранный день/неделю нет импортированных смен |
| Письмо не пришло, лог `failed` | Проверить SMTP-креды, порт/TLS, лимиты провайдера |
| Пустой список получателей | Добавить адреса в `#/settings` и включить нужный флаг |
