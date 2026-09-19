import { degToRad, clamp, type Vec2 } from '../math'
import { extrudeSections, translateRing, type Section } from '../mesh/builder'
import type { MeshData } from '../mesh/MeshData'

export interface RackOptions {
  m: number
  /** 显示齿数（实际沿长度排 z+2 个齿距） */
  z: number
  pressureAngleDeg: number
  /** 厚度（沿扫掠方向 mm） */
  thickness: number
  /** 条体高度（齿根线以下 mm） */
  barHeight: number
  helical?: boolean
  helixAngleDeg?: number
  /** 法向模数制（true）：齿距/齿形角按端面换算 mt=m/cosβ */
  normalSystem?: boolean
  quality: 'preview' | 'high'
}

/** 基本齿廓齿条纵截面（x 长度 × y 高度），CCW。p=端面齿距，apt=端面压力角 */
function rackOutline(o: RackOptions, p: number, apt: number): Vec2[] {
  const { m } = o
  const yTip = m
  const yRoot = -1.25 * m
  const yBottom = -o.barHeight
  const halfTip = p / 4 - m * Math.tan(apt)
  const halfRoot = p / 4 + 1.25 * m * Math.tan(apt)
  const teeth = o.z + 2
  const L = teeth * p
  const poly: Vec2[] = []
  poly.push([-L / 2, yBottom])
  poly.push([L / 2, yBottom])
  poly.push([L / 2, yRoot])
  // 沿齿顶从右向左排齿（保证 CCW）
  for (let k = teeth - 1; k >= 0; k--) {
    const xc = -L / 2 + p / 2 + k * p
    poly.push([xc + halfRoot, yRoot])
    poly.push([xc + halfTip, yTip])
    poly.push([xc - halfTip, yTip])
    poly.push([xc - halfRoot, yRoot])
  }
  poly.push([-L / 2, yRoot])
  return poly
}

export function buildRack(o: RackOptions): MeshData {
  // 对应原插件：直齿条强制螺旋角为 0（"If the rack type is straight, helix angle is certainly 0"）
  const beta = o.helical ? degToRad(o.helixAngleDeg ?? 0) : 0
  // 法向制：端面模数/端面压力角换算（同圆柱齿轮 computeInvolute）
  const apt = o.normalSystem && beta > 0
    ? Math.atan(Math.tan(degToRad(o.pressureAngleDeg)) / Math.cos(beta))
    : degToRad(o.pressureAngleDeg)
  const modt = o.normalSystem && beta > 0 ? o.m / Math.cos(beta) : o.m
  const p = Math.PI * modt
  const base = rackOutline(o, p, apt)
  let layers = 2
  if (o.helical && beta > 0) {
    // 低精度沿用原高精度错齿步长（0.08m）与层数上限（300）；高精度步长再缩小 5 倍、上限提升 5 倍
    const maxSkewStep = o.m * (o.quality === 'preview' ? 0.08 : 0.016)
    layers = clamp(Math.ceil((o.thickness * Math.tan(beta)) / maxSkewStep) + 1, 2, o.quality === 'preview' ? 300 : 1500)
  }
  const sections: Section[] = []
  for (let j = 0; j < layers; j++) {
    const t = j / (layers - 1)
    const z = -o.thickness / 2 + t * o.thickness
    const dx = (z + o.thickness / 2) * Math.tan(beta)
    sections.push({ z, outer: translateRing(base, dx, 0), holes: [] })
  }
  const mesh = extrudeSections(sections, 'rack')
  return mesh
}
