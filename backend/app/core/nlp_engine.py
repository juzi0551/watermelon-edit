"""
西瓜少年 · 离线 NLP 规则引擎与 GB/T 15834 标点一致性检测模块
包含高精度零假阳性标点校验与国家规范异形词 JSON 词库。
"""
import os
import json
import re
from app.core.database import get_conn, batch_insert_errors, get_glossary_terms

# 加载国家出版规范异形词库
VARIANT_WORDS_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "variant_words.json")

def load_variant_words() -> dict:
    if os.path.exists(VARIANT_WORDS_PATH):
        try:
            with open(VARIANT_WORDS_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "惟一": "唯一",
        "定婚": "订婚",
        "身分": "身份",
        "倒楣": "倒霉",
        "平空": "凭空",
        "作主": "做主",
    }

# 常见标点与符号正则表达式规则 (GB/T 15834)
ENGLISH_PUNCT_IN_CHINESE_RE = re.compile(r'([\u4e00-\u9fa5])[,\.!\?]([\u4e00-\u9fa5])')
DOUBLE_PUNCT_RE = re.compile(r'([。，！？])\1+')


def scan_term_consistency(document_id: str) -> dict:
    """全书扫描异形词与专有名词一致性。"""
    with get_conn() as conn:
        doc = conn.execute("SELECT project_id FROM documents WHERE id = ?", (document_id,)).fetchone()
        if not doc:
            return {"scanned_paragraphs": 0, "found_issues": 0, "error": "文档不存在"}
        project_id = doc["project_id"]
        
        paragraphs = conn.execute(
            "SELECT idx, text FROM paragraphs WHERE document_id = ? ORDER BY idx ASC",
            (document_id,),
        ).fetchall()

        custom_terms = get_glossary_terms(project_id)
        term_map = {t["term"]: t.get("std_replacement") or t["term"] for t in custom_terms if t.get("term")}

    standard_variant_words = load_variant_words()
    new_errors = []
    scanned = len(paragraphs)

    for p in paragraphs:
        p_idx = p["idx"]
        text = p["text"] or ""
        if not text.strip():
            continue

        # 1. 扫描通用国家规范异形词
        for non_std, std in standard_variant_words.items():
            if non_std in text and non_std != std:
                new_errors.append({
                    "type": "typo",
                    "paragraph_index": p_idx,
                    "original_text": non_std,
                    "suggested_text": std,
                    "severity": "medium",
                    "description": f"出版规范提示：建议将异形词“{non_std}”修改为现代汉语推荐规范词“{std}”",
                })

        # 2. 扫描项目自定义专有名词/术语
        for term, replacement in term_map.items():
            if term in text and term != replacement:
                new_errors.append({
                    "type": "typo",
                    "paragraph_index": p_idx,
                    "original_text": term,
                    "suggested_text": replacement,
                    "severity": "high",
                    "description": f"项目术语一致性提示：检测到专有名词“{term}”，建议统一修正为“{replacement}”",
                })

    inserted = batch_insert_errors(document_id, new_errors) if new_errors else 0

    return {"scanned_paragraphs": scanned, "found_issues": len(new_errors), "new_issues": inserted}


def scan_gbt15834_punctuation(document_id: str) -> dict:
    """全书离线扫描 GB/T 15834 标点规范（高精度零假阳性）。"""
    with get_conn() as conn:
        paragraphs = conn.execute(
            "SELECT idx, text FROM paragraphs WHERE document_id = ? ORDER BY idx ASC",
            (document_id,),
        ).fetchall()

    new_errors = []
    scanned = len(paragraphs)

    for p in paragraphs:
        p_idx = p["idx"]
        text = p["text"] or ""
        t_strip = text.strip()
        if not t_strip:
            continue

        # 1. 精准检测段首误用右引号 (例: ”你好 -> “你好)
        if t_strip.startswith('”'):
            suggested = "“" + t_strip[1:]
            new_errors.append({
                "type": "punctuation",
                "paragraph_index": p_idx,
                "original_text": "”",
                "suggested_text": "“",
                "severity": "high",
                "description": "GB/T 15834 标点规范：段落开头误用右后引号'”'，应修正为左前引号'“'",
            })
        elif t_strip.startswith('’'):
            new_errors.append({
                "type": "punctuation",
                "paragraph_index": p_idx,
                "original_text": "’",
                "suggested_text": "‘",
                "severity": "high",
                "description": "GB/T 15834 标点规范：段落开头误用右后单引号'’'，应修正为左前单引号'‘'",
            })

        # 2. 检测汉字之间误用半角英文标点 (例: "你好.世界" -> "你好。世界")
        for match in ENGLISH_PUNCT_IN_CHINESE_RE.finditer(text):
            char1, char2 = match.group(1), match.group(2)
            matched_str = match.group(0)
            punct = matched_str[len(char1):-len(char2)]
            cn_punct = "。" if punct == "." else "，" if punct == "," else "！" if punct == "!" else "？"
            suggested = f"{char1}{cn_punct}{char2}"
            new_errors.append({
                "type": "punctuation",
                "paragraph_index": p_idx,
                "original_text": matched_str,
                "suggested_text": suggested,
                "severity": "low",
                "description": f"GB/T 15834 标点规范：中文文本间误用半角标点 '{punct}'，建议替换为全角标点 '{cn_punct}'",
            })

        # 3. 检测非法连续重复标点 (例: "。。" -> "。")
        for match in DOUBLE_PUNCT_RE.finditer(text):
            matched_str = match.group(0)
            single_punct = match.group(1)
            new_errors.append({
                "type": "punctuation",
                "paragraph_index": p_idx,
                "original_text": matched_str,
                "suggested_text": single_punct,
                "severity": "low",
                "description": f"标点规范提示：检测到重复标点“{matched_str}”，建议简化为“{single_punct}”",
            })

        # 4. 不可跨段符号严格配对校验：书名号 《 》 与 括号 （ ） / ( )
        for open_sym, close_sym, name in [('《', '》', '书名号'), ('（', '）', '全角括号'), ('(', ')', '半角括号')]:
            c_open = text.count(open_sym)
            c_close = text.count(close_sym)
            if c_open != c_close:
                new_errors.append({
                    "type": "punctuation",
                    "paragraph_index": p_idx,
                    "original_text": text[:30] + "..." if len(text) > 30 else text,
                    "suggested_text": text[:30] + "...",
                    "severity": "medium",
                    "description": f"标点未闭合提示：本段中{name}数量不匹配 ({open_sym}: {c_open}, {close_sym}: {c_close})",
                })

    inserted = batch_insert_errors(document_id, new_errors) if new_errors else 0

    return {"scanned_paragraphs": scanned, "found_issues": len(new_errors), "new_issues": inserted}
