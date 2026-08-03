import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Button, Select, Tooltip, Popconfirm, message as antMessage, Tag, Avatar, Spin, Skeleton, Alert } from 'antd'
import {
  CloseOutlined,
  PlusOutlined,
  DeleteOutlined,
  MessageOutlined,
  CheckCircleOutlined,
  HistoryOutlined,
  RobotOutlined,
  RocketOutlined,
  BulbOutlined,
  SmileOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { Bubble, Sender, ThoughtChain, Conversations, Prompts } from '@ant-design/x'
import ReactMarkdown from 'react-markdown'
import {
  listChatSessions,
  createChatSession,
  deleteChatSession,
  listChatMessages,
  getModels,
} from '../../services/api'
import { streamChatAdapter } from './ChatProvider'
import { ReplacementCard } from './ReplacementCard'
import './ChatPanel.css'

const parseReplacementCard = (rawContent, selectionCtx) => {
  if (!rawContent) return { cleanContent: rawContent || '', replacementCard: null }
  const match = rawContent.match(/⟦REPLACEMENT⟧\s*([\s\S]*?)\s*⟦\/REPLACEMENT⟧/)
  if (!match) return { cleanContent: rawContent, replacementCard: null }

  const cleanContent = rawContent.replace(/⟦REPLACEMENT⟧[\s\S]*?⟦\/REPLACEMENT⟧/, '').trim()
  try {
    const cardObj = JSON.parse(match[1])
    const isCrossPara = Boolean(
      selectionCtx?.paragraphEndIdx &&
      selectionCtx.paragraphEndIdx !== selectionCtx.paragraphIdx
    )
    return {
      cleanContent,
      replacementCard: {
        ...cardObj,
        isCrossPara,
        paragraphIdx: selectionCtx?.paragraphIdx,
        paragraphUuid: selectionCtx?.paragraphUuid,
      },
    }
  } catch (e) {
    return { cleanContent, replacementCard: null }
  }
}

export default function ChatPanel({
  projectId,
  visible,
  onClose,
  activeSelection,
  onClearSelection,
  onApplyText,
  bodyFontSize = 17,
  onScrollToParagraph,
  selectedModel: propSelectedModel,
}) {
  // 模型选择持久化记忆（优先使用全局校稿模型）
  const [models, setModels] = useState([])
  const [internalSelectedModel, setInternalSelectedModel] = useState(() => {
    return localStorage.getItem('proofread_selected_model') || localStorage.getItem('chat_selected_model') || null
  })
  const selectedModel = propSelectedModel || internalSelectedModel

  // 会话列表状态
  const [sessions, setSessions] = useState([])
  const [activeSessionId, setActiveSessionId] = useState(null)
  const [conversationsOpen, setConversationsOpen] = useState(false)

  // AbortController
  const abortControllerRef = useRef(null)

  // 1. 加载模型列表
  useEffect(() => {
    if (!projectId || !visible) return

    getModels()
      .then((mList) => {
        if (Array.isArray(mList)) {
          setModels(mList)
          const savedModel = localStorage.getItem('chat_selected_model')
          if (savedModel && mList.some((m) => m.model_id === savedModel)) {
            setInternalSelectedModel(savedModel)
          } else if (mList.length > 0) {
            setInternalSelectedModel(mList[0].model_id)
          }
        }
      })
      .catch((err) => console.error('加载模型列表失败:', err))

    loadSessions()
  }, [projectId, visible])

  const handleModelChange = (val) => {
    setInternalSelectedModel(val)
    localStorage.setItem('chat_selected_model', val)
  }

  // 转换模型列表 Options
  const modelOptions = useMemo(() => {
    return models.map((m) => ({
      value: m.model_id,
      label: `${m.provider_name || m.provider} · ${m.name}`,
    }))
  }, [models])

  // 2. 加载会话列表
  const loadSessions = async () => {
    try {
      const data = await listChatSessions(projectId)
      setSessions(data || [])
      if (data && data.length > 0) {
        if (!activeSessionId || !data.find((s) => s.id === activeSessionId)) {
          setActiveSessionId(data[0].id)
        }
      } else {
        handleCreateSession()
      }
    } catch (err) {
      console.error('加载会话失败:', err)
    }
  }

  // 3. 流式对话处理
  const [messages, setMessages] = useState([])
  const [isRequesting, setIsRequesting] = useState(false)
  const [inputValue, setInputValue] = useState('')

  const handleSend = useCallback(async (userTextOverride, selectionOverride) => {
    const userText = userTextOverride || inputValue
    if (!userText || !userText.trim() || isRequesting) return

    setInputValue('')
    setIsRequesting(true)
    const activeSel = selectionOverride || activeSelection
    const contextPayload = activeSel
      ? {
          selected_text: activeSel.selectedText,
          formatted_excerpt: activeSel.formattedExcerpt || activeSel.selectedText,
          is_excerpt: activeSel.isExcerpt ?? false,
          full_text: activeSel.fullText || null,
          paragraph_idx: activeSel.paragraphIdx,
          paragraph_uuid: activeSel.paragraphUuid,
          paragraph_end_idx: activeSel.paragraphEndIdx,
        }
      : null

    const userMsg = {
      id: `temp_u_${Date.now()}`,
      role: 'user',
      content: userText,
      context: contextPayload,
      created_at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }

    const assistantMsgId = `temp_a_${Date.now()}`
    const thinkingStartTime = Date.now()
    const assistantMsg = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      thinking: '',
      isThinking: true,
      thinkingSeconds: 1,
      context: contextPayload,
      created_at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }

    setMessages((prev) => [...prev, userMsg, assistantMsg])

    // 发送成功后自动解挂旧选区
    if (activeSelection) {
      onClearSelection?.()
    }

    abortControllerRef.current = new AbortController()

    try {
      await streamChatAdapter({
        projectId,
        sessionId: activeSessionId,
        model: selectedModel,
        message: userText,
        context: contextPayload,
        signal: abortControllerRef.current.signal,
        onUpdate: ({ content, thinking, isThinking, interrupted, toolCallData }) => {
          const elapsed = Math.max(1, Math.round((Date.now() - thinkingStartTime) / 1000))
          const { cleanContent, replacementCard: tagCard } = parseReplacementCard(content, contextPayload)
          const activeCard = toolCallData || tagCard
          const isCrossPara = Boolean(contextPayload?.paragraph_end_idx && contextPayload.paragraph_end_idx !== contextPayload.paragraph_idx)

          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== assistantMsgId) return m
              const resolvedIdx = activeCard?.paragraph_idx ?? activeCard?.paragraphIdx ?? m.context?.paragraph_idx ?? contextPayload?.paragraph_idx ?? undefined
              return {
                ...m,
                content: cleanContent,
                thinking,
                isThinking,
                thinkingSeconds: elapsed,
                interrupted,
                replacementCard: activeCard ? {
                  ...activeCard,
                  isCrossPara,
                  paragraph_idx: resolvedIdx,
                  paragraphIdx: resolvedIdx,
                  paragraphUuid: contextPayload?.paragraph_uuid,
                } : m.replacementCard,
                context: interrupted ? { ...(m.context || {}), interrupted: true } : m.context,
              }
            })
          )
        },
        onSuccess: ({ content, thinking, messageId, replacementCard: resCard }) => {
          const elapsed = Math.max(1, Math.round((Date.now() - thinkingStartTime) / 1000))
          const { cleanContent, replacementCard: tagCard } = parseReplacementCard(content, contextPayload)
          const activeCard = resCard || tagCard
          const isCrossPara = Boolean(contextPayload?.paragraph_end_idx && contextPayload.paragraph_end_idx !== contextPayload.paragraph_idx)

          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== assistantMsgId) return m
              const resolvedIdx = activeCard?.paragraph_idx ?? activeCard?.paragraphIdx ?? m.context?.paragraph_idx ?? contextPayload?.paragraph_idx ?? undefined
              return {
                ...m,
                id: messageId || m.id,
                content: cleanContent,
                thinking,
                isThinking: false,
                thinkingSeconds: elapsed,
                replacementCard: activeCard ? {
                  ...activeCard,
                  isCrossPara,
                  paragraph_idx: resolvedIdx,
                  paragraphIdx: resolvedIdx,
                  paragraphUuid: contextPayload?.paragraph_uuid,
                } : m.replacementCard,
              }
            })
          )
          loadSessions()
        },
        onError: (err) => {
          antMessage.error(`生成错误: ${err.message}`)
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content: `⚠️ [错误] ${err.message}`,
                    isThinking: false,
                  }
                : m
            )
          )
        },
      })
    } catch (err) {
      if (err.name !== 'AbortError') {
        antMessage.error(`请求失败: ${err.message}`)
      }
    } finally {
      setIsRequesting(false)
    }
  }, [inputValue, isRequesting, activeSelection, projectId, activeSessionId, selectedModel, onClearSelection, loadSessions])

  // 监听选区工具条触发的自动发送事件
  useEffect(() => {
    const handleTriggerSend = (e) => {
      const { prompt, selection } = e.detail || {}
      if (prompt) {
        handleSend(prompt, selection)
      }
    }
    window.addEventListener('trigger_chat_send', handleTriggerSend)
    return () => window.removeEventListener('trigger_chat_send', handleTriggerSend)
  }, [handleSend])

  // 4. 切换会话时异步同步历史消息
  useEffect(() => {
    if (!projectId || !activeSessionId || !visible) return
    loadMessages(activeSessionId)
  }, [projectId, activeSessionId, visible])

  const loadMessages = async (sessionId) => {
    try {
      const historyMsgs = await listChatMessages(projectId, sessionId)
      const formatted = (historyMsgs || [])
        .filter((m) => m.role !== 'tool') // 隐藏内部协议 role: tool 消息，UI 只展示对话与卡片
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          thinking: m.thinking || m.context?.thinking || '',
          context: m.context,
          replacementCard: m.context?.replacement_card || null,
          created_at: m.created_at ? m.created_at.slice(11, 16) : '',
        }))
      setMessages(formatted)
    } catch (err) {
      console.error('加载历史消息失败:', err)
    }
  }

  // 6. 新建与删除会话
  const handleCreateSession = async () => {
    try {
      const s = await createChatSession(projectId, '新对话', selectedModel)
      setSessions((prev) => [s, ...prev])
      setActiveSessionId(s.id)
      setMessages([])
    } catch (err) {
      antMessage.error('创建会话失败')
    }
  }

  const handleDeleteSession = async (sid) => {
    try {
      await deleteChatSession(projectId, sid)
      antMessage.success('会话已删除')
      const remaining = sessions.filter((s) => s.id !== sid)
      setSessions(remaining)
      if (remaining.length > 0) {
        setActiveSessionId(remaining[0].id)
      } else {
        handleCreateSession()
      }
    } catch (err) {
      antMessage.error('删除会话失败')
    }
  }

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }

  // 转换为 @ant-design/x Conversations 所需 items（支持右键/悬浮菜单删除）
  const conversationItems = useMemo(() => {
    return sessions.map((s) => ({
      key: s.id,
      label: s.title || '新对话',
      icon: <MessageOutlined />,
      menu: {
        items: [
          {
            key: 'delete',
            label: '删除此对话',
            icon: <DeleteOutlined />,
            danger: true,
          },
        ],
        onClick: ({ key, domEvent }) => {
          domEvent?.stopPropagation?.()
          if (key === 'delete') {
            handleDeleteSession(s.id)
          }
        },
      },
    }))
  }, [sessions, handleDeleteSession])

  // 空态用 @ant-design/x Prompts 快捷指令
  const promptItems = [
    {
      key: 'p1',
      icon: <RocketOutlined style={{ color: '#1677ff' }} />,
      label: '🚀 润色选区',
      description: '请提升选中文字的画面感与情绪张力',
    },
    {
      key: 'p2',
      icon: <BulbOutlined style={{ color: '#faad14' }} />,
      label: '💡 评估节奏',
      description: '请分析阅读节奏是否拖沓，给出修改意见',
    },
    {
      key: 'p3',
      icon: <SmileOutlined style={{ color: '#52c41a' }} />,
      label: '🎭 对白优化',
      description: '让对话更符合人物性格与戏剧张力',
    },
    {
      key: 'p4',
      icon: <ThunderboltOutlined style={{ color: '#722ed1' }} />,
      label: '⚡ 强化高潮',
      description: '加强高潮情节的冲突对比与情绪输出',
    },
  ]

  // 转换为 @ant-design/x Bubble.List 所需 items 结构
  const bubbleItems = useMemo(() => {
    return messages.map((item, index) => {
      const isUser = item.role === 'user'
      const isInterrupted = item.context?.interrupted || item.interrupted
      const prevItem = index > 0 ? messages[index - 1] : null
      const nextItem = index < messages.length - 1 ? messages[index + 1] : null
      const isSameRoleAsPrev = prevItem && prevItem.role === item.role
      const isFirstInGroup = !isSameRoleAsPrev
      const userParaIdx = isUser
        ? (item.context?.paragraph_idx ?? item.context?.paragraphIdx ?? item.context?.para_idx)
        : null
      const userSelectedText = isUser
        ? (item.context?.selected_text ?? item.context?.selectedText)
        : null

      const isExplicitExcerpt = item.context?.is_excerpt ?? item.context?.isExcerpt
      const userIsExcerpt = isUser
        ? (isExplicitExcerpt !== undefined && isExplicitExcerpt !== null
            ? Boolean(isExplicitExcerpt)
            : Boolean(item.context?.formatted_context && item.context.formatted_context.includes('选中正文局部节选')))
        : false
      const rawExcerpt = item.context?.formatted_excerpt ?? item.context?.formattedExcerpt ?? userSelectedText
      const userFormattedText = isUser && rawExcerpt
        ? (userIsExcerpt && !rawExcerpt.startsWith('…') ? `…${rawExcerpt}…` : rawExcerpt)
        : null

      return {
        key: item.id || item.key,
        role: item.role,
        placement: 'start',
        style: {
          marginTop: isFirstInGroup ? (index === 0 ? 0 : 8) : 2,
        },
        avatar: isFirstInGroup ? (
          isUser ? (
            <Avatar size={57} style={{ backgroundColor: '#374151', color: '#ffffff', fontWeight: 600, fontSize: 18 }}>我</Avatar>
          ) : (
            <Avatar size={57} src="/assistant-avatar.png" style={{ background: 'linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)', border: '1px solid #bae6fd' }} />
          )
        ) : (
          <div style={{ width: 57, height: 57, flexShrink: 0 }} />
        ),
        styles: {
          content: {
            backgroundColor: isUser ? '#d4a359' : '#fdfbf7',
            border: isUser ? '1px solid #c89547' : '1px solid #e8e5de',
            color: isUser ? '#ffffff' : '#1f2937',
          },
        },
        footer: !isUser && item.replacementCard ? (
          <ReplacementCard
            cardData={item.replacementCard}
            paragraphIdx={item.replacementCard.paragraph_idx ?? item.replacementCard.paragraphIdx ?? activeSelection?.paragraphIdx}
            paragraphUuid={item.replacementCard.paragraphUuid ?? item.replacementCard.paragraph_uuid ?? activeSelection?.paragraphUuid}
            isCrossPara={item.replacementCard.isCrossPara}
            onApplyText={onApplyText}
            bodyFontSize={bodyFontSize}
            projectId={projectId}
            messageId={item.id}
            onScrollToParagraph={onScrollToParagraph}
          />
        ) : undefined,
        content: (
          <div>
            {/* 用户引用段落与原文展示区：格式：段落#xx 节选 | …段落文字… */}
            {isUser && userParaIdx && (
              <Tooltip title={`点击跳转至第 ${userParaIdx} 段并高亮`}>
                <div
                  onClick={(e) => {
                    e.stopPropagation()
                    onScrollToParagraph?.(userParaIdx)
                  }}
                  style={{
                    marginBottom: 8,
                    padding: '6px 10px',
                    borderRadius: 6,
                    background: 'rgba(255, 255, 255, 0.22)',
                    border: '1px solid rgba(255, 255, 255, 0.45)',
                    color: '#ffffff',
                    fontSize: `${Math.max(12, bodyFontSize - 3)}px`,
                    lineHeight: 1.5,
                    cursor: 'pointer',
                    userSelect: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    maxHeight: 48,
                    overflow: 'hidden',
                  }}
                >
                  <span style={{ fontWeight: 600, flexShrink: 0, opacity: 0.95, whiteSpace: 'nowrap' }}>
                    段落#{userParaIdx}{userIsExcerpt ? ' 节选' : ''}
                  </span>
                  {userFormattedText && (
                    <>
                      <span style={{ opacity: 0.75, flexShrink: 0 }}>|</span>
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          opacity: 0.9,
                        }}
                      >
                        {userFormattedText}
                      </span>
                    </>
                  )}
                </div>
              </Tooltip>
            )}
            {/* 思路/推理链：采用标准的 collapsible={{ defaultCollapsed: true }} 属性配置 */}
            {item.thinking && (
              <>
                <ThoughtChain
                  style={{ marginBottom: 8 }}
                  collapsible={{ defaultCollapsed: true }}
                  items={[
                    {
                      title: item.isThinking ? (
                        <span style={{ color: '#6b7280', fontSize: 12 }}>思考中...</span>
                      ) : (
                        <span style={{ color: '#6b7280', fontSize: 12 }}>
                          {`已思考 ${item.thinkingSeconds || 3} 秒`}
                        </span>
                      ),
                      status: item.isThinking ? 'executing' : undefined,
                      icon: null,
                      content: item.thinking,
                      collapsible: true,
                      defaultCollapsed: true,
                    },
                  ]}
                />
                <div className="chat-thought-divider" />
              </>
            )}

            {/* 针对思考中状态使用 antd 标准 Spin 与骨架加载 */}
            {item.isThinking && !item.content ? (
              <div style={{ padding: '4px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: '#1677ff', fontSize: 13 }}>
                  <Spin size="small" />
                  <span>正在深度思考并生成回答...</span>
                </div>
                <Skeleton active paragraph={{ rows: 2 }} title={false} />
              </div>
            ) : (
              /* 官方 react-markdown 库解析 Markdown 内容 */
              <div className="react-markdown-body" style={{ fontSize: `${bodyFontSize}px`, lineHeight: 1.65, color: isUser ? '#ffffff' : '#1f2937' }}>
                <ReactMarkdown>{item.content || ''}</ReactMarkdown>
              </div>
            )}

            {/* 中断提示 */}
            {isInterrupted && (
              <div className="chat-interrupted-tag">⚠️ 生成已由用户中途停止</div>
            )}
          </div>
        ),
      }
    })
  }, [messages, bodyFontSize, onApplyText, activeSelection])

  if (!visible) return null

  return (
    <div className="chat-panel-sidebar">
      {/* 顶栏 */}
      <div className="chat-panel-header" style={{ background: 'var(--color-bgCard, #fafafa)' }}>
        <div className="chat-panel-header-left">
          <Tooltip title="新建对话">
            <Button
              type="text"
              icon={<PlusOutlined style={{ fontWeight: 'bold' }} />}
              onClick={handleCreateSession}
              style={{ fontWeight: 600, fontSize: 14 }}
            >
              新建对话
            </Button>
          </Tooltip>
        </div>

        <div className="chat-panel-header-right">
          <Tooltip title="历史会话列表">
            <Button
              type={conversationsOpen ? 'primary' : 'text'}
              icon={<HistoryOutlined />}
              onClick={() => setConversationsOpen((v) => !v)}
            />
          </Tooltip>
          <Button icon={<CloseOutlined />} type="text" onClick={onClose} />
        </div>
      </div>

      {/* @ant-design/x Conversations 历史会话抽屉 */}
      {conversationsOpen && (
        <div style={{ padding: '8px 12px', background: '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
          <Conversations
            items={conversationItems}
            activeKey={activeSessionId}
            onActiveChange={(key) => {
              setActiveSessionId(key)
              setConversationsOpen(false)
            }}
          />
        </div>
      )}

      {/* 消息列表区域：采用 @ant-design/x Bubble.List + autoScroll 自动滚动与视口保护 */}
      <div className="chat-messages-container">
        {messages.length === 0 && (
          <div style={{ padding: '24px 16px 16px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* 段落 AI 助手说明 */}
            <div style={{
              background: 'var(--color-bgCard, #ffffff)',
              border: '1px solid var(--color-border, #e5e7eb)',
              borderRadius: 12,
              padding: '16px 18px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
            }}>
              <div style={{ fontSize: `${bodyFontSize + 1}px`, fontWeight: 600, color: '#1e293b', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: `${bodyFontSize + 3}px` }}>💬</span> 段落 AI 助手
              </div>
              <div style={{ fontSize: `${bodyFontSize}px`, color: '#475569', lineHeight: 1.65 }}>
                点击任意段落，在顶部浮条中点击 <b>「问 AI」</b> 按钮，即可将整段文本带入助手侧栏，针对该段落内容进行提问、分析或润色。
              </div>
            </div>

            {/* 划选文本 AI 助手说明 */}
            <div style={{
              background: 'var(--color-bgCard, #ffffff)',
              border: '1px solid var(--color-border, #e5e7eb)',
              borderRadius: 12,
              padding: '16px 18px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
            }}>
              <div style={{ fontSize: `${bodyFontSize + 1}px`, fontWeight: 600, color: '#1e293b', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: `${bodyFontSize + 3}px` }}>✨</span> 划选文本 AI 助手
              </div>
              <div style={{ fontSize: `${bodyFontSize}px`, color: '#475569', lineHeight: 1.65 }}>
                鼠标拖拽划选正文中任意字句短语，在弹出的 AI 浮条中点击 <b>「问 AI」</b>、<b>「润色」</b> 或 <b>「提意见」</b>，即可附带选区上下文发起 AI 交互。
              </div>
            </div>
          </div>
        )}

        <Bubble.List
          autoScroll
          roles={{
            user: {
              placement: 'start',
              avatar: <Avatar size={38} style={{ backgroundColor: '#ffffff', color: '#d4a359', border: '2px solid #d4a359', fontWeight: 600 }}>我</Avatar>,
              styles: {
                content: {
                  backgroundColor: '#f3f4f6',
                  border: '1px solid #e5e7eb',
                  color: '#1f2937',
                },
              },
            },
            assistant: {
              placement: 'start',
              avatar: <Avatar size={40} src="/assistant-avatar.png" style={{ background: 'linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)', border: '1px solid #bae6fd' }} />,
              styles: {
                content: {
                  backgroundColor: '#fdfbf7',
                  border: '1px solid #e8e5de',
                  color: '#1f2937',
                },
              },
            },
          }}
          items={bubbleItems}
        />
      </div>

      {/* 底部 Sender 输入框区域 */}
      <div className="chat-panel-footer" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', padding: '8px 16px 12px 16px', border: 'none', borderTop: 'none', background: 'transparent', boxShadow: 'none' }}>
        {/* 选区/段落文字显示区：垂直位于对话框正上方，浅灰色背景 + 深灰色文字 */}
        {activeSelection && (
          <div
            style={{
              marginBottom: 8,
              padding: '8px 12px',
              borderRadius: 8,
              background: '#f1f5f9',
              border: '1px solid #e2e8f0',
              color: '#334155',
              fontSize: `${Math.max(12, bodyFontSize - 2)}px`,
              lineHeight: 1.5,
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <div
              style={{
                flex: 1,
                maxHeight: 72,
                overflowY: 'auto',
                wordBreak: 'break-word',
              }}
            >
              <span style={{ fontWeight: 600, color: '#1e293b', marginRight: 6 }}>
                段落 #{activeSelection.paragraphIdx}{activeSelection.isExcerpt ? ' 节选' : ''}
              </span>
              <span style={{ color: '#94a3b8', marginRight: 6 }}>|</span>
              <span>
                {activeSelection.formattedExcerpt || activeSelection.selectedText || ''}
              </span>
            </div>
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined style={{ fontSize: 11, color: '#64748b' }} />}
              onClick={onClearSelection}
              style={{ width: 22, height: 22, minWidth: 22, padding: 0, marginTop: 1 }}
            />
          </div>
        )}

        <Sender
          value={inputValue}
          onChange={(val) => setInputValue(val)}
          onSubmit={(val) => {
            handleSend(val)
            setInputValue('')
          }}
          onCancel={handleStop}
          loading={isRequesting}
          styles={{
            input: { fontSize: `${bodyFontSize}px` },
            actions: { alignSelf: 'center', display: 'flex', alignItems: 'center' },
          }}
          placeholder="问问 AI 助手，例如：“润色选中文字”..."
        />
      </div>
    </div>
  )
}
