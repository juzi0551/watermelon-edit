import os
import json

# API Key 存储路径
KEYS_DIR = os.path.join(os.path.dirname(__file__), "app", "data")
KEYS_PATH = os.path.join(KEYS_DIR, "api_keys.json")
CUSTOM_PROVIDERS_PATH = os.path.join(KEYS_DIR, "custom_providers.json")

# 模型引用分隔符：provider::model_id 组合标识，用于在重复模型 ID 场景下显式路由
MODEL_REF_SEP = "::"

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
    "minimax": {
        "name": "MiniMax（稀宇）",
        "env_key": "MINIMAX_API_KEY",
        "litellm_prefix": "openai",
        "api_base": "https://api.minimaxi.com/v1",
        "models": [
            {"id": "MiniMax-M3", "name": "MiniMax M3"},
            {"id": "MiniMax-M2.7-highspeed", "name": "MiniMax M2.7 Highspeed"},
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
    "aliyun": {
        "name": "阿里云百炼（DashScope）",
        "env_key": "DASHSCOPE_API_KEY",
        "litellm_prefix": "openai",
        "api_base": "https://llm-w0hqh39vgj4b5mdf.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
        "models": [
            {"id": "qwen3.7-plus", "name": "Qwen 3.7 Plus"},
            {"id": "qwen3.7-max", "name": "Qwen 3.7 Max"},
        ],
    },
    "cloudflare": {
        "name": "Cloudflare Workers AI",
        "env_key": "CLOUDFLARE_API_KEY",
        "litellm_prefix": "cloudflare",
        "account_id_env_key": "CLOUDFLARE_ACCOUNT_ID",
        "models": [
            {"id": "@cf/zai-org/glm-5.2", "name": "GLM 5.2"},
            {"id": "@cf/zai-org/glm-4.7-flash", "name": "GLM 4.7 Flash"},
            {"id": "@cf/moonshotai/kimi-k2.6", "name": "Kimi K2.6"},
        ],
    },
    "openrouter": {
        "name": "OpenRouter",
        "env_key": "OPENROUTER_API_KEY",
        "litellm_prefix": "openrouter",
        "models": [
            {"id": "moonshotai/kimi-k2.6", "name": "Kimi K2.6"},
        ],
    },
    "nvidia": {
        "name": "NVIDIA Cloud AI",
        "env_key": "NVIDIA_API_KEY",
        "litellm_prefix": "openai",
        "api_base": "https://integrate.api.nvidia.com/v1",
        "models": [
            {"id": "moonshotai/kimi-k2.6", "name": "Kimi K2.6 (NVIDIA)"},
            {"id": "z-ai/glm-5.2", "name": "GLM 5.2 (NVIDIA)"},
            {"id": "deepseek-ai/deepseek-v4-pro", "name": "DeepSeek V4 Pro (NVIDIA)"},
        ],
    },
    "local": {
        "name": "本地代理",
        "env_key": "LOCAL_API_KEY",
        "litellm_prefix": "openai",
        "api_base": "http://localhost:8045/v1",
        "models": [
            {"id": "gemini-3.6-flash-medium", "name": "Gemini 3.6 Flash Medium"},
            {"id": "gemini-3.6-flash-high", "name": "Gemini 3.6 Flash High"},
        ],
    },
}


# ---------- 工具函数 ----------

_keys_cache: dict | None = None
_custom_providers_cache: dict | None = None


def _load_keys() -> dict:
    global _keys_cache
    if _keys_cache is not None:
        return _keys_cache
    os.makedirs(KEYS_DIR, exist_ok=True)
    if not os.path.exists(KEYS_PATH):
        _keys_cache = {}
        return _keys_cache
    try:
        with open(KEYS_PATH, "r", encoding="utf-8") as f:
            _keys_cache = json.load(f)
            return _keys_cache
    except (json.JSONDecodeError, IOError):
        _keys_cache = {}
        return _keys_cache


def _save_keys(keys: dict):
    global _keys_cache
    os.makedirs(KEYS_DIR, exist_ok=True)
    with open(KEYS_PATH, "w", encoding="utf-8") as f:
        json.dump(keys, f, indent=2, ensure_ascii=False)
    _keys_cache = keys


def _load_custom_providers() -> dict:
    global _custom_providers_cache
    if _custom_providers_cache is not None:
        return _custom_providers_cache
    os.makedirs(KEYS_DIR, exist_ok=True)
    if not os.path.exists(CUSTOM_PROVIDERS_PATH):
        _custom_providers_cache = {}
        return _custom_providers_cache
    try:
        with open(CUSTOM_PROVIDERS_PATH, "r", encoding="utf-8") as f:
            _custom_providers_cache = json.load(f)
            return _custom_providers_cache
    except (json.JSONDecodeError, IOError):
        _custom_providers_cache = {}
        return _custom_providers_cache


def _save_custom_providers(data: dict):
    global _custom_providers_cache
    os.makedirs(KEYS_DIR, exist_ok=True)
    with open(CUSTOM_PROVIDERS_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    _custom_providers_cache = data


def get_all_providers() -> dict:
    """获取动态合并后的全部服务商（内置服务商 + 追加的自定义模型 + 自定义服务商）。"""
    merged = {}
    custom = _load_custom_providers()
    extra_models_map = custom.get("_extra_models", {})

    # 1. 内置服务商
    for pid, p in PROVIDERS.items():
        p_copy = json.loads(json.dumps(p))
        extra_models = extra_models_map.get(pid, [])
        p_copy["models"].extend(extra_models)
        p_copy["is_custom"] = False
        merged[pid] = p_copy

    # 2. 用户新增的自定义服务商
    for pid, p in custom.items():
        if pid.startswith("_"):
            continue
        p_copy = json.loads(json.dumps(p))
        p_copy["is_custom"] = True
        merged[pid] = p_copy

    return merged


def _split_model_ref(ref: str) -> tuple[str | None, str]:
    """将 'provider::model_id' 拆分为 (provider, model_id)；无分隔符时返回 (None, 原值)。"""
    if isinstance(ref, str) and MODEL_REF_SEP in ref:
        pid, _, mid = ref.partition(MODEL_REF_SEP)
        if pid and mid:
            return pid, mid
    return None, ref


def _provider_of(model_ref: str, provider_id: str | None = None) -> str | None:
    """返回 model_ref 所属的服务商。

    provider_id 明确指定时只在该服务商内匹配（解决重复模型 ID 串线问题）；
    模型引用内嵌 provider（provider::model_id）时以嵌入值为准；
    否则按合并顺序返回第一个匹配的服务商。
    """
    emb_pid, model_id = _split_model_ref(model_ref)
    if emb_pid:
        provider_id = provider_id or emb_pid
    all_p = get_all_providers()
    if provider_id:
        p = all_p.get(provider_id)
        if p and any(m["id"] == model_id for m in p["models"]):
            return provider_id
        return None
    for pid, p in all_p.items():
        if any(m["id"] == model_id for m in p["models"]):
            return pid
    return None


def _mask(key: str) -> str:
    return (key[:4] + "****" + key[-4:]) if len(key) > 8 else ("****" if key else "")


def _litellm_model(model_ref: str, provider_id: str | None = None) -> str:
    """转换为 LiteLLM 模型标识，如 deepseek/deepseek-v4-flash。
    无内置前缀的服务商返回原始模型名，由 api_base 决定路由。"""
    emb_pid, model_id = _split_model_ref(model_ref)
    if emb_pid:
        provider_id = provider_id or emb_pid
    all_p = get_all_providers()
    pid = _provider_of(model_id, provider_id)
    if not pid or pid not in all_p:
        return model_id
    prefix = all_p[pid].get("litellm_prefix")
    return f"{prefix}/{model_id}" if prefix else model_id


def _api_base(model_ref: str, provider_id: str | None = None) -> str | None:
    """返回服务商的自定义 OpenAI 兼容端点（如有）。"""
    emb_pid, model_id = _split_model_ref(model_ref)
    if emb_pid:
        provider_id = provider_id or emb_pid
    all_p = get_all_providers()
    pid = _provider_of(model_id, provider_id)
    if not pid or pid not in all_p:
        return None
    return all_p[pid].get("api_base")


def _model_temperature(model_ref: str, provider_id: str | None = None) -> float | None:
    """返回模型自定义 temperature（如有）。"""
    emb_pid, model_id = _split_model_ref(model_ref)
    if emb_pid:
        provider_id = provider_id or emb_pid
    all_p = get_all_providers()
    pid = _provider_of(model_id, provider_id)
    if not pid or pid not in all_p:
        return None
    for m in all_p[pid]["models"]:
        if m["id"] == model_id:
            return m.get("temperature")
    return None


def _model_extra_kwargs(model_ref: str, provider_id: str | None = None) -> dict:
    emb_pid, model_id = _split_model_ref(model_ref)
    if emb_pid:
        provider_id = provider_id or emb_pid
    pid = _provider_of(model_id, provider_id)
    if pid == "moonshot":
        k2_6_ids = {"kimi-k2.6", "kimi-k2.5", "kimi-k2.7-code"}
        if model_id in k2_6_ids:
            return {"thinking": {"type": "enabled"}}
    return {}


# ---------- API Key 读写（按服务商） ----------

def _resolve_key_value(value: str | dict | None) -> str | None:
    """从 keys JSON 的值中提取 API Key 字符串（兼容 dict 和 普通字符串）。"""
    if isinstance(value, dict):
        return value.get("api_key")
    if isinstance(value, str):
        return value
    return None


def get_api_key(model_ref: str, provider_id: str | None = None) -> str | None:
    """根据模型找到所属服务商，返回该服务商的 API Key（JSON 文件优先，回退环境变量）。"""
    emb_pid, model_id = _split_model_ref(model_ref)
    if emb_pid:
        provider_id = provider_id or emb_pid
    all_p = get_all_providers()
    pid = _provider_of(model_id, provider_id)
    if not pid or pid not in all_p:
        return None
    keys = _load_keys()
    if pid in keys:
        key = _resolve_key_value(keys[pid])
        if key:
            return key
    env_key = all_p[pid].get("env_key")
    return os.getenv(env_key) if env_key else None


def get_account_id(provider_id: str) -> str | None:
    """返回服务商的 Account ID（仅 Cloudflare 等需要）。"""
    all_p = get_all_providers()
    keys = _load_keys()
    value = keys.get(provider_id)
    if isinstance(value, dict):
        acct = value.get("account_id")
        if acct:
            return acct
    env_key = all_p.get(provider_id, {}).get("account_id_env_key")
    if env_key:
        return os.getenv(env_key)
    return None


def set_api_key(provider_id: str, api_key: str, account_id: str | None = None):
    all_p = get_all_providers()
    keys = _load_keys()
    if all_p.get(provider_id, {}).get("account_id_env_key"):
        existing = keys.get(provider_id)
        if isinstance(existing, dict):
            existing["api_key"] = api_key
            if account_id is not None:
                existing["account_id"] = account_id
        else:
            keys[provider_id] = {"api_key": api_key, "account_id": account_id or ""}
    else:
        keys[provider_id] = api_key
    _save_keys(keys)


def delete_api_key(provider_id: str):
    keys = _load_keys()
    keys.pop(provider_id, None)
    _save_keys(keys)


def list_providers_status() -> list[dict]:
    """返回所有服务商及其配置状态（Key 脱敏）。"""
    keys = _load_keys()
    all_p = get_all_providers()
    return [
        {
            "provider": pid,
            "name": p["name"],
            "api_base": p.get("api_base", ""),
            "litellm_prefix": p.get("litellm_prefix", ""),
            "configured": bool(keys.get(pid)),
            "masked_key": _mask(
                _resolve_key_value(keys.get(pid)) or keys.get(pid, "")
            ),
            "requires_account_id": bool(p.get("account_id_env_key")),
            "masked_account_id": _mask(
                keys.get(pid)["account_id"]
            ) if isinstance(keys.get(pid), dict) and keys[pid].get("account_id") else "",
            "models": p["models"],
            "is_custom": p.get("is_custom", False),
        }
        for pid, p in all_p.items()
    ]


def list_models() -> list[dict]:
    """返回所有可选模型（供校对时选择）。value 为 provider::model_id 组合标识，用于重复 ID 场景下精确路由。"""
    all_p = get_all_providers()
    out = []
    for pid, p in all_p.items():
        for m in p["models"]:
            out.append({
                "model_id": m["id"],
                "name": m["name"],
                "provider": pid,
                "provider_name": p["name"],
                "value": f"{pid}{MODEL_REF_SEP}{m['id']}",
                "deprecated": m.get("deprecated", False),
                "is_custom": m.get("is_custom", False),
            })
    return out


# ---------- 自定义服务商 & 模型管理 ----------

def add_custom_provider(provider_id: str, name: str, api_base: str = "", litellm_prefix: str = "openai", initial_model_id: str = "", initial_model_name: str = "", api_key: str = None) -> dict:
    pid = provider_id.strip().lower()
    if not pid:
        raise ValueError("服务商标识不能为空")
    all_p = get_all_providers()
    if pid in all_p:
        raise ValueError(f"服务商标识 '{pid}' 已存在")

    custom = _load_custom_providers()
    models = []
    if initial_model_id.strip():
        m_id = initial_model_id.strip()
        m_name = initial_model_name.strip() or m_id
        for p in all_p.values():
            if any(m["id"] == m_id for m in p["models"]):
                raise ValueError(f"模型 ID '{m_id}' 已在服务商 '{p['name']}' 中存在")
        models.append({"id": m_id, "name": m_name, "is_custom": True})

    custom[pid] = {
        "name": name.strip() or pid,
        "api_base": api_base.strip(),
        "litellm_prefix": litellm_prefix.strip() or "openai",
        "env_key": f"{pid.upper()}_API_KEY",
        "models": models,
    }
    _save_custom_providers(custom)

    if api_key and api_key.strip():
        set_api_key(pid, api_key.strip())

    return {"status": "ok", "provider": pid}


def delete_custom_provider(provider_id: str) -> dict:
    custom = _load_custom_providers()
    if provider_id not in custom or provider_id.startswith("_"):
        raise ValueError(f"无法删除非自定义服务商或服务商不存在: {provider_id}")
    del custom[provider_id]
    _save_custom_providers(custom)
    delete_api_key(provider_id)
    return {"status": "ok", "provider": provider_id}


def add_model_to_provider(provider_id: str, model_id: str, model_name: str) -> dict:
    pid = provider_id.strip()
    m_id = model_id.strip()
    m_name = model_name.strip() or m_id
    if not m_id:
        raise ValueError("模型 ID 不能为空")

    all_p = get_all_providers()
    if pid not in all_p:
        raise ValueError(f"服务商 '{pid}' 不存在")

    # 检查模型 ID 是否已存在
    for p in all_p.values():
        if any(m["id"] == m_id for m in p["models"]):
            raise ValueError(f"模型 ID '{m_id}' 已在服务商 '{p['name']}' 中存在")

    custom = _load_custom_providers()
    if pid in PROVIDERS:
        # 给内置服务商添加模型
        extra_models_map = custom.setdefault("_extra_models", {})
        extra_list = extra_models_map.setdefault(pid, [])
        extra_list.append({"id": m_id, "name": m_name, "is_custom": True})
    else:
        # 给自定义服务商添加模型
        custom_provider = custom.get(pid)
        if not custom_provider:
            raise ValueError(f"自定义服务商 '{pid}' 不存在")
        custom_provider.setdefault("models", []).append({"id": m_id, "name": m_name, "is_custom": True})

    _save_custom_providers(custom)
    return {"status": "ok", "provider": pid, "model_id": m_id}


def delete_model_from_provider(provider_id: str, model_id: str) -> dict:
    custom = _load_custom_providers()
    found = False

    if provider_id in PROVIDERS:
        extra_models_map = custom.get("_extra_models", {})
        extra_list = extra_models_map.get(provider_id, [])
        new_list = [m for m in extra_list if m["id"] != model_id]
        if len(new_list) != len(extra_list):
            extra_models_map[provider_id] = new_list
            found = True
    else:
        custom_provider = custom.get(provider_id)
        if custom_provider and "models" in custom_provider:
            old_len = len(custom_provider["models"])
            custom_provider["models"] = [m for m in custom_provider["models"] if m["id"] != model_id]
            if len(custom_provider["models"]) != old_len:
                found = True

    if not found:
        raise ValueError(f"未找到可删除的自定义模型: {model_id}")

    _save_custom_providers(custom)
    return {"status": "ok", "provider": provider_id, "model_id": model_id}
