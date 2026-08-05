import React from 'react'
import { Button, Tooltip, Dropdown, Popconfirm } from 'antd'
import {
  EditOutlined, PlusOutlined, MergeCellsOutlined, BookOutlined, EyeOutlined, DashOutlined, DeleteOutlined,
  ArrowUpOutlined, ArrowDownOutlined, CloseOutlined, MessageOutlined,
} from '@ant-design/icons'
import { color } from '../../../design-tokens'

export function ParaHoverToolbar({
  toolbarRef,
  activePara,
  tbFontSize = 14,
  showOrig,
  hasManualEdit,
  activeIsCh,
  hasHardBreak,
  handleStartEdit,
  handleInsertPara,
  handleEnterMergeMode,
  handleSetChapter,
  handleToggleOriginal,
  handleTogglePageBreak,
  handleDeletePara,
  handleAskAssistant,
}) {
  if (!activePara) return null

  const btnHeight = Math.max(28, tbFontSize + 14)
  const iconFontSize = tbFontSize + 2

  return (
    <div
      ref={toolbarRef}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        zIndex: 100,
        background: 'var(--color-bgCard, rgba(255, 255, 255, 0.92))',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        padding: '4px 10px',
        borderRadius: 24,
        border: '1px solid var(--color-borderBar, rgba(217, 217, 217, 0.8))',
        boxShadow: 'var(--color-shadowFloat, 0 4px 16px rgba(0, 0, 0, 0.12))',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        whiteSpace: 'nowrap',
        pointerEvents: 'auto',
      }}
    >
      <Tooltip title="将整段文字带入 AI 助手侧栏" mouseEnterDelay={0.5} mouseLeaveDelay={0}>
        <Button
          type="text"
          size="small"
          icon={<MessageOutlined style={{ color: '#2563eb', fontSize: iconFontSize }} />}
          onClick={() => handleAskAssistant?.({
            selectedText: activePara.revised_text || activePara.text || activePara.raw_text,
            paragraphIdx: activePara.idx,
            paragraphUuid: activePara.uuid || activePara.idx,
          })}
          style={{ fontSize: tbFontSize, fontWeight: 500, height: btnHeight }}
        >
          问 AI
        </Button>
      </Tooltip>

      <Tooltip title="编辑段落文本,支持双击进入" mouseEnterDelay={0.5} mouseLeaveDelay={0}>
        <Button
          type="text"
          size="small"
          icon={<EditOutlined style={{ color: '#7c3aed', fontSize: iconFontSize }} />}
          onClick={() => handleStartEdit(activePara)}
          style={{ fontSize: tbFontSize, fontWeight: 500, height: btnHeight }}
        >
          编辑
        </Button>
      </Tooltip>

      <Dropdown trigger={['click']} menu={{
        items: [
          { key: 'insert-above', label: <span><ArrowUpOutlined /> 向上插入新段落</span>, onClick: () => handleInsertPara(activePara, 'above') },
          { key: 'insert-below', label: <span><ArrowDownOutlined /> 向下插入新段落</span>, onClick: () => handleInsertPara(activePara, 'below') },
        ]
      }}>
        <Button
          type="text"
          size="small"
          icon={<PlusOutlined style={{ color: '#059669', fontSize: iconFontSize }} />}
          style={{ fontSize: tbFontSize, fontWeight: 500, height: btnHeight }}
        >
          新建 ▾
        </Button>
      </Dropdown>

      <Tooltip title="多段落合并" mouseEnterDelay={0.5} mouseLeaveDelay={0}>
        <Button
          type="text"
          size="small"
          icon={<MergeCellsOutlined style={{ color: '#0284c7', fontSize: iconFontSize }} />}
          onClick={() => handleEnterMergeMode(activePara)}
          style={{ fontSize: tbFontSize, fontWeight: 500, height: btnHeight }}
        >
          合并
        </Button>
      </Tooltip>

      <Dropdown trigger={['click']} menu={{
        items: [
          { key: 'title-1', label: <span><BookOutlined /> 设为 1级 卷/部 标题</span>, onClick: () => handleSetChapter(activePara, 1) },
          { key: 'title-2', label: <span><BookOutlined /> 设为 2级 章 标题</span>, onClick: () => handleSetChapter(activePara, 2) },
          { key: 'title-3', label: <span><BookOutlined /> 设为 3级 节/回 标题</span>, onClick: () => handleSetChapter(activePara, 3) },
          { key: 'title-4', label: <span><BookOutlined /> 设为 4级 小节 标题</span>, onClick: () => handleSetChapter(activePara, 4) },
          { key: 'title-5', label: <span><BookOutlined /> 设为 5级 目 标题</span>, onClick: () => handleSetChapter(activePara, 5) },
          { key: 'title-6', label: <span><BookOutlined /> 设为 6级 细目 标题</span>, onClick: () => handleSetChapter(activePara, 6) },
          ...(activeIsCh ? [{ type: 'divider' }, { key: 'remove', label: <span><CloseOutlined /> 取消章节标题标记</span>, danger: true, onClick: () => handleSetChapter(activePara, 1, true) }] : []),
        ]
      }}>
        <Button
          type="text"
          size="small"
          icon={<BookOutlined style={{ color: '#d97706', fontSize: iconFontSize }} />}
          style={{ fontSize: tbFontSize, fontWeight: 500, height: btnHeight }}
        >
          设标题 ▾
        </Button>
      </Dropdown>

      <Tooltip title={hasManualEdit ? (showOrig ? '隐藏原文' : '查看初始原文') : '该段落无修改'} mouseEnterDelay={0.5} mouseLeaveDelay={0}>
        <span style={{ display: 'inline-block' }}>
          <Button
            type="text"
            size="small"
            icon={<EyeOutlined style={{ color: showOrig ? '#2563eb' : '#64748b', fontSize: iconFontSize }} />}
            onClick={() => handleToggleOriginal(activePara.idx)}
            disabled={!hasManualEdit}
            style={{ fontSize: tbFontSize, fontWeight: 500, height: btnHeight, color: showOrig ? '#2563eb' : undefined }}
          >
            原文
          </Button>
        </span>
      </Tooltip>

      {hasHardBreak ? (
        <Popconfirm title="确定移除该硬分页？" description="移除后该段落导出时将不再另起新页。"
          onConfirm={() => handleTogglePageBreak(activePara)} okText="确定移除" okButtonProps={{ danger: true }} cancelText="取消">
          <Tooltip title="移除段前硬分页" mouseEnterDelay={0.5} mouseLeaveDelay={0}>
            <Button
              type="text"
              size="small"
              danger
              icon={<DashOutlined style={{ fontSize: iconFontSize }} />}
              style={{ fontSize: tbFontSize, fontWeight: 500, height: btnHeight }}
            >
              分页
            </Button>
          </Tooltip>
        </Popconfirm>
      ) : (
        <Tooltip title="插入段前硬分页（使导出 Word 时从新一页开始）" mouseEnterDelay={0.5} mouseLeaveDelay={0}>
          <Button
            type="text"
            size="small"
            icon={<DashOutlined style={{ color: '#475569', fontSize: iconFontSize }} />}
            onClick={() => handleTogglePageBreak(activePara)}
            style={{ fontSize: tbFontSize, fontWeight: 500, height: btnHeight }}
          >
            分页
          </Button>
        </Tooltip>
      )}

      <Tooltip title="删除该段落">
        <Button
          type="text"
          size="small"
          danger
          icon={<DeleteOutlined style={{ fontSize: iconFontSize }} />}
          onClick={() => handleDeletePara(activePara)}
          style={{ fontSize: tbFontSize, fontWeight: 500, height: btnHeight }}
        >
          删除
        </Button>
      </Tooltip>
    </div>
  )
}
