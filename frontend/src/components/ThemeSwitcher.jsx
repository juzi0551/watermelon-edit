import React, { useContext } from 'react'
import { Button, Dropdown } from 'antd'
import { SunOutlined, MoonOutlined, DesktopOutlined } from '@ant-design/icons'
import { ThemeContext } from '../App'

export default function ThemeSwitcher({ buttonStyle, buttonType = 'default', size = 'default' }) {
  const { themeMode, setThemeMode } = useContext(ThemeContext)

  const items = [
    { key: 'light', label: '浅色', icon: <SunOutlined /> },
    { key: 'dark', label: '深色', icon: <MoonOutlined /> },
    { key: 'system', label: '系统色', icon: <DesktopOutlined /> },
  ]

  const currentIcon =
    themeMode === 'light' ? <SunOutlined /> :
      themeMode === 'dark' ? <MoonOutlined /> : <DesktopOutlined />

  const currentLabel =
    themeMode === 'light' ? '浅色' :
      themeMode === 'dark' ? '深色' : '系统色'

  return (
    <Dropdown
      menu={{
        items,
        selectable: true,
        selectedKeys: [themeMode],
        onClick: ({ key }) => setThemeMode(key),
      }}
      trigger={['click']}
    >
      <Button
        type={buttonType}
        size={size}
        icon={currentIcon}
        style={{ fontSize: 14, ...buttonStyle }}
        shape="round"
      >
        {currentLabel}
      </Button>
    </Dropdown>
  )
}
