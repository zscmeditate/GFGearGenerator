<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useGearStore } from './stores/gear'
import GearSidebar from './components/GearSidebar.vue'
import GearViewer from './components/GearViewer.vue'
import ParamPanel from './components/ParamPanel.vue'
import { exportMesh, downloadBlob, type ExportFormat } from './cad/exporters'

const store = useGearStore()
const viewerRef = ref<InstanceType<typeof GearViewer> | null>(null)
const exportStage = ref('')
const exportPct = ref(0)

onMounted(() => {
  store.seedExtraDefaults()
  void store.buildNow()
})

function setStandard(s: 'metric' | 'english') {
  store.setParam('standard', s)
}

async function doExport(fmt: ExportFormat) {
  if (!store.mesh || store.exporting) return
  store.exporting = true
  exportPct.value = 1
  exportStage.value = '准备数据…'
  try {
    const blob = await exportMesh(store.mesh, fmt, (stage, pct) => {
      exportStage.value = stage
      exportPct.value = pct
    })
    const suffix = fmt === 'step' ? 'step' : 'stl'
    downloadBlob(blob, `GF-${store.meta.type}-z${store.params.z}.${suffix}`)
    store.showToast(`${suffix.toUpperCase()} 导出完成（${(blob.size / 1024).toFixed(0)} KB）`)
  } catch (e) {
    store.showToast(`导出失败：${(e as Error).message}`, 'error', 8000)
  } finally {
    store.exporting = false
  }
}
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <GearSidebar />
    </header>

    <aside class="sidebar-left">
      <ParamPanel />
    </aside>

    <main class="viewer-area">
      <GearViewer ref="viewerRef" />

      <div v-if="store.meta.approx" class="approx-note">
        ⚠ 该类型为几何近似实现（Approximate）
      </div>

      <div class="overlay-tip">
        <span>左键 旋转</span>
        <span>右键 平移</span>
        <span>滚轮 缩放</span>
      </div>

      <div v-if="store.toast" class="toast" :class="store.toast.kind">{{ store.toast.text }}</div>

      <div v-if="store.building" class="busy-mask">
        <div class="spinner"></div>
        <div style="color:var(--text-1)">生成齿轮几何…</div>
      </div>

      <div v-if="store.exporting" class="busy-mask">
        <div class="spinner"></div>
        <div style="color:var(--text-1)">{{ exportStage }}</div>
        <div class="progress-track">
          <div class="progress-bar" :style="{ width: exportPct + '%' }"></div>
        </div>
      </div>
    </main>

    <aside class="sidebar-right">
      <div class="control-panel">
        <h3>视口控制</h3>

        <div class="ctrl-section">
          <span class="ctrl-label">单位标准</span>
          <div class="choice-seg standard-toggle">
            <button :class="{ active: store.params.standard === 'metric' }" @click="setStandard('metric')">公制</button>
            <button :class="{ active: store.params.standard === 'english' }" @click="setStandard('english')">英制</button>
          </div>
        </div>

        <div class="ctrl-section">
          <span class="ctrl-label">精度</span>
          <div class="choice-seg">
            <button :class="{ active: store.quality === 'preview' }" @click="store.setQuality('preview')">预览</button>
            <button :class="{ active: store.quality === 'high' }" @click="store.setQuality('high')">导出</button>
          </div>
        </div>

        <div class="ctrl-section">
          <span class="ctrl-label">统计</span>
          <div class="stat-chip"><b>{{ store.triangleCount.toLocaleString() }}</b> 面 / {{ store.vertexCount.toLocaleString() }} 点</div>
        </div>

        <div class="ctrl-section">
          <span class="ctrl-label">视图</span>
          <button class="btn" :class="{ active: store.autoRotate }" @click="store.autoRotate = !store.autoRotate">⟳ 自动旋转</button>
          <button class="btn" :class="{ active: store.wireframe }" @click="store.wireframe = !store.wireframe">▱ 线框模式</button>
          <button class="btn" @click="viewerRef?.reset()">⌂ 重置取景</button>
        </div>

        <div class="ctrl-section">
          <span class="ctrl-label">导出</span>
          <button class="btn primary" :disabled="store.exporting || !store.mesh" @click="doExport('step')">⬇ STEP</button>
          <button class="btn" :disabled="store.exporting || !store.mesh" @click="doExport('stl')">⬇ STL</button>
        </div>
      </div>
    </aside>
  </div>
</template>
