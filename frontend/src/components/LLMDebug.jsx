import React, { useState, useEffect, useRef } from 'react'
import {
  Button, Drawer, Spin, Empty, Tag, Card, Typography, Space, message, Tabs, Select, Pagination, Popconfirm, Collapse, Alert
} from 'antd'
import {
  CodeOutlined, ReloadOutlined, HistoryOutlined, DeleteOutlined, BulbOutlined, ToolOutlined
} from '@ant-design/icons'
import { getLLMLog, getLLMLogs, listProjects, clearLLMLogs } from '../services/api'

const { Text } = Typography

const preStyle = {
  maxHeight: 280,
  overflow: 'auto',
  background: '#fafafa',
  padding: '8px 12px',
  borderRadius: 6,
  border: '1px solid #f0f0f0',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  margin: '4px 0 0',
  fontSize: 12,
  fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
}

const tagColor = { ok: 'green', error: 'red', timeout: 'orange', running: 'processing' }

function renderDetailBlock(data) {
  if (!data) return null

  let parsedToolCalls = null
  if (data.tool_calls) {
    try {
      parsedToolCalls = typeof data.tool_calls === 'string' ? JSON.parse(data.tool_calls) : data.tool_calls
    } catch (e) {
      parsedToolCalls = null
    }
  }

  let parsedMessages = null
  if (data.messages) {
    try {
      parsedMessages = typeof data.messages === 'string' ? JSON.parse(data.messages) : data.messages
    } catch (e) {
      parsedMessages = null
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {/* 头部状态与元信息 */}
      <Space wrap size={6}>
        <Tag color={tagColor[data.status] || 'default'}>
          {data.status === 'ok' ? '成功' : data.status === 'error' ? '失败' : data.status}
        </Tag>
        <Tag color={data.mode === 'chat' || data.tag === 'chat' ? 'blue' : 'purple'}>
          {data.mode === 'chat' || data.tag === 'chat' ? '对话 (Chat)' : '校对 (Proofread)'}
        </Tag>
        <Text strong>{String(data.model || '').split('::').pop()}</Text>
        {data.duration_ms ? <Text type="secondary">{data.duration_ms} ms</Text> : null}
        {data.created_at || data.ts ? <Text type="secondary">{data.created_at || data.ts}</Text> : null}
        {data.session_id ? <Text type="secondary">会话: {data.session_id}</Text> : null}
        {data.range_start != null && data.range_start > 0 ? (
          <Text type="secondary">段落 {data.range_start}-{data.range_end}</Text>
        ) : null}
      </Space>

      {/* Token & 费用统计 */}
      {(data.token_info || data.prompt_tokens != null || data.total_tokens != null) && (() => {
        const info = data.token_info || data
        return (
          <Space wrap size={8} style={{ background: '#f8fafc', padding: '6px 12px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
            {info.prompt_tokens != null && <Text type="secondary" style={{ fontSize: 12 }}>输入 {info.prompt_tokens} tokens</Text>}
            {info.completion_tokens != null && <Text type="secondary" style={{ fontSize: 12 }}>输出 {info.completion_tokens} tokens</Text>}
            {info.total_tokens != null && <Tag color="gold">{info.total_tokens} total tokens</Tag>}
            {info.cost != null && <Text type="secondary" style={{ fontSize: 12 }}>费用 ¥{Number(info.cost).toFixed(6)}</Text>}
          </Space>
        )
      })()}

      {/* 错误警告提示 */}
      {(data.error || data.error_message) && (
        <Alert
          type="error"
          showIcon
          message="调用过程抛出异常"
          description={data.error || data.error_message}
        />
      )}

      {/* 思考链 Reasoning Content */}
      {data.thinking && (
        <div style={{ background: '#fffbe6', padding: '10px 14px', borderRadius: 6, border: '1px solid #ffe58f' }}>
          <Space align="center" style={{ marginBottom: 4 }}>
            <BulbOutlined style={{ color: '#d97706' }} />
            <Text strong style={{ color: '#d97706', fontSize: 13 }}>模型思考过程 (Thinking Chain)</Text>
          </Space>
          <pre style={{ ...preStyle, background: 'transparent', border: 'none', padding: 0, margin: 0 }}>
            {data.thinking}
          </pre>
        </div>
      )}

      {/* 系统提示词 System Prompt */}
      {data.system_prompt && (
        <Collapse
          ghost
          size="small"
          items={[{
            key: 'system-prompt',
            label: <Text type="secondary" strong>系统提示词 (System Prompt)</Text>,
            children: <pre style={preStyle}>{data.system_prompt}</pre>
          }]}
        />
      )}

      {/* 用户 Prompt / 上下文 */}
      <div>
        <Text type="secondary" strong>
          用户请求与上下文 ({data.prompt_len || data.prompt?.length || 0} 字)
        </Text>
        <pre style={preStyle}>{data.prompt || '(空)'}</pre>
      </div>

      {/* 多轮消息历史 (如果有) */}
      {parsedMessages && parsedMessages.length > 0 && (
        <Collapse
          ghost
          size="small"
          items={[{
            key: 'full-messages',
            label: <Text type="secondary" strong>多轮对话上下文 Payload ({parsedMessages.length} 条消息)</Text>,
            children: (
              <pre style={preStyle}>
                {JSON.stringify(parsedMessages, null, 2)}
              </pre>
            )
          }]}
        />
      )}

      {/* 工具调用 Tool Calls & 方案卡片提案 */}
      {parsedToolCalls && parsedToolCalls.length > 0 && (
        <div style={{ background: '#f0fdf4', padding: '10px 14px', borderRadius: 6, border: '1px solid #bbf7d0' }}>
          <Space align="center" style={{ marginBottom: 6 }}>
            <ToolOutlined style={{ color: '#16a34a' }} />
            <Text strong style={{ color: '#15803d', fontSize: 13 }}>模型发起工具提案 (Tool Call / Replacement Card)</Text>
          </Space>
          <pre style={{ ...preStyle, background: '#ffffff', borderColor: '#dcfce7' }}>
            {JSON.stringify(parsedToolCalls, null, 2)}
          </pre>
        </div>
      )}

      {/* 返回结果 (Response Output) */}
      <div>
        <Text type="secondary" strong>模型生成结果 (Output Response)</Text>
        <pre style={preStyle}>
          {data.response || data.response_raw || (data.status === 'error' ? '(调用失败未产生输出)' : '(空)')}
        </pre>
      </div>
    </Space>
  )
}

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

  if (loading && calls.length === 0) return <Spin style={{ margin: '40px auto', display: 'block' }} />
  if (calls.length === 0) return <Empty description="暂无实时调用记录（在阅读器中发起校对或侧栏对话后即可实时监测）" />

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {calls.map((c, i) => (
        <Card
          key={i}
          size="small"
          style={{ borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
          title={
            <Space wrap>
              <Tag color={tagColor[c.status] || 'default'}>{c.status}</Tag>

              <Tag color={c.tag === 'chat' ? 'blue' : 'purple'}>
                {c.tag === 'chat' ? '对话 (Chat)' : c.tag || '默认'}
              </Tag>
              <Text strong>{String(c.model || '').split('::').pop()}</Text>
              <Text type="secondary">{c.duration_ms} ms</Text>
              <Text type="secondary">{c.ts}</Text>
            </Space>
          }
        >
          {renderDetailBlock(c)}
        </Card>
      ))}
    </Space>
  )
}

function HistoryTab() {
  const [logs, setLogs] = useState([])
  const [totalCount, setTotalCount] = useState(0)
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
      setLogs(data.logs || [])
      setTotalCount(data.total || (data.logs?.length || 0))
    } catch (e) {
      message.error('加载调用历史失败')
    } finally {
      setLoading(false)
    }
  }

  const handleClear = async () => {
    try {
      await clearLLMLogs(projectId)
      message.success('历史日志已清空')
      load(projectId, 1)
    } catch (e) {
      message.error('清空日志失败')
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
      <Space style={{ justifyContent: 'space-between', width: '100%' }}>
        <Space wrap>
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
        <Popconfirm
          title="确定清空历史日志？"
          description="此操作不可撤销，确定清空所有调试调用日志？"
          onConfirm={handleClear}
          okText="清空"
          okButtonProps={{ danger: true }}
          cancelText="取消"
        >
          <Button icon={<DeleteOutlined />} danger type="text">清空历史日志</Button>
        </Popconfirm>
      </Space>

      {loading ? <Spin style={{ margin: '40px auto', display: 'block' }} /> : logs.length === 0 ? (
        <Empty description="暂无历史记录（发起对话或校对后在此持久保留）" />
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
                <Tag color={c.mode === 'chat' ? 'blue' : 'purple'} style={{ margin: 0 }}>
                  {c.mode === 'chat' ? '对话' : '校对'}
                </Tag>
                <Text strong style={{ minWidth: 120, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {String(c.model || '').split('::').pop()}
                </Text>
                <Text type="secondary" style={{ minWidth: 55, fontSize: 12, textAlign: 'right' }}>
                  {c.duration_ms ? `${c.duration_ms}ms` : '-'}
                </Text>
                {c.total_tokens != null && (
                  <Text type="secondary" style={{ minWidth: 50, fontSize: 12, textAlign: 'right' }}>
                    {c.total_tokens}t
                  </Text>
                )}
                {c.mode === 'chat' ? (
                  <Text type="secondary" style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    会话: {c.session_id || '默认'}
                  </Text>
                ) : (
                  <Text type="secondary" style={{ flex: 1, fontSize: 12 }}>
                    段落 {c.range_start}-{c.range_end} | {c.errors_found || 0} 误
                  </Text>
                )}
                <Text type="secondary" style={{ fontSize: 12 }}>{c.created_at}</Text>
              </div>
            ))}
          </div>
          <Pagination
            current={page}
            pageSize={pageSize}
            total={totalCount}
            onChange={(p) => setPage(p)}
            size="small"
            showTotal={(total) => `共 ${total} 条`}
          />
        </>
      )}

      <Drawer
        title="调用结构化观测详情"
        width={720}
        open={!!detail}
        onClose={() => setDetail(null)}
      >
        {renderDetailBlock(detail)}
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
        title="大模型调用监控与调试日志"
      />
      <Drawer
        title="大模型调用观测面板 (LLM Inspector)"
        width={840}
        open={open}
        onClose={() => setOpen(false)}
      >
        <Tabs
          defaultActiveKey="realtime"
          items={[
            { key: 'realtime', label: <span><CodeOutlined /> 实时流式监控</span>, children: <RealTimeTab /> },
            { key: 'history', label: <span><HistoryOutlined /> 历史持久化日志</span>, children: <HistoryTab /> },
          ]}
        />
      </Drawer>
    </>
  )
}
