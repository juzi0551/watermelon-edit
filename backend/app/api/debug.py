from fastapi import APIRouter
from app.core.llm import LLM_CALL_LOG

router = APIRouter()


@router.get("/debug/llm-calls")
async def llm_calls():
    """返回最近的大模型调用记录（最新在前），供前端调试面板查看。"""
    return {"calls": list(reversed(LLM_CALL_LOG))}
