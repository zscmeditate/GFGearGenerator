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

  switch (type) {
    case GearType.Spur:
      return buildCylindricalGear({
        m, z: p.z, pressureAngleDeg: p.pressureAngle, height: p.gearHeight, quality
      })

    case GearType.ShiftedSpur:
      return buildCylindricalGear({
        m, z: p.z, pressureAngleDeg: p.pressureAngle, height: p.gearHeight, X: p.X, quality
      })

    case GearType.Helical:
      return buildCylindricalGear({
        m, z: p.z, pressureAngleDeg: p.pressureAngle, height: p.gearHeight,
        helixAngleDeg: p.helixAngle, cw: p.clockwise, doubleHelical: p.doubleHelical,
        normalSystem, quality
      })

    case GearType.ShiftedHelical:
      return buildCylindricalGear({
        m, z: p.z, pressureAngleDeg: p.pressureAngle, height: p.gearHeight,
        helixAngleDeg: p.helixAngle, cw: p.clockwise, doubleHelical: p.doubleHelical,
        normalSystem, X: p.X, quality
      })

    case GearType.Internal:
      return buildCylindricalGear({
        m, z: p.z, pressureAngleDeg: p.pressureAngle, height: p.gearHeight,
        internal: true, rimThickness: p.radialThickness, quality
      })
    case GearType.InternalNS:
      return buildCylindricalGear({
        m, z: p.z, pressureAngleDeg: p.pressureAngle, height: p.gearHeight,
        internal: true, nonStandard: true, rimThickness: p.radialThickness, quality
      })

    case GearType.InternalHelical:
      return buildCylindricalGear({
        m, z: p.z, pressureAngleDeg: p.pressureAngle, height: p.gearHeight,
        helixAngleDeg: p.helixAngle, cw: p.clockwise, doubleHelical: p.doubleHelical,
        normalSystem, internal: true, rimThickness: p.radialThickness, quality
      })
    case GearType.InternalHelicalNS:
      return buildCylindricalGear({
        m, z: p.z, pressureAngleDeg: p.pressureAngle, height: p.gearHeight,
        helixAngleDeg: p.helixAngle, cw: p.clockwise, doubleHelical: p.doubleHelical,
        normalSystem, internal: true, nonStandard: true, rimThickness: p.radialThickness, quality
      })

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
        pressureAngleDeg: p.pressureAngle, quality
      })

    case GearType.Worm:
      return buildWormDrive({
        m, z: p.z, pressureAngleDeg: p.pressureAngle,
        wormLength: p.wormLength, wheelHeight: p.gearHeight,
        driveRadius: p.wormDriveRadius,
        leftThreaded: p.leftThreaded,
        hobbed: extra.wormType === 'hobbed',
        quality
      })
  }
}
