export const EMPTY_ARRAY = Object.freeze([])

export const PB_INFO_MAP = Object.freeze({
  original: Object.freeze({ label: '📄 原文硬分页', border: '#e8e8e8', color: '#8c8c8c' }),
  auto_chapter: Object.freeze({ label: '📖 章节开页', border: '#ffe58f', color: '#d48806' }),
  manual: Object.freeze({ label: '✂️ 新增硬分页', border: '#ffd591', color: '#d46b08' }),
})

export const TYPE_LABEL = {
  typo: '错别字',
  grammar: '语法',
  punctuation: '标点',
  format: '格式',
}

export const SEVERITY_COLOR = {
  high: 'red',
  medium: 'orange',
  low: 'default',
}

export const SEVERITY_LABEL = {
  high: '高',
  medium: '中',
  low: '低',
}

export const TYPE_OPTIONS = [
  { value: 'typo', label: '错别字' },
  { value: 'grammar', label: '语法' },
  { value: 'punctuation', label: '标点' },
  { value: 'format', label: '格式' },
]

export const kbdStyle = {
  display: 'inline-block',
  minWidth: 24,
  textAlign: 'center',
  padding: '0 6px',
  fontSize: 11,
  lineHeight: '20px',
  background: 'rgba(255,255,255,0.15)',
  borderRadius: 4,
  border: '1px solid rgba(255,255,255,0.3)',
  marginRight: 6,
  fontFamily: 'inherit',
}
