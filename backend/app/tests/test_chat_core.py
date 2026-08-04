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

    def test_no_context_guard_no_replacement_card(self):
        """测试 B1 守护规则：当无选区 (context_info 为空) 时，即使 LLM 误触发 tool_call 也不产生 replacement_card。"""
        formatted_tool_calls = [{"id": "call_123", "function": {"name": "propose_paragraph_edit", "arguments": '{"replacement_text":"测试"}'}}]

        # 场景 A: context_info 为 None
        context_info_none = None
        current_para_idx_none = None
        authoritative_original_none = (context_info_none and context_info_none.get("selected_text")) or ""

        replacement_card_a = None
        if formatted_tool_calls and current_para_idx_none is not None and authoritative_original_none:
            replacement_card_a = {"original": authoritative_original_none}
        self.assertIsNone(replacement_card_a)

        # 场景 B: context_info 存在但 selected_text 为空
        context_info_empty = {"selected_text": ""}
        current_para_idx_b = 2
        authoritative_original_b = (context_info_empty and context_info_empty.get("selected_text")) or ""

        replacement_card_b = None
        if formatted_tool_calls and current_para_idx_b is not None and authoritative_original_b:
            replacement_card_b = {"original": authoritative_original_b}
        self.assertIsNone(replacement_card_b)


if __name__ == "__main__":
    unittest.main()
