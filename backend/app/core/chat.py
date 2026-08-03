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

【角色定位与交流风格】
1. 直截了当，拒绝客套：禁止使用任何迎合、夸赞或虚套谄媚之词（如“这段写得非常精彩”、“很有张力”等）。交流风格保持刚正专业、清晰简洁。直接切入正文核心，指出节奏、氛围、人物心理或文字张力上的不足与改进空间。
2. 双向讨论与方向评估：当作者提出修改需求或泛泛探讨时，直奔主题分析其意图是否契合上下文。可以在聊天正文中与作者探讨不同的优化方向（如：“增强悬念” vs “侧重心理”），提出初步建议，并可询问作者是否需要生成具体的替换修改方案卡片。

【上下文感知规则】
1. 输入可能包含 [前文语境]、[待优化的正文] 及 [后文语境]。
2. 无缝嵌入：你的修改方案必须仅针对 [待优化的正文] 中的文本进行重写或润色，使其能无缝嵌回 [前文语境] 与 [后文语境] 之间。

【修改提案卡片 (propose_paragraph_edit) 触发与 Harness 规范】
1. 明确请求/确认时强制调用工具（核心规则）：
   - 不拒绝在聊天正文中为作者提供初步建议或方向探讨，也可询问作者是否需要生成替换方案。
   - 【工具触发条件】：当作者明确要求生成修改/替换方案，或者确认了你的探讨方向（例如：“帮我生成方案”、“按照这个方向改写”、“生成替换卡片”、“开始润色并替换”等）时，【必须且只能通过发起 propose_paragraph_edit 工具调用】来输出可落地的方案卡片！
   - 当用户已要求或确认生成方案时，绝不可仅在聊天正文中回复文本而遗漏工具调用。

2. 职责分离与零重复输出：
   - 所有的具体改写文本 (replacement_text)、方案选项 (options) 以及修改理由说明 (note) 必须【完整包含在 propose_paragraph_edit 工具调用的 JSON 参数中】。
   - 聊天对话正文只需提供简短的高维思路分析或一句引导语（例如：“已为您生成修改方案卡片，请在卡片中对比并一键采纳”），绝对禁止在聊天正文中重复粘贴工具参数里的修改文本。

3. 纯净替换文本：
   - replacement_text 以及 options 中的 replacement_text 必须是【纯粹的目标替换文本】。
   - 严禁包含 ``` markdown 等代码块包裹、前缀提示词（如“修改后：”、“替换文本：”）或解释性括号，确保文本可由前端一键直接嵌回原段落。

4. 格式与安全隔离：
   - 严格禁止在聊天正文中打印、拼接或泄露函数名称（如 propose_paragraph_edit）、工具调用的 JSON 源码或代码块。"""


def build_chat_system_prompt(project_id: str | None = None, current_paragraph_idx: int | None = None) -> str:
    """构建对话专用的 system prompt：直接使用代码中最新的编辑角色与 Harness 约束设定。"""
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

    formatted_context_parts.append(f"paragraph_idx: {para_idx}\n[待优化的正文]\n{target_text}")

    if after_str:
        formatted_context_parts.append(f"[后文语境]\n{after_str}{('...' if has_trailing_dots else '')}")

    return {
        "selected_text": target_text,
        "para_idx": para_idx,
        "paragraph_idx": para_idx,
        "para_end_idx": para_end_idx,
        "paragraph_end_idx": para_end_idx,
        "before_window": before_str,
        "after_window": after_str,
        "formatted_context": "\n\n".join(formatted_context_parts)
    }


PROPOSE_PARAGRAPH_EDIT_TOOL = {
    "type": "function",
    "function": {
        "name": "propose_paragraph_edit",
        "description": "用于向用户提交可一键采纳的段落改写与润色方案卡片。当用户明确确认、请求生成替换方案时调用。具体重写文本及理由说明由本工具参数承载。",
        "parameters": {
            "type": "object",
            "properties": {
                "paragraph_idx": {
                    "type": "integer",
                    "description": "目标段落的整数索引号（必须填入上下文 [待优化的正文] 上方声明的 paragraph_idx 数字）"
                },
                "original_text": {
                    "type": "string",
                    "description": "准备被修改的目标原文本（即上下文 [待优化的正文] 中的正文内容）"
                },
                "replacement_text": {
                    "type": "string",
                    "description": "默认方案或首选方案的纯粹目标替换文本。严禁包含 markdown 代码块包裹、前缀提示词（如'修改后：'）或解释性括号"
                },
                "note": {
                    "type": "string",
                    "description": "默认方案的修改理由与亮点解析（仅存放在本参数中，勿在对话正文中重复书写）"
                },
                "options": {
                    "type": "array",
                    "description": "可选：当有多个不同风格/侧重点的改写方案时列出所有候选方案",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {
                                "type": "string",
                                "description": "方案名称/标签，如 '方案一：画面感强' 或 '方案二：节奏紧凑'"
                            },
                            "replacement_text": {
                                "type": "string",
                                "description": "该方案纯粹的目标替换文本，严禁包含 markdown 代码块或前缀"
                            },
                            "note": {
                                "type": "string",
                                "description": "该方案的修改特点与理由说明"
                            }
                        },
                        "required": ["replacement_text"]
                    }
                }
            },
            "required": ["paragraph_idx", "original_text", "replacement_text"]
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
                    u_parts = []
                    if ctx.get("formatted_context"):
                        u_parts.append(ctx["formatted_context"])
                        u_parts.append("---")
                    u_parts.append(f"作者的问题/想法：{content}" if ctx.get("formatted_context") else content)
                    messages.append({"role": "user", "content": "\n\n".join(u_parts)})

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
