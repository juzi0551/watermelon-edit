# 校对效率优化计划

## 概述

功能基本完善后，针对校对过程的性能瓶颈和任务管理进行优化。核心目标：**减少等待时间、并行执行、可重试**。

## 设计思路

### 任务模型

```
一次"继续校对"点击 → 一个 Batch 任务
                       ├── 窗口 0（段 0-29）→ LLM 调用
                       ├── 窗口 1（段 30-59）→ LLM 调用
                       ├── 窗口 2（段 60-89）→ LLM 调用
                       └── ...（并行执行）
完成后停等，用户确认后再点下一次
```

- **Batch（任务）**：一批段落（默认 200 段 = ~7 个窗口），用户一次点击触发一个 batch
- **Window（窗口）**：30 段 / 个 LLM 调用，batch 内的所有窗口并行执行
- 不做自动连续校对，每完成一个 batch 需用户手动触发下一个
- 单个窗口中 LLM 调用失败 → 记录失败状态，batch 整体完成后标记哪些窗口失败
- 用户可手动重试失败窗口（而非整个 batch）

### 任务记录

每个 batch 持久化到数据库，记录：
- 覆盖的段落范围
- 每个窗口的执行状态（pending / running / ok / failed）
- token 消耗汇总
- 重试次数

### 后端配置参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `BATCH_SIZE` | 200 | 每批处理的段落数 |
| `WINDOW_SIZE` | 30 | 每个 LLM 窗口的段落数 |
| `MAX_CONCURRENT` | 5 | 并行 LLM 请求上限（防限频） |

---

## 阶段划分

### 阶段1：任务记录（Batch Record）

**目标**：新增 batch 记录表 + CRUD，为后续并行和重试提供基础。

| 任务 | 描述 | 涉及文件 | 交付物 |
|------|------|----------|--------|
| 1.1 数据库新增 `proofread_batches` 表 | 字段：id, document_id, range_start, range_end, status, total_windows, done_windows, failed_windows, retry_count, created_at | `database.py` | 表结构 |
| 1.2 新增 create_batch / update_batch / get_batch 函数 | 基本的 CRUD 操作 | `database.py` | DB 操作函数 |
| 1.3 新增 `batch_windows` 子表或 JSON 字段 | 记录每个窗口的段落范围、状态（pending/ok/failed）、错误信息、重试次数 | `database.py` | 窗口级状态 |

---

### 阶段2：批量并行执行（Batch + Parallel）

**目标**：每次「继续校对」处理 BATCH_SIZE 段，内部分多个窗口并行调用 LLM。

| 任务 | 描述 | 涉及文件 | 交付物 |
|------|------|----------|--------|
| 2.1 后端 BATCH_SIZE 配置 | `config.py` 增加 `BATCH_SIZE=200`，`proofread.py` 引用 | `config.py`, `proofread.py` | 配置项 |
| 2.2 拆分 batch 为窗口列表 | 将 [range_start, range_end) 按 WINDOW_SIZE 拆成窗口列表 | `proofread.py` | 窗口划分 |
| 2.3 `asyncio.Semaphore` 并发控制 | 最多 `MAX_CONCURRENT` 个 LLM 请求同时运行 | `proofread.py` | 并发限流 |
| 2.4 `asyncio.gather` 并行执行窗口 | 同一个 batch 内的所有窗口并行执行 | `proofread.py` | 并行调用 |
| 2.5 容错：部分窗口失败不影响其他 | 单个窗口 LLM 报错只标记该窗口 failed，batch 不整体失败 | `proofread.py` | 部分失败 |
| 2.6 结果写入（利用阶段3 的批量写入） | 所有成功窗口的 errors/chapters 统一批量写入 | `proofread.py` | 写入 |

---

### 阶段3：批量写入数据库（与阶段1-2 并行进行）

**目标**：窗口执行完毕后，每个 batch 内的所有 errors/chapters 批量写入，替代逐条 INSERT。

| 任务 | 描述 | 涉及文件 | 交付物 |
|------|------|----------|--------|
| 3.1 新增 `batch_insert_errors` | `executemany` 一次写入所有 error | `database.py` | 批量写入函数 |
| 3.2 新增 `batch_insert_chapters` | `executemany` 一次写入所有 chapter | `database.py` | 批量写入函数 |
| 3.3 替换调用点 | `proofread.py` 中批量收集后一次写入 | `proofread.py` | 调用替换 |

---

### 阶段4：重试机制

**目标**：batch 完成后，用户可对失败窗口单独重试。

| 任务 | 描述 | 涉及文件 | 交付物 |
|------|------|----------|--------|
| 4.1 新增 `/proofread/retry-window` 接口 | 接收 batch_id + window_index，重试单个窗口 | `proofread.py` | API |
| 4.2 重试逻辑 | 复用已有的 `proofread_window`，写回结果，更新 batch 记录 | `proofread.py` | 重试逻辑 |
| 4.3 前端显示失败窗口 | batch 完成后展示哪些窗口失败，提供「重试」按钮 | `ProjectDetail.jsx` | 前端展示 |
| 4.4 错误信息持久化 | 失败的窗口记录错误原因（超时 / Key 无效 / 模型报错等） | `proofread.py` | 错误信息 |

---

### 阶段5：前端适配

**目标**：前端展示当前 batch 的进度（窗口级）、失败状态、重试入口。

| 任务 | 描述 | 涉及文件 | 交付物 |
|------|------|----------|--------|
| 5.1 轮询增强 | 除 `project.status` 外，轮询当前 batch 的窗口级进度 | `ProjectDetail.jsx` | 进度轮询 |
| 5.2 进度展示 | 展示如「7/7 窗口完成，1 个失败」+ 进度条 | `ProjectDetail.jsx` | 进度 UI |
| 5.3 失败窗口重试按钮 | 失败窗口旁显示「重试」按钮，调用 retry API | `ProjectDetail.jsx` | 重试操作 |
| 5.4 批量大小显示 | 页面展示当前批覆盖的段落范围 | `ProjectDetail.jsx` | 范围信息 |

---

## 执行顺序

```
阶段1（任务记录表）→ 阶段2（并行执行）→ 阶段4（重试）
                                      ↗
                              阶段3（批量写入，与阶段1-2 并行）
                                            ↓
                                     阶段5（前端适配）
```

**推荐**：
1. 先做阶段1 + 阶段3（表结构 + 批量写入，独立不冲突）
2. 再做阶段2（核心并行逻辑）
3. 阶段4（重试）
4. 阶段5（前端）

---

## 涉及文件清单

| 文件 | 改动内容 |
|------|----------|
| `backend/app/core/database.py` | 阶段1（batch 表 + CRUD）、阶段3（批量写入） |
| `backend/app/api/proofread.py` | 阶段2（并行调度）、阶段4（retry API） |
| `backend/config.py` | 阶段2（BATCH_SIZE 配置） |
| `frontend/src/pages/ProjectDetail.jsx` | 阶段5（进度展示、重试操作） |
| `frontend/src/components/ReviewReader.jsx` | 阶段5（可能需渲染进度/重试） |

---

## 验收标准

- [ ] 每次点击「继续校对」处理 200 段（可配置），而非 30 段
- [ ] 200 段内 7 个窗口并行执行，总耗时 ≈ 单窗口耗时
- [ ] 单个窗口 LLM 调用失败不影响同一 batch 的其他窗口
- [ ] 失败的窗口可单独重试，重试结果正确写入
- [ ] 数据库 errors/chapters 为批量写入而非逐条 INSERT
- [ ] 前端显示窗口级进度：已完成 X/Y 窗口
- [ ] 以上改动不改变现有结果的正确性
