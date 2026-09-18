<script setup lang="ts">
import { computed } from 'vue'
import { gearTypes, type GearTypeMeta } from '../gear/schema'
import { useGearStore } from '../stores/gear'

const store = useGearStore()

const groups = computed(() => {
  const labels: Record<number, string> = {
    0: '基本',
    1: '内齿',
    2: '变位'
  }
  return [0, 1, 2].map((g) => ({ label: labels[g], items: gearTypes.filter((t) => t.group === g) }))
})

function pick(t: GearTypeMeta) {
  store.selectType(t.type)
}
</script>

<template>
  <div class="gear-selector-bar">
    <div v-for="grp in groups" :key="grp.label" class="gear-group">
      <span class="group-tag">{{ grp.label }}</span>
      <div class="gear-cards">
        <button
          v-for="t in grp.items"
          :key="t.type"
          class="gear-card"
          :class="{ active: store.type === t.type }"
          :title="t.en"
          @click="pick(t)"
        >
          <span v-if="t.approx" class="approx-badge">近似</span>
          <img :src="`/icons/${t.icon}.png`" :alt="t.en" />
          <span class="g-name">{{ t.name }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
