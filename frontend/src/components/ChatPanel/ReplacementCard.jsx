import React, { useState, useEffect, useMemo } from 'react'
import { Button, Tooltip, Tag, message } from 'antd'
import { CheckOutlined, CloseOutlined, DiffOutlined, DownOutlined, UpOutlined, UndoOutlined } from '@ant-design/icons'
import { updateCardStatus, restoreParagraph } from '../../services/api'
import { useParagraphStatus } from '../../hooks/useParagraphStatus'

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
  const [showAllAcceptedOptions, setShowAllAcceptedOptions] = useState(false)
  const [expandedRejected, setExpandedRejected] = useState(false)
  const [expandedAccepted, setExpandedAccepted] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const currentUuid = paragraphUuid || cardData?.paragraph_uuid || cardData?.paragraphUuid
  const { fetchStatus, statuses, invalidateCache } = useParagraphStatus(projectId)
  const liveStatus = currentUuid ? statuses[currentUuid] : null

  useEffect(() => {
    if (currentUuid && projectId) {
      fetchStatus(currentUuid)
    }
  }, [currentUuid, projectId, fetchStatus])

  const effectiveIdx = liveStatus?.target_idx ?? (paragraphIdx ?? cardData?.paragraph_idx ?? cardData?.paragraphIdx)
  const isMergedThenDeleted = liveStatus?.status === 'merged_then_deleted'
  const isMerged = (liveStatus?.status === 'merged' || Boolean(liveStatus?.target_uuid && liveStatus?.target_uuid !== currentUuid)) && !isMergedThenDeleted
  const isDeleted = ['deleted', 'merged_then_deleted'].includes(liveStatus?.status)
  const isStaleVersion = liveStatus?.status === 'stale_version'

  const handleRestore = async () => {
    if (!currentUuid || !projectId) return
    setRestoring(true)
    try {
      await restoreParagraph(projectId, currentUuid)
      message.success('已成功恢复该段落')
      invalidateCache(currentUuid)
      fetchStatus(currentUuid)
    } catch (e) {
      message.error(`恢复段落失败: ${e.message || '未知错误'}`)
    } finally {
      setRestoring(false)
    }
  }

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
    if (isDeleted) {
      message.error(isMergedThenDeleted ? '该段落已被合并且目标已被删除，无法应用修改' : '该段落已被逻辑删除，无法应用修改建议')
      return
    }
    if (isStaleVersion) {
      message.error('该修改建议属于旧版本的历史段落，无法应用至当前文档')
      return
    }
    const textToApply = currentOption.replacement || cardData.replacement
    const noteToApply = currentOption.note || cardData.note
    onApplyText(textToApply, effectiveIdx, currentUuid, noteToApply, cardData.original)
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

  const targetIdx = effectiveIdx
  const isDefined = targetIdx !== undefined && targetIdx !== null

  const renderStatusBadge = () => {
    if (isMergedThenDeleted) {
      return (
        <Tag color="volcano" style={{ margin: 0, fontWeight: 600, fontSize: `${Math.max(12, bodyFontSize - 4)}px`, padding: '2px 8px', borderRadius: 4 }}>
          ⚠️ 段落已被合并，但目标已被删除
        </Tag>
      )
    }
    if (isMerged) {
      return (
        <Tooltip title={`该段落已被合并，点击跳转至目标第 ${targetIdx + 1} 段`}>
          <Tag
            color="purple"
            onClick={() => isDefined && onScrollToParagraph?.(targetIdx)}
            style={{ margin: 0, fontWeight: 600, fontSize: `${Math.max(12, bodyFontSize - 4)}px`, padding: '2px 8px', borderRadius: 4, cursor: 'pointer' }}
          >
            ⚡️ 已合并至第 {targetIdx + 1} 段
          </Tag>
        </Tooltip>
      )
    }
    if (isDeleted) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Tag color="error" style={{ margin: 0, fontWeight: 600, fontSize: `${Math.max(12, bodyFontSize - 4)}px`, padding: '2px 8px', borderRadius: 4 }}>
            ⚠️ 段落已被逻辑删除
          </Tag>
          <Button
            type="link"
            size="small"
            icon={<UndoOutlined />}
            loading={restoring}
            onClick={handleRestore}
            style={{ padding: 0, fontSize: `${Math.max(12, bodyFontSize - 4)}px`, color: '#ef4444' }}
          >
            恢复段落
          </Button>
        </div>
      )
    }
    if (isStaleVersion) {
      return (
        <Tag color="warning" style={{ margin: 0, fontWeight: 600, fontSize: `${Math.max(12, bodyFontSize - 4)}px`, padding: '2px 8px', borderRadius: 4 }}>
          旧版本历史段落 (v{liveStatus?.version || 1})
        </Tag>
      )
    }
    return (
      <Tooltip title={isDefined ? `点击跳转至第 ${targetIdx + 1} 段并高亮` : '段落未定'}>
        <Tag
          color={isDefined ? "blue" : "volcano"}
          onClick={() => isDefined && onScrollToParagraph?.(targetIdx)}
          style={{
            margin: 0,
            fontWeight: 500,
            fontSize: `${Math.max(12, bodyFontSize - 4)}px`,
            padding: '2px 8px',
            borderRadius: 4,
            cursor: isDefined ? 'pointer' : 'default',
            userSelect: 'none',
          }}
        >
          段落 #{isDefined ? targetIdx + 1 : 'undefined'}
        </Tag>
      </Tooltip>
    )
  }

  // 1. 已拒绝且未展开时的提示状态卡片（增加卡片大小、字号与方案文字预览，提升清晰度）
  if (status === 'rejected' && !expandedRejected) {
    const previewText = currentReplacement ? (currentReplacement.length > 25 ? `${currentReplacement.slice(0, 25)}…` : currentReplacement) : ''
    const rejectedTagFontSize = `${Math.max(12, bodyFontSize - 4)}px`
    const rejectedBodyFontSize = `${Math.max(13, bodyFontSize - 3)}px`

    return (
      <div
        style={{
          marginTop: 10,
          padding: '12px 14px',
          borderRadius: 10,
          background: '#f8fafc',
          border: '1px solid #cbd5e1',
          boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          transition: 'all 0.2s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tag color="default" style={{ margin: 0, fontSize: rejectedTagFontSize, padding: '2px 8px', borderRadius: 4, fontWeight: 500 }}>
              ✕ 已忽略修改建议
            </Tag>
            {renderStatusBadge()}
          </div>
          <Button
            type="link"
            size="small"
            onClick={() => setExpandedRejected(true)}
            style={{ padding: 0, fontSize: rejectedBodyFontSize, color: '#2563eb', fontWeight: 500 }}
          >
            查看原方案 ▾
          </Button>
        </div>

        {previewText && (
          <div
            style={{
              fontSize: rejectedBodyFontSize,
              color: '#64748b',
              lineHeight: 1.5,
              background: '#f1f5f9',
              padding: '6px 10px',
              borderRadius: 6,
              wordBreak: 'break-all',
            }}
          >
            <span style={{ fontWeight: 600, color: '#475569', marginRight: 4 }}>已忽略方案：</span>
            {previewText}
          </div>
        )}
      </div>
    )
  }

  // 2. 已采纳且未展开时的提示状态卡片
  if (status === 'accepted' && !expandedAccepted) {
    const previewText = currentReplacement ? (currentReplacement.length > 25 ? `${currentReplacement.slice(0, 25)}…` : currentReplacement) : ''
    const acceptedTagFontSize = `${Math.max(12, bodyFontSize - 4)}px`
    const acceptedBodyFontSize = `${Math.max(13, bodyFontSize - 3)}px`

    return (
      <div
        style={{
          marginTop: 10,
          padding: '12px 14px',
          borderRadius: 10,
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          boxShadow: '0 2px 6px rgba(34, 197, 94, 0.05)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          transition: 'all 0.2s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tag color="green" style={{ margin: 0, fontSize: acceptedTagFontSize, padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
              ✓ 已采纳修改建议
            </Tag>
            {renderStatusBadge()}
          </div>
          <Button
            type="link"
            size="small"
            onClick={() => setExpandedAccepted(true)}
            style={{ padding: 0, fontSize: acceptedBodyFontSize, color: '#2563eb', fontWeight: 500 }}
          >
            查看原方案 ▾
          </Button>
        </div>

        {previewText && (
          <div
            style={{
              fontSize: acceptedBodyFontSize,
              color: '#166534',
              lineHeight: 1.5,
              background: '#dcfce7',
              padding: '6px 10px',
              borderRadius: 6,
              wordBreak: 'break-all',
            }}
          >
            <span style={{ fontWeight: 600, color: '#15803d', marginRight: 4 }}>已采纳方案：</span>
            {previewText}
          </div>
        )}
      </div>
    )
  }

  // 3. 正常展开卡片模式
  const visibleOptions = (status === 'accepted' && !showAllAcceptedOptions)
    ? optionsList.filter((_, idx) => idx === selectedOptionIdx)
    : optionsList

  return (
    <div
      style={{
        marginTop: 12,
        padding: '14px 16px',
        borderRadius: 12,
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
        transition: 'all 0.2s ease',
      }}
    >
      {/* 头部：标题与段落 Tag */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: btnFontSize, fontWeight: 600, color: '#1e293b' }}>
          <DiffOutlined style={{ color: '#2563eb' }} />
          <span>建议修改方案</span>
          {renderStatusBadge()}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {status === 'accepted' && <Tag color="green" style={{ margin: 0, fontSize: 11 }}>✓ 已采纳</Tag>}
          {status === 'rejected' && <Tag color="default" style={{ margin: 0, fontSize: 11 }}>✕ 已忽略</Tag>}
          {status === 'accepted' && expandedAccepted && (
            <Button
              type="link"
              size="small"
              onClick={() => setExpandedAccepted(false)}
              style={{ padding: '2px 8px', fontSize: `${Math.max(13, bodyFontSize - 3)}px`, color: '#2563eb', fontWeight: 500 }}
            >
              收起 ▴
            </Button>
          )}
          {status === 'rejected' && expandedRejected && (
            <Button
              type="link"
              size="small"
              onClick={() => setExpandedRejected(false)}
              style={{ padding: '2px 8px', fontSize: `${Math.max(13, bodyFontSize - 3)}px`, color: '#2563eb', fontWeight: 500 }}
            >
              收起 ▴
            </Button>
          )}
        </div>
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

      {/* 候选方案列表（已采纳默认收缩未选方案） */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: (status === 'accepted' || status === 'rejected') ? 4 : 14 }}>
        {visibleOptions.map((opt, idx) => {
          const originalIdx = optionsList.indexOf(opt)
          const isSelected = selectedOptionIdx === (originalIdx >= 0 ? originalIdx : idx)
          return (
            <div
              key={idx}
              onClick={() => status === 'pending' && setSelectedOptionIdx(originalIdx >= 0 ? originalIdx : idx)}
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
              {/* 方案标题：右对齐浅灰色方案名 */}
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

              {/* 改写内容 */}
              <div style={{ fontSize: `${bodyFontSize}px`, lineHeight: 1.65, color: isSelected ? '#14532d' : '#1f2937' }}>
                <span style={{ fontWeight: 600, color: isSelected ? '#166534' : '#475569', marginRight: 6 }}>改写：</span>
                {opt.replacement}
              </div>

              {/* 理由说明 */}
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

      {/* 已采纳下折叠/展开其他方案操作 */}
      {status === 'accepted' && optionsList.length > 1 && (
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <Button
            type="link"
            size="small"
            onClick={() => setShowAllAcceptedOptions(!showAllAcceptedOptions)}
            style={{ fontSize: `${Math.max(13, bodyFontSize - 3)}px`, color: '#2563eb', fontWeight: 500, padding: '4px 10px' }}
          >
            {showAllAcceptedOptions ? '收起其他方案 ▴' : `展开查看其他 ${optionsList.length - 1} 个未采纳方案 ▾`}
          </Button>
        </div>
      )}

      {/* 采纳与拒绝操作按钮区 */}
      {isCrossPara ? (
        <Tooltip title="V1 首版跨段修改暂请手动复制应用">
          <Button size="middle" disabled block style={{ fontSize: btnFontSize, marginTop: 8 }}>
            跨段修改请手动复制应用
          </Button>
        </Tooltip>
      ) : status === 'pending' ? (
        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
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
      ) : null}
    </div>
  )
}
