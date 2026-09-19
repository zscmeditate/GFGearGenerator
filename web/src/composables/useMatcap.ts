/**
 * MatCap 共享资源：烘焙贴图加载与主题色融合。
 * 主视图 GearViewer 与 AI 会话预览画布共用同一份贴图与染色逻辑。
 */
import * as THREE from 'three'
import matcapUrl from '../gear/geometry/313131_BBBBBB_878787_A3A4A4.png'

let matcapTexture: THREE.Texture | null = null

export function getMatcapTexture(): THREE.Texture {
  if (!matcapTexture) {
    matcapTexture = new THREE.TextureLoader().load(matcapUrl)
    matcapTexture.colorSpace = THREE.SRGBColorSpace
  }
  return matcapTexture
}

/** 读取当前主题色（--el-color-primary）并转为 THREE.Color */
export function getThemePrimaryColor(): THREE.Color {
  const hex =
    getComputedStyle(document.documentElement).getPropertyValue('--el-color-primary').trim() || '#E78BAF'
  return new THREE.Color(hex)
}

/* ─── MatCap 主题色融合 ───
 * MeshMatcapMaterial 最终颜色 = 贴图灰阶 × material.color。
 * color 直接取主题色会把暗部压成脏色，故在「白色 ↔ 主题色」间按
 * MATCAP_TINT_STRENGTH 混合：0=纯灰阶贴图，1=完全主题色 */
export const MATCAP_TINT_STRENGTH = 0.55
const MATCAP_WHITE = new THREE.Color(0xffffff)

export function applyMatcapTint(mat: THREE.MeshMatcapMaterial) {
  mat.color.lerpColors(MATCAP_WHITE, getThemePrimaryColor(), MATCAP_TINT_STRENGTH)
}
