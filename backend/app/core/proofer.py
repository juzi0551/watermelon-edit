import json
from app.core.llm import call_llm, LLMCallError

TYPE_LABELS = {
    "typo": "错别字",
    "grammar": "语法错误",
    "punctuation": "标点符号错误",
    "format": "格式不一致",
}
ALL_TYPES = list(TYPE_LABELS.keys())
_VALID_TYPES = set(ALL_TYPES)
_VALID_SEVERITY = {"high", "medium", "low"}


def build_proofread_prompt(window_paragraphs: list[tuple], selected_types: list[str]) -> str:
    """构建校对 prompt。window_paragraphs=[(global_idx, text), ...]。"""
    type_desc = "、".join(TYPE_LABELS.get(t, t) for t in selected_types)
    para_lines = "\n".join(f"[{idx}] {text}" for idx, text in window_paragraphs)
    return f"""请作为专业的小说校对编辑，检查以下文本中的错误。

只检查以下类型的错误：{type_desc}。

同时请识别本段范围内的章节结构：
- 主标题（卷/章）level=1
- 副标题（节）level=2，且必须给出 parent_idx（所属主标题的 title_paragraph_idx）
每段用 [全局段落下标] 前缀标出，你返回的 paragraph_index 与 title_paragraph_idx 必须等于这些下标。

以 JSON 格式返回：
{{
  "chapters": [
    {{"level": 1, "title": "第一章 少年初长", "title_paragraph_idx": 0, "start_idx": 0, "end_idx": 2}},
    {{"level": 2, "title": "第一节 启程", "title_paragraph_idx": 5, "parent_idx": 0, "start_idx": 3, "end_idx": 5}}
  ],
  "errors": [
    {{"type": "typo", "paragraph_index": 1, "locator": "成才", "replacement": "成材", "severity": "medium", "description": "同音错字"}}
  ]
}}

规则：
1. locator 必须直接从原文逐字复制，不得做任何修改。
2. locator 至少要包含 5 个字符（或整个出错词，取较长者），确保它在段落内唯一出现。
3. 同一段有多个错误时，各 locator 之间不能重叠互斥，彼此要保持足够间距。
4. description 用简短的诊断说明（5-10 字）。
5. 特别注意成对标点符号（如双引号“”、单引号‘’、书名号《》、括号（）等）是否成对出现、前后匹配，以及嵌套是否正确。

若某类无错误，对应数组返回空。只返回 JSON，不要其他内容。

文本：
---
{para_lines}
---"""


async def proofread_window(prompt: str, model_id: str, selected_types: list[str] | None = None, tag: str = "") -> tuple[list[dict], list[dict]]:
    """对一个窗口（W 段）调用 LLM 校对，返回 (errors, chapters)。

    errors 已按 selected_types 过滤并规范化；chapters 为本窗口识别的章节结构。
    LLM 调用或解析彻底失败时抛出 LLMCallError。
    """
    if selected_types is None:
        selected_types = ALL_TYPES
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
