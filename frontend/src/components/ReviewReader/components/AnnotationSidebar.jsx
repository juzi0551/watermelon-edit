import React, { memo } from 'react'
import { Button, Empty, Space, Tag } from 'antd'
import { MenuFoldOutlined, BookOutlined } from '@ant-design/icons'
import { color, radius, spacing } from '../../../design-tokens'

export const AnnotationSidebar = memo(function AnnotationSidebar({
  showPanel,
  onTogglePanel,
  annotations = [],
  selectedAnnotationId,
  onSelectAnnotation,
  jumpToParagraphExact,
  tbFontSize,
}) {
  const subFontSize = Math.max(12, (tbFontSize || 17) - 2)
  const tagFontSize = Math.max(11, subFontSize - 1)

  return (
    <div
      style={{
        width: showPanel ? 420 : 0,
        overflow: 'hidden',
        flexShrink: 0,
        display: showPanel ? 'block' : 'none',
        borderLeft: showPanel ? `1px solid ${color.border}` : 'none',
        background: color.bgPage,
        borderRadius: 8,
      }}
    >
      <div style={{ width: 420, height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* 面板标题 */}
        <div
          style={{
            display: 'flex',
            justify: 'space-between',
            alignItems: 'center',
            padding: '14px 16px',
            borderBottom: `1px solid ${color.border}`,
          }}
        >
          <Space size={6}>
            <BookOutlined style={{ color: '#7c3aed', fontSize: subFontSize + 2 }} />
            <span style={{ fontWeight: 600, fontSize: subFontSize + 2, color: color.textPrimary }}>
              书籍划线注释 ({annotations.length})
            </span>
          </Space>
          <Button
            type="text"
            size="small"
            icon={<MenuFoldOutlined style={{ transform: 'scaleX(-1)' }} />}
            onClick={onTogglePanel}
          />
        </div>

        {/* 注释列表内容 */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 16px 72px 16px' }}>
          {annotations.length === 0 ? (
            <Empty description="暂无书籍划线注释" style={{ marginTop: 40 }} />
          ) : (
            annotations.map((ann, index) => {
              const isSelected = String(ann.id) === String(selectedAnnotationId)
              const paraKey = ann.paragraph_uuid || ann.paragraph_idx

              return (
                <div
                  key={ann.id}
                  className="annotation-sidebar-item"
                  style={{
                    cursor: 'pointer',
                    background: isSelected ? '#faf5ff' : color.bgCard,
                    padding: '12px 14px',
                    borderRadius: radius.md,
                    marginBottom: 10,
                    borderTop: `1px solid ${isSelected ? '#c084fc' : color.border}`,
                    borderRight: `1px solid ${isSelected ? '#c084fc' : color.border}`,
                    borderBottom: `1px solid ${isSelected ? '#c084fc' : color.border}`,
                    borderLeft: `4px solid #7c3aed`,
                    boxShadow: isSelected ? '0 2px 8px rgba(124, 58, 237, 0.15)' : '0 1px 3px rgba(0,0,0,0.04)',
                    transition: 'all 0.15s ease',
                  }}
                  onClick={() => {
                    onSelectAnnotation?.(ann.id)
                    if (paraKey != null) {
                      jumpToParagraphExact?.(paraKey, 0, true)
                    }
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <Space size={6}>
                      <Tag color="purple" style={{ fontSize: tagFontSize, margin: 0, fontWeight: 700 }}>
                        [注{index + 1}]
                      </Tag>
                      <Tag style={{ fontSize: tagFontSize, margin: 0, background: color.bgChapterSelected, color: color.textSecondary }}>
                        第{(ann.paragraph_idx ?? 0) + 1}段
                      </Tag>
                    </Space>
                    <span style={{ fontSize: Math.max(10, tagFontSize - 1), color: color.textTertiary }}>
                      {ann.created_at || ''}
                    </span>
                  </div>

                  <div
                    style={{
                      fontSize: subFontSize,
                      fontWeight: 500,
                      color: color.textPrimary,
                      marginBottom: 6,
                      background: 'var(--color-bgPage, #f8fafc)',
                      borderLeft: '2px solid #7c3aed',
                      padding: '4px 8px',
                      borderRadius: '0 4px 4px 0',
                      wordBreak: 'break-all',
                    }}
                  >
                    <span style={{ color: color.textTertiary, fontSize: Math.max(10, tagFontSize - 1), marginRight: 4 }}>引用原句：</span>
                    {ann.selected_text}
                  </div>

                  <div
                    style={{
                      fontSize: subFontSize,
                      color: color.textPrimary,
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}
                  >
                    💬 {ann.content}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
})
