import litellm
import time
import datetime
import asyncio
from collections import deque
from config import get_api_key, _litellm_model, _api_base, _model_extra_kwargs
from app.core.database import get_setting


class LLMCallError(Exception):
    """大模型调用失败（缺 Key / 超时 / 返回异常等）。由调用方捕获并转为 HTTP 错误。"""


# 内存环形缓冲：记录最近 N 次大模型调用，供调试面板查看（重启后清空）
LLM_CALL_LOG = deque(maxlen=50)


def _record_llm_call(entry: dict):
    LLM_CALL_LOG.append(entry)


_TEST_PROMPT = "只回复一个字：好"


_DEFAULT_SYSTEM_PROMPT_HARDCODED = "你是一个专业的小说校对编辑。请严格以JSON格式返回结果。"


async def call_llm(prompt: str, model_id: str, timeout: int = 120, tag: str = "", system_prompt: str | None = None) -> str:
    """调用大模型，返回原始响应字符串；任何失败都抛出 LLMCallError。

    使用异步 acompletion 并在单次调用上设置超时，避免阻塞事件循环或永久挂起。

    system_prompt 可覆盖默认系统提示词（用于将指令放入 system 而非 user 消息）。
    传空字符串表示不用 system 消息（仅用于测试）。
    """
    api_key = get_api_key(model_id)
    if not api_key:
        raise LLMCallError(f"未配置 {model_id} 的 API Key，请到「设置」页面添加")
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
            tool_choice="none",
            response_format={"type": "json_object"},
        )
        api_base = _api_base(model_id)
        if api_base:
            kwargs["api_base"] = api_base
        extra = _model_extra_kwargs(model_id)
        if extra:
            kwargs.update(extra)
        response = await asyncio.wait_for(
            litellm.acompletion(**kwargs),
            timeout=timeout + 5,
        )
        content = response.choices[0].message.content
        entry.update({
            "status": "ok",
            "duration_ms": int((time.time() - t0) * 1000),
            "response": content,
        })
        return content
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
            "error": f"调用超时：模型 {timeout} 秒内未返回完整响应",
        })
        raise LLMCallError(f"调用超时：模型 {timeout} 秒内未返回完整响应")
    except Exception as e:
        entry.update({
            "status": "error",
            "duration_ms": int((time.time() - t0) * 1000),
            "error": f"调用大模型失败: {e}",
        })
        raise LLMCallError(f"调用大模型失败: {e}") from e


async def test_llm(model_id: str) -> tuple[bool, str]:
    """测试该模型的 API Key 是否可用，返回 (是否成功, 说明信息)。"""
    api_key = get_api_key(model_id)
    if not api_key:
        return False, "尚未配置 API Key"

    try:
        kwargs = dict(
            model=_litellm_model(model_id),
            api_key=api_key,
            messages=[{"role": "user", "content": _TEST_PROMPT}],
            timeout=60,
            tool_choice="none",
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
