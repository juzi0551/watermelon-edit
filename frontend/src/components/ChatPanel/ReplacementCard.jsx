import React, { useState, useEffect, useMemo } from 'react'
import { Button, Tooltip, Tag } from 'antd'
import { CheckOutlined, CloseOutlined, DiffOutlined } from '@ant-design/icons'
import { updateCardStatus } from '../../services/api'

export function ReplacementCard({
  cardData,
  paragraphIdx,
  paragraphUuid,
  isCrossPara,
  onApplyText,
  bodyFontSize = 17,
  projectId,
  messageId,
  onScrollToParagraph,
}) {
  const [status, setStatus] = useState(cardData?.status || 'pending')
  const [selectedOptionIdx, setSelectedOptionIdx] = useState(0)

  useEffect(() => {
    if (cardData?.status) {
      setStatus(cardData.status)
    }
  }, [cardData?.status])

  // 智能提取平铺多候选方案列表
  const optionsList = useMemo(() => {
    const rawOptions = cardData?.options
    if (Array.isArray(rawOptions) && rawOptions.length > 0) {
      return rawOptions.map((opt, idx) => {
        const fullLabel = opt.label || opt.name || `方案 ${idx + 1}`
        const cleanName = fullLabel.replace(/^(方案[一二三四五六七八九十0-9]+[：:]\s*)/, '').trim()
        return {
          fullLabel,
          cleanName: cleanName || fullLabel,
          replacement: opt.replacement_text || opt.replacement || opt.text || '',
          note: opt.note || opt.description || cardData?.note || '',
        }
      })
    }
    const defaultText = cardData?.replacement || cardData?.replacement_text || ''
    return [
      {
        fullLabel: '推荐方案',
        cleanName: '推荐方案',
        replacement: defaultText,
        note: cardData?.note || '',
      },
    ]
  }, [cardData?.options, cardData?.replacement, cardData?.replacement_text, cardData?.note])

  const currentOption = optionsList[selectedOptionIdx] || optionsList[0] || {}
  const currentReplacement = currentOption?.replacement || cardData?.replacement || cardData?.replacement_text || ''

  if (!cardData || (!currentReplacement && (!optionsList || optionsList.length === 0))) return null

  const handleApply = () => {
    if (status !== 'pending' || isCrossPara || !onApplyText) return
    const textToApply = currentOption.replacement || cardData.replacement
    const noteToApply = currentOption.note || cardData.note
    onApplyText(textToApply, paragraphIdx, paragraphUuid, noteToApply, cardData.original)
    setStatus('accepted')
    if (projectId && messageId && !messageId.startsWith('temp_')) {
      updateCardStatus(projectId, messageId, 'accepted').catch(console.error)
    }
  }

  const handleReject = () => {
    if (status !== 'pending') return
    setStatus('rejected')
    if (projectId && messageId && !messageId.startsWith('temp_')) {
      updateCardStatus(projectId, messageId, 'rejected').catch(console.error)
    }
  }

  const btnFontSize = `${Math.max(13, bodyFontSize - 2)}px`
  const noteFontSize = `${Math.max(12, bodyFontSize - 3)}px`

  const targetIdx = paragraphIdx ?? cardData?.paragraph_idx ?? cardData?.paragraphIdx
  const isDefined = targetIdx !== undefined && targetIdx !== null

  return (
    <div
      style={{
        marginTop: 12,
        padding: '14px 16px',
        borderRadius: 12,
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
      }}
    >
      {/* 头部：标题与段落 Tag */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: btnFontSize, fontWeight: 600, color: '#1e293b' }}>
          <DiffOutlined style={{ color: '#2563eb' }} />
          <span>建议修改方案</span>
          <Tooltip title={isDefined ? `点击跳转至第 ${targetIdx} 段并高亮` : '段落未定'}>
            <Tag
              color={isDefined ? "blue" : "volcano"}
              onClick={() => isDefined && onScrollToParagraph?.(targetIdx)}
              style={{
                marginLeft: 4,
                fontWeight: 500,
                fontSize: 11,
                borderRadius: 4,
                cursor: isDefined ? 'pointer' : 'default',
                userSelect: 'none',
              }}
            >
              段落 #{isDefined ? targetIdx : 'undefined'}
            </Tag>
          </Tooltip>
        </div>
        {status === 'accepted' && <Tag color="green" style={{ margin: 0, fontSize: 11 }}>已采纳</Tag>}
        {status === 'rejected' && <Tag color="default" style={{ margin: 0, fontSize: 11 }}>已拒绝</Tag>}
      </div>

      {/* 原文展现：使用典雅灰左边框线引用 */}
      {cardData.original && (
        <div
          style={{
            padding: '8px 12px',
            background: '#f8fafc',
            borderLeft: '3px solid #94a3b8',
            borderRadius: '0 6px 6px 0',
            marginBottom: 12,
            fontSize: `${Math.max(13, bodyFontSize - 1)}px`,
            lineHeight: 1.6,
            color: '#475569',
          }}
        >
          <span style={{ fontWeight: 600, color: '#64748b', marginRight: 6 }}>原文：</span>
          {cardData.original}
        </div>
      )}

      {/* 平铺所有候选方案，支持点击 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
        {optionsList.map((opt, idx) => {
          const isSelected = selectedOptionIdx === idx
          return (
            <div
              key={idx}
              onClick={() => status === 'pending' && setSelectedOptionIdx(idx)}
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                cursor: status === 'pending' ? 'pointer' : 'default',
                background: isSelected ? '#f0fdf4' : '#ffffff',
                border: isSelected ? '1.5px solid #22c55e' : '1px solid #e2e8f0',
                transition: 'all 0.15s ease',
                boxShadow: isSelected ? '0 2px 8px rgba(34, 197, 94, 0.12)' : 'none',
              }}
            >
              {/* 方案标题：右对齐浅灰色方案名（字号为 bodyFontSize - 4） */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginBottom: 4 }}>
                <span style={{ fontWeight: 500, fontSize: `${Math.max(11, bodyFontSize - 4)}px`, color: '#94a3b8' }}>
                  {opt.cleanName}
                </span>
                {isSelected && status === 'pending' && optionsList.length > 1 && (
                  <Tag color="green" style={{ fontSize: 10, height: 18, lineHeight: '16px', margin: 0, borderRadius: 4 }}>
                    已选中
                  </Tag>
                )}
                {isSelected && status === 'accepted' && (
                  <Tag color="green" style={{ fontSize: 10, height: 18, lineHeight: '16px', margin: 0, borderRadius: 4 }}>
                    ✓ 已采纳
                  </Tag>
                )}
              </div>

              {/* 改写内容：改写前缀与改写内容保持同行 */}
              <div style={{ fontSize: `${bodyFontSize}px`, lineHeight: 1.65, color: isSelected ? '#14532d' : '#1f2937' }}>
                <span style={{ fontWeight: 600, color: isSelected ? '#166534' : '#475569', marginRight: 6 }}>改写：</span>
                {opt.replacement}
              </div>

              {/* 浅灰色非通栏分割线 + 去掉图标的理由 */}
              {opt.note && (
                <>
                  <div style={{ height: 1, background: '#e2e8f0', margin: '8px 0 6px 0', width: '92%' }} />
                  <div style={{ fontSize: noteFontSize, color: isSelected ? '#374151' : '#64748b', lineHeight: 1.5 }}>
                    <span style={{ fontWeight: 500, color: isSelected ? '#4b5563' : '#64748b', marginRight: 4 }}>理由：</span>
                    {opt.note}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* 采纳与拒绝操作按钮 */}
      {isCrossPara ? (
        <Tooltip title="V1 首版跨段修改暂请手动复制应用">
          <Button size="middle" disabled block style={{ fontSize: btnFontSize }}>
            跨段修改请手动复制应用
          </Button>
        </Tooltip>
      ) : status === 'accepted' ? null : status === 'rejected' ? (
        <Button size="middle" disabled block icon={<CloseOutlined />} style={{ fontSize: btnFontSize, borderRadius: 6, height: 36 }}>
          已忽略修改建议
        </Button>
      ) : (
        <div style={{ display: 'flex', gap: 10 }}>
          <Button
            size="middle"
            type="primary"
            icon={<CheckOutlined />}
            onClick={handleApply}
            style={{
              flex: 1,
              fontSize: btnFontSize,
              borderRadius: 6,
              height: 36,
              background: '#22c55e',
              borderColor: '#22c55e',
              fontWeight: 600,
            }}
          >
            采纳
          </Button>
          <Button
            size="middle"
            icon={<CloseOutlined />}
            onClick={handleReject}
            style={{
              flex: 1,
              fontSize: btnFontSize,
              borderRadius: 6,
              height: 36,
              background: '#f8fafc',
              borderColor: '#cbd5e1',
              color: '#64748b',
            }}
          >
            拒绝
          </Button>
        </div>
      )}
    </div>
  )
}
