-- Настройка секретов для pg_cron → send-report.
-- Выполнить в Supabase SQL Editor после миграций 20260714 + 20260715.
--
-- Рекомендуется вариант A (отдельный cron-секрет).
-- Вариант B — пароль админки (должен совпадать с SETTINGS_ADMIN_PASSWORD у edge function).

-- === Вариант A (рекомендуется) ===
-- 1) Сгенерируйте случайную строку, например: openssl rand -hex 24
-- 2) Supabase CLI: supabase secrets set REPORT_CRON_SECRET=ВАША_СТРОКА
-- 3) Задеплойте send-report: supabase functions deploy send-report --no-verify-jwt

select vault.create_secret(
  'https://YOUR_PROJECT_REF.supabase.co',
  'report_cron_project_url',
  'Legenda send-report base URL'
);

select vault.create_secret(
  'YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY',
  'report_cron_anon_key',
  'Legenda send-report anon key'
);

select vault.create_secret(
  'ВАША_СТРОКА_ТАКАЯ_ЖЕ_КАК_REPORT_CRON_SECRET',
  'report_cron_secret',
  'Legenda send-report cron secret'
);

-- === Вариант B (если не хотите отдельный секрет) ===
-- Пароль должен ТОЧНО совпадать с SETTINGS_ADMIN_PASSWORD в secrets edge function.
-- Без лишних пробелов и кавычек.
--
-- select vault.create_secret(
--   'ваш_пароль_админки',
--   'report_cron_admin_password',
--   'Legenda send-report admin password'
-- );

-- Проверка метаданных Vault
select name, description
from vault.secrets
where name like 'report_cron_%'
order by name;

-- Проверка cron-задач
select jobid, jobname, schedule, active
from cron.job
where jobname like 'legenda-send-%'
order by jobname;

-- Тест (после деплоя send-report с REPORT_CRON_SECRET)
-- select analytics.invoke_scheduled_send_report('daily');
-- select id, status_code, content from net._http_response order by id desc limit 3;
