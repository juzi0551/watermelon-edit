import React, { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { Input, Button, Tag, Space, Popconfirm, Tooltip } from 'antd'
import { color, radius, fontSize } from '../../../design-tokens'
import { parseEditNotes } from '../utils/readerUtils'
import { ParagraphView } from './ParagraphView'
import { TipTapParaEditor } from './TipTapParaEditor'

function getCaretOffsetFromPoint(x, y) {
  try {
    if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(x, y)
      if (range && range.startContainer) {
        return { node: range.startContainer, offset: range.startOffset }
      }
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y)
      if (pos) return { node: pos.offsetNode, offset: pos.offset }
    }
  } catch { /* noop */ }
  return null
}

export const ParaRow = React.memo(function ParaRow({
  para,
  paraErrs,
  isCh,
  chapterObj,
  isEditing,
  isActive,
  isChecked,
  selectedId,
  flashingParaIdx,
  currentBodyFontSize,
  firstLineIndentEnabled,
  pbInfo,
  pbType,
  pbTooltipIdx,
  editingText,
  editingNote,
  savingPara,
  showOriginalThis,
  onParaClick,
  onCheckboxToggle,
  onEditingTextChange,
  onEditingNoteChange,
  onSaveEdit,
  onCancelEdit,
  onTogglePageBreak,
  onPbTooltipIdx,
  onSelectError,
  showAllOriginals,
  onSelectManualEdit,
  mergeMode,
  isMergeChecked,
  onMergeToggle,
  onStartEdit,
  editingCaretPos,
  annotations,
  selectedAnnotationId,
  onSelectAnnotation,
  isWritingMode = false,
  onSplitAndInsert,
  onMergeWithPrev,
}) {
  const hasManualEdit = Boolean(para.revised_text && para.revised_text !== para.text)
  const showOriginal = !isWritingMode && (showAllOriginals || showOriginalThis) && hasManualEdit
  const activeParaText = para.revised_text ?? para.text

  const isBlank = !activeParaText || activeParaText.trim() === ''

  const [localText, setLocalText] = useState('')
  const [localNote, setLocalNote] = useState('')
  const textareaRef = useRef(null)
  const caretSetRef = useRef(false)
  const autoSaveTimerRef = useRef(null)

  const effectiveEditing = isWritingMode || isEditing

  useEffect(() => {
    if (!effectiveEditing) caretSetRef.current = false
  }, [effectiveEditing])

  useLayoutEffect(() => {
    if (!effectiveEditing || editingCaretPos == null || caretSetRef.current || !textareaRef.current || localText === undefined) return
    const native = textareaRef.current.resizableTextArea?.textArea ?? textareaRef.current
    try {
      native.setSelectionRange(editingCaretPos, editingCaretPos)
      native.focus()
      caretSetRef.current = true
    } catch { /* noop */ }
  }, [effectiveEditing, editingCaretPos, localText])

  useEffect(() => {
    if (effectiveEditing) {
      setLocalText(editingText || para.revised_text || para.text || '')
      setLocalNote(editingNote || '')
    }
  }, [effectiveEditing, editingText, editingNote, para.revised_text, para.text])

  // 撰写模式：打字 1.5 秒静默防抖自动保存 (Silent Auto-Save)
  const handleLocalTextChangeWithDebounce = (val) => {
    setLocalText(val)
    if (isWritingMode) {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = setTimeout(() => {
        onSaveEdit?.(para.idx, val, null, true)
      }, 1500)
    }
  }

  const isFlashing = Boolean(flashingParaIdx != null && (flashingParaIdx === para.idx || (para.uuid && flashingParaIdx === para.uuid)))

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
                    transition: 'border-left 0.08s ease',
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
        data-para={para.uuid || para.idx}
        onClick={(e) => {
          if (mergeMode) {
            e.stopPropagation()
            onMergeToggle?.(para)
          } else {
            onParaClick(e, para.idx)
          }
        }}
        style={{
          scrollMarginTop: 60,
          marginBottom: isWritingMode ? 14 : 16,
          display: 'flex',
          gap: 6,
          position: 'relative',
          padding: isWritingMode ? '4px 8px' : '6px 10px',
          borderRadius: 6,
          transition: 'background 0.3s ease-out, box-shadow 0.3s ease-out, border-left 0.15s ease',
          contentVisibility: 'auto',
          containIntrinsicSize: '0 48px',
          cursor: mergeMode || isWritingMode ? 'text' : 'default',
          background: isMergeChecked
            ? 'rgba(19, 194, 194, 0.14)'
            : isFlashing
              ? 'rgba(250, 173, 20, 0.28)'
              : isActive
                ? (isWritingMode ? 'rgba(212, 163, 89, 0.08)' : 'rgba(19, 194, 194, 0.09)')
                : isCh
                  ? 'rgba(212, 163, 89, 0.04)'
                  : 'transparent',
          boxShadow: isFlashing
            ? '0 0 0 2px rgba(250, 173, 20, 0.5), 0 2px 10px rgba(250, 173, 20, 0.2)'
            : undefined,
          borderLeft: isMergeChecked
            ? '4px solid #13c2c2'
            : isFlashing
              ? '4px solid #faad14'
              : isActive
                ? (isWritingMode ? '4px solid #d4a359' : '4px solid #13c2c2')
                : isCh
                  ? '4px solid #ffe58f'
                  : '4px solid transparent',
        }}
      >
        <span
          title="段落编号"
          style={{
            color: para?.revised_text ? color.success : color.textTertiary,
            fontWeight: para?.revised_text ? 600 : 400,
            fontVariantNumeric: 'tabular-nums',
            display: isWritingMode ? 'none' : 'inline-block',
            fontSize: fontSize.bodyXs,
            flexShrink: 0,
            lineHeight: 1.9,
            minWidth: 24,
            textAlign: 'left',
            userSelect: 'none',
            borderRadius: 3,
            transition: 'color 0.15s',
          }}
        >
          {para.idx + 1}
        </span>

        <div style={{
          lineHeight: 1.9,
          fontSize: currentBodyFontSize,
          flex: 1,
          color: color.textPrimary,
          textIndent: (firstLineIndentEnabled && !isCh) ? '2em' : '0',
        }}>
          {effectiveEditing ? (
            isWritingMode ? (
              <TipTapParaEditor
                para={para}
                initialContent={localText}
                onContentChange={handleLocalTextChangeWithDebounce}
                onSplitAndInsert={onSplitAndInsert}
                onMergeWithPrev={onMergeWithPrev}
                currentBodyFontSize={currentBodyFontSize}
                isCh={isCh}
                chapterObj={chapterObj}
                isEditing={isEditing}
                editingCaretPos={editingCaretPos}
              />

            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 0 }}>
                <Input.TextArea
                  ref={textareaRef}
                  autoFocus
                  value={localText}
                  onChange={e => handleLocalTextChangeWithDebounce(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      onCancelEdit()
                    } else if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      onSaveEdit(para.idx, localText, localNote)
                    }
                  }}
                  autoSize={{ minRows: 1, maxRows: 16 }}
                  style={{
                    fontSize: currentBodyFontSize,
                    borderRadius: 6,
                    lineHeight: 1.9,
                  }}
                  placeholder="编辑段落文本..."
                />
                <Input
                  value={localNote}
                  onChange={e => setLocalNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      onCancelEdit()
                    } else if (e.key === 'Enter') {
                      e.preventDefault()
                      onSaveEdit(para.idx, localText, localNote)
                    }
                  }}
                  placeholder="可选：追加本次修改原因备注（例如：第2次修改：修正错词）"
                  size="middle"
                  style={{ borderRadius: 6 }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 2 }}>
                  <Button
                    size="middle"
                    onClick={onCancelEdit}
                    style={{ paddingInline: 16 }}
                  >
                    取消 (Esc)
                  </Button>
                  <Button
                    type="primary"
                    size="middle"
                    loading={savingPara}
                    onClick={() => onSaveEdit(para.idx, localText, localNote)}
                    style={{ paddingInline: 20, fontWeight: 500 }}
                  >
                    保存 (Enter)
                  </Button>
                </div>
              </div>
            )
          ) : (
            <div
              onDoubleClick={(e) => {
                if (mergeMode) {
                  e.stopPropagation()
                  return
                }
                let caretPos = null
                try {
                  const cp = getCaretOffsetFromPoint(e.clientX, e.clientY)
                  if (cp && cp.node.nodeType === Node.TEXT_NODE && cp.node.parentElement?.closest('[data-para]')) {
                    caretPos = cp.offset
                  }
                } catch { /* noop */ }
                try {
                  window.getSelection()?.removeAllRanges()
                } catch (e) {}
                onStartEdit(para, caretPos)
              }}
              style={{ cursor: 'pointer', color: color.textPrimary, display: 'block', width: '100%' }}
            >
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
              {showOriginal && (
                <div style={{
                  background: color.bgCard,
                  borderLeft: '3px solid #1890ff',
                  padding: '6px 12px',
                  borderRadius: radius.sm,
                  marginBottom: 6,
                  fontSize: currentBodyFontSize - 1,
                  lineHeight: 1.6,
                  color: color.textSecondary,
                  borderTop: `1px solid ${color.border}`,
                  borderRight: `1px solid ${color.border}`,
                  borderBottom: `1px solid ${color.border}`,
                }}>
                  <span style={{ color: '#1890ff', fontWeight: 'bold', marginRight: 6 }}>[ 初始原文 ]</span>
                  {para.text}
                </div>
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
                  origText={para.text}
                  editNote={para.edit_note}
                  paraIdx={para.idx}
                  onSelectManualEdit={onSelectManualEdit}
                  mergeMode={mergeMode}
                  annotations={annotations}
                  selectedAnnotationId={selectedAnnotationId}
                  onSelectAnnotation={onSelectAnnotation}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </React.Fragment>
  )
})
