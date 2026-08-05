import React, { useState, useMemo, forwardRef } from 'react'
import { Button, Tag, Space, Input, Popconfirm, message } from 'antd'
import { CloseOutlined, DeleteOutlined, ScissorOutlined } from '@ant-design/icons'
import { color, radius } from '../../../design-tokens'
import { getCircledNum, parseEditNotes } from '../utils/readerUtils'
import { DiffView, CompactDiffView } from './DiffView'

function ManualEditDetailCardInner({ para, onSaveNote, onDeleteNoteItem, onRevert, onClose, currentBodyFontSize }, ref) {
  const [newNoteText, setNewNoteText] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [savingNote, setSavingNote] = useState(false)

  const notesList = useMemo(() => parseEditNotes(para?.edit_note), [para?.edit_note])
  const currentCount = Math.max(1, notesList.length)
  const circledTag = getCircledNum(currentCount)

  const baseFs = currentBodyFontSize || 16
  const scale = Math.min(baseFs / 16, 1.25)
  const cardWidth = Math.min(Math.round(400 * scale), 480)

  if (!para) return null

  const handleAddNote = async () => {
    if (!newNoteText.trim()) return
    setSavingNote(true)
    try {
      await onSaveNote?.(para.idx, para.revised_text, newNoteText.trim())
      setNewNoteText('')
      setIsAdding(false)
      message.success('已追加修改备注')
    } catch {
      message.error('追加备注失败')
    } finally {
      setSavingNote(false)
    }
  }

  const handleDeleteItem = async (noteId) => {
    const updated = notesList.filter(n => n.id !== noteId)
    try {
      await onDeleteNoteItem?.(para.idx, updated)
      message.success('已删除选定备注记录')
    } catch {
      message.error('删除失败')
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
        boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        border: `1px solid ${color.borderSelected}`,
        transition: 'all 0.15s ease',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Space size={6}>
          <Tag color="blue" style={{ fontSize: Math.round(12 * scale), margin: 0, fontWeight: 600 }}>
            📝 手工修改记录
          </Tag>
          <Tag style={{ fontSize: Math.round(12 * scale), margin: 0 }}>第{para.idx + 1}段</Tag>
        </Space>
        <Button type="text" size="small" icon={<CloseOutlined style={{ fontSize: Math.round(12 * scale) }} />} onClick={onClose} />
      </div>

      <div style={{ marginBottom: 10 }}>
        <DiffView original={para.text} suggested={para.revised_text} fontSize={Math.round(14 * scale)} />
      </div>

      <div style={{ background: color.bgPage, padding: `${Math.round(8 * scale)}px ${Math.round(10 * scale)}px`, borderRadius: radius.sm, border: `1px solid ${color.border}`, marginBottom: 10, fontSize: Math.round(13 * scale), lineHeight: 1.6 }}>
        <div style={{ color: color.textSecondary, fontSize: Math.round(12 * scale), marginBottom: 4, fontWeight: 500 }}>
          📄 初始原文内容：
        </div>
        <div style={{ color: color.textPrimary, wordBreak: 'break-all' }}>
          {para.text}
        </div>
      </div>

      <div style={{ background: 'var(--color-bgChapterSelected, #e6f7ff)', padding: `${Math.round(10 * scale)}px ${Math.round(12 * scale)}px`, borderRadius: radius.sm, border: `1px solid ${color.border}`, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ color: 'var(--color-primary, #1890ff)', fontSize: Math.round(12 * scale), fontWeight: 600 }}>
            📜 修改原因履历 ({notesList.length} 条)
          </div>
          {!isAdding && (
            <Button type="link" size="small" style={{ padding: 0, height: 'auto', fontSize: Math.round(12 * scale) }} onClick={() => setIsAdding(true)}>
              + 追加备注
            </Button>
          )}
        </div>

        {notesList.length === 0 && !isAdding ? (
          <div style={{ color: color.textTertiary, fontStyle: 'italic', fontSize: Math.round(12 * scale) }}>
            暂无修改原因备注（编辑段落时可录入）
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflowY: 'auto', marginBottom: isAdding ? 8 : 0 }}>
            {notesList.map((item, index) => {
              const prevText = index === 0 ? para.text : (notesList[index - 1].revised_text || para.text)
              const thisText = item.revised_text || para.revised_text
              const hasDiff = prevText && thisText && prevText !== thisText

              return (
                <div
                  key={item.id || index}
                  style={{
                    background: color.bgCard,
                    padding: `${Math.round(8 * scale)}px ${Math.round(10 * scale)}px`,
                    borderRadius: radius.sm,
                    border: `1px solid ${color.border}`,
                    fontSize: Math.round(12 * scale),
                    lineHeight: 1.5,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, color: 'var(--color-primary, #096dd9)' }}>
                      {getCircledNum(index + 1)} 修改
                    </span>
                    <Space size={4}>
                      <span style={{ fontSize: Math.round(11 * scale), color: color.textTertiary }}>
                        📅 {item.created_at}
                      </span>
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined style={{ fontSize: Math.round(11 * scale) }} />}
                        style={{ padding: '0 2px', height: 'auto' }}
                        onClick={() => handleDeleteItem(item.id)}
                        title="删除该条备注记录"
                      />
                    </Space>
                  </div>
                  {hasDiff && (
                    <CompactDiffView original={prevText} suggested={thisText} />
                  )}
                  <div style={{ color: color.textPrimary, wordBreak: 'break-all', fontStyle: item.note ? 'normal' : 'italic' }}>
                    💬 {item.note || '未填写备注'}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {isAdding && (
          <Space direction="vertical" style={{ width: '100%', marginTop: 6 }} size={6}>
            <Input.TextArea
              value={newNoteText}
              onChange={e => setNewNoteText(e.target.value)}
              placeholder="输入追加修改原因备注..."
              autoSize={{ minRows: 2, maxRows: 4 }}
              size="small"
              style={{ fontSize: Math.round(12 * scale) }}
            />
            <Space size="small" style={{ justifyContent: 'flex-end', width: '100%' }}>
              <Button size="small" style={{ fontSize: Math.round(12 * scale) }} onClick={() => setIsAdding(false)}>
                取消
              </Button>
              <Button type="primary" size="small" style={{ fontSize: Math.round(12 * scale) }} loading={savingNote} onClick={handleAddNote}>
                追加提交
              </Button>
            </Space>
          </Space>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Popconfirm
          title="确定恢复初始原文？"
          description="恢复后将清除该段落的所有修改与多轮备注履历。"
          onConfirm={() => onRevert?.(para.idx)}
          okText="确定恢复"
          okButtonProps={{ danger: true }}
          cancelText="取消"
        >
          <Button danger size="small" icon={<ScissorOutlined />} style={{ fontSize: Math.round(12 * scale) }}>
            恢复初始原文
          </Button>
        </Popconfirm>
      </div>
    </div>
  )
}

export const ManualEditDetailCard = forwardRef(ManualEditDetailCardInner)
