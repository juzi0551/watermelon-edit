import unittest
from app.core.database import (
    create_blank_project_with_doc, get_project, get_current_document,
    get_chapters, get_revised_paragraphs, update_project_profile
)
from app.utils.helpers import generate_id


class TestWritingMode(unittest.TestCase):
    def test_create_blank_project(self):
        project_id = generate_id()
        proj = create_blank_project_with_doc(
            project_id=project_id,
            name="星海纪元",
            author_name="西瓜少年",
            background_setting="赛博朋克近未来世界",
            genre="科幻小说",
            characters_summary="主角陆沉：旧时代程序员",
            conflict_summary="发现代码中藏有父亲遗言，被AI猎人追捕",
            system_prompt="硬核动作风，句式紧凑，侧重环境描述",
            system_prompt_preset="action_hardcore",
        )

        self.assertIsNotNone(proj)
        self.assertEqual(proj["name"], "星海纪元")
        self.assertEqual(proj["mode"], "writing")
        self.assertEqual(proj["author_name"], "西瓜少年")
        self.assertEqual(proj["background_setting"], "赛博朋克近未来世界")
        self.assertEqual(proj["genre"], "科幻小说")

        # 检查自动生成的默认文档
        doc = get_current_document(project_id)
        self.assertIsNotNone(doc)
        self.assertEqual(doc["filename"], "星海纪元.docx")

        # 检查自动生成的默认第一章
        chapters = get_chapters(doc["id"])
        self.assertEqual(len(chapters), 1)
        self.assertEqual(chapters[0]["title"], "第一章")

        # 检查自动生成的默认开篇第一段
        paras = get_revised_paragraphs(doc["id"])
        self.assertEqual(len(paras), 1)
        self.assertIn("【请在此落笔创作第一段】", paras[0]["text"])

    def test_update_project_writing_profile(self):
        project_id = generate_id()
        create_blank_project_with_doc(project_id, "草稿项目")

        update_project_profile(
            project_id=project_id,
            author_name="新作者",
            system_prompt="文风要求：偏重心理描写与对话",
            system_prompt_preset="psychological_flow",
        )

        proj = get_project(project_id)
        self.assertEqual(proj["author_name"], "新作者")
        self.assertEqual(proj["system_prompt"], "文风要求：偏重心理描写与对话")
        self.assertEqual(proj["system_prompt_preset"], "psychological_flow")


if __name__ == "__main__":
    unittest.main()
