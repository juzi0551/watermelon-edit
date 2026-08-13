import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.core.writing_engine import (
    generate_opening_suggestions,
    expand_scene_beats,
    expand_sensory_details,
    tab_autocomplete_text,
)

logger = logging.getLogger(__name__)
router = APIRouter()


class SceneBeatsExpandBody(BaseModel):
    scene_beats: list[str]
    chapter_title: str = "第一章"
    model_id: str | None = None


class SensoryExpandBody(BaseModel):
    text: str
    sensory_mode: str = "all"
    model_id: str | None = None


class TabCompleteBody(BaseModel):
    preceding_text: str
    model_id: str | None = None


@router.post("/projects/{project_id}/writing/generate-opening")
async def api_generate_opening(project_id: str, model_id: str | None = None):
    """基于作品设定自动推演 3 套开篇灵感与 5 章大纲预设。"""
    res = await generate_opening_suggestions(project_id, model_id=model_id)
    return res


@router.post("/projects/{project_id}/writing/scene-beats/expand")
async def api_expand_scene_beats(project_id: str, body: SceneBeatsExpandBody):
    """根据场景节拍生成连贯正文段落。"""
    draft = await expand_scene_beats(
        project_id=project_id,
        scene_beats=body.scene_beats,
        chapter_title=body.chapter_title,
        model_id=body.model_id,
    )
    return {"status": "ok", "draft": draft}


@router.post("/projects/{project_id}/writing/sensory-expand")
async def api_expand_sensory_details(project_id: str, body: SensoryExpandBody):
    """多维度五感与细节描写扩写。"""
    options = await expand_sensory_details(
        project_id=project_id,
        text=body.text,
        sensory_mode=body.sensory_mode,
        model_id=body.model_id,
    )
    return {"status": "ok", "options": options}


@router.post("/projects/{project_id}/writing/tab-complete")
async def api_tab_autocomplete(project_id: str, body: TabCompleteBody):
    """快捷续写。"""
    continuation = await tab_autocomplete_text(
        project_id=project_id,
        preceding_text=body.preceding_text,
        model_id=body.model_id,
    )
    return {"status": "ok", "continuation": continuation}


class CharacterPipelineBody(BaseModel):
    from_idx: int = 0
    to_idx: int | None = None
    model_id: str | None = None


@router.post("/projects/{project_id}/writing/run-character-pipeline")
async def api_run_character_pipeline(project_id: str, body: CharacterPipelineBody | None = None):
    """自动执行 4 步人物图谱提取 Pipeline：NER -> 消歧归一 -> 关系抽取 -> 快照落库。"""
    from app.core.entity_extractor import run_character_pipeline_async
    b = body or CharacterPipelineBody()
    res = await run_character_pipeline_async(
        project_id=project_id,
        from_idx=b.from_idx,
        to_idx=b.to_idx,
        model_id=b.model_id,
    )
    return res


class RewriteTextBody(BaseModel):
    text: str
    model_id: str | None = None


@router.post("/projects/{project_id}/writing/rewrite")
async def api_rewrite_text(project_id: str, body: RewriteTextBody):
    """AI 润色与重写短句。"""
    from app.core.writing_engine import rewrite_text_styles
    options = await rewrite_text_styles(
        project_id=project_id,
        text=body.text,
        model_id=body.model_id,
    )
    return {"status": "ok", "options": options}



