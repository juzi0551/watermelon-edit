import React from 'react'
import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom'
import { Layout, Typography, Button, Space } from 'antd'
import { SettingOutlined } from '@ant-design/icons'
import ProjectList from './pages/ProjectList'
import ProjectDetail from './pages/ProjectDetail'
import Settings from './pages/Settings'
import LLMDebug from './components/LLMDebug'

const { Header, Content, Footer } = Layout
const { Text } = Typography

function AppHeader() {
  const navigate = useNavigate()
  return (
    <Header style={{ background: '#1677ff', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <Link to="/" style={{ textDecoration: 'none' }}>
        <Text strong style={{ color: '#fff', fontSize: 18 }}>小说校稿工具</Text>
      </Link>
      <Space>
        <LLMDebug />
        <Button
          type="text"
          icon={<SettingOutlined style={{ color: '#fff', fontSize: 18 }} />}
          onClick={() => navigate('/settings')}
        />
      </Space>
    </Header>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout style={{ minHeight: '100vh' }}>
        <AppHeader />
        <Content style={{ padding: '24px 16px', background: '#f5f5f5' }}>
          <Routes>
            <Route path="/" element={<ProjectList />} />
            <Route path="/project/:projectId" element={<ProjectDetail />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </Content>
        <Footer style={{ textAlign: 'center' }}>
          <Text type="secondary">小说校稿工具 v0.1.0 · 基于 DeepSeek / Kimi 等大模型</Text>
        </Footer>
      </Layout>
    </BrowserRouter>
  )
}
