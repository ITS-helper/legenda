import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  applyMetricSettings,
  DEFAULT_METRIC_SETTINGS,
  loadMetricSettings,
  type MetricSettings,
} from '../lib/metricSettings'

type MetricSettingsContextValue = {
  settings: MetricSettings
  loaded: boolean
  error: string | null
  refresh: () => Promise<void>
  setLocalSettings: (settings: MetricSettings) => void
}

const MetricSettingsContext = createContext<MetricSettingsContextValue>({
  settings: DEFAULT_METRIC_SETTINGS,
  loaded: false,
  error: null,
  refresh: async () => {},
  setLocalSettings: () => {},
})

export function MetricSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<MetricSettings>(DEFAULT_METRIC_SETTINGS)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const next = await loadMetricSettings()
      setSettings(next)
      applyMetricSettings(next)
      setLoaded(true)
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : String(loadError)
      setError(message)
      applyMetricSettings(DEFAULT_METRIC_SETTINGS)
      setSettings(DEFAULT_METRIC_SETTINGS)
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const setLocalSettings = useCallback((next: MetricSettings) => {
    setSettings(next)
    applyMetricSettings(next)
  }, [])

  const value = useMemo(
    () => ({ settings, loaded, error, refresh, setLocalSettings }),
    [settings, loaded, error, refresh, setLocalSettings],
  )

  return <MetricSettingsContext.Provider value={value}>{children}</MetricSettingsContext.Provider>
}

export function useMetricSettings() {
  return useContext(MetricSettingsContext)
}
