import json
import logging
from app.core.database import get_project, get_characters, get_current_document, get_chapters
from app.core.llm import call_llm
from config import get_default_model_id

logger = logging.getLogger(__name__)


def _build_project_context(project_id: str) -> str:
    """构建项目的创作上下文（包含世界观背景、主角/关键人物、核心矛盾与题材）。"""
    proj = get_project(project_id)
    if not proj:
        return ""

    ctx_parts = []
    if proj.get("name"):
        ctx_parts.append(f"【作品名称】《{proj['name']}》")
    if proj.get("genre"):
        ctx_parts.append(f"【题材分类】{proj['genre']}")
    if proj.get("author_name"):
        ctx_parts.append(f"【作者笔名】{proj['author_name']}")
    if proj.get("background_setting"):
        ctx_parts.append(f"【世界观与故事背景】\n{proj['background_setting']}")
    if proj.get("characters_summary"):
        ctx_parts.append(f"【主要角色与人设】\n{proj['characters_summary']}")
    if proj.get("conflict_summary"):
        ctx_parts.append(f"【核心剧情矛盾与期待感】\n{proj['conflict_summary']}")

    # 查关联角色库中的最新角色
    chars = get_characters(project_id)
    if chars:
        char_lines = []
        for c in chars[:8]:
            char_lines.append(f"- {c['name']} ({c.get('role', '配角')}): {c.get('description', '')}")
        ctx_parts.append("【登场人物表】\n" + "\n".join(char_lines))

    return "\n\n".join(ctx_parts)


def _get_system_prompt_directive(project_id: str) -> str:
    """获取项目独立的 AI 系统提示词（文风指令）。"""
    proj = get_project(project_id)
    if proj and proj.get("system_prompt") and proj["system_prompt"].strip():
        return proj["system_prompt"].strip()
    return "你是一位顶尖小说共创助手与文风导师。要求：句式紧凑、注重动作逻辑与视听环境细节描述、严禁翻译腔与词藻堆砌。"


async def generate_opening_suggestions(project_id: str, model_id: str | None = None) -> dict:
    """基于项目故事设定生成 3 套开篇写作思路与前 5 章大纲推荐。"""
    proj = get_project(project_id)
    if not proj:
        return {"error": "项目不存在"}

    m_id = model_id or get_default_model_id()
    context = _build_project_context(project_id)
    sys_prompt = _get_system_prompt_directive(project_id)

    user_prompt = f"""请根据以下【作品设定】，为作者提供 3 套不同风格的开篇写作方案以及前 5 章的剧情大纲规划：

{context}

### 输出格式要求 (严格按纯 JSON 输出，不要包含 Markdown 标记)：
{{
  "openings": [
    {{
      "style_name": "强冲突动作开场",
      "concept": "简要说明本方案的切入角度",
      "sample_prose": "150-250字的具体开篇正文段落示例..."
    }},
    {{
      "style_name": "氛围与环境渲染开场",
      "concept": "简要说明本方案的切入角度",
      "sample_prose": "150-250字的具体开篇正文段落示例..."
    }},
    {{
      "style_name": "悬念对话开场",
      "concept": "简要说明本方案的切入角度",
      "sample_prose": "150-250字的具体开篇正文段落示例..."
    }}
  ],
  "chapter_outline": [
    {{"chapter": "第一章", "title": "推荐标题", "beat_summary": "本章的核心高潮与矛盾节拍"}},
    {{"chapter": "第二章", "title": "推荐标题", "beat_summary": "本章的核心高潮与矛盾节拍"}},
    {{"chapter": "第三章", "title": "推荐标题", "beat_summary": "本章的核心高潮与矛盾节拍"}},
    {{"chapter": "第四章", "title": "推荐标题", "beat_summary": "本章的核心高潮与矛盾节拍"}},
    {{"chapter": "第五章", "title": "推荐标题", "beat_summary": "本章的核心高潮与矛盾节拍"}}
  ]
}}"""

    try:
        raw_text, _ = await call_llm(user_prompt, model_id=m_id, tag="generate_opening", system_prompt=sys_prompt)
        raw_clean = raw_text.strip()
        if raw_clean.startswith("```"):
            raw_clean = raw_clean.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        res = json.loads(raw_clean)
        return res
    except Exception as e:
        logger.warning("Generate opening failed: %s", e)
        return {
            "openings": [
                {
                    "style_name": "经典剧情开场",
                    "concept": "直接切入主角的危机时刻",
                    "sample_prose": f"冰冷的雨水打在暴雨倾盆的街头。{proj.get('name', '作品')}的故事就在这一刻拉开了序幕...",
                }
            ],
            "chapter_outline": [
                {"chapter": "第一章", "title": "风暴前夕", "beat_summary": "主角登场并陷入第一个危机事件。"}
            ]
        }


async def expand_scene_beats(project_id: str, scene_beats: list[str], chapter_title: str = "第一章", model_id: str | None = None) -> str:
    """根据场景节拍（3-5条梗概），结合世界观设定与文风提示词，扩写为约 1500 字的高张力正文段落。"""
    proj = get_project(project_id)
    if not proj:
        return ""

    m_id = model_id or get_default_model_id()
    context = _build_project_context(project_id)
    sys_prompt = _get_system_prompt_directive(project_id)

    beats_str = "\n".join([f"{i+1}. {beat}" for i, beat in enumerate(scene_beats)])

    user_prompt = f"""请根据以下【章节标题】和【场景节拍】，结合作品背景世界观，撰写【{chapter_title}】的连贯正文：

{context}

【本章场景节拍】
{beats_str}

### 撰写要求：
1. 严格遵循上面的【系统提示词文风指令】。
2. 将每个节拍自然过渡展开，细化人物的动作、对话、环境声响与心理活动。
3. 自然段之间用空行隔开，正文总字数约 1000~1800 字。不要输出任何解释性话语，直接输出小说正文。"""

    raw_text, _ = await call_llm(user_prompt, model_id=m_id, tag="expand_scene_beats", system_prompt=sys_prompt)
    return raw_text.strip()


async def expand_sensory_details(project_id: str, text: str, sensory_mode: str = "all", model_id: str | None = None) -> list[dict]:
    """对选中的自然段或句子进行“五感细节扩展” (Sensory Describe)。支持按指定模式 focus。"""
    m_id = model_id or get_default_model_id()
    context = _build_project_context(project_id)
    sys_prompt = _get_system_prompt_directive(project_id)

    mode_map = {
        "visual": ("👁 视觉与光影强化", "侧重光线、色彩、构图、动态与视觉描写细节"),
        "auditory": ("👂 听觉与环境音效", "侧重环境拟声、声调、远近音效与听觉沉浸感"),
        "psychological": ("🧠 心理活动与生理反应", "侧重角色内心活动、心跳、呼吸、微表情与生理感官"),
        "metaphor": ("🎨 文学隐喻与修辞", "侧重诗意隐喻、拟人、比喻与意境美感修辞"),
    }

    if sensory_mode != "all" and sensory_mode in mode_map:
        title, focus_desc = mode_map[sensory_mode]
        user_prompt = f"""请对作者选中的小说原文字句进行【{title}】专属维度的 3 种不同强度的扩写方案：

{context}

【划选原文】
"{text}"

【扩写要求】
{focus_desc}。请输出纯 JSON 格式：
{{
  "options": [
    {{
      "mode": "{sensory_mode}",
      "title": "{title} (细腻描摹)",
      "text": "扩写方案 1..."
    }},
    {{
      "mode": "{sensory_mode}",
      "title": "{title} (高张力渲染)",
      "text": "扩写方案 2..."
    }},
    {{
      "mode": "{sensory_mode}",
      "title": "{title} (文学修辞升级)",
      "text": "扩写方案 3..."
    }}
  ]
}}"""
    else:
        user_prompt = f"""请对作者选中的这部分小说原文字句进行【全五感综合细节扩写】：

{context}

【划选原文】
"{text}"

### 输出要求 (请输出纯 JSON 格式)：
提供 4 种不同维度的丰富扩写替换方案：
{{
  "options": [
    {{
      "mode": "visual",
      "title": "👁 视觉与光影强化",
      "text": "扩写后的文字段落..."
    }},
    {{
      "mode": "auditory",
      "title": "👂 听觉与环境音效",
      "text": "扩写后的文字段落..."
    }},
    {{
      "mode": "psychological",
      "title": "🧠 心理活动与生理反应",
      "text": "扩写后的文字段落..."
    }},
    {{
      "mode": "metaphor",
      "title": "🎨 文学隐喻与修辞",
      "text": "扩写后的文字段落..."
    }}
  ]
}}"""

    try:
        raw_text, _ = await call_llm(user_prompt, model_id=m_id, tag="sensory_expand", system_prompt=sys_prompt)
        raw_clean = raw_text.strip()
        if raw_clean.startswith("```"):
            raw_clean = raw_clean.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        data = json.loads(raw_clean)
        return data.get("options", [])
    except Exception as e:
        logger.warning("Sensory expand failed: %s", e)
        return [
            {"mode": sensory_mode if sensory_mode != "all" else "visual", "title": "👁 细节强化", "text": f"{text}（环境细节愈发清晰...）"}
        ]



async def tab_autocomplete_text(project_id: str, preceding_text: str, model_id: str | None = None) -> str:
    """行内 Tab 快捷续写：根据光标前上文，平滑续写 100~200 字。"""
    m_id = model_id or get_default_model_id()
    context = _build_project_context(project_id)
    sys_prompt = _get_system_prompt_directive(project_id)

    # 截取前文最后 800 字
    short_prec = preceding_text[-800:] if len(preceding_text) > 800 else preceding_text

    user_prompt = f"""请顺着作者当前停顿的位置，平滑向下续写 100~200 字的小说正文：

{context}

【前文内容】
...{short_prec}

### 要求：
1. 紧扣前文的最新语气与剧情走向，直接输出续写的正文片段。
2. 严禁重复前文最后一个字，不要添加任何引言或解释。"""

    raw_text, _ = await call_llm(user_prompt, model_id=m_id, tag="tab_complete", system_prompt=sys_prompt)
    return raw_text.strip()


async def rewrite_text_styles(project_id: str, text: str, model_id: str | None = None) -> list[dict]:
    """针对划选短句/段落提供 3 种文风润色重写方案 (Rewrite & Polish)。"""
    m_id = model_id or get_default_model_id()
    context = _build_project_context(project_id)
    sys_prompt = _get_system_prompt_directive(project_id)

    user_prompt = f"""请针对以下划选的小说短句/段落，提供 3 种不同语言风格与文学质感的【润色重写方案】：

{context}

【划选原句】
"{text}"

### 输出要求 (严格输出纯 JSON)：
{{
  "options": [
    {{
      "style": "精炼动作派",
      "text": "使用强动词、削减无用形容词、节奏紧凑高频的重写版本..."
    }},
    {{
      "style": "文学修辞派",
      "text": "富有画面感、隐喻与意境美感的重写版本..."
    }},
    {{
      "style": "戏剧张力派",
      "text": "强化角色情绪、悬念与张力的重写版本..."
    }}
  ]
}}"""

    try:
        raw_text, _ = await call_llm(user_prompt, model_id=m_id, tag="rewrite_text", system_prompt=sys_prompt)
        raw_clean = raw_text.strip()
        if raw_clean.startswith("```"):
            raw_clean = raw_clean.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        data = json.loads(raw_clean)
        return data.get("options", [])
    except Exception as e:
        logger.warning("Rewrite text failed: %s", e)
        return [
            {"style": "精炼动作派", "text": text}
        ]

