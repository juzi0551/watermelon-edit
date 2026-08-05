from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel

from app.core.auth import (
    create_access_token,
    get_admin_username,
    get_current_user,
    update_admin_credentials,
    validate_strong_password,
    verify_admin_credentials,
    verify_token,
)
from app.core.rate_limiter import (
    check_rate_limit,
    record_failed_attempt,
    reset_attempts,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class AuthLoginRequest(BaseModel):
    username: str
    password: str


class AuthChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


@router.get("/status")
async def get_auth_status(authorization: str | None = Header(None)):
    """获取当前传入 Token 的有效状态"""
    token_valid = False
    username = ""
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
        payload = verify_token(token)
        if payload:
            token_valid = True
            username = payload.get("sub", "")

    return {
        "token_valid": token_valid,
        "username": username,
    }


@router.post("/login")
async def login(req: AuthLoginRequest, request: Request):
    """管理员登录接口：防护频控爆破与防用户名枚举"""
    username = req.username.strip()
    password = req.password.strip()

    # 1. 限流锁定检查
    check_rate_limit(request, username)

    # 2. 常数时间凭据校验
    if not verify_admin_credentials(username, password):
        record_failed_attempt(request, username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    # 3. 登录成功，重置计数并签发 Token
    reset_attempts(request, username)
    token = create_access_token({"sub": username})
    return {"token": token, "status": "ok"}


@router.post("/change-password")
async def change_password(
    req: AuthChangePasswordRequest,
    current_user: dict = Depends(get_current_user),
):
    """在线修改管理员密码并原子吊销旧 Token（受鉴权保护）"""
    current_username = current_user.get("sub") or get_admin_username()

    # 1. 验证旧密码
    if not verify_admin_credentials(current_username, req.old_password.strip()):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Current password is incorrect",
        )

    # 2. 强密码校验
    new_pass = req.new_password.strip()
    valid, err_msg = validate_strong_password(new_pass)
    if not valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=err_msg,
        )

    # 3. 批量写回 .env，刷新内存与 DB，吊销旧 Token 并签发新 Token
    try:
        new_token, _ = update_admin_credentials(new_pass)
        return {"token": new_token, "status": "ok"}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update password: {str(e)}",
        )
