import React, { useState, useEffect } from 'react'
import { Drawer, Form, Input, Select, Button, Tag, Row, Col, Space, Typography, message, Divider } from 'antd'
import { CompassOutlined, SolutionOutlined, ThunderboltOutlined, SaveOutlined } from '@ant-design/icons'
import { updateProjectProfile } from '../../../services/api'
import { SYSTEM_PROMPT_PRESETS } from '../../CreateProjectModal'

const { Title, Text } = Typography
const { Option } = Select
const { TextArea } = Input

export function StoryProfileDrawer({
  open,
  onClose,
  projectId,
  projectData,
  onProfileUpdated,
}) {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState('action_hardcore')
  const [systemPromptText, setSystemPromptText] = useState('')

  useEffect(() => {
    if (open && projectData) {
      form.setFieldsValue({
        author_name: projectData.author_name || '',
        genre: projectData.genre || '',
        background_setting: projectData.background_setting || '',
        characters_summary: projectData.characters_summary || '',
        conflict_summary: projectData.conflict_summary || '',
      })
      const preset = projectData.system_prompt_preset || 'action_hardcore'
      setSelectedPreset(preset)
      setSystemPromptText(projectData.system_prompt || SYSTEM_PROMPT_PRESETS[0].prompt)
    }
  }, [open, projectData, form])

  const handlePresetSelect = (presetId) => {
    setSelectedPreset(presetId)
    const preset = SYSTEM_PROMPT_PRESETS.find(p => p.id === presetId)
    if (preset && preset.id !== 'custom') {
      setSystemPromptText(preset.prompt)
    }
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      setLoading(true)
      await updateProjectProfile(projectId, {
        author_name: values.author_name,
        genre: values.genre,
        background_setting: values.background_setting,
        characters_summary: values.characters_summary,
        conflict_summary: values.conflict_summary,
        system_prompt: systemPromptText,
        system_prompt_preset: selectedPreset,
      })
      message.success('作品设定与系统提示词已成功更新！')
      onProfileUpdated?.()
      onClose?.()
    } catch (e) {
      message.error('保存失败：' + (e.message || '系统异常'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CompassOutlined style={{ color: '#d4a359', fontSize: 20 }} />
          <span style={{ fontWeight: 700, fontSize: 17 }}>作品设定与 AI 系统提示词</span>
        </div>
      }
      placement="right"
      width={560}
      onClose={onClose}
      open={open}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="author_name" label={<span style={{ fontWeight: 600 }}>作者笔名</span>}>
              <Input placeholder="笔名" style={{ borderRadius: 8 }} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="genre" label={<span style={{ fontWeight: 600 }}>题材类型</span>}>
              <Select placeholder="请选择" style={{ borderRadius: 8 }}>
                <Option value="科幻">科幻小说</Option>
                <Option value="玄幻">玄幻修真</Option>
                <Option value="都市">都市异能</Option>
                <Option value="悬疑">悬疑推理</Option>
                <Option value="历史">历史军事</Option>
                <Option value="奇幻">奇幻史诗</Option>
                <Option value="其它">其它文学</Option>
              </Select>
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          name="background_setting"
          label={<span style={{ fontWeight: 600 }}><CompassOutlined style={{ marginRight: 6, color: '#d4a359' }} />作品世界观与背景设定</span>}
        >
          <TextArea rows={4} placeholder="故事发生的年代、环境规则、特殊能力与地理环境背景..." style={{ borderRadius: 8, fontSize: 13.5 }} />
        </Form.Item>

        <Form.Item
          name="characters_summary"
          label={<span style={{ fontWeight: 600 }}><SolutionOutlined style={{ marginRight: 6, color: '#1890ff' }} />主要角色人设档案</span>}
        >
          <TextArea rows={3} placeholder="主角与核心配角的名字、性格特点与代表能力..." style={{ borderRadius: 8, fontSize: 13.5 }} />
        </Form.Item>

        <Form.Item
          name="conflict_summary"
          label={<span style={{ fontWeight: 600 }}><SolutionOutlined style={{ marginRight: 6, color: '#ff4d4f' }} />核心剧情矛盾与悬念</span>}
        >
          <TextArea rows={2} placeholder="故事推进的核心动力与宿命冲突..." style={{ borderRadius: 8, fontSize: 13.5 }} />
        </Form.Item>

        <Divider style={{ margin: '16px 0' }} />

        <div style={{ padding: '16px 18px', background: '#fafafa', borderRadius: 12, border: '1px solid #f0f0f0' }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10, color: '#1f1f1f', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span><ThunderboltOutlined style={{ color: '#722ed1', marginRight: 6 }} />AI 系统提示词 (System Prompt)</span>
            <Tag color="purple">独立文风指导</Tag>
          </div>

          <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
            {SYSTEM_PROMPT_PRESETS.map((preset) => {
              const isSelected = selectedPreset === preset.id
              return (
                <Col span={6} key={preset.id}>
                  <div
                    onClick={() => handlePresetSelect(preset.id)}
                    style={{
                      padding: '8px 6px',
                      borderRadius: 6,
                      border: isSelected ? '2px solid #722ed1' : '1px solid #e8e8e8',
                      background: isSelected ? '#f9f0ff' : '#fff',
                      cursor: 'pointer',
                      textAlign: 'center',
                      fontSize: 12,
                      fontWeight: 600,
                      color: isSelected ? '#722ed1' : '#333',
                    }}
                  >
                    {preset.name}
                  </div>
                </Col>
              )
            })}
          </Row>

          <TextArea
            rows={4}
            value={systemPromptText}
            onChange={(e) => setSystemPromptText(e.target.value)}
            placeholder="独立系统的提示词，直接决定 AI 写作时的语言习惯、叙事节奏与表达禁忌..."
            style={{ borderRadius: 8, fontSize: 13, background: '#fff' }}
          />
        </div>

        <div style={{ marginTop: 24, textAlign: 'right' }}>
          <Button
            type="primary"
            size="large"
            icon={<SaveOutlined />}
            loading={loading}
            onClick={handleSave}
            style={{
              borderRadius: 8,
              paddingInline: 28,
              fontSize: 15,
              fontWeight: 600,
              background: 'linear-gradient(135deg, #d4a359 0%, #b88230 100%)',
              borderColor: '#d4a359',
            }}
          >
            保存修改
          </Button>
        </div>
      </Form>
    </Drawer>
  )
}
