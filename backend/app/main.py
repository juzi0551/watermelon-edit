import os
import logging
from contextlib import asynccontextmanager
import dotenv
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.core.auth import get_current_user, verify_env_config, ENV_FILE_PATH
dotenv.load_dotenv(ENV_FILE_PATH)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

from app.api import upload, proofread, results, apply, export, models, projects, settings, debug, chat, auth, annotations, writing
from app.utils.helpers import ensure_dirs
import app.core.database as db_mod

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(BACKEND_DIR, "static")
INDEX_PATH = os.path.join(STATIC_DIR, "index.html")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. 验证环境变量配置
    verify_env_config()
    ensure_dirs()
    db_mod.init_db()

    # 2. 清理 DB 中弃用的 admin_password_hash 键（清理死数据）
    try:
        with db_mod.get_conn() as conn:
            conn.execute("DELETE FROM settings WHERE key = 'admin_password_hash'")
    except Exception:
        pass

    yield


app = FastAPI(
    title="Watermelon Edit",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS 配置
allowed_origins_env = os.getenv("ALLOWED_ORIGINS")
if allowed_origins_env:
    origins = [o.strip() for o in allowed_origins_env.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# 注册认证路由（未受保护）
app.include_router(auth.router, prefix="/api", tags=["auth"])

# 业务路由全局注入鉴权依赖
auth_dep = [Depends(get_current_user)]
app.include_router(projects.router, prefix="/api", tags=["projects"], dependencies=auth_dep)
app.include_router(settings.router, prefix="/api", tags=["settings"], dependencies=auth_dep)
app.include_router(upload.router, prefix="/api", tags=["upload"], dependencies=auth_dep)
app.include_router(proofread.router, prefix="/api", tags=["proofread"], dependencies=auth_dep)
app.include_router(results.router, prefix="/api", tags=["results"], dependencies=auth_dep)
app.include_router(apply.router, prefix="/api", tags=["apply"], dependencies=auth_dep)
app.include_router(export.router, prefix="/api", tags=["export"], dependencies=auth_dep)
app.include_router(models.router, prefix="/api", tags=["models"], dependencies=auth_dep)
app.include_router(debug.router, prefix="/api", tags=["debug"], dependencies=auth_dep)
app.include_router(chat.router, prefix="/api", tags=["chat"], dependencies=auth_dep)
app.include_router(annotations.router, prefix="/api", tags=["annotations"], dependencies=auth_dep)
app.include_router(writing.router, prefix="/api", tags=["writing"], dependencies=auth_dep)



@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    fav_path = os.path.join(STATIC_DIR, "favicon.ico")
    if os.path.exists(fav_path):
        return FileResponse(fav_path)
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
        # index.html 不做缓存（no-cache），保证构建后浏览器能拿到最新 bundle 哈希
        return FileResponse(INDEX_PATH, headers={"Cache-Control": "no-cache"})
    return {"error": "前端未构建，请先 npm run build"}
