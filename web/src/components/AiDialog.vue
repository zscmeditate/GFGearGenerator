<script setup lang="ts">
/**
 * AI 齿轮生成对话框：自然语言 → 大模型 → 齿轮参数 → 重建模型
 */
import { ref, watch } from 'vue'
import { MagicStick, Setting, Loading } from '@element-plus/icons-vue'
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
  <el-dialog
    :model-value="modelValue"
    title="AI 齿轮生成"
    width="600px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-input
      v-model="req"
      type="textarea"
      :rows="3"
      resize="none"
      placeholder="用自然语言描述你的需求，例：模数 2、齿数 24、齿宽 15 的直齿轮（Ctrl+Enter 直接生成）"
      @keydown.enter.ctrl.prevent="generate"
    />

    <div class="ai-examples">
      <el-button
        v-for="ex in examples"
        :key="ex"
        round
        size="small"
        @click="req = ex"
      >
        {{ ex }}
      </el-button>
    </div>

    <div class="ai-settings">
      <el-button text size="small" :icon="Setting" @click="showSettings = !showSettings">
        模型设置：{{
          settings.demo
            ? '演示模式（本地解析）'
            : settings.apiKey
              ? settings.model
              : '未配置 API Key（自动演示模式）'
        }}
      </el-button>

      <el-collapse-transition>
        <div v-show="showSettings" class="ai-settings-body">
          <el-input v-model="settings.baseUrl" placeholder="https://api.deepseek.com" />
          <el-input v-model="settings.model" placeholder="deepseek-chat" />
          <el-input
            v-model="settings.apiKey"
            type="password"
            show-password
            placeholder="sk-..."
            autocomplete="off"
          />
          <div class="ai-demo">
            <el-switch v-model="settings.demo" />
            <span>演示模式（本地关键词解析，不调用 API）</span>
          </div>
          <el-alert
            type="info"
            :closable="false"
            show-icon
            title="API Key 仅保存在本机浏览器 localStorage，由浏览器直连所选服务；接口兼容 OpenAI /chat/completions 格式（DeepSeek / 通义千问 / Kimi 等）。"
          />
        </div>
      </el-collapse-transition>
    </div>

    <div v-if="calling" class="ai-status">
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>大模型思考中…</span>
    </div>

    <el-alert
      v-if="errMsg"
      class="ai-alert"
      type="error"
      show-icon
      :title="errMsg"
      :closable="false"
    />

    <div v-if="reply" class="ai-result">
      <p class="ai-reply">{{ reply }}</p>
      <el-descriptions
        v-if="applied.length"
        :column="2"
        border
        size="small"
      >
        <el-descriptions-item
          v-for="(a, i) in applied"
          :key="i"
          :label="a.label"
        >
          {{ a.value }}
        </el-descriptions-item>
      </el-descriptions>
    </div>

    <template #footer>
      <el-button
        type="primary"
        :icon="MagicStick"
        :loading="calling"
        :disabled="!req.trim()"
        @click="generate"
      >
        {{ calling ? '生成中…' : '生成齿轮' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ai-examples {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}

/* 重置 Element Plus 相邻按钮的默认 margin-left，避免与 gap 叠加导致间距不齐 */
.ai-examples .el-button {
  margin-left: 0;
}

.ai-settings {
  margin-top: 12px;
}

.ai-settings-body {
  margin-top: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
}

.ai-demo {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: #606266;
}

.ai-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  font-size: 13px;
  color: #606266;
}

.ai-alert {
  margin-top: 12px;
}

.ai-result {
  margin-top: 12px;
}

.ai-reply {
  margin: 0 0 10px;
  font-size: 13px;
  line-height: 1.6;
  color: #303133;
}
</style>
