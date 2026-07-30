# 校对效率优化计划

## 概述

功能基本完善后，针对校对过程的性能瓶颈和任务管理进行优化。核心目标：**减少等待时间、并行执行、可重试**。

> **设计原则：零侵入**。现有「继续校对」按钮及其后端逻辑**完全不动**，新增「批量校对」作为独立入口，两者共存互不影响。

---

## 设计思路

### 两种校对模式对比

| | 继续校对（保持不变） | 批量校对（新增） |
|---|---|---|
| 触发方式 | 现有按钮 | 新增按钮 |
| 每次处理量 | 30 段（1 个 window） | 150 段（5 个 window） |
| 执行方式 | 串行（现有逻辑） | 5 个 window 并行 |
| API 模式参数 | `mode: "continue"` | `mode: "batch"`（新增） |
| 任务记录 | 无 | 记录至 `proofread_batches` 表 |
| 失败处理 | 整体中断 | window 级隔离，可单独重试 |
| 代码改动 | **无** | 新增独立分支 |

### 批量校对任务模型

```
一次「批量校对」点击 → 一个 Batch 任务
                       ├── 窗口 0（段 N+0  ~ N+29） → LLM 调用 ┐ 并行（初始 2 个）
                       └── 窗口 1（段 N+30 ~ N+59） → LLM 调用 ┘
完成后停等，用户确认后再点下一次
```

- **Batch（任务）**：一次点击触发，固定并发 `MAX_CONCURRENT` 个 window，每批处理 `MAX_CONCURRENT × WINDOW_SIZE` 段
- **Window（窗口）**：`WINDOW_SIZE` 段 / 个 LLM 调用，**窗口大小固定不变**（保证 LLM 上下文不过长）
- 不做自动连续校对，每完成一个 batch 需用户手动触发下一个
- 单个窗口 LLM 调用失败 → 记录失败状态，batch 整体完成后标记哪些窗口失败
- 用户可手动重试失败窗口（而非整个 batch）

### 参数说明

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `WINDOW_SIZE` | 30 | 每个 LLM 窗口的段落数（**不变**，控制 LLM 上下文长度） |
| `MAX_CONCURRENT` | 2 | 并行 LLM 请求数（即每次批量处理 2×30=60 段，稳定后可调大） |

> 不引入独立 `BATCH_SIZE` 配置，每批段落数 = `MAX_CONCURRENT × WINDOW_SIZE`，调并发数即可调处理量。初始值设为 2，验证稳定性后再逐步调大至 5。

### 任务记录

每个 batch 持久化到数据库，记录：
- 覆盖的段落范围（range_start ~ range_end）
- 每个窗口的执行状态（pending / running / ok / failed）
- token 消耗汇总
- 重试次数

### 并发写入安全

**所有并行 window 只在内存中收集结果，batch 内全部 window 完成后统一批量写入数据库**：
- 避免多 window 并发写 SQLite 的锁竞争
- `proofread_upto` 在 batch 完成后统一更新为 `range_end`，而不是每个 window 单独更新

---

## 阶段划分

### 阶段1：任务记录（Batch Record）

**目标**：新增 batch 记录表 + CRUD，为后续并行和重试提供基础。

| 任务 | 描述 | 涉及文件 | 交付物 |
|------|------|----------|--------|
| 1.1 数据库新增 `proofread_batches` 表 | 字段：id, document_id, range_start, range_end, status, total_windows, done_windows, failed_windows, retry_count, created_at | `database.py` | 表结构 |
| 1.2 新增 create_batch / update_batch / get_batch 函数 | 基本的 CRUD 操作 | `database.py` | DB 操作函数 |
| 1.3 新增 `batch_windows` 子表 | 记录每个窗口的段落范围（range_start, range_end）、状态（pending/ok/failed）、错误信息、重试次数 | `database.py` | 窗口级状态 |

---

### 阶段2：批量并行执行（新增 `batch` 模式）

**目标**：在 `_proofread_job` 中新增 `batch` 分支，不触碰现有 `continue`/`chapter`/`selection` 分支。

| 任务 | 描述 | 涉及文件 | 交付物 |
|------|------|----------|--------|
| 2.1 后端 MAX_CONCURRENT 配置 | `config.py` 增加 `MAX_CONCURRENT=5`，`WINDOW_SIZE` 保持原有常量 | `config.py` | 配置项 |
| 2.2 新增 `mode: "batch"` 分支 | 在 `_proofread_job` 的 if/elif 链末尾新增 `elif req.mode == "batch":` 块，不改动其他分支 | `proofread.py` | 新增分支 |
| 2.3 生成窗口列表 | 从 `proofread_upto` 起，生成 MAX_CONCURRENT 个连续 window，截断到文末 | `proofread.py` | 窗口划分 |
| 2.4 `asyncio.Semaphore` 并发控制 | 最多 `MAX_CONCURRENT` 个 LLM 请求同时运行 | `proofread.py` | 并发限流 |
| 2.5 `asyncio.gather` 并行执行，`return_exceptions=True` | 同一 batch 内所有窗口并行执行；异常不跨 window 传播 | `proofread.py` | 并行调用 |
| 2.6 内存收集结果，batch 完成后统一写入 | 并行阶段只在内存 list 中收集 errors/chapters；全部完成后批量写入 | `proofread.py` | 安全写入 |
| 2.7 容错：部分窗口失败不影响其他 | 捕获单 window 异常标记 failed，其他成功 window 照常写入 | `proofread.py` | 部分失败 |

---

### 阶段3：批量写入数据库（与阶段1-2 并行进行）

**目标**：新增批量写入函数，供 `batch` 模式使用；**不替换**现有 `insert_error` 调用点。

| 任务 | 描述 | 涉及文件 | 交付物 |
|------|------|----------|--------|
| 3.1 新增 `batch_insert_errors` | `executemany` 一次写入所有 error | `database.py` | 批量写入函数 |
| 3.2 新增 `batch_insert_chapters` | `executemany` 一次写入所有 chapter | `database.py` | 批量写入函数 |

> 现有 `continue`/`chapter`/`selection` 模式继续使用原有的 `insert_error` 逐条写入，不改动。

---

### 阶段4：重试机制

**目标**：batch 完成后，用户可对失败窗口单独重试。

| 任务 | 描述 | 涉及文件 | 交付物 |
|------|------|----------|--------|
| 4.1 新增 batch 状态查询接口 `GET /projects/{id}/proofread/batch/{batch_id}` | 返回 done_windows / total_windows / failed_windows 及每个 window 的状态；前端轮询用 | `proofread.py` | API |
| 4.2 新增重试接口 `POST /projects/{id}/proofread/retry-window` | 接收 batch_id + window_index，从 `batch_windows` 还原 (range_start, range_end) 后重试 | `proofread.py` | API |
| 4.3 重试逻辑 | 复用 `proofread_window`，写回结果，更新 window / batch 状态 | `proofread.py` | 重试逻辑 |
| 4.4 错误信息持久化 | 失败 window 记录错误原因存入 `batch_windows.error_message` | `proofread.py` | 错误信息 |
| 4.5 retry 与 `_RUNNING` 的交互 | 主 batch 运行中禁止 retry；retry 执行期间加入 `_RUNNING` | `proofread.py` | 并发保护 |

---

### 阶段5：前端适配

**目标**：新增「批量校对」按钮，独立于「继续校对」；展示窗口级进度和失败重试入口。

| 任务 | 描述 | 涉及文件 | 交付物 |
|------|------|----------|--------|
| 5.1 新增「批量校对」按钮 | 与「继续校对」并列，`onClick` 调用新的 `handleBatchProofread`；两者共存，互不干扰 | `ProjectDetail.jsx` / `ReviewReader.jsx` | 新按钮 |
| 5.2 新增 `handleBatchProofread` 函数 | 发送 `mode: "batch"` 请求，启动后独立轮询 batch 进度；不影响原有 `handleProofread` | `ProjectDetail.jsx` | 新函数 |
| 5.3 batch 进度轮询 | 轮询 `GET /projects/{id}/proofread/batch/{batch_id}` 获取窗口级进度 | `ProjectDetail.jsx` | 进度轮询 |
| 5.4 批量进度展示区块 | 仅在 batch 模式下出现，展示「5/5 窗口完成，1 个失败」+ 进度条 + 窗口状态点 | `ReviewReader.jsx` | 进度 UI |
| 5.5 失败窗口重试按钮 | 失败窗口列出段落范围 + 错误原因 + 「重试此窗口」按钮 | `ReviewReader.jsx` | 重试操作 |

---

## 异常流程设计

### 异常分类

| 异常类型 | 触发场景 | 粒度 | 处理策略 |
|----------|----------|------|----------|
| **LLM 调用失败** | API Key 无效 / 模型超时 / 限频 | window 级 | 标记该 window failed，其余继续；batch 完成后汇总展示 |
| **JSON 解析失败** | 模型返回格式不合法 | window 级 | 等同 failed，记录 `error_message="JSON 解析失败"`；结果不写入 |
| **前端轮询超时** | 600 次 × 2s = 20 分钟仍未完成 | batch 级 | 前端退出轮询，展示「超时，可手动刷新」；后台任务仍在运行 |
| **前端网络断开** | 用户网络中断 | 轮询级 | 单次失败静默跳过；连续 5 次失败 → 展示「网络异常，已暂停轮询」+ 重连按钮 |
| **并发冲突** | batch 或 continue 运行中再次触发 | 请求级 | 后端返回 `status: running`；前端两个按钮在 `inProgress=true` 时均 disabled |
| **retry 冲突** | batch 运行中点击「重试」 | 请求级 | 后端检测 `_RUNNING` 拒绝；前端 retry 按钮在 `inProgress=true` 时隐藏 |
| **全部 window 失败** | 5 个 window 全部 failed | batch 级 | `proofread_upto` 仍推进（避免死锁）；batch 状态 `failed`；前端展示错误摘要 |
| **重试后仍失败** | retry 再次报错 | window 级 | 增加 `retry_count`，记录新 `error_message`；不限制重试次数 |
| **服务器重启** | FastAPI 进程重启 | batch 级 | `_RUNNING` 内存清空；已成功 window 的结果已写 DB 不丢失；孤儿 batch（running 超 30 分钟）标记 failed |

### 各异常的后端行为

```
单 window 异常（LLM 失败 / 解析失败）：
  → asyncio.gather(return_exceptions=True) 捕获
  → batch_windows[i].status = 'failed', error_message = str(e)
  → 其余 window 结果正常写入
  → proofread_batches.failed_windows += 1
  → 所有 window 完成（含 failed）后，统一推进 proofread_upto 至 range_end

全部 window 失败：
  → 同上，proofread_upto 推进
  → batch.status = 'failed'
  → 前端展示失败摘要 + 逐窗口重试按钮

服务器重启（_RUNNING 丢失）：
  → 前端下次轮询 project.status 时已是 reviewing（FastAPI 重启后初始状态）
  → batch.status 停留在 running → 前端检测到孤儿 batch（created_at 超 30 分钟仍 running）→ 展示「任务中断，可重试失败窗口」
```

### 前端错误展示规则

| 场景 | 展示位置 | 展示内容 |
|------|----------|----------|
| 单 window 失败（其他成功） | batch 进度区块内 | 「⚠ 1 个窗口失败」+ 失败原因 + 「重试」按钮 |
| 全部 window 失败 | batch 进度区块 + 顶部 warning tag | 「全部窗口失败」+ 各窗口错误摘要 |
| 前端轮询超时 | 顶部横幅替换为警告 | 「超时，后台任务可能仍在运行，可刷新查看」 |
| 网络连续断开 5 次 | 进度区块 | 「网络异常，已暂停轮询」+ 「重新连接」按钮 |
| 服务器重启导致中断 | 刷新后 batch 区块 | 孤儿 batch 检测，「任务中断，请重试对应窗口」 |

---

## 操作界面设计

### 按钮布局

「继续校对」保持原位，「批量校对」紧邻其右（或右侧下拉展开），两者共存：

```
[继续校对]  [批量校对]        模式：○ 错别字  ○ 语法  ...    模型：[deepseek-v4-flash ▾]
```

- `inProgress=true` 时两个按钮同时 disabled
- 「继续校对」完成后和现在行为完全一致
- 「批量校对」完成后显示独立的批量进度区块

### 批量进度区块（仅批量校对触发时显示）

**运行中：**
```
┌─────────────────────────────────────────────────────────────┐
│  🔄 批量校对中（第 61–120 段）                               │
│  ████████████░░░░░░░  1 / 2 窗口完成                         │
│  ● ○   （● 完成  ○ 进行中  ✗ 失败）                          │
└─────────────────────────────────────────────────────────────┘
```

**部分失败：**
```
┌─────────────────────────────────────────────────────────────┐
│  ⚠ 第 3 批完成（第 61–120 段）  1/2 窗口成功，1 个失败       │
│  ████████████████████                                        │
│  ● ✗                                                         │
│                                                              │
│  ✗ 窗口 2（第 91–120 段）  API 超时         [重试此窗口]     │
└─────────────────────────────────────────────────────────────┘
```

**全部成功（2 秒后自动收起）：**
```
✓ 批量完成（第 61–120 段，2/2 窗口）  已校至 120/1820 段（6%）
```

### 状态机

```
[空闲]
  │─── 点击「批量校对」──→ [批量运行中] → banner 展示窗口进度
  │                              │ 全部成功
  │                              ↓
  │                        [批量已完成] → 简洁提示 2s 后收起
  │                              │ 部分失败
  │                              ↓
  │                        [批量部分失败] → 失败摘要 + 重试按钮
  │                              │ 点击「重试此窗口」
  │                              ↓
  │                        [重试中] → 该窗口 loading
  │
  └─── 点击「继续校对」──→ [继续运行中]（逻辑完全不变）
```

### 模式边界

| 模式 | 并行逻辑 | 代码改动 |
|------|----------|----------|
| `continue`（继续校对） | 串行，1 window/次 | **无改动** |
| `batch`（批量校对） | 并行，5 window/次 | **新增独立分支** |
| `chapter`（章节校对） | 串行（不变） | **无改动** |
| `selection`（选中段） | 串行（不变） | **无改动** |

### 轮询策略

| 项目 | 继续校对（不变） | 批量校对（新增） |
|------|-----------------|-----------------|
| 退出条件 | `project.status === 'reviewing'` | 同上 |
| 进度来源 | 无窗口级进度 | 额外轮询 `GET /batch/{batch_id}` |
| 轮询间隔 | 2s | 2s |
| 超时上限 | 20 分钟 | 20 分钟 |
| 连续网络失败 | 静默跳过 | 连续 5 次 → 暂停 + 重连按钮 |

---

## 涉及文件清单

| 文件 | 改动内容 | 改动性质 |
|------|----------|----------|
| `backend/app/core/database.py` | 阶段1（batch 表 + CRUD）、阶段3（批量写入函数） | 新增 |
| `backend/app/api/proofread.py` | 阶段2（batch 分支）、阶段4（retry + batch 查询 API） | 新增分支 |
| `backend/config.py` | 阶段2（MAX_CONCURRENT 配置） | 新增 |
| `frontend/src/pages/ProjectDetail.jsx` | 阶段5（批量按钮、handleBatchProofread、batch 轮询） | 新增 |
| `frontend/src/components/ReviewReader.jsx` | 阶段5（批量进度区块、重试按钮） | 新增 |

> 现有 `continue`/`chapter`/`selection` 分支的后端代码、`handleProofread` 函数、`pollProofread` 函数**均不修改**。

---

## 验收标准

- [ ] 「继续校对」按钮行为与现在完全一致，无任何变化
- [ ] 新增「批量校对」按钮，点击后并发执行 2 个 window（每 window 30 段），共处理 60 段（稳定后可调大）
- [ ] 2 个窗口并行执行，总耗时 ≈ 单窗口耗时
- [ ] 单个窗口 LLM 调用失败不影响同一 batch 的其他窗口
- [ ] 所有 window 完成后统一批量写入数据库（无并发写竞态）
- [ ] `proofread_upto` 在 batch 全部完成后统一推进，无中间脏写
- [ ] 失败的窗口显示错误原因，可单独重试
- [ ] 前端显示窗口级进度：已完成 X/2 窗口 + 窗口状态点（并发数可配置）
- [ ] `inProgress=true` 时两个按钮均 disabled，不可重复触发
