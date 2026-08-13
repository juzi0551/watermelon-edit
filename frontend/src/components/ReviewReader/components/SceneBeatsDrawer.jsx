import React, { useState } from 'react'
import { Drawer, Button, Input, Card, Space, Tag, Typography, Spin, message, Divider, Tooltip } from 'antd'
import {
  ThunderboltOutlined, BulbOutlined, PlusOutlined, DeleteOutlined,
  PlayCircleOutlined, SendOutlined, CompassOutlined, FileAddOutlined
} from '@ant-design/icons'
import { generateOpening, expandSceneBeats } from '../../../services/api'

const { Title, Paragraph, Text } = Typography
const { TextArea } = Input

export function SceneBeatsDrawer({
  open,
  onClose,
  projectId,
  chapterTitle = '第一章',
  onAppendDraftText,
}) {
  const [beats, setBeats] = useState([
    '主角于深夜暴雨中接到紧急加密信号',
    '前往废弃码头与秘密联络人见面，发现现场有打斗痕迹',
    '遭遇未知潜伏对手袭击，凭本能死里逃生并拿到核心信标',
  ])
  const [expanding, setExpanding] = useState(false)

  // 开篇灵感与 5 章大纲推演 state
  const [generatingOpening, setGeneratingOpening] = useState(false)
  const [openingData, setOpeningData] = useState(null)

  const handleAddBeat = () => {
    if (beats.length >= 6) {
      message.warning('一章建议不超过 6 个核心场景节拍')
      return
    }
    setBeats([...beats, ''])
  }

  const handleRemoveBeat = (index) => {
    setBeats(beats.filter((_, i) => i !== index))
  }

  const handleBeatChange = (index, value) => {
    const updated = [...beats]
    updated[index] = value
    setBeats(updated)
  }

  const handleGenerateOpening = async () => {
    if (!projectId) return
    setGeneratingOpening(true)
    try {
      const data = await generateOpening(projectId)
      setOpeningData(data)
      message.success('开篇写作方案与大纲已归演！')
    } catch (e) {
      message.error('开篇推演失败：' + (e.message || '网络异常'))
    } finally {
      setGeneratingOpening(false)
    }
  }

  const handleExpandBeats = async () => {
    const validBeats = beats.map((b) => b.trim()).filter(Boolean)
    if (validBeats.length === 0) {
      message.warning('请至少填写一个场景节拍')
      return
    }

    setExpanding(true)
    try {
      const res = await expandSceneBeats(projectId, {
        sceneBeats: validBeats,
        chapterTitle: chapterTitle,
      })
      if (res.draft) {
        onAppendDraftText?.(res.draft)
        message.success('场景节拍已成功扩展并追加至正文！')
        onClose?.()
      }
    } catch (e) {
      message.error('扩写失败：' + (e.message || '网络异常'))
    } finally {
      setExpanding(false)
    }
  }

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ThunderboltOutlined style={{ color: '#d4a359', fontSize: 20 }} />
          <span style={{ fontWeight: 700, fontSize: 17 }}>剧情节拍与开篇灵感引擎</span>
        </div>
      }
      placement="right"
      width={560}
      onClose={onClose}
      open={open}
    >

      {/* 模块 1：基于作品设定的 5 章大纲与开篇灵感推演 */}
      <div style={{ marginBottom: 24, padding: '16px 18px', background: '#fcf8f2', borderRadius: 12, border: '1px solid #f3e5d0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: '#8c5813' }}>
            <CompassOutlined style={{ marginRight: 6 }} />全书开篇方案与 5 章大纲推演
          </span>
          <Button
            type="primary"
            size="small"
            icon={<BulbOutlined />}
            loading={generatingOpening}
            onClick={handleGenerateOpening}
            style={{ borderRadius: 6, background: '#d4a359', borderColor: '#d4a359' }}
          >
            一键推演开篇
          </Button>
        </div>

        {generatingOpening && (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <Spin />
            <div style={{ fontSize: 13, color: '#8c5813', marginTop: 8 }}>正在基于作品背景与主要角色推演开篇灵感...</div>
          </div>
        )}

        {openingData && !generatingOpening && (
          <div style={{ marginTop: 12 }}>
            <Text type="secondary" style={{ fontSize: 12.5, fontWeight: 600 }}>推演开篇灵感方案：</Text>
            <Space direction="vertical" style={{ width: '100%', marginTop: 8 }} size={10}>
              {openingData.openings?.map((op, idx) => (
                <Card key={idx} size="small" style={{ borderRadius: 8, border: '1px solid #e8e8e8' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <Tag color="gold" style={{ fontWeight: 600 }}>{op.style_name}</Tag>
                    <Button
                      size="small"
                      type="link"
                      icon={<FileAddOutlined />}
                      onClick={() => {
                        onAppendDraftText?.(op.sample_prose)
                        message.success('已插入此开篇段落！')
                      }}
                    >
                      插入为正文
                    </Button>
                  </div>
                  <div style={{ fontSize: 12.5, color: '#666', marginBottom: 6 }}>{op.concept}</div>
                  <div style={{ fontSize: 13, color: '#262626', background: '#fafafa', padding: '8px 10px', borderRadius: 6 }}>
                    “{op.sample_prose}”
                  </div>
                </Card>
              ))}
            </Space>

            {openingData.chapter_outline?.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <Text type="secondary" style={{ fontSize: 12.5, fontWeight: 600 }}>前 5 章推荐大纲：</Text>
                <div style={{ marginTop: 8, background: '#fff', borderRadius: 8, padding: '10px 14px', border: '1px solid #e8e8e8' }}>
                  {openingData.chapter_outline.map((ch, i) => (
                    <div key={i} style={{ marginBottom: i === openingData.chapter_outline.length - 1 ? 0 : 8, fontSize: 13 }}>
                      <span style={{ fontWeight: 700, color: '#722ed1', marginRight: 8 }}>{ch.chapter} · {ch.title}</span>
                      <span style={{ color: '#555' }}>: {ch.beat_summary}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <Divider style={{ margin: '16px 0' }} />

      {/* 模块 2：场景节拍起草器 (Scene Beats Engine) */}
      <div>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: '#1f1f1f' }}>
          【{chapterTitle}】场景节拍扩写起草器
        </div>
        <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 14 }}>
          输入本章 3~5 个关键情节点/节拍，AI 将自动结合文风模板扩展为约 1500 字的高完成度正文段落。
        </Text>

        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          {beats.map((beat, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Tag color="blue" style={{ borderRadius: 12, padding: '2px 8px', fontWeight: 600, fontSize: 13 }}>
                节拍 {idx + 1}
              </Tag>
              <Input
                size="large"
                value={beat}
                onChange={(e) => handleBeatChange(idx, e.target.value)}
                placeholder={`例：节拍 ${idx + 1} 情节要点...`}
                style={{ borderRadius: 8, fontSize: 13.5 }}
              />
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => handleRemoveBeat(idx)}
                disabled={beats.length <= 1}
              />
            </div>
          ))}
        </Space>

        <Button
          type="dashed"
          block
          icon={<PlusOutlined />}
          onClick={handleAddBeat}
          style={{ marginTop: 12, borderRadius: 8, height: 38 }}
        >
          添加新节拍
        </Button>

        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <Button
            type="primary"
            size="large"
            block
            loading={expanding}
            icon={<SendOutlined />}
            onClick={handleExpandBeats}
            style={{
              height: 46,
              borderRadius: 10,
              fontSize: 16,
              fontWeight: 700,
              background: 'linear-gradient(135deg, #d4a359 0%, #b88230 100%)',
              borderColor: '#d4a359',
              boxShadow: '0 4px 14px rgba(212, 163, 89, 0.35)',
            }}
          >
            一键扩写本章正文 (~1500字)
          </Button>
        </div>
      </div>
    </Drawer>
  )
}
