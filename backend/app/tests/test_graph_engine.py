import json
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
    create_project,
    create_document,
    insert_paragraphs,
    upsert_character,
    insert_relationship,
    upsert_character_history_summary,
    get_character_history_summaries,
    delete_paragraph_and_reorder,
    insert_paragraph_and_reorder,
    resolve_paragraph_uuid,
)
from app.core.graph_engine import (
    get_character_graph,
    find_shortest_path,
    invalidate_graph_cache,
    _GRAPH_CACHE,
)
from app.core.proofer import _extract_and_save_character_events


class TestGraphEngine(unittest.TestCase):

    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.test_db_path = os.path.join(self.tmp_dir.name, "test_graph.db")
        self.orig_db_path = db_mod.DB_PATH
        self.orig_db_dir = db_mod.DB_DIR
        db_mod.DB_PATH = self.test_db_path
        db_mod.DB_DIR = self.tmp_dir.name
        init_db()
        invalidate_graph_cache()

    def tearDown(self):
        invalidate_graph_cache()
        db_mod.DB_PATH = self.orig_db_path
        db_mod.DB_DIR = self.orig_db_dir
        self.tmp_dir.cleanup()

    def _setup_project(self, project_id="proj_g1"):
        create_project(project_id, "Graph Test Project")
        doc_id = f"doc_{project_id}"
        create_document(doc_id, project_id, "test.docx", "test.docx")
        rows = [(i, f"段落内容 #{i}", "Normal") for i in range(10)]
        insert_paragraphs(doc_id, rows)
        return project_id, doc_id

    def test_character_history_summaries_crud(self):
        proj_id, doc_id = self._setup_project("proj_hist")
        c1_id = upsert_character(proj_id, "智星", aliases=["老大"], role="protagonist", first_appear_idx=0)

        h1_id = upsert_character_history_summary(
            project_id=proj_id,
            character_id=c1_id,
            paragraph_idx=0,
            delta_summary="初次登场，揭示沿河村少年身份",
        )
        self.assertTrue(bool(h1_id))

        h2_id = upsert_character_history_summary(
            project_id=proj_id,
            character_id=c1_id,
            paragraph_idx=5,
            delta_summary="在天山拜剑圣为师，获得名剑",
        )
        self.assertTrue(bool(h2_id))

        # 查全量履历
        summaries = get_character_history_summaries(proj_id, character_id=c1_id)
        self.assertEqual(len(summaries), 2)
        self.assertEqual(summaries[0]["delta_summary"], "初次登场，揭示沿河村少年身份")
        self.assertEqual(summaries[1]["delta_summary"], "在天山拜剑圣为师，获得名剑")

        # 查截断履历 (upto_paragraph_idx = 3)
        cutoff_summaries = get_character_history_summaries(proj_id, character_id=c1_id, upto_paragraph_idx=3)
        self.assertEqual(len(cutoff_summaries), 1)

    def test_graph_engine_topology_and_weights(self):
        proj_id, doc_id = self._setup_project("proj_topo")
        c1 = upsert_character(proj_id, "智星", role="protagonist")
        c2 = upsert_character(proj_id, "陆凡", role="supporting")
        c3 = upsert_character(proj_id, "看瓜老人", role="minor")

        # c1 <-> c2 两次关系事件, c2 <-> c3 一次关系事件
        insert_relationship(proj_id, c1, c2, "friend", "共同探险", paragraph_idx=1)
        insert_relationship(proj_id, c1, c2, "friend", "并肩作战", paragraph_idx=2)
        insert_relationship(proj_id, c2, c3, "neutral", "偶遇指路", paragraph_idx=3)

        graph = get_character_graph(proj_id)
        nodes = {n["id"]: n for n in graph["nodes"]}
        edges = graph["edges"]

        self.assertIn(c1, nodes)
        self.assertIn(c2, nodes)
        self.assertIn(c3, nodes)

        # 校验介数中心度: c2 作为中介节点，介数中心度应高于边缘节点
        self.assertGreaterEqual(nodes[c2]["centrality"], nodes[c1]["centrality"])
        self.assertGreaterEqual(nodes[c2]["centrality"], nodes[c3]["centrality"])

        # 校验 edges 按点对去重后的数量（c1-c2 被投影为 1 条 strength=2 的边，c2-c3 1 条）
        self.assertEqual(len(edges), 2)
        c1_c2_edge = next(e for e in edges if (e["from_char_id"] == c1 and e["to_char_id"] == c2) or (e["from_char_id"] == c2 and e["to_char_id"] == c1))
        self.assertEqual(c1_c2_edge["strength"], 2)

    def test_undeleted_paragraph_filtering(self):
        proj_id, doc_id = self._setup_project("proj_filter")
        c1 = upsert_character(proj_id, "智星")
        c2 = upsert_character(proj_id, "陆凡")

        rel_id = insert_relationship(proj_id, c1, c2, "friend", "在第 2 段结盟", paragraph_idx=2)

        graph_before = get_character_graph(proj_id)
        self.assertEqual(len(graph_before["edges"]), 1)

        # 逻辑删除第 2 段
        delete_paragraph_and_reorder(doc_id, 2)

        # 删除后，关联第 2 段的关系在原图谱中因段落已被逻辑删除而过滤
        graph_after = get_character_graph(proj_id)
        # 验证缓存已自动失效且关联已删段落的边被过滤（总边数为 0）
        self.assertIsNotNone(graph_after)
        self.assertEqual(len(graph_after["edges"]), 0)

    def test_cache_invalidation_on_write(self):
        proj_id, doc_id = self._setup_project("proj_inval")
        c1 = upsert_character(proj_id, "智星")
        c2 = upsert_character(proj_id, "陆凡")

        # 全量图查询后应写入缓存
        get_character_graph(proj_id)
        self.assertIn(proj_id, _GRAPH_CACHE)

        # 新增关系应主动失效缓存
        insert_relationship(proj_id, c1, c2, "friend", "结盟", paragraph_idx=1)
        self.assertNotIn(proj_id, _GRAPH_CACHE)

        # 新增角色应主动失效缓存
        get_character_graph(proj_id)
        self.assertIn(proj_id, _GRAPH_CACHE)
        upsert_character(proj_id, "看瓜老人", role="minor", first_appear_idx=2)
        self.assertNotIn(proj_id, _GRAPH_CACHE)

        # 重拉后可见新角色，证明非陈旧缓存
        graph = get_character_graph(proj_id)
        names = {n["name"] for n in graph["nodes"]}
        self.assertIn("看瓜老人", names)

    def test_delete_invalidates_cache(self):
        proj_id, doc_id = self._setup_project("proj_inval_del")
        c1 = upsert_character(proj_id, "智星")
        c2 = upsert_character(proj_id, "陆凡")
        insert_relationship(proj_id, c1, c2, "friend", "结盟", paragraph_idx=1)

        get_character_graph(proj_id)
        self.assertIn(proj_id, _GRAPH_CACHE)

        # 逻辑删除段落应主动失效全书图缓存
        delete_paragraph_and_reorder(doc_id, 1)
        self.assertNotIn(proj_id, _GRAPH_CACHE)

    def test_dijkstra_shortest_path(self):
        proj_id, doc_id = self._setup_project("proj_sp")
        cA = upsert_character(proj_id, "角色A")
        cB = upsert_character(proj_id, "角色B")
        cC = upsert_character(proj_id, "角色C")
        cD = upsert_character(proj_id, "孤立角色D")

        # 建立 A <-> B <-> C 路径
        insert_relationship(proj_id, cA, cB, "friend", "A与B交好", paragraph_idx=1)
        insert_relationship(proj_id, cB, cC, "ally", "B与C结盟", paragraph_idx=2)

        # 计算 A 到 C 最短路径
        res_AC = find_shortest_path(proj_id, cA, cC)
        self.assertTrue(res_AC["found"])
        path_ids = [n["id"] for n in res_AC["path_nodes"]]
        self.assertEqual(path_ids, [cA, cB, cC])
        self.assertEqual(len(res_AC["path_edges"]), 2)

        # 计算 A 到 孤立角色 D 的最短路径
        res_AD = find_shortest_path(proj_id, cA, cD)
        self.assertFalse(res_AD["found"])
        self.assertEqual(len(res_AD["path_nodes"]), 0)

    def test_proofer_alias_fallback_and_delta_summary(self):
        proj_id, doc_id = self._setup_project("proj_alias")

        # 预先录入主角色，带别名 "老大"
        c1_id = upsert_character(proj_id, "智星", aliases=["老大"], role="protagonist", first_appear_idx=0)

        # 模拟 LLM 响应：使用别名 "老大" 作为 from，与新角色 "看瓜老人" 建立关系
        mock_data = {
            "character_updates": [
                {
                    "name": "智星",
                    "aliases": ["老大"],
                    "role": "protagonist",
                    "first_appear_idx": 0,
                    "description": "全局概括 Profile",
                    "delta_summary": "在本段中揭示其拥有蜀山记名弟子身份",
                }
            ],
            "relationship_events": [
                {
                    "from": "老大",  # 使用别名
                    "to": "看瓜老人",
                    "type": "friend",
                    "description": "套近乎",
                    "paragraph_idx": 1,
                }
            ],
        }

        _extract_and_save_character_events(proj_id, mock_data, 1, doc_id)

        graph = get_character_graph(proj_id)
        nodes = graph["nodes"]
        edges = graph["edges"]

        # 验证 "老大" 成功回溯绑定到智星的 c1_id，没有产生重复的 "老大" 角色节点
        self.assertEqual(len(nodes), 2)
        names = {n["name"] for n in nodes}
        self.assertIn("智星", names)
        self.assertIn("看瓜老人", names)

        # 验证履历链 delta_summary 落库
        summaries = get_character_history_summaries(proj_id, character_id=c1_id)
        self.assertEqual(len(summaries), 1)
        self.assertEqual(summaries[0]["delta_summary"], "在本段中揭示其拥有蜀山记名弟子身份")

    def test_cache_invalidation_explicit(self):
        proj_id, doc_id = self._setup_project("proj_cache")
        c1 = upsert_character(proj_id, "智星")
        c2 = upsert_character(proj_id, "陆凡")
        insert_relationship(proj_id, c1, c2, "friend", "结交", paragraph_idx=1)

        # 首次查询，触发全量缓存写入
        graph1 = get_character_graph(proj_id)
        self.assertIn(proj_id, _GRAPH_CACHE)
        self.assertEqual(_GRAPH_CACHE[proj_id], graph1)

        # 显式按 project_id 失效
        invalidate_graph_cache(proj_id)
        self.assertNotIn(proj_id, _GRAPH_CACHE)

        # 重新生成并全量失效
        get_character_graph(proj_id)
        self.assertIn(proj_id, _GRAPH_CACHE)
        invalidate_graph_cache(None)
        self.assertEqual(len(_GRAPH_CACHE), 0)

    def test_idx_hist_dedup_constraint(self):
        proj_id, doc_id = self._setup_project("proj_dedup")
        c1 = upsert_character(proj_id, "智星")

        # 首次插入 (paragraph_idx=2, paragraph_uuid=None)
        upsert_character_history_summary(proj_id, c1, paragraph_idx=2, delta_summary="记录A")

        # 手动向数据库重复插入相同的 (character_id, COALESCE(paragraph_uuid, 'idx:' || paragraph_idx))
        import sqlite3
        with db_mod.get_conn() as conn:
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute(
                    """INSERT INTO character_descriptions_history
                       (id, project_id, character_id, paragraph_idx, paragraph_uuid, delta_summary)
                       VALUES ('h_dup', ?, ?, 2, NULL, '重复记录')""",
                    (proj_id, c1),
                )

    def test_proofer_four_stage_id_matching_and_fake_id_map(self):
        proj_id, doc_id = self._setup_project("proj_id_match")
        c1_id = upsert_character(proj_id, "智星", aliases=["老大"], role="protagonist", first_appear_idx=0)
        c2_id = upsert_character(proj_id, "陆凡", aliases=["小凡"], role="supporting", first_appear_idx=1)

        # 模拟 LLM 响应：
        # 1. 智星使用正确 character_id
        # 2. 陆凡使用幻觉 id "fake_id_999"（但名字为 "陆凡"）
        # 3. 关系引用 "fake_id_999" -> "老大"（别名）
        mock_data = {
            "character_updates": [
                {
                    "character_id": c1_id,
                    "name": "智星",
                    "aliases": ["老大"],
                    "role": "protagonist",
                    "first_appear_idx": 0,
                    "description": "全局画像A",
                    "delta_summary": "转折A",
                },
                {
                    "character_id": "fake_id_999",  # 幻觉 ID
                    "name": "陆凡",
                    "aliases": ["小凡"],
                    "role": "supporting",
                    "first_appear_idx": 1,
                    "description": "全局画像B",
                    "delta_summary": "转折B",
                },
            ],
            "relationship_events": [
                {
                    "from": "陆凡",
                    "from_character_id": "fake_id_999",  # 引用同一个幻觉 ID
                    "to": "老大",  # 使用别名
                    "to_character_id": "",
                    "type": "friend",
                    "description": "结拜兄弟",
                    "paragraph_idx": 2,
                }
            ],
        }

        _extract_and_save_character_events(proj_id, mock_data, 2, doc_id)

        graph = get_character_graph(proj_id)
        nodes = graph["nodes"]
        edges = graph["edges"]

        # 验证全书依然只有 2 个角色，没有增加 "fake_id_999" 或 "老大" 重复节点
        self.assertEqual(len(nodes), 2)
        node_ids = {n["id"] for n in nodes}
        self.assertIn(c1_id, node_ids)
        self.assertIn(c2_id, node_ids)

        # 验证关系边已精准连接在 c2_id (陆凡) 和 c1_id (智星) 之间
        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0]["from_char_id"], c2_id)
        self.assertEqual(edges[0]["to_char_id"], c1_id)

    def test_context_appearing_ids_and_suspected_new_characters_filtering(self):
        proj_id, doc_id = self._setup_project("proj_ctx_filter")
        c1_id = upsert_character(proj_id, "智星", description="沿河村少年老大")
        c2_id = upsert_character(proj_id, "陆凡", description="跟班配角")
        c3_id = upsert_character(proj_id, "未出场角色", description="远方高人")

        from app.core.context import build_project_context_parts

        # 仅传入 appearing_character_ids = [c1_id, c2_id]，并包含疑新角色
        ctx_parts = build_project_context_parts(
            project_id=proj_id,
            current_paragraph_idx=0,
            appearing_character_ids=[c1_id, c2_id],
            suspected_new_characters=[{"name": "神秘看瓜老者", "aliases": ["老瓜头"]}],
        )

        full_ctx = "\n".join(ctx_parts)
        self.assertIn(f"[character_id: {c1_id}]", full_ctx)
        self.assertIn(f"[character_id: {c2_id}]", full_ctx)
        self.assertNotIn("未出场角色", full_ctx)  # 未出场角色被正确隔离过滤
        self.assertIn("【本段怀疑新出现角色】", full_ctx)
        self.assertIn("神秘看瓜老者（别名：老瓜头）", full_ctx)

    def test_identify_window_characters_parsing(self):
        proj_id, doc_id = self._setup_project("proj_id_parse")
        c1_id = upsert_character(proj_id, "智星")

        from unittest.mock import patch
        from app.core.proofer import identify_window_characters

        mock_stage0_response = json.dumps({
            "appearing_character_ids": [c1_id, "non_existent_id"],
            "suspected_new_characters": [
                {"name": "剑圣", "aliases": ["无名剑客"], "first_appear_idx": 3}
            ]
        })

        async def _run():
            with patch("app.core.proofer.call_llm", return_value=(mock_stage0_response, {"tokens": 10})):
                app_ids, suspected = await identify_window_characters(proj_id, [(0, "智星拜见剑圣")])
                self.assertEqual(app_ids, [c1_id])  # non_existent_id 被剔除
                self.assertEqual(len(suspected), 1)
                self.assertEqual(suspected[0]["name"], "剑圣")

        import asyncio
        asyncio.run(_run())

    def test_name_variant_upsert_does_not_split_node(self):
        proj_id, doc_id = self._setup_project("proj_name_variant")
        c1_id = upsert_character(proj_id, "智星", aliases=["老大"], role="protagonist", first_appear_idx=0)

        # 模拟 LLM 输出 character_id = c1_id, 但 name 误写为别名 "老大"
        mock_data = {
            "character_updates": [
                {
                    "character_id": c1_id,
                    "name": "老大",  # 别名变体
                    "aliases": ["小石头"],
                    "role": "protagonist",
                    "first_appear_idx": 0,
                    "description": "全局画像更新",
                    "delta_summary": "转折描述",
                }
            ]
        }

        _extract_and_save_character_events(proj_id, mock_data, 0, doc_id)

        graph = get_character_graph(proj_id)
        nodes = graph["nodes"]

        # 校验仍然只有 1 个角色节点，主名仍为 "智星"，无分裂节点
        self.assertEqual(len(nodes), 1)
        self.assertEqual(nodes[0]["id"], c1_id)
        self.assertEqual(nodes[0]["name"], "智星")
        # 校验 "老大" 与 "小石头" 都整合进别名列表
        aliases = nodes[0]["aliases"]
        self.assertIn("老大", aliases)
        self.assertIn("小石头", aliases)

    def test_context_fallback_when_appearing_ids_empty_or_none(self):
        proj_id, doc_id = self._setup_project("proj_empty_ids")
        c1_id = upsert_character(proj_id, "智星", description="少年")

        from app.core.context import build_project_context_parts

        # 1. appearing_character_ids = None -> 回退 top-N
        ctx_none = build_project_context_parts(proj_id, 0, appearing_character_ids=None)
        self.assertIn("智星", "\n".join(ctx_none))

        # 2. appearing_character_ids = [] -> 安全回退 top-N（防 0 画像注入）
        ctx_empty = build_project_context_parts(proj_id, 0, appearing_character_ids=[])
        self.assertIn("智星", "\n".join(ctx_empty))

        # 3. appearing_character_ids = ["invalid_id"] -> 安全回退 top-N
        ctx_invalid = build_project_context_parts(proj_id, 0, appearing_character_ids=["invalid_id"])
        self.assertIn("智星", "\n".join(ctx_invalid))

    def test_proofread_identifier_model_setting_priority(self):
        proj_id, doc_id = self._setup_project("proj_model_priority")
        upsert_character(proj_id, "智星")

        from unittest.mock import patch
        from app.core.proofer import identify_window_characters

        called_models = []

        async def fake_call_llm(prompt, model_id, **kwargs):
            called_models.append(model_id)
            return json.dumps({"appearing_character_ids": []}), {"tokens": 10}

        def fake_get_setting(key, default=""):
            if key == "proofread_identifier_model":
                return "custom-fast-identifier-model"
            return default

        async def _run():
            with patch("app.core.proofer.call_llm", side_effect=fake_call_llm), \
                 patch("app.core.proofer.get_setting", side_effect=fake_get_setting):
                await identify_window_characters(proj_id, [(0, "智星")], model_id="default-model")
                # 验证优先使用 setting 配置的模型而非传入的 default-model
                self.assertEqual(called_models, ["custom-fast-identifier-model"])

        import asyncio
        asyncio.run(_run())

    def test_edge_projection_and_deduplication(self):
        proj_id, doc_id = self._setup_project("proj_projection")
        c1_id = upsert_character(proj_id, "智星", first_appear_idx=0)
        c2_id = upsert_character(proj_id, "陆凡", first_appear_idx=0)

        # 插入 3 条同一对角色的关系事件
        insert_relationship(proj_id, c1_id, c2_id, "ally", "初次结盟", paragraph_idx=1, paragraph_uuid="uuid_1")
        insert_relationship(proj_id, c1_id, c2_id, "friend", "共同御敌", paragraph_idx=3, paragraph_uuid="uuid_3")
        insert_relationship(proj_id, c1_id, c2_id, "enemy", "反目成仇", paragraph_idx=5, paragraph_uuid="uuid_5")

        graph = get_character_graph(proj_id)
        edges = graph["edges"]

        # 验证按点对去重为 1 条边
        self.assertEqual(len(edges), 1)
        edge = edges[0]

        # 验证强度、距离、起始/最后互动段落
        self.assertEqual(edge["strength"], 3)
        self.assertEqual(edge["distance"], 0.3333)
        self.assertEqual(edge["established_at"], 1)
        self.assertEqual(edge["last_seen"], 5)

        # 验证类型（2 次 friend vs 1 次 enemy 且 enemy 证据未达 3，血亲/频率判定保持 friend）
        self.assertEqual(edge["relation_type"], "friend")
        self.assertEqual(edge["description"], "反目成仇")
        self.assertEqual(edge["paragraph_idx"], 5)
        self.assertEqual(edge["paragraph_uuid"], "uuid_5")
        self.assertEqual(edge["from_char_id"], c1_id)
        self.assertEqual(edge["to_char_id"], c2_id)

    def test_family_locking_prevents_single_enemy_reversal(self):
        """验证 20 条 family + 1 条 enemy(最新) 无法破坏血亲锁定（必须证据充分 >=3 强反转）。"""
        proj_id, doc_id = self._setup_project("proj_family_lock")
        c1_id = upsert_character(proj_id, "贾宝玉", first_appear_idx=0)
        c2_id = upsert_character(proj_id, "贾政", first_appear_idx=0)

        for i in range(20):
            insert_relationship(proj_id, c1_id, c2_id, "family", f"血亲互动 {i}", paragraph_idx=i)

        # 最新一条为 enemy (证据仅 1 次)
        insert_relationship(proj_id, c1_id, c2_id, "enemy", "责骂误会", paragraph_idx=21)

        graph = get_character_graph(proj_id)
        edge = graph["edges"][0]
        self.assertEqual(edge["relation_type"], "family")

    def test_enemy_strong_reversal_with_sufficient_evidence(self):
        """验证 enemy 证据充分 (>=3) 时能够触发强反转。"""
        proj_id, doc_id = self._setup_project("proj_enemy_rev")
        c1_id = upsert_character(proj_id, "智星", first_appear_idx=0)
        c2_id = upsert_character(proj_id, "黑衣人", first_appear_idx=0)

        insert_relationship(proj_id, c1_id, c2_id, "friend", "初期误认同盟", paragraph_idx=1)
        insert_relationship(proj_id, c1_id, c2_id, "enemy", "刺杀事件", paragraph_idx=2)
        insert_relationship(proj_id, c1_id, c2_id, "enemy", "立场对立", paragraph_idx=3)
        insert_relationship(proj_id, c1_id, c2_id, "enemy", "决裂大战", paragraph_idx=4)

        graph = get_character_graph(proj_id)
        edge = graph["edges"][0]
        self.assertEqual(edge["relation_type"], "enemy")

    def test_lover_3x_override_family(self):
        """验证 lover 证据 >= family 证据 * 3 时能够覆盖弱血亲。"""
        proj_id, doc_id = self._setup_project("proj_lover_override")
        c1_id = upsert_character(proj_id, "角色A", first_appear_idx=0)
        c2_id = upsert_character(proj_id, "角色B", first_appear_idx=0)

        insert_relationship(proj_id, c1_id, c2_id, "family", "表亲关系", paragraph_idx=1)
        insert_relationship(proj_id, c1_id, c2_id, "lover", "倾慕定情1", paragraph_idx=2)
        insert_relationship(proj_id, c1_id, c2_id, "lover", "倾慕定情2", paragraph_idx=3)
        insert_relationship(proj_id, c1_id, c2_id, "lover", "倾慕定情3", paragraph_idx=4)

        graph = get_character_graph(proj_id)
        edge = graph["edges"][0]
        self.assertEqual(edge["relation_type"], "lover")

    def test_shortest_path_uses_projected_distance(self):
        proj_id, doc_id = self._setup_project("proj_sp_dist")
        c1_id = upsert_character(proj_id, "智星")
        c2_id = upsert_character(proj_id, "陆凡")
        c3_id = upsert_character(proj_id, "哈呼")

        # c1<->c2 有 3 次互动 (strength=3, dist=0.3333)
        insert_relationship(proj_id, c1_id, c2_id, "friend", "互动1", paragraph_idx=1)
        insert_relationship(proj_id, c1_id, c2_id, "friend", "互动2", paragraph_idx=2)
        insert_relationship(proj_id, c1_id, c2_id, "friend", "互动3", paragraph_idx=3)

        # c1<->c3 只有 1 次互动 (strength=1, dist=1.0)
        insert_relationship(proj_id, c1_id, c3_id, "friend", "互动A", paragraph_idx=1)

        res = find_shortest_path(proj_id, c1_id, c2_id)
        self.assertTrue(res["found"])
        self.assertEqual(len(res["path_nodes"]), 2)
        self.assertEqual(res["total_distance"], 0.3333)
        self.assertEqual(res["path_edges"][0]["strength"], 3)

    def test_relationship_summary_context_injection(self):
        proj_id, doc_id = self._setup_project("proj_rel_summary")
        c1_id = upsert_character(proj_id, "智星", first_appear_idx=0)
        c2_id = upsert_character(proj_id, "智星爸爸", first_appear_idx=0)
        insert_relationship(proj_id, c1_id, c2_id, "family", "父子相认", paragraph_idx=10)

        from app.core.context import build_project_context_parts
        ctx_parts = build_project_context_parts(proj_id, 10, appearing_character_ids=[c1_id, c2_id])
        full_ctx = "\n".join(ctx_parts)

        self.assertIn("【现有关系摘要】", full_ctx)
        self.assertIn("智星 —family→ 智星爸爸（确立于第 10 段）", full_ctx)


if __name__ == "__main__":
    unittest.main()
