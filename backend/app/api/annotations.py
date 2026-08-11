from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.core.database import (
    get_current_document, get_annotations, add_annotation,
    update_annotation, delete_annotation, get_paragraph_by_idx, get_paragraph_by_uuid
)

router = APIRouter()


class CreateAnnotationBody(BaseModel):
    paragraph_idx: int
    selected_text: str
    content: str
    paragraph_uuid: str | None = None
    start_offset: int = 0
    end_offset: int = 0


class UpdateAnnotationBody(BaseModel):
    content: str


@router.get("/projects/{project_id}/annotations")
async def api_get_annotations(project_id: str):
    """获取当前项目的全量划线注释。"""
    doc = get_current_document(project_id)
    if not doc:
        return []
    return get_annotations(doc["id"])


@router.post("/projects/{project_id}/annotations")
async def api_create_annotation(project_id: str, body: CreateAnnotationBody):
    """新增划线注释。"""
    doc = get_current_document(project_id)
    if not doc:
        raise HTTPException(status_code=404, detail="项目无关联文档")

    if not body.selected_text or not body.selected_text.strip():
        raise HTTPException(status_code=400, detail="引用正文不能为空")
    if not body.content or not body.content.strip():
        raise HTTPException(status_code=400, detail="注释内容不能为空")

    para = None
    if body.paragraph_uuid:
        para = get_paragraph_by_uuid(doc["id"], body.paragraph_uuid)
    if not para:
        para = get_paragraph_by_idx(doc["id"], body.paragraph_idx)

    real_idx = para["idx"] if para else body.paragraph_idx
    real_uuid = (para.get("uuid") if para else body.paragraph_uuid) or str(real_idx)

    result = add_annotation(
        document_id=doc["id"],
        paragraph_idx=real_idx,
        selected_text=body.selected_text.strip(),
        content=body.content.strip(),
        paragraph_uuid=real_uuid,
        start_offset=body.start_offset,
        end_offset=body.end_offset,
    )
    return {"status": "ok", "annotation": result}


@router.put("/projects/{project_id}/annotations/{annotation_id}")
async def api_update_annotation(project_id: str, annotation_id: str, body: UpdateAnnotationBody):
    """更新已有划线注释的内容。"""
    if not body.content or not body.content.strip():
        raise HTTPException(status_code=400, detail="注释内容不能为空")

    updated = update_annotation(annotation_id, body.content.strip())
    if not updated:
        raise HTTPException(status_code=404, detail="注释不存在")
    return {"status": "ok", "annotation": updated}


@router.delete("/projects/{project_id}/annotations/{annotation_id}")
async def api_delete_annotation(project_id: str, annotation_id: str):
    """删除划线注释。"""
    success = delete_annotation(annotation_id)
    if not success:
        raise HTTPException(status_code=404, detail="注释不存在")
    return {"status": "ok", "annotation_id": annotation_id}
