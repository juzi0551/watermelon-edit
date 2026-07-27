from fastapi import APIRouter
from pydantic import BaseModel
from config import list_providers_status, set_api_key, delete_api_key, get_account_id, PROVIDERS, _load_keys, _save_keys
from app.core.llm import test_llm
from app.core.database import get_all_settings, set_setting

router = APIRouter()


class SetKeyRequest(BaseModel):
    provider: str
    api_key: str | None = None
    account_id: str | None = None


@router.get("/settings/providers")
async def list_providers():
    return {"providers": list_providers_status()}


@router.post("/settings/keys")
async def save_key(req: SetKeyRequest):
    if req.provider not in PROVIDERS:
        return {"error": f"不支持的服务商: {req.provider}"}
    acct = req.account_id.strip() if req.account_id else None
    key = req.api_key.strip() if req.api_key else None

    if PROVIDERS.get(req.provider, {}).get("account_id_env_key"):
        # Cloudflare 等需要 account_id 的服务商：允许只保存 account_id
        if not key and not acct:
            return {"error": "API Key 和 Account ID 至少提供一个"}
        if key:
            set_api_key(req.provider, key, account_id=acct)
        else:
            # 只更新 account_id，保留现有 api_key
            keys = _load_keys()
            existing = keys.get(req.provider)
            if isinstance(existing, dict):
                existing["account_id"] = acct or ""
                _save_keys(keys)
            else:
                return {"error": "请先配置 API Key"}
    else:
        if not key:
            return {"error": "API Key 不能为空"}
        set_api_key(req.provider, key, account_id=acct)
    return {"status": "ok", "provider": req.provider}


@router.delete("/settings/keys/{provider}")
async def remove_key(provider: str):
    delete_api_key(provider)
    return {"status": "ok", "provider": provider}


@router.get("/settings/prompts")
async def get_prompts():
    all_s = get_all_settings()
    try:
        max_concurrent = int(all_s.get("batch_max_concurrent", "2"))
    except (ValueError, TypeError):
        max_concurrent = 2
    try:
        window_size = int(all_s.get("proofread_window_size", "30"))
    except (ValueError, TypeError):
        window_size = 30
    return {
        "system_prompt_proofread": all_s.get("system_prompt_proofread", ""),
        "batch_max_concurrent": max_concurrent,
        "proofread_window_size": window_size,
    }


class UpdatePromptsRequest(BaseModel):
    system_prompt_proofread: str | None = None
    batch_max_concurrent: int | None = None
    proofread_window_size: int | None = None


@router.put("/settings/prompts")
async def update_prompts(req: UpdatePromptsRequest):
    if req.system_prompt_proofread is not None:
        set_setting("system_prompt_proofread", req.system_prompt_proofread)
    if req.batch_max_concurrent is not None:
        val = max(1, min(req.batch_max_concurrent, 20))
        set_setting("batch_max_concurrent", str(val))
    if req.proofread_window_size is not None:
        ws = max(5, min(req.proofread_window_size, 100))
        set_setting("proofread_window_size", str(ws))
    return {"status": "ok"}


@router.post("/settings/reset-prompts")
async def reset_prompts():
    from app.core.database import DEFAULT_SYSTEM_PROMPT_PROOFREAD
    set_setting("system_prompt_proofread", DEFAULT_SYSTEM_PROMPT_PROOFREAD)
    return {
        "status": "ok",
        "system_prompt_proofread": DEFAULT_SYSTEM_PROMPT_PROOFREAD,
    }


@router.post("/settings/test/{model_id:path}")
async def test_key(model_id: str):
    ok, msg = await test_llm(model_id)
    return {"ok": ok, "message": msg}
