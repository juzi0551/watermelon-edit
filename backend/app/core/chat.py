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
2. 针对【选中的文字】给出意见，仅修改作者选中的文本片段，未选中的段落部分必须原样逐字保留。
3. 每条建议说明"为什么"（节奏、语感、视角、信息密度等），并给出可替换的写法。
4. 若你提供了多个候选修改方案（例如方案一、方案二、方案三），请在 propose_paragraph_edit 工具调用的 options 字段中列出所有候选方案（每个方案包含 label、replacement_text、note），供作者在卡片上平铺展示与手动点选采纳。
5. 若你有具体可替换的优化方案或改写建议，且选区属于【单个段落】，请使用修改提案工具发起替换卡片。注意：直接发起工具调用即可，切勿在聊天正文中打印或在结尾拼接工具名称（如 propose_paragraph_edit）。
6. 【重要限制】如果用户引用的选区跨越了多个段落，请直接在对话聊天中给出分析与修改建议，绝对不要调用 propose_paragraph_edit 工具生成卡片。
7. 语气像一位懂小说的同行，而不是机器。"""


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

    is_sub_selection = bool(selected_text and core_full_text and selected_text.strip() != core_full_text.strip())
    if is_sub_selection:
        formatted_context_parts.append(f"[选中正文局部节选（第 {para_idx} 段）]\n{selected_text}")
        formatted_context_parts.append(f"[所属完整段落正文（第 {para_idx} 段）]\n{core_full_text}")
    else:
        formatted_context_parts.append(f"[选中正文（第 {para_idx} 段" + (f" ~ {end_idx - 1} 段" if end_idx > para_idx + 1 else "") + f"）]\n{selected_text or core_full_text}")

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


PROPOSE_PARAGRAPH_EDIT_TOOL = {
    "type": "function",
    "function": {
        "name": "propose_paragraph_edit",
        "description": "当需要针对特定段落或框选的局部节选提出具体修改、润色或替换方案时，必须调用此工具生成替换确认卡片。若提供多个可选方案，请在 options 中列出",
        "parameters": {
            "type": "object",
            "properties": {
                "paragraph_idx": {
                    "type": "integer",
                    "description": "目标段落的整数索引号（必须精确填入上下文 [选中正文（第 X 段）] 中给出的段落序号 X）"
                },
                "original_text": {
                    "type": "string",
                    "description": "准备修改的原文本（若作者框选了局部节选，填入作者框选的节选原文）"
                },
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
            "required": ["paragraph_idx", "original_text"]
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

    async for event in stream_llm(
        messages=messages,
        model_id=model_id,
        tag="chat",
        tools=[PROPOSE_PARAGRAPH_EDIT_TOOL]
    ):
        yield event
