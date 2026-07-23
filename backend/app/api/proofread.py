import asyncio
import json
import logging
import time

from fastapi import APIRouter
from pydantic import BaseModel
from app.core.proofer import proofread_window, build_proofread_system_prompt, build_proofread_user_text
from app.core.llm import LLMCallError
from app.core.database import (
    get_project, get_current_document,
    get_paragraphs_in_range, get_paragraphs_by_indices,
    get_paragraph_count, get_chapters,
    insert_error, insert_chapter, delete_errors_in_range,
    delete_errors_by_indices,
    delete_chapters_in_range, set_proofread_progress,
    get_document_progress, update_project_status,
    set_document_error, clear_document_error,
    insert_llm_log,
)
from app.utils.helpers import generate_id


logger = logging.getLogger(__name__)

router = APIRouter()
WINDOW_SIZE = 30

_RUNNING = set()


class ProofreadRequest(BaseModel):
    mode: str = "continue"
    model: str = "deepseek-v4-flash"
    types: list[str] | None = None
    chapter_id: str | None = None
    paragraph_indices: list[int] | None = None


@router.post("/projects/{project_id}/proofread")
async def start_proofread(project_id: str, req: ProofreadRequest):
    """对项目当前版本执行校对（后台异步执行，前端轮询 progress 查看进度）。"""
    project = get_project(project_id)
    if not project:
        return {"error": "项目不存在"}

    doc = get_current_document(project_id)
    if not doc:
        return {"error": "项目尚未上传文档"}

    doc_id = doc["id"]
    total = get_paragraph_count(doc_id)
    if total == 0:
        return {"error": "文档暂无段落，请重新上传"}

    if req.mode not in ("continue", "chapter", "selection"):
        return {"error": f"未知模式：{req.mode}"}

    if req.mode == "selection":
        if not req.paragraph_indices or len(req.paragraph_indices) == 0:
            return {"error": "selection 模式需提供 paragraph_indices"}
        req.paragraph_indices = sorted(set(req.paragraph_indices))
        for idx in req.paragraph_indices:
            if idx < 0 or idx >= total:
                return {"error": f"段落编号 {idx} 超出范围 (0-{total - 1})"}

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


def _fix_error_paragraph(e: dict, window_paras: list[tuple[int, str]]) -> bool:
    """校验 error 的 paragraph_index 是否匹配 original_text，不匹配时在本窗口内重找。"""
    orig = e.get("original_text", "") or e.get("locator", "")
    if not orig:
        return True
    # 已精确匹配 → 不动
    for idx, text in window_paras:
        if idx == e["paragraph_index"] and orig in text:
            return True
    # 不匹配 → 在整个窗口内搜索能匹配的段落编号
    for idx, text in window_paras:
        if orig in text:
            logger.info("纠正错误段落编号: %s -> %s (text=%r)", e["paragraph_index"], idx, orig[:20])
            e["paragraph_index"] = idx
            return True
    logger.warning("丢弃无法匹配的错误: paragraph=%s text=%r", e["paragraph_index"], orig[:20])
    return False


async def _proofread_job(project_id: str, doc_id: str, req: ProofreadRequest):
    # 记录最后一次 proofread_window 的上下文，异常时写入日志
    _last_log_ctx: dict | None = None
    _last_t0: float | None = None
    _job_t0 = time.time()
    try:
        total = await asyncio.to_thread(get_paragraph_count, doc_id)
        progress = await asyncio.to_thread(get_document_progress, doc_id)
        # 不再全量读取所有段落，按各模式实际需要的范围查询

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
            # 只读当前窗口的 30 段，不读全文
            window_rows = await asyncio.to_thread(get_paragraphs_in_range, doc_id, ws, we)
            window_paras = [(p["idx"], p["text"]) for p in window_rows]
            found_chapters = 0
            if window_paras:
                system_prompt = build_proofread_system_prompt(types)
                user_text = build_proofread_user_text(window_paras)
                _last_log_ctx = dict(
                    model=req.model, mode=req.mode,
                    range_start=ws, range_end=we,
                    prompt=user_text, system_prompt=system_prompt,
                    selected_types=json.dumps(types, ensure_ascii=False),
                )
                logger.info("预处理完成 doc=%s window=%s-%s 耗时=%.1fs，等待LLM首token",
                            doc_id, ws, we, time.time() - _job_t0)
                _last_t0 = time.time()
                errs, chs, raw, token_info, parse_ok = await proofread_window(user_text, req.model, types, req.mode, system_prompt=system_prompt)
                duration = int((time.time() - _last_t0) * 1000)
                insert_llm_log(
                    generate_id(), project_id, doc_id,
                    **_last_log_ctx,
                    status="ok" if parse_ok else "parse_error",
                    duration_ms=duration, error_message=None if parse_ok else "JSON 解析失败",
                    response_raw=raw, errors_found=len(errs), chapters_found=len(chs),
                    **token_info,
                )
                _last_log_ctx = None
                if not parse_ok:
                    logger.warning("窗口 JSON 解析失败 doc=%s range=%s-%s raw_preview=%r",
                                   doc_id, ws, we, (raw or "")[:100])
                else:
                    for e in errs:
                        if range_start <= e["paragraph_index"] < range_end:
                            if not _fix_error_paragraph(e, window_paras):
                                continue
                            e.pop("chapter_id", None)
                            logger.info("INSERT para=%s orig=%r sugg=%r", e["paragraph_index"], e["original_text"][:20], e["suggested_text"][:20])
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

        if req.mode == "selection":
            selected = set(req.paragraph_indices)
            types = req.types or progress["proofread_types"]
            update_project_status(project_id, "proofreading")
            delete_errors_by_indices(doc_id, req.paragraph_indices)
            found_errors = 0
            for ws in range(0, len(req.paragraph_indices), WINDOW_SIZE):
                batch = req.paragraph_indices[ws:ws + WINDOW_SIZE]
                # 只查询这一批选中的段落，不读全文
                batch_rows = await asyncio.to_thread(get_paragraphs_by_indices, doc_id, batch)
                window_paras = [(p["idx"], p["text"]) for p in batch_rows]
                if not window_paras:
                    continue
                system_prompt = build_proofread_system_prompt(types)
                user_text = build_proofread_user_text(window_paras)
                _last_log_ctx = dict(
                    model=req.model, mode=req.mode,
                    range_start=min(batch), range_end=max(batch) + 1,
                    prompt=user_text, system_prompt=system_prompt,
                    selected_types=json.dumps(types, ensure_ascii=False),
                )
                _last_t0 = time.time()
                errs, chs, raw, token_info, parse_ok = await proofread_window(user_text, req.model, types, req.mode, system_prompt=system_prompt)
                duration = int((time.time() - _last_t0) * 1000)
                insert_llm_log(
                    generate_id(), project_id, doc_id,
                    **_last_log_ctx,
                    status="ok" if parse_ok else "parse_error",
                    duration_ms=duration, error_message=None if parse_ok else "JSON 解析失败",
                    response_raw=raw, errors_found=len(errs), chapters_found=len(chs),
                    **token_info,
                )
                _last_log_ctx = None
                if parse_ok:
                    for e in errs:
                        if e["paragraph_index"] not in selected:
                            continue
                        if not _fix_error_paragraph(e, window_paras):
                            continue
                        e.pop("chapter_id", None)
                        logger.info("INSERT para=%s orig=%r sugg=%r", e["paragraph_index"], e["original_text"][:20], e["suggested_text"][:20])
                        insert_error(doc_id, e)
                        found_errors += 1
            clear_document_error(doc_id)
            update_project_status(project_id, "reviewing")
            logger.info("选中段校对完成 doc=%s indices=%s errors=%s",
                        doc_id, req.paragraph_indices, found_errors)
            return

        ch = next((c for c in get_chapters(doc_id) if c["id"] == req.chapter_id), None)
        range_start, range_end = ch["start_idx"], ch["end_idx"]
        types = req.types or progress["proofread_types"]
        delete_errors_in_range(doc_id, range_start, range_end)
        delete_chapters_in_range(doc_id, range_start, range_end)
        sort_base = len(get_chapters(doc_id))
        update_project_status(project_id, "proofreading")
        # 只读整个章节范围内的段落，不读全文
        chapter_rows = await asyncio.to_thread(get_paragraphs_in_range, doc_id, range_start, range_end)
        chapter_text_by_idx = {p["idx"]: p["text"] for p in chapter_rows}
        found_errors = 0
        found_chapters = 0
        max_processed = range_start
        for ws in range(range_start, range_end, WINDOW_SIZE):
            we = min(ws + WINDOW_SIZE, range_end)
            window_paras = [(i, chapter_text_by_idx[i]) for i in range(ws, we) if i in chapter_text_by_idx]
            if not window_paras:
                continue
            system_prompt = build_proofread_system_prompt(types)
            user_text = build_proofread_user_text(window_paras)
            _last_log_ctx = dict(
                model=req.model, mode=req.mode,
                range_start=ws, range_end=we,
                prompt=user_text, system_prompt=system_prompt,
                selected_types=json.dumps(types, ensure_ascii=False),
            )
            _last_t0 = time.time()
            errs, chs, raw, token_info, parse_ok = await proofread_window(user_text, req.model, types, req.mode, system_prompt=system_prompt)
            duration = int((time.time() - _last_t0) * 1000)
            insert_llm_log(
                generate_id(), project_id, doc_id,
                **_last_log_ctx,
                status="ok" if parse_ok else "parse_error",
                duration_ms=duration, error_message=None if parse_ok else "JSON 解析失败",
                response_raw=raw, errors_found=len(errs), chapters_found=len(chs),
                **token_info,
            )
            _last_log_ctx = None
            if parse_ok:
                for e in errs:
                    if range_start <= e["paragraph_index"] < range_end:
                        if not _fix_error_paragraph(e, window_paras):
                            continue
                        e.pop("chapter_id", None)
                        logger.info("INSERT para=%s orig=%r sugg=%r", e["paragraph_index"], e["original_text"][:20], e["suggested_text"][:20])
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
        # 记录失败的 LLM 调用
        if _last_log_ctx is not None and _last_t0 is not None:
            duration = int((time.time() - _last_t0) * 1000)
            insert_llm_log(
                generate_id(), project_id, doc_id,
                **_last_log_ctx,
                status="error", duration_ms=duration, error_message=str(e),
                response_raw=None, errors_found=0, chapters_found=0,
            )
        # 保存已完成的进度，状态置 reviewing，记录错误供前端提示，允许稍后重试
        try:
            new_upto = get_document_progress(doc_id)["proofread_upto"]
            set_proofread_progress(doc_id, new_upto)
            update_project_status(project_id, "reviewing")
            set_document_error(doc_id, str(e))
        except Exception:
            pass
        logger.warning("校对中断(模型错误) doc=%s: %s", doc_id, e)
    except Exception as e:
        logger.exception("校对任务异常 doc=%s: %s", doc_id, e)
        try:
            new_upto = get_document_progress(doc_id)["proofread_upto"]
            set_proofread_progress(doc_id, new_upto)
            update_project_status(project_id, "reviewing")
            set_document_error(doc_id, f"校对异常：{e}")
        except Exception:
            pass
    finally:
        _RUNNING.discard(doc_id)
