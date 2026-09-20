<script setup lang="ts">
/**
 * 会话消息内的齿轮组预览画布：按该条消息自带的装配快照独立渲染，
 * 各齿轮几何由 buildGear 生成，空间位姿由 assembly.ts 确定性求解器给出。
 *
 * 性能约定：
 * - 画布进入视口 ≥85% 才初始化场景并启动渲染循环；可见比例降到 40% 以下停止 rAF
 *   （画面定格在最后一帧），中间区间保持原状态，防止滚动边界抖动反复建拆上下文；
 * - WebGL 上下文总量受限（浏览器上限约 8~16 个）：超过上限时 LRU 回收
 *   最久未显示的画布，回收前截屏为静态图兜底展示，滚回视野时再重建。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { buildGear } from '../gear/geometry'
import type { MeshData } from '../gear/mesh/MeshData'
import { buildFlatGeometry } from '../gear/mesh/flatGeometry'
import { snapshotToParamsExtra, type AssemblyGearSnap, type AiAssemblySnapshot } from '../ai/session'
import { solveAssembly, type PlacedGear } from '../ai/assembly'
import { applyMatcapTint, getMatcapTexture } from '../composables/useMatcap'

const props = defineProps<{ msgId: string; assembly: AiAssemblySnapshot }>()

/** 可见比例达到该值启动渲染（卡片比可视区略高时也能正常挂载） */
const MOUNT_RATIO = 0.85
/** 可见比例低于该值停止渲染；两者之间保持当前状态，避免边界抖动反复建拆上下文 */
const STOP_RATIO = 0.4
/** 页面允许同时存活的预览 WebGL 上下文上限 */
const MAX_CONTEXTS = 6
/** 渲染几何缓存条数上限（LRU，按 消息:齿轮 计） */
const GEOMETRY_CACHE_MAX = 24

/* ---------- 渲染几何缓存（跨画布共享，LRU） ---------- */
const geoCache = new Map<string, THREE.BufferGeometry>()

function getGeometry(id: string, snap: AssemblyGearSnap): THREE.BufferGeometry {
  const hit = geoCache.get(id)
  if (hit) {
    geoCache.delete(id)
    geoCache.set(id, hit)
    return hit
  }
  const { params, extra } = snapshotToParamsExtra(snap)
  const data: MeshData = buildGear(snap.type, params, extra, 'preview')
  const geo = buildFlatGeometry(data.positions, data.indices)
  geo.computeBoundingBox()
  geoCache.set(id, geo)
  if (geoCache.size > GEOMETRY_CACHE_MAX) {
    const oldest = geoCache.keys().next()
    if (!oldest.done) {
      geoCache.get(oldest.value)?.dispose()
      geoCache.delete(oldest.value)
    }
  }
  return geo
}

/* ---------- WebGL 上下文登记（LRU 上限） ---------- */
interface LiveCtx {
  visible: boolean
  dispose: () => void
}
const liveCtxs: LiveCtx[] = []

/* ---------- 组件状态 ---------- */
const wrapEl = ref<HTMLDivElement | null>(null)
const stillUrl = ref('')
const failed = ref(false)

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let controls: OrbitControls
let grid: THREE.GridHelper | null = null
let group: THREE.Group | null = null
let material: THREE.MeshMatcapMaterial | null = null
let raf = 0
let io: IntersectionObserver | null = null
let ro: ResizeObserver | null = null
let themeObs: MutationObserver | null = null
let registered: LiveCtx | null = null

/** 构建整条装配：求解位姿 → 各齿轮挂入子 Group */
function buildAssemblyGroup(): THREE.Group {
  const placed: Map<string, PlacedGear> = new Map(
    solveAssembly(props.assembly).map((p) => [p.id, p])
  )
  const root = new THREE.Group()
  for (const g of props.assembly.gears) {
    const p = placed.get(g.id)
    if (!p) continue
    const mesh = new THREE.Mesh(getGeometry(`${props.msgId}:${g.id}`, g), material!)
    mesh.position.set(p.position[0], p.position[1], p.position[2])
    mesh.quaternion.set(p.quaternion[0], p.quaternion[1], p.quaternion[2], p.quaternion[3])
    root.add(mesh)
  }
  return root
}

function ensureScene(): boolean {
  if (renderer) return true
  const el = wrapEl.value
  if (!el || !el.clientWidth || !el.clientHeight) return false
  try {
    scene = new THREE.Scene()
    camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 20000)
    camera.position.set(90, 70, 110)

    // alpha 透明背景，底色由容器 CSS 提供；MeshMatcap 不依赖灯光，无需任何光源
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(el.clientWidth, el.clientHeight)
    renderer.setClearColor(0x000000, 0)
    el.appendChild(renderer.domElement)

    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    // 滚轮缩放（wheel 事件在容器层截止，不冒泡带动会话滚动）；右键平移仍禁用
    controls.enablePan = false
    controls.zoomSpeed = 0.9
    controls.autoRotate = true
    controls.autoRotateSpeed = 1.2

    material = new THREE.MeshMatcapMaterial({
      matcap: getMatcapTexture(),
      flatShading: false,
      side: THREE.DoubleSide
    })
    applyMatcapTint(material)

    group = buildAssemblyGroup()
    scene.add(group)

    grid = new THREE.GridHelper(6000, 60, 0xc5cedb, 0xd9e0ea)
    grid.frustumCulled = false
    scene.add(grid)

    fitView()

    ro = new ResizeObserver(resize)
    ro.observe(el)
    themeObs = new MutationObserver(() => {
      if (material) applyMatcapTint(material)
    })
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })

    registered = { visible: false, dispose: disposeScene }
    liveCtxs.push(registered)
    evictStale()
    return true
  } catch {
    failed.value = true
    return false
  }
}

/** 上下文超限时回收最久未显示的画布（排除自身） */
function evictStale() {
  if (liveCtxs.length <= MAX_CONTEXTS) return
  const victim = liveCtxs.find((c) => !c.visible && c !== registered)
  if (victim) victim.dispose()
}

function fitView() {
  if (!group || !group.children.length) return
  // 以整组世界包围盒取景（齿轮已由求解器摆放到装配位姿）
  const bb = new THREE.Box3().setFromObject(group)
  const center = bb.getCenter(new THREE.Vector3())
  const size = bb.getSize(new THREE.Vector3())
  const radius = Math.max(size.length() / 2, 1)
  controls.target.copy(center)
  const fov = (camera.fov * Math.PI) / 180
  const dist = (radius / Math.sin(fov / 2)) * 0.9
  const dir = new THREE.Vector3(0.75, 0.55, 0.9).normalize()
  camera.position.copy(center).add(dir.multiplyScalar(Math.max(dist, 20)))
  camera.near = Math.max(0.01, radius / 200)
  camera.far = dist * 30
  camera.updateProjectionMatrix()
  // 以取景距离为基准限制滚轮缩放范围，防止穿模或缩到看不见
  controls.minDistance = Math.max(dist * 0.2, 4)
  controls.maxDistance = dist * 4
  if (grid) {
    grid.position.y = bb.min.y - Math.max(2, radius * 0.02)
    const span = Math.max(size.x, size.z, 20) * 1.6
    grid.scale.setScalar(span / 6000)
  }
}

function resize() {
  const el = wrapEl.value
  if (!el || !renderer) return
  const w = el.clientWidth
  const h = el.clientHeight
  if (!w || !h) return
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
}

function loop() {
  raf = requestAnimationFrame(loop)
  controls.update()
  renderer?.render(scene, camera)
}

function startLoop() {
  if (raf || !ensureScene()) return
  stillUrl.value = ''
  loop()
}

function stopLoop() {
  if (raf) {
    cancelAnimationFrame(raf)
    raf = 0
  }
}

/** 释放渲染上下文；回收（非卸载）时定格当前帧为静态图兜底 */
function disposeScene() {
  stopLoop()
  if (renderer && renderer.domElement.isConnected) {
    try {
      stillUrl.value = renderer.domElement.toDataURL('image/png')
    } catch {
      /* 截屏失败时直接显示占位背景 */
    }
  }
  controls?.dispose()
  material?.dispose()
  material = null
  renderer?.dispose()
  renderer?.domElement.remove()
  renderer = null
  group = null
  grid = null
  ro?.disconnect()
  ro = null
  themeObs?.disconnect()
  themeObs = null
  if (registered) {
    const i = liveCtxs.indexOf(registered)
    if (i >= 0) liveCtxs.splice(i, 1)
    registered = null
  }
}

function onIo(entries: IntersectionObserverEntry[]) {
  for (const e of entries) {
    const ratio = e.intersectionRatio
    if (ratio >= MOUNT_RATIO) {
      if (registered) registered.visible = true
      startLoop()
    } else if (ratio <= STOP_RATIO) {
      if (registered) registered.visible = false
      stopLoop()
    }
  }
}

/**
 * 滚轮事件截止：OrbitControls 已在 canvas（target 阶段）完成缩放并 preventDefault，
 * 本监听处于冒泡阶段、晚于 target 执行，只做 stopPropagation、不重复缩放逻辑，
 * 保证鼠标在 canvas 上滚轮只缩放 3D 视图、不带动外层会话流滚动。
 * 画布未初始化或被 LRU 回收（显示定格图）时放行，滚轮仍可正常滚动会话。
 */
function stopWheelBubble(e: WheelEvent) {
  if (renderer && e.target === renderer.domElement) e.stopPropagation()
}

onMounted(() => {
  io = new IntersectionObserver(onIo, { threshold: [0, STOP_RATIO, MOUNT_RATIO, 1] })
  if (wrapEl.value) {
    io.observe(wrapEl.value)
    wrapEl.value.addEventListener('wheel', stopWheelBubble, { passive: true })
  }
})

onBeforeUnmount(() => {
  wrapEl.value?.removeEventListener('wheel', stopWheelBubble)
  io?.disconnect()
  io = null
  disposeScene()
})
</script>

<template>
  <div ref="wrapEl" class="ai-gear-canvas">
    <img v-if="stillUrl" class="still" :src="stillUrl" alt="齿轮组预览（渲染已暂停）" />
    <div v-if="failed" class="failed">齿轮装配渲染失败</div>
  </div>
</template>

<style scoped>
.ai-gear-canvas {
  position: relative;
  aspect-ratio: 4 / 3;
  border-radius: 12px;
  overflow: hidden;
  background: #eef2f7;
}

.ai-gear-canvas :deep(canvas) {
  display: block;
}

.still {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}

.failed {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: #909399;
}
</style>
