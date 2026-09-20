// 完整复现 store.buildNow() 调用路径
import { buildGear } from './src/gear/geometry'
import { GearType, defaultParams } from './src/gear/schema'

const params = { ...defaultParams } // radialThickness=5 by default
const extra = { pitch: 8.47, helicalSystem: 'radial', rackType: 'straight', wormType: 'helical' }

try {
  const mesh = buildGear(GearType.Internal, params, extra, 'preview')
  console.log('OK: triangles=', mesh.triangleCount, 'vertices=', mesh.vertexCount)
} catch (e) {
  console.error('THROWN:', e instanceof Error ? e.message : e)
  console.error(e instanceof Error ? e.stack : '')
}
