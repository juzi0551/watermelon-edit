"""
测试质量护栏 (quality_rules.py)
包含 8 种泛称拦截、幻觉孤岛检测、canonical 选名裁决、突变检测与 Fact 校验。
"""
import pytest
from app.core.quality_rules import (
    is_blocked_name,
    find_ungrounded_names,
    pick_canonical,
    normalize_relation_type,
    classify_relation_category,
    detect_relation_mutations,
    validate_fact,
)


def test_is_blocked_name():
    # 1. 纯称谓黑名单
    assert is_blocked_name("太太") is True
    assert is_blocked_name("老者") is True
    assert is_blocked_name("店小二") is True
    
    # 2. 姓+数字排行称谓
    assert is_blocked_name("王大爷") is True
    assert is_blocked_name("刘二哥") is True
    
    # 3. 结构称谓
    assert is_blocked_name("张大奶奶") is True
    assert is_blocked_name("李姑娘") is True
    
    # 4. "老"字前缀
    assert is_blocked_name("老妇人") is True
    
    # 5. 指示代词
    assert is_blocked_name("那人") is True
    assert is_blocked_name("这小子") is True
    
    # 6. 姓+氏
    assert is_blocked_name("李氏") is True
    
    # 7. 集合引用
    assert is_blocked_name("贾母等") is True
    assert is_blocked_name("群妖") is True
    
    # 8. 正常角色名
    assert is_blocked_name("智星") is False
    assert is_blocked_name("贾宝玉") is False
    
    # 白名单优先豁免
    white = {"王大爷", "李氏"}
    assert is_blocked_name("王大爷", white) is False
    assert is_blocked_name("李氏", white) is False


def test_find_ungrounded_names():
    full_text = "智星和铜锁在山脚下遇到了看瓜老爷爷。"
    persons = [
        {"name": "智星", "aliases": ["老大"]},
        {"name": "铜锁", "aliases": []},
        {"name": "神秘刺客", "aliases": ["黑衣人"]},
    ]
    ungrounded = find_ungrounded_names(persons, full_text)
    assert "神秘刺客" in ungrounded
    assert "智星" not in ungrounded
    assert "铜锁" not in ungrounded


def test_pick_canonical():
    candidates = ["那小子", "智星", "陈智星"]
    freq_map = {"那小子": 100, "智星": 10, "陈智星": 5}
    
    # 词典/已登记主名优先
    picked = pick_canonical(candidates, freq_map, dict_primary="陈智星")
    assert picked == "陈智星"
    
    # 过滤短称呼，全名优先
    picked_no_dict = pick_canonical(candidates, freq_map)
    assert picked_no_dict == "智星"


def test_normalize_relation_type_and_category():
    assert normalize_relation_type("父子") == "family"
    assert classify_relation_category("父子") == "family"
    
    assert normalize_relation_type("结拜兄弟") == "lover"
    assert classify_relation_category("结拜兄弟") == "intimate"
    
    assert normalize_relation_type("宿敌") == "enemy"
    assert classify_relation_category("宿敌") == "hostile"
    
    assert normalize_relation_type("同门") == "friend"
    assert classify_relation_category("同门") == "social"
    
    assert classify_relation_category("师徒") == "hierarchical"


def test_detect_relation_mutations():
    events = [
        {"paragraph_idx": 1, "type": "friend"},
        {"paragraph_idx": 2, "type": "enemy"},
        {"paragraph_idx": 3, "type": "friend"},
    ]
    res = detect_relation_mutations(events, window_size=3)
    assert res[1].get("suspicious") is True


def test_detect_relation_mutations_isolation():
    """验证按 (from, to) 组内隔离后，C-D 的单条 enemy 事件不会被 A-B 的前后 friend 事件误标为 suspicious。"""
    ab_events = [
        {"from": "A", "to": "B", "paragraph_idx": 10, "type": "friend"},
        {"from": "A", "to": "B", "paragraph_idx": 12, "type": "friend"},
    ]
    cd_events = [
        {"from": "C", "to": "D", "paragraph_idx": 11, "type": "enemy"},
    ]

    res_ab = detect_relation_mutations(ab_events, window_size=3)
    res_cd = detect_relation_mutations(cd_events, window_size=3)

    assert not any(e.get("suspicious") for e in res_ab)
    assert not any(e.get("suspicious") for e in res_cd)


def test_validate_fact():
    # 自引用失败
    valid, _, _ = validate_fact("智星", "智星", "friend")
    assert valid is False
    
    # 泛称失败
    valid, _, _ = validate_fact("王大爷", "智星", "friend")
    assert valid is False
    
    # 师兄弟 -> friend / social
    valid, rel_t, cat = validate_fact("智星", "铜锁", "师兄弟")
    assert valid is True
    assert rel_t == "friend"
    assert cat == "social"
