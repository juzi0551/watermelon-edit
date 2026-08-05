import React from 'react'

/**
 * 轻量且安全的 Markdown 文本渲染器（无需额外大型第三方依赖）
 * 支持 **加粗**、`代码`、### 标题、无序/有序列表与段落换行。
 */
export default function MarkdownContent({ content }) {
  if (!content) return null

  const lines = content.split('\n')
  const elements = []

  let inList = false
  let listItems = []

  const renderFormattedText = (text) => {
    // 匹配 **加粗** 与 `代码`
    const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g)
    return parts.map((part, idx) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={idx}>{part.slice(2, -2)}</strong>
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code
            key={idx}
            style={{
              background: 'var(--color-bgChapterSelected, rgba(0, 0, 0, 0.06))',
              padding: '2px 6px',
              borderRadius: 4,
              fontSize: '0.9em',
              fontFamily: 'monospace',
              color: 'var(--color-primary, #d97706)',
            }}
          >
            {part.slice(1, -1)}
          </code>
        )
      }
      return part
    })
  }

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`ul_${elements.length}`} style={{ paddingLeft: 20, margin: '6px 0' }}>
          {listItems.map((item, i) => (
            <li key={i}>{renderFormattedText(item)}</li>
          ))}
        </ul>
      )
      listItems = []
      inList = false
    }
  }

  lines.forEach((line, index) => {
    const trimmed = line.trim()

    // 1. 无序列表 (- 或 *)
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      inList = true
      listItems.push(trimmed.slice(2))
      return
    }

    // 2. 有序列表 (1. 2.)
    if (/^\d+\.\s/.test(trimmed)) {
      inList = true
      listItems.push(trimmed.replace(/^\d+\.\s/, ''))
      return
    }

    // 如果之前在列表中，现在非列表行，则刷出列表
    if (inList) {
      flushList()
    }

    // 3. 标题 (### )
    if (trimmed.startsWith('### ')) {
      elements.push(
        <h4 key={index} style={{ margin: '10px 0 6px 0', fontSize: 15, fontWeight: 600 }}>
          {renderFormattedText(trimmed.slice(4))}
        </h4>
      )
      return
    }
    if (trimmed.startsWith('## ')) {
      elements.push(
        <h3 key={index} style={{ margin: '12px 0 6px 0', fontSize: 16, fontWeight: 600 }}>
          {renderFormattedText(trimmed.slice(3))}
        </h3>
      )
      return
    }

    // 4. 普通段落
    if (trimmed === '') {
      elements.push(<div key={index} style={{ height: 6 }} />)
    } else {
      elements.push(
        <p key={index} style={{ margin: '4px 0', lineHeight: 1.6 }}>
          {renderFormattedText(line)}
        </p>
      )
    }
  })

  // 补刷新末尾残留列表
  flushList()

  return <div className="markdown-render-body">{elements}</div>
}
