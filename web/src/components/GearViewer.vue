<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch, ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { useGearStore } from '../stores/gear'
import { getSceneLightingForBg, type SceneLightingConfig } from '../composables/useSceneLighting'
import { readThemePalette } from '../composables/useThemePalette'

const store = useGearStore()
const containerEl = ref<HTMLDivElement | null>(null)

let renderer: THREE.WebGLRenderer
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera
let controls: OrbitControls
let gearMesh: THREE.Mesh | null = null
let gridHelper: THREE.GridHelper
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

  rimLight1.color.setHex(cfg.rim1Color)
  rimLight1.intensity = cfg.rim1Intensity
  rimLight1.position.set(...cfg.rim1Position)

  rimLight2.color.setHex(cfg.rim2Color)
  rimLight2.intensity = cfg.rim2Intensity
  rimLight2.position.set(...cfg.rim2Position)

  const mat1 = gridHelper.material as THREE.Material
  ;(gridHelper as any).material.color.setHex(cfg.gridColor1)
  mat1.opacity = cfg.gridOpacity
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

  rimLight1.color.setHex(lerpColor(from.rim1Color, to.rim1Color, t))
  rimLight1.intensity = lerp(from.rim1Intensity, to.rim1Intensity, t)
  rimLight2.color.setHex(lerpColor(from.rim2Color, to.rim2Color, t))
  rimLight2.intensity = lerp(from.rim2Intensity, to.rim2Intensity, t)

  const gridColor = lerpColor(from.gridColor1, to.gridColor1, t)
  ;(gridHelper as any).material.color.setHex(gridColor)
  const mat1 = gridHelper.material as THREE.Material
  mat1.opacity = lerp(from.gridOpacity, to.gridOpacity, t)
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
  const bg = getCurrentBg()
  const cfg = getSceneLightingForBg(bg)
  transitionToConfig(cfg)
  if (gearMesh) {
    const mat = gearMesh.material as THREE.MeshStandardMaterial
    mat.color.setHex(cfg.matColor)
    mat.metalness = cfg.matMetalness
    mat.roughness = cfg.matRoughness
  }
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

  rimLight1 = new THREE.DirectionalLight(currentSceneConfig.rim1Color, currentSceneConfig.rim1Intensity)
  rimLight1.position.set(...currentSceneConfig.rim1Position)
  scene.add(rimLight1)

  rimLight2 = new THREE.DirectionalLight(currentSceneConfig.rim2Color, currentSceneConfig.rim2Intensity)
  rimLight2.position.set(...currentSceneConfig.rim2Position)
  scene.add(rimLight2)

  // 网格地面
  gridHelper = new THREE.GridHelper(2000, 80, currentSceneConfig.gridColor1, currentSceneConfig.gridColor2)
  ;(gridHelper.material as THREE.Material).transparent = true
  ;(gridHelper.material as THREE.Material).opacity = currentSceneConfig.gridOpacity
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
    const cfg = currentSceneConfig ?? getSceneLightingForBg(getCurrentBg())
    const mat = new THREE.MeshStandardMaterial({
      color: cfg.matColor,
      metalness: cfg.matMetalness,
      roughness: cfg.matRoughness,
      flatShading: true,
      side: THREE.DoubleSide
    })
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
    ortho.far    = radius * 40
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
    if (gearMesh) (gearMesh.material as THREE.MeshStandardMaterial).wireframe = wf
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
  controls?.dispose()
  renderer?.dispose()
  renderer?.domElement.remove()
})
</script>

<template>
  <div ref="containerEl" class="gear-viewer"></div>
</template>
