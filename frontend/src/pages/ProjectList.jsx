import React, { useState, useEffect, useRef } from 'react'
import { Card, Button, Table, Tag, Space, Modal, Input, Popconfirm, message, Spin, Tooltip } from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined, LockOutlined, UnlockOutlined, EditFilled } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { listProjects, createProject, createBlankProject, deleteProject, renameProject, uploadToProject, toggleProjectLock, getProjectPrescanStatus } from '../services/api'
import { CreateProjectModal } from '../components/CreateProjectModal'

export default function ProjectList() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [renameModal, setRenameModal] = useState({ open: false, id: '', name: '' })
  const [processingId, setProcessingId] = useState(null)   // 正在构建实体词典的项目
  const [processingName, setProcessingName] = useState('')
  const pollRef = useRef(null)
  const doneRef = useRef(false)
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  const load = async () => {
    setLoading(true)
    try {
      const data = await listProjects()
      setProjects(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    document.title = 'Watermelon Edit'
  }, [])

  // 轮询预扫描状态：完成后进入正文页（doneRef 保证完成分支只执行一次）
  useEffect(() => {
    if (!processingId) return
    doneRef.current = false

    const timeout = window.setTimeout(() => {
      if (doneRef.current) return
      doneRef.current = true
      clearInterval(pollRef.current)
      setProcessingId(null)
      navigateRef.current(`/project/${processingId}`)
    }, 90000)

    const timer = window.setInterval(async () => {
      try {
        const res = await getProjectPrescanStatus(processingId)
        if (doneRef.current) return
        if (res?.status === 'completed' || res?.status === 'failed') {
          doneRef.current = true
          clearInterval(timer)
          window.clearTimeout(timeout)
          setProcessingId(null)
          if (res.status === 'completed') {
            message.success(`实体词典构建完成（${res.entity_count || 0} 条）`)
          } else {
            message.warning('实体词典构建失败，稍后可在图谱中手动重扫')
          }
          navigateRef.current(`/project/${processingId}`)
        }
      } catch (e) {
        // 轮询偶发失败不打断，继续等
      }
    }, 1000)
    pollRef.current = timer

    return () => {
      clearInterval(timer)
      window.clearTimeout(timeout)
    }
  }, [processingId])

  const handleDelete = async (id) => {
    await deleteProject(id)
    message.success('项目已删除')
    load()
  }

  const handleToggleLock = async (record) => {
    const nextLocked = record.is_locked !== 1
    try {
      await toggleProjectLock(record.id, nextLocked)
      message.success(nextLocked ? '项目已锁定（已开启防误删）' : '项目已解锁')
      load()
    } catch (e) {
      message.error(e.message || '操作失败')
    }
  }

  const handleRename = async () => {
    if (!renameModal.name.trim()) return
    await renameProject(renameModal.id, renameModal.name.trim())
    setRenameModal({ open: false, id: '', name: '' })
    message.success('项目已重命名')
    load()
  }

  const handleCreateBlank = async (payload) => {
    setCreateLoading(true)
    try {
      const proj = await createBlankProject(payload)
      message.success('空白创作项目已成功创建！')
      setCreateModalOpen(false)
      setCreateLoading(false)
      navigate(`/project/${proj.id}`)
    } catch (e) {
      message.error('创建失败：' + (e.response?.data?.detail || e.message))
      setCreateLoading(false)
    }
  }

  const handleUploadCreate = async ({ name, file }) => {
    setCreateLoading(true)
    try {
      const proj = await createProject(name)
      await uploadToProject(proj.id, file)
      message.success('上传并解析成功，正在构建实体词典…')
      setCreateModalOpen(false)
      setCreateLoading(false)
      setProcessingId(proj.id)
      setProcessingName(proj.name)
      load()
    } catch (e) {
      message.error('上传失败：' + (e.response?.data?.detail || e.message))
      setCreateLoading(false)
    }
  }

  const statusMap = {
    new: { color: 'default', text: '新建' },
    uploaded: { color: 'default', text: '已上传' },
    parsed: { color: 'default', text: '已解析' },
    proofreading: { color: 'default', text: '校对中' },
    reviewing: { color: 'warning', text: '审核中' },
    completed: { color: 'success', text: '已完成' },
  }

  const columns = [
    {
      title: '项目名称',
      dataIndex: 'name',
      key: 'name',
      render: (text, record) => {
        const isProcessing = processingId === record.id
        const isWriting = record.mode === 'writing'
        return (
          <Space>
            {isProcessing ? (
              <span style={{ color: '#bfbfbf', fontWeight: 600, cursor: 'not-allowed' }}>{text}</span>
            ) : (
              <a style={{ color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer' }} onClick={() => navigate(`/project/${record.id}`)}>{text}</a>
            )}
            {isWriting && <Tag color="gold" icon={<EditFilled />}>撰写模式</Tag>}
            {isProcessing && <Tag color="processing" icon={<Spin size="small" />}>文档处理中</Tag>}
            {record.is_locked === 1 && <Tag color="gold" icon={<LockOutlined />}>已锁定</Tag>}
          </Space>
        )
      },
    },
    {
      title: '文件',
      dataIndex: 'filename',
      key: 'filename',
      render: (text) => text || <Tag>未上传</Tag>,
    },
    {
      title: '章节数',
      dataIndex: 'chapter_count',
      key: 'chapter_count',
      render: (n) => n || '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status) => {
        const s = statusMap[status] || { color: 'default', text: status }
        return <Tag color={s.color}>{s.text}</Tag>
      },
    },
    {
      title: '校稿进度',
      key: 'progress',
      render: (_, record) => {
        const total = record.paragraph_count || 0
        const upto = record.proofread_upto || 0
        if (!total) return '-'
        const pct = Math.round((upto / total) * 100)
        return `${upto}/${total} (${pct}%)`
      },
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      key: 'updated_at',
    },
    {
      title: '操作',
      key: 'actions',
      render: (_, record) => (
        <Space>
          <Tooltip title={record.is_locked === 1 ? '解开锁定' : '锁定项目（防误删）'}>
            <Button
              type="link"
              icon={record.is_locked === 1 ? <LockOutlined style={{ color: '#faad14', fontSize: 16 }} /> : <UnlockOutlined style={{ color: '#bfbfbf', fontSize: 16 }} />}
              onClick={() => handleToggleLock(record)}
            />
          </Tooltip>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => setRenameModal({ open: true, id: record.id, name: record.name })}
          />
          {record.is_locked === 1 ? (
            <Tooltip title="项目已锁定，禁止删除">
              <Button type="link" danger disabled icon={<DeleteOutlined />} />
            </Tooltip>
          ) : (
            <Popconfirm title="确定删除此项目？" onConfirm={() => handleDelete(record.id)}>
              <Button type="link" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Card
        title="我的项目"
        extra={
          <Button
            type="primary"
            shape="round"
            icon={<PlusOutlined />}
            loading={loading}
            onClick={() => setCreateModalOpen(true)}
          >
            新建项目
          </Button>
        }
      >
        <Table
          dataSource={projects}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={false}
          size="large"
        />
      </Card>

      <CreateProjectModal
        open={createModalOpen}
        onCancel={() => setCreateModalOpen(false)}
        onCreateBlank={handleCreateBlank}
        onUploadCreate={handleUploadCreate}
        loading={createLoading}
      />

      {/* 重命名弹窗 */}
      <Modal
        title="重命名项目"
        open={renameModal.open}
        onOk={handleRename}
        onCancel={() => setRenameModal({ open: false, id: '', name: '' })}
      >
        <Input
          value={renameModal.name}
          onChange={(e) => setRenameModal({ ...renameModal, name: e.target.value })}
          onPressEnter={handleRename}
          autoFocus
        />
      </Modal>

      {/* 实体词典构建中提示 */}
      <Modal
        title="文档处理中"
        open={!!processingId}
        footer={null}
        closable={false}
        centered
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Spin size="large" />
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>「{processingName}」正在构建实体词典…</div>
            <div style={{ color: '#999', fontSize: 13 }}>
              将自动识别全书高频人名/地名，构建完成后自动进入正文。大型文档约需十几秒。
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}

