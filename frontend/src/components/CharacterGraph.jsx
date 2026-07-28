import React, { useState, useEffect, useMemo } from 'react'
import { Drawer, Card, Tag, Slider, Empty, Spin, Space, Tooltip, Badge } from 'antd'
import { TeamOutlined, HistoryOutlined } from '@ant-design/icons'
import { getCharacterGraph } from '../services/api'
import { useTheme } from '../App'

const ROLE_COLORS = {
  protagonist: 'gold',
  antagonist: 'red',
  supporting: 'blue',
}

const ROLE_LABELS = {
  protagonist: '主角',
  antagonist: '反派',
  supporting: '配角',
}

const RELATION_TAG_COLORS = {
  ally: 'green',
  enemy: 'volcano',
  lover: 'magenta',
  family: 'purple',
  neutral: 'default',
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
  const [graphData, setGraphData] = useState({ nodes: [], edges: [] })
  const [currentParaIdx, setCurrentParaIdx] = useState(totalParagraphs)

  const handleJumpToPara = (paragraphIdx) => {
    if (typeof onScrollToParagraph === 'function' && paragraphIdx !== undefined && paragraphIdx !== null) {
      onScrollToParagraph(paragraphIdx)
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
      setGraphData(data || { nodes: [], edges: [] })
    } catch (e) {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      loadGraph()
    }
  }, [open, projectId, currentParaIdx])

  const activeEdges = useMemo(() => {
    return graphData.edges || []
  }, [graphData])

  return (
    <Drawer
      title={
        <Space>
          <TeamOutlined style={{ color: color.primary }} />
          <span>人物动态关系图谱 & 时间轴演进</span>
        </Space>
      }
      placement="right"
      width={560}
      open={open}
      onClose={onClose}
      styles={{
        body: {
          background: color.bgPage,
          color: color.textPrimary,
          padding: 20,
        },
        header: {
          background: color.bgCard,
          borderColor: color.border,
          color: color.textPrimary,
        },
      }}
    >
      {/* 顶部时间轴拉条控制 */}
      <Card
        size="small"
        style={{
          background: color.bgCard,
          borderColor: color.borderBar,
          marginBottom: 16,
          borderRadius: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: color.textPrimary }}>
            <HistoryOutlined style={{ marginRight: 6, color: color.primary }} />
            剧情推进时间轴（按段落）
          </span>
          <Tag color="blue" style={{ margin: 0 }}>
            截止第 {currentParaIdx} 段
          </Tag>
        </div>
        <Slider
          min={0}
          max={Math.max(totalParagraphs, 1)}
          value={currentParaIdx}
          onChange={(val) => setCurrentParaIdx(val)}
          tooltip={{ formatter: (val) => `第 ${val} 段` }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: color.textTertiary }}>
          <span>开头 (第 0 段)</span>
          <span>全书终 (第 {totalParagraphs} 段)</span>
        </div>
      </Card>

      {loading ? (
        <Spin size="large" style={{ display: 'block', margin: '40px auto' }} />
      ) : graphData.nodes.length === 0 ? (
        <Empty
          description="暂无人物关系演进数据。点击右上角“✨ LLM 智能分析全书剧情”或随文校对，系统将自动大模型萃取全书人物与关系网。"
          style={{ margin: '60px 0' }}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 角色卡片网络 */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: color.textSecondary, marginBottom: 8 }}>
              已登场角色 ({graphData.nodes.length})
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              {graphData.nodes.map((node) => (
                <Card
                  key={node.id}
                  size="small"
                  hoverable
                  onClick={() => handleJumpToPara(node.first_appear_idx)}
                  style={{
                    background: color.bgCard,
                    borderColor: color.border,
                    borderRadius: 8,
                    cursor: 'pointer',
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
                  {node.aliases && node.aliases.length > 0 && (
                    <div style={{ fontSize: 11, color: color.textTertiary, marginBottom: 4 }}>
                      别名：{node.aliases.join(' / ')}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: color.textSecondary, lineHeight: 1.4 }}>
                    {node.description || `首次出场：第 ${node.first_appear_idx} 段`}
                  </div>
                </Card>
              ))}
            </div>
          </div>

          {/* 动态演进关系链 */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: color.textSecondary, marginBottom: 8 }}>
              角色关系演进链条 ({activeEdges.length})
            </div>
            {activeEdges.length === 0 ? (
              <div style={{ fontSize: 12, color: color.textTertiary, padding: 12, textAlign: 'center' }}>
                当前段落范围内未检索到显式关系变动
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {activeEdges.map((edge) => (
                  <Card
                    key={edge.id}
                    size="small"
                    hoverable
                    onClick={() => handleJumpToPara(edge.paragraph_idx)}
                    style={{
                      background: color.bgCard,
                      borderColor: color.borderBar,
                      borderRadius: 8,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Tag color="cyan" style={{ margin: 0, fontSize: 11 }}>
                        第 {edge.paragraph_idx} 段
                      </Tag>
                      <span style={{ fontWeight: 600, color: color.textPrimary }}>
                        {edge.from_name}
                      </span>
                      <span style={{ color: color.textTertiary, fontSize: 12 }}>➔</span>
                      <span style={{ fontWeight: 600, color: color.textPrimary }}>
                        {edge.to_name}
                      </span>
                      <Tag color={RELATION_TAG_COLORS[edge.relation_type] || 'default'} style={{ margin: 0, marginLeft: 'auto' }}>
                        {edge.relation_type}
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
            <div style={{ fontSize: 13, fontWeight: 600, color: color.textSecondary, marginBottom: 8 }}>
              剧情核心关键事件 ({(graphData.plot_events || []).length})
            </div>
            {(graphData.plot_events || []).length === 0 ? (
              <div style={{ fontSize: 12, color: color.textTertiary, padding: 12, textAlign: 'center' }}>
                当前段落范围内未检索到剧情关键事件
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(graphData.plot_events || []).map((pe) => (
                  <Card
                    key={pe.id}
                    size="small"
                    hoverable
                    onClick={() => handleJumpToPara(pe.paragraph_idx)}
                    style={{
                      background: color.bgCard,
                      borderColor: color.borderBar,
                      borderRadius: 8,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <Tag color="purple" style={{ margin: 0, fontSize: 11 }}>
                        第 {pe.paragraph_idx} 段
                      </Tag>
                      <span style={{ fontWeight: 600, color: color.textPrimary, fontSize: 13 }}>
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
      )}
    </Drawer>
  )
}
