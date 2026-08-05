"""
角色关系图谱质量护栏 (Quality Rules)

统一收口泛称过滤、幻觉孤岛检测、canonical 选名裁决、关系突变检测及确定性 Fact 校验规则。
参考 AI-Reader-V2 已验证规则落地。
"""
import re
import logging
from typing import Dict, List, Set, Tuple, Optional

logger = logging.getLogger(__name__)

# 硬编码突变检测窗口大小
MUTATION_WINDOW = 3

# 纯称谓黑名单 (未登记角色一律拦截)
PURE_TITLE_BLOCKLIST = {
    "太太", "老者", "老太婆", "黑衣人", "男子", "女子", "少年", "少女", 
    "小伙子", "众人", "村夫", "老农", "官差", "路人", "侍女", "丫鬟",
    "店小二", "掌柜", "老汉", "老妇"
}

# 关系类型归一化表 (精确匹配与包含匹配)
_RELATION_TYPE_NORM = {
    # 5 大标准枚举自身映射
    "family": "family", "lover": "lover", "enemy": "enemy", "friend": "friend", "neutral": "neutral",
    
    # family: 血亲/亲属
    "父子": "family", "父女": "family", "母子": "family", "母女": "family",
    "兄弟": "family", "兄妹": "family", "姐弟": "family", "姐妹": "family",
    "叔侄": "family", "祖孙": "family", "夫妻": "family", "表亲": "family",
    "堂亲": "family", "亲家": "family", "血亲": "family", "亲属": "family",
    "叔父": "family", "伯父": "family", "舅舅": "family", "姑姑": "family",
    
    # lover: 亲密/恋人/结拜
    "恋人": "lover", "情侣": "lover", "爱人": "lover", "倾慕": "lover",
    "结拜兄弟": "lover", "结拜": "lover", "义结金兰": "lover", "金兰": "lover",
    "定情": "lover", "情投意合": "lover",
    
    # enemy: 敌对
    "敌人": "enemy", "仇人": "enemy", "死敌": "enemy", "对手": "enemy",
    "宿敌": "enemy", "逼婚": "enemy", "仇视": "enemy", "反目": "enemy",
    "追杀": "enemy", "交战": "enemy",
    
    # friend: 社交/朋友/同门
    "朋友": "friend", "好友": "friend", "挚友": "friend", "盟友": "friend",
    "同门": "friend", "师兄弟": "friend", "师姐妹": "friend", "同学": "friend",
    "搭档": "friend", "伙伴": "friend", "同道": "friend", "知己": "friend",
    "ally": "friend", "结盟": "friend", "友善": "friend", "同盟": "friend",

    # neutral: 中立/其他
    "中立": "neutral", "认识": "neutral", "点头之交": "neutral", "路人": "neutral"
}

_CATEGORY_MAP = {
    "family": "family",
    "lover": "intimate",
    "enemy": "hostile",
    "friend": "social",
    "neutral": "neutral"
}


def is_blocked_name(name: str, white_list: Optional[Set[str]] = None) -> bool:
    """
    判断名字是否为泛称/称谓/集合引用。
    白名单优先：在 white_list 中的角色名绝对豁免。
    """
    if not name or not isinstance(name, str):
        return True
    
    name = name.strip()
    if not name:
        return True
        
    if white_list and name in white_list:
        return False
        
    length = len(name)
    
    # ① 纯称谓黑名单
    if name in PURE_TITLE_BLOCKLIST:
        return True
        
    # ② 姓+数字排行称谓：len >= 3 且 name[-1] ∈ "爷奶" 且 name[-2] ∈ "大二三四五六七八九" (如王大爷/刘二哥)
    if length >= 3 and name[-1] in "爷奶哥姐弟妹" and name[-2] in "大二三四五六七八九十":
        return True
        
    # ③ 结构称谓：len >= 3 且 endswith("奶奶"/"姑娘"/"丫头"/"夫人"/"娘子"/"媳妇儿")
    suffixes = ("奶奶", "姑娘", "丫头", "夫人", "娘子", "媳妇儿", "老爷", "少爷")
    if length >= 3 and any(name.endswith(s) for s in suffixes):
        return True
        
    # ④ "老"字前缀泛称：startswith("老") 且 len >= 3 (如老者/老妇人/老汉)
    if length >= 3 and name.startswith("老") and name not in {"老子", "老舍"}:
        return True
        
    # ⑤ 指示代词：len ∈ [2, 4] 且 name[0] ∈ "那这" (如那人/这小子)
    if 2 <= length <= 4 and name[0] in "那这":
        return True
        
    # ⑥ 姓+氏：len == 2 且 name[1] == "氏" (如李氏/王氏)
    if length == 2 and name[1] == "氏":
        return True
        
    # ⑦ 集合引用：endswith("等") 或 startswith("群", "众") (如贾母等/群妖/众仙)
    if name.endswith("等") or name.startswith("群") or name.startswith("众"):
        return True
        
    # ⑧ 超长描述性名 (怀疑 AI 幻觉拼接)
    if length >= 10:
        return True
        
    return False


# 语料缓存字典 (project_id, doc_version_hash) -> full_text
_CORPUS_CACHE: Dict[Tuple[str, str], str] = {}

def update_corpus_cache(project_id: str, doc_version_hash: str, full_text: str):
    """更新内存中的语料缓存。"""
    _CORPUS_CACHE[(project_id, doc_version_hash)] = full_text

def clear_corpus_cache(project_id: Optional[str] = None):
    """失效/清空语料缓存。"""
    if project_id:
        keys_to_del = [k for k in _CORPUS_CACHE if k[0] == project_id]
        for k in keys_to_del:
            del _CORPUS_CACHE[k]
    else:
        _CORPUS_CACHE.clear()


def find_ungrounded_names(persons: List[Dict], full_text: str, MIN_VERIFIABLE_LEN: int = 2) -> Set[str]:
    """
    检查角色主名及别名在文档全文中的存在性。
    若主名与所有别名均未在全文出现，且名字长度 >= MIN_VERIFIABLE_LEN，返回 ungrounded 角色名集合。
    """
    if not full_text:
        return set()
        
    ungrounded = set()
    for p in persons:
        name = p.get("name", "").strip()
        if not name or len(name) < MIN_VERIFIABLE_LEN:
            continue
            
        aliases = p.get("aliases") or []
        if isinstance(aliases, str):
            import json
            try:
                aliases = json.loads(aliases)
            except Exception:
                aliases = [a.strip() for a in aliases.split(",") if a.strip()]
                
        all_names = [name] + [a for a in aliases if isinstance(a, str) and len(a) >= MIN_VERIFIABLE_LEN]
        
        # 查验任何一个名字是否在全文中出现
        found = any(n in full_text for n in all_names)
        if not found:
            ungrounded.add(name)
            
    return ungrounded


def pick_canonical(candidates: List[str], freq_map: Dict[str, int], dict_primary: Optional[str] = None) -> str:
    """
    Canonical 选名 + 冲突裁决：
    ① 词典/已登记主名唯一 -> 直接用 dict_primary
    ② 干净名优先 (非 blocked, len >= 2), 3字全名 (len >= 3) 再优先
    ③ 冲突裁决：保留出现频率高的映射
    ④ 短称呼 (那小子/老者) 不作为主名候选
    """
    if dict_primary and not is_blocked_name(dict_primary):
        return dict_primary
        
    valid_candidates = [c for c in candidates if c and not is_blocked_name(c) and len(c) >= 2]
    if not valid_candidates:
        return candidates[0] if candidates else ""
        
    # 评分逻辑：频次高优先，全名(len>=3)增加额外权重
    def score(name: str) -> float:
        f = freq_map.get(name, 1)
        length_bonus = 1.5 if len(name) >= 3 else 1.0
        return f * length_bonus
        
    valid_candidates.sort(key=score, reverse=True)
    return valid_candidates[0]


def normalize_relation_type(rel_type: str) -> str:
    """
    将自然语言中文关系类型映射至 5 大规范枚举：family, lover, enemy, friend, neutral。
    支持精确匹配 -> 包含匹配 -> neutral 兜底。
    """
    if not rel_type or not isinstance(rel_type, str):
        return "neutral"
        
    rel_type = rel_type.strip()
    
    # 1. 精确匹配
    if rel_type in _RELATION_TYPE_NORM:
        return _RELATION_TYPE_NORM[rel_type]
        
    # 2. 包含匹配
    for kw, norm in _RELATION_TYPE_NORM.items():
        if kw in rel_type:
            return norm
            
    # 特别包含逻辑
    if any(w in rel_type for w in ("父", "母", "兄", "弟", "姐", "妹", "叔", "伯", "舅", "姑", "祖", "孙", "妻", "夫", "亲")):
        return "family"
    if any(w in rel_type for w in ("爱", "恋", "情", "结拜", "金兰")):
        return "lover"
    if any(w in rel_type for w in ("敌", "仇", "杀", "战", "逼婚")):
        return "enemy"
    if any(w in rel_type for w in ("友", "伴", "同门", "同学", "党", "盟")):
        return "friend"
        
    return "neutral"


def classify_relation_category(rel_type: str) -> str:
    """
    获取关系前端展示的 6 大 category:
    family, intimate, hostile, social, neutral, hierarchical
    """
    # 师徒/主仆/上下级 特殊识别为 hierarchical
    if any(w in rel_type for w in ("师徒", "师父", "徒弟", "主仆", "上下级", "首领", "部下", "门生")):
        return "hierarchical"
        
    norm = normalize_relation_type(rel_type)
    return _CATEGORY_MAP.get(norm, "neutral")


def detect_relation_mutations(relation_events: List[Dict], window_size: int = MUTATION_WINDOW) -> List[Dict]:
    """
    短窗口 (<= 3 段) 内关系类型频繁来回翻转 (friend -> enemy -> friend) -> 标记 suspicious=True。
    """
    if len(relation_events) < 3:
        return relation_events
        
    events = sorted(relation_events, key=lambda x: x.get("paragraph_idx", 0))
    
    for i in range(1, len(events) - 1):
        prev_ev = events[i - 1]
        curr_ev = events[i]
        next_ev = events[i + 1]
        
        idx_diff = next_ev.get("paragraph_idx", 0) - prev_ev.get("paragraph_idx", 0)
        if idx_diff <= window_size:
            t1 = normalize_relation_type(prev_ev.get("relation_type") or prev_ev.get("type", ""))
            t2 = normalize_relation_type(curr_ev.get("relation_type") or curr_ev.get("type", ""))
            t3 = normalize_relation_type(next_ev.get("relation_type") or next_ev.get("type", ""))
            
            # 若类型翻转 (t1 == t3 且 t2 != t1)
            if t1 == t3 and t2 != t1 and t1 != "neutral":
                curr_ev["suspicious"] = True
                
    return relation_events


def validate_fact(from_name: str, to_name: str, rel_type: str, white_list: Optional[Set[str]] = None) -> Tuple[bool, str, str]:
    """
    确定性规则校验 (FactValidator 轻量版)：
    ① 自引用 (from == to) -> False
    ② 泛称拦截 (from 或 to 命中 blocked) -> False
    ③ 师兄弟/同门 -> friend (not family/师徒)
    ④ 结拜兄弟 -> lover (not family)
    ⑤ 类型映射归一化
    
    返回 (is_valid, normalized_type, category)
    """
    if not from_name or not to_name:
        return False, "neutral", "neutral"
        
    from_name = from_name.strip()
    to_name = to_name.strip()
    
    # 自引用检查
    if from_name == to_name:
        return False, "neutral", "neutral"
        
    # 泛称检查
    if is_blocked_name(from_name, white_list) or is_blocked_name(to_name, white_list):
        return False, "neutral", "neutral"
        
    # 特别映射规则
    if "师兄弟" in rel_type or "同门" in rel_type:
        return True, "friend", "social"
    if "结拜" in rel_type or "义结金兰" in rel_type:
        return True, "lover", "intimate"
        
    norm_type = normalize_relation_type(rel_type)
    category = classify_relation_category(rel_type)

    return True, norm_type, category


# ── description 血亲边补全 ─────────────────────────────────────────
# 亲属称谓（客观、不变，可由画像中的「X的称谓」模式确定性推断）
_KINSHIP_TERMS = (
    "母亲", "妈妈", "娘亲", "娘", "老妈",
    "父亲", "爸爸", "爹爹", "爹", "老爸",
    "儿子", "女儿", "长子", "长女",
    "弟弟", "哥哥", "姐姐", "妹妹",
    "爷爷", "奶奶", "祖父", "祖母", "外公", "外婆",
)
_KINSHIP_PATTERN = re.compile(
    r"([\u4e00-\u9fa5]{2,4})的(" + "|".join(_KINSHIP_TERMS) + ")"
)


def complete_family_edges_from_descriptions(project_id: str) -> int:
    """
    确定性血亲边补全：扫描已登记角色 description 中的「X的称谓」模式
    （如「哈呼的母亲」），当 X 为另一已登记角色时，若该点对尚无 family 边，
    自动补建一条 family 关系。

    幂等：仅当点对缺 family 边时才补。返回本次补建边数。
    """
    from app.core.database import get_conn, get_characters, insert_relationship

    chars = get_characters(project_id)
    name_to_id: Dict[str, str] = {}
    for c in chars:
        name_to_id[c["name"]] = c["id"]
        for a in (c.get("aliases") or []):
            if a and a not in name_to_id:
                name_to_id[a] = c["id"]

    # 已存在的 family 点对（去重）
    existing: Set[Tuple[str, str]] = set()
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT from_char_id, to_char_id FROM character_relationships
               WHERE project_id = ? AND relation_type = 'family'""",
            (project_id,),
        ).fetchall()
        for r in rows:
            existing.add(tuple(sorted([r["from_char_id"], r["to_char_id"]])))

    to_add: List[Tuple[str, str]] = []
    for c in chars:
        desc = c.get("description") or ""
        for m in _KINSHIP_PATTERN.finditer(desc):
            other_name = m.group(1)
            other_id = name_to_id.get(other_name)
            if not other_id or other_id == c["id"]:
                continue
            pair = tuple(sorted([c["id"], other_id]))
            if pair in existing:
                continue
            existing.add(pair)
            to_add.append((c["id"], other_id))

    added = 0
    for a, b in to_add:
        # 锚点：以两人中较晚的首次登场为准，确保边在双方都登场后生效
        anchor_idx = max(
            (ch.get("first_appear_idx") or 0) for ch in chars if ch["id"] in (a, b)
        )
        insert_relationship(
            project_id=project_id,
            from_char_id=a,
            to_char_id=b,
            relation_type="family",
            description="由角色画像中亲属称谓推断",
            paragraph_idx=anchor_idx,
        )
        added += 1
    return added
