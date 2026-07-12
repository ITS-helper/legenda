import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { clearStoredPassword, restoreAuthSession, verifyPassword, type AuthRole } from '../lib/auth'

type AuthContextValue = {
  password: string
  role: AuthRole | null
  isAdmin: boolean
  isReadOnly: boolean
  isAuthenticated: boolean
  isBootstrapping: boolean
  login: (password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<AuthRole | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isBootstrapping, setIsBootstrapping] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function restoreSession() {
      try {
        const session = await restoreAuthSession()
        if (!cancelled && session) {
          setPassword(session.password)
          setRole(session.role)
          setIsAuthenticated(true)
        }
      } catch {
        clearStoredPassword()
        if (!cancelled) {
          setPassword('')
          setRole(null)
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
    const nextRole = await verifyPassword(nextPassword)
    setPassword(nextPassword.trim())
    setRole(nextRole)
    setIsAuthenticated(true)
  }, [])

  const logout = useCallback(() => {
    clearStoredPassword()
    setPassword('')
    setRole(null)
    setIsAuthenticated(false)
  }, [])

  const value = useMemo(
    () => ({
      password,
      role,
      isAdmin: role === 'admin',
      isReadOnly: role === 'viewer',
      isAuthenticated,
      isBootstrapping,
      login,
      logout,
    }),
    [password, role, isAuthenticated, isBootstrapping, login, logout],
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
