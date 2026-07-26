# Watermelon Edit — 出版级中文小说与图书智能校稿排版系统

一款面向**出版公司、图书编辑与网络文学作者**的工业级中文小说校稿与排版系统。

系统集成了 **多大模型智能校对引擎** 与 **`lxml` 底层 Word OpenXML 无损排版引擎**。不仅能自动精准识别错别字、语法、标点与格式问题，更能做到 100% 保留原 Word 文件的字体、字号、段间距与排版样式，导出符合专业出版社标准的校稿版文档。

---

## 🌟 核心宣传卖点与商业优势

* 🏆 **出版级 100% 无损排版引擎**：基于 `lxml` 底层 DOM 节点精准控制，直接注入 OpenXML 标准属性。**不改动原 Word 文档的字体、字号、段间距与 Linked Style 样式链**，彻底告别导出后样式错乱与字体误变问题。
* 📖 **硬分页与章节开页规范体系**：自动识别大章节开页，独创硬分页三分类标记（`📄 原文硬分页` / `📖 章节开页` / `✂️ 新增硬分页`），搭配 1px 极简淡化分割线，视觉清爽无干扰。
* ⚡ **Google Docs & Notion 混流极速交互**：
  * **双阶段落聚焦高亮**：Hover 呈现莫兰迪灰悬浮反馈，点击呈现天蓝主焦状态（带 4px 主视觉边条）。
  * **费茨法则【✏️ 编辑】零距离指针对齐**：点击段落瞬间，最高频的 `✏️ 编辑` 按钮直接在鼠标指针尖端浮现（移动距离 0~2px）。
  * **全边界安全锁定 Guard**：应用卡片边界约束公式，100% 保证浮条不溢出左右边界、不被顶部 Header 切割。
  * **零误触 3 重隐藏**：支持再次点击段落（Toggle）、点击正文空白处（Click-outside）与按 `Esc` 键快捷收起浮条。
* 🔒 **出版数据安全防误删锁**：前端与后端（SQLite/API）双重安全锁守卫，项目锁定状态下严禁误删除项目、段落与清理空行，按钮一键安全切换（`未锁定` / `已锁定 🔒`）。
* 🧹 **一键物理空行清洗与自动重排序号**：一键识别并清除原稿中所有无意义的垃圾空回车，自动**从 0 开始重新连续编排物理段号 `idx`**，并全表原子级联动更新章节与错误索引，确保导出无多余空行。

---

## 🛠️ 四大功能体系

### 1. 大模型智能校对引擎
- **多模型聚合**：原生支持 DeepSeek-V4、Moonshot (Kimi)、Google Gemini 等主流大模型。
- **30 段滑动窗口切片**：大文档分批异步调度处理，支持断点续校，大体积长篇小说无压力。
- **自定义 Prompt 模板**：支持在界面中编辑提示词并配置加密 API Key。

### 2. 交互式审校阅读器
- **四类问题分类展示**：错别字（Typo）、语法问题（Grammar）、标点符号（Punctuation）、格式问题（Format）。
- **逐条/一键采纳**：对比原文与建议修改，支持直接编辑修改建议或一键全部采纳。
- **即时编辑与段落管理**：双击或点击弹条直接编辑正文文本。

### 3. 出版规范排版与分页
- **章节层级识别**：自动抽取主标题（章/卷）与副标题（节）目录树。
- **开页规范**：1 级大章节自动另起新页，支持编辑手动插入/移除硬分页。

### 4. 无损二次导出
- **时间戳安全导出**：生成 `{项目名称}_校稿版_{YYYYMMDD_HHMMSS}.docx`。
- **lxml DOM 节点物理同步**：若清理了空行，导出时物理抹除底层 XML 空段落节点，与数据库 1:1 绝对重合。

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
│   │   │   ├── apply.py            # lxml DOM 节点注入与无损导出
│   │   │   ├── export.py           # 导出控制
│   │   │   ├── models.py           # 可用模型列表
│   │   │   └── settings.py         # 设置（API Key, Prompt）
│   │   ├── core/
│   │   │   ├── database.py         # SQLite + 表映射 + 锁定与重排逻辑
│   │   │   ├── document.py         # python-docx / OpenXML 解析
│   │   │   ├── llm.py              # LiteLLM 调用封装
│   │   │   └── proofer.py          # 校对引擎（分段、调度、结果合并）
│   │   └── utils/                  # 工具函数
│   └── static/                     # 前端构建产物
├── frontend/                       # React + Ant Design 前端
│   ├── src/
│   │   ├── pages/
│   │   │   ├── ProjectList.jsx     # 项目列表与快捷锁
│   │   │   ├── ProjectDetail.jsx   # 项目详情、开页控制与空行清理
│   │   │   └── Settings.jsx        # 设置页
│   │   ├── components/
│   │   │   ├── ReviewReader.jsx    # 审校阅读器（Google Docs/Notion 混流交互）
│   │   │   └── ...
│   │   └── services/
│   │       └── api.js              # API 接口集成
├── PLAN.md                         # 开发计划
└── README.md
```

---

## 🚀 快速开始

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

访问地址：`http://localhost:5173`

---

## 📡 主要 API 概览

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/projects` | GET | 项目列表 |
| `/api/projects` | POST | 新建项目 |
| `/api/projects/{id}` | GET | 项目详情 |
| `/api/projects/{id}/lock` | POST | 切换项目锁定状态 |
| `/api/projects/{id}/clean-empty-paragraphs` | POST | 一键物理清理空行并重排序号 |
| `/api/projects/{id}/upload` | POST | 上传 docx 文件 |
| `/api/projects/{id}/proofread` | POST | 开始分批校对 |
| `/api/projects/{id}/results` | GET | 获取校对结果与章节目录 |
| `/api/projects/{id}/export` | POST | 无损导出校稿版 docx |

---

## 📄 许可证

MIT License
