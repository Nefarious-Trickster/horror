import * as THREE from 'three';
import { W, H, ZONES, DOORS, buildGrid, doorZone, doorAxis } from './map.js';

const CHUNK = 12;
export const DOOR_H = { door: 2.25, keycard: 2.25, gate: 2.7, lift: 2.6 };

const UV_SCALE = {
  paint: 3, paintWard: 3, paintLobby: 3, tiles: 3, tilesMorgue: 3, cinder: 2.4, cinderRecords: 2.4,
  concreteWall: 4, steelWall: 1.5, linoleum: 3, floorTiles: 2, floorTilesMorgue: 2, concrete: 4,
  concreteCeil: 4, ceiling: 2.4, steelFloor: 1.5,
};

// accumulates quads per (material, chunk) to keep draw calls low but still frustum-cullable
export class Batcher {
  constructor() { this.buckets = new Map(); }
  bucket(mat, cx, cz) {
    const k = mat + '|' + Math.floor(cx / CHUNK) + '|' + Math.floor(cz / CHUNK);
    let b = this.buckets.get(k);
    if (!b) { b = { mat, pos: [], nor: [], uv: [], idx: [] }; this.buckets.set(k, b); }
    return b;
  }
  quad(mat, a, b, c, d, n, uvs) {
    const cx = (a[0] + c[0]) / 2, cz = (a[2] + c[2]) / 2;
    const B = this.bucket(mat, cx, cz);
    const base = B.pos.length / 3;
    for (const p of [a, b, c, d]) B.pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) B.nor.push(n[0], n[1], n[2]);
    for (const t of uvs) B.uv.push(t[0], t[1]);
    B.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build(materials, group) {
    for (const B of this.buckets.values()) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
      g.setIndex(B.idx);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, materials.get(B.mat));
      m.receiveShadow = true; m.castShadow = true;
      m.matrixAutoUpdate = false; m.updateMatrix();
      group.add(m);
    }
  }
}

export class Level {
  constructor() {
    this.grid = buildGrid();
    this.W = W; this.H = H;
    this.doorCells = new Map(); // "x,y" -> door entity (set later by Doors)
    this.occluders = new Set(); // cells that block sight (tall props)
    this.navBlock = new Set();   // cells monster cannot walk (props)
    this.colliders = [];         // {minX,maxX,minZ,maxZ,maxY}
    this.colliderHash = new Map();
  }

  cell(x, y) { return this.grid[y]?.[x] ?? '#'; }
  zoneAt(wx, wz) {
    const x = Math.floor(wx), y = Math.floor(wz);
    const c = this.cell(x, y);
    if (c === 'D') return doorZone(this.grid, x, y);
    return c === '#' ? null : c;
  }
  ceilingAt(wx, wz) {
    const x = Math.floor(wx), y = Math.floor(wz), c = this.cell(x, y);
    if (c === 'D') { const d = DOORS.find((q) => q[0] === x && q[1] === y); return DOOR_H[d?.[2] || 'door']; }
    return ZONES[c]?.h ?? 3;
  }

  // ---------------- geometry ----------------
  buildGeometry(materials) {
    const group = new THREE.Group();
    group.name = 'architecture';
    const B = new Batcher();
    const g = this.grid;
    const open = (c) => c !== '#';
    const wallMat = (x, y) => { const c = g[y][x]; return ZONES[c === 'D' ? doorZone(g, x, y) : c].wall; };

    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = g[y][x];
      if (c === '#') {
        // emit faces toward open neighbours
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dx, dy] of dirs) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const nc = g[ny][nx];
          if (!open(nc)) continue;
          const zoneKey = nc === 'D' ? doorZone(g, nx, ny) : nc;
          const h = nc === 'D' ? this.ceilingAt(nx + 0.5, ny + 0.5) : ZONES[zoneKey].h;
          const mat = ZONES[zoneKey].wall;
          this.wallFace(B, mat, x, y, dx, dy, 0, h);
          if (nc !== 'D' && ['paint', 'paintWard', 'paintLobby'].includes(mat)) this.baseboard(B, x, y, dx, dy);
        }
        continue;
      }
      const zone = c === 'D' ? doorZone(g, x, y) : c;
      const Z = ZONES[zone];
      const ch = this.ceilingAt(x + 0.5, y + 0.5);
      // floor
      const fs = UV_SCALE[Z.floor];
      B.quad(Z.floor, [x, 0, y + 1], [x + 1, 0, y + 1], [x + 1, 0, y], [x, 0, y], [0, 1, 0],
        [[x / fs, (y + 1) / fs], [(x + 1) / fs, (y + 1) / fs], [(x + 1) / fs, y / fs], [x / fs, y / fs]]);
      // ceiling
      const cm = c === 'D' ? 'concreteCeil' : Z.ceil;
      const cs = UV_SCALE[cm];
      B.quad(cm, [x, ch, y], [x + 1, ch, y], [x + 1, ch, y + 1], [x, ch, y + 1], [0, -1, 0],
        [[x / cs, y / cs], [(x + 1) / cs, y / cs], [(x + 1) / cs, (y + 1) / cs], [x / cs, (y + 1) / cs]]);
      // step faces where ceiling heights differ (lintels over doors, room height changes)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = g[y + dy]?.[x + dx];
        if (!nc || nc === '#') continue;
        const nh = this.ceilingAt(x + dx + 0.5, y + dy + 0.5);
        if (nh > ch + 0.01) {
          const nz = nc === 'D' ? doorZone(g, x + dx, y + dy) : nc;
          // face sits on the shared edge, facing the taller neighbour
          this.wallFace(B, ZONES[nz].wall, x, y, dx, dy, ch, nh);
        }
      }
    }
    B.build(materials, group);
    return group;
  }

  // wall face on the edge of cell (x,y) in direction (dx,dy), facing that direction
  wallFace(B, mat, x, y, dx, dy, y0, y1) {
    const s = UV_SCALE[mat] || 3;
    let a, b, c, d, n, u0, u1;
    if (dx === 1) { const X = x + 1; a = [X, y0, y + 1]; b = [X, y0, y]; c = [X, y1, y]; d = [X, y1, y + 1]; n = [1, 0, 0]; u0 = -(y + 1); u1 = -y; }
    else if (dx === -1) { const X = x; a = [X, y0, y]; b = [X, y0, y + 1]; c = [X, y1, y + 1]; d = [X, y1, y]; n = [-1, 0, 0]; u0 = y; u1 = y + 1; }
    else if (dy === 1) { const Zz = y + 1; a = [x, y0, Zz]; b = [x + 1, y0, Zz]; c = [x + 1, y1, Zz]; d = [x, y1, Zz]; n = [0, 0, 1]; u0 = x; u1 = x + 1; }
    else { const Zz = y; a = [x + 1, y0, Zz]; b = [x, y0, Zz]; c = [x, y1, Zz]; d = [x + 1, y1, Zz]; n = [0, 0, -1]; u0 = -(x + 1); u1 = -x; }
    B.quad(mat, a, b, c, d, n, [[u0 / s, y0 / s], [u1 / s, y0 / s], [u1 / s, y1 / s], [u0 / s, y1 / s]]);
  }

  baseboard(B, x, y, dx, dy) {
    const t = 0.018, h = 0.11;
    let a, b, c, d, n, ta, tb, tc, td;
    if (dx === 1) { const X = x + 1 + t; a = [X, 0, y + 1]; b = [X, 0, y]; c = [X, h, y]; d = [X, h, y + 1]; n = [1, 0, 0]; ta = [x + 1, h, y + 1]; tb = [X, h, y + 1]; tc = [X, h, y]; td = [x + 1, h, y]; }
    else if (dx === -1) { const X = x - t; a = [X, 0, y]; b = [X, 0, y + 1]; c = [X, h, y + 1]; d = [X, h, y]; n = [-1, 0, 0]; ta = [x, h, y]; tb = [X, h, y]; tc = [X, h, y + 1]; td = [x, h, y + 1]; }
    else if (dy === 1) { const Zz = y + 1 + t; a = [x, 0, Zz]; b = [x + 1, 0, Zz]; c = [x + 1, h, Zz]; d = [x, h, Zz]; n = [0, 0, 1]; ta = [x, h, y + 1]; tb = [x, h, Zz]; tc = [x + 1, h, Zz]; td = [x + 1, h, y + 1]; }
    else { const Zz = y - t; a = [x + 1, 0, Zz]; b = [x, 0, Zz]; c = [x, h, Zz]; d = [x + 1, h, Zz]; n = [0, 0, -1]; ta = [x + 1, h, y]; tb = [x + 1, h, Zz]; tc = [x, h, Zz]; td = [x, h, y]; }
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    B.quad('baseboard', a, b, c, d, n, uv);
    B.quad('baseboard', ta, tb, tc, td, [0, 1, 0], uv);
  }

  // ---------------- collision ----------------
  addCollider(minX, minZ, maxX, maxZ, opt = {}) {
    const c = { minX, minZ, maxX, maxZ, maxY: opt.maxY ?? 3, id: opt.id };
    this.colliders.push(c);
    for (let y = Math.floor(minZ); y <= Math.floor(maxZ); y++) for (let x = Math.floor(minX); x <= Math.floor(maxX); x++) {
      const k = x + ',' + y;
      if (!this.colliderHash.has(k)) this.colliderHash.set(k, []);
      this.colliderHash.get(k).push(c);
      if (opt.nav !== false) {
        // block nav only if the collider covers most of the cell
        const ox = Math.min(maxX, x + 1) - Math.max(minX, x), oz = Math.min(maxZ, y + 1) - Math.max(minZ, y);
        if (ox * oz > 0.35) this.navBlock.add(k);
      }
      if (opt.occlude) this.occluders.add(k);
    }
    return c;
  }
  removeCollider(c) {
    this.colliders = this.colliders.filter((q) => q !== c);
    for (const arr of this.colliderHash.values()) { const i = arr.indexOf(c); if (i >= 0) arr.splice(i, 1); }
  }

  solidCell(x, y, forMonster = false) {
    const c = this.cell(x, y);
    if (c === '#') return true;
    if (c === 'D') {
      const d = this.doorCells.get(x + ',' + y);
      if (!d) return false;
      if (forMonster) return !d.monsterPassable();
      return !d.isOpen();
    }
    return false;
  }

  // push a circle (x,z,r) out of walls & props. returns corrected [x,z]
  collide(x, z, r, opt = {}) {
    for (let iter = 0; iter < 3; iter++) {
      const cx = Math.floor(x), cz = Math.floor(z);
      for (let yy = cz - 1; yy <= cz + 1; yy++) for (let xx = cx - 1; xx <= cx + 1; xx++) {
        if (this.solidCell(xx, yy, opt.monster)) [x, z] = pushOut(x, z, r, xx, yy, xx + 1, yy + 1);
        if (opt.ignoreProps) continue;
        const list = this.colliderHash.get(xx + ',' + yy);
        if (list) for (const c of list) if (!opt.maxY || c.maxY > opt.minY) [x, z] = pushOut(x, z, r, c.minX, c.minZ, c.maxX, c.maxZ);
      }
    }
    return [x, z];
  }

  // grid DDA line of sight (walls, closed doors, tall props)
  los(ax, az, bx, bz) {
    let x = Math.floor(ax), y = Math.floor(az);
    const ex = Math.floor(bx), ey = Math.floor(bz);
    const dx = bx - ax, dz = bz - az;
    const sx = Math.sign(dx), sy = Math.sign(dz);
    const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity, tdy = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tx = dx !== 0 ? (sx > 0 ? (x + 1 - ax) : (ax - x)) * tdx : Infinity;
    let ty = dz !== 0 ? (sy > 0 ? (y + 1 - az) : (az - y)) * tdy : Infinity;
    for (let i = 0; i < 200; i++) {
      if (x === ex && y === ey) return true;
      if (tx < ty) { x += sx; tx += tdx; } else { y += sy; ty += tdy; }
      if (x === ex && y === ey) return true;
      if (this.solidCell(x, y) || this.occluders.has(x + ',' + y)) return false;
    }
    return false;
  }

  walkable(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const c = this.cell(x, y);
    if (c === '#') return false;
    if (c === 'D') { const d = this.doorCells.get(x + ',' + y); return !d || d.monsterPassable(); }
    return !this.navBlock.has(x + ',' + y);
  }

  // A* over the grid with diagonal moves; returns array of [x,z] world points
  path(sx, sz, tx, tz, maxNodes = 4000) {
    const s = [Math.floor(sx), Math.floor(sz)], t = [Math.floor(tx), Math.floor(tz)];
    if (!this.walkable(s[0], s[1]) && this.cell(s[0], s[1]) !== 'D') {
      const alt = this.nearestWalkable(s[0], s[1]);
      if (alt) { s[0] = alt[0]; s[1] = alt[1]; }
    }
    if (!this.walkable(t[0], t[1])) {
      const alt = this.nearestWalkable(t[0], t[1]);
      if (!alt) return null;
      t[0] = alt[0]; t[1] = alt[1];
    }
    const key = (x, y) => y * W + x;
    const open = new MinHeap();
    const g = new Map(), came = new Map();
    const h = (x, y) => Math.hypot(x - t[0], y - t[1]);
    const sk = key(s[0], s[1]);
    g.set(sk, 0); open.push(sk, h(s[0], s[1]));
    let n = 0;
    while (open.size && n++ < maxNodes) {
      const cur = open.pop();
      const cx = cur % W, cy = (cur / W) | 0;
      if (cx === t[0] && cy === t[1]) {
        const out = [];
        let k = cur;
        while (k !== undefined) { out.push([(k % W) + 0.5, ((k / W) | 0) + 0.5]); k = came.get(k); }
        out.reverse();
        return this.smooth(out);
      }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (!this.walkable(nx, ny)) continue;
        if (dx && dy && (!this.walkable(cx + dx, cy) || !this.walkable(cx, cy + dy))) continue;
        // keep diagonal moves away from door cells (doors are passed straight)
        if (dx && dy && (this.cell(nx, ny) === 'D' || this.cell(cx, cy) === 'D')) continue;
        const nk = key(nx, ny);
        const wallPenalty = this.nearWall(nx, ny) ? 0.4 : 0;
        const ng = g.get(cur) + (dx && dy ? 1.414 : 1) + wallPenalty;
        if (ng < (g.get(nk) ?? Infinity)) {
          g.set(nk, ng); came.set(nk, cur);
          open.push(nk, ng + h(nx, ny));
        }
      }
    }
    return null;
  }
  nearWall(x, y) {
    return this.cell(x + 1, y) === '#' || this.cell(x - 1, y) === '#' || this.cell(x, y + 1) === '#' || this.cell(x, y - 1) === '#';
  }
  nearestWalkable(x, y) {
    for (let r = 1; r < 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (this.walkable(x + dx, y + dy)) return [x + dx, y + dy];
    }
    return null;
  }
  // string-pull: drop intermediate points when straight walk is clear
  smooth(pts) {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      for (; j > i + 1; j--) if (this.clearWalk(pts[i], pts[j])) break;
      out.push(pts[j]); i = j;
    }
    return out;
  }
  clearWalk(a, b) {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.ceil(d / 0.25);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      // check body width
      for (const [ox, oz] of [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) {
        const cx = Math.floor(x + ox), cz = Math.floor(z + oz);
        if (!this.walkable(cx, cz)) return false;
        if (this.cell(cx, cz) === 'D' && (Math.abs(ox) + Math.abs(oz)) > 0) {
          // doors must be passed through their centre line
          return false;
        }
      }
    }
    return true;
  }
  randomOpenCell(zones, rnd = Math.random) {
    for (let i = 0; i < 400; i++) {
      const x = Math.floor(rnd() * W), y = Math.floor(rnd() * H);
      const c = this.cell(x, y);
      if (c !== '#' && c !== 'D' && (!zones || zones.includes(c)) && this.walkable(x, y)) return [x + 0.5, y + 0.5];
    }
    return null;
  }
}

function pushOut(x, z, r, minX, minZ, maxX, maxZ) {
  const nx = Math.max(minX, Math.min(x, maxX)), nz = Math.max(minZ, Math.min(z, maxZ));
  const dx = x - nx, dz = z - nz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return [x, z];
  if (d2 < 1e-8) {
    // centre inside box: push along smallest axis
    const l = x - minX, rr = maxX - x, t = z - minZ, b = maxZ - z;
    const m = Math.min(l, rr, t, b);
    if (m === l) return [minX - r, z];
    if (m === rr) return [maxX + r, z];
    if (m === t) return [x, minZ - r];
    return [x, maxZ + r];
  }
  const d = Math.sqrt(d2);
  return [nx + (dx / d) * r, nz + (dz / d) * r];
}

class MinHeap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(k, p) {
    const K = this.k, P = this.p;
    K.push(k); P.push(p);
    let i = K.length - 1;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (P[j] <= P[i]) break;
      [K[i], K[j]] = [K[j], K[i]]; [P[i], P[j]] = [P[j], P[i]]; i = j;
    }
  }
  pop() {
    const K = this.k, P = this.p;
    const top = K[0];
    const lk = K.pop(), lp = P.pop();
    if (K.length) {
      K[0] = lk; P[0] = lp;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < K.length && P[l] < P[m]) m = l;
        if (r < K.length && P[r] < P[m]) m = r;
        if (m === i) break;
        [K[i], K[m]] = [K[m], K[i]]; [P[i], P[m]] = [P[m], P[i]]; i = m;
      }
    }
    return top;
  }
}

export { doorAxis, doorZone };
