export type BrigadeLayoutMode = 'vertical' | 'horizontal'

/** Два прораба — слева и справа (вертикальные колонки). Три и более — друг под другом (горизонтальная лента). */
export function getBrigadeLayoutMode(count: number): BrigadeLayoutMode {
  return count >= 3 ? 'horizontal' : 'vertical'
}

export function brigadeLayoutClass(baseClass: string, count: number) {
  const mode = getBrigadeLayoutMode(count)
  return `${baseClass} ${baseClass}--${mode}`
}

/** Количество отслеживаемых прорабов из настроек — единый источник для раскладки блоков. */
export function brigadeLayoutCountFromNames(brigadeNames: readonly string[]) {
  const count = brigadeNames.map((name) => name.trim()).filter(Boolean).length
  return count > 0 ? count : 2
}
