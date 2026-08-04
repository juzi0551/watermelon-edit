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
    get_paragraph_count, get_chapters, get_paragraph_content,
    insert_error, insert_chapter, delete_errors_in_range,
    delete_errors_by_indices,
    delete_chapters_in_range, set_proofread_progress,
    get_document_progress, update_project_status,
    set_document_error, clear_document_error,
    insert_llm_log, get_setting,
    # batch 模式专用
    create_batch, get_batch, get_batch_windows, update_batch_window,
    finish_batch, batch_insert_errors, batch_insert_chapters,
    merge_and_save_chapters, resolve_paragraph_uuid,
)
from app.utils.helpers import generate_id


logger = logging.getLogger(__name__)

router = APIRouter()
WINDOW_SIZE = 30


def get_max_concurrent() -> int:
    try:
        val = int(get_setting("batch_max_concurrent", "2"))
        return max(1, min(val, 20))
    except (ValueError, TypeError):
        return 2


def get_window_size() -> int:
    try:
        val = int(get_setting("proofread_window_size", "30"))
        return max(5, min(val, 500))
    except (ValueError, TypeError):
        return 30


_RUNNING = set()


class ProofreadRequest(BaseModel):
    mode: str = "continue"
    model: str = "deepseek-v4-flash"
    types: list[str] | None = None
    chapter_id: str | None = None
    paragraph_indices: list[int] | None = None
    batch_id: str | None = None  # batch 模式时由后端自动填充
    max_concurrent: int | None = None
    window_size: int | None = None


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

    if req.mode not in ("continue", "chapter", "selection", "batch"):
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

    # batch 模式：预先生成 batch_id (不需要入库，_proofread_job 里创建)
    if req.mode == "batch":
        progress_b = get_document_progress(doc_id)
        if progress_b["proofread_upto"] >= total:
            return {"status": "skipped", "message": "已校对至文末，无可继续段落",
                    "proofread_upto": progress_b["proofread_upto"], "total": total}
        req.batch_id = generate_id()

    _RUNNING.add(doc_id)
    asyncio.create_task(_proofread_job(project_id, doc_id, req))
    resp = {"status": "started", "message": "校对已在后台开始，请在详情页查看进度"}
    if req.mode == "batch":
        resp["batch_id"] = req.batch_id
    return resp


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
        window_size = req.window_size or get_window_size()
        # 不再全量读取所有段落，按各模式实际需要的范围查询

        if req.mode == "continue":
            # 只处理「下一个窗口」（window_size 段），发完即停；等用户手动点「继续校对」再发下一批
            range_start = progress["proofread_upto"]
            range_end = total
            types = req.types or progress["proofread_types"]
            update_project_status(project_id, "proofreading")
            delete_errors_in_range(doc_id, range_start, total)
            sort_base = len(get_chapters(doc_id))
            ws = range_start
            we = min(ws + window_size, range_end)
            # 只读当前窗口的 30 段，不读全文
            window_rows = await asyncio.to_thread(get_paragraphs_in_range, doc_id, ws, we)
            window_paras = [(p["idx"], get_paragraph_content(p)) for p in window_rows]
            found_chapters = 0
            if window_paras:
                system_prompt = build_proofread_system_prompt(types, project_id=project_id, current_paragraph_idx=ws)
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
                errs, chs, raw, token_info, parse_ok = await proofread_window(user_text, req.model, types, req.mode, system_prompt=system_prompt, project_id=project_id, window_first_idx=ws, document_id=doc_id)
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
                    set_document_error(doc_id, "大模型响应 JSON 解析失败，已保留待校对状态")
                    update_project_status(project_id, "reviewing")
                    return

                for e in errs:
                    if range_start <= e["paragraph_index"] < range_end:
                        if not _fix_error_paragraph(e, window_paras):
                            continue
                        e["paragraph_uuid"] = resolve_paragraph_uuid(doc_id, e["paragraph_index"])
                        e.pop("chapter_id", None)
                        logger.info("INSERT para=%s orig=%r sugg=%r", e["paragraph_index"], e["original_text"][:20], e["suggested_text"][:20])
                        insert_error(doc_id, e)
                total_chs, new_chs = merge_and_save_chapters(doc_id, chs)
            set_proofread_progress(doc_id, we, req.types)
            if new_chs > 0:
                set_document_error(doc_id, f"校对完成：自动识别并新增 {new_chs} 个新章节标题")
            else:
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
            for ws in range(0, len(req.paragraph_indices), window_size):
                batch = req.paragraph_indices[ws:ws + window_size]
                # 只查询这一批选中的段落，不读全文
                batch_rows = await asyncio.to_thread(get_paragraphs_by_indices, doc_id, batch)
                window_paras = [(p["idx"], get_paragraph_content(p)) for p in batch_rows]
                if not window_paras:
                    continue
                system_prompt = build_proofread_system_prompt(types, project_id=project_id, current_paragraph_idx=min(batch))
                user_text = build_proofread_user_text(window_paras)
                _last_log_ctx = dict(
                    model=req.model, mode=req.mode,
                    range_start=min(batch), range_end=max(batch) + 1,
                    prompt=user_text, system_prompt=system_prompt,
                    selected_types=json.dumps(types, ensure_ascii=False),
                )
                _last_t0 = time.time()
                errs, chs, raw, token_info, parse_ok = await proofread_window(user_text, req.model, types, req.mode, system_prompt=system_prompt, project_id=project_id, window_first_idx=min(batch), document_id=doc_id)
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
                        e["paragraph_uuid"] = resolve_paragraph_uuid(doc_id, e["paragraph_index"])
                        e.pop("chapter_id", None)
                        logger.info("INSERT para=%s orig=%r sugg=%r", e["paragraph_index"], e["original_text"][:20], e["suggested_text"][:20])
                        insert_error(doc_id, e)
                        found_errors += 1
            clear_document_error(doc_id)
            update_project_status(project_id, "reviewing")
            logger.info("选中段校对完成 doc=%s indices=%s errors=%s",
                        doc_id, req.paragraph_indices, found_errors)
            return

        if req.mode == "chapter":
            ch = next((c for c in get_chapters(doc_id) if c["id"] == req.chapter_id), None)
            if not ch:
                update_project_status(project_id, "reviewing")
                return
            range_start, range_end = ch["start_idx"], ch["end_idx"]
            types = req.types or progress["proofread_types"]
            delete_errors_in_range(doc_id, range_start, range_end)
            update_project_status(project_id, "proofreading")
            chapter_rows = await asyncio.to_thread(get_paragraphs_in_range, doc_id, range_start, range_end)
            chapter_text_by_idx = {p["idx"]: get_paragraph_content(p) for p in chapter_rows}
            found_errors = 0
            new_chapters_total = 0
            max_processed = range_start
            for ws in range(range_start, range_end, window_size):
                we = min(ws + window_size, range_end)
                window_paras = [(i, chapter_text_by_idx[i]) for i in range(ws, we) if i in chapter_text_by_idx]
                if not window_paras:
                    continue
                system_prompt = build_proofread_system_prompt(types, project_id=project_id, current_paragraph_idx=ws)
                user_text = build_proofread_user_text(window_paras)
                _last_log_ctx = dict(
                    model=req.model, mode=req.mode,
                    range_start=ws, range_end=we,
                    prompt=user_text, system_prompt=system_prompt,
                    selected_types=json.dumps(types, ensure_ascii=False),
                )
                _last_t0 = time.time()
                errs, chs, raw, token_info, parse_ok = await proofread_window(user_text, req.model, types, req.mode, system_prompt=system_prompt, project_id=project_id, window_first_idx=ws, document_id=doc_id)
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
                            e["paragraph_uuid"] = resolve_paragraph_uuid(doc_id, e["paragraph_index"])
                            e.pop("chapter_id", None)
                            logger.info("INSERT para=%s orig=%r sugg=%r", e["paragraph_index"], e["original_text"][:20], e["suggested_text"][:20])
                            insert_error(doc_id, e)
                            found_errors += 1
                    _, new_chs = merge_and_save_chapters(doc_id, chs)
                    new_chapters_total += new_chs
                max_processed = max(max_processed, we)
                set_proofread_progress(doc_id, max_processed)
            new_upto = max(progress["proofread_upto"], range_end)
            set_proofread_progress(doc_id, new_upto, req.types)
            if new_chapters_total > 0:
                set_document_error(doc_id, f"章节校对完成：自动识别并新增 {new_chapters_total} 个新章节标题")
            else:
                clear_document_error(doc_id)
            update_project_status(project_id, "reviewing")
            logger.info("章节校对完成 doc=%s chapter=%s errors=%s chapters=%s upto=%s",
                        doc_id, req.chapter_id, found_errors, found_chapters, new_upto)
            return

        # ── batch 模式：并行执行可配置的并发窗口 ─────────────────
        if req.mode == "batch":
            max_concurrent = req.max_concurrent or get_max_concurrent()
            batch_id = req.batch_id
            progress = await asyncio.to_thread(get_document_progress, doc_id)
            types = req.types or progress["proofread_types"]
            range_start = progress["proofread_upto"]

            windows: list[tuple[int, int]] = []
            ws = range_start
            while ws < total and len(windows) < max_concurrent:
                we = min(ws + window_size, total)
                windows.append((ws, we))
                ws = we

            if not windows:
                update_project_status(project_id, "reviewing")
                return

            range_end = windows[-1][1]
            await asyncio.to_thread(
                create_batch, batch_id, doc_id, range_start, range_end, windows
            )
            await asyncio.to_thread(delete_errors_in_range, doc_id, range_start, range_end)
            update_project_status(project_id, "proofreading")

            semaphore = asyncio.Semaphore(max_concurrent)

            async def _run_window(win_idx: int, ws: int, we: int):
                async with semaphore:
                    window_rows = await asyncio.to_thread(
                        get_paragraphs_in_range, doc_id, ws, we
                    )
                    window_paras = [(p["idx"], get_paragraph_content(p)) for p in window_rows]
                    if not window_paras:
                        return [], []
                    system_prompt = build_proofread_system_prompt(types, project_id=project_id, current_paragraph_idx=ws)
                    user_text = build_proofread_user_text(window_paras)
                    log_ctx = dict(
                        model=req.model, mode="batch",
                        range_start=ws, range_end=we,
                        prompt=user_text, system_prompt=system_prompt,
                        selected_types=json.dumps(types, ensure_ascii=False),
                    )
                    t0 = time.time()
                    errs, chs, raw, token_info, parse_ok = await proofread_window(
                        user_text, req.model, types, "batch", system_prompt=system_prompt, project_id=project_id, window_first_idx=ws, document_id=doc_id
                    )
                    duration = int((time.time() - t0) * 1000)
                    insert_llm_log(
                        generate_id(), project_id, doc_id,
                        **log_ctx,
                        status="ok" if parse_ok else "parse_error",
                        duration_ms=duration,
                        error_message=None if parse_ok else "JSON 解析失败",
                        response_raw=raw, errors_found=len(errs), chapters_found=len(chs),
                        **token_info,
                    )
                    if not parse_ok:
                        raise ValueError(f"JSON 解析失败 window={ws}-{we}")
                    valid_errs = []
                    for e in errs:
                        if ws <= e["paragraph_index"] < we:
                            if _fix_error_paragraph(e, window_paras):
                                e["paragraph_uuid"] = resolve_paragraph_uuid(doc_id, e["paragraph_index"])
                                e.pop("chapter_id", None)
                                valid_errs.append(e)
                    valid_chs = [
                        c for c in chs
                        if c["title_paragraph_idx"] is not None
                        and ws <= c["title_paragraph_idx"] < we
                    ]
                    return valid_errs, valid_chs

            tasks = [_run_window(i, ws, we) for i, (ws, we) in enumerate(windows)]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            all_errors: list[dict] = []
            all_chapters: list[dict] = []
            done_count = 0
            failed_count = 0
            for i, result in enumerate(results):
                ws_i, we_i = windows[i]
                if isinstance(result, Exception):
                    failed_count += 1
                    await asyncio.to_thread(
                        update_batch_window, batch_id, i, "failed", str(result)
                    )
                    logger.warning("batch window 失败 doc=%s idx=%d range=%d-%d err=%s",
                                   doc_id, i, ws_i, we_i, result)
                else:
                    done_count += 1
                    errs_i, chs_i = result
                    all_errors.extend(errs_i)
                    all_chapters.extend(chs_i)
                    await asyncio.to_thread(update_batch_window, batch_id, i, "ok")

            await asyncio.to_thread(batch_insert_errors, doc_id, all_errors)
            _, new_chs = await asyncio.to_thread(merge_and_save_chapters, doc_id, all_chapters)
            await asyncio.to_thread(finish_batch, batch_id, done_count, failed_count)
            if failed_count > 0:
                first_failed_ws = min(windows[i][0] for i, res in enumerate(results) if isinstance(res, Exception))
                set_proofread_progress(doc_id, first_failed_ws, req.types)
                set_document_error(doc_id, f"批量校对有 {failed_count} 个窗口解析失败，已保留未校对状态")
            else:
                set_proofread_progress(doc_id, range_end, req.types)
                if new_chs > 0:
                    set_document_error(doc_id, f"批量校对完成：自动识别并新增 {new_chs} 个新章节标题")
                else:
                    clear_document_error(doc_id)
            update_project_status(project_id, "reviewing")
            logger.info(
                "批量校对完成 doc=%s range=%d-%d done=%d failed=%d errors=%d",
                doc_id, range_start, range_end, done_count, failed_count, len(all_errors),
            )
            return

    except LLMCallError as e:
        if _last_log_ctx is not None and _last_t0 is not None:
            duration = int((time.time() - _last_t0) * 1000)
            insert_llm_log(
                generate_id(), project_id, doc_id,
                **_last_log_ctx,
                status="error", duration_ms=duration, error_message=str(e),
                response_raw=None, errors_found=0, chapters_found=0,
            )
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


# ── 批量校对进度查询 ─────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/proofread/batch/{batch_id}")
async def get_batch_status(project_id: str, batch_id: str):
    """查询某次批量校对的进度（前端轮询窗口级状态用）。"""
    batch = get_batch(batch_id)
    if not batch:
        return {"error": "batch 不存在"}
    windows = get_batch_windows(batch_id)
    return {
        "batch_id": batch_id,
        "status": batch["status"],
        "range_start": batch["range_start"],
        "range_end": batch["range_end"],
        "total_windows": batch["total_windows"],
        "done_windows": batch["done_windows"],
        "failed_windows": batch["failed_windows"],
        "windows": [
            {
                "window_index": w["window_index"],
                "range_start": w["range_start"],
                "range_end": w["range_end"],
                "status": w["status"],
                "error_message": w["error_message"],
                "retry_count": w["retry_count"],
            }
            for w in windows
        ],
    }


# ── 失败窗口重试 ─────────────────────────────────────────────────────────────

class RetryWindowRequest(BaseModel):
    batch_id: str
    window_index: int
    model: str = "deepseek-v4-flash"
    types: list[str] | None = None


@router.post("/projects/{project_id}/proofread/retry-window")
async def retry_window(project_id: str, req: RetryWindowRequest):
    """重试 batch 中某个失败的 window。"""
    project = get_project(project_id)
    if not project:
        return {"error": "项目不存在"}

    doc = get_current_document(project_id)
    if not doc:
        return {"error": "项目尚未上传文档"}
    doc_id = doc["id"]

    if doc_id in _RUNNING:
        return {"error": "当前有校对任务正在进行，请等待完成后再重试"}

    batch = get_batch(req.batch_id)
    if not batch:
        return {"error": "batch 不存在"}
    if batch["document_id"] != doc_id:
        return {"error": "batch 不属于当前文档"}

    windows = get_batch_windows(req.batch_id)
    win = next((w for w in windows if w["window_index"] == req.window_index), None)
    if not win:
        return {"error": f"window_index {req.window_index} 不存在"}
    if win["status"] not in ("failed",):
        return {"error": f"该窗口状态为 {win['status']}，无需重试"}

    ws, we = win["range_start"], win["range_end"]
    types = req.types or json.loads(doc.get("proofread_types", '["typo","grammar","punctuation","format"]'))

    _RUNNING.add(doc_id)
    try:
        update_project_status(project_id, "proofreading")
        # 将 window 状态重置为 pending（+retry_count）
        update_batch_window(req.batch_id, req.window_index, "pending")

        window_rows = await asyncio.to_thread(get_paragraphs_in_range, doc_id, ws, we)
        window_paras = [(p["idx"], get_paragraph_content(p)) for p in window_rows]
        if not window_paras:
            update_batch_window(req.batch_id, req.window_index, "ok")
            all_wins = get_batch_windows(req.batch_id)
            done = sum(1 for w in all_wins if w["status"] == "ok")
            failed = sum(1 for w in all_wins if w["status"] == "failed")
            finish_batch(req.batch_id, done, failed)
            return {"status": "ok", "message": "窗口无段落，已标记为完成"}

        system_prompt = build_proofread_system_prompt(types, project_id=project_id, current_paragraph_idx=ws)
        user_text = build_proofread_user_text(window_paras)

        t0 = time.time()
        errs, chs, raw, token_info, parse_ok = await proofread_window(
            user_text, req.model, types, "batch", system_prompt=system_prompt, project_id=project_id, window_first_idx=ws, document_id=doc_id
        )
        duration = int((time.time() - t0) * 1000)
        insert_llm_log(
            generate_id(), project_id, doc_id,
            model=req.model, mode="batch_retry",
            range_start=ws, range_end=we,
            prompt=user_text, system_prompt=system_prompt,
            selected_types=json.dumps(types, ensure_ascii=False),
            status="ok" if parse_ok else "parse_error",
            duration_ms=duration,
            error_message=None if parse_ok else "JSON 解析失败",
            response_raw=raw, errors_found=len(errs), chapters_found=len(chs),
            **token_info,
        )

        if not parse_ok:
            update_batch_window(req.batch_id, req.window_index, "failed", "JSON 解析失败")
            update_project_status(project_id, "reviewing")
            return {"status": "error", "message": "模型返回格式异常，重试失败"}

        # 清理该 window 范围内的旧错误数据
        delete_errors_in_range(doc_id, ws, we)

        valid_errs = []
        for e in errs:
            if ws <= e["paragraph_index"] < we:
                if _fix_error_paragraph(e, window_paras):
                    e.pop("chapter_id", None)
                    valid_errs.append(e)
        valid_chs = [
            c for c in chs
            if c["title_paragraph_idx"] is not None
            and ws <= c["title_paragraph_idx"] < we
        ]

        batch_insert_errors(doc_id, valid_errs)
        merge_and_save_chapters(doc_id, valid_chs)
        update_batch_window(req.batch_id, req.window_index, "ok")

        # 重新汇总 batch 状态
        all_wins = get_batch_windows(req.batch_id)
        done = sum(1 for w in all_wins if w["status"] == "ok")
        failed = sum(1 for w in all_wins if w["status"] == "failed")
        finish_batch(req.batch_id, done, failed)

        update_project_status(project_id, "reviewing")
        logger.info("重试窗口成功 doc=%s batch=%s win=%d range=%d-%d errors=%d",
                    doc_id, req.batch_id, req.window_index, ws, we, len(valid_errs))
        return {
            "status": "ok",
            "message": f"重试成功，找到 {len(valid_errs)} 个问题",
            "errors_found": len(valid_errs),
        }
    except Exception as e:
        update_batch_window(req.batch_id, req.window_index, "failed", str(e))
        update_project_status(project_id, "reviewing")
        logger.exception("重试窗口异常 doc=%s batch=%s win=%d: %s",
                         doc_id, req.batch_id, req.window_index, e)
        return {"status": "error", "message": f"重试失败：{e}"}
    finally:
        _RUNNING.discard(doc_id)
