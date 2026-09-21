/**
 * 多齿轮装配模型与确定性布局求解器。
 *
 * 设计原则：大模型只输出「齿轮参数 + 装配关系(mates)」，严禁输出坐标——
 * 所有空间位姿由本模块按几何公式计算，保证同组参数 100% 可复现、绝不穿模：
 * - external 平行轴外啮合：中心距 = 分度圆半径和，从动轮自转半齿距对插齿相
 * - internal 内啮合：偏心距 = 分度圆半径差（支持行星轮系：齿圈挂行星轮自动与太阳轮同心）
 * - rack 齿轮齿条：节线与分度圆相切，沿齿条长度方向平移对齿
 * - coaxial 同轴对接：组件「端口」（真实出轴位置与方向）坐标架传播
 * bevel/worm 几何本身已是一副装配好的齿轮对，作为整体组件，只能通过端口同轴外连。
 *
 * 坐标系：输入齿轮的局部坐标即 buildGear() 输出坐标——圆柱/内齿圈已 layFlat
 * （轴线 +Y，齿宽 y∈[0,h]，齿峰 k=0 在局部 +X）；bevel/worm/rack 为各自原生朝向。
 */
import * as THREE from 'three'
import { GearType, gearTypeMap } from '../gear/schema'
import { diametralPitchToModule, degToRad } from '../gear/math'

export type MateKind = 'external' | 'internal' | 'rack' | 'coaxial'

export interface AssemblyGear {
  id: string
  type: GearType
  standard: 'metric' | 'english'
  /** 该类型全部 schema 字段的实际值 */
  values: Record<string, string | number | boolean>
}

export interface Mate {
  a: string
  b: string
  kind: MateKind
  /** b 相对 a 的圆周方位角（度，垂直于轴平面内），用于行星轮均布等 */
  bearing?: number
}

export interface Assembly {
  root: string
  gears: AssemblyGear[]
  mates: Mate[]
}

export interface PlacedGear {
  id: string
  position: [number, number, number]
  quaternion: [number, number, number, number]
}

/* ---------- 组件族划分 ---------- */

type Family = 'cyl' | 'ring' | 'rack' | 'bevel' | 'worm'

const EXTERNAL_CYL: ReadonlySet<GearType> = new Set([
  GearType.Spur,
  GearType.Helical,
  GearType.ShiftedSpur,
  GearType.ShiftedHelical
])
const INTERNAL_CYL: ReadonlySet<GearType> = new Set([
  GearType.Internal,
  GearType.InternalNS,
  GearType.InternalHelical,
  GearType.InternalHelicalNS
])

export function familyOf(type: GearType): Family {
  if (EXTERNAL_CYL.has(type)) return 'cyl'
  if (INTERNAL_CYL.has(type)) return 'ring'
  if (type === GearType.Rack) return 'rack'
  if (type === GearType.Bevel) return 'bevel'
  return 'worm'
}

/* ---------- 尺寸/参数派生（与 geometry/index.ts 的换算保持一致） ---------- */

interface GearMetrics {
  family: Family
  /** 法向模数 mm */
  m: number
  /** 端面模数 mm（法向制斜齿 = m/cosβ） */
  mt: number
  z: number
  /** 分度圆半径（cyl/ring） */
  rp: number
  /** 齿宽（cyl/ring/worm 蜗轮） */
  h: number
  /** 螺旋角（度） */
  betaDeg: number
  cw: boolean
  doubleHelical: boolean
  pressureAngle: number
  /** bevel：大端锥距 */
  coneR: number
  zPinion: number
  /** worm：蜗杆中心距/杆长 */
  wormA: number
  wormLength: number
  /** rack：端面齿距/总长/厚度 */
  pitch: number
  rackL: number
  rackThickness: number
  rackHelical: boolean
}

function num(v: Record<string, string | number | boolean>, id: string, fallback = 0): number {
  const n = Number(v[id])
  return Number.isFinite(n) ? n : fallback
}

export function gearMetrics(g: AssemblyGear): GearMetrics {
  const v = g.values
  const pitchDP = num(v, 'pitch')
  const m =
    g.standard === 'english' && pitchDP > 0 ? diametralPitchToModule(pitchDP) : num(v, 'module', 3)
  const family = familyOf(g.type)
  const normalSystem = v.helicalSystem === 'normal'
  const betaDeg = family === 'rack'
    ? (v.rackType === 'helical' ? num(v, 'helixAngle') : 0)
    : num(v, 'helixAngle')
  const beta = degToRad(betaDeg)
  const mt = normalSystem && beta > 0 ? m / Math.cos(beta) : m
  const z = num(v, 'z')
  const pressureAngle = num(v, 'pressureAngle', 20)
  const cw = Boolean(v.clockwise)
  const doubleHelical = Boolean(v.doubleHelical)

  const base: GearMetrics = {
    family,
    m,
    mt,
    z,
    rp: 0,
    h: num(v, 'gearHeight'),
    betaDeg,
    cw,
    doubleHelical,
    pressureAngle,
    coneR: 0,
    zPinion: num(v, 'zPinion'),
    wormA: 0,
    wormLength: num(v, 'wormLength'),
    pitch: Math.PI * mt,
    rackL: 0,
    rackThickness: num(v, 'rackThickness'),
    rackHelical: v.rackType === 'helical'
  }

  if (family === 'cyl' || family === 'ring') {
    base.rp = (mt * z) / 2
    return base
  }
  if (family === 'rack') {
    base.rackL = (z + 2) * Math.PI * mt
    return base
  }
  if (family === 'bevel') {
    // 两轮锥距相同：R = m·√(z²+zP²)/2
    base.coneR = (m * Math.hypot(z, base.zPinion)) / 2
    return base
  }
  // worm：pathR = driveRadius + 1.25m；中心距 a = pathR + mz/2
  const pathR = num(v, 'wormDriveRadius', 5) + 1.25 * m
  base.wormA = pathR + (m * z) / 2
  return base
}

/* ---------- 组件端口元数据（局部坐标，与 buildGear 输出一致） ---------- */

interface Port {
  name: string
  pos: THREE.Vector3
  dir: THREE.Vector3
  /** 同轴直串时优先选择的对侧端口 */
  opposite?: string
}

interface ComponentMeta {
  family: Family
  ports: Port[]
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

function componentMeta(g: AssemblyGear): ComponentMeta {
  const mc = gearMetrics(g)
  switch (mc.family) {
    case 'cyl':
    case 'ring':
      // layFlat 后轴 +Y，齿宽 y∈[0,h]
      return {
        family: mc.family,
        ports: [
          { name: 'p0', pos: V(0, 0, 0), dir: V(0, -1, 0), opposite: 'p1' },
          { name: 'p1', pos: V(0, mc.h, 0), dir: V(0, 1, 0), opposite: 'p0' }
        ]
      }
    case 'bevel':
      // 大轮轴 +Z、小轮轴 +X，锥顶重合于原点；轴从背侧（小端外）伸出
      return {
        family: 'bevel',
        ports: [
          { name: 'wheel', pos: V(0, 0, 0), dir: V(0, 0, -1) },
          { name: 'pinion', pos: V(0, 0, 0), dir: V(-1, 0, 0) }
        ]
      }
    case 'worm':
      // 蜗杆沿 X、位于 y=a；蜗轮轴 +Z、齿 z∈[0,h]
      return {
        family: 'worm',
        ports: [
          { name: 'wormA', pos: V(mc.wormLength / 2, mc.wormA, 0), dir: V(1, 0, 0), opposite: 'wormB' },
          { name: 'wormB', pos: V(-mc.wormLength / 2, mc.wormA, 0), dir: V(-1, 0, 0), opposite: 'wormA' },
          { name: 'wheelA', pos: V(0, 0, mc.h), dir: V(0, 0, 1), opposite: 'wheelB' },
          { name: 'wheelB', pos: V(0, 0, 0), dir: V(0, 0, -1), opposite: 'wheelA' }
        ]
      }
    case 'rack':
      return { family: 'rack', ports: [] }
  }
}

/* ---------- 拓扑与啮合可行性校验（解析合并 values 后调用） ---------- */

const MT_TOL = 0.02 // 端面模数相对差容差
const PA_TOL = 1.5 // 压力角容差（度）
const BETA_TOL = 1.5 // 螺旋角容差（度）
const RING_TEETH_GAP = 8 // 内齿圈与小齿轮最少齿数差

export function validateAssembly(asm: Assembly): void {
  const { gears, mates, root } = asm
  if (!gears.length) throw new Error('装配中没有齿轮')
  if (gears.length > 6) throw new Error('一次最多装配 6 个齿轮，请分批设计')
  const byId = new Map<string, AssemblyGear>()
  for (const g of gears) {
    if (!g.id || typeof g.id !== 'string') throw new Error('存在缺少 id 的齿轮')
    if (byId.has(g.id)) throw new Error(`齿轮 id「${g.id}」重复`)
    byId.set(g.id, g)
  }
  if (!byId.has(root)) throw new Error(`root「${root}」不在齿轮列表中`)

  // mates 拓扑：以 root 为根的树（每个非 root 齿轮恰好作为 b 出现一次）
  const childCount = new Map<string, number>()
  const edgeSeen = new Set<string>()
  for (const mt of mates) {
    const a = byId.get(mt.a)
    const b = byId.get(mt.b)
    if (!a || !b) throw new Error(`装配关系引用了不存在的齿轮（${mt.a} → ${mt.b}）`)
    if (mt.a === mt.b) throw new Error(`齿轮 ${mt.a} 不能与自己构成装配关系`)
    const key = [mt.a, mt.b].sort().join('~')
    if (edgeSeen.has(key)) throw new Error(`${mt.a} 与 ${mt.b} 之间存在重复的装配关系`)
    edgeSeen.add(key)
    childCount.set(mt.b, (childCount.get(mt.b) ?? 0) + 1)
  }
  for (const g of gears) {
    const n = childCount.get(g.id) ?? 0
    if (g.id === root) {
      if (n !== 0) throw new Error(`root 齿轮 ${root} 不能同时作为其他齿轮的从动件`)
    } else if (n !== 1) {
      throw new Error(`齿轮 ${g.id} 的装配关系不唯一：必须恰好连接在一个上级齿轮上`)
    }
  }

  // rack：只能作为从动方、只能有一条 rack 边
  for (const mt of mates) {
    const fa = familyOf(byId.get(mt.a)!.type)
    const fb = familyOf(byId.get(mt.b)!.type)
    if (mt.kind === 'rack') {
      if (fb !== 'rack' || fa !== 'cyl')
        throw new Error(`rack（齿轮齿条）关系必须是「圆柱齿轮 → 齿条」，${mt.a}→${mt.b} 不成立`)
    } else if (mt.kind === 'external') {
      if (fa !== 'cyl' || fb !== 'cyl')
        throw new Error(`external（外啮合）只能用于两个圆柱外齿轮，${mt.a}→${mt.b} 不成立`)
    } else if (mt.kind === 'internal') {
      const ok =
        (fa === 'ring' && fb === 'cyl') || (fa === 'cyl' && fb === 'ring')
      if (!ok) throw new Error(`internal（内啮合）必须是外齿轮与内齿圈，${mt.a}→${mt.b} 不成立`)
    } else if (mt.kind === 'coaxial') {
      if (fa === 'rack' || fb === 'rack') throw new Error('齿条不能参与同轴连接')
    }
  }

  // coaxial 端口度：每个齿轮参与的 coaxial 边数 ≤ 端口数（cyl 2 / bevel 2 / worm 4）
  const coaxialDegree = new Map<string, number>()
  for (const mt of mates) {
    if (mt.kind !== 'coaxial') continue
    coaxialDegree.set(mt.a, (coaxialDegree.get(mt.a) ?? 0) + 1)
    coaxialDegree.set(mt.b, (coaxialDegree.get(mt.b) ?? 0) + 1)
  }
  for (const [id, deg] of coaxialDegree) {
    const max = componentMeta(byId.get(id)!).ports.length
    if (deg > max) throw new Error(`齿轮 ${id} 只有 ${max} 个可同轴外连的轴端口，无法承担 ${deg} 个同轴连接`)
  }

  // 啮合参数物理可行性
  for (const mt of mates) {
    if (mt.kind === 'coaxial') continue
    const a = byId.get(mt.a)!
    const b = byId.get(mt.b)!
    const ma = gearMetrics(a)
    const mb = gearMetrics(b)
    const pin = mt.kind === 'internal' ? (ma.family === 'cyl' ? ma : mb) : ma
    const ring = mt.kind === 'internal' ? (ma.family === 'ring' ? ma : mb) : undefined
    const rack = mt.kind === 'rack' ? mb : undefined

    // 端面模数一致
    if (Math.abs(ma.mt - mb.mt) / Math.max(ma.mt, mb.mt) > MT_TOL) {
      throw new Error(
        `${mt.a} 与 ${mt.b} 要${mateLabel(mt.kind)}但端面模数不一致（${ma.mt.toFixed(2)} vs ${mb.mt.toFixed(2)}），互相啮合的齿轮模数必须相同`
      )
    }
    if (Math.abs(ma.pressureAngle - mb.pressureAngle) > PA_TOL) {
      throw new Error(`${mt.a} 与 ${mt.b} 压力角不一致（${ma.pressureAngle}° vs ${mb.pressureAngle}°），无法啮合`)
    }
    if (ring && pin) {
      if (ring.z - pin.z < RING_TEETH_GAP) {
        throw new Error(`内齿圈 ${mt.a === b.id ? mt.b : mt.a} 与小齿轮齿数差需 ≥ ${RING_TEETH_GAP}（当前 ${ring.z} - ${pin.z} = ${ring.z - pin.z}），否则装不进去`)
      }
    }
    // 螺旋角与旋向（人字齿豁免旋向）
    const pairKind = mt.kind
    const ba = pairKind === 'rack' ? (rack!.rackHelical ? ma.betaDeg : 0) : ma.betaDeg
    const bb = pairKind === 'rack' ? (rack!.rackHelical ? mb.betaDeg : 0) : mb.betaDeg
    if (Math.abs(ba - bb) > BETA_TOL) {
      throw new Error(`${mt.a} 与 ${mt.b} 螺旋角不一致（${ba.toFixed(1)}° vs ${bb.toFixed(1)}°），无法啮合`)
    }
    if (ba > 0) {
      if (pairKind === 'external') {
        if (!ma.doubleHelical && !mb.doubleHelical && ma.cw === mb.cw) {
          throw new Error(`${mt.a} 与 ${mt.b} 外啮合斜齿轮旋向必须相反（一个左旋一个右旋）`)
        }
      } else if (pairKind === 'internal') {
        if (!ma.doubleHelical && !mb.doubleHelical && ma.cw !== mb.cw) {
          throw new Error(`${mt.a} 与 ${mt.b} 内啮合斜齿轮旋向必须相同`)
        }
      } else if (pairKind === 'rack') {
        if (ma.cw !== mb.cw) {
          throw new Error(`斜齿轮与斜齿条啮合旋向必须相同（${mt.a} 与 ${mt.b} 当前相反）`)
        }
      }
    }
  }

  // —— 行星轮系装配条件（montage condition）——
  // 拓扑形态：root=太阳轮(cyl) → N 个 external+bearing 行星轮 → 1 个 internal 齿圈挂在某个行星轮上
  // 几何上：z_齿圈 = z_太阳轮 + 2×z_行星轮 时齿圈自动与太阳轮同心（提示词已要求）
  // 装配条件：N 个行星轮均布时，(z_齿圈 - z_太阳轮) 必须能被 N 整除，否则只有挂在齿圈上的那个行星轮
  // 能与齿圈正确啮合，其他行星轮的齿会与齿圈的齿冲突，无法同时装配
  validatePlanetaryCondition(byId, mates, root)
}

function validatePlanetaryCondition(
  byId: Map<string, AssemblyGear>,
  mates: Mate[],
  root: string
): void {
  const sunGear = byId.get(root)!
  if (familyOf(sunGear.type) !== 'cyl') return

  // 太阳轮的所有 external 子节点（候选行星轮）
  const planetMates = mates.filter((m) => m.a === root && m.kind === 'external')
  if (planetMates.length < 2) return // 单行星不算行星系

  // 是否存在一个齿圈挂在某个行星轮上（internal 关系，父=行星轮，子=齿圈）
  const planetIds = new Set(planetMates.map((m) => m.b))
  const ringMate = mates.find(
    (m) => m.kind === 'internal' && planetIds.has(m.a)
  )
  if (!ringMate) return // 没有齿圈，不是行星系

  const sunMc = gearMetrics(sunGear)
  const ringGear = byId.get(ringMate.b)!
  const ringMc = gearMetrics(ringGear)
  if (ringMc.family !== 'ring') return

  // 所有行星轮必须同齿数（这是行星轮系的基础要求）
  const planetMcs = planetMates.map((m) => gearMetrics(byId.get(m.b)!))
  const firstPlanetZ = planetMcs[0].z
  const mismatched = planetMcs.find((mc) => mc.z !== firstPlanetZ)
  if (mismatched) {
    throw new Error(
      `行星轮系要求所有行星轮齿数相同（当前存在不同齿数的行星轮），请统一为 ${firstPlanetZ} 齿`
    )
  }

  // 同心条件：z_齿圈 = z_太阳轮 + 2×z_行星轮
  const expectedRingZ = sunMc.z + 2 * firstPlanetZ
  if (ringMc.z !== expectedRingZ) {
    throw new Error(
      `行星轮系同心条件不满足：z_齿圈应为 z_太阳轮 + 2×z_行星轮 = ${sunMc.z} + 2×${firstPlanetZ} = ${expectedRingZ}（当前 z_齿圈=${ringMc.z}），否则齿圈无法与太阳轮同心`
    )
  }

  // 装配条件（montage）：(z_齿圈 - z_太阳轮) 必须能被行星轮数 N 整除
  // 这是多个均布行星轮能同时与太阳轮和齿圈都啮合的必要条件
  const N = planetMates.length
  const diff = ringMc.z - sunMc.z
  if (diff % N !== 0) {
    throw new Error(
      `行星轮系装配条件不满足：${N} 个均布行星轮要求 (z_齿圈 - z_太阳轮) 能被 ${N} 整除，当前 ${ringMc.z} - ${sunMc.z} = ${diff} 不能被 ${N} 整除。` +
      `请调整齿数使差值能被 ${N} 整除（如 N=3 时差值需为 3 的倍数，N=4 时为 4 的倍数），否则除挂在齿圈上的那一个行星轮外，其余行星轮的齿会与齿圈干涉，无法装配。` +
      `可参考组合：3 行星→差值 3 的倍数；4 行星→差值 4 的倍数。`
    )
  }
}

function mateLabel(kind: MateKind): string {
  return kind === 'external' ? '外啮合' : kind === 'internal' ? '内啮合' : kind === 'rack' ? '齿轮齿条啮合' : '同轴连接'
}

/* ---------- 布局求解器 ---------- */

const AXIS_GAP = 2 // 同轴多轮之间的轴向间隙 mm

interface Frame {
  pos: THREE.Vector3
  quat: THREE.Quaternion
}

interface ShaftSeg {
  /** 所属齿轮 id（与其啮合的父轮不做碰撞推开） */
  id: string
  dir: THREE.Vector3
  center: THREE.Vector3
  hw: number
  /** 齿顶外圆半径（齿圈用齿根外圆 rp+1.25m） */
  r: number
  /** 分度圆半径 / 模数 / 是否内齿圈（啮合相切与腔内包容判定用） */
  rp: number
  m: number
  isRing: boolean
}

/** 圆柱/齿圈的实体外圆半径（用于非啮合碰撞判定） */
function outerR(family: Family, mc: GearMetrics): number {
  return family === 'ring' ? mc.rp + 1.25 * mc.m : mc.rp + mc.m
}

const mod = (x: number, n: number) => ((x % n) + n) % n

/**
 * 计算装配中每个齿轮的世界位姿（position + quaternion）。
 * 调用前应已通过 validateAssembly。
 */
export function solveAssembly(asm: Assembly): PlacedGear[] {
  validateAssembly(asm)
  const byId = new Map(asm.gears.map((g) => [g.id, g]))
  const kids = new Map<string, Mate[]>()
  for (const mt of asm.mates) {
    const arr = kids.get(mt.a) ?? []
    arr.push(mt)
    kids.set(mt.a, arr)
  }

  const frames = new Map<string, Frame>()
  const usedPorts = new Map<string, Set<string>>()
  const inPort = new Map<string, string>()
  /** 该齿轮被上级啮合放置时，父→它 的中心连线方向（用于下一级默认折返布局） */
  const incomingRadial = new Map<string, THREE.Vector3>()
  const segs: ShaftSeg[] = []

  const markPort = (id: string, name: string) => {
    const s = usedPorts.get(id) ?? new Set<string>()
    s.add(name)
    usedPorts.set(id, s)
  }

  frames.set(asm.root, { pos: new THREE.Vector3(0, 0, 0), quat: new THREE.Quaternion() })
  // root 自身也占用一根轴线（供 g1→g2→g3 同心折返时防重叠检测）
  const rootGear = byId.get(asm.root)!
  const rootFam = familyOf(rootGear.type)
  if (rootFam === 'cyl' || rootFam === 'ring') {
    const mc = gearMetrics(rootGear)
    segs.push({
      id: rootGear.id,
      dir: V(0, 1, 0),
      center: V(0, mc.h / 2, 0),
      hw: mc.h / 2,
      r: outerR(rootFam, mc),
      rp: mc.rp,
      m: mc.m,
      isRing: rootFam === 'ring'
    })
  }

  const queue = [asm.root]
  while (queue.length) {
    const aId = queue.shift()!
    const a = byId.get(aId)!
    const fa = frames.get(aId)!
    for (const mt of kids.get(aId) ?? []) {
      const b = byId.get(mt.b)!
      let frame: Frame
      if (mt.kind === 'coaxial') {
        frame = placeCoaxial(a, b, fa, markPort, usedPorts, inPort, segs)
      } else if (mt.kind === 'rack') {
        frame = placeRack(a, b, fa, mt, incomingRadial)
      } else {
        frame = placeParallel(a, b, fa, mt, incomingRadial, segs)
      }
      // 登记新放置圆柱/齿圈的轴段（齿条/bevel/worm 组件不参与轴向防重叠）
      const famB = familyOf(b.type)
      if (mt.kind !== 'rack' && (famB === 'cyl' || famB === 'ring')) {
        const mc = gearMetrics(b)
        segs.push({
          id: b.id,
          dir: V(0, 1, 0).applyQuaternion(frame.quat).normalize(),
          center: frame.pos.clone().add(V(0, mc.h / 2, 0).applyQuaternion(frame.quat)),
          hw: mc.h / 2,
          r: outerR(famB, mc),
          rp: mc.rp,
          m: mc.m,
          isRing: famB === 'ring'
        })
      }
      frames.set(b.id, frame)
      queue.push(b.id)
    }
  }

  return asm.gears.map((g) => {
    const f = frames.get(g.id)!
    return {
      id: g.id,
      position: [f.pos.x, f.pos.y, f.pos.z] as [number, number, number],
      quaternion: [f.quat.x, f.quat.y, f.quat.z, f.quat.w] as [number, number, number, number]
    }
  })
}

/** 选一个未占用端口；同轴直串时优先用接入端口的对侧 */
function pickPort(
  g: AssemblyGear,
  used: Map<string, Set<string>>,
  inPortName?: string
): Port {
  const meta = componentMeta(g)
  const taken = used.get(g.id)
  if (inPortName) {
    const p = meta.ports.find((x) => x.name === inPortName)
    const opp = p?.opposite
    if (opp) {
      const cand = meta.ports.find((x) => x.name === opp && !taken?.has(x.name))
      if (cand) return cand
    }
  }
  const free = meta.ports.find((x) => !taken?.has(x.name))
  if (!free) throw new Error(`齿轮 ${g.id} 的轴端口已被全部占用`)
  return free
}

function placeCoaxial(
  a: AssemblyGear,
  b: AssemblyGear,
  fa: Frame,
  markPort: (id: string, name: string) => void,
  used: Map<string, Set<string>>,
  inPort: Map<string, string>,
  segs: ShaftSeg[]
): Frame {
  const portALocal = pickPort(a, used, inPort.get(a.id))
  // 新节点 b：从首选端口接入（cyl 为 p0 侧，材料沿自身 +轴 向外长）
  const portBLocal = componentMeta(b).ports[0]
  if (!portBLocal) throw new Error(`齿轮 ${b.id} 没有可同轴连接的轴端口`)

  const pa = portALocal.pos.clone().applyQuaternion(fa.quat).add(fa.pos)
  const da = portALocal.dir.clone().applyQuaternion(fa.quat)

  // b 的接入轴方向对齐到 a 出轴的反方向（共线连续）；最小角旋转确定绕轴相位
  const q = new THREE.Quaternion().setFromUnitVectors(portBLocal.dir, da.clone().negate())
  const pos = pa.clone().sub(portBLocal.pos.clone().applyQuaternion(q))

  // 圆柱/齿圈同轴接入后，仍可能与同一物理轴线上的其他（非啮合）轮坯重叠 → 沿轴推开
  const famB = familyOf(b.type)
  if (famB === 'cyl' || famB === 'ring') {
    const mc = gearMetrics(b)
    const axisB = V(0, 1, 0).applyQuaternion(q).normalize()
    const mid = pos.clone().add(V(0, mc.h / 2, 0).applyQuaternion(q))
    const push = resolveShaftPush(
      mid, axisB, mc.h / 2, outerR(famB, mc), mc.rp, mc.m, famB === 'ring', segs, a.id
    )
    if (push) pos.addScaledVector(axisB, push)
  }

  markPort(a.id, portALocal.name)
  markPort(b.id, portBLocal.name)
  inPort.set(b.id, portBLocal.name)
  return { pos, quat: q }
}

/** bearing 方向：显式方位角 > 相对上级入向折返 > 局部 +X 基方向 */
function bearingDir(
  g: AssemblyGear,
  fa: Frame,
  mt: Mate,
  incoming: Map<string, THREE.Vector3>
): THREE.Vector3 {
  const axis = V(0, 1, 0).applyQuaternion(fa.quat).normalize()
  const u0 = V(1, 0, 0).applyQuaternion(fa.quat)
  u0.addScaledVector(axis, -u0.dot(axis)).normalize()
  let u: THREE.Vector3
  if (mt.bearing !== undefined && Number.isFinite(mt.bearing)) {
    u = u0.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, degToRad(mt.bearing)))
  } else {
    const rin = incoming.get(g.id)
    u = rin ? rin.clone().negate() : u0
  }
  return u
}

/** 外啮合 / 内啮合（平行轴）布局 */
function placeParallel(
  a: AssemblyGear,
  b: AssemblyGear,
  fa: Frame,
  mt: Mate,
  incoming: Map<string, THREE.Vector3>,
  segs: ShaftSeg[]
): Frame {
  const ma = gearMetrics(a)
  const mb = gearMetrics(b)
  const isInternal = mt.kind === 'internal'
  const aIsRing = ma.family === 'ring'
  const rpA = ma.rp
  const rpB = mb.rp
  const C = isInternal ? Math.abs(rpA - rpB) : rpA + rpB

  const axisW = V(0, 1, 0).applyQuaternion(fa.quat).normalize()
  const u = bearingDir(a, fa, mt, incoming)

  // b 轴与 a 轴平行同向
  const qAlign = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), axisW)

  // —— 轴向对齐策略：齿宽中点对齐（center alignment）——
  // 行业惯例：平行轴圆柱齿轮副默认中心对齐，理由：
  //  1) 最大化齿宽方向的接触面积，避免边缘载荷集中（edge loading）导致点蚀；
  //  2) 允许轴向微小浮动补偿安装误差，齿宽方向接触斑中心居中；
  //  3) 对人字齿（doubleHelical）强制要求：两侧 V 槽顶点必须轴向重合，
  //     中心对齐自动满足此条件；
  //  4) 当小齿轮比大齿轮略宽 2~5mm（实线轴允许轴向浮动）时，仍按齿宽中点对齐。
  // pos = a 原点 + u·中心距 + axis·(ha-hb)/2，使 b 的齿宽中点落到 a 的齿宽中点
  const pos = fa.pos.clone().addScaledVector(u, C).addScaledVector(axisW, (ma.h - mb.h) / 2)

  // 与非啮合轮坯（同轴或径向靠近的平行轴，如二级减速的输入/输出大轮）沿轴自动错开
  let midB = pos.clone().add(V(0, mb.h / 2, 0).applyQuaternion(qAlign))
  const famB = familyOf(b.type)
  const push = resolveShaftPush(
    midB, axisW, mb.h / 2, outerR(famB, mb), mb.rp, mb.m, famB === 'ring', segs, a.id
  )
  if (push) {
    pos.addScaledVector(axisW, push)
    midB = pos.clone().add(V(0, mb.h / 2, 0).applyQuaternion(qAlign))
  }

  // —— 啮合齿相：节点处一齿对一槽 ——
  // θ(g, dir)：世界方向 dir 在齿轮局部齿廓平面内的齿相角（齿峰 k=0 在 +X）
  const thetaOf = (fr: Frame, dir: THREE.Vector3) => {
    const local = dir.clone().applyQuaternion(fr.quat.clone().invert())
    return Math.atan2(-local.z, local.x)
  }
  const pitchArc = Math.PI * ((ma.mt + mb.mt) / 2) // 端面齿距弧长
  const thetaA = thetaOf(fa, u)
  // 节点对 b 永远在指向 a 中心的 -u 方向（外啮合、内啮合、齿圈为父皆然）
  const thetaB0 = thetaOf({ pos, quat: qAlign }, u.clone().negate())
  // 弧长啮合方程右端（节圆点齿峰对齿槽）
  let rhs: number
  if (!isInternal) {
    // 外啮合：rp_a·θa + rp_b·θb ≡ πm/2
    rhs = pitchArc / 2 - rpA * thetaA
  } else if (!aIsRing) {
    // 父=小齿轮、子=齿圈（同向转动）
    rhs = rpA * thetaA + pitchArc / 2
  } else {
    // 父=齿圈(+u)、子=小齿轮(+u)：rp_b·θb - rp_a·θa ≡ πm/2
    rhs = rpA * thetaA + pitchArc / 2
  }
  // θb(final) = θb0 - s（绕轴正转使局部齿相角读数减小），折叠整齿距等价角
  const pitchB = (Math.PI * 2) / mb.z
  let s = thetaB0 - rhs / rpB
  s -= Math.round(s / pitchB) * pitchB

  const qSpin = new THREE.Quaternion().setFromAxisAngle(axisW, s)
  incoming.set(b.id, u.clone())
  return { pos, quat: qSpin.multiply(qAlign) }
}

/**
 * 若目标齿宽区间与已有平行轴齿轮（非啮合对象）的轮坯重叠，返回沿轴推开量。
 * 以下关系属于合法的啮合/包容、不做碰撞处理：
 * - 两外齿轮节圆相切（中心距 ≈ rp 之和）：外啮合；
 * - 外齿轮在齿圈节圆上（中心距 ≈ rp 之差）：内啮合；
 * - 外齿轮整体处于齿圈内腔（齿顶外圆不越齿圈内齿顶 rp-m）：行星系太阳轮；
 * - 新齿圈整体包容已有外齿轮：齿圈为从动方时。
 */
function resolveShaftPush(
  center: THREE.Vector3,
  dir: THREE.Vector3,
  hw: number,
  curR: number,
  curRp: number,
  curM: number,
  curIsRing: boolean,
  segs: ShaftSeg[],
  skipId: string
): number {
  // 各干涉轴段在 t 轴（沿 dir，目标中心为 0）上的齿宽区间 [lo,hi]。
  // 沿 dir 推开 push 后无碰撞要求：对每个干涉段 push ≥ hi+hw+GAP（整体推到正侧）
  // 或 push ≤ lo-hw-GAP（负侧）。多个段时取 max(正边界) / min(负边界)，再选绝对值小者。
  let posBound = -Infinity
  let negBound = Infinity
  for (const s of segs) {
    if (s.id === skipId) continue
    // 轴平行判定（容许约 2.5° 偏差）
    if (Math.abs(s.dir.dot(dir)) < 0.999) continue
    const cross = s.center.clone().sub(center)
    const along = cross.clone().projectOnVector(dir)
    const perp = cross.clone().sub(along)
    const d = perp.length()
    if (!curIsRing && !s.isRing && Math.abs(d - (s.rp + curRp)) <= 1) continue
    if (!curIsRing && s.isRing) {
      if (Math.abs(d - (s.rp - curRp)) <= 1) continue
      if (d + curR <= s.rp - s.m - 0.5) continue
    }
    if (curIsRing) {
      if (d + s.r <= curRp - curM - 0.5) continue
      if (Math.abs(d - (curRp - s.rp)) <= 1) continue
    }
    // 两齿顶外圆在径向上互不干涉（留 0.5mm 安全间隙）则无需沿轴错开
    if (d > s.r + curR + 0.5) continue
    const t = along.length() * (along.dot(dir) >= 0 ? 1 : -1) // s.center 的轴坐标
    posBound = Math.max(posBound, t + s.hw + hw + AXIS_GAP)
    negBound = Math.min(negBound, t - s.hw - hw - AXIS_GAP)
  }
  if (posBound === -Infinity) return 0
  return Math.abs(posBound) <= Math.abs(negBound) ? posBound : negBound
}

/** 齿轮齿条：齿条节线与小齿轮分度圆相切，沿长度方向平移对齿 */
function placeRack(
  a: AssemblyGear,
  b: AssemblyGear,
  fa: Frame,
  mt: Mate,
  incoming: Map<string, THREE.Vector3>
): Frame {
  const ma = gearMetrics(a)
  const mb = gearMetrics(b)
  const axisW = V(0, 1, 0).applyQuaternion(fa.quat).normalize()
  const t = bearingDir(a, fa, mt, incoming) // 齿条长度方向
  const n = new THREE.Vector3().crossVectors(axisW, t).normalize() // 齿顶朝向（齿轮在齿条 +n 侧）

  // rack 局部：x=长度, y=齿高, z=厚度 → 世界 t, n, axisW
  const basis = new THREE.Matrix4().makeBasis(t, n, axisW)
  const quat = new THREE.Quaternion().setFromRotationMatrix(basis)

  // 小齿轮齿宽中点 = 齿条厚度中点；齿条节线（局部 y=0）距小齿轮中心 rp
  const pinMid = fa.pos.clone().add(V(0, ma.h / 2, 0).applyQuaternion(fa.quat))
  const pos = pinMid.clone().addScaledVector(n, -ma.rp)

  // 齿相：小齿轮在 -n 方向（节点）的齿相位；齿条中点 x=0 为齿槽中心、齿峰在 p/2+k·p
  // 运动学不变量（齿轮正转齿条 +t 移动）：节点处齿条局部 x ≡ rp·θPin (mod p)，
  // 齿轮齿峰在节点（rp·θPin≡0）时恰好落入齿条槽心 x≡0
  const local = n.clone().negate().applyQuaternion(fa.quat.clone().invert())
  const thetaPin = Math.atan2(-local.z, local.x)
  const target = mod(ma.rp * thetaPin, Math.PI * ma.mt)
  // 齿条沿 -t 平移使接触点落在目标齿相（target 已在一个齿距内）
  pos.addScaledVector(t, -target)

  return { pos, quat }
}
