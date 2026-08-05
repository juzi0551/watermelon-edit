import time
from fastapi import HTTPException, Request, status

# 内存型频控锁结构: {(client_ip, username): {"failed_attempts": int, "lock_until": float}}
_attempts: dict[tuple[str, str], dict] = {}

MAX_FAILED_ATTEMPTS = 5
LOCK_DURATION_SECONDS = 900  # 15 分钟


def get_client_ip(request: Request) -> str:
    """提取客户端 IP 地址（搭配 uvicorn --proxy-headers 受信代理转化）"""
    return request.client.host if request.client else "127.0.0.1"


def check_rate_limit(request: Request, username: str):
    """校验该 (IP, username) 组合是否处于锁定阶段"""
    client_ip = get_client_ip(request)
    key = (client_ip, username.strip())
    record = _attempts.get(key)

    if record and record.get("lock_until", 0) > time.time():
        retry_after = int(record["lock_until"] - time.time())
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too Many Requests. IP temporarily locked due to multiple failed login attempts.",
            headers={"Retry-After": str(max(1, retry_after))},
        )


def record_failed_attempt(request: Request, username: str):
    """记录一次登录失败尝试，超过阈值触发锁定"""
    client_ip = get_client_ip(request)
    key = (client_ip, username.strip())
    now = time.time()

    record = _attempts.get(key, {"failed_attempts": 0, "lock_until": 0})
    
    # 如果上一次锁定已过期，重置计数
    if record["lock_until"] > 0 and now > record["lock_until"]:
        record["failed_attempts"] = 0
        record["lock_until"] = 0

    record["failed_attempts"] += 1

    if record["failed_attempts"] >= MAX_FAILED_ATTEMPTS:
        record["lock_until"] = now + LOCK_DURATION_SECONDS

    _attempts[key] = record


def reset_attempts(request: Request, username: str):
    """登录成功或测试时重置错误计数"""
    client_ip = get_client_ip(request)
    key = (client_ip, username.strip())
    _attempts.pop(key, None)


def reset_rate_limiter():
    """单元测试 fixture 调用：全量重置内存限流表"""
    global _attempts
    _attempts.clear()
