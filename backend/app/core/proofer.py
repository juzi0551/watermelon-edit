import json
from json_repair import repair_json
from app.core.database import (
    get_setting, get_project, get_character_graph,
    upsert_character, insert_relationship, insert_plot_event,
)
from app.core.context import build_project_context_parts
from app.core.llm import call_llm

TYPE_LABELS = {
    "typo": "错别字",
    "grammar": "语法错误",
    "punctuation": "标点符号错误",
    "format": "格式不一致",
    "style": "文风与风格润色建议",
}
ALL_TYPES = list(TYPE_LABELS.keys())
_VALID_TYPES = set(ALL_TYPES)
_VALID_SEVERITY = {"high", "medium", "low"}


_FALLBACK_PROOFREAD_TEMPLATE = ""  # 由 database 模块的 DEFAULT_SYSTEM_PROMPT_PROOFREAD 兜底


def build_proofread_system_prompt(selected_types: list[str], project_id: str | None = None, current_paragraph_idx: int | None = None) -> str:
    """构建 system prompt：动态注入作者文风、背景设定、已知人物关系网并替换 {type_desc}。"""
    type_desc = "、".join(TYPE_LABELS.get(t, t) for t in selected_types)
    template = get_setting("system_prompt_proofread", _FALLBACK_PROOFREAD_TEMPLATE)
    if not template:
        template = _FALLBACK_PROOFREAD_TEMPLATE
    
    base_prompt = template.replace("{type_desc}", type_desc)
    
    if not project_id:
        return base_prompt

    context_parts = build_project_context_parts(project_id, current_paragraph_idx)
    if context_parts:
        context_str = "\n".join(context_parts) + "\n\n----------------------------------------\n"
        return context_str + base_prompt
    
    return base_prompt


def build_proofread_user_text(window_paragraphs: list[tuple]) -> str:
    """构建 user 文本部分：仅含段落文本和下标，不含指令。"""
    return "\n".join(f"[{idx}] {text}" for idx, text in window_paragraphs)


def build_proofread_prompt(window_paragraphs: list[tuple], selected_types: list[str], project_id: str | None = None) -> str:
    """兼容旧接口：返回完整的 prompt（指令 + 文本混合）。"""
    first_idx = window_paragraphs[0][0] if window_paragraphs else None
    system = build_proofread_system_prompt(selected_types, project_id, first_idx)
    text = build_proofread_user_text(window_paragraphs)
    return system + "\n\n文本：\n---\n" + text + "\n---"


async def proofread_window(
    prompt: str,
    model_id: str,
    selected_types: list[str] | None = None,
    tag: str = "",
    system_prompt: str | None = None,
    project_id: str | None = None,
    window_first_idx: int | None = None,
) -> tuple[list[dict], list[dict], str | None, dict, bool]:
    """对一个窗口（W 段）调用 LLM 校对，自动注入 Context 并动态解析落库角色演进与剧情关键事件。"""
    if selected_types is None:
        selected_types = ALL_TYPES
    
    if system_prompt is None:
        system_prompt = build_proofread_system_prompt(selected_types, project_id, window_first_idx)

    raw, token_info = await call_llm(prompt, model_id, tag=tag, system_prompt=system_prompt)
    data = _robust_json_load(raw)
    if data is None:
        return [], [], raw, token_info, False
    
    chapters = _normalize_chapters(data.get("chapters", []))
    errors = _normalize_errors(data.get("errors", []), set(selected_types))

    # 动态解析并落库新登场人物、演进关系与剧情关键事件
    if project_id and data:
        _extract_and_save_character_events(project_id, data, window_first_idx or 0)

    return errors, chapters, raw, token_info, True


def _extract_and_save_character_events(project_id: str, data: dict, paragraph_idx: int):
    """解析 LLM 响应中的 character_updates、relationship_events 与 plot_events 并自动落库。"""
    char_updates = data.get("character_updates", [])
    if isinstance(char_updates, list):
        for c in char_updates:
            if isinstance(c, dict) and c.get("name"):
                c_idx = c.get("first_appear_idx") if isinstance(c.get("first_appear_idx"), int) else paragraph_idx
                upsert_character(
                    project_id=project_id,
                    name=c["name"],
                    aliases=c.get("aliases"),
                    role=c.get("role", "supporting"),
                    first_appear_idx=c_idx,
                    description=c.get("description", ""),
                )

    rel_events = data.get("relationship_events", [])
    if isinstance(rel_events, list):
        char_map = {c["name"]: c["id"] for c in get_character_graph(project_id).get("nodes", [])}
        for r in rel_events:
            if isinstance(r, dict) and r.get("from") and r.get("to"):
                r_idx = r.get("paragraph_idx") if isinstance(r.get("paragraph_idx"), int) else paragraph_idx
                from_id = char_map.get(r["from"]) or upsert_character(project_id, r["from"], first_appear_idx=r_idx)
                to_id = char_map.get(r["to"]) or upsert_character(project_id, r["to"], first_appear_idx=r_idx)
                insert_relationship(
                    project_id=project_id,
                    from_char_id=from_id,
                    to_char_id=to_id,
                    relation_type=r.get("type", "neutral"),
                    description=r.get("description", ""),
                    paragraph_idx=r_idx,
                )

    plot_events = data.get("plot_events", [])
    if isinstance(plot_events, list):
        for pe in plot_events:
            if isinstance(pe, dict) and pe.get("title"):
                pe_idx = pe.get("paragraph_idx") if isinstance(pe.get("paragraph_idx"), int) else paragraph_idx
                insert_plot_event(
                    project_id=project_id,
                    paragraph_idx=pe_idx,
                    title=pe["title"],
                    description=pe.get("description", ""),
                )


def proofread_chapter(chapter_id: str, chapter_content: str, model_id: str) -> list[dict]:
    """旧接口兼容：对单个章节文本校对（Stage5 重写 proofread 路由后删除）。"""
    paras = [(i, ln.strip()) for i, ln in enumerate(chapter_content.split("\n")) if ln.strip()]
    prompt = build_proofread_prompt(paras, ALL_TYPES)
    errors, _, _, _, _ = proofread_window(prompt, model_id, ALL_TYPES)
    for e in errors:
        e["chapter_id"] = chapter_id
    return errors


def _robust_json_load(raw: str | None) -> dict | None:
    if not raw:
        return None
    try:
        # repair_json 会自动剥离 Markdown 围栏 (```json)，定位 json 主体，
        # 并自动补全缺失括号、转义非法双引号，输出标准合法的 JSON 字符串
        repaired = repair_json(raw.strip())
        if not repaired:
            return None
        data = json.loads(repaired)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _to_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _normalize_chapters(raw_list: list) -> list[dict]:
    out = []
    for ch in raw_list:
        if not isinstance(ch, dict):
            continue
        tip = _to_int(ch.get("title_paragraph_idx"))
        if tip is None:
            continue
        level = 2 if _to_int(ch.get("level", 1)) == 2 else 1
        out.append({
            "level": level,
            "title": ch.get("title"),
            "title_paragraph_idx": tip,
            "parent_idx": _to_int(ch.get("parent_idx")),
            "start_idx": _to_int(ch.get("start_idx")),
            "end_idx": _to_int(ch.get("end_idx")),
        })
    return out


def _normalize_errors(raw_list: list, allowed_types: set) -> list[dict]:
    out = []
    for e in raw_list:
        if not isinstance(e, dict):
            continue
        t = e.get("type", "typo")
        if t not in _VALID_TYPES:
            t = "typo"
        if t not in allowed_types:
            continue
        sev = e.get("severity", "medium")
        if sev not in _VALID_SEVERITY:
            sev = "medium"
        idx = _to_int(e.get("paragraph_index", 0))
        if idx is None:
            continue
        # accept new (locator/replacement) and old (original_text/suggested_text) formats
        original_text = e.get("locator") or e.get("original_text") or ""
        suggested_text = e.get("replacement") or e.get("suggested_text") or ""
        out.append({
            "type": t,
            "paragraph_index": idx,
            "original_text": original_text,
            "suggested_text": suggested_text,
            "severity": sev,
            "description": e.get("description", ""),
        })
    return out
