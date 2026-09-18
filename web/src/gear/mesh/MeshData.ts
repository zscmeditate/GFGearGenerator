/** 最轻量的索引三角网格容器（位置 mm）。法线在渲染/导出时按面计算。 */
export class MeshData {
  positions: number[] = []
  indices: number[] = []
  /** 可选的面片分组名（导出 STEP 时可作为独立实体），与 indices 平行区段对应 */
  parts: { name: string; start: number; count: number }[] = []

  vertex(x: number, y: number, z: number): number {
    const i = this.positions.length / 3
    this.positions.push(x, y, z)
    return i
  }

  tri(a: number, b: number, c: number) {
    this.indices.push(a, b, c)
  }

  quad(a: number, b: number, c: number, d: number) {
    // a-b-c-d 环绕顺序
    this.indices.push(a, b, c, a, c, d)
  }

  beginPart(name: string) {
    this.parts.push({ name, start: this.indices.length, count: 0 })
  }

  endPart() {
    const p = this.parts[this.parts.length - 1]
    if (p) p.count = this.indices.length - p.start
  }

  get triangleCount() {
    return this.indices.length / 3
  }

  get vertexCount() {
    return this.positions.length / 3
  }

  /** 原地变换所有顶点（用于坐标系调整） */
  transform(fn: (x: number, y: number, z: number) => [number, number, number]) {
    for (let i = 0; i < this.positions.length; i += 3) {
      const [x, y, z] = fn(this.positions[i], this.positions[i + 1], this.positions[i + 2])
      this.positions[i] = x
      this.positions[i + 1] = y
      this.positions[i + 2] = z
    }
  }

  /** 合并另一个网格，可施加顶点变换（返回新坐标）。 */
  merge(other: MeshData, transform?: (x: number, y: number, z: number) => [number, number, number]) {
    const vBase = this.positions.length / 3
    const iBase = this.indices.length
    for (let i = 0; i < other.positions.length; i += 3) {
      let x = other.positions[i]
      let y = other.positions[i + 1]
      let z = other.positions[i + 2]
      if (transform) [x, y, z] = transform(x, y, z)
      this.positions.push(x, y, z)
    }
    for (const idx of other.indices) this.indices.push(idx + vBase)
    for (const p of other.parts) {
      this.parts.push({ name: p.name, start: iBase + p.start, count: p.count })
    }
  }

  /** 轴对齐包围盒中心与尺寸，供相机取景 */
  bounds() {
    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (let i = 0; i < this.positions.length; i += 3) {
      const x = this.positions[i], y = this.positions[i + 1], z = this.positions[i + 2]
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
    }
    return {
      min: [minX, minY, minZ] as const,
      max: [maxX, maxY, maxZ] as const,
      center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2] as const,
      size: [maxX - minX, maxY - minY, maxZ - minZ] as const
    }
  }
}
