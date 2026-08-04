import os
import sys
import tempfile
import unittest

backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import app.core.database as db_mod
from app.core.database import (
    init_db,
    get_conn,
    create_project,
    create_document,
    insert_paragraphs,
    get_visible_paragraphs,
    get_paragraphs,
    get_paragraph_count,
    delete_paragraph_and_reorder,
    merge_paragraphs,
    merge_multiple_paragraphs,
    resolve_paragraph_target,
    clean_empty_paragraphs,
    restore_paragraph,
    update_paragraph_text,
    get_character_graph,
)
from app.core.proofer import _extract_and_save_character_events


class TestParagraphLifecycle(unittest.TestCase):

    def setUp(self):
        # 使用临时数据库驱动隔离测试，100% 杜绝污染真实硬盘数据库
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.test_db_path = os.path.join(self.tmp_dir.name, "test_lifecycle.db")
        self.orig_db_path = db_mod.DB_PATH
        self.orig_db_dir = db_mod.DB_DIR
        db_mod.DB_PATH = self.test_db_path
        db_mod.DB_DIR = self.tmp_dir.name
        init_db()

    def tearDown(self):
        db_mod.DB_PATH = self.orig_db_path
        db_mod.DB_DIR = self.orig_db_dir
        self.tmp_dir.cleanup()

    def _setup_document(self, doc_id="test_doc_001"):
        proj_id = f"proj_{doc_id}"
        create_project(proj_id, f"Project {doc_id}")
        create_document(doc_id, proj_id, "test.docx", "test.docx")

        rows = [(i, f"这是测试段落内容 #{i}", "Normal") for i in range(10)]
        insert_paragraphs(doc_id, rows)

        with get_conn() as conn:
            paras = conn.execute("SELECT idx, uuid FROM paragraphs WHERE document_id = ? ORDER BY idx", (doc_id,)).fetchall()
            uuids = {r["idx"]: r["uuid"] for r in paras}
        return doc_id, proj_id, uuids

    def test_logic_delete_multiple_paragraphs_no_unique_conflict(self):
        """测试多次逻辑删除段落，验证 idx=NULL 且 id=doc:deleted:uuid，无 SQLite 物理主键及 UNIQUE 冲突，且后续段落 idx 正确平移"""
        doc_id, _, uuids = self._setup_document("doc_logic_del")
        
        # 第一次删除：删除 idx=2
        delete_paragraph_and_reorder(doc_id, 2)
        
        # 第二次删除：再删除现 idx=2 (即原 idx=3)
        delete_paragraph_and_reorder(doc_id, 2)
        
        # 验证可视段落仅剩 8 个
        visible = get_visible_paragraphs(doc_id)
        self.assertEqual(len(visible), 8)
        for idx, p in enumerate(visible):
            self.assertEqual(p["idx"], idx)
            
        # 验证全量段落共有 10 个，且 2 个被标记为 is_deleted=1, idx=None
        all_paras = get_paragraphs(doc_id)
        self.assertEqual(len(all_paras), 10)
        deleted_paras = [p for p in all_paras if p.get("is_deleted") == 1]
        self.assertEqual(len(deleted_paras), 2)
        for p in deleted_paras:
            self.assertIsNone(p["idx"])
            self.assertTrue(p["id"].startswith(f"{doc_id}:deleted:"))

    def test_single_and_batch_merge_write_merged_into_uuid(self):
        """测试单段合并与批量合并段落，验证 merged_into_uuid 正确写入且单段/多段追溯机制完全一致"""
        doc_id, _, uuids = self._setup_document("doc_merge")
        
        # 1. 单段合并：合并 idx=0 与 idx=1 (direction=below)，保留 idx=0 (uuids[0])
        merge_paragraphs(doc_id, uuids[0], direction="below")
        res1 = resolve_paragraph_target(doc_id, uuids[1])
        self.assertEqual(res1["status"], "merged")
        self.assertEqual(res1["target_uuid"], uuids[0])
        self.assertTrue(res1["was_merged"])

        # 2. 批量合并：合并剩余有效段落的前 3 段
        visible = get_visible_paragraphs(doc_id)
        b_uuids = [visible[1]["uuid"], visible[2]["uuid"], visible[3]["uuid"]]
        merge_multiple_paragraphs(doc_id, b_uuids)

        res_b2 = resolve_paragraph_target(doc_id, b_uuids[1])
        self.assertEqual(res_b2["status"], "merged")
        self.assertEqual(res_b2["target_uuid"], b_uuids[0])

    def test_update_via_merged_uuid_resolves_to_target(self):
        """验证通过已合并段落的 UUID 提交编辑修改，能被透明解析并应用至目标保留段落"""
        doc_id, _, uuids = self._setup_document("doc_update_merged")
        merge_multiple_paragraphs(doc_id, [uuids[1], uuids[2]])

        from app.api.projects import _resolve_para
        resolved_para = _resolve_para(doc_id, uuids[2])
        self.assertIsNotNone(resolved_para)
        self.assertEqual(resolved_para["uuid"], uuids[1])

        # 执行更新
        update_paragraph_text(doc_id, resolved_para["idx"], "针对已合并段落应用的润色文本")
        target_p = resolve_paragraph_target(doc_id, uuids[1])
        self.assertIn("针对已合并段落应用的润色文本", target_p["display_text"])

    def test_resolve_paragraph_target_cycle_and_merged_then_deleted(self):
        """测试死循环防锁定与 merged_then_deleted 状态"""
        doc_id, _, uuids = self._setup_document("doc_cycle")
        
        with get_conn() as conn:
            conn.execute("UPDATE paragraphs SET is_deleted=1, idx=NULL, merged_into_uuid=? WHERE uuid=?", (uuids[2], uuids[1]))
            conn.execute("UPDATE paragraphs SET is_deleted=1, idx=NULL, merged_into_uuid=? WHERE uuid=?", (uuids[1], uuids[2]))
            
        res = resolve_paragraph_target(doc_id, uuids[1])
        self.assertIn(res["status"], ["deleted", "merged_then_deleted", "not_found"])

    def test_clean_empty_preserves_merge_trace_and_remaps_indices(self):
        """测试 clean_empty_paragraphs 不抹除合并/删除指针，并重新精准映射所有关联表索引"""
        doc_id, _, uuids = self._setup_document("doc_clean_trace")
        merge_multiple_paragraphs(doc_id, [uuids[1], uuids[2]])
        
        clean_empty_paragraphs(doc_id)
        
        res2 = resolve_paragraph_target(doc_id, uuids[2])
        self.assertEqual(res2["status"], "merged")
        self.assertEqual(res2["target_uuid"], uuids[1])

    def test_restore_deleted_paragraph_refuses_merged(self):
        """测试 restore_paragraph 恢复已删段落，且拒绝误恢复被合并段落"""
        doc_id, _, uuids = self._setup_document("doc_restore")
        
        delete_paragraph_and_reorder(doc_id, 3)
        self.assertEqual(len(get_visible_paragraphs(doc_id)), 9)
        
        # 正常恢复 deleted 段落
        res = restore_paragraph(doc_id, uuids[3], target_idx=3)
        self.assertIsNotNone(res)
        self.assertEqual(len(get_visible_paragraphs(doc_id)), 10)

        # 尝试恢复 merged 段落应被拒绝
        merge_multiple_paragraphs(doc_id, [uuids[1], uuids[2]])
        res_refuse = restore_paragraph(doc_id, uuids[2])
        self.assertIsNone(res_refuse)

    def test_status_api_cross_version_uuid(self):
        """验证跨版本段落查询返回 stale_version"""
        doc_id1, proj_id, uuids1 = self._setup_document("doc_ver1")
        
        # 创建版本 2
        create_document("doc_ver2", proj_id, "test.docx", "test.docx")
        with get_conn() as conn:
            conn.execute("UPDATE documents SET version = 2 WHERE id = 'doc_ver2'")
        rows = [(i, f"版本2段落 #{i}", "Normal") for i in range(5)]
        insert_paragraphs("doc_ver2", rows)

        # 拿着版本 1 的 UUID 在版本 2 中查询
        res = resolve_paragraph_target("doc_ver2", uuids1[0])
        self.assertEqual(res["status"], "stale_version")
        self.assertEqual(res["version"], 1)

    def test_character_extract_writes_paragraph_uuid(self):
        """验证 proofer 图谱抽取完整带上了 paragraph_uuid 属性"""
        doc_id, proj_id, uuids = self._setup_document("doc_proofer")
        
        llm_data = {
            "character_updates": [
                {"name": "主角A", "role": "protagonist", "first_appear_idx": 2, "description": "主角描述"}
            ],
            "relationship_events": [
                {"from": "主角A", "to": "配角B", "type": "friend", "paragraph_idx": 2}
            ],
            "plot_events": [
                {"title": "事件一", "description": "关键剧情", "paragraph_idx": 2}
            ]
        }
        
        _extract_and_save_character_events(proj_id, llm_data, 2, doc_id)
        
        graph = get_character_graph(proj_id)
        node = next((n for n in graph["nodes"] if n["name"] == "主角A"), None)
        self.assertIsNotNone(node)
        self.assertEqual(node.get("first_appear_paragraph_uuid"), uuids[2])

    def test_get_visible_paragraphs_count(self):
        """验证 get_paragraph_count 仅统计视口有效段落数"""
        doc_id, _, _ = self._setup_document("doc_count")
        self.assertEqual(get_paragraph_count(doc_id), 10)
        
        delete_paragraph_and_reorder(doc_id, 0)
        self.assertEqual(get_paragraph_count(doc_id), 9)

    def test_legacy_version12_db_migration(self):
        """模拟存量 DB (version=12, idx NOT NULL 限制) 平滑升级至 version=13"""
        # 人工构造旧版数据库表
        with get_conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
                INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '12');
                
                CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT);
                INSERT INTO projects (id, name) VALUES ('proj_v12', 'V12 Project');

                CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, project_id TEXT, filename TEXT, version INTEGER);
                INSERT INTO documents (id, project_id, filename, version) VALUES ('doc_v12', 'proj_v12', 'v12.docx', 1);

                CREATE TABLE IF NOT EXISTS paragraphs (
                    id TEXT PRIMARY KEY,
                    document_id TEXT NOT NULL,
                    idx INTEGER NOT NULL,  -- 旧版带 NOT NULL 限制
                    text TEXT NOT NULL,
                    revised_text TEXT,
                    style_name TEXT,
                    char_count INTEGER,
                    has_page_break_before INTEGER DEFAULT 0,
                    page_break_type TEXT DEFAULT 'none',
                    edit_note TEXT
                );
                INSERT INTO paragraphs (id, document_id, idx, text) VALUES ('doc_v12:0', 'doc_v12', 0, '旧版段落内容0');
            """)

        # 触发全量平滑迁移与物理自愈
        init_db()

        with get_conn() as conn:
            ver = conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()["value"]
            self.assertEqual(ver, "13")

            # 验证旧数据保留无损
            row = conn.execute("SELECT * FROM paragraphs WHERE id = 'doc_v12:0'").fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row["text"], "旧版段落内容0")

            # 验证可以用 NULL 逻辑删除而不报 NOT NULL IntegrityError
            conn.execute("UPDATE paragraphs SET idx = NULL, is_deleted = 1 WHERE id = 'doc_v12:0'")
            del_row = conn.execute("SELECT is_deleted, idx FROM paragraphs WHERE id = 'doc_v12:0'").fetchone()
            self.assertEqual(del_row["is_deleted"], 1)
            self.assertIsNone(del_row["idx"])

    def test_export_filters_deleted_paragraphs(self):
        """验证文档导出函数 get_revised_paragraphs 会过滤被逻辑删除的段落"""
        doc_id, proj_id, uuids = self._setup_document("test_export_doc")
        
        db_mod.delete_paragraph_and_reorder(doc_id, 0)
        exported = db_mod.get_revised_paragraphs(doc_id)
        
        self.assertEqual(len(exported), 9)
        self.assertEqual(exported[0]["text"], "这是测试段落内容 #1")


if __name__ == "__main__":
    unittest.main()
