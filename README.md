# 小说校稿工具

基于大模型的小说校稿工具，能够自动检查docx格式小说的错别字、语法、标点符号和格式一致性问题，并提供修改建议。

## 项目概述

本项目旨在开发一个Web应用，帮助作者和编辑校对小说文档。工具使用大语言模型（如DeepSeek、Kimi等）进行文本检查，并提供交互式的修改建议界面。

### 核心特点
- **智能检查**：使用大模型进行错别字、语法、标点、格式检查
- **多模型支持**：通过LiteLLM聚合SDK支持多种大模型
- **保留格式**：输出带格式的docx文件，保留原始排版
- **交互界面**：Web界面查看结果，支持一键修改

## 功能需求

### 1. 文本检查功能
- **错别字检查**：中英文错别字、同音字、形近字识别
- **语法检查**：句子语法错误、不通顺的表达
- **标点符号检查**：标点符号使用是否正确，特别是中文标点
- **格式一致性**：字体、字号、段落格式等是否统一

### 2. 输出要求
- **保留格式**：输出为带有格式的docx文件（保留原文档的排版样式）
- **在原文中标注**：直接在docx文件中添加批注或修订
- **可直接修改**：提供自动修改或手动修改选项
- **Web界面**：通过网页界面查看检查结果和修改建议

### 3. 用户交互
- **上传docx文件**：支持拖拽或点击上传
- **模型选择**：Web界面下拉菜单选择使用哪个大模型
- **结果查看**：按错误类型分类显示，支持筛选
- **修改操作**：支持一键修改或逐条确认
- **导出结果**：生成带修订标记的docx文件

## 技术需求

### 1. 技术栈
- **后端**：Python (FastAPI)
- **前端**：React + Ant Design（antd）
- **大模型调用**：LiteLLM Python SDK
- **文档处理**：python-docx
- **文本处理**：jieba (中文分词)

### 2. 大模型集成
- **支持模型**：DeepSeek、Kimi等国内常用大模型
- **切换方式**：Web界面下拉菜单
- **API管理**：用户配置多个服务的API key
- **调用策略**：综合检查（一次性检查所有问题）

### 3. 文档处理
- **分段策略**：按章节分段（避免超出token限制）
- **格式保留**：解析和生成docx时保留原始格式
- **位置追踪**：记录每个错误在原文中的精确位置

### 4. 性能要求
- **处理速度**：能够处理数十万字的小说文档
- **并发处理**：并行处理多个章节
- **错误处理**：优雅的错误处理和恢复机制

## 项目结构

```
novel-proofreader/
├── backend/                    # 后端服务
│   ├── app/
│   │   ├── main.py            # FastAPI主程序
│   │   ├── api/               # API路由
│   │   ├── core/              # 核心逻辑
│   │   │   ├── document.py    # 文档处理
│   │   │   ├── proofer.py     # 校对引擎
│   │   │   └── llm.py         # 大模型调用
│   │   ├── models/            # 数据模型
│   │   └── utils/             # 工具函数
│   ├── requirements.txt
│   └── config.py              # 配置文件
├── frontend/                  # 前端界面
│   ├── src/
│   │   ├── components/        # React组件
│   │   ├── pages/             # 页面
│   │   └── services/          # API调用
│   ├── package.json
│   └── vite.config.js
└── README.md                  # 项目文档
```

## API设计

### 核心API端点
```
POST   /api/upload            # 上传docx文件
GET    /api/documents/{id}    # 获取文档信息
POST   /api/proofread/{id}    # 执行校对
GET    /api/results/{id}      # 获取校对结果
POST   /api/apply/{id}        # 应用修改
GET    /api/export/{id}       # 导出docx文件
GET    /api/models            # 获取可用模型列表
```

### 数据模型
```python
# 文档模型
class Document:
    id: str
    filename: str
    upload_time: datetime
    status: str  # pending, processing, completed, error
    chapters: List[Chapter]

# 章节模型
class Chapter:
    id: str
    document_id: str
    title: str
    content: str
    order: int

# 校对结果模型
class ProofreadResult:
    id: str
    document_id: str
    model_used: str
    errors: List[Error]
    created_at: datetime

# 错误模型
class Error:
    id: str
    type: str  # typo, grammar, punctuation, format
    chapter_id: str
    paragraph_index: int
    original_text: str
    suggested_text: str
    severity: str  # high, medium, low
    description: str
```

## 大模型Prompt设计

### 综合检查Prompt
```python
prompt = f"""
你是一个专业的小说校对编辑。请检查以下文本中的错误：

文本内容：
{chapter_content}

请检查以下类型的错误：
1. 错别字（中英文）
2. 语法错误
3. 标点符号错误
4. 格式不一致问题

请以JSON格式返回结果：
{{
    "errors": [
        {{
            "type": "typo|grammar|punctuation|format",
            "paragraph_index": 0,
            "original_text": "原文内容",
            "suggested_text": "修改建议",
            "severity": "high|medium|low",
            "description": "错误描述"
        }}
    ]
}}

只返回JSON，不要其他内容。
"""
```

## 开发计划

### 阶段1：基础框架（2天）
- [ ] 搭建FastAPI后端
- [ ] 实现docx文件上传和解析
- [ ] 集成LiteLLM基础调用
- [ ] 创建React前端框架

### 阶段2：核心功能（4天）
- [ ] 设计并优化检查prompt
- [ ] 实现章节分段逻辑
- [ ] 开发结果解析和合并
- [ ] 实现并行处理机制

### 阶段3：Web界面（3天）
- [ ] 开发文件上传界面
- [ ] 实现模型选择下拉菜单
- [ ] 创建结果展示界面
- [ ] 添加修改建议交互

### 阶段4：文档生成（2天）
- [ ] 实现docx批注添加
- [ ] 开发修订版本生成
- [ ] 测试格式保留效果

### 阶段5：优化完善（2天）
- [ ] 性能优化和错误处理
- [ ] 用户体验改进
- [ ] 文档和测试

**总计：约13天**

## 配置需求

### 环境变量配置
```env
# 大模型API配置
DEEPSEEK_API_KEY=your_key_here
KIMI_API_KEY=your_key_here
OTHER_API_KEY=your_key_here

# 应用配置
APP_HOST=0.0.0.0
APP_PORT=8000
MAX_FILE_SIZE=50MB
DEFAULT_MODEL=deepseek-chat
```

### 模型配置
```python
# config.py
SUPPORTED_MODELS = {
    "deepseek": {
        "name": "DeepSeek Chat",
        "model_id": "deepseek-chat",
        "max_tokens": 4096,
        "cost_per_1k_tokens": 0.001
    },
    "kimi": {
        "name": "Kimi",
        "model_id": "moonshot-v1-8k",
        "max_tokens": 8000,
        "cost_per_1k_tokens": 0.012
    }
}
```

## API Key 获取地址

本工具在「设置」页按服务商配置 Key，Key 加密存储在本地 `backend/app/data/api_keys.json`，不会上传。各服务商申请地址如下：

| 服务商 | Key 申请地址 | 接口地址（base_url） | 说明 |
| --- | --- | --- | --- |
| **DeepSeek** | [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys) | `https://api.deepseek.com` | 环境变量 `DEEPSEEK_API_KEY` |
| **Kimi（Moonshot）** | [platform.kimi.com/console/api-keys](https://platform.kimi.com/console/api-keys) | `https://api.moonshot.cn/v1` | 环境变量 `MOONSHOT_API_KEY`；推荐模型 `kimi-k2.6` |
| **Kimi Code（编程）** | [platform.kimi.com/console/api-keys](https://platform.kimi.com/console/api-keys)（需 Kimi Code 权限） | `https://api.kimi.com/coding/v1` | 环境变量 `KIMI_CODE_API_KEY`；与 Moonshot Key **独立、不互通** |

> 注意：Kimi（Moonshot）与 Kimi Code 是两个独立服务，Key 不能混用。具体可用模型以各平台控制台为准。

## 待确认事项
1. 是否需要支持其他大模型？（如通义千问、文心一言等）
2. 对界面设计有什么具体要求？（颜色、布局等）
3. 是否需要处理特殊格式？（如诗歌、对话、引用等）
4. 是否需要支持多种语言的界面？（中英文切换）

## 技术约束

### 1. 数据隐私
- **接受API调用**：工具在本地运行，但文件内容会发送到大模型API服务器进行处理
- **不上传文件到第三方服务器**：文件处理在本地完成

### 2. 语言支持
- **中英文混合**：同时处理中文和英文文本
- **智能切换**：自动识别文本中的语言并应用相应的检查规则

### 3. 成本控制
- **平衡模式**：在质量和成本之间取得平衡
- **模型选择**：用户可以根据需求选择不同成本的大模型

## 部署说明

### 本地开发
```bash
# 后端
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload

# 前端（另开终端）
cd frontend
npm install
npm run dev
```

### 打包分发（给普通用户使用）
本项目通过 PyInstaller 打包成独立程序，用户**无需安装 Python 环境**，双击即用：

- **macOS**：在本机执行 PyInstaller，产出 `.app`
- **Windows**：通过 GitHub Actions 云端 Windows Runner 自动产出 `.exe`

打包后程序在本地起服务并自动打开浏览器，用户无感知。详细流程见 `PLAN.md` 阶段6。

> 注：不使用 Docker 部署。

## 许可证

MIT License