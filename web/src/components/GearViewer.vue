<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch, ref, computed } from 'vue'
import { Bottom, Download, RefreshRight, View } from '@element-plus/icons-vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { useGearStore } from '../stores/gear'
import { getSceneLightingForBg, type SceneLightingConfig } from '../composables/useSceneLighting'
import { applyMatcapTint, getMatcapTexture } from '../composables/useMatcap'
import { buildFlatGeometry } from '../gear/mesh/flatGeometry'
import { buildGear } from '../gear/geometry'
import type { MeshData } from '../gear/mesh/MeshData'
import { solveAssembly, type PlacedGear } from '../ai/assembly'
import { snapshotToParamsExtra, type AiAssemblySnapshot, type AssemblyGearSnap } from '../ai/session'

const store = useGearStore()

/* ─── 装配模式：传入 assembly 快照时渲染多齿轮（复用本组件的渲染/视角能力） ─── */
const props = defineProps<{ assembly?: AiAssemblySnapshot | null }>()
const emit = defineEmits<{ (e: 'export-assembly'): void }>()
const isAssembly = computed(() => !!props.assembly)

const containerEl = ref<HTMLDivElement | null>(null)

let renderer: THREE.WebGLRenderer
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera
let controls: OrbitControls
let gearMesh: THREE.Mesh | null = null
let gridHelper: THREE.GridHelper

/* 装配模式：多齿轮组 + 共享 MatCap 材质 */
let assemblyGroup: THREE.Group | null = null
let assemblyMaterial: THREE.MeshMatcapMaterial | null = null

/* ─── 装配模式可见性优化：画布被遮挡时暂停渲染，完全可见时才恢复 rAF ───
 * AI 会话里每条带装配的消息都会挂载一个 GearViewer，全部同时渲染浪费 GPU。
 * 沿用旧 AiGearCanvas 的约定：可见比例 ≥85% 启动渲染循环，≤40% 停止
 * （画面定格在最后一帧），中间区间保持当前状态，防止滚动边界抖动反复启停。 */
const MOUNT_RATIO = 0.85
const STOP_RATIO = 0.4
let io: IntersectionObserver | null = null

/* ─── 灯光引用（主题切换时平滑过渡） ─── */
let keyLight: THREE.DirectionalLight
let raf = 0
let resizeObs: ResizeObserver

/* ─── 齿轮类型切换过渡：双 Mesh 交叉淡入淡出 ───
 *
 * Emil Kowalski 设计工程技巧：
 * 1. Asymmetric timing — 退出快（120ms，用户已预期变化）/ 进入慢（250ms，用户在看新模型）
 * 2. Scale bounce — 新模型从 scale(0.96) 放大到 1.0，给"物理实体出现"的感觉
 * 3. Exponential ease-out — 退出果断（快起慢停），进入有冲击力（快起慢停）
 * 4. 消除空窗 — 旧模型淡到 0 后立即释放，新模型无缝接力
 * 5. Warmup — 先以 opacity≈0 渲染 100ms，GPU 完成完整渲染后再开始动画 */
const GEAR_FADE_OUT_MS = 120  /* 退出快：用户已预期变化 */
const GEAR_FADE_IN_MS = 250   /* 进入慢：用户在注视新模型 */
const GEAR_WARMUP_MS = 100   /* 预热：scale≈0 渲染时长，确保 GPU 完成几何上传 */
/** idle：无过渡；switching：淡出等待 / 交叉进行中 */
let switchPhase: 'idle' | 'switching' = 'idle'
/** 每次切换自增，作废上一代过渡的 rAF 回调，支持连续快速切换 */
let switchToken = 0
let fadeOutRaf = 0
let crossRaf = 0
let warmupTimer = 0
/** 正在淡出的旧模型（可能是上一代还没淡入完的"新模型"，连点时续接调头） */
let outMesh: THREE.Mesh | null = null

/* ─── FPS 统计：渲染循环内计数，每 500ms 采样一次；轨道整体左移一步展示新样本 ─── */
const FPS_BARS = 24 /* 可视柱数 */
const BAR_STEP = 5 /* 单柱步进 = 3px 柱宽 + 2px 间隙 */
const SLIDE_MS = 400 /* 平移动画时长（需小于 500ms 采样间隔） */
const fps = ref(0)
/** 恒保持 FPS_BARS+1 根：末尾一根是新样本，初始在视口外，随左移滑入 */
const fpsSamples = ref<number[]>(new Array<number>(FPS_BARS).fill(0))
const slideIdx = ref(0)
const trackAnim = ref(true)
const trackStyle = computed(() => ({ transform: `translateX(${-slideIdx.value * BAR_STEP}px)` }))
const fpsLevel = computed(() => (fps.value >= 50 ? 'good' : fps.value >= 30 ? 'mid' : 'low'))
let fpsFrames = 0
let fpsWindowStart = performance.now()
let slideTimer = 0

/** 样本柱高：以 72fps 满格，最低 6% 作为基线 */
function fpsBarHeight(v: number): string {
  return `${Math.max(6, Math.min(100, (v / 72) * 100))}%`
}

/** 新样本入轨：整体左移一步，动画结束后丢掉最旧一根并把位移归零（视觉位置不变） */
function pushFpsSample(v: number) {
  fpsSamples.value.push(v)
  slideIdx.value = 1
  window.clearTimeout(slideTimer)
  slideTimer = window.setTimeout(() => {
    trackAnim.value = false
    fpsSamples.value.shift()
    slideIdx.value = 0
    /* 下一帧再恢复动画，避免归零位移被过渡插值 */
    requestAnimationFrame(() => requestAnimationFrame(() => (trackAnim.value = true)))
  }, SLIDE_MS + 50)
}

/* ─── 相机模式 ─── */
export type CameraMode = 'perspective' | 'orthographic'
const cameraMode = ref<CameraMode>('perspective')

/* ─── 场景灯光引用（用于主题切换时平滑过渡） ─── */
let hemiLight: THREE.HemisphereLight
let ambientLight: THREE.AmbientLight
let fillLight: THREE.DirectionalLight
let rimLight1: THREE.DirectionalLight
let rimLight2: THREE.DirectionalLight

/* ─── 当前场景配置（跟踪亮/暗） ─── */
let currentSceneConfig: SceneLightingConfig | null = null

/* ─── 过渡动画 ─── */
const TRANSITION_DURATION = 400 // ms
let transitionStart = 0
let transitionFrom: SceneLightingConfig | null = null
let transitionTo: SceneLightingConfig | null = null
let transitionRaf = 0

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff
  const r = Math.round(lerp(ar, br, t))
  const g = Math.round(lerp(ag, bg, t))
  const bl = Math.round(lerp(ab, bb, t))
  return (r << 16) | (g << 8) | bl
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** 指数缓出：快起慢停，用于退出（果断消失）和进入（有冲击力的落地感） */
function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
}

/* ─── 网格颜色（规范 7：中心线主色、格线辅色，均低对比） ───
 * GridHelper 材质默认 vertexColors，直接逐顶点写 color：
 * 落在 x=0 / z=0 中心轴上的顶点用主色，其余格线用更浅的辅色。
 * 仅视觉处理，不涉及几何/相机/业务。 */
function applyGridColors(c1: number, c2: number, opacity: number) {
  const geo = gridHelper.geometry as THREE.BufferGeometry
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const colors = new Float32Array(pos.count * 3)
  const ca = new THREE.Color(c1)
  const cb = new THREE.Color(c2)
  for (let i = 0; i < pos.count; i++) {
    const c = pos.getX(i) === 0 || pos.getZ(i) === 0 ? ca : cb
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const mat = gridHelper.material as THREE.LineBasicMaterial
  mat.vertexColors = true
  mat.color.setHex(0xffffff) /* 顶点色直显，不被材质色相乘压暗 */
  mat.transparent = true
  mat.opacity = opacity
}

function applyConfigInstant(cfg: SceneLightingConfig) {
  scene.background = new THREE.Color(cfg.sceneBg)
  scene.fog = new THREE.Fog(cfg.sceneBg, cfg.fogNear, cfg.fogFar)

  hemiLight.color.setHex(cfg.hemiSky)
  hemiLight.groundColor.setHex(cfg.hemiGround)
  hemiLight.intensity = cfg.hemiIntensity

  ambientLight.color.setHex(cfg.ambientColor)
  ambientLight.intensity = cfg.ambientIntensity

  keyLight.color.setHex(cfg.keyColor)
  keyLight.intensity = cfg.keyIntensity
  keyLight.position.set(...cfg.keyPosition)

  fillLight.color.setHex(cfg.fillColor)
  fillLight.intensity = cfg.fillIntensity
  fillLight.position.set(...cfg.fillPosition)

  rimLight1.color.setHex(cfg.rim1Color)
  rimLight1.intensity = cfg.rim1Intensity
  rimLight1.position.set(...cfg.rim1Position)

  rimLight2.color.setHex(cfg.rim2Color)
  rimLight2.intensity = cfg.rim2Intensity
  rimLight2.position.set(...cfg.rim2Position)

  renderer.toneMappingExposure = cfg.toneMappingExposure

  applyGridColors(cfg.gridColor1, cfg.gridColor2, cfg.gridOpacity)
}

function applyConfigLerp(from: SceneLightingConfig, to: SceneLightingConfig, progress: number) {
  const t = easeInOutCubic(progress)

  const bg = lerpColor(from.sceneBg, to.sceneBg, t)
  scene.background = new THREE.Color(bg)
  scene.fog = new THREE.Fog(bg, lerp(from.fogNear, to.fogNear, t), lerp(from.fogFar, to.fogFar, t))

  hemiLight.color.setHex(lerpColor(from.hemiSky, to.hemiSky, t))
  hemiLight.groundColor.setHex(lerpColor(from.hemiGround, to.hemiGround, t))
  hemiLight.intensity = lerp(from.hemiIntensity, to.hemiIntensity, t)

  ambientLight.color.setHex(lerpColor(from.ambientColor, to.ambientColor, t))
  ambientLight.intensity = lerp(from.ambientIntensity, to.ambientIntensity, t)

  keyLight.color.setHex(lerpColor(from.keyColor, to.keyColor, t))
  keyLight.intensity = lerp(from.keyIntensity, to.keyIntensity, t)

  fillLight.color.setHex(lerpColor(from.fillColor, to.fillColor, t))
  fillLight.intensity = lerp(from.fillIntensity, to.fillIntensity, t)

  rimLight1.color.setHex(lerpColor(from.rim1Color, to.rim1Color, t))
  rimLight1.intensity = lerp(from.rim1Intensity, to.rim1Intensity, t)
  rimLight2.color.setHex(lerpColor(from.rim2Color, to.rim2Color, t))
  rimLight2.intensity = lerp(from.rim2Intensity, to.rim2Intensity, t)

  renderer.toneMappingExposure = lerp(from.toneMappingExposure, to.toneMappingExposure, t)

  applyGridColors(
    lerpColor(from.gridColor1, to.gridColor1, t),
    lerpColor(from.gridColor2, to.gridColor2, t),
    lerp(from.gridOpacity, to.gridOpacity, t)
  )
}

function transitionToConfig(target: SceneLightingConfig) {
  if (!currentSceneConfig) {
    applyConfigInstant(target)
    currentSceneConfig = target
    return
  }

  if (currentSceneConfig === target) return

  transitionFrom = currentSceneConfig
  transitionTo = target
  transitionStart = performance.now()

  function tick() {
    if (!transitionFrom || !transitionTo) return
    const elapsed = performance.now() - transitionStart
    const progress = Math.min(elapsed / TRANSITION_DURATION, 1)
    applyConfigLerp(transitionFrom, transitionTo, progress)

    if (progress < 1) {
      transitionRaf = requestAnimationFrame(tick)
    } else {
      currentSceneConfig = transitionTo
      transitionFrom = null
      transitionTo = null
    }
  }

  cancelAnimationFrame(transitionRaf)
  transitionRaf = requestAnimationFrame(tick)
}

/* ─── 主题监听 ─── */
let bgObserver: MutationObserver | null = null

function getCurrentBg(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--bg-color').trim() || '#e0e5ec'
}

function onThemeChanged() {
  // MatCap 明暗由贴图烘焙；背景/灯光/网格平滑过渡，齿轮染色即时跟随主题色
  transitionToConfig(getSceneLightingForBg(getCurrentBg()))
  if (gearMesh) applyMatcapTint(gearMesh.material as THREE.MeshMatcapMaterial)
  if (outMesh) applyMatcapTint(outMesh.material as THREE.MeshMatcapMaterial)
}

/* ─── 正交相机辅助 ─── */
function createOrthoCamera(w: number, h: number, src?: THREE.PerspectiveCamera): THREE.OrthographicCamera {
  const aspect = w / h
  const frustum = 150
  const cam = new THREE.OrthographicCamera(
    -frustum * aspect, frustum * aspect,
    frustum, -frustum,
    0, 5000
  )
  if (src) {
    cam.position.copy(src.position)
    cam.quaternion.copy(src.quaternion)
  } else {
    cam.position.set(90, 70, 110)
  }
  return cam
}

/* ─── 相机模式切换 ─── */
function switchCameraMode(mode: CameraMode) {
  if (mode === cameraMode.value) return
  const el = containerEl.value!
  const oldCamera = camera

  if (mode === 'orthographic') {
    camera = createOrthoCamera(el.clientWidth, el.clientHeight, oldCamera as THREE.PerspectiveCamera)
  } else {
    const cam = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 5000)
    cam.position.copy(oldCamera.position)
    cam.quaternion.copy(oldCamera.quaternion)
    camera = cam
  }

  controls.object = camera
  cameraMode.value = mode
  updateCameraFrustum()
}

function updateCameraFrustum() {
  if (cameraMode.value !== 'orthographic') return
  const el = containerEl.value
  if (!el) return
  const ortho = camera as THREE.OrthographicCamera
  const aspect = el.clientWidth / el.clientHeight
  const frustum = 150
  ortho.left   = -frustum * aspect
  ortho.right  =  frustum * aspect
  ortho.top    =  frustum
  ortho.bottom = -frustum
  ortho.updateProjectionMatrix()
}

/* ─── 俯视图 ─── */
function topView() {
  const target = controls.target.clone()
  const dist = camera.position.distanceTo(target)
  camera.position.set(target.x, target.y + dist, target.z)
  camera.lookAt(target)
  controls.update()
}

function initScene() {
  const el = containerEl.value!

  const initialBg = getCurrentBg()
  currentSceneConfig = getSceneLightingForBg(initialBg)

  scene = new THREE.Scene()
  scene.background = new THREE.Color(currentSceneConfig.sceneBg)
  scene.fog = new THREE.Fog(currentSceneConfig.sceneBg, currentSceneConfig.fogNear, currentSceneConfig.fogFar)

  camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 5000)
  camera.position.set(90, 70, 110)

  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(el.clientWidth, el.clientHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  el.appendChild(renderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.autoRotateSpeed = 1.6

  // 灯光
  hemiLight = new THREE.HemisphereLight(
    currentSceneConfig.hemiSky,
    currentSceneConfig.hemiGround,
    currentSceneConfig.hemiIntensity
  )
  scene.add(hemiLight)

  ambientLight = new THREE.AmbientLight(
    currentSceneConfig.ambientColor,
    currentSceneConfig.ambientIntensity
  )
  scene.add(ambientLight)

  keyLight = new THREE.DirectionalLight(currentSceneConfig.keyColor, currentSceneConfig.keyIntensity)
  keyLight.position.set(...currentSceneConfig.keyPosition)
  keyLight.castShadow = true
  keyLight.shadow.mapSize.set(2048, 2048)
  keyLight.shadow.bias = -0.0005
  keyLight.shadow.normalBias = 0.02
  scene.add(keyLight)
  scene.add(keyLight.target)

  fillLight = new THREE.DirectionalLight(currentSceneConfig.fillColor, currentSceneConfig.fillIntensity)
  fillLight.position.set(...currentSceneConfig.fillPosition)
  scene.add(fillLight)

  rimLight1 = new THREE.DirectionalLight(currentSceneConfig.rim1Color, currentSceneConfig.rim1Intensity)
  rimLight1.position.set(...currentSceneConfig.rim1Position)
  scene.add(rimLight1)

  rimLight2 = new THREE.DirectionalLight(currentSceneConfig.rim2Color, currentSceneConfig.rim2Intensity)
  rimLight2.position.set(...currentSceneConfig.rim2Position)
  scene.add(rimLight2)

  // 网格地面
  gridHelper = new THREE.GridHelper(1000, 100, currentSceneConfig.gridColor1, currentSceneConfig.gridColor2)
  gridHelper.frustumCulled = false
  applyGridColors(currentSceneConfig.gridColor1, currentSceneConfig.gridColor2, currentSceneConfig.gridOpacity)
  gridHelper.position.y = -0.01
  scene.add(gridHelper)

  bgObserver = new MutationObserver(() => onThemeChanged())
  bgObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style'],
  })

  resizeObs = new ResizeObserver(() => {
    const w = el.clientWidth, h = el.clientHeight
    if (!w || !h) return
    if (cameraMode.value === 'perspective') {
      ;(camera as THREE.PerspectiveCamera).aspect = w / h
    }
    camera.updateProjectionMatrix()
    updateCameraFrustum()
    renderer.setSize(w, h)
  })
  resizeObs.observe(el)

  startLoop()
}

function animate() {
  raf = requestAnimationFrame(animate)
  // 相机取景插值的 200ms 内关闭自动旋转（OrbitControls 每帧从 camera.position
  // 反算内部球坐标，我们每帧直接写位置，不会与用户手动轨道冲突）
  controls.autoRotate = isAssembly.value ? true : switchPhase === 'idle' && store.autoRotate
  controls.update()
  renderer.render(scene, camera)

  /* FPS 采样 */
  fpsFrames++
  const now = performance.now()
  const elapsed = now - fpsWindowStart
  if (elapsed >= 500) {
    fps.value = Math.min(999, Math.round((fpsFrames * 1000) / elapsed))
    pushFpsSample(fps.value)
    fpsFrames = 0
    fpsWindowStart = now
  }
}

/** 启动渲染循环（幂等：已在运行时直接返回） */
function startLoop() {
  if (raf) return
  animate()
}

/** 停止渲染循环：画布定格在最后一帧（装配模式被遮挡时暂停） */
function stopLoop() {
  if (raf) {
    cancelAnimationFrame(raf)
    raf = 0
  }
}

/* ─── 装配模式可见性监听：完全露出才渲染，被挡住就暂停 ─── */
function onIo(entries: IntersectionObserverEntry[]) {
  if (!isAssembly.value) return
  for (const e of entries) {
    const ratio = e.intersectionRatio
    if (ratio >= MOUNT_RATIO) startLoop()
    else if (ratio <= STOP_RATIO) stopLoop()
  }
}

/* ─── 取景：纯计算 / 瞬时应用（算法与原 fitView 一致） ─── */

interface CameraView {
  position: THREE.Vector3
  near: number
  far: number
  /** 仅正交相机有效 */
  ortho: { left: number; right: number; top: number; bottom: number } | null
  shadowR: number
  groundY: number
}

/** 纯计算目标取景，不改任何相机/场景状态（副作用集中在 applyViewInstant） */
function computeView(geom: THREE.BufferGeometry): CameraView {
  geom.computeBoundingBox()
  const bb = geom.boundingBox!
  const size = new THREE.Vector3()
  bb.getSize(size)
  const radius = Math.max(size.x, size.y, size.z) / 2

  const aspect = (containerEl.value!.clientWidth / containerEl.value!.clientHeight) || 1
  const dir = new THREE.Vector3(0.75, 0.55, 0.9).normalize()
  const v: CameraView = {
    position: new THREE.Vector3(),
    near: 0,
    far: radius * 40,
    ortho: null,
    shadowR: Math.max(radius * 1.5, 10),
    groundY: bb.min.y - 2,
  }

  if (cameraMode.value === 'perspective') {
    const pCam = camera as THREE.PerspectiveCamera
    const fov = (pCam.fov * Math.PI) / 180
    const dist = (radius / Math.sin(fov / 2)) * 0.85
    v.position.copy(dir.clone().multiplyScalar(Math.max(dist, 20)))
    v.near = Math.max(0.01, radius / 200)
    v.far = dist * 30
  } else {
    const frustum = radius * 1.2
    v.ortho = {
      left: -frustum * aspect,
      right: frustum * aspect,
      top: frustum,
      bottom: -frustum,
    }
    v.position.copy(dir.clone().multiplyScalar(Math.max(radius * 3, 50)))
  }
  return v
}

/** 阴影相机范围 + 网格地面高度：对遮挡关系不敏感，过渡开始时瞬时切到目标 */
function applyViewEnv(v: CameraView) {
  keyLight.target.position.set(0, 0, 0)
  const sc = keyLight.shadow.camera
  sc.left = -v.shadowR
  sc.right = v.shadowR
  sc.top = v.shadowR
  sc.bottom = -v.shadowR
  sc.near = 1
  sc.far = v.shadowR * 6
  sc.updateProjectionMatrix()
  if (isFinite(v.groundY)) gridHelper.position.y = v.groundY
}

function applyViewInstant(v: CameraView) {
  controls.target.set(0, 0, 0)
  camera.position.copy(v.position)
  camera.near = v.near
  camera.far = v.far
  if (v.ortho && cameraMode.value === 'orthographic') {
    const o = camera as THREE.OrthographicCamera
    o.left = v.ortho.left
    o.right = v.ortho.right
    o.top = v.ortho.top
    o.bottom = v.ortho.bottom
  }
  camera.updateProjectionMatrix()
  applyViewEnv(v)
}

/* ─── 齿轮 Mesh 工厂与释放（matcap 贴图是模块单例，material.dispose 不影响贴图） ─── */

function createGearMaterial(): THREE.MeshMatcapMaterial {
  const mat = new THREE.MeshMatcapMaterial({
    matcap: getMatcapTexture(),
    // 面法线由 buildFlatGeometry 逐面写入（同一四边形两片共享法线），
    // 不使用 flatShading 的导数法线：后者在 DoubleSide 下不会为背面翻转，
    // 会使端部露出的背面/掠射面片采到贴图暗缘
    flatShading: false,
    side: THREE.DoubleSide,
  })
  applyMatcapTint(mat)
  // 新材质要承接当前线框状态（旧实现复用同一材质所以天然保留）
  ;(mat as unknown as THREE.Material & { wireframe: boolean }).wireframe = store.wireframe
  return mat
}

/* ─── 装配模式：多齿轮几何构建 / 取景 / 重装配 ─── */

function buildAssemblyGeometry(snap: AssemblyGearSnap): THREE.BufferGeometry {
  const { params, extra } = snapshotToParamsExtra(snap)
  const data: MeshData = buildGear(snap.type, params, extra, 'preview')
  const geo = buildFlatGeometry(data.positions, data.indices)
  geo.computeBoundingBox()
  return geo
}

function buildAssemblyGroup(): THREE.Group {
  const asm = props.assembly!
  const placed: Map<string, PlacedGear> = new Map(solveAssembly(asm).map((p) => [p.id, p]))
  const root = new THREE.Group()
  for (const g of asm.gears) {
    const p = placed.get(g.id)
    if (!p) continue
    const mesh = new THREE.Mesh(buildAssemblyGeometry(g), assemblyMaterial!)
    mesh.position.set(p.position[0], p.position[1], p.position[2])
    mesh.quaternion.set(p.quaternion[0], p.quaternion[1], p.quaternion[2], p.quaternion[3])
    mesh.castShadow = true
    mesh.receiveShadow = true
    root.add(mesh)
  }
  return root
}

/** 装配取景：基于整组包围盒（透视 / 正交两种相机均处理） */
function fitAssembly() {
  if (!assemblyGroup || !assemblyGroup.children.length) return
  const bb = new THREE.Box3().setFromObject(assemblyGroup)
  const center = bb.getCenter(new THREE.Vector3())
  const size = bb.getSize(new THREE.Vector3())
  const radius = Math.max(size.length() / 2, 1)
  const aspect = (containerEl.value!.clientWidth / containerEl.value!.clientHeight) || 1
  const dir = new THREE.Vector3(0.75, 0.55, 0.9).normalize()
  controls.target.copy(center)
  if (cameraMode.value === 'perspective') {
    const pCam = camera as THREE.PerspectiveCamera
    const fov = (pCam.fov * Math.PI) / 180
    const dist = (radius / Math.sin(fov / 2)) * 0.85
    camera.position.copy(center).add(dir.multiplyScalar(Math.max(dist, 20)))
    pCam.near = Math.max(0.01, radius / 200)
    pCam.far = dist * 30
  } else {
    const o = camera as THREE.OrthographicCamera
    const frustum = radius * 1.2
    o.left = -frustum * aspect
    o.right = frustum * aspect
    o.top = frustum
    o.bottom = -frustum
    camera.position.copy(center).add(dir.multiplyScalar(Math.max(radius * 3, 50)))
  }
  camera.updateProjectionMatrix()
  gridHelper.position.y = bb.min.y - 2
}

function initAssembly() {
  if (!isAssembly.value) return
  assemblyMaterial = new THREE.MeshMatcapMaterial({
    matcap: getMatcapTexture(),
    flatShading: false,
    side: THREE.DoubleSide,
  })
  applyMatcapTint(assemblyMaterial)
  assemblyGroup = buildAssemblyGroup()
  scene.add(assemblyGroup)
  fitAssembly()
}

/** 重新装配：重新求解位姿重建齿轮组（不调整相机视角） */
function reassembleAssembly() {
  if (!isAssembly.value || !assemblyMaterial) return
  if (assemblyGroup) scene.remove(assemblyGroup)
  assemblyGroup = buildAssemblyGroup()
  scene.add(assemblyGroup)
}

function disposeGearMesh(m: THREE.Mesh) {
  scene.remove(m)
  m.geometry.dispose()
  ;(m.material as THREE.Material).dispose()
}

/* ─── 双 Mesh 交叉过渡 ─── */

/** 旧模型缩出：快（120ms）+ easeOutExpo，从当前尺寸缩到 0.01 */
function startFadeOut(token: number) {
  const m = outMesh
  if (!m) return
  m.castShadow = false

  const fromScale = m.scale.x
  const duration = Math.max(60, GEAR_FADE_OUT_MS * Math.max(fromScale, 0.0001))
  const start = performance.now()

  const tick = () => {
    if (token !== switchToken || outMesh !== m) return
    const p = Math.min((performance.now() - start) / duration, 1)
    const s = fromScale * (1 - easeOutExpo(p))
    m.scale.setScalar(Math.max(0.001, s))
    if (p < 1) fadeOutRaf = requestAnimationFrame(tick)
  }
  fadeOutRaf = requestAnimationFrame(tick)
}

/** 齿轮类型变化：当前主模型转为淡出方，新几何到达后进入交叉 */
function beginGearSwitch() {
  const token = ++switchToken
  cancelAnimationFrame(fadeOutRaf)
  cancelAnimationFrame(crossRaf)
  window.clearTimeout(warmupTimer)

  // 首屏几何尚未构建：无物可淡出，保持 idle，首帧直接显示
  if (!gearMesh && !outMesh) return

  // 上一代 cross 中更早的旧模型还没释放：直接淘汰
  if (gearMesh && outMesh) {
    disposeGearMesh(outMesh)
    outMesh = null
  }
  // 当前主模型（可能是上一代淡入到一半的"新模型"）转为淡出方；
  // 空窗等待期（gearMesh 已 null）则让现有 outMesh 继续淡出即可
  if (gearMesh) {
    outMesh = gearMesh
    gearMesh = null
  }
  switchPhase = 'switching'
  startFadeOut(token)
}

/** 新几何到达：纯 scale 动画（0.01→1.0），完全不透明，无 z-fighting */
function startCrossFade(token: number, flat: THREE.BufferGeometry) {
  applyViewEnv(computeView(flat))

  const mat = createGearMaterial()
  const m = new THREE.Mesh(flat, mat)
  m.castShadow = false
  m.receiveShadow = true
  // 从极小尺寸开始：用户几乎看不到，GPU 已在完整渲染
  m.scale.setScalar(0.001)
  scene.add(m)
  gearMesh = m

  const old = outMesh

  // 等 100ms：mesh 以 scale=0.01 在场景中被完整渲染（不透明），GPU 完成几何上传
  warmupTimer = window.setTimeout(() => {
    if (token !== switchToken) return
    const start = performance.now()
    const tick = () => {
      if (token !== switchToken) return
      const p = Math.min((performance.now() - start) / GEAR_FADE_IN_MS, 1)
      const e = easeOutExpo(p)

      // 新模型：纯 scale 放大
      m.scale.setScalar(0.001 + 0.999 * e)

      if (p < 1) {
        crossRaf = requestAnimationFrame(tick)
        return
      }

      if (old && old.parent) disposeGearMesh(old)
      if (outMesh === old) outMesh = null
      m.castShadow = true
      m.scale.setScalar(1)
      switchPhase = 'idle'
    }
    crossRaf = requestAnimationFrame(tick)
  }, GEAR_WARMUP_MS)
}

function updateGear() {
  const data = store.mesh
  if (!data) return

  const flat = buildFlatGeometry(data.positions, data.indices)
  flat.computeBoundingBox()

  // 首次构建：直接显示并取景
  if (!gearMesh && !outMesh && switchPhase === 'idle') {
    gearMesh = new THREE.Mesh(flat, createGearMaterial())
    gearMesh.castShadow = true
    gearMesh.receiveShadow = true
    scene.add(gearMesh)
    applyViewInstant(computeView(flat))
    return
  }

  if (switchPhase === 'switching') {
    if (gearMesh) {
      // 交叉窗口内的后续重建（如切换后立刻拖滑块）：只换几何，动画继续
      gearMesh.geometry.dispose()
      gearMesh.geometry = flat
      return
    }
    startCrossFade(switchToken, flat)
    return
  }

  // idle：参数微调等普通重建即时替换几何，视角保持用户当前状态
  gearMesh!.geometry.dispose()
  gearMesh!.geometry = flat
}

watch(() => store.type, () => {
  if (isAssembly.value) return
  beginGearSwitch()
})

watch(
  () => store.mesh,
  () => {
    if (isAssembly.value) return
    updateGear()
  }
)

watch(
  () => store.wireframe,
  (wf) => {
    // Material 运行时支持 wireframe，但 @types/three 的 MeshMatcapMaterial 未声明
    if (gearMesh) (gearMesh.material as THREE.Material & { wireframe: boolean }).wireframe = wf
    if (outMesh) (outMesh.material as THREE.Material & { wireframe: boolean }).wireframe = wf
  }
)

defineExpose({
  reset: () => {
    // 过渡中忽略（窗口仅 200ms），避免与交叉收尾的资源释放竞争
    if (switchPhase !== 'idle' || !gearMesh) return
    applyViewInstant(computeView(gearMesh.geometry))
  },
  switchCameraMode,
  topView,
  cameraMode,
})

onMounted(() => {
  initScene()
  initAssembly()
  // 装配模式：监听可见性，画布被遮挡时暂停渲染循环（主视图始终渲染）
  if (isAssembly.value) {
    io = new IntersectionObserver(onIo, { threshold: [0, STOP_RATIO, MOUNT_RATIO, 1] })
    if (containerEl.value) io.observe(containerEl.value)
  }
})
onBeforeUnmount(() => {
  io?.disconnect()
  io = null
  cancelAnimationFrame(raf)
  cancelAnimationFrame(transitionRaf)
  cancelAnimationFrame(fadeOutRaf)
  cancelAnimationFrame(crossRaf)
  window.clearTimeout(warmupTimer)
  if (outMesh) disposeGearMesh(outMesh)
  window.clearTimeout(slideTimer)
  bgObserver?.disconnect()
  resizeObs?.disconnect()
  controls?.dispose()
  renderer?.dispose()
  renderer?.domElement.remove()
})
</script>

<template>
  <div ref="containerEl" class="gear-viewer">
    <!-- 装配模式悬浮控件：左上角视角切换 / 右上角重新装配 / 右下角导出 -->
    <template v-if="isAssembly">
      <el-button
        class="viewer-fab view-toggle"
        circle
        :icon="View"
        :title="cameraMode === 'perspective' ? '切换为正交视图' : '切换为透视视图'"
        @click="switchCameraMode(cameraMode === 'perspective' ? 'orthographic' : 'perspective')"
      />
      <el-button
        class="viewer-fab assemble-fab"
        circle
        :icon="RefreshRight"
        title="重新装配"
        @click="reassembleAssembly"
      />
      <el-button
        class="viewer-fab top-fab"
        circle
        :icon="Bottom"
        title="俯视图"
        @click="topView"
      />
      <el-button
        class="viewer-fab export-assembly-fab"
        circle
        :icon="Download"
        title="导出装配体"
        @click="emit('export-assembly')"
      />
    </template>

    <!-- 右下角帧率显示（单齿轮模式） -->
    <div v-if="!isAssembly" class="fps-hud" :class="fpsLevel">
      <div class="fps-readout">
        <span class="fps-value">{{ fps }}</span>
        <span class="fps-unit">FPS</span>
      </div>
      <div class="fps-spark">
        <div class="fps-viewport">
          <div class="fps-track" :class="{ anim: trackAnim }" :style="trackStyle">
            <span
              v-for="(v, i) in fpsSamples"
              :key="i"
              class="fps-bar"
              :style="{ height: fpsBarHeight(v) }"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 装配模式悬浮按钮：左上角视角切换 / 右上角重新装配 / 右下角俯视 */
.viewer-fab {
  position: absolute;
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
  transition: color 0.18s var(--ease-out), box-shadow 0.18s var(--ease-out);
}

.viewer-fab:active {
  transform: scale(0.93);
  box-shadow: 0 3px 10px rgba(110, 125, 150, 0.25);
}

@media (hover: hover) and (pointer: fine) {
  .viewer-fab:hover,
  .viewer-fab:focus {
    color: var(--el-color-primary);
    background: #fff;
    border-color: transparent;
    box-shadow: 0 6px 18px rgba(110, 125, 150, 0.32);
  }
}

.viewer-fab :deep(.el-icon) {
  font-size: 16px;
}

.view-toggle {
  top: 14px;
  left: 14px;
}

.assemble-fab {
  top: 14px;
  right: 14px;
}

.top-fab {
  top: 14px;
  left: 54px;
}

.export-assembly-fab {
  bottom: 14px;
  right: 14px;
}

.fps-hud {
  --fps-color: var(--el-color-primary);
  position: absolute;
  right: 14px;
  bottom: 12px;
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(150, 160, 175, 0.18);
  box-shadow: 0 2px 8px rgba(110, 125, 150, 0.1);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  pointer-events: none;
  user-select: none;
}

.fps-readout {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.fps-value {
  font-size: 18px;
  font-weight: 800;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--fps-color);
}

.fps-unit {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: #9aa3b2;
}

.fps-spark {
  height: 20px;
  padding-left: 10px;
  border-left: 1px solid rgba(150, 160, 175, 0.25);
}

.fps-viewport {
  width: 118px; /* 24 根可视柱：24 × (3+2) − 2 */
  height: 100%;
  overflow: hidden;
}

.fps-track {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 100%;
  will-change: transform;
}

.fps-track.anim {
  transition: transform 0.4s linear;
}

.fps-bar {
  flex: none;
  width: 3px;
  border-radius: 1.5px;
  background: var(--fps-color);
  opacity: 0.28;
}

.fps-bar:last-child {
  opacity: 0.85;
}

/* 健康度配色：跟随主题主色 / 中等 / 偏低 */
.fps-hud.good {
  --fps-color: var(--el-color-primary);
}

.fps-hud.mid {
  --fps-color: #e6a23c;
}

.fps-hud.low {
  --fps-color: #f56c6c;
}
</style>
