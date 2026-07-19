-- Цепочка импорта sync-drive: edge-функция обрабатывает AA_BLE порциями,
-- и каждое звено ставит следующее через эту функцию (pg_net). Так каждый вызов
-- остаётся в лимитах edge-рантайма (иначе — WORKER_RESOURCE_LIMIT).

create or replace function analytics.invoke_sync_drive_payload(p_body jsonb)
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
begin
  select trim(decrypted_secret) into project_url from vault.decrypted_secrets where name = 'report_cron_project_url' limit 1;
  select trim(decrypted_secret) into anon_key from vault.decrypted_secrets where name = 'report_cron_anon_key' limit 1;
  select trim(decrypted_secret) into cron_secret from vault.decrypted_secrets where name = 'report_cron_secret' limit 1;
  select trim(decrypted_secret) into admin_password from vault.decrypted_secrets where name = 'report_cron_admin_password' limit 1;

  if project_url is null or anon_key is null then
    raise exception 'sync-drive chain: project_url/anon_key not configured in vault';
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
    raise exception 'sync-drive chain: no auth secret configured in vault';
  end if;

  select net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/sync-drive',
    headers := request_headers,
    body := coalesce(p_body, '{}'::jsonb),
    timeout_milliseconds := 300000
  )
  into request_id;

  return request_id;
end;
$$;

revoke all on function analytics.invoke_sync_drive_payload(jsonb) from public;
grant execute on function analytics.invoke_sync_drive_payload(jsonb) to postgres, service_role;
