import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  // opencascade.js 以 `import x from './xxx.wasm'` 形式取得资源 URL，
  // 需把 wasm 作为静态资源（而非 ESM Wasm 集成）处理。
  assetsInclude: ['**/*.wasm'],
  server: {
    port: 5180,
    host: '127.0.0.1'
  },
  optimizeDeps: {
    exclude: ['opencascade.js']
  },
  worker: {
    format: 'es'
  }
})
