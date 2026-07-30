# HanLP 术语一致性、人物动态关系图谱与深浅模式自适应 实施计划

基于 HanLP 离线 NLP 引擎与 LLM 语义分析，构建**特定术语一致性校验、人物动态演进图谱、基于作者背景的润色优化建议**，以及**深浅主题系统级自动适配**。

---

## 阶段划分与架构设计 (Architecture & Pipelines)

```
                            ┌──► HanLP (离线 NLP 引擎) ──► 1. 全书特定术语抽取、专有名词与异形词一致性校验
输入小说文档 (.docx) ───────┼──► LLM (DeepSeek / Gemini) ──► 2. 人物及关系动态演进图谱 (Character Arc)
                            │                              3. 基于作者/故事背景的写作润色建议 (Style Polish)
                            └──► Ant Design Design Tokens ─► 4. 界面深浅模式系统级自动适配 (Dark/Light Theme)
```

---

## User Review Required

> [!IMPORTANT]
> 1. **HanLP 离线轻量化引擎与分词存储策略**：HanLP 离线分析引擎模块引入 backend，无 Token 消费。全量分词为内存流式计算（不将数万 Token 序列落库 SQLite），仅将分析计算得出的专有名词/规范词写入 `glossary_terms` 表、将一致性冲突/标点错误写入 `errors` 表。
> 2. **深浅模式自动适配（Dark / Light Theme Auto-Adaptation）**：使用 `antd` 的 `ConfigProvider` 配合 `theme.darkAlgorithm` / `theme.defaultAlgorithm`，自动响应系统 `prefers-color-scheme: dark`，并在顶部导航栏提供手动切换控制（`跟随系统` / `☀️ 浅色` / `🌙 深色`）。
> 3. **第五种问题类型 `style` (润色建议)**：在校对界面中，除了原本的“错别字、语法、标点、格式”外，新增 **“润色建议 (style)”** 分类展示。

---

## Open Questions

> [!NOTE]
> 1. **深浅模式切换偏好**：默认跟随操作系统偏好（`system`），用户也可在头部导航栏手动强制指定（存储在 localStorage），是否符合预期？

---

## Proposed Changes

### 后端核心引擎与数据库 (Backend Engine & Database)

#### [MODIFY] [database.py](file:///Users/zhonglei/Desktop/Project/%E8%A5%BF%E7%93%9C%E5%B0%91%E5%B9%B4/backend/app/core/database.py)
* `projects` 表新增 `author_name`（作者）、`author_intro`（作者介绍/文风）、`background_setting`（世界观背景）、`theme_mode`（主题偏好 `'system'|'light'|'dark'`）。
* 新增 `characters` 表：`id, project_id, name, aliases, role, first_appear_idx, description`。
* 新增 `character_relationships` 表：`id, project_id, from_char_id, to_char_id, relation_type, description, paragraph_idx, created_at`（记录演进发生段号）。
* 新增 `glossary_terms` 表：`id, project_id, term, category, std_replacement` 存储项目专属与国家规范异形词库。

#### [NEW] [nlp_engine.py](file:///Users/zhonglei/Desktop/Project/%E8%A5%BF%E7%93%9C%E5%B0%91%E5%B9%B4/backend/app/core/nlp_engine.py)
* 集成 HanLP / 国家推荐异形词表 + 拼音形近词检测：
  - `scan_term_consistency(document_id: str)`：扫描全书提取异形词混用与专有名词拼写不一致。
  - `scan_gbt15834_punctuation(document_id: str)`：离线正则表达式检查中英文标点混用与未闭合符号。

#### [MODIFY] [proofer.py](file:///Users/zhonglei/Desktop/Project/%E8%A5%BF%E7%93%9C%E5%B0%91%E5%B9%B4/backend/app/core/proofer.py)
* 扩充 LLM Prompt：加入 `style`（润色与风格提示）的 JSON schema，并在 System Context 中注入作者文风、世界观背景和即时人物关系图谱。
* 增量提取 LLM 输出中的 `character_updates` 与 `relationship_events`，自动写入数据库时间轴。

#### [MODIFY] [projects.py](file:///Users/zhonglei/Desktop/Project/%E8%A5%BF%E7%93%9C%E5%B0%91%E5%B9%B4/backend/app/api/projects.py)
* 新增作者与背景更新接口 `PUT /projects/{id}/profile`。
* 新增人物关系查询与演进接口 `GET /projects/{id}/character-graph`。
* 新增离线术语/标点一键扫描接口 `POST /projects/{id}/scan-terms`。

---

### 前端 UI 与主题自适应 (Frontend UI & Themes)

#### [MODIFY] [App.jsx](file:///Users/zhonglei/Desktop/Project/%E8%A5%BF%E7%93%9C%E5%B0%91%E5%B9%B4/frontend/src/App.jsx)
* 集成 Ant Design `ConfigProvider` 主题适配器：
  - 监听 `window.matchMedia('(prefers-color-scheme: dark)')` 系统偏好；
  - 根据 `themeMode` 动态应用 `theme.darkAlgorithm` 或 `theme.defaultAlgorithm`；
  - 在导航栏顶部增加 **`☀️ 浅色 / 🌙 深色 / 💻 跟随系统`** 切换控件。

#### [MODIFY] [design-tokens.js](file:///Users/zhonglei/Desktop/Project/%E8%A5%BF%E7%93%9C%E5%B0%91%E5%B9%B4/frontend/src/design-tokens.js)
* 适配深浅双模式 Design Tokens，采用 CSS 变量（`var(--bg-reader)`、`var(--text-primary)`）透传，确保阅读器背景、莫兰迪高亮与浮条在深色模式下完美适应。

#### [NEW] [CharacterGraph.jsx](file:///Users/zhonglei/Desktop/Project/%E8%A5%BF%E7%93%9C%E5%B0%91%E5%B9%B4/frontend/src/components/CharacterGraph.jsx)
* 人物关系演进网状图组件（结合时间轴 Slider，可滑动查看不同章节处的人物关系变化）。

#### [MODIFY] [ProjectDetail.jsx](file:///Users/zhonglei/Desktop/Project/%E8%A5%BF%E7%93%9C%E5%B0%91%E5%B9%B4/frontend/src/pages/ProjectDetail.jsx) & [ReviewReader.jsx](file:///Users/zhonglei/Desktop/Project/%E8%A5%BF%E7%93%9C%E5%B0%91%E5%B9%B4/frontend/src/components/ReviewReader.jsx)
* 增加“作者介绍与故事设定”编辑侧边栏。
* 审校阅读器增加“润色建议 (style)”分类页签与“术语一致性”高亮。

---

## Verification Plan

### Automated Tests
1. **Python 代码与语法编译**：
   - 执行 `python3 -m py_compile` 验证全套 Python 引擎无语法错误。
2. **HanLP & 异形词引擎单元测试**：
   - 编写 `test_nlp_engine.py` 验证异形词混用扫描与形近字检出率。
3. **前端打包构建**：
   - 执行 `npm run build`，确保 Vite 0 错误编译并打包支持深浅模式。

### Manual Verification
1. **深浅模式自动适配验证**：在 macOS 系统偏好中切换“深色/浅色”，验证网页 0 刷新秒级自适应，无白边与文字遮挡。
2. **人物关系演进验证**：校对长段落后打开“人物关系图谱”，拖动时间轴检查特定段落的人物关系变化。
3. **特定术语与润色建议验证**：验证全书“唯一”与“惟一”一键统一，验证 `style` 润色建议正常高亮。
