import { useEffect, useState } from 'react'
import { defaultUiText, type UiText } from './content/uiText'
import { loadPublishedUiText } from './lib/siteSettings'
import { DashboardPage } from './pages/DashboardPage'
import { SettingsPage } from './pages/SettingsPage'
import './App.css'

type AppRoute = 'dashboard' | 'settings'

function getRouteFromHash(hash: string): AppRoute {
  return hash === '#/settings' ? 'settings' : 'dashboard'
}

function App() {
  const [route, setRoute] = useState<AppRoute>(() => getRouteFromHash(window.location.hash))
  const [uiText, setUiText] = useState<UiText>(defaultUiText)
  const [uiTextLoading, setUiTextLoading] = useState(true)
  const [uiTextError, setUiTextError] = useState<string | null>(null)

  useEffect(() => {
    const syncRoute = () => setRoute(getRouteFromHash(window.location.hash))

    window.addEventListener('hashchange', syncRoute)
    syncRoute()

    return () => {
      window.removeEventListener('hashchange', syncRoute)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function bootstrapUiText() {
      setUiTextLoading(true)
      setUiTextError(null)

      try {
        const next = await loadPublishedUiText()
        if (!cancelled) {
          setUiText(next)
          setUiTextLoading(false)
        }
      } catch (loadError) {
        if (!cancelled) {
          const message = loadError instanceof Error ? loadError.message : String(loadError)
          setUiText(defaultUiText)
          setUiTextError(message)
          setUiTextLoading(false)
        }
      }
    }

    void bootstrapUiText()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="app-shell">
      <header className="app-topbar">
        <a className="topbar-brand" href="#/">
          <img src={`${import.meta.env.BASE_URL}brand/legenda-logo.svg`} alt="Legenda" />
        </a>
        <nav className="topbar-nav">
          <a className={route === 'dashboard' ? 'topbar-link topbar-link-active' : 'topbar-link'} href="#/">
            Дашборд
          </a>
          <a className={route === 'settings' ? 'topbar-link topbar-link-active' : 'topbar-link'} href="#/settings">
            Настройки
          </a>
        </nav>
      </header>

      {route === 'settings' ? <SettingsPage /> : null}

      {route === 'dashboard' && uiTextLoading ? <section className="empty-state">Загружаем настройки интерфейса...</section> : null}
      {route === 'dashboard' && uiTextError ? (
        <section className="empty-state error-state">
          Не удалось загрузить опубликованные настройки: {uiTextError}
        </section>
      ) : null}

      {route === 'dashboard' && !uiTextLoading ? <DashboardPage uiText={uiText} /> : null}
    </main>
  )
}

export default App
