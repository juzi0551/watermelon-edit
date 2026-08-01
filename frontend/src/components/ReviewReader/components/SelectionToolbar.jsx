import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Button, Space, Tooltip } from 'antd'
import { RocketOutlined, BulbOutlined, MessageOutlined } from '@ant-design/icons'

export function SelectionToolbar({ containerRef, paras, onAskAssistant, onSelectionChange }) {
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [selectionData, setSelectionData] = useState(null)
  const toolbarRef = useRef(null)

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

    // 在 paras 列表中匹对 rawVal (可能是 uuid，也可能是 idx)
    const match = (paras || []).find(
      (p) => String(p.uuid) === String(rawVal) || String(p.idx) === String(rawVal)
    )
    if (match) {
      return { idx: match.idx, uuid: match.uuid || match.idx }
    }

    // 兜底为数字尝试
    const numIdx = parseInt(rawVal, 10)
    if (!isNaN(numIdx)) {
      const matchByIdx = (paras || []).find((p) => p.idx === numIdx)
      return matchByIdx ? { idx: matchByIdx.idx, uuid: matchByIdx.uuid || matchByIdx.idx } : { idx: numIdx, uuid: rawVal }
    }

    return { idx: 1, uuid: rawVal }
  }, [paras])

  const updateSelectionState = useCallback(() => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      setVisible(false)
      setSelectionData(null)
      return
    }

    const text = selection.toString().trim()
    if (!text) {
      setVisible(false)
      setSelectionData(null)
      return
    }

    // 排除编辑态标签 (textarea, input)
    const anchorParent = selection.anchorNode?.parentElement
    const focusParent = selection.focusNode?.parentElement
    if (
      anchorParent?.closest('textarea, input') ||
      focusParent?.closest('textarea, input')
    ) {
      setVisible(false)
      setSelectionData(null)
      return
    }

    // 解析起点与终点段落
    const startPara = parseParaElement(selection.anchorNode)
    const endPara = parseParaElement(selection.focusNode)

    if (!startPara || !endPara) {
      setVisible(false)
      setSelectionData(null)
      return
    }

    const startIdx = Math.min(startPara.idx, endPara.idx)
    const endIdx = Math.max(startPara.idx, endPara.idx)
    const paraUuid = startPara.idx <= endPara.idx ? startPara.uuid : endPara.uuid

    // 智能切片判断与前后省略号格式化
    const targetPara = (paras || []).find((p) => p.idx === startIdx || String(p.uuid) === String(paraUuid))
    const fullText = (targetPara?.revised_text || targetPara?.text || '').trim()
    const isExcerpt = Boolean(startIdx === endIdx && fullText && text !== fullText)

    let formattedExcerpt = text
    if (isExcerpt && fullText) {
      const idxInFull = fullText.indexOf(text)
      const hasLeading = idxInFull > 0
      const hasTrailing = idxInFull >= 0 && (idxInFull + text.length < fullText.length)
      formattedExcerpt = `${hasLeading ? '…' : ''}${text}${hasTrailing ? '…' : ''}`
    }

    // 定位计算
    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    if (!containerRef?.current) return

    const containerRect = containerRef.current.getBoundingClientRect()

    // 浮条放置在选区正上方
    const top = rect.top - containerRect.top - 46
    const left = rect.left - containerRect.left + rect.width / 2

    setPosition({ top: Math.max(8, top), left })
    setSelectionData({
      selectedText: text,
      formattedExcerpt,
      isExcerpt,
      fullText,
      paragraphIdx: startIdx,
      paragraphEndIdx: startIdx !== endIdx ? endIdx : undefined,
      paragraphUuid: paraUuid,
    })
    setVisible(true)
  }, [containerRef, parseParaElement])

  useEffect(() => {
    const handleMouseUp = () => {
      setTimeout(updateSelectionState, 20)
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setVisible(false)
        setSelectionData(null)
      }
    }

    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [updateSelectionState])

  // 监听容器滚动与窗口缩放跟屏
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

  if (!visible || !selectionData) return null

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

    // 发起后取消当前划词浮条
    window.getSelection()?.removeAllRanges()
    setVisible(false)
    setSelectionData(null)
  }

  return (
    <div
      ref={toolbarRef}
      style={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        transform: 'translateX(-50%)',
        zIndex: 900,
        background: 'rgba(255, 255, 255, 0.92)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        padding: '4px 8px',
        borderRadius: 20,
        border: '1px solid rgba(217, 217, 217, 0.8)',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
        display: 'flex',
        alignItems: 'center',
        whiteSpace: 'nowrap',
        pointerEvents: 'auto',
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <Space size={2}>
        <Tooltip title="针对选中文字发起 AI 润色建议">
          <Button
            type="text"
            size="small"
            icon={<RocketOutlined style={{ color: '#7c3aed' }} />}
            onClick={() => handleAction('polish')}
            style={{ fontSize: 12, fontWeight: 500 }}
          >
            润色
          </Button>
        </Tooltip>

        <Tooltip title="针对选中文字提出修改意见与分析">
          <Button
            type="text"
            size="small"
            icon={<BulbOutlined style={{ color: '#d97706' }} />}
            onClick={() => handleAction('advice')}
            style={{ fontSize: 12, fontWeight: 500 }}
          >
            提意见
          </Button>
        </Tooltip>

        <Tooltip title="在侧栏问 AI 并附带此选区上下文">
          <Button
            type="text"
            size="small"
            icon={<MessageOutlined style={{ color: '#2563eb' }} />}
            onClick={() => handleAction('ask')}
            style={{ fontSize: 12, fontWeight: 500 }}
          >
            问 AI
          </Button>
        </Tooltip>
      </Space>
    </div>
  )
}
