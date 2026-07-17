import React, { useState, useEffect, useRef } from 'react'
import { Button, Drawer, Spin, Empty, Tag, Card, Typography, Space, message } from 'antd'
import { CodeOutlined, ReloadOutlined } from '@ant-design/icons'
import { getLLMLog } from '../services/api'

const { Text, Paragraph } = Typography

const preStyle = {
  maxHeight: 280,
  overflow: 'auto',
  background: '#fafafa',
  padding: 8,
  borderRadius: 4,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  margin: '4px 0 0',
  fontSize: 12,
}

export default function LLMDebug() {
  const [open, setOpen] = useState(false)
  const [calls, setCalls] = useState([])
  const [loading, setLoading] = useState(false)
  const timer = useRef(null)

  const load = async () => {
    setLoading(true)
    try {
      const data = await getLLMLog()
      setCalls(data || [])
    } catch (e) {
      message.error('加载调试日志失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      load()
      timer.current = setInterval(load, 3000)
    }
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [open])

  return (
    <>
      <Button
        type="text"
        icon={<CodeOutlined style={{ color: '#fff', fontSize: 18 }} />}
        onClick={() => setOpen(true)}
      />
      <Drawer
        title="大模型调用调试"
        width={760}
        open={open}
        onClose={() => setOpen(false)}
        extra={<Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>}
      >
        {loading && calls.length === 0 ? (
          <Spin />
        ) : calls.length === 0 ? (
          <Empty description="暂无调用记录（执行一次校对或测试密钥后会出现）" />
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            {calls.map((c, i) => (
              <Card
                key={i}
                size="small"
                title={
                  <Space wrap>
                    <Tag color={c.status === 'ok' ? 'green' : c.status === 'error' ? 'red' : 'default'}>{c.status}</Tag>
                    <Text strong>{c.model}</Text>
                    {c.tag ? <Tag>{c.tag}</Tag> : null}
                    <Text type="secondary">{c.duration_ms} ms</Text>
                    <Text type="secondary">{c.ts}</Text>
                  </Space>
                }
              >
                <Text type="secondary">请求 prompt（{c.prompt_len} 字）</Text>
                <pre style={preStyle}>{c.prompt}</pre>
                <Text type="secondary">返回 / 错误</Text>
                <pre style={preStyle}>{c.response || c.error || '(空)'}</pre>
              </Card>
            ))}
          </Space>
        )}
      </Drawer>
    </>
  )
}
