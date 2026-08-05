import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Modal, Card, Tag, Slider, Empty, Spin, Space, Tooltip, Badge, Select, Button, message, Divider, Alert, Drawer, Input } from 'antd'
import {
  TeamOutlined,
  HistoryOutlined,
  SearchOutlined,
  ClearOutlined,
  NodeIndexOutlined,
  UserOutlined,
  ClockCircleOutlined,
  CompassOutlined,
  ArrowRightOutlined,
  SyncOutlined,
  WarningOutlined,
  FileTextOutlined,
  FilterOutlined,
} from '@ant-design/icons'
import { Graph, NodeEvent, CanvasEvent } from '@antv/g6'
import { getCharacterGraph, getCharacterShortestPath, getEntityDictionaryStatus, rescanEntities } from '../services/api'
import { useTheme } from '../context/ThemeContext'
import { useParagraphStatus } from '../hooks/useParagraphStatus'

const ROLE_COLORS = {
  protagonist: 'gold',
  supporting: 'blue',
  antagonist: 'red',
  minor: 'default',
}

// 节点填充色（角色主导，柔和可读；替代单调的社区同色）
const ROLE_FILLS = {
  protagonist: '#f5b50a',  // 金
  supporting: '#4a8fe0',   // 蓝
  antagonist: '#e05252',   // 红
  minor: '#9aa5b1',        // 灰蓝
}

const ROLE_STROKES = {
  protagonist: '#c98a00',
  supporting: '#2f6fc0',
  antagonist: '#b53a3a',
  minor: '#7c8794',
}

const ROLE_LABELS = {
  protagonist: '主角',
  supporting: '配角',
  antagonist: '反派',
  minor: '次要角色',
}

const COMMUNITY_COLORS = [
  '#1890ff', // 蓝色
  '#52c41a', // 绿色
  '#fa8c16', // 橙色
  '#722ed1', // 紫色
  '#eb2f96', // 品红
  '#13c2c2', // 青色
  '#faad14', // 黄色
  '#2f54eb', // 蓝靛
]

const CATEGORY_COLORS = {
  family: 'purple',
  intimate: 'magenta',
  hostile: 'volcano',
  social: 'green',
  neutral: 'cyan',
  hierarchical: 'gold',
}

const CATEGORY_LABELS = {
  family: '血亲家族',
  intimate: '亲密结拜',
  hostile: '敌对阵营',
  social: '社交朋友',
  neutral: '中立接触',
  hierarchical: '师徒主仆',
}

const CATEGORY_EDGE_COLORS = {
  family: '#722ed1',
  intimate: '#eb2f96',
  hostile: '#f5222d',
  social: '#52c41a',
  neutral: '#13c2c2',
  hierarchical: '#faad14',
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
  const [graphData, setGraphData] = useState({ nodes: [], edges: [], plot_events: [] })
  const [currentParaIdx, setCurrentParaIdx] = useState(totalParagraphs)

  // 词典过期感知与重扫
  const [dictExpired, setDictExpired] = useState(false)
  const [rescanning, setRescanning] = useState(false)
  const [charSearch, setCharSearch] = useState('')

  // 分类过滤与强度滑块
  const [selectedCategories, setSelectedCategories] = useState(['family', 'intimate', 'hostile', 'social', 'neutral', 'hierarchical'])
  const [minStrength, setMinStrength] = useState(1)

  // Dijkstra 最短路径交互状态 (后端 API 计算)
  const [sourceId, setSourceId] = useState(null)
  const [targetId, setTargetId] = useState(null)
  const [pathLoading, setPathLoading] = useState(false)
  const [highlightedPath, setHighlightedPath] = useState(null)

  // 侧边栏选中的角色节点 ID
  const [selectedNodeId, setSelectedNodeId] = useState(null)
  
  // 选中的边详情 (用于查看原文证据与阶段演进)
  const [selectedEdge, setSelectedEdge] = useState(null)

  const containerRef = useRef(null)
  const graphInstanceRef = useRef(null)

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

  const checkDictStatus = async () => {
    if (!projectId) return
    try {
      const res = await getEntityDictionaryStatus(projectId)
      setDictExpired(!!res?.expired)
    } catch (e) {
      // ignore
    }
  }

  const handleRescan = async () => {
    if (!projectId) return
    setRescanning(true)
    try {
      const res = await rescanEntities(projectId)
      message.success(`实体预扫描完成，词典已更新（共 ${res.entity_count || 0} 个实体候选）`)
      setDictExpired(false)
    } catch (e) {
      message.error('预扫描执行失败')
    } finally {
      setRescanning(false)
    }
  }

  const loadGraph = async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const data = await getCharacterGraph(projectId, currentParaIdx)
      setGraphData(data || { nodes: [], edges: [], plot_events: [] })

      if (data?.suggested_min_strength) {
        setMinStrength(data.suggested_min_strength)
      }

      if (data?.nodes?.length > 0 && !selectedNodeId) {
        const sorted = [...data.nodes].sort((a, b) => (b.centrality || 0) - (a.centrality || 0))
        setSelectedNodeId(sorted[0].id)
      }

      const uuids = []
      data?.nodes?.forEach((n) => n.first_appear_paragraph_uuid && uuids.push(n.first_appear_paragraph_uuid))
      data?.edges?.forEach((e) => e.paragraph_uuid && uuids.push(e.paragraph_uuid))
      data?.plot_events?.forEach((ev) => ev.paragraph_uuid && uuids.push(ev.paragraph_uuid))
      if (uuids.length > 0) {
        fetchStatusBatch(uuids)
      }
      checkDictStatus()
    } catch (e) {
      console.error('加载人物图谱失败:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open && projectId) {
      loadGraph()
    }
  }, [open, projectId, currentParaIdx])

  const selectedNode = useMemo(() => {
    if (!graphData.nodes || graphData.nodes.length === 0) return null
    return graphData.nodes.find((n) => n.id === selectedNodeId) || graphData.nodes[0]
  }, [graphData.nodes, selectedNodeId])

  // 角色列表排序（中心度降序，其次登场序）+ 搜索过滤
  const listNodes = useMemo(() => {
    const kw = charSearch.trim()
    const filtered = (graphData.nodes || []).filter(
      (n) => !kw || n.name.includes(kw) || (n.aliases || []).some((a) => a.includes(kw))
    )
    return [...filtered].sort((a, b) => (b.centrality || 0) - (a.centrality || 0) || (a.first_appear_idx || 0) - (b.first_appear_idx || 0))
  }, [graphData.nodes, charSearch])

  // 焦点角色的直接关系清单（从当前快照投影边中取）
  const selectedNodeEdges = useMemo(() => {
    if (!selectedNodeId) return []
    return (graphData.edges || []).filter(
      (e) => e.from_char_id === selectedNodeId || e.to_char_id === selectedNodeId
    )
  }, [graphData.edges, selectedNodeId])

  // 按分类与强度条件过滤后的图数据
  const filteredEdges = useMemo(() => {
    const rawEdges = graphData.edges || []
    return rawEdges.filter((e) => {
      const cat = e.category || 'neutral'
      const matchCat = selectedCategories.includes(cat)
      const matchStr = (e.strength || 1) >= minStrength
      return matchCat && matchStr
    })
  }, [graphData.edges, selectedCategories, minStrength])

  // 格式化 AntV G6 (v5) 输入数据
  const formattedG6Data = useMemo(() => {
    const nodes = (graphData.nodes || []).map((n) => {
      const centrality = n.centrality || 0
      const degree = n.degree || 0
      const nodeSize = Math.min(56, Math.max(28, Math.round(28 + centrality * 36 + Math.min(degree, 10) * 1.5)))
      const commId = n.community_id !== undefined ? n.community_id : 0
      const communityColor = COMMUNITY_COLORS[commId % COMMUNITY_COLORS.length]
      const roleFill = ROLE_FILLS[n.role] || ROLE_FILLS.minor
      const strokeColor = ROLE_STROKES[n.role] || ROLE_STROKES.minor
      const isUngrounded = !!n.ungrounded

      return {
        id: n.id,
        name: n.name,
        role: n.role,
        centrality: n.centrality,
        community_id: n.community_id,
        description: n.description,
        aliases: n.aliases,
        history: n.history || [],
        ungrounded: isUngrounded,
        first_appear_idx: n.first_appear_idx,
        first_appear_paragraph_uuid: n.first_appear_paragraph_uuid,
        style: {
          size: nodeSize,
          fill: isUngrounded ? '#e0e0e0' : roleFill,
          stroke: isUngrounded ? '#999999' : strokeColor,
          lineDash: isUngrounded ? [4, 4] : undefined,
          lineWidth: 2,
          labelText: n.name,
          labelFill: color.textPrimary,
          labelFontSize: 12,
          labelFontWeight: 500,
          labelPlacement: 'center',
          labelBackground: true,
          labelBackgroundFill: color.bgCard,
          labelBackgroundOpacity: 0.92,
          labelBackgroundPadding: [2, 5],
          labelBackgroundRadius: 3,
        },
      }
    })

    const edges = filteredEdges.map((e, idx) => {
      const cat = e.category || 'neutral'
      const edgeColor = CATEGORY_EDGE_COLORS[cat] || '#13c2c2'
      const labelText = CATEGORY_LABELS[cat] || e.relation_type || ''
      return {
        id: e.id || `edge-${e.from_char_id}-${e.to_char_id}-${idx}`,
        source: e.from_char_id,
        target: e.to_char_id,
        relation_type: e.relation_type,
        category: cat,
        description: e.description,
        evidence: e.evidence,
        confidence: e.confidence,
        paragraph_idx: e.paragraph_idx,
        paragraph_uuid: e.paragraph_uuid,
        strength: e.strength,
        stages: e.stages || [],
        suspicious: e.suspicious,
        style: {
          stroke: edgeColor,
          lineWidth: Math.min(7, Math.max(2, Math.round(1.5 + Math.log2(e.strength || 1)))),
          endArrow: false, // 去除 endArrow，更符合无向关系视觉
          labelText: (e.suspicious ? '⚠️ ' : '') + labelText,
          labelFill: color.textSecondary,
          labelFontSize: 11,
          labelBackground: true,
          labelBackgroundFill: color.bgCard,
          labelBackgroundPadding: [2, 4],
          labelBackgroundRadius: 4,
        },
      }
    })

    return { nodes, edges }
  }, [graphData.nodes, filteredEdges, color])

  // 对指定角色执行 ego-network 高亮（焦点 + 一跳边，不隐藏其他节点）
  const applyFocusHighlight = useCallback(
    (clickedId) => {
      if (!graphInstanceRef.current || highlightedPath) return
      const neighborNodeIds = new Set([clickedId])
      const connectedEdgeIds = new Set()
      formattedG6Data.edges.forEach((edge) => {
        if (edge.source === clickedId || edge.target === clickedId) {
          connectedEdgeIds.add(edge.id)
          neighborNodeIds.add(edge.source)
          neighborNodeIds.add(edge.target)
        }
      })
      const stateUpdates = {}
      formattedG6Data.nodes.forEach((n) => {
        if (n.id === clickedId) stateUpdates[n.id] = ['selected']
        else if (neighborNodeIds.has(n.id)) stateUpdates[n.id] = ['neighbor']
        else stateUpdates[n.id] = []
      })
      formattedG6Data.edges.forEach((ed) => {
        stateUpdates[ed.id] = connectedEdgeIds.has(ed.id) ? ['highlight'] : []
      })
      graphInstanceRef.current.setElementState(stateUpdates)
    },
    [formattedG6Data, highlightedPath]
  )

  // 角色列表点击：设焦点 + ego 高亮
  const handleFocusCharacter = useCallback(
    (id) => {
      setSelectedNodeId(id)
      applyFocusHighlight(id)
    },
    [applyFocusHighlight]
  )

  // 初始化与重绘 G6 (v5) Canvas 画布
  useEffect(() => {
    if (!open || loading || !containerRef.current || formattedG6Data.nodes.length === 0) return

    const width = containerRef.current.clientWidth || 660
    const height = containerRef.current.clientHeight || 460

    if (graphInstanceRef.current) {
      try {
        graphInstanceRef.current.destroy()
      } catch (e) {
        // ignore
      }
      graphInstanceRef.current = null
    }

    const nodeCount = formattedG6Data.nodes.length
    const chargeStrength = Math.max(-500, -180 - nodeCount * 8)
    const linkDist = Math.min(220, Math.max(100, 120 + nodeCount * 2))

    const graph = new Graph({
      container: containerRef.current,
      width,
      height,
      autoFit: 'view',
      data: formattedG6Data,
      layout: {
        type: 'd3-force',
        preventOverlap: true,
        linkDistance: linkDist,
        nodeStrength: chargeStrength,
      },
      node: {
        style: {
          size: (d) => d.style?.size || 32,
          fill: (d) => d.style?.fill || '#4a8fe0',
          stroke: (d) => d.style?.stroke || '#2f6fc0',
          lineDash: (d) => d.style?.lineDash,
          lineWidth: 2,
          labelText: (d) => d.style?.labelText || d.name || d.id,
          labelFill: (d) => d.style?.labelFill || color.textPrimary,
          labelFontSize: 12,
          labelFontWeight: 500,
          labelPlacement: 'center',
          labelBackground: true,
          labelBackgroundFill: color.bgCard,
          labelBackgroundOpacity: 0.92,
          labelBackgroundPadding: [2, 5],
          labelBackgroundRadius: 3,
        },
        state: {
          // 最短路径高亮
          highlight: {
            lineWidth: 5,
            stroke: '#faad14',
            opacity: 1,
          },
          // 点击选中的焦点节点
          selected: {
            lineWidth: 5,
            stroke: '#faad14',
            fill: '#fff1c0',
            opacity: 1,
          },
          // 焦点一跳邻居（仅轻微强调，不隐藏其他节点）
          neighbor: {
            stroke: '#faad14',
            lineWidth: 3,
            opacity: 1,
          },
          dark: {
            opacity: 0.15,
          },
        },
      },
      edge: {
        style: {
          stroke: (d) => d.style?.stroke || '#13c2c2',
          lineWidth: (d) => d.style?.lineWidth || 2,
          endArrow: false,
          labelText: (d) => d.style?.labelText || '',
          labelFill: color.textSecondary,
          labelFontSize: 11,
          labelBackground: true,
          labelBackgroundFill: color.bgCard,
          labelBackgroundPadding: [2, 4],
          labelBackgroundRadius: 4,
        },
        state: {
          highlight: {
            stroke: '#faad14',
            lineWidth: 4,
            opacity: 1,
          },
          dark: {
            opacity: 0.1,
          },
        },
      },
      behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element', 'click-select'],
    })

    graph.render()
    graphInstanceRef.current = graph

    // 节点点击事件：选中与聚焦（仅高亮焦点及一跳邻居，不隐藏其他节点）
    graph.on(NodeEvent.CLICK, (e) => {
      const clickedId = e.target?.id || e.target?.data?.id
      if (clickedId) {
        setSelectedNodeId(clickedId)
        applyFocusHighlight(clickedId)

        // Dijkstra 起终点填充
        setSourceId((prevSource) => {
          if (!prevSource) return clickedId
          if (prevSource !== clickedId && !targetId) {
            setTargetId(clickedId)
            return prevSource
          }
          return prevSource
        })
      }
    })

    // 边点击事件：查看详细证据与演变
    graph.on('edge:click', (e) => {
      const clickedEdgeId = e.target?.id || e.target?.data?.id
      const foundEdge = filteredEdges.find((ed) => ed.id === clickedEdgeId)
      if (foundEdge) {
        setSelectedEdge(foundEdge)
      }
    })

    // 画布重置
    graph.on(CanvasEvent.CLICK, () => {
      if (!highlightedPath) {
        const resetStates = {}
        formattedG6Data.nodes.forEach((n) => (resetStates[n.id] = []))
        formattedG6Data.edges.forEach((ed) => (resetStates[ed.id] = []))
        graph.setElementState(resetStates)
      }
    })

    return () => {
      if (graphInstanceRef.current) {
        try {
          graphInstanceRef.current.destroy()
        } catch (e) {
          // ignore
        }
        graphInstanceRef.current = null
      }
    }
  }, [open, loading, formattedG6Data, highlightedPath])

  // 执行最短关系路径求解 (调用后端 Dijkstra API)
  const handleFindShortestPath = async () => {
    if (!sourceId || !targetId) {
      message.warning('请选择起点角色和终点角色')
      return
    }
    if (sourceId === targetId) {
      message.warning('起点与终点不能为同一角色')
      return
    }

    setPathLoading(true)
    try {
      const res = await getCharacterShortestPath(projectId, sourceId, targetId, currentParaIdx)

      if (res && (res.found || (res.path_nodes && res.path_nodes.length > 0))) {
        const pathNodes = res.path_nodes || []
        const pathEdges = res.path_edges || []
        const pathNodeIds = new Set(pathNodes.map((n) => n.id))
        const pathEdgeIds = new Set(pathEdges.map((e) => e.id))

        const pairSet = new Set()
        for (let i = 0; i < pathNodes.length - 1; i++) {
          const u = pathNodes[i].id
          const v = pathNodes[i + 1].id
          pairSet.add(`${u}->${v}`)
          pairSet.add(`${v}->${u}`)
        }

        const stateUpdates = {}
        formattedG6Data.nodes.forEach((n) => {
          stateUpdates[n.id] = pathNodeIds.has(n.id) ? 'highlight' : 'dark'
        })
        formattedG6Data.edges.forEach((e) => {
          const isDirectPathEdge = pathEdgeIds.has(e.id)
          const isPairEdge = pairSet.has(`${e.source}->${e.target}`) || pairSet.has(`${e.target}->${e.source}`)
          stateUpdates[e.id] = isDirectPathEdge || isPairEdge ? 'highlight' : 'dark'
        })

        if (graphInstanceRef.current) {
          graphInstanceRef.current.setElementState(stateUpdates)
        }

        setHighlightedPath(res)

        const sourceNode = graphData.nodes.find((n) => n.id === sourceId)
        const targetNode = graphData.nodes.find((n) => n.id === targetId)
        message.success(
          `已高亮【${sourceNode?.name || sourceId}】➔【${targetNode?.name || targetId}】的最短关系链（关联步数: ${
            pathNodes.length - 1
          }）`
        )
      } else {
        handleClearHighlight()
        const sourceNode = graphData.nodes.find((n) => n.id === sourceId)
        const targetNode = graphData.nodes.find((n) => n.id === targetId)
        message.warning(
          res?.message || `角色【${sourceNode?.name || 'A'}】与【${targetNode?.name || 'B'}】在当前剧情进度下未建立连通关系网络`
        )
      }
    } catch (e) {
      console.error('求解最短路径失败:', e)
      message.error('求解最短路径请求异常')
    } finally {
      setPathLoading(false)
    }
  }

  // 清除高亮并恢复焦点
  const handleClearHighlight = () => {
    setHighlightedPath(null)
    if (graphInstanceRef.current && formattedG6Data.nodes.length > 0) {
      const resetStates = {}
      formattedG6Data.nodes.forEach((n) => (resetStates[n.id] = []))
      formattedG6Data.edges.forEach((e) => (resetStates[e.id] = []))
      graphInstanceRef.current.setElementState(resetStates)
    }
  }

  const toggleCategory = (cat) => {
    if (selectedCategories.includes(cat)) {
      if (selectedCategories.length === 1) {
        message.warning('请至少保留一个关系分类')
        return
      }
      setSelectedCategories(selectedCategories.filter((c) => c !== cat))
    } else {
      setSelectedCategories([...selectedCategories, cat])
    }
  }

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

  return (
    <Modal
      title={
        <Space>
          <TeamOutlined style={{ color: color.primary }} />
          <span>全书角色关系图谱 & 物理拓扑演进网络</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={1240}
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
          marginBottom: 12,
        },
      }}
    >
      {/* 实体词典过期轻量提示（不打扰） */}
      {dictExpired && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
            fontSize: 12,
            color: color.textSecondary,
            flexWrap: 'wrap',
          }}
        >
          <Tag color="warning" icon={<WarningOutlined />} style={{ margin: 0 }}>
            词典可能已过期
          </Tag>
          <span>大篇幅校对后词频可能变化</span>
          <Button
            size="small"
            type="link"
            icon={<SyncOutlined spinning={rescanning} />}
            onClick={handleRescan}
            loading={rescanning}
            style={{ padding: 0 }}
          >
            重新预扫描
          </Button>
        </div>
      )}

      {/* 顶部时间轴拉条控制 */}
      <Card
        size="small"
        style={{
          background: color.bgCard,
          borderColor: color.borderBar,
          marginBottom: 12,
          borderRadius: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: color.textPrimary }}>
            <HistoryOutlined style={{ marginRight: 6, color: color.primary }} />
            剧情推进时间轴（按段落演进快照 G_t）
          </span>
          <Tag color="blue" style={{ margin: 0 }}>
            截止第 {Math.min(currentParaIdx + 1, totalParagraphs)} 段
          </Tag>
        </div>
        <Slider
          min={0}
          max={Math.max(totalParagraphs, 1)}
          value={currentParaIdx}
          onChange={(val) => {
            setCurrentParaIdx(val)
            handleClearHighlight()
          }}
          tooltip={{ formatter: (val) => (val >= totalParagraphs ? `全书终 (第 ${totalParagraphs} 段)` : `第 ${val + 1} 段`) }}
        />
      </Card>

      {/* 分类过滤与强度降噪工具栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: color.textSecondary, marginRight: 4 }}>
            <FilterOutlined /> 关系分类过滤:
          </span>
          {Object.keys(CATEGORY_LABELS).map((cat) => {
            const isChecked = selectedCategories.includes(cat)
            const count = graphData.category_counts?.[cat] || 0
            return (
              <Tag
                key={cat}
                color={isChecked ? CATEGORY_COLORS[cat] : 'default'}
                style={{ cursor: 'pointer', opacity: isChecked ? 1 : 0.45, borderRadius: 12, padding: '2px 8px' }}
                onClick={() => toggleCategory(cat)}
              >
                {CATEGORY_LABELS[cat]} ({count})
              </Tag>
            )
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: color.textSecondary }}>最小关联强度:</span>
          <Slider
            min={1}
            max={graphData.max_strength || 10}
            value={minStrength}
            onChange={setMinStrength}
            style={{ width: 100, margin: 0 }}
          />
          <Tag color="cyan" style={{ margin: 0 }}>≥ {minStrength}</Tag>
        </div>
      </div>

      {loading ? (
        <Spin size="large" style={{ display: 'block', margin: '60px auto' }} />
      ) : graphData.nodes.length === 0 ? (
        <Empty
          description="暂无人物关系与剧情事件数据。发起随文校对后，大模型将自动萃取全书角色、拓扑关系与重点演进履历。"
          style={{ margin: '60px 0' }}
        />
      ) : (
        <div style={{ display: 'flex', gap: 16 }}>
          {/* 左侧：角色列表（主入口） */}
          <div style={{ width: 210, display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
            <Input
              size="small"
              prefix={<SearchOutlined />}
              placeholder="搜索角色"
              value={charSearch}
              onChange={(e) => setCharSearch(e.target.value)}
              allowClear
            />
            <div
              style={{
                flex: 1,
                maxHeight: 440,
                overflowY: 'auto',
                background: color.bgCard,
                border: `1px solid ${color.borderBar}`,
                borderRadius: 8,
                padding: 4,
              }}
            >
              {listNodes.length === 0 ? (
                <div style={{ fontSize: 12, color: color.textTertiary, padding: '16px 8px', textAlign: 'center' }}>
                  无匹配角色
                </div>
              ) : (
                listNodes.map((n) => {
                  const isSelected = n.id === selectedNodeId
                  return (
                    <div
                      key={n.id}
                      onClick={() => handleFocusCharacter(n.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 8px',
                        borderRadius: 6,
                        cursor: 'pointer',
                        background: isSelected ? color.bgHighlight : 'transparent',
                        fontWeight: isSelected ? 600 : 400,
                        color: color.textPrimary,
                      }}
                      title={n.role ? ROLE_LABELS[n.role] : ''}
                    >
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          flexShrink: 0,
                          background: ROLE_FILLS[n.role] || ROLE_FILLS.minor,
                          border: `1px solid ${ROLE_STROKES[n.role] || ROLE_STROKES.minor}`,
                        }}
                      />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
                        {n.name}
                      </span>
                      <span style={{ fontSize: 11, color: color.textTertiary, flexShrink: 0 }}>
                        {n.degree || 0}
                      </span>
                    </div>
                  )
                })
              )}
            </div>
            <div style={{ fontSize: 11, color: color.textTertiary, textAlign: 'center' }}>
              共 {graphData.nodes.length} 个角色 · 数字为关联边数
            </div>
          </div>

          {/* 中间：AntV G6 物理力导向拓扑关系图视窗 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {/* Dijkstra 图算法交互工具栏 */}
            <Card
              size="small"
              style={{
                background: color.bgCard,
                borderColor: color.borderBar,
                marginBottom: 12,
                borderRadius: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <NodeIndexOutlined style={{ color: color.primary, fontSize: 16 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: color.textPrimary }}>最短关系链求解 (后端 Dijkstra):</span>

                <Select
                  size="small"
                  placeholder="选择起点角色"
                  value={sourceId}
                  onChange={setSourceId}
                  style={{ width: 130 }}
                  allowClear
                >
                  {graphData.nodes.map((n) => (
                    <Select.Option key={n.id} value={n.id}>
                      {n.name}
                    </Select.Option>
                  ))}
                </Select>

                <ArrowRightOutlined style={{ color: color.textTertiary, fontSize: 12 }} />

                <Select
                  size="small"
                  placeholder="选择终点角色"
                  value={targetId}
                  onChange={setTargetId}
                  style={{ width: 130 }}
                  allowClear
                >
                  {graphData.nodes.map((n) => (
                    <Select.Option key={n.id} value={n.id}>
                      {n.name}
                    </Select.Option>
                  ))}
                </Select>

                <Button
                  type="primary"
                  size="small"
                  icon={<SearchOutlined />}
                  loading={pathLoading}
                  onClick={handleFindShortestPath}
                >
                  高亮最短路径
                </Button>

                {highlightedPath && (
                  <Button size="small" icon={<ClearOutlined />} onClick={handleClearHighlight}>
                    重置高亮
                  </Button>
                )}
              </div>

              {/* 最短路径逐跳步骤面板 */}
              {highlightedPath && highlightedPath.path_nodes && (
                <div
                  style={{
                    marginTop: 10,
                    padding: '8px 12px',
                    background: color.bgPage,
                    borderRadius: 6,
                    border: `1px solid ${color.borderBar}`,
                    fontSize: 12,
                  }}
                >
                  <div style={{ fontWeight: 600, color: color.primary, marginBottom: 4 }}>
                    🛣️ 路径步骤面板 (共 {highlightedPath.path_nodes.length - 1} 跳 · 加权总距离: {highlightedPath.total_distance}):
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {highlightedPath.path_nodes.map((pn, idx) => {
                      const nextEdge = highlightedPath.path_edges?.[idx]
                      const cat = nextEdge?.category || 'neutral'
                      return (
                        <React.Fragment key={pn.id}>
                          <Tag color="blue" style={{ margin: 0 }}>{pn.name}</Tag>
                          {nextEdge && (
                            <span style={{ fontSize: 11, color: color.textSecondary }}>
                              —<Tag color={CATEGORY_COLORS[cat]} style={{ margin: '0 2px', fontSize: 10 }}>{CATEGORY_LABELS[cat] || nextEdge.relation_type}</Tag>→
                            </span>
                          )}
                        </React.Fragment>
                      )
                    })}
                  </div>
                </div>
              )}
            </Card>

            {/* AntV G6 Canvas 视窗容器 */}
            <div
              ref={containerRef}
              style={{
                width: '100%',
                height: 480,
                background: color.bgCard,
                borderRadius: 8,
                border: `1px solid ${color.borderBar}`,
                position: 'relative',
                overflow: 'hidden',
              }}
            />
          </div>

          {/* 右侧：两段式角色详情侧边栏 */}
          <div style={{ width: 360, display: 'flex', flexDirection: 'column', gap: 12, flexShrink: 0 }}>
            {selectedNode ? (
              <>
                {/* 1. 上段：全局精炼 Profile (上限 ~100 字) */}
                <Card
                  size="small"
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 600, fontSize: 15, color: color.textPrimary }}>
                        <UserOutlined style={{ marginRight: 6, color: color.primary }} />
                        {selectedNode.name}
                      </span>
                      <Tag color={ROLE_COLORS[selectedNode.role] || 'default'} style={{ margin: 0 }}>
                        {ROLE_LABELS[selectedNode.role] || '角色'}
                      </Tag>
                    </div>
                  }
                  style={{
                    background: color.bgCard,
                    borderColor: color.borderBar,
                    borderRadius: 8,
                  }}
                >
                  {selectedNode.ungrounded && (
                    <Alert
                      type="info"
                      showIcon
                      message="原文未检索到该角色"
                      description="该角色主名与别名均未在正文中直接检索到，可能为模型推理关联补全。"
                      style={{ marginBottom: 8, padding: '4px 8px' }}
                    />
                  )}

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                    <Tag
                      color={
                        COMMUNITY_COLORS[
                          (selectedNode.community_id !== undefined ? selectedNode.community_id : 0) % COMMUNITY_COLORS.length
                        ]
                      }
                      style={{ fontSize: 11, margin: 0 }}
                    >
                      阵营/社区 #{selectedNode.community_id ?? 0}
                    </Tag>
                    <Tag color="cyan" style={{ fontSize: 11, margin: 0 }}>
                      介数中心度: {selectedNode.centrality || 0}
                    </Tag>
                    <Tag color="blue" style={{ fontSize: 11, margin: 0 }}>
                      关联度: {selectedNode.degree || 0} 边
                    </Tag>
                  </div>

                  {selectedNode.aliases && selectedNode.aliases.length > 0 && (
                    <div style={{ fontSize: 12, color: color.textTertiary, marginBottom: 6 }}>
                      别名：{selectedNode.aliases.join(' / ')}
                    </div>
                  )}

                  <div style={{ marginBottom: 10 }}>
                    <Tag
                      color="purple"
                      style={{ fontSize: 11, margin: 0, cursor: 'pointer' }}
                      onClick={() =>
                        handleJumpToPara(
                          selectedNode.first_appear_idx,
                          selectedNode.first_appear_paragraph_uuid
                        )
                      }
                    >
                      首次登场：
                      {renderParaStatusBadge(
                        selectedNode.first_appear_paragraph_uuid,
                        selectedNode.first_appear_idx
                      )}{' '}
                      🎯
                    </Tag>
                  </div>

                  <Divider style={{ margin: '8px 0', borderColor: color.borderBar }} />

                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: color.textSecondary, marginBottom: 4 }}>
                      🌐 全局精炼 Profile (上限 100 字):
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: color.textPrimary,
                        lineHeight: 1.5,
                        background: color.bgPage,
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: `1px dashed ${color.borderBar}`,
                      }}
                    >
                      {selectedNode.description || '暂无精炼 Profile 概括。'}
                    </div>
                  </div>
                </Card>

                {/* 关系清单：焦点角色的直接关系 */}
                <Card
                  size="small"
                  title={
                    <span style={{ fontSize: 13, fontWeight: 600, color: color.textPrimary }}>
                      <TeamOutlined style={{ marginRight: 6, color: color.primary }} />
                      关系清单 ({selectedNodeEdges.length})
                    </span>
                  }
                  style={{
                    background: color.bgCard,
                    borderColor: color.borderBar,
                    borderRadius: 8,
                  }}
                  bodyStyle={{ maxHeight: 180, overflowY: 'auto', padding: 10 }}
                >
                  {selectedNodeEdges.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无直接关系" style={{ margin: '8px 0' }} />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {selectedNodeEdges.map((e) => {
                        const otherName =
                          e.from_char_id === selectedNodeId ? e.to_name : e.from_name
                        const cat = e.category || 'neutral'
                        return (
                          <div
                            key={e.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              fontSize: 12,
                              background: color.bgPage,
                              border: `1px solid ${color.borderBar}`,
                              borderRadius: 6,
                              padding: '5px 8px',
                            }}
                          >
                            <span
                              style={{ cursor: 'pointer', color: color.textPrimary, fontWeight: 500 }}
                              onClick={() => handleFocusCharacter(e.from_char_id === selectedNodeId ? e.to_char_id : e.from_char_id)}
                            >
                              {otherName || '?'}
                            </span>
                            <Tag color={CATEGORY_COLORS[cat]} style={{ margin: '0 auto', fontSize: 10 }}>
                              {CATEGORY_LABELS[cat] || e.relation_type}
                            </Tag>
                            <Tag
                              color="default"
                              style={{ margin: 0, fontSize: 10, cursor: 'pointer' }}
                              onClick={() => handleJumpToPara(e.paragraph_idx, e.paragraph_uuid)}
                            >
                              {renderParaStatusBadge(e.paragraph_uuid, e.paragraph_idx)} 🎯
                            </Tag>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </Card>

                {/* 2. 下段：按段落时序罗列的 delta_summary 重点变化履历链 */}
                <Card
                  size="small"
                  title={
                    <span style={{ fontSize: 13, fontWeight: 600, color: color.textPrimary }}>
                      <ClockCircleOutlined style={{ marginRight: 6, color: color.primary }} />
                      重点变化演进履历链 ({selectedNode.history ? selectedNode.history.length : 0})
                    </span>
                  }
                  style={{
                    background: color.bgCard,
                    borderColor: color.borderBar,
                    borderRadius: 8,
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                  bodyStyle={{
                    maxHeight: 220,
                    overflowY: 'auto',
                    padding: 10,
                  }}
                >
                  {!selectedNode.history || selectedNode.history.length === 0 ? (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="当前进度下尚无身份/阵营/关系的重点变化履历"
                      style={{ margin: '16px 0' }}
                    />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {selectedNode.history.map((h, idx) => (
                        <div
                          key={h.id || idx}
                          style={{
                            background: color.bgPage,
                            border: `1px solid ${color.borderBar}`,
                            borderRadius: 6,
                            padding: '8px 10px',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              marginBottom: 4,
                            }}
                          >
                            <Tag
                              color="blue"
                              style={{ margin: 0, fontSize: 11, cursor: 'pointer' }}
                              onClick={() => handleJumpToPara(h.paragraph_idx, h.paragraph_uuid)}
                            >
                              {renderParaStatusBadge(h.paragraph_uuid, h.paragraph_idx)} 🎯
                            </Tag>
                          </div>
                          <div style={{ fontSize: 12, color: color.textPrimary, lineHeight: 1.4 }}>
                            {h.delta_summary}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                {/* 剧情关键事件（人物之间的重要事件） */}
                <Card
                  size="small"
                  title={
                    <span style={{ fontSize: 13, fontWeight: 600, color: color.textPrimary }}>
                      📌 剧情核心关键事件 ({(graphData.plot_events || []).length})
                    </span>
                  }
                  style={{
                    background: color.bgCard,
                    borderColor: color.borderBar,
                    borderRadius: 8,
                  }}
                  bodyStyle={{ maxHeight: 220, overflowY: 'auto', padding: 10 }}
                >
                  {(graphData.plot_events || []).length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前进度下无剧情关键事件" style={{ margin: '8px 0' }} />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {(graphData.plot_events || []).map((pe) => (
                        <div
                          key={pe.id}
                          onClick={() => handleJumpToPara(pe.paragraph_idx, pe.paragraph_uuid)}
                          style={{
                            background: color.bgPage,
                            border: `1px solid ${color.borderBar}`,
                            borderRadius: 6,
                            padding: '8px 10px',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                            <Tag color="gold" style={{ margin: 0, fontSize: 11 }}>
                              {renderParaStatusBadge(pe.paragraph_uuid, pe.paragraph_idx)} 🎯
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
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </>
            ) : (
              <Empty description="请在左侧选中角色" style={{ margin: '40px 0' }} />
            )}
          </div>
        </div>
      )}

      {/* 边详情 Drawer (显示原文证据、置信度及演化阶段链) */}
      <Drawer
        title={
          selectedEdge
            ? `关系详情: ${selectedEdge.from_name} —${selectedEdge.relation_type}→ ${selectedEdge.to_name}`
            : '关系详情'
        }
        placement="right"
        open={!!selectedEdge}
        onClose={() => setSelectedEdge(null)}
        width={380}
      >
        {selectedEdge && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <Tag color={CATEGORY_COLORS[selectedEdge.category || 'neutral']}>
                {CATEGORY_LABELS[selectedEdge.category || 'neutral']}
              </Tag>
              <Tag color="cyan">累计交互强度: {selectedEdge.strength || 1}</Tag>
              {selectedEdge.suspicious && <Tag color="error">⚠️ 包含短窗口类型突变</Tag>}
            </div>

            {selectedEdge.evidence && (
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: color.textSecondary }}>
                  <FileTextOutlined style={{ marginRight: 6 }} /> 原文证据摘录 (置信度: {selectedEdge.confidence || 'medium'}):
                </div>
                <div
                  style={{
                    background: color.bgPage,
                    padding: 10,
                    borderRadius: 6,
                    border: `1px solid ${color.borderBar}`,
                    fontSize: 13,
                    fontStyle: 'italic',
                  }}
                >
                  “{selectedEdge.evidence}”
                </div>
              </div>
            )}

            {selectedEdge.description && (
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: color.textSecondary }}>
                  最新状态说明:
                </div>
                <div style={{ fontSize: 13, color: color.textPrimary }}>{selectedEdge.description}</div>
              </div>
            )}

            <div>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, color: color.textSecondary }}>
                <HistoryOutlined style={{ marginRight: 6 }} /> 关系演化阶段历史 (Stages):
              </div>
              {selectedEdge.stages && selectedEdge.stages.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {selectedEdge.stages.map((stg, sIdx) => (
                    <div
                      key={sIdx}
                      style={{
                        padding: '6px 10px',
                        background: color.bgPage,
                        borderRadius: 6,
                        fontSize: 12,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <Tag color={CATEGORY_COLORS[stg.type] || 'default'} style={{ margin: 0 }}>
                        {CATEGORY_LABELS[stg.type] || stg.type}
                      </Tag>
                      <span style={{ color: color.textTertiary }}>
                        第 {stg.from_para + 1} 段 ➔ {stg.to_para !== null && stg.to_para !== undefined ? `第 ${stg.to_para + 1} 段` : '至今'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: color.textTertiary }}>暂无阶段演化记录</div>
              )}
            </div>

            <div style={{ marginTop: 12 }}>
              <Button
                type="primary"
                block
                onClick={() => handleJumpToPara(selectedEdge.paragraph_idx, selectedEdge.paragraph_uuid)}
              >
                跳转至确立段落 ({renderParaStatusBadge(selectedEdge.paragraph_uuid, selectedEdge.paragraph_idx)})
              </Button>
            </div>
          </div>
        )}
      </Drawer>
    </Modal>
  )
}
