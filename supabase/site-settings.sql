create table if not exists analytics.site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function analytics.touch_site_settings()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_site_settings_updated_at on analytics.site_settings;
create trigger trg_site_settings_updated_at
before update on analytics.site_settings
for each row
execute function analytics.touch_site_settings();

insert into analytics.site_settings (key, value)
values ('front_ui_text', '{}'::jsonb)
on conflict (key) do nothing;

insert into analytics.site_settings (key, value)
values ('front_ui_text_draft', '{}'::jsonb)
on conflict (key) do nothing;

revoke all on analytics.site_settings from anon, authenticated;
grant select on analytics.site_settings to anon, authenticated;
grant select, insert, update, delete on analytics.site_settings to service_role;
