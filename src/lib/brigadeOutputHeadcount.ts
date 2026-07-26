// Численность бригады для расчёта выработки на человека.
//
// По умолчанию берём среднее число рабочих в день по телеметрии (кто носит устройства).
// У ЛИ СОН ХАК устройства носят 20-25 человек, а объём выполняют 85 — по данным телеметрии
// выработка на человека получалась завышенной в 3-4 раза, поэтому численность фиксирована.
//
// Копия этого файла лежит в supabase/functions/send-report/brigadeOutputHeadcount.ts —
// правки нужно вносить в обе (как и для brigadeLayout.ts).
export const BRIGADE_OUTPUT_HEADCOUNT: Record<string, number> = {
  'ЛИ СОН ХАК': 85,
}

function namesMatch(left: string, right: string) {
  return left.trim().toLocaleUpperCase('ru-RU') === right.trim().toLocaleUpperCase('ru-RU')
}

/** Фиксированная численность бригады или null, если считаем по телеметрии. */
export function getFixedOutputHeadcount(supervisorName: string): number | null {
  const match = Object.entries(BRIGADE_OUTPUT_HEADCOUNT).find(([name]) => namesMatch(name, supervisorName))
  return match?.[1] ?? null
}

/**
 * Численность-знаменатель для выработки: фиксированная, если она задана для бригады,
 * иначе среднее по телеметрии (может быть null, тогда выработку не считаем).
 */
export function resolveOutputHeadcount(supervisorName: string, avgWorkersFromTelemetry: number | null) {
  const fixed = getFixedOutputHeadcount(supervisorName)
  if (fixed != null) return { workers: fixed, fixed: true }
  return { workers: avgWorkersFromTelemetry, fixed: false }
}
