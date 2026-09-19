<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch, ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { useGearStore } from '../stores/gear'
import { getSceneLightingForBg, type SceneLightingConfig } from '../composables/useSceneLighting'
import matcapUrl from '../gear/geometry/313131_BBBBBB_878787_A3A4A4.png'

const store = useGearStore()
const containerEl = ref<HTMLDivElement | null>(null)

let renderer: THREE.WebGLRenderer
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera
let controls: OrbitControls
let gearMesh: THREE.Mesh | null = null
let gridHelper: THREE.GridHelper

/* ─── MatCap 贴图（烘焙光照的灰度球体图，视图空间法线采样，不依赖场景灯光） ─── */
let matcapTexture: THREE.Texture | null = null
function getMatcapTexture(): THREE.Texture {
  if (!matcapTexture) {
    matcapTexture = new THREE.TextureLoader().load(matcapUrl)
    matcapTexture.colorSpace = THREE.SRGBColorSpace
  }
  return matcapTexture
}
let keyLight: THREE.DirectionalLight
let raf = 0
let resizeObs: ResizeObserver
/** 待执行的相机取景：初次构建 / 切换齿轮类型时置 true，updateGear 后消费 */
let pendingFit = true

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
const TRANSITION_DURATION = 600 // ms
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

/** 读取当前主题色（--el-color-primary）并转为 THREE.Color */
function getThemePrimaryColor(): THREE.Color {
  const hex = getComputedStyle(document.documentElement).getPropertyValue('--el-color-primary').trim() || '#E78BAF'
  return new THREE.Color(hex)
}

/* ─── MatCap 主题色融合 ───
 * MeshMatcapMaterial 最终颜色 = 贴图灰阶 × material.color。
 * color 直接取主题色会把暗部压成脏色，故在「白色 ↔ 主题色」间按
 * MATCAP_TINT_STRENGTH 混合：0=纯灰阶贴图，1=完全主题色 */
const MATCAP_TINT_STRENGTH = 0.55
const MATCAP_WHITE = new THREE.Color(0xffffff)

function applyMatcapTint(mat: THREE.MeshMatcapMaterial) {
  mat.color.lerpColors(MATCAP_WHITE, getThemePrimaryColor(), MATCAP_TINT_STRENGTH)
}

function onThemeChanged() {
  // MatCap 明暗由贴图烘焙；背景/灯光/网格平滑过渡，齿轮染色即时跟随主题色
  transitionToConfig(getSceneLightingForBg(getCurrentBg()))
  if (gearMesh) applyMatcapTint(gearMesh.material as THREE.MeshMatcapMaterial)
}

/* ─── 正交相机辅助 ─── */
function createOrthoCamera(w: number, h: number, src?: THREE.PerspectiveCamera): THREE.OrthographicCamera {
  const aspect = w / h
  const frustum = 150
  const cam = new THREE.OrthographicCamera(
    -frustum * aspect, frustum * aspect,
    frustum, -frustum,
    0.1, 5000
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
  gridHelper = new THREE.GridHelper(2000, 80, currentSceneConfig.gridColor1, currentSceneConfig.gridColor2)
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

  animate()
}

function animate() {
  raf = requestAnimationFrame(animate)
  controls.autoRotate = store.autoRotate
  controls.update()
  renderer.render(scene, camera)
}

function updateGear() {
  const data = store.mesh
  if (!data) return

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3))
  g.setIndex(data.indices)
  const flat = g.toNonIndexed()
  g.dispose()
  flat.computeVertexNormals()
  flat.computeBoundingBox()

  if (gearMesh) {
    gearMesh.geometry.dispose()
    gearMesh.geometry = flat
  } else {
    // MatCap 材质：以视图空间法线采样烘焙球贴图，明暗随相机角度变化；
    // color 在白色与主题色之间混合，保留灰阶层次的同时融入主题色调
    const mat = new THREE.MeshMatcapMaterial({
      matcap: getMatcapTexture(),
      flatShading: true,
      side: THREE.DoubleSide
    })
    applyMatcapTint(mat)
    gearMesh = new THREE.Mesh(flat, mat)
    gearMesh.castShadow = true
    gearMesh.receiveShadow = true
    scene.add(gearMesh)
    pendingFit = true
  }

  if (pendingFit) {
    fitView(flat)
    pendingFit = false
  }
}

watch(() => store.type, () => { pendingFit = true })

function fitView(geom: THREE.BufferGeometry) {
  geom.computeBoundingBox()
  const bb = geom.boundingBox!
  const center = new THREE.Vector3()
  bb.getCenter(center)
  const size = new THREE.Vector3()
  bb.getSize(size)
  const radius = Math.max(size.x, size.y, size.z) / 2
  controls.target.set(0, 0, 0)

  if (cameraMode.value === 'perspective') {
    const pCam = camera as THREE.PerspectiveCamera
    const fov = (pCam.fov * Math.PI) / 180
    const dist = (radius / Math.sin(fov / 2)) * 0.85
    const dir = new THREE.Vector3(0.75, 0.55, 0.9).normalize()
    camera.position.copy(dir.multiplyScalar(Math.max(dist, 20)))
    pCam.near = Math.max(0.01, radius / 200)
    pCam.far = dist * 30
    pCam.updateProjectionMatrix()
  } else {
    const ortho = camera as THREE.OrthographicCamera
    const aspect = (containerEl.value!.clientWidth / containerEl.value!.clientHeight) || 1
    const frustum = radius * 1.2
    ortho.left   = -frustum * aspect
    ortho.right  =  frustum * aspect
    ortho.top    =  frustum
    ortho.bottom = -frustum
    ortho.near   = 0.1
    ortho.far = radius * 40
    ortho.updateProjectionMatrix()
    const dir = new THREE.Vector3(0.75, 0.55, 0.9).normalize()
    camera.position.copy(dir.multiplyScalar(Math.max(radius * 3, 50)))
  }

  const shadowR = Math.max(radius * 1.5, 10)
  keyLight.target.position.set(0, 0, 0)
  keyLight.shadow.camera.left = -shadowR
  keyLight.shadow.camera.right = shadowR
  keyLight.shadow.camera.top = shadowR
  keyLight.shadow.camera.bottom = -shadowR
  keyLight.shadow.camera.near = 1
  keyLight.shadow.camera.far = shadowR * 6
  keyLight.shadow.camera.updateProjectionMatrix()

  const groundY = bb.min.y - 2
  if (isFinite(groundY)) gridHelper.position.y = groundY < 0 ? groundY : bb.min.y - 2
}

watch(
  () => store.mesh,
  () => updateGear()
)

watch(
  () => store.wireframe,
  (wf) => {
    // Material 运行时支持 wireframe，但 @types/three 的 MeshMatcapMaterial 未声明
    if (gearMesh) (gearMesh.material as THREE.Material & { wireframe: boolean }).wireframe = wf
  }
)

defineExpose({
  reset: () => {
    if (gearMesh) fitView(gearMesh.geometry)
  },
  switchCameraMode,
  topView,
  cameraMode,
})

onMounted(initScene)
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  cancelAnimationFrame(transitionRaf)
  bgObserver?.disconnect()
  resizeObs?.disconnect()
  matcapTexture?.dispose()
  controls?.dispose()
  renderer?.dispose()
  renderer?.domElement.remove()
})
</script>

<template>
  <div ref="containerEl" class="gear-viewer"></div>
</template>
