# ReviewReader 拆分重构方案（优化版 v4）

## 1. 现状与拆分背景

`ReviewReader.jsx` 目前单文件规模约 **3100 行**，混杂了 UI 视图渲染、核心业务逻辑、Diff 算法、快捷键监听、脱离容器的悬浮工具条、侧边栏及 60fps 悬浮卡片定位跟随等模块。

近期优化与架构收缩中确立了：
- **段落 UUID 支持**：全流程切换为 UUID 标识定位与关联。
- **段落新增与合并**：`handleInsertPara`（向上/向下插入）、`handleMergeParas`（邻段合并）及 `handleMergeMultipleParagraphs`（多段批量合并）。
- **Baseline 文本存储机制**：新增段落首次保存直接写入 `text` 字段且 `revised_text = NULL`；仅当用户主动填写备注时记录首条 `edit_note` 履历。
- **60fps 悬浮卡片滚动跟随**：基于 rAF 节流、`spanCacheRef` 节点缓存与 `inView` 容器可视区剪裁的顺滑定位。

| 模块 | 行数 | 占比 | 存在问题 |
|---|---|---|---|
| `ReviewReaderInner` (主组件) | ~1500 | 48% | 状态与 Event Handlers 过多，逻辑交织 |
| `ParaRow` (段落行) | ~430 | 14% | 包含多选合并模式（`mergeMode`），需配合 `React.memo` 渲染优化 |
| `ParagraphView` (段落文本+高亮) | ~367 | 12% | 包含文本解析与高亮，调用的 Diff 比较算法需抽离 |
| 工具函数、悬浮工具条与浮动卡片层 | ~800 | 26% | 混杂全局常量、节点算法、脱离容器的悬浮工具条及弹窗 UI |

---

## 2. 拆分原则与架构优化

1. **按职责分层**：
   - **纯工具/算法 (Utils)**：抽离为不依赖 React 生命周期的 Pure Functions（如 Diff 计算），清理无用死代码。
   - **静态配置 (Constants)**：统一抽取常量，避免 Hook/组件内部硬编码。
   - **业务逻辑 (Hooks)**：收拢高耦合的状态与处理函数，并将悬浮卡片定位抽离为独立 Hook (`useReaderCardPosition.js`)。
   - **展示组件 (Components)**：按功能拆分（包含独立的悬浮工具条组件 `ParaHoverToolbar.jsx`），控制单文件行数在 100~400 行之间。
2. **物理声明规范（防 TDZ 陷阱）**：
   - Hook 内部严格按 `1. useState → 2. useRef → 3. 派生计算与 Handlers` 的物理顺序集中初始化，杜绝暂时性死区 (TDZ) 错误。

---

## 3. 最终完整文件清单与目录结构

```text
frontend/src/components/
  ReviewReader.jsx                     ← [删除] 原 3100 行大文件
  ReviewReader/
    index.jsx                          ← [新建] 入口 re-export（保持 forwardRef 兼容）
    ReviewReaderInner.jsx              ← [新建] 骨架主组件（~150 行）
    constants.js                       ← [新建] 静态配置与颜色/映射表（~50 行）
    utils/
      diffUtils.js                     ← [新建] computeLcsDiffChunks / computeExactLcsDiff（~110 行，清理死代码）
      readerUtils.js                   ← [新建] getCircledNum / parseEditNotes（~50 行）
    hooks/
      useReaderLogic.js                ← [新建] 整合 State + 全部 Handlers（含 Baseline 写入/合并/插入，~500 行）
      useReaderKeyboard.js             ← [新建] 键盘快捷键监听（~100 行）
      useReaderScroll.js               ← [新建] 滚动定位与 useImperativeHandle（~100 行）
      useReaderCardPosition.js         ← [新建] 60fps rAF 悬浮卡片定位、spanCacheRef 缓存与 inView 剪裁（~120 行）
    components/
      ParaRow.jsx                      ← [新建] 段落行组件（React.memo，含 mergeMode 支持，~430 行）
      ParagraphView.jsx                ← [新建] 段落文本与 Diff 高亮（~250 行）
      DiffView.jsx                     ← [新建] DiffView + CompactDiffView 展示组件（~130 行）
      ParaHoverToolbar.jsx             ← [新建] 固定定位的段落悬浮工具条（编辑/标题/看原文/分页/删除，~100 行）
      ReaderContentArea.jsx            ← [新建] 主阅读区段落流渲染（~120 行）
      ErrorSidebar.jsx                 ← [新建] 右侧问题面板，内联 React.memo(ErrorList)（~170 行）
      ActionBar.jsx                    ← [新建] 底部校对与操作栏，内联 ShortcutHint / ControlsRow（~300 行）
      FloatCardLayer.jsx               ← [新建] 浮动层条件渲染容器（~40 行）
      ErrorDetailCard.jsx              ← [新建] 错误详情浮动卡片（~130 行）
      ManualEditDetailCard.jsx         ← [新建] 手工修改详情浮动卡片（~190 行）
```

---

## 4. 模块细化说明

### 4.1 基础层（Constants & Utils）

- **`constants.js`**：收纳 `PB_INFO_MAP`、`TYPE_LABEL`、`SEVERITY_COLOR`、`SEVERITY_LABEL`、`TYPE_OPTIONS`、`kbdStyle`。
- **`utils/diffUtils.js`**：收纳两个常用 Diff 计算纯函数（已移除未调用的 `computeInlineDiff`）：
  - `computeLcsDiffChunks`
  - `computeExactLcsDiff`（用于 `ParagraphView` 手工编辑高亮）
- **`utils/readerUtils.js`**：收纳 `getCircledNum`、`parseEditNotes` 等格式转换纯函数。

### 4.2 展示工具组件与新增组件

- **`DiffView.jsx`**：单独提取 `DiffView` 与 `CompactDiffView`。`DiffView` 同时被 `ParagraphView` 和 `ErrorList`（→ `ErrorSidebar`）两处调用。
- **`ParaHoverToolbar.jsx`**：承载原 `ReviewReaderInner` 结尾通过 `fixed` 定位脱离容器渲染的悬浮工具条。包含编辑段落、设为标题 Dropdown、藏/看原文（配合 `<span>` 包裹以兼容 disabled Tooltip）、插入/移除硬分页、删除段落等按钮组。

### 4.3 Hooks 逻辑层

- **`useReaderLogic.js`**：管理所有核心状态与事件响应逻辑。
  - 基础操作：`handleSaveEdit`、`handleDeletePara`、`handleTogglePageBreak`、`handleSetChapter`。
  - **Baseline 存储规范**：新增段落保存优先写入 `text`，`revised_text = NULL`；仅当用户填写备注时写入首条 `edit_note` 履历。
  - **回调引用稳定**：暴露给 `ErrorList` 等组件的 `handleSelectError` 与 `handleSelectObsoleteError` 必须使用 `useCallback` 稳定句柄，确保 `React.memo` 优化生效。
- **`useReaderCardPosition.js`**（新增）：
  - 收拢 `ErrorDetailCard` 与 `ManualEditDetailCard` 的定位跟随逻辑。
  - 内部实现 **rAF 节流**、**`spanCacheRef` 节点 Map 缓存**及 **`inView` 可视区判断**（锚点超出容器自动隐去，可视区内 60fps 平滑跟随）。
- **`useReaderScroll.js`**：管理滚动定位与 `useImperativeHandle`。
  - 内部定义 `jumpToParagraphExact`，暴露给自动跳转 `useEffect` 及 `useImperativeHandle` 的 `scrollToParagraph` API。
- **`useReaderKeyboard.js`**：统一绑定快捷键监听，配合点击锁逻辑防止连续触发。

### 4.4 展示组件层（Components）

| 组件文件 | 内联的小实体 | 说明 |
|---|---|---|
| `ParaRow.jsx` | — | 包含多选合并模式（`mergeMode`）复选框渲染，使用 `React.memo` |
| `ParagraphView.jsx` | — | 使用 `DiffView.jsx` 中的组件与 `utils/diffUtils.js` 中的算法 |
| `DiffView.jsx` | `CompactDiffView` | 两个 Diff 展示组件 |
| `ParaHoverToolbar.jsx` | — | 脱离容器的悬浮定位工具条组件，解决了 disabled Tooltip 事件阻断 |
| `ErrorSidebar.jsx` | `ErrorList`（~70 行） | 使用 `React.memo` 包裹 `ErrorList`，避免切题与改打字时的全量重渲染 |
| `ActionBar.jsx` | `ShortcutHint`、`ControlsRow` | 包含带连点锁防护的采纳/拒绝按钮 |
| `FloatCardLayer.jsx` | — | 条件渲染容器，包含带有 `key` 属性的 `ManualEditDetailCard` |
| `ErrorDetailCard.jsx` | — | 独立卡片组件 |
| `ManualEditDetailCard.jsx` | — | 独立卡片组件 |

---

## 5. 关键防错与验证规范

1. **TDZ 顺序规范**：任何新构建的 Hook / 组件必须保障：`1. useState → 2. useRef → 3. Handlers` 严格自顶向下物理声明。
2. **回调函数引用稳定性**：传给 `ParaRow` 与 `ErrorList` 的所有回调函数必须显式用 `useCallback` 包装，避免组件倒退为全量重渲染。
3. **功能全量回归测试**：
   - 段落新增 Baseline 逻辑与删除确认弹窗；
   - 卡片 60fps 滚动平滑跟随与出屏隐去；
   - 快捷键与底部栏采纳/拒绝连点防护锁；
   - 历史作废 Tab 点击跳转无白屏报错。
