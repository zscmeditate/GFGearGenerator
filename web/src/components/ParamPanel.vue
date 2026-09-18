<script setup lang="ts">
import { computed } from 'vue'
import { RotateCcw } from 'lucide-vue-next'
import { useGearStore } from '../stores/gear'
import type { FieldDef } from '../gear/schema'
import NeuButton from './neu/NeuButton.vue'
import NeuInput from './neu/NeuInput.vue'
import NeuSwitch from './neu/NeuSwitch.vue'
import NeuSlider from './neu/NeuSlider.vue'

const store = useGearStore()

const fields = computed(() => store.meta.fields.filter((f) => f.id !== 'fastCompute'))

function isVisible(f: FieldDef): boolean {
  if (f.id === 'module') return store.params.standard === 'metric'
  if (f.id === 'pitch') return store.params.standard === 'english'
  return true
}

function valueOf(f: FieldDef): number | string | boolean {
  if (f.id in store.params) return (store.params as unknown as Record<string, number | string | boolean>)[f.id]
  return store.extra[f.id] as number | string | boolean
}

/** 显示值：英制下长度 mm → in */
function displayNumber(f: Extract<FieldDef, { measure: string }> & { id: string }): number {
  const v = Number(valueOf(f))
  if (store.params.standard === 'english' && f.measure === 'mm') return v / 25.4
  return v
}

function emitNumber(f: { id: string; measure: string }, displayVal: number) {
  let v = displayVal
  if (store.params.standard === 'english' && f.measure === 'mm') v = displayVal * 25.4
  store.setParam(f.id, f.measure === 'count' ? Math.round(v) : Number(v.toFixed(4)))
}

/** NeuInput 文本输入：拦截 NaN（如仅输入负号“-”时） */
function onNumberText(f: Extract<FieldDef, { measure: string }> & { id: string }, text: string) {
  const n = Number(text)
  if (Number.isFinite(n)) emitNumber(f, n)
}

function unitOf(f: { measure: string }): string {
  if (f.measure === 'mm') return store.params.standard === 'english' ? 'in' : 'mm'
  if (f.measure === 'dp') return 'DP'
  if (f.measure === 'deg') return '°'
  if (f.measure === 'count') return '齿'
  return ''
}

function isChoice(f: FieldDef): f is Extract<FieldDef, { options: unknown }> {
  return 'options' in f
}

function isBool(f: FieldDef): f is Extract<FieldDef, { default: boolean }> {
  return typeof f.default === 'boolean'
}
</script>

<template>
  <div class="param-panel">
    <h3 class="panel-title">
      <span class="title-text">
        <span>{{ store.meta.name }} 参数</span>
        <span class="title-en">{{ store.meta.en }}</span>
      </span>
      <NeuButton
        variant="icon"
        size="sm"
        shape="circle"
        title="恢复当前齿轮的默认参数"
        @click="store.resetParams()"
      >
        <RotateCcw :size="14" />
      </NeuButton>
    </h3>

    <template v-for="f in fields" :key="f.id">
      <!-- 数值：滑块 + 数字输入 -->
      <div v-if="!isChoice(f) && !isBool(f) && isVisible(f)" class="field">
        <label>
          <span>{{ f.label }}</span>
          <span class="unit">{{ unitOf(f) }}</span>
        </label>
        <div class="range-row">
          <NeuSlider
            class="range-slider"
            :min="f.min"
            :max="f.max"
            :step="f.step"
            :model-value="displayNumber(f)"
            @update:model-value="(v: number) => emitNumber(f, v)"
          />
          <NeuInput
            type="number"
            class="num-input"
            :model-value="String(displayNumber(f))"
            @update:model-value="(v: string) => onNumberText(f, v)"
          />
        </div>
      </div>

      <!-- 布尔开关 -->
      <div v-else-if="isBool(f)" class="switch-row">
        <span>{{ f.label }}</span>
        <NeuSwitch
          :model-value="Boolean(valueOf(f))"
          @update:model-value="(v: boolean) => store.setParam(f.id, v)"
        />
      </div>

      <!-- 分段选择 -->
      <div v-else-if="isChoice(f)" class="field">
        <label><span>{{ f.label }}</span></label>
        <div class="btn-row">
          <div v-for="opt in f.options" :key="opt.value" class="btn-col">
            <NeuButton
              size="sm"
              :active="valueOf(f) === opt.value"
              @click="store.setParam(f.id, opt.value)"
            >
              {{ opt.label }}
            </NeuButton>
            <div v-if="opt.hint && valueOf(f) === opt.value" class="hint">
              {{ opt.hint }}
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
