import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react'
import { Button, Space, Tooltip, Dropdown } from 'antd'
import { 
  RocketOutlined, BulbOutlined, MessageOutlined, HighlightOutlined, 
  ExperimentOutlined, FormatPainterOutlined, ThunderboltOutlined,
  BoldOutlined, FontColorsOutlined, BookOutlined
} from '@ant-design/icons'

// Preset document text colors for novel editing
const TEXT_COLORS = [
  { name: '默认黑', color: '#262626' },
  { name: '朱红', color: '#dc2626' },
  { name: '琥珀金', color: '#d97706' },
  { name: '翡翠绿', color: '#059669' },
  { name: '宝石蓝', color: '#2563eb' },
  { name: '紫罗兰', color: '#722ed1' },
]

function getTextareaSelectionRect(textarea) {
  if (!textarea) return null
  const { selectionStart, selectionEnd } = textarea
  if (selectionStart == null || selectionEnd == null || selectionStart === selectionEnd) {
    return null
  }

  let mirror = document.getElementById('textarea-selection-mirror')
  if (!mirror) {
    mirror = document.createElement('div')
    mirror.id = 'textarea-selection-mirror'
    mirror.style.position = 'absolute'
    mirror.style.visibility = 'hidden'
    mirror.style.pointerEvents = 'none'
    mirror.style.whiteSpace = 'pre-wrap'
    mirror.style.wordWrap = 'break-word'
    document.body.appendChild(mirror)
  }

  const style = getComputedStyle(textarea)
  const properties = [
    'direction', 'boxSizing', 'width', 'height',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontStyle', 'fontVariant', 'fontWeight', 'fontSize',
    'lineHeight', 'fontFamily', 'textAlign', 'textIndent',
  ]

  properties.forEach(prop => {
    mirror.style[prop] = style[prop]
  })

  const textareaRect = textarea.getBoundingClientRect()
  mirror.style.top = `${textareaRect.top + window.scrollY}px`
  mirror.style.left = `${textareaRect.left + window.scrollX}px`

  const val = textarea.value
  const beforeText = val.substring(0, selectionStart)
  const selectedText = val.substring(selectionStart, selectionEnd)

  mirror.textContent = ''
  const beforeNode = document.createTextNode(beforeText)
  const selectedSpan = document.createElement('span')
  selectedSpan.textContent = selectedText || '\u200b'

  mirror.appendChild(beforeNode)
  mirror.appendChild(selectedSpan)

  const spanRect = selectedSpan.getBoundingClientRect()
  return spanRect
}

export function SelectionToolbar({
  containerRef,
  paras,
  onAskAssistant,
  onAddAnnotation,
  onOpenSensoryExpand,
  onOpenRewrite,
  onStartSelectionProofread,
  onSetChapter,
  onSelectionChange,
  tbFontSize = 14,
  mergeMode,
  isWritingMode = false,
}) {
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [selectionData, setSelectionData] = useState(null)
  const toolbarRef = useRef(null)
  const activeEditorRef = useRef(null)
  const selRangeRef = useRef(null)

  const handleBold = () => {
    try {
      const ed = activeEditorRef.current || window.__activeTipTapEditor
      if (ed) {
        const range = selRangeRef.current
        const chain = ed.chain().focus()
        if (range) chain.setTextSelection(range)
        chain.toggleBold().run()
      } else {
        document.execCommand('bold')
      }
    } catch {}
  }

  const handleColor = (hex) => {
    try {
      const ed = activeEditorRef.current || window.__activeTipTapEditor
      if (ed) {
        const range = selRangeRef.current
        const chain = ed.chain().focus()
        if (range) chain.setTextSelection(range)
        chain.setColor(hex).run()
      } else {
        document.execCommand('foreColor', false, hex)
      }
    } catch {}
  }


  useEffect(() => {
    onSelectionChange?.(visible)
  }, [visible, onSelectionChange])


  const parseParaElement = useCallback((node) => {
    if (!node) return null
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
    if (!el) return null
    const paraEl = el.closest('[data-para]')
    if (!paraEl) return null
    const rawVal = paraEl.getAttribute('data-para')
    if (!rawVal) return null

    const match = (paras || []).find(
      (p) => String(p.uuid) === String(rawVal) || String(p.idx) === String(rawVal)
    )
    if (match) {
      return { idx: match.idx, uuid: match.uuid || match.idx }
    }

    const numIdx = parseInt(rawVal, 10)
    if (!isNaN(numIdx)) {
      const matchByIdx = (paras || []).find((p) => p.idx === numIdx)
      return matchByIdx ? { idx: matchByIdx.idx, uuid: matchByIdx.uuid || matchByIdx.idx } : { idx: numIdx, uuid: rawVal }
    }

    return { idx: 1, uuid: rawVal }
  }, [paras])

  const updateSelectionState = useCallback(() => {
    let text = ''
    let paraEl = null
    let rect = null

    // 优先检查是否有选中的 textarea 内部文本（撰写模式下段落编辑框）
    const activeEl = document.activeElement
    if (activeEl && (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT')) {
      const start = activeEl.selectionStart
      const end = activeEl.selectionEnd
      if (start != null && end != null && start !== end) {
        text = activeEl.value.slice(start, end).trim()
        paraEl = activeEl.closest('[data-para]')
        // 算出 textarea 内部划选字符的精准物理包围盒
        rect = getTextareaSelectionRect(activeEl) || activeEl.getBoundingClientRect()
      }
    }

    if (text && paraEl && rect && containerRef?.current) {
      const rawVal = paraEl.getAttribute('data-para')
      const targetPara = (paras || []).find((p) => String(p.uuid) === String(rawVal) || String(p.idx) === String(rawVal))
      if (targetPara) {
        const fullText = (targetPara.revised_text || targetPara.text || '').trim()
        const containerRect = containerRef.current.getBoundingClientRect()
        const relativeTop = rect.top - containerRect.top + containerRef.current.scrollTop - 44
        const relativeLeft = rect.left - containerRect.left + (rect.width / 2)

        setPosition({
          top: Math.max(10, relativeTop),
          left: Math.max(100, Math.min(containerRect.width - 100, relativeLeft)),
        })

        setSelectionData({
          selectedText: text,
          isExcerpt: text !== fullText,
          formattedExcerpt: text,
          paragraphIdx: targetPara.idx,
          paragraphUuid: targetPara.uuid || targetPara.idx,
          fullText,
        })

        setVisible(true)
        return
      }
    }


    // 标准 DOM Range 选中检测 (非 textarea)
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      setVisible(false)
      setSelectionData(null)
      return
    }

    text = selection.toString().trim()
    if (!text) {
      setVisible(false)
      setSelectionData(null)
      return
    }

    const startPara = parseParaElement(selection.anchorNode)
    const endPara = parseParaElement(selection.focusNode)

    if (!startPara || !endPara || startPara.idx !== endPara.idx) {
      setVisible(false)
      setSelectionData(null)
      return
    }

    const startIdx = startPara.idx
    const paraUuid = startPara.uuid

    const targetPara = (paras || []).find((p) => p.idx === startIdx || String(p.uuid) === String(paraUuid))
    const fullText = (targetPara?.revised_text || targetPara?.text || '').trim()
    const isExcerpt = Boolean(fullText && text !== fullText)

    let formattedExcerpt = text
    if (isExcerpt && fullText) {
      const idxInFull = fullText.indexOf(text)
      const hasLeading = idxInFull > 0
      const hasTrailing = idxInFull >= 0 && (idxInFull + text.length < fullText.length)
      formattedExcerpt = `${hasLeading ? '…' : ''}${text}${hasTrailing ? '…' : ''}`
    }

    const range = selection.getRangeAt(0)
    rect = range.getBoundingClientRect()
    if (!containerRef?.current) return

    const containerRect = containerRef.current.getBoundingClientRect()
    const relativeTop = rect.top - containerRect.top + containerRef.current.scrollTop - 44
    // ✍️ 撰写模式：工具条左边缘对齐选中区域的第一个文字；校对模式保持居中
    const relativeLeft = isWritingMode
      ? rect.left - containerRect.left
      : rect.left - containerRect.left + (rect.width / 2)

    setPosition({
      top: Math.max(10, relativeTop),
      left: Math.max(isWritingMode ? 4 : 100, Math.min(containerRect.width - 100, relativeLeft)),
    })

    // 捕获当前激活的 TipTap 编辑器及其选中范围，供加粗/颜色命令精确应用
    if (isWritingMode) {
      const ed = window.__activeTipTapEditor
      if (ed) {
        activeEditorRef.current = ed
        const sel = ed.state.selection
        if (sel && !sel.empty) {
          selRangeRef.current = { from: sel.from, to: sel.to }
        }
      }
    }

    setSelectionData({
      selectedText: text,
      isExcerpt,
      formattedExcerpt,
      paragraphIdx: startIdx,
      paragraphUuid: paraUuid,
      fullText,
    })

    setVisible(true)
  }, [containerRef, paras, parseParaElement, isWritingMode])


  useEffect(() => {
    const handleMouseUp = () => {
      setTimeout(updateSelectionState, 20)
    }
    const handleKeyUp = () => {
      setTimeout(updateSelectionState, 20)
    }
    const handleSelectionChange = () => {
      setTimeout(updateSelectionState, 20)
    }

    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('keyup', handleKeyUp)
    document.addEventListener('selectionchange', handleSelectionChange)

    return () => {
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('keyup', handleKeyUp)
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [updateSelectionState])


  useEffect(() => {
    const containerEl = containerRef?.current
    if (!containerEl) return

    const handleScroll = () => {
      if (visible) updateSelectionState()
    }

    containerEl.addEventListener('scroll', handleScroll)
    window.addEventListener('resize', handleScroll)

    return () => {
      containerEl.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleScroll)
    }
  }, [containerRef, visible, updateSelectionState])

  // ✍️ 撰写模式左对齐时，若工具条超出容器右边界则向左回收
  useLayoutEffect(() => {
    if (!visible || !toolbarRef.current || !containerRef.current || !isWritingMode) return
    const toolbarW = toolbarRef.current.offsetWidth
    const containerW = containerRef.current.clientWidth
    if (position.left + toolbarW > containerW - 4) {
      setPosition(prev => ({ ...prev, left: Math.max(4, containerW - toolbarW - 4) }))
    }
  }, [visible, position.left, isWritingMode])

  if (mergeMode || !visible || !selectionData) return null

  const handleAction = (actionType) => {
    if (!onAskAssistant || !selectionData) return

    let defaultPrompt = ''
    if (actionType === 'polish') {
      defaultPrompt = '请帮我润色选中的文字，使其更加生动流畅。'
    } else if (actionType === 'advice') {
      defaultPrompt = '请对选中的文字提出修改意见与改进分析。'
    }

    onAskAssistant({
      ...selectionData,
      prompt: defaultPrompt,
    })

    window.getSelection()?.removeAllRanges()
    setVisible(false)
    setSelectionData(null)
  }

  const handleAddAnnotationClick = () => {
    if (!onAddAnnotation || !selectionData) return
    onAddAnnotation(selectionData)
    window.getSelection()?.removeAllRanges()
    setVisible(false)
    setSelectionData(null)
  }

  const btnHeight = Math.max(28, tbFontSize + 14)
  const iconFontSize = tbFontSize + 2

  return (
    <div
      ref={toolbarRef}
      style={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        transform: isWritingMode ? 'none' : 'translateX(-50%)',
        zIndex: 900,
        background: 'var(--color-bgCard, rgba(255, 255, 255, 0.95))',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        padding: '4px 12px',
        borderRadius: 24,
        border: '1px solid var(--color-borderBar, rgba(217, 217, 217, 0.8))',
        boxShadow: '0 6px 20px rgba(114, 46, 209, 0.16)',
        display: 'flex',
        alignItems: 'center',
        whiteSpace: 'nowrap',
        pointerEvents: 'auto',
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <Space size={6}>
        {isWritingMode ? (
          /* ✍️ 撰写模式划选工具条 (支持加粗、颜色、设章节与 AI 扩写润色) */
          <>
            <Tooltip title="加粗选中文字 (Bold)">
              <Button
                type="text"
                size="small"
                icon={<BoldOutlined style={{ color: '#262626', fontSize: iconFontSize, fontWeight: 'bold' }} />}
                onClick={handleBold}
                style={{ fontSize: tbFontSize, fontWeight: 700, height: btnHeight }}
              >
                加粗
              </Button>
            </Tooltip>

            <Dropdown
              trigger={['click']}
              menu={{
                items: TEXT_COLORS.map(c => ({
                  key: c.color,
                  label: (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 14, height: 14, borderRadius: '50%', background: c.color }} />
                      <span>{c.name}</span>
                    </div>
                  ),
                  onClick: () => handleColor(c.color),
                }))
              }}
            >
              <Button
                type="text"
                size="small"
                icon={<FontColorsOutlined style={{ color: '#d97706', fontSize: iconFontSize }} />}
                style={{ fontSize: tbFontSize, fontWeight: 500, height: btnHeight }}
              >
                颜色 ▾
              </Button>
            </Dropdown>

            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  {
                    key: 'lvl-1',
                    label: <span><BookOutlined /> 设为 1级 卷/部 标题 (自动分页)</span>,
                    onClick: () => {
                      const targetPara = (paras || []).find(p => p.idx === selectionData?.paragraphIdx || String(p.uuid) === String(selectionData?.paragraphUuid))
                      if (targetPara) onSetChapter?.(targetPara, 1)
                    }
                  },
                  {
                    key: 'lvl-2',
                    label: <span><BookOutlined /> 设为 2级 章 标题 (自动分页)</span>,
                    onClick: () => {
                      const targetPara = (paras || []).find(p => p.idx === selectionData?.paragraphIdx || String(p.uuid) === String(selectionData?.paragraphUuid))
                      if (targetPara) onSetChapter?.(targetPara, 2)
                    }
                  },
                  {
                    key: 'lvl-3',
                    label: <span><BookOutlined /> 设为 3级 节/回 标题</span>,
                    onClick: () => {
                      const targetPara = (paras || []).find(p => p.idx === selectionData?.paragraphIdx || String(p.uuid) === String(selectionData?.paragraphUuid))
                      if (targetPara) onSetChapter?.(targetPara, 3)
                    }
                  },
                  {
                    key: 'remove',
                    label: <span style={{ color: '#ff4d4f' }}>取消章节标题标记</span>,
                    onClick: () => {
                      const targetPara = (paras || []).find(p => p.idx === selectionData?.paragraphIdx || String(p.uuid) === String(selectionData?.paragraphUuid))
                      if (targetPara) onSetChapter?.(targetPara, 1, true)
                    }
                  },
                ]
              }}
            >
              <Button
                type="text"
                size="small"
                icon={<BookOutlined style={{ color: '#059669', fontSize: iconFontSize }} />}
                style={{ fontSize: tbFontSize, fontWeight: 600, height: btnHeight, color: '#059669' }}
              >
                设章节 ▾
              </Button>
            </Dropdown>

            <Tooltip title="多维度五感细节与描摹扩写 (Sensory Describe)">
              <Button
                type="text"
                size="small"
                icon={<ExperimentOutlined style={{ color: '#d4a359', fontSize: iconFontSize }} />}
                onClick={() => {
                  onOpenSensoryExpand?.(selectionData)
                  window.getSelection()?.removeAllRanges()
                  setVisible(false)
                  setSelectionData(null)
                }}
                style={{ fontSize: tbFontSize, fontWeight: 600, height: btnHeight, color: '#8c5813' }}
              >
                五感扩写
              </Button>
            </Tooltip>

            <Tooltip title="针对划选字句雕琢修辞，提供 3 种文风替换方案">
              <Button
                type="text"
                size="small"
                icon={<FormatPainterOutlined style={{ color: '#722ed1', fontSize: iconFontSize }} />}
                onClick={() => {
                  onOpenRewrite?.(selectionData)
                  window.getSelection()?.removeAllRanges()
                  setVisible(false)
                  setSelectionData(null)
                }}
                style={{ fontSize: tbFontSize, fontWeight: 600, height: btnHeight, color: '#722ed1' }}
              >
                润色重写
              </Button>
            </Tooltip>

            <Tooltip title="询问 AI 助手关于选中情节或人设的灵感建议">
              <Button
                type="text"
                size="small"
                icon={<MessageOutlined style={{ color: '#1890ff', fontSize: iconFontSize }} />}
                onClick={() => handleAction('ask')}
                style={{ fontSize: tbFontSize, fontWeight: 500, height: btnHeight, color: '#1890ff' }}
              >
                问 AI 灵感
              </Button>
            </Tooltip>

            <Tooltip title="为选中的词句添加设定批注与笔记">
              <Button
                type="text"
                size="small"
                icon={<HighlightOutlined style={{ color: '#059669', fontSize: iconFontSize }} />}
                onClick={handleAddAnnotationClick}
                style={{ fontSize: tbFontSize, fontWeight: 500, height: btnHeight }}
              >
                加注释
              </Button>
            </Tooltip>
          </>

        ) : (
          /* 🔍 校对模式划选工具条：【加注释】排在第一位，【选区校对】排在最后一位 */
          <>
            <Tooltip title="为选中的词句添加书籍划线注释与审校批注">
              <Button
                type="text"
                size="small"
                icon={<HighlightOutlined style={{ color: '#059669', fontSize: iconFontSize }} />}
                onClick={handleAddAnnotationClick}
                style={{ fontSize: tbFontSize, fontWeight: 500, height: btnHeight }}
              >
                加注释
              </Button>
            </Tooltip>

            <Tooltip title="多维度五感细节与描摹扩写 (Sensory Describe)">
              <Button
                type="text"
                size="small"
                icon={<ExperimentOutlined style={{ color: '#d4a359', fontSize: iconFontSize }} />}
                onClick={() => {
                  onOpenSensoryExpand?.(selectionData)
                  window.getSelection()?.removeAllRanges()
                  setVisible(false)
                  setSelectionData(null)
                }}
                style={{ fontSize: tbFontSize, fontWeight: 500, height: btnHeight }}
              >
                五感扩写
              </Button>
            </Tooltip>

            <Tooltip title="在侧栏问 AI 并附带此选区上下文">
              <Button
                type="text"
                size="small"
                icon={<MessageOutlined style={{ color: '#2563eb', fontSize: iconFontSize }} />}
                onClick={() => handleAction('ask')}
                style={{ fontSize: tbFontSize, fontWeight: 500, height: btnHeight }}
              >
                问 AI
              </Button>
            </Tooltip>

            <Tooltip title="针对选中文字发起 AI 润色建议">
              <Button
                type="text"
                size="small"
                icon={<RocketOutlined style={{ color: '#7c3aed', fontSize: iconFontSize }} />}
                onClick={() => handleAction('polish')}
                style={{ fontSize: tbFontSize, fontWeight: 500, height: btnHeight }}
              >
                润色
              </Button>
            </Tooltip>

            <Tooltip title="针对选中文字提出修改意见与分析">
              <Button
                type="text"
                size="small"
                icon={<BulbOutlined style={{ color: '#d97706', fontSize: iconFontSize }} />}
                onClick={() => handleAction('advice')}
                style={{ fontSize: tbFontSize, fontWeight: 500, height: btnHeight }}
              >
                提意见
              </Button>
            </Tooltip>

            <Tooltip title="仅针对选中的这一段/这一句话发起 AI 诊断">
              <Button
                type="text"
                size="small"
                icon={<ThunderboltOutlined style={{ color: '#722ed1', fontSize: iconFontSize }} />}
                onClick={() => {
                  onStartSelectionProofread?.(selectionData)
                  window.getSelection()?.removeAllRanges()
                  setVisible(false)
                  setSelectionData(null)
                }}
                style={{ fontSize: tbFontSize, fontWeight: 600, height: btnHeight, color: '#722ed1' }}
              >
                选区校对
              </Button>
            </Tooltip>
          </>
        )}


      </Space>
    </div>
  )
}


