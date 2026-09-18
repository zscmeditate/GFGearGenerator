/** 11 种齿轮类型与参数 Schema（对应原插件 NC1~NC11） */

export enum GearType {
  Spur = 'spur',
  Internal = 'internal',
  InternalNS = 'internalNS',
  Helical = 'helical',
  InternalHelicalNS = 'intHelicalNS',
  InternalHelical = 'intHelical',
  Rack = 'rack',
  Bevel = 'bevel',
  ShiftedSpur = 'shiftedSpur',
  ShiftedHelical = 'shiftedHelical',
  Worm = 'worm'
}

export type Standard = 'metric' | 'english'

export interface NumberField {
  id: string
  label: string
  min: number
  max: number
  step: number
  integer?: boolean
  /** 度量：mm 长度（英制时换算 in）/ dp 径节（英制时出现）/ deg 角度 / count 计数 / coef 系数 */
  measure: 'mm' | 'dp' | 'deg' | 'count' | 'coef'
  default: number
}
export interface BoolField {
  id: string
  label: string
  default: boolean
}
export interface ChoiceField {
  id: string
  label: string
  default: string
  options: { value: string; label: string; hint?: string }[]
}
export type FieldDef = (NumberField | BoolField | ChoiceField) & {
  /** 仅特定齿轮子形态显示，返回 false 隐藏 */
  show?: (p: GearParams) => boolean
}

export interface GearParams {
  standard: Standard
  module: number
  z: number
  zPinion: number
  gearHeight: number
  pressureAngle: number
  radialThickness: number
  helixAngle: number
  clockwise: boolean
  doubleHelical: boolean
  normalSystem: boolean
  X: number
  rackHelical: boolean
  rackThickness: number
  rackHeight: number
  wormLength: number
  wormDriveRadius: number
  wormHobbed: boolean
  leftThreaded: boolean
}

export const defaultParams: GearParams = {
  standard: 'metric',
  module: 3,
  z: 17,
  zPinion: 17,
  gearHeight: 10,
  pressureAngle: 20,
  radialThickness: 5,
  helixAngle: 15,
  clockwise: false,
  doubleHelical: false,
  normalSystem: false,
  X: 0,
  rackHelical: false,
  rackThickness: 10,
  rackHeight: 10,
  wormLength: 40,
  wormDriveRadius: 5,
  leftThreaded: false,
  wormHobbed: false
}

const moduleField = (): NumberField => ({ id: 'module', label: '模数 Module', min: 0.4, max: 75, step: 0.05, measure: 'dp', default: 3 })
const pitchField = (): NumberField => ({ id: 'pitch', label: '径节 Pitch [DP]', min: 0.34, max: 63.5, step: 0.1, measure: 'dp', default: 0 })
const zField = (): NumberField => ({ id: 'z', label: '齿数 Teeth', min: 6, max: 250, step: 1, integer: true, measure: 'count', default: 17 })
const heightField = (label = '齿宽 Gear height'): NumberField => ({ id: 'gearHeight', label, min: 0.5, max: 500, step: 0.5, measure: 'mm', default: 10 })
const paField = (): NumberField => ({ id: 'pressureAngle', label: '压力角 Pressure angle', min: 14.5, max: 30, step: 0.5, measure: 'deg', default: 20 })
const radialField = (): NumberField => ({ id: 'radialThickness', label: '径向厚度 Radial thickness', min: 0.5, max: 200, step: 0.5, measure: 'mm', default: 5 })
const helixField = (): NumberField => ({ id: 'helixAngle', label: '螺旋角 Helix angle', min: 0, max: 89, step: 0.5, measure: 'deg', default: 15 })
const fastField = (): BoolField => ({ id: 'fastCompute', label: '快速计算 Fast Compute', default: true })

const helicalSystemField = (): ChoiceField => ({
  id: 'helicalSystem',
  label: '螺旋制 Helical system',
  default: 'radial',
  options: [
    { value: 'radial', label: '端面制 Radial', hint: '保持直齿几何尺寸，需专用刀具' },
    { value: 'normal', label: '法向制 Normal', hint: '使用直齿刀具，几何尺寸变化' }
  ]
})

export interface GearTypeMeta {
  type: GearType
  name: string
  en: string
  icon: string
  group: number
  approx?: boolean
  fields: FieldDef[]
}

export const gearTypes: GearTypeMeta[] = [
  {
    type: GearType.Spur, name: '直齿轮', en: 'Spur Gear', icon: 'SpurGear', group: 0,
    fields: [moduleField(), pitchField(), zField(), heightField(), paField()]
  },
  {
    type: GearType.Helical, name: '斜齿 / 人字齿轮', en: 'Helical Gear', icon: 'Helical', group: 0,
    fields: [
      helicalSystemField(),
      { id: 'clockwise', label: '右旋反向 Clock wise', default: false },
      { id: 'doubleHelical', label: '人字齿 Double helical', default: false },
      moduleField(), pitchField(), zField(), heightField(), paField(), helixField()
    ]
  },
  {
    type: GearType.Bevel, name: '90° 锥齿轮对', en: 'Bevel Gears', icon: 'Conicos', group: 0, approx: true,
    fields: [
      moduleField(), pitchField(),
      { id: 'z', label: '大轮齿数 Wheel teeth', min: 6, max: 250, step: 1, integer: true, measure: 'count', default: 17 },
      { id: 'zPinion', label: '小轮齿数 Pinion teeth', min: 6, max: 250, step: 1, integer: true, measure: 'count', default: 17 },
      paField()
    ]
  },
  {
    type: GearType.Rack, name: '齿条', en: 'Gear Rack', icon: 'Rack', group: 0,
    fields: [
      {
        id: 'rackType', label: '齿条类型 Rack type', default: 'straight',
        options: [
          { value: 'straight', label: '直齿条 Straight' },
          { value: 'helical', label: '斜齿条 Helical' }
        ]
      },
      helicalSystemField(),
      moduleField(), pitchField(),
      { id: 'z', label: '齿数 Teeth', min: 6, max: 250, step: 1, integer: true, measure: 'count', default: 17 },
      { id: 'rackThickness', label: '厚度 Thickness', min: 0.5, max: 500, step: 0.5, measure: 'mm', default: 10 },
      paField(),
      helixField(),
      { id: 'rackHeight', label: '高度 Rack height', min: 0.5, max: 500, step: 0.5, measure: 'mm', default: 10 }
    ]
  },
  {
    type: GearType.Worm, name: '蜗轮蜗杆', en: 'Worm Gear Drive', icon: 'WormGear', group: 0, approx: true,
    fields: [
      {
        id: 'wormType', label: '蜗轮类型 Worm type', default: 'helical',
        options: [
          { value: 'helical', label: '螺旋蜗轮 Helical' },
          { value: 'hobbed', label: '滚切直蜗轮 Hobbed', hint: '由蜗杆齿形包络切削' }
        ]
      },
      { id: 'leftThreaded', label: '左旋 Left threaded', default: false },
      moduleField(), pitchField(), zField(),
      { id: 'wormLength', label: '蜗杆长度 Worm length', min: 5, max: 1000, step: 1, measure: 'mm', default: 40 },
      { id: 'gearHeight', label: '蜗轮厚度 Worm gear height', min: 1, max: 300, step: 0.5, measure: 'mm', default: 12 },
      paField(),
      { id: 'wormDriveRadius', label: '蜗杆分度圆半径 Drive radius', min: 1, max: 300, step: 0.5, measure: 'mm', default: 5 }
    ]
  },
  {
    type: GearType.Internal, name: '标准内齿轮', en: 'Internal Spur Gear', icon: 'InteriorGear', group: 1,
    fields: [moduleField(), pitchField(), zField(), heightField(), paField(), radialField()]
  },
  {
    type: GearType.InternalNS, name: '非标准内齿轮', en: 'Non-std Internal Spur', icon: 'NoStdr', group: 1,
    fields: [moduleField(), pitchField(), zField(), heightField(), paField(), radialField()]
  },
  {
    type: GearType.InternalHelical, name: '标准内斜齿轮', en: 'Internal Helical', icon: 'InteriorStdr', group: 1,
    fields: [
      helicalSystemField(),
      { id: 'clockwise', label: '右旋反向 Clock wise', default: false },
      { id: 'doubleHelical', label: '人字齿 Double helical', default: false },
      moduleField(), pitchField(), zField(), heightField(), paField(), radialField(), helixField()
    ]
  },
  {
    type: GearType.InternalHelicalNS, name: '非标准内斜齿轮', en: 'Non-std Internal Helical', icon: 'NoStdr', group: 1,
    fields: [
      helicalSystemField(),
      { id: 'clockwise', label: '右旋反向 Clock wise', default: false },
      { id: 'doubleHelical', label: '人字齿 Double helical', default: false },
      moduleField(), pitchField(), zField(), heightField(), paField(), radialField(), helixField()
    ]
  },
  {
    type: GearType.ShiftedSpur, name: '变位直齿轮', en: 'Profile Shifted Spur', icon: 'Recto', group: 2,
    fields: [
      { id: 'X', label: '变位系数 X', min: -1, max: 1, step: 0.01, measure: 'coef', default: 0 },
      moduleField(), pitchField(), zField(), heightField(), paField()
    ]
  },
  {
    type: GearType.ShiftedHelical, name: '变位斜齿轮', en: 'Profile Shifted Helical', icon: 'DoubleHelical', group: 2,
    fields: [
      helicalSystemField(),
      { id: 'clockwise', label: '右旋反向 Clock wise', default: false },
      { id: 'doubleHelical', label: '人字齿 Double helical', default: false },
      { id: 'X', label: '变位系数 X', min: -1, max: 1, step: 0.01, measure: 'coef', default: 0 },
      moduleField(), pitchField(), zField(), heightField(), paField(), helixField()
    ]
  }
]

export const gearTypeMap: Record<GearType, GearTypeMeta> = Object.fromEntries(
  gearTypes.map((g) => [g.type, g])
) as Record<GearType, GearTypeMeta>

/** Schema 中出现但不在 GearParams 内的选择字段，存到这个集合里（松类型） */
export const extraChoiceIds = new Set(['helicalSystem', 'rackType', 'wormType', 'fastCompute'])

/** 某齿轮类型全部 schema 字段的默认值（扁平 id → value，含 pitch/helicalSystem 等 extra 字段） */
export function defaultValuesForType(type: GearType): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const f of gearTypeMap[type].fields) out[f.id] = f.default
  return out
}
