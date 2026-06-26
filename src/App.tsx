import { useEffect, useState } from 'react'
import { defaultUiText, type UiText } from './content/uiText'
import { loadPublishedUiText, publishUiText } from './lib/siteSettings'
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

  async function handlePublish(next: UiText, password: string) {
    const saved = await publishUiText(next, password)
    setUiText(saved)
  }

  return (
    <main className="app-shell">
      <header className="app-topbar">
        <a className={route === 'dashboard' ? 'topbar-link topbar-link-active' : 'topbar-link'} href="#/">
          Дашборд
        </a>
        <a className={route === 'settings' ? 'topbar-link topbar-link-active' : 'topbar-link'} href="#/settings">
          Настройки фронта
        </a>
      </header>

      {uiTextLoading ? <section className="empty-state">Загружаем настройки интерфейса...</section> : null}
      {uiTextError ? (
        <section className="empty-state error-state">
          Не удалось загрузить опубликованные настройки: {uiTextError}
        </section>
      ) : null}

      {!uiTextLoading && route === 'settings' ? (
        <SettingsPage initialUiText={uiText} onPublish={handlePublish} />
      ) : null}

      {!uiTextLoading && route === 'dashboard' ? <DashboardPage uiText={uiText} /> : null}
    </main>
  )
}

export default App
