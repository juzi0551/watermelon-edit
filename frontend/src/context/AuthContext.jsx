import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { getAuthStatus, loginPassword, logout as apiLogout } from '../services/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(true)
  const [loading, setLoading] = useState(true)
  const [defaultUsername, setDefaultUsername] = useState('admin')

  const checkAuth = useCallback(async () => {
    try {
      setLoading(true)
      const res = await getAuthStatus()
      if (res.username) {
        setDefaultUsername(res.username)
      }
      setIsAuthenticated(Boolean(res.token_valid))
    } catch (err) {
      console.error('检查鉴权状态失败:', err)
      setIsAuthenticated(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    checkAuth()

    const handleUnauthorized = () => {
      setIsAuthenticated(false)
      localStorage.removeItem('token')
    }

    window.addEventListener('auth:unauthorized', handleUnauthorized)
    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized)
    }
  }, [checkAuth])

  const handleLogin = async (username, password) => {
    const res = await loginPassword(username, password)
    setIsAuthenticated(true)
    return res
  }

  const handleLogout = () => {
    apiLogout()
    setIsAuthenticated(false)
  }

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        loading,
        defaultUsername,
        checkAuth,
        login: handleLogin,
        logout: handleLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth 必须在 AuthProvider 内部使用')
  }
  return context
}
