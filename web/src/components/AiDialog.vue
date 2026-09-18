<script setup lang="ts">
/**
 * AI 齿轮生成对话框：自然语言 → 大模型 → 齿轮参数 → 重建模型
 */
import { ref, watch } from 'vue'
import { Sparkles, Settings2, LoaderCircle } from 'lucide-vue-next'
import NeuModal from './neu/NeuModal.vue'
import NeuButton from './neu/NeuButton.vue'
import NeuSwitch from './neu/NeuSwitch.vue'
import { useGearStore } from '../stores/gear'
import { buildSystemPrompt, parseAiResponse, type AiGearResult } from '../ai/prompt'
import { callLLM, loadAiSettings, saveAiSettings, type AiSettings } from '../ai/client'
import { gearTypeMap } from '../gear/schema'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const store = useGearStore()

const req = ref('')
const calling = ref(false)
const errMsg = ref('')
const reply = ref('')
const applied = ref<{ label: string; value: string }[]>([])
const showSettings = ref(false)
const settings = ref<AiSettings>(loadAiSettings())

watch(
  () => props.modelValue,
  (v) => {
    if (v) settings.value = loadAiSettings()
  }
)
watch(settings, saveAiSettings, { deep: true })

const examples = [
  '模数 2、齿数 24 的直齿轮，齿宽 15',
  '蜗轮蜗杆传动，蜗轮 40 齿',
  '模数 3、25 齿、螺旋角 20° 的斜齿轮'
]

/** 把应用结果转成「中文标签 + 展示值」列表 */
function describeApplied(r: AiGearResult, prevType: string) {
  const meta = gearTypeMap[r.type]
  const out: { label: string; value: string }[] = []
  if (r.type !== prevType) out.push({ label: '齿轮类型', value: meta.name })
  if (r.standard) out.push({ label: '度量制', value: r.standard === 'metric' ? '公制' : '英制' })
  for (const [id, v] of Object.entries(r.params)) {
    const f = meta.fields.find((fd) => fd.id === id)
    if (!f) continue
    let display: string
    if ('options' in f) display = f.options.find((o) => o.value === v)?.label ?? String(v)
    else if (typeof v === 'boolean') display = v ? '开' : '关'
    else display = String(v)
    out.push({ label: f.label, value: display })
  }
  return out
}

async function generate() {
  const text = req.value.trim()
  if (!text || calling.value) return
  calling.value = true
  errMsg.value = ''
  reply.value = ''
  applied.value = []
  try {
    saveAiSettings(settings.value)
    const prevType = store.type
    const system = buildSystemPrompt(store.type, store.params, store.extra as Record<string, unknown>)
    const raw = await callLLM(settings.value, system, text)
    const result = parseAiResponse(raw, store.type)
    await store.applyAIGeneration(result)
    reply.value = result.reply || '已按需求更新齿轮参数并重建模型'
    applied.value = describeApplied(result, prevType)
  } catch (e) {
    errMsg.value = (e as Error).message
  } finally {
    calling.value = false
  }
}
</script>

<template>
  <NeuModal
    :model-value="modelValue"
    title="AI 齿轮生成"
    width="xl"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="ai-form">
      <textarea
        v-model="req"
        class="ai-textarea"
        rows="3"
        placeholder="用自然语言描述你的需求，例：模数 2、齿数 24、齿宽 15 的直齿轮（Ctrl+Enter 直接生成）"
        @keydown.enter.ctrl.prevent="generate"
      ></textarea>

      <div class="ai-examples">
        <button v-for="ex in examples" :key="ex" class="ai-chip" @click="req = ex">{{ ex }}</button>
      </div>

      <div class="ai-settings">
        <button class="ai-settings-toggle" @click="showSettings = !showSettings">
          <Settings2 :size="14" />
          <span>
            模型设置：{{
              settings.demo
                ? '演示模式（本地解析）'
                : settings.apiKey
                  ? settings.model
                  : '未配置 API Key（自动演示模式）'
            }}
          </span>
        </button>
        <div v-if="showSettings" class="ai-settings-body">
          <label class="ai-field">
            <span>接口地址</span>
            <input v-model="settings.baseUrl" type="text" placeholder="https://api.deepseek.com" />
          </label>
          <label class="ai-field">
            <span>模型名称</span>
            <input v-model="settings.model" type="text" placeholder="deepseek-chat" />
          </label>
          <label class="ai-field">
            <span>API Key</span>
            <input v-model="settings.apiKey" type="password" placeholder="sk-..." autocomplete="off" />
          </label>
          <label class="ai-demo">
            <NeuSwitch :model-value="settings.demo" @update:model-value="settings.demo = $event" />
            <span>演示模式（本地关键词解析，不调用 API）</span>
          </label>
          <p class="ai-hint">
            API Key 仅保存在本机浏览器 localStorage，由浏览器直连所选服务；接口兼容 OpenAI /chat/completions
            格式（DeepSeek / 通义千问 / Kimi 等）。
          </p>
        </div>
      </div>

      <div v-if="calling" class="ai-status">
        <LoaderCircle :size="16" class="ai-spin" />
        <span>大模型思考中…</span>
      </div>
      <div v-if="errMsg" class="ai-error">{{ errMsg }}</div>
      <div v-if="reply" class="ai-result">
        <p class="ai-reply">{{ reply }}</p>
        <ul v-if="applied.length" class="ai-applied">
          <li v-for="(a, i) in applied" :key="i">
            <span>{{ a.label }}</span>
            <b>{{ a.value }}</b>
          </li>
        </ul>
      </div>
    </div>

    <template #footer>
      <NeuButton variant="primary" :disabled="calling || !req.trim()" @click="generate">
        <Sparkles :size="15" />
        {{ calling ? '生成中…' : '生成齿轮' }}
      </NeuButton>
    </template>
  </NeuModal>
</template>

<style scoped>
.ai-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 需求输入框：凹陷面板风格 */
.ai-textarea {
  width: 100%;
  resize: none;
  border: none;
  outline: none;
  padding: 10px 12px;
  border-radius: var(--neu-radius-sm);
  background: var(--bg-color);
  color: var(--text-color);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.6;
  user-select: text;
  box-shadow:
    inset var(--neu-d2) var(--neu-d2) var(--neu-b2) var(--shadow-dark),
    inset var(--neu-d2-n) var(--neu-d2-n) var(--neu-b2) var(--shadow-light);
}

/* 示例提示词 */
.ai-examples {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ai-chip {
  border: none;
  padding: 5px 12px;
  border-radius: 999px;
  background: var(--bg-color);
  color: var(--text-color);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  opacity: 0.75;
  transition: all 0.2s ease;
  box-shadow:
    calc(var(--neu-d1) / 2) calc(var(--neu-d1) / 2) calc(var(--neu-b1) / 1.5) var(--shadow-dark),
    calc(var(--neu-d1-n) / 2) calc(var(--neu-d1-n) / 2) calc(var(--neu-b1) / 1.5) var(--shadow-light);
}

.ai-chip:hover {
  opacity: 1;
}

.ai-chip:active {
  box-shadow:
    inset calc(var(--neu-d1) / 2) calc(var(--neu-d1) / 2) calc(var(--neu-b1) / 1.5) var(--shadow-dark),
    inset calc(var(--neu-d1-n) / 2) calc(var(--neu-d1-n) / 2) calc(var(--neu-b1) / 1.5) var(--shadow-light);
}

/* 模型设置折叠区 */
.ai-settings {
  border-radius: var(--neu-radius-sm);
}

.ai-settings-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: var(--text-color);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  opacity: 0.7;
  padding: 2px 0;
  cursor: pointer;
}

.ai-settings-toggle:hover {
  opacity: 1;
}

.ai-settings-body {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: var(--neu-radius-sm);
  box-shadow:
    inset var(--neu-d1) var(--neu-d1) var(--neu-b1) var(--shadow-dark),
    inset var(--neu-d1-n) var(--neu-d1-n) var(--neu-b1) var(--shadow-light);
}

.ai-field {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  font-weight: 600;
}

.ai-field > span {
  flex: 0 0 64px;
  text-align: right;
  opacity: 0.8;
}

.ai-field > input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  padding: 6px 10px;
  border-radius: var(--neu-radius-sm);
  background: var(--bg-color);
  color: var(--text-color);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  user-select: text;
  box-shadow:
    inset var(--neu-d1) var(--neu-d1) var(--neu-b1) var(--shadow-dark),
    inset var(--neu-d1-n) var(--neu-d1-n) var(--neu-b1) var(--shadow-light);
}

.ai-demo {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.ai-hint {
  margin: 0;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.6;
  opacity: 0.55;
}

/* 状态与结果 */
.ai-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  opacity: 0.75;
}

.ai-spin {
  animation: ai-rotate 1s linear infinite;
}

@keyframes ai-rotate {
  to {
    transform: rotate(360deg);
  }
}

.ai-error {
  padding: 8px 12px;
  border-radius: var(--neu-radius-sm);
  font-size: 12px;
  font-weight: 600;
  color: var(--danger);
  box-shadow:
    inset var(--neu-d1) var(--neu-d1) var(--neu-b1) var(--shadow-dark),
    inset var(--neu-d1-n) var(--neu-d1-n) var(--neu-b1) var(--shadow-light);
}

.ai-result {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--neu-radius-sm);
  box-shadow:
    inset var(--neu-d1) var(--neu-d1) var(--neu-b1) var(--shadow-dark),
    inset var(--neu-d1-n) var(--neu-d1-n) var(--neu-b1) var(--shadow-light);
}

.ai-reply {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.6;
}

.ai-applied {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 4px 14px;
}

.ai-applied li {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
}

.ai-applied li span {
  opacity: 0.6;
}

.ai-applied li b {
  font-weight: 600;
}
</style>
