"""
图算法引擎 (Graph Engine)

基于 NetworkX 与 Python-Louvain 提供：
1. 拓扑图网络计算（双权重：count 计数字数, distance = 1.0 / count 距离）
2. 逻辑删除段落过滤（JOIN paragraphs 表，排除 is_deleted = 1 的关系）
3. 介数中心度 (Betweenness Centrality) 节点半径计算
4. Louvain 社区发现 / 阵营自动分组
5. Dijkstra 最短关系路径求解 (后端计算，带快照防穿越)
6. 统一合并策略 (血亲/亲密锁定 + enemy强反转 + 频率投票 + 阶段链 stages)
7. 全量图预计算缓存与主动失效机制 (invalidate_graph_cache)
"""

import logging
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple
import networkx as nx

try:
    import community as community_louvain
except ImportError:
    community_louvain = None

from app.core.database import (
    get_conn,
    get_characters,
    get_character_history_summaries,
    get_plot_events,
)
from app.core.quality_rules import (
    normalize_relation_type,
    classify_relation_category,
    detect_relation_mutations,
)

logger = logging.getLogger(__name__)

# 全量图预计算缓存 { project_id: graph_data_dict }
_GRAPH_CACHE: dict[str, dict[str, Any]] = {}


def invalidate_graph_cache(project_id: str | None = None):
    """主动失效图算法缓存。如果指定 project_id，则清除该项目的缓存；若为 None，则清空全部缓存。"""
    global _GRAPH_CACHE
    if project_id:
        _GRAPH_CACHE.pop(project_id, None)
    else:
        _GRAPH_CACHE.clear()


def _aggregate_pair_events(evs: List[Dict]) -> Tuple[str, str, List[Dict]]:
    """
    对点对按时间序的所有事件进行折叠聚合，实现：
    - 阶段链 (stages) 生成
    - 血亲/亲密锁定策略 (含 _MIN_BLOOD_EVIDENCE = 3 及 lover 覆盖弱血亲)
    - enemy 强反转
    - 频率投票
    返回 (winning_type, category, stages)
    """
    if not evs:
        return "neutral", "neutral", []

    # 按 paragraph_idx 升序
    evs_sorted = sorted(evs, key=lambda x: (x.get("paragraph_idx", 0), x.get("created_at", "")))

    # 1. 生成阶段链 stages
    stages = []
    curr_stage = None
    for e in evs_sorted:
        raw_t = e.get("relation_type", "neutral")
        norm_t = normalize_relation_type(raw_t)
        p_idx = e.get("paragraph_idx", 0)
        if not curr_stage:
            curr_stage = {"type": norm_t, "from_para": p_idx, "to_para": p_idx}
        elif curr_stage["type"] == norm_t:
            curr_stage["to_para"] = p_idx
        else:
            stages.append(curr_stage)
            curr_stage = {"type": norm_t, "from_para": p_idx, "to_para": p_idx}
    if curr_stage:
        curr_stage["to_para"] = None  # 最新阶段为开区间，延伸至今
        stages.append(curr_stage)

    # 2. 统计频次与独立段落数
    counts = Counter()
    distinct_paras = {}
    for e in evs_sorted:
        raw_t = e.get("relation_type", "neutral")
        norm_t = normalize_relation_type(raw_t)
        counts[norm_t] += 1
        distinct_paras.setdefault(norm_t, set()).add(e.get("paragraph_idx", 0))

    family_count = counts["family"]
    lover_count = counts["lover"]
    enemy_count = counts["enemy"]
    enemy_paras = len(distinct_paras.get("enemy", set()))
    family_paras = len(distinct_paras.get("family", set()))

    latest_type = normalize_relation_type(evs_sorted[-1].get("relation_type", "neutral"))

    # ① 允许强反转 (enemy 证据充分: >=3 次或 >=3 个不同段落且最新为 enemy 或多于 family)
    if (enemy_count >= 3 or enemy_paras >= 3) and (latest_type == "enemy" or enemy_count >= family_count):
        winning_type = "enemy"
    # ② 亲密覆盖弱血亲 (lover 证据 >= family 证据 * 3)
    elif lover_count > 0 and lover_count >= family_count * 3:
        winning_type = "lover"
    # ③ 血亲锁定 (_MIN_BLOOD_EVIDENCE = 3 章/段落)
    elif family_count >= 3 or family_paras >= 3:
        winning_type = "family"
    # ④ 亲密锁定 (lover 证据 >= 2)
    elif lover_count >= 2:
        winning_type = "lover"
    # ⑤ 频率投票 (非锁定类)
    else:
        non_neutral = {k: v for k, v in counts.items() if k != "neutral"}
        if non_neutral:
            max_cnt = max(non_neutral.values())
            candidates = [k for k, v in non_neutral.items() if v == max_cnt]
            winning_type = latest_type if latest_type in candidates else candidates[0]
        else:
            winning_type = latest_type

    category = classify_relation_category(winning_type)
    return winning_type, category, stages


def get_character_graph(
    project_id: str,
    upto_paragraph_idx: int | None = None,
    upto_paragraph_uuid: str | None = None,
) -> dict:
    """获取项目的人物关系图谱网络数据（基于事件投影生成去重边，带 NetworkX 中心度、Louvain 社区分组及履历链）。"""
    # 针对全量无快照过滤的情况使用缓存
    if upto_paragraph_idx is None and upto_paragraph_uuid is None:
        if project_id in _GRAPH_CACHE:
            return _GRAPH_CACHE[project_id]

    # 解析截止段落索引 cutoff_idx
    effective_upto_idx = upto_paragraph_idx
    with get_conn() as conn:
        if upto_paragraph_uuid is not None:
            p_row = conn.execute(
                """SELECT p.idx FROM paragraphs p
                   JOIN documents d ON p.document_id = d.id
                   WHERE d.project_id = ? AND d.is_current = 1 AND p.uuid = ?""",
                (project_id, upto_paragraph_uuid),
            ).fetchone()
            if p_row:
                effective_upto_idx = p_row["idx"]

        # 获取关系边（过滤已被逻辑删除的段落关联）
        query = """SELECT r.*, f.name as from_name, t.name as to_name
                   FROM character_relationships r
                   JOIN characters f ON r.from_char_id = f.id
                   JOIN characters t ON r.to_char_id = t.id
                   LEFT JOIN documents d ON d.project_id = r.project_id AND d.is_current = 1
                   LEFT JOIN paragraphs p ON p.document_id = d.id
                     AND ( (r.paragraph_uuid IS NOT NULL AND p.uuid = r.paragraph_uuid)
                           OR (r.paragraph_uuid IS NULL AND p.idx = r.paragraph_idx) )
                   WHERE r.project_id = ?
                     AND (p.id IS NULL OR p.is_deleted IS NULL OR p.is_deleted = 0)"""
        params: list[Any] = [project_id]

        if effective_upto_idx is not None:
            query += " AND r.paragraph_idx <= ?"
            params.append(effective_upto_idx)

        query += " ORDER BY r.paragraph_idx ASC, r.created_at ASC"
        rel_rows = conn.execute(query, tuple(params)).fetchall()
        raw_events = [dict(r) for r in rel_rows]

    # 读取角色与剧情事件
    all_chars = get_characters(project_id)
    if effective_upto_idx is not None:
        chars = [c for c in all_chars if (c.get("first_appear_idx") or 0) <= effective_upto_idx]
    else:
        chars = all_chars

    char_ids = {c["id"] for c in chars}
    plot_events = get_plot_events(project_id, upto_paragraph_idx=effective_upto_idx)

    # 读取并挂载 delta_summary 履历链
    all_histories = get_character_history_summaries(
        project_id, upto_paragraph_idx=effective_upto_idx
    )
    hist_by_char: dict[str, list[dict]] = {}
    for h in all_histories:
        cid = h["character_id"]
        hist_by_char.setdefault(cid, []).append(h)

    # ── 按点对投影聚合 (Event Sourcing Projection) ─────────────────────
    pair_events: dict[tuple[str, str], list[dict]] = {}
    for e in raw_events:
        u = e.get("from_char_id")
        v = e.get("to_char_id")
        if u and v and u != v:
            pair = (min(u, v), max(u, v))
            pair_events.setdefault(pair, []).append(e)

    projected_edges: list[dict] = []
    category_counts = Counter()
    type_counts = Counter()

    for (u, v), evs in pair_events.items():
        # 按点对组内隔离执行突变检测
        evs = detect_relation_mutations(evs)
        # 快照过滤：两端点均需在当前截点登场
        if u not in char_ids or v not in char_ids:
            continue

        established_at = min(e["paragraph_idx"] for e in evs if e.get("paragraph_idx") is not None)
        if effective_upto_idx is not None and established_at > effective_upto_idx:
            continue

        last_seen = max(e["paragraph_idx"] for e in evs if e.get("paragraph_idx") is not None)
        latest_event = evs[-1]  # 取最后一条最新事件作为锚点

        winning_type, category, stages = _aggregate_pair_events(evs)
        
        category_counts[category] += 1
        type_counts[winning_type] += 1

        strength = len(evs)
        distance = round(1.0 / strength, 4)

        has_suspicious = any(e.get("suspicious") for e in evs)

        edge_dict = {
            "id": latest_event.get("id"),
            "project_id": project_id,
            "from_char_id": latest_event.get("from_char_id"),
            "to_char_id": latest_event.get("to_char_id"),
            "from_name": latest_event.get("from_name"),
            "to_name": latest_event.get("to_name"),
            "relation_type": winning_type,
            "category": category,
            "description": latest_event.get("description", ""),
            "evidence": latest_event.get("evidence"),
            "confidence": latest_event.get("confidence", "medium"),
            "paragraph_idx": latest_event.get("paragraph_idx"),
            "paragraph_uuid": latest_event.get("paragraph_uuid"),
            "established_at": established_at,
            "last_seen": last_seen,
            "strength": strength,
            "distance": distance,
            "stages": stages,
            "suspicious": has_suspicious,
        }
        projected_edges.append(edge_dict)

    # 构建 NetworkX 无向图计算 centrality, community 和 degree
    G = nx.Graph()
    for c in chars:
        G.add_node(c["id"])

    for e in projected_edges:
        u = e["from_char_id"]
        v = e["to_char_id"]
        G.add_edge(u, v, strength=e["strength"], distance=e["distance"])

    # 1. 计算 Betweenness Centrality
    if len(G) > 0 and G.number_of_edges() > 0:
        try:
            centrality_map = nx.betweenness_centrality(G, weight="distance")
        except Exception as ex:
            logger.warning(f"Betweenness Centrality 计算失败: {ex}")
            centrality_map = {node: 0.0 for node in G.nodes()}
    else:
        centrality_map = {node: 0.0 for node in G.nodes()}

    # 2. 计算 Louvain 社区发现
    community_map: dict[str, int] = {}
    if len(G) > 0 and G.number_of_edges() > 0:
        if community_louvain is not None:
            try:
                community_map = community_louvain.best_partition(G, weight="strength")
            except Exception as ex:
                logger.warning(f"Python-Louvain 计算失败: {ex}")
        else:
            try:
                communities = nx.community.louvain_communities(G, weight="strength")
                for cid, comm in enumerate(communities):
                    for node in comm:
                        community_map[node] = cid
            except Exception as ex:
                logger.warning(f"NetworkX Louvain 计算失败: {ex}")

    # 组装节点属性 (包含 degree 辅助)
    processed_nodes = []
    for c in chars:
        cid = c["id"]
        c_copy = dict(c)
        c_copy["centrality"] = round(centrality_map.get(cid, 0.0), 4)
        c_copy["community_id"] = community_map.get(cid, 0)
        c_copy["degree"] = G.degree(cid) if cid in G else 0
        c_copy["history"] = hist_by_char.get(cid, [])
        processed_nodes.append(c_copy)

    max_str = max([e["strength"] for e in projected_edges], default=1)
    suggested_min_str = 1 if max_str < 5 else max(1, int(max_str * 0.2))

    result = {
        "nodes": processed_nodes,
        "edges": projected_edges,
        "plot_events": plot_events,
        "max_strength": max_str,
        "suggested_min_strength": suggested_min_str,
        "category_counts": dict(category_counts),
        "type_counts": dict(type_counts),
    }

    # 如果是全量图查询，存入缓存
    if upto_paragraph_idx is None and upto_paragraph_uuid is None:
        _GRAPH_CACHE[project_id] = result

    return result


def find_shortest_path(
    project_id: str,
    source_char_id: str,
    target_char_id: str,
    upto_paragraph_idx: int | None = None,
    upto_paragraph_uuid: str | None = None,
) -> dict:
    """基于 Dijkstra 算法计算两角色在快照图 G_t 下的最短关系路径（直接消费投影边的 distance 权重）。"""
    graph_data = get_character_graph(
        project_id, upto_paragraph_idx=upto_paragraph_idx, upto_paragraph_uuid=upto_paragraph_uuid
    )
    nodes = graph_data.get("nodes", [])
    edges = graph_data.get("edges", [])

    node_dict = {n["id"]: n for n in nodes}
    if source_char_id not in node_dict or target_char_id not in node_dict:
        return {
            "found": False,
            "path_nodes": [],
            "path_edges": [],
            "total_distance": 0.0,
            "message": "起始角色或目标角色不存在于当前时序网络中",
        }

    if source_char_id == target_char_id:
        return {
            "found": True,
            "path_nodes": [node_dict[source_char_id]],
            "path_edges": [],
            "total_distance": 0.0,
        }

    G = nx.Graph()
    for n in nodes:
        G.add_node(n["id"])

    edge_map: dict[tuple[str, str], dict] = {}
    for e in edges:
        u = e.get("from_char_id")
        v = e.get("to_char_id")
        if u and v and u != v:
            pair = (min(u, v), max(u, v))
            edge_map[pair] = e
            dist = e.get("distance", 1.0)
            G.add_edge(u, v, distance=dist)

    try:
        path_ids = nx.dijkstra_path(G, source_char_id, target_char_id, weight="distance")
        dist_length = nx.dijkstra_path_length(G, source_char_id, target_char_id, weight="distance")

        path_nodes = [node_dict[nid] for nid in path_ids if nid in node_dict]
        path_edges = []
        for i in range(len(path_ids) - 1):
            u, v = path_ids[i], path_ids[i + 1]
            pair = (min(u, v), max(u, v))
            if pair in edge_map:
                path_edges.append(edge_map[pair])

        return {
            "found": True,
            "path_nodes": path_nodes,
            "path_edges": path_edges,
            "total_distance": round(dist_length, 4),
        }
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return {
            "found": False,
            "path_nodes": [],
            "path_edges": [],
            "total_distance": 0.0,
            "message": "两角色在当前网络中连通路径不存在",
        }
