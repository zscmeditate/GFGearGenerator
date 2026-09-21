<script setup lang="ts">
/**
 * AI 齿轮工作台：全屏聊天式生成界面。
 * - 左侧：历史会话列表（新建 / 重命名 / 删除），左下角大模型设置入口；
 * - 右侧：多轮对话流，用户消息为文本气泡，AI 消息为文字 + 独立参数快照的
 *   3D 预览画布（滚入视野才启动渲染循环）+ 变化参数表 + 应用到主视图。
 */
import { nextTick, ref, watch } from 'vue'
import { ChatDotRound, Delete, Edit, Loading, MagicStick, Plus, Promotion, Setting } from '@element-plus/icons-vue'
import { useAiChatStore } from '../stores/aiChat'
import { loadAiSettings, type AiSettings } from '../ai/client'
import type { AiChatSession } from '../ai/session'
import { gearTypeMap } from '../gear/schema'
import GearViewer from './GearViewer.vue'
import AiSettingsDialog from './AiSettingsDialog.vue'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const store = useAiChatStore()
const draft = ref('')
const flowEl = ref<HTMLDivElement | null>(null)
const settingsOpen = ref(false)
const settings = ref<AiSettings>(loadAiSettings())

const examples = [
  '两级直齿轮减速：输入 20 齿、输出 60 齿，模数 2、齿宽 15',
  '行星齿轮组：太阳轮 18 齿、3 个 27 齿行星轮均布、内齿圈 72 齿，模数 2',
  '齿轮齿条传动：小齿轮 20 齿模数 2，配一根齿条',
  '锥齿轮正交传动：大轮 30 齿、小轮 15 齿，模数 2.5'
]

/* ---------- 会话重命名（行内编辑） ---------- */
const editingId = ref('')
const editingTitle = ref('')
const renameInputRef = ref<{ focus: () => void } | null>(null)

function startRename(s: AiChatSession) {
  editingId.value = s.id
  editingTitle.value = s.title
}

function commitRename() {
  if (!editingId.value) return
  store.renameSession(editingId.value, editingTitle.value)
  editingId.value = ''
}

function cancelRename() {
  editingId.value = ''
}

watch(editingId, (v) => {
  if (v) nextTick(() => renameInputRef.value?.focus())
})

/* ---------- 打开 / 滚动 ---------- */
watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      settings.value = loadAiSettings()
      store.init()
      nextTick(() => scrollBottom(false))
    }
  }
)

watch(
  () => store.activeId,
  () => nextTick(() => scrollBottom(false))
)

watch(
  () => [store.activeSession?.messages.length, store.calling] as const,
  () => nextTick(() => scrollBottom())
)

function scrollBottom(smooth = true) {
  const el = flowEl.value
  if (!el) return
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
}

/* ---------- 发送 ---------- */
function send() {
  const text = draft.value.trim()
  if (!text || store.calling) return
  draft.value = ''
  void store.send(text)
}

const modelLineText = () => {
  const s = settings.value
  return s.apiKey.trim() ? s.model : '未配置 API Key'
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    width="60%"
    destroy-on-close
    class="ai-chat-dialog"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #header>
      <div class="chat-header">
        <span class="chat-title">
          <span class="title-badge"><el-icon><MagicStick /></el-icon></span>
          <span class="title-text"><em>AI</em> 齿轮生成</span>
        </span>
        <span class="chat-sub">多轮对话 · 描述传动方案，AI 输出齿轮组并自动装配预览</span>
      </div>
    </template>

    <div class="chat-shell">
      <!-- 左侧：新建会话 + 会话面板（凹陷） + 大模型设置 -->
      <aside class="chat-side">
        <el-button type="primary" class="new-chat-btn" :icon="Plus" @click="store.newSession()">
          新建会话
        </el-button>

        <div class="session-panel">
          <div class="session-list">
            <div
              v-for="s in store.sortedSessions"
              :key="s.id"
              class="session-item"
              :class="{ active: s.id === store.activeId }"
              @click="editingId === s.id ? commitRename() : store.selectSession(s.id)"
            >
              <el-icon class="s-ico"><ChatDotRound /></el-icon>
              <el-input
                v-if="editingId === s.id"
                ref="renameInputRef"
                v-model="editingTitle"
                size="small"
                @keyup.enter="commitRename"
                @keydown.esc.prevent="cancelRename"
                @blur="commitRename"
                @click.stop
              />
              <template v-else>
                <span class="s-title" :title="s.title">{{ s.title }}</span>
                <span class="s-ops">
                  <el-icon title="重命名" @click.stop="startRename(s)"><Edit /></el-icon>
                  <el-icon title="删除" @click.stop="store.deleteSession(s.id)"><Delete /></el-icon>
                </span>
              </template>
            </div>
          </div>
        </div>

        <div class="side-footer">
          <el-button class="settings-btn" :icon="Setting" @click="settingsOpen = true">
            大模型设置
          </el-button>
          <div class="model-line">{{ modelLineText() }}</div>
        </div>
      </aside>

      <!-- 右侧：对话流（凹陷） + 输入区（面板外） -->
      <main class="chat-main">
       <div class="chat-panel">
        <div ref="flowEl" class="chat-flow">
          <div v-if="store.activeSession" class="flow-inner" :key="store.activeId">
            <!-- 空会话引导 -->
            <div v-if="!store.activeSession.messages.length" class="flow-empty">
              <div class="empty-badge"><el-icon><MagicStick /></el-icon></div>
              <div class="empty-title">描述你想要的齿轮或传动方案</div>
              <div class="empty-sub">AI 会给出整组齿轮参数、自动啮合装配与 3D 预览，可继续追问调整</div>
              <div class="empty-examples">
                <el-button v-for="ex in examples" :key="ex" round size="small" @click="draft = ex">
                  {{ ex }}
                </el-button>
              </div>
            </div>

            <template v-for="m in store.activeSession.messages" :key="m.id">
              <!-- 用户消息：文本气泡 -->
              <div v-if="m.role === 'user'" class="row user">
                <div class="user-bubble">{{ m.text }}</div>
              </div>

              <!-- AI 消息：文字 + 预览画布 + 变化参数 -->
              <div v-else class="row ai">
                <div class="ai-avatar"><el-icon><MagicStick /></el-icon></div>
                <div class="ai-body">
                  <el-alert
                    v-if="m.error"
                    class="ai-error"
                    type="error"
                    :title="m.error"
                    :closable="false"
                    show-icon
                  />
                  <template v-else>
                    <div class="ai-text">{{ m.text }}</div>
                    <div v-if="m.assembly" class="ai-canvas-card">
                      <GearViewer :assembly="m.assembly" />
                    </div>
                    <el-descriptions
                      v-if="m.changes && m.changes.length"
                      class="ai-changes"
                      :column="2"
                      size="small"
                      border
                    >
                      <el-descriptions-item v-for="(c, i) in m.changes" :key="i" :label="c.label">
                        {{ c.value }}
                      </el-descriptions-item>
                    </el-descriptions>
                    <div v-if="m.assembly && m.assembly.gears.length" class="ai-actions">
                      <el-button
                        v-for="g in m.assembly.gears"
                        :key="g.id"
                        size="small"
                        type="primary"
                        plain
                        :icon="Promotion"
                        @click="store.applyGearToMain(g)"
                      >
                        应用 {{ g.id }} · {{ gearTypeMap[g.type].name }}
                      </el-button>
                    </div>
                  </template>
                </div>
              </div>
            </template>

            <!-- 思考中 -->
            <div v-if="store.calling" class="row ai">
              <div class="ai-avatar"><el-icon class="is-loading"><Loading /></el-icon></div>
              <div class="ai-body">
                <div class="ai-text thinking">大模型思考中…</div>
              </div>
            </div>
          </div>
        </div>
       </div>

       <div class="chat-input">
         <el-input
           v-model="draft"
           type="textarea"
           :rows="2"
           resize="none"
           placeholder="描述齿轮或传动方案，例：两级直齿轮减速，输入 20 齿、输出 60 齿，模数 2"
           @keydown.enter.ctrl.prevent="send"
         />
         <div class="input-foot">
           <span class="input-hint">Enter 换行 · Ctrl + Enter 发送</span>
           <el-button
             type="primary"
             :icon="Promotion"
             :loading="store.calling"
             :disabled="!draft.trim()"
             @click="send"
           >
             {{ store.calling ? '生成中…' : '发送' }}
           </el-button>
         </div>
       </div>
      </main>
    </div>

    <AiSettingsDialog v-model="settingsOpen" @saved="settings = loadAiSettings()" />
  </el-dialog>
</template>

<style scoped>
.chat-header {
  display: flex;
  align-items: center;
  gap: 14px;
}

.chat-title {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 17px;
  font-weight: 800;
  letter-spacing: 0.3px;
  color: #2e3b4e;
}

/* 渐变徽章：随主题色联动 */
.title-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  font-size: 16px;
  color: #fff;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--el-color-primary) 55%, #fff),
    var(--el-color-primary)
  );
  box-shadow: 0 3px 10px color-mix(in srgb, var(--el-color-primary) 35%, transparent);
}

.title-text em {
  font-style: normal;
  background: linear-gradient(
    120deg,
    var(--el-color-primary),
    color-mix(in srgb, var(--el-color-primary) 55%, #5d6c85)
  );
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.chat-sub {
  font-size: 12px;
  line-height: 1;
  color: #8b95a5;
  padding-left: 14px;
  border-left: 1px solid #e3e9f0;
}

/* ---------- 布局 ---------- */
.chat-shell {
  display: flex;
  gap: 14px;
  height: 100%;
  min-height: 0;
}

.chat-side {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 252px;
  flex-shrink: 0;
}

/* 会话列表凹陷面板：按钮在面板外、面板只包列表 */
.session-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px;
  background: #e0e6ed;
  border-radius: 14px;
  box-shadow:
    inset 3px 3px 6px rgba(163, 177, 198, 0.55),
    inset -3px -3px 6px rgba(255, 255, 255, 0.85);
}

.chat-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  gap: 10px;
}

/* 对话流凹陷面板：输入区在面板外、面板只包消息列表 */
.chat-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #e0e6ed;
  border-radius: 14px;
  box-shadow:
    inset 3px 3px 6px rgba(163, 177, 198, 0.55),
    inset -3px -3px 6px rgba(255, 255, 255, 0.85);
  overflow: hidden;
}

/* ---------- 会话列表 ---------- */
.new-chat-btn {
  align-self: center;
  width: 50%;
  border-radius: 999px;
}

.session-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  color: #4b5563;
  font-size: 13px;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.session-item:hover {
  background: #f1f4f8;
}

.session-item.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary-dark-2);
  font-weight: 600;
}

.s-ico {
  flex-shrink: 0;
  font-size: 15px;
  opacity: 0.75;
}

.s-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.s-ops {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.session-item:hover .s-ops,
.session-item.active .s-ops {
  opacity: 1;
}

.s-ops .el-icon {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  font-size: 16px;
  color: #8b95a5;
}

.s-ops .el-icon:hover {
  color: var(--el-color-primary);
  background: rgba(255, 255, 255, 0.7);
}

/* ---------- 侧栏底部：大模型设置（面板外） ---------- */
.side-footer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 10px;
}

.settings-btn {
  align-self: center;
  width: 50%;
  margin-left: 0;
}

.model-line {
  font-size: 11.5px;
  color: #9aa3b2;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------- 对话流 ---------- */
.chat-flow {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.flow-inner {
  max-width: 800px;
  margin: 0 auto;
  padding: 22px 26px 30px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.flow-empty {
  margin: auto;
  padding: 60px 0 40px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.empty-badge {
  width: 56px;
  height: 56px;
  border-radius: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  color: #fff;
  background: linear-gradient(135deg, var(--el-color-primary), var(--el-color-primary-light-3));
  box-shadow: 0 8px 20px var(--el-color-primary-light-5);
}

.empty-title {
  margin-top: 6px;
  font-size: 18px;
  font-weight: 700;
  color: #344054;
}

.empty-sub {
  font-size: 13px;
  color: #8b95a5;
}

.empty-examples {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 10px;
}

.empty-examples .el-button {
  margin-left: 0;
}

.row.user {
  display: flex;
  justify-content: flex-end;
}

.user-bubble {
  max-width: 72%;
  padding: 10px 14px;
  border-radius: 14px 14px 4px 14px;
  background: var(--el-color-primary-light-8);
  color: #344054;
  font-size: 14px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

.row.ai {
  display: flex;
  gap: 10px;
}

.ai-avatar {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 15px;
  background: linear-gradient(135deg, var(--el-color-primary), var(--el-color-primary-light-3));
  box-shadow: 0 3px 10px var(--el-color-primary-light-5);
}

.ai-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}

.ai-text {
  font-size: 14px;
  line-height: 1.7;
  color: #303133;
  white-space: pre-wrap;
  word-break: break-word;
}

.ai-text.thinking {
  color: #8b95a5;
}

.ai-error {
  max-width: 560px;
}

.ai-canvas-card {
  position: relative;
  width: 100%;
  max-width: 620px;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-radius: 12px;
  box-shadow: 0 2px 10px rgba(110, 125, 150, 0.14);
}

.ai-changes {
  max-width: 620px;
}

.ai-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ai-actions :deep(.el-button) {
  margin-left: 0;
}

/* ---------- 输入区 ---------- */
.chat-input {
  flex-shrink: 0;
  padding: 0 16px 12px;
}

.input-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}

.input-hint {
  font-size: 11.5px;
  color: #a8b0bf;
}

.chat-input :deep(.el-textarea__inner) {
  border-radius: 12px;
}
</style>

<style>
/* ---------- 悬浮对话框骨架（90% 大小）----------
 * class 落在 .el-dialog 元素自身上，scoped 选择器无法命中，
 * 故用自定义类名隔离的非 scoped 样式块 */
.ai-chat-dialog {
  height: 90vh;
  margin: 5vh auto;
  border-radius: 14px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* 对话框底色与主界面页面底色一致，使内部两个 #e0e6ed 凹陷面板
   拥有与 .app-brand 相同的环绕色，凹陷的暗边/高光对比才一致 */
.ai-chat-dialog.el-dialog {
  background-color: #e8edf3;
}

.ai-chat-dialog .el-dialog__header {
  margin-right: 0;
  height: 44px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid rgba(163, 177, 198, 0.45);
  background: transparent;
}

.ai-chat-dialog .el-dialog__headerbtn {
  top: 0;
  height: 44px;
}

.ai-chat-dialog .el-dialog__body {
  flex: 1;
  overflow: hidden;
  /* 左右下贴边，仅与上方 header 留出间隙 */
  padding: 12px 0 0;
}
</style>
