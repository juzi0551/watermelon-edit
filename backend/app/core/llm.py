import os
import litellm
import time
import datetime
import asyncio
import logging
from collections import deque
from typing import AsyncIterator
from config import get_api_key, get_account_id, _provider_of, _litellm_model, _api_base, _model_extra_kwargs
from app.core.database import get_setting


logger = logging.getLogger(__name__)


class LLMCallError(Exception):
    """大模型调用失败（缺 Key / 超时 / 返回异常等）。由调用方捕获并转为 HTTP 错误。"""


# 内存环形缓冲：记录最近 N 次大模型调用，供调试面板查看（重启后清空）
LLM_CALL_LOG = deque(maxlen=50)


def _record_llm_call(entry: dict):
    LLM_CALL_LOG.append(entry)


_TEST_PROMPT = "只回复一个字：好"


_DEFAULT_SYSTEM_PROMPT_HARDCODED = "你是一个专业的小说校对编辑。请严格以JSON格式返回结果。"


async def stream_llm(
    prompt: str | None = None,
    model_id: str = "",
    timeout: int = 120,
    tag: str = "",
    system_prompt: str | None = None,
    messages: list[dict] | None = None,
    tools: list[dict] | None = None,
) -> AsyncIterator[dict]:
    """逐 chunk yield {"type": "thinking"|"delta"|"done"|"error", "text": str, ...}。

    支持传入 messages 多轮列表，或传入 prompt (+ system_prompt) 自动构造单轮请求。
    全量更新 LLM_CALL_LOG 供调试面板监控。
    """
    api_key = get_api_key(model_id)
    if not api_key:
        err_msg = f"未配置 {model_id} 的 API Key，请到「设置」页面添加"
        yield {"type": "error", "error": err_msg}
        return

    _pid = _provider_of(model_id)
    _old_acct = None
    if _pid == "cloudflare":
        _old_acct = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
        acct_id = get_account_id("cloudflare")
        if acct_id:
            os.environ["CLOUDFLARE_ACCOUNT_ID"] = acct_id

    if messages is not None:
        req_messages = list(messages)
    else:
        req_messages = []
        if system_prompt is not None:
            if system_prompt:
                req_messages.append({"role": "system", "content": system_prompt})
        else:
            sp = get_setting("system_prompt_proofread", _DEFAULT_SYSTEM_PROMPT_HARDCODED)
            if sp:
                req_messages.append({"role": "system", "content": sp})
        req_messages.append({"role": "user", "content": prompt or ""})

    logged_sp = system_prompt
    if logged_sp is None and req_messages:
        sys_m = next((m for m in req_messages if m.get("role") == "system"), None)
        if sys_m:
            logged_sp = sys_m.get("content")

    user_prompt_str = prompt
    if user_prompt_str is None and req_messages:
        last_user = next((m for m in reversed(req_messages) if m.get("role") == "user"), None)
        if last_user:
            user_prompt_str = last_user.get("content")

    entry = {
        "ts": datetime.datetime.now().isoformat(timespec="seconds"),
        "model": model_id,
        "tag": tag,
        "prompt_len": len(user_prompt_str or "") if user_prompt_str else sum(len(m.get("content", "")) for m in req_messages),
        "prompt": user_prompt_str or "",
        "system_prompt": logged_sp,
        "status": "running",
        "duration_ms": 0,
        "response": None,
        "thinking": "",
        "thinking_status": "idle",  # idle | thinking | done
        "error": None,
    }
    _record_llm_call(entry)
    t0 = time.time()
    try:
        kwargs = dict(
            model=_litellm_model(model_id),
            api_key=api_key,
            messages=req_messages,
            timeout=timeout,
            stream=True,
            drop_params=True,  # 自动丢弃不支持的参数
        )
        if tools:
            kwargs["tools"] = tools
        api_base = _api_base(model_id)
        if api_base:
            kwargs["api_base"] = api_base
        extra = _model_extra_kwargs(model_id)
        if extra:
            kwargs.update(extra)

        t_prefill = time.time()
        response = await litellm.acompletion(**kwargs)
        t_prefill_done = time.time()
        logger.info("TTFT_DEBUG: litellm.acompletion() returned in %.1fs (model=%s)", t_prefill_done - t_prefill, model_id)

        content = ""
        token_info = {
            "prompt_tokens": None,
            "completion_tokens": None,
            "total_tokens": None,
            "cost": None,
        }
        got_content = False
        got_first_chunk = False
        got_first_content = False

        try:
            async for chunk in response:
                if not got_first_chunk:
                    logger.info("TTFT_DEBUG: first_chunk=%.1fs (model=%s)", time.time() - t_prefill, model_id)
                    got_first_chunk = True
                got_content = True
                delta = chunk.choices[0].delta if chunk.choices else None
                if delta:
                    rc = getattr(delta, "reasoning_content", None)
                    if rc:
                        entry["thinking"] = (entry["thinking"] or "") + rc
                        entry["thinking_status"] = "thinking"
                        yield {"type": "thinking", "text": rc}

                    tool_calls = getattr(delta, "tool_calls", None)
                    if tool_calls:
                        for tc in tool_calls:
                            fn = getattr(tc, "function", None)
                            yield {
                                "type": "tool_call",
                                "id": getattr(tc, "id", None),
                                "function_name": getattr(fn, "name", None) if fn else None,
                                "arguments": getattr(fn, "arguments", None) if fn else None,
                            }

                    if delta.content:
                        if not got_first_content:
                            logger.info("TTFT_DEBUG: first_content=%.1fs (model=%s)", time.time() - t_prefill, model_id)
                            got_first_content = True
                            if entry["thinking_status"] == "thinking":
                                entry["thinking_status"] = "done"
                        content += delta.content
                        entry["response"] = content
                        yield {"type": "delta", "text": delta.content}

                usage = getattr(chunk, "usage", None)
                if usage:
                    token_info = {
                        "prompt_tokens": getattr(usage, "prompt_tokens", None),
                        "completion_tokens": getattr(usage, "completion_tokens", None),
                        "total_tokens": getattr(usage, "total_tokens", None),
                        "cost": getattr(chunk, "_cost", None),
                    }
        finally:
            if hasattr(response, "aclose") and callable(getattr(response, "aclose")):
                try:
                    await response.aclose()
                except Exception:
                    pass

        if not got_content:
            err_msg = "流式返回为空，模型可能未产生任何输出"
            entry.update({"status": "error", "duration_ms": int((time.time() - t0) * 1000), "error": err_msg})
            yield {"type": "error", "error": err_msg}
            return

        entry.update({
            "status": "ok",
            "duration_ms": int((time.time() - t0) * 1000),
            "response": content,
            "token_info": token_info,
            "thinking_status": "done" if entry["thinking_status"] == "thinking" else entry["thinking_status"],
        })
        yield {"type": "done", "usage": token_info, "response": content}

    except asyncio.TimeoutError:
        err_msg = f"流式超时：超过 {timeout} 秒未收到新数据，模型可能已停止输出"
        entry.update({
            "status": "error",
            "duration_ms": int((time.time() - t0) * 1000),
            "error": err_msg,
        })
        yield {"type": "error", "error": err_msg}
    except Exception as e:
        err_msg = f"调用大模型失败: {e}"
        entry.update({
            "status": "error",
            "duration_ms": int((time.time() - t0) * 1000),
            "error": err_msg,
        })
        yield {"type": "error", "error": err_msg}
    finally:
        if _old_acct is not None:
            os.environ["CLOUDFLARE_ACCOUNT_ID"] = _old_acct
        elif _pid == "cloudflare":
            os.environ.pop("CLOUDFLARE_ACCOUNT_ID", None)


async def call_llm(prompt: str, model_id: str, timeout: int = 120, tag: str = "", system_prompt: str | None = None) -> tuple[str, dict]:
    """调用大模型，返回 (响应内容, token_info)。保持向后兼容，内部使用 stream_llm 生成器。"""
    content = ""
    token_info = {"prompt_tokens": None, "completion_tokens": None, "total_tokens": None, "cost": None}
    async for event in stream_llm(prompt=prompt, model_id=model_id, timeout=timeout, tag=tag, system_prompt=system_prompt):
        if event["type"] == "delta":
            content += event["text"]
        elif event["type"] == "done":
            if event.get("usage"):
                token_info = event["usage"]
        elif event["type"] == "error":
            raise LLMCallError(event["error"])
    return content, token_info


async def test_llm(model_id: str) -> tuple[bool, str]:
    """测试该模型的 API Key 是否可用，返回 (是否成功, 说明信息)。"""
    api_key = get_api_key(model_id)
    if not api_key:
        return False, "尚未配置 API Key"

    _pid = _provider_of(model_id)
    _old_acct = None
    if _pid == "cloudflare":
        _old_acct = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
        acct_id = get_account_id("cloudflare")
        if acct_id:
            os.environ["CLOUDFLARE_ACCOUNT_ID"] = acct_id

    try:
        kwargs = dict(
            model=_litellm_model(model_id),
            api_key=api_key,
            messages=[{"role": "user", "content": _TEST_PROMPT}],
            timeout=60,
        )
        api_base = _api_base(model_id)
        if api_base:
            kwargs["api_base"] = api_base
        response = await asyncio.wait_for(
            litellm.acompletion(**kwargs),
            timeout=65,
        )
        content = response.choices[0].message.content or ""
        return True, f"连接成功（模型返回：{content[:20]}）"
    except asyncio.TimeoutError:
        return False, "连接超时：模型响应超过 100 秒，请稍后重试"
    except Exception as e:
        return False, f"连接失败：{str(e)}"
    finally:
        if _old_acct is not None:
            os.environ["CLOUDFLARE_ACCOUNT_ID"] = _old_acct
        elif _pid == "cloudflare":
            os.environ.pop("CLOUDFLARE_ACCOUNT_ID", None)
