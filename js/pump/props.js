// Pump Level (Chapter Two) props, built on the Wing D kit's shared materials.
// Conventions as in the kit: metres, +Y up, origin on the floor, front faces +Z.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const PI = Math.PI, HP = PI / 2, TAU = PI * 2;
let M = {};
const fb = {};
const mat = (k, color = 0x777777, extra = {}) => M[k] || (fb[k] ??= new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra }));
export function usePumpMaterials(materials) { M = materials || {}; }

// collects geometry per material and merges it (one mesh per material)
class Parts {
  constructor() { this.map = new Map(); }
  add(m, g) { if (!this.map.has(m)) this.map.set(m, []); const gg = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(gg.attributes)) if (!['position', 'normal', 'uv'].includes(k)) gg.deleteAttribute(k); this.map.get(m).push(gg); return gg; }
  box(m, x, y, z, sx, sy, sz, r = null) { const g = new THREE.BoxGeometry(sx, sy, sz); if (r) g.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(...r))); g.translate(x, y, z); return this.add(m, g); }
  bb(m, x0, y0, z0, x1, y1, z1) { return this.box(m, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0); }
  cyl(m, a, b, r, seg = 16, r2 = r, open = false) {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    const g = new THREE.CylinderGeometry(r2, r, len, seg, 1, open);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    return this.add(m, g);
  }
  flange(m, at, dir, r, t = 0.03) { const d = dir.clone().normalize(); return this.cyl(m, at.clone().addScaledVector(d, -t / 2), at.clone().addScaledVector(d, t / 2), r, 18); }
  build(group = new THREE.Group()) {
    for (const [m, geos] of this.map) {
      const mesh = new THREE.Mesh(mergeGeometries(geos, false), m);
      mesh.castShadow = !m.transparent; mesh.receiveShadow = true; group.add(mesh);
    }
    return group;
  }
}
// box-projected uvs at a tile size, so the kit's tiled PBR materials sit right
function boxUV(g, s = 1) {
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); } else if (ax >= az) { u = p.getZ(i); v = p.getY(i); } else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u / s; uv[i * 2 + 1] = v / s;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
function finishUV(group, s = 0.8) { group.traverse((o) => { if (o.isMesh && o.material.map) boxUV(o.geometry, o.material.userData?.tile || s); }); return group; }

function canvasMesh(w, h, res, draw, { basic = false, transparent = false } = {}) {
  const c = document.createElement('canvas'); c.width = res; c.height = Math.round(res * h / w);
  const ctx = c.getContext('2d'); draw(ctx, c.width, c.height);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const m = basic ? new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent }) : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, transparent, polygonOffset: true, polygonOffsetFactor: -2 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  mesh.userData = { ctx, canvas: c, tex, redraw: (fn) => { fn(ctx, c.width, c.height); tex.needsUpdate = true; } };
  return mesh;
}
function stencil(ctx, s, x, y, px, color = '#111', align = 'center') { ctx.font = `900 ${px}px Arial Black, Arial, sans-serif`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y); }

// ------------------------------------------------------------------ a centrifugal drainage pump on a skid (long axis X)
export function pumpStation({ label = 'P1', color = 'greenPaint' } = {}) {
  const g = new THREE.Group(); g.name = 'pump';
  const P = new Parts();
  const paint = mat(color, 0x3f5a48), dark = mat('steelDark', 0x333333), galv = mat('galvanized', 0x9a9fa2);
  P.bb(dark, -1.35, 0, -0.6, 1.25, 0.08, 0.6); // concrete plinth edge / skid
  P.bb(mat('concrete', 0x888888), -1.45, 0, -0.7, 1.35, 0.06, 0.7);
  P.bb(dark, -1.3, 0.06, -0.45, 1.2, 0.2, -0.35); P.bb(dark, -1.3, 0.06, 0.35, 1.2, 0.2, 0.45); // skid rails
  const body = new THREE.Group(); g.add(body);
  const B = new Parts();
  const ax = 0.72; // shaft height
  // motor with cooling ribs and fan cowl
  B.cyl(paint, V(-1.2, ax, 0), V(-0.3, ax, 0), 0.31, 28);
  for (let i = 0; i < 18; i++) { const a = (i / 18) * TAU; B.box(paint, -0.75, ax + Math.sin(a) * 0.32, Math.cos(a) * 0.32, 0.8, 0.025, 0.025, [a, 0, 0]); }
  B.cyl(dark, V(-1.36, ax, 0), V(-1.2, ax, 0), 0.29, 28);
  B.cyl(paint, V(-0.3, ax, 0), V(-0.24, ax, 0), 0.33, 28);
  for (const z of [-0.22, 0.22]) B.bb(paint, -1.05, 0.2, z - 0.05, -0.45, ax - 0.2, z + 0.05); // feet
  B.bb(dark, -0.85, ax + 0.3, -0.12, -0.6, ax + 0.45, 0.12); // terminal box
  // coupling guard
  B.cyl(mat('yellowPaint', 0xd7a40f), V(-0.24, ax, 0), V(0.12, ax, 0), 0.17, 16);
  // volute casing + suction (down into the sump) + discharge (up to the header)
  B.cyl(paint, V(0.12, ax, 0), V(0.5, ax, 0), 0.45, 32);
  B.cyl(paint, V(0.5, ax, 0), V(0.62, ax, 0), 0.25, 24);
  B.cyl(galv, V(0.62, ax, 0), V(1.05, ax, 0), 0.16, 20); B.flange(dark, V(0.66, ax, 0), V(1, 0, 0), 0.24); B.flange(dark, V(1.0, ax, 0), V(1, 0, 0), 0.24);
  B.cyl(galv, V(1.05, ax, 0), V(1.05, -0.2, 0), 0.16, 20);
  B.cyl(galv, V(0.3, ax + 0.4, 0), V(0.3, 3.4, 0), 0.14, 20); B.flange(dark, V(0.3, ax + 0.5, 0), V(0, 1, 0), 0.22); B.flange(dark, V(0.3, 1.9, 0), V(0, 1, 0), 0.22);
  B.cyl(mat('redPaint', 0xa3150f), V(0.3, 1.45, -0.05), V(0.3, 1.45, -0.32), 0.035, 10); // gate valve stem
  B.add(mat('redPaint', 0xa3150f), new THREE.TorusGeometry(0.14, 0.018, 8, 24).translate(0, 0, 0).rotateX(HP).translate(0.3, 1.45, -0.34).rotateX(0));
  B.build(body);
  P.build(g);
  // nameplate
  const plate = canvasMesh(0.36, 0.2, 256, (c, w, h) => { c.fillStyle = '#c9c5b6'; c.fillRect(0, 0, w, h); c.strokeStyle = '#333'; c.lineWidth = 4; c.strokeRect(4, 4, w - 8, h - 8); stencil(c, `DRAINAGE ${label}`, w / 2, h * 0.3, 24); c.font = '15px monospace'; c.fillStyle = '#222'; c.textAlign = 'center'; c.fillText('45 kW · 1480 RPM · 210 m³/h', w / 2, h * 0.62); c.fillText('HALVERSEN SITE 41 · D-3', w / 2, h * 0.82); });
  plate.position.set(-0.75, ax, 0.33); g.add(plate);
  finishUV(g);
  let running = false;
  g.userData.setRunning = (on) => { running = on; };
  g.userData.update = (t) => { if (!running) { body.position.set(0, 0, 0); return; } body.position.y = Math.sin(t * 157) * 0.0012; body.position.z = Math.sin(t * 131) * 0.0009; };
  g.userData.collider = { w: 2.9, d: 1.4 };
  return g;
}

// ------------------------------------------------------------------ pump control panel with a pressure gauge (wall-mounted, back at z=0)
export function pumpPanel({ label = 'P1', note = '' } = {}) {
  const g = new THREE.Group(); g.name = 'pumpPanel';
  const P = new Parts();
  const W = 0.6, H = 0.8, D = 0.22;
  P.bb(mat('steelPaint', 0xb7b9b3), -W / 2, -H / 2, 0, W / 2, H / 2, D);
  P.bb(mat('steelDark', 0x333333), -W / 2 - 0.03, -H / 2 - 0.03, -0.02, W / 2 + 0.03, H / 2 + 0.03, 0);
  P.cyl(mat('pvc', 0x8a8d8f), V(-0.2, H / 2, 0.1), V(-0.2, 2.6, 0.1), 0.03, 10);
  P.cyl(mat('pvc', 0x8a8d8f), V(0.15, -H / 2, 0.1), V(0.15, -1.25, 0.1), 0.025, 10);
  P.build(g);
  // gauge (redrawn when the needle moves)
  const gauge = canvasMesh(0.3, 0.3, 256, () => {}, { basic: false });
  gauge.position.set(0, 0.12, D + 0.004); g.add(gauge);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.152, 0.012, 8, 32), mat('galvanized', 0x9a9fa2)); rim.position.set(0, 0.12, D + 0.005); g.add(rim);
  let green = [0.62, 0.78];
  const draw = (v) => gauge.userData.redraw((c, w, h) => {
    const cx = w / 2, cy = h / 2, r = w * 0.46;
    c.fillStyle = '#e9e5d8'; c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.fill();
    const a0 = PI * 0.75, a1 = PI * 2.25, ang = (u) => a0 + (a1 - a0) * u;
    c.lineWidth = r * 0.14;
    c.strokeStyle = '#2f8a3a'; c.beginPath(); c.arc(cx, cy, r * 0.78, ang(green[0]), ang(green[1])); c.stroke();
    c.strokeStyle = '#b3261e'; c.beginPath(); c.arc(cx, cy, r * 0.78, ang(0.86), ang(1)); c.stroke();
    c.strokeStyle = '#222'; c.lineWidth = 3;
    for (let i = 0; i <= 10; i++) { const a = ang(i / 10); c.beginPath(); c.moveTo(cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62); c.lineTo(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7); c.stroke(); }
    c.fillStyle = '#222'; c.font = 'bold 20px monospace'; c.textAlign = 'center'; c.fillText('BAR', cx, cy + r * 0.45); c.font = '15px monospace'; c.fillText(label + ' SUCTION', cx, cy - r * 0.35);
    const a = ang(Math.max(0, Math.min(1, v)));
    c.strokeStyle = '#111'; c.lineWidth = 6; c.beginPath(); c.moveTo(cx - Math.cos(a) * r * 0.1, cy - Math.sin(a) * r * 0.1); c.lineTo(cx + Math.cos(a) * r * 0.72, cy + Math.sin(a) * r * 0.72); c.stroke();
    c.fillStyle = '#111'; c.beginPath(); c.arc(cx, cy, 9, 0, TAU); c.fill();
    const glare = c.createLinearGradient(0, 0, w, h); glare.addColorStop(0, 'rgba(255,255,255,0.18)'); glare.addColorStop(0.5, 'rgba(255,255,255,0)'); c.fillStyle = glare; c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.fill();
  });
  // status lamps + buttons
  const lampGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.02, 14).rotateX(HP);
  const lamps = {};
  const col = { off: [0x202020, 0x000000, 0], amber: [0x3a2a08, 0xffa020, 3.5], green: [0x0a3010, 0x30ff60, 3.5], red: [0x300808, 0xff2a1a, 3.5] };
  for (const [k, x] of [['amber', -0.16], ['green', 0], ['red', 0.16]]) {
    const m = new THREE.Mesh(lampGeo, new THREE.MeshStandardMaterial({ color: col.off[0], roughness: 0.3 }));
    m.position.set(x, -0.15, D + 0.01); g.add(m); lamps[k] = m;
  }
  const setLamp = (which) => { for (const [k, m] of Object.entries(lamps)) { const [c, e, i] = k === which ? col[k] : col.off; m.material.color.setHex(c); m.material.emissive.setHex(e); m.material.emissiveIntensity = i; } };
  // bleed valve handle (turns when you close it)
  const handle = new THREE.Group(); handle.position.set(0, -0.3, D + 0.03);
  const HP2 = new Parts(); HP2.box(mat('redPaint', 0xa3150f), 0, 0, 0.02, 0.2, 0.035, 0.03); HP2.cyl(mat('steelDark', 0x333333), V(0, 0, -0.03), V(0, 0, 0.02), 0.02, 10); HP2.build(handle);
  g.add(handle);
  const face = canvasMesh(W - 0.06, 0.14, 256, (c, w, h) => { c.fillStyle = '#efeadb'; c.fillRect(0, 0, w, h); stencil(c, `PUMP ${label}`, w / 2, h * 0.42, 22); c.font = '12px monospace'; c.fillStyle = '#333'; c.textAlign = 'center'; c.fillText(note || 'PRIME · CLOSE BLEED IN GREEN', w / 2, h * 0.82); });
  face.position.set(0, H / 2 - 0.1, D + 0.003); g.add(face);
  draw(0); setLamp('off');
  g.userData = { setNeedle: draw, setLamp, handle, setGreen: (a, b) => { green = [a, b]; }, collider: null };
  return g;
}

// ------------------------------------------------------------------ an emergency light: a yellow twin-head box on the wall (front +Z)
export function emergencyLight() {
  const g = new THREE.Group();
  const P = new Parts();
  P.bb(mat('yellowPaint', 0xd7a40f), -0.18, -0.08, 0, 0.18, 0.08, 0.12);
  for (const x of [-0.11, 0.11]) P.cyl(mat('steelDark', 0x333333), V(x, -0.05, 0.08), V(x, -0.12, 0.16), 0.05, 12);
  P.build(g);
  const lensMat = new THREE.MeshStandardMaterial({ color: 0xffe0b0, emissive: 0xffc070, emissiveIntensity: 3 });
  for (const x of [-0.11, 0.11]) { const l = new THREE.Mesh(new THREE.CircleGeometry(0.042, 14), lensMat); l.position.set(x, -0.125, 0.165); l.lookAt(x, -0.4, 0.5); g.add(l); }
  g.userData.lens = lensMat;
  return g;
}

// ------------------------------------------------------------------ ladder-type cable tray with cables, along X (origin at its centre)
export function cableTray({ length = 6, width = 0.45, cables = 7, seed = 1 } = {}) {
  let s = seed; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const P = new Parts();
  const galv = mat('galvanized', 0x9a9fa2);
  for (const z of [-width / 2, width / 2]) P.bb(galv, -length / 2, -0.04, z - 0.01, length / 2, 0.06, z + 0.01);
  for (let x = -length / 2 + 0.15; x < length / 2; x += 0.3) P.bb(galv, x - 0.015, -0.04, -width / 2, x + 0.015, -0.02, width / 2);
  const cab = [mat('plasticBlack', 0x1b1c1e), mat('plasticOrange', 0xd2541a), mat('plasticGrey', 0x8c8f90)];
  for (let i = 0; i < cables; i++) {
    const z = -width / 2 + 0.05 + (i / Math.max(1, cables - 1)) * (width - 0.1), rad = 0.012 + r() * 0.012;
    P.cyl(cab[i % 3], V(-length / 2, -0.02 + rad, z), V(length / 2, -0.02 + rad, z), rad, 6);
  }
  return finishUV(P.build(new THREE.Group()), 1.2);
}

// ------------------------------------------------------------------ a watertight pressure door (front +Z); opens by swinging out
export function pressureDoor({ w = 1.2, h = 2.1 } = {}) {
  const g = new THREE.Group();
  const P = new Parts();
  const steel = mat('liftSteel', 0x8a9092), dark = mat('steelDark', 0x333333);
  P.bb(steel, -w / 2 - 0.18, 0, -0.15, -w / 2, h + 0.18, 0.12);
  P.bb(steel, w / 2, 0, -0.15, w / 2 + 0.18, h + 0.18, 0.12);
  P.bb(steel, -w / 2 - 0.18, h, -0.15, w / 2 + 0.18, h + 0.18, 0.12);
  P.bb(mat('hazard', 0xd7a40f), -w / 2 - 0.18, 0, 0.12, w / 2 + 0.18, 0.06, 0.2);
  P.build(g);
  const leafPivot = new THREE.Group(); leafPivot.position.set(-w / 2, 0, 0.04); g.add(leafPivot);
  const L = new Parts();
  L.bb(mat('liftDoor', 0x8d9396), 0, 0.02, -0.06, w, h - 0.02, 0.04);
  for (const y of [0.35, h - 0.35]) L.bb(dark, 0.05, y - 0.06, 0.04, 0.2, y + 0.06, 0.08); // hinges / dogs
  for (const y of [0.5, h / 2, h - 0.5]) L.bb(dark, w - 0.14, y - 0.04, 0.04, w - 0.02, y + 0.04, 0.09);
  L.cyl(dark, V(w / 2, h * 0.55, 0.04), V(w / 2, h * 0.55, 0.14), 0.03, 10);
  L.add(mat('redPaint', 0xa3150f), new THREE.TorusGeometry(0.2, 0.022, 10, 28).translate(w / 2, h * 0.55, 0.15));
  for (let i = 0; i < 4; i++) { const a = i * HP; L.box(mat('redPaint', 0xa3150f), w / 2 + Math.cos(a) * 0.1, h * 0.55 + Math.sin(a) * 0.1, 0.15, 0.2, 0.02, 0.02, [0, 0, a]); }
  L.build(leafPivot);
  const sign = canvasMesh(0.6, 0.32, 256, (c, ww, hh) => { c.fillStyle = '#e8e3d2'; c.fillRect(0, 0, ww, hh); c.fillStyle = '#123f8a'; c.fillRect(0, 0, ww, hh * 0.32); stencil(c, 'PRESSURE DOOR', ww / 2, hh * 0.16, 22, '#fff'); stencil(c, 'STAIR B · ARCHIVE', ww / 2, hh * 0.5, 20); c.font = '13px monospace'; c.fillStyle = '#7a1010'; c.textAlign = 'center'; c.fillText('WILL NOT OPEN UNDER HEAD OF WATER', ww / 2, hh * 0.8); });
  sign.position.set(w / 2, h * 0.8, 0.045); leafPivot.add(sign);
  finishUV(g);
  g.userData.setOpen = (v) => { leafPivot.rotation.y = -v * 1.75; };
  g.userData.colliders = [{ minX: -w / 2 - 0.2, maxX: -w / 2, minZ: -0.15, maxZ: 0.12 }, { minX: w / 2, maxX: w / 2 + 0.2, minZ: -0.15, maxZ: 0.12 }];
  return g;
}

// ------------------------------------------------------------------ Sgt. Halloran: pinned, sitting against the wall, legs under the tray (faces +Z)
export function pinnedMan() {
  const g = new THREE.Group(); g.name = 'halloran';
  const navy = new THREE.MeshStandardMaterial({ color: 0x1a2130, roughness: 0.85 });
  const hi = new THREE.MeshStandardMaterial({ color: 0x8a8f2a, roughness: 0.6, emissive: 0x1a1c00 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x9a7560, roughness: 0.65 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x1e1a17, roughness: 0.9 });
  const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
  // seated, slumped against the wall at z = 0, legs out along +Z under the water
  add(new THREE.CapsuleGeometry(0.19, 0.42, 6, 14), navy, 0, 0.55, 0.12, -0.25);
  add(new THREE.BoxGeometry(0.4, 0.05, 0.02), hi, 0, 0.72, 0.31, -0.25); // reflective band
  add(new THREE.CapsuleGeometry(0.075, 0.5, 4, 10), navy, -0.12, 0.18, 0.55, HP); add(new THREE.CapsuleGeometry(0.075, 0.5, 4, 10), navy, 0.12, 0.18, 0.55, HP);
  const head = add(new THREE.SphereGeometry(0.11, 18, 14), skin, 0.02, 1.02, 0.08); head.scale.set(0.92, 1.1, 1);
  add(new THREE.SphereGeometry(0.115, 18, 10, 0, TAU, 0, PI * 0.55), hair, 0.02, 1.04, 0.06, -0.2);
  const armL = add(new THREE.CapsuleGeometry(0.055, 0.42, 4, 10), navy, -0.25, 0.62, 0.3, -1.1, 0, 0.3);
  add(new THREE.CapsuleGeometry(0.06, 0.4, 4, 10), navy, 0.24, 0.5, 0.2, -0.3, 0, -0.2);
  add(new THREE.SphereGeometry(0.05, 10, 8), skin, -0.3, 0.72, 0.52);
  g.userData.head = head; g.userData.arm = armL;
  return g;
}
