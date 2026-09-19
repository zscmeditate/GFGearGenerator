/**
 * AI 生成齿轮 —— 大模型客户端（OpenAI 兼容 /chat/completions）
 * 设置保存在 localStorage；未配置 API Key 时直接提示去设置。
 */

export interface AiSettings {
  /** OpenAI 兼容接口基地址（不带尾部斜杠与路径） */
  baseUrl: string
  model: string
  apiKey: string
}

const STORAGE_KEY = 'gf-ai-settings'

export const defaultAiSettings: AiSettings = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  apiKey: ''
}

export function loadAiSettings(): AiSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<AiSettings>
    // 只取已知字段：兼容清理历史遗留的 demo 等废弃键
    return {
      baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : defaultAiSettings.baseUrl,
      model: typeof raw.model === 'string' ? raw.model : defaultAiSettings.model,
      apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : defaultAiSettings.apiKey
    }
  } catch {
    return { ...defaultAiSettings }
  }
}

export function saveAiSettings(s: AiSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

/* ---------- 调用大模型（支持多轮 messages） ---------- */

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export async function callLLM(settings: AiSettings, messages: ChatMsg[]): Promise<string> {
  if (!settings.apiKey.trim()) {
    throw new Error('未配置 API Key，请点击左下角「大模型设置」填写')
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
      messages,
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
