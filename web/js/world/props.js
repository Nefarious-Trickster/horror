import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------
export function triplanarUV(geo, scale = 1, ox = 0, oy = 0) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else if (ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u / scale + ox; uv[i * 2 + 1] = v / scale + oy;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

let _seed = 1;
export function srand(s) { _seed = s >>> 0 || 1; }
export function rnd() { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; }
const rr = (a, b) => a + rnd() * (b - a);

export class Kit {
  constructor(mats) { this.mats = mats; }
  m(name) { return typeof name === 'string' ? this.mats.get(name) : name; }
  mesh(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, uvScale = 1) {
    if (uvScale) triplanarUV(geo, uvScale, rnd() * 3, rnd() * 3);
    const m = new THREE.Mesh(geo, this.m(mat));
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  box(w, h, d, mat, x, y, z, rx, ry, rz, uv = 1) { return this.mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz, uv); }
  rbox(w, h, d, r, mat, x, y, z, rx, ry, rz, uv = 1) {
    return this.mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)), mat, x, y, z, rx, ry, rz, uv);
  }
  cyl(rt, rb, h, mat, x, y, z, rx, ry, rz, seg = 16, uv = 1) { return this.mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, rx, ry, rz, uv); }
  sph(r, mat, x, y, z, sx = 1, sy = 1, sz = 1, seg = 16) {
    const m = this.mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg * 0.75)), mat, x, y, z, 0, 0, 0, 1);
    m.scale.set(sx, sy, sz); return m;
  }
  torus(R, r, mat, x, y, z, rx, ry, rz, arc = Math.PI * 2, seg = 32) {
    return this.mesh(new THREE.TorusGeometry(R, r, 8, seg, arc), mat, x, y, z, rx, ry, rz, 1);
  }
  // tube through points, with optional rounded corners
  tube(points, r, mat, closed = false, seg = 8, corner = 0.06) {
    const path = new THREE.CurvePath();
    const P = points.map((p) => new THREE.Vector3(...p));
    if (P.length === 2 || corner <= 0) {
      for (let i = 0; i < P.length - 1; i++) path.add(new THREE.LineCurve3(P[i], P[i + 1]));
    } else {
      let prev = P[0].clone();
      for (let i = 1; i < P.length - 1; i++) {
        const a = P[i - 1], b = P[i], c = P[i + 1];
        const d1 = b.clone().sub(a), d2 = c.clone().sub(b);
        const k = Math.min(corner, d1.length() / 2, d2.length() / 2);
        const p1 = b.clone().sub(d1.normalize().multiplyScalar(k));
        const p2 = b.clone().add(d2.normalize().multiplyScalar(k));
        path.add(new THREE.LineCurve3(prev, p1));
        path.add(new THREE.QuadraticBezierCurve3(p1, b, p2));
        prev = p2;
      }
      path.add(new THREE.LineCurve3(prev, P[P.length - 1]));
    }
    const len = path.getLength();
    const geo = new THREE.TubeGeometry(path, Math.max(4, Math.ceil(len * 14)), r, seg, closed);
    return this.mesh(geo, mat, 0, 0, 0, 0, 0, 0, 0.5);
  }
  lathe(profile, mat, x, y, z, seg = 24) {
    const geo = new THREE.LatheGeometry(profile.map(([a, b]) => new THREE.Vector2(a, b)), seg);
    return this.mesh(geo, mat, x, y, z, 0, 0, 0, 0.5);
  }
  group(...children) { const g = new THREE.Group(); for (const c of children) if (c) g.add(c); return g; }
}

function roundedRectShape(w, d, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
function roundedRectPath(w, d, r) {
  const s = new THREE.Path();
  const x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
// hollow vessel (tub, tank, basin) from extruded rounded rect with hole; axis vertical
function vesselGeo(w, d, r, wall, h, bevel = 0.02) {
  const s = roundedRectShape(w, d, r);
  s.holes.push(roundedRectPath(w - wall * 2, d - wall * 2, Math.max(0.01, r - wall)));
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// LIGHT FIXTURES
// ---------------------------------------------------------------------------
export function fluorescent(K, opt = {}) {
  const g = new THREE.Group();
  const housing = K.rbox(0.32, 0.07, 1.24, 0.01, 'whiteMetal', 0, -0.035, 0);
  g.add(housing);
  const tubeMat = K.m('tube').clone();
  const tubes = [];
  for (const x of [-0.07, 0.07]) {
    const t = K.cyl(0.016, 0.016, 1.16, tubeMat, x, -0.085, 0, Math.PI / 2, 0, 0, 10);
    t.castShadow = false;
    g.add(t); tubes.push(t);
    for (const z of [-0.59, 0.59]) g.add(K.box(0.035, 0.03, 0.02, 'blackPlastic', x, -0.075, z));
  }
  // parabolic louvers
  for (let i = -5; i <= 5; i++) g.add(K.box(0.3, 0.035, 0.004, 'whiteMetal', 0, -0.09, i * 0.11));
  for (const x of [-0.155, 0.155]) g.add(K.box(0.004, 0.04, 1.22, 'whiteMetal', x, -0.09, 0));
  if (opt.hang) {
    for (const z of [-0.5, 0.5]) g.add(K.cyl(0.004, 0.004, opt.hang, 'chrome', 0, opt.hang / 2, z, 0, 0, 0, 4));
  }
  g.userData.dynamicMats = [tubeMat];
  return { group: g, tubeMat };
}

export function cageLamp(K, matName = 'emergency') {
  const g = new THREE.Group();
  const mat = K.m(matName).clone();
  g.add(K.cyl(0.07, 0.08, 0.03, 'genMetal', 0, 0, 0.015, Math.PI / 2, 0, 0));
  const bulb = K.sph(0.05, mat, 0, 0, 0.07, 1, 1, 1.2);
  bulb.castShadow = false; g.add(bulb);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    g.add(K.tube([[Math.cos(a) * 0.065, Math.sin(a) * 0.065, 0.02], [Math.cos(a) * 0.065, Math.sin(a) * 0.065, 0.1], [0, 0, 0.14]], 0.004, 'genMetal', false, 4, 0.04));
  }
  g.add(K.torus(0.065, 0.004, 'genMetal', 0, 0, 0.07));
  return { group: g, mat };
}

export function domeLamp(K, drop = 1.2) {
  const g = new THREE.Group();
  g.add(K.cyl(0.004, 0.004, drop, 'cable', 0, -drop / 2, 0, 0, 0, 0, 4));
  const shade = K.lathe([[0.02, 0], [0.05, -0.02], [0.12, -0.1], [0.22, -0.2], [0.24, -0.22], [0.235, -0.225], [0.21, -0.2], [0.11, -0.095], [0.04, -0.02], [0.015, -0.005]], 'genMetal', 0, -drop, 0, 20);
  g.add(shade);
  const mat = K.m('bulb').clone();
  const bulb = K.sph(0.045, mat, 0, -drop - 0.12, 0);
  bulb.castShadow = false; g.add(bulb);
  return { group: g, mat };
}

// ---------------------------------------------------------------------------
// DOORS & PASSAGES
// ---------------------------------------------------------------------------
export function doorLeaf(K, opt = {}) {
  // pivot at hinge edge; leaf extends along +x
  const w = opt.w ?? 0.94, h = opt.h ?? 2.12, t = 0.05;
  const g = new THREE.Group();
  const mat = opt.mat ?? 'door';
  const winY0 = 1.25, winY1 = 1.85, winX0 = 0.22, winX1 = w - 0.22;
  // frame around window
  g.add(K.box(w, winY0, t, mat, w / 2, winY0 / 2, 0));
  g.add(K.box(w, h - winY1, t, mat, w / 2, (winY1 + h) / 2, 0));
  g.add(K.box(winX0, winY1 - winY0, t, mat, winX0 / 2, (winY0 + winY1) / 2, 0));
  g.add(K.box(w - winX1, winY1 - winY0, t, mat, (winX1 + w) / 2, (winY0 + winY1) / 2, 0));
  if (opt.window !== false) {
    const glass = K.box(winX1 - winX0, winY1 - winY0, 0.008, 'wireGlass', w / 2, (winY0 + winY1) / 2, 0, 0, 0, 0, 0);
    glass.castShadow = false; g.add(glass);
    // wire mesh
    for (let i = 1; i < 8; i++) g.add(K.box(0.002, winY1 - winY0, 0.01, 'chrome', winX0 + (i / 8) * (winX1 - winX0), (winY0 + winY1) / 2, 0));
    for (let i = 1; i < 10; i++) g.add(K.box(winX1 - winX0, 0.002, 0.01, 'chrome', w / 2, winY0 + (i / 10) * (winY1 - winY0), 0));
  } else {
    g.add(K.box(winX1 - winX0, winY1 - winY0, t, mat, w / 2, (winY0 + winY1) / 2, 0));
  }
  // kick plates and push plate
  for (const s of [-1, 1]) {
    g.add(K.box(w - 0.04, 0.26, 0.004, 'stainless', w / 2, 0.15, s * (t / 2 + 0.002)));
    g.add(K.box(0.1, 0.3, 0.004, 'stainless', w - 0.12, 1.05, s * (t / 2 + 0.002)));
    // lever handle
    g.add(K.cyl(0.022, 0.022, 0.03, 'chrome', w - 0.1, 0.98, s * (t / 2 + 0.015), Math.PI / 2, 0, 0, 12));
    g.add(K.cyl(0.011, 0.011, 0.13, 'chrome', w - 0.15, 0.98, s * (t / 2 + 0.035), 0, 0, Math.PI / 2, 8));
  }
  // hinges
  for (const y of [0.25, 1.05, 1.9]) g.add(K.cyl(0.014, 0.014, 0.11, 'brass', 0, y, 0, 0, 0, 0, 8));
  if (opt.plateTex) {
    const pm = new THREE.MeshStandardMaterial({ map: opt.plateTex, roughness: 0.5 });
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.08), pm);
      p.position.set(w / 2, 1.98, s * (t / 2 + 0.003)); if (s < 0) p.rotation.y = Math.PI;
      g.add(p);
    }
  }
  return g;
}

export function doorFrame(K, h, mat = 'door') {
  // frame trims for a 1m wide opening, for both faces of a 1m deep cell, local: opening along x, depth along z
  const g = new THREE.Group();
  for (const z of [-0.5, 0.5]) {
    const s = Math.sign(z);
    g.add(K.box(0.09, h + 0.09, 0.03, mat, -0.47, (h + 0.09) / 2, z + s * 0.015));
    g.add(K.box(0.09, h + 0.09, 0.03, mat, 0.47, (h + 0.09) / 2, z + s * 0.015));
    g.add(K.box(1.03, 0.09, 0.03, mat, 0, h + 0.045, z + s * 0.015));
  }
  // jamb liners & stop
  g.add(K.box(0.03, h, 1.0, mat, -0.485, h / 2, 0));
  g.add(K.box(0.03, h, 1.0, mat, 0.485, h / 2, 0));
  g.add(K.box(0.97, 0.03, 1.0, mat, 0, h - 0.015, 0));
  g.add(K.box(0.012, h - 0.05, 0.04, mat, -0.465, (h - 0.05) / 2, 0.04));
  g.add(K.box(0.012, h - 0.05, 0.04, mat, 0.465, (h - 0.05) / 2, 0.04));
  // threshold
  g.add(K.box(0.97, 0.012, 0.2, 'stainless', 0, 0.006, 0));
  return g;
}

export function rollerGate(K, width, h) {
  // a lattice grille that rolls up into a housing. local: spans along x, centred.
  const grille = new THREE.Group();
  const n = Math.round(width / 0.11);
  for (let i = 0; i <= n; i++) grille.add(K.cyl(0.009, 0.009, h, 'chrome', -width / 2 + (i / n) * width, h / 2, 0, 0, 0, 0, 6));
  for (let y = 0.06; y < h; y += 0.22) grille.add(K.box(width, 0.035, 0.012, 'elevator', 0, y, 0.012));
  grille.add(K.box(width, 0.08, 0.05, 'elevator', 0, 0.04, 0));
  const housing = K.group(
    K.box(width + 0.2, 0.42, 0.4, 'elevator', 0, h + 0.21, 0),
    K.box(0.12, h, 0.14, 'elevator', -width / 2 - 0.06, h / 2, 0),
    K.box(0.12, h, 0.14, 'elevator', width / 2 + 0.06, h / 2, 0),
  );
  return { grille, housing };
}

// ---------------------------------------------------------------------------
// FURNITURE
// ---------------------------------------------------------------------------
export function locker(K, opt = {}) {
  const w = 0.5, h = 1.9, d = 0.5, t = 0.012;
  const body = new THREE.Group();
  const mat = opt.mat ?? 'locker';
  body.add(K.box(w, h, t, mat, 0, h / 2, -d / 2 + t / 2));
  body.add(K.box(t, h, d, mat, -w / 2 + t / 2, h / 2, 0));
  body.add(K.box(t, h, d, mat, w / 2 - t / 2, h / 2, 0));
  body.add(K.box(w, t, d, mat, 0, h - t / 2, 0));
  body.add(K.box(w, 0.1, d, mat, 0, 0.05, 0));
  body.add(K.box(w - 0.03, t, d - 0.03, mat, 0, 1.55, 0));
  body.add(K.cyl(0.008, 0.008, w - 0.04, 'chrome', 0, 1.48, 0.0, 0, 0, Math.PI / 2, 6));
  // sloped top
  body.add(K.box(w, 0.012, d * 1.05, mat, 0, h + 0.07, -0.02, -0.28, 0, 0));
  // door (pivot at left hinge)
  const door = new THREE.Group();
  const dw = w - 0.02, dh = h - 0.14;
  door.add(K.box(dw, 0.9, 0.016, mat, dw / 2, 0.45, 0));
  door.add(K.box(dw, 0.36, 0.016, mat, dw / 2, dh - 0.18, 0));
  door.add(K.box(0.07, dh - 1.26, 0.016, mat, 0.035, 0.9 + (dh - 1.26) / 2, 0));
  door.add(K.box(0.07, dh - 1.26, 0.016, mat, dw - 0.035, 0.9 + (dh - 1.26) / 2, 0));
  // louvres (see-through vents)
  const y0 = 0.92, y1 = dh - 0.38;
  for (let y = y0 + 0.02; y < y1 - 0.01; y += 0.045) {
    door.add(K.box(dw - 0.14, 0.006, 0.04, mat, dw / 2, y, 0.004, -0.75, 0, 0));
  }
  // lower vents
  for (let y = 0.12; y < 0.3; y += 0.04) door.add(K.box(dw - 0.18, 0.012, 0.006, 'blackPlastic', dw / 2, y, 0.009));
  // handle & number plate
  door.add(K.box(0.03, 0.14, 0.03, 'chrome', dw - 0.06, 1.0, 0.025));
  door.add(K.box(0.06, 0.06, 0.012, 'chrome', dw - 0.06, 1.15, 0.012));
  if (opt.label) {
    const lm = new THREE.MeshStandardMaterial({ map: opt.label, roughness: 0.6 });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.04), lm);
    p.position.set(dw / 2, dh - 0.2, 0.0095); door.add(p);
  }
  door.position.set(-w / 2 + 0.01, 0.08, d / 2 - 0.005);
  return { body, door };
}

export function bed(K, opt = {}) {
  const g = new THREE.Group();
  const L = 2.0, Wd = 0.92;
  const frameMat = 'whiteMetal';
  // side rails & cross members
  for (const x of [-Wd / 2, Wd / 2]) g.add(K.box(0.04, 0.07, L - 0.06, frameMat, x, 0.48, 0));
  for (const z of [-0.6, 0, 0.6]) g.add(K.box(Wd, 0.03, 0.04, frameMat, 0, 0.47, z));
  // head/foot boards: bent tube frames with spindles
  for (const [z, hgt] of [[-L / 2, 1.05], [L / 2, 0.85]]) {
    g.add(K.tube([[-Wd / 2, 0.12, z], [-Wd / 2, hgt, z], [Wd / 2, hgt, z], [Wd / 2, 0.12, z]], 0.02, frameMat, false, 8, 0.1));
    g.add(K.tube([[-Wd / 2, 0.55, z], [Wd / 2, 0.55, z]], 0.014, frameMat));
    for (let i = 1; i < 7; i++) g.add(K.cyl(0.009, 0.009, hgt - 0.6, frameMat, -Wd / 2 + (i / 7) * Wd, 0.55 + (hgt - 0.6) / 2, z, 0, 0, 0, 6));
    for (const x of [-Wd / 2, Wd / 2]) { // casters
      g.add(K.box(0.03, 0.06, 0.05, 'chrome', x, 0.1, z));
      g.add(K.cyl(0.05, 0.05, 0.03, 'rubber', x, 0.055, z, 0, 0, Math.PI / 2, 14));
    }
  }
  // side safety rail (one side raised)
  if (opt.rail !== false) {
    const s = opt.railSide ?? 1;
    g.add(K.tube([[s * (Wd / 2 + 0.03), 0.5, -0.5], [s * (Wd / 2 + 0.03), 0.85, -0.5], [s * (Wd / 2 + 0.03), 0.85, 0.5], [s * (Wd / 2 + 0.03), 0.5, 0.5]], 0.012, frameMat, false, 6, 0.06));
    for (let i = 1; i < 6; i++) g.add(K.cyl(0.006, 0.006, 0.35, frameMat, s * (Wd / 2 + 0.03), 0.675, -0.5 + i / 6, 0, 0, 0, 5));
  }
  // mattress
  g.add(K.rbox(Wd - 0.04, 0.16, L - 0.1, 0.06, 'mattress', 0, 0.58, 0, 0, 0, 0, 0.8));
  if (opt.bare) {
    // stained bare mattress
  } else {
    g.add(sheetDrape(K, { w: Wd + 0.3, l: L - 0.05, top: 0.665, half: Wd / 2 - 0.02, body: opt.body, seed: opt.seed ?? 1, mat: opt.sheetMat ?? 'sheet' }));
  }
  // pillow
  const pg = new RoundedBoxGeometry(0.6, 0.13, 0.36, 3, 0.06);
  const pp = pg.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    const x = pp.getX(i), z = pp.getZ(i), y = pp.getY(i);
    pp.setY(i, y * (1 - Math.pow(Math.abs(x) / 0.3, 2) * 0.5) - (y > 0 ? Math.exp(-(x * x + z * z) * 30) * 0.035 : 0));
  }
  pg.computeVertexNormals();
  g.add(K.mesh(pg, 'sheet', rr(-0.05, 0.05), 0.72, -L / 2 + 0.3, 0, rr(-0.15, 0.15), 0, 0.5));
  // leather restraints with buckles
  if (opt.restraints) {
    for (const z of [-0.25, 0.55]) {
      g.add(K.box(Wd + 0.03, 0.006, 0.07, 'leather', 0, 0.7, z));
      for (const s of [-1, 1]) g.add(K.box(0.006, 0.26, 0.07, 'leather', s * (Wd / 2 + 0.005), 0.58, z));
      g.add(K.box(0.05, 0.01, 0.06, 'brass', 0.15, 0.705, z));
      g.add(K.box(0.006, 0.3, 0.06, 'leather', -Wd / 2 - 0.02, 0.4, z + 0.05, 0, 0, 0.2)); // dangling strap
    }
  }
  return g;
}

// draped fabric over a flat top, optionally hiding a body shape
export function sheetDrape(K, opt) {
  const w = opt.w, l = opt.l, top = opt.top, half = opt.half;
  const geo = new THREE.PlaneGeometry(w, l, 40, 70);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  srand(opt.seed ?? 3);
  const ph = [rnd() * 6, rnd() * 6, rnd() * 6];
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), z = p.getZ(i);
    let y = top + 0.012;
    const ax = Math.abs(x);
    // gentle wrinkles
    y += Math.sin(x * 9 + ph[0] + z * 2) * 0.006 + Math.sin(z * 7 + ph[1]) * 0.005 + Math.sin((x + z) * 23 + ph[2]) * 0.002;
    if (opt.body) {
      // body silhouette lying on its back, head at -z
      const zh = -l / 2 + 0.28;
      const head = Math.exp(-(x * x / 0.012 + Math.pow(z - zh, 2) / 0.018)) * 0.17;
      const chest = Math.exp(-(x * x / 0.04 + Math.pow(z - (zh + 0.55), 2) / 0.08)) * 0.2;
      const hips = Math.exp(-(x * x / 0.035 + Math.pow(z - (zh + 0.95), 2) / 0.05)) * 0.15;
      const legs = (Math.exp(-Math.pow(x - 0.1, 2) / 0.006) + Math.exp(-Math.pow(x + 0.1, 2) / 0.006)) * 0.09 * smoothRange(z, zh + 1.0, zh + 1.72);
      const feet = (Math.exp(-(Math.pow(x - 0.1, 2) / 0.003 + Math.pow(z - (zh + 1.75), 2) / 0.003)) + Math.exp(-(Math.pow(x + 0.1, 2) / 0.003 + Math.pow(z - (zh + 1.75), 2) / 0.003))) * 0.12;
      y += Math.max(head, chest, hips, legs, feet) * 1.0 + (head + chest + hips) * 0.08;
    }
    if (ax > half) {
      const over = ax - half;
      x = Math.sign(x) * (half + Math.min(over, 0.02) + over * 0.06);
      y = top - over * 1.15 + Math.sin(z * 18 + ph[0]) * 0.012 * Math.min(1, over * 6);
    }
    p.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return K.mesh(geo, opt.mat ?? 'sheet', 0, 0, 0, 0, 0, 0, 0.6);
}
function smoothRange(z, a, b) { return z < a || z > b ? 0 : Math.sin(((z - a) / (b - a)) * Math.PI) ** 0.3; }

export function nightstand(K) {
  const g = new THREE.Group();
  g.add(K.rbox(0.45, 0.06, 0.42, 0.01, 'cabinet', 0, 0.74, 0));
  g.add(K.box(0.43, 0.68, 0.4, 'cabinet', 0, 0.38, 0));
  g.add(K.box(0.4, 0.04, 0.38, 'cabinet', 0, 0.04, 0));
  // drawer is separate (returned) so it can slide
  const drawer = new THREE.Group();
  drawer.add(K.box(0.39, 0.16, 0.02, 'cabinet', 0, 0, 0));
  drawer.add(K.box(0.14, 0.02, 0.025, 'chrome', 0, 0.01, 0.022));
  drawer.add(K.box(0.36, 0.12, 0.34, 'cabinet', 0, -0.01, -0.18));
  drawer.position.set(0, 0.6, 0.21);
  // cupboard door
  g.add(K.box(0.39, 0.36, 0.015, 'cabinet', 0, 0.28, 0.205));
  g.add(K.box(0.02, 0.1, 0.02, 'chrome', 0.15, 0.36, 0.22));
  return { group: g, drawer };
}

export function curtain(K, width, height, opt = {}) {
  const geo = new THREE.PlaneGeometry(width, height, Math.ceil(width * 30), 12);
  const p = geo.attributes.position;
  const f = opt.folds ?? 9;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const fy = (height / 2 - y) / height;
    p.setZ(i, Math.sin(x * f * 2) * 0.045 * (1 - fy * 0.3) + Math.sin(x * 23) * 0.006);
  }
  geo.translate(0, -height / 2, 0);
  geo.computeVertexNormals();
  const mat = K.m('curtain').clone();
  mat.userData.sway = { value: 0 };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSway = mat.userData.sway;
    sh.uniforms.uTime = curtainTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uSway; uniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float hang = clamp(-position.y / ${height.toFixed(2)}, 0.0, 1.0);
        transformed.z += sin(uTime * 1.3 + position.x * 3.0) * 0.015 * hang + uSway * hang * hang * sin(uTime*2.1 + position.x*2.0) ;
        transformed.x += uSway * 0.3 * hang * hang;`);
  };
  const m = K.mesh(geo, mat, 0, 0, 0, 0, 0, 0, 0.6);
  // rings
  const g = new THREE.Group();
  g.add(m);
  for (let x = -width / 2 + 0.05; x < width / 2; x += 0.15) g.add(K.torus(0.018, 0.003, 'chrome', x, 0.02, 0, 0, Math.PI / 2, 0, Math.PI * 2, 10));
  return { group: g, mat };
}
export const curtainTime = { value: 0 };

export function gurney(K, opt = {}) {
  const g = new THREE.Group();
  const L = 1.95, Wd = 0.62;
  g.add(K.rbox(Wd, 0.04, L, 0.015, 'stainless', 0, 0.86, 0));
  for (const x of [-Wd / 2, Wd / 2]) g.add(K.box(0.015, 0.05, L, 'stainless', x, 0.89, 0));
  for (const z of [-L / 2, L / 2]) g.add(K.box(Wd, 0.05, 0.015, 'stainless', 0, 0.89, z));
  // pad
  if (opt.pad !== false) g.add(K.rbox(Wd - 0.06, 0.06, L - 0.1, 0.025, 'blackPlastic', 0, 0.91, 0));
  // under frame
  for (const x of [-Wd / 2 + 0.05, Wd / 2 - 0.05]) g.add(K.box(0.035, 0.035, L - 0.2, 'chrome', x, 0.3, 0));
  g.add(K.box(Wd - 0.1, 0.02, L - 0.3, 'stainless', 0, 0.32, 0));
  for (const x of [-Wd / 2 + 0.05, Wd / 2 - 0.05]) for (const z of [-L / 2 + 0.12, L / 2 - 0.12]) {
    g.add(K.cyl(0.018, 0.018, 0.74, 'chrome', x, 0.48, z, 0, 0, 0, 8));
    g.add(K.box(0.025, 0.06, 0.05, 'chrome', x, 0.1, z));
    g.add(K.cyl(0.05, 0.05, 0.025, 'rubber', x, 0.055, z + 0.02, 0, 0, Math.PI / 2, 14));
  }
  // push handle
  g.add(K.tube([[-Wd / 2, 0.88, L / 2], [-Wd / 2, 1.0, L / 2 + 0.08], [Wd / 2, 1.0, L / 2 + 0.08], [Wd / 2, 0.88, L / 2]], 0.013, 'chrome', false, 6, 0.05));
  if (opt.bodyBag) g.add(bodyBag(K, 0.94));
  if (opt.sheetBody) g.add(sheetDrape(K, { w: Wd + 0.45, l: L + 0.1, top: 0.94, half: Wd / 2, body: true, seed: opt.seed ?? 9 }));
  return g;
}

export function bodyBag(K, y) {
  const geo = new THREE.CapsuleGeometry(0.22, 1.35, 8, 20);
  geo.rotateX(Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), yy = p.getY(i), z = p.getZ(i);
    const flat = yy < 0 ? 0.3 : 0.55;
    const head = Math.exp(-Math.pow(z + 0.75, 2) / 0.02) * 0.05;
    const feet = (Math.exp(-Math.pow(z - 0.78, 2) / 0.01)) * Math.exp(-Math.pow(Math.abs(x) - 0.08, 2) / 0.004) * 0.08;
    p.setXYZ(i, x * (1 + Math.sin(z * 4) * 0.05), yy * flat + (yy > 0 ? head + feet : 0) + Math.sin(x * 20 + z * 13) * 0.004, z);
  }
  geo.computeVertexNormals();
  const g = new THREE.Group();
  g.add(K.mesh(geo, 'bodyBag', 0, y + 0.07, 0, 0, 0, 0, 0.6));
  g.add(K.box(0.012, 0.012, 1.5, 'chrome', 0.05, y + 0.19, 0));
  return g;
}

export function wheelchair(K) {
  const g = new THREE.Group();
  const wheel = (x) => {
    const w = new THREE.Group();
    w.add(K.torus(0.3, 0.016, 'rubber', 0, 0, 0, 0, Math.PI / 2, 0, Math.PI * 2, 40));
    w.add(K.torus(0.285, 0.008, 'chrome', 0, 0, 0, 0, Math.PI / 2, 0, Math.PI * 2, 40));
    w.add(K.torus(0.265, 0.006, 'chrome', Math.sign(x) * 0.03, 0, 0, 0, Math.PI / 2, 0, Math.PI * 2, 40));
    w.add(K.cyl(0.03, 0.03, 0.06, 'chrome', 0, 0, 0, 0, 0, Math.PI / 2, 12));
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      w.add(K.cyl(0.0025, 0.0025, 0.27, 'chrome', 0, Math.sin(a) * 0.14, Math.cos(a) * 0.14, a, 0, 0, 4));
    }
    w.position.set(x, 0.3, 0.12);
    return w;
  };
  g.add(wheel(-0.3), wheel(0.3));
  for (const s of [-1, 1]) {
    const x = s * 0.24;
    g.add(K.tube([[x, 0.92, 0.35], [x, 0.52, 0.28], [x, 0.5, -0.25], [x, 0.18, -0.3]], 0.012, 'chrome', false, 6, 0.06));
    g.add(K.tube([[x, 0.52, 0.2], [x, 0.7, 0.2], [x, 0.7, -0.15]], 0.01, 'chrome', false, 6, 0.04));
    g.add(K.box(0.05, 0.02, 0.32, 'blackPlastic', x, 0.71, 0.02)); // armrest pad
    g.add(K.tube([[x, 0.5, -0.25], [x * 0.9, 0.15, -0.42]], 0.01, 'chrome'));
    g.add(K.box(0.13, 0.012, 0.1, 'blackPlastic', x * 0.65, 0.14, -0.45));
    // caster
    g.add(K.cyl(0.07, 0.07, 0.025, 'rubber', x, 0.07, -0.33, 0, 0, Math.PI / 2, 14));
    g.add(K.box(0.02, 0.1, 0.03, 'chrome', x, 0.12, -0.31));
    g.add(K.cyl(0.012, 0.012, 0.12, 'blackPlastic', x, 0.96, 0.37, Math.PI / 2 - 0.4, 0, 0, 8)); // grips
  }
  g.add(K.box(0.48, 0.015, 0.42, 'leather', 0, 0.5, -0.02));
  g.add(K.box(0.48, 0.36, 0.012, 'leather', 0, 0.72, 0.29, -0.12, 0, 0));
  return g;
}

export function ivStand(K, opt = {}) {
  const g = new THREE.Group();
  g.add(K.cyl(0.011, 0.011, 1.85, 'chrome', 0, 0.98, 0, 0, 0, 0, 8));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = K.box(0.28, 0.018, 0.03, 'chrome', Math.cos(a) * 0.14, 0.08, Math.sin(a) * 0.14, 0, -a, 0);
    g.add(leg);
    g.add(K.cyl(0.03, 0.03, 0.02, 'rubber', Math.cos(a) * 0.27, 0.03, Math.sin(a) * 0.27, Math.PI / 2, 0, 0, 10));
  }
  for (const a of [0, Math.PI]) g.add(K.torus(0.035, 0.004, 'chrome', Math.cos(a) * 0.05, 1.9, Math.sin(a) * 0.05, 0, a, 0, Math.PI, 10));
  g.add(K.box(0.14, 0.008, 0.008, 'chrome', 0, 1.9, 0));
  if (opt.bag !== false) {
    const bag = K.lathe([[0, -0.2], [0.04, -0.19], [0.065, -0.1], [0.07, 0.05], [0.05, 0.12], [0.02, 0.14], [0, 0.145]], 'ivBag', 0.08, 1.7, 0, 14);
    bag.scale.set(1, 1, 0.45); bag.castShadow = false; g.add(bag);
    g.add(K.tube([[0.08, 1.5, 0], [0.09, 1.2, 0.03], [0.15, 0.9, 0.1], [0.3, 0.75, 0.2]], 0.003, 'ivBag', false, 4, 0.2));
  }
  return g;
}

export function waitingChairs(K, n = 4) {
  const g = new THREE.Group();
  const beamL = n * 0.56;
  g.add(K.box(beamL, 0.05, 0.06, 'chrome', 0, 0.36, 0));
  for (const x of [-beamL / 2 + 0.2, beamL / 2 - 0.2]) {
    g.add(K.box(0.04, 0.36, 0.04, 'chrome', x, 0.18, 0));
    g.add(K.box(0.05, 0.02, 0.5, 'chrome', x, 0.01, 0));
  }
  for (let i = 0; i < n; i++) {
    const x = -beamL / 2 + 0.28 + i * 0.56;
    const seat = new RoundedBoxGeometry(0.48, 0.05, 0.46, 2, 0.02);
    const p = seat.attributes.position;
    for (let k = 0; k < p.count; k++) p.setY(k, p.getY(k) - Math.pow(p.getX(k) / 0.24, 2) * -0.015 - Math.exp(-p.getZ(k) * p.getZ(k) * 20) * 0.01);
    seat.computeVertexNormals();
    const col = i === n - 1 && n > 3 ? 'binderRed' : 'beigePlastic';
    g.add(K.mesh(seat, col, x, 0.43, 0));
    const back = K.rbox(0.46, 0.4, 0.04, 0.02, col, x, 0.7, -0.24, -0.15, 0, 0);
    g.add(back);
    g.add(K.box(0.03, 0.32, 0.03, 'chrome', x, 0.55, -0.22, -0.15, 0, 0));
  }
  return g;
}

export function officeChair(K) {
  const g = new THREE.Group();
  g.add(K.rbox(0.48, 0.08, 0.46, 0.03, 'leather', 0, 0.48, 0));
  g.add(K.rbox(0.44, 0.5, 0.06, 0.03, 'leather', 0, 0.82, -0.24, -0.1, 0, 0));
  g.add(K.box(0.04, 0.3, 0.03, 'chrome', 0, 0.6, -0.22, -0.1, 0, 0));
  g.add(K.cyl(0.025, 0.03, 0.3, 'chrome', 0, 0.3, 0));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.add(K.box(0.3, 0.025, 0.04, 'blackPlastic', Math.cos(a) * 0.15, 0.08, Math.sin(a) * 0.15, 0, -a, 0));
    g.add(K.sph(0.03, 'blackPlastic', Math.cos(a) * 0.29, 0.03, Math.sin(a) * 0.29));
  }
  return g;
}

export function desk(K, opt = {}) {
  const g = new THREE.Group();
  const w = opt.w ?? 1.5, d = 0.75;
  g.add(K.rbox(w, 0.04, d, 0.008, 'wood', 0, 0.74, 0));
  // pedestal with drawers
  const px = w / 2 - 0.22;
  g.add(K.box(0.42, 0.7, d - 0.04, 'cabinet', px, 0.37, 0));
  for (let i = 0; i < 3; i++) {
    const y = 0.6 - i * 0.22;
    g.add(K.box(0.38, 0.19, 0.012, 'cabinet', px, y, d / 2 - 0.01));
    g.add(K.box(0.12, 0.015, 0.02, 'chrome', px, y + 0.04, d / 2 + 0.005));
  }
  g.add(K.box(0.03, 0.72, d - 0.06, 'cabinet', -w / 2 + 0.03, 0.36, 0));
  g.add(K.box(w - 0.45, 0.4, 0.015, 'cabinet', -0.2, 0.5, -d / 2 + 0.05));
  if (opt.crt !== false) g.add(crt(K, -0.15, 0.76, -0.05, opt.crtOn));
  if (opt.papers !== false) {
    for (let i = 0; i < 6; i++) g.add(K.box(0.21, 0.003, 0.29, 'paperProp', rr(-0.6, 0.6), 0.762 + i * 0.003, rr(0.0, 0.25), 0, rr(-0.6, 0.6), 0, 0));
  }
  // keyboard
  const kb = new THREE.Group();
  kb.add(K.rbox(0.45, 0.03, 0.16, 0.008, 'beigePlastic', 0, 0, 0, 0.06, 0, 0));
  for (let r = 0; r < 5; r++) for (let c = 0; c < 14; c++) kb.add(K.box(0.024, 0.012, 0.024, 'beigePlastic', -0.19 + c * 0.029, 0.018 + r * 0.002, -0.055 + r * 0.028, 0.06, 0, 0, 0));
  kb.position.set(-0.15, 0.775, 0.2);
  g.add(kb);
  if (opt.lamp) g.add(deskLamp(K, w / 2 - 0.2, 0.76, -0.2));
  return g;
}

export function crt(K, x, y, z, on = false) {
  const g = new THREE.Group();
  g.add(K.rbox(0.4, 0.36, 0.06, 0.02, 'beigePlastic', 0, 0.2, 0.18));
  g.add(K.rbox(0.34, 0.3, 0.3, 0.04, 'beigePlastic', 0, 0.2, 0.0));
  g.add(K.rbox(0.22, 0.2, 0.16, 0.03, 'beigePlastic', 0, 0.2, -0.2));
  g.add(K.cyl(0.1, 0.12, 0.03, 'beigePlastic', 0, 0.015, 0.05, 0, 0, 0, 16));
  const scr = new THREE.SphereGeometry(0.9, 24, 24, -0.17, 0.34, Math.PI / 2 - 0.15, 0.3);
  const s = new THREE.Mesh(scr, K.m('crtScreen'));
  s.position.set(0, 0.2, 0.21 - 0.9 + 0.005);
  s.castShadow = false;
  g.add(s);
  g.position.set(x, y, z);
  return g;
}

export function deskLamp(K, x, y, z) {
  const g = new THREE.Group();
  g.add(K.cyl(0.08, 0.09, 0.025, 'genMetal', 0, 0.012, 0));
  g.add(K.cyl(0.008, 0.008, 0.38, 'chrome', 0.04, 0.2, 0, 0, 0, -0.3, 6));
  g.add(K.cyl(0.008, 0.008, 0.34, 'chrome', -0.04, 0.48, 0.0, 0, 0, 1.1, 6));
  const shade = K.lathe([[0.01, 0.0], [0.04, -0.02], [0.08, -0.1], [0.085, -0.11], [0.07, -0.095], [0.035, -0.02]], 'genMetal', -0.2, 0.58, 0, 16);
  shade.rotation.z = 0.6; g.add(shade);
  g.position.set(x, y, z);
  return g;
}

export function filingCabinet(K, opt = {}) {
  const g = new THREE.Group();
  const n = opt.drawers ?? 4, h = n * 0.33;
  g.add(K.box(0.46, h, 0.6, 'cabinet', 0, h / 2, 0));
  for (let i = 0; i < n; i++) {
    const y = 0.17 + i * 0.33;
    const open = opt.open === i ? 0.32 : 0;
    const dg = new THREE.Group();
    dg.add(K.box(0.42, 0.3, 0.015, 'cabinet', 0, 0, 0));
    dg.add(K.box(0.14, 0.02, 0.025, 'chrome', 0, 0.06, 0.018));
    dg.add(K.box(0.08, 0.04, 0.005, 'paperProp', 0, 0.11, 0.009, 0, 0, 0, 0));
    if (open) {
      dg.add(K.box(0.4, 0.24, 0.012, 'cabinet', 0, -0.02, -0.3));
      dg.add(K.box(0.012, 0.24, 0.3, 'cabinet', -0.2, -0.02, -0.15));
      dg.add(K.box(0.012, 0.24, 0.3, 'cabinet', 0.2, -0.02, -0.15));
      for (let f = 0; f < 10; f++) dg.add(K.box(0.36, 0.22, 0.008, f % 3 ? 'cardboard' : 'paperProp', 0, 0.0, -0.03 - f * 0.025, rr(-0.2, 0.1), 0, 0));
    }
    dg.position.set(0, y, 0.3 + open);
    g.add(dg);
  }
  return g;
}

export function shelving(K, length = 2, opt = {}) {
  const g = new THREE.Group();
  const h = opt.h ?? 2.4, d = 0.55, levels = opt.levels ?? 5;
  const bays = Math.round(length);
  for (let b = 0; b <= bays; b++) {
    const x = -length / 2 + (b / bays) * length;
    for (const z of [-d / 2, d / 2]) {
      g.add(K.box(0.035, h, 0.003, 'cabinet', x, h / 2, z));
      g.add(K.box(0.003, h, 0.035, 'cabinet', x, h / 2, z - Math.sign(z) * 0.017));
    }
  }
  for (let l = 0; l < levels; l++) {
    const y = 0.1 + l * ((h - 0.2) / (levels - 1));
    g.add(K.box(length, 0.02, d, 'cabinet', 0, y, 0));
    g.add(K.box(length, 0.04, 0.01, 'cabinet', 0, y - 0.01, d / 2));
    if (l === levels - 1) continue;
    // contents
    let x = -length / 2 + 0.04;
    const gap = (h - 0.2) / (levels - 1) - 0.05;
    while (x < length / 2 - 0.1) {
      const r = rnd();
      if (r < 0.45) {
        const bw = rr(0.28, 0.42), bh = Math.min(gap - 0.02, rr(0.22, 0.32)), bd = rr(0.35, 0.45);
        if (x + bw > length / 2) break;
        const box = K.rbox(bw, bh, bd, 0.006, 'cardboard', x + bw / 2, y + 0.01 + bh / 2, rr(-0.05, 0.05), 0, rr(-0.08, 0.08), 0);
        g.add(box);
        g.add(K.box(0.1, 0.06, 0.002, 'paperProp', x + bw / 2, y + bh * 0.6, box.position.z + bd / 2 + 0.002, 0, 0, 0, 0));
        x += bw + 0.02;
      } else if (r < 0.8) {
        const n = 3 + Math.floor(rnd() * 7);
        for (let k = 0; k < n && x < length / 2 - 0.08; k++) {
          const bh = Math.min(gap - 0.02, rr(0.28, 0.32));
          const lean = k === n - 1 ? rr(0, 0.35) : 0;
          const mat = ['binder', 'binderRed', 'binderGreen', 'cardboard'][Math.floor(rnd() * 4)];
          g.add(K.box(0.055, bh, 0.28, mat, x + 0.03 + Math.sin(lean) * bh / 2, y + 0.01 + Math.cos(lean) * bh / 2, 0.08, 0, 0, -lean));
          x += 0.06;
        }
        x += 0.03;
      } else if (r < 0.9) {
        for (let k = 0; k < 8; k++) g.add(K.box(0.22, 0.003, 0.3, 'paperProp', x + 0.12 + rr(-0.02, 0.02), y + 0.012 + k * 0.004, rr(-0.05, 0.05), 0, rr(-0.2, 0.2), 0, 0));
        x += 0.28;
      } else x += rr(0.15, 0.4);
    }
  }
  return g;
}

export function counter(K, w = 3, d = 0.7) {
  const g = new THREE.Group();
  g.add(K.rbox(w, 0.05, d, 0.01, 'wood', 0, 1.08, 0));
  g.add(K.box(w, 1.05, 0.04, 'wood', 0, 0.525, d / 2 - 0.02));
  g.add(K.box(w - 0.02, 0.1, 0.03, 'baseboard', 0, 0.05, d / 2 + 0.005));
  g.add(K.rbox(w, 0.03, 0.55, 0.005, 'wood', 0, 0.74, -0.05));
  for (const x of [-w / 2 + 0.03, w / 2 - 0.03]) g.add(K.box(0.04, 1.05, d, 'wood', x, 0.525, 0));
  // panel grooves
  for (let x = -w / 2 + 0.5; x < w / 2; x += 0.5) g.add(K.box(0.012, 0.9, 0.006, 'baseboard', x, 0.55, d / 2 + 0.001));
  return g;
}

export function bookcase(K, w = 1.2) {
  const g = new THREE.Group();
  const h = 2.0, d = 0.32;
  g.add(K.box(w, h, 0.02, 'wood', 0, h / 2, -d / 2));
  for (const x of [-w / 2, w / 2]) g.add(K.box(0.025, h, d, 'wood', x, h / 2, 0));
  for (let l = 0; l < 5; l++) {
    const y = 0.05 + l * 0.48;
    g.add(K.box(w, 0.025, d, 'wood', 0, y, 0));
    if (l === 4) continue;
    let x = -w / 2 + 0.04;
    while (x < w / 2 - 0.06) {
      const bw = rr(0.025, 0.06), bh = rr(0.22, 0.36);
      const lean = rnd() < 0.08 ? rr(0.1, 0.4) : 0;
      const mat = ['binder', 'binderRed', 'binderGreen', 'leather', 'cardboard'][Math.floor(rnd() * 5)];
      g.add(K.box(bw, bh, rr(0.17, 0.24), mat, x + bw / 2 + Math.sin(lean) * bh / 2, y + 0.012 + bh / 2 * Math.cos(lean), 0.02, 0, 0, -lean));
      x += bw + 0.003 + (rnd() < 0.05 ? 0.15 : 0);
    }
  }
  return g;
}

export function trolley(K) {
  const g = new THREE.Group();
  g.add(K.box(0.6, 0.8, 0.45, 'whiteMetal', 0, 0.5, 0));
  for (let i = 0; i < 4; i++) {
    const y = 0.25 + i * 0.18;
    const col = ['binderRed', 'binder', 'binderGreen', 'yellowMetal'][i];
    g.add(K.box(0.56, 0.15, 0.01, col, 0, y, 0.228));
    g.add(K.box(0.2, 0.02, 0.02, 'chrome', 0, y + 0.03, 0.24));
  }
  g.add(K.rbox(0.66, 0.03, 0.5, 0.01, 'whiteMetal', 0, 0.92, 0));
  for (const [x, z] of [[-0.25, -0.18], [0.25, -0.18], [-0.25, 0.18], [0.25, 0.18]]) g.add(K.cyl(0.04, 0.04, 0.025, 'rubber', x, 0.04, z, 0, 0, Math.PI / 2, 12));
  // stuff on top: pill bottles, kidney dish, syringe
  for (let i = 0; i < 5; i++) {
    const b = K.lathe([[0, 0], [0.018, 0], [0.018, 0.06], [0.014, 0.065], [0.014, 0.075], [0, 0.075]], 'bottleBrown', rr(-0.25, 0.1), 0.935, rr(-0.18, 0.18), 10);
    if (rnd() < 0.3) { b.rotation.z = Math.PI / 2; b.position.y += 0.015; }
    g.add(b);
  }
  const dish = K.lathe([[0, 0], [0.06, 0.0], [0.1, 0.02], [0.11, 0.035], [0.1, 0.035], [0.055, 0.008], [0, 0.008]], 'stainless', 0.18, 0.935, 0.05, 20);
  dish.scale.set(1.4, 1, 0.8); g.add(dish);
  g.add(K.cyl(0.006, 0.006, 0.12, 'ivBag', 0.1, 0.945, -0.12, 0, 0.5, Math.PI / 2, 6));
  return g;
}

export function plant(K) {
  const g = new THREE.Group();
  g.add(K.lathe([[0, 0], [0.14, 0], [0.18, 0.3], [0.2, 0.32], [0.2, 0.34], [0.17, 0.34], [0.15, 0.08], [0, 0.08]], 'terracotta', 0, 0, 0, 20));
  g.add(K.cyl(0.17, 0.17, 0.01, 'soil', 0, 0.3, 0, 0, 0, 0, 16));
  for (let b = 0; b < 7; b++) {
    const pts = [[rr(-0.03, 0.03), 0.3, rr(-0.03, 0.03)]];
    let [x, y, z] = pts[0];
    const a = rnd() * 6.28;
    for (let s = 0; s < 4; s++) { x += Math.cos(a) * rr(0.02, 0.08); z += Math.sin(a) * rr(0.02, 0.08); y += rr(0.12, 0.25) * (1 - s * 0.2); pts.push([x, y, z]); }
    if (rnd() < 0.4) { const l = pts[pts.length - 1]; pts.push([l[0] + rr(-0.1, 0.1), l[1] - 0.15, l[2] + rr(-0.1, 0.1)]); }
    g.add(K.tube(pts, 0.006, 'deadPlant', false, 4, 0.05));
  }
  return g;
}

export function bottle(K, kind = 0) {
  const prof = [[0, 0], [0.035, 0], [0.037, 0.005], [0.037, 0.17], [0.03, 0.2], [0.014, 0.23], [0.013, 0.29], [0.016, 0.295], [0.012, 0.3], [0, 0.3]];
  return K.lathe(prof, kind ? 'bottleBrown' : 'bottleGreen', 0, 0, 0, 14);
}

export function clipboard(K) {
  const g = new THREE.Group();
  g.add(K.box(0.23, 0.006, 0.32, 'wood', 0, 0.003, 0));
  g.add(K.box(0.21, 0.004, 0.28, 'paperProp', 0, 0.008, 0.01, 0, 0, 0, 0));
  g.add(K.box(0.1, 0.012, 0.03, 'chrome', 0, 0.012, -0.145));
  return g;
}

export function noteProp(K, tex) {
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide });
  const geo = new THREE.PlaneGeometry(0.21, 0.28, 6, 6);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 9) * 0.006 + p.getY(i) * p.getY(i) * 0.15);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, m);
  mesh.rotation.x = -Math.PI / 2;
  mesh.castShadow = false; mesh.receiveShadow = true;
  return mesh;
}

export function fuse(K) {
  const g = new THREE.Group();
  g.add(K.cyl(0.028, 0.028, 0.11, 'ceramic', 0, 0, 0, 0, 0, Math.PI / 2, 16));
  for (const x of [-0.065, 0.065]) g.add(K.cyl(0.031, 0.031, 0.025, 'brass', x, 0, 0, 0, 0, Math.PI / 2, 16));
  for (const x of [-0.085, 0.085]) g.add(K.box(0.02, 0.01, 0.03, 'brass', x, 0, 0));
  g.add(K.box(0.05, 0.002, 0.03, 'paperProp', 0, 0.028, 0, 0, 0, 0, 0));
  return g;
}

export function battery(K) {
  const g = new THREE.Group();
  g.add(K.cyl(0.017, 0.017, 0.06, 'binderRed', 0, 0, 0, 0, 0, Math.PI / 2, 12));
  g.add(K.cyl(0.0172, 0.0172, 0.02, 'chrome', -0.03, 0, 0, 0, 0, Math.PI / 2, 12));
  g.add(K.cyl(0.006, 0.006, 0.006, 'chrome', 0.033, 0, 0, 0, 0, Math.PI / 2, 8));
  return g;
}

export function keycard(K, tex) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 });
  g.add(K.rbox(0.086, 0.002, 0.054, 0.0008, 'beigePlastic', 0, 0, 0));
  const top = new THREE.Mesh(new THREE.PlaneGeometry(0.084, 0.052), m);
  top.rotation.x = -Math.PI / 2; top.position.y = 0.0012;
  g.add(top);
  return g;
}

export function wallClock(K, tex) {
  const g = new THREE.Group();
  g.add(K.cyl(0.17, 0.17, 0.05, 'blackPlastic', 0, 0, 0.025, Math.PI / 2, 0, 0, 32));
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.15, 32), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
  face.position.z = 0.051; g.add(face);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.15, 32), K.m('glass'));
  glass.position.z = 0.056; g.add(glass);
  return g;
}

export function noticeBoard(K, papers) {
  const g = new THREE.Group();
  g.add(K.box(1.2, 0.8, 0.03, 'cork', 0, 0, 0.015));
  for (const [x, y] of [[-0.6, 0], [0.6, 0]]) g.add(K.box(0.03, 0.83, 0.04, 'wood', x, y, 0.02));
  for (const y of [-0.4, 0.4]) g.add(K.box(1.23, 0.03, 0.04, 'wood', 0, y, 0.02));
  papers.forEach((tex, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.27), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    m.position.set(-0.4 + (i % 4) * 0.26 + rr(-0.03, 0.03), 0.12 - Math.floor(i / 4) * 0.32 + rr(-0.03, 0.03), 0.032 + i * 0.001);
    m.rotation.z = rr(-0.12, 0.12);
    g.add(m);
    g.add(K.sph(0.008, 'binderRed', m.position.x, m.position.y + 0.11, 0.04));
  });
  return g;
}

export function sign(K, tex, w, h) {
  const g = new THREE.Group();
  g.add(K.box(w + 0.02, h + 0.02, 0.012, 'whiteMetal', 0, 0, 0.006));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 }));
  m.position.z = 0.0125; m.receiveShadow = true;
  g.add(m);
  return g;
}

export function decalPlane(mat, w, h) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.receiveShadow = true;
  m.renderOrder = 1;
  return m;
}

// ---------------------------------------------------------------------------
// PLUMBING & INDUSTRIAL
// ---------------------------------------------------------------------------
export function pipeRun(K, pts, r, mat = 'pipe', opt = {}) {
  const g = new THREE.Group();
  g.add(K.tube(pts, r, mat, false, 12, r * 3));
  // flanges & hangers
  for (let i = 0; i < pts.length - 1; i++) {
    const a = new THREE.Vector3(...pts[i]), b = new THREE.Vector3(...pts[i + 1]);
    const len = a.distanceTo(b);
    const dir = b.clone().sub(a).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    for (let s = 1.2; s < len - 0.3; s += opt.flangeEvery ?? 2.4) {
      const p = a.clone().addScaledVector(dir, s);
      const f = K.cyl(r * 1.45, r * 1.45, 0.05, mat, p.x, p.y, p.z, 0, 0, 0, 16);
      f.quaternion.copy(q); g.add(f);
      if (opt.hangTo != null && Math.abs(dir.y) < 0.5) {
        const drop = opt.hangTo - p.y;
        if (drop > 0.02) {
          g.add(K.cyl(0.006, 0.006, drop, 'chrome', p.x + dir.x * 0.25, p.y + drop / 2, p.z + dir.z * 0.25, 0, 0, 0, 5));
          const ring = K.torus(r + 0.01, 0.006, 'chrome', p.x + dir.x * 0.25, p.y, p.z + dir.z * 0.25, 0, 0, 0, Math.PI * 2, 16);
          ring.quaternion.copy(q); g.add(ring);
        }
      }
    }
  }
  return g;
}

export function valveWheel(K, r = 0.14, mat = 'redMetal') {
  const g = new THREE.Group();
  g.add(K.torus(r, r * 0.12, mat, 0, 0, 0, 0, 0, 0, Math.PI * 2, 28));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.add(K.cyl(r * 0.07, r * 0.07, r, mat, Math.cos(a) * r / 2, Math.sin(a) * r / 2, 0, 0, 0, a + Math.PI / 2, 6));
  }
  g.add(K.cyl(r * 0.22, r * 0.22, r * 0.4, mat, 0, 0, 0, Math.PI / 2, 0, 0, 12));
  return g;
}

export function gauge(K, tex) {
  const g = new THREE.Group();
  g.add(K.cyl(0.09, 0.09, 0.05, 'chrome', 0, 0, 0.025, Math.PI / 2, 0, 0, 24));
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.08, 24), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
  face.position.z = 0.051; g.add(face);
  const needle = new THREE.Group();
  needle.add(K.box(0.004, 0.065, 0.003, 'binderRed', 0, 0.03, 0, 0, 0, 0, 0));
  needle.position.z = 0.054;
  needle.rotation.z = 2.2;
  g.add(needle);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.08, 24), K.m('glass'));
  glass.position.z = 0.058; g.add(glass);
  return { group: g, needle };
}

export function breakerPanel(K) {
  const g = new THREE.Group();
  g.add(K.box(0.5, 0.75, 0.12, 'genMetal', 0, 0, 0.06));
  g.add(K.box(0.46, 0.7, 0.01, 'genMetal', 0, 0, 0.125));
  g.add(K.box(0.03, 0.08, 0.02, 'chrome', 0.2, 0, 0.14));
  g.add(K.box(0.15, 0.1, 0.002, 'yellowMetal', 0, 0.25, 0.131, 0, 0, 0, 0));
  return g;
}

export function cableTray(K, len) {
  const g = new THREE.Group();
  g.add(K.box(len, 0.01, 0.3, 'pipe', 0, 0, 0));
  for (const z of [-0.15, 0.15]) g.add(K.box(len, 0.07, 0.01, 'pipe', 0, 0.035, z));
  for (let i = 0; i < 5; i++) g.add(K.cyl(0.012, 0.012, len, 'cable', 0, 0.02, -0.1 + i * 0.05, 0, 0, Math.PI / 2, 6));
  return g;
}

export function generator(K, gaugeTex) {
  const g = new THREE.Group();
  const parts = { gauges: [], sockets: [], fuses: [], lamps: [] };
  // skid
  g.add(K.box(4.2, 0.18, 1.6, 'yellowMetal', 0, 0.09, 0));
  for (const z of [-0.8, 0.8]) g.add(K.box(4.2, 0.24, 0.08, 'yellowMetal', 0, 0.12, z));
  // engine block
  const eng = new THREE.Group();
  eng.add(K.rbox(1.9, 1.0, 1.0, 0.05, 'genMetal', 0, 0.75, 0));
  eng.add(K.rbox(1.7, 0.25, 0.7, 0.04, 'genMetal', 0, 1.36, 0)); // valve cover
  for (let i = 0; i < 6; i++) {
    const x = -0.75 + i * 0.3;
    eng.add(K.rbox(0.22, 0.3, 0.55, 0.02, 'genMetal', x, 1.1, 0));
    for (let f = 0; f < 6; f++) eng.add(K.box(0.24, 0.01, 0.58, 'genMetal', x, 1.0 + f * 0.04, 0));
    // injector lines
    eng.add(K.tube([[x, 1.5, 0.2], [x, 1.62, 0.25], [x + 0.1, 1.62, 0.55], [x + 0.1, 0.9, 0.62]], 0.008, 'copper', false, 6, 0.06));
  }
  // exhaust manifold
  eng.add(K.tube([[-0.85, 1.15, -0.4], [0.85, 1.15, -0.4]], 0.06, 'rust'));
  for (let i = 0; i < 6; i++) eng.add(K.cyl(0.04, 0.04, 0.15, 'rust', -0.75 + i * 0.3, 1.15, -0.32, Math.PI / 2, 0, 0, 8));
  eng.position.set(-0.8, 0.18, 0);
  g.add(eng);
  // flywheel housing + alternator
  g.add(K.cyl(0.62, 0.62, 0.25, 'genMetal', 0.32, 0.95, 0, 0, 0, Math.PI / 2, 32));
  const alt = K.cyl(0.52, 0.52, 1.3, 'genMetal', 1.1, 0.95, 0, 0, 0, Math.PI / 2, 32);
  g.add(alt);
  for (let i = 0; i < 9; i++) g.add(K.torus(0.52, 0.025, 'genMetal', 0.55 + i * 0.14, 0.95, 0, 0, Math.PI / 2, 0, Math.PI * 2, 32));
  g.add(K.cyl(0.25, 0.25, 0.1, 'genMetal', 1.8, 0.95, 0, 0, 0, Math.PI / 2, 24));
  // radiator at front
  const rad = new THREE.Group();
  rad.add(K.box(0.18, 1.35, 1.3, 'genMetal', 0, 0.86, 0));
  for (let i = 0; i < 26; i++) rad.add(K.box(0.02, 1.2, 0.012, 'blackPlastic', 0.1, 0.86, -0.6 + i * 0.048));
  rad.position.set(-2.0, 0.0, 0);
  g.add(rad);
  // exhaust stack to ceiling
  g.add(K.tube([[-0.8, 1.33, -0.62], [-0.8, 1.8, -0.9], [-0.8, 3.2, -0.9], [-0.8, 4.4, -0.9]], 0.11, 'rust', false, 14, 0.25));
  g.add(K.cyl(0.2, 0.2, 0.9, 'rust', -0.8, 2.6, -0.9, 0, 0, 0, 20));
  // control panel (facing +z)
  const panel = new THREE.Group();
  panel.add(K.box(0.05, 1.1, 0.05, 'genMetal', -0.4, 0.55, 0));
  panel.add(K.box(0.05, 1.1, 0.05, 'genMetal', 0.4, 0.55, 0));
  panel.add(K.rbox(1.0, 0.75, 0.22, 0.02, 'genMetal', 0, 1.35, 0));
  for (let i = 0; i < 3; i++) {
    const gg = gauge(K, gaugeTex[i % gaugeTex.length]);
    gg.group.position.set(-0.3 + i * 0.3, 1.52, 0.11);
    panel.add(gg.group); parts.gauges.push(gg.needle);
  }
  // fuse sockets
  for (let i = 0; i < 2; i++) {
    const x = -0.15 + i * 0.3;
    const sock = new THREE.Group();
    sock.add(K.box(0.24, 0.1, 0.04, 'blackPlastic', 0, 0, 0));
    sock.add(K.box(0.03, 0.06, 0.03, 'brass', -0.09, 0, 0.03));
    sock.add(K.box(0.03, 0.06, 0.03, 'brass', 0.09, 0, 0.03));
    sock.position.set(x, 1.22, 0.12);
    panel.add(sock);
    parts.sockets.push(sock);
    const lamp = K.sph(0.018, K.m('ledRed').clone(), x, 1.12, 0.12);
    lamp.castShadow = false;
    panel.add(lamp); parts.lamps.push(lamp);
  }
  // big lever
  const leverBase = K.box(0.12, 0.2, 0.08, 'genMetal', 0.4, 1.15, 0.14);
  panel.add(leverBase);
  const lever = new THREE.Group();
  lever.add(K.cyl(0.012, 0.012, 0.32, 'chrome', 0, 0.16, 0, 0, 0, 0, 8));
  lever.add(K.sph(0.035, 'redMetal', 0, 0.33, 0));
  lever.position.set(0.4, 1.15, 0.2);
  lever.rotation.x = 0.6;
  panel.add(lever);
  parts.lever = lever;
  panel.position.set(-0.6, 0, 1.15);
  g.add(panel);
  parts.panel = panel;
  // cables from panel into floor
  g.add(K.tube([[-0.6, 1.0, 1.1], [-0.6, 0.3, 1.0], [-0.4, 0.02, 1.3], [0.6, 0.02, 1.6]], 0.02, 'cable', false, 6, 0.2));
  return { group: g, parts };
}

export function pump(K, gaugeTex) {
  const g = new THREE.Group();
  g.add(K.box(2.4, 0.2, 0.9, 'concrete', 0, 0.1, 0));
  g.add(K.box(2.2, 0.08, 0.7, 'yellowMetal', 0, 0.24, 0));
  // motor
  g.add(K.cyl(0.33, 0.33, 1.1, 'genMetal', 0.55, 0.65, 0, 0, 0, Math.PI / 2, 28));
  for (let i = 0; i < 12; i++) g.add(K.box(0.9, 0.035, 0.04, 'genMetal', 0.55, 0.65 + Math.sin(i / 12 * 6.28) * 0.34, Math.cos(i / 12 * 6.28) * 0.34, i / 12 * 6.28, 0, 0));
  g.add(K.cyl(0.36, 0.36, 0.08, 'genMetal', 1.12, 0.65, 0, 0, 0, Math.PI / 2, 28));
  g.add(K.box(0.3, 0.25, 0.25, 'genMetal', 0.55, 1.05, 0));
  // coupling guard
  g.add(K.cyl(0.14, 0.14, 0.3, 'yellowMetal', -0.1, 0.65, 0, 0, 0, Math.PI / 2, 16));
  // volute casing
  const vol = K.cyl(0.48, 0.48, 0.32, 'redMetal', -0.6, 0.72, 0, 0, 0, Math.PI / 2, 32);
  g.add(vol);
  g.add(K.torus(0.42, 0.08, 'redMetal', -0.6, 0.72, 0, 0, Math.PI / 2, 0, Math.PI * 2, 32));
  for (let i = 0; i < 12; i++) { const a = i / 12 * 6.28; g.add(K.cyl(0.018, 0.018, 0.36, 'chrome', -0.6, 0.72 + Math.sin(a) * 0.4, Math.cos(a) * 0.4, 0, 0, Math.PI / 2, 6)); }
  // inlet & outlet pipes
  g.add(K.tube([[-0.95, 0.72, 0], [-1.4, 0.72, 0], [-1.6, 0.72, 0]], 0.17, 'darkPipe', false, 16));
  g.add(K.tube([[-0.6, 1.2, 0], [-0.6, 2.2, 0], [-0.6, 4.0, 0], [-0.6, 5.0, 0]], 0.15, 'darkPipe', false, 16, 0.3));
  g.add(K.cyl(0.24, 0.24, 0.06, 'redMetal', -0.6, 1.6, 0, 0, 0, 0, 20));
  const vw = valveWheel(K, 0.2); vw.position.set(-0.6, 1.95, 0.3); g.add(vw);
  g.add(K.cyl(0.04, 0.04, 0.3, 'chrome', -0.6, 1.95, 0.15, Math.PI / 2, 0, 0, 8));
  const ga = gauge(K, gaugeTex); ga.group.position.set(-0.6, 2.4, 0.16); g.add(ga.group);
  return { group: g, needle: ga.needle };
}

export function drawerBank(K, cols, rows, labelTexes) {
  const g = new THREE.Group();
  const dw = 0.68, dh = 0.62, W = cols * dw, Hh = rows * dh;
  g.add(K.box(W + 0.1, Hh + 0.12, 0.08, 'stainless', 0, Hh / 2 + 0.12, -0.04));
  const doors = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const idx = r * cols + c;
    const x = -W / 2 + dw * (c + 0.5), y = 0.18 + dh * (r + 0.5);
    // recessed frame around each door
    g.add(K.box(dw, 0.02, 0.03, 'stainless', x, y - dh / 2, 0.01));
    const door = new THREE.Group();
    door.add(K.rbox(dw - 0.05, dh - 0.05, 0.04, 0.01, 'stainless', (dw - 0.05) / 2, 0, 0));
    door.add(K.box(0.04, 0.16, 0.05, 'chrome', dw - 0.12, 0, 0.04));
    door.add(K.box(0.12, 0.03, 0.03, 'chrome', dw - 0.17, 0.06, 0.06));
    if (labelTexes?.[idx]) {
      const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.05), new THREE.MeshStandardMaterial({ map: labelTexes[idx], roughness: 0.6 }));
      lab.position.set((dw - 0.05) / 2, 0.2, 0.021);
      door.add(lab);
    }
    door.position.set(x - (dw - 0.05) / 2, y, 0.02);
    g.add(door);
    doors.push(door);
  }
  return { group: g, doors, dw, dh };
}

export function autopsyTable(K) {
  const g = new THREE.Group();
  const vg = vesselGeo(0.8, 2.1, 0.06, 0.03, 0.05, 0.008);
  g.add(K.mesh(vg, 'stainless', 0, 0.88, 0, 0, 0, 0, 0.6));
  g.add(K.box(0.76, 0.02, 2.06, 'stainless', 0, 0.89, 0));
  g.add(K.cyl(0.03, 0.03, 0.01, 'blackPlastic', 0, 0.905, 0.9, 0, 0, 0, 12));
  g.add(K.cyl(0.14, 0.18, 0.86, 'stainless', 0, 0.45, 0.3, 0, 0, 0, 20));
  g.add(K.box(0.6, 0.06, 0.8, 'stainless', 0, 0.03, 0.3));
  // body block (head rest)
  g.add(K.rbox(0.18, 0.08, 0.12, 0.02, 'blackPlastic', 0, 0.94, -0.9));
  // drain hose
  g.add(K.tube([[0, 0.88, 0.95], [0, 0.6, 1.05], [0.1, 0.05, 1.1], [0.5, 0.01, 1.2]], 0.015, 'blackPlastic', false, 6, 0.1));
  return g;
}

export function surgicalLamp(K, drop = 1.2) {
  const g = new THREE.Group();
  g.add(K.cyl(0.02, 0.02, drop, 'chrome', 0, -drop / 2, 0, 0, 0, 0, 8));
  const head = K.lathe([[0, 0.05], [0.3, 0.02], [0.36, -0.05], [0.37, -0.08], [0.34, -0.09], [0.0, -0.07]], 'whiteMetal', 0, -drop, 0, 32);
  g.add(head);
  const bulbMat = K.m('bulb').clone();
  bulbMat.emissiveIntensity = 0;
  for (let i = 0; i < 7; i++) {
    const a = (i / 6) * Math.PI * 2;
    const r = i === 6 ? 0 : 0.2;
    const b = K.sph(0.05, bulbMat, Math.cos(a) * r, -drop - 0.085, Math.sin(a) * r, 1, 0.35, 1);
    b.castShadow = false; g.add(b);
  }
  g.add(K.cyl(0.025, 0.025, 0.2, 'chrome', 0.0, -drop - 0.17, 0, 0, 0, 0, 8));
  return { group: g, mat: bulbMat };
}

export function tub(K, opt = {}) {
  const g = new THREE.Group();
  const w = 0.82, l = 1.85, h = 0.62;
  const vg = vesselGeo(w, l, 0.3, 0.06, h - 0.06, 0.025);
  g.add(K.mesh(vg, 'porcelainDirty', 0, 0.12, 0, 0, 0, 0, 0.8));
  g.add(K.mesh(new THREE.ShapeGeometry(roundedRectShape(w - 0.1, l - 0.1, 0.26)).rotateX(-Math.PI / 2), 'porcelainDirty', 0, 0.16, 0, 0, 0, 0, 0.8));
  g.add(K.rbox(w - 0.02, 0.1, l - 0.02, 0.06, 'porcelainDirty', 0, 0.15, 0, 0, 0, 0, 0.8));
  // claw feet
  for (const x of [-w / 2 + 0.12, w / 2 - 0.12]) for (const z of [-l / 2 + 0.25, l / 2 - 0.25]) {
    g.add(K.sph(0.06, 'brass', x, 0.1, z, 1, 1.4, 1));
    g.add(K.sph(0.04, 'brass', x + Math.sign(x) * 0.02, 0.03, z, 1.3, 0.7, 1.3));
  }
  // faucet
  g.add(K.tube([[0, 0.55, -l / 2 - 0.05], [0, 0.95, -l / 2 - 0.05], [0, 0.95, -l / 2 + 0.12], [0, 0.85, -l / 2 + 0.15]], 0.018, 'brass', false, 8, 0.06));
  for (const x of [-0.12, 0.12]) g.add(valveWheel(K, 0.04, 'brass').translateX(x).translateY(0.8).translateZ(-l / 2 - 0.05));
  let water = null;
  if (opt.water) {
    water = new THREE.Mesh(new THREE.ShapeGeometry(roundedRectShape(w - 0.12, l - 0.12, 0.24)).rotateX(-Math.PI / 2), K.m('murk'));
    water.position.y = 0.12 + h * (opt.waterLevel ?? 0.7);
    water.receiveShadow = true;
    g.add(water);
  }
  if (opt.cover) {
    // canvas cover with a head hole: the 'continuous bath'
    const cs = roundedRectShape(w + 0.14, l + 0.1, 0.32);
    const hole = new THREE.Path(); hole.absarc(0, -l / 2 + 0.28, 0.13, 0, Math.PI * 2, true);
    cs.holes.push(hole);
    const cg = new THREE.ShapeGeometry(cs, 24); cg.rotateX(-Math.PI / 2);
    const p = cg.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const edge = Math.max(0, Math.abs(x) - w / 2 + 0.03) * 3 + Math.max(0, Math.abs(z) - l / 2 + 0.03) * 3;
      p.setY(i, -edge * 0.25 + Math.sin(x * 14) * Math.sin(z * 5) * 0.012 - Math.exp(-(x * x) / 0.05) * 0.03);
    }
    cg.computeVertexNormals();
    g.add(K.mesh(cg, 'sheet', 0, 0.12 + h + 0.03, 0, 0, 0, 0, 0.6));
    for (const z of [-0.4, 0.2, 0.7]) g.add(K.box(w + 0.18, 0.012, 0.06, 'leather', 0, 0.12 + h + 0.035, z));
  }
  return { group: g, water };
}

export function tank(K, w, l, h) {
  const g = new THREE.Group();
  const vg = vesselGeo(w, l, 0.15, 0.2, h, 0.03);
  g.add(K.mesh(vg, 'tiles', 0, 0, 0, 0, 0, 0, 3));
  const water = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.4, l - 0.4), K.m('murk'));
  water.rotation.x = -Math.PI / 2; water.position.y = h - 0.25; water.receiveShadow = true;
  g.add(water);
  // ladder
  for (const x of [-0.2, 0.2]) g.add(K.tube([[x, 0.3, -l / 2 + 0.25], [x, h + 0.5, -l / 2 + 0.25], [x, h + 0.5, -l / 2 - 0.05], [x, h, -l / 2 - 0.15]], 0.018, 'chrome', false, 6, 0.12));
  for (let y = 0.4; y < h + 0.4; y += 0.28) g.add(K.cyl(0.012, 0.012, 0.4, 'chrome', 0, y, -l / 2 + 0.25, 0, 0, Math.PI / 2, 6));
  // railing along one side
  for (let z = -l / 2 + 0.6; z <= l / 2 - 0.2; z += (l - 0.8) / 3) g.add(K.cyl(0.02, 0.02, 0.9, 'chrome', w / 2 - 0.1, h + 0.45, z, 0, 0, 0, 8));
  g.add(K.tube([[w / 2 - 0.1, h + 0.9, -l / 2 + 0.6], [w / 2 - 0.1, h + 0.9, l / 2 - 0.2]], 0.022, 'chrome'));
  return { group: g, water };
}

export function sinkUnit(K) {
  const g = new THREE.Group();
  const basin = K.mesh(vesselGeo(0.55, 0.42, 0.12, 0.035, 0.16, 0.012), 'ceramic', 0, 0.68, 0, 0, 0, 0, 0.6);
  g.add(basin);
  g.add(K.rbox(0.5, 0.03, 0.37, 0.05, 'ceramic', 0, 0.69, 0));
  g.add(K.cyl(0.02, 0.02, 0.01, 'chrome', 0, 0.71, 0.0, 0, 0, 0, 10));
  g.add(K.cyl(0.04, 0.05, 0.6, 'ceramic', 0, 0.35, -0.12, 0, 0, 0, 16));
  g.add(K.tube([[0, 0.84, -0.2], [0, 0.96, -0.2], [0, 0.96, -0.08], [0, 0.9, -0.05]], 0.012, 'chrome', false, 8, 0.04));
  for (const x of [-0.12, 0.12]) g.add(K.cyl(0.018, 0.022, 0.05, 'chrome', x, 0.88, -0.19, 0, 0, 0, 10));
  return g;
}

export function toilet(K) {
  const g = new THREE.Group();
  g.add(K.lathe([[0, 0], [0.13, 0], [0.12, 0.2], [0.17, 0.35], [0.2, 0.4], [0.17, 0.41], [0.14, 0.36], [0.05, 0.25], [0, 0.25]], 'ceramic', 0, 0, 0.05, 24));
  g.children[0].scale.set(1, 1, 1.25);
  g.add(K.rbox(0.42, 0.38, 0.18, 0.03, 'ceramic', 0, 0.6, -0.24));
  g.add(K.rbox(0.38, 0.03, 0.44, 0.01, 'blackPlastic', 0, 0.42, 0.06, -1.3, 0, 0));
  return g;
}

export function chain(K, len, mat = 'rust') {
  const g = new THREE.Group();
  const n = Math.floor(len / 0.06);
  for (let i = 0; i < n; i++) g.add(K.torus(0.025, 0.006, mat, 0, -i * 0.06, 0, 0, i % 2 ? Math.PI / 2 : 0, 0, Math.PI * 2, 10));
  return g;
}

export function workbench(K) {
  const g = new THREE.Group();
  g.add(K.rbox(2.0, 0.06, 0.75, 0.01, 'wood', 0, 0.9, 0));
  for (const x of [-0.95, 0.95]) for (const z of [-0.32, 0.32]) g.add(K.box(0.05, 0.88, 0.05, 'genMetal', x, 0.44, z));
  g.add(K.box(1.9, 0.03, 0.65, 'genMetal', 0, 0.25, 0));
  // vise
  g.add(K.box(0.18, 0.12, 0.14, 'genMetal', 0.8, 0.99, 0.3));
  g.add(K.cyl(0.012, 0.012, 0.3, 'chrome', 0.8, 0.98, 0.45, 0, 0, Math.PI / 2, 6));
  // toolbox
  g.add(K.rbox(0.5, 0.22, 0.24, 0.02, 'redMetal', -0.5, 1.04, -0.1));
  g.add(K.tube([[-0.68, 1.15, -0.1], [-0.68, 1.22, -0.1], [-0.32, 1.22, -0.1], [-0.32, 1.15, -0.1]], 0.008, 'chrome', false, 6, 0.03));
  // wrench & screwdriver
  g.add(K.box(0.24, 0.008, 0.025, 'chrome', 0.1, 0.935, 0.15, 0, 0.4, 0));
  g.add(K.cyl(0.012, 0.012, 0.1, 'binderRed', 0.35, 0.945, 0.1, 0, 0, Math.PI / 2, 8));
  g.add(K.cyl(0.003, 0.003, 0.12, 'chrome', 0.46, 0.945, 0.1, 0, 0, Math.PI / 2, 6));
  // pegboard
  g.add(K.box(1.8, 0.9, 0.02, 'cork', 0, 1.6, -0.36));
  return g;
}

export function barrel(K, mat = 'redMetal') {
  const g = new THREE.Group();
  g.add(K.cyl(0.29, 0.29, 0.88, mat, 0, 0.44, 0, 0, 0, 0, 28));
  for (const y of [0.02, 0.3, 0.58, 0.86]) g.add(K.torus(0.292, 0.012, mat, 0, y, 0, Math.PI / 2, 0, 0, Math.PI * 2, 28));
  g.add(K.cyl(0.04, 0.04, 0.02, 'chrome', 0.15, 0.885, 0, 0, 0, 0, 10));
  return g;
}

export function fuelTank(K) {
  const g = new THREE.Group();
  g.add(K.cyl(0.6, 0.6, 2.6, 'yellowMetal', 0, 0.9, 0, 0, 0, Math.PI / 2, 32));
  for (const x of [-1.3, 1.3]) g.add(K.sph(0.6, 'yellowMetal', x, 0.9, 0, 0.2, 1, 1, 24));
  for (const x of [-0.8, 0.8]) g.add(K.box(0.15, 0.4, 1.0, 'genMetal', x, 0.2, 0));
  g.add(K.cyl(0.08, 0.08, 0.15, 'chrome', 0.5, 1.55, 0, 0, 0, 0, 12));
  return g;
}

export function corpse(K) {
  // the previous enumerator, slumped against a wall, legs out. local +z = facing
  const g = new THREE.Group();
  const skin = 'corpseSkin', cloth = 'coat', pants = 'denim';
  const cap = (r, l, mat, x, y, z, rx, ry, rz) => {
    const m = K.mesh(new THREE.CapsuleGeometry(r, l, 6, 14), mat, x, y, z, rx, ry, rz, 0.4);
    return m;
  };
  g.add(cap(0.13, 0.32, pants, 0, 0.16, 0.08, 0, 0, Math.PI / 2)); // hips
  g.add(cap(0.17, 0.35, cloth, 0, 0.5, -0.02, -0.25, 0, 0)); // torso
  g.add(cap(0.06, 0.4, pants, -0.1, 0.1, 0.42, Math.PI / 2 - 0.05, 0.1, 0));
  g.add(cap(0.06, 0.4, pants, 0.12, 0.12, 0.42, Math.PI / 2 + 0.1, -0.2, 0));
  g.add(cap(0.055, 0.4, pants, -0.12, 0.08, 0.9, Math.PI / 2, 0.05, 0));
  g.add(cap(0.055, 0.38, pants, 0.2, 0.18, 0.82, Math.PI / 2 - 0.4, -0.25, 0));
  for (const [x, z] of [[-0.12, 1.16], [0.24, 1.05]]) g.add(K.rbox(0.1, 0.1, 0.25, 0.04, 'leather', x, 0.07, z));
  // arms limp
  g.add(cap(0.05, 0.28, cloth, -0.24, 0.48, 0.04, 0.2, 0, 0.15));
  g.add(cap(0.045, 0.25, cloth, -0.27, 0.22, 0.2, 1.2, 0, 0.1));
  g.add(cap(0.05, 0.28, cloth, 0.24, 0.5, 0.05, 0.4, 0, -0.3));
  g.add(cap(0.045, 0.25, cloth, 0.33, 0.3, 0.28, 1.0, 0, -0.2));
  g.add(K.sph(0.05, skin, -0.29, 0.06, 0.34, 1, 0.5, 1.4));
  g.add(K.sph(0.05, skin, 0.36, 0.17, 0.44, 1, 0.5, 1.4));
  // head lolled to side
  g.add(cap(0.045, 0.06, skin, 0.03, 0.78, -0.04, 0, 0, -0.5));
  const head = K.sph(0.11, skin, 0.1, 0.86, 0.0, 0.9, 1.1, 1.0);
  g.add(head);
  g.add(K.sph(0.06, 'meat', 0.1, 0.8, 0.08, 1.2, 0.6, 0.5)); // jaw wound
  // census lanyard
  g.add(K.box(0.07, 0.1, 0.004, 'paperProp', -0.02, 0.5, 0.15, -0.3, 0, 0, 0));
  return g;
}

export function brokenElevator(K) {
  // service elevator in the lobby: doors pried open, car dropped below, cables dangling
  const g = new THREE.Group();
  // frame
  g.add(K.box(1.6, 0.25, 0.25, 'elevator', 0, 2.45, 0.05));
  for (const x of [-0.8, 0.8]) g.add(K.box(0.2, 2.6, 0.25, 'elevator', x, 1.3, 0.05));
  // shaft interior darkness
  g.add(K.box(1.4, 2.4, 0.02, 'void', 0, 1.2, -0.9, 0, 0, 0, 0));
  for (const x of [-0.7, 0.7]) g.add(K.box(0.02, 2.4, 1.0, 'concreteWall', x, 1.2, -0.45));
  // car roof visible low in shaft, skewed
  g.add(K.box(1.35, 0.06, 0.9, 'elevator', 0, 0.35, -0.45, 0.05, 0, 0.06));
  g.add(K.box(0.4, 0.2, 0.3, 'genMetal', 0.2, 0.48, -0.5));
  // cables
  for (let i = 0; i < 4; i++) g.add(K.tube([[-0.25 + i * 0.12, 2.5, -0.5], [-0.25 + i * 0.12 + rr(-0.05, 0.05), 1.4, -0.45], [-0.3 + i * 0.15, 0.45, -0.4]], 0.008, 'cable', false, 5, 0.3));
  // doors pried open
  const doors = [];
  for (const s of [-1, 1]) {
    const d = K.box(0.68, 2.3, 0.05, 'elevator', s * 0.62, 1.15, 0.0, 0, s * 0.08, 0);
    g.add(d); doors.push(d);
  }
  g.add(K.box(1.4, 0.05, 0.3, 'stainless', 0, 0.025, 0.1));
  return g;
}

export function liftDoors(K, width = 3.8, h = 2.6) {
  const g = new THREE.Group();
  g.add(K.box(width + 0.4, 0.35, 0.3, 'yellowMetal', 0, h + 0.175, 0));
  for (const x of [-width / 2 - 0.1, width / 2 + 0.1]) g.add(K.box(0.2, h, 0.3, 'yellowMetal', x, h / 2, 0));
  const panels = [];
  for (const s of [-1, 1]) {
    const p = new THREE.Group();
    p.add(K.box(width / 2, h, 0.06, 'elevator', 0, h / 2, 0));
    for (let y = 0.4; y < h; y += 0.55) p.add(K.box(width / 2 - 0.1, 0.04, 0.02, 'elevator', 0, y, 0.04));
    p.add(K.box(width / 2, 0.3, 0.01, 'yellowMetal', 0, 0.2, 0.035));
    p.position.x = s * width / 4;
    p.userData.closedX = s * width / 4;
    p.userData.side = s;
    g.add(p); panels.push(p);
  }
  return { group: g, panels };
}

export function callPanel(K) {
  const g = new THREE.Group();
  g.add(K.box(0.18, 0.36, 0.04, 'stainless', 0, 0, 0.02));
  const up = K.cyl(0.03, 0.03, 0.02, K.m('ledOff'), 0, 0.06, 0.045, Math.PI / 2, 0, 0, 16);
  const dn = K.cyl(0.03, 0.03, 0.02, 'blackPlastic', 0, -0.06, 0.045, Math.PI / 2, 0, 0, 16);
  g.add(up, dn);
  return { group: g, button: up };
}

export function keypadBox(K) {
  const g = new THREE.Group();
  g.add(K.rbox(0.24, 0.32, 0.06, 0.01, 'genMetal', 0, 0, 0.03));
  g.add(K.box(0.18, 0.05, 0.005, 'crtScreen', 0, 0.1, 0.062, 0, 0, 0, 0));
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) g.add(K.rbox(0.045, 0.04, 0.02, 0.005, 'beigePlastic', -0.055 + c * 0.055, 0.03 - r * 0.05, 0.065));
  const led = K.sph(0.012, K.m('ledRed').clone(), 0.09, 0.13, 0.065);
  g.add(led);
  return { group: g, led };
}

export function cardReader(K) {
  const g = new THREE.Group();
  g.add(K.rbox(0.1, 0.16, 0.04, 0.008, 'blackPlastic', 0, 0, 0.02));
  g.add(K.box(0.07, 0.01, 0.02, 'void', 0, 0.02, 0.042, 0, 0, 0, 0));
  const led = K.sph(0.01, K.m('ledRed').clone(), 0, 0.06, 0.042);
  g.add(led);
  return { group: g, led };
}

export function debrisTile(K) {
  const g = new THREE.Group();
  g.add(K.box(0.6, 0.015, 0.6, 'ceiling', 0, 0.02, 0, 0.05, rnd(), 0.1, 0.6));
  return g;
}

export function bucketMop(K) {
  const g = new THREE.Group();
  g.add(K.lathe([[0, 0], [0.13, 0], [0.16, 0.3], [0.165, 0.31], [0.155, 0.31], [0.125, 0.02], [0, 0.02]], 'yellowMetal', 0, 0, 0, 20));
  const w = new THREE.Mesh(new THREE.CircleGeometry(0.15, 20), K.m('murk'));
  w.rotation.x = -Math.PI / 2; w.position.y = 0.22; g.add(w);
  g.add(K.cyl(0.012, 0.012, 1.4, 'wood', 0.05, 0.75, 0, 0, 0, 0.2, 6));
  for (let i = 0; i < 20; i++) g.add(K.cyl(0.008, 0.004, 0.25, 'sheet', 0.0 + rr(-0.06, 0.06), 0.12, rr(-0.06, 0.06), rr(-0.4, 0.4), 0, rr(-0.4, 0.4), 4));
  return g;
}

export function stall(K, w, d) {
  const g = new THREE.Group();
  g.add(K.box(0.03, 1.8, d, 'locker', -w / 2, 1.05, 0));
  g.add(K.box(0.03, 1.8, d, 'locker', w / 2, 1.05, 0));
  for (const x of [-w / 2, w / 2]) for (const z of [-d / 2 + 0.1, d / 2 - 0.1]) g.add(K.cyl(0.015, 0.015, 0.15, 'chrome', x, 0.075, z, 0, 0, 0, 6));
  const door = K.box(w - 0.08, 1.6, 0.025, 'locker', (w - 0.08) / 2, 0, 0);
  const dg = new THREE.Group();
  door.position.y = 1.0; dg.add(door);
  dg.position.set(-w / 2 + 0.04, 0, d / 2);
  dg.rotation.y = -1.2;
  g.add(dg);
  return g;
}

// Merge every mesh under `group` into one mesh per material (in group-local space).
// Subtrees listed in `keep` are left untouched so they can still animate.
import { mergeGeometries as _merge } from 'three/addons/utils/BufferGeometryUtils.js';
export function compact(group, keep = []) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const keepSet = new Set(keep);
  const buckets = new Map();
  const remove = [];
  const visit = (o) => {
    if (keepSet.has(o)) return;
    if (o.isMesh && o.layers.mask === 1 && !o.material.transparent) {
      let g = o.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      if (g.index) g = g.toNonIndexed();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!buckets.has(o.material)) buckets.set(o.material, { geos: [], cast: false });
      const b = buckets.get(o.material); b.geos.push(g); b.cast ||= o.castShadow;
      remove.push(o);
    }
    for (const c of o.children) visit(c);
  };
  for (const c of group.children) visit(c);
  for (const o of remove) o.parent.remove(o);
  for (const [mat, b] of buckets) {
    const m = new THREE.Mesh(_merge(b.geos, false), mat);
    m.castShadow = b.cast; m.receiveShadow = true;
    group.add(m);
  }
  return group;
}
