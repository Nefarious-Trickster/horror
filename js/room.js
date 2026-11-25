import * as THREE from 'three';
import { NOISE_GLSL } from './noise.glsl.js';

export const ROOM = { min: new THREE.Vector3(-4, 0, -6), max: new THREE.Vector3(4, 3.1, 5) };
export const CREATURE_SPOT = { x: 1.9, z: -3.9 };

// ------------------------------------------------------------------ procedural surfaces
const SURF_GLSL = /* glsl */ `
struct Surf { vec3 alb; float rough; float metal; float h; };
uniform vec3 uTint; uniform vec2 uStain; uniform vec3 uRoomMin; uniform vec3 uRoomMax; uniform vec4 uScratch;
varying vec3 vWPos; varying vec3 vWNormal; varying vec2 vUv2;

float wallEdgeDist(vec3 p) { return min(min(p.x - uRoomMin.x, uRoomMax.x - p.x), min(p.z - uRoomMin.z, uRoomMax.z - p.z)); }

Surf floorSurf(vec3 p) {
  Surf s; vec2 q = p.xz;
  float n1 = fbm5(vec3(q * 0.6, 1.0));
  float n2 = fbm3(vec3(q * 5.0, 2.0));
  vec3 c = vec3(0.27, 0.26, 0.24) * (0.75 + 0.4 * n1);
  c = mix(c, vec3(0.13, 0.12, 0.10), smoothstep(0.05, 0.6, fbm3(vec3(q * 1.3, 5.0))) * 0.65);
  float speck = hash12(floor(q * 350.0)); c *= 0.9 + 0.2 * speck;
  float cr = ridged(vec3(q * 0.9, 7.0) + fbm3(vec3(q * 3.0, 1.0)) * 0.35);
  float crack = smoothstep(0.972, 0.996, cr);
  c = mix(c, vec3(0.03), crack * 0.85);
  float edge = 1.0 - smoothstep(0.0, 0.7, wallEdgeDist(p) + n2 * 0.2);
  c = mix(c, vec3(0.08, 0.07, 0.05), edge * 0.75);
  float pud = smoothstep(0.16, 0.24, fbm5(vec3(q * 0.33, 9.0)));
  // the old, dark stain where it stands, and a drag mark leading away
  vec2 d = q - uStain;
  float pool = 1.0 - smoothstep(0.25, 0.95, length(d * vec2(1.0, 1.25)) + fbm3(vec3(q * 2.5, 3.0)) * 0.45);
  vec2 dir = normalize(vec2(-0.55, 1.0));
  float along = dot(d, dir), across = dot(d, vec2(-dir.y, dir.x));
  float drag = smoothstep(0.0, 0.4, along) * (1.0 - smoothstep(2.4, 3.6, along)) * (1.0 - smoothstep(0.12, 0.3, abs(across + 0.08 * sin(along * 2.0)) + fbm3(vec3(q * 6.0, 4.0)) * 0.12));
  drag *= 0.55 + 0.45 * smoothstep(-0.2, 0.4, snoise(vec3(along * 9.0, across * 40.0, 1.0)));
  float blood = clamp(max(pool, drag * 0.85), 0.0, 1.0);
  c = mix(c, vec3(0.045, 0.009, 0.007), blood * 0.92);
  c *= mix(1.0, 0.5, pud);
  s.alb = c;
  s.rough = mix(0.88, 0.05, pud);
  s.rough = mix(s.rough, 0.28, blood * 0.75);
  s.rough = mix(s.rough, 1.0, edge * 0.3);
  s.metal = 0.0;
  s.h = (n2 * 0.0015 - crack * 0.0025 + speck * 0.0002) * (1.0 - pud);
  return s;
}

Surf wallSurf(vec3 p, vec3 n) {
  Surf s;
  vec2 uv = abs(n.x) > 0.5 ? vec2(p.z, p.y) : vec2(p.x, p.y);
  float wallId = n.x > 0.5 ? 1.0 : n.x < -0.5 ? 2.0 : n.z > 0.5 ? 3.0 : 4.0;
  float grimeN = fbm3(vec3(uv * 2.0, 3.0 + wallId));
  float streak = fbm3(vec3(uv.x * 7.0, uv.y * 0.45, 1.0 + wallId));
  const float tileTop = 1.42;
  if (uv.y < tileTop) {
    float row = floor(uv.y / 0.1);
    float u = uv.x + mod(row, 2.0) * 0.1;
    vec2 cell = vec2(floor(u / 0.2), row);
    vec2 f = vec2(fract(u / 0.2), fract(uv.y / 0.1));
    vec2 e = min(f, 1.0 - f) * vec2(0.2, 0.1);
    float edgeD = min(e.x, e.y);
    float grout = 1.0 - smoothstep(0.0015, 0.0032, edgeD);
    float rnd = hash12(cell + wallId * 31.7);
    float missing = step(rnd, 0.055) * step(0.15, uv.y);
    vec3 tile = vec3(0.50, 0.55, 0.47) * (0.85 + 0.22 * hash12(cell + 3.1 + wallId));
    float crk = step(0.86, rnd) * smoothstep(0.975, 0.996, ridged(vec3(uv * 8.0, rnd * 10.0)));
    tile = mix(tile, vec3(0.06), crk);
    vec3 under = vec3(0.22, 0.21, 0.19) * (0.8 + 0.35 * fbm3(vec3(uv * 30.0, 1.0)));
    vec3 c = mix(tile, vec3(0.10, 0.09, 0.075), grout);
    c = mix(c, under, missing);
    float damp = 1.0 - smoothstep(0.0, 0.85, uv.y + grimeN * 0.35);
    c = mix(c, vec3(0.11, 0.10, 0.065), damp * 0.8);
    float st = smoothstep(0.05, 0.5, streak);
    c = mix(c, vec3(0.19, 0.15, 0.09), st * 0.5);
    s.alb = c;
    s.rough = mix(0.16, 0.92, max(grout, missing));
    s.rough = mix(s.rough, 0.85, clamp(damp * 0.8 + st * 0.35, 0.0, 1.0));
    s.h = smoothstep(0.0, 0.006, edgeD) * 0.002 - missing * 0.007 - crk * 0.001;
    float trim = smoothstep(tileTop - 0.065, tileTop - 0.06, uv.y);
    float tt = clamp((uv.y - (tileTop - 0.065)) / 0.065, 0.0, 1.0);
    s.alb = mix(s.alb, vec3(0.07, 0.13, 0.10) * (0.75 + 0.35 * grimeN), trim);
    s.rough = mix(s.rough, 0.28 + st * 0.4, trim);
    s.h += trim * 0.006 * sin(tt * 3.1416);
  } else {
    vec3 paint = vec3(0.27, 0.33, 0.27) * (0.85 + 0.3 * grimeN);
    vec3 plaster = vec3(0.40, 0.37, 0.31) * (0.8 + 0.3 * fbm3(vec3(uv * 20.0, 5.0)));
    float peelN = fbm5(vec3(uv * 1.5, 4.0 + wallId)) + 0.25 * fbm3(vec3(uv * 8.0, 2.0));
    float peel = smoothstep(0.2, 0.225, peelN);
    float peelEdge = smoothstep(0.16, 0.2, peelN) * (1.0 - peel);
    vec3 c = mix(paint, plaster, peel);
    c *= 1.0 - peelEdge * 0.45;
    float wdN = streak + (uv.y - 2.1) * 0.7;
    c = mix(c, vec3(0.18, 0.13, 0.07), smoothstep(0.0, 0.6, wdN) * 0.6);
    c = mix(c, vec3(0.09, 0.06, 0.03), smoothstep(0.03, 0.0, abs(wdN - 0.32)) * 0.55);
    float mold = smoothstep(0.25, 0.65, fbm5(vec3(uv * 5.0, 8.0 + wallId))) * smoothstep(2.0, 3.0, uv.y + grimeN * 0.5);
    c = mix(c, vec3(0.025, 0.03, 0.02), mold * 0.9);
    s.alb = c;
    s.rough = mix(0.7, 0.95, peel);
    s.h = peelEdge * 0.0012 - peel * 0.0009 + fbm3(vec3(uv * 25.0, 1.0)) * 0.0003;
  }
  // claw marks gouged through tile and plaster
  if (abs(wallId - uScratch.w) < 0.5) {
    vec2 sp = uv - uScratch.xy;
    float ang = -0.35;
    vec2 r = vec2(cos(ang) * sp.x - sin(ang) * sp.y, sin(ang) * sp.x + cos(ang) * sp.y);
    float g = 0.0;
    for (int k = 0; k < 4; k++) {
      float fk = float(k);
      float x = r.x - fk * 0.038 - sin(r.y * 3.0 + fk) * 0.01;
      float len = 0.55 + 0.12 * sin(fk * 2.3);
      float y = clamp(r.y / len, 0.0, 1.0);
      float w = 0.0045 * sin(y * 3.1416) + 0.0008;
      g = max(g, smoothstep(w, w * 0.3, abs(x)) * step(0.0, r.y) * step(r.y, len));
    }
    // a second, older set lower down
    vec2 sp2 = uv - uScratch.xy - vec2(0.25, -0.55);
    for (int k = 0; k < 4; k++) {
      float fk = float(k);
      float x = sp2.x - fk * 0.034 + sp2.y * 0.15;
      float y = clamp(sp2.y / 0.4, 0.0, 1.0);
      float w = 0.0035 * sin(y * 3.1416) + 0.0006;
      g = max(g, 0.7 * smoothstep(w, w * 0.3, abs(x)) * step(0.0, sp2.y) * step(sp2.y, 0.4));
    }
    s.alb = mix(s.alb, vec3(0.05, 0.035, 0.03), g);
    s.rough = mix(s.rough, 0.95, g);
    s.h -= g * 0.004;
    // smeared hand-height grime
    float smear = (1.0 - smoothstep(0.1, 0.45, length((uv - uScratch.xy - vec2(0.1, -0.2)) * vec2(1.0, 0.6)) + fbm3(vec3(uv * 9.0, 2.0)) * 0.2));
    s.alb = mix(s.alb, vec3(0.05, 0.012, 0.01), smear * 0.75);
    s.rough = mix(s.rough, 0.4, smear * 0.6);
  }
  s.metal = 0.0;
  return s;
}

Surf ceilSurf(vec3 p) {
  Surf s; vec2 q = p.xz;
  float n = fbm5(vec3(q * 0.7, 2.0));
  vec3 c = vec3(0.26, 0.25, 0.23) * (0.8 + 0.3 * n);
  float board = fract(q.x / 0.16);
  float seam = smoothstep(0.03, 0.0, min(board, 1.0 - board));
  float ring = fbm3(vec3(q * 0.8, 6.0));
  c = mix(c, vec3(0.17, 0.13, 0.08), smoothstep(0.1, 0.4, ring) * 0.6);
  c = mix(c, vec3(0.09, 0.07, 0.04), smoothstep(0.02, 0.0, abs(ring - 0.25)) * 0.6);
  float mold = smoothstep(0.3, 0.7, fbm5(vec3(q * 4.0, 1.0))) * (1.0 - smoothstep(0.0, 1.2, wallEdgeDist(p)));
  c = mix(c, vec3(0.02, 0.025, 0.018), mold);
  s.alb = c * (1.0 - seam * 0.3); s.rough = 0.92; s.metal = 0.0;
  s.h = -seam * 0.002 + fbm3(vec3(q * 12.0, 1.0)) * 0.0006;
  return s;
}

Surf metalSurf(vec3 p) {
  Surf s;
  float n = fbm5(p * 2.5); float n2 = fbm3(p * 28.0);
  float drip = fbm3(vec3(p.x * 14.0, p.y * 1.2, p.z * 14.0));
  float rust = smoothstep(-0.08, 0.22, n + n2 * 0.25 + drip * 0.25);
  float chip = smoothstep(0.5, 0.56, fbm3(p * 11.0 + 3.0)) * (1.0 - rust);
  vec3 paint = uTint * (0.8 + 0.3 * n2);
  vec3 rustC = mix(vec3(0.14, 0.05, 0.02), vec3(0.30, 0.12, 0.045), n2 * 0.5 + 0.5);
  vec3 c = mix(paint, rustC, rust);
  c = mix(c, vec3(0.30, 0.29, 0.28), chip);
  s.alb = c;
  s.metal = chip * 0.85;
  s.rough = mix(mix(0.42, 0.93, rust), 0.32, chip);
  s.h = rust * (n2 * 0.0007 + 0.0005) - chip * 0.0002;
  return s;
}

Surf fabricSurf(vec3 p) {
  Surf s;
  float n = fbm3(p * 6.0);
  vec3 c = vec3(0.36, 0.33, 0.26) * (0.85 + 0.25 * n);
  float st = fbm5(p * 2.2 + 3.0);
  c = mix(c, vec3(0.22, 0.16, 0.07), smoothstep(0.0, 0.35, st) * 0.7);
  c = mix(c, vec3(0.13, 0.08, 0.03), smoothstep(0.02, 0.0, abs(st - 0.2)) * 0.7);
  float bl = smoothstep(0.35, 0.6, fbm3(p * 3.0 + 9.0));
  c = mix(c, vec3(0.07, 0.015, 0.012), bl * 0.85);
  vec2 qp = fract(p.xz / 0.18) - 0.5;
  float quilt = smoothstep(0.02, 0.0, length(qp)) ;
  s.alb = c * (1.0 - quilt * 0.4); s.rough = 0.96; s.metal = 0.0;
  s.h = -quilt * 0.004 + snoise(p * 300.0) * 0.00015;
  return s;
}

Surf woodSurf(vec3 p) {
  Surf s;
  float g = snoise(vec3(p.x * 2.0, p.y * 2.0, p.z * 60.0) + fbm3(p * 4.0)) * 0.5 + 0.5;
  vec3 c = mix(vec3(0.10, 0.06, 0.035), vec3(0.22, 0.14, 0.08), g);
  c *= 0.7 + 0.4 * fbm3(p * 9.0);
  s.alb = c; s.rough = 0.78; s.metal = 0.0; s.h = g * 0.0006;
  return s;
}

Surf paperSurf(vec3 p) {
  Surf s;
  vec2 uv = vUv2;
  vec3 c = vec3(0.55, 0.50, 0.38) * (0.8 + 0.25 * fbm3(p * 20.0));
  float line = step(0.12, uv.x) * step(uv.x, 0.88) * step(0.1, uv.y) * step(uv.y, 0.86);
  float rowf = fract(uv.y * 26.0);
  float txt = line * smoothstep(0.25, 0.3, rowf) * smoothstep(0.55, 0.5, rowf) * step(0.35, hash12(floor(vec2(uv.x * 40.0, uv.y * 26.0))));
  c = mix(c, vec3(0.08, 0.07, 0.06), txt * 0.7);
  c = mix(c, vec3(0.2, 0.13, 0.05), smoothstep(0.1, 0.5, fbm3(p * 8.0 + 2.0)) * 0.6);
  s.alb = c; s.rough = 0.9; s.metal = 0.0; s.h = fbm3(p * 30.0) * 0.0004;
  return s;
}

Surf surfAt(vec3 p) {
#if SURF_TYPE == 0
  return floorSurf(p);
#elif SURF_TYPE == 1
  return wallSurf(p, normalize(vWNormal));
#elif SURF_TYPE == 2
  return ceilSurf(p);
#elif SURF_TYPE == 3
  return metalSurf(p);
#elif SURF_TYPE == 4
  return fabricSurf(p);
#elif SURF_TYPE == 5
  return woodSurf(p);
#else
  return paperSurf(p);
#endif
}
`;

const TYPES = { floor: 0, wall: 1, ceiling: 2, metal: 3, fabric: 4, wood: 5, paper: 6 };
const sharedUniforms = {
  uStain: { value: new THREE.Vector2(CREATURE_SPOT.x - 0.1, CREATURE_SPOT.z + 0.25) },
  uRoomMin: { value: ROOM.min }, uRoomMax: { value: ROOM.max },
  uScratch: { value: new THREE.Vector4(-3.15, 1.75, 0, 2) }, // on the right wall (x=+4, normal -x => id 2), u = z
};

export function surfaceMaterial(type, { tint = [0.2, 0.25, 0.22], side } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, side: side ?? THREE.FrontSide });
  const id = TYPES[type];
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, sharedUniforms, { uTint: { value: new THREE.Vector3(...tint) } });
    sh.defines = { ...(sh.defines || {}), SURF_TYPE: id };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNormal; varying vec2 vUv2;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNormal = normalize(mat3(modelMatrix) * objectNormal);
        vUv2 = uv;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        ${NOISE_GLSL}
        ${SURF_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        Surf S = surfAt(vWPos);
        diffuseColor.rgb = S.alb;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = S.rough;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = S.metal;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 dpx = dFdx(vWPos), dpy = dFdy(vWPos);
          vec2 dH = vec2(surfAt(vWPos + dpx).h - S.h, surfAt(vWPos + dpy).h - S.h);
          normal = bumpNormal(-vViewPosition, normal, dH, faceDirection);
        }`);
  };
  mat.customProgramCacheKey = () => 'surf' + id + tint.join(',');
  return mat;
}

// ------------------------------------------------------------------ helpers
function mesh(geo, mat, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = receive; return m;
}
function tube(a, b, r, mat, seg = 12) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const m = mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}

// ------------------------------------------------------------------ build
export function buildRoom(scene) {
  const { min, max } = ROOM;
  const W = max.x - min.x, D = max.z - min.z, Hh = max.y;
  const colliders = []; // {minX,maxX,minZ,maxZ}
  const group = new THREE.Group(); group.name = 'Room'; scene.add(group);

  const floor = mesh(new THREE.PlaneGeometry(W, D), surfaceMaterial('floor'), { cast: false });
  floor.rotation.x = -Math.PI / 2; floor.position.set((min.x + max.x) / 2, 0, (min.z + max.z) / 2);
  group.add(floor);
  const ceil = mesh(new THREE.PlaneGeometry(W, D), surfaceMaterial('ceiling'), { cast: false });
  ceil.rotation.x = Math.PI / 2; ceil.position.set((min.x + max.x) / 2, Hh, (min.z + max.z) / 2);
  group.add(ceil);

  const wallMat = surfaceMaterial('wall');
  // back (z=min) and front (z=max) walls
  // back wall, with a doorway cut through it
  const DOOR = { x: -1.2, w: 0.96, h: 2.1 };
  {
    const sh = new THREE.Shape();
    sh.moveTo(-W / 2, -Hh / 2); sh.lineTo(W / 2, -Hh / 2); sh.lineTo(W / 2, Hh / 2); sh.lineTo(-W / 2, Hh / 2); sh.closePath();
    const hl = new THREE.Path();
    hl.moveTo(DOOR.x - DOOR.w / 2, -Hh / 2); hl.lineTo(DOOR.x + DOOR.w / 2, -Hh / 2); hl.lineTo(DOOR.x + DOOR.w / 2, -Hh / 2 + DOOR.h); hl.lineTo(DOOR.x - DOOR.w / 2, -Hh / 2 + DOOR.h); hl.closePath();
    sh.holes.push(hl);
    const back = mesh(new THREE.ShapeGeometry(sh), wallMat); back.position.set(0, Hh / 2, min.z); group.add(back);
  }
  const front = mesh(new THREE.PlaneGeometry(W, Hh), wallMat); front.rotation.y = Math.PI; front.position.set(0, Hh / 2, max.z); group.add(front);
  // right wall (x=max)
  const right = mesh(new THREE.PlaneGeometry(D, Hh), wallMat); right.rotation.y = -Math.PI / 2; right.position.set(max.x, Hh / 2, (min.z + max.z) / 2); group.add(right);
  // left wall (x=min) with a barred window cut into it
  const win = { z: -1.4, y: 2.42, w: 1.0, h: 0.5 };
  const shape = new THREE.Shape();
  shape.moveTo(-D / 2, -Hh / 2); shape.lineTo(D / 2, -Hh / 2); shape.lineTo(D / 2, Hh / 2); shape.lineTo(-D / 2, Hh / 2); shape.closePath();
  const hole = new THREE.Path();
  const cz = -(win.z - (min.z + max.z) / 2); // local x of the hole (wall is rotated +90deg)
  hole.moveTo(cz - win.w / 2, win.y - Hh / 2 - win.h / 2); hole.lineTo(cz + win.w / 2, win.y - Hh / 2 - win.h / 2);
  hole.lineTo(cz + win.w / 2, win.y - Hh / 2 + win.h / 2); hole.lineTo(cz - win.w / 2, win.y - Hh / 2 + win.h / 2); hole.closePath();
  shape.holes.push(hole);
  const leftGeo = new THREE.ShapeGeometry(shape);
  const left = mesh(leftGeo, wallMat); left.rotation.y = Math.PI / 2; left.position.set(min.x, Hh / 2, (min.z + max.z) / 2); group.add(left);
  // window reveal, bars, grime glass, and the cold night outside
  const metal = surfaceMaterial('metal', { tint: [0.12, 0.14, 0.13] });
  const revealMat = surfaceMaterial('ceiling');
  const rv = (w, h, d, x, y, z) => { const m = mesh(new THREE.BoxGeometry(w, h, d), revealMat); m.position.set(x, y, z); group.add(m); };
  rv(0.3, 0.04, win.w + 0.08, min.x - 0.15, win.y - win.h / 2 - 0.02, win.z);
  rv(0.3, 0.04, win.w + 0.08, min.x - 0.15, win.y + win.h / 2 + 0.02, win.z);
  rv(0.3, win.h, 0.04, min.x - 0.15, win.y, win.z - win.w / 2 - 0.02);
  rv(0.3, win.h, 0.04, min.x - 0.15, win.y, win.z + win.w / 2 + 0.02);
  for (let i = 0; i < 7; i++) {
    const z = win.z - win.w / 2 + (i + 0.5) * (win.w / 7);
    group.add(tube([min.x - 0.05, win.y - win.h / 2, z], [min.x - 0.05, win.y + win.h / 2, z], 0.012, metal, 8));
  }
  group.add(tube([min.x - 0.05, win.y, win.z - win.w / 2], [min.x - 0.05, win.y, win.z + win.w / 2], 0.01, metal, 8));
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(win.w * 3, win.h * 3), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.045, 0.06, 0.085) }));
  outside.rotation.y = Math.PI / 2; outside.position.set(min.x - 0.6, win.y, win.z); group.add(outside);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(win.w, win.h), new THREE.MeshStandardMaterial({ color: 0x334033, roughness: 0.25, transparent: true, opacity: 0.35, depthWrite: false }));
  glass.rotation.y = Math.PI / 2; glass.position.set(min.x - 0.25, win.y, win.z); group.add(glass);

  const moon = new THREE.SpotLight(new THREE.Color(0.55, 0.66, 0.9), 70, 0, 0.28, 0.5, 2);
  moon.position.set(min.x - 3.0, win.y + 1.4, win.z + 0.6);
  moon.target.position.set(-1.0, 0, win.z - 0.6);
  moon.castShadow = true; moon.shadow.mapSize.set(1024, 1024); moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.02;
  moon.shadow.camera.near = 1; moon.shadow.camera.far = 12;
  group.add(moon, moon.target);

  // pipes along the ceiling, dropping down the corner
  const pipeMat = surfaceMaterial('metal', { tint: [0.16, 0.17, 0.15] });
  const px = min.x + 0.35;
  group.add(tube([px, 2.86, min.z], [px, 2.86, max.z], 0.075, pipeMat, 16));
  group.add(tube([px + 0.22, 2.94, min.z], [px + 0.22, 2.94, max.z], 0.045, pipeMat, 12));
  group.add(tube([max.x - 0.25, 2.9, min.z], [max.x - 0.25, 2.9, max.z], 0.05, pipeMat, 12));
  group.add(tube([px, 0.0, min.z + 0.3], [px, 2.86, min.z + 0.3], 0.075, pipeMat, 16));
  const elbow = mesh(new THREE.TorusGeometry(0.15, 0.075, 12, 16, Math.PI / 2), pipeMat);
  elbow.position.set(px, 2.71, min.z + 0.45); elbow.rotation.set(0, Math.PI / 2, Math.PI); group.add(elbow);
  for (let z = min.z + 1; z < max.z; z += 1.6) {
    const b = mesh(new THREE.BoxGeometry(0.06, 0.24, 0.05), pipeMat); b.position.set(px, Hh - 0.12, z); group.add(b);
  }
  // valve wheel
  const valve = mesh(new THREE.TorusGeometry(0.11, 0.012, 8, 24), surfaceMaterial('metal', { tint: [0.32, 0.06, 0.04] }));
  valve.position.set(px + 0.1, 1.3, min.z + 0.3); valve.rotation.y = Math.PI / 2; group.add(valve);
  group.add(tube([px, 1.3, min.z + 0.3], [px + 0.1, 1.3, min.z + 0.3], 0.015, pipeMat, 8));

  // steel door on the front wall, behind where you start
  const doorMat = surfaceMaterial('metal', { tint: [0.2, 0.24, 0.24] });
  const dx = -1.6;
  const frame = (w, h, x, y) => { const m = mesh(new THREE.BoxGeometry(w, h, 0.14), doorMat); m.position.set(x, y, max.z - 0.03); group.add(m); };
  frame(0.08, 2.15, dx - 0.53, 1.075); frame(0.08, 2.15, dx + 0.53, 1.075); frame(1.14, 0.08, dx, 2.15 + 0.04);
  const slab = mesh(new THREE.BoxGeometry(0.98, 2.13, 0.05), doorMat); slab.position.set(dx, 1.065, max.z - 0.04); group.add(slab);
  const handle = mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.14, 8), pipeMat); handle.rotation.z = Math.PI / 2; handle.position.set(dx + 0.36, 1.05, max.z - 0.1); group.add(handle);
  const port = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.3), new THREE.MeshStandardMaterial({ color: 0x050605, roughness: 0.1 }));
  port.rotation.y = Math.PI; port.position.set(dx, 1.62, max.z - 0.066); group.add(port);
  colliders.push({ minX: dx - 0.6, maxX: dx + 0.6, minZ: max.z - 0.2, maxZ: max.z });

  // hospital bed frame with a ruined mattress
  const bedMat = surfaceMaterial('metal', { tint: [0.33, 0.34, 0.31] });
  const bx = -2.75, bz = -2.3, bw = 0.9, bl = 1.95, bh = 0.55;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) group.add(tube([bx + sx * bw / 2, 0, bz + sz * bl / 2], [bx + sx * bw / 2, sz < 0 ? 1.05 : 0.8, bz + sz * bl / 2], 0.022, bedMat, 10));
  for (const sx of [-1, 1]) group.add(tube([bx + sx * bw / 2, bh, bz - bl / 2], [bx + sx * bw / 2, bh, bz + bl / 2], 0.02, bedMat, 10));
  for (const sz of [-1, 1]) for (const y of sz < 0 ? [bh, 0.8, 1.02] : [bh, 0.78]) group.add(tube([bx - bw / 2, y, bz + sz * bl / 2], [bx + bw / 2, y, bz + sz * bl / 2], 0.016, bedMat, 8));
  for (let i = 1; i < 6; i++) { const x = bx - bw / 2 + (i * bw) / 6; group.add(tube([x, bh, bz - bl / 2], [x, bh, bz + bl / 2], 0.006, bedMat, 6)); }
  for (let i = 1; i < 10; i++) { const z = bz - bl / 2 + (i * bl) / 10; group.add(tube([bx - bw / 2, bh, z], [bx + bw / 2, bh, z], 0.005, bedMat, 6)); }
  const matt = mesh(new THREE.BoxGeometry(0.84, 0.13, 1.85, 8, 2, 16), surfaceMaterial('fabric'));
  { // sag and slide it half off the frame
    const p = matt.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, p.getY(i) - 0.05 * Math.cos(z * 1.6) * Math.cos(x * 3.2) + 0.03 * Math.sin(z * 7 + x * 4)); }
    matt.geometry.computeVertexNormals();
  }
  matt.position.set(bx + 0.18, bh + 0.08, bz + 0.1); matt.rotation.set(0.02, 0.12, -0.09); group.add(matt);
  const strapMat = surfaceMaterial('wood');
  for (const z of [-0.4, 0.45]) { const s = mesh(new THREE.BoxGeometry(0.05, 0.42, 0.012), strapMat); s.position.set(bx - bw / 2 - 0.01, bh - 0.2, bz + z); s.rotation.z = 0.08; group.add(s); }
  colliders.push({ minX: bx - bw / 2 - 0.1, maxX: bx + bw / 2 + 0.25, minZ: bz - bl / 2 - 0.1, maxZ: bz + bl / 2 + 0.1 });

  // overturned wooden chair
  const chair = new THREE.Group();
  const wood = surfaceMaterial('wood');
  const cb = (w, h, d, x, y, z) => { const m = mesh(new THREE.BoxGeometry(w, h, d), wood); m.position.set(x, y, z); chair.add(m); };
  cb(0.44, 0.035, 0.42, 0, 0.45, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cb(0.035, 0.45, 0.035, sx * 0.19, 0.225, sz * 0.18);
  for (const sx of [-1, 1]) cb(0.035, 0.5, 0.035, sx * 0.19, 0.72, -0.18);
  cb(0.42, 0.1, 0.025, 0, 0.88, -0.18); cb(0.42, 0.05, 0.025, 0, 0.66, -0.18);
  chair.rotation.set(0, 0.7, Math.PI / 2); chair.position.set(0.9, 0.225, 0.7);
  group.add(chair);
  colliders.push({ minX: 0.45, maxX: 1.4, minZ: 0.25, maxZ: 1.2 });

  // scattered papers
  const paperMat = surfaceMaterial('paper', { side: THREE.DoubleSide });
  for (let i = 0; i < 9; i++) {
    const p = mesh(new THREE.PlaneGeometry(0.21, 0.297), paperMat, { cast: false });
    p.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
    const a = Math.random() * Math.PI * 2, r = 0.6 + Math.random() * 1.8;
    p.position.set(-1.2 + Math.cos(a) * r, 0.002 + i * 0.0004, -0.6 + Math.sin(a) * r);
    group.add(p);
  }

  // floor drain
  const drainMat = surfaceMaterial('metal', { tint: [0.1, 0.1, 0.09] });
  const ring = mesh(new THREE.RingGeometry(0.11, 0.15, 32), drainMat, { cast: false }); ring.rotation.x = -Math.PI / 2; ring.position.set(-0.2, 0.003, -1.6); group.add(ring);
  const hole2 = new THREE.Mesh(new THREE.CircleGeometry(0.11, 32), new THREE.MeshBasicMaterial({ color: 0x000000 })); hole2.rotation.x = -Math.PI / 2; hole2.position.set(-0.2, 0.002, -1.6); group.add(hole2);
  for (let i = -3; i <= 3; i++) group.add(tube([-0.2 - 0.105, 0.004, -1.6 + i * 0.03], [-0.2 + 0.105, 0.004, -1.6 + i * 0.03], 0.005, drainMat, 6));

  // hanging bulb above the creature
  const bulbPos = new THREE.Vector3(CREATURE_SPOT.x - 0.55, 2.42, CREATURE_SPOT.z + 1.05);
  group.add(tube([bulbPos.x, Hh, bulbPos.z], [bulbPos.x, bulbPos.y + 0.12, bulbPos.z], 0.004, surfaceMaterial('metal', { tint: [0.05, 0.05, 0.05] }), 6));
  const shade = mesh(new THREE.CylinderGeometry(0.035, 0.17, 0.12, 24, 1, true), surfaceMaterial('metal', { tint: [0.18, 0.22, 0.2], side: THREE.DoubleSide }));
  shade.position.copy(bulbPos).add(new THREE.Vector3(0, 0.07, 0)); group.add(shade);
  const cap = mesh(new THREE.CircleGeometry(0.036, 24), surfaceMaterial('metal', { tint: [0.18, 0.22, 0.2], side: THREE.DoubleSide }));
  cap.rotation.x = -Math.PI / 2; cap.position.copy(bulbPos).add(new THREE.Vector3(0, 0.13, 0)); group.add(cap);
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1.0, 0.72, 0.4), emissiveIntensity: 6 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), bulbMat); bulb.position.copy(bulbPos); group.add(bulb);
  // a shaded bulb throws its light down in a wide cone; a faint shadowless spill lights the rest
  const lamp = new THREE.SpotLight(new THREE.Color(1.0, 0.68, 0.38), 3.4, 0, 1.15, 0.55, 2);
  lamp.position.copy(bulbPos).add(new THREE.Vector3(0, -0.02, 0));
  lamp.target.position.copy(bulbPos).add(new THREE.Vector3(0, -3, 0));
  lamp.castShadow = true; lamp.shadow.mapSize.set(1024, 1024); lamp.shadow.bias = -0.0008; lamp.shadow.normalBias = 0.02; lamp.shadow.camera.near = 0.05;
  const spill = new THREE.PointLight(new THREE.Color(1.0, 0.7, 0.4), 0.35, 0, 2);
  spill.position.copy(bulbPos);
  group.add(lamp, lamp.target, spill);

  const ambient = new THREE.HemisphereLight(0x2a3038, 0x0d0a08, 0.06);
  group.add(ambient);

  // dust motes, only visible where light hits them
  const N = 2600;
  const pts = new Float32Array(N * 3), seeds = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pts[i * 3] = min.x + Math.random() * W; pts[i * 3 + 1] = Math.random() * Hh; pts[i * 3 + 2] = min.z + Math.random() * D; seeds[i] = Math.random();
  }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.BufferAttribute(pts, 3)); dg.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
  const dustMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uSpotPos: { value: new THREE.Vector3() }, uSpotDir: { value: new THREE.Vector3(0, 0, -1) }, uSpotCos: { value: 0.9 }, uSpotOn: { value: 1 },
      uLamp: { value: lamp.position }, uLampI: { value: 1 }, uPx: { value: 1 }, uMin: { value: ROOM.min }, uSize: { value: new THREE.Vector3(W, Hh, D) },
    },
    vertexShader: /* glsl */`
      attribute float seed; uniform float uTime, uPx; uniform vec3 uMin, uSize;
      uniform vec3 uSpotPos, uSpotDir; uniform float uSpotCos, uSpotOn; uniform vec3 uLamp; uniform float uLampI;
      varying float vA;
      void main() {
        vec3 p = position;
        p += vec3(sin(uTime * 0.13 + seed * 40.0), sin(uTime * 0.07 + seed * 17.0) * 0.6 - uTime * 0.004, cos(uTime * 0.11 + seed * 23.0)) * 0.25;
        p = uMin + mod(p - uMin, uSize);
        vec3 toP = p - uSpotPos; float d = length(toP);
        float spot = smoothstep(uSpotCos, mix(uSpotCos, 1.0, 0.5), dot(toP / d, uSpotDir)) * uSpotOn / (1.0 + d * d * 0.25);
        float lampL = uLampI * 0.6 / (1.0 + dot(p - uLamp, p - uLamp) * 3.0);
        vA = clamp((spot + lampL) * (0.5 + 0.5 * sin(seed * 100.0 + uTime)), 0.0, 1.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPx * (0.6 + seed * 1.2) * 0.01 * 600.0 / -mv.z;
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      void main() { vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(c)); gl_FragColor = vec4(vec3(0.75, 0.7, 0.6) * a * vA * 0.2, 1.0); }`,
  });
  const dust = new THREE.Points(dg, dustMat); dust.frustumCulled = false; group.add(dust);

  // flicker logic
  let flickerT = 0, out = 0;
  function update(dt, t, spot) {
    flickerT -= dt;
    if (flickerT <= 0) { flickerT = 0.03 + Math.random() * 0.12; out = Math.random() < 0.06 ? (Math.random() < 0.5 ? 0.0 : 0.25) : 1; }
    const buzz = 0.88 + 0.12 * Math.sin(t * 120) * Math.sin(t * 7.3) + (Math.random() - 0.5) * 0.06;
    const k = out * buzz;
    lamp.intensity = 3.4 * k; spill.intensity = 0.35 * k;
    bulbMat.emissiveIntensity = 6 * k;
    dustMat.uniforms.uTime.value = t;
    dustMat.uniforms.uLampI.value = k;
    if (spot) {
      dustMat.uniforms.uSpotPos.value.copy(spot.position);
      dustMat.uniforms.uSpotDir.value.copy(spot.dir);
      dustMat.uniforms.uSpotCos.value = Math.cos(spot.angle);
      dustMat.uniforms.uSpotOn.value = spot.on;
    }
  }

  const door = buildDoor(group, DOOR, min.z);
  const baseUpdate = update;
  return { group, colliders, update: (dt, t, spot) => { baseUpdate(dt, t, spot); door.update(dt, t); }, lamp, moon, ambient, dustMat, door };
}

// a soft, imperfect flashlight beam pattern (projected through the spotlight)
export function flashlightCookie() {
  const S = 256; const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  const r = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  r.addColorStop(0.0, 'rgba(255,250,235,1)'); r.addColorStop(0.12, 'rgba(255,245,225,0.95)');
  r.addColorStop(0.22, 'rgba(210,200,180,0.55)'); r.addColorStop(0.26, 'rgba(255,240,215,0.72)');
  r.addColorStop(0.4, 'rgba(150,140,120,0.32)'); r.addColorStop(0.7, 'rgba(60,55,45,0.12)'); r.addColorStop(1.0, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, S, S);
  // smudges on the lens
  for (let i = 0; i < 40; i++) {
    const x = S / 2 + (Math.random() - 0.5) * S * 0.6, y = S / 2 + (Math.random() - 0.5) * S * 0.6, rr = 4 + Math.random() * 16;
    const s = g.createRadialGradient(x, y, 0, x, y, rr);
    s.addColorStop(0, `rgba(0,0,0,${0.05 + Math.random() * 0.1})`); s.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = s; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------ the breakable door
// A plank door in the back wall. hit() dents and rattles it; smash() throws the pieces into the room.
function buildDoor(group, D, wallZ) {
  const wood = surfaceMaterial('wood');
  const frameMat = surfaceMaterial('metal', { tint: [0.22, 0.2, 0.17] });
  // frame
  const fr = (w, h, d, x, y, z) => { const m = mesh(new THREE.BoxGeometry(w, h, d), frameMat); m.position.set(x, y, z); group.add(m); };
  fr(0.07, D.h + 0.07, 0.26, D.x - D.w / 2 - 0.035, (D.h + 0.07) / 2, wallZ - 0.05);
  fr(0.07, D.h + 0.07, 0.26, D.x + D.w / 2 + 0.035, (D.h + 0.07) / 2, wallZ - 0.05);
  fr(D.w + 0.14, 0.07, 0.26, D.x, D.h + 0.035, wallZ - 0.05);
  // the corridor beyond: dark, with a dying red light far down it
  const cor = mesh(new THREE.BoxGeometry(1.5, 2.5, 4.5), surfaceMaterial('ceiling', { side: THREE.BackSide }), { cast: false });
  cor.position.set(D.x, 1.25, wallZ - 2.25 - 0.01); group.add(cor);
  const red = new THREE.PointLight(0xff2a12, 0.6, 6, 2); red.position.set(D.x + 0.4, 2.1, wallZ - 4.0); group.add(red);
  const redBulb = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3018 })); redBulb.position.copy(red.position); group.add(redBulb);

  // door leaf: 5 vertical planks, each in 3 pieces, plus two cross braces
  const pieces = [];
  const thick = 0.045, nP = 5, pw = D.w / nP, segH = [0.62, 0.78, 0.68];
  const doorZ = wallZ - 0.04;
  for (let i = 0; i < nP; i++) {
    let y0 = 0.005;
    for (let j = 0; j < 3; j++) {
      const h = segH[j] * (D.h - 0.02) / 2.08 + (j === 1 ? (i % 2 ? 0.04 : -0.04) : 0) * (j === 1 ? 1 : 0);
      const geo = new THREE.BoxGeometry(pw - 0.006, h - 0.004, thick, 1, 3, 1);
      const m = mesh(geo, wood);
      const home = new THREE.Vector3(D.x - D.w / 2 + pw * (i + 0.5), y0 + h / 2, doorZ);
      m.position.copy(home); group.add(m);
      pieces.push({ m, home, half: new THREE.Vector3((pw - 0.006) / 2, (h - 0.004) / 2, thick / 2), vel: new THREE.Vector3(), ang: new THREE.Vector3(), dent: 0, rest: false });
      y0 += h;
    }
  }
  for (const y of [0.45, 1.65]) {
    const m = mesh(new THREE.BoxGeometry(D.w - 0.06, 0.11, 0.03), wood);
    const home = new THREE.Vector3(D.x, y, doorZ + thick / 2 + 0.015);
    m.position.copy(home); group.add(m);
    pieces.push({ m, home, half: new THREE.Vector3((D.w - 0.06) / 2, 0.055, 0.015), vel: new THREE.Vector3(), ang: new THREE.Vector3(), dent: 0, rest: false, brace: true });
  }
  const shake = { x: 0, v: 0 };
  const door = {
    position: new THREE.Vector3(D.x, 0, wallZ), normal: new THREE.Vector3(0, 0, 1), broken: false,
    hit(n) {
      shake.v += 1.6 + n * 0.8;
      // each blow caves the planks in around where the fists land
      for (const p of pieces) {
        const d = Math.hypot(p.home.x - D.x, p.home.y - 1.35);
        p.dent += Math.max(0, 0.05 - d * 0.04) * n + Math.random() * 0.01;
        if (!p.brace && Math.random() < 0.25 * n) p.m.rotation.z += (Math.random() - 0.5) * 0.08;
      }
    },
    smash(dir) {
      if (door.broken) return;
      door.broken = true;
      for (const p of pieces) {
        p.vel.set(0, 0, 0).addScaledVector(dir, 2.5 + Math.random() * 4); // blown through the doorway, away from the blows
        p.vel.x += (Math.random() - 0.5) * 2.5; p.vel.y += 0.5 + Math.random() * 2.5;
        if (Math.random() < 0.5) { p.vel.multiplyScalar(-0.5); p.vel.x *= 2.2; } // half splinter back into the room
        p.ang.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14);
        p.rest = false;
      }
    },
    reset() {
      door.broken = false; shake.x = shake.v = 0;
      for (const p of pieces) { p.m.position.copy(p.home); p.m.rotation.set(0, 0, 0); p.vel.set(0, 0, 0); p.ang.set(0, 0, 0); p.dent = 0; p.rest = false; }
    },
    update(dt) {
      if (dt <= 0) return;
      if (!door.broken) {
        // rattle in the frame
        shake.v += (-shake.x * 900 - shake.v * 18) * dt; shake.x += shake.v * dt;
        for (const p of pieces) { p.m.position.z = p.home.z - p.dent + shake.x * 0.004; p.m.position.x = p.home.x + shake.x * 0.0015 * Math.sin(p.home.y * 9); }
        return;
      }
      for (const p of pieces) {
        if (p.rest) continue;
        p.vel.y -= 9.8 * dt;
        p.m.position.addScaledVector(p.vel, dt);
        p.m.rotation.x += p.ang.x * dt; p.m.rotation.y += p.ang.y * dt; p.m.rotation.z += p.ang.z * dt;
        // lowest corner against the floor
        p.m.updateMatrix();
        let minY = Infinity;
        for (let c = 0; c < 8; c++) {
          const v = new THREE.Vector3(c & 1 ? p.half.x : -p.half.x, c & 2 ? p.half.y : -p.half.y, c & 4 ? p.half.z : -p.half.z).applyMatrix4(p.m.matrix);
          minY = Math.min(minY, v.y);
        }
        if (minY < 0) {
          p.m.position.y -= minY;
          if (p.vel.y < 0) p.vel.y *= -0.25;
          p.vel.x *= 0.6; p.vel.z *= 0.6; p.ang.multiplyScalar(0.55);
          if (p.vel.lengthSq() < 0.02 && p.ang.lengthSq() < 0.5) { p.rest = true; }
        }
        // keep pieces inside the room + corridor
        p.m.position.x = Math.min(Math.max(p.m.position.x, ROOM.min.x + 0.1), ROOM.max.x - 0.1);
        if (p.m.position.z < wallZ - 0.1) p.m.position.x = Math.min(Math.max(p.m.position.x, D.x - 0.65), D.x + 0.65);
        p.m.position.z = Math.max(p.m.position.z, wallZ - 4.3);
      }
    },
  };
  return door;
}
