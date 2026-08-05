import React, { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'

export default function LoginModal() {
  const { isAuthenticated, loading, defaultUsername, login } = useAuth()
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (defaultUsername) {
      setUsername(defaultUsername)
    }
  }, [defaultUsername])

  if (loading || isAuthenticated) {
    return null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrorMsg('')

    if (!username.trim()) {
      setErrorMsg('请输入账号')
      return
    }

    if (!password) {
      setErrorMsg('请输入密码')
      return
    }

    try {
      setSubmitting(true)
      await login(username.trim(), password)
    } catch (err) {
      if (err.response && err.response.status === 429) {
        setErrorMsg('尝试登录次数过多，IP 已被锁定，请 15 分钟后再试')
      } else {
        const msg = err.response?.data?.detail || '账号或密码错误，请重试'
        setErrorMsg(msg)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={headerStyle}>
          <div style={iconBadgeStyle}>
            🔒
          </div>
          <h2 style={{ margin: '12px 0 6px 0', fontSize: '20px', color: '#f3f4f6', fontWeight: 600 }}>
            管理员身份验证
          </h2>
          <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>
            请输入环境变量配置的系统账号与口令
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ marginTop: '20px' }}>
          {errorMsg && (
            <div style={errorBannerStyle}>
              {errorMsg}
            </div>
          )}

          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>账号 (Username)</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入管理员账号"
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={labelStyle}>密码 (Password)</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              autoFocus
              style={inputStyle}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            style={{
              ...buttonStyle,
              opacity: submitting ? 0.7 : 1,
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? '登录验证中...' : '立即登录'}
          </button>
        </form>
      </div>
    </div>
  )
}

// 样式定义
const overlayStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(10, 15, 29, 0.85)',
  backdropFilter: 'blur(8px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 99999,
}

const modalStyle = {
  width: '100%',
  maxWidth: '380px',
  backgroundColor: '#18181b',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  borderRadius: '16px',
  padding: '28px',
  boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
}

const headerStyle = {
  textAlign: 'center',
}

const iconBadgeStyle = {
  width: '48px',
  height: '48px',
  margin: '0 auto',
  borderRadius: '12px',
  backgroundColor: 'rgba(99, 102, 241, 0.15)',
  border: '1px solid rgba(99, 102, 241, 0.3)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '22px',
}

const labelStyle = {
  display: 'block',
  fontSize: '12px',
  color: '#d1d5db',
  marginBottom: '6px',
  fontWeight: 500,
}

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: '8px',
  border: '1px solid rgba(255, 255, 255, 0.15)',
  backgroundColor: '#27272a',
  color: '#f4f4f5',
  fontSize: '14px',
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 0.2s',
}

const buttonStyle = {
  width: '100%',
  padding: '12px',
  borderRadius: '8px',
  border: 'none',
  backgroundColor: '#6366f1',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: 600,
  marginTop: '8px',
  boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)',
  transition: 'all 0.2s',
}

const errorBannerStyle = {
  backgroundColor: 'rgba(239, 68, 68, 0.15)',
  border: '1px solid rgba(239, 68, 68, 0.3)',
  color: '#f87171',
  fontSize: '13px',
  padding: '8px 12px',
  borderRadius: '6px',
  marginBottom: '16px',
  textAlign: 'center',
}
