import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import {
  GearType,
  gearTypeMap,
  defaultParams,
  defaultValuesForType,
  type GearParams,
  type Standard,
  type FieldDef
} from '../gear/schema'
import { buildGear, type ExtraValues, type Quality } from '../gear/geometry'
import type { MeshData } from '../gear/mesh/MeshData'
import { ElMessage } from 'element-plus'
import type { AiGearResult } from '../ai/prompt'

const KNOWN_PARAM_IDS = new Set<string>(Object.keys(defaultParams))

let rebuildTimer = 0
let slowTimer = 0
/** build 持续超过该阈值（ms）才显示遮罩，避免参数微调时整场景闪烁 */
const SLOW_THRESHOLD = 200

/* ---------- 按齿轮类型记忆参数（localStorage） ---------- */
const STORAGE_KEY = 'gf-gear-params-v1'

/** 某一类型的扁平字段值快照（schema 字段 id → 值，含 extra 字段） */
type TypeValues = Record<string, string | number | boolean>

interface PersistedPrefs {
  lastType?: GearType
  standard?: Standard
  types?: Partial<Record<GearType, TypeValues>>
}

function loadPrefs(): PersistedPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const data = JSON.parse(raw)
    return data && typeof data === 'object' ? (data as PersistedPrefs) : {}
  } catch {
    return {}
  }
}

function savePrefsNow(prefs: PersistedPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    /* 隐私模式 / 配额受限时静默降级为仅会话内记忆 */
  }
}

/** 读取记忆值时按字段类型校正：非法选择项回落默认，数字强制 finite，布尔强制 Boolean */
function coerceField(f: FieldDef, raw: unknown): string | number | boolean {
  if ('options' in f) {
    return f.options.some((o) => o.value === raw) ? (raw as string) : f.default
  }
  if (typeof f.default === 'boolean') return Boolean(raw)
  const n = Number(raw)
  return Number.isFinite(n) ? n : f.default
}

let persistTimer = 0

export const useGearStore = defineStore('gear', {
  state: () => ({
    type: GearType.Spur as GearType,
    params: { ...defaultParams } as GearParams,
    /** schema 中不属于 GearParams 的字段值（pitch / helicalSystem / rackType / wormType / fastCompute） */
    extra: { pitch: 8.47, helicalSystem: 'radial', rackType: 'straight', wormType: 'helical' } as ExtraValues,
    /** 每种齿轮类型各自记忆的字段值（含本次会话切换时暂存与 localStorage 恢复的内容） */
    typeValues: {} as Partial<Record<GearType, TypeValues>>,
    quality: 'preview' as Quality,
    autoRotate: false,
    wireframe: false,
    mesh: shallowRef<MeshData | null>(null),
    /** 实际构建中（瞬间切换，外部一般不应直接用做 UI） */
    building: false,
    /** 延迟显示的遮罩状态：build 持续 > SLOW_THRESHOLD 才置 true，build 结束立即 false */
    showBusy: false,
    exporting: false,
    exportProgress: 0,
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

    /** 把扁平字段值（默认值或记忆快照）校正后写入当前 params/extra */
    applyValues(values: TypeValues) {
      for (const f of this.meta.fields) {
        const v = coerceField(f, values[f.id])
        if (KNOWN_PARAM_IDS.has(f.id)) {
          ;(this.params as unknown as Record<string, unknown>)[f.id] = v
        } else {
          this.extra[f.id] = v
        }
      }
    },

    /** 采集当前类型 schema 字段的实际值（不含全局的 standard） */
    snapshotCurrent(): TypeValues {
      const out: TypeValues = {}
      for (const f of this.meta.fields) {
        out[f.id] = KNOWN_PARAM_IDS.has(f.id)
          ? (this.params as unknown as Record<string, string | number | boolean>)[f.id]
          : (this.extra[f.id] as string | number | boolean)
      }
      return out
    },

    /** 启动时恢复上次的齿轮类型、单位标准与各类型参数记忆 */
    init() {
      const prefs = loadPrefs()
      if (prefs.types) this.typeValues = prefs.types
      if (prefs.standard === 'metric' || prefs.standard === 'english') {
        this.params.standard = prefs.standard
      }
      const t = prefs.lastType
      if (t && (gearTypeMap as Record<string, unknown>)[t]) this.type = t
      this.applyValues(this.typeValues[this.type] ?? defaultValuesForType(this.type))
      this.seedExtraDefaults()
    },

    /** 参数记忆防抖落盘（滑块拖动时高频写入合并为一次） */
    persistSoon() {
      window.clearTimeout(persistTimer)
      persistTimer = window.setTimeout(() => this.persistNow(), 250)
    },

    persistNow() {
      this.typeValues[this.type] = this.snapshotCurrent()
      savePrefsNow({
        lastType: this.type,
        standard: this.params.standard,
        types: this.typeValues
      })
    },

    selectType(t: GearType) {
      if (t === this.type) return
      // 离开当前类型前先暂存其参数，再载入目标类型的记忆或默认值
      this.typeValues[this.type] = this.snapshotCurrent()
      this.type = t
      this.applyValues(this.typeValues[t] ?? defaultValuesForType(t))
      this.seedExtraDefaults()
      this.persistSoon()
      this.scheduleRebuild()
    },

    setParam(id: string, value: string | number | boolean) {
      if (id === 'standard') {
        const newStandard = value as Standard
        if (newStandard !== this.params.standard) {
          if (newStandard === 'english') {
            // 公制 → 英制：把当前模数(mm)换算为径节(DP = 25.4 / m)
            if (this.params.module > 0) {
              this.extra.pitch = Number((25.4 / this.params.module).toFixed(4))
            }
          } else {
            // 英制 → 公制：把当前径节(DP)换算为模数(mm = 25.4 / DP)
            const pitch = Number(this.extra.pitch)
            if (pitch > 0) {
              this.params.module = Number((25.4 / pitch).toFixed(4))
            }
          }
          this.params.standard = newStandard
        }
      } else if (KNOWN_PARAM_IDS.has(id)) {
        ;(this.params as unknown as Record<string, unknown>)[id] = value
      } else {
        this.extra[id] = value
      }
      this.persistSoon()
      this.scheduleRebuild()
    },

    /** 一次性应用 AI 生成的结果（类型/度量制/参数值均已按 schema 校验钳制），只触发一次重建 */
    applyAIGeneration(r: AiGearResult) {
      if (r.type !== this.type) {
        // 与 selectType 相同：离开前暂存当前类型参数，再载入目标类型的记忆或默认值
        this.typeValues[this.type] = this.snapshotCurrent()
        this.type = r.type
        this.applyValues(this.typeValues[r.type] ?? defaultValuesForType(r.type))
      }
      if (r.standard) this.params.standard = r.standard
      for (const [id, v] of Object.entries(r.params)) {
        if (KNOWN_PARAM_IDS.has(id)) {
          ;(this.params as unknown as Record<string, unknown>)[id] = v
        } else {
          this.extra[id] = v
        }
      }
      this.seedExtraDefaults()
      this.persistSoon()
      // 取消可能排队的防抖重建，立刻按最终参数构建一次
      window.clearTimeout(rebuildTimer)
      return this.buildNow()
    },

    /** 一键恢复当前齿轮类型的 schema 默认参数，并清除该类型的记忆 */
    resetParams() {
      this.applyValues(defaultValuesForType(this.type))
      delete this.typeValues[this.type]
      this.seedExtraDefaults()
      // 直接落盘当前映射（已不含本类型键），避免 persistNow 又把默认值当记忆写回
      savePrefsNow({
        lastType: this.type,
        standard: this.params.standard,
        types: this.typeValues
      })
      this.scheduleRebuild()
      ElMessage.info('已恢复默认参数')
    },

    setQuality(q: Quality) {
      this.quality = q
      this.scheduleRebuild()
    },

    buildNow() {
      this.building = true
      // 仅当 build 真正耗时长时才显示遮罩：阈值外才置 showBusy=true
      window.clearTimeout(slowTimer)
      slowTimer = window.setTimeout(() => {
        if (this.building) this.showBusy = true
      }, SLOW_THRESHOLD)
      // 让 loading 态先渲染（setTimeout 不依赖渲染帧，避免后台/极小视口 rAF 暂停）
      return new Promise<void>((resolve) => {
        window.setTimeout(() => {
          try {
            this.mesh = buildGear(this.type, this.params, this.extra, this.quality)
            if (this.mesh.triangleCount > 1_000_000) {
              ElMessage.info(`面片数 ${this.mesh.triangleCount.toLocaleString()}，较多，可能影响性能`)
            }
          } catch (e) {
            console.error(e)
            ElMessage.error(`几何生成失败：${(e as Error).message}`)
          } finally {
            this.building = false
            window.clearTimeout(slowTimer)
            this.showBusy = false
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
