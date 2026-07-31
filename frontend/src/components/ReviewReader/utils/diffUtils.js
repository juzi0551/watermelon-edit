import { diffChars } from 'diff'

export function computeLcsDiffChunks(original, suggested) {
  const orig = original || ''
  const sugg = suggested || ''
  if (!orig && !sugg) return []
  if (!orig) return [{ type: 'added', text: sugg }]
  if (!sugg) return [{ type: 'removed', text: orig }]

  const changes = diffChars(orig, sugg)
  return changes.map(c => {
    let type = 'unchanged'
    if (c.added) type = 'added'
    else if (c.removed) type = 'removed'
    return { type, text: c.value }
  })
}

export function computeExactLcsDiff(original, suggested) {
  const orig = original || ''
  const sugg = suggested || ''
  const m = orig.length
  const n = sugg.length
  const origMatched = new Array(m).fill(false)
  const suggMatched = new Array(n).fill(false)

  if (m === 0 || n === 0) return { origMatched, suggMatched }

  const changes = diffChars(orig, sugg)
  let origIdx = 0
  let suggIdx = 0

  changes.forEach(c => {
    const len = c.value.length
    if (c.added) {
      suggIdx += len
    } else if (c.removed) {
      origIdx += len
    } else {
      for (let k = 0; k < len; k++) {
        if (origIdx + k < m) origMatched[origIdx + k] = true
        if (suggIdx + k < n) suggMatched[suggIdx + k] = true
      }
      origIdx += len
      suggIdx += len
    }
  })

  return { origMatched, suggMatched }
}
