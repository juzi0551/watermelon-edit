import React, { useState, useEffect } from 'react'
import { Card, Form, Input, InputNumber, Button, List, Tag, Typography, Space, message, Popconfirm, Modal, Tabs, Select } from 'antd'
import {
  KeyOutlined, CheckCircleOutlined, DeleteOutlined, SaveOutlined,
  ApiOutlined, ArrowLeftOutlined, EditOutlined, ThunderboltOutlined,
  UndoOutlined, PlusOutlined, CloseCircleOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import {
  getProviders, saveApiKey, deleteApiKey, testApiKey,
  getPrompts, savePrompts, resetPrompts,
  addProvider, deleteProvider, addModel, deleteModel
} from '../services/api'

const { Text } = Typography
const { TextArea } = Input

import { LockOutlined, LogoutOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { useAuth } from '../context/AuthContext'
import ChangePasswordModal from '../components/Auth/ChangePasswordModal'

export default function Settings() {
  const { defaultUsername, logout } = useAuth()
  const [changePwdOpen, setChangePwdOpen] = useState(false)
  const [providers, setProviders] = useState([])
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState(null)
  const [form] = Form.useForm()
  const [addProviderForm] = Form.useForm()
  const [addModelForm] = Form.useForm()

  // Modal states
  const [addProviderModalOpen, setAddProviderModalOpen] = useState(false)
  const [addProviderSubmitting, setAddProviderSubmitting] = useState(false)
  const [addModelModalOpen, setAddModelModalOpen] = useState(false)
  const [addModelSubmitting, setAddModelSubmitting] = useState(false)

  // system prompt state
  const [promptProofread, setPromptProofread] = useState('')
  const [promptSaving, setPromptSaving] = useState(false)
  const [resetting, setResetting] = useState(false)

  // batch concurrency & window size state
  const [batchMaxConcurrent, setBatchMaxConcurrent] = useState(2)
  const [proofreadWindowSize, setProofreadWindowSize] = useState(30)
  const [batchSaving, setBatchSaving] = useState(false)

  const navigate = useNavigate()

  const load = async () => {
    setLoading(true)
    try {
      const [providersData, promptsData] = await Promise.all([
        getProviders(),
        getPrompts(),
      ])
      setProviders(providersData)
      setPromptProofread(promptsData.system_prompt_proofread)
      setBatchMaxConcurrent(promptsData.batch_max_concurrent || 2)
      setProofreadWindowSize(promptsData.proofread_window_size || 30)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleSave = async (providerId, opts = {}) => {
    const values = await form.validateFields()
    const key = values[`key_${providerId}`]
    const acct = values[`acct_${providerId}`]
    const provider = providers.find(p => p.provider === providerId)

    if (opts.onlyAccountId) {
      if (!acct || !acct.trim()) return
      const res = await saveApiKey(providerId, null, acct.trim())
      if (res.error) {
        message.error(res.error)
      } else {
        message.success('Account ID 已保存')
        form.setFieldsValue({ [`acct_${providerId}`]: '' })
        load()
      }
      return
    }

    if (!key || !key.trim()) return
    const res = await saveApiKey(providerId, key.trim(), acct)
    if (res.error) {
      message.error(res.error)
    } else {
      message.success(`${provider?.name || providerId} 配置已保存`)
      form.setFieldsValue({ [`key_${providerId}`]: '' })
      load()
    }
  }

  const handleDelete = async (providerId) => {
    await deleteApiKey(providerId)
    message.success(`${providerId} API Key 已删除`)
    load()
  }

  const handleDeleteCustomProvider = async (providerId, providerName) => {
    const res = await deleteProvider(providerId)
    if (res.error) {
      message.error(res.error)
    } else {
      message.success(`已删除服务商: ${providerName}`)
      load()
    }
  }

  const handleDeleteCustomModel = (providerId, modelId, modelName) => {
    Modal.confirm({
      title: `确认删除模型 "${modelName}"？`,
      content: `模型 ID: ${modelId}`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        const res = await deleteModel(providerId, modelId)
        if (res.error) {
          message.error(res.error)
        } else {
          message.success(`模型 "${modelName}" 已删除`)
          load()
        }
      },
    })
  }

  const handleAddProviderSubmit = async () => {
    try {
      const values = await addProviderForm.validateFields()
      setAddProviderSubmitting(true)
      const res = await addProvider(values)
      if (res.error) {
        message.error(res.error)
      } else {
        message.success(`已成功添加服务商: ${values.name}`)
        setAddProviderModalOpen(false)
        addProviderForm.resetFields()
        load()
      }
    } catch (e) {
      // form validate failure
    } finally {
      setAddProviderSubmitting(false)
    }
  }

  const handleAddModelSubmit = async () => {
    try {
      const values = await addModelForm.validateFields()
      setAddModelSubmitting(true)
      const res = await addModel(values)
      if (res.error) {
        message.error(res.error)
      } else {
        message.success(`已成功添加模型: ${values.model_name}`)
        setAddModelModalOpen(false)
        addModelForm.resetFields()
        load()
      }
    } catch (e) {
      // form validate failure
    } finally {
      setAddModelSubmitting(false)
    }
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

  const handleResetPrompts = () => {
    Modal.confirm({
      title: '确认恢复默认校对指令模板？',
      icon: <UndoOutlined style={{ color: '#fa8c16' }} />,
      content: '恢复后将使用系统最新的官方标准校对提示词（包含错别字、语法、格式、逻辑、文风润色等 7 大校验规范及 JSON 示例）。',
      okText: '恢复默认',
      okType: 'warning',
      cancelText: '取消',
      onOk: async () => {
        setResetting(true)
        try {
          const res = await resetPrompts()
          if (res.system_prompt_proofread) {
            setPromptProofread(res.system_prompt_proofread)
            message.success('已成功恢复为系统默认校对指令模板！')
          }
        } catch (e) {
          message.error('恢复失败：' + e.message)
        } finally {
          setResetting(false)
        }
      },
    })
  }

  const tabItems = [
    {
      key: 'keys',
      label: (
        <Space>
          <KeyOutlined />
          <span>服务商与模型配置</span>
        </Space>
      ),
      children: (
        <Card style={{ borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
            <Text type="secondary" style={{ maxWidth: 650 }}>
              按服务商配置 API Key（同一个服务商的模型共用一个 Key）。支持添加自定义 OpenAI 兼容接口服务商及扩展新模型。 Key 加密存储在本地。
            </Text>
            <Space>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  addProviderForm.resetFields()
                  setAddProviderModalOpen(true)
                }}
              >
                添加自定义服务商
              </Button>
              <Button
                icon={<PlusOutlined />}
                onClick={() => {
                  addModelForm.resetFields()
                  setAddModelModalOpen(true)
                }}
              >
                添加模型
              </Button>
            </Space>
          </div>

          <List
            loading={loading}
            dataSource={providers}
            renderItem={(p) => (
              <List.Item
                actions={[
                  <Button
                    key="add-model"
                    type="link"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      addModelForm.resetFields()
                      addModelForm.setFieldsValue({ provider: p.provider })
                      setAddModelModalOpen(true)
                    }}
                  >
                    添加模型
                  </Button>,
                  p.configured && (
                    <Popconfirm
                      key="delete-key"
                      title={`确定删除 ${p.name} 的 API Key？`}
                      onConfirm={() => handleDelete(p.provider)}
                    >
                      <Button type="link" danger icon={<DeleteOutlined />}>删除 Key</Button>
                    </Popconfirm>
                  ),
                  p.is_custom && (
                    <Popconfirm
                      key="delete-provider"
                      title={`确定彻底删除自定义服务商 "${p.name}"？`}
                      description="该服务商下的所有模型和 Key 将一并被移除。"
                      onConfirm={() => handleDeleteCustomProvider(p.provider, p.name)}
                    >
                      <Button type="link" danger icon={<DeleteOutlined />}>删除服务商</Button>
                    </Popconfirm>
                  ),
                ].filter(Boolean)}
              >
                <List.Item.Meta
                  title={
                    <Space style={{ flexWrap: 'wrap' }}>
                      <Text strong>{p.name}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>({p.provider})</Text>
                      {p.is_custom && <Tag color="purple">自定义服务商</Tag>}
                      {p.configured ? (
                        <Tag color="success" icon={<CheckCircleOutlined />}>已配置 Key</Tag>
                      ) : (
                        <Tag color="warning">未配置 Key</Tag>
                      )}
                      {p.api_base && (
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          Base URL: {p.api_base}
                        </Text>
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
                      <div>
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
                              保存 Key
                            </Button>
                          </Form.Item>
                          {p.requires_account_id && (
                            <div style={{ display: 'block', width: '100%', marginTop: 8 }}>
                              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Account ID（Cloudflare Workers AI 必需）</Text>
                              <Space>
                                <Form.Item name={`acct_${p.provider}`} noStyle>
                                  <Input
                                    placeholder={p.masked_account_id ? `当前：${p.masked_account_id}` : '粘贴 Account ID'}
                                    style={{ width: 360 }}
                                  />
                                </Form.Item>
                                <Button
                                  size="small"
                                  type="primary"
                                  shape="round"
                                  icon={<SaveOutlined />}
                                  onClick={() => handleSave(p.provider, { onlyAccountId: true })}
                                >
                                  保存
                                </Button>
                              </Space>
                            </div>
                          )}
                        </Form>
                      </div>
                      <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {p.models.map((m) => (
                          <Tag
                            key={m.id}
                            color={m.deprecated ? 'red' : m.is_custom ? 'cyan' : 'default'}
                            style={{ margin: 0, paddingRight: m.is_custom ? 4 : 8 }}
                          >
                            <Space size={4}>
                              <span>{m.name}</span>
                              {m.is_custom && <Tag color="blue" style={{ fontSize: 10, margin: 0, padding: '0 2px' }}>自定义</Tag>}
                              {p.configured && (
                                <Button
                                  type="link"
                                  size="small"
                                  icon={<ApiOutlined />}
                                  loading={testing === m.id}
                                  onClick={() => handleTest(m.id)}
                                  style={{ padding: '0 2px' }}
                                >
                                  测试
                                </Button>
                              )}
                              {m.is_custom && (
                                <CloseCircleOutlined
                                  style={{ color: '#ff4d4f', cursor: 'pointer', marginLeft: 2 }}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleDeleteCustomModel(p.provider, m.id, m.name)
                                  }}
                                />
                              )}
                            </Space>
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
      ),
    },
    {
      key: 'concurrency',
      label: (
        <Space>
          <ThunderboltOutlined />
          <span>窗口与并发设置</span>
        </Space>
      ),
      children: (
        <Card style={{ borderRadius: 8 }}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            配置校对时的单个 LLM 窗口段落数量。
          </Text>

          <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
            <Text strong style={{ minWidth: 120 }}>单窗口段落数量：</Text>
            <InputNumber
              min={5}
              max={500}
              value={proofreadWindowSize}
              onChange={(val) => setProofreadWindowSize(val || 5)}
              style={{ width: 120 }}
            />
            <Text type="secondary" style={{ fontSize: 13 }}>
              （默认：30 段。范围：5 ~ 500 段）
            </Text>
          </div>

          <Button
            type="primary"
            shape="round"
            icon={<SaveOutlined />}
            loading={batchSaving}
            onClick={async () => {
              setBatchSaving(true)
              try {
                await savePrompts(promptProofread, batchMaxConcurrent, proofreadWindowSize)
                message.success('窗口与并发设置已保存')
              } catch {
                message.error('保存失败')
              } finally {
                setBatchSaving(false)
              }
            }}
          >
            保存窗口与并发设置
          </Button>
        </Card>
      ),
    },
    {
      key: 'account',
      label: (
        <Space>
          <SafetyCertificateOutlined />
          <span>账号与安全</span>
        </Space>
      ),
      children: (
        <Card style={{ borderRadius: 8 }}>
          <div style={{ marginBottom: 20 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              当前登录账号：<Text strong>{defaultUsername}</Text>
            </Text>
            <Text type="secondary">
              管理员口令托管在服务器环境变量（.env）中。您可以在此处修改口令并原子吊销历史 Token，或安全退出当前会话。
            </Text>
          </div>

          <Space size="large">
            <Button
              type="primary"
              icon={<LockOutlined />}
              onClick={() => setChangePwdOpen(true)}
            >
              修改管理员密码
            </Button>
            <Popconfirm
              title="确认退出当前账号登录？"
              onConfirm={() => logout()}
              okText="退出"
              cancelText="取消"
              okType="danger"
            >
              <Button icon={<LogoutOutlined />} danger>
                退出登录
              </Button>
            </Popconfirm>
          </Space>
        </Card>
      ),
    },
  ]

  return (
    <div>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')} style={{ marginBottom: 16 }}>
        返回项目列表
      </Button>

      <Tabs defaultActiveKey="keys" items={tabItems} size="large" />

      <ChangePasswordModal
        open={changePwdOpen}
        onCancel={() => setChangePwdOpen(false)}
      />

      {/* Modal 1: 添加自定义服务商 */}
      <Modal
        title="添加自定义服务商"
        open={addProviderModalOpen}
        onOk={handleAddProviderSubmit}
        confirmLoading={addProviderSubmitting}
        onCancel={() => setAddProviderModalOpen(false)}
        destroyOnClose
      >
        <Form form={addProviderForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="provider"
            label="服务商唯一标识"
            rules={[
              { required: true, message: '请输入服务商标识（字母/数字/下划线）' },
              { pattern: /^[a-zA-Z0-9_-]+$/, message: '仅支持字母、数字、下划线及横杠' }
            ]}
          >
            <Input placeholder="例如: groq, vllm, ollama, custom_api" />
          </Form.Item>

          <Form.Item
            name="name"
            label="服务商显示名称"
            rules={[{ required: true, message: '请输入服务商显示名称' }]}
          >
            <Input placeholder="例如: Groq AI, 本地 vLLM 代理" />
          </Form.Item>

          <Form.Item
            name="api_base"
            label="API Base URL (OpenAI 兼容端点)"
          >
            <Input placeholder="例如: https://api.groq.com/openai/v1 或 http://localhost:11434/v1" />
          </Form.Item>

          <Form.Item
            name="litellm_prefix"
            label="LiteLLM 路由前缀"
            initialValue="openai"
          >
            <Input placeholder="默认为 openai" />
          </Form.Item>

          <Form.Item
            name="initial_model_id"
            label="初始模型 ID (可选)"
          >
            <Input placeholder="例如: llama-3.3-70b-versatile" />
          </Form.Item>

          <Form.Item
            name="initial_model_name"
            label="初始模型显示名称 (可选)"
          >
            <Input placeholder="例如: Llama 3.3 70B" />
          </Form.Item>

          <Form.Item
            name="api_key"
            label="API Key (可选)"
          >
            <Input.Password placeholder="可在此直接粘贴 API Key" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal 2: 添加模型 */}
      <Modal
        title="添加模型"
        open={addModelModalOpen}
        onOk={handleAddModelSubmit}
        confirmLoading={addModelSubmitting}
        onCancel={() => setAddModelModalOpen(false)}
        destroyOnClose
      >
        <Form form={addModelForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="provider"
            label="所属服务商"
            rules={[{ required: true, message: '请选择所属服务商' }]}
          >
            <Select placeholder="选择服务商">
              {providers.map((p) => (
                <Select.Option key={p.provider} value={p.provider}>
                  {p.name} ({p.provider})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="model_id"
            label="模型 ID"
            rules={[{ required: true, message: '请输入模型 ID' }]}
          >
            <Input placeholder="例如: deepseek-r1, qwen3.7-coder, gpt-4o" />
          </Form.Item>

          <Form.Item
            name="model_name"
            label="模型显示名称"
            rules={[{ required: true, message: '请输入模型显示名称' }]}
          >
            <Input placeholder="例如: DeepSeek R1" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
