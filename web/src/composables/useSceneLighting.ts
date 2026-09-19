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

  /** 补光（Fill Light，主光对侧、中性色，保证旋转到背光面仍可见） */
  fillColor: number
  /** 补光强度 */
  fillIntensity: number
  /** 补光位置 */
  fillPosition: [number, number, number]

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

  /** ACES 色调映射曝光度（renderer.toneMappingExposure） */
  toneMappingExposure: number
}

/* ─── 浅色主题预设（Light Industrial，规范 6/7/8 节） ─── */
const LIGHT_PRESET: SceneLightingConfig = {
  sceneBg:  0xe7edf3, /* 规范 6：Viewport 底色比全局底再沉一阶 */
  fogNear:  400,
  fogFar:   1400,

  /* 经典三点布光（key/fill/rim）+ 半球基底：
     四盏方向光按方位角 ~50° / -60° / -145° / 140° 均匀环绕，
     模型任意旋转角度都不会出现纯黑背光面；
     彩色 rim 仅做边缘点缀，主/补光均为中性光以保真材质颜色。 */
  hemiSky:       0xffffff,
  hemiGround:    0xdfe5ec,
  hemiIntensity: 0.55,

  ambientColor:     0xffffff,
  ambientIntensity: 0.15,

  keyColor:      0xfff7f0,
  keyIntensity:  1.35,
  keyPosition:   [140, 200, 120],

  fillColor:      0xeef4ff,
  fillIntensity:  0.6,
  fillPosition:   [-150, 100, 90],

  rim1Color:      0xe78baf,
  rim1Intensity:  0.35,
  rim1Position:   [-110, 130, -160],

  rim2Color:      0x9fbfe8,
  rim2Intensity:  0.35,
  rim2Position:   [130, 80, -150],

  /* 规范 7：主网格 rgba(100,110,125,.20)、次网格 .10；
     统一走 0.20 透明度，次网格用更浅的 RGB 获得同等低对比 */
  gridColor1:  0x646e7d,
  gridColor2:  0xa7afb9,
  gridOpacity: 0.2,

  /* 规范 8：工业深灰 / 蓝灰，哑光无强反射 */
  matColor:      0x7d8797,
  matMetalness:  0.12,
  matRoughness:  0.68,

  /* ACES 电影级色调映射：压缩高光、抬升暗部，明暗过渡柔和无死黑 */
  toneMappingExposure: 1.05,
}

/* ─── 深色主题预设（Dark） ─── */
const DARK_PRESET: SceneLightingConfig = {
  sceneBg:  0x1a1d21,
  fogNear:  500,
  fogFar:   1600,

  /* 同浅色主题的环绕三点布光；暗背景下补光略弱以保留夜景色差，
     彩色轮廓光适度增强勾勒边缘 */
  hemiSky:       0x8fa3b8,
  hemiGround:    0x2c3340,
  hemiIntensity: 0.55,

  ambientColor:     0xffffff,
  ambientIntensity: 0.12,

  keyColor:      0xfff5ec,
  keyIntensity:  1.5,
  keyPosition:   [140, 200, 120],

  fillColor:      0xdce8ff,
  fillIntensity:  0.5,
  fillPosition:   [-150, 100, 90],

  rim1Color:      0xffa5c0,
  rim1Intensity:  0.55,
  rim1Position:   [-110, 130, -160],

  rim2Color:      0x7eaadf,
  rim2Intensity:  0.5,
  rim2Position:   [130, 80, -150],

  gridColor1:  0x3a4049,
  gridColor2:  0x2d333a,
  gridOpacity: 0.3,

  matColor:      0xc8d0dc,
  matMetalness:  0.22,
  matRoughness:  0.50,

  toneMappingExposure: 1.12,
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
