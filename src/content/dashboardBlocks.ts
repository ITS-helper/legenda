export type DashboardBlockId = 'block1' | 'block2' | 'block3' | 'block4' | 'block5' | 'block6' | 'block7'

export type DashboardBlockDefinition = {
  id: DashboardBlockId
  number: number
  kicker: string
  title: string
  description: string
  /** Где используется кроме дашборда */
  inReports: string
}

export const DASHBOARD_BLOCKS: DashboardBlockDefinition[] = [
  {
    id: 'block1',
    number: 1,
    kicker: 'Блок 1 · Ежедневно',
    title: 'Ежедневная аналитика',
    description: 'Сводка за день, карточки бригад, топ-3, «Требуют внимания», КПП.',
    inReports: 'Ежедневная рассылка: сводные метрики и карточки бригад',
  },
  {
    id: 'block2',
    number: 2,
    kicker: 'Блок 2 · Еженедельно',
    title: 'Еженедельная аналитика',
    description: 'Сводка за неделю (Пн–Вс) и карточки бригад.',
    inReports: 'Еженедельная рассылка: сводные метрики и карточки бригад',
  },
  {
    id: 'block3',
    number: 3,
    kicker: 'Блок 3 · Динамика',
    title: 'Динамика активности и выполненных работ',
    description: 'Сравнение с вчера и sparkline по активности и объёмам.',
    inReports: 'Ежедневная и еженедельная рассылка: блок динамики активности',
  },
  {
    id: 'block4',
    number: 4,
    kicker: 'Блок 4 · Зоны',
    title: 'Местоположение и простои',
    description: 'Распределение времени по зонам и длительные простои.',
    inReports: 'Ежедневная и еженедельная рассылка: зоны и простои',
  },
  {
    id: 'block5',
    number: 5,
    kicker: 'Блок 5 · Объёмы',
    title: 'Объёмы',
    description: 'Таблица выполненных объёмов (м³) и импорт GPR.',
    inReports: 'Еженедельная рассылка: объёмы и динамика объёмов; на дашборде — карточка в блоке 1',
  },
  {
    id: 'block6',
    number: 6,
    kicker: 'Блок 6 · Детализация',
    title: 'Детализация по сменам',
    description: 'Полная таблица смен с сортировкой, профессиями и поиском.',
    inReports: 'Только дашборд (в рассылку не входит)',
  },
  {
    id: 'block7',
    number: 7,
    kicker: 'Блок 7 · Ношение часов',
    title: 'Не носил',
    description: 'Подозрительное бездействие в окне рабочей смены.',
    inReports: 'Только дашборд (в рассылку не входит)',
  },
]

export const DEFAULT_BLOCK_VISIBILITY: Record<DashboardBlockId, boolean> = {
  block1: true,
  block2: true,
  block3: true,
  block4: true,
  block5: true,
  block6: true,
  block7: true,
}

import type { BooleanBlockSettingKey } from '../lib/metricSettings'

export const METRIC_BLOCK_ID_BY_TITLE: Record<string, DashboardBlockId> = {
  'Блок 1 · Ежедневная аналитика': 'block1',
  'Блок 2 · Еженедельная аналитика': 'block2',
  'Блок 3 · Динамика': 'block3',
  'Блок 4 · Местоположение и простои': 'block4',
  'Блок 5 · Объёмы': 'block5',
  'Блок 6 · Детализация': 'block6',
  'Блок 7 · Не носил': 'block7',
}

export function blockSettingsKey(id: DashboardBlockId): BooleanBlockSettingKey {
  const map: Record<DashboardBlockId, BooleanBlockSettingKey> = {
    block1: 'block1Enabled',
    block2: 'block2Enabled',
    block3: 'block3Enabled',
    block4: 'block4Enabled',
    block5: 'block5Enabled',
    block6: 'block6Enabled',
    block7: 'block7Enabled',
  }
  return map[id]
}

export function getDashboardBlock(id: DashboardBlockId) {
  return DASHBOARD_BLOCKS.find((block) => block.id === id)
}

export function dashboardBlockDomId(id: DashboardBlockId) {
  return `dashboard-block-${id}`
}

/** Подписи для липкой навигации на дашборде (короткие, только для полосы навигации). */
export const DASHBOARD_BLOCK_NAV: { id: DashboardBlockId; label: string }[] = [
  { id: 'block1', label: 'Ежедневная аналитика' },
  { id: 'block2', label: 'Еженедельная аналитика' },
  { id: 'block3', label: 'Динамика' },
  { id: 'block4', label: 'Местоположение и простои' },
  { id: 'block5', label: 'Объёмы' },
  { id: 'block6', label: 'Сотрудники' },
  { id: 'block7', label: 'Не носил' },
]
