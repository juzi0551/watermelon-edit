import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from app.api import upload, proofread, results, apply, export, models, projects, settings, debug
from app.utils.helpers import ensure_dirs
from app.core.database import init_db

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(BACKEND_DIR, "static")
INDEX_PATH = os.path.join(STATIC_DIR, "index.html")


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_dirs()
    init_db()
    yield


app = FastAPI(
    title="小说校稿工具",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS（开发阶段允许所有来源）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册 API 路由
app.include_router(projects.router, prefix="/api", tags=["projects"])
app.include_router(settings.router, prefix="/api", tags=["settings"])
app.include_router(upload.router, prefix="/api", tags=["upload"])
app.include_router(proofread.router, prefix="/api", tags=["proofread"])
app.include_router(results.router, prefix="/api", tags=["results"])
app.include_router(apply.router, prefix="/api", tags=["apply"])
app.include_router(export.router, prefix="/api", tags=["export"])
app.include_router(models.router, prefix="/api", tags=["models"])
app.include_router(debug.router, prefix="/api", tags=["debug"])


@app.get("/api/health")
async def health():
    return {"status": "ok"}


# 托管前端静态文件（构建后放在 backend/static）
if os.path.isdir(STATIC_DIR):
    from fastapi.staticfiles import StaticFiles
    assets_dir = os.path.join(STATIC_DIR, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")


# SPA 回退：所有非 /api 路由都返回 index.html（支持前端路由）
@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    if full_path.startswith("api/"):
        return {"error": "Not Found"}
    if os.path.isfile(os.path.join(STATIC_DIR, full_path)):
        return FileResponse(os.path.join(STATIC_DIR, full_path))
    if os.path.isfile(INDEX_PATH):
        return FileResponse(INDEX_PATH)
    return {"error": "前端未构建，请先 npm run build"}
