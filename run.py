"""
西瓜少年 — PyInstaller 入口脚本
打包后自动处理路径问题，数据目录写到 exe 同级的 data/ 下。
"""
import os
import sys
import shutil
import traceback
from datetime import datetime


# ═══════════════════════════════════════════════════════
# 日志：模块级初始化，确保任何 import 失败都能被捕获
# ═══════════════════════════════════════════════════════
_CRASH_LOG = None
_CRASH_LOG_PATH = None
try:
    if getattr(sys, 'frozen', False):
        _base_dir = os.path.dirname(sys.executable)
    else:
        _base_dir = os.path.dirname(os.path.abspath(__file__))
    _CRASH_LOG_PATH = os.path.join(_base_dir, 'crash.log')
    _CRASH_LOG = open(_CRASH_LOG_PATH, 'w', encoding='utf-8')
    sys.stdout = _CRASH_LOG
    sys.stderr = _CRASH_LOG
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] 西瓜少年启动中...")
except Exception:
    pass


# PyInstaller 静态依赖锚点（模块级 import → 自动打包）
try:
    import fastapi  # noqa: F401
    import starlette  # noqa: F401
    import pydantic  # noqa: F401
    import uvicorn  # noqa: F401
    import python_multipart  # noqa: F401
    import jinja2.ext  # noqa: F401
except Exception:
    traceback.print_exc()
    if _CRASH_LOG:
        _CRASH_LOG.flush()
        os.fsync(_CRASH_LOG.fileno())
    import time
    time.sleep(30)
    sys.exit(1)


def _restore_console():
    """将 stdout/stderr 恢复回控制台（启动成功后调用）。"""
    if _CRASH_LOG:
        sys.stdout.flush()
        sys.stderr.flush()
        saved = sys.__stdout__
        sys.stdout = saved if saved else _CRASH_LOG
        saved = sys.__stderr__
        sys.stderr = saved if saved else _CRASH_LOG


def get_base_dir():
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def ensure_user_data(base_dir):
    """确保用户数据目录存在，首次运行时从打包资源复制初始数据。"""
    user_data = os.path.join(base_dir, 'data')
    os.makedirs(user_data, exist_ok=True)
    os.makedirs(os.path.join(base_dir, 'uploads'), exist_ok=True)

    db_dst = os.path.join(user_data, 'novel_proofreader.db')
    if not os.path.exists(db_dst):
        if getattr(sys, 'frozen', False):
            db_src = os.path.join(sys._MEIPASS, 'backend', 'app', 'data', 'novel_proofreader.db')
            if os.path.exists(db_src):
                shutil.copy2(db_src, db_dst)

    keys_dst = os.path.join(user_data, 'api_keys.json')
    if not os.path.exists(keys_dst):
        with open(keys_dst, 'w', encoding='utf-8') as f:
            f.write('{}')

    return user_data


def main():
    base_dir = get_base_dir()

    try:
        backend_dir = os.path.join(base_dir, 'backend')
        if backend_dir not in sys.path:
            sys.path.insert(0, backend_dir)
        if base_dir not in sys.path:
            sys.path.insert(0, base_dir)
        user_data = ensure_user_data(base_dir)

        print(f"  base_dir  = {base_dir}")
        print(f"  user_data = {user_data}")
        print(f"  frozen    = {getattr(sys, 'frozen', False)}")

        # 1. database — DB_DIR / DB_PATH
        import app.core.database as db_mod
        db_mod.DB_DIR = user_data
        db_mod.DB_PATH = os.path.join(user_data, 'novel_proofreader.db')
        print("  [OK] database patched")

        # 2. config — KEYS_DIR / KEYS_PATH
        import config as cfg_mod
        cfg_mod.KEYS_DIR = user_data
        cfg_mod.KEYS_PATH = os.path.join(user_data, 'api_keys.json')
        print("  [OK] config patched")

        # 3. helpers — ensure_dirs
        upload_dir = os.path.join(base_dir, 'uploads')
        if getattr(sys, 'frozen', False):
            static_dir = os.path.join(sys._MEIPASS, 'backend', 'static')
        else:
            static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend', 'static')

        import app.utils.helpers as helpers_mod
        def patched_ensure_dirs():
            os.makedirs(upload_dir, exist_ok=True)
            os.makedirs(static_dir, exist_ok=True)
        helpers_mod.ensure_dirs = patched_ensure_dirs
        print("  [OK] helpers patched")

        # 4. main — STATIC_DIR / INDEX_PATH
        import app.main as main_mod
        main_mod.STATIC_DIR = static_dir
        main_mod.INDEX_PATH = os.path.join(static_dir, 'index.html')
        print(f"  [OK] STATIC_DIR = {static_dir}")

        # === 启动 ===
        print("=" * 50)
        print("  西瓜少年 · 小说校稿工具")
        print("  浏览器打开: http://localhost:8000")
        print("  按 Ctrl+C 停止")
        print("=" * 50)

        _restore_console()
        uvicorn.run(main_mod.app, host='127.0.0.1', port=8000, log_level='info')

    except Exception:
        traceback.print_exc(file=_CRASH_LOG if _CRASH_LOG else sys.stderr)
        if _CRASH_LOG:
            _CRASH_LOG.flush()
            os.fsync(_CRASH_LOG.fileno())
            print(f"\n启动失败，错误已写入: {_CRASH_LOG_PATH}")
            print("30 秒后窗口将自动关闭...")
            time.sleep(30)


if __name__ == '__main__':
    main()
