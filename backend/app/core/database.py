"""
SQLite 数据库模块
数据库文件位置：backend/data/novel_proofreader.db

表结构：
- projects: 项目（一个小说 = 一个项目）
- documents: 文档版本（每个项目可有多个版本）
- chapters: 章节内容
- proofread_results: 校对结果
- errors: 校对发现的错误（含用户确认状态）
"""

import sqlite3
import os
import json
from contextlib import contextmanager

DB_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
DB_PATH = os.path.join(DB_DIR, "novel_proofreader.db")


DEFAULT_PROOFREAD_TYPES = '["typo","grammar","punctuation","format"]'


def _migrate_schema(conn):
    """一次性迁移：把旧的可再生表（chapters/proofread_results/errors）按新 schema 重建。

    通过 meta.schema_version 守卫，只在首次执行，重启不会清空数据。
    chapters/proofread_results/errors 都是可重新生成的，drop 安全。
    """
    cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'")
    version = 0
    if cur.fetchone():
        r = conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
        if r:
            version = int(r["value"])
    if version < 2:
        conn.executescript(
            "DROP TABLE IF EXISTS chapters; "
            "DROP TABLE IF EXISTS proofread_results; "
            "DROP TABLE IF EXISTS errors; "
        )
        conn.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
        conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '2')")
    for col in (
        "proofread_upto INTEGER NOT NULL DEFAULT 0",
        f"proofread_types TEXT NOT NULL DEFAULT '{DEFAULT_PROOFREAD_TYPES}'",
    ):
        try:
            conn.execute(f"ALTER TABLE documents ADD COLUMN {col}")
        except sqlite3.OperationalError:
            pass


def init_db():
    """初始化数据库，创建表结构。"""
    os.makedirs(DB_DIR, exist_ok=True)
    with get_conn() as conn:
        _migrate_schema(conn)
        conn.executescript("""
            -- 项目表
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                status TEXT DEFAULT 'new',  -- new|uploaded|parsed|proofreading|reviewing|completed
                current_document_id TEXT,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT DEFAULT (datetime('now', 'localtime'))
            );

            -- 文档版本表（每个项目可有多个版本）
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                file_path TEXT,
                version INTEGER DEFAULT 1,
                is_current INTEGER DEFAULT 1,
                proofread_upto INTEGER NOT NULL DEFAULT 0,
                proofread_types TEXT NOT NULL DEFAULT '["typo","grammar","punctuation","format"]',
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (project_id) REFERENCES projects(id)
            );

            -- 原始段落表（docx 解析后的唯一真相源，不拆分章节）
            CREATE TABLE IF NOT EXISTS paragraphs (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                idx INTEGER NOT NULL,
                text TEXT NOT NULL,
                revised_text TEXT,
                style_name TEXT,
                char_count INTEGER,
                UNIQUE (document_id, idx),
                FOREIGN KEY (document_id) REFERENCES documents(id)
            );

            -- 章节表（由 LLM 渐进式识别，支持主/副标题层级）
            CREATE TABLE IF NOT EXISTS chapters (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                title TEXT,
                title_paragraph_idx INTEGER,
                level INTEGER NOT NULL DEFAULT 1,  -- 1=主(章/卷) 2=副(节)
                parent_idx INTEGER,                 -- 副标题指向所属主标题的 title_paragraph_idx
                start_idx INTEGER NOT NULL,
                end_idx INTEGER NOT NULL,
                sort_order INTEGER NOT NULL,
                detected_by TEXT DEFAULT 'llm',
                confidence REAL DEFAULT 1.0,
                FOREIGN KEY (document_id) REFERENCES documents(id)
            );

            -- 校对窗口结果（内部按 W=30 段落切片，不暴露给用户）
            CREATE TABLE IF NOT EXISTS proofread_results (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                window_start INTEGER NOT NULL,
                window_end INTEGER NOT NULL,
                model TEXT,
                status TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (document_id) REFERENCES documents(id)
            );

            -- 错误表（按 document_id 聚合，含用户确认状态）
            CREATE TABLE IF NOT EXISTS errors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                document_id TEXT NOT NULL,
                paragraph_index INTEGER DEFAULT 0,
                type TEXT NOT NULL,
                original_text TEXT,
                suggested_text TEXT,
                severity TEXT DEFAULT 'medium',
                description TEXT,
                user_status TEXT DEFAULT 'pending',  -- pending|accepted|rejected
                chapter_id TEXT,
                FOREIGN KEY (document_id) REFERENCES documents(id)
            );
        """)
        try:
            conn.execute("ALTER TABLE documents ADD COLUMN last_error TEXT")
        except sqlite3.OperationalError:
            pass


@contextmanager
def get_conn():
    """获取数据库连接（自动提交/关闭）。"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


# ==================== Projects ====================

def create_project(project_id: str, name: str) -> dict:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO projects (id, name) VALUES (?, ?)",
            (project_id, name),
        )
        return dict(conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone())


def get_project(project_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        return dict(row) if row else None


def list_projects() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM projects ORDER BY updated_at DESC").fetchall()
        return [dict(r) for r in rows]


def update_project_status(project_id: str, status: str):
    with get_conn() as conn:
        conn.execute(
            "UPDATE projects SET status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?",
            (status, project_id),
        )


def update_project_document(project_id: str, document_id: str):
    with get_conn() as conn:
        conn.execute(
            "UPDATE projects SET current_document_id = ?, updated_at = datetime('now', 'localtime') WHERE id = ?",
            (document_id, project_id),
        )


def delete_project(project_id: str):
    with get_conn() as conn:
        doc_rows = conn.execute("SELECT id FROM documents WHERE project_id = ?", (project_id,)).fetchall()
        for doc in doc_rows:
            doc_id = doc["id"]
            conn.execute("DELETE FROM errors WHERE document_id = ?", (doc_id,))
            conn.execute("DELETE FROM proofread_results WHERE document_id = ?", (doc_id,))
            conn.execute("DELETE FROM chapters WHERE document_id = ?", (doc_id,))
            conn.execute("DELETE FROM paragraphs WHERE document_id = ?", (doc_id,))
        conn.execute("DELETE FROM documents WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))


# ==================== Documents (版本管理) ====================

def create_document(doc_id: str, project_id: str, filename: str, file_path: str, version: int = 1) -> dict:
    with get_conn() as conn:
        # 将旧版本标记为非当前
        conn.execute(
            "UPDATE documents SET is_current = 0 WHERE project_id = ?",
            (project_id,),
        )
        conn.execute(
            "INSERT INTO documents (id, project_id, filename, file_path, version, is_current) VALUES (?, ?, ?, ?, ?, 1)",
            (doc_id, project_id, filename, file_path, version),
        )
        return dict(conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone())


def get_current_document(project_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM documents WHERE project_id = ? AND is_current = 1",
            (project_id,),
        ).fetchone()
        return dict(row) if row else None


def get_document(doc_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
        return dict(row) if row else None


def get_document_versions(project_id: str) -> list[dict]:
    """获取项目的所有版本（按版本号降序）。"""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM documents WHERE project_id = ? ORDER BY version DESC",
            (project_id,),
        ).fetchall()
        return [dict(r) for r in rows]


# ==================== Chapters ====================

def insert_chapter(
    chapter_id: str,
    document_id: str,
    title: str | None,
    title_paragraph_idx: int | None,
    level: int,
    parent_idx: int | None,
    start_idx: int,
    end_idx: int,
    sort_order: int,
) -> str:
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO chapters
               (id, document_id, title, title_paragraph_idx, level, parent_idx, start_idx, end_idx, sort_order)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (chapter_id, document_id, title, title_paragraph_idx, level, parent_idx, start_idx, end_idx, sort_order),
        )
        return chapter_id


def get_chapters(document_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM chapters WHERE document_id = ? ORDER BY sort_order",
            (document_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def delete_chapters(document_id: str):
    """清空某文档的章节（重新校对前清理，便于 LLM 渐进式重建）。"""
    with get_conn() as conn:
        conn.execute("DELETE FROM chapters WHERE document_id = ?", (document_id,))


def delete_chapters_in_range(document_id: str, start_idx: int, end_idx: int):
    """删除与 [start_idx, end_idx) 重叠的章节（局部重校时清理旧结构）。"""
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM chapters WHERE document_id = ? AND start_idx < ? AND end_idx > ?",
            (document_id, end_idx, start_idx),
        )


def copy_chapters(src_doc_id: str, dst_doc_id: str):
    """复制章节到新版本（旧版本模型用，Stage4 重写 apply 后删除）。"""
    chapters = get_chapters(src_doc_id)
    with get_conn() as conn:
        for ch in chapters:
            conn.execute(
                """INSERT INTO chapters
                   (id, document_id, title, title_paragraph_idx, level, parent_idx, start_idx, end_idx, sort_order)
                   VALUES (?, ?, ?, ?, 1, NULL, 0, 0, ?)""",
                (f"{dst_doc_id}:{ch['id']}", dst_doc_id, ch.get("title"), ch.get("title_paragraph_idx"), ch.get("sort_order", 0)),
            )


# ==================== Paragraphs（原始段落，唯一真相源） ====================

def insert_paragraphs(document_id: str, rows: list[tuple]):
    """批量写入段落。rows: [(idx, text, style_name), ...]"""
    with get_conn() as conn:
        conn.executemany(
            """INSERT OR REPLACE INTO paragraphs (id, document_id, idx, text, style_name, char_count)
               VALUES (?, ?, ?, ?, ?, ?)""",
            [
                (f"{document_id}:{idx}", document_id, idx, text, style_name, len(text))
                for (idx, text, style_name) in rows
            ],
        )


def get_paragraphs(document_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM paragraphs WHERE document_id = ? ORDER BY idx",
            (document_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_paragraph_count(document_id: str) -> int:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS c FROM paragraphs WHERE document_id = ?",
            (document_id,),
        ).fetchone()
        return int(row["c"]) if row else 0


def get_paragraph_text(document_id: str, idx: int) -> str:
    """导出时用：revised_text 优先，否则原文。"""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT text, revised_text FROM paragraphs WHERE document_id = ? AND idx = ?",
            (document_id, idx),
        ).fetchone()
        if not row:
            return ""
        return row["revised_text"] if row["revised_text"] is not None else row["text"]


def get_paragraph_by_idx(document_id: str, idx: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM paragraphs WHERE document_id = ? AND idx = ?",
            (document_id, idx),
        ).fetchone()
        return dict(row) if row else None


def update_paragraph_revised(paragraph_id: str, revised_text: str):
    with get_conn() as conn:
        conn.execute(
            "UPDATE paragraphs SET revised_text = ? WHERE id = ?",
            (revised_text, paragraph_id),
        )


def get_revised_paragraphs(document_id: str) -> list[dict]:
    """导出：返回所有段落，revised_text ?? text。"""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT idx, COALESCE(revised_text, text) AS text, revised_text IS NOT NULL AS has_rev FROM paragraphs WHERE document_id = ? ORDER BY idx",
            (document_id,),
        ).fetchall()
        return [dict(r) for r in rows]


# ==================== Proofread Windows（内部切片，W=30） ====================

def insert_window_result(result_id: str, document_id: str, window_start: int, window_end: int, model: str, status: str) -> str:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO proofread_results (id, document_id, window_start, window_end, model, status) VALUES (?, ?, ?, ?, ?, ?)",
            (result_id, document_id, window_start, window_end, model, status),
        )
        return result_id


def get_window_results(document_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM proofread_results WHERE document_id = ? ORDER BY window_start",
            (document_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def update_window_status(result_id: str, status: str):
    with get_conn() as conn:
        conn.execute("UPDATE proofread_results SET status = ? WHERE id = ?", (status, result_id))


# ==================== Errors（按 document_id 聚合） ====================

def insert_error(document_id: str, err: dict):
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO errors
               (document_id, type, paragraph_index, original_text, suggested_text, severity, description, chapter_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                document_id,
                err.get("type", "typo"),
                err.get("paragraph_index", 0),
                err.get("original_text", ""),
                err.get("suggested_text", ""),
                err.get("severity", "medium"),
                err.get("description", ""),
                err.get("chapter_id", ""),
            ),
        )


def delete_errors_in_range(document_id: str, start_idx: int, end_idx: int):
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM errors WHERE document_id = ? AND paragraph_index >= ? AND paragraph_index < ?",
            (document_id, start_idx, end_idx),
        )


def delete_all_errors(document_id: str):
    with get_conn() as conn:
        conn.execute("DELETE FROM errors WHERE document_id = ?", (document_id,))
        conn.execute("DELETE FROM proofread_results WHERE document_id = ?", (document_id,))


def get_errors(document_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM errors WHERE document_id = ? ORDER BY paragraph_index",
            (document_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def update_error_status(error_id: int, status: str):
    """更新用户对某条错误的确认状态（accepted/rejected）。"""
    with get_conn() as conn:
        conn.execute("UPDATE errors SET user_status = ? WHERE id = ?", (status, error_id))


def update_error_suggested(error_id: int, suggested: str):
    """更新某条错误的 suggested_text（用户手动编辑）。"""
    with get_conn() as conn:
        conn.execute("UPDATE errors SET suggested_text = ? WHERE id = ?", (suggested, error_id))


def get_accepted_errors(document_id: str) -> list[dict]:
    """获取用户已采纳的错误（用于应用修改）。"""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM errors WHERE document_id = ? AND user_status = 'accepted' ORDER BY paragraph_index",
            (document_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_error(error_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM errors WHERE id = ?", (error_id,)).fetchone()
        return dict(row) if row else None


# ==================== 进度（段落级，跨重启可恢复） ====================

def set_proofread_progress(document_id: str, upto: int, proofread_types: list[str] | None = None):
    with get_conn() as conn:
        if proofread_types is not None:
            conn.execute(
                "UPDATE documents SET proofread_upto = ?, proofread_types = ? WHERE id = ?",
                (upto, json.dumps(proofread_types, ensure_ascii=False), document_id),
            )
        else:
            conn.execute(
                "UPDATE documents SET proofread_upto = ? WHERE id = ?",
                (upto, document_id),
            )


def set_document_error(document_id: str, message: str):
    with get_conn() as conn:
        conn.execute(
            "UPDATE documents SET last_error = ? WHERE id = ?",
            (message, document_id),
        )


def clear_document_error(document_id: str):
    with get_conn() as conn:
        conn.execute(
            "UPDATE documents SET last_error = NULL WHERE id = ?",
            (document_id,),
        )


def get_document_progress(document_id: str) -> dict:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT proofread_upto, proofread_types FROM documents WHERE id = ?",
            (document_id,),
        ).fetchone()
        if not row:
            return {"proofread_upto": 0, "proofread_types": json.loads(DEFAULT_PROOFREAD_TYPES)}
        types = row["proofread_types"]
        return {
            "proofread_upto": row["proofread_upto"],
            "proofread_types": json.loads(types) if types else json.loads(DEFAULT_PROOFREAD_TYPES),
        }


# ==================== Legacy compatibility（Stage3/4 改写调用方后删除） ====================

def insert_result(result_id: str, document_id: str, model: str):
    return insert_window_result(result_id, document_id, 0, 0, model, "legacy")


def delete_result(document_id: str):
    delete_all_errors(document_id)


def get_result(document_id: str) -> dict:
    return {
        "document_id": document_id,
        "windows": get_window_results(document_id),
        "errors": get_errors(document_id),
        "paragraphs": get_paragraphs(document_id),
        **get_document_progress(document_id),
        "chapters": get_chapters(document_id),
    }

# 启动时初始化表
init_db()
