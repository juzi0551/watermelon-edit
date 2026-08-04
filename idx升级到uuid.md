# 全系统段落标识升级、合并追溯、逻辑删除与段落恢复方案 (产品全能力闭环完全体)

本方案针对段落标识升级、逻辑删除、段落恢复 (Restore)、SQLite 物理主键碰撞防范、`UNIQUE(document_id, idx)` 约束防范、合并追溯链、采纳替换全局追溯解析、纯 UUID 采纳入口拦截解除、数据库 UUID 索引、迁移顺序编排、版本机制隔离、跨版本降级、图谱数据提取写入链 UUID 补齐、全系统跳转、状态解析 API 及测试用例进行全盘无死角的架构设计与落地规划。

---

## 一、 逻辑删除配套产品能力：段落恢复机制 (Restore Paragraph)

基于 `is_deleted = 1` 的数据完整保留特性，补齐段落恢复与撤销能力，充分发挥逻辑删除的架构优势：

### 1. 后端恢复 API (`POST /projects/{project_id}/paragraphs/{uuid}/restore`)
- **入参**：`uuid` (目标段落 UUID)，可选 `target_idx` (指定恢复插回的位置，默认置于被删前位置或当前选区位置)；
- **数据库执行**：
  1. 校验该 `uuid` 且 `is_deleted = 1` 的行；
  2. 平移 `target_idx` 及后续有效段落的 `idx` (`+1`)，腾出 `[0, N)` 物理序号；
  3. 执行恢复更新：
     `UPDATE paragraphs SET is_deleted = 0, idx = target_idx, id = document_id || ':' || target_idx WHERE uuid = ?`；
  4. 将关联的作废错误重置为可用状态；
  5. 返回恢复后的段落数据 `{ idx: target_idx, uuid: target_uuid }`。

### 2. 前端 UI 交互呈现
- **悬浮预览区撤销恢复**：在聊天引用条、侧边栏历史作废记录中的 `(已删除)` 悬浮卡片上，展示被删原文本的同时，提供 **`[↩ 恢复此段落到正文]`** 操作按钮。点击调用恢复接口，正文视口 0 延迟刷新并平滑滚动高亮插回的段落；
- **历史引用自动无缝复原**：段落恢复后，所有指向该 `paragraph_uuid` 的历史消息、方案卡片、人物图谱 Tag 瞬间从 `(已删除)` **自动复原为正常的 `段落#XX` 高亮跳转状态**。

---

## 二、 数据库 Migration 编排与 `source` 列写入规范

### 1. `_migrate_schema` 迁移 5 步严格依赖顺序 (`schema_version < 6`)
1. **[步骤 1: 增列]** `ALTER TABLE paragraphs ADD COLUMN` 新增 `is_deleted` (INTEGER DEFAULT 0), `merged_into_uuid` (TEXT DEFAULT NULL), `source` (TEXT DEFAULT 'original') 三列；
2. **[步骤 2: 段落 UUID 补发]** 在 Python 侧遍历 `WHERE uuid IS NULL OR uuid = ''` 的物理段落，逐行调用 Python 侧 `generate_id()` 补发；
3. **[步骤 3: 图谱三表 UUID 关联回填]** 对 `characters`、`character_relationships`、`plot_events` 中 `paragraph_uuid IS NULL` 的历史行，按 `project_id -> current_document_id -> paragraph_index` 反查回填；
4. **[步骤 4: 性能索引]**：
   ```sql
   CREATE INDEX IF NOT EXISTS idx_paragraphs_uuid ON paragraphs(uuid);
   CREATE INDEX IF NOT EXISTS idx_errors_para_uuid ON errors(paragraph_uuid);
   ```
5. **[步骤 5: 版本置位]** `UPDATE meta SET schema_version = '6'`。

### 2. `source` 列的三处显式写入点
- DOCX 解析导入 / 重新导入：`source = 'original'`；
- `insert_paragraph_and_reorder` (作者手动插入新段)：`source = 'user_added'`；
- `merge_paragraphs` / `merge_multiple_paragraphs` (合并后保留的 keep 段)：`source = 'merge'`。

---

## 三、 物理主键 `id` 重改与合并事务原子性

### 1. 物理主键重写策略
在段落被逻辑删除或合并时，**同步重写其物理主键 `id`** 为 **`f"{document_id}:deleted:{uuid}"`**。恢复时重新还原为 `f"{document_id}:{target_idx}"`。彻底消除 `IntegrityError` 碰撞。

### 2. 合并操作单事务原子性保护
将 `merge_paragraphs` 和 `merge_multiple_paragraphs` 的“批量专有标记 + 关联表指针重定向 + 剩余段落单次平移”**全部收拢在同一个 `with get_conn() as conn:` 数据库事务内**。

---

## 四、 前端 Hook、采纳与恢复交互

### 1. `ProjectDetail.jsx` 采纳入口双空拦截修护
修护 `ProjectDetail.jsx:106`，拦截条件修改为：
`if (paragraphIdx == null && !paragraphUuid) { message.warning('请先在左侧编辑区选中或指定目标段落'); return; }`

### 2. `useParagraphStatus` in-flight Promise 去重
Hook 内部集成 in-flight Promise 共享去重，正文变动或恢复段落时自动触发缓存失效刷新。

---

## 五、 完整状态决策矩阵

| 初始段落 `is_deleted` | `merged_into_uuid` | 追溯终点状态 | UI 表现 / Tag | 采纳与跳转行为 |
| :--- | :--- | :--- | :--- | :--- |
| `0` (正常) | `NULL` | 正常 | `段落#12` | 正常跳转高亮，允许替换 |
| `1` (被合并) | 指向 `uuid_A` (A 正常) | 找到正常 A | `段落#12 (已合并)` | 平滑跳转至 A 所在当前段落，允许替换至 A (弹窗提示落点) |
| `1` (链式合并) | B -> A -> C (C 正常) | 找到正常 C | `段落#12 (已合并)` | 递归追溯跳转至 C 所在当前段落 |
| `1` (被合并) | 指向 `uuid_A` (A 已删) | 追溯终点 `is_deleted=1` | `段落#12 (已合并但目标被删)` | 提示目标已被删，悬浮预览 A 删前 display_text，禁用采纳 |
| `1` (被主动删) | `NULL` | 无终点 | `段落#12 (已删除)` | 提示已被删，悬浮预览 display_text，提供 **`[↩ 恢复此段落]`** 按钮 |
| **属于旧版本** | - | `stale_version` | `(第 v{version} 版第 {idx} 段)` | 提示属旧版本，悬浮预览当时文本，定位至当前版近邻段落 |

---

## 六、 全量变更文件清单 (共 23 个文件)

### 后端 (8 个文件)
1. **[database.py](file:///Users/zhonglei/Desktop/Project/西瓜少年/backend/app/core/database.py)**：DB Migration 5 步编排、`source` 写入点、新增 `restore_paragraph` 数据库恢复方法、逻辑删除同步重改 `id = document_id:deleted:uuid`、`get_result` 改用 `get_visible_paragraphs`、`merge_multiple_paragraphs` 批量单事务专有标记路径改造、`clean_empty_paragraphs` 逻辑删除与平移改造、`resolve_paragraph_target` 追溯逻辑；
2. **[proofer.py](file:///Users/zhonglei/Desktop/Project/西瓜少年/backend/app/core/proofer.py)**：`_extract_and_save_character_events` 显式写入与反向补齐 `paragraph_uuid`；
3. **[chat.py](file:///Users/zhonglei/Desktop/Project/西瓜少年/backend/app/core/chat.py)**：Tool Schema 升级为 `paragraph_uuid` required，上下文 Inject `paragraph_uuid`；
4. **[api/chat.py](file:///Users/zhonglei/Desktop/Project/西瓜少年/backend/app/api/chat.py)**：卡片解析支持 `paragraph_uuid` 缺失反向补齐；
5. **[api/projects.py](file:///Users/zhonglei/Desktop/Project/西瓜少年/backend/app/api/projects.py)**：重构 `_resolve_para` 支持全局追溯，新增 `/paragraphs/{uuid}/status`、`/paragraphs/status_batch` 与 `/paragraphs/{uuid}/restore` 恢复路由；
6. **[api/apply.py](file:///Users/zhonglei/Desktop/Project/西瓜少年/backend/app/api/apply.py)**：`export_document` 真实导出路由使用 `get_revised_paragraphs` 过滤 `is_deleted`；
7. **[api/proofread.py](file:///Users/zhonglei/Desktop/Project/西瓜少年/backend/app/api/proofread.py)**：校对窗口切片改用 `get_visible_paragraphs`；
8. **[tests/test_paragraph_lifecycle.py](file:///Users/zhonglei/Desktop/Project/西瓜少年/backend/app/tests/test_paragraph_lifecycle.py)**：新建后端单元测试文件（补充恢复测试）。

### 前端 (15 个文件)
9. **[services/api.js](file:///Users/zhonglei/Desktop/Project/西瓜少年/frontend/src/services/api.js)**：新增 `getParagraphStatus` 及 `restoreParagraph(projectId, uuid)` 接口封装；
10. **[hooks/useParagraphStatus.js](file:///Users/zhonglei/Desktop/Project/西瓜少年/frontend/src/hooks/useParagraphStatus.js)**：新增段落状态与被删预览 Hook（支持触发恢复）；
11. **[pages/ProjectDetail.jsx](file:///Users/zhonglei/Desktop/Project/西瓜少年/frontend/src/pages/ProjectDetail.jsx)**：修护 `handleApplyChatText` 采纳双空拦截逻辑，实现 0 延迟乐观更新与恢复事件监听；
12. **[useReaderScroll.js](file:///Users/zhonglei/Desktop/Project/西瓜少年/frontend/src/components/ReviewReader/hooks/useReaderScroll.js)**：底层滚动支持 `targetUuid` DOM 节点与 `paras` 动态反推；
13. **[useReaderLogic.jsx](file:///Users/zhonglei/Desktop/Project/西瓜少年/frontend/src/components/ReviewReader/hooks/useReaderLogic.jsx)**：删除/恢复/合并/插入操作适配逻辑删除；
14. **[ReviewReaderInner.jsx](file:///Users/zhonglei/Desktop/Project/西瓜少年/frontend/src/components/ReviewReader/ReviewReaderInner.jsx)**：自动滚动逻辑带上 `uuid`；
15. **[ReaderContentArea.jsx](file:///Users/zhonglei/Desktop/Project/西瓜少年/frontend/src/components/ReviewReader/components/ReaderContentArea.jsx)**：确认 `data-para` UUID 优先锚点挂载；
16. **[ParaRow.jsx](file:///Users/zhonglei/Desktop/Project/西瓜少年/frontend/src/components/ReviewReader/components/ParaRow.jsx)**：传递 `para.uuid`；
17. **[CharacterGraph.jsx](file:///Users/zhonglei/Desktop/Project/西瓜少年/frontend/src/components/CharacterGraph.jsx)**：登场/关系/事件跳转全线带上 `uuid`，Tag 动态反推显示；
18. **[ErrorSidebar.jsx](file:///Users/zhonglei/Desktop/Project/西瓜少年/frontend/src/components/ReviewReader/components/ErrorSidebar.jsx)**：问题列表跳转传 `error.paragraph_uuid`；
19. **[FloatCardLayer.jsx](file:///Users/zhonglei/Desktop/Project/西瓜少年/frontend/src/components/ReviewReader/components/FloatCardLayer.jsx)**：浮动卡片跳转传 `error.paragraph_uuid`；
20. **[ErrorDetailCard.jsx](file:///Users/zhonglei/Desktop/Project/西瓜少年/frontend/src/components/ReviewReader/components/ErrorDetailCard.jsx)**：错误卡片 Tag 显示优先通过 `uuid` 动态反推；
21. **[ChaptersModal.jsx](file:///Users/zhonglei/Desktop/Project/西瓜少年/frontend/src/components/ChaptersModal.jsx)**：章节跳转使用 `title_paragraph_uuid`；
22. **[ChatPanel.jsx](file:///Users/zhonglei/Desktop/Project/西瓜少年/frontend/src/components/ChatPanel/ChatPanel.jsx)**：引用条与对话上下文改为基于 `uuid` 动态反推；
23. **[ReplacementCard.jsx](file:///Users/zhonglei/Desktop/Project/西瓜少年/frontend/src/components/ChatPanel/ReplacementCard.jsx)**：采纳严格以 `uuid` 为准，被删悬浮支持 `[↩ 恢复此段落]`。

---

## 七、 自动化测试与验证计划 (共 11 个用例)

### 1. 后端自动化测试 (`backend/app/tests/test_paragraph_lifecycle.py`)
- `test_restore_deleted_paragraph_reinserts_and_reorders()`: 逻辑删除段落后调用 restore API，断言段落重新还原 `is_deleted = 0`，`id` 恢复为 `document_id:target_idx`，后续段落 `idx` 平移正确；
- `test_delete_then_reinsert_same_idx_no_pk_conflict()`: 删除 idx=5 后再在同一位置插入新段落，验证重改 `id` 后无 SQLite 主键冲突；
- `test_merge_batch_writes_merged_into_uuid()`: 验证 `merge_multiple_paragraphs` 批量单事务专有标记；
- `test_character_extract_writes_paragraph_uuid()`: 验证校对萃取图谱数据后三表 `paragraph_uuid` 正确写入；
- `test_update_via_merged_uuid_resolves_to_target()`: 用被合并段落 B 的 UUID 发起 PATCH 修改请求，断言修改被精准应用在目标段落 A 上；
- `test_clean_empty_preserves_merge_trace()`: 验证 `clean_empty_paragraphs` 不抹除历史追溯与逻辑删除行；
- `test_version_switch_isolates_documents()`: 验证上传新文档时旧版本 `document_id` 的段落行完整保留；
- `test_status_api_cross_version_uuid()`: 验证查询旧版本 UUID 时返回 `stale_version` 降级响应；
- `test_resolve_paragraph_target_cycle()`: 验证防环机制；
- `test_character_graph_cutoff_with_deleted_uuid()`: 验证 cutoff 截断不空图；
- `test_get_visible_paragraphs_count()`: 验证视口计数。

### 2. 前端回归测试与构建
- 修改完成后自动执行 `npm run build`。
