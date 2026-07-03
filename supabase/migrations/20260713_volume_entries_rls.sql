-- Чтение объёмов с дашборда (anon): без политики RLS SELECT возвращает пустой список.
alter table analytics.volume_entries enable row level security;

drop policy if exists volume_entries_public_read on analytics.volume_entries;
create policy volume_entries_public_read
  on analytics.volume_entries
  for select
  to anon, authenticated
  using (true);
