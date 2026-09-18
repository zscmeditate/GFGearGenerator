/**
 * AI 生成齿轮 —— 提示词构建与响应解析
 *
 * 核心思路：不靠硬编码示例，而是把 schema.ts 里的齿轮类型 / 字段定义
 * 动态序列化成"类型说明书"注入系统提示词，大模型只能在给定字段和范围内输出。
 */
import {
  gearTypes,
  gearTypeMap,
  type FieldDef,
  type NumberField,
  type BoolField,
  type ChoiceField,
  type GearType,
  type GearParams
} from '../gear/schema'

/** 每种齿轮类型的用途描述（帮助大模型理解该选哪种） */
const TYPE_PURPOSE: Record<GearType, string> = {
  spur: '直齿圆柱齿轮：齿与轴线平行，最通用的传动形式，拿不准时默认选它',
  helical: '斜齿/人字齿圆柱齿轮：齿沿螺旋线，高速平稳；doubleHelical 开人字齿可抵消轴向力',
  bevel: '90° 相交轴锥齿轮对（一次生成大轮+小轮）：垂直轴传动',
  rack: '齿条：与小齿轮啮合，把旋转运动变为直线运动，可选直/斜齿条',
  worm: '蜗轮蜗杆传动副：交错轴、大减速比、可自锁（蜗杆固定为单头）',
  internal: '标准内齿圈：齿分布在圈内',
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

/** 构建系统提示词：把 11 种齿轮类型与字段 schema 全部告诉大模型 */
export function buildSystemPrompt(
  currentType: GearType,
  currentParams: GearParams,
  currentExtra: Record<string, unknown>
): string {
  const typeDocs = gearTypes
    .map((g) => {
      const fields = g.fields.map(describeField).join('\n')
      return `【${g.type}】${g.name}（${g.en}）：${TYPE_PURPOSE[g.type]}\n可用字段：\n${fields}`
    })
    .join('\n\n')

  const cur = JSON.stringify(
    { type: currentType, ...currentParams, ...currentExtra },
    (k, v) => (v === undefined ? undefined : v)
  )

  return `你是齿轮传动设计专家。用户用自然语言描述齿轮需求，你负责把需求转换为齿轮生成器的参数，只输出一个严格 JSON 对象。

# 可选齿轮类型与各自字段（11 种，字段 id 必须原样使用）
${typeDocs}

# 公共字段（任何类型都可输出）
- standard（度量制，可选 "metric" 公制=用 module 模数 / "english" 英制=用 pitch 径节，默认 metric；用户没提英制就不要输出它）

# 输出格式（禁止 markdown 代码块、禁止任何解释文字）
{"type":"<类型id>","standard":"metric","params":{"字段id":值,...},"reply":"<50字以内中文说明>"}

# 规则
1. params 只放需要修改的字段，且必须是该类型的字段 id；没提到的字段不要输出。
2. 所有数值必须落在字段范围内，齿数取整数；布尔字段输出 true/false；选择字段输出引号内的枚举值。
3. 用户提到"速比/齿数比"时：锥齿轮换算为 z（大轮）与 zPinion（小轮）齿数；蜗轮蜗杆中 z 是蜗轮齿数（蜗杆单头），速比≈z。
4. 用户描述场景（如"减速 3 倍""高速平稳""垂直轴"）时，先选最合适的齿轮类型再定参数。
5. reply 里简要说明你选的类型与关键参数的理由。

# 当前状态（用户没提到的参数参考此值）
${cur}`
}

/** 解析校验后的 AI 结果 */
export interface AiGearResult {
  type: GearType
  standard?: 'metric' | 'english'
  /** 已按 schema 校验/钳制的字段值（含 params 与 extra 的路由由 store 处理） */
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

/** 解析并按所选类型的 schema 校验/钳制模型返回，非法字段一律丢弃 */
export function parseAiResponse(text: string, currentType: GearType): AiGearResult {
  const obj = extractJson(text) as Record<string, unknown>

  const type = typeof obj.type === 'string' && obj.type in gearTypeMap ? (obj.type as GearType) : currentType
  const meta = gearTypeMap[type]

  // 字段白名单 = 该类型的全部字段定义
  const defs = new Map<string, FieldDef>(meta.fields.map((f) => [f.id, f]))

  const params: Record<string, number | boolean | string> = {}
  const raw = (obj.params ?? {}) as Record<string, unknown>
  for (const [id, val] of Object.entries(raw)) {
    const def = defs.get(id)
    if (!def) continue // 模型幻觉出的字段直接丢弃
    if ((def as NumberField).min !== undefined) {
      const n = def as NumberField
      const num = typeof val === 'number' ? val : Number(val)
      if (!Number.isFinite(num)) continue
      let v = clamp(num, n.min, n.max)
      if (n.integer) v = Math.round(v)
      params[id] = v
    } else if ('options' in def) {
      const c = def as ChoiceField
      const hit = c.options.find((o) => o.value === val)
      if (hit) params[id] = hit.value
    } else if (typeof val === 'boolean') {
      params[id] = val
    }
  }

  const standard =
    obj.standard === 'english' || obj.standard === 'metric' ? (obj.standard as 'metric' | 'english') : undefined

  const reply = typeof obj.reply === 'string' ? obj.reply.trim() : ''

  if (Object.keys(params).length === 0 && !standard) {
    throw new Error('模型未给出可用的参数修改，请换个说法重试')
  }
  return { type, standard, params, reply }
}
