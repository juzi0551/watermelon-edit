import os
import logging
from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel

from app.utils.helpers import generate_id
from app.core.document import parse_paragraphs
from app.core.database import (
    create_project, get_project, list_projects, update_project_status,
    update_project_document, delete_project, toggle_project_lock,
    create_document, get_current_document, get_document_versions,
    insert_paragraphs, get_paragraph_count, get_chapters,
    get_document_progress, set_document_error, batch_insert_chapters,
    update_paragraph_text, delete_paragraph_and_reorder,
    toggle_paragraph_page_break, set_paragraph_as_chapter, unset_chapter,
    update_project_profile, get_character_graph, upsert_character, insert_relationship,
    get_paragraph_by_idx, get_paragraph_by_uuid, update_paragraph_notes_history,
    insert_paragraph_and_reorder, merge_paragraphs, merge_multiple_paragraphs,
)
from app.api.apply import _recompute_paragraph
from app.api.proofread import _RUNNING

logger = logging.getLogger(__name__)

router = APIRouter()


class ProjectLockBody(BaseModel):
    is_locked: bool


class ParagraphUpdateBody(BaseModel):
    text: str
    edit_note: str | None = None
    paragraph_uuid: str | None = None


class ParagraphInsertBody(BaseModel):
    position: str = "below"  # "above" | "below"
    text: str = ""
    paragraph_uuid: str | None = None


class ParagraphMergeBody(BaseModel):
    direction: str = "below"  # "above" | "below"
    separator: str = ""
    paragraph_uuid: str | None = None


class ParagraphMergeBatchBody(BaseModel):
    paragraph_uuids: list[str] = []
    separator: str = ""


class PageBreakToggleBody(BaseModel):
    has_page_break_before: bool | None = None
    page_break_type: str | None = None
    paragraph_uuid: str | None = None


class ChapterSetBody(BaseModel):
    level: int = 1
    title: str | None = None
    is_chapter: bool = True
    paragraph_uuid: str | None = None


@router.get("/projects")
async def api_list_projects():
    """获取所有项目列表。"""
    projects = list_projects()
    for p in projects:
        doc = get_current_document(p["id"])
        if doc:
            chapters = get_chapters(doc["id"])
            p["chapter_count"] = len(chapters)
            p["filename"] = doc["filename"]
            p["paragraph_count"] = get_paragraph_count(doc["id"])
            progress = get_document_progress(doc["id"])
            p["proofread_upto"] = progress["proofread_upto"]
        else:
            p["chapter_count"] = 0
            p["filename"] = None
            p["paragraph_count"] = 0
            p["proofread_upto"] = 0
    return {"projects": projects}


class CreateBlankProjectBody(BaseModel):
    name: str
    author_name: str | None = None
    background_setting: str | None = None
    genre: str | None = None
    characters_summary: str | None = None
    conflict_summary: str | None = None
    system_prompt: str | None = None
    system_prompt_preset: str | None = None


@router.post("/projects")
async def api_create_project(name: str = ""):
    """新建项目。"""
    project_id = generate_id()
    project = create_project(project_id, name or "未命名项目")
    return project


@router.post("/projects/create-blank")
async def api_create_blank_project(body: CreateBlankProjectBody):
    """新建免上传空白写作项目 (Writing Mode)。"""
    from app.core.database import create_blank_project_with_doc
    project_id = generate_id()
    project = create_blank_project_with_doc(
        project_id=project_id,
        name=body.name,
        author_name=body.author_name,
        background_setting=body.background_setting,
        genre=body.genre,
        characters_summary=body.characters_summary,
        conflict_summary=body.conflict_summary,
        system_prompt=body.system_prompt,
        system_prompt_preset=body.system_prompt_preset,
    )
    return project



@router.get("/projects/{project_id}")
async def api_get_project(project_id: str):
    """获取项目详情。"""
    project = get_project(project_id)
    if not project:
        return {"error": "项目不存在"}

    doc = get_current_document(project_id)

    if doc and project.get("status") == "proofreading" and doc["id"] not in _RUNNING:
        logger.warning("检测到僵死校对状态，自动恢复 project=%s doc=%s", project_id, doc["id"])
        update_project_status(project_id, "reviewing")
        set_document_error(doc["id"], "上次校对已中断（超时或服务重启），已恢复，可重新校对")
        project["status"] = "reviewing"

    chapters = []
    if doc:
        chapters = get_chapters(doc["id"])

    versions = get_document_versions(project_id)

    return {
        **project,
        "current_document_id": doc["id"] if doc else None,
        "filename": doc["filename"] if doc else None,
        "paragraph_count": get_paragraph_count(doc["id"]) if doc else 0,
        "proofread_upto": doc["proofread_upto"] if doc else 0,
        "last_error": doc.get("last_error") if doc else None,
        "chapters": [{"id": ch["id"], "title": ch["title"], "order": ch["sort_order"], "title_paragraph_idx": ch.get("title_paragraph_idx"), "level": ch.get("level", 1)}
                     for ch in chapters],
        "versions": [{"id": v["id"], "version": v["version"], "is_current": v["is_current"],
                      "created_at": v["created_at"]} for v in versions],
    }


@router.post("/projects/{project_id}/upload")
async def api_upload_to_project(project_id: str, file: UploadFile = File(...)):
    """上传 docx 到项目，解析并保存。"""
    project = get_project(project_id)
    if not project:
        return {"error": "项目不存在"}

    doc_id = generate_id()
    uploads_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads"
    )
    os.makedirs(uploads_dir, exist_ok=True)
    file_path = os.path.join(uploads_dir, f"{project_id}_{file.filename}")

    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)

    versions = get_document_versions(project_id)
    version = (versions[0]["version"] + 1) if versions else 1

    create_document(doc_id, project_id, file.filename, file_path, version)

    from app.core.database import add_annotation
    rows, initial_chapters, has_first_line_indent, extracted_annotations = parse_paragraphs(file_path)
    insert_paragraphs(doc_id, rows)

    if extracted_annotations:
        for ann in extracted_annotations:
            add_annotation(
                document_id=doc_id,
                paragraph_idx=ann["paragraph_idx"],
                selected_text=ann["selected_text"],
                content=ann["content"],
            )

    if initial_chapters:
        batch_insert_chapters(doc_id, initial_chapters, sort_base=0)

    if has_first_line_indent:
        from app.core.database import set_project_first_line_indent
        set_project_first_line_indent(project_id, True)

    update_project_status(project_id, "parsed")
    update_project_document(project_id, doc_id)

    # 异步启动后台实体预扫描 (jieba / ngram / dialogue)，分块协作不阻塞事件循环
    try:
        import asyncio
        from app.core.entity_pre_scanner import run_pre_scanner_async
        asyncio.create_task(run_pre_scanner_async(project_id))
    except Exception as ex:
        logger.warning("Trigger entity pre-scanner failed for project %s: %s", project_id, ex)

    return {
        "document_id": doc_id,
        "filename": file.filename,
        "version": version,
        "paragraph_count": len(rows),
        "chapter_count": len(initial_chapters),
        "first_line_indent_enabled": has_first_line_indent,
    }


class ParagraphNotesBody(BaseModel):
    notes: list[dict]
    paragraph_uuid: str | None = None


def _resolve_para(doc_id: str, idx_or_uuid: str | int, body_uuid: str | None = None) -> dict | None:
    from app.core.database import resolve_paragraph_target, get_paragraph_by_idx, get_paragraph_by_uuid

    target_uuid = body_uuid or (str(idx_or_uuid) if not str(idx_or_uuid).isdigit() else None)
    if target_uuid:
        resolved = resolve_paragraph_target(doc_id, target_uuid)
        if resolved.get("status") in ("normal", "merged") and resolved.get("target_idx") is not None:
            return get_paragraph_by_idx(doc_id, resolved["target_idx"])
        elif resolved.get("status") in ("deleted", "merged_then_deleted"):
            raise HTTPException(status_code=400, detail="目标段落已被逻辑删除，无法直接修改")

    target_str = str(idx_or_uuid)
    if target_str.isdigit():
        return get_paragraph_by_idx(doc_id, int(target_str))
    return get_paragraph_by_uuid(doc_id, target_str)


@router.get("/projects/{project_id}/paragraphs/{uuid}/status")
async def api_get_paragraph_status(project_id: str, uuid: str):
    """获取单个段落的追溯决策状态"""
    doc = get_current_document(project_id)
    if not doc:
        raise HTTPException(status_code=404, detail="项目无文档")
    from app.core.database import resolve_paragraph_target
    return resolve_paragraph_target(doc["id"], uuid)


class StatusBatchReq(BaseModel):
    uuids: list[str]


@router.post("/projects/{project_id}/paragraphs/status_batch")
async def api_get_paragraph_status_batch(project_id: str, req: StatusBatchReq):
    """批量获取段落的追溯决策状态"""
    doc = get_current_document(project_id)
    if not doc:
        raise HTTPException(status_code=404, detail="项目无文档")
    from app.core.database import resolve_paragraph_target
    res = {}
    for u in req.uuids:
        if u:
            res[u] = resolve_paragraph_target(doc["id"], u)
    return res


class RestoreReq(BaseModel):
    target_idx: int | None = None


@router.post("/projects/{project_id}/paragraphs/{uuid}/restore")
async def api_restore_paragraph(project_id: str, uuid: str, body: RestoreReq | None = None):
    """恢复被逻辑删除的段落"""
    doc = get_current_document(project_id)
    if not doc:
        raise HTTPException(status_code=404, detail="项目无文档")
    from app.core.database import restore_paragraph
    target_idx = body.target_idx if body else None
    result = restore_paragraph(doc["id"], uuid, target_idx)
    if not result:
        raise HTTPException(status_code=404, detail="无法恢复段落，段落不存在或未被删除")
    return result


@router.patch("/projects/{project_id}/paragraphs/{idx}")
async def api_update_paragraph(project_id: str, idx: str, body: ParagraphUpdateBody):
    """人工修改段落文本与修改备注（支持 idx 或 uuid，自动透传已合并段落重定向）。"""
    doc = get_current_document(project_id)
    if not doc:
        raise HTTPException(status_code=404, detail="项目无文档")
    para = _resolve_para(doc["id"], idx, body.paragraph_uuid)
    if not para:
        raise HTTPException(status_code=404, detail="段落不存在")

    text_to_save = body.text if body.text is not None else (para.get("revised_text") or para.get("text") or "")
    update_paragraph_text(doc["id"], para["idx"], text_to_save, edit_note=body.edit_note)
    return {"status": "ok", "idx": para["idx"], "uuid": para.get("uuid"), "text": text_to_save, "edit_note": body.edit_note}


@router.put("/projects/{project_id}/paragraphs/{idx}/notes")
async def api_update_paragraph_notes(project_id: str, idx: str, body: ParagraphNotesBody):
    """更新维护段落的多轮修改备注履历。"""
    doc = get_current_document(project_id)
    if not doc:
        return {"error": "项目无文档"}
    para = _resolve_para(doc["id"], idx, body.paragraph_uuid)
    if not para:
        return {"error": "段落不存在"}
    update_paragraph_notes_history(doc["id"], para["idx"], body.notes)
    return {"status": "ok", "idx": para["idx"], "uuid": para.get("uuid"), "notes": body.notes}


@router.delete("/projects/{project_id}/paragraphs/{idx}")
async def api_delete_paragraph(project_id: str, idx: str, paragraph_uuid: str | None = None):
    """删除段落，平移后续段落 idx。"""
    project = get_project(project_id)
    if project and project.get("is_locked") == 1:
        return {"error": "项目已锁定，无法删除段落"}

    doc = get_current_document(project_id)
    if not doc:
        return {"error": "项目无文档"}

    # 幂等：对已逻辑删除的段落再次删除，直接返回 already_deleted（_resolve_para 对已删段抛 400，此处先行拦截）
    target_uuid = paragraph_uuid or (idx if not str(idx).isdigit() else None)
    if target_uuid:
        existing = get_paragraph_by_uuid(doc["id"], target_uuid)
        if existing and existing.get("is_deleted") == 1:
            return {"status": "already_deleted", "deleted_uuid": existing.get("uuid")}

    para = _resolve_para(doc["id"], idx, paragraph_uuid)
    if not para:
        return {"error": "段落不存在"}
    delete_paragraph_and_reorder(doc["id"], para["idx"])
    return {"status": "ok", "deleted_idx": para["idx"], "deleted_uuid": para.get("uuid")}


@router.post("/projects/{project_id}/paragraphs/{idx}/insert")
async def api_insert_paragraph(project_id: str, idx: str, body: ParagraphInsertBody):
    """在该段落上方或下方插入新段落（支持 idx 或 uuid）。"""
    project = get_project(project_id)
    if project and project.get("is_locked") == 1:
        return {"error": "项目已锁定，无法插入段落"}

    doc = get_current_document(project_id)
    if not doc:
        return {"error": "项目无文档"}
    para = _resolve_para(doc["id"], idx, body.paragraph_uuid)
    target_param = para["uuid"] if para and para.get("uuid") else (para["idx"] if para else idx)
    result = insert_paragraph_and_reorder(doc["id"], target_param, position=body.position, text=body.text)
    return {"status": "ok", **result}


@router.post("/projects/{project_id}/paragraphs/{idx}/merge")
async def api_merge_paragraphs(project_id: str, idx: str, body: ParagraphMergeBody):
    """合并该段落与相邻段落（支持 idx 或 uuid）。"""
    project = get_project(project_id)
    if project and project.get("is_locked") == 1:
        return {"error": "项目已锁定，无法合并段落"}

    doc = get_current_document(project_id)
    if not doc:
        return {"error": "项目无文档"}
    para = _resolve_para(doc["id"], idx, body.paragraph_uuid)
    target_param = para["uuid"] if para and para.get("uuid") else (para["idx"] if para else idx)
    result = merge_paragraphs(doc["id"], target_param, direction=body.direction, separator=body.separator)
    _recompute_paragraph(doc["id"], result["uuid"])
    return {"status": "ok", **result}


@router.post("/projects/{project_id}/paragraphs/merge_batch")
async def api_merge_multiple_paragraphs(project_id: str, body: ParagraphMergeBatchBody):
    """批量合并选定的多段连续段落。"""
    project = get_project(project_id)
    if project and project.get("is_locked") == 1:
        return {"error": "项目已锁定，无法合并段落"}

    doc = get_current_document(project_id)
    if not doc:
        return {"error": "项目无文档"}
    if not body.paragraph_uuids:
        return {"error": "未选择任何要合并的段落"}

    result = merge_multiple_paragraphs(doc["id"], body.paragraph_uuids, separator=body.separator)
    _recompute_paragraph(doc["id"], result["uuid"])
    return {"status": "ok", **result}


@router.post("/projects/{project_id}/lock")
async def api_toggle_project_lock(project_id: str, body: ProjectLockBody):
    """切换项目锁定状态。"""
    project = get_project(project_id)
    if not project:
        return {"error": "项目不存在"}
    toggle_project_lock(project_id, body.is_locked)
    return {"status": "ok", "is_locked": body.is_locked}


@router.post("/projects/{project_id}/paragraphs/{idx}/page_break")
async def api_toggle_page_break(project_id: str, idx: str, body: PageBreakToggleBody):
    """切换段落前置分页符状态。"""
    doc = get_current_document(project_id)
    if not doc:
        return {"error": "项目无文档"}
    para = _resolve_para(doc["id"], idx, body.paragraph_uuid)
    if not para:
        return {"error": "段落不存在"}
    val = body.page_break_type if body.page_break_type is not None else body.has_page_break_before
    toggle_paragraph_page_break(doc["id"], para["idx"], val)
    return {"status": "ok", "idx": para["idx"], "uuid": para.get("uuid"), "val": val}


@router.post("/projects/{project_id}/paragraphs/{idx}/chapter")
async def api_set_chapter(project_id: str, idx: str, body: ChapterSetBody):
    """人工设置或取消章节标题。"""
    doc = get_current_document(project_id)
    if not doc:
        return {"error": "项目无文档"}
    para = _resolve_para(doc["id"], idx, body.paragraph_uuid)
    if not para:
        return {"error": "段落不存在"}
    p_idx = para["idx"]
    if body.is_chapter:
        ch_id = set_paragraph_as_chapter(doc["id"], p_idx, body.level, body.title)
        return {"status": "ok", "action": "set", "chapter_id": ch_id, "idx": p_idx, "uuid": para.get("uuid")}
    else:
        unset_chapter(doc["id"], p_idx)
        return {"status": "ok", "action": "unset", "idx": p_idx, "uuid": para.get("uuid")}


@router.post("/projects/{project_id}/rename")
async def api_rename_project(project_id: str, name: str):
    """重命名项目。"""
    from app.core.database import get_conn
    with get_conn() as conn:
        conn.execute("UPDATE projects SET name = ? WHERE id = ?", (name, project_id))
    return {"status": "ok"}


@router.post("/projects/{project_id}/format-indent")
async def api_format_indent(project_id: str):
    """一键物理清洗全书自然段段首杂乱硬空格，并激活 XML 物理首行缩进配置。"""
    doc = get_current_document(project_id)
    if not doc:
        return {"error": "项目无文档"}
    doc_id = doc["id"]
    from app.core.database import get_conn, set_project_first_line_indent
    count = 0
    with get_conn() as conn:
        paras = conn.execute(
            "SELECT id, idx, text, revised_text FROM paragraphs WHERE document_id = ? AND (is_deleted IS NULL OR is_deleted = 0) ORDER BY idx ASC",
            (doc_id,),
        ).fetchall()
        for p in paras:
            raw = p["revised_text"] if p["revised_text"] is not None else p["text"]
            if not raw or not raw.strip():
                continue
            clean = raw.lstrip(" \t\r\n\u3000")
            if clean != raw:
                conn.execute(
                    "UPDATE paragraphs SET revised_text = ? WHERE id = ?",
                    (clean, p["id"]),
                )
                count += 1
    
    # 激活 XML 中的首行 2 字符物理缩进配置
    set_project_first_line_indent(project_id, True)
    return {"status": "ok", "formatted_count": count, "first_line_indent_enabled": True}


@router.delete("/projects/{project_id}")
async def api_delete_project(project_id: str):
    """逻辑删除项目（保留物理数据）。"""
    try:
        delete_project(project_id)
        return {"status": "ok"}
    except ValueError as ve:
        return {"error": str(ve)}
    except Exception as e:
        return {"error": f"删除失败：{str(e)}"}


@router.post("/projects/{project_id}/clean-empty-paragraphs")
async def api_clean_empty_paragraphs(project_id: str):
    """清理项目文档中的所有空行并自动重新编排索引。"""
    from app.core.database import clean_empty_paragraphs, get_current_document
    doc = get_current_document(project_id)
    if not doc:
        return {"error": "项目无文档"}
    try:
        deleted_count = clean_empty_paragraphs(doc["id"])
        return {"status": "ok", "deleted_count": deleted_count}
    except ValueError as ve:
        return {"error": str(ve)}
    except Exception as e:
        return {"error": f"清理失败：{str(e)}"}


class ProjectProfileUpdateBody(BaseModel):
    author_name: str | None = None
    author_intro: str | None = None
    background_setting: str | None = None
    theme_mode: str | None = None
    mode: str | None = None
    system_prompt: str | None = None
    system_prompt_preset: str | None = None
    genre: str | None = None
    characters_summary: str | None = None
    conflict_summary: str | None = None


@router.put("/projects/{project_id}/profile")
async def api_update_project_profile(project_id: str, body: ProjectProfileUpdateBody):
    """更新作者基本设定、背景介绍、系统提示词与主题偏好。"""
    project = get_project(project_id)
    if not project:
        return {"error": "项目不存在"}
    update_project_profile(
        project_id,
        author_name=body.author_name,
        author_intro=body.author_intro,
        background_setting=body.background_setting,
        theme_mode=body.theme_mode,
        mode=body.mode,
        system_prompt=body.system_prompt,
        system_prompt_preset=body.system_prompt_preset,
        genre=body.genre,
        characters_summary=body.characters_summary,
        conflict_summary=body.conflict_summary,
    )
    return {"status": "ok"}



@router.get("/projects/{project_id}/character-graph")
async def api_get_character_graph(project_id: str, upto_paragraph_idx: int | None = None, upto_paragraph_uuid: str | None = None):
    """获取项目的人物演进关系图谱网络数据。"""
    project = get_project(project_id)
    if not project:
        return {"error": "项目不存在"}
    from app.core.graph_engine import get_character_graph
    graph = get_character_graph(project_id, upto_paragraph_idx, upto_paragraph_uuid)
    return graph


@router.get("/projects/{project_id}/character-graph/shortest-path")
@router.get("/projects/{project_id}/character-shortest-path")
async def api_get_character_graph_shortest_path(
    project_id: str,
    source_id: str | None = None,
    target_id: str | None = None,
    source: str | None = None,
    target: str | None = None,
    upto_paragraph_idx: int | None = None,
    upto_paragraph_uuid: str | None = None,
):
    """计算两角色的最短关系路径 (Dijkstra Shortest Path)。"""
    project = get_project(project_id)
    if not project:
        return {"error": "项目不存在"}

    src = source_id or source
    tgt = target_id or target
    if not src or not tgt:
        return {"error": "缺少参数 source_id / target_id"}

    from app.core.graph_engine import find_shortest_path
    result = find_shortest_path(
        project_id, src, tgt, upto_paragraph_idx=upto_paragraph_idx, upto_paragraph_uuid=upto_paragraph_uuid
    )
    return result



@router.post("/projects/{project_id}/scan-terms")
async def api_scan_terms(project_id: str):
    """一键触发离线 NLP 规则异形词扫描与 GB/T 15834 标点规范校验。"""
    doc = get_current_document(project_id)
    if not doc:
        return {"error": "项目无文档"}
    
    res_terms = scan_term_consistency(doc["id"])
    res_punct = scan_gbt15834_punctuation(doc["id"])
    
    new_count = res_terms.get("new_issues", 0) + res_punct.get("new_issues", 0)
    return {
        "status": "ok",
        "scanned_paragraphs": res_terms.get("scanned_paragraphs", 0),
        "total_issues": res_terms.get("found_issues", 0) + res_punct.get("found_issues", 0),
        "new_issues": new_count,
    }


@router.post("/projects/{project_id}/rescan-entities")
async def api_rescan_project_entities(project_id: str):
    """手动重新触发实体预扫描 (jieba/ngram/dialogue)，分块协作执行。"""
    from app.core.entity_pre_scanner import run_pre_scanner_async
    count = await run_pre_scanner_async(project_id)
    return {"status": "ok", "entity_count": count}


@router.get("/projects/{project_id}/prescan-status")
async def api_get_prescan_status(project_id: str):
    """获取项目实体预扫描状态 (idle/running/completed/failed) 与实体数。"""
    from app.core.entity_pre_scanner import get_scan_status, is_dictionary_expired
    status, count = get_scan_status(project_id)
    return {
        "status": status,
        "entity_count": count,
        "expired": is_dictionary_expired(project_id),
    }


@router.get("/projects/{project_id}/entity-dictionary-status")
async def api_get_entity_dictionary_status(project_id: str):
    """获取项目实体词典的过期状态标示。"""
    from app.core.entity_pre_scanner import is_dictionary_expired
    return {"expired": is_dictionary_expired(project_id)}



