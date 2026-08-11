import React from 'react'
import { Modal, Button, Typography, Row, Col } from 'antd'
import { CommentOutlined, PrinterOutlined, DownloadOutlined } from '@ant-design/icons'

const { Title, Paragraph, Text } = Typography

export function ExportModal({
  open,
  onCancel,
  onExport,
  exporting,
}) {
  return (
    <Modal
      open={open}
      onCancel={onCancel}
      footer={null}
      width={860}
      centered
      destroyOnClose
      styles={{
        content: {
          padding: '36px 40px',
          borderRadius: 18,
          boxShadow: '0 24px 50px rgba(0,0,0,0.18)',
        },
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <Title level={3} style={{ margin: 0, fontSize: 26, fontWeight: 700, color: '#1f1f1f' }}>
          <DownloadOutlined style={{ color: '#d4a359', marginRight: 12, fontSize: 26 }} />
          导出校稿文档
        </Title>
        <Text style={{ fontSize: 16, color: '#666', marginTop: 8, display: 'inline-block' }}>
          请选择最契合您当前使用场景的排版格式
        </Text>
      </div>

      <Row gutter={[24, 24]}>
        {/* Option 1: Word 批注版 */}
        <Col span={12}>
          <div
            onClick={() => {
              if (exporting) return
              onExport?.('comment')
              onCancel?.()
            }}
            style={{
              height: '100%',
              padding: '26px 24px',
              borderRadius: 16,
              border: '2px solid #e8e0f5',
              background: 'linear-gradient(180deg, #fcfaff 0%, #f6f0ff 100%)',
              cursor: exporting ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: '0 6px 16px rgba(114, 46, 209, 0.06)',
              position: 'relative',
              boxSizing: 'border-box',
            }}
            className="export-card-btn"
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                <div style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  background: 'linear-gradient(135deg, #722ed1 0%, #9254de 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: 26,
                  boxShadow: '0 4px 12px rgba(114, 46, 209, 0.35)',
                  flexShrink: 0,
                }}>
                  <CommentOutlined />
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#391085' }}>
                    Word 批注版
                  </div>
                  <TagBadge color="#722ed1">.docx 原生批注</TagBadge>
                </div>
              </div>

              <Paragraph style={{ fontSize: 15.5, color: '#434343', lineHeight: 1.65, margin: '12px 0 0 0' }}>
                将注释保存为 <b>Word 原生气泡批注</b>，保留结构化数据，适合<b>继续导入系统</b>或<b>多人协作审阅</b>。
              </Paragraph>
            </div>

            <Button
              type="primary"
              size="large"
              block
              loading={exporting}
              icon={<DownloadOutlined style={{ fontSize: 18 }} />}
              style={{
                marginTop: 24,
                height: 50,
                fontSize: 17,
                fontWeight: 600,
                borderRadius: 12,
                background: 'linear-gradient(135deg, #722ed1 0%, #9254de 100%)',
                borderColor: '#722ed1',
                boxShadow: '0 4px 14px rgba(114, 46, 209, 0.3)',
              }}
            >
              导出 Word 批注版
            </Button>
          </div>
        </Col>

        {/* Option 2: 打印 / 出版版 */}
        <Col span={12}>
          <div
            onClick={() => {
              if (exporting) return
              onExport?.('print')
              onCancel?.()
            }}
            style={{
              height: '100%',
              padding: '26px 24px',
              borderRadius: 16,
              border: '2px solid #f9f2e6',
              background: 'linear-gradient(180deg, #fffdfa 0%, #fff7eb 100%)',
              cursor: exporting ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: '0 6px 16px rgba(212, 163, 89, 0.08)',
              position: 'relative',
              boxSizing: 'border-box',
            }}
            className="export-card-btn"
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                <div style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  background: 'linear-gradient(135deg, #d4a359 0%, #e6b973 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: 26,
                  boxShadow: '0 4px 12px rgba(212, 163, 89, 0.4)',
                  flexShrink: 0,
                }}>
                  <PrinterOutlined />
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#613400' }}>
                    打印 / 出版版
                  </div>
                  <TagBadge color="#d4a359">.docx 图书精排</TagBadge>
                </div>
              </div>

              <Paragraph style={{ fontSize: 15.5, color: '#434343', lineHeight: 1.65, margin: '12px 0 0 0' }}>
                将注释自动排版为<b>正文右上标</b>与<b>章末【本章注释】列表</b>，样式美观规范，适合<b>直接打印查看</b>。
              </Paragraph>
            </div>

            <Button
              type="primary"
              size="large"
              block
              loading={exporting}
              icon={<DownloadOutlined style={{ fontSize: 18 }} />}
              style={{
                marginTop: 24,
                height: 50,
                fontSize: 17,
                fontWeight: 600,
                borderRadius: 12,
                background: 'linear-gradient(135deg, #d4a359 0%, #e6b973 100%)',
                borderColor: '#d4a359',
                boxShadow: '0 4px 14px rgba(212, 163, 89, 0.3)',
              }}
            >
              导出打印 / 出版版
            </Button>
          </div>
        </Col>
      </Row>

      <style>{`
        .export-card-btn:hover {
          transform: translateY(-3px);
          box-shadow: 0 14px 32px rgba(0,0,0,0.14) !important;
        }
      `}</style>
    </Modal>
  )
}

function TagBadge({ color, children }) {
  return (
    <span style={{
      fontSize: 13,
      fontWeight: 600,
      color: color,
      background: 'rgba(255,255,255,0.9)',
      padding: '3px 10px',
      borderRadius: 6,
      border: `1px solid ${color}40`,
      display: 'inline-block',
      marginTop: 4,
    }}>
      {children}
    </span>
  )
}
