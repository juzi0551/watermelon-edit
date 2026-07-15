import litellm
import time
import datetime
from collections import deque
from config import get_api_key, _litellm_model, _api_base, _model_temperature


class LLMCallError(Exception):
    """大模型调用失败（缺 Key / 超时 / 返回异常等）。由调用方捕获并转为 HTTP 错误。"""


# 内存环形缓冲：记录最近 N 次大模型调用，供调试面板查看（重启后清空）
LLM_CALL_LOG = deque(maxlen=50)


def _record_llm_call(entry: dict):
    LLM_CALL_LOG.append(entry)


_TEST_PROMPT = "只回复一个字：好"


async def call_llm(prompt: str, model_id: str, timeout: int = 180, tag: str = "") -> str:
    """调用大模型，返回原始响应字符串；任何失败都抛出 LLMCallError。

    使用异步 acompletion 并在单次调用上设置超时，避免阻塞事件循环或永久挂起。
    关闭 tool_choice 以防止 agent 型模型（如 Kimi Code）自行发起工具调用（会触发 499）。
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
        "status": "running",
        "duration_ms": 0,
        "response": None,
        "error": None,
    }
    _record_llm_call(entry)
    t0 = time.time()
    try:
        kwargs = dict(
            model=_litellm_model(model_id),
            api_key=api_key,
            messages=[
                {"role": "system", "content": "你是一个专业的小说校对编辑。请严格以JSON格式返回结果。"},
                {"role": "user", "content": prompt},
            ],
            temperature=_model_temperature(model_id) or 0.1,
            timeout=timeout,
            tool_choice="none",
        )
        api_base = _api_base(model_id)
        if api_base:
            kwargs["api_base"] = api_base
        response = await litellm.acompletion(**kwargs)
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
    except Exception as e:
        entry.update({
            "status": "error",
            "duration_ms": int((time.time() - t0) * 1000),
            "error": f"调用大模型失败: {e}",
        })
        raise LLMCallError(f"调用大模型失败: {e}") from e


def test_llm(model_id: str) -> tuple[bool, str]:
    """测试该模型的 API Key 是否可用，返回 (是否成功, 说明信息)。"""
    api_key = get_api_key(model_id)
    if not api_key:
        return False, "尚未配置 API Key"

    try:
        kwargs = dict(
            model=_litellm_model(model_id),
            api_key=api_key,
            messages=[{"role": "user", "content": _TEST_PROMPT}],
            temperature=_model_temperature(model_id) or 0,
            timeout=15,
            tool_choice="none",
        )
        api_base = _api_base(model_id)
        if api_base:
            kwargs["api_base"] = api_base
        response = litellm.completion(**kwargs)
        content = response.choices[0].message.content or ""
        return True, f"连接成功（模型返回：{content[:20]}）"
    except Exception as e:
        return False, f"连接失败：{str(e)}"
