import { createContext, useContext } from 'react'
import { color } from '../design-tokens'

export const ThemeContext = createContext({
  themeMode: 'system',
  setThemeMode: () => {},
  isDark: false,
})

export function useTheme() {
  const ctx = useContext(ThemeContext)
  return {
    ...ctx,
    color,
  }
}
