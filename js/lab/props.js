// HALVERSEN biocontainment lab — procedural prop library.
// Units are metres, +Y up. Every factory returns a THREE.Group whose origin sits on the floor at the
// centre of its footprint with its front facing +Z (wall items: origin on the wall surface, front +Z).
// Static sub-parts are merged per material; materials and label atlases are cached at module level.
// All textures are drawn on canvases at run time: no external assets.
//
// Game hooks (group.userData):
//   collider {w,d}            floor props (null for wall / small / benchtop items)
//   screens [{canvas,ctx,texture,mesh,width,height}]  workstation, controlConsole, centrifuge, analyzer, badgeReader
//   buttons {name: mesh}      controlConsole ('CELL A LIGHT','CELL B LIGHT','TONE','STROBE','SEAL A','SEAL B','VENT',
//                             'E-STOP L','E-STOP R','TALK'); each mesh.userData.setLit(bool)
//   setState('idle'|'ok'|'deny')  badgeReader, keypad
//   setOn(bool), lamp, rotor, update(t)  emergencyBeacon      setOn(bool), heads  surgicalLight
//   diffuser, setLevel(0..1)  ceilingLightPanel               head, led, setRecording(bool)  securityCamera
//   leaf, openX | openY, setLocked(bool), status  door        sash, light, setLight(bool)  fumeHood
//   flash, setFlash(0..1), setCharge(0..1), chargeLeds  halideLamp   update(t) (LED blink), door  serverRack
//   ajarDoor  lockerBank (when ajar)
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const PI = Math.PI, TAU = Math.PI * 2, HP = Math.PI / 2;
const SRGB = THREE.SRGBColorSpace;

export const PALETTE = {
  white: '#e8eaea', grey: '#c9cdd0', rubber: '#1a1c1e', teal: '#1f8a8a', bio: '#d9481c',
  red: '#c8191b', yellow: '#f2c200', black: '#141618', exit: '#108a43',
};

// ------------------------------------------------------------------ random
function rng(seed) {
  let a = (seed >>> 0) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let _autoSeed = 17;
const seedOf = (s) => (s ?? (_autoSeed += 7919)) >>> 0;
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------ canvas helpers
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
const F = (px, w = 600) => `${w} ${Math.max(1, Math.round(px))}px Arial`;

function txt(ctx, s, x, y, px, o = {}) {
  const { w = 600, color = '#1b1f22', align = 'center', base = 'middle', maxW = 0, spacing = 0 } = o;
  ctx.save();
  ctx.font = F(px, w);
  ctx.letterSpacing = spacing ? `${spacing * px}px` : '0px';
  if (maxW) { const m = ctx.measureText(s).width; if (m > maxW) { px *= maxW / m; ctx.font = F(px, w); ctx.letterSpacing = spacing ? `${spacing * px}px` : '0px'; } }
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base;
  ctx.fillText(s, x, y);
  ctx.restore();
}
function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function hexPath(ctx, cx, cy, r, rot = PI / 6) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) { const a = rot + (i * PI) / 3; ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  ctx.closePath();
}
// HALVERSEN mark: hexagon outline with a solid inner hexagon
function hexMark(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = r * 0.2; ctx.lineJoin = 'miter';
  hexPath(ctx, cx, cy, r * 0.88); ctx.stroke();
  hexPath(ctx, cx, cy, r * 0.42); ctx.fill();
  ctx.restore();
}
function wordmark(ctx, x, y, px, color, align = 'left') {
  ctx.save();
  ctx.font = F(px, 700); ctx.letterSpacing = `${px * 0.14}px`;
  const tw = ctx.measureText('HALVERSEN').width, mw = px * 1.25, full = mw + tw;
  let x0 = align === 'center' ? x - full / 2 : align === 'right' ? x - full : x;
  hexMark(ctx, x0 + px * 0.5, y, px * 0.55, color);
  ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('HALVERSEN', x0 + mw, y + px * 0.04);
  ctx.restore();
  return full;
}
function stripes(ctx, x, y, w, h, period, c1 = PALETTE.yellow, c2 = PALETTE.black) {
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = c1; ctx.fillRect(x, y, w, h); ctx.fillStyle = c2;
  for (let s = -h - period; s < w + h; s += period) {
    ctx.beginPath(); ctx.moveTo(x + s, y + h); ctx.lineTo(x + s + period / 2, y + h); ctx.lineTo(x + s + period / 2 + h, y); ctx.lineTo(x + s + h, y); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
function bioSymbol(ctx, cx, cy, R, color) {
  const s = Math.ceil(R * 2.6), o = s / 2, c = mkCanvas(s, s), g = c.getContext('2d');
  const dirs = [-HP, -HP + TAU / 3, -HP + (2 * TAU) / 3];
  g.fillStyle = color; g.strokeStyle = color;
  for (const a of dirs) { g.beginPath(); g.arc(o + Math.cos(a) * R * 0.44, o + Math.sin(a) * R * 0.44, R * 0.56, 0, TAU); g.fill(); }
  g.lineWidth = R * 0.11; g.beginPath(); g.arc(o, o, R * 0.6, 0, TAU); g.stroke();
  g.globalCompositeOperation = 'destination-out';
  for (const a of dirs) { g.beginPath(); g.arc(o + Math.cos(a) * R * 0.6, o + Math.sin(a) * R * 0.6, R * 0.4, 0, TAU); g.fill(); }
  g.beginPath(); g.arc(o, o, R * 0.15, 0, TAU); g.fill();
  g.lineWidth = R * 0.06;
  for (const a of dirs) { g.beginPath(); g.moveTo(o, o); g.lineTo(o + Math.cos(a) * R * 0.3, o + Math.sin(a) * R * 0.3); g.stroke(); }
  ctx.drawImage(c, cx - o, cy - o);
}
function warnTriangle(ctx, cx, cy, s, fill = PALETTE.yellow, edge = PALETTE.black) {
  ctx.save();
  const h = s * 0.87;
  ctx.beginPath(); ctx.moveTo(cx, cy - h / 2); ctx.lineTo(cx + s / 2, cy + h / 2); ctx.lineTo(cx - s / 2, cy + h / 2); ctx.closePath();
  ctx.fillStyle = edge; ctx.fill();
  const k = 0.74;
  ctx.beginPath(); ctx.moveTo(cx, cy - (h / 2) * k + s * 0.04); ctx.lineTo(cx + (s / 2) * k, cy + (h / 2) * k + s * 0.02); ctx.lineTo(cx - (s / 2) * k, cy + (h / 2) * k + s * 0.02); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  ctx.fillStyle = edge; ctx.fillRect(cx - s * 0.045, cy - s * 0.14, s * 0.09, s * 0.3); ctx.beginPath(); ctx.arc(cx, cy + s * 0.27, s * 0.055, 0, TAU); ctx.fill();
  ctx.restore();
}
function barcode(ctx, x, y, w, h, seed = 1) {
  const r = rng(seed); ctx.save(); ctx.fillStyle = '#111';
  let px = x; while (px < x + w) { const bw = 1 + Math.floor(r() * 3) * (w / 120); if (r() > 0.42) ctx.fillRect(px, y, bw, h); px += bw + w / 160; }
  ctx.restore();
}
function grain(ctx, w, h, amt = 0.04, seed = 3) {
  const r = rng(seed), n = Math.floor((w * h) / 40);
  ctx.save();
  for (let i = 0; i < n; i++) { ctx.fillStyle = r() > 0.5 ? `rgba(0,0,0,${amt * r()})` : `rgba(255,255,255,${amt * r()})`; ctx.fillRect(r() * w, r() * h, 2, 2); }
  ctx.restore();
}

// ------------------------------------------------------------------ textures
const _tex = new Map();
function cachedTex(key, make) { let t = _tex.get(key); if (!t) { t = make(); _tex.set(key, t); } return t; }
function texFrom(c, { srgb = true, repeat = null, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = SRGB;
  t.anisotropy = aniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function noiseCanvas(size, fn, seed) {
  const c = mkCanvas(size, size), ctx = c.getContext('2d'), img = ctx.createImageData(size, size), r = rng(seed);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = Math.max(0, Math.min(255, fn(x, y, r))), i = (y * size + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
const TEX = {
  // powder coat: fine speckle with a few soft smudges (roughness map, values ~0.8-1.0)
  speckle: () => cachedTex('speckle', () => {
    const c = noiseCanvas(256, (x, y, r) => 222 + r() * 33 - (r() < 0.004 ? 50 : 0), 11);
    const ctx = c.getContext('2d'), r = rng(5);
    for (let i = 0; i < 14; i++) { ctx.fillStyle = `rgba(150,150,150,${0.05 + r() * 0.06})`; ctx.beginPath(); ctx.ellipse(r() * 256, r() * 256, 8 + r() * 30, 5 + r() * 18, r() * PI, 0, TAU); ctx.fill(); }
    return texFrom(c, { srgb: false, repeat: [2, 2] });
  }),
  // brushed metal: horizontal streaks
  brushed: () => cachedTex('brushed', () => {
    const rows = []; const r0 = rng(21); for (let y = 0; y < 512; y++) rows.push(r0());
    const c = noiseCanvas(512, (x, y, r) => 175 + rows[y] * 55 + r() * 18 + Math.sin(x * 0.02 + rows[y] * 9) * 6, 22);
    return texFrom(c, { srgb: false, repeat: [1, 1] });
  }),
  // perforated sheet (alpha map: white = solid)
  perf: () => cachedTex('perf', () => {
    const c = mkCanvas(128, 128), ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 128, 128); ctx.fillStyle = '#000';
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { ctx.beginPath(); ctx.arc(x * 16 + 8 + (y % 2) * 8, y * 16 + 8, 5.2, 0, TAU); ctx.fill(); }
    return texFrom(c, { srgb: false, repeat: [20, 20] });
  }),
  fabric: () => cachedTex('fabric', () => {
    const c = noiseCanvas(256, (x, y, r) => 200 + ((x % 4 < 2) ^ (y % 4 < 2) ? 25 : 0) + r() * 25, 31);
    return texFrom(c, { srgb: false, repeat: [6, 6] });
  }),
  rubberGrip: () => cachedTex('rubberGrip', () => {
    const c = noiseCanvas(128, (x, y, r) => ((x + y) % 8 < 2 || (x - y + 256) % 8 < 2 ? 140 : 235) + r() * 15, 41);
    return texFrom(c, { srgb: false, repeat: [3, 6] });
  }),
};

// ------------------------------------------------------------------ materials (lazy, shared)
const _mats = new Map();
function cachedMat(key, make) {
  let m = _mats.get(key);
  if (!m) { m = make(); m.name = key; _mats.set(key, m); }
  return m;
}
const std = (o) => new THREE.MeshStandardMaterial(o);
const phys = (o) => new THREE.MeshPhysicalMaterial(o);
const noShadow = (m) => { m.userData.noShadow = true; return m; };
const noCast = (m) => { m.userData.noCast = true; return m; };

const MATDEF = {
  white: () => std({ color: 0xe8eaea, roughness: 0.42, roughnessMap: TEX.speckle() }),
  whiteGloss: () => phys({ color: 0xeef0f0, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.18, roughnessMap: TEX.speckle() }),
  grey: () => std({ color: 0xc9cdd0, roughness: 0.48, roughnessMap: TEX.speckle() }),
  greyGloss: () => phys({ color: 0xc4c9cc, roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.25 }),
  midGrey: () => std({ color: 0x8b9298, roughness: 0.5 }),
  darkGrey: () => std({ color: 0x3a4045, roughness: 0.45 }),
  panelDark: () => phys({ color: 0x2a2f34, roughness: 0.4, clearcoat: 0.3, clearcoatRoughness: 0.4 }),
  steel: () => std({ color: 0xc9cdd2, metalness: 1, roughness: 0.3, roughnessMap: TEX.brushed() }),
  steelDark: () => std({ color: 0x8e949a, metalness: 1, roughness: 0.42, roughnessMap: TEX.brushed() }),
  chrome: () => std({ color: 0xe6e9ec, metalness: 1, roughness: 0.12 }),
  alu: () => std({ color: 0xbfc4c8, metalness: 0.9, roughness: 0.38 }),
  rubber: () => std({ color: 0x1a1c1e, roughness: 0.86 }),
  black: () => std({ color: 0x1c1f22, roughness: 0.45 }),
  blackGloss: () => phys({ color: 0x0c0d0f, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }),
  rack: () => std({ color: 0x16181b, roughness: 0.55, metalness: 0.3 }),
  teal: () => phys({ color: 0x1f8a8a, roughness: 0.38, clearcoat: 0.4, clearcoatRoughness: 0.3 }),
  orange: () => phys({ color: 0xd9481c, roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.25 }),
  red: () => phys({ color: 0xc8191b, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
  yellow: () => phys({ color: 0xe8b81c, roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.2 }),
  yellowPaint: () => std({ color: 0xe4b51e, roughness: 0.55, roughnessMap: TEX.speckle() }),
  epoxy: () => phys({ color: 0x24282b, roughness: 0.34, clearcoat: 0.6, clearcoatRoughness: 0.2, roughnessMap: TEX.speckle() }),
  brass: () => std({ color: 0xc19a4b, metalness: 1, roughness: 0.3 }),
  glass: () => noShadow(phys({ color: 0xe4f4f4, transparent: true, opacity: 0.2, roughness: 0.05, metalness: 0, depthWrite: false, envMapIntensity: 1.6, side: THREE.DoubleSide })),
  glassDark: () => noShadow(phys({ color: 0x55666a, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0, depthWrite: false, envMapIntensity: 1.6 })),
  glassAmber: () => noShadow(phys({ color: 0x9a5a14, transparent: true, opacity: 0.6, roughness: 0.08, metalness: 0, depthWrite: false, envMapIntensity: 1.4 })),
  redLens: () => noShadow(phys({ color: 0xc01010, transparent: true, opacity: 0.55, roughness: 0.1, depthWrite: false })),
  screenOff: () => phys({ color: 0x07090a, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 }),
  cloth: () => std({ color: 0x3f7f9a, roughness: 0.95, roughnessMap: TEX.fabric() }),
  sheet: () => std({ color: 0xe9eef0, roughness: 0.92, roughnessMap: TEX.fabric() }),
  vinyl: () => phys({ color: 0x5d7f8c, roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.5 }),
  fabricDark: () => std({ color: 0x2b3034, roughness: 0.9, roughnessMap: TEX.fabric() }),
  mesh: () => std({ color: 0x24282c, roughness: 0.8, alphaMap: TEX.perf(), alphaTest: 0.5, side: THREE.DoubleSide }),
  perfSteel: () => std({ color: 0xc0c5ca, metalness: 0.9, roughness: 0.4, alphaMap: TEX.perf(), alphaTest: 0.5, side: THREE.DoubleSide }),
  hazmat: () => phys({ color: 0xe6c21e, roughness: 0.55, sheen: 0.4, sheenColor: 0xfff2a0, roughnessMap: TEX.fabric() }),
  flesh: () => phys({ color: 0xd9c6b4, roughness: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.3, sheen: 0.5, sheenColor: 0xffd8c8 }),
  fleshDark: () => phys({ color: 0xa88b78, roughness: 0.55, clearcoat: 0.5, clearcoatRoughness: 0.35 }),
  murk: () => noShadow(phys({ color: 0xb8bd5a, transparent: true, opacity: 0.52, roughness: 0.15, depthWrite: false, envMapIntensity: 0.8 })),
  paper: () => std({ color: 0xf4f4ee, roughness: 0.9 }),
  cardboard: () => std({ color: 0xb08a5c, roughness: 0.9 }),
  magenta: () => std({ color: 0xb0307a, roughness: 0.5 }),
  coffee: () => phys({ color: 0x1e0f08, roughness: 0.1, clearcoat: 1 }),
  wire: () => std({ color: 0xb9bec2, metalness: 1, roughness: 0.35 }),
  cableBlack: () => std({ color: 0x17191b, roughness: 0.6 }),
  cableGrey: () => std({ color: 0x8a9095, roughness: 0.55 }),
  cableBlue: () => std({ color: 0x2c63b8, roughness: 0.5 }),
  cableYellow: () => std({ color: 0xd6b01e, roughness: 0.5 }),
  cableTeal: () => std({ color: 0x1f8a8a, roughness: 0.5 }),
  cableRed: () => std({ color: 0xb02020, roughness: 0.5 }),
  dark: () => std({ color: 0x08090a, roughness: 0.9 }),
};
const M = new Proxy({}, { get: (_, k) => cachedMat(k, MATDEF[k]) });
function paint(hex, rough = 0.45, metal = 0) { return cachedMat(`paint${hex}_${rough}_${metal}`, () => phys({ color: hex, roughness: rough, metalness: metal, clearcoat: 0.3, clearcoatRoughness: 0.3, roughnessMap: TEX.speckle() })); }
function led(hex, intensity = 2.6) { return cachedMat(`led${hex}_${intensity}`, () => noShadow(std({ color: 0x111111, emissive: hex, emissiveIntensity: intensity, roughness: 0.3 }))); }
function fluid(hex, opacity = 0.62) { return cachedMat(`fluid${hex}_${opacity}`, () => noShadow(phys({ color: hex, transparent: true, opacity, roughness: 0.08, depthWrite: false, envMapIntensity: 1.2 }))); }
function plastic(hex, rough = 0.4) { return cachedMat(`plastic${hex}_${rough}`, () => phys({ color: hex, roughness: rough, clearcoat: 0.4, clearcoatRoughness: 0.3 })); }
// per-instance emissive material (for things the game switches)
function lamp(hex, intensity = 2.5, base = 0x222222) { return noShadow(std({ color: base, emissive: hex, emissiveIntensity: intensity, roughness: 0.3 })); }

// ------------------------------------------------------------------ geometry helpers
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s1 = new THREE.Vector3(1, 1, 1);
function T(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  if (rx || ry || rz) { _e.set(rx, ry, rz); _q.setFromEuler(_e); } else _q.identity();
  _m4.compose(_v.set(x, y, z), _q, _s1); g.applyMatrix4(_m4); return g;
}
function S(g, sx, sy, sz) { g.scale(sx, sy, sz); return g; }
const box = (w, h, d, ...t) => T(new THREE.BoxGeometry(w, h, d), ...t);
function rbox(w, h, d, r, ...t) {
  const lim = Math.min(w, h, d) / 2 - 1e-4; r = Math.max(1e-4, Math.min(r, lim));
  const seg = Math.max(w, h, d) < 0.12 || r < 0.003 ? 1 : 2;
  return T(new RoundedBoxGeometry(w, h, d, seg, r), ...t);
}
const cyl = (r, h, seg, ...t) => T(new THREE.CylinderGeometry(r, r, h, seg), ...t);
const cone = (rt, rb, h, seg, ...t) => T(new THREE.CylinderGeometry(rt, rb, h, seg), ...t);
const sph = (r, ws, hs, ...t) => T(new THREE.SphereGeometry(r, ws, hs), ...t);
const tor = (R, r, rs, ts, arc, ...t) => T(new THREE.TorusGeometry(R, r, rs, ts, arc), ...t);
const lathe = (pts, seg, ...t) => { if (pts[0][1] > pts[pts.length - 1][1]) pts = pts.slice().reverse(); return T(new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), seg), ...t); };
const plane = (w, h, ...t) => T(new THREE.PlaneGeometry(w, h), ...t);
function tube(pts, r, seg = 24, rs = 6, closed = false) {
  const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), closed, 'centripetal');
  return new THREE.TubeGeometry(c, seg, r, rs, closed);
}
function shapeRR(w, h, r, cx = 0, cy = 0) {
  const s = new THREE.Shape(), x = cx - w / 2, y = cy - h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
function extrude(shape, depth, bevel = 0, curveSeg = 4) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: curveSeg });
  return g;
}
// flat slab (x centred, y from 0, z centred) with rectangular holes; caps get world-space UVs
function slab(w, h, t, holes = [], r = 0.004, bevel = 0.003) {
  const sh = shapeRR(w - 2 * bevel, h - 2 * bevel, r, 0, h / 2);
  for (const o of holes) { const hp = shapeRR(o.w + 2 * bevel, o.h + 2 * bevel, o.r ?? 0.01, o.x, o.y); sh.holes.push(new THREE.Path(hp.getPoints(4).reverse())); }
  return T(extrude(sh, t - 2 * bevel, bevel, 3), 0, 0, -(t - 2 * bevel) / 2);
}
// yellow/black hazard stripes with a constant world period
function hazardMat() {
  return cachedMat('hazard', () => {
    const c = mkCanvas(128, 128), ctx = c.getContext('2d');
    stripes(ctx, 0, 0, 128, 128, 128);
    const t = texFrom(c, { repeat: [1, 1] });
    return std({ map: t, roughness: 0.5, roughnessMap: TEX.speckle(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  });
}
function hazardPlane(w, h, period = 0.14, ...t) {
  const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / period, (uv.getY(i) * h) / period);
  return T(g, ...t);
}
// tapered keycap-like block: square frustum, base w x d, height h, top scaled by k
function frustum(w, h, d, k = 0.8, ...t) {
  const g = new THREE.CylinderGeometry(Math.SQRT1_2 * k, Math.SQRT1_2, 1, 4, 1); g.rotateY(PI / 4); g.scale(w, h, d);
  return T(g, ...t);
}
// displace vertices along normals with smooth pseudo-noise
function lumpy(g, amp, freq, seed) {
  g.deleteAttribute('uv'); g.deleteAttribute('normal'); g = mergeVertices(g); g.computeVertexNormals();
  const r = rng(seed), p = g.attributes.position, n = g.attributes.normal;
  const k = Array.from({ length: 9 }, () => r() * TAU);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) * freq, y = p.getY(i) * freq, z = p.getZ(i) * freq;
    const d = Math.sin(x + k[0]) * Math.sin(y * 1.3 + k[1]) * Math.cos(z * 0.8 + k[2]) + 0.5 * Math.sin(x * 2.3 + y * 1.7 + k[3]) * Math.cos(z * 2.1 + k[4]) + 0.25 * Math.sin(x * 4.1 + k[5]) * Math.sin(y * 3.9 + z * 4.3 + k[6]);
    p.setXYZ(i, p.getX(i) + n.getX(i) * d * amp, p.getY(i) + n.getY(i) * d * amp, p.getZ(i) + n.getZ(i) * d * amp);
  }
  g.computeVertexNormals();
  return g;
}

function cleanGeo(g) {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  g.morphAttributes = {};
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.clearGroups();
  return g;
}
function mergeAll(geos) {
  const list = geos.map(cleanGeo);
  if (list.length === 1) return list[0];
  const anyNI = list.some((g) => !g.index);
  return mergeGeometries(anyNI ? list.map((g) => (g.index ? g.toNonIndexed() : g)) : list, false);
}

// Geometry collector: add(material, geometry) under a stack of local frames, then build() merges per material.
class Kit {
  constructor() { this.m = new Map(); this.stack = []; this.top = null; }
  push(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    _e.set(rx, ry, rz); _q.setFromEuler(_e);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q.clone(), new THREE.Vector3(1, 1, 1));
    this.stack.push(this.top); this.top = this.top ? this.top.clone().multiply(m) : m; return this;
  }
  pop() { this.top = this.stack.pop() ?? null; return this; }
  add(mat, ...geos) {
    let a = this.m.get(mat); if (!a) this.m.set(mat, (a = []));
    for (const g of geos) { if (!g) continue; if (this.top) g.applyMatrix4(this.top); a.push(g); }
    return this;
  }
  place(obj) { if (this.top) obj.applyMatrix4(this.top); return obj; }
  build(parent, { cast = true } = {}) {
    for (const [mat, geos] of this.m) {
      if (!geos.length) continue;
      const mesh = new THREE.Mesh(mergeAll(geos), mat);
      const sh = !mat.userData.noShadow;
      mesh.castShadow = cast && sh && !mat.userData.noCast; mesh.receiveShadow = sh;
      mesh.name = mat.name || '';
      parent.add(mesh);
    }
    this.m.clear();
    return parent;
  }
}
function single(geo, mat, cast = true) { const m = new THREE.Mesh(cleanGeo(geo), mat); m.castShadow = cast && !mat.userData.noShadow; m.receiveShadow = !mat.userData.noShadow; return m; }

// Decal/label atlas: shelf-packs canvas regions; cached by key so identical props share one texture.
const _atlases = new Map();
class Atlas {
  constructor(key, w = 1024, h = 1024) {
    let a = key ? _atlases.get(key) : null;
    this.cached = !!a;
    if (!a) {
      const c = mkCanvas(w, h), ctx = c.getContext('2d');
      const tex = texFrom(c, { aniso: 8 });
      a = { c, ctx, tex, mat: null, glow: null, solid: null };
      if (key) _atlases.set(key, a);
    }
    this.a = a; this.W = a.c.width; this.H = a.c.height; this.x = 2; this.y = 2; this.row = 0;
  }
  alloc(pw, ph, draw) {
    pw = Math.max(2, Math.ceil(pw)); ph = Math.max(2, Math.ceil(ph));
    if (this.x + pw + 2 > this.W) { this.x = 2; this.y += this.row + 3; this.row = 0; }
    const r = { x: this.x, y: this.y, w: pw, h: ph };
    this.x += pw + 3; this.row = Math.max(this.row, ph);
    if (this.y + ph > this.H) console.warn('[props] atlas overflow', this.W, this.H);
    if (!this.cached && draw) {
      const ctx = this.a.ctx; ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip(); ctx.translate(r.x, r.y);
      draw(ctx, pw, ph); ctx.restore();
    }
    return r;
  }
  uv(g, r) {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (r.x + uv.getX(i) * r.w) / this.W, 1 - (r.y + (1 - uv.getY(i)) * r.h) / this.H);
    return g;
  }
  plane(r, w, h, ...t) { return T(this.uv(new THREE.PlaneGeometry(w, h), r), ...t); }
  get mat() { return (this.a.mat ||= noCast(std({ map: this.a.tex, roughness: 0.5, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))); }
  get glow() { return (this.a.glow ||= noShadow(std({ map: this.a.tex, emissiveMap: this.a.tex, emissive: 0xffffff, emissiveIntensity: 1.1, roughness: 0.3, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))); }
  // draw a label of w x h metres at ppm pixels/metre and add the plane to kit (facing +Z unless rotated)
  label(kit, w, h, ppm, draw, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, mat) {
    const r = this.alloc(w * ppm, h * ppm, draw);
    kit.add(mat || this.mat, this.plane(r, w, h, x, y, z, rx, ry, rz));
    return r;
  }
}

// ------------------------------------------------------------------ common label painters
const L = {
  // white sticker with a dark title and optional sub text
  plain: (title, sub, { bg = '#f6f7f5', fg = '#1b1f22', bar = null, radius = 0.08 } = {}) => (ctx, w, h) => {
    rrect(ctx, 0, 0, w, h, Math.min(w, h) * radius); ctx.fillStyle = bg; ctx.fill();
    let x0 = 0;
    if (bar) { ctx.fillStyle = bar; ctx.fillRect(0, 0, Math.max(4, w * 0.035), h); x0 = w * 0.035; }
    const cx = x0 + (w - x0) / 2;
    if (sub) { txt(ctx, title, cx, h * 0.38, h * 0.36, { color: fg, maxW: (w - x0) * 0.9, w: 700 }); txt(ctx, sub, cx, h * 0.76, h * 0.2, { color: fg, maxW: (w - x0) * 0.9 }); }
    else txt(ctx, title, cx, h * 0.53, h * 0.56, { color: fg, maxW: (w - x0) * 0.9, w: 700 });
  },
  warn: (title, sub) => (ctx, w, h) => {
    rrect(ctx, 0, 0, w, h, h * 0.1); ctx.fillStyle = PALETTE.yellow; ctx.fill();
    ctx.lineWidth = h * 0.06; ctx.strokeStyle = PALETTE.black; rrect(ctx, h * 0.06, h * 0.06, w - h * 0.12, h - h * 0.12, h * 0.07); ctx.stroke();
    warnTriangle(ctx, h * 0.5, h * 0.5, h * 0.6, PALETTE.yellow, PALETTE.black);
    const x0 = h * 0.9, cx = x0 + (w - x0 - h * 0.12) / 2;
    if (sub) { txt(ctx, title, cx, h * 0.4, h * 0.3, { color: '#111', w: 700, maxW: w - x0 - h * 0.25 }); txt(ctx, sub, cx, h * 0.7, h * 0.17, { color: '#111', maxW: w - x0 - h * 0.25 }); }
    else txt(ctx, title, cx, h * 0.53, h * 0.34, { color: '#111', w: 700, maxW: w - x0 - h * 0.25 });
  },
  bio: (title = 'BIOHAZARD', sub) => (ctx, w, h) => {
    rrect(ctx, 0, 0, w, h, h * 0.1); ctx.fillStyle = PALETTE.bio; ctx.fill();
    bioSymbol(ctx, h * 0.5, h * 0.5, h * 0.36, '#111');
    const x0 = h * 0.95, cx = x0 + (w - x0) / 2 - h * 0.05;
    txt(ctx, title, cx, sub ? h * 0.4 : h * 0.53, h * (sub ? 0.3 : 0.36), { color: '#111', w: 700, maxW: w - x0 - h * 0.2 });
    if (sub) txt(ctx, sub, cx, h * 0.72, h * 0.17, { color: '#111', maxW: w - x0 - h * 0.2 });
  },
  bioBadge: () => (ctx, w, h) => {
    ctx.fillStyle = PALETTE.bio; ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2, 0, TAU); ctx.fill();
    bioSymbol(ctx, w / 2, h / 2, Math.min(w, h) * 0.36, '#111');
  },
  brand: (sub = 'SITE 41 · WING C', fg = PALETTE.teal, bg = null) => (ctx, w, h) => {
    if (bg) { rrect(ctx, 0, 0, w, h, h * 0.12); ctx.fillStyle = bg; ctx.fill(); }
    wordmark(ctx, w / 2, sub ? h * 0.38 : h * 0.5, h * (sub ? 0.36 : 0.5), fg, 'center');
    if (sub) txt(ctx, sub, w / 2, h * 0.8, h * 0.2, { color: fg, spacing: 0.1 });
  },
  hazard: (period = 40) => (ctx, w, h) => stripes(ctx, 0, 0, w, h, period),
  text: (s, { color = '#1b1f22', w: wt = 700, size = 0.7, align = 'center' } = {}) => (ctx, w, h) => txt(ctx, s, align === 'left' ? 2 : w / 2, h * 0.54, h * size, { color, w: wt, maxW: w * 0.98, align }),
  lcd: (lines, { fg = '#7fe3d0', bg = '#06110f' } = {}) => (ctx, w, h) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    const n = lines.length; lines.forEach((s, i) => txt(ctx, s, w * 0.06, (h * (i + 0.55)) / n, (h / n) * 0.62, { color: fg, align: 'left', maxW: w * 0.9 }));
  },
  tag: (num, seed) => (ctx, w, h) => {
    rrect(ctx, 0, 0, w, h, h * 0.08); ctx.fillStyle = '#f6f7f5'; ctx.fill();
    ctx.fillStyle = PALETTE.teal; ctx.fillRect(0, 0, w, h * 0.22);
    txt(ctx, 'HALVERSEN ASSET', w / 2, h * 0.12, h * 0.13, { color: '#fff', maxW: w * 0.9 });
    barcode(ctx, w * 0.08, h * 0.3, w * 0.84, h * 0.38, seed);
    txt(ctx, num, w / 2, h * 0.83, h * 0.16, { color: '#222' });
  },
};

// ------------------------------------------------------------------ screens
export function drawScreen(ctx, w, h, o = {}) {
  const kind = o.kind || 'terminal', r = rng(o.seed ?? 7);
  const teal = '#3fd1c4', dim = '#1d6f6a';
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#071316'); g.addColorStop(1, '#020607');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const u = h / 320;
  // header
  ctx.fillStyle = '#0c2b2c'; ctx.fillRect(0, 0, w, 30 * u);
  ctx.fillStyle = teal; ctx.fillRect(0, 30 * u, w, 1.5 * u);
  hexMark(ctx, 18 * u, 15 * u, 9 * u, teal);
  txt(ctx, 'HALVERSEN BIOCONTAINMENT', 34 * u, 15.5 * u, 13 * u, { color: teal, align: 'left', w: 700, spacing: 0.08 });
  txt(ctx, o.title || 'TERMINAL 03', w - 10 * u, 15.5 * u, 12 * u, { color: '#8fd9cf', align: 'right' });
  if (kind === 'terminal') {
    // lock panel
    const cx = w / 2, cy = h * 0.5;
    ctx.strokeStyle = teal; ctx.lineWidth = 2 * u; rrect(ctx, cx - 120 * u, cy - 70 * u, 240 * u, 130 * u, 8 * u); ctx.stroke();
    ctx.lineWidth = 5 * u; ctx.beginPath(); ctx.arc(cx, cy - 28 * u, 14 * u, PI, 0); ctx.stroke();
    ctx.fillStyle = teal; rrect(ctx, cx - 22 * u, cy - 28 * u, 44 * u, 32 * u, 4 * u); ctx.fill();
    ctx.fillStyle = '#071316'; ctx.beginPath(); ctx.arc(cx, cy - 15 * u, 4.5 * u, 0, TAU); ctx.fill(); ctx.fillRect(cx - 2 * u, cy - 15 * u, 4 * u, 11 * u);
    txt(ctx, 'LOCKED', cx, cy + 26 * u, 26 * u, { color: teal, w: 700, spacing: 0.25 });
    txt(ctx, 'PRESENT CREDENTIAL TO CONTINUE', cx, cy + 48 * u, 10 * u, { color: '#7fbdb6', spacing: 0.1 });
    // side log
    const lines = ['> SYS INTEGRITY ....... OK', '> CELL A SEAL ......... OK', '> CELL B SEAL ......... OK', '> AIRLOCK C-2 ......... CYCLED', '> NEG PRESSURE ....... -42 Pa', '> UPLINK ............. LOST'];
    lines.forEach((s, i) => txt(ctx, s, 12 * u, (48 + i * 14) * u, 9 * u, { color: i === 5 ? '#e06a4a' : dim, align: 'left' }));
  } else if (kind === 'cam') {
    // grainy camera feed of a containment cell
    const fx = 8 * u, fy = 38 * u, fw = w - 16 * u, fh = h - 62 * u;
    const cg = ctx.createRadialGradient(w / 2, fy + fh * 0.45, 10, w / 2, fy + fh * 0.5, fw * 0.6);
    cg.addColorStop(0, '#5d6b6a'); cg.addColorStop(1, '#101616'); ctx.fillStyle = cg; ctx.fillRect(fx, fy, fw, fh);
    ctx.strokeStyle = 'rgba(200,220,215,0.35)'; ctx.lineWidth = 1.5 * u; // room perspective lines
    const vx = w / 2, vy = fy + fh * 0.42;
    [[fx, fy], [fx + fw, fy], [fx, fy + fh], [fx + fw, fy + fh]].forEach(([x, y]) => { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(lerp(x, vx, 0.6), lerp(y, vy, 0.6)); ctx.stroke(); });
    ctx.strokeRect(lerp(fx, vx, 0.6), lerp(fy, vy, 0.6), fw * 0.4, fh * 0.4);
    // a tall, thin shape in the corner
    ctx.fillStyle = 'rgba(10,12,12,0.85)'; ctx.beginPath(); ctx.ellipse(vx + fw * 0.13, vy - fh * 0.02, 3.5 * u, 8 * u, 0, 0, TAU); ctx.fill();
    ctx.fillRect(vx + fw * 0.13 - 3 * u, vy + 4 * u, 6 * u, 40 * u);
    for (let i = 0; i < 2600; i++) { ctx.fillStyle = `rgba(255,255,255,${r() * 0.1})`; ctx.fillRect(fx + r() * fw, fy + r() * fh, 1.5, 1.5); }
    for (let y = fy; y < fy + fh; y += 3 * u) { ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(fx, y, fw, u); }
    txt(ctx, o.cam || 'CAM 04 — CELL A', fx + 8 * u, fy + 12 * u, 10 * u, { color: '#e8f2f0', align: 'left' });
    ctx.fillStyle = '#e03a2a'; ctx.beginPath(); ctx.arc(fx + fw - 40 * u, fy + 12 * u, 4 * u, 0, TAU); ctx.fill();
    txt(ctx, 'REC', fx + fw - 32 * u, fy + 12.5 * u, 10 * u, { color: '#e8f2f0', align: 'left' });
    txt(ctx, '2026-11-25  03:14:07', fx + fw - 8 * u, fy + fh - 10 * u, 9 * u, { color: '#e8f2f0', align: 'right' });
  } else if (kind === 'vitals' || kind === 'analyzer') {
    const rows = kind === 'vitals' ? [['HR', '#5be38a', '41'], ['RESP', '#e6d35a', '6'], ['CORE °C', '#5fc8e8', '14.2'], ['EEG', '#e07ad8', '— —']] : [['SAMPLE 07', '#5be38a', 'PASS'], ['SAMPLE 08', '#5be38a', 'PASS'], ['SAMPLE 09', '#e6a03a', 'RERUN'], ['SAMPLE 10', '#e05a4a', 'FAIL']];
    const top = 40 * u, rh = (h - top - 26 * u) / rows.length;
    rows.forEach(([name, col, val], i) => {
      const y0 = top + i * rh;
      ctx.strokeStyle = 'rgba(63,209,196,0.15)'; ctx.strokeRect(8 * u, y0, w - 16 * u, rh - 4 * u);
      txt(ctx, name, 14 * u, y0 + 12 * u, 9 * u, { color: col, align: 'left' });
      txt(ctx, val, w - 14 * u, y0 + rh * 0.5, rh * 0.42, { color: col, align: 'right', w: 700 });
      ctx.strokeStyle = col; ctx.lineWidth = 1.6 * u; ctx.beginPath();
      for (let x = 0; x < w * 0.62; x += 2) {
        const t = x / (w * 0.62), p = (x * 0.05 + i) % 6.0;
        const yy = y0 + rh * 0.55 - (i === 0 ? (p < 0.4 ? Math.sin(p * 8) * rh * 0.35 : 0) : Math.sin(x * 0.06 + i * 2) * rh * 0.18 * (0.6 + 0.4 * Math.sin(t * 9)));
        x === 0 ? ctx.moveTo(14 * u + x, yy) : ctx.lineTo(14 * u + x, yy);
      }
      ctx.stroke();
    });
  } else if (kind === 'plan') {
    // floor plan of wing C with cells highlighted
    ctx.strokeStyle = teal; ctx.lineWidth = 1.5 * u;
    const x0 = 20 * u, y0 = 44 * u, pw = w - 40 * u, ph = h - 70 * u;
    ctx.strokeRect(x0, y0, pw, ph);
    const cells = [[0, 0, 0.3, 0.45, 'CELL A'], [0.3, 0, 0.3, 0.45, 'CELL B'], [0.6, 0, 0.4, 0.45, 'OBS'], [0, 0.55, 0.45, 0.45, 'LAB C-2'], [0.45, 0.55, 0.25, 0.45, 'AIRLOCK'], [0.7, 0.55, 0.3, 0.45, 'STORES']];
    cells.forEach(([a, b, c, d, n], i) => {
      ctx.fillStyle = i === 0 ? 'rgba(224,90,74,0.35)' : 'rgba(63,209,196,0.08)';
      ctx.fillRect(x0 + a * pw + 3, y0 + b * ph + 3, c * pw - 6, d * ph - 6); ctx.strokeRect(x0 + a * pw + 3, y0 + b * ph + 3, c * pw - 6, d * ph - 6);
      txt(ctx, n, x0 + (a + c / 2) * pw, y0 + (b + d / 2) * ph, 11 * u, { color: i === 0 ? '#ff9a84' : teal });
    });
  }
  // footer
  ctx.fillStyle = '#0a1d1e'; ctx.fillRect(0, h - 18 * u, w, 18 * u);
  txt(ctx, 'SITE 41 · WING C', 10 * u, h - 9 * u, 9 * u, { color: dim, align: 'left', spacing: 0.1 });
  txt(ctx, o.footer || 'SESSION: NONE', w - 10 * u, h - 9 * u, 9 * u, { color: dim, align: 'right' });
  // vignette + scanlines
  const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
}

function makeScreen(w, h, opts = {}, pw = 512) {
  const ph = Math.round((pw * h) / w);
  const canvas = mkCanvas(pw, ph), ctx = canvas.getContext('2d');
  (opts.draw || drawScreen)(ctx, pw, ph, opts);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = SRGB; texture.anisotropy = 4;
  const mat = noShadow(std({ color: 0x2a2a2a, map: texture, emissiveMap: texture, emissive: 0xffffff, emissiveIntensity: 1.2, roughness: 0.16, metalness: 0 }));
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.name = 'screen';
  return { canvas, ctx, texture, mesh, width: pw, height: ph };
}

// ------------------------------------------------------------------ shared sub-assemblies
function screwHead(kit, x, y, z, rx = HP, ry = 0, rz = 0, r = 0.0035, mat = M.chrome) {
  kit.add(mat, T(new THREE.CylinderGeometry(r * 0.8, r, r * 0.6, 8), x, y, z, rx, ry, rz));
}
function hexBolt(kit, x, y, z, r, rx = HP, ry = 0, rz = 0, mat = M.steelDark) {
  kit.add(mat, T(new THREE.CylinderGeometry(r, r, r * 0.6, 6), x, y, z, rx, ry, rz));
  kit.add(mat, T(new THREE.CylinderGeometry(r * 0.55, r * 0.55, r * 0.9, 10), x, y, z, rx, ry, rz));
}
// a caster wheel with fork; origin at floor contact
function caster(kit, x, z, r = 0.04, brake = false) {
  kit.add(M.rubber, cyl(r, r * 0.6, 14, x, r, z, 0, 0, HP));
  kit.add(M.grey, cyl(r * 0.55, r * 0.64, 12, x, r, z, 0, 0, HP));
  kit.add(M.steel, box(r * 0.1, r * 1.1, r * 1.1, x - r * 0.42, r * 1.25, z), box(r * 0.1, r * 1.1, r * 1.1, x + r * 0.42, r * 1.25, z), box(r * 0.95, r * 0.12, r * 1.1, x, r * 1.8, z));
  kit.add(M.steel, cyl(r * 0.3, r * 0.5, 10, x, r * 2.1, z));
  if (brake) kit.add(M.red, box(r * 0.5, r * 0.1, r * 0.7, x, r * 1.9, z + r * 0.75, 0.3));
}
// keyboard; origin at base bottom centre, front +Z
const KB_ROWS = [
  [['Esc', 1], [0, 0.5], ['F1', 1], ['F2', 1], ['F3', 1], ['F4', 1], [0, 0.3], ['F5', 1], ['F6', 1], ['F7', 1], ['F8', 1], [0, 0.3], ['F9', 1], ['F10', 1], ['F11', 1], ['F12', 1]],
  [['`', 1], ['1', 1], ['2', 1], ['3', 1], ['4', 1], ['5', 1], ['6', 1], ['7', 1], ['8', 1], ['9', 1], ['0', 1], ['-', 1], ['=', 1], ['⌫', 2]],
  [['Tab', 1.5], ['Q', 1], ['W', 1], ['E', 1], ['R', 1], ['T', 1], ['Y', 1], ['U', 1], ['I', 1], ['O', 1], ['P', 1], ['[', 1], [']', 1], ['\\', 1.5]],
  [['Caps', 1.75], ['A', 1], ['S', 1], ['D', 1], ['F', 1], ['G', 1], ['H', 1], ['J', 1], ['K', 1], ['L', 1], [';', 1], ["'", 1], ['Enter', 2.25]],
  [['Shift', 2.25], ['Z', 1], ['X', 1], ['C', 1], ['V', 1], ['B', 1], ['N', 1], ['M', 1], [',', 1], ['.', 1], ['/', 1], ['Shift', 2.75]],
  [['Ctrl', 1.25], ['', 1.25], ['Alt', 1.25], ['', 6.25], ['Alt', 1.25], ['Fn', 1.25], ['', 1.25], ['Ctrl', 1.25]],
];
const KB_PAD = [[['Num', 1], ['/', 1], ['*', 1], ['-', 1]], [['7', 1], ['8', 1], ['9', 1], ['+', 1]], [['4', 1], ['5', 1], ['6', 1], ['', 1]], [['1', 1], ['2', 1], ['3', 1], ['↵', 1]], [['0', 2], ['.', 1], ['', 1]]];
function keyboard(kit, atlas, { keyMat = M.white, baseMat = M.grey } = {}) {
  const U = 0.019, gap = 0.0035, rowsY = [], legends = [];
  const W = 22.9 * U + 0.03, D = 6.6 * U + 0.03;
  kit.add(baseMat, rbox(W, 0.018, D, 0.006, 0, 0.009, 0));
  kit.add(baseMat, box(W - 0.01, 0.006, 0.02, 0, 0.012, -D / 2 + 0.01, 0.12)); // rear rise
  const kh = 0.009, ky = 0.018 + kh / 2;
  const place = (rows, x0, z0, firstGap = true) => rows.forEach((row, ri) => {
    let x = x0; const z = z0 + ri * U + (firstGap && ri > 0 ? U * 0.25 : 0);
    row.forEach(([lab, wu]) => {
      const kw = wu * U;
      if (lab !== 0) { kit.add(keyMat, frustum(kw - gap, kh, U - gap, 0.86, x + kw / 2, ky, z)); legends.push([lab, x + kw / 2, z, kw]); }
      x += kw;
    });
  });
  const x0 = -W / 2 + 0.015, z0 = -D / 2 + 0.015 + U / 2;
  place(KB_ROWS, x0, z0);
  place(KB_PAD, x0 + 18.85 * U, z0 + U * 1.25, false);
  [[-1, 5, '←'], [0, 5, '↓'], [1, 5, '→'], [0, 4, '↑']].forEach(([dx, r, lab]) => {
    const x = x0 + 16.9 * U + dx * U, z = z0 + r * U + U * 0.25;
    kit.add(keyMat, frustum(U - gap, kh, U - gap, 0.86, x, ky, z)); legends.push([lab, x, z, U]);
  });
  // legends: one transparent plane over the key tops
  if (atlas) {
    const ppm = 3000, pw = W * ppm, ph = D * ppm;
    const r = atlas.alloc(pw, ph, (ctx) => {
      legends.forEach(([lab, x, z, kw]) => {
        if (!lab) return;
        const px = (x + W / 2) * ppm, pz = (z + D / 2) * ppm, s = lab.length > 1 ? 0.25 : 0.38;
        txt(ctx, lab, px, pz, U * ppm * s, { color: '#4a5257', w: 600, maxW: kw * ppm * 0.8 });
      });
    });
    kit.add(atlas.mat, atlas.plane(r, W, D, 0, ky + kh / 2 + 0.0004, 0, -HP));
  }
  return { w: W, d: D };
}
// flat-panel monitor in local frame: screen centre at origin, facing +Z
function monitorBody(kit, atlas, sw, sh, screens, sopts) {
  const bz = 0.022, bw = sw + 0.022, bh = sh + 0.03;
  kit.add(M.black, rbox(bw, bh, bz, 0.005, 0, -0.004, -bz / 2));
  kit.add(M.black, rbox(sw * 0.72, sh * 0.7, 0.045, 0.02, 0, -0.01, -bz - 0.012));
  kit.add(M.darkGrey, box(0.1, 0.1, 0.012, 0, -0.01, -bz - 0.04));
  kit.add(M.screenOff, box(sw + 0.004, sh + 0.004, 0.001, 0, 0, 0.0004));
  [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([a, b]) => screwHead(kit, a * 0.035, -0.01 + b * 0.035, -bz - 0.047, -HP, 0, 0, 0.003, M.steelDark));
  // vents on the back
  for (let i = 0; i < 9; i++) kit.add(M.dark, box(0.004, 0.06, 0.002, -0.08 + i * 0.02, sh * 0.2, -bz - 0.0345));
  // bezel details
  kit.add(led(0x3fd1c4, 2), box(0.004, 0.0015, 0.001, bw / 2 - 0.02, -sh / 2 - 0.009, 0.0005));
  for (let i = 0; i < 4; i++) kit.add(M.darkGrey, box(0.008, 0.003, 0.006, bw / 2 - 0.04 - i * 0.014, -bh / 2 - 0.004 - 0.0005, -0.006));
  if (atlas) atlas.label(kit, 0.07, 0.011, 2200, L.brand(null, '#9aa3a8'), 0, -sh / 2 - 0.0085, 0.0006);
  const s = makeScreen(sw, sh, sopts, sopts?.px || 512);
  s.mesh.position.set(0, 0, 0.0012);
  screens.push(s);
  return s;
}

// ================================================================== DOOR
const wireGlassMat = () => cachedMat('wireGlass', () => {
  const c = mkCanvas(64, 64), ctx = c.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 64, 64); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 64, 3); ctx.fillRect(0, 0, 3, 64);
  const t = texFrom(c, { srgb: false, repeat: [10, 12] });
  return noShadow(std({ color: 0x8c9297, metalness: 0.8, roughness: 0.4, alphaMap: t, alphaTest: 0.5, side: THREE.DoubleSide }));
});

export function door({ w = 1.0, h = 2.2, type = 'slide', label = type === 'heavy' ? 'C-14' : 'C-2', seed } = {}) {
  const g = new THREE.Group(); g.name = `door_${type}`;
  const leaf = new THREE.Group(); leaf.name = 'doorLeaf';
  const kit = new Kit(), lk = new Kit();
  const at = new Atlas(`door_${type}_${w}_${h}_${label}`, 2048, 1024);
  const status = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), lamp(0xd02818, 3));
  status.name = 'doorStatus';
  if (type === 'heavy') heavyDoor(g, kit, lk, at, w, h, label, status);
  else slideDoor(g, kit, lk, at, w, h, label, status);
  kit.build(g); lk.build(leaf); g.add(leaf, status);
  g.userData.leaf = leaf;
  g.userData.type = type;
  g.userData.opening = { w, h };
  g.userData.collider = null;
  g.userData.status = status;
  g.userData.setLocked = (locked) => { status.material.emissive.setHex(locked ? 0xd02818 : 0x22d36a); };
  return g;
}

function slideDoor(g, kit, lk, at, w, h, label, status) {
  const D = 0.24, fz = D / 2 + 0.008; // architrave face
  // linings + architraves (stainless) on both faces
  for (const s of [-1, 1]) {
    kit.add(M.grey, box(0.05, h + 0.05, D, s * (w / 2 + 0.025), (h + 0.05) / 2, 0));
    for (const f of [-1, 1]) kit.add(M.steel, rbox(0.07, h + 0.07, 0.016, 0.004, s * (w / 2 + 0.035), (h + 0.07) / 2, f * fz));
  }
  kit.add(M.grey, box(w + 0.1, 0.05, D, 0, h + 0.025, 0));
  for (const f of [-1, 1]) kit.add(M.steel, rbox(w + 0.14, 0.07, 0.016, 0.004, 0, h + 0.035, f * fz));
  // operator / track housing (front only), leaf slides toward +X
  const Lh = 2 * w + 0.26, xh = w / 2, hz = 0.136, hd = 0.17, hy = h + 0.02;
  kit.add(M.white, rbox(Lh, 0.2, hd, 0.014, xh, hy + 0.1, hz + hd / 2));
  kit.add(M.steel, rbox(0.012, 0.204, hd + 0.004, 0.004, xh - Lh / 2, hy + 0.1, hz + hd / 2), rbox(0.012, 0.204, hd + 0.004, 0.004, xh + Lh / 2, hy + 0.1, hz + hd / 2));
  kit.add(M.grey, box(Lh - 0.02, 0.004, 0.002, xh, hy + 0.035, hz + hd + 0.0005)); // access panel seam
  for (let i = 0; i < 4; i++) screwHead(kit, xh - Lh / 2 + 0.06 + (i * (Lh - 0.12)) / 3, hy + 0.02, hz + hd + 0.001, HP, 0, 0, 0.003);
  // motion sensor + label on housing
  kit.add(M.black, rbox(0.14, 0.035, 0.05, 0.008, 0, hy - 0.012, hz + hd - 0.03));
  kit.add(M.glassDark, box(0.1, 0.012, 0.002, 0, hy - 0.022, hz + hd - 0.004));
  kit.add(led(0xff2010, 3), sph(0.002, 6, 4, 0.055, hy - 0.012, hz + hd - 0.004));
  at.label(kit, 0.32, 0.05, 1600, L.brand('AUTODOOR · AD-9', '#5e676c'), xh + w * 0.55, hy + 0.12, hz + hd + 0.001);
  status.scale.set(0.12, 0.012, 0.004); status.position.set(xh - w * 0.35, hy + 0.12, hz + hd + 0.001);
  kit.add(M.black, box(0.13, 0.02, 0.003, xh - w * 0.35, hy + 0.12, hz + hd));
  at.label(kit, 0.14, 0.018, 1600, L.text('STATUS', { color: '#5e676c', size: 0.6 }), xh - w * 0.35, hy + 0.09, hz + hd + 0.001);
  // floor guide beyond the opening
  kit.add(M.steel, box(0.05, 0.022, 0.05, w / 2 + 0.07, 0.011, hz + 0.034));
  kit.add(M.rubber, box(0.06, 0.004, 0.06, w / 2 + 0.07, 0.002, hz + 0.034));

  // --- leaf
  const lw = w + 0.08, lh = h + 0.012, lt = 0.045, lz = hz + 0.012 + lt / 2, y0 = 0.008;
  const ww = 0.22, wh = 0.62, wy0 = 1.18, wy1 = wy0 + wh;
  lk.add(M.whiteGloss, T(slab(lw - 0.02, lh, lt, [{ x: 0, y: (wy0 + wy1) / 2 - y0, w: ww, h: wh, r: 0.004 }], 0.002), 0, y0, lz));
  for (const s of [-1, 1]) lk.add(M.steel, rbox(0.024, lh, lt + 0.002, 0.008, s * (lw / 2 - 0.012), y0 + lh / 2, lz));
  lk.add(M.rubber, box(lw - 0.03, 0.012, lt * 0.6, 0, y0 + 0.002, lz));
  lk.add(M.rubber, box(0.008, lh - 0.02, lt * 0.5, -lw / 2 - 0.002, y0 + lh / 2, lz));
  // window: glass + bezels on both faces + reveal
  lk.add(M.glass, box(ww, wh, 0.008, 0, (wy0 + wy1) / 2, lz));
  for (const f of [-1, 1]) {
    const z = lz + f * (lt / 2 + 0.003);
    lk.add(M.steel, rbox(ww + 0.05, 0.025, 0.008, 0.003, 0, wy0 - 0.0125, z), rbox(ww + 0.05, 0.025, 0.008, 0.003, 0, wy1 + 0.0125, z));
    lk.add(M.steel, rbox(0.025, wh + 0.05, 0.008, 0.003, -ww / 2 - 0.0125, (wy0 + wy1) / 2, z), rbox(0.025, wh + 0.05, 0.008, 0.003, ww / 2 + 0.0125, (wy0 + wy1) / 2, z));
    // kick plate
    lk.add(M.steel, box(lw - 0.05, 0.26, 0.0015, 0, y0 + 0.15, lz + f * (lt / 2 + 0.00075)));
    for (let i = 0; i < 5; i++) screwHead(lk, -lw / 2 + 0.05 + (i * (lw - 0.1)) / 4, y0 + 0.26, lz + f * (lt / 2 + 0.0016), f * HP, 0, 0, 0.0025);
  }
  lk.add(M.grey, box(ww, 0.003, lt, 0, wy0, lz), box(ww, 0.003, lt, 0, wy1, lz));
  // teal manifestation band with hex marks (front & back)
  const band = (ctx, pw, ph) => { ctx.fillStyle = PALETTE.teal; ctx.fillRect(0, 0, pw, ph); for (let x = ph; x < pw; x += ph * 2.2) hexMark(ctx, x, ph / 2, ph * 0.32, 'rgba(255,255,255,0.55)'); };
  const bandL = (lw - ww - 0.05) / 2;
  for (const f of [1, -1]) for (const s of [-1, 1]) at.label(lk, bandL - 0.02, 0.045, 1400, band, s * (ww / 2 + 0.025 + bandL / 2), 1.02, lz + f * (lt / 2 + 0.0008), 0, f < 0 ? PI : 0);
  // pull handle (front) + flush pull (back)
  const hx = -lw / 2 + 0.09;
  lk.add(M.steel, cyl(0.013, 0.55, 14, hx, 1.05, lz + lt / 2 + 0.055));
  for (const y of [0.83, 1.27]) lk.add(M.steel, cyl(0.008, 0.055, 10, hx, y, lz + lt / 2 + 0.028, HP));
  lk.add(M.steelDark, box(0.03, 0.18, 0.006, hx, 1.05, lz - lt / 2 - 0.002));
  lk.add(M.dark, box(0.02, 0.16, 0.004, hx, 1.05, lz - lt / 2 - 0.004));
  // stickers
  const fz2 = lz + lt / 2 + 0.0008;
  at.label(lk, 0.2, 0.075, 2000, L.warn('AUTOMATIC DOOR', 'KEEP CLEAR WHEN MOVING'), -0.32, 1.48, fz2);
  at.label(lk, 0.11, 0.11, 2000, L.bioBadge(), 0.3, 1.6, fz2);
  at.label(lk, 0.2, 0.06, 2000, L.plain('BSL-3 AREA', 'ENTRY IS LOGGED · SITE 41', { bar: PALETTE.bio }), 0.3, 1.47, fz2);
  at.label(lk, 0.18, 0.12, 1800, (ctx, pw, ph) => {
    rrect(ctx, 0, 0, pw, ph, 10); ctx.fillStyle = '#f6f7f5'; ctx.fill(); ctx.fillStyle = PALETTE.teal; ctx.fillRect(0, 0, pw * 0.06, ph);
    txt(ctx, label, pw * 0.53, ph * 0.42, ph * 0.46, { w: 700, color: '#1b1f22', maxW: pw * 0.8 });
    txt(ctx, 'WING C · LEVEL B2', pw * 0.53, ph * 0.8, ph * 0.13, { color: '#4f585d', spacing: 0.08 });
  }, -0.32, 1.7, fz2);
  g.userData.openX = w + 0.06;
  g.userData.closedX = 0;
}

function heavyDoor(g, kit, lk, at, w, h, label, status) {
  const D = 0.5, jw = 0.22, hh = 0.5, lt = 0.16, slot = lt / 2 + 0.012;
  const frame = paint(0xbcc2c6, 0.45, 0.2), dark = paint(0x5a6166, 0.5, 0.3);
  const leafPaint = paint(0x9aa3a9, 0.42, 0.35), ribPaint = paint(0xd2d6d8, 0.4, 0.15);
  // jambs split around the leaf slot
  for (const s of [-1, 1]) {
    const xc = s * (w / 2 + jw / 2);
    for (const f of [-1, 1]) kit.add(frame, rbox(jw, h + hh, D / 2 - slot, 0.015, xc, (h + hh) / 2, f * (slot + (D / 2 - slot) / 2)));
    kit.add(dark, box(jw - 0.06, h + hh, slot * 2, xc + s * 0.03, (h + hh) / 2, 0)); // slot bottom
    // hazard face panels
    kit.add(hazardMat(), hazardPlane(0.14, h, 0.14, xc, h / 2, D / 2 + 0.001));
    // big bolts down the jamb face
    for (let y = 0.12; y < h + hh - 0.05; y += 0.24) for (const dx of [-0.09, 0.09]) hexBolt(kit, xc + dx, y, D / 2 + 0.004, 0.011);
    // guide rail (stainless) visible in the opening
    for (const f of [-1, 1]) kit.add(M.steel, box(0.02, h, 0.012, s * (w / 2 + 0.012), h / 2, f * (slot - 0.004)));
  }
  // header
  for (const f of [-1, 1]) kit.add(frame, rbox(w + 2 * jw, hh, D / 2 - slot, 0.015, 0, h + hh / 2, f * (slot + (D / 2 - slot) / 2)));
  kit.add(dark, box(w + 0.1, 0.06, slot * 2, 0, h + hh - 0.03, 0));
  kit.add(hazardMat(), hazardPlane(w + 2 * jw - 0.04, 0.07, 0.14, 0, h + 0.05, D / 2 + 0.001));
  // header plate + warning
  kit.add(M.steel, rbox(0.62, 0.17, 0.012, 0.004, 0, h + 0.29, D / 2 + 0.006));
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) screwHead(kit, a * 0.29, h + 0.29 + b * 0.065, D / 2 + 0.0125);
  at.label(kit, 0.58, 0.13, 1600, (ctx, pw, ph) => {
    ctx.fillStyle = '#1d2226'; rrect(ctx, 0, 0, pw, ph, 8); ctx.fill();
    txt(ctx, 'CONTAINMENT CELL', pw / 2, ph * 0.28, ph * 0.2, { color: '#e8eaea', spacing: 0.15 });
    txt(ctx, label, pw / 2, ph * 0.66, ph * 0.48, { color: PALETTE.yellow, w: 700, spacing: 0.1 });
  }, 0, h + 0.29, D / 2 + 0.0125);
  at.label(kit, 0.34, 0.11, 1800, L.warn('DANGER', 'DOOR DESCENDS WITHOUT WARNING'), -w / 2 - jw / 2 - 0.01, h + 0.3, D / 2 + 0.002);
  at.label(kit, 0.2, 0.2, 1800, L.bioBadge(), w / 2 + jw / 2 + 0.01, h + 0.3, D / 2 + 0.002);
  // status lamps
  kit.add(M.black, cyl(0.04, 0.03, 18, -0.42, h + 0.29, D / 2 + 0.015, HP), cyl(0.04, 0.03, 18, 0.42, h + 0.29, D / 2 + 0.015, HP));
  kit.add(lamp(0xffa018, 2.5), cyl(0.03, 0.02, 18, -0.42, h + 0.29, D / 2 + 0.035, HP));
  status.geometry.dispose(); status.geometry = new THREE.CylinderGeometry(0.03, 0.03, 0.02, 18).rotateX(HP); status.position.set(0.42, h + 0.29, D / 2 + 0.035);
  // conduit up the right jamb into a junction box
  const cx = w / 2 + jw + 0.03;
  kit.add(M.steel, cyl(0.012, h + hh - 0.3, 10, cx, (h + hh - 0.3) / 2 + 0.3, 0.12));
  kit.add(M.grey, rbox(0.12, 0.16, 0.08, 0.01, cx + 0.02, 0.26, 0.12));
  for (let y = 0.6; y < h + hh; y += 0.5) kit.add(M.steelDark, box(0.04, 0.012, 0.03, cx, y, 0.12));
  // threshold plate (flush, does not block)
  kit.add(M.steelDark, box(w, 0.006, D, 0, 0.003, 0));
  kit.add(hazardMat(), hazardPlane(w, 0.06, 0.1, 0, 0.0065, D / 2 - 0.04, -HP), hazardPlane(w, 0.06, 0.1, 0, 0.0065, -D / 2 + 0.04, -HP));

  // --- leaf (in the wall plane, slides up)
  const lw = w + 0.1, lh = h + 0.08, wy0 = 1.42, wy1 = 1.78, ww = 0.26;
  lk.add(leafPaint, T(slab(lw, lh - 0.02, lt, [{ x: 0, y: (wy0 + wy1) / 2 - 0.02, w: ww, h: wy1 - wy0, r: 0.004 }], 0.004, 0.006), 0, 0.02, 0));
  lk.add(M.rubber, box(lw - 0.02, 0.022, lt * 0.8, 0, 0.011, 0));
  lk.add(M.steel, box(ww, 0.004, lt, 0, wy0, 0), box(ww, 0.004, lt, 0, wy1, 0), box(0.004, wy1 - wy0, lt, -ww / 2, (wy0 + wy1) / 2, 0), box(0.004, wy1 - wy0, lt, ww / 2, (wy0 + wy1) / 2, 0));
  lk.add(M.glass, box(ww, wy1 - wy0, 0.012, 0, (wy0 + wy1) / 2, lt * 0.25), box(ww, wy1 - wy0, 0.012, 0, (wy0 + wy1) / 2, -lt * 0.25));
  lk.add(wireGlassMat(), plane(ww, wy1 - wy0, 0, (wy0 + wy1) / 2, 0));
  for (const f of [-1, 1]) {
    const z = f * (lt / 2), rot = f < 0 ? PI : 0;
    // raised perimeter frame and ribs
    const bw = 0.085, p = 0.014;
    lk.add(ribPaint, rbox(lw, bw, p, 0.004, 0, lh - bw / 2 - 0.06, z + f * p / 2), rbox(bw, lh - 0.08, p, 0.004, -lw / 2 + bw / 2 + 0.06, lh / 2 + 0.02, z + f * p / 2), rbox(bw, lh - 0.08, p, 0.004, lw / 2 - bw / 2 - 0.06, lh / 2 + 0.02, z + f * p / 2));
    lk.add(ribPaint, rbox(lw - 0.3, 0.07, p, 0.004, 0, 0.72, z + f * p / 2), rbox(lw - 0.3, 0.07, p, 0.004, 0, 1.25, z + f * p / 2));
    // window bezel
    lk.add(M.steelDark, rbox(ww + 0.09, 0.045, 0.02, 0.005, 0, wy0 - 0.0225, z), rbox(ww + 0.09, 0.045, 0.02, 0.005, 0, wy1 + 0.0225, z), rbox(0.045, wy1 - wy0, 0.02, 0.005, -ww / 2 - 0.0225, (wy0 + wy1) / 2, z), rbox(0.045, wy1 - wy0, 0.02, 0.005, ww / 2 + 0.0225, (wy0 + wy1) / 2, z));
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1]]) hexBolt(lk, a * (ww / 2 + 0.022), b < 0 ? wy0 - 0.022 : wy1 + 0.022, z + f * 0.011, 0.007, f * HP);
    // bolts around the frame
    for (let y = 0.25; y < lh - 0.1; y += 0.16) for (const s of [-1, 1]) hexBolt(lk, s * (lw / 2 - bw / 2 - 0.06), y, z + f * (p + 0.002), 0.01, f * HP);
    for (let x = -lw / 2 + 0.2; x < lw / 2 - 0.15; x += 0.16) hexBolt(lk, x, lh - bw / 2 - 0.06, z + f * (p + 0.002), 0.01, f * HP);
    // locking bolt housings at the leaf edges
    for (const s of [-1, 1]) for (const y of [0.45, 1.05]) {
      lk.add(M.steelDark, rbox(0.06, 0.14, 0.04, 0.006, s * (lw / 2 - 0.035), y, z + f * 0.02));
      lk.add(M.chrome, cyl(0.014, 0.1, 12, s * (lw / 2 - 0.035), y, z + f * 0.045, 0, 0, HP));
    }
    // lifting grab bar
    lk.add(M.steel, cyl(0.014, 0.42, 12, 0, 0.42, z + f * 0.06, 0, 0, HP));
    for (const s of [-1, 1]) lk.add(M.steel, cyl(0.01, 0.06, 10, s * 0.19, 0.42, z + f * 0.03, HP));
    // bottom hazard band and stencil
    lk.add(hazardMat(), hazardPlane(lw - 0.04, 0.2, 0.14, 0, 0.13, z + f * 0.001, 0, rot));
    at.label(lk, 0.5, 0.2, 1000, L.text(label, { color: '#2a2f33', size: 0.85 }), 0, 0.97, z + f * (p + 0.0015), 0, rot);
    at.label(lk, 0.5, 0.05, 1000, L.text('CONTAINMENT · DO NOT OBSTRUCT', { color: '#2a2f33', size: 0.55 }), 0, 0.84, z + f * (p + 0.0015), 0, rot);
  }
  g.userData.openY = h + 0.02;
  g.userData.closedY = 0;
}

// ================================================================== WORKSTATION
export function workstation({ monitors = 2, seed } = {}) {
  seed = seedOf(seed); const r = rng(seed);
  const g = new THREE.Group(); g.name = 'workstation';
  const kit = new Kit(), at = new Atlas(`ws_${seed % 4}_${monitors}`, 2048, 1024);
  const W = 1.6, D = 0.8, H = 0.75, T0 = 0.028;
  const screens = [];
  // top
  kit.add(M.white, rbox(W, T0, D, 0.01, 0, H - T0 / 2, 0));
  kit.add(M.grey, box(W - 0.04, 0.004, D - 0.04, 0, H - T0 - 0.002, 0)); // underside sub-frame plate
  // side frames (steel)
  for (const s of [-1, 1]) {
    const x = s * (W / 2 - 0.07);
    kit.add(M.steel, rbox(0.06, H - T0 - 0.03, 0.04, 0.006, x, (H - T0 - 0.03) / 2 + 0.03, 0));
    kit.add(M.steel, rbox(0.07, 0.035, D - 0.06, 0.008, x, 0.03, 0));
    kit.add(M.steel, rbox(0.05, 0.03, D - 0.1, 0.006, x, H - T0 - 0.03, 0));
    for (const z of [-1, 1]) { kit.add(M.rubber, cyl(0.018, 0.012, 12, x, 0.006, z * (D / 2 - 0.05))); kit.add(M.steelDark, cyl(0.005, 0.02, 8, x, 0.02, z * (D / 2 - 0.05))); }
    for (let i = 0; i < 2; i++) screwHead(kit, x + s * 0.031, H - T0 - 0.03, (i - 0.5) * 0.4, 0, 0, HP, 0.004);
  }
  kit.add(M.steel, rbox(W - 0.2, 0.05, 0.03, 0.006, 0, H - T0 - 0.08, -D / 2 + 0.12)); // rear beam
  // modesty panel (perforated)
  kit.add(M.perfSteel, plane(W - 0.24, 0.36, 0, H - 0.25, -D / 2 + 0.06));
  kit.add(M.steel, box(W - 0.22, 0.015, 0.01, 0, H - 0.07, -D / 2 + 0.06), box(W - 0.22, 0.015, 0.01, 0, H - 0.43, -D / 2 + 0.06));
  // cable tray under the rear edge + power strip
  const ty = H - T0 - 0.09;
  kit.add(M.steel, box(W - 0.3, 0.003, 0.12, 0, ty, -D / 2 + 0.17), box(W - 0.3, 0.07, 0.003, 0, ty + 0.035, -D / 2 + 0.23), box(W - 0.3, 0.05, 0.003, 0, ty + 0.025, -D / 2 + 0.11));
  for (const x of [-0.5, 0, 0.5]) kit.add(M.steel, box(0.02, 0.09, 0.003, x, ty + 0.045, -D / 2 + 0.23));
  kit.add(M.white, rbox(0.42, 0.04, 0.05, 0.008, 0.15, ty + 0.022, -D / 2 + 0.16));
  for (let i = 0; i < 5; i++) kit.add(M.dark, box(0.028, 0.003, 0.03, 0.0 + i * 0.065, ty + 0.0425, -D / 2 + 0.16));
  kit.add(led(0xff3020, 2.5), box(0.008, 0.002, 0.008, 0.34, ty + 0.042, -D / 2 + 0.16));
  for (let i = 0; i < 5; i++) {
    const cm = [M.cableBlack, M.cableGrey, M.cableBlack, M.cableBlue, M.cableBlack][i];
    kit.add(cm, tube([[-0.6 + i * 0.05, ty + 0.01, -D / 2 + 0.14 + i * 0.012], [0, ty + 0.012, -D / 2 + 0.15 + i * 0.01], [0.55, ty + 0.01, -D / 2 + 0.17]], 0.0035 + (i % 2) * 0.001, 20, 5));
  }
  // monitor pole + arms
  const px = 0, pz = -D / 2 + 0.1;
  kit.add(M.steel, rbox(0.07, 0.012, 0.09, 0.004, px, H + 0.006, pz));
  kit.add(M.steel, box(0.05, 0.06, 0.012, px, H - 0.02, pz - 0.048));
  kit.add(M.steelDark, cyl(0.007, 0.08, 10, px, H - 0.06, pz)); kit.add(M.rubber, cyl(0.02, 0.008, 12, px, H - T0 - 0.012, pz));
  kit.add(M.alu, cyl(0.019, 0.46, 20, px, H + 0.23, pz)); kit.add(M.black, cyl(0.021, 0.02, 20, px, H + 0.46, pz));
  const n = Math.max(1, Math.min(3, monitors));
  const mw = 0.56, mh = 0.315;
  const angles = n === 1 ? [0] : n === 2 ? [0.2, -0.2] : [0.38, 0, -0.38];
  const xs = n === 1 ? [0] : n === 2 ? [-0.3, 0.3] : [-0.58, 0, 0.58];
  const kinds = ['terminal', 'cam', 'plan'];
  xs.forEach((x, i) => {
    const sy = H + 0.34, sz = pz + 0.14 + Math.abs(x) * 0.25;
    // arm from pole to the monitor back
    const ay = H + 0.4 - (i % 2) * 0.03;
    const back = [x * 0.92, ay, sz - 0.07];
    kit.add(M.alu, tube([[px, ay, pz], [x * 0.45, ay, pz + 0.02], back], 0.011, 16, 8));
    kit.add(M.black, cyl(0.018, 0.04, 14, px, ay, pz), cyl(0.014, 0.03, 12, back[0], ay, back[2]));
    kit.add(M.alu, cyl(0.009, sy - ay + 0.06, 10, back[0], (sy + ay) / 2 - 0.03, back[2]));
    kit.push(x, sy, sz, -0.05, angles[i], 0);
    kit.add(M.alu, box(0.03, 0.03, 0.06, 0, -0.01, -0.07));
    const s = monitorBody(kit, at, mw, mh, screens, { kind: kinds[(i + (seed % 3)) % 3], seed: seed + i, title: `TERMINAL 0${3 + i}` });
    kit.place(s.mesh); g.add(s.mesh);
    if (i === 0) at.label(kit, 0.045, 0.045, 3000, (ctx, pw, ph) => { ctx.fillStyle = '#f3e27a'; ctx.fillRect(0, 0, pw, ph); ctx.fillStyle = 'rgba(0,0,0,0.06)'; ctx.fillRect(0, 0, pw, ph * 0.15); txt(ctx, 'DO NOT', pw / 2, ph * 0.35, ph * 0.18, { color: '#283a8a' }); txt(ctx, 'WATCH C-14', pw / 2, ph * 0.58, ph * 0.16, { color: '#283a8a', maxW: pw * 0.9 }); txt(ctx, 'AFTER 3AM', pw / 2, ph * 0.8, ph * 0.16, { color: '#283a8a' }); }, -mw / 2 + 0.02, mh / 2 - 0.005, 0.0016, 0, 0, 0.12);
    kit.pop();
    // cable from monitor down the pole
    kit.add(M.cableBlack, tube([[back[0], sy - 0.05, back[2] - 0.02], [back[0] * 0.6, ay - 0.02, pz + 0.01], [px + 0.025, ay - 0.1, pz - 0.01], [px + 0.025, H + 0.05, pz - 0.02], [px + 0.02, H - 0.05, pz - 0.06], [0.1 * (i - 0.5), ty + 0.03, -D / 2 + 0.17]], 0.003, 30, 5));
  });
  // keyboard + mouse + pad
  kit.push(-0.05, H, 0.16, 0, (r() - 0.5) * 0.08, 0);
  keyboard(kit, at, { keyMat: M.white, baseMat: M.grey });
  kit.add(M.cableGrey, tube([[0, 0.012, -0.075], [0.02, 0.003, -0.15], [0.12, 0.003, -0.35], [0.1, -0.02, -0.5]], 0.0022, 16, 5));
  kit.pop();
  const mx = 0.33, mz = 0.17;
  kit.add(M.fabricDark, rbox(0.25, 0.003, 0.21, 0.004, mx, H + 0.0015, mz));
  at.label(kit, 0.07, 0.016, 3000, L.brand(null, '#3a7f7d'), mx + 0.07, H + 0.0034, mz + 0.085, -HP);
  kit.push(mx, H + 0.003, mz, 0, (r() - 0.5) * 0.4, 0);
  kit.add(M.whiteGloss, S(sph(0.5, 20, 12, 0, 0, 0), 0.062, 0.036, 0.11));
  kit.add(M.grey, box(0.002, 0.008, 0.035, 0, 0.016, -0.025));
  kit.add(M.darkGrey, cyl(0.0035, 0.006, 10, 0, 0.0165, -0.022, 0, 0, HP));
  kit.add(M.cableGrey, tube([[0, 0.006, -0.055], [0, 0.003, -0.1], [-0.05, 0.002, -0.25], [-0.15, -0.02, -0.4]], 0.0018, 16, 5));
  kit.pop();
  // desk phone
  kit.push(-0.6, H, 0.05, 0, 0.35, 0);
  const ps = new THREE.Shape(); ps.moveTo(-0.09, 0); ps.lineTo(0.09, 0); ps.lineTo(0.09, 0.07); ps.lineTo(-0.09, 0.02); ps.closePath();
  kit.add(M.darkGrey, T(extrude(ps, 0.2, 0.004), 0.1, 0, 0, 0, -HP, 0));
  kit.add(M.black, rbox(0.05, 0.035, 0.2, 0.014, -0.065, 0.07, 0, 0.45, 0, 0));
  kit.add(M.black, rbox(0.055, 0.03, 0.05, 0.012, -0.065, 0.06, 0.08, 0.45), rbox(0.055, 0.03, 0.05, 0.012, -0.065, 0.06, -0.08, 0.45));
  kit.push(0.025, 0.045, 0, -Math.atan2(0.05, 0.18) * 0 , 0, 0);
  for (let i = 0; i < 12; i++) kit.add(M.grey, rbox(0.016, 0.006, 0.012, 0.002, -0.018 + (i % 3) * 0.02, 0.0 + Math.floor(i / 3) * -0.012 + 0.02, 0.03 - Math.floor(i / 3) * 0.018, 0, 0, 0));
  kit.pop();
  at.label(kit, 0.06, 0.025, 3000, L.lcd(['EXT 4417', 'WING C  03:14']), 0.04, 0.072, -0.055, -HP + 0.27, 0, 0, at.glow);
  kit.add(led(0xff2010, 3), sph(0.003, 8, 6, 0.075, 0.06, -0.07));
  kit.add(M.black, tube([[-0.065, 0.06, 0.1], [-0.08, 0.02, 0.12], [-0.11, 0.005, 0.08], [-0.1, 0.005, 0.0], [-0.08, 0.01, -0.04]], 0.003, 20, 5));
  kit.pop();
  // papers, clipboard, pen, mug
  const docDraw = (title, sd) => (ctx, pw, ph) => {
    ctx.fillStyle = '#f7f7f2'; ctx.fillRect(0, 0, pw, ph);
    wordmark(ctx, pw * 0.08, ph * 0.06, ph * 0.025, PALETTE.teal);
    txt(ctx, title, pw * 0.08, ph * 0.12, ph * 0.028, { align: 'left', w: 700, color: '#222' });
    const rr = rng(sd); ctx.fillStyle = '#9aa0a4';
    for (let i = 0; i < 28; i++) { const lw2 = pw * (0.5 + rr() * 0.34); ctx.fillRect(pw * 0.08, ph * (0.18 + i * 0.026), i % 7 === 6 ? lw2 * 0.4 : lw2, ph * 0.006); }
    ctx.strokeStyle = '#555'; ctx.strokeRect(pw * 0.08, ph * 0.9, pw * 0.84, ph * 0.05);
    txt(ctx, 'SIGNED: ________________   CLEARANCE 3', pw * 0.1, ph * 0.925, ph * 0.018, { align: 'left', color: '#333' });
  };
  const titles = ['INCIDENT LOG — C-14', 'FEEDING SCHEDULE (REVISED)', 'SEAL INTEGRITY CHECKLIST'];
  for (let i = 0; i < 3; i++) {
    const x = 0.45 + r() * 0.15, z = -0.12 + r() * 0.1;
    at.label(kit, 0.21, 0.297, 900, docDraw(titles[i], seed + i), x, H + 0.0006 + i * 0.0004, z, -HP, 0, (r() - 0.5) * 0.6, M.paper && undefined);
  }
  kit.push(-0.42, H, -0.1, 0, 0.25, 0);
  kit.add(M.teal, rbox(0.23, 0.004, 0.32, 0.006, 0, 0.002, 0));
  at.label(kit, 0.2, 0.27, 900, docDraw('DAILY ROUNDS — WING C', seed + 9), 0, 0.0045, 0.015, -HP);
  kit.add(M.chrome, rbox(0.1, 0.008, 0.03, 0.003, 0, 0.007, -0.14));
  kit.add(M.steelDark, cyl(0.003, 0.08, 8, 0, 0.012, -0.13, 0, 0, HP));
  kit.pop();
  kit.add(M.black, cyl(0.004, 0.14, 8, -0.3, H + 0.004, 0.33, HP, 0, 1.1));
  kit.add(M.chrome, cyl(0.0045, 0.02, 8, -0.3 + Math.sin(1.1) * 0.07, H + 0.004, 0.33 - Math.cos(1.1) * 0.07 * 0, HP, 0, 1.1));
  // mug
  const mxg = 0.7, mzg = 0.25;
  kit.add(M.whiteGloss, lathe([[0, 0], [0.036, 0], [0.04, 0.004], [0.041, 0.095], [0.038, 0.095], [0.036, 0.008], [0, 0.008]], 24, mxg, H, mzg));
  kit.add(M.whiteGloss, tor(0.026, 0.006, 8, 14, PI, mxg + 0.04, H + 0.05, mzg, 0, 0, -HP));
  kit.add(M.coffee, cyl(0.0365, 0.002, 20, mxg, H + 0.075, mzg));
  kit.add(M.teal, cyl(0.0413, 0.012, 24, mxg, H + 0.07, mzg));
  // under-desk PC
  const cx = 0.55, cz = -0.05;
  kit.add(M.white, rbox(0.2, 0.42, 0.44, 0.012, cx, 0.235, cz));
  kit.add(M.grey, box(0.18, 0.4, 0.003, cx, 0.235, cz + 0.22));
  for (let i = 0; i < 14; i++) kit.add(M.dark, box(0.12, 0.004, 0.002, cx, 0.12 + i * 0.012, cz + 0.222));
  kit.add(M.darkGrey, cyl(0.012, 0.004, 20, cx, 0.39, cz + 0.222, HP));
  kit.add(led(0x3fd1c4, 2.5), tor(0.012, 0.0012, 4, 20, TAU, cx, 0.39, cz + 0.2235));
  kit.add(M.black, box(0.04, 0.012, 0.002, cx - 0.04, 0.36, cz + 0.2225), box(0.04, 0.012, 0.002, cx + 0.04, 0.36, cz + 0.2225));
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) kit.add(M.rubber, cyl(0.012, 0.025, 10, cx + a * 0.08, 0.0125, cz + b * 0.19));
  at.label(kit, 0.09, 0.02, 3000, L.brand(null, '#7d878c'), cx, 0.43, cz + 0.2225);
  at.label(kit, 0.06, 0.035, 3000, L.tag('HB-41-0' + (300 + (seed % 97)), seed), cx + 0.1006, 0.3, cz, 0, HP);
  kit.add(M.cableBlack, tube([[cx, 0.3, cz - 0.22], [cx - 0.05, 0.3, cz - 0.3], [cx - 0.1, 0.5, -D / 2 + 0.2], [0.1, ty + 0.02, -D / 2 + 0.16]], 0.004, 20, 5));
  kit.build(g);
  for (const s of screens) s.mesh.castShadow = false;
  g.userData.screens = screens;
  g.userData.collider = { w: W, d: D };
  return g;
}

// ================================================================== CONTROL CONSOLE
function orientAlong(g, p, t) { _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), t.clone().normalize()); g.applyQuaternion(_q); g.translate(p.x, p.y, p.z); return g; }
function gooseneck(kit, pts, r = 0.006, ringStep = 0.011) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  kit.add(M.black, new THREE.TubeGeometry(curve, 30, r * 0.85, 8));
  const L0 = curve.getLength();
  for (let s = 0; s <= L0; s += ringStep) { const u = s / L0; kit.add(M.black, orientAlong(new THREE.TorusGeometry(r * 0.85, r * 0.35, 4, 10), curve.getPointAt(u), curve.getTangentAt(u))); }
  return curve;
}
function makeButton(kit, parent, buttons, name, mat, onHex, geo) {
  const m = new THREE.Mesh(geo, mat); m.name = name; m.castShadow = false; m.receiveShadow = true;
  kit.place(m); parent.add(m);
  m.userData.label = name;
  m.userData.setLit = (on) => { mat.emissive.setHex(onHex); mat.emissiveIntensity = on ? 2.2 : 0.12; };
  buttons[name] = m;
  return m;
}

export function controlConsole({ seed } = {}) {
  seed = seedOf(seed);
  const g = new THREE.Group(); g.name = 'controlConsole';
  const kit = new Kit(), at = new Atlas('console', 2048, 2048);
  const screens = [], buttons = {};
  const mw = 0.86;
  const alpha = Math.atan2(0.24, 0.35), Ls = Math.hypot(0.24, 0.35);
  const lbl = (s, w = 0.09, h = 0.014, color = '#d9dde0') => (ctx, pw, ph) => txt(ctx, s, pw / 2, ph * 0.55, ph * 0.72, { color, w: 600, maxW: pw * 0.96, spacing: 0.06 });

  const module = (idx) => {
    // ---- carcass
    if (idx === 0) kit.add(M.rubber, box(mw, 0.08, 0.44, 0, 0.04, -0.275));
    else kit.add(M.rubber, box(mw, 0.08, 0.92, 0, 0.04, -0.04));
    kit.add(M.white, box(mw, 0.7, 0.45, 0, 0.08 + 0.35, -0.275)); // rear body
    kit.add(M.grey, box(mw - 0.04, 0.6, 0.004, 0, 0.42, -0.048)); // knee-space back panel
    for (let i = 0; i < 8; i++) kit.add(M.dark, box(0.22, 0.006, 0.003, 0, 0.2 + i * 0.016, -0.045));
    // worktop with rubber bumper
    kit.add(M.whiteGloss, rbox(mw, 0.035, 0.47, 0.008, 0, 0.7425, 0.27));
    kit.add(M.rubber, cyl(0.02, mw, 16, 0, 0.7425, 0.505, 0, 0, HP));
    if (idx === 0) {
      for (const s of [-1, 1]) { const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0.38, 0); sh.lineTo(0, -0.3); sh.closePath(); kit.add(M.steel, T(extrude(sh, 0.012), s * 0.3 - 0.006, 0.725, -0.05, 0, -HP, 0)); }
      kit.add(M.steel, cyl(0.014, mw - 0.06, 12, 0, 0.14, 0.05, 0, 0, HP)); // footrest
    } else {
      // pedestal cabinet with doors and vents
      kit.add(M.white, box(mw - 0.02, 0.64, 0.5, 0, 0.08 + 0.32, 0.23));
      for (const s of [-1, 1]) {
        const dx = s * (mw / 4 - 0.002);
        kit.add(M.whiteGloss, rbox(mw / 2 - 0.016, 0.6, 0.018, 0.004, dx, 0.41, 0.487));
        kit.add(M.steel, rbox(0.012, 0.16, 0.022, 0.005, dx - s * (mw / 4 - 0.05), 0.5, 0.507));
        for (let i = 0; i < 6; i++) kit.add(M.dark, box(mw / 2 - 0.12, 0.006, 0.002, dx, 0.16 + i * 0.016, 0.4965));
      }
      at.label(kit, 0.07, 0.035, 2600, L.tag('HB-CN-0' + (40 + idx), seed + idx), mw / 2 - 0.08, 0.65, 0.4965);
    }
    // ---- sloped control panel
    kit.push(0, 0.78 + 0.12, 0.05 - 0.175, alpha, 0, 0);
    kit.add(M.panelDark, rbox(mw, 0.03, Ls + 0.01, 0.006, 0, -0.015, 0));
    kit.add(M.steel, rbox(mw, 0.012, 0.03, 0.004, 0, 0.0, Ls / 2 - 0.005)); // front lip
    // module sub-plates with screws
    const plate = (u, v, pw, pv) => {
      kit.add(M.darkGrey, rbox(pw, 0.003, pv, 0.003, u, 0.0015, -v));
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) screwHead(kit, u + a * (pw / 2 - 0.008), 0.0035, -v + b * (pv / 2 - 0.008), 0, 0, 0, 0.0025);
    };
    const btn = (name, u, v, onHex, capHex = onHex) => {
      kit.add(M.black, rbox(0.052, 0.012, 0.052, 0.004, u, 0.006, -v));
      kit.add(M.steelDark, rbox(0.044, 0.004, 0.044, 0.002, u, 0.013, -v));
      const mat = noShadow(phys({ color: capHex, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1, emissive: onHex, emissiveIntensity: 0.12, transparent: false }));
      const b = makeButton(kit, g, buttons, name, mat, onHex, rbox(0.036, 0.012, 0.036, 0.004, u, 0.019, -v));
      at.label(kit, 0.1, 0.014, 2600, lbl(name), u, 0.0035, -v + 0.042, -HP);
      return b;
    };
    const toggle = (name, u, v, guard = false) => {
      kit.add(M.chrome, rbox(0.03, 0.004, 0.05, 0.002, u, 0.004, -v));
      kit.add(M.chrome, cyl(0.007, 0.01, 6, u, 0.01, -v), cyl(0.005, 0.004, 12, u, 0.016, -v));
      const lev = new THREE.CylinderGeometry(0.0025, 0.0035, 0.032, 10); lev.translate(0, 0.016, 0); lev.rotateX(0.35); lev.translate(u, 0.016, -v);
      const tip = sph(0.0045, 10, 8, u, 0.016 + 0.03 * Math.cos(0.35), -v + 0.03 * Math.sin(0.35));
      const mat = std({ color: 0xe6e9ec, metalness: 1, roughness: 0.15, emissive: 0x000000 });
      const geo = mergeAll([lev, tip]);
      const m = new THREE.Mesh(geo, mat); m.name = name; kit.place(m); g.add(m); m.castShadow = true;
      const ledMat = lamp(guard ? 0xff3020 : 0x30ff80, 0.15, 0x111111);
      const ledM = new THREE.Mesh(T(new THREE.CylinderGeometry(0.004, 0.004, 0.004, 12), u, 0.004, -v - 0.04), ledMat); kit.place(ledM); g.add(ledM);
      kit.add(M.black, cyl(0.0055, 0.004, 12, u, 0.002, -v - 0.04));
      m.userData.label = name; m.userData.led = ledM;
      m.userData.setLit = (on) => { ledMat.emissiveIntensity = on ? 3 : 0.15; };
      buttons[name] = m;
      if (guard) {
        // red flip guard, raised
        kit.add(M.red, box(0.004, 0.03, 0.05, u - 0.019, 0.016, -v), box(0.004, 0.03, 0.05, u + 0.019, 0.016, -v));
        kit.add(M.red, T(new THREE.BoxGeometry(0.042, 0.003, 0.05), 0, 0, -0.025).rotateX(-1.1).translate(u, 0.031, -v - 0.025));
        kit.add(M.chrome, cyl(0.002, 0.044, 6, u, 0.031, -v - 0.025, 0, 0, HP));
      }
      at.label(kit, 0.09, 0.014, 2600, lbl(name, 0.09, 0.014, guard ? '#ff8a70' : '#d9dde0'), u, 0.0035, -v + 0.046, -HP);
      return m;
    };
    const estop = (name, u, v) => {
      kit.add(M.yellow, rbox(0.1, 0.008, 0.1, 0.006, u, 0.004, -v));
      at.label(kit, 0.094, 0.094, 2600, (ctx, pw, ph) => {
        ctx.fillStyle = PALETTE.yellow; ctx.fillRect(0, 0, pw, ph);
        ctx.save(); ctx.translate(pw / 2, ph / 2); ctx.font = F(ph * 0.085, 700); ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const s = 'EMERGENCY  STOP', n = s.length;
        for (let i = 0; i < n; i++) { ctx.save(); ctx.rotate(-PI * 0.42 + (i / (n - 1)) * PI * 0.84); ctx.fillText(s[i], 0, -ph * 0.42); ctx.restore(); }
        ctx.restore();
      }, u, 0.0084, -v, -HP);
      kit.add(M.black, cyl(0.028, 0.026, 20, u, 0.021, -v));
      kit.add(M.chrome, cyl(0.022, 0.006, 20, u, 0.036, -v));
      const head = lathe([[0, 0.03], [0.02, 0.029], [0.031, 0.022], [0.034, 0.014], [0.033, 0.008], [0.016, 0.005], [0.012, 0]], 24, u, 0.036, -v);
      const mat = phys({ color: 0xd01a1a, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, emissive: 0xff1010, emissiveIntensity: 0 });
      const m = new THREE.Mesh(cleanGeo(head), mat); m.name = name; m.castShadow = true; kit.place(m); g.add(m);
      m.userData.label = name; m.userData.setLit = (on) => { mat.emissiveIntensity = on ? 1.2 : 0; };
      buttons[name] = m;
    };
    const knob = (name, u, v) => {
      kit.add(M.black, cyl(0.016, 0.018, 24, u, 0.009, -v), cyl(0.013, 0.006, 24, u, 0.021, -v));
      kit.add(M.chrome, box(0.002, 0.002, 0.012, u, 0.0245, -v - 0.004));
      at.label(kit, 0.06, 0.06, 2600, (ctx, pw, ph) => { ctx.strokeStyle = '#cfd4d7'; ctx.lineWidth = 2; for (let i = 0; i <= 10; i++) { const a = PI * 0.75 + (i / 10) * PI * 1.5; ctx.beginPath(); ctx.moveTo(pw / 2 + Math.cos(a) * pw * 0.36, ph / 2 + Math.sin(a) * ph * 0.36); ctx.lineTo(pw / 2 + Math.cos(a) * pw * 0.44, ph / 2 + Math.sin(a) * ph * 0.44); ctx.stroke(); } }, u, 0.0035, -v, -HP);
      at.label(kit, 0.07, 0.012, 2600, lbl(name), u, 0.0035, -v + 0.037, -HP);
    };
    const leds = (u, v, names, cols) => names.forEach((n, i) => {
      const x = u + i * 0.045;
      kit.add(M.black, cyl(0.006, 0.004, 12, x, 0.002, -v));
      kit.add(led(cols[i % cols.length], 2.4), sph(0.0042, 10, 6, x, 0.004, -v));
      at.label(kit, 0.045, 0.01, 2600, lbl(n), x, 0.0035, -v + 0.016, -HP);
    });
    const lcd = (u, v, lines, w = 0.16, h = 0.045) => {
      kit.add(M.black, rbox(w + 0.016, 0.006, h + 0.016, 0.003, u, 0.003, -v));
      at.label(kit, w, h, 2600, L.lcd(lines), u, 0.0064, -v, -HP, 0, 0, at.glow);
    };
    if (idx === -1) {
      plate(-0.18, 0.02, 0.4, 0.34); plate(0.21, 0.02, 0.36, 0.34);
      at.label(kit, 0.36, 0.022, 2600, lbl('CELL CONTROL', 0.36, 0.022, '#7fd6cc'), -0.18, 0.0035, -0.165, -HP);
      btn('CELL A LIGHT', -0.3, 0.08, 0xfff1c0, 0xf3ecd8);
      btn('CELL B LIGHT', -0.18, 0.08, 0xfff1c0, 0xf3ecd8);
      toggle('SEAL A', -0.06, 0.075, true);
      lcd(-0.2, -0.065, ['CELL A  -42 Pa  OK', 'CELL B  -39 Pa  OK']);
      leds(-0.33, -0.15, ['DOOR A', 'DOOR B', 'PRESS', 'TEMP', 'O2', 'BIO'], [0x30ff70, 0x30ff70, 0x30ff70, 0xffb020, 0x30ff70, 0xff3020]);
      toggle('SEAL B', 0.06, 0.075, true);
      estop('E-STOP L', 0.24, 0.03);
      at.label(kit, 0.3, 0.022, 2600, lbl('SEALS / ISOLATION', 0.3, 0.022, '#7fd6cc'), 0.2, 0.0035, -0.165, -HP);
    } else if (idx === 0) {
      plate(-0.2, 0.02, 0.36, 0.34); plate(0.2, 0.06, 0.36, 0.26);
      at.label(kit, 0.32, 0.022, 2600, lbl('ACOUSTIC / VISUAL', 0.32, 0.022, '#7fd6cc'), -0.2, 0.0035, -0.165, -HP);
      btn('TONE', -0.3, 0.08, 0x40a8ff, 0xb8d8f8);
      btn('STROBE', -0.18, 0.08, 0xff6a20, 0xf8c8a8);
      knob('VOLUME', -0.06, 0.08);
      knob('GAIN', -0.06, -0.05);
      lcd(-0.24, -0.055, ['TONE 4.1 kHz', 'STROBE 12 Hz'], 0.13, 0.042);
      leds(-0.31, -0.15, ['MIC', 'SPKR', 'REC', 'LINK'], [0x30ff70, 0x30ff70, 0xff3020, 0xffb020]);
      // speaker grille
      at.label(kit, 0.3, 0.2, 1400, (ctx, pw, ph) => { ctx.fillStyle = '#23272b'; rrect(ctx, 0, 0, pw, ph, 10); ctx.fill(); ctx.fillStyle = '#07090a'; for (let y = 10; y < ph - 6; y += 9) for (let x = 10 + ((y / 9) % 2) * 4.5; x < pw - 6; x += 9) { ctx.beginPath(); ctx.arc(x, y, 2.6, 0, TAU); ctx.fill(); } }, 0.2, 0.0035, -0.06, -HP);
      at.label(kit, 0.2, 0.016, 2600, lbl('INTERCOM · CELL A/B'), 0.2, 0.0035, -0.175, -HP);
    } else {
      plate(-0.17, 0.02, 0.42, 0.34); plate(0.22, 0.02, 0.34, 0.34);
      at.label(kit, 0.36, 0.022, 2600, lbl('ENVIRONMENT', 0.36, 0.022, '#7fd6cc'), -0.17, 0.0035, -0.165, -HP);
      toggle('VENT', -0.31, 0.075);
      ['PURGE', 'UV-C', 'HEPA 2', 'AUX'].forEach((n, i) => {
        const u = -0.22 + i * 0.07;
        kit.add(M.chrome, rbox(0.03, 0.004, 0.05, 0.002, u, 0.004, -0.075), cyl(0.005, 0.004, 12, u, 0.008, -0.075));
        kit.add(M.chrome, T(new THREE.CylinderGeometry(0.0025, 0.0035, 0.03, 8).translate(0, 0.015, 0).rotateX(i % 2 ? -0.35 : 0.35), u, 0.008, -0.075));
        at.label(kit, 0.065, 0.014, 2600, lbl(n), u, 0.0035, -0.075 + 0.046, -HP);
      });
      lcd(-0.17, -0.07, ['AIRFLOW 0.51 m/s', 'HEPA dP 212 Pa'], 0.2);
      // key switch
      kit.add(M.chrome, cyl(0.018, 0.01, 24, 0.13, 0.005, -0.1), cyl(0.012, 0.006, 20, 0.13, 0.012, -0.1));
      kit.add(M.brass, box(0.004, 0.022, 0.014, 0.13, 0.024, -0.1, 0, 0.6, 0), cyl(0.009, 0.003, 16, 0.13, 0.036, -0.1, HP, 0.6, 0));
      at.label(kit, 0.09, 0.014, 2600, lbl('MASTER ARM'), 0.13, 0.0035, -0.1 + 0.035, -HP);
      estop('E-STOP R', 0.25, 0.04);
      at.label(kit, 0.3, 0.022, 2600, lbl('OVERRIDE', 0.3, 0.022, '#ff8a70'), 0.2, 0.0035, -0.165, -HP);
    }
    kit.pop();
    // closure behind/below the slope
    kit.add(M.white, box(mw, 0.26, 0.2, 0, 0.88, -0.4));
    // ---- turret with screen
    kit.add(M.white, rbox(mw, 0.58, 0.22, 0.01, 0, 1.28, -0.39));
    kit.add(M.grey, box(mw - 0.02, 0.012, 0.004, 0, 1.0, -0.279));
    kit.add(led(0x3fd1c4, 2.2), box(mw - 0.08, 0.006, 0.004, 0, 1.565, -0.31));
    kit.add(M.panelDark, rbox(mw - 0.004, 0.025, 0.21, 0.008, 0, 1.58, -0.39));
    kit.push(0, 1.3, -0.272, -0.14, 0, 0);
    const s = monitorBody(kit, at, 0.74, 0.416, screens, { kind: ['cam', 'plan', 'vitals'][idx + 1], cam: idx === -1 ? 'CAM 04 — CELL A' : 'CAM 07 — CELL B', title: 'OBS 0' + (idx + 2), seed: seed + idx, px: 640 });
    kit.place(s.mesh); g.add(s.mesh); s.mesh.castShadow = false;
    kit.pop();
    at.label(kit, 0.3, 0.03, 2600, (ctx, pw, ph) => { ctx.fillStyle = '#2a2f34'; rrect(ctx, 0, 0, pw, ph, 6); ctx.fill(); txt(ctx, ['OBSERVATION — CELL A', 'OBSERVATION — WING C', 'OBSERVATION — CELL B'][idx + 1], pw / 2, ph * 0.55, ph * 0.5, { color: '#e8eaea', spacing: 0.12 }); }, 0, 1.53, -0.2795);
    // end panels
    for (const sgn of idx === 0 ? [] : [idx]) {
      const sh = new THREE.Shape(); [[-0.5, 0], [-0.5, 0.76], [-0.05, 0.78], [0.3, 1.02], [0.3, 1.59], [0.5, 1.59], [0.5, 0]].forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
      kit.add(M.whiteGloss, T(extrude(sh, 0.024, 0.004), sgn * (mw / 2 + 0.002) - 0.012, 0, 0, 0, HP, 0));
    }
  };
  // three modules side by side, with slim divider pilasters
  module(0);
  kit.push(mw, 0, 0); module(1); kit.pop();
  kit.push(-mw, 0, 0); module(-1); kit.pop();
  for (const sgn of [-1, 1]) {
    const x = sgn * mw / 2;
    kit.add(M.steel, rbox(0.012, 0.58, 0.012, 0.004, x, 1.28, -0.276));
    kit.add(M.grey, box(0.006, 0.64, 0.012, x, 0.4, -0.05));
  }
  // keyboard + trackball on the centre worktop
  kit.push(-0.06, 0.76, 0.3, 0, 0, 0); keyboard(kit, at, { keyMat: M.darkGrey, baseMat: M.black }); kit.pop();
  kit.add(M.black, rbox(0.1, 0.03, 0.12, 0.012, 0.32, 0.775, 0.3));
  kit.add(phys({ color: 0x1f8a8a, roughness: 0.15, clearcoat: 1 }), sph(0.022, 20, 14, 0.32, 0.79, 0.29));
  kit.add(M.darkGrey, rbox(0.03, 0.008, 0.02, 0.003, 0.3, 0.79, 0.34), rbox(0.03, 0.008, 0.02, 0.003, 0.34, 0.79, 0.34));
  // gooseneck microphone with talk button
  kit.add(M.black, rbox(0.1, 0.032, 0.13, 0.01, -0.36, 0.776, 0.33));
  at.label(kit, 0.07, 0.016, 2600, lbl('PUSH TO TALK'), -0.36, 0.7925, 0.37, -HP);
  const talkMat = phys({ color: 0x1f8a8a, roughness: 0.3, clearcoat: 1, emissive: 0x30ffd0, emissiveIntensity: 0.1 });
  makeButton(kit, g, buttons, 'TALK', talkMat, 0x30ffd0, rbox(0.05, 0.012, 0.03, 0.005, -0.36, 0.796, 0.35));
  const curve = gooseneck(kit, [[-0.36, 0.79, 0.3], [-0.36, 0.9, 0.29], [-0.35, 1.02, 0.32], [-0.33, 1.08, 0.4]]);
  const tip = curve.getPointAt(1), tan = curve.getTangentAt(1);
  kit.add(M.black, orientAlong(new THREE.CylinderGeometry(0.011, 0.009, 0.05, 16).rotateX(HP), tip.clone().addScaledVector(tan, 0.025), tan));
  kit.add(M.fabricDark, orientAlong(new THREE.SphereGeometry(0.014, 14, 10).scale(1, 1, 1.3), tip.clone().addScaledVector(tan, 0.058), tan));
  const ringMat = lamp(0xff2a1a, 0.2, 0x220000);
  const ring = new THREE.Mesh(orientAlong(new THREE.TorusGeometry(0.0112, 0.0022, 6, 20), tip.clone().addScaledVector(tan, 0.042), tan), ringMat);
  g.add(ring);
  // cables
  kit.add(M.cableBlack, tube([[-0.36, 0.77, 0.27], [-0.3, 0.765, 0.12], [-0.2, 0.7, 0.04], [-0.1, 0.5, -0.04]], 0.003, 16, 5));
  kit.build(g);
  for (const b of Object.values(buttons)) b.userData.setLit?.(false);
  buttons['CELL A LIGHT'].userData.setLit(true); buttons['SEAL A'].userData.setLit(true); buttons['SEAL B'].userData.setLit(true);
  g.userData.screens = screens;
  g.userData.buttons = buttons;
  g.userData.micLed = ring;
  g.userData.setTalk = (on) => { ringMat.emissiveIntensity = on ? 3 : 0.2; buttons.TALK.userData.setLit(on); };
  g.userData.collider = { w: 2.64, d: 1.0 };
  return g;
}

// ================================================================== INFRASTRUCTURE
// Wire-basket cable tray. Origin at the centre of the tray bottom, runs along X; threaded-rod hangers rise
// `drop` metres to the ceiling attach point (top of the rods = y = 0.1 + drop).
export function cableTray({ length = 2, width = 0.3, drop = 0.25, seed } = {}) {
  seed = seedOf(seed); const r = rng(seed);
  const g = new THREE.Group(); g.name = 'cableTray';
  const kit = new Kit(), H = 0.1, wr = 0.0022;
  for (let i = 0; i <= 6; i++) kit.add(M.wire, cyl(wr, length, 5, 0, 0.002, -width / 2 + (i * width) / 6, 0, 0, HP));
  for (const s of [-1, 1]) for (const y of [0.05, H]) kit.add(M.wire, cyl(wr, length, 5, 0, y, s * width / 2, 0, 0, HP));
  for (let x = -length / 2 + 0.05; x <= length / 2 - 0.04; x += 0.1) {
    kit.add(M.wire, cyl(wr, width, 5, x, 0, 0, HP));
    for (const s of [-1, 1]) kit.add(M.wire, cyl(wr, H, 5, x, H / 2, s * width / 2), sph(wr * 1.6, 5, 4, x, H, s * width / 2));
  }
  // trapeze hangers
  const nH = Math.max(2, Math.round(length / 1.2) + 1);
  for (let i = 0; i < nH; i++) {
    const x = -length / 2 + 0.15 + (i * (length - 0.3)) / (nH - 1);
    kit.add(M.steel, box(0.041, 0.041, width + 0.14, x, -0.022, 0));
    kit.add(M.dark, box(0.022, 0.002, width + 0.14, x, -0.001, 0));
    for (const s of [-1, 1]) {
      kit.add(M.steelDark, cyl(0.005, drop + 0.15, 6, x, (drop + 0.15) / 2 - 0.05 + 0.0, s * (width / 2 + 0.04)));
      kit.add(M.steelDark, cyl(0.009, 0.008, 6, x, -0.046, s * (width / 2 + 0.04)), cyl(0.009, 0.008, 6, x, 0.003, s * (width / 2 + 0.04)));
      kit.add(M.steel, cyl(0.02, 0.006, 12, x, 0.1 + drop - 0.003, s * (width / 2 + 0.04)));
    }
  }
  // cables
  const cms = [M.cableBlack, M.cableGrey, M.cableBlue, M.cableBlack, M.cableTeal, M.cableYellow, M.cableBlack, M.cableGrey, M.cableRed];
  for (let i = 0; i < 9; i++) {
    const z = -width / 2 + 0.03 + r() * (width - 0.06), rad = 0.005 + r() * 0.009, pts = [];
    for (let x = -length / 2 - 0.02; x <= length / 2 + 0.03; x += 0.25) pts.push([Math.min(x, length / 2 + 0.02), rad + 0.003 + (i > 5 ? rad * 2 : 0) + r() * 0.004, z + (r() - 0.5) * 0.03]);
    kit.add(cms[i], tube(pts, rad, Math.ceil(length * 8), 6));
  }
  for (let x = -length / 2 + 0.3; x < length / 2; x += 0.6) kit.add(M.black, tor(0.045, 0.002, 4, 16, TAU, x, 0.035, 0, 0, HP, 0));
  kit.build(g);
  g.userData.collider = null;
  return g;
}

// Louvred wall grille. Origin at the wall surface, centre of the grille, front +Z.
export function ventGrille({ w = 0.6, h = 0.3 } = {}) {
  const g = new THREE.Group(); g.name = 'ventGrille';
  const kit = new Kit(), f = 0.03;
  kit.add(M.dark, box(w - 0.02, h - 0.02, 0.002, 0, 0, -0.06));
  for (const s of [-1, 1]) { kit.add(M.grey, box(0.002, h - 0.02, 0.06, s * (w / 2 - 0.011), 0, -0.03)); kit.add(M.grey, box(w - 0.02, 0.002, 0.06, 0, s * (h / 2 - 0.011), -0.03)); }
  kit.add(M.white, rbox(w, f, 0.012, 0.004, 0, h / 2 - f / 2, 0.006), rbox(w, f, 0.012, 0.004, 0, -h / 2 + f / 2, 0.006), rbox(f, h, 0.012, 0.004, -w / 2 + f / 2, 0, 0.006), rbox(f, h, 0.012, 0.004, w / 2 - f / 2, 0, 0.006));
  const n = Math.floor((h - 2 * f) / 0.018);
  for (let i = 0; i < n; i++) kit.add(M.white, box(w - 2 * f, 0.022, 0.0015, 0, -h / 2 + f + 0.009 + i * ((h - 2 * f) / n), 0.0, -0.7, 0, 0));
  // damper blades behind
  for (let i = 0; i < 3; i++) kit.add(M.steelDark, box(w - 0.06, 0.002, 0.03, 0, -h / 4 + (i * h) / 4, -0.035, 0.4, 0, 0));
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) screwHead(kit, a * (w / 2 - f / 2), b * (h / 2 - f / 2), 0.0125, HP, 0, 0, 0.003);
  kit.build(g);
  g.userData.collider = null;
  return g;
}

// Wall-mounted bullet camera. Origin at the wall, front +Z. userData.head = pivot group, userData.led = red LED.
export function securityCamera({ seed } = {}) {
  const g = new THREE.Group(); g.name = 'securityCamera';
  const kit = new Kit(), hk = new Kit(), at = new Atlas('secCam', 512, 256);
  kit.add(M.whiteGloss, rbox(0.09, 0.13, 0.014, 0.006, 0, 0, 0.007));
  for (const y of [-0.045, 0.045]) screwHead(kit, 0, y, 0.0145, HP, 0, 0, 0.0035);
  kit.add(M.whiteGloss, cyl(0.022, 0.03, 16, 0, 0, 0.028, HP));
  kit.add(M.whiteGloss, tube([[0, 0, 0.03], [0, 0.0, 0.09], [0, 0.03, 0.15], [0, 0.06, 0.18]], 0.014, 16, 10));
  kit.add(M.whiteGloss, sph(0.022, 14, 10, 0, 0.065, 0.185));
  kit.add(M.cableGrey, tube([[0.01, -0.06, 0.004], [0.01, -0.09, 0.004], [0.012, -0.2, 0.003]], 0.0035, 8, 5));
  kit.build(g);
  const head = new THREE.Group(); head.name = 'cameraHead'; head.position.set(0, 0.065, 0.185); head.rotation.x = -0.4; g.add(head);
  hk.add(M.whiteGloss, rbox(0.085, 0.085, 0.22, 0.02, 0, 0.045, 0.06));
  hk.add(M.whiteGloss, rbox(0.11, 0.008, 0.25, 0.004, 0, 0.094, 0.07)); // sun shield
  for (const s of [-1, 1]) hk.add(M.whiteGloss, box(0.004, 0.03, 0.18, s * 0.055, 0.08, 0.08));
  hk.add(M.black, cyl(0.036, 0.012, 24, 0, 0.045, 0.173, HP));
  hk.add(M.blackGloss, cyl(0.03, 0.002, 24, 0, 0.045, 0.18, HP));
  hk.add(M.glassDark, cyl(0.014, 0.004, 20, 0, 0.045, 0.181, HP));
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; hk.add(led(0x3a0606, 0.6), sph(0.0035, 6, 4, Math.cos(a) * 0.023, 0.045 + Math.sin(a) * 0.023, 0.181)); }
  hk.add(M.whiteGloss, box(0.03, 0.03, 0.04, 0, 0.0, 0.0));
  at.label(hk, 0.06, 0.012, 3000, L.brand(null, '#7d878c'), 0.0426, 0.045, 0.06, 0, HP, 0);
  hk.build(head);
  const ledMesh = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 10, 8), lamp(0xff1a10, 4, 0x330000));
  ledMesh.position.set(0.03, 0.075, 0.172); head.add(ledMesh);
  g.userData.head = head; g.userData.led = ledMesh;
  g.userData.setRecording = (on) => { ledMesh.material.emissiveIntensity = on ? 4 : 0; };
  g.userData.collider = null;
  return g;
}

// Rotating emergency beacon on a wall bracket. Origin at the wall. userData.lamp (dome), userData.rotor, setOn(bool).
export function emergencyBeacon({ color = 0xff2a14 } = {}) {
  const g = new THREE.Group(); g.name = 'emergencyBeacon';
  const kit = new Kit();
  kit.add(M.grey, rbox(0.09, 0.14, 0.012, 0.005, 0, 0, 0.006));
  for (const y of [-0.05, 0.05]) screwHead(kit, 0, y, 0.0125, HP, 0, 0, 0.0035);
  kit.add(M.grey, box(0.05, 0.012, 0.12, 0, -0.03, 0.07), box(0.05, 0.09, 0.008, 0, 0.0, 0.016));
  for (const s of [-1, 1]) { const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0.1, 0); sh.lineTo(0, 0.07); sh.closePath(); kit.add(M.grey, T(extrude(sh, 0.004), s * 0.023 - 0.002, -0.024, 0.012, 0, -HP, 0).rotateY(0)); }
  const cx = 0, cz = 0.09, y0 = -0.024;
  kit.add(M.black, lathe([[0, 0], [0.058, 0], [0.06, 0.006], [0.058, 0.04], [0.054, 0.045], [0, 0.045]], 28, cx, y0, cz));
  kit.add(M.darkGrey, cyl(0.056, 0.006, 28, cx, y0 + 0.048, cz));
  kit.add(M.cableBlack, tube([[0, y0 + 0.01, cz - 0.05], [0, y0 - 0.02, cz - 0.06], [0, -0.07, 0.02], [0, -0.14, 0.008]], 0.004, 10, 5));
  kit.build(g);
  const domeMat = noShadow(phys({ color: 0xb01010, transparent: true, opacity: 0.72, roughness: 0.15, clearcoat: 1, emissive: color, emissiveIntensity: 0.05, depthWrite: false }));
  const dome = new THREE.Mesh(cleanGeo(lathe([[0.052, 0], [0.053, 0.06], [0.05, 0.1], [0.04, 0.125], [0.022, 0.138], [0, 0.141]], 28, cx, y0 + 0.051, cz)), domeMat);
  dome.name = 'beaconDome'; dome.renderOrder = 2; g.add(dome);
  const rotor = new THREE.Group(); rotor.position.set(cx, y0 + 0.051, cz); g.add(rotor);
  const rk = new Kit();
  rk.add(M.chrome, T(new THREE.CylinderGeometry(0.04, 0.04, 0.09, 16, 1, true, 0, PI), 0, 0.05, 0));
  rk.add(M.steelDark, cyl(0.006, 0.1, 8, 0, 0.05, 0));
  rk.build(rotor);
  const bulbMat = lamp(0xffd0b0, 0.2, 0x553322);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 10).scale(1, 1.6, 1), bulbMat); bulb.position.set(0, 0.05, 0.012); rotor.add(bulb);
  g.userData.lamp = dome; g.userData.rotor = rotor; g.userData.bulb = bulb;
  g.userData.on = false;
  g.userData.setOn = (on) => { g.userData.on = on; domeMat.emissiveIntensity = on ? 2.2 : 0.05; domeMat.opacity = on ? 0.85 : 0.72; bulbMat.emissiveIntensity = on ? 6 : 0.2; };
  g.userData.update = (t) => { if (g.userData.on) rotor.rotation.y = t * 9; };
  g.userData.collider = null;
  return g;
}

// Recessed LED troffer. Origin at the ceiling plane, the panel faces -Y. userData.diffuser, setLevel(0..1).
export function ceilingLightPanel({ w = 1.2, d = 0.6, level = 1 } = {}) {
  const g = new THREE.Group(); g.name = 'ceilingLightPanel';
  const kit = new Kit(), f = 0.028;
  kit.add(M.white, rbox(w, 0.01, f, 0.003, 0, -0.005, d / 2 - f / 2), rbox(w, 0.01, f, 0.003, 0, -0.005, -d / 2 + f / 2), rbox(f, 0.01, d, 0.003, w / 2 - f / 2, -0.005, 0), rbox(f, 0.01, d, 0.003, -w / 2 + f / 2, -0.005, 0));
  for (const s of [-1, 1]) { kit.add(M.grey, box(w - 2 * f, 0.03, 0.003, 0, 0.005, s * (d / 2 - f)), box(0.003, 0.03, d - 2 * f, s * (w / 2 - f), 0.005, 0)); }
  kit.add(M.grey, box(w, 0.06, d, 0, 0.05, 0));
  // small occupancy sensor
  kit.add(M.white, cyl(0.016, 0.006, 16, w / 2 - 0.06, -0.012, 0));
  kit.add(M.glassDark, sph(0.011, 12, 6, w / 2 - 0.06, -0.015, 0));
  kit.build(g);
  const tex = cachedTex('diffuser', () => {
    const c = mkCanvas(256, 256), ctx = c.getContext('2d');
    const gr = ctx.createRadialGradient(128, 128, 20, 128, 128, 190); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#dfe6ea');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = 'rgba(160,175,185,0.18)'; for (let i = 0; i < 256; i += 4) { ctx.fillRect(i, 0, 1, 256); ctx.fillRect(0, i, 256, 1); }
    return texFrom(c);
  });
  const mat = noShadow(std({ color: 0xf4f7f8, map: tex, emissive: 0xf2f6ff, emissiveMap: tex, emissiveIntensity: 2.2 * level, roughness: 0.6 }));
  const diffuser = new THREE.Mesh(new THREE.PlaneGeometry(w - 2 * f, d - 2 * f).rotateX(HP), mat);
  diffuser.position.y = -0.006; diffuser.name = 'diffuser'; g.add(diffuser);
  g.userData.diffuser = diffuser;
  g.userData.setLevel = (v) => { mat.emissiveIntensity = 2.2 * Math.max(0, Math.min(1, v)); };
  g.userData.collider = null;
  return g;
}

// ================================================================== ACCESS CONTROL
function drawBadge(ctx, w, h, state = 'idle') {
  const col = state === 'ok' ? '#3fe08a' : state === 'deny' ? '#ff4a3a' : '#3fd1c4';
  ctx.fillStyle = '#04090a'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = col; ctx.fillRect(0, 0, w, h * 0.14);
  txt(ctx, 'HALVERSEN SECURE', w / 2, h * 0.075, h * 0.09, { color: '#04090a', w: 700 });
  const msg = state === 'ok' ? ['ACCESS', 'GRANTED'] : state === 'deny' ? ['ACCESS', 'DENIED'] : ['PRESENT', 'BADGE'];
  txt(ctx, msg[0], w / 2, h * 0.42, h * 0.2, { color: col, w: 700 });
  txt(ctx, msg[1], w / 2, h * 0.66, h * 0.2, { color: col, w: 700 });
  txt(ctx, state === 'deny' ? 'CLEARANCE 4 REQUIRED' : 'SITE 41 · WING C', w / 2, h * 0.88, h * 0.075, { color: '#6f9c98' });
}
export function badgeReader({ state = 'idle' } = {}) {
  const g = new THREE.Group(); g.name = 'badgeReader';
  const kit = new Kit(), at = new Atlas('badgeReader', 512, 512);
  kit.add(M.steel, rbox(0.1, 0.17, 0.006, 0.004, 0, 0, 0.003));
  for (const y of [-0.075, 0.075]) screwHead(kit, 0, y, 0.0062, HP, 0, 0, 0.003);
  kit.add(M.black, rbox(0.082, 0.14, 0.03, 0.01, 0, 0, 0.021));
  kit.add(M.blackGloss, rbox(0.072, 0.128, 0.002, 0.006, 0, 0, 0.036));
  at.label(kit, 0.05, 0.04, 4000, (ctx, pw, ph) => { // contactless card icon
    ctx.strokeStyle = '#8fa0a6'; ctx.lineWidth = 6; rrect(ctx, pw * 0.15, ph * 0.3, pw * 0.5, ph * 0.55, 10); ctx.stroke();
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(pw * 0.62, ph * 0.45, pw * (0.12 + i * 0.09), -0.7, 0.7); ctx.stroke(); }
  }, 0, -0.028, 0.0372);
  at.label(kit, 0.06, 0.01, 4000, L.brand(null, '#7d878c'), 0, -0.058, 0.0372);
  kit.add(M.darkGrey, box(0.07, 0.003, 0.02, 0, -0.07, 0.024));
  kit.build(g);
  const scr = makeScreen(0.05, 0.03, { draw: (ctx, w, h) => drawBadge(ctx, w, h, state) }, 256);
  scr.mesh.position.set(0, 0.032, 0.0372); g.add(scr.mesh);
  const ledMat = lamp(0x3fd1c4, 2.5, 0x111111);
  const ledBar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.005, 0.003), ledMat); ledBar.position.set(0, 0.058, 0.0372); g.add(ledBar);
  const COLS = { idle: 0x3fd1c4, ok: 0x30ff70, deny: 0xff2a14 };
  g.userData.led = ledBar;
  g.userData.screens = [scr];
  g.userData.state = state;
  g.userData.setState = (s) => {
    g.userData.state = s; ledMat.emissive.setHex(COLS[s] ?? COLS.idle);
    drawBadge(scr.ctx, scr.width, scr.height, s); scr.texture.needsUpdate = true;
  };
  g.userData.setState(state);
  g.userData.collider = null;
  return g;
}

export function keypad() {
  const g = new THREE.Group(); g.name = 'keypad';
  const kit = new Kit(), at = new Atlas('keypad', 512, 512);
  kit.add(M.steel, rbox(0.09, 0.15, 0.02, 0.008, 0, 0, 0.01));
  kit.add(M.steelDark, rbox(0.094, 0.154, 0.006, 0.006, 0, 0, 0.003));
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) screwHead(kit, a * 0.036, b * 0.064, 0.0205, HP, 0, 0, 0.0028, M.steelDark);
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
  keys.forEach((k, i) => {
    const x = (i % 3 - 1) * 0.022, y = 0.012 - Math.floor(i / 3) * 0.02;
    kit.add(M.chrome, cyl(0.0085, 0.004, 20, x, y, 0.022, HP));
    kit.add(M.steelDark, cyl(0.0095, 0.0016, 20, x, y, 0.0205, HP));
    at.label(kit, 0.012, 0.012, 5000, L.text(k, { color: '#2b3034', size: 0.8 }), x, y, 0.0242);
  });
  at.label(kit, 0.07, 0.012, 4000, L.text('ENTER CODE', { color: '#3a4146', size: 0.6 }), 0, 0.058, 0.0202);
  kit.add(M.black, rbox(0.06, 0.014, 0.003, 0.002, 0, 0.042, 0.021));
  kit.build(g);
  const ledR = new THREE.Mesh(new THREE.SphereGeometry(0.003, 10, 6), lamp(0xff2a14, 2.5)); ledR.position.set(-0.012, 0.042, 0.0225);
  const ledG = new THREE.Mesh(new THREE.SphereGeometry(0.003, 10, 6), lamp(0x30ff70, 0.1)); ledG.position.set(0.012, 0.042, 0.0225);
  g.add(ledR, ledG);
  g.userData.leds = { red: ledR, green: ledG };
  g.userData.setState = (s) => { ledR.material.emissiveIntensity = s === 'ok' ? 0.1 : s === 'deny' ? 4 : 2; ledG.material.emissiveIntensity = s === 'ok' ? 3 : 0.1; };
  g.userData.collider = null;
  return g;
}

// ================================================================== SIGNS & FLOOR MARKINGS
const SIGN_DEF = { info: [0.45, 0.16], warning: [0.4, 0.2], biohazard: [0.36, 0.24], exit: [0.36, 0.15], room: [0.3, 0.2] };
function drawSign(ctx, pw, ph, text, style, sub) {
  if (style === 'warning') { L.warn(text, sub)(ctx, pw, ph); return; }
  if (style === 'biohazard') {
    ctx.fillStyle = PALETTE.bio; rrect(ctx, 0, 0, pw, ph, ph * 0.06); ctx.fill();
    ctx.strokeStyle = '#111'; ctx.lineWidth = ph * 0.03; rrect(ctx, ph * 0.04, ph * 0.04, pw - ph * 0.08, ph - ph * 0.08, ph * 0.04); ctx.stroke();
    bioSymbol(ctx, ph * 0.48, ph * 0.5, ph * 0.33, '#111');
    const x0 = ph * 0.9, cx = x0 + (pw - x0) / 2 - ph * 0.04;
    txt(ctx, text, cx, sub ? ph * 0.4 : ph * 0.5, ph * 0.22, { color: '#111', w: 700, maxW: pw - x0 - ph * 0.1 });
    if (sub) txt(ctx, sub, cx, ph * 0.66, ph * 0.1, { color: '#111', maxW: pw - x0 - ph * 0.1 });
    return;
  }
  if (style === 'exit') {
    ctx.fillStyle = PALETTE.exit; rrect(ctx, 0, 0, pw, ph, ph * 0.06); ctx.fill();
    ctx.fillStyle = '#fff'; const u = ph / 10;
    // running figure + door
    ctx.fillRect(u * 1.2, u * 1.5, u * 3.4, u * 7); ctx.fillStyle = PALETTE.exit; ctx.fillRect(u * 1.7, u * 2, u * 2.4, u * 6.5);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(u * 6.2, u * 2.3, u * 0.8, 0, TAU); ctx.fill();
    ctx.lineWidth = u * 0.9; ctx.lineCap = 'round'; ctx.strokeStyle = '#fff';
    const seg = (pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * u, y * u) : ctx.moveTo(x * u, y * u))); ctx.stroke(); };
    seg([[5.8, 3.6], [5.0, 6.0]]); seg([[5.0, 6.0], [6.4, 7.0], [6.6, 8.6]]); seg([[5.0, 6.0], [4.2, 7.4], [3.4, 8.0]]); seg([[5.6, 4.0], [6.8, 5.0], [7.6, 4.6]]); seg([[5.6, 4.0], [4.6, 4.4], [4.0, 5.2]]);
    txt(ctx, text, pw * 0.62, ph * 0.52, ph * 0.5, { color: '#fff', w: 700, maxW: pw * 0.35 });
    ctx.beginPath(); const ax = pw * 0.86, ay = ph * 0.5; ctx.moveTo(ax + u * 1.6, ay); ctx.lineTo(ax, ay - u * 1.5); ctx.lineTo(ax, ay - u * 0.6); ctx.lineTo(ax - u * 1.4, ay - u * 0.6); ctx.lineTo(ax - u * 1.4, ay + u * 0.6); ctx.lineTo(ax, ay + u * 0.6); ctx.lineTo(ax, ay + u * 1.5); ctx.closePath(); ctx.fill();
    return;
  }
  if (style === 'room') {
    ctx.fillStyle = '#f6f7f5'; rrect(ctx, 0, 0, pw, ph, ph * 0.05); ctx.fill();
    ctx.fillStyle = PALETTE.teal; ctx.fillRect(0, 0, pw * 0.07, ph);
    hexMark(ctx, pw * 0.86, ph * 0.18, ph * 0.08, PALETTE.teal);
    txt(ctx, 'WING C', pw * 0.14, ph * 0.18, ph * 0.08, { color: '#5c666b', align: 'left', spacing: 0.15 });
    txt(ctx, text, pw * 0.14, ph * 0.5, ph * 0.34, { color: '#1b1f22', align: 'left', w: 700, maxW: pw * 0.8 });
    if (sub) txt(ctx, sub, pw * 0.14, ph * 0.8, ph * 0.09, { color: '#3d4549', align: 'left', spacing: 0.08, maxW: pw * 0.8 });
    return;
  }
  // info
  ctx.fillStyle = '#f6f7f5'; rrect(ctx, 0, 0, pw, ph, ph * 0.06); ctx.fill();
  ctx.fillStyle = PALETTE.teal; ctx.fillRect(0, 0, pw, ph * 0.26);
  wordmark(ctx, ph * 0.08, ph * 0.13, ph * 0.12, '#ffffff');
  txt(ctx, 'SITE 41 · WING C', pw - ph * 0.08, ph * 0.13, ph * 0.08, { color: '#d8f0ee', align: 'right', spacing: 0.1 });
  txt(ctx, text, pw / 2, sub ? ph * 0.53 : ph * 0.62, ph * 0.24, { color: '#1b1f22', w: 700, maxW: pw * 0.9 });
  if (sub) txt(ctx, sub, pw / 2, ph * 0.8, ph * 0.1, { color: '#3d4549', maxW: pw * 0.9, spacing: 0.06 });
}
// Wall sign plate. Origin at the wall at the centre of the plate, front +Z.
export function sign(text = 'NOTICE', { w, h, style = 'info', sub, lit = style === 'exit' } = {}) {
  const [dw, dh] = SIGN_DEF[style] || SIGN_DEF.info;
  w = w ?? dw; h = h ?? dh;
  const g = new THREE.Group(); g.name = `sign_${style}`;
  const kit = new Kit();
  const t = 0.005;
  if (style === 'exit') {
    kit.add(M.whiteGloss, rbox(w + 0.03, h + 0.03, 0.05, 0.008, 0, 0, 0.025));
  } else kit.add(style === 'room' ? M.steel : M.white, rbox(w, h, t, 0.006, 0, 0, t / 2 + 0.006));
  if (style !== 'exit') for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { kit.add(M.chrome, cyl(0.006, 0.006, 12, a * (w / 2 - 0.018), b * (h / 2 - 0.018), 0.003, HP)); }
  const key = `sign|${text}|${style}|${sub}|${w}|${h}`;
  const tex = cachedTex(key, () => {
    const ppm = Math.min(2400, 2048 / w), pw = Math.round(w * ppm), ph = Math.round(h * ppm);
    const c = mkCanvas(pw, ph), ctx = c.getContext('2d'); drawSign(ctx, pw, ph, text, style, sub); grain(ctx, pw, ph, 0.03, pw);
    return texFrom(c);
  });
  const face = lit
    ? noShadow(std({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 1.3, roughness: 0.3, transparent: true, alphaTest: 0.3 }))
    : cachedMat('signface' + key, () => std({ map: tex, roughness: 0.35, alphaTest: 0.3, polygonOffset: true, polygonOffsetFactor: -2 }));
  const fz = style === 'exit' ? 0.0505 : t + 0.0061;
  const m = single(new THREE.PlaneGeometry(w, h).translate(0, 0, fz), face, false);
  if (style !== 'exit') for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) screwHead(kit, a * (w / 2 - 0.018), b * (h / 2 - 0.018), fz + 0.0005, HP, 0, 0, 0.0045);
  kit.build(g); g.add(m);
  g.userData.face = m;
  g.userData.collider = null;
  return g;
}

// Thin floor marking. Origin on the floor at its centre; lies in XZ (w along X, h along Z).
export function floorDecal(text = '', { w = 1, h = 0.1, style = 'hazard', color = '#e2b81e' } = {}) {
  const key = `decal|${text}|${style}|${w}|${h}|${color}`;
  const mat = cachedMat(key, () => {
    const ppm = Math.min(600, 2048 / Math.max(w, h)), pw = Math.round(w * ppm), ph = Math.round(h * ppm);
    const c = mkCanvas(pw, ph), ctx = c.getContext('2d');
    if (style === 'hazard') stripes(ctx, 0, 0, pw, ph, Math.min(ph * 1.4, 0.14 * ppm));
    else if (style === 'keepclear') {
      const b = Math.max(6, 0.06 * ppm);
      stripes(ctx, 0, 0, pw, ph, 0.14 * ppm);
      ctx.clearRect(b, b, pw - 2 * b, ph - 2 * b);
      txt(ctx, text || 'KEEP CLEAR', pw / 2, ph / 2, Math.min(ph * 0.22, pw * 0.13), { color, w: 700, maxW: pw - 4 * b, spacing: 0.08 });
    } else if (style === 'line') { ctx.fillStyle = color; ctx.fillRect(0, 0, pw, ph); }
    else if (style === 'arrow') {
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(pw, ph / 2); ctx.lineTo(pw - ph * 0.5, 0); ctx.lineTo(pw - ph * 0.5, ph * 0.3); ctx.lineTo(0, ph * 0.3); ctx.lineTo(0, ph * 0.7); ctx.lineTo(pw - ph * 0.5, ph * 0.7); ctx.lineTo(pw - ph * 0.5, ph); ctx.closePath(); ctx.fill();
      if (text) txt(ctx, text, (pw - ph * 0.5) / 2, ph / 2, ph * 0.3, { color: '#1b1f22', w: 700, maxW: pw * 0.6 });
    } else txt(ctx, text, pw / 2, ph / 2, ph * 0.8, { color, w: 700, maxW: pw * 0.96, spacing: 0.1 });
    // scuffs
    ctx.globalCompositeOperation = 'destination-out'; const r = rng(pw + ph);
    for (let i = 0; i < (pw * ph) / 900; i++) { ctx.fillStyle = `rgba(0,0,0,${0.15 + r() * 0.5})`; ctx.fillRect(r() * pw, r() * ph, 1 + r() * 3, 1 + r() * 2); }
    return std({ map: texFrom(c), roughness: 0.55, transparent: true, alphaTest: 0.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  });
  const g = new THREE.Group(); g.name = `floorDecal_${style}`;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h).rotateX(-HP).translate(0, 0.002, 0), mat);
  m.receiveShadow = true; g.add(m);
  g.userData.collider = null;
  return g;
}

// ================================================================== HALIDE STROBE LAMP (first-person viewmodel)
// Origin at the centre of the grip (where the hand holds it). Lens faces -Z. ~0.37 m long.
export function halideLamp() {
  const g = new THREE.Group(); g.name = 'halideLamp';
  const kit = new Kit(), at = new Atlas('halideLamp', 1024, 1024);
  const body = paint(0x2c3236, 0.42, 0.55), accent = M.yellow;
  const oy = 0.1; // body axis height above grip centre
  kit.push(0, oy, 0);
  // main body tube along Z
  kit.add(body, cyl(0.052, 0.17, 32, 0, 0, 0.035, HP));
  // cooling fins
  for (let i = 0; i < 7; i++) kit.add(M.alu, cyl(0.062, 0.004, 32, 0, 0, -0.03 + i * 0.012, HP));
  kit.add(M.dark, cyl(0.05, 0.08, 24, 0, 0, 0.007, HP));
  // reflector head (flared)
  kit.add(body, lathe([[0.052, 0], [0.06, -0.02], [0.076, -0.07], [0.086, -0.1], [0.088, -0.11], [0.08, -0.112], [0.074, -0.1]], 40, 0, 0, -0.05, HP, 0, 0));
  kit.add(M.rubber, tor(0.085, 0.011, 10, 40, TAU, 0, 0, -0.158));
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; kit.add(M.rubber, box(0.016, 0.014, 0.02, Math.cos(a) * 0.092, Math.sin(a) * 0.092, -0.158, 0, 0, a)); }
  // inner reflector + arc tube
  kit.add(M.chrome, lathe([[0.012, 0], [0.03, -0.01], [0.055, -0.04], [0.074, -0.085]], 32, 0, 0, -0.07, HP, 0, 0));
  kit.add(M.glass, cyl(0.006, 0.05, 10, 0, 0, -0.1, HP));
  kit.add(M.glass, cyl(0.08, 0.004, 40, 0, 0, -0.152, HP));
  kit.add(M.chrome, tor(0.079, 0.003, 6, 40, TAU, 0, 0, -0.151));
  // safety yellow bumper ring and top capacitor housing
  kit.add(accent, cyl(0.055, 0.014, 32, 0, 0, 0.108, HP));
  kit.add(body, rbox(0.05, 0.035, 0.16, 0.012, 0, 0.058, 0.04));
  kit.add(accent, rbox(0.052, 0.004, 0.03, 0.0015, 0, 0.0765, 0.1));
  for (let i = 0; i < 6; i++) kit.add(M.dark, box(0.0015, 0.018, 0.007, -0.0252, 0.058, -0.02 + i * 0.016), box(0.04, 0.0025, 0.004, 0, 0.0765 + 0.0018, -0.01 + i * 0.018));
  // side charge contacts, screws, strap lugs
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) screwHead(kit, s * 0.0525, 0.0, -0.02 + i * 0.04, 0, 0, s * HP, 0.003, M.steelDark);
    kit.add(M.steel, tor(0.012, 0.003, 6, 12, PI, s * 0.058, 0.03, 0.1, 0, HP, 0));
  }
  // labels
  at.label(kit, 0.1, 0.03, 4000, (ctx, pw, ph) => { ctx.fillStyle = '#1b1f22'; ctx.fillRect(0, 0, pw, ph); wordmark(ctx, pw * 0.05, ph * 0.33, ph * 0.26, PALETTE.yellow); txt(ctx, 'HX-4 HALIDE STROBE', pw * 0.05, ph * 0.76, ph * 0.22, { color: '#e8eaea', align: 'left', spacing: 0.08 }); }, 0.0255 + 0.0005, 0.058, 0.04, 0, HP, 0);
  at.label(kit, 0.075, 0.03, 4000, L.warn('HIGH VOLTAGE', 'DISCHARGE BEFORE SERVICE'), -0.0525, 0.0, 0.02, 0, -HP, 0);
  // rear: battery pack
  kit.add(body, rbox(0.085, 0.09, 0.115, 0.012, 0, -0.005, 0.175));
  kit.add(M.rubber, rbox(0.09, 0.095, 0.012, 0.004, 0, -0.005, 0.233));
  kit.add(accent, rbox(0.087, 0.01, 0.1, 0.003, 0, -0.051, 0.175));
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) kit.add(M.rubber, rbox(0.004, 0.07, 0.008, 0.0015, s * 0.0435, -0.005, 0.13 + i * 0.016));
  at.label(kit, 0.09, 0.05, 4000, (ctx, pw, ph) => { ctx.fillStyle = '#1b1f22'; ctx.fillRect(0, 0, pw, ph); ctx.fillStyle = PALETTE.yellow; ctx.fillRect(0, 0, pw, ph * 0.12); txt(ctx, 'LI-ION 28 V · 9.0 Ah', pw * 0.06, ph * 0.32, ph * 0.13, { color: '#e8eaea', align: 'left' }); txt(ctx, 'CHARGE ONLY IN DOCK C-2', pw * 0.06, ph * 0.52, ph * 0.1, { color: '#9aa3a8', align: 'left' }); barcode(ctx, pw * 0.06, ph * 0.64, pw * 0.5, ph * 0.22, 77); warnTriangle(ctx, pw * 0.8, ph * 0.72, ph * 0.3); }, 0, -0.005, 0.2391);
  // charge bar housing on top/back (visible to the player)
  kit.add(M.black, rbox(0.06, 0.006, 0.026, 0.002, 0, 0.042, 0.168));
  at.label(kit, 0.05, 0.008, 5000, L.text('CHARGE', { color: '#c9cdd0', size: 0.7 }), 0, 0.0405, 0.186, -HP);
  kit.pop();
  // pistol grip + trigger
  kit.add(M.rubber, T(new RoundedBoxGeometry(0.036, 0.13, 0.05, 2, 0.014), 0, 0.0, 0.06, -0.22, 0, 0));
  for (let i = 0; i < 4; i++) kit.add(M.black, box(0.0365, 0.004, 0.035, 0, -0.035 + i * 0.022, 0.048 + i * 0.005, -0.22));
  kit.add(body, rbox(0.044, 0.02, 0.06, 0.006, 0, -0.065, 0.075, -0.22));
  kit.add(body, tor(0.025, 0.004, 6, 16, PI, 0, 0.045, 0.005, 0, HP, PI));
  kit.add(M.red, rbox(0.01, 0.03, 0.012, 0.004, 0, 0.04, 0.012, 0.3));
  kit.build(g);
  // flash emitter: fresnel-ringed disc behind the lens
  const ftex = cachedTex('fresnel', () => {
    const c = mkCanvas(256, 256), ctx = c.getContext('2d');
    const gr = ctx.createRadialGradient(128, 128, 2, 128, 128, 128); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.25, '#f4f2ff'); gr.addColorStop(1, '#b8c4d8');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 256, 256);
    for (let rr = 8; rr < 128; rr += 7) { ctx.strokeStyle = `rgba(80,90,110,${0.25 + 0.2 * Math.sin(rr)})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(128, 128, rr, 0, TAU); ctx.stroke(); }
    return texFrom(c);
  });
  const flashMat = noShadow(std({ color: 0x2a3036, map: ftex, emissive: 0xe8eeff, emissiveMap: ftex, emissiveIntensity: 0, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.55, depthWrite: false }));
  const flash = new THREE.Mesh(new THREE.CircleGeometry(0.079, 40), flashMat);
  flash.rotation.y = PI; flash.position.set(0, oy, -0.149); flash.name = 'flash'; flash.renderOrder = 3; g.add(flash);
  // charge LED segments
  const segs = [];
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.003, 0.012), lamp(0x30ff70, 0.1, 0x0a0a0a));
    m.position.set(-0.02 + i * 0.01, oy + 0.0455, 0.168); g.add(m); segs.push(m);
  }
  for (const c of g.children) { c.position.z -= 0.06; c.castShadow = false; }
  g.userData.flash = flash;
  g.userData.chargeLeds = segs;
  g.userData.setFlash = (v) => { flashMat.emissiveIntensity = v * 6; flashMat.opacity = 0.55 + 0.45 * Math.min(1, v); };
  g.userData.setCharge = (f) => {
    f = Math.max(0, Math.min(1, f)); const n = Math.ceil(f * 5 - 1e-6);
    const col = f > 0.5 ? 0x30ff70 : f > 0.2 ? 0xffb020 : 0xff2a14;
    segs.forEach((m, i) => { m.material.emissive.setHex(col); m.material.emissiveIntensity = i < n ? 1.6 : 0.05; });
  };
  g.userData.setCharge(1);
  g.userData.collider = null;
  return g;
}

// ================================================================== GLASSWARE
const FLUIDS = [0xc98a1a, 0x1fa0a0, 0x9b1b1b, 0x3a6ad0, 0x6aa83a, 0xbfe6e6, 0x6a3a9a];
function profileR(prof, y) { for (let i = 1; i < prof.length; i++) { const [r0, y0] = prof[i - 1], [r1, y1] = prof[i]; if (y <= y1 && y1 > y0) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0); } return prof[prof.length - 1][0]; }
function fluidFrom(prof, fill, inset = 0.0025) {
  const pts = [[0, 0.003]]; for (const [r, y] of prof) { if (y > 0.003 && y < fill) pts.push([Math.max(0.001, r - inset), y]); }
  pts.push([Math.max(0.001, profileR(prof, fill) - inset), fill], [0, fill]);
  return pts;
}
// kind: beaker | flask | cylinder | bottle | amber | tube ; origin at base centre
function glassware(kit, at, kind, x, y, z, { s = 1, fluid: fc = FLUIDS[0], fill = 0.5, label } = {}) {
  let prof, h;
  if (kind === 'beaker') { const r = 0.04 * s; h = 0.11 * s; prof = [[0.001, 0.0015], [r - 0.003, 0], [r, 0.004], [r, h], [r + 0.003, h + 0.003]]; }
  else if (kind === 'flask') { const R = 0.055 * s, n = 0.016 * s; h = 0.16 * s; prof = [[0.001, 0.0015], [R - 0.004, 0], [R, 0.008], [R * 0.75, h * 0.35], [n, h * 0.72], [n, h], [n + 0.003, h + 0.003]]; }
  else if (kind === 'cylinder') { const r = 0.016 * s; h = 0.3 * s; prof = [[0.001, 0.012], [r, 0.012], [r, h], [r + 0.004, h + 0.004]]; kit.add(plastic(0x2a6fb0), cyl(0.032 * s, 0.012, 6, x, y + 0.006, z)); }
  else if (kind === 'bottle' || kind === 'amber') { const r = 0.04 * s, n = 0.017 * s; h = 0.17 * s; prof = [[0.001, 0.0015], [r - 0.004, 0], [r, 0.006], [r, h * 0.7], [r * 0.8, h * 0.8], [n, h * 0.88], [n, h]]; kit.add(plastic(0x2860b8, 0.5), cyl(n + 0.004, 0.02, 12, x, y + h + 0.008, z)); }
  else { const r = 0.007 * s; h = 0.1 * s; prof = [[0.001, 0.0], [r * 0.7, 0.002], [r, 0.008], [r, h]]; }
  kit.add(kind === 'amber' ? M.glassAmber : M.glass, lathe(prof, kind === 'tube' ? 8 : 16, x, y, z));
  if (fill > 0) kit.add(fluid(fc, kind === 'amber' ? 0.85 : 0.6), lathe(fluidFrom(prof, h * fill, kind === 'tube' ? 0.0012 : 0.0025), kind === 'tube' ? 6 : 12, x, y, z));
  if (label && at) {
    const r = profileR(prof, h * 0.45);
    at.label(kit, Math.min(0.06, r * 1.3), Math.min(0.04, h * 0.3), 3000, label, x, y + h * 0.42, z + r + 0.0015);
  }
  return h;
}
const reagentLabel = (name, code, hazard) => (ctx, pw, ph) => {
  ctx.fillStyle = '#f7f7f2'; ctx.fillRect(0, 0, pw, ph);
  ctx.fillStyle = PALETTE.teal; ctx.fillRect(0, 0, pw, ph * 0.18);
  txt(ctx, 'HALVERSEN', pw * 0.5, ph * 0.09, ph * 0.12, { color: '#fff', w: 700, spacing: 0.1 });
  txt(ctx, name, pw / 2, ph * 0.42, ph * 0.2, { color: '#1b1f22', w: 700, maxW: pw * 0.9 });
  txt(ctx, code, pw / 2, ph * 0.64, ph * 0.12, { color: '#444', maxW: pw * 0.9 });
  if (hazard) { ctx.save(); ctx.translate(pw * 0.82, ph * 0.84); ctx.rotate(PI / 4); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#c01010'; ctx.lineWidth = 3; ctx.fillRect(-ph * 0.09, -ph * 0.09, ph * 0.18, ph * 0.18); ctx.strokeRect(-ph * 0.09, -ph * 0.09, ph * 0.18, ph * 0.18); ctx.restore(); }
  barcode(ctx, pw * 0.08, ph * 0.76, pw * 0.5, ph * 0.16, name.length * 13);
};
function tubeRack(kit, x, y, z, n = 8, r = rng(3)) {
  const w = n * 0.022 + 0.02;
  kit.add(M.white, box(w, 0.004, 0.05, x, y + 0.004, z), box(w, 0.004, 0.05, x, y + 0.06, z));
  for (const s of [-1, 1]) kit.add(M.white, box(0.004, 0.064, 0.05, x + s * (w / 2 - 0.002), y + 0.032, z));
  for (let i = 0; i < n; i++) {
    if (r() < 0.15) continue;
    const tx = x - w / 2 + 0.021 + i * 0.022, c = FLUIDS[Math.floor(r() * FLUIDS.length)];
    glassware(kit, null, 'tube', tx, y + 0.006, z, { s: 1, fluid: c, fill: 0.3 + r() * 0.5 });
    kit.add(plastic([0xd02020, 0x2060d0, 0xe0c020, 0x20a060, 0x9030a0][i % 5]), cyl(0.0085, 0.014, 12, tx, y + 0.112, z));
  }
}
function pipetteStand(kit, x, y, z) {
  kit.add(M.white, cyl(0.06, 0.014, 24, x, y + 0.007, z));
  kit.add(M.steel, cyl(0.006, 0.3, 10, x, y + 0.16, z));
  kit.add(M.white, cyl(0.045, 0.012, 3, x, y + 0.27, z));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.3, px = x + Math.cos(a) * 0.04, pz = z + Math.sin(a) * 0.04;
    const col = [0x2a6fb0, 0xd04020, 0xe0b020][i];
    kit.add(M.white, cyl(0.011, 0.13, 12, px, y + 0.2, pz), cyl(0.008, 0.04, 10, px, y + 0.115, pz));
    kit.add(M.steel, cyl(0.0025, 0.03, 6, px, y + 0.08, pz));
    kit.add(plastic(col), cyl(0.007, 0.03, 12, px, y + 0.28, pz), cyl(0.012, 0.012, 12, px, y + 0.24, pz));
  }
}
function sharpsBox(kit, at, x, y, z, s = 1, ry = 0) {
  kit.push(x, y, z, 0, ry, 0);
  kit.add(M.yellow, lathe([[0.001, 0], [0.07 * s, 0], [0.075 * s, 0.17 * s], [0.001, 0.17 * s]], 4, 0, 0, 0, 0, PI / 4, 0));
  kit.add(M.red, rbox(0.11 * s, 0.03 * s, 0.11 * s, 0.006, 0, 0.18 * s, 0));
  kit.add(M.dark, box(0.06 * s, 0.003, 0.02 * s, 0, 0.196 * s, 0.01 * s));
  kit.add(M.red, box(0.11 * s, 0.006, 0.02 * s, 0, 0.198 * s, -0.04 * s, 0.4, 0, 0));
  at.label(kit, 0.09 * s, 0.08 * s, 2600, (ctx, pw, ph) => { ctx.fillStyle = PALETTE.yellow; ctx.fillRect(0, 0, pw, ph); bioSymbol(ctx, pw / 2, ph * 0.36, ph * 0.24, '#111'); txt(ctx, 'SHARPS', pw / 2, ph * 0.74, ph * 0.16, { color: '#111', w: 700 }); txt(ctx, 'DO NOT OVERFILL', pw / 2, ph * 0.9, ph * 0.09, { color: '#111' }); }, 0, 0.085 * s, 0.0752 * s * 0.71 + 0.001);
  kit.pop();
}

// ================================================================== LAB BENCH
export function labBench({ length = 3, seed } = {}) {
  seed = seedOf(seed) % 3; const r = rng(seed); // 3 layout variants share label atlases
  const L0 = length, D = 1.5, H = 0.9;
  const g = new THREE.Group(); g.name = 'labBench';
  const kit = new Kit(), at = new Atlas(`bench_${L0}_${seed % 3}`, 2048, 2048);
  kit.add(M.rubber, box(L0 - 0.08, 0.1, D - 0.16, 0, 0.05, 0));
  kit.add(M.white, box(L0 - 0.03, H - 0.13, D - 0.06, 0, 0.1 + (H - 0.13) / 2, 0));
  const n = Math.max(2, Math.round(L0 / 0.6)), mwid = (L0 - 0.04) / n;
  const sinkI = Math.min(1, n - 1), xs = -L0 / 2 + 0.02 + mwid * (sinkI + 0.5);
  const drawerNames = ['PIPETTE TIPS', 'NITRILE GLOVES', 'SWABS', 'SPECIMEN BAGS', 'SEALS / SPARES', 'SLIDES', 'CRYO VIALS', 'FILTERS', 'SYRINGES', 'WIPES'];
  let di = 0;
  for (const side of [1, -1]) {
    kit.push(0, 0, 0, 0, side > 0 ? 0 : PI, 0);
    const fz = D / 2 - 0.03;
    for (let i = 0; i < n; i++) {
      const x = -L0 / 2 + 0.02 + mwid * (i + 0.5), fw = mwid - 0.006;
      const type = side > 0 && i === sinkI ? 'sink' : ['drawers', 'door', 'drawers3', 'door'][i % 4];
      if (type === 'drawers' || type === 'drawers3') {
        const k = type === 'drawers' ? 4 : 3, top = H - 0.04, bot = 0.105, dh = (top - bot) / k;
        for (let j = 0; j < k; j++) {
          const y = top - dh * (j + 0.5);
          kit.add(M.whiteGloss, rbox(fw, dh - 0.006, 0.018, 0.003, x, y, fz + 0.009));
          kit.add(M.steel, cyl(0.006, 0.14, 10, x, y + dh * 0.25, fz + 0.04, 0, 0, HP));
          for (const s of [-1, 1]) kit.add(M.steel, cyl(0.004, 0.022, 8, x + s * 0.06, y + dh * 0.25, fz + 0.028, HP));
          kit.add(M.steel, box(0.075, 0.03, 0.002, x, y - dh * 0.12, fz + 0.019));
          at.label(kit, 0.068, 0.024, 2400, L.plain(drawerNames[di++ % drawerNames.length], null, { bg: '#ffffff' }), x, y - dh * 0.12, fz + 0.0202);
        }
      } else if (type === 'door') {
        const y = (H - 0.04 + 0.105) / 2, dh = H - 0.04 - 0.105;
        kit.add(M.whiteGloss, rbox(fw, dh - 0.006, 0.018, 0.003, x, y, fz + 0.009));
        kit.add(M.steel, cyl(0.006, 0.14, 10, x + fw / 2 - 0.05, y + dh * 0.3, fz + 0.04));
        for (const s of [-1, 1]) kit.add(M.steel, cyl(0.004, 0.022, 8, x + fw / 2 - 0.05, y + dh * 0.3 + s * 0.06, fz + 0.028, HP));
        if (i % 3 === 1) at.label(kit, 0.12, 0.05, 2400, L.warn('CORROSIVES', 'STORE BELOW EYE LEVEL'), x - 0.05, y + dh * 0.3, fz + 0.0185);
      } else {
        const y = (H - 0.04 + 0.105) / 2, dh = H - 0.04 - 0.105;
        for (const s of [-1, 1]) {
          kit.add(M.whiteGloss, rbox(fw / 2 - 0.004, dh - 0.006, 0.018, 0.003, x + s * fw / 4, y, fz + 0.009));
          kit.add(M.steel, cyl(0.006, 0.12, 10, x + s * 0.03, y + dh * 0.3, fz + 0.04));
          kit.add(M.steel, cyl(0.004, 0.022, 8, x + s * 0.03, y + dh * 0.3 + 0.05, fz + 0.028, HP), cyl(0.004, 0.022, 8, x + s * 0.03, y + dh * 0.3 - 0.05, fz + 0.028, HP));
        }
        kit.add(M.dark, box(fw * 0.6, 0.004, 0.002, x, 0.15, fz + 0.0185), box(fw * 0.6, 0.004, 0.002, x, 0.165, fz + 0.0185));
      }
    }
    kit.pop();
  }
  // epoxy top with a sink cut-out (front side) and a drip groove
  const sinkW = 0.44, sinkD = 0.36, sz = 0.42;
  const top = slab(L0, D, 0.03, [{ x: xs, y: D / 2 - sz, w: sinkW, h: sinkD, r: 0.03 }], 0.012, 0.004);
  kit.add(M.epoxy, T(top.rotateX(-HP), 0, H - 0.015, D / 2));
  for (const s of [-1, 1]) kit.add(M.dark, box(L0 - 0.06, 0.004, 0.004, 0, H - 0.031, s * (D / 2 - 0.02)));
  // sink bowl + drain
  const bh = 0.2, by = H - 0.03 - bh / 2;
  kit.add(M.steel, box(sinkW, 0.004, sinkD, xs, H - 0.03 - bh, sz));
  for (const s of [-1, 1]) { kit.add(M.steel, box(0.004, bh, sinkD, xs + s * sinkW / 2, by, sz)); kit.add(M.steel, box(sinkW, bh, 0.004, xs, by, sz + s * sinkD / 2)); }
  kit.add(M.dark, cyl(0.025, 0.002, 20, xs, H - 0.03 - bh + 0.003, sz)); kit.add(M.chrome, tor(0.026, 0.004, 6, 20, TAU, xs, H - 0.03 - bh + 0.003, sz, HP));
  for (let i = -2; i <= 2; i++) kit.add(M.chrome, box(0.036, 0.002, 0.003, xs, H - 0.03 - bh + 0.004, sz + i * 0.008));
  // gooseneck tap with wrist-action levers
  const tz = sz - sinkD / 2 - 0.06;
  kit.add(M.chrome, cyl(0.025, 0.02, 20, xs, H + 0.01, tz), cyl(0.012, 0.28, 14, xs, H + 0.14, tz));
  kit.add(M.chrome, tor(0.09, 0.012, 10, 20, PI, xs, H + 0.28, tz + 0.09, 0, -HP, 0));
  kit.add(M.chrome, cyl(0.012, 0.06, 14, xs, H + 0.25, tz + 0.18), cyl(0.009, 0.015, 12, xs, H + 0.215, tz + 0.18));
  for (const s of [-1, 1]) {
    kit.add(M.chrome, cyl(0.018, 0.05, 14, xs + s * 0.1, H + 0.025, tz));
    kit.add(M.chrome, T(new THREE.CylinderGeometry(0.006, 0.008, 0.16, 10).rotateZ(HP).translate(s * 0.08, 0, 0), xs + s * 0.1, H + 0.055, tz, 0, s * 0.3, 0));
    kit.add(s < 0 ? led(0x2060ff, 0.6) : led(0xff2020, 0.6), cyl(0.008, 0.003, 12, xs + s * 0.1, H + 0.0515, tz));
  }
  // centre spine: service strip + reagent shelves
  const sw = 0.24;
  kit.add(M.white, rbox(L0 - 0.1, 0.2, sw - 0.06, 0.01, 0, H + 0.1, 0));
  for (const side of [1, -1]) {
    const fz = side * (sw / 2 - 0.03) + side * 0.001;
    for (let i = 0; i < n; i++) {
      const x = -L0 / 2 + 0.05 + mwid * (i + 0.5);
      // double socket
      kit.add(M.whiteGloss, rbox(0.14, 0.08, 0.012, 0.004, x - 0.07, H + 0.1, fz + side * 0.006));
      for (const s of [-1, 1]) { kit.add(M.dark, box(0.012, 0.022, 0.002, x - 0.07 + s * 0.035 - 0.006, H + 0.1, fz + side * 0.0125), box(0.012, 0.022, 0.002, x - 0.07 + s * 0.035 + 0.006, H + 0.1, fz + side * 0.0125)); kit.add(led(0xff3020, 2), box(0.004, 0.004, 0.002, x - 0.07 + s * 0.035, H + 0.125, fz + side * 0.0125)); }
      // gas / vac tap
      const col = [0xe0c020, 0x2a6fd0, 0x30a050][i % 3], name = ['VAC', 'N2', 'AIR'][i % 3];
      kit.add(M.chrome, cyl(0.014, 0.03, 14, x + 0.1, H + 0.1, fz + side * 0.015, HP));
      kit.add(M.chrome, T(new THREE.CylinderGeometry(0.006, 0.008, 0.05, 10).rotateX(HP), x + 0.1, H + 0.08, fz + side * 0.045, -0.5 * side, 0, 0));
      kit.add(plastic(col), box(0.05, 0.012, 0.01, x + 0.1, H + 0.115, fz + side * 0.035));
      at.label(kit, 0.04, 0.016, 2400, L.plain(name, null, { bg: '#' + col.toString(16).padStart(6, '0'), fg: '#111' }), x + 0.1, H + 0.155, fz + side * 0.001, 0, side < 0 ? PI : 0);
    }
  }
  const nu = Math.max(2, Math.round(L0 / 1.4) + 1);
  for (let i = 0; i < nu; i++) {
    const x = -L0 / 2 + 0.07 + (i * (L0 - 0.14)) / (nu - 1);
    for (const s of [-1, 1]) kit.add(M.steel, rbox(0.035, 0.85, 0.035, 0.004, x, H + 0.2 + 0.425, s * 0.13));
  }
  const shelfY = [H + 0.42, H + 0.82];
  for (const sy of shelfY) {
    kit.add(M.steel, rbox(L0 - 0.08, 0.018, 0.34, 0.004, 0, sy, 0));
    for (const s of [-1, 1]) { kit.add(M.steel, cyl(0.005, L0 - 0.1, 8, 0, sy + 0.05, s * 0.165, 0, 0, HP)); for (let x = -L0 / 2 + 0.1; x < L0 / 2; x += 0.6) kit.add(M.steel, cyl(0.004, 0.05, 6, x, sy + 0.025, s * 0.165)); }
    kit.add(M.white, box(L0 - 0.1, 0.02, 0.003, 0, sy - 0.0, 0.171));
  }
  kit.add(M.steel, rbox(L0 - 0.08, 0.025, 0.34, 0.006, 0, H + 1.06, 0));
  at.label(kit, 0.5, 0.06, 1400, L.brand('REAGENT STORE · C-2', PALETTE.teal, '#f6f7f5'), 0, H + 1.06, 0.172);
  // glassware on shelves
  const reagents = [['ETHANOL 70%', 'HB-RG-0112', false], ['SODIUM HYPOCHLORITE', 'HB-RG-0031', true], ['FORMALIN 10%', 'HB-RG-0207', true], ['PBS 1X', 'HB-RG-0044', false], ['GLUTARALDEHYDE', 'HB-RG-0118', true], ['SALINE 0.9%', 'HB-RG-0009', false], ['C-14 MEDIUM', 'HB-RG-1414', true]];
  for (const [si, sy] of shelfY.entries()) {
    let x = -L0 / 2 + 0.12;
    while (x < L0 / 2 - 0.12) {
      const kinds = ['bottle', 'amber', 'beaker', 'flask', 'cylinder', 'amber', 'bottle'], k = kinds[Math.floor(r() * kinds.length)];
      const sc = 0.8 + r() * 0.5, rg = reagents[Math.floor(r() * reagents.length)];
      for (const side of r() < 0.5 ? [1] : [1, -1]) {
        const zz = side * (0.07 + r() * 0.03);
        glassware(kit, at, k, x + (side < 0 ? 0.03 : 0), sy + 0.009, zz, { s: sc, fluid: FLUIDS[Math.floor(r() * FLUIDS.length)], fill: k === 'amber' ? 0.7 : 0.2 + r() * 0.6, label: side > 0 && (k === 'bottle' || k === 'amber') ? reagentLabel(rg[0], rg[1], rg[2]) : null });
      }
      x += 0.09 + sc * 0.07 + r() * 0.08;
    }
  }
  // bench-top clutter (front side)
  const bx = (t) => -L0 / 2 + t * L0;
  tubeRack(kit, bx(0.62), H, 0.42, 8, r);
  tubeRack(kit, bx(0.7), H, 0.3, 6, r);
  pipetteStand(kit, bx(0.82), H, 0.32);
  glassware(kit, at, 'beaker', bx(0.55), H, 0.55, { s: 1.4, fluid: 0x1fa0a0, fill: 0.45 });
  glassware(kit, at, 'flask', bx(0.9), H, 0.52, { s: 1, fluid: 0x9b1b1b, fill: 0.3 });
  glassware(kit, at, 'cylinder', bx(0.95), H, 0.3, { s: 1, fluid: 0xbfe6e6, fill: 0.6 });
  sharpsBox(kit, at, bx(0.08) + 0.1, H, 0.45, 1, 0.2);
  // glove box
  kit.add(M.white, rbox(0.25, 0.09, 0.13, 0.004, bx(0.15) + 0.2, H + 0.045, 0.62));
  at.label(kit, 0.24, 0.08, 2000, (ctx, pw, ph) => { ctx.fillStyle = '#f6f7f5'; ctx.fillRect(0, 0, pw, ph); ctx.fillStyle = '#3a63c8'; ctx.fillRect(0, ph * 0.7, pw, ph * 0.3); txt(ctx, 'NITRILE EXAM GLOVES', pw / 2, ph * 0.3, ph * 0.16, { w: 700, color: '#1b1f22' }); txt(ctx, 'SIZE M · 100 PCS', pw / 2, ph * 0.52, ph * 0.12, { color: '#333' }); txt(ctx, 'POWDER FREE', pw / 2, ph * 0.85, ph * 0.13, { color: '#fff' }); }, bx(0.15) + 0.2, H + 0.045, 0.6852);
  kit.add(M.dark, box(0.1, 0.002, 0.03, bx(0.15) + 0.2, H + 0.0905, 0.62));
  kit.add(M.cloth, box(0.06, 0.03, 0.02, bx(0.15) + 0.2, H + 0.1, 0.62, 0.3, 0.2, 0.2));
  // back-side clutter
  tubeRack(kit, bx(0.3), H, -0.42, 10, r);
  glassware(kit, at, 'beaker', bx(0.42), H, -0.5, { s: 1.2, fluid: 0x6aa83a, fill: 0.5 });
  glassware(kit, at, 'flask', bx(0.48), H, -0.4, { s: 1.3, fluid: 0xc98a1a, fill: 0.35 });
  kit.build(g);
  g.userData.collider = { w: L0, d: D };
  return g;
}

// ================================================================== LOCKERS
const STAFF = ['DR. A. MORROW', 'K. OYELARAN', 'DR. I. VESTERGAARD', 'T. NAKASHIMA', 'R. DUCHENE', 'DR. M. HALE', 'S. ABARA', 'J. KOWALCZYK', 'L. FERRANTE', 'DR. E. LINDQVIST', 'P. ORUME', 'VACANT'];
export function lockerBank({ count = 4, ajar = false, seed } = {}) {
  seed = seedOf(seed); const r = rng(seed);
  const g = new THREE.Group(); g.name = 'lockerBank';
  const kit = new Kit(), at = new Atlas(`lockers_${count}_${seed % 3}`, 2048, 1024);
  const lw = 0.4, D = 0.5, H = 1.85, base = 0.1, W = count * lw;
  const ajarIdx = ajar === true ? Math.min(1, count - 1) : typeof ajar === 'number' ? ajar : -1;
  kit.add(M.rubber, box(W - 0.02, base, D - 0.04, 0, base / 2, -0.01));
  // carcass, dividers, sloped hood
  kit.add(M.white, box(W, H, 0.01, 0, base + H / 2, -D / 2 + 0.005));
  for (let i = 0; i <= count; i++) kit.add(M.white, box(0.012, H, D - 0.02, -W / 2 + i * lw, base + H / 2, 0));
  kit.add(M.white, box(W, 0.012, D - 0.02, 0, base + H, 0), box(W, 0.012, D - 0.02, 0, base + 0.006, 0));
  const hood = new THREE.Shape(); hood.moveTo(-D / 2 + 0.01, 0); hood.lineTo(D / 2, 0); hood.lineTo(D / 2, 0.2); hood.closePath();
  kit.add(M.white, T(extrude(hood, W, 0.003), -W / 2, base + H + 0.05, 0, 0, HP, 0));
  kit.add(M.white, box(W, 0.05, 0.012, 0, base + H + 0.025, D / 2 - 0.006), box(W, 0.05, D - 0.02, 0, base + H + 0.025, 0));
  const names = STAFF.slice().sort(() => r() - 0.5);
  for (let i = 0; i < count; i++) {
    const x = -W / 2 + lw * (i + 0.5), dw = lw - 0.016, dh = H - 0.03, dz = D / 2 - 0.01;
    const isAjar = i === ajarIdx;
    let dk = kit;
    if (isAjar) {
      // interior visible: shelf, hook rail, hanging lab coat
      kit.add(M.grey, box(lw - 0.02, 0.01, D - 0.04, x, base + 1.5, 0));
      kit.add(M.steel, cyl(0.008, lw - 0.03, 8, x, base + 1.42, 0, 0, 0, HP));
      kit.add(M.sheet, T(lumpy(new THREE.CylinderGeometry(0.1, 0.15, 0.95, 14, 6), 0.01, 18, seed), x, base + 0.92, 0.0));
      kit.add(M.sheet, S(sph(0.12, 12, 8, 0, 0, 0), 1, 0.4, 0.6).translate(x, base + 1.38, 0));
      kit.add(M.teal, box(0.1, 0.18, 0.12, x, base + 1.6, -0.05));
      kit.add(M.dark, box(lw - 0.03, H - 0.05, 0.004, x, base + H / 2, -D / 2 + 0.012));
      dk = new Kit(); dk.push(dw / 2, 0, 0); // frame relative to the hinge
    } else dk.push(x, 0, dz);
    // door leaf with pressed louvres
    dk.add(M.grey, rbox(dw, dh, 0.018, 0.004, 0, base + 0.015 + dh / 2, 0));
    for (const y0 of [base + 0.1, base + dh - 0.22]) for (let j = 0; j < 6; j++) {
      const y = y0 + j * 0.022;
      dk.add(M.dark, box(dw * 0.62, 0.008, 0.002, 0, y, 0.0085));
      dk.add(M.grey, box(dw * 0.64, 0.004, 0.012, 0, y + 0.006, 0.012, -0.6, 0, 0));
    }
    // handle: recessed lever latch + padlock hasp
    dk.add(M.chrome, rbox(0.034, 0.16, 0.006, 0.006, dw / 2 - 0.04, base + 1.0, 0.012));
    dk.add(M.chrome, rbox(0.016, 0.11, 0.014, 0.005, dw / 2 - 0.04, base + 0.99, 0.02));
    dk.add(M.dark, cyl(0.006, 0.004, 12, dw / 2 - 0.04, base + 1.065, 0.017, HP));
    if (r() < 0.6) { dk.add(M.brass, rbox(0.03, 0.03, 0.014, 0.004, dw / 2 - 0.04, base + 0.88, 0.03)); dk.add(M.chrome, tor(0.009, 0.0025, 6, 12, PI, dw / 2 - 0.04, base + 0.895, 0.03)); }
    // number plate + name card holder
    dk.add(M.steel, rbox(0.12, 0.05, 0.003, 0.003, 0, base + dh - 0.31, 0.011));
    at.label(dk, 0.112, 0.042, 2400, (ctx, pw, ph) => { ctx.fillStyle = '#f6f7f5'; ctx.fillRect(0, 0, pw, ph); txt(ctx, names[i % names.length], pw / 2, ph * 0.42, ph * 0.34, { w: 700, maxW: pw * 0.92 }); txt(ctx, 'WING C · CLEARANCE ' + (2 + (i % 3)), pw / 2, ph * 0.8, ph * 0.18, { color: '#555' }); }, 0, base + dh - 0.31, 0.0128);
    dk.add(M.glass, box(0.114, 0.044, 0.002, 0, base + dh - 0.31, 0.0135));
    dk.add(M.teal, rbox(0.07, 0.04, 0.003, 0.004, 0, base + dh - 0.05, 0.011));
    at.label(dk, 0.065, 0.034, 2400, L.text(`C-${String(i + 1 + (seed % 4) * count).padStart(2, '0')}`, { color: '#ffffff', size: 0.75 }), 0, base + dh - 0.05, 0.0128);
    if (i === count - 1) at.label(dk, 0.1, 0.1, 2400, L.bioBadge(), 0, base + 1.3, 0.0095);
    // hinges
    for (const y of [base + 0.25, base + dh - 0.25]) dk.add(M.steelDark, cyl(0.006, 0.06, 10, -dw / 2 - 0.002, y, 0.005));
    if (isAjar) { dk.pop(); const pivot = new THREE.Group(); pivot.name = 'lockerDoor'; pivot.position.set(x - dw / 2, 0, dz); pivot.rotation.y = -0.75; dk.build(pivot); g.add(pivot); g.userData.ajarDoor = pivot; }
    else dk.pop();
  }
  // bench in front? no — keep the walkway clear. Label on the hood edge.
  at.label(kit, Math.min(0.6, W * 0.6), 0.04, 1600, L.brand('STAFF LOCKERS · WING C', '#5e676c'), 0, base + H + 0.025, D / 2 + 0.0005);
  kit.build(g);
  g.userData.collider = { w: W, d: D };
  return g;
}

// ================================================================== SPECIMEN SHELF
function specimenThing(r, s) {
  const k = r();
  if (k < 0.45) { // deformed, nodular mass
    const g = lumpy(new THREE.IcosahedronGeometry(s, 3), s * 0.22, 9 / s * 0.05 + 6, Math.floor(r() * 1e6));
    g.scale(1, 0.8 + r() * 0.6, 0.9);
    return g;
  }
  if (k < 0.8) { // coiled tube (gut-like)
    const pts = [], n = 7 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) { const a = i * 1.7 + r(); pts.push([Math.cos(a) * s * 0.55, -s * 0.8 + (i / n) * s * 1.6, Math.sin(a) * s * 0.5]); }
    return lumpy(tube(pts, s * (0.12 + r() * 0.08), 48, 8), s * 0.03, 30, Math.floor(r() * 1e6));
  }
  // cluster of eyes / spheres on a stalk
  const parts = [lumpy(new THREE.CylinderGeometry(s * 0.12, s * 0.2, s * 1.4, 8, 6), s * 0.04, 20, 4)];
  for (let i = 0; i < 4; i++) parts.push(sph(s * (0.18 + r() * 0.12), 12, 8, (r() - 0.5) * s * 0.7, s * (0.2 + r() * 0.5), (r() - 0.5) * s * 0.6));
  return mergeAll(parts);
}
export function specimenShelf({ seed } = {}) {
  seed = seedOf(seed) % 3; const r = rng(seed); // 3 layout variants share label atlases
  const g = new THREE.Group(); g.name = 'specimenShelf';
  const kit = new Kit(), at = new Atlas(`specimen_${seed % 3}`, 2048, 1024);
  const W = 1.2, D = 0.45, H = 1.9;
  for (const x of [-W / 2 + 0.02, W / 2 - 0.02]) for (const z of [-D / 2 + 0.02, D / 2 - 0.02]) {
    kit.add(M.steel, rbox(0.035, H, 0.035, 0.004, x, H / 2, z));
    kit.add(M.rubber, cyl(0.022, 0.01, 12, x, 0.005, z));
    for (let y = 0.1; y < H; y += 0.05) kit.add(M.dark, box(0.012, 0.02, 0.002, x, y, z + Math.sign(z) * 0.0181));
  }
  const shelves = [0.12, 0.55, 0.98, 1.41, 1.84];
  for (const sy of shelves) {
    kit.add(M.steel, box(W - 0.02, 0.012, D - 0.02, 0, sy, 0));
    for (const s of [-1, 1]) kit.add(M.steel, box(W - 0.02, 0.035, 0.012, 0, sy - 0.012, s * (D / 2 - 0.016)));
    at.label(kit, 0.16, 0.025, 2400, L.plain(`SHELF ${shelves.indexOf(sy) + 1}`, 'C-14 ARCHIVE · 4°C', { bar: PALETTE.teal }), -W / 2 + 0.15, sy - 0.012, D / 2 - 0.0095);
  }
  // cross braces at the back
  kit.add(M.steel, cyl(0.005, Math.hypot(W, H) - 0.1, 6, 0, H / 2, -D / 2 + 0.02, 0, 0, Math.atan2(W, H)), cyl(0.005, Math.hypot(W, H) - 0.1, 6, 0, H / 2, -D / 2 + 0.02, 0, 0, -Math.atan2(W, H)));
  let tag = 1 + Math.floor(r() * 20);
  for (let si = 0; si < 4; si++) {
    const sy = shelves[si] + 0.006, maxH = shelves[si + 1] - shelves[si] - 0.07;
    let x = -W / 2 + 0.1;
    while (x < W / 2 - 0.1) {
      const rad = 0.055 + r() * 0.05, h = Math.min(maxH, rad * 2.6 + r() * 0.12);
      if (x + rad > W / 2 - 0.04) break;
      const z = (r() - 0.5) * 0.08;
      // jar
      kit.add(M.glass, lathe([[0.001, 0.0015], [rad - 0.006, 0], [rad, 0.008], [rad, h - 0.03], [rad * 0.9, h - 0.012], [rad * 0.9, h]], 18, x, sy, z));
      kit.add(M.murk, lathe([[0.001, 0.004], [rad - 0.007, 0.003], [rad - 0.003, 0.01], [rad - 0.003, h * (0.72 + r() * 0.15)], [0.001, h * 0.8]], 14, x, sy, z));
      kit.add(r() < 0.5 ? M.steel : M.black, cyl(rad * 0.93, 0.025, 18, x, sy + h + 0.01, z));
      kit.add(M.dark, cyl(rad * 0.9, 0.003, 18, x, sy + h - 0.002, z));
      // specimen
      const spec = specimenThing(r, rad * 0.68);
      spec.translate(x, sy + h * 0.42, z);
      kit.add(r() < 0.7 ? M.flesh : M.fleshDark, spec);
      // sediment
      kit.add(fluid(0x6a6a2a, 0.8), cyl(rad - 0.008, 0.008, 14, x, sy + 0.006, z));
      const id = String(tag++).padStart(3, '0');
      at.label(kit, Math.min(0.09, rad * 1.3), 0.06, 2600, (ctx, pw, ph) => {
        ctx.fillStyle = '#f2f0e6'; ctx.fillRect(0, 0, pw, ph);
        ctx.fillStyle = PALETTE.bio; ctx.fillRect(0, 0, pw, ph * 0.18);
        txt(ctx, 'BIOHAZARD · DO NOT OPEN', pw / 2, ph * 0.09, ph * 0.1, { color: '#fff', w: 700, maxW: pw * 0.92 });
        txt(ctx, `C-14 / TISSUE ${id}`, pw / 2, ph * 0.38, ph * 0.16, { w: 700, maxW: pw * 0.92 });
        txt(ctx, `FIXED 20${10 + (+id % 15)}-0${1 + (+id % 9)}-1${+id % 10}  FORMALIN`, pw / 2, ph * 0.58, ph * 0.09, { color: '#444', maxW: pw * 0.92 });
        barcode(ctx, pw * 0.1, ph * 0.7, pw * 0.8, ph * 0.22, +id);
      }, x, sy + h * 0.25, z + rad + 0.002);
      x += rad * 2 + 0.03 + r() * 0.04;
    }
  }
  at.label(kit, 0.3, 0.2, 1600, L.bio('BIOHAZARD', 'CATEGORY A SPECIMENS · AUTHORISED ACCESS'), W / 2 - 0.2, H - 0.12, D / 2 - 0.008);
  kit.build(g);
  g.userData.collider = { w: W, d: D };
  return g;
}

// ================================================================== SURGICAL / AUTOPSY TABLE
export function surgicalTable({ seed } = {}) {
  const g = new THREE.Group(); g.name = 'surgicalTable';
  const kit = new Kit(), at = new Atlas('surgTable', 1024, 1024);
  const L0 = 1.95, W = 0.66, H = 0.88;
  // pedestal: base plinth + column
  kit.add(M.steel, rbox(0.9, 0.06, 0.5, 0.015, 0, 0.03, 0));
  kit.add(M.rubber, box(0.92, 0.01, 0.52, 0, 0.005, 0));
  kit.add(M.steel, rbox(0.34, 0.68, 0.26, 0.04, 0, 0.06 + 0.34, 0));
  kit.add(M.steelDark, box(0.3, 0.004, 0.002, 0, 0.5, 0.131), box(0.3, 0.004, 0.002, 0, 0.3, 0.131));
  kit.add(M.steel, rbox(0.8, 0.06, 0.4, 0.015, 0, H - 0.1, 0));
  kit.add(M.rubber, rbox(0.14, 0.03, 0.08, 0.01, 0.3, 0.07, 0.28)); // foot pedal
  at.label(kit, 0.2, 0.06, 2000, L.brand('AUTOPSY UNIT 2', '#5e676c'), 0, 0.55, 0.1305);
  // tray top: perforated work surface with raised rim, sloping to a drain at the foot (+X)
  const tt = H - 0.05;
  kit.add(M.steel, box(L0 - 0.08, 0.012, W - 0.08, 0, tt + 0.006, 0));
  for (const s of [-1, 1]) {
    kit.add(M.steel, rbox(L0, 0.06, 0.03, 0.01, 0, tt + 0.025, s * (W / 2 - 0.015)));
    kit.add(M.steel, rbox(0.03, 0.06, W, 0.01, s * (L0 / 2 - 0.015), tt + 0.025, 0));
  }
  for (let i = -6; i <= 6; i++) kit.add(M.dark, box(L0 - 0.3, 0.002, 0.006, -0.05, tt + 0.0125, i * 0.04));
  kit.add(M.dark, cyl(0.03, 0.002, 20, L0 / 2 - 0.1, tt + 0.0125, 0)); kit.add(M.chrome, tor(0.032, 0.004, 6, 20, TAU, L0 / 2 - 0.1, tt + 0.013, 0, HP));
  kit.add(M.steel, cyl(0.02, 0.4, 12, L0 / 2 - 0.1, tt - 0.2, 0)); kit.add(M.steel, tor(0.1, 0.02, 8, 12, HP, L0 / 2 - 0.2, tt - 0.4, 0, 0, 0, PI));
  // head block
  kit.add(M.rubber, rbox(0.12, 0.08, 0.2, 0.03, -L0 / 2 + 0.12, tt + 0.05, 0));
  // spray hose on a hook at the head end
  kit.add(M.steel, cyl(0.008, 0.25, 10, -L0 / 2 - 0.03, tt + 0.1, -W / 2 + 0.05));
  kit.add(M.cableBlack, tube([[-L0 / 2 - 0.03, tt + 0.22, -W / 2 + 0.05], [-L0 / 2 - 0.05, tt + 0.1, -W / 2 + 0.12], [-L0 / 2 - 0.06, tt - 0.25, -W / 2 + 0.15], [-L0 / 2 + 0.1, tt - 0.4, -0.08], [-0.2, tt - 0.3, 0]], 0.009, 30, 8));
  kit.add(M.chrome, cyl(0.014, 0.1, 12, -L0 / 2 - 0.03, tt + 0.26, -W / 2 + 0.05), cone(0.006, 0.014, 0.03, 12, -L0 / 2 - 0.03, tt + 0.325, -W / 2 + 0.05));
  // restraint straps across the top (nylon + steel buckles)
  for (const x of [-0.6, -0.05, 0.6]) {
    kit.add(M.black, box(0.06, 0.004, W + 0.02, x, tt + 0.058, 0));
    for (const s of [-1, 1]) kit.add(M.black, box(0.06, 0.12, 0.004, x, tt - 0.0, s * (W / 2 + 0.01)));
    kit.add(M.chrome, rbox(0.075, 0.008, 0.05, 0.003, x, tt + 0.062, 0.12), rbox(0.05, 0.008, 0.008, 0.002, x, tt + 0.066, 0.12));
    kit.add(M.black, box(0.06, 0.003, 0.18, x, tt + 0.062, 0.24));
  }
  // wrist cuffs (padded) hanging off the sides
  for (const s of [-1, 1]) {
    kit.add(M.black, tube([[-0.3, tt + 0.06, s * (W / 2)], [-0.3, tt - 0.05, s * (W / 2 + 0.03)], [-0.3, tt - 0.15, s * (W / 2 + 0.02)]], 0.022, 10, 8));
    kit.add(M.chrome, tor(0.02, 0.004, 6, 12, TAU, -0.3, tt - 0.17, s * (W / 2 + 0.02), 0, HP, 0));
  }
  kit.build(g);
  g.userData.collider = { w: L0 + 0.1, d: W };
  return g;
}

// Ceiling-mounted double surgical light. Origin at the ceiling attach point; everything hangs down (-Y).
export function surgicalLight({ length = 0.8 } = {}) {
  const g = new THREE.Group(); g.name = 'surgicalLight';
  const kit = new Kit(), at = new Atlas('surgLight', 512, 512);
  kit.add(M.whiteGloss, cyl(0.16, 0.05, 32, 0, -0.025, 0), cyl(0.06, 0.06, 24, 0, -0.08, 0));
  kit.add(M.whiteGloss, cyl(0.04, length, 20, 0, -length / 2 - 0.1, 0));
  const hubY = -length - 0.1;
  kit.add(M.whiteGloss, cyl(0.065, 0.12, 24, 0, hubY, 0));
  kit.add(M.grey, cyl(0.066, 0.008, 24, 0, hubY + 0.04, 0), cyl(0.066, 0.008, 24, 0, hubY - 0.03, 0));
  const ledMat = lamp(0xfff6e8, 0.15, 0xdfe6e8);
  const heads = [];
  [[0.7, 0.35], [-2.1, -0.25]].forEach(([yaw, dy], i) => {
    const ay = hubY + (i ? -0.04 : 0.03), L1 = 0.75;
    kit.push(0, ay, 0, 0, yaw, 0);
    kit.add(M.whiteGloss, rbox(L1, 0.05, 0.07, 0.02, L1 / 2, 0, 0));
    kit.add(M.whiteGloss, cyl(0.045, 0.09, 20, L1, -0.02, 0));
    // spring arm angled down
    kit.push(L1, -0.04, 0, 0, 0, -0.55 + dy * 0.3);
    kit.add(M.whiteGloss, rbox(0.55, 0.045, 0.06, 0.02, 0.275, 0, 0));
    kit.add(M.grey, box(0.4, 0.004, 0.062, 0.28, 0.0, 0));
    kit.add(M.whiteGloss, cyl(0.035, 0.07, 18, 0.55, 0, 0, HP));
    kit.push(0.55, 0, 0, 0, 0, 0.55 - dy * 0.3);
    // yoke + lamp head
    kit.add(M.whiteGloss, cyl(0.022, 0.18, 14, 0, -0.09, 0));
    kit.add(M.whiteGloss, tor(0.36, 0.018, 8, 24, PI, 0, -0.2, 0, 0, 0, PI));
    const hy = -0.2;
    kit.push(0, hy, 0, 0.25, 0, 0);
    kit.add(M.whiteGloss, lathe([[0.02, 0.0], [0.2, 0.01], [0.3, -0.03], [0.34, -0.08], [0.335, -0.1]], 40, 0, 0, 0));
    kit.add(M.grey, tor(0.335, 0.012, 8, 40, TAU, 0, -0.1, 0, HP));
    kit.add(M.darkGrey, cyl(0.33, 0.01, 40, 0, -0.095, 0));
    // LED cells: inner ring + outer ring
    const cells = [];
    for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; cells.push([Math.cos(a) * 0.12, Math.sin(a) * 0.12]); }
    for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU + 0.26; cells.push([Math.cos(a) * 0.24, Math.sin(a) * 0.24]); }
    const cellGeos = [];
    for (const [cx, cz] of cells) { kit.add(M.chrome, cone(0.035, 0.045, 0.01, 18, cx, -0.1, cz)); cellGeos.push(T(new THREE.CylinderGeometry(0.032, 0.032, 0.004, 18), cx, -0.106, cz)); }
    const lm = new THREE.Mesh(mergeAll(cellGeos), ledMat); kit.place(lm); g.add(lm); heads.push(lm);
    // sterile handle
    kit.add(M.grey, cyl(0.03, 0.13, 18, 0, -0.16, 0), cyl(0.035, 0.012, 18, 0, -0.225, 0));
    for (let k = 0; k < 6; k++) kit.add(M.darkGrey, tor(0.0305, 0.003, 4, 18, TAU, 0, -0.11 - k * 0.018, 0, HP));
    at.label(kit, 0.14, 0.035, 2000, L.brand(null, '#7d878c'), 0, -0.04, 0.3, -0.6);
    kit.pop(); kit.pop(); kit.pop(); kit.pop();
  });
  kit.build(g);
  g.userData.heads = heads;
  g.userData.setOn = (on) => { ledMat.emissiveIntensity = on ? 3.5 : 0.15; };
  g.userData.collider = null;
  return g;
}

// ================================================================== INSTRUMENT TROLLEY
function scalpel(kit, x, y, z, ry) {
  kit.push(x, y, z, 0, ry, 0);
  kit.add(M.steel, rbox(0.12, 0.004, 0.012, 0.0015, 0, 0.002, 0));
  for (let i = 0; i < 6; i++) kit.add(M.steelDark, box(0.004, 0.001, 0.009, -0.04 + i * 0.008, 0.0045, 0));
  const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0.04, 0.002); sh.quadraticCurveTo(0.05, 0.006, 0.036, 0.01); sh.lineTo(0, 0.008); sh.closePath();
  kit.add(M.chrome, T(extrude(sh, 0.0006), 0.06, 0.0045, 0.004, HP, 0, 0));
  kit.pop();
}
function forceps(kit, x, y, z, ry) {
  kit.push(x, y, z, 0, ry, 0);
  for (const s of [-1, 1]) kit.add(M.chrome, box(0.13, 0.003, 0.006, 0, 0.003 + (s > 0 ? 0.004 : 0), s * 0.006, 0, s * 0.045, 0));
  kit.pop();
}
function hemostat(kit, x, y, z, ry) {
  kit.push(x, y, z, 0, ry, 0);
  for (const s of [-1, 1]) {
    kit.add(M.chrome, tor(0.011, 0.0022, 6, 16, TAU, -0.065, 0.003, s * 0.014, HP));
    kit.add(M.chrome, box(0.08, 0.003, 0.004, -0.02, 0.003 + (s > 0 ? 0.003 : 0), s * 0.006, 0, s * 0.12, 0));
    kit.add(M.chrome, box(0.045, 0.003, 0.0035, 0.04, 0.003 + (s > 0 ? 0.003 : 0), 0, 0, s * 0.03, 0));
  }
  kit.add(M.chrome, cyl(0.003, 0.009, 8, 0.018, 0.005, 0));
  kit.pop();
}
export function instrumentTray({ seed } = {}) {
  seed = seedOf(seed); const r = rng(seed);
  const g = new THREE.Group(); g.name = 'instrumentTray';
  const kit = new Kit(), at = new Atlas('instrTray', 512, 512);
  const W = 0.62, D = 0.44, H = 0.92;
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    kit.add(M.steel, cyl(0.012, H - 0.12, 12, a * (W / 2 - 0.03), 0.1 + (H - 0.12) / 2, b * (D / 2 - 0.03)));
    caster(kit, a * (W / 2 - 0.03), b * (D / 2 - 0.03), 0.035, a < 0 && b > 0);
  }
  // trays: top (with rim) and lower shelf
  for (const [y, rim] of [[H - 0.02, 0.025], [0.3, 0.02]]) {
    kit.add(M.steel, rbox(W, 0.006, D, 0.003, 0, y, 0));
    for (const s of [-1, 1]) { kit.add(M.steel, rbox(W, rim, 0.006, 0.002, 0, y + rim / 2, s * (D / 2 - 0.003))); kit.add(M.steel, rbox(0.006, rim, D, 0.002, s * (W / 2 - 0.003), y + rim / 2, 0)); }
  }
  kit.add(M.steel, cyl(0.01, W + 0.06, 12, 0, H + 0.04, -D / 2 - 0.03, 0, 0, HP));
  for (const s of [-1, 1]) kit.add(M.steel, cyl(0.008, 0.07, 10, s * (W / 2 - 0.03), H + 0.01, -D / 2 - 0.01, -0.5, 0, 0));
  // drape (slightly rumpled)
  const drape = new THREE.PlaneGeometry(W - 0.04, D - 0.04, 16, 12).rotateX(-HP);
  const p = drape.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, 0.003 + Math.max(0, Math.sin(p.getX(i) * 31 + 1) * Math.sin(p.getZ(i) * 23) * 0.004));
  drape.computeVertexNormals();
  kit.add(M.cloth, T(drape, 0, H - 0.014, 0));
  const ty = H - 0.01;
  scalpel(kit, -0.18, ty, -0.12, 0.05); scalpel(kit, -0.18, ty, -0.08, -0.04);
  forceps(kit, -0.02, ty, -0.12, 0.1); forceps(kit, -0.02, ty, -0.08, -0.05);
  hemostat(kit, 0.17, ty, -0.12, 0.0); hemostat(kit, 0.17, ty, -0.04, 0.08); hemostat(kit, -0.12, ty, 0.04, -0.1);
  // kidney dish, gauze, syringe
  kit.add(M.steel, S(lathe([[0.001, 0], [0.08, 0.005], [0.1, 0.035], [0.104, 0.036]], 24, 0, 0, 0), 1, 1, 0.55).translate(0.12, ty, 0.1));
  for (let i = 0; i < 3; i++) kit.add(M.sheet, box(0.07, 0.008, 0.07, -0.05 + r() * 0.02, ty + 0.004 + i * 0.008, 0.12 + r() * 0.01, 0, r() * 0.4, 0));
  kit.add(M.glass, cyl(0.007, 0.08, 10, -0.2, ty + 0.008, 0.13, 0, 0.4, HP));
  kit.add(fluid(0x9b1b1b, 0.75), cyl(0.006, 0.03, 8, -0.2 - 0.01, ty + 0.008, 0.13 - 0.005, 0, 0.4, HP));
  kit.add(M.white, cyl(0.009, 0.004, 10, -0.2 - 0.042 * Math.cos(0.4), ty + 0.008, 0.13 + 0.042 * Math.sin(0.4), 0, 0.4, HP));
  kit.add(M.steel, cyl(0.0008, 0.03, 4, -0.2 + 0.053 * Math.cos(0.4), ty + 0.008, 0.13 - 0.053 * Math.sin(0.4), 0, 0.4, HP));
  // lower shelf: glove box + sharps bin
  kit.add(M.white, rbox(0.25, 0.09, 0.13, 0.004, -0.12, 0.35, 0));
  sharpsBox(kit, at, 0.16, 0.303, 0.0, 0.8, 0);
  kit.build(g);
  g.userData.collider = { w: W + 0.06, d: D + 0.06 };
  return g;
}

// ================================================================== SEATING & CARTS
export function gurney({ seed } = {}) {
  seed = seedOf(seed); const r = rng(seed);
  const g = new THREE.Group(); g.name = 'gurney';
  const kit = new Kit(), at = new Atlas('gurney', 512, 512);
  const L0 = 2.0, W = 0.68, H = 0.62;
  // chassis
  kit.add(M.steel, rbox(L0 - 0.2, 0.06, 0.3, 0.02, 0, 0.2, 0));
  kit.add(M.grey, rbox(L0 - 0.1, 0.03, W - 0.1, 0.01, 0, 0.26, 0));
  for (const x of [-0.45, 0.45]) { kit.add(M.steel, rbox(0.14, H - 0.3, 0.1, 0.02, x, 0.25 + (H - 0.3) / 2, 0)); kit.add(M.rubber, box(0.142, 0.06, 0.102, x, 0.35, 0)); }
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { kit.add(M.steel, box(0.04, 0.04, 0.06, a * (L0 / 2 - 0.14), 0.19, b * 0.12)); caster(kit, a * (L0 / 2 - 0.14), b * 0.2, 0.07, a < 0); }
  // deck + mattress + sheet + pillow
  kit.add(M.steel, rbox(L0, 0.04, W, 0.01, 0, H, 0));
  kit.add(M.vinyl, rbox(L0 - 0.06, 0.08, W - 0.06, 0.035, 0, H + 0.06, 0));
  const sheet = new THREE.PlaneGeometry(1.45, W - 0.0, 24, 12).rotateX(-HP);
  const sp = sheet.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i), z = sp.getZ(i), edge = Math.max(0, Math.abs(z) - (W / 2 - 0.035));
    sp.setY(i, 0.007 + Math.abs(Math.sin(x * 17 + z * 5)) * 0.004 + Math.abs(Math.sin(x * 41)) * 0.002 - edge * 2.2);
    sp.setZ(i, Math.sign(z) * Math.min(Math.abs(z), W / 2 - 0.022 + edge * 0.15));
  }
  sheet.computeVertexNormals();
  kit.add(M.sheet, T(sheet, 0.25, H + 0.1, 0));
  kit.add(M.sheet, T(lumpy(new THREE.SphereGeometry(0.2, 18, 10).scale(0.8, 0.28, 1.4), 0.008, 30, seed), -L0 / 2 + 0.25, H + 0.13, 0));
  // side rails (lowered) + push handle + IV pole
  for (const s of [-1, 1]) {
    kit.add(M.steel, cyl(0.012, 1.2, 10, 0, H - 0.02, s * (W / 2 + 0.03), 0, 0, HP));
    for (const x of [-0.5, 0, 0.5]) kit.add(M.steel, cyl(0.01, 0.06, 8, x, H - 0.0, s * (W / 2 + 0.015), HP));
  }
  kit.add(M.steel, tube([[-L0 / 2, H, -W / 2 + 0.05], [-L0 / 2 - 0.08, H + 0.15, -W / 2 + 0.05], [-L0 / 2 - 0.08, H + 0.15, W / 2 - 0.05], [-L0 / 2, H, W / 2 - 0.05]], 0.014, 24, 10));
  kit.add(M.steel, cyl(0.011, 1.3, 10, -L0 / 2 + 0.05, H + 0.6, W / 2 - 0.04));
  for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU; kit.add(M.steel, tor(0.03, 0.004, 6, 10, PI, -L0 / 2 + 0.05 + Math.cos(a) * 0.03, H + 1.22, W / 2 - 0.04 + Math.sin(a) * 0.03, 0, -a, 0)); }
  // IV bag
  kit.add(fluid(0xe8f0f0, 0.5), rbox(0.1, 0.16, 0.03, 0.012, -L0 / 2 + 0.05 + 0.03, H + 1.08, W / 2 - 0.04));
  kit.add(M.cableGrey, tube([[-L0 / 2 + 0.08, H + 1.0, W / 2 - 0.04], [-L0 / 2 + 0.1, H + 0.6, W / 2 - 0.02], [-L0 / 2 + 0.3, H + 0.2, W / 2 - 0.05], [-L0 / 2 + 0.5, H + 0.12, W / 2 - 0.15]], 0.0018, 16, 4));
  // restraint straps
  for (const x of [-0.35, 0.55]) { kit.add(M.black, box(0.05, 0.004, W - 0.04, x, H + 0.106, 0)); kit.add(M.chrome, rbox(0.06, 0.008, 0.045, 0.002, x, H + 0.11, 0.1)); }
  at.label(kit, 0.16, 0.05, 2000, L.tag('HB-GN-0' + (10 + (seed % 80)), seed), L0 / 2 - 0.2, 0.2, 0.1505);
  kit.build(g);
  g.userData.collider = { w: L0 + 0.1, d: W + 0.06 };
  return g;
}

function starBase(kit, r0 = 0.32, y = 0.07, casterR = 0.025, mat = M.black) {
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.3;
    kit.add(mat, T(new THREE.BoxGeometry(r0, 0.035, 0.045).translate(r0 / 2, 0, 0), 0, y, 0, 0, a, 0.08));
    const cx = Math.cos(a) * r0, cz = -Math.sin(a) * r0;
    kit.add(M.black, cyl(casterR * 1.05, 0.03, 12, cx, casterR, cz, 0, -a, HP));
    kit.add(M.black, box(0.025, 0.03, 0.03, cx, casterR * 2 + 0.01, cz));
  }
  kit.add(mat, cyl(0.04, 0.05, 16, 0, y, 0));
}
export function officeChair({ seed } = {}) {
  seed = seedOf(seed);
  const g = new THREE.Group(); g.name = 'officeChair';
  const kit = new Kit();
  starBase(kit, 0.31, 0.075, 0.025);
  kit.add(M.black, cyl(0.03, 0.18, 14, 0, 0.18, 0)); kit.add(M.chrome, cyl(0.016, 0.12, 12, 0, 0.32, 0));
  kit.add(M.black, rbox(0.24, 0.04, 0.24, 0.01, 0, 0.4, 0)); kit.add(M.black, box(0.012, 0.012, 0.12, 0.13, 0.38, 0.06, 0, 0, -0.3));
  kit.add(M.fabricDark, rbox(0.5, 0.08, 0.48, 0.035, 0, 0.47, 0.02));
  kit.add(M.black, rbox(0.46, 0.03, 0.44, 0.01, 0, 0.42, 0.02));
  // backrest: frame + mesh + lumbar
  kit.push(0, 0.55, -0.24, -0.12, 0, 0);
  kit.add(M.black, rbox(0.06, 0.12, 0.03, 0.01, 0, -0.04, 0.02));
  const frame = new THREE.Shape(); frame.copy(shapeRR(0.46, 0.56, 0.1, 0, 0.34)); frame.holes.push(new THREE.Path(shapeRR(0.4, 0.5, 0.08, 0, 0.34).getPoints(6).reverse()));
  kit.add(M.black, T(extrude(frame, 0.02, 0.006), 0, 0, -0.01));
  kit.add(M.mesh, plane(0.41, 0.51, 0, 0.34, 0));
  kit.add(M.darkGrey, rbox(0.36, 0.06, 0.02, 0.01, 0, 0.2, 0.012));
  kit.pop();
  for (const s of [-1, 1]) {
    kit.add(M.black, rbox(0.03, 0.22, 0.05, 0.01, s * 0.25, 0.53, -0.02));
    kit.add(M.black, rbox(0.07, 0.03, 0.24, 0.012, s * 0.25, 0.65, 0.02));
  }
  kit.build(g);
  g.rotation.y = 0;
  g.userData.collider = { w: 0.64, d: 0.64 };
  return g;
}
export function stool() {
  const g = new THREE.Group(); g.name = 'stool';
  const kit = new Kit();
  starBase(kit, 0.27, 0.07, 0.024, M.steel);
  kit.add(M.black, cyl(0.03, 0.22, 14, 0, 0.2, 0)); kit.add(M.chrome, cyl(0.016, 0.22, 12, 0, 0.42, 0));
  kit.add(M.steel, tor(0.2, 0.011, 8, 32, TAU, 0, 0.34, 0, HP));
  for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU; kit.add(M.steel, cyl(0.007, 0.18, 8, Math.cos(a) * 0.11, 0.34, Math.sin(a) * 0.11, 0, -a, HP)); }
  kit.add(M.black, cyl(0.12, 0.03, 20, 0, 0.53, 0));
  kit.add(M.vinyl, lathe([[0.001, 0], [0.17, 0], [0.18, 0.015], [0.18, 0.05], [0.165, 0.07], [0.001, 0.075]], 32, 0, 0.545, 0));
  kit.add(M.black, box(0.012, 0.012, 0.1, 0.12, 0.5, 0, 0, 0, -0.3));
  kit.build(g);
  g.userData.collider = { w: 0.55, d: 0.55 };
  return g;
}
export function cart({ seed } = {}) {
  seed = seedOf(seed); const r = rng(seed);
  const g = new THREE.Group(); g.name = 'cart';
  const kit = new Kit(), at = new Atlas('cart_' + (seed % 3), 1024, 1024);
  const W = 0.82, D = 0.5, H = 0.95;
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { kit.add(M.steel, cyl(0.013, H - 0.1, 12, a * (W / 2 - 0.02), 0.1 + (H - 0.1) / 2, b * (D / 2 - 0.02))); caster(kit, a * (W / 2 - 0.02), b * (D / 2 - 0.02), 0.04, a > 0); }
  for (const y of [0.18, 0.55, H - 0.01]) {
    kit.add(M.steel, rbox(W, 0.008, D, 0.003, 0, y, 0));
    for (const s of [-1, 1]) { kit.add(M.steel, rbox(W, 0.03, 0.006, 0.002, 0, y + 0.015, s * (D / 2 - 0.003))); kit.add(M.steel, rbox(0.006, 0.03, D, 0.002, s * (W / 2 - 0.003), y + 0.015, 0)); }
  }
  kit.add(M.steel, tube([[W / 2 - 0.02, H, -D / 2 + 0.05], [W / 2 + 0.08, H + 0.05, -D / 2 + 0.05], [W / 2 + 0.08, H + 0.05, D / 2 - 0.05], [W / 2 - 0.02, H, D / 2 - 0.05]], 0.012, 24, 10));
  kit.add(M.rubber, cyl(0.016, D - 0.16, 12, W / 2 + 0.08, H + 0.05, 0, HP));
  // cargo: specimen cooler, glove boxes, biohazard bag, paper towel
  const cy = H - 0.006;
  kit.add(M.white, rbox(0.36, 0.22, 0.28, 0.02, -0.18, cy + 0.11, 0));
  kit.add(M.teal, rbox(0.37, 0.04, 0.29, 0.015, -0.18, cy + 0.23, 0));
  kit.add(M.grey, rbox(0.16, 0.025, 0.04, 0.01, -0.18, cy + 0.262, 0));
  at.label(kit, 0.3, 0.13, 2000, (ctx, pw, ph) => { ctx.fillStyle = '#f6f7f5'; ctx.fillRect(0, 0, pw, ph); bioSymbol(ctx, ph * 0.5, ph * 0.5, ph * 0.33, PALETTE.bio); txt(ctx, 'SPECIMEN TRANSPORT', pw * 0.62, ph * 0.34, ph * 0.14, { w: 700, maxW: pw * 0.6 }); txt(ctx, 'UN 3373 · KEEP UPRIGHT', pw * 0.62, ph * 0.56, ph * 0.1, { color: '#444', maxW: pw * 0.6 }); txt(ctx, 'C-14 · WING C', pw * 0.62, ph * 0.76, ph * 0.1, { color: PALETTE.teal, maxW: pw * 0.6 }); }, -0.18, cy + 0.1, 0.1415);
  for (let i = 0; i < 2; i++) kit.add(M.white, rbox(0.25, 0.09, 0.13, 0.004, 0.2, cy + 0.045 + i * 0.09, -0.06));
  at.label(kit, 0.24, 0.08, 2000, (ctx, pw, ph) => { ctx.fillStyle = '#f6f7f5'; ctx.fillRect(0, 0, pw, ph); ctx.fillStyle = '#7a3ac8'; ctx.fillRect(0, ph * 0.7, pw, ph * 0.3); txt(ctx, 'NITRILE EXAM GLOVES', pw / 2, ph * 0.3, ph * 0.16, { w: 700 }); txt(ctx, 'SIZE L · 100 PCS', pw / 2, ph * 0.52, ph * 0.12, { color: '#333' }); }, 0.2, cy + 0.135, 0.0052);
  // red biohazard bag (lumpy)
  kit.add(paint(0xc8301c, 0.5), T(lumpy(new THREE.SphereGeometry(0.15, 18, 12).scale(1.2, 0.8, 0.9), 0.02, 14, seed), 0.1, 0.55 + 0.13, 0.02));
  kit.add(M.white, box(0.02, 0.04, 0.02, 0.1, 0.55 + 0.25, 0.02));
  at.label(kit, 0.12, 0.12, 2000, L.bioBadge(), 0.1, 0.55 + 0.15, 0.163, -0.2);
  kit.add(M.paper, cyl(0.06, 0.24, 20, -0.22, 0.25, 0, 0, 0, HP)); kit.add(M.cardboard, cyl(0.022, 0.242, 12, -0.22, 0.25, 0, 0, 0, HP));
  kit.build(g);
  g.userData.collider = { w: W + 0.1, d: D };
  return g;
}

// ================================================================== FUME HOOD
export function fumeHood({ seed } = {}) {
  const g = new THREE.Group(); g.name = 'fumeHood';
  const kit = new Kit(), at = new Atlas('fumeHood', 2048, 1024);
  const W = 1.5, D = 0.85, H = 2.35, sw = 0.1, top = 0.9;
  // base cabinets: flammables (yellow) + corrosives
  kit.add(M.rubber, box(W - 0.04, 0.1, D - 0.1, 0, 0.05, -0.02));
  kit.add(M.white, box(W - 0.01, 0.75, D - 0.06, 0, 0.1 + 0.375, -0.02));
  const cw = (W - 0.03) / 2;
  for (const s of [-1, 1]) {
    const x = s * (cw / 2 + 0.004), mat = s < 0 ? M.yellowPaint : M.whiteGloss;
    for (const t of [-1, 1]) {
      kit.add(mat, rbox(cw / 2 - 0.006, 0.7, 0.02, 0.004, x + t * cw / 4, 0.475, D / 2 - 0.04));
      kit.add(M.steel, cyl(0.006, 0.12, 10, x + t * 0.03, 0.62, D / 2 - 0.005));
    }
    kit.add(M.dark, box(0.004, 0.7, 0.002, x, 0.475, D / 2 - 0.029));
    if (s < 0) {
      at.label(kit, 0.26, 0.14, 1800, (ctx, pw, ph) => { ctx.fillStyle = PALETTE.yellow; ctx.fillRect(0, 0, pw, ph); txt(ctx, 'FLAMMABLE', pw / 2, ph * 0.28, ph * 0.26, { color: '#c8191b', w: 700 }); txt(ctx, 'KEEP FIRE AWAY', pw / 2, ph * 0.58, ph * 0.18, { color: '#c8191b', w: 700 }); txt(ctx, 'SELF-CLOSING · KEEP SHUT', pw / 2, ph * 0.84, ph * 0.11, { color: '#111' }); }, x, 0.48, D / 2 - 0.0295);
    } else at.label(kit, 0.24, 0.09, 1800, L.warn('CORROSIVES', 'ACIDS & BASES ONLY · VENTED'), x, 0.6, D / 2 - 0.0295);
  }
  // work surface with raised marine edge
  kit.add(M.epoxy, rbox(W, 0.035, D, 0.01, 0, top - 0.0175, 0));
  kit.add(M.epoxy, rbox(W - 2 * sw, 0.015, 0.03, 0.006, 0, top + 0.007, D / 2 - 0.1));
  // side posts (double wall) + top box
  for (const s of [-1, 1]) {
    kit.add(M.white, rbox(sw, H - top, D, 0.012, s * (W / 2 - sw / 2), top + (H - top) / 2, 0));
    kit.add(M.grey, box(0.004, H - top - 0.4, D - 0.15, s * (W / 2 - sw), top + (H - top - 0.4) / 2, -0.04));
  }
  kit.add(M.white, rbox(W, 0.36, D, 0.012, 0, H - 0.18, 0));
  kit.add(M.white, box(W - 2 * sw, H - top - 0.36, 0.03, 0, top + (H - top - 0.36) / 2, -D / 2 + 0.015));
  // baffle with slots
  kit.add(M.grey, box(W - 2 * sw - 0.02, H - top - 0.45, 0.01, 0, top + (H - top - 0.45) / 2 + 0.02, -D / 2 + 0.08));
  for (const y of [top + 0.08, top + 0.5, H - 0.45]) kit.add(M.dark, box(W - 2 * sw - 0.1, 0.03, 0.004, 0, y, -D / 2 + 0.0855));
  // airfoil sill
  kit.add(M.steel, T(new THREE.CylinderGeometry(0.03, 0.03, W - 2 * sw, 16, 1, false, 0, PI).rotateZ(HP), 0, top + 0.03, D / 2 - 0.04, 0, 0, 0));
  // fascia above the sash: labels + airflow monitor
  const fy = H - 0.18, fz = D / 2 + 0.0005;
  at.label(kit, 0.62, 0.07, 1800, L.brand('CLASS II FUME CABINET · FH-C2', PALETTE.teal), -0.25, fy + 0.07, fz);
  at.label(kit, 0.4, 0.09, 1800, L.warn('TOXIC VAPOURS', 'WORK 15 cm INSIDE THE SASH'), -0.25, fy - 0.06, fz);
  kit.add(M.black, rbox(0.26, 0.2, 0.03, 0.01, 0.43, fy, D / 2 + 0.012));
  at.label(kit, 0.14, 0.07, 3000, L.lcd(['FACE VEL', '0.52 m/s']), 0.4, fy + 0.04, D / 2 + 0.0275, 0, 0, 0, at.glow);
  kit.add(led(0x30ff70, 3), sph(0.006, 10, 6, 0.51, fy + 0.06, D / 2 + 0.027));
  kit.add(led(0xff3020, 0.3), sph(0.006, 10, 6, 0.51, fy + 0.03, D / 2 + 0.027));
  kit.add(M.red, rbox(0.06, 0.025, 0.012, 0.004, 0.37, fy - 0.05, D / 2 + 0.03), M.grey && rbox(0.06, 0.025, 0.012, 0.004, 0.45, fy - 0.05, D / 2 + 0.03));
  at.label(kit, 0.2, 0.016, 3000, L.text('MUTE      TEST      ALARM', { color: '#c9cdd0', size: 0.6 }), 0.43, fy - 0.075, D / 2 + 0.0275);
  // sash: guides in the posts + raised frame
  for (const s of [-1, 1]) kit.add(M.steel, box(0.02, H - top - 0.36, 0.03, s * (W / 2 - sw - 0.01), top + (H - top - 0.36) / 2, D / 2 - 0.06));
  const sash = new THREE.Group(); sash.name = 'sash'; g.add(sash);
  const sk = new Kit(), sy0 = top + 0.42, sh = 0.85, sx = W - 2 * sw - 0.03;
  sk.add(M.steel, rbox(sx, 0.05, 0.035, 0.008, 0, sy0 + 0.025, D / 2 - 0.06), rbox(sx, 0.03, 0.03, 0.006, 0, sy0 + sh, D / 2 - 0.06));
  for (const s of [-1, 1]) sk.add(M.steel, box(0.03, sh, 0.03, s * (sx / 2 - 0.015), sy0 + sh / 2, D / 2 - 0.06));
  sk.add(M.glass, box(sx - 0.06, sh - 0.06, 0.008, 0, sy0 + sh / 2 + 0.01, D / 2 - 0.06));
  sk.add(M.steel, cyl(0.014, sx - 0.12, 14, 0, sy0 + 0.01, D / 2 - 0.02, 0, 0, HP));
  for (const s of [-1, 1]) sk.add(M.steel, cyl(0.009, 0.04, 10, s * (sx / 2 - 0.1), sy0 + 0.01, D / 2 - 0.038, HP));
  at.label(sk, 0.3, 0.04, 2000, L.plain('KEEP SASH LOWERED', 'WHEN NOT IN USE', { bar: PALETTE.bio }), 0.3, sy0 + 0.12, D / 2 - 0.0555);
  sk.build(sash);
  g.userData.sash = sash; g.userData.sashTravel = 0.38;
  // sash height sticker on the post
  at.label(kit, 0.09, 0.06, 2600, (ctx, pw, ph) => { ctx.fillStyle = PALETTE.yellow; ctx.fillRect(0, 0, pw, ph); ctx.fillStyle = '#111'; ctx.beginPath(); ctx.moveTo(pw * 0.06, ph * 0.5); ctx.lineTo(pw * 0.22, ph * 0.2); ctx.lineTo(pw * 0.22, ph * 0.8); ctx.fill(); txt(ctx, 'MAX SASH', pw * 0.6, ph * 0.35, ph * 0.24, { color: '#111', w: 700, maxW: pw * 0.7 }); txt(ctx, 'HEIGHT 45 cm', pw * 0.6, ph * 0.68, ph * 0.2, { color: '#111', maxW: pw * 0.7 }); }, -W / 2 + sw / 2, sy0 + 0.45, D / 2 + 0.0005);
  // interior light strip + services
  const lightMat = lamp(0xf4f8ff, 2.4, 0xffffff);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(W - 2 * sw - 0.1, 0.012, 0.12), lightMat); strip.position.set(0, H - 0.37, 0.05); g.add(strip);
  for (const s of [-1, 1]) {
    kit.add(M.chrome, cyl(0.012, 0.03, 12, s * (W / 2 - sw - 0.01), top + 0.2, -0.1, 0, 0, HP));
    kit.add(plastic(s < 0 ? 0x2a6fd0 : 0xe0c020), box(0.012, 0.05, 0.012, s * (W / 2 - sw - 0.035), top + 0.2, -0.1));
  }
  // a beaker and a rack left inside
  glassware(kit, at, 'beaker', -0.3, top, -0.1, { s: 1.2, fluid: 0x6aa83a, fill: 0.4 });
  glassware(kit, at, 'flask', 0.2, top, -0.15, { s: 1.1, fluid: 0xc98a1a, fill: 0.3 });
  tubeRack(kit, -0.05, top, 0.05, 8, rng(5));
  // exhaust duct collar
  kit.add(M.steel, cyl(0.15, 0.25, 28, 0, H + 0.125, -0.1));
  for (let i = 0; i < 6; i++) kit.add(M.steelDark, tor(0.151, 0.006, 4, 28, TAU, 0, H + 0.03 + i * 0.04, -0.1, HP));
  kit.build(g);
  g.userData.light = strip;
  g.userData.setLight = (on) => { lightMat.emissiveIntensity = on ? 2.4 : 0; };
  g.userData.collider = { w: W, d: D };
  return g;
}

// ================================================================== CENTRIFUGE (floor-standing, refrigerated)
function drawCentrifuge(ctx, w, h) {
  ctx.fillStyle = '#03080a'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#0c2b2c'; ctx.fillRect(0, 0, w, h * 0.16);
  hexMark(ctx, h * 0.1, h * 0.08, h * 0.05, '#3fd1c4');
  txt(ctx, 'HALVERSEN UC-90', h * 0.2, h * 0.08, h * 0.08, { color: '#3fd1c4', align: 'left', w: 700 });
  const rows = [['RCF', '15 000 × g'], ['TIME', '04:00'], ['TEMP', '4 °C'], ['ROTOR', 'SW-41']];
  rows.forEach(([k, v], i) => { txt(ctx, k, w * 0.06, h * (0.3 + i * 0.16), h * 0.08, { color: '#5f8f8a', align: 'left' }); txt(ctx, v, w * 0.94, h * (0.3 + i * 0.16), h * 0.12, { color: '#bff4ec', align: 'right', w: 700 }); });
  ctx.fillStyle = '#e06a4a'; ctx.fillRect(0, h * 0.9, w, h * 0.1); txt(ctx, 'LID LOCKED', w / 2, h * 0.95, h * 0.07, { color: '#fff', w: 700 });
}
export function centrifuge({ seed } = {}) {
  const g = new THREE.Group(); g.name = 'centrifuge';
  const kit = new Kit(), at = new Atlas('centrifuge', 1024, 1024);
  const W = 0.72, D = 0.7, H = 0.84;
  kit.add(M.whiteGloss, rbox(W, H - 0.05, D, 0.03, 0, 0.05 + (H - 0.05) / 2, 0));
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) kit.add(M.rubber, cyl(0.03, 0.05, 14, a * (W / 2 - 0.08), 0.025, b * (D / 2 - 0.08)));
  kit.add(M.grey, box(W - 0.04, 0.004, 0.002, 0, 0.3, D / 2 + 0.0005));
  for (let i = 0; i < 10; i++) kit.add(M.dark, box(0.4, 0.008, 0.003, 0, 0.1 + i * 0.016, D / 2 - 0.0005));
  for (const s of [-1, 1]) for (let i = 0; i < 8; i++) kit.add(M.dark, box(0.003, 0.008, 0.3, s * (W / 2 - 0.0005), 0.2 + i * 0.02, -0.05));
  // sloped control panel at the front top
  kit.push(0, H - 0.06, D / 2 - 0.13, 0.5, 0, 0);
  kit.add(M.panelDark, rbox(W - 0.06, 0.02, 0.24, 0.008, 0, 0.0, 0));
  const membrane = [['START', 0x2fae5a], ['STOP', 0xc8191b], ['OPEN', 0x5d666c], ['PROG', 0x5d666c]];
  membrane.forEach(([n, c], i) => { kit.add(plastic(c), rbox(0.06, 0.008, 0.04, 0.004, 0.08 + (i % 2) * 0.08, 0.012, -0.03 + Math.floor(i / 2) * 0.07)); at.label(kit, 0.055, 0.016, 3000, L.text(n, { color: '#ffffff', size: 0.6 }), 0.08 + (i % 2) * 0.08, 0.0165, -0.03 + Math.floor(i / 2) * 0.07, -HP); });
  kit.add(M.black, cyl(0.025, 0.02, 24, 0.27, 0.015, 0.0)); kit.add(M.chrome, box(0.003, 0.003, 0.02, 0.27, 0.026, -0.01));
  const scr = makeScreen(0.2, 0.12, { draw: drawCentrifuge }, 400);
  kit.push(-0.16, 0.0105, 0, -HP, 0, 0); kit.place(scr.mesh); kit.pop(); g.add(scr.mesh);
  kit.add(M.black, rbox(0.22, 0.004, 0.14, 0.004, -0.16, 0.009, 0));
  kit.pop();
  // lid with viewing window, hinge, latch
  kit.add(M.grey, rbox(W - 0.04, 0.06, D - 0.3, 0.025, 0, H + 0.02, -0.12));
  kit.add(M.glassDark, cyl(0.12, 0.004, 32, 0, H + 0.051, -0.12));
  kit.add(M.black, tor(0.12, 0.008, 6, 32, TAU, 0, H + 0.05, -0.12, HP));
  kit.add(M.chrome, cyl(0.17, 0.02, 32, 0, H - 0.02, -0.12));
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; kit.add(M.steel, cyl(0.03, 0.06, 12, Math.cos(a) * 0.11, H - 0.0, -0.12 + Math.sin(a) * 0.11)); }
  kit.add(M.steelDark, cyl(0.012, W - 0.1, 12, 0, H + 0.01, -D / 2 + 0.03, 0, 0, HP));
  kit.add(M.darkGrey, rbox(0.12, 0.03, 0.03, 0.01, 0, H + 0.01, 0.05));
  at.label(kit, 0.3, 0.06, 2600, L.brand('UC-90 REFRIGERATED', '#5e676c'), 0, 0.55, D / 2 + 0.001);
  at.label(kit, 0.22, 0.07, 2600, L.warn('ROTOR HAZARD', 'NEVER OPEN WHILE SPINNING'), -0.2, 0.42, D / 2 + 0.001);
  at.label(kit, 0.07, 0.07, 2600, L.bioBadge(), 0.25, 0.43, D / 2 + 0.001);
  at.label(kit, 0.08, 0.045, 2600, L.tag('HB-CF-0090', 90), W / 2 + 0.001, 0.6, 0.15, 0, HP);
  kit.build(g);
  g.userData.screens = [scr];
  g.userData.collider = { w: W, d: D };
  return g;
}

// ================================================================== MICROSCOPE (benchtop; origin at the base)
export function microscope() {
  const g = new THREE.Group(); g.name = 'microscope';
  const kit = new Kit(), at = new Atlas('microscope', 512, 512);
  const body = M.whiteGloss, blk = M.black;
  kit.add(body, rbox(0.22, 0.05, 0.27, 0.015, 0, 0.025, -0.01));
  kit.add(blk, rbox(0.2, 0.006, 0.25, 0.004, 0, 0.003, -0.01));
  kit.add(M.black, cyl(0.022, 0.012, 20, 0, 0.055, 0.03)); kit.add(lamp(0xfff4e0, 1.2), cyl(0.016, 0.003, 20, 0, 0.062, 0.03));
  kit.add(blk, cyl(0.016, 0.014, 20, 0.115, 0.025, 0.06, 0, 0, HP));
  // C-arm (side profile extruded across X)
  const arm = new THREE.Shape();
  arm.moveTo(-0.13, 0.04); arm.lineTo(-0.06, 0.04); arm.quadraticCurveTo(-0.04, 0.2, -0.06, 0.3); arm.lineTo(-0.02, 0.33); arm.lineTo(-0.02, 0.37); arm.lineTo(-0.12, 0.37); arm.quadraticCurveTo(-0.16, 0.2, -0.13, 0.04);
  kit.add(body, T(extrude(arm, 0.07, 0.006), -0.035, 0, 0, 0, 0, 0).rotateY(-HP).translate(0, 0, 0));
  // focus knobs (coarse + fine) both sides
  for (const s of [-1, 1]) {
    kit.add(blk, cyl(0.032, 0.022, 24, s * 0.05, 0.13, -0.09, 0, 0, HP));
    for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; kit.add(blk, box(0.022, 0.004, 0.004, s * 0.05, 0.13 + Math.cos(a) * 0.032, -0.09 + Math.sin(a) * 0.032, a, 0, 0)); }
    kit.add(M.chrome, cyl(0.018, 0.012, 20, s * 0.067, 0.13, -0.09, 0, 0, HP));
    kit.add(blk, cyl(0.014, 0.016, 20, s * 0.08, 0.13, -0.09, 0, 0, HP));
  }
  // stage with clips, slide and XY knobs
  kit.add(blk, rbox(0.16, 0.014, 0.15, 0.004, 0, 0.18, 0.03));
  kit.add(M.dark, cyl(0.014, 0.0152, 18, 0, 0.18, 0.03));
  kit.add(M.steel, box(0.04, 0.003, 0.012, -0.045, 0.189, 0.0, 0, 0.3, 0), box(0.04, 0.003, 0.012, 0.045, 0.189, 0.0, 0, -0.3, 0));
  kit.add(M.glass, box(0.075, 0.0015, 0.026, 0, 0.1878, 0.03));
  kit.add(fluid(0xc04a7a, 0.8), cyl(0.008, 0.0005, 14, 0.008, 0.1888, 0.03));
  kit.add(M.steel, box(0.012, 0.06, 0.012, 0.07, 0.15, 0.08));
  kit.add(blk, cyl(0.012, 0.016, 18, 0.07, 0.11, 0.08), cyl(0.009, 0.016, 18, 0.07, 0.092, 0.08));
  // condenser
  kit.add(blk, cyl(0.022, 0.035, 20, 0, 0.155, 0.03)); kit.add(M.steel, box(0.03, 0.003, 0.004, 0.025, 0.15, 0.03, 0, 0.5, 0));
  // revolving nosepiece + objectives
  kit.push(0, 0.29, 0.02, -0.25, 0, 0);
  kit.add(M.chrome, lathe([[0.001, 0.02], [0.035, 0.015], [0.042, 0.0], [0.001, -0.002]], 28));
  [[0x2a2a2a, 0.03], [0xc8191b, 0.036], [0xe0b020, 0.042], [0x2fae5a, 0.048]].forEach(([c, len], i) => {
    const a = (i / 4) * TAU + 0.4, ox = Math.cos(a) * 0.022, oz = Math.sin(a) * 0.022;
    kit.add(M.chrome, cone(0.009, 0.011, len, 16, ox, -len / 2, oz, 0.1 * Math.sin(a), 0, -0.1 * Math.cos(a)));
    kit.add(plastic(c), cyl(0.0112, 0.004, 16, ox, -0.008, oz, 0.1 * Math.sin(a), 0, -0.1 * Math.cos(a)));
    kit.add(M.dark, cyl(0.004, 0.002, 10, ox, -len, oz));
  });
  kit.pop();
  // binocular head
  kit.add(body, rbox(0.09, 0.06, 0.15, 0.02, 0, 0.35, -0.03));
  kit.push(0, 0.38, 0.02, -0.75, 0, 0);
  kit.add(body, rbox(0.11, 0.04, 0.07, 0.015, 0, 0.0, 0.0));
  for (const s of [-1, 1]) {
    kit.add(blk, cyl(0.013, 0.08, 18, s * 0.032, 0.0, 0.06, HP));
    kit.add(M.rubber, cyl(0.017, 0.022, 18, s * 0.032, 0.0, 0.105, HP));
    kit.add(M.dark, cyl(0.009, 0.002, 14, s * 0.032, 0.0, 0.1165, HP));
    kit.add(M.chrome, cyl(0.0135, 0.006, 18, s * 0.032, 0.0, 0.03, HP));
  }
  kit.pop();
  at.label(kit, 0.08, 0.02, 4000, L.brand(null, PALETTE.teal), -0.0355 - 0.0035, 0.26, -0.1, 0, -HP, 0);
  at.label(kit, 0.06, 0.016, 4000, L.text('BX-41 · 40×', { color: '#3a4146', size: 0.6 }), 0.0355 + 0.0035, 0.26, -0.1, 0, HP, 0);
  kit.add(M.cableGrey, tube([[0, 0.02, -0.145], [0, 0.01, -0.2], [0.05, 0.003, -0.3]], 0.0035, 10, 5));
  kit.build(g);
  g.userData.collider = null;
  return g;
}

// ================================================================== ANALYZER (benchtop)
export function analyzer({ seed } = {}) {
  seed = seedOf(seed); const r = rng(seed);
  const g = new THREE.Group(); g.name = 'analyzer';
  const kit = new Kit(), at = new Atlas('analyzer', 1024, 512);
  const W = 0.62, D = 0.52, H = 0.42;
  kit.add(M.whiteGloss, rbox(W, H, D, 0.03, 0, H / 2, 0));
  kit.add(M.grey, rbox(W - 0.004, 0.08, D - 0.004, 0.02, 0, 0.04, 0));
  kit.add(led(0x3fd1c4, 2.2), box(W - 0.1, 0.006, 0.002, 0, 0.085, D / 2 + 0.0005));
  // carousel bay (right) under a clear dome
  const cx = 0.14, cz = 0.04;
  kit.add(M.darkGrey, cyl(0.15, 0.01, 40, cx, H + 0.005, cz));
  kit.add(M.grey, cyl(0.13, 0.025, 40, cx, H + 0.022, cz));
  kit.add(M.steel, cyl(0.02, 0.05, 16, cx, H + 0.04, cz));
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * TAU, x = cx + Math.cos(a) * 0.11, z = cz + Math.sin(a) * 0.11;
    if (r() < 0.2) continue;
    glassware(kit, null, 'tube', x, H + 0.035, z, { s: 0.75, fluid: [0xc98a1a, 0x9b1b1b, 0xe8d070][i % 3], fill: 0.5 });
    kit.add(plastic([0xd02020, 0x7a3ac8, 0xe0c020, 0x2060d0][i % 4]), cyl(0.0068, 0.012, 10, x, H + 0.035 + 0.078, z));
  }
  kit.add(M.glass, lathe([[0.155, 0], [0.155, 0.1], [0.13, 0.14], [0.001, 0.15]], 32, cx, H, cz));
  kit.add(M.black, tor(0.155, 0.006, 6, 40, TAU, cx, H + 0.005, cz, HP));
  // angled touchscreen (left)
  kit.push(-0.14, H + 0.08, 0.06, -0.55, 0, 0);
  kit.add(M.black, rbox(0.3, 0.2, 0.025, 0.01, 0, 0, -0.012));
  const scr = makeScreen(0.27, 0.17, { kind: 'analyzer', title: 'ANALYZER 2', seed }, 512);
  scr.mesh.position.z = 0.0015; kit.place(scr.mesh); g.add(scr.mesh);
  kit.pop();
  kit.add(M.whiteGloss, rbox(0.12, 0.09, 0.08, 0.02, -0.14, H + 0.03, 0.0));
  // reagent drawer, printer slot, side vents
  kit.add(M.whiteGloss, rbox(0.3, 0.12, 0.02, 0.006, -0.14, 0.2, D / 2));
  kit.add(M.grey, rbox(0.12, 0.015, 0.02, 0.006, -0.14, 0.24, D / 2 + 0.012));
  at.label(kit, 0.14, 0.025, 3000, L.text('REAGENT TRAY A', { color: '#4f585d', size: 0.6 }), -0.14, 0.165, D / 2 + 0.0105);
  kit.add(M.dark, box(0.1, 0.004, 0.002, 0.16, 0.3, D / 2 + 0.0005));
  kit.add(M.paper, T(new THREE.PlaneGeometry(0.08, 0.06).translate(0, -0.03, 0), 0.16, 0.3, D / 2 + 0.004, 0.2, 0, 0));
  for (let i = 0; i < 9; i++) kit.add(M.dark, box(0.003, 0.12, 0.012, W / 2 - 0.0005, 0.2, -0.15 + i * 0.03));
  at.label(kit, 0.24, 0.04, 3000, L.brand('CHEMISTRY ANALYZER · CA-7', '#5e676c'), 0.12, 0.2, D / 2 + 0.0005);
  at.label(kit, 0.06, 0.06, 3000, L.bioBadge(), 0.24, 0.32, D / 2 + 0.0005);
  kit.build(g);
  g.userData.screens = [scr];
  g.userData.collider = null;
  return g;
}

// ================================================================== SERVER RACK
const RACK_FACES = { 1: 'server1', 2: 'server2' };
function rackLedTex() {
  return cachedTex('rackLeds', () => {
    const c = mkCanvas(512, 512), ctx = c.getContext('2d'), r = rng(99);
    for (let f = 0; f < 4; f++) for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) {
      const on = r() < 0.55; if (!on) continue;
      ctx.fillStyle = r() < 0.75 ? '#38ff7a' : r() < 0.6 ? '#ffb020' : '#3fb6ff';
      ctx.beginPath(); ctx.arc(x * 16 + 8, f * 128 + y * 8 + 4, 2.8, 0, TAU); ctx.fill();
    }
    const t = texFrom(c, { repeat: [1, 1] }); t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}
function drawRackFace(ctx, pw, ph, kind) {
  ctx.fillStyle = '#16181b'; ctx.fillRect(0, 0, pw, ph);
  const u = ph / (kind === 'server2' || kind === 'storage' ? 2 : kind === 'ups' ? 3 : 1);
  if (kind === 'server1' || kind === 'server2' || kind === 'storage') {
    const bays = kind === 'storage' ? 12 : kind === 'server2' ? 8 : 10, bw = (pw * 0.72) / (kind === 'storage' ? 6 : bays);
    const rows = kind === 'storage' ? 2 : 1;
    for (let rr = 0; rr < rows; rr++) for (let i = 0; i < (kind === 'storage' ? 6 : bays); i++) {
      const x = pw * 0.04 + i * bw, y = ph * 0.12 + (rr * ph * 0.8) / rows, h = (ph * 0.76) / rows;
      ctx.fillStyle = '#2b2f34'; ctx.fillRect(x + 1, y, bw - 3, h);
      ctx.fillStyle = '#0c0d0f'; for (let k = 0; k < 4; k++) ctx.fillRect(x + 3, y + 2 + k * (h / 4), bw - 7, h / 9);
      ctx.fillStyle = '#5a6066'; ctx.fillRect(x + bw - 8, y + 2, 3, h - 4);
    }
    ctx.fillStyle = '#0a0b0c'; for (let i = 0; i < 40; i++) for (let j = 0; j < 3; j++) { ctx.beginPath(); ctx.arc(pw * 0.8 + (i % 10) * 6, ph * 0.25 + j * 6 + Math.floor(i / 10) * 0, 1.8, 0, TAU); ctx.fill(); }
    hexMark(ctx, pw * 0.95, ph * 0.5, Math.min(ph * 0.25, 10), '#3fd1c4');
  } else if (kind === 'switch') {
    for (let i = 0; i < 24; i++) { const x = pw * 0.06 + (i % 12) * pw * 0.05 + Math.floor(i / 12) * 0, y = ph * (i < 12 ? 0.18 : 0.55); ctx.fillStyle = '#050505'; ctx.fillRect(x, y, pw * 0.04, ph * 0.3); ctx.fillStyle = '#8a8f94'; ctx.fillRect(x, y, pw * 0.04, 2); }
    for (let i = 0; i < 4; i++) { ctx.fillStyle = '#26292d'; ctx.fillRect(pw * 0.72 + i * pw * 0.05, ph * 0.3, pw * 0.04, ph * 0.4); }
    txt(ctx, 'CORE-SW 02', pw * 0.93, ph * 0.5, ph * 0.3, { color: '#9aa3a8', align: 'right' });
  } else if (kind === 'patch') {
    ctx.fillStyle = '#202326'; ctx.fillRect(0, 0, pw, ph);
    for (let i = 0; i < 24; i++) { const x = pw * 0.05 + i * pw * 0.037; ctx.fillStyle = '#050505'; ctx.fillRect(x, ph * 0.38, pw * 0.028, ph * 0.38); ctx.fillStyle = '#e8eaea'; ctx.font = F(ph * 0.18); ctx.textAlign = 'center'; ctx.fillText(String(i + 1), x + pw * 0.014, ph * 0.26); }
  } else if (kind === 'ups') {
    ctx.fillStyle = '#202326'; ctx.fillRect(0, 0, pw, ph);
    for (let i = 0; i < 30; i++) for (let j = 0; j < 8; j++) { ctx.fillStyle = '#0a0b0c'; ctx.beginPath(); ctx.arc(pw * 0.05 + i * pw * 0.018, ph * 0.2 + j * ph * 0.08, 2.2, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#05100c'; ctx.fillRect(pw * 0.66, ph * 0.25, pw * 0.2, ph * 0.3);
    txt(ctx, 'LOAD 62%', pw * 0.76, ph * 0.34, ph * 0.08, { color: '#7fe3a0' }); txt(ctx, 'BATT 100%', pw * 0.76, ph * 0.47, ph * 0.08, { color: '#7fe3a0' });
    wordmark(ctx, pw * 0.66, ph * 0.75, ph * 0.08, '#9aa3a8');
  } else { // blank / vented
    ctx.fillStyle = '#1b1e21'; ctx.fillRect(0, 0, pw, ph);
    ctx.fillStyle = '#0b0c0d'; for (let i = 0; i < 60; i++) ctx.fillRect(pw * 0.05 + i * pw * 0.015, ph * 0.3, pw * 0.006, ph * 0.4);
  }
}
export function serverRack({ seed } = {}) {
  seed = seedOf(seed); const r = rng(seed);
  const g = new THREE.Group(); g.name = 'serverRack';
  const kit = new Kit(), at = new Atlas('rackFaces', 1024, 1024);
  const W = 0.6, D = 1.07, H = 2.0, U = 0.04445, fz = D / 2 - 0.06;
  // frame + panels
  for (const s of [-1, 1]) { kit.add(M.rack, box(0.01, H - 0.12, D, s * (W / 2 - 0.005), 0.06 + (H - 0.12) / 2, 0)); }
  kit.add(M.rack, rbox(W, 0.05, D, 0.008, 0, H - 0.025, 0), box(W, 0.06, D, 0, 0.03, 0));
  kit.add(M.rack, box(W - 0.02, H - 0.12, 0.01, 0, 0.06 + (H - 0.12) / 2, -D / 2 + 0.005));
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { kit.add(M.steelDark, cyl(0.012, 0.03, 10, a * (W / 2 - 0.05), 0.0, b * (D / 2 - 0.06))); kit.add(M.black, cyl(0.025, 0.01, 14, a * (W / 2 - 0.05), 0.005, b * (D / 2 - 0.06))); }
  for (const x of [-0.12, 0.12]) { kit.add(M.mesh, plane(0.16, 0.16, x, H + 0.0005, -0.15, -HP)); kit.add(M.dark, tor(0.08, 0.006, 4, 24, TAU, x, H + 0.002, -0.15, HP)); }
  kit.add(M.black, box(0.2, 0.004, 0.06, 0, H + 0.001, 0.3));
  // rails (with square holes texture-free: small dark boxes)
  for (const s of [-1, 1]) {
    kit.add(M.steelDark, box(0.02, H - 0.15, 0.03, s * (W / 2 - 0.035), H / 2, fz));
    for (let i = 0; i < 42; i++) kit.add(M.dark, box(0.004, 0.006, 0.002, s * (W / 2 - 0.035), 0.1 + i * U, fz + 0.016));
  }
  // equipment stack (bottom -> top)
  const stack = [['ups', 3], ['blank', 1], ['storage', 2], ['storage', 2], ['blank', 1], ['server1', 1], ['server1', 1], ['server1', 1], ['server1', 1], ['server1', 1], ['blank', 1], ['server2', 2], ['server2', 2], ['server2', 2], ['blank', 1], ['switch', 1], ['patch', 1], ['blank', 1], ['server1', 1], ['server1', 1], ['server1', 1], ['blank', 1], ['storage', 2], ['server2', 2], ['server1', 1], ['server1', 1], ['blank', 1]];
  const faceRects = {};
  const ledMat = cachedMat('rackLed', () => noShadow(std({ color: 0x000000, emissive: 0xffffff, emissiveMap: rackLedTex(), emissiveIntensity: 1.8, alphaMap: rackLedTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 })));
  let y = 0.1, patchY = 0, switchY = 0;
  const ew = W - 0.09;
  for (const [kind, n] of stack) {
    const h = n * U - 0.002, yc = y + h / 2;
    if (!faceRects[kind + n]) faceRects[kind + n] = at.alloc(ew * 900, h * 900, (ctx, pw, ph) => drawRackFace(ctx, pw, ph, kind));
    const depth = kind === 'patch' || kind === 'blank' ? 0.03 : 0.7;
    kit.add(M.rack, box(ew - 0.004, h, depth, 0, yc, fz - depth / 2 + 0.01));
    kit.add(at.mat, at.plane(faceRects[kind + n], ew, h, 0, yc, fz + 0.0115));
    if (kind !== 'blank' && kind !== 'patch') {
      for (const s of [-1, 1]) kit.add(M.steelDark, box(0.022, h - 0.004, 0.012, s * (ew / 2 + 0.006), yc, fz + 0.017));
      // blinking LEDs: map a random patch of the LED sheet
      const lw = kind === 'switch' ? 0.25 : 0.05, lh = Math.min(h * 0.5, 0.012);
      const pg = new THREE.PlaneGeometry(lw, lh), uv = pg.attributes.uv, us = lw * 2.5, vs = 0.0234, u0 = r() * (1 - us), v0 = 0.755 + r() * (0.24 - vs);
      for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * us, v0 + uv.getY(i) * vs);
      kit.add(ledMat, T(pg, kind === 'switch' ? -0.03 : ew / 2 - 0.06, kind === 'switch' ? yc : yc + h * 0.2, fz + 0.0125));
    }
    if (kind === 'patch') patchY = yc;
    if (kind === 'switch') switchY = yc;
    y += n * U;
  }
  // patch cords switch -> patch panel
  const cms = [M.cableBlue, M.cableYellow, M.cableTeal, M.cableBlue, M.cableRed, M.cableBlue, M.cableGrey, M.cableBlue];
  for (let i = 0; i < 8; i++) {
    const x0 = -ew / 2 + 0.03 + i * 0.022, x1 = -ew / 2 + 0.035 + (i * 3 % 12) * 0.02, sag = 0.04 + r() * 0.06;
    kit.add(cms[i], tube([[x0, switchY - 0.005, fz + 0.012], [x0, switchY - 0.01, fz + 0.04], [lerp(x0, x1, 0.5) + 0.02, switchY - sag, fz + 0.06], [x1, patchY + 0.005, fz + 0.04], [x1, patchY + 0.003, fz + 0.012]], 0.0022, 20, 5));
  }
  // vertical cable bundles inside the side channels
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
    const x = s * (W / 2 - 0.022), z = fz - 0.08 - i * 0.03;
    kit.add([M.cableBlack, M.cableBlue, M.cableBlack, M.cableGrey][i], tube([[x, 0.08, z], [x + s * 0.002, 0.8, z + 0.01], [x, 1.5, z], [x, H - 0.05, z - 0.01]], 0.007, 12, 6));
  }
  // front door (perforated) swung open on the left hinge
  const door = new THREE.Group(); door.name = 'rackDoor'; door.position.set(-W / 2, 0, D / 2 + 0.01); door.rotation.y = 1.9; g.add(door);
  const dk = new Kit();
  dk.add(M.rack, box(0.03, H - 0.08, 0.025, 0.015, H / 2, 0), box(0.03, H - 0.08, 0.025, W - 0.015, H / 2, 0), box(W, 0.04, 0.025, W / 2, 0.06, 0), box(W, 0.04, 0.025, W / 2, H - 0.06, 0));
  dk.add(M.mesh, plane(W - 0.06, H - 0.16, W / 2, H / 2, 0));
  dk.add(M.chrome, rbox(0.025, 0.14, 0.03, 0.006, W - 0.04, H / 2, 0.02));
  dk.build(door);
  // labels
  at.label(kit, 0.2, 0.05, 1800, (ctx, pw, ph) => { ctx.fillStyle = '#f6f7f5'; ctx.fillRect(0, 0, pw, ph); ctx.fillStyle = PALETTE.teal; ctx.fillRect(0, 0, pw * 0.06, ph); txt(ctx, 'RACK C-0' + (1 + (seed % 6)), pw * 0.53, ph * 0.4, ph * 0.42, { w: 700 }); txt(ctx, 'AUTHORISED IT ONLY', pw * 0.53, ph * 0.8, ph * 0.18, { color: '#555' }); }, 0, H - 0.025, D / 2 + 0.0005);
  at.label(kit, 0.08, 0.045, 2400, L.tag('HB-SR-0' + (200 + (seed % 50)), seed), W / 2 + 0.0005, 1.6, 0.3, 0, HP);
  kit.build(g);
  g.userData.ledTexture = rackLedTex();
  g.userData.door = door;
  g.userData.update = (t) => { rackLedTex().offset.y = -(Math.floor(t * 7) % 4) * 0.25; };
  g.userData.collider = { w: W, d: D };
  return g;
}

// ================================================================== WALL ITEMS
// Unless noted, wall items have their origin on the wall surface at the vertical centre of the item.
export function wallCabinet({ w = 0.9, h = 0.7, d = 0.35, seed } = {}) {
  seed = seedOf(seed) % 4; const r = rng(seed);
  const g = new THREE.Group(); g.name = 'wallCabinet';
  const kit = new Kit(), at = new Atlas('wallCab_' + (seed % 4), 1024, 1024);
  const t = 0.018;
  kit.add(M.white, box(w, h, t, 0, 0, t / 2));
  for (const s of [-1, 1]) { kit.add(M.white, box(t, h, d, s * (w / 2 - t / 2), 0, d / 2)); kit.add(M.white, rbox(w, t, d, 0.004, 0, s * (h / 2 - t / 2), d / 2)); }
  kit.add(M.grey, box(w - 0.04, 0.008, d - 0.04, 0, 0.0, d / 2 - 0.01));
  // supplies on two shelves
  const items = [['GAUZE', '#3a63c8'], ['SYRINGES 5 ml', '#c8191b'], ['SWABS', PALETTE.teal], ['SPECIMEN BAGS', PALETTE.bio], ['TAPE', '#7a3ac8'], ['SALINE', '#2fae5a']];
  for (const [yi, y0] of [[0, -h / 2 + t], [1, 0.004]].map(([a, b]) => [a, b])) {
    let x = -w / 2 + 0.05;
    while (x < w / 2 - 0.12) {
      const bw = 0.1 + r() * 0.08, bh = 0.08 + r() * 0.12, bd = 0.16 + r() * 0.1, it = items[Math.floor(r() * items.length)];
      if (r() < 0.25) { glassware(kit, null, r() < 0.5 ? 'bottle' : 'amber', x + 0.04, y0, d / 2 - 0.02, { s: 0.9, fluid: FLUIDS[Math.floor(r() * 7)], fill: 0.6 }); x += 0.1; continue; }
      kit.add(M.white, box(bw, bh, bd, x + bw / 2, y0 + bh / 2, d / 2 - 0.03));
      at.label(kit, bw - 0.01, Math.min(bh - 0.01, 0.05), 1500, (ctx, pw, ph) => { ctx.fillStyle = '#f7f7f2'; ctx.fillRect(0, 0, pw, ph); ctx.fillStyle = it[1]; ctx.fillRect(0, ph * 0.75, pw, ph * 0.25); txt(ctx, it[0], pw / 2, ph * 0.4, ph * 0.35, { w: 700, maxW: pw * 0.9 }); }, x + bw / 2, y0 + bh / 2, d / 2 - 0.03 + bd / 2 + 0.0005);
      x += bw + 0.01;
    }
  }
  // glass doors
  for (const s of [-1, 1]) {
    const dw = w / 2 - 0.006, x = s * (w / 4), z = d + 0.01;
    kit.add(M.steel, rbox(dw, 0.03, 0.02, 0.004, x, h / 2 - 0.015, z), rbox(dw, 0.03, 0.02, 0.004, x, -h / 2 + 0.015, z), rbox(0.03, h, 0.02, 0.004, x - dw / 2 + 0.015, 0, z), rbox(0.03, h, 0.02, 0.004, x + dw / 2 - 0.015, 0, z));
    kit.add(M.glass, box(dw - 0.05, h - 0.05, 0.005, x, 0, z));
    kit.add(M.steel, cyl(0.006, 0.12, 10, x - s * (dw / 2 - 0.04), 0, z + 0.03));
    for (const k of [-1, 1]) kit.add(M.steel, cyl(0.004, 0.02, 8, x - s * (dw / 2 - 0.04), k * 0.05, z + 0.02, HP));
  }
  kit.add(M.steel, cyl(0.012, 0.012, 14, 0.04, -h / 2 + 0.05, d + 0.024, HP));
  kit.add(M.dark, box(0.012, 0.002, 0.002, 0.04, -h / 2 + 0.05, d + 0.031));
  at.label(kit, 0.3, 0.05, 2000, L.plain('STERILE SUPPLIES', 'CHECK EXPIRY · RESTOCK WEEKLY', { bar: PALETTE.teal }), -0.2, h / 2 - 0.05, d + 0.0205);
  kit.build(g);
  g.userData.collider = null;
  return g;
}

// Floor pedal bin. Origin on the floor, centred.
export function biohazardBin({ seed } = {}) {
  const g = new THREE.Group(); g.name = 'biohazardBin';
  const kit = new Kit(), at = new Atlas('bioBin', 1024, 512);
  const W = 0.42, D = 0.38, H = 0.62;
  kit.add(M.orange, rbox(W, H - 0.06, D, 0.04, 0, (H - 0.06) / 2 + 0.01, 0));
  kit.add(M.rubber, rbox(W + 0.01, 0.03, D + 0.01, 0.01, 0, 0.015, 0));
  kit.add(paint(0xa8341a, 0.5), rbox(W + 0.01, 0.06, D + 0.01, 0.03, 0, H - 0.02, 0));
  kit.add(paint(0xb02818, 0.6), box(W - 0.02, 0.01, D - 0.02, 0, H - 0.055, 0));
  kit.add(M.black, rbox(0.16, 0.03, 0.08, 0.01, 0, 0.03, D / 2 + 0.03, -0.15, 0, 0));
  kit.add(M.steelDark, cyl(0.008, W - 0.06, 8, 0, H - 0.03, -D / 2 - 0.004, 0, 0, HP));
  at.label(kit, 0.32, 0.32, 1500, (ctx, pw, ph) => {
    ctx.fillStyle = PALETTE.yellow; rrect(ctx, 0, 0, pw, ph, 18); ctx.fill();
    bioSymbol(ctx, pw / 2, ph * 0.38, ph * 0.27, '#111');
    txt(ctx, 'BIOHAZARD', pw / 2, ph * 0.76, ph * 0.13, { color: '#111', w: 700 });
    txt(ctx, 'CLINICAL WASTE ONLY · INCINERATE', pw / 2, ph * 0.9, ph * 0.055, { color: '#111' });
  }, 0, 0.32, D / 2 + 0.0005);
  at.label(kit, 0.2, 0.03, 2000, L.brand(null, '#5a1a0a'), 0, 0.09, D / 2 + 0.0005);
  kit.build(g);
  g.userData.collider = { w: W, d: D };
  return g;
}

export function sharpsContainer() {
  const g = new THREE.Group(); g.name = 'sharpsContainer';
  const kit = new Kit(), at = new Atlas('sharpsWall', 512, 512);
  kit.add(M.white, rbox(0.17, 0.3, 0.012, 0.006, 0, 0, 0.006));
  for (const y of [-0.12, 0.12]) screwHead(kit, 0, y, 0.0125, HP, 0, 0, 0.003);
  kit.add(M.white, box(0.17, 0.02, 0.13, 0, -0.13, 0.065), box(0.02, 0.06, 0.13, -0.085, -0.11, 0.065), box(0.02, 0.06, 0.13, 0.085, -0.11, 0.065));
  sharpsBox(kit, at, 0, -0.12, 0.075, 1.1, 0);
  kit.build(g);
  g.userData.collider = null;
  return g;
}

// Origin on the wall at the bracket height minus half the body (centre of the cylinder).
export function fireExtinguisher({ type = 'CO2' } = {}) {
  const g = new THREE.Group(); g.name = 'fireExtinguisher';
  const kit = new Kit(), at = new Atlas('fireExt_' + type, 1024, 512);
  const r0 = 0.075, h = 0.52, z = 0.09, y0 = -h / 2;
  kit.add(M.red, lathe([[0.001, 0], [r0 - 0.01, 0], [r0, 0.012], [r0, h - 0.06], [r0 * 0.8, h - 0.015], [0.025, h]], 32, 0, y0, z));
  kit.add(M.black, cyl(r0 + 0.002, 0.02, 32, 0, y0 + 0.01, z));
  // valve, gauge, levers, pin
  kit.add(M.chrome, cyl(0.022, 0.05, 16, 0, y0 + h + 0.02, z));
  kit.add(M.black, rbox(0.03, 0.02, 0.15, 0.006, 0, y0 + h + 0.07, z + 0.01, 0.15, 0, 0), rbox(0.03, 0.016, 0.13, 0.006, 0, y0 + h + 0.045, z + 0.03, -0.05, 0, 0));
  kit.add(M.chrome, cyl(0.002, 0.05, 6, 0, y0 + h + 0.055, z - 0.005, 0, 0, HP));
  kit.add(M.yellow, tor(0.01, 0.002, 6, 12, TAU, 0.03, y0 + h + 0.055, z - 0.005, 0, HP, 0));
  kit.add(M.yellow, box(0.025, 0.035, 0.001, 0.04, y0 + h + 0.03, z - 0.005, 0, HP, 0));
  if (type !== 'CO2') { kit.add(M.chrome, cyl(0.018, 0.012, 20, 0.02, y0 + h + 0.025, z + 0.02, HP, 0, 0)); at.label(kit, 0.03, 0.03, 4000, (ctx, pw, ph) => { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(pw / 2, ph / 2, pw / 2, 0, TAU); ctx.fill(); ctx.fillStyle = '#2fae5a'; ctx.beginPath(); ctx.moveTo(pw / 2, ph / 2); ctx.arc(pw / 2, ph / 2, pw * 0.45, -2.4, -1.2); ctx.fill(); ctx.strokeStyle = '#c00'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(pw / 2, ph / 2); ctx.lineTo(pw * 0.8, ph * 0.25); ctx.stroke(); }, 0.02, y0 + h + 0.025, z + 0.0265); }
  // hose + horn / nozzle clipped on the side
  if (type === 'CO2') {
    kit.add(M.black, tube([[0, y0 + h + 0.03, z - 0.02], [-0.05, y0 + h - 0.02, z - 0.02], [-0.09, y0 + h - 0.2, z], [-0.085, y0 + h - 0.32, z + 0.02]], 0.009, 20, 8));
    kit.add(M.black, cone(0.045, 0.016, 0.2, 18, -0.095, y0 + h - 0.42, z + 0.02));
  } else {
    kit.add(M.black, tube([[0, y0 + h + 0.03, z - 0.02], [-0.06, y0 + h - 0.02, z - 0.03], [-0.09, y0 + h - 0.25, z], [-0.085, y0 + 0.08, z + 0.02]], 0.008, 20, 8));
  }
  // wall bracket
  kit.add(M.steelDark, rbox(0.06, 0.12, 0.01, 0.003, 0, y0 + h - 0.12, 0.005));
  kit.add(M.steelDark, box(0.04, 0.008, z - r0 + 0.01, 0, y0 + h - 0.1, (z - r0) / 2));
  kit.add(M.steelDark, tor(r0 + 0.004, 0.004, 4, 32, PI, 0, y0 + h - 0.2, z, HP, 0, 0));
  // labels
  at.label(kit, 0.11, 0.2, 2000, (ctx, pw, ph) => {
    ctx.fillStyle = '#f6f7f5'; ctx.fillRect(0, 0, pw, ph);
    ctx.fillStyle = type === 'CO2' ? '#111' : '#d9b81c'; ctx.fillRect(0, 0, pw, ph * 0.14);
    txt(ctx, type === 'CO2' ? 'CO2' : 'POWDER', pw / 2, ph * 0.07, ph * 0.09, { color: type === 'CO2' ? '#fff' : '#111', w: 700 });
    txt(ctx, 'FIRE', pw / 2, ph * 0.25, ph * 0.1, { w: 700 }); txt(ctx, 'EXTINGUISHER', pw / 2, ph * 0.35, ph * 0.075, { w: 700, maxW: pw * 0.9 });
    txt(ctx, type === 'CO2' ? '5 kg' : '6 kg', pw / 2, ph * 0.47, ph * 0.08, { color: '#c8191b', w: 700 });
    ctx.fillStyle = '#555'; for (let i = 0; i < 9; i++) ctx.fillRect(pw * 0.12, ph * (0.56 + i * 0.04), pw * (0.4 + (i % 3) * 0.15), ph * 0.012);
    txt(ctx, 'NEXT SERVICE 03/27', pw / 2, ph * 0.95, ph * 0.04, { color: '#222' });
  }, 0, y0 + h * 0.48, z + r0 + 0.0015);
  kit.build(g);
  g.userData.collider = null;
  return g;
}

export function eyewashStation() {
  const g = new THREE.Group(); g.name = 'eyewashStation';
  const kit = new Kit(), at = new Atlas('eyewash', 1024, 512);
  kit.add(M.steel, cyl(0.035, 0.012, 20, 0, -0.12, 0.006, HP));
  kit.add(M.steel, cyl(0.016, 0.16, 14, 0, -0.12, 0.08, HP));
  kit.add(M.steel, cyl(0.016, 0.18, 14, 0, -0.03, 0.16));
  // bowl
  kit.add(M.steel, lathe([[0.03, -0.06], [0.06, -0.05], [0.15, -0.01], [0.17, 0.02], [0.175, 0.025]], 32, 0, 0.06, 0.24));
  kit.add(M.steel, cyl(0.012, 0.15, 12, 0, -0.06, 0.24));
  // spray heads with yellow dust caps
  for (const s of [-1, 1]) {
    kit.add(M.chrome, cyl(0.012, 0.08, 12, s * 0.05, 0.08, 0.24));
    kit.add(M.yellow, cyl(0.03, 0.012, 20, s * 0.05, 0.125, 0.24), cyl(0.032, 0.006, 20, s * 0.05, 0.134, 0.24));
  }
  kit.add(M.chrome, cyl(0.009, 0.1, 10, 0, 0.08, 0.24, 0, 0, HP));
  // push flag
  kit.add(paint(0x1f9a4a, 0.4), rbox(0.14, 0.09, 0.01, 0.01, 0.18, 0.03, 0.34, -0.2, 0.3, 0));
  at.label(kit, 0.12, 0.07, 2500, (ctx, pw, ph) => { ctx.fillStyle = '#1f9a4a'; ctx.fillRect(0, 0, pw, ph); txt(ctx, 'PUSH', pw / 2, ph * 0.5, ph * 0.5, { color: '#fff', w: 700 }); }, 0.18 + Math.sin(0.3) * 0.006, 0.03, 0.34 + Math.cos(0.3) * 0.006, -0.2, 0.3, 0);
  kit.add(M.steel, cyl(0.005, 0.18, 8, 0.09, 0.03, 0.29, 0, 0.3, HP));
  // sign above
  kit.add(M.white, rbox(0.34, 0.2, 0.006, 0.004, 0, 0.42, 0.003));
  at.label(kit, 0.33, 0.19, 1500, (ctx, pw, ph) => {
    ctx.fillStyle = '#108a43'; rrect(ctx, 0, 0, pw, ph, 10); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(ph * 0.5, ph * 0.5, ph * 0.3, ph * 0.18, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#108a43'; ctx.beginPath(); ctx.arc(ph * 0.5, ph * 0.5, ph * 0.12, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = ph * 0.03; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(ph * (0.35 + i * 0.15), ph * 0.86); ctx.lineTo(ph * (0.4 + i * 0.1), ph * 0.72); ctx.stroke(); }
    txt(ctx, 'EMERGENCY', pw * 0.72, ph * 0.38, ph * 0.15, { color: '#fff', w: 700, maxW: pw * 0.48 });
    txt(ctx, 'EYE WASH', pw * 0.72, ph * 0.62, ph * 0.2, { color: '#fff', w: 700, maxW: pw * 0.48 });
  }, 0, 0.42, 0.0065);
  kit.build(g);
  g.userData.collider = null;
  return g;
}

export function wallPhone() {
  const g = new THREE.Group(); g.name = 'wallPhone';
  const kit = new Kit(), at = new Atlas('wallPhone', 512, 512);
  kit.add(M.greyGloss, rbox(0.17, 0.28, 0.06, 0.015, 0, 0, 0.03));
  kit.add(M.red, box(0.172, 0.03, 0.062, 0, 0.11, 0.03));
  at.label(kit, 0.16, 0.026, 3000, L.text('EMERGENCY · DIAL 41', { color: '#ffffff', size: 0.6 }), 0, 0.11, 0.0615);
  // handset in its cradle (left)
  kit.add(M.black, rbox(0.05, 0.2, 0.04, 0.018, -0.045, -0.01, 0.075));
  kit.add(M.black, rbox(0.06, 0.06, 0.05, 0.02, -0.045, 0.07, 0.08), rbox(0.06, 0.06, 0.05, 0.02, -0.045, -0.09, 0.08));
  kit.add(M.black, tube([[-0.045, -0.12, 0.08], [-0.05, -0.17, 0.08], [-0.03, -0.2, 0.06], [0.0, -0.17, 0.05], [0.02, -0.13, 0.062]], 0.004, 20, 5));
  for (let i = 0; i < 9; i++) kit.add(M.black, tor(0.008, 0.0025, 4, 10, TAU, -0.045, -0.13 - i * 0.008, 0.08, HP));
  // keypad (right)
  for (let i = 0; i < 12; i++) {
    const x = 0.03 + (i % 3) * 0.02, y = 0.06 - Math.floor(i / 3) * 0.022;
    kit.add(M.steel, rbox(0.016, 0.016, 0.006, 0.003, x, y, 0.062));
    at.label(kit, 0.01, 0.01, 6000, L.text('123456789*0#'[i], { color: '#222', size: 0.85 }), x, y, 0.0652);
  }
  kit.add(M.red, rbox(0.056, 0.022, 0.008, 0.004, 0.05, -0.04, 0.063));
  at.label(kit, 0.05, 0.016, 4000, L.text('SECURITY', { color: '#fff', size: 0.6 }), 0.05, -0.04, 0.0675);
  at.label(kit, 0.06, 0.03, 4000, L.lcd(['EXT 4400', 'WING C']), 0.05, -0.085, 0.0605, 0, 0, 0, at.glow);
  for (const y of [-0.12, 0.12]) screwHead(kit, 0.07, y, 0.0605, HP, 0, 0, 0.003);
  kit.build(g);
  g.userData.collider = null;
  return g;
}

export function firstAidBox() {
  const g = new THREE.Group(); g.name = 'firstAidBox';
  const kit = new Kit(), at = new Atlas('firstAid', 512, 512);
  kit.add(paint(0x1f8a4a, 0.35), rbox(0.36, 0.28, 0.12, 0.015, 0, 0, 0.06));
  kit.add(paint(0x23a055, 0.3), rbox(0.34, 0.26, 0.012, 0.008, 0, 0, 0.123));
  kit.add(M.white, rbox(0.04, 0.03, 0.02, 0.006, 0.13, 0, 0.134));
  for (const y of [-0.09, 0.09]) kit.add(M.steel, cyl(0.007, 0.03, 8, -0.172, y, 0.12));
  at.label(kit, 0.26, 0.2, 1500, (ctx, pw, ph) => { ctx.fillStyle = '#fff'; const c = ph * 0.22; ctx.fillRect(pw / 2 - c / 2, ph * 0.08, c, ph * 0.6); ctx.fillRect(pw / 2 - ph * 0.3, ph * 0.38 - c / 2, ph * 0.6, c); txt(ctx, 'FIRST AID', pw / 2, ph * 0.86, ph * 0.16, { color: '#fff', w: 700 }); }, -0.01, 0, 0.1295);
  kit.build(g);
  g.userData.collider = null;
  return g;
}

export function glovesDispenser() {
  const g = new THREE.Group(); g.name = 'glovesDispenser';
  const kit = new Kit(), at = new Atlas('gloves', 1024, 512);
  const W = 0.4, H = 0.42;
  kit.add(M.steel, rbox(W, H, 0.006, 0.006, 0, 0, 0.003));
  for (let i = 0; i < 3; i++) {
    const y = -H / 2 + 0.07 + i * 0.135;
    kit.add(M.steel, box(W - 0.02, 0.006, 0.1, 0, y - 0.045, 0.055));
    kit.add(M.steel, box(W - 0.02, 0.03, 0.004, 0, y - 0.03, 0.104));
    kit.add(M.white, box(0.24, 0.12, 0.09, 0, y + 0.02, 0.053));
    const col = ['#3a63c8', '#7a3ac8', '#2fae5a'][i], sz = ['M', 'L', 'S'][i];
    at.label(kit, 0.24, 0.085, 1800, (ctx, pw, ph) => { ctx.fillStyle = '#f6f7f5'; ctx.fillRect(0, 0, pw, ph); ctx.fillStyle = col; ctx.fillRect(0, 0, pw * 0.18, ph); txt(ctx, sz, pw * 0.09, ph * 0.5, ph * 0.6, { color: '#fff', w: 700 }); txt(ctx, 'NITRILE GLOVES', pw * 0.58, ph * 0.38, ph * 0.2, { w: 700, maxW: pw * 0.75 }); txt(ctx, 'POWDER FREE · 100', pw * 0.58, ph * 0.66, ph * 0.14, { color: '#444', maxW: pw * 0.75 }); }, 0, y + 0.02, 0.0985);
    kit.add(M.dark, box(0.08, 0.004, 0.03, 0, y + 0.0805, 0.06));
    kit.add(plastic(parseInt(col.slice(1), 16), 0.6), T(lumpy(new THREE.SphereGeometry(0.025, 10, 8).scale(1.2, 0.8, 0.7), 0.004, 60, i), 0, y + 0.09, 0.065));
  }
  kit.build(g);
  g.userData.collider = null;
  return g;
}

export function clipboardOnHook({ seed } = {}) {
  seed = seedOf(seed);
  const g = new THREE.Group(); g.name = 'clipboardOnHook';
  const kit = new Kit(), at = new Atlas('clipHook_' + (seed % 3), 512, 512);
  kit.add(M.chrome, cyl(0.012, 0.006, 14, 0, 0.17, 0.003, HP));
  kit.add(M.chrome, tube([[0, 0.17, 0.0], [0, 0.17, 0.03], [0, 0.185, 0.035]], 0.003, 8, 6));
  kit.push(0, 0, 0.012, -0.04, 0, 0.03);
  kit.add(M.teal, rbox(0.23, 0.32, 0.004, 0.008, 0, 0.0, 0));
  kit.add(M.chrome, rbox(0.1, 0.03, 0.01, 0.004, 0, 0.14, 0.006));
  kit.add(M.dark, tor(0.008, 0.002, 4, 10, TAU, 0, 0.165, 0.002));
  at.label(kit, 0.2, 0.28, 1500, (ctx, pw, ph) => {
    ctx.fillStyle = '#f7f7f2'; ctx.fillRect(0, 0, pw, ph);
    wordmark(ctx, pw * 0.06, ph * 0.08, ph * 0.03, PALETTE.teal);
    txt(ctx, 'INSPECTION LOG — CELL A', pw * 0.06, ph * 0.15, ph * 0.035, { align: 'left', w: 700 });
    ctx.strokeStyle = '#888'; ctx.lineWidth = 1;
    for (let i = 0; i < 14; i++) { const y = ph * (0.22 + i * 0.05); ctx.strokeRect(pw * 0.06, y, pw * 0.88, ph * 0.05); }
    const rr = rng(seed);
    ctx.strokeStyle = '#1a2a6a'; ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) { const y = ph * (0.245 + i * 0.05); ctx.beginPath(); ctx.moveTo(pw * 0.1, y); for (let x = 0.1; x < 0.5 + rr() * 0.3; x += 0.03) ctx.lineTo(pw * x, y + (rr() - 0.5) * 6); ctx.stroke(); ctx.beginPath(); ctx.moveTo(pw * 0.86, y); ctx.lineTo(pw * 0.88, y + 4); ctx.lineTo(pw * 0.92, y - 5); ctx.stroke(); }
    ctx.strokeStyle = '#b01010'; ctx.beginPath(); ctx.moveTo(pw * 0.1, ph * 0.7); ctx.lineTo(pw * 0.7, ph * 0.69); ctx.stroke();
  }, 0, -0.015, 0.0025);
  kit.pop();
  kit.build(g);
  g.userData.collider = null;
  return g;
}

// ================================================================== HAZMAT RACK (origin on the floor at the wall)
function hazmatSuit(kit, x, seed) {
  const r = rng(seed), y0 = 0.3;
  const fold = (geo, a) => lumpy(geo, a, 22, Math.floor(r() * 1e6));
  // torso
  kit.add(M.hazmat, T(fold(new THREE.CylinderGeometry(0.2, 0.17, 0.62, 18, 8).scale(1, 1, 0.55), 0.012), x, y0 + 0.95, 0.15));
  // shoulders + hood with visor
  kit.add(M.hazmat, T(fold(new THREE.SphereGeometry(0.21, 18, 10, 0, TAU, 0, HP).scale(1, 0.4, 0.55), 0.008), x, y0 + 1.26, 0.15));
  kit.add(M.hazmat, T(fold(new THREE.SphereGeometry(0.14, 18, 14).scale(1, 1.2, 1), 0.01), x, y0 + 1.47, 0.16));
  kit.add(M.glass, T(new THREE.SphereGeometry(0.135, 18, 10, -0.9, 1.8, 1.0, 0.9).scale(1, 1.2, 1.05), x, y0 + 1.47, 0.165));
  kit.add(M.black, T(new THREE.TorusGeometry(0.1, 0.006, 4, 24).scale(1, 0.75, 1), x, y0 + 1.47, 0.29));
  // sleeves + gloves (black rubber), taped cuffs
  for (const s of [-1, 1]) {
    kit.add(M.hazmat, fold(tube([[x + s * 0.2, y0 + 1.22, 0.15], [x + s * 0.24, y0 + 1.0, 0.16], [x + s * 0.24, y0 + 0.8, 0.17]], 0.055, 12, 10), 0.008));
    kit.add(M.midGrey, cyl(0.056, 0.04, 12, x + s * 0.24, y0 + 0.78, 0.17));
    kit.add(M.black, T(fold(new THREE.SphereGeometry(0.05, 10, 8).scale(0.8, 1.6, 0.6), 0.005), x + s * 0.24, y0 + 0.7, 0.17));
    // legs + boots
    kit.add(M.hazmat, T(fold(new THREE.CylinderGeometry(0.085, 0.08, 0.5, 12, 6), 0.01), x + s * 0.085, y0 + 0.41, 0.15));
    kit.add(M.midGrey, cyl(0.082, 0.04, 12, x + s * 0.085, y0 + 0.17, 0.15));
    kit.add(M.black, rbox(0.1, 0.16, 0.14, 0.03, x + s * 0.085, y0 + 0.08, 0.17));
  }
  kit.add(M.hazmat, T(fold(new THREE.CylinderGeometry(0.17, 0.18, 0.16, 16, 3).scale(1, 1, 0.6), 0.008), x, y0 + 0.62, 0.15));
  // zip flap + chest patch
  kit.add(M.hazmat, box(0.04, 0.5, 0.01, x + 0.03, y0 + 0.98, 0.265));
}
export function hazmatRack({ suits = 3, seed } = {}) {
  seed = seedOf(seed);
  const g = new THREE.Group(); g.name = 'hazmatRack';
  const kit = new Kit(), at = new Atlas('hazmat_' + suits, 1024, 512);
  const W = 0.62 * suits + 0.3, barY = 1.95;
  for (const s of [-1, 1]) { kit.add(M.steel, rbox(0.04, 0.18, 0.01, 0.004, s * (W / 2 - 0.05), barY, 0.005)); kit.add(M.steel, box(0.02, 0.02, 0.26, s * (W / 2 - 0.05), barY, 0.13)); }
  kit.add(M.steel, cyl(0.016, W - 0.06, 16, 0, barY, 0.25, 0, 0, HP));
  // boot/drip tray on the floor
  kit.add(M.steel, box(W, 0.012, 0.42, 0, 0.006, 0.21));
  for (const s of [-1, 1]) kit.add(M.steel, box(W, 0.04, 0.006, 0, 0.02, 0.21 + s * 0.207));
  for (let i = 0; i < suits; i++) {
    const x = -W / 2 + 0.3 + i * 0.62;
    // hanger
    kit.add(M.black, tor(0.025, 0.004, 6, 12, PI * 1.3, x, barY + 0.005, 0.25, 0, HP, -0.3));
    kit.add(M.steelDark, cyl(0.003, 0.3, 6, x, barY - 0.15, 0.25));
    kit.add(M.black, tube([[x - 0.2, 1.58, 0.15], [x - 0.1, 1.62, 0.17], [x, 1.66, 0.2], [x + 0.1, 1.62, 0.17], [x + 0.2, 1.58, 0.15]], 0.007, 12, 6));
    kit.add(M.black, cyl(0.008, 0.06, 8, x, 1.68, 0.21));
    hazmatSuit(kit, x, seed + i * 31);
    at.label(kit, 0.1, 0.05, 2500, L.plain('SUIT ' + String.fromCharCode(65 + i), 'SIZE L · LEVEL A', { bg: '#ffffff' }), x - 0.08, 1.12, 0.256 + 0.03, -0.0, 0, 0);
    // respirator on a hook between suits
    if (i < suits - 1) {
      const rx = x + 0.31, ry = 1.45;
      kit.add(M.chrome, cyl(0.006, 0.06, 8, rx, ry + 0.06, 0.03, HP));
      kit.add(M.black, T(new THREE.SphereGeometry(0.06, 16, 10, 0, TAU, 0, HP).scale(1.1, 1.0, 0.9).rotateX(HP), rx, ry, 0.08));
      for (const s of [-1, 1]) { kit.add(M.magenta, cyl(0.035, 0.03, 18, rx + s * 0.065, ry - 0.02, 0.1, 0.4, 0, s * 0.5)); kit.add(M.black, tor(0.035, 0.004, 4, 18, TAU, rx + s * 0.06, ry - 0.02, 0.09, HP + 0.4, 0, s * 0.5)); }
      kit.add(M.black, tube([[rx - 0.06, ry + 0.02, 0.05], [rx - 0.03, ry + 0.06, 0.03], [rx, ry + 0.065, 0.035], [rx + 0.03, ry + 0.06, 0.03], [rx + 0.06, ry + 0.02, 0.05]], 0.005, 12, 5));
    }
  }
  kit.add(M.white, rbox(0.5, 0.14, 0.006, 0.004, 0, 2.2, 0.003));
  at.label(kit, 0.49, 0.13, 1500, L.warn('LEVEL A PPE', 'DON & DOFF IN AIRLOCK ONLY · BUDDY CHECK'), 0, 2.2, 0.0065);
  kit.build(g);
  g.userData.collider = { w: W, d: 0.45 };
  return g;
}

// ================================================================== GAS CYLINDERS (origin on the floor at the wall)
export function gasCylinders({ seed } = {}) {
  const g = new THREE.Group(); g.name = 'gasCylinders';
  const kit = new Kit(), at = new Atlas('gasCyl', 1024, 1024);
  const gases = [['NITROGEN', 0x2b2f33, 0x1a1c1e, 'N2'], ['CARBON DIOXIDE', 0x8d949a, 0x6b7075, 'CO2'], ['ARGON', 0x8d949a, 0x1f6b3a, 'Ar']];
  const R0 = 0.115, H = 1.45, zc = 0.16;
  // wall rail, brackets
  kit.add(M.steel, box(0.9, 0.06, 0.012, 0, 1.15, 0.006), box(0.9, 0.06, 0.012, 0, 0.55, 0.006));
  kit.add(M.steel, box(0.9, 0.012, 0.3, 0, 0.006, 0.15));
  gases.forEach(([name, body, shoulder, short], i) => {
    const x = (i - 1) * 0.28;
    kit.add(paint(body, 0.45, 0.4), lathe([[0.001, 0], [R0 - 0.02, 0], [R0, 0.03], [R0, H - 0.25], [R0 * 0.97, H - 0.2]], 28, x, 0.012, zc));
    kit.add(paint(shoulder, 0.4, 0.4), lathe([[R0 * 0.97, H - 0.2], [R0 * 0.8, H - 0.1], [0.05, H - 0.04], [0.035, H]], 28, x, 0.012, zc));
    kit.add(M.brass, cyl(0.03, 0.08, 14, x, H + 0.05, zc));
    kit.add(M.brass, cyl(0.014, 0.06, 10, x, H + 0.06, zc + 0.04, HP));
    kit.add(M.black, cyl(0.035, 0.02, 16, x, H + 0.1, zc));
    // regulator with two gauges
    kit.add(M.chrome, rbox(0.06, 0.06, 0.05, 0.012, x, H + 0.06, zc + 0.09));
    for (const s of [-1, 1]) {
      kit.add(M.chrome, cyl(0.03, 0.025, 20, x + s * 0.045, H + 0.1, zc + 0.11, HP));
      at.label(kit, 0.05, 0.05, 3000, (ctx, pw, ph) => { ctx.fillStyle = '#f7f7f2'; ctx.beginPath(); ctx.arc(pw / 2, ph / 2, pw / 2, 0, TAU); ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 2; for (let k = 0; k <= 12; k++) { const a = PI * 0.75 + (k / 12) * PI * 1.5; ctx.beginPath(); ctx.moveTo(pw / 2 + Math.cos(a) * pw * 0.36, ph / 2 + Math.sin(a) * ph * 0.36); ctx.lineTo(pw / 2 + Math.cos(a) * pw * 0.44, ph / 2 + Math.sin(a) * ph * 0.44); ctx.stroke(); } ctx.strokeStyle = '#c8191b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(pw / 2, ph / 2, pw * 0.4, PI * 1.9, PI * 2.25); ctx.stroke(); ctx.strokeStyle = '#111'; ctx.beginPath(); ctx.moveTo(pw / 2, ph / 2); const a = PI * (s < 0 ? 1.6 : 2.1); ctx.lineTo(pw / 2 + Math.cos(a) * pw * 0.38, ph / 2 + Math.sin(a) * ph * 0.38); ctx.stroke(); txt(ctx, s < 0 ? 'bar' : 'kPa', pw / 2, ph * 0.72, ph * 0.12, { color: '#333' }); }, x + s * 0.045, H + 0.1, zc + 0.1236);
      kit.add(M.glass, cyl(0.026, 0.004, 20, x + s * 0.045, H + 0.1, zc + 0.124, HP));
    }
    kit.add(M.black, rbox(0.03, 0.03, 0.03, 0.01, x, H + 0.02, zc + 0.12));
    kit.add(M.cableBlue, tube([[x, H + 0.0, zc + 0.13], [x + 0.02, H - 0.1, zc + 0.16], [x + 0.1, H - 0.05, zc + 0.08], [x + 0.12, 1.2, 0.04], [x + 0.12, 1.3, 0.01]], 0.006, 20, 6));
    // wrap label + diamond + status tag
    at.label(kit, 0.16, 0.2, 1500, (ctx, pw, ph) => {
      ctx.fillStyle = '#f6f7f5'; ctx.fillRect(0, 0, pw, ph);
      ctx.fillStyle = PALETTE.teal; ctx.fillRect(0, 0, pw, ph * 0.12); txt(ctx, 'HALVERSEN GAS', pw / 2, ph * 0.06, ph * 0.07, { color: '#fff', w: 700 });
      txt(ctx, short, pw / 2, ph * 0.26, ph * 0.16, { w: 700 }); txt(ctx, name, pw / 2, ph * 0.4, ph * 0.075, { w: 700, maxW: pw * 0.9 });
      txt(ctx, 'COMPRESSED · 200 bar', pw / 2, ph * 0.49, ph * 0.055, { color: '#333' });
      ctx.save(); ctx.translate(pw / 2, ph * 0.72); ctx.rotate(PI / 4); ctx.fillStyle = '#1f9a4a'; ctx.fillRect(-ph * 0.11, -ph * 0.11, ph * 0.22, ph * 0.22); ctx.restore();
      txt(ctx, '2', pw / 2, ph * 0.76, ph * 0.08, { color: '#fff', w: 700 }); txt(ctx, 'NON-FLAMMABLE', pw / 2, ph * 0.66, ph * 0.035, { color: '#fff' });
      barcode(ctx, pw * 0.1, ph * 0.9, pw * 0.8, ph * 0.07, i * 7 + 3);
    }, x, 0.95, zc + R0 + 0.002);
    kit.add(paint([0x2fae5a, 0xe0b020, 0xc8191b][i], 0.5), box(0.06, 0.09, 0.002, x + 0.05, H - 0.12, zc + 0.1, 0.5, 0.3, 0.2));
    // chains (two per cylinder)
    for (const cy of [1.15, 0.55]) {
      const n = 22;
      for (let k = 0; k < n; k++) {
        const a = PI + (k / (n - 1)) * PI, cxp = x + Math.cos(a) * (R0 + 0.008), czp = zc - Math.sin(a) * (R0 + 0.008);
        kit.add(M.steelDark, tor(0.009, 0.0022, 4, 8, TAU, cxp, cy, czp, k % 2 ? HP : 0, -a + HP, 0));
      }
      kit.add(M.steel, box(0.03, 0.03, zc - 0.006, x - R0, cy, zc / 2), box(0.03, 0.03, zc - 0.006, x + R0, cy, zc / 2));
    }
  });
  at.label(kit, 0.4, 0.1, 1500, L.warn('COMPRESSED GAS', 'SECURE CYLINDERS WITH CHAINS AT ALL TIMES'), 0, 1.65, 0.0125);
  kit.add(M.white, rbox(0.41, 0.11, 0.006, 0.004, 0, 1.65, 0.009));
  kit.build(g);
  g.userData.collider = { w: 0.86, d: 0.32 };
  return g;
}
