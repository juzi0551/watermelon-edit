import json
import time
from json_repair import repair_json
from app.core.database import (
    get_setting, get_project, get_character_graph,
    upsert_character, insert_relationship, insert_plot_event,
    upsert_character_history_summary, insert_llm_log,
    DEFAULT_SYSTEM_PROMPT_PROOFREAD,
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


def build_proofread_system_prompt(
    selected_types: list[str],
    project_id: str | None = None,
    current_paragraph_idx: int | None = None,
    appearing_character_ids: list[str] | None = None,
    suspected_new_characters: list[dict] | None = None,
) -> str:
    """构建 system prompt：动态注入作者文风、背景设定、已知人物关系网并替换 {type_desc}。
    直接使用系统的 DEFAULT_SYSTEM_PROMPT_PROOFREAD 常量。
    """
    type_desc = "、".join(TYPE_LABELS.get(t, t) for t in selected_types)
    base_prompt = DEFAULT_SYSTEM_PROMPT_PROOFREAD.replace("{type_desc}", type_desc)

    if not project_id:
        return base_prompt

    context_parts = build_project_context_parts(
        project_id,
        current_paragraph_idx,
        appearing_character_ids=appearing_character_ids,
        suspected_new_characters=suspected_new_characters,
    )
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
    document_id: str | None = None,
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
        _extract_and_save_character_events(project_id, data, window_first_idx or 0, document_id)

    return errors, chapters, raw, token_info, True


IDENTIFIER_SYSTEM_PROMPT = """你是一名中文小说角色识别器。给定【已登记角色表】与【待校对窗口文本】，识别窗口中登场或被提及的角色。

规则：
1. 严格基于文本。角色直接出场、被称呼、以代词/回忆/间接方式提及，均视为登场。
2. 仅输出确实出现于文本中的角色；未出现的一律不得列入。
3. 若文中出现角色表中不存在的人名，记入 suspected_new_characters，必须给出 aliases（文中出现的其他称呼）与 first_appear_idx（首次出现段落索引）。
4. 识别为登场的已登记角色，输出其 [character_id: ...] 前缀中的 character_id，character_id 必须逐字复制自角色表。
5. 严禁输出任何解释、Markdown 代码块标记，只返回纯 JSON：
{
  "appearing_character_ids": ["a1b2c3d4e5f6", "..."],
  "suspected_new_characters": [{"name": "...", "aliases": ["..."], "first_appear_idx": 3}]
}"""


async def identify_window_characters(
    project_id: str,
    window_paragraphs: list[tuple],
    model_id: str | None = None,
) -> tuple[list[str] | None, list[dict] | None]:
    """Stage 0：在主校对前，识别窗口文本中登场/提及的已登记角色 character_id 列表与疑似新角色。"""
    try:
        nodes = get_character_graph(project_id).get("nodes", [])
        if not nodes:
            return None, None

        omit_aliases = len(nodes) > 200
        compact_lines = ["【已登记角色表】"]
        for n in nodes:
            cid = n.get("id", "")
            name = n.get("name", "")
            role = n.get("role", "角色")
            aliases = n.get("aliases", [])
            if not omit_aliases and aliases and isinstance(aliases, list):
                alias_str = f"（别名：{'/'.join(aliases)}）"
            else:
                alias_str = ""
            compact_lines.append(f"[character_id: {cid}] {name}{alias_str}[{role}]")

        compact_table = "\n".join(compact_lines)
        user_text = build_proofread_user_text(window_paragraphs)
        prompt = f"{compact_table}\n\n文本：\n---\n{user_text}\n---"

        eff_model = get_setting("proofread_identifier_model", "") or model_id
        t0 = time.time()
        raw, token_info = await call_llm(prompt, eff_model, tag="stage0_identifier", system_prompt=IDENTIFIER_SYSTEM_PROMPT)
        duration_ms = int((time.time() - t0) * 1000)

        data = _robust_json_load(raw)

        # 记录 Stage 0 的 LLM 日志到 DB llm_logs 表
        try:
            from app.utils.helpers import generate_id
            range_s = window_paragraphs[0][0] if window_paragraphs else 0
            range_e = window_paragraphs[-1][0] + 1 if window_paragraphs else 0
            insert_llm_log(
                id=generate_id(),
                project_id=project_id,
                doc_id=None,
                model=eff_model or "unknown",
                mode="stage0_identifier",
                range_start=range_s,
                range_end=range_e,
                prompt=prompt,
                system_prompt=IDENTIFIER_SYSTEM_PROMPT,
                selected_types="[]",
                status="ok" if data else "parse_error",
                duration_ms=duration_ms,
                error_message=None if data else "JSON 解析失败",
                response_raw=raw,
                errors_found=0,
                chapters_found=0,
                **token_info,
            )
        except Exception:
            pass

        if not data:
            return None, None

        appearing_ids = data.get("appearing_character_ids", [])
        if not isinstance(appearing_ids, list):
            appearing_ids = []

        valid_cids = {n.get("id") for n in nodes}
        filtered_ids = [str(cid) for cid in appearing_ids if cid and str(cid) in valid_cids]

        suspected_new = data.get("suspected_new_characters", [])
        if not isinstance(suspected_new, list):
            suspected_new = []
        valid_suspected = []
        for sn in suspected_new:
            if isinstance(sn, dict) and sn.get("name"):
                valid_suspected.append({
                    "name": str(sn["name"]),
                    "aliases": sn.get("aliases") if isinstance(sn.get("aliases"), list) else [],
                    "first_appear_idx": _to_int(sn.get("first_appear_idx")),
                })

        return filtered_ids, valid_suspected
    except Exception as ex:
        import logging
        logging.getLogger(__name__).warning(f"identify_window_characters 执行失败: {ex}")
        return None, None


def _extract_and_save_character_events(project_id: str, data: dict, paragraph_idx: int, document_id: str | None = None):
    """解析 LLM 响应中的 character_updates、relationship_events 与 plot_events 并自动落库（带上 paragraph_uuid）。"""
    from app.core.database import resolve_paragraph_uuid
    from app.core.quality_rules import is_blocked_name, validate_fact

    def _get_uuid(idx_val: int) -> str | None:
        if document_id:
            u = resolve_paragraph_uuid(document_id, idx_val)
            if u:
                return u
        return None

    existing_nodes = get_character_graph(project_id).get("nodes", [])
    valid_id_set = {c["id"]: c for c in existing_nodes}
    char_map = {c["name"]: c["id"] for c in existing_nodes}
    white_list = set(char_map.keys())
    alias_map = {}
    for c in existing_nodes:
        aliases = c.get("aliases")
        if isinstance(aliases, list):
            for a in aliases:
                if a:
                    alias_map[a] = c["id"]
                    white_list.add(a)

    fake_id_map: dict[str, str] = {}

    def _resolve_char_id(raw_cid: str | None, name: str | None, idx_val: int, uuid_val: str | None, aliases: list | None = None) -> str | None:
        if raw_cid and raw_cid in fake_id_map:
            return fake_id_map[raw_cid]
        if raw_cid and raw_cid in valid_id_set:
            return raw_cid
        if name and name in char_map:
            real_id = char_map[name]
            if raw_cid:
                fake_id_map[raw_cid] = real_id
            return real_id
        if name and name in alias_map:
            real_id = alias_map[name]
            if raw_cid:
                fake_id_map[raw_cid] = real_id
            return real_id

        # 若名字命中了泛称/称谓拦截，则跳过创建新角色
        if name and is_blocked_name(name, white_list):
            return None

        new_name = name or f"未知角色_{raw_cid or 'new'}"
        new_id = upsert_character(
            project_id=project_id,
            name=new_name,
            aliases=aliases,
            first_appear_idx=idx_val,
            first_appear_paragraph_uuid=uuid_val,
        )
        char_map[new_name] = new_id
        valid_id_set[new_id] = {"id": new_id, "name": new_name}
        white_list.add(new_name)
        if raw_cid:
            fake_id_map[raw_cid] = new_id
        return new_id

    char_updates = data.get("character_updates", [])
    if isinstance(char_updates, list):
        for c in char_updates:
            if isinstance(c, dict) and (c.get("character_id") or c.get("name")):
                c_idx = c.get("first_appear_idx") if isinstance(c.get("first_appear_idx"), int) else paragraph_idx
                c_uuid = c.get("paragraph_uuid") or _get_uuid(c_idx)
                role = c.get("role", "supporting")
                if role not in ("protagonist", "antagonist", "supporting", "minor"):
                    role = "supporting"

                raw_cid = str(c.get("character_id")).strip() if c.get("character_id") else None
                name = str(c.get("name")).strip() if c.get("name") else None
                aliases = c.get("aliases")

                cid = _resolve_char_id(raw_cid, name, c_idx, c_uuid, aliases)
                if not cid:
                    continue

                if name:
                    upsert_character(
                        project_id=project_id,
                        name=name,
                        aliases=aliases,
                        role=role,
                        first_appear_idx=c_idx,
                        description=c.get("description", ""),
                        first_appear_paragraph_uuid=c_uuid,
                        character_id=cid,
                    )
                delta_summary = c.get("delta_summary")
                if delta_summary:
                    upsert_character_history_summary(
                        project_id=project_id,
                        character_id=cid,
                        paragraph_idx=c_idx,
                        delta_summary=delta_summary,
                        paragraph_uuid=c_uuid,
                    )

    rel_events = data.get("relationship_events", [])
    if isinstance(rel_events, list):
        for r in rel_events:
            if isinstance(r, dict) and (r.get("from") or r.get("from_character_id")) and (r.get("to") or r.get("to_character_id")):
                r_idx = r.get("paragraph_idx") if isinstance(r.get("paragraph_idx"), int) else paragraph_idx
                r_uuid = r.get("paragraph_uuid") or _get_uuid(r_idx)

                from_raw_cid = str(r.get("from_character_id")).strip() if r.get("from_character_id") else None
                from_name = str(r.get("from")).strip() if r.get("from") else None
                from_id = _resolve_char_id(from_raw_cid, from_name, r_idx, r_uuid)

                to_raw_cid = str(r.get("to_character_id")).strip() if r.get("to_character_id") else None
                to_name = str(r.get("to")).strip() if r.get("to") else None
                to_id = _resolve_char_id(to_raw_cid, to_name, r_idx, r_uuid)

                if not from_id or not to_id:
                    continue

                raw_rel_type = r.get("type", "neutral")
                f_name_eval = from_name or (valid_id_set.get(from_id, {}).get("name") if from_id else "")
                t_name_eval = to_name or (valid_id_set.get(to_id, {}).get("name") if to_id else "")

                is_valid, norm_rel_type, _ = validate_fact(f_name_eval, t_name_eval, raw_rel_type, white_list)
                if not is_valid:
                    continue

                evidence = r.get("evidence")
                confidence = r.get("confidence", "medium")

                insert_relationship(
                    project_id=project_id,
                    from_char_id=from_id,
                    to_char_id=to_id,
                    relation_type=norm_rel_type,
                    description=r.get("description", ""),
                    paragraph_idx=r_idx,
                    paragraph_uuid=r_uuid,
                    evidence=evidence,
                    confidence=confidence,
                )

    plot_events = data.get("plot_events", [])
    if isinstance(plot_events, list):
        for pe in plot_events:
            if isinstance(pe, dict) and pe.get("title"):
                pe_idx = pe.get("paragraph_idx") if isinstance(pe.get("paragraph_idx"), int) else paragraph_idx
                pe_uuid = pe.get("paragraph_uuid") or _get_uuid(pe_idx)
                insert_plot_event(
                    project_id=project_id,
                    paragraph_idx=pe_idx,
                    title=pe["title"],
                    description=pe.get("description", ""),
                    paragraph_uuid=pe_uuid,
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
