import json
from app.core.llm import call_llm, LLMCallError
from app.core.database import get_setting

TYPE_LABELS = {
    "typo": "错别字",
    "grammar": "语法错误",
    "punctuation": "标点符号错误",
    "format": "格式不一致",
}
ALL_TYPES = list(TYPE_LABELS.keys())
_VALID_TYPES = set(ALL_TYPES)
_VALID_SEVERITY = {"high", "medium", "low"}


_FALLBACK_PROOFREAD_TEMPLATE = ""  # 由 database 模块的 DEFAULT_SYSTEM_PROMPT_PROOFREAD 兜底


def build_proofread_system_prompt(selected_types: list[str]) -> str:
    """构建 system prompt：从数据库加载模板，替换 {type_desc}。"""
    type_desc = "、".join(TYPE_LABELS.get(t, t) for t in selected_types)
    template = get_setting("system_prompt_proofread", _FALLBACK_PROOFREAD_TEMPLATE)
    if not template:
        template = _FALLBACK_PROOFREAD_TEMPLATE
    return template.replace("{type_desc}", type_desc)


def build_proofread_user_text(window_paragraphs: list[tuple]) -> str:
    """构建 user 文本部分：仅含段落文本和下标，不含指令。"""
    return "\n".join(f"[{idx}] {text}" for idx, text in window_paragraphs)


def build_proofread_prompt(window_paragraphs: list[tuple], selected_types: list[str]) -> str:
    """兼容旧接口：返回完整的 prompt（指令 + 文本混合）。
    新代码请使用 build_proofread_system_prompt + build_proofread_user_text。"""
    system = build_proofread_system_prompt(selected_types)
    text = build_proofread_user_text(window_paragraphs)
    return system + "\n\n文本：\n---\n" + text + "\n---"


async def proofread_window(prompt: str, model_id: str, selected_types: list[str] | None = None, tag: str = "", system_prompt: str | None = None) -> tuple[list[dict], list[dict]]:
    """对一个窗口（W 段）调用 LLM 校对，返回 (errors, chapters)。

    errors 已按 selected_types 过滤并规范化；chapters 为本窗口识别的章节结构。
    LLM 调用或解析彻底失败时抛出 LLMCallError。

    建议传 system_prompt + prompt（纯文本），此时 prompt 作为 user 消息。
    不传 system_prompt 时兼容旧模式：prompt 为完整 prompt（指令+文本混合）。
    """
    if selected_types is None:
        selected_types = ALL_TYPES
    if system_prompt is not None:
        raw = await call_llm(prompt, model_id, tag=tag, system_prompt=system_prompt)
    else:
        raw = await call_llm(prompt, model_id, tag=tag)
    data = _robust_json_load(raw)
    if data is None:
        raise LLMCallError("大模型返回的 JSON 无法解析（可能截断或格式错误）")
    chapters = _normalize_chapters(data.get("chapters", []))
    errors = _normalize_errors(data.get("errors", []), set(selected_types))
    return errors, chapters


def proofread_chapter(chapter_id: str, chapter_content: str, model_id: str) -> list[dict]:
    """旧接口兼容：对单个章节文本校对（Stage5 重写 proofread 路由后删除）。"""
    paras = [(i, ln.strip()) for i, ln in enumerate(chapter_content.split("\n")) if ln.strip()]
    prompt = build_proofread_prompt(paras, ALL_TYPES)
    errors, _ = proofread_window(prompt, model_id, ALL_TYPES)
    for e in errors:
        e["chapter_id"] = chapter_id
    return errors


def _robust_json_load(raw: str | None) -> dict | None:
    if not raw:
        return None
    s = raw.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s
        if s.rstrip().endswith("```"):
            s = s.rstrip()[:-3]
        s = s.strip()
    start = s.find("{")
    if start == -1:
        return None
    depth = 0
    end = -1
    for i in range(start, len(s)):
        if s[i] == "{":
            depth += 1
        elif s[i] == "}":
            depth -= 1
            if depth == 0:
                end = i
                break
    if end == -1:
        return None
    try:
        return json.loads(s[start:end + 1])
    except json.JSONDecodeError:
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
