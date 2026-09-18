<script setup lang="ts">
import { computed, h } from 'vue'
import { gearTypes } from '../gear/schema'
import { useGearStore } from '../stores/gear'
import NeuMenu, { type MenuItem } from './neu/NeuMenu.vue'

const store = useGearStore()

const groups = computed(() => {
  const labels: Record<number, string> = {
    0: '基本',
    1: '内齿',
    2: '变位'
  }
  return [0, 1, 2].map((g) => ({ label: labels[g], items: gearTypes.filter((t) => t.group === g) }))
})

/** NeuMenu 的 icon 接收组件，用函数式组件包装原有 PNG 图标 */
function gearIcon(icon: string) {
  return () =>
    h('img', {
      src: `/icons/${icon}.png`,
      alt: '',
      class: 'w-6 h-6 object-contain'
    })
}

/** 三组齿轮之间插入 Neumorphism 分隔符 */
const menuItems = computed<MenuItem[]>(() => {
  const items: MenuItem[] = []
  groups.value.forEach((grp, gi) => {
    if (gi > 0) items.push({ key: `divider-${gi}`, label: '', type: 'divider' })
    grp.items.forEach((t) => {
      items.push({ key: t.type, label: t.name, icon: gearIcon(t.icon) })
    })
  })
  return items
})

function onSelect(item: MenuItem) {
  const meta = gearTypes.find((t) => t.type === item.key)
  if (meta) store.selectType(meta.type)
}
</script>

<template>
  <NeuMenu
    :items="menuItems"
    :model-value="store.type"
    mode="horizontal"
    @select="onSelect"
  />
</template>
