// 临时脚本：导出标准内齿轮孔环截面，检查左右对称性并输出 SVG（验证后删除）
import { writeFileSync } from 'fs'
import { computeInvolute, internalToothRing, budgetFor, degToRad, type Vec2 } from './src/gear/math'

const spec = computeInvolute({ m: 2, z: 20, pressureAngle: degToRad(20), X: 0 })
const ring: Vec2[] = internalToothRing(spec, budgetFor(20, 'high'))

const { z, rp, rb } = spec
const rTip = rp - spec.m
const rGap = rp + 1.25 * spec.m
const pitch = (Math.PI * 2) / z

// --- 对称性检查：把整环关于齿 k=0 的中心轴（x 轴）镜像，与原环比较点集 ---
// 镜像点 (x,y)->(x,-y)；对每个原点找最近镜像点距离
let maxAsym = 0
for (const [x, y] of ring) {
  const mx = x, my = -y
  let best = Infinity
  for (const [px, py] of ring) {
    const d = Math.hypot(px - mx, py - my)
    if (d < best) best = d
  }
  maxAsym = Math.max(maxAsym, best)
}
console.log(`points=${ring.length} rp=${rp.toFixed(3)} rb=${rb.toFixed(3)} rTip=${rTip} rGap=${rGap}`)
console.log(`mirror-asymmetry max nearest-distance = ${maxAsym.toFixed(6)} mm ${maxAsym < 0.01 ? '(对称 OK)' : '(不对称!)'}`)

// 齿根间隙宽度
const tauGap = (Math.PI / (2 * z)) - Math.tan(spec.apt) + spec.apt + (Math.tan(Math.acos(rb / rGap)) - Math.acos(rb / rGap))
console.log(`root gap angle=${(((Math.PI * 2) / z) / 2 - tauGap * 0 + (Math.PI / z) - (Math.PI / (2 * z) - Math.tan(spec.apt) + spec.apt + (Math.tan(Math.acos(rb / rGap)) - Math.acos(rb / rGap)))).toFixed(4)} rad, arc=${(((Math.PI / z) - (Math.PI / (2 * z) - Math.tan(spec.apt) + spec.apt + (Math.tan(Math.acos(rb / rGap)) - Math.acos(rb / rGap)))) * 2 * rGap).toFixed(3)} mm`)

// --- SVG 导出 ---
const S = 10 // 缩放
const cx = 260, cy = 260
const P = (p: Vec2) => `${(cx + p[0] * S).toFixed(2)},${(cy - p[1] * S).toFixed(2)}`
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="560" viewBox="0 0 560 560"><rect width="560" height="560" fill="white"/>`
svg += `<polyline points="${ring.map(P).join(' ')}" fill="none" stroke="#1565c0" stroke-width="1.4"/>`
for (const [r, col] of [[rp, '#e53935'], [rb, '#fb8c00'], [rTip, '#43a047'], [rGap, '#8e24aa']] as const) {
  svg += `<circle cx="${cx}" cy="${cy}" r="${(r * S).toFixed(1)}" fill="none" stroke="${col}" stroke-width="0.8" stroke-dasharray="5 4" opacity="0.7"/>`
}
// 齿 0 中心对称轴
svg += `<line x1="${cx}" y1="${cy}" x2="${cx + (rGap + 3) * S}" y2="${cy}" stroke="#999" stroke-width="0.7" stroke-dasharray="3 3"/>`
svg += `</svg>`
writeFileSync('tmp-profile.svg', svg)
console.log('SVG written: tmp-profile.svg')
