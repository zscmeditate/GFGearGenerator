// src/gear/math.ts
var TAU = Math.PI * 2;
function linspace(start, end, count) {
  if (count <= 1) return [start];
  const step = (end - start) / (count - 1);
  const out = new Array(count);
  for (let i = 0; i < count; i++) out[i] = start + step * i;
  return out;
}
var degToRad = (d) => d * Math.PI / 180;
var inv = (x) => Math.tan(x) - x;
function computeInvolute(input) {
  const { m: m2, z: z2 } = input;
  const ah = input.helixAngle ?? 0;
  const X = input.X ?? 0;
  const normalSystem = input.normalSystem ?? false;
  let modt = m2;
  let apt = input.pressureAngle;
  if (normalSystem) {
    modt = m2 / Math.cos(ah);
    apt = Math.atan(Math.tan(input.pressureAngle) / Math.cos(ah));
  }
  const dp = modt * z2;
  const rp = dp / 2;
  const db = dp * Math.cos(apt);
  const rb = db / 2;
  const ra = rp + m2;
  const rf = rp - 1.25 * m2;
  const shifted = X !== 0;
  const rva = rp + X * m2 + m2;
  const rvf = rp + X * m2 - 1.25 * m2;
  return {
    modt,
    apt,
    normalSystem,
    z: z2,
    m: m2,
    X,
    dp,
    rp,
    db,
    rb,
    ra,
    rf,
    rTip: shifted ? rva : ra,
    rRoot: shifted ? rvf : rf,
    shifted
  };
}
function helixTwist(spec, helixAngle, height2, cw = false) {
  if (helixAngle === 0) return 0;
  const t = height2 * 2 * Math.tan(helixAngle) / spec.dp;
  return cw ? -t : t;
}
var uAtRadius = (rb, r) => r > rb ? Math.sqrt((r / rb) ** 2 - 1) : 0;
function externalHalfThickness(spec, r) {
  const { rb, apt, z: z2, X } = spec;
  const at = Math.acos(Math.min(1, rb / r));
  return Math.PI / (2 * z2) + 2 * X * Math.tan(apt) / z2 + inv(apt) - inv(at);
}
function internalHalfThickness(spec, r) {
  const { rb, apt, z: z2 } = spec;
  const at = Math.acos(Math.min(1, rb / r));
  return Math.PI / (2 * z2) - inv(apt) + inv(at);
}
function polar(r, a) {
  return [r * Math.cos(a), r * Math.sin(a)];
}
function signedArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    a += x1 * y2 - y1 * x2;
  }
  return a / 2;
}
function ensureWinding(ring, ccw) {
  const area2 = signedArea(ring);
  if (ccw && area2 < 0 || !ccw && area2 > 0) ring.reverse();
  return ring;
}
function budgetFor(z2, quality) {
  if (quality === "preview") {
    const f2 = Math.max(3, Math.min(7, Math.floor(2200 / Math.max(z2, 1) / 4)));
    return { flank: f2, tipArc: Math.max(2, Math.floor(f2 / 2)), rootArc: Math.max(3, Math.floor(360 / z2 / 3) + 2) };
  }
  const f = Math.max(6, Math.min(48, Math.floor(28e3 / Math.max(z2, 1) / 4)));
  return { flank: f, tipArc: Math.max(5, Math.floor(f / 1.2)), rootArc: Math.max(6, Math.floor(1440 / z2 / 3) + 4) };
}
function externalOutline(spec, b, cx = 0, cy = 0) {
  const { z: z2, rb, rTip, rRoot } = spec;
  const pitch = TAU / z2;
  const ring = [];
  const radialBelow = rRoot < rb;
  const rFlankStart = Math.max(rRoot, rb);
  const u0 = uAtRadius(rb, rFlankStart);
  const u1 = uAtRadius(rb, rTip);
  const us = linspace(u0, u1, b.flank + 1);
  const half = (u) => {
    const r = rb * Math.sqrt(1 + u * u);
    return externalHalfThickness(spec, r);
  };
  const halfBase = Math.PI / (2 * z2) + 2 * spec.X * Math.tan(spec.apt) / z2 + inv(spec.apt);
  const halfTip = half(u1);
  for (let k = 0; k < z2; k++) {
    const c = k * pitch;
    if (radialBelow) ring.push(polar(rRoot, c - halfBase));
    for (const u of us) ring.push(polar(rb * Math.sqrt(1 + u * u), c - half(u)));
    appendArc(ring, rTip, c - halfTip, c + halfTip, b.tipArc, cx, cy);
    for (let i = us.length - 1; i >= 0; i--) {
      const u = us[i];
      ring.push(polar(rb * Math.sqrt(1 + u * u), c + half(u)));
    }
    if (radialBelow) ring.push(polar(rRoot, c + halfBase));
    const gapA0 = c + (radialBelow ? halfBase : half(u0));
    const gapA1 = c + pitch - (radialBelow ? halfBase : half(u0));
    appendArc(ring, rRoot, gapA0, gapA1, b.rootArc, cx, cy);
  }
  return ensureWinding(dedupeRing(ring), true);
}
function appendArc(ring, r, a0, a1, seg, cx, cy) {
  for (let i = 1; i <= seg; i++) {
    const a = a0 + (a1 - a0) * i / seg;
    ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
}
function internalToothRing(spec, b, cx = 0, cy = 0) {
  const { z: z2, rb, m: mod, rp } = spec;
  const pitch = TAU / z2;
  const rTip = rp - mod;
  const rGap = rp + 1.25 * mod;
  const radialBelow = rTip < rb;
  const rFlankStart = Math.max(rTip, rb);
  const u0 = uAtRadius(rb, rFlankStart);
  const u1 = uAtRadius(rb, rGap);
  const us = linspace(u0, u1, b.flank + 1);
  const half = (u) => {
    const r = rb * Math.sqrt(1 + u * u);
    return internalHalfThickness(spec, r);
  };
  const halfBase = Math.PI / (2 * z2) - inv(spec.apt);
  const halfTip = radialBelow ? halfBase : half(u0);
  const halfGap = half(u1);
  const ring = [];
  for (let k = 0; k < z2; k++) {
    const c = k * pitch;
    appendArc(ring, rTip, c - halfTip, c + halfTip, Math.max(1, b.tipArc), cx, cy);
    for (const u of us) ring.push(polar(rb * Math.sqrt(1 + u * u), c + half(u)));
    appendArc(ring, rGap, c + halfGap, c + pitch - halfGap, Math.max(1, b.rootArc), cx, cy);
    for (let i = us.length - 1; i >= 0; i--) {
      const u = us[i];
      ring.push(polar(rb * Math.sqrt(1 + u * u), c + pitch - half(u)));
    }
  }
  return ensureWinding(dedupeRing(ring), true);
}
function nonStandardInternalHole(spec, b) {
  const { z: z2, rb, m: mod, rp } = spec;
  const pitch = TAU / z2;
  const rhoRoot = rp + 1.25 * mod;
  const rhoTip = rp - mod;
  const e = rhoRoot + rhoTip;
  let u1 = uAtRadius(rb, rhoRoot);
  const half = (u) => externalHalfThickness(spec, rb * Math.sqrt(1 + u * u));
  if (half(u1) < 0) {
    let lo = 0, hi = u1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (half(mid) > 0) lo = mid;
      else hi = mid;
    }
    u1 = lo;
  }
  const us = linspace(0, u1, b.flank + 1);
  const halfTip = half(u1);
  const tipSeg = halfTip > 1e-6 ? b.tipArc : 0;
  const wedge = [[0, 0]];
  for (const u of us) wedge.push(polar(rb * Math.sqrt(1 + u * u), -half(u)));
  if (tipSeg > 0) appendArc(wedge, rhoRoot, -halfTip, halfTip, tipSeg, 0, 0);
  else if (halfTip <= 1e-6) wedge.push(polar(rb * Math.sqrt(1 + u1 * u1), 0));
  for (let i = us.length - 1; i >= 0; i--) {
    const u = us[i];
    wedge.push(polar(rb * Math.sqrt(1 + u * u), half(u)));
  }
  const wedgeT = wedge.map(([x, y]) => [x - e, y]);
  const nPerTooth = Math.max(8, 2 * b.flank + b.tipArc + 3);
  const ring = [];
  for (let k = 0; k < z2; k++) {
    const axis = Math.PI + k * pitch;
    for (let j = 0; j <= nPerTooth; j++) {
      const psi = -pitch / 2 + pitch * j / nPerTooth;
      const phi = axis + psi;
      const lx = -Math.cos(psi), ly = -Math.sin(psi);
      const t = rayNearest(lx, ly, wedgeT, rhoRoot);
      ring.push([t * Math.cos(phi), t * Math.sin(phi)]);
    }
  }
  return ensureWinding(dedupeRing(ring), true);
}
function rayNearest(dx, dy, poly, fallback) {
  let tMin = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const vx = bx - ax, vy = by - ay;
    const det = vx * dy - dx * vy;
    if (Math.abs(det) < 1e-14) continue;
    const t = (vx * ay - vy * ax) / det;
    const s = (dx * ay - dy * ax) / det;
    if (t >= 1e-9 && s >= -1e-9 && s <= 1 + 1e-9 && t < tMin) tMin = t;
  }
  return tMin === Infinity ? fallback : Math.min(tMin, fallback);
}
function circleRing(r, segments, cx = 0, cy = 0, a0 = 0, a1 = TAU) {
  const full = Math.abs(a1 - a0) >= TAU - 1e-9;
  const ring = [];
  const n = full ? segments : segments + 1;
  for (let i = 0; i < n; i++) {
    const a = a0 + (a1 - a0) * i / segments;
    ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return ring;
}
function dedupeRing(ring) {
  const out = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-8) out.push(p);
  }
  if (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-8) out.pop();
  }
  return out;
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// node_modules/earcut/src/earcut.js
var steiners = /* @__PURE__ */ new Set();
var filteredOut = false;
function earcut(data, holeIndices, dim = 2) {
  const hasHoles = holeIndices && holeIndices.length;
  const outerLen = hasHoles ? holeIndices[0] * dim : data.length;
  if (steiners.size) steiners.clear();
  let outerNode = linkedList(data, 0, outerLen, dim, true);
  const triangles = [];
  if (!outerNode || outerNode.next === outerNode.prev) return triangles;
  let minX = 0, minY = 0, invSize = 0;
  if (hasHoles) outerNode = eliminateHoles(data, holeIndices, outerNode, dim);
  if (data.length > 80 * dim) {
    minX = data[0];
    minY = data[1];
    let maxX = minX;
    let maxY = minY;
    for (let i = dim; i < outerLen; i += dim) {
      const x = data[i];
      const y = data[i + 1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    invSize = Math.max(maxX - minX, maxY - minY);
    invSize = invSize !== 0 ? 32767 / invSize : 0;
  }
  earcutLinked(outerNode, triangles, minX, minY, invSize);
  return triangles;
}
function linkedList(data, start, end, dim, clockwise) {
  let last = null;
  if (clockwise === signedArea2(data, start, end, dim) > 0) {
    for (let i = start; i < end; i += dim) last = insertNode(i / dim | 0, data[i], data[i + 1], last);
  } else {
    for (let i = end - dim; i >= start; i -= dim) last = insertNode(i / dim | 0, data[i], data[i + 1], last);
  }
  if (last && equals(last, last.next)) {
    removeNode(last);
    last = last.next;
  }
  return last;
}
function filterPoints(start, end = start) {
  const full = end === start;
  let p = start, again;
  do {
    again = false;
    if (p !== p.next && (steiners.size === 0 || !steiners.has(p)) && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
      if (full || p === end) end = p.prev;
      filteredOut = true;
      removeNode(p);
      p = p.prev;
      again = true;
    } else if (full || p !== end) {
      p = p.next;
      again = !full;
    }
  } while (again || p !== end);
  return end;
}
function earcutLinked(ear, triangles, minX, minY, invSize) {
  if (invSize) indexCurve(ear, minX, minY, invSize);
  let stop = ear, cured = false;
  while (ear.prev !== ear.next) {
    const prev = ear.prev;
    const next = ear.next;
    if (area(prev, ear, next) < 0 && (invSize ? isEarHashed(ear, minX, minY, invSize) : isEar(ear))) {
      triangles.push(prev.i, ear.i, next.i);
      removeNode(ear);
      ear = next;
      stop = next;
      continue;
    }
    ear = next;
    if (ear === stop) {
      filteredOut = false;
      ear = filterPoints(ear);
      if (filteredOut) {
        stop = ear;
        continue;
      }
      if (!cured) {
        ear = cureLocalIntersections(ear, triangles);
        stop = ear;
        cured = true;
        continue;
      }
      splitEarcut(ear, triangles, minX, minY, invSize);
      break;
    }
  }
}
function isEar(ear) {
  const a = ear.prev, b = ear, c = ear.next, ax = a.x, bx = b.x, cx = c.x, ay = a.y, by = b.y, cy = c.y, x0 = Math.min(ax, bx, cx), y0 = Math.min(ay, by, cy), x1 = Math.max(ax, bx, cx), y1 = Math.max(ay, by, cy);
  let p = c.next;
  while (p !== a) {
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && !(ax === p.x && ay === p.y) && pointInTriangle(ax, ay, bx, by, cx, cy, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
    p = p.next;
  }
  return true;
}
function isEarHashed(ear, minX, minY, invSize) {
  const a = ear.prev, b = ear, c = ear.next, ax = a.x, bx = b.x, cx = c.x, ay = a.y, by = b.y, cy = c.y, x0 = Math.min(ax, bx, cx), y0 = Math.min(ay, by, cy), x1 = Math.max(ax, bx, cx), y1 = Math.max(ay, by, cy), minZ = zOrder(x0, y0, minX, minY, invSize), maxZ = zOrder(x1, y1, minX, minY, invSize);
  let p = ear.prevZ;
  while (p && p.z >= minZ) {
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && p !== c && !(ax === p.x && ay === p.y) && pointInTriangle(ax, ay, bx, by, cx, cy, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
    p = p.prevZ;
  }
  let n = ear.nextZ;
  while (n && n.z <= maxZ) {
    if (n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1 && n !== c && !(ax === n.x && ay === n.y) && pointInTriangle(ax, ay, bx, by, cx, cy, n.x, n.y) && area(n.prev, n, n.next) >= 0) return false;
    n = n.nextZ;
  }
  return true;
}
function cureLocalIntersections(start, triangles) {
  let p = start;
  let cured = false;
  do {
    const a = p.prev, b = p.next.next;
    if (intersects(a, p, p.next, b, false) && locallyInside(a, b) && locallyInside(b, a)) {
      triangles.push(a.i, p.i, b.i);
      removeNode(p);
      removeNode(p.next);
      p = start = b;
      cured = true;
    }
    p = p.next;
  } while (p !== start);
  return cured ? filterPoints(p) : p;
}
function splitEarcut(start, triangles, minX, minY, invSize) {
  let a = start;
  do {
    let b = a.next.next;
    while (b !== a.prev) {
      if (a.i !== b.i && isValidDiagonal(a, b)) {
        let c = splitPolygon(a, b);
        a = filterPoints(a, a.next);
        c = filterPoints(c, c.next);
        earcutLinked(a, triangles, minX, minY, invSize);
        earcutLinked(c, triangles, minX, minY, invSize);
        return;
      }
      b = b.next;
    }
    a = a.next;
  } while (a !== start);
}
var indexActive = false;
function eliminateHoles(data, holeIndices, outerNode, dim) {
  const queue = [];
  for (let i = 0, len = holeIndices.length; i < len; i++) {
    const start = holeIndices[i] * dim;
    const end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
    const list = (
      /** @type {Node} */
      linkedList(data, start, end, dim, false)
    );
    if (list === list.next) steiners.add(list);
    queue.push(getLeftmost(list));
  }
  queue.sort(compareXYSlope);
  buildBlockIndex(data.length / dim, holeIndices.length);
  indexSegment(outerNode, outerNode);
  indexActive = true;
  for (let i = 0; i < queue.length; i++) {
    outerNode = eliminateHole(queue[i], outerNode);
  }
  indexActive = false;
  return filterPoints(outerNode);
}
function compareXYSlope(a, b) {
  return a.x - b.x || a.y - b.y || (a.next.y - a.y) / (a.next.x - a.x) - (b.next.y - b.y) / (b.next.x - b.x);
}
function eliminateHole(hole, outerNode) {
  const bridge = findHoleBridge(hole, outerNode);
  if (!bridge) {
    return outerNode;
  }
  const bridgeReverse = splitPolygon(bridge, hole);
  const bridge2 = bridgeReverse.next;
  indexSegment(bridge, bridge2.next);
  filterPoints(bridgeReverse, bridgeReverse.next);
  return filterPoints(bridge, bridge.next);
}
var K = 16;
var blockBBox = new Float64Array(0);
var numBlocks = 0;
var blockHead = [];
var blockStop = [];
function buildBlockIndex(maxNodes, numHoles) {
  const maxBlocks = Math.ceil((maxNodes + 2 * numHoles) / K) + numHoles + 2;
  if (blockBBox.length < maxBlocks * 4) blockBBox = new Float64Array(maxBlocks * 4);
  numBlocks = 0;
}
function indexSegment(head, stop) {
  let p = head;
  do {
    const b = numBlocks++;
    blockHead[b] = p;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let k = 0;
    do {
      const c = p.next;
      p.z = b;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      if (c.x < minX) minX = c.x;
      if (c.x > maxX) maxX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.y > maxY) maxY = c.y;
      p = c;
    } while (++k < K && p !== stop);
    blockStop[b] = p;
    const g = b * 4;
    blockBBox[g] = minX;
    blockBBox[g + 1] = minY;
    blockBBox[g + 2] = maxX;
    blockBBox[g + 3] = maxY;
  } while (p !== stop);
}
function growBlock(head, tail) {
  const g = head.z * 4;
  if (tail.x < blockBBox[g]) blockBBox[g] = tail.x;
  if (tail.y < blockBBox[g + 1]) blockBBox[g + 1] = tail.y;
  if (tail.x > blockBBox[g + 2]) blockBBox[g + 2] = tail.x;
  if (tail.y > blockBBox[g + 3]) blockBBox[g + 3] = tail.y;
}
function liveBlockStop(b) {
  let stop = blockStop[b];
  while (stop.prev.next !== stop) stop = stop.next;
  blockStop[b] = stop;
  return stop;
}
function liveBlockHead(b) {
  let head = blockHead[b];
  while (head.prev.next !== head) head = head.next;
  blockHead[b] = head;
  return head;
}
function findHoleBridge(hole, outerNode) {
  let p = outerNode;
  const hx = hole.x;
  const hy = hole.y;
  let qx = -Infinity;
  let m2;
  if (equals(hole, p)) return p;
  for (let b = 0, g = 0; b < numBlocks; b++, g += 4) {
    if (hy < blockBBox[g + 1] || hy > blockBBox[g + 3] || blockBBox[g] > hx || blockBBox[g + 2] <= qx) continue;
    const stop = liveBlockStop(b);
    p = liveBlockHead(b);
    do {
      if (p.prev.next === p) {
        if (equals(hole, p.next)) return p.next;
        else if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
          const x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y);
          if (x <= hx && x > qx) {
            qx = x;
            m2 = p.x < p.next.x ? p : p.next;
            if (x === hx) return m2;
          }
        }
      }
      p = p.next;
    } while (p !== stop);
  }
  if (!m2) return null;
  const mx = m2.x;
  const my = m2.y;
  const tminY = Math.min(hy, my);
  const tmaxY = Math.max(hy, my);
  let tanMin = Infinity;
  for (let b = 0, g = 0; b < numBlocks; b++, g += 4) {
    if (blockBBox[g + 2] < mx || blockBBox[g] > hx || blockBBox[g + 3] < tminY || blockBBox[g + 1] > tmaxY) continue;
    const stop = liveBlockStop(b);
    p = liveBlockHead(b);
    do {
      if (p.prev.next === p && hx >= p.x && p.x >= mx && hx !== p.x && // skip dead nodes
      pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
        const tan = Math.abs(hy - p.y) / (hx - p.x);
        if ((locallyInside(p, hole) || p.y === hy && p.next.y === hy && p.next.x > hx) && (tan < tanMin || tan === tanMin && (p.x > m2.x || p.x === m2.x && sectorContainsSector(m2, p)))) {
          m2 = p;
          tanMin = tan;
        }
      }
      p = p.next;
    } while (p !== stop);
  }
  return m2;
}
function sectorContainsSector(m2, p) {
  return area(m2.prev, m2, p.prev) < 0 && area(p.next, m2, m2.next) < 0;
}
var sortArr = [];
var sortBuf = [];
var zArr = new Uint32Array(0);
var zBuf = new Uint32Array(0);
var counts = new Uint32Array(256);
function indexCurve(start, minX, minY, invSize) {
  let p = start;
  let n = 0;
  do {
    p.z = zOrder(p.x, p.y, minX, minY, invSize);
    sortArr[n++] = p;
    p = p.next;
  } while (p !== start);
  sortNodes(n);
  let prev = null;
  for (let i = 0; i < n; i++) {
    const node = sortArr[i];
    node.prevZ = prev;
    if (prev) prev.nextZ = node;
    prev = node;
  }
  prev.nextZ = null;
}
function sortNodes(n) {
  if (n <= 32) {
    for (let i = 1; i < n; i++) {
      const node = sortArr[i], z2 = node.z;
      let j = i - 1;
      while (j >= 0 && sortArr[j].z > z2) {
        sortArr[j + 1] = sortArr[j];
        j--;
      }
      sortArr[j + 1] = node;
    }
    return;
  }
  if (zArr.length < n) {
    zArr = new Uint32Array(n);
    zBuf = new Uint32Array(n);
    sortBuf = new Array(n);
  }
  for (let i = 0; i < n; i++) zArr[i] = sortArr[i].z;
  radixPass(n, sortArr, zArr, sortBuf, zBuf, 0);
  radixPass(n, sortBuf, zBuf, sortArr, zArr, 8);
  radixPass(n, sortArr, zArr, sortBuf, zBuf, 16);
  radixPass(n, sortBuf, zBuf, sortArr, zArr, 24);
}
function radixPass(n, src, srcZ, dst, dstZ, shift) {
  counts.fill(0);
  for (let i = 0; i < n; i++) counts[srcZ[i] >>> shift & 255]++;
  let sum = 0;
  for (let b = 0; b < 256; b++) {
    const c = counts[b];
    counts[b] = sum;
    sum += c;
  }
  for (let i = 0; i < n; i++) {
    const z2 = srcZ[i];
    const pos = counts[z2 >>> shift & 255]++;
    dst[pos] = src[i];
    dstZ[pos] = z2;
  }
}
function zOrder(x, y, minX, minY, invSize) {
  x = (x - minX) * invSize | 0;
  y = (y - minY) * invSize | 0;
  x = (x | x << 8) & 16711935;
  x = (x | x << 4) & 252645135;
  x = (x | x << 2) & 858993459;
  x = (x | x << 1) & 1431655765;
  y = (y | y << 8) & 16711935;
  y = (y | y << 4) & 252645135;
  y = (y | y << 2) & 858993459;
  y = (y | y << 1) & 1431655765;
  return x | y << 1;
}
function getLeftmost(start) {
  let p = start, leftmost = start;
  do {
    if (p.x < leftmost.x || p.x === leftmost.x && p.y < leftmost.y) leftmost = p;
    p = p.next;
  } while (p !== start);
  return leftmost;
}
function pointInTriangle(ax, ay, bx, by, cx, cy, px, py) {
  return (cx - px) * (ay - py) >= (ax - px) * (cy - py) && (ax - px) * (by - py) >= (bx - px) * (ay - py) && (bx - px) * (cy - py) >= (cx - px) * (by - py);
}
function isValidDiagonal(a, b) {
  const zeroLength = equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0;
  return a.next.i !== b.i && (zeroLength || locallyInside(a, b) && locallyInside(b, a) && // // locally visible
  (area(a.prev, a, b.prev) !== 0 || area(a, b.prev, b) !== 0)) && // no opposite-facing sectors
  !intersectsPolygon(a, b) && (zeroLength || middleInside(a, b));
}
function area(p, q, r) {
  return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
}
function equals(p1, p2) {
  return p1.x === p2.x && p1.y === p2.y;
}
function intersects(p1, q1, p2, q2, includeBoundary = true) {
  const o1 = area(p1, q1, p2);
  const o2 = area(p1, q1, q2);
  const o3 = area(p2, q2, p1);
  const o4 = area(p2, q2, q1);
  if ((o1 > 0 && o2 < 0 || o1 < 0 && o2 > 0) && (o3 > 0 && o4 < 0 || o3 < 0 && o4 > 0)) return true;
  if (!includeBoundary) return false;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}
function onSegment(p, q, r) {
  return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
}
function intersectsPolygon(a, b) {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  let p = a;
  do {
    const n = p.next;
    if (p.x > maxX && n.x > maxX || p.x < minX && n.x < minX || p.y > maxY && n.y > maxY || p.y < minY && n.y < minY) {
      p = n;
      continue;
    }
    if (p.i !== a.i && n.i !== a.i && p.i !== b.i && n.i !== b.i && intersects(p, n, a, b)) return true;
    p = n;
  } while (p !== a);
  return false;
}
function locallyInside(a, b) {
  return area(a.prev, a, a.next) < 0 ? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0 : area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
}
function middleInside(a, b) {
  let p = a;
  let inside = false;
  const px = (a.x + b.x) / 2;
  const py = (a.y + b.y) / 2;
  do {
    const n = p.next;
    if (p.y > py !== n.y > py && px < (n.x - p.x) * (py - p.y) / (n.y - p.y) + p.x)
      inside = !inside;
    p = n;
  } while (p !== a);
  return inside;
}
function splitPolygon(a, b) {
  const a2 = createNode(a.i, a.x, a.y), b2 = createNode(b.i, b.x, b.y), an = a.next, bp = b.prev;
  a.next = b;
  b.prev = a;
  a2.next = an;
  an.prev = a2;
  b2.next = a2;
  a2.prev = b2;
  bp.next = b2;
  b2.prev = bp;
  return b2;
}
function insertNode(i, x, y, last) {
  const p = createNode(i, x, y);
  if (!last) {
    p.prev = p;
    p.next = p;
  } else {
    p.next = last.next;
    p.prev = last;
    last.next.prev = p;
    last.next = p;
  }
  return p;
}
function removeNode(p) {
  p.next.prev = p.prev;
  p.prev.next = p.next;
  if (p.prevZ) p.prevZ.nextZ = p.nextZ;
  if (p.nextZ) p.nextZ.prevZ = p.prevZ;
  if (indexActive) growBlock(p.prev, p.next);
}
function createNode(i, x, y) {
  return (
    /** @type {Node} */
    /** @type {unknown} */
    {
      i,
      // vertex index in coordinates array
      x,
      y,
      // vertex coordinates
      prev: null,
      // previous and next vertex nodes in a polygon ring
      next: null,
      z: 0,
      // z-order curve value; doubles as owning block in the hole-bridge index during eliminateHoles
      prevZ: null,
      // previous and next nodes in z-order
      nextZ: null
    }
  );
}
function signedArea2(data, start, end, dim) {
  let sum = 0;
  for (let i = start, j = end - dim; i < end; i += dim) {
    sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]);
    j = i;
  }
  return sum;
}

// src/gear/mesh/MeshData.ts
var MeshData = class {
  positions = [];
  indices = [];
  /** 可选的面片分组名（导出 STEP 时可作为独立实体），与 indices 平行区段对应 */
  parts = [];
  vertex(x, y, z2) {
    const i = this.positions.length / 3;
    this.positions.push(x, y, z2);
    return i;
  }
  tri(a, b, c) {
    this.indices.push(a, b, c);
  }
  quad(a, b, c, d) {
    this.indices.push(a, b, c, a, c, d);
  }
  beginPart(name) {
    this.parts.push({ name, start: this.indices.length, count: 0 });
  }
  endPart() {
    const p = this.parts[this.parts.length - 1];
    if (p) p.count = this.indices.length - p.start;
  }
  get triangleCount() {
    return this.indices.length / 3;
  }
  get vertexCount() {
    return this.positions.length / 3;
  }
  /** 原地变换所有顶点（用于坐标系调整） */
  transform(fn) {
    for (let i = 0; i < this.positions.length; i += 3) {
      const [x, y, z2] = fn(this.positions[i], this.positions[i + 1], this.positions[i + 2]);
      this.positions[i] = x;
      this.positions[i + 1] = y;
      this.positions[i + 2] = z2;
    }
  }
  /** 合并另一个网格，可施加顶点变换（返回新坐标）。 */
  merge(other, transform) {
    const vBase = this.positions.length / 3;
    const iBase = this.indices.length;
    for (let i = 0; i < other.positions.length; i += 3) {
      let x = other.positions[i];
      let y = other.positions[i + 1];
      let z2 = other.positions[i + 2];
      if (transform) [x, y, z2] = transform(x, y, z2);
      this.positions.push(x, y, z2);
    }
    for (const idx of other.indices) this.indices.push(idx + vBase);
    for (const p of other.parts) {
      this.parts.push({ name: p.name, start: iBase + p.start, count: p.count });
    }
  }
  /** 轴对齐包围盒中心与尺寸，供相机取景 */
  bounds() {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.positions.length; i += 3) {
      const x = this.positions[i], y = this.positions[i + 1], z2 = this.positions[i + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z2 < minZ) minZ = z2;
      if (z2 > maxZ) maxZ = z2;
    }
    return {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
      size: [maxX - minX, maxY - minY, maxZ - minZ]
    };
  }
};

// src/gear/mesh/builder.ts
function extrudeSections(sections, partName) {
  const mesh2 = new MeshData();
  if (partName) mesh2.beginPart(partName);
  const layers = sections.map((sec) => {
    const rings = [sec.outer, ...sec.holes];
    const data = [];
    const holeStarts = [];
    for (let ri = 0; ri < rings.length; ri++) {
      if (ri > 0) holeStarts.push(data.length / 2);
      for (const [x, y] of rings[ri]) data.push(x, y);
    }
    const tris = earcut(data, holeStarts);
    const base = mesh2.positions.length / 3;
    for (let i = 0; i < data.length; i += 2) mesh2.vertex(data[i], data[i + 1], sec.z);
    return { base, rings, tris };
  });
  for (let j = 0; j < layers.length - 1; j++) {
    const lo = layers[j];
    const hi = layers[j + 1];
    for (let ri = 0; ri < lo.rings.length; ri++) {
      const rb = lo.rings[ri];
      const rt = hi.rings[ri];
      const n = Math.min(rb.length, rt.length);
      for (let i = 0; i < n; i++) {
        const a = lo.base + ringOffset(lo.rings, ri) + i;
        const b = lo.base + ringOffset(lo.rings, ri) + (i + 1) % n;
        const c = hi.base + ringOffset(hi.rings, ri) + (i + 1) % n;
        const d = hi.base + ringOffset(hi.rings, ri) + i;
        mesh2.quad(a, b, c, d);
      }
    }
  }
  if (layers.length) {
    const bottom = layers[0];
    for (let i = 0; i < bottom.tris.length; i += 3) {
      mesh2.tri(bottom.base + bottom.tris[i], bottom.base + bottom.tris[i + 2], bottom.base + bottom.tris[i + 1]);
    }
    const top = layers[layers.length - 1];
    for (let i = 0; i < top.tris.length; i += 3) {
      mesh2.tri(top.base + top.tris[i], top.base + top.tris[i + 1], top.base + top.tris[i + 2]);
    }
  }
  if (partName) mesh2.endPart();
  return mesh2;
}
function ringOffset(rings, ri) {
  let off = 0;
  for (let k = 0; k < ri; k++) off += rings[k].length;
  return off;
}
function rotateRing(ring, angle, cx = 0, cy = 0) {
  const s = Math.sin(angle), c = Math.cos(angle);
  return ring.map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    return [cx + dx * c - dy * s, cy + dx * s + dy * c];
  });
}
function twistedExtrude(sectionFactory, cfg2, partName) {
  const n = Math.max(2, cfg2.layers);
  const sections = [];
  for (let j = 0; j < n; j++) {
    const t = j / (n - 1);
    let twist;
    if (cfg2.doubleHelical) {
      twist = t <= 0.5 ? cfg2.totalTwist * t : cfg2.totalTwist * (1 - t);
    } else {
      twist = cfg2.totalTwist * t;
    }
    const s = sectionFactory(twist);
    sections.push({ z: cfg2.height * t, outer: s.outer, holes: s.holes });
  }
  return extrudeSections(sections, partName);
}

// src/gear/geometry/cylindrical.ts
function layerCount(totalTwist, quality, minLayers = 2) {
  if (Math.abs(totalTwist) < 1e-6) return Math.max(2, minLayers);
  const tol = degToRad(quality === "preview" ? 10 : 1.5);
  const max = quality === "preview" ? 40 : 300;
  return clamp(Math.max(Math.ceil(Math.abs(totalTwist) / tol) + 1, minLayers), 2, max);
}
function buildCylindricalGear(o) {
  const ah = degToRad(o.helixAngleDeg ?? 0);
  const spec = computeInvolute({
    m: o.m,
    z: o.z,
    pressureAngle: degToRad(o.pressureAngleDeg),
    helixAngle: ah,
    X: o.X ?? 0,
    normalSystem: o.normalSystem ?? false
  });
  const budget = budgetFor(o.z, o.quality);
  const baseOutline = o.internal ? o.nonStandard ? nonStandardInternalHole(spec, budget) : internalToothRing(spec, budget) : externalOutline(spec, budget);
  if (o.internal) ensureWinding(baseOutline, false);
  const outerRimR = spec.rp + o.m + (o.rimThickness ?? 5);
  const rimSeg = Math.max(48, clamp(o.z * budget.rootArc * 2, 64, 1024));
  const rim2 = circleRing(outerRimR, rimSeg);
  const totalTwist = helixTwist(spec, ah, o.height, o.cw ?? false);
  const layers = layerCount(totalTwist, o.quality, o.minLayers);
  const mesh2 = twistedExtrude(
    (twist) => {
      const toothRing = rotateRing(baseOutline, twist);
      if (o.internal) {
        return { outer: rim2, holes: [toothRing] };
      }
      return { outer: toothRing, holes: [] };
    },
    { height: o.height, totalTwist, layers, doubleHelical: o.doubleHelical ?? false },
    o.internal ? "internal-gear" : "gear"
  );
  centerZ(mesh2, o.height);
  return mesh2;
}
function centerZ(mesh2, height2) {
  for (let i = 2; i < mesh2.positions.length; i += 3) mesh2.positions[i] -= height2 / 2;
}

// src/composables/useSceneLighting.ts
var LIGHT_PRESET = {
  sceneBg: 14738924,
  fogNear: 400,
  fogFar: 1400,
  hemiSky: 16777215,
  hemiGround: 12831962,
  hemiIntensity: 1.35,
  ambientColor: 16777215,
  ambientIntensity: 0.25,
  keyColor: 16777215,
  keyIntensity: 1.5,
  keyPosition: [120, 160, 90],
  rim1Color: 15244725,
  rim1Intensity: 0.35,
  rim1Position: [-120, 40, -100],
  rim2Color: 9418984,
  rim2Intensity: 0.3,
  rim2Position: [40, -80, 60],
  gridColor1: 11976910,
  gridColor2: 13818338,
  gridOpacity: 0.4,
  matColor: 11450824,
  matMetalness: 0.18,
  matRoughness: 0.62
};
var DARK_PRESET = {
  sceneBg: 1711393,
  fogNear: 500,
  fogFar: 1600,
  hemiSky: 7043981,
  hemiGround: 2764864,
  hemiIntensity: 1.1,
  ambientColor: 16777215,
  ambientIntensity: 0.3,
  keyColor: 16777215,
  keyIntensity: 1.8,
  keyPosition: [120, 160, 90],
  rim1Color: 16754112,
  rim1Intensity: 0.55,
  rim1Position: [-120, 40, -100],
  rim2Color: 8301279,
  rim2Intensity: 0.45,
  rim2Position: [40, -80, 60],
  gridColor1: 3817545,
  gridColor2: 2962234,
  gridOpacity: 0.3,
  matColor: 13160668,
  matMetalness: 0.22,
  matRoughness: 0.5
};
function getSceneLightingForBg(bg) {
  const r = parseInt(bg.substring(1, 3), 16);
  return r < 100 ? DARK_PRESET : LIGHT_PRESET;
}

// tmp-render.ts
var m = 3;
var z = 17;
var paDeg = 20;
var height = 10;
var rim = 5;
var mesh = buildCylindricalGear({ m, z, pressureAngleDeg: paDeg, height, rimThickness: rim, quality: "high", internal: true });
mesh.transform((x, y, z2) => [x, z2, -y]);
var cfg = getSceneLightingForBg("#e0e5ec");
var keyPos = cfg.keyPosition;
console.log("\u5149\u7167\u914D\u7F6E: keyPosition=", keyPos, "keyIntensity=", cfg.keyIntensity, "matColor=", cfg.matColor.toString(16));
var P = mesh.positions;
var I = mesh.indices;
var bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < P.length; i += 3) {
  for (let k = 0; k < 3; k++) {
    if (P[i + k] < bb.min[k]) bb.min[k] = P[i + k];
    if (P[i + k] > bb.max[k]) bb.max[k] = P[i + k];
  }
}
var size = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
var radius = Math.max(...size) / 2;
var fov = 45 * Math.PI / 180;
var dist = radius / Math.sin(fov / 2) * 0.85;
console.log(`radius=${radius.toFixed(1)} dist=${dist.toFixed(1)}`);
function norm(v) {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function render(name, camPos, upHint) {
  const target = [0, 0, 0];
  const fwd = norm(sub(target, camPos));
  const right = norm(cross(fwd, upHint));
  const up = cross(right, fwd);
  const f = 300 / Math.tan(fov / 2);
  const N = P.length / 3;
  const vx = new Float64Array(N), vy = new Float64Array(N), vz = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const v = [P[i * 3] - camPos[0], P[i * 3 + 1] - camPos[1], P[i * 3 + 2] - camPos[2]];
    vx[i] = dot(v, right);
    vy[i] = dot(v, up);
    vz[i] = dot(v, fwd);
  }
  const tris = [];
  const L = norm(keyPos);
  const camDir = norm(camPos);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const pa = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]];
    const pb = [P[b * 3], P[b * 3 + 1], P[b * 3 + 2]];
    const pc = [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]];
    let n = cross(sub(pb, pa), sub(pc, pa));
    const nl = Math.hypot(...n) || 1;
    n = [n[0] / nl, n[1] / nl, n[2] / nl];
    if (dot(n, camDir) < 0) n = [-n[0], -n[1], -n[2]];
    const centroid = [(pa[0] + pb[0] + pc[0]) / 3, (pa[1] + pb[1] + pc[1]) / 3, (pa[2] + pb[2] + pc[2]) / 3];
    const depth = dot(sub(centroid, camPos), fwd);
    const lambert = Math.max(0, dot(n, L));
    const hemi = 0.5 + 0.5 * n[1];
    const shade = Math.min(1, 0.25 + 0.25 * hemi + 0.75 * lambert);
    tris.push({ idx: t, depth, shade });
  }
  tris.sort((p, q) => q.depth - p.depth);
  const W = 600;
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (let i = 0; i < N; i++) {
    if (vz[i] <= 0) continue;
    const sx = W / 2 + vx[i] / vz[i] * f, sy = W / 2 - vy[i] / vz[i] * f;
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  }
  console.log(`[${name}] \u6295\u5F71\u5305\u56F4\u76D2: x [${minX.toFixed(0)}, ${maxX.toFixed(0)}], y [${minY.toFixed(0)}, ${maxY.toFixed(0)}]`);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}"><rect width="${W}" height="${W}" fill="#e0e5ec"/>`;
  for (const tr of tris) {
    const a = I[tr.idx], b = I[tr.idx + 1], c = I[tr.idx + 2];
    const sx = (i) => (W / 2 + vx[i] / vz[i] * f).toFixed(1);
    const sy = (i) => (W / 2 - vy[i] / vz[i] * f).toFixed(1);
    const g = Math.round(tr.shade * 255);
    svg += `<polygon points="${sx(a)},${sy(a)} ${sx(b)},${sy(b)} ${sx(c)},${sy(c)}" fill="rgb(${g},${g},${g})" stroke="none"/>`;
  }
  svg += `</svg>`;
  return globalThis.__fs.writeFile(`tmp-out-${name}.svg`, svg);
}
globalThis.__fs = await import("fs/promises");
var d1 = norm([0.75, 0.55, 0.9]);
await render("app-view", [d1[0] * dist, d1[1] * dist, d1[2] * dist], [0, 1, 0]);
await render("axis-view", [0, dist, 0], [0, 0, -1]);
console.log("\u5DF2\u8F93\u51FA tmp-out-app.svg (app\u9ED8\u8BA4\u89C6\u89D2) \u4E0E tmp-out-axis.svg (\u6B63\u4FEF\u89C6)");
