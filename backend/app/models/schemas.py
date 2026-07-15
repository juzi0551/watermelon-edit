from pydantic import BaseModel
from datetime import datetime


class Chapter(BaseModel):
    id: str
    title: str
    content: str
    order: int


class Document(BaseModel):
    document_id: str
    filename: str
    chapters: list[Chapter]


class ProofreadError(BaseModel):
    type: str  # typo | grammar | punctuation | format
    chapter_id: str
    paragraph_index: int
    original_text: str
    suggested_text: str
    severity: str  # high | medium | low
    description: str


class ProofreadResult(BaseModel):
    model_config = {"protected_namespaces": ()}

    document_id: str
    model_used: str
    errors: list[ProofreadError]
    created_at: str = datetime.now().isoformat()


class ModelInfo(BaseModel):
    id: str
    name: str


class ModelsResponse(BaseModel):
    models: list[ModelInfo]
