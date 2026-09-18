/**
 * 场景光照配置集 — 分别为浅色 / 深色主题定义 3D 场景的
 * 背景色、雾、灯光颜色与强度、网格线颜色等参数。
 *
 * 通过 getSceneLightingForBg(bg) 根据背景色亮度自动选取对应预设。
 */

export interface SceneLightingConfig {
  /** 场景背景色 (hex number) */
  sceneBg: number
  /** 雾近距 */
  fogNear: number
  /** 雾远距 */
  fogFar: number

  /** 半球光 — 天空色 */
  hemiSky: number
  /** 半球光 — 地面色 */
  hemiGround: number
  /** 半球光强度 */
  hemiIntensity: number

  /** 环境光颜色 */
  ambientColor: number
  /** 环境光强度 */
  ambientIntensity: number

  /** 主光（DirectionalLight）颜色 */
  keyColor: number
  /** 主光强度 */
  keyIntensity: number
  /** 主光位置 */
  keyPosition: [number, number, number]

  /** 轮廓光 1 颜色 */
  rim1Color: number
  /** 轮廓光 1 强度 */
  rim1Intensity: number
  /** 轮廓光 1 位置 */
  rim1Position: [number, number, number]

  /** 轮廓光 2 颜色 */
  rim2Color: number
  /** 轮廓光 2 强度 */
  rim2Intensity: number
  /** 轮廓光 2 位置 */
  rim2Position: [number, number, number]

  /** 网格线主色 */
  gridColor1: number
  /** 网格线辅色 */
  gridColor2: number
  /** 网格透明度 */
  gridOpacity: number

  /** 齿轮材质颜色 */
  matColor: number
  /** 齿轮材质金属感 */
  matMetalness: number
  /** 齿轮材质粗糙度 */
  matRoughness: number
}

/* ─── 浅色主题预设（Classic Light） ─── */
const LIGHT_PRESET: SceneLightingConfig = {
  sceneBg:  0xe0e5ec,
  fogNear:  400,
  fogFar:   1400,

  hemiSky:       0xffffff,
  hemiGround:    0xc3ccda,
  hemiIntensity: 1.35,

  ambientColor:     0xffffff,
  ambientIntensity: 0.25,

  keyColor:      0xffffff,
  keyIntensity:  1.5,
  keyPosition:   [120, 160, 90],

  rim1Color:      0xe89db5,
  rim1Intensity:  0.35,
  rim1Position:   [-120, 40, -100],

  rim2Color:      0x8fb8e8,
  rim2Intensity:  0.3,
  rim2Position:   [40, -80, 60],

  gridColor1:  0xb6c0ce,
  gridColor2:  0xd2d9e2,
  gridOpacity: 0.4,

  matColor:      0xaeb9c8,
  matMetalness:  0.18,
  matRoughness:  0.62,
}

/* ─── 深色主题预设（Dark） ─── */
const DARK_PRESET: SceneLightingConfig = {
  sceneBg:  0x1a1d21,
  fogNear:  500,
  fogFar:   1600,

  hemiSky:       0x6b7b8d,
  hemiGround:    0x2a3040,
  hemiIntensity: 1.1,

  ambientColor:     0xffffff,
  ambientIntensity: 0.3,

  keyColor:      0xffffff,
  keyIntensity:  1.8,
  keyPosition:   [120, 160, 90],

  rim1Color:      0xffa5c0,
  rim1Intensity:  0.55,
  rim1Position:   [-120, 40, -100],

  rim2Color:      0x7eaadf,
  rim2Intensity:  0.45,
  rim2Position:   [40, -80, 60],

  gridColor1:  0x3a4049,
  gridColor2:  0x2d333a,
  gridOpacity: 0.3,

  matColor:      0xc8d0dc,
  matMetalness:  0.22,
  matRoughness:  0.50,
}

/**
 * 根据背景色 hex 字符串判断亮/暗并返回对应预设。
 * 判断逻辑与 useThemePalette 中的 isDark 一致：
 * 取 #RRGGBB 的 RR 分量，< 100 视为深色。
 */
export function getSceneLightingForBg(bg: string): SceneLightingConfig {
  const r = parseInt(bg.substring(1, 3), 16)
  return r < 100 ? DARK_PRESET : LIGHT_PRESET
}
