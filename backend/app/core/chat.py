import json
import logging
from typing import AsyncIterator
from app.core.database import get_setting, get_paragraphs_in_range
from app.core.context import build_project_context_parts
from app.core.llm import stream_llm

logger = logging.getLogger(__name__)

DEFAULT_CHAT_SYSTEM_PROMPT = """你是一位温和专业的资深中文小说编辑，正与作者并肩工作。

你的工作方式：
1. 先指出这段文字的亮点，再提改进建议——批评永远包裹在建设性意见里。
2. 针对【选中的文字】给出意见，不要越界修改未被选中的内容。
3. 每条建议说明"为什么"（节奏、语感、视角、信息密度等），并给出 1~2 个可替换的写法示例。
4. 尊重作者的文风与表达习惯，不把个人偏好强加给作者。
5. 若原文已足够好，请直说"这段很好，不需要改"，不要为了提建议而提建议。
6. 语气像一位懂小说的同行，而不是机器。"""


def build_chat_system_prompt(project_id: str | None = None, current_paragraph_idx: int | None = None) -> str:
    """构建对话专用的 system prompt：注入编辑角色设定、作者文风与最新人物关系网。"""
    template = get_setting("system_prompt_chat", DEFAULT_CHAT_SYSTEM_PROMPT)
    if not template:
        template = DEFAULT_CHAT_SYSTEM_PROMPT

    if not project_id:
        return template

    context_parts = [template]
    extra = build_project_context_parts(project_id, current_paragraph_idx)
    if extra:
        context_parts.extend(extra)

    return "\n\n".join(context_parts)


def build_chat_context(
    document_id: str,
    para_idx: int,
    selected_text: str,
    para_end_idx: int | None = None,
    context_chars: int = 100
) -> dict:
    """按选中段落/跨段与选中文本，获取上下文扩展窗口（前后各 context_chars 字）。
    使用双轨文本 (revised_text or text) 保证与阅读器界面一致。
    """
    if para_end_idx is None or para_end_idx < para_idx:
        end_idx = para_idx + 1
    else:
        end_idx = para_end_idx + 1

    # 获取包含前后扩充范围的段落列表
    fetch_start = max(0, para_idx - 10)
    fetch_end = end_idx + 10
    all_paras = get_paragraphs_in_range(document_id, fetch_start, fetch_end)

    para_map = {p["idx"]: (p.get("revised_text") or p.get("text") or "") for p in all_paras}

    # 目标核心文本 (单段或跨段)
    core_text_parts = []
    for idx in range(para_idx, end_idx):
        if idx in para_map:
            core_text_parts.append(para_map[idx])
    core_full_text = "\n".join(core_text_parts)

    # 向上寻找 context_chars 个字符的前文
    before_chars = []
    before_len = 0
    curr_idx = para_idx - 1
    while curr_idx >= fetch_start and before_len < context_chars:
        text = para_map.get(curr_idx, "")
        if text:
            needed = context_chars - before_len
            if len(text) <= needed:
                before_chars.insert(0, text)
                before_len += len(text)
            else:
                before_chars.insert(0, text[-needed:])
                before_len += needed
        curr_idx -= 1

    # 向下寻找 context_chars 个字符的后文
    after_chars = []
    after_len = 0
    curr_idx = end_idx
    while curr_idx < fetch_end and after_len < context_chars:
        text = para_map.get(curr_idx, "")
        if text:
            needed = context_chars - after_len
            if len(text) <= needed:
                after_chars.append(text)
                after_len += len(text)
            else:
                after_chars.append(text[:needed])
                after_len += needed
        curr_idx += 1

    before_str = "".join(before_chars)
    after_str = "".join(after_chars)

    formatted_context_parts = []
    if before_str:
        formatted_context_parts.append(f"[前文语境]\n...{before_str}")
    formatted_context_parts.append(f"[选中正文（第 {para_idx + 1} 段" + (f" ~ {end_idx} 段" if end_idx > para_idx + 1 else "") + f"）]\n{selected_text or core_full_text}")
    if after_str:
        formatted_context_parts.append(f"[后文语境]\n{after_str}...")

    return {
        "selected_text": selected_text or core_full_text,
        "para_idx": para_idx,
        "para_end_idx": para_end_idx,
        "before_window": before_str,
        "after_window": after_str,
        "formatted_context": "\n\n".join(formatted_context_parts)
    }


async def stream_chat(
    project_id: str,
    model_id: str,
    message: str,
    history_messages: list[dict] | None = None,
    context_info: dict | None = None,
    current_para_idx: int | None = None,
) -> AsyncIterator[dict]:
    """生成流式对话事件生成器 (yield thinking, delta, done, error)。"""
    system_prompt = build_chat_system_prompt(project_id, current_para_idx)

    messages = []
    messages.append({"role": "system", "content": system_prompt})

    # 追加历史消息 (只保留最近 20 条，避免上下文膨胀)
    if history_messages:
        for msg in history_messages[-20:]:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": content})

    # 当前用户消息 + 上下文窗口引用
    user_content_parts = []
    if context_info and context_info.get("formatted_context"):
        user_content_parts.append(context_info["formatted_context"])
        user_content_parts.append("---")
    user_content_parts.append(f"作者的问题/想法：{message}")

    full_user_content = "\n\n".join(user_content_parts)
    messages.append({"role": "user", "content": full_user_content})

    async for event in stream_llm(messages=messages, model_id=model_id, tag="chat"):
        yield event
