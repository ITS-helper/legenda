import type { ReactNode } from 'react'

type MetricDeepDivePanelProps = {
  children: ReactNode
}

export function MetricDeepDivePanel({ children }: MetricDeepDivePanelProps) {
  return (
    <details className="metric-settings-details">
      <summary className="metric-settings-details-summary">Подробней</summary>
      <div className="metric-settings-details-body">{children}</div>
    </details>
  )
}
