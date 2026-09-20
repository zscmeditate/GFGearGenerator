// 可视化当前 internalToothRing 输出，特别标注渐开线曲率方向
import { writeFileSync } from 'node:fs'

const TAU = Math.PI * 2
const degToRad = (d) => (d * Math.PI) / 180
const inv = (x) => Math.tan(x) - x
const linspace = (s, e, c) => { if (c <= 1) return [s]; const out = []; const st = (e - s) / (c - 1); for (let i = 0; i < c; i++) out.push(s + st * i); return out }
const uAtRadius = (rb, r) => (r > rb ? Math.sqrt((r / rb) ** 2 - 1) : 0)

function internalHalfThickness(rb, apt, z, X, r) {
  const at = Math.acos(Math.min(1, rb / r))
  return Math.PI / (2 * z) - (2 * X * Math.tan(apt)) / z - inv(apt) + inv(at)
}
function appendArc(ring, r, a0, a1, seg, cx, cy) {
  for (let i = 1; i <= seg; i++) {
    const a = a0 + ((a1 - a0) * i) / seg
    ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
}

// 复制 math.ts 的 internalToothRing（当前实现）
function internalToothRing(m, z, aptDeg, X, budget) {
  const apt = degToRad(aptDeg)
  const dp = m * z, rp = dp / 2, db = dp * Math.cos(apt), rb = db / 2
  const pitch = TAU / z
  const rTip = rp - m
  const rRoot = rp + 1.25 * m
  const tipInsideBase = rTip < rb
  const tAt = (r) => (r > rb ? Math.sqrt((r / rb) ** 2 - 1) : 0)
  const tRoot = tAt(rRoot)
  const tTip = tipInsideBase ? 0 : tAt(rTip)
  const half = (t) => internalHalfThickness(rb, apt, z, X, rb * Math.sqrt(1 + t * t))
  const halfBase = Math.PI / (2 * z) - (2 * X * Math.tan(apt)) / z - inv(apt)
  const halfTip = tipInsideBase ? halfBase : half(tTip)
  const halfRoot = half(tRoot)
  const ts = linspace(tTip, tRoot, budget.flank + 1)
  const P = (r, a) => [r * Math.cos(a), r * Math.sin(a)]
  const ring = []
  for (let k = 0; k < z; k++) {
    const c = k * pitch
    for (let i = ts.length - 1; i >= 0; i--) {
      const t = ts[i]
      ring.push(P(rb * Math.sqrt(1 + t * t), c - half(t)))
    }
    if (tipInsideBase) ring.push(P(rTip, c - halfBase))
    appendArc(ring, rTip, c - halfTip, c + halfTip, budget.tipArc, 0, 0)
    if (tipInsideBase) ring.push(P(rTip, c + halfBase))
    for (const t of ts) {
      ring.push(P(rb * Math.sqrt(1 + t * t), c + half(t)))
    }
    appendArc(ring, rRoot, c + halfRoot, c + pitch - halfRoot, budget.rootArc, 0, 0)
  }
  return { ring, info: { rp, rb, rTip, rRoot, halfTip, halfRoot, pitch, tipInsideBase } }
}

// 单独绘制一个齿的渐开线，标注齿顶/齿根、曲率方向
function drawSingleTooth(m, z, aptDeg, X) {
  const apt = degToRad(aptDeg)
  const dp = m * z, rp = dp / 2, db = dp * Math.cos(apt), rb = db / 2
  const rTip = rp - m, rRoot = rp + 1.25 * m
  const tipInsideBase = rTip < rb
  const tAt = (r) => (r > rb ? Math.sqrt((r / rb) ** 2 - 1) : 0)
  const tRoot = tAt(rRoot), tTip = tipInsideBase ? 0 : tAt(rTip)
  const half = (t) => internalHalfThickness(rb, apt, z, X, rb * Math.sqrt(1 + t * t))
  const halfTip = tipInsideBase ? Math.PI / (2 * z) - (2 * X * Math.tan(apt)) / z - inv(apt) : half(tTip)
  const halfRoot = half(tRoot)
  const ts = linspace(tTip, tRoot, 20)
  // 左齿面：齿根→齿顶（沿 t 减小方向），即 c - half(t)
  // 渐开线参数方程：r(t)=rb*sqrt(1+t²), θ(t) = c - half(t) - (involute phase)
  // 注意：渐开线在极坐标下 θ = c - half(t)，half(t) 是相对齿中心线的半角
  // 渐开线方程 θ(r) = c - half(r) ，但渐开线本身的参数化是 x=rb*cos(t)+rb*t*sin(t), y=rb*sin(t)-rb*t*cos(t)
  // 我们用的是 r-θ 参数化，half(r) 包含 inv 项保证渐开线
  // 渐开线方向：从齿根（t 大）到齿顶（t 小），r 减小、half 减小、θ = c-half 增大 → CCW
  return { ts, half, rTip, rRoot, rb, halfTip, halfRoot, tipInsideBase }
}

const budget = { flank: 8, tipArc: 6, rootArc: 6 }
// m=3 z=17 a=20 X=0
const gear = internalToothRing(3, 17, 20, 0, budget)
console.log('gear info:', gear.info)

// 渲染：整体齿轮 + 单齿特写
function toSvg(ring, info, label, filename, zoomTooth = false) {
  const maxR = info.rRoot * 1.1
  const size = 600
  const scale = (size / 2 - 30) / maxR
  const cx = size / 2, cy = size / 2
  const fmt = (p) => `${(cx + p[0] * scale).toFixed(2)},${(cy - p[1] * scale).toFixed(2)}`
  let paths = ''
  // 参考圆
  for (const [r, color, dash, lbl] of [
    [info.rp, '#2196f3', '4', 'rp'],
    [info.rb, '#4caf50', '2', 'rb'],
    [info.rTip, '#f44336', '3', 'rTip(齿顶)'],
    [info.rRoot, '#ff9800', '3', 'rRoot(齿根)']
  ]) {
    paths += `<circle cx="${cx}" cy="${cy}" r="${(r * scale).toFixed(2)}" fill="none" stroke="${color}" stroke-width="1" stroke-dasharray="${dash}" opacity="0.5"/>`
    paths += `<text x="${cx + r * scale + 4}" y="${cy - 4}" font-size="10" font-family="monospace" fill="${color}">${lbl}=${r.toFixed(2)}</text>`
  }
  // 齿轮轮廓
  const d = ring.map(fmt).join(' L')
  paths += `<path d="M${d} Z" fill="rgba(100,149,237,0.15)" stroke="#1565c0" stroke-width="1.2"/>`
  // 标注齿中心和齿顶位置
  if (zoomTooth) {
    // 标注第一齿的中心方向、齿顶、齿根
    const c0 = 0
    const tipPt = [info.rTip * Math.cos(c0), info.rTip * Math.sin(c0)]
    const rootPt = [info.rRoot * Math.cos(c0), info.rRoot * Math.sin(c0)]
    paths += `<circle cx="${fmt(tipPt).split(',')[0]}" cy="${fmt(tipPt).split(',')[1]}" r="3" fill="#f44336"/>`
    paths += `<circle cx="${fmt(rootPt).split(',')[0]}" cy="${fmt(rootPt).split(',')[1]}" r="3" fill="#ff9800"/>`
  }
  const legend = `<text x="10" y="20" font-size="14" font-family="monospace" font-weight="600">${label}</text>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" style="background:#fafafa">${paths}${legend}</svg>`
  writeFileSync(filename, svg)
}

toSvg(gear.ring, gear.info, 'Internal m=3 z=17 a=20 X=0', '/workspace/viz_tooth_3_17.svg', false)

// 单齿特写：放大第一个齿
function drawToothDetail(m, z, aptDeg, X, filename) {
  const apt = degToRad(aptDeg)
  const dp = m * z, rp = dp / 2, db = dp * Math.cos(apt), rb = db / 2
  const rTip = rp - m, rRoot = rp + 1.25 * m
  const tipInsideBase = rTip < rb
  const tAt = (r) => (r > rb ? Math.sqrt((r / rb) ** 2 - 1) : 0)
  const tRoot = tAt(rRoot), tTip = tipInsideBase ? 0 : tAt(rTip)
  const half = (t) => internalHalfThickness(rb, apt, z, X, rb * Math.sqrt(1 + t * t))
  const halfBase = Math.PI / (2 * z) - (2 * X * Math.tan(apt)) / z - inv(apt)
  const halfTip = tipInsideBase ? halfBase : half(tTip)
  const halfRoot = half(tRoot)
  const ts = linspace(tTip, tRoot, 20)

  // 齿1中心在 0°
  // 左齿面点（齿根→齿顶）：c - half(t), r = rb*sqrt(1+t²)
  // 右齿面点（齿顶→齿根）：c + half(t), r = rb*sqrt(1+t²)
  const leftFlank = ts.map((t, i) => [rb * Math.sqrt(1 + t * t) * Math.cos(-half(t)), rb * Math.sqrt(1 + t * t) * Math.sin(-half(t))])
  const rightFlank = ts.map((t) => [rb * Math.sqrt(1 + t * t) * Math.cos(half(t)), rb * Math.sqrt(1 + t * t) * Math.sin(half(t))])

  // 齿顶弧
  const tipArc = []
  for (let i = 0; i <= 8; i++) {
    const a = -halfTip + (2 * halfTip * i) / 8
    tipArc.push([rTip * Math.cos(a), rTip * Math.sin(a)])
  }
  // 齿根弧
  const rootArc = []
  for (let i = 0; i <= 8; i++) {
    const a = halfRoot + ((2 * Math.PI / z - 2 * halfRoot) * i) / 8
    rootArc.push([rRoot * Math.cos(a), rRoot * Math.sin(a)])
  }

  // 拼接：左齿面（齿根→齿顶）+ 齿顶弧 + 右齿面（齿顶→齿根）+ 齿根弧
  const toothPoly = []
  for (let i = leftFlank.length - 1; i >= 0; i--) toothPoly.push(leftFlank[i])
  toothPoly.push(...tipArc)
  for (const p of rightFlank) toothPoly.push(p)
  toothPoly.push(...rootArc)

  // SVG
  const size = 600
  // 放大单齿：以齿中心 0° 为视图中线，r 范围 rTip..rRoot
  const rMin = rTip * 0.9, rMax = rRoot * 1.05
  const xRange = [rMin * 0.9, rMax]
  const yRange = [-rMax * Math.sin(halfRoot) * 1.2, rMax * Math.sin(halfRoot) * 1.2]
  const xScale = (size - 80) / (xRange[1] - xRange[0])
  const yScale = (size - 80) / (yRange[1] - yRange[0])
  const sc = Math.min(xScale, yScale)
  const cx = 40 - xRange[0] * sc
  const cy = size / 2 - (yRange[0] + yRange[1]) / 2 * sc
  const fmt = (p) => `${(cx + p[0] * sc).toFixed(2)},${(cy - p[1] * sc).toFixed(2)}`

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" style="background:#fafafa">`
  // 参考圆（垂直线）
  for (const [r, color, lbl] of [[rp, '#2196f3', 'rp'], [rb, '#4caf50', 'rb'], [rTip, '#f44336', 'rTip'], [rRoot, '#ff9800', 'rRoot']]) {
    const x = cx + r * sc
    svg += `<line x1="${x.toFixed(2)}" y1="0" x2="${x.toFixed(2)}" y2="${size}" stroke="${color}" stroke-width="0.5" stroke-dasharray="3" opacity="0.4"/>`
    svg += `<text x="${x.toFixed(2)}" y="15" font-size="10" font-family="monospace" fill="${color}">${lbl}=${r.toFixed(2)}</text>`
  }
  // 齿形多边形
  const d = toothPoly.map(fmt).join(' L')
  svg += `<path d="M${d} Z" fill="rgba(100,149,237,0.25)" stroke="#1565c0" stroke-width="1.5"/>`
  // 标注齿顶/齿根/左/右
  // 齿顶中心 (rTip, 0)
  const tipC = fmt([rTip, 0])
  svg += `<circle cx="${tipC.split(',')[0]}" cy="${tipC.split(',')[1]}" r="4" fill="#f44336"/>`
  svg += `<text x="${parseFloat(tipC.split(',')[0]) + 8}" y="${parseFloat(tipC.split(',')[1]) + 4}" font-size="12" font-family="monospace" fill="#f44336" font-weight="600">齿顶</text>`
  // 齿根中心（齿间底部，在 pitch/2 处的 rRoot）
  const gapAngle = Math.PI / z
  const rootC = fmt([rRoot * Math.cos(gapAngle), rRoot * Math.sin(gapAngle)])
  svg += `<circle cx="${rootC.split(',')[0]}" cy="${rootC.split(',')[1]}" r="4" fill="#ff9800"/>`
  svg += `<text x="${parseFloat(rootC.split(',')[0]) + 8}" y="${parseFloat(rootC.split(',')[1]) + 4}" font-size="12" font-family="monospace" fill="#ff9800" font-weight="600">齿根(齿间底)</text>`
  // 左/右齿面标注
  const leftMid = leftFlank[Math.floor(leftFlank.length / 2)]
  const rightMid = rightFlank[Math.floor(rightFlank.length / 2)]
  const lC = fmt(leftMid)
  const rC = fmt(rightMid)
  svg += `<text x="${parseFloat(lC.split(',')[0]) - 50}" y="${parseFloat(lC.split(',')[1])}" font-size="11" font-family="monospace" fill="#1565c0">左齿面</text>`
  svg += `<text x="${parseFloat(rC.split(',')[0]) + 8}" y="${parseFloat(rC.split(',')[1])}" font-size="11" font-family="monospace" fill="#1565c0">右齿面</text>`

  svg += `<text x="10" y="${size - 10}" font-size="11" font-family="monospace" fill="#333">m=${m} z=${z} α=${aptDeg}° X=${X} | halfTip=${halfTip.toFixed(4)}rad halfRoot=${halfRoot.toFixed(4)}rad</text>`
  svg += `<text x="10" y="${size - 25}" font-size="10" font-family="monospace" fill="#666">内齿轮齿形：齿根在外(rRoot)，齿顶在内(rTip)；渐开线应向齿根方向凸出</text>`
  svg += `</svg>`
  writeFileSync(filename, svg)
  console.log(`wrote ${filename}`)
}

drawToothDetail(3, 17, 20, 0, '/workspace/viz_tooth_detail_3_17.svg')
