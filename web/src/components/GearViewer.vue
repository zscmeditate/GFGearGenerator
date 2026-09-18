<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch, ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { useGearStore } from '../stores/gear'

const store = useGearStore()
const containerEl = ref<HTMLDivElement | null>(null)

let renderer: THREE.WebGLRenderer
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let controls: OrbitControls
let gearMesh: THREE.Mesh | null = null
let gridHelper: THREE.GridHelper
let keyLight: THREE.DirectionalLight
let raf = 0
let resizeObs: ResizeObserver

const MAT_COLOR = 0x39d8c8

function initScene() {
  const el = containerEl.value!
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x08080a)
  scene.fog = new THREE.Fog(0x08080a, 400, 1400)

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
  scene.add(new THREE.HemisphereLight(0x8a9098, 0x101012, 0.9))
  keyLight = new THREE.DirectionalLight(0xffffff, 2.1)
  keyLight.position.set(120, 160, 90)
  keyLight.castShadow = true
  keyLight.shadow.mapSize.set(2048, 2048)
  keyLight.shadow.bias = -0.0005
  keyLight.shadow.normalBias = 0.02
  scene.add(keyLight)
  scene.add(keyLight.target)
  const rim = new THREE.DirectionalLight(0x35e0d0, 0.9)
  rim.position.set(-120, 40, -100)
  scene.add(rim)
  const rim2 = new THREE.DirectionalLight(0xb06bff, 0.5)
  rim2.position.set(40, -80, 60)
  scene.add(rim2)

  // 网格地面
  gridHelper = new THREE.GridHelper(2000, 80, 0x2a2a30, 0x16161a)
  ;(gridHelper.material as THREE.Material).transparent = true
  ;(gridHelper.material as THREE.Material).opacity = 0.55
  gridHelper.position.y = -0.01
  scene.add(gridHelper)

  resizeObs = new ResizeObserver(() => {
    const w = el.clientWidth, h = el.clientHeight
    if (!w || !h) return
    camera.aspect = w / h
    camera.updateProjectionMatrix()
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
  if (gearMesh) {
    scene.remove(gearMesh)
    gearMesh.geometry.dispose()
    ;(gearMesh.material as THREE.Material).dispose()
    gearMesh = null
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3))
  g.setIndex(data.indices)
  // 非索引化 + 平面法线，得到锐利齿面着色
  const flat = g.toNonIndexed()
  g.dispose()
  flat.computeVertexNormals()
  flat.computeBoundingBox()

  const mat = new THREE.MeshStandardMaterial({
    color: MAT_COLOR,
    metalness: 0.72,
    roughness: 0.32,
    flatShading: true,
    side: THREE.DoubleSide
  })
  gearMesh = new THREE.Mesh(flat, mat)
  gearMesh.castShadow = true
  gearMesh.receiveShadow = true
  scene.add(gearMesh)
  fitView(flat)
}

function fitView(geom: THREE.BufferGeometry) {
  geom.computeBoundingBox()
  const bb = geom.boundingBox!
  const center = new THREE.Vector3()
  bb.getCenter(center)
  const size = new THREE.Vector3()
  bb.getSize(size)
  const radius = Math.max(size.x, size.y, size.z) / 2
  // 以原点附近为旋转目标（齿轮轴线在 Z，锥齿/蜗杆对在原点）
  controls.target.set(0, 0, 0)
  const fov = (camera.fov * Math.PI) / 180
  const dist = (radius / Math.sin(fov / 2)) * 0.85
  const dir = new THREE.Vector3(0.75, 0.55, 0.9).normalize()
  camera.position.copy(dir.multiplyScalar(Math.max(dist, 20)))
  camera.near = Math.max(0.01, radius / 200)
  camera.far = dist * 30
  camera.updateProjectionMatrix()

  // 阴影相机视锥覆盖整个模型，避免截断式阴影面片
  const shadowR = Math.max(radius * 1.5, 10)
  keyLight.target.position.set(0, 0, 0)
  keyLight.shadow.camera.left = -shadowR
  keyLight.shadow.camera.right = shadowR
  keyLight.shadow.camera.top = shadowR
  keyLight.shadow.camera.bottom = -shadowR
  keyLight.shadow.camera.near = 1
  keyLight.shadow.camera.far = shadowR * 6
  keyLight.shadow.camera.updateProjectionMatrix()

  // 地面贴到模型底部
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
  }
})

onMounted(initScene)
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  resizeObs?.disconnect()
  controls?.dispose()
  renderer?.dispose()
  renderer?.domElement.remove()
})
</script>

<template>
  <div ref="containerEl" class="gear-viewer" style="position:absolute;inset:0"></div>
</template>
