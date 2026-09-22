import { ref } from 'vue'

/**
 * 按压缩放反馈：mousedown 立即缩小，mouseup/mouseleave 立即回弹。
 * 不依赖 CSS :active（某些浏览器按钮获焦后 :active 不释放，导致卡在缩小态）。
 */
export function usePressScale(scale = 0.93) {
  const pressed = ref(false)
  const style = { '--press-scale': scale }

  function onMouseDown() {
    pressed.value = true
  }
  function onMouseUp() {
    pressed.value = false
  }

  return { pressed, style, onMouseDown, onMouseUp }
}
