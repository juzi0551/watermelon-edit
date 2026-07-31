/**
 * ReviewReader 模块化阅读器架构索引
 * -------------------------------------------------------------------------
 * 主入口文件：ReviewReader/index.jsx -> ReviewReaderInner.jsx
 * 
 * 📁 hooks/ (业务逻辑与状态)
 *   ├── useReaderLogic.jsx       - 核心状态、数据派生及全量 Handlers (删除/合并/编辑/章节)
 *   ├── useReaderCardPosition.js  - 60fps 浮动卡片坐标计算与视口剪裁
 *   ├── useReaderKeyboard.js     - 键盘快捷键 (Arrow/Space/Esc) 与 pointerdown 外部点击监听
 *   └── useReaderScroll.js       - 滚动持久化、章节跳转与 rAF 滚动刷新
 * 
 * 📁 components/ (UI 组件)
 *   ├── ReaderContentArea.jsx    - 正文阅读区容器
 *   ├── ParaRow.jsx              - 单段落行渲染与双击编辑
 *   ├── ParagraphView.jsx        - 段落文本、Diff 高亮与标注渲染
 *   ├── ParaHoverToolbar.jsx     - 段落悬浮定位工具条
 *   ├── ErrorSidebar.jsx         - 右侧问题列表侧边栏 (含 ErrorList)
 *   ├── ActionBar.jsx            - 底部校对控制与操作栏
 *   ├── FloatCardLayer.jsx       - 错误卡片与手修卡片悬浮层
 *   ├── ErrorDetailCard.jsx      - AI 错误详情卡片
 *   ├── ManualEditDetailCard.jsx - 手工修改履历卡片
 *   └── DiffView.jsx             - Diff 文本比对展示纯组件
 * 
 * 📁 utils/ & constants.js (纯工具与静态映射)
 *   ├── diffUtils.js             - LCS Diff 算法
 *   ├── readerUtils.js           - 履历解析与圈号转换
 *   └── constants.js             - 色彩、标签映射与静态配置
 * -------------------------------------------------------------------------
 */
import React, { forwardRef } from 'react'
import { ReviewReaderInner } from './ReviewReaderInner'

const ReviewReader = forwardRef(ReviewReaderInner)

export default ReviewReader
export { ReviewReader }
