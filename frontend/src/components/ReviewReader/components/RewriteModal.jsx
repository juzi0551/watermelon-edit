import React, { useState, useEffect } from 'react'
import { Modal, Card, Button, Spin, Tag, Typography, message, Space } from 'antd'
import { EditOutlined, ReloadOutlined, CheckOutlined, FormatPainterOutlined } from '@ant-design/icons'

import { rewriteText } from '../../../services/api'

const { Paragraph, Text } = Typography

export function RewriteModal({
  open,
  onCancel,
  projectId,
  selectedText,
  paragraphIdx,
  paragraphUuid,
  onReplaceText,
  selectedModel,
}) {
  const [loading, setLoading] = useState(false)
  const [options, setOptions] = useState([])

  const fetchRewriteOptions = async () => {
    if (!projectId || !selectedText) return
    setLoading(true)
    try {
      const res = await rewriteText(projectId, {
        text: selectedText,
        modelId: selectedModel,
      })
      if (res.options) {
        setOptions(res.options)
      }
    } catch (e) {
      message.error('润色重写推演失败：' + (e.message || '网络异常'))
    } finally {
      setLoading(false)
    }
  }


  useEffect(() => {
    if (open && selectedText) {
      fetchRewriteOptions()
    }
  }, [open, selectedText])

  const handleAdopt = (optionText) => {
    if (onReplaceText) {
      onReplaceText({
        originalText: selectedText,
        replacementText: optionText,
        paragraphIdx,
        paragraphUuid,
      })
      message.success('已采纳润色重写！')
      onCancel?.()
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      footer={null}
      width={760}
      centered
      destroyOnClose
      styles={{
        content: {
          borderRadius: 16,
          background: 'linear-gradient(145deg, #ffffff 0%, #f4f0ff 100%)',
          boxShadow: '0 20px 40px rgba(114, 46, 209, 0.15)',
          border: '1px solid #efdbff',
          padding: '24px 28px',
        },
      }}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #722ed1 0%, #1890ff 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(114, 46, 209, 0.3)',
            }}
          >
            <FormatPainterOutlined style={{ color: '#fff', fontSize: 18 }} />

          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#262626' }}>
              AI 润色与重写 (Style Rewrite)
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              针对划选字句雕琢修辞语气，提供 3 种文风替换方案
            </Text>
          </div>
        </div>
      }
    >
      <div style={{ marginBottom: 16, padding: '12px 16px', background: 'rgba(255,255,255,0.85)', borderRadius: 10, border: '1px dashed #d3ade6' }}>
        <Text type="secondary" style={{ fontSize: 12.5 }}>划选的原始字句：</Text>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#3f1066', marginTop: 4 }}>
          “{selectedText}”
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <Button icon={<ReloadOutlined />} onClick={fetchRewriteOptions} loading={loading} size="small" style={{ borderRadius: 6 }}>
          重新推演方案
        </Button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '50px 0', background: '#fff', borderRadius: 12 }}>
          <Spin size="large" />
          <div style={{ marginTop: 14, color: '#722ed1', fontWeight: 600 }}>正在精细雕琢文风与语言语气...</div>
        </div>
      ) : (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          {options.map((opt, i) => (
            <Card
              key={i}
              size="small"
              style={{
                borderRadius: 10,
                border: '1px solid #e8e8e8',
                boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
                background: '#ffffff',
              }}
              styles={{
                body: { padding: '14px 18px' },
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Tag color="purple" style={{ fontSize: 13, padding: '2px 10px', borderRadius: 12, fontWeight: 600 }}>
                  {opt.style}
                </Tag>
                <Button
                  type="primary"
                  size="small"
                  icon={<CheckOutlined />}
                  onClick={() => handleAdopt(opt.text)}
                  style={{
                    borderRadius: 6,
                    background: 'linear-gradient(135deg, #722ed1 0%, #9254de 100%)',
                    borderColor: '#722ed1',
                  }}
                >
                  采纳替换
                </Button>
              </div>
              <Paragraph style={{ margin: 0, fontSize: 14.5, lineHeight: 1.7, color: '#262626' }}>
                {opt.text}
              </Paragraph>
            </Card>
          ))}
        </Space>
      )}
    </Modal>
  )
}
