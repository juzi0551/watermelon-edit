from fastapi import APIRouter
from pydantic import BaseModel
from config import list_providers_status, set_api_key, delete_api_key, PROVIDERS
from app.core.llm import test_llm

router = APIRouter()


class SetKeyRequest(BaseModel):
    provider: str
    api_key: str


@router.get("/settings/providers")
async def list_providers():
    """获取所有服务商及其 API Key 配置状态。"""
    return {"providers": list_providers_status()}


@router.post("/settings/keys")
async def save_key(req: SetKeyRequest):
    """保存某服务商的 API Key（覆盖其下所有模型）。"""
    if req.provider not in PROVIDERS:
        return {"error": f"不支持的服务商: {req.provider}"}
    if not req.api_key.strip():
        return {"error": "API Key 不能为空"}
    set_api_key(req.provider, req.api_key.strip())
    return {"status": "ok", "provider": req.provider}


@router.delete("/settings/keys/{provider}")
async def remove_key(provider: str):
    """删除某服务商的 API Key。"""
    delete_api_key(provider)
    return {"status": "ok", "provider": provider}


@router.post("/settings/test/{model_id}")
async def test_key(model_id: str):
    """测试指定模型的 API Key 是否可用（发起一次最小调用）。"""
    ok, msg = test_llm(model_id)
    return {"ok": ok, "message": msg}
