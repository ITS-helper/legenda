import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { clearStoredPassword, getStoredPassword, verifyPassword } from '../lib/auth'

type AuthContextValue = {
  password: string
  isAuthenticated: boolean
  isBootstrapping: boolean
  login: (password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [password, setPassword] = useState('')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isBootstrapping, setIsBootstrapping] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function restoreSession() {
      const stored = getStoredPassword()
      if (!stored) {
        if (!cancelled) setIsBootstrapping(false)
        return
      }

      try {
        await verifyPassword(stored)
        if (!cancelled) {
          setPassword(stored)
          setIsAuthenticated(true)
        }
      } catch {
        clearStoredPassword()
        if (!cancelled) {
          setPassword('')
          setIsAuthenticated(false)
        }
      } finally {
        if (!cancelled) setIsBootstrapping(false)
      }
    }

    void restoreSession()

    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (nextPassword: string) => {
    await verifyPassword(nextPassword)
    setPassword(nextPassword.trim())
    setIsAuthenticated(true)
  }, [])

  const logout = useCallback(() => {
    clearStoredPassword()
    setPassword('')
    setIsAuthenticated(false)
  }, [])

  const value = useMemo(
    () => ({
      password,
      isAuthenticated,
      isBootstrapping,
      login,
      logout,
    }),
    [password, isAuthenticated, isBootstrapping, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
