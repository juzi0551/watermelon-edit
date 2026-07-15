import React, { useState, useEffect, useMemo, useRef } from 'react'
import {
  Card, Button, Tag, Space, Typography, Empty, Tabs,
  Select, Radio, Progress,
} from 'antd'
import {
  CheckCircleOutlined, CloseCircleOutlined,
  DownloadOutlined, UnorderedListOutlined, ThunderboltOutlined,
  LoadingOutlined, SettingOutlined,
} from '@ant-design/icons'

const { Text } = Typography

const TYPE_LABEL = {
  typo: '错别字', grammar: '语法', punctuation: '标点', format: '格式',
}
const SEVERITY_COLOR = { high: 'red', medium: 'orange', low: 'blue' }
const SEVERITY_LABEL = { high: '高', medium: '中', low: '低' }
const TYPE_OPTIONS = [
  { value: 'typo', label: '错别字' },
  { value: 'grammar', label: '语法' },
  { value: 'punctuation', label: '标点' },
  { value: 'format', label: '格式' },
]

function ParagraphView({ text, paraErrors, selectedId, onSelect }) {
  if (!text) return null
  const found = []
  paraErrors.forEach(e => {
    const idx = text.indexOf(e.original_text)
    if (idx >= 0) found.push({ error: e, idx, end: idx + e.original_text.length })
  })
  found.sort((a, b) => a.idx - b.idx)
  const segs = []
  const chips = []
  let cursor = 0
  found.forEach(f => {
    if (f.idx < cursor) { chips.push(f.error); return }
    if (f.idx > cursor) segs.push(<span key={`t${cursor}`}>{text.slice(cursor, f.idx)}</span>)
    const e = f.error
    const isSel = e.id === selectedId
    const resolved = e.user_status !== 'pending'
    segs.push(
      <span
        key={e.id}
        onClick={() => onSelect(e.id)}
        style={{
          cursor: 'pointer',
          padding: '0 2px',
          borderRadius: 2,
          backgroundColor: isSel ? '#fff1b8' : 'transparent',
          borderBottom: resolved
            ? (e.user_status === 'accepted' ? '1px solid #52c41a' : '1px solid #d9d9d9')
            : (isSel ? '2px solid #faad14' : '1px dotted #faad14'),
          textDecoration: resolved ? 'line-through' : 'none',
          color: resolved ? '#bbb' : undefined,
        }}
      >{e.original_text}</span>,
    )
    cursor = f.end
  })
  if (cursor < text.length) segs.push(<span key="t-end">{text.slice(cursor)}</span>)
  chips.forEach(e => {
    segs.push(
      <Tag
        key={`chip-${e.id}`}
        color={SEVERITY_COLOR[e.severity] || 'blue'}
        style={{ cursor: 'pointer', margin: '0 4px' }}
        onClick={() => onSelect(e.id)}
      >{e.original_text}</Tag>,
    )
  })
  return <>{segs}</>
}

function ErrorList({ errors, selectedId, onSelect }) {
  return (
    <div style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
      {errors.map(e => (
        <div
          key={e.id}
          style={{
            cursor: 'pointer',
            background: e.id === selectedId ? '#fff1b8' : 'transparent',
            padding: '8px 10px',
            borderRadius: 4,
            marginBottom: 4,
            borderLeft: `3px solid ${
              e.user_status === 'pending' ? '#faad14'
                : e.user_status === 'accepted' ? '#52c41a' : '#bbb'
            }`,
          }}
          onClick={() => onSelect(e.id)}
        >
          <Space size={4} style={{ marginBottom: 2 }}>
            <span style={{ fontSize: 12, color: '#888' }}>第{e.paragraph_index}段</span>
            <Tag style={{ fontSize: 11, margin: 0 }}>{TYPE_LABEL[e.type] || e.type}</Tag>
            <Tag style={{ fontSize: 11, margin: 0 }} color={SEVERITY_COLOR[e.severity]}>
              {SEVERITY_LABEL[e.severity]}
            </Tag>
          </Space>
          <div style={{ fontSize: 13 }}>
            <Text delete type="danger">{e.original_text}</Text>
            <span style={{ margin: '0 6px', color: '#bbb' }}>→</span>
            <Text type="success">{e.suggested_text}</Text>
          </div>
          <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{e.description}</div>
        </div>
      ))}
    </div>
  )
}

export default function ReviewReader({
  results, project, inProgress, onSetStatus, onAcceptAll, onExport,
  chapters = [], selectedChapter = null, onStartProofread,
  mode = 'continue', onModeChange,
  selectedModel, onModelChange,
  models = [],
  selectedTypes = ['typo', 'grammar', 'punctuation', 'format'], onTypesChange,
  percent = 0,
  proofreading = false,
  total = 0, upto = 0,
  bannerText = '',
  projectError = null, onRetry, onChapterChange,
}) {
  const errors = results?.errors || []
  const paras = results?.paragraphs || []
  const paraMap = useMemo(() => Object.fromEntries(paras.map(p => [p.idx, p])), [paras])

  const errorParaIdxs = useMemo(() => {
    const set = new Set(errors.map(e => e.paragraph_index))
    return [...set].sort((a, b) => a - b)
  }, [errors])

  const flatErrors = useMemo(
    () => [...errors].sort((a, b) => a.paragraph_index - b.paragraph_index),
    [errors],
  )
  const pending = useMemo(() => flatErrors.filter(e => e.user_status === 'pending'), [flatErrors])
  const accepted = useMemo(() => flatErrors.filter(e => e.user_status === 'accepted'), [flatErrors])
  const rejected = useMemo(() => flatErrors.filter(e => e.user_status === 'rejected'), [flatErrors])

  const [selectedId, setSelectedId] = useState(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelTab, setPanelTab] = useState('pending')
  const flowRef = useRef(null)
  const contentRef = useRef(null)

  useEffect(() => {
    if (!selectedId || !flatErrors.find(e => e.id === selectedId)) {
      setSelectedId(pending[0]?.id || null)
    }
  }, [flatErrors, pending, selectedId])

  useEffect(() => {
    if (!selectedId || !flowRef.current) return
    const err = flatErrors.find(e => e.id === selectedId)
    if (!err) return
    const el = flowRef.current.querySelector(`[data-para="${err.paragraph_index}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [selectedId, flatErrors])

  useEffect(() => {
    if (!selectedChapter || !flowRef.current) return
    const ch = chapters.find(c => c.id === selectedChapter)
    if (!ch) return
    const target = errorParaIdxs.find(idx => idx >= (ch.title_paragraph_idx ?? 0))
      ?? ch.start_idx ?? ch.title_paragraph_idx
    if (target == null) return
    const el = flowRef.current.querySelector(`[data-para="${target}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [selectedChapter, chapters, errorParaIdxs])

  const selectedError = useMemo(
    () => flatErrors.find(e => e.id === selectedId),
    [flatErrors, selectedId],
  )

  const allDone = pending.length === 0 && flatErrors.length > 0
  const selIsPending = selectedError?.user_status === 'pending'

  const prevPendingCount = useRef(pending.length)
  useEffect(() => {
    if (pending.length === 0 && prevPendingCount.current > 0 && flowRef.current && flatErrors.length > 0) {
      const lastErr = flatErrors[flatErrors.length - 1]
      const el = flowRef.current.querySelector(`[data-para="${lastErr.paragraph_index}"]`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    prevPendingCount.current = pending.length
  }, [pending.length, flatErrors])

  const handleStatus = async (status) => {
    if (!selectedId) return
    await onSetStatus(selectedId, status)
    const idx = pending.findIndex(e => e.id === selectedId)
    if (idx >= 0 && idx + 1 < pending.length) {
      setSelectedId(pending[idx + 1].id)
    } else if (idx > 0) {
      setSelectedId(pending[idx - 1].id)
    } else {
      setSelectedId(null)
    }
  }

  const hasResults = results && paras.length > 0
  const showPanel = panelOpen && hasResults

  if (!hasResults) {
    return (
      <Card>
        <Empty description="暂无数据" />
      </Card>
    )
  }

  const barStyle = {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    background: '#fff',
    borderTop: '1px solid #e8e8e8',
    boxShadow: '0 -2px 8px rgba(0,0,0,0.08)',
    padding: '10px 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    flexWrap: 'wrap',
  }

  const numSectionItems = [pending, accepted, rejected].filter(a => a.length > 0).length

  return (
    <>
      <div style={{ paddingBottom: 80, display: 'flex', gap: 0, position: 'relative' }}>
        <div
          ref={contentRef}
          style={{
            flex: 1,
            minWidth: 0,
            transition: 'margin-right 0.2s',
          }}
        >
          <Card
            title={
              <Space>
                <span>校对审阅</span>
                <Tag color="blue">{errors.length} 条问题</Tag>
                <Tag color="green">已采纳 {accepted.length}</Tag>
                <Tag color="orange">待确认 {pending.length}</Tag>
              </Space>
            }
            extra={
              <Space>
                <Button
                  icon={<UnorderedListOutlined />}
                  onClick={() => setPanelOpen(v => !v)}
                  type={panelOpen ? 'primary' : 'default'}
                >
                  问题列表{pending.length ? `（${pending.length}）` : ''}
                </Button>
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  disabled={inProgress}
                  onClick={onExport}
                >
                  导出校稿版
                </Button>
              </Space>
            }
          >
            <div
              ref={flowRef}
              style={{
                padding: '16px 24px',
                maxHeight: '70vh',
                overflowY: 'auto',
              }}
            >
              {[...paras].sort((a, b) => a.idx - b.idx).map(para => {
                const paraErrs = errors.filter(e => e.paragraph_index === para.idx)
                return (
                  <div key={para.idx} data-para={para.idx} style={{ marginBottom: 24 }}>
                    <div style={{ lineHeight: 1.9, fontSize: 16 }}>
                      <ParagraphView
                        text={para.text}
                        paraErrors={paraErrs}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                      />
                      {para?.revised_text && (
                        <span style={{ color: '#52c41a', fontSize: 13, marginLeft: 8 }}>
                          （已修订）
                        </span>
                      )}
                    </div>

                    {paraErrs.some(e => e.id === selectedId) && selectedError && (
                      <div
                        style={{
                          marginTop: 8,
                          padding: '10px 14px',
                          background: '#fafafa',
                          borderRadius: 6,
                          borderLeft: '3px solid #faad14',
                        }}
                      >
                        <Space style={{ marginBottom: 4 }} wrap>
                          <Tag color="blue">{TYPE_LABEL[selectedError.type] || selectedError.type}</Tag>
                          <Tag color={SEVERITY_COLOR[selectedError.severity]}>
                            {SEVERITY_LABEL[selectedError.severity]}危
                          </Tag>
                          {selectedError.user_status !== 'pending' && (
                            <Tag color={selectedError.user_status === 'accepted' ? 'green' : 'red'}>
                              {selectedError.user_status === 'accepted' ? '已采纳' : '已拒绝'}
                            </Tag>
                          )}
                        </Space>
                        <div style={{ marginBottom: 4, color: '#666', fontSize: 14 }}>
                          {selectedError.description}
                        </div>
                        <div>
                          <Text delete type="danger">{selectedError.original_text}</Text>
                          <span style={{ margin: '0 8px' }}>→</span>
                          <Text type="success">{selectedError.suggested_text}</Text>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </Card>
        </div>

        {/* squeeze panel */}
        <div
          style={{
            width: showPanel ? 420 : 0,
            overflow: 'hidden',
            flexShrink: 0,
            transition: 'width 0.2s ease',
            borderLeft: showPanel ? '1px solid #f0f0f0' : 'none',
            background: '#fff',
            borderRadius: 8,
          }}
        >
          {showPanel && (
            <div style={{ width: 420, padding: '12px 0', height: '100%' }}>
              <Tabs
                activeKey={panelTab}
                onChange={setPanelTab}
                style={{ padding: '0 16px' }}
                items={[
                  {
                    key: 'pending',
                    label: `待处理（${pending.length}）`,
                    children: pending.length === 0
                      ? <Empty description="暂无待处理问题" />
                      : (
                        <ErrorList
                          errors={pending}
                          selectedId={selectedId}
                          onSelect={(id) => { setSelectedId(id) }}
                        />
                      ),
                  },
                  {
                    key: 'accepted',
                    label: `已采纳（${accepted.length}）`,
                    children: accepted.length === 0
                      ? <Empty description="暂无已采纳问题" />
                      : (
                        <ErrorList
                          errors={accepted}
                          selectedId={selectedId}
                          onSelect={(id) => { setSelectedId(id) }}
                        />
                      ),
                  },
                  {
                    key: 'rejected',
                    label: `已拒绝（${rejected.length}）`,
                    children: rejected.length === 0
                      ? <Empty description="暂无已拒绝问题" />
                      : (
                        <ErrorList
                          errors={rejected}
                          selectedId={selectedId}
                          onSelect={(id) => { setSelectedId(id) }}
                        />
                      ),
                  },
                ]}
              />
            </div>
          )}
        </div>
      </div>

      {/* ======== fixed bottom bar ======== */}
      <div style={barStyle}>
        {/* STATE: proofreading in progress */}
        {inProgress || proofreading ? (
          <>
            <Progress
              percent={percent}
              status="active"
              style={{ width: 200, margin: 0 }}
              size="small"
            />
            <span style={{ color: '#888', fontSize: 13 }}>
              <LoadingOutlined spin style={{ marginRight: 6 }} />
              {bannerText || '正在校对，请稍候…'}
            </span>
          </>
        ) : flatErrors.length > 0 && pending.length > 0 ? (
          <>
            {selectedError && selIsPending ? (
              <>
                <span
                  style={{
                    color: '#888',
                    fontSize: 13,
                    maxWidth: 300,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {selectedError.description}
                </span>
                <span style={{ color: '#ddd' }}>|</span>
                <Button
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  onClick={() => handleStatus('accepted')}
                  disabled={inProgress}
                >
                  采纳
                </Button>
                <Button
                  icon={<CloseCircleOutlined />}
                  onClick={() => handleStatus('rejected')}
                  disabled={inProgress}
                >
                  拒绝
                </Button>
                <Tag color="blue" style={{ marginLeft: 4 }}>
                  {pending.findIndex(e => e.id === selectedId) + 1}/{pending.length}
                </Tag>
              </>
            ) : (
              <span style={{ color: '#888' }}>
                点击文中有标记的文本查看错误详情
              </span>
            )}
          </>
        ) : (
          <>
            {projectError && onRetry ? (
              <span style={{ color: '#faad14', fontWeight: 500, fontSize: 13 }}>
                ⚠ 上次校对失败：{projectError}
              </span>
            ) : allDone ? (
              <span style={{ color: '#52c41a', fontWeight: 500 }}>
                ✓ 校对完成（已处理 {accepted.length + rejected.length} 条）
              </span>
            ) : null}

            <ControlsRow
              mode={mode} onModeChange={onModeChange}
              selectedModel={selectedModel} onModelChange={onModelChange}
              models={models}
              selectedTypes={selectedTypes} onTypesChange={onTypesChange}
              chapters={chapters} selectedChapter={selectedChapter}
              onChapterChange={onChapterChange}
              inProgress={inProgress}
            />

            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={proofreading}
              onClick={onStartProofread}
              disabled={inProgress || (mode === 'continue' && upto >= total) || (mode === 'chapter' && !selectedChapter)}
              size="small"
            >
              {allDone
                ? '继续校对'
                : mode === 'continue' && upto >= total
                  ? '已校完'
                  : projectError ? '重试' : '开始校对'}
            </Button>
          </>
        )}
      </div>
    </>
  )
}

function ControlsRow({
  mode, onModeChange,
  selectedModel, onModelChange, models,
  selectedTypes, onTypesChange,
  chapters, selectedChapter, onChapterChange,
  inProgress,
}) {
  return (
    <Space wrap size="small" style={{ justifyContent: 'center' }}>
      <Radio.Group
        value={mode}
        disabled={inProgress}
        onChange={(e) => onModeChange?.(e.target.value)}
        optionType="button"
        buttonStyle="solid"
        size="small"
      >
        <Radio value="continue">继续</Radio>
        <Radio value="chapter">章节校对</Radio>
      </Radio.Group>

      <Select
        style={{ width: 160 }}
        value={selectedModel}
        disabled={inProgress}
        onChange={onModelChange}
        options={models.map(m => ({ value: m.model_id, label: m.name }))}
        size="small"
      />

      {mode === 'chapter' && chapters.length > 0 && (
        <Select
          style={{ width: 160 }}
          placeholder="选择章节"
          value={selectedChapter}
          disabled={inProgress}
          onChange={onChapterChange}
          options={chapters.map(ch => ({
            value: ch.id,
            label: ch.title || `第 ${ch.title_paragraph_idx} 段`,
          }))}
          size="small"
        />
      )}

      <Select
        mode="multiple"
        style={{ minWidth: 180 }}
        value={selectedTypes}
        disabled={inProgress}
        onChange={onTypesChange}
        options={TYPE_OPTIONS}
        size="small"
        tagRender={(props) => {
          const { label, closable, onClose } = props
          return (
            <Tag closable={closable} onClose={onClose} style={{ margin: 0, fontSize: 12 }}>
              {label}
            </Tag>
          )
        }}
      />
    </Space>
  )
}
