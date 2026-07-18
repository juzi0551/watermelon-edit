import React, { useState, useEffect, useRef } from 'react'
import { Button, Drawer, Spin, Empty, Tag, Card, Typography, Space, message, Tabs, Select, Pagination } from 'antd'
import { CodeOutlined, ReloadOutlined, HistoryOutlined } from '@ant-design/icons'
import { getLLMLog, getLLMLogs, listProjects } from '../services/api'

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

const tagColor = { ok: 'green', error: 'red', timeout: 'orange', running: 'default' }

function RealTimeTab() {
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
    load()
    timer.current = setInterval(load, 3000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [])

  if (loading && calls.length === 0) return <Spin />
  if (calls.length === 0) return <Empty description="暂无调用记录（执行一次校对或测试密钥后会出现）" />

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {calls.map((c, i) => (
        <Card
          key={i}
          size="small"
          title={
            <Space wrap>
              <Tag color={tagColor[c.status] || 'default'}>{c.status}</Tag>
              <Text strong>{c.model}</Text>
              {c.tag ? <Tag>{c.tag}</Tag> : null}
              <Text type="secondary">{c.duration_ms} ms</Text>
              <Text type="secondary">{c.ts}</Text>
            </Space>
          }
        >
          <Text type="secondary">请求 prompt（{c.prompt_len} 字）</Text>
          <pre style={preStyle}>{c.prompt}</pre>
          {c.system_prompt && (
            <>
              <Text type="secondary">System Prompt</Text>
              <pre style={preStyle}>{c.system_prompt}</pre>
            </>
          )}
          <Text type="secondary">返回 / 错误</Text>
          <pre style={preStyle}>{c.response || c.error || '(空)'}</pre>
        </Card>
      ))}
    </Space>
  )
}

function HistoryTab() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState(null)
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState(null)
  const pageSize = 30
  const rowEven = '#fff', rowOdd = '#fafafa', rowHover = '#f0f0f0', borderColor = '#f0f0f0'

  const load = async (pid, pg) => {
    setLoading(true)
    try {
      const data = await getLLMLogs(pid, pageSize, (pg - 1) * pageSize)
      setLogs(data || [])
    } catch (e) {
      message.error('加载调用历史失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(projectId, page)
  }, [projectId, page])

  useEffect(() => {
    listProjects().then(list => setProjects(list || [])).catch(() => {})
  }, [])

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Space>
        <Select
          allowClear
          placeholder="按项目筛选"
          style={{ width: 240 }}
          value={projectId}
          onChange={(v) => { setProjectId(v); setPage(1) }}
          options={projects.map(p => ({ label: p.name, value: p.id }))}
        />
        <Button icon={<ReloadOutlined />} onClick={() => load(projectId, page)}>刷新</Button>
      </Space>
      {loading ? <Spin /> : logs.length === 0 ? (
        <Empty description="暂无记录（校对一次后会在此持久保留）" />
      ) : (
        <>
          <div style={{ border: `1px solid ${borderColor}`, borderRadius: 6, overflow: 'hidden' }}>
            {logs.map((c, i) => (
              <div
                key={c.id || i}
                onClick={() => setDetail(c)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px', cursor: 'pointer',
                  borderBottom: i < logs.length - 1 ? `1px solid ${borderColor}` : 'none',
                  background: i % 2 === 0 ? rowEven : rowOdd,
                  fontSize: 13,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = rowHover }}
                onMouseLeave={(e) => { e.currentTarget.style.background = i % 2 === 0 ? rowEven : rowOdd }}
              >
                <Tag color={tagColor[c.status] || 'default'} style={{ margin: 0, minWidth: 40, textAlign: 'center' }}>
                  {c.status === 'ok' ? '成功' : c.status === 'error' ? '失败' : c.status}
                </Tag>
                <Text strong style={{ minWidth: 130, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.model}</Text>
                <Text type="secondary" style={{ minWidth: 55, fontSize: 12, textAlign: 'right' }}>{c.duration_ms}ms</Text>
                {c.total_tokens != null && <Text type="secondary" style={{ minWidth: 50, fontSize: 12, textAlign: 'right' }}>{c.total_tokens}t</Text>}
                <Text type="secondary" style={{ minWidth: 36, fontSize: 12, textAlign: 'right' }}>{c.errors_found || 0}误</Text>
                <Text type="secondary" style={{ minWidth: 56, fontSize: 12, textAlign: 'right' }}>段{c.range_start}-{c.range_end}</Text>
                <Text type="secondary" style={{ flex: 1, textAlign: 'right', fontSize: 12 }}>{c.created_at}</Text>
              </div>
            ))}
          </div>
          <Pagination
            current={page}
            pageSize={pageSize}
            total={logs.length < pageSize ? (page - 1) * pageSize + logs.length + 1 : page * pageSize + 1}
            onChange={(p) => setPage(p)}
            size="small"
            showTotal={(total) => `共 ${total} 条`}
          />
        </>
      )}
      <Drawer
        title="调用详情"
        width={640}
        open={!!detail}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Space wrap>
              <Tag color={tagColor[detail.status] || 'default'}>{detail.status === 'ok' ? '成功' : detail.status === 'error' ? '失败' : detail.status}</Tag>
              <Text strong>{detail.model}</Text>
              {detail.mode ? <Tag>{detail.mode}</Tag> : null}
              <Text type="secondary">{detail.duration_ms} ms</Text>
              <Text type="secondary">{detail.created_at}</Text>
              {detail.project_id && <Text type="secondary">段落 {detail.range_start}-{detail.range_end}</Text>}
            </Space>
            {(detail.prompt_tokens != null || detail.cost != null) && (
              <Space wrap>
                {detail.prompt_tokens != null && <Text type="secondary">输入 {detail.prompt_tokens} tokens</Text>}
                {detail.completion_tokens != null && <Text type="secondary">输出 {detail.completion_tokens} tokens</Text>}
                {detail.total_tokens != null && <Tag color="blue">{detail.total_tokens} tokens</Tag>}
                {detail.cost != null && <Text type="secondary">费用 ¥{Number(detail.cost).toFixed(6)}</Text>}
              </Space>
            )}
            {detail.error_message && (
              <Paragraph type="danger" style={{ marginBottom: 0 }}>{detail.error_message}</Paragraph>
            )}
            <div>
              <Text type="secondary" strong>System Prompt</Text>
              <pre style={preStyle}>{detail.system_prompt || '(空)'}</pre>
            </div>
            <div>
              <Text type="secondary" strong>User Prompt（{detail.prompt?.length || 0} 字）</Text>
              <pre style={preStyle}>{detail.prompt || '(空)'}</pre>
            </div>
            <div>
              <Text type="secondary" strong>返回结果（{detail.errors_found} 错误, {detail.chapters_found} 章节）</Text>
              <pre style={preStyle}>{detail.response_raw || '(空)'}</pre>
            </div>
          </Space>
        )}
      </Drawer>
    </Space>
  )
}

export default function LLMDebug() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        type="text"
        icon={<CodeOutlined style={{ color: '#fff', fontSize: 18 }} />}
        onClick={() => setOpen(true)}
        title="大模型调用日志"
      />
      <Drawer
        title="大模型调用日志"
        width={800}
        open={open}
        onClose={() => setOpen(false)}
      >
        <Tabs
          defaultActiveKey="realtime"
          items={[
            { key: 'realtime', label: <span><CodeOutlined /> 实时日志</span>, children: <RealTimeTab /> },
            { key: 'history', label: <span><HistoryOutlined /> 调用历史</span>, children: <HistoryTab /> },
          ]}
        />
      </Drawer>
    </>
  )
}
