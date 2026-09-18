import type { MeshData } from '../gear/mesh/MeshData'

export type ExportFormat = 'step' | 'stl'

let worker: Worker | null = null

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./exportWorker.ts', import.meta.url), { type: 'module' })
  }
  return worker
}

function toTypedArrays(mesh: MeshData): { pos: Float64Array; idx: Uint32Array } {
  const pos = new Float64Array(mesh.positions)
  const idx = new Uint32Array(mesh.indices)
  return { pos, idx }
}

export function exportMesh(
  mesh: MeshData,
  format: ExportFormat,
  onProgress?: (stage: string, pct: number) => void
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const w = getWorker()
    const { pos, idx } = toTypedArrays(mesh)

    const onMsg = (ev: MessageEvent) => {
      const d = ev.data
      if (d.progress) {
        onProgress?.(d.stage, d.pct)
        return
      }
      w.removeEventListener('message', onMsg)
      w.removeEventListener('error', onErr)
      if (d.ok) {
        const mime = format === 'step' ? 'application/step' : 'model/stl'
        resolve(new Blob([d.buffer], { type: mime }))
      } else {
        // 内核类失败后 worker 可能已不可用，销毁重建
        w.terminate()
        worker = null
        reject(new Error(d.error || '导出失败'))
      }
    }
    const onErr = (e: ErrorEvent) => {
      w.removeEventListener('message', onMsg)
      w.removeEventListener('error', onErr)
      // wasm abort 等致命错误会杀死 worker，直接重建，保证下次可用
      w.terminate()
      worker = null
      reject(new Error(e.message || 'Worker 错误'))
    }
    w.addEventListener('message', onMsg)
    w.addEventListener('error', onErr)
    w.postMessage({ kind: format, positions: pos, indices: idx }, [pos.buffer, idx.buffer])
  })
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}
