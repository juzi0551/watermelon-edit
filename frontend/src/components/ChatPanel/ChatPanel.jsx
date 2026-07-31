import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Button, Select, Tooltip, Popconfirm, message as antMessage, Tag, Avatar } from 'antd'
import {
  CloseOutlined,
  PlusOutlined,
  DeleteOutlined,
  MessageOutlined,
  CheckCircleOutlined,
  HistoryOutlined,
  RobotOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Bubble, Sender, ThoughtChain, Conversations } from '@ant-design/x'
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
}) {
  const [width, setWidth] = useState(380)
  const [isDragging, setIsDragging] = useState(false)

  // 模型列表状态 (与 Top Bar ActionBar 完全一致)
  const [models, setModels] = useState([])
  const [selectedModel, setSelectedModel] = useState(null)

  // 会话列表状态
  const [sessions, setSessions] = useState([])
  const [activeSessionId, setActiveSessionId] = useState(null)
  const [conversationsOpen, setConversationsOpen] = useState(false)

  // 消息滚动引用与 AbortController
  const messagesEndRef = useRef(null)
  const abortControllerRef = useRef(null)

  // 1. 加载模型列表 (100% 对齐 Top Bar ActionBar 逻辑)
  useEffect(() => {
    if (!projectId || !visible) return

    getModels()
      .then((mList) => {
        if (Array.isArray(mList)) {
          setModels(mList)
          if (mList.length > 0 && !selectedModel) {
            setSelectedModel(mList[0].model_id)
          }
        }
      })
      .catch((err) => console.error('加载模型列表失败:', err))

    loadSessions()
  }, [projectId, visible])

  // 转换模型列表为与 Bar 完全一致的 Options (`${m.provider_name || m.provider} · ${m.name}`)
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

  const handleSend = async (userText) => {
    if (!userText || !userText.trim() || isRequesting) return

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
    }

    const assistantMsgId = `temp_a_${Date.now()}`
    const assistantMsg = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      thinking: '',
      isThinking: true,
    }

    setMessages((prev) => [...prev, userMsg, assistantMsg])
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
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content,
                    thinking,
                    isThinking,
                    interrupted,
                    context: interrupted ? { ...(m.context || {}), interrupted: true } : m.context,
                  }
                : m
            )
          )
        },
        onSuccess: ({ content, thinking, messageId }) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    id: messageId || m.id,
                    content,
                    thinking,
                    isThinking: false,
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

  // 4. 切换会话时，异步同步后端历史消息
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
        context: m.context,
      }))
      setMessages(formatted)
    } catch (err) {
      console.error('加载历史消息失败:', err)
    }
  }

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isRequesting])

  // 5. 鼠标拖拽调宽 (320px ~ 720px)
  const handleMouseDown = (e) => {
    e.preventDefault()
    setIsDragging(true)
    const startX = e.clientX
    const startWidth = width

    const handleMouseMove = (moveEvent) => {
      const deltaX = startX - moveEvent.clientX
      const newWidth = Math.min(Math.max(startWidth + deltaX, 320), 720)
      setWidth(newWidth)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
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

  if (!visible) return null

  return (
    <div className="chat-panel-sidebar" style={{ width: `${width}px` }}>
      <div
        className={`chat-panel-drag-handle ${isDragging ? 'dragging' : ''}`}
        onMouseDown={handleMouseDown}
      />

      <div className="chat-panel-header">
        <div className="chat-panel-header-left">
          <Tooltip title="历史会话列表">
            <Button
              type={conversationsOpen ? 'primary' : 'text'}
              icon={<HistoryOutlined />}
              onClick={() => setConversationsOpen((v) => !v)}
            />
          </Tooltip>

          <Select
            value={selectedModel}
            onChange={setSelectedModel}
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

      {activeSelection && (
        <div className="chat-context-banner">
          <span className="chat-context-text">
            📍 选区：段落 #{activeSelection.paragraphIdx}{' '}
            {activeSelection.selectedText ? `("${activeSelection.selectedText}")` : ''}
          </span>
          <Button
            size="small"
            type="text"
            icon={<CloseOutlined />}
            onClick={onClearSelection}
          />
        </div>
      )}

      <div className="chat-messages-container">
        {messages.map((item) => {
          const isUser = item.role === 'user'
          const isInterrupted = item.context?.interrupted || item.interrupted

          return (
            <Bubble
              key={item.id || item.key}
              placement={isUser ? 'right' : 'left'}
              avatar={
                isUser ? (
                  <Avatar style={{ backgroundColor: '#87d068' }}>我</Avatar>
                ) : (
                  <Avatar style={{ backgroundColor: '#1677ff' }} icon={<RobotOutlined />} />
                )
              }
              content={
                <div>
                  {item.thinking && (
                    <ThoughtChain
                      style={{ marginBottom: 8 }}
                      items={[
                        {
                          title: '思考过程',
                          status: item.isThinking ? 'executing' : 'success',
                          content: item.thinking,
                        },
                      ]}
                    />
                  )}

                  <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {item.content || (item.isThinking ? '正在思考中...' : '')}
                  </div>

                  {!isUser && item.content && onApplyText && !isInterrupted && (
                    <Button
                      size="small"
                      type="dashed"
                      icon={<CheckCircleOutlined />}
                      className="chat-apply-btn"
                      onClick={() =>
                        onApplyText(
                          item.content,
                          activeSelection?.paragraphIdx,
                          activeSelection?.paragraphUuid
                        )
                      }
                    >
                      替换至选区/当前段落
                    </Button>
                  )}

                  {isInterrupted && (
                    <div className="chat-interrupted-tag">⚠️ 生成已由用户中途停止</div>
                  )}
                </div>
              }
            />
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-panel-footer">
        <Sender
          onSubmit={handleSend}
          onCancel={handleStop}
          loading={isRequesting}
          placeholder="问问 AI 助手，例如：“润色选中文字”..."
        />
      </div>
    </div>
  )
}
