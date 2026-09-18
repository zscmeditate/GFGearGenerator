// tmp-prof.ts
import { writeFileSync } from "fs";

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
  const { m, z: z2 } = input;
  const ah = input.helixAngle ?? 0;
  const X = input.X ?? 0;
  const normalSystem = input.normalSystem ?? false;
  let modt = m;
  let apt = input.pressureAngle;
  if (normalSystem) {
    modt = m / Math.cos(ah);
    apt = Math.atan(Math.tan(input.pressureAngle) / Math.cos(ah));
  }
  const dp = modt * z2;
  const rp2 = dp / 2;
  const db = dp * Math.cos(apt);
  const rb2 = db / 2;
  const ra = rp2 + m;
  const rf = rp2 - 1.25 * m;
  const shifted = X !== 0;
  const rva = rp2 + X * m + m;
  const rvf = rp2 + X * m - 1.25 * m;
  return {
    modt,
    apt,
    normalSystem,
    z: z2,
    m,
    X,
    dp,
    rp: rp2,
    db,
    rb: rb2,
    ra,
    rf,
    rTip: shifted ? rva : ra,
    rRoot: shifted ? rvf : rf,
    shifted
  };
}
var uAtRadius = (rb2, r) => r > rb2 ? Math.sqrt((r / rb2) ** 2 - 1) : 0;
function internalHalfThickness(spec2, r) {
  const { rb: rb2, apt, z: z2 } = spec2;
  const at = Math.acos(Math.min(1, rb2 / r));
  return Math.PI / (2 * z2) - inv(apt) + inv(at);
}
function polar(r, a) {
  return [r * Math.cos(a), r * Math.sin(a)];
}
function signedArea(ring2) {
  let a = 0;
  for (let i = 0, n = ring2.length; i < n; i++) {
    const [x1, y1] = ring2[i];
    const [x2, y2] = ring2[(i + 1) % n];
    a += x1 * y2 - y1 * x2;
  }
  return a / 2;
}
function ensureWinding(ring2, ccw) {
  const area = signedArea(ring2);
  if (ccw && area < 0 || !ccw && area > 0) ring2.reverse();
  return ring2;
}
function budgetFor(z2, quality) {
  if (quality === "preview") {
    const f2 = Math.max(3, Math.min(7, Math.floor(2200 / Math.max(z2, 1) / 4)));
    return { flank: f2, tipArc: Math.max(2, Math.floor(f2 / 2)), rootArc: Math.max(3, Math.floor(360 / z2 / 3) + 2) };
  }
  const f = Math.max(6, Math.min(48, Math.floor(28e3 / Math.max(z2, 1) / 4)));
  return { flank: f, tipArc: Math.max(5, Math.floor(f / 1.2)), rootArc: Math.max(6, Math.floor(1440 / z2 / 3) + 4) };
}
function appendArc(ring2, r, a0, a1, seg, cx2, cy2) {
  for (let i = 1; i <= seg; i++) {
    const a = a0 + (a1 - a0) * i / seg;
    ring2.push([cx2 + r * Math.cos(a), cy2 + r * Math.sin(a)]);
  }
}
function internalToothRing(spec2, b, cx2 = 0, cy2 = 0) {
  const { z: z2, rb: rb2, m: mod, rp: rp2 } = spec2;
  const pitch2 = TAU / z2;
  const rTip2 = rp2 - mod;
  const rGap2 = rp2 + 1.25 * mod;
  const radialBelow = rTip2 < rb2;
  const rFlankStart = Math.max(rTip2, rb2);
  const u0 = uAtRadius(rb2, rFlankStart);
  const u1 = uAtRadius(rb2, rGap2);
  const us = linspace(u0, u1, b.flank + 1);
  const half = (u) => {
    const r = rb2 * Math.sqrt(1 + u * u);
    return internalHalfThickness(spec2, r);
  };
  const halfBase = Math.PI / (2 * z2) - inv(spec2.apt);
  const halfTip = radialBelow ? halfBase : half(u0);
  const halfGap = half(u1);
  const ring2 = [];
  for (let k = 0; k < z2; k++) {
    const c = k * pitch2;
    appendArc(ring2, rTip2, c - halfTip, c + halfTip, Math.max(1, b.tipArc), cx2, cy2);
    for (const u of us) ring2.push(polar(rb2 * Math.sqrt(1 + u * u), c + half(u)));
    appendArc(ring2, rGap2, c + halfGap, c + pitch2 - halfGap, Math.max(1, b.rootArc), cx2, cy2);
    for (let i = us.length - 1; i >= 0; i--) {
      const u = us[i];
      ring2.push(polar(rb2 * Math.sqrt(1 + u * u), c + pitch2 - half(u)));
    }
  }
  return ensureWinding(dedupeRing(ring2), true);
}
function dedupeRing(ring2) {
  const out = [];
  for (const p of ring2) {
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

// tmp-prof.ts
var spec = computeInvolute({ m: 2, z: 20, pressureAngle: degToRad(20), X: 0 });
var ring = internalToothRing(spec, budgetFor(20, "high"));
var { z, rp, rb } = spec;
var rTip = rp - spec.m;
var rGap = rp + 1.25 * spec.m;
var pitch = Math.PI * 2 / z;
var maxAsym = 0;
for (const [x, y] of ring) {
  const mx = x, my = -y;
  let best = Infinity;
  for (const [px, py] of ring) {
    const d = Math.hypot(px - mx, py - my);
    if (d < best) best = d;
  }
  maxAsym = Math.max(maxAsym, best);
}
console.log(`points=${ring.length} rp=${rp.toFixed(3)} rb=${rb.toFixed(3)} rTip=${rTip} rGap=${rGap}`);
console.log(`mirror-asymmetry max nearest-distance = ${maxAsym.toFixed(6)} mm ${maxAsym < 0.01 ? "(\u5BF9\u79F0 OK)" : "(\u4E0D\u5BF9\u79F0!)"}`);
var tauGap = Math.PI / (2 * z) - Math.tan(spec.apt) + spec.apt + (Math.tan(Math.acos(rb / rGap)) - Math.acos(rb / rGap));
console.log(`root gap angle=${(Math.PI * 2 / z / 2 - tauGap * 0 + Math.PI / z - (Math.PI / (2 * z) - Math.tan(spec.apt) + spec.apt + (Math.tan(Math.acos(rb / rGap)) - Math.acos(rb / rGap)))).toFixed(4)} rad, arc=${((Math.PI / z - (Math.PI / (2 * z) - Math.tan(spec.apt) + spec.apt + (Math.tan(Math.acos(rb / rGap)) - Math.acos(rb / rGap)))) * 2 * rGap).toFixed(3)} mm`);
var S = 10;
var cx = 260;
var cy = 260;
var P = (p) => `${(cx + p[0] * S).toFixed(2)},${(cy - p[1] * S).toFixed(2)}`;
var svg = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="560" viewBox="0 0 560 560"><rect width="560" height="560" fill="white"/>`;
svg += `<polyline points="${ring.map(P).join(" ")}" fill="none" stroke="#1565c0" stroke-width="1.4"/>`;
for (const [r, col] of [[rp, "#e53935"], [rb, "#fb8c00"], [rTip, "#43a047"], [rGap, "#8e24aa"]]) {
  svg += `<circle cx="${cx}" cy="${cy}" r="${(r * S).toFixed(1)}" fill="none" stroke="${col}" stroke-width="0.8" stroke-dasharray="5 4" opacity="0.7"/>`;
}
svg += `<line x1="${cx}" y1="${cy}" x2="${cx + (rGap + 3) * S}" y2="${cy}" stroke="#999" stroke-width="0.7" stroke-dasharray="3 3"/>`;
svg += `</svg>`;
writeFileSync("tmp-profile.svg", svg);
console.log("SVG written: tmp-profile.svg");
