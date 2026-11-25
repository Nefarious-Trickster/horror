// Builds assets/creature.glb from the SDF anatomy in creature-def.mjs.
//   node tools/build-creature.mjs [--res 0.005]
// Pipeline: narrow-band SDF sampling -> surface nets -> projection onto the exact surface ->
// automatic bone weights from primitive ownership -> baked AO / thickness / curvature / masks -> GLB.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineCreature } from './creature-def.mjs';
import { BIG, smoothstep } from './sdf.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argRes = process.argv.indexOf('--res');
const H = argRes > 0 ? parseFloat(process.argv[argRes + 1]) : 0.005; // cell size in metres
const SCALE = 1.25;
const C = 8; // coarse block size

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const def = defineCreature();
const F = def.field;
const fExact = (x, y, z) => SCALE * F.eval(x / SCALE, y / SCALE, z / SCALE);
F.compileBuckets(0.06, 0.03);
const f = (x, y, z) => SCALE * F.evalFast(x / SCALE, y / SCALE, z / SCALE);
log(`primitives: ${F.prims.length} (+${F.post.length} carved), groups: ${F.groups.length}, bones: ${def.bones.length}`);

// ------------------------------------------------------------------ grid
const [bmn, bmx] = F.bounds();
const mn = bmn.map((v) => v * SCALE - 4 * H);
const mx = bmx.map((v) => v * SCALE + 4 * H);
const dims = [0, 1, 2].map((a) => { let n = Math.ceil((mx[a] - mn[a]) / H) + 1; n = Math.ceil((n - 1) / C) * C + 1; return n; });
const [nx, ny, nz] = dims;
log(`grid ${nx}x${ny}x${nz} = ${(nx * ny * nz / 1e6).toFixed(1)}M nodes @ ${H * 1000}mm`);
const G = new Float32Array(nx * ny * nz).fill(NaN);
const gi = (i, j, k) => i + nx * (j + ny * k);
const X = (i) => mn[0] + i * H, Y = (j) => mn[1] + j * H, Z = (k) => mn[2] + k * H;

const cnx = (nx - 1) / C + 1, cny = (ny - 1) / C + 1, cnz = (nz - 1) / C + 1;
const CG = new Float32Array(cnx * cny * cnz);
const cgi = (i, j, k) => i + cnx * (j + cny * k);
for (let k = 0; k < cnz; k++) for (let j = 0; j < cny; j++) for (let i = 0; i < cnx; i++) {
  const v = fExact(X(i * C), Y(j * C), Z(k * C));
  CG[cgi(i, j, k)] = v;
  G[gi(i * C, j * C, k * C)] = v;
}
const thr = 1.45 * C * H * Math.sqrt(3);
let evals = 0, active = 0;
for (let k = 0; k < cnz - 1; k++) for (let j = 0; j < cny - 1; j++) for (let i = 0; i < cnx - 1; i++) {
  let m = Infinity;
  for (let c = 0; c < 8; c++) m = Math.min(m, Math.abs(CG[cgi(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))]));
  if (m > thr) continue;
  active++;
  for (let kk = k * C; kk <= k * C + C; kk++) for (let jj = j * C; jj <= j * C + C; jj++) for (let ii = i * C; ii <= i * C + C; ii++) {
    const idx = gi(ii, jj, kk);
    if (Number.isNaN(G[idx])) { G[idx] = f(X(ii), Y(jj), Z(kk)); evals++; }
  }
}
for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
  const idx = gi(i, j, k);
  if (Number.isNaN(G[idx])) G[idx] = CG[cgi(Math.min(Math.floor(i / C), cnx - 2), Math.min(Math.floor(j / C), cny - 2), Math.min(Math.floor(k / C), cnz - 2))];
}
log(`narrow band: ${active} active blocks, ${(evals / 1e6).toFixed(2)}M exact samples`);

// ------------------------------------------------------------------ surface nets
const cx = nx - 1, cy = ny - 1, cz = nz - 1;
const cellVert = new Int32Array(cx * cy * cz).fill(-1);
const ci = (i, j, k) => i + cx * (j + cy * k);
const pos = [];
const EDGES = [];
for (let c = 0; c < 8; c++) for (const b of [1, 2, 4]) if (!(c & b)) EDGES.push([c, c | b]);
const val = new Float64Array(8);
for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
  let mask = 0;
  for (let c = 0; c < 8; c++) {
    const v = G[gi(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))];
    val[c] = v; if (v < 0) mask |= 1 << c;
  }
  if (mask === 0 || mask === 255) continue;
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const [a, b] of EDGES) {
    const va = val[a], vb = val[b];
    if ((va < 0) === (vb < 0)) continue;
    const t = va / (va - vb);
    const ax = a & 1, ay = (a >> 1) & 1, az = (a >> 2) & 1;
    const bx = b & 1, by = (b >> 1) & 1, bz = (b >> 2) & 1;
    sx += ax + (bx - ax) * t; sy += ay + (by - ay) * t; sz += az + (bz - az) * t; n++;
  }
  cellVert[ci(i, j, k)] = pos.length / 3;
  pos.push(X(i) + (sx / n) * H, Y(j) + (sy / n) * H, Z(k) + (sz / n) * H);
}
const quads = [];
for (let k = 1; k < cz; k++) for (let j = 1; j < cy; j++) for (let i = 1; i < cx; i++) {
  const v0 = G[gi(i, j, k)] < 0;
  if (v0 !== (G[gi(i + 1, j, k)] < 0) && i < cx) quads.push(cellVert[ci(i, j, k)], cellVert[ci(i, j - 1, k)], cellVert[ci(i, j - 1, k - 1)], cellVert[ci(i, j, k - 1)]);
  if (v0 !== (G[gi(i, j + 1, k)] < 0)) quads.push(cellVert[ci(i, j, k)], cellVert[ci(i - 1, j, k)], cellVert[ci(i - 1, j, k - 1)], cellVert[ci(i, j, k - 1)]);
  if (v0 !== (G[gi(i, j, k + 1)] < 0)) quads.push(cellVert[ci(i, j, k)], cellVert[ci(i - 1, j, k)], cellVert[ci(i - 1, j - 1, k)], cellVert[ci(i, j - 1, k)]);
}
const nv = pos.length / 3;
log(`surface nets: ${nv} vertices, ${quads.length / 4} quads`);

// ------------------------------------------------------------------ project onto exact surface + normals
const P = new Float32Array(pos);
const N = new Float32Array(nv * 3);
const e = H * 0.25;
function grad(x, y, z) {
  return [f(x + e, y, z) - f(x - e, y, z), f(x, y + e, z) - f(x, y - e, z), f(x, y, z + e) - f(x, y, z - e)];
}
for (let v = 0; v < nv; v++) {
  let x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
  for (let it = 0; it < 3; it++) {
    const d = f(x, y, z);
    const g = grad(x, y, z); const gl = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
    if (gl < 1e-14) break;
    let s = d * (2 * e) / gl; // grad is scaled by 2e
    const step = Math.abs(s) * Math.sqrt(gl);
    if (step > H * 0.6) s *= (H * 0.6) / step;
    x -= g[0] * s; y -= g[1] * s; z -= g[2] * s;
  }
  P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
  const g = grad(x, y, z); const gl = Math.hypot(g[0], g[1], g[2]) || 1;
  N[v * 3] = g[0] / gl; N[v * 3 + 1] = g[1] / gl; N[v * 3 + 2] = g[2] / gl;
}
log('projected + normals');

// triangulate quads along the shorter diagonal and orient with the field gradient
const idx = [];
const d2 = (a, b) => (P[a * 3] - P[b * 3]) ** 2 + (P[a * 3 + 1] - P[b * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[b * 3 + 2]) ** 2;
function tri(a, b, c) {
  if (a === b || b === c || a === c) return;
  const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
  const wx = P[c * 3] - P[a * 3], wy = P[c * 3 + 1] - P[a * 3 + 1], wz = P[c * 3 + 2] - P[a * 3 + 2];
  const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
  const nx_ = N[a * 3] + N[b * 3] + N[c * 3], ny_ = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1], nz_ = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
  if (fx * nx_ + fy * ny_ + fz * nz_ < 0) idx.push(a, c, b); else idx.push(a, b, c);
}
for (let q = 0; q < quads.length; q += 4) {
  const [a, b, c, d] = [quads[q], quads[q + 1], quads[q + 2], quads[q + 3]];
  if (a < 0 || b < 0 || c < 0 || d < 0) continue;
  if (d2(a, c) < d2(b, d)) { tri(a, b, c); tri(a, c, d); } else { tri(a, b, d); tri(b, c, d); }
}
log(`triangles: ${idx.length / 3}`);

// ------------------------------------------------------------------ bone weights
const boneIndex = new Map(def.bones.map((b, i) => [b.name, i]));
const nPrimIds = Math.max(...F.prims.map((p) => p.id), ...F.post.map((p) => p.id)) + 1;
const detail = { group: new Float64Array(F.groups.length), prim: new Float64Array(nPrimIds) };
const JOINTS = new Uint16Array(nv * 4);
const WEIGHTS = new Float32Array(nv * 4);
const groupPrims = F.byGroup.map((g) => g.add);
const head = def.head;
const headBone = boneIndex.get('head'), jawBone = boneIndex.get('jaw');
const bw = new Float64Array(def.bones.length);
for (let v = 0; v < nv; v++) {
  const x = P[v * 3] / SCALE, y = P[v * 3 + 1] / SCALE, z = P[v * 3 + 2] / SCALE;
  detail.prim.fill(BIG);
  F.eval(x, y, z, detail);
  let gmin = Infinity;
  for (let g = 0; g < F.groups.length; g++) gmin = Math.min(gmin, detail.group[g]);
  let sig = 0.0025;
  for (let g = 1; g < F.groups.length; g++) sig = Math.max(sig, F.kLocal(g, x, y, z) * 0.4);
  bw.fill(0);
  for (let g = 0; g < F.groups.length; g++) {
    const W = Math.exp(-(detail.group[g] - gmin) / sig);
    if (W < 1e-3) continue;
    const prims = groupPrims[g];
    let dmin = Infinity;
    for (const p of prims) dmin = Math.min(dmin, detail.prim[p.id]);
    let tot = 0;
    const ws = [];
    for (const p of prims) {
      const s = Math.max(0.002, (p.k ?? F.groups[g].k) * 0.4);
      const w = Math.exp(-(detail.prim[p.id] - dmin) / s);
      if (w > 1e-4) { ws.push([p, w]); tot += w; }
    }
    for (const [p, w] of ws) bw[boneIndex.get(p.bone)] += (W * w) / tot;
  }
  // jaw override: everything under the mouth slit and in front of the jaw hinge follows the jaw
  const hj = bw[headBone] + bw[jawBone];
  if (hj > 1e-4) {
    const l = head.local([x, y, z]);
    const yc = def.mouthY(Math.abs(l[0]));
    const jawness = smoothstep(yc + 0.003, yc - 0.004, l[1]) * smoothstep(-0.035, -0.008, l[2]);
    bw[jawBone] = hj * jawness; bw[headBone] = hj * (1 - jawness);
  }
  // keep top 4
  const order = [...bw.keys()].sort((a, b) => bw[b] - bw[a]).slice(0, 4);
  let s = 0; for (const b of order) s += bw[b];
  for (let q = 0; q < 4; q++) { JOINTS[v * 4 + q] = order[q]; WEIGHTS[v * 4 + q] = bw[order[q]] / s; }
}
log('bone weights');

// ------------------------------------------------------------------ bakes
const fib = [];
for (let i = 0; i < 24; i++) {
  const yy = 1 - (i + 0.5) / 12; if (Math.abs(yy) > 1) continue;
  const r = Math.sqrt(1 - Math.min(1, yy * yy)), th = i * 2.399963;
  fib.push([Math.cos(th) * r, yy, Math.sin(th) * r]);
}
const tips = def.anchors.tips.map((p) => p.map((c) => c * SCALE));
const eyes = def.anchors.eyes.map((e) => e.pos.map((c) => c * SCALE));
const bony = F.prims.filter((p) => p.tag === 'rib' || p.tag === 'spine');
// exact far-field: trilinear lookup into the coarse grid (C*H spacing)
const CH = C * H;
function fFar(x, y, z) {
  const u = (x - mn[0]) / CH, w = (y - mn[1]) / CH, q = (z - mn[2]) / CH;
  if (u < 0 || w < 0 || q < 0 || u >= cnx - 1 || w >= cny - 1 || q >= cnz - 1) return 1;
  const i = Math.floor(u), j = Math.floor(w), k = Math.floor(q);
  const a = u - i, b = w - j, c = q - k;
  let r = 0;
  for (let n = 0; n < 8; n++) {
    const di = n & 1, dj = (n >> 1) & 1, dk = (n >> 2) & 1;
    r += CG[cgi(i + di, j + dj, k + dk)] * (di ? a : 1 - a) * (dj ? b : 1 - b) * (dk ? c : 1 - c);
  }
  return r;
}
const D0 = new Float32Array(nv * 4), D1 = new Float32Array(nv * 4);
for (let v = 0; v < nv; v++) {
  const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
  const nx_ = N[v * 3], ny_ = N[v * 3 + 1], nz_ = N[v * 3 + 2];
  // near-field AO along the normal
  let occ = 0, sca = 1;
  for (let i = 1; i <= 5; i++) {
    const h = 0.004 + 0.03 * (i / 5);
    occ += (h - f(x + nx_ * h, y + ny_ * h, z + nz_ * h)) * sca; sca *= 0.75;
  }
  const nearAO = Math.min(Math.max(1 - 9 * occ, 0), 1);
  // far-field directional visibility (armpits, between the legs, inside the mouth)
  let vis = 0, wsum = 0;
  for (const d of fib) {
    const c = d[0] * nx_ + d[1] * ny_ + d[2] * nz_;
    if (c < 0.15) continue;
    let dv = 1;
    for (const t of [0.015, 0.035, 0.07, 0.13, 0.22]) {
      const px = x + d[0] * t + nx_ * 0.004, py = y + d[1] * t + ny_ * 0.004, pz = z + d[2] * t + nz_ * 0.004;
      const s = t < 0.05 ? f(px, py, pz) : fFar(px, py, pz) + CH * 0.3;
      dv = Math.min(dv, Math.max(0, s / (t * 0.6)));
    }
    vis += Math.min(dv, 1) * c; wsum += c;
  }
  const ao = nearAO * (0.25 + 0.75 * (wsum ? vis / wsum : 1));
  // thickness (for fake subsurface): how deep the solid goes behind the surface
  let th = 0;
  for (let i = 1; i <= 6; i++) { const h = 0.008 * i; th += Math.max(0, -f(x - nx_ * h, y - ny_ * h, z - nz_ * h)); }
  th = Math.min(th / 0.12, 1);
  // curvature (laplacian): + convex / bony, - creases
  const hh = 0.006; const c0 = f(x, y, z);
  const lap = (f(x + hh, y, z) + f(x - hh, y, z) + f(x, y + hh, z) + f(x, y - hh, z) + f(x, y, z + hh) + f(x, y, z - hh) - 6 * c0) / (hh * hh);
  const curv = Math.tanh(lap * 0.012);
  // gums: walls of the carved mouth
  let dm = Infinity;
  for (const m of def.mouth) dm = Math.min(dm, m.d(x / SCALE, y / SCALE, z / SCALE) * SCALE);
  const gum = 1 - smoothstep(0.0, 0.0035, dm);
  let dt = Infinity; for (const t of tips) dt = Math.min(dt, Math.hypot(x - t[0], y - t[1], z - t[2]));
  const ext = 1 - smoothstep(0.0, 0.11, dt);
  let de = Infinity; for (const t of eyes) de = Math.min(de, Math.hypot(x - t[0], y - t[1], z - t[2]));
  const bruise = 1 - smoothstep(0.012, 0.055, de);
  let db = Infinity; for (const p of bony) db = Math.min(db, p.d(x / SCALE, y / SCALE, z / SCALE) * SCALE);
  const bon = Math.exp(-Math.max(db, 0) / 0.004);
  D0.set([ao, th, curv, gum], v * 4);
  // region where blood has run from the mouth: chin, throat, upper chest (front-facing only)
  const hl = head.local([x / SCALE, y / SCALE, z / SCALE]);
  const front = smoothstep(0.1, 0.6, nz_);
  const drip = (1 - smoothstep(0.02, 0.055, Math.abs(hl[0]))) * smoothstep(def.mouthY(Math.abs(hl[0])) + 0.004, def.mouthY(Math.abs(hl[0])) - 0.01, hl[1]) * (1 - smoothstep(-0.18, -0.32, hl[1])) * front;
  D1.set([ext, bruise, bon, drip], v * 4);
}
log('baked AO / thickness / curvature / masks');

// ------------------------------------------------------------------ GLB
const S3 = (p) => p.map((c) => c * SCALE);
const bonesW = def.bones.map((b) => ({ ...b, w: S3(b.pos) }));
const byName = new Map(bonesW.map((b) => [b.name, b]));
const IBM = new Float32Array(bonesW.length * 16);
bonesW.forEach((b, i) => { IBM.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -b.w[0], -b.w[1], -b.w[2], 1], i * 16); });

const chunks = []; let byteLen = 0;
const bufferViews = [], accessors = [];
function addView(typed, target) {
  const pad = (4 - (byteLen % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); byteLen += pad; }
  const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  bufferViews.push({ buffer: 0, byteOffset: byteLen, byteLength: buf.length, ...(target ? { target } : {}) });
  chunks.push(buf); byteLen += buf.length;
  return bufferViews.length - 1;
}
function addAccessor(typed, type, componentType, count, target, extra = {}) {
  accessors.push({ bufferView: addView(typed, target), componentType, count, type, ...extra });
  return accessors.length - 1;
}
const pmin = [Infinity, Infinity, Infinity], pmax = [-Infinity, -Infinity, -Infinity];
for (let v = 0; v < nv; v++) for (let a = 0; a < 3; a++) { pmin[a] = Math.min(pmin[a], P[v * 3 + a]); pmax[a] = Math.max(pmax[a], P[v * 3 + a]); }
const aPos = addAccessor(P, 'VEC3', 5126, nv, 34962, { min: pmin, max: pmax });
// quantize: normals -> int8 (padded vec4 stride), joints/weights/bakes -> uint8
const Nq = new Int8Array(nv * 4);
for (let v = 0; v < nv; v++) for (let a = 0; a < 3; a++) Nq[v * 4 + a] = Math.round(N[v * 3 + a] * 127);
const Jq = new Uint8Array(JOINTS);
const Wq = new Uint8Array(nv * 4);
for (let v = 0; v < nv; v++) {
  let sum = 0;
  for (let q = 0; q < 4; q++) { Wq[v * 4 + q] = Math.round(WEIGHTS[v * 4 + q] * 255); sum += Wq[v * 4 + q]; }
  Wq[v * 4] += 255 - sum; // exact normalisation, largest weight absorbs rounding
}
const u8 = (src, remap) => { const o = new Uint8Array(src.length); for (let i = 0; i < src.length; i++) o[i] = Math.round(Math.min(Math.max(remap(src[i], i & 3), 0), 1) * 255); return o; };
const D0q = u8(D0, (x, c) => (c === 2 ? x * 0.5 + 0.5 : x));
const D1q = u8(D1, (x) => x);
function addStrided(typed, type, componentType, count, stride, extra) {
  const pad = (4 - (byteLen % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); byteLen += pad; }
  const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  bufferViews.push({ buffer: 0, byteOffset: byteLen, byteLength: buf.length, byteStride: stride, target: 34962 });
  chunks.push(buf); byteLen += buf.length;
  accessors.push({ bufferView: bufferViews.length - 1, componentType, count, type, ...extra });
  return accessors.length - 1;
}
const aNor = addStrided(Nq, 'VEC3', 5120, nv, 4, { normalized: true });
const aJ = addAccessor(Jq, 'VEC4', 5121, nv, 34962);
const aW = addAccessor(Wq, 'VEC4', 5121, nv, 34962, { normalized: true });
const aD0 = addAccessor(D0q, 'VEC4', 5121, nv, 34962, { normalized: true });
const aD1 = addAccessor(D1q, 'VEC4', 5121, nv, 34962, { normalized: true });
const aIdx = addAccessor(new Uint32Array(idx), 'SCALAR', 5125, idx.length, 34963);
const aIBM = addAccessor(IBM, 'MAT4', 5126, bonesW.length);

const nodes = [{ name: 'Creature', children: [1, 2] }, { name: 'CreatureBody', mesh: 0, skin: 0 }];
const boneNode = new Map();
bonesW.forEach((b, i) => boneNode.set(b.name, 2 + i));
for (const b of bonesW) {
  const parent = b.parent ? byName.get(b.parent).w : [0, 0, 0];
  nodes.push({ name: b.name, translation: [b.w[0] - parent[0], b.w[1] - parent[1], b.w[2] - parent[2]] });
}
for (const b of bonesW) if (b.parent) {
  const pn = nodes[boneNode.get(b.parent)];
  (pn.children ??= []).push(boneNode.get(b.name));
}

const A = def.anchors;
const extras = {
  scale: SCALE,
  eyes: A.eyes.map((e) => ({ pos: S3(e.pos), r: e.r * SCALE, bone: e.bone, fwd: e.fwd })),
  teeth: A.teeth.map((t) => ({ ...t, pos: S3(t.pos), len: t.len * SCALE, w: t.w * SCALE })),
  claws: A.claws.map((c) => ({ ...c, pos: S3(c.pos), len: c.len * SCALE, r: c.r * SCALE })),
  headForward: A.headForward, headUp: A.headUp,
  bones: Object.fromEntries(bonesW.map((b) => [b.name, b.w])),
};

const gltf = {
  asset: { version: '2.0', generator: 'horror/tools/build-creature.mjs' },
  extensionsUsed: ['KHR_mesh_quantization'],
  extensionsRequired: ['KHR_mesh_quantization'],
  scene: 0,
  scenes: [{ nodes: [0], extras }],
  nodes,
  meshes: [{ name: 'CreatureBody', primitives: [{ attributes: { POSITION: aPos, NORMAL: aNor, JOINTS_0: aJ, WEIGHTS_0: aW, _DATA0: aD0, _DATA1: aD1 }, indices: aIdx, mode: 4 }] }],
  skins: [{ joints: bonesW.map((b) => boneNode.get(b.name)), inverseBindMatrices: aIBM, skeleton: boneNode.get('root') }],
  accessors, bufferViews, buffers: [{ byteLength: byteLen }],
};
const bin = Buffer.concat(chunks);
let json = Buffer.from(JSON.stringify(gltf));
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const binPad = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + json.length + 8 + binPad.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(binPad.length, 0); bh.writeUInt32LE(0x004e4942, 4);
const out = path.join(here, '..', 'assets', 'creature.glb');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([header, jh, json, bh, binPad]));
log(`wrote ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB), height ${pmax[1].toFixed(2)} m`);
