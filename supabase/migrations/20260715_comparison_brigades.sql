-- Бригады (бригадиры), которые показываются на дашборде для сравнения.

alter table analytics.metric_settings
  add column if not exists comparison_brigades jsonb not null default '["Джалол", "ЛИ СОН ХАК"]'::jsonb;

create or replace function analytics.set_metric_settings(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = analytics, public, pg_temp
as $$
declare
  r analytics.metric_settings;
begin
  update analytics.metric_settings set
    long_idle_min = coalesce((p->>'long_idle_min')::int, long_idle_min),
    low_activity_pct = coalesce((p->>'low_activity_pct')::int, low_activity_pct),
    brigade_warn_pct = coalesce((p->>'brigade_warn_pct')::int, brigade_warn_pct),
    shift_target_total = coalesce((p->>'shift_target_total')::int, shift_target_total),
    brigade_target_jalol = coalesce((p->>'brigade_target_jalol')::int, brigade_target_jalol),
    brigade_target_li_son_hak = coalesce((p->>'brigade_target_li_son_hak')::int, brigade_target_li_son_hak),
    kpp_lunch_start_min = coalesce((p->>'kpp_lunch_start_min')::int, kpp_lunch_start_min),
    kpp_lunch_end_min = coalesce((p->>'kpp_lunch_end_min')::int, kpp_lunch_end_min),
    activity_sparkline_days = coalesce((p->>'activity_sparkline_days')::int, activity_sparkline_days),
    volume_sparkline_days = coalesce((p->>'volume_sparkline_days')::int, volume_sparkline_days),
    block_1_enabled = coalesce((p->>'block_1_enabled')::boolean, block_1_enabled),
    block_2_enabled = coalesce((p->>'block_2_enabled')::boolean, block_2_enabled),
    block_3_enabled = coalesce((p->>'block_3_enabled')::boolean, block_3_enabled),
    block_4_enabled = coalesce((p->>'block_4_enabled')::boolean, block_4_enabled),
    block_5_enabled = coalesce((p->>'block_5_enabled')::boolean, block_5_enabled),
    block_6_enabled = coalesce((p->>'block_6_enabled')::boolean, block_6_enabled),
    comparison_brigades = coalesce(
      (
        select jsonb_agg(trim(value))
        from jsonb_array_elements_text(coalesce(p->'comparison_brigades', comparison_brigades)) as value
        where trim(value) <> ''
      ),
      comparison_brigades
    ),
    updated_at = now()
  where id
  returning * into r;

  return to_jsonb(r) - 'id';
end;
$$;

grant execute on function analytics.set_metric_settings(jsonb) to service_role;
