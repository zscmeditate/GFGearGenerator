/**
 * 内齿轮几何决定性诊断：
 * 1. 2D 齿环严格镜像对称性（关于每个齿中心轴反射后逐点精确匹配）
 * 2. 3D 网格前/后端面齿环是否一致（排除意外扭转）
 * 3. 孔壁三角形法线是否指向孔内（材料外侧为实体）
 * 4. 输出单个齿的放大 SVG 供目视检查
 */
import { computeInvolute, internalToothRing, budgetFor, TAU, polar, type Vec2 } from './src/gear/math'
import { buildCylindricalGear } from './src/gear/geometry/cylindrical'

const m = 3, z = 17, paDeg = 20, height = 10, rim = 5

// ---------- 1. 2D 严格镜像对称 ----------
const spec = computeInvolute({ m, z, pressureAngle: (paDeg * Math.PI) / 180 })
const b = budgetFor(z, 'high')
const ring = internalToothRing(spec, b) // CCW

// 关于 X 轴反射（齿 0 中心在角度 0）：(x,y) -> (x,-y)
// 完全对称 <=> 每个反射点都能在原环中找到精确匹配点
const key = (p: Vec2) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`
const set = new Set(ring.map(key))
let unmatched = 0
let worst = 0
for (const [x, y] of ring) {
  const ry: Vec2 = [x, -y]
  if (!set.has(key(ry))) {
    unmatched++
    // 找最近点距离
    let best = Infinity
    for (const [px, py] of ring) {
      const d = Math.hypot(px - ry[0], py - ry[1])
      if (d < best) best = d
    }
    if (best > worst) worst = best
  }
}
console.log(`[1] 2D 齿环点数=${ring.length}, 关于齿0中心轴反射后无法精确匹配的点=${unmatched}, 最坏最近距离=${worst.toExponential(3)} mm`)

// 另外检查每个齿的局部对称：把整环按 pitch 旋转后自比较（旋转对称性）
function rotateRing2(ring: Vec2[], ang: number): Vec2[] {
  const c = Math.cos(ang), s = Math.sin(ang)
  return ring.map(([x, y]) => [x * c - y * s, x * s + y * c] as Vec2)
}
let rotBad = 0
for (let k = 1; k < z; k++) {
  const rot = rotateRing2(ring, (k * TAU) / z)
  const s2 = new Set(rot.map(key))
  for (const p of ring) if (!s2.has(key(p))) rotBad++
}
console.log(`[1b] 旋转对称性: 全部 ${z} 个齿位旋转比较, 不匹配点=${rotBad}`)

// ---------- 2 & 3. 3D 网格检查 ----------
const mesh = buildCylindricalGear({ m, z, pressureAngleDeg: paDeg, height, rimThickness: rim, quality: 'high', internal: true })
const P = mesh.positions
const h2 = height / 2

// 收集顶/底盖上的孔环顶点（半径 < outerRim-2，z=±h2）
const outerRimR = spec.rp + m + rim
const frontBack = new Map<string, number[]>() // key: x,y (1e-4) -> [z count]
let nFront = 0, nBack = 0
for (let i = 0; i < P.length; i += 3) {
  const x = P[i], y = P[i + 1], zc = P[i + 2]
  const r = Math.hypot(x, y)
  if (r < outerRimR - 2) {
    if (Math.abs(zc - h2) < 1e-6) { nFront++; frontBack.set(`${x.toFixed(4)},${y.toFixed(4)}`, [h2]) }
    else if (Math.abs(zc + h2) < 1e-6) { nBack++ }
  }
}
console.log(`[2] 孔壁区域顶点: 前端面=${nFront}, 后端面=${nBack}`)
// 前后环顶点集合是否一致（无扭转时应完全一致）
const frontKeys = new Set<string>()
const backKeys = new Set<string>()
for (let i = 0; i < P.length; i += 3) {
  const x = P[i], y = P[i + 1], zc = P[i + 2]
  const r = Math.hypot(x, y)
  if (r < outerRimR - 2) {
    if (Math.abs(zc - h2) < 1e-6) frontKeys.add(`${x.toFixed(4)},${y.toFixed(4)}`)
    if (Math.abs(zc + h2) < 1e-6) backKeys.add(`${x.toFixed(4)},${y.toFixed(4)}`)
  }
}
let diff = 0
for (const k of frontKeys) if (!backKeys.has(k)) diff++
for (const k of backKeys) if (!frontKeys.has(k)) diff++
console.log(`[2b] 前后端面孔环顶点集合差异=${diff} (0=无扭转,形状一致)`)

// ---------- 3. 孔壁三角形法线方向 ----------
// 点在孔内测试：对 CCW 齿环做射线法
function pointInRing(pt: Vec2, poly: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if (yi > pt[0] !== yj > pt[0] && pt[1] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
// 注意上面的射线法写错了变量次序，重写：
function inPoly(pt: Vec2, poly: Vec2[]): boolean {
  let inside = false
  const [px, py] = pt
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

const I = mesh.indices
let wallTris = 0, normalOK = 0, normalBad = 0
const badSamples: string[] = []
for (let t = 0; t < I.length; t += 3) {
  const a = I[t] * 3, bb = I[t + 1] * 3, c = I[t + 2] * 3
  const za = P[a + 2], zb = P[bb + 2], zc = P[c + 2]
  // 侧壁三角形：z 不全相等
  if (Math.abs(za - zb) < 1e-9 && Math.abs(zb - zc) < 1e-9) continue // 盖面
  const ax = P[a], ay = P[a + 1], bx = P[bb], by = P[bb + 1], cx = P[c], cy = P[c + 1]
  const gx = (ax + bx + cx) / 3, gy = (ay + by + cy) / 3
  const gr = Math.hypot(gx, gy)
  // 只检查孔壁区域（远离外圈外缘）
  if (gr > outerRimR - 1.5) continue
  wallTris++
  // 法线 2D 分量
  const e1x = bx - ax, e1y = by - ay, e2x = cx - ax, e2y = cy - ay
  const e1z = zb - za, e2z = zc - za
  const Nx = e1y * e2z - e1z * e2y
  const Ny = e1z * e2x - e1x * e2z
  const Nz = e1x * e2y - e1y * e2x
  const nl = Math.hypot(Nx, Ny, Nz) || 1
  // 沿法线移动 eps 的测试点（把法线 2D 分量归一化后移动 0.05mm）
  const n2 = Math.hypot(Nx, Ny) || 1
  const testPt: Vec2 = [gx + (Nx / n2) * 0.05, gy + (Ny / n2) * 0.05]
  if (inPoly(testPt, ring)) normalOK++
  else {
    normalBad++
    if (badSamples.length < 5) badSamples.push(`centroid=(${gx.toFixed(2)},${gy.toFixed(2)}) r=${gr.toFixed(2)} n=(${(Nx/nl).toFixed(2)},${(Ny/nl).toFixed(2)},${(Nz/nl).toFixed(2)})`)
  }
}
console.log(`[3] 孔壁侧壁三角形=${wallTris}, 法线指向孔内(正确)=${normalOK}, 指向材料(错误)=${normalBad}`)
if (badSamples.length) console.log('    错误样本:', badSamples.join(' | '))

// ---------- 4. 单齿放大 SVG ----------
const S = 40 // 放大比例
const cx0 = 300, cy0 = 300
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><rect width="600" height="600" fill="white"/>`
// 参考线：齿0中心轴（X轴）与分度圆/齿顶/齿根
svg += `<line x1="0" y1="${cy0}" x2="600" y2="${cy0}" stroke="#eee"/>`
const circ = (r: number, col: string) => `<circle cx="${cx0}" cy="${cy0}" r="${r * S}" fill="none" stroke="${col}" stroke-dasharray="4 4"/>`
svg += circ(spec.rp, '#ddd') + circ(spec.rb, '#eee') + circ(spec.rp - m, '#fdd') + circ(spec.rp + 1.25 * m, '#dfd')
const pts = ring.map(([x, y]) => `${cx0 + x * S},${cy0 - y * S}`).join(' ')
svg += `<polyline points="${pts}" fill="none" stroke="#08f" stroke-width="1.2"/>`
// 对称轴与镜像点（红色小十字 = 反射点）
for (const [x, y] of ring) {
  const ry = -y
  svg += `<circle cx="${cx0 + x * S}" cy="${cy0 - ry * S}" r="0.8" fill="#f00" opacity="0.5"/>`
}
svg += `</svg>`
await (await import('fs/promises')).writeFile('tmp-tooth.svg', svg)
console.log(`[4] 单齿放大图已写 tmp-tooth.svg (S=${S}, 显示半径范围 ~15mm)`)
console.log(`    rTip=${(spec.rp - m).toFixed(3)} rb=${spec.rb.toFixed(3)} rp=${spec.rp} rGap=${(spec.rp + 1.25 * m).toFixed(3)}`)

// 齿宽检查
const half = (r: number) => { const at = Math.acos(Math.min(1, spec.rb / r)); return Math.PI / (2 * z) - Math.tan(spec.apt) + spec.apt + (r > spec.rb ? Math.tan(at) - at : 0) }
console.log(`    齿宽: 齿顶=${(2 * (spec.rp - m) * (Math.PI / (2 * z) - (Math.tan(spec.apt) - spec.apt))).toFixed(2)}mm 分度圆=${(2 * spec.rp * Math.PI / (2 * z)).toFixed(2)}mm 齿根=${(2 * (spec.rp + 1.25 * m) * half(spec.rp + 1.25 * m)).toFixed(2)}mm`)
