/**
 * 设计 Token — 与 DESIGN.md 保持同步。
 * 所有硬编码颜色、间距、圆角最终都应引用此文件。
 * 支持深浅双模式 CSS 变量透传。
 */

export const lightColors = {
  primary: '#374151',
  success: '#52c41a',
  warning: '#faad14',
  danger: '#ff4d4f',

  textPrimary: '#333333',
  textSecondary: '#666666',
  textTertiary: '#888888',
  textMuted: '#bbbbbb',
  textDescription: '#999999',

  border: '#f0f0f0',
  borderBar: '#e8e8e8',
  borderStrong: '#d9d9d9',
  borderSelected: '#ffe58f',
  borderRejected: '#d9d9d9',

  bgPage: '#ffffff',
  bgCard: '#fafafa',
  bgReader: '#f9f7f4',
  bgToolbar: '#fafafa',
  bgHighlight: '#ffe58f',
  bgChapterSelected: '#e5e5e5',

  diffRemovedBg: '#fff1f0',
  diffRemovedText: '#cf1322',
  diffAddedBg: '#f6ffed',
  diffAddedText: '#389e0d',

  shadowFloat: '0 6px 16px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.08)',
}

export const darkColors = {
  primary: '#d4a359',
  success: '#49aa19',
  warning: '#d89614',
  danger: '#a61d24',

  textPrimary: '#e6e6e6',
  textSecondary: '#a6a6a6',
  textTertiary: '#8c8c8c',
  textMuted: '#595959',
  textDescription: '#737373',

  border: '#303030',
  borderBar: '#424242',
  borderStrong: '#565656',
  borderSelected: '#998114',
  borderRejected: '#434343',

  bgPage: '#141414',
  bgCard: '#1f1f1f',
  bgReader: '#1e1c18',
  bgToolbar: '#4a4a4a',
  bgHighlight: '#594200',
  bgChapterSelected: '#2a2a2a',

  diffRemovedBg: '#431418',
  diffRemovedText: '#ff7875',
  diffAddedBg: '#133b11',
  diffAddedText: '#95de64',

  shadowFloat: '0 6px 16px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.35)',
}

/**
 * 颜色 Token：映射为 CSS 变量，确保主题切换时页面无需重绘或刷新即可秒级自适应
 */
export const color = Object.keys(lightColors).reduce((acc, key) => {
  acc[key] = `var(--color-${key})`
  return acc
}, {})

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  full: 999,
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
}

export const fontSize = {
  body: 17,
  bodySm: 15,
  bodyXs: 14,
  meta: 13,
  metaSm: 12,
  heading: 20,
  headingSm: 17,
}

export function applyThemeVariables(isDark) {
  const themeColors = isDark ? darkColors : lightColors
  const root = document.documentElement
  root.setAttribute('data-theme', isDark ? 'dark' : 'light')
  document.body.style.backgroundColor = themeColors.bgPage
  document.body.style.color = themeColors.textPrimary
  Object.entries(themeColors).forEach(([key, val]) => {
    root.style.setProperty(`--color-${key}`, val)
  })
}

const tokens = {
  color,
  radius,
  spacing,
  fontSize,
}

export default tokens

