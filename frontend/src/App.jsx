import React, { useState, useEffect, createContext, useContext } from 'react'
import { BrowserRouter, Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Typography, Button, Space, ConfigProvider, Dropdown, theme as antdTheme } from 'antd'
import { SettingOutlined, SunOutlined, MoonOutlined, DesktopOutlined } from '@ant-design/icons'
import zhCN from 'antd/locale/zh_CN'
import ProjectList from './pages/ProjectList'
import ProjectDetail from './pages/ProjectDetail'
import Settings from './pages/Settings'
import LLMDebug from './components/LLMDebug'
import ThemeSwitcher from './components/ThemeSwitcher'
import { applyThemeVariables, color } from './design-tokens'
import { AuthProvider } from './context/AuthContext'
import LoginModal from './components/Auth/LoginModal'

const { Header, Content, Footer } = Layout
const { Text } = Typography

import { ThemeContext, useTheme } from './context/ThemeContext'
export { ThemeContext, useTheme }

function getSystemTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
}

import { UserOutlined, LockOutlined, LogoutOutlined } from '@ant-design/icons'
import { useAuth } from './context/AuthContext'
import ChangePasswordModal from './components/Auth/ChangePasswordModal'

function AppHeader() {
  const navigate = useNavigate()
  const { defaultUsername, logout } = useAuth()
  const [changePwdOpen, setChangePwdOpen] = useState(false)

  const userMenuItems = [
    {
      key: 'user-title',
      label: <Text disabled style={{ fontSize: '12px' }}>账号: {defaultUsername}</Text>,
    },
    { type: 'divider' },
    {
      key: 'change-pwd',
      icon: <LockOutlined />,
      label: '修改密码',
      onClick: () => setChangePwdOpen(true),
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      danger: true,
      onClick: () => logout(),
    },
  ]

  return (
    <>
      <Header style={{ background: '#374151', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link to="/" style={{ textDecoration: 'none' }}>
          <Text strong style={{ color: '#fff', fontSize: 18 }}>Watermelon Edit</Text>
        </Link>
        <Space size="middle">
          <ThemeSwitcher buttonType="text" buttonStyle={{ color: '#fff' }} />
          <LLMDebug />
          <Button
            type="text"
            icon={<SettingOutlined style={{ color: '#fff', fontSize: 18 }} />}
            onClick={() => navigate('/settings')}
          />
          <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
            <Button
              type="text"
              icon={<UserOutlined style={{ color: '#fff', fontSize: 18 }} />}
            />
          </Dropdown>
        </Space>
      </Header>
      <ChangePasswordModal
        open={changePwdOpen}
        onCancel={() => setChangePwdOpen(false)}
      />
    </>
  )
}

function AppLayout() {
  const location = useLocation()
  const isDetail = location.pathname.startsWith('/project/')
  return (
    <Layout style={{ minHeight: '100vh', background: 'var(--color-bgPage)' }}>
      {!isDetail && <AppHeader />}
      <Content style={{ padding: isDetail ? 0 : '24px 16px', background: 'var(--color-bgPage)' }}>
        <Routes>
          <Route path="/" element={<ProjectList />} />
          <Route path="/project/:projectId" element={<ProjectDetail />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Content>
      <Footer style={{ textAlign: 'center', background: 'var(--color-bgCard)', borderTop: '1px solid var(--color-border)', padding: '12px 16px' }}>
        <Text type="secondary">Watermelon Edit v0.1.0 · 基于 DeepSeek / Kimi 等大模型</Text>
      </Footer>
      <LoginModal />
    </Layout>
  )
}

export default function App() {
  const [themeMode, setThemeModeState] = useState(() => {
    return localStorage.getItem('theme_mode') || 'system'
  })

  const [systemIsDark, setSystemIsDark] = useState(getSystemTheme)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (e) => setSystemIsDark(e.matches)
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    } else {
      mediaQuery.addListener(handleChange)
      return () => mediaQuery.removeListener(handleChange)
    }
  }, [])

  const setThemeMode = (mode) => {
    setThemeModeState(mode)
    localStorage.setItem('theme_mode', mode)
  }

  const isDark = themeMode === 'dark' || (themeMode === 'system' && systemIsDark)

  useEffect(() => {
    applyThemeVariables(isDark)
  }, [isDark])

  const themeConfig = {
    locale: zhCN,
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: isDark ? '#d4a359' : '#374151',
      colorLink: isDark ? '#d4a359' : '#374151',
      colorLinkHover: isDark ? '#f5d089' : '#1f2937',
      colorLinkActive: isDark ? '#c28e45' : '#111827',
      colorBgBase: isDark ? '#141414' : '#ffffff',
      colorBgContainer: isDark ? '#1f1f1f' : '#ffffff',
      colorBgLayout: isDark ? '#141414' : '#f5f5f5',
      colorTextBase: isDark ? '#e6e6e6' : '#333333',
      colorText: isDark ? '#e6e6e6' : '#333333',
      colorTextHeading: isDark ? '#f0f0f0' : '#111111',
      colorTextSecondary: isDark ? '#a6a6a6' : '#666666',
      colorBorder: isDark ? '#303030' : '#f0f0f0',
      colorBorderSecondary: isDark ? '#424242' : '#e8e8e8',
      borderRadius: 8,
    },
  }

  return (
    <ThemeContext.Provider value={{ themeMode, setThemeMode, isDark }}>
      <ConfigProvider {...themeConfig}>
        <AuthProvider>
          <BrowserRouter>
            <AppLayout />
          </BrowserRouter>
        </AuthProvider>
      </ConfigProvider>
    </ThemeContext.Provider>
  )
}

