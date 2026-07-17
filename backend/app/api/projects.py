import os

from fastapi import APIRouter, UploadFile, File
from app.utils.helpers import generate_id
import logging
from app.core.document import parse_paragraphs
from app.core.database import (
    create_project, get_project, list_projects, update_project_status,
    update_project_document, delete_project,
    create_document, get_current_document, get_document_versions,
    insert_paragraphs, get_paragraph_count, get_chapters,
    get_document_progress, set_document_error,
)
from app.api.proofread import _RUNNING

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/projects")
async def api_list_projects():
    """获取所有项目列表。"""
    projects = list_projects()
    # 附加当前文档信息
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

    # 恢复上次超时/崩溃遗留的「校对中」状态
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
        "chapters": [{"id": ch["id"], "title": ch["title"], "order": ch["sort_order"]}
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

    # 保存文件
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)

    # 确定版本号
    versions = get_document_versions(project_id)
    version = (versions[0]["version"] + 1) if versions else 1

    # 创建文档版本
    create_document(doc_id, project_id, file.filename, file_path, version)

    rows = parse_paragraphs(file_path)
    insert_paragraphs(doc_id, rows)

    # 更新项目状态
    update_project_status(project_id, "parsed")
    update_project_document(project_id, doc_id)

    return {
        "document_id": doc_id,
        "filename": file.filename,
        "version": version,
        "paragraph_count": len(rows),
    }


@router.post("/projects/{project_id}/rename")
async def api_rename_project(project_id: str, name: str):
    """重命名项目。"""
    from app.core.database import get_conn
    with get_conn() as conn:
        conn.execute("UPDATE projects SET name = ? WHERE id = ?", (name, project_id))
    return {"status": "ok"}


@router.delete("/projects/{project_id}")
async def api_delete_project(project_id: str):
    """删除项目及其所有数据。"""
    delete_project(project_id)
    return {"status": "ok"}
