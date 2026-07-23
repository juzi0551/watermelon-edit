import os
import litellm
import time
import datetime
import asyncio
import logging
from collections import deque
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


async def call_llm(prompt: str, model_id: str, timeout: int = 120, tag: str = "", system_prompt: str | None = None) -> tuple[str, dict]:
    """调用大模型，返回 (响应内容, token_info)。

    token_info 包含 prompt_tokens / completion_tokens / total_tokens / cost，
    调用失败时所有字段为 None。

    流式调用（stream=True），timeout 为整体超时（含首 token 等待和 chunk 间等待）。
    system_prompt 可覆盖默认系统提示词（用于将指令放入 system 而非 user 消息）。
    传空字符串表示不用 system 消息（仅用于测试）。
    """
    api_key = get_api_key(model_id)
    if not api_key:
        raise LLMCallError(f"未配置 {model_id} 的 API Key，请到「设置」页面添加")

    # Cloudflare Workers AI 需要额外设置 Account ID 环境变量
    _pid = _provider_of(model_id)
    _old_acct = None
    if _pid == "cloudflare":
        _old_acct = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
        acct_id = get_account_id("cloudflare")
        if acct_id:
            os.environ["CLOUDFLARE_ACCOUNT_ID"] = acct_id

    entry = {
        "ts": datetime.datetime.now().isoformat(timespec="seconds"),
        "model": model_id,
        "tag": tag,
        "prompt_len": len(prompt),
        "prompt": prompt,
        "system_prompt": system_prompt,
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
        messages = []
        if system_prompt is not None:
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
        else:
            sp = get_setting("system_prompt_general", _DEFAULT_SYSTEM_PROMPT_HARDCODED)
            if sp:
                messages.append({"role": "system", "content": sp})
        messages.append({"role": "user", "content": prompt})
        kwargs = dict(
            model=_litellm_model(model_id),
            api_key=api_key,
            messages=messages,
            timeout=timeout,
            stream=True,
            drop_params=True,  # 自动丢弃不支持的参数
        )
        api_base = _api_base(model_id)
        if api_base:
            kwargs["api_base"] = api_base
        extra = _model_extra_kwargs(model_id)
        if extra:
            kwargs.update(extra)
        # 流式调用：timeout 为 chunk 间等待时间，非总超时
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
        # 若流式返回空内容，标记为异常
        got_content = False
        got_first_chunk = False
        got_first_content = False
        async for chunk in response:
            if not got_first_chunk:
                # 第一个 chunk：连接建立 + prefill 完成（思考型模型此时可能仍在 thinking）
                logger.info("TTFT_DEBUG: first_chunk=%.1fs (model=%s)", time.time() - t_prefill, model_id)
                got_first_chunk = True
            got_content = True
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta:
                # 捕获 thinking token（reasoning_content 字段，主流思考模型通用）
                rc = getattr(delta, "reasoning_content", None)
                if rc:
                    entry["thinking"] = (entry["thinking"] or "") + rc
                    entry["thinking_status"] = "thinking"
                if delta.content:
                    if not got_first_content:
                        logger.info("TTFT_DEBUG: first_content=%.1fs (model=%s)", time.time() - t_prefill, model_id)
                        got_first_content = True
                        # 思考结束，进入输出阶段
                        if entry["thinking_status"] == "thinking":
                            entry["thinking_status"] = "done"
                    content += delta.content
                    entry["response"] = content  # ← 增量写入，前端轮询可见
            usage = getattr(chunk, "usage", None)
            if usage:
                token_info = {
                    "prompt_tokens": getattr(usage, "prompt_tokens", None),
                    "completion_tokens": getattr(usage, "completion_tokens", None),
                    "total_tokens": getattr(usage, "total_tokens", None),
                    "cost": getattr(chunk, "_cost", None),
                }
        if not got_content:
            raise LLMCallError("流式返回为空，模型可能未产生任何输出")
        entry.update({
            "status": "ok",
            "duration_ms": int((time.time() - t0) * 1000),
            "response": content,
            "token_info": token_info,
            # 思考型模型若 thinking_status 仍为 thinking（无后续 content），也标记为 done
            "thinking_status": "done" if entry["thinking_status"] == "thinking" else entry["thinking_status"],
        })
        return content, token_info
    except LLMCallError as e:
        entry.update({
            "status": "error",
            "duration_ms": int((time.time() - t0) * 1000),
            "error": str(e),
        })
        raise
    except asyncio.TimeoutError:
        entry.update({
            "status": "error",
            "duration_ms": int((time.time() - t0) * 1000),
            "error": f"流式超时：超过 {timeout} 秒未收到新数据，模型可能已停止输出",
        })
        raise LLMCallError(f"流式超时：超过 {timeout} 秒未收到新数据，模型可能已停止输出")
    except Exception as e:
        entry.update({
            "status": "error",
            "duration_ms": int((time.time() - t0) * 1000),
            "error": f"调用大模型失败: {e}",
        })
        raise LLMCallError(f"调用大模型失败: {e}") from e
    finally:
        if _old_acct is not None:
            os.environ["CLOUDFLARE_ACCOUNT_ID"] = _old_acct
        elif _pid == "cloudflare":
            os.environ.pop("CLOUDFLARE_ACCOUNT_ID", None)


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
