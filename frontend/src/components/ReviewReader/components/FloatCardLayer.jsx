import React from 'react'
import { ErrorDetailCard } from './ErrorDetailCard'
import { ManualEditDetailCard } from './ManualEditDetailCard'
import { AnnotationDetailCard } from './AnnotationDetailCard'

export function FloatCardLayer({
  mergeMode,
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
  selectedAnnotation,
  annotationCardElRef,
  handleUpdateAnnotation,
  handleDeleteAnnotation,
  setSelectedAnnotationId,
  annotationNumIndex = 1,
}) {
  if (mergeMode) return null

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
      {selectedAnnotation && (
        <AnnotationDetailCard
          key={selectedAnnotation.id}
          ref={annotationCardElRef}
          annotation={selectedAnnotation}
          numIndex={annotationNumIndex}
          currentBodyFontSize={currentBodyFontSize}
          onUpdate={handleUpdateAnnotation}
          onDelete={handleDeleteAnnotation}
          onClose={() => setSelectedAnnotationId(null)}
        />
      )}
    </>
  )
}
