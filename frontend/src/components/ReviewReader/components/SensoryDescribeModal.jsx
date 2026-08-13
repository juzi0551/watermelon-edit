import React, { useState, useEffect } from 'react'
import { Modal, Card, Button, Spin, Tag, Typography, message, Space, Radio } from 'antd'
import { EyeOutlined, SoundOutlined, BulbOutlined, ExperimentOutlined, CheckOutlined, ReloadOutlined } from '@ant-design/icons'
import { expandSensoryDetails } from '../../../services/api'

const { Title, Paragraph, Text } = Typography

export function SensoryDescribeModal({
  open,
  onCancel,
  projectId,
  selectedText,
  paragraphIdx,
  paragraphUuid,
  onReplaceText,
}) {
  const [loading, setLoading] = useState(false)
  const [options, setOptions] = useState([])
  const [sensoryMode, setSensoryMode] = useState('all')

  const fetchOptions = async () => {
    if (!projectId || !selectedText) return
    setLoading(true)
    try {
      const res = await expandSensoryDetails(projectId, {
        text: selectedText,
        sensoryMode: sensoryMode,
      })
      if (res.options) {
        setOptions(res.options)
      }
    } catch (e) {
      message.error('五感扩写生成失败：' + (e.message || '网络异常'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open && selectedText) {
      fetchOptions()
    }
  }, [open, selectedText, sensoryMode])


  const handleAdopt = (optionText) => {
    if (onReplaceText) {
      onReplaceText({
        originalText: selectedText,
        replacementText: optionText,
        paragraphIdx,
        paragraphUuid,
      })
      message.success('已应用五感扩写段落！')
      onCancel?.()
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      footer={null}
      width={780}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ExperimentOutlined style={{ color: '#722ed1', fontSize: 20 }} />
          <span style={{ fontSize: 18, fontWeight: 700 }}>AI 五感细节与描摹扩写 (Sensory Describe)</span>
        </div>
      }
      centered
      destroyOnClose
    >
      <div style={{ marginBottom: 16, padding: '12px 16px', background: '#f9f0ff', borderRadius: 10, border: '1px solid #efdbff' }}>
        <Text type="secondary" style={{ fontSize: 12.5 }}>划选的原始字句：</Text>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#3f1066', marginTop: 4 }}>
          “{selectedText}”
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Radio.Group value={sensoryMode} onChange={(e) => setSensoryMode(e.target.value)} buttonStyle="solid" size="small">
          <Radio.Button value="all">全五感综合</Radio.Button>
          <Radio.Button value="visual">视觉光影</Radio.Button>
          <Radio.Button value="auditory">听觉环境</Radio.Button>
          <Radio.Button value="psychological">心理生理</Radio.Button>
          <Radio.Button value="metaphor">修辞隐喻</Radio.Button>
        </Radio.Group>
        <Button icon={<ReloadOutlined />} onClick={fetchOptions} loading={loading} size="small">
          重新生成
        </Button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '50px 0' }}>
          <Spin size="large" />
          <div style={{ marginTop: 12, color: '#722ed1', fontWeight: 600 }}>正在灵感推演多维五感细节...</div>
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
              }}
              styles={{
                body: { padding: '14px 18px' },
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Tag color="purple" style={{ fontSize: 13, padding: '2px 10px', borderRadius: 12, fontWeight: 600 }}>
                  {opt.title || opt.mode}
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
