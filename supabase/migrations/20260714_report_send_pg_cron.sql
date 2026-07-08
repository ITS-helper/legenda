-- Резервный планировщик рассылки через pg_cron + pg_net (независимо от GitHub Actions).
-- Секреты для HTTP-вызова send-report — в Supabase Vault, см. supabase/scripts/setup-report-cron-secrets.sql

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create or replace function analytics.invoke_scheduled_send_report(p_report_type text)
returns bigint
language plpgsql
security definer
set search_path = analytics, extensions, public, vault, pg_temp
as $$
declare
  request_id bigint;
  project_url text;
  anon_key text;
  admin_password text;
begin
  if p_report_type not in ('daily', 'weekly') then
    raise exception 'unsupported report type: %', p_report_type;
  end if;

  select decrypted_secret
  into project_url
  from vault.decrypted_secrets
  where name = 'report_cron_project_url'
  limit 1;

  select decrypted_secret
  into anon_key
  from vault.decrypted_secrets
  where name = 'report_cron_anon_key'
  limit 1;

  select decrypted_secret
  into admin_password
  from vault.decrypted_secrets
  where name = 'report_cron_admin_password'
  limit 1;

  if project_url is null or anon_key is null or admin_password is null then
    raise notice 'report cron: vault secrets not configured, skip %', p_report_type;
    return null;
  end if;

  select net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/send-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', anon_key,
      'Authorization', 'Bearer ' || anon_key,
      'x-settings-password', admin_password,
      'x-triggered-by', 'schedule'
    ),
    body := jsonb_build_object('type', p_report_type),
    timeout_milliseconds := 120000
  )
  into request_id;

  return request_id;
end;
$$;

revoke all on function analytics.invoke_scheduled_send_report(text) from public;
grant execute on function analytics.invoke_scheduled_send_report(text) to postgres, service_role;

do $cron$
declare
  job record;
begin
  for job in
    select jobid
    from cron.job
    where jobname in (
      'legenda-send-daily-early',
      'legenda-send-daily-watchdog',
      'legenda-send-weekly-mon'
    )
  loop
    perform cron.unschedule(job.jobid);
  end loop;
end;
$cron$;

-- 07:52–07:58 МСК: сразу после типичного импорта (07:50)
select cron.schedule(
  'legenda-send-daily-early',
  '52,55,58 4 * * *',
  $$select analytics.invoke_scheduled_send_report('daily');$$
);

-- 08:00–08:30 МСК каждые 5 мин: watchdog, пока не уйдёт или не наступит дедлайн
select cron.schedule(
  'legenda-send-daily-watchdog',
  '0,5,10,15,20,25,30 5 * * *',
  $$select analytics.invoke_scheduled_send_report('daily');$$
);

-- Понедельник 08:25–08:30 МСК: недельный отчёт
select cron.schedule(
  'legenda-send-weekly-mon',
  '25,30 5 * * 1',
  $$select analytics.invoke_scheduled_send_report('weekly');$$
);
