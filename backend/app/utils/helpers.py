import uuid
import os


def generate_id() -> str:
    return uuid.uuid4().hex[:12]


def ensure_dirs():
    os.makedirs("backend/uploads", exist_ok=True)
    os.makedirs("backend/static", exist_ok=True)
