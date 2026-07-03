import { useState, type FormEvent } from 'react'

type LoginPageProps = {
  onLogin: (password: string) => Promise<void>
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      setBusy(true)
      setError(null)
      await onLogin(password)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <img className="login-logo" src={`${import.meta.env.BASE_URL}brand/legenda-logo.svg`} alt="Legenda" />
        <p className="panel-kicker">Legenda Analytics</p>
        <h1>Вход в систему</h1>

        <form className="login-form" onSubmit={(event) => void handleSubmit(event)}>
          <label className="login-field">
            <span>Пароль</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              disabled={busy}
              autoFocus
            />
          </label>

          <button type="submit" className="editor-action login-submit" disabled={busy || !password.trim()}>
            {busy ? 'Проверяем...' : 'Войти'}
          </button>
        </form>

        {error ? <p className="login-error">{error}</p> : null}
      </section>
    </main>
  )
}
