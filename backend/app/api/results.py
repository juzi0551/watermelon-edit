from fastapi import APIRouter
from app.core.database import get_current_document, get_result

router = APIRouter()


@router.get("/projects/{project_id}/results")
async def get_project_results(project_id: str):
    """获取项目当前版本的校对结果。"""
    doc = get_current_document(project_id)
    if not doc:
        return {"error": "项目无文档"}
    result = get_result(doc["id"])
    if not result:
        return {"error": "暂无校对结果，请先执行校对"}
    return result
