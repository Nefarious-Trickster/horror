// Walkability + line-of-sight grid for the creature, with A* pathfinding.
export class NavGrid {
  constructor({ x0, x1, z0, z1 }, cell = 0.5) {
    this.x0 = x0; this.z0 = z0; this.cell = cell;
    this.nx = Math.ceil((x1 - x0) / cell); this.nz = Math.ceil((z1 - z0) / cell);
    this.blocked = new Uint8Array(this.nx * this.nz);
    this.opaque = new Uint8Array(this.nx * this.nz);
  }
  idx(i, j) { return i + j * this.nx; }
  cellOf(x, z) { return [Math.floor((x - this.x0) / this.cell), Math.floor((z - this.z0) / this.cell)]; }
  center(i, j) { return { x: this.x0 + (i + 0.5) * this.cell, z: this.z0 + (j + 0.5) * this.cell }; }
  inside(i, j) { return i >= 0 && j >= 0 && i < this.nx && j < this.nz; }
  // box {minX,maxX,minZ,maxZ}; walkable=false blocks movement (with padding for the creature's body)
  addBox(b, { pad = 0.35, block = true, opaque = true } = {}) {
    const mark = (arr, p) => {
      const [i0, j0] = this.cellOf(b.minX - p, b.minZ - p), [i1, j1] = this.cellOf(b.maxX + p, b.maxZ + p);
      for (let j = Math.max(0, j0); j <= Math.min(this.nz - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(this.nx - 1, i1); i++) arr[this.idx(i, j)] = 1;
    };
    if (block) mark(this.blocked, pad);
    if (opaque) mark(this.opaque, 0);
  }
  // everything outside these rectangles is solid (the level's floor plan)
  carve(rects) {
    const open = new Uint8Array(this.nx * this.nz);
    for (const r of rects) {
      const [i0, j0] = this.cellOf(r.x0 + 0.3, r.z0 + 0.3), [i1, j1] = this.cellOf(r.x1 - 0.3, r.z1 - 0.3);
      for (let j = Math.max(0, j0); j <= Math.min(this.nz - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(this.nx - 1, i1); i++) open[this.idx(i, j)] = 1;
    }
    for (let k = 0; k < open.length; k++) if (!open[k]) { this.blocked[k] = 1; this.opaque[k] = 1; }
  }
  walkable(i, j) { return this.inside(i, j) && !this.blocked[this.idx(i, j)]; }
  nearestWalkable(x, z, maxR = 8) {
    const [ci, cj] = this.cellOf(x, z);
    if (this.walkable(ci, cj)) return this.center(ci, cj);
    for (let r = 1; r <= maxR; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      if (this.walkable(ci + di, cj + dj)) return this.center(ci + di, cj + dj);
    }
    return null;
  }
  // samples along a segment
  line(a, b, arr) {
    const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(d / (this.cell * 0.5));
    for (let k = 0; k <= n; k++) {
      const t = n ? k / n : 0; const [i, j] = this.cellOf(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
      if (!this.inside(i, j) || arr[this.idx(i, j)]) return false;
    }
    return true;
  }
  lineWalkable(a, b) { return this.line(a, b, this.blocked); }
  lineOfSight(a, b) { return this.line(a, b, this.opaque); }

  // A* (8-way, no corner cutting). cost(x, z) adds a per-cell penalty (e.g. lit areas it avoids).
  findPath(from, to, { cost = null, maxNodes = 20000 } = {}) {
    const s = this.nearestWalkable(from.x, from.z, 4), g = this.nearestWalkable(to.x, to.z, 6);
    if (!s || !g) return null;
    const [si, sj] = this.cellOf(s.x, s.z), [gi, gj] = this.cellOf(g.x, g.z);
    const N = this.nx * this.nz, G = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const heap = [];
    const push = (k, f) => { heap.push([f, k]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = c * 2 + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
    const h = (i, j) => { const dx = Math.abs(i - gi), dz = Math.abs(j - gj); return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz); };
    const sk = this.idx(si, sj), gk = this.idx(gi, gj);
    G[sk] = 0; push(sk, h(si, sj));
    let n = 0;
    while (heap.length && n++ < maxNodes) {
      const [, k] = pop();
      if (closed[k]) continue; closed[k] = 1;
      if (k === gk) break;
      const i = k % this.nx, j = (k / this.nx) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (!this.walkable(ni, nj)) continue;
        if (di && dj && (!this.walkable(i + di, j) || !this.walkable(i, j + dj))) continue;
        const nk = this.idx(ni, nj);
        if (closed[nk]) continue;
        let step = di && dj ? Math.SQRT2 : 1;
        if (cost) { const c = this.center(ni, nj); step += cost(c.x, c.z); }
        const ng = G[k] + step;
        if (ng < G[nk]) { G[nk] = ng; came[nk] = k; push(nk, ng + h(ni, nj)); }
      }
    }
    if (came[gk] === -1 && gk !== sk) return null;
    const pts = [];
    for (let k = gk; k !== -1; k = came[k]) { const i = k % this.nx, j = (k / this.nx) | 0; pts.push(this.center(i, j)); if (k === sk) break; }
    pts.reverse();
    pts[pts.length - 1] = g;
    // string-pull: skip points while the straight line stays walkable
    const out = [pts[0]];
    let a = 0;
    while (a < pts.length - 1) {
      let b = pts.length - 1;
      while (b > a + 1 && !this.lineWalkable(pts[a], pts[b])) b--;
      out.push(pts[b]); a = b;
    }
    return out;
  }
}
