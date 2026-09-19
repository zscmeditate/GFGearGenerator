/**
 * AI 会话数据模型与纯函数工具（多齿轮装配版）：
 * - 装配快照（多齿轮完整参数 + mates）的构造 / 增量合并
 * - 多轮对话上下文构建（OpenAI messages 数组）
 * - localStorage 持久化（v2；自动迁移 v1 单齿轮消息）
 */
import {
  gearTypeMap,
  defaultParams,
  defaultValuesForType,
  type GearParams,
  type GearType
} from '../gear/schema'
import type { ExtraValues } from '../gear/geometry'
import { validateAssembly, type Assembly, type Mate, type MateKind } from './assembly'
import type { AiAssemblyResult, AiGearResult } from './prompt'

const KNOWN_PARAM_IDS = new Set<string>(Object.keys(defaultParams))

/* ---------- 快照模型 ---------- */

/** 单个齿轮的完整参数快照（canvas 渲染与下一轮对话的基准） */
export interface AiGearSnapshot {
  type: GearType
  standard: 'metric' | 'english'
  /** 该类型全部 schema 字段的实际值 */
  values: Record<string, string | number | boolean>
}

/** 装配中的一个齿轮（带会话内稳定 id） */
export type AssemblyGearSnap = AiGearSnapshot & { id: string }

/** 一条 AI 回复落地后的完整齿轮组快照 */
export interface AiAssemblySnapshot extends Assembly {
  version: 2
  root: string
  gears: AssemblyGearSnap[]
  mates: Mate[]
}

export interface AiChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  time: number
  /** assistant：模型输出的齿轮组增量结果（多轮上下文回放用） */
  result?: AiAssemblyResult
  /** assistant：合并增量后的完整装配快照（渲染用） */
  assembly?: AiAssemblySnapshot
  /** assistant：相对上一条快照的变化项（中文标签 + 展示值） */
  changes?: { label: string; value: string }[]
  /** assistant：本次调用失败的错误信息（不进入多轮上下文） */
  error?: string
  /** v1 遗留字段，加载旧数据后立即迁移删除 */
  snapshot?: AiGearSnapshot
}

export interface AiChatSession {
  id: string
  title: string
  messages: AiChatMessage[]
  createdAt: number
  updatedAt: number
}

export const DEFAULT_SESSION_TITLE = '新会话'

let seq = 0
export function uid(): string {
  return `m${Date.now().toString(36)}${(seq++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
}

/** 由主视图当前状态构造单齿轮快照 */
export function snapshotFromState(
  type: GearType,
  params: GearParams,
  extra: Record<string, unknown>
): AiGearSnapshot {
  const values: Record<string, string | number | boolean> = { ...defaultValuesForType(type) }
  for (const f of gearTypeMap[type].fields) {
    const v = KNOWN_PARAM_IDS.has(f.id)
      ? (params as unknown as Record<string, unknown>)[f.id]
      : extra[f.id]
    if (v !== undefined) values[f.id] = v as string | number | boolean
  }
  return { type, standard: params.standard, values }
}

/** 主视图当前状态 → 单节点装配（首轮对话基准） */
export function assemblyFromState(
  type: GearType,
  params: GearParams,
  extra: Record<string, unknown>
): AiAssemblySnapshot {
  return {
    version: 2,
    root: 'g1',
    gears: [{ id: 'g1', ...snapshotFromState(type, params, extra) }],
    mates: []
  }
}

/** v1 单齿轮快照包装为单节点装配 */
export function legacySnapshotToAssembly(snap: AiGearSnapshot, id = 'g1'): AiAssemblySnapshot {
  return { version: 2, root: id, gears: [{ id, ...snap }], mates: [] }
}

/** 把模型齿轮组增量合并到上一装配快照（未提及齿轮/字段沿用上一轮），并做物理啮合校验 */
export function resolveAssembly(
  prev: AiAssemblySnapshot | null,
  r: AiAssemblyResult,
  fallbackStandard: 'metric' | 'english'
): AiAssemblySnapshot {
  const gears: AssemblyGearSnap[] = r.gears.map((rg) => {
    const pg = prev?.gears.find((x) => x.id === rg.id)
    const values =
      pg && pg.type === rg.type ? { ...pg.values } : defaultValuesForType(rg.type)
    for (const [id, v] of Object.entries(rg.params)) values[id] = v
    const standard =
      rg.standard ?? (pg && pg.type === rg.type ? pg.standard : fallbackStandard)
    return { id: rg.id, type: rg.type, standard, values }
  })
  const snap: AiAssemblySnapshot = {
    version: 2,
    root: r.root,
    gears,
    mates: r.mates.map((m) => ({ ...m }))
  }
  validateAssembly(snap)
  return snap
}

/** 齿轮快照 → buildGear 所需的 params+extra 形态（AssemblyGearSnap 结构兼容，可直接传入） */
export function snapshotToParamsExtra(snap: AiGearSnapshot): { params: GearParams; extra: ExtraValues } {
  const params: GearParams = { ...defaultParams, standard: snap.standard }
  const extra: ExtraValues = {}
  for (const f of gearTypeMap[snap.type].fields) {
    const v = snap.values[f.id]
    if (v === undefined) continue
    if (KNOWN_PARAM_IDS.has(f.id)) (params as unknown as Record<string, unknown>)[f.id] = v
    else extra[f.id] = v
  }
  return { params, extra }
}

/* ---------- 变化描述 ---------- */

const MATE_LABEL: Record<MateKind, string> = {
  external: '外啮合',
  internal: '内啮合',
  rack: '齿轮齿条',
  coaxial: '同轴串联'
}

function gearBrief(g: AssemblyGearSnap): string {
  const v = g.values
  const head = gearTypeMap[g.type].name
  if (g.type === 'bevel') return `${head} ${v.z}/${v.zPinion} 齿`
  if (g.type === 'worm') return `${head} 蜗轮 ${v.z} 齿`
  if (g.type === 'rack') return `${head} ${v.z} 节`
  const helix = Number(v.helixAngle) > 0 ? ` β${v.helixAngle}°` : ''
  return `${head} m${v.module} z${v.z}${helix}`
}

/** 相对上一轮装配的变化清单（新增/修改/移除齿轮 + 装配关系） */
export function describeAssemblyChanges(
  prev: AiAssemblySnapshot | null,
  snap: AiAssemblySnapshot
): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = []
  const prevMap = new Map(prev?.gears.map((g) => [g.id, g]) ?? [])

  for (const g of snap.gears) {
    const pg = prevMap.get(g.id)
    if (!pg || pg.type !== g.type) {
      out.push({ label: g.id, value: `新增 ${gearBrief(g)}` })
      continue
    }
    const diffs: string[] = []
    for (const [id, val] of Object.entries(g.values)) {
      if (pg.values[id] !== val) {
        const f = gearTypeMap[g.type].fields.find((fd) => fd.id === id)
        if (f) diffs.push(`${f.label.split(' ')[0]}=${val}`)
      }
    }
    if (g.standard !== pg.standard) diffs.push(`度量制=${g.standard === 'metric' ? '公制' : '英制'}`)
    if (diffs.length) out.push({ label: g.id, value: gearBrief(g) + '（' + diffs.join('，') + '）' })
  }
  for (const pg of prev?.gears ?? []) {
    if (!snap.gears.some((g) => g.id === pg.id)) out.push({ label: pg.id, value: '已移除' })
  }
  for (const m of snap.mates) {
    out.push({ label: `${m.a} ⇢ ${m.b}`, value: MATE_LABEL[m.kind] + (m.bearing !== undefined ? ` @${Math.round(m.bearing)}°` : '') })
  }
  return out
}

/* ---------- 多轮上下文 ---------- */

/** 多轮上下文最多回放的消息条数（system 之外） */
const HISTORY_LIMIT = 12

/** 会话消息 → OpenAI 兼容 messages 数组（system + 截断后的历史） */
export function buildLlmMessages(
  session: AiChatSession,
  system: string
): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  const history: { role: 'user' | 'assistant'; content: string }[] = []
  for (const m of session.messages) {
    if (m.error) continue
    if (m.role === 'user') {
      history.push({ role: 'user', content: m.text })
    } else if (m.result) {
      // 还原成与系统提示词约定一致的齿轮组 JSON，模型据此理解上轮输出
      const r = m.result
      history.push({
        role: 'assistant',
        content: JSON.stringify({
          assembly: {
            root: r.root,
            gears: r.gears.map((g) => ({
              id: g.id,
              ...(g.standard ? { standard: g.standard } : {}),
              type: g.type,
              params: g.params
            })),
            mates: r.mates
          },
          reply: r.reply
        })
      })
    }
  }
  return [{ role: 'system' as const, content: system }, ...history.slice(-HISTORY_LIMIT)]
}

/* ---------- localStorage 持久化（v2，自动迁移 v1） ---------- */

const STORAGE_KEY = 'gf-ai-sessions-v2'
const STORAGE_KEY_V1 = 'gf-ai-sessions-v1'

interface PersistedChat {
  sessions: AiChatSession[]
  activeId: string
}

export function loadChatData(): PersistedChat | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const data = JSON.parse(raw)
      if (data && Array.isArray(data.sessions)) return data as PersistedChat
    }
    return loadV1ChatData()
  } catch {
    return null
  }
}

/** 读取并迁移 v1（单齿轮）会话：snapshot 包成单节点装配，旧 result 转齿轮组形态 */
function loadV1ChatData(): PersistedChat | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_V1)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || !Array.isArray(data.sessions)) return null
    for (const s of data.sessions as AiChatSession[]) {
      for (const m of s.messages) {
        if (m.assembly) continue
        if (m.snapshot) {
          m.assembly = legacySnapshotToAssembly(m.snapshot)
          delete m.snapshot
        }
        const old = m.result as unknown as AiGearResult | undefined
        if (old && !('gears' in old)) {
          m.result = {
            root: 'g1',
            gears: [{ id: 'g1', type: old.type, ...(old.standard ? { standard: old.standard } : {}), params: old.params }],
            mates: [],
            reply: old.reply
          }
        }
      }
    }
    saveChatData(data as PersistedChat)
    return data as PersistedChat
  } catch {
    return null
  }
}

export function saveChatData(d: PersistedChat) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(d))
  } catch {
    /* 隐私模式 / 配额受限时静默降级为仅会话内记忆 */
  }
}
