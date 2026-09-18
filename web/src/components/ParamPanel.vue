<script setup lang="ts">
import { computed } from 'vue'
import { useGearStore } from '../stores/gear'
import type { FieldDef } from '../gear/schema'

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

function unitOf(f: { measure: string }): string {
  if (f.measure === 'mm') return store.params.standard === 'english' ? 'in' : 'mm'
  if (f.measure === 'dp') return 'DP'
  if (f.measure === 'deg') return '°'
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
  <div class="panel">
    <h3>
      <span>{{ store.meta.name }} 参数</span>
      <span style="color:var(--text-2);font-weight:400">{{ store.meta.en }}</span>
    </h3>

    <template v-for="f in fields" :key="f.id">
      <!-- 数值 -->
      <div v-if="!isChoice(f) && !isBool(f) && isVisible(f)" class="field">
        <label>
          <span>{{ f.label }}</span>
          <span class="unit">{{ unitOf(f) }}</span>
        </label>
        <div class="range-row">
          <input
            type="range"
            :min="f.min"
            :max="f.max"
            :step="f.step"
            :value="displayNumber(f)"
            @input="emitNumber(f, Number(($event.target as HTMLInputElement).value))"
          />
          <input
            type="number"
            :min="f.min"
            :max="f.max"
            :step="f.step"
            :value="displayNumber(f)"
            @change="emitNumber(f, Number(($event.target as HTMLInputElement).value))"
          />
        </div>
      </div>

      <!-- 布尔开关 -->
      <div v-else-if="isBool(f)" class="switch-row">
        <span>{{ f.label }}</span>
        <label class="switch">
          <input
            type="checkbox"
            :checked="Boolean(valueOf(f))"
            @change="store.setParam(f.id, ($event.target as HTMLInputElement).checked)"
          />
          <span class="track"></span>
        </label>
      </div>

      <!-- 分段选择 -->
      <div v-else-if="isChoice(f)" class="field">
        <label><span>{{ f.label }}</span></label>
        <div class="choice-seg">
          <button
            v-for="opt in f.options"
            :key="opt.value"
            :class="{ active: valueOf(f) === opt.value }"
            :title="opt.hint"
            @click="store.setParam(f.id, opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>
        <div class="hint" v-if="f.options.find((o) => o.value === valueOf(f))?.hint">
          {{ f.options.find((o) => o.value === valueOf(f))?.hint }}
        </div>
      </div>
    </template>
  </div>
</template>
