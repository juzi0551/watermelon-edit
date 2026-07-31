import React from 'react'
import { ErrorDetailCard } from './ErrorDetailCard'
import { ManualEditDetailCard } from './ManualEditDetailCard'

export function FloatCardLayer({
  selectedError,
  floatCardElRef,
  currentBodyFontSize,
  handleStatus,
  setFlashSide,
  setSelectedId,
  selectedManualEditPara,
  manualCardElRef,
  handleSaveManualEditNote,
  handleDeleteNoteItem,
  handleRevertManualEdit,
  setSelectedManualEditIdx,
}) {
  return (
    <>
      {selectedError && (
        <ErrorDetailCard
          ref={floatCardElRef}
          error={selectedError}
          currentBodyFontSize={currentBodyFontSize}
          onAccept={() => { setFlashSide('accepted'); setTimeout(() => setFlashSide(null), 200); handleStatus('accepted') }}
          onReject={() => { setFlashSide('rejected'); setTimeout(() => setFlashSide(null), 200); handleStatus('rejected') }}
          onClose={() => setSelectedId(null)}
        />
      )}
      {selectedManualEditPara && (
        <ManualEditDetailCard
          key={selectedManualEditPara.uuid || selectedManualEditPara.idx}
          ref={manualCardElRef}
          para={selectedManualEditPara}
          currentBodyFontSize={currentBodyFontSize}
          onSaveNote={handleSaveManualEditNote}
          onDeleteNoteItem={handleDeleteNoteItem}
          onRevert={handleRevertManualEdit}
          onClose={() => setSelectedManualEditIdx(null)}
        />
      )}
    </>
  )
}
