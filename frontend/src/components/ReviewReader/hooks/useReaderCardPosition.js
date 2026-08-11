import { useCallback, useRef, useEffect, useLayoutEffect } from 'react'

export function useReaderCardPosition({
  flowRef,
  floatCardElRef,
  manualCardElRef,
  annotationCardElRef,
  selectedId,
  selectedManualEditIdx,
  selectedAnnotationId,
  flatErrors,
  annotations,
  results,
}) {
  const spanCacheRef = useRef(new Map())

  useEffect(() => {
    spanCacheRef.current.clear()
  }, [results, annotations])
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const selectedAnnotationIdRef = useRef(selectedAnnotationId)
  selectedAnnotationIdRef.current = selectedAnnotationId

  const updatePos = useCallback(() => {
    const container = flowRef.current
    const el = floatCardElRef.current
    if (!container || !el || !selectedId) return
    const id = selectedIdRef.current
    const err = flatErrors.find(e => String(e.id) === String(id))
    if (!err || err.is_obsolete === 1) {
      el.style.opacity = '0'
      el.style.transform = 'translateY(3px)'
      return
    }
    const strId = String(selectedId)
    const cacheKey = `err_${strId}`
    let span = spanCacheRef.current.get(cacheKey)

    if (!span || !span.isConnected) {
      span = null
      const paraKey = err.paragraph_uuid || err.paragraph_index
      if (paraKey != null) {
        const paraEl = container.querySelector(`[data-para="${paraKey}"]`)
        if (paraEl) {
          span = Array.from(paraEl.querySelectorAll('[data-error-id]')).find(s => s.dataset.errorId.split(',').includes(strId))
        }
      }
      if (!span) {
        span = Array.from(container.querySelectorAll('[data-error-id]')).find(s => s.dataset.errorId.split(',').includes(strId))
      }
      if (span) {
        spanCacheRef.current.set(cacheKey, span)
      }
    }

    if (!span) {
      el.style.opacity = '0'
      el.style.transform = 'translateY(3px)'
      return
    }

    const rect = span.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()

    const inView = rect.bottom >= containerRect.top && rect.top <= containerRect.bottom
    if (!inView) {
      el.style.opacity = '0'
      el.style.transform = 'translateY(3px)'
      return
    }

    const cardW = el.offsetWidth || el.getBoundingClientRect().width || 380
    const cardH = el.offsetHeight || el.getBoundingClientRect().height || 170

    const bottomBarHeight = 84
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

    const maxRight = Math.min(window.innerWidth - 24, containerRect.right - 12)
    let left = rect.left
    if (left + cardW > maxRight) {
      left = Math.max(containerRect.left + 12, maxRight - cardW)
    }

    el.style.top = `${top}px`
    el.style.left = `${left}px`
    el.style.opacity = '1'
    el.style.transform = 'translateY(0)'
  }, [flowRef, floatCardElRef, selectedId, flatErrors])

  const updateManualEditPos = useCallback(() => {
    const container = flowRef.current
    const el = manualCardElRef.current
    if (!container || !el || !selectedManualEditIdx) return

    const key = `manual_${selectedManualEditIdx}`
    let span = spanCacheRef.current.get(key)

    if (!span || !span.isConnected) {
      span = null
      const paras = results?.paragraphs || []
      const targetPara = paras.find(
        (p) => p.idx === selectedManualEditIdx || String(p.uuid) === String(selectedManualEditIdx)
      )

      if (targetPara) {
        if (targetPara.uuid) {
          span =
            container.querySelector(`[data-para="${targetPara.uuid}"] [data-manual-edit="true"]`) ||
            container.querySelector(`[data-para="${targetPara.uuid}"]`)
        }
        if (!span && targetPara.idx != null) {
          span =
            container.querySelector(`[data-para="${targetPara.idx}"] [data-manual-edit="true"]`) ||
            container.querySelector(`[data-para="${targetPara.idx}"]`)
        }
      }

      if (!span) {
        span =
          container.querySelector(`[data-para="${selectedManualEditIdx}"]`) ||
          container.querySelector(`[data-manual-edit="true"]`)
      }

      if (span) {
        spanCacheRef.current.set(key, span)
      }
    }

    if (!span) {
      el.style.opacity = '0'
      el.style.transform = 'translateY(3px)'
      return
    }

    const rect = span.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()

    const inView = rect.bottom >= containerRect.top && rect.top <= containerRect.bottom
    if (!inView) {
      el.style.opacity = '0'
      el.style.transform = 'translateY(3px)'
      return
    }

    const cardW = el.offsetWidth || el.getBoundingClientRect().width || 400
    const cardH = el.offsetHeight || el.getBoundingClientRect().height || 220
    const minTop = containerRect.top + 8
    const maxBottom = window.innerHeight - 84

    let top = rect.bottom + 6
    if (top + cardH > maxBottom) {
      const topSpace = rect.top - minTop
      if (topSpace >= cardH + 6) {
        top = rect.top - cardH - 6
      } else {
        top = Math.max(minTop, maxBottom - cardH)
      }
    }

    const maxRight = Math.min(window.innerWidth - 24, containerRect.right - 12)
    let left = rect.left
    if (left + cardW > maxRight) {
      left = Math.max(containerRect.left + 12, maxRight - cardW)
    }

    el.style.top = `${top}px`
    el.style.left = `${left}px`
    el.style.opacity = '1'
    el.style.transform = 'translateY(0)'
  }, [flowRef, manualCardElRef, selectedManualEditIdx, results])

  const updateAnnotationPos = useCallback(() => {
    const container = flowRef.current
    const el = annotationCardElRef?.current
    if (!container || !el || !selectedAnnotationId) return

    const strId = String(selectedAnnotationIdRef.current)
    const ann = annotations?.find(a => String(a.id) === strId)
    const key = `annot_${strId}`
    let span = spanCacheRef.current.get(key)

    if (!span || !span.isConnected) {
      span = null
      if (ann) {
        const paraKey = ann.paragraph_uuid || ann.paragraph_idx
        if (paraKey != null) {
          const paraEl = container.querySelector(`[data-para="${paraKey}"]`)
          if (paraEl) {
            span = Array.from(paraEl.querySelectorAll('[data-annotation-id]')).find(
              s => s.dataset.annotationId && s.dataset.annotationId.split(',').includes(strId)
            )
          }
        }
      }
      if (!span) {
        span = Array.from(container.querySelectorAll('[data-annotation-id]')).find(
          s => s.dataset.annotationId && s.dataset.annotationId.split(',').includes(strId)
        )
      }
      if (span) {
        spanCacheRef.current.set(key, span)
      }
    }

    if (!span) {
      el.style.opacity = '0'
      el.style.transform = 'translateY(3px)'
      return
    }

    const rect = span.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()

    const inView = rect.bottom >= containerRect.top && rect.top <= containerRect.bottom
    if (!inView) {
      el.style.opacity = '0'
      el.style.transform = 'translateY(3px)'
      return
    }

    const cardW = el.offsetWidth || el.getBoundingClientRect().width || 380
    const cardH = el.offsetHeight || el.getBoundingClientRect().height || 180
    const minTop = Math.max(8, containerRect.top + 8)
    const maxBottom = window.innerHeight - 84

    let top = rect.bottom + 6
    if (top + cardH > maxBottom) {
      const topSpace = rect.top - minTop
      if (topSpace >= cardH + 6) {
        top = rect.top - cardH - 6
      } else {
        top = Math.max(minTop, maxBottom - cardH)
      }
    }

    const maxRight = Math.min(window.innerWidth - 24, containerRect.right - 12)
    let left = rect.left
    if (left + cardW > maxRight) {
      left = Math.max(containerRect.left + 12, maxRight - cardW)
    }

    el.style.top = `${top}px`
    el.style.left = `${left}px`
    el.style.opacity = '1'
    el.style.transform = 'translateY(0)'
  }, [flowRef, annotationCardElRef, selectedAnnotationId, annotations])

  useLayoutEffect(() => {
    updatePos()
  }, [selectedId, results, updatePos])

  useLayoutEffect(() => {
    updateManualEditPos()
  }, [selectedManualEditIdx, updateManualEditPos])

  useLayoutEffect(() => {
    updateAnnotationPos()
  }, [selectedAnnotationId, annotations, updateAnnotationPos])

  return {
    spanCacheRef,
    updatePos,
    updateManualEditPos,
    updateAnnotationPos,
  }
}

