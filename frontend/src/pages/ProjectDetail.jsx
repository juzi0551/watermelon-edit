import React, { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Card, Button, Upload, Tag, Space, List, Typography, Spin, message,
  Empty,
} from 'antd'
import {
  InboxOutlined, ArrowLeftOutlined, DownloadOutlined, UnorderedListOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined,
} from '@ant-design/icons'
import {
  getProject, uploadToProject, getModels, startProofread,
  getResults, setErrorStatus, acceptAll, exportDoc,
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
  const [panelOpen, setPanelOpen] = useState(false)
  const [chaptersOpen, setChaptersOpen] = useState(true)
  const [error, setError] = useState(null)
  const [runningBatch, setRunningBatch] = useState(null)

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

  // titlebar: 项目名 + 校稿进度
  useEffect(() => {
    const p = project
    const upto = p?.proofread_upto ?? results?.proofread_upto ?? 0
    const total = p?.paragraph_count ?? 0
    const suffix = ` (${upto}/${total})`
    document.title = (p?.name || 'Watermelon Edit') + suffix
  }, [project, results])

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
      if (mode === 'continue' && runBatch) {
        message.success(`第 ${runBatch} 批校对完成（已校对至 ${d.proofread_upto || 0}/${d.paragraph_count || 0} 段）`)
      } else if (mode === 'chapter') {
        message.success('章节校对完成')
      } else {
        message.success(`校对完成：已校对至 ${d.proofread_upto || 0}/${d.paragraph_count || 0} 段`)
      }
    } catch {}
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
                  />
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
