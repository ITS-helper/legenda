-- Резервный планировщик импорта из Google Drive через pg_cron + pg_net.
-- Секреты — те же, что для рассылки (report_cron_* в Vault).

create or replace function analytics.invoke_scheduled_sync_drive(p_report_date text default null)
returns bigint
language plpgsql
security definer
set search_path = analytics, extensions, public, vault, pg_temp
as $$
declare
  request_id bigint;
  project_url text;
  anon_key text;
  cron_secret text;
  admin_password text;
  request_headers jsonb;
  request_body jsonb;
begin
  select trim(decrypted_secret) into project_url from vault.decrypted_secrets where name = 'report_cron_project_url' limit 1;
  select trim(decrypted_secret) into anon_key from vault.decrypted_secrets where name = 'report_cron_anon_key' limit 1;
  select trim(decrypted_secret) into cron_secret from vault.decrypted_secrets where name = 'report_cron_secret' limit 1;
  select trim(decrypted_secret) into admin_password from vault.decrypted_secrets where name = 'report_cron_admin_password' limit 1;

  if project_url is null or anon_key is null then
    raise notice 'drive sync cron: project_url/anon_key not configured, skip';
    return null;
  end if;

  request_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'apikey', anon_key,
    'Authorization', 'Bearer ' || anon_key
  );

  if cron_secret is not null and cron_secret <> '' then
    request_headers := request_headers || jsonb_build_object('x-report-cron-secret', cron_secret);
  elsif admin_password is not null and admin_password <> '' then
    request_headers := request_headers || jsonb_build_object('x-settings-password', admin_password);
  else
    raise notice 'drive sync cron: no auth secret configured, skip';
    return null;
  end if;

  request_body := '{}'::jsonb;
  if p_report_date is not null and trim(p_report_date) <> '' then
    request_body := jsonb_build_object('date', trim(p_report_date));
  end if;

  select net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/sync-drive',
    headers := request_headers,
    body := request_body,
    timeout_milliseconds := 300000
  )
  into request_id;

  return request_id;
end;
$$;

revoke all on function analytics.invoke_scheduled_sync_drive(text) from public;
grant execute on function analytics.invoke_scheduled_sync_drive(text) to postgres, service_role;

do $cron$
declare
  job record;
begin
  for job in
    select jobid from cron.job where jobname like 'legenda-sync-drive%'
  loop
    perform cron.unschedule(job.jobid);
  end loop;
end;
$cron$;

-- 07:50 МСК — основной импорт (04:50 UTC)
select cron.schedule(
  'legenda-sync-drive-early',
  '50 4 * * *',
  $$select analytics.invoke_scheduled_sync_drive(null);$$
);

-- 07:55 МСК
select cron.schedule(
  'legenda-sync-drive-retry-1',
  '55 4 * * *',
  $$select analytics.invoke_scheduled_sync_drive(null);$$
);

-- 08:00 и 08:05 МСК
select cron.schedule(
  'legenda-sync-drive-retry-2',
  '0,5 5 * * *',
  $$select analytics.invoke_scheduled_sync_drive(null);$$
);
