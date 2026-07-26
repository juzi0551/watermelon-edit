# Watermelon Edit — 小说与图书辅助校稿工具

一款面向小说作者与图书编辑的 AI 辅助校稿与轻排版工具。

项目集成了 **多大模型智能校对引擎** 与 **`python-docx` / `lxml` 文档处理模块**。支持自动检查错别字、语法、标点与格式问题，并在导出 Word 时尽可能保留原有排版结构与分页设置。

---

## 💡 核心功能

* 🤖 **多模型辅助校对**：聚合 DeepSeek、Moonshot (Kimi)、Google Gemini 等主流大模型，按 30 段滑动窗口分批处理，支持长文档断点续校。
* 📝 **交互式审校阅读器**：逐条对比原文与修改建议，支持自定义编辑建议、一键全部采纳以及即时编辑正文。
* 📄 **硬分页与章节管理**：自动识别大章节开页，区分“原文硬分页”、“章节开页”与“新增硬分页”，提供淡化分割线展示。
* 🎯 **段落快捷操作**：点击段落弹出微型浮条（编辑、硬分页、设章节、删除），自动跟随光标位置并进行卡片边界保护。
* 🔒 **项目锁定与防误删**：支持一键锁定项目，锁定状态下限制删除项目、删除段落与清理空行。
* 🧹 **空行清理与序号重排**：一键识别并清除原稿中的空白段落，自动从 0 开始重新连续编排段号 `idx`，并同步更新关联索引。
* 📤 **带修订导出**：导出带时间戳的 `.docx` 校稿版（如 `{项目名称}_校稿版_{YYYYMMDD_HHMMSS}.docx`），尽量减少对原文档样式的破坏。

---

## 🛠️ 技术栈

- **后端**：Python / FastAPI / SQLite / `python-docx` / `lxml` / LiteLLM
- **前端**：React / Ant Design 5 / Vite

---

## 📁 项目结构

```
├── backend/                        # FastAPI 后端
│   ├── app/
│   │   ├── main.py                 # FastAPI 入口，静态文件托管
│   │   ├── api/
│   │   │   ├── projects.py         # 项目 CRUD & 锁定 & 空行清理 API
│   │   │   ├── upload.py           # docx 上传与解析
│   │   │   ├── proofread.py        # 校对控制
│   │   │   ├── results.py          # 结果查询
│   │   │   ├── apply.py            # docx / lxml 节点修改与导出
│   │   │   ├── export.py           # 导出控制
│   │   │   └── settings.py         # 设置（API Key, Prompt）
│   │   ├── core/
│   │   │   ├── database.py         # SQLite 数据库与缓存
│   │   │   ├── document.py         # docx 解析与章节识别
│   │   │   ├── llm.py              # LiteLLM 调用封装
│   │   │   └── proofer.py          # 分段校对引擎
│   │   └── utils/
│   └── static/                     # 前端静态产物
├── frontend/                       # React + Ant Design 前端
│   ├── src/
│   │   ├── pages/
│   │   │   ├── ProjectList.jsx     # 项目列表
│   │   │   ├── ProjectDetail.jsx   # 项目详情与校对
│   │   │   └── Settings.jsx        # 设置页
│   │   ├── components/
│   │   │   └── ReviewReader.jsx    # 审校阅读器
│   │   └── services/
│   │       └── api.js              # API 调用封装
└── README.md
```

---

## 🚀 快速开始

### 本地开发

```bash
# 1. 后端
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 2. 前端（另开终端）
cd frontend
npm install
npm run dev
```

打开浏览器访问 `http://localhost:5173`。

---

## 📡 主要 API 概览

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/projects` | GET | 获取项目列表 |
| `/api/projects` | POST | 创建新项目 |
| `/api/projects/{id}` | GET | 查询项目详情 |
| `/api/projects/{id}/lock` | POST | 切换项目锁定状态 |
| `/api/projects/{id}/clean-empty-paragraphs` | POST | 清理空白段落并重排序号 |
| `/api/projects/{id}/upload` | POST | 上传 docx 文件 |
| `/api/projects/{id}/proofread` | POST | 开始/继续校对 |
| `/api/projects/{id}/results` | GET | 查询校对结果与章节 |
| `/api/projects/{id}/export` | POST | 导出校稿版 docx |

---

## 📄 许可证

MIT License
