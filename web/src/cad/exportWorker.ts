/// <reference lib="webworker" />
// 直连 emscripten 主模块与所需动态库（?url 由 Vite 产出资源地址），
// 不引入 opencascade.js barrel，避免全部 54 个 wasm 进产物。
import ocMainJS from 'opencascade.js/dist/opencascade.js'
import mainWasm from 'opencascade.js/dist/opencascade.wasm?url'
import TKMath from 'opencascade.js/dist/module.TKMath.wasm?url'
import TKG2d from 'opencascade.js/dist/module.TKG2d.wasm?url'
import TKG3d from 'opencascade.js/dist/module.TKG3d.wasm?url'
import TKGeomBase from 'opencascade.js/dist/module.TKGeomBase.wasm?url'
import TKGeomAlgo from 'opencascade.js/dist/module.TKGeomAlgo.wasm?url'
import TKBRep from 'opencascade.js/dist/module.TKBRep.wasm?url'
import TKTopAlgo from 'opencascade.js/dist/module.TKTopAlgo.wasm?url'
import TKShHealing from 'opencascade.js/dist/module.TKShHealing.wasm?url'
import TKCDF from 'opencascade.js/dist/module.TKCDF.wasm?url'
import TKXSBase from 'opencascade.js/dist/module.TKXSBase.wasm?url'
import TKSTEPBase from 'opencascade.js/dist/module.TKSTEPBase.wasm?url'
import TKSTEP209 from 'opencascade.js/dist/module.TKSTEP209.wasm?url'
import TKSTEPAttr from 'opencascade.js/dist/module.TKSTEPAttr.wasm?url'
import TKSTEP from 'opencascade.js/dist/module.TKSTEP.wasm?url'

/* tessellated solid → STEP 最小动态库集（顺序即依赖序） */
const STEP_LIBS = [
  TKMath, TKG2d, TKG3d, TKGeomBase, TKBRep, TKGeomAlgo,
  TKTopAlgo, TKShHealing, TKCDF,
  TKXSBase, TKSTEPBase, TKSTEP209, TKSTEPAttr, TKSTEP
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ocPromise: Promise<any> | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getOc(): Promise<any> {
  if (!ocPromise) {
    ocPromise = (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const oc: any = await (ocMainJS as any)({
        locateFile(path: string) {
          if (path.endsWith('.wasm')) return mainWasm
          return path
        }
      })
      for (let i = 0; i < STEP_LIBS.length; i++) {
        postProgress(`加载 CAD 内核 ${i + 1}/${STEP_LIBS.length}…`, 3 + (i / STEP_LIBS.length) * 30)
        await oc.loadDynamicLibrary(STEP_LIBS[i], { loadAsync: true, global: true, nodelete: true, allowUndefined: false })
      }
      return oc
    })()
  }
  return ocPromise
}

export interface ExportRequest {
  kind: 'step' | 'stl'
  positions: Float64Array
  indices: Uint32Array
}

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = async (ev: MessageEvent<ExportRequest>) => {
  const req = ev.data
  try {
    if (req.kind === 'stl') {
      const buf = writeBinarySTL(req.positions, req.indices)
      ctx.postMessage({ ok: true, kind: 'stl', buffer: buf }, [buf])
      return
    }
    const buf = await writeSTEP(req.positions, req.indices)
    ctx.postMessage({ ok: true, kind: 'step', buffer: buf }, [buf])
  } catch (err) {
    ctx.postMessage({ ok: false, error: (err as Error).message ?? String(err) })
  }
}

function postProgress(stage: string, pct: number) {
  ctx.postMessage({ progress: true, stage, pct })
}

/* ---------------- 二进制 STL（直写，无第三方） ---------------- */
function writeBinarySTL(pos: Float64Array, idx: Uint32Array): ArrayBuffer {
  const triCount = idx.length / 3
  const buffer = new ArrayBuffer(84 + triCount * 50)
  const dv = new DataView(buffer)
  // 80 字节头
  const header = 'GF Gear Generator Web - binary STL (mm)'
  for (let i = 0; i < 80; i++) dv.setUint8(i, i < header.length ? header.charCodeAt(i) : 0)
  dv.setUint32(80, triCount, true)

  let o = 84
  for (let t = 0; t < idx.length; t += 3) {
    const ia = idx[t] * 3, ib = idx[t + 1] * 3, ic = idx[t + 2] * 3
    const ax = pos[ia], ay = pos[ia + 1], az = pos[ia + 2]
    const bx = pos[ib], by = pos[ib + 1], bz = pos[ib + 2]
    const cx = pos[ic], cy = pos[ic + 1], cz = pos[ic + 2]
    // 法线 (b-a)×(c-a)
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const nl = Math.hypot(nx, ny, nz) || 1
    nx /= nl; ny /= nl; nz /= nl
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true)
    o += 12
    dv.setFloat32(o, ax, true); dv.setFloat32(o + 4, ay, true); dv.setFloat32(o + 8, az, true); o += 12
    dv.setFloat32(o, bx, true); dv.setFloat32(o + 4, by, true); dv.setFloat32(o + 8, bz, true); o += 12
    dv.setFloat32(o, cx, true); dv.setFloat32(o + 4, cy, true); dv.setFloat32(o + 8, cz, true); o += 12
    dv.setUint16(o, 0, true); o += 2
    if ((t / 3) % 20000 === 0) postProgress('写 STL', Math.min(99, (t / idx.length) * 100))
  }
  return buffer
}

/* ---------------- tessellated solid → STEP ---------------- */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function writeSTEP(pos: Float64Array, idx: Uint32Array): Promise<ArrayBuffer> {
  postProgress('加载 OpenCascade 内核…', 2)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oc = await getOc() as any

  oc.Interface_Static.SetCVal('xstep.cascade.unit', 'MM')

  const sewing = new oc.BRepBuilderAPI_Sewing(1e-3, true, true, true, false)
  const tris = idx.length / 3
  void tris

  postProgress('缝合三角面片…', 5)
  for (let t = 0; t < idx.length; t += 3) {
    const ia = idx[t] * 3, ib = idx[t + 1] * 3, ic = idx[t + 2] * 3
    const poly = new oc.BRepBuilderAPI_MakePolygon_1()
    poly.Add_1(new oc.gp_Pnt_3(pos[ia], pos[ia + 1], pos[ia + 2]))
    poly.Add_1(new oc.gp_Pnt_3(pos[ib], pos[ib + 1], pos[ib + 2]))
    poly.Add_1(new oc.gp_Pnt_3(pos[ic], pos[ic + 1], pos[ic + 2]))
    poly.Close()
    const mf = new oc.BRepBuilderAPI_MakeFace_15(poly.Wire(), true)
    const face = mf.Face()
    sewing.Add(face)
    face.delete()
    mf.delete()
    poly.delete()
    if ((t / 3) % 5000 === 0) {
      postProgress(`缝合三角面片 ${Math.round((t / idx.length) * 100)}%`, 5 + 0.6 * ((t / idx.length) * 100))
      // 给消息循环一点时间
      await new Promise((r) => setTimeout(r, 0))
    }
  }

  postProgress('构建拓扑实体…', 68)
  sewing.Perform(new oc.Message_ProgressRange_1())
  const sewed = sewing.SewedShape()

  // 枚举缝合结果中的所有壳：能闭合为实体的转 Solid，其余保留 Shell，统一装入 Compound
  const builder = new oc.BRep_Builder()
  const compound = new oc.TopoDS_Compound()
  builder.MakeCompound(compound)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let shapeToWrite: any = compound
  let solidCount = 0
  let shellCount = 0
  const explorer = new oc.TopExp_Explorer_2(
    sewed,
    oc.TopAbs_ShapeEnum.TopAbs_SHELL,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE
  )
  for (; explorer.More(); explorer.Next()) {
    const shell = oc.TopoDS.Shell_1(explorer.Current())
    shellCount++
    let added = false
    if (shell && !shell.IsNull()) {
      const fixer = new oc.ShapeFix_Solid_1()
      const solid = fixer.SolidFromShell(shell)
      if (solid && !solid.IsNull()) {
        builder.Add(compound, solid)
        solidCount++
        added = true
      }
      fixer.delete()
    }
    if (!added) builder.Add(compound, shell)
  }
  explorer.delete()
  builder.delete()

  // 没有枚举到任何壳（异常情况）则直接导出缝合体
  if (shellCount === 0) shapeToWrite = sewed
  console.log(`[exportWorker] shells=${shellCount} solids=${solidCount}`)

  postProgress('编码 STEP…', 80)
  const writer = new oc.STEPControl_Writer_1()
  const status = writer.Transfer(
    shapeToWrite,
    oc.STEPControl_StepModelType.STEPControl_AsIs,
    true,
    new oc.Message_ProgressRange_1()
  )
  // IFSelect_ReturnStatus：RetVoid=0, RetDone=1, RetError=2, RetFail=3, RetStop=4
  const code = typeof status === 'number' ? status : status?.value
  if (code !== 1) {
    throw new Error(`STEP Transfer 失败（status=${code} / ${JSON.stringify(status)}），网格可能不封闭`)
  }
  const path = '/gear.step'
  writer.Write(path)
  const data: Uint8Array = oc.FS.readFile(path)
  const out = new ArrayBuffer(data.byteLength)
  new Uint8Array(out).set(data)

  writer.delete()
  sewing.delete()
  return out
}
