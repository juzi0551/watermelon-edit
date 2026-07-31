import logging
from app.core.database import get_project, get_character_graph

logger = logging.getLogger(__name__)


def build_project_context_parts(project_id: str | None = None, current_paragraph_idx: int | None = None) -> list[str]:
    """构建通用的项目上下文片段：作者设定、世界观背景、已登场人物列表 (top 20)。
    供校对与对话助手模块复用，消除代码重复。
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
        nodes = graph.get("nodes", [])
        if nodes:
            context_parts.append("\n【已登场人物与最新特征】")
            node_strs = []
            for n in nodes[:20]:
                desc_str = f"：{n['description']}" if n.get("description") else ""
                alias_str = f"（别名：{'/'.join(n['aliases'])}）" if n.get("aliases") and isinstance(n["aliases"], list) else ""
                role_str = f" [{n.get('role', '角色')}]" if n.get("role") else ""
                node_strs.append(f"• {n['name']}{alias_str}{role_str}{desc_str}")
            context_parts.append("\n".join(node_strs))
    except Exception as e:
        logger.warning(f"获取人物图谱失败 (project_id={project_id}): {e}")

    return context_parts
