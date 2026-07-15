import asyncio
import logging

from fastapi import APIRouter
from pydantic import BaseModel
from app.core.proofer import proofread_window, build_proofread_prompt
from app.core.llm import LLMCallError
from app.core.database import (
    get_project, get_current_document,
    get_paragraphs, get_paragraph_count, get_chapters,
    insert_error, insert_chapter, delete_errors_in_range,
    delete_chapters_in_range, set_proofread_progress,
    get_document_progress, update_project_status,
    set_document_error, clear_document_error,
)
from app.utils.helpers import generate_id
from config import is_agentic_model

logger = logging.getLogger(__name__)

router = APIRouter()
WINDOW_SIZE = 30

_RUNNING = set()


class ProofreadRequest(BaseModel):
    mode: str = "continue"
    model: str = "deepseek-v4-flash"
    types: list[str] | None = None
    chapter_id: str | None = None


@router.post("/projects/{project_id}/proofread")
async def start_proofread(project_id: str, req: ProofreadRequest):
    """对项目当前版本执行校对（后台异步执行，前端轮询 progress 查看进度）。"""
    project = get_project(project_id)
    if not project:
        return {"error": "项目不存在"}

    doc = get_current_document(project_id)
    if not doc:
        return {"error": "项目尚未上传文档"}

    if is_agentic_model(req.model):
        return {"error": "编程模型（如 Kimi Code）不适合校对，请选择对话模型（DeepSeek / Kimi K2.6 等）"}

    doc_id = doc["id"]
    total = get_paragraph_count(doc_id)
    if total == 0:
        return {"error": "文档暂无段落，请重新上传"}

    if req.mode not in ("continue", "chapter"):
        return {"error": f"未知模式：{req.mode}"}

    progress = get_document_progress(doc_id)
    if req.mode == "continue" and progress["proofread_upto"] >= total:
        return {"status": "skipped", "message": "已校对至文末，无可继续段落",
                "proofread_upto": progress["proofread_upto"], "total": total}

    if req.mode == "chapter" and not req.chapter_id:
        return {"error": "chapter 模式需提供 chapter_id"}
    if req.mode == "chapter":
        ch = next((c for c in get_chapters(doc_id) if c["id"] == req.chapter_id), None)
        if not ch:
            return {"error": "章节不存在，可能尚未校对出章节结构"}

    if doc_id in _RUNNING:
        return {"status": "running", "message": "该校对任务正在进行中，请稍候查看进度"}

    _RUNNING.add(doc_id)
    asyncio.create_task(_proofread_job(project_id, doc_id, req))
    return {"status": "started", "message": "校对已在后台开始，请在详情页查看进度"}


async def _proofread_job(project_id: str, doc_id: str, req: ProofreadRequest):
    try:
        total = get_paragraph_count(doc_id)
        progress = get_document_progress(doc_id)
        paragraphs = get_paragraphs(doc_id)
        text_by_idx = {p["idx"]: p["text"] for p in paragraphs}

        if req.mode == "continue":
            # 只处理「下一个窗口」（WINDOW_SIZE 段），发完即停；等用户手动点「继续校对」再发下一批
            range_start = progress["proofread_upto"]
            range_end = total
            types = req.types or progress["proofread_types"]
            update_project_status(project_id, "proofreading")
            delete_errors_in_range(doc_id, range_start, total)
            delete_chapters_in_range(doc_id, range_start, total)
            sort_base = len(get_chapters(doc_id))
            ws = range_start
            we = min(ws + WINDOW_SIZE, range_end)
            window_paras = [(i, text_by_idx[i]) for i in range(ws, we) if i in text_by_idx]
            found_chapters = 0
            if window_paras:
                prompt = build_proofread_prompt(window_paras, types)
                errs, chs = await proofread_window(prompt, req.model, types, req.mode)
                for e in errs:
                    if range_start <= e["paragraph_index"] < range_end:
                        e.pop("chapter_id", None)
                        insert_error(doc_id, e)
                for c in chs:
                    tip = c["title_paragraph_idx"]
                    if tip is None or not (range_start <= tip < range_end):
                        continue
                    insert_chapter(
                        generate_id(), doc_id, c["title"], tip, c["level"],
                        c["parent_idx"], c["start_idx"] or range_start,
                        c["end_idx"] or range_end, sort_base + found_chapters,
                    )
                    found_chapters += 1
            set_proofread_progress(doc_id, we, req.types)
            clear_document_error(doc_id)
            update_project_status(project_id, "reviewing")
            logger.info("继续校对(单窗口) doc=%s window=%s-%s upto=%s/%s",
                        doc_id, ws, we, we, total)
            return

        # chapter 模式：将该章节内所有窗口一次性处理完
        ch = next((c for c in get_chapters(doc_id) if c["id"] == req.chapter_id), None)
        range_start, range_end = ch["start_idx"], ch["end_idx"]
        types = req.types or progress["proofread_types"]
        delete_errors_in_range(doc_id, range_start, range_end)
        delete_chapters_in_range(doc_id, range_start, range_end)
        sort_base = len(get_chapters(doc_id))
        update_project_status(project_id, "proofreading")
        found_errors = 0
        found_chapters = 0
        max_processed = range_start
        for ws in range(range_start, range_end, WINDOW_SIZE):
            we = min(ws + WINDOW_SIZE, range_end)
            window_paras = [(i, text_by_idx[i]) for i in range(ws, we) if i in text_by_idx]
            if not window_paras:
                continue
            prompt = build_proofread_prompt(window_paras, types)
            errs, chs = await proofread_window(prompt, req.model, types, req.mode)
            for e in errs:
                if range_start <= e["paragraph_index"] < range_end:
                    e.pop("chapter_id", None)
                    insert_error(doc_id, e)
                    found_errors += 1
            for c in chs:
                tip = c["title_paragraph_idx"]
                if tip is None or not (range_start <= tip < range_end):
                    continue
                insert_chapter(
                    generate_id(), doc_id, c["title"], tip, c["level"],
                    c["parent_idx"], c["start_idx"] or range_start,
                    c["end_idx"] or range_end, sort_base + found_chapters,
                )
                found_chapters += 1
            max_processed = max(max_processed, we)
            set_proofread_progress(doc_id, max_processed)
        new_upto = max(progress["proofread_upto"], range_end)
        set_proofread_progress(doc_id, new_upto, req.types)
        clear_document_error(doc_id)
        update_project_status(project_id, "reviewing")
        logger.info("章节校对完成 doc=%s chapter=%s errors=%s chapters=%s upto=%s",
                    doc_id, req.chapter_id, found_errors, found_chapters, new_upto)
    except LLMCallError as e:
        # 保存已完成的进度，状态置 reviewing，记录错误供前端提示，允许稍后重试
        try:
            new_upto = get_document_progress(doc_id)["proofread_upto"]
            set_proofread_progress(doc_id, new_upto)
            update_project_status(project_id, "reviewing")
            set_document_error(doc_id, "模型调用失败，请检查「设置」页的 API Key 与网络后重试")
        except Exception:
            pass
        logger.warning("校对中断(模型错误) doc=%s: %s", doc_id, e)
    except Exception as e:
        logger.exception("校对任务异常 doc=%s: %s", doc_id, e)
        try:
            new_upto = get_document_progress(doc_id)["proofread_upto"]
            set_proofread_progress(doc_id, new_upto)
            update_project_status(project_id, "reviewing")
        except Exception:
            pass
    finally:
        _RUNNING.discard(doc_id)
