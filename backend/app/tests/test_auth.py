import os
import sys
import tempfile
import pytest
from fastapi.testclient import TestClient

backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import app.core.database as db_mod
from app.core.database import init_db
from app.core.auth import (
    verify_env_config,
    update_env_file,
    update_admin_credentials,
)
from app.core.rate_limiter import reset_rate_limiter
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_auth_env():
    """隔离临时数据库与临时 .env 路径"""
    tmp = tempfile.TemporaryDirectory()
    orig_db_path = db_mod.DB_PATH
    orig_db_dir = db_mod.DB_DIR
    db_mod.DB_PATH = os.path.join(tmp.name, "test_auth.db")
    db_mod.DB_DIR = tmp.name
    db_mod._settings_cache = None
    init_db()

    # 创建测试用临时 .env 文件
    tmp_env_path = os.path.join(tmp.name, ".env")
    update_env_file(
        {
            "ADMIN_USERNAME": "test_admin",
            "ADMIN_PASSWORD": "test_secret_pass_123",
            "JWT_SECRET": "test_jwt_secret_key_1234567890123456",
        },
        env_path=tmp_env_path,
    )

    os.environ.pop("TESTING", None)
    os.environ["ADMIN_USERNAME"] = "test_admin"
    os.environ["ADMIN_PASSWORD"] = "test_secret_pass_123"
    os.environ["JWT_SECRET"] = "test_jwt_secret_key_1234567890123456"

    reset_rate_limiter()

    yield tmp_env_path

    db_mod.DB_PATH = orig_db_path
    db_mod.DB_DIR = orig_db_dir
    db_mod._settings_cache = None
    reset_rate_limiter()
    tmp.cleanup()


def test_verify_env_config_fail_fast():
    """测试缺失 ADMIN_PASSWORD 或弱密码时 verify_env_config 抛出 Fail-Fast 报错"""
    os.environ.pop("TESTING", None)

    # 1. 缺失密码
    os.environ.pop("ADMIN_PASSWORD", None)
    with pytest.raises(RuntimeError) as exc_info:
        verify_env_config()
    assert "ADMIN_PASSWORD environment variable is not set" in str(exc_info.value)

    # 2. 弱密码（小于 8 位）
    os.environ["ADMIN_PASSWORD"] = "123456"
    with pytest.raises(RuntimeError) as exc_info:
        verify_env_config()
    assert "ADMIN_PASSWORD in environment is too weak" in str(exc_info.value)

    # 恢复合法密码
    os.environ["ADMIN_PASSWORD"] = "test_secret_pass_123"


def test_auth_flow_and_change_password(setup_auth_env):
    tmp_env_path = setup_auth_env

    # 1. 未登录下访问 status，隐藏真实用户名
    res = client.get("/api/auth/status")
    assert res.status_code == 200
    assert res.json()["token_valid"] is False
    assert res.json()["username"] == ""

    # 2. 正常登录
    res = client.post("/api/auth/login", json={"username": "test_admin", "password": "test_secret_pass_123"})
    assert res.status_code == 200
    old_token = res.json()["token"]
    assert old_token

    # 3. 登录状态下查看 status，返回用户名
    res = client.get("/api/auth/status", headers={"Authorization": f"Bearer {old_token}"})
    assert res.status_code == 200
    assert res.json()["token_valid"] is True
    assert res.json()["username"] == "test_admin"

    # 4. 修改密码——测试旧密码错误 -> 401
    res = client.post(
        "/api/auth/change-password",
        json={"old_password": "wrong_password", "new_password": "new_secret_pass_456"},
        headers={"Authorization": f"Bearer {old_token}"},
    )
    assert res.status_code == 401

    # 5. 修改密码——测试新密码过于简单 -> 400
    res = client.post(
        "/api/auth/change-password",
        json={"old_password": "test_secret_pass_123", "new_password": "123"},
        headers={"Authorization": f"Bearer {old_token}"},
    )
    assert res.status_code == 400

    # 6. 修改密码——测试成功修改
    # 模拟为 change-password 注入临时 .env 路径更新
    new_token, _ = update_admin_credentials("new_secret_pass_456", env_path=tmp_env_path)
    assert new_token

    # 旧 Token 此时访问 API 应该返回 401（已即刻吊销）
    res = client.get("/api/projects", headers={"Authorization": f"Bearer {old_token}"})
    assert res.status_code == 401

    # 7. 确认 .env 文件中已被写入新 ADMIN_PASSWORD 与新 JWT_SECRET
    with open(tmp_env_path, "r", encoding="utf-8") as f:
        content = f.read()
    assert "ADMIN_PASSWORD=new_secret_pass_456" in content
    assert "JWT_SECRET=" in content

    # 新 Token 访问 API 成功
    res = client.get("/api/projects", headers={"Authorization": f"Bearer {new_token}"})
    assert res.status_code == 200
