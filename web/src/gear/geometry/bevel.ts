import { computeInvolute, externalOutline, degToRad, dHoleRing, type Vec2 } from '../math'
import { extrudeSections, rotateRing, type Section } from '../mesh/builder'
import { MeshData } from '../mesh/MeshData'
import { budgetFor } from '../math'

export interface BevelOptions {
  m: number
  zWheel: number
  zPinion: number
  pressureAngleDeg: number
  quality: 'preview' | 'high'
  /** 中心孔半径（mm，两轮共用，0 = 实心） */
  boreRadius?: number
  /** D 型切深（mm，0 = 圆孔） */
  boreFlat?: number
}

/**
 * 单个直齿锥齿轮（轴线 +Z，锥顶在原点，齿从锥距 R-b（小端）延伸到 R（大端））。
 * 近似策略：齿廓随锥距线性收缩并沿锥面分层堆叠，端面以平盖封闭。
 */
function buildBevelOne(m: number, z: number, zMate: number, alphaDeg: number, quality: 'preview' | 'high', boreRadius: number, boreFlat: number, name: string): MeshData {
  const alpha = degToRad(alphaDeg)
  const delta = Math.atan(z / zMate)
  const R = (m * z) / (2 * Math.sin(delta)) // 大端锥距（=分度锥母线）
  const b = R / 3 // 齿宽，取锥距 1/3（对应原 sketchcon 中 F=Ao/3）
  // 低精度沿用原高精度分层数（80）；高精度再提升 5 倍至 400
  const layers = quality === 'preview' ? 80 : 400
  const budget = budgetFor(z, quality)

  // 中心孔：锥齿轮小端截面最小，孔径按小端齿根圆钳制，避免把齿切穿
  const rho0 = R - b
  const spec0 = computeInvolute({ m: (m * rho0) / R, z, pressureAngle: alpha, helixAngle: 0, X: 0 })
  const boreR = Math.min(boreRadius, Math.max(0, spec0.rRoot - 0.5))
  const hasBore = boreR > 0
  const boreRing = hasBore ? dHoleRing(boreR, boreFlat) : []

  const sections: Section[] = []
  for (let j = 0; j <= layers; j++) {
    const t = j / layers
    const rho = R - b + t * b // 小端 → 大端
    const mEff = (m * rho) / R
    const spec = computeInvolute({ m: mEff, z, pressureAngle: alpha, helixAngle: 0, X: 0 })
    const outline = externalOutline(spec, budget)
    sections.push({ z: rho * Math.cos(delta), outer: outline, holes: hasBore ? [boreRing] : [] })
  }
  return extrudeSections(sections, name)
}

export function buildBevelPair(o: BevelOptions): MeshData {
  const mesh = new MeshData()

  // 大轮：轴线 +Z
  const wheel = buildBevelOne(o.m, o.zWheel, o.zPinion, o.pressureAngleDeg, o.quality, o.boreRadius ?? 0, o.boreFlat ?? 0, 'bevel-wheel')
  mesh.merge(wheel)

  // 小轮：自身半轴相位错开半个齿距避免嵌齿，再绕 Y 转 90°（+Z → +X），锥顶重合
  const pinion = buildBevelOne(o.m, o.zPinion, o.zWheel, o.pressureAngleDeg, o.quality, o.boreRadius ?? 0, o.boreFlat ?? 0, 'bevel-pinion')
  const phi = Math.PI / o.zPinion
  const cp = Math.cos(phi), sp = Math.sin(phi)
  mesh.merge(pinion, (x, y, z) => {
    // 先绕 Z 转 φ（错齿），再绕 Y 转 +90°
    const x1 = x * cp - y * sp
    const y1 = x * sp + y * cp
    return [z, y1, -x1]
  })

  return mesh
}
