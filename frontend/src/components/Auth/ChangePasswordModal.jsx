import React, { useState } from 'react'
import { Modal, Form, Input, message } from 'antd'
import { changePassword } from '../../services/api'

export default function ChangePasswordModal({ open, onCancel, onSuccess }) {
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (values.newPassword !== values.confirmPassword) {
        message.error('两次输入的新密码不一致')
        return
      }

      setSubmitting(true)
      await changePassword(values.oldPassword, values.newPassword)
      message.success('密码修改成功，所有历史登录凭据已吊销')
      form.resetFields()
      if (onSuccess) onSuccess()
      if (onCancel) onCancel()
    } catch (err) {
      if (err.errorFields) return
      const msg = err.response?.data?.detail || '修改密码失败，请重试'
      message.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="修改管理员密码"
      open={open}
      onOk={handleSubmit}
      onCancel={() => {
        form.resetFields()
        if (onCancel) onCancel()
      }}
      confirmLoading={submitting}
      okText="确认修改"
      cancelText="取消"
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item
          label="当前旧密码"
          name="oldPassword"
          rules={[{ required: true, message: '请输入当前旧密码' }]}
        >
          <Input.Password placeholder="请输入当前旧密码" />
        </Form.Item>

        <Form.Item
          label="设置新密码"
          name="newPassword"
          tooltip="密码必须不少于8位，且须同时包含字母和数字"
          rules={[
            { required: true, message: '请输入新密码' },
            {
              validator(_, value) {
                if (!value) return Promise.resolve()
                if (value.length < 8) {
                  return Promise.reject(new Error('新密码长度不能少于 8 位'))
                }
                if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
                  return Promise.reject(new Error('新密码必须同时包含字母和数字'))
                }
                return Promise.resolve()
              },
            },
          ]}
        >
          <Input.Password placeholder="至少 8 位，须同时包含字母和数字" />
        </Form.Item>

        <Form.Item
          label="确认新密码"
          name="confirmPassword"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: '请再次输入新密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('newPassword') === value) {
                  return Promise.resolve()
                }
                return Promise.reject(new Error('两次输入的新密码不一致'))
              },
            }),
          ]}
        >
          <Input.Password placeholder="请再次输入新密码" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
