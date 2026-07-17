/**
 * 设计 Token — 与 DESIGN.md 保持同步。
 * 所有硬编码颜色、间距、圆角最终都应引用此文件。
 */
const tokens = {
  color: {
    primary: '#1677ff',
    success: '#52c41a',
    warning: '#faad14',
    danger: '#ff4d4f',

    textPrimary: '#333',
    textSecondary: '#666',
    textTertiary: '#888',
    textMuted: '#bbb',
    textDescription: '#999',

    border: '#f0f0f0',
    borderBar: '#e8e8e8',
    borderSelected: '#ffe58f',
    borderRejected: '#d9d9d9',

    bgPage: '#fff',
    bgCard: '#fafafa',
    bgHighlight: '#fffbe6',
    bgChapterSelected: '#e6f4ff',

    diffRemovedBg: '#fff1f0',
    diffRemovedText: '#cf1322',
    diffAddedBg: '#f6ffed',
    diffAddedText: '#389e0d',
  },

  radius: {
    sm: 3,
    md: 6,
    lg: 8,
    full: 4,
  },

  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },

  fontSize: {
    body: 17,
    bodySm: 15,
    bodyXs: 14,
    meta: 13,
    metaSm: 12,
    heading: 20,
    headingSm: 17,
  },
}

export const {
  color,
  radius,
  spacing,
  fontSize,
} = tokens

export default tokens
