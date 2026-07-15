from docx import Document as DocxDocument

EMPTY_SKIP_STYLES = {"TOC", "Header", "Footer", "Footnote Text", "Endnote Text"}


def parse_paragraphs(file_path: str) -> list[tuple]:
    """解析 docx，返回有序非空段落 [(idx, text, style_name), ...]。

    章节识别交给 LLM（proofer），此处只做最朴素的抽取。
    idx 为本表中段落的顺序下标（从 0 开始），供后续校对与定位使用。
    """
    doc = DocxDocument(file_path)
    out = []
    idx = 0
    for para in doc.paragraphs:
        style_name = para.style.name or ""
        if style_name in EMPTY_SKIP_STYLES:
            continue
        text = para.text.strip()
        if not text:
            continue
        out.append((idx, text, style_name))
        idx += 1
    return out
