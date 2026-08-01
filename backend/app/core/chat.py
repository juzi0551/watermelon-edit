import json
import time
import uuid
import logging
from typing import AsyncIterator
from app.core.database import get_setting, get_paragraphs_in_range, insert_llm_log
from app.core.context import build_project_context_parts
from app.core.llm import stream_llm

logger = logging.getLogger(__name__)

DEFAULT_CHAT_SYSTEM_PROMPT = """你是一位懂网文节奏、精通文学描写的资深中文小说编辑，正与作者并肩协作。

【角色定位与协作探讨】
1. 双向讨论与方向评估：你不仅是一个改字工具，更是作者的创作思考伙伴。当作者提出修改需求时，先评估其意图是否契合当前上下文的情感、节奏或人物动机。若意图尚不明确或有多种可能性，可以在聊天正文中与作者探讨不同的优化方向（如：“增强悬念” vs “侧重心理”），协助作者梳理思路。
2. 建设性交流：肯定本段的意图或亮点，再说明修改理由（从信息密度、视角控制、动作张力、语感音律或情感渲染等维度解析）。

【上下文感知规则】
1. 输入可能包含 [前文语境]、[待优化的正文] 及 [后文语境]。
2. 无缝嵌入：你的修改方案必须仅针对 [待优化的正文] 中的文本进行重写或润色，使其能无缝嵌回 [前文语境] 与 [后文语境] 之间。

【修改提案卡片 (propose_paragraph_edit) 调用规范】
1. 工具触发时机：当形成了具体明确的改写提案且属于【单个段落】或【单段内的局部节选】时，发起 propose_paragraph_edit 工具调用生成方案卡片。若处于初步探讨阶段或属于跨多段综合分析，请直接在对话聊天中探讨，切勿强行发起工具调用。
2. 多方案平铺 (options)：在提供卡片时，鼓励给出 2~3 个不同侧重点的候选方案（例如：“方案一：增强动作张力”、“方案二：提升对话韵律”）。请在 propose_paragraph_edit 的 options 字段中列出所有方案（包含 label、replacement_text、note 说明），供作者平铺比对并一键采纳。
3. 提示：待修改原文与段落序号已由系统自动精准绑定，只需输出修改方案 replacement_text / options 及理由说明 note，无需输出原文与段落号。
4. 严格禁止在聊天正文中打印或拼接函数名称（如 propose_paragraph_edit）。"""


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
    context_chars: int = 200
) -> dict:
    """以划选的具体文字片段为绝对中心点，向左/向右连续拼接 200 个字符。
    精准包含同段内划选文字之前与之后的文本，并向外顺延跨段。
    """
    if para_end_idx is None or para_end_idx < para_idx:
        end_idx = para_idx + 1
    else:
        end_idx = para_end_idx + 1

    # 获取目标核心段落文本 (单段或跨段)
    core_paras = get_paragraphs_in_range(document_id, para_idx, end_idx)
    core_paras_sorted = sorted(core_paras, key=lambda x: x["idx"])
    core_full_text = "\n".join(
        (p.get("revised_text") or p.get("text") or "").strip() for p in core_paras_sorted
    ).strip()

    target_text = (selected_text or core_full_text).strip()

    # 1. 计算划选片段在所属段落中的相对位置，提取同段内的前后文字
    same_para_before = ""
    same_para_after = ""

    if selected_text and core_full_text and target_text != core_full_text:
        sub_idx = core_full_text.find(target_text)
        if sub_idx != -1:
            same_para_before = core_full_text[:sub_idx]
            same_para_after = core_full_text[sub_idx + len(target_text):]

    # 2. 拼接划选点之前的有界前文 (F-A 修复: max(0, para_idx - 30))
    fetch_start = max(0, para_idx - 30)
    before_paras = get_paragraphs_in_range(document_id, fetch_start, para_idx)
    before_paras_sorted = sorted([p for p in before_paras if p["idx"] < para_idx], key=lambda x: x["idx"])
    preceding_text = "\n".join(
        (p.get("revised_text") or p.get("text") or "").strip() for p in before_paras_sorted
    ).strip()

    if preceding_text and same_para_before:
        full_before = preceding_text + "\n" + same_para_before
    else:
        full_before = preceding_text or same_para_before

    has_leading_dots = len(full_before) > context_chars
    before_str = full_before[-context_chars:] if has_leading_dots else full_before

    # 3. 拼接划选点之后的全量后文 (同段内划选点之后的文字 + 后段文字)
    after_paras = get_paragraphs_in_range(document_id, end_idx, end_idx + 50)
    after_paras_sorted = sorted([p for p in after_paras if p["idx"] >= end_idx], key=lambda x: x["idx"])
    following_text = "\n".join(
        (p.get("revised_text") or p.get("text") or "").strip() for p in after_paras_sorted
    ).strip()

    if same_para_after and following_text:
        full_after = same_para_after + "\n" + following_text
    else:
        full_after = same_para_after or following_text

    has_trailing_dots = len(full_after) > context_chars
    after_str = full_after[:context_chars] if has_trailing_dots else full_after

    formatted_context_parts = []
    if before_str:
        formatted_context_parts.append(f"[前文语境]\n{('...' if has_leading_dots else '')}{before_str}")

    formatted_context_parts.append(f"[待优化的正文]\n{target_text}")

    if after_str:
        formatted_context_parts.append(f"[后文语境]\n{after_str}{('...' if has_trailing_dots else '')}")

    return {
        "selected_text": target_text,
        "para_idx": para_idx,
        "para_end_idx": para_end_idx,
        "before_window": before_str,
        "after_window": after_str,
        "formatted_context": "\n\n".join(formatted_context_parts)
    }


PROPOSE_PARAGRAPH_EDIT_TOOL = {
    "type": "function",
    "function": {
        "name": "propose_paragraph_edit",
        "description": "当需要针对特定段落或框选的局部节选提出具体修改、润色或替换方案时，必须调用此工具生成替换确认卡片。若提供多个可选方案，请在 options 中列出",
        "parameters": {
            "type": "object",
            "properties": {
                "replacement_text": {
                    "type": "string",
                    "description": "默认方案或首选方案的修改文本"
                },
                "note": {
                    "type": "string",
                    "description": "默认方案的修改说明/简评"
                },
                "options": {
                    "type": "array",
                    "description": "可选：当有多个不同风格/语气的改写方案时列出所有方案",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {
                                "type": "string",
                                "description": "方案名称/标签，如 '方案一：节奏紧凑' 或 '方案二：画面感强'"
                            },
                            "replacement_text": {
                                "type": "string",
                                "description": "该方案改写后的新文本"
                            },
                            "note": {
                                "type": "string",
                                "description": "该方案的修改特点/理由说明"
                            }
                        },
                        "required": ["replacement_text"]
                    }
                }
            },
            "required": ["replacement_text"]
        }
    }
}


def sanitize_history_messages(raw_history: list[dict], max_count: int = 20) -> list[dict]:
    """对历史消息进行安全的截断，确保 tool_calls 与对应 role: tool 消息同组原子化进出，杜绝 400 错配。"""
    if not raw_history:
        return []

    sliced = list(raw_history[-max_count:])
    if not sliced:
        return []

    # 1. 避免头部出现孤立的 role: tool（原配 assistant 消息被裁掉）
    while sliced and sliced[0].get("role") == "tool":
        sliced.pop(0)

    # 2. 避免尾部出现带有 tool_calls 但缺乏对应 tool 响应消息的孤立 assistant
    while sliced:
        last = sliced[-1]
        if last.get("role") == "assistant":
            ctx = last.get("context") or {}
            if ctx.get("tool_calls") or last.get("tool_calls"):
                sliced.pop()
                continue
        break

    return sliced


async def stream_chat(
    project_id: str,
    model_id: str,
    message: str,
    history_messages: list[dict] | None = None,
    context_info: dict | None = None,
    current_para_idx: int | None = None,
    session_id: str | None = None,
) -> AsyncIterator[dict]:
    """生成流式对话事件生成器 (yield thinking, delta, tool_call, done, error)。"""
    system_prompt = build_chat_system_prompt(project_id, current_para_idx)

    messages = []
    messages.append({"role": "system", "content": system_prompt})

    # 追加历史消息 (严格兼容 tool_calls 与 role=tool 协议，原子化同组进出)
    if history_messages:
        safe_history = sanitize_history_messages(history_messages, max_count=20)
        for msg in safe_history:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            ctx = msg.get("context") or {}

            if role == "tool":
                messages.append({
                    "role": "tool",
                    "tool_call_id": ctx.get("tool_call_id") or msg.get("tool_call_id", ""),
                    "content": content or '{"status": "ok"}'
                })
            elif role == "assistant":
                m_obj = {"role": "assistant", "content": content or ""}
                if ctx.get("tool_calls"):
                    m_obj["tool_calls"] = ctx["tool_calls"]
                messages.append(m_obj)
            elif role == "user":
                if content:
                    messages.append({"role": "user", "content": content})

    # 当前用户消息 + 上下文窗口引用
    user_content_parts = []
    if context_info and context_info.get("formatted_context"):
        user_content_parts.append(context_info["formatted_context"])
        user_content_parts.append("---")
    user_content_parts.append(f"作者的问题/想法：{message}")

    full_user_content = "\n\n".join(user_content_parts)
    messages.append({"role": "user", "content": full_user_content})

    t0 = time.time()

    async for event in stream_llm(
        messages=messages,
        model_id=model_id,
        tag="chat",
        tools=[PROPOSE_PARAGRAPH_EDIT_TOOL],
        project_id=project_id,
        session_id=session_id,
    ):
        if event.get("type") in ("done", "error"):
            try:
                usage = event.get("usage") or {}
                tc_list = event.get("tool_calls")
                duration_ms = int((time.time() - t0) * 1000)
                insert_llm_log(
                    id=f"log_{uuid.uuid4().hex[:12]}",
                    project_id=project_id,
                    session_id=session_id,
                    model=model_id,
                    mode="chat",
                    prompt=full_user_content,
                    system_prompt=system_prompt,
                    status="ok" if event.get("type") == "done" else "error",
                    duration_ms=duration_ms,
                    error_message=event.get("error"),
                    response_raw=event.get("response"),
                    thinking=event.get("thinking"),
                    messages=json.dumps(messages, ensure_ascii=False) if messages else None,
                    tool_calls=json.dumps(tc_list, ensure_ascii=False) if tc_list else None,
                    prompt_tokens=usage.get("prompt_tokens"),
                    completion_tokens=usage.get("completion_tokens"),
                    total_tokens=usage.get("total_tokens"),
                    cost=usage.get("cost"),
                )
            except Exception as log_err:
                logger.error("Failed to insert chat llm log: %s", log_err, exc_info=True)
        yield event
