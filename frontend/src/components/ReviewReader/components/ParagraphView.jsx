import React, { useMemo } from 'react'
import { diffChars } from 'diff'
import { color } from '../../../design-tokens'
import { parseEditNotes } from '../utils/readerUtils'
import { computeExactLcsDiff } from '../utils/diffUtils'

export function ParagraphView({ text, paraErrors, selectedId, onSelect, origText, editNote, paraIdx, onSelectManualEdit, mergeMode, annotations = [], selectedAnnotationId = null, onSelectAnnotation }) {
  // 1. 过滤活跃未作废错误
  const activeErrs = (paraErrors || []).filter(e => !e.is_obsolete)

  // 预构建字典：映射 original_text -> error (O(1) 查询)
  const errByOrigMap = useMemo(() => {
    const map = new Map()
    activeErrs.forEach(e => {
      if (e.original_text) map.set(e.original_text, e)
    })
    return map
  }, [activeErrs])

  if (!text) return null

  // 2. 是否存在手工修改（有 revised_text 即视为有改动，不依赖备注是否填写）
  const manualNotes = parseEditNotes(editNote)
  const hasManualEditNotes = Boolean(manualNotes.length > 0)
  const hasManualEdit = Boolean(origText && text && origText !== text)
  const manualLcs = hasManualEdit
    ? computeExactLcsDiff(origText, text)
    : null

  // 过滤本段落关联的书籍划线注释
  const paraAnnotations = useMemo(() => {
    if (!annotations || !Array.isArray(annotations)) return []
    return annotations.filter(a => a.paragraph_idx === paraIdx || String(a.paragraph_uuid) === String(paraIdx))
  }, [annotations, paraIdx])

  // 收集所有纯删除及纯新增记录与发生位置
  const pureDeletionsByPos = {} // pos -> Array of deletion items
  const pureAdditionsByPos = {} // pos -> Array of addition items

  // A. AI 校对待处理的纯新增与锚点内部增字（排除替换）
  const addPosMap = {}
  activeErrs.forEach(e => {
    if (e.user_status === 'pending' && e.suggested_text) {
      if (!e.original_text || e.original_text.trim() === '') {
        let pos = 0
        if (e.description) {
          const mAfter = e.description.match(/在[“"'「]([^”"'」]+)[”"'」](?:之后|后)/)
          const mBefore = e.description.match(/在[“"'「]([^”"'」]+)[”"'」](?:之前|前)/)
          const mQuotes = e.description.match(/[“"'「]([^”"'」]+)[”"'」]/)

          if (mAfter && text.indexOf(mAfter[1]) >= 0) {
            const idx = text.indexOf(mAfter[1])
            pos = Math.min(idx + mAfter[1].length, text.length)
          } else if (mBefore && text.indexOf(mBefore[1]) >= 0) {
            pos = Math.min(text.indexOf(mBefore[1]), text.length)
          } else if (mQuotes && text.indexOf(mQuotes[1]) >= 0) {
            const idx = text.indexOf(mQuotes[1])
            pos = Math.min(idx + mQuotes[1].length, text.length)
          }
        }
        if (!pureAdditionsByPos[pos]) pureAdditionsByPos[pos] = []
        pureAdditionsByPos[pos].push({
          type: 'ai',
          errorId: e.id,
          isSelected: String(e.id) === String(selectedId),
          suggestedText: e.suggested_text,
        })
      } else {
        const from = addPosMap[e.original_text] ?? 0
        const start = text.indexOf(e.original_text, from)
        if (start >= 0) {
          addPosMap[e.original_text] = start + 1
          const changes = diffChars(e.original_text, e.suggested_text)
          let origOffset = 0
          changes.forEach((c, idx) => {
            if (c.added) {
              const isReplacement = (idx > 0 && changes[idx - 1].removed) ||
                (idx < changes.length - 1 && changes[idx + 1].removed)
              if (!isReplacement) {
                const insertPos = Math.min(start + origOffset, text.length)
                if (!pureAdditionsByPos[insertPos]) pureAdditionsByPos[insertPos] = []
                const exists = pureAdditionsByPos[insertPos].some(item => item.errorId === e.id)
                if (!exists) {
                  pureAdditionsByPos[insertPos].push({
                    type: 'ai',
                    errorId: e.id,
                    isSelected: String(e.id) === String(selectedId),
                    suggestedText: c.value,
                  })
                }
              }
            } else {
              origOffset += c.value.length
            }
          })
        }
      }
    }
  })

  // B. 利用 diffChars 直接从 (origText -> text) 原生变动中计算删除点与位置
  if (origText && text && origText !== text) {
    const changes = diffChars(origText, text)
    let textPos = 0

    changes.forEach((c, idx) => {
      if (c.removed) {
        const isReplacement = (idx < changes.length - 1 && changes[idx + 1].added) ||
          (idx > 0 && changes[idx - 1].added)
        if (!isReplacement) {
          const pos = Math.min(textPos, text.length)
          const matchedErr = activeErrs.find(e =>
            e.user_status === 'accepted' &&
            e.original_text &&
            (e.original_text === c.value || c.value.includes(e.original_text) || e.original_text.includes(c.value))
          )
          if (matchedErr) {
            if (!pureDeletionsByPos[pos]) pureDeletionsByPos[pos] = []
            const exists = pureDeletionsByPos[pos].some(item => item.type === 'ai' && item.errorId === matchedErr.id)
            if (!exists) {
              pureDeletionsByPos[pos].push({
                type: 'ai',
                errorId: matchedErr.id,
                isSelected: matchedErr.id === selectedId,
              })
            }
          } else if (hasManualEditNotes) {
            if (!pureDeletionsByPos[pos]) pureDeletionsByPos[pos] = []
            pureDeletionsByPos[pos].push({
              type: 'manual',
              paraIdx,
            })
          }
        }
      } else {
        textPos += c.value.length
      }
    })
  }

  const posMap = {}
  const intervals = []
  const bounds = new Set([0, text.length])

  // 注入纯删除与纯新增位置点
  Object.keys(pureDeletionsByPos).forEach(p => bounds.add(Number(p)))
  Object.keys(pureAdditionsByPos).forEach(p => bounds.add(Number(p)))

  activeErrs.forEach(e => {
    const isAccepted = e.user_status === 'accepted'
    const targetStr = isAccepted ? e.suggested_text : e.original_text
    if (!targetStr) return

    const from = posMap[targetStr] ?? 0
    const idx = text.indexOf(targetStr, from)
    if (idx >= 0) {
      const origStr = e.original_text || ''
      const suggStr = e.suggested_text || ''
      const lcs = computeExactLcsDiff(origStr, suggStr)

      const start = idx
      const end = idx + targetStr.length

      intervals.push({
        error: e,
        start,
        end,
        targetStr,
        isAccepted,
        lcs,
      })

      bounds.add(start)
      bounds.add(end)
      for (let k = 0; k <= targetStr.length; k++) {
        bounds.add(start + k)
      }

      posMap[targetStr] = idx + 1
    }
  })

  // 注入划线注释区间点
  const annotIntervals = []
  const annotPosMap = {}
  paraAnnotations.forEach((ann, aIdx) => {
    const sel = ann.selected_text
    if (!sel) return
    const from = annotPosMap[sel] ?? 0
    const start = text.indexOf(sel, from)
    if (start >= 0) {
      const end = start + sel.length
      annotIntervals.push({
        annotation: ann,
        start,
        end,
        numIndex: aIdx + 1,
      })
      bounds.add(start)
      bounds.add(end)
      annotPosMap[sel] = start + 1
    }
  })

  if (intervals.length === 0 && !hasManualEdit && annotIntervals.length === 0 && Object.keys(pureDeletionsByPos).length === 0 && Object.keys(pureAdditionsByPos).length === 0) {
    return <span>{text}</span>
  }

  // 手工编辑切点注入
  if (hasManualEdit) {
    for (let k = 0; k <= text.length; k++) {
      bounds.add(k)
    }
  }

  const points = [...bounds].sort((a, b) => a - b)
  const segs = []

  const renderDeletionTags = (pos) => {
    const items = pureDeletionsByPos[pos]
    if (!items || items.length === 0) return null
    return items.map((item, idx) => {
      const isAi = item.type === 'ai'
      const isSel = isAi && item.isSelected
      const colorStyle = isAi ? (isSel ? '#262626' : '#8c8c8c') : '#1890ff'
      return (
        <span
          key={`del_${pos}_${idx}`}
          data-error-id={isAi ? item.errorId : undefined}
          data-manual-edit={!isAi ? 'true' : undefined}
          onClick={(ev) => {
            if (mergeMode) return
            ev.stopPropagation()
            if (isAi) {
              onSelect(item.errorId)
            } else {
              onSelectManualEdit?.(item.paraIdx)
            }
          }}
          style={{
            cursor: 'pointer',
            color: colorStyle,
            fontSize: 12,
            fontWeight: isSel ? 600 : 400,
            userSelect: 'none',
            display: 'inline',
            margin: '0 2px',
          }}
        >
          [已删字]
        </span>
      )
    })
  }

  const renderAdditionTags = (pos) => {
    const items = pureAdditionsByPos[pos]
    if (!items || items.length === 0) return null
    return items.map((item, idx) => {
      const isSel = item.isSelected
      return (
        <span
          key={`add_${pos}_${idx}`}
          data-error-id={item.errorId}
          onClick={(ev) => {
            if (mergeMode) return
            ev.stopPropagation()
            onSelect(item.errorId)
          }}
          style={{
            cursor: 'pointer',
            display: 'inline',
            margin: '0 1px',
            padding: '0 1px',
            fontSize: 'inherit',
            fontWeight: isSel ? 800 : 700,
            color: isSel ? '#d46b08' : '#faad14',
            backgroundColor: 'transparent',
            border: 'none',
            userSelect: 'none',
            transition: 'color 0.15s ease',
          }}
        >
          +
        </span>
      )
    })
  }

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]
    const end = points[i + 1]
    if (start >= end) continue

    const segText = text.slice(start, end)
    const covering = intervals.filter(iv => iv.start <= start && iv.end >= end)
    const coveringAnnot = annotIntervals.filter(iv => iv.start <= start && iv.end >= end)

    let borderBottom = 'none'
    let textDecoration = undefined
    let colorStyle = undefined
    let isCharDiff = false
    let isSelected = false
    let ids = []

    if (covering.length > 0) {
      ids = covering.map(iv => iv.error.id)
      isSelected = ids.includes(selectedId)
      const srcIv = covering.find(iv => iv.error.id === selectedId) || covering[0]
      const source = srcIv.error
      const isAccepted = source.user_status === 'accepted'
      const isPending = source.user_status === 'pending'
      const { lcs, targetStr } = srcIv

      const offsetInTarget = start - srcIv.start
      let isPunctOrDel = false

      if (isAccepted) {
        const matched = lcs.suggMatched[offsetInTarget]
        if (matched === false) isCharDiff = true
      } else {
        const matched = lcs.origMatched[offsetInTarget]
        if (matched === false) {
          isCharDiff = true
          const ch = targetStr[offsetInTarget]
          if (ch && (/[，。！？；：“”‘’（）《》、\.,!\?\:\;]/.test(ch) || source.type === 'punctuation' || source.type === 'redundant')) {
            isPunctOrDel = true
          }
        }
      }

      if (isCharDiff) {
        if (isAccepted) {
          borderBottom = isSelected ? '3.5px solid #237804' : '2.5px solid #52c41a'
        } else if (isPending) {
          if (isPunctOrDel || source.type === 'redundant' || (srcIv.diff && srcIv.diff.removed && !srcIv.diff.added)) {
            borderBottom = isSelected ? '3.5px solid #cf1322' : '2.5px solid #ff4d4f'
            textDecoration = 'line-through'
            colorStyle = isSelected ? '#cf1322' : '#ff4d4f'
          } else {
            borderBottom = isSelected ? '3.5px solid #d46b08' : '2.5px solid #faad14'
          }
        }
      }
    }

    // 手工修改字符下划线
    if (!isCharDiff && covering.length === 0 && hasManualEdit && manualLcs) {
      const isUserEditedChar = manualLcs.suggMatched[start] === false
      if (isUserEditedChar) {
        borderBottom = '2.5px solid #1890ff'
      }
    }

    // 划线注释下划线
    const isAnnotated = coveringAnnot.length > 0
    const isAnnotSelected = isAnnotated && coveringAnnot.some(iv => iv.annotation.id === selectedAnnotationId)
    if (isAnnotated && borderBottom === 'none') {
      borderBottom = isAnnotSelected ? '3.5px solid #6b21a8' : '2.5px solid #7c3aed'
    }

    const endingAnnots = annotIntervals.filter(iv => iv.end === end)

    segs.push(
      <React.Fragment key={`seg${start}`}>
        {renderDeletionTags(start)}
        {renderAdditionTags(start)}
        <span
          data-error-id={ids.join(',')}
          data-manual-edit={ids.length === 0 && borderBottom === '2.5px solid #1890ff' ? 'true' : undefined}
          data-annotation-id={isAnnotated ? coveringAnnot.map(iv => iv.annotation.id).join(',') : undefined}
          onClick={(ev) => {
            if (mergeMode) return
            const isManualEditSpan = ids.length === 0 && borderBottom === '2.5px solid #1890ff'
            const hasAiError = ids.length > 0

            if (isAnnotated) {
              ev.stopPropagation()
              onSelectAnnotation?.(coveringAnnot[0].annotation.id)
              return
            }

            if (!hasAiError && !isManualEditSpan) {
              return
            }

            ev.stopPropagation()
            if (isManualEditSpan) {
              onSelectManualEdit?.(paraIdx)
              return
            }
            if (ids.length <= 1) { ids[0] && onSelect(ids[0]); return }
            const cur = ids.indexOf(selectedId)
            onSelect(ids[(cur + 1) % ids.length])
          }}
          style={{
            cursor: 'pointer',
            padding: (isSelected || isAnnotSelected) ? '1px 3px' : (isCharDiff ? '0 1px' : '0'),
            backgroundColor: isSelected ? color.bgHighlight : (isAnnotSelected ? 'rgba(124, 58, 237, 0.15)' : 'transparent'),
            borderBottom,
            textDecoration,
            color: colorStyle,
            borderRadius: (isSelected || isAnnotSelected) ? 3 : (isCharDiff ? 3 : 0),
            boxShadow: isSelected ? '0 0 0 1.5px #d48806' : (isAnnotSelected ? '0 0 0 1.5px #7c3aed' : undefined),
            transition: 'border-bottom 0.1s ease, background-color 0.15s ease, box-shadow 0.15s ease',
          }}
        >
          {segText}
        </span>
        {endingAnnots.map(ea => (
          <span
            key={`annot_badge_${ea.annotation.id}`}
            style={{
              color: String(ea.annotation.id) === String(selectedAnnotationId) ? '#6b21a8' : '#7c3aed',
              fontWeight: 700,
              fontSize: '0.82em',
              marginLeft: 2,
              marginRight: 3,
              cursor: 'pointer',
              userSelect: 'none',
              padding: '1px 4px',
              background: String(ea.annotation.id) === String(selectedAnnotationId) ? '#f3e8ff' : '#faf5ff',
              borderRadius: 4,
              border: '1px solid #d8b4fe',
            }}
            onClick={(ev) => {
              if (mergeMode) return
              ev.stopPropagation()
              onSelectAnnotation?.(ea.annotation.id)
            }}
          >
            [注{ea.numIndex}]
          </span>
        ))}
      </React.Fragment>,
    )
  }

  // 结尾处的纯删除与纯新增标签
  const lastPos = points[points.length - 1]
  if (lastPos === text.length && (pureDeletionsByPos[lastPos] || pureAdditionsByPos[lastPos])) {
    segs.push(
      <React.Fragment key={`seg_last`}>
        {renderDeletionTags(lastPos)}
        {renderAdditionTags(lastPos)}
      </React.Fragment>
    )
  }

  return <span>{segs}</span>
}
