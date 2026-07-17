import os
import json

# API Key 存储路径
KEYS_DIR = os.path.join(os.path.dirname(__file__), "app", "data")
KEYS_PATH = os.path.join(KEYS_DIR, "api_keys.json")

# 服务商注册表：一个服务商 = 一个 API Key（覆盖其下所有模型）
# litellm 通过 "前缀/模型名" 路由到对应服务商的 OpenAI 兼容端点
#   deepseek -> https://api.deepseek.com
#   moonshot -> https://api.moonshot.cn/v1
# LiteLLM 未内置前缀、或不识别具体模型名的服务商，统一用 litellm_prefix="openai" + 自定义 api_base 走 OpenAI 兼容端点
PROVIDERS = {
    "deepseek": {
        "name": "DeepSeek",
        "env_key": "DEEPSEEK_API_KEY",
        "litellm_prefix": "deepseek",
        "models": [
            {"id": "deepseek-v4-flash", "name": "DeepSeek V4 Flash"},
            {"id": "deepseek-v4-pro", "name": "DeepSeek V4 Pro"},
            {"id": "deepseek-chat", "name": "DeepSeek Chat（2026/07/24 弃用）", "deprecated": True},
            {"id": "deepseek-reasoner", "name": "DeepSeek Reasoner（2026/07/24 弃用）", "deprecated": True},
        ],
    },
    "moonshot": {
        "name": "Kimi（Moonshot）",
        "env_key": "MOONSHOT_API_KEY",
        "litellm_prefix": "openai",
        "api_base": "https://api.moonshot.cn/v1",
        "models": [
            {"id": "kimi-k3", "name": "Kimi K3"},
            {"id": "kimi-k2.6", "name": "Kimi K2.6"},
        ],
    },
    "google": {
        "name": "Google Gemini",
        "env_key": "GEMINI_API_KEY",
        "litellm_prefix": "gemini",
        "models": [
            {"id": "gemini-3.5-flash", "name": "Gemini 3.5 Flash"},
        ],
    },
}


# ---------- 工具函数 ----------

def _load_keys() -> dict:
    os.makedirs(KEYS_DIR, exist_ok=True)
    if not os.path.exists(KEYS_PATH):
        return {}
    try:
        with open(KEYS_PATH, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return {}


def _save_keys(keys: dict):
    os.makedirs(KEYS_DIR, exist_ok=True)
    with open(KEYS_PATH, "w") as f:
        json.dump(keys, f, indent=2)


def _provider_of(model_id: str) -> str | None:
    for pid, p in PROVIDERS.items():
        if any(m["id"] == model_id for m in p["models"]):
            return pid
    return None


def _mask(key: str) -> str:
    return (key[:4] + "****" + key[-4:]) if len(key) > 8 else ("****" if key else "")


def _litellm_model(model_id: str) -> str:
    """转换为 LiteLLM 模型标识，如 deepseek/deepseek-v4-flash。
    无内置前缀的服务商返回原始模型名，由 api_base 决定路由。"""
    pid = _provider_of(model_id)
    if not pid:
        return model_id
    prefix = PROVIDERS[pid].get("litellm_prefix")
    return f"{prefix}/{model_id}" if prefix else model_id


def _api_base(model_id: str) -> str | None:
    """返回服务商的自定义 OpenAI 兼容端点（如有）。"""
    pid = _provider_of(model_id)
    if not pid:
        return None
    return PROVIDERS[pid].get("api_base")


def _model_temperature(model_id: str) -> float | None:
    """返回模型自定义 temperature（如有），仅对明确支持的模型（如 moonshot-v1 系列）返回。"""
    pid = _provider_of(model_id)
    if not pid:
        return None
    for m in PROVIDERS[pid]["models"]:
        if m["id"] == model_id:
            return m.get("temperature")
    return None


def _model_extra_kwargs(model_id: str) -> dict:
    """返回模型自定义额外参数，合并到 litellm 调用参数中。
    注意：不要用 extra_body 包装，litellm 会将其作为字面 JSON 字段发送。
    直接返回原始字段名，litellm 会自动收集到 extra_body 中。"""
    pid = _provider_of(model_id)
    if pid == "moonshot":
        k2_6_ids = {"kimi-k2.6", "kimi-k2.5", "kimi-k2.7-code"}
        if model_id in k2_6_ids:
            return {"thinking": {"type": "enabled"}}
    return {}


# ---------- API Key 读写（按服务商） ----------

def get_api_key(model_id: str) -> str | None:
    """根据模型找到所属服务商，返回该服务商的 API Key（JSON 文件优先，回退环境变量）。"""
    pid = _provider_of(model_id)
    if not pid:
        return None
    keys = _load_keys()
    if pid in keys:
        return keys[pid]
    return os.getenv(PROVIDERS[pid]["env_key"])


def set_api_key(provider_id: str, api_key: str):
    keys = _load_keys()
    keys[provider_id] = api_key
    _save_keys(keys)


def delete_api_key(provider_id: str):
    keys = _load_keys()
    keys.pop(provider_id, None)
    _save_keys(keys)


def list_providers_status() -> list[dict]:
    """返回所有服务商及其配置状态（Key 脱敏）。"""
    keys = _load_keys()
    return [
        {
            "provider": pid,
            "name": p["name"],
            "configured": bool(keys.get(pid)),
            "masked_key": _mask(keys.get(pid, "")),
            "models": p["models"],
        }
        for pid, p in PROVIDERS.items()
    ]


def list_models() -> list[dict]:
    """返回所有可选模型（供校对时选择）。"""
    out = []
    for pid, p in PROVIDERS.items():
        for m in p["models"]:
            out.append({
                "model_id": m["id"],
                "name": m["name"],
                "provider": pid,
                "deprecated": m.get("deprecated", False),
            })
    return out
