import os
from fastapi import APIRouter
from fastapi.responses import FileResponse
from pydantic import BaseModel
from docx import Document as DocxDocument
from app.core.document import EMPTY_SKIP_STYLES
from app.core.database import (
    get_current_document, get_errors, get_error,
    update_error_status, update_error_suggested, update_project_status,
    get_paragraph_by_idx, update_paragraph_revised, get_revised_paragraphs,
    get_chapters,
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
    """导出校稿版 docx。
    
    基于原 docx 文件修改文本（保留全部排版样式），
    对 LLM 识别的章节标题段落应用 Heading 样式。
    """
    doc = get_current_document(project_id)
    if not doc:
        return {"error": "项目无文档"}

    doc_id = doc["id"]
    file_path = doc.get("file_path") or ""
    paras = get_revised_paragraphs(doc_id)
    chapters = get_chapters(doc_id)

    # 构建章节段落查找表：{paragraph_idx: chapter_level}
    chapter_heading = {}
    for ch in chapters:
        tip = ch.get("title_paragraph_idx")
        if tip is not None:
            chapter_heading[tip] = ch.get("level", 1)

    os.makedirs("backend/static/exports", exist_ok=True)

    if file_path and os.path.exists(file_path):
        # ── 方式 A：基于原 docx 修改，完全保留排版 ──
        docx = DocxDocument(file_path)

        # 构建 DB idx → docx 段落对象映射（与 parse_paragraphs 同一套跳略逻辑）
        idx_to_para: dict[int, object] = {}
        db_idx = 0
        for para in docx.paragraphs:
            style_name = para.style.name or ""
            if style_name in EMPTY_SKIP_STYLES:
                continue
            if not para.text.strip():
                continue
            idx_to_para[db_idx] = para
            db_idx += 1

        text_by_idx = {p["idx"]: p["text"] for p in paras}

        # 替换文本 + 应用章节标题样式
        for db_idx, para in idx_to_para.items():
            new_text = text_by_idx.get(db_idx)
            if new_text is None:
                continue

            # 替换段落文本，保留首 run 格式
            first = True
            for run in para.runs:
                if first:
                    run.text = new_text
                    first = False
                else:
                    run.text = ""
            if not para.runs:
                para.add_run(new_text)

            # 章节标题 → Heading 样式
            level = chapter_heading.get(db_idx)
            if level is not None:
                target = f"Heading {level}"
                try:
                    if para.style.name != target:
                        para.style = docx.styles[target]
                except (KeyError, AttributeError):
                    pass

        fname = f"{doc_id}_校稿版.docx"
        fpath = os.path.join("backend/static/exports", fname)
        docx.save(fpath)
    else:
        # ── 方式 B：原文件不存在时的降级（纯文本）──
        out = DocxDocument()
        # 如果有关联章节，先写章节标题再写段落
        if chapters:
            ch_paras = sorted(
                [(c["title_paragraph_idx"], c["title"], c.get("level", 1))
                 for c in chapters if c.get("title")],
                key=lambda x: x[0],
            )
            ch_title_by_idx = {tp[0]: tp for tp in ch_paras}
            for p in paras:
                info = ch_title_by_idx.get(p["idx"])
                if info:
                    run = out.add_heading(info[1], level=info[2])
                out.add_paragraph(p["text"])
        else:
            for p in paras:
                out.add_paragraph(p["text"])
        fname = f"{doc_id}_校稿版.docx"
        fpath = os.path.join("backend/static/exports", fname)
        out.save(fpath)

    update_project_status(project_id, "completed")
    return FileResponse(fpath, filename=fname)
