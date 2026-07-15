import React, { useState, useEffect } from 'react'
import { Card, Button, Table, Tag, Space, Modal, Input, Popconfirm, Upload, message } from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined, FileTextOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { listProjects, createProject, deleteProject, renameProject, uploadToProject } from '../services/api'

export default function ProjectList() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(false)
  const [renameModal, setRenameModal] = useState({ open: false, id: '', name: '' })
  const navigate = useNavigate()

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
    document.title = '小说校稿工具'
  }, [])

  const handleDelete = async (id) => {
    await deleteProject(id)
    message.success('项目已删除')
    load()
  }

  const handleRename = async () => {
    if (!renameModal.name.trim()) return
    await renameProject(renameModal.id, renameModal.name.trim())
    setRenameModal({ open: false, id: '', name: '' })
    message.success('项目已重命名')
    load()
  }

  const handleUploadDoc = async (file) => {
    const name = file.name.replace(/\.docx$/i, '') || '未命名项目'
    setLoading(true)
    try {
      const proj = await createProject(name)
      await uploadToProject(proj.id, file)
      message.success('上传并解析成功')
      navigate(`/project/${proj.id}`)
    } catch (e) {
      message.error('上传失败：' + (e.response?.data?.detail || e.message))
      setLoading(false)
    }
    return false
  }

  const statusMap = {
    new: { color: 'default', text: '新建' },
    uploaded: { color: 'processing', text: '已上传' },
    parsed: { color: 'processing', text: '已解析' },
    proofreading: { color: 'processing', text: '校对中' },
    reviewing: { color: 'warning', text: '审核中' },
    completed: { color: 'success', text: '已完成' },
  }

  const columns = [
    {
      title: '项目名称',
      dataIndex: 'name',
      key: 'name',
      render: (text, record) => (
        <a onClick={() => navigate(`/project/${record.id}`)}>{text}</a>
      ),
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
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => setRenameModal({ open: true, id: record.id, name: record.name })}
          />
          <Popconfirm title="确定删除此项目？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Card
        title="我的项目"
        extra={
          <Upload
            accept=".docx"
            showUploadList={false}
            beforeUpload={handleUploadDoc}
            disabled={loading}
          >
            <Button type="primary" icon={<PlusOutlined />} loading={loading}>
              新建项目
            </Button>
          </Upload>
        }
      >
        <Table
          dataSource={projects}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={false}
        />
      </Card>

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
    </div>
  )
}
