---
name: 西瓜少年 — 小说校稿工具
description: 基于大模型的小说 docx 校对工具。Ant Design 为基础，自定义 token 覆盖于交互反馈和文本 diff 场景。

colors:
  # ── 语义色（与 antd Design Token 映射） ──
  primary: "#1677ff"           # antd 主题色（按钮、链接）
  success: "#52c41a"           # 采纳、校对完成、绿色软底文字
  warning: "#faad14"           # 待处理、待审核标记
  danger: "#ff4d4f"            # antd danger（删除、错误文字）

  # ── 文字 ──
  text-primary: "#333"         # 正文主要文字
  text-secondary: "#666"       # 次要说明文字
  text-tertiary: "#888"        # 段落号、辅助标记
  text-muted: "#bbb"           # 箭头分隔符、极弱信息
  text-description: "#999"     # 错误描述文字

  # ── 边框 ──
  border: "#f0f0f0"           # 默认边框（卡片、条目）
  border-bar: "#e8e8e8"       # 底部操作栏上边框
  border-selected: "#ffe58f"  # 选中条目的边框
  border-rejected: "#d9d9d9"  # 已拒绝条目的左边框

  # ── 背景 ──
  bg-page: "#fff"             # 页面主背景
  bg-card: "#fafafa"          # 卡片、diff 面板、hover 底色
  bg-highlight: "#fffbe6"     # 列表条目选中态背景
  bg-chapter-selected: "#e6f4ff"  # 章节目录选中态

  # ── 文本 diff（校对场景独有） ──
  diff-removed-bg: "#fff1f0"
  diff-removed-text: "#cf1322"
  diff-added-bg: "#f6ffed"
  diff-added-text: "#389e0d"

typography:
  body:
    fontFamily: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif
    fontSize: 16px
    lineHeight: 1.9
  body-sm:
    fontFamily: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif
    fontSize: 14px
    lineHeight: 1.6
  body-xs:
    fontFamily: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif
    fontSize: 13px
    lineHeight: 1.5
  meta:
    fontFamily: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif
    fontSize: 12px
    lineHeight: 1.4
  meta-sm:
    fontFamily: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif
    fontSize: 11px
    lineHeight: 1.3
  heading:
    fontFamily: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif
    fontSize: 18px
    fontWeight: 600
  heading-sm:
    fontFamily: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif
    fontSize: 15px
    fontWeight: 600
  mono:
    fontFamily: SFMono-Regular, Consolas, "Liberation Mono", Menlo, Courier, monospace
    fontSize: 13px

rounded:
  sm: 3px    # 小标签、diff 高亮块
  md: 6px    # 卡片、面板、列表条目
  lg: 8px    # 大面板
  full: 4px  # 常规 antd 默认（Button、Input 等）

spacing:
  xs: 4px    # 标签间距、最小间隙
  sm: 8px    # 常规间距、gap
  md: 12px   # 较大间距、条目 padding
  lg: 16px   # 卡片 padding、头部间距
  xl: 24px   # 段落间距、大区块间距

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#fff"
    rounded: "{rounded.full}"
    padding: "4px 16px"
  button-text:
    textColor: "{colors.text-tertiary}"
    fontSize: 12px
  tag-default:
    backgroundColor: "{colors.border}"
    textColor: "{colors.text-tertiary}"
    rounded: "{rounded.sm}"
  tag-warning:
    backgroundColor: "{colors.warning}"
    textColor: "#fff"
  tag-success:
    backgroundColor: "{colors.success}"
    textColor: "#fff"
  error-list-item:
    backgroundColor: "{colors.bg-page}"
    borderColor: "{colors.border}"
    borderLeftColor: "{colors.warning}"   # pending
    padding: "10px 14px"
    rounded: "{rounded.md}"
  error-list-item-selected:
    backgroundColor: "{colors.bg-highlight}"
    borderColor: "{colors.border-selected}"
  diff-card:
    backgroundColor: "{colors.bg-card}"
    borderColor: "{colors.border}"
    padding: "8px 12px"
    rounded: "{rounded.md}"
  bottom-bar:
    backgroundColor: "{colors.bg-page}"
    borderTopColor: "{colors.border-bar}"
    padding: "10px 24px"
---
