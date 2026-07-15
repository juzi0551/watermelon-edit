from fastapi import APIRouter, UploadFile, File
from app.utils.helpers import generate_id
from app.core.document import parse_paragraphs
from app.core.database import (
    get_document as db_get_document,
    insert_paragraphs,
    get_paragraph_count,
)

router = APIRouter()


@router.post("/upload")
async def upload_document(file: UploadFile = File(...)):
    """上传 docx 文件（旧接口，保留兼容）。"""
    document_id = generate_id()
    file_path = f"backend/uploads/{document_id}_{file.filename}"

    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)

    rows = parse_paragraphs(file_path)
    insert_paragraphs(document_id, rows)

    return {
        "document_id": document_id,
        "filename": file.filename,
        "paragraph_count": len(rows),
    }


@router.get("/documents/{document_id}")
async def get_document(document_id: str):
    """获取文档信息（旧接口）。"""
    doc = db_get_document(document_id)
    if not doc:
        return {"error": "文档不存在"}
    return {
        "document_id": doc["id"],
        "filename": doc["filename"],
        "paragraph_count": get_paragraph_count(document_id),
    }


def get_chapters_for_document(document_id: str) -> list[dict]:
    """章节由 LLM 在校对时识别，此处返回空（兼容旧调用）。"""
    return []
