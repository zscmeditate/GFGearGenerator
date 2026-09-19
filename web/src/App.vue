<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import {
  MagicStick,
  Download,
  Aim,
  Bottom,
  Refresh,
  Grid,
  Setting,
  ScaleToOriginal,
  Histogram,
  View,
  DataLine,
} from '@element-plus/icons-vue'
import type { CameraMode } from './components/GearViewer.vue'
import { useGearStore } from './stores/gear'
import { gearTypes, type GearType, type Standard } from './gear/schema'
import type { Quality } from './gear/geometry'
import GearViewer from './components/GearViewer.vue'
import ParamPanel from './components/ParamPanel.vue'
import AiChat from './components/AiChat.vue'
import { exportMesh, downloadBlob, type ExportFormat } from './cad/exporters'
import { themePresets, applyPrimary, useThemeColor } from './composables/useThemeColor'
import { version as appVersion } from '../package.json'

const store = useGearStore()
const { currentColor } = useThemeColor()
const viewerRef = ref<InstanceType<typeof GearViewer> | null>(null)
const exportStage = ref('')
const exportPct = ref(0)
/** 导出进度百分比固定保留两位小数 */
const formatExportPct = (pct: number) => `${pct.toFixed(2)}%`

/** 相机投影模式持久化（透视 / 正交） */
const CAMERA_STORAGE_KEY = 'gf-camera-mode'
function loadCameraMode(): CameraMode {
  try {
    const v = localStorage.getItem(CAMERA_STORAGE_KEY)
    return v === 'orthographic' || v === 'perspective' ? v : 'perspective'
  } catch {
    return 'perspective'
  }
}
const cameraMode = ref<CameraMode>(loadCameraMode())
const aiOpen = ref(false)
const headerTypesRef = ref<HTMLElement | null>(null)
let typeScrollRO: ResizeObserver | null = null

/** 窄屏内容溢出时，把齿轮分段控件的滚动位置定位到中间，保持视觉居中 */
function centerTypeScroll() {
  const el = headerTypesRef.value
  if (!el) return
  const v = el.scrollWidth > el.clientWidth ? (el.scrollWidth - el.clientWidth) / 2 : 0
  el.scrollLeft = v
}

/**
 * 窄屏溢出时的"提前平移"：视口左右各保留约 2 个按钮宽的缓冲带，
 * 选中项一旦进入缓冲带（即使仍完整可见），就平滑滚动把它送到缓冲带内缘，
 * 使更外侧被遮挡的类型在被点到之前就先露出来，避免只能点击露出的一小条；
 * 选中项在中间安全区时不滚动，保持视觉稳定。
 */
const EDGE_ZONE_ITEMS = 2

function scrollActiveTypeIntoView() {
  const el = headerTypesRef.value
  if (!el || el.scrollWidth <= el.clientWidth) return
  const buttons = Array.from(el.querySelectorAll<HTMLElement>('.el-radio-button'))
  const active = el.querySelector<HTMLElement>('.el-radio-button.is-active')
  if (!active || buttons.length === 0) return
  // 缓冲带宽度按实际按钮平均宽度计算，适配不同字号/窗口
  const avgWidth =
    buttons.reduce((sum, b) => sum + b.offsetWidth, 0) / buttons.length
  const zone = avgWidth * EDGE_ZONE_ITEMS
  const boxLeft = el.getBoundingClientRect().left
  const relLeft = active.getBoundingClientRect().left - boxLeft
  const relRight = relLeft + active.offsetWidth
  let target: number | null = null
  if (relLeft < zone) {
    // 靠近/越过左边缘：scrollLeft 减小，整组右移，选中项停在缓冲带内缘
    target = el.scrollLeft - (zone - relLeft)
  } else if (relRight > el.clientWidth - zone) {
    // 靠近/越过右边缘：scrollLeft 增大，整组左移，选中项停在缓冲带内缘
    target = el.scrollLeft + (relRight - (el.clientWidth - zone))
  }
  if (target === null) return
  target = Math.max(0, Math.min(target, el.scrollWidth - el.clientWidth))
  if (Math.abs(target - el.scrollLeft) < 1) return
  el.scrollTo({ left: target, behavior: 'smooth' })
}

// 齿轮类型变化（点击分段项 / AI 生成）后，若新选中项进入边缘缓冲带则提前平滑平移；
// flush: 'post' 保证在 is-active 选中态更新到 DOM 后再测量位置
watch(
  () => store.type,
  () => scrollActiveTypeIntoView(),
  { flush: 'post' }
)

/** 齿轮类型图标：resources/public/icons 下与 schema.icon 同名的 PNG */
function iconUrl(icon: string): string {
  return `/icons/${icon}.png`
}

function onTypeChange(t: GearType) {
  store.selectType(t)
}

function onStandardChange(v: Standard) {
  store.setParam('standard', v)
}

function onQualityChange(q: Quality) {
  store.setQuality(q)
}

function switchCamera(mode: CameraMode) {
  cameraMode.value = mode
  viewerRef.value?.switchCameraMode(mode)
  try {
    localStorage.setItem(CAMERA_STORAGE_KEY, mode)
  } catch {
    /* 隐私模式等场景忽略持久化失败 */
  }
}

function pickTheme(color: string) {
  applyPrimary(color)
}

onMounted(() => {
  store.init()
  void store.buildNow()
  // GearViewer 默认创建透视相机，若上次退出时为正交则恢复（子组件已先完成场景初始化）
  if (cameraMode.value === 'orthographic') {
    viewerRef.value?.switchCameraMode('orthographic')
  }
  // 等按钮文字字体完成布局后定位滚动；容器尺寸变化（窗口缩放）时重新居中。
  // 只观察容器本身：选中项字重 500→600 会让内组宽度发生亚像素变化，
  // 若连内组一起观察，每次切换类型都会触发强制居中，与"选中项滚入视野"互相打架；
  // 初始字体晚加载改用 document.fonts.ready 兜底
  requestAnimationFrame(centerTypeScroll)
  if ('fonts' in document) {
    void document.fonts.ready.then(centerTypeScroll)
  }
  typeScrollRO = new ResizeObserver(centerTypeScroll)
  if (headerTypesRef.value) {
    typeScrollRO.observe(headerTypesRef.value)
  }
})

onBeforeUnmount(() => {
  typeScrollRO?.disconnect()
})

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
    ElMessage.success('导出成功')
  } catch (e) {
    ElMessage.error(`导出失败：${(e as Error).message}`)
  } finally {
    store.exporting = false
  }
}
</script>

<template>
  <el-container class="app-shell" direction="vertical">
    <!-- 顶部：左上角 LOGO 区 + 11 个齿轮类型的大 radio-button 组 + AI 入口（直接悬浮于背景之上，无外层面板） -->
    <el-header class="app-header">
      <!-- LOGO 区：图标徽章 + 中英文品牌名，宽度与左侧齿轮参数栏一致（300px） -->
      <div class="app-brand">
        <span class="brand-badge" aria-hidden="true">
          <svg class="brand-badge-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path fill-rule="evenodd" d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/>
          </svg>
        </span>
        <span class="brand-text">
          <span class="brand-name-cn">齿轮生成器</span>
          <span class="brand-name-en">GF Gear Generator</span>
        </span>
      </div>
      <div ref="headerTypesRef" class="header-types">
        <el-radio-group
          :model-value="store.type"
          size="large"
          class="gear-type-group"
          @change="(v: GearType) => onTypeChange(v)"
        >
          <el-radio-button
            v-for="t in gearTypes"
            :key="t.type"
            :value="t.type"
            :title="t.en"
          >
            <span class="type-ico">
              <img class="type-ico-img" :src="iconUrl(t.icon)" alt="" draggable="false" />
              <span
                class="type-ico-mask"
                :style="{ '--ico-url': `url(${iconUrl(t.icon)})` }"
              />
            </span>
            {{ t.name }}
          </el-radio-button>
        </el-radio-group>
      </div>
      <div class="header-actions">
        <el-button
          type="primary"
          class="ai-capsule-btn"
          :icon="MagicStick"
          @click="aiOpen = true"
        >
          AI 齿轮生成
        </el-button>
      </div>
    </el-header>

    <el-container class="app-body">
      <!-- 左侧：带 header 的参数面板 -->
      <el-aside width="300px" class="aside-left">
        <ParamPanel />
      </el-aside>

      <!-- 中央：Scene 面板 -->
      <el-main class="scene-main">
        <el-card class="scene-card" shadow="never">
          <template #header>
            <!-- 切换齿轮类型时整个标题胶囊（白底 + 标题 + 几何近似标签）一起渐出→替换→渐入；
                 key 随齿轮类型变化，mode=out-in 保证旧胶囊完全淡出后再换新 -->
            <Transition name="scene-header-fade" mode="out-in">
              <div class="scene-header-pill" :key="store.meta.type">
                <span class="scene-title">{{ store.meta.name }} · {{ store.meta.en }}</span>
                <!-- disable-transitions 关闭 el-tag 自带的缩放进入动画，显隐随胶囊整体淡入淡出 -->
                <el-tag
                  v-if="store.meta.approx"
                  disable-transitions
                  type="warning"
                  size="small"
                  effect="plain"
                >
                  几何近似 Approximate
                </el-tag>
              </div>
            </Transition>
          </template>

          <div
            class="scene-wrap"
            v-loading="store.showBusy"
            element-loading-text="生成齿轮几何…"
            element-loading-background="rgba(232, 237, 243, 0.6)"
          >
            <GearViewer ref="viewerRef" />

            <!-- 右上角浮动：俯视图（圆形向下箭头） -->
            <el-button
              class="top-view-fab"
              circle
              :icon="Bottom"
              title="俯视图"
              @click="viewerRef?.topView()"
            />

            <div class="scene-tips">
              <span>左键 旋转</span>
              <span>滚轮 缩放</span>
              <span>右键 平移</span>
            </div>

            <div v-if="store.exporting" class="export-mask">
              <el-card class="export-card" shadow="always">
                <el-progress :percentage="exportPct" :stroke-width="10" :format="formatExportPct" />
                <div class="export-stage">{{ exportStage }}</div>
              </el-card>
            </div>
          </div>
        </el-card>
      </el-main>

      <!-- 右侧：多个常用工具面板，从上往下排列 -->
      <el-aside width="252px" class="aside-right">
        <div class="stack-panels">
          <el-card shadow="never">
            <template #header>
              <span class="panel-title"><el-icon><ScaleToOriginal /></el-icon>单位</span>
            </template>
            <el-radio-group
              :model-value="store.params.standard"
              class="full-width-group"
              @change="(v: Standard) => onStandardChange(v)"
            >
              <el-radio-button value="metric">公制 mm</el-radio-button>
              <el-radio-button value="english">英制 in</el-radio-button>
            </el-radio-group>
          </el-card>

          <el-card shadow="never">
            <template #header>
              <span class="panel-title"><el-icon><Histogram /></el-icon>渲染</span>
            </template>
            <el-radio-group
              :model-value="store.quality"
              class="full-width-group"
              @change="(v: Quality) => onQualityChange(v)"
            >
              <el-radio-button value="preview">低精度</el-radio-button>
              <el-radio-button value="high">高精度</el-radio-button>
            </el-radio-group>

            <div class="switch-line">
              <span><el-icon><Grid /></el-icon> 线框模式</span>
              <el-switch
                :model-value="store.wireframe"
                @change="(v: boolean) => (store.wireframe = v)"
              />
            </div>
          </el-card>

          <el-card shadow="never">
            <template #header>
              <span class="panel-title"><el-icon><View /></el-icon>视角</span>
            </template>
            <el-radio-group
              :model-value="cameraMode"
              class="full-width-group"
              @change="(v: CameraMode) => switchCamera(v)"
            >
              <el-radio-button value="perspective">透视</el-radio-button>
              <el-radio-button value="orthographic">正交</el-radio-button>
            </el-radio-group>

            <div class="switch-line">
              <span><el-icon><Refresh /></el-icon> 自动旋转</span>
              <el-switch
                :model-value="store.autoRotate"
                @change="(v: boolean) => (store.autoRotate = v)"
              />
            </div>
            <el-button class="block-btn" :icon="Aim" @click="viewerRef?.reset()">
              重置取景
            </el-button>
          </el-card>

          <el-card shadow="never">
            <template #header>
              <span class="panel-title"><el-icon><DataLine /></el-icon>统计</span>
            </template>
            <el-descriptions :column="1" size="small" border>
              <el-descriptions-item label="面片数">
                {{ store.triangleCount.toLocaleString() }}
              </el-descriptions-item>
              <el-descriptions-item label="顶点数">
                {{ store.vertexCount.toLocaleString() }}
              </el-descriptions-item>
            </el-descriptions>
          </el-card>

          <el-card shadow="never">
            <template #header>
              <span class="panel-title"><el-icon><Download /></el-icon>导出</span>
            </template>
            <div class="export-btn-row">
              <el-button
                type="primary"
                size="small"
                class="block-btn"
                :icon="Download"
                :disabled="store.exporting || !store.mesh"
                @click="doExport('step')"
              >
                导出 STEP
              </el-button>
              <el-button
                size="small"
                class="block-btn"
                :icon="Download"
                :disabled="store.exporting || !store.mesh"
                @click="doExport('stl')"
              >
                导出 STL
              </el-button>
            </div>
          </el-card>
        </div>
      </el-aside>
    </el-container>

    <!-- 右下角浮动：仅切换主题色 -->
    <el-popover :width="220" :offset="14" placement="top-end" trigger="click">
      <template #reference>
        <el-button class="theme-fab" circle title="切换主题色">
          <el-icon><Setting /></el-icon>
        </el-button>
      </template>
      <div class="theme-popover-title">主题色</div>
      <div class="theme-swatches">
        <button
          v-for="p in themePresets"
          :key="p.value"
          type="button"
          class="theme-swatch"
          :class="{ 'is-active': p.value.toLowerCase() === currentColor.toLowerCase() }"
          :style="{ backgroundColor: p.value }"
          :title="p.name"
          @click="pickTheme(p.value)"
        />
      </div>
    </el-popover>

    <AiChat v-model="aiOpen" />

    <!-- 左下角版本号：扁平化风格，一行字高 -->
    <div class="app-version">v{{ appVersion }}</div>
  </el-container>
</template>

<style scoped>
.scene-title {
  font-size: 15px;
  font-weight: 600;
  color: #344054;
}

/* 场景标题胶囊：切换齿轮类型时整个胶囊（白底+标题+标签）纯透明度渐入渐出，无缩放/位移 */
.scene-header-fade-enter-active,
.scene-header-fade-leave-active {
  transition: opacity 0.22s ease;
}

.scene-header-fade-enter-from,
.scene-header-fade-leave-to {
  opacity: 0;
}

/* ---------- Header 齿轮类型组：一个连续的分段控件（el-radio-button 原生结构美化） ---------- */
/* 整组：浅灰蓝底圆角轨道，内部各项以 1px 间隔条分隔（露出 #f1f4f8 轨道底色）；
   padding 归零以去掉组四周的轨道带，外加 1px 灰白边，首尾项圆角对齐边框内缘 */
.gear-type-group {
  display: inline-flex;
  gap: 1px;
  padding: 0;
  background: #f1f4f8;
  border: 1px solid #dcdfe6;
  border-radius: 12px;
}

.gear-type-group :deep(.el-radio-button__inner) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 42px;
  padding: 0 15px;
  border: none;
  border-radius: 0;
  background: transparent;
  /* 高亮伪元素的定位基准 + 层叠上下文：伪元素 z=-1 垫在文字/图标下方 */
  position: relative;
  z-index: 0;
  /* 去掉 Element radio-button 自带的描边与相邻分隔线，整体性由组轨道承担 */
  box-shadow: none;
  color: #5b6472;
  font-size: 13px;
  font-weight: 500;
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease;
}

/* 仅整组的首尾项跟随组外圈圆角（边框内缘 11px = 12 − 1），中间项保持直角连续 */
.gear-type-group :deep(.el-radio-button:first-child .el-radio-button__inner) {
  border-radius: 11px 0 0 11px;
}

.gear-type-group :deep(.el-radio-button:last-child .el-radio-button__inner) {
  border-radius: 0 11px 11px 0;
}

.gear-type-group :deep(.el-radio-button:only-child .el-radio-button__inner) {
  border-radius: 11px;
}

.gear-type-group :deep(.el-radio-button__inner:hover) {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

/* 选中项：组内的高亮滑块（浅粉渐变 + 底部 2px 指示线），不产生独立按钮感。
   渐变与指示线画在伪元素上、用 opacity 过渡：background-image 无法过渡，
   写在 inner 上失选会瞬间消失，叠加 Element :checked 的纯主题色
   background-color 渐隐，旧项会先闪一下粉色再变灰 */
.gear-type-group :deep(.el-radio-button.is-active .el-radio-button__inner) {
  color: var(--el-color-primary-dark-2);
  /* 显式压平 Element :checked 规则的纯主题色背景与接缝阴影，失选时无物可渐隐 */
  background-color: transparent;
  font-weight: 600;
  box-shadow: none;
}

/* 选中高亮层：随选中态以 opacity 平滑淡入淡出 */
.gear-type-group :deep(.el-radio-button__inner)::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  background-image: linear-gradient(
    180deg,
    var(--el-color-primary-light-8),
    var(--el-color-primary-light-7)
  );
  box-shadow: inset 0 -2px 0 0 var(--el-color-primary);
  opacity: 0;
  transition: opacity 0.18s ease;
}

.gear-type-group :deep(.el-radio-button.is-active .el-radio-button__inner)::before {
  opacity: 1;
}

/* 齿轮类型图标（resources PNG）：默认深灰原图，选中态用同图 mask 染成当前主题色 */
.gear-type-group :deep(.type-ico) {
  position: relative;
  width: 17px;
  height: 17px;
  flex-shrink: 0;
  display: inline-block;
}

.gear-type-group :deep(.type-ico-img) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  opacity: 0.72;
  transition: opacity 0.18s ease;
  user-select: none;
  -webkit-user-drag: none;
}

.gear-type-group :deep(.type-ico-mask) {
  position: absolute;
  inset: 0;
  background-color: currentColor;
  -webkit-mask-image: var(--ico-url);
  mask-image: var(--ico-url);
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  opacity: 0;
  transition: opacity 0.18s ease;
}

.gear-type-group :deep(.el-radio-button__inner:hover .type-ico-img) {
  opacity: 0.95;
}

.gear-type-group :deep(.el-radio-button.is-active .type-ico-img) {
  opacity: 0;
}

.gear-type-group :deep(.el-radio-button.is-active .type-ico-mask) {
  opacity: 1;
}

/* ---------- 分段按钮组占满面板宽度 ---------- */
.full-width-group {
  width: 100%;
  display: flex;
}

.full-width-group :deep(.el-radio-button) {
  flex: 1;
}

.full-width-group :deep(.el-radio-button__inner) {
  width: 100%;
}

.switch-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px;
  font-size: 13px;
  color: #606266;
}

.switch-line .el-icon {
  vertical-align: -2px;
  margin-right: 4px;
}

.block-btn {
  width: 100%;
  margin-left: 0;
}

/* 导出按钮行：STEP 居左、STL 居右，等宽分布 */
.export-btn-row {
  display: flex;
  gap: 8px;
}

.export-btn-row .block-btn {
  flex: 1;
  margin-top: 0;
}

/* ---------- 视口右上角浮动：俯视图圆形按钮 ---------- */
.top-view-fab {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 6;
  width: 34px;
  height: 34px;
  min-height: 34px;
  padding: 0;
  color: #5b6472;
  background: #fff;
  border: none;
  border-radius: 50%;
  box-shadow: 0 3px 12px rgba(110, 125, 150, 0.25);
  transition:
    color 0.18s ease,
    transform 0.18s ease,
    box-shadow 0.18s ease;
}

.top-view-fab:hover,
.top-view-fab:focus {
  color: var(--el-color-primary);
  background: #fff;
  border-color: transparent;
  transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(110, 125, 150, 0.32);
}

.top-view-fab:active {
  color: var(--el-color-primary-dark-2);
  background: #fff;
  border-color: transparent;
  transform: translateY(0);
  box-shadow: 0 3px 10px rgba(110, 125, 150, 0.25);
}

.top-view-fab :deep(.el-icon) {
  font-size: 16px;
}

/* ---------- 左下角版本号：扁平化风格（纯色底 + 细边框，无凹陷阴影） ---------- */
.app-version {
  position: fixed;
  left: 14px;
  bottom: 14px;
  z-index: 100;
  width: 278px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(150, 160, 175, 0.28);
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1.2px;
  color: #8a93a3;
  white-space: nowrap;
  user-select: none;
  pointer-events: none;
}
</style>
