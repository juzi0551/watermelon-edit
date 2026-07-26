import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, forwardRef } from 'react'
import {
  Card, Button, Tag, Space, Typography, Empty, Tabs,
  Select, Radio, Progress, Input, InputNumber, Badge, Popover, Tooltip, message,
  Checkbox, Modal, Popconfirm,
} from 'antd'
import {
  CheckCircleOutlined, CloseCircleOutlined,
  ThunderboltOutlined, LoadingOutlined, CloseOutlined,
  MinusOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
  ScissorOutlined, BookOutlined, ExclamationCircleOutlined,
} from '@ant-design/icons'
import { color, radius, spacing, fontSize } from '../design-tokens'
import {
  updateParagraph, deleteParagraph, togglePageBreak, setChapter,
} from '../services/api'

const TYPE_LABEL = {
  typo: '错别字', grammar: '语法', punctuation: '标点', format: '格式',
}
const SEVERITY_COLOR = { high: 'red', medium: 'orange', low: 'default' }
const SEVERITY_LABEL = { high: '高', medium: '中', low: '低' }
const TYPE_OPTIONS = [
  { value: 'typo', label: '错别字' },
  { value: 'grammar', label: '语法' },
  { value: 'punctuation', label: '标点' },
  { value: 'format', label: '格式' },
]
const kbdStyle = {
  display: 'inline-block', minWidth: 24, textAlign: 'center',
  padding: '0 6px', fontSize: 11, lineHeight: '20px',
  background: 'rgba(255,255,255,0.15)', borderRadius: 4,
  border: '1px solid rgba(255,255,255,0.3)', marginRight: 6,
  fontFamily: 'inherit',
}

function computeInlineDiff(original, suggested) {
  let prefixLen = 0
  while (prefixLen < original.length && prefixLen < suggested.length &&
         original[prefixLen] === suggested[prefixLen]) {
    prefixLen++
  }
  let suffixLen = 0
  while (suffixLen < original.length - prefixLen &&
         suffixLen < suggested.length - prefixLen &&
         original[original.length - 1 - suffixLen] === suggested[suggested.length - 1 - suffixLen]) {
    suffixLen++
  }
  return {
    prefix: original.slice(0, prefixLen),
    removed: original.slice(prefixLen, original.length - suffixLen),
    added: suggested.slice(prefixLen, suggested.length - suffixLen),
    suffix: original.slice(original.length - suffixLen),
  }
}

function DiffView({ original, suggested }) {
  const { prefix, removed, added, suffix } = useMemo(
    () => computeInlineDiff(original, suggested),
    [original, suggested],
  )
  return (
    <div style={{
      background: color.bgCard,
      borderRadius: radius.md,
      padding: `${spacing.sm}px ${spacing.md}px`,
      fontSize: fontSize.bodySm,
      lineHeight: 1.8,
      border: `1px solid ${color.border}`,
    }}>
      {prefix && <span style={{ color: color.textPrimary }}>{prefix}</span>}
      {removed && (
        <span style={{
          background: color.diffRemovedBg,
          color: color.diffRemovedText,
          textDecoration: 'line-through',
          padding: '1px 4px',
          borderRadius: radius.sm,
          margin: '0 1px',
        }}>
          {removed}
        </span>
      )}
      {added && (
        <span style={{
          background: color.diffAddedBg,
          color: color.diffAddedText,
          fontWeight: 600,
          padding: '1px 4px',
          borderRadius: radius.sm,
          margin: '0 1px',
        }}>
          {added}
        </span>
      )}
      {suffix && <span style={{ color: color.textPrimary }}>{suffix}</span>}
    </div>
  )
}

function ErrorDetailCardInner({ error, onAccept, onReject, onClose }, ref) {
  const pending = error.user_status === 'pending'
  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        zIndex: 1100,
        width: 380,
        padding: '14px 16px 12px',
        background: color.bgCard,
        borderRadius: radius.md,
        borderLeft: `3px solid ${color.warning}`,
        boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        opacity: 0,
        transform: 'translateY(3px)',
        transition: 'opacity 0.08s cubic-bezier(0, 0, 0.2, 1), transform 0.08s cubic-bezier(0, 0, 0.2, 1)',
      }}
    >
      <div style={{ position: 'relative' }}>
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined />}
          onClick={(e) => { e.stopPropagation(); onClose?.() }}
          style={{ position: 'absolute', top: -6, right: -8, width: 24, height: 24, fontSize: 12, color: color.textTertiary }}
        />
      <div style={{ marginBottom: 10 }}>
        <DiffView
          original={error.original_text}
          suggested={error.suggested_text}
        />
      </div>
      </div>
      <div style={{
        marginBottom: 8,
        color: color.textSecondary,
        fontSize: fontSize.bodySm,
        lineHeight: 1.6,
        padding: '6px 10px',
        background: color.bgPage,
        borderRadius: radius.sm,
      }}>
        {error.description}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        <Tag style={{ margin: 0, fontSize: 11, lineHeight: '20px' }}>{TYPE_LABEL[error.type] || error.type}</Tag>
        <Tag color={SEVERITY_COLOR[error.severity]} style={{ margin: 0, fontSize: 11, lineHeight: '20px' }}>
          {SEVERITY_LABEL[error.severity]}危
        </Tag>
        {!pending && (
          <Tag color={error.user_status === 'accepted' ? 'green' : 'red'} style={{ margin: '0 0 0 auto', fontSize: 11, lineHeight: '20px' }}>
            {error.user_status === 'accepted' ? '已采纳' : '已拒绝'}
          </Tag>
        )}
        {pending && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <Button
              type="primary"
              size="small"
              shape="round"
              onClick={(e) => { e.stopPropagation(); onAccept?.() }}
              style={{ height: 26, fontSize: 12, paddingInline: 12, lineHeight: '24px' }}
            >
              采纳
            </Button>
            <Button
              size="small"
              shape="round"
              onClick={(e) => { e.stopPropagation(); onReject?.() }}
              style={{ height: 26, fontSize: 12, paddingInline: 12, lineHeight: '24px', borderColor: color.border }}
            >
              拒绝
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

const ErrorDetailCard = forwardRef(ErrorDetailCardInner)

function ParagraphView({ text, paraErrors, selectedId, onSelect }) {
  if (!text) return null
  // 对同一原文多次出现，按顺序分配不同位置
  const posMap = {}
  const intervals = []
  paraErrors.forEach(e => {
    const t = e.original_text
    const from = posMap[t] ?? 0
    const idx = text.indexOf(t, from)
    if (idx >= 0) {
      intervals.push({ error: e, start: idx, end: idx + t.length })
      posMap[t] = idx + 1
    }
  })
  if (intervals.length === 0) return <span>{text}</span>
  intervals.sort((a, b) => a.start - b.start || a.end - b.end)

  // 按所有区间边界切分正文，每段只渲染一次（无重复），标注覆盖它的所有错误 id
  const bounds = new Set([0, text.length])
  intervals.forEach(iv => { bounds.add(iv.start); bounds.add(iv.end) })
  const points = [...bounds].sort((a, b) => a - b)

  const segs = []
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]
    const end = points[i + 1]
    if (start >= end) continue
    const segText = text.slice(start, end)
    const covering = intervals.filter(iv => iv.start <= start && iv.end >= end)
    if (covering.length === 0) {
      segs.push(<span key={`t${start}`}>{segText}</span>)
      continue
    }
    const ids = covering.map(iv => iv.error.id)
    const isSelected = ids.includes(selectedId)
    const srcIv = covering.find(iv => iv.error.id === selectedId) || covering[0]
    const source = srcIv.error
    const accepted = source.user_status === 'accepted'
    const pending = source.user_status === 'pending'
    const displayText = (() => {
      // 单错误覆盖且已采纳：将 segment 按原文长度比例映射到 suggested_text
      if (covering.length === 1 && accepted) {
        const origSegLen = end - start
        const origErrLen = srcIv.end - srcIv.start
        const sugErrLen = source.suggested_text.length
        const off = start - srcIv.start
        if (origErrLen > 0) {
          const sugSegLen = Math.round(origSegLen * sugErrLen / origErrLen)
          return source.suggested_text.slice(off, off + sugSegLen)
        }
      }
      return segText
    })()
    segs.push(
      <span
        key={`seg${start}`}
        data-error-id={ids.join(',')}
        onClick={() => {
          if (ids.length <= 1) { onSelect(ids[0]); return }
          const cur = ids.indexOf(selectedId)
          onSelect(ids[(cur + 1) % ids.length])
        }}
        title={covering.length > 1
          ? covering.map(iv => `${iv.error.original_text} → ${iv.error.suggested_text}`).join('\n')
          : undefined}
        style={{
          cursor: 'pointer',
          padding: '0 2px',
          borderRadius: 2,
          backgroundColor: isSelected ? color.bgHighlight : 'transparent',
          borderBottom: accepted
            ? `1px dashed ${color.textTertiary}`
            : pending
              ? (isSelected ? `2px solid ${color.warning}` : `1px dotted ${color.warning}`)
              : 'none',
        }}
      >{displayText}</span>,
    )
  }
  return <>{segs}</>
}

function ErrorList({ errors, selectedId, onSelect, unmatchedIds, onSetStatus }) {
  return errors.map(e => {
    const statusColor = e.user_status === 'pending' ? color.warning
      : e.user_status === 'accepted' ? color.success : color.borderRejected
    const noLoc = unmatchedIds?.has(e.id)
    const done = e.user_status !== 'pending'
    return (
      <div
        key={e.id}
        className="error-list-item"
        style={{
          cursor: 'pointer',
          background: e.id === selectedId ? color.bgHighlight : color.bgPage,
          padding: '10px 14px',
          borderRadius: radius.md,
          marginBottom: 6,
          border: '1px solid',
          borderColor: noLoc ? '#faad14' : (e.id === selectedId ? color.borderSelected : color.border),
          borderLeft: `3px solid ${statusColor}`,
          transition: 'background 0.15s, box-shadow 0.15s',
        }}
        onClick={() => onSelect(e.id)}
        onMouseEnter={(e) => {
          if (e.id !== selectedId) e.currentTarget.style.background = color.bgCard
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = e.id === selectedId ? color.bgHighlight : color.bgPage
        }}
      >
        <Space size={spacing.xs} style={{ marginBottom: 4 }}>
          <Tag style={{ fontSize: fontSize.metaSm, margin: 0, border: 'none', background: color.border, color: color.textSecondary }}>
            第{e.paragraph_index}段
          </Tag>
          {noLoc && <Tag color="warning" style={{ fontSize: fontSize.metaSm, margin: 0 }}>位置异常</Tag>}
          <Tag style={{ fontSize: fontSize.metaSm, margin: 0 }}>{TYPE_LABEL[e.type] || e.type}</Tag>
          <Tag style={{ fontSize: fontSize.metaSm, margin: 0 }} color={SEVERITY_COLOR[e.severity]}>
            {SEVERITY_LABEL[e.severity]}
          </Tag>
          {done && (
            <Button
              type="text"
              size="small"
              onClick={(ev) => { ev.stopPropagation(); onSetStatus?.(e.id, 'pending') }}
              style={{ height: 20, fontSize: 11, lineHeight: '18px', paddingInline: 6, color: color.textSecondary }}
            >
              重置
            </Button>
          )}
        </Space>
        <div style={{ fontSize: fontSize.bodyXs, lineHeight: 1.6 }}>
          <span style={{
            background: color.diffRemovedBg,
            color: color.diffRemovedText,
            textDecoration: 'line-through',
            padding: '1px 4px',
            borderRadius: radius.sm,
          }}>
            {e.original_text}
          </span>
          <span style={{ margin: '0 6px', color: color.textMuted, fontSize: fontSize.meta }}>→</span>
          <span style={{
            background: color.diffAddedBg,
            color: color.diffAddedText,
            padding: '1px 4px',
            borderRadius: radius.sm,
            fontWeight: 500,
          }}>
            {e.suggested_text}
          </span>
        </div>
        <div style={{ fontSize: fontSize.meta, color: color.textDescription, marginTop: 3 }}>{e.description}</div>
      </div>
    )
  })
}



export default function ReviewReader({
  results, project, inProgress, onSetStatus, onAcceptAll,
  panelOpen, onTogglePanel,
  chapters = [], selectedChapter = null, onStartProofread,
  selectedModel, onModelChange,
  models = [],
  selectedTypes = ['typo', 'grammar', 'punctuation', 'format'], onTypesChange,
  percent = 0,
  proofreading = false,
  total = 0, upto = 0,
  bannerText = '',
  projectError = null, onRetry, onChapterChange,
  selectedParas, onSelectionChange, onStartSelectionProofread,
  onReloadProject,
  // batch 模式专用
  onStartBatchProofread, batchInfo = null, batchPolling = false, onRetryWindow, retryingWindow = null,
  batchMaxConcurrent = 2, onBatchMaxConcurrentChange,
  proofreadWindowSize = 30, onWindowSizeChange,
}) {
  const errors = results?.errors || []
  const paras = results?.paragraphs || []
  const paraMap = useMemo(() => Object.fromEntries(paras.map(p => [p.idx, p])), [paras])

  const errorParaIdxs = useMemo(() => {
    const set = new Set(errors.map(e => e.paragraph_index))
    return [...set].sort((a, b) => a - b)
  }, [errors])

  const flatErrors = useMemo(
    () => [...errors].sort((a, b) => a.paragraph_index - b.paragraph_index),
    [errors],
  )
  const pending = useMemo(() => flatErrors.filter(e => e.user_status === 'pending'), [flatErrors])
  const accepted = useMemo(() => flatErrors.filter(e => e.user_status === 'accepted').reverse(), [flatErrors])
  const rejected = useMemo(() => flatErrors.filter(e => e.user_status === 'rejected').reverse(), [flatErrors])
  const unmatchedIds = useMemo(() => {
    const ids = new Set()
    errors.forEach(e => {
      const para = paraMap[e.paragraph_index]
      if (!para || !para.text || (e.original_text && para.text.indexOf(e.original_text) < 0)) {
        ids.add(e.id)
      }
    })
    return ids
  }, [errors, paraMap])

  const [selectedId, setSelectedId] = useState(null)
  const [panelTab, setPanelTab] = useState('pending')
  const [customEdit, setCustomEdit] = useState('')

  const [editingIdx, setEditingIdx] = useState(null)
  const [editingText, setEditingText] = useState('')
  const [savingPara, setSavingPara] = useState(false)
  const [hoverIdx, setHoverIdx] = useState(null)
  const [activeIdx, setActiveIdx] = useState(null)
  const [toolbarPos, setToolbarPos] = useState(null)
  const [pbTooltipIdx, setPbTooltipIdx] = useState(null)

  useEffect(() => {
    const handleGlobalClick = (e) => {
      if (!e.target.closest('[data-para]')) {
        setActiveIdx(null)
        setToolbarPos(null)
      }
    }
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setActiveIdx(null)
        setToolbarPos(null)
      }
    }
    window.addEventListener('click', handleGlobalClick)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('click', handleGlobalClick)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const handleParaClick = (e, paraIdx) => {
    e.stopPropagation()
    if (activeIdx === paraIdx) {
      setActiveIdx(null)
      setToolbarPos(null)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const containerWidth = rect.width || 600

    // Align the center of [✏️ 编辑] button (first item in toolbar) directly with cursor X (x - 25)
    const clampedLeft = Math.max(8, Math.min(x - 25, containerWidth - 230))

    let clampedTop = y - 38
    if (clampedTop < -10 && paraIdx === 0) {
      clampedTop = y + 22
    }

    setToolbarPos({ x: clampedLeft, y: clampedTop })
    setActiveIdx(paraIdx)
  }

  const handleStartEdit = (para) => {
    setEditingIdx(para.idx)
    setEditingText(para.text || '')
  }

  const handleSaveEdit = async (paraIdx) => {
    if (!project?.id) return
    setSavingPara(true)
    try {
      await updateParagraph(project.id, paraIdx, editingText)
      message.success('段落已更新')
      setEditingIdx(null)
      onReloadProject?.()
    } catch (e) {
      message.error(e.message || '更新失败')
    } finally {
      setSavingPara(false)
    }
  }

  const handleDeletePara = (para) => {
    if (!project?.id) return
    if (project?.is_locked === 1) {
      message.warning('项目已锁定，无法删除段落')
      return
    }
    const isBlank = !para.text || para.text.trim() === ''
    if (isBlank) {
      deleteParagraph(project.id, para.idx).then(() => {
        message.success('已删除空段落')
        onReloadProject?.()
      }).catch(e => message.error(e.message || '删除失败'))
      return
    }

    Modal.confirm({
      title: '确认删除非空段落？',
      icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
      content: (
        <div>
          <p style={{ margin: '8px 0', color: '#666' }}>
            段落内容：“{para.text.length > 50 ? para.text.slice(0, 50) + '...' : para.text}”
          </p>
          <p style={{ color: '#ff4d4f', fontWeight: 600, margin: 0 }}>
            ⚠️ 此操作不可撤销，删除后该段落及关联校对标注将一并清除。
          </p>
        </div>
      ),
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteParagraph(project.id, para.idx)
          message.success('段落已删除')
          onReloadProject?.()
        } catch (e) {
          message.error(e.message || '删除失败')
        }
      },
    })
  }

  const handleTogglePageBreak = async (para) => {
    if (!project?.id) return
    const curType = para.page_break_type || (para.has_page_break_before === 1 ? 'original' : 'none')
    const hasHardBreak = curType === 'original' || curType === 'manual'
    const nextType = hasHardBreak ? 'none' : 'manual'

    // 0ms 极速本地乐观 UI 更新
    para.page_break_type = nextType
    para.has_page_break_before = nextType !== 'none' ? 1 : 0

    try {
      await togglePageBreak(project.id, para.idx, nextType)
      message.success(nextType !== 'none' ? '已插入新增硬分页' : '已移除硬分页', 2)
      onReloadProject?.()
    } catch (e) {
      message.error(e.message || '设置失败')
      onReloadProject?.()
    }
  }

  const handleToggleChapter = async (para) => {
    if (!project?.id) return
    const isCh = chapters.some(c => c.title_paragraph_idx === para.idx)
    try {
      await setChapter(project.id, para.idx, !isCh, 1, para.text.trim())
      message.success(!isCh ? '已将该段设为章节标题' : '已取消章节标题')
      onReloadProject?.()
    } catch (e) {
      message.error(e.message || '操作失败')
    }
  }

  const [showOptions, setShowOptions] = useState(false)
  const [fontSizeOffset, setFontSizeOffset] = useState(() => {
    try { return parseInt(localStorage.getItem('reader_font_offset') || '0', 10) } catch { return 0 }
  })
  const [flashSide, setFlashSide] = useState(null) // 'accept' | 'reject' | null
  const [showCheckboxes, setShowCheckboxes] = useState(false)
  const flowRef = useRef(null)
  const contentRef = useRef(null)
  const resultsRef = useRef(results)
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const floatCardElRef = useRef(null)
  const positionSavedRef = useRef(false)
  const autoSelectRef = useRef(false)
  const hasAutoSelectedRef = useRef(false)
  const isAutoScrollingRef = useRef(false)

  useEffect(() => {
    const el = flowRef.current
    if (!el || paras.length === 0) return
    const key = `reading_scrolltop_${project?.id}`
    let timer = null
    const save = () => localStorage.setItem(key, el.scrollTop)
    const handler = () => {
      clearTimeout(timer)
      timer = setTimeout(save, 300)
    }
    el.addEventListener('scroll', handler, { passive: true })
    return () => {
      el.removeEventListener('scroll', handler)
      clearTimeout(timer)
    }
  }, [paras.length, project?.id])

  useEffect(() => {
    if (autoSelectRef.current || positionSavedRef.current || paras.length === 0 || !flowRef.current) return
    const saved = localStorage.getItem(`reading_scrolltop_${project?.id}`)
    if (saved == null) return
    positionSavedRef.current = true
    const el = flowRef.current
    requestAnimationFrame(() => {
      if (positionSavedRef.current) {
        el.scrollTop = Number(saved)
      }
    })
  }, [paras.length, project?.id])

  // 页面关闭/隐藏时立即保存滚动位置，避免 debounce 滞后丢失最后位置
  useEffect(() => {
    const el = flowRef.current
    if (!el || paras.length === 0 || !project?.id) return
    const key = `reading_scrolltop_${project?.id}`
    const save = () => { if (el) localStorage.setItem(key, el.scrollTop) }
    window.addEventListener('beforeunload', save)
    document.addEventListener('visibilitychange', save)
    return () => {
      window.removeEventListener('beforeunload', save)
      document.removeEventListener('visibilitychange', save)
    }
  }, [paras.length, project?.id])

  useEffect(() => {
    localStorage.setItem('reader_font_offset', String(fontSizeOffset))
  }, [fontSizeOffset])

  const currentBodyFontSize = fontSize.body + fontSizeOffset

  // 自动选中第一条待处理错误（仅在尚未选中任何有效错误时触发，防止后台刷新结果导致卡片二次触发）
  useEffect(() => {
    if (results && results !== resultsRef.current) {
      resultsRef.current = results
      if (pending.length > 0) {
        const stillPending = pending.some(e => e.id === selectedIdRef.current)
        if (!stillPending) {
          hasAutoSelectedRef.current = true
          autoSelectRef.current = true
          positionSavedRef.current = false
          setSelectedId(pending[0].id)
        }
      }
    }
  }, [results, pending])

  const isScrollingRef = useRef(false)

  // 切换 selectedId 时，在 Paint 之前同步隐去卡片，防止旧坐标闪烁
  useLayoutEffect(() => {
    const el = floatCardElRef.current
    if (el) {
      el.style.opacity = '0'
      el.style.transform = 'translateY(3px)'
    }
  }, [selectedId])

  // 悬浮卡片控制与段落对齐：物理视口精准单向状态机
  useEffect(() => {
    const container = flowRef.current
    if (!container || !selectedId) return

    let rafId
    let scrollTimer = null

    const updatePos = () => {
      const el = floatCardElRef.current
      if (!el) return
      const id = selectedIdRef.current
      if (!id) return
      const strId = String(id)
      const span = Array.from(container.querySelectorAll('[data-error-id]'))
        .find(el => el.dataset.errorId.split(',').includes(strId))
      if (!span) return

      const rect = span.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      const cardW = 380
      const cardH = el.offsetHeight || 170

      const bottomBarHeight = 72 // 扣除 64px 底栏并留出 8px 绝对安全间隔
      const maxBottom = window.innerHeight - bottomBarHeight
      const minTop = Math.max(8, containerRect.top + 8)

      // 1. 默认置于高亮文本下方
      let top = rect.bottom + 6

      // 2. 若下方触及底栏安全线，优先翻转至文本上方
      if (top + cardH > maxBottom) {
        const topSpace = rect.top - minTop
        if (topSpace >= cardH + 6) {
          top = rect.top - cardH - 6
        } else {
          // 上下空间吃紧时，贴于底栏上方安全线，且绝不压盖当前高亮词
          top = Math.max(minTop, maxBottom - cardH)
        }
      }

      // 3. 水平方向防右侧屏幕溢出
      let left = rect.left
      if (left + cardW > window.innerWidth - 24) {
        left = Math.max(12, window.innerWidth - cardW - 24)
      }

      el.style.top = `${top}px`
      el.style.left = `${left}px`
      el.style.opacity = '1'
      el.style.transform = 'translateY(0)'
    }

    const hideCard = () => {
      const el = floatCardElRef.current
      if (el) {
        el.style.opacity = '0'
        el.style.transform = 'translateY(3px)'
      }
    }

    hideCard()

    // 滚动过程中绝对保持隐藏，停稳 80ms 后一次性淡入
    const onScroll = () => {
      hideCard()
      clearTimeout(scrollTimer)
      scrollTimer = setTimeout(() => {
        rafId = requestAnimationFrame(updatePos)
      }, 80)
    }

    // 智能判定目标段落是否已经在视口中央
    if (!positionSavedRef.current) {
      const err = flatErrors.find(e => e.id === selectedId)
      if (err) {
        const paraEl = container.querySelector(`[data-para="${err.paragraph_index}"]`)
        if (paraEl) {
          const cRect = container.getBoundingClientRect()
          const pRect = paraEl.getBoundingClientRect()
          // 目标段落已在可视区域（上下各留有 20px 余量）
          const isCentered = pRect.top >= cRect.top + 20 && pRect.bottom <= cRect.bottom - 20
          if (isCentered) {
            // 分支 A：原地 / 连着的问题，无需滚动，零延迟直接在下一帧精确定位显现
            rafId = requestAnimationFrame(updatePos)
          } else {
            // 分支 B：远端段落，触发平滑滚动，卡片保持隐藏直至 scroll 结束停稳
            paraEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        }
      }
    } else {
      positionSavedRef.current = false
      rafId = requestAnimationFrame(updatePos)
    }

    container.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      clearTimeout(scrollTimer)
      cancelAnimationFrame(rafId)
      container.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [selectedId, flatErrors])

  useEffect(() => {
    if (!selectedChapter || !flowRef.current) return
    const ch = chapters.find(c => c.id === selectedChapter)
    if (!ch) return
    const target = errorParaIdxs.find(idx => idx >= (ch.title_paragraph_idx ?? 0))
      ?? ch.start_idx ?? ch.title_paragraph_idx
    if (target == null) return
    const el = flowRef.current.querySelector(`[data-para="${target}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [selectedChapter, chapters, errorParaIdxs])

  const selectedError = useMemo(
    () => flatErrors.find(e => e.id === selectedId),
    [flatErrors, selectedId],
  )

  const allDone = pending.length === 0 && flatErrors.length > 0
  const selIsPending = selectedError?.user_status === 'pending'

  useEffect(() => {
    if (selectedError && selIsPending) {
      setCustomEdit(selectedError.suggested_text)
    }
  }, [selectedError?.id, selIsPending])

  const prevPendingCount = useRef(pending.length)
  useEffect(() => {
    if (pending.length === 0 && prevPendingCount.current > 0 && flowRef.current && flatErrors.length > 0) {
      const lastErr = flatErrors[flatErrors.length - 1]
      const el = flowRef.current.querySelector(`[data-para="${lastErr.paragraph_index}"]`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    prevPendingCount.current = pending.length
  }, [pending.length, flatErrors])

  const handleStatus = (status) => {
    if (!selectedId) return
    const curId = selectedId
    const custom = status === 'accepted' && customEdit !== selectedError?.suggested_text
      ? customEdit : undefined

    // 0ms 瞬间切换到下一个问题（乐观更新，完全消除 HTTP 延迟导致的切题卡顿）
    const idx = pending.findIndex(e => e.id === curId)
    if (idx >= 0 && idx + 1 < pending.length) {
      setSelectedId(pending[idx + 1].id)
    } else if (idx > 0) {
      setSelectedId(pending[idx - 1].id)
    } else {
      setSelectedId(null)
    }

    // 异步提交，不阻塞 UI 渲染
    onSetStatus(curId, status, custom).catch(() => {
      message.error('操作保存失败，请刷新重试')
    })
  }

  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable

      // Space → 开始/继续校对
      if (e.key === ' ') {
        if (inInput) return
        if (inProgress || proofreading) return
        if (flatErrors.length > 0 && pending.length > 0) return
        e.preventDefault()
        onStartProofread?.()
        return
      }

      // Escape → 关闭问题卡片
      if (e.key === 'Escape') {
        if (selectedIdRef.current) {
          e.preventDefault()
          setSelectedId(null)
        }
        return
      }

      // 上下箭头 → 上一个 / 下一个问题
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (inInput) return
        e.preventDefault()
        if (flatErrors.length === 0) return
        const curId = selectedIdRef.current
        const curIdx = curId ? flatErrors.findIndex(e => e.id === curId) : -1
        if (e.key === 'ArrowDown') {
          if (curIdx < flatErrors.length - 1) {
            setSelectedId(flatErrors[curIdx + 1].id)
          } else {
            message.info('已是最后一个问题')
          }
        } else {
          if (curIdx > 0) {
            setSelectedId(flatErrors[curIdx - 1].id)
          } else {
            message.info('已是第一个问题')
          }
        }
        return
      }

      // 左右箭头 → 采纳/拒绝
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (inInput) return
      const err = flatErrors.find(er => er.id === selectedIdRef.current)
      if (!err || err.user_status !== 'pending') return
      e.preventDefault()
      const side = e.key === 'ArrowLeft' ? 'accepted' : 'rejected'
      setFlashSide(side)
      setTimeout(() => setFlashSide(null), 200)
      handleStatus(side)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [flatErrors, handleStatus, inProgress, proofreading, pending, onStartProofread])

  const hasResults = results && paras.length > 0
  const showPanel = panelOpen && hasResults

  if (!hasResults) {
    return (
      <Card>
        <Empty description="暂无数据" />
      </Card>
    )
  }

  const barStyle = {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    background: color.bgPage,
    borderTop: `1px solid ${color.borderBar}`,
    boxShadow: '0 -2px 8px rgba(0,0,0,0.08)',
    padding: '14px 32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    flexWrap: 'wrap',
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {/* main area: left content + right panel */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* left: paragraph flow */}
          <div
            ref={contentRef}
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            <div
              ref={flowRef}
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                padding: '0 24px',
                background: color.bgReader,
                borderRadius: radius.md,
              }}
            >
              {[...paras].sort((a, b) => a.idx - b.idx).map(para => {
                const paraErrs = errors.filter(e => e.paragraph_index === para.idx)
                const isCh = chapters.some(c => c.title_paragraph_idx === para.idx)
                const chapterObj = chapters.find(c => c.title_paragraph_idx === para.idx)
                const isEditing = editingIdx === para.idx
                const isHover = hoverIdx === para.idx
                const isBlank = !para.text || para.text.trim() === ''

                const pbType = para.page_break_type || (para.has_page_break_before === 1 ? 'auto_chapter' : 'none')
                const pbInfo = {
                  original: { label: '📄 原文硬分页', border: '#e8e8e8', color: '#8c8c8c' },
                  auto_chapter: { label: '📖 章节开页', border: '#adc6ff', color: '#2f54eb' },
                  manual: { label: '✂️ 新增硬分页', border: '#ffd591', color: '#d46b08' },
                }[pbType]

                const isActive = activeIdx === para.idx
                const showToolbar = isActive && !isEditing && toolbarPos !== null

                return (
                  <React.Fragment key={para.idx}>
                    {pbInfo && (
                      <div style={{
                        margin: '12px 0 8px 0',
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        userSelect: 'none',
                      }}>
                        <div style={{
                          position: 'absolute',
                          left: 0,
                          right: 0,
                          top: '50%',
                          borderTop: `1px dashed ${pbInfo.border}`,
                          zIndex: 0,
                        }} />
                        {(pbType === 'original' || pbType === 'manual') ? (
                          <Popconfirm
                            title="确定移除该硬分页？"
                            description="移除后该段落导出时将不再另起新页。"
                            onConfirm={() => handleTogglePageBreak(para)}
                            okText="确定移除"
                            okButtonProps={{ danger: true }}
                            cancelText="取消"
                          >
                            <Tooltip open={pbTooltipIdx === para.idx} title="点击移除硬分页" mouseLeaveDelay={0.1}>
                              <span
                                onMouseEnter={() => setPbTooltipIdx(para.idx)}
                                onMouseLeave={() => setPbTooltipIdx(null)}
                                onClick={() => setPbTooltipIdx(null)}
                                style={{
                                position: 'relative',
                                zIndex: 1,
                                background: '#fff',
                                padding: '2px 12px',
                                borderRadius: 12,
                                border: `1px solid ${pbInfo.border}`,
                                color: pbInfo.color,
                                fontSize: 11,
                                fontWeight: 500,
                                cursor: 'pointer',
                                boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                                transition: 'all 0.15s ease',
                              }}>
                                {pbInfo.label}
                              </span>
                            </Tooltip>
                          </Popconfirm>
                        ) : (
                          <span style={{
                            position: 'relative',
                            zIndex: 1,
                            background: '#fff',
                            padding: '0 10px',
                            color: pbInfo.color,
                            fontSize: 11,
                            fontWeight: 400,
                          }}>
                            {pbInfo.label}
                          </span>
                        )}
                      </div>
                    )}
                    <div
                      data-para={para.idx}
                      onMouseEnter={() => setHoverIdx(para.idx)}
                      onMouseLeave={() => setHoverIdx(null)}
                      onClick={(e) => handleParaClick(e, para.idx)}
                      style={{
                        marginBottom: 16,
                        display: 'flex',
                        gap: 8,
                        position: 'relative',
                        padding: '6px 10px',
                        borderRadius: 6,
                        transition: 'all 0.15s ease',
                        background: isActive
                          ? 'rgba(24, 144, 255, 0.08)'
                          : isHover
                          ? 'rgba(0, 0, 0, 0.025)'
                          : isCh
                          ? 'rgba(24, 144, 255, 0.03)'
                          : 'transparent',
                        borderLeft: isActive
                          ? '4px solid #1890ff'
                          : isHover
                          ? '4px solid #69b1ff'
                          : isCh
                          ? '4px solid #adc6ff'
                          : '4px solid transparent',
                      }}
                    >
                      {showCheckboxes && (
                        <Checkbox
                          checked={selectedParas?.has(para.idx)}
                          onChange={() => {
                            const next = new Set(selectedParas || [])
                            if (next.has(para.idx)) next.delete(para.idx)
                            else next.add(para.idx)
                            onSelectionChange?.(next)
                          }}
                          style={{ lineHeight: '1.9', paddingTop: 2 }}
                        />
                      )}
                      <span style={{
                        color: para?.revised_text ? color.success : color.textTertiary,
                        fontWeight: para?.revised_text ? 600 : 400,
                        fontVariantNumeric: 'tabular-nums',
                        display: 'inline-block',
                        fontSize: fontSize.bodyXs, flexShrink: 0, lineHeight: 1.9, minWidth: 36, textAlign: 'right', userSelect: 'none',
                      }}>
                        {para.idx}
                      </span>

                      <div style={{ lineHeight: 1.9, fontSize: currentBodyFontSize, flex: 1 }}>
                        {isEditing ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <Input.TextArea
                              value={editingText}
                              onChange={e => setEditingText(e.target.value)}
                              autoSize={{ minRows: 1, maxRows: 8 }}
                              style={{ fontSize: currentBodyFontSize }}
                            />
                            <Space size="small">
                              <Button type="primary" size="small" loading={savingPara} onClick={() => handleSaveEdit(para.idx)}>
                                保存
                              </Button>
                              <Button size="small" onClick={() => setEditingIdx(null)}>
                                取消
                              </Button>
                            </Space>
                          </div>
                        ) : (
                          <div onDoubleClick={() => handleStartEdit(para)} style={{ cursor: 'pointer' }}>
                            {isCh && (
                              <Tag color="blue" style={{ marginBottom: 4, marginRight: 6 }}>
                                📖 章节 ({chapterObj?.level === 2 ? '节' : '章'})
                              </Tag>
                            )}
                            {isBlank ? (
                              <span style={{ color: '#bfbfbf', fontStyle: 'italic', fontSize: 13, userSelect: 'none' }}>
                                [ 空段落 ]
                              </span>
                            ) : (
                              <ParagraphView
                                text={para.text}
                                paraErrors={paraErrs}
                                selectedId={selectedId}
                                onSelect={setSelectedId}
                              />
                            )}
                          </div>
                        )}
                      </div>

                      {/* Follow-Cursor / Click-Location Dynamic Floating Bubble Bar with Boundary Guard */}
                      {showToolbar && (
                        <div style={{
                          position: 'absolute',
                          top: (isActive && toolbarPos) ? toolbarPos.y : -30,
                          left: (isActive && toolbarPos) ? toolbarPos.x : 'auto',
                          right: (isActive && toolbarPos) ? 'auto' : 12,
                          zIndex: 10,
                          background: 'rgba(255, 255, 255, 0.60)',
                          backdropFilter: 'blur(2px)',
                          WebkitBackdropFilter: 'blur(2px)',
                          padding: '3px 8px',
                          borderRadius: 20,
                          boxShadow: '0 4px 16px rgba(0,0,0,0.14), 0 1px 4px rgba(0,0,0,0.06)',
                          border: '1px solid #e8e8e8',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}>
                          <Tooltip title="编辑段落文本">
                            <Button
                              type="text"
                              size="small"
                              icon={<EditOutlined />}
                              onClick={(e) => { e.stopPropagation(); handleStartEdit(para); }}
                              style={{ fontSize: 12 }}
                            >
                              编辑
                            </Button>
                          </Tooltip>
                          {(() => {
                            const hasHardBreak = pbType === 'original' || pbType === 'manual'
                            if (hasHardBreak) {
                              return (
                                <Popconfirm
                                  title="确定移除该硬分页？"
                                  description="移除后该段落导出时将不再另起新页。"
                                  onConfirm={() => handleTogglePageBreak(para)}
                                  okText="确定移除"
                                  okButtonProps={{ danger: true }}
                                  cancelText="取消"
                                >
                                  <Tooltip title="移除该硬分页">
                                    <Button
                                      type="text"
                                      size="small"
                                      icon={<ScissorOutlined />}
                                      danger
                                      onClick={(e) => e.stopPropagation()}
                                      style={{ fontSize: 12 }}
                                    >
                                      移除硬分页
                                    </Button>
                                  </Tooltip>
                                </Popconfirm>
                              )
                            }
                            return (
                              <Tooltip title="在段前插入硬分页">
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<ScissorOutlined />}
                                  onClick={(e) => { e.stopPropagation(); handleTogglePageBreak(para); }}
                                  style={{ fontSize: 12 }}
                                >
                                  硬分页
                                </Button>
                              </Tooltip>
                            )
                          })()}
                          <Tooltip title={isCh ? '取消章节标题' : '设为章节标题'}>
                            <Button
                              type={isCh ? 'primary' : 'text'}
                              size="small"
                              icon={<BookOutlined />}
                              onClick={(e) => { e.stopPropagation(); handleToggleChapter(para); }}
                              style={{ fontSize: 12 }}
                            >
                              {isCh ? '已设章节' : '设章节'}
                            </Button>
                          </Tooltip>
                          <Tooltip title={project?.is_locked === 1 ? '项目已锁定，禁止删除段落' : '删除该段落'}>
                            <Button
                              type="text"
                              size="small"
                              danger
                              disabled={project?.is_locked === 1}
                              icon={<DeleteOutlined />}
                              onClick={(e) => { e.stopPropagation(); handleDeletePara(para); }}
                              style={{ fontSize: 12 }}
                            />
                          </Tooltip>
                        </div>
                      )}
                    </div>
                  </React.Fragment>
                )
              })}
            </div>
          </div>

          {/* right panel */}
          <div
            style={{
              width: showPanel ? 420 : 0,
              overflow: 'hidden',
              flexShrink: 0,
              transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              opacity: showPanel ? 1 : 0,
              borderLeft: showPanel ? `1px solid ${color.border}` : 'none',
              background: color.bgPage,
              borderRadius: 8,
            }}
          >
            <div style={{ width: 420, height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              {/* 面板标题 */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '14px 16px 0',
              }}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>问题列表</span>
                <Button type="text" size="small" icon={<CloseOutlined />} onClick={onTogglePanel} />
              </div>

              <style>{`
                .right-panel-tabs .ant-tabs-content-holder { overflow: hidden; }
                .right-panel-tabs .ant-tabs-content { height: 100%; }
                .right-panel-tabs .ant-tabs-tabpane-active { height: 100%; overflow-y: auto; }
              `}</style>
              <Tabs
                activeKey={panelTab}
                onChange={setPanelTab}
                className="right-panel-tabs"
                style={{ padding: '0 16px', flex: 1, minHeight: 0 }}
                items={[
                  {
                    key: 'pending',
                    label: <span>待处理 ({pending.length})</span>,
                    children: pending.length === 0
                      ? <Empty description="暂无待处理问题" />
                      : (
                        <ErrorList
                          errors={pending}
                          selectedId={selectedId}
                          onSelect={(id) => { setSelectedId(id) }}
                          unmatchedIds={unmatchedIds}
                          onSetStatus={onSetStatus}
                        />
                      ),
                  },
                  {
                    key: 'accepted',
                    label: <span>已采纳 ({accepted.length})</span>,
                    children: accepted.length === 0
                      ? <Empty description="暂无已采纳问题" />
                      : (
                        <ErrorList
                          errors={accepted}
                          selectedId={selectedId}
                          onSelect={(id) => { setSelectedId(id) }}
                          unmatchedIds={unmatchedIds}
                          onSetStatus={onSetStatus}
                        />
                      ),
                  },
                  {
                    key: 'rejected',
                    label: <span>已拒绝 ({rejected.length})</span>,
                    children: rejected.length === 0
                      ? <Empty description="暂无已拒绝问题" />
                      : (
                        <ErrorList
                          errors={rejected}
                          selectedId={selectedId}
                          onSelect={(id) => { setSelectedId(id) }}
                          unmatchedIds={unmatchedIds}
                          onSetStatus={onSetStatus}
                        />
                      ),
                  },
                ]}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ======== fixed bottom bar ======== */}
      <div style={barStyle}>
        <div style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '0 16px', gap: 12 }}>
        {/* left: 选段模式切换 | 选段操作 | 校对配置 */}
        {!(inProgress || proofreading) && <>
          <Button
            type="text"
            size="small"
            onClick={() => setShowCheckboxes(v => !v)}
            style={{
              fontSize: 13, color: showCheckboxes ? color.warning : color.textTertiary,
              whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            {showCheckboxes ? '☑' : '☐'} 选段
          </Button>
          {showCheckboxes && selectedParas?.size > 0 && (
            <Space size={4} style={{ flexShrink: 0 }}>
              <Tag style={{ fontSize: 12, margin: 0 }}>已选 {selectedParas.size} 段</Tag>
              <Button
                type="text"
                size="small"
                onClick={() => {
                  const errIdxs = new Set(errors.map(e => e.paragraph_index))
                  onSelectionChange?.(errIdxs)
                }}
                style={{ fontSize: 12, color: color.textSecondary }}
              >
                选取错误段落
              </Button>
              <Button
                type="text"
                size="small"
                onClick={() => onSelectionChange?.(new Set())}
                style={{ fontSize: 12, color: color.textSecondary }}
              >
                清除
              </Button>
            </Space>
          )}
          {!showCheckboxes && (
            <Popover
              trigger="click"
              open={showOptions}
              onOpenChange={setShowOptions}
              placement="topLeft"
              styles={{ body: { padding: '12px 16px', width: 440 } }}
              content={
                <ControlsRow
                  showOptions={true}
                  selectedModel={selectedModel} onModelChange={onModelChange}
                  models={models}
                  selectedTypes={selectedTypes} onTypesChange={onTypesChange}
                  batchMaxConcurrent={batchMaxConcurrent} onBatchMaxConcurrentChange={onBatchMaxConcurrentChange}
                  proofreadWindowSize={proofreadWindowSize} onWindowSizeChange={onWindowSizeChange}
                  inProgress={inProgress}
                />
              }
            >
              <Button
                type="text"
                size="middle"
                style={{
                  color: color.textTertiary, fontSize: 13, whiteSpace: 'nowrap',
                  maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block', flexShrink: 0,
                }}
              >
                {showOptions ? '◀' : '▶'} 校对配置 ({
                  (() => {
                    const m = models.find(x => x.model_id === selectedModel)
                    return m ? `${m.provider_name || m.provider} · ${m.name}` : selectedModel
                  })()
                })
              </Button>
            </Popover>
          )}
        </>}

        {/* 批量校对状态胶囊 Tag（弹出 Popover 详情） */}
        {batchInfo && (
          <Popover
            trigger="click"
            placement="top"
            styles={{ body: { padding: '12px 16px', maxWidth: 380 } }}
            content={
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    {batchInfo.status === 'running' ? '🔄 批量校对中'
                    : batchInfo.status === 'ok' ? '✓ 批量完成'
                    : batchInfo.failed_windows > 0 ? '⚠ 批量完成（部分失败）'
                    : '✖ 全部失败'}
                  </span>
                  <span style={{ fontSize: 12, opacity: 0.6 }}>
                    第 {batchInfo.range_start + 1}–{batchInfo.range_end} 段 &nbsp;·&nbsp;
                    {batchInfo.done_windows}/{batchInfo.total_windows} 窗口完成
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {(batchInfo.windows || []).map(w => {
                    const isRetrying = retryingWindow === w.window_index
                    return (
                      <div key={w.window_index} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <span style={{ fontSize: 16,
                          color: isRetrying ? '#1677ff'
                            : w.status === 'ok' ? '#52c41a'
                            : w.status === 'failed' ? '#ff4d4f'
                            : '#1677ff' }}>
                          {isRetrying ? '⏳' : w.status === 'ok' ? '●' : w.status === 'failed' ? '✗' : '○'}
                        </span>
                        <span style={{ fontSize: 10, opacity: 0.55 }}>{w.range_start + 1}–{w.range_end}</span>
                        {w.status === 'failed' && (
                          <Button
                            size="small"
                            type="link"
                            danger
                            loading={isRetrying}
                            style={{ padding: 0, height: 'auto', fontSize: 11 }}
                            disabled={inProgress || retryingWindow !== null}
                            onClick={() => onRetryWindow?.(batchInfo.batch_id, w.window_index)}
                          >
                            {isRetrying ? '重试中' : '重试'}
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            }
          >
            <Tag
              color={batchInfo.failed_windows > 0 ? 'error' : batchInfo.status === 'ok' ? 'success' : 'processing'}
              style={{ cursor: 'pointer', padding: '4px 8px', fontSize: 12, borderRadius: 6, margin: 0, flexShrink: 0 }}
            >
              {batchInfo.status === 'running' ? '🔄 批量中' : batchInfo.status === 'ok' ? '✓ 批量完成' : '⚠ 部分失败'} ({batchInfo.done_windows}/{batchInfo.total_windows}) ▾
            </Tag>
          </Popover>
        )}

        {/* center: main content */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, minWidth: 0 }}>
        {inProgress || proofreading ? (
          <>
            <Progress
              percent={percent}
              status="active"
              style={{ width: 200, margin: 0 }}
              size="small"
            />
            <span style={{ color: color.textTertiary, fontSize: fontSize.bodyXs, whiteSpace: 'nowrap' }}>
              <LoadingOutlined spin style={{ marginRight: 6 }} />
              {bannerText || '正在校对，请稍候…'}
            </span>
          </>
        ) : flatErrors.length > 0 && pending.length > 0 ? (
          <>
            {selectedError && selIsPending ? (
              <>
                <Input
                  value={customEdit}
                  onChange={(e) => setCustomEdit(e.target.value)}
                  style={{ maxWidth: 360, minWidth: 160, flex: '1 1 240px', fontSize: 15 }}
                  size="large"
                  placeholder="修改结果…"
                />
                <style>{`
                  .bar-action-btn {
                    transition: transform 0.08s cubic-bezier(0, 0, 0.2, 1), background 0.15s, box-shadow 0.15s !important;
                  }
                  .bar-action-btn:active:not(:disabled) {
                    transform: scale(0.95) !important;
                  }
                `}</style>
                <Button
                  type="primary"
                  shape="round"
                  size="large"
                  className="bar-action-btn"
                  icon={<CheckCircleOutlined />}
                  onClick={() => { setFlashSide('accepted'); setTimeout(() => setFlashSide(null), 200); handleStatus('accepted') }}
                  disabled={inProgress}
                  style={{
                    height: 48, paddingInline: 24, fontSize: 15, flexShrink: 0,
                    background: flashSide === 'accepted' ? '#52c41a' : undefined,
                    boxShadow: flashSide === 'accepted' ? '0 0 0 3px rgba(82,196,26,0.3)' : undefined,
                  }}
                >
                  ← 采纳
                </Button>
                <Button
                  size="large"
                  className="bar-action-btn"
                  icon={<CloseCircleOutlined />}
                  onClick={() => { setFlashSide('rejected'); setTimeout(() => setFlashSide(null), 200); handleStatus('rejected') }}
                  disabled={inProgress}
                  style={{
                    height: 48, paddingInline: 24, fontSize: 15, flexShrink: 0,
                    background: flashSide === 'rejected' ? '#ff4d4f' : undefined,
                    color: flashSide === 'rejected' ? '#fff' : undefined,
                    borderColor: flashSide === 'rejected' ? '#ff4d4f' : undefined,
                    boxShadow: flashSide === 'rejected' ? '0 0 0 3px rgba(255,77,79,0.3)' : undefined,
                  }}
                >
                  拒绝 →
                </Button>
                <Tag style={{ marginLeft: 4, fontSize: 15, padding: '4px 10px', borderRadius: 999, flexShrink: 0 }}>
                  {pending.findIndex(e => e.id === selectedId) + 1}/{pending.length}
                </Tag>
                <ShortcutHint />
              </>
            ) : (
              <span style={{ color: color.textTertiary }}>
                点击文中有标记的文本查看错误详情
              </span>
            )}
          </>
        ) : selectedParas?.size > 0 ? (
          <>
            <Button
              type="primary"
              shape="round"
              size="large"
              className="bar-action-btn"
              icon={<ThunderboltOutlined />}
              loading={proofreading}
              onClick={() => onStartSelectionProofread?.([...selectedParas])}
              disabled={inProgress}
              style={{ height: 52, paddingInline: 36, fontSize: 17 }}
            >
              校对选中（{selectedParas.size} 段）
            </Button>
            <ShortcutHint />
          </>
        ) : (
          <>
            <Button
              type="primary"
              shape="round"
              size="large"
              className="bar-action-btn"
              icon={<ThunderboltOutlined />}
              loading={proofreading}
              onClick={onStartProofread}
              disabled={inProgress}
              style={{ height: 52, paddingInline: 36, fontSize: 17 }}
            >
              {allDone ? '继续校对' : projectError ? '重试' : '开始校对'}
            </Button>
            <Button
              shape="round"
              size="large"
              className="bar-action-btn"
              icon={<ThunderboltOutlined />}
              loading={proofreading}
              onClick={onStartBatchProofread}
              disabled={inProgress}
              style={{ height: 52, paddingInline: 24, fontSize: 16, marginLeft: 8 }}
              title={`批量并行校对多窗口（每个窗口 ${proofreadWindowSize} 段，可以在校对配置中调整）`}
            >
              批量校对
            </Button>
            <ShortcutHint />
          </>
        )}
        </div>

        {/* right: 字号调节 */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: color.bgCard,
          borderRadius: radius.md,
          border: `1px solid ${color.border}`,
          padding: '4px 10px',
        }}>
          <Button
            type="text"
            size="small"
            icon={<MinusOutlined />}
            disabled={currentBodyFontSize <= 14}
            onClick={() => setFontSizeOffset(v => Math.max(v - 1, -6))}
            style={{ width: 28, height: 28, fontSize: 14 }}
          />
          <span style={{ fontSize: 13, minWidth: 24, textAlign: 'center', color: color.textSecondary }}>
            {currentBodyFontSize}
          </span>
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined />}
            disabled={currentBodyFontSize >= 24}
            onClick={() => setFontSizeOffset(v => Math.min(v + 1, 8))}
            style={{ width: 28, height: 28, fontSize: 14 }}
          />
        </div>
        </div>
        </div>
      </div>
      {selectedError && (
        <ErrorDetailCard
          ref={floatCardElRef}
          error={selectedError}
          onAccept={() => { setFlashSide('accepted'); setTimeout(() => setFlashSide(null), 200); handleStatus('accepted') }}
          onReject={() => { setFlashSide('rejected'); setTimeout(() => setFlashSide(null), 200); handleStatus('rejected') }}
          onClose={() => setSelectedId(null)}
        />
      )}

    </>
  )
}

function ShortcutHint() {
  return (
    <Tooltip
      placement="top"
      title={
        <div style={{ lineHeight: 2 }}>
          <div><kbd style={kbdStyle}>空格</kbd> 开始 / 继续校对</div>
          <div><kbd style={kbdStyle}>↑</kbd> <kbd style={kbdStyle}>↓</kbd> 上一个 / 下一个问题</div>
          <div><kbd style={kbdStyle}>←</kbd> 采纳</div>
          <div><kbd style={kbdStyle}>→</kbd> 拒绝</div>
        </div>
      }
    >
      <span style={{
        fontSize: 12, color: color.textTertiary, cursor: 'pointer',
        whiteSpace: 'nowrap', userSelect: 'none', marginLeft: 12,
        alignSelf: 'flex-end', paddingBottom: 10,
      }}>
        快捷键
      </span>
    </Tooltip>
  )
}

function ControlsRow({
  showOptions,
  selectedModel, onModelChange, models,
  selectedTypes, onTypesChange,
  batchMaxConcurrent, onBatchMaxConcurrentChange,
  proofreadWindowSize, onWindowSizeChange,
  inProgress,
}) {
  if (!showOptions) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: color.textSecondary, whiteSpace: 'nowrap' }}>模型</span>
        <Select
          style={{ flex: 1 }}
          popupMatchSelectWidth={false}
          value={selectedModel}
          disabled={inProgress}
          onChange={onModelChange}
          options={models.map(m => ({ value: m.model_id, label: `${m.provider_name || m.provider} · ${m.name}` }))}
          size="small"
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: color.textSecondary, whiteSpace: 'nowrap' }}>分类</span>
        <Select
          mode="multiple"
          style={{ flex: 1 }}
          value={selectedTypes}
          disabled={inProgress}
          onChange={onTypesChange}
          options={TYPE_OPTIONS}
          size="small"
          tagRender={(props) => {
            const { label, closable, onClose } = props
            return (
              <Tag closable={closable} onClose={onClose} style={{ margin: 0, fontSize: 11 }}>
                {label}
              </Tag>
            )
          }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: color.textSecondary, whiteSpace: 'nowrap' }}>窗口</span>
        <InputNumber
          min={5}
          max={100}
          size="small"
          style={{ width: 80 }}
          value={proofreadWindowSize}
          disabled={inProgress}
          onChange={(val) => onWindowSizeChange?.(val || 5)}
        />
        <span style={{ fontSize: 11, color: color.textSecondary }}>
          段/窗口
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: color.textSecondary, whiteSpace: 'nowrap' }}>并发</span>
        <InputNumber
          min={1}
          max={20}
          size="small"
          style={{ width: 80 }}
          value={batchMaxConcurrent}
          disabled={inProgress}
          onChange={(val) => onBatchMaxConcurrentChange?.(val || 1)}
        />
        <span style={{ fontSize: 11, color: color.textSecondary }}>
          窗口（单次批量并发处理 {(batchMaxConcurrent || 1) * (proofreadWindowSize || 30)} 段）
        </span>
      </div>
    </div>
  )
}
