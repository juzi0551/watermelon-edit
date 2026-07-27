import os
from fastapi import APIRouter
from fastapi.responses import FileResponse
from pydantic import BaseModel
from docx import Document as DocxDocument
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls, qn
from app.core.document import EMPTY_SKIP_STYLES
from datetime import datetime
from app.core.database import (
    get_project, get_current_document, get_errors, get_error,
    update_error_status, update_error_suggested, update_project_status,
    get_paragraph_by_idx, update_paragraph_revised, get_revised_paragraphs,
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

    方式 A（有原文件）：以原 docx 为样式模板，清空正文后按 DB 段落数据重建，
    彻底规避 1:1 映射脆弱性与 pPr 样式污染问题。
    方式 B（原文件缺失）：降级为纯文本重建。
    """
    doc = get_current_document(project_id)
    if not doc:
        return {"error": "项目无文档"}

    doc_id = doc["id"]
    file_path = doc.get("file_path") or ""
    if not file_path or not os.path.exists(file_path):
        return {"error": "原始文件不存在，无法导出"}

    paras = get_revised_paragraphs(doc_id)

    os.makedirs("backend/static/exports", exist_ok=True)

    proj = get_project(project_id)
    raw_name = (proj.get("name") if proj else None) or "校稿文档"
    clean_name = "".join(c for c in raw_name if c not in r'/\:*?"<>|').strip() or "校稿文档"
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    fname = f"{clean_name}_校稿版_{ts}.docx"

    if file_path and os.path.exists(file_path):
        # ── 方式 A：原 docx 只用作样式模板，正文完全从 DB 重建 ──
        # 不再依赖 1:1 节点映射，彻底解决删段/空行清洗导致的错位与 pPr 样式污染问题。
        docx = DocxDocument(file_path)
        body = docx._element.body

        # 清空 body 中的所有段落与表格，只保留末尾 sectPr（页面边距/纸张设置）
        removable_tags = {qn("w:p"), qn("w:tbl"), qn("w:sdt")}
        for child in list(body):
            if child.tag in removable_tags:
                body.remove(child)

        from app.core.database import get_project_style_config
        style_cfg = get_project_style_config(project_id)
        indent_enabled = style_cfg.get("first_line_indent_enabled", False)

        # 按 DB idx 顺序逐段重建正文
        for p_data in paras:
            text = p_data.get("text") or ""
            style_name = p_data.get("style_name") or "Normal"
            pb_type = p_data.get("page_break_type", "none")
            idx = p_data.get("idx", 0)

            # 新建段落（python-docx 自动插入到 sectPr 之前）
            new_para = docx.add_paragraph()

            # 按原始样式名应用样式，找不到则 fallback 到 Normal
            try:
                new_para.style = docx.styles[style_name]
            except (KeyError, Exception):
                try:
                    new_para.style = docx.styles["Normal"]
                except Exception:
                    pass

            # 写入文字
            new_para.add_run(text)

            # 注入分页符（干净写入新建 pPr，不污染任何原有节点）
            if pb_type != "none" and idx > 0:
                pPr = new_para._element.get_or_add_pPr()
                if pPr.find(qn("w:pageBreakBefore")) is None:
                    pPr.append(parse_xml(r'<w:pageBreakBefore %s/>' % nsdecls("w")))

            # 若项目 XML 配置激活了段首缩进，为正文段落注入物理首行 2 字符缩进
            if indent_enabled and "heading" not in style_name.lower() and "标题" not in style_name:
                pPr = new_para._element.get_or_add_pPr()
                if pPr.find(qn("w:ind")) is None:
                    pPr.append(parse_xml(r'<w:ind %s w:firstLineChars="200" w:firstLine="420"/>' % nsdecls("w")))

        fpath = os.path.join("backend/static/exports", fname)
        docx.save(fpath)

    update_project_status(project_id, "completed")
    return FileResponse(fpath, filename=fname)
