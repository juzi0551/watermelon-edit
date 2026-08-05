import { getChatStreamUrl } from '../../services/api'

/**
 * 适配 @ant-design/x useXChat 的自定义 SSE 流式请求转换器。
 * 支持 thinking 思考节点、delta 增量文本、done 结束标记以及中断控流。
 */
export async function streamChatAdapter({
  projectId,
  sessionId,
  model,
  message,
  context,
  signal,
  onUpdate,
  onSuccess,
  onError,
}) {
  let content = ''
  let thinking = ''
  let toolCallArgs = ''
  try {
    const token = localStorage.getItem('token')
    const headers = { 'Content-Type': 'application/json' }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const response = await fetch(getChatStreamUrl(projectId), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        session_id: sessionId,
        model: model,
        message: message,
        context: context,
      }),
      signal,
    })

    if (response.status === 401) {
      window.dispatchEvent(new Event('auth:unauthorized'))
      throw new Error('未授权或登录已过期')
    }

    if (!response.ok) {
      throw new Error(`HTTP 错误 ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith(':')) continue // 过滤 SSE 心跳包 : ping

        if (trimmed.startsWith('data: ')) {
          try {
            const event = JSON.parse(trimmed.slice(6))

            if (event.type === 'thinking' && event.text) {
              thinking += event.text
              onUpdate?.({ content, thinking, isThinking: true })
            } else if (event.type === 'delta' && event.text) {
              content += event.text
              onUpdate?.({ content, thinking, isThinking: false })
            } else if (event.type === 'tool_call') {
              if (event.arguments) {
                toolCallArgs += event.arguments
                try {
                  const cardData = JSON.parse(toolCallArgs)
                  onUpdate?.({
                    content,
                    thinking,
                    isThinking: false,
                    toolCallData: {
                      original: cardData.original_text || cardData.original,
                      replacement: cardData.replacement_text || cardData.replacement,
                      note: cardData.note,
                      paragraph_idx: cardData.paragraph_idx,
                    },
                  })
                } catch (e) {}
              }
            } else if (event.type === 'done') {
              content = content || event.response || ''
              onSuccess?.({
                content,
                thinking,
                messageId: event.message_id,
                sessionId: event.session_id,
                replacementCard: event.replacement_card,
              })
            } else if (event.type === 'error') {
              onError?.(new Error(event.error || '大模型生成出错'))
            }
          } catch (e) {
            console.warn('解析 SSE JSON 数据失败:', e, trimmed)
          }
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      onUpdate?.({ content, thinking, interrupted: true })
    } else {
      onError?.(err)
    }
  }
}
