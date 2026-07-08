-- pg_cron → send-report: trim секретов и auth через REPORT_CRON_SECRET (предпочтительно).

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
  cron_secret text;
  admin_password text;
  request_headers jsonb;
begin
  if p_report_type not in ('daily', 'weekly') then
    raise exception 'unsupported report type: %', p_report_type;
  end if;

  select trim(decrypted_secret)
  into project_url
  from vault.decrypted_secrets
  where name = 'report_cron_project_url'
  limit 1;

  select trim(decrypted_secret)
  into anon_key
  from vault.decrypted_secrets
  where name = 'report_cron_anon_key'
  limit 1;

  select trim(decrypted_secret)
  into cron_secret
  from vault.decrypted_secrets
  where name = 'report_cron_secret'
  limit 1;

  select trim(decrypted_secret)
  into admin_password
  from vault.decrypted_secrets
  where name = 'report_cron_admin_password'
  limit 1;

  if project_url is null or anon_key is null then
    raise notice 'report cron: project_url/anon_key not configured, skip %', p_report_type;
    return null;
  end if;

  request_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'apikey', anon_key,
    'Authorization', 'Bearer ' || anon_key,
    'x-triggered-by', 'schedule'
  );

  if cron_secret is not null and cron_secret <> '' then
    request_headers := request_headers || jsonb_build_object('x-report-cron-secret', cron_secret);
  elsif admin_password is not null and admin_password <> '' then
    request_headers := request_headers || jsonb_build_object('x-settings-password', admin_password);
  else
    raise notice 'report cron: no auth secret configured, skip %', p_report_type;
    return null;
  end if;

  select net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/send-report',
    headers := request_headers,
    body := jsonb_build_object('type', p_report_type),
    timeout_milliseconds := 120000
  )
  into request_id;

  return request_id;
end;
$$;

revoke all on function analytics.invoke_scheduled_send_report(text) from public;
grant execute on function analytics.invoke_scheduled_send_report(text) to postgres, service_role;
