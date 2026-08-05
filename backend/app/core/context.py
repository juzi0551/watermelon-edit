import logging
from app.core.database import get_project, get_character_graph

logger = logging.getLogger(__name__)


def build_project_context_parts(
    project_id: str | None = None,
    current_paragraph_idx: int | None = None,
    appearing_character_ids: list[str] | None = None,
    suspected_new_characters: list[dict] | None = None,
) -> list[str]:
    """构建通用的项目上下文片段：作者设定、世界观背景、已登场人物列表（带 character_id 格式化）及疑新角色。
    供校对与对话助手模块复用。
    """
    if not project_id:
        return []

    context_parts = []
    project = get_project(project_id)
    if project:
        author = project.get("author_name") or ""
        intro = project.get("author_intro") or ""
        bg = project.get("background_setting") or ""
        if author or intro or bg:
            context_parts.append("【作者设定与世界观背景】")
            if author:
                context_parts.append(f"作者：{author}")
            if intro:
                context_parts.append(f"文风偏好：{intro}")
            if bg:
                context_parts.append(f"背景设定：{bg}")

    try:
        graph = get_character_graph(project_id, current_paragraph_idx)
        all_nodes = graph.get("nodes", [])
        if all_nodes:
            target_nodes = []
            if appearing_character_ids:
                id_set = set(appearing_character_ids)
                target_nodes = [n for n in all_nodes if n.get("id") in id_set]

            if not target_nodes:
                target_nodes = all_nodes[:20]

            if target_nodes:
                context_parts.append("\n【已登记人物画像】")
                node_strs = []
                for n in target_nodes:
                    cid = n.get("id", "")
                    desc = n.get("description") or ""
                    if len(desc) > 100:
                        desc = desc[:100] + "..."
                    desc_str = f" 全局画像：{desc}" if desc else ""
                    alias_str = (
                        f"（别名：{'/'.join(n['aliases'])}）"
                        if n.get("aliases") and isinstance(n["aliases"], list)
                        else ""
                    )
                    role_str = f" [{n.get('role', '角色')}]" if n.get("role") else ""

                    # 挂载近期履历 (最多 2 条)
                    histories = n.get("history", [])
                    recent_hist = histories[-2:] if histories else []
                    hist_str = ""
                    if recent_hist:
                        h_items = [f"段{h.get('paragraph_idx')}: {h.get('delta_summary')}" for h in recent_hist if h.get("delta_summary")]
                        if h_items:
                            hist_str = f" 近期履历：[{'; '.join(h_items)}]"

                    node_strs.append(f"• [character_id: {cid}] {n['name']}{alias_str}{role_str}{desc_str}{hist_str}")
                context_parts.append("\n".join(node_strs))

            # 注入【现有关系摘要】（两端点均在当前显示/登场节点中的边）
            target_ids = {n["id"] for n in target_nodes}
            projected_edges = graph.get("edges", [])
            rel_summary_lines = []
            for e in projected_edges:
                u, v = e.get("from_char_id"), e.get("to_char_id")
                if u in target_ids and v in target_ids:
                    f_name = e.get("from_name") or u
                    t_name = e.get("to_name") or v
                    r_type = e.get("relation_type", "friend")
                    est = e.get("established_at")
                    est_str = f"（确立于第 {est} 段）" if est is not None else ""
                    rel_summary_lines.append(f"• {f_name} —{r_type}→ {t_name}{est_str}")

            if rel_summary_lines:
                context_parts.append("\n【现有关系摘要】（已登场角色）")
                context_parts.append("\n".join(rel_summary_lines[:20]))

        if suspected_new_characters:
            context_parts.append("\n【本段怀疑新出现角色】")
            new_strs = []
            for sc in suspected_new_characters:
                s_name = sc.get("name", "")
                aliases = sc.get("aliases", [])
                alias_str = f"（别名：{'/'.join(aliases)}）" if aliases and isinstance(aliases, list) else "（未提别名）"
                new_strs.append(f"• {s_name}{alias_str}")
            context_parts.append("\n".join(new_strs))
    except Exception as e:
        logger.warning(f"获取人物图谱失败 (project_id={project_id}): {e}")

    return context_parts
