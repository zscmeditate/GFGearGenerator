/**
 * 将索引网格展开为非索引网格，并为每个三角面写入面法线（常数顶点法线）。
 *
 * 关键点：MeshData.quad 固定以 (a,b,c)+(a,c,d) 对角线把四边形切成两片。
 * 螺旋齿侧这类"扭转四边形"本身非平面，两片的几何法线不同；配合 flat shading
 * 会沿圆周呈现一明一暗的三角面交替。此处识别成对的两片（6 索引排布
 * a,b,c,a,c,d），让它们共享归一化后的合成法线，明暗只在真正的分段台阶处
 * 变化；盖面等独立三角仍用各自的面法线。
 *
 * 只影响渲染法线，positions/indices 与业务几何、导出完全一致。
 * （主视图 GearViewer 与 AI 会话预览画布共用）
 */
import * as THREE from 'three'

export function buildFlatGeometry(positions: ArrayLike<number>, indices: ArrayLike<number>): THREE.BufferGeometry {
  const triCount = indices.length / 3
  const nx = new Float32Array(triCount * 3)
  const va = [0, 0, 0], vb = [0, 0, 0], vc = [0, 0, 0]
  const readV = (idx: number, out: number[]) => {
    const o = idx * 3
    out[0] = positions[o]
    out[1] = positions[o + 1]
    out[2] = positions[o + 2]
  }
  for (let t = 0; t < triCount; t++) {
    const o = t * 3
    readV(indices[o], va)
    readV(indices[o + 1], vb)
    readV(indices[o + 2], vc)
    const abx = vb[0] - va[0], aby = vb[1] - va[1], abz = vb[2] - va[2]
    const acx = vc[0] - va[0], acy = vc[1] - va[1], acz = vc[2] - va[2]
    let x = aby * acz - abz * acy
    let y = abz * acx - abx * acz
    let z = abx * acy - aby * acx
    const len = Math.hypot(x, y, z)
    if (len > 1e-12) {
      x /= len
      y /= len
      z /= len
    }
    nx[t * 3] = x
    nx[t * 3 + 1] = y
    nx[t * 3 + 2] = z
  }

  // partner[t] >= 0 表示与同组另一片共享法线（存储对方的三角索引）
  const partner = new Int32Array(triCount).fill(-1)
  for (let p = 0; p + 6 <= indices.length; ) {
    // quad 连续写入 a,b,c,a,c,d：第 1/4、第 3/5 索引相同
    if (indices[p] === indices[p + 3] && indices[p + 2] === indices[p + 4]) {
      const t1 = p / 3
      partner[t1] = t1 + 1
      partner[t1 + 1] = t1
      p += 6
    } else {
      p += 3
    }
  }

  const finalNx = new Float32Array(triCount * 3)
  for (let t = 0; t < triCount; t++) {
    const k = partner[t]
    const o = t * 3
    if (k < 0 || t < k) {
      let x = nx[o], y = nx[o + 1], z = nx[o + 2]
      if (k >= 0) {
        x += nx[k * 3]
        y += nx[k * 3 + 1]
        z += nx[k * 3 + 2]
        const len = Math.hypot(x, y, z)
        if (len > 1e-12) {
          x /= len
          y /= len
          z /= len
        }
      }
      finalNx[o] = x
      finalNx[o + 1] = y
      finalNx[o + 2] = z
      if (k >= 0) {
        finalNx[k * 3] = x
        finalNx[k * 3 + 1] = y
        finalNx[k * 3 + 2] = z
      }
    }
  }

  const outPositions = new Float32Array(indices.length * 3)
  const outNormals = new Float32Array(indices.length * 3)
  for (let t = 0; t < triCount; t++) {
    for (let q = 0; q < 3; q++) {
      const src = indices[t * 3 + q] * 3
      const dst = (t * 3 + q) * 3
      outPositions[dst] = positions[src]
      outPositions[dst + 1] = positions[src + 1]
      outPositions[dst + 2] = positions[src + 2]
      outNormals[dst] = finalNx[t * 3]
      outNormals[dst + 1] = finalNx[t * 3 + 1]
      outNormals[dst + 2] = finalNx[t * 3 + 2]
    }
  }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(outPositions, 3))
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(outNormals, 3))
  return geom
}
