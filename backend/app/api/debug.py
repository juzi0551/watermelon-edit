from fastapi import APIRouter, Query
from app.core.llm import LLM_CALL_LOG
from app.core.database import list_llm_logs

router = APIRouter()


@router.get("/debug/llm-calls")
async def llm_calls():
    """返回最近的大模型调用记录（最新在前），供前端调试面板查看。"""
    return {"calls": list(reversed(LLM_CALL_LOG))}


@router.get("/debug/llm-logs")
async def llm_logs(
    project_id: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """分页查询持久化的 LLM 调用日志。"""
    rows = list_llm_logs(project_id, limit=limit, offset=offset)
    return {"logs": rows}
