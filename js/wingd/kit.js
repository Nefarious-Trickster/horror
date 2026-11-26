/* Wing D "Build-Out" environment kit (Chapter 1).
 *
 * CREDITS (all CC0 1.0, public domain):
 *   Poly Haven models (https://polyhaven.com, converted by tools/fetch_kit_assets.py):
 *     portable_generator         https://polyhaven.com/a/portable_generator
 *     flood_lights               https://polyhaven.com/a/flood_lights
 *     power_box_01               https://polyhaven.com/a/power_box_01
 *     metal_office_desk          https://polyhaven.com/a/metal_office_desk
 *     metal_tool_chest           https://polyhaven.com/a/metal_tool_chest
 *     cement_bag                 https://polyhaven.com/a/cement_bag
 *     cardboard_box_01           https://polyhaven.com/a/cardboard_box_01
 *     plastic_crate_03           https://polyhaven.com/a/plastic_crate_03
 *     ladder_sectioned_01        https://polyhaven.com/a/ladder_sectioned_01
 *     hand_truck                 https://polyhaven.com/a/hand_truck
 *     steel_frame_shelves_01     https://polyhaven.com/a/steel_frame_shelves_01
 *     propane_tank               https://polyhaven.com/a/propane_tank
 *     metal_jerrycan             https://polyhaven.com/a/metal_jerrycan
 *     plastic_jerrycan           https://polyhaven.com/a/plastic_jerrycan
 *     sledgehammer_01            https://polyhaven.com/a/sledgehammer_01
 *     crowbar_01                 https://polyhaven.com/a/crowbar_01
 *     Drill_01                   https://polyhaven.com/a/Drill_01
 *     spray_paint_bottles        https://polyhaven.com/a/spray_paint_bottles
 *     trashbag                   https://polyhaven.com/a/trashbag
 *     wooden_broom               https://polyhaven.com/a/wooden_broom
 *     plastic_monobloc_chair_01  https://polyhaven.com/a/plastic_monobloc_chair_01
 *     portable_cassette_player   https://polyhaven.com/a/portable_cassette_player
 *     classic_laptop             https://polyhaven.com/a/classic_laptop
 *     clipboard                  https://polyhaven.com/a/clipboard
 *     binder_notebook            https://polyhaven.com/a/binder_notebook
 *     wall_clock                 https://polyhaven.com/a/wall_clock
 *     desk_lamp_arm_01           https://polyhaven.com/a/desk_lamp_arm_01
 *     fire_alarm                 https://polyhaven.com/a/fire_alarm
 *     caged_hanging_light        https://polyhaven.com/a/caged_hanging_light
 *   ambientCG materials (https://ambientcg.com):
 *     Concrete023  https://ambientcg.com/a/Concrete023   floor slab (2K)
 *     Concrete028  https://ambientcg.com/a/Concrete028   cast concrete columns / walls / soffit (2K)
 *     Concrete036  https://ambientcg.com/a/Concrete036   old dusty concrete, blocks
 *     Wood087      https://ambientcg.com/a/Wood087       plywood, timber
 *     Chipboard004 https://ambientcg.com/a/Chipboard004  OSB
 *     Plaster002   https://ambientcg.com/a/Plaster002    drywall face
 *     Metal055A    https://ambientcg.com/a/Metal055A     galvanised / painted steel
 *     Metal021     https://ambientcg.com/a/Metal021      rust-spotted steel
 *     DiamondPlate008C https://ambientcg.com/a/DiamondPlate008C  lift car floor
 *     Fabric045    https://ambientcg.com/a/Fabric045     mineral wool insulation
 *   Also uses the repo's existing ambientCG set Metal009 (brushed steel, lift car).
 *
 * Usage:
 *   import { loadKit, KIT } from './wingd/kit.js';
 *   await loadKit((done, total) => ...);
 *   scene.add(KIT.studWall({ length: 6, boards: 0.4, openings: [{ at: 2, width: 0.9 }] }));
 *
 * Conventions: metres, +Y up. Every factory returns a THREE.Group with its origin on the floor at the
 * centre of its footprint and its long axis along +X (front +Z for wall-mounted / faced items).
 * Shadows are set on every mesh. Colliders: userData.collider = { w, d } (footprint, axis-aligned in
 * local space) or userData.colliders = [{ minX, maxX, minZ, maxZ }] (local space) for long pieces.
 * No THREE lights are created: the level adds its own. Static sub-meshes are merged per material and
 * materials are shared between instances (state changes swap between shared on/off materials).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const PI = Math.PI, TAU = PI * 2, HP = PI / 2;
const SRGB = THREE.SRGBColorSpace;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

const modelUrl = (id) => new URL(`../../assets/models/${id}/${id}.json`, import.meta.url);
const texUrl = (id, map) => new URL(`../../assets/textures/${id}/${map}.jpg`, import.meta.url);

export const MODEL_IDS = [
  'portable_generator', 'flood_lights', 'power_box_01', 'metal_office_desk', 'metal_tool_chest', 'cement_bag',
  'cardboard_box_01', 'plastic_crate_03', 'ladder_sectioned_01', 'hand_truck', 'steel_frame_shelves_01',
  'propane_tank', 'metal_jerrycan', 'plastic_jerrycan', 'sledgehammer_01', 'crowbar_01', 'Drill_01',
  'spray_paint_bottles', 'trashbag', 'wooden_broom', 'plastic_monobloc_chair_01', 'portable_cassette_player',
  'classic_laptop', 'clipboard', 'binder_notebook', 'wall_clock', 'desk_lamp_arm_01', 'fire_alarm', 'caged_hanging_light',
];
const TEX_SETS = {
  Concrete023: ['color', 'normal', 'roughness'],
  Concrete028: ['color', 'normal', 'roughness', 'ao'],
  Concrete036: ['color', 'normal', 'roughness'],
  Wood087: ['color', 'normal', 'roughness'],
  Chipboard004: ['color', 'normal', 'roughness'],
  Plaster002: ['color', 'normal', 'roughness'],
  Metal055A: ['color', 'normal', 'roughness', 'metalness'],
  Metal021: ['color', 'normal', 'roughness', 'metalness'],
  DiamondPlate008C: ['color', 'normal', 'roughness', 'metalness'],
  Fabric045: ['color', 'normal', 'roughness'],
  Metal009: ['color', 'normal', 'roughness'],
};

// ------------------------------------------------------------------ random
function rng(seed = 1) {
  let a = (seed >>> 0) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let _autoSeed = 101;
const seedOf = (s) => (s ?? (_autoSeed += 7919)) >>> 0;
const range = (r, a, b) => a + (b - a) * r();
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];

// ------------------------------------------------------------------ canvas helpers
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function canvasTex(w, h, draw, { srgb = true, repeat = true } = {}) {
  const c = mkCanvas(w, h);
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = SRGB;
  t.userData.canvas = c;
  return t;
}
// cheap value noise for canvas painting
function noise2(seed = 1) {
  const r = rng(seed), N = 256, p = new Float32Array(N * N);
  for (let i = 0; i < p.length; i++) p[i] = r();
  const at = (x, y) => p[((y & 255) << 8) | (x & 255)];
  const sm = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = sm(x - xi), yf = sm(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}
function fbm(n, x, y, oct = 4) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f); f *= 2.03; a *= 0.5; } return s / (1 - Math.pow(0.5, oct)); }

function stencilText(g, s, x, y, px, { color = '#111', font = 'Arial Black, Arial, sans-serif', weight = 900, align = 'center', base = 'middle', spacing = 0, maxW = 0 } = {}) {
  g.save();
  g.font = `${weight} ${px}px ${font}`;
  if ('letterSpacing' in g) g.letterSpacing = `${spacing * px}px`;
  if (maxW) { const m = g.measureText(s).width; if (m > maxW) { px *= maxW / m; g.font = `${weight} ${px}px ${font}`; if ('letterSpacing' in g) g.letterSpacing = `${spacing * px}px`; } }
  g.fillStyle = color; g.textAlign = align; g.textBaseline = base;
  g.fillText(s, x, y);
  g.restore();
}
// spray-paint look: blurred overspray + core + a few drips
function sprayText(g, s, x, y, px, color, r, { maxW = 0, drips = true } = {}) {
  g.save();
  g.font = `900 ${px}px Arial Black, Arial, sans-serif`;
  if (maxW) { const m = g.measureText(s).width; if (m > maxW) { px *= maxW / m; g.font = `900 ${px}px Arial Black, Arial, sans-serif`; } }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = color;
  g.filter = `blur(${px * 0.09}px)`; g.globalAlpha = 0.45; g.fillText(s, x, y);
  g.filter = `blur(${px * 0.025}px)`; g.globalAlpha = 0.9; g.fillText(s, x, y);
  g.filter = 'none'; g.globalAlpha = 1;
  if (drips) {
    const w = g.measureText(s).width;
    for (let i = 0; i < 4; i++) {
      if (r() < 0.4) continue;
      const dx = x - w / 2 + r() * w, dy = y + px * 0.3, len = px * (0.2 + r() * 0.7);
      const gr = g.createLinearGradient(0, dy, 0, dy + len); gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.strokeStyle = gr; g.lineWidth = px * 0.035; g.lineCap = 'round';
      g.beginPath(); g.moveTo(dx, dy); g.lineTo(dx + (r() - 0.5) * 2, dy + len); g.stroke();
    }
  }
  // speckle overspray
  for (let i = 0; i < 260; i++) {
    const w = g.measureText(s).width;
    g.globalAlpha = 0.25 + r() * 0.4; g.fillStyle = color;
    g.fillRect(x - w * 0.6 + r() * w * 1.2, y - px * 0.7 + r() * px * 1.4, 1 + r() * 1.5, 1 + r() * 1.5);
  }
  g.restore();
}

// ------------------------------------------------------------------ geometry helpers
// Box-projected world UVs (by face normal). `scale` = size in metres of one texture tile.
// Also writes uv1 (same values) so aoMaps work.
export function worldUV(geometry, scale = 1, { channel = 'both', offset = [0, 0] } = {}) {
  const p = geometry.attributes.position, n = geometry.attributes.normal;
  if (!n) geometry.computeVertexNormals();
  const nn = geometry.attributes.normal;
  const sx = Array.isArray(scale) ? scale[0] : scale, sy = Array.isArray(scale) ? scale[1] : scale;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(nn.getX(i)), ay = Math.abs(nn.getY(i)), az = Math.abs(nn.getZ(i));
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let u, v;
    if (ay >= ax && ay >= az) { u = x; v = -z; }
    else if (ax >= az) { u = nn.getX(i) > 0 ? -z : z; v = y; }
    else { u = nn.getZ(i) > 0 ? x : -x; v = y; }
    uv[i * 2] = u / sx + offset[0]; uv[i * 2 + 1] = v / sy + offset[1];
  }
  if (channel !== 'uv1') geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (channel !== 'uv') geometry.setAttribute('uv1', new THREE.BufferAttribute(uv.slice(), 2));
  return geometry;
}

// normalise a geometry to non-quantised float attributes (position, normal, uv, uv1), indexed
function cleanGeo(g, keepUv1 = true) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'uv1', 'color']) {
    const a = g.attributes[name];
    if (!a) continue;
    if (name === 'uv1' && !keepUv1) continue;
    const arr = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(i, k);
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  if (!out.attributes.normal) out.computeVertexNormals();
  const n = out.attributes.position.count;
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (keepUv1 && !out.attributes.uv1) out.setAttribute('uv1', out.attributes.uv.clone());
  if (g.index) out.setIndex(Array.from(g.index.array));
  else { const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n); for (let i = 0; i < n; i++) idx[i] = i; out.setIndex(new THREE.BufferAttribute(idx, 1)); }
  return out;
}
function mergeAll(geos) {
  if (geos.length === 1) return geos[0];
  // align attribute sets
  const names = new Set();
  for (const g of geos) for (const k of Object.keys(g.attributes)) names.add(k);
  for (const g of geos) {
    const n = g.attributes.position.count;
    for (const k of names) if (!g.attributes[k]) {
      const size = k === 'color' ? 3 : k.startsWith('uv') ? 2 : 3;
      const arr = new Float32Array(n * size); if (k === 'color') arr.fill(1);
      g.setAttribute(k, new THREE.BufferAttribute(arr, size));
    }
  }
  const m = mergeGeometries(geos, false);
  if (!m) throw new Error('mergeGeometries failed');
  return m;
}
function shadow(o, cast = true, receive = true) { o.traverse((m) => { if (m.isMesh) { m.castShadow = cast; m.receiveShadow = receive; } }); return o; }

// Collects geometry per material key, then merges into one mesh per material.
class Parts {
  constructor() { this.map = new Map(); }
  // geo is in local space of the piece; uv: number (world tile size) | false (keep geometry uvs)
  add(key, geo, { uv = null, matrix = null, uv1 = null } = {}) {
    if (matrix) geo.applyMatrix4(matrix);
    const m = typeof key === 'string' ? MAT[key] : key;
    const tile = uv ?? m?.userData?.tile;
    if (tile && uv !== false) worldUV(geo, tile);
    if (uv1) geo.setAttribute('uv1', uv1);
    const g = cleanGeo(geo);
    if (!this.map.has(key)) this.map.set(key, []);
    this.map.get(key).push(g);
    return g;
  }
  box(key, cx, cy, cz, sx, sy, sz, { rx = 0, ry = 0, rz = 0, uv = null } = {}) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    const m = new THREE.Matrix4().compose(V3(cx, cy, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V3(1, 1, 1));
    return this.add(key, g, { matrix: m, uv });
  }
  // box from min/max corners
  bb(key, x0, y0, z0, x1, y1, z1, opts) { return this.box(key, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, opts); }
  // cylinder between two points
  tube(key, a, b, r, seg = 8, { uv = null, cap = true } = {}) {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1, !cap);
    const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.normalize());
    const m = new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, V3(1, 1, 1));
    return this.add(key, g, { matrix: m, uv });
  }
  build(group = new THREE.Group(), { cast = true, receive = true } = {}) {
    for (const [key, geos] of this.map) {
      const mat = typeof key === 'string' ? MAT[key] : key;
      const mesh = new THREE.Mesh(mergeAll(geos), mat);
      mesh.name = typeof key === 'string' ? key : (mat.name || 'part');
      mesh.castShadow = cast && !mat.transparent; mesh.receiveShadow = receive;
      group.add(mesh);
    }
    return group;
  }
}

// ------------------------------------------------------------------ shader tweaks
// detail: the aoMap (uv1) also multiplies albedo (direct light too) -> grime / tie holes / per-piece dirt.
// macro: breaks texture tiling by modulating the colour map with a low-frequency, rotated copy of itself.
function enhance(mat, { detail = false, macro = 0, macroStrength = 0.35, dust = 0 } = {}) {
  mat.userData.enh = { detail, macro, macroStrength, dust };
  mat.customProgramCacheKey = () => `wd:${detail ? 1 : 0}:${macro}:${macroStrength}:${dust}`;
  mat.onBeforeCompile = (sh) => {
    let code = '';
    if (macro) code += `
      #ifdef USE_MAP
      {
        vec2 muv = vMapUv * ${(+macro).toFixed(4)};
        muv = vec2(muv.x * 0.8 - muv.y * 0.6, muv.x * 0.6 + muv.y * 0.8) + 0.37;
        vec3 avg = textureLod(map, vec2(0.5), 12.0).rgb + 1e-3;
        vec3 m1 = texture2D(map, muv).rgb / avg;
        vec3 m2 = texture2D(map, vMapUv * ${(+macro * 0.29).toFixed(4)} + vec2(0.13, 0.71)).rgb / avg;
        float k = clamp(dot(m1 * 0.6 + m2 * 0.4, vec3(0.3333)), 0.4, 1.8);
        diffuseColor.rgb *= mix(1.0, k, ${(+macroStrength).toFixed(3)});
      }
      #endif`;
    if (detail) code += `
      #ifdef USE_AOMAP
      diffuseColor.rgb *= texture2D(aoMap, vAoMapUv).rgb;
      #endif`;
    if (dust) code += `
      { // dust settles on up-facing surfaces
        float up = clamp(dot(normalize(vDustN), vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.40, 0.37), up * up * ${(+dust).toFixed(3)});
      }`;
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + code);
    if (dust) {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vDustN;')
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvDustN = mat3(modelMatrix) * objectNormal;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vDustN;');
    }
  };
  return mat;
}

// ------------------------------------------------------------------ loading
const TEX = {};          // TEX[id][map] -> Texture
const MODELS = {};       // id -> { scene (raw gltf scene), template (baked Group) }
export const MAT = {};   // shared materials (KIT.materials)
let _loading = null;

function b64ToBytes(b64) {
  const bin = atob(b64), n = bin.length, out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function makeGLB(json, bin) {
  const js = new TextEncoder().encode(JSON.stringify(json));
  const jp = (4 - (js.length % 4)) % 4, bp = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + js.length + jp + 8 + bin.length + bp;
  const buf = new ArrayBuffer(total), dv = new DataView(buf), u8 = new Uint8Array(buf);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, js.length + jp, true); dv.setUint32(16, 0x4e4f534a, true);
  u8.set(js, 20); u8.fill(0x20, 20 + js.length, 20 + js.length + jp);
  const o = 20 + js.length + jp;
  dv.setUint32(o, bin.length + bp, true); dv.setUint32(o + 4, 0x004e4942, true);
  u8.set(bin, o + 8);
  return buf;
}
async function loadModel(id) {
  const url = modelUrl(id);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`kit: ${id} ${res.status}`);
  const json = await res.json();
  const uri = json.buffers[0].uri;
  const bin = b64ToBytes(uri.slice(uri.indexOf(',') + 1));
  json.buffers[0] = { byteLength: bin.length };
  const base = new URL('./', url).href;
  const gltf = await new GLTFLoader().parseAsync(makeGLB(json, bin), base);
  return gltf.scene;
}

// Bake a (subset of a) gltf scene into one mesh per material, float attributes, origin on the floor
// at the footprint centre.
function bake(scene, filter = null, { center = true } = {}) {
  scene.updateMatrixWorld(true);
  const byMat = new Map();
  const inFilter = (o) => { if (!filter) return true; for (let p = o; p; p = p.parent) if (p.name && filter(p.name)) return true; return false; };
  scene.traverse((o) => {
    if (!o.isMesh || !inFilter(o)) return;
    const g = cleanGeo(o.geometry, false).applyMatrix4(o.matrixWorld);
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(g);
  });
  const group = new THREE.Group();
  const box = new THREE.Box3();
  const merged = [];
  for (const [mat, geos] of byMat) {
    const g = mergeAll(geos);
    g.computeBoundingBox(); box.union(g.boundingBox);
    merged.push([g, mat]);
  }
  const off = center ? V3(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2) : V3();
  for (const [g, mat] of merged) {
    g.translate(off.x, off.y, off.z);
    g.computeBoundingSphere(); g.computeBoundingBox();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = !mat.transparent; m.receiveShadow = true;
    group.add(m);
  }
  box.translate(off);
  group.userData.box = box;
  group.userData.offset = off;
  return group;
}

function tuneModelMaterials(scene) {
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    if (m.transmission > 0) { m.transmission = 0; m.transparent = true; m.opacity = Math.min(m.opacity, 0.22); m.depthWrite = false; m.roughness = 0.08; }
    if (m.transparent && !/glass/i.test(m.name)) { m.transparent = false; m.alphaTest = 0.5; m.depthWrite = true; }
    if (m.emissiveMap) m.userData.emissiveOn = m.emissiveIntensity || 1;
    m.envMapIntensity = 1;
    if (!/glass|bristle|cable|trash/i.test(m.name)) m.side = THREE.FrontSide;
  });
}

async function loadTextures(onTick) {
  const loader = new THREE.TextureLoader();
  const jobs = [];
  for (const [id, maps] of Object.entries(TEX_SETS)) {
    TEX[id] = {};
    for (const map of maps) {
      jobs.push(loader.loadAsync(texUrl(id, map).href).then((t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
        if (map === 'color') t.colorSpace = SRGB;
        TEX[id][map] = t; onTick();
      }));
    }
  }
  await Promise.all(jobs);
}

function pbr(id, { ao = false, metal = false } = {}) {
  const T = TEX[id], o = { map: T.color, normalMap: T.normal, roughnessMap: T.roughness };
  if (ao && T.ao) { o.aoMap = T.ao; }
  if (metal && T.metalness) o.metalnessMap = T.metalness;
  return o;
}

export function loadKit(onProgress) {
  if (_loading) return _loading;
  const total = MODEL_IDS.length + Object.values(TEX_SETS).reduce((s, m) => s + m.length, 0);
  let done = 0;
  const tick = () => { done++; onProgress?.(done, total); };
  _loading = (async () => {
    await Promise.all([
      loadTextures(tick),
      ...MODEL_IDS.map((id) => loadModel(id).then((scene) => { tuneModelMaterials(scene); MODELS[id] = { scene, template: null }; tick(); })
        .catch((e) => { console.warn('kit model failed', id, e); tick(); })),
    ]);
    buildMaterials();
    return KIT;
  })();
  return _loading;
}

// a few source models are authored at the wrong scale
const MODEL_SCALE = { steel_frame_shelves_01: 0.1, classic_laptop: 0.55 };
function scaleTemplate(t, s) {
  if (s === 1) return t;
  for (const c of t.children) { c.geometry.scale(s, s, s); c.geometry.computeBoundingBox(); c.geometry.computeBoundingSphere(); }
  t.userData.box.min.multiplyScalar(s); t.userData.box.max.multiplyScalar(s);
  return t;
}
function template(id) {
  const M = MODELS[id];
  if (!M) throw new Error(`kit: model ${id} not loaded`);
  if (!M.template) M.template = scaleTemplate(bake(M.scene), MODEL_SCALE[id] ?? 1);
  return M.template;
}
// a baked sub-assembly of a model (nodes whose name, or an ancestor's, starts with prefix)
const PART_T = new Map();
function partTemplate(id, prefix, { center = true } = {}) {
  const key = `${id}|${prefix}|${center}`;
  if (!PART_T.has(key)) {
    const M = MODELS[id];
    if (!M) return null;
    const t = bake(M.scene, (n) => n.startsWith(prefix), { center });
    PART_T.set(key, t.children.length ? scaleTemplate(t, MODEL_SCALE[id] ?? 1) : null);
  }
  return PART_T.get(key);
}
function partBox(id, prefix) { const t = partTemplate(id, prefix, { center: false }); return t ? { min: t.userData.box.min.toArray(), max: t.userData.box.max.toArray() } : null; }
// A fresh clone (shared geometry + materials) of a Poly Haven model.
function model(id, { scale = 1 } = {}) {
  const t = template(id);
  const g = t.clone();
  g.name = id;
  g.scale.setScalar(scale);
  const size = t.userData.box.getSize(V3());
  g.userData = { collider: { w: size.x * scale, d: size.z * scale }, height: size.y * scale, model: id };
  return g;
}
// several copies of a model merged into one mesh per material (static clutter)
function modelBatch(id, transforms) {
  const t = template(id);
  const parts = new Map();
  for (const m of transforms) for (const mesh of t.children) {
    const g = mesh.geometry.clone().applyMatrix4(m);
    if (!parts.has(mesh.material)) parts.set(mesh.material, []);
    parts.get(mesh.material).push(g);
  }
  const grp = new THREE.Group();
  for (const [mat, geos] of parts) { const mesh = new THREE.Mesh(mergeAll(geos), mat); mesh.castShadow = !mat.transparent; mesh.receiveShadow = true; grp.add(mesh); }
  return grp;
}
const mtx = (x, y, z, ry = 0, s = 1, rx = 0, rz = 0) => new THREE.Matrix4().compose(V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), V3(s, s, s));

// ------------------------------------------------------------------ procedural textures
// Drywall atlas: 4 board variants side by side (u: variant/4 .. (variant+1)/4, v: 0..1 over 2.4 m).
// 0 clean (screws), 1 taped + mudded, 2 pencil marks + scuffs, 3 back face (kraft paper, print).
function drywallAtlas() {
  const W = 2048, H = 1024, bw = W / 4;
  return canvasTex(W, H, (g) => {
    const r = rng(42), n = noise2(7);
    const pxm = bw / 1.2; // px per metre
    for (let v = 0; v < 4; v++) {
      const x0 = v * bw;
      g.fillStyle = v === 3 ? '#9d9585' : '#d8d5cd'; g.fillRect(x0, 0, bw, H);
      // paper mottling
      const img = g.getImageData(x0, 0, bw, H), d = img.data;
      for (let y = 0; y < H; y++) for (let x = 0; x < bw; x++) {
        const k = (fbm(n, (x + v * 97) / 40, y / 40, 3) - 0.5) * (v === 3 ? 26 : 12) + (r() - 0.5) * 6;
        const i = (y * bw + x) * 4; d[i] += k; d[i + 1] += k; d[i + 2] += k * 0.9;
      }
      g.putImageData(img, x0, 0);
      // factory edge (tapered edges slightly darker)
      const eg = g.createLinearGradient(x0, 0, x0 + 18, 0); eg.addColorStop(0, 'rgba(90,85,75,0.25)'); eg.addColorStop(1, 'rgba(90,85,75,0)');
      g.fillStyle = eg; g.fillRect(x0, 0, 18, H);
      const eg2 = g.createLinearGradient(x0 + bw, 0, x0 + bw - 18, 0); eg2.addColorStop(0, 'rgba(90,85,75,0.25)'); eg2.addColorStop(1, 'rgba(90,85,75,0)');
      g.fillStyle = eg2; g.fillRect(x0 + bw - 18, 0, 18, H);
      if (v === 3) {
        for (let y = 60; y < H; y += 300) stencilText(g, 'GYPSUM BOARD  12.5 mm  TYPE A  EN 520  ·  HALVERSEN SITE 41', x0 + bw / 2, H - y, 13, { color: 'rgba(40,70,140,0.75)', weight: 600, font: 'Arial', maxW: bw - 30 });
        g.strokeStyle = 'rgba(40,70,140,0.5)'; g.lineWidth = 2;
        for (const fx of [0.4, 0.8]) { g.beginPath(); g.moveTo(x0 + fx * pxm, 0); g.lineTo(x0 + fx * pxm, H); g.stroke(); }
        continue;
      }
      // mud bands over the edges + screw spots
      if (v === 1) {
        for (const [ex, dir] of [[x0, 1], [x0 + bw, -1]]) {
          const gr = g.createLinearGradient(ex, 0, ex + dir * 0.16 * pxm, 0);
          gr.addColorStop(0, 'rgba(238,237,232,0.98)'); gr.addColorStop(0.55, 'rgba(236,235,230,0.85)'); gr.addColorStop(1, 'rgba(236,235,230,0)');
          g.fillStyle = gr; g.fillRect(Math.min(ex, ex + dir * 0.16 * pxm), 0, 0.16 * pxm, H);
          // sanding swirls
          g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 1;
          for (let i = 0; i < 60; i++) { const yy = r() * H; g.beginPath(); g.arc(ex + dir * r() * 0.12 * pxm, yy, 6 + r() * 20, r() * 6, r() * 6 + 1.5); g.stroke(); }
        }
        // paper tape line in the middle of the band
        g.fillStyle = 'rgba(225,222,212,0.9)'; g.fillRect(x0, 0, 0.025 * pxm, H); g.fillRect(x0 + bw - 0.025 * pxm, 0, 0.025 * pxm, H);
      }
      for (const fx of [0.012, 0.4, 0.8, 1.188]) for (let fy = 0.1; fy < 2.4; fy += 0.3) {
        const sx = x0 + fx * pxm, sy = H - fy / 2.4 * H;
        if (v === 1) { g.fillStyle = 'rgba(240,239,234,0.95)'; g.beginPath(); g.ellipse(sx, sy, 7 + r() * 4, 9 + r() * 5, r(), 0, TAU); g.fill(); }
        else { g.fillStyle = 'rgba(55,55,52,0.9)'; g.beginPath(); g.arc(sx, sy, 2.6, 0, TAU); g.fill(); g.fillStyle = 'rgba(120,118,110,0.5)'; g.beginPath(); g.arc(sx, sy, 4.5, 0, TAU); g.fill(); }
      }
      if (v === 2) {
        g.strokeStyle = 'rgba(60,60,64,0.75)'; g.lineWidth = 1.6; g.lineCap = 'round';
        // measuring marks / cut line
        g.beginPath(); g.moveTo(x0 + 30, H * 0.42); g.lineTo(x0 + bw - 40, H * 0.43); g.stroke();
        g.save(); g.translate(x0 + bw * 0.35, H * 0.4); g.rotate(-0.03);
        g.font = 'italic 600 30px "Comic Sans MS", "Segoe Print", cursive'; g.fillStyle = 'rgba(55,55,60,0.8)';
        g.fillText('1180', 0, 0); g.font = 'italic 600 22px "Comic Sans MS", cursive'; g.fillText('CUT ↓', 20, 40); g.restore();
        g.beginPath(); g.moveTo(x0 + bw * 0.7, H * 0.7); g.lineTo(x0 + bw * 0.8, H * 0.78); g.moveTo(x0 + bw * 0.8, H * 0.7); g.lineTo(x0 + bw * 0.7, H * 0.78); g.stroke();
        g.font = 'italic 600 26px cursive'; g.fillStyle = 'rgba(55,55,60,0.75)'; g.fillText('D-14', x0 + bw * 0.62, H * 0.2);
        // dirty bottom: scuffs + grey boot marks
        const dg = g.createLinearGradient(0, H, 0, H - 0.5 * H / 2.4); dg.addColorStop(0, 'rgba(70,64,55,0.45)'); dg.addColorStop(1, 'rgba(70,64,55,0)');
        g.fillStyle = dg; g.fillRect(x0, H - 0.5 * H / 2.4, bw, 0.5 * H / 2.4);
        for (let i = 0; i < 4; i++) { g.fillStyle = 'rgba(60,56,50,0.25)'; g.beginPath(); g.ellipse(x0 + r() * bw, H - 20 - r() * 60, 18, 34, r(), 0, TAU); g.fill(); }
        // water stain
        g.strokeStyle = 'rgba(150,120,70,0.35)'; g.lineWidth = 3; g.beginPath(); g.ellipse(x0 + bw * 0.25, H * 0.88, 60, 22, 0.1, 0, TAU); g.stroke();
        g.fillStyle = 'rgba(160,135,90,0.12)'; g.fill();
      }
      // general handling grime
      for (let i = 0; i < 12; i++) { g.fillStyle = `rgba(80,75,65,${0.03 + r() * 0.05})`; g.beginPath(); g.ellipse(x0 + r() * bw, r() * H, 10 + r() * 40, 10 + r() * 60, r(), 0, TAU); g.fill(); }
      const bg = g.createLinearGradient(0, H, 0, H - 120); bg.addColorStop(0, 'rgba(60,55,48,0.35)'); bg.addColorStop(1, 'rgba(60,55,48,0)');
      g.fillStyle = bg; g.fillRect(x0, H - 120, bw, 120);
    }
  });
}

// plastic sheeting: colour (milky, dusty towards the bottom) + alpha
function sheetTex() {
  const W = 512, H = 1024;
  return canvasTex(W, H, (g) => {
    const r = rng(9), n = noise2(3);
    const img = g.createImageData(W, H), d = img.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, t = y / H; // t=0 top
      const dust = Math.min(1, Math.pow(t, 2.2) * 0.9 + fbm(n, x / 70, y / 90, 4) * 0.45 - 0.12);
      const streak = Math.pow(n(x / 6, 3.3), 6) * 0.25;
      const c = 205 - dust * 70 + streak * 40;
      d[i] = c; d[i + 1] = c * 0.99; d[i + 2] = c * 0.95;
      d[i + 3] = 255 * Math.min(1, 0.28 + dust * 0.5 + streak + (r() < 0.002 ? 0.3 : 0));
    }
    g.putImageData(img, 0, 0);
    // tape along the top, handprints / smears
    g.fillStyle = 'rgba(200,190,150,0.95)'; g.fillRect(0, 0, W, 14);
    for (let i = 0; i < 5; i++) { g.fillStyle = 'rgba(90,80,70,0.25)'; g.beginPath(); g.ellipse(r() * W, H * (0.4 + r() * 0.4), 14, 22, r(), 0, TAU); g.fill(); }
  });
}
function tapeTex() {
  return canvasTex(512, 64, (g, w, h) => {
    g.fillStyle = '#e8c21a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#121212'; g.fillRect(0, 0, w, 5); g.fillRect(0, h - 5, w, 5);
    for (const x of [128, 384]) stencilText(g, 'CAUTION', x, h / 2 + 2, 38, { color: '#121212', spacing: 0.08 });
    g.fillStyle = 'rgba(0,0,0,0.12)'; for (let i = 0; i < 300; i++) g.fillRect(Math.random() * w, Math.random() * h, 2, 1);
  });
}
function hazardTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#e1ad12'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#151515';
    for (let x = -h; x < w + h; x += 64) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 32, h); g.lineTo(x + 32 + h, 0); g.lineTo(x + h, 0); g.fill(); }
    const r = rng(5); for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(90,80,60,${r() * 0.3})`; g.fillRect(r() * w, r() * h, 2 + r() * 8, 2 + r() * 8); }
  });
}
function cageTex() {
  return canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 7;
    for (let x = 0; x <= w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    g.beginPath(); g.moveTo(0, 4); g.lineTo(w, 4); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  }, { srgb: false });
}

// ------------------------------------------------------------------ materials
function std(o, tile) { const m = new THREE.MeshStandardMaterial(o); if (tile) m.userData.tile = tile; return m; }
function ch1(t) { const c = t.clone(); c.channel = 1; return c; }

function buildMaterials() {
  const M = MAT;
  M.slab = enhance(std({ ...pbr('Concrete023'), color: 0xb5aea3, roughness: 1, normalScale: new THREE.Vector2(0.7, 0.7) }, 2.4), { macro: 0.09, macroStrength: 0.55 });
  M.concrete = enhance(std({ ...pbr('Concrete028', { ao: true }), color: 0xc4beb4, roughness: 1, aoMapIntensity: 0.8 }, 2.0), { macro: 0.13 });
  M.concreteWall = enhance(std({ ...pbr('Concrete028', { ao: true }), color: 0xa9a49b, roughness: 1, aoMapIntensity: 0.8 }, 2.4), { macro: 0.1 });
  M.soffit = enhance(std({ ...pbr('Concrete028'), color: 0x8f8a82, roughness: 1 }, 2.6), { macro: 0.08, macroStrength: 0.5 });
  M.dusty = enhance(std({ ...pbr('Concrete036'), color: 0xa59f95, roughness: 1 }, 2.0), { macro: 0.1 });
  M.blocks = std({ ...pbr('Concrete036'), color: 0xb9b4aa, roughness: 1 }, 0.9);
  M.plywood = std({ ...pbr('Wood087'), color: 0xdccbb0, roughness: 1, normalScale: new THREE.Vector2(0.6, 0.6) }, 1.22);
  M.osb = std({ ...pbr('Chipboard004'), color: 0xd2c2a2, roughness: 1 }, 1.22);
  M.timber = enhance(std({ ...pbr('Wood087'), color: 0x9c8a70, roughness: 1 }, 0.9), { dust: 0.35 });
  M.plank = enhance(std({ ...pbr('Wood087'), color: 0x8f7d63, roughness: 1 }, 1.4), { dust: 0.45 });
  const atlas = drywallAtlas();
  M.drywall = std({ map: atlas, normalMap: ch1(TEX.Plaster002.normal), roughnessMap: ch1(TEX.Plaster002.roughness), roughness: 1, normalScale: new THREE.Vector2(0.5, 0.5), color: 0xf2f0ea });
  M.drywall.userData.tile = 0; // boards carry their own uvs
  M.metalStud = enhance(std({ ...pbr('Metal055A', { metal: true }), color: 0xc9ced2, metalness: 1, roughness: 0.75, envMapIntensity: 1.3 }, 0.7), { dust: 0.4 });
  M.galvanized = enhance(std({ ...pbr('Metal055A', { metal: true }), color: 0xbfc4c6, metalness: 1, roughness: 0.65, envMapIntensity: 1.4 }, 1.6), { dust: 0.55 });
  M.scaffoldTube = enhance(std({ ...pbr('Metal055A', { metal: true }), color: 0xa9adae, metalness: 1, roughness: 0.8, envMapIntensity: 1.2 }, 0.5), { dust: 0.3 });
  M.steelPaint = enhance(std({ ...pbr('Metal055A'), color: 0xb7b9b3, metalness: 0.25, roughness: 0.85 }, 0.8), { dust: 0.3 });
  M.steelDark = std({ ...pbr('Metal055A', { metal: true }), color: 0x45464a, metalness: 0.8, roughness: 0.9 }, 0.5);
  M.rust = std({ ...pbr('Metal021', { metal: true }), color: 0xb0aaa4, metalness: 1, roughness: 1 }, 1.2);
  M.liftSteel = std({ ...pbr('Metal009'), color: 0x8a9092, metalness: 1, roughness: 0.85, envMapIntensity: 1.6 }, 1.0);
  M.liftDoor = enhance(std({ ...pbr('Metal021', { metal: true }), color: 0x8d9396, metalness: 0.9, roughness: 1 }, 1.4), { macro: 0.2 });
  M.diamond = std({ ...pbr('DiamondPlate008C', { metal: true }), color: 0x9a9c9c, metalness: 1, roughness: 1 }, 0.6);
  M.insulation = std({ ...pbr('Fabric045'), color: 0xe2bf63, roughness: 1, normalScale: new THREE.Vector2(1.6, 1.6) }, 0.35);
  M.yellowPaint = enhance(std({ normalMap: TEX.Metal055A.normal, roughnessMap: TEX.Metal055A.roughness, color: 0xd7a40f, metalness: 0.15, roughness: 0.7 }, 0.8), { dust: 0.35 });
  M.redPaint = std({ normalMap: TEX.Metal055A.normal, roughnessMap: TEX.Metal055A.roughness, color: 0xa3150f, metalness: 0.15, roughness: 0.6 }, 0.8);
  M.greenPaint = std({ normalMap: TEX.Metal055A.normal, roughnessMap: TEX.Metal055A.roughness, color: 0x3f5a48, metalness: 0.2, roughness: 0.7 }, 0.8);
  M.rubber = std({ color: 0x18191a, roughness: 0.85 });
  M.plasticBlack = std({ color: 0x1b1c1e, roughness: 0.55 });
  M.plasticGrey = std({ color: 0x8c8f90, roughness: 0.5 });
  M.plasticOrange = std({ color: 0xd2541a, roughness: 0.55 });
  M.plasticWhite = std({ color: 0xd9d9d4, roughness: 0.5 });
  M.pvc = std({ color: 0x8a8d8f, roughness: 0.45 });
  M.copper = std({ color: 0xb87340, metalness: 1, roughness: 0.4 });
  M.foil = std({ normalMap: TEX.Plaster002.normal, color: 0xc9cccd, metalness: 1, roughness: 0.35, normalScale: new THREE.Vector2(1.5, 1.5) }, 0.5);
  M.cable = std({ vertexColors: true, roughness: 0.6 });
  M.hazard = std({ map: hazardTex(), roughness: 0.6, normalMap: TEX.Metal055A.normal }, 0.5);
  const sheet = sheetTex();
  M.sheet = new THREE.MeshStandardMaterial({ map: sheet, color: 0xe8ebe6, transparent: true, side: THREE.DoubleSide, roughness: 0.38, metalness: 0, depthWrite: false, envMapIntensity: 1.4 });
  M.tape = std({ map: tapeTex(), side: THREE.DoubleSide, roughness: 0.45 });
  M.cage = new THREE.MeshStandardMaterial({ alphaMap: cageTex(), color: 0x2a2a2a, metalness: 0.6, roughness: 0.5, alphaTest: 0.5, side: THREE.DoubleSide });
  M.glass = new THREE.MeshStandardMaterial({ color: 0xbfcfd0, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.18, depthWrite: false, envMapIntensity: 2 });
  // lamps / LEDs: shared on/off pairs (pieces swap them)
  M.lampOff = std({ color: 0xd8d2c0, roughness: 0.25, emissive: 0x000000 });
  M.lampOn = std({ color: 0xfff1d0, roughness: 0.4, emissive: 0xffe2a8, emissiveIntensity: 2.2 });
  M.bulbOff = new THREE.MeshStandardMaterial({ color: 0xcfc8b8, roughness: 0.1, transparent: true, opacity: 0.7 });
  M.bulbOn = new THREE.MeshStandardMaterial({ color: 0xffe6b0, emissive: 0xffc070, emissiveIntensity: 2.6, roughness: 0.4 });
  M.ledOff = std({ color: 0x202322, roughness: 0.3 });
  M.ledGreen = std({ color: 0x0a3010, emissive: 0x30ff60, emissiveIntensity: 3 });
  M.ledRed = std({ color: 0x300808, emissive: 0xff2a1a, emissiveIntensity: 3 });
  M.ledAmber = std({ color: 0x302008, emissive: 0xffa020, emissiveIntensity: 3 });
  M.dark = std({ color: 0x0d0e0f, roughness: 0.9 });
  M.paper = std({ color: 0xe6e2d6, roughness: 0.9 });
}

// ------------------------------------------------------------------ helpers for pieces
function group(name, ...children) { const g = new THREE.Group(); g.name = name; for (const c of children) g.add(c); return g; }
function finish(g, { collider = null, colliders = null, cast = true } = {}) {
  g.traverse((m) => { if (m.isMesh) { m.castShadow = cast && !m.material.transparent && m.castShadow !== false; m.receiveShadow = true; } });
  if (collider) g.userData.collider = collider;
  if (colliders) g.userData.colliders = colliders;
  return g;
}
// rect minus axis-aligned holes (holes in x/y) -> list of rects
function subtractRects(rect, holes) {
  let out = [rect];
  for (const h of holes) {
    const next = [];
    for (const r of out) {
      if (h.x1 <= r.x0 || h.x0 >= r.x1 || h.y1 <= r.y0 || h.y0 >= r.y1) { next.push(r); continue; }
      if (h.x0 > r.x0) next.push({ ...r, x1: h.x0 });
      if (h.x1 < r.x1) next.push({ ...r, x0: h.x1 });
      const cx0 = Math.max(r.x0, h.x0), cx1 = Math.min(r.x1, h.x1);
      if (h.y1 < r.y1) next.push({ ...r, x0: cx0, x1: cx1, y0: h.y1 });
      if (h.y0 > r.y0) next.push({ ...r, x0: cx0, x1: cx1, y1: h.y0 });
    }
    out = next.filter((r) => r.x1 - r.x0 > 0.01 && r.y1 - r.y0 > 0.01);
  }
  return out;
}
// a drywall board piece: rect (x0..x1, y0..y1) cut from a board whose origin is (bx, by)
function boardGeo(rect, bx, by, z0, t, front, back, mirror = false) {
  const w = rect.x1 - rect.x0, h = rect.y1 - rect.y0;
  const g = new THREE.BoxGeometry(w, h, t);
  g.translate((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2, z0 + t / 2);
  worldUV(g, 1, { channel: 'uv1' });
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const nz = n.getZ(i);
    const faceFront = mirror ? nz < -0.5 : nz > 0.5;
    const variant = faceFront || Math.abs(nz) < 0.5 ? front : back;
    let u = THREE.MathUtils.clamp((p.getX(i) - bx) / 1.2, 0.002, 0.998);
    if (nz < -0.5) u = 1 - u;
    const v = THREE.MathUtils.clamp((p.getY(i) - by) / 2.4, 0.002, 0.998);
    uv.setXY(i, (variant + u) / 4, v);
  }
  return g;
}
function lumpy(geo, amp, seed, keepBottom = true) {
  const r = noise2(seed), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = (r(x * 9 + z * 7, y * 9) - 0.5) * 2 * amp;
    p.setXYZ(i, x + k * 0.5, keepBottom && y < 1e-3 ? y : y + k * 0.3, z + k);
  }
  geo.computeVertexNormals();
  return geo;
}

// ------------------------------------------------------------------ stud wall
function studWall({ length = 4, height = 2.9, boards = 0.5, seed, openings = [], insulation = 0.5, depth = 0.092, backBoards = null } = {}) {
  const r = rng(seedOf(seed));
  const P = new Parts();
  const L = length, D = depth, x0 = -L / 2, tk = 0.0018;
  const holes = openings.map((o) => ({ x0: x0 + o.at - o.width / 2, x1: x0 + o.at + o.width / 2, y0: -1, y1: o.height ?? 2.1 }));
  // tracks
  const track = (y, up) => {
    P.bb('metalStud', x0, y - (up ? 0 : tk), -D / 2, -x0, y + (up ? tk : 0), D / 2);
    for (const s of [-1, 1]) P.bb('metalStud', x0, up ? y : y - 0.035, s * D / 2 - (s > 0 ? 0 : tk), -x0, up ? y + 0.035 : y, s * D / 2 + (s > 0 ? tk : 0));
  };
  // bottom track is interrupted at door openings
  for (const seg of subtractRects({ x0, x1: -x0, y0: 0, y1: 0.01 }, holes)) {
    P.bb('metalStud', seg.x0, 0, -D / 2, seg.x1, tk, D / 2);
    for (const s of [-1, 1]) P.bb('metalStud', seg.x0, 0, s > 0 ? D / 2 : -D / 2 - tk, seg.x1, 0.035, s > 0 ? D / 2 + tk : -D / 2);
  }
  track(height, false);
  const stud = (x, y0 = 0, y1 = height, flip = 1) => {
    P.bb('metalStud', x - tk / 2, y0, -D / 2, x + tk / 2, y1, D / 2); // web
    for (const s of [-1, 1]) {
      P.bb('metalStud', flip > 0 ? x : x - 0.036, y0, s > 0 ? D / 2 - tk : -D / 2, flip > 0 ? x + 0.036 : x, y1, s > 0 ? D / 2 : -D / 2 + tk);
      P.bb('metalStud', flip > 0 ? x + 0.034 : x - 0.036, y0, s > 0 ? D / 2 - 0.011 : -D / 2, flip > 0 ? x + 0.036 : x - 0.034, y1, s > 0 ? D / 2 : -D / 2 + 0.011);
    }
  };
  const studXs = [];
  for (let x = x0 + 0.02; x < -x0 - 0.01; x += 0.4) studXs.push(x);
  studXs.push(-x0 - 0.02);
  for (const x of studXs) {
    const h = holes.find((o) => x > o.x0 - 0.05 && x < o.x1 + 0.05);
    if (!h) stud(x, 0, height, 1);
    else if (x > h.x0 + 0.05 && x < h.x1 - 0.05) stud(x, h.y1, height, 1); // cripple above the header
  }
  for (const h of holes) {
    stud(h.x0 - 0.02, 0, height, -1); stud(h.x0 - 0.002, 0, height, 1);
    stud(h.x1 + 0.002, 0, height, -1); stud(h.x1 + 0.02, 0, height, 1);
    // header track
    P.bb('metalStud', h.x0, h.y1 - tk, -D / 2, h.x1, h.y1, D / 2);
    for (const s of [-1, 1]) P.bb('metalStud', h.x0, h.y1, s > 0 ? D / 2 : -D / 2 - tk, h.x1, h.y1 + 0.035, s > 0 ? D / 2 + tk : -D / 2);
  }
  // boards: 1.2 m columns from the wall start, lower 2.4 m board + cut top piece
  const bt = 0.0125, cols = Math.ceil(L / 1.2 - 1e-3);
  const covered = { front: [], back: [] };
  const backP = backBoards ?? boards * 0.35;
  for (const [sideName, prob, zf, mirror] of [['front', boards, D / 2 + 0.001, false], ['back', backP, -D / 2 - 0.001 - bt, true]]) {
    for (let c = 0; c < cols; c++) {
      const bx = x0 + c * 1.2, bx1 = Math.min(bx + 1.2, -x0);
      const roll = r();
      if (roll >= prob) { covered[sideName][c] = 0; continue; }
      const lowerOnly = r() < 0.3;
      covered[sideName][c] = lowerOnly ? 1 : 2;
      const variant = r() < 0.45 ? 1 : r() < 0.5 ? 2 : 0;
      for (const rect of subtractRects({ x0: bx, x1: bx1, y0: 0.01, y1: Math.min(2.41, height) }, holes))
        P.add('drywall', boardGeo(rect, bx, 0.01, zf, bt, variant, 3, mirror), { uv: false });
      if (!lowerOnly && height > 2.42)
        for (const rect of subtractRects({ x0: bx, x1: bx1, y0: 2.41, y1: height - 0.005 }, holes))
          P.add('drywall', boardGeo(rect, bx, 2.41, zf, bt, variant === 1 ? 1 : 0, 3, mirror), { uv: false });
    }
  }
  // insulation batts in bays behind hung boards (and a few loose in open bays)
  for (let i = 0; i < studXs.length - 1; i++) {
    const xa = studXs[i] + 0.04, xb = studXs[i + 1] - 0.004;
    if (xb - xa < 0.15) continue;
    const c = Math.floor((xa - x0) / 1.2);
    const boarded = covered.front[c] || covered.back[c];
    if (holes.some((h) => xa < h.x1 && xb > h.x0)) continue;
    const p = boarded ? insulation : insulation * 0.25;
    if (r() > p) continue;
    const top = boarded ? height - 0.02 : range(r, 0.6, 2.2);
    for (let y = 0.004; y < top - 0.05; y += 1.2) {
      const bh = Math.min(1.2, top - y) - 0.004;
      const g = lumpy(new THREE.BoxGeometry(xb - xa, bh, 0.07, 3, 6, 2), 0.012, i * 13 + y * 7);
      const lean = !boarded && r() < 0.5 ? range(r, 0.02, 0.12) : 0;
      g.translate(0, bh / 2, 0);
      g.applyMatrix4(new THREE.Matrix4().makeRotationX(lean));
      g.translate((xa + xb) / 2, y, (r() - 0.5) * 0.01);
      P.add('insulation', g);
    }
  }
  const grp = P.build(group('studWall'));
  const colliders = subtractRects({ x0, x1: -x0, y0: 0, y1: 0.5 }, holes).map((s) => ({ minX: s.x0, maxX: s.x1, minZ: -D / 2 - 0.02, maxZ: D / 2 + 0.02 }));
  grp.userData.colliders = colliders;
  grp.userData.length = L;
  return finish(grp, { colliders });
}

// ------------------------------------------------------------------ columns
let _colDetail = null;
function columnDetailTex() {
  if (_colDetail) return _colDetail;
  _colDetail = canvasTex(256, 512, (g, w, h) => {
    const r = rng(77), n = noise2(21);
    const img = g.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const t = 1 - y / h; // 0 bottom .. 1 top
      let k = 1 - Math.max(0, 0.22 - t) * 1.4 - Math.max(0, t - 0.96) * 5;
      k *= 0.92 + fbm(n, x / 30, y / 50, 3) * 0.16;
      const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, k * 255)); d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // pour line, tie holes (in pairs), drip stains
    g.fillStyle = 'rgba(70,70,70,0.25)'; g.fillRect(0, h * 0.52, w, 2);
    for (const ty of [0.2, 0.52, 0.84]) for (const tx of [0.22, 0.78]) {
      const x = tx * w, y = ty * h;
      g.fillStyle = 'rgba(25,25,25,0.85)'; g.beginPath(); g.arc(x, y, 4.5, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(80,80,80,0.45)'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 9, 0, TAU); g.stroke();
    }
    for (let i = 0; i < 7; i++) { const x = r() * w; const gr = g.createLinearGradient(0, 0, 0, h * 0.4); gr.addColorStop(0, 'rgba(60,55,50,0.25)'); gr.addColorStop(1, 'rgba(60,55,50,0)'); g.fillStyle = gr; g.fillRect(x, 0, 2 + r() * 6, h * (0.15 + r() * 0.3)); }
  }, { srgb: false, repeat: false });
  _colDetail.channel = 1;
  return _colDetail;
}
function column({ h = 3.2, w = 0.5, d = null, label = 'D4', rebar = false, chamfer = 0.025, seed } = {}) {
  const r = rng(seedOf(seed));
  d = d ?? w;
  if (!MAT.column) {
    MAT.column = enhance(std({ ...pbr('Concrete028'), aoMap: columnDetailTex(), aoMapIntensity: 1, color: 0xc2bcb2, roughness: 1 }, 2.0), { detail: true, macro: 0.13 });
  }
  const c = chamfer, hw = w / 2, hd = d / 2;
  const s = new THREE.Shape();
  s.moveTo(-hw + c, -hd); s.lineTo(hw - c, -hd); s.lineTo(hw, -hd + c); s.lineTo(hw, hd - c); s.lineTo(hw - c, hd); s.lineTo(-hw + c, hd); s.lineTo(-hw, hd - c); s.lineTo(-hw, -hd + c); s.closePath();
  let g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-HP); // extrude along +Y; shape y -> -z
  g = g.toNonIndexed(); g.computeVertexNormals();
  worldUV(g, MAT.column.userData.tile, { channel: 'uv', offset: [r() * 7, r() * 7] });
  // uv1: face-local (u across face, v = height fraction)
  const p = g.attributes.position, n = g.attributes.normal, uv1 = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const nx = n.getX(i), nz = n.getZ(i);
    const u = Math.abs(nx) > Math.abs(nz) ? (p.getZ(i) + hd) / d : (p.getX(i) + hw) / w;
    uv1[i * 2] = u; uv1[i * 2 + 1] = p.getY(i) / h;
  }
  g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
  const mesh = new THREE.Mesh(g, MAT.column);
  const grp = group('column', mesh);
  // spray-painted grid label on two faces (+Z, +X)
  if (label) {
    const tex = canvasTex(256, 256, (gg, W, H) => {
      gg.clearRect(0, 0, W, H);
      sprayText(gg, label, W / 2, H * 0.42, 110, 'rgba(214,74,28,0.95)', r);
      gg.strokeStyle = 'rgba(214,74,28,0.85)'; gg.lineWidth = 5; gg.beginPath(); gg.moveTo(W * 0.5, H * 0.66); gg.lineTo(W * 0.5, H * 0.98); gg.stroke();
      gg.beginPath(); gg.moveTo(W * 0.2, H * 0.82); gg.lineTo(W * 0.8, H * 0.82); gg.stroke();
      stencilText(gg, '+1.000', W * 0.72, H * 0.76, 20, { color: 'rgba(30,60,170,0.8)', weight: 700, font: 'Arial' });
    }, { repeat: false });
    const lm = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 });
    const geos = [];
    const pl = () => new THREE.PlaneGeometry(Math.min(w, 0.42), Math.min(w, 0.42));
    const a = pl(); a.translate(0, 1.55, hd + 0.002); geos.push(cleanGeo(a));
    const b = pl(); b.rotateY(HP); b.translate(hw + 0.002, 1.55, 0); geos.push(cleanGeo(b));
    const lmesh = new THREE.Mesh(mergeAll(geos), lm); lmesh.castShadow = false; lmesh.renderOrder = 1;
    grp.add(lmesh);
  }
  if (rebar) {
    const P = new Parts();
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1]]) {
      const top = V3(x * (hw - 0.06) + (r() - 0.5) * 0.03, h + 0.4 + r() * 0.3, z * (hd - 0.06) + (r() - 0.5) * 0.03);
      P.tube('rust', V3(x * (hw - 0.06), h - 0.05, z * (hd - 0.06)), top, 0.008, 5);
      P.add('plasticOrange', new THREE.SphereGeometry(0.022, 8, 5, 0, TAU, 0, HP).translate(top.x, top.y - 0.005, top.z));
    }
    P.build(grp);
  }
  return finish(grp, { collider: { w, d } });
}

// ------------------------------------------------------------------ slab + deck (extras)
// Floor slab w x d with a baked detail map (dust drifts, saw-cut joints, chalk lines, stains, tyre tracks).
function floorSlab({ w = 20, d = 14, seed = 3, joints = 6 } = {}) {
  const r = rng(seed), n = noise2(seed + 1);
  const res = 1024, H = Math.round(res * d / w);
  const det = canvasTex(res, H, (g) => {
    const img = g.createImageData(res, H), D = img.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < res; x++) {
      const wx = x / res * w, wz = y / H * d;
      const edge = Math.min(wx, w - wx, wz, d - wz);
      let k = 0.86 + (fbm(n, wx * 0.35, wz * 0.35, 5) - 0.5) * 0.55;
      k += Math.max(0, 0.6 - edge) * 0.25; // dust drifts against the edges
      const i = (y * res + x) * 4; const v = Math.max(0, Math.min(255, k * 220));
      D[i] = v; D[i + 1] = v * 0.985; D[i + 2] = v * 0.96; D[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const px = res / w;
    // saw-cut joints
    g.strokeStyle = 'rgba(20,20,20,0.85)'; g.lineWidth = 1.4;
    for (let x = joints; x < w; x += joints) { g.beginPath(); g.moveTo(x * px, 0); g.lineTo(x * px, H); g.stroke(); }
    for (let z = joints; z < d; z += joints) { g.beginPath(); g.moveTo(0, z * px); g.lineTo(res, z * px); g.stroke(); }
    // damp / oil stains
    for (let i = 0; i < 14; i++) {
      const x = r() * res, y = r() * H, rad = (0.3 + r() * 1.2) * px;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, `rgba(40,34,28,${0.25 + r() * 0.3})`); gr.addColorStop(1, 'rgba(40,34,28,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rad, rad * (0.5 + r() * 0.5), r() * 3, 0, TAU); g.fill();
    }
    // pale dust/plaster spills
    for (let i = 0; i < 18; i++) {
      const x = r() * res, y = r() * H, rad = (0.2 + r() * 0.9) * px;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, `rgba(235,230,220,${0.2 + r() * 0.25})`); gr.addColorStop(1, 'rgba(235,230,220,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rad, rad * (0.4 + r() * 0.6), r() * 3, 0, TAU); g.fill();
    }
    // pallet-truck tyre tracks
    g.strokeStyle = 'rgba(30,28,26,0.18)'; g.lineWidth = 0.07 * px;
    for (let i = 0; i < 3; i++) {
      const y0 = r() * H, y1 = r() * H;
      for (const off of [0, 0.55 * px]) { g.beginPath(); g.moveTo(0, y0 + off); g.bezierCurveTo(res * 0.35, y0 + off, res * 0.6, y1 + off, res, y1 + off); g.stroke(); }
    }
    // chalk lines (setting-out), survey crosses
    g.strokeStyle = 'rgba(60,110,200,0.45)'; g.lineWidth = 1.2;
    for (let i = 0; i < 5; i++) { const y = r() * H; g.beginPath(); g.moveTo(r() * res * 0.3, y); g.lineTo(res * (0.6 + r() * 0.4), y + (r() - 0.5) * 3); g.stroke(); }
    for (let i = 0; i < 5; i++) { const x = r() * res; g.beginPath(); g.moveTo(x, r() * H * 0.3); g.lineTo(x + (r() - 0.5) * 3, H * (0.6 + r() * 0.4)); g.stroke(); }
    g.strokeStyle = 'rgba(220,60,30,0.7)'; g.lineWidth = 2;
    for (let i = 0; i < 8; i++) { const x = r() * res, y = r() * H; g.beginPath(); g.moveTo(x - 5, y); g.lineTo(x + 5, y); g.moveTo(x, y - 5); g.lineTo(x, y + 5); g.stroke(); }
  }, { srgb: false, repeat: false });
  det.channel = 1;
  const mat = enhance(std({ ...pbr('Concrete023'), aoMap: det, aoMapIntensity: 1, color: 0xc9c2b6, roughness: 1, normalScale: new THREE.Vector2(0.7, 0.7) }, 2.4), { detail: true, macro: 0.09, macroStrength: 0.5 });
  const geo = new THREE.PlaneGeometry(w, d, 1, 1); geo.rotateX(-HP);
  worldUV(geo, 2.4, { channel: 'uv' });
  const p = geo.attributes.position, uv1 = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv1[i * 2] = p.getX(i) / w + 0.5; uv1[i * 2 + 1] = 0.5 - p.getZ(i) / d; }
  geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
  const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true; mesh.name = 'slab';
  return group('floorSlab', mesh);
}
// Ceiling deck (soffit facing down at height h) with downstand beams along Z every `beamEvery` metres
// and formwork panel seams / water stains in its detail map.
function deck({ w = 20, d = 14, h = 3.2, beamEvery = 6.5, beamW = 0.4, beamD = 0.45, seed = 5 } = {}) {
  const r = rng(seed), n = noise2(seed + 9);
  const res = 1024, H = Math.round(res * d / w), px = res / w;
  const det = canvasTex(res, H, (g) => {
    const img = g.createImageData(res, H), D = img.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < res; x++) {
      const k = 0.88 + (fbm(n, x / px * 0.4, y / px * 0.4, 4) - 0.5) * 0.4;
      const i = (y * res + x) * 4, v = Math.max(0, Math.min(255, k * 235)); D[i] = D[i + 1] = D[i + 2] = v; D[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(40,40,40,0.5)'; g.lineWidth = 1;
    for (let x = 0; x < w; x += 1.22) { g.beginPath(); g.moveTo(x * px, 0); g.lineTo(x * px, H); g.stroke(); }
    for (let z = 0; z < d; z += 2.44) { g.beginPath(); g.moveTo(0, z * px); g.lineTo(res, z * px); g.stroke(); }
    for (let i = 0; i < 9; i++) {
      const x = r() * res, y = r() * H, rad = (0.4 + r() * 1.4) * px;
      g.strokeStyle = `rgba(90,70,40,${0.3 + r() * 0.3})`; g.lineWidth = 2;
      g.fillStyle = `rgba(80,65,45,${0.12 + r() * 0.15})`;
      g.beginPath(); g.ellipse(x, y, rad, rad * (0.4 + r() * 0.5), r() * 3, 0, TAU); g.fill(); g.stroke();
    }
  }, { srgb: false, repeat: false });
  det.channel = 1;
  const mat = enhance(std({ ...pbr('Concrete028'), aoMap: det, color: 0x9a948b, roughness: 1 }, 2.6), { detail: true, macro: 0.08, macroStrength: 0.45 });
  const P = new Parts();
  const add = (geo) => {
    worldUV(geo, 2.6, { channel: 'uv' });
    const p = geo.attributes.position, uv1 = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { uv1[i * 2] = p.getX(i) / w + 0.5; uv1[i * 2 + 1] = 0.5 - p.getZ(i) / d; }
    geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
    P.add(mat, geo, { uv: false });
  };
  const top = new THREE.PlaneGeometry(w, d); top.rotateX(HP); top.translate(0, h + beamD, 0); add(top);
  for (let x = -w / 2 + beamEvery; x < w / 2 - 0.5; x += beamEvery) {
    const b = new THREE.BoxGeometry(beamW, beamD, d); b.translate(x, h + beamD / 2, 0); add(b);
  }
  // perimeter band so the deck reads as one thick slab from below
  const grp = P.build(group('deck'));
  grp.userData.soffit = h; // underside of beams
  grp.userData.slabSoffit = h + beamD;
  return finish(grp);
}

// ------------------------------------------------------------------ plastic sheeting curtain
function sheeting({ w = 3, h = 2.9, seed, folds = null } = {}) {
  const r = rng(seedOf(seed));
  const segX = Math.max(8, Math.round(w * 9)), segY = Math.max(8, Math.round(h * 7));
  const geo = new THREE.PlaneGeometry(w, h, segX, segY);
  geo.translate(0, h / 2, 0);
  const p = geo.attributes.position;
  const base = new Float32Array(p.array);
  const nf = folds ?? Math.round(w * 2.2);
  const phases = Array.from({ length: 4 }, () => r() * TAU);
  // drag on the floor: bottom row slightly longer and pushed back
  const dz = new Float32Array(p.count), wgt = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const x = base[i * 3], y = base[i * 3 + 1];
    const t = Math.min(1, Math.max(0, 1 - y / h)); // 0 top .. 1 bottom
    const fold = Math.sin(x / w * nf * TAU + phases[0]) * 0.05 + Math.sin(x / w * nf * 2.7 * PI + phases[1]) * 0.025;
    dz[i] = fold * (0.3 + t * 0.9) + Math.sin(t * 5 + x * 3 + phases[2]) * 0.01 * t;
    wgt[i] = Math.pow(t, 1.3);
    // gathered at batten staples
    base[i * 3 + 1] = y - (t < 0.02 ? Math.abs(Math.sin(x * 6)) * 0.01 : 0);
  }
  const apply = (time = 0, wind = 0.4) => {
    for (let i = 0; i < p.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1], k = wgt[i];
      const gust = Math.sin(time * 0.7 + x * 0.6 + phases[3]) * 0.6 + Math.sin(time * 1.9 + x * 1.7 - y) * 0.3 + Math.sin(time * 3.7 + x * 3.1 + y * 2) * 0.1;
      const bil = wind * k * (0.18 + gust * 0.14);
      p.setXYZ(i, x + Math.sin(time * 1.3 + y * 2) * 0.01 * k * wind, Math.max(0.005, y + bil * bil * 0.4), dz[i] + bil);
    }
    p.needsUpdate = true;
    geo.computeVertexNormals();
  };
  apply(0, 0.3);
  const mesh = new THREE.Mesh(geo, MAT.sheet);
  mesh.castShadow = false; mesh.receiveShadow = true; mesh.renderOrder = 2; mesh.name = 'sheet';
  const P = new Parts();
  P.box('timber', 0, h + 0.03, 0.0, w + 0.1, 0.05, 0.025);
  const grp = P.build(group('sheeting', mesh));
  let last = -1;
  grp.userData.update = (t, wind = 0.4) => { if (Math.abs(t - last) < 1 / 40) return; last = t; apply(t, wind); };
  grp.userData.collider = null;
  grp.userData.noCollide = true;
  return grp;
}


// ================================================================== CHAPTER ONE PIECES
const lazyMat = {};
function xmat(key, make) { return lazyMat[key] ??= make(); }
const lockerMat = () => xmat('locker', () => enhance(std({ ...pbr('Metal055A'), color: 0x5f6d66, metalness: 0.35, roughness: 0.7 }, 0.8), { dust: 0.25 }));
const lockerInside = () => xmat('lockerIn', () => std({ normalMap: TEX.Metal055A.normal, color: 0x2c3330, metalness: 0.3, roughness: 0.8 }, 0.8));
const panelGrey = () => xmat('panelGrey', () => enhance(std({ normalMap: TEX.Metal055A.normal, roughnessMap: TEX.Metal055A.roughness, color: 0xc9c8c0, metalness: 0.2, roughness: 0.6 }, 0.6), { dust: 0.3 }));
const orangeTube = () => xmat('orangeTube', () => std({ color: 0xc8511c, roughness: 0.5, side: THREE.DoubleSide }));
const tile = (m) => m?.userData?.tile;
function addModel(g, id, { x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, scale = 1 } = {}) {
  try { const m = model(id, { scale }); m.position.set(x, y, z); m.rotation.set(rx, ry, rz, 'YXZ'); g.add(m); return m; } catch { return null; }
}
// model lying on its side (rotated about X by 90 degrees), resting on the floor
function lyingMatrix(id, x, z, ry, s = 1) {
  const t = template(id), sz = t.userData.box.getSize(V3());
  return mtx(x, (sz.z * s) / 2, z, ry, s, HP);
}
function canvasPlane(w, h, res, draw, { emissive = false, transparent = true } = {}) {
  const cw = res, chh = Math.round(res * h / w);
  const tex = canvasTex(cw, chh, draw, { repeat: false });
  const mat = emissive
    ? new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
    : new THREE.MeshStandardMaterial({ map: tex, transparent, roughness: 0.75, metalness: 0, depthWrite: !transparent, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.userData.tex = tex;
  return m;
}

// ------------------------------------------------------------------ scaffold tower
function scaffold({ w = 2.6, d = 1.2, h = 3.2, levels = 2, seed } = {}) {
  const r = rng(seedOf(seed));
  const P = new Parts(), R = 0.024;
  const xs = w > 2.2 ? [-w / 2, 0, w / 2] : [-w / 2, w / 2], zs = [-d / 2, d / 2];
  for (const x of xs) for (const z of zs) {
    P.tube('scaffoldTube', V3(x, 0.12, z), V3(x, h, z), R, 10);
    P.box('steelDark', x, 0.005, z, 0.15, 0.01, 0.15); // base plate
    P.tube('steelDark', V3(x, 0.01, z), V3(x, 0.14, z), 0.016, 6); // screw jack
    P.box('timber', x, -0.0, z, 0.22, 0.012, 0.22); // sole board
  }
  const decks = [];
  for (let k = 1; k <= levels; k++) decks.push(Math.min(h - 0.95, 0.3 + (k * (h - 1.0)) / levels));
  const ledgers = [0.25, ...decks, ...decks.map((y) => y + 0.5), ...decks.map((y) => y + 0.95)].filter((y) => y < h - 0.05);
  for (const y of ledgers) {
    for (const z of zs) P.tube('scaffoldTube', V3(-w / 2 - 0.08, y, z), V3(w / 2 + 0.08, y, z), R, 8);
    for (const x of xs) P.tube('scaffoldTube', V3(x, y + 0.05, -d / 2 - 0.08), V3(x, y + 0.05, d / 2 + 0.08), R, 8);
    for (const x of xs) for (const z of zs) P.box('steelDark', x, y, z, 0.075, 0.09, 0.075); // couplers
  }
  // face braces (back) and plan braces
  P.tube('scaffoldTube', V3(-w / 2, 0.25, -d / 2 - 0.04), V3(w / 2, Math.min(h - 0.1, 2.6), -d / 2 - 0.04), R, 8);
  P.tube('scaffoldTube', V3(-w / 2 - 0.04, 0.25, d / 2), V3(-w / 2 - 0.04, Math.min(h - 0.1, 1.9), -d / 2), R, 8);
  // boards on each lift, toe boards, a ladder up the end
  for (const y of decks) {
    const nb = Math.floor(d / 0.225);
    for (let i = 0; i < nb; i++) {
      if (r() < 0.08) continue;
      const z = -d / 2 + 0.12 + i * 0.225, len = w + 0.3, off = (r() - 0.5) * 0.12;
      P.box('plank', off, y + 0.055, z, len, 0.038, 0.215, { ry: (r() - 0.5) * 0.02 });
    }
    P.box('plank', 0, y + 0.15, d / 2 + 0.03, w, 0.15, 0.03);
    P.box('plank', 0, y + 0.15, -d / 2 - 0.03, w, 0.15, 0.03);
  }
  for (let y = 0.35; y < decks[decks.length - 1]; y += 0.3) P.tube('steelStud' in MAT ? 'scaffoldTube' : 'scaffoldTube', V3(w / 2 + 0.06, y, -0.2), V3(w / 2 + 0.06, y, 0.2), 0.016, 6);
  P.tube('scaffoldTube', V3(w / 2 + 0.06, 0.05, -0.2), V3(w / 2 + 0.06, decks[decks.length - 1] + 1, -0.2), 0.02, 8);
  P.tube('scaffoldTube', V3(w / 2 + 0.06, 0.05, 0.2), V3(w / 2 + 0.06, decks[decks.length - 1] + 1, 0.2), 0.02, 8);
  // a scaffold tag
  const g = P.build(group('scaffold'));
  const tag = canvasPlane(0.16, 0.2, 128, (c, W, Hh) => {
    c.fillStyle = '#e8e3d2'; c.fillRect(0, 0, W, Hh); c.fillStyle = '#c01818'; c.fillRect(0, 0, W, Hh * 0.3);
    stencilText(c, 'DO NOT', W / 2, Hh * 0.1, 18, { color: '#fff' }); stencilText(c, 'USE', W / 2, Hh * 0.22, 20, { color: '#fff' });
    c.fillStyle = '#222'; c.font = '12px monospace'; c.fillText('INSPECTED:', 8, Hh * 0.45); c.fillText('__ /__ /__', 8, Hh * 0.6); c.fillText('SIG: ', 8, Hh * 0.75);
  }, { transparent: false });
  tag.position.set(-w / 2 + 0.12, 1.25, d / 2 + 0.03); g.add(tag);
  return finish(g, { collider: { w: w + 0.2, d: d + 0.2 } });
}

// ------------------------------------------------------------------ pallets + loads
function palletBase(P, w = 1.2, d = 1.0, y0 = 0) {
  for (const x of [-w / 2 + 0.05, 0, w / 2 - 0.05]) for (const z of [-d / 2 + 0.05, 0, d / 2 - 0.05]) P.box('timber', x, y0 + 0.022 + 0.039, z, 0.1, 0.078, 0.1);
  for (const x of [-w / 2 + 0.05, 0, w / 2 - 0.05]) P.box('plank', x, y0 + 0.011, 0, 0.1, 0.022, d);
  for (const z of [-d / 2 + 0.05, 0, d / 2 - 0.05]) P.box('plank', 0, y0 + 0.111, z, w, 0.022, 0.1);
  const n = 7;
  for (let i = 0; i < n; i++) P.box('plank', 0, y0 + 0.133, -d / 2 + 0.05 + i * ((d - 0.1) / (n - 1)), w, 0.022, 0.1);
  return y0 + 0.144;
}
function pallet({ load = 'empty', seed } = {}) {
  const r = rng(seedOf(seed));
  const P = new Parts();
  let w = 1.2, d = 1.0;
  const g = group('pallet');
  if (load === 'pipes') {
    w = 1.2; d = 2.4;
    for (const z of [-0.9, 0, 0.9]) P.box('timber', 0, 0.04, z, w, 0.08, 0.1);
    const pr = 0.055, rows = [9, 8, 7, 5];
    const ends = [];
    let y = 0.08 + pr;
    rows.forEach((n, row) => {
      for (let i = 0; i < n; i++) {
        if (row === rows.length - 1 && r() < 0.3) continue;
        const x = (i - (n - 1) / 2) * pr * 2.02, len = 2.4 - r() * 0.15, zo = (r() - 0.5) * 0.12;
        const c = new THREE.CylinderGeometry(pr, pr, len, 14, 1, true); c.rotateX(HP); c.translate(x, y, zo);
        P.add(orangeTube(), c, { uv: false });
        for (const s of [-1, 1]) {
          const disc = new THREE.CircleGeometry(pr * 0.88, 14); disc.rotateY(s > 0 ? 0 : PI); disc.translate(x, y, zo + s * (len / 2 - 0.12)); ends.push(disc);
          const ring = new THREE.RingGeometry(pr * 0.88, pr, 14); ring.rotateY(s > 0 ? 0 : PI); ring.translate(x, y, zo + s * len / 2); P.add('plasticOrange', ring, { uv: false });
        }
      }
      y += pr * 1.75;
    });
    for (const e of ends) P.add('dark', e, { uv: false });
    // strapping
    for (const z of [-0.7, 0.7]) P.box('plasticBlack', 0, y / 2, z, w + 0.02, y + 0.02, 0.02);
    P.build(g);
    return finish(g, { collider: { w: w + 0.05, d: d + 0.05 } });
  }
  const top = palletBase(P, w, d);
  if (load === 'drywall') {
    // a stack of OSB / ply sheets cut down to the pallet, slightly out of square
    let y = top;
    for (let i = 0; i < 16; i++) { const t = 0.018; P.box(i % 5 === 4 ? 'plywood' : 'osb', (r() - 0.5) * 0.04, y + t / 2, (r() - 0.5) * 0.04, 1.22, t, 1.0, { ry: (r() - 0.5) * 0.03 }); y += t; }
    P.box('plasticBlack', 0, (top + y) / 2, 0.3, 1.24, y - top + 0.01, 0.02);
    P.box('plasticBlack', 0, (top + y) / 2, -0.3, 1.24, y - top + 0.01, 0.02);
    P.build(g);
  } else if (load === 'blocks') {
    const bw = 0.44, bh = 0.215, bd = 0.215;
    for (let layer = 0; layer < 3; layer++) for (let i = 0; i < 2; i++) for (let j = 0; j < 4; j++) {
      if (layer === 2 && r() < 0.35) continue;
      const rot = layer % 2 ? HP : 0;
      const [x, z] = layer % 2 ? [(j - 1.5) * bd * 1.18 + 0.02, (i - 0.5) * bw * 1.05] : [(i - 0.5) * bw * 1.05, (j - 1.5) * bd * 1.12];
      const geo = lumpy(new THREE.BoxGeometry(bw, bh, bd, 2, 2, 2), 0.004, i * 7 + j * 3 + layer, false);
      geo.rotateY(rot + (r() - 0.5) * 0.04); geo.translate(x, top + bh / 2 + layer * bh, z);
      P.add('blocks', geo);
    }
    P.build(g);
  } else if (load === 'cement') {
    P.build(g);
    const T = [];
    for (let layer = 0; layer < 4; layer++) for (let i = 0; i < 2; i++) {
      if (layer === 3 && i === 1) continue;
      const ry = (layer % 2 ? HP : 0) + (r() - 0.5) * 0.12;
      const off = (i - 0.5) * 0.47;
      T.push(mtx(layer % 2 ? 0 : off, top + layer * 0.17, layer % 2 ? off : 0, ry));
    }
    try { g.add(modelBatch('cement_bag', T)); } catch { /* model missing */ }
  } else P.build(g);
  return finish(g, { collider: { w: w + 0.05, d: d + 0.05 } });
}

// ------------------------------------------------------------------ drywall stack (1.2 x 2.4 boards on dunnage)
function drywallStack({ count = 22, seed } = {}) {
  const r = rng(seedOf(seed));
  const P = new Parts();
  for (const z of [-0.95, 0, 0.95]) P.box('timber', 0, 0.035, z, 1.3, 0.07, 0.09);
  let y = 0.07;
  for (let i = 0; i < count; i++) {
    const t = 0.0125, ox = (r() - 0.5) * 0.03, oz = (r() - 0.5) * 0.05;
    const geo = boardGeo({ x0: -0.6, x1: 0.6, y0: -1.2, y1: 1.2 }, -0.6, -1.2, -t / 2, t, i === count - 1 ? 2 : 0, 3);
    geo.rotateX(-HP); geo.rotateY((r() - 0.5) * 0.012); geo.translate(ox, y + t / 2, oz);
    P.add('drywall', geo, { uv: false });
    y += t;
  }
  // a broken corner board on top
  const geo = boardGeo({ x0: -0.6, x1: 0.2, y0: -1.2, y1: 0.4 }, -0.6, -1.2, -0.00625, 0.0125, 1, 3);
  geo.rotateX(-HP); geo.rotateY(0.3); geo.translate(0.08, y + 0.007, 0.25);
  P.add('drywall', geo, { uv: false });
  return finish(P.build(group('drywallStack')), { collider: { w: 1.3, d: 2.45 } });
}

// ------------------------------------------------------------------ rebar bundle
function rebarBundle({ count = 26, length = 3, seed } = {}) {
  const r = rng(seedOf(seed));
  const P = new Parts();
  for (const z of [-length * 0.32, length * 0.32]) P.box('timber', 0, 0.035, z, 0.5, 0.07, 0.08);
  for (let i = 0; i < count; i++) {
    const a = r() * TAU, rr = Math.sqrt(r()) * 0.09;
    const x = Math.cos(a) * rr, y = 0.07 + 0.09 + Math.sin(a) * rr * 0.8, l = length - r() * 0.3, zo = (r() - 0.5) * 0.15;
    const sag = 0.01 + r() * 0.015;
    const curve = new THREE.CatmullRomCurve3([V3(x, y + 0.01, -l / 2 + zo), V3(x + (r() - 0.5) * 0.02, y - sag, zo), V3(x, y + 0.01, l / 2 + zo)]);
    P.add('rust', new THREE.TubeGeometry(curve, 10, 0.008, 5, false), { uv: 0.5 });
  }
  for (const z of [-0.8, 0, 0.8]) { const t = new THREE.TorusGeometry(0.105, 0.003, 4, 16); t.translate(0, 0.16, z); P.add('steelDark', t, { uv: false }); }
  return finish(P.build(group('rebarBundle')), { collider: { w: 0.5, d: length } });
}

// ------------------------------------------------------------------ sawhorse
function sawhorse({ seed } = {}) {
  const r = rng(seedOf(seed));
  const P = new Parts();
  const L = 1.0, Hh = 0.74;
  P.box('timber', 0, Hh - 0.045, 0, L, 0.09, 0.09);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const top = V3(sx * (L / 2 - 0.08), Hh - 0.07, sz * 0.03), foot = V3(sx * (L / 2 - 0.02), 0, sz * 0.25);
    const dir = new THREE.Vector3().subVectors(top, foot), len = dir.length();
    const geo = new THREE.BoxGeometry(0.07, len, 0.04);
    const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), dir.normalize());
    geo.applyQuaternion(q); geo.translate((top.x + foot.x) / 2, (top.y + foot.y) / 2, (top.z + foot.z) / 2);
    P.add('timber', geo);
  }
  for (const sx of [-1, 1]) P.box('plywood', sx * (L / 2 - 0.05), 0.35, 0, 0.018, 0.16, 0.36);
  // saw kerfs and a pencil, a few offcuts on top
  P.box('plank', 0.1, Hh + 0.02, 0.0, 0.5, 0.04, 0.12, { ry: r() * 0.4 });
  return finish(P.build(group('sawhorse')), { collider: { w: L, d: 0.5 } });
}

// ------------------------------------------------------------------ pedestrian barrier
function barrier({ w = 2.0 } = {}) {
  const P = new Parts();
  const Hh = 1.0;
  for (const sx of [-1, 1]) {
    P.tube('yellowPaint', V3(sx * w / 2, 0.06, 0), V3(sx * w / 2, Hh, 0), 0.022, 8);
    P.box('plasticBlack', sx * w / 2, 0.035, 0, 0.12, 0.07, 0.62); // rubber foot
  }
  P.tube('yellowPaint', V3(-w / 2, Hh, 0), V3(w / 2, Hh, 0), 0.022, 8);
  P.tube('yellowPaint', V3(-w / 2, 0.18, 0), V3(w / 2, 0.18, 0), 0.018, 8);
  for (let x = -w / 2 + 0.12; x < w / 2; x += 0.12) P.tube('yellowPaint', V3(x, 0.18, 0), V3(x, Hh, 0), 0.007, 5);
  P.box('hazard', 0, 0.82, 0.03, w - 0.08, 0.2, 0.01, { uv: 0.4 });
  P.box('hazard', 0, 0.82, -0.03, w - 0.08, 0.2, 0.01, { uv: 0.4 });
  return finish(P.build(group('barrier')), { collider: { w: w + 0.1, d: 0.3 } });
}

// ------------------------------------------------------------------ caution tape between two world points
function ribbon(points, width, twist) {
  const n = points.length, pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2), idx = [];
  let len = 0;
  for (let i = 0; i < n; i++) {
    if (i) len += points[i].distanceTo(points[i - 1]);
    const t = points[Math.min(n - 1, i + 1)].clone().sub(points[Math.max(0, i - 1)]).normalize();
    let side = new THREE.Vector3().crossVectors(t, V3(0, 1, 0));
    if (side.lengthSq() < 1e-4) side = V3(1, 0, 0);
    side.normalize();
    const up = new THREE.Vector3().crossVectors(side, t).normalize();
    const a = twist(i / (n - 1));
    const dir = up.multiplyScalar(Math.cos(a)).add(side.multiplyScalar(Math.sin(a))).multiplyScalar(width / 2);
    const p0 = points[i].clone().add(dir), p1 = points[i].clone().sub(dir);
    pos.set([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z], i * 6);
    uv.set([len / 0.6, 1, len / 0.6, 0], i * 4);
    if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function cautionTape(a, b, { torn = false, sag = 0.09, width = 0.075, seed } = {}) {
  const r = rng(seedOf(seed));
  const g = group('cautionTape');
  const strand = (p, q, s, ph) => {
    const pts = [];
    for (let i = 0; i <= 24; i++) { const t = i / 24; pts.push(p.clone().lerp(q, t).add(V3(0, -Math.sin(t * PI) * s, 0))); }
    return ribbon(pts, width, (t) => Math.sin(t * 7 + ph) * 0.5);
  };
  if (!torn) g.add(new THREE.Mesh(strand(a, b, sag, r() * 6), MAT.tape));
  else {
    // snapped: each end hangs down, twisting
    for (const [p, q] of [[a, b], [b, a]]) {
      const dir = q.clone().sub(p); const l = dir.length() * (0.25 + r() * 0.2);
      const pts = [];
      for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push(p.clone().add(dir.clone().setLength(l * Math.sin(t * HP) * 0.35)).add(V3((r() - 0.5) * 0.01, -t * l * 1.6, 0))); }
      g.add(new THREE.Mesh(ribbon(pts, width, (t) => t * 5 + r()), MAT.tape));
    }
  }
  g.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = true; } });
  return g;
}

// ------------------------------------------------------------------ cables hanging from the deck (origin at the deck)
function hangingCables({ w = 20, d = 14, count = 14, seed } = {}) {
  const r = rng(seedOf(seed));
  const P = new Parts();
  const cols = [[0.05, 0.05, 0.05], [0.12, 0.12, 0.13], [0.55, 0.2, 0.05], [0.45, 0.45, 0.42], [0.2, 0.3, 0.15], [0.6, 0.5, 0.1]];
  const colour = (geo, c) => { const n = geo.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(c, i * 3); geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo; };
  for (let i = 0; i < count; i++) {
    const c = pick(r, cols), rad = 0.006 + r() * 0.01;
    const x0 = (r() - 0.5) * w, z0 = (r() - 0.5) * d;
    if (r() < 0.35) { // a dangling end, cut and taped
      const len = 0.5 + r() * 0.8, pts = [];
      for (let k = 0; k <= 8; k++) { const t = k / 8; pts.push(V3(x0 + Math.sin(t * 3 + i) * 0.04 * t, -t * len, z0 + Math.cos(t * 2 + i) * 0.05 * t)); }
      P.add(MAT.cable, colour(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, rad, 6, false), c), { uv: false });
      const tip = new THREE.CylinderGeometry(rad * 0.5, rad * 0.5, 0.025, 5); tip.translate(pts[8].x, pts[8].y - 0.012, pts[8].z); P.add('copper', tip, { uv: false });
      continue;
    }
    const a = r() * TAU, span = 1.5 + r() * 4, x1 = x0 + Math.cos(a) * span, z1 = z0 + Math.sin(a) * span;
    const sag = 0.25 + r() * 0.75, pts = [];
    for (let k = 0; k <= 12; k++) { const t = k / 12; pts.push(V3(x0 + (x1 - x0) * t, -0.02 - Math.sin(t * PI) * sag, z0 + (z1 - z0) * t)); }
    P.add(MAT.cable, colour(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, rad, 6, false), c), { uv: false });
    for (const p of [pts[0], pts[12]]) P.box('steelDark', p.x, -0.01, p.z, 0.04, 0.02, 0.04);
  }
  const g = P.build(group('hangingCables'));
  g.traverse((m) => { if (m.isMesh) m.castShadow = false; });
  return g;
}

// ------------------------------------------------------------------ duct run along X (origin at duct centre; rods rise to the deck)
function ductRun({ length = 20, w = 0.55, h = 0.32, rise = 0.45, drop = true, seed } = {}) {
  const r = rng(seedOf(seed));
  const P = new Parts();
  const L = length, seg = 1.2;
  const gapAt = -L / 2 + Math.floor(r() * (L / seg - 2) + 1) * seg; // one missing section
  for (let x = -L / 2; x < L / 2 - 0.01; x += seg) {
    if (Math.abs(x - gapAt) < 0.01) continue;
    const l = Math.min(seg, L / 2 - x);
    P.bb('galvanized', x, -h / 2, -w / 2, x + l, h / 2, w / 2);
    P.bb('galvanized', x - 0.015, -h / 2 - 0.02, -w / 2 - 0.02, x + 0.015, h / 2 + 0.02, w / 2 + 0.02);
  }
  // the open ends of the gap: dark inside
  for (const x of [gapAt, gapAt + seg]) { const q = new THREE.PlaneGeometry(w - 0.02, h - 0.02); q.rotateY(x === gapAt ? HP : -HP); q.translate(x + (x === gapAt ? 0.02 : -0.02), 0, 0); P.add('dark', q, { uv: false }); }
  for (let x = -L / 2 + 0.6; x < L / 2; x += 2.4) {
    P.bb('steelDark', x - 0.02, -h / 2 - 0.045, -w / 2 - 0.12, x + 0.02, -h / 2, w / 2 + 0.12); // unistrut
    for (const z of [-w / 2 - 0.08, w / 2 + 0.08]) P.tube('steelDark', V3(x, -h / 2 - 0.04, z), V3(x, rise, z), 0.005, 5);
  }
  if (drop) { // a flexible foil duct hanging down, never connected
    const x0 = gapAt - seg * 2 + 0.6, pts = [V3(x0, -h / 2, 0), V3(x0 + 0.1, -h / 2 - 0.4, 0.1), V3(x0 + 0.35, -h / 2 - 0.85, 0.15), V3(x0 + 0.4, -h / 2 - 1.05, 0.05)];
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.13, 14, false);
    const p = tube.attributes.position, n = tube.attributes.normal;
    for (let i = 0; i < p.count; i++) { const k = Math.sin(i * 0.9) * 0.008; p.setXYZ(i, p.getX(i) + n.getX(i) * k, p.getY(i) + n.getY(i) * k, p.getZ(i) + n.getZ(i) * k); }
    tube.computeVertexNormals();
    P.add('foil', tube, { uv: 0.3 });
  }
  return finish(P.build(group('ductRun')), { cast: true });
}

// ------------------------------------------------------------------ pipe run along X on trapeze hangers
function pipeRun({ length = 30, rise = 0.25, seed } = {}) {
  const r = rng(seedOf(seed));
  const P = new Parts();
  const pipes = [[0.0, 0.055, 'steelDark'], [0.16, 0.035, 'copper'], [0.29, 0.026, 'pvc'], [-0.15, 0.045, 'redPaint']];
  for (const [z, rad, m] of pipes) {
    const c = new THREE.CylinderGeometry(rad, rad, length, 12, 1, false); c.rotateZ(HP); c.translate(0, -0.05 - rad, z);
    P.add(m, c, { uv: 0.6 });
    for (let x = -length / 2 + 1.5; x < length / 2; x += 3 + r()) { const j = new THREE.CylinderGeometry(rad * 1.25, rad * 1.25, 0.06, 12); j.rotateZ(HP); j.translate(x, -0.05 - rad, z); P.add(m, j, { uv: 0.6 }); }
  }
  for (let x = -length / 2 + 0.8; x < length / 2; x += 2.5) {
    P.bb('steelDark', x - 0.02, -0.05, -0.25, x + 0.02, -0.01, 0.38);
    for (const z of [-0.23, 0.36]) P.tube('steelDark', V3(x, -0.03, z), V3(x, rise, z), 0.005, 5);
    for (const [z, rad] of pipes) { const t = new THREE.TorusGeometry(rad + 0.006, 0.005, 4, 12, PI); t.rotateY(HP); t.rotateX(PI); t.translate(x, -0.05 - rad, z); P.add('galvanized', t, { uv: false }); }
  }
  return finish(P.build(group('pipeRun')));
}

// ------------------------------------------------------------------ floor debris (visual only, no colliders)
function debris({ w = 10, d = 10, seed, density = 1 } = {}) {
  const r = rng(seedOf(seed));
  const P = new Parts();
  const n = Math.round(w * d * 0.12 * density);
  const rx = () => (r() - 0.5) * w, rz = () => (r() - 0.5) * d;
  for (let i = 0; i < n; i++) {
    const k = r(), x = rx(), z = rz(), ry = r() * TAU;
    if (k < 0.28) { // drywall offcut
      const a = 0.08 + r() * 0.45, b = 0.08 + r() * 0.35;
      const geo = boardGeo({ x0: 0, x1: a, y0: 0, y1: b }, -r() * 0.6, -r() * 2, -0.006, 0.0125, r() < 0.5 ? 0 : 1, 3);
      geo.rotateX(-HP); geo.rotateY(ry); geo.translate(x, 0.0065, z); P.add('drywall', geo, { uv: false });
    } else if (k < 0.43) { // timber offcut / batten
      P.box(r() < 0.5 ? 'timber' : 'plank', x, 0.022, z, 0.15 + r() * 0.8, 0.045, 0.07, { ry });
    } else if (k < 0.55) { // metal stud offcut
      P.box('metalStud', x, 0.018, z, 0.2 + r() * 0.9, 0.035, 0.09, { ry });
    } else if (k < 0.72) { // plaster dust pile
      const s = 0.12 + r() * 0.35;
      const geo = lumpy(new THREE.SphereGeometry(1, 10, 6, 0, TAU, 0, HP), 0.08, i);
      geo.scale(s, s * (0.12 + r() * 0.1), s * (0.6 + r() * 0.5)); geo.rotateY(ry); geo.translate(x, 0, z);
      P.add('dusty', geo, { uv: 0.6 });
    } else if (k < 0.84) { // paper / packaging
      const geo = new THREE.PlaneGeometry(0.21 + r() * 0.2, 0.15 + r() * 0.2, 3, 3);
      const p = geo.attributes.position; for (let j = 0; j < p.count; j++) p.setZ(j, r() * 0.01);
      geo.rotateX(-HP); geo.rotateY(ry); geo.translate(x, 0.002, z); geo.computeVertexNormals();
      P.add(r() < 0.6 ? 'paper' : 'osb', geo, { uv: false });
    } else if (k < 0.92) { // cable offcut
      const pts = []; let px = x, pz = z, a = ry;
      for (let j = 0; j < 6; j++) { pts.push(V3(px, 0.008, pz)); a += (r() - 0.5) * 1.6; px += Math.cos(a) * 0.12; pz += Math.sin(a) * 0.12; }
      P.add(r() < 0.5 ? 'plasticBlack' : 'plasticOrange', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.007, 5, false), { uv: false });
    } else { // screws / fixings box spilled, plastic cup
      const c = new THREE.CylinderGeometry(0.035, 0.028, 0.09, 10, 1, true); c.rotateZ(HP); c.rotateY(ry); c.translate(x, 0.035, z); P.add('plasticWhite', c, { uv: false });
    }
  }
  const g = P.build(group('debris'));
  // a few hand tools and cans dropped where people stopped working
  const lie = { crowbar_01: [], sledgehammer_01: [], wooden_broom: [], spray_paint_bottles: [], Drill_01: [] };
  const nTools = Math.max(1, Math.round(w * d / 45));
  for (let i = 0; i < nTools; i++) {
    const id = pick(r, Object.keys(lie));
    try { lie[id].push(id === 'spray_paint_bottles' || id === 'Drill_01' ? mtx(rx(), 0, rz(), r() * TAU) : lyingMatrix(id, rx(), rz(), r() * TAU)); } catch { /* */ }
  }
  for (const [id, T] of Object.entries(lie)) if (T.length) { try { g.add(modelBatch(id, T)); } catch { /* */ } }
  g.traverse((m) => { if (m.isMesh) { m.castShadow = m.name !== 'paper' && m.name !== 'dusty'; m.receiveShadow = true; } });
  g.userData.collider = null; g.userData.noCollide = true;
  return g;
}

// ------------------------------------------------------------------ spray-painted marks (wall decal, faces +Z)
function sprayMark(text, { w = 1.2, h = 0.35, color = '#d9d4c8', seed } = {}) {
  const r = rng(seedOf(seed));
  const m = canvasPlane(w, h, 512, (c, W, Hh) => { c.clearRect(0, 0, W, Hh); sprayText(c, text, W / 2, Hh / 2, Hh * 0.62, color, r, { maxW: W * 0.92 }); });
  m.material.alphaTest = 0.02; m.material.roughness = 0.85;
  m.position.z = 0.004; m.castShadow = false; m.receiveShadow = true;
  const g = group('sprayMark', m); g.userData.noCollide = true;
  return g;
}

// ------------------------------------------------------------------ tripod work light (twin heads; front +Z)
function workLight({ on = false } = {}) {
  const g = group('workLight');
  const t = partTemplate('flood_lights', 'flood_lights_standing_double_b');
  const heads = [];
  const lens = new THREE.PlaneGeometry(0.235, 0.15);
  if (t) {
    const body = t.clone(); g.add(body);
    const off = t.userData.offset; // world -> local
    for (const name of ['flood_lights_standing_double_b_light_01', 'flood_lights_standing_double_b_light_02']) {
      const b = partTemplate('flood_lights', name, { center: false })?.userData.box;
      if (!b) continue;
      const m = new THREE.Mesh(lens, on ? MAT.lampOn : MAT.lampOff);
      m.position.set((b.min.x + b.max.x) / 2 + off.x, (b.min.y + b.max.y) / 2 + off.y, b.max.z + off.z + 0.003);
      g.add(m); heads.push(m);
    }
  } else {
    const P = new Parts();
    P.tube('steelDark', V3(0, 0, 0), V3(0, 1.5, 0), 0.02);
    P.build(g);
  }
  // a cable off the stand, along the floor
  const P = new Parts();
  const pts = [V3(0.05, 0.9, -0.05), V3(0.1, 0.35, -0.25), V3(0.05, 0.01, -0.55), V3(-0.4, 0.01, -1.4), V3(-0.3, 0.01, -2.4)];
  P.add('plasticOrange', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 30, 0.008, 6, false), { uv: false });
  P.build(g);
  g.userData.heads = heads;
  g.userData.setOn = (v) => { for (const m of heads) m.material = v ? MAT.lampOn : MAT.lampOff; };
  return finish(g, { collider: { w: 0.7, d: 0.7 } });
}

// ------------------------------------------------------------------ zone breaker / isolator (wall-mounted, back at z=0, origin = centre)
function breakerPanel({ label = 'ZONE' } = {}) {
  const g = group('breakerPanel');
  const P = new Parts();
  const W = 0.44, Hh = 0.62, D = 0.17;
  P.bb(panelGrey(), -W / 2, -Hh / 2, 0, W / 2, Hh / 2, D);
  for (const [x0, y0, x1, y1] of [[-W / 2 + 0.02, -Hh / 2 + 0.02, W / 2 - 0.02, -Hh / 2 + 0.026], [-W / 2 + 0.02, Hh / 2 - 0.026, W / 2 - 0.02, Hh / 2 - 0.02], [-W / 2 + 0.02, -Hh / 2 + 0.02, -W / 2 + 0.026, Hh / 2 - 0.02], [W / 2 - 0.026, -Hh / 2 + 0.02, W / 2 - 0.02, Hh / 2 - 0.02]]) P.bb('steelDark', x0, y0, D, x1, y1, D + 0.002);
  P.bb('steelDark', -W / 2 - 0.02, -Hh / 2 - 0.02, -0.01, W / 2 + 0.02, Hh / 2 + 0.02, 0.0); // backboard
  P.bb('plywood', -W / 2 - 0.1, -Hh / 2 - 0.12, -0.03, W / 2 + 0.25, Hh / 2 + 0.1, -0.01);
  P.tube('pvc', V3(-0.1, Hh / 2, 0.08), V3(-0.1, Hh / 2 + 1.9, 0.08), 0.025, 10); // conduit to the deck
  P.tube('pvc', V3(0.1, Hh / 2, 0.08), V3(0.1, Hh / 2 + 1.9, 0.08), 0.018, 10);
  for (const x of [-0.1, 0.1]) P.box('plasticGrey', x, Hh / 2 + 0.02, 0.08, 0.07, 0.04, 0.07);
  // the isolator: a big lever on the right-hand side, down = off
  P.bb('steelDark', W / 2, -0.08, 0.04, W / 2 + 0.05, 0.08, 0.14);
  P.build(g);
  const lever = new THREE.Group(); lever.position.set(W / 2 + 0.05, 0, 0.09);
  const LP = new Parts();
  LP.bb('steelDark', 0, -0.015, -0.015, 0.03, 0.015, 0.015);
  LP.tube('steelDark', V3(0.015, 0, 0), V3(0.015, 0.22, 0), 0.01, 6);
  LP.tube('redPaint', V3(0.015, 0.16, 0), V3(0.015, 0.27, 0), 0.02, 10);
  LP.build(lever);
  lever.rotation.x = 0; g.add(lever);
  // status LEDs
  const ledG = new THREE.CylinderGeometry(0.012, 0.012, 0.01, 12); ledG.rotateX(HP);
  const ledOff = new THREE.Mesh(ledG, MAT.ledRed), ledOn = new THREE.Mesh(ledG, MAT.ledOff);
  ledOff.position.set(-0.12, Hh / 2 - 0.07, D + 0.005); ledOn.position.set(-0.06, Hh / 2 - 0.07, D + 0.005);
  g.add(ledOff, ledOn);
  // door print: warning triangle, zone plate (redrawn by label())
  const face = canvasPlane(W - 0.06, Hh - 0.06, 256, () => {}, { transparent: true });
  face.position.set(0, 0, D + 0.003); g.add(face);
  const draw = (text) => {
    const c = face.userData.tex.userData.canvas, x = c.getContext('2d'), Wc = c.width, Hc = c.height;
    x.clearRect(0, 0, Wc, Hc);
    x.fillStyle = '#f2c40c'; x.beginPath(); x.moveTo(Wc / 2, Hc * 0.2); x.lineTo(Wc / 2 + 52, Hc * 0.2 + 90); x.lineTo(Wc / 2 - 52, Hc * 0.2 + 90); x.closePath(); x.fill();
    x.strokeStyle = '#111'; x.lineWidth = 6; x.stroke();
    x.fillStyle = '#111'; x.beginPath(); x.moveTo(Wc / 2 + 6, Hc * 0.2 + 26); x.lineTo(Wc / 2 - 12, Hc * 0.2 + 62); x.lineTo(Wc / 2 + 2, Hc * 0.2 + 60); x.lineTo(Wc / 2 - 6, Hc * 0.2 + 84); x.lineTo(Wc / 2 + 14, Hc * 0.2 + 50); x.lineTo(Wc / 2, Hc * 0.2 + 52); x.closePath(); x.fill();
    stencilText(x, 'DANGER 415 V', Wc / 2, Hc * 0.2 + 118, 22);
    x.fillStyle = '#f4f2ea'; x.fillRect(22, Hc * 0.62, Wc - 44, 70); x.strokeStyle = '#333'; x.lineWidth = 2; x.strokeRect(22, Hc * 0.62, Wc - 44, 70);
    stencilText(x, 'TEMP SUPPLY', Wc / 2, Hc * 0.62 + 20, 16, { color: '#444' });
    stencilText(x, text, Wc / 2, Hc * 0.62 + 48, 24, { maxW: Wc - 60 });
    x.fillStyle = 'rgba(60,50,40,0.35)'; for (let i = 0; i < 6; i++) x.fillRect(Math.random() * Wc, Hc * 0.9 + Math.random() * 20, 18, 4); // grubby fingerprints
    face.userData.tex.needsUpdate = true;
  };
  draw(label);
  g.userData.label = draw;
  g.userData.lever = lever;
  g.userData.setOn = (on) => { lever.rotation.x = on ? 0 : PI * 0.78; ledOff.material = on ? MAT.ledOff : MAT.ledRed; ledOn.material = on ? MAT.ledGreen : MAT.ledOff; };
  g.userData.setOn(false);
  return finish(g);
}

// ------------------------------------------------------------------ portable generator on a pallet, cable to a spider box
function generator() {
  const g = group('generator');
  const P = new Parts();
  const top = palletBase(P, 1.2, 1.0);
  // spider box (distribution) + cables
  P.bb('yellowPaint', 0.75, 0, -0.25, 1.05, 0.32, 0.05);
  for (let i = 0; i < 4; i++) P.box('plasticBlack', 0.8 + i * 0.07, 0.25, 0.06, 0.05, 0.05, 0.03);
  const c1 = [V3(0.35, top + 0.25, 0.25), V3(0.6, 0.05, 0.25), V3(0.78, 0.01, 0.1), V3(0.85, 0.2, 0.06)];
  P.add('plasticOrange', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(c1), 20, 0.012, 6, false), { uv: false });
  const c2 = [V3(1.0, 0.2, 0.06), V3(1.1, 0.01, 0.4), V3(1.6, 0.01, 1.2), V3(1.4, 0.01, 2.6), V3(2.2, 0.01, 3.6)];
  P.add('plasticOrange', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(c2), 40, 0.014, 6, false), { uv: false });
  // drip tray + diesel stain
  P.bb('steelDark', -0.62, top, -0.52, 0.62, top + 0.03, 0.52);
  P.build(g);
  const body = new THREE.Group(); body.position.y = top + 0.03; g.add(body);
  const gen = addModel(body, 'portable_generator', { scale: 1.4 });
  if (!gen) { const PP = new Parts(); PP.bb('redPaint', -0.55, 0, -0.38, 0.55, 0.8, 0.38); PP.build(body); }
  // exhaust soot on the wall side, warning sign on a stake
  const sign = canvasPlane(0.3, 0.2, 256, (c, W, Hh) => {
    c.fillStyle = '#f4f2ea'; c.fillRect(0, 0, W, Hh); c.fillStyle = '#0b6b2c'; c.fillRect(0, 0, W, Hh * 0.28);
    stencilText(c, 'TEMPORARY SUPPLY', W / 2, Hh * 0.14, 20, { color: '#fff' });
    stencilText(c, 'REFUEL ENGINE OFF', W / 2, Hh * 0.45, 22); stencilText(c, 'DIESEL ONLY', W / 2, Hh * 0.66, 26, { color: '#b31010' });
    stencilText(c, 'RECOIL START · 3 PULLS', W / 2, Hh * 0.86, 15, { color: '#444' });
  }, { transparent: false });
  sign.position.set(-0.45, top + 0.95, 0.42); sign.rotation.y = 0.15; g.add(sign);
  const PS = new Parts(); PS.box('timber', -0.45, (top + 0.85) / 2, 0.4, 0.04, top + 0.85, 0.04); PS.build(g);
  let running = false, k = 0;
  g.userData.fuelCap = V3(0.2, top + 0.85, 0);
  g.userData.setRunning = (on) => { running = on; };
  g.userData.update = (t) => {
    if (!running) { if (k) { body.position.x = 0; body.rotation.set(0, 0, 0); k = 0; } return; }
    k = 1; body.position.x = Math.sin(t * 93) * 0.0016; body.rotation.z = Math.sin(t * 71) * 0.004; body.rotation.x = Math.sin(t * 57) * 0.002;
  };
  return finish(g, { collider: { w: 1.25, d: 1.05 } });
}

function fuelCan() {
  const g = group('fuelCan');
  if (!addModel(g, 'metal_jerrycan')) { const P = new Parts(); P.bb('redPaint', -0.17, 0, -0.08, 0.17, 0.45, 0.08); P.build(g); }
  return finish(g, { collider: { w: 0.38, d: 0.2 } });
}

// ------------------------------------------------------------------ freight lift: landing doors at z=0 (wall face), car behind (−z)
function freightLift({ w = 2.6, d = 2.4, h = 2.8, wall = 0.3 } = {}) {
  const g = group('freightLift');
  const P = new Parts();
  const fw = 0.14;
  // portal frame (jambs + header) proud of the wall
  P.bb('liftSteel', -w / 2 - fw, 0, -wall, -w / 2, h + fw, 0.06);
  P.bb('liftSteel', w / 2, 0, -wall, w / 2 + fw, h + fw, 0.06);
  P.bb('liftSteel', -w / 2 - fw, h, -wall, w / 2 + fw, h + fw + 0.35, 0.06);
  P.bb('hazard', -w / 2 - fw, 0, 0.0, w / 2 + fw, 0.012, 0.25, { uv: 0.5 }); // sill
  P.bb('diamond', -w / 2, -0.02, -wall, w / 2, 0.005, 0);
  // the car
  const z0 = -wall, z1 = -wall - d;
  P.bb('diamond', -w / 2, -0.03, z1, w / 2, 0.006, z0);
  P.bb('liftSteel', -w / 2 - 0.08, 0, z1, -w / 2, h + 0.1, z0);
  P.bb('liftSteel', w / 2, 0, z1, w / 2 + 0.08, h + 0.1, z0);
  P.bb('liftSteel', -w / 2 - 0.08, 0, z1 - 0.08, w / 2 + 0.08, h + 0.1, z1);
  P.bb('liftSteel', -w / 2 - 0.08, h + 0.1, z1 - 0.08, w / 2 + 0.08, h + 0.18, z0);
  for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) { P.tube('galvanized', V3(x, 0.95, z0 - 0.2), V3(x, 0.95, z1 + 0.2), 0.02, 8); for (const z of [z0 - 0.25, z1 + 0.25]) P.tube('galvanized', V3(x, 0.95, z), V3(x + Math.sign(x) * 0.05, 0.95, z), 0.015, 6); }
  // ply wall protection blankets, scuffed
  for (const x of [-w / 2 + 0.01, w / 2 - 0.01]) P.bb('plywood', x - 0.009, 0.15, z1 + 0.1, x + 0.009, 1.35, z0 - 0.1);
  P.bb('lampOn', -0.5, h + 0.09, (z0 + z1) / 2 - 0.4, 0.5, h + 0.1, (z0 + z1) / 2 + 0.4);
  // car operating panel
  P.bb('steelDark', w / 2 - 0.02, 0.9, z0 - 0.4, w / 2, 1.5, z0 - 0.2);
  P.build(g);
  // landing doors: two leaves that slide apart into the wall
  const leafW = w / 2 + 0.03;
  const leaves = [-1, 1].map((s) => {
    const LP = new Parts();
    LP.bb('liftDoor', -leafW / 2, 0.01, -0.03, leafW / 2, h - 0.01, 0.0);
    LP.bb('steelDark', -leafW / 2, 0.01, -0.035, -leafW / 2 + 0.01, h - 0.01, 0.002);
    LP.bb('hazard', -leafW / 2, 1.0, 0.0, leafW / 2, 1.08, 0.002, { uv: 0.4 });
    const leaf = LP.build(group('leaf'));
    leaf.userData.closedX = s * leafW / 2 - s * 0.015; leaf.position.set(leaf.userData.closedX, 0, -0.06);
    g.add(leaf); return leaf;
  });
  // stencil on the header + the floor indicator
  const head = canvasPlane(1.4, 0.2, 512, (c, W, Hh) => { c.clearRect(0, 0, W, Hh); stencilText(c, 'GOODS LIFT · 2000 KG · D', W / 2, Hh / 2, Hh * 0.55, { color: '#d8d4c8', maxW: W * 0.95 }); });
  head.position.set(-0.25, h + fw + 0.17, 0.062); g.add(head);
  const cv = mkCanvas(128, 64), ctx = cv.getContext('2d');
  ctx.fillStyle = '#050605'; ctx.fillRect(0, 0, 128, 64); ctx.fillStyle = '#4a2a10'; ctx.font = 'bold 38px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('--', 64, 33);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = SRGB;
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.14), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  scr.position.set(w / 2 - 0.3, h + fw + 0.17, 0.063); g.add(scr);
  // landing call station with keyswitch
  const cs = new Parts();
  cs.bb('liftSteel', w / 2 + fw + 0.2, 1.0, 0, w / 2 + fw + 0.36, 1.42, 0.03);
  cs.tube('steelDark', V3(w / 2 + fw + 0.28, 1.34, 0.03), V3(w / 2 + fw + 0.28, 1.34, 0.045), 0.018, 12);
  cs.build(g);
  const btnGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.018, 16); btnGeo.rotateX(HP);
  const btn = new THREE.Mesh(btnGeo, MAT.ledOff); btn.position.set(w / 2 + fw + 0.28, 1.17, 0.04); g.add(btn);
  const keyTag = canvasPlane(0.12, 0.05, 128, (c, W, Hh) => { c.fillStyle = '#d8d4c8'; c.fillRect(0, 0, W, Hh); stencilText(c, 'SUPERVISOR', W / 2, Hh / 2, 14); }, { transparent: false });
  keyTag.position.set(w / 2 + fw + 0.28, 1.39, 0.031); g.add(keyTag);
  g.userData.callButton = btn;
  g.userData.screens = [{ ctx, canvas: cv, texture: tex }];
  g.userData.setButtonLit = (on) => { btn.material = on ? MAT.ledAmber : MAT.ledOff; };
  g.userData.setDoors = (v) => { for (const l of leaves) l.position.x = l.userData.closedX + Math.sign(l.userData.closedX) * v * (leafW - 0.02); };
  g.userData.doorCollider = { minX: -w / 2, maxX: w / 2, minZ: -0.12, maxZ: 0 };
  g.userData.carCenter = V3(0, 0, (z0 + z1) / 2);
  g.userData.colliders = [
    { minX: -w / 2 - fw - 0.05, maxX: -w / 2, minZ: z1 - 0.1, maxZ: 0.06 },
    { minX: w / 2, maxX: w / 2 + fw + 0.05, minZ: z1 - 0.1, maxZ: 0.06 },
    { minX: -w / 2 - 0.1, maxX: w / 2 + 0.1, minZ: z1 - 0.15, maxZ: z1 },
  ];
  return finish(g);
}

// ------------------------------------------------------------------ Lind's site office (furniture set; front = +Z, toward the door)
function siteOffice({ seed = 11 } = {}) {
  const r = rng(seed);
  const g = group('siteOffice');
  const deskZ = -1.4;
  addModel(g, 'metal_office_desk', { z: deskZ, ry: 0 });
  const top = 0.79;
  addModel(g, 'plastic_monobloc_chair_01', { x: 0.2, z: deskZ - 0.85, ry: PI + 0.35 });
  addModel(g, 'classic_laptop', { x: -0.35, y: top, z: deskZ - 0.05, ry: PI + 0.1 });
  addModel(g, 'desk_lamp_arm_01', { x: 0.75, y: top, z: deskZ - 0.25, ry: PI - 0.6 });
  addModel(g, 'portable_cassette_player', { x: 0.25, y: top + 0.056, z: deskZ + 0.1, ry: PI - 0.25 });
  addModel(g, 'binder_notebook', { x: -0.8, y: top, z: deskZ + 0.2, ry: 0.2 });
  addModel(g, 'binder_notebook', { x: -0.78, y: top + 0.03, z: deskZ + 0.18, ry: -0.15 });
  addModel(g, 'clipboard', { x: 0.45, y: top, z: deskZ + 0.25, ry: 0.4 });
  addModel(g, 'wall_clock', { x: 1.2, y: 2.15, z: -3.97 });
  addModel(g, 'steel_frame_shelves_01', { x: -3.6, z: -3.65 });
  addModel(g, 'cardboard_box_01', { x: -3.7, y: 0.0, z: -2.6, ry: 0.3 });
  addModel(g, 'cardboard_box_01', { x: -3.6, y: 0.34, z: -2.65, ry: -0.2 });
  addModel(g, 'trashbag', { x: 3.6, z: 2.8, ry: 1 });
  addModel(g, 'plastic_jerrycan', { x: 3.75, z: -3.6, ry: 0.4 });
  const P = new Parts();
  // camp bed with a sleeping bag: he was living in here
  P.tube('steelDark', V3(2.6, 0.32, -3.6), V3(2.6, 0.32, -1.6), 0.015, 6); P.tube('steelDark', V3(3.4, 0.32, -3.6), V3(3.4, 0.32, -1.6), 0.015, 6);
  for (const z of [-3.5, -1.7]) { P.tube('steelDark', V3(2.6, 0.32, z), V3(3.4, 0.0, z), 0.012, 6); P.tube('steelDark', V3(3.4, 0.32, z), V3(2.6, 0.0, z), 0.012, 6); }
  const bag = lumpy(new THREE.BoxGeometry(0.75, 0.12, 1.9, 6, 2, 10), 0.03, 4); bag.translate(3.0, 0.38, -2.6);
  P.add(MAT.greenPaint, bag, { uv: 1 });
  const pillow = lumpy(new THREE.BoxGeometry(0.5, 0.1, 0.3, 4, 2, 3), 0.02, 9); pillow.translate(3.0, 0.47, -3.35); P.add('paper', pillow, { uv: false });
  // food tins, bottles, a stack of tapes on the floor by the bed
  for (let i = 0; i < 9; i++) { const c = new THREE.CylinderGeometry(0.037, 0.037, 0.11, 12); c.translate(2.2 + r() * 0.5, 0.055, -1.4 + r() * 0.6); if (r() < 0.4) { c.rotateX(HP); c.translate(0, -0.02, 0); } P.add('galvanized', c, { uv: false }); }
  for (let i = 0; i < 4; i++) { const c = new THREE.CylinderGeometry(0.04, 0.04, 0.3, 12); c.translate(3.7, 0.15, -1.3 + i * 0.1); P.add(MAT.glass, c, { uv: false }); }
  for (let i = 0; i < 11; i++) P.box(i % 3 ? 'plasticBlack' : 'plasticWhite', 0.9 + (r() - 0.5) * 0.01, top + 0.008 + i * 0.016, deskZ + 0.15, 0.11, 0.015, 0.07, { ry: (r() - 0.5) * 0.3 });
  // pinned drawings and the calendar on the back wall (z = -4)
  const wallZ = -3.985;
  const plan = canvasPlane(1.1, 0.75, 512, (c, W, Hh) => {
    c.fillStyle = '#dfe6ea'; c.fillRect(0, 0, W, Hh); c.strokeStyle = '#2a4a8a'; c.lineWidth = 2;
    for (let i = 0; i < 10; i++) c.strokeRect(20 + r() * (W - 140), 20 + r() * (Hh - 120), 60 + r() * 120, 40 + r() * 80);
    c.strokeStyle = '#b01010'; c.lineWidth = 5; c.beginPath(); c.arc(W * 0.18, Hh * 0.7, 30, 0, TAU); c.stroke();
    c.fillStyle = '#b01010'; c.font = 'bold 22px monospace'; c.fillText('LIFT → D-3 → LANTERN-0', W * 0.25, Hh * 0.72);
    c.fillStyle = '#2a4a8a'; c.font = '14px monospace'; c.fillText('WING D · LEVEL D · GENERAL ARRANGEMENT · REV F', 20, Hh - 16);
  }, { transparent: false });
  plan.position.set(-1.2, 1.65, wallZ); plan.rotation.y = 0; g.add(plan);
  const cal = canvasPlane(0.42, 0.6, 256, (c, W, Hh) => {
    c.fillStyle = '#f2efe6'; c.fillRect(0, 0, W, Hh); c.fillStyle = '#8a1010'; c.fillRect(0, 0, W, Hh * 0.33);
    stencilText(c, 'HALVERSEN', W / 2, Hh * 0.12, 24, { color: '#fff' }); stencilText(c, 'NOVEMBER', W / 2, Hh * 0.38, 20);
    const cw = (W - 20) / 7, chh = (Hh * 0.55) / 5;
    c.strokeStyle = '#999'; c.lineWidth = 1;
    for (let i = 0; i < 35; i++) { const x = 10 + (i % 7) * cw, y = Hh * 0.42 + Math.floor(i / 7) * chh; c.strokeRect(x, y, cw, chh); c.fillStyle = '#333'; c.font = '10px sans-serif'; c.fillText(String(i + 1), x + 3, y + 11); if (i < 24) { c.strokeStyle = '#1d3f9a'; c.lineWidth = 2 + i * 0.12; c.beginPath(); c.moveTo(x + 3, y + 3); c.lineTo(x + cw - 3, y + chh - 3); c.moveTo(x + cw - 3, y + 3); c.lineTo(x + 3, y + chh - 3); c.stroke(); c.strokeStyle = '#999'; c.lineWidth = 1; } }
  }, { transparent: false });
  cal.position.set(-2.5, 1.55, wallZ); g.add(cal);
  // site notes taped to the wall: tallies
  const tally = canvasPlane(0.3, 0.4, 256, (c, W, Hh) => {
    c.fillStyle = '#ece6c8'; c.fillRect(0, 0, W, Hh); c.strokeStyle = '#222'; c.lineWidth = 3;
    for (let k = 0; k < 9; k++) { const x0 = 20 + (k % 3) * 75, y0 = 30 + Math.floor(k / 3) * 100; for (let j = 0; j < 4; j++) { c.beginPath(); c.moveTo(x0 + j * 12, y0); c.lineTo(x0 + j * 12 + 2, y0 + 55); c.stroke(); } c.beginPath(); c.moveTo(x0 - 6, y0 + 40); c.lineTo(x0 + 48, y0 + 12); c.stroke(); }
    c.fillStyle = '#222'; c.font = 'italic 22px serif'; c.fillText('days since', 30, Hh - 20);
  }, { transparent: false });
  tally.position.set(0.15, 1.5, wallZ); tally.rotation.z = 0.04; g.add(tally);
  P.build(g);
  const recorder = V3(0.25, top + 0.06, deskZ + 0.1);
  g.userData.points = { desk: V3(-0.1, top + 0.05, deskZ + 0.35), recorder, calendar: V3(-2.5, 1.55, wallZ + 0.05), laptop: V3(-0.35, top + 0.15, deskZ - 0.05) };
  g.userData.colliders = [{ minX: -1.0, maxX: 1.0, minZ: deskZ - 0.48, maxZ: deskZ + 0.48 }, { minX: 2.55, maxX: 3.45, minZ: -3.65, maxZ: -1.55 }, { minX: -4.2, maxX: -3.0, minZ: -4.0, maxZ: -3.3 }];
  return finish(g);
}

// ------------------------------------------------------------------ a steel locker you can hide in (front +Z, door hinged on −X)
function lockerHide({ seed } = {}) {
  const r = rng(seedOf(seed));
  const g = group('lockerHide');
  const W = 0.56, D = 0.55, Hh = 1.95, t = 0.012;
  const P = new Parts(), out = lockerMat(), inn = lockerInside();
  P.bb(out, -W / 2, 0.08, -D / 2, W / 2, 0.08 + t, D / 2); // floor
  P.bb('steelDark', -W / 2 + 0.02, 0, -D / 2 + 0.02, W / 2 - 0.02, 0.08, D / 2 - 0.04); // plinth
  P.bb(out, -W / 2, Hh - t, -D / 2, W / 2, Hh, D / 2); // top
  P.bb(out, -W / 2, 0.08, -D / 2, W / 2, Hh, -D / 2 + t); // back
  P.bb(out, -W / 2, 0.08, -D / 2, -W / 2 + t, Hh, D / 2); // sides
  P.bb(out, W / 2 - t, 0.08, -D / 2, W / 2, Hh, D / 2);
  P.bb(inn, -W / 2 + t, 0.09, -D / 2 + t, W / 2 - t, Hh - t, -D / 2 + t + 0.001); // inner skin, darker
  P.bb(inn, -W / 2 + t, 0.09, -D / 2 + t, -W / 2 + t + 0.001, Hh - t, D / 2);
  P.bb(inn, W / 2 - t - 0.001, 0.09, -D / 2 + t, W / 2 - t, Hh - t, D / 2);
  P.bb(inn, -W / 2 + t, 1.78, -D / 2 + t, W / 2 - t, 1.79, D / 2 - 0.05); // hat shelf
  P.tube('galvanized', V3(-0.2, 1.72, -0.05), V3(0.2, 1.72, -0.05), 0.008, 6); // hanging rail
  // a name strip that has been scratched off
  P.build(g);
  // the door (pivot on the hinge side). Louvre slits at eye height so you can see out.
  const pivot = new THREE.Group(); pivot.position.set(-W / 2, 0, D / 2); g.add(pivot);
  const DP = new Parts();
  const dw = W, x0 = 0, x1 = dw, z = 0.0, dt = 0.015;
  const slots = [[0.1, 0.38], [1.38, 1.72]]; // [y0, y1] louvre bands (bottom vent + eye height)
  let y = 0.09;
  const bands = [];
  for (const [a, b] of slots) { bands.push([y, a]); y = b; }
  bands.push([y, Hh - 0.005]);
  for (const [a, b] of bands) if (b - a > 0.005) DP.bb(out, x0, a, z - dt, x1, b, z);
  for (const [a, b] of slots) {
    DP.bb(out, x0, a, z - dt, x0 + 0.08, b, z); DP.bb(out, x1 - 0.08, a, z - dt, x1, b, z);
    for (let sy = a; sy < b - 0.01; sy += 0.045) DP.box(out, (x0 + x1) / 2, sy + 0.02, z - 0.004, x1 - x0 - 0.16, 0.022, 0.012, { rx: -0.6 });
  }
  DP.bb('steelDark', x1 - 0.06, 1.0, z, x1 - 0.035, 1.16, z + 0.03); // handle
  DP.bb('paper', 0.15, 1.82, z + 0.001, 0.41, 1.88, z + 0.002); // name card
  const door = DP.build(group('door'));
  pivot.add(door);
  g.userData.setOpen = (v) => { pivot.rotation.y = -v * 1.6; };
  g.userData.inside = V3(0, 1.5, -0.03);
  g.userData.door = pivot;
  return finish(g, { collider: { w: W + 0.04, d: D + 0.04 } });
}

// ==== KIT EXPORT ====
export const KIT = {
  model, modelBatch, worldUV,
  get materials() { return MAT; },
  studWall, sheeting, column, floorSlab, deck, partBox,
  scaffold, pallet, drywallStack, rebarBundle, sawhorse, barrier, cautionTape, hangingCables, ductRun, pipeRun,
  debris, sprayMark, workLight, breakerPanel, generator, fuelCan, freightLift, siteOffice, lockerHide,
};
