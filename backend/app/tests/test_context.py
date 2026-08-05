"""
测试 Context 注入规范 (test_context.py)
"""
import pytest
from app.core.context import build_project_context_parts

def test_build_project_context_parts_empty():
    parts = build_project_context_parts(None)
    assert parts == []
