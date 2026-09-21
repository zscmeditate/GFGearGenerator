/**
 * AI 齿轮组生成 —— 提示词构建与响应解析
 *
 * 核心思路：不靠硬编码示例，而是把 schema.ts 里的齿轮类型 / 字段定义
 * 动态序列化成"类型说明书"注入系统提示词；大模型只输出「齿轮参数 + 装配关系」，
 * 空间坐标由 assembly.ts 的确定性求解器计算，模型严禁输出任何坐标。
 */
import {
  gearTypes,
  gearTypeMap,
  type FieldDef,
  type NumberField,
  type BoolField,
  type ChoiceField,
  type GearType
} from '../gear/schema'
import type { Mate, MateKind } from './assembly'
import type { AiAssemblySnapshot } from './session'

/** 每种齿轮类型的用途描述（帮助大模型理解该选哪种） */
const TYPE_PURPOSE: Record<GearType, string> = {
  spur: '直齿圆柱齿轮：齿与轴线平行，最通用的传动形式，拿不准时默认选它',
  helical: '斜齿/人字齿圆柱齿轮：齿沿螺旋线，高速平稳；doubleHelical 开人字齿可抵消轴向力',
  bevel: '90° 相交轴锥齿轮对（一个组件含大轮+小轮，内部已装好）：垂直轴传动',
  rack: '齿条：与小齿轮啮合，把旋转运动变为直线运动，可选直/斜齿条',
  worm: '蜗轮蜗杆传动副（一个组件含蜗轮+蜗杆，内部已装好）：交错轴、大减速比、可自锁（蜗杆固定为单头）',
  internal: '标准内齿圈：齿分布在圈内，可与小齿轮内啮合或用于行星轮系',
  internalNS: '非标准内齿圈：齿形参数更宽松',
  intHelical: '标准内斜齿圈',
  intHelicalNS: '非标准内斜齿圈',
  shiftedSpur: '变位直齿轮：用变位系数 X 避免根切、凑中心距',
  shiftedHelical: '变位斜齿轮：带变位系数 X 的斜齿轮'
}

/** 字段 measure 的中文单位说明 */
const MEASURE_LABEL: Record<string, string> = {
  mm: '长度 mm',
  dp: '模数/径节',
  deg: '角度°',
  count: '个数',
  coef: '无量纲系数'
}

/** 把单个字段定义序列化成一行说明 */
function describeField(f: FieldDef): string {
  if ((f as NumberField).min !== undefined) {
    const n = f as NumberField
    const cn = f.label.split(' ')[0]
    return `- ${f.id}（${cn}，${MEASURE_LABEL[n.measure]}，${n.min}~${n.max}${n.integer ? '，整数' : ''}，默认 ${n.default}）`
  }
  if ('options' in f) {
    const c = f as ChoiceField
    const cn = c.label.split(' ')[0]
    const opts = c.options.map((o) => `"${o.value}"=${o.label.split(' ')[0]}`).join(' / ')
    return `- ${f.id}（${cn}，可选 ${opts}，默认 "${c.default}"）`
  }
  const b = f as BoolField
  return `- ${f.id}（${b.label.split(' ')[0]}，布尔，默认 ${b.default}）`
}

/** 构建系统提示词：齿轮 schema + 装配协议 + 当前方案 */
export function buildSystemPrompt(current: AiAssemblySnapshot): string {
  const typeDocs = gearTypes
    .map((g) => {
      const fields = g.fields.map(describeField).join('\n')
      return `【${g.type}】${g.name}（${g.en}）：${TYPE_PURPOSE[g.type]}\n可用字段：\n${fields}`
    })
    .join('\n\n')

  const cur = JSON.stringify(
    {
      root: current.root,
      gears: current.gears.map((g) => ({
        id: g.id,
        type: g.type,
        standard: g.standard,
        values: g.values
      })),
      mates: current.mates
    },
    (k, v) => (v === undefined ? undefined : v)
  )

  return `你是齿轮传动系统设计专家。用户用自然语言描述由若干齿轮组成的传动方案，你负责：选择齿轮类型、确定参数、定义齿轮间的装配关系。空间位置、角度、齿的相位一律由宿主程序根据装配关系计算，你严禁输出 position / location / x / y / z / angle / rotation 等任何空间量。只输出一个严格 JSON 对象，禁止 markdown 代码块与任何解释文字。

# 输出格式
{
  "assembly": {
    "root": "g1",
    "gears": [
      { "id": "g1", "type": "<类型id>", "standard": "metric", "params": {"字段id": 值} }
    ],
    "mates": [
      { "a": "g1", "b": "g2", "kind": "external" }
    ]
  },
  "reply": "<60字以内中文：方案构成、各级速比与关键参数说明>"
}

# 可选齿轮类型与各自字段（11 种，字段 id 必须原样使用）
${typeDocs}

# 公共字段
- standard（度量制，可选 "metric" 公制=用 module 模数 / "english" 英制=用 pitch 径节，默认 metric；用户没提英制不要输出）

# 装配关系 kind（mates 每项 {a,b,kind}，方向为"上级 a → 新装的 b"）
- external：平行轴外啮合（直齿/斜齿/变位圆柱齿轮两两相配）。中心距与对错齿相位全部由程序计算，你不需要给任何角度。
- internal：外齿轮与内齿圈（internal/internalNS/intHelical/intHelicalNS）啮合，外齿轮在齿圈内部。
- rack：圆柱小齿轮驱动齿条（rack），旋转变直线。
- coaxial：两根轴同轴对接（双联齿轮、级间串联、把齿轮挂到锥齿轮/蜗杆组件的伸出轴上）；两齿轮轴心重合、沿轴向并排，齿数模数互不影响。
- bevel 和 worm 类型本身已是一副内部装配好的齿轮对，整体作为一个 gear 节点，对外只能用 coaxial 与其他轴串联，不能再对它们使用 external/internal/rack。
- rack 只能作为某条 rack 关系的 b（从动方），不能同轴连接。

# 装配拓扑（必须严格遵守）
1. mates 必须构成以 root 为根的一棵树：root 只能是 g1 且不能出现在 b 位置；其余每个齿轮恰好作为 b 出现一次；禁止孤点、环、重复边。
2. 齿轮总数 2~6 个；id 用 g1、g2、g3…，root 固定为 g1。
3. 需要在同一根轴上挂多个并列行星轮时，**必须**给每条 external 关系加 "bearing": 圆周角度数（如三个行星轮均布用 0、120、240；四个行星轮用 0、90、180、270）。多行星轮场景不写 bearing 会导致同位置重叠。
4. 行星轮系固定写法：太阳轮为 g1(root)，行星轮用 external 挂在 g1 上并给 bearing 均布，内齿圈用 internal 挂在任意一个行星轮上、不要给 bearing。齿数须同时满足两个条件，否则只有挂载齿圈的那个行星轮能正确啮合，其余会与齿圈干涉：
   - 同心条件：z齿圈 = z太阳轮 + 2×z行星轮
   - 装配条件：(z齿圈 − z太阳轮) 必须能被行星轮数 N 整除（即 N=3 时差值为 3 的倍数；N=4 时为 4 的倍数；由于差值=2×z行星轮，故 N=4 时 z行星轮 必须为偶数）
   - 所有行星轮齿数必须相同。
   - 推荐组合：N=3 取 z太阳=18, z行星=12, z齿圈=42（差 24÷3=8 ✓）；N=4 取 z太阳=20, z行星=20, z齿圈=60（差 40÷4=10 ✓）；N=4 也可 z太阳=16, z行星=14, z齿圈=44（差 28÷4=7 ✓）。

# 能装到一起的硬性参数规则（违反任何一条都会干涉或装不上，程序会报错）
1. 互相啮合的齿轮：模数 module 必须相同（英制则径节 pitch 相同）、压力角 pressureAngle 必须相同。
2. 斜齿外啮合：helixAngle 绝对值相等、旋向相反（一个 clockwise:true 另一个 false）、helicalSystem 相同；人字齿 doubleHelical 无需反旋向。内啮合斜齿轮旋向相同；斜齿轮与斜齿条旋向相同。
3. 中心距是齿数的结果，严禁输出间距：外啮合 a=m(z₁+z₂)/2；内啮合 a=m(z圈−z轮)/2 且齿数差≥8；齿条节线到小齿轮轴心距离=mz/2。法向制(normal)斜齿把 m 换成 m_n/cosβ。
4. 锥齿轮(bevel)速比=z/zPinion，轴交角固定 90°；蜗轮蜗杆(worm)为单头蜗杆、速比≈蜗轮齿数 z。两者角度与相对位置已由程序固定。
5. 互相啮合的一对，齿宽 gearHeight 取相同值或小轮略宽（允许 2~5mm 轴向浮动）；同轴串联件齿宽自便。两轮齿宽不同时程序自动按齿宽中点对齐（行业默认，避免边缘载荷）。
6. 所有数值必须落在字段 min/max 内，齿数取整数；没提到的字段不要输出。

# 多轮修改规则（重要）
1. 每轮都必须输出完整 gears 列表并复用原有 id（g1/g2…），mates 也要完整给出。
2. 用户只改某个齿轮（如"把 g2 换成 40 齿"）时，其他齿轮 params 可省略或照抄，未提及的装配关系保持不变。
3. 需要新增齿轮时取下一个未使用的 id；用户明确要求删除时才从 gears 中移除并同步删掉相关 mates。

# 当前方案（用户未提及修改时以此为基准；首轮为主视图当前的单个齿轮）
${cur}`
}

/* ---------- 解析模型返回 ---------- */

/** 单条齿轮的模型增量（params 仅含本轮给出的字段） */
export interface AiAssemblyResultGear {
  id: string
  type: GearType
  standard?: 'metric' | 'english'
  params: Record<string, number | boolean | string>
}

/** 模型一次返回的齿轮组方案 */
export interface AiAssemblyResult {
  root: string
  gears: AiAssemblyResultGear[]
  mates: Mate[]
  reply: string
}

/** 旧版单齿轮结果（主视图 applyAIGeneration 仍使用此形态） */
export interface AiGearResult {
  type: GearType
  standard?: 'metric' | 'english'
  params: Record<string, number | boolean | string>
  reply: string
}

/** 从模型回复文本中抠出 JSON（容忍 markdown 代码块与前后杂文） */
function extractJson(text: string): unknown {
  const s = text.replace(/```(?:json)?/gi, '')
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型返回中没有找到 JSON，请重试')
  return JSON.parse(s.slice(start, end + 1))
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

const MATE_KINDS: ReadonlySet<MateKind> = new Set(['external', 'internal', 'rack', 'coaxial'])

/** 按所选类型的 schema 校验/钳制单个齿轮的 params，非法字段一律丢弃 */
function parseGearParams(type: GearType, raw: unknown): Record<string, number | boolean | string> {
  const defs = new Map<string, FieldDef>(gearTypeMap[type].fields.map((f) => [f.id, f]))
  const out: Record<string, number | boolean | string> = {}
  const obj = (raw ?? {}) as Record<string, unknown>
  for (const [id, val] of Object.entries(obj)) {
    const def = defs.get(id)
    if (!def) continue // 模型幻觉出的字段直接丢弃
    if ((def as NumberField).min !== undefined) {
      const n = def as NumberField
      const num = typeof val === 'number' ? val : Number(val)
      if (!Number.isFinite(num)) continue
      let v = clamp(num, n.min, n.max)
      if (n.integer) v = Math.round(v)
      out[id] = v
    } else if ('options' in def) {
      const c = def as ChoiceField
      const hit = c.options.find((o) => o.value === val)
      if (hit) out[id] = hit.value
    } else if (typeof val === 'boolean') {
      out[id] = val
    }
  }
  return out
}

/** 解析模型返回的齿轮组方案（结构/字段层校验；物理啮合校验在合并快照后由 validateAssembly 完成） */
export function parseAiResponse(text: string): AiAssemblyResult {
  const top = extractJson(text) as Record<string, unknown>
  const obj = (top.assembly && typeof top.assembly === 'object' ? top.assembly : top) as Record<string, unknown>

  const rawGears = obj.gears
  if (!Array.isArray(rawGears) || rawGears.length === 0) {
    throw new Error('模型未给出齿轮列表（gears），请重试')
  }
  if (rawGears.length > 6) throw new Error('一次最多装配 6 个齿轮')

  const gears: AiAssemblyResultGear[] = []
  const usedAuto = new Set<string>()
  rawGears.forEach((item, i) => {
    const g = item as Record<string, unknown>
    const fallbackId = `g${i + 1}`
    let id = typeof g.id === 'string' && g.id.trim() ? g.id.trim() : fallbackId
    while (usedAuto.has(id)) id = `${id}x`
    usedAuto.add(id)

    if (typeof g.type !== 'string' || !(g.type in gearTypeMap)) {
      throw new Error(`齿轮 ${id} 的类型「${String(g.type)}」不在支持的 11 种类型内`)
    }
    const type = g.type as GearType
    const standard =
      g.standard === 'english' || g.standard === 'metric' ? (g.standard as 'metric' | 'english') : undefined
    gears.push({ id, type, standard, params: parseGearParams(type, g.params) })
  })

  const ids = new Set(gears.map((g) => g.id))
  const root = typeof obj.root === 'string' && ids.has(obj.root) ? obj.root : gears[0].id

  const mates: Mate[] = []
  if (Array.isArray(obj.mates)) {
    for (const item of obj.mates) {
      const m = item as Record<string, unknown>
      const a = typeof m.a === 'string' ? m.a : ''
      const b = typeof m.b === 'string' ? m.b : ''
      if (!ids.has(a) || !ids.has(b)) continue
      if (typeof m.kind !== 'string' || !MATE_KINDS.has(m.kind as MateKind)) {
        throw new Error(`${a} → ${b} 的装配类型「${String(m.kind)}」无效，只能是 external/internal/rack/coaxial`)
      }
      const mate: Mate = { a, b, kind: m.kind as MateKind }
      if (typeof m.bearing === 'number' && Number.isFinite(m.bearing)) {
        mate.bearing = clamp(m.bearing, 0, 360)
      } else if (typeof m.bearing === 'string' && Number.isFinite(Number(m.bearing))) {
        mate.bearing = clamp(Number(m.bearing), 0, 360)
      }
      mates.push(mate)
    }
  }
  const reply = typeof obj.reply === 'string' ? obj.reply : ''
  return { root, gears, mates, reply: reply.trim() }
}
