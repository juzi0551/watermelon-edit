import React, { useState, forwardRef } from 'react'
import { Button, Tag } from 'antd'
import { CloseOutlined } from '@ant-design/icons'
import { color, radius } from '../../../design-tokens'
import { TYPE_LABEL, SEVERITY_COLOR, SEVERITY_LABEL } from '../constants'
import { DiffView } from './DiffView'

function ErrorDetailCardInner({ error, onAccept, onReject, onClose, currentBodyFontSize }, ref) {
  const pending = error.user_status === 'pending'
  const [btnState, setBtnState] = useState(null)

  const baseFs = currentBodyFontSize || 16
  const scale = baseFs / 16
  const cardWidth = Math.round(380 * scale)

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        zIndex: 500,
        width: cardWidth,
        padding: `${Math.round(14 * scale)}px ${Math.round(16 * scale)}px ${Math.round(12 * scale)}px`,
        background: color.bgCard,
        borderRadius: radius.md,
        borderLeft: `3px solid ${color.warning}`,
        boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        opacity: 0,
        transform: 'translateY(3px)',
        transition: 'opacity 0.08s cubic-bezier(0, 0, 0.2, 1), transform 0.08s cubic-bezier(0, 0, 0.2, 1)',
      }}
    >
      <div style={{ position: 'relative' }}>
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined style={{ fontSize: Math.round(12 * scale) }} />}
          onClick={onClose}
          style={{
            position: 'absolute',
            top: -2,
            right: -4,
            color: color.textMuted,
            width: Math.round(24 * scale),
            height: Math.round(24 * scale),
          }}
        />
        <div style={{ marginBottom: 6, paddingRight: 20 }}>
          <div style={{ fontSize: Math.round(12 * scale), color: color.textSecondary, marginBottom: 2 }}>
            第 {error.paragraph_index} 段
          </div>
          <div style={{ marginBottom: 6 }}>
            <DiffView original={error.original_text} suggested={error.suggested_text} fontSize={Math.round(14 * scale)} />
          </div>
        </div>
      </div>
      <div style={{
        fontSize: Math.round(13 * scale),
        color: color.textDescription,
        marginBottom: 10,
        lineHeight: 1.6,
        padding: `${Math.round(6 * scale)}px ${Math.round(10 * scale)}px`,
        background: color.bgPage,
        borderRadius: radius.sm,
      }}>
        {error.description}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        <Tag style={{ margin: 0, fontSize: Math.round(11 * scale), lineHeight: `${Math.round(20 * scale)}px` }}>{TYPE_LABEL[error.type] || error.type}</Tag>
        <Tag color={SEVERITY_COLOR[error.severity]} style={{ margin: 0, fontSize: Math.round(11 * scale), lineHeight: `${Math.round(20 * scale)}px` }}>
          {SEVERITY_LABEL[error.severity]}危
        </Tag>
        {!pending && (
          <Tag color={error.user_status === 'accepted' ? 'green' : 'red'} style={{ margin: '0 0 0 auto', fontSize: Math.round(11 * scale), lineHeight: `${Math.round(20 * scale)}px` }}>
            {error.user_status === 'accepted' ? '已采纳' : '已拒绝'}
          </Tag>
        )}
        {pending && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <Button
              size="small"
              shape="round"
              onClick={(e) => {
                e.stopPropagation()
                setBtnState('accepted')
                setTimeout(() => {
                  setBtnState(null)
                  onAccept?.()
                }, 100)
              }}
              style={{
                height: Math.round(26 * scale), fontSize: Math.round(12 * scale), paddingInline: Math.round(12 * scale), lineHeight: `${Math.round(24 * scale)}px`,
                backgroundColor: btnState === 'accepted' ? '#52c41a' : 'transparent',
                color: btnState === 'accepted' ? '#ffffff' : '#52c41a',
                borderColor: '#52c41a',
                boxShadow: 'none',
                transition: 'all 0.05s ease',
              }}
            >
              采纳
            </Button>
            <Button
              size="small"
              shape="round"
              onClick={(e) => {
                e.stopPropagation()
                setBtnState('rejected')
                setTimeout(() => {
                  setBtnState(null)
                  onReject?.()
                }, 100)
              }}
              style={{
                height: Math.round(26 * scale), fontSize: Math.round(12 * scale), paddingInline: Math.round(12 * scale), lineHeight: `${Math.round(24 * scale)}px`,
                backgroundColor: btnState === 'rejected' ? '#ff4d4f' : 'transparent',
                color: btnState === 'rejected' ? '#ffffff' : color.textPrimary,
                borderColor: btnState === 'rejected' ? '#ff4d4f' : color.border,
                boxShadow: 'none',
                transition: 'all 0.05s ease',
              }}
            >
              拒绝
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export const ErrorDetailCard = forwardRef(ErrorDetailCardInner)
