import React, { useState, useEffect } from 'react'
import { Modal, Input, Typography, Space, Tag } from 'antd'
import { BookOutlined } from '@ant-design/icons'
import { color } from '../../../design-tokens'

const { Text } = Typography

export function AnnotationModal({ open, selectionData, onOk, onCancel }) {
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setContent('')
      setSubmitting(false)
    }
  }, [open])

  const handleConfirm = async () => {
    if (!content.trim() || submitting) return
    setSubmitting(true)
    try {
      await onOk?.({
        selectedText: selectionData?.selectedText,
        paragraphIdx: selectionData?.paragraphIdx,
        paragraphUuid: selectionData?.paragraphUuid,
        content: content.trim(),
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title={
        <Space size={6}>
          <Tag color="purple" style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>
            <BookOutlined style={{ marginRight: 4 }} />
            划线添加注释
          </Tag>
          <Text type="secondary" style={{ fontSize: 13 }}>
            第 {selectionData?.paragraphIdx ? selectionData.paragraphIdx + 1 : 1} 段
          </Text>
        </Space>
      }
      open={open}
      onOk={handleConfirm}
      onCancel={onCancel}
      confirmLoading={submitting}
      okText="保存注释"
      cancelText="取消"
      okButtonProps={{ disabled: !content.trim() }}
      destroyOnClose
      centered
      width={480}
    >
      <div style={{ margin: '12px 0 16px' }}>
        <div style={{ color: color.textSecondary, fontSize: 12, marginBottom: 6, fontWeight: 500 }}>
          📝 引用文字：
        </div>
        <div
          style={{
            background: 'var(--color-bgPage, #f8fafc)',
            borderLeft: '3px solid #7c3aed',
            padding: '8px 12px',
            borderRadius: '0 6px 6px 0',
            fontSize: 14,
            lineHeight: 1.6,
            color: color.textPrimary,
            wordBreak: 'break-all',
          }}
        >
          {selectionData?.selectedText}
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ color: color.textSecondary, fontSize: 12, marginBottom: 6, fontWeight: 500 }}>
          💬 注释内容：
        </div>
        <Input.TextArea
          rows={4}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="请输入对此处划线文字的解释、出处、词义或备注..."
          maxLength={500}
          showCount
          autoFocus
        />
      </div>
    </Modal>
  )
}
