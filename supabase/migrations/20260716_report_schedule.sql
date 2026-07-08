-- Настраиваемое время автоматической рассылки (pg_cron). Время задаётся в МСК,
-- pg_cron работает в UTC, поэтому при пересборке задач переводим МСК → UTC.

create table if not exists analytics.report_schedule (
  id boolean primary key default true,
  daily_enabled boolean not null default true,
  daily_hour int not null default 8 check (daily_hour between 0 and 23),
  daily_minute int not null default 0 check (daily_minute between 0 and 59),
  weekly_enabled boolean not null default true,
  weekly_dow int not null default 1 check (weekly_dow between 1 and 7), -- 1=Пн .. 7=Вс
  weekly_hour int not null default 8 check (weekly_hour between 0 and 23),
  weekly_minute int not null default 0 check (weekly_minute between 0 and 59),
  updated_at timestamptz not null default now(),
  constraint report_schedule_single_row check (id)
);

insert into analytics.report_schedule (id) values (true)
on conflict (id) do nothing;

grant select on analytics.report_schedule to service_role;

create or replace function analytics.get_report_schedule()
returns jsonb
language sql
security definer
set search_path = analytics, public, pg_temp
as $$
  select to_jsonb(r) from analytics.report_schedule r where r.id limit 1;
$$;

create or replace function analytics.apply_report_schedule()
returns void
language plpgsql
security definer
set search_path = analytics, extensions, cron, public, pg_temp
as $$
declare
  r analytics.report_schedule;
  d_utc_hour int;
  d_retry_total int;
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
    perform cron.schedule(
      'legenda-send-daily',
      format('%s %s * * *', r.daily_minute, d_utc_hour),
      $cmd$select analytics.invoke_scheduled_send_report('daily');$cmd$
    );

    -- Повторная попытка через 15 минут (на случай сетевого сбоя pg_net).
    d_retry_total := (d_utc_hour * 60 + r.daily_minute + 15) % 1440;
    perform cron.schedule(
      'legenda-send-daily-retry',
      format('%s %s * * *', d_retry_total % 60, d_retry_total / 60),
      $cmd$select analytics.invoke_scheduled_send_report('daily');$cmd$
    );
  end if;

  if r.weekly_enabled then
    w_utc_hour := ((r.weekly_hour - 3) % 24 + 24) % 24;
    w_day_off := case when r.weekly_hour - 3 < 0 then -1 else 0 end;
    w_dow_iso := ((r.weekly_dow - 1 + w_day_off) % 7 + 7) % 7 + 1; -- снова 1..7
    w_cron_dow := case when w_dow_iso = 7 then 0 else w_dow_iso end; -- вс=0 для cron

    perform cron.schedule(
      'legenda-send-weekly',
      format('%s %s * * %s', r.weekly_minute, w_utc_hour, w_cron_dow),
      $cmd$select analytics.invoke_scheduled_send_report('weekly');$cmd$
    );
  end if;
end;
$$;

create or replace function analytics.set_report_schedule(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = analytics, public, pg_temp
as $$
declare
  r analytics.report_schedule;
begin
  update analytics.report_schedule set
    daily_enabled  = coalesce((p->>'daily_enabled')::boolean, daily_enabled),
    daily_hour     = coalesce((p->>'daily_hour')::int, daily_hour),
    daily_minute   = coalesce((p->>'daily_minute')::int, daily_minute),
    weekly_enabled = coalesce((p->>'weekly_enabled')::boolean, weekly_enabled),
    weekly_dow     = coalesce((p->>'weekly_dow')::int, weekly_dow),
    weekly_hour    = coalesce((p->>'weekly_hour')::int, weekly_hour),
    weekly_minute  = coalesce((p->>'weekly_minute')::int, weekly_minute),
    updated_at     = now()
  where id
  returning * into r;

  perform analytics.apply_report_schedule();
  return to_jsonb(r);
end;
$$;

revoke all on function analytics.get_report_schedule() from public;
revoke all on function analytics.apply_report_schedule() from public;
revoke all on function analytics.set_report_schedule(jsonb) from public;
grant execute on function analytics.get_report_schedule() to service_role;
grant execute on function analytics.apply_report_schedule() to service_role, postgres;
grant execute on function analytics.set_report_schedule(jsonb) to service_role;

select analytics.apply_report_schedule();
