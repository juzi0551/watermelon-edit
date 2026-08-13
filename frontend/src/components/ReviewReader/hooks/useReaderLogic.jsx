import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react'
import { message, Modal } from 'antd'
import { ExclamationCircleOutlined } from '@ant-design/icons'
import { fontSize } from '../../../design-tokens'
import { EMPTY_ARRAY } from '../constants'
import { parseEditNotes } from '../utils/readerUtils'
import {
  updateParagraph, updateParagraphNotes, deleteParagraph, togglePageBreak, setChapter,
  insertParagraph, mergeParagraphs, mergeMultipleParagraphs,
  getAnnotations, createAnnotation, updateAnnotation, deleteAnnotation,
} from '../../../services/api'

export function useReaderLogic({
  results,
  project,
  onSetStatus,
  onReloadProject,
  onInsertLocal,
  onSelectionChange,
  chapters = [],
  models = [],
  selectedModel,
  fontSizeOffset: propFontSizeOffset,
}) {
  // 1. 全量 useState 声明
  const [selectedId, setSelectedId] = useState(null)
  const [panelTab, setPanelTab] = useState('pending')
  const [customEdit, setCustomEdit] = useState('')
  const [editingIdx, setEditingIdx] = useState(null)
  const [editingText, setEditingText] = useState('')
  const [editingNote, setEditingNote] = useState('')
  const [selectedManualEditIdx, setSelectedManualEditIdx] = useState(null)
  const [localFontSizeOffset, setLocalFontSizeOffset] = useState(() => {
    try { return parseInt(localStorage.getItem('reader_font_offset') || '0', 10) } catch { return 0 }
  })
  const [savingPara, setSavingPara] = useState(false)
  const [activeIdx, setActiveIdx] = useState(null)
  const [editingCaretPos, setEditingCaretPos] = useState(null)
  const [showOriginalMap, setShowOriginalMap] = useState({})
  const [pbTooltipIdx, setPbTooltipIdx] = useState(null)
  const [showOptions, setShowOptions] = useState(false)
  const [flashSide, setFlashSide] = useState(null)
  const [showCheckboxes, setShowCheckboxes] = useState(false)
  const [showAllOriginals, setShowAllOriginals] = useState(false)
  const [mergeMode, setMergeMode] = useState(false)
  const [selectedMergeParas, setSelectedMergeParas] = useState(() => new Set())
  const [annotations, setAnnotations] = useState([])
  const [selectedAnnotationId, setSelectedAnnotationId] = useState(null)
  const [annotationModalOpen, setAnnotationModalOpen] = useState(false)
  const [annotationSelectionData, setAnnotationSelectionData] = useState(null)
  const [annotationPanelOpen, setAnnotationPanelOpen] = useState(false)

  // 2. 全量 useRef 声明
  const flowRef = useRef(null)
  const contentRef = useRef(null)
  const floatCardElRef = useRef(null)
  const manualCardElRef = useRef(null)
  const annotationCardElRef = useRef(null)
  const toolbarRef = useRef(null)
  const resultsRef = useRef(results)
  resultsRef.current = results
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const selectedManualEditIdxRef = useRef(selectedManualEditIdx)
  selectedManualEditIdxRef.current = selectedManualEditIdx
  const selectedAnnotationIdRef = useRef(selectedAnnotationId)
  selectedAnnotationIdRef.current = selectedAnnotationId
  const activeIdxRef = useRef(activeIdx)
  activeIdxRef.current = activeIdx
  const editingDataRef = useRef({ idx: null, text: '', note: '' })
  const autoSelectRef = useRef(false)
  const statusSubmittingRef = useRef(false)

  // 3. 计算派生属性
  const effectiveFontSizeOffset = propFontSizeOffset !== undefined ? propFontSizeOffset : localFontSizeOffset
  const currentBodyFontSize = fontSize.body + effectiveFontSizeOffset
  const tbFontSize = Math.min(Math.max(Math.round(currentBodyFontSize * 0.85), 14), 22)

  const errors = results?.errors || []
  const paras = results?.paragraphs || []
  const sortedParas = useMemo(() => [...paras].sort((a, b) => a.idx - b.idx), [paras])
  const paraIndexMap = useMemo(() => {
    const map = new Map()
    sortedParas.forEach((p, i) => map.set(p.idx, i))
    return map
  }, [sortedParas])

  const paraMap = useMemo(() => Object.fromEntries(paras.map(p => [p.uuid || p.idx, p])), [paras])
  const paraMapByIdx = useMemo(() => Object.fromEntries(paras.map(p => [p.idx, p])), [paras])

  const chaptersByParaIdx = useMemo(() => {
    const map = new Map()
    chapters.forEach(c => {
      if (c.title_paragraph_idx !== null && c.title_paragraph_idx !== undefined) {
        map.set(c.title_paragraph_idx, c)
      }
      if (c.title_paragraph_uuid) {
        map.set(c.title_paragraph_uuid, c)
      }
    })
    return map
  }, [chapters])

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
      const para = (e.paragraph_uuid && paraMap[e.paragraph_uuid]) || paraMapByIdx[e.paragraph_index]
      if (!para || !para.text || (e.original_text && para.text.indexOf(e.original_text) < 0)) {
        ids.add(e.id)
      }
    })
    return ids
  }, [errors, paraMap, paraMapByIdx])

  const errorsByParaIdx = useMemo(() => {
    const map = new Map()
    activeErrors.forEach(e => {
      const key = e.paragraph_uuid || e.paragraph_index
      const list = map.get(key)
      if (list) list.push(e)
      else map.set(key, [e])
    })
    return map
  }, [activeErrors])

  const handleCheckboxToggle = useCallback((paraKey) => {
    onSelectionChange?.((prev) => {
      const next = new Set(prev || [])
      if (next.has(paraKey)) next.delete(paraKey)
      else next.add(paraKey)
      return next
    })
  }, [onSelectionChange])

  const handleCancelEdit = useCallback(() => {
    setEditingIdx(null)
    setEditingCaretPos(null)
    editingDataRef.current = { idx: null, text: '', note: '' }
  }, [])

  // 编辑过程中，段落编辑器实时上报当前文本/备注到 ref，供“点击其他处自动保存”读取
  const handleEditingValueChange = useCallback((idx, text, note) => {
    editingDataRef.current = { idx, text, note }
  }, [])

  const handleToggleOriginal = useCallback((paraIdx) => {
    setShowOriginalMap(prev => ({ ...prev, [paraIdx]: !prev[paraIdx] }))
  }, [])

  useEffect(() => { activeIdxRef.current = activeIdx }, [activeIdx])

  const dismissToolbar = useCallback(() => {
    setActiveIdx(null)
  }, [])

  const updateToolbarPos = useCallback(() => {
    const el = toolbarRef.current
    if (!el || activeIdx == null) return
    const container = flowRef.current
    if (!container) return
    const activePara = sortedParas.find(p => p.idx === activeIdx)
    if (!activePara) return
    const key = activePara.uuid || activePara.idx
    const paraEl = container.querySelector(`[data-para="${key}"]`)
    if (!paraEl) return
    const h = el.offsetHeight || 36
    const paraStyle = getComputedStyle(paraEl)
    const padTop = parseFloat(paraStyle.paddingTop) || 0
    const padBottom = parseFloat(paraStyle.paddingBottom) || 0
    const borderTop = parseFloat(paraStyle.borderTopWidth) || 0
    const borderBottom = parseFloat(paraStyle.borderBottomWidth) || 0

    const aboveTop = paraEl.offsetTop + borderTop + padTop - h - 0.5
    // 若工具条放到段落上方会超出可视区顶部（如第一段被遮挡），则改放段落下方
    const paraRect = paraEl.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const roomAbove = paraRect.top - h - 0.5 >= containerRect.top + 4
    el.style.top = roomAbove
      ? `${aboveTop}px`
      : `${paraEl.offsetTop + paraEl.offsetHeight - borderBottom - padBottom + 6}px`

    const textDiv = paraEl.querySelector('div:last-child')
    if (textDiv) {
      const indentPx = parseFloat(getComputedStyle(textDiv).textIndent) || 0
      el.style.left = `${paraEl.offsetLeft + textDiv.offsetLeft + indentPx}px`
    }
  }, [activeIdx, sortedParas, tbFontSize])

  useLayoutEffect(() => {
    updateToolbarPos()
  }, [activeIdx, editingIdx, mergeMode, updateToolbarPos])

  useEffect(() => {
    if (propFontSizeOffset !== undefined) {
      localStorage.setItem('reader_font_offset', String(propFontSizeOffset))
    }
  }, [propFontSizeOffset])

  const selectedManualEditPara = useMemo(() => {
    if (!selectedManualEditIdx) return null
    return sortedParas.find(p => p.idx === selectedManualEditIdx) || null
  }, [sortedParas, selectedManualEditIdx])

  const handleSaveManualEditNote = useCallback(async (idx, textVal, note) => {
    const p = sortedParas.find(item => item.idx === idx)
    await updateParagraph(project.id, idx, textVal, note, p?.uuid)
    onReloadProject?.()
  }, [project?.id, sortedParas, onReloadProject])

  const handleDeleteNoteItem = useCallback(async (idx, updatedNotes) => {
    const p = sortedParas.find(item => item.idx === idx)
    await updateParagraphNotes(project.id, idx, updatedNotes, p?.uuid)
    if (p) {
      p.edit_note = JSON.stringify(updatedNotes)
    }
    onReloadProject?.()
  }, [project?.id, sortedParas, onReloadProject])

  const handleRevertManualEdit = useCallback(async (idx) => {
    const p = sortedParas.find(item => item.idx === idx)
    if (p) {
      await updateParagraph(project.id, idx, p.text, null, p.uuid)
      setSelectedManualEditIdx(null)
      message.success('已恢复初始原文')
      onReloadProject?.()
    }
  }, [project?.id, sortedParas, onReloadProject])

  const fetchAnnotations = useCallback(async () => {
    if (!project?.id) return
    try {
      const data = await getAnnotations(project.id)
      setAnnotations(data || [])
    } catch { /* noop */ }
  }, [project?.id])

  useEffect(() => {
    fetchAnnotations()
  }, [fetchAnnotations])

  const selectedAnnotation = useMemo(() => {
    if (!selectedAnnotationId) return null
    return annotations.find(a => String(a.id) === String(selectedAnnotationId)) || null
  }, [annotations, selectedAnnotationId])

  const annotationNumIndex = useMemo(() => {
    if (!selectedAnnotation) return 1
    const idx = annotations.findIndex(a => String(a.id) === String(selectedAnnotation.id))
    return idx >= 0 ? idx + 1 : 1
  }, [annotations, selectedAnnotation])

  const handleOpenAnnotationModal = useCallback((selectionData) => {
    setAnnotationSelectionData(selectionData)
    setAnnotationModalOpen(true)
  }, [])

  const handleCreateAnnotation = useCallback(async ({ selectedText, paragraphIdx, paragraphUuid, content }) => {
    if (!project?.id) return
    await createAnnotation(project.id, {
      paragraphIdx,
      paragraphUuid,
      selectedText,
      content,
    })
    message.success('已添加划线注释')
    setAnnotationModalOpen(false)
    setAnnotationSelectionData(null)
    await fetchAnnotations()
  }, [project?.id, fetchAnnotations])

  const handleSelectAnnotation = useCallback((id) => {
    setActiveIdx(null)
    setSelectedId(null)
    setSelectedManualEditIdx(null)
    setSelectedAnnotationId(prev => String(prev) === String(id) ? null : id)
  }, [])

  const handleUpdateAnnotationSubmit = useCallback(async (annotId, content) => {
    if (!project?.id) return
    await updateAnnotation(project.id, annotId, content)
    await fetchAnnotations()
  }, [project?.id, fetchAnnotations])

  const handleDeleteAnnotationSubmit = useCallback(async (annotId) => {
    if (!project?.id) return
    await deleteAnnotation(project.id, annotId)
    setSelectedAnnotationId(null)
    await fetchAnnotations()
  }, [project?.id, fetchAnnotations])

  const handleSelectionChange = useCallback((isSelected) => {
    if (isSelected) {
      // 互斥：划选文本时，自动取消段落选中与段落悬浮工具条
      setActiveIdx(null)
    }
  }, [])

  const handleParaClick = useCallback((e, paraIdx) => {
    e.stopPropagation()
    // 互斥：若当前包含鼠标划选文本，则不选中段落、不唤起段落工具条
    const selText = window.getSelection()?.toString().trim()
    if (selText && selText.length > 0) {
      setActiveIdx(null)
      return
    }
    // 互斥：唤起段落工具条时，自动关闭任意浮动详情卡片
    setSelectedId(null)
    setSelectedManualEditIdx(null)
    setSelectedAnnotationId(null)
    if (activeIdxRef.current === paraIdx) {
      dismissToolbar()
    } else {
      setActiveIdx(paraIdx)
    }
  }, [dismissToolbar])

  const handleStartEdit = useCallback((para, caretPos = null) => {
    // 互斥：进入编辑态时，自动关闭段落工具条与各类浮动卡片
    setActiveIdx(null)
    setSelectedId(null)
    setSelectedManualEditIdx(null)
    setSelectedAnnotationId(null)
    setEditingIdx(para.idx)
    setEditingText(para.revised_text ?? para.text ?? '')
    setEditingNote('')
    setEditingCaretPos(caretPos)
    editingDataRef.current = { idx: para.idx, text: para.revised_text ?? para.text ?? '', note: '' }
  }, [])

  const handleSelectError = useCallback((id) => {
    // 互斥：唤起/切换错词卡片时，自动关闭段落工具条与注释卡片
    setActiveIdx(null)
    setSelectedManualEditIdx(null)
    setSelectedAnnotationId(null)
    setSelectedId(prev => prev === id ? null : id)
  }, [])

  const handleSelectObsoleteError = useCallback((id, jumpFn) => {
    // 互斥：唤起历史作废卡片时，自动关闭段落工具条与注释卡片
    setActiveIdx(null)
    setSelectedManualEditIdx(null)
    setSelectedAnnotationId(null)
    setSelectedId(id)
    const err = flatErrors.find(e => e.id === id)
    if (err) {
      jumpFn?.(err.paragraph_uuid || err.paragraph_index)
    }
  }, [flatErrors])

  const handleSelectManualEdit = useCallback((idx) => {
    // 互斥：唤起手修履历卡片时，自动关闭段落工具条与注释卡片
    setActiveIdx(null)
    setSelectedId(null)
    setSelectedAnnotationId(null)
    setSelectedManualEditIdx(prev => prev === idx ? null : idx)
  }, [])

  const handleSaveEdit = useCallback(async (paraIdx, textVal, noteVal) => {
    if (!project?.id) return
    setSavingPara(true)
    const finalNote = noteVal?.trim() || null
    const finalText = textVal
    const targetPara = sortedParas.find(item => item.idx === paraIdx)
    const pUuid = targetPara?.uuid
    try {
      await updateParagraph(project.id, paraIdx, finalText, finalNote, pUuid)
      if (targetPara) {
        if (!targetPara.text && !targetPara.revised_text) {
          targetPara.text = finalText
          targetPara.revised_text = null
          targetPara.edit_note = finalNote || null
        } else {
          targetPara.edit_note = finalNote
          targetPara.revised_text = (targetPara.text === finalText) ? null : finalText
        }
      }
      message.success('段落已更新')
      setEditingIdx(null)
      setEditingText('')
      setEditingNote('')
      setEditingCaretPos(null)
      editingDataRef.current = { idx: null, text: '', note: '' }
      onReloadProject?.()
    } catch (e) {
      message.error(e.message || '更新失败')
    } finally {
      setSavingPara(false)
    }
  }, [project?.id, sortedParas, onReloadProject])

  // 点击其他段落或页面其它位置时，退出编辑态并自动保存当前段落
  const handleAutoSave = useCallback((idx, textVal, noteVal) => {
    const targetPara = sortedParas.find(p => p.idx === idx)
    editingDataRef.current = { idx: null, text: '', note: '' }
    if (!targetPara) {
      setEditingIdx(null)
      setEditingCaretPos(null)
      return
    }
    const curText = targetPara.revised_text ?? targetPara.text ?? ''
    const textChanged = textVal !== curText
    const noteChanged = !!noteVal?.trim()
    if (!textChanged && !noteChanged) {
      setEditingIdx(null)
      setEditingText('')
      setEditingNote('')
      setEditingCaretPos(null)
      return
    }
    handleSaveEdit(idx, textVal, noteVal)
  }, [sortedParas, handleSaveEdit])

  useEffect(() => {
    const onDocMouseDown = (e) => {
      const cur = editingDataRef.current
      if (cur.idx == null) return
      let withinEditing = false
      try {
        const editingPara = sortedParas.find(p => p.idx === cur.idx)
        if (editingPara && e.target && e.target.closest) {
          const key = editingPara.uuid || editingPara.idx
          withinEditing = !!e.target.closest(`[data-para="${key}"]`)
        }
      } catch { /* noop */ }
      if (withinEditing) return
      handleAutoSave(cur.idx, cur.text, cur.note)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [sortedParas, handleAutoSave])

  const handleDeletePara = useCallback((para) => {
    if (!project?.id) return
    const isBlank = (!para.text || para.text.trim() === '') && (!para.revised_text || para.revised_text.trim() === '')
    if (isBlank) {
      deleteParagraph(project.id, para.idx, para.uuid).then(() => {
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
          await deleteParagraph(project.id, para.idx, para.uuid)
          message.success('段落已删除')
          onReloadProject?.()
        } catch (e) {
          message.error(e.message || '删除失败')
        }
      },
    })
  }, [project, onReloadProject])

  const handleTogglePageBreak = useCallback(async (para) => {
    if (!project?.id) return
    const curType = para.page_break_type || (para.has_page_break_before === 1 ? 'original' : 'none')
    const hasHardBreak = curType === 'original' || curType === 'manual'
    const nextType = hasHardBreak ? 'none' : 'manual'

    para.page_break_type = nextType
    para.has_page_break_before = nextType !== 'none' ? 1 : 0
    setPbTooltipIdx(null)

    try {
      await togglePageBreak(project.id, para.idx, nextType, para.uuid)
      message.success(nextType !== 'none' ? '已增加人工硬分页' : '已移除硬分页')
      onReloadProject?.()
    } catch (e) {
      para.page_break_type = curType
      para.has_page_break_before = hasHardBreak ? 1 : 0
      message.error(e.message || '操作失败')
    }
  }, [project?.id, onReloadProject])

  const handleSetChapter = useCallback(async (para, level = 2, isRemove = false) => {
    if (!project?.id) return
    try {
      if (isRemove) {
        await setChapter(project.id, para.idx, false, 0, null, para.uuid)
        message.success('已取消章节标题标记')
      } else {
        const titleText = (para.revised_text || para.text || '').trim()
        await setChapter(project.id, para.idx, true, level, titleText, para.uuid)
        message.success(`已设定为 ${level}级 章节标题`)
      }
      dismissToolbar()
      onReloadProject?.()
    } catch (e) {
      message.error(e.message || '设定章节失败')
    }
  }, [project?.id, dismissToolbar, onReloadProject])

  const handleInsertPara = useCallback(async (targetPara, position = 'below') => {
    if (!project?.id) return
    dismissToolbar()
    try {
      const res = await insertParagraph(project.id, targetPara.idx, position, '', targetPara.uuid)
      if (res?.error) {
        message.error(res.error)
        return
      }
      if (res?.idx == null) {
        message.error('插入段落失败，请稍后重试')
        return
      }
      message.success(position === 'above' ? '已在上方插入新段落' : '已在下方插入新段落')

      // 本地乐观更新：平移段落/错误/章节索引并插入新空段，立即进入编辑态，避免全量重载卡顿与"先显示原文再清空"闪屏
      const targetIdx = res.idx
      const newPara = {
        id: `${targetPara.document_id || ''}:${targetIdx}`,
        uuid: res.uuid,
        document_id: targetPara.document_id,
        idx: targetIdx,
        text: '',
        revised_text: null,
        style_name: targetPara.style_name || 'Normal',
        char_count: 0,
        has_page_break_before: 0,
        page_break_type: 'none',
        edit_note: null,
        is_deleted: 0,
        merged_into_uuid: null,
        source: 'original',
      }
      onInsertLocal?.(newPara, targetIdx)

      setEditingIdx(targetIdx)
      setEditingText('')
      setEditingNote('')
      editingDataRef.current = { idx: targetIdx, text: '', note: '' }

      setTimeout(() => {
        const container = flowRef.current
        if (container) {
          const el = container.querySelector(`[data-para="${res?.uuid || targetIdx}"]`)
          if (el) {
            el.scrollIntoView({ block: 'center', behavior: 'smooth' })
            const textarea = el.querySelector('textarea')
            if (textarea) {
              textarea.focus()
            }
          }
        }
      }, 120)
    } catch (e) {
      message.error(e.message || '插入段落失败')
    }
  }, [project?.id, dismissToolbar, onInsertLocal])

  const handleEnterMergeMode = useCallback((startPara) => {
    setMergeMode(true)
    const seedKey = startPara.uuid || startPara.idx
    setSelectedMergeParas(new Set([seedKey]))
    dismissToolbar()
  }, [dismissToolbar])

  const handleExitMergeMode = useCallback(() => {
    setMergeMode(false)
    setSelectedMergeParas(new Set())
  }, [])

  const handleToggleMergeSelect = useCallback((para) => {
    const key = para.uuid || para.idx
    setSelectedMergeParas(prev => {
      const next = new Set(prev)
      const isPresent = next.has(key) || (para.uuid && next.has(para.uuid)) || (para.idx != null && next.has(para.idx))

      if (isPresent) {
        if (next.size <= 1) return prev
        const remainingIdxs = []
        next.forEach(k => {
          if (k !== key && k !== para.uuid && k !== para.idx) {
            const p = paraMap[k] ?? paraMapByIdx[k]
            if (p) remainingIdxs.push(p.idx)
          }
        })
        remainingIdxs.sort((a, b) => a - b)
        const isContiguous = remainingIdxs.every((val, i) => i === 0 || val === remainingIdxs[i - 1] + 1)
        if (!isContiguous) return prev
        next.delete(key)
        if (para.uuid) next.delete(para.uuid)
        if (para.idx != null) next.delete(para.idx)
      } else {
        const prevKey = sortedParas[para.idx - 1]?.uuid ?? (para.idx - 1)
        const nextKey = sortedParas[para.idx + 1]?.uuid ?? (para.idx + 1)
        const hasPrev = next.has(prevKey) || next.has(para.idx - 1)
        const hasNext = next.has(nextKey) || next.has(para.idx + 1)

        if (!hasPrev && !hasNext) {
          message.warning('只能选择与已选段落连续相邻的段落')
          return prev
        }
        next.add(key)
      }
      return next
    })
  }, [paraMap, paraMapByIdx, sortedParas])

  const handleConfirmMergeBatch = useCallback(() => {
    if (!project?.id) return
    const selectedParasArr = []
    selectedMergeParas.forEach(k => {
      const p = paraMap[k] ?? paraMapByIdx[k]
      if (p) selectedParasArr.push(p)
    })

    if (selectedParasArr.length <= 1) return

    selectedParasArr.sort((a, b) => a.idx - b.idx)
    const targetUuids = selectedParasArr.map(p => p.uuid || p.idx)

    Modal.confirm({
      title: `确认合并选中的 ${selectedParasArr.length} 个段落？`,
      icon: <ExclamationCircleOutlined style={{ color: '#faad14' }} />,
      content: `将依次合并第 ${selectedParasArr[0].idx + 1} 段 至 第 ${selectedParasArr[selectedParasArr.length - 1].idx + 1} 段。合并后文本无缝连结，标注与履历完整保留。`,
      okText: `确认合并 (${selectedParasArr.length} 段)`,
      cancelText: '取消',
      onOk: async () => {
        const savedTop = flowRef.current?.scrollTop
        try {
          await mergeMultipleParagraphs(project.id, targetUuids, '')
          message.success(`已成功合并 ${selectedParasArr.length} 个段落`)
          handleExitMergeMode()
          await onReloadProject?.()
        } catch (e) {
          message.error(e.message || '多段合并失败')
        } finally {
          if (savedTop != null && flowRef.current) {
            requestAnimationFrame(() => {
              if (flowRef.current) flowRef.current.scrollTop = savedTop
            })
          }
        }
      },
    })
  }, [project?.id, selectedMergeParas, paraMap, paraMapByIdx, handleExitMergeMode, onReloadProject])

  const selectedError = useMemo(
    () => flatErrors.find(e => String(e.id) === String(selectedId)),
    [flatErrors, selectedId],
  )

  const allDone = pending.length === 0 && flatErrors.length > 0
  const selIsPending = selectedError?.user_status === 'pending'

  useEffect(() => {
    if (selectedError && selIsPending) {
      setCustomEdit(selectedError.suggested_text)
    }
  }, [selectedError?.id, selIsPending])

  const handleStatus = useCallback((status) => {
    if (!selectedId || statusSubmittingRef.current) return
    statusSubmittingRef.current = true
    setTimeout(() => { statusSubmittingRef.current = false }, 150)
    const curId = selectedId
    const custom = status === 'accepted' && customEdit !== selectedError?.suggested_text
      ? customEdit : undefined

    const idx = pending.findIndex(e => String(e.id) === String(curId))
    if (idx >= 0 && idx + 1 < pending.length) {
      setSelectedId(pending[idx + 1].id)
    } else if (idx > 0) {
      setSelectedId(pending[idx - 1].id)
    } else {
      setSelectedId(null)
    }

    onSetStatus(curId, status, custom).catch(() => {
      message.error('操作保存失败，请刷新重试')
    })
  }, [selectedId, customEdit, selectedError?.suggested_text, pending, onSetStatus])

  return {
    selectedId, setSelectedId,
    panelTab, setPanelTab,
    customEdit, setCustomEdit,
    editingIdx, setEditingIdx,
    editingText, setEditingText,
    editingNote, setEditingNote,
    selectedManualEditIdx, setSelectedManualEditIdx,
    fontSizeOffset: effectiveFontSizeOffset,
    savingPara, setSavingPara,
    activeIdx, setActiveIdx,
    editingCaretPos, setEditingCaretPos,
    showOriginalMap, setShowOriginalMap,
    pbTooltipIdx, setPbTooltipIdx,
    showOptions, setShowOptions,
    flashSide, setFlashSide,
    showCheckboxes, setShowCheckboxes,
    showAllOriginals, setShowAllOriginals,
    mergeMode, setMergeMode,
    selectedMergeParas, setSelectedMergeParas,
    flowRef,
    contentRef,
    floatCardElRef,
    manualCardElRef,
    toolbarRef,
    resultsRef,
    selectedIdRef,
    selectedManualEditIdxRef,
    activeIdxRef,
    autoSelectRef,
    statusSubmittingRef,
    currentBodyFontSize,
    tbFontSize,
    errors,
    paras,
    sortedParas,
    paraIndexMap,
    paraMap,
    paraMapByIdx,
    chaptersByParaIdx,
    flatErrors,
    activeErrors,
    obsolete,
    errorParaIdxs,
    pending,
    accepted,
    rejected,
    unmatchedIds,
    errorsByParaIdx,
    handleCheckboxToggle,
    handleCancelEdit,
    handleToggleOriginal,
    dismissToolbar,
    updateToolbarPos,
    selectedManualEditPara,
    handleSaveManualEditNote,
    handleDeleteNoteItem,
    handleRevertManualEdit,
    handleParaClick,
    handleSelectionChange,
    handleStartEdit,
    handleSelectError,
    handleSelectObsoleteError,
    handleSelectManualEdit,
    handleSaveEdit,
    handleEditingValueChange,
    handleDeletePara,
    handleTogglePageBreak,
    handleSetChapter,
    handleInsertPara,
    handleEnterMergeMode,
    handleExitMergeMode,
    handleToggleMergeSelect,
    handleConfirmMergeBatch,
    selectedError,
    allDone,
    selIsPending,
    handleStatus,
    annotations, setAnnotations,
    selectedAnnotationId, setSelectedAnnotationId,
    selectedAnnotation,
    annotationNumIndex,
    annotationModalOpen, setAnnotationModalOpen,
    annotationSelectionData,
    annotationPanelOpen, setAnnotationPanelOpen,
    annotationCardElRef,
    handleOpenAnnotationModal,
    handleCreateAnnotation,
    handleSelectAnnotation,
    handleUpdateAnnotationSubmit,
    handleDeleteAnnotationSubmit,
  }
}
