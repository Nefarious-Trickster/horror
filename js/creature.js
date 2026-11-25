import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NOISE_GLSL } from './noise.glsl.js';

// ------------------------------------------------------------------ small helpers
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

class Spring { // critically damped
  constructor(x = 0) { this.x = x; this.v = 0; }
  update(target, freq, dt) {
    const w = freq * Math.PI * 2;
    const f = 1 + 2 * dt * w, oo = w * w, hoo = dt * oo, hhoo = dt * hoo;
    const det = 1 / (f + hhoo);
    const x = det * (f * this.x + dt * this.v + hhoo * target);
    this.v = det * (this.v + hoo * (target - this.x));
    this.x = x; return x;
  }
}
// smooth 1D value noise
function vnoise(t, seed = 0) {
  const i = Math.floor(t), f = t - i;
  const h = (n) => { const s = Math.sin((n + seed * 57.13) * 127.1) * 43758.5453; return s - Math.floor(s); };
  const u = f * f * (3 - 2 * f);
  return (h(i) * (1 - u) + h(i + 1) * u) * 2 - 1;
}

// ------------------------------------------------------------------ skin material
function makeSkinMaterial() {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.6, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.32,
    sheen: 0.12, sheenRoughness: 0.6, sheenColor: new THREE.Color(0.32, 0.2, 0.18),
    specularIntensity: 0.6,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = { value: 0 };
    mat.userData.shader = sh;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 _data0; attribute vec4 _data1;
        varying vec4 vD0; varying vec4 vD1; varying vec3 vBind;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vBind = position; vD0 = _data0; vD1 = _data1;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        varying vec4 vD0; varying vec4 vD1; varying vec3 vBind;
        ${NOISE_GLSL}
        float veinMask(vec3 P) {
          vec3 q = P * 6.5 + vec3(fbm3(P * 3.7)) * 0.7;
          float r = 1.0 - abs(snoise(q));
          float r2 = 1.0 - abs(snoise(q * 2.3 + 3.1));
          float v = smoothstep(0.935, 0.988, r) + 0.7 * smoothstep(0.955, 0.992, r2);
          return v * smoothstep(-0.35, 0.35, snoise(P * 2.2 + 1.0));
        }
        float skinHeight(vec3 P, float fw, float thin) {
          float h = fbm3(P * 13.0) * 0.0012 + fbm3(P * 4.0) * 0.0012; // lumpy, uneven tissue
          float w = ridged(P * vec3(70.0, 150.0, 70.0) + fbm3(P * 9.0));
          h -= w * w * w * 0.00032 * (1.0 - smoothstep(0.0015, 0.006, fw)); // fine creases
          float w2 = ridged(P * vec3(28.0, 60.0, 28.0) + 4.0);
          h -= pow(w2, 6.0) * 0.0005;                                 // deeper folds
          h += veinMask(P) * (0.00035 + thin * 0.00045);               // raised veins
          h += snoise(P * 650.0) * 0.00005 * (1.0 - smoothstep(0.0004, 0.0015, fw)); // pores
          return h;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 P = vBind;
        float ao = vD0.x, thick = vD0.y, curv = vD0.z * 2.0 - 1.0, gum = vD0.w;
        float ext = vD1.x, bruise = vD1.y, bony = vD1.z;
        float fw = length(fwidth(P));
        float mott = fbm3(P * 8.0);
        float big = fbm3(P * 1.7 + 2.0);
        float blotch = smoothstep(0.0, 0.55, fbm3(P * 3.1 + 4.0));
        float vein = veinMask(P);
        // grey, slightly green dead skin, never evenly coloured
        vec3 skin = mix(vec3(0.17, 0.175, 0.165), vec3(0.13, 0.145, 0.13), smoothstep(-0.4, 0.4, big));
        skin = mix(skin, vec3(0.10, 0.11, 0.095), smoothstep(-0.2, 0.6, mott) * 0.6);
        skin = mix(skin, vec3(0.15, 0.085, 0.10), blotch * 0.55);                  // bruising
        skin = mix(skin, vec3(0.30, 0.285, 0.25), clamp(curv * 1.4, 0.0, 1.0) * 0.55 + bony * 0.3); // stretched over bone
        skin = mix(skin, vec3(0.10, 0.06, 0.055), clamp(-curv * 1.6, 0.0, 1.0) * 0.7); // filthy creases
        skin = mix(skin, vec3(0.2, 0.13, 0.13), (1.0 - thick) * 0.2);
        skin = mix(skin, vec3(0.07, 0.08, 0.14), vein * (0.5 + (1.0 - thick) * 0.4));
        // grime from the knees down, as if it has stood in this room for years
        float grime = smoothstep(0.75, 0.1, P.y + big * 0.15);
        skin = mix(skin, vec3(0.07, 0.06, 0.045), grime * 0.8);
        skin = mix(skin, vec3(0.085, 0.06, 0.065), smoothstep(0.3, 1.0, ext) * 0.9);
        skin = mix(skin, vec3(0.03, 0.018, 0.02), smoothstep(0.0, 0.8, bruise));
        // dried blood: drips running down from the mouth, crusted on the hands
        float drip = smoothstep(0.55, 0.85, snoise(vec3(P.x * 160.0, P.y * 9.0, P.z * 160.0)) * 0.5 + 0.5 + fbm3(P * 30.0) * 0.3);
        float blood = max(gum * 0.5, 0.0);
        blood = max(blood, drip * vD1.w);
        blood = max(blood, smoothstep(0.45, 0.9, ext) * smoothstep(0.1, 0.5, fbm3(P * 40.0)));
        skin = mix(skin, vec3(0.13, 0.02, 0.018), clamp(blood, 0.0, 1.0) * 0.85);
        skin = mix(skin, vec3(0.32, 0.055, 0.05), gum * 0.8);
        skin *= mix(0.3, 1.0, ao);
        diffuseColor.rgb = skin;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float wet = smoothstep(0.15, 0.7, fbm3(P * 4.5 + 9.0));
        roughnessFactor = mix(0.64, 0.42, wet * 0.7);
        roughnessFactor = mix(roughnessFactor, 0.2, max(gum, blood * 0.5));
        roughnessFactor = mix(roughnessFactor, 0.5, bony * 0.4);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 dpx = dFdx(P), dpy = dFdy(P);
          float thin = 1.0 - thick;
          float h0 = skinHeight(P, fw, thin);
          vec2 dH = vec2(skinHeight(P + dpx, fw, thin) - h0, skinHeight(P + dpy, fw, thin) - h0);
          normal = bumpNormal(-vViewPosition, normal, dH, faceDirection);
        }`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        material.clearcoat = clamp(0.06 + wet * 0.35 + gum + blood * 0.5, 0.0, 1.0);
        material.clearcoatRoughness = mix(0.4, 0.12, gum);`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= ao;
        reflectedLight.indirectSpecular *= ao;
        reflectedLight.directSpecular *= mix(0.25, 1.0, ao);
        reflectedLight.directDiffuse *= vec3(1.0) + vec3(0.16, 0.03, 0.01) * (1.0 - thick); // thin flesh glows slightly warmer`);
  };
  return mat;
}

// ------------------------------------------------------------------ eyes
function eyeTextures() {
  const W = 512, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  // sclera: jaundiced, darker toward the back
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0.0, '#3a2a1c'); grd.addColorStop(0.3, '#4a2618'); grd.addColorStop(0.7, '#2a120c'); grd.addColorStop(1, '#100605');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  // blood vessels creeping toward the iris
  for (let i = 0; i < 90; i++) {
    let x = Math.random() * W, y = H * rand(0.55, 1.0);
    g.strokeStyle = `rgba(${110 + Math.random() * 60},${8 + Math.random() * 15},${8 + Math.random() * 15},${rand(0.35, 0.85)})`;
    g.lineWidth = rand(0.6, 2.2);
    g.beginPath(); g.moveTo(x, y);
    const end = H * rand(0.14, 0.4);
    while (y > end) { x += rand(-6, 6); y -= rand(3, 9); g.lineTo(x, y); if (Math.random() < 0.08) g.lineWidth *= 0.7; }
    g.stroke();
  }
  // iris: milky, cataract-clouded with pale striations
  // iris: wide, near-black, with a faint sickly yellow ring
  const irisEnd = H * 0.3;
  for (let x = 0; x < W; x++) {
    const v = 0.6 + 0.4 * Math.random();
    const grad = g.createLinearGradient(0, 0, 0, irisEnd);
    grad.addColorStop(0, 'rgba(2,2,2,1)');
    grad.addColorStop(0.35, `rgba(${22 * v | 0},${18 * v | 0},${8 * v | 0},1)`);
    grad.addColorStop(0.8, `rgba(${90 * v | 0},${78 * v | 0},${30 * v | 0},1)`);
    grad.addColorStop(1, 'rgba(20,10,6,1)');
    g.fillStyle = grad; g.fillRect(x, 0, 1, irisEnd);
  }
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;

  const e = document.createElement('canvas'); e.width = 64; e.height = 64;
  const eg = e.getContext('2d');
  const eg2 = eg.createLinearGradient(0, 0, 0, 64);
  eg2.addColorStop(0, '#ffffff'); eg2.addColorStop(0.1, '#c8d070'); eg2.addColorStop(0.28, '#20200a'); eg2.addColorStop(0.34, '#000');
  eg.fillStyle = eg2; eg.fillRect(0, 0, 64, 64);
  const emissiveMap = new THREE.CanvasTexture(e); emissiveMap.colorSpace = THREE.SRGBColorSpace;
  return { map, emissiveMap };
}

// ------------------------------------------------------------------ teeth & claws
function basisFrom(dir) {
  const d = dir.clone().normalize();
  const t = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const a = new THREE.Vector3().crossVectors(d, t).normalize();
  const b = new THREE.Vector3().crossVectors(a, d).normalize();
  return { d, a, b };
}

function toothGeometry(t, origin) {
  const g = new THREE.CylinderGeometry(1, 1, 1, 8, 6, false);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const root = new THREE.Vector3(...t.pos).sub(origin);
  const dir = new THREE.Vector3(...t.dir).normalize();
  // tangent along the arch so incisors are flattened front-to-back
  const out = new THREE.Vector3(root.x, 0, root.z).normalize();
  const { d } = basisFrom(dir);
  const a = new THREE.Vector3().crossVectors(d, out).normalize();
  const b = new THREE.Vector3().crossVectors(a, d).normalize();
  const stain = Math.random() < 0.15 ? rand(0.2, 0.4) : rand(0.6, 1.0), bend = rand(-0.4, 0.4);
  const L = t.len * (t.broken ? 0.65 : 1);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + 0.5; // 0 root .. 1 tip
    let x = pos.getX(i), z = pos.getZ(i);
    const capTip = t.broken ? 1.0 : 1;
    const r = t.w * (y < 0.25 ? 1.0 - (0.25 - y) * 0.8 : 1 - 0.85 * Math.pow((y - 0.25) / 0.75, 1.7) * capTip);
    x *= r; z *= r * 0.62;
    const len = y * (t.broken ? L : t.len) - 0.003;
    v.copy(root).addScaledVector(d, len).addScaledVector(a, x + bend * y * y * t.w).addScaledVector(b, z);
    pos.setXYZ(i, v.x, v.y, v.z);
    // colour: rotten root -> yellowed enamel -> worn, greyish tip
    const c0 = [0.06, 0.025, 0.015], c1 = [0.42 * stain, 0.34 * stain, 0.2 * stain], c2 = [0.55, 0.5, 0.38];
    const k = smooth(0.1, 0.45, y), k2 = smooth(0.6, 1.0, y);
    for (let ch = 0; ch < 3; ch++) col[i * 3 + ch] = c0[ch] * (1 - k) + (c1[ch] * (1 - k2) + c2[ch] * k2) * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function clawGeometry(c, origin) {
  const segs = 10, rad = 8;
  const base = new THREE.Vector3(...c.pos).sub(origin);
  const dir = new THREE.Vector3(...c.dir).normalize();
  const curl = new THREE.Vector3(...c.curl).normalize();
  const p0 = base.clone().addScaledVector(dir, -0.006);
  const p1 = base.clone().addScaledVector(dir, c.len * 0.55);
  const p2 = base.clone().addScaledVector(dir, c.len).addScaledVector(curl, c.len * 0.45);
  const curve = new THREE.QuadraticBezierCurve3(p0, p1, p2);
  const verts = [], cols = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = curve.getPoint(t), tan = curve.getTangent(t).normalize();
    const side = new THREE.Vector3().crossVectors(tan, curl).normalize();
    const up = new THREE.Vector3().crossVectors(side, tan).normalize();
    const r = c.r * Math.pow(1 - t, 0.85) + 0.0003;
    for (let j = 0; j < rad; j++) {
      const th = (j / rad) * Math.PI * 2;
      const q = p.clone().addScaledVector(side, Math.cos(th) * r * 0.75).addScaledVector(up, Math.sin(th) * r * (1.1 - 0.25 * Math.max(0, Math.sin(th))));
      verts.push(q.x, q.y, q.z);
      const k = smooth(0.0, 0.8, t);
      cols.push(0.10 - 0.06 * k, 0.075 - 0.05 * k, 0.05 - 0.035 * k);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < rad; j++) {
    const a = i * rad + j, b = i * rad + ((j + 1) % rad), c2 = a + rad, d = b + rad;
    idx.push(a, c2, b, b, c2, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ embedded glTF -> GLB (in memory)
async function fetchEmbeddedGltfAsGlb(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`model request failed (${res.status})`);
  const total = +res.headers.get('content-length') || 0;
  let text;
  if (res.body && total) {
    const reader = res.body.getReader(); const parts = []; let got = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; onProgress?.(0.9 * got / total); }
    text = new TextDecoder().decode(await new Blob(parts).arrayBuffer());
  } else text = await res.text();
  const json = JSON.parse(text);
  const uri = json.buffers[0].uri;
  const b64 = uri.slice(uri.indexOf(',') + 1);
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  delete json.buffers[0].uri;
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = Math.ceil(jsonBytes.length / 4) * 4, binLen = Math.ceil(bin.length / 4) * 4;
  const out = new Uint8Array(12 + 8 + jsonLen + 8 + binLen);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLen); out.set(jsonBytes, 20);
  const b = 20 + jsonLen;
  dv.setUint32(b, binLen, true); dv.setUint32(b + 4, 0x004e4942, true);
  out.set(bin, b + 8);
  onProgress?.(1);
  return out.buffer;
}

// ------------------------------------------------------------------ creature
export class Creature {
  static async load(url, onProgress) {
    const loader = new GLTFLoader();
    // JSON .gltf with an embedded base64 buffer: decode it here and hand the loader a GLB in memory.
    // Some hosts (strict content-security policies) refuse the loader's own fetch of data: URIs.
    if (/\.json$|\.gltf$/i.test(new URL(url, location.href).pathname)) {
      const glb = await fetchEmbeddedGltfAsGlb(url, onProgress);
      return new Creature(await loader.parseAsync(glb, ''));
    }
    const gltf = await loader.loadAsync(url, (e) => onProgress?.(e.total ? e.loaded / e.total : 0));
    return new Creature(gltf);
  }

  constructor(gltf) {
    this.object = new THREE.Group();
    this.object.name = 'TheTallOne';
    const scene = gltf.scene;
    this.extras = scene.userData;
    this.object.add(scene);
    this.body = scene.getObjectByProperty('isSkinnedMesh', true);
    this.body.frustumCulled = false;
    this.body.castShadow = true; this.body.receiveShadow = true;
    this.skinMaterial = makeSkinMaterial();
    this.body.material = this.skinMaterial;
    this.bone = {};
    for (const b of this.body.skeleton.bones) this.bone[b.name] = b;
    const boneWorld = (name) => new THREE.Vector3(...this.extras.bones[name]);

    // teeth (rigidly attached to skull & jaw)
    const teethMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.18 });
    for (const row of ['upper', 'lower']) {
      const boneName = row === 'upper' ? 'head' : 'jaw';
      const origin = boneWorld(boneName);
      const geos = this.extras.teeth.filter((t) => t.row === row).map((t) => toothGeometry(t, origin));
      const m = new THREE.Mesh(mergeGeometries(geos), teethMat);
      m.castShadow = true;
      this.bone[boneName].add(m);
    }
    // claws
    const clawMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.15 });
    const byBone = {};
    for (const c of this.extras.claws) (byBone[c.bone] ??= []).push(c);
    for (const [bn, list] of Object.entries(byBone)) {
      const origin = boneWorld(bn);
      const m = new THREE.Mesh(mergeGeometries(list.map((c) => clawGeometry(c, origin))), clawMat);
      m.castShadow = true;
      this.bone[bn].add(m);
    }
    // eyes
    const { map, emissiveMap } = eyeTextures();
    this.eyeMat = new THREE.MeshPhysicalMaterial({
      map, emissiveMap, emissive: new THREE.Color(0.85, 0.95, 0.55), emissiveIntensity: 0,
      roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.02, ior: 1.38,
    });
    this.eyes = [];
    for (const e of this.extras.eyes) {
      const geo = new THREE.SphereGeometry(e.r, 32, 24); geo.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(geo, this.eyeMat);
      m.position.copy(new THREE.Vector3(...e.pos).sub(boneWorld(e.bone)));
      this.bone[e.bone].add(m);
      this.eyes.push(m);
    }

    this.state = {
      t: 0, yaw: new Spring(0), pitch: new Spring(0), roll: new Spring(0), jaw: new Spring(0.02),
      tYaw: 0, tPitch: 0, tRoll: 0, tJaw: 0.02, nextLook: 0, lookFreq: 3, nextRoll: 4, nextJaw: 6, rollHoldUntil: 0,
      breath: 0, twitch: [], lean: new Spring(0), reach: new Spring(0), fingerOpen: new Spring(0),
    };
    this.headBind = boneWorld('head').add(new THREE.Vector3(0, 0.06, 0.07));
    this.restPitch = Math.atan2(-this.extras.headForward[1], this.extras.headForward[2]);
    this.tmp = { v: new THREE.Vector3(), v2: new THREE.Vector3(), q: new THREE.Quaternion(), m: new THREE.Matrix4() };
    this.frozen = false;
  }

  kick(bone, axis, amount) { this.state.twitch.push({ bone, axis, amount, t: 0, dur: rand(0.08, 0.22) }); }

  // ctx: { camera, flashlight (SpotLight), flashlightOn }
  update(dt, ctx) {
    if (this.frozen) dt = 0;
    const S = this.state; S.t += dt; const t = S.t;
    const B = this.bone;
    const { v } = this.tmp;

    // where is the viewer, in creature space?
    const camLocal = this.object.worldToLocal(v.copy(ctx.camera.position));
    const rel = camLocal.clone().sub(this.headBind);
    const dist = Math.hypot(camLocal.x, camLocal.z);
    const near = 1 - smooth(1.1, 3.6, dist);   // 0 far .. 1 in its face
    const yawTo = Math.atan2(rel.x, rel.z);
    const pitchTo = -Math.atan2(rel.y, Math.hypot(rel.x, rel.z));

    // gaze: long unnatural holds, then a snap (or a slow, creeping turn)
    if (t > S.nextLook) {
      S.tYaw = clamp(yawTo + rand(-0.04, 0.04), -2.5, 2.5);
      S.tPitch = clamp(pitchTo - this.restPitch, -0.9, 0.8);
      const snap = Math.random() < 0.55 + near * 0.4;
      S.lookFreq = snap ? rand(5, 9) : rand(0.25, 0.6);
      S.nextLook = t + (snap ? rand(0.6, 2.8) : rand(2.5, 4.5)) * (1 - near * 0.8);
      if (snap && Math.random() < 0.5) this.kick('head', 'z', rand(-0.18, 0.18));
    }
    const yaw = S.yaw.update(S.tYaw, S.lookFreq, dt);
    const pitch = S.pitch.update(S.tPitch, S.lookFreq, dt);

    // curious head tilt
    if (t > S.nextRoll) {
      S.tRoll = S.tRoll !== 0 && Math.random() < 0.6 ? 0 : rand(0.35, 0.75) * (Math.random() < 0.5 ? -1 : 1);
      S.nextRoll = t + rand(3, 9) * (1 - near * 0.5);
    }
    const roll = S.roll.update(S.tRoll + near * 0.25 * Math.sign(S.tRoll || 1), S.tRoll === 0 ? 0.6 : rand(0.3, 2.5), dt);

    // jaw: slow, trembling opening; gapes when you get close
    if (t > S.nextJaw) {
      S.tJaw = S.tJaw > 0.1 ? 0.02 : rand(0.15, 0.4);
      S.nextJaw = t + (S.tJaw > 0.1 ? rand(1.5, 4) : rand(5, 12));
    }
    const jawTarget = Math.max(S.tJaw + 0.1, near * 0.55); // it never fully closes its mouth
    const jaw = S.jaw.update(jawTarget, 0.5 + near, dt) + Math.sin(t * 37) * 0.006 * (0.3 + jaw01(S.jaw.x));

    // twitches
    const tw = { head: [0, 0, 0], neck2: [0, 0, 0], fingers: {} };
    if (Math.random() < dt * (0.25 + near * 1.2)) {
      const r = Math.random();
      if (r < 0.4) this.kick('head', ['x', 'y', 'z'][Math.random() * 3 | 0], rand(-0.16, 0.16));
      else if (r < 0.55) this.kick('neck2', 'y', rand(-0.1, 0.1));
      else this.kick(`f${Math.random() < 0.5 ? 'L' : 'R'}${Math.random() * 4 | 0}_${1 + (Math.random() * 3 | 0)}`, 'z', rand(-0.5, 0.5));
    }
    S.twitch = S.twitch.filter((k) => (k.t += dt) < k.dur + 0.5);
    const twitchVal = (bone, axis) => {
      let s = 0;
      for (const k of S.twitch) if (k.bone === bone && k.axis === axis) s += k.amount * (k.t < k.dur ? Math.sin((k.t / k.dur) * Math.PI * 0.5) : Math.exp(-(k.t - k.dur) * 9));
      return s;
    };

    // breathing: slow, ragged, faster when you are close
    S.breath += dt * (0.2 + near * 0.35) * (1 + 0.35 * vnoise(t * 0.3, 3)) * Math.PI * 2;
    const br = Math.pow(Math.sin(S.breath) * 0.5 + 0.5, 1.6);
    const lean = S.lean.update(near, 0.25, dt);
    const reach = S.reach.update(smooth(0.35, 0.9, near), 0.35, dt);
    const open = S.fingerOpen.update(smooth(0.2, 0.8, near), 0.6, dt);

    const set = (name, x, y, z, order = 'XYZ') => { const b = B[name]; if (b) { b.rotation.order = order; b.rotation.set(x, y, z); } };

    // torso (resting pose is deliberately lopsided: hip cocked, one shoulder dropped)
    set('hips', 0, vnoise(t * 0.2, 1) * 0.02, 0.035 + vnoise(t * 0.17, 2) * 0.012);
    set('thighL', -0.05, 0, -0.03); set('thighR', 0.06, 0.05, -0.05);
    set('shinL', 0.08, 0, 0); set('shinR', 0.0, 0, 0.02);
    set('footL', -0.03, 0, 0.03); set('footR', -0.06, -0.05, 0.02);
    set('spine', 0.03 * lean + br * 0.01, 0, 0);
    set('chest', 0.05 * lean - br * 0.02, yaw * 0.06, 0);
    B.ribcage.scale.set(1 + br * 0.035, 1 + br * 0.015, 1 + br * 0.05);
    set('upperChest', 0.08 * lean - br * 0.012, yaw * 0.08, roll * 0.05);
    // neck & head carry most of the turn: it can rotate much further than a person can
    set('neck', pitch * 0.2 + 0.05 * lean, yaw * 0.18, roll * 0.15, 'YXZ');
    set('neck2', pitch * 0.3 + twitchVal('neck2', 'x'), yaw * 0.3 + twitchVal('neck2', 'y'), roll * 0.25, 'YXZ');
    set('head', pitch * 0.5 - 0.08 * lean + twitchVal('head', 'x'), yaw * 0.38 + twitchVal('head', 'y'), roll * 0.6 + twitchVal('head', 'z'), 'YXZ');
    set('jaw', jaw, 0, Math.sin(t * 1.3) * 0.015 * jaw);

    // arms: hang heavy, sway, lift toward you when close
    for (const [L, s] of [['L', 1], ['R', -1]]) {
      const sw = vnoise(t * 0.35, s * 5) * 0.03;
      set('clavicle' + L, 0, 0, s * (0.02 * br + 0.05 * reach) + (s < 0 ? 0.06 : 0));
      set('upperArm' + L, -0.32 * reach + sw, 0, s * (0.02 + 0.06 * reach));
      set('forearm' + L, -0.38 * reach + sw * 0.5, 0, 0);
      set('hand' + L, 0.1 * reach, 0, -s * 0.1 * reach);
      for (let i = 0; i < 4; i++) for (let j = 1; j <= 3; j++) {
        const n = `f${L}${i}_${j}`;
        const curl = (vnoise(t * 0.4 + i * 1.7 + j, s * 9 + i) * 0.08) - open * 0.35 * (j === 1 ? 0.6 : 1);
        set(n, 0, 0, -s * (curl + twitchVal(n, 'z')));
      }
      set(`thumb${L}_2`, 0, 0, -s * (vnoise(t * 0.3, s * 13) * 0.08 - open * 0.25));
    }

    this.object.updateMatrixWorld(true);
    for (const e of this.eyes) e.lookAt(ctx.camera.position);

    // eyeshine: a reflective tapetum that only shows when your light is on it
    let shine = 0;
    if (ctx.flashlight && ctx.flashlightOn) {
      const L = ctx.flashlight;
      const eyeW = this.eyes[0].getWorldPosition(this.tmp.v2);
      const toEye = eyeW.clone().sub(L.getWorldPosition(new THREE.Vector3())).normalize();
      const axis = L.target.getWorldPosition(new THREE.Vector3()).sub(L.getWorldPosition(new THREE.Vector3())).normalize();
      const c = toEye.dot(axis);
      shine = smooth(Math.cos(L.angle), Math.cos(L.angle * 0.35), c) * ctx.flashlightIntensity;
    }
    this.eyeMat.emissiveIntensity = shine * 2.2;
    if (this.skinMaterial.userData.shader) this.skinMaterial.userData.shader.uniforms.uTime.value = t;
    return { near, dist };
  }
}
function jaw01(x) { return clamp(x / 0.5, 0, 1); }
