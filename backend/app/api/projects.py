import os
import logging
from fastapi import APIRouter, UploadFile, File
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
)
from app.core.nlp_engine import scan_term_consistency, scan_gbt15834_punctuation
from app.api.proofread import _RUNNING

logger = logging.getLogger(__name__)

router = APIRouter()


class ProjectLockBody(BaseModel):
    is_locked: bool


class ParagraphUpdateBody(BaseModel):
    text: str


class PageBreakToggleBody(BaseModel):
    has_page_break_before: bool | None = None
    page_break_type: str | None = None


class ChapterSetBody(BaseModel):
    level: int = 1
    title: str | None = None
    is_chapter: bool = True


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


@router.post("/projects")
async def api_create_project(name: str = ""):
    """新建项目。"""
    project_id = generate_id()
    project = create_project(project_id, name or "未命名项目")
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

    rows, initial_chapters = parse_paragraphs(file_path)
    insert_paragraphs(doc_id, rows)

    if initial_chapters:
        batch_insert_chapters(doc_id, initial_chapters, sort_base=0)

    update_project_status(project_id, "parsed")
    update_project_document(project_id, doc_id)

    return {
        "document_id": doc_id,
        "filename": file.filename,
        "version": version,
        "paragraph_count": len(rows),
        "chapter_count": len(initial_chapters),
    }


@router.patch("/projects/{project_id}/paragraphs/{idx}")
async def api_update_paragraph(project_id: str, idx: int, body: ParagraphUpdateBody):
    """人工修改段落文本。"""
    doc = get_current_document(project_id)
    if not doc:
        return {"error": "项目无文档"}
    update_paragraph_text(doc["id"], idx, body.text)
    return {"status": "ok", "idx": idx, "text": body.text}


@router.delete("/projects/{project_id}/paragraphs/{idx}")
async def api_delete_paragraph(project_id: str, idx: int):
    """删除段落，平移后续段落 idx。"""
    project = get_project(project_id)
    if project and project.get("is_locked") == 1:
        return {"error": "项目已锁定，无法删除段落"}

    doc = get_current_document(project_id)
    if not doc:
        return {"error": "项目无文档"}
    delete_paragraph_and_reorder(doc["id"], idx)
    return {"status": "ok", "deleted_idx": idx}


@router.post("/projects/{project_id}/lock")
async def api_toggle_project_lock(project_id: str, body: ProjectLockBody):
    """切换项目锁定状态。"""
    project = get_project(project_id)
    if not project:
        return {"error": "项目不存在"}
    toggle_project_lock(project_id, body.is_locked)
    return {"status": "ok", "is_locked": body.is_locked}


@router.post("/projects/{project_id}/paragraphs/{idx}/page_break")
async def api_toggle_page_break(project_id: str, idx: int, body: PageBreakToggleBody):
    """切换段落前置分页符状态。"""
    doc = get_current_document(project_id)
    if not doc:
        return {"error": "项目无文档"}
    val = body.page_break_type if body.page_break_type is not None else body.has_page_break_before
    toggle_paragraph_page_break(doc["id"], idx, val)
    return {"status": "ok", "idx": idx, "val": val}


@router.post("/projects/{project_id}/paragraphs/{idx}/chapter")
async def api_set_chapter(project_id: str, idx: int, body: ChapterSetBody):
    """人工设置或取消章节标题。"""
    doc = get_current_document(project_id)
    if not doc:
        return {"error": "项目无文档"}
    if body.is_chapter:
        ch_id = set_paragraph_as_chapter(doc["id"], idx, body.level, body.title)
        return {"status": "ok", "action": "set", "chapter_id": ch_id}
    else:
        unset_chapter(doc["id"], idx)
        return {"status": "ok", "action": "unset", "idx": idx}


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
            "SELECT id, idx, text, revised_text FROM paragraphs WHERE document_id = ? ORDER BY idx ASC",
            (doc_id,),
        ).fetchall()
        for p in paras:
            raw = p["revised_text"] if p["revised_text"] is not None else p["text"]
            if not raw or not raw.strip():
                continue
            clean = raw.lstrip(" \t\r\n\u3000")
            if clean != raw:
                conn.execute(
                    "UPDATE paragraphs SET text = ?, revised_text = NULL WHERE id = ?",
                    (clean, p["id"]),
                )
                count += 1
    
    # 激活 XML 中的首行 2 字符物理缩进配置
    set_project_first_line_indent(project_id, True)
    return {"status": "ok", "formatted_count": count, "first_line_indent_enabled": True}


@router.delete("/projects/{project_id}")
async def api_delete_project(project_id: str):
    """删除项目及其所有数据。"""
    project = get_project(project_id)
    if project and project.get("is_locked") == 1:
        return {"error": "项目已锁定，无法删除"}
    delete_project(project_id)
    return {"status": "ok"}


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


@router.put("/projects/{project_id}/profile")
async def api_update_project_profile(project_id: str, body: ProjectProfileUpdateBody):
    """更新作者基本设定、背景介绍与主题偏好。"""
    project = get_project(project_id)
    if not project:
        return {"error": "项目不存在"}
    update_project_profile(
        project_id,
        author_name=body.author_name,
        author_intro=body.author_intro,
        background_setting=body.background_setting,
        theme_mode=body.theme_mode,
    )
    return {"status": "ok"}


@router.get("/projects/{project_id}/character-graph")
async def api_get_character_graph(project_id: str, upto_paragraph_idx: int | None = None):
    """获取项目的人物演进关系图谱网络数据。"""
    project = get_project(project_id)
    if not project:
        return {"error": "项目不存在"}
    graph = get_character_graph(project_id, upto_paragraph_idx)
    return graph


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

