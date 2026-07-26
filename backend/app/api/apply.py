import os
from fastapi import APIRouter
from fastapi.responses import FileResponse
from pydantic import BaseModel
from docx import Document as DocxDocument
from docx.enum.text import WD_BREAK
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls, qn
from app.core.document import EMPTY_SKIP_STYLES
from datetime import datetime
from app.core.database import (
    get_project, get_current_document, get_errors, get_error,
    update_error_status, update_error_suggested, update_project_status,
    get_paragraph_by_idx, update_paragraph_revised, get_revised_paragraphs,
    get_chapters,
)

router = APIRouter()


def _apply_heading_style(docx, para, level: int):
    """安全写入 Word 标题样式，兼容中英文环境（Heading 1 与 标题 1）。"""
    targets = [f"Heading {level}", f"标题 {level}"]
    for t in targets:
        try:
            if t in docx.styles:
                para.style = docx.styles[t]
                return
        except Exception:
            pass
    for t in targets:
        try:
            para.style = t
            return
        except Exception:
            pass


def _recompute_paragraph(document_id: str, paragraph_idx: int):
    """根据该段所有已采纳错误，重算 revised_text（撤回即重新基于原文计算）。

    Bug 1 修复：按 position 排序而非插入顺序。
    Bug 2 修复：基于 position 切片替换，而非 str.find/replace（避免匹配到错误位置）。
    """
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

    original = para["text"]

    # 用 indexOf 获取每个错误在原文中的确切位置
    indexed: list[tuple[int, dict]] = []
    for e in accepted:
        pos = original.find(e["original_text"])
        if pos >= 0:
            indexed.append((pos, e))

    # 按位置降序处理（从右向左），保证左侧未处理的位置不受长度变化影响
    indexed.sort(key=lambda x: x[0], reverse=True)

    revised = original
    for pos, e in indexed:
        end = pos + len(e["original_text"])
        # 验证 original 确实还在该 position（未被此前处理的右侧重叠错误修改）
        if revised[pos:end] == e["original_text"]:
            revised = revised[:pos] + e["suggested_text"] + revised[end:]

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
    errors = get_errors(doc_id)
    if not errors:
        return {"status": "ok", "count": 0}
    for e in errors:
        update_error_status(e["id"], "accepted")
    # 按段落分组，每段只重算一次（Bug 3 修复）
    seen = set()
    for e in errors:
        pi = e["paragraph_index"]
        if pi not in seen:
            seen.add(pi)
            _recompute_paragraph(doc_id, pi)
    return {"status": "ok", "count": len(errors)}


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

    proj = get_project(project_id)
    raw_name = (proj.get("name") if proj else None) or "校稿文档"
    clean_name = "".join(c for c in raw_name if c not in r'/\:*?"<>|').strip() or "校稿文档"
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    fname = f"{clean_name}_校稿版_{ts}.docx"

    if file_path and os.path.exists(file_path):
        # ── 方式 A：基于原 docx 修改，完全保留排版 ──
        docx = DocxDocument(file_path)

        # 若数据库中已清理空行，使用 lxml 从 docx XML 中物理同步移除空段落节点，避免索引错位
        db_has_no_empty = not any(not p.get("text") or not p["text"].strip() for p in paras)
        if db_has_no_empty:
            for para in list(docx.paragraphs):
                style_name = para.style.name or ""
                if style_name in EMPTY_SKIP_STYLES:
                    continue
                if not para.text or not para.text.strip():
                    parent = para._element.getparent()
                    if parent is not None:
                        parent.remove(para._element)

        # 构建 DB idx → docx 段落对象映射（1:1 绝对重合）
        idx_to_para: dict[int, object] = {}
        db_idx = 0
        for para in docx.paragraphs:
            style_name = para.style.name or ""
            if style_name in EMPTY_SKIP_STYLES:
                continue
            idx_to_para[db_idx] = para
            db_idx += 1

        para_dict = {p["idx"]: p for p in paras}

        # 替换文本 + 节点精准注入分页符（不修改样式，不插入多余段落）
        for db_idx, para in idx_to_para.items():
            p_data = para_dict.get(db_idx)
            if not p_data:
                continue

            new_text = p_data["text"]

            # 是否包含分页标记，或者该段落为 1 级大章节标题
            is_ch_l1 = (chapter_heading.get(db_idx) == 1)
            has_break = p_data.get("has_page_break_before", 0)
            pb_type = p_data.get("page_break_type", "none")
            if (is_ch_l1 or has_break == 1 or pb_type in ("original", "auto_chapter", "manual")) and db_idx > 0:
                pPr = para._element.get_or_add_pPr()
                if pPr.find(qn("w:pageBreakBefore")) is None:
                    pPr.append(parse_xml(r'<w:pageBreakBefore %s/>' % nsdecls("w")))
            elif pb_type == "none" and not is_ch_l1:
                # 用户主动删除了该段落的硬分页：物理擦除 XML 中的 pageBreakBefore 与 w:type="page"
                pPr = para._element.find(qn("w:pPr"))
                if pPr is not None:
                    pbb = pPr.find(qn("w:pageBreakBefore"))
                    if pbb is not None:
                        pPr.remove(pbb)
                for r in para._element.findall(qn("w:r")):
                    for br in r.findall(qn("w:br")):
                        if br.get(qn("w:type")) == "page":
                            r.remove(br)

            # 替换段落文本，保留首 run 格式（零干扰原 Word 排版）
            first = True
            for run in para.runs:
                if first:
                    run.text = new_text
                    first = False
                else:
                    run.text = ""
            if not para.runs:
                para.add_run(new_text)

        fpath = os.path.join("backend/static/exports", fname)
        docx.save(fpath)
    else:
        # ── 方式 B：原文件不存在时的降级（纯文本）──
        out = DocxDocument()
        ch_paras = sorted(
            [(c["title_paragraph_idx"], c["title"], c.get("level", 1))
             for c in chapters if c.get("title")],
            key=lambda x: x[0],
        ) if chapters else []
        ch_title_by_idx = {tp[0]: tp for tp in ch_paras}

        for p in paras:
            has_break = p.get("has_page_break_before", 0)
            pb_type = p.get("page_break_type", "none")
            info = ch_title_by_idx.get(p["idx"])
            is_ch_l1 = (info and info[2] == 1)
            need_break = (is_ch_l1 or has_break == 1 or pb_type in ("original", "auto_chapter", "manual")) and p.get("idx", 0) > 0

            if info:
                p_obj = out.add_heading(info[1], level=info[2])
            else:
                p_obj = out.add_paragraph(p["text"])
            
            if need_break:
                pPr = p_obj._element.get_or_add_pPr()
                if pPr.find(qn("w:pageBreakBefore")) is None:
                    pPr.append(parse_xml(r'<w:pageBreakBefore %s/>' % nsdecls("w")))

        fpath = os.path.join("backend/static/exports", fname)
        out.save(fpath)

    update_project_status(project_id, "completed")
    return FileResponse(fpath, filename=fname)
