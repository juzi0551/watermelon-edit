import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Card, Button, Upload, Tag, Space, List, Typography, Spin, message,
  Empty, Drawer,
} from 'antd'
import {
  InboxOutlined, ArrowLeftOutlined, DownloadOutlined, UnorderedListOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, EyeOutlined,
} from '@ant-design/icons'
import {
  getProject, uploadToProject, getModels, startProofread,
  getResults, setErrorStatus, acceptAll, exportDoc,
  getLLMLog,
} from '../services/api'
import ReviewReader from '../components/ReviewReader'
import { color } from '../design-tokens'

const { Title, Text } = Typography
const { Dragger } = Upload

const WINDOW = 30

export default function ProjectDetail() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(false)
  const [models, setModels] = useState([])
  const [selectedModel, setSelectedModel] = useState(
    () => localStorage.getItem('proofread_model') || 'deepseek-v4-flash'
  )
  const [results, setResults] = useState(null)
  const [proofreading, setProofreading] = useState(false)
  const [mode, setMode] = useState('continue')
  const [selectedChapter, setSelectedChapter] = useState(null)
  const [selectedTypes, setSelectedTypes] = useState(
    () => {
      try { return JSON.parse(localStorage.getItem('proofread_types') || ''); } catch {}
      return ['typo', 'grammar', 'punctuation', 'format']
    }
  )
  const [exporting, setExporting] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)
  const [chaptersOpen, setChaptersOpen] = useState(false)
  const [error, setError] = useState(null)
  const [runningBatch, setRunningBatch] = useState(null)
  const [selectedParas, setSelectedParas] = useState(new Set())
  const [llmMonitorOpen, setLlmMonitorOpen] = useState(false)
  const [llmCalls, setLlmCalls] = useState([])
  const [llmMonitorLoading, setLlmMonitorLoading] = useState(false)
  const llmTimerRef = useRef(null)

  const loadLlmCalls = useCallback(async () => {
    setLlmMonitorLoading(true)
    try {
      const data = await getLLMLog()
      setLlmCalls(data || [])
    } catch (e) {
      // 静默失败，下次轮询继续
    } finally {
      setLlmMonitorLoading(false)
    }
  }, [])

  useEffect(() => {
    if (llmMonitorOpen) {
      loadLlmCalls()
      llmTimerRef.current = setInterval(loadLlmCalls, 1000)
    }
    return () => {
      if (llmTimerRef.current) clearInterval(llmTimerRef.current)
    }
  }, [llmMonitorOpen, loadLlmCalls])

  const loadProject = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getProject(projectId)
      if (data.error) {
        setError(data.error)
        setProject(null)
      } else {
        setProject(data)
        setRunningBatch(null)
      }
      // 不管项目状态是什么，都尝试加载结果。
      // 段落数据在上传解析时就已存入 DB，校对期间也能展示正文。
      loadResults()
    } catch (e) {
      setError(e.response?.data?.detail || e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const loadResults = async () => {
    try {
      const data = await getResults(projectId)
      if (!data.error) setResults(data)
    } catch {}
  }

  const loadModels = async () => {
    try {
      const data = await getModels()
      const proofreadModels = data.filter(m => !m.agentic)
      setModels(proofreadModels)
      if (proofreadModels.length && !proofreadModels.find(m => m.model_id === selectedModel)) {
        setSelectedModel(proofreadModels[0].model_id)
      }
    } catch {}
  }

  useEffect(() => {
    loadProject()
    loadModels()
  }, [projectId])

  useEffect(() => {
    document.title = project?.name || 'Watermelon Edit'
  }, [project])

  // 有未处理的问题时自动打开问题列表
  useEffect(() => {
    const pending = results?.errors?.filter(e => e.user_status === 'pending').length
    if (pending > 0) setPanelOpen(true)
  }, [results])

  // persist proofread config across refreshes
  useEffect(() => { localStorage.setItem('proofread_model', selectedModel) }, [selectedModel])
  useEffect(() => { localStorage.setItem('proofread_types', JSON.stringify(selectedTypes)) }, [selectedTypes])

  const handleUpload = async (file) => {
    setLoading(true)
    try {
      await uploadToProject(projectId, file)
      message.success('文件上传并解析成功')
      loadProject()
    } catch (e) {
      message.error('上传失败：' + (e.response?.data?.detail || e.message))
    } finally {
      setLoading(false)
    }
    return false
  }

  const handleProofread = async () => {
    setProofreading(true)
    try {
      const payload = {
        mode,
        model: selectedModel,
        types: selectedTypes,
        chapter_id: mode === 'chapter' ? selectedChapter : undefined,
      }
      const res = await startProofread(projectId, payload)
      if (res.error) {
        message.error(res.error)
        setProofreading(false)
        return
      }
      if (res.status === 'skipped') {
        message.info(res.message)
        setProofreading(false)
        loadProject()
        return
      }
      if (res.status === 'running') {
        message.info(res.message)
      }
      const runBatch = mode === 'continue'
        ? Math.floor((project?.proofread_upto || 0) / WINDOW) + 1
        : null
      setRunningBatch(runBatch)
      await pollProofread(runBatch)
    } catch (e) {
      message.error('校对失败：' + (e.response?.data?.detail || e.message))
      setProofreading(false)
      setRunningBatch(null)
    }
  }

  const pollProofread = async (runBatch) => {
    // 轮询直到后端把状态翻回 reviewing/completed（真正处理完）才结束。
    // 不能用「upto 暂时不变」提前退出——慢模型（如 Kimi Code）一次调用可能超过 100 秒，
    // 期间 upto 不变会误判为完成，导致界面卡在「正在校对」。
    for (let i = 0; i < 600; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      let data
      try {
        data = await getProject(projectId)
      } catch {
        continue
      }
      setProject(data)
      if (data.status === 'reviewing' || data.status === 'completed') break
    }
    setProofreading(false)
    setRunningBatch(null)
    loadResults()
    loadProject()
    try {
      const d = await getProject(projectId)
      if (d.last_error) {
        message.error(`校对失败：${d.last_error}`)
      } else if (mode === 'continue' && runBatch) {
        message.success(`第 ${runBatch} 批校对完成（已校对至 ${d.proofread_upto || 0}/${d.paragraph_count || 0} 段）`)
      } else if (mode === 'chapter') {
        message.success('章节校对完成')
      } else {
        message.success(`校对完成：已校对至 ${d.proofread_upto || 0}/${d.paragraph_count || 0} 段`)
      }
    } catch {}
  }

  const handleSelectionProofread = async (indices) => {
    setProofreading(true)
    try {
      const payload = {
        mode: 'selection',
        model: selectedModel,
        types: selectedTypes,
        paragraph_indices: indices,
      }
      const res = await startProofread(projectId, payload)
      if (res.error) {
        message.error(res.error)
        setProofreading(false)
        return
      }
      if (res.status === 'running') {
        message.info(res.message)
      }
      setSelectedParas(new Set())
      setMode('selection')
      await pollProofread()
      setMode('continue')
    } catch (e) {
      message.error('选中段校对失败：' + (e.response?.data?.detail || e.message))
      setProofreading(false)
    }
  }

  const handleSetStatus = async (errorId, status, customText) => {
    await setErrorStatus(projectId, errorId, status, customText)
    loadResults()
  }

  const handleAcceptAll = async () => {
    try {
      const res = await acceptAll(projectId)
      message.success(`已采纳全部 ${res.count} 条建议`)
      loadResults()
    } catch (e) {
      message.error('操作失败：' + (e.response?.data?.detail || e.message))
    }
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const blob = await exportDoc(projectId)
      const url = window.URL.createObjectURL(new Blob([blob]))
      const a = document.createElement('a')
      a.href = url
      a.download = `${project?.name || '校稿'}_校稿版.docx`
      a.click()
      window.URL.revokeObjectURL(url)
      message.success('已导出校稿版 docx')
    } catch (e) {
      message.error('导出失败：' + (e.response?.data?.detail || e.message))
    } finally {
      setExporting(false)
    }
  }

  const total = project?.paragraph_count || 0
  const upto = project?.proofread_upto || results?.proofread_upto || 0
  const chapters = results?.chapters || []

  const windowStart = upto
  const windowEnd = Math.min(upto + WINDOW, total)
  const inProgress = proofreading || project?.status === 'proofreading'
  const percent = total > 0 ? Math.round((upto / total) * 100) : 0
  const bannerText = mode === 'continue' && runningBatch
    ? `正在校对第 ${runningBatch} 批（第 ${windowStart + 1}–${windowEnd} 段）…`
    : '正在校对，请稍候…'

  if (loading && !project) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />

  if (error) return (
    <Card>
      <Empty description={error}>
        <Button type="primary" shape="round" onClick={() => navigate('/')}>返回项目列表</Button>
      </Empty>
    </Card>
  )

  return (
    <div>
      <Card
        title={
          <Space>
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/')} />
            <span style={{ fontWeight: 600, fontSize: 18 }}>{project?.name || '加载中...'}</span>
            {total > 0 && (
              <Text type="secondary" style={{ fontSize: 13 }}>
                {upto}/{total} 段
              </Text>
            )}
            {project?.last_error && (
              <Tag color="warning" style={{ fontSize: 12, marginLeft: 8 }}>
                ⚠ {project.last_error}
              </Tag>
            )}
          </Space>
        }
        extra={
          results && (
            <Space>
              <Button
                icon={<UnorderedListOutlined />}
                onClick={() => setPanelOpen(v => !v)}
                type={panelOpen ? 'primary' : 'default'}
                shape="round"
              >
                 问题列表{results?.errors?.filter(e => e.user_status === 'pending').length ? `（${results.errors.filter(e => e.user_status === 'pending').length}）` : ''}
              </Button>
              <Button
                icon={<EyeOutlined />}
                onClick={() => setLlmMonitorOpen(true)}
                shape="round"
              >
                LLM 实时
              </Button>
              <Button
                type="primary"
                shape="round"
                icon={<DownloadOutlined />}
                disabled={inProgress}
                onClick={handleExport}
              >
                导出校稿版
              </Button>
            </Space>
          )
        }
        style={{ marginBottom: 16 }}
      >

        {(!project?.paragraph_count || project.paragraph_count === 0) && (
          <Dragger
            accept=".docx"
            showUploadList={false}
            beforeUpload={handleUpload}
            disabled={loading}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">点击或拖拽 .docx 文件到此处上传</p>
          </Dragger>
        )}
        {total > 0 && (
          <div style={{ display: 'flex', gap: 0, height: 'calc(100vh - 190px)', overflow: 'hidden' }}>
            {/* chapter list sidebar */}
            <div style={{
              width: chaptersOpen ? 260 : 0,
              overflow: 'hidden',
              flexShrink: 0,
              transition: 'width 0.2s ease',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
            }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                paddingRight: 4,
              }}>
                <Title level={5} style={{ margin: 0, whiteSpace: 'nowrap' }}>章节目录</Title>
                <Button
                  type="text"
                  size="small"
                  icon={<MenuFoldOutlined />}
                  onClick={() => setChaptersOpen(false)}
                />
              </div>
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', marginTop: 8 }}>
                {chapters.length === 0 ? (
                  <Text type="secondary">尚未校对出章节结构，先执行校对。</Text>
                ) : (
                  <List
                    size="small"
                    dataSource={chapters}
                    renderItem={(ch) => (
                      <List.Item
                        style={{
                          cursor: 'pointer',
                          paddingLeft: ch.level === 2 ? 20 : 0,
                          color: ch.level === 2 ? color.textTertiary : undefined,
                          background: selectedChapter === ch.id ? color.bgChapterSelected : 'transparent',
                          padding: '4px 8px',
                          borderRadius: 4,
                        }}
                        onClick={() => setSelectedChapter(ch.id)}
                      >
                        <Text>{ch.title || `第 ${ch.title_paragraph_idx} 段`}</Text>
                      </List.Item>
                    )}
                  />
                )}
              </div>
            </div>

            {/* toggle button (when collapsed) */}
            {!chaptersOpen && (
              <div style={{
                display: 'flex', alignItems: 'flex-start', paddingTop: 4,
                flexShrink: 0,
              }}>
                <Button
                  type="text"
                  size="small"
                  icon={<MenuUnfoldOutlined />}
                  onClick={() => setChaptersOpen(true)}
                  style={{ marginRight: 12 }}
                />
              </div>
            )}

            {/* gap when open */}
            {chaptersOpen && <div style={{ width: 16, flexShrink: 0 }} />}

            <div style={{ flex: 1, minWidth: 0 }}>
              {results && (
                  <ReviewReader
                    results={results}
                    project={project}
                    inProgress={inProgress}
                    onSetStatus={handleSetStatus}
                    onAcceptAll={handleAcceptAll}
                    panelOpen={panelOpen}
                    onTogglePanel={() => setPanelOpen(v => !v)}
                    chapters={chapters}
                    selectedChapter={selectedChapter}
                    onStartProofread={handleProofread}
                    selectedModel={selectedModel}
                    onModelChange={setSelectedModel}
                    models={models}
                    selectedTypes={selectedTypes}
                    onTypesChange={setSelectedTypes}
                    percent={percent}
                    proofreading={proofreading}
                    total={total}
                    upto={upto}
                    bannerText={bannerText}
                    projectError={project?.last_error}
                    onRetry={handleProofread}
                    onChapterChange={setSelectedChapter}
                    selectedParas={selectedParas}
                    onSelectionChange={setSelectedParas}
                    onStartSelectionProofread={handleSelectionProofread}
                  />
              )}
            </div>
          </div>
        )}

        <LLMMonitor
          open={llmMonitorOpen}
          onClose={() => setLlmMonitorOpen(false)}
          calls={llmCalls}
          loading={llmMonitorLoading}
        />
      </Card>
    </div>
  )
}

/* ─────────────────────────────────────────────
   LLM 实时监控面板
───────────────────────────────────────────── */
const STATUS_CFG = {
  running: { color: '#3b82f6', bg: '#eff6ff', label: '进行中', dot: true },
  ok:      { color: '#22c55e', bg: '#f0fdf4', label: '完成',   dot: false },
  error:   { color: '#ef4444', bg: '#fef2f2', label: '失败',   dot: false },
}
const THINKING_CFG = {
  thinking: { color: '#7c3aed', bg: '#f5f3ff', label: '思考中', pulse: true },
  done:     { color: '#16a34a', bg: '#f0fdf4', label: '思考完毕', pulse: false },
  idle:     null,
}

function LLMMonitor({ open, onClose, calls, loading }) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={680}
      styles={{
        header: { borderBottom: '1px solid #f0f0f0', padding: '14px 20px' },
        body:   { padding: '16px 20px', background: '#f8fafc' },
      }}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>LLM 实时监控</span>
          <span style={{
            fontSize: 11, color: '#6b7280', background: '#f3f4f6',
            padding: '2px 8px', borderRadius: 99, border: '1px solid #e5e7eb',
          }}>
            {calls.length} 条记录
          </span>
          {loading && <Spin size="small" />}
        </div>
      }
    >
      <style>{`
        @keyframes monitorPulse {
          0%, 100% { opacity: 1 }
          50% { opacity: 0.4 }
        }
        @keyframes cursorBlink { 50% { opacity: 0 } }
        @keyframes thinkDots {
          0%  { content: '·' }
          33% { content: '··' }
          66% { content: '···' }
        }
        .think-label::after {
          content: '···';
          animation: thinkDots 1s step-end infinite;
          display: inline-block; width: 18px;
        }
      `}</style>

      {calls.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px 0', color: '#9ca3af',
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🤖</div>
          <div style={{ fontSize: 14 }}>开始校对后，LLM 调用记录将在此显示</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {calls.map((c, i) => (
            <LLMCallCard key={i} call={c} />
          ))}
        </div>
      )}
    </Drawer>
  )
}

function LLMCallCard({ call: c }) {
  const [thinkOpen, setThinkOpen] = useState(true)
  const [respOpen,  setRespOpen]  = useState(true)
  const thinkRef = useRef(null)
  const respRef  = useRef(null)

  const sCfg = STATUS_CFG[c.status] || STATUS_CFG.error
  const tCfg = THINKING_CFG[c.thinking_status] || null
  const isRunning  = c.status === 'running'
  const isThinking = c.thinking_status === 'thinking'
  const hasThink   = c.thinking && c.thinking.length > 0
  const hasResp    = c.response && c.response.length > 0

  useEffect(() => {
    if (thinkRef.current && isThinking) thinkRef.current.scrollTop = thinkRef.current.scrollHeight
  }, [c.thinking, isThinking])
  useEffect(() => {
    if (respRef.current && isRunning) respRef.current.scrollTop = respRef.current.scrollHeight
  }, [c.response, isRunning])

  // token 统计（仅完成后有值）
  const ti = c.token_info || {}
  const totalTok = ti.total_tokens
  const cost = ti.cost

  return (
    <div style={{
      background: '#fff',
      borderRadius: 12,
      border: `1px solid ${sCfg.color}33`,
      overflow: 'hidden',
      boxShadow: isRunning ? `0 0 0 2px ${sCfg.color}22` : '0 1px 3px rgba(0,0,0,0.06)',
      transition: 'box-shadow 0.3s',
    }}>
      {/* 头部 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        background: sCfg.bg,
        borderBottom: '1px solid #f0f0f0',
        flexWrap: 'wrap',
      }}>
        {/* 状态指示器 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
            background: sCfg.color,
            animation: sCfg.dot ? 'monitorPulse 1.2s ease-in-out infinite' : 'none',
          }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: sCfg.color }}>{sCfg.label}</span>
        </div>

        {/* 模型名 */}
        <span style={{
          fontSize: 13, fontWeight: 600, color: '#1e293b',
          background: '#f1f5f9', padding: '2px 8px', borderRadius: 6,
        }}>
          {c.model}
        </span>

        {/* thinking 状态 */}
        {tCfg && (
          <span style={{
            fontSize: 11, color: tCfg.color, background: tCfg.bg,
            padding: '2px 8px', borderRadius: 6, fontWeight: 500,
          }}>
            {tCfg.pulse
              ? <span className="think-label">🧠 思考中</span>
              : '✓ 思考完毕'
            }
          </span>
        )}

        {/* 耗时 */}
        <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 'auto' }}>
          {isRunning
            ? <span style={{ animation: 'monitorPulse 1.5s ease infinite', display: 'inline-block' }}>计时中…</span>
            : <><span style={{ fontWeight: 600, color: '#374151' }}>{(c.duration_ms / 1000).toFixed(1)}s</span></>
          }
        </span>

        {/* 时间戳 */}
        <span style={{ fontSize: 10, color: '#9ca3af' }}>{c.ts}</span>
      </div>

      {/* 统计行（完成后才显示） */}
      {!isRunning && (totalTok || cost) && (
        <div style={{
          display: 'flex', gap: 16, padding: '6px 14px',
          background: '#fafafa', borderBottom: '1px solid #f0f0f0',
          fontSize: 11, color: '#6b7280',
        }}>
          {totalTok && <span>Tokens: <strong style={{ color: '#374151' }}>{totalTok.toLocaleString()}</strong></span>}
          {ti.prompt_tokens && <span>提示: <strong style={{ color: '#374151' }}>{ti.prompt_tokens.toLocaleString()}</strong></span>}
          {ti.completion_tokens && <span>生成: <strong style={{ color: '#374151' }}>{ti.completion_tokens.toLocaleString()}</strong></span>}
          {cost && <span>费用: <strong style={{ color: '#374151' }}>${cost.toFixed(5)}</strong></span>}
        </div>
      )}

      {/* 错误 */}
      {c.error && (
        <div style={{
          padding: '8px 14px', background: '#fef2f2',
          color: '#dc2626', fontSize: 12, lineHeight: 1.6,
        }}>
          ⚠ {c.error}
        </div>
      )}

      {/* 思考内容 */}
      {hasThink && (
        <CollapsibleSection
          open={thinkOpen}
          onToggle={() => setThinkOpen(v => !v)}
          label={
            isThinking
              ? <span className="think-label" style={{ color: '#7c3aed', fontWeight: 500 }}>思考中</span>
              : <span style={{ color: '#16a34a', fontWeight: 500 }}>思考过程</span>
          }
          badge={`${Math.round(c.thinking.length / 2)} 字`}
          accentColor={isThinking ? '#7c3aed' : '#16a34a'}
          bg={isThinking ? '#faf5ff' : '#f8f8f8'}
        >
          <pre ref={thinkRef} style={{
            margin: 0, padding: '10px 14px',
            maxHeight: 180, overflow: 'auto',
            fontSize: 11, lineHeight: 1.7, color: '#6b7280',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            background: 'transparent',
          }}>
            {c.thinking}
            {isThinking && <BlinkCursor color="#7c3aed" />}
          </pre>
        </CollapsibleSection>
      )}

      {/* 正式输出 */}
      {(hasResp || isRunning) && (
        <CollapsibleSection
          open={respOpen}
          onToggle={() => setRespOpen(v => !v)}
          label={<span style={{ color: '#1e40af', fontWeight: 500 }}>模型输出</span>}
          badge={hasResp ? `${c.response.length} 字符` : '等待中…'}
          accentColor="#3b82f6"
          bg="#f8faff"
        >
          <pre ref={respRef} style={{
            margin: 0, padding: '10px 14px',
            maxHeight: 220, overflow: 'auto',
            fontSize: 11, lineHeight: 1.7, color: '#374151',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            background: 'transparent',
          }}>
            {c.response || ''}
            {isRunning && !isThinking && <BlinkCursor color="#3b82f6" />}
          </pre>
        </CollapsibleSection>
      )}
    </div>
  )
}

function CollapsibleSection({ open, onToggle, label, badge, accentColor, bg, children }) {
  return (
    <div style={{ borderTop: '1px solid #f0f0f0' }}>
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 14px', cursor: 'pointer', userSelect: 'none',
          background: bg,
          borderLeft: `3px solid ${accentColor}`,
        }}
      >
        <span style={{ fontSize: 11, color: '#9ca3af' }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontSize: 12 }}>{label}</span>
        {badge && (
          <span style={{
            marginLeft: 'auto', fontSize: 10, color: '#9ca3af',
            background: '#f3f4f6', padding: '1px 6px', borderRadius: 4,
          }}>
            {badge}
          </span>
        )}
      </div>
      {open && children}
    </div>
  )
}

function BlinkCursor({ color = '#3b82f6' }) {
  return (
    <span style={{
      display: 'inline-block', width: 6, height: 13,
      background: color, marginLeft: 2,
      verticalAlign: 'text-bottom',
      animation: 'cursorBlink 0.8s step-end infinite',
    }} />
  )
}
