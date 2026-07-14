import type { DashboardBlockId } from './dashboardBlocks'

export type SubblockId =
  | 'block1_summary'
  | 'block1_brigades'
  | 'block1_top_activity'
  | 'block1_attention'
  | 'block1_not_worn_panel'
  | 'block1_volume_card'
  | 'block2_brigades'
  | 'block2_top_activity'
  | 'block2_attention'
  | 'block3_activity_dynamics'
  | 'block3_volume_dynamics'
  | 'block4_location'
  | 'block4_idle'

export type SubblockDefinition = {
  id: SubblockId
  blockId: DashboardBlockId
  title: string
  note?: string
}

export const DASHBOARD_SUBBLOCKS: SubblockDefinition[] = [
  { id: 'block1_summary', blockId: 'block1', title: 'Сводные метрики', note: 'Карточки: смена, активность, КПП, ПВ…' },
  { id: 'block1_brigades', blockId: 'block1', title: 'Карточки бригад' },
  { id: 'block1_top_activity', blockId: 'block1', title: 'Топ-3 по активности' },
  { id: 'block1_attention', blockId: 'block1', title: 'Требуют внимания' },
  { id: 'block1_not_worn_panel', blockId: 'block1', title: 'Список «Не носил»', note: 'Подозрительное бездействие по бригадам' },
  { id: 'block1_volume_card', blockId: 'block1', title: 'Карточка «Объёмы»', note: 'Ссылка на блок 5' },
  { id: 'block2_brigades', blockId: 'block2', title: 'Карточки бригад' },
  { id: 'block2_top_activity', blockId: 'block2', title: 'Топ-3 по активности' },
  { id: 'block2_attention', blockId: 'block2', title: 'Требуют внимания' },
  { id: 'block3_activity_dynamics', blockId: 'block3', title: 'Динамика активности' },
  { id: 'block3_volume_dynamics', blockId: 'block3', title: 'Динамика объёмов', note: 'Требует блок 5' },
  { id: 'block4_location', blockId: 'block4', title: 'Местоположение по зонам' },
  { id: 'block4_idle', blockId: 'block4', title: 'Длительные простои' },
]

export const SUBBLOCK_IDS = DASHBOARD_SUBBLOCKS.map((item) => item.id)

export const DEFAULT_SUBBLOCK_VISIBILITY: Record<SubblockId, boolean> = Object.fromEntries(
  SUBBLOCK_IDS.map((id) => [id, true]),
) as Record<SubblockId, boolean>

export function getSubblocksForBlock(blockId: DashboardBlockId) {
  return DASHBOARD_SUBBLOCKS.filter((item) => item.blockId === blockId)
}

export function subblockSettingsKey(id: SubblockId): `subblock_${SubblockId}` {
  return `subblock_${id}`
}

export type SubblockSettingsKey = ReturnType<typeof subblockSettingsKey>
