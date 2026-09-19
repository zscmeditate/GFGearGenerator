/**
 * 主题色切换（仅切换 Element Plus 主色）
 * 按 Element Plus 官方混色规则生成 primary 及其 light/dark 色阶，
 * 全部通过 --el-color-primary* CSS 变量生效，组件自动跟随。
 */
import { ref } from 'vue'

export interface ThemePreset {
  name: string
  value: string
}

/** 预设主题色（默认柔粉，与设计规范一致） */
export const themePresets: ThemePreset[] = [
  { name: '柔粉', value: '#E78BAF' },
  { name: '经典蓝', value: '#409EFF' },
  { name: '翠绿', value: '#36B37E' },
  { name: '罗兰紫', value: '#8E7CC3' },
  { name: '暖阳橙', value: '#F0995E' },
  { name: '天青', value: '#3AA6B9' }
]

const STORAGE_KEY = 'gf-theme-primary'
const DEFAULT_PRIMARY = '#E78BAF'

const currentColor = ref(DEFAULT_PRIMARY)

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim()
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** 与 Element Plus 官方一致的 mix：weight 为 second 颜色占比（0~1） */
function mix(first: string, second: string, weight: number): string {
  const [r1, g1, b1] = hexToRgb(first)
  const [r2, g2, b2] = hexToRgb(second)
  const r = Math.round(r1 * (1 - weight) + r2 * weight)
  const g = Math.round(g1 * (1 - weight) + g2 * weight)
  const b = Math.round(b1 * (1 - weight) + b2 * weight)
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** 应用主色：写入 Element Plus primary 全色阶 */
export function applyPrimary(color: string) {
  const root = document.documentElement
  root.style.setProperty('--el-color-primary', color)
  root.style.setProperty('--el-color-primary-dark-2', mix(color, '#000000', 0.2))
  root.style.setProperty('--el-color-primary-light-3', mix(color, '#ffffff', 0.3))
  root.style.setProperty('--el-color-primary-light-5', mix(color, '#ffffff', 0.5))
  root.style.setProperty('--el-color-primary-light-7', mix(color, '#ffffff', 0.7))
  root.style.setProperty('--el-color-primary-light-8', mix(color, '#ffffff', 0.8))
  root.style.setProperty('--el-color-primary-light-9', mix(color, '#ffffff', 0.9))
  currentColor.value = color
  try {
    localStorage.setItem(STORAGE_KEY, color)
  } catch {
    /* 隐私模式等场景忽略持久化失败 */
  }
}

/** 启动时恢复上次选择的主题色 */
export function initThemeColor() {
  let saved = ''
  try {
    saved = localStorage.getItem(STORAGE_KEY) || ''
  } catch {
    saved = ''
  }
  if (/^#[0-9a-fA-F]{6}$/.test(saved)) applyPrimary(saved)
  else currentColor.value = DEFAULT_PRIMARY
}

export function useThemeColor() {
  return { currentColor }
}
