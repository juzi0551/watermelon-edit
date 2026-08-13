import React, { forwardRef, useEffect, useState } from 'react'
import { Card, Empty, message } from 'antd'
import { color } from '../../design-tokens'
import { useReaderLogic } from './hooks/useReaderLogic'
import { useReaderCardPosition } from './hooks/useReaderCardPosition'
import { useReaderScroll } from './hooks/useReaderScroll'
import { useReaderKeyboard } from './hooks/useReaderKeyboard'
import { ReaderContentArea } from './components/ReaderContentArea'
import { ErrorSidebar } from './components/ErrorSidebar'
import { ActionBar } from './components/ActionBar'
import { FloatCardLayer } from './components/FloatCardLayer'
import { SelectionToolbar } from './components/SelectionToolbar'
import { ReaderHeader } from './components/ReaderHeader'
import { AnnotationModal } from './components/AnnotationModal'
import { AnnotationSidebar } from './components/AnnotationSidebar'
import { StoryProfileDrawer } from './components/StoryProfileDrawer'
import { SceneBeatsDrawer } from './components/SceneBeatsDrawer'
import { SensoryDescribeModal } from './components/SensoryDescribeModal'
import { TabAutocompleteModal } from './components/TabAutocompleteModal'
import { RewriteModal } from './components/RewriteModal'
import { tabAutocomplete, insertParagraph, updateParagraph, deleteParagraph, updateProjectProfile } from '../../services/api'

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
  onAskAssistant,
  onExport,
  exporting,
  onOpenTools,
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

  // 创作模式弹窗与抽屉控制 state
  const [storyProfileOpen, setStoryProfileOpen] = useState(false)
  const [sceneBeatsOpen, setSceneBeatsOpen] = useState(false)
  const [sensoryModalOpen, setSensoryModalOpen] = useState(false)
  const [sensorySelectionData, setSensorySelectionData] = useState(null)
  const [rewriteModalOpen, setRewriteModalOpen] = useState(false)
  const [rewriteSelectionData, setRewriteSelectionData] = useState(null)
  const [tabModalOpen, setTabModalOpen] = useState(false)
  const [tabPrecedingText, setTabPrecedingText] = useState('')

  // ✍️ 撰写模式 Enter 切断并新建下方段落连贯打字
  const handleSplitAndInsert = async (currentPara, leftText, rightText) => {
    if (!project?.id || !currentPara) return
    try {
      await updateParagraph(project.id, currentPara.idx, leftText, null, currentPara.uuid)
      const inserted = await insertParagraph(project.id, currentPara.idx, 'below', rightText, currentPara.uuid)
      await onReloadProject?.()
      const newIdx = inserted?.idx ?? (currentPara.idx + 1)
      logic.setEditingIdx(newIdx)
      logic.setEditingText(rightText)
      logic.setEditingCaretPos(0)
    } catch (e) {
      message.error('连贯切段失败：' + e.message)
    }
  }

  // ✍️ 撰写模式 Backspace 退格：若空段落则删除；若非空段落段首退格，则拼接至上一段末尾
  const handleMergeWithPrev = async (currentPara, currentText = '', isEmpty = false) => {
    if (!project?.id || !currentPara || currentPara.idx === 0) return
    const sortedParas = logic.sortedParas || []
    const prevPara = sortedParas.find(p => p.idx === currentPara.idx - 1)
    if (!prevPara) return
    try {
      const prevText = prevPara.revised_text || prevPara.text || ''
      if (isEmpty || !currentText || currentText.trim() === '') {
        await deleteParagraph(project.id, currentPara.idx, currentPara.uuid)
      } else {
        const mergedText = prevText + currentText
        await updateParagraph(project.id, prevPara.idx, mergedText, null, prevPara.uuid)
        await deleteParagraph(project.id, currentPara.idx, currentPara.uuid)
      }
      await onReloadProject?.()
      logic.setEditingIdx(prevPara.idx)
      logic.setEditingText(prevText + currentText)
      logic.setEditingCaretPos(prevText.length)
    } catch (e) {
      message.error('退格合并失败：' + e.message)
    }
  }



  // 同步正文字号变化至外层容器（供 AI 助手等关联组件联动）
  useEffect(() => {
    onBodyFontSizeChange?.(logic.currentBodyFontSize)
  }, [logic.currentBodyFontSize, onBodyFontSizeChange])

  const { spanCacheRef, updatePos, updateManualEditPos, updateAnnotationPos } = useReaderCardPosition({
    flowRef: logic.flowRef,
    floatCardElRef: logic.floatCardElRef,
    manualCardElRef: logic.manualCardElRef,
    annotationCardElRef: logic.annotationCardElRef,
    selectedId: logic.selectedId,
    selectedManualEditIdx: logic.selectedManualEditIdx,
    selectedAnnotationId: logic.selectedAnnotationId,
    flatErrors: logic.flatErrors,
    annotations: logic.annotations,
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
    updateAnnotationPos,
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

  // 切换 selectedAnnotationId 时自动精准滚动到目标段落并闪开定位
  useEffect(() => {
    if (!logic.selectedAnnotationId || !logic.flowRef.current) return
    const ann = logic.annotations.find(a => String(a.id) === String(logic.selectedAnnotationId))
    if (!ann) return

    const container = logic.flowRef.current
    const key = ann.paragraph_uuid || ann.paragraph_idx

    const doJump = () => {
      const paraEl = container.querySelector(`[data-para="${key}"]`) || container.querySelector(`[data-para="${ann.paragraph_idx}"]`)
      if (paraEl) {
        const cRect = container.getBoundingClientRect()
        const pRect = paraEl.getBoundingClientRect()
        const isVisible = pRect.top >= cRect.top + 20 && pRect.bottom <= cRect.bottom - 40
        if (isVisible) {
          updateAnnotationPos()
          return
        }
      }
      jumpToParagraphExact(key, 0, true)
    }

    requestAnimationFrame(doJump)
  }, [logic.selectedAnnotationId, logic.annotations, logic.flowRef, updateAnnotationPos, jumpToParagraphExact])

  // 快捷续写：唤起高颜值动画弹窗
  const handleTabAutocomplete = () => {
    if (!project?.id) return
    const sortedParas = logic.sortedParas || []
    if (sortedParas.length === 0) return

    const lastParas = sortedParas.slice(-3)
    const precedingText = lastParas.map(p => p.revised_text || p.text || '').join('\n')
    setTabPrecedingText(precedingText)
    setTabModalOpen(true)
  }

  // 采纳续写：插入段落并自动滚动平滑渐显
  const handleAdoptContinuation = async (continuationText) => {
    if (!project?.id || !continuationText) return
    const sortedParas = logic.sortedParas || []
    if (sortedParas.length === 0) return

    const lastPara = sortedParas[sortedParas.length - 1]
    const inserted = await insertParagraph(
      project.id,
      lastPara.uuid || lastPara.idx,
      'below',
      continuationText,
      lastPara.uuid
    )

    message.success({ content: '已采纳填入正文！', key: 'tab_autocomplete' })
    await onReloadProject?.()

    // 渐显闪烁滚动
    const newIdx = inserted?.idx ?? (lastPara.idx + 1)
    setTimeout(() => {
      jumpToParagraphExact(inserted?.uuid || newIdx, 0, true)
    }, 150)
  }


  // 场景节拍草稿追加处理
  const handleAppendDraftText = async (draftText) => {
    if (!draftText || !project?.id) return
    const sortedParas = logic.sortedParas || []

    if (sortedParas.length > 0) {
      const lastPara = sortedParas[sortedParas.length - 1]
      const lines = draftText.split('\n').map(l => l.trim()).filter(Boolean)
      let currTarget = lastPara.uuid || lastPara.idx
      for (const line of lines) {
        const inserted = await insertParagraph(project.id, currTarget, 'below', line, typeof currTarget === 'string' ? currTarget : null)
        if (inserted?.uuid) currTarget = inserted.uuid
      }
    }
    await onReloadProject?.()
  }


  // 模式双轨无缝切换
  const handleToggleMode = async (newMode) => {
    if (!project?.id) return
    try {
      await updateProjectProfile(project.id, { mode: newMode })
      message.success(`已成功切换至${newMode === 'writing' ? '✍️ 撰写模式' : '🔍 审校模式'}`)
      await onReloadProject?.()
    } catch (e) {
      message.error('模式切换失败：' + e.message)
    }
  }

  // 五感扩写替换处理
  const handleReplaceSensoryText = async ({ originalText, replacementText, paragraphIdx, paragraphUuid }) => {
    const targetPara = (logic.sortedParas || []).find(p => p.idx === paragraphIdx || String(p.uuid) === String(paragraphUuid))
    if (!targetPara) return
    const fullText = targetPara.revised_text || targetPara.text || ''
    const updatedText = fullText.replace(originalText, replacementText)
    await updateParagraph(project.id, targetPara.idx, updatedText, '五感细节扩写替换', targetPara.uuid)
    onReloadProject?.()
  }

  // 问题边栏与注释边栏互斥切换
  const handleToggleErrorPanel = () => {
    if (!panelOpen && logic.annotationPanelOpen) {
      logic.setAnnotationPanelOpen(false)
    }
    onTogglePanel?.()
  }

  const handleToggleAnnotationPanel = () => {
    if (panelOpen) {
      onTogglePanel?.()
    }
    logic.setAnnotationPanelOpen(prev => !prev)
  }

  const isWritingMode = project?.mode === 'writing'
  const hasResults = results && logic.paras.length > 0
  const showPanel = !isWritingMode && panelOpen && hasResults
  const showAnnotationPanel = logic.annotationPanelOpen && hasResults

  if (!hasResults) {
    return (
      <Card>
        <Empty description="暂无数据" />
      </Card>
    )
  }

  return (
    <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
      <ReaderHeader
        project={project}
        chapters={chapters}
        selectedChapter={selectedChapter}
        onSelectChapter={onChapterChange}
        pendingCount={logic.pending.length}
        panelOpen={panelOpen}
        onTogglePanel={handleToggleErrorPanel}
        annotationPanelOpen={logic.annotationPanelOpen}
        onToggleAnnotationPanel={handleToggleAnnotationPanel}
        annotationCount={logic.annotations.length}
        tbFontSize={logic.tbFontSize}
        onToggleMode={handleToggleMode}
      />

      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 12, padding: 0, position: 'relative' }}>
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
            handleAskAssistant={onAskAssistant}
            annotations={logic.annotations}
            selectedAnnotationId={logic.selectedAnnotationId}
            onSelectAnnotation={logic.handleSelectAnnotation}
            onSplitAndInsert={handleSplitAndInsert}
            onMergeWithPrev={handleMergeWithPrev}
          />

          <SelectionToolbar
            containerRef={logic.contentRef}
            paras={logic.sortedParas}
            onAskAssistant={onAskAssistant}
            onAddAnnotation={logic.handleOpenAnnotationModal}
            onOpenSensoryExpand={(data) => {
              setSensorySelectionData(data)
              setSensoryModalOpen(true)
            }}
            onOpenRewrite={(data) => {
              setRewriteSelectionData(data)
              setRewriteModalOpen(true)
            }}
            onStartSelectionProofread={onStartSelectionProofread}
            onSetChapter={logic.handleSetChapter}
            onSelectionChange={logic.handleSelectionChange}
            tbFontSize={logic.tbFontSize}
            mergeMode={logic.mergeMode}
            isWritingMode={isWritingMode}
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
            onExport={onExport}
            exporting={exporting}
            onOpenTools={onOpenTools}
            onOpenStoryProfile={() => setStoryProfileOpen(true)}
            onOpenSceneBeats={() => setSceneBeatsOpen(true)}
            onTabAutocomplete={handleTabAutocomplete}
            isWritingMode={project?.mode === 'writing'}
            tbFontSize={logic.tbFontSize}
          />
        </div>

        <ErrorSidebar
          mergeMode={logic.mergeMode}
          showPanel={showPanel}
          onTogglePanel={handleToggleErrorPanel}
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
          tbFontSize={logic.tbFontSize}
        />

        <AnnotationSidebar
          showPanel={showAnnotationPanel}
          onTogglePanel={handleToggleAnnotationPanel}
          annotations={logic.annotations}
          selectedAnnotationId={logic.selectedAnnotationId}
          onSelectAnnotation={logic.handleSelectAnnotation}
          jumpToParagraphExact={jumpToParagraphExact}
          tbFontSize={logic.tbFontSize}
        />
      </div>

      <FloatCardLayer
        mergeMode={logic.mergeMode}
        selectedError={isWritingMode ? null : logic.selectedError}
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
        selectedAnnotation={logic.selectedAnnotation}
        annotationCardElRef={logic.annotationCardElRef}
        handleUpdateAnnotation={logic.handleUpdateAnnotationSubmit}
        handleDeleteAnnotation={logic.handleDeleteAnnotationSubmit}
        setSelectedAnnotationId={logic.setSelectedAnnotationId}
        annotationNumIndex={logic.annotationNumIndex}
      />

      <AnnotationModal
        open={logic.annotationModalOpen}
        selectionData={logic.annotationSelectionData}
        onOk={logic.handleCreateAnnotation}
        onCancel={() => logic.setAnnotationModalOpen(false)}
      />

      <StoryProfileDrawer
        open={storyProfileOpen}
        onClose={() => setStoryProfileOpen(false)}
        projectId={project?.id}
        projectData={project}
        onProfileUpdated={onReloadProject}
      />

      <SceneBeatsDrawer
        open={sceneBeatsOpen}
        onClose={() => setSceneBeatsOpen(false)}
        projectId={project?.id}
        chapterTitle={selectedChapter?.title || '第一章'}
        onAppendDraftText={handleAppendDraftText}
      />

      <SensoryDescribeModal
        open={sensoryModalOpen}
        onCancel={() => setSensoryModalOpen(false)}
        projectId={project?.id}
        selectedText={sensorySelectionData?.selectedText}
        paragraphIdx={sensorySelectionData?.paragraphIdx}
        paragraphUuid={sensorySelectionData?.paragraphUuid}
        onReplaceText={handleReplaceSensoryText}
      />

      <TabAutocompleteModal
        open={tabModalOpen}
        onCancel={() => setTabModalOpen(false)}
        projectId={project?.id}
        selectedModel={selectedModel}
        precedingText={tabPrecedingText}
        bodyFontSize={logic.currentBodyFontSize}
        onAdoptContinuation={handleAdoptContinuation}
      />

      <RewriteModal
        open={rewriteModalOpen}
        onCancel={() => setRewriteModalOpen(false)}
        projectId={project?.id}
        selectedText={rewriteSelectionData?.selectedText}
        paragraphIdx={rewriteSelectionData?.paragraphIdx}
        paragraphUuid={rewriteSelectionData?.paragraphUuid}
        onReplaceText={handleReplaceSensoryText}
        selectedModel={selectedModel}
      />

    </div>
  )
}



