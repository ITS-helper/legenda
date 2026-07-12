import type { ReactNode } from 'react'
import type { MetricDefinition } from '../content/metricDefinitions'
import { METRIC_BLOCKS } from '../content/metricDefinitions'

export const METRIC_SETTINGS_BRIGADES_SECTION_ID = 'metric-section-brigades'

export function metricBlockSectionId(blockTitle: string) {
  return `metric-section-${blockTitle.replace(/[^a-zA-Z0-9а-яА-Я]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}`
}

export function metricBlockDisplayTitle(blockTitle: string) {
  return blockTitle.replace(/^Блок \d+ · /, '')
}

export function buildDefaultOpenSections() {
  const sections: Record<string, boolean> = {
    [METRIC_SETTINGS_BRIGADES_SECTION_ID]: true,
  }
  for (const [index, block] of METRIC_BLOCKS.entries()) {
    sections[metricBlockSectionId(block)] = index === 0
  }
  return sections
}

export function metricMatchesSearch(metric: MetricDefinition, query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true

  const haystack = [
    metric.title,
    metric.description,
    metric.block,
    metric.formula,
    metric.notes ?? '',
    ...metric.sources,
    ...(metric.configFields?.map((field) => `${field.label} ${field.unit ?? ''} ${field.hint ?? ''}`) ?? []),
  ]
    .join(' ')
    .toLowerCase()

  return haystack.includes(normalized)
}

export function brigadesSectionMatchesSearch(query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  const haystack = 'бригады для сравнения бригадир'
  return haystack.includes(normalized) || normalized.includes('бриг')
}

type CollapsibleMetricSectionProps = {
  id: string
  title: string
  subtitle?: ReactNode
  open: boolean
  onToggle: () => void
  headerExtra?: ReactNode
  children: ReactNode
  hidden?: boolean
}

export function CollapsibleMetricSection({
  id,
  title,
  subtitle,
  open,
  onToggle,
  headerExtra,
  children,
  hidden,
}: CollapsibleMetricSectionProps) {
  if (hidden) return null

  return (
    <section id={id} className={`metric-settings-block-section${open ? ' is-open' : ' is-collapsed'}`}>
      <div className="metric-settings-block-head">
        <button type="button" className="metric-settings-section-toggle" onClick={onToggle} aria-expanded={open}>
          <span className="metric-settings-section-chevron" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <span className="metric-settings-section-heading">
            <span className="metric-settings-block-title">{title}</span>
            {subtitle ? <span className="metric-settings-block-note">{subtitle}</span> : null}
          </span>
        </button>
        {headerExtra}
      </div>
      {open ? <div className="metric-settings-section-body">{children}</div> : null}
    </section>
  )
}
