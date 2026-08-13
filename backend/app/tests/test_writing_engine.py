import unittest
from unittest.mock import patch, AsyncMock
from app.core.database import create_blank_project_with_doc, get_project
from app.core.writing_engine import (
    generate_opening_suggestions,
    expand_scene_beats,
    expand_sensory_details,
    tab_autocomplete_text,
)
from app.utils.helpers import generate_id


class TestWritingEngine(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.project_id = generate_id()
        create_blank_project_with_doc(
            project_id=self.project_id,
            name="赛博星空",
            author_name="测试作者",
            background_setting="未来高科技城市",
            genre="科幻",
            system_prompt="句式紧凑，注重动词与环境视听描写",
        )

    @patch("app.core.writing_engine.call_llm")
    async def test_generate_opening_suggestions(self, mock_call_llm):
        mock_response = """{
          "openings": [
            {
              "style_name": "强冲突动作开场",
              "concept": "直接切入追逐战",
              "sample_prose": "警报声在狭窄的巷道间回荡..."
            }
          ],
          "chapter_outline": [
            {"chapter": "第一章", "title": "代号：破晓", "beat_summary": "发现关键芯片"}
          ]
        }"""
        mock_call_llm.return_value = (mock_response, {"total_tokens": 100})

        res = await generate_opening_suggestions(self.project_id)
        self.assertIn("openings", res)
        self.assertEqual(len(res["openings"]), 1)
        self.assertEqual(res["openings"][0]["style_name"], "强冲突动作开场")

    @patch("app.core.writing_engine.call_llm")
    async def test_expand_scene_beats(self, mock_call_llm):
        mock_call_llm.return_value = ("雨打在废弃仓库的锌铁皮屋顶上，发出乒乓巨响...", {"total_tokens": 200})

        draft = await expand_scene_beats(
            project_id=self.project_id,
            scene_beats=["1. 主角潜入仓库", "2. 发现神秘宝箱"],
            chapter_title="第一章 潜入",
        )
        self.assertIn("雨打在废弃仓库", draft)

    @patch("app.core.writing_engine.call_llm")
    async def test_expand_sensory_details(self, mock_call_llm):
        mock_response = """{
          "options": [
            {"mode": "visual", "title": "视觉细节", "text": "刺眼的霓虹冷光折射在水洼中..."}
          ]
        }"""
        mock_call_llm.return_value = (mock_response, {"total_tokens": 120})

        options = await expand_sensory_details(
            project_id=self.project_id,
            text="雨水湿透了他的衣服。",
        )
        self.assertEqual(len(options), 1)
        self.assertEqual(options[0]["mode"], "visual")


if __name__ == "__main__":
    unittest.main()
