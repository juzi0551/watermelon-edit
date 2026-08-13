import React, { useState, useEffect, useRef } from 'react'
import { Modal, Input, Button, Spin, Typography, message } from 'antd'
import { EditOutlined, ReloadOutlined, CheckOutlined, ThunderboltOutlined, ReadOutlined } from '@ant-design/icons'
import { tabAutocomplete } from '../../../services/api'

const { TextArea } = Input
const { Text } = Typography

export function TabAutocompleteModal({
  open,
  onCancel,
  projectId,
  selectedModel,
  precedingText,
  bodyFontSize = 18,
  onAdoptContinuation,
}) {
  const [loading, setLoading] = useState(false)
  const [fullText, setFullText] = useState('')
  const [displayedText, setDisplayedText] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [isClosing, setIsClosing] = useState(false)

  const timerRef = useRef(null)

  // 清除打字机定时器
  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  // 逐字渐显打字机效果 (Typewriter + Staggered Fade-in)
  const startTypewriter = (textToType) => {
    clearTimer()
    setDisplayedText('')
    setIsTyping(true)

    let idx = 0
    const speed = Math.max(10, Math.min(25, Math.floor(1200 / (textToType.length || 1))))

    timerRef.current = setInterval(() => {
      idx += 1
      setDisplayedText(textToType.slice(0, idx))
      if (idx >= textToType.length) {
        clearTimer()
        setIsTyping(false)
      }
    }, speed)
  }

  const fetchContinuation = async () => {
    if (!projectId || !precedingText) return
    setLoading(true)
    clearTimer()
    setIsClosing(false)

    try {
      const res = await tabAutocomplete(projectId, {
        precedingText,
        modelId: selectedModel,
      })
      if (res.continuation) {
        setFullText(res.continuation)
        startTypewriter(res.continuation)
      }
    } catch (e) {
      message.error('快捷续写生成失败：' + (e.message || '网络异常'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      fetchContinuation()
    } else {
      clearTimer()
      setFullText('')
      setDisplayedText('')
      setIsClosing(false)
    }
    return () => clearTimer()
  }, [open])

  const handleTextChange = (e) => {
    clearTimer()
    setIsTyping(false)
    setDisplayedText(e.target.value)
    setFullText(e.target.value)
  }

  const handleInsert = async () => {
    const finalText = displayedText.trim() || fullText.trim()
    if (!finalText) {
      message.warning('续写内容不能为空')
      return
    }

    setSubmitting(true)
    setIsClosing(true)

    try {
      await onAdoptContinuation?.(finalText)
      setTimeout(() => {
        onCancel?.()
      }, 300)
    } catch (e) {
      setIsClosing(false)
      message.error('插入失败：' + e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      footer={null}
      width={880}
      centered
      destroyOnClose
      styles={{
        content: {
          borderRadius: 20,
          background: 'linear-gradient(150deg, #ffffff 0%, #f7efff 50%, #e6f7ff 100%)',
          boxShadow: '0 24px 60px rgba(114, 46, 209, 0.2)',
          border: '1px solid rgba(146, 84, 222, 0.25)',
          padding: '28px 32px',
          opacity: isClosing ? 0 : 1,
          transform: isClosing ? 'scale(0.95) translateY(12px)' : 'scale(1) translateY(0)',
          transition: 'all 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
        },
      }}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              background: 'linear-gradient(135deg, #722ed1 0%, #1890ff 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 6px 16px rgba(114, 46, 209, 0.35)',
            }}
          >
            <ThunderboltOutlined style={{ color: '#fff', fontSize: 22 }} />
          </div>
          <div>
            <div style={{ fontSize: 19, fontWeight: 700, color: '#1a1a1a', letterSpacing: 0.5 }}>
              AI 快捷灵感续写 (Tab Autocomplete)
            </div>
            <Text type="secondary" style={{ fontSize: 13 }}>
              感知上文脉络与设定文风，实时流式逐字演绎连贯情节
            </Text>
          </div>
        </div>
      }
    >
      <style>{`
        @keyframes pulseGlow {
          0% { box-shadow: 0 0 0 0 rgba(114, 46, 209, 0.45); }
          70% { box-shadow: 0 0 0 14px rgba(114, 46, 209, 0); }
          100% { box-shadow: 0 0 0 0 rgba(114, 46, 209, 0); }
        }
        @keyframes blinkCursor {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        .blinking-caret {
          display: inline-block;
          width: 2px;
          height: 1.2em;
          background-color: #722ed1;
          margin-left: 2px;
          vertical-align: middle;
          animation: blinkCursor 0.8s infinite;
        }
      `}</style>

      {/* 上文参照语境卡片 */}
      <div
        style={{
          margin: '20px 0 16px',
          padding: '14px 18px',
          background: 'rgba(255, 255, 255, 0.85)',
          borderRadius: 14,
          border: '1px dashed #c084fc',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#722ed1', fontWeight: 600, marginBottom: 4 }}>
          <ReadOutlined /> 上文参照语境：
        </div>
        <div
          style={{
            fontSize: Math.max(13, bodyFontSize - 4),
            color: '#434343',
            lineHeight: 1.6,
            fontStyle: 'italic',
            maxHeight: 70,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          “...{precedingText?.slice(-220)}”
        </div>
      </div>

      {loading ? (
        <div
          style={{
            padding: '60px 0',
            textAlign: 'center',
            background: '#ffffff',
            borderRadius: 14,
            border: '1px solid #f0f0f0',
          }}
        >
          <Spin size="large" />
          <div
            style={{
              marginTop: 18,
              fontSize: 16,
              fontWeight: 600,
              color: '#722ed1',
              letterSpacing: 1,
            }}
          >
            正在汲取上文灵感，构思连贯剧情...
          </div>
          <Text type="secondary" style={{ fontSize: 13, display: 'block', marginTop: 6 }}>
            融合作品人物属性、语言风格指导与最新正文情节点中
          </Text>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#262626', display: 'flex', alignItems: 'center', gap: 6 }}>
              <EditOutlined style={{ color: '#1890ff' }} /> 续写正文草稿（字号已随正文匹配为 {bodyFontSize}px，可自由润色）：
            </span>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={fetchContinuation}
              loading={loading}
              style={{ borderRadius: 8, paddingInline: 12 }}
            >
              换一版续写
            </Button>
          </div>

          <div style={{ position: 'relative' }}>
            <TextArea
              value={displayedText}
              onChange={handleTextChange}
              autoSize={{ minRows: 6, maxRows: 12 }}
              placeholder="AI 正在为您逐字浮现续写内容..."
              style={{
                fontSize: bodyFontSize,
                lineHeight: 1.8,
                borderRadius: 12,
                borderColor: isTyping ? '#722ed1' : '#d9d9d9',
                padding: '16px 18px',
                background: '#ffffff',
                boxShadow: isTyping
                  ? '0 0 0 2px rgba(114, 46, 209, 0.15)'
                  : '0 4px 12px rgba(0,0,0,0.03)',
                color: '#1a1a1a',
                transition: 'all 0.2s',
              }}
            />
            {isTyping && <span className="blinking-caret" style={{ position: 'absolute', bottom: 20, right: 24 }} />}
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 14,

              marginTop: 24,
            }}
          >
            <Button onClick={onCancel} style={{ borderRadius: 10, height: 42, paddingInline: 20 }}>
              取消
            </Button>
            <Button
              type="primary"
              icon={<CheckOutlined />}
              onClick={handleInsert}
              loading={submitting}
              style={{
                borderRadius: 10,
                height: 44,
                paddingInline: 28,
                fontSize: 16,
                fontWeight: 600,
                background: 'linear-gradient(135deg, #722ed1 0%, #1890ff 100%)',
                borderColor: 'transparent',
                boxShadow: '0 6px 18px rgba(114, 46, 209, 0.4)',
                animation: 'pulseGlow 2s infinite',
              }}
            >
              填入正文 🚀
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
