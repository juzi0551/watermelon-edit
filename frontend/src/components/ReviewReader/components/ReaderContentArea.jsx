import React from 'react'
import { color, radius } from '../../../design-tokens'
import { PB_INFO_MAP, EMPTY_ARRAY } from '../constants'
import { ParaRow } from './ParaRow'
import { ParaHoverToolbar } from './ParaHoverToolbar'

export function ReaderContentArea({
  contentRef,
  flowRef,
  sortedParas,
  errorsByParaIdx,
  chaptersByParaIdx,
  editingIdx,
  selectedParas,
  selectedId,
  currentBodyFontSize,
  project,
  pbTooltipIdx,
  editingText,
  editingNote,
  savingPara,
  showOriginalMap,
  handleParaClick,
  handleCheckboxToggle,
  setEditingText,
  setEditingNote,
  handleSaveEdit,
  handleCancelEdit,
  handleTogglePageBreak,
  setPbTooltipIdx,
  handleSelectError,
  showAllOriginals,
  handleSelectManualEdit,
  mergeMode,
  selectedMergeParas,
  handleToggleMergeSelect,
  handleStartEdit,
  editingCaretPos,
  activeIdx,
  toolbarRef,
  tbFontSize,
  handleInsertPara,
  handleEnterMergeMode,
  handleSetChapter,
  handleToggleOriginal,
  handleDeletePara,
}) {
  return (
    <div
      ref={contentRef}
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        position: 'relative',
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
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 12,
          background: `linear-gradient(to bottom, ${color.bgPage} 0%, rgba(255, 255, 255, 0) 100%)`,
          pointerEvents: 'none',
          zIndex: 10,
          borderRadius: `${radius.md}px ${radius.md}px 0 0`,
          opacity: 1,
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 12,
          background: `linear-gradient(to top, ${color.bgPage} 0%, rgba(255, 255, 255, 0) 100%)`,
          pointerEvents: 'none',
          zIndex: 10,
          borderRadius: `0 0 ${radius.md}px ${radius.md}px`,
        }}
      />
      <div
        ref={flowRef}
        className="custom-reader-scroll"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '12px 24px 72px 24px',
          background: color.bgReader,
          borderRadius: radius.md,
          position: 'relative',
        }}
      >
        <div style={{ position: 'relative', width: '100%' }}>
          {sortedParas.map(para => {
            const paraErrs = errorsByParaIdx.get(para.uuid) || errorsByParaIdx.get(para.idx) || EMPTY_ARRAY
            const chapterObj = chaptersByParaIdx.get(para.uuid) || chaptersByParaIdx.get(para.idx)
            const isCh = Boolean(chapterObj)
            const isEditing = editingIdx === para.idx
            const isChecked = (para.uuid ? selectedParas?.has(para.uuid) : false) || selectedParas?.has(para.idx) || false

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
                isActive={isActive}
                isChecked={isChecked}
                selectedId={selectedId}
                currentBodyFontSize={currentBodyFontSize}
                firstLineIndentEnabled={Boolean(project?.style_config?.first_line_indent_enabled)}
                pbInfo={pbInfo}
                pbType={pbType}
                pbTooltipIdx={pbTooltipIdx}
                editingText={isEditing ? editingText : ''}
                editingNote={isEditing ? editingNote : ''}
                savingPara={savingPara}
                showOriginalThis={!!showOriginalMap[para.idx]}
                onParaClick={handleParaClick}
                onCheckboxToggle={handleCheckboxToggle}
                onEditingTextChange={setEditingText}
                onEditingNoteChange={setEditingNote}
                onSaveEdit={handleSaveEdit}
                onCancelEdit={handleCancelEdit}
                onTogglePageBreak={handleTogglePageBreak}
                onPbTooltipIdx={setPbTooltipIdx}
                onSelectError={handleSelectError}
                showAllOriginals={showAllOriginals}
                onSelectManualEdit={handleSelectManualEdit}
                mergeMode={mergeMode}
                isMergeChecked={mergeMode ? (selectedMergeParas.has(para.uuid) || selectedMergeParas.has(para.idx)) : false}
                onMergeToggle={handleToggleMergeSelect}
                onStartEdit={handleStartEdit}
                editingCaretPos={editingCaretPos}
              />
            )
          })}

          {activeIdx !== null && !mergeMode && editingIdx === null && (() => {
            const activePara = sortedParas.find(p => p.idx === activeIdx)
            if (!activePara) return null
            const showOrig = !!showOriginalMap[activePara.idx]
            const hasManualEdit = Boolean(activePara.revised_text && activePara.revised_text !== activePara.text)
            const ch = chaptersByParaIdx.get(activePara.uuid) || chaptersByParaIdx.get(activePara.idx)
            const activeIsCh = Boolean(ch)
            const pb = activePara.page_break_type || (activePara.has_page_break_before === 1 ? 'auto_chapter' : 'none')
            const hasHardBreak = pb === 'original' || pb === 'manual'
            return (
              <ParaHoverToolbar
                toolbarRef={toolbarRef}
                activePara={activePara}
                tbFontSize={tbFontSize}
                showOrig={showOrig}
                hasManualEdit={hasManualEdit}
                activeIsCh={activeIsCh}
                hasHardBreak={hasHardBreak}
                handleStartEdit={handleStartEdit}
                handleInsertPara={handleInsertPara}
                handleEnterMergeMode={handleEnterMergeMode}
                handleSetChapter={handleSetChapter}
                handleToggleOriginal={handleToggleOriginal}
                handleTogglePageBreak={handleTogglePageBreak}
                handleDeletePara={handleDeletePara}
              />
            )
          })()}
        </div>
      </div>
    </div>
  )
}
