# AI 对话校稿助手 实施计划 (v1.0)

**核心目标**：在 Watermelon Edit 中增加一个可对话的 AI 校稿助手——流式文本对话，支持在正文中**选中整段或段内部分文字**发给助手，助手自动带上上下文（选中段前后各 100 字、章节、人物关系网、作者文风设定）给出**人性化的优化意见**。

**设计原则**：最大化复用项目现有设施（LiteLLM / 上下文注入 / 设置体系 / AntD）+ **Ant Design X（@ant-design/x）官方 AI 对话组件库**，只补最薄的缺口（SSE 转发、选区浮条、可调宽侧栏）。**不引入** WebSocket、向量库、新前端框架。

**用户已确认的决策**：
1. 对话面板 = **挤压式右侧栏**（非覆盖式 Drawer），阅读区被挤压，**支持手动拖拽调宽**
2. 前端对话 UI = **@ant-design/x**（`useXChat` / `Bubble.List` / `Sender` / `Conversations` / `ThoughtChain`）
3. 上下文范围 = **选中段前后各 100 字**（可配置）

---

## 一、系统整体架构

```
┌─────────────────────────── 前端 (React + AntD 5 + @ant-design/x) ────────────┐
│                                                                              │
│  正文阅读区 (ReviewReader)                     右侧挤压式可调宽栏 (AI 助手)     │
│  ┌──────────────────────────────┐  拖拽把手  ┌─────────────────────────────┐ │
│  │ 段落文本 (真实 DOM 文本节点)   │◄──────────►│ Conversations 会话列表      │ │
│  │   ├─ 整段：ParaHoverToolbar   │  (resize)  │ Bubble.List 流式气泡        │ │
│  │   │    └─ "💬 询问助手" 按钮    │            │   (streaming 打字机 +        │ │
│  │   └─ 部分文字：SelectionToolbar│            │    ThoughtChain 思考链)     │ │
│  │        └─ 选区浮条 (润色/提意见)│            │ Sender 输入 (loading/停止)  │ │
│  └──────────────┬───────────────┘            │ + 引用上下文 Chip + 模型选择  │ │
│                 │ ① getSelection() + data-para 定位段落      └──────┬────────┘ │
│                 │    ② 挂载上下文 (selected_text+idx+±100字)        │          │
└─────────────────┼───────────────────────────────────────────────────┼─────────┘
                  ▼                                                   ▼
┌─────────────────────────── 后端 (FastAPI + LiteLLM) ─────────────────────────┐
│                                                                              │
│  POST /api/projects/{id}/chat/stream  (SSE, StreamingResponse)               │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ app/core/chat.py                                                        │ │
│  │  1. build_chat_system_prompt(): 对话专用提示词 (可设置页编辑)             │ │
│  │     + 复用 build_proofread_system_prompt() 的上下文注入                   │ │
│  │       → 作者/文风/背景设定 + 人物关系网 (get_character_graph 至当前段)     │ │
│  │  2. build_chat_context(): 章节标题 + 选中文字 ±100 字窗口                 │ │
│  │     (跨相邻段落取字) + 最近 M 条历史消息                                  │ │
│  │  3. stream_chat(): async generator → yield {thinking|delta|done}         │ │
│  └──────────────────────────────┬─────────────────────────────────────────┘ │
│                                 ▼                                            │
│  app/core/llm.py: stream_llm()  (从 call_llm 提取的流式生成器, 复用全部       │
│  provider/key/thinking 逻辑) → litellm.acompletion(stream=True)              │
│                                 ▼                                            │
│  SQLite: chat_sessions / chat_messages (新表) + settings (system_prompt_chat │
│          + chat_context_chars)                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 二、现成方案映射表（"不从头堆" 的具体落点）

| 需求 | 现成方案 | 状态 |
|---|---|---|
| 多模型接入 + 流式生成 | **LiteLLM**（项目已在用 `call_llm`，流式已通） | ✅ 零新增 |
| 后端 SSE 流式转发 | **FastAPI `StreamingResponse`**（media_type=text/event-stream），或可选轻量库 `sse-starlette` | 原生支持，推荐不加依赖 |
| **对话 UI 全家桶** | **Ant Design X `@ant-design/x`**：`useXChat`（消息状态/请求生命周期/中止）、`Bubble.List`（自带 streaming 打字机）、`Sender`（输入+loading+停止按钮）、`Conversations`（多会话列表）、`ThoughtChain`（思考链折叠展示） | 🆕 唯一新依赖（官方 AntD 生态，React 18 兼容） |
| 前端流式对接 | `useXChat` + 自定义 `request` 函数内做 `fetch` + `ReadableStream` 解析我方 SSE | 组件库接管状态，流式解析 ~30 行 |
| 选区交互（选字→浮条→发送） | 浏览器原生 **Selection API** + `getSelection()`（Notion AI / Grammarly 同款交互） | 零依赖 |
| 挤压式可调宽侧栏 | flex 兄弟节点 + 6px 拖拽把手（`mousemove` 改 width，clamp 320~720px，~30 行）；与现有 chapters 侧栏/问题列表同布局模式 | 零依赖 |
| 上下文注入 | 复用 `build_proofread_system_prompt()`（作者设定 + 人物关系网注入已现成）+ 选中文字 ±100 字窗口 | ✅ 零新增 |
| 对话提示词可配置 | 复用 `settings` 表 + 现有"系统提示词"设置页模式 | ✅ 零新增 |
| 模型/密钥管理 | 复用 `config.py` + 设置页 | ✅ 零新增 |

**明确不引入**：WebSocket（SSE 单向足够）、向量库/RAG（上下文直接窗口注入）、其他聊天组件库（`@ant-design/x` 已覆盖）、新前端框架。

---

## 三、后端改动

### 1. [MODIFY] `backend/app/core/llm.py` — 提取流式生成器

把 `call_llm()` 中的流式循环重构为 `stream_llm()`（async generator），`call_llm()` 改为消费该生成器并聚合返回（**对现有校对调用零行为变化**，靠现有测试锁定）：

```python
async def stream_llm(prompt, model_id, timeout=120, tag="", system_prompt=None,
                     messages=None) -> AsyncIterator[dict]:
    """逐 chunk yield {"type": "content"|"thinking", "text": str, "usage": dict|None}。
    复用 call_llm 的全部 provider/key/thinking/LLM_CALL_LOG 逻辑。"""
```

要点：
- `messages` 参数：对话场景需要传入多轮 `[{role, content}]`，校对场景仍走 `prompt` 单条路径
- 流式中断：客户端断开时 `asyncio.CancelledError` 自动传播，LiteLLM 底层调用随之取消（需在 chat 端点 try/finally 里收尾）

### 2. [NEW] `backend/app/core/chat.py` — 对话上下文与提示词

- **`build_chat_system_prompt(project_id, upto_para_idx)`**：对话专用 system prompt（默认值存入 settings，见 §5），拼接：
  1. 角色设定：温和专业的资深小说编辑搭档，先肯定后建议，给 1~2 个可替换写法并解释理由，尊重作者文风，只评价选中内容不越界
  2. 复用 `build_proofread_system_prompt()` 的上下文注入段（作者/文风/背景 + 人物关系网 top 20）
- **`build_chat_context(project_id, para_idx, selected_text, para_end_idx=None)`**：**选中文字前后各 100 字**（字符窗口，可配置 `chat_context_chars`）：
  1. 定位：单段框选 → `selected_text` 在目标段落中 `indexOf`（选整段时即整段文本）；带 `paragraph_uuid` 时用 `get_paragraph_by_uuid` 精确锚定；**跨段框选**（`para_end_idx`）→ 先 `get_paragraphs_in_range` 拼接 `para_idx~para_end_idx` 段文本再 `indexOf`
  2. 扩展：从锚点向前/向后各取 `chat_context_chars` 字，跨越相邻段落取满
  3. 组装：章节标题 + `[前文]…选中文字…[后文]` 引用块 + 选中段段号（跨段则标注起止段号）
- **`stream_chat(...)`**：组装 system + context + 历史消息 → 调 `stream_llm()` → yield SSE 事件
- **`save_chat_message(session_id, role, content, context_json)`** 落库

### 3. [NEW] `backend/app/api/chat.py` — 路由（注册进 main.py，沿用现有风格）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/projects/{pid}/chat/sessions` | 会话列表（含消息数、更新时间） |
| POST | `/projects/{pid}/chat/sessions` | 新建会话，返回 id |
| DELETE | `/projects/{pid}/chat/sessions/{sid}` | 删除会话 |
| GET | `/projects/{pid}/chat/sessions/{sid}/messages` | 历史消息 |
| POST | `/projects/{pid}/chat/stream` | **SSE 流式对话**（核心） |

`POST /chat/stream` 请求体：

```json
{
  "session_id": "可选，不传则自动建会话",
  "model": "deepseek-v4-flash",
  "message": "这段的节奏有点拖，帮我看看怎么改",
  "context": {
    "selected_text": "……被选中的文字……",
    "paragraph_idx": 42,
    "paragraph_uuid": "a1b2c3",
    "paragraph_end_idx": null
  }
}
```

> `paragraph_end_idx` 仅跨段框选时传（选段范围终点）；后端据此取**选中文字前后各 100 字**（`chat_context_chars` 可配）作为窗口，跨相邻段落取满。前端不必计算偏移。

SSE 事件格式（与现有 LLM 调试面板的 thinking 支持对齐）：

```
data: {"type": "thinking", "text": "……"}   // 思考型模型可见，前端折叠展示
data: {"type": "delta", "text": "……"}
data: {"type": "done", "message_id": "m123", "usage": {"tokens": 123}}
data: {"type": "error", "message": "……"}
```

- 首条 assistant 消息后自动生成会话标题（取消息前 20 字）
- 不做 `_RUNNING` 全局锁（校对任务与对话可并发），但返回前把 LLM 调用写入 `llm_logs`/`LLM_CALL_LOG`，调试面板可直接看到对话调用

### 4. [MODIFY] `backend/app/core/database.py` — 新表

```sql
CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT DEFAULT '新对话',
    model TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (project_id) REFERENCES projects(id)
);
CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,              -- user | assistant
    content TEXT NOT NULL,
    context TEXT,                    -- JSON：selected_text / paragraph_idx / window
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
);
CREATE INDEX IF NOT EXISTS idx_chat_msgs_session ON chat_messages(session_id);
```

- schema_version 提升到 6，`_migrate_schema()` 中追加（与现有迁移风格一致）
- 新增 `create_chat_session / list_chat_sessions / delete_chat_session / insert_chat_message / list_chat_messages` 5 个 CRUD 函数

### 5. [MODIFY] 设置体系 — `system_prompt_chat` + `chat_context_chars`

- `_init_default_settings()` 增加：
  - `system_prompt_chat`：默认对话提示词（人性化校稿，正文见 §5 末）
  - `chat_context_chars`：上下文窗口字数，默认 `100`（对应"选中段上下 100 字"）
- `settings.py` 的 GET/PUT `/settings/prompts` 已按 key 存取，天然支持新增 key，仅需前端设置页加一个编辑区

---

## 四、前端改动

### 0. [MODIFY] `package.json` — 新增依赖

```bash
npm install @ant-design/x
```

- 官方 AntD 生态，构建于 antd v5 之上，与项目现有 `antd ^5.21` / `react ^18.3` 兼容
- 安装后核对导出（v2.x 起部分 hook 可能随 `@ant-design/x-sdk` 拆分，以实际包导出为准）：`useXChat / useXConversations / Bubble / Sender / Conversations / ThoughtChain`

### 1. [NEW] `frontend/src/components/ChatPanel/ChatProvider.js` — useXChat 自定义 provider

```js
// @ant-design/x 的 useXChat 接管消息状态/loading/abort；
// 流式对接用自定义 request 函数（约 30 行 fetch + ReadableStream 解析我方 SSE）：
const provider = new DefaultChatProvider({
  request: async (info, { onUpdate, messageInfo }) => {
    const resp = await fetch(`${BASE}/projects/${pid}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,  // 由 useXChat 的 abort 驱动
    })
    // 逐 data: 行解析 → thinking 事件喂 ThoughtChain / delta 事件调 onUpdate({content})
    return { content: full, role: 'assistant' }
  },
})
```

- **停止生成**：`Sender` 自带 `loading` + `onCancel` → `useXChat` 的 `abort` → `AbortController` → 后端 `CancelledError` 自动取消 LLM 调用（零手写）
- **打字机**：`Bubble` 的 `streaming` prop（流式期间 true，done 事件后 false），可配 `typing={{ effect: 'typing', step: 5, interval: 50 }}`
- **思考链**：`ThoughtChain` 展示 `thinking` 事件（思考型模型），与现有 LLM 监控面板的 thinking 支持对齐

### 2. [NEW] `frontend/src/components/ChatPanel/ChatPanel.jsx` — 挤压式对话侧栏

- **布局**：flex 兄弟节点排在阅读区右侧（与现有 chapters 侧栏/问题列表同模式），打开时**挤压阅读区**；左侧 6px 拖拽把手（`mousedown → mousemove` 改 width，`clamp(320, 720)`px，~30 行），松手释放
- **内部结构**（自上而下）：
  1. 会话列表条：`Conversations`（`useXConversations` 管理多会话，`creation` 新建按钮），可折叠成窄条
  2. 消息区：`Bubble.List`（user 右 / assistant 左，`autoScroll`；引用上下文用附注样式展示"选中文字 + 段号"）
  3. 输入区：`Sender`（Enter 发送 / Shift+Enter 换行，与正文编辑一致）+ 模型 `Select`（复用 `models` props）+ 引用上下文 Chip
- 顶部工具条：会话标题、删除会话、收起侧栏
- 交互联动：正文点"询问助手" → 展开侧栏并自动填入引用上下文

### 3. [NEW] `frontend/src/components/SelectionToolbar.jsx` — 框选浮条（核心交互）

**机制**（正文是 diff 高亮切分的多层 `<span>`，框选提取/定位需按此实现）：

| 步骤 | 实现 |
|---|---|
| 1. 拖拽框选 | 浏览器原生行为（跨 span / 跨段框选天然成立），零代码 |
| 2. 提取选中文本 | `window.getSelection().toString()` —— span 分段不影响取文 |
| 3. 定位段落 | `selection.anchorNode.parentElement.closest('[data-para]')` → 段落 uuid/idx（ParaRow 外层 div 已有 `data-para` 属性） |
| 4. 浮条定位 | `selection.getRangeAt(0).getBoundingClientRect()` → 浮条渲染在选区上方居中；滚动/缩放时 `scroll` 事件重定位 |
| 5. 排除编辑态 | anchorNode 祖先含 `textarea/input`（双击编辑中）→ 不触发浮条 |
| 6. 消失条件 | `selectionchange` 为空 / 点击浮条按钮 / 按下 Esc / 滚动超过阈值 → 浮条移除 |
| 7. 跨段框选 | 选区跨多段时：anchor 与 focus 各取 `closest('[data-para]')`，传 `start_idx ~ end_idx` 范围 + `selected_text`，后端按段拼接后锚定 |

**按钮**：**「✏️ 润色」** **「💡 提意见」** **「💬 自定义指令」**（点击后打开 ChatPanel，带上 selected_text + 段落 idx/uuid + 跨段范围）。
整段场景：现有 `ParaHoverToolbar` 上加一个 **「💬 询问助手」** 按钮（整段=全选该段文本），两处共用同一套发送逻辑，零冲突。

### 4. [MODIFY] 接线

- `ReviewReaderInner.jsx`：挂载 `SelectionToolbar`，透传 `onAskAssistant(context)` 回调
- `ProjectDetail.jsx`：新增 `chatOpen` state + 顶部工具栏加 **「💬 AI 助手」** 按钮（对称于右侧问题列表折叠按钮）；渲染 `ChatPanel`；从 `models` prop 给模型选择
- `services/api.js`：新增 `listChatSessions / createChatSession / deleteChatSession / listChatMessages / streamChat(fetch)` 5 个函数
- `Settings.jsx`：新增"对话助手提示词 + 上下文字数"编辑区（复用现有 prompts 的 GET/PUT）

---

## 五、默认对话提示词（人性化校稿核心）

```text
你是一位温和专业的资深中文小说编辑，正与作者并肩工作。

你的工作方式：
1. 先指出这段文字的亮点，再提改进建议——批评永远包裹在建设性意见里。
2. 针对【选中的文字】给出意见，不要越界修改未被选中的内容。
3. 每条建议说明"为什么"（节奏、语感、视角、信息密度等），并给出 1~2 个可替换的写法示例。
4. 尊重作者的文风与表达习惯，不把个人偏好强加给作者。
5. 若原文已足够好，请直说"这段很好，不需要改"，不要为了提建议而提建议。
6. 语气像一位懂小说的同行，而不是机器。
```

（用户可在设置页自由覆盖，与 `system_prompt_proofread` 同机制。）

---

## 六、实施步骤（分 6 阶段，每阶段可独立验证）

### 阶段 1：后端流式通道打通（核心验证点）
- [MODIFY] `llm.py` 提取 `stream_llm()`
- [NEW] `chat.py` + `chat.py` 路由：`POST /chat/stream`（先不带上下文/会话，纯流式回显）
- 验证：`curl -N -X POST .../chat/stream` 看到逐 token SSE；现有校对功能回归测试通过

### 阶段 2：会话与上下文
- [MODIFY] `database.py` 新表 + CRUD + schema_version 6
- [MODIFY] `chat.py`：历史消息、上下文组装、system_prompt_chat
- 验证：pytest 单测（上下文组装、消息落库）+ curl 带 context 验证注入效果

### 阶段 3：对话面板（@ant-design/x）
- [MODIFY] `package.json`：安装 `@ant-design/x`，核对导出（`useXChat` 等 hook 路径以实际版本为准）
- [NEW] `ChatProvider.js`（useXChat 自定义 request 接 SSE）+ `ChatPanel.jsx`（Conversations + Bubble.List + Sender + 拖拽调宽）
- [MODIFY] `api.js`、`ProjectDetail.jsx`（入口按钮 + 侧栏渲染）、`Settings.jsx`
- 验证：浏览器手动流式对话，打字机效果、停止生成、模型切换、历史会话恢复

### 阶段 4：选区发送（核心交互）
- [NEW] `SelectionToolbar.jsx`（部分文字）
- [MODIFY] `ParaHoverToolbar.jsx`（整段按钮）+ `ReviewReaderInner.jsx` 接线
- 验证：选中文字→浮条→助手正确引用"选中文字 ±100 字"，回答限定在选中内容；**跨段框选**（含 diff 高亮切分 span 的段落）→ 上下文锚定正确

### 阶段 5：打磨与收尾
- 流式中断/错误/重试、thinking 折叠展示、会话标题、空态文案
- `npm run build` + 全量回归（校对、导出、图谱不受影响）
- Tauri 打包验证（无新原生依赖，`@ant-design/x` 为纯前端包）

### 阶段 6：Tools & Skills 工具与技能（Function Calling）能力扩展
- [NEW] `backend/app/core/tools.py`：定义 OpenAI 兼容的 Function Schema 注册表（如 `search_character_info`, `replace_paragraph_text`, `get_plot_timeline`, `query_author_settings`）
- [MODIFY] `backend/app/core/chat.py` & `llm.py`：接入 LiteLLM `tools` 参数，拦截并路由 `tool_calls` 事件，自动执行工具函数并回传多轮 Agentic 结果
- [MODIFY] `frontend/src/components/ChatPanel/ChatPanel.jsx`：结合 `@ant-design/x` 的 `<ThoughtChain>` 展示工具链调用轨迹（如 `🔧 调用工具：查询角色智星... 选区修改完成 ✓`）
- 验证：单元测试 `test_chat_tools.py`（Tool 匹配与调度）+ 联调 AI 助手主动调工具替换正文

---

## 七、风险与对策

| 风险 | 对策 |
|---|---|
| `call_llm` 重构影响现有校对 | 提取生成器后 `call_llm` 保持原签名/行为，跑现有 pytest + 手动回归 |
| 流式中断悬挂 | SSE 端点 try/finally + CancelledError 传播，前端 `Sender` onCancel → abort |
| `@ant-design/x` 版本差异（v2 拆分 `@ant-design/x-sdk`、hook 导入路径变化） | 安装后先核对导出再动手；锁定版本号；核心逻辑（SSE 解析）与组件解耦，便于降级 |
| 上下文过长超模型上限 | 字符窗口 `chat_context_chars` 默认 100、历史消息截断（保留最近 20 条）、人物关系注入已有 top-20 上限 |
| 对话与校对并发打满额度 | 不加全局锁（校对仍用 `_RUNNING`），如遇限流由 LiteLLM 错误透出，前端提示重试 |
| 选区与现有点击/双击编辑冲突 | 选区浮条仅响应 `selectionchange` 且选区非空；`mouseup` 判定在现有 `onParaClick` 冒泡之后处理，不阻断 |
| 拖拽调宽与阅读器滚动/布局冲突 | 拖拽仅改 state width（clamp 320~720），触发 flex 重排；与 chapters 侧栏开关同布局层级 |

---

## 八、验证计划（Verification Plan）

1. **后端单测**（pytest）：
   - `stream_llm()` 生成器逐 chunk 产出、`call_llm` 聚合结果与重构前一致
   - `build_chat_context()` 窗口边界（首段/末段/选中越界）
   - 会话 CRUD + 消息落库
2. **SSE 冒烟**：`curl -N` 验证流式事件序列 `thinking → delta* → done`
3. **前端构建**：`npm run build` 通过，无 lint 报错
4. **端到端手动流程**：
   - 选中整段 → 询问助手 → 回答引用该段及前后 100 字
   - 选中部分文字 → 浮条 → 润色 → 建议聚焦选中内容
   - 跨段框选 → 助手引用整段范围 + 前后 100 字；框选含 AI 高亮标记（`[已删字]`/下划线 span）的段落不丢字
   - 流式打字机不卡顿、可中途停止、断网有错误提示
   - 关闭重开面板 → 历史会话与消息完整恢复
   - 拖拽调整侧栏宽度，阅读区随之挤压/还原，边界在 320~720px
   - 与校对任务并发执行不互相阻塞

---

## 九、工作量预估

- 后端：llm.py 重构（0.5d）+ chat.py + 路由（1d）+ 表与 CRUD（0.5d）+ 测试（0.5d）≈ **2.5 天**
- 前端：`@ant-design/x` 接入 + ChatPanel + 可调宽侧栏（1d）+ SelectionToolbar + 接线（1d）+ 设置页与打磨（0.5d）≈ **2.5 天**
- 合计 ≈ **5 人日**（唯一新依赖 `@ant-design/x`，其余全部复用现有设施）
