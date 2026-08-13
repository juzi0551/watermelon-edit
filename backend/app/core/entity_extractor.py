import json
import logging
from typing import Dict, List, Tuple
from app.core.database import (
    get_conn,
    get_characters,
    upsert_character,
    insert_relationship,
    get_project,
    get_revised_paragraphs,
)
from app.core.llm import call_llm
from config import get_default_model_id
from app.core.graph_engine import invalidate_graph_cache

logger = logging.getLogger(__name__)


def get_character_aliases_map(project_id: str) -> Dict[str, str]:
    """获取项目的全量别名映射字典 { alias_name: canonical_name }"""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT canonical_name, alias_name FROM character_aliases WHERE project_id = ?",
            (project_id,),
        ).fetchall()
        alias_map = {r["alias_name"]: r["canonical_name"] for r in rows}

    # 合并 characters 表中定义的 aliases
    chars = get_characters(project_id)
    for c in chars:
        canon_name = c["name"]
        alias_map[canon_name] = canon_name
        for a in c.get("aliases", []):
            if a:
                alias_map[a] = canon_name

    return alias_map


def save_character_alias(project_id: str, canonical_name: str, alias_name: str):
    """保存或更新角色别名映射"""
    with get_conn() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO character_aliases (project_id, canonical_name, alias_name)
               VALUES (?, ?, ?)""",
            (project_id, canonical_name, alias_name),
        )


async def run_character_pipeline_async(
    project_id: str,
    from_idx: int = 0,
    to_idx: int | None = None,
    model_id: str | None = None,
) -> dict:
    """4 步自动化人物图谱提取与演进 Pipeline：
    1. 实体识别 (NER)：扫描文本中的主要登场人物与尊称别名。
    2. 消歧归一：结合别名词典与 LLM 将昵称合流至规范主名。
    3. 语义关系提取：抽取角色间动态关系类型、原文证据与置信度。
    4. 增量更新与快照归档。
    """
    proj = get_project(project_id)
    if not proj:
        return {"error": "项目不存在"}

    doc_id = proj.get("current_document_id")
    if not doc_id:
        return {"error": "项目无文档"}

    paras = get_revised_paragraphs(doc_id)
    if not paras:
        return {"extracted_characters": 0, "extracted_relationships": 0}

    target_paras = [
        p for p in paras
        if p["idx"] >= from_idx and (to_idx is None or p["idx"] <= to_idx)
    ]
    if not target_paras:
        return {"extracted_characters": 0, "extracted_relationships": 0}

    m_id = model_id or get_default_model_id()
    alias_map = get_character_aliases_map(project_id)
    existing_chars = get_characters(project_id)
    existing_names = {c["name"] for c in existing_chars}

    new_chars_count = 0
    new_rels_count = 0

    # D3: 按每 10 段分块循环处理全量段落片段
    chunk_size = 10
    for i in range(0, len(target_paras), chunk_size):
        chunk = target_paras[i:i + chunk_size]
        combined_text = ""
        for p in chunk:
            txt = p.get("revised_text") or p.get("text") or ""
            if txt.strip():
                combined_text += f"[段落{p['idx']}] {txt}\n"

        if not combined_text.strip():
            continue

        sys_prompt = "你是一位精通小说文本分析与知识图谱构建的 NLP 提取专家。"
        user_prompt = f"""请分析以下小说正文片段，提取其中登场的所有【角色人物】以及角色之间的【人物动态关系】：

【正文内容】
{combined_text}

【已知规范角色名与别名参考】
{json.dumps(alias_map, ensure_ascii=False)}

### 提取要求 (严格按纯 JSON 输出，不要包含 Markdown 标记)：
{{
  "characters": [
    {{
      "name": "规范主名(例：陆沉)",
      "aliases": ["别名或昵称(例：阿沉, 沉哥)"],
      "role": "main/supporting",
      "description": "简要人设描述"
    }}
  ],
  "relationships": [
    {{
      "from_char": "规范主名1",
      "to_char": "规范主名2",
      "relation_type": "ally/enemy/lover/family/subordinate/mentor/neutral",
      "description": "关系互动简述",
      "evidence": "原文金句证据片段",
      "confidence": "high/medium/low",
      "paragraph_idx": 0
    }}
  ]
}}"""

        try:
            raw_text, _ = await call_llm(user_prompt, model_id=m_id, tag="ner_pipeline", system_prompt=sys_prompt)
            raw_clean = raw_text.strip()
            if raw_clean.startswith("```"):
                raw_clean = raw_clean.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
            data = json.loads(raw_clean)

            # 1 & 2. 保存识别出的角色与别名
            char_name_to_id = {}
            for c in data.get("characters", []):
                canon_name = c.get("name", "").strip()
                if not canon_name:
                    continue
                aliases = [a.strip() for a in c.get("aliases", []) if a and a.strip()]
                if canon_name not in existing_names:
                    new_chars_count += 1
                    existing_names.add(canon_name)

                cid = upsert_character(
                    project_id=project_id,
                    name=canon_name,
                    aliases=aliases,
                    role=c.get("role", "supporting"),
                    description=c.get("description", ""),
                )
                char_name_to_id[canon_name] = cid

                for alias in aliases:
                    save_character_alias(project_id, canon_name, alias)

            # 重新获取角色库补全 ID 映射
            all_chars = get_characters(project_id)
            for c in all_chars:
                char_name_to_id[c["name"]] = c["id"]
                for a in c.get("aliases", []):
                    char_name_to_id[a] = c["id"]

            # 3. 保存提取出的关系
            for r in data.get("relationships", []):
                from_name = r.get("from_char", "").strip()
                to_name = r.get("to_char", "").strip()

                from_id = char_name_to_id.get(from_name)
                to_id = char_name_to_id.get(to_name)

                if from_id and to_id and from_id != to_id:
                    insert_relationship(
                        project_id=project_id,
                        from_char_id=from_id,
                        to_char_id=to_id,
                        relation_type=r.get("relation_type", "neutral"),
                        description=r.get("description", ""),
                        paragraph_idx=r.get("paragraph_idx", chunk[0]["idx"]),
                        evidence=r.get("evidence"),
                        confidence=r.get("confidence", "medium"),
                    )
                    new_rels_count += 1

            invalidate_graph_cache(project_id)
        except Exception as e:
            logger.warning("Character pipeline extraction failed: %s", e)


    return {
        "status": "ok",
        "extracted_characters": new_chars_count,
        "extracted_relationships": new_rels_count,
    }
