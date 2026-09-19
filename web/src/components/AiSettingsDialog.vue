<script setup lang="ts">
/**
 * 大模型设置弹窗：接口地址 / 模型名 / API Key。
 * 保存到 localStorage（与旧 AI 对话框共用 gf-ai-settings）。
 */
import { ref, watch } from 'vue'
import { loadAiSettings, saveAiSettings, type AiSettings } from '../ai/client'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'saved'): void
}>()

const draft = ref<AiSettings>(loadAiSettings())

watch(
  () => props.modelValue,
  (v) => {
    if (v) draft.value = loadAiSettings()
  }
)

function save() {
  saveAiSettings(draft.value)
  emit('saved')
  emit('update:modelValue', false)
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="大模型设置"
    width="480px"
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="settings-body">
      <el-input v-model="draft.baseUrl" placeholder="https://api.deepseek.com">
        <template #prepend>接口地址</template>
      </el-input>
      <el-input v-model="draft.model" placeholder="deepseek-chat">
        <template #prepend>模型名称</template>
      </el-input>
      <el-input
        v-model="draft.apiKey"
        type="password"
        show-password
        placeholder="sk-..."
        autocomplete="off"
      >
        <template #prepend>API Key</template>
      </el-input>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="API Key 仅保存在本机浏览器 localStorage，由浏览器直连所选服务；接口兼容 OpenAI /chat/completions 格式（DeepSeek / 通义千问 / Kimi 等）。"
      />
    </div>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.settings-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
