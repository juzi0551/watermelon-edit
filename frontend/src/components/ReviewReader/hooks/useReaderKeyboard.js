import { useEffect } from 'react'
import { message } from 'antd'

export function useReaderKeyboard({
  flatErrors,
  pending,
  selectedIdRef,
  setSelectedId,
  selectedManualEditIdxRef,
  setSelectedManualEditIdx,
  handleStatus,
  setFlashSide,
  inProgress,
  proofreading,
  onStartProofread,
  mergeMode,
  handleExitMergeMode,
  floatCardElRef,
  manualCardElRef,
  dismissToolbar,
}) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        if (mergeMode) {
          e.preventDefault()
          handleExitMergeMode?.()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mergeMode, handleExitMergeMode])

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
      setFlashSide?.(side)
      setTimeout(() => setFlashSide?.(null), 200)
      handleStatus?.(side)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [flatErrors, handleStatus, inProgress, proofreading, pending, onStartProofread, selectedIdRef, setSelectedId, setFlashSide])

  useEffect(() => {
    const handleGlobalClick = (e) => {
      if (!e.target.closest('[data-para]') && !e.target.closest('.ant-dropdown') && !e.target.closest('.ant-modal-root')) {
        dismissToolbar?.()
      }
    }
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        dismissToolbar?.()
      }
    }
    window.addEventListener('click', handleGlobalClick)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('click', handleGlobalClick)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [dismissToolbar])

  // 点击卡片外部非输入框区域，自动关闭浮动卡片
  useEffect(() => {
    const handlePointerDown = (e) => {
      // 1. 点击在卡片内部，不关闭
      if (floatCardElRef?.current && floatCardElRef.current.contains(e.target)) return
      if (manualCardElRef?.current && manualCardElRef.current.contains(e.target)) return

      // 2. 点击在输入框、文本域、下拉选择器或弹层内部，不关闭
      const tag = e.target?.tagName
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        e.target?.isContentEditable ||
        e.target?.closest?.('input, textarea, .ant-popover, .ant-select-dropdown, .ant-modal, .ant-picker-dropdown')
      ) {
        return
      }

      // 3. 点击在段落内问题高亮或手动修改触发标签上，不关闭
      if (e.target?.closest?.('[data-error-id], [data-manual-edit]')) return

      // 4. 点击卡片外部非输入框区域，自动关闭卡片
      if (selectedIdRef?.current) setSelectedId(null)
      if (selectedManualEditIdxRef?.current) setSelectedManualEditIdx(null)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [floatCardElRef, manualCardElRef, selectedIdRef, selectedManualEditIdxRef, setSelectedId, setSelectedManualEditIdx])
}
