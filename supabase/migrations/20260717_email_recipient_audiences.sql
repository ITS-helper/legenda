-- Типы рассылки: руководители (вся аналитика) и бригадиры (по конкретной бригаде).

alter table analytics.email_recipients
  add column if not exists audience text not null default 'managers'
    check (audience in ('managers', 'foremen')),
  add column if not exists brigade_name text;

alter table analytics.email_recipients
  drop constraint if exists email_recipients_email_key;

create unique index if not exists email_recipients_unique_target
  on analytics.email_recipients (email, audience, coalesce(brigade_name, ''));

alter table analytics.email_recipients
  drop constraint if exists email_recipients_foremen_brigade;

alter table analytics.email_recipients
  add constraint email_recipients_foremen_brigade
  check (audience = 'managers' or brigade_name is not null);

alter table analytics.email_log
  add column if not exists audience text not null default 'managers',
  add column if not exists brigade_name text;
