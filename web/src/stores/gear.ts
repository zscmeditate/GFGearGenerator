import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import { GearType, gearTypeMap, defaultParams, type GearParams } from '../gear/schema'
import { buildGear, type ExtraValues, type Quality } from '../gear/geometry'
import type { MeshData } from '../gear/mesh/MeshData'

interface Toast {
  kind: 'info' | 'error'
  text: string
}

const KNOWN_PARAM_IDS = new Set<string>(Object.keys(defaultParams))

let rebuildTimer = 0

export const useGearStore = defineStore('gear', {
  state: () => ({
    type: GearType.Spur as GearType,
    params: { ...defaultParams } as GearParams,
    /** schema 中不属于 GearParams 的字段值（pitch / helicalSystem / rackType / wormType / fastCompute） */
    extra: { pitch: 8.47, helicalSystem: 'radial', rackType: 'straight', wormType: 'helical' } as ExtraValues,
    quality: 'preview' as Quality,
    autoRotate: false,
    wireframe: false,
    mesh: shallowRef<MeshData | null>(null),
    building: false,
    exporting: false,
    exportProgress: 0,
    toast: null as Toast | null
  }),

  getters: {
    meta: (s) => gearTypeMap[s.type],
    triangleCount: (s) => (s.mesh ? s.mesh.triangleCount : 0),
    vertexCount: (s) => (s.mesh ? s.mesh.vertexCount : 0)
  },

  actions: {
    /** 根据当前类型 schema 补齐 extra 默认值 */
    seedExtraDefaults() {
      for (const f of this.meta.fields) {
        if (KNOWN_PARAM_IDS.has(f.id)) continue
        if (this.extra[f.id] === undefined) {
          if ('default' in f) this.extra[f.id] = (f as { default: string | boolean | number }).default
        }
      }
    },

    selectType(t: GearType) {
      this.type = t
      this.seedExtraDefaults()
      this.scheduleRebuild()
    },

    setParam(id: string, value: string | number | boolean) {
      if (KNOWN_PARAM_IDS.has(id)) {
        ;(this.params as unknown as Record<string, unknown>)[id] = value
      } else {
        this.extra[id] = value
      }
      this.scheduleRebuild()
    },

    setQuality(q: Quality) {
      this.quality = q
      this.scheduleRebuild()
    },

    showToast(text: string, kind: Toast['kind'] = 'info', ttl = 4000) {
      this.toast = { kind, text }
      window.setTimeout(() => {
        if (this.toast?.text === text) this.toast = null
      }, ttl)
    },

    buildNow() {
      this.building = true
      // 让 loading 态先渲染（setTimeout 不依赖渲染帧，避免后台/极小视口 rAF 暂停）
      return new Promise<void>((resolve) => {
        window.setTimeout(() => {
          try {
            this.mesh = buildGear(this.type, this.params, this.extra, this.quality)
            if (this.mesh.triangleCount > 400_000) {
              this.showToast(`面片数 ${this.mesh.triangleCount.toLocaleString()}，较多，可能影响性能`, 'info')
            }
          } catch (e) {
            console.error(e)
            this.showToast(`几何生成失败：${(e as Error).message}`, 'error', 8000)
          } finally {
            this.building = false
            resolve()
          }
        }, 30)
      })
    },

    scheduleRebuild() {
      window.clearTimeout(rebuildTimer)
      rebuildTimer = window.setTimeout(() => void this.buildNow(), 130)
    }
  }
})
