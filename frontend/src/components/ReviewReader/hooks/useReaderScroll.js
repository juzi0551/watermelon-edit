import { useCallback, useEffect, useRef, useImperativeHandle } from 'react'

export function useReaderScroll({
  ref,
  flowRef,
  project,
  paras,
  paraMapByIdx,
  chapters,
  selectedChapter,
  updatePos,
  updateManualEditPos,
  updateToolbarPos,
}) {
  const positionSavedRef = useRef(false)

  const jumpToParagraphExact = useCallback((targetIdx, offset = 0) => {
    const container = flowRef.current
    if (!container || targetIdx == null) return

    let el = container.querySelector(`[data-para="${targetIdx}"]`)
    if (!el && typeof targetIdx === 'number' && paraMapByIdx[targetIdx]) {
      const u = paraMapByIdx[targetIdx].uuid
      if (u) el = container.querySelector(`[data-para="${u}"]`)
    }
    if (el) {
      el.scrollIntoView({ behavior: 'auto', block: offset > 0 ? 'center' : 'start' })
    }
  }, [flowRef, paraMapByIdx])

  useImperativeHandle(ref, () => ({
    scrollToParagraph: (idx) => {
      jumpToParagraphExact(idx, 0)
    }
  }))

  const prevSelectedChapterRef = useRef(selectedChapter)
  useEffect(() => {
    if (!selectedChapter || !flowRef.current) return
    if (prevSelectedChapterRef.current === selectedChapter) return
    prevSelectedChapterRef.current = selectedChapter

    const ch = chapters?.find(c => c.id === selectedChapter)
    if (!ch) return
    const targetIdx = ch.title_paragraph_idx ?? ch.start_idx
    if (targetIdx == null) return

    jumpToParagraphExact(targetIdx, 0)
  }, [selectedChapter, chapters, jumpToParagraphExact, flowRef])

  useEffect(() => {
    const el = flowRef.current
    if (!el || paras.length === 0) return
    const key = `reading_scrolltop_${project?.id}`
    let timer = null
    let rafId = null

    const save = () => localStorage.setItem(key, el.scrollTop)
    const handler = () => {
      clearTimeout(timer)
      timer = setTimeout(save, 300)

      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = null
          updatePos?.()
          updateManualEditPos?.()
          updateToolbarPos?.()
        })
      }
    }
    el.addEventListener('scroll', handler, { passive: true })
    return () => {
      el.removeEventListener('scroll', handler)
      clearTimeout(timer)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [flowRef, paras.length, project?.id, updatePos, updateManualEditPos, updateToolbarPos])

  useEffect(() => {
    if (positionSavedRef.current || paras.length === 0 || !flowRef.current) return
    const saved = localStorage.getItem(`reading_scrolltop_${project?.id}`)
    if (saved == null) return
    positionSavedRef.current = true
    const el = flowRef.current
    requestAnimationFrame(() => {
      if (positionSavedRef.current && el) {
        el.scrollTop = Number(saved)
      }
    })
  }, [flowRef, paras.length, project?.id])

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
  }, [flowRef, paras.length, project?.id])

  return {
    jumpToParagraphExact,
    positionSavedRef,
  }
}
