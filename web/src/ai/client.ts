/**
 * AI 生成齿轮 —— 大模型客户端（OpenAI 兼容 /chat/completions）
 * 设置保存在 localStorage；未配置 Key 或勾选演示模式时走本地关键词解析，不消耗 API 配额。
 */

export interface AiSettings {
  /** OpenAI 兼容接口基地址（不带尾部斜杠与路径） */
  baseUrl: string
  model: string
  apiKey: string
  /** 演示模式：不调用 API，本地关键词解析 */
  demo: boolean
}

const STORAGE_KEY = 'gf-ai-settings'

export const defaultAiSettings: AiSettings = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  apiKey: '',
  demo: false
}

export function loadAiSettings(): AiSettings {
  try {
    return { ...defaultAiSettings, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }
  } catch {
    return { ...defaultAiSettings }
  }
}

export function saveAiSettings(s: AiSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

/* ---------- 演示模式：本地关键词解析（无网络请求） ---------- */

function demoGenerate(text: string): string {
  let type = 'spur'
  if (/蜗/.test(text)) type = 'worm'
  else if (/锥/.test(text)) type = 'bevel'
  else if (/齿条/.test(text)) type = 'rack'
  else if (/内.{0,6}(斜|螺旋)/.test(text)) type = 'intHelical'
  else if (/内齿|内啮合/.test(text)) type = 'internal'
  else if (/变位/.test(text) && /斜|螺旋/.test(text)) type = 'shiftedHelical'
  else if (/变位/.test(text)) type = 'shiftedSpur'
  else if (/斜|螺旋|人字/.test(text)) type = 'helical'

  const params: Record<string, number> = {}
  const grab = (re: RegExp): number | undefined => {
    const m = text.match(re)
    if (!m) return undefined
    const v = parseFloat(m[1])
    return Number.isFinite(v) ? v : undefined
  }
  const z = grab(/(\d+(?:\.\d+)?)\s*个?齿/)
  if (z !== undefined) params.z = Math.round(z)
  const mod = grab(/模数\s*(?:为|是|=|：|:)?\s*(\d+(?:\.\d+)?)/)
  if (mod !== undefined) params.module = mod
  const helix = grab(/(?:螺旋角|螺旋)\s*(?:为|是|=|：|:)?\s*(\d+(?:\.\d+)?)/)
  if (helix !== undefined) params.helixAngle = helix
  const height = grab(/(?:齿宽|厚度|高度)\s*(?:为|是|=|：|:)?\s*(\d+(?:\.\d+)?)/)
  if (height !== undefined) params.gearHeight = height
  const pa = grab(/压力角\s*(?:为|是|=|：|:)?\s*(\d+(?:\.\d+)?)/)
  if (pa !== undefined) params.pressureAngle = pa

  return JSON.stringify({
    type,
    params,
    reply: `【演示模式】本地识别：类型 ${type}${Object.keys(params).length ? '，参数 ' + JSON.stringify(params) : '（未识别到数值）'}。在“模型设置”里填入 API Key 可获得完整语义理解。`
  })
}

/* ---------- 调用大模型 ---------- */

export async function callLLM(settings: AiSettings, system: string, user: string): Promise<string> {
  // 演示模式 / 未配置 Key：本地解析兜底
  if (settings.demo || !settings.apiKey.trim()) {
    await new Promise((r) => setTimeout(r, 400))
    return demoGenerate(user)
  }

  const base = settings.baseUrl.trim().replace(/\/+$/, '')
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey.trim()}`
    },
    body: JSON.stringify({
      model: settings.model.trim(),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.3,
      stream: false
    })
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`接口返回 ${res.status}：${(detail || res.statusText).slice(0, 200)}`)
  }

  const data = await res.json()
  const content: unknown = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('模型未返回内容，请重试或更换模型')
  }
  return content
}
