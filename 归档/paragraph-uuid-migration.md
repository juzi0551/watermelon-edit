# paragraph-uuid-migration - Work Plan (v2)

## TL;DR (For humans)

**What you'll get:** 每个段落获得一个永不改变的 UUID 作为唯一身份标识。即使你插入新段落、删除段落或合并段落，所有错字标记（errors）、章节信息（chapters）、角色登场位置（characters）始终指向正确的段落，不再因为段落重排而错位。idx 仅保留作为段落排序用途。

**Why this approach:** 分 5 阶段渐进迁移（新增 Wave 0 Hotfix），每阶段可独立部署。历史数据只做最小回填（paragraphs + errors 两张表，幂等可重跑），新旧字段并存不破坏现有数据。先改后端再改前端，前端改动一次性完成。

**What it will NOT do:** 不会删除或废弃 paragraphs.id 字段；不会改变 LLM 返回的 paragraph_index 格式（后端自动转换）；不会一次性改动所有前端 API 参数签名（先保留 idx 参数）。

**Effort:** XL — 涉及 6 张数据库表、约 25 个后端函数、5 个 API 路由、2 个前端文件
**Risk:** Medium — 历史数据只做最小回填，主要风险在后端函数改造和前端全量替换的回归
**Decisions to sanity-check:** (1) 段落不直接用 uuid 做主键，而是新增 uuid 列保留旧 id；(2) errors/chapters 采用双写过渡；(3) LLM 返回的 paragraph_index 在后端自动转换为 paragraph_uuid；(4) Wave 0 Hotfix 必须在任何 uuid 数据写入之前独立上线，否则回填数据将基于已腐化的 idx 映射

Your next move: 审阅详细方案，确认后从 Wave 0 Hotfix 开始执行。

---

> TL;DR (machine): XL effort, High risk, 5-phase migration (Wave 0–4) adding paragraph UUID as permanent identity, errors/chapters/characters/events migrate from idx-based to uuid-based references with dual-write transition. Wave 0 is a mandatory pre-migration hotfix that must ship before any schema changes.

## Scope
### Must have
- **[Wave 0 前置]** 修复 `delete_paragraph_and_reorder` 中 errors/character_relationships/plot_events 未随 idx 平移的 bug
- paragraphs 表新增 uuid 列，迁移现有数据填充
- errors 表新增 paragraph_uuid 列，迁移后逐步废弃 paragraph_index
- chapters 表新增 title_paragraph_uuid / parent_uuid / start_paragraph_uuid / end_paragraph_uuid
- characters 表新增 first_appear_paragraph_uuid
- character_relationships 表新增 paragraph_uuid
- plot_events 表新增 paragraph_uuid
- 后端所有 paragraph 查询函数支持 uuid 查询
- 后端所有 error/chapter 写入函数同步写入 uuid
- 前端 data-para 改用 uuid
- 前端 errorsByParaIdx 改为 errorsByParaUuid
- 前端 selectedParas Set 改用 uuid
- 段落插入/删除/合并后 errors 不再需要 idx 重排

### Must NOT have (guardrails, anti-slop, scope boundaries)
- 不删除 paragraphs.id 字段（旧兼容保留至少一个大版本）
- 不改变段落表的主键（id 仍为主键，uuid 为业务标识）
- 不改变 LLM prompt/response 格式（LLM 返回的 paragraph_index 由后端自动转换）
- 不一次性改动所有前端 API 参数（过渡期 idx 和 uuid 都支持）
- 不改变导出 docx 的排序逻辑（仍用 idx 排序）

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: tests-after + manual QA on staging data
- Evidence: .omo/evidence/task-<N>-paragraph-uuid-migration.<ext>

## Execution strategy
### Parallel execution waves

**Wave 0: Hotfix（必须先于任何 UUID 写入独立部署）**
- Todo 0: 修复 `delete_paragraph_and_reorder` 漏平移 errors/character_relationships/plot_events 的 bug

**Wave 1: Schema + 数据迁移（依赖 Wave 0 已上线）**
- Todo 1: DB schema 变更（6 张表新增 uuid 列）
- Todo 2: 数据迁移脚本（最小回填：paragraphs.uuid + errors.paragraph_uuid，幂等可重跑）
- Todo 3: paragraph CRUD 函数增加 uuid 写入路径（重排时必须携带 uuid）

**Wave 2: 后端核心改造（串行依赖 Wave 1）**
- Todo 4: errors 相关函数迁移到 paragraph_uuid
- Todo 5: chapters 相关函数迁移到 paragraph_uuid（双 map 匹配）
- Todo 6: character/plot_events 相关函数迁移

**Wave 3: API 路由 + 内部逻辑（串行依赖 Wave 2）**
- Todo 7: API 路由改造（同时支持 idx 和 uuid）
- Todo 8: proofread / apply 内部逻辑适配（uuid 转换必须在 _fix_error_paragraph 之后）
- Todo 9: nlp_engine 适配

**Wave 4: 前端改造（可独立于 Wave 2-3）**
- Todo 10: 前端 ReviewReader.jsx uuid 适配（含 selectedParas）
- Todo 11: 前端 api.js 适配

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 0. Hotfix | — | 1-11 | — |
| 1. Schema | 0 | 2-11 | — |
| 2. 数据迁移 | 1 | 3-11 | — |
| 3. paragraph CRUD | 1, 2 | 4-11 | — |
| 4. errors 迁移 | 3 | 5, 7-11 | — |
| 5. chapters 迁移 | 3 | 7-11 | 4 |
| 6. character/events | 3 | 7-11 | 4, 5 |
| 7. API 路由 | 4, 5, 6 | 8-11 | — |
| 8. proofread/apply | 7 | 9-11 | — |
| 9. nlp_engine | 7 | 10-11 | 8 |
| 10. 前端组件 | 7 | — | 9 |
| 11. 前端 API | 7 | — | 9, 10 |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->

### Wave 0: Hotfix（前置必做）

- [ ] 0. 修复 delete_paragraph_and_reorder 漏平移三张关联表的 bug
  What to do / Must NOT do:
  - 在 `delete_paragraph_and_reorder` 函数内，紧跟 chapters 平移逻辑之后，补充三张表的 idx 平移：
    - `UPDATE errors SET paragraph_index = paragraph_index - 1 WHERE document_id = ? AND paragraph_index > ?`
    - `UPDATE character_relationships SET paragraph_idx = paragraph_idx - 1 WHERE project_id = ? AND paragraph_idx > ?`（需要先通过 document_id 查到 project_id）
    - `UPDATE plot_events SET paragraph_idx = paragraph_idx - 1 WHERE project_id = ? AND paragraph_idx > ?`
  - 被删段落对应的 errors 应同步软标记 is_obsolete = 1（`paragraph_index = deleted_idx` 的 pending 记录），而非平移
  - Must NOT: 不改动函数签名，不影响 chapters 平移逻辑
  - Must NOT: 不触碰 `clean_empty_paragraphs`（该函数已正确处理 errors，不需改动）
  References: `backend/app/core/database.py:794-841`
  Acceptance criteria: 删除中间段落后，其后所有段落的 errors/relationships/events idx 正确 -1，被删段落的 errors 全部 obsolete
  QA scenarios:
    1. 创建文档 → 添加 3 段 → 给每段分别加 error → 删除第 2 段
    2. 验证第 3 段的 error.paragraph_index 由 2 变为 1
    3. 验证被删第 2 段的 errors 均为 is_obsolete = 1
    4. 验证 character_relationships / plot_events 的 paragraph_idx 同步 -1
  Commit: Y | fix(core): update errors/relationships/events paragraph_idx on delete_paragraph_and_reorder

### Wave 1: Schema + 数据迁移

- [ ] 1. 数据库迁移：6 张表新增 uuid 列
  What to do / Must NOT do:
  - `paragraphs` 表新增 `uuid TEXT DEFAULT NULL`（注意：初始 NULL，由迁移脚本填充，迁移完成后再加 NOT NULL 约束），加唯一索引 `CREATE UNIQUE INDEX IF NOT EXISTS idx_para_uuid ON paragraphs(uuid) WHERE uuid IS NOT NULL`
  - `errors` 表新增 `paragraph_uuid TEXT DEFAULT NULL`
  - `chapters` 表新增 `title_paragraph_uuid TEXT`, `parent_uuid TEXT`, `start_paragraph_uuid TEXT`, `end_paragraph_uuid TEXT`（均 NULL）
  - `characters` 表新增 `first_appear_paragraph_uuid TEXT DEFAULT NULL`
  - `character_relationships` 表新增 `paragraph_uuid TEXT DEFAULT NULL`
  - `plot_events` 表新增 `paragraph_uuid TEXT DEFAULT NULL`
  - schema_version 升到 8
  - 不改动任何已有数据，只加列
  - Must NOT: 不删除/修改旧列；uuid 列此阶段允许 NULL（后续 Task 2 填充后再收紧）
  References: `backend/app/core/database.py:255-310` (schema migration), `:344-372` (表定义)
  Acceptance criteria: 迁移后 db 能正常打开，6 张表新增列存在，schema_version = 8
  QA scenarios: sqlite3 直接查询验证列存在 + 旧数据不受影响
  Commit: N（和数据迁移脚本一起）

- [ ] 2. 数据迁移脚本：最小回填 paragraphs + errors 两张表
  背景：系统已停止使用，历史数据只需保证「可正常查看不报错」即可，无需完整回填 6 张表。
  只有 paragraphs.uuid 为 NULL 时前端 DOM 定位失效，errors.paragraph_uuid 为 NULL 时历史错误无法显示，其余 4 张表 NULL 保留、等新数据写入时自然带上 UUID。
  What to do / Must NOT do:
  - **Step 1**：为所有现有 paragraphs 生成 uuid（使用 `generate_id()` 即 uuid4），仅填充 uuid IS NULL 的行：
    ```python
    rows = conn.execute("SELECT id FROM paragraphs WHERE uuid IS NULL").fetchall()
    conn.executemany("UPDATE paragraphs SET uuid = ? WHERE id = ?",
                     [(generate_id(), r["id"]) for r in rows])
    ```
  - **Step 2**：用 idx 关系回填 errors.paragraph_uuid：
    ```sql
    UPDATE errors
    SET paragraph_uuid = (
        SELECT uuid FROM paragraphs
        WHERE paragraphs.idx = errors.paragraph_index
        AND paragraphs.document_id = errors.document_id
    )
    WHERE paragraph_uuid IS NULL;
    ```
  - 两步均用 `WHERE ... IS NULL` 条件，**天然幂等**：失败可直接重跑，不会重复写入
  - chapters / characters / character_relationships / plot_events 四张表：**不回填**，NULL 保留
  - Must NOT: 不加事务/ROLLBACK 机制（幂等重跑已足够）；不校验 COUNT；不回填其余 4 张表
  References: `backend/app/core/database.py:1082-1161` (errors)
  Acceptance criteria:
    1. `SELECT COUNT(*) FROM paragraphs WHERE uuid IS NULL` → 0
    2. 打开历史项目，段落正常显示，历史错误正常高亮
  QA scenarios:
    1. 运行脚本后查询验证两个 COUNT
    2. 重跑脚本第二次，结果不变（幂等验证）
  Commit: N（和 schema 一起）

- [ ] 3. paragraph CRUD 函数增加 uuid 写入路径
  What to do / Must NOT do:
  - `insert_paragraphs`: 新增生成 uuid 的逻辑，写入 uuid 列
  - `update_paragraph_text`: 入参增加 `paragraph_uuid` 可选（默认 None），优先用 uuid 查询
  - `update_paragraph_notes_history`: 同上
  - `toggle_paragraph_page_break`: 同上
  - **[关键] `delete_paragraph_and_reorder`**: 重排 idx 时，现有实现是「DELETE 旧行 + INSERT 新行」，
    INSERT 新行时必须携带旧行的 uuid：
    ```python
    # 修改前（uuid 丢失）：
    conn.execute("DELETE FROM paragraphs WHERE id = ?", (old_id,))
    conn.execute("INSERT INTO paragraphs (id, ...) VALUES (?, ...)", (new_id, ...))

    # 修改后（uuid 携带）：
    old_uuid = conn.execute("SELECT uuid FROM paragraphs WHERE id = ?", (old_id,)).fetchone()["uuid"]
    conn.execute("DELETE FROM paragraphs WHERE id = ?", (old_id,))
    conn.execute("INSERT INTO paragraphs (id, uuid, ...) VALUES (?, ?, ...)", (new_id, old_uuid, ...))
    ```
  - 新增 `get_paragraph_by_uuid(document_id, uuid) -> dict | None` 函数
  - 所有函数保持向后兼容：如果调用方传 idx 仍能工作
  - Must NOT: 不改动 API 层签名，只加新参数默认值 None
  References: `backend/app/core/database.py:694-718` (insert), `:734-767` (update_text), `:770-777` (notes), `:780-790` (page_break), `:794-841` (delete_and_reorder), `:1028-1034` (get_by_idx)
  Acceptance criteria:
    1. 新旧两种调用路径均能正常工作
    2. 执行 delete_paragraph_and_reorder 后，被平移段落的 uuid 不变
  QA scenarios:
    1. insert → 验证新段落有 uuid
    2. delete_paragraph_and_reorder(idx=1) → 验证原 idx=2 段落的 uuid 与删前一致（不变）
    3. 用 uuid 调用 update_paragraph_text → 验证正确更新
  Commit: N（和 Wave 2 一起）

### Wave 2: 后端核心改造

- [ ] 4. errors 相关函数迁移到 paragraph_uuid
  What to do / Must NOT do:
  - `insert_error`: 入参增加 `paragraph_uuid` 写入新列
  - `batch_insert_errors`: 同上（通过 document_id + paragraph_index 查 uuid 回填）
  - `get_errors`: 返回结果增加 `paragraph_uuid` 字段
  - `obsolete_errors_in_range` / `delete_errors_in_range`: 增加 uuid 重载版本（按 `paragraph_uuid IN (...)` 查询）
  - `obsolete_errors_by_indices` / `delete_errors_by_indices`: 同上
  - `mark_unmatched_errors_obsolete`: 增加 paragraph_uuid 参数版本
  - 所有函数: 旧参数保持兼容（paragraph_index 仍可用）
  - Must NOT: 不改动 errors 表 paragraph_index 列的写入（双写过渡）
  References: `backend/app/core/database.py:1082-1171`
  Acceptance criteria: error 写入时 paragraph_uuid 和 paragraph_index 都正确填充
  QA scenarios: 插入一个 error，验证两个字段都正确
  Commit: N（和 Wave 3 一起）

- [ ] 5. chapters 相关函数迁移到 paragraph_uuid（双 map 匹配）
  What to do / Must NOT do:
  - `batch_insert_chapters`: 新增 uuid 编写逻辑（通过 document_id + title_paragraph_idx 查 uuid）
  - **[关键] `merge_and_save_chapters`**: 现有逻辑用 `{title_paragraph_idx: chapter}` 单一 map 匹配。
    迁移后需维护**两个 map** 并严格按优先级使用：
    ```python
    existing_by_uuid = {r["title_paragraph_uuid"]: dict(r) for r in existing_rows if r["title_paragraph_uuid"]}
    existing_by_idx  = {r["title_paragraph_idx"]: dict(r) for r in existing_rows}

    for c in new_chapters:
        tip_uuid = c.get("title_paragraph_uuid")
        tip_idx  = c.get("title_paragraph_idx")

        if tip_uuid and tip_uuid in existing_by_uuid:
            # 优先：uuid 命中 → 更新起止区间，不再查 idx_map
            old_ch = existing_by_uuid[tip_uuid]
            UPDATE ...
        elif tip_idx is not None and tip_idx in existing_by_idx:
            # Fallback：仅当 tip_uuid 为 None 或 uuid 未命中时才走 idx
            old_ch = existing_by_idx[tip_idx]
            UPDATE ...
        else:
            # 全新章节
            INSERT ...
    ```
    **Fallback 触发条件**：`tip_uuid` 为 None，或 `tip_uuid` 在 `existing_by_uuid` 中不存在。
    **禁止**：uuid 命中后再检查 idx_map，避免双重更新。
  - `set_paragraph_as_chapter`: 用 uuid 写入新字段
  - `unset_chapter`: 同上
  - `get_chapters`: 返回结果包含 uuid 字段
  - 章节的排序仍按 idx 不变
  - Must NOT: 不改动章节查找/合并算法的核心逻辑
  References: `backend/app/core/database.py:901-963` (set/unset), `:1504-1542` (batch_insert), `:1545-1615` (merge_and_save)
  Acceptance criteria: 章节创建时 uuid 字段正确填充，按 uuid 查询章节能返回正确结果；段落 idx 平移后章节仍能通过 uuid 正确匹配，不产生重复章节
  QA scenarios:
    1. 创建章节 → 按 uuid 查找 → 验证正确
    2. 删除中间段落（触发 idx 平移）→ 调用 merge_and_save_chapters → 验证章节数量不变（无重复插入）
    3. 传入 uuid 存在但 idx 已变的 new_chapters → 验证走 uuid 分支，不走 idx fallback
  Commit: N

- [ ] 6. character/plot_events 相关函数迁移
  What to do / Must NOT do:
  - `upsert_character`: 入参增加 `first_appear_paragraph_uuid`
  - `insert_relationship`: 入参增加 `paragraph_uuid`
  - `insert_plot_event`: 入参增加 `paragraph_uuid`
  - `get_character_graph`: 支持按 paragraph_uuid 过滤（优先 uuid，fallback idx）
  - `get_plot_events`: 同上
  - 所有旧参数（first_appear_idx 等）保持兼容
  - Must NOT: 不改变人物图谱网络数据的返回结构
  References: `backend/app/core/database.py:1635-1759`
  Acceptance criteria: 创建角色/事件时 uuid 字段正确写入
  QA scenarios: 新建字符关系和 plot event → 验证 uuid 正确
  Commit: N

### Wave 3: API + 内部逻辑

- [ ] 7. API 路由改造（同时支持 idx 和 uuid）
  What to do / Must NOT do:
  - `api_update_paragraph`: URL 加 `{uuid}` 可选参数，body 加 `paragraph_uuid`
  - `api_delete_paragraph`: 同上
  - `api_toggle_page_break`: 同上
  - `api_set_chapter`: 同上
  - `api_update_paragraph_notes`: 同上
  - `api_get_character_graph`: 加 `upto_paragraph_uuid` 可选
  - 所有路由保持 idx 参数向后兼容
  - Must NOT: 不改变现有 API 的 URL 结构（新参数可选）
  References: `backend/app/api/projects.py:155-222`, `:314-320`
  Acceptance criteria: 用 uuid 调用 API 和用 idx 调用 API 效果一致
  QA scenarios: 分别用 idx 和 uuid 调用，对比结果
  Commit: Y | refactor(api): support paragraph_uuid alongside idx in routes

- [ ] 8. proofread / apply 内部逻辑适配
  What to do / Must NOT do:
  - 添加工具函数 `resolve_paragraph_uuid(document_id: str, idx: int) -> str`（查不到时返回空串并记 warning）
  - **[关键] `_proofread_job` 中 uuid 转换的调用位置**：
    uuid 解析必须在 `_fix_error_paragraph` 返回 True **之后**、`insert_error` 调用**之前**：
    ```python
    for e in errs:
        if not _fix_error_paragraph(e, window_paras):  # step 1: 修正 paragraph_index
            continue
        # step 2: 在已修正的 paragraph_index 基础上解析 uuid
        e["paragraph_uuid"] = resolve_paragraph_uuid(doc_id, e["paragraph_index"])
        e.pop("chapter_id", None)
        insert_error(doc_id, e)  # step 3: 写库（同时含 paragraph_index 和 paragraph_uuid）
    ```
    **禁止**：在 `_fix_error_paragraph` 之前做 uuid 转换，否则 fallback 搜索修正了 idx 后 uuid 将指向错误段落。
  - `_recompute_paragraph`: 增加 uuid 路径（优先按 paragraph_uuid 查错误，fallback paragraph_index）
  - `set_error_status` / `accept_all`: 改用 paragraph_uuid 查错误
  - `_fix_error_paragraph`: 不改动（继续修正 idx，uuid 转换在其后做）
  - `export_document`: 章节查找保持 idx 兼容，同时支持 uuid
  - Must NOT: 不改动 LLM prompt 中窗口段落的 idx 格式
  References: `backend/app/api/apply.py:38-78`, `:86-117`, `:120-210`, `backend/app/api/proofread.py:122-138`, `:141-440`
  Acceptance criteria: 校对完成后 errors 的 paragraph_uuid 正确指向段落（包括 _fix_error_paragraph 修正过 idx 的情况）
  QA scenarios:
    1. 运行校对 → 验证 errors.paragraph_uuid 有值且指向正确段落
    2. 故意让 LLM 返回错误的 paragraph_index（窗口内有能匹配的其他段落）→ 验证 uuid 跟随修正后的 idx
  Commit: Y | refactor(proofread): convert paragraph_index to paragraph_uuid on error insertion

- [ ] 9. nlp_engine 适配
  What to do / Must NOT do:
  - `scan_term_consistency`: 生成 error 时增加 paragraph_uuid 字段（用 `resolve_paragraph_uuid` 从 idx 转 uuid）
  - `scan_gbt15834_punctuation`: 同上
  - Must NOT: 不改动扫描逻辑
  References: `backend/app/core/nlp_engine.py:34-173`
  Acceptance criteria: 规则扫描后 errors 的 paragraph_uuid 正确
  QA scenarios: 运行一次规则扫描 → 验证新 errors 有 paragraph_uuid
  Commit: Y | refactor(nlp): add paragraph_uuid to rule-based errors

### Wave 4: 前端改造

- [ ] 10. 前端 ReviewReader.jsx uuid 适配
  What to do / Must NOT do:
  - `data-para={para.idx}` → `data-para={para.uuid}`（所有 querySelector 同步更新）
  - `paraMap` 改用 uuid 做 key（后端返回数据需包含 uuid 字段）
  - `errorsByParaIdx` → `errorsByParaUuid`（按 `e.paragraph_uuid` 分组）
  - `errorParaIdxs` → `errorParaUuids`
  - `unmatchedIds` 检测改用 `paraMap[e.paragraph_uuid]`
  - 跳转逻辑: `querySelector([data-para="${uuid}"])`, `scrollToParagraph(uuid)`
  - 工具栏定位: `data-para="${savedUuid}"`
  - **[新增] `selectedParas` Set 改用 uuid 存储**：
    - `useState(new Set())` 存储内容由 `para.idx` 改为 `para.uuid`
    - 所有 `selectedParas.has(para.idx)` → `selectedParas.has(para.uuid)`
    - `setSelectedParas(prev => new Set([...prev, para.idx]))` → `...para.uuid`
    - selection 模式重校时，传给后端的参数由 `paragraph_indices: [...selectedParas]` 改为 `paragraph_uuids: [...selectedParas]`（后端 API Task 7 需同步支持）
  - 错误列表显示: 保留`第 {...} 段`显示（用 idx），但内部查找用 uuid
  - 编辑功能: `onSelectManualEdit` 传递 uuid
  - Must NOT: 不改变 UI 布局和样式，不破坏现有交互行为
  References: `frontend/src/components/ReviewReader.jsx` 全线
  Acceptance criteria: 段落点击、跳转、错误高亮、工具栏定位、selection 重校全部正常工作
  QA scenarios:
    1. 全流程操作——点击段落、跳转错误、修改文本、滚动恢复
    2. 删除中间段落后，选中后面段落重校 → 验证 uuid 正确传递，不发生段落错位
    3. 多选段落 → selection 模式校对 → 验证 selectedParas uuid 正确传给后端
  Commit: Y | refactor(frontend): use paragraph uuid instead of idx for DOM identification

- [ ] 11. 前端 api.js 适配
  What to do / Must NOT do:
  - `updateParagraph(projectId, idx, ...)` 增加可选 `paragraphUuid` 参数
  - `deleteParagraph(projectId, idx)` 同上
  - `togglePageBreak(projectId, idx, ...)` 同上
  - `setChapter(projectId, idx, ...)` 同上
  - `getCharacterGraph(projectId, uptoParagraphIdx)` 增加 `uptoParagraphUuid` 可选
  - `proofreadSelection(projectId, paragraphIndices)` 增加可选 `paragraphUuids` 参数，优先使用 uuid
  - 内部调用优先使用 uuid（如果可用）
  - Must NOT: 不改变 API 函数签名（新参数可选）
  References: `frontend/src/services/api.js:207-250`
  Acceptance criteria: 用 uuid 调用和用 idx 调用结果一致
  QA scenarios: 两种参数分别测试
  Commit: Y | refactor(frontend): support paragraph_uuid in API calls

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [ ] F1. Plan compliance audit
- [ ] F2. Code quality review
- [ ] F3. Real manual QA
- [ ] F4. Scope fidelity

## Commit strategy
- Wave 0: `fix(core): update errors/relationships/events paragraph_idx on delete_paragraph_and_reorder`
- Wave 1-2 (schema + backend migration): 不单独提交，验证通过后合并为一个 commit
- Todo 7: `refactor(api): support paragraph_uuid alongside idx in routes`
- Todo 8: `refactor(proofread): convert paragraph_index to paragraph_uuid on error insertion`
- Todo 9: `refactor(nlp): add paragraph_uuid to rule-based errors`
- Todo 10: `refactor(frontend): use paragraph uuid instead of idx for DOM identification`
- Todo 11: `refactor(frontend): support paragraph_uuid in API calls`
- 最后：`chore: bump schema_version to 8, add paragraph_uuid migration`

## Success criteria
- [ ] Wave 0 Hotfix 已上线：delete_paragraph_and_reorder 不再遗漏平移 errors/relationships/events
- [ ] 所有段落有 UUID，且永不改变（delete_and_reorder 重排时 uuid 携带传递）
- [ ] errors 通过 paragraph_uuid 而非 paragraph_index 关联段落
- [ ] 插入/删除/合并段落后 errors 不需要 idx 重排
- [ ] LLM 校对的 paragraph_index 在 _fix_error_paragraph 修正之后转换为 paragraph_uuid
- [ ] chapters 通过 uuid 双 map 匹配，段落 idx 平移后不产生重复章节
- [ ] 前端所有段落定位改用 uuid（含 selectedParas）
- [ ] 所有旧 API 向后兼容
- [ ] 历史数据：paragraphs.uuid 与 errors.paragraph_uuid 已回填，历史项目可正常查看不报错
- [ ] 无数据丢失，无回归
