/**
 * AI 聊天工作台状态：历史会话 CRUD、多轮发送流程、齿轮组装配快照解析。
 * 会话与消息持久化在 localStorage（gf-ai-sessions-v2）。
 */
import { defineStore } from 'pinia'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useGearStore } from './gear'
import { buildSystemPrompt, parseAiResponse, type AiGearResult } from '../ai/prompt'
import { callLLM, loadAiSettings } from '../ai/client'
import {
  DEFAULT_SESSION_TITLE,
  assemblyFromState,
  buildLlmMessages,
  describeAssemblyChanges,
  loadChatData,
  resolveAssembly,
  saveChatData,
  uid,
  type AiChatMessage,
  type AiChatSession,
  type AiAssemblySnapshot,
  type AssemblyGearSnap
} from '../ai/session'

export const useAiChatStore = defineStore('aiChat', {
  state: () => ({
    sessions: [] as AiChatSession[],
    activeId: '',
    calling: false
  }),

  getters: {
    activeSession: (s) => s.sessions.find((x) => x.id === s.activeId),
    sortedSessions: (s) => [...s.sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  },

  actions: {
    init() {
      const data = loadChatData()
      if (data && data.sessions.length) {
        this.sessions = data.sessions
        this.activeId = data.sessions.some((x) => x.id === data.activeId)
          ? data.activeId
          : data.sessions[0].id
      } else {
        this.sessions = []
        this.newSession()
      }
    },

    persist() {
      saveChatData({ sessions: this.sessions, activeId: this.activeId })
    },

    newSession() {
      const now = Date.now()
      const s: AiChatSession = {
        id: uid(),
        title: DEFAULT_SESSION_TITLE,
        messages: [],
        createdAt: now,
        updatedAt: now
      }
      this.sessions.push(s)
      this.activeId = s.id
      this.persist()
      return s
    },

    selectSession(id: string) {
      if (!this.sessions.some((s) => s.id === id)) return
      this.activeId = id
      this.persist()
    },

    renameSession(id: string, title: string) {
      const s = this.sessions.find((x) => x.id === id)
      if (!s) return
      const t = title.trim()
      if (t) s.title = t
      this.persist()
    },

    async deleteSession(id: string) {
      const s = this.sessions.find((x) => x.id === id)
      if (!s) return
      try {
        await ElMessageBox.confirm(`删除会话「${s.title}」？该操作不可恢复。`, '删除会话', {
          type: 'warning',
          confirmButtonText: '删除',
          cancelButtonText: '取消'
        })
      } catch {
        return
      }
      this.sessions = this.sessions.filter((x) => x.id !== id)
      if (this.activeId === id) this.activeId = this.sessions[0]?.id ?? ''
      // 至少保留一个空会话，保证对话流始终可用
      if (!this.sessions.length) this.newSession()
      else this.persist()
    },

    /** 会话内的当前基准装配：最后一条 assistant 装配快照；还没有则返回 null（用主视图状态兜底） */
    currentBase(): AiAssemblySnapshot | null {
      const s = this.activeSession
      if (!s) return null
      for (let i = s.messages.length - 1; i >= 0; i--) {
        const m = s.messages[i]
        if (m.assembly) return m.assembly
      }
      return null
    },

    async send(text: string) {
      const content = text.trim()
      const s = this.activeSession
      if (!content || !s || this.calling) return

      s.messages.push({ id: uid(), role: 'user', text: content, time: Date.now() })
      // 首条消息自动作为会话标题
      if (s.title === DEFAULT_SESSION_TITLE) {
        s.title = content.length > 16 ? content.slice(0, 16) + '…' : content
      }
      s.updatedAt = Date.now()
      this.persist()

      this.calling = true
      try {
        const gearStore = useGearStore()
        const prev = this.currentBase()
        const current =
          prev ??
          assemblyFromState(
            gearStore.type,
            gearStore.params,
            gearStore.extra as Record<string, unknown>
          )
        const system = buildSystemPrompt(current)
        const raw = await callLLM(loadAiSettings(), buildLlmMessages(s, system))
        const result = parseAiResponse(raw)
        // 合并增量并做拓扑/物理啮合校验（模数、旋向、齿数差等不满足会在此抛错）
        const snapshot = resolveAssembly(current, result, gearStore.params.standard)
        const msg: AiChatMessage = {
          id: uid(),
          role: 'assistant',
          text: result.reply || '已按需求生成齿轮组方案',
          time: Date.now(),
          result,
          assembly: snapshot,
          changes: describeAssemblyChanges(current, snapshot)
        }
        s.messages.push(msg)
      } catch (e) {
        s.messages.push({
          id: uid(),
          role: 'assistant',
          text: '',
          time: Date.now(),
          error: (e as Error).message
        })
      } finally {
        this.calling = false
        s.updatedAt = Date.now()
        this.persist()
      }
    },

    /** 把齿轮组中的某一个齿轮应用到主视图（主视图仍为单齿轮模型） */
    applyGearToMain(gear: AssemblyGearSnap) {
      const gearStore = useGearStore()
      const r: AiGearResult = {
        type: gear.type,
        standard: gear.standard,
        params: gear.values as Record<string, number | boolean | string>,
        reply: ''
      }
      void gearStore.applyAIGeneration(r)
      ElMessage.success(`已将 ${gear.id} 应用到主视图，模型重建中`)
    }
  }
})
