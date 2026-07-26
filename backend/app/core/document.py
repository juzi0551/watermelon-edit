import re
from docx import Document as DocxDocument

EMPTY_SKIP_STYLES = {"TOC", "Header", "Footer", "Footnote Text", "Endnote Text"}

CHAPTER_REGEX_L1 = re.compile(r"^第[零一二三四五六七八九十百千万0-9A-Za-z]+[章卷部]")
CHAPTER_REGEX_L2 = re.compile(r"^第[零一二三四五六七八九十百千万0-9A-Za-z]+[节回]")
CHAPTER_REGEX_NUMBER = re.compile(r"^([0-9]{1,3}|[一二三四五六七八九十]+)[\s.、:：_-]")
CHAPTER_KEYWORDS = {"序章", "序言", "前言", "楔子", "尾声", "后记", "附录", "番外"}


def parse_paragraphs(file_path: str) -> tuple[list[tuple], list[dict]]:
    """解析 docx，返回:
    1. 有序段落列表 [(idx, text, style_name, page_break_type), ...]（包含空段落）。
    2. 基于标题样式和正则初步提取的初始章节列表。
    """
    doc = DocxDocument(file_path)
    rows = []
    chapters = []
    idx = 0

    for para in doc.paragraphs:
        style_name = para.style.name or ""
        if style_name in EMPTY_SKIP_STYLES:
            continue

        raw_text = para.text or ""
        text = raw_text.rstrip("\r\n")

        # 1. 检查物理硬分页符类型（排查软分页 w:lastRenderedPageBreak）
        xml_str = para._element.xml if hasattr(para, "_element") else ""
        has_original_break = False
        if 'w:type="page"' in xml_str or "w:pageBreakBefore" in xml_str or "w:sectPr" in xml_str:
            has_original_break = True

        # 2. 识别章节级别
        chapter_level = None
        style_lower = style_name.lower()

        if "heading 1" in style_lower or "标题 1" in style_name or style_lower == "heading1" or style_name == "标题1":
            chapter_level = 1
        elif "heading 2" in style_lower or "标题 2" in style_name or style_lower == "heading2" or style_name == "标题2":
            chapter_level = 2
        elif "heading 3" in style_lower or "标题 3" in style_name or style_lower == "heading3" or style_name == "标题3":
            chapter_level = 3
        elif "heading" in style_lower or "标题" in style_name or "title" in style_lower:
            chapter_level = 1
        elif text.strip():
            t_strip = text.strip()
            if CHAPTER_REGEX_L1.match(t_strip) or t_strip in CHAPTER_KEYWORDS:
                chapter_level = 1
            elif CHAPTER_REGEX_L2.match(t_strip):
                chapter_level = 2
            elif CHAPTER_REGEX_NUMBER.match(t_strip) and len(t_strip) < 40:
                chapter_level = 2

        # 3. 确定最终 Page Break 属性 ('original' | 'auto_chapter' | 'none')
        page_break_type = "none"
        if has_original_break:
            page_break_type = "original"
        elif chapter_level == 1 and idx > 0:
            page_break_type = "auto_chapter"

        rows.append((idx, text, style_name, page_break_type))

        if chapter_level is not None and text.strip():
            chapters.append({
                "title": text.strip(),
                "title_paragraph_idx": idx,
                "level": chapter_level,
            })

        idx += 1

    total_paras = len(rows)
    for i, ch in enumerate(chapters):
        ch["start_idx"] = ch["title_paragraph_idx"]
        if i + 1 < len(chapters):
            ch["end_idx"] = max(ch["start_idx"], chapters[i + 1]["title_paragraph_idx"] - 1)
        else:
            ch["end_idx"] = max(ch["start_idx"], total_paras - 1 if total_paras > 0 else 0)

    return rows, chapters
