/**
 * 软件渲染对比：复现 app 默认倾斜透视视角 vs 正俯视视角
 * 验证内齿轮"鳍片/不对称"观感是否纯属视角+光照错觉
 */
import { buildCylindricalGear } from './src/gear/geometry/cylindrical'
import { getSceneLightingForBg } from './src/composables/useSceneLighting'

const m = 3, z = 17, paDeg = 20, height = 10, rim = 5
const mesh = buildCylindricalGear({ m, z, pressureAngleDeg: paDeg, height, rimThickness: rim, quality: 'high', internal: true })
// 与 app 一致：圆柱齿轮统一 layFlat（轴 Z→Y，齿面朝上）
mesh.transform((x, y, z) => [x, z, -y])

const cfg = getSceneLightingForBg('#e0e5ec')
const keyPos = cfg.keyPosition
console.log('光照配置: keyPosition=', keyPos, 'keyIntensity=', cfg.keyIntensity, 'matColor=', cfg.matColor.toString(16))

type V3 = [number, number, number]
const P = mesh.positions, I = mesh.indices

// 相机参数（复现 fitView）
const bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] } as any
for (let i = 0; i < P.length; i += 3) {
  for (let k = 0; k < 3; k++) {
    if (P[i + k] < bb.min[k]) bb.min[k] = P[i + k]
    if (P[i + k] > bb.max[k]) bb.max[k] = P[i + k]
  }
}
const size: V3 = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]]
const radius = Math.max(...size) / 2
const fov = (45 * Math.PI) / 180
const dist = (radius / Math.sin(fov / 2)) * 0.85
console.log(`radius=${radius.toFixed(1)} dist=${dist.toFixed(1)}`)

function norm(v: V3): V3 {
  const l = Math.hypot(...v) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
function sub(a: V3, b: V3): V3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function dot(a: V3, b: V3) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }

function render(name: string, camPos: V3, upHint: V3) {
  const target: V3 = [0, 0, 0]
  const fwd = norm(sub(target, camPos))
  const right = norm(cross(fwd, upHint))
  const up = cross(right, fwd)
  const f = 300 / Math.tan(fov / 2)

  // 变换所有顶点到视图空间
  const N = P.length / 3
  const vx = new Float64Array(N), vy = new Float64Array(N), vz = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const v: V3 = [P[i * 3] - camPos[0], P[i * 3 + 1] - camPos[1], P[i * 3 + 2] - camPos[2]]
    vx[i] = dot(v, right); vy[i] = dot(v, up); vz[i] = dot(v, fwd)
  }

  // 收集三角形并按深度排序（远 → 近）
  const tris: { idx: number; depth: number; shade: number }[] = []
  const L = norm(keyPos as V3) // 主光源方向（指向光源）
  const camDir = norm(camPos)
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2]
    const pa: V3 = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]]
    const pb: V3 = [P[b * 3], P[b * 3 + 1], P[b * 3 + 2]]
    const pc: V3 = [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]]
    let n = cross(sub(pb, pa), sub(pc, pa))
    const nl = Math.hypot(...n) || 1
    n = [n[0] / nl, n[1] / nl, n[2] / nl]
    // DoubleSide：法线朝向相机
    if (dot(n, camDir) < 0) n = [-n[0], -n[1], -n[2]]
    const centroid: V3 = [(pa[0] + pb[0] + pc[0]) / 3, (pa[1] + pb[1] + pc[1]) / 3, (pa[2] + pb[2] + pc[2]) / 3]
    const depth = dot(sub(centroid, camPos), fwd)
    // 简化光照：环境 + 主光 Lambert + 半球近似
    const lambert = Math.max(0, dot(n, L))
    const hemi = 0.5 + 0.5 * n[1] // 天空/地面
    const shade = Math.min(1, 0.25 + 0.25 * hemi + 0.75 * lambert)
    tris.push({ idx: t, depth, shade })
  }
  tris.sort((p, q) => q.depth - p.depth)

  // 输出 SVG
  const W = 600
  // 投影包围盒自检
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9
  for (let i = 0; i < N; i++) {
    if (vz[i] <= 0) continue
    const sx = W / 2 + (vx[i] / vz[i]) * f, sy = W / 2 - (vy[i] / vz[i]) * f
    if (sx < minX) minX = sx; if (sx > maxX) maxX = sx
    if (sy < minY) minY = sy; if (sy > maxY) maxY = sy
  }
  console.log(`[${name}] 投影包围盒: x [${minX.toFixed(0)}, ${maxX.toFixed(0)}], y [${minY.toFixed(0)}, ${maxY.toFixed(0)}]`)
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}"><rect width="${W}" height="${W}" fill="#e0e5ec"/>`
  for (const tr of tris) {
    const a = I[tr.idx], b = I[tr.idx + 1], c = I[tr.idx + 2]
    const sx = (i: number) => (W / 2 + (vx[i] / vz[i]) * f).toFixed(1)
    const sy = (i: number) => (W / 2 - (vy[i] / vz[i]) * f).toFixed(1)
    const g = Math.round(tr.shade * 255)
    svg += `<polygon points="${sx(a)},${sy(a)} ${sx(b)},${sy(b)} ${sx(c)},${sy(c)}" fill="rgb(${g},${g},${g})" stroke="none"/>`
  }
  svg += `</svg>`
  // 同步写文件
  return (globalThis as any).__fs.writeFile(`tmp-out-${name}.svg`, svg)
}

;(globalThis as any).__fs = await import('fs/promises')
// 1. app 默认视角：dir (0.75, 0.55, 0.9) 归一化 × dist（齿轮平躺，Y 向上）
const d1 = norm([0.75, 0.55, 0.9])
await render('app-view', [d1[0] * dist, d1[1] * dist, d1[2] * dist], [0, 1, 0])
// 2. 正俯视（沿齿轮轴 Y 向下看，layFlat 后轴向为 Y）
await render('axis-view', [0, dist, 0], [0, 0, -1])
console.log('已输出 tmp-out-app.svg (app默认视角) 与 tmp-out-axis.svg (正俯视)')
