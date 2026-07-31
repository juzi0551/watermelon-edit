import React, { forwardRef, useEffect } from 'react'
import { Card, Empty } from 'antd'
import { color } from '../../design-tokens'
import { useReaderLogic } from './hooks/useReaderLogic'
import { useReaderCardPosition } from './hooks/useReaderCardPosition'
import { useReaderScroll } from './hooks/useReaderScroll'
import { useReaderKeyboard } from './hooks/useReaderKeyboard'
import { ReaderContentArea } from './components/ReaderContentArea'
import { ErrorSidebar } from './components/ErrorSidebar'
import { ActionBar } from './components/ActionBar'
import { FloatCardLayer } from './components/FloatCardLayer'

export function ReviewReaderInner({
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
  onStartBatchProofread, batchInfo = null, batchPolling = false, onRetryWindow, retryingWindow = null,
  batchMaxConcurrent = 2, onBatchMaxConcurrentChange,
  proofreadWindowSize = 30, onWindowSizeChange,
  onBodyFontSizeChange,
  fontSizeOffset,
}, ref) {
  const logic = useReaderLogic({
    results,
    project,
    onSetStatus,
    onReloadProject,
    onSelectionChange,
    chapters,
    models,
    selectedModel,
    fontSizeOffset,
  })

  // 同步正文字号变化至外层容器（供 AI 助手等关联组件联动）
  useEffect(() => {
    onBodyFontSizeChange?.(logic.currentBodyFontSize)
  }, [logic.currentBodyFontSize, onBodyFontSizeChange])

  const { spanCacheRef, updatePos, updateManualEditPos } = useReaderCardPosition({
    flowRef: logic.flowRef,
    floatCardElRef: logic.floatCardElRef,
    manualCardElRef: logic.manualCardElRef,
    selectedId: logic.selectedId,
    selectedManualEditIdx: logic.selectedManualEditIdx,
    flatErrors: logic.flatErrors,
    results,
  })

  const { jumpToParagraphExact, positionSavedRef, flashingParaIdx } = useReaderScroll({
    ref,
    flowRef: logic.flowRef,
    project,
    paras: logic.paras,
    paraMapByIdx: logic.paraMapByIdx,
    chapters,
    selectedChapter,
    updatePos,
    updateManualEditPos,
    updateToolbarPos: logic.updateToolbarPos,
  })

  useReaderKeyboard({
    flatErrors: logic.flatErrors,
    pending: logic.pending,
    selectedIdRef: logic.selectedIdRef,
    setSelectedId: logic.setSelectedId,
    selectedManualEditIdxRef: logic.selectedManualEditIdxRef,
    setSelectedManualEditIdx: logic.setSelectedManualEditIdx,
    handleStatus: logic.handleStatus,
    setFlashSide: logic.setFlashSide,
    inProgress,
    proofreading,
    onStartProofread,
    mergeMode: logic.mergeMode,
    handleExitMergeMode: logic.handleExitMergeMode,
    floatCardElRef: logic.floatCardElRef,
    manualCardElRef: logic.manualCardElRef,
    dismissToolbar: logic.dismissToolbar,
  })

  // 自动选中第一条待处理错误（在进入页面、刷新、或校对结果返回时触发）
  useEffect(() => {
    if (!results || logic.pending.length === 0) return
    const stillPending = logic.pending.some(e => e.id === logic.selectedIdRef.current)
    if (!stillPending) {
      logic.autoSelectRef.current = true
      positionSavedRef.current = false
      logic.setSelectedId(logic.pending[0].id)
    }
  }, [results, logic.pending, logic.selectedIdRef, logic.autoSelectRef, logic.setSelectedId, positionSavedRef])

  // 切换 selectedId 时自动精准滚动到目标段落
  useEffect(() => {
    if (!logic.selectedId || !logic.flowRef.current) return
    const err = logic.flatErrors.find(e => e.id === logic.selectedId)
    if (!err) return

    const container = logic.flowRef.current
    const key = err.paragraph_uuid || err.paragraph_index

    const doJump = () => {
      const paraEl = container.querySelector(`[data-para="${key}"]`) || container.querySelector(`[data-para="${err.paragraph_index}"]`)
      if (paraEl) {
        const cRect = container.getBoundingClientRect()
        const pRect = paraEl.getBoundingClientRect()
        const isVisible = pRect.top >= cRect.top + 20 && pRect.bottom <= cRect.bottom - 40
        if (isVisible) {
          updatePos()
          return
        }
      }
      jumpToParagraphExact(key, 0, false)
    }

    requestAnimationFrame(doJump)
  }, [logic.selectedId, logic.flatErrors, logic.flowRef, updatePos, jumpToParagraphExact])

  const hasResults = results && logic.paras.length > 0
  const showPanel = panelOpen && hasResults

  if (!hasResults) {
    return (
      <Card>
        <Empty description="暂无数据" />
      </Card>
    )
  }

  return (
    <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 12, padding: '4px 16px 0', position: 'relative' }}>
        <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
          <ReaderContentArea
            contentRef={logic.contentRef}
            flowRef={logic.flowRef}
            sortedParas={logic.sortedParas}
            errorsByParaIdx={logic.errorsByParaIdx}
            chaptersByParaIdx={logic.chaptersByParaIdx}
            editingIdx={logic.editingIdx}
            selectedParas={selectedParas}
            selectedId={logic.selectedId}
            flashingParaIdx={flashingParaIdx}
            currentBodyFontSize={logic.currentBodyFontSize}
            project={project}
            pbTooltipIdx={logic.pbTooltipIdx}
            editingText={logic.editingText}
            editingNote={logic.editingNote}
            savingPara={logic.savingPara}
            showOriginalMap={logic.showOriginalMap}
            handleParaClick={logic.handleParaClick}
            handleCheckboxToggle={logic.handleCheckboxToggle}
            setEditingText={logic.setEditingText}
            setEditingNote={logic.setEditingNote}
            handleSaveEdit={logic.handleSaveEdit}
            handleCancelEdit={logic.handleCancelEdit}
            handleTogglePageBreak={logic.handleTogglePageBreak}
            setPbTooltipIdx={logic.setPbTooltipIdx}
            handleSelectError={logic.handleSelectError}
            showAllOriginals={logic.showAllOriginals}
            handleSelectManualEdit={logic.handleSelectManualEdit}
            mergeMode={logic.mergeMode}
            selectedMergeParas={logic.selectedMergeParas}
            handleToggleMergeSelect={logic.handleToggleMergeSelect}
            handleStartEdit={logic.handleStartEdit}
            editingCaretPos={logic.editingCaretPos}
            activeIdx={logic.activeIdx}
            toolbarRef={logic.toolbarRef}
            tbFontSize={logic.tbFontSize}
            handleInsertPara={logic.handleInsertPara}
            handleEnterMergeMode={logic.handleEnterMergeMode}
            handleSetChapter={logic.handleSetChapter}
            handleToggleOriginal={logic.handleToggleOriginal}
            handleDeletePara={logic.handleDeletePara}
          />

          <ActionBar
            mergeMode={logic.mergeMode}
            handleConfirmMergeBatch={logic.handleConfirmMergeBatch}
            selectedMergeParas={logic.selectedMergeParas}
            handleExitMergeMode={logic.handleExitMergeMode}
            inProgress={inProgress}
            proofreading={proofreading}
            showOptions={logic.showOptions}
            setShowOptions={logic.setShowOptions}
            selectedModel={selectedModel}
            onModelChange={onModelChange}
            models={models}
            selectedTypes={selectedTypes}
            onTypesChange={onTypesChange}
            batchMaxConcurrent={batchMaxConcurrent}
            onBatchMaxConcurrentChange={onBatchMaxConcurrentChange}
            proofreadWindowSize={proofreadWindowSize}
            onWindowSizeChange={onWindowSizeChange}
            batchInfo={batchInfo}
            retryingWindow={retryingWindow}
            onRetryWindow={onRetryWindow}
            percent={percent}
            bannerText={bannerText}
            flatErrors={logic.flatErrors}
            pending={logic.pending}
            selectedError={logic.selectedError}
            selIsPending={logic.selIsPending}
            customEdit={logic.customEdit}
            setCustomEdit={logic.setCustomEdit}
            statusSubmittingRef={logic.statusSubmittingRef}
            setFlashSide={logic.setFlashSide}
            flashSide={logic.flashSide}
            handleStatus={logic.handleStatus}
            selectedId={logic.selectedId}
            allDone={logic.allDone}
            projectError={projectError}
            onStartProofread={onStartProofread}
            onStartBatchProofread={onStartBatchProofread}
          />
        </div>

        <ErrorSidebar
          showPanel={showPanel}
          onTogglePanel={onTogglePanel}
          panelTab={logic.panelTab}
          setPanelTab={logic.setPanelTab}
          pending={logic.pending}
          accepted={logic.accepted}
          rejected={logic.rejected}
          obsolete={logic.obsolete}
          selectedId={logic.selectedId}
          handleSelectError={logic.handleSelectError}
          handleSelectObsoleteError={logic.handleSelectObsoleteError}
          unmatchedIds={logic.unmatchedIds}
          onSetStatus={onSetStatus}
          jumpToParagraphExact={jumpToParagraphExact}
        />
      </div>

      <FloatCardLayer
        selectedError={logic.selectedError}
        floatCardElRef={logic.floatCardElRef}
        currentBodyFontSize={logic.currentBodyFontSize}
        handleStatus={logic.handleStatus}
        setFlashSide={logic.setFlashSide}
        setSelectedId={logic.setSelectedId}
        selectedManualEditPara={logic.selectedManualEditPara}
        manualCardElRef={logic.manualCardElRef}
        handleSaveManualEditNote={logic.handleSaveManualEditNote}
        handleDeleteNoteItem={logic.handleDeleteNoteItem}
        handleRevertManualEdit={logic.handleRevertManualEdit}
        setSelectedManualEditIdx={logic.setSelectedManualEditIdx}
      />
    </div>
  )
}
