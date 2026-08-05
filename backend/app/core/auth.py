import hmac
import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.core.database import get_setting, set_setting

# 显式统一 ENV 路径常量
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ENV_FILE_PATH = os.path.join(BACKEND_DIR, ".env")

# JWT 配置
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7

security = HTTPBearer(auto_error=False)


def validate_strong_password(password: str) -> tuple[bool, str]:
    """强密码校验纯函数：长度>=8位，且必须同时包含字母和数字"""
    if not password or len(password.strip()) < 8:
        return False, "密码长度不能少于 8 位"
    if not re.search(r"[A-Za-z]", password) or not re.search(r"[0-9]", password):
        return False, "密码必须同时包含字母和数字"
    return True, "ok"


def verify_env_config():
    """验证配置合法性：非 TESTING 模式下若缺失或弱 ADMIN_PASSWORD 拒绝启动"""
    if os.getenv("TESTING") == "1":
        logging.warning("⚠️ WARNING: TESTING=1 mode enabled! Authentication is bypassed for all endpoints!")
        return

    pwd = os.getenv("ADMIN_PASSWORD", "").strip()
    if not pwd:
        raise RuntimeError("FATAL: ADMIN_PASSWORD environment variable is not set. Refusing to start in production mode.")

    valid, err_msg = validate_strong_password(pwd)
    if not valid:
        raise RuntimeError(f"FATAL: ADMIN_PASSWORD in environment is too weak: {err_msg}. Refusing to start.")


def update_env_file(updates: dict[str, str], env_path: str | None = None) -> bool:
    """按行批量原子更新/追加 .env 文件中的配置键值对"""
    target_path = env_path or ENV_FILE_PATH
    
    # 确保文件存在
    if not os.path.exists(target_path):
        try:
            with open(target_path, "w", encoding="utf-8") as f:
                f.write("# Environment Configuration\n")
        except Exception as e:
            raise RuntimeError(f"Cannot create environment file at {target_path}: {e}")

    try:
        with open(target_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
    except Exception as e:
        raise RuntimeError(f"Cannot read environment file at {target_path}: {e}")

    remaining_keys = set(updates.keys())
    new_lines = []

    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in line:
            key, _ = line.split("=", 1)
            key = key.strip()
            if key in updates:
                new_lines.append(f"{key}={updates[key]}\n")
                remaining_keys.remove(key)
                continue
        new_lines.append(line)

    for key in remaining_keys:
        if new_lines and not new_lines[-1].endswith("\n"):
            new_lines.append("\n")
        new_lines.append(f"{key}={updates[key]}\n")

    try:
        with open(target_path, "w", encoding="utf-8") as f:
            f.writelines(new_lines)
        return True
    except Exception as e:
        raise RuntimeError(f"Failed to write updates to environment file at {target_path}: {e}")


def get_admin_username() -> str:
    return os.getenv("ADMIN_USERNAME", "admin").strip()


def get_admin_password() -> str:
    return os.getenv("ADMIN_PASSWORD", "").strip()


def verify_admin_credentials(username: str, password: str) -> bool:
    """使用常数时间（hmac.compare_digest）验证管理员凭据，免疫时序侧信道攻击"""
    expected_username = get_admin_username()
    expected_password = get_admin_password()

    if not expected_password:
        return False

    user_match = hmac.compare_digest(username.encode("utf-8"), expected_username.encode("utf-8"))
    pass_match = hmac.compare_digest(password.encode("utf-8"), expected_password.encode("utf-8"))
    return user_match and pass_match


def get_or_create_jwt_secret() -> str:
    """获取 JWT Secret，环境变量优先；仅在 DB 值不一致时更新 DB"""
    secret = os.getenv("JWT_SECRET", "").strip()
    if secret:
        if get_setting("jwt_secret", "") != secret:
            set_setting("jwt_secret", secret)
        return secret

    secret = get_setting("jwt_secret", "")
    if not secret:
        secret = secrets.token_hex(32)
        set_setting("jwt_secret", secret)
    return secret


def update_admin_credentials(new_password: str, env_path: str | None = None) -> tuple[str, str]:
    """批量原子更新 ADMIN_PASSWORD 与 JWT_SECRET（更新内存、DB 并且同步批量写回 .env）"""
    new_jwt_secret = secrets.token_hex(32)

    # 1. 批量写回 .env
    update_env_file(
        {
            "ADMIN_PASSWORD": new_password,
            "JWT_SECRET": new_jwt_secret,
        },
        env_path=env_path,
    )

    # 2. 更新运行时内存
    os.environ["ADMIN_PASSWORD"] = new_password
    os.environ["JWT_SECRET"] = new_jwt_secret

    # 3. 同步更新 DB
    set_setting("jwt_secret", new_jwt_secret)

    # 4. 重新生成并返回属于当前操作者的 Token
    new_token = create_access_token({"sub": get_admin_username()})
    return new_token, new_jwt_secret


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """生成 JWT 访问 Token"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire})
    secret_key = get_or_create_jwt_secret()
    return jwt.encode(to_encode, secret_key, algorithm=ALGORITHM)


def verify_token(token: str) -> dict | None:
    """解析并校验 JWT Token"""
    if not token:
        return None
    try:
        secret_key = get_or_create_jwt_secret()
        payload = jwt.decode(token, secret_key, algorithms=[ALGORITHM])
        return payload
    except jwt.PyJWTError:
        return None


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security)
):
    """FastAPI 路由依赖：校验当前请求的 Bearer Token"""
    if os.getenv("TESTING") == "1":
        return {"sub": get_admin_username()}

    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return payload
