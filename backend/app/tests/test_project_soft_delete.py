import uuid
import pytest
from app.core.database import (
    init_db, create_project, get_project, list_projects, delete_project, toggle_project_lock
)

@pytest.fixture(autouse=True)
def setup_db():
    init_db()

def test_project_soft_delete_lifecycle():
    pid = f"proj_sd_{uuid.uuid4().hex[:8]}"
    proj = create_project(pid, "软删除测试项目")
    assert proj["id"] == pid
    assert proj.get("is_deleted") in (0, None)
    
    # 1. 列表中存在
    p_list = list_projects()
    assert any(p["id"] == pid for p in p_list)
    
    # 2. 执行逻辑删除
    delete_project(pid)
    
    # 3. get_project 返回 None，list_projects 不再包含该项目
    assert get_project(pid) is None
    p_list_after = list_projects()
    assert not any(p["id"] == pid for p in p_list_after)

def test_project_locked_deletion_prevented():
    pid = f"proj_lock_{uuid.uuid4().hex[:8]}"
    proj = create_project(pid, "锁定项目")
    toggle_project_lock(pid, True)
    
    # 尝试删除锁定项目抛出异常
    with pytest.raises(ValueError, match="项目已锁定"):
        delete_project(pid)
    
    # 项目依然完好存在
    assert get_project(pid) is not None
