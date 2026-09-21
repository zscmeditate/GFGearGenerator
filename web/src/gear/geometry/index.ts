import { GearType, type GearParams } from '../schema'
import { diametralPitchToModule } from '../math'
import type { MeshData } from '../mesh/MeshData'
import { buildCylindricalGear } from './cylindrical'
import { buildRack } from './rack'
import { buildBevelPair } from './bevel'
import { buildWormDrive } from './worm'

/** Schema 中非 GearParams 字段的运行时值（helicalSystem / rackType / wormType / pitch） */
export type ExtraValues = Record<string, string | number | boolean | undefined>

export type Quality = 'preview' | 'high'

export function buildGear(type: GearType, p: GearParams, extra: ExtraValues, quality: Quality): MeshData {
  const pitch = Number(extra.pitch)
  const m = p.standard === 'english' && pitch > 0 ? diametralPitchToModule(pitch) : p.module
  const normalSystem = extra.helicalSystem === 'normal'

  // 圆柱齿轮统一"躺平"：绕 X 轴 -90°，让轴线 Z→Y（竖直），
  // 相机从 +Z 看时呈现齿轮侧面（齿根/齿顶可见），而非正对端面。
  const layFlat = (mesh: MeshData) => { mesh.transform((x, y, z) => [x, z, -y]); return mesh }

  switch (type) {
    case GearType.Spur:
      return layFlat(buildCylindricalGear({
        m, z: p.z, pressureAngleDeg: p.pressureAngle, height: p.gearHeight,
        boreRadius: p.boreDiameter / 2, boreFlat: p.boreFlat, quality
      }))

    case GearType.ShiftedSpur:
      return layFlat(buildCylindricalGear({
        m, z: p.z, pressureAngleDeg: p.pressureAngle, height: p.gearHeight, X: p.X,
        boreRadius: p.boreDiameter / 2, boreFlat: p.boreFlat, quality
      }))

    case GearType.Helical:
      return layFlat(buildCylindricalGear({
        m, z: p.z, pressureAngleDeg: p.pressureAngle, height: p.gearHeight,
        helixAngleDeg: p.helixAngle, cw: p.clockwise, doubleHelical: p.doubleHelical,
        normalSystem, boreRadius: p.boreDiameter / 2, boreFlat: p.boreFlat, quality
      }))

    case GearType.ShiftedHelical:
      return layFlat(buildCylindricalGear({
        m, z: p.z, pressureAngleDeg: p.pressureAngle, height: p.gearHeight,
        helixAngleDeg: p.helixAngle, cw: p.clockwise, doubleHelical: p.doubleHelical,
        normalSystem, X: p.X, boreRadius: p.boreDiameter / 2, boreFlat: p.boreFlat, quality
      }))

    case GearType.Internal:
      return layFlat(buildCylindricalGear({
        m, z: p.z, pressureAngleDeg: p.pressureAngle, height: p.gearHeight,
        internal: true, rimThickness: p.radialThickness, quality
      }))
    case GearType.InternalNS:
      return layFlat(buildCylindricalGear({
        m, z: p.z, pressureAngleDeg: p.pressureAngle, height: p.gearHeight,
        internal: true, nonStandard: true, rimThickness: p.radialThickness, quality
      }))

    case GearType.InternalHelical:
      return layFlat(buildCylindricalGear({
        m, z: p.z, pressureAngleDeg: p.pressureAngle, height: p.gearHeight,
        helixAngleDeg: p.helixAngle, cw: p.clockwise, doubleHelical: p.doubleHelical,
        normalSystem, internal: true, rimThickness: p.radialThickness, quality
      }))
    case GearType.InternalHelicalNS:
      return layFlat(buildCylindricalGear({
        m, z: p.z, pressureAngleDeg: p.pressureAngle, height: p.gearHeight,
        helixAngleDeg: p.helixAngle, cw: p.clockwise, doubleHelical: p.doubleHelical,
        normalSystem, internal: true, nonStandard: true, rimThickness: p.radialThickness, quality
      }))

    case GearType.Rack:
      return buildRack({
        m, z: p.z, pressureAngleDeg: p.pressureAngle,
        thickness: p.rackThickness, barHeight: p.rackHeight,
        helical: extra.rackType === 'helical', helixAngleDeg: p.helixAngle,
        normalSystem, quality
      })

    case GearType.Bevel:
      return buildBevelPair({
        m, zWheel: p.z, zPinion: p.zPinion,
        pressureAngleDeg: p.pressureAngle, quality,
        boreRadius: p.boreDiameter / 2, boreFlat: p.boreFlat
      })

    case GearType.Worm:
      return buildWormDrive({
        m, z: p.z, pressureAngleDeg: p.pressureAngle,
        wormLength: p.wormLength, wheelHeight: p.gearHeight,
        driveRadius: p.wormDriveRadius,
        leftThreaded: p.leftThreaded,
        hobbed: extra.wormType === 'hobbed',
        boreRadius: p.boreDiameter / 2, boreFlat: p.boreFlat,
        quality
      })
  }
}
