# 解析与校对逻辑设计（Implementation Plan）

> 状态：待评审。已确认方向：W=30、章节识别与校对合成一步、逐步进行、原始段落存储为锚点；**章节识别全交给 LLM（含主副标题，去掉正则）**；**进度/续传以「段落」为单位（窗口不外露）**；支持跨重启续传与「继续/校整章/全量」三种重校模式；**采纳增量写 `revised_text`、导出即 apply（不新建文档）**；**校稿可选问题类型（错别字/语法/标点/格式）**。

> 关键约束：源文档大概率**无格式**（无 Word 标题样式），章节只能靠 LLM 理解；**一次校对（一个窗口）可能识别出多个章节边界，也可能一个都没有**；标题有**主副层级**（卷/部/章/节），须由模型识别而非正则。

## 背景与约束

- 输入：`.docx`，段落可能完全没有样式，无法靠 Heading 样式切章。
- 章节识别**完全交给 LLM**：靠模型理解主副标题（如「第一卷 龙蛇起陆 → 第一章 寒门子弟 → 第一节 …」，及无「第X章」前缀的创意标题）。**不使用正则预识别**（正则认不出层级与创意标题，是老套方案）。
- 跨重启续传：所有状态都在 SQLite，关掉再开即可知「校到哪段」。
- **多/无章节**：一个 30 段窗口通常 0 个边界（章内正文，正常）；也可能含 2+ 边界（短章或两章交界）。章节地图由「跨窗口收集所有标题段（含层级），按序号排序构建层级」得到——单窗口 0 边界 ≠ 「这是一章」。

## 设计原则

1. **锚点用段落序号，不用原文整串**：喂给模型的段落带显式序号，要求模型回引 `paragraph_index`；`original_text` 仅作校验。apply 按序号定位，不再依赖脆弱的整串精确匹配。
2. **失败显性化**：模型调用挂了 ≠ 这章没错误，两者必须可区分。
3. **切分确定性、可重跑**：段落是真相源；章节/错误从它派生，重新校对 = 对当前文本重跑，锚点不漂。
4. **章节识别与校对合成一步、逐步进行**：一次 LLM 调用同时返回 `errors` 与 `structure`（含**层级**的章节信号），章节地图随窗口推进累积长出（含主副标题）。
5. **窗口是内部批处理，不进用户模型**：W=30 只是控制 LLM 上下文长度的批量单位。**进度、续传、UI 一律以「段落」为单位**，用户永远看到「第 N / M 段」，从不看到「窗」。
6. **采纳增量、导出即 apply**：点击采纳 → 写 `revised_text`；导出修订稿 = 用 `revised_text ?? text` 拼 docx。无新文档、无版本膨胀。

## 数据库 Schema 变更

### 新增 `paragraphs`（原始段落存储，唯一真相源）

```sql
CREATE TABLE IF NOT EXISTS paragraphs (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,      -- 指向 documents(id)（该小说）
    idx INTEGER NOT NULL,            -- 该 document 内绝对段落序号
    text TEXT NOT NULL,
    revised_text TEXT,               -- 采纳编辑后的当前文本；NULL = 未改（= text）
    style_name TEXT,                 -- Word 样式（无格式文档通常为空）
    char_count INTEGER,
    UNIQUE (document_id, idx),
    FOREIGN KEY (document_id) REFERENCES documents(id)
);
```

上传时 docx → 段落列表（保序、留原文与样式）→ 存 `paragraphs`。**不做任何切分，也不做任何正则标题识别**。

### `chapters` 改造为「派生层级结构」（不再存正文）

```sql
CREATE TABLE IF NOT EXISTS chapters (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    title TEXT,
    title_paragraph_idx INTEGER,       -- 哪一“段”是标题（指向 paragraphs.idx）
    level INTEGER NOT NULL DEFAULT 1,  -- 1=主标题(卷/章)  2=副标题(节/小节)
    parent_idx INTEGER,                -- 主标题对应 paragraphs.idx（副标题挂到最近的前一个主标题）
    start_idx INTEGER NOT NULL,         -- 章节覆盖 [start, end)
    end_idx INTEGER NOT NULL,
    sort_order INTEGER NOT NULL,
    detected_by TEXT DEFAULT 'llm',    -- 'llm' | 'manual'
    confidence REAL DEFAULT 1.0,
    FOREIGN KEY (document_id) REFERENCES documents(id)
);
```

章节正文永远从 `paragraphs` 区间取；区间随窗口推进合并/扩展。层级由 `level` + 按 `idx` 排序重建（某 level-2 标题归属其之前最近的 level-1 标题）。

### `documents`（小说本体，一次上传 = 一个）新增两列

```sql
ALTER TABLE documents ADD COLUMN proofread_upto INTEGER NOT NULL DEFAULT 0;
-- 已连续校对到的最高绝对段落 idx（段落级续传游标，跨重启持久）

ALTER TABLE documents ADD COLUMN proofread_types TEXT NOT NULL
    DEFAULT '["typo","grammar","punctuation","format"]';
-- 本次校稿要检查的问题类型（JSON 数组）；继续/校整章继承，全量可重选
```

> `documents` = 这本小说，全程唯一。**不再因「应用」新建 document**。

### `proofread_results`（内部窗口记录，不外露）

```sql
CREATE TABLE IF NOT EXISTS proofread_results (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    window_start INTEGER NOT NULL,      -- 内部批处理起点段号
    window_end INTEGER NOT NULL,        -- 内部批处理终点段号
    model TEXT,
    status TEXT NOT NULL,               -- 'done' | 'failed' | 'partial'
    created_at TEXT NOT NULL,
    FOREIGN KEY (document_id) REFERENCES documents(id)
);
```

> 这是**内部**故障隔离/重试用，**绝不**出现在进度或 UI 文案里。用户看到的只有「段落」。

### `errors` 锚点统一为 `paragraph_index`

`errors` 已有 `paragraph_index` + `chapter_id` + `user_status`(pending/accepted/rejected)。改为：**以 `paragraph_index`（绝对段号）为主锚点**；apply 按 `paragraph_index` 定位段落；`user_status` 记录采纳/忽略。解析时若 `original_text` 在当前 `revised_text ?? text` 中已找不到（被前次采纳改掉）→ 该 error 标 `conflict` 并提示，不静默崩。

### 其余表不变
`projects` 保持现状。

## 处理流水线

### 1. 入库（ingest）
docx → `doc.paragraphs`（保序、留 text + style）→ `create_document`（一次上传一个 document，初始 `proofread_upto=0`、`proofread_types=全类型`）→ `insert_paragraphs(doc_id, [(idx, text, style), ...])`。**无前置切分、无正则标题识别、不动 `revised_text`**。

### 2. 校对窗口（W=30 段/次调用，合成章节识别，含层级 + 类型选择）—— 无正则预识别
- 窗口 = `paragraphs` 的连续 30 段（内部批处理；用户无感）。
- 读取 `documents.proofread_types`（选中类型）作为本次检查范围。
- 每个窗口喂**带绝对段号的段落**，并要求**只查选中类型**：
  ```
  段落 12: 寒门子弟……
  段落 13: ……
  ```
- **一次调用同时返回两样**：
  ```json
  {
    "errors": [
      {"paragraph_index": 12, "type": "typo|grammar|punctuation|format",
       "original_text": "…", "suggested_text": "…", "severity": "high|medium|low", "description": "…"}
    ],
    "structure": [
      {"paragraph_index": 12, "is_heading": true, "level": 1,
       "heading_title": "寒门子弟", "heading_no": "第一章"}
    ]
  }
  ```
- `structure` 的三种情况（关键）：
  - **0 个**：窗口落在章内正文，正常；不表示「这是一章」。
  - **1 个**：该段是标题（level 1 或 2）。
  - **多个**：窗口含 2+ 边界（短章或两章交界），全部收集，各自带 `level`。
- 容错解析（见下，**并丢弃不在 `proofread_types` 内的 `type`**）后落库：按窗口覆盖的段落区间删旧 `errors`，按 `paragraph_index` 写新的；`structure` 里 `is_heading` 的段 → upsert `chapters`（带 `level`/`parent_idx`，区间随窗口推进合并）。
- 窗口成功后更新 `documents.proofread_upto`（见「段落级进度」）。

### 3. 章节层级地图累积（progressive，全 LLM）
- 跨所有窗口收集 `is_heading` 的段落（含 `idx` + `level` + `title` + `no`）→ 按 `idx` 排序：
  - 同一 `level` 相邻标题成对成区间 `[a, b)`；
  - `level=2` 标题挂到其之前最近的 `level=1` 标题下（`parent_idx` = 该 level-1 的 `idx`）；
  - 第一个标题之前的段落 → 归入「正文 / 未分章」首章；
  - 全篇无任何标题 → 整篇为 1 个主章节（仍按窗口校对）。
- 章节随窗口完成逐步长出，含主副标题层级。

### 4. 段落级进度与跨重启续传（核心）
- **进度**：`documents.proofread_upto` = 已连续校对的最高段号。UI 显示「**已校 N / M 段**」（M = 该 document 段落总数）。
- **续传（跨重启）**：项目打开时读 `proofread_upto`；若 `< M` 且状态为 partial/done 中途，顶部横幅提示「**上次校到第 N 段，继续？**」→ 从该段起重按窗口分批发送未完成段落。**窗口（W=30）只是内部批处理，横幅与进度一律用段落。**
- 失败的那个窗口所覆盖的段落**不计入** `proofread_upto`，续传会重发——正确性由**段落粒度**保证。

### 5. 三种重校模式（替代「全量 vs 哈希增量」二分）
| 模式 | 触发 | 发哪些段落 | 类型范围 | 落库 |
|---|---|---|---|---|
| **继续**（Resume） | 「针对上一次」没校完的 | 只发 `idx > proofread_upto` 的段落（按窗口分批） | 继承 `proofread_types` | 补缺失段落，推进 `proofread_upto` |
| **校整章**（Chapter） | 用户选某章（区间 `[s,e)`） | 只发与该章区间重叠的窗口；**按 `paragraph_index ∈ [s,e)` 过滤落库**（防误存邻章） | 继承 `proofread_types` | 删该区间旧 `errors`、重插；该区间 `chapters` 由 LLM 重识别 |
| **全量**（Full） | 换模型/想查全/改类型 | 发全部段落 | **可重选** `proofread_types` | 删该 document 全部 `errors`、`chapters`，重置 `proofread_upto=0`，全量重建 |

> 不采用「按内容哈希增量」：用户要的是「针对上一次」= 继续模式、「校一整个章节」= 校整章模式，都是**窗口/区间级**，更简单更稳。

### 6. 失败不吞
`call_llm` 出错 **抛 `LLMCallError(reason)`**（不返回伪装成功的合法 JSON）。窗口级捕获 → 该窗口记一条 `type=format` 说明错误（「第 N 段附近调用/解析失败：原因」，按段落定位）+ 项目状态标 `partial`，UI 看得见。绝不允许「调挂了却返回 0 条」。

### 7. 采纳（增量写 `revised_text`）+ 导出即 apply
- **采纳（点击）**：对某 error 点「采纳」→ 基 = `revised_text ?? text`；在其中把 `original_text → suggested_text` 替换（首个非重叠匹配）；写回 `revised_text`，error 标 `accepted`。**每次采纳立即落库** → 所谓「确认完整后自动保存新段落」天然成立：一段内每条改完，`revised_text` 即是最终态。
- **确认完整**：该段所有 error 都 `accepted/rejected`（无 pending）即「✅已确认」。
- **撤回**：`revised_text` 可由 `text` + 仍 `accepted` 的 errors 重算 → 无限回退，无需版本表。
- **导出修订稿（apply）**：按 idx 遍历 `paragraphs`，每段取 `revised_text ?? text` 重建 docx → 即「应用」。原始 `text` 永留底，可随时「导出原始稿」对照。
- **重校**：重 proofread 读 `revised_text ?? text`（当前最佳文本），段数不变 → `paragraph_index` 稳定，可局部续校；已采纳修正自动标记 resolved。
- **不再「生成新 document / 新 paragraphs」**——消灭 Document id 膨胀与全量重校浪费。

## Prompt 设计（`build_proofread_prompt`）

入参：`window_paragraphs`（带绝对序号）+ `selected_types`（本次要查的类型列表）。
- 指令中**显式列出选中类型**（中文：错别字/语法/标点/格式），并声明「不报告其他类型」。
- 模型回引 `paragraph_index` 作展示序号；`original_text` 仅校验（若该段不含归一化后的 `original_text`，退化为全文搜索定位）。
- `type` 必须是选中类型之一；解析阶段再次过滤（防御模型多报）。

```
以下是小说片段（段落已编号，编号即 paragraph_index）：
段落 12: 寒门子弟……
段落 13: ……

请只检查以下类型的问题：错别字、标点符号。（不报告其他类型）
并同时标出哪些段落是章节标题（含主副层级）。
返回 JSON：
{
  "errors": [ {"paragraph_index": 12, "type": "typo|grammar|punctuation|format",
               "original_text": "…", "suggested_text": "…", "severity": "high|medium|low", "description": "…"} ],
  "structure": [ {"paragraph_index": 12, "is_heading": true, "level": 1,
                  "heading_title": "寒门子弟", "heading_no": "第一章"} ]
}
只返回 JSON。
```

## 解析健壮性（`proofer.py` 重写）

1. **去 markdown 围栏**：剥离 ```json / ```。
2. **括号配平扫描**取最外层 `{...}`（非首尾 `index`/`rindex`，避免正文含 `{}` 切错）。
3. **多对象**取第一个完整对象。
4. **字段校验与归一**：
   - `type` 归一：错别字→typo、语法→grammar、标点→punctuation、格式→format；**不在 `proofread_types` 内的直接丢弃**；非法值落默认并记日志。
   - `severity` 归一 high/medium/low。
   - `paragraph_index` 必须为整数且在版本段落范围内（越界 clamp/丢弃）。
   - `original_text` / `suggested_text` / `description` 去空白、缺省 `""`。
   - 缺 `paragraph_index` 或 `original_text` 的条目 → 丢弃并记数量（不崩溃）。
5. **`structure` 层级校验**：`is_heading=true` 的条目须有 `level`(1/2) 与 `heading_title`；缺失层级则默认 `level=1`。
6. **截断/超限**：响应截断（括号不配平、token 切断）→ 该窗标「部分失败」，可重试或缩小窗口，不静默丢错误。

## 采纳与导出（apply 即导出，不新建文档）

详见上方「§7 采纳 + 导出即 apply」。要点：**采纳增量写 `revised_text`**，导出修订稿 = 按 idx 取 `revised_text ?? text` 重建 docx。**不再生成新 document / 新 paragraphs**——`apply.py` 的职责改为「导出」，原始 `text` 永留底。

## 交互界面重设计（ProjectDetail）

- **左侧：章节列表**（按层级缩进显示主/副标题；状态点：未校/校完/部分；待处理/已采纳错误数）。点某章可「校此章」「标为手动标题」。
- **顶部：校对控制**：
  - 模式单选（继续 / 校整章▼ / 全量）
  - **问题类型多选**（错别字 / 语法 / 标点 / 格式，默认全选；继续/校整章继承，全量可改）
  - 进度「**已校 N / M 段**」+ 按钮
- **中部：选中章的 errors**，按 `paragraph_index` 分组；每条「采纳 / 忽略」按钮；段落显示采纳状态（未处理 / 处理中 N/M / ✅已确认）。
- **导出**：「导出修订稿」「导出原始稿」按钮（修订稿 = `revised_text ?? text`）。
- **打开项目若有未完校对**：顶部横幅「**上次校到第 N 段，继续？**」→ 一键继续（段落级，不提「窗」）。
- 重校「校整章」：在章节列表点某章 → 选「校此章」→ 走 Chapter 模式。

> 注：类型多选是「**检查选择**」（决定 LLM 查什么）；结果区也可另加「**显示筛选**」（只看某类型），二者独立，本设计先实现检查选择。

## 待实现文件清单

| 文件 | 改动 |
|---|---|
| `backend/app/core/database.py` | 新增 `paragraphs` 表（含 `revised_text`）+ 段落 CRUD；`chapters` 加 `level`/`parent_idx`；`documents` 加 `proofread_upto` + `proofread_types`；`proofread_results` 内部窗口记录 |
| `backend/app/core/document.py` | 入库只存段落（`text`）；**去除正则标题识别** |
| `backend/app/core/llm.py` | 失败抛 `LLMCallError`（不返回伪装 JSON） |
| `backend/app/core/proofer.py` | `proofread_window()`：一次返回 errors(按选中类型过滤)+structure(含 level)；健壮解析（去围栏/配平/归一/层级校验/截断） |
| `backend/app/api/proofread.py` | 窗口循环（W=30，内部）+ 三种模式 + 类型选择 + 段落级 `proofread_upto` 推进 + 渐进层级章节 |
| `backend/app/api/apply.py` | **改为导出**：从 `paragraphs` 取 `revised_text ?? text` 重建 docx；不再生成新版本 |
| `frontend/src/pages/*` | 流程+UI 重设计：章节列表(层级)+模式控制+**类型多选**+段落进度+按章逐条采纳/忽略+续传横幅+导出 |

## 阶段划分

- **阶段1**：DB schema + 段落入库（`database.py` / `document.py`）—— 去正则、加 `revised_text` / `level` / `parent_idx` / `proofread_upto` / `proofread_types`
- **阶段2**：`llm.py` 失败机制 + `proofer.py` 健壮解析（含层级校验 + 按类型过滤）
- **阶段3**：`proofread.py` 窗口循环 + 三种模式 + **类型选择传入/落库** + 段落级进度游标 + 渐进层级章节
- **阶段4**：采纳增量写 `revised_text` + 导出即 apply（`apply.py` 改为导出；不再新建版本）
- **阶段5**：前端流程+UI 重设计（章节列表/模式控制/**类型多选**/段落进度/逐条采纳/续传横幅/导出）
- **阶段6**：跨重启续传验证 + 端到端（用 DeepSeek 跑测试小说）

## Open Questions（已确认）

- 窗口大小 `W=30` 段/次调用 —— 已确认（内部批处理）。
- 章节识别与校对合成一步、逐步进行 —— 已确认。
- 原始段落存储 `paragraphs` 为锚点 —— 已确认。
- 一个窗口可能多/无章节边界 —— 已确认，章节地图靠跨窗口累积标题段。
- **章节识别全交给 LLM、含主副标题、去掉正则** —— 已确认。
- **进度/续传以「段落」为单位，窗口不外露** —— 已确认。
- **三种重校模式（继续/校整章/全量）+ 跨重启续传 + UI 重设计** —— 已确认。
- **采纳增量写 `revised_text`、导出即 apply，不新建 document** —— 已确认。
- **校稿可选问题类型（错别字/语法/标点/格式）** —— 已确认。
