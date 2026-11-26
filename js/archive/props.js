// The Archive (Chapter Three) props: archive boxes and shelving, mobile shelving carriages, the card
// catalogue, a microfiche reader, a 35 mm projector and theatre seating. Uses the Wing D kit's materials.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const PI = Math.PI, HP = PI / 2, TAU = PI * 2;
let M = {};
const fb = {};
const mat = (k, color = 0x777777) => M[k] || (fb[k] ??= new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
export function useArchiveMaterials(materials) { M = materials || {}; }
function rng(seed = 1) { let s = (seed * 2654435761) >>> 0 || 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

class Parts {
  constructor() { this.map = new Map(); }
  add(m, g) { if (!this.map.has(m)) this.map.set(m, []); const gg = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(gg.attributes)) if (!['position', 'normal', 'uv'].includes(k)) gg.deleteAttribute(k); this.map.get(m).push(gg); return gg; }
  box(m, x, y, z, sx, sy, sz, ry = 0) { const g = new THREE.BoxGeometry(sx, sy, sz); if (ry) g.rotateY(ry); g.translate(x, y, z); return this.add(m, g); }
  bb(m, x0, y0, z0, x1, y1, z1) { return this.box(m, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0); }
  cyl(m, a, b, r, seg = 16) { const d = new THREE.Vector3().subVectors(b, a), len = d.length(); const g = new THREE.CylinderGeometry(r, r, len, seg); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize())); g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); return this.add(m, g); }
  build(group = new THREE.Group(), { uvTile = 0 } = {}) {
    for (const [m, geos] of this.map) {
      const g = mergeGeometries(geos, false);
      if (uvTile) boxUV(g, uvTile);
      const mesh = new THREE.Mesh(g, m); mesh.castShadow = !m.transparent; mesh.receiveShadow = true; group.add(mesh);
    }
    return group;
  }
}
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
function canvas(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); draw(x, w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.userData.canvas = c; return t; }

// ------------------------------------------------------------------ archive boxes (one shared atlas: 6 label fronts, a side, a lid)
const LABELS = [['SITE 41', 'PERSONNEL', '1998–2003'], ['C-14', 'OBS. LOGS', 'VOL. 7'], ['HALVERSEN', 'ESTATES', 'LEASES'], ['WING C', 'PROCUREMENT', '2016'], ['ADIT 2', 'SURVEY', '2019'], ['SITE 41', 'INCIDENTS', 'RESTRICTED']];
let boxMat = null;
function archiveBoxMaterial() {
  if (boxMat) return boxMat;
  const W = 1024, H = 512;
  const tex = canvas(W, H, (c) => {
    const cw = W / 4, ch = H / 2;
    for (let k = 0; k < 8; k++) {
      const x0 = (k % 4) * cw, y0 = Math.floor(k / 4) * ch;
      const base = ['#b39a72', '#a98f68', '#b8a07a', '#a48a62'][k % 4];
      c.fillStyle = base; c.fillRect(x0, y0, cw, ch);
      for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(${Math.random() < 0.5 ? '60,45,25' : '230,210,170'},${Math.random() * 0.08})`; c.fillRect(x0 + Math.random() * cw, y0 + Math.random() * ch, 2 + Math.random() * 6, 1 + Math.random() * 2); }
      c.fillStyle = 'rgba(70,50,30,0.25)'; c.fillRect(x0, y0 + ch * 0.92, cw, ch * 0.08); // shelf grime at the bottom
      if (k < 6) {
        const [a, b2, d] = LABELS[k];
        c.fillStyle = '#ece6d2'; c.fillRect(x0 + cw * 0.14, y0 + ch * 0.18, cw * 0.72, ch * 0.5);
        c.strokeStyle = '#555'; c.lineWidth = 2; c.strokeRect(x0 + cw * 0.14, y0 + ch * 0.18, cw * 0.72, ch * 0.5);
        c.fillStyle = '#222'; c.textAlign = 'center'; c.font = 'bold 24px monospace'; c.fillText(a, x0 + cw / 2, y0 + ch * 0.32);
        c.font = '20px monospace'; c.fillText(b2, x0 + cw / 2, y0 + ch * 0.45); c.fillText(d, x0 + cw / 2, y0 + ch * 0.58);
        c.fillStyle = 'rgba(20,20,20,0.85)'; c.beginPath(); c.arc(x0 + cw / 2, y0 + ch * 0.8, 10, 0, TAU); c.fill(); // hand hole
      } else if (k === 7) { c.strokeStyle = 'rgba(60,40,20,0.5)'; c.lineWidth = 3; c.strokeRect(x0 + 6, y0 + 6, cw - 12, ch - 12); }
    }
  });
  boxMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
  return boxMat;
}
// a box geometry with uvs into the atlas: front (+z) gets a label cell, top the lid cell, the rest the plain side
function boxGeo(w, h, d, label) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, cell = (k) => [(k % 4) / 4, 1 - (Math.floor(k / 4) + 1) / 2];
  // faces: +x, -x, +y, -y, +z, -z (4 verts each)
  const faceCell = [6, 6, 7, 6, label, 6];
  for (let f = 0; f < 6; f++) {
    const [u0, v0] = cell(faceCell[f]);
    for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, u0 + uv.getX(i) * 0.25, v0 + uv.getY(i) * 0.5); }
  }
  return g;
}

// ------------------------------------------------------------------ steel archive shelving, filled (long axis X, faces ±Z)
export function shelfUnit({ length = 4, height = 2.4, depth = 0.45, shelves = 6, seed = 1, fill = 0.85, double = true, mess = 0 } = {}) {
  const r = rng(seed);
  const P = new Parts();
  const steel = mat('steelPaint', 0xb7b9b3), boxes = archiveBoxMaterial();
  const D = double ? depth * 2 : depth;
  for (let x = -length / 2; x <= length / 2 + 1e-3; x += length / Math.round(length / 1.0)) for (const z of [-D / 2, D / 2]) P.bb(steel, x - 0.02, 0, z - 0.02, x + 0.02, height, z + 0.02);
  const levels = [];
  for (let k = 0; k < shelves; k++) { const y = 0.08 + k * ((height - 0.2) / (shelves - 1)); levels.push(y); P.bb(steel, -length / 2, y, -D / 2, length / 2, y + 0.02, D / 2); }
  for (const z of [-D / 2, D / 2]) P.bb(steel, -length / 2, height - 0.05, z - 0.01, length / 2, height, z + 0.01);
  const back = (x0, x1, y0, y1) => P.bb(steel, x0, y0, -0.005, x1, y1, 0.005);
  if (double) back(-length / 2, length / 2, 0.08, height - 0.1);
  const step = levels[1] - levels[0];
  for (const side of double ? [1, -1] : [1]) for (let k = 0; k < shelves - 1; k++) {
    let x = -length / 2 + 0.03;
    while (x < length / 2 - 0.35) {
      const w = 0.3 + r() * 0.12, h = Math.min(step - 0.06, 0.26 + r() * 0.08), d = depth - 0.05;
      if (r() < fill) {
        const g = boxGeo(w, h, d, Math.floor(r() * 6));
        if (side < 0) g.rotateY(PI);
        const pull = r() < 0.12 + mess ? r() * 0.12 : 0;
        g.rotateY((r() - 0.5) * 0.06 + (r() < mess ? (r() - 0.5) * 0.6 : 0));
        g.translate(x + w / 2, levels[k] + 0.02 + h / 2, side * (d / 2 + 0.01 + pull));
        P.add(boxes, g);
      }
      x += w + 0.015 + (r() < 0.1 ? 0.2 : 0);
    }
  }
  const grp = P.build(new THREE.Group());
  grp.userData.collider = { w: length + 0.05, d: D + 0.05 };
  grp.userData.levels = levels;
  return grp;
}

// ------------------------------------------------------------------ a mobile shelving carriage (long axis X), with a crank wheel at +X
export function mobileUnit({ length = 6, seed = 1, target = false } = {}) {
  const g = shelfUnit({ length, height: 2.5, depth: 0.42, shelves: 6, seed, fill: 0.9 });
  const P = new Parts();
  const panel = mat('greenPaint', 0x3f5a48), dark = mat('steelDark', 0x333333);
  P.bb(panel, length / 2, 0, -0.45, length / 2 + 0.06, 2.55, 0.45); // end panel
  P.bb(panel, -length / 2 - 0.06, 0, -0.45, -length / 2, 2.55, 0.45);
  P.bb(dark, -length / 2, 0, -0.44, length / 2, 0.07, 0.44); // base carriage
  P.build(g);
  const wheel = new THREE.Group(); wheel.position.set(length / 2 + 0.1, 1.15, 0);
  const W = new Parts();
  W.add(dark, new THREE.TorusGeometry(0.2, 0.018, 8, 28).rotateY(HP));
  for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU; W.box(dark, 0, Math.sin(a) * 0.1, Math.cos(a) * 0.1, 0.02, 0.2, 0.02); }
  W.cyl(dark, V(-0.08, 0, 0), V(0.02, 0, 0), 0.03, 10);
  W.cyl(mat('redPaint', 0xa3150f), V(0.02, 0.17, 0.08), V(0.1, 0.17, 0.08), 0.022, 8); // handle
  W.build(wheel);
  g.add(wheel);
  // end-panel label holder (redrawn with the unit number)
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.16), new THREE.MeshStandardMaterial({ roughness: 0.7 }));
  tag.position.set(length / 2 + 0.065, 1.75, 0); tag.rotation.y = HP; g.add(tag);
  g.userData.wheel = wheel; g.userData.tag = tag;
  g.userData.collider = null;
  return g;
}
export function labelTag(mesh, text, sub = '') {
  const t = canvas(256, 128, (c, w, h) => { c.fillStyle = '#e8e2cc'; c.fillRect(0, 0, w, h); c.strokeStyle = '#333'; c.lineWidth = 4; c.strokeRect(3, 3, w - 6, h - 6); c.fillStyle = '#111'; c.textAlign = 'center'; c.font = 'bold 54px monospace'; c.fillText(text, w / 2, h * 0.55); c.font = '20px monospace'; c.fillText(sub, w / 2, h * 0.85); });
  mesh.material.map = t; mesh.material.needsUpdate = true;
}

// ------------------------------------------------------------------ chain-link cage panel (long axis X), height h
export function cagePanel({ length = 4, h = 2.6 } = {}) {
  const g = new THREE.Group();
  const P = new Parts();
  const frame = mat('galvanized', 0x9a9fa2);
  for (let x = -length / 2; x <= length / 2 + 1e-3; x += length / Math.max(1, Math.round(length / 1.5))) P.bb(frame, x - 0.025, 0, -0.025, x + 0.025, h, 0.025);
  P.bb(frame, -length / 2, h - 0.04, -0.02, length / 2, h, 0.02); P.bb(frame, -length / 2, 0.05, -0.02, length / 2, 0.09, 0.02);
  P.build(g);
  const meshM = M.cage || new THREE.MeshStandardMaterial({ color: 0x333333, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
  const plane = new THREE.PlaneGeometry(length, h - 0.1); plane.translate(0, h / 2, 0);
  const uv = plane.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * length * 6, uv.getY(i) * (h - 0.1) * 6);
  const mesh = new THREE.Mesh(plane, meshM); mesh.castShadow = true; g.add(mesh);
  if (meshM.alphaMap) { meshM.alphaMap.wrapS = meshM.alphaMap.wrapT = THREE.RepeatWrapping; }
  return g;
}

// ------------------------------------------------------------------ card catalogue: a wooden cabinet of small drawers (front +Z)
export function cardCatalogue({ cols = 6, rows = 8 } = {}) {
  const g = new THREE.Group();
  const W = cols * 0.14 + 0.08, H = rows * 0.11 + 0.12, D = 0.48;
  const P = new Parts();
  const wood = mat('timber', 0x7a5a3a);
  P.bb(wood, -W / 2, 0.7, -D / 2, W / 2, 0.7 + H, D / 2);
  for (const x of [-W / 2 + 0.04, W / 2 - 0.04]) for (const z of [-D / 2 + 0.04, D / 2 - 0.04]) P.bb(wood, x - 0.03, 0, z - 0.03, x + 0.03, 0.7, z + 0.03);
  P.build(g, { uvTile: 0.6 });
  const face = canvas(512, Math.round(512 * H / W), (c, w, h) => {
    c.fillStyle = '#6b4a2c'; c.fillRect(0, 0, w, h);
    const cw = w / cols, ch = h / rows;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x = i * cw, y = j * ch;
      const gr = c.createLinearGradient(x, y, x, y + ch); gr.addColorStop(0, '#8a6440'); gr.addColorStop(1, '#5c3f24'); c.fillStyle = gr; c.fillRect(x + 3, y + 3, cw - 6, ch - 6);
      c.fillStyle = '#e8e0c8'; c.fillRect(x + cw * 0.25, y + ch * 0.2, cw * 0.5, ch * 0.22);
      c.fillStyle = '#222'; c.font = `${Math.round(ch * 0.16)}px monospace`; c.textAlign = 'center'; c.fillText(String.fromCharCode(65 + ((j * cols + i) % 26)) + (j * cols + i), x + cw / 2, y + ch * 0.37);
      c.fillStyle = '#b8a070'; c.beginPath(); c.arc(x + cw / 2, y + ch * 0.68, ch * 0.1, 0, TAU); c.fill();
    }
  });
  const front = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.02, H - 0.02), new THREE.MeshStandardMaterial({ map: face, roughness: 0.6 }));
  front.position.set(0, 0.7 + H / 2, D / 2 + 0.002); g.add(front);
  // one drawer pulled out, cards fanned
  const dr = new Parts(); dr.bb(wood, -0.06, 0, 0, 0.06, 0.09, 0.42); for (let k = 0; k < 14; k++) dr.bb(mat('paper', 0xe6e2d6), -0.055, 0.01, 0.05 + k * 0.025, 0.055, 0.085 + (k % 3) * 0.004, 0.052 + k * 0.025);
  const drawer = dr.build(new THREE.Group()); drawer.position.set(-W / 2 + 0.04 + 2.5 * 0.14, 0.7 + 0.06 + 3 * 0.11, D / 2 - 0.1); g.add(drawer);
  g.userData.collider = { w: W, d: D + 0.3 };
  return g;
}

// ------------------------------------------------------------------ a microfiche reader on a desk (front +Z); its screen is a canvas you redraw
export function ficheReader() {
  const g = new THREE.Group();
  const P = new Parts();
  const beige = new THREE.MeshStandardMaterial({ color: 0xcfc6ad, roughness: 0.6 }), dark = mat('plasticBlack', 0x1b1c1e);
  P.bb(mat('timber', 0x7a5a3a), -0.8, 0.72, -0.4, 0.8, 0.76, 0.4); // desk top
  for (const x of [-0.75, 0.75]) for (const z of [-0.35, 0.35]) P.bb(mat('steelDark', 0x333333), x - 0.02, 0, z - 0.02, x + 0.02, 0.72, z + 0.02);
  P.bb(beige, -0.3, 0.76, -0.3, 0.3, 0.86, 0.25); // base + carrier
  P.bb(beige, -0.32, 0.86, -0.32, 0.32, 1.42, -0.12); // hood
  P.bb(dark, -0.2, 0.86, 0.02, 0.2, 0.9, 0.22); // fiche carrier glass plate
  P.bb(beige, 0.24, 0.8, 0.1, 0.3, 0.84, 0.18); // focus knob housing
  P.build(g);
  const scrCanvas = document.createElement('canvas'); scrCanvas.width = 512; scrCanvas.height = 400;
  const tex = new THREE.CanvasTexture(scrCanvas); tex.colorSpace = THREE.SRGBColorSpace;
  const scrMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0, roughness: 0.35 });
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.4), scrMat); scr.position.set(0, 1.15, -0.115); scr.rotation.x = -0.12; g.add(scr);
  g.userData = { screen: { canvas: scrCanvas, ctx: scrCanvas.getContext('2d'), tex, mat: scrMat }, collider: { w: 1.6, d: 0.8 } };
  return g;
}

// ------------------------------------------------------------------ a 35 mm projector on a pedestal (lens toward -Z)
export function projector() {
  const g = new THREE.Group();
  const P = new Parts();
  const grey = new THREE.MeshStandardMaterial({ color: 0x4a5450, roughness: 0.55, metalness: 0.4 }), dark = mat('steelDark', 0x333333);
  P.bb(dark, -0.3, 0, -0.3, 0.3, 0.9, 0.3); // pedestal
  P.bb(grey, -0.25, 0.9, -0.45, 0.25, 1.4, 0.35); // lamphouse + head
  P.bb(grey, -0.18, 1.4, -0.3, 0.18, 1.55, 0.2);
  P.cyl(dark, V(0, 1.18, -0.45), V(0, 1.18, -0.72), 0.07, 18); // lens barrel
  P.cyl(grey, V(0.26, 1.25, 0.25), V(0.26, 1.5, 0.25), 0.03, 8); // chimney
  for (const [y, z] of [[1.95, -0.2], [1.95, 0.4]]) { // reel arms
    P.bb(dark, -0.015, 1.5, z - 0.015, 0.015, y, z + 0.015);
  }
  P.build(g);
  const reels = [];
  for (const [y, z] of [[1.95, -0.2], [1.95, 0.4]]) {
    const reel = new THREE.Group(); reel.position.set(0, y, z);
    const R2 = new Parts(); R2.add(grey, new THREE.CylinderGeometry(0.3, 0.3, 0.05, 32).rotateZ(HP)); R2.add(dark, new THREE.CylinderGeometry(0.22, 0.22, 0.052, 32).rotateZ(HP));
    for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU; R2.add(new THREE.MeshStandardMaterial({ color: 0x050505 }), new THREE.CylinderGeometry(0.05, 0.05, 0.056, 12).rotateZ(HP).translate(0, Math.sin(a) * 0.15, Math.cos(a) * 0.15)); }
    R2.build(reel); reel.visible = false; g.add(reel); reels.push(reel);
  }
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.06, 18), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xfff2d8, emissiveIntensity: 0 }));
  lens.position.set(0, 1.18, -0.725); lens.rotation.y = PI; g.add(lens);
  g.userData = { reels, lens, collider: { w: 0.7, d: 0.8 } };
  return g;
}

// ------------------------------------------------------------------ a row of folding wooden theatre seats (long axis X, facing -Z)
export function seatRow({ length = 6, seed = 1, broken = 0.1 } = {}) {
  const r = rng(seed);
  const P = new Parts();
  const wood = mat('plank', 0x6a4e34), iron = mat('steelDark', 0x333333);
  const n = Math.floor(length / 0.55);
  for (let i = 0; i <= n; i++) { const x = -length / 2 + i * (length / n); P.bb(iron, x - 0.025, 0, -0.25, x + 0.025, 0.75, 0.05); }
  for (let i = 0; i < n; i++) {
    const x = -length / 2 + (i + 0.5) * (length / n);
    const up = r() < 0.6, gone = r() < broken;
    if (gone) continue;
    if (up) P.box(wood, x, 0.45, -0.08, 0.46, 0.38, 0.03, 0); else P.box(wood, x, 0.43, -0.22, 0.46, 0.03, 0.36, 0);
    P.box(wood, x, 0.72, 0.03, 0.46, 0.42, 0.03, (r() - 0.5) * 0.06);
  }
  return P.build(new THREE.Group(), { uvTile: 0.9 });
}

// ------------------------------------------------------------------ Lind's ID badge on a lanyard (lying flat)
export function idBadge() {
  const g = new THREE.Group();
  const t = canvas(256, 384, (c, w, h) => {
    c.fillStyle = '#f0eee8'; c.fillRect(0, 0, w, h); c.fillStyle = '#0e3a5c'; c.fillRect(0, 0, w, h * 0.18);
    c.fillStyle = '#fff'; c.font = 'bold 26px sans-serif'; c.textAlign = 'center'; c.fillText('HALVERSEN', w / 2, h * 0.11);
    c.fillStyle = '#9aa4ad'; c.fillRect(w * 0.25, h * 0.24, w * 0.5, h * 0.36); // photo, scratched out
    c.strokeStyle = '#3a2a1a'; c.lineWidth = 3; for (let i = 0; i < 18; i++) { c.beginPath(); c.moveTo(w * 0.25 + Math.random() * w * 0.5, h * 0.24 + Math.random() * h * 0.36); c.lineTo(w * 0.25 + Math.random() * w * 0.5, h * 0.24 + Math.random() * h * 0.36); c.stroke(); }
    c.fillStyle = '#111'; c.font = 'bold 30px sans-serif'; c.fillText('LIND, T.', w / 2, h * 0.7); c.font = '20px monospace'; c.fillText('C-14 · LEAD', w / 2, h * 0.78); c.fillText('SITE 41 · ALL AREAS', w / 2, h * 0.85);
  });
  const card = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.002, 0.085), new THREE.MeshStandardMaterial({ map: t, roughness: 0.4 }));
  card.position.y = 0.002; g.add(card);
  const lan = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.006, 6, 40, PI * 1.3), new THREE.MeshStandardMaterial({ color: 0x1f3f8a, roughness: 0.8 }));
  lan.rotation.x = HP; lan.position.set(0.02, 0.004, -0.15); g.add(lan);
  return g;
}

// ------------------------------------------------------------------ a green-shaded banker's lamp
export function bankersLamp() {
  const g = new THREE.Group();
  const P = new Parts();
  const brass = new THREE.MeshStandardMaterial({ color: 0xa8873f, metalness: 0.9, roughness: 0.35 });
  P.add(brass, new THREE.CylinderGeometry(0.08, 0.09, 0.02, 20).translate(0, 0.01, 0));
  P.add(brass, new THREE.CylinderGeometry(0.008, 0.008, 0.32, 8).translate(0, 0.17, -0.04));
  P.build(g);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.13, 0.11, 24, 1, true, 0, PI).rotateZ(HP).rotateY(HP), new THREE.MeshStandardMaterial({ color: 0x0f5a2a, roughness: 0.25, side: THREE.DoubleSide, emissive: 0x0a3a18, emissiveIntensity: 0.4 }));
  shade.position.set(0, 0.34, 0); g.add(shade);
  return g;
}
