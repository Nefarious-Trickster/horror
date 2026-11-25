// Signed-distance-field primitives and operators used to sculpt the creature.
// All functions work on plain numbers for speed (the mesher evaluates millions of points).

export const BIG = 1e9;

export function smin(a, b, k) {
  if (k <= 0) return a < b ? a : b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export function smax(a, b, k) {
  return -smin(-a, -b, k);
}

export function smoothstep(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

// ---------- tiny vector / matrix helpers (arrays) ----------
export const v3 = (x, y, z) => [x, y, z];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => mul(a, 1 / (len(a) || 1));
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// 3x3 row-major matrices
export function rotX(t) { const c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, c, -s, 0, s, c]; }
export function rotY(t) { const c = Math.cos(t), s = Math.sin(t); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
export function rotZ(t) { const c = Math.cos(t), s = Math.sin(t); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
export function mmul(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}
export function mvec(m, v) { return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]; }
export function mT(m) { return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]; }
export function euler(x = 0, y = 0, z = 0) { return mmul(rotZ(z), mmul(rotY(y), rotX(x))); }
export const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// A rigid frame: world = origin + R * local
export class Frame {
  constructor(origin, R = IDENT) { this.o = origin; this.R = R; }
  p(x, y, z) { return add(this.o, mvec(this.R, [x, y, z])); }
  d(x, y, z) { return mvec(this.R, [x, y, z]); }
  local(w) { return mvec(mT(this.R), sub(w, this.o)); }
}

// ---------- primitives ----------
let PID = 0;
class Prim {
  constructor(opts) {
    this.id = PID++;
    this.bone = opts.bone;
    this.group = opts.group ?? 'core';
    this.k = opts.k; // blend radius into its group (undefined => group default)
    this.sub = !!opts.sub;
    this.tag = opts.tag;
  }
  finalize() {
    const [mn, mx] = this.bounds();
    this.min = mn; this.max = mx;
    const E = 0.07;
    this.emin = [mn[0] - E, mn[1] - E, mn[2] - E];
    this.emax = [mx[0] + E, mx[1] + E, mx[2] + E];
    return this;
  }
  // distance with bbox culling (returns a lower bound far away)
  d(x, y, z) {
    if (x < this.emin[0] || y < this.emin[1] || z < this.emin[2] || x > this.emax[0] || y > this.emax[1] || z > this.emax[2]) {
      const dx = Math.max(this.min[0] - x, 0, x - this.max[0]);
      const dy = Math.max(this.min[1] - y, 0, y - this.max[1]);
      const dz = Math.max(this.min[2] - z, 0, z - this.max[2]);
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    return this.dist(x, y, z);
  }
}

export class Sphere extends Prim {
  constructor(c, r, opts) { super(opts); this.c = c; this.r = r; this.finalize(); }
  bounds() { const { c, r } = this; return [[c[0] - r, c[1] - r, c[2] - r], [c[0] + r, c[1] + r, c[2] + r]]; }
  dist(x, y, z) { return Math.hypot(x - this.c[0], y - this.c[1], z - this.c[2]) - this.r; }
}

// Tapered capsule (iq's round cone) from a (radius r1) to b (radius r2)
export class RoundCone extends Prim {
  constructor(a, b, r1, r2, opts) {
    super(opts);
    this.a = a; this.b = b; this.r1 = r1; this.r2 = r2;
    const ba = sub(b, a);
    this.ba = ba;
    this.l2 = dot(ba, ba);
    this.rr = r1 - r2;
    this.a2 = this.l2 - this.rr * this.rr;
    this.il2 = 1 / this.l2;
    this.finalize();
  }
  bounds() {
    const { a, b, r1, r2 } = this; const r = Math.max(r1, r2);
    return [[Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.min(a[2], b[2]) - r], [Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, Math.max(a[2], b[2]) + r]];
  }
  dist(px, py, pz) {
    const { a, ba, l2, rr, a2, il2, r1, r2 } = this;
    const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
    const y = pax * ba[0] + pay * ba[1] + paz * ba[2];
    const z = y - l2;
    const qx = pax * l2 - ba[0] * y, qy = pay * l2 - ba[1] * y, qz = paz * l2 - ba[2] * y;
    const x2 = qx * qx + qy * qy + qz * qz;
    const y2 = y * y * l2;
    const z2 = z * z * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
    if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
    return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
  }
}

export class Ellipsoid extends Prim {
  // R: rotation matrix (local->world). radii in local axes.
  constructor(c, radii, R = IDENT, opts) {
    super(opts);
    this.c = c; this.r = radii; this.R = R; this.Ri = mT(R);
    this.finalize();
  }
  bounds() {
    // conservative: bounding sphere of max radius
    const m = Math.max(...this.r); const c = this.c;
    return [[c[0] - m, c[1] - m, c[2] - m], [c[0] + m, c[1] + m, c[2] + m]];
  }
  dist(x, y, z) {
    const Ri = this.Ri;
    const dx = x - this.c[0], dy = y - this.c[1], dz = z - this.c[2];
    const lx = Ri[0] * dx + Ri[1] * dy + Ri[2] * dz;
    const ly = Ri[3] * dx + Ri[4] * dy + Ri[5] * dz;
    const lz = Ri[6] * dx + Ri[7] * dy + Ri[8] * dz;
    const [rx, ry, rz] = this.r;
    const k0 = Math.hypot(lx / rx, ly / ry, lz / rz);
    const k1 = Math.hypot(lx / (rx * rx), ly / (ry * ry), lz / (rz * rz));
    if (k1 < 1e-9) return -Math.min(rx, ry, rz);
    return (k0 * (k0 - 1)) / k1;
  }
}

// Field assembly ----------------------------------------------------------
// groups: [{name, k, joins:[{c, r, k}]}] ; first group is the base.
export class Field {
  constructor(groups) {
    this.groups = groups;
    this.gIndex = new Map(groups.map((g, i) => [g.name, i]));
    this.prims = [];
    this.post = []; // global subtractions [{prim, k}]
    this.kMin = 0.004;
  }
  addPrim(p) {
    if (!this.gIndex.has(p.group)) throw new Error('unknown group ' + p.group);
    this.prims.push(p); return p;
  }
  addPost(p, k) { p.sub = true; p.postK = k; this.post.push(p); return p; }
  build() {
    this.byGroup = this.groups.map(() => ({ add: [], sub: [] }));
    for (const p of this.prims) {
      const g = this.byGroup[this.gIndex.get(p.group)];
      (p.sub ? g.sub : g.add).push(p);
    }
  }
  kLocal(gi, x, y, z) {
    const g = this.groups[gi];
    let k = this.kMin;
    if (g.joins) for (const j of g.joins) {
      const d = Math.hypot(x - j.c[0], y - j.c[1], z - j.c[2]);
      const t = 1 - smoothstep(j.r * 0.45, j.r, d);
      k = Math.max(k, this.kMin + (j.k - this.kMin) * t);
    }
    return k;
  }
  groupValue(gi, x, y, z, primOut) {
    const g = this.groups[gi], bg = this.byGroup[gi];
    let f = BIG;
    for (const p of bg.add) {
      const d = p.d(x, y, z);
      if (primOut) primOut[p.id] = d;
      f = smin(f, d, p.k ?? g.k);
    }
    for (const p of bg.sub) {
      const d = p.d(x, y, z);
      f = smax(f, -d, p.k ?? g.k);
    }
    return f;
  }
  eval(x, y, z, detail) {
    let f = this.groupValue(0, x, y, z, detail?.prim);
    if (detail) detail.group[0] = f;
    for (let gi = 1; gi < this.groups.length; gi++) {
      const fg = this.groupValue(gi, x, y, z, detail?.prim);
      if (detail) detail.group[gi] = fg;
      f = smin(f, fg, this.kLocal(gi, x, y, z));
    }
    for (const p of this.post) {
      const d = p.d(x, y, z);
      f = smax(f, -d, p.postK);
    }
    return f;
  }
  // Spatial buckets: each cell lists only primitives whose bounds come within E of it.
  // evalFast() is exact wherever the surface is closer than E and returns >= E elsewhere.
  compileBuckets(E = 0.06, cell = 0.03) {
    const [mn, mx] = this.bounds();
    this.bE = E; this.bCell = cell;
    this.bMin = mn.map((v) => v - E - cell);
    this.bDim = [0, 1, 2].map((a) => Math.ceil((mx[a] + E + cell - this.bMin[a]) / cell));
    const [dx, dy, dz] = this.bDim;
    this.buckets = new Array(dx * dy * dz).fill(null);
    const overlaps = (p, bmn) => {
      for (let a = 0; a < 3; a++) if (p.max[a] + E < bmn[a] || p.min[a] - E > bmn[a] + cell) return false;
      return true;
    };
    for (let k = 0; k < dz; k++) for (let j = 0; j < dy; j++) for (let i = 0; i < dx; i++) {
      const bmn = [this.bMin[0] + i * cell, this.bMin[1] + j * cell, this.bMin[2] + k * cell];
      const groups = [];
      this.groups.forEach((g, gi) => {
        const add = this.byGroup[gi].add.filter((p) => overlaps(p, bmn));
        const sub = this.byGroup[gi].sub.filter((p) => overlaps(p, bmn));
        if (add.length) groups.push({ gi, add, sub, k: g.k, joins: g.joins });
      });
      const post = this.post.filter((p) => overlaps(p, bmn));
      if (groups.length) this.buckets[i + dx * (j + dy * k)] = { groups, post };
    }
  }
  evalFast(x, y, z) {
    const E = this.bE, c = this.bCell, d = this.bDim;
    const i = Math.floor((x - this.bMin[0]) / c), j = Math.floor((y - this.bMin[1]) / c), k = Math.floor((z - this.bMin[2]) / c);
    if (i < 0 || j < 0 || k < 0 || i >= d[0] || j >= d[1] || k >= d[2]) return E;
    const b = this.buckets[i + d[0] * (j + d[1] * k)];
    if (!b) return E;
    let f = BIG;
    for (const g of b.groups) {
      let fg = BIG;
      for (const p of g.add) fg = smin(fg, p.d(x, y, z), p.k ?? g.k);
      for (const p of g.sub) fg = smax(fg, -p.d(x, y, z), p.k ?? g.k);
      f = f === BIG ? fg : smin(f, fg, this.kLocal(g.gi, x, y, z));
    }
    for (const p of b.post) f = smax(f, -p.d(x, y, z), p.postK);
    return f < E ? f : E;
  }
  bounds() {
    const mn = [BIG, BIG, BIG], mx = [-BIG, -BIG, -BIG];
    for (const p of this.prims) if (!p.sub) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p.min[i]); mx[i] = Math.max(mx[i], p.max[i]); }
    return [mn, mx];
  }
}
