import React, { useState, forwardRef } from 'react'
import { Button, Tag, Space, Input, Popconfirm, message } from 'antd'
import { CloseOutlined, DeleteOutlined, EditOutlined, BookOutlined, CheckOutlined } from '@ant-design/icons'
import { color, radius } from '../../../design-tokens'

function AnnotationDetailCardInner({ annotation, onUpdate, onDelete, onClose, currentBodyFontSize, numIndex = 1 }, ref) {
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)

  const baseFs = currentBodyFontSize || 16
  const scale = Math.min(baseFs / 16, 1.25)
  const cardWidth = Math.min(Math.round(380 * scale), 460)

  if (!annotation) return null

  const handleStartEdit = () => {
    setEditContent(annotation.content || '')
    setIsEditing(true)
  }

  const handleSaveEdit = async () => {
    if (!editContent.trim()) return
    setSaving(true)
    try {
      await onUpdate?.(annotation.id, editContent.trim())
      setIsEditing(false)
      message.success('已更新注释')
    } catch {
      message.error('更新注释失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    try {
      await onDelete?.(annotation.id)
      message.success('已删除注释')
    } catch {
      message.error('删除注释失败')
    }
  }

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
        boxShadow: '0 8px 24px rgba(124, 58, 237, 0.18)',
        border: `1px solid #c084fc`,
        transition: 'all 0.15s ease',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Space size={6}>
          <Tag color="purple" style={{ fontSize: Math.round(12 * scale), margin: 0, fontWeight: 600 }}>
            <BookOutlined style={{ marginRight: 3 }} /> [注{numIndex}] 书籍注释
          </Tag>
          <Tag style={{ fontSize: Math.round(12 * scale), margin: 0 }}>
            第{(annotation.paragraph_idx ?? 0) + 1}段
          </Tag>
        </Space>
        <Button type="text" size="small" icon={<CloseOutlined style={{ fontSize: Math.round(12 * scale) }} />} onClick={onClose} />
      </div>

      <div
        style={{
          background: 'var(--color-bgPage, #f8fafc)',
          borderLeft: '3px solid #7c3aed',
          padding: `${Math.round(6 * scale)}px ${Math.round(10 * scale)}px`,
          borderRadius: '0 4px 4px 0',
          marginBottom: 10,
          fontSize: Math.round(13 * scale),
          lineHeight: 1.5,
          color: color.textPrimary,
          wordBreak: 'break-all',
        }}
      >
        <span style={{ color: color.textTertiary, fontSize: Math.round(11 * scale), marginRight: 4 }}>引用：</span>
        {annotation.selected_text}
      </div>

      <div style={{ background: '#faf5ff', padding: `${Math.round(10 * scale)}px ${Math.round(12 * scale)}px`, borderRadius: radius.sm, border: '1px solid #e9d5ff', marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ color: '#6b21a8', fontSize: Math.round(12 * scale), fontWeight: 600 }}>
            💬 注释说明
          </span>
          <span style={{ fontSize: Math.round(11 * scale), color: color.textTertiary }}>
            📅 {annotation.created_at || ''}
          </span>
        </div>

        {isEditing ? (
          <Space direction="vertical" style={{ width: '100%' }} size={6}>
            <Input.TextArea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              autoSize={{ minRows: 2, maxRows: 5 }}
              size="small"
              style={{ fontSize: Math.round(12 * scale) }}
            />
            <Space size="small" style={{ justifyContent: 'flex-end', width: '100%' }}>
              <Button size="small" onClick={() => setIsEditing(false)} style={{ fontSize: Math.round(12 * scale) }}>
                取消
              </Button>
              <Button type="primary" size="small" icon={<CheckOutlined />} loading={saving} onClick={handleSaveEdit} style={{ fontSize: Math.round(12 * scale), background: '#7c3aed', borderColor: '#7c3aed' }}>
                保存
              </Button>
            </Space>
          </Space>
        ) : (
          <div style={{ color: color.textPrimary, fontSize: Math.round(13 * scale), lineHeight: 1.6, wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
            {annotation.content}
          </div>
        )}
      </div>

      {!isEditing && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button size="small" icon={<EditOutlined />} onClick={handleStartEdit} style={{ fontSize: Math.round(12 * scale) }}>
            编辑注释
          </Button>

          <Popconfirm
            title="确定删除此条注释？"
            description="删除后将无法恢复。"
            onConfirm={handleDelete}
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
          >
            <Button danger size="small" icon={<DeleteOutlined />} style={{ fontSize: Math.round(12 * scale) }}>
              删除
            </Button>
          </Popconfirm>
        </div>
      )}
    </div>
  )
}

export const AnnotationDetailCard = forwardRef(AnnotationDetailCardInner)
