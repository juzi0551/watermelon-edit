import React, { useState, useEffect } from 'react'
import { Card, Form, Input, Button, List, Tag, Typography, Space, message, Popconfirm } from 'antd'
import { KeyOutlined, CheckCircleOutlined, DeleteOutlined, SaveOutlined, ApiOutlined, ArrowLeftOutlined, EditOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { getProviders, saveApiKey, deleteApiKey, testApiKey, getPrompts, savePrompts } from '../services/api'

const { Text } = Typography
const { TextArea } = Input

export default function Settings() {
  const [providers, setProviders] = useState([])
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState(null)
  const [form] = Form.useForm()

  // system prompt state
  const [promptGeneral, setPromptGeneral] = useState('')
  const [promptProofread, setPromptProofread] = useState('')
  const [promptSaving, setPromptSaving] = useState(false)

  const navigate = useNavigate()

  const load = async () => {
    setLoading(true)
    try {
      const [providersData, promptsData] = await Promise.all([
        getProviders(),
        getPrompts(),
      ])
      setProviders(providersData)
      setPromptGeneral(promptsData.system_prompt_general)
      setPromptProofread(promptsData.system_prompt_proofread)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleSave = async (providerId) => {
    const values = await form.validateFields()
    const key = values[`key_${providerId}`]
    if (!key || !key.trim()) return
    const res = await saveApiKey(providerId, key.trim())
    if (res.error) {
      message.error(res.error)
    } else {
      message.success(`${providerId} API Key 已保存`)
      form.setFieldsValue({ [`key_${providerId}`]: '' })
      load()
    }
  }

  const handleDelete = async (providerId) => {
    await deleteApiKey(providerId)
    message.success(`${providerId} API Key 已删除`)
    load()
  }

  const handleTest = async (modelId) => {
    setTesting(modelId)
    try {
      const res = await testApiKey(modelId)
      if (res.ok) message.success(`${modelId}：${res.message}`)
      else message.error(`${modelId}：${res.message}`)
    } finally {
      setTesting(null)
    }
  }

  return (
    <div>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')} style={{ marginBottom: 16 }}>
        返回项目列表
      </Button>

      <Card title={<Space><KeyOutlined /> API Key 配置</Space>}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          按服务商配置 API Key（同一个服务商的模型共用一个 Key）。Key 加密存储在本地（backend/app/data/api_keys.json），不会上传到任何服务器。
          DeepSeek 为 OpenAI 兼容接口（base_url: https://api.deepseek.com）。
        </Text>

        <List
          loading={loading}
          dataSource={providers}
          renderItem={(p) => (
            <List.Item
              actions={
                p.configured ? [
                  <Popconfirm
                    key="delete"
                    title={`确定删除 ${p.name} 的 API Key？`}
                    onConfirm={() => handleDelete(p.provider)}
                  >
                    <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
                  </Popconfirm>,
                ] : []
              }
            >
              <List.Item.Meta
                title={
                  <Space>
                    <Text strong>{p.name}</Text>
                    {p.configured ? (
                      <Tag color="success" icon={<CheckCircleOutlined />}>已配置</Tag>
                    ) : (
                      <Tag color="warning">未配置</Tag>
                    )}
                  </Space>
                }
                description={
                  <div>
                    {p.configured && (
                      <div style={{ marginBottom: 8 }}>
                        <Text type="secondary">当前 Key：{p.masked_key}</Text>
                      </div>
                    )}
                    <Form form={form} layout="inline">
                      <Form.Item name={`key_${p.provider}`} noStyle>
                        <Input.Password
                          placeholder={p.configured ? '输入新 Key 覆盖' : '粘贴 API Key'}
                          style={{ width: 360 }}
                          onPressEnter={() => handleSave(p.provider)}
                        />
                      </Form.Item>
                      <Form.Item noStyle>
                        <Button type="primary" shape="round" icon={<SaveOutlined />} onClick={() => handleSave(p.provider)}>
                          保存
                        </Button>
                      </Form.Item>
                    </Form>
                    <div style={{ marginTop: 10 }}>
                      {p.models.map((m) => (
                        <Tag
                          key={m.id}
                          color={m.deprecated ? 'red' : 'default'}
                          style={{ marginBottom: 6 }}
                        >
                          {m.name}
                          {p.configured && (
                            <Button
                              type="link"
                              size="small"
                              icon={<ApiOutlined />}
                              loading={testing === m.id}
                              onClick={() => handleTest(m.id)}
                              style={{ padding: '0 4px' }}
                            >
                              测试
                            </Button>
                          )}
                        </Tag>
                      ))}
                    </div>
                  </div>
                }
              />
            </List.Item>
          )}
        />
      </Card>

      <Card title={<Space><EditOutlined /> 系统提示词</Space>} style={{ marginTop: 16 }}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          自定义发送给大模型的 system prompt。{'{type_desc}'} 会被替换为错误类型列表（错别字、语法错误等）。
          修改后重启校对才会生效。
        </Text>

        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ display: 'block', marginBottom: 4 }}>通用提示词</Text>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
            未指定校对指令时使用的默认 system prompt。
          </Text>
          <TextArea
            rows={3}
            value={promptGeneral}
            onChange={(e) => setPromptGeneral(e.target.value)}
            placeholder="通用 system prompt"
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ display: 'block', marginBottom: 4 }}>校对指令模板</Text>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
            校对的 system prompt，{'{type_desc}'} 会被自动替换。
          </Text>
          <TextArea
            rows={15}
            value={promptProofread}
            onChange={(e) => setPromptProofread(e.target.value)}
            placeholder="校对指令模板"
          />
        </div>

        <Button
          type="primary"
          shape="round"
          icon={<SaveOutlined />}
          loading={promptSaving}
          onClick={async () => {
            setPromptSaving(true)
            try {
              await savePrompts(promptGeneral, promptProofread)
              message.success('系统提示词已保存')
            } catch {
              message.error('保存失败')
            } finally {
              setPromptSaving(false)
            }
          }}
        >
          保存提示词
        </Button>
      </Card>
    </div>
  )
}
