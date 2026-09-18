<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  type?: 'horizontal' | 'vertical'
  variant?: 'groove' | 'ridge'
}

const props = withDefaults(defineProps<Props>(), {
  type: 'horizontal',
  variant: 'groove'
})

const computedClasses = computed(() => {
  const base = 'bg-[var(--bg-color)]'
  
  let layout = ''
  if (props.type === 'horizontal') {
    layout = 'w-full h-[2px] my-4'
  } else {
    layout = 'h-full w-[2px] mx-4 inline-block align-middle'
  }

  let shadow = ''
  if (props.variant === 'groove') {
    shadow = 'shadow-[inset_var(--neu-d1)_var(--neu-d1)_var(--neu-b1)_var(--shadow-dark),inset_var(--neu-d1-n)_var(--neu-d1-n)_var(--neu-b1)_var(--shadow-light)]'
  } else {
    shadow = 'shadow-[var(--neu-d1)_var(--neu-d1)_var(--neu-b1)_var(--shadow-dark),var(--neu-d1-n)_var(--neu-d1-n)_var(--neu-b1)_var(--shadow-light)]'
  }

  return [base, layout, shadow].join(' ')
})
</script>

<template>
  <div :class="computedClasses" role="separator" :aria-orientation="type"></div>
</template>
