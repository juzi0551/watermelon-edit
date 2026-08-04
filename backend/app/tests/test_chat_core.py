import unittest
import os
import sys
import tempfile
import sqlite3

backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import app.core.database as db_mod
from app.core.database import (
    init_db, create_project, create_document, insert_paragraphs,
    create_chat_session, list_chat_sessions, get_chat_session, delete_chat_session,
    update_chat_session_title, insert_chat_message, list_chat_messages,
    update_paragraph_revised, get_paragraphs_in_range, get_conn
)
from app.core.chat import build_chat_context, build_chat_system_prompt
from app.api.chat import resolve_chat_model


class TestChatCore(unittest.TestCase):
    def setUp(self):
        # 隔离临时数据库，绝不污染真实生产库
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.test_db_path = os.path.join(self.tmp_dir.name, "test_novel.db")
        self.orig_db_path = db_mod.DB_PATH
        self.orig_db_dir = db_mod.DB_DIR
        db_mod.DB_PATH = self.test_db_path
        db_mod.DB_DIR = self.tmp_dir.name
        
        # 初始化表结构并开启外键强校验
        init_db()
        with get_conn() as conn:
            conn.execute("PRAGMA foreign_keys = ON;")

    def tearDown(self):
        db_mod.DB_PATH = self.orig_db_path
        db_mod.DB_DIR = self.orig_db_dir
        self.tmp_dir.cleanup()

    def test_build_chat_context_boundaries(self):
        """测试 build_chat_context 的各种边界场景 (首段/末段/跨段/越界/revised_text 双轨)。"""
        proj_id = "test_chat_context_proj"
        doc_id = "test_chat_context_doc"

        # 正确参数顺序无错调用：create_project(project_id, name) 与 create_document(doc_id, project_id, filename, file_path)
        create_project(proj_id, "Chat Context Proj")
        create_document(doc_id, proj_id, "test.docx", "test.docx")

        # 插入 5 个测试段落
        paragraphs = [
            (0, "第0段：阳光穿过白桦林，洒在河滩上。", "Normal"),
            (1, "第1段：智星和看瓜老爷爷打了个招呼。", "Normal"),
            (2, "第2段：老爷爷笑呵呵地递过来一块冰镇西瓜。", "Normal"),
            (3, "第3段：少年们围坐在树荫下开心地吃瓜。", "Normal"),
            (4, "第4段：夕阳西下，晚风吹拂着河面。", "Normal"),
        ]
        insert_paragraphs(doc_id, paragraphs)

        # 1. 边界1：首段 (idx 0) 全段框选
        ctx_first_full = build_chat_context(doc_id, para_idx=0, selected_text="", context_chars=50)
        self.assertEqual(ctx_first_full["para_idx"], 0)
        self.assertEqual(ctx_first_full["before_window"], "")
        self.assertTrue("第1段" in ctx_first_full["after_window"] or "智星" in ctx_first_full["after_window"])
        self.assertTrue("[待优化的正文]" in ctx_first_full["formatted_context"])

        # 2. 边界2：同段内划选 (划选 "阳光穿过白桦林"，同段同前有 "第0段：")
        ctx_first_sub = build_chat_context(doc_id, para_idx=0, selected_text="阳光穿过白桦林", context_chars=50)
        self.assertEqual(ctx_first_sub["before_window"], "第0段：")
        self.assertTrue("洒在河滩上" in ctx_first_sub["after_window"])

        # 3. 边界3：末段 (idx 4)
        ctx_last = build_chat_context(doc_id, para_idx=4, selected_text="", context_chars=50)
        self.assertEqual(ctx_last["para_idx"], 4)
        self.assertEqual(ctx_last["after_window"], "")
        self.assertTrue("第3段" in ctx_last["before_window"] or "少年们" in ctx_last["before_window"])

        # 4. 边界4：跨段框选 (idx 1 ~ 3)
        ctx_cross = build_chat_context(doc_id, para_idx=1, selected_text="跨段内容", para_end_idx=3, context_chars=50)
        self.assertEqual(ctx_cross["para_idx"], 1)
        self.assertEqual(ctx_cross["para_end_idx"], 3)
        self.assertTrue("第0段" in ctx_cross["before_window"])
        self.assertTrue("第4段" in ctx_cross["after_window"])

        # 5. 边界5：越界字数裁剪 (context_chars 超长)
        ctx_over = build_chat_context(doc_id, para_idx=2, selected_text="冰镇西瓜", context_chars=1000)
        self.assertTrue(len(ctx_over["before_window"]) > 0)
        self.assertTrue(len(ctx_over["after_window"]) > 0)

        # 6. 边界6：双轨文本 (revised_text 优先于 text)
        p2_rows = get_paragraphs_in_range(doc_id, 2, 3)
        self.assertEqual(len(p2_rows), 1)
        update_paragraph_revised(p2_rows[0]["id"], revised_text="【已润色】老爷爷笑呵呵地递过来一块特甜冰镇西瓜。")
        ctx_revised = build_chat_context(doc_id, para_idx=2, selected_text="", context_chars=50)
        self.assertTrue("【已润色】" in ctx_revised["selected_text"])

    def test_chat_session_and_message_crud(self):
        """测试会话与消息的完整 CRUD 流程与确定性排序。"""
        proj_id = "test_crud_proj"
        create_project(proj_id, "CRUD Proj")

        # 1. 创建会话
        session = create_chat_session(proj_id, title="测试会话", model="deepseek-v4-flash")
        session_id = session["id"]
        self.assertTrue(session_id.startswith("cs_"))
        self.assertEqual(session["title"], "测试会话")

        # 2. 查询会话列表
        sessions = list_chat_sessions(proj_id)
        self.assertTrue(any(s["id"] == session_id for s in sessions))

        # 3. 插入消息 (User 与 Assistant)
        msg1 = insert_chat_message(session_id, "user", "分析下这个人物设定", context={"selected_text": "智星"})
        msg2 = insert_chat_message(session_id, "assistant", "智星是个有领导力的少年。")
        self.assertTrue(msg1["id"].startswith("cm_"))
        self.assertTrue(msg2["id"].startswith("cm_"))

        # 4. 检索消息 (验证排序与 JSON 上下文)
        msgs = list_chat_messages(session_id)
        self.assertEqual(len(msgs), 2)
        self.assertEqual(msgs[0]["role"], "user")
        self.assertEqual(msgs[0]["context"]["selected_text"], "智星")
        self.assertEqual(msgs[1]["role"], "assistant")

        # 5. 更新会话标题
        update_chat_session_title(session_id, "更新后的标题")
        s_detail = get_chat_session(session_id)
        self.assertEqual(s_detail["title"], "更新后的标题")

        # 6. 删除会话
        self.assertTrue(delete_chat_session(session_id))
        self.assertIsNone(get_chat_session(session_id))
        self.assertEqual(len(list_chat_messages(session_id)), 0)

    def test_build_replacement_card_uuid_authoritative(self):
        """测试对话卡片构建逻辑：UUID 为唯一契约主键，paragraph_idx 由服务端动态派生。"""
        from app.api.chat import _build_replacement_card

        # 1. 场景 A: 模型只回传 paragraph_uuid (无 paragraph_idx)，服务端成功派生 paragraph_idx
        parsed_args_a = {
            "paragraph_uuid": "real_uuid_100",
            "original_text": "原文内容",
            "replacement_text": "替换内容",
            "note": "润色说明"
        }
        context_info_a = {"paragraph_uuid": "real_uuid_100", "selected_text": "原文内容"}
        # 模拟没有数据库连接时，fallback 为 current_para_idx
        card_a = _build_replacement_card(parsed_args_a, context_info_a, current_para_idx=5, doc_id=None, authoritative_original="原文内容")
        self.assertIsNotNone(card_a)
        self.assertEqual(card_a["paragraph_uuid"], "real_uuid_100")
        self.assertEqual(card_a["paragraph_idx"], 5)

        # 2. 场景 B: 模型回显错误/非法 paragraph_uuid，权威优先采纳请求侧 context_info 中的 paragraph_uuid
        parsed_args_b = {
            "paragraph_uuid": "wrong_hallucinated_uuid",
            "original_text": "原文",
            "replacement_text": "修改"
        }
        context_info_b = {"paragraph_uuid": "correct_req_uuid", "selected_text": "原文"}
        card_b = _build_replacement_card(parsed_args_b, context_info_b, current_para_idx=3, doc_id=None, authoritative_original="原文")
        self.assertIsNotNone(card_b)
        self.assertEqual(card_b["paragraph_uuid"], "correct_req_uuid")

        # 3. 场景 C: 模型未回传 UUID，且缺少 context_info 与 current_para_idx -> 无法锁定 UUID，不产卡片
        parsed_args_c = {
            "original_text": "原文",
            "replacement_text": "修改"
        }
        card_c = _build_replacement_card(parsed_args_c, None, current_para_idx=None, doc_id=None, authoritative_original="")
        self.assertIsNone(card_c)

        # 4. 场景 D: 缺少原文 (original_text 为空) -> 不产卡片
        parsed_args_d = {
            "paragraph_uuid": "some_uuid",
            "replacement_text": "修改"
        }
        card_d = _build_replacement_card(parsed_args_d, None, current_para_idx=1, doc_id=None, authoritative_original="")
        self.assertIsNone(card_d)

    def test_build_replacement_card_real_db_derivation_and_merge_redirect(self):
        """测试对话卡片在真实 DB 场景下的派生逻辑：包含活性段落派生、被合并段落自动重定向目标 idx 以及已删除段落不产卡。"""
        from app.api.chat import _build_replacement_card
        from app.core.database import merge_multiple_paragraphs, delete_paragraph_and_reorder, get_conn

        proj_id = "test_card_proj"
        doc_id = "test_card_doc"
        create_project(proj_id, "Card Test Proj")
        create_document(doc_id, proj_id, "test.docx", "test.docx", 1)

        # 插入 3 段测试数据
        rows = [
            (0, "第一段：初始正文内容A", "Normal"),
            (1, "第二段：将被合并的内容B", "Normal"),
            (2, "第三段：独立正文内容C", "Normal"),
        ]
        insert_paragraphs(doc_id, rows)

        with get_conn() as conn:
            p_rows = conn.execute("SELECT idx, uuid FROM paragraphs WHERE document_id = ? ORDER BY idx ASC", (doc_id,)).fetchall()
            uuid_0, uuid_1, uuid_2 = p_rows[0]["uuid"], p_rows[1]["uuid"], p_rows[2]["uuid"]

        # 1. 活性段落：模型回传 uuid_2，服务端自动从真实 DB 解析出 idx=2
        parsed_active = {"paragraph_uuid": uuid_2, "original_text": "第三段：独立正文内容C", "replacement_text": "修改C"}
        card_active = _build_replacement_card(parsed_active, context_info=None, current_para_idx=None, doc_id=doc_id)
        self.assertIsNotNone(card_active)
        self.assertEqual(card_active["paragraph_uuid"], uuid_2)
        self.assertEqual(card_active["paragraph_idx"], 2)

        # 2. 合并段落重定向：将 idx=1 合并至 idx=0，然后针对 uuid_1 生成卡片
        merge_multiple_paragraphs(doc_id, [uuid_0, uuid_1])
        parsed_merged = {"paragraph_uuid": uuid_1, "original_text": "第二段：将被合并的内容B", "replacement_text": "修改B"}
        card_merged = _build_replacement_card(parsed_merged, context_info=None, current_para_idx=None, doc_id=doc_id)
        self.assertIsNotNone(card_merged)
        self.assertEqual(card_merged["paragraph_uuid"], uuid_1)
        self.assertEqual(card_merged["paragraph_idx"], 0)  # 成功重定向到合并目标段落 idx=0！

        # 3. 已删除段落：合并后 uuid_2 索引平移至 1，删除 idx=1，验证硬加固逻辑生效（不产出卡片）
        delete_paragraph_and_reorder(doc_id, 1)
        parsed_deleted = {"paragraph_uuid": uuid_2, "original_text": "第三段", "replacement_text": "修改"}
        card_deleted = _build_replacement_card(parsed_deleted, context_info=None, current_para_idx=1, doc_id=doc_id)
        self.assertIsNone(card_deleted)


if __name__ == "__main__":
    unittest.main()
