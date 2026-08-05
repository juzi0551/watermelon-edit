"""API 级端到端测试：段落生命周期、合并追溯、采纳落点、恢复、跨版本、图谱 uuid 落库。

覆盖手动回归清单：
1. 删除/恢复段落 → 正文过滤 + status deleted + restore 插回
2. 单段/批量合并 → merged 追溯 + 关联重定向
3. 纯 uuid 采纳 / 被合并 uuid 采纳落点 / 已删 uuid 采纳 400
4. 跨版本 stale_version
5. mock LLM 校对 → 图谱三表 uuid 落库
"""
import asyncio
import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import app.core.database as db_mod
from app.core.database import (
    init_db, create_project, create_document, insert_paragraphs,
    update_project_document, get_conn,
)
from fastapi.testclient import TestClient
from app.main import app as fastapi_app


def setup_env():
    """隔离临时数据库"""
    tmp = tempfile.TemporaryDirectory()
    orig_db_path = db_mod.DB_PATH
    orig_db_dir = db_mod.DB_DIR
    db_mod.DB_PATH = os.path.join(tmp.name, "e2e.db")
    db_mod.DB_DIR = tmp.name
    return tmp, orig_db_path, orig_db_dir


def make_llm_response():
    """构造 mock LLM 校对响应（含图谱与错误）"""
    return json.dumps({
        "errors": [
            {"type": "typo", "paragraph_index": 1, "original_text": "E2E段落1",
             "suggested_text": "E2E段落1改", "severity": "medium", "description": "测试"}
        ],
        "chapters": [],
        "character_updates": [
            {"name": "张三", "first_appear_idx": 1, "role": "main", "aliases": []}
        ],
        "relationship_events": [
            {"from": "张三", "to": "李四", "type": "friend", "description": "", "paragraph_idx": 2}
        ],
        "plot_events": [
            {"title": "关键剧情", "description": "", "paragraph_idx": 3}
        ],
    })


from app.core.auth import get_current_user

class TestApiE2E(unittest.TestCase):
    def setUp(self):
        """每个测试独立临时库与项目，杜绝用例间状态耦合"""
        fastapi_app.dependency_overrides[get_current_user] = lambda: {"id": "test_user", "username": "admin"}
        self._tmp, self._orig_path, self._orig_dir = setup_env()
        init_db()
        self.proj = "proj_e2e"
        self.doc = "doc_e2e"
        create_project(self.proj, "E2E 项目")
        create_document(self.doc, self.proj, "e2e.docx", "e2e.docx")
        insert_paragraphs(self.doc, [(i, f"E2E段落{i}", "Normal") for i in range(10)])
        update_project_document(self.proj, self.doc)
        self.client = TestClient(fastapi_app)
        with get_conn() as conn:
            rows = conn.execute(
                "SELECT idx, uuid FROM paragraphs WHERE document_id = ? ORDER BY idx", (self.doc,)
            ).fetchall()
        self.uuids = {r["idx"]: r["uuid"] for r in rows}

    def tearDown(self):
        fastapi_app.dependency_overrides.clear()
        db_mod.DB_PATH = self._orig_path
        db_mod.DB_DIR = self._orig_dir
        self._tmp.cleanup()

    # ── 1. 删除 / 恢复 / 正文过滤 ──────────────────────────────
    def test_delete_restore_and_visibility(self):
        res = self.client.delete(f"/api/projects/{self.proj}/paragraphs/3",
                                 params={"paragraph_uuid": self.uuids[3]})
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body.get("status"), "ok")

        # 正文过滤：9 段，无 idx=3
        data = self.client.get(f"/api/projects/{self.proj}/results").json()
        self.assertEqual(len(data["paragraphs"]), 9)
        self.assertNotIn(self.uuids[3], {p["uuid"] for p in data["paragraphs"]})

        # status: deleted
        st = self.client.get(f"/api/projects/{self.proj}/paragraphs/{self.uuids[3]}/status").json()
        self.assertEqual(st["status"], "deleted")

        # 二次删除：幂等提示
        res2 = self.client.delete(f"/api/projects/{self.proj}/paragraphs/3",
                                  params={"paragraph_uuid": self.uuids[3]})
        self.assertEqual(res2.json().get("status"), "already_deleted")

        # 恢复 → 正文 10 段且 uuid 归位
        r = self.client.post(f"/api/projects/{self.proj}/paragraphs/{self.uuids[3]}/restore",
                             json={"target_idx": 3})
        self.assertEqual(r.status_code, 200)
        data = self.client.get(f"/api/projects/{self.proj}/results").json()
        self.assertEqual(len(data["paragraphs"]), 10)
        self.assertEqual(data["paragraphs"][3]["uuid"], self.uuids[3])

    # ── 2. 单段合并追溯 ────────────────────────────────────────
    def test_single_merge_tracing(self):
        # 合并段落 5(keep) 与 6(remove)
        res = self.client.post(f"/api/projects/{self.proj}/paragraphs/5/merge",
                               json={"direction": "below", "separator": "", "paragraph_uuid": self.uuids[5]})
        self.assertEqual(res.status_code, 200)

        st = self.client.get(f"/api/projects/{self.proj}/paragraphs/{self.uuids[6]}/status").json()
        self.assertEqual(st["status"], "merged")
        self.assertEqual(st["target_uuid"], self.uuids[5])

        # 正文段落数 9
        data = self.client.get(f"/api/projects/{self.proj}/results").json()
        self.assertEqual(len(data["paragraphs"]), 9)

    # ── 3. 批量合并追溯 ────────────────────────────────────────
    def test_batch_merge_tracing(self):
        # 合并 7/8/9 三段
        res = self.client.post(f"/api/projects/{self.proj}/paragraphs/merge_batch",
                               json={"paragraph_uuids": [self.uuids[7], self.uuids[8], self.uuids[9]],
                                     "separator": ""})
        self.assertEqual(res.status_code, 200)

        for i in (8, 9):
            st = self.client.get(f"/api/projects/{self.proj}/paragraphs/{self.uuids[i]}/status").json()
            self.assertEqual(st["status"], "merged")
            self.assertEqual(st["target_uuid"], self.uuids[7])

    # ── 4. 采纳落点：被合并 uuid → 目标段；已删 uuid → 400 ─────
    def test_apply_via_merged_uuid_lands_on_target(self):
        # 先合并段落 5(keep) 与 6(remove)，再对已合并段落 6 的 uuid 发起 PATCH
        m = self.client.post(f"/api/projects/{self.proj}/paragraphs/5/merge",
                             json={"direction": "below", "separator": "", "paragraph_uuid": self.uuids[5]})
        self.assertEqual(m.status_code, 200)

        target = self.uuids[6]  # 已合并到 5
        res = self.client.patch(f"/api/projects/{self.proj}/paragraphs/{target}",
                                json={"text": "合并后新文本", "paragraph_uuid": target})
        self.assertEqual(res.status_code, 200)
        body = res.json()
        # 落点应是 keep 段 uuid
        self.assertEqual(body.get("uuid"), self.uuids[5])
        self.assertEqual(body.get("text"), "合并后新文本")

    def test_apply_deleted_returns_400(self):
        target = self.uuids[3]  # 测试 1 中恢复过，仍为正常段 —— 先删除再验证
        self.client.delete(f"/api/projects/{self.proj}/paragraphs/{target}",
                           params={"paragraph_uuid": target})
        res = self.client.patch(f"/api/projects/{self.proj}/paragraphs/{target}",
                                json={"text": "不应写入", "paragraph_uuid": target})
        self.assertEqual(res.status_code, 400)

        # 恢复现场
        self.client.post(f"/api/projects/{self.proj}/paragraphs/{target}/restore", json={})

    def test_apply_pure_uuid_without_idx(self):
        # 纯 uuid 采纳（历史卡片场景）：url 用 uuid、body 无 paragraph_uuid
        target = self.uuids[1]
        res = self.client.patch(f"/api/projects/{self.proj}/paragraphs/{target}",
                                json={"text": "纯uuid采纳"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json().get("uuid"), target)

    # ── 5. 跨版本 stale_version ────────────────────────────────
    def test_cross_version_stale(self):
        new_doc = "doc_e2e_v2"
        create_document(new_doc, self.proj, "e2e_v2.docx", "e2e_v2.docx")
        insert_paragraphs(new_doc, [(i, f"新版段落{i}", "Normal") for i in range(5)])
        update_project_document(self.proj, new_doc)

        st = self.client.get(f"/api/projects/{self.proj}/paragraphs/{self.uuids[0]}/status").json()
        self.assertEqual(st["status"], "stale_version")
        self.assertEqual(st["version"], 1)

        # 当前版本段落为 normal
        with get_conn() as conn:
            new_uuid = conn.execute(
                "SELECT uuid FROM paragraphs WHERE document_id = ? AND idx = 0", (new_doc,)
            ).fetchone()[0]
        st2 = self.client.get(f"/api/projects/{self.proj}/paragraphs/{new_uuid}/status").json()
        self.assertEqual(st2["status"], "normal")

    # ── 6. mock LLM 校对 → 图谱三表 uuid 落库 ─────────────────
    def test_proofread_writes_graph_uuids(self):
        from app.core import proofer

        async def run():
            return await proofer.proofread_window(
                "E2E prompt", "mock-model", selected_types=["typo"],
                project_id=self.proj, window_first_idx=0, document_id=self.doc,
            )

        with patch.object(proofer, "call_llm", return_value=(make_llm_response(), {"tokens": 10})):
            asyncio.run(run())

        with get_conn() as conn:
            char = conn.execute(
                "SELECT first_appear_paragraph_uuid FROM characters WHERE project_id = ? AND name = '张三'",
                (self.proj,)
            ).fetchone()
            rel = conn.execute(
                "SELECT paragraph_uuid FROM character_relationships WHERE project_id = ? AND relation_type = 'friend'",
                (self.proj,)
            ).fetchone()
            ev = conn.execute(
                "SELECT paragraph_uuid FROM plot_events WHERE project_id = ? AND title = '关键剧情'",
                (self.proj,)
            ).fetchone()

        self.assertTrue(char and char["first_appear_paragraph_uuid"])
        self.assertTrue(rel and rel["paragraph_uuid"])
        self.assertTrue(ev and ev["paragraph_uuid"])

        # 图谱接口返回 uuid 字段
        graph = self.client.get(f"/api/projects/{self.proj}/character-graph").json()
        self.assertTrue(any(n.get("first_appear_paragraph_uuid") for n in graph.get("nodes", [])))
        self.assertTrue(any(e.get("paragraph_uuid") for e in graph.get("edges", [])))

    # ── 7. 链式合并追溯 ────────────────────────────────────────
    def test_chained_merge_tracing(self):
        # 构造：先把段落 0 合并到…（已有段落被合并情况）验证 5 层内链式
        with get_conn() as conn:
            # 手工构造 B->A->C：a 合并到 c，b 合并到 a
            conn.execute(
                "UPDATE paragraphs SET is_deleted=1, idx=NULL, merged_into_uuid=? WHERE uuid=?",
                (self.uuids[0], self.uuids[1])
            )
            conn.execute(
                "UPDATE paragraphs SET is_deleted=1, idx=NULL, merged_into_uuid=? WHERE uuid=?",
                (self.uuids[2], self.uuids[0])
            )

        st = self.client.get(f"/api/projects/{self.proj}/paragraphs/{self.uuids[1]}/status").json()
        self.assertEqual(st["status"], "merged")
        self.assertEqual(st["target_uuid"], self.uuids[2])


if __name__ == "__main__":
    unittest.main()
