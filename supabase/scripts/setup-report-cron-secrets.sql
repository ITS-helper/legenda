-- Однократная настройка секретов для pg_cron → send-report.
-- Выполнить в Supabase SQL Editor после миграции 20260714_report_send_pg_cron.sql
--
-- Значения взять из:
--   report_cron_project_url      — VITE_SUPABASE_URL (https://xxxx.supabase.co)
--   report_cron_anon_key         — VITE_SUPABASE_PUBLISHABLE_KEY
--   report_cron_admin_password   — SETTINGS_ADMIN_PASSWORD

-- Если секрет уже есть — удалите старый в Dashboard → Database → Vault или используйте update.

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
  'YOUR_SETTINGS_ADMIN_PASSWORD',
  'report_cron_admin_password',
  'Legenda send-report admin password'
);

-- Проверка: должны вернуться 3 строки (значения не показываются)
select name, description
from vault.secrets
where name in (
  'report_cron_project_url',
  'report_cron_anon_key',
  'report_cron_admin_password'
);

-- Проверка cron-задач
select jobid, jobname, schedule, active
from cron.job
where jobname like 'legenda-send-%'
order by jobname;
