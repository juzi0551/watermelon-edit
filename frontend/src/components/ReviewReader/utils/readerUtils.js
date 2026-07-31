export function getCircledNum(n) {
  const map = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']
  return map[n - 1] || `(${n})`
}

export function parseEditNotes(editNoteField) {
  if (!editNoteField) return []
  if (Array.isArray(editNoteField)) return editNoteField
  try {
    if (typeof editNoteField === 'string' && editNoteField.trim().startsWith('[')) {
      const parsed = JSON.parse(editNoteField)
      if (Array.isArray(parsed)) return parsed
    }
  } catch { }
  if (typeof editNoteField === 'string' && editNoteField.trim()) {
    return [{ id: 'legacy_1', note: editNoteField.trim(), created_at: '前次修改' }]
  }
  return []
}
