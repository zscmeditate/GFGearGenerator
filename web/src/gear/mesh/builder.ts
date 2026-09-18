import earcut from 'earcut'
import { TAU, type Vec2 } from '../math'
import { MeshData } from './MeshData'

export interface Section {
  z: number
  /** 外环（CCW） */
  outer: Vec2[]
  /** 孔环（CW） */
  holes: Vec2[][]
}

interface LayerInfo {
  base: number
  rings: Vec2[][]
  tris: number[]
}

/**
 * 沿 Z 轴堆叠多个截面生成实体（截面间以四边形连接，首尾加盖）。
 * 相邻层同名环的顶点数必须一致（用于扭转/错切拉伸）。
 */
export function extrudeSections(sections: Section[], partName?: string): MeshData {
  const mesh = new MeshData()
  if (partName) mesh.beginPart(partName)

  const layers: LayerInfo[] = sections.map((sec) => {
    const rings = [sec.outer, ...sec.holes]
    const data: number[] = []
    const holeStarts: number[] = []
    for (let ri = 0; ri < rings.length; ri++) {
      if (ri > 0) holeStarts.push(data.length / 2)
      for (const [x, y] of rings[ri]) data.push(x, y)
    }
    const tris = earcut(data, holeStarts)
    const base = mesh.positions.length / 3
    for (let i = 0; i < data.length; i += 2) mesh.vertex(data[i], data[i + 1], sec.z)
    return { base, rings, tris }
  })

  // 层间侧壁（逐环连接，外环 CCW / 孔环 CW 同一四边形绕序均得到朝外法线）
  for (let j = 0; j < layers.length - 1; j++) {
    const lo = layers[j]
    const hi = layers[j + 1]
    for (let ri = 0; ri < lo.rings.length; ri++) {
      const rb = lo.rings[ri]
      const rt = hi.rings[ri]
      const n = Math.min(rb.length, rt.length)
      for (let i = 0; i < n; i++) {
        const a = lo.base + ringOffset(lo.rings, ri) + i
        const b = lo.base + ringOffset(lo.rings, ri) + ((i + 1) % n)
        const c = hi.base + ringOffset(hi.rings, ri) + ((i + 1) % n)
        const d = hi.base + ringOffset(hi.rings, ri) + i
        mesh.quad(a, b, c, d)
      }
    }
  }

  // 底盖（反向，法线 -Z）
  if (layers.length) {
    const bottom = layers[0]
    for (let i = 0; i < bottom.tris.length; i += 3) {
      mesh.tri(bottom.base + bottom.tris[i], bottom.base + bottom.tris[i + 2], bottom.base + bottom.tris[i + 1])
    }
    // 顶盖（法线 +Z）
    const top = layers[layers.length - 1]
    for (let i = 0; i < top.tris.length; i += 3) {
      mesh.tri(top.base + top.tris[i], top.base + top.tris[i + 1], top.base + top.tris[i + 2])
    }
  }

  if (partName) mesh.endPart()
  return mesh
}

function ringOffset(rings: Vec2[][], ri: number): number {
  let off = 0
  for (let k = 0; k < ri; k++) off += rings[k].length
  return off
}

export function rotateRing(ring: Vec2[], angle: number, cx = 0, cy = 0): Vec2[] {
  const s = Math.sin(angle), c = Math.cos(angle)
  return ring.map(([x, y]) => {
    const dx = x - cx, dy = y - cy
    return [cx + dx * c - dy * s, cy + dx * s + dy * c]
  })
}

export function translateRing(ring: Vec2[], dx: number, dy: number): Vec2[] {
  return ring.map(([x, y]) => [x + dx, y + dy])
}

export interface TwistConfig {
  height: number
  /** 全高总扭转角（弧度，含旋向符号） */
  totalTwist: number
  layers: number
  /** 人字齿：两半反向 */
  doubleHelical?: boolean
}

/**
 * 通用扭转棱柱：sectionFactory(twistAngle) 给出该层截面。
 */
export function twistedExtrude(
  sectionFactory: (twistAngle: number) => { outer: Vec2[]; holes: Vec2[][] },
  cfg: TwistConfig,
  partName?: string
): MeshData {
  const n = Math.max(2, cfg.layers)
  const sections: Section[] = []
  for (let j = 0; j < n; j++) {
    const t = j / (n - 1)
    let twist: number
    if (cfg.doubleHelical) {
      // 两半齿宽各为 h/2、螺旋角同为 β、旋向相反：每半扭转幅值为全高扭转之半，
      // 相位 0→+T/2（中部汇合）→0，两端齿相对齐（人字/V 形）
      twist = t <= 0.5 ? cfg.totalTwist * t : cfg.totalTwist * (1 - t)
    } else {
      twist = cfg.totalTwist * t
    }
    const s = sectionFactory(twist)
    sections.push({ z: cfg.height * t, outer: s.outer, holes: s.holes })
  }
  return extrudeSections(sections, partName)
}

/** Z 轴圆柱（带盖），可带锥度 rBottom→rTop（用于锥齿轮坯/轮毂） */
export function cylinderZ(rBottom: number, rTop: number, height: number, segments: number, z0 = 0, partName?: string): MeshData {
  const sections: Section[] = []
  const make = (r: number, z: number) => {
    const outer: Vec2[] = []
    for (let i = 0; i < segments; i++) {
      const a = (TAU * i) / segments
      outer.push([r * Math.cos(a), r * Math.sin(a)])
    }
    sections.push({ z, outer, holes: [] })
  }
  make(rBottom, z0)
  make(rTop, z0 + height)
  return extrudeSections(sections, partName)
}

/**
 * 梯形截面螺旋肋（蜗杆齿），绕 Z 轴生成，之后可整体变换到 X 轴。
 * 返回 MeshData（不含芯轴）。
 */
export function helicalThread(options: {
  /** 芯轴半径（齿根） */
  rRoot: number
  /** 齿顶半径 */
  rTip: number
  /** 导程（单头 p=πm） */
  lead: number
  /** 总长（mm） */
  length: number
  /** 齿顶轴向半宽 */
  halfTipWidth: number
  /** 齿根轴向半宽 */
  halfRootWidth: number
  /** 每周分段 */
  segPerTurn: number
  /** 旋向：true 左旋 */
  leftHand?: boolean
  partName?: string
}): MeshData {
  const { rRoot, rTip, lead, length, halfTipWidth, halfRootWidth, segPerTurn } = options
  const mesh = new MeshData()
  if (options.partName) mesh.beginPart(options.partName)

  const turns = length / lead
  const n = Math.max(8, Math.ceil(turns * segPerTurn))
  const sign = options.leftHand ? -1 : 1
  // 截面四角（轴向 w，径向 r）
  const corners = [
    { w: halfRootWidth, r: rRoot },
    { w: halfTipWidth, r: rTip },
    { w: -halfTipWidth, r: rTip },
    { w: -halfRootWidth, r: rRoot }
  ]
  // 每片 4 顶点
  const ringIndex = (j: number, ci: number) => ringStart(j) + ci
  const starts: number[] = []
  function ringStart(j: number) {
    return starts[j]
  }
  for (let j = 0; j <= n; j++) {
    const t = j / n
    const z = -length / 2 + t * length
    const theta = sign * TAU * turns * t
    const cs = Math.cos(theta), sn = Math.sin(theta)
    starts[j] = mesh.positions.length / 3
    for (const c of corners) {
      // 局部角位置随轴向宽度产生螺旋相位（齿侧垂直于轴线的简化梯形）
      const rr = c.r
      const zz = z + c.w
      mesh.vertex(rr * cs, rr * sn, zz)
    }
  }
  for (let j = 0; j < n; j++) {
    for (let ci = 0; ci < 4; ci++) {
      const a = ringIndex(j, ci)
      const b = ringIndex(j, (ci + 1) % 4)
      const c = ringIndex(j + 1, (ci + 1) % 4)
      const d = ringIndex(j + 1, ci)
      mesh.quad(a, b, c, d)
    }
  }
  // 两端封口：直接封梯形截面（2 个三角形），不得引到轴心——否则会在蜗杆端部
  // 形成从轴心到齿顶的圆锥状虚假面片
  const capRing = (j: number, reverse: boolean) => {
    const a = ringIndex(j, 0)
    const b = ringIndex(j, 1)
    const c = ringIndex(j, 2)
    const d = ringIndex(j, 3)
    if (reverse) {
      mesh.tri(a, c, b)
      mesh.tri(a, d, c)
    } else {
      mesh.tri(a, b, c)
      mesh.tri(a, c, d)
    }
  }
  capRing(0, true)
  capRing(n, false)

  if (options.partName) mesh.endPart()
  return mesh
}
