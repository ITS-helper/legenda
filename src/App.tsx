import { useEffect, useState } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { defaultUiText, type UiText } from './content/uiText'
import { loadPublishedUiText } from './lib/siteSettings'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'
import { SettingsPage } from './pages/SettingsPage'
import './App.css'

type AppRoute = 'dashboard' | 'settings'

function getRouteFromHash(hash: string): AppRoute {
  return hash === '#/settings' ? 'settings' : 'dashboard'
}

function AppContent() {
  const { isAuthenticated, isBootstrapping, login, logout } = useAuth()
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
    if (!isAuthenticated) {
      setUiTextLoading(false)
      return
    }

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
  }, [isAuthenticated])

  if (isBootstrapping) {
    return <main className="login-shell"><section className="empty-state">Проверяем сессию...</section></main>
  }

  if (!isAuthenticated) {
    return <LoginPage onLogin={login} />
  }

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
          <button type="button" className="topbar-link topbar-logout" onClick={logout}>
            Выйти
          </button>
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

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}

export default App
