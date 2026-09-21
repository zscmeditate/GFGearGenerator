import { degToRad, radToDeg } from '../math'
import { cylinderZ, helicalThread } from '../mesh/builder'
import { MeshData } from '../mesh/MeshData'
import { buildCylindricalGear } from './cylindrical'

export interface WormOptions {
  m: number
  z: number
  pressureAngleDeg: number
  /** 蜗杆长度 mm */
  wormLength: number
  /** 蜗轮厚度 mm */
  wheelHeight: number
  /** 蜗杆分度圆半径（输入 drive radius）mm */
  driveRadius: number
  /** 左旋 */
  leftThreaded?: boolean
  /** 滚切直蜗轮（带喉部包络），false=螺旋蜗轮 */
  hobbed?: boolean
  /** 蜗轮中心孔半径（mm，0 = 实心） */
  boreRadius?: number
  /** 蜗轮 D 型切深（mm，0 = 圆孔） */
  boreFlat?: number
  quality: 'preview' | 'high'
}

export function buildWormDrive(o: WormOptions): MeshData {
  const mesh = new MeshData()
  const alpha = degToRad(o.pressureAngleDeg)

  // —— 蜗杆几何参数（对应 wormhelix 中 radio=drive+1.25m）——
  const pathR = o.driveRadius + 1.25 * o.m // 螺旋路径半径
  const rRoot = o.driveRadius // 芯轴半径
  const rTip = o.driveRadius + 2.25 * o.m // 齿顶半径
  const lead = Math.PI * o.m // 单头导程
  const wormLeadAngle = Math.atan(o.m / (2 * pathR)) // ah
  const halfTip = Math.PI * o.m / 4 - o.m * Math.tan(alpha)
  const halfRoot = Math.PI * o.m / 4 + 1.3 * o.m * Math.tan(alpha)

  // —— 蜗轮（斜齿轮，螺旋角=蜗杆导程角）——
  // 滚切型需要足够轴向分层来还原喉部凹弧包络（螺旋角很小，按扭转公差只会分到 2 层）
  const wheel = buildCylindricalGear({
    m: o.m,
    z: o.z,
    pressureAngleDeg: o.pressureAngleDeg,
    height: o.wheelHeight,
    helixAngleDeg: radToDeg(wormLeadAngle),
    cw: o.leftThreaded ?? false,
    // 低精度沿用原高精度分层数（80）；高精度再提升 5 倍至 400
    minLayers: o.hobbed ? (o.quality === 'preview' ? 80 : 400) : undefined,
    boreRadius: o.boreRadius ?? 0,
    boreFlat: o.boreFlat ?? 0,
    quality: o.quality
  })

  // 滚切型：喉部凹弧包络（以蜗杆外圆为母线扫过轮坯外圆）
  if (o.hobbed) {
    const rp = (o.m * o.z) / 2
    const a = pathR + rp // 中心距
    const rWormOuter = o.driveRadius + 2.25 * o.m
    const pos = wheel.positions
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2]
      if (Math.abs(z) >= rWormOuter) continue
      const r = Math.hypot(x, y)
      const target = a - Math.sqrt(Math.max(0, rWormOuter * rWormOuter - z * z))
      if (r > target && r > 1e-9) {
        const k = target / r
        pos[i] = x * k
        pos[i + 1] = y * k
      }
    }
  }
  mesh.merge(wheel)

  // —— 蜗杆（局部沿 +Z 构建，再旋转到 +X，抬到中心距高度）——
  // 低精度沿用原高精度分段数（160）；高精度再提升 5 倍至 800
  const segCore = o.quality === 'preview' ? 160 : 800
  const core = cylinderZ(rRoot, rRoot, o.wormLength, segCore, -o.wormLength / 2, 'worm-core')
  const thread = helicalThread({
    rRoot,
    rTip,
    lead,
    length: o.wormLength,
    halfTipWidth: halfTip,
    halfRootWidth: halfRoot,
    // 低精度沿用原高精度每圈分段数（48）；高精度再提升 5 倍至 240
    segPerTurn: o.quality === 'preview' ? 48 : 240,
    leftHand: o.leftThreaded,
    partName: 'worm-thread'
  })

  const a = pathR + (o.m * o.z) / 2
  const toWorld = (x: number, y: number, z: number): [number, number, number] => [z, y + a, -x]
  mesh.merge(core, toWorld)
  mesh.merge(thread, toWorld)

  return mesh
}
