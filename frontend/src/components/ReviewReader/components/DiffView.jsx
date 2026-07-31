import React, { useMemo } from 'react'
import { color, radius, spacing, fontSize } from '../../../design-tokens'
import { computeLcsDiffChunks } from '../utils/diffUtils'

export function DiffView({ original, suggested, fontSize: customFs }) {
  const chunks = useMemo(
    () => computeLcsDiffChunks(original, suggested),
    [original, suggested],
  )
  return (
    <div style={{
      background: color.bgCard,
      borderRadius: radius.md,
      padding: `${spacing.sm}px ${spacing.md}px`,
      fontSize: customFs || fontSize.bodySm,
      lineHeight: 1.8,
      border: `1px solid ${color.border}`,
      wordBreak: 'break-all',
    }}>
      {chunks.map((chunk, idx) => {
        if (chunk.type === 'unchanged') {
          return <span key={idx} style={{ color: color.textPrimary }}>{chunk.text}</span>
        }
        if (chunk.type === 'removed') {
          return (
            <span
              key={idx}
              style={{
                background: color.diffRemovedBg,
                color: color.diffRemovedText,
                textDecoration: 'line-through',
                padding: '1px 4px',
                borderRadius: radius.sm,
                margin: '0 1px',
              }}
            >
              {chunk.text}
            </span>
          )
        }
        if (chunk.type === 'added') {
          return (
            <span
              key={idx}
              style={{
                background: color.diffAddedBg,
                color: color.diffAddedText,
                fontWeight: 600,
                padding: '1px 4px',
                borderRadius: radius.sm,
                margin: '0 1px',
              }}
            >
              {chunk.text}
            </span>
          )
        }
        return null
      })}
    </div>
  )
}

export function CompactDiffView({ original, suggested }) {
  const chunks = useMemo(
    () => computeLcsDiffChunks(original, suggested),
    [original, suggested],
  )
  const changeChunks = useMemo(
    () => chunks.filter(c => c.type !== 'unchanged'),
    [chunks],
  )

  if (changeChunks.length === 0) return null

  const hasOnlyDeletions = changeChunks.length > 0 && changeChunks.every(c => c.type === 'removed')
  const hasOnlyAdditions = changeChunks.length > 0 && changeChunks.every(c => c.type === 'added')

  const labelText = hasOnlyDeletions ? '已删字：' : hasOnlyAdditions ? '新增：' : '变动：'
  const labelColor = hasOnlyDeletions ? '#cf1322' : hasOnlyAdditions ? '#389e0d' : color.textTertiary

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', margin: '4px 0 6px' }}>
      <span style={{ fontSize: 11, color: labelColor, fontWeight: 600 }}>
        {labelText}
      </span>
      {changeChunks.map((chunk, idx) => {
        if (chunk.type === 'removed') {
          return (
            <span
              key={idx}
              style={{
                background: '#fff1f0',
                color: '#cf1322',
                textDecoration: 'line-through',
                padding: '1px 6px',
                borderRadius: radius.sm,
                fontSize: 12,
                border: '1px solid #ffa39e',
              }}
            >
              {chunk.text}
            </span>
          )
        }
        if (chunk.type === 'added') {
          return (
            <span
              key={idx}
              style={{
                background: '#d9f7be',
                color: '#389e0d',
                fontWeight: 600,
                padding: '1px 6px',
                borderRadius: radius.sm,
                fontSize: 12,
                border: '1px solid #b7eb8f',
              }}
            >
              + {chunk.text}
            </span>
          )
        }
        return null
      })}
    </div>
  )
}
