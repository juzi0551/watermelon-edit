"""
SQLite 数据库模块

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
import uuid
import datetime
from contextlib import contextmanager
from app.utils.helpers import generate_id

DB_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
DB_PATH = os.path.join(DB_DIR, "novel_proofreader.db")


DEFAULT_PROOFREAD_TYPES = '["typo","grammar","punctuation","format"]'

DEFAULT_SYSTEM_PROMPT_PROOFREAD = """你是一名资深的中文小说校对与排版专家。你的任务是基于带有 [全局段落索引编号] 前缀的待校对正文，仔细查看每个段落，提取章节层级结构，并精准定位与修正特定类型的文本错误。

### 【校验依据与错误类型定义】
本次校对必须严格遵循中国国家出版标准。你需要检查并输出 {type_desc} 等以下类型的错误（即 `type` 对应的分类，并在 `description` 中简述）：

1. 标点错误 (type: "punctuation")：
   - 依据：《标点符号用法》（GB/T 15834-2011）。
   - 定义：重点检查跨段引号不合规（见下文详述）、标点误用（如中英文标点混用、连续多个句号代替省略号）、以及点号（句号、逗号、问号等）出现在行首的排版禁忌。
2. 错别字 (type: "typo")：
   - 依据：《现代汉语词典》（第7版）及《出版物汉字使用管理规定》。
   - 定义：同音错字、形近错字、多字漏字。必须严格区分结构助词“的、地、得”的标准语法场景。严禁干涉作者有意的修辞性造词或网络生造词（如无绝对把握，视为无错）。
3. 语法错误 (type: "grammar")：
   - 定义：语序不当、搭配不当（如动宾搭配不当、量名词搭配不当）、成分残缺或赘余、句式杂糅等语法语病。
4. 格式不一致 (type: "format")：
   - 定义：段首空格杂乱、中英文间距不一致、非标准全半角字符混用、排版符号格式混乱等问题。
5. 数字用法不规范 (type: "number")：
   - 依据：《出版物上数字用法》（GB/T 15835-2011）。
   - 定义：阿拉伯数字与汉字数字的混用不当（如“二〇二三年”错写为“202三年”），以及计量单位前的数字格式错误。
6. 常识与逻辑硬伤 (type: "logic")：
   - 定义：同一段落或紧邻段落内出现明显的前后矛盾（如角色名字写错、称呼混乱、时间线颠倒）。仅指出绝对的逻辑硬伤，严禁干涉正常的艺术虚构。
7. 文风与风格润色建议 (type: "style")：
   - 依据：结合【作者设定与世界观背景】中的文风与风格偏好。
   - 定义：检测表达平淡、修饰冗余、用词重复或与作者设定文风不符的语句，提供贴合作者个人写作特色的提质润色替换方案。

### 【结构识别规则】
需精准识别文本内的章节结构，基于提取到的索引编号进行区间划分（支持 1~6 级大纲）：
1. 卷/部级别（主标题）：定义为 level=1。
2. 章/节/篇/目/细目级别（子标题）：定义为 level=2 ~ level=6。当 level >= 2 时，必须明确输出 `parent_idx`（所属最近的上级标题的 `title_paragraph_idx`）。
3. 字段约束：所有返回的索引必须与段落开头的 [全局段落索引编号] 严格一致。严禁凭空捏造、推算或编造原文中未实际出现的索引编号。
4. 区间定义：`end_idx` 为包含边界（即区间包含该结尾段落本身）。

### 【纠错与定位规则】
1. 来源保真：`locator` 必须直接从原文逐字复制，严禁包含任何修改。`paragraph_index` 必须真实存在于输入文本中。
2. 唯一性防偏：`locator` 长度必须至少包含 5 个字符，以确保该片段在当前段落内具有唯一性。
3. 替换精准与锚定原则（极重要）：
   - 基础要求：`locator` 和 `replacement` 必须是严格对应的「原文版」和「修正版」。`locator` 提取包含错误的文本及前后相邻文字。`replacement` 必须与 `locator` 文本范围完全对齐，严禁擅自扩大输出范围或加入解释性文字。`description` 使用 5-10 个字的简短说明准确概括错误原因。
   - 标点修改特例（警告）：当需要修改已存在的错误标点时，`locator` **必须且绝对**包含该错误标点符号本身。严禁在 `locator` 中因语法直觉而擅自截断或丢弃末尾的错误标点！`locator` 必须是原文的“无损切片”。
   - 标点缺失特例：若是缺失标点，`locator` 提取目标位置前后文字作为锚点，`replacement` 在该位置补上标点。
   - 逻辑错误特例：当 type 为 "logic" 时，`description` 可输出针对该处情节矛盾的解释性文字，不受上述严格字数对齐限制。
4. 多错隔离：同一段落存在多个错误时，各 `locator` 的文本范围必须避免包含、重叠或互斥。
5. 严重程度限定：`severity` 字段的值必须且仅限为 "low"、"medium"、"high" 三者之一。

### 【特殊：跨段引号检查】
1. 规范：当人物对话或引文跨越多个自然段时，每个段落开头必须有左引号，但仅在最后一段末尾使用右引号。
2. 检测：若前段以左引号开头且无右引号收尾，后段开头却没有左引号，即判定后段缺失左引号。
3. 修正：在缺失引号的段落报错（type: "punctuation"）。提取该段前 5-10 个字作为 `locator`，`replacement` 在最前方补上对应的引号字符。

### 【人物与剧情关键事件萃取规则】
在校对段落文本的同时，分析段落中登场的人物与发生的事件：
1. **角色信息与更新**：若有新登场或重要的角色，在 `character_updates` 数组中输出 `name`（姓名）、`aliases`（别名数组）、`role`（protagonist/antagonist/supporting 三者之一）、`first_appear_idx`（在当前段落切片中首次登场的段落索引）与 `description`（角色身份与背景最新完整说明）；若段落中对【已知角色】揭示了新的身份背景、重要经历、性格转折或重大变故，亦在 `description` 中提供结合最新信息的完整介绍；
2. **角色关系演进**：若文中发生角色间的关系建立或动态转变（如结盟、敌对、倾慕、拜师、背叛等），在 `relationship_events` 数组中输出 `from`（角色A姓名）、`to`（角色B姓名）、`type`（ally/enemy/lover/family/neutral）、`description`（事件与关系简述）与发生的具体段落索引 `paragraph_idx`；
3. **剧情关键事件**：若文中发生重大的剧情节点或非人物关系关键事件，在 `plot_events` 数组中输出 `title`（事件标题）、`description`（事件简述）与发生的具体段落索引 `paragraph_idx`。

### 【输出格式】
严格按照以下 JSON 格式输出结果。若某类数据不存在，对应的数组返回空 `[]`。
严禁输出任何分析过程、解释说明或 Markdown 代码块标记（如 ```json），只返回纯 JSON 字符串：

{
  "chapters": [
    {"level": 1, "title": "第一卷 风起云涌", "title_paragraph_idx": 0, "start_idx": 0, "end_idx": 4},
    {"level": 2, "title": "第一章 少年初长", "title_paragraph_idx": 5, "parent_idx": 0, "start_idx": 5, "end_idx": 8}
  ],
  "errors": [
    {"type": "typo", "paragraph_index": 1, "locator": "他是一个渴望成才的少年", "replacement": "他是一个渴望成材的少年", "severity": "medium", "description": "同音错别字"},
    {"type": "punctuation", "paragraph_index": 2, "locator": "这件事交给我！“", "replacement": "这件事交给我！”", "severity": "medium", "description": "右引号错为左引号"},
    {"type": "logic", "paragraph_index": 3, "locator": "张三看了看自己手中的剑", "replacement": "李四看了看自己手中的剑", "severity": "high", "description": "角色名字或描述前后矛盾，建议张三修改为李四，前文描述持剑者为李四"},
    {"type": "style", "paragraph_index": 4, "locator": "他的心里感到极为非常地悲伤", "replacement": "他心中极为悲怆", "severity": "low", "description": "符合作者指定冷硬文风的润色建议"}
  ],
  "character_updates": [
    {"name": "智星", "aliases": ["老大"], "role": "protagonist", "first_appear_idx": 0, "description": "沿河村少年，聪明机敏，三人中排行老大"}
  ],
  "relationship_events": [
    {"from": "智星", "to": "看瓜老爷爷", "type": "neutral", "description": "智星带伙伴给看瓜老爷爷捶背，试图套近乎", "paragraph_idx": 2}
  ],
  "plot_events": [
    {"title": "智取西瓜设局", "description": "少年们前往河滩西瓜地试图通过软磨硬泡吃西瓜", "paragraph_idx": 2}
  ]
}"""


DEFAULT_CHAT_SYSTEM_PROMPT = """你是一位温和专业的资深中文小说编辑，正与作者并肩工作。

你的工作方式：
1. 先指出这段文字的亮点，再提改进建议——批评永远包裹在建设性意见里。
2. 针对【选中的文字】给出意见，不要越界修改未被选中的内容。
3. 每条建议说明"为什么"（节奏、语感、视角、信息密度等），并给出 1~2 个可替换的写法示例。
4. 尊重作者的文风与表达习惯，不把个人偏好强加给作者。
5. 若原文已足够好，请直说"这段很好，不需要改"，不要为了提建议而提建议。
6. 语气像一位懂小说的同行，而不是机器。"""


def _init_default_settings(conn):
    defaults = {
        "system_prompt_proofread": DEFAULT_SYSTEM_PROMPT_PROOFREAD,
        "system_prompt_chat": DEFAULT_CHAT_SYSTEM_PROMPT,
        "chat_context_chars": "100",
    }
    for key, value in defaults.items():
        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
            (key, value),
        )


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
    try:
        conn.execute("ALTER TABLE documents ADD COLUMN last_error TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE paragraphs ADD COLUMN has_page_break_before INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE paragraphs ADD COLUMN page_break_type TEXT DEFAULT 'none'")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE paragraphs ADD COLUMN edit_note TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE projects ADD COLUMN is_locked INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    if version < 3:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
        conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '3')")
    _init_default_settings(conn)
    if version < 4:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS llm_logs (
                id TEXT PRIMARY KEY,
                project_id TEXT,
                doc_id TEXT,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                model TEXT NOT NULL,
                mode TEXT,
                range_start INTEGER,
                range_end INTEGER,
                prompt TEXT,
                system_prompt TEXT,
                selected_types TEXT,
                status TEXT NOT NULL DEFAULT 'ok',
                duration_ms INTEGER,
                error_message TEXT,
                response_raw TEXT,
                errors_found INTEGER DEFAULT 0,
                chapters_found INTEGER DEFAULT 0
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_llm_logs_project ON llm_logs(project_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_llm_logs_created ON llm_logs(created_at)")
        conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '4')")
    for col in (
        "prompt_tokens INTEGER",
        "completion_tokens INTEGER",
        "total_tokens INTEGER",
        "cost REAL",
    ):
        try:
            conn.execute(f"ALTER TABLE llm_logs ADD COLUMN {col}")
        except sqlite3.OperationalError:
            pass
    if version < 5:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS proofread_batches (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                range_start INTEGER NOT NULL,
                range_end INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'running',
                total_windows INTEGER NOT NULL DEFAULT 0,
                done_windows INTEGER NOT NULL DEFAULT 0,
                failed_windows INTEGER NOT NULL DEFAULT 0,
                retry_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (document_id) REFERENCES documents(id)
            );
            CREATE INDEX IF NOT EXISTS idx_batches_doc ON proofread_batches(document_id);

            CREATE TABLE IF NOT EXISTS batch_windows (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                batch_id TEXT NOT NULL,
                window_index INTEGER NOT NULL,
                range_start INTEGER NOT NULL,
                range_end INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                error_message TEXT,
                retry_count INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (batch_id) REFERENCES proofread_batches(id)
            );
            CREATE INDEX IF NOT EXISTS idx_bw_batch ON batch_windows(batch_id);
        """)
        conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '5')")

    for col in (
        "author_name TEXT",
        "author_intro TEXT",
        "background_setting TEXT",
        "theme_mode TEXT DEFAULT 'system'",
        "style_config_xml TEXT",
    ):
        try:
            conn.execute(f"ALTER TABLE projects ADD COLUMN {col}")
        except sqlite3.OperationalError:
            pass

    if version < 6:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS characters (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                aliases TEXT,
                role TEXT,
                first_appear_idx INTEGER DEFAULT 0,
                description TEXT,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (project_id) REFERENCES projects(id)
            );
            CREATE INDEX IF NOT EXISTS idx_chars_proj ON characters(project_id);

            CREATE TABLE IF NOT EXISTS character_relationships (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                from_char_id TEXT NOT NULL,
                to_char_id TEXT NOT NULL,
                relation_type TEXT NOT NULL,
                description TEXT,
                paragraph_idx INTEGER NOT NULL DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (project_id) REFERENCES projects(id)
            );
            CREATE INDEX IF NOT EXISTS idx_rel_proj ON character_relationships(project_id);
            CREATE INDEX IF NOT EXISTS idx_rel_para ON character_relationships(paragraph_idx);

            CREATE TABLE IF NOT EXISTS glossary_terms (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                term TEXT NOT NULL,
                category TEXT DEFAULT 'custom',
                std_replacement TEXT,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (project_id) REFERENCES projects(id)
            );
            CREATE INDEX IF NOT EXISTS idx_glossary_proj ON glossary_terms(project_id);
        """)
        conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '6')")

    if version < 7:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS plot_events (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                paragraph_idx INTEGER NOT NULL DEFAULT 0,
                title TEXT NOT NULL,
                description TEXT,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (project_id) REFERENCES projects(id)
            );
            CREATE INDEX IF NOT EXISTS idx_pe_proj ON plot_events(project_id);
            CREATE INDEX IF NOT EXISTS idx_pe_para ON plot_events(paragraph_idx);
        """)
        conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '7')")

    if version < 8:
        # paragraphs: 新增 uuid 业务标识列（允许 NULL，由迁移脚本填充）
        for stmt in (
            "ALTER TABLE paragraphs ADD COLUMN uuid TEXT DEFAULT NULL",
            "ALTER TABLE errors ADD COLUMN paragraph_uuid TEXT DEFAULT NULL",
            "ALTER TABLE chapters ADD COLUMN title_paragraph_uuid TEXT DEFAULT NULL",
            "ALTER TABLE chapters ADD COLUMN parent_uuid TEXT DEFAULT NULL",
            "ALTER TABLE chapters ADD COLUMN start_paragraph_uuid TEXT DEFAULT NULL",
            "ALTER TABLE chapters ADD COLUMN end_paragraph_uuid TEXT DEFAULT NULL",
            "ALTER TABLE characters ADD COLUMN first_appear_paragraph_uuid TEXT DEFAULT NULL",
            "ALTER TABLE character_relationships ADD COLUMN paragraph_uuid TEXT DEFAULT NULL",
            "ALTER TABLE plot_events ADD COLUMN paragraph_uuid TEXT DEFAULT NULL",
        ):
            try:
                conn.execute(stmt)
            except sqlite3.OperationalError:
                pass  # 列已存在，跳过（幂等）
        # paragraphs.uuid 唯一索引（仅对非 NULL 值生效，SQLite partial index）
        try:
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_para_uuid ON paragraphs(uuid) WHERE uuid IS NOT NULL"
            )
        except sqlite3.OperationalError:
            pass

        # Task 2：最小回填（幂等，WHERE uuid IS NULL 防止重复写入）
        # Step 1：为历史段落生成 uuid
        has_paras = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='paragraphs'").fetchone()
        if has_paras:
            para_rows = conn.execute(
                "SELECT id FROM paragraphs WHERE uuid IS NULL"
            ).fetchall()
            if para_rows:
                conn.executemany(
                    "UPDATE paragraphs SET uuid = ? WHERE id = ?",
                    [(generate_id(), r["id"]) for r in para_rows],
                )
            # Step 2：用 idx 关系回填 errors.paragraph_uuid
            conn.execute(
                """UPDATE errors
                   SET paragraph_uuid = (
                       SELECT p.uuid FROM paragraphs p
                       WHERE p.idx = errors.paragraph_index
                         AND p.document_id = errors.document_id
                   )
                   WHERE paragraph_uuid IS NULL"""
            )

        conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '8')")

    if version < 9:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                title TEXT DEFAULT '新对话',
                model TEXT,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                updated_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (project_id) REFERENCES projects(id)
            );
            CREATE INDEX IF NOT EXISTS idx_chat_sess_proj ON chat_sessions(project_id);

            CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                context TEXT,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
            );
            CREATE INDEX IF NOT EXISTS idx_chat_msgs_session ON chat_messages(session_id);
        """)
        conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '9')")



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
                is_locked INTEGER DEFAULT 0,
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
                has_page_break_before INTEGER DEFAULT 0,
                page_break_type TEXT DEFAULT 'none',
                uuid TEXT DEFAULT NULL,
                UNIQUE (document_id, idx),
                FOREIGN KEY (document_id) REFERENCES documents(id)
            );

            -- 章节表（支持原文/LLM识别/人工设定的来源区分与主副标题层级）
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
                detected_by TEXT DEFAULT 'original',
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
        try:
            conn.execute("ALTER TABLE errors ADD COLUMN source TEXT DEFAULT 'llm'")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE errors ADD COLUMN is_obsolete INTEGER DEFAULT 0")
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


DEFAULT_STYLE_CONFIG_XML = """<DocStyleConfig version="1.0">
  <FirstLineIndent enabled="0" chars="2.0" dxa="420"/>
  <LineSpacing rule="auto" val="360"/>
  <ParagraphSpacing before="0" after="0"/>
</DocStyleConfig>"""


def parse_style_config_xml(xml_str: str | None) -> dict:
    """使用 lxml 解析 style_config_xml 架构文本。"""
    default_res = {"first_line_indent_enabled": False, "chars": "2.0", "dxa": 420}
    if not xml_str or not xml_str.strip():
        return default_res
    try:
        from lxml import etree
        root = etree.fromstring(xml_str.encode("utf-8"))
        indent_node = root.find("FirstLineIndent")
        if indent_node is not None:
            enabled = indent_node.get("enabled") == "1"
            chars = indent_node.get("chars", "2.0")
            dxa = int(indent_node.get("dxa", "420"))
            return {
                "first_line_indent_enabled": enabled,
                "chars": chars,
                "dxa": dxa,
            }
    except Exception:
        pass
    return default_res


def get_project_style_config(project_id: str) -> dict:
    with get_conn() as conn:
        row = conn.execute("SELECT style_config_xml FROM projects WHERE id = ?", (project_id,)).fetchone()
        xml_str = row["style_config_xml"] if row else None
        return parse_style_config_xml(xml_str)


def set_project_first_line_indent(project_id: str, enabled: bool) -> str:
    from lxml import etree
    with get_conn() as conn:
        row = conn.execute("SELECT style_config_xml FROM projects WHERE id = ?", (project_id,)).fetchone()
        xml_str = (row["style_config_xml"] if row else None) or DEFAULT_STYLE_CONFIG_XML
        try:
            root = etree.fromstring(xml_str.encode("utf-8"))
        except Exception:
            root = etree.fromstring(DEFAULT_STYLE_CONFIG_XML.encode("utf-8"))
        
        indent_node = root.find("FirstLineIndent")
        if indent_node is None:
            indent_node = etree.SubElement(root, "FirstLineIndent")
            indent_node.set("chars", "2.0")
            indent_node.set("dxa", "420")
        
        indent_node.set("enabled", "1" if enabled else "0")
        new_xml = etree.tostring(root, encoding="utf-8", xml_declaration=True).decode("utf-8")
        conn.execute("UPDATE projects SET style_config_xml = ? WHERE id = ?", (new_xml, project_id))
        return new_xml


def get_project(project_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not row:
            return None
        res = dict(row)
        res["style_config"] = parse_style_config_xml(res.get("style_config_xml"))
        return res


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


def toggle_project_lock(project_id: str, is_locked: bool):
    """切换项目锁定/解锁状态。"""
    val = 1 if is_locked else 0
    with get_conn() as conn:
        conn.execute(
            "UPDATE projects SET is_locked = ?, updated_at = datetime('now', 'localtime') WHERE id = ?",
            (val, project_id),
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
        # 仅当为主章 (level == 1) 且该段当前为 'none' 且不是第 0 段时升级为 auto_chapter
        if title_paragraph_idx is not None and title_paragraph_idx > 0 and level == 1:
            conn.execute(
                """UPDATE paragraphs
                   SET has_page_break_before = 1, page_break_type = 'auto_chapter'
                   WHERE document_id = ? AND idx = ? AND page_break_type = 'none'""",
                (document_id, title_paragraph_idx),
            )
        return chapter_id


def get_chapters(document_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM chapters WHERE document_id = ? ORDER BY title_paragraph_idx ASC, sort_order ASC",
            (document_id,),
        ).fetchall()
        res = []
        for r in rows:
            d = dict(r)
            if not d.get("detected_by"):
                d["detected_by"] = "original"
            res.append(d)
        return res


def recompute_chapter_sort_orders(document_id: str):
    """按正文物理段落位置 title_paragraph_idx 重新按从上到下的顺序校准所有章节的 sort_order 与起止范围。"""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM chapters WHERE document_id = ? ORDER BY title_paragraph_idx ASC",
            (document_id,),
        ).fetchall()
        if not rows:
            return

        max_idx_row = conn.execute("SELECT MAX(idx) AS m FROM paragraphs WHERE document_id = ?", (document_id,)).fetchone()
        total_max = max_idx_row["m"] if max_idx_row and max_idx_row["m"] is not None else 0

        for i, r in enumerate(rows):
            ch_id = r["id"]
            start_i = r["title_paragraph_idx"]
            end_i = rows[i + 1]["title_paragraph_idx"] - 1 if i + 1 < len(rows) else total_max
            conn.execute(
                """UPDATE chapters
                   SET sort_order = ?, start_idx = ?, end_idx = ?
                   WHERE id = ?""",
                (i, start_i, end_i, ch_id),
            )


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
    """批量写入段落。rows: [(idx, text, style_name, [page_break_type / has_page_break_before]), ...]"""
    formatted = []
    for item in rows:
        page_break_type = "none"
        has_break = 0
        if len(item) == 4:
            idx, text, style_name, pb_val = item
            if isinstance(pb_val, str):
                page_break_type = pb_val
                has_break = 1 if pb_val != "none" else 0
            else:
                has_break = 1 if pb_val else 0
                page_break_type = "auto_chapter" if pb_val else "none"
        else:
            idx, text, style_name = item

        formatted.append((
            f"{document_id}:{idx}", generate_id(), document_id, idx,
            text, style_name, len(text), has_break, page_break_type,
        ))

    with get_conn() as conn:
        conn.executemany(
            """INSERT OR REPLACE INTO paragraphs
               (id, uuid, document_id, idx, text, style_name, char_count, has_page_break_before, page_break_type)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            formatted,
        )


def parse_notes_history(raw_note_str: str | None) -> list[dict]:
    if not raw_note_str:
        return []
    try:
        if raw_note_str.startswith("["):
            res = json.loads(raw_note_str)
            if isinstance(res, list):
                return res
    except Exception:
        pass
    return [{"id": "legacy_1", "note": raw_note_str, "created_at": datetime.now().strftime("%Y-%m-%d %H:%M")}]


def update_paragraph_text(document_id: str, idx: int, new_text: str, edit_note: str | None = None):
    """更新段落文本（写入 revised_text）及多轮编辑备注履历，重算字符数，并自动归档受影响废弃错字。"""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT text, revised_text, edit_note FROM paragraphs WHERE document_id = ? AND idx = ?",
            (document_id, idx),
        ).fetchone()
        orig_text = row["text"] if row else None
        revised_text = row["revised_text"] if row else None
        existing_raw_note = row["edit_note"] if row else None

        # 若原 text 为空（如新增空段落），且未保存过修订：第一笔编辑直接作为初始原文写入 text；仅在填写了备注时记录首条履历
        if row and (not orig_text) and (not revised_text):
            note_str = edit_note.strip() if (edit_note and isinstance(edit_note, str) and edit_note.strip()) else ""
            if note_str:
                new_note_item = {
                    "id": generate_id(),
                    "note": note_str,
                    "created_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
                    "revised_text": new_text,
                }
                note_val = json.dumps([new_note_item], ensure_ascii=False)
            else:
                note_val = None
            conn.execute(
                """UPDATE paragraphs 
                   SET text = ?, revised_text = NULL, char_count = ?, edit_note = ?
                   WHERE document_id = ? AND idx = ?""",
                (new_text, len(new_text), note_val, document_id, idx),
            )
        # 若 new_text 与初始原文相同，则视为恢复初始原文：将 revised_text 与 edit_note 均置为空 NULL
        elif orig_text is not None and new_text == orig_text:
            conn.execute(
                """UPDATE paragraphs 
                   SET revised_text = NULL, char_count = ?, edit_note = NULL
                   WHERE document_id = ? AND idx = ?""",
                (len(new_text), document_id, idx),
            )
        else:
            revised_val = new_text
            notes_list = parse_notes_history(existing_raw_note)
            note_str = edit_note.strip() if (edit_note and isinstance(edit_note, str) and edit_note.strip()) else ""
            new_note_item = {
                "id": generate_id(),
                "note": note_str,
                "created_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
                "revised_text": new_text,
            }
            notes_list.append(new_note_item)
            note_val = json.dumps(notes_list, ensure_ascii=False) if notes_list else None

            conn.execute(
                """UPDATE paragraphs 
                   SET revised_text = ?, char_count = ?, edit_note = ?
                   WHERE document_id = ? AND idx = ?""",
                (revised_val, len(new_text), note_val, document_id, idx),
            )
    mark_unmatched_errors_obsolete(document_id, idx, new_text)


def update_paragraph_notes_history(document_id: str, idx: int, notes_list: list[dict]):
    """覆盖或更新段落多轮备注履历列表。"""
    with get_conn() as conn:
        note_val = json.dumps(notes_list, ensure_ascii=False) if notes_list else None
        conn.execute(
            "UPDATE paragraphs SET edit_note = ? WHERE document_id = ? AND idx = ?",
            (note_val, document_id, idx),
        )


def toggle_paragraph_page_break(document_id: str, idx: int, pb_val: str | bool):
    """切换段落前置分页符状态 ('original' | 'auto_chapter' | 'manual' | 'none')。"""
    if isinstance(pb_val, bool):
        page_break_type = "manual" if pb_val else "none"
    else:
        page_break_type = pb_val
    has_break = 1 if page_break_type != "none" else 0
    with get_conn() as conn:
        conn.execute(
            "UPDATE paragraphs SET has_page_break_before = ?, page_break_type = ? WHERE document_id = ? AND idx = ?",
            (has_break, page_break_type, document_id, idx),
        )


def delete_paragraph_and_reorder(document_id: str, idx: int):
    """删除指定段落，平移后续段落 idx（全减 1），并同步重排章节范围边界。

    同步更新所有关联表：
    - errors: 被删段落的 pending errors 软标记 obsolete；后续段落 paragraph_index -= 1
    - character_relationships / plot_events: 后续段落 paragraph_idx -= 1
    """
    with get_conn() as conn:
        # 0. 查出 project_id（character_relationships / plot_events 按 project_id 存储）
        doc_row = conn.execute(
            "SELECT project_id FROM documents WHERE id = ?", (document_id,)
        ).fetchone()
        project_id = doc_row["project_id"] if doc_row else None

        # 1. 删除指定段落
        conn.execute("DELETE FROM paragraphs WHERE document_id = ? AND idx = ?", (document_id, idx))

        # 2. 对大于被删 idx 的所有段落进行 idx 减 1 和 id 重构（携带 uuid，不丢失）
        rows_to_update = conn.execute(
            "SELECT idx, uuid, text, revised_text, style_name, char_count, has_page_break_before, page_break_type, edit_note FROM paragraphs WHERE document_id = ? AND idx > ? ORDER BY idx ASC",
            (document_id, idx)
        ).fetchall()

        for r in rows_to_update:
            old_idx = r["idx"]
            new_idx = old_idx - 1
            old_id = f"{document_id}:{old_idx}"
            new_id = f"{document_id}:{new_idx}"
            conn.execute("DELETE FROM paragraphs WHERE id = ?", (old_id,))
            conn.execute(
                """INSERT INTO paragraphs
                   (id, uuid, document_id, idx, text, revised_text, style_name, char_count, has_page_break_before, page_break_type, edit_note)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (new_id, r["uuid"], document_id, new_idx, r["text"], r["revised_text"],
                 r["style_name"], r["char_count"], r["has_page_break_before"], r["page_break_type"], r["edit_note"])
            )

        # 3. 更新章节表中的 title_paragraph_idx, start_idx, end_idx
        chapters = conn.execute("SELECT * FROM chapters WHERE document_id = ?", (document_id,)).fetchall()
        for ch in chapters:
            t_idx = ch["title_paragraph_idx"]
            s_idx = ch["start_idx"]
            e_idx = ch["end_idx"]

            new_t_idx = t_idx
            if t_idx is not None:
                if t_idx > idx:
                    new_t_idx = t_idx - 1
                elif t_idx == idx:
                    new_t_idx = None

            new_s_idx = (s_idx - 1) if s_idx > idx else s_idx
            new_e_idx = (e_idx - 1) if e_idx >= idx and e_idx > 0 else e_idx

            conn.execute(
                """UPDATE chapters
                   SET title_paragraph_idx = ?, start_idx = ?, end_idx = ?
                   WHERE id = ?""",
                (new_t_idx, new_s_idx, new_e_idx, ch["id"])
            )

        # 4. errors：被删段落的 pending errors 软标记 obsolete；后续段落 paragraph_index -= 1
        conn.execute(
            """UPDATE errors
               SET is_obsolete = 1
               WHERE document_id = ? AND paragraph_index = ? AND user_status = 'pending'""",
            (document_id, idx)
        )
        conn.execute(
            """UPDATE errors
               SET paragraph_index = paragraph_index - 1
               WHERE document_id = ? AND paragraph_index > ?""",
            (document_id, idx)
        )

        # 5. character_relationships / plot_events：后续段落 paragraph_idx -= 1
        if project_id:
            conn.execute(
                """UPDATE character_relationships
                   SET paragraph_idx = paragraph_idx - 1
                   WHERE project_id = ? AND paragraph_idx > ?""",
                (project_id, idx)
            )
            conn.execute(
                """UPDATE plot_events
                   SET paragraph_idx = paragraph_idx - 1
                   WHERE project_id = ? AND paragraph_idx > ?""",
                (project_id, idx)
            )


def _resolve_para_target(conn, document_id: str, idx_or_uuid: int | str) -> tuple[int, str]:
    """给定 document_id 与 idx 或 uuid，返回 (idx, uuid)"""
    if isinstance(idx_or_uuid, int) or (isinstance(idx_or_uuid, str) and idx_or_uuid.isdigit()):
        target_idx = int(idx_or_uuid)
        row = conn.execute(
            "SELECT idx, uuid FROM paragraphs WHERE document_id = ? AND idx = ?",
            (document_id, target_idx),
        ).fetchone()
    else:
        uuid_str = str(idx_or_uuid)
        row = conn.execute(
            "SELECT idx, uuid FROM paragraphs WHERE document_id = ? AND uuid = ?",
            (document_id, uuid_str),
        ).fetchone()
    if not row:
        raise ValueError(f"目标段落不存在 doc={document_id} target={idx_or_uuid}")
    return row["idx"], row["uuid"]


def insert_paragraph_and_reorder(
    document_id: str,
    target_idx_or_uuid: int | str,
    position: str = "below",
    text: str = "",
) -> dict:
    """在指定段落上方或下方插入一个新段落，自动递增平移后续段落 idx 及所有关联表索引。"""
    with get_conn() as conn:
        proj = conn.execute(
            "SELECT p.is_locked, d.project_id FROM projects p JOIN documents d ON p.id = d.project_id WHERE d.id = ?",
            (document_id,),
        ).fetchone()
        if proj and proj["is_locked"] == 1:
            raise ValueError("项目已锁定，禁止插入段落")
        project_id = proj["project_id"] if proj else None

        all_paras = conn.execute(
            "SELECT * FROM paragraphs WHERE document_id = ? ORDER BY idx ASC",
            (document_id,),
        ).fetchall()

        if not all_paras:
            insert_idx = 0
            target_style = "Normal"
        else:
            target_idx, _ = _resolve_para_target(conn, document_id, target_idx_or_uuid)
            target_row = conn.execute(
                "SELECT style_name FROM paragraphs WHERE document_id = ? AND idx = ?",
                (document_id, target_idx),
            ).fetchone()
            target_style = target_row["style_name"] if target_row else "Normal"
            insert_idx = target_idx if position == "above" else target_idx + 1

        # 1. 倒序平移所有 idx >= insert_idx 的段落 (idx -> idx + 1)
        rows_to_shift = conn.execute(
            "SELECT idx, uuid, text, revised_text, style_name, char_count, has_page_break_before, page_break_type, edit_note FROM paragraphs WHERE document_id = ? AND idx >= ? ORDER BY idx DESC",
            (document_id, insert_idx),
        ).fetchall()

        for r in rows_to_shift:
            old_idx = r["idx"]
            new_idx = old_idx + 1
            old_id = f"{document_id}:{old_idx}"
            new_id = f"{document_id}:{new_idx}"
            conn.execute("DELETE FROM paragraphs WHERE id = ?", (old_id,))
            conn.execute(
                """INSERT INTO paragraphs
                   (id, uuid, document_id, idx, text, revised_text, style_name, char_count, has_page_break_before, page_break_type, edit_note)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    new_id,
                    r["uuid"],
                    document_id,
                    new_idx,
                    r["text"],
                    r["revised_text"],
                    r["style_name"],
                    r["char_count"],
                    r["has_page_break_before"],
                    r["page_break_type"],
                    r["edit_note"],
                ),
            )

        # 2. 插入新段落 (继承目标段落 style_name)
        new_uuid = generate_id()
        new_id = f"{document_id}:{insert_idx}"
        conn.execute(
            """INSERT INTO paragraphs
               (id, uuid, document_id, idx, text, revised_text, style_name, char_count, has_page_break_before, page_break_type, edit_note)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                new_id,
                new_uuid,
                document_id,
                insert_idx,
                text,
                None,
                target_style,
                len(text),
                0,
                "none",
                None,
            ),
        )

        # 3. 平移 chapters 表
        chapters = conn.execute(
            "SELECT * FROM chapters WHERE document_id = ?", (document_id,)
        ).fetchall()
        for ch in chapters:
            t_idx = ch["title_paragraph_idx"]
            s_idx = ch["start_idx"]
            e_idx = ch["end_idx"]

            new_t_idx = (t_idx + 1) if (t_idx is not None and t_idx >= insert_idx) else t_idx
            new_s_idx = (s_idx + 1) if s_idx >= insert_idx else s_idx
            new_e_idx = (e_idx + 1) if e_idx >= insert_idx else e_idx

            conn.execute(
                """UPDATE chapters SET title_paragraph_idx = ?, start_idx = ?, end_idx = ? WHERE id = ?""",
                (new_t_idx, new_s_idx, new_e_idx, ch["id"]),
            )

        # 4. 平移 errors 表 (paragraph_index >= insert_idx 的递增 +1)
        conn.execute(
            "UPDATE errors SET paragraph_index = paragraph_index + 1 WHERE document_id = ? AND paragraph_index >= ?",
            (document_id, insert_idx),
        )

        # 5. 平移 character_relationships / plot_events
        if project_id:
            conn.execute(
                "UPDATE character_relationships SET paragraph_idx = paragraph_idx + 1 WHERE project_id = ? AND paragraph_idx >= ?",
                (project_id, insert_idx),
            )
            conn.execute(
                "UPDATE plot_events SET paragraph_idx = paragraph_idx + 1 WHERE project_id = ? AND paragraph_idx >= ?",
                (project_id, insert_idx),
            )

        return {"uuid": new_uuid, "idx": insert_idx, "text": text}


def merge_paragraphs(
    document_id: str,
    target_idx_or_uuid: int | str,
    direction: str = "below",
    separator: str = "",
) -> dict:
    """合并当前段落与相邻段落 (above 或 below)。保留靠前/被选定的段落 UUID，拼接文本并迁移关联信息。"""
    with get_conn() as conn:
        proj = conn.execute(
            "SELECT p.is_locked, d.project_id FROM projects p JOIN documents d ON p.id = d.project_id WHERE d.id = ?",
            (document_id,),
        ).fetchone()
        if proj and proj["is_locked"] == 1:
            raise ValueError("项目已锁定，禁止合并段落")
        project_id = proj["project_id"] if proj else None

        target_idx, target_uuid = _resolve_para_target(conn, document_id, target_idx_or_uuid)

        if direction == "above":
            keep_idx = target_idx - 1
            remove_idx = target_idx
        else:
            keep_idx = target_idx
            remove_idx = target_idx + 1

        if keep_idx < 0:
            raise ValueError("首段无法向上合并")

        p_keep = conn.execute(
            "SELECT * FROM paragraphs WHERE document_id = ? AND idx = ?",
            (document_id, keep_idx),
        ).fetchone()
        p_remove = conn.execute(
            "SELECT * FROM paragraphs WHERE document_id = ? AND idx = ?",
            (document_id, remove_idx),
        ).fetchone()

        if not p_keep or not p_remove:
            raise ValueError("要合并的相邻段落不存在")

        keep_uuid = p_keep["uuid"]
        remove_uuid = p_remove["uuid"]

        # 1. 拼接文本（清除段内换行符）
        text1 = (p_keep["text"] or "").replace("\r", "").replace("\n", "")
        text2 = (p_remove["text"] or "").replace("\r", "").replace("\n", "")
        merged_text = f"{text1}{separator}{text2}" if text1 and text2 else (text1 or text2)

        # 2. 合并 edit_note 履历与 revised_text
        notes_keep = parse_notes_history(p_keep["edit_note"])
        notes_remove = parse_notes_history(p_remove["edit_note"])
        combined_notes = notes_keep + notes_remove
        note_val = json.dumps(combined_notes, ensure_ascii=False) if combined_notes else None

        rev1 = ((p_keep["revised_text"] or text1) or "").replace("\r", "").replace("\n", "")
        rev2 = ((p_remove["revised_text"] or text2) or "").replace("\r", "").replace("\n", "")
        has_revised = (p_keep["revised_text"] is not None) or (p_remove["revised_text"] is not None)
        merged_revised = f"{rev1}{separator}{rev2}" if has_revised else None

        conn.execute(
            """UPDATE paragraphs
               SET text = ?, char_count = ?, edit_note = ?, revised_text = ?
               WHERE document_id = ? AND idx = ?""",
            (merged_text, len(merged_text), note_val, merged_revised, document_id, keep_idx),
        )

        # 3. 将 p_remove 上的 errors 重定向到 p_keep (同时更新 paragraph_uuid 和 paragraph_index)
        conn.execute(
            """UPDATE errors
               SET paragraph_uuid = ?, paragraph_index = ?
               WHERE document_id = ? AND (paragraph_uuid = ? OR (paragraph_uuid IS NULL AND paragraph_index = ?))""",
            (keep_uuid, keep_idx, document_id, remove_uuid, remove_idx),
        )

        # 4. 章节绑定与双章节合并处理
        ch_keep = conn.execute(
            "SELECT * FROM chapters WHERE document_id = ? AND (title_paragraph_uuid = ? OR title_paragraph_idx = ?)",
            (document_id, keep_uuid, keep_idx),
        ).fetchone()
        ch_remove = conn.execute(
            "SELECT * FROM chapters WHERE document_id = ? AND (title_paragraph_uuid = ? OR title_paragraph_idx = ?)",
            (document_id, remove_uuid, remove_idx),
        ).fetchone()

        if ch_remove and not ch_keep:
            # 如果 remove 是章节标题但 keep 不是，重定向到 keep (同时更新 uuid 与 idx!)
            conn.execute(
                """UPDATE chapters
                   SET title_paragraph_uuid = ?, title_paragraph_idx = ?
                   WHERE id = ?""",
                (keep_uuid, keep_idx, ch_remove["id"]),
            )
        elif ch_remove and ch_keep:
            # 两者均为章节标题：保留 keep 章节定义，扩展 start_idx/end_idx 吞并 remove
            new_s = min(ch_keep["start_idx"], ch_remove["start_idx"])
            new_e = max(ch_keep["end_idx"], ch_remove["end_idx"])
            conn.execute(
                "UPDATE chapters SET start_idx = ?, end_idx = ? WHERE id = ?",
                (new_s, new_e, ch_keep["id"]),
            )
            # 删掉被吞并的额外章节记录
            conn.execute("DELETE FROM chapters WHERE id = ?", (ch_remove["id"],))

        # 5. 重定向 character_relationships 与 plot_events
        if project_id:
            conn.execute(
                """UPDATE character_relationships
                   SET paragraph_uuid = ?, paragraph_idx = ?
                   WHERE project_id = ? AND (paragraph_uuid = ? OR (paragraph_uuid IS NULL AND paragraph_idx = ?))""",
                (keep_uuid, keep_idx, project_id, remove_uuid, remove_idx),
            )
            conn.execute(
                """UPDATE plot_events
                   SET paragraph_uuid = ?, paragraph_idx = ?
                   WHERE project_id = ? AND (paragraph_uuid = ? OR (paragraph_uuid IS NULL AND paragraph_idx = ?))""",
                (keep_uuid, keep_idx, project_id, remove_uuid, remove_idx),
            )

    # 6. 删除 p_remove 所在行并平移后续段落索引
    delete_paragraph_and_reorder(document_id, remove_idx)

    return {"uuid": keep_uuid, "idx": keep_idx, "text": merged_text}


def merge_multiple_paragraphs(
    document_id: str,
    target_identifiers: list[int | str],
    separator: str = "",
) -> dict:
    """批量合并选定的多段连续段落。保留索引最小的段落 UUID，拼接文本并迁移重定向所有关联信息。"""
    if not target_identifiers:
        raise ValueError("未选择任何要合并的段落")
    if len(target_identifiers) == 1:
        with get_conn() as conn:
            idx, uuid_str = _resolve_para_target(conn, document_id, target_identifiers[0])
            para = conn.execute("SELECT text FROM paragraphs WHERE document_id = ? AND idx = ?", (document_id, idx)).fetchone()
            return {"uuid": uuid_str, "idx": idx, "text": para["text"] if para else ""}

    with get_conn() as conn:
        proj = conn.execute(
            "SELECT p.is_locked, d.project_id FROM projects p JOIN documents d ON p.id = d.project_id WHERE d.id = ?",
            (document_id,),
        ).fetchone()
        if proj and proj["is_locked"] == 1:
            raise ValueError("项目已锁定，禁止合并段落")
        project_id = proj["project_id"] if proj else None

        resolved_paras = []
        for item in target_identifiers:
            idx, uuid_str = _resolve_para_target(conn, document_id, item)
            row = conn.execute("SELECT * FROM paragraphs WHERE document_id = ? AND idx = ?", (document_id, idx)).fetchone()
            if row:
                resolved_paras.append(dict(row))

        resolved_paras.sort(key=lambda p: p["idx"])

        indices = [p["idx"] for p in resolved_paras]
        min_idx = indices[0]
        max_idx = indices[-1]
        if indices != list(range(min_idx, max_idx + 1)):
            raise ValueError("选中的段落必须为连续相邻的段落，不能跨段合并")

        p_keep = resolved_paras[0]
        p_removes = resolved_paras[1:]

        keep_uuid = p_keep["uuid"]
        keep_idx = p_keep["idx"]

        # 1. 拼接文本与 revised_text（清除段落内部硬换行符）
        texts = [(p["text"] or "").replace("\r", "").replace("\n", "") for p in resolved_paras]
        merged_text = separator.join(t for t in texts if t) if any(texts) else ""

        has_revised = any(p["revised_text"] is not None for p in resolved_paras)
        revised_parts = [
            (p["revised_text"] if p["revised_text"] is not None else (p["text"] or "")).replace("\r", "").replace("\n", "")
            for p in resolved_paras
        ]
        merged_revised = separator.join(revised_parts) if has_revised else None

        # 2. 合并 edit_note 履历
        combined_notes = []
        for p in resolved_paras:
            combined_notes.extend(parse_notes_history(p["edit_note"]))
        note_val = json.dumps(combined_notes, ensure_ascii=False) if combined_notes else None

        conn.execute(
            """UPDATE paragraphs
               SET text = ?, char_count = ?, edit_note = ?, revised_text = ?
               WHERE document_id = ? AND idx = ?""",
            (merged_text, len(merged_text), note_val, merged_revised, document_id, keep_idx),
        )

        # 3. 重定向所有 p_removes 上的 errors 到 keep_uuid
        remove_uuids = [p["uuid"] for p in p_removes if p["uuid"]]
        remove_idxs = [p["idx"] for p in p_removes]

        if remove_uuids:
            placeholders_uuid = ",".join("?" for _ in remove_uuids)
            conn.execute(
                f"""UPDATE errors
                    SET paragraph_uuid = ?, paragraph_index = ?
                    WHERE document_id = ? AND paragraph_uuid IN ({placeholders_uuid})""",
                (keep_uuid, keep_idx, document_id, *remove_uuids),
            )

        if remove_idxs:
            placeholders_idx = ",".join("?" for _ in remove_idxs)
            conn.execute(
                f"""UPDATE errors
                    SET paragraph_uuid = ?, paragraph_index = ?
                    WHERE document_id = ? AND paragraph_index IN ({placeholders_idx})""",
                (keep_uuid, keep_idx, document_id, *remove_idxs),
            )

        # 4. 章节绑定与多章节合并处理
        ch_keep = conn.execute(
            "SELECT * FROM chapters WHERE document_id = ? AND (title_paragraph_uuid = ? OR title_paragraph_idx = ?)",
            (document_id, keep_uuid, keep_idx),
        ).fetchone()

        for p_rem in p_removes:
            r_uuid = p_rem["uuid"]
            r_idx = p_rem["idx"]
            ch_remove = conn.execute(
                "SELECT * FROM chapters WHERE document_id = ? AND (title_paragraph_uuid = ? OR title_paragraph_idx = ?)",
                (document_id, r_uuid, r_idx),
            ).fetchone()

            if ch_remove and not ch_keep:
                conn.execute(
                    """UPDATE chapters
                       SET title_paragraph_uuid = ?, title_paragraph_idx = ?
                       WHERE id = ?""",
                    (keep_uuid, keep_idx, ch_remove["id"]),
                )
                ch_keep = ch_remove
            elif ch_remove and ch_keep and ch_remove["id"] != ch_keep["id"]:
                new_s = min(ch_keep["start_idx"], ch_remove["start_idx"])
                new_e = max(ch_keep["end_idx"], ch_remove["end_idx"])
                conn.execute(
                    "UPDATE chapters SET start_idx = ?, end_idx = ? WHERE id = ?",
                    (new_s, new_e, ch_keep["id"]),
                )
                conn.execute("DELETE FROM chapters WHERE id = ?", (ch_remove["id"],))

        # 5. 重定向 character_relationships 与 plot_events
        if project_id and remove_uuids:
            placeholders_uuid = ",".join("?" for _ in remove_uuids)
            conn.execute(
                f"""UPDATE character_relationships
                    SET paragraph_uuid = ?, paragraph_idx = ?
                    WHERE project_id = ? AND paragraph_uuid IN ({placeholders_uuid})""",
                (keep_uuid, keep_idx, project_id, *remove_uuids),
            )
            conn.execute(
                f"""UPDATE plot_events
                    SET paragraph_uuid = ?, paragraph_idx = ?
                    WHERE project_id = ? AND paragraph_uuid IN ({placeholders_uuid})""",
                (keep_uuid, keep_idx, project_id, *remove_uuids),
            )

        if project_id and remove_idxs:
            placeholders_idx = ",".join("?" for _ in remove_idxs)
            conn.execute(
                f"""UPDATE character_relationships
                    SET paragraph_uuid = ?, paragraph_idx = ?
                    WHERE project_id = ? AND paragraph_idx IN ({placeholders_idx})""",
                (keep_uuid, keep_idx, project_id, *remove_idxs),
            )
            conn.execute(
                f"""UPDATE plot_events
                    SET paragraph_uuid = ?, paragraph_idx = ?
                    WHERE project_id = ? AND paragraph_idx IN ({placeholders_idx})""",
                (keep_uuid, keep_idx, project_id, *remove_idxs),
            )

    # 6. 从后向前删除多余段落行并整体平移后续段落
    for r_idx in reversed(remove_idxs):
        delete_paragraph_and_reorder(document_id, r_idx)

    return {"uuid": keep_uuid, "idx": keep_idx, "text": merged_text}



def clean_empty_paragraphs(document_id: str) -> int:
    """清理所有空白段落，从 0 重新连续编排所有剩余段落 idx，并重算章节、错误索引与总数。"""
    with get_conn() as conn:
        proj = conn.execute(
            "SELECT p.is_locked, d.project_id FROM projects p JOIN documents d ON p.id = d.project_id WHERE d.id = ?",
            (document_id,)
        ).fetchone()
        if proj and proj["is_locked"] == 1:
            raise ValueError("项目已锁定，禁止清理段落")
        project_id = proj["project_id"] if proj else None

        all_paras = conn.execute(
            "SELECT * FROM paragraphs WHERE document_id = ? ORDER BY idx ASC",
            (document_id,)
        ).fetchall()

        non_empty = [p for p in all_paras if p["text"] and p["text"].strip()]
        deleted_count = len(all_paras) - len(non_empty)
        if deleted_count == 0:
            return 0

        # 被删空段落的 pending errors 软标记为 obsolete
        empty_idxs = {p["idx"] for p in all_paras if not (p["text"] and p["text"].strip())}
        if empty_idxs:
            placeholders = ",".join("?" for _ in empty_idxs)
            conn.execute(
                f"""UPDATE errors
                    SET is_obsolete = 1
                    WHERE document_id = ? AND paragraph_index IN ({placeholders}) AND user_status = 'pending'""",
                (document_id, *empty_idxs),
            )

        old_to_new = {}
        for new_i, p in enumerate(non_empty):
            old_to_new[p["idx"]] = new_i

        conn.execute("DELETE FROM paragraphs WHERE document_id = ?", (document_id,))

        for new_i, p in enumerate(non_empty):
            new_id = f"{document_id}:{new_i}"
            conn.execute(
                """INSERT INTO paragraphs
                   (id, uuid, document_id, idx, text, revised_text, style_name, char_count, has_page_break_before, page_break_type, edit_note)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (new_id, p["uuid"], document_id, new_i, p["text"], p["revised_text"], p["style_name"], p["char_count"], p["has_page_break_before"], p["page_break_type"], p["edit_note"])
            )

        chapters = conn.execute("SELECT * FROM chapters WHERE document_id = ?", (document_id,)).fetchall()
        for ch in chapters:
            old_t = ch["title_paragraph_idx"]
            old_s = ch["start_idx"]
            old_e = ch["end_idx"]

            new_t = old_to_new.get(old_t)
            new_s = old_to_new.get(old_s, 0)
            new_e = old_to_new.get(old_e, len(non_empty) - 1)

            conn.execute(
                """UPDATE chapters SET title_paragraph_idx = ?, start_idx = ?, end_idx = ? WHERE id = ?""",
                (new_t, new_s, new_e, ch["id"])
            )

        errs = conn.execute("SELECT id, paragraph_index FROM errors WHERE document_id = ?", (document_id,)).fetchall()
        for e in errs:
            old_pi = e["paragraph_index"]
            if old_pi in old_to_new:
                new_pi = old_to_new[old_pi]
                conn.execute("UPDATE errors SET paragraph_index = ? WHERE id = ?", (new_pi, e["id"]))

        if project_id:
            rels = conn.execute("SELECT id, paragraph_idx FROM character_relationships WHERE project_id = ?", (project_id,)).fetchall()
            for r in rels:
                if r["paragraph_idx"] in old_to_new:
                    conn.execute("UPDATE character_relationships SET paragraph_idx = ? WHERE id = ?", (old_to_new[r["paragraph_idx"]], r["id"]))

            events = conn.execute("SELECT id, paragraph_idx FROM plot_events WHERE project_id = ?", (project_id,)).fetchall()
            for ev in events:
                if ev["paragraph_idx"] in old_to_new:
                    conn.execute("UPDATE plot_events SET paragraph_idx = ? WHERE id = ?", (old_to_new[ev["paragraph_idx"]], ev["id"]))

        return deleted_count


def set_paragraph_as_chapter(document_id: str, idx: int, level: int = 1, title: str | None = None) -> str:
    """人工设置某个段落为章节。"""
    with get_conn() as conn:
        conn.execute("UPDATE documents SET last_error = NULL WHERE id = ?", (document_id,))
        para_row = conn.execute("SELECT text, uuid FROM paragraphs WHERE document_id = ? AND idx = ?", (document_id, idx)).fetchone()
        if not title:
            title = para_row["text"] if para_row and para_row["text"] else f"第 {idx+1} 段"
        para_uuid = para_row["uuid"] if para_row else None

        max_sort = conn.execute("SELECT MAX(sort_order) AS m FROM chapters WHERE document_id = ?", (document_id,)).fetchone()
        sort_order = (max_sort["m"] + 1) if max_sort and max_sort["m"] is not None else 0

        max_idx_row = conn.execute("SELECT MAX(idx) AS m FROM paragraphs WHERE document_id = ?", (document_id,)).fetchone()
        total_max = max_idx_row["m"] if max_idx_row and max_idx_row["m"] is not None else idx

        last_para = conn.execute("SELECT uuid FROM paragraphs WHERE document_id = ? AND idx = ?", (document_id, total_max)).fetchone()
        end_para_uuid = last_para["uuid"] if last_para else None

        ch_id = f"manual_{document_id}_{idx}"
        conn.execute(
            """INSERT OR REPLACE INTO chapters
               (id, document_id, title, title_paragraph_idx, title_paragraph_uuid, level, start_idx, start_paragraph_uuid, end_idx, end_paragraph_uuid, sort_order, detected_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')""",
            (ch_id, document_id, title, idx, para_uuid, level, idx, para_uuid, total_max, end_para_uuid, sort_order)
        )
        if idx > 0:
            if level == 1:
                conn.execute(
                    """UPDATE paragraphs
                       SET has_page_break_before = 1, page_break_type = 'auto_chapter'
                       WHERE document_id = ? AND idx = ? AND page_break_type = 'none'""",
                    (document_id, idx),
                )
            else:
                conn.execute(
                    """UPDATE paragraphs
                       SET has_page_break_before = 0, page_break_type = 'none'
                       WHERE document_id = ? AND idx = ? AND page_break_type = 'auto_chapter'""",
                    (document_id, idx),
                )

    recompute_chapter_sort_orders(document_id)
    return ch_id


def unset_chapter(document_id: str, chapter_id_or_idx: str | int):
    """取消某个章节，并同步将该章节标题段落的 auto_chapter 分页重置为 none。"""
    with get_conn() as conn:
        # 先查出 title_paragraph_idx，再删除章节
        row = conn.execute(
            "SELECT title_paragraph_idx FROM chapters WHERE document_id = ? AND (id = ? OR title_paragraph_idx = ?)",
            (document_id, str(chapter_id_or_idx), chapter_id_or_idx)
        ).fetchone()
        conn.execute(
            "DELETE FROM chapters WHERE document_id = ? AND (id = ? OR title_paragraph_idx = ?)",
            (document_id, str(chapter_id_or_idx), chapter_id_or_idx)
        )
        # 仅重置 auto_chapter，不动 original/manual（用户自行设置的分页应保留）
        if row and row["title_paragraph_idx"] is not None:
            conn.execute(
                """UPDATE paragraphs
                   SET has_page_break_before = 0, page_break_type = 'none'
                   WHERE document_id = ? AND idx = ? AND page_break_type = 'auto_chapter'""",
                (document_id, row["title_paragraph_idx"]),
            )

    recompute_chapter_sort_orders(document_id)


def get_paragraphs(document_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM paragraphs WHERE document_id = ? ORDER BY idx",
            (document_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_paragraphs_in_range(document_id: str, start_idx: int, end_idx: int) -> list[dict]:
    """只读取 [start_idx, end_idx) 范围内的段落，避免大文档全量读取。"""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM paragraphs WHERE document_id = ? AND idx >= ? AND idx < ? ORDER BY idx",
            (document_id, start_idx, end_idx),
        ).fetchall()
        return [dict(r) for r in rows]


def get_paragraphs_by_indices(document_id: str, indices: list[int]) -> list[dict]:
    """按指定段落编号列表查询，用于 selection 模式。"""
    if not indices:
        return []
    placeholders = ",".join("?" for _ in indices)
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM paragraphs WHERE document_id = ? AND idx IN ({placeholders}) ORDER BY idx",
            (document_id, *indices),
        ).fetchall()
        return [dict(r) for r in rows]


def get_paragraph_count(document_id: str) -> int:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS c FROM paragraphs WHERE document_id = ?",
            (document_id,),
        ).fetchone()
        return int(row["c"]) if row else 0


def get_paragraph_content(para: dict | None) -> str:
    """全系统唯一段落真实内容提取方法：有 revised_text 用 revised_text，没有用 text。"""
    if not para:
        return ""
    if para.get("revised_text") is not None:
        return para["revised_text"]
    return para.get("text") or ""


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


def get_paragraph_by_uuid(document_id: str, uuid: str) -> dict | None:
    """通过 uuid 查询段落（uuid 为永久业务标识，不因 idx 重排而改变）。"""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM paragraphs WHERE document_id = ? AND uuid = ?",
            (document_id, uuid),
        ).fetchone()
        return dict(row) if row else None


def resolve_paragraph_uuid(document_id: str, idx: int) -> str:
    """工具函数：从 idx 转换得出 paragraph_uuid。若不存在则记录 warning 并返回空字符串。"""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT uuid FROM paragraphs WHERE document_id = ? AND idx = ?",
            (document_id, idx),
        ).fetchone()
        if row and row["uuid"]:
            return row["uuid"]
        logger.warning("resolve_paragraph_uuid 无法从 idx=%s 找到 paragraph_uuid doc=%s", idx, document_id)
        return ""


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
            "SELECT idx, COALESCE(revised_text, text) AS text, revised_text IS NOT NULL AS has_rev, has_page_break_before, page_break_type, style_name FROM paragraphs WHERE document_id = ? ORDER BY idx",
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
    para_uuid = err.get("paragraph_uuid")
    para_idx = err.get("paragraph_index", 0)

    with get_conn() as conn:
        if not para_uuid and para_idx is not None:
            row = conn.execute(
                "SELECT uuid FROM paragraphs WHERE document_id = ? AND idx = ?",
                (document_id, para_idx),
            ).fetchone()
            if row:
                para_uuid = row["uuid"]

        conn.execute(
            """INSERT INTO errors
               (document_id, type, paragraph_index, paragraph_uuid, original_text, suggested_text, severity, description, chapter_id, source, is_obsolete)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                document_id,
                err.get("type", "typo"),
                para_idx,
                para_uuid,
                err.get("original_text", ""),
                err.get("suggested_text", ""),
                err.get("severity", "medium"),
                err.get("description", ""),
                err.get("chapter_id", ""),
                err.get("source", "llm"),
                err.get("is_obsolete", 0),
            ),
        )


def obsolete_errors_in_range(document_id: str, start_idx: int, end_idx: int, source: str = "llm", uuids: list[str] | None = None):
    """仅将同来源（source）且未手动决策（user_status = 'pending'）的旧错误标记为已作废 is_obsolete = 1。
       用户已采纳或拒绝的决策记录 100% 锁死保留。支持按 uuids 或范围 idx 作废。"""
    with get_conn() as conn:
        if uuids:
            placeholders = ",".join("?" for _ in uuids)
            conn.execute(
                f"""UPDATE errors
                   SET is_obsolete = 1
                   WHERE document_id = ?
                     AND paragraph_uuid IN ({placeholders})
                     AND user_status = 'pending'
                     AND (source IS NULL OR source = ?)""",
                (document_id, *uuids, source),
            )
        else:
            conn.execute(
                """UPDATE errors
                   SET is_obsolete = 1
                   WHERE document_id = ?
                     AND paragraph_index >= ?
                     AND paragraph_index < ?
                     AND user_status = 'pending'
                     AND (source IS NULL OR source = ?)""",
                (document_id, start_idx, end_idx, source),
            )


def delete_errors_in_range(document_id: str, start_idx: int, end_idx: int, source: str = "llm"):
    """兼容旧函数签名：调用软标记覆盖。"""
    obsolete_errors_in_range(document_id, start_idx, end_idx, source)


def obsolete_errors_by_indices(document_id: str, indices: list[int], source: str = "llm"):
    if not indices:
        return
    placeholders = ",".join("?" for _ in indices)
    with get_conn() as conn:
        conn.execute(
            f"""UPDATE errors
                SET is_obsolete = 1
                WHERE document_id = ?
                  AND paragraph_index IN ({placeholders})
                  AND user_status = 'pending'
                  AND (source IS NULL OR source = ?)""",
            (document_id, *indices, source),
        )


def obsolete_errors_by_uuids(document_id: str, uuids: list[str], source: str = "llm"):
    if not uuids:
        return
    placeholders = ",".join("?" for _ in uuids)
    with get_conn() as conn:
        conn.execute(
            f"""UPDATE errors
                SET is_obsolete = 1
                WHERE document_id = ?
                  AND paragraph_uuid IN ({placeholders})
                  AND user_status = 'pending'
                  AND (source IS NULL OR source = ?)""",
            (document_id, *uuids, source),
        )


def delete_errors_by_indices(document_id: str, indices: list[int], source: str = "llm"):
    """兼容旧函数签名：调用软标记覆盖。"""
    obsolete_errors_by_indices(document_id, indices, source)


def mark_unmatched_errors_obsolete(document_id: str, paragraph_index: int, new_text: str, paragraph_uuid: str | None = None):
    """当段落文本发生人工修改或采纳修改后，检查该段落中原错字在 new_text 中已不存在的待处理错误，
       自动将其软标记为 is_obsolete = 1（历史作废）。"""
    with get_conn() as conn:
        if paragraph_uuid:
            rows = conn.execute(
                "SELECT id, original_text FROM errors WHERE document_id = ? AND paragraph_uuid = ? AND user_status = 'pending' AND (is_obsolete IS NULL OR is_obsolete = 0)",
                (document_id, paragraph_uuid),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, original_text FROM errors WHERE document_id = ? AND paragraph_index = ? AND user_status = 'pending' AND (is_obsolete IS NULL OR is_obsolete = 0)",
                (document_id, paragraph_index),
            ).fetchall()
        for r in rows:
            orig = r["original_text"]
            if orig and orig not in new_text:
                conn.execute("UPDATE errors SET is_obsolete = 1 WHERE id = ?", (r["id"],))


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

# ==================== Settings（缓存 + 读写） ====================

_settings_cache: dict | None = None


def _load_settings_cache():
    """从 DB 加载全部设置到内存缓存。"""
    global _settings_cache
    _settings_cache = {}
    try:
        with get_conn() as conn:
            rows = conn.execute("SELECT key, value FROM settings").fetchall()
            for row in rows:
                _settings_cache[row["key"]] = row["value"]
    except Exception:
        pass


def get_setting(key: str, default: str = "") -> str:
    """读取设置（优先走缓存），不存在返回 default。"""
    if _settings_cache is None:
        _load_settings_cache()
    return _settings_cache.get(key, default)


def set_setting(key: str, value: str):
    """写入设置（同步 DB + 更新缓存）。"""
    with get_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            (key, value),
        )
    if _settings_cache is not None:
        _settings_cache[key] = value


def get_all_settings() -> dict:
    """返回所有设置（用于 API 暴露给前端）。"""
    if _settings_cache is None:
        _load_settings_cache()
    return dict(_settings_cache)


def insert_llm_log(
    id: str, project_id: str, doc_id: str,
    model: str, mode: str,
    range_start: int, range_end: int,
    prompt: str, system_prompt: str, selected_types: str,
    status: str, duration_ms: int, error_message: str | None,
    response_raw: str | None,
    errors_found: int, chapters_found: int,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    total_tokens: int | None = None,
    cost: float | None = None,
):
    """写入一条 LLM 调用日志到持久表。"""
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO llm_logs
               (id, project_id, doc_id, model, mode,
                range_start, range_end, prompt, system_prompt,
                selected_types, status, duration_ms, error_message,
                response_raw, errors_found, chapters_found,
                prompt_tokens, completion_tokens, total_tokens, cost)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (id, project_id, doc_id, model, mode,
             range_start, range_end, prompt, system_prompt,
             selected_types, status, duration_ms, error_message,
             response_raw, errors_found, chapters_found,
             prompt_tokens, completion_tokens, total_tokens, cost),
        )


def list_llm_logs(project_id: str | None, limit: int = 50, offset: int = 0) -> list[dict]:
    """分页查询 LLM 调用日志，按时间倒序。"""
    with get_conn() as conn:
        if project_id:
            rows = conn.execute(
                "SELECT * FROM llm_logs WHERE project_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (project_id, limit, offset),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM llm_logs ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
        return [dict(r) for r in rows]


# ==================== Batch（批量并行校对） ====================

def create_batch(batch_id: str, document_id: str, range_start: int, range_end: int,
                 windows: list[tuple[int, int]]) -> dict:
    """创建一个 batch 及其所有 window 记录。
    windows: [(ws, we), ...] 每个 window 的段落范围。
    """
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO proofread_batches
               (id, document_id, range_start, range_end, status, total_windows)
               VALUES (?, ?, ?, ?, 'running', ?)""",
            (batch_id, document_id, range_start, range_end, len(windows)),
        )
        conn.executemany(
            """INSERT INTO batch_windows
               (batch_id, window_index, range_start, range_end, status)
               VALUES (?, ?, ?, ?, 'pending')""",
            [(batch_id, i, ws, we) for i, (ws, we) in enumerate(windows)],
        )
        row = conn.execute(
            "SELECT * FROM proofread_batches WHERE id = ?", (batch_id,)
        ).fetchone()
        return dict(row)


def get_batch(batch_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM proofread_batches WHERE id = ?", (batch_id,)
        ).fetchone()
        return dict(row) if row else None


def get_batch_windows(batch_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM batch_windows WHERE batch_id = ? ORDER BY window_index",
            (batch_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_latest_batch(document_id: str) -> dict | None:
    """获取该文档最近一次 batch 记录（用于前端展示上次批量进度）。"""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM proofread_batches WHERE document_id = ? ORDER BY created_at DESC LIMIT 1",
            (document_id,),
        ).fetchone()
        return dict(row) if row else None


def update_batch_window(batch_id: str, window_index: int, status: str,
                        error_message: str | None = None):
    """更新单个 window 的状态（在并行结束后统一调用）。"""
    with get_conn() as conn:
        conn.execute(
            """UPDATE batch_windows
               SET status = ?, error_message = ?,
                   retry_count = retry_count + CASE WHEN ? = 'pending' THEN 1 ELSE 0 END
               WHERE batch_id = ? AND window_index = ?""",
            (status, error_message,
             status,  # retry_count 只在重试（status 回到 pending）时 +1
             batch_id, window_index),
        )


def finish_batch(batch_id: str, done: int, failed: int):
    """batch 所有 window 执行完毕后，更新汇总计数和最终状态。"""
    final_status = 'failed' if done == 0 else ('partial' if failed > 0 else 'ok')
    with get_conn() as conn:
        conn.execute(
            """UPDATE proofread_batches
               SET done_windows = ?, failed_windows = ?, status = ?,
                   updated_at = datetime('now', 'localtime')
               WHERE id = ?""",
            (done, failed, final_status, batch_id),
        )


def get_document_batches(document_id: str, limit: int = 5) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM proofread_batches WHERE document_id = ? ORDER BY created_at DESC LIMIT ?",
            (document_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]


# ==================== 批量写入（batch 模式专用，不替换现有逐条 insert） ====================

def batch_insert_errors(document_id: str, errors: list[dict], default_source: str = "llm") -> int:
    """批量写入 errors，包含 (paragraph_index, original_text, suggested_text) 幂等去重防重复插入，返回实际新增条数。"""
    if not errors:
        return 0
    with get_conn() as conn:
        # 建立 idx -> uuid 字典
        para_rows = conn.execute("SELECT idx, uuid FROM paragraphs WHERE document_id = ?", (document_id,)).fetchall()
        idx_to_uuid = {r["idx"]: r["uuid"] for r in para_rows}

        existing = conn.execute(
            "SELECT paragraph_index, original_text, suggested_text FROM errors WHERE document_id = ? AND (is_obsolete IS NULL OR is_obsolete = 0)",
            (document_id,),
        ).fetchall()
        existing_keys = {
            (r["paragraph_index"], r["original_text"] or "", r["suggested_text"] or "")
            for r in existing
        }

        filtered = []
        seen = set()
        for e in errors:
            key = (
                e.get("paragraph_index", 0),
                e.get("original_text", ""),
                e.get("suggested_text", ""),
            )
            if key not in existing_keys and key not in seen:
                seen.add(key)
                filtered.append(e)

        if not filtered:
            return 0

        conn.executemany(
            """INSERT INTO errors
               (document_id, type, paragraph_index, paragraph_uuid, original_text, suggested_text,
                severity, description, chapter_id, source, is_obsolete)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    document_id,
                    e.get("type", "typo"),
                    e.get("paragraph_index", 0),
                    e.get("paragraph_uuid") or idx_to_uuid.get(e.get("paragraph_index", 0)),
                    e.get("original_text", ""),
                    e.get("suggested_text", ""),
                    e.get("severity", "medium"),
                    e.get("description", ""),
                    e.get("chapter_id", ""),
                    e.get("source", default_source),
                    e.get("is_obsolete", 0),
                )
                for e in filtered
            ],
        )
        return len(filtered)


def batch_insert_chapters(document_id: str, chapters: list[dict], sort_base: int):
    """批量写入 chapters，sort_order 从 sort_base 起自增，并同步更新章节标题段落的分页类型。"""
    if not chapters:
        return
    from app.utils.helpers import generate_id
    with get_conn() as conn:
        para_rows = conn.execute("SELECT idx, uuid FROM paragraphs WHERE document_id = ?", (document_id,)).fetchall()
        idx_to_uuid = {r["idx"]: r["uuid"] for r in para_rows}

        conn.executemany(
            """INSERT INTO chapters
               (id, document_id, title, title_paragraph_idx, title_paragraph_uuid, level, parent_idx, parent_uuid,
                start_idx, start_paragraph_uuid, end_idx, end_paragraph_uuid, sort_order, detected_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    generate_id(),
                    document_id,
                    c["title"],
                    c["title_paragraph_idx"],
                    c.get("title_paragraph_uuid") or idx_to_uuid.get(c.get("title_paragraph_idx")),
                    c["level"],
                    c.get("parent_idx"),
                    c.get("parent_uuid") or idx_to_uuid.get(c.get("parent_idx")),
                    c.get("start_idx", c.get("title_paragraph_idx", 0)),
                    c.get("start_paragraph_uuid") or idx_to_uuid.get(c.get("start_idx", c.get("title_paragraph_idx", 0))),
                    c.get("end_idx", c.get("title_paragraph_idx", 0)),
                    c.get("end_paragraph_uuid") or idx_to_uuid.get(c.get("end_idx", c.get("title_paragraph_idx", 0))),
                    sort_base + i,
                    c.get("detected_by", "original"),
                )
                for i, c in enumerate(chapters)
            ],
        )
        # 仅当为主章(level == 1)且该段当前为 'none' 且不是第 0 段时升级为 auto_chapter
        for c in chapters:
            tip = c.get("title_paragraph_idx")
            level = c.get("level", 1)
            if tip is not None and tip > 0 and level == 1:
                conn.execute(
                    """UPDATE paragraphs
                       SET has_page_break_before = 1, page_break_type = 'auto_chapter'
                       WHERE document_id = ? AND idx = ? AND page_break_type = 'none'""",
                    (document_id, tip),
                )
    recompute_chapter_sort_orders(document_id)


def merge_and_save_chapters(document_id: str, new_chapters: list[dict]) -> tuple[int, int]:
    """智能比对落库章节（保护原有章节不被破坏清除）：
    1. 保持 DB 中既有章节（original / manual / llm），零盲目清空删除；
    2. 若新识别到的章节对应段落已有既有章节（优先按 uuid 匹配，fallback 按 idx 匹配），100% 保护既有章节 ID、标题与来源，仅更新起止区间；
    3. 若为全新识别到的段落章节，按 detected_by='llm' 插入；
    返回 (全书当前章节总数, 本次新识别 LLM 章节数)
    """
    if not new_chapters:
        existing = get_chapters(document_id)
        return len(existing), 0

    from app.utils.helpers import generate_id
    newly_added_count = 0

    with get_conn() as conn:
        para_rows = conn.execute("SELECT idx, uuid FROM paragraphs WHERE document_id = ?", (document_id,)).fetchall()
        idx_to_uuid = {r["idx"]: r["uuid"] for r in para_rows}

        existing_rows = conn.execute(
            "SELECT * FROM chapters WHERE document_id = ? ORDER BY title_paragraph_idx ASC",
            (document_id,),
        ).fetchall()
        existing_by_uuid = {r["title_paragraph_uuid"]: dict(r) for r in existing_rows if r["title_paragraph_uuid"]}
        existing_by_idx = {r["title_paragraph_idx"]: dict(r) for r in existing_rows if r["title_paragraph_idx"] is not None}
        max_sort = max([r["sort_order"] for r in existing_rows], default=-1)

        for c in new_chapters:
            tip = c.get("title_paragraph_idx")
            tip_uuid = c.get("title_paragraph_uuid") or idx_to_uuid.get(tip)
            if tip is None and not tip_uuid:
                continue

            start_idx = c.get("start_idx", tip)
            end_idx = c.get("end_idx", tip)
            level = c.get("level", 1)
            parent_idx = c.get("parent_idx")

            start_uuid = c.get("start_paragraph_uuid") or idx_to_uuid.get(start_idx)
            end_uuid = c.get("end_paragraph_uuid") or idx_to_uuid.get(end_idx)
            parent_uuid = c.get("parent_uuid") or idx_to_uuid.get(parent_idx)

            old_ch = None
            if tip_uuid and tip_uuid in existing_by_uuid:
                old_ch = existing_by_uuid[tip_uuid]
            elif tip is not None and tip in existing_by_idx:
                old_ch = existing_by_idx[tip]

            if old_ch:
                # 场景 A: 既有章节已存在，100% 保留原标题与原 detected_by，仅补充更新起止范围与 UUID
                conn.execute(
                    """UPDATE chapters
                       SET start_idx = ?, end_idx = ?, parent_idx = COALESCE(?, parent_idx),
                           title_paragraph_uuid = COALESCE(?, title_paragraph_uuid),
                           start_paragraph_uuid = COALESCE(?, start_paragraph_uuid),
                           end_paragraph_uuid = COALESCE(?, end_paragraph_uuid),
                           parent_uuid = COALESCE(?, parent_uuid)
                       WHERE id = ?""",
                    (start_idx, end_idx, parent_idx, tip_uuid, start_uuid, end_uuid, parent_uuid, old_ch["id"]),
                )
            else:
                # 场景 C: 全新段落章节，标记 detected_by='llm' 增量插入
                max_sort += 1
                ch_id = generate_id()
                title = c.get("title") or (f"第 {tip} 段" if tip is not None else "新章节")
                conn.execute(
                    """INSERT INTO chapters
                       (id, document_id, title, title_paragraph_idx, title_paragraph_uuid, level, parent_idx, parent_uuid,
                        start_idx, start_paragraph_uuid, end_idx, end_paragraph_uuid, sort_order, detected_by)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'llm')""",
                    (ch_id, document_id, title, tip, tip_uuid, level, parent_idx, parent_uuid, start_idx, start_uuid, end_idx, end_uuid, max_sort),
                )
                newly_added_count += 1

                # 仅当为主章 (level == 1) 时，同步更新该段落的硬分页类型为 auto_chapter
                if tip is not None and tip > 0 and level == 1:
                    conn.execute(
                        """UPDATE paragraphs
                           SET has_page_break_before = 1, page_break_type = 'auto_chapter'
                           WHERE document_id = ? AND idx = ? AND page_break_type = 'none'""",
                        (document_id, tip),
                    )

        total_count = conn.execute(
            "SELECT COUNT(*) as c FROM chapters WHERE document_id = ?",
            (document_id,),
        ).fetchone()["c"]

    recompute_chapter_sort_orders(document_id)
    return total_count, newly_added_count


# ==================== 项目作者/设定与人物图谱 CRUD ====================

def update_project_profile(project_id: str, author_name: str | None = None, author_intro: str | None = None, background_setting: str | None = None, theme_mode: str | None = None):
    """更新项目的作者设定与背景信息。"""
    with get_conn() as conn:
        conn.execute(
            """UPDATE projects
               SET author_name = COALESCE(?, author_name),
                   author_intro = COALESCE(?, author_intro),
                   background_setting = COALESCE(?, background_setting),
                   theme_mode = COALESCE(?, theme_mode),
                   updated_at = datetime('now', 'localtime')
               WHERE id = ?""",
            (author_name, author_intro, background_setting, theme_mode, project_id),
        )


def upsert_character(project_id: str, name: str, aliases: list[str] | None = None, role: str = "supporting", first_appear_idx: int = 0, description: str = "", first_appear_paragraph_uuid: str | None = None) -> str:
    """插入或更新项目角色信息。"""
    from app.utils.helpers import generate_id
    aliases_json = json.dumps(aliases or [], ensure_ascii=False)
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM characters WHERE project_id = ? AND name = ?",
            (project_id, name),
        ).fetchone()
        if existing:
            char_id = existing["id"]
            conn.execute(
                """UPDATE characters
                   SET aliases = ?, role = ?, description = ?, first_appear_paragraph_uuid = COALESCE(?, first_appear_paragraph_uuid)
                   WHERE id = ?""",
                (aliases_json, role, description, first_appear_paragraph_uuid, char_id),
            )
            return char_id
        else:
            char_id = generate_id()
            conn.execute(
                """INSERT INTO characters (id, project_id, name, aliases, role, first_appear_idx, first_appear_paragraph_uuid, description)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (char_id, project_id, name, aliases_json, role, first_appear_idx, first_appear_paragraph_uuid, description),
            )
            return char_id


def get_characters(project_id: str) -> list[dict]:
    """获取项目的全部角色列表。"""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM characters WHERE project_id = ? ORDER BY first_appear_idx ASC",
            (project_id,),
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            try:
                d["aliases"] = json.loads(d.get("aliases") or "[]")
            except Exception:
                d["aliases"] = []
            result.append(d)
        return result


def insert_relationship(project_id: str, from_char_id: str, to_char_id: str, relation_type: str, description: str = "", paragraph_idx: int = 0, paragraph_uuid: str | None = None) -> str:
    """写入角色动态演进关系。"""
    from app.utils.helpers import generate_id
    rel_id = generate_id()
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO character_relationships
               (id, project_id, from_char_id, to_char_id, relation_type, description, paragraph_idx, paragraph_uuid)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (rel_id, project_id, from_char_id, to_char_id, relation_type, description, paragraph_idx, paragraph_uuid),
        )
        return rel_id


def get_character_graph(project_id: str, upto_paragraph_idx: int | None = None, upto_paragraph_uuid: str | None = None) -> dict:
    """获取项目的人物关系图谱网络数据（支持按段落编号或 UUID 截断查看演进过程）。"""
    chars = get_characters(project_id)
    plot_events = get_plot_events(project_id, upto_paragraph_idx, upto_paragraph_uuid)
    with get_conn() as conn:
        if upto_paragraph_uuid is not None:
            # 查出此 uuid 对应的 idx 以便筛选
            p_row = conn.execute("SELECT idx FROM paragraphs WHERE uuid = ?", (upto_paragraph_uuid,)).fetchone()
            cutoff_idx = p_row["idx"] if p_row else None
            if cutoff_idx is not None:
                rel_rows = conn.execute(
                    """SELECT r.*, f.name as from_name, t.name as to_name
                       FROM character_relationships r
                       JOIN characters f ON r.from_char_id = f.id
                       JOIN characters t ON r.to_char_id = t.id
                       WHERE r.project_id = ? AND r.paragraph_idx <= ?
                       ORDER BY r.paragraph_idx ASC""",
                    (project_id, cutoff_idx),
                ).fetchall()
            else:
                rel_rows = []
        elif upto_paragraph_idx is not None:
            rel_rows = conn.execute(
                """SELECT r.*, f.name as from_name, t.name as to_name
                   FROM character_relationships r
                   JOIN characters f ON r.from_char_id = f.id
                   JOIN characters t ON r.to_char_id = t.id
                   WHERE r.project_id = ? AND r.paragraph_idx <= ?
                   ORDER BY r.paragraph_idx ASC""",
                (project_id, upto_paragraph_idx),
            ).fetchall()
        else:
            rel_rows = conn.execute(
                """SELECT r.*, f.name as from_name, t.name as to_name
                   FROM character_relationships r
                   JOIN characters f ON r.from_char_id = f.id
                   JOIN characters t ON r.to_char_id = t.id
                   WHERE r.project_id = ?
                   ORDER BY r.paragraph_idx ASC""",
                (project_id,),
            ).fetchall()

    return {
        "nodes": chars,
        "edges": [dict(r) for r in rel_rows],
        "plot_events": plot_events,
    }


def insert_plot_event(project_id: str, paragraph_idx: int, title: str, description: str = "", paragraph_uuid: str | None = None) -> str:
    """写入剧情关键非角色关系事件。"""
    from app.utils.helpers import generate_id
    event_id = generate_id()
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO plot_events
               (id, project_id, paragraph_idx, paragraph_uuid, title, description)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (event_id, project_id, paragraph_idx, paragraph_uuid, title, description),
        )
        return event_id


def get_plot_events(project_id: str, upto_paragraph_idx: int | None = None, upto_paragraph_uuid: str | None = None) -> list[dict]:
    """获取项目的剧情关键事件列表（支持时间轴截至段落筛选）。"""
    with get_conn() as conn:
        if upto_paragraph_uuid is not None:
            p_row = conn.execute("SELECT idx FROM paragraphs WHERE uuid = ?", (upto_paragraph_uuid,)).fetchone()
            cutoff_idx = p_row["idx"] if p_row else None
            if cutoff_idx is not None:
                rows = conn.execute(
                    """SELECT * FROM plot_events
                       WHERE project_id = ? AND paragraph_idx <= ?
                       ORDER BY paragraph_idx ASC""",
                    (project_id, cutoff_idx),
                ).fetchall()
            else:
                rows = []
        elif upto_paragraph_idx is not None:
            rows = conn.execute(
                """SELECT * FROM plot_events
                   WHERE project_id = ? AND paragraph_idx <= ?
                   ORDER BY paragraph_idx ASC""",
                (project_id, upto_paragraph_idx),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT * FROM plot_events
                   WHERE project_id = ?
                   ORDER BY paragraph_idx ASC""",
                (project_id,),
            ).fetchall()
        return [dict(r) for r in rows]


def insert_glossary_term(project_id: str, term: str, category: str = "custom", std_replacement: str | None = None) -> str:
    """插入项目专属或规范异形词。"""
    from app.utils.helpers import generate_id
    term_id = generate_id()
    with get_conn() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO glossary_terms (id, project_id, term, category, std_replacement)
               VALUES (?, ?, ?, ?, ?)""",
            (term_id, project_id, term, category, std_replacement),
        )
        return term_id


def get_glossary_terms(project_id: str) -> list[dict]:
    """获取项目的术语/异形词列表。"""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM glossary_terms WHERE project_id = ? ORDER BY created_at DESC",
            (project_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def create_chat_session(project_id: str, title: str = "新对话", model: str | None = None) -> dict:
    """新建对话会话。"""
    session_id = f"cs_{uuid.uuid4().hex[:12]}"
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO chat_sessions (id, project_id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (session_id, project_id, title, model, now, now),
        )
    return {
        "id": session_id,
        "project_id": project_id,
        "title": title,
        "model": model,
        "created_at": now,
        "updated_at": now,
    }


def list_chat_sessions(project_id: str) -> list[dict]:
    """获取项目的会话列表（含消息计数）。"""
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT s.id, s.project_id, s.title, s.model, s.created_at, s.updated_at,
                   COUNT(m.id) as message_count
            FROM chat_sessions s
            LEFT JOIN chat_messages m ON s.id = m.session_id
            WHERE s.project_id = ?
            GROUP BY s.id
            ORDER BY s.updated_at DESC
            """,
            (project_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_chat_session(session_id: str) -> dict | None:
    """获取指定会话详情。"""
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM chat_sessions WHERE id = ?", (session_id,)).fetchone()
        return dict(row) if row else None


def delete_chat_session(session_id: str) -> bool:
    """删除会话及其关联的所有消息。"""
    with get_conn() as conn:
        conn.execute("DELETE FROM chat_messages WHERE session_id = ?", (session_id,))
        cur = conn.execute("DELETE FROM chat_sessions WHERE id = ?", (session_id,))
        return cur.rowcount > 0


def update_chat_session_title(session_id: str, title: str) -> bool:
    """更新会话标题与更新时间。"""
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?",
            (title, now, session_id),
        )
        return cur.rowcount > 0


def insert_chat_message(session_id: str, role: str, content: str, context: dict | None = None) -> dict:
    """新增单条对话消息并更新会话活跃时间。"""
    msg_id = f"cm_{uuid.uuid4().hex[:12]}"
    now = datetime.datetime.now().isoformat(timespec="seconds")
    context_str = json.dumps(context, ensure_ascii=False) if context else None
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO chat_messages (id, session_id, role, content, context, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (msg_id, session_id, role, content, context_str, now),
        )
        conn.execute(
            "UPDATE chat_sessions SET updated_at = ? WHERE id = ?",
            (now, session_id),
        )
    return {
        "id": msg_id,
        "session_id": session_id,
        "role": role,
        "content": content,
        "context": context,
        "created_at": now,
    }


def list_chat_messages(session_id: str) -> list[dict]:
    """获取指定会话按时间升序排列的历史消息。"""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC",
            (session_id,),
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            if d.get("context"):
                try:
                    d["context"] = json.loads(d["context"])
                except Exception:
                    pass
            result.append(d)
        return result


# 启动时初始化表 + 设置缓存
init_db()
_load_settings_cache()

