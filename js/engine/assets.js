import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

// Paths are relative to the page, so the same code works locally and when published.
const base = new URL('../../assets/', import.meta.url);
const texLoader = new THREE.TextureLoader();
const cache = new Map();
let maxAniso = 8;
export function setAnisotropy(n) { maxAniso = n; }

function tex(path, srgb) {
  const key = path + (srgb ? ':s' : '');
  if (cache.has(key)) return cache.get(key);
  const t = texLoader.load(new URL(path, base).href);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

// PBR texture set from assets/textures/<name>/ (color, normal, roughness, ao?, metalness?).
// Returns fresh texture clones with their own repeat so materials can tile differently.
export function pbr(name, { repeat = [1, 1], maps = ['color', 'normal', 'roughness'] } = {}) {
  const out = {};
  for (const m of maps) {
    const t = tex(`textures/${name}/${m}.jpg`, m === 'color').clone();
    t.repeat.set(...repeat);
    out[m] = t;
  }
  const res = { map: out.color, normalMap: out.normal, roughnessMap: out.roughness, aoMap: out.ao, metalnessMap: out.metalness };
  for (const k of Object.keys(res)) if (!res[k]) delete res[k];
  return res;
}

// Some hosts only serve web media types; a page can then ship the HDR as base64 JSON
// ({ "data": "<base64>" }, next to the .hdr with a .json suffix) and say so with
// <meta name="asset-mode" content="json">.
export async function loadEnvironment(renderer, file = 'hdri/childrens_hospital_1k.hdr') {
  const loader = new RGBELoader();
  let hdr;
  if (document.querySelector('meta[name="asset-mode"]')?.content === 'json') {
    const res = await fetch(new URL(file + '.json', base).href);
    const { data } = await res.json();
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const parsed = loader.parse(bytes.buffer);
    hdr = new THREE.DataTexture(parsed.data, parsed.width, parsed.height, THREE.RGBAFormat, parsed.type);
    hdr.colorSpace = THREE.LinearSRGBColorSpace; hdr.minFilter = hdr.magFilter = THREE.LinearFilter; hdr.generateMipmaps = false; hdr.flipY = true;
    hdr.mapping = THREE.EquirectangularReflectionMapping; hdr.needsUpdate = true;
  } else hdr = await loader.loadAsync(new URL(file, base).href);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(hdr).texture;
  hdr.dispose(); pmrem.dispose();
  return env;
}
