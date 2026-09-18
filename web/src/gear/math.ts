/**
 * 齿轮数学核心（单位：mm，角度：弧度）
 * 渐开线逻辑移植自 GFGearGenerator.py 的 parameters()，
 * 去除了 Fusion 专用的 cm(/10) 换算与样条草图代码。
 */

export const TAU = Math.PI * 2

export function linspace(start: number, end: number, count: number): number[] {
  if (count <= 1) return [start]
  const step = (end - start) / (count - 1)
  const out: number[] = new Array(count)
  for (let i = 0; i < count; i++) out[i] = start + step * i
  return out
}

export const degToRad = (d: number) => (d * Math.PI) / 180
export const radToDeg = (r: number) => (r * 180) / Math.PI

/** 渐开线函数 inv(x) = tan(x) - x */
export const inv = (x: number) => Math.tan(x) - x

/** 径节 P(1/in) -> 模数 mm，对应原代码 m = 25.4/(P/2.54) = 25.4/P */
export const diametralPitchToModule = (p: number) => 25.4 / p

export interface InvoluteSpec {
  /** 端面模数 */
  modt: number
  /** 端面压力角（弧度） */
  apt: number
  /** 法向/端面制（true=法向制） */
  normalSystem: boolean
  z: number
  /** 法向模数 */
  m: number
  X: number
  /** 分度圆 */
  dp: number
  rp: number
  /** 基圆 */
  db: number
  rb: number
  /** 标准齿顶/齿根圆（X=0 时使用） */
  ra: number
  rf: number
  /** 实际使用的齿顶/齿根圆（变位时为 rva/rvf） */
  rTip: number
  rRoot: number
  /** 是否变位 */
  shifted: boolean
}

export interface GearMathInput {
  /** 法向模数 mm */
  m: number
  z: number
  /** 法向压力角（弧度） */
  pressureAngle: number
  /** 螺旋角（弧度），直齿为 0 */
  helixAngle?: number
  /** 变位系数 */
  X?: number
  /** true=法向模数制，false=端面模数制 */
  normalSystem?: boolean
}

/**
 * 等价于原 parameters() 的几何参数计算。
 */
export function computeInvolute(input: GearMathInput): InvoluteSpec {
  const { m, z } = input
  const ah = input.helixAngle ?? 0
  const X = input.X ?? 0
  const normalSystem = input.normalSystem ?? false

  let modt = m
  let apt = input.pressureAngle
  if (normalSystem) {
    modt = m / Math.cos(ah)
    apt = Math.atan(Math.tan(input.pressureAngle) / Math.cos(ah))
  }

  const dp = modt * z
  const rp = dp / 2
  const db = dp * Math.cos(apt)
  const rb = db / 2
  // da = dp + 2*m（齿顶高系数 1，法向模数）
  const ra = rp + m
  // df = dp - 2.5*m（顶隙 0.25m）
  const rf = rp - 1.25 * m

  // 变位：dv = dp + 2*X*m
  const shifted = X !== 0
  const rva = rp + X * m + m
  const rvf = rp + X * m - 1.25 * m

  return {
    modt,
    apt,
    normalSystem,
    z,
    m,
    X,
    dp,
    rp,
    db,
    rb,
    ra,
    rf,
    rTip: shifted ? rva : ra,
    rRoot: shifted ? rvf : rf,
    shifted
  }
}

/** 螺旋导程 ph = π·dp/tan(β)（原 π·dp·cos/sin） */
export function helixLead(spec: InvoluteSpec, helixAngle: number): number {
  return (Math.PI * spec.dp) / Math.tan(helixAngle)
}

/** 给定高度上的总扭转角（高度 mm） */
export function helixTwist(spec: InvoluteSpec, helixAngle: number, height: number, cw = false): number {
  if (helixAngle === 0) return 0
  const t = (height * 2 * Math.tan(helixAngle)) / spec.dp
  return cw ? -t : t
}

/** 渐开线滚动参数 u 与半径的互转：r = rb·sqrt(1+u²) */
export const uAtRadius = (rb: number, r: number) => (r > rb ? Math.sqrt((r / rb) ** 2 - 1) : 0)

/**
 * 外齿轮齿厚半角（弧度，相对齿中心线）。
 * 对应原 sigmaPS(rt,rb,ap,X)/2。
 */
export function externalHalfThickness(spec: InvoluteSpec, r: number): number {
  const { rb, apt, z, X } = spec
  const at = Math.acos(Math.min(1, rb / r))
  return Math.PI / (2 * z) + (2 * X * Math.tan(apt)) / z + inv(apt) - inv(at)
}

/**
 * 内齿轮齿厚半角（内齿用减号）。
 */
export function internalHalfThickness(spec: InvoluteSpec, r: number): number {
  const { rb, apt, z } = spec
  const at = Math.acos(Math.min(1, rb / r))
  return Math.PI / (2 * z) - inv(apt) + inv(at)
}

export type Vec2 = [number, number]

export function polar(r: number, a: number): Vec2 {
  return [r * Math.cos(a), r * Math.sin(a)]
}

/** 有向面积：>0 CCW，<0 CW */
export function signedArea(ring: Vec2[]): number {
  let a = 0
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % n]
    a += x1 * y2 - y1 * x2
  }
  return a / 2
}

/** 强制环的绕向（ccw=true 逆时针） */
export function ensureWinding(ring: Vec2[], ccw: boolean): Vec2[] {
  const area = signedArea(ring)
  if ((ccw && area < 0) || (!ccw && area > 0)) ring.reverse()
  return ring
}

/** 圆弧上的等分点（CCW，不含起点），用于齿顶/齿根弧 */
export function arcPoints(r: number, a0: number, a1: number, segments: number, cx = 0, cy = 0): Vec2[] {
  const out: Vec2[] = []
  for (let i = 1; i <= segments; i++) {
    const a = a0 + ((a1 - a0) * i) / segments
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return out
}

export interface SegmentBudget {
  /** 每个齿每侧渐开线段数 */
  flank: number
  /** 齿顶弧段数（每齿） */
  tipArc: number
  /** 齿根/齿间弧段数（每齿） */
  rootArc: number
}

/**
 * 根据齿数自适应分段，控制总面片规模。
 */
export function budgetFor(z: number, quality: 'preview' | 'high'): SegmentBudget {
  if (quality === 'preview') {
    const f = Math.max(3, Math.min(7, Math.floor(2200 / Math.max(z, 1) / 4)))
    return { flank: f, tipArc: Math.max(2, Math.floor(f / 2)), rootArc: Math.max(3, Math.floor(360 / z / 3) + 2) }
  }
  const f = Math.max(4, Math.min(16, Math.floor(9000 / Math.max(z, 1) / 4)))
  return { flank: f, tipArc: Math.max(3, Math.floor(f / 1.4)), rootArc: Math.max(4, Math.floor(720 / z / 3) + 2) }
}

/**
 * 外齿轮二维截面轮廓（CCW，单位 mm）。
 * 齿：渐开线升 → 齿顶弧 → 渐开线降；齿间：齿根圆（基圆内为径向直线）。
 */
export function externalOutline(spec: InvoluteSpec, b: SegmentBudget, cx = 0, cy = 0): Vec2[] {
  const { z, rb, rTip, rRoot } = spec
  const pitch = TAU / z
  const ring: Vec2[] = []

  const radialBelow = rRoot < rb
  const rFlankStart = Math.max(rRoot, rb)
  const u0 = uAtRadius(rb, rFlankStart)
  const u1 = uAtRadius(rb, rTip)
  const us = linspace(u0, u1, b.flank + 1)
  const half = (u: number) => {
    const r = rb * Math.sqrt(1 + u * u)
    return externalHalfThickness(spec, r)
  }
  const halfBase = Math.PI / (2 * z) + (2 * spec.X * Math.tan(spec.apt)) / z + inv(spec.apt)
  const halfTip = half(u1)

  for (let k = 0; k < z; k++) {
    const c = k * pitch
    // CCW：齿根弧末点 → 左齿侧(径向)上 → 齿顶弧 → 右齿侧下 → 齿根弧
    if (radialBelow) ring.push(polar(rRoot, c - halfBase))
    // 左渐开线：底 → 顶（角度由 -halfBase 增至 -halfTip）
    for (const u of us) ring.push(polar(rb * Math.sqrt(1 + u * u), c - half(u)))
    // 齿顶弧（CCW：-halfTip → +halfTip）
    appendArc(ring, rTip, c - halfTip, c + halfTip, b.tipArc, cx, cy)
    // 右渐开线：顶 → 底
    for (let i = us.length - 1; i >= 0; i--) {
      const u = us[i]
      ring.push(polar(rb * Math.sqrt(1 + u * u), c + half(u)))
    }
    if (radialBelow) ring.push(polar(rRoot, c + halfBase))
    // 齿根弧：到下一齿左侧起点
    const gapA0 = c + (radialBelow ? halfBase : half(u0))
    const gapA1 = c + pitch - (radialBelow ? halfBase : half(u0))
    appendArc(ring, rRoot, gapA0, gapA1, b.rootArc, cx, cy)
  }
  return ensureWinding(dedupeRing(ring), true)
}

function appendArc(ring: Vec2[], r: number, a0: number, a1: number, seg: number, cx: number, cy: number) {
  for (let i = 1; i <= seg; i++) {
    const a = a0 + ((a1 - a0) * i) / seg
    ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
}

/**
 * 内齿轮带齿内孔边界（返回 CCW 点列；用于 earcut 孔时需反转为 CW）。
 * 齿顶向内 rTipIn=rp-m，齿间在外 rGap=rp+1.25m。
 */
export function internalToothRing(spec: InvoluteSpec, b: SegmentBudget, cx = 0, cy = 0): Vec2[] {
  const { z, rb, m: mod, rp } = spec
  const pitch = TAU / z
  const rTip = rp - mod
  const rGap = rp + 1.25 * mod
  const radialBelow = rTip < rb
  const rFlankStart = Math.max(rTip, rb)
  const u0 = uAtRadius(rb, rFlankStart)
  const u1 = uAtRadius(rb, rGap)
  const us = linspace(u0, u1, b.flank + 1)
  const half = (u: number) => {
    const r = rb * Math.sqrt(1 + u * u)
    return internalHalfThickness(spec, r)
  }
  const halfBase = Math.PI / (2 * z) - inv(spec.apt)
  const halfGap = half(u1)

  const ring: Vec2[] = []
  for (let k = 0; k < z; k++) {
    const c = k * pitch
    // CCW：齿顶弧(内, rTip) → 齿侧向外 → 齿间弧(外, rGap) → 下一齿齿侧向内向
    if (radialBelow) ring.push(polar(rTip, c - halfBase))
    // 左齿侧：内 → 外（角度 c-half(u) 递增）
    for (const u of us) ring.push(polar(rb * Math.sqrt(1 + u * u), c - half(u)))
    // 齿间弧（外圆 rGap，CCW）
    appendArc(ring, rGap, c - halfGap, c + halfGap, Math.max(1, Math.round(b.rootArc / 2)), cx, cy)
    // 右齿侧：外 → 内
    for (let i = us.length - 1; i >= 0; i--) {
      const u = us[i]
      ring.push(polar(rb * Math.sqrt(1 + u * u), c + half(u)))
    }
    if (radialBelow) ring.push(polar(rTip, c + halfBase))
    // 齿顶弧（内圆 rTip）跨到下一齿
    appendArc(ring, rTip, c + halfBase, c + pitch - halfBase, Math.max(1, Math.round(b.tipArc / 2)), cx, cy)
  }
  return ensureWinding(dedupeRing(ring), true)
}

/**
 * 非标准内齿轮（NC3/NC5）的带齿内孔边界（返回 CCW，孔用时反转为 CW）。
 *
 * 对应原插件 coronasnostd / coronashelnostdr：单个"外齿楔"绕偏心轴
 * C（偏心距 e = ρRoot + ρTip）做 z 次圆形阵列，与外圆环合并并裁掉外圆
 * 以外部分。最终交付体外圆居中（moveocc 之后），内齿廓为该阵列相对
 * 中心 C 的包络——是真实渐开线内齿廓的近似（与标准内齿轮径向尺寸一致：
 * 齿顶向内 ρTip=rp-m，齿间在外 ρRoot=rp+1.25m），仅齿侧曲线由偏心
 * 包络形成。
 *
 * 构造（中心 C 已在原点）：
 *   楔顶点 O'=(-e,0)，楔为顶点发出、半角 δ 的扇形，外缘为半径 ρRoot
 *   的齿顶弧 + 渐开线齿侧（齿侧在基圆内为径向直线）。对每个齿在绕 C
 *   的半个节距角内做光线投射，取与楔多边形的最近交点，即得内边界。
 */
export function nonStandardInternalHole(spec: InvoluteSpec, b: SegmentBudget): Vec2[] {
  const { z, rb, m: mod, rp } = spec
  const pitch = TAU / z
  const rhoRoot = rp + 1.25 * mod // 内齿齿间（外）= 环形内缘
  const rhoTip = rp - mod          // 内齿齿顶（内）
  const e = rhoRoot + rhoTip       // 楔顶点到中心的偏心距

  // 单齿楔多边形（顶点位于原点，齿朝 +x）
  let u1 = uAtRadius(rb, rhoRoot)
  const half = (u: number) => externalHalfThickness(spec, rb * Math.sqrt(1 + u * u))
  // 低齿数根切：齿顶半厚在 ρRoot 处可能为负，收缩到零厚（尖齿）半径
  if (half(u1) < 0) {
    let lo = 0, hi = u1
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2
      if (half(mid) > 0) lo = mid; else hi = mid
    }
    u1 = lo
  }
  const us = linspace(0, u1, b.flank + 1)
  const halfTip = half(u1)
  const tipSeg = halfTip > 1e-6 ? b.tipArc : 0
  const wedge: Vec2[] = [[0, 0]]
  for (const u of us) wedge.push(polar(rb * Math.sqrt(1 + u * u), -half(u)))
  if (tipSeg > 0) appendArc(wedge, rhoRoot, -halfTip, halfTip, tipSeg, 0, 0)
  else if (halfTip <= 1e-6) wedge.push(polar(rb * Math.sqrt(1 + u1 * u1), 0))
  for (let i = us.length - 1; i >= 0; i--) {
    const u = us[i]
    wedge.push(polar(rb * Math.sqrt(1 + u * u), half(u)))
  }
  // 平移到交付坐标：楔顶点 (-e, 0)，齿顶指向中心
  const wedgeT = wedge.map(([x, y]) => [x - e, y] as Vec2)

  // 每齿角采样数（覆盖两侧齿侧 + 齿顶弧的折线段数）
  const nPerTooth = Math.max(8, 2 * b.flank + b.tipArc + 3)
  const ring: Vec2[] = []
  for (let k = 0; k < z; k++) {
    const axis = Math.PI + k * pitch
    for (let j = 0; j <= nPerTooth; j++) {
      const psi = -pitch / 2 + (pitch * j) / nPerTooth
      const phi = axis + psi
      // 齿楔必须随扇区一起旋转：在楔自身局部坐标（楔轴指向 π）内做光线投射，
      // 再把交点距离 t 放到世界角 phi。此前直接用世界方向对固定楔投光，
      // 除 k=0 外所有齿都落不到楔上（整圈退化为光孔）。
      const lx = -Math.cos(psi), ly = -Math.sin(psi)
      const t = rayNearest(lx, ly, wedgeT, rhoRoot)
      ring.push([t * Math.cos(phi), t * Math.sin(phi)])
    }
  }
  return ensureWinding(dedupeRing(ring), true)
}

/** 原点射线 p=t·d 与多边形边界的最近正交点距离；无交点返回 fallback。 */
function rayNearest(dx: number, dy: number, poly: Vec2[], fallback: number): number {
  let tMin = Infinity
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i]
    const [bx, by] = poly[(i + 1) % poly.length]
    const vx = bx - ax, vy = by - ay
    // 解 t·d = a + s·v（[d -v][t s]' = a）
    const det = vx * dy - dx * vy
    if (Math.abs(det) < 1e-14) continue
    const t = (vx * ay - vy * ax) / det
    const s = (dx * ay - dy * ax) / det
    if (t >= 1e-9 && s >= -1e-9 && s <= 1 + 1e-9 && t < tMin) tMin = t
  }
  // 远侧交点落在环形实体内部（t≥fallback）时内边界仍为环内缘
  return tMin === Infinity ? fallback : Math.min(tMin, fallback)
}

/** 圆环节点（用于外圆/轮毂等），返回 CCW */
export function circleRing(r: number, segments: number, cx = 0, cy = 0, a0 = 0, a1 = TAU): Vec2[] {
  const full = Math.abs(a1 - a0) >= TAU - 1e-9
  const ring: Vec2[] = []
  const n = full ? segments : segments + 1
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * i) / segments
    ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return ring
}

/** 去除环中连续重复点（含首尾相接），避免退化边导致缝合时壳被切开 */
function dedupeRing(ring: Vec2[]): Vec2[] {
  const out: Vec2[] = []
  for (const p of ring) {
    const q = out[out.length - 1]
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-8) out.push(p)
  }
  if (out.length > 1) {
    const a = out[0]
    const b = out[out.length - 1]
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-8) out.pop()
  }
  return out
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}
