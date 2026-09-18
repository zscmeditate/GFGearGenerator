<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Palette, X } from 'lucide-vue-next'
import {
  DEFAULT_THEME_PALETTE,
  applyThemePalette,
  readThemePalette,
  saveThemePalette,
} from '../composables/useThemePalette'

interface Preset { name: string; bg: string; accent: string; text: string }

const presets: Preset[] = [
  { name: 'Classic Light', bg: '#e0e5ec', accent: '#E89DB5', text: '#333333' },
  { name: 'Dark',         bg: '#292d32', accent: '#E89DB5', text: '#e0e5ec' },
  { name: 'Mint Green',   bg: '#dcedc8', accent: '#2e7d32', text: '#33691e' },
  { name: 'Morandi',      bg: '#e1bee7', accent: '#6a1b9a', text: '#4a148c' },
  { name: 'Dark Orange',  bg: '#303030', accent: '#ff9800', text: '#f5f5f5' },
]

const saved = readThemePalette()
const isOpen = ref(false)
const currentBg = ref(saved?.bg ?? DEFAULT_THEME_PALETTE.bg)
const neuScale = ref(saved?.scale ?? DEFAULT_THEME_PALETTE.scale)

const currentPalette = computed(() => {
  const p = presets.find(pr => pr.bg === currentBg.value)
  return {
    bg: p?.bg ?? DEFAULT_THEME_PALETTE.bg,
    accent: p?.accent ?? DEFAULT_THEME_PALETTE.accent,
    text: p?.text ?? DEFAULT_THEME_PALETTE.text,
    scale: neuScale.value,
    depthSm: DEFAULT_THEME_PALETTE.depthSm,
    depthMd: DEFAULT_THEME_PALETTE.depthMd,
    depthLg: DEFAULT_THEME_PALETTE.depthLg,
    radiusScale: DEFAULT_THEME_PALETTE.radiusScale,
    radiusSm: DEFAULT_THEME_PALETTE.radiusSm,
    radiusMd: DEFAULT_THEME_PALETTE.radiusMd,
    radiusLg: DEFAULT_THEME_PALETTE.radiusLg,
  }
})

watch(currentPalette, (p) => { applyThemePalette(p); saveThemePalette(p) }, { immediate: true, deep: true })

function select(p: Preset) {
  currentBg.value = p.bg
}
</script>

<template>
  <button class="tc-trigger" title="Theme" @click="isOpen = true">
    <Palette :size="20" />
  </button>

  <Teleport to="body">
    <Transition name="tc-fade">
      <div v-if="isOpen" class="tc-mask" @click="isOpen = false" />
    </Transition>

    <Transition name="tc-pop">
      <div v-if="isOpen" class="tc-dialog">
        <div class="tc-header">
          <span class="tc-title">Theme</span>
          <button class="tc-close" @click="isOpen = false"><X :size="16" /></button>
        </div>

        <div class="tc-body">
          <div class="tc-row">
            <span class="tc-label">Preset</span>
            <div class="tc-dots">
              <button
                v-for="p in presets" :key="p.name"
                class="tc-dot"
                :class="{ active: currentBg === p.bg }"
                :style="{ backgroundColor: p.bg, borderColor: p.accent }"
                :title="p.name"
                @click="select(p)"
              />
            </div>
          </div>

          <div class="tc-row">
            <span class="tc-label">Depth</span>
            <div class="tc-slider-wrap">
              <input v-model.number="neuScale" type="range" min="0.3" max="1.8" step="0.05" class="tc-range" />
              <span class="tc-val">{{ neuScale.toFixed(1) }}x</span>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.tc-trigger {
  position: fixed;
  right: 28px;
  bottom: 28px;
  z-index: 100;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: none;
  background: var(--bg-color);
  color: var(--text-color);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow:
    var(--neu-d2) var(--neu-d2) var(--neu-b2) var(--shadow-dark),
    var(--neu-d2-n) var(--neu-d2-n) var(--neu-b2) var(--shadow-light);
  transition: color 0.2s;
}

.tc-trigger:hover {
  color: var(--accent);
}

.tc-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.2);
  z-index: 200;
}

.tc-dialog {
  position: fixed;
  right: 28px;
  bottom: 88px;
  z-index: 201;
  width: 280px;
  background: var(--bg-color);
  border-radius: var(--neu-radius-md);
  box-shadow:
    var(--neu-d3) var(--neu-d3) var(--neu-b3) var(--shadow-dark),
    var(--neu-d3-n) var(--neu-d3-n) var(--neu-b3) var(--shadow-light);
  overflow: hidden;
}

.tc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--shadow-dark);
}

.tc-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color);
}

.tc-close {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: var(--bg-color);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow:
    var(--neu-d1) var(--neu-d1) var(--neu-b1) var(--shadow-dark),
    var(--neu-d1-n) var(--neu-d1-n) var(--neu-b1) var(--shadow-light);
  transition: color 0.2s;
}

.tc-close:hover {
  color: var(--accent);
}

.tc-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.tc-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.tc-label {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.5px;
  min-width: 40px;
  flex-shrink: 0;
}

.tc-dots {
  display: flex;
  gap: 8px;
}

.tc-dot {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
  transition: transform 0.2s ease, border-width 0.15s ease;
}

.tc-dot:hover {
  transform: scale(1.15);
}

.tc-dot.active {
  border-width: 3px;
  transform: scale(1.1);
}

.tc-slider-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.tc-range {
  -webkit-appearance: none;
  appearance: none;
  flex: 1;
  min-width: 0;
  height: 4px;
  border-radius: 999px;
  background: var(--bg-color);
  box-shadow: inset var(--neu-d1) var(--neu-d1) var(--neu-b1) var(--shadow-dark),
              inset var(--neu-d1-n) var(--neu-d1-n) var(--neu-b1) var(--shadow-light);
  outline: none;
  cursor: pointer;
}

.tc-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--bg-color);
  box-shadow: var(--neu-d1) var(--neu-d1) var(--neu-b1) var(--shadow-dark),
              var(--neu-d1-n) var(--neu-d1-n) var(--neu-b1) var(--shadow-light);
  cursor: grab;
  transition: box-shadow 0.15s ease;
}

.tc-range::-webkit-slider-thumb:active {
  cursor: grabbing;
  box-shadow: inset var(--neu-d1) var(--neu-d1) var(--neu-b1) var(--shadow-dark),
              inset var(--neu-d1-n) var(--neu-d1-n) var(--neu-b1) var(--shadow-light);
}

.tc-range::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 50%;
  background: var(--bg-color);
  box-shadow: var(--neu-d1) var(--neu-d1) var(--neu-b1) var(--shadow-dark),
              var(--neu-d1-n) var(--neu-d1-n) var(--neu-b1) var(--shadow-light);
  cursor: grab;
}

.tc-val {
  font-size: 11px;
  font-family: monospace;
  color: var(--accent);
  min-width: 28px;
  text-align: right;
  flex-shrink: 0;
}

/* transitions */
.tc-fade-enter-active, .tc-fade-leave-active { transition: opacity 0.2s ease; }
.tc-fade-enter-from, .tc-fade-leave-to { opacity: 0; }

.tc-pop-enter-active, .tc-pop-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.tc-pop-enter-from, .tc-pop-leave-to { opacity: 0; transform: translateY(8px); }
</style>
