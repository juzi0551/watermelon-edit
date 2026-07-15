import React, { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Card, Button, Upload, Steps, Tag, Space, List, Typography, Radio, Spin, message,
  Popconfirm, Select, Alert, Empty, Progress, Tooltip,
} from 'antd'
import {
  InboxOutlined, FileTextOutlined, ThunderboltOutlined,
  CheckCircleOutlined, CloseCircleOutlined, ArrowLeftOutlined, DownloadOutlined,
  LoadingOutlined,
} from '@ant-design/icons'
import {
  getProject, uploadToProject, getModels, startProofread,
  getResults, setErrorStatus, acceptAll, exportDoc,
} from '../services/api'

const { Title, Text, Paragraph } = Typography
const { Dragger } = Upload

const TYPE_OPTIONS = [
  { value: 'typo', label: '错别字' },
  { value: 'grammar', label: '语法' },
  { value: 'punctuation', label: '标点' },
  { value: 'format', label: '格式' },
]
const TYPE_LABEL = Object.fromEntries(TYPE_OPTIONS.map(t => [t.value, t.label]))
const WINDOW = 30

export default function ProjectDetail() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(false)
  const [models, setModels] = useState([])
  const [selectedModel, setSelectedModel] = useState('deepseek-v4-flash')
  const [results, setResults] = useState(null)
  const [proofreading, setProofreading] = useState(false)
  const [mode, setMode] = useState('continue')
  const [selectedChapter, setSelectedChapter] = useState(null)
  const [selectedTypes, setSelectedTypes] = useState(['typo', 'grammar', 'punctuation', 'format'])
  const [exporting, setExporting] = useState(false)
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
      setModels(data)
      if (data?.length && !data.find(m => m.model_id === selectedModel)) {
        setSelectedModel(data[0].model_id)
      }
    } catch {}
  }

  useEffect(() => {
    loadProject()
    loadModels()
  }, [projectId])

  useEffect(() => {
    if (project?.status === 'reviewing' || project?.status === 'completed') {
      loadResults()
    }
  }, [project?.status])

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

  const handleSetStatus = async (errorId, status) => {
    await setErrorStatus(projectId, errorId, status)
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

  const stepIndex = {
    new: 0, uploaded: 1, parsed: 1, proofreading: 1, reviewing: 2, completed: 3,
  }[project?.status] || 0

  const total = project?.paragraph_count || 0
  const upto = project?.proofread_upto || results?.proofread_upto || 0
  const chapters = results?.chapters || []
  const errors = results?.errors || []
  const paras = results?.paragraphs || []

  const totalBatches = Math.max(1, Math.ceil(total / WINDOW))
  const nextBatch = Math.min(totalBatches, Math.floor(upto / WINDOW) + 1)
  const windowStart = upto
  const windowEnd = Math.min(upto + WINDOW, total)
  const inProgress = proofreading || project?.status === 'proofreading'
  const percent = total > 0 ? Math.round((upto / total) * 100) : 0
  const bannerText = mode === 'continue' && runningBatch
    ? `正在校对第 ${runningBatch} 批（第 ${windowStart + 1}–${windowEnd} 段）…`
    : '正在校对，请稍候…'

  const paraMap = useMemo(() => Object.fromEntries(paras.map(p => [p.idx, p])), [paras])
  const groups = useMemo(() => {
    const g = {}
    errors.forEach(e => { (g[e.paragraph_index] ||= []).push(e) })
    return Object.keys(g).map(Number).sort((a, b) => a - b).map(idx => ({ idx, items: g[idx] }))
  }, [errors])

  const acceptedCount = errors.filter(e => e.user_status === 'accepted').length
  const resolvedCount = errors.filter(e => e.user_status !== 'pending').length

  if (loading && !project) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />

  if (error) return (
    <Card>
      <Empty description={error}>
        <Button type="primary" onClick={() => navigate('/')}>返回项目列表</Button>
      </Empty>
    </Card>
  )

  return (
    <div>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')} style={{ marginBottom: 16 }}>
        返回项目列表
      </Button>

      <Card title={project?.name || '加载中...'} style={{ marginBottom: 16 }}>
        <Steps
          current={stepIndex}
          items={[
            { title: '上传文档' },
            { title: 'AI 校对（含解析）' },
            { title: '审核结果' },
            { title: '导出' },
          ]}
          style={{ marginBottom: 24 }}
        />

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
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ width: 260, flexShrink: 0 }}>
              <Title level={5}>章节目录</Title>
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
                        color: ch.level === 2 ? '#888' : undefined,
                        background: selectedChapter === ch.id ? '#e6f4ff' : 'transparent',
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

            <div style={{ flex: 1, background: '#fff', padding: 16, borderRadius: 8 }}>
              <Title level={5}>校对控制</Title>

              <Progress
                percent={percent}
                status={inProgress ? 'active' : (upto >= total ? 'success' : 'normal')}
                style={{ marginBottom: 8 }}
              />

              {inProgress ? (
                <Alert
                  type="info"
                  showIcon
                  icon={<LoadingOutlined spin />}
                  style={{ marginBottom: 16 }}
                  message={bannerText}
                />
              ) : upto < total ? (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message={`已校对 ${upto}/${total} 段（第 ${nextBatch}/${totalBatches} 批）`}
                />
              ) : (
                <Alert
                  type="success"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message="已校对至文末"
                />
              )}

              {project?.last_error && !inProgress && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message="上次校对失败"
                  description={project.last_error}
                  action={<Button size="small" onClick={handleProofread}>重试</Button>}
                />
              )}

              <Space wrap>
                <Text>模式：</Text>
                <Radio.Group value={mode} disabled={inProgress} onChange={(e) => setMode(e.target.value)} optionType="button" buttonStyle="solid">
                  <Radio value="continue">继续校对（下一批30段）</Radio>
                  <Radio value="chapter">章节校对</Radio>
                </Radio.Group>
              </Space>

              {mode === 'chapter' && (
                <Space wrap style={{ marginTop: 12 }}>
                  <Text>章节：</Text>
                  <Select
                    style={{ width: 240 }}
                    placeholder="选择章节"
                    value={selectedChapter}
                    disabled={inProgress}
                    onChange={setSelectedChapter}
                    options={chapters.map(ch => ({ value: ch.id, label: ch.title || `第 ${ch.title_paragraph_idx} 段` }))}
                  />
                </Space>
              )}

              <Space wrap style={{ marginTop: 12 }}>
                <Text>检查类型：</Text>
                <Select
                  mode="multiple"
                  style={{ minWidth: 240 }}
                  value={selectedTypes}
                  disabled={inProgress}
                  onChange={setSelectedTypes}
                  options={TYPE_OPTIONS}
                />
              </Space>

              {results?.proofread_types && (
                <div style={{ marginTop: 12 }}>
                  <Text type="secondary">
                    继承已选类型：{results.proofread_types.map(t => TYPE_LABEL[t] || t).join('、')}
                  </Text>
                </div>
              )}

              <Space wrap style={{ marginTop: 16 }}>
                <Text>模型：</Text>
                <Select
                  style={{ width: 220 }}
                  value={selectedModel}
                  disabled={inProgress}
                  onChange={setSelectedModel}
                  options={models.map(m => ({ value: m.model_id, label: m.name }))}
                />
                <Button
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  loading={proofreading}
                  onClick={handleProofread}
                  disabled={inProgress || (mode === 'continue' && upto >= total) || (mode === 'chapter' && !selectedChapter)}
                >
                  {mode === 'continue' && upto >= total ? '已校对至文末' : '开始校对'}
                </Button>
              </Space>
            </div>
          </div>
        )}
      </Card>

      {results && groups.length > 0 && (
        <Card
          title={
            <Space>
              <Text>校对结果</Text>
              <Tag color="blue">{errors.length} 条问题</Tag>
              <Tag color="green">已采纳 {acceptedCount}</Tag>
              <Tag color="orange">待确认 {errors.length - resolvedCount}</Tag>
            </Space>
          }
          extra={
            <Space>
              <Button onClick={handleAcceptAll} disabled={errors.length === 0 || inProgress}>
                  采纳全部
                </Button>
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  loading={exporting}
                  disabled={inProgress}
                  onClick={handleExport}
                >
                导出校稿版
              </Button>
            </Space>
          }
        >
          <List
            dataSource={groups}
            renderItem={(group) => {
              const para = paraMap[group.idx]
              const resolved = group.items.every(e => e.user_status !== 'pending')
              return (
                <List.Item>
                  <div style={{ width: '100%' }}>
                    <Space style={{ marginBottom: 4 }}>
                      <Tag color="default">第 {group.idx} 段</Tag>
                      {resolved && <Tag color="green">已确认</Tag>}
                    </Space>
                    <Paragraph style={{ marginBottom: 8 }}>
                      <Text>{para?.text}</Text>
                      {para?.revised_text && <Text type="success">（已修订）</Text>}
                    </Paragraph>
                    <List
                      size="small"
                      dataSource={group.items}
                      renderItem={(err) => (
                        <List.Item
                          actions={
                            err.user_status === 'pending' ? [
                              <Button type="link" icon={<CheckCircleOutlined />} onClick={() => handleSetStatus(err.id, 'accepted')}>采纳</Button>,
                              <Button type="link" danger icon={<CloseCircleOutlined />} onClick={() => handleSetStatus(err.id, 'rejected')}>拒绝</Button>,
                            ] : [
                              <Tag color={err.user_status === 'accepted' ? 'green' : 'red'}>
                                {err.user_status === 'accepted' ? '已采纳' : '已拒绝'}
                              </Tag>,
                            ]
                          }
                        >
                          <List.Item.Meta
                            title={
                              <Space>
                                <Tag color={err.severity === 'high' ? 'red' : err.severity === 'medium' ? 'orange' : 'blue'}>
                                  {TYPE_LABEL[err.type] || err.type}
                                </Tag>
                                <Text>{err.description}</Text>
                              </Space>
                            }
                            description={
                              <div>
                                <Text type="danger" delete>{err.original_text}</Text>
                                <Text style={{ margin: '0 8px' }}>→</Text>
                                <Text type="success">{err.suggested_text}</Text>
                              </div>
                            }
                          />
                        </List.Item>
                      )}
                    />
                  </div>
                </List.Item>
              )
            }}
          />
        </Card>
      )}

      {results && groups.length === 0 && (
        <Card>
          <Empty description="尚未发现错误，或还没有校对结果" />
        </Card>
      )}
    </div>
  )
}
