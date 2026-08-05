"""
测试实体预扫描器 (test_entity_pre_scanner.py)
"""
import pytest
from app.core.entity_pre_scanner import scan_text_entities, mark_dictionary_expired, is_dictionary_expired, clear_dictionary_expired

def test_scan_text_entities_smoke():
    text = """
    智星和铜锁在河滩西瓜地里嬉戏。看瓜老爷爷拿着烟斗笑着说：“智星，你们少踩坏西瓜！”
    铜锁对智星说：“我们去后山吧。”智星、铜锁和哈呼是沿河村的好伙伴。
    """
    results = scan_text_entities(text)
    assert len(results) > 0
    names = {r["name"] for r in results}
    # 词典中应包含高频出现的候选人名
    assert "智星" in names or "铜锁" in names or "西瓜" in names

def test_dictionary_expired_status():
    proj_id = "test_proj_123"
    clear_dictionary_expired(proj_id)
    assert is_dictionary_expired(proj_id) is False
    
    mark_dictionary_expired(proj_id)
    assert is_dictionary_expired(proj_id) is True
    
    clear_dictionary_expired(proj_id)
    assert is_dictionary_expired(proj_id) is False
