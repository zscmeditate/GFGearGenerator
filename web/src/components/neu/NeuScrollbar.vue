<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'

interface Props {
  height?: string
  maxHeight?: string
  autoHide?: boolean
  fill?: boolean
  trackInset?: number
}

const props = withDefaults(defineProps<Props>(), {
  height: 'auto',
  maxHeight: undefined,
  autoHide: false,
  fill: false,
  trackInset: 8,
})

const containerRef = ref<HTMLDivElement | null>(null)
const trackRef = ref<HTMLDivElement | null>(null)
const thumbRef = ref<HTMLDivElement | null>(null)

const thumbHeight = ref(40)
const thumbTop = ref(0)
const isVisible = ref(!props.autoHide)
const isDragging = ref(false)
const isScrollbarNeeded = ref(false)

let dragStartY = 0
let dragStartScrollTop = 0
let hideTimer: ReturnType<typeof setTimeout> | null = null

const updateScrollbar = () => {
  const el = containerRef.value
  if (!el) return

  const { scrollHeight, clientHeight, scrollTop } = el
  isScrollbarNeeded.value = scrollHeight > clientHeight

  if (!isScrollbarNeeded.value) {
    thumbHeight.value = 0
    return
  }

  const trackHeight = clientHeight - 2 * props.trackInset
  const ratio = clientHeight / scrollHeight
  thumbHeight.value = Math.max(32, ratio * trackHeight)
  thumbTop.value =
    (scrollTop / (scrollHeight - clientHeight)) * (trackHeight - thumbHeight.value)
}

const onScroll = () => {
  updateScrollbar()

  if (props.autoHide) {
    isVisible.value = true
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      if (!isDragging.value) isVisible.value = false
    }, 1000)
  }
}

const onThumbMouseDown = (e: MouseEvent) => {
  e.preventDefault()
  isDragging.value = true
  dragStartY = e.clientY
  dragStartScrollTop = containerRef.value?.scrollTop ?? 0

  document.addEventListener('mousemove', onThumbMouseMove)
  document.addEventListener('mouseup', onThumbMouseUp)
}

const onThumbMouseMove = (e: MouseEvent) => {
  if (!isDragging.value || !containerRef.value) return
  const el = containerRef.value
  const { scrollHeight, clientHeight } = el
  const trackHeight = clientHeight - 2 * props.trackInset
  const delta = e.clientY - dragStartY
  const scrollRatio = delta / (trackHeight - thumbHeight.value)
  el.scrollTop = dragStartScrollTop + scrollRatio * (scrollHeight - clientHeight)
}

const onThumbMouseUp = () => {
  isDragging.value = false
  document.removeEventListener('mousemove', onThumbMouseMove)
  document.removeEventListener('mouseup', onThumbMouseUp)

  if (props.autoHide) {
    hideTimer = setTimeout(() => {
      isVisible.value = false
    }, 800)
  }
}

const onTrackClick = (e: MouseEvent) => {
  if (!containerRef.value || !trackRef.value) return
  if ((e.target as HTMLElement) === thumbRef.value) return

  const trackRect = trackRef.value.getBoundingClientRect()
  const clickY = e.clientY - trackRect.top
  const el = containerRef.value
  const { scrollHeight, clientHeight } = el
  const trackHeight = clientHeight - 2 * props.trackInset
  const targetRatio = (clickY - thumbHeight.value / 2) / (trackHeight - thumbHeight.value)
  el.scrollTop = Math.max(0, targetRatio) * (scrollHeight - clientHeight)
}

const resizeObserver = new ResizeObserver(() => {
  nextTick(updateScrollbar)
})

onMounted(() => {
  const el = containerRef.value
  if (el) {
    el.addEventListener('scroll', onScroll, { passive: true })
    resizeObserver.observe(el)
    updateScrollbar()
  }
  if (props.autoHide) isVisible.value = false
})

onUnmounted(() => {
  const el = containerRef.value
  if (el) {
    el.removeEventListener('scroll', onScroll)
    resizeObserver.disconnect()
  }
  document.removeEventListener('mousemove', onThumbMouseMove)
  document.removeEventListener('mouseup', onThumbMouseUp)
  if (hideTimer) clearTimeout(hideTimer)
})

watch(
  () => props.autoHide,
  (val) => {
    isVisible.value = !val
  }
)
</script>

<template>
  <div
    class="neu-scrollbar-wrapper"
    :class="{ 'neu-scrollbar-fill': fill }"
    :style="fill ? { maxHeight } : { height, maxHeight }"
  >
    <div
      ref="containerRef"
      class="neu-scrollbar-content"
      :class="isScrollbarNeeded ? 'has-scrollbar' : ''"
    >
      <slot />
    </div>

    <Transition name="neu-scrollbar-fade">
      <div
        v-if="isScrollbarNeeded && isVisible"
        ref="trackRef"
        class="neu-scrollbar-track"
        :style="{ top: `${trackInset}px`, bottom: `${trackInset}px` }"
        @click="onTrackClick"
      >
        <div
          ref="thumbRef"
          class="neu-scrollbar-thumb"
          :class="{ 'is-dragging': isDragging }"
          :style="{ height: `${thumbHeight}px`, top: `${thumbTop}px` }"
          @mousedown="onThumbMouseDown"
        />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.neu-scrollbar-wrapper {
  position: relative;
  display: flex;
}

.neu-scrollbar-fill {
  flex: 1;
  min-height: 0;
}

.neu-scrollbar-fill .neu-scrollbar-content {
  flex: 1;
  min-height: 0;
}

.neu-scrollbar-content {
  flex: 1;
  overflow-y: scroll;
  overflow-x: hidden;
  padding: 6px 6px 6px 6px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.neu-scrollbar-content::-webkit-scrollbar {
  display: none;
}

.neu-scrollbar-content.has-scrollbar {
  padding-right: 22px;
}

.neu-scrollbar-track {
  position: absolute;
  right: 4px;
  width: 8px;
  border-radius: 999px;
  background: var(--bg-color);
  box-shadow:
    inset var(--neu-d1) var(--neu-d1) var(--neu-b1) var(--shadow-dark),
    inset var(--neu-d1-n) var(--neu-d1-n) var(--neu-b1) var(--shadow-light);
  cursor: pointer;
  user-select: none;
}

.neu-scrollbar-thumb {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  width: 5px;
  border-radius: 999px;
  background: var(--shadow-dark);
  box-shadow:
    var(--neu-d1) var(--neu-d1) var(--neu-b1) var(--shadow-dark),
    var(--neu-d1-n) var(--neu-d1-n) var(--neu-b1) var(--shadow-light);
  cursor: grab;
  transition: background 0.2s ease, width 0.2s ease, box-shadow 0.2s ease;
}

.neu-scrollbar-thumb:hover {
  width: 7px;
  background: var(--accent);
  box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 40%, transparent);
}

.neu-scrollbar-thumb.is-dragging {
  cursor: grabbing;
  width: 7px;
  background: var(--accent);
  box-shadow: 0 0 12px color-mix(in srgb, var(--accent) 50%, transparent);
}

.neu-scrollbar-fade-enter-active,
.neu-scrollbar-fade-leave-active {
  transition: opacity 0.25s ease;
}

.neu-scrollbar-fade-enter-from,
.neu-scrollbar-fade-leave-to {
  opacity: 0;
}
</style>
