# Tauri 桌面打包 — 进度与问题记录

## 目标

将 FastAPI + React 应用打包为便携式 Windows 桌面应用（exe），通过 Tauri v2 作为壳，后端以 sidecar 方式运行。

- **后端**：Python / FastAPI + litellm，通过 PyInstaller 打包为 onefile exe
- **前端**：React / Vite / Ant Design，构建静态文件由后端直接托管
- **桌面壳**：Tauri v2 (Rust)，启动时 spawn 后端 sidecar，关闭时 kill

## 最终交付物

单一 zip 包 `西瓜审校-windows-portable`，包含：
- `watermelon-edit.exe` — Tauri 桌面应用
- `binaries/watermelon-server-x86_64-pc-windows-msvc.exe` — 后端 sidecar

## 构建流水线 (build.yml)

```
npm run build             → 前端 → backend/static/
pyinstaller --onefile     → 后端 exe → dist/watermelon-server.exe
拷贝到 src-tauri/binaries/ → watermelon-server-x86_64-pc-windows-msvc.exe
npx tauri build           → 编译 Rust → target/release/watermelon-edit.exe
打包 zip                   → 西瓜审校-windows-portable
```

### 关键配置

- `tauri.conf.json`: `bundle.active: false` 跳过 MSI/NSIS 安装包
- `main.rs`: `windows_subsystem = "windows"` 隐藏控制台窗口
- `lib.rs`: panic hook + crash.log + MessageBox 错误弹窗
- `build.yml`: `--collect-all litellm --collect-all tiktoken`

## 已解决问题

### 1. 后端启动后浏览器无响应

**现象**：后端 banner 显示，但 `localhost:8000` 所有路径（`/api/health` 等）均无响应。

**根因**：`litellm` 的顶层 import 导致模块加载超慢。在 PyInstaller 打包环境下，新版 litellm（post-1.91.3）的 pydantic 模型 schema 生成耗时 30 秒+，阻塞了 `uvicorn.run()` 之前的所有 import。

**解决**：锁 requirements.txt 版本。
- `litellm==1.91.3`（锁回已知可工作的版本）
- `pydantic>=2.10.0`（litellm 1.91.3 要求 pydantic >= 2.10.0，不能锁 2.9.0）

### 2. PyInstaller 缺少 python_multipart

**现象**：运行时 `ModuleNotFoundError: No module named 'python_multipart'`

**根因**：锁版本后依赖树变化，PyInstaller 自动扫描未检测到。

**解决**：在 `--hidden-import` 中显式添加。

### 3. 潜在缺少 - jinja2.ext / uvicorn

run.py 的模块锚点有 6 个 `import`，用于强制 PyInstaller 打包：
- `fastapi`、`starlette`、`pydantic`、`uvicorn`、`python_multipart`、`jinja2.ext`

现已全部添加对应 `--hidden-import` 标志。

### 4. Tauri exe 静默崩溃（无日志、无窗口）

**现象**：`watermelon-edit.exe` 点击后无任何反应，无窗口、无 crash.log。

**根因**：之前没有 panic hook，任何 Rust 层异常都会静默退出。

**解决**：在 `lib.rs` 的 `run()` 函数顶部设置全局 panic hook：
- 捕获所有 panic（包括 Tauri 初始化前）
- 写入 `crash.log`（exe 同目录）
- 弹出 Windows MessageBox 显示错误信息
- 调用默认 hook 保留原始行为

还添加了 sidecar 启动失败的错误处理（找不到 exe / 启动失败均有弹框 + crash.log 记录）。

### 5. requirements.txt 版本解绑导致 litellm 升级

**现象**：从 `==` 改为 `>=` 后，新构建拉取到新版 litellm（导入极慢）。

**解决**：全部锁回原有版本，仅 `pydantic` 放开最低版本要求（`>=2.10.0` 而非 `==2.9.0`）。

## 当前配置

### requirements.txt

```
fastapi==0.115.0
uvicorn==0.30.0
python-docx==1.1.2
litellm==1.91.3
pydantic>=2.10.0
python-multipart==0.0.9
jieba==0.42.1
python-dotenv==1.0.1
json-repair==0.30.0
```

### 已知风险

- **`--collect-all litellm`**：会使 PyInstaller 输出体积较大（litellm 本身 + openai/tiktoken/tokenizers 等依赖），目前可行。
- **首次 LLM 调用延迟**：litellm 的首次 import 仍然有 ~7s 延迟（从 LiteLLM warning 时间戳可见），但仅在用户第一次使用大模型功能时触发，不阻塞启动。
- **Windows 兼容性**：所有构建和测试仅在 Windows 上进行过，macOS/Linux 未验证。

## 后续

- [x] requirements.txt 锁版本
- [x] build.yml 补齐 hidden-import
- [x] lib.rs 添加 panic hook + crash.log + 错误弹框
- [ ] 构建并测试 `watermelon-edit.exe` 能否正常启动
- [ ] 验证后端 sidecar 通信是否正常
- [ ] 验证关闭窗口时后端进程正确退出
