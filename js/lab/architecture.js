// Wing C architecture: floors, walls, ceilings, cells and glass for the prologue lab.
// Geometry is built from boxes with world-space UVs and merged per material, so the whole
// building is a handful of draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pbr } from '../engine/assets.js';

// ------------------------------------------------------------------ canvas textures
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return { tex: t, canvas: c };
}
// normal map from a height canvas (white = high)
function normalFromHeight(src, strength = 2) {
  const w = src.width, h = src.height;
  const hd = src.getContext('2d').getImageData(0, 0, w, h).data;
  const H = (x, y) => hd[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  const { tex } = canvasTex(w, h, (g) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (H(x - 1, y) - H(x + 1, y)) * strength, dy = (H(x, y - 1) - H(x, y + 1)) * strength;
      const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
      img.data[i] = (dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, false);
  return tex;
}
let rng = 7; const R = () => { rng = (rng * 16807) % 2147483647; return rng / 2147483647; };

// wall cladding: 1.2 x 2.4 m enamelled panels with recessed seams and fixings
function wallPanelMaps() {
  const W = 512, Hh = 1024, seam = 5;
  const height = canvasTex(W, Hh, (g) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, Hh);
    g.fillStyle = '#000'; g.fillRect(0, 0, W, seam); g.fillRect(0, 0, seam, Hh);
    g.fillStyle = '#444'; for (const [x, y] of [[22, 22], [W - 22, 22], [22, Hh - 22], [W - 22, Hh - 22], [22, Hh / 2], [W - 22, Hh / 2]]) { g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); }
  }, false).canvas;
  const color = canvasTex(W, Hh, (g) => {
    g.fillStyle = '#e6ebeb'; g.fillRect(0, 0, W, Hh);
    for (let i = 0; i < 2200; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '255,255,255' : '120,130,132'},${R() * 0.05})`; g.fillRect(R() * W, R() * Hh, 2 + R() * 30, 2 + R() * 30); }
    g.fillStyle = '#7f8b8d'; g.fillRect(0, 0, W, seam); g.fillRect(0, 0, seam, Hh);
    g.fillStyle = '#9aa5a7'; for (const [x, y] of [[22, 22], [W - 22, 22], [22, Hh - 22], [W - 22, Hh - 22], [22, Hh / 2], [W - 22, Hh / 2]]) { g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); }
  }).tex;
  const rough = canvasTex(W, Hh, (g) => {
    g.fillStyle = '#6a6a6a'; g.fillRect(0, 0, W, Hh);
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${R() < 0.5 ? 255 : 0},${R() < 0.5 ? 255 : 0},${R() < 0.5 ? 255 : 0},0.03)`; g.beginPath(); g.arc(R() * W, R() * Hh, 6 + R() * 40, 0, 7); g.fill(); }
    g.fillStyle = '#b0b0b0'; g.fillRect(0, 0, W, seam); g.fillRect(0, 0, seam, Hh);
  }, false).tex;
  return { map: color, normalMap: normalFromHeight(height, 3), roughnessMap: rough };
}
// suspended ceiling: 0.6 m mineral-fibre tiles in a white T-bar grid
function ceilingMaps() {
  const W = 512;
  const color = canvasTex(W, W, (g) => {
    g.fillStyle = '#e3e7e7'; g.fillRect(0, 0, W, W);
    for (let i = 0; i < 9000; i++) { const v = 150 + R() * 70; g.fillStyle = `rgba(${v},${v},${v + 3},${0.25 + R() * 0.4})`; g.fillRect(R() * W, R() * W, 1 + R() * 2, 1 + R() * 2); }
    g.fillStyle = '#f5f7f7'; g.fillRect(0, 0, W, 14); g.fillRect(0, 0, 14, W);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(14, 14, W, 3); g.fillRect(14, 14, 3, W);
  }).tex;
  const height = canvasTex(W, W, (g) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, W, W);
    for (let i = 0; i < 6000; i++) { g.fillStyle = R() < 0.5 ? '#606060' : '#9a9a9a'; g.fillRect(R() * W, R() * W, 2, 2); }
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, 14); g.fillRect(0, 0, 14, W);
  }, false).canvas;
  return { map: color, normalMap: normalFromHeight(height, 2) };
}

// ------------------------------------------------------------------ materials
export function labMaterials() {
  const M = {};
  const panels = wallPanelMaps();
  M.wall = new THREE.MeshStandardMaterial({ ...panels, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.6, 0.6) });
  M.wall.userData.uv = [1.2, 2.4];
  const ceil = ceilingMaps();
  // emissive stands in for light bounced up off the floor (no global illumination here)
  M.ceiling = new THREE.MeshStandardMaterial({ ...ceil, roughness: 0.92, normalScale: new THREE.Vector2(0.5, 0.5), emissive: 0xffffff, emissiveMap: ceil.map, emissiveIntensity: 0.22 });
  M.ceiling.userData.uv = [0.6, 0.6];
  M.floor = new THREE.MeshPhysicalMaterial({ ...pbr('Tiles043'), color: 0xeef2f2, roughness: 1, clearcoat: 0.6, clearcoatRoughness: 0.1, normalScale: new THREE.Vector2(0.5, 0.5) });
  M.floor.userData.uv = [1.2, 1.2];
  M.corridorFloor = new THREE.MeshPhysicalMaterial({ ...pbr('Terrazzo019S'), color: 0xd5dcde, roughness: 1, clearcoat: 0.45, clearcoatRoughness: 0.15 });
  M.corridorFloor.userData.uv = [1.2, 1.2];
  M.tile = new THREE.MeshStandardMaterial({ ...pbr('Tiles107', { maps: ['color', 'normal', 'roughness', 'ao'] }), color: 0xf4f7f7, roughness: 1 });
  M.tile.userData.uv = [1.0, 1.0];
  M.steel = new THREE.MeshStandardMaterial({ ...pbr('Metal009', { maps: ['color', 'normal', 'roughness'] }), color: 0xd4d8da, metalness: 1, roughness: 1, envMapIntensity: 1.2 });
  M.steel.userData.uv = [0.8, 0.8];
  M.cove = new THREE.MeshStandardMaterial({ ...pbr('Rubber001'), color: 0x3a4042, roughness: 1 });
  M.cove.userData.uv = [0.6, 0.6];
  M.stripe = new THREE.MeshStandardMaterial({ color: 0x1f8a8a, roughness: 0.35 });
  M.dark = new THREE.MeshStandardMaterial({ color: 0x15191a, roughness: 0.8 });
  M.concrete = new THREE.MeshStandardMaterial({ color: 0x6d6b66, roughness: 0.95 });
  M.plastic = new THREE.MeshPhysicalMaterial({ ...pbr('Plastic013A'), color: 0xf0f2f2, roughness: 1, clearcoat: 0.3 });
  M.plastic.userData.uv = [1, 1];
  M.glass = new THREE.MeshPhysicalMaterial({ color: 0xcfe6e8, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.12, depthWrite: false, envMapIntensity: 1.6, side: THREE.DoubleSide, clearcoat: 1, clearcoatRoughness: 0.02 });
  M.hazard = new THREE.MeshStandardMaterial({ map: canvasTex(256, 64, (g, w, h) => { g.fillStyle = '#e8b81c'; g.fillRect(0, 0, w, h); g.fillStyle = '#16181a'; for (let x = -h; x < w + h; x += 48) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 24, h); g.lineTo(x + 24 + h, 0); g.lineTo(x + h, 0); g.fill(); } }).tex, roughness: 0.6 });
  M.hazard.userData.uv = [0.5, 0.125];
  return M;
}

// ------------------------------------------------------------------ builder
function planarUV(geo, [su, sv]) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (ay >= ax && ay >= az) uv.setXY(i, x / su, z / sv);
    else if (ax >= az) uv.setXY(i, z / su, y / sv);
    else uv.setXY(i, x / su, y / sv);
  }
  uv.needsUpdate = true;
  geo.setAttribute('uv1', uv.clone()); // for aoMap
}

export class Builder {
  constructor(mats) { this.M = mats; this.parts = new Map(); this.colliders = []; }
  box(key, x0, x1, y0, y1, z0, z1, { collide = false } = {}) {
    if (x1 - x0 <= 1e-4 || y1 - y0 <= 1e-4 || z1 - z0 <= 1e-4) return;
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    planarUV(g, this.M[key].userData.uv || [1, 1]);
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(g);
    if (collide) this.colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 });
  }
  // A wall running along X at constant z. `sides` sets the finish on each face: { neg: key, pos: key }
  // (the -z face and +z face). openings: [{ a, b, top }] in x. trim: add cove base + stripe on those faces.
  wallX(z, x0, x1, h, { sides = { neg: 'wall', pos: 'wall' }, openings = [], t = 0.16, trim = { neg: true, pos: true } } = {}) {
    const segs = []; let x = x0;
    for (const o of [...openings].sort((p, q) => p.a - q.a)) { segs.push([x, o.a, 0, h]); segs.push([o.a, o.b, o.top, h]); x = o.b; }
    segs.push([x, x1, 0, h]);
    for (const [a, b, y0, y1] of segs) {
      this.box(sides.neg, a, b, y0, y1, z - t / 2, z, { collide: y0 === 0 });
      this.box(sides.pos, a, b, y0, y1, z, z + t / 2, { collide: y0 === 0 });
      if (y0 === 0) for (const [side, s] of [['neg', -1], ['pos', 1]]) {
        if (!trim[side] || sides[side] !== 'wall') continue;
        const zf = z + s * t / 2;
        this.box('cove', a, b, 0, 0.12, Math.min(zf, zf + s * 0.015), Math.max(zf, zf + s * 0.015));
        this.box('stripe', a, b, 1.02, 1.08, Math.min(zf, zf + s * 0.006), Math.max(zf, zf + s * 0.006));
      }
    }
  }
  // wall along Z at constant x; sides.neg = -x face, sides.pos = +x face
  wallZ(x, z0, z1, h, { sides = { neg: 'wall', pos: 'wall' }, openings = [], t = 0.16, trim = { neg: true, pos: true } } = {}) {
    const segs = []; let z = z0;
    for (const o of [...openings].sort((p, q) => p.a - q.a)) { segs.push([z, o.a, 0, h]); segs.push([o.a, o.b, o.top, h]); z = o.b; }
    segs.push([z, z1, 0, h]);
    for (const [a, b, y0, y1] of segs) {
      this.box(sides.neg, x - t / 2, x, y0, y1, a, b, { collide: y0 === 0 });
      this.box(sides.pos, x, x + t / 2, y0, y1, a, b, { collide: y0 === 0 });
      if (y0 === 0) for (const [side, s] of [['neg', -1], ['pos', 1]]) {
        if (!trim[side] || sides[side] !== 'wall') continue;
        const xf = x + s * t / 2;
        this.box('cove', Math.min(xf, xf + s * 0.015), Math.max(xf, xf + s * 0.015), 0, 0.12, a, b);
        this.box('stripe', Math.min(xf, xf + s * 0.006), Math.max(xf, xf + s * 0.006), 1.02, 1.08, a, b);
      }
    }
  }
  room(x0, x1, z0, z1, h, { floor = 'floor', ceiling = 'ceiling' } = {}) {
    this.box(floor, x0, x1, -0.05, 0, z0, z1);
    if (ceiling) this.box(ceiling, x0, x1, h, h + 0.05, z0, z1);
  }
  build(scene) {
    const meshes = {};
    for (const [key, geos] of this.parts) {
      const m = new THREE.Mesh(mergeGeometries(geos), this.M[key]);
      m.receiveShadow = true; m.castShadow = !['floor', 'corridorFloor', 'ceiling', 'stripe'].includes(key);
      m.name = 'arch_' + key;
      scene.add(m); meshes[key] = m;
    }
    return meshes;
  }
}

// ------------------------------------------------------------------ Wing C layout
// Main lab x[-7,7] z[-6,6] h 3.2 · cells A/B north of z=-6 · airlock + entrance south · storage east · Wing D door west
export const LAB = {
  H: 3.2,
  lab: { x0: -7, x1: 7, z0: -6, z1: 6 },
  cellA: { x0: -6.6, x1: -0.8, z0: -11, z1: -6, door: { a: -2.1, b: -0.8 } },
  cellB: { x0: 0.8, x1: 6.6, z0: -11, z1: -6, door: { a: 0.8, b: 2.1 } },
  airlock: { x0: -1.4, x1: 1.4, z0: 6, z1: 9 },
  corridor: { x0: -1.6, x1: 1.6, z0: 9, z1: 16.5 },
  storage: { x0: 7, x1: 10.6, z0: -1.6, z1: 3.6 },
  wingD: { x0: -15, x1: -7, z0: -5.2, z1: -2.8 },
  doors: {
    outer: { x: 0, z: 9, w: 1.3, axis: 'x' },
    inner: { x: 0, z: 6, w: 1.3, axis: 'x' },
    storage: { x: 7, z: 1.0, w: 1.2, axis: 'z' },
    wingD: { x: -7, z: -4.0, w: 1.3, axis: 'z' },
    cellA: { x: -1.45, z: -6, w: 1.3, axis: 'x' },
    cellB: { x: 1.45, z: -6, w: 1.3, axis: 'x' },
  },
};

export function buildLab(scene) {
  const M = labMaterials();
  const b = new Builder(M);
  const { H } = LAB, L = LAB.lab, A = LAB.cellA, B = LAB.cellB, AL = LAB.airlock, C = LAB.corridor, S = LAB.storage, D = LAB.wingD;
  const dh = 2.25; // door opening height

  // floors & ceilings
  b.room(L.x0, L.x1, L.z0, L.z1, H);
  b.room(A.x0, A.x1, A.z0, A.z1, H, { floor: 'tile', ceiling: 'tile' });
  b.room(B.x0, B.x1, B.z0, B.z1, H, { floor: 'tile', ceiling: 'tile' });
  b.room(AL.x0, AL.x1, AL.z0, AL.z1, 2.6, { floor: 'steel', ceiling: 'steel' });
  b.room(C.x0, C.x1, C.z0, C.z1, 2.7, { floor: 'corridorFloor' });
  b.room(S.x0, S.x1, S.z0, S.z1, 2.8, { floor: 'corridorFloor' });
  b.room(D.x0, D.x1, D.z0, D.z1, 2.9, { floor: 'concrete', ceiling: null });

  // lab walls
  b.wallX(L.z1, L.x0, L.x1, H, { sides: { neg: 'wall', pos: 'wall' }, openings: [{ a: -0.65, b: 0.65, top: dh }], trim: { neg: true, pos: false } });
  b.wallZ(L.x1, L.z0, L.z1, H, { sides: { neg: 'wall', pos: 'wall' }, openings: [{ a: 0.4, b: 1.6, top: dh }], trim: { neg: true, pos: true } });
  b.wallZ(L.x0, L.z0, L.z1, H, { sides: { neg: 'concrete', pos: 'wall' }, openings: [{ a: -4.65, b: -3.35, top: dh }], trim: { neg: false, pos: true } });
  // cell front: solid ends + central service block; glass openings filled below
  const gTop = 2.75, gBot = 0.55;
  b.wallX(L.z0, L.x0, L.x1, H, {
    sides: { neg: 'tile', pos: 'wall' },
    openings: [{ a: -6.45, b: -2.25, top: gTop }, { a: A.door.a + 0.08, b: A.door.b - 0.08, top: dh }, { a: B.door.a + 0.08, b: B.door.b - 0.08, top: dh }, { a: 2.25, b: 6.45, top: gTop }],
    trim: { neg: false, pos: true }, t: 0.3,
  });
  // sill under the observation glass
  for (const [a, c] of [[-6.45, -2.25], [2.25, 6.45]]) {
    b.box('wall', a, c, 0, gBot, L.z0 - 0.15, L.z0 + 0.15, { collide: true });
    b.box('steel', a - 0.04, c + 0.04, gBot - 0.03, gBot, L.z0 - 0.17, L.z0 + 0.19);
    b.box('cove', a, c, 0, 0.12, L.z0 + 0.15, L.z0 + 0.165);
  }
  // cells: tiled boxes
  for (const cell of [A, B]) {
    b.wallX(cell.z0, cell.x0 - 0.15, cell.x1 + 0.15, H, { sides: { neg: 'concrete', pos: 'tile' }, trim: { neg: false, pos: false }, t: 0.3 });
    b.wallZ(cell.x0, cell.z0, L.z0, H, { sides: { neg: 'concrete', pos: 'tile' }, trim: { neg: false, pos: false }, t: 0.3 });
    b.wallZ(cell.x1, cell.z0, L.z0, H, { sides: { neg: 'tile', pos: 'concrete' }, trim: { neg: false, pos: false }, t: 0.3 });
    // floor drain + restraint ring plinth
    const cx = (cell.x0 + cell.x1) / 2, cz = (cell.z0 + cell.z1) / 2;
    b.box('steel', cx - 0.18, cx + 0.18, 0, 0.006, cz + 0.6 - 0.18, cz + 0.6 + 0.18);
  }
  // airlock + corridor + storage + wing D
  b.wallZ(AL.x0, AL.z0, AL.z1, 2.6, { sides: { neg: 'concrete', pos: 'steel' }, trim: { neg: false, pos: false } });
  b.wallZ(AL.x1, AL.z0, AL.z1, 2.6, { sides: { neg: 'steel', pos: 'concrete' }, trim: { neg: false, pos: false } });
  b.wallX(AL.z1, C.x0, C.x1, 2.7, { sides: { neg: 'steel', pos: 'wall' }, openings: [{ a: -0.65, b: 0.65, top: dh }], trim: { neg: false, pos: true } });
  b.box('steel', AL.x0, AL.x1, 2.2, 2.6, AL.z0 + 0.1, AL.z0 + 0.25); // decon nozzle bar
  b.box('steel', AL.x0, AL.x1, 2.2, 2.6, AL.z1 - 0.25, AL.z1 - 0.1);
  b.wallZ(C.x0, C.z0, C.z1, 2.7, { sides: { neg: 'concrete', pos: 'wall' }, trim: { neg: false, pos: true } });
  b.wallZ(C.x1, C.z0, C.z1, 2.7, { sides: { neg: 'wall', pos: 'concrete' }, trim: { neg: true, pos: false } });
  b.wallX(C.z1, C.x0, C.x1, 2.7, { sides: { neg: 'wall', pos: 'concrete' }, trim: { neg: true, pos: false } });
  b.wallX(S.z0, S.x0, S.x1, 2.8, { sides: { neg: 'concrete', pos: 'wall' }, trim: { neg: false, pos: true } });
  b.wallX(S.z1, S.x0, S.x1, 2.8, { sides: { neg: 'wall', pos: 'concrete' }, trim: { neg: true, pos: false } });
  b.wallZ(S.x1, S.z0, S.z1, 2.8, { sides: { neg: 'wall', pos: 'concrete' }, trim: { neg: true, pos: false } });
  b.wallX(D.z0, D.x0, D.x1, 2.9, { sides: { neg: 'concrete', pos: 'concrete' }, trim: { neg: false, pos: false } });
  b.wallX(D.z1, D.x0, D.x1, 2.9, { sides: { neg: 'concrete', pos: 'concrete' }, trim: { neg: false, pos: false } });
  b.wallZ(D.x0, D.z0, D.z1, 2.9, { sides: { neg: 'concrete', pos: 'concrete' }, trim: { neg: false, pos: false } });
  // lab ceiling bulkhead over the cell front (hides the door housings)
  b.box('wall', L.x0, L.x1, gTop + 0.0, H, L.z0 + 0.15, L.z0 + 0.6);
  b.box('steel', L.x0, L.x1, gTop - 0.02, gTop + 0.02, L.z0 + 0.15, L.z0 + 0.62);

  const meshes = b.build(scene);

  // observation glass (kept separate so it can crack and shatter)
  const glass = {};
  for (const [name, a, c] of [['A', -6.45, -2.25], ['B', 2.25, 6.45]]) {
    const g = new THREE.Mesh(new THREE.BoxGeometry(c - a, gTop - gBot, 0.05), M.glass);
    g.position.set((a + c) / 2, (gTop + gBot) / 2, L.z0); g.renderOrder = 2;
    scene.add(g);
    // frame
    const fr = new THREE.Group();
    const fm = M.steel;
    const add = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), fm); m.position.set(x, y, z); m.castShadow = true; fr.add(m); };
    add(c - a + 0.1, 0.06, 0.34, (a + c) / 2, gTop, L.z0); add(0.06, gTop - gBot, 0.34, a, (gTop + gBot) / 2, L.z0); add(0.06, gTop - gBot, 0.34, c, (gTop + gBot) / 2, L.z0);
    for (let i = 1; i < 3; i++) add(0.05, gTop - gBot, 0.12, a + (c - a) * i / 3, (gTop + gBot) / 2, L.z0); // mullions
    scene.add(fr);
    glass[name] = g;
    b.colliders.push({ minX: a, maxX: c, minZ: L.z0 - 0.15, maxZ: L.z0 + 0.15, glass: name });
  }
  return { meshes, glass, colliders: b.colliders, M };
}
