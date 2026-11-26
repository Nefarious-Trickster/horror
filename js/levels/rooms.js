// Builds walls, floors and ceilings from a plan of axis-aligned rooms and door openings.
// Rooms are rasterised on a fine grid; a wall runs wherever two neighbouring cells belong to different
// rooms (or a room meets solid ground), except across a door, which gets a lintel instead.
//   ROOMS: { name: { x0, x1, z0, z1, h, floor?: 'key', ceiling?: false } }
//   DOORS: [{ x0, x1, z0, z1, wide?: true (no lintel below the lower ceiling), top?: 2.5 }]
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function buildRooms(scene, ROOMS, DOORS, { wallMat, floorMats = {}, ceilMat, worldUV, cell = 0.1, thickness = 0.3, bounds } = {}) {
  const colliders = [], sightBlockers = [];
  const list = Object.entries(ROOMS);
  const b = bounds || list.reduce((a, [, r]) => ({ x0: Math.min(a.x0, r.x0 - 2), x1: Math.max(a.x1, r.x1 + 2), z0: Math.min(a.z0, r.z0 - 2), z1: Math.max(a.z1, r.z1 + 2) }), { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 });
  const C = cell, NX = Math.ceil((b.x1 - b.x0) / C), NZ = Math.ceil((b.z1 - b.z0) / C);
  const roomAt = (x, z) => { for (let k = 0; k < list.length; k++) { const r = list[k][1]; if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return k; } return -1; };
  const doorAt = (x, z) => DOORS.find((d) => x > d.x0 && x < d.x1 && z > d.z0 && z < d.z1);
  const ids = new Int16Array(NX * NZ);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) ids[i + j * NX] = roomAt(b.x0 + (i + 0.5) * C, b.z0 + (j + 0.5) * C);
  const hOf = (k) => (k >= 0 ? list[k][1].h : 0);
  const geos = [], T = thickness;
  const add = (x0, x1, z0, z1, y0, y1, collide) => {
    if (y1 - y0 < 0.01) return;
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    worldUV?.(g, wallMat?.userData?.tile || 2.4); geos.push(g);
    if (collide) { const bx = { minX: x0, maxX: x1, minZ: z0, maxZ: z1 }; colliders.push(bx); sightBlockers.push(bx); }
  };
  const lintel = (run) => (run.door.top ?? (run.door.wide ? Math.min(run.ha || 9, run.hb || 9) : 2.5));
  for (let i = 0; i < NX - 1; i++) {
    let run = null;
    const flush = () => { if (!run) return; const x = b.x0 + (i + 1) * C; if (run.door) add(x - T / 2, x + T / 2, run.z0, run.z1, lintel(run), Math.max(run.ha, run.hb), false); else add(x - T / 2, x + T / 2, run.z0, run.z1, 0, Math.max(run.ha, run.hb), true); run = null; };
    for (let j = 0; j < NZ; j++) {
      const a = ids[i + j * NX], c = ids[i + 1 + j * NX], z = b.z0 + j * C, x = b.x0 + (i + 1) * C;
      if (a === c) { flush(); continue; }
      const door = doorAt(x, z + C / 2), key = `${a}|${c}|${door ? DOORS.indexOf(door) : -1}`;
      if (run && run.key === key) { run.z1 = z + C; continue; }
      flush(); run = { key, z0: z, z1: z + C, ha: hOf(a), hb: hOf(c), door };
    }
    flush();
  }
  for (let j = 0; j < NZ - 1; j++) {
    let run = null;
    const flush = () => { if (!run) return; const z = b.z0 + (j + 1) * C; if (run.door) add(run.x0, run.x1, z - T / 2, z + T / 2, lintel(run), Math.max(run.ha, run.hb), false); else add(run.x0, run.x1, z - T / 2, z + T / 2, 0, Math.max(run.ha, run.hb), true); run = null; };
    for (let i = 0; i < NX; i++) {
      const a = ids[i + j * NX], c = ids[i + (j + 1) * NX], x = b.x0 + i * C, z = b.z0 + (j + 1) * C;
      if (a === c) { flush(); continue; }
      const door = doorAt(x + C / 2, z), key = `${a}|${c}|${door ? DOORS.indexOf(door) : -1}`;
      if (run && run.key === key) { run.x1 = x + C; continue; }
      flush(); run = { key, x0: x, x1: x + C, ha: hOf(a), hb: hOf(c), door };
    }
    flush();
  }
  const walls = new THREE.Mesh(mergeGeometries(geos), wallMat); walls.castShadow = walls.receiveShadow = true; walls.name = 'walls'; scene.add(walls);
  // floors (grouped by material key) and ceilings
  const fl = new Map(), ce = [];
  for (const [, r] of list) {
    const key = r.floor || 'default';
    const f = new THREE.BoxGeometry(r.x1 - r.x0 + T, 0.2, r.z1 - r.z0 + T); f.translate((r.x0 + r.x1) / 2, -0.1, (r.z0 + r.z1) / 2);
    worldUV?.(f, floorMats[key]?.userData?.tile || 2); if (!fl.has(key)) fl.set(key, []); fl.get(key).push(f);
    if (r.ceiling === false) continue;
    const c = new THREE.BoxGeometry(r.x1 - r.x0 + T, 0.3, r.z1 - r.z0 + T); c.translate((r.x0 + r.x1) / 2, r.h + 0.15, (r.z0 + r.z1) / 2); worldUV?.(c, 2.6); ce.push(c);
  }
  for (const d of DOORS) { const f = new THREE.BoxGeometry(d.x1 - d.x0 + 0.4, 0.2, d.z1 - d.z0 + 0.4); f.translate((d.x0 + d.x1) / 2, -0.1, (d.z0 + d.z1) / 2); worldUV?.(f, 2); if (!fl.has('default')) fl.set('default', []); fl.get('default').push(f); }
  for (const [key, g] of fl) { const m = new THREE.Mesh(mergeGeometries(g), floorMats[key] || floorMats.default); m.receiveShadow = true; scene.add(m); }
  if (ce.length) { const m = new THREE.Mesh(mergeGeometries(ce), ceilMat); m.receiveShadow = true; scene.add(m); }
  return { colliders, sightBlockers, walls };
}

// Places an object; registers its footprint (userData.collider {w,d}) or local boxes (userData.colliders)
// in world space. Rotations are multiples of 90 degrees.
export function placer(scene, colliders) {
  return (obj, x, z, rot = 0, y = 0) => {
    obj.position.set(x, y, z); obj.rotation.y = rot; scene.add(obj);
    const c0 = Math.cos(rot), s0 = Math.sin(rot);
    if (Array.isArray(obj.userData?.colliders)) for (const bx of obj.userData.colliders) {
      const p = [[bx.minX, bx.minZ], [bx.maxX, bx.maxZ]].map(([lx, lz]) => [x + lx * c0 + lz * s0, z - lx * s0 + lz * c0]);
      colliders.push({ minX: Math.min(p[0][0], p[1][0]), maxX: Math.max(p[0][0], p[1][0]), minZ: Math.min(p[0][1], p[1][1]), maxZ: Math.max(p[0][1], p[1][1]) });
    } else if (obj.userData?.collider && y < 0.5) {
      const c = obj.userData.collider, sw = Math.abs(s0) > 0.5, w = sw ? c.d : c.w, dd = sw ? c.w : c.d;
      colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - dd / 2, maxZ: z + dd / 2 });
    }
    return obj;
  };
}

// Interior paint: a darker, harder-wearing colour below a dado line, scuffed at skirting height.
export function paintedMaterial(base, { upper = 0xb9b49f, lower = 0x4d5a4a, dado = 1.25 } = {}) {
  const m = new THREE.MeshStandardMaterial({ ...base, color: 0xffffff, roughness: 1 });
  m.userData.tile = 2.4;
  const u = new THREE.Color(upper), l = new THREE.Color(lower);
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPaintP;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvPaintP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vPaintP;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float below = 1.0 - step(${dado.toFixed(2)}, vPaintP.y);
        vec3 paint = mix(vec3(${u.r.toFixed(3)}, ${u.g.toFixed(3)}, ${u.b.toFixed(3)}), vec3(${l.r.toFixed(3)}, ${l.g.toFixed(3)}, ${l.b.toFixed(3)}), below);
        diffuseColor.rgb *= paint;
        diffuseColor.rgb *= 1.0 - exp(-pow((vPaintP.y - ${dado.toFixed(2)}) * 40.0, 2.0)) * 0.55; // the dado stripe
        diffuseColor.rgb *= 1.0 - smoothstep(0.12, 0.0, vPaintP.y) * 0.5; // skirting grime
        diffuseColor.rgb *= 0.9 + 0.1 * sin(vPaintP.x * 0.7 + vPaintP.z * 0.5) * sin(vPaintP.y * 1.3);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.55, below);');
  };
  m.customProgramCacheKey = () => `paint:${upper}:${lower}:${dado}`;
  return m;
}
