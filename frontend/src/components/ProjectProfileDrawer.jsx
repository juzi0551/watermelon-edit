import React, { useState, useEffect } from 'react'
import { Modal, Form, Input, Button, Space, Alert, message } from 'antd'
import { SaveOutlined, BookOutlined, UserOutlined } from '@ant-design/icons'
import { updateProjectProfile } from '../services/api'
import { useTheme } from '../App'

const { TextArea } = Input

export default function ProjectProfileDrawer({
  open,
  onClose,
  project,
  onProjectUpdated,
  bodyFontSize = 17,
}) {
  const { color } = useTheme()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  const subFontSize = Math.max(12, (bodyFontSize || 17) - 2)
  const isProfileEmpty = !project?.author_name?.trim() && !project?.author_intro?.trim() && !project?.background_setting?.trim()

  useEffect(() => {
    if (open && project) {
      form.setFieldsValue({
        author_name: project.author_name || '',
        author_intro: project.author_intro || '',
        background_setting: project.background_setting || '',
      })
    }
  }, [open, project, form])

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      const res = await updateProjectProfile(project.id, values)
      if (res.error) {
        message.error('保存失败：' + res.error)
      } else {
        message.success('设定已保存')
        onProjectUpdated?.()
        onClose?.()
      }
    } catch (e) {
      message.error('表单校验失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={
        <Space style={{ fontSize: subFontSize + 2, fontWeight: 600 }}>
          <BookOutlined style={{ color: color.primary }} />
          <span>作品设定与作者文风</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      width="min(880px, 94vw)"
      zIndex={1100}
      footer={null}
      destroyOnHidden
      styles={{
        content: {
          background: color.bgPage,
          color: color.textPrimary,
          padding: 24,
          borderRadius: 12,
          maxHeight: '85vh',
          overflowY: 'auto',
        },
        header: {
          background: 'transparent',
          color: color.textPrimary,
          marginBottom: 16,
        },
      }}
    >
      {isProfileEmpty && (
        <Alert
          type="warning"
          showIcon
          message={<span style={{ fontSize: subFontSize + 1, fontWeight: 600 }}>未配置作品设定与作者文风 Context</span>}
          description={<span style={{ fontSize: subFontSize, lineHeight: 1.6 }}>推荐补充作者笔名、文风特色（如半文半白、冷硬风格）及世界观专有名词（如门派、境界、神兵），大模型随文校对时将自动引入此 Context，有效防止将特色修辞误判为错字。</span>}
          style={{ marginBottom: 20, borderRadius: 8 }}
        />
      )}
      <Form form={form} layout="vertical">
        <Form.Item
          name="author_name"
          label={<span style={{ color: color.textPrimary, fontWeight: 500, fontSize: subFontSize + 1 }}><UserOutlined /> 作者名称 / 笔名</span>}
        >
          <Input
            placeholder="如：烽火戏诸侯 / 西瓜少年"
            style={{ fontSize: subFontSize, padding: '8px 12px' }}
          />
        </Form.Item>

        <Form.Item
          name="author_intro"
          label={<span style={{ color: color.textPrimary, fontWeight: 500, fontSize: subFontSize + 1 }}>✍️ 作者文风与语气设定</span>}
          extra={<span style={{ color: color.textTertiary, fontSize: Math.max(11, subFontSize - 1) }}>提示 LLM 校对时保留的语言特色，如“半文半白、节奏紧凑、偏向冷硬派暗黑风格”等</span>}
        >
          <TextArea
            rows={3}
            placeholder="说明你的写作风格与修辞偏好..."
            style={{ fontSize: subFontSize, padding: '8px 12px', lineHeight: 1.6 }}
          />
        </Form.Item>

        <Form.Item
          name="background_setting"
          label={<span style={{ color: color.textPrimary, fontWeight: 500, fontSize: subFontSize + 1 }}>🌌 世界观时代背景与专有名词设定</span>}
          extra={<span style={{ color: color.textTertiary, fontSize: Math.max(11, subFontSize - 1) }}>填入故事背景（如“修仙赛博朋克”、“大唐玄幻”），防止 LLM 将门派、神兵、官名误判为错字</span>}
        >
          <TextArea
            rows={6}
            placeholder="如：&#10;1. 时代背景：玄幻架空大唐；&#10;2. 境界划分：练气、筑基、金丹、元婴；&#10;3. 门派：青云剑宗、九幽天魔教。"
            style={{ fontSize: subFontSize, padding: '8px 12px', lineHeight: 1.6 }}
          />
        </Form.Item>

        <Button
          type="primary"
          block
          icon={<SaveOutlined />}
          loading={saving}
          onClick={handleSave}
          style={{ marginTop: 8, height: 'auto', padding: '10px 16px', fontSize: subFontSize + 1, fontWeight: 600 }}
        >
          保存设定
        </Button>
      </Form>
    </Modal>
  )
}
