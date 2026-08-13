import React, { useState } from 'react'
import { Modal, Tabs, Form, Input, Select, Button, Upload, Card, Row, Col, Space, Typography, Tag } from 'antd'
import {
  FileWordOutlined, EditOutlined, InboxOutlined, CompassOutlined,
  BookOutlined, ThunderboltOutlined, SolutionOutlined, RightOutlined
} from '@ant-design/icons'

const { Title, Paragraph, Text } = Typography
const { Option } = Select
const { TextArea } = Input

export const SYSTEM_PROMPT_PRESETS = [
  {
    id: 'action_hardcore',
    name: '硬核动作叙事风',
    desc: '句式紧凑，侧重动作切分、视听细节与环境声响，严禁修辞堆砌与翻译腔。',
    prompt: '你是一位注重硬核叙事与张力构建的合作写作者。请遵循以下要求：\n1. 句式尽量紧凑有力，减少多余的形容词堆砌。\n2. 侧重具体动作逻辑、环境视听细节（如声音、光影、材质）的精确刻画。\n3. 严禁出现翻译腔、说明书式叙述或干瘪的感叹。',
  },
  {
    id: 'psychological_flow',
    name: '细腻心理感官流',
    desc: '聚焦角色内心独白、五感沉浸体验与微妙的情感起伏变化。',
    prompt: '你是一位擅长情感心理与感官描写的合作写作者。请遵循以下要求：\n1. 深入刻画主角在事件中的微妙心理活动与内心独白。\n2. 融入丰富的五感细节（视觉、听觉、嗅觉、触觉、生理反应）。\n3. 表达自然真挚，展现细腻的心理张力。',
  },
  {
    id: 'fast_web_novel',
    name: '快节奏热血网文',
    desc: '节奏明快，剧情冲突集中，段落短小自然，期待感与悬念强。',
    prompt: '你是一位擅长快节奏通俗网文创作的合作写作者。请遵循以下要求：\n1. 节奏明快强劲，段落宜短小精悍（1-3句一断）。\n2. 聚焦核心情节冲突与角色反差，结尾留有悬念 hook。\n3. 对白贴合性格、生动有趣，富有期待感。',
  },
  {
    id: 'custom',
    name: '自定义专属文风',
    desc: '完全自由编写针对您作品特点的专用系统提示词。',
    prompt: '',
  },
]

export function CreateProjectModal({
  open,
  onCancel,
  onCreateBlank,
  onUploadCreate,
  loading,
}) {
  const [activeTab, setActiveTab] = useState('writing')
  const [form] = Form.useForm()
  const [fileList, setFileList] = useState([])
  const [selectedPreset, setSelectedPreset] = useState('action_hardcore')
  const [customPrompt, setCustomPrompt] = useState(SYSTEM_PROMPT_PRESETS[0].prompt)

  const handlePresetSelect = (presetId) => {
    setSelectedPreset(presetId)
    const preset = SYSTEM_PROMPT_PRESETS.find(p => p.id === presetId)
    if (preset && preset.id !== 'custom') {
      setCustomPrompt(preset.prompt)
    }
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (activeTab === 'writing') {
        await onCreateBlank?.({
          name: values.name,
          author_name: values.author_name,
          genre: values.genre,
          background_setting: values.background_setting,
          characters_summary: values.characters_summary,
          conflict_summary: values.conflict_summary,
          system_prompt: customPrompt,
          system_prompt_preset: selectedPreset,
        })
      } else {
        if (fileList.length === 0) {
          Modal.error({ title: '请选择要上传校对的 Word 文档 (.docx)' })
          return
        }
        await onUploadCreate?.({
          name: values.name || fileList[0].name.replace(/\.[^/.]+$/, ''),
          file: fileList[0].originFileObj || fileList[0],
        })
      }
      form.resetFields()
      setFileList([])
      onCancel?.()
    } catch (e) {
      // Form validation error
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      footer={null}
      width={780}
      centered
      destroyOnClose
      styles={{
        content: {
          padding: '28px 32px',
          borderRadius: 16,
          boxShadow: '0 20px 50px rgba(0,0,0,0.15)',
        },
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <Title level={4} style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#1f1f1f' }}>
          创建小说工程
        </Title>
        <Text style={{ fontSize: 13.5, color: '#666', marginTop: 4, display: 'inline-block' }}>
          选择适合您的创作或校对模式
        </Text>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        centered
        size="large"
        items={[
          {
            key: 'writing',
            label: (
              <span style={{ fontSize: 15, fontWeight: 600, padding: '0 8px' }}>
                <EditOutlined style={{ color: '#d4a359', marginRight: 6 }} />
                全新创作模式 (Writing Mode)
              </span>
            ),
          },
          {
            key: 'proofread',
            label: (
              <span style={{ fontSize: 15, fontWeight: 600, padding: '0 8px' }}>
                <FileWordOutlined style={{ color: '#722ed1', marginRight: 6 }} />
                导入 Word 校对模式 (Review Mode)
              </span>
            ),
          },
        ]}
      />

      <Form form={form} layout="vertical" style={{ marginTop: 18 }}>
        {activeTab === 'writing' ? (
          <div>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="name"
                  label={<span style={{ fontWeight: 600 }}>作品名称</span>}
                  rules={[{ required: true, message: '请输入作品名称' }]}
                >
                  <Input size="large" placeholder="例：《星海纪元》" style={{ borderRadius: 8 }} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="author_name" label={<span style={{ fontWeight: 600 }}>作者笔名</span>}>
                  <Input size="large" placeholder="例：西瓜少年" style={{ borderRadius: 8 }} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="genre" label={<span style={{ fontWeight: 600 }}>题材类型</span>}>
                  <Select size="large" placeholder="请选择" style={{ borderRadius: 8 }}>
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
              label={<span style={{ fontWeight: 600 }}><CompassOutlined style={{ marginRight: 6, color: '#d4a359' }} />作品世界观与故事背景</span>}
            >
              <TextArea
                rows={3}
                placeholder="简述作品背景环境、规则、时代特征（例：近未来 AI 觉醒时代的赛博朋克世界，人类旧程序员与超级 AI 警卫共存...）"
                style={{ borderRadius: 8, fontSize: 13.5 }}
              />
            </Form.Item>

            <Form.Item
              name="characters_summary"
              label={<span style={{ fontWeight: 600 }}><SolutionOutlined style={{ marginRight: 6, color: '#1890ff' }} />主要角色与核心剧情矛盾</span>}
            >
              <TextArea
                rows={2}
                placeholder="例：主角陆沉发现代码中藏有父亲遗言，面对强大 AI 警卫的追捕；女主苏晴为黑客盟友..."
                style={{ borderRadius: 8, fontSize: 13.5 }}
              />
            </Form.Item>

            <div style={{ marginTop: 14, padding: '16px 18px', background: '#fafafa', borderRadius: 12, border: '1px solid #f0f0f0' }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10, color: '#1f1f1f', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span><ThunderboltOutlined style={{ color: '#722ed1', marginRight: 6 }} />AI 系统提示词 (System Prompt Directive)</span>
                <Tag color="purple">独立文风指导</Tag>
              </div>

              <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
                {SYSTEM_PROMPT_PRESETS.map((preset) => {
                  const isSelected = selectedPreset === preset.id
                  return (
                    <Col span={6} key={preset.id}>
                      <div
                        onClick={() => handlePresetSelect(preset.id)}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 8,
                          border: isSelected ? '2px solid #722ed1' : '1px solid #e8e8e8',
                          background: isSelected ? '#f9f0ff' : '#fff',
                          cursor: 'pointer',
                          textAlign: 'center',
                          transition: 'all 0.2s',
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 600, color: isSelected ? '#722ed1' : '#333' }}>
                          {preset.name}
                        </div>
                      </div>
                    </Col>
                  )
                })}
              </Row>

              <TextArea
                rows={3}
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="请输入自定义系统提示词（指令定义 AI 伴随写作时的叙事偏好、文风要求与表达规范）"
                style={{ borderRadius: 8, fontSize: 13, background: '#fff' }}
              />
            </div>
          </div>
        ) : (
          <div>
            <Form.Item
              name="name"
              label={<span style={{ fontWeight: 600 }}>项目名称 (可选)</span>}
            >
              <Input size="large" placeholder="若留空则自动使用上传的文件名" style={{ borderRadius: 8 }} />
            </Form.Item>

            <Form.Item label={<span style={{ fontWeight: 600 }}>选择 Word 文档 (.docx)</span>} required>
              <Upload.Dragger
                beforeUpload={(file) => {
                  setFileList([file])
                  return false
                }}
                fileList={fileList}
                onRemove={() => setFileList([])}
                accept=".docx"
                maxCount={1}
                style={{ padding: '20px 0', borderRadius: 12, background: '#fafafa' }}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined style={{ color: '#722ed1', fontSize: 40 }} />
                </p>
                <p className="ant-upload-text" style={{ fontSize: 15, fontWeight: 600 }}>
                  点击或将 .docx 文件拖拽到此处上传
                </p>
                <p className="ant-upload-hint" style={{ color: '#8c8c8c' }}>
                  支持现有小说文稿导入，系统将自动解析章节与段落进行智能校对
                </p>
              </Upload.Dragger>
            </Form.Item>
          </div>
        )}

        <div style={{ marginTop: 24, textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <Button size="large" onClick={onCancel} style={{ borderRadius: 8, paddingInline: 24 }}>
            取消
          </Button>
          <Button
            type="primary"
            size="large"
            loading={loading}
            onClick={handleSubmit}
            style={{
              borderRadius: 8,
              paddingInline: 28,
              fontSize: 15,
              fontWeight: 600,
              background: activeTab === 'writing'
                ? 'linear-gradient(135deg, #d4a359 0%, #e6b973 100%)'
                : 'linear-gradient(135deg, #722ed1 0%, #9254de 100%)',
              borderColor: activeTab === 'writing' ? '#d4a359' : '#722ed1',
              boxShadow: activeTab === 'writing'
                ? '0 4px 12px rgba(212, 163, 89, 0.3)'
                : '0 4px 12px rgba(114, 46, 209, 0.3)',
            }}
          >
            {activeTab === 'writing' ? '开启创作画布' : '导入解析文档'} <RightOutlined style={{ fontSize: 12 }} />
          </Button>
        </div>
      </Form>
    </Modal>
  )
}
