import { watch, onMounted, onUnmounted } from 'vue'

interface UseOverlayOptions {
  isOpen: () => boolean
  closeOnEsc: () => boolean
  closeOnClickOutside: () => boolean
  overlayClass: string
  onClose: () => void
  onOpen?: () => void
}

export function useOverlay(options: UseOverlayOptions) {
  let scrollbarWidth = 0

  const lockScroll = () => {
    scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`
    }
    document.body.style.overflow = 'hidden'
  }

  const unlockScroll = () => {
    document.body.style.overflow = ''
    document.body.style.paddingRight = ''
  }

  const handleEscKey = (e: KeyboardEvent) => {
    if (options.closeOnEsc() && e.key === 'Escape' && options.isOpen()) {
      options.onClose()
    }
  }

  const handleOutsideClick = (e: MouseEvent) => {
    if (options.closeOnClickOutside() && (e.target as HTMLElement).classList.contains(options.overlayClass)) {
      options.onClose()
    }
  }

  watch(options.isOpen, (newVal) => {
    if (newVal) {
      options.onOpen?.()
      lockScroll()
    } else {
      unlockScroll()
    }
  })

  onMounted(() => {
    window.addEventListener('keydown', handleEscKey)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleEscKey)
    unlockScroll()
  })

  return {
    handleOutsideClick,
    lockScroll,
    unlockScroll,
  }
}
