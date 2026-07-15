from fastapi import APIRouter
from config import list_models

router = APIRouter()


@router.get("/models")
async def get_models():
    """返回所有可选模型（供校对时选择）。"""
    return {"models": list_models()}
