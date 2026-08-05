"""
实体预扫描器 (Entity Pre-Scanner)

文档导入时在后台通过 jieba / n-gram / 对话提取生成实体词典 (entity_dictionary)。
预扫描结果仅作为 Stage 0 识别与 pick_canonical 的参考，严禁进入 Stage 1 主校对上下文。

v2.4.1：改为「异步分块协作式」扫描，块间 await asyncio.sleep(0) 让出事件循环，
避免 CPU 密集扫描饿死 GIL 导致前端白屏；并增加扫描状态跟踪 (running/completed/failed)。
"""
import re
import asyncio
import logging
import uuid
from collections import Counter
from typing import List, Dict, Optional, Tuple
import jieba
import jieba.posseg as pseg
from app.core.database import get_conn

logger = logging.getLogger(__name__)

# 扫描状态 (project_id -> running/completed/failed)
_SCAN_STATUS: Dict[str, str] = {}
_ENTITY_COUNT: Dict[str, int] = {}

# 全局词典过期状态感知 (project_id -> bool)
_DICTIONARY_EXPIRED_STATUS: Dict[str, bool] = {}

# 分块大小：每块处理约 5 万字后让出事件循环
_SCAN_CHUNK_SIZE = 50000


def mark_dictionary_expired(project_id: str):
    """标记项目的实体词典可能已过期（例如校对完大篇幅段落后）。"""
    _DICTIONARY_EXPIRED_STATUS[project_id] = True

def is_dictionary_expired(project_id: str) -> bool:
    """获取项目的实体词典是否过期。"""
    return _DICTIONARY_EXPIRED_STATUS.get(project_id, False)

def clear_dictionary_expired(project_id: str):
    """清除过期标记。"""
    _DICTIONARY_EXPIRED_STATUS[project_id] = False


def set_scan_status(project_id: str, status: str, count: Optional[int] = None):
    """设置扫描状态。"""
    _SCAN_STATUS[project_id] = status
    if count is not None:
        _ENTITY_COUNT[project_id] = count

def get_scan_status(project_id: str) -> Tuple[str, int]:
    """获取扫描状态与已提取实体数。返回 (status, entity_count)。"""
    return _SCAN_STATUS.get(project_id, "idle"), _ENTITY_COUNT.get(project_id, 0)


def _accumulate_chunk(text: str,
                      jieba_counter: Counter,
                      dialogue_counter: Counter,
                      ngram_counter: Counter):
    """对一段文本累积 jieba / 对话 / n-gram 词频到共享计数器（可被分块调用）。"""
    if not text:
        return

    # 1. jieba 分词与词性标注
    try:
        words = pseg.cut(text)
        for w, flag in words:
            w = w.strip()
            if 2 <= len(w) <= 8 and flag in ("nr", "nz", "n"):
                if not re.match(r"^[\u4e00-\u9fa5]+$", w):
                    continue
                jieba_counter[w] += 1
    except Exception as e:
        logger.warning("jieba posseg cut failed: %s", e)

    # 2. 对话提取 (引语中的称呼/人名)
    quotes = re.findall(r'[“"『]([^”"』]+)[”"』]', text)
    for q in quotes:
        m = re.search(r'^([\u4e00-\u9fa5]{2,4})[，,！!？?]', q)
        if m:
            dialogue_counter[m.group(1)] += 1

    # 3. 2-4 字 n-gram 高频词累积
    clean_text = re.sub(r'[^\u4e00-\u9fa5]', '', text)
    for n in (2, 3, 4):
        for i in range(len(clean_text) - n + 1):
            ngram_counter[clean_text[i:i + n]] += 1


def _build_entities(jieba_counter: Counter,
                    dialogue_counter: Counter,
                    ngram_counter: Counter,
                    jieba_limit: int = 200,
                    dialogue_limit: int = 50,
                    ngram_min_freq: int = 5) -> List[Dict[str, object]]:
    """由累积计数器组装最终实体列表（按源去重、限额）。"""
    results: List[Dict[str, object]] = []
    seen: set = set()

    for name, freq in jieba_counter.most_common(jieba_limit):
        results.append({"name": name, "frequency": freq, "source": "jieba"})
        seen.add(name)

    for name, freq in dialogue_counter.most_common(dialogue_limit):
        if name not in seen:
            results.append({"name": name, "frequency": freq, "source": "dialogue"})
            seen.add(name)

    for name, freq in ngram_counter.items():
        if freq >= ngram_min_freq and name not in seen:
            results.append({"name": name, "frequency": freq, "source": "ngram"})
            seen.add(name)

    return results


def scan_text_entities(text: str) -> List[Dict[str, object]]:
    """
    扫描文本中的候选实体（单次全量版，供测试与同步路径使用）：
    1. jieba posseg 提取人名/名词 (source: jieba)
    2. 对话引号内人名呼告 (source: dialogue)
    3. n-gram (2-4字) 高频词 (source: ngram)
    """
    if not text:
        return []
    jieba_counter, dialogue_counter, ngram_counter = Counter(), Counter(), Counter()
    _accumulate_chunk(text, jieba_counter, dialogue_counter, ngram_counter)
    return _build_entities(jieba_counter, dialogue_counter, ngram_counter)


def _load_full_text(project_id: str) -> str:
    """读取项目当前文档全部段落文本。"""
    with get_conn() as conn:
        rows = conn.execute("""
            SELECT p.text FROM paragraphs p
            JOIN documents d ON p.document_id = d.id
            WHERE d.project_id = ? AND d.is_current = 1 AND p.is_deleted = 0
            ORDER BY p.idx ASC
        """, (project_id,)).fetchall()
    return "\n".join(r["text"] for r in rows if r["text"])


def _write_entities(project_id: str, entities: List[Dict[str, object]]) -> int:
    """清除旧词典并写入新实体（同一事务，原子）。"""
    with get_conn() as conn:
        conn.execute("DELETE FROM entity_dictionary WHERE project_id = ?", (project_id,))
        for e in entities:
            conn.execute("""
                INSERT INTO entity_dictionary (id, project_id, name, frequency, source)
                VALUES (?, ?, ?, ?, ?)
            """, (str(uuid.uuid4()), project_id, e["name"], e["frequency"], e["source"]))
    return len(entities)


def run_pre_scanner(project_id: str) -> int:
    """
    同步全量扫描（供测试 / 兜底）：运行实体预扫描并返回实体数量。
    """
    set_scan_status(project_id, "running")
    try:
        full_text = _load_full_text(project_id)
        entities = scan_text_entities(full_text)
        count = _write_entities(project_id, entities)
        clear_dictionary_expired(project_id)
        set_scan_status(project_id, "completed", count)
        logger.info("Entity pre-scanner (sync) finished for %s: %d entities.", project_id, count)
        return count
    except Exception as ex:
        logger.warning("Entity pre-scanner failed for %s: %s", project_id, ex)
        set_scan_status(project_id, "failed")
        return 0


async def run_pre_scanner_async(project_id: str) -> int:
    """
    异步分块协作式扫描：分块处理并让出事件循环，避免 CPU 密集饿死 GIL。
    返回实体数量；异常时标记 failed 并返回 0。
    """
    set_scan_status(project_id, "running")
    try:
        full_text = _load_full_text(project_id)
        if not full_text:
            clear_dictionary_expired(project_id)
            set_scan_status(project_id, "completed", 0)
            return 0

        jieba_counter, dialogue_counter, ngram_counter = Counter(), Counter(), Counter()
        chunk_count = 0
        for i in range(0, len(full_text), _SCAN_CHUNK_SIZE):
            _accumulate_chunk(full_text[i:i + _SCAN_CHUNK_SIZE],
                              jieba_counter, dialogue_counter, ngram_counter)
            chunk_count += 1
            # 每处理一块让出事件循环，保证正文加载/轮询等请求能及时响应
            if chunk_count % 2 == 0:
                await asyncio.sleep(0)

        entities = _build_entities(jieba_counter, dialogue_counter, ngram_counter)
        count = _write_entities(project_id, entities)
        clear_dictionary_expired(project_id)
        set_scan_status(project_id, "completed", count)
        logger.info("Entity pre-scanner (async) finished for %s: %d entities.", project_id, count)
        return count
    except Exception as ex:
        logger.warning("Entity pre-scanner (async) failed for %s: %s", project_id, ex)
        set_scan_status(project_id, "failed")
        return 0
