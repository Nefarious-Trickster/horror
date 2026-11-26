// Shared pieces for the mine (Chapter Four) and the purge (Chapter Five): rock tunnels, timber sets,
// rails, hanging bulb strings, lab coats, the sleepers, hiding spots, exposure, the respirator, gas.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pbr } from '../engine/assets.js';
import { sfx } from '../engine/game.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function rng(seed = 1) { let s = (Math.floor(seed * 2654435761) >>> 0) || 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

// ------------------------------------------------------------------ rock
function hash3(x, y, z) { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); }
export function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w) * 2 - 1;
}
const fbm = (x, y, z, o) => noise3(x * 0.55 + o, y * 0.55, z * 0.55) * 0.68 + noise3(x * 1.7, y * 1.7 + o, z * 1.7) * 0.24 + noise3(x * 4.1 + o, y * 4.1, z * 4.1) * 0.08;
// Bends tessellated wall and ceiling boxes into rough rock. The field depends only on position, so the
// faces of neighbouring boxes move together and no cracks open between them.
export function rockDeform(amp = 0.24) {
  return (g, kind) => {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const dx = fbm(x, y, z, 11.3), dy = fbm(x, y, z, 47.1), dz = fbm(x, y, z, 83.9);
      if (kind === 'ceil') p.setXYZ(i, x + dx * amp * 0.4, y + Math.abs(dy) * amp * 1.8, z + dz * amp * 0.4);
      else if (y < 0.03) p.setXYZ(i, x + dx * amp * 0.55, y, z + dz * amp * 0.55);
      else p.setXYZ(i, x + dx * amp, y + dy * amp * 0.35 * smooth(0, 0.6, y), z + dz * amp);
    }
    p.needsUpdate = true;
    g.computeVertexNormals();
  };
}

export function mineMaterials(M = {}) {
  const tex = (n) => { try { return pbr(n); } catch { return {}; } };
  const rock = new THREE.MeshStandardMaterial({ ...tex('rock_wall_10'), color: 0x8c857c, roughness: 1 }); rock.userData.tile = 3.2;
  const gravel = new THREE.MeshStandardMaterial({ ...tex('rocky_trail'), color: 0x6e675e, roughness: 1 }); gravel.userData.tile = 2.6;
  const concrete = M.slab || new THREE.MeshStandardMaterial({ color: 0x8a867e, roughness: 0.95 });
  const lining = new THREE.MeshStandardMaterial({ ...tex('Concrete036'), color: 0x8d8980, roughness: 1 }); lining.userData.tile = 2.4;
  return { rock, gravel, concrete, lining, timber: (() => { const t = M.timber ? M.timber.clone() : new THREE.MeshStandardMaterial({ roughness: 1 }); t.color = new THREE.Color(0x5e4c38); t.userData = { ...(M.timber?.userData || {}), tile: 1.2 }; return t; })(), steel: M.steelDark || new THREE.MeshStandardMaterial({ color: 0x3a3b3e, metalness: 0.8, roughness: 0.6 }), rust: M.rust || new THREE.MeshStandardMaterial({ color: 0x6e4a32, roughness: 0.9 }) };
}

// merges geometry per material
export class Parts {
  constructor() { this.map = new Map(); }
  add(m, g) { if (!this.map.has(m)) this.map.set(m, []); const gg = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(gg.attributes)) if (!['position', 'normal', 'uv'].includes(k)) gg.deleteAttribute(k); if (!gg.attributes.uv) gg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(gg.attributes.position.count * 2), 2)); this.map.get(m).push(gg); return gg; }
  box(m, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) { const g = new THREE.BoxGeometry(sx, sy, sz); if (rx || ry || rz) g.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz))); g.translate(x, y, z); return this.add(m, g); }
  cyl(m, a, b, r, seg = 8, r2 = r) { const d = new THREE.Vector3().subVectors(b, a), len = d.length(); const g = new THREE.CylinderGeometry(r2, r, len, seg); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize())); g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); return this.add(m, g); }
  build(parent, { worldUV, tile = 1, shadow = true } = {}) {
    const out = [];
    for (const [m, geos] of this.map) {
      const g = mergeGeometries(geos, false);
      if (worldUV) worldUV(g, m.userData?.tile || tile);
      const mesh = new THREE.Mesh(g, m); mesh.castShadow = shadow; mesh.receiveShadow = true; parent.add(mesh); out.push(mesh);
    }
    return out;
  }
}

// Timber sets along a tunnel: two posts and a cap, lagging boards over the cap, every `every` metres.
// axis 'z': tunnel runs along z at x = c (width w); axis 'x': along x at z = c.
export function timberSets(parts, mat, { axis = 'z', c = 0, from, to, w = 3, h = 2.9, every = 2.2, skip = () => false, colliders }) {
  const r = rng(from * 7 + c);
  const pos = [];
  for (let s = from + every / 2; s < to; s += every) {
    if (skip(s)) continue;
    const lean = (r() - 0.5) * 0.06, sag = r() * 0.05;
    const P = (a, y) => (axis === 'z' ? V(c + a, y, s) : V(s, y, c + a));
    const a = -w / 2 + 0.16, b = w / 2 - 0.16;
    parts.cyl(mat, P(a, 0), P(a + lean, h - 0.12), 0.11, 7, 0.1);
    parts.cyl(mat, P(b, 0), P(b - lean, h - 0.12), 0.11, 7, 0.1);
    parts.cyl(mat, P(a - 0.1, h - 0.08 - sag * 0.5), P(b + 0.1, h - 0.08 + sag * 0.5), 0.12, 7);
    for (let k = -2; k <= 2; k++) { const o = k * 0.36 + (r() - 0.5) * 0.08; const q = axis === 'z' ? [c, h + 0.05, s + o] : [s + o, h + 0.05, c]; parts.box(mat, q[0], q[1], q[2], axis === 'z' ? w * 0.86 : 0.18, 0.05, axis === 'z' ? 0.18 : w * 0.86, 0, 0, (r() - 0.5) * 0.08); }
    if (colliders) for (const aa of [a, b]) { const p = P(aa, 0); colliders.push({ minX: p.x - 0.13, maxX: p.x + 0.13, minZ: p.z - 0.13, maxZ: p.z + 0.13 }); }
    pos.push(s);
  }
  return pos;
}

// narrow-gauge rails with sleepers
export function rails(parts, steel, timber, { axis = 'z', c = 0, from, to, gauge = 0.6 }) {
  const P = (a, y, s) => (axis === 'z' ? [c + a, y, s] : [s, y, c + a]);
  const L = to - from, mid = (from + to) / 2;
  for (const a of [-gauge / 2, gauge / 2]) { const [x, y, z] = P(a, 0.07, mid); parts.box(steel, x, y, z, axis === 'z' ? 0.05 : L, 0.07, axis === 'z' ? L : 0.05); }
  for (let s = from + 0.3; s < to; s += 0.7) { const [x, y, z] = P(0, 0.02, s); parts.box(timber, x, y, z, axis === 'z' ? gauge + 0.4 : 0.16, 0.05, axis === 'z' ? 0.16 : gauge + 0.4); }
}

// ------------------------------------------------------------------ hanging bulbs on a cable
// bulbs.add(x, y, z, { light }) -> index; bulbs.set(i, level 0..1); bulbs.update(dt) runs flickers
export class Bulbs {
  constructor(scene, { color = 0xffc98a, intensity = 6, distance = 9 } = {}) {
    this.scene = scene; this.items = []; this.color = color; this.intensity = intensity; this.distance = distance;
    this.cable = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.7 });
    this.cage = new THREE.MeshStandardMaterial({ color: 0x2b2b28, metalness: 0.6, roughness: 0.6 });
    this.geo = { bulb: new THREE.SphereGeometry(0.045, 12, 8), cage: new THREE.CylinderGeometry(0.075, 0.06, 0.16, 8, 1, true), cord: new THREE.CylinderGeometry(0.006, 0.006, 1, 4) };
  }
  add(x, y, z, { light = true, drop = 0.35, level = 0 } = {}) {
    const g = new THREE.Group(); g.position.set(x, y, z);
    const cord = new THREE.Mesh(this.geo.cord, this.cable); cord.scale.y = drop; cord.position.y = drop / 2; g.add(cord);
    const cage = new THREE.Mesh(this.geo.cage, this.cage); cage.material.side = THREE.DoubleSide; cage.position.y = -0.04; g.add(cage);
    const mat = new THREE.MeshStandardMaterial({ color: 0x302820, emissive: this.color, emissiveIntensity: 0, roughness: 0.3 });
    const bulb = new THREE.Mesh(this.geo.bulb, mat); bulb.position.y = -0.06; g.add(bulb);
    g.userData.dynamic = true; this.scene.add(g);
    let l = null;
    if (light) { l = new THREE.PointLight(this.color, 0, this.distance, 1.8); l.position.set(x, y - 0.12, z); this.scene.add(l); }
    const it = { g, mat, light: l, level, target: level, flick: 0, pos: V(x, y, z) };
    this.items.push(it); this.apply(it);
    return this.items.length - 1;
  }
  apply(it) { const k = it.level * (it.flick > 0 && Math.random() < 0.5 ? 0.15 : 1); it.mat.emissiveIntensity = 2.2 * k; if (it.light) it.light.intensity = this.intensity * k; }
  set(i, level, { flicker = 0 } = {}) { const it = this.items[i]; if (!it) return; it.level = level; it.flick = flicker; this.apply(it); }
  all(level) { for (let i = 0; i < this.items.length; i++) this.set(i, level); }
  update(dt) { for (const it of this.items) { if (it.flick > 0) { it.flick -= dt; this.apply(it); if (it.flick <= 0) { it.flick = 0; this.apply(it); } } } }
}

// ------------------------------------------------------------------ lab coats
let coatTex = null;
function coatTexture() {
  if (coatTex) return coatTex;
  const c = document.createElement('canvas'); c.width = 256; c.height = 512; const x = c.getContext('2d');
  x.fillStyle = '#d8d6ce'; x.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 3000; i++) { x.fillStyle = `rgba(${90 + Math.random() * 40},${85 + Math.random() * 30},70,${Math.random() * 0.05})`; x.fillRect(Math.random() * 256, Math.random() * 512, 2, 2); }
  const g = x.createLinearGradient(0, 300, 0, 512); g.addColorStop(0, 'rgba(60,50,35,0)'); g.addColorStop(1, 'rgba(60,50,35,0.55)'); x.fillStyle = g; x.fillRect(0, 0, 256, 512); // hem grime
  for (let i = 0; i < 7; i++) { x.fillStyle = `rgba(${40 + Math.random() * 40},${30 + Math.random() * 20},20,${0.2 + Math.random() * 0.3})`; x.beginPath(); x.ellipse(Math.random() * 256, 200 + Math.random() * 300, 6 + Math.random() * 26, 10 + Math.random() * 40, 0, 0, Math.PI * 2); x.fill(); }
  coatTex = new THREE.CanvasTexture(c); coatTex.colorSpace = THREE.SRGBColorSpace; coatTex.wrapS = coatTex.wrapT = THREE.RepeatWrapping;
  return coatTex;
}
let coatGeo = null, coatMat = null;
function coatParts() {
  if (coatGeo) return;
  // body: a lathe from the shoulders down, flattened front to back, open down the front
  const prof = [[0.05, 0.04], [0.17, -0.02], [0.2, -0.12], [0.19, -0.4], [0.2, -0.7], [0.23, -1.0], [0.245, -1.14]].map(([r, y]) => new THREE.Vector2(r, y));
  const body = new THREE.LatheGeometry(prof, 18, Math.PI * 0.55, Math.PI * 1.9); body.scale(1, 1, 0.42);
  const sl = (s) => { const g = new THREE.CylinderGeometry(0.055, 0.07, 0.66, 8, 1, true); g.rotateZ(-s * 0.08); g.translate(s * 0.215, -0.38, 0.01); return g; };
  const collar = new THREE.TorusGeometry(0.085, 0.02, 6, 12, Math.PI * 1.4); collar.rotateX(Math.PI / 2); collar.rotateY(Math.PI * 0.8); collar.scale(1, 1, 0.6); collar.translate(0, 0.0, 0.01);
  const hook = new THREE.TorusGeometry(0.035, 0.006, 4, 10, Math.PI * 1.3); hook.translate(0, 0.08, 0);
  const geos = [body, sl(1), sl(-1), collar, hook].map((g) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k); return n; });
  coatGeo = mergeGeometries(geos);
  coatMat = new THREE.MeshStandardMaterial({ map: coatTexture(), color: 0xc9c6bc, roughness: 0.95, side: THREE.DoubleSide });
}
// a lab coat on a hook (origin at the hook); opts.name prints a name tag
export function labCoat({ seed = 1, name = null } = {}) {
  coatParts();
  const r = rng(seed);
  const g = new THREE.Group();
  const m = new THREE.Mesh(coatGeo, coatMat); m.castShadow = true; m.receiveShadow = true;
  m.rotation.set((r() - 0.5) * 0.06, (r() - 0.5) * 0.3, (r() - 0.5) * 0.05); m.scale.set(0.95 + r() * 0.1, 0.95 + r() * 0.12, 1);
  g.add(m);
  if (name) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 40; const x = c.getContext('2d');
    x.fillStyle = '#f2efe6'; x.fillRect(0, 0, 128, 40); x.fillStyle = '#1d3d6a'; x.fillRect(0, 0, 128, 8);
    x.fillStyle = '#222'; x.font = 'bold 15px monospace'; x.textAlign = 'center'; x.fillText(name, 64, 30);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.024), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }));
    tag.position.set(0.1, -0.2, 0.095); m.add(tag);
  }
  return g;
}

// ------------------------------------------------------------------ the sleepers
// A person lying on the floor under a lab coat used as a sheet. Origin at the hips, head toward +x.
// userData.update(t) breathes; userData.sit(k 0..1) sits the torso up under the sheet; userData.head(yaw)
let skinMat = null;
function drape(len, wid, height) {
  // a sheet over a body: heights from a capsule and a head, sagging to the floor at the edges
  const g = new THREE.PlaneGeometry(len, wid, 26, 10); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, height(x, z)); }
  g.computeVertexNormals();
  return g;
}
export function sleeper({ seed = 1, hand = true } = {}) {
  coatParts();
  if (!skinMat) skinMat = new THREE.MeshStandardMaterial({ color: 0x8b8a86, roughness: 0.55 });
  const r = rng(seed);
  const g = new THREE.Group();
  const body = (x, z, cx, len, rad) => { const t = clamp((x - cx) / len, -1, 1); const k = 1 - t * t; return Math.max(0, Math.sqrt(Math.max(0, rad * rad * k - z * z))); };
  const sheetH = (fn) => (x, z) => { const h = fn(x, z); const edge = smooth(0.5, 0.28, Math.abs(z)); return Math.max(0.012, h * 1.0 + 0.02) * (0.25 + 0.75 * edge) + 0.008; };
  // legs: hips (x=0) to feet (x=-0.95)
  const legs = new THREE.Mesh(drape(1.05, 0.95, sheetH((x, z) => Math.max(body(x - 0.5, z - 0.09, 0, 0.48, 0.1), body(x - 0.5, z + 0.09, 0, 0.48, 0.1), body(x - 0.5, z, 0.42, 0.18, 0.15)))), coatMat);
  legs.position.x = -0.5; legs.castShadow = legs.receiveShadow = true; g.add(legs);
  // torso pivots at the hips
  const torso = new THREE.Group(); g.add(torso);
  const chest = new THREE.Mesh(drape(0.72, 0.95, sheetH((x, z) => body(x, z, 0, 0.36, 0.17))), coatMat);
  chest.position.x = 0.36; chest.castShadow = chest.receiveShadow = true; torso.add(chest);
  const headPivot = new THREE.Group(); headPivot.position.set(0.74, 0.05, 0); torso.add(headPivot);
  const hood = new THREE.Mesh(drape(0.42, 0.5, sheetH((x, z) => Math.max(body(x, z, 0.02, 0.17, 0.12), 0.0))), coatMat);
  hood.position.x = 0.1; hood.castShadow = true; headPivot.add(hood);
  if (hand) {
    // one long grey hand out from under the edge, fingers too long, too many joints
    const hg = new THREE.Group(); hg.position.set(0.15, 0.02, (r() < 0.5 ? 1 : -1) * 0.42); hg.rotation.y = (r() - 0.5) * 0.8;
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.22, 7), skinMat); fore.rotation.z = Math.PI / 2; fore.position.x = -0.06; hg.add(fore);
    for (let f = 0; f < 4; f++) {
      const L = 0.13 + r() * 0.06 + (f === 1 || f === 2 ? 0.04 : 0);
      const fg = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.008, L, 5), skinMat);
      fg.rotation.z = Math.PI / 2 + (r() - 0.5) * 0.2; fg.rotation.y = (f - 1.5) * 0.18; fg.position.set(0.05 + L / 2, 0.005, (f - 1.5) * 0.018); hg.add(fg);
    }
    torso.add(hg);
  }
  const phase = r() * 6, rate = 0.22 + r() * 0.1;
  let sitK = 0, headYaw = 0;
  g.userData.update = (t) => { const b = Math.sin(t * rate * Math.PI * 2 + phase); chest.scale.y = 1 + 0.07 * b; chest.position.y = 0.003 * b; };
  g.userData.sit = (k) => { sitK = k; torso.rotation.z = k * 1.35; };
  g.userData.head = (yaw, tilt = 0) => { headYaw = yaw; headPivot.rotation.set(tilt, 0, 0); headPivot.rotation.y = yaw; };
  g.userData.parts = { torso, headPivot, legs };
  return g;
}

// ------------------------------------------------------------------ hiding
// spots: [{ at: V3 eye position, yaw, label, out: V3 where you step out to, near: V3 prompt point, crouch }]
export function hiding(game, { hunter, lampModel, spots, onHide, onLeave }) {
  const { player, ui, interact } = game;
  let cur = null;
  function hide(s) {
    const seen = hunter && hunter.state === 'chase' && hunter.playerVisibility() > 0;
    cur = s; s.onEnter?.();
    player.frozen = true; player.pos.set(s.at.x, 0, s.at.z); player.eyeOverride = s.at.y - (player.groundY || 0);
    player.yaw = s.yaw; player.pitch = s.pitch ?? -0.05;
    if (hunter) { hunter.playerHidden = true; hunter.sawHide = seen; }
    game.flashlight.on = false; ui.hiding(true); if (lampModel) lampModel.visible = false;
    sfx.debris(s.at, { amount: 0.12 });
    onHide?.(s);
  }
  function leave() {
    const s = cur; if (!s) return;
    s.onExit?.();
    player.pos.set(s.out.x, 0, s.out.z); player.eyeOverride = null; player.frozen = false;
    if (hunter) { hunter.playerHidden = false; hunter.sawHide = false; }
    ui.hiding(false); cur = null; if (lampModel) lampModel.visible = true;
    onLeave?.(s);
  }
  for (const s of spots) interact.add({ position: () => s.near || s.at, label: () => (cur ? 'Come out' : s.label), reach: 2, size: s.size ?? 0.6, enabled: () => (!cur && (s.enabled?.() ?? true)) || cur === s, onUse: () => (cur ? leave() : hide(s)) });
  return { get current() { return cur; }, leave, hide };
}

// ------------------------------------------------------------------ exposure (0..100): HUD, post effect, whispers
export class Exposure {
  constructor(game, value = 0) {
    this.game = game; this.value = value; this.shown = 0; this.whisperT = 8;
    const el = this.el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:calc(18px + env(safe-area-inset-left,0px));bottom:calc(64px + env(safe-area-inset-bottom,0px));z-index:9;font:500 10px/1 "IBM Plex Mono",monospace;letter-spacing:.2em;color:#9fb0a6;opacity:0;transition:opacity .6s;pointer-events:none';
    el.innerHTML = 'EXPOSURE<div style="margin-top:6px;width:120px;height:3px;background:#1a2421"><i style="display:block;height:100%;width:0;background:#8fae7a"></i></div>';
    document.body.appendChild(el); this.bar = el.querySelector('i');
  }
  add(v) { this.value = clamp(this.value + v, 0, 100); }
  update(dt) {
    this.shown += (this.value - this.shown) * (1 - Math.exp(-dt * 2));
    this.bar.style.width = this.shown.toFixed(1) + '%';
    this.bar.style.background = this.value > 70 ? '#c0503a' : this.value > 40 ? '#c4a24a' : '#8fae7a';
    this.el.style.opacity = this.value > 0.5 ? 1 : 0;
    const e = smooth(25, 100, this.value);
    this.game.expo = e;
    if (this.value > 35) { this.whisperT -= dt; if (this.whisperT <= 0) { this.whisperT = 14 + Math.random() * 20 - this.value * 0.1; sfx.whisper(null, { dur: 1 + Math.random() * 1.5, level: 0.25 + e * 0.5 }); } }
  }
  dispose() { this.el.remove(); this.game.expo = 0; }
}

// ------------------------------------------------------------------ the respirator: overlay, breath, filter
export class Respirator {
  constructor(game, { filter = 1, filters = 0 } = {}) {
    this.game = game; this.on = false; this.filter = filter; this.filters = filters;
    const el = this.el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:8;pointer-events:none;opacity:0;transition:opacity .35s';
    el.innerHTML = `<svg width="100%" height="100%" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" style="position:absolute;inset:0">
      <defs><radialGradient id="lensE" cx="50%" cy="50%" r="50%"><stop offset="80%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.75"/></radialGradient>
      <radialGradient id="fogG" cx="50%" cy="85%" r="70%"><stop offset="0%" stop-color="#cfd6d2" stop-opacity="0.32"/><stop offset="100%" stop-color="#cfd6d2" stop-opacity="0"/></radialGradient></defs>
      <path fill="#030404" fill-rule="evenodd" d="M-40 -40H200V130H-40Z M52 45m-33 0a33 30 0 1 0 66 0a33 30 0 1 0 -66 0Z M108 45m-33 0a33 30 0 1 0 66 0a33 30 0 1 0 -66 0Z"/>
      <ellipse cx="52" cy="45" rx="33" ry="30" fill="url(#lensE)"/><ellipse cx="108" cy="45" rx="33" ry="30" fill="url(#lensE)"/>
      <g class="fog" opacity="0"><ellipse cx="52" cy="52" rx="33" ry="24" fill="url(#fogG)"/><ellipse cx="108" cy="52" rx="33" ry="24" fill="url(#fogG)"/></g>
    </svg>
    <div class="flt" style="position:absolute;right:calc(18px + env(safe-area-inset-right,0px));bottom:calc(64px + env(safe-area-inset-bottom,0px));font:500 10px/1.4 'IBM Plex Mono',monospace;letter-spacing:.2em;color:#9fb0a6;text-align:right"></div>`;
    document.body.appendChild(el);
    this.fog = el.querySelector('.fog'); this.label = el.querySelector('.flt');
    this.loop = null; this.t = 0;
  }
  wear(on) {
    if (on === this.on) return;
    this.on = on; this.el.style.opacity = on ? 1 : 0;
    sfx.metalImpact(null, 0.08);
    if (on) { this.loop = sfx.loop('mask', null, 0.2); } else { this.loop?.stop(0.3); this.loop = null; }
  }
  // dt, consuming: true while the air is bad (the filter is used up); returns true if the mask protects you
  update(dt, consuming, fear = 0) {
    this.t += dt;
    if (!this.on) return false;
    if (consuming && this.filter > 0) this.filter = Math.max(0, this.filter - dt / 95);
    if (this.filter <= 0 && this.filters > 0 && consuming) { this.filters--; this.filter = 1; sfx.beep('click'); this.game.ui.toast('FILTER CHANGED', 2); }
    this.loop?.set(clamp(0.25 + fear * 0.75, 0, 1));
    this.fog.setAttribute('opacity', (0.35 + 0.35 * Math.sin(this.t * (1.1 + fear))).toFixed(2));
    this.label.innerHTML = `FILTER ${Math.round(this.filter * 100)}%${this.filters ? `<br>SPARE ×${this.filters}` : ''}`;
    this.label.style.color = this.filter < 0.25 ? '#d0705a' : '#9fb0a6';
    return this.filter > 0;
  }
  dispose() { this.loop?.stop(0.2); this.el.remove(); }
}

// ------------------------------------------------------------------ gas: layered, drifting, hugging the floor
export class Gas {
  constructor(scene, rect, { level = 0, color = 0x9fae8a, opacity = 0.16 } = {}) {
    this.level = level; this.layers = [];
    const uni = this.uni = { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } };
    const mat = new THREE.ShaderMaterial({
      uniforms: uni, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform float uTime, uOpacity; uniform vec3 uColor; varying vec3 vW;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
        void main() {
          vec2 p = vW.xz * 0.35 + vec2(uTime * 0.05, uTime * 0.03);
          float d = n(p) * 0.6 + n(p * 2.3 - uTime * 0.07) * 0.3 + n(p * 5.1 + uTime * 0.11) * 0.1;
          float a = uOpacity * smoothstep(0.25, 0.85, d);
          float fade = smoothstep(26.0, 3.0, distance(cameraPosition, vW));
          gl_FragColor = vec4(uColor, a * fade);
        }`,
    });
    const w = rect.x1 - rect.x0, d = rect.z1 - rect.z0;
    for (let k = 0; k < 4; k++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); m.rotation.x = -Math.PI / 2;
      m.position.set((rect.x0 + rect.x1) / 2, 0, (rect.z0 + rect.z1) / 2); m.renderOrder = 4; m.userData.dynamic = true; m.frustumCulled = false;
      scene.add(m); this.layers.push(m);
    }
    this.setLevel(level);
  }
  setLevel(y) { this.level = y; this.layers.forEach((m, k) => { m.position.y = Math.max(0.02, y - k * 0.28); m.visible = y > 0.03; }); }
  update(dt, t) { this.uni.uTime.value = t; }
}

// ------------------------------------------------------------------ someone walking in step behind you
// echo.step(playerPos, dir) on each of your footsteps while active; when you stop, one extra step.
export class StepEcho {
  constructor(surface = 'concrete') { this.surface = surface; this.on = false; this.lastStep = 0; this.extra = false; this.dist = 6; this.pending = []; }
  step(pos, back, time) {
    if (!this.on) return;
    const at = V(pos.x - back.x * this.dist, 0.1, pos.z - back.z * this.dist);
    this.pending.push({ t: time + 0.28 + Math.random() * 0.06, at });
    this.lastStep = time; this.extra = true; this.lastAt = at;
  }
  update(time) {
    for (const p of this.pending.splice(0)) { if (time >= p.t) sfx.footstep(p.at, this.surface, { run: false, player: false }); else this.pending.push(p); }
    if (this.on && this.extra && time - this.lastStep > 0.9) { this.extra = false; sfx.footstep(this.lastAt, this.surface, { run: false, player: false }); }
  }
}

export const mmss = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export { V, clamp, smooth };
