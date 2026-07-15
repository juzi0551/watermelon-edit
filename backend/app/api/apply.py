import os
from fastapi import APIRouter
from fastapi.responses import FileResponse
from pydantic import BaseModel
from docx import Document as DocxDocument
from app.core.database import (
    get_current_document, get_errors, get_error,
    update_error_status, update_error_suggested, update_project_status,
    get_paragraph_by_idx, update_paragraph_revised, get_revised_paragraphs,
)

router = APIRouter()


def _recompute_paragraph(document_id: str, paragraph_idx: int):
    """根据该段所有已采纳错误，重算 revised_text（撤回即重新基于原文计算）。"""
    para = get_paragraph_by_idx(document_id, paragraph_idx)
    if not para:
        return
    accepted = [
        e for e in get_errors(document_id)
        if e["paragraph_index"] == paragraph_idx and e["user_status"] == "accepted"
    ]
    if not accepted:
        update_paragraph_revised(para["id"], None)
        return
    revised = para["text"]
    for e in accepted:
        if e["original_text"] and e["original_text"] in revised:
            revised = revised.replace(e["original_text"], e["suggested_text"], 1)
    update_paragraph_revised(para["id"], revised)


class StatusBody(BaseModel):
    status: str  # accepted | rejected | pending
    custom_text: str | None = None


@router.post("/projects/{project_id}/errors/{error_id}/status")
async def set_error_status(project_id: str, error_id: int, body: StatusBody):
    if body.status not in ("accepted", "rejected", "pending"):
        return {"error": "非法状态"}
    if body.custom_text and body.status == "accepted":
        update_error_suggested(error_id, body.custom_text)
    update_error_status(error_id, body.status)
    e = get_error(error_id)
    if e:
        _recompute_paragraph(e["document_id"], e["paragraph_index"])
    return {"status": "ok"}


@router.post("/projects/{project_id}/accept-all")
async def accept_all(project_id: str):
    doc = get_current_document(project_id)
    if not doc:
        return {"error": "项目无文档"}
    doc_id = doc["id"]
    for e in get_errors(doc_id):
        update_error_status(e["id"], "accepted")
        _recompute_paragraph(doc_id, e["paragraph_index"])
    return {"status": "ok", "count": len(get_errors(doc_id))}


@router.post("/projects/{project_id}/export")
async def export_document(project_id: str):
    """导出校稿版 docx：revised_text ?? text（应用 = 导出，不新建版本）。"""
    doc = get_current_document(project_id)
    if not doc:
        return {"error": "项目无文档"}
    paras = get_revised_paragraphs(doc["id"])
    out = DocxDocument()
    for p in paras:
        out.add_paragraph(p["text"])
    os.makedirs("backend/static/exports", exist_ok=True)
    fname = f"{doc['id']}_校稿版.docx"
    fpath = os.path.join("backend/static/exports", fname)
    out.save(fpath)
    update_project_status(project_id, "completed")
    return FileResponse(fpath, filename=fname)
