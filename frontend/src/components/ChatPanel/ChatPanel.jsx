import React, { useState, useEffect, useRef, useMemo } from 'react'
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
import './ChatPanel.css'

export default function ChatPanel({
  projectId,
  visible,
  onClose,
  activeSelection,
  onClearSelection,
  onApplyText,
  bodyFontSize = 17,
}) {
  // 模型选择持久化记忆
  const [models, setModels] = useState([])
  const [selectedModel, setSelectedModel] = useState(() => {
    return localStorage.getItem('chat_selected_model') || null
  })

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
            setSelectedModel(savedModel)
          } else if (mList.length > 0) {
            setSelectedModel(mList[0].model_id)
          }
        }
      })
      .catch((err) => console.error('加载模型列表失败:', err))

    loadSessions()
  }, [projectId, visible])

  const handleModelChange = (val) => {
    setSelectedModel(val)
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

  const handleSend = async (userText) => {
    const textToSend = userText || inputValue
    if (!textToSend || !textToSend.trim() || isRequesting) return

    setInputValue('')
    setIsRequesting(true)
    const contextPayload = activeSelection
      ? {
          selected_text: activeSelection.selectedText,
          paragraph_idx: activeSelection.paragraphIdx,
          paragraph_uuid: activeSelection.paragraphUuid,
          paragraph_end_idx: activeSelection.paragraphEndIdx,
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
        onUpdate: ({ content, thinking, isThinking, interrupted }) => {
          const elapsed = Math.max(1, Math.round((Date.now() - thinkingStartTime) / 1000))
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content,
                    thinking,
                    isThinking,
                    thinkingSeconds: elapsed,
                    interrupted,
                    context: interrupted ? { ...(m.context || {}), interrupted: true } : m.context,
                  }
                : m
            )
          )
        },
        onSuccess: ({ content, thinking, messageId }) => {
          const elapsed = Math.max(1, Math.round((Date.now() - thinkingStartTime) / 1000))
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    id: messageId || m.id,
                    content,
                    thinking,
                    isThinking: false,
                    thinkingSeconds: elapsed,
                  }
                : m
            )
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
      console.error(err)
    } finally {
      setIsRequesting(false)
    }
  }

  // 4. 切换会话时异步同步历史消息
  useEffect(() => {
    if (!projectId || !activeSessionId || !visible) return
    loadMessages(activeSessionId)
  }, [projectId, activeSessionId, visible])

  const loadMessages = async (sessionId) => {
    try {
      const historyMsgs = await listChatMessages(projectId, sessionId)
      const formatted = (historyMsgs || []).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        thinking: m.thinking || m.context?.thinking || '',
        context: m.context,
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

  // 转换为 @ant-design/x Conversations 所需 items
  const conversationItems = useMemo(() => {
    return sessions.map((s) => ({
      key: s.id,
      label: s.title || '新对话',
      icon: <MessageOutlined />,
    }))
  }, [sessions])

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
      const isSameRoleAsPrev = prevItem && prevItem.role === item.role
      const isFirstInGroup = !isSameRoleAsPrev

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
            <Avatar size={57} style={{ backgroundColor: '#d4a359', color: '#ffffff', fontSize: 24 }} icon={<RobotOutlined />} />
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
        content: (
          <div>
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
      <div className="chat-panel-header">
        <div className="chat-panel-header-left">
          <Tooltip title="历史会话列表">
            <Button
              type={conversationsOpen ? 'primary' : 'text'}
              icon={<HistoryOutlined />}
              onClick={() => setConversationsOpen((v) => !v)}
            />
          </Tooltip>

          {/* 模型下拉选择框 */}
          <Select
            value={selectedModel}
            onChange={handleModelChange}
            style={{ width: 170 }}
            popupMatchSelectWidth={false}
            placeholder="选择 AI 模型"
            options={modelOptions}
          />

          <Tooltip title="新建对话">
            <Button icon={<PlusOutlined />} type="text" onClick={handleCreateSession} />
          </Tooltip>
        </div>

        <div className="chat-panel-header-right">
          {activeSessionId && (
            <Popconfirm
              title="确定删除此对话？"
              onConfirm={() => handleDeleteSession(activeSessionId)}
              okText="删除"
              cancelText="取消"
            >
              <Button icon={<DeleteOutlined />} type="text" danger />
            </Popconfirm>
          )}
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

      {/* 选区上下文提示 Banner：采用 antd 标准 Alert 组件 */}
      {activeSelection && (
        <Alert
          type="info"
          showIcon
          closable
          onClose={onClearSelection}
          message={`📍 选区：段落 #${activeSelection.paragraphIdx} ${activeSelection.selectedText ? `("${activeSelection.selectedText}")` : ''}`}
          style={{ margin: '8px 12px 0 12px', fontSize: 12 }}
        />
      )}

      {/* 消息列表区域：采用 @ant-design/x Bubble.List + autoScroll 自动滚动与视口保护 */}
      <div className="chat-messages-container">
        {messages.length === 0 && (
          <div style={{ padding: '24px 8px 12px 8px' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#4b5563', marginBottom: 12 }}>
              💡 快捷提问指令
            </div>
            <Prompts
              items={promptItems}
              onItemClick={(item) => handleSend(item.description)}
            />
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
              avatar: <Avatar size={38} style={{ backgroundColor: '#d4a359', color: '#ffffff' }} icon={<RobotOutlined />} />,
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

      {/* 底部 Sender 输入框 */}
      <div className="chat-panel-footer" style={{ border: 'none', borderTop: 'none', background: 'transparent', boxShadow: 'none' }}>
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
