"""
西瓜少年 — PyInstaller 入口脚本
打包后自动处理路径问题，数据目录写到 exe 同级的 data/ 下。
"""
import os
import sys
import shutil

# PyInstaller 静态依赖锚点：确保以下包被自动追踪打包
import fastapi  # noqa: F401
import starlette  # noqa: F401
import pydantic  # noqa: F401
import uvicorn  # noqa: F401
import python_multipart  # noqa: F401
import jinja2.ext  # noqa: F401


def get_base_dir():
    """获取基础目录：打包后用 exe 所在目录，开发时用项目根目录。"""
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def ensure_user_data(base_dir):
    """确保用户数据目录存在，首次运行时从打包资源复制初始数据。"""
    user_data = os.path.join(base_dir, 'data')
    os.makedirs(user_data, exist_ok=True)
    os.makedirs(os.path.join(base_dir, 'uploads'), exist_ok=True)

    # 数据库：如果用户目录没有，从打包资源复制
    db_dst = os.path.join(user_data, 'novel_proofreader.db')
    if not os.path.exists(db_dst):
        if getattr(sys, 'frozen', False):
            db_src = os.path.join(sys._MEIPASS, 'backend', 'app', 'data', 'novel_proofreader.db')
            if os.path.exists(db_src):
                shutil.copy2(db_src, db_dst)

    # API Keys：如果用户目录没有，创建空文件
    keys_dst = os.path.join(user_data, 'api_keys.json')
    if not os.path.exists(keys_dst):
        with open(keys_dst, 'w', encoding='utf-8') as f:
            f.write('{}')

    return user_data


LOG_FILE = None


def setup_logging(base_dir):
    """将 stdout/stderr 同时重定向到日志文件，以便打包后崩溃时能看到原因。"""
    global LOG_FILE
    log_path = os.path.join(base_dir, 'crash.log')
    LOG_FILE = open(log_path, 'w', encoding='utf-8')
    sys.stdout = LOG_FILE
    sys.stderr = LOG_FILE
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] 西瓜少年启动中...")
    return log_path


def main():
    base_dir = get_base_dir()
    log_path = setup_logging(base_dir)

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

        # === Patch 路径：让后端代码写数据到用户目录 ===

        # 1. database.py — DB_DIR / DB_PATH
        import app.core.database as db_mod
        db_mod.DB_DIR = user_data
        db_mod.DB_PATH = os.path.join(user_data, 'novel_proofreader.db')
        print("  [OK] database patched")

        # 2. config.py — KEYS_DIR / KEYS_PATH
        import config as cfg_mod
        cfg_mod.KEYS_DIR = user_data
        cfg_mod.KEYS_PATH = os.path.join(user_data, 'api_keys.json')
        print("  [OK] config patched")

        # 3. helpers.py — ensure_dirs
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

        # 4. main.py — STATIC_DIR / INDEX_PATH
        import app.main as main_mod
        main_mod.STATIC_DIR = static_dir
        main_mod.INDEX_PATH = os.path.join(static_dir, 'index.html')
        print(f"  [OK] STATIC_DIR = {static_dir}")
        print(f"  [OK] INDEX_PATH = {main_mod.INDEX_PATH}")

        # === 启动 ===
        import uvicorn
        print("=" * 50)
        print("  西瓜少年 · 小说校稿工具")
        print("  浏览器打开: http://localhost:8000")
        print("  按 Ctrl+C 停止")
        print("=" * 50)

        # 恢复 stdout/stderr 让 uvicorn 打印到控制台
        if LOG_FILE:
            sys.stdout.flush()
            sys.stderr.flush()
            saved_out = sys.__stdout__
            saved_err = sys.__stderr__
            sys.stdout = saved_out if saved_out else LOG_FILE
            sys.stderr = saved_err if saved_err else LOG_FILE

        uvicorn.run(main_mod.app, host='127.0.0.1', port=8000, log_level='info')

    except Exception as e:
        import traceback
        print(f"[FATAL] 启动失败: {e}", file=LOG_FILE if LOG_FILE else sys.stderr)
        traceback.print_exc(file=LOG_FILE if LOG_FILE else sys.stderr)
        if LOG_FILE:
            LOG_FILE.flush()
            os.fsync(LOG_FILE.fileno())
        # 暂停 30 秒，让用户有机会看到错误信息（双击 exe 时窗口不会立刻消失）
        import time
        print(f"\n启动失败，错误已写入: {log_path}", file=LOG_FILE if LOG_FILE else sys.stderr)
        print("30 秒后窗口将自动关闭...", file=LOG_FILE if LOG_FILE else sys.stderr)
        time.sleep(30)


if __name__ == '__main__':
    from datetime import datetime
    main()
