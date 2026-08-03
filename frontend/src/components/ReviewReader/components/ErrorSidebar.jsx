import React, { memo } from 'react'
import { Button, Tabs, Empty, Space, Tag } from 'antd'
import { MenuFoldOutlined } from '@ant-design/icons'
import { color, radius, spacing, fontSize } from '../../../design-tokens'
import { TYPE_LABEL, SEVERITY_COLOR, SEVERITY_LABEL } from '../constants'
import { DiffView } from './DiffView'

export const ErrorList = memo(function ErrorList({ errors, selectedId, onSelect, unmatchedIds, onSetStatus, mergeMode, tbFontSize }) {
  const subFontSize = Math.max(12, (tbFontSize || 17) - 2)
  const tagFontSize = Math.max(11, subFontSize - 1)

  return errors.map(e => {
    const statusColor = e.user_status === 'pending' ? color.warning
      : e.user_status === 'accepted' ? color.success : color.borderRejected
    const noLoc = unmatchedIds?.has(e.id)
    const done = e.user_status !== 'pending'
    return (
      <div
        key={e.id}
        className="error-list-item"
        style={{
          cursor: mergeMode ? 'default' : 'pointer',
          background: e.id === selectedId ? color.bgHighlight : color.bgPage,
          padding: '10px 14px',
          borderRadius: radius.md,
          marginBottom: 6,
          borderTop: `1px solid ${noLoc ? '#faad14' : (e.id === selectedId ? color.borderSelected : color.border)}`,
          borderRight: `1px solid ${noLoc ? '#faad14' : (e.id === selectedId ? color.borderSelected : color.border)}`,
          borderBottom: `1px solid ${noLoc ? '#faad14' : (e.id === selectedId ? color.borderSelected : color.border)}`,
          borderLeft: `3px solid ${statusColor}`,
          transition: 'background 0.15s, box-shadow 0.15s',
        }}
        onClick={() => {
          if (mergeMode) return
          onSelect(e.id)
        }}
        onMouseEnter={(ev) => {
          if (e.id !== selectedId) ev.currentTarget.style.background = color.bgCard
        }}
        onMouseLeave={(ev) => {
          ev.currentTarget.style.background = e.id === selectedId ? color.bgHighlight : color.bgPage
        }}
      >
        <Space size={spacing.xs} style={{ marginBottom: 4 }}>
          <Tag style={{ fontSize: tagFontSize, margin: 0, border: 'none', background: color.border, color: color.textSecondary }}>
            第{e.paragraph_index}段
          </Tag>
          {noLoc && <Tag color="warning" style={{ fontSize: tagFontSize, margin: 0 }}>位置异常</Tag>}
          <Tag style={{ fontSize: tagFontSize, margin: 0 }}>{TYPE_LABEL[e.type] || e.type}</Tag>
          <Tag style={{ fontSize: tagFontSize, margin: 0 }} color={SEVERITY_COLOR[e.severity]}>
            {SEVERITY_LABEL[e.severity]}
          </Tag>
          {e.is_obsolete === 1 ? (
            <Tag color="default" style={{ fontSize: tagFontSize, margin: 0 }}>
              历史存档 (已覆盖)
            </Tag>
          ) : (
            e.source === 'rule' && <Tag color="blue" style={{ fontSize: tagFontSize, margin: 0 }}>规范检测</Tag>
          )}
          {done && !e.is_obsolete && (
            <Button
              type="text"
              size="small"
              onClick={(ev) => { ev.stopPropagation(); onSetStatus?.(e.id, 'pending') }}
              style={{ height: 20, fontSize: Math.max(10, tagFontSize - 1), lineHeight: '18px', paddingInline: 6, color: color.textSecondary }}
            >
              重置
            </Button>
          )}
        </Space>
        <div style={{ margin: '4px 0' }}>
          <DiffView original={e.original_text} suggested={e.suggested_text} fontSize={subFontSize} />
        </div>
        <div style={{ fontSize: subFontSize, color: color.textDescription, marginTop: 3 }}>{e.description}</div>
      </div>
    )
  })
})

export function ErrorSidebar({
  mergeMode,
  showPanel,
  onTogglePanel,
  panelTab,
  setPanelTab,
  pending,
  accepted,
  rejected,
  obsolete,
  selectedId,
  handleSelectError,
  handleSelectObsoleteError,
  unmatchedIds,
  onSetStatus,
  jumpToParagraphExact,
  tbFontSize,
}) {
  const subFontSize = Math.max(12, (tbFontSize || 17) - 2)

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
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '14px 16px 0',
        }}>
          <span style={{ fontWeight: 600, fontSize: subFontSize + 2 }}>问题列表</span>
          <Button type="text" size="small" icon={<MenuFoldOutlined style={{ transform: 'scaleX(-1)' }} />} onClick={onTogglePanel} />
        </div>

        <style>{`
          .right-panel-tabs .ant-tabs-content-holder { overflow: hidden; }
          .right-panel-tabs .ant-tabs-content { height: 100%; }
          .right-panel-tabs .ant-tabs-tabpane-active { height: 100%; overflow-y: auto; padding-bottom: 72px; }
          .right-panel-tabs .ant-tabs-tab-btn { font-size: ${subFontSize + 1}px !important; }
        `}</style>
        <Tabs
          activeKey={panelTab}
          onChange={setPanelTab}
          className="right-panel-tabs"
          style={{ padding: '0 16px', flex: 1, minHeight: 0 }}
          items={[
            {
              key: 'pending',
              label: <span>待处理 ({pending.length})</span>,
              children: pending.length === 0
                ? <Empty description="暂无待处理问题" />
                : (
                  <ErrorList
                    errors={pending}
                    selectedId={selectedId}
                    onSelect={handleSelectError}
                    unmatchedIds={unmatchedIds}
                    onSetStatus={onSetStatus}
                    mergeMode={mergeMode}
                    tbFontSize={tbFontSize}
                  />
                ),
            },
            {
              key: 'accepted',
              label: <span>已采纳 ({accepted.length})</span>,
              children: accepted.length === 0
                ? <Empty description="暂无已采纳问题" />
                : (
                  <ErrorList
                    errors={accepted}
                    selectedId={selectedId}
                    onSelect={handleSelectError}
                    unmatchedIds={unmatchedIds}
                    onSetStatus={onSetStatus}
                    mergeMode={mergeMode}
                    tbFontSize={tbFontSize}
                  />
                ),
            },
            {
              key: 'rejected',
              label: <span>已拒绝 ({rejected.length})</span>,
              children: rejected.length === 0
                ? <Empty description="暂无已拒绝问题" />
                : (
                  <ErrorList
                    errors={rejected}
                    selectedId={selectedId}
                    onSelect={handleSelectError}
                    unmatchedIds={unmatchedIds}
                    onSetStatus={onSetStatus}
                    mergeMode={mergeMode}
                    tbFontSize={tbFontSize}
                  />
                ),
            },
            {
              key: 'obsolete',
              label: <span>历史作废 ({obsolete.length})</span>,
              children: obsolete.length === 0
                ? <Empty description="暂无历史作废问题" />
                : (
                  <ErrorList
                    errors={obsolete}
                    selectedId={selectedId}
                    onSelect={(id) => handleSelectObsoleteError(id, jumpToParagraphExact)}
                    unmatchedIds={unmatchedIds}
                    onSetStatus={onSetStatus}
                    mergeMode={mergeMode}
                    tbFontSize={tbFontSize}
                  />
                ),
            },
          ]}
        />
      </div>
    </div>
  )
}
