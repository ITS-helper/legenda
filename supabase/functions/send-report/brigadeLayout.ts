export type BrigadeLayoutMode = 'vertical' | 'horizontal'

/** Два прораба — слева и справа (вертикальные колонки). Три и более — друг под другом (горизонтальная лента). */
export function getBrigadeLayoutMode(count: number): BrigadeLayoutMode {
  return count >= 3 ? 'horizontal' : 'vertical'
}

export function isHorizontalBrigadeLayout(count: number) {
  return getBrigadeLayoutMode(count) === 'horizontal'
}

/** Колонок в ряд: 2 прораба — две колонки, 3+ — одна (стопкой). */
export function brigadeGridColumns(count: number) {
  if (count >= 3) return 1
  if (count === 2) return 2
  return 1
}

export function isCompactBrigadeCardLayout(count: number) {
  return count === 2
}
