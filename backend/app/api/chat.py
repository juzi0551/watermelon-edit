import json
import logging
import asyncio
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from app.core.database import (
    get_project, get_current_document, get_setting,
    create_chat_session, list_chat_sessions, get_chat_session,
    delete_chat_session, update_chat_session_title,
    insert_chat_message, list_chat_messages, get_paragraph_by_uuid
)
from app.core.chat import build_chat_context, stream_chat
from config import list_models, get_api_key

logger = logging.getLogger(__name__)

router = APIRouter()


def _build_replacement_card(
    parsed_args: dict,
    context_info: dict | None,
    current_para_idx: int | None,
    doc_id: str | None,
    authoritative_original: str = ""
) -> dict | None:
    if not isinstance(parsed_args, dict):
        return None

    target_para_uuid = (context_info and context_info.get("paragraph_uuid")) or parsed_args.get("paragraph_uuid")
    if not target_para_uuid and current_para_idx is not None and doc_id:
        from app.core.database import resolve_paragraph_uuid
        target_para_uuid = resolve_paragraph_uuid(doc_id, current_para_idx)

    if not target_para_uuid:
        return None

    target_para_idx = current_para_idx
    if target_para_uuid and doc_id:
        from app.core.database import resolve_paragraph_target
        resolved = resolve_paragraph_target(doc_id, target_para_uuid)
        if resolved and resolved.get("status") in ("deleted", "merged_then_deleted", "not_found"):
            return None
        if resolved and resolved.get("target_idx") is not None:
            target_para_idx = resolved["target_idx"]

    target_original = authoritative_original or parsed_args.get("original_text") or ""
    if target_para_uuid and target_original:
        return {
            "original": target_original,
            "replacement": parsed_args.get("replacement_text") or parsed_args.get("replacement") or "",
            "note": parsed_args.get("note") or "",
            "options": parsed_args.get("options") or [],
            "paragraph_idx": target_para_idx,
            "paragraph_uuid": target_para_uuid,
        }
    return None


class CreateSessionReq(BaseModel):
    title: str | None = "新对话"
    model: str | None = None


class ChatStreamContextReq(BaseModel):
    selected_text: str | None = None
    paragraph_idx: int | None = None
    paragraph_uuid: str | None = None
    paragraph_end_idx: int | None = None
    is_excerpt: bool | None = None
    formatted_excerpt: str | None = None


class ChatStreamReq(BaseModel):
    session_id: str | None = None
    model: str | None = None
    message: str = Field(..., min_length=1, description="提问内容不可为空")
    context: ChatStreamContextReq | None = None


def resolve_chat_model(requested_model: str | None) -> str:
    """按 传入模型 -> default_model -> proofread_model -> 首个真正配置了 Key 的模型 进行降级寻址。"""
    if requested_model and get_api_key(requested_model):
        return requested_model
    dm = get_setting("default_model") or get_setting("proofread_model")
    if dm and get_api_key(dm):
        return dm
    models = list_models()
    for m in models:
        mid = m.get("model_id")
        if mid and get_api_key(mid):
            return mid
    return requested_model or dm or "deepseek-v4-flash"


@router.get("/projects/{project_id}/chat/sessions")
async def api_list_chat_sessions(project_id: str):
    """获取项目的会话列表。"""
    project = get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return list_chat_sessions(project_id)


@router.post("/projects/{project_id}/chat/sessions")
async def api_create_chat_session(project_id: str, req: CreateSessionReq):
    """手动新建会话。"""
    project = get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    model_id = resolve_chat_model(req.model)
    session = create_chat_session(project_id, title=req.title or "新对话", model=model_id)
    return session


@router.delete("/projects/{project_id}/chat/sessions/{session_id}")
async def api_delete_chat_session(project_id: str, session_id: str):
    """删除会话及其所有历史消息。"""
    session = get_chat_session(session_id)
    if not session or session.get("project_id") != project_id:
        raise HTTPException(status_code=404, detail="会话不存在")
    success = delete_chat_session(session_id)
    return {"status": "ok", "deleted": success}


@router.get("/projects/{project_id}/chat/sessions/{session_id}/messages")
async def api_list_chat_messages(project_id: str, session_id: str):
    """获取指定会话的历史消息。"""
    session = get_chat_session(session_id)
    if not session or session.get("project_id") != project_id:
        raise HTTPException(status_code=404, detail="会话不存在")
    return list_chat_messages(session_id)


class UpdateCardStatusReq(BaseModel):
    status: str  # "accepted" | "rejected"


@router.patch("/projects/{project_id}/chat/messages/{message_id}/card_status")
async def api_update_card_status(project_id: str, message_id: str, req: UpdateCardStatusReq):
    """更新替换卡片的交互状态（已采纳 / 已拒绝），实现持久化与 F5 刷新保存。"""
    from app.core.database import update_chat_message_card_status
    res = update_chat_message_card_status(message_id, req.status)
    if not res:
        raise HTTPException(status_code=404, detail="消息不存在")
    return res


@router.post("/projects/{project_id}/chat/stream")
async def api_chat_stream(project_id: str, req: ChatStreamReq):
    """POST /projects/{project_id}/chat/stream SSE 流式对话接口（支持持久化与多轮上下文）。"""
    project = get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    model_id = resolve_chat_model(req.model)
    doc = get_current_document(project_id)
    if not doc:
        raise HTTPException(status_code=400, detail="项目缺少可用的文档")

    doc_id = doc["id"]

    # 1. 会话处理（已有或自动创建）
    session_id = req.session_id
    session = None
    if session_id:
        session = get_chat_session(session_id)

    if not session:
        session = create_chat_session(project_id, title="新对话", model=model_id)
        session_id = session["id"]

    # 2. 上下文提取（优先 UUID 精确锚定）
    context_info = None
    current_para_idx = None
    if req.context:
        if req.context.paragraph_uuid:
            para = get_paragraph_by_uuid(doc_id, req.context.paragraph_uuid)
            if para and para.get("idx") is not None:
                current_para_idx = para["idx"]
        if current_para_idx is None and req.context.paragraph_idx is not None:
            current_para_idx = req.context.paragraph_idx

    if req.context and current_para_idx is not None:
        try:
            context_chars = int(get_setting("chat_context_chars", "200") or "200")
        except (ValueError, TypeError):
            context_chars = 200

        try:
            context_info = build_chat_context(
                document_id=doc_id,
                para_idx=current_para_idx,
                selected_text=req.context.selected_text or "",
                para_end_idx=req.context.paragraph_end_idx,
                context_chars=context_chars,
            )
            if isinstance(context_info, dict):
                if getattr(req.context, "is_excerpt", None) is not None:
                    context_info["is_excerpt"] = req.context.is_excerpt
                if getattr(req.context, "formatted_excerpt", None):
                    context_info["formatted_excerpt"] = req.context.formatted_excerpt
                if getattr(req.context, "paragraph_uuid", None):
                    context_info["paragraph_uuid"] = req.context.paragraph_uuid
                logger.info("Chat context built:\n%s", context_info.get("formatted_context"))
        except Exception as e:
            logger.warning(f"构建对话上下文失败: {e}")

    # 3. 保存用户消息
    insert_chat_message(
        session_id=session_id,
        role="user",
        content=req.message,
        context=context_info
    )

    # 4. 加载历史消息 (供多轮推理)
    history_msgs = list_chat_messages(session_id)

    async def event_generator():
        assistant_full_response = []
        assistant_thinking_response = []

        try:
            stream_gen = stream_chat(
                project_id=project_id,
                model_id=model_id,
                message=req.message,
                history_messages=history_msgs[:-1],
                context_info=context_info,
                current_para_idx=current_para_idx,
                session_id=session_id,
            ).__aiter__()

            next_task = asyncio.create_task(stream_gen.__anext__())

            while True:
                done, pending = await asyncio.wait([next_task], timeout=15.0)
                if done:
                    try:
                        event = next_task.result()
                        if event["type"] == "thinking" and event.get("text"):
                            assistant_thinking_response.append(event["text"])
                        elif event["type"] == "delta" and event.get("text"):
                            assistant_full_response.append(event["text"])
                        elif event["type"] == "done":
                            full_content = "".join(assistant_full_response) or event.get("response", "")
                            full_thinking = "".join(assistant_thinking_response) or event.get("thinking", "")

                            formatted_tool_calls = event.get("tool_calls") or []
                            replacement_card = None
                            authoritative_original = (context_info and context_info.get("selected_text")) or ""

                            if formatted_tool_calls:
                                for tc in formatted_tool_calls:
                                    fn = tc.get("function") or {}
                                    args_str = fn.get("arguments") or ""
                                    try:
                                        parsed_args = json.loads(args_str)
                                        card = _build_replacement_card(parsed_args, context_info, current_para_idx, doc_id, authoritative_original)
                                        if card:
                                            replacement_card = card
                                    except Exception:
                                        pass

                            msg_context = {}
                            if full_thinking:
                                msg_context["thinking"] = full_thinking
                            if formatted_tool_calls:
                                msg_context["tool_calls"] = formatted_tool_calls
                            if replacement_card:
                                msg_context["replacement_card"] = replacement_card

                            saved_msg = insert_chat_message(
                                session_id=session_id,
                                role="assistant",
                                content=full_content,
                                context=msg_context if msg_context else None
                            )

                            # 如果产生了 tool_calls，自动补齐对应的 role: "tool" 消息记录维持多轮合法性
                            for tc in formatted_tool_calls:
                                tc_id = tc.get("id") or "call_default"
                                insert_chat_message(
                                    session_id=session_id,
                                    role="tool",
                                    content=json.dumps({"status": "pending_user_action"}, ensure_ascii=False),
                                    context={"tool_call_id": tc_id}
                                )

                            event["session_id"] = session_id
                            event["message_id"] = saved_msg["id"]
                            if replacement_card:
                                event["replacement_card"] = replacement_card

                            if session.get("title") == "新对话":
                                new_title = req.message[:20].strip()
                                if new_title:
                                    update_chat_session_title(session_id, new_title)

                        payload = json.dumps(event, ensure_ascii=False)
                        yield f"data: {payload}\n\n"
                        next_task = asyncio.create_task(stream_gen.__anext__())
                    except StopAsyncIteration:
                        break
                else:
                    # 15秒无 Token 增量时自动发送 SSE 心跳 (next_task 保持 pending，不被 cancel)
                    yield ": ping\n\n"
        except asyncio.CancelledError:
            logger.info("客户端连接已断开 (CancelledError in SSE chat stream)")
            if 'next_task' in locals() and not next_task.done():
                next_task.cancel()
                await asyncio.gather(next_task, return_exceptions=True)
            if assistant_full_response or assistant_thinking_response:
                partial_content = "".join(assistant_full_response)
                partial_thinking = "".join(assistant_thinking_response)
                msg_ctx = {"interrupted": True}
                if partial_thinking:
                    msg_ctx["thinking"] = partial_thinking
                insert_chat_message(session_id=session_id, role="assistant", content=partial_content, context=msg_ctx)
            raise
        except Exception as e:
            logger.error(f"Chat stream 发生未捕获异常: {e}", exc_info=True)
            err_payload = json.dumps({"type": "error", "error": str(e)}, ensure_ascii=False)
            yield f"data: {err_payload}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
