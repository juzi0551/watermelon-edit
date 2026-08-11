import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import {
  Card, Button, Upload, Tag, Space, List, Typography, Spin, message,
  Empty, Drawer, Tooltip, Popconfirm, Dropdown, Modal, Popover, Badge, Splitter, Progress, Avatar,
} from 'antd'
import {
  InboxOutlined, ArrowLeftOutlined, DownloadOutlined, UnorderedListOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, EyeOutlined, LockOutlined, UnlockOutlined, ClearOutlined,
  BookOutlined, TeamOutlined, ToolOutlined, ThunderboltOutlined,
  SafetyOutlined, FormatPainterOutlined, BarChartOutlined, TagsOutlined, ContainerOutlined,
  MessageOutlined, MinusOutlined, PlusOutlined, RobotOutlined,
} from '@ant-design/icons'
import {
  getProject, uploadToProject, getModels, startProofread,
  getResults, setErrorStatus, acceptAll, exportDoc,
  getLLMLog, getBatchStatus, retryWindow, getPrompts, saveBatchConcurrency, saveWindowSize,
  toggleProjectLock, cleanEmptyParagraphs, scanProjectTerms, formatProjectIndent,
  updateParagraph,
} from '../services/api'
import ReviewReader from '../components/ReviewReader'
import ProjectProfileDrawer from '../components/ProjectProfileDrawer'
import CharacterGraph from '../components/CharacterGraph'
import ChatPanel from '../components/ChatPanel/ChatPanel'
import { color } from '../design-tokens'

const { Title, Text } = Typography
const { Dragger } = Upload

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
      try { return JSON.parse(localStorage.getItem('proofread_types') || ''); } catch { }
      return ['typo', 'grammar', 'punctuation', 'format']
    }
  )
  const [exporting, setExporting] = useState(false)
  const [panelOpen, setPanelOpen] = useState(() => {
    try {
      const saved = localStorage.getItem('reading_panel_open')
      return saved !== null ? JSON.parse(saved) : false
    } catch {
      return false
    }
  })
  const [chaptersOpen, setChaptersOpen] = useState(false)
  const [error, setError] = useState(null)
  const [runningBatch, setRunningBatch] = useState(null)
  const [selectedParas, setSelectedParas] = useState(new Set())
  const [chatPanelOpen, setChatPanelOpen] = useState(() => {
    try {
      const saved = localStorage.getItem('chat_panel_open')
      return saved !== null ? JSON.parse(saved) : false
    } catch {
      return false
    }
  })
  const [chatSelection, setChatSelection] = useState(null)
  const [fontSizeOffset, setFontSizeOffset] = useState(() => {
    try {
      return parseInt(localStorage.getItem('reader_font_offset') || '0', 10) || 0
    } catch {
      return 0
    }
  })
  const bodyFontSize = 17 + fontSizeOffset

  const [llmMonitorOpen, setLlmMonitorOpen] = useState(false)
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false)
  const [characterGraphOpen, setCharacterGraphOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [llmCalls, setLlmCalls] = useState([])
  const [llmMonitorLoading, setLlmMonitorLoading] = useState(false)
  const location = useLocation()
  const autoOpenedProfileRef = useRef(false)
  const readerRef = useRef(null)
  const llmTimerRef = useRef(null)
  // batch 模式专用 state
  const [batchInfo, setBatchInfo] = useState(null)   // 当前 batch 的窗口状态
  const [batchPolling, setBatchPolling] = useState(false)
  const [retryingWindow, setRetryingWindow] = useState(null)
  const [batchMaxConcurrent, setBatchMaxConcurrent] = useState(
    () => {
      try { return parseInt(localStorage.getItem('batch_max_concurrent') || '2', 10) || 2 } catch { return 2 }
    }
  )
  const [proofreadWindowSize, setProofreadWindowSize] = useState(
    () => {
      try { return parseInt(localStorage.getItem('proofread_window_size') || '30', 10) || 30 } catch { return 30 }
    }
  )

  const handleApplyChatText = async (revisedText, paragraphIdx, paragraphUuid, noteText = '', originalText = null) => {
    if ((paragraphIdx === undefined || paragraphIdx === null) && !paragraphUuid) {
      message.warning('请先在左侧编辑区选中或指定目标段落')
      return
    }

    const allParas = results?.paragraphs || []
    const targetPara = allParas.find(
      (p) => String(p.uuid) === String(paragraphUuid) || String(p.idx) === String(paragraphIdx)
    )

    const resolvedIdx = targetPara ? targetPara.idx : paragraphIdx

    const currentParaText = targetPara ? (targetPara.revised_text || targetPara.text || '') : ''
    let textToApply = revisedText

    // 局部切片精准替换：当 originalText 仅为段落中的局部节选且在当前段落中能精确匹配时，只替换选中的这部分文字
    if (originalText && currentParaText && currentParaText.includes(originalText) && originalText !== currentParaText) {
      textToApply = currentParaText.replace(originalText, revisedText)
    }

    let existingNotes = []
    if (targetPara?.edit_note) {
      try {
        const parsed = JSON.parse(targetPara.edit_note)
        existingNotes = Array.isArray(parsed) ? parsed : [{ id: '1', note: targetPara.edit_note, created_at: '以往修改' }]
      } catch {
        existingNotes = [{ id: '1', note: targetPara.edit_note, created_at: '以往修改' }]
      }
    }

    const cleanNoteStr = noteText
      ? (noteText.startsWith('【AI润色】') ? noteText : `【AI润色】${noteText}`)
      : '【AI润色】采纳润色建议'

    const newNoteItem = {
      id: Date.now().toString(),
      note: cleanNoteStr,
      created_at: new Date().toLocaleString('zh-CN', { hour12: false }),
    }

    const updatedNotesArray = [...existingNotes, newNoteItem]
    const updatedNotesJson = JSON.stringify(updatedNotesArray)

    // 1. 不可变更新 (Immutable State Update) 穿透 ParaRow 的 React.memo 缓存，0 延迟刷新
    setResults((prev) => {
      if (!prev || !prev.paragraphs) return prev
      const newParas = prev.paragraphs.map((p) =>
        (paragraphUuid && String(p.uuid) === String(paragraphUuid)) || (paragraphIdx != null && String(p.idx) === String(paragraphIdx))
          ? { ...p, revised_text: textToApply, edit_note: updatedNotesJson }
          : p
      )
      return { ...prev, paragraphs: newParas }
    })

    if (resolvedIdx !== null && resolvedIdx !== undefined) {
      message.success(`已应用 AI 润色结果至第 ${resolvedIdx + 1} 段`)
    } else {
      message.success(`已应用 AI 润色结果`)
    }

    // 触发正文滚动与闪烁高亮动画
    if (readerRef.current && readerRef.current.scrollToParagraph && resolvedIdx !== null && resolvedIdx !== undefined) {
      readerRef.current.scrollToParagraph(resolvedIdx)
    }

    try {
      // 2. 数据库权威更新 (支持纯 uuid 命中)
      const targetIdentifier = paragraphUuid || resolvedIdx
      await updateParagraph(projectId, targetIdentifier, textToApply, updatedNotesJson, paragraphUuid)
      // 3. 后台静默权威同步
      loadProject()
    } catch (e) {
      message.error(`应用文本失败: ${e.message || '未知错误'}`)
      loadProject()
    }
  }

  const handleAskAssistant = useCallback((context) => {
    if (!context) return
    setChatPanelOpen(true)
    try {
      localStorage.setItem('chat_panel_open', JSON.stringify(true))
    } catch (e) {}

    const targetPara = (results?.paragraphs || []).find(
      (p) => String(p.uuid) === String(context.paragraphUuid) || String(p.idx) === String(context.paragraphIdx)
    )
    const fullText = context.fullText || (targetPara?.revised_text || targetPara?.text || targetPara?.raw_text || '').trim()
    const text = (context.selectedText || '').trim()
    const isExcerpt = context.isExcerpt ?? Boolean(fullText && text && text !== fullText)

    let formattedExcerpt = context.formattedExcerpt || text
    if (!context.formattedExcerpt && isExcerpt && fullText) {
      const idxInFull = fullText.indexOf(text)
      const hasLeading = idxInFull > 0
      const hasTrailing = idxInFull >= 0 && (idxInFull + text.length < fullText.length)
      formattedExcerpt = `${hasLeading ? '…' : ''}${text}${hasTrailing ? '…' : ''}`
    }

    const selObj = {
      selectedText: context.selectedText,
      formattedExcerpt,
      isExcerpt,
      fullText,
      paragraphIdx: context.paragraphIdx,
      paragraphEndIdx: context.paragraphEndIdx,
      paragraphUuid: context.paragraphUuid,
    }
    setChatSelection(selObj)

    if (context.prompt) {
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('trigger_chat_send', {
            detail: {
              prompt: context.prompt,
              selection: selObj,
            },
          })
        )
      }, 100)
    }
  }, [results])

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
      if (!data.error) {
        setResults(data)
        // 段落数据刷新（删除/合并/插入/恢复等变更后）时，全局失效段落状态缓存
        window.dispatchEvent(new CustomEvent('paragraph-status-invalidated'))
      }
    } catch { }
  }

  const loadModels = async () => {
    try {
      const data = await getModels()
      const proofreadModels = data.filter(m => !m.agentic)
      setModels(proofreadModels)
      if (proofreadModels.length && !proofreadModels.find(m => m.model_id === selectedModel)) {
        setSelectedModel(proofreadModels[0].model_id)
      }
    } catch { }
  }

  useEffect(() => {
    loadProject()
    loadModels()
  }, [projectId])

  // 首次新建项目进入页面且作品设定仍为空时，自动弹出作品设定抽屉面板
  useEffect(() => {
    if (!autoOpenedProfileRef.current && project) {
      const isProfileEmpty = !project.author_name?.trim() && !project.author_intro?.trim() && !project.background_setting?.trim()
      const isNew = location.state?.isNewProject || new URLSearchParams(location.search).get('isNew') === 'true'
      if (isNew && isProfileEmpty) {
        autoOpenedProfileRef.current = true
        setProfileDrawerOpen(true)
      }
    }
  }, [location, project])

  useEffect(() => {
    document.title = project?.name || 'Watermelon Edit'
  }, [project])

  // 持久化面板开合状态到 localStorage
  useEffect(() => {
    localStorage.setItem('reading_panel_open', JSON.stringify(panelOpen))
  }, [panelOpen])

  useEffect(() => {
    localStorage.setItem('chat_panel_open', JSON.stringify(chatPanelOpen))
  }, [chatPanelOpen])

  // persist proofread config across refreshes
  useEffect(() => { localStorage.setItem('proofread_model', selectedModel) }, [selectedModel])
  useEffect(() => { localStorage.setItem('proofread_types', JSON.stringify(selectedTypes)) }, [selectedTypes])

  // sync settings from backend DB
  useEffect(() => {
    getPrompts().then(data => {
      if (data) {
        if (data.batch_max_concurrent) {
          setBatchMaxConcurrent(data.batch_max_concurrent)
          localStorage.setItem('batch_max_concurrent', String(data.batch_max_concurrent))
        }
        if (data.proofread_window_size) {
          setProofreadWindowSize(data.proofread_window_size)
          localStorage.setItem('proofread_window_size', String(data.proofread_window_size))
        }
      }
    }).catch(() => { })
  }, [])

  const handleBatchMaxConcurrentChange = (val) => {
    const num = Math.max(1, Math.min(val || 1, 20))
    setBatchMaxConcurrent(num)
    localStorage.setItem('batch_max_concurrent', String(num))
    saveBatchConcurrency(num).catch(() => { })
  }

  const handleWindowSizeChange = (val) => {
    const num = Math.max(5, Math.min(val || 5, 500))
    setProofreadWindowSize(num)
    localStorage.setItem('proofread_window_size', String(num))
    saveWindowSize(num).catch(() => { })
  }

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
        window_size: proofreadWindowSize,
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
        ? Math.floor((project?.proofread_upto || 0) / proofreadWindowSize) + 1
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
    } catch { }
  }

  // ── 批量校对专用逻辑 ──────────────────────
  const handleBatchProofread = async () => {
    setProofreading(true)
    setBatchInfo(null)
    try {
      const res = await startProofread(projectId, {
        mode: 'batch',
        model: selectedModel,
        types: selectedTypes,
        max_concurrent: batchMaxConcurrent,
        window_size: proofreadWindowSize,
      })
      if (res.error) { message.error(res.error); setProofreading(false); return }
      if (res.status === 'skipped') { message.info(res.message); setProofreading(false); loadProject(); return }
      if (res.status === 'running') { message.info(res.message); setProofreading(false); return }
      // 启动两路轮询：1) project.status（2) batch 窗口进度
      await Promise.all([
        pollBatch(res.batch_id),
        pollProofread(null),
      ])
    } catch (e) {
      message.error('批量校对失败：' + (e.response?.data?.detail || e.message))
      setProofreading(false)
    }
  }

  const pollBatch = async (batchId) => {
    setBatchPolling(true)
    let failStreak = 0
    for (let i = 0; i < 600; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      try {
        const data = await getBatchStatus(projectId, batchId)
        if (!data.error) {
          setBatchInfo(data)
          failStreak = 0
          if (data.status !== 'running') break
        }
      } catch {
        failStreak++
        if (failStreak >= 5) {
          message.warning('网络异常，已暂停轮询进度，请手动刷新')
          break
        }
      }
    }
    setBatchPolling(false)
  }

  const handleRetryWindow = async (batchId, windowIndex) => {
    setRetryingWindow(windowIndex)
    try {
      const res = await retryWindow(projectId, {
        batch_id: batchId,
        window_index: windowIndex,
        model: selectedModel,
        types: selectedTypes,
      })
      if (res.status === 'ok') {
        message.success(res.message)
        const data = await getBatchStatus(projectId, batchId)
        if (!data.error) setBatchInfo(data)
        loadResults()
        loadProject()
      } else {
        message.error(res.message || '重试失败')
        const data = await getBatchStatus(projectId, batchId)
        if (!data.error) setBatchInfo(data)
      }
    } catch (e) {
      message.error('重试失败：' + (e.response?.data?.detail || e.message))
    } finally {
      setRetryingWindow(null)
    }
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

  const handleExport = async (mode = 'print') => {
    setExporting(true)
    try {
      const res = await exportDoc(projectId, mode)
      const blob = res.blob || res
      const modeTag = mode === 'comment' ? '批注版' : '打印版'
      const filename = res.filename || `${project?.name || '校稿'}_${modeTag}_${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)}.docx`
      const url = window.URL.createObjectURL(new Blob([blob]))
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      window.URL.revokeObjectURL(url)
      message.success(`已成功导出 ${modeTag} docx`)
    } catch (e) {
      message.error('导出失败：' + (e.response?.data?.detail || e.message))
    } finally {
      setExporting(false)
    }
  }

  const [cleaningEmpty, setCleaningEmpty] = useState(false)
  const [scanningTerms, setScanningTerms] = useState(false)

  const handleCleanEmptyParagraphs = async () => {
    if (!project) return
    setCleaningEmpty(true)
    try {
      const res = await cleanEmptyParagraphs(projectId)
      if (res.error) {
        message.error(res.error)
      } else {
        message.success(`已成功清理 ${res.deleted_count || 0} 个空白段落，并完成序号重排！`)
        loadProject()
        loadResults()
      }
    } catch (e) {
      message.error('清理失败：' + e.message)
    } finally {
      setCleaningEmpty(false)
    }
  }

  const handleScanTerms = async () => {
    if (!project?.id) return
    setScanningTerms(true)
    try {
      const res = await scanProjectTerms(project.id)
      if (res.error) {
        message.error('扫描失败：' + res.error)
      } else {
        const newCount = res.new_issues ?? 0
        if (newCount > 0) {
          message.success(`规范检测完成！发现 ${newCount} 处新问题`)
        } else {
          message.info('规范检测完成！未发现新问题')
        }
        loadResults()
      }
    } catch (e) {
      message.error('离线扫描失败：' + e.message)
    } finally {
      setScanningTerms(false)
    }
  }

  const [formattingIndent, setFormattingIndent] = useState(false)

  const handleFormatIndent = async () => {
    if (!project?.id) return
    setFormattingIndent(true)
    try {
      const res = await formatProjectIndent(project.id)
      if (res.error) {
        message.error('处理失败：' + res.error)
      } else {
        message.success(`段首缩进处理完成！共清理 ${res.formatted_count || 0} 个段落的前置杂乱硬空格，已应用纯 CSS 物理缩进`)
        loadProject()
        loadResults()
      }
    } catch (e) {
      message.error('处理失败：' + e.message)
    } finally {
      setFormattingIndent(false)
    }
  }

  const total = project?.paragraph_count || 0
  const upto = project?.proofread_upto || results?.proofread_upto || 0
  const chapters = results?.chapters || []

  const windowStart = upto
  const windowEnd = Math.min(upto + proofreadWindowSize, total)
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
        styles={{
          title: { width: '100%', overflow: 'visible', paddingRight: 0 },
        }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', position: 'relative' }}>
            <Space wrap style={{ flexShrink: 0 }}>
              <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/')} />
              <Tooltip title={project?.is_locked === 1 ? '解开锁定（解除项目/段落防误删）' : '锁定项目（开启项目/段落防误删）'}>
                <Button
                  type={project?.is_locked === 1 ? 'primary' : 'text'}
                  danger={project?.is_locked === 1}
                  size="small"
                  shape="circle"
                  icon={project?.is_locked === 1 ? <LockOutlined /> : <UnlockOutlined />}
                  onClick={async () => {
                    if (!project) return
                    const nextState = project.is_locked !== 1
                    try {
                      await toggleProjectLock(project.id, nextState)
                      message.success(nextState ? '项目已锁定（已防误删）' : '项目已解锁')
                      loadProject()
                    } catch (e) {
                      message.error(e.message || '操作失败')
                    }
                  }}
                />
              </Tooltip>
              {total > 0 && (
                <Tooltip title={`校对进度：已完成 ${upto} / ${total} 段 (${Math.round((upto / total) * 100)}%)`}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginInline: 4 }}>
                    <span style={{ fontSize: 12, color: color.textSecondary, whiteSpace: 'nowrap' }}>校对进度:</span>
                    <Progress
                      percent={Math.round((upto / total) * 100)}
                      size="small"
                      style={{ width: 100, margin: 0 }}
                      strokeColor={{ '0%': '#d4a359', '100%': '#52c41a' }}
                    />
                  </div>
                </Tooltip>
              )}
              <Tooltip title={(!project?.author_name?.trim() && !project?.author_intro?.trim() && !project?.background_setting?.trim()) ? '作品设定未填写！建议配置文风与专有名词，避免 LLM 校对时误判特色词汇' : '查看与修改作品设定与文风'}>
                <Badge dot={!project?.author_name?.trim() && !project?.author_intro?.trim() && !project?.background_setting?.trim()} offset={[-4, 4]}>
                  <Button
                    icon={<BookOutlined />}
                    onClick={() => setProfileDrawerOpen(true)}
                    shape="round"
                    size="small"
                    danger={!project?.author_name?.trim() && !project?.author_intro?.trim() && !project?.background_setting?.trim()}
                  >
                    作品设定 {(!project?.author_name?.trim() && !project?.author_intro?.trim() && !project?.background_setting?.trim()) && <span style={{ fontSize: 11, marginLeft: 2 }}>⚠ 待配置</span>}
                  </Button>
                </Badge>
              </Tooltip>
              <Button
                icon={<TeamOutlined />}
                onClick={() => setCharacterGraphOpen(true)}
                shape="round"
                size="small"
              >
                人物图谱
              </Button>
              <Button
                icon={<EyeOutlined />}
                onClick={() => setLlmMonitorOpen(true)}
                shape="round"
                size="small"
              >
                LLM 实时
              </Button>
              {project?.last_error && (
                <Tag color="warning" style={{ fontSize: 12, marginLeft: 8 }}>
                  ⚠ {project.last_error}
                </Tag>
              )}
            </Space>

            {/* 基于 100% 通栏绝对数学居中放置「字号： [ - ] 17 [ + ]」组件 */}
            <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: 'var(--color-bgCard, #fafafa)',
                borderRadius: 6,
                border: '1px solid var(--color-border, #d9d9d9)',
                padding: '2px 8px',
              }}>
                <span style={{ fontSize: 13, color: color.textSecondary, fontWeight: 500, whiteSpace: 'nowrap' }}>字号：</span>
                <Button
                  type="text"
                  size="small"
                  icon={<MinusOutlined />}
                  disabled={bodyFontSize <= 14}
                  onClick={() => {
                    const nextOffset = Math.max(fontSizeOffset - 1, -3)
                    setFontSizeOffset(nextOffset)
                    try { localStorage.setItem('reader_font_offset', nextOffset.toString()) } catch {}
                  }}
                  style={{ width: 24, height: 24, fontSize: 12 }}
                />
                <span style={{ fontSize: 13, minWidth: 20, textAlign: 'center', fontWeight: 600, color: color.textPrimary }}>
                  {bodyFontSize}
                </span>
                <Button
                  type="text"
                  size="small"
                  icon={<PlusOutlined />}
                  disabled={bodyFontSize >= 48}
                  onClick={() => {
                    const nextOffset = Math.min(fontSizeOffset + 1, 31)
                    setFontSizeOffset(nextOffset)
                    try { localStorage.setItem('reader_font_offset', nextOffset.toString()) } catch {}
                  }}
                  style={{ width: 24, height: 24, fontSize: 12 }}
                />
              </div>
            </div>
          </div>
        }
        extra={
          <Space wrap align="center">
            <Tooltip title={chatPanelOpen ? '收起 AI 助手' : '展开 AI 助手'}>
              <div
                onClick={() => setChatPanelOpen((v) => !v)}
                style={{
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '50%',
                  transition: 'all 0.25s ease',
                  boxShadow: chatPanelOpen ? '0 4px 12px rgba(59, 130, 246, 0.35)' : 'none',
                }}
              >
                <Avatar
                  size={40}
                  src="/assistant-avatar.png"
                  style={{
                    background: chatPanelOpen
                      ? 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)'
                      : 'linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)',
                    transition: 'all 0.25s ease',
                    border: chatPanelOpen ? '2px solid #60a5fa' : '1px solid #bae6fd',
                  }}
                />
              </div>
            </Tooltip>
            <Modal
              title={
                <Space>
                  <ToolOutlined style={{ color: color.primary }} />
                  <span>快捷自动化工具箱</span>
                </Space>
              }
              open={toolsOpen}
              onCancel={() => setToolsOpen(false)}
              width={800}
              zIndex={1100}
              footer={null}
              destroyOnHidden
              styles={{
                content: {
                  background: color.bgPage,
                  color: color.textPrimary,
                  padding: 24,
                  borderRadius: 12,
                },
                header: {
                  background: 'transparent',
                  color: color.textPrimary,
                  marginBottom: 16,
                },
              }}
            >
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 16,
              }}>
                {/* 1. 清空行 */}
                <Card
                  hoverable
                  size="small"
                  onClick={() => {
                    if (project?.is_locked === 1 || inProgress || cleaningEmpty) return
                    setToolsOpen(false)
                    Modal.confirm({
                      title: '确定清理所有空白段落？',
                      content: '系统将自动清理所有无意义空行，并重新连续编排段号。',
                      okText: '确定清理',
                      cancelText: '取消',
                      onOk: handleCleanEmptyParagraphs,
                    })
                  }}
                  style={{
                    background: color.bgCard,
                    borderColor: color.borderBar,
                    borderRadius: 8,
                    cursor: (project?.is_locked === 1 || inProgress) ? 'not-allowed' : 'pointer',
                    opacity: (project?.is_locked === 1 || inProgress) ? 0.4 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <ClearOutlined style={{ fontSize: 22, color: color.primary }} />
                    <span style={{ fontSize: 14, color: color.textPrimary, fontWeight: 600 }}>清空空行</span>
                  </div>
                  <div style={{ fontSize: 12, color: color.textSecondary, lineHeight: 1.4 }}>
                    一键擦除全书无意义连续空行，重新连续编排正文段落编号。
                  </div>
                </Card>


                {/* 3. 段首缩进 */}
                <Card
                  hoverable
                  size="small"
                  onClick={() => {
                    setToolsOpen(false)
                    Modal.confirm({
                      title: '确定清理全书段首杂乱硬空格？',
                      content: '系统将扫描全书段落，彻底擦除段首残留的杂乱空格与 Tab 缩进，恢复文本内容纯净。',
                      okText: '确定清理',
                      cancelText: '取消',
                      onOk: handleFormatIndent,
                    })
                  }}
                  style={{
                    background: color.bgCard,
                    borderColor: color.borderBar,
                    borderRadius: 8,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <FormatPainterOutlined style={{ fontSize: 22, color: color.primary }} />
                    <span style={{ fontSize: 14, color: color.textPrimary, fontWeight: 600 }}>段首缩进</span>
                  </div>
                  <div style={{ fontSize: 12, color: color.textSecondary, lineHeight: 1.4 }}>
                    彻底擦除段首残留的杂乱硬空格与 Tab 缩进，恢复文本纯净。
                  </div>
                </Card>

                {/* 4. 敏感词 (预留) */}
                <Card
                  size="small"
                  onClick={() => message.info('敏感词自查工具开发中')}
                  style={{
                    background: color.bgCard,
                    borderColor: color.border,
                    borderRadius: 8,
                    opacity: 0.5,
                    cursor: 'not-allowed',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <SafetyOutlined style={{ fontSize: 22, color: color.textTertiary }} />
                    <span style={{ fontSize: 14, color: color.textSecondary, fontWeight: 600 }}>敏感词自查</span>
                    <Tag style={{ margin: 0, fontSize: 10 }}>开发中</Tag>
                  </div>
                  <div style={{ fontSize: 12, color: color.textTertiary, lineHeight: 1.4 }}>
                    自查出版违规词汇、涉政涉黄敏感用语并提供替换提醒。
                  </div>
                </Card>

                {/* 5. 字数统计 (预留) */}
                <Card
                  size="small"
                  onClick={() => message.info('字数统计与分析工具开发中')}
                  style={{
                    background: color.bgCard,
                    borderColor: color.border,
                    borderRadius: 8,
                    opacity: 0.5,
                    cursor: 'not-allowed',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <BarChartOutlined style={{ fontSize: 22, color: color.textTertiary }} />
                    <span style={{ fontSize: 14, color: color.textSecondary, fontWeight: 600 }}>字数统计</span>
                    <Tag style={{ margin: 0, fontSize: 10 }}>开发中</Tag>
                  </div>
                  <div style={{ fontSize: 12, color: color.textTertiary, lineHeight: 1.4 }}>
                    统计全书总字数、平均段长与章节篇幅分布曲线。
                  </div>
                </Card>

                {/* 6. 术语知识库 (预留) */}
                <Card
                  size="small"
                  onClick={() => message.info('专有名词提取工具开发中')}
                  style={{
                    background: color.bgCard,
                    borderColor: color.border,
                    borderRadius: 8,
                    opacity: 0.5,
                    cursor: 'not-allowed',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <TagsOutlined style={{ fontSize: 22, color: color.textTertiary }} />
                    <span style={{ fontSize: 14, color: color.textSecondary, fontWeight: 600 }}>术语知识库</span>
                    <Tag style={{ margin: 0, fontSize: 10 }}>开发中</Tag>
                  </div>
                  <div style={{ fontSize: 12, color: color.textTertiary, lineHeight: 1.4 }}>
                    自动提取人名、地名、神兵功法专有名词并建立知识库。
                  </div>
                </Card>
              </div>
            </Modal>
          </Space>
        }
        style={{ marginBottom: 0 }}
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
          <Splitter
            style={{ height: 'calc(100vh - 118px)' }}
            onResize={(sizes) => {
              if (sizes && sizes.length > 1 && chatPanelOpen) {
                const total = sizes[0] + sizes[1]
                if (total > 0) {
                  const pct = Math.min(Math.max(Math.round((sizes[1] / total) * 100), 20), 50)
                  localStorage.setItem('chat_panel_ratio', `${pct}%`)
                  localStorage.setItem('chat_panel_width', Math.round(sizes[1]).toString())
                }
              }
            }}
          >
            <Splitter.Panel min="30%">
              {results && (
                <ReviewReader
                  ref={readerRef}
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
                  onReloadProject={loadProject}
                  onStartSelectionProofread={handleSelectionProofread}
                  onStartBatchProofread={handleBatchProofread}
                  batchInfo={batchInfo}
                  batchPolling={batchPolling}
                  onRetryWindow={handleRetryWindow}
                  retryingWindow={retryingWindow}
                  batchMaxConcurrent={batchMaxConcurrent}
                  onBatchMaxConcurrentChange={handleBatchMaxConcurrentChange}
                  proofreadWindowSize={proofreadWindowSize}
                  onWindowSizeChange={handleWindowSizeChange}
                  fontSizeOffset={fontSizeOffset}
                  onAskAssistant={handleAskAssistant}
                  onExport={handleExport}
                  exporting={exporting}
                  onOpenTools={() => setToolsOpen(true)}
                />
              )}
            </Splitter.Panel>

            {/* antd Splitter.Panel 托管的 AI 助手侧栏 */}
            {chatPanelOpen && (
              <Splitter.Panel
                min={320}
                max="50%"
                defaultSize={localStorage.getItem('chat_panel_ratio') || '35%'}
              >
                <ChatPanel
                  projectId={projectId}
                  visible={true}
                  onClose={() => setChatPanelOpen(false)}
                  activeSelection={chatSelection}
                  onClearSelection={() => setChatSelection(null)}
                  onApplyText={handleApplyChatText}
                  selectedModel={selectedModel}
                  bodyFontSize={bodyFontSize}
                  onScrollToParagraph={(idx) => readerRef.current?.scrollToParagraph?.(idx)}
                />
              </Splitter.Panel>
            )}
          </Splitter>
        )}

        <LLMMonitor
          open={llmMonitorOpen}
          onClose={() => setLlmMonitorOpen(false)}
          calls={llmCalls}
          loading={llmMonitorLoading}
        />

        <ProjectProfileDrawer
          open={profileDrawerOpen}
          onClose={() => setProfileDrawerOpen(false)}
          project={project}
          onProjectUpdated={loadProject}
          onResultsReload={loadResults}
          bodyFontSize={bodyFontSize}
        />

        <CharacterGraph
          open={characterGraphOpen}
          onClose={() => setCharacterGraphOpen(false)}
          projectId={project?.id}
          totalParagraphs={total}
          onScrollToParagraph={(idx) => {
            if (readerRef.current && readerRef.current.scrollToParagraph) {
              readerRef.current.scrollToParagraph(idx)
            }
          }}
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
  ok: { color: '#22c55e', bg: '#f0fdf4', label: '完成', dot: false },
  error: { color: '#ef4444', bg: '#fef2f2', label: '失败', dot: false },
}
const THINKING_CFG = {
  thinking: { color: '#7c3aed', bg: '#f5f3ff', label: '思考中', pulse: true },
  done: { color: '#16a34a', bg: '#f0fdf4', label: '思考完毕', pulse: false },
  idle: null,
}

function LLMMonitor({ open, onClose, calls, loading }) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={680}
      styles={{
        header: { borderBottom: '1px solid #f0f0f0', padding: '14px 20px' },
        body: { padding: '16px 20px', background: '#f8fafc' },
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
  const [respOpen, setRespOpen] = useState(true)
  const thinkRef = useRef(null)
  const respRef = useRef(null)

  const sCfg = STATUS_CFG[c.status] || STATUS_CFG.error
  const tCfg = THINKING_CFG[c.thinking_status] || null
  const isRunning = c.status === 'running'
  const isThinking = c.thinking_status === 'thinking'
  const hasThink = c.thinking && c.thinking.length > 0
  const hasResp = c.response && c.response.length > 0

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
