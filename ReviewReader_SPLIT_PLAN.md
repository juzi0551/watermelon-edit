# ReviewReader 拆分重构方案（优化版 v3）

## 1. 现状与拆分背景

`ReviewReader.jsx` 目前单文件规模为 **3028 行**，混杂了 UI 视图渲染、核心业务逻辑、Diff 算法、快捷键监听、脱离容器的悬浮工具条及侧边栏等模块。

近期 Commit（`e6f113c` UUID 升级与 `e22bc29` 段落交互优化）中新增了：
- **段落 UUID 支持**：全流程切换为 UUID 标识定位与关联。
- **段落新增与合并**：`handleInsertPara`（向上/向下插入）、`handleMergeParas`（邻段合并）及 `handleMergeMultipleParagraphs`（多段批量合并）。
- **重构的悬浮工具条**：使用 `fixed` 绝对定位脱离段落容器渲染。

| 模块 | 行数 | 占比 | 存在问题 |
|---|---|---|---|
| `ReviewReaderInner` (主组件) | ~1485 | 49% | 状态与 Event Handlers 过多，逻辑交织 |
| `ParaRow` (段落行) | ~430 | 14% | 包含多选合并模式（`mergeMode`），需配合 `React.memo` 渲染优化 |
| `ParagraphView` (段落文本+高亮) | ~367 | 12% | 包含文本解析与高亮，调用的 Diff 比较算法需抽离 |
| 工具函数、悬浮工具条与浮动卡片层 | ~746 | 25% | 混杂全局常量、节点算法、脱离容器的悬浮工具条及弹窗 UI |

---

## 2. 拆分原则与架构优化

1. **按职责分层**：
   - **纯工具/算法 (Utils)**：抽离为不依赖 React 生命周期的 Pure Functions，提升复用性。
   - **静态配置 (Constants)**：统一抽取常量，避免 Hook/组件内部硬编码。
   - **业务逻辑 (Hooks)**：收拢高耦合的状态与处理函数（含新增的插入/合并Handlers），避免 Hook 间参数暴涨与闭包隐患。
   - **展示组件 (Components)**：按功能拆分（包含独立的悬浮工具条组件 `ParaHoverToolbar.jsx`），控制单文件行数在 100~400 行之间。
2. **两阶段实施**：
   - **第一阶段（纯 UI 抽取）**：提取 `ParaRow`、`ParagraphView`、`ParaHoverToolbar` 及卡片组件，零逻辑变更，安全验证。
   - **第二阶段（逻辑与 Hooks 抽离）**：重构 Handlers、快捷键与状态管理。

---

## 3. 最终完整文件清单与目录结构

```text
frontend/src/components/
  ReviewReader.jsx                     ← [删除] 原 3028 行大文件
  ReviewReader/
    index.jsx                          ← [新建] 入口 re-export（保持 forwardRef 兼容）
    ReviewReaderInner.jsx              ← [新建] 骨架主组件（~150 行）
    constants.js                       ← [新建] 静态配置与颜色/映射表（~50 行）
    utils/
      diffUtils.js                     ← [新建] computeInlineDiff / computeLcsDiffChunks / computeExactLcsDiff（~130 行）
      readerUtils.js                   ← [新建] getCircledNum / parseEditNotes（~50 行）
    hooks/
      useReaderLogic.js                ← [新建] 整合 State + 全部 Handlers（含合并/插入段落 Handlers，~500 行）
      useReaderKeyboard.js             ← [新建] 键盘快捷键监听（~100 行）
      useReaderScroll.js               ← [新建] 滚动定位与 useImperativeHandle（~120 行）
    components/
      ParaRow.jsx                      ← [新建] 段落行组件（React.memo，含 mergeMode 支持，~430 行）
      ParagraphView.jsx                ← [新建] 段落文本与 Diff 高亮（~250 行）
      DiffView.jsx                     ← [新建] DiffView + CompactDiffView 展示组件（~130 行）
      ParaHoverToolbar.jsx             ← [新建] 固定定位的段落悬浮工具条（编辑/标题/看原文/分页/删除，~100 行）
      ReaderContentArea.jsx            ← [新建] 主阅读区段落流渲染（~120 行）
      ErrorSidebar.jsx                 ← [新建] 右侧问题面板，内联 ErrorList（~170 行）
      ActionBar.jsx                    ← [新建] 底部校对与操作栏，内联 ShortcutHint / ControlsRow（~300 行）
      FloatCardLayer.jsx               ← [新建] 浮动层条件渲染容器（~40 行）
      ErrorDetailCard.jsx              ← [新建] 错误详情浮动卡片（~130 行）
      ManualEditDetailCard.jsx         ← [新建] 手工修改详情浮动卡片（~190 行）
```

---

## 4. 模块细化说明

### 4.1 基础层（Constants & Utils）

- **`constants.js`**：收纳 `PB_INFO_MAP`、`TYPE_LABEL`、`SEVERITY_COLOR`、`SEVERITY_LABEL`、`TYPE_OPTIONS`、`kbdStyle`。
- **`utils/diffUtils.js`**：收纳三个 Diff 计算纯函数：
  - `computeInlineDiff`
  - `computeLcsDiffChunks`
  - `computeExactLcsDiff`（用于 `ParagraphView` 手工编辑高亮）
- **`utils/readerUtils.js`**：收纳 `getCircledNum`、`parseEditNotes` 等格式转换纯函数。

### 4.2 展示工具组件与新增组件

- **`DiffView.jsx`**：单独提取 `DiffView` 与 `CompactDiffView`。`DiffView` 同时被 `ParagraphView` 和 `ErrorList`（→ `ErrorSidebar`）两处调用，独立成文件更清晰。
- **`ParaHoverToolbar.jsx`**（新增）：承载原 `ReviewReaderInner` 结尾通过 `fixed` 定位脱离容器渲染的悬浮工具条。包含编辑段落、设为标题 Dropdown、藏/看原文、插入/移除硬分页、删除段落等按钮组。

### 4.3 Hooks 逻辑层

- **`useReaderLogic.js`**：管理所有核心状态与事件响应逻辑。包含：
  - 基础操作：`handleSaveEdit`、`handleDeletePara`、`handleTogglePageBreak`、`handleSetChapter`。
  - **最新新增操作**：`handleInsertPara`（插入段落）、`handleMergeParas`（相邻合并）、`handleMergeMultipleParagraphs`（多段合并）及对应的模态框控制状态。
  - 所有传给 `ParaRow` 的回调函数必须使用 `useCallback` 稳定引用。
  - 返回值中提供只读数据（`selectedId`、`chapters`、`flatErrors` 等），供 `useReaderScroll` 消费。
- **`useReaderScroll.js`**：管理滚动定位与 `useImperativeHandle`。
  - 通过参数接收来自 `useReaderLogic` 的只读数据，单向依赖，不产生循环引用。
  - 内部定义 `jumpToParagraphExact`，暴露给两处自动跳转 `useEffect`（错误跳转/章节跳转）及 `useImperativeHandle` 的 `scrollToParagraph` API。
- **`useReaderKeyboard.js`**：统一绑定 `ArrowUp/Down/Left/Right/Space/Escape` 等快捷键。

### 4.4 展示组件层（Components）

| 组件文件 | 内联的小实体 | 说明 |
|---|---|---|
| `ParaRow.jsx` | — | 包含多选合并模式（`mergeMode`）复选框渲染，继续使用 `React.memo` |
| `ParagraphView.jsx` | — | 使用 `DiffView.jsx` 中的组件与 `utils/diffUtils.js` 中的算法 |
| `DiffView.jsx` | `CompactDiffView` | 两个 Diff 展示组件，体积约 130 行 |
| `ParaHoverToolbar.jsx` | — | 脱离容器的悬浮定位工具条组件，体积约 100 行 |
| `ErrorSidebar.jsx` | `ErrorList`（~70 行） | `ErrorList` 与 `ErrorSidebar` 强耦合，内联 |
| `ActionBar.jsx` | `ShortcutHint`（~25 行）、`ControlsRow`（~90 行） | 两者均仅在 `ActionBar` 内使用，内联 |
| `FloatCardLayer.jsx` | — | 仅作条件渲染容器，委派给两个独立卡片组件 |
| `ErrorDetailCard.jsx` | — | 独立 |
| `ManualEditDetailCard.jsx` | — | 独立 |

---

## 5. 循环依赖解耦说明

```text
useReaderLogic.js
  └── 返回：{ selectedId, chapters, flatErrors, selectedChapter, ... }

useReaderScroll.js（接收参数）
  ├── 参数：{ ref, flowRef, selectedId, flatErrors, chapters, selectedChapter, paraMapByIdx }
  ├── 内部定义：jumpToParagraphExact（依赖 flowRef、paraMapByIdx）
  ├── useEffect：选中错误时自动跳转（依赖 selectedId、flatErrors）
  ├── useEffect：选中章节时自动跳转（依赖 selectedChapter、chapters）
  └── useImperativeHandle：暴露 scrollToParagraph 给父组件 ref
```

依赖单向流动：`useReaderLogic` 提供只读数据 → `useReaderScroll` 消费，`useReaderScroll` 不导入 `useReaderLogic` 的任何函数，**不存在循环依赖**。

---

## 6. 关键防错与验证规范

1. **回调函数引用稳定性**：`useReaderLogic` 传给 `ParaRow` 的所有响应事件必须显式用 `useCallback` 包装，确保 `React.memo(ParaRow)` 生效，防止渲染性能倒退。
2. **Ref 导出兼容性**：保持 `index.jsx` 与 `ReviewReaderInner.jsx` 对外暴露的 `forwardRef` 接口不变，防范调用方上下文报错。
3. **最新功能覆盖验证**：
   - 重构后需重点验证最新增加的**段落插入**（向上/向下）、**相邻合并**及**多段批量合并**功能无逻辑丢失或 UI 错位。
