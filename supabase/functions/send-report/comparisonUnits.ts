// Правила по подразделениям в сравнении.
//
// В сравнении участвуют не только бригады: ИТР — инженерно-технические работники,
// у них есть активность, зоны и простои, но кубов они не выполняют. Поэтому во всех
// блоках про объёмы (ввод объёмов, динамика объёмов, выработка на человека,
// график «активность и выработка») такие подразделения не показываем.
//
// Копия этого файла лежит в src/lib/comparisonUnits.ts —
// правки нужно вносить в обе (как и для brigadeLayout.ts, brigadeOutputHeadcount.ts).
export const UNITS_WITHOUT_VOLUMES = ['ИТР']

/**
 * Кого не показываем в «Требуют внимания». У ИТР активность по природе работы 15-25%,
 * и при общем пороге они вытесняют из списка рабочих, ради которых блок и сделан.
 */
export const UNITS_WITHOUT_ATTENTION = ['ИТР']

function namesMatch(left: string, right: string) {
  return left.trim().toLocaleUpperCase('ru-RU') === right.trim().toLocaleUpperCase('ru-RU')
}

/** Ведёт ли подразделение объёмы работ. */
export function hasVolumeTracking(supervisorName: string) {
  return !UNITS_WITHOUT_VOLUMES.some((name) => namesMatch(name, supervisorName))
}

/** Попадает ли подразделение в блок «Требуют внимания». */
export function isAttentionTracked(supervisorName: string | null | undefined) {
  const name = supervisorName ?? ''
  return !UNITS_WITHOUT_ATTENTION.some((unit) => namesMatch(unit, name))
}

/** Убирает из списка «Требуют внимания» сотрудников подразделений, которые в него не входят. */
export function filterAttentionRows<T extends { supervisor_name: string | null }>(rows: readonly T[]): T[] {
  return rows.filter((row) => isAttentionTracked(row.supervisor_name))
}

/** Из списка сравнения оставляет только тех, у кого есть объёмы. */
export function filterVolumeUnits<T extends string | { supervisor_name: string }>(units: readonly T[]): T[] {
  return units.filter((unit) =>
    hasVolumeTracking(typeof unit === 'string' ? unit : unit.supervisor_name),
  )
}

/**
 * Порядок подразделений во всех блоках — как в списке сравнения из настроек
 * (сейчас: Джалол, ЛИ СОН ХАК, ИТР). Раньше сортировали по алфавиту, и один и тот же
 * ИТР оказывался то вторым, то третьим в разных блоках.
 */
export function compareByUnitOrder(order: readonly string[]) {
  const index = (name: string) => {
    const found = order.findIndex((unit) => namesMatch(unit, name))
    return found === -1 ? order.length : found
  }
  return (left: string, right: string) =>
    index(left) - index(right) || left.localeCompare(right, 'ru')
}
