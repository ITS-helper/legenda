-- Расширить retry импорта и watchdog рассылки: GitHub Actions и Drive API часто опаздывают.

-- 1. Больше попыток sync-drive до 10:00 МСК (04:50–07:00 UTC)
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

select cron.schedule(
  'legenda-sync-drive-early',
  '50 4 * * *',
  $$select analytics.invoke_scheduled_sync_drive(null);$$
);

select cron.schedule(
  'legenda-sync-drive-retry',
  '55 4 * * *',
  $$select analytics.invoke_scheduled_sync_drive(null);$$
);

-- 08:00–10:00 МСК каждые 5 минут
select cron.schedule(
  'legenda-sync-drive-watchdog',
  '*/5 5-6 * * *',
  $$select analytics.invoke_scheduled_sync_drive(null);$$
);

select cron.schedule(
  'legenda-sync-drive-final',
  '0 7 * * *',
  $$select analytics.invoke_scheduled_sync_drive(null);$$
);

-- 2. apply_report_schedule: watchdog рассылки каждые 5 мин до +120 мин от настроенного времени
create or replace function analytics.apply_report_schedule()
returns void
language plpgsql
security definer
set search_path = analytics, extensions, cron, public, pg_temp
as $$
declare
  r analytics.report_schedule;
  d_utc_hour int;
  d_utc_min int;
  d_start_total int;
  d_end_total int;
  d_slot int;
  w_utc_hour int;
  w_day_off int;
  w_dow_iso int;
  w_cron_dow int;
  job record;
begin
  select * into r from analytics.report_schedule where id limit 1;
  if not found then
    return;
  end if;

  for job in select jobid from cron.job where jobname like 'legenda-send-%' loop
    perform cron.unschedule(job.jobid);
  end loop;

  if r.daily_enabled then
    d_utc_hour := ((r.daily_hour - 3) % 24 + 24) % 24;
    d_utc_min := r.daily_minute;
    d_start_total := (d_utc_hour * 60 + d_utc_min) % 1440;
    d_end_total := (d_start_total + 120) % 1440;

    d_slot := d_start_total;
    while true loop
      perform cron.schedule(
        format('legenda-send-daily-%s-%s', d_slot / 60, d_slot % 60),
        format('%s %s * * *', d_slot % 60, d_slot / 60),
        $cmd$select analytics.invoke_scheduled_send_report('daily');$cmd$
      );

      exit when d_slot = d_end_total;
      d_slot := (d_slot + 5) % 1440;
    end loop;
  end if;

  if r.weekly_enabled then
    w_utc_hour := ((r.weekly_hour - 3) % 24 + 24) % 24;
    w_day_off := case when r.weekly_hour - 3 < 0 then -1 else 0 end;
    w_dow_iso := ((r.weekly_dow - 1 + w_day_off) % 7 + 7) % 7 + 1;
    w_cron_dow := case when w_dow_iso = 7 then 0 else w_dow_iso end;

    perform cron.schedule(
      'legenda-send-weekly',
      format('%s %s * * %s', r.weekly_minute, w_utc_hour, w_cron_dow),
      $cmd$select analytics.invoke_scheduled_send_report('weekly');$cmd$
    );

    d_start_total := (w_utc_hour * 60 + r.weekly_minute + 15) % 1440;
    perform cron.schedule(
      'legenda-send-weekly-retry',
      format('%s %s * * %s', d_start_total % 60, d_start_total / 60, w_cron_dow),
      $cmd$select analytics.invoke_scheduled_send_report('weekly');$cmd$
    );
  end if;
end;
$$;

select analytics.apply_report_schedule();
