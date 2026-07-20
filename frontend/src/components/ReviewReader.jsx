import React, { useState, useEffect, useMemo, useRef } from 'react'
import {
  Card, Button, Tag, Space, Typography, Empty, Tabs,
  Select, Radio, Progress, Input, Badge, Popover, Tooltip, message,
} from 'antd'
import {
  CheckCircleOutlined, CloseCircleOutlined,
  ThunderboltOutlined, LoadingOutlined, CloseOutlined,
  MinusOutlined, PlusOutlined,
} from '@ant-design/icons'
import { color, radius, spacing, fontSize } from '../design-tokens'

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

function ErrorDetailCard({ error, style: extStyle, onAccept, onReject, onClose }) {
  const pending = error.user_status === 'pending'
  return (
    <div
      style={{
        position: 'fixed',
        zIndex: 1100,
        width: 380,
        padding: '14px 16px 12px',
        background: color.bgCard,
        borderRadius: radius.md,
        borderLeft: `3px solid ${color.warning}`,
        boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        ...extStyle,
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

function ParagraphView({ text, paraErrors, selectedId, onSelect }) {
  if (!text) return null
  const found = []
  paraErrors.forEach(e => {
    const idx = text.indexOf(e.original_text)
    if (idx >= 0) found.push({ error: e, idx, end: idx + e.original_text.length })
  })
  found.sort((a, b) => a.idx - b.idx)
  const segs = []
  const chips = []
  let cursor = 0
  found.forEach(f => {
    if (f.idx < cursor) { chips.push(f.error); return }
    if (f.idx > cursor) segs.push(<span key={`t${cursor}`}>{text.slice(cursor, f.idx)}</span>)
    const e = f.error
    const accepted = e.user_status === 'accepted'
    const pending = e.user_status === 'pending'
    const displayText = accepted ? e.suggested_text : e.original_text
    segs.push(
      <span
        key={e.id}
        data-error-id={e.id}
        onClick={() => onSelect(e.id)}
        title={accepted ? `原: ${e.original_text}` : undefined}
        style={{
          cursor: 'pointer',
          padding: '0 2px',
          borderRadius: 2,
          backgroundColor: e.id === selectedId ? color.bgHighlight : 'transparent',
          borderBottom: accepted
            ? `1px dashed ${color.textTertiary}`
            : pending
              ? (e.id === selectedId ? `2px solid ${color.warning}` : `1px dotted ${color.warning}`)
              : 'none',
        }}
      >{displayText}</span>,
    )
    cursor = f.end
  })
  if (cursor < text.length) segs.push(<span key="t-end">{text.slice(cursor)}</span>)
  chips.forEach(e => {
    const accepted = e.user_status === 'accepted'
    segs.push(
      <Tag
        key={`chip-${e.id}`}
        data-error-id={e.id}
        color={accepted ? 'green' : (SEVERITY_COLOR[e.severity] || 'default')}
        style={{ cursor: 'pointer', margin: '0 4px' }}
        onClick={() => onSelect(e.id)}
      >{accepted ? e.suggested_text : e.original_text}</Tag>,
    )
  })
  return <>{segs}</>
}

function ErrorList({ errors, selectedId, onSelect, unmatchedIds }) {
  return errors.map(e => {
    const statusColor = e.user_status === 'pending' ? color.warning
      : e.user_status === 'accepted' ? color.success : color.borderRejected
    const noLoc = unmatchedIds?.has(e.id)
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
  const accepted = useMemo(() => flatErrors.filter(e => e.user_status === 'accepted'), [flatErrors])
  const rejected = useMemo(() => flatErrors.filter(e => e.user_status === 'rejected'), [flatErrors])
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
  const [showOptions, setShowOptions] = useState(false)
  const [fontSizeOffset, setFontSizeOffset] = useState(() => {
    try { return parseInt(localStorage.getItem('reader_font_offset') || '0', 10) } catch { return 0 }
  })
  const [flashSide, setFlashSide] = useState(null) // 'accept' | 'reject' | null
  const flowRef = useRef(null)
  const contentRef = useRef(null)
  const resultsRef = useRef(results)
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const [floatCardStyle, setFloatCardStyle] = useState(null)
  const positionSavedRef = useRef(false)
  const hasAutoSelectedRef = useRef(false)

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
    if (positionSavedRef.current || paras.length === 0 || !flowRef.current) return
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

  // 自动选中第一条待处理错误
  useEffect(() => {
    if (results && results !== resultsRef.current) {
      resultsRef.current = results
      // 新结果到来时直接选中第一条 pending，不经过 null 中间态（避免浮层闪烁）
      if (pending.length > 0) {
        hasAutoSelectedRef.current = true
        positionSavedRef.current = false
        setSelectedId(pending[0].id)
      }
    }
  }, [results, pending])

  // 悬浮卡片：跟随选中错误的位置
  useEffect(() => {
    const container = flowRef.current
    if (!container || !selectedId) { setFloatCardStyle(null); return }
    const calc = () => {
      const id = selectedIdRef.current
      if (!id) { setFloatCardStyle(null); return }
      const span = container.querySelector(`[data-error-id="${id}"]`)
      if (!span) { setFloatCardStyle(null); return }
      const rect = span.getBoundingClientRect()
      const cardW = 380
      const cardH = 170
      let top = rect.bottom + 6
      if (top + cardH > window.innerHeight - 16) {
        top = Math.max(8, rect.top - cardH - 6)
      }
      let left = rect.left
      if (left + cardW > window.innerWidth - 16) {
        left = Math.max(8, window.innerWidth - cardW - 16)
      }
      setFloatCardStyle({ top, left })
    }
    calc()
    container.addEventListener('scroll', calc, { passive: true })
    window.addEventListener('resize', calc, { passive: true })
    return () => {
      container.removeEventListener('scroll', calc)
      window.removeEventListener('resize', calc)
    }
  }, [selectedId])
  useEffect(() => {
    if (!selectedId || !flowRef.current) return
    // 如果是刚恢复了阅读位置，跳过自动滚动到选中错误，避免覆盖 scrollTop
    if (positionSavedRef.current) { positionSavedRef.current = false; return }
    const err = flatErrors.find(e => e.id === selectedId)
    if (!err) return
    const el = flowRef.current.querySelector(`[data-para="${err.paragraph_index}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
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

  const handleStatus = async (status) => {
    if (!selectedId) return
    const custom = status === 'accepted' && customEdit !== selectedError?.suggested_text
      ? customEdit : undefined
    await onSetStatus(selectedId, status, custom)
    const idx = pending.findIndex(e => e.id === selectedId)
    if (idx >= 0 && idx + 1 < pending.length) {
      setSelectedId(pending[idx + 1].id)
    } else if (idx > 0) {
      setSelectedId(pending[idx - 1].id)
    } else {
      setSelectedId(null)
    }
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
                return (
                    <div key={para.idx} data-para={para.idx} style={{ marginBottom: 24 }}>
                    <div style={{ lineHeight: 1.9, fontSize: currentBodyFontSize }}>
                      <ParagraphView
                        text={para.text}
                        paraErrors={paraErrs}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                      />
                      {para?.revised_text && (
                        <span style={{ color: color.success, fontSize: fontSize.bodyXs, marginLeft: spacing.sm }}>
                          （已修订）
                        </span>
                      )}
                    </div>
                  </div>
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
              transition: 'width 0.2s ease',
              opacity: showPanel ? 1 : 0,
              borderLeft: `1px solid ${color.border}`,
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
                    label: <span>待处理 <Badge count={pending.length} size="small" style={{ backgroundColor: color.warning }} /></span>,
                    children: pending.length === 0
                      ? <Empty description="暂无待处理问题" />
                      : (
                        <ErrorList
                          errors={pending}
                          selectedId={selectedId}
                          onSelect={(id) => { setSelectedId(id) }}
                          unmatchedIds={unmatchedIds}
                        />
                      ),
                  },
                  {
                    key: 'accepted',
                    label: <span>已采纳 <Badge count={accepted.length} size="small" style={{ backgroundColor: color.success }} /></span>,
                    children: accepted.length === 0
                      ? <Empty description="暂无已采纳问题" />
                      : (
                        <ErrorList
                          errors={accepted}
                          selectedId={selectedId}
                          onSelect={(id) => { setSelectedId(id) }}
                          unmatchedIds={unmatchedIds}
                        />
                      ),
                  },
                  {
                    key: 'rejected',
                    label: <span>已拒绝 <Badge count={rejected.length} size="small" /></span>,
                    children: rejected.length === 0
                      ? <Empty description="暂无已拒绝问题" />
                      : (
                        <ErrorList
                          errors={rejected}
                          selectedId={selectedId}
                          onSelect={(id) => { setSelectedId(id) }}
                          unmatchedIds={unmatchedIds}
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
        <div style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '0 24px', gap: 16 }}>
        {/* left: 校对配置（Popover 弹出，不占位） */}
        {!(inProgress || proofreading) && !(flatErrors.length > 0 && pending.length > 0) && (
          <Popover
            trigger="click"
            open={showOptions}
            onOpenChange={setShowOptions}
            placement="topLeft"
            styles={{ body: { padding: '12px 16px', width: 400 } }}
            content={
              <ControlsRow
                showOptions={true}
                selectedModel={selectedModel} onModelChange={onModelChange}
                models={models}
                selectedTypes={selectedTypes} onTypesChange={onTypesChange}
                inProgress={inProgress}
              />
            }
          >
            <Button
              type="text"
              size="middle"
              style={{ color: color.textTertiary, fontSize: 14, whiteSpace: 'nowrap' }}
            >
              {showOptions ? '◀' : '▶'} 校对配置
            </Button>
          </Popover>
        )}

        {/* center: main content */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, position: 'relative' }}>
        {inProgress || proofreading ? (
          <>
            <Progress
              percent={percent}
              status="active"
              style={{ width: 200, margin: 0 }}
              size="small"
            />
            <span style={{ color: color.textTertiary, fontSize: fontSize.bodyXs }}>
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
                  style={{ width: 420, fontSize: 16 }}
                  size="large"
                  placeholder="修改结果…"
                />
                <Button
                  type="primary"
                  shape="round"
                  size="large"
                  icon={<CheckCircleOutlined />}
                  onClick={() => { setFlashSide('accepted'); setTimeout(() => setFlashSide(null), 200); handleStatus('accepted') }}
                  disabled={inProgress}
                  style={{
                    height: 48, paddingInline: 32, fontSize: 16,
                    transition: 'background 0.15s, box-shadow 0.15s',
                    background: flashSide === 'accepted' ? '#52c41a' : undefined,
                    boxShadow: flashSide === 'accepted' ? '0 0 0 3px rgba(82,196,26,0.3)' : undefined,
                  }}
                >
                  ← 采纳
                </Button>
                <Button
                  size="large"
                  icon={<CloseCircleOutlined />}
                  onClick={() => { setFlashSide('rejected'); setTimeout(() => setFlashSide(null), 200); handleStatus('rejected') }}
                  disabled={inProgress}
                  style={{
                    height: 48, paddingInline: 32, fontSize: 16,
                    transition: 'background 0.15s, box-shadow 0.15s',
                    background: flashSide === 'rejected' ? '#ff4d4f' : undefined,
                    color: flashSide === 'rejected' ? '#fff' : undefined,
                    borderColor: flashSide === 'rejected' ? '#ff4d4f' : undefined,
                    boxShadow: flashSide === 'rejected' ? '0 0 0 3px rgba(255,77,79,0.3)' : undefined,
                  }}
                >
                  拒绝 →
                </Button>
                <Tag style={{ marginLeft: 4, fontSize: 16, padding: '4px 12px', borderRadius: 999 }}>
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
        ) : (
          <>
            <Button
              type="primary"
              shape="round"
              size="large"
              icon={<ThunderboltOutlined />}
              loading={proofreading}
              onClick={onStartProofread}
              disabled={inProgress}
              style={{ height: 52, paddingInline: 40, fontSize: 18 }}
            >
              {allDone ? '继续校对' : projectError ? '重试' : '开始校对'}
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
      {selectedError && floatCardStyle && (
        <ErrorDetailCard
          error={selectedError}
          style={floatCardStyle}
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
  inProgress,
}) {
  if (!showOptions) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: color.textSecondary, whiteSpace: 'nowrap' }}>模型</span>
        <Select
          style={{ width: 300 }}
          value={selectedModel}
          disabled={inProgress}
          onChange={onModelChange}
          options={models.map(m => ({ value: m.model_id, label: `${m.provider_name || m.provider} · ${m.name}` }))}
          size="small"
        />
      </div>
      <Select
        mode="multiple"
        style={{ width: '100%' }}
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
  )
}
