import React, { useState, useEffect, useMemo } from 'react'
import { Modal, Card, Tag, Slider, Empty, Spin, Space, Tooltip, Badge } from 'antd'
import { TeamOutlined, HistoryOutlined } from '@ant-design/icons'
import { getCharacterGraph } from '../services/api'
import { useTheme } from '../context/ThemeContext'
import { useParagraphStatus } from '../hooks/useParagraphStatus'

const ROLE_COLORS = {
  protagonist: 'gold',
  supporting: 'blue',
  antagonist: 'red',
  minor: 'default',
}

const ROLE_LABELS = {
  protagonist: '主角',
  supporting: '配角',
  antagonist: '反派',
  minor: '次要角色',
}

const RELATION_TAG_COLORS = {
  friend: 'green',
  enemy: 'volcano',
  lover: 'magenta',
  family: 'purple',
  neutral: 'default',
}

const RELATION_TAG_LABELS = {
  friend: '友好盟友',
  enemy: '敌对阵营',
  lover: '倾慕情侣',
  family: '亲情家族',
  neutral: '中立接触',
}

export default function CharacterGraph({
  open,
  onClose,
  projectId,
  totalParagraphs = 100,
  onScrollToParagraph,
}) {
  const { color } = useTheme()
  const [loading, setLoading] = useState(false)
  const [graphData, setGraphData] = useState({ nodes: [], edges: [], events: [] })
  const [currentParaIdx, setCurrentParaIdx] = useState(totalParagraphs)

  const { fetchStatusBatch, statuses } = useParagraphStatus(projectId)

  const handleJumpToPara = (paragraphIdx, paragraphUuid) => {
    if (typeof onScrollToParagraph === 'function') {
      const st = paragraphUuid ? statuses[paragraphUuid] : null
      const target = st?.target_uuid || paragraphUuid || (st?.target_idx ?? paragraphIdx)
      if (target !== undefined && target !== null) {
        onScrollToParagraph(target)
        onClose?.()
      }
    }
  }

  useEffect(() => {
    if (totalParagraphs > 0) {
      setCurrentParaIdx(totalParagraphs)
    }
  }, [totalParagraphs])

  const loadGraph = async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const data = await getCharacterGraph(projectId, currentParaIdx)
      setGraphData(data || { nodes: [], edges: [], events: [] })
      
      const uuids = []
      data?.nodes?.forEach(n => n.first_appear_paragraph_uuid && uuids.push(n.first_appear_paragraph_uuid))
      data?.edges?.forEach(e => e.paragraph_uuid && uuids.push(e.paragraph_uuid))
      data?.events?.forEach(ev => ev.paragraph_uuid && uuids.push(ev.paragraph_uuid))
      if (uuids.length > 0) {
        fetchStatusBatch(uuids)
      }
    } catch (e) {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open && projectId) {
      loadGraph()
    }
  }, [open, projectId, currentParaIdx])

  const renderParaStatusBadge = (uuid, fallbackIdx) => {
    const st = uuid ? statuses[uuid] : null
    if (!st) {
      return fallbackIdx !== undefined && fallbackIdx !== null ? `第 ${fallbackIdx + 1} 段` : '未定位'
    }
    if (st.status === 'merged') {
      return `⚡️ 已合并至第 ${st.target_idx + 1} 段`
    }
    if (st.status === 'deleted' || st.status === 'merged_then_deleted') {
      return `⚠️ 引用段落已被删除`
    }
    if (st.status === 'stale_version') {
      return `旧版本段落 (v${st.version})`
    }
    return `第 ${(st.target_idx ?? fallbackIdx) + 1} 段`
  }

  const activeEdges = useMemo(() => {
    return graphData.edges || []
  }, [graphData])

  return (
    <Modal
      title={
        <Space>
          <TeamOutlined style={{ color: color.primary }} />
          <span>全书人物图谱 & 动态关系与剧情演进</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={1020}
      zIndex={1100}
      footer={null}
      destroyOnHidden
      styles={{
        content: {
          background: color.bgPage,
          color: color.textPrimary,
          padding: 24,
          borderRadius: 12,
        },
        header: {
          background: 'transparent',
          color: color.textPrimary,
          marginBottom: 16,
        },
      }}
    >
      {/* 顶部时间轴拉条控制 */}
      <Card
        size="small"
        style={{
          background: color.bgCard,
          borderColor: color.borderBar,
          marginBottom: 20,
          borderRadius: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: color.textPrimary }}>
            <HistoryOutlined style={{ marginRight: 6, color: color.primary }} />
            剧情推进时间轴（按段落）
          </span>
          <Tag color="blue" style={{ margin: 0 }}>
            截止第 {Math.min(currentParaIdx + 1, totalParagraphs)} 段
          </Tag>
        </div>
        <Slider
          min={0}
          max={Math.max(totalParagraphs, 1)}
          value={currentParaIdx}
          onChange={(val) => setCurrentParaIdx(val)}
          tooltip={{ formatter: (val) => val >= totalParagraphs ? `全书终 (第 ${totalParagraphs} 段)` : `第 ${val + 1} 段` }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: color.textTertiary }}>
          <span>开头 (第 1 段)</span>
          <span>全书终 (第 {totalParagraphs} 段)</span>
        </div>
      </Card>

      {loading ? (
        <Spin size="large" style={{ display: 'block', margin: '40px auto' }} />
      ) : graphData.nodes.length === 0 ? (
        <Empty
          description="暂无人物关系与剧情事件数据。发起随文校对后，大模型将自动无感萃取全书角色、关系演进与关键事件。"
          style={{ margin: '60px 0' }}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* 1. 角色卡片列表（横向平铺展示） */}
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: color.textSecondary, marginBottom: 10 }}>
              👤 已登场角色 ({graphData.nodes.length})
            </div>
            <div style={{ display: 'flex', overflowX: 'auto', gap: 12, paddingBottom: 8 }}>
              {graphData.nodes.map((node) => (
                <Card
                  key={node.id}
                  size="small"
                  hoverable
                  onClick={() => handleJumpToPara(node.first_appear_idx, node.first_appear_paragraph_uuid)}
                  style={{
                    background: color.bgCard,
                    borderColor: color.border,
                    borderRadius: 8,
                    cursor: 'pointer',
                    width: 220,
                    flexShrink: 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, color: color.textPrimary, fontSize: 14 }}>
                      {node.name}
                    </span>
                    <Tag color={ROLE_COLORS[node.role] || 'default'} style={{ margin: 0, fontSize: 11 }}>
                      {ROLE_LABELS[node.role] || '角色'}
                    </Tag>
                  </div>
                  <div style={{ marginBottom: 6 }}>
                    <Tag color="purple" style={{ fontSize: 11, margin: 0 }}>
                      首次登场：{renderParaStatusBadge(node.first_appear_paragraph_uuid, node.first_appear_idx)} 🎯
                    </Tag>
                  </div>
                  {node.aliases && node.aliases.length > 0 && (
                    <div style={{ fontSize: 11, color: color.textTertiary, marginBottom: 4 }}>
                      别名：{node.aliases.join(' / ')}
                    </div>
                  )}
                  {node.description && (
                    <div style={{ fontSize: 12, color: color.textSecondary, lineHeight: 1.4 }}>
                      {node.description}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </div>

          {/* 2. 动态演进关系链与剧情关键事件（双栏对称平铺） */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            {/* 角色关系演进链条 */}
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: color.textSecondary, marginBottom: 10 }}>
                🔗 角色关系演进链条 ({activeEdges.length})
              </div>
              {activeEdges.length === 0 ? (
                <div style={{ fontSize: 12, color: color.textTertiary, padding: 16, textAlign: 'center', background: color.bgCard, borderRadius: 8 }}>
                  当前段落范围内未检索到显式关系变动
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto', paddingRight: 4 }}>
                  {activeEdges.map((edge) => (
                    <Card
                      key={edge.id}
                      size="small"
                      hoverable
                      onClick={() => handleJumpToPara(edge.paragraph_idx, edge.paragraph_uuid)}
                      style={{
                        background: color.bgCard,
                        borderColor: color.borderBar,
                        borderRadius: 8,
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Tag color="cyan" style={{ margin: 0, fontSize: 11 }}>
                          {renderParaStatusBadge(edge.paragraph_uuid, edge.paragraph_idx)} 🎯
                        </Tag>
                        <span style={{ fontWeight: 600, color: color.textPrimary }}>
                          {edge.from_name}
                        </span>
                        <span style={{ color: color.textTertiary, fontSize: 12 }}>➔</span>
                        <span style={{ fontWeight: 600, color: color.textPrimary }}>
                          {edge.to_name}
                        </span>
                        <Tag color={RELATION_TAG_COLORS[edge.relation_type] || 'default'} style={{ margin: 0, marginLeft: 'auto' }}>
                          {RELATION_TAG_LABELS[edge.relation_type] || edge.relation_type}
                        </Tag>
                      </div>
                      {edge.description && (
                        <div style={{ marginTop: 6, fontSize: 12, color: color.textSecondary, background: color.bgPage, padding: '4px 8px', borderRadius: 4 }}>
                          {edge.description}
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* 剧情关键事件时间轴 */}
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: color.textSecondary, marginBottom: 10 }}>
                📌 剧情核心关键事件 ({(graphData.plot_events || []).length})
              </div>
              {(graphData.plot_events || []).length === 0 ? (
                <div style={{ fontSize: 12, color: color.textTertiary, padding: 16, textAlign: 'center', background: color.bgCard, borderRadius: 8 }}>
                  当前段落范围内未检索到剧情关键事件
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto', paddingRight: 4 }}>
                  {(graphData.plot_events || []).map((pe) => (
                    <Card
                      key={pe.id}
                      size="small"
                      hoverable
                      onClick={() => handleJumpToPara(pe.paragraph_idx, pe.paragraph_uuid)}
                      style={{
                        background: color.bgCard,
                        borderColor: color.borderBar,
                        borderRadius: 8,
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Tag color="gold" style={{ margin: 0, fontSize: 11 }}>
                          {renderParaStatusBadge(pe.paragraph_uuid, pe.paragraph_idx)} 🎯
                        </Tag>
                        <span style={{ fontWeight: 600, color: color.textPrimary }}>
                          {pe.title}
                        </span>
                      </div>
                        {pe.description && (
                          <div style={{ fontSize: 12, color: color.textSecondary, lineHeight: 1.4 }}>
                            {pe.description}
                          </div>
                        )}
                      </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
