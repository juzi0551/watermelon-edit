# Watermelon Edit — 小说校稿工具

基于大模型的中文小说校对工具。上传 docx，自动检查错别字、语法、标点、格式问题，提供交互式审校界面，一键采纳/拒绝，导出带修订的 docx。

## 核心特点

- **多模型支持**：通过 LiteLLM 聚合 DeepSeek、Moonshot（Kimi）、Google Gemini 等多种大模型
- **分窗校对**：按段分批处理，大文档无压力，断点续校
- **交互审校**：逐条查看错误，原文对比修改建议，浮窗详情、键盘式操作
- **设置持久化**：API Key 加密存储，Prompt 模板可在界面中编辑
- **导出 docx**：保留原始排版，生成带修订标记的校稿版

## 项目结构

```
├── backend/                        # FastAPI 后端
│   ├── app/
│   │   ├── main.py                 # FastAPI 入口，静态文件托管
│   │   ├── api/
│   │   │   ├── projects.py         # 项目 CRUD
│   │   │   ├── upload.py           # docx 上传与解析
│   │   │   ├── proofread.py        # 校对控制
│   │   │   ├── results.py          # 结果查询
│   │   │   ├── apply.py            # 错误状态变更
│   │   │   ├── export.py           # 导出 docx
│   │   │   ├── models.py           # 可用模型列表
│   │   │   ├── settings.py         # 设置（API Key, Prompt）
│   │   │   └── debug.py            # LLM 调试接口
│   │   ├── core/
│   │   │   ├── database.py         # SQLite + 设置缓存
│   │   │   ├── document.py         # python-docx 解析/生成
│   │   │   ├── llm.py              # LiteLLM 调用封装
│   │   │   └── proofer.py          # 校对引擎（分段、调度、结果合并）
│   │   ├── models/                 # Pydantic 模型
│   │   └── utils/                  # 工具函数
│   ├── config.py                   # 模型配置、加密密钥
│   ├── requirements.txt
│   └── static/                     # 前端构建产物
├── frontend/                       # React + Ant Design 前端
│   ├── src/
│   │   ├── App.jsx                 # 路由、全局布局
│   │   ├── pages/
│   │   │   ├── ProjectList.jsx     # 项目列表/新建
│   │   │   ├── ProjectDetail.jsx   # 项目详情、校对审校
│   │   │   └── Settings.jsx        # 设置页
│   │   ├── components/
│   │   │   ├── ReviewReader.jsx    # 审校阅读器（核心）
│   │   │   ├── LLMDebug.jsx        # LLM 连接调试
│   │   │   └── ...                 # 其他辅助组件
│   │   ├── services/
│   │   │   └── api.js              # API 调用封装
│   │   └── design-tokens.js        # 主题配色/字号
│   ├── package.json
│   └── vite.config.js
├── PLAN.md                         # 总体开发计划
└── README.md
```

## 快速开始

### 本地开发

```bash
# 后端
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 前端（另开终端）
cd frontend
npm install
npm run dev
```

打开 `http://localhost:5173`。

### 配置文件

按服务商在「设置」页配置 API Key，Key 加密存储在本地 `backend/app/data/api_keys.json`。

也可通过环境变量直接配置：

```env
DEEPSEEK_API_KEY=sk-xxx
MOONSHOT_API_KEY=sk-xxx
GEMINI_API_KEY=xxx
```

## 使用流程

1. **新建项目** → 上传 `.docx` 文件，自动解析段落结构
2. **开始校对** → 选择模型和检查类型，按段分批执行
3. **审校修改** → 逐条确认错误：采纳（可编辑建议文本）/拒绝
4. **导出结果** → 生成带修订标记的 `.docx` 校稿版

## API 概览

| 端点 | 说明 |
|---|---|
| `GET /api/projects` | 项目列表 |
| `POST /api/projects` | 新建项目 |
| `GET /api/projects/{id}` | 项目详情（含状态/进度） |
| `POST /api/projects/{id}/upload` | 上传 docx |
| `POST /api/projects/{id}/proofread` | 开始校对 |
| `GET /api/projects/{id}/results` | 获取校对结果 |
| `POST /api/projects/{id}/errors/{eid}/status` | 设置错误状态 |
| `POST /api/projects/{id}/accept-all` | 一键全部采纳 |
| `GET /api/projects/{id}/export` | 导出校稿版 docx |
| `GET /api/models` | 可用模型列表 |
| `GET /api/settings/prompts` | 获取 Prompt 模板 |
| `PUT /api/settings/prompts` | 更新 Prompt 模板 |
| `GET /api/settings/api-keys` | 获取 API Key 配置 |
| `PUT /api/settings/api-keys` | 更新 API Key |

## 数据模型

```
Project
├── id, name, status, created_at
├── paragraphs[]          # 段落列表
├── errors[]              # 校对错误
├── proofread_upto        # 已校对到第几段
└── last_error            # 上次错误信息

Error
├── id, project_id
├── paragraph_index       # 段落序号
├── original_text         # 原文
├── suggested_text        # 建议
├── type                  # typo|grammar|punctuation|format
├── severity              # high|medium|low
├── description           # 错误说明
└── user_status           # pending|accepted|rejected
```

## 支持的模型

| 服务商 | 模型 ID | 环境变量 |
|---|---|---|
| DeepSeek | `deepseek-chat`, `deepseek-v4-flash` | `DEEPSEEK_API_KEY` |
| Moonshot（Kimi） | `moonshot-v1-8k` 等 | `MOONSHOT_API_KEY` |
| Google Gemini | `gemini-3.5-flash` 等 | `GEMINI_API_KEY` |

模型列表由 `backend/config.py` 中的 `PROVIDERS` 配置，前端自动加载。

## 技术栈

- **后端**：Python / FastAPI / LiteLLM / SQLite / python-docx
- **前端**：React / Ant Design 5 / Vite
- **协议**：LiteLLM 聚合调用，响应格式强制 `json_object`
- **安全**：API Key 使用 `cryptography.fernet` 加密存储

## 许可证

MIT License
