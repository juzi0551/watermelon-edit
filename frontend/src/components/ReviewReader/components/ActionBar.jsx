import React from 'react'
import { Button, Tag, Space, Input, Popover, Progress, Tooltip, Select, InputNumber } from 'antd'
import {
  CheckCircleOutlined, CloseCircleOutlined, ThunderboltOutlined, LoadingOutlined,
  MinusOutlined, PlusOutlined,
} from '@ant-design/icons'
import { color, radius, fontSize } from '../../../design-tokens'
import { kbdStyle, TYPE_OPTIONS } from '../constants'

export function ShortcutHint() {
  return (
    <Tooltip
      placement="top"
      title={
        <div style={{ lineHeight: 2 }}>
          <div><kbd style={kbdStyle}>空格</kbd> 开始 / 继续校对</div>
          <div><kbd style={kbdStyle}>↑</kbd> <kbd style={kbdStyle}>↓</kbd> 上一个 / 下一个问题</div>
          <div><kbd style={kbdStyle}>←</kbd> 采纳</div>
          <div><kbd style={kbdStyle}>→</kbd> 拒绝</div>
        </div>
      }
    >
      <span style={{
        fontSize: 12, color: color.textTertiary, cursor: 'pointer',
        whiteSpace: 'nowrap', userSelect: 'none', marginLeft: 12,
        alignSelf: 'flex-end', paddingBottom: 10,
      }}>
        快捷键
      </span>
    </Tooltip>
  )
}

export function ControlsRow({
  showOptions,
  selectedModel, onModelChange, models = [],
  selectedTypes, onTypesChange,
  batchMaxConcurrent, onBatchMaxConcurrentChange,
  proofreadWindowSize, onWindowSizeChange,
  inProgress,
}) {
  if (!showOptions) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, color: color.textPrimary, fontWeight: 500, minWidth: 40 }}>模型</span>
        <Select
          style={{ flex: 1 }}
          popupMatchSelectWidth={false}
          value={selectedModel}
          disabled={inProgress}
          onChange={onModelChange}
          options={models.map(m => ({ value: m.model_id, label: `${m.provider_name || m.provider} · ${m.name}` }))}
          size="small"
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, color: color.textPrimary, fontWeight: 500, minWidth: 40 }}>分类</span>
        <Select
          mode="multiple"
          style={{ flex: 1 }}
          value={selectedTypes}
          disabled={inProgress}
          onChange={onTypesChange}
          options={TYPE_OPTIONS}
          size="small"
          tagRender={(props) => {
            const { label, closable, onClose } = props
            return (
              <Tag
                closable={closable}
                onClose={onClose}
                style={{
                  margin: '1px 2px',
                  fontSize: 11,
                  background: 'var(--color-bgPage)',
                  color: 'var(--color-textPrimary)',
                  borderColor: 'var(--color-borderBar)',
                }}
              >
                {label}
              </Tag>
            )
          }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, color: color.textPrimary, fontWeight: 500, minWidth: 40 }}>窗口</span>
        <InputNumber
          min={5}
          max={100}
          size="small"
          style={{ width: 80 }}
          value={proofreadWindowSize}
          disabled={inProgress}
          onChange={(val) => onWindowSizeChange?.(val || 5)}
        />
        <span style={{ fontSize: 12, color: color.textSecondary }}>
          段/窗口
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, color: color.textPrimary, fontWeight: 500, minWidth: 40 }}>并发</span>
        <InputNumber
          min={1}
          max={20}
          size="small"
          style={{ width: 80 }}
          value={batchMaxConcurrent}
          disabled={inProgress}
          onChange={(val) => onBatchMaxConcurrentChange?.(val || 1)}
        />
        <span style={{ fontSize: 12, color: color.textSecondary }}>
          窗口（单次并发处理 {(batchMaxConcurrent || 1) * (proofreadWindowSize || 30)} 段）
        </span>
      </div>
    </div>
  )
}

export function ActionBar({
  mergeMode,
  handleConfirmMergeBatch,
  selectedMergeParas,
  handleExitMergeMode,
  currentBodyFontSize,
  setFontSizeOffset,
  inProgress,
  proofreading,
  showOptions,
  setShowOptions,
  selectedModel, onModelChange, models,
  selectedTypes, onTypesChange,
  batchMaxConcurrent, onBatchMaxConcurrentChange,
  proofreadWindowSize, onWindowSizeChange,
  batchInfo,
  retryingWindow,
  onRetryWindow,
  percent,
  bannerText,
  flatErrors,
  pending,
  selectedError,
  selIsPending,
  customEdit,
  setCustomEdit,
  statusSubmittingRef,
  setFlashSide,
  flashSide,
  handleStatus,
  selectedId,
  allDone,
  projectError,
  onStartProofread,
  onStartBatchProofread,
}) {
  const barStyle = {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 400,
    background: color.bgPage,
    borderTop: `1px solid ${color.borderBar}`,
    boxShadow: '0 -2px 8px rgba(0,0,0,0.08)',
    padding: '14px 32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    flexWrap: 'wrap',
  }

  return (
    <div style={barStyle}>
      <div style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '0 16px', gap: 12 }}>
        {mergeMode ? (
          <>
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <Button
                type="primary"
                shape="round"
                size="large"
                className="bar-action-btn"
                icon={<CheckCircleOutlined />}
                onClick={handleConfirmMergeBatch}
                disabled={selectedMergeParas.size < 2}
                style={{ height: 48, paddingInline: 24, fontSize: 15, flexShrink: 0 }}
              >
                确认合并 ({selectedMergeParas.size} 段)
              </Button>
              <Button
                shape="round"
                size="large"
                className="bar-action-btn"
                icon={<CloseCircleOutlined />}
                onClick={handleExitMergeMode}
                style={{ height: 48, paddingInline: 24, fontSize: 15, flexShrink: 0 }}
              >
                取消
              </Button>
            </div>

            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: color.bgCard,
                borderRadius: radius.md,
                border: `1px solid ${color.border}`,
                padding: '4px 10px',
              }}>
                <Button
                  type="text"
                  size="small"
                  icon={<MinusOutlined />}
                  disabled={currentBodyFontSize <= 14}
                  onClick={() => setFontSizeOffset(v => Math.max(v - 1, -6))}
                  style={{ width: 28, height: 28, fontSize: 14 }}
                />
                <span style={{ fontSize: 13, minWidth: 24, textAlign: 'center', color: color.textSecondary }}>
                  {currentBodyFontSize}
                </span>
                <Button
                  type="text"
                  size="small"
                  icon={<PlusOutlined />}
                  disabled={currentBodyFontSize >= 24}
                  onClick={() => setFontSizeOffset(v => Math.min(v + 1, 8))}
                  style={{ width: 28, height: 28, fontSize: 14 }}
                />
              </div>
            </div>
          </>
        ) : (
          <>
            {!(inProgress || proofreading) && (
              <Popover
                trigger="click"
                open={showOptions}
                onOpenChange={setShowOptions}
                placement="topLeft"
                styles={{ body: { padding: '12px 16px', width: 440 } }}
                content={
                  <ControlsRow
                    showOptions={true}
                    selectedModel={selectedModel} onModelChange={onModelChange}
                    models={models}
                    selectedTypes={selectedTypes} onTypesChange={onTypesChange}
                    batchMaxConcurrent={batchMaxConcurrent} onBatchMaxConcurrentChange={onBatchMaxConcurrentChange}
                    proofreadWindowSize={proofreadWindowSize} onWindowSizeChange={onWindowSizeChange}
                    inProgress={inProgress}
                  />
                }
              >
                <Button
                  type="text"
                  size="middle"
                  style={{
                    color: color.textPrimary, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
                    maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block', flexShrink: 0,
                  }}
                >
                  {showOptions ? '◀' : '▶'} 校对配置 ({
                    (() => {
                      const m = models.find(x => x.model_id === selectedModel)
                      return m ? `${m.provider_name || m.provider} · ${m.name}` : selectedModel
                    })()
                  })
                </Button>
              </Popover>
            )}

            {batchInfo && (
              <Popover
                trigger="click"
                placement="top"
                styles={{ body: { padding: '12px 16px', maxWidth: 380 } }}
                content={
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>
                        {batchInfo.status === 'running' ? '🔄 批量校对中'
                          : batchInfo.status === 'ok' ? '✓ 批量完成'
                            : batchInfo.failed_windows > 0 ? '⚠ 批量完成（部分失败）'
                              : '✖ 全部失败'}
                      </span>
                      <span style={{ fontSize: 12, opacity: 0.6 }}>
                        第 {batchInfo.range_start + 1}–{batchInfo.range_end} 段 &nbsp;·&nbsp;
                        {batchInfo.done_windows}/{batchInfo.total_windows} 窗口完成
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      {(batchInfo.windows || []).map(w => {
                        const isRetrying = retryingWindow === w.window_index
                        return (
                          <div key={w.window_index} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                            <span style={{
                              fontSize: 16,
                              color: isRetrying ? '#d4a359'
                                : w.status === 'ok' ? '#52c41a'
                                  : w.status === 'failed' ? '#ff4d4f'
                                    : '#d4a359'
                            }}>
                              {isRetrying ? '⏳' : w.status === 'ok' ? '●' : w.status === 'failed' ? '✗' : '○'}
                            </span>
                            <span style={{ fontSize: 10, opacity: 0.55 }}>{w.range_start + 1}–{w.range_end}</span>
                            {w.status === 'failed' && (
                              <Button
                                size="small"
                                type="link"
                                danger
                                loading={isRetrying}
                                style={{ padding: 0, height: 'auto', fontSize: 11 }}
                                disabled={inProgress || retryingWindow !== null}
                                onClick={() => onRetryWindow?.(batchInfo.batch_id, w.window_index)}
                              >
                                {isRetrying ? '重试中' : '重试'}
                              </Button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                }
              >
                <Tag
                  color={batchInfo.failed_windows > 0 ? 'error' : batchInfo.status === 'ok' ? 'success' : 'processing'}
                  style={{ cursor: 'pointer', padding: '4px 8px', fontSize: 12, borderRadius: 6, margin: 0, flexShrink: 0 }}
                >
                  {batchInfo.status === 'running' ? '🔄 批量中' : batchInfo.status === 'ok' ? '✓ 批量完成' : '⚠ 部分失败'} ({batchInfo.done_windows}/{batchInfo.total_windows}) ▾
                </Tag>
              </Popover>
            )}

            <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, minWidth: 0 }}>
              {inProgress || proofreading ? (
                <>
                  <Progress
                    percent={percent}
                    status="active"
                    style={{ width: 200, margin: 0 }}
                    size="small"
                  />
                  <span style={{ color: color.textTertiary, fontSize: fontSize.bodyXs, whiteSpace: 'nowrap' }}>
                    <LoadingOutlined spin style={{ marginRight: 6 }} />
                    {bannerText || '正在校对，请稍候…'}
                  </span>
                </>
              ) : flatErrors.length > 0 && pending.length > 0 ? (
                <>
                  {selectedError && selIsPending ? (
                    <>
                      <Input
                        value={customEdit}
                        onChange={(e) => setCustomEdit(e.target.value)}
                        style={{ maxWidth: 360, minWidth: 160, flex: '1 1 240px', fontSize: 15 }}
                        size="large"
                        placeholder="修改结果…"
                      />
                      <style>{`
                        .bar-action-btn {
                          transition: transform 0.08s cubic-bezier(0, 0, 0.2, 1), background 0.15s, box-shadow 0.15s !important;
                        }
                        .bar-action-btn:active:not(:disabled) {
                          transform: scale(0.95) !important;
                        }
                      `}</style>
                      <Button
                        type="primary"
                        shape="round"
                        size="large"
                        className="bar-action-btn"
                        icon={<CheckCircleOutlined />}
                        onClick={() => {
                          if (inProgress || statusSubmittingRef.current) return
                          setFlashSide('accepted')
                          setTimeout(() => { setFlashSide(null); handleStatus('accepted') }, 100)
                        }}
                        disabled={inProgress}
                        style={{
                          height: 48, paddingInline: 24, fontSize: 15, flexShrink: 0,
                          backgroundColor: flashSide === 'accepted' ? '#52c41a' : undefined,
                          borderColor: flashSide === 'accepted' ? '#52c41a' : undefined,
                          boxShadow: 'none',
                        }}
                      >
                        ← 采纳
                      </Button>
                      <Button
                        size="large"
                        className="bar-action-btn"
                        icon={<CloseCircleOutlined />}
                        onClick={() => {
                          if (inProgress || statusSubmittingRef.current) return
                          setFlashSide('rejected')
                          setTimeout(() => { setFlashSide(null); handleStatus('rejected') }, 100)
                        }}
                        disabled={inProgress}
                        style={{
                          height: 48, paddingInline: 24, fontSize: 15, flexShrink: 0,
                          backgroundColor: flashSide === 'rejected' ? '#ff4d4f' : undefined,
                          color: flashSide === 'rejected' ? '#fff' : undefined,
                          borderColor: flashSide === 'rejected' ? '#ff4d4f' : undefined,
                          boxShadow: 'none',
                        }}
                      >
                        拒绝 →
                      </Button>
                      <Tag style={{ marginLeft: 4, fontSize: 15, padding: '4px 10px', borderRadius: 999, flexShrink: 0 }}>
                        {pending.findIndex(e => e.id === selectedId) + 1}/{pending.length}
                      </Tag>
                      <ShortcutHint />
                    </>
                  ) : (
                    <span style={{ color: color.textTertiary }}>
                      点击文中有标记的文本查看错误详情
                    </span>
                  )}
                </>
              ) : (
                <>
                  <Button
                    type="primary"
                    shape="round"
                    size="large"
                    className="bar-action-btn"
                    icon={<ThunderboltOutlined />}
                    loading={proofreading}
                    onClick={onStartProofread}
                    disabled={inProgress}
                    style={{ height: 52, paddingInline: 36, fontSize: 17 }}
                  >
                    {allDone ? '继续校对' : projectError ? '重试' : '开始校对'}
                  </Button>
                  <Button
                    shape="round"
                    size="large"
                    className="bar-action-btn"
                    icon={<ThunderboltOutlined />}
                    loading={proofreading}
                    onClick={onStartBatchProofread}
                    disabled={inProgress}
                    style={{ height: 52, paddingInline: 24, fontSize: 16, marginLeft: 8 }}
                    title={`批量并行校对多窗口（每个窗口 ${proofreadWindowSize} 段，可以在校对配置中调整）`}
                  >
                    批量校对
                  </Button>
                  <ShortcutHint />
                </>
              )}
            </div>

            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: color.bgCard,
                borderRadius: radius.md,
                border: `1px solid ${color.border}`,
                padding: '4px 10px',
              }}>
                <Button
                  type="text"
                  size="small"
                  icon={<MinusOutlined />}
                  disabled={currentBodyFontSize <= 14}
                  onClick={() => setFontSizeOffset(v => Math.max(v - 1, -6))}
                  style={{ width: 28, height: 28, fontSize: 14 }}
                />
                <span style={{ fontSize: 13, minWidth: 24, textAlign: 'center', color: color.textSecondary }}>
                  {currentBodyFontSize}
                </span>
                <Button
                  type="text"
                  size="small"
                  icon={<PlusOutlined />}
                  disabled={currentBodyFontSize >= 24}
                  onClick={() => setFontSizeOffset(v => Math.min(v + 1, 8))}
                  style={{ width: 28, height: 28, fontSize: 14 }}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
