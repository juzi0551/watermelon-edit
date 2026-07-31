import React from 'react'
import { Button, Tooltip, Dropdown, Popconfirm } from 'antd'
import {
  EditOutlined, PlusOutlined, MergeCellsOutlined, BookOutlined, EyeOutlined, DashOutlined, DeleteOutlined,
  ArrowUpOutlined, ArrowDownOutlined, CloseOutlined,
} from '@ant-design/icons'
import { color } from '../../../design-tokens'

export function ParaHoverToolbar({
  toolbarRef,
  activePara,
  tbFontSize,
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
}) {
  if (!activePara) return null

  return (
    <div
      ref={toolbarRef}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        zIndex: 100,
        background: 'color-mix(in srgb, var(--color-bgToolbar) 50%, transparent)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        padding: '3px 10px',
        borderRadius: 20,
        boxShadow: '0 2px 4px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
        border: `1px solid ${color.borderBar}`,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        whiteSpace: 'nowrap',
        pointerEvents: 'auto',
      }}
    >
      <Tooltip title="编辑段落文本,支持双击进入" mouseEnterDelay={0.5} mouseLeaveDelay={0}>
        <Button type="text" size="small" icon={<EditOutlined />}
          onClick={() => handleStartEdit(activePara)} style={{ fontSize: tbFontSize }}>编辑</Button>
      </Tooltip>

      <Dropdown trigger={['click']} menu={{
        items: [
          { key: 'insert-above', label: <span><ArrowUpOutlined /> 向上插入新段落</span>, onClick: () => handleInsertPara(activePara, 'above') },
          { key: 'insert-below', label: <span><ArrowDownOutlined /> 向下插入新段落</span>, onClick: () => handleInsertPara(activePara, 'below') },
        ]
      }}>
        <Button type="text" size="small" icon={<PlusOutlined />} style={{ fontSize: tbFontSize }}>新建 ▾</Button>
      </Dropdown>

      <Tooltip title="多段落合并" mouseEnterDelay={0.5} mouseLeaveDelay={0}>
        <Button type="text" size="small" icon={<MergeCellsOutlined />}
          onClick={() => handleEnterMergeMode(activePara)} style={{ fontSize: tbFontSize }}>合并</Button>
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
        <Button type="text" size="small" icon={<BookOutlined />} style={{ fontSize: tbFontSize }}>设标题 ▾</Button>
      </Dropdown>

      <Tooltip title={hasManualEdit ? (showOrig ? '隐藏原文' : '查看初始原文') : '该段落无修改'} mouseEnterDelay={0.5} mouseLeaveDelay={0}>
        <span style={{ display: 'inline-block' }}>
          <Button type="text" size="small" icon={<EyeOutlined />}
            onClick={() => handleToggleOriginal(activePara.idx)}
            disabled={!hasManualEdit}
            style={{ fontSize: tbFontSize, color: showOrig ? '#1890ff' : undefined }}>
            原文
          </Button>
        </span>
      </Tooltip>

      {hasHardBreak ? (
        <Popconfirm title="确定移除该硬分页？" description="移除后该段落导出时将不再另起新页。"
          onConfirm={() => handleTogglePageBreak(activePara)} okText="确定移除" okButtonProps={{ danger: true }} cancelText="取消">
          <Tooltip title="移除段前硬分页" mouseEnterDelay={0.5} mouseLeaveDelay={0}>
            <Button type="text" size="small" danger icon={<DashOutlined />} style={{ fontSize: tbFontSize }}>分页</Button>
          </Tooltip>
        </Popconfirm>
      ) : (
        <Tooltip title="插入段前硬分页（使导出 Word 时从新一页开始）" mouseEnterDelay={0.5} mouseLeaveDelay={0}>
          <Button type="text" size="small" icon={<DashOutlined />}
            onClick={() => handleTogglePageBreak(activePara)} style={{ fontSize: tbFontSize }}>分页</Button>
        </Tooltip>
      )}

      <Tooltip title="删除该段落">
        <Button type="text" size="small" danger icon={<DeleteOutlined />}
          onClick={() => handleDeletePara(activePara)} style={{ fontSize: tbFontSize }}>删除</Button>
      </Tooltip>
    </div>
  )
}
