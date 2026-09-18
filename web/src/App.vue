<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { RotateCw, Box, Focus, Download, ArrowDownToLine, Sparkles } from 'lucide-vue-next'
import type { CameraMode } from './components/GearViewer.vue'
import { useGearStore } from './stores/gear'
import GearSidebar from './components/GearSidebar.vue'
import GearViewer from './components/GearViewer.vue'
import ParamPanel from './components/ParamPanel.vue'
import AiDialog from './components/AiDialog.vue'
import NeuCard from './components/neu/NeuCard.vue'
import NeuButton from './components/neu/NeuButton.vue'
import ThemeConfigurator from './components/ThemeConfigurator.vue'
import { loadAndApplyThemePalette } from './composables/useThemePalette'
import { exportMesh, downloadBlob, type ExportFormat } from './cad/exporters'
import { NeuToast } from './components/neu/toast'

const store = useGearStore()
const viewerRef = ref<InstanceType<typeof GearViewer> | null>(null)
const exportStage = ref('')
const exportPct = ref(0)
const cameraMode = ref<CameraMode>('perspective')
const aiOpen = ref(false)

function switchCamera(mode: CameraMode) {
  cameraMode.value = mode
  viewerRef.value?.switchCameraMode(mode)
}

onMounted(() => {
  loadAndApplyThemePalette()
  store.init()
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
    NeuToast.success('操作成功！')
  } catch (e) {
    NeuToast.error(`导出失败：${(e as Error).message}`)
  } finally {
    store.exporting = false
  }
}
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="topmenu-scroll">
        <GearSidebar />
      </div>
      <div class="ai-btn-wrap">
        <NeuButton variant="icon" title="AI 齿轮生成" @click="aiOpen = true">
          <Sparkles class="w-6 h-6" />
        </NeuButton>
      </div>
    </header>

    <aside class="sidebar-left">
      <ParamPanel />
    </aside>

    <main class="viewer-area">
      <GearViewer ref="viewerRef" />

      <button class="topview-btn" title="俯视图" @click="viewerRef?.topView()">
        <ArrowDownToLine :size="18" />
      </button>

      <div v-if="store.meta.approx" class="approx-note">
        ⚠ 该类型为几何近似实现（Approximate）
      </div>

      <div class="overlay-tip">
        <span>左键 旋转</span>
        <span>滚轮 缩放</span>
        <span>右键 平移</span>
      </div>

      <div v-if="store.showBusy" class="busy-dialog">
        <div class="spinner"></div>
        <div class="busy-text">生成齿轮几何…</div>
      </div>

      <div v-if="store.exporting" class="busy-dialog">
        <div class="spinner"></div>
        <div class="busy-text">{{ exportStage }}</div>
        <div class="progress-track">
          <div class="progress-bar" :style="{ width: exportPct + '%' }"></div>
        </div>
      </div>
    </main>

    <aside class="sidebar-right">
      <div class="control-panel">
        <h3 class="panel-title">视口控制</h3>

        <div class="ctrl-section">
          <span class="ctrl-label">单位标准</span>
          <div class="btn-row">
            <NeuButton size="sm" :active="store.params.standard === 'metric'" @click="setStandard('metric')">公制</NeuButton>
            <NeuButton size="sm" :active="store.params.standard === 'english'" @click="setStandard('english')">英制</NeuButton>
          </div>
        </div>

        <div class="ctrl-section">
          <span class="ctrl-label">精度</span>
          <div class="btn-row">
            <NeuButton size="sm" :active="store.quality === 'preview'" @click="store.setQuality('preview')">预览</NeuButton>
            <NeuButton size="sm" :active="store.quality === 'high'" @click="store.setQuality('high')">导出</NeuButton>
          </div>
        </div>

        <div class="ctrl-section">
          <span class="ctrl-label">统计</span>
          <NeuCard class="stat-chip" rounded="sm" padding="none" pressed>
            <b>{{ store.triangleCount.toLocaleString() }}</b> 面 / {{ store.vertexCount.toLocaleString() }} 点
          </NeuCard>
        </div>

        <div class="ctrl-section">
          <span class="ctrl-label">视图</span>
          <div class="btn-row">
            <NeuButton size="sm" :active="cameraMode === 'perspective'" @click="switchCamera('perspective')">透视</NeuButton>
            <NeuButton size="sm" :active="cameraMode === 'orthographic'" @click="switchCamera('orthographic')">正交</NeuButton>
          </div>
          <NeuButton size="sm" :active="store.autoRotate" @click="store.autoRotate = !store.autoRotate">
            <RotateCw :size="15" /> 自动旋转
          </NeuButton>
          <NeuButton size="sm" :active="store.wireframe" @click="store.wireframe = !store.wireframe">
            <Box :size="15" /> 线框模式
          </NeuButton>
          <NeuButton size="sm" @click="viewerRef?.reset()">
            <Focus :size="15" /> 重置取景
          </NeuButton>
        </div>

        <div class="ctrl-section">
          <span class="ctrl-label">导出</span>
          <div class="btn-row">
            <NeuButton size="sm" variant="primary" :disabled="store.exporting || !store.mesh" @click="doExport('step')">
              <Download :size="15" /> STEP
            </NeuButton>
            <NeuButton size="sm" :disabled="store.exporting || !store.mesh" @click="doExport('stl')">
              <Download :size="15" /> STL
            </NeuButton>
          </div>
        </div>
      </div>
    </aside>
  </div>

  <ThemeConfigurator />
  <AiDialog v-model="aiOpen" />
</template>
