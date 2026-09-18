import {
  computeInvolute,
  externalOutline,
  internalToothRing,
  nonStandardInternalHole,
  circleRing,
  ensureWinding,
  helixTwist,
  degToRad,
  clamp,
  budgetFor,
  type Vec2
} from '../math'
import { rotateRing, twistedExtrude } from '../mesh/builder'
import type { MeshData } from '../mesh/MeshData'

export interface CylOptions {
  m: number
  z: number
  pressureAngleDeg: number
  height: number
  helixAngleDeg?: number
  cw?: boolean
  doubleHelical?: boolean
  normalSystem?: boolean
  X?: number
  internal?: boolean
  /** 非标准内齿轮（NC3/NC5）：偏心阵列包络齿廓 */
  nonStandard?: boolean
  /** 内齿轮外圈径向厚度（mm） */
  rimThickness?: number
  /** 强制最少轴向分层数（滚切蜗轮喉部包络需要足够分层还原圆弧） */
  minLayers?: number
  quality: 'preview' | 'high'
}

function layerCount(totalTwist: number, quality: 'preview' | 'high', minLayers = 2) {
  if (Math.abs(totalTwist) < 1e-6) return Math.max(2, minLayers)
  const tol = degToRad(quality === 'preview' ? 10 : 3)
  const max = quality === 'preview' ? 40 : 140
  return clamp(Math.max(Math.ceil(Math.abs(totalTwist) / tol) + 1, minLayers), 2, max)
}

export function buildCylindricalGear(o: CylOptions): MeshData {
  const ah = degToRad(o.helixAngleDeg ?? 0)
  const spec = computeInvolute({
    m: o.m,
    z: o.z,
    pressureAngle: degToRad(o.pressureAngleDeg),
    helixAngle: ah,
    X: o.X ?? 0,
    normalSystem: o.normalSystem ?? false
  })

  // 分段预算
  const budget = budgetFor(o.z, o.quality)

  const baseOutline = o.internal
    ? (o.nonStandard ? nonStandardInternalHole(spec, budget) : internalToothRing(spec, budget))
    : externalOutline(spec, budget)
  if (o.internal) ensureWinding(baseOutline, false) // earcut 孔环 CW

  const outerRimR = spec.rp + o.m + (o.rimThickness ?? 5)
  const rimSeg = Math.max(48, clamp(o.z * budget.rootArc * 2, 64, 1024))
  const rim = circleRing(outerRimR, rimSeg)

  const totalTwist = helixTwist(spec, ah, o.height, o.cw ?? false)
  const layers = layerCount(totalTwist, o.quality, o.minLayers)

  const mesh = twistedExtrude(
    (twist) => {
      const toothRing = rotateRing(baseOutline, twist)
      if (o.internal) {
        return { outer: rim, holes: [toothRing] }
      }
      return { outer: toothRing, holes: [] as Vec2[][] }
    },
    { height: o.height, totalTwist, layers, doubleHelical: o.doubleHelical ?? false },
    o.internal ? 'internal-gear' : 'gear'
  )

  // 居中 Z
  centerZ(mesh, o.height)
  return mesh
}

function centerZ(mesh: MeshData, height: number) {
  for (let i = 2; i < mesh.positions.length; i += 3) mesh.positions[i] -= height / 2
}
