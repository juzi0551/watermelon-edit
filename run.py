"""
西瓜少年 — PyInstaller 入口脚本
打包后自动处理路径问题，数据目录写到 exe 同级的 data/ 下。
"""
import os
import sys
import shutil


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


def main():
    base_dir = get_base_dir()
    user_data = ensure_user_data(base_dir)

    # === Patch 路径：让后端代码写数据到用户目录 ===

    # 1. database.py — DB_DIR / DB_PATH
    import app.core.database as db_mod
    db_mod.DB_DIR = user_data
    db_mod.DB_PATH = os.path.join(user_data, 'novel_proofreader.db')

    # 2. config.py — KEYS_DIR / KEYS_PATH（settings.py 从 config 导入这两个变量）
    import config as cfg_mod
    cfg_mod.KEYS_DIR = user_data
    cfg_mod.KEYS_PATH = os.path.join(user_data, 'api_keys.json')

    # 3. helpers.py — ensure_dirs 创建 upload 和 static 目录
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

    # 4. main.py — STATIC_DIR / INDEX_PATH（静态文件在 _MEIPASS 内，只读）
    import app.main as main_mod
    main_mod.STATIC_DIR = static_dir
    main_mod.INDEX_PATH = os.path.join(static_dir, 'index.html')

    # === 启动 ===
    import uvicorn
    print("=" * 50)
    print("  西瓜少年 · 小说校稿工具")
    print("  浏览器打开: http://localhost:8000")
    print("  按 Ctrl+C 停止")
    print("=" * 50)
    uvicorn.run(main_mod.app, host='127.0.0.1', port=8000, log_level='info')


if __name__ == '__main__':
    main()
