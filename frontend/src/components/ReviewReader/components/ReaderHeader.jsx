import React, { useState } from 'react'
import { Button, Popover, List, Typography, Badge, Space, Tag } from 'antd'
import { UnorderedListOutlined, WarningOutlined, RightOutlined } from '@ant-design/icons'
import { color } from '../../../design-tokens'

const { Text } = Typography

export function ReaderHeader({
  project,
  chapters = [],
  selectedChapter,
  onSelectChapter,
  pendingCount = 0,
  panelOpen,
  onTogglePanel,
  tbFontSize,
}) {
  const [popoverOpen, setPopoverOpen] = useState(false)
  const subFontSize = Math.max(12, (tbFontSize || 17) - 2)

  const chapterMenuContent = (
    <div style={{
      width: 280,
      maxHeight: 'calc(100vh - 140px)',
      overflowY: 'auto',
      padding: '4px 0',
    }}>
      <div style={{
        padding: '8px 12px 6px',
        borderBottom: '1px solid var(--color-border)',
        marginBottom: 6,
        fontWeight: 600,
        fontSize: subFontSize + 1,
        color: color.textPrimary,
      }}>
        章节目录 ({chapters.length})
      </div>
      {chapters.length === 0 ? (
        <div style={{ padding: '16px 12px', textAlign: 'center' }}>
          <Text type="secondary" style={{ fontSize: subFontSize }}>尚未生成章节结构</Text>
        </div>
      ) : (
        <List
          size="small"
          dataSource={chapters}
          renderItem={(ch) => {
            const isSelected = selectedChapter === ch.id
            return (
              <List.Item
                style={{
                  cursor: 'pointer',
                  paddingLeft: ((ch.level || 1) - 1) * 12 + 10,
                  paddingRight: 10,
                  paddingTop: 6,
                  paddingBottom: 6,
                  background: isSelected ? color.bgChapterSelected : 'transparent',
                  borderRadius: 6,
                  margin: '2px 4px',
                  transition: 'background 0.15s',
                }}
                onClick={() => {
                  onSelectChapter?.(ch.id)
                  setPopoverOpen(false)
                }}
              >
                <Space style={{ width: '100%', justifyContent: 'space-between', minWidth: 0 }}>
                  <Text
                    ellipsis
                    style={{
                      fontSize: ch.level >= 3 ? Math.max(11, subFontSize - 1) : subFontSize,
                      fontWeight: ch.level === 1 ? 600 : isSelected ? 600 : 400,
                      color: isSelected ? color.primary : ch.level >= 3 ? color.textTertiary : color.textPrimary,
                      flex: 1,
                    }}
                  >
                    {(() => {
                      const isLegacyTitle = /^第 \d+ 段$/.test(ch.title || '') && 
                                            parseInt((ch.title || '').slice(2)) === ch.title_paragraph_idx
                      if (ch.title && !isLegacyTitle) return ch.title
                      return `第 ${(ch.title_paragraph_idx ?? 0) + 1} 段`
                    })()}
                  </Text>
                  {ch.detected_by === 'manual' ? (
                    <Tag color="green" style={{ fontSize: 10, margin: 0, padding: '0 4px', lineHeight: '16px', flexShrink: 0 }}>人工</Tag>
                  ) : ch.detected_by === 'llm' ? (
                    <Tag color="purple" style={{ fontSize: 10, margin: 0, padding: '0 4px', lineHeight: '16px', flexShrink: 0 }}>AI识别</Tag>
                  ) : (
                    <Tag color="blue" style={{ fontSize: 10, margin: 0, padding: '0 4px', lineHeight: '16px', flexShrink: 0 }}>原文</Tag>
                  )}
                </Space>
              </List.Item>
            )
          }}
        />
      )}
    </div>
  )

  return (
    <div style={{
      height: 56,
      minHeight: 56,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      background: 'var(--color-bgCard, #fafafa)',
      borderTop: '1px solid var(--color-borderStrong, #d9d9d9)',
      borderLeft: '1px solid var(--color-borderStrong, #d9d9d9)',
      borderRight: '1px solid var(--color-borderStrong, #d9d9d9)',
      borderBottom: '1px solid var(--color-borderStrong, #d9d9d9)',
      borderTopLeftRadius: 10,
      borderTopRightRadius: 0,
      marginBottom: 0,
      userSelect: 'none',
      position: 'relative',
    }}>
      {/* 左侧：目录下拉按钮 */}
      <div style={{ display: 'flex', alignItems: 'center', zIndex: 2 }}>
        <Popover
          trigger="click"
          open={popoverOpen}
          onOpenChange={setPopoverOpen}
          placement="bottomLeft"
          content={chapterMenuContent}
          styles={{ body: { padding: 0 } }}
        >
          <Button
            type="text"
            icon={<UnorderedListOutlined style={{ fontSize: 16 }} />}
            style={{
              height: 36,
              paddingInline: 12,
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 500,
              color: color.textPrimary,
            }}
          >
            目录 <RightOutlined style={{ fontSize: 10, opacity: 0.6, transform: popoverOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
          </Button>
        </Popover>
      </div>

      {/* 中间：绝对居中的书名 */}
      <div style={{
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        maxWidth: '55%',
        textAlign: 'center',
        zIndex: 1,
        pointerEvents: 'none',
      }}>
        <Text
          ellipsis
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: color.textPrimary,
            pointerEvents: 'auto',
          }}
          title={project?.name || project?.title || project?.filename || '项目正文'}
        >
          {project?.name || project?.title || project?.filename || '项目正文'}
        </Text>
      </div>

      {/* 右侧：最右侧靠齐的问题按钮 */}
      <div style={{ display: 'flex', alignItems: 'center', zIndex: 2, marginLeft: 'auto' }}>
        <Button
          type={panelOpen ? 'primary' : 'text'}
          icon={<WarningOutlined style={{ fontSize: 15 }} />}
          onClick={onTogglePanel}
          style={{
            height: 36,
            paddingInline: 12,
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          问题诊断
          {pendingCount > 0 && (
            <Badge
              count={pendingCount}
              overflowCount={999}
              style={{
                marginLeft: 6,
                backgroundColor: panelOpen ? '#fff' : '#ff4d4f',
                color: panelOpen ? '#333' : '#fff',
                fontWeight: 600,
                boxShadow: 'none',
              }}
            />
          )}
        </Button>
      </div>
    </div>
  )
}
