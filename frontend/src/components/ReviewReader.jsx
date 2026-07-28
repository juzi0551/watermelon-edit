import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, forwardRef, useImperativeHandle } from 'react'
import {
  Card, Button, Tag, Space, Typography, Empty, Tabs,
  Select, Radio, Progress, Input, InputNumber, Badge, Popover, Tooltip, message,
  Checkbox, Modal, Popconfirm, Dropdown,
} from 'antd'
import {
  CheckCircleOutlined, CloseCircleOutlined,
  ThunderboltOutlined, LoadingOutlined, CloseOutlined,
  MinusOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
  ScissorOutlined, BookOutlined, ExclamationCircleOutlined,
  MenuFoldOutlined,
} from '@ant-design/icons'
import { color, radius, spacing, fontSize } from '../design-tokens'
import {
  updateParagraph, deleteParagraph, togglePageBreak, setChapter,
} from '../services/api'

const EMPTY_ARRAY = Object.freeze([])
const PB_INFO_MAP = Object.freeze({
  original: Object.freeze({ label: '📄 原文硬分页', border: '#e8e8e8', color: '#8c8c8c' }),
  auto_chapter: Object.freeze({ label: '📖 章节开页', border: '#ffe58f', color: '#d48806' }),
  manual: Object.freeze({ label: '✂️ 新增硬分页', border: '#ffd591', color: '#d46b08' }),
})

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
  const [btnState, setBtnState] = useState(null)
  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        zIndex: 500,
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
          icon={<CloseOutlined style={{ fontSize: 12 }} />}
          onClick={onClose}
          style={{
            position: 'absolute',
            top: -2,
            right: -4,
            color: color.textMuted,
            width: 24,
            height: 24,
          }}
        />
        <div style={{ marginBottom: 6, paddingRight: 20 }}>
          <div style={{ fontSize: fontSize.meta, color: color.textSecondary, marginBottom: 2 }}>
            第 {error.paragraph_index} 段
          </div>
          <div style={{ marginBottom: 6 }}>
            <DiffView original={error.original_text} suggested={error.suggested_text} />
          </div>
        </div>
      </div>
      <div style={{
        fontSize: fontSize.bodyXs,
        color: color.textDescription,
        marginBottom: 10,
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
              size="small"
              shape="round"
              onClick={(e) => {
                e.stopPropagation()
                setBtnState('accepted')
                setTimeout(() => {
                  setBtnState(null)
                  onAccept?.()
                }, 100)
              }}
              style={{
                height: 26, fontSize: 12, paddingInline: 12, lineHeight: '24px',
                backgroundColor: btnState === 'accepted' ? '#52c41a' : 'transparent',
                color: btnState === 'accepted' ? '#ffffff' : '#52c41a',
                borderColor: '#52c41a',
                boxShadow: 'none',
                transition: 'all 0.05s ease',
              }}
            >
              采纳
            </Button>
            <Button
              size="small"
              shape="round"
              onClick={(e) => {
                e.stopPropagation()
                setBtnState('rejected')
                setTimeout(() => {
                  setBtnState(null)
                  onReject?.()
                }, 100)
              }}
              style={{
                height: 26, fontSize: 12, paddingInline: 12, lineHeight: '24px',
                backgroundColor: btnState === 'rejected' ? '#ff4d4f' : 'transparent',
                color: btnState === 'rejected' ? '#ffffff' : color.textPrimary,
                borderColor: btnState === 'rejected' ? '#ff4d4f' : color.border,
                boxShadow: 'none',
                transition: 'all 0.05s ease',
              }}
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
    const t = e.user_status === 'accepted' ? e.suggested_text : e.original_text
    if (!t) return
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
          borderTop: `1px solid ${noLoc ? '#faad14' : (e.id === selectedId ? color.borderSelected : color.border)}`,
          borderRight: `1px solid ${noLoc ? '#faad14' : (e.id === selectedId ? color.borderSelected : color.border)}`,
          borderBottom: `1px solid ${noLoc ? '#faad14' : (e.id === selectedId ? color.borderSelected : color.border)}`,
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
          {e.is_obsolete === 1 ? (
            <Tag color="default" style={{ fontSize: fontSize.metaSm, margin: 0 }}>
              历史存档 (已覆盖)
            </Tag>
          ) : (
            e.source === 'rule' && <Tag color="blue" style={{ fontSize: fontSize.metaSm, margin: 0 }}>规范检测</Tag>
          )}
          {done && !e.is_obsolete && (
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
        <div style={{ margin: '4px 0' }}>
          <DiffView original={e.original_text} suggested={e.suggested_text} />
        </div>
        <div style={{ fontSize: fontSize.meta, color: color.textDescription, marginTop: 3 }}>{e.description}</div>
      </div>
    )
  })
}



const ParaRow = React.memo(function ParaRow({
  para,
  paraErrs,
  isCh,
  chapterObj,
  isEditing,
  isHover,
  isActive,
  showCheckboxes,
  isChecked,
  selectedId,
  toolbarPos,
  currentBodyFontSize,
  firstLineIndentEnabled,
  pbInfo,
  pbType,
  pbTooltipIdx,
  editingText,
  savingPara,
  onHover,
  onMouseLeave,
  onParaClick,
  onCheckboxToggle,
  onEditingTextChange,
  onSaveEdit,
  onCancelEdit,
  onStartEdit,
  onDeletePara,
  onTogglePageBreak,
  onSetChapter,
  onPbTooltipIdx,
  onSelectError,
}) {
  const activeParaText = para.revised_text ?? para.text
  const isBlank = !activeParaText || activeParaText.trim() === ''
  const showToolbar = isActive && !isEditing && toolbarPos !== null

  return (
    <React.Fragment>
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
              onConfirm={() => onTogglePageBreak(para)}
              okText="确定移除"
              okButtonProps={{ danger: true }}
              cancelText="取消"
            >
              <Tooltip open={pbTooltipIdx === para.idx} title="点击移除硬分页" mouseLeaveDelay={0.1}>
                <span
                  onMouseEnter={() => onPbTooltipIdx(para.idx)}
                  onMouseLeave={() => onPbTooltipIdx(null)}
                  onClick={() => onPbTooltipIdx(null)}
                  style={{
                    position: 'relative',
                    zIndex: 1,
                    background: color.bgReader,
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
              background: color.bgReader,
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
        onMouseEnter={() => onHover(para.idx)}
        onMouseLeave={onMouseLeave}
        onClick={(e) => onParaClick(e, para.idx)}
        style={{
          marginBottom: 16,
          display: 'flex',
          gap: 6,
          position: 'relative',
          padding: '6px 10px',
          borderRadius: 6,
          transition: 'all 0.15s ease',
          background: isActive
            ? 'rgba(19, 194, 194, 0.09)'
            : isHover
            ? 'rgba(19, 194, 194, 0.04)'
            : isCh
            ? 'rgba(212, 163, 89, 0.04)'
            : 'transparent',
          borderLeft: isActive
            ? '4px solid #13c2c2'
            : isHover
            ? '4px solid #87e8de'
            : isCh
            ? '4px solid #ffe58f'
            : '4px solid transparent',
        }}
      >
        {showCheckboxes && (
          <Checkbox
            checked={isChecked}
            onChange={() => onCheckboxToggle(para.idx)}
            style={{ lineHeight: '1.9', paddingTop: 2 }}
          />
        )}
        <span style={{
          color: para?.revised_text ? color.success : color.textTertiary,
          fontWeight: para?.revised_text ? 600 : 400,
          fontVariantNumeric: 'tabular-nums',
          display: 'inline-block',
          fontSize: fontSize.bodyXs,
          flexShrink: 0,
          lineHeight: 1.9,
          minWidth: 24,
          textAlign: 'left',
          userSelect: 'none',
        }}>
          {para.idx}
        </span>

        <div style={{
          lineHeight: 1.9,
          fontSize: currentBodyFontSize,
          flex: 1,
          color: color.textPrimary,
          textIndent: (firstLineIndentEnabled && !isCh) ? '2em' : '0',
        }}>
          {isEditing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Input.TextArea
                value={editingText}
                onChange={e => onEditingTextChange(e.target.value)}
                autoSize={{ minRows: 1, maxRows: 8 }}
                style={{ fontSize: currentBodyFontSize }}
              />
              <Space size="small">
                <Button type="primary" size="small" loading={savingPara} onClick={() => onSaveEdit(para.idx)}>
                  保存
                </Button>
                <Button size="small" onClick={onCancelEdit}>
                  取消
                </Button>
              </Space>
            </div>
          ) : (
            <div onDoubleClick={() => onStartEdit(para)} style={{ cursor: 'pointer', color: color.textPrimary, display: 'block', width: '100%' }}>
              {isCh && (
                <>
                  <Tag color="gold" style={{ marginBottom: 4, marginRight: 4 }}>
                    📖 章节 ({
                      chapterObj?.level === 1 ? '1级 卷/部' :
                      chapterObj?.level === 2 ? '2级 章' :
                      chapterObj?.level === 3 ? '3级 节/回' :
                      chapterObj?.level === 4 ? '4级 小节' :
                      chapterObj?.level === 5 ? '5级 目' : '6级 细目'
                    })
                  </Tag>
                  {chapterObj?.detected_by === 'manual' ? (
                    <Tag color="green" style={{ marginBottom: 4, marginRight: 8 }}>人工</Tag>
                  ) : chapterObj?.detected_by === 'llm' ? (
                    <Tag color="purple" style={{ marginBottom: 4, marginRight: 8 }}>LLM识别</Tag>
                  ) : (
                    <Tag color="blue" style={{ marginBottom: 4, marginRight: 8 }}>原文</Tag>
                  )}
                </>
              )}
              {isBlank ? (
                <span style={{ color: '#bfbfbf', fontStyle: 'italic', fontSize: 13, userSelect: 'none' }}>
                  [ 空段落 ]
                </span>
              ) : (
                <ParagraphView
                  text={(firstLineIndentEnabled && !isCh) ? (activeParaText || '').replace(/^[\s\u3000]+/, '') : activeParaText}
                  paraErrors={paraErrs}
                  selectedId={selectedId}
                  onSelect={onSelectError}
                />
              )}
            </div>
          )}
        </div>

        {showToolbar && (
          <div style={{
            position: 'absolute',
            top: (isActive && toolbarPos) ? toolbarPos.y : -30,
            left: (isActive && toolbarPos) ? toolbarPos.x : 'auto',
            right: (isActive && toolbarPos) ? 'auto' : 12,
            zIndex: 10,
            background: color.bgCard,
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            padding: '3px 8px',
            borderRadius: 20,
            boxShadow: '0 4px 16px rgba(0,0,0,0.25), 0 1px 4px rgba(0,0,0,0.12)',
            border: `1px solid ${color.borderBar}`,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}>
            <Tooltip title="编辑段落文本">
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={(e) => { e.stopPropagation(); onStartEdit(para); }}
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
                    onConfirm={() => onTogglePageBreak(para)}
                    okText="确定移除"
                    okButtonProps={{ danger: true }}
                    cancelText="取消"
                  >
                    <Tooltip title="移除段前硬分页（使导出 Word 时本段续接上一页）">
                      <Button type="text" size="small" danger icon={<ScissorOutlined />} style={{ fontSize: 12 }}>
                        移除分页
                      </Button>
                    </Tooltip>
                  </Popconfirm>
                )
              }
              return (
                <Tooltip title="插入段前硬分页（使导出 Word 时从新一页开始）">
                  <Button
                    type="text"
                    size="small"
                    icon={<BookOutlined />}
                    onClick={(e) => { e.stopPropagation(); onTogglePageBreak(para) }}
                    style={{ fontSize: 12 }}
                  >
                    新增分页
                  </Button>
                </Tooltip>
              )
            })()}

            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: 'title-1', label: '📖 设为 1级 卷/部 标题', onClick: () => onSetChapter(para, 1) },
                  { key: 'title-2', label: '📖 设为 2级 章 标题', onClick: () => onSetChapter(para, 2) },
                  { key: 'title-3', label: '📖 设为 3级 节/回 标题', onClick: () => onSetChapter(para, 3) },
                  { key: 'title-4', label: '📖 设为 4级 小节 标题', onClick: () => onSetChapter(para, 4) },
                  { key: 'title-5', label: '📖 设为 5级 目 标题', onClick: () => onSetChapter(para, 5) },
                  { key: 'title-6', label: '📖 设为 6级 细目 标题', onClick: () => onSetChapter(para, 6) },
                  ...(isCh ? [{ type: 'divider' }, { key: 'remove', label: '❌ 取消章节标题标记', danger: true, onClick: () => onSetChapter(para, 1, true) }] : []),
                ],
              }}
            >
              <Button type="text" size="small" icon={<BookOutlined />} onClick={(e) => e.stopPropagation()} style={{ fontSize: 12 }}>
                设为标题 ▾
              </Button>
            </Dropdown>

            <Tooltip title="删除该段落">
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                onClick={(e) => { e.stopPropagation(); onDeletePara(para); }}
                style={{ fontSize: 12 }}
              >
                删除
              </Button>
            </Tooltip>
          </div>
        )}
      </div>
    </React.Fragment>
  )
})

function ReviewReaderInner({
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
}, ref) {
  const errors = results?.errors || []
  const paras = results?.paragraphs || []
  const sortedParas = useMemo(() => [...paras].sort((a, b) => a.idx - b.idx), [paras])
  const paraIndexMap = useMemo(() => {
    const map = new Map()
    sortedParas.forEach((p, i) => map.set(p.idx, i))
    return map
  }, [sortedParas])

  const ITEM_HEIGHT = 48
  const BUFFER_SIZE = 50
  const [scrollTop, setScrollTop] = useState(0)
  const [fontSizeOffset, setFontSizeOffset] = useState(() => {
    try { return parseInt(localStorage.getItem('reader_font_offset') || '0', 10) } catch { return 0 }
  })

  const isJumpingRef = useRef(false)
  const jumpTimerRef = useRef(null)

  const handleScroll = useCallback((e) => {
    if (isJumpingRef.current) return
    const st = e.target.scrollTop
    requestAnimationFrame(() => {
      if (!isJumpingRef.current) {
        setScrollTop(st)
      }
    })
  }, [])

  const chaptersByParaIdx = useMemo(() => {
    const map = new Map()
    chapters.forEach(c => {
      map.set(c.title_paragraph_idx, c)
    })
    return map
  }, [chapters])

  const jumpToParagraphExact = useCallback((targetIdx, offset = 0) => {
    const container = flowRef.current
    if (!container || targetIdx == null) return
    const posIndex = paraIndexMap.get(targetIdx)
    if (posIndex == null) return

    isJumpingRef.current = true
    if (jumpTimerRef.current) clearTimeout(jumpTimerRef.current)

    // 步骤 1：锁定基准 scrollTop，锁定 50 行虚拟视口切片包含目标段落
    const baseTop = Math.max(0, posIndex * ITEM_HEIGHT - offset)
    container.scrollTop = baseTop
    setScrollTop(baseTop)

    // 步骤 2：DOM 挂载完成后使用浏览器原生引擎 block: 'start' 做物理绝对齐顶对齐
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!flowRef.current) return
        const c = flowRef.current
        const el = c.querySelector(`[data-para="${targetIdx}"]`)
        if (el) {
          el.scrollIntoView({ behavior: 'auto', block: offset > 0 ? 'center' : 'start' })
        }
        jumpTimerRef.current = setTimeout(() => {
          isJumpingRef.current = false
        }, 150)
      })
    })
  }, [paraIndexMap, ITEM_HEIGHT])

  useImperativeHandle(ref, () => ({
    scrollToParagraph: (idx) => {
      jumpToParagraphExact(idx, 0)
    }
  }))
  const paraMap = useMemo(() => Object.fromEntries(paras.map(p => [p.idx, p])), [paras])

  const flatErrors = useMemo(
    () => [...errors].sort((a, b) => a.paragraph_index - b.paragraph_index),
    [errors],
  )
  const activeErrors = useMemo(() => flatErrors.filter(e => !e.is_obsolete), [flatErrors])
  const obsolete = useMemo(() => flatErrors.filter(e => e.is_obsolete === 1).reverse(), [flatErrors])

  const errorParaIdxs = useMemo(() => {
    const set = new Set(activeErrors.map(e => e.paragraph_index))
    return [...set].sort((a, b) => a - b)
  }, [activeErrors])

  const pending = useMemo(() => activeErrors.filter(e => e.user_status === 'pending'), [activeErrors])
  const accepted = useMemo(() => activeErrors.filter(e => e.user_status === 'accepted').reverse(), [activeErrors])
  const rejected = useMemo(() => activeErrors.filter(e => e.user_status === 'rejected').reverse(), [activeErrors])
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

  const errorsByParaIdx = useMemo(() => {
    const map = new Map()
    activeErrors.forEach(e => {
      const list = map.get(e.paragraph_index)
      if (list) list.push(e)
      else map.set(e.paragraph_index, [e])
    })
    return map
  }, [activeErrors])

  const handleCheckboxToggle = useCallback((idx) => {
    onSelectionChange?.((prev) => {
      const next = new Set(prev || [])
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }, [onSelectionChange])

  const handleHover = useCallback((idx) => setHoverIdx(idx), [])
  const handleMouseLeave = useCallback(() => setHoverIdx(null), [])
  const handleCancelEdit = useCallback(() => setEditingIdx(null), [])

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
    setEditingText(para.revised_text ?? para.text ?? '')
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

    const savedTop = flowRef.current?.scrollTop
    if (savedTop != null && project?.id) {
      localStorage.setItem(`reading_scrolltop_${project.id}`, savedTop)
    }

    try {
      await togglePageBreak(project.id, para.idx, nextType)
      message.success(nextType !== 'none' ? '已插入新增硬分页' : '已移除硬分页', 2)
      await onReloadProject?.()
    } catch (e) {
      message.error(e.message || '设置失败')
      await onReloadProject?.()
    } finally {
      if (savedTop != null && flowRef.current) {
        requestAnimationFrame(() => {
          if (flowRef.current) flowRef.current.scrollTop = savedTop
        })
      }
    }
  }

  const handleSetChapter = async (para, level = 1, isRemove = false) => {
    if (!project?.id) return
    const savedTop = flowRef.current?.scrollTop
    if (savedTop != null && project?.id) {
      localStorage.setItem(`reading_scrolltop_${project.id}`, savedTop)
    }

    const levelNames = { 1: '1级 卷/部', 2: '2级 章', 3: '3级 节/回', 4: '4级 小节', 5: '5级 目', 6: '6级 细目' }

    try {
      if (isRemove) {
        await setChapter(project.id, para.idx, false, 1, '')
        message.success('已取消章节标记')
      } else {
        await setChapter(project.id, para.idx, true, level, para.text.trim())
        message.success(`已将该段设为 ${levelNames[level] || level + '级'} 标题`)
      }
      await onReloadProject?.()
    } catch (e) {
      message.error(e.message || '操作失败')
    } finally {
      if (savedTop != null && flowRef.current) {
        requestAnimationFrame(() => {
          if (flowRef.current) flowRef.current.scrollTop = savedTop
        })
      }
    }
  }

  const [showOptions, setShowOptions] = useState(false)
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
  const updatePos = useCallback(() => {
    const container = flowRef.current
    const el = floatCardElRef.current
    if (!container || !el || !selectedId) return
    const id = selectedIdRef.current
    const err = flatErrors.find(e => e.id === id)
    if (!err || err.is_obsolete === 1) {
      el.style.opacity = '0'
      el.style.transform = 'translateY(3px)'
      return
    }
    const strId = String(selectedId)
    const span = Array.from(container.querySelectorAll('[data-error-id]'))
      .find(s => s.dataset.errorId.split(',').includes(strId))
    if (!span) {
      el.style.opacity = '0'
      el.style.transform = 'translateY(3px)'
      return
    }

    const rect = span.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const cardW = 380
    const cardH = el.offsetHeight || 170

    const bottomBarHeight = 72
    const maxBottom = window.innerHeight - bottomBarHeight
    const minTop = Math.max(8, containerRect.top + 8)

    let top = rect.bottom + 6
    if (top + cardH > maxBottom) {
      const topSpace = rect.top - minTop
      if (topSpace >= cardH + 6) {
        top = rect.top - cardH - 6
      } else {
        top = Math.max(minTop, maxBottom - cardH)
      }
    }

    let left = rect.left
    if (left + cardW > window.innerWidth - 24) {
      left = Math.max(12, window.innerWidth - cardW - 24)
    }

    el.style.top = `${top}px`
    el.style.left = `${left}px`
    el.style.opacity = '1'
    el.style.transform = 'translateY(0)'
  }, [selectedId])

  useEffect(() => {
    const el = floatCardElRef.current
    if (el) {
      el.style.opacity = '0'
      el.style.transform = 'translateY(3px)'
    }
    const timer = setTimeout(() => {
      updatePos()
    }, 100)
    return () => clearTimeout(timer)
  }, [selectedId, scrollTop, results, updatePos])

  useEffect(() => {
    if (!selectedId || !flowRef.current) return
    const err = flatErrors.find(e => e.id === selectedId)
    if (!err) return

    const container = flowRef.current
    const paraEl = container.querySelector(`[data-para="${err.paragraph_index}"]`)

    if (paraEl) {
      const cRect = container.getBoundingClientRect()
      const pRect = paraEl.getBoundingClientRect()
      const isVisible = pRect.top >= cRect.top + 20 && pRect.bottom <= cRect.bottom - 20
      if (isVisible) {
        // 目标段落已经在可视区域内：正文绝对保持静止，仅定位卡片！
        updatePos()
        return
      }
    }

    // 只有当目标段落不在当前视口内时，才触发正文滚动
    const posIndex = paraIndexMap.get(err.paragraph_index)
    if (posIndex != null) {
      const targetTop = Math.max(0, posIndex * ITEM_HEIGHT - 80)
      container.scrollTop = targetTop
      setScrollTop(targetTop)
    }
  }, [selectedId, flatErrors, paraIndexMap, ITEM_HEIGHT, updatePos])

  const prevSelectedChapterRef = useRef(selectedChapter)
  useEffect(() => {
    if (!selectedChapter || !flowRef.current) return
    if (prevSelectedChapterRef.current === selectedChapter) return
    prevSelectedChapterRef.current = selectedChapter

    const ch = chapters.find(c => c.id === selectedChapter)
    if (!ch) return
    const targetIdx = ch.title_paragraph_idx ?? ch.start_idx
    if (targetIdx == null) return

    jumpToParagraphExact(targetIdx, 0)
  }, [selectedChapter, chapters, jumpToParagraphExact])

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
    zIndex: 400,
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
            <style>{`
              .custom-reader-scroll::-webkit-scrollbar {
                width: 14px;
              }
              .custom-reader-scroll::-webkit-scrollbar-track {
                background: transparent;
              }
              .custom-reader-scroll::-webkit-scrollbar-thumb {
                min-height: 48px;
                background-color: rgba(0, 0, 0, 0.2);
                background-clip: padding-box;
                border: 4px solid transparent;
                border-radius: 7px;
                transition: background-color 0.2s ease, border-width 0.2s ease;
              }
              .custom-reader-scroll::-webkit-scrollbar-thumb:hover {
                background-color: rgba(0, 0, 0, 0.55);
                border: 1px solid transparent;
              }
            `}</style>
            <div
              ref={flowRef}
              className="custom-reader-scroll"
              onScroll={handleScroll}
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                padding: '0 24px',
                background: color.bgReader,
                borderRadius: radius.md,
                position: 'relative',
              }}
            >
              {(() => {
                const totalHeight = sortedParas.length * ITEM_HEIGHT
                const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - 10)
                const endIndex = Math.min(sortedParas.length, startIndex + BUFFER_SIZE)
                const offsetY = startIndex * ITEM_HEIGHT
                const visibleParas = sortedParas.slice(startIndex, endIndex)

                return (
                  <div style={{ height: totalHeight, position: 'relative', width: '100%' }}>
                    <div style={{ transform: `translateY(${offsetY}px)`, position: 'absolute', top: 0, left: 0, right: 0 }}>
                      {visibleParas.map(para => {
                        const paraErrs = errorsByParaIdx.get(para.idx) || EMPTY_ARRAY
                        const chapterObj = chaptersByParaIdx.get(para.idx)
                        const isCh = Boolean(chapterObj)
                        const isEditing = editingIdx === para.idx
                        const isHover = hoverIdx === para.idx
                        const isChecked = selectedParas?.has(para.idx) || false

                        const pbType = para.page_break_type || (para.has_page_break_before === 1 ? 'auto_chapter' : 'none')
                        const pbInfo = PB_INFO_MAP[pbType]

                        const isActive = activeIdx === para.idx

                        return (
                          <ParaRow
                            key={para.idx}
                            para={para}
                            paraErrs={paraErrs}
                            isCh={isCh}
                            chapterObj={chapterObj}
                            isEditing={isEditing}
                            isHover={isHover}
                            isActive={isActive}
                            showCheckboxes={showCheckboxes}
                            isChecked={isChecked}
                            selectedId={selectedId}
                            toolbarPos={isActive ? toolbarPos : null}
                            currentBodyFontSize={currentBodyFontSize}
                            firstLineIndentEnabled={Boolean(project?.style_config?.first_line_indent_enabled)}
                            pbInfo={pbInfo}
                            pbType={pbType}
                            pbTooltipIdx={pbTooltipIdx}
                            editingText={isEditing ? editingText : ''}
                            savingPara={savingPara}
                            onHover={handleHover}
                            onMouseLeave={handleMouseLeave}
                            onParaClick={handleParaClick}
                            onCheckboxToggle={handleCheckboxToggle}
                            onEditingTextChange={setEditingText}
                            onSaveEdit={handleSaveEdit}
                            onCancelEdit={handleCancelEdit}
                            onStartEdit={handleStartEdit}
                            onDeletePara={handleDeletePara}
                            onTogglePageBreak={handleTogglePageBreak}
                            onSetChapter={handleSetChapter}
                            onPbTooltipIdx={setPbTooltipIdx}
                            onSelectError={setSelectedId}
                          />
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>

          {/* right panel */}
          <div
            style={{
              width: showPanel ? 420 : 0,
              overflow: 'hidden',
              flexShrink: 0,
              display: showPanel ? 'block' : 'none',
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
                <Button type="text" size="small" icon={<MenuFoldOutlined style={{ transform: 'scaleX(-1)' }} />} onClick={onTogglePanel} />
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
                  {
                    key: 'obsolete',
                    label: <span>历史作废 ({obsolete.length})</span>,
                    children: obsolete.length === 0
                      ? <Empty description="暂无历史作废问题" />
                      : (
                        <ErrorList
                          errors={obsolete}
                          selectedId={selectedId}
                          onSelect={(id) => {
                            setSelectedId(id)
                            const err = flatErrors.find(e => e.id === id)
                            if (err) {
                              scrollToParagraph(err.paragraph_index)
                            }
                          }}
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
            onClick={() => {
              if (showCheckboxes) {
                setShowCheckboxes(false)
                onSelectionChange?.(new Set())
              } else {
                setShowCheckboxes(true)
              }
            }}
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
                  color: color.textPrimary, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
                  maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block', flexShrink: 0,
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
                          color: isRetrying ? '#d4a359'
                            : w.status === 'ok' ? '#52c41a'
                            : w.status === 'failed' ? '#ff4d4f'
                            : '#d4a359' }}>
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
                  onClick={() => { setFlashSide('accepted'); setTimeout(() => { setFlashSide(null); handleStatus('accepted') }, 100) }}
                  disabled={inProgress}
                  style={{
                    height: 48, paddingInline: 24, fontSize: 15, flexShrink: 0,
                    backgroundColor: flashSide === 'accepted' ? '#52c41a' : undefined,
                    borderColor: flashSide === 'accepted' ? '#52c41a' : undefined,
                    boxShadow: 'none',
                  }}
                >
                  ← 采纳
                </Button>
                <Button
                  size="large"
                  className="bar-action-btn"
                  icon={<CloseCircleOutlined />}
                  onClick={() => { setFlashSide('rejected'); setTimeout(() => { setFlashSide(null); handleStatus('rejected') }, 100) }}
                  disabled={inProgress}
                  style={{
                    height: 48, paddingInline: 24, fontSize: 15, flexShrink: 0,
                    backgroundColor: flashSide === 'rejected' ? '#ff4d4f' : undefined,
                    color: flashSide === 'rejected' ? '#fff' : undefined,
                    borderColor: flashSide === 'rejected' ? '#ff4d4f' : undefined,
                    boxShadow: 'none',
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, color: color.textPrimary, fontWeight: 500, minWidth: 40 }}>模型</span>
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, color: color.textPrimary, fontWeight: 500, minWidth: 40 }}>分类</span>
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
              <Tag
                closable={closable}
                onClose={onClose}
                style={{
                  margin: '1px 2px',
                  fontSize: 11,
                  background: 'var(--color-bgPage)',
                  color: 'var(--color-textPrimary)',
                  borderColor: 'var(--color-borderBar)',
                }}
              >
                {label}
              </Tag>
            )
          }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, color: color.textPrimary, fontWeight: 500, minWidth: 40 }}>窗口</span>
        <InputNumber
          min={5}
          max={100}
          size="small"
          style={{ width: 80 }}
          value={proofreadWindowSize}
          disabled={inProgress}
          onChange={(val) => onWindowSizeChange?.(val || 5)}
        />
        <span style={{ fontSize: 12, color: color.textSecondary }}>
          段/窗口
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, color: color.textPrimary, fontWeight: 500, minWidth: 40 }}>并发</span>
        <InputNumber
          min={1}
          max={20}
          size="small"
          style={{ width: 80 }}
          value={batchMaxConcurrent}
          disabled={inProgress}
          onChange={(val) => onBatchMaxConcurrentChange?.(val || 1)}
        />
        <span style={{ fontSize: 12, color: color.textSecondary }}>
          窗口（单次并发处理 {(batchMaxConcurrent || 1) * (proofreadWindowSize || 30)} 段）
        </span>
      </div>
    </div>
  )
}

const ReviewReader = forwardRef(ReviewReaderInner)
ReviewReader.displayName = 'ReviewReader'
export default ReviewReader
