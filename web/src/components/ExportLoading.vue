<script setup lang="ts">
defineProps<{
  visible: boolean
  percentage?: number
  stage?: string
}>()

const formatPct = (pct: number) => `${pct.toFixed(2)}%`
</script>

<template>
  <Teleport to="body">
    <Transition name="export-loading-fade">
      <div v-if="visible" class="export-mask">
        <el-card class="export-card" shadow="always">
          <el-progress
            v-if="percentage !== undefined"
            :percentage="percentage"
            :stroke-width="10"
            :format="formatPct"
          />
          <div v-if="stage" class="export-stage">{{ stage }}</div>
        </el-card>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.export-mask {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(232, 237, 243, 0.55);
}

.export-card.el-card {
  width: 300px;
  text-align: center;
  background-color: #e0e6ed;
  border: none;
  border-radius: 14px;
  box-shadow: inset 3px 3px 6px rgba(163, 177, 198, 0.55),
              inset -3px -3px 6px rgba(255, 255, 255, 0.85);
}

.export-stage {
  margin-top: 10px;
  font-size: 13px;
  color: #606266;
}

/* 过渡动画 */
.export-loading-fade-enter-active {
  transition: opacity 0.2s var(--ease-out);
}
.export-loading-fade-leave-active {
  transition: opacity 0.15s var(--ease-out);
}
.export-loading-fade-enter-from,
.export-loading-fade-leave-to {
  opacity: 0;
}

.export-loading-fade-enter-active .export-card {
  animation: scaleIn 0.25s var(--ease-out);
}

@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
</style>
