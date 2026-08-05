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
import { lightColors, darkColors } from '../design-tokens'
import { useParagraphStatus } from '../hooks/useParagraphStatus'

const ROLE_COLORS = {
  protagonist: 'gold',
  supporting: 'blue',
  antagonist: 'red',
  minor: 'default',
}

const ROLE_FILLS = {
  protagonist: '#f5b50a',
  supporting: '#4a8fe0',
  antagonist: '#e05252',
  minor: '#9aa5b1',
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
  '#1890ff',
  '#52c41a',
  '#fa8c16',
  '#722ed1',
  '#eb2f96',
  '#13c2c2',
  '#faad14',
  '#2f54eb',
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

function computeSmartSeed(nodes, edges) {
  const pos = {}
  const adj = {}
  ;(edges || []).forEach((e) => {
    const s = typeof e.source === 'object' ? e.source.id : (e.source ?? e.from_char_id)
    const t = typeof e.target === 'object' ? e.target.id : (e.target ?? e.to_char_id)
    if (s === undefined || t === undefined || s === null || t === null) return
    ;(adj[s] = adj[s] || new Set()).add(t)
    ;(adj[t] = adj[t] || new Set()).add(s)
  })
  const degreeOf = (id) => (adj[id] ? adj[id].size : 0)
  const R = 200

  const core = nodes.filter((n) => degreeOf(n.id) > 1)
  core.sort((a, b) => degreeOf(b.id) - degreeOf(a.id))
  core.forEach((n, i) => {
    const angle = (i / Math.max(core.length, 1)) * Math.PI * 2
    pos[n.id] = { x: Math.cos(angle) * R, y: Math.sin(angle) * R }
  })

  const leaves = nodes.filter((n) => degreeOf(n.id) <= 1)
  leaves.forEach((n) => {
    const parentId = adj[n.id] && [...adj[n.id]][0]
    const parent = parentId ? pos[parentId] : null
    if (!parent) return
    let cx = 0, cy = 0, cnt = 0
    ;(adj[parentId] || []).forEach((nb) => {
      if (nb === n.id) return
      const p = pos[nb]
      if (p) { cx += p.x; cy += p.y; cnt++ }
    })
    if (cnt) { cx /= cnt; cy /= cnt }
    let dx = parent.x - cx, dy = parent.y - cy
    let len = Math.hypot(dx, dy)
    if (len < 1e-6) { const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); len = 1 }
    pos[n.id] = { x: parent.x + (dx / len) * 85, y: parent.y + (dy / len) * 85 }
  })

  nodes.forEach((n) => {
    if (!pos[n.id]) pos[n.id] = { x: (Math.random() - 0.5) * 400, y: (Math.random() - 0.5) * 300 }
  })
  return pos
}

export default function CharacterGraph({
  open,
  onClose,
  projectId,
  totalParagraphs = 100,
  onScrollToParagraph,
}) {
  const { isDark } = useTheme()
  const gc = isDark ? darkColors : lightColors

  const [loading, setLoading] = useState(false)
  const [graphData, setGraphData] = useState({ nodes: [], edges: [], plot_events: [] })
  const [currentParaIdx, setCurrentParaIdx] = useState(totalParagraphs)

  const [dictExpired, setDictExpired] = useState(false)
  const [rescanning, setRescanning] = useState(false)

  const [selectedCategories, setSelectedCategories] = useState(['family', 'intimate', 'hostile', 'social', 'neutral', 'hierarchical'])
  const [minStrength, setMinStrength] = useState(1)

  const [sourceId, setSourceId] = useState(null)
  const [targetId, setTargetId] = useState(null)
  const [pathLoading, setPathLoading] = useState(false)
  const [highlightedPath, setHighlightedPath] = useState(null)

  const [selectedNodeId, setSelectedNodeId] = useState(null)
  const [selectedEdge, setSelectedEdge] = useState(null)

  const [charSearch, setCharSearch] = useState('')

  const containerRef = useRef(null)
  const graphInstanceRef = useRef(null)
  const highlightedPathRef = useRef(null)
  useEffect(() => {
    highlightedPathRef.current = highlightedPath
  }, [highlightedPath])

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

  const selectedNodeEdges = useMemo(() => {
    if (!selectedNodeId || !graphData.edges) return []
    return graphData.edges.filter(
      (e) => e.from_char_id === selectedNodeId || e.to_char_id === selectedNodeId
    )
  }, [graphData.edges, selectedNodeId])

  const filteredEdges = useMemo(() => {
    const rawEdges = graphData.edges || []
    return rawEdges.filter((e) => {
      const cat = e.category || 'neutral'
      const matchCat = selectedCategories.includes(cat)
      const matchStr = (e.strength || 1) >= minStrength
      return matchCat && matchStr
    })
  }, [graphData.edges, selectedCategories, minStrength])

  const listNodes = useMemo(() => {
    const rawNodes = graphData.nodes || []
    if (!charSearch.trim()) return rawNodes
    const q = charSearch.trim().toLowerCase()
    return rawNodes.filter((n) => {
      const matchName = n.name && n.name.toLowerCase().includes(q)
      const matchAlias = n.aliases && n.aliases.some((a) => a && a.toLowerCase().includes(q))
      return matchName || matchAlias
    })
  }, [graphData.nodes, charSearch])

  // 将当前焦点角色及其所有的变化履历链与剧情关键事件，按段落索引转为横向时间线节点数组
  const timelineData = useMemo(() => {
    const paraMap = new Map()

    // 1. 焦点角色的历史变化履历 (delta_summary)
    if (selectedNode && selectedNode.history && selectedNode.history.length > 0) {
      selectedNode.history.forEach((h) => {
        const pIdx = h.paragraph_idx ?? 0
        if (!paraMap.has(pIdx)) {
          paraMap.set(pIdx, { paragraph_idx: pIdx, paragraph_uuid: h.paragraph_uuid, deltas: [], plot_events: [] })
        }
        paraMap.get(pIdx).deltas.push(h.delta_summary)
      })
    }

    // 2. 剧情关键事件 (plot_events)
    if (graphData.plot_events && graphData.plot_events.length > 0) {
      graphData.plot_events.forEach((pe) => {
        const pIdx = pe.paragraph_idx ?? 0
        if (!paraMap.has(pIdx)) {
          paraMap.set(pIdx, { paragraph_idx: pIdx, paragraph_uuid: pe.paragraph_uuid, deltas: [], plot_events: [] })
        }
        paraMap.get(pIdx).plot_events.push(pe)
      })
    }

    const sortedParas = Array.from(paraMap.values()).sort((a, b) => a.paragraph_idx - b.paragraph_idx)
    return sortedParas
  }, [selectedNode, graphData.plot_events])

  const formattedG6Data = useMemo(() => {
    const nodes = (graphData.nodes || []).map((n) => {
      const centrality = n.centrality || 0
      const degree = n.degree || 0
      const nodeSize = Math.min(52, Math.max(26, Math.round(26 + centrality * 30 + Math.min(degree, 10) * 1.2)))
      const isUngrounded = !!n.ungrounded

      return {
        id: n.id,
        name: n.name,
        role: n.role,
        centrality: n.centrality,
        degree: n.degree,
        community_id: n.community_id,
        description: n.description,
        aliases: n.aliases,
        history: n.history || [],
        ungrounded: isUngrounded,
        first_appear_idx: n.first_appear_idx,
        first_appear_paragraph_uuid: n.first_appear_paragraph_uuid,
        style: {
          size: nodeSize,
          fill: isUngrounded ? '#e2e8f0' : ROLE_FILLS[n.role] || ROLE_FILLS.minor,
          stroke: isUngrounded ? '#94a3b8' : ROLE_STROKES[n.role] || ROLE_STROKES.minor,
          lineDash: isUngrounded ? [4, 4] : undefined,
          lineWidth: 2.5,
          labelText: n.name + (isUngrounded ? ' (未检索)' : ''),
          labelFill: isUngrounded ? '#64748b' : gc.textPrimary,
          labelFontSize: 12,
          labelPlacement: 'bottom',
        },
      }
    })

    const seedPos = computeSmartSeed(nodes, filteredEdges)
    nodes.forEach((n) => {
      if (seedPos[n.id]) {
        n.x = seedPos[n.id].x
        n.y = seedPos[n.id].y
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
          lineWidth: Math.min(6, Math.max(1.5, Math.round(1.5 + Math.log2(e.strength || 1)))),
          endArrow: false,
          labelText: (e.suspicious ? '⚠️ ' : '') + labelText,
          labelFill: gc.textSecondary,
          labelFontSize: 11,
          labelBackground: true,
          labelBackgroundFill: gc.bgCard,
          labelBackgroundPadding: [2, 4],
          labelBackgroundRadius: 4,
        },
      }
    })

    return { nodes, edges }
  }, [graphData.nodes, filteredEdges, gc])

  const applyFocusHighlight = useCallback(
    (focusId) => {
      const graph = graphInstanceRef.current
      if (!graph || !formattedG6Data.nodes.length) return

      const connectedEdgeIds = new Set()
      const neighborNodeIds = new Set([focusId])

      formattedG6Data.edges.forEach((edge) => {
        if (edge.source === focusId || edge.target === focusId) {
          connectedEdgeIds.add(edge.id)
          neighborNodeIds.add(edge.source)
          neighborNodeIds.add(edge.target)
        }
      })

      const stateUpdates = {}
      formattedG6Data.nodes.forEach((n) => {
        if (n.id === focusId) {
          stateUpdates[n.id] = 'selected'
        } else if (neighborNodeIds.has(n.id)) {
          stateUpdates[n.id] = 'neighbor'
        } else {
          stateUpdates[n.id] = []
        }
      })
      formattedG6Data.edges.forEach((ed) => {
        stateUpdates[ed.id] = connectedEdgeIds.has(ed.id) ? 'highlight' : []
      })

      graph.setElementState(stateUpdates)
    },
    [formattedG6Data]
  )

  const handleFocusCharacter = (nodeId) => {
    setSelectedNodeId(nodeId)
    if (!highlightedPathRef.current) {
      applyFocusHighlight(nodeId)
    }
  }

  useEffect(() => {
    if (!open || loading || !containerRef.current || formattedG6Data.nodes.length === 0) return

    const width = containerRef.current.clientWidth || 1000
    const height = containerRef.current.clientHeight || 480

    if (graphInstanceRef.current) {
      try {
        graphInstanceRef.current.destroy()
      } catch (e) {
        // ignore
      }
      graphInstanceRef.current = null
    }

    const nodeCount = formattedG6Data.nodes.length
    const chargeStrength = Math.max(-300, -120 - nodeCount * 5)
    const linkDist = Math.min(180, Math.max(90, 100 + nodeCount * 1.5))

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
          fill: (d) => d.style?.fill || '#1890ff',
          stroke: (d) => d.style?.stroke || '#1890ff',
          lineDash: (d) => d.style?.lineDash,
          lineWidth: 2.5,
          labelText: (d) => d.style?.labelText || d.name || d.id,
          labelFill: (d) => d.style?.labelFill || gc.textPrimary,
          labelFontSize: 12,
          labelPlacement: 'bottom',
        },
        state: {
          highlight: {
            lineWidth: 6,
            stroke: '#faad14',
            fill: '#fffbe6',
            opacity: 1,
          },
          selected: {
            lineWidth: 5,
            stroke: '#faad14',
            fill: '#fff1c0',
            opacity: 1,
          },
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
          labelFill: gc.textSecondary,
          labelFontSize: 11,
          labelBackground: true,
          labelBackgroundFill: gc.bgCard,
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

    graph.on(NodeEvent.CLICK, (e) => {
      const clickedId = e.target?.id || e.target?.data?.id
      if (clickedId) {
        setSelectedNodeId(clickedId)
        applyFocusHighlight(clickedId)

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

    graph.on('edge:click', (e) => {
      const clickedEdgeId = e.target?.id || e.target?.data?.id
      const foundEdge = filteredEdges.find((ed) => ed.id === clickedEdgeId)
      if (foundEdge) {
        setSelectedEdge(foundEdge)
      }
    })

    graph.on(CanvasEvent.CLICK, () => {
      if (!highlightedPathRef.current) {
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
  }, [open, loading, formattedG6Data])

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
          <TeamOutlined style={{ color: gc.primary }} />
          <span>全书角色关系图谱 & 物理拓扑演进网络</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={1600}
      zIndex={1100}
      footer={null}
      destroyOnHidden
      styles={{
        content: {
          background: gc.bgPage,
          color: gc.textPrimary,
          padding: 20,
          borderRadius: 12,
        },
        header: {
          background: 'transparent',
          color: gc.textPrimary,
          marginBottom: 10,
        },
      }}
    >
      {/* 词典过期提示 */}
      {dictExpired && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 10,
            fontSize: 12,
            color: gc.textSecondary,
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

      {/* 1. 顶部时间轴拉条控制 */}
      <Card
        size="small"
        style={{
          background: gc.bgCard,
          borderColor: gc.borderBar,
          marginBottom: 12,
          borderRadius: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: gc.textPrimary }}>
            <HistoryOutlined style={{ marginRight: 6, color: gc.primary }} />
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

      {/* 2. 中部：左侧角色列表 + 右侧(上方对半 Profile&关系 + 下方横向时间线) */}
      {loading ? (
        <Spin size="large" style={{ display: 'block', margin: '60px auto' }} />
      ) : graphData.nodes.length === 0 ? (
        <Empty
          description="暂无人物关系与剧情事件数据。发起随文校对后，大模型将自动萃取全书角色、拓扑关系与重点演进履历。"
          style={{ margin: '60px 0' }}
        />
      ) : (
        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          {/* 左侧：角色列表 */}
          <div style={{ width: 220, display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
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
                height: 480,
                overflowY: 'auto',
                background: gc.bgCard,
                border: `1px solid ${gc.borderBar}`,
                borderRadius: 8,
                padding: 4,
              }}
            >
              {listNodes.length === 0 ? (
                <div style={{ fontSize: 12, color: gc.textTertiary, padding: '16px 8px', textAlign: 'center' }}>
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
                        background: isSelected ? gc.bgHighlight : 'transparent',
                        fontWeight: isSelected ? 600 : 400,
                        color: gc.textPrimary,
                        marginBottom: 2,
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
                      <span style={{ fontSize: 11, color: gc.textTertiary, flexShrink: 0 }}>
                        {n.degree || 0}
                      </span>
                    </div>
                  )
                })
              )}
            </div>
            <div style={{ fontSize: 11, color: gc.textTertiary, textAlign: 'center' }}>
              共 {graphData.nodes.length} 个角色 · 数字为关联边数
            </div>
          </div>

          {/* 列表右侧大区域：上方 50%/50% 详情与关系 + 下方横向演进时间线 */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* 上方：50% 角色详情 Profile | 50% 角色关系与原文证据 */}
            <div style={{ display: 'flex', gap: 12, height: 260 }}>
              {/* 左半 50%：角色详情 Profile */}
              {selectedNode ? (
                <Card
                  size="small"
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 600, fontSize: 14, color: gc.textPrimary }}>
                        <UserOutlined style={{ marginRight: 6, color: gc.primary }} />
                        {selectedNode.name}
                      </span>
                      <Tag color={ROLE_COLORS[selectedNode.role] || 'default'} style={{ margin: 0 }}>
                        {ROLE_LABELS[selectedNode.role] || '角色'}
                      </Tag>
                    </div>
                  }
                  style={{ flex: 1, background: gc.bgCard, borderColor: gc.borderBar, borderRadius: 8 }}
                  bodyStyle={{ height: 215, overflowY: 'auto', padding: 10 }}
                >
                  {selectedNode.ungrounded && (
                    <Alert type="info" showIcon message="原文未检索到该角色" description="主名与别名均未在正文检索到，可能为模型推理补全。" style={{ marginBottom: 8, padding: '4px 8px' }} />
                  )}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                    <Tag color={COMMUNITY_COLORS[(selectedNode.community_id !== undefined ? selectedNode.community_id : 0) % COMMUNITY_COLORS.length]} style={{ fontSize: 11, margin: 0 }}>
                      阵营/社区 #{selectedNode.community_id ?? 0}
                    </Tag>
                    <Tag color="cyan" style={{ fontSize: 11, margin: 0 }}>介数中心度: {selectedNode.centrality || 0}</Tag>
                    <Tag color="blue" style={{ fontSize: 11, margin: 0 }}>关联度: {selectedNode.degree || 0} 边</Tag>
                  </div>
                  {selectedNode.aliases && selectedNode.aliases.length > 0 && (
                    <div style={{ fontSize: 12, color: gc.textTertiary, marginBottom: 6 }}>别名：{selectedNode.aliases.join(' / ')}</div>
                  )}
                  <div style={{ marginBottom: 8 }}>
                    <Tag color="purple" style={{ fontSize: 11, margin: 0, cursor: 'pointer' }} onClick={() => handleJumpToPara(selectedNode.first_appear_idx, selectedNode.first_appear_paragraph_uuid)}>
                      首次登场：{renderParaStatusBadge(selectedNode.first_appear_paragraph_uuid, selectedNode.first_appear_idx)} 🎯
                    </Tag>
                  </div>
                  <Divider style={{ margin: '6px 0', borderColor: gc.borderBar }} />
                  <div style={{ fontSize: 12, fontWeight: 600, color: gc.textSecondary, marginBottom: 4 }}>🌐 全局精炼 Profile (核心定位):</div>
                  <div style={{ fontSize: 13, color: gc.textPrimary, lineHeight: 1.5, background: gc.bgPage, padding: '8px 10px', borderRadius: 6, border: `1px dashed ${gc.borderBar}` }}>
                    {selectedNode.description || '暂无精炼 Profile 概括。'}
                  </div>
                </Card>
              ) : (
                <Card size="small" style={{ flex: 1, background: gc.bgCard, borderColor: gc.borderBar, borderRadius: 8 }}>
                  <Empty description="请在左侧选中角色" style={{ margin: '40px 0' }} />
                </Card>
              )}

              {/* 右半 50%：角色关系与原文证据 */}
              <Card
                size="small"
                title={
                  <span style={{ fontSize: 13, fontWeight: 600, color: gc.textPrimary }}>
                    <TeamOutlined style={{ marginRight: 6, color: gc.primary }} />
                    角色关系网与原文证据清单 ({selectedNodeEdges.length})
                  </span>
                }
                style={{ flex: 1, background: gc.bgCard, borderColor: gc.borderBar, borderRadius: 8 }}
                bodyStyle={{ height: 215, overflowY: 'auto', padding: 10 }}
              >
                {selectedNodeEdges.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无直接关系" style={{ margin: '24px 0' }} />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {selectedNodeEdges.map((e) => {
                      const otherName = e.from_char_id === selectedNodeId ? e.to_name : e.from_name
                      const cat = e.category || 'neutral'
                      return (
                        <div
                          key={e.id}
                          onClick={() => setSelectedEdge(e)}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                            fontSize: 12,
                            background: gc.bgPage,
                            border: `1px solid ${gc.borderBar}`,
                            borderRadius: 6,
                            padding: '6px 10px',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ color: gc.textPrimary, fontWeight: 600 }}>
                              与【{otherName || '?'}】
                            </span>
                            <Space size={4}>
                              <Tag color={CATEGORY_COLORS[cat]} style={{ margin: 0, fontSize: 10 }}>
                                {CATEGORY_LABELS[cat] || e.relation_type}
                              </Tag>
                              {e.suspicious && <Tag color="error" style={{ margin: 0, fontSize: 10 }}>⚠️ 突变</Tag>}
                            </Space>
                          </div>
                          {e.evidence && (
                            <div style={{ fontSize: 11, color: gc.textSecondary, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              “{e.evidence}”
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </Card>
            </div>

            {/* 下方：角色变化与剧情事件演进（按段落比例定位的横向时间线） */}
            <Card
              size="small"
              title={
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: gc.textPrimary }}>
                    <ClockCircleOutlined style={{ marginRight: 6, color: gc.primary }} />
                    角色变化与剧情事件演进时间线 (按段落比例)
                  </span>
                  <span style={{ fontSize: 11, color: gc.textTertiary }}>
                    位置 = 段落实际比例 · 悬停看详情 · 点击跳转 ➔
                  </span>
                </div>
              }
              style={{ background: gc.bgCard, borderColor: gc.borderBar, borderRadius: 8 }}
              bodyStyle={{ padding: 12 }}
            >
              {timelineData.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前进度下尚无该角色的状态变化或关键剧情事件" style={{ margin: '16px 0' }} />
              ) : (
                (() => {
                  const minP = timelineData[0].paragraph_idx
                  const maxP = timelineData[timelineData.length - 1].paragraph_idx
                  const hasDelta = timelineData.some((n) => n.deltas && n.deltas.length)
                  const hasPlot = timelineData.some((n) => n.plot_events && n.plot_events.length)

                  return (
                    <div>
                      {/* 图例 + 时间范围 */}
                      <div style={{ display: 'flex', gap: 16, marginBottom: 8, fontSize: 12, color: gc.textSecondary, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, color: gc.textPrimary }}>📌 {minP + 1} → {maxP + 1} 段</span>
                        {hasDelta && (
                          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#1890ff', marginRight: 4 }} />角色变化</span>
                        )}
                        {hasPlot && (
                          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#d48806', marginRight: 4 }} />剧情事件</span>
                        )}
                        <span style={{ color: gc.textTertiary }}>间距 = 段落实际比例 · 点击卡片跳转段落</span>
                      </div>

                      <div style={{ overflowX: 'auto' }}>
                        <div style={{ position: 'relative', paddingTop: 6 }}>
                          {/* 基线 */}
                          <div style={{ position: 'absolute', left: 0, right: 0, top: 14, height: 2, background: gc.borderBar }} />
                          {/* 按段落比例定位的列：内容直接显示 */}
                          <div style={{ display: 'flex', alignItems: 'flex-start', minWidth: 'max-content' }}>
                            {timelineData.map((node, i) => (
                              <React.Fragment key={node.paragraph_idx}>
                                {/* 段落间距 → 等比伸缩占位 */}
                                {i > 0 && (
                                  <div style={{ flex: Math.max(2, node.paragraph_idx - timelineData[i - 1].paragraph_idx), minWidth: 26, height: 4, alignSelf: 'center' }} />
                                )}
                                <div style={{ width: 210, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  {/* 时间点 + 段号 */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 18 }}>
                                    <span
                                      style={{
                                        width: 12, height: 12, borderRadius: '50%', zIndex: 1, flexShrink: 0,
                                        background: node.deltas && node.deltas.length ? '#1890ff' : '#d48806',
                                        border: `2px solid ${gc.bgCard}`, boxShadow: '0 0 4px rgba(0,0,0,0.35)',
                                      }}
                                    />
                                    <span style={{ fontSize: 11, fontWeight: 600, color: gc.textSecondary, whiteSpace: 'nowrap' }}>
                                      {renderParaStatusBadge(node.paragraph_uuid, node.paragraph_idx)}
                                    </span>
                                  </div>
                                  {/* 角色变化内容（直接显示） */}
                                  {node.deltas && node.deltas.length > 0 && (
                                    <div
                                      onClick={() => handleJumpToPara(node.paragraph_idx, node.paragraph_uuid)}
                                      style={{ background: gc.bgPage, border: `1px solid ${gc.borderBar}`, borderLeft: '3px solid #1890ff', borderRadius: 6, padding: '6px 8px', cursor: 'pointer', fontSize: 12, color: gc.textPrimary, lineHeight: 1.4 }}
                                    >
                                      {node.deltas.map((d, di) => (
                                        <div key={di}>• {d}</div>
                                      ))}
                                    </div>
                                  )}
                                  {/* 剧情事件内容（直接显示） */}
                                  {node.plot_events && node.plot_events.length > 0 && (
                                    <div
                                      onClick={() => handleJumpToPara(node.paragraph_idx, node.paragraph_uuid)}
                                      style={{ background: gc.bgPage, border: `1px solid ${gc.borderBar}`, borderLeft: '3px solid #d48806', borderRadius: 6, padding: '6px 8px', cursor: 'pointer', fontSize: 12, color: gc.textPrimary, lineHeight: 1.4 }}
                                    >
                                      {node.plot_events.map((pe) => (
                                        <div key={pe.id} style={{ marginBottom: 2 }}>
                                          <span style={{ fontWeight: 600 }}>【{pe.title}】</span>
                                          {pe.description && <span style={{ color: gc.textSecondary }}>{pe.description}</span>}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </React.Fragment>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })()
              )}
            </Card>
          </div>
        </div>
      )}

      {/* 3. 底部：拓扑关系图视窗 (通栏宽屏视图 + Dijkstra 最短路径求解) */}
      {!loading && graphData.nodes.length > 0 && (
        <Card
          size="small"
          style={{
            background: gc.bgCard,
            borderColor: gc.borderBar,
            borderRadius: 8,
          }}
        >
          {/* 分类过滤与强度降噪工具栏 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: gc.textSecondary, marginRight: 4 }}>
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
              <span style={{ fontSize: 12, color: gc.textSecondary }}>最小关联强度:</span>
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

          {/* Dijkstra 最短路径求解工具栏 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <NodeIndexOutlined style={{ color: gc.primary, fontSize: 16 }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: gc.textPrimary }}>最短关系链求解 (后端 Dijkstra):</span>
            <Select size="small" placeholder="选择起点角色" value={sourceId} onChange={setSourceId} style={{ width: 130 }} allowClear>
              {graphData.nodes.map((n) => (
                <Select.Option key={n.id} value={n.id}>{n.name}</Select.Option>
              ))}
            </Select>
            <ArrowRightOutlined style={{ color: gc.textTertiary, fontSize: 12 }} />
            <Select size="small" placeholder="选择终点角色" value={targetId} onChange={setTargetId} style={{ width: 130 }} allowClear>
              {graphData.nodes.map((n) => (
                <Select.Option key={n.id} value={n.id}>{n.name}</Select.Option>
              ))}
            </Select>
            <Button type="primary" size="small" icon={<SearchOutlined />} loading={pathLoading} onClick={handleFindShortestPath}>
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
                marginBottom: 10,
                padding: '8px 12px',
                background: gc.bgPage,
                borderRadius: 6,
                border: `1px solid ${gc.borderBar}`,
                fontSize: 12,
              }}
            >
              <div style={{ fontWeight: 600, color: gc.primary, marginBottom: 4 }}>
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
                        <span style={{ fontSize: 11, color: gc.textSecondary }}>
                          —<Tag color={CATEGORY_COLORS[cat]} style={{ margin: '0 2px', fontSize: 10 }}>{CATEGORY_LABELS[cat] || nextEdge.relation_type}</Tag>→
                        </span>
                      )}
                    </React.Fragment>
                  )
                })}
              </div>
            </div>
          )}

          {/* 通栏物理拓扑关系图画布视窗 */}
          <div
            ref={containerRef}
            style={{
              width: '100%',
              height: 480,
              background: gc.bgCard,
              borderRadius: 8,
              border: `1px solid ${gc.borderBar}`,
              position: 'relative',
              overflow: 'hidden',
            }}
          />
        </Card>
      )}

      {/* 边详情 Drawer */}
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
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: gc.textSecondary }}>
                  <FileTextOutlined style={{ marginRight: 6 }} /> 原文证据摘录 (置信度: {selectedEdge.confidence || 'medium'}):
                </div>
                <div
                  style={{
                    background: gc.bgPage,
                    padding: 10,
                    borderRadius: 6,
                    border: `1px solid ${gc.borderBar}`,
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
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: gc.textSecondary }}>
                  最新状态说明:
                </div>
                <div style={{ fontSize: 13, color: gc.textPrimary }}>{selectedEdge.description}</div>
              </div>
            )}

            <div>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, color: gc.textSecondary }}>
                <HistoryOutlined style={{ marginRight: 6 }} /> 关系演化阶段历史 (Stages):
              </div>
              {selectedEdge.stages && selectedEdge.stages.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {selectedEdge.stages.map((stg, sIdx) => (
                    <div
                      key={sIdx}
                      style={{
                        padding: '6px 10px',
                        background: gc.bgPage,
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
                      <span style={{ color: gc.textTertiary }}>
                        第 {stg.from_para + 1} 段 ➔ {stg.to_para !== null && stg.to_para !== undefined ? `第 ${stg.to_para + 1} 段` : '至今'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: gc.textTertiary }}>暂无阶段演化记录</div>
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
