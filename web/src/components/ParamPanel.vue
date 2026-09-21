<script setup lang="ts">
import { computed } from 'vue'
import { RefreshLeft, Setting } from '@element-plus/icons-vue'
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

/** 动态上限：字段带 maxFn 时按当前参数计算（如扁位切深受孔径之半限制），否则用静态 max */
function maxOf(f: FieldDef): number {
  const n = f as { max: number; maxFn?: (p: typeof store.params) => number }
  return typeof n.maxFn === 'function' ? n.maxFn(store.params) : n.max
}

function emitNumber(f: { id: string; measure: string }, displayVal: number) {
  let v = displayVal
  if (store.params.standard === 'english' && f.measure === 'mm') v = displayVal * 25.4
  store.setParam(f.id, f.measure === 'count' ? Math.round(v) : Number(v.toFixed(4)))
}

/** el-input-number 清空时会给出 undefined，需守卫 */
function onNumberInput(f: Extract<FieldDef, { measure: string }> & { id: string }, v: number | undefined) {
  if (typeof v === 'number' && Number.isFinite(v)) emitNumber(f, v)
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
  <el-card class="param-card" shadow="never">
    <template #header>
      <div class="param-header">
        <div class="param-title-wrap">
          <span class="param-icon">
            <el-icon :size="16"><Setting /></el-icon>
          </span>
          <div class="param-titles">
            <span class="param-name">{{ store.meta.name }}参数</span>
            <span class="param-en">{{ store.meta.en }}</span>
          </div>
        </div>
        <el-button
          circle
          size="small"
          :icon="RefreshLeft"
          title="恢复当前齿轮的默认参数"
          @click="store.resetParams()"
        />
      </div>
    </template>

    <el-form label-position="top" class="param-form">
      <template v-for="f in fields" :key="f.id">
        <!-- 数值：滑块 + 数字输入 -->
        <el-form-item v-if="!isChoice(f) && !isBool(f) && isVisible(f)" class="param-item number-item">
          <template #label>
            <div class="field-label">
              <span>{{ f.label }}</span>
            </div>
          </template>
          <div class="range-row">
            <el-slider
              class="range-slider"
              :min="f.min"
              :max="maxOf(f)"
              :step="f.step"
              :model-value="displayNumber(f)"
              @update:model-value="(v: number) => emitNumber(f, v)"
            />
            <el-input-number
              class="num-input"
              size="small"
              :controls="false"
              :min="f.min"
              :max="maxOf(f)"
              :step="f.step"
              :precision="f.measure === 'count' ? 0 : undefined"
              :model-value="displayNumber(f)"
              @update:model-value="(v: number | undefined) => onNumberInput(f, v)"
            />
            <span class="field-unit">{{ unitOf(f) }}</span>
          </div>
        </el-form-item>

        <!-- 布尔开关 -->
        <el-form-item v-else-if="isBool(f)" class="param-item bool-item">
          <span class="bool-label">{{ f.label }}</span>
          <el-switch
            :model-value="Boolean(valueOf(f))"
            @update:model-value="(v: boolean) => store.setParam(f.id, v)"
          />
        </el-form-item>

        <!-- 分段选择 -->
        <el-form-item v-else-if="isChoice(f)" class="param-item choice-item">
          <template #label>
            <div class="field-label"><span>{{ f.label }}</span></div>
          </template>
          <el-radio-group
            class="choice-group"
            :model-value="valueOf(f)"
            @update:model-value="(v: string | number | boolean) => store.setParam(f.id, v)"
          >
            <el-radio-button
              v-for="opt in f.options"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </el-radio-button>
          </el-radio-group>
          <div v-if="f.options.find((o) => o.value === valueOf(f))?.hint" class="choice-hint">
            {{ f.options.find((o) => o.value === valueOf(f))?.hint }}
          </div>
        </el-form-item>
      </template>
    </el-form>
  </el-card>
</template>

<style scoped>
.param-card {
  border: none;
}

.param-card :deep(.el-card__header) {
  padding: 12px;
  border-bottom: 1px solid var(--el-color-primary);
}

.param-card :deep(.el-card__body) {
  padding: 16px 16px 16px 12px;
}

.param-header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

/* 重置按钮靠右，标题块靠左（flex 容器 space-between） */
.param-header .el-button {
  margin-left: auto;
}

.param-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

/* 标题左侧图标徽章：主题色着色，随右下角主题切换联动 */
.param-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: 9px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-8);
}

.param-titles {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
}

.param-name {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}

.param-en {
  font-size: 11px;
  color: #909399;
}

.param-form :deep(.el-form-item) {
  margin-bottom: 8px;
}

.param-form :deep(.el-form-item__label) {
  padding-bottom: 0;
  line-height: 1.4;
}

/* 数值行（滑块+输入框+单位）的标题与控件更紧凑：覆盖 Element Plus label-top 默认的 8px 下外边距 */
.number-item :deep(.el-form-item__label) {
  margin-bottom: 0;
}

.field-label {
  font-size: 13px;
  color: #606266;
}

.field-unit {
  width: 40px;
  box-sizing: border-box;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  padding: 2px 0;
  border-radius: 10px;
  line-height: 1.4;
  text-align: center;
  white-space: nowrap;
  flex-shrink: 0;
}

.range-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}

.range-slider {
  flex: 1;
  min-width: 0;
  /* 最小值时圆形滑块（直径20px）中心对齐轨道左端，会向左溢出 10px；
     左侧补 12px 内边距，让圆点收进与标签/轨道对齐的左边界内 */
  padding-left: 12px;
  /* 最大值时滑块同样向右溢出 10px，右侧补 10px 避免与数字输入框重叠 */
  padding-right: 10px;
}

.num-input {
  width: 52px;
  flex-shrink: 0;
}

.bool-item :deep(.el-form-item__content) {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.bool-label {
  font-size: 13px;
  color: #606266;
}

/* 子类型按钮：两个选项上下垂直堆叠，按钮之间留出垂直间距 */
/* align-items: center 使 80% 宽的按钮在组内水平居中 */
.choice-group {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

/* 覆盖 Element Plus 分段按钮相邻项的 -1px 重叠，按钮宽度为组宽的 80% */
.choice-group :deep(.el-radio-button) {
  width: 80%;
  margin-left: 0;
}

/* 每个按钮独立整宽、独立圆角，去掉分段拼接用的左侧阴影 */
.choice-group :deep(.el-radio-button__inner) {
  width: 100%;
  border-radius: 8px;
  box-shadow: none;
}

.choice-hint {
  width: 100%;
  margin-top: 6px;
  font-size: 11px;
  color: #909399;
  line-height: 1.4;
  text-align: center;
}
</style>
