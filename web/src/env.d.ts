/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare module 'opencascade.js/dist/opencascade.js' {
  // emscripten 工厂：new/调用后返回 ready Promise
  const factory: (module?: Record<string, unknown>) => Promise<unknown>
  export default factory
}
