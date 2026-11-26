// CHAPTER TWO: PUMP LEVEL
// D-3, the service sublevel, knee-deep from a burst main. Bring three drainage pumps up in order (east,
// west, north) to drain the level and open the pressure door to the archive stair. Every step is heard.
// B is in the water: you see its wake before you see it. Sgt. Halloran is pinned in the cable gallery.
import * as THREE from 'three';
import { Creature } from '../creature.js';
import { loadCreatureModel, creatureBlockers, creatureCtx, applyDebugCamera } from './common.js';
import { sfx } from '../engine/game.js';
import { save } from '../save.js';
import { NavGrid } from '../ai/navgrid.js';
import { Hunter } from '../ai/hunter.js';
import { HalideLamp } from '../engine/lamp.js';
import { Water } from '../engine/water.js';
import { addFloorReflection } from '../engine/reflect.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const OK = 'Dr. Okafor', HAL = 'Sgt. Halloran', HALR = 'Halloran (radio)';
const R = { N: 0, S: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 }; // the way an object's front (+Z) faces
const WATER = [0.55, 0.4, 0.22, 0.0]; // water level by number of pumps running

// ------------------------------------------------------------------ floor plan (x east, z north)
const ROOMS = {
  car: { x0: -1.3, x1: 1.3, z0: -7.7, z1: -5, h: 2.9, dry: true },
  lobby: { x0: -5, x1: 5, z0: -5, z1: 0, h: 3.4 },
  hall: { x0: -18, x1: 18, z0: 0, z1: 20, h: 4.6 },
  east: { x0: 18, x1: 28, z0: 2, z1: 12, h: 3.6 },
  gallery: { x0: 18, x1: 28, z0: 12, z1: 24, h: 3.2 },
  west: { x0: -28, x1: -18, z0: 6, z1: 16, h: 3.6 },
  ncorr: { x0: -1.6, x1: 1.6, z0: 20, z1: 30, h: 3.0 },
  north: { x0: -8, x1: 8, z0: 30, z1: 40, h: 4.0 },
  control: { x0: 5, x1: 13, z0: -5, z1: 0, h: 3.0, dry: true },
  stair: { x0: -11, x1: -5, z0: -4.5, z1: -0.5, h: 6.2, dry: true },
};
const DOORS = [
  { x0: -1.3, x1: 1.3, z0: -5.3, z1: -4.7, wide: true }, // lift car
  { x0: -3.5, x1: 3.5, z0: -0.3, z1: 0.3, wide: true }, // lobby / hall
  { x0: 17.7, x1: 18.3, z0: 5, z1: 7.8 }, // hall / east
  { x0: 17.7, x1: 18.3, z0: 15, z1: 17.4 }, // hall / gallery
  { x0: 22, x1: 24, z0: 11.7, z1: 12.3 }, // east / gallery
  { x0: -18.3, x1: -17.7, z0: 9.4, z1: 12 }, // hall / west
  { x0: -1.6, x1: 1.6, z0: 19.7, z1: 20.3, wide: true }, // hall / north corridor
  { x0: -1.6, x1: 1.6, z0: 29.7, z1: 30.3, wide: true }, // corridor / north room
  { x0: 4.7, x1: 5.3, z0: -3.4, z1: -1.6 }, // lobby / control room
  { x0: -5.3, x1: -4.7, z0: -3.1, z1: -1.9, pressure: true }, // lobby / stair (pressure door)
];
// the stair flight up to the archive, climbing west along the stair room's south side
const STAIR = { x0: -6.0, zc: -3.6, z0: -4.35, z1: -2.85, rise: 0.18 / 0.28, top: 14 * 0.18 };
const stairGround = (x, z) => {
  if (z < STAIR.z0 - 0.15 || z > STAIR.z1 + 0.02 || x > STAIR.x0 + 0.05) {
    if (x < STAIR.x0 - 14 * 0.28 && z < -0.8 && x > -11.1) return STAIR.top; // landing
    return 0;
  }
  return Math.min(STAIR.top, Math.max(0, (STAIR.x0 + 0.05 - x) * STAIR.rise));
};
const PUMPS = [
  { id: 'P1', room: 'east', at: V(23.5, 0, 7.5), rot: 0, panel: V(22, 1.35, 2.0), prot: R.N, speed: 0.12, wobble: 0.0, green: [0.6, 0.78], color: 'greenPaint', light: [V(26, 3.2, 3.5), V(23.5, 0, 7.5)] },
  { id: 'P2', room: 'west', at: V(-22.5, 0, 12), rot: Math.PI, panel: V(-28, 1.35, 9.5), prot: R.E, speed: 0.16, wobble: 0.03, green: [0.64, 0.78], color: 'steelPaint', light: [V(-19.5, 3.2, 15), V(-23, 0, 11)] },
  { id: 'P3', room: 'north', at: V(-1.5, 0, 36), rot: 0, panel: V(3.5, 1.35, 40), prot: R.S, speed: 0.14, wobble: 0.07, green: [0.66, 0.77], color: 'redPaint', light: [V(6, 3.6, 32), V(0, 0, 36)] },
];

const DOCS = {
  schematic: {
    ref: 'WALL SCHEMATIC · CONTROL ROOM D-3', title: 'Drainage: start-up sequence',
    body: `<p>Three duty pumps share one rising main. <b>Start them in order: P1 (east), P2 (west), P3 (north).</b> A pump started without suction head from the one before it will cavitate and trip.</p>
<p>To start: open the prime. Watch the suction gauge. Close the bleed valve <b>while the needle is in the green</b>. Too early and the prime is lost. Too late and the relief valve lifts.</p>
<p>The relief valve is <i>loud</i>. Hearing protection is mandatory.</p>`,
  },
  log: {
    ref: 'MAINTENANCE LOG · PUMP LEVEL · BOOK 3', title: 'Deliveries after the stop',
    body: `<p><b>02 Apr.</b> Wing D fit-out suspended per Site Instruction 14. Goods lift isolated at D-1.</p>
<p><b>19 Apr.</b> Goods lift re-energised on instruction from Wing C. Not by us. Six sealed cold-chain containers down to D-3, then on to the adit. Cost code LANTERN-D. Driver had no paperwork and did not take his helmet off.</p>
<p><b>03 May.</b> Same again. Eight containers. One of them was knocking.</p>
<p><b>11 Jun.</b> Asked M. Varga about the deliveries. Told it was refrigeration plant for the archive. The archive does not need refrigeration.</p>
<p><b>14 Jun.</b> Told not to ask M. Varga about the deliveries.</p>
<p><i>(the last eleven pages have been torn out)</i></p>`,
  },
  order: {
    ref: 'WORK ORDER 4471 · FOLDED IN A PUMP MANUAL', title: 'Cold store, adit 2',
    body: `<p>Install one walk-in refrigerated store in mine adit 2, below the pump level. Power from the D-3 board. Door to open from the <b>outside only</b>.</p>
<p>Not to appear on site drawings. Not to be discussed with Halversen Estates.</p>
<p>Authorised: <b>I. Okafor</b>, Director, Wing C.</p>
<p>Someone has written underneath, in pencil: <i>“outside only??”</i></p>`,
  },
  photo: {
    ref: 'PHOTOGRAPH · FLOATING NEAR THE PRESSURE DOOR', title: 'Topping out',
    body: `<p>A laminated photograph, warped by the water. Two people in hard hats on a concrete roof, squinting into the sun, a flag on a crane behind them. A younger Imani Okafor, laughing. Teodor Lind, with his arm around her shoulders.</p>
<p>On the back, in marker: <b>“Site 41 topping-out. T. & I. We built this.”</b></p>`,
  },
};

// ------------------------------------------------------------------ the level
export async function chapter2(game, opts = {}) {
  const { scene, player, ui, director: d, interact, renderer } = game;
  const say = (who, text, dur) => ui.say(who, text, dur);
  renderer.toneMappingExposure = 1.05;
  scene.background = new THREE.Color(0x020304);
  scene.fog = new THREE.FogExp2(0x040606, 0.045);

  const CH = Object.assign({ pumps: [false, false, false], crowbar: false, halloran: null, met: false, wake: false, cells: [], docs: [], seenSchematic: false, done: false }, opts.state || {});
  const checkpoint = () => save.set('ch2', JSON.parse(JSON.stringify({ ...CH, dead: false })));
  const pumpsOn = () => CH.pumps.filter(Boolean).length;

  // ---------------------------------------------------------------- assets
  const [kitMod, P, PP] = await Promise.all([
    import('../wingd/kit.js').catch((e) => { console.warn('kit unavailable', e); return null; }),
    import('../lab/props.js').catch(() => ({})),
    import('../pump/props.js'),
  ]);
  if (kitMod?.loadKit) await kitMod.loadKit((a, b) => game.onProgress?.(a / b)).catch((e) => console.warn(e));
  const K = kitMod?.KIT || {};
  const M = K.materials || {};
  PP.usePumpMaterials(M);
  const fbMat = new THREE.MeshStandardMaterial({ color: 0x6b6862, roughness: 0.9 });
  const fallback = (w, h, dd) => { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), fbMat); m.position.y = h / 2; g.add(m); g.userData.collider = { w, d: dd }; return g; };
  const kit = (name, args = [], fb) => { try { if (typeof K[name] === 'function') return K[name](...args); } catch (e) { console.warn('kit', name, e); } return fb ? fallback(...fb) : new THREE.Group(); };
  const model = (id, fb) => { try { if (K.model) { const m = K.model(id); if (m) return m; } } catch (e) { console.warn('model', id, e); } return fb ? fallback(...fb) : new THREE.Group(); };

  // wet concrete: darker and glossier below the old flood line, with a tide mark
  const wetMats = [];
  function wet(base, { tide = 1.05, color } = {}) {
    const o = base || {};
    const m = new THREE.MeshStandardMaterial({ map: o.map || null, normalMap: o.normalMap || null, roughnessMap: o.roughnessMap || null, color: color ?? (o.color ? o.color.getHex() : 0x8a857c), roughness: 1, normalScale: o.normalScale || new THREE.Vector2(1, 1) });
    m.userData.tile = o.userData?.tile || 2.4;
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWetP;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWetP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWetP;\nfloat wetK;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          float tideY = ${tide.toFixed(2)} + sin(vWetP.x * 1.7 + vWetP.z * 2.3) * 0.03;
          wetK = 1.0 - smoothstep(tideY - 0.04, tideY + 0.02, vWetP.y);
          float streak = smoothstep(0.6, 1.0, sin(vWetP.x * 13.0 + sin(vWetP.z * 7.0) * 2.0) * 0.5 + 0.5) * smoothstep(${(tide + 1.4).toFixed(2)}, ${tide.toFixed(2)}, vWetP.y);
          diffuseColor.rgb *= mix(1.0, 0.5, wetK) * (1.0 - streak * 0.18);
          diffuseColor.rgb *= 1.0 - exp(-pow((vWetP.y - tideY) * 22.0, 2.0)) * 0.45;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.9, 0.95, 0.85), wetK);`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.28, wetK);');
    };
    m.customProgramCacheKey = () => `wet:${tide}`;
    wetMats.push(m);
    return m;
  }
  const matWall = wet(M.concreteWall, { color: 0x9c978d }), matFloor = wet(M.slab, { color: 0x6c6860, tide: 9 }), matCeil = M.soffit || fbMat;

  // ---------------------------------------------------------------- walls from the room plan
  // Rasterise rooms on a fine grid; a wall runs wherever two neighbouring cells belong to different rooms
  // (or a room meets solid ground), except across a door.
  const colliders = [], sightBlockers = [];
  const C = 0.1, X0 = -30, Z0 = -9, NX = 600, NZ = 520;
  const roomList = Object.entries(ROOMS);
  const roomAt = (x, z) => { for (let k = 0; k < roomList.length; k++) { const r = roomList[k][1]; if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return k; } return -1; };
  const doorAt = (x, z) => DOORS.find((d0) => x > d0.x0 && x < d0.x1 && z > d0.z0 && z < d0.z1);
  const ids = new Int16Array(NX * NZ);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) ids[i + j * NX] = roomAt(X0 + (i + 0.5) * C, Z0 + (j + 0.5) * C);
  const hOf = (k) => (k >= 0 ? roomList[k][1].h : 0);
  const wallGeos = [], T = 0.3;
  const addWall = (x0, x1, z0, z1, y0, y1, collide) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    K.worldUV?.(g, 2.4); wallGeos.push(g);
    if (collide) { const b = { minX: x0, maxX: x1, minZ: z0, maxZ: z1 }; colliders.push(b); sightBlockers.push(b); }
  };
  // vertical boundaries (walls along z)
  for (let i = 0; i < NX - 1; i++) {
    let run = null;
    const flush = () => { if (!run) return; const x = X0 + (i + 1) * C; if (run.door) addWall(x - T / 2, x + T / 2, run.z0, run.z1, run.door.wide ? Math.min(run.ha || 9, run.hb || 9) : 2.5, Math.max(run.ha, run.hb), false); else addWall(x - T / 2, x + T / 2, run.z0, run.z1, 0, Math.max(run.ha, run.hb), true); run = null; };
    for (let j = 0; j < NZ; j++) {
      const a = ids[i + j * NX], b = ids[i + 1 + j * NX];
      const z = Z0 + j * C, x = X0 + (i + 1) * C;
      if (a === b) { flush(); continue; }
      const door = doorAt(x, z + C / 2);
      const key = `${a}|${b}|${door ? DOORS.indexOf(door) : -1}`;
      if (run && run.key === key) { run.z1 = z + C; continue; }
      flush(); run = { key, z0: z, z1: z + C, ha: hOf(a), hb: hOf(b), door };
    }
    flush();
  }
  // horizontal boundaries (walls along x)
  for (let j = 0; j < NZ - 1; j++) {
    let run = null;
    const flush = () => { if (!run) return; const z = Z0 + (j + 1) * C; if (run.door) addWall(run.x0, run.x1, z - T / 2, z + T / 2, run.door.wide ? Math.min(run.ha || 9, run.hb || 9) : 2.5, Math.max(run.ha, run.hb), false); else addWall(run.x0, run.x1, z - T / 2, z + T / 2, 0, Math.max(run.ha, run.hb), true); run = null; };
    for (let i = 0; i < NX; i++) {
      const a = ids[i + j * NX], b = ids[i + (j + 1) * NX];
      const x = X0 + i * C, z = Z0 + (j + 1) * C;
      if (a === b) { flush(); continue; }
      const door = doorAt(x + C / 2, z);
      const key = `${a}|${b}|${door ? DOORS.indexOf(door) : -1}`;
      if (run && run.key === key) { run.x1 = x + C; continue; }
      flush(); run = { key, x0: x, x1: x + C, ha: hOf(a), hb: hOf(b), door };
    }
    flush();
  }
  const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
  const walls = new THREE.Mesh(mergeGeometries(wallGeos), matWall); walls.castShadow = walls.receiveShadow = true; scene.add(walls);
  // floor and ceilings
  const floorGeos = [], ceilGeos = [];
  for (const [name, r] of roomList) {
    const f = new THREE.BoxGeometry(r.x1 - r.x0 + 0.3, 0.2, r.z1 - r.z0 + 0.3); f.translate((r.x0 + r.x1) / 2, -0.1, (r.z0 + r.z1) / 2); K.worldUV?.(f, 2.4); floorGeos.push(f);
    if (name === 'hall') continue;
    const c = new THREE.BoxGeometry(r.x1 - r.x0 + 0.3, 0.3, r.z1 - r.z0 + 0.3); c.translate((r.x0 + r.x1) / 2, r.h + 0.15, (r.z0 + r.z1) / 2); K.worldUV?.(c, 2.6); ceilGeos.push(c);
  }
  for (const d0 of DOORS) { const f = new THREE.BoxGeometry(d0.x1 - d0.x0 + 0.4, 0.2, d0.z1 - d0.z0 + 0.4); f.translate((d0.x0 + d0.x1) / 2, -0.1, (d0.z0 + d0.z1) / 2); K.worldUV?.(f, 2.4); floorGeos.push(f); }
  const floor = new THREE.Mesh(mergeGeometries(floorGeos), matFloor); floor.receiveShadow = true; scene.add(floor);
  const ceil = new THREE.Mesh(mergeGeometries(ceilGeos), matCeil); ceil.receiveShadow = true; scene.add(ceil);
  const HALL = ROOMS.hall;
  const deckObj = kit('deck', [{ w: HALL.x1 - HALL.x0, d: HALL.z1 - HALL.z0, h: HALL.h - 0.45, beamEvery: 6, beamD: 0.45, seed: 9 }], null);
  if (deckObj.children.length) { deckObj.position.set(0, 0, (HALL.z0 + HALL.z1) / 2); scene.add(deckObj); }
  else { const c = new THREE.Mesh(new THREE.BoxGeometry(36, 0.3, 20), matCeil); c.position.set(0, HALL.h + 0.15, 10); scene.add(c); }
  { const c = new THREE.Mesh(new THREE.BoxGeometry(36.4, 0.3, 20.4), matCeil); c.position.set(0, HALL.h + 0.2, 10); scene.add(c); }

  // ---------------------------------------------------------------- placement
  const place = (obj, x, z, rot = 0, y = 0) => {
    obj.position.set(x, y, z); obj.rotation.y = rot; scene.add(obj);
    const c0 = Math.cos(rot), s0 = Math.sin(rot);
    if (Array.isArray(obj.userData?.colliders)) for (const b of obj.userData.colliders) {
      const p = [[b.minX, b.minZ], [b.maxX, b.maxZ]].map(([lx, lz]) => [x + lx * c0 + lz * s0, z - lx * s0 + lz * c0]);
      colliders.push({ minX: Math.min(p[0][0], p[1][0]), maxX: Math.max(p[0][0], p[1][0]), minZ: Math.min(p[0][1], p[1][1]), maxZ: Math.max(p[0][1], p[1][1]) });
    } else if (obj.userData?.collider && y < 0.5) {
      const c = obj.userData.collider, sw = Math.abs(s0) > 0.5, w = sw ? c.d : c.w, dd = sw ? c.w : c.d;
      colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - dd / 2, maxZ: z + dd / 2 });
    }
    return obj;
  };
  const front = (rot, k) => V(Math.sin(rot) * k, 0, Math.cos(rot) * k);

  // columns through the hall
  for (const x of [-12, -6, 6, 12]) for (const z of [6, 14]) {
    place(kit('column', [{ h: HALL.h, w: 0.55, label: `D3-${x < 0 ? 'W' : 'E'}${Math.abs(x / 6)}${z < 10 ? 'A' : 'B'}` }], [0.55, HALL.h, 0.55]), x, z);
    const b = { minX: x - 0.28, maxX: x + 0.28, minZ: z - 0.28, maxZ: z + 0.28 }; colliders.push(b); sightBlockers.push(b);
  }
  // the rising main along the hall's north wall, and branch pipes overhead
  {
    const Pp = new THREE.Group();
    const galv = M.galvanized || fbMat, dark = M.steelDark || fbMat;
    const pipe = (a, b, r, m = galv) => { const dd = new THREE.Vector3().subVectors(b, a); const g = new THREE.CylinderGeometry(r, r, dd.length(), 24); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dd.clone().normalize())); g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); K.worldUV?.(g, 1.6); const me = new THREE.Mesh(g, m); me.castShadow = me.receiveShadow = true; Pp.add(me); };
    pipe(V(-18, 3.4, 19.2), V(18, 3.4, 19.2), 0.32);
    for (let x = -16; x <= 16; x += 4) { pipe(V(x, 3.4, 18.8), V(x, 3.4, 19.65), 0.42, dark); pipe(V(x, 0, 19.55), V(x, 3.0, 19.55), 0.05, dark); }
    pipe(V(18, 3.4, 19.2), V(28, 3.4, 19.2), 0.32); pipe(V(-28, 3.4, 15.3), V(-18, 3.4, 15.3), 0.28);
    pipe(V(-18, 3.4, 15.3), V(-18, 3.4, 19.2), 0.28);
    pipe(V(-1, 3.0, 20), V(-1, 3.0, 40), 0.26); pipe(V(1.1, 2.7, 20), V(1.1, 2.7, 30), 0.1, M.copper || dark);
    scene.add(Pp);
  }
  for (const z of [3.5, 17.5]) { const pr = kit('pipeRun', [{ length: 34, rise: 0.4, seed: z }], null); pr.position.set(0, HALL.h - 0.7, z); scene.add(pr); }
  { const dr = kit('ductRun', [{ length: 9.5, rise: 0.4, seed: 4, drop: false }], null); dr.position.set(23, ROOMS.gallery.h - 0.4, 14); scene.add(dr); }

  // ---------------------------------------------------------------- the lift (you arrive in it)
  const lift = place(kit('freightLift', [{ w: 2.6, d: 2.4, h: 2.8, wall: 0.3 }], null), 0, -5, R.N);
  lift.userData.dynamic = true;
  lift.userData.setDoors?.(0);

  // ---------------------------------------------------------------- pumps + panels
  const pumps = PUMPS.map((p, i) => {
    const obj = place(PP.pumpStation({ label: p.id, color: p.color }), p.at.x, p.at.z, p.rot);
    obj.userData.dynamic = true;
    const panel = PP.pumpPanel({ label: p.id, note: i === 0 ? 'DUTY 1 · START FIRST' : `DUTY ${i + 1} · NEEDS P${i} RUNNING` });
    panel.position.copy(p.panel); panel.rotation.y = p.prot; panel.userData.dynamic = true; scene.add(panel);
    panel.userData.setGreen(p.green[0], p.green[1]);
    const use = p.panel.clone().add(front(p.prot, 0.3));
    const sound = sfx.pumpLoop(V(p.at.x, 0.8, p.at.z), false);
    // station flood light (on when the pump runs; a lit zone it won't enter)
    const sp = new THREE.SpotLight(0xffe6c4, 0, 18, 0.95, 0.6, 1.7);
    sp.position.copy(p.light[0]); sp.target.position.copy(p.light[1]);
    sp.castShadow = true; sp.shadow.mapSize.set(1024, 1024); sp.shadow.bias = -0.0006; sp.shadow.normalBias = 0.03; sp.shadow.autoUpdate = false;
    scene.add(sp, sp.target);
    const lamp = place(kit('workLight', [{ on: false }], null), p.light[0].x, p.light[0].z, Math.atan2(p.light[1].x - p.light[0].x, p.light[1].z - p.light[0].z));
    lamp.userData.dynamic = true;
    return { ...p, i, obj, panel, use, sound, sp, lamp, state: 'idle', v: 0, t: 0 };
  });

  // ---------------------------------------------------------------- pressure door + stair
  const pdoor = place(PP.pressureDoor({ w: 1.2, h: 2.1 }), -5, -2.5, R.E);
  pdoor.userData.dynamic = true;
  const pdoorBox = { minX: -5.12, maxX: -4.88, minZ: -3.1, maxZ: -1.9 };
  const pdoorClosed = { ...pdoorBox };
  colliders.push(pdoorBox);
  const doorLamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), new THREE.MeshStandardMaterial({ color: 0x300808, emissive: 0xff2a1a, emissiveIntensity: 4 }));
  doorLamp.position.set(-4.82, 2.45, -1.55); doorLamp.userData.dynamic = true; scene.add(doorLamp);
  const doorLight = new THREE.PointLight(0xff2a1a, 1.4, 4, 2); doorLight.position.set(-4.6, 2.4, -1.55); scene.add(doorLight);
  // a flight of stairs going up out of the stair room (seen through the door)
  {
    const S = ROOMS.stair, g = [];
    for (let k = 0; k < 14; k++) { const b = new THREE.BoxGeometry(0.28, 0.18 * (k + 1), 1.5); b.translate(STAIR.x0 - 0.14 - k * 0.28, 0.09 * (k + 1), STAIR.zc); K.worldUV?.(b, 1); g.push(b); }
    const land = new THREE.BoxGeometry(STAIR.x0 - 14 * 0.28 - S.x0, STAIR.top, S.z1 - S.z0 - 0.6); land.translate((S.x0 + STAIR.x0 - 14 * 0.28) / 2, STAIR.top / 2, (S.z0 + S.z1 - 0.6) / 2); K.worldUV?.(land, 1); g.push(land);
    const st = new THREE.Mesh(mergeGeometries(g), M.concrete || fbMat); st.castShadow = st.receiveShadow = true; scene.add(st);
    // handrail on the open side of the flight
    const railM = M.yellowPaint || fbMat;
    for (let k = 0; k <= 14; k += 2) { const x = STAIR.x0 - 0.14 - k * 0.28, y0 = 0.18 * (k + 1); const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.95, 8), railM); post.position.set(x, y0 + 0.47, STAIR.z1 + 0.04); scene.add(post); }
    const rl = Math.hypot(14 * 0.28, 14 * 0.18), rail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, rl, 8), railM);
    rail.position.set(STAIR.x0 - 7 * 0.28, 7 * 0.18 + 1.0, STAIR.z1 + 0.04); rail.rotation.z = Math.PI / 2 - Math.atan2(0.18, 0.28); scene.add(rail);
    colliders.push({ minX: S.x0, maxX: STAIR.x0 - 1.3, minZ: STAIR.z1, maxZ: STAIR.z1 + 0.1 });
    const lit = new THREE.PointLight(0x9fc4ff, 1.4, 7, 2); lit.position.set(-8, 2.6, -2.5); scene.add(lit);
  }

  // ---------------------------------------------------------------- control room (dry, lit: it will not come in here)
  const CR = ROOMS.control;
  if (P.controlConsole) { try { place(P.controlConsole(), 9, -4.4, R.N); } catch (e) { console.warn(e); } }
  else place(fallback(2, 0.9, 0.7), 9, -4.4);
  place(model('plastic_monobloc_chair_01', null), 9.2, -3.2, Math.PI + 0.4);
  place(model('steel_frame_shelves_01', [1.1, 2.1, 0.5]), 12.6, -2.5, R.W);
  place(model('metal_office_desk', [2, 0.8, 0.95]), 6.4, -1.0, R.E);
  const logBook = place(model('binder_notebook', [0.5, 0.05, 0.3]), 6.4, -1.2, 0.3, 0.79);
  const crLight = new THREE.PointLight(0xd8e6ff, 3.5, 9, 1.6); crLight.position.set(9, 2.7, -2.5); scene.add(crLight);
  const tube = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdde8ff, emissiveIntensity: 1.6 })); tube.position.set(9, 2.95, -2.5); scene.add(tube);
  // the schematic + a live mimic board on the back wall
  const mimicCanvas = document.createElement('canvas'); mimicCanvas.width = 768; mimicCanvas.height = 384;
  const mimicTex = new THREE.CanvasTexture(mimicCanvas); mimicTex.colorSpace = THREE.SRGBColorSpace;
  const mimic = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshStandardMaterial({ map: mimicTex, emissiveMap: mimicTex, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.5 }));
  mimic.position.set(9, 1.75, -4.83); mimic.userData.dynamic = true; scene.add(mimic);
  function drawMimic() {
    const c = mimicCanvas.getContext('2d'), w = 768, h = 384;
    c.fillStyle = '#1d2a24'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#7fa89a'; c.lineWidth = 8;
    c.beginPath(); c.moveTo(60, 300); c.lineTo(708, 300); c.moveTo(384, 300); c.lineTo(384, 90); c.stroke();
    c.font = 'bold 26px monospace'; c.textAlign = 'center'; c.fillStyle = '#cfe3da';
    c.fillText('D-3 DRAINAGE · RISING MAIN', w / 2, 40);
    const spots = [[620, 300, 'P1 EAST'], [150, 300, 'P2 WEST'], [384, 110, 'P3 NORTH']];
    spots.forEach(([x, y, l], k) => {
      const on = CH.pumps[k], st = pumps[k]?.state;
      c.fillStyle = on ? '#3cff70' : st === 'priming' ? '#ffb020' : st === 'blown' ? '#ff3020' : '#3a3f3c';
      c.beginPath(); c.arc(x, y, 30, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#cfe3da'; c.lineWidth = 3; c.stroke();
      c.fillStyle = '#cfe3da'; c.font = 'bold 22px monospace'; c.fillText(l, x, y + 62);
    });
    const lvl = water ? water.level : WATER[0];
    c.fillStyle = '#cfe3da'; c.font = '20px monospace'; c.textAlign = 'left';
    c.fillText(`SUMP LEVEL ${(lvl * 100).toFixed(0)} cm`, 40, 360);
    c.fillStyle = '#0d1512'; c.fillRect(300, 340, 300, 24); c.fillStyle = lvl > 0.05 ? '#ff9a2a' : '#3cff70'; c.fillRect(300, 340, 300 * Math.min(1, lvl / 0.55), 24);
    c.textAlign = 'right'; c.fillStyle = lvl > 0.05 ? '#ff9a2a' : '#3cff70'; c.fillText(lvl > 0.05 ? 'STAIR B: HEAD OF WATER' : 'STAIR B: CLEAR', 740, 360);
    mimicTex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- dressing
  // pallets and drums standing in the water, floating boxes, debris under the surface
  place(kit('pallet', [{ load: 'cement', seed: 21 }], [1.2, 0.7, 1]), 14.5, 2.4, 0.3);
  place(kit('pallet', [{ load: 'blocks', seed: 22 }], [1.2, 0.7, 1]), -14.2, 17.6, -0.2);
  place(kit('pallet', [{ load: 'pipes', seed: 23 }], [1.2, 0.5, 2.4]), -9, 2.6, R.E);
  const crowbarCrate = place(kit('pallet', [{ load: 'drywall', seed: 24 }], [1.2, 0.5, 1]), 20.2, 10.7, 0);
  place(model('propane_tank', null), 27.2, 2.8, 0); place(model('propane_tank', null), 26.7, 2.7, 0.7);
  place(model('metal_tool_chest', null), -27.2, 15.2, R.E);
  place(model('hand_truck', null), 3.8, 18.6, 0.5);
  place(model('steel_frame_shelves_01', [1.1, 2.1, 0.5]), 7.6, 34.5, R.W); place(model('steel_frame_shelves_01', [1.1, 2.1, 0.5]), 7.6, 35.7, R.W);
  place(kit('barrier', [], [2, 1, 0.3]), 16.2, 6.4, R.E);
  place(kit('scaffold', [{ w: 2.4, d: 1.2, h: 3.4, levels: 2 }], [2.4, 3.4, 1.2]), -9.5, 18.6, 0);
  for (const [x, z, s] of [[-6, 2, 1], [8, 12, 2], [-12, 10, 3], [0, 34, 4], [23, 20, 5], [-23, 8, 6]]) { const db = kit('debris', [{ w: 8, d: 6, seed: s, density: 0.7 }], null); db.position.set(x, 0, z); scene.add(db); }
  const floaters = [];
  for (const [x, z, id] of [[-3.5, 3.2, 'cardboard_box_01'], [7.5, 9, 'cardboard_box_01'], [-14, 4.5, 'plastic_crate_03'], [12, 16, 'cardboard_box_01'], [21, 18, 'trashbag'], [-2.6, -3.6, 'plastic_jerrycan']]) {
    const m = model(id, null); m.position.set(x, 0, z); m.rotation.y = Math.random() * 6; m.userData.dynamic = true; scene.add(m);
    floaters.push({ m, x, z, ph: Math.random() * 6, drift: V(Math.random() - 0.5, 0, Math.random() - 0.5).multiplyScalar(0.03) });
  }
  // cable trays along the gallery walls, one of them down across Halloran
  for (const [x, z, rot, y] of [[23, 23.6, 0, 2.6], [23, 12.4, 0, 2.6], [18.4, 18, Math.PI / 2, 2.4], [27.6, 15, Math.PI / 2, 2.4]]) { const t = PP.cableTray({ length: 8.5, seed: x + z }); t.position.set(x, y, z); t.rotation.y = rot; scene.add(t); }
  const fallen = PP.cableTray({ length: 3.6, seed: 9, cables: 9 });
  fallen.position.set(25.6, 0.62, 22.5); fallen.rotation.set(0, 0.35, -0.42); fallen.userData.dynamic = true; scene.add(fallen);
  colliders.push({ minX: 24, maxX: 27.4, minZ: 21.9, maxZ: 23.2 });
  const halloran = PP.pinnedMan(); halloran.position.set(26.2, 0, 23.55); halloran.rotation.y = Math.PI; halloran.userData.dynamic = true; scene.add(halloran);
  const halTorch = new THREE.SpotLight(0xfff0d0, 0, 7, 0.45, 0.6, 2); halTorch.position.set(25.4, 0.65, 22.6); halTorch.target.position.set(22.5, 0.2, 18.5); scene.add(halTorch, halTorch.target);
  const torchMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.22, 10).rotateZ(Math.PI / 2), M.plasticBlack || fbMat); torchMesh.position.set(25.4, 0.6, 22.6); torchMesh.rotation.y = 0.9; scene.add(torchMesh);
  // emergency lighting (amber), a few on, one failing
  const emerg = [];
  for (const [x, y, z, rot, inten, flick] of [[0, 2.7, -4.85, R.N, 3.2, 0], [-17.85, 3.2, 4, R.E, 3.5, 0], [17.85, 3.2, 12, R.W, 3, 1], [0, 2.6, 29.85, R.S, 2.6, 0], [27.85, 2.6, 18, R.W, 2.2, 2]]) {
    const e = PP.emergencyLight(); e.position.set(x, y, z); e.rotation.y = rot; e.userData.dynamic = true; scene.add(e);
    const l = new THREE.PointLight(0xffb468, inten * 1.8, 12, 1.7); l.position.copy(V(x, y - 0.25, z).add(front(rot, 0.4))); scene.add(l);
    emerg.push({ e, l, base: inten * 1.8, flick });
  }
  // caged lamps on the emergency circuit, hanging in the hall: pools of dirty light on the water
  const bulbMatOn = new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffb060, emissiveIntensity: 2 });
  for (const [x, z, inten, flick] of [[-9, 9.5, 13, 0], [8.5, 4.5, 11, 0], [3, 16, 10, 2], [-3, -2.4, 7, 0], [23, 18, 6, 1]]) {
    const top = x > 18 ? ROOMS.gallery.h : z < 0 ? ROOMS.lobby.h : HALL.h - 0.45, y = Math.min(top - 0.9, 3.3);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, top - y, 5), M.plasticBlack || fbMat); cord.position.set(x, (top + y) / 2 + 0.1, z); scene.add(cord);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.16, 18, 1, true), M.steelPaint || fbMat); shade.position.set(x, y + 0.12, z); shade.material.side = THREE.DoubleSide; scene.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), bulbMatOn); bulb.position.set(x, y + 0.03, z); bulb.userData.dynamic = true; scene.add(bulb);
    const l = new THREE.PointLight(0xffbf78, inten, 16, 1.6); l.position.set(x, y - 0.05, z); scene.add(l);
    emerg.push({ e: bulb, l, base: inten, flick });
  }
  // lockers to hide in
  const lockers = [];
  for (const [x, z, rot] of [[4.55, -4.55, R.N], [-17.6, 17, R.E], [27.6, 10.6, R.W], [-7.6, 38.6, R.E], [18.45, 21.5, R.E], [-27.6, 7.2, R.E]]) {
    const l = place(kit('lockerHide', [], [0.55, 2, 0.55]), x, z, rot); l.userData.dynamic = true; lockers.push(l);
  }
  // pickups: halide cells, the crowbar, documents
  const cellSpots = [V(10.2, 0.95, -4.3), V(-27.2, 0.7, 15.2), V(7.6, 1.18, 35.1)];
  const cellMeshes = cellSpots.map((p, i) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.08), new THREE.MeshStandardMaterial({ color: 0x23272a, roughness: 0.5, metalness: 0.4 })));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.162, 0.025, 0.082), new THREE.MeshStandardMaterial({ color: 0xe0b020, emissive: 0x3a2a00, roughness: 0.4 })));
    g.position.copy(p); g.userData.dynamic = true; scene.add(g);
    if (CH.cells.includes(i)) g.visible = false;
    return g;
  });
  const crowbar = model('crowbar_01', null); crowbar.rotation.set(Math.PI / 2, 0, 0.4); crowbar.position.set(20.2, 0.47, 10.7); crowbar.userData.dynamic = true; scene.add(crowbar);
  if (CH.crowbar) crowbar.visible = false;
  const orderDoc = place(model('clipboard', null), -26.9, 15.2, R.E, 0.66);
  const photo = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.11), new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.3 })); photo.rotation.x = -Math.PI / 2; photo.position.set(-3.6, 0, -2.2); photo.userData.dynamic = true; scene.add(photo);

  // ---------------------------------------------------------------- water
  const wetRects = [];
  for (const [, r] of roomList) if (!r.dry) wetRects.push(r);
  for (const d0 of DOORS) if (!d0.pressure && !(d0.z1 < -4.6) && !(d0.x0 > 4.6 && d0.z1 < 0)) wetRects.push({ x0: d0.x0 - 0.2, x1: d0.x1 + 0.2, z0: d0.z0 - 0.2, z1: d0.z1 + 0.2 });
  const water = new Water(scene, wetRects, { level: WATER[pumpsOn()] });
  let waterTarget = water.level;
  const inWater = (x, z) => water.level > 0.02 && wetRects.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);

  // ---------------------------------------------------------------- lighting
  const hemi = new THREE.HemisphereLight(0x46566a, 0x0c0e0c, game.params.has('bright') ? 3 : 0.8); scene.add(hemi);
  game.flashlight.base = 105; game.flashlight.light.angle = 0.5; game.flashlight.light.distance = 34;
  const lit = new Set();
  const ZONES = { east: [ROOMS.east], west: [ROOMS.west], north: [ROOMS.north], control: [ROOMS.control], stair: [ROOMS.stair] };
  lit.add('control'); lit.add('stair');
  const isLit = (x, z) => { for (const zn of lit) for (const r of ZONES[zn]) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return true; return false; };

  // ---------------------------------------------------------------- navigation
  const grid = new NavGrid({ x0: -29, x1: 29, z0: -8, z1: 41 }, 0.5);
  grid.carve([...roomList.filter(([n]) => n !== 'car' && n !== 'stair').map(([, r]) => r), ...DOORS.filter((d0) => !d0.pressure && !(d0.z1 < -4.6))]);
  for (const c of colliders) grid.addBox(c, { pad: 0.15, opaque: false });
  for (const s of sightBlockers) grid.addBox(s, { block: false, opaque: true });
  const patrol = [
    { x: 0, z: 10, look: true }, { x: -14, z: 4 }, { x: -23, z: 9, mode: 'crawl' }, { x: -12, z: 17 }, { x: 0, z: 25 },
    { x: -4, z: 34, look: true }, { x: 5, z: 37 }, { x: 10, z: 17, mode: 'crawl' }, { x: 21, z: 16 }, { x: 25, z: 19, look: true },
    { x: 14, z: 4 }, { x: 0, z: -2.5, mode: 'crawl' }, { x: 24, z: 4 },
  ];

  // ---------------------------------------------------------------- reflections on the water
  // medium and up: a planar reflection of the room (lights, lit doorways, and whatever stands in the water);
  // always: an environment captured once from the middle of the hall for the surface's sheen
  const quality = game.settings?.quality || 'high';
  let reflection = null;
  if (quality !== 'low') reflection = addFloorReflection(scene, renderer, [water.mesh.material], { y: water.level, size: 80, strength: 0.38, scale: quality === 'ultra' ? 0.55 : quality === 'high' ? 0.4 : 0.3, every: quality === 'medium' ? 2 : 1 });
  if (reflection) reflection.reflector.position.set(0, water.level - 0.001, 16);
  function captureEnv() {
    try {
      const rt = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
      const cam = new THREE.CubeCamera(0.1, 60, rt); cam.position.set(0, 1.6, 9); scene.add(cam);
      water.mesh.visible = false; cam.update(renderer, scene); water.mesh.visible = water.level > 0.015;
      const pm = new THREE.PMREMGenerator(renderer); const env = pm.fromCubemap(rt.texture).texture; pm.dispose(); rt.dispose(); cam.removeFromParent();
      water.mesh.material.envMap = env; water.mesh.material.envMapIntensity = 0.45; water.mesh.material.needsUpdate = true;
    } catch (e) { console.warn('env capture', e); }
  }

  // ---------------------------------------------------------------- performance
  game.batch(scene);
  for (const p of pumps) p.sp.shadow.needsUpdate = true;

  // ---------------------------------------------------------------- the creature
  const gltf = await loadCreatureModel((p) => game.onProgress?.(p));
  const B = Creature.spawn(gltf); B.object.scale.setScalar(0.93);
  B.object.position.set(-23, 0, 8); scene.add(B.object); B.object.updateMatrixWorld(true);
  B.attach({ colliders: [], bounds: { min: V(-28, 0, -5), max: V(28, 0, 40) } });
  const blockB = creatureBlockers(B);
  player.colliders = colliders;
  player.groundAt = stairGround;
  player.blockers = () => (B.object.visible ? blockB() : []);
  const hunter = new Hunter({ creature: B, grid, game, patrol, isLit, onKill: () => die(), hunt: 0.45 });
  hunter.script(true); hunter.aggression = 0.95;
  B.object.visible = false;

  // ---------------------------------------------------------------- the lamp
  const lampModel = P.halideLamp ? P.halideLamp() : new THREE.Group();
  const lamp = new HalideLamp(game, lampModel, { cells: 3, recharge: 11 });
  lamp.give();
  lamp.targets.push({ point: () => B.bone.upperChest.getWorldPosition(V(0, 0, 0)), onFlash: (dist) => { if (B.object.visible && hunter.flashHit(dist)) CH.flashes = (CH.flashes || 0) + 1; } });
  game.flashlight.on = true;

  // footsteps: in the water every step is a splash, and a ripple
  player.onStep = (p, run) => {
    const wetHere = inWater(p.x, p.z);
    sfx.footstep(undefined, wetHere ? 'water' : 'concrete', { run, player: true });
    if (wetHere) water.ripple(p.x, p.z, run ? 1.3 : player.crouch ? 0.35 : 0.8);
    const k = wetHere ? water.level / 0.55 : 0;
    hunter.noise(p, run ? 13 + k * 6 : player.crouch ? 1.4 + k : 4 + k * 3);
  };

  // ---------------------------------------------------------------- hiding (as in Chapter One)
  let hidden = null;
  function hide(l) {
    const enteringSeen = hunter.state === 'chase' && hunter.playerVisibility() > 0;
    hidden = { locker: l };
    const inside = l.userData.inside ? l.localToWorld(l.userData.inside.clone()) : l.position.clone().add(V(0, 1.5, 0));
    l.userData.setOpen?.(1); sfx.metalImpact(l.position, 0.3);
    player.frozen = true; player.pos.set(inside.x, 0, inside.z); player.eyeOverride = inside.y;
    player.yaw = l.rotation.y + Math.PI; player.pitch = -0.05;
    hunter.playerHidden = true; hunter.sawHide = enteringSeen;
    game.flashlight.on = false; ui.hiding(true); lampModel.visible = false;
    setTimeout(() => l.userData.setOpen?.(0), 400);
  }
  function unhide() {
    const l = hidden.locker;
    l.userData.setOpen?.(1); setTimeout(() => l.userData.setOpen?.(0), 600);
    const f = front(l.rotation.y, 0.8).add(l.position);
    player.pos.set(f.x, 0, f.z); player.eyeOverride = null; player.frozen = false;
    hunter.playerHidden = false; hunter.sawHide = false; ui.hiding(false); hidden = null; lampModel.visible = true;
  }
  for (const l of lockers) interact.add({ position: () => l.position.clone().add(V(0, 1.3, 0)), label: () => (hidden ? 'Leave locker' : 'Hide in locker'), reach: 1.8, size: 0.5, onUse: () => (hidden ? unhide() : hide(l)), enabled: () => !hidden || hidden.locker === l });

  // ---------------------------------------------------------------- objectives
  function objectiveText() {
    if (CH.done) return 'Go up the stair.';
    const n = pumpsOn();
    if (n === 3) return water.level > 0.05 ? 'Wait for the level to drain.' : 'Open the pressure door to Stair B.';
    const next = ['P1 (east)', 'P2 (west)', 'P3 (north)'][n];
    let t = `Start the drainage pumps in order (${n}/3) · next: ${next}`;
    if (CH.met && !CH.halloran) t += ' · Halloran is pinned in the cable gallery';
    return t;
  }
  const refreshObjective = () => { ui.objective(objectiveText()); drawMimic(); };

  // ---------------------------------------------------------------- pumps: prime, watch the needle, close the bleed in the green
  let busy = false;
  for (const p of pumps) {
    interact.add({
      position: p.use, reach: 2.0, size: 0.45,
      label: () => {
        if (CH.pumps[p.i]) return `${p.id} running`;
        if (p.i > 0 && !CH.pumps[p.i - 1]) return `${p.id}: no suction head (start P${p.i} first)`;
        if (p.state === 'priming') return 'Close the bleed valve';
        if (p.state === 'blown') return `${p.id}: relief valve resetting…`;
        return `Open the prime on ${p.id}`;
      },
      enabled: () => !CH.pumps[p.i],
      onUse: () => usePump(p),
    });
  }
  function usePump(p) {
    if (p.i > 0 && !CH.pumps[p.i - 1]) { sfx.beep('deny'); if (!CH.toldOrder) { CH.toldOrder = true; game.run(() => say(OK, 'Not that one yet. They go east, west, north. Otherwise it cavitates and trips.')); } return; }
    if (p.state === 'blown') { sfx.beep('deny'); return; }
    if (p.state === 'idle') {
      p.state = 'priming'; p.v = 0; p.t = 0; p.panel.userData.setLamp('amber');
      sfx.valveHiss(p.use, { dur: 1.4, strength: 0.6 }); sfx.pipeGroan(p.at, { dur: 2 });
      hunter.noise(p.use, 10);
      if (!CH.toldNeedle) { CH.toldNeedle = true; ui.toast('Close the bleed valve [E] while the needle is in the GREEN', 4.5); }
      drawMimic();
      return;
    }
    if (p.state === 'priming') {
      const inGreen = p.v >= p.green[0] && p.v <= p.green[1];
      p.panel.userData.handle.rotation.z = -Math.PI / 2;
      if (inGreen) { game.run(() => pumpStarts(p)); return; }
      // too early: the prime dumps back
      p.state = 'idle'; p.panel.userData.setLamp('off'); sfx.valveHiss(p.use, { dur: 2.2, strength: 0.9 }); hunter.noise(p.use, 14);
      ui.toast('TOO EARLY · THE PRIME DUMPED BACK', 2.5); setTimeout(() => { p.panel.userData.handle.rotation.z = 0; }, 800);
      drawMimic();
    }
  }
  function blowRelief(p) {
    p.state = 'blown'; p.panel.userData.setLamp('red');
    sfx.metalImpact(p.at, 2.2); sfx.valveHiss(V(p.at.x, 2.0, p.at.z), { dur: 4, strength: 1 }); sfx.pipeGroan(p.at, { dur: 3, depth: 1.6 });
    hunter.noise(p.at, 30);
    player.shake = Math.max(player.shake, 0.6);
    ui.toast('RELIEF VALVE LIFTED', 2.5); drawMimic();
    game.run(async () => {
      if (!CH.toldRelief) { CH.toldRelief = true; await say(OK, 'That was the relief valve. Everything down there heard it. Move, Rook. Then try again.'); }
      await d.wait(4); p.state = 'idle'; p.v = 0; p.panel.userData.setLamp('off'); p.panel.userData.setNeedle(0); drawMimic();
    });
  }
  async function pumpStarts(p) {
    p.state = 'running'; CH.pumps[p.i] = true;
    p.panel.userData.setLamp('green'); p.obj.userData.setRunning?.(true); p.sound.set(true);
    sfx.powerUp(); hunter.noise(p.at, 16);
    p.sp.intensity = 65; p.sp.shadow.needsUpdate = true; p.lamp.userData.setOn?.(true); lit.add(p.room);
    waterTarget = WATER[pumpsOn()];
    setTimeout(captureEnv, 300);
    checkpoint(); refreshObjective();
    const n = pumpsOn();
    if (n === 1) {
      await say(OK, 'P1\'s on the main. I can see the level moving. Barely, but it\'s moving.');
      await d.wait(1.0);
      if (!CH.wake) await wakeScene();
    } else if (n === 2) {
      await say(OK, 'Two. Halfway there.');
      if (!CH.halloran) await halloranLost();
    } else if (n === 3) {
      await say(OK, 'That\'s all three. It\'ll take a minute to pull the level down below the door sill.');
      if (CH.halloran === 'saved') { await d.wait(2); await say(HALR, 'Doctor. It\'s Halloran. I\'m on the stair landing. The water\'s going.'); await say(HALR, 'Your thing came through here an hour ago. Went past me in the dark. Didn\'t even look.'); await say(HALR, 'Watch the archive. That\'s where it was headed.'); }
    }
  }

  // ---------------------------------------------------------------- the wake: something crossing the hall, under the surface
  async function wakeScene() {
    CH.wake = true;
    const path = [V(-16, 0, 11), V(-6, 0, 10), V(5, 0, 8.6), V(12.5, 0, 7.2)];
    sfx.setTension(0.6);
    await say(OK, 'Rook. Your mic\'s picking up water moving. It isn\'t you.', 3.4);
    let pos = path[0].clone(), seg = 1, t = 0, sndT = 0;
    while (seg < path.length) {
      const dt = await d.frame();
      t += dt; sndT -= dt;
      const to = path[seg], dir = to.clone().sub(pos); const L = dir.length();
      if (L < 0.1) { seg++; continue; }
      pos.addScaledVector(dir.normalize(), Math.min(L, dt * 1.35));
      if ((t * 5 | 0) !== ((t - dt) * 5 | 0)) water.ripple(pos.x + (Math.random() - 0.5) * 0.4, pos.z + (Math.random() - 0.5) * 0.4, 1.6);
      if (sndT <= 0) { sndT = 0.85; sfx.wade(V(pos.x, 0.4, pos.z), { speed: 0.6, dur: 1.0 }); }
    }
    // it stops, a few metres from the doorway. The surface goes still. Then it turns away.
    sfx.setTension(0.85); sfx.heartbeat(95);
    await d.wait(3.2);
    sfx.creatureBreath(V(pos.x, 0.5, pos.z), { intensity: 0.3 });
    await d.wait(1.4);
    const away = [V(8, 0, 13), V(2, 0, 19), V(0, 0, 26)];
    seg = 0;
    while (seg < away.length) {
      const dt = await d.frame();
      const to = away[seg], dir = to.clone().sub(pos); const L = dir.length();
      if (L < 0.1) { seg++; continue; }
      pos.addScaledVector(dir.normalize(), Math.min(L, dt * 1.6));
      if (Math.random() < dt * 6) water.ripple(pos.x, pos.z, 1.4);
      if (Math.random() < dt * 1.2) sfx.wade(V(pos.x, 0.4, pos.z), { speed: 0.7, dur: 0.9 });
    }
    sfx.heartbeat(0); sfx.setTension(0.35);
    await say(OK, '...It went north. Rook, it\'s in the water with you. From here on, assume it can hear every step.');
    // from here, it hunts
    const sp = grid.nearestWalkable(0, 34); B.object.position.set(sp.x, 0, sp.z);
    B.object.visible = true; hunter.script(false); hunter.set('idle');
    checkpoint();
  }

  // ---------------------------------------------------------------- Halloran
  let halloranBusy = false;
  async function meetHalloran() {
    CH.met = true; refreshObjective();
    halTorch.intensity = 6;
    await say(HAL, 'Hey. Hey! Over here. Don\'t—not in my eyes. Please.');
    await say(HAL, 'Halloran. Night security. The tray came down when the main burst. I can\'t feel my left leg, and I\'ve been listening to that thing swim laps for two hours.');
    await say(OK, 'Rook. Leave him.', 2.0);
    await say(OK, 'Getting that tray off him is going to sound like a dinner gong. It will come, and you won\'t make it out of that gallery. I\'m sorry. I\'m not asking.', 6);
    await say(HAL, 'Is that Okafor? Tell her I can hear her.');
    if (!CH.crowbar) await say(HAL, 'There\'s a bar in the east pump room. On the pallet. If you\'re going to do it, do it with that.');
  }
  async function freeHalloran() {
    if (halloranBusy || CH.halloran) return;
    if (!CH.crowbar) { sfx.beep('deny'); ui.toast('You need something to lever the tray with', 2.5); return; }
    halloranBusy = true; busy = true;
    player.frozen = true; player.lookAt(V(25.6, 0.5, 22.4), 2.5);
    await say(HAL, 'On three. One, two—');
    const heaves = [0.08, 0.16, 0.26, 0.42];
    for (let k = 0; k < heaves.length; k++) {
      sfx.metalImpact(V(25.6, 0.7, 22.5), 1.3 + k * 0.2); sfx.splash(V(25.6, 0.5, 22.5), 0.8);
      water.ripple(25.6, 22.5, 1.5); player.shake = Math.max(player.shake, 0.4);
      hunter.noise(V(25.6, 0, 22.5), 60);
      fallen.rotation.z = -0.42 + heaves[k]; fallen.position.y = 0.62 + heaves[k] * 0.9;
      if (k === 1) await say(HAL, 'It\'s moving—keep going—', 2.2);
      else await d.wait(1.3);
    }
    // it's coming: make sure of it
    if (B.object.visible) { hunter.lastSeen = V(25, 0, 21); hunter.suspicion = 0.95; hunter.investigateAt(V(22, 0, 17)); }
    sfx.splash(V(26, 0.4, 23), 1.5);
    CH.halloran = 'saved'; save.set('mercy', (save.get('mercy', 0) || 0) + 1);
    halloran.position.set(26.9, 0, 23.4); halloran.rotation.y = Math.PI - 0.6;
    player.frozen = false; player.releaseLook(); busy = false;
    lamp.refill();
    checkpoint(); refreshObjective();
    await say(HAL, 'Okay. Okay. Take this, it\'s a lamp cell, it was in my kit. Go. I\'ll crawl.', 3.2);
    await say(HAL, 'Listen. Before the main went, I was down by the adit. I saw it in there.');
    await say(HAL, 'It was putting things in rows. Chairs. Files. Mugs. Like it was trying to remember an office.', 5);
    await say(OK, '...', 1.5);
    await say(OK, 'Move, Rook.');
    halloranBusy = false;
    // he drags himself into the corner and keeps very still; after a while he is gone
    setTimeout(() => { halloran.visible = false; halTorch.intensity = 0; torchMesh.visible = false; }, 60000);
  }
  async function halloranLost() {
    CH.halloran = 'left'; save.set('obedience', (save.get('obedience', 0) || 0) + 1);
    checkpoint();
    if (!CH.met) return;
    await d.wait(6);
    sfx.radio?.(1.2);
    await say(HALR, 'Doctor? Is anyone still on this—', 2.4);
    await say(HALR, 'It\'s in the gallery. It\'s just standing there. It\'s looking at my torch.', 4);
    await say(HALR, 'Oh, God. Oh—', 1.6);
    sfx.radio?.(2.5);
    halloran.visible = false; halTorch.intensity = 0;
    await d.wait(2.5);
    await say(OK, 'You made the right call, Rook.', 3.2);
  }

  // ---------------------------------------------------------------- interactions
  interact.add({ position: () => crowbar.position.clone().add(V(0, 0.1, 0)), label: 'Take the pry bar', reach: 1.9, size: 0.4, enabled: () => !CH.crowbar, onUse: () => { CH.crowbar = true; crowbar.visible = false; sfx.metalImpact(crowbar.position, 0.25); ui.toast('PRY BAR', 2); checkpoint(); } });
  interact.add({ position: V(25.6, 0.8, 22.4), label: () => (CH.crowbar ? 'Lever the tray off Halloran (loud)' : 'Lift the tray (you need a lever)'), reach: 2.2, size: 0.6, enabled: () => CH.met && !CH.halloran && !halloranBusy, onUse: () => game.run(freeHalloran) });
  interact.add({ position: V(26.2, 1.0, 23.4), label: '“I\'ll come back for you.”', reach: 2.4, size: 0.35, enabled: () => CH.met && !CH.halloran && !halloranBusy, onUse: () => { game.run(async () => { await say(HAL, 'Sure. Sure you will.', 2.4); await say(OK, 'Thank you, Rook.', 2.2); }); CH.halloran = 'left'; save.set('obedience', (save.get('obedience', 0) || 0) + 1); refreshObjective(); checkpoint(); } });
  interact.add({ position: V(9, 1.75, -4.75), label: 'Read the schematic', reach: 2.6, size: 0.8, onUse: async () => { if (!CH.docs.includes('schematic')) CH.docs.push('schematic'); await ui.readDoc(DOCS.schematic, game.input); if (!CH.seenSchematic) { CH.seenSchematic = true; refreshObjective(); } } });
  interact.add({ position: () => logBook.position.clone().add(V(0, 0.1, 0)), label: 'Read the maintenance log', reach: 1.9, size: 0.4, onUse: () => { if (!CH.docs.includes('log')) CH.docs.push('log'); ui.readDoc(DOCS.log, game.input); } });
  interact.add({ position: () => orderDoc.position.clone().add(V(0, 0.1, 0)), label: 'Read the work order', reach: 1.9, size: 0.4, onUse: () => { if (!CH.docs.includes('order')) CH.docs.push('order'); ui.readDoc(DOCS.order, game.input); } });
  interact.add({ position: () => photo.position.clone().add(V(0, 0.05, 0)), label: 'Pick up the photograph', reach: 1.8, size: 0.3, enabled: () => photo.visible || CH.docs.includes('photo'), onUse: () => { if (!CH.docs.includes('photo')) CH.docs.push('photo'); ui.readDoc(DOCS.photo, game.input); } });
  cellMeshes.forEach((m, i) => interact.add({ position: () => m.position, label: 'Take halide cell', reach: 1.8, size: 0.25, enabled: () => m.visible, onUse: () => { m.visible = false; CH.cells.push(i); lamp.refill(); ui.toast('HALIDE CELL · LAMP RECHARGED', 2.5); } }));
  let doorOpen = 0, doorOpening = false;
  interact.add({ position: V(-4.75, 1.2, -2.5), reach: 2.0, size: 0.5, label: () => (water.level > 0.05 ? 'Pressure door (head of water: will not open)' : 'Open the pressure door'), enabled: () => !doorOpening, onUse: () => { if (water.level > 0.05) { sfx.beep('deny'); return; } game.run(openPressureDoor); } });

  async function openPressureDoor() {
    doorOpening = true;
    sfx.metalImpact(V(-5, 1.2, -2.5), 1.4); await d.wait(0.6); sfx.valveHiss(V(-5, 1.0, -2.5), { dur: 1.6, strength: 0.6 }); sfx.doorSlide(V(-5, 1, -2.5), { heavy: true });
    const T0 = d.t;
    await d.until(() => { doorOpen = Math.min(1, (d.t - T0) / 2.6); pdoor.userData.setOpen(doorOpen); return doorOpen >= 1; });
    Object.assign(pdoorBox, { minX: 1e6, maxX: 1e6 });
    CH.done = true; refreshObjective(); checkpoint();
    await say(OK, 'Stair B. It comes out in the archive. Go, Rook. Don\'t look back down.', 4);
    await d.until(() => player.groundY > 1.7);
    await endChapter();
  }
  async function endChapter() {
    player.frozen = true; hunter.script(true);
    player.lookAt(V(-11, 4.4, -2.0), 1.2);
    sfx.setTension(0.2);
    await ui.fadeTo(1, 2.5);
    for (const p of pumps) p.sound.stop?.(1);
    save.set('chapter', 3); save.set('ch2', null);
    save.set('halloran', CH.halloran || 'left');
    save.set('truth', (save.get('truth', 0) || 0) + CH.docs.filter((k) => k !== 'schematic').length);
    await say(OK, 'Before you go up. That photograph you picked up, if you did. It\'s an old one. Things were different.', 4.6);
    const { chapter3 } = await import('./chapter3.js');
    await game.load(chapter3, {});
  }

  // ---------------------------------------------------------------- death
  async function die() {
    if (CH.dead) return; CH.dead = true;
    sfx.creatureScream(game.camera.position, { dur: 1.2 }); sfx.stinger('hit');
    ui.red(true); ui.setFade(1); player.frozen = true;
    await new Promise((r) => setTimeout(r, 900));
    ui.red(false); if (hidden) ui.hiding(false);
    for (const p of pumps) p.sound.stop?.(0.2);
    const msg = hunter.sawHide ? 'It saw where you went.' : 'Walk, don\'t wade. Every splash carries. Flash it when it gets close.';
    await ui.death('YOU WERE TAKEN', msg, game.input);
    const st = save.get('ch2') || {};
    game.load(chapter2, { state: { ...st, dead: false }, restart: true });
  }

  // ---------------------------------------------------------------- the script
  async function opening() {
    if (!(opts.restart && CH.wake)) player.place(0, -6.5, Math.PI, 0);
    ui.setFade(1);
    sfx.setAmbience('flooded', 0.95, 3); sfx.setReverb('large');
    if (!opts.restart) {
      await ui.card('CHAPTER TWO', 'PUMP LEVEL', 4);
      ui.fadeTo(0, 3);
      await d.wait(2.0);
      sfx.beep('ok');
      await say(OK, 'Rook? The car\'s stopped. D-3. Pump level.');
      // the doors grind open onto black water
      sfx.doorSlide(V(0, 1, -5), { heavy: true });
      const T0 = d.t;
      await d.until(() => { const k = Math.min(1, (d.t - T0) / 3.2); lift.userData.setDoors?.(k); return k >= 1; });
      await d.wait(1.2);
      await say(OK, 'Is that water? ...The rising main must have gone. Or it broke it on the way down.');
      await say(OK, 'All right. There\'s a stair up to the archive level, behind a pressure door on your left. It won\'t open with that much water against it.');
      await say(OK, 'Three drainage pumps: east, west, north. The control room\'s on your right. There\'s a schematic on the wall.');
      await say(OK, 'And Rook. Walk. Don\'t wade fast. Water carries sound further than you\'d think.');
    } else { lift.userData.setDoors?.(1); ui.fadeTo(0, 1.5); }
    refreshObjective();
  }
  async function watchHalloran() {
    await d.until(() => !CH.met && !CH.halloran && player.pos.x > 19 && player.pos.z > 14);
    await meetHalloran();
  }

  // restore a checkpoint
  for (const p of pumps) if (CH.pumps[p.i]) { p.state = 'running'; p.panel.userData.setLamp('green'); p.panel.userData.setNeedle(0.7); p.obj.userData.setRunning?.(true); p.sound.set(true); p.sp.intensity = 65; p.lamp.userData.setOn?.(true); lit.add(p.room); }
  water.setLevel(WATER[pumpsOn()]); waterTarget = water.level;
  if (CH.halloran === 'saved') { halloran.position.set(26.9, 0, 23.4); halloran.visible = false; fallen.rotation.z = 0; }
  if (CH.halloran === 'left') { halloran.visible = false; }
  if (CH.met && !CH.halloran) halTorch.intensity = 6;
  if (CH.docs.includes('photo')) photo.visible = false;
  if (CH.wake) { B.object.visible = true; hunter.script(false); hunter.set('idle'); const sp = grid.nearestWalkable(0, 34); B.object.position.set(sp.x, 0, sp.z); }
  if (opts.restart && CH.wake) { player.place(9, -2.6, Math.PI / 2, 0); lift.userData.setDoors?.(1); }
  drawMimic();
  captureEnv();
  window.__ch2 = { CH, hunter, B, player, interact, grid, water, pumps, use: (re) => { const it = interact.items.find((i) => i.enabled() && re.test(typeof i.label === 'function' ? i.label() : i.label)); if (it) it.onUse(it); return !!it; } };

  if (game.params.get('cp') === 'still') { ui.setFade(0); lift.userData.setDoors?.(1); applyDebugCamera(game); if (game.params.has('lit')) for (const p of pumps) { p.sp.intensity = 65; p.lamp.userData.setOn?.(true); } }
  else game.run(async () => { await opening(); game.run(watchHalloran); });

  let ambT = 20, dripT = 0, wakeT = 0, wadeT = 0, shadowFrame = 0;
  return {
    look: 'horror', ownFade: true,
    update(dt, t) {
      const ctx = creatureCtx(game);
      // pumps: needle while priming, rattle while running
      for (const p of pumps) {
        p.obj.userData.update?.(t);
        if (p.state === 'priming') {
          p.t += dt;
          p.v += dt * p.speed * (1 + Math.sin(p.t * 2.3) * 0.25);
          const shown = p.v + Math.sin(p.t * 7.3) * p.wobble + Math.sin(p.t * 17) * p.wobble * 0.4;
          p.panel.userData.setNeedle(shown);
          if (Math.random() < dt * 2) sfx.valveHiss(p.use, { dur: 0.4, strength: 0.25 });
          if (p.v > 1.02) blowRelief(p);
        }
      }
      // the level drains toward its target
      if (Math.abs(water.level - waterTarget) > 0.001) {
        water.setLevel(water.level + Math.sign(waterTarget - water.level) * Math.min(Math.abs(waterTarget - water.level), dt * 0.012));
        if ((t * 2 | 0) !== ((t - dt) * 2 | 0)) drawMimic();
        if (water.level <= 0.05 && !CH.drained) { CH.drained = true; doorLamp.material.emissive.setHex(0x30ff60); doorLight.color.setHex(0x30ff60); sfx.beep('ok'); refreshObjective(); game.run(() => say(OK, 'Level\'s below the sill. The pressure door will open now.')); }
      }
      water.update(t);
      if (reflection) reflection.reflector.position.y = water.level - 0.001;
      // wading slows you down
      const wetHere = inWater(player.pos.x, player.pos.z);
      player.speedScale = wetHere ? 1 - 0.4 * Math.min(1, water.level / 0.55) : 1;
      // drips: ripples on the surface near you
      dripT -= dt;
      if (dripT <= 0) { dripT = 0.15 + Math.random() * 0.4; const a = Math.random() * 6.28, r = 1.5 + Math.random() * 7; const x = player.pos.x + Math.cos(a) * r, z = player.pos.z + Math.sin(a) * r; if (inWater(x, z)) water.ripple(x, z, 0.25 + Math.random() * 0.25); }
      // floating debris bobs and drifts
      for (const f of floaters) { f.m.position.y = Math.max(0, water.level - 0.12) + Math.sin(t * 1.1 + f.ph) * 0.015; f.m.rotation.z = Math.sin(t * 0.8 + f.ph) * 0.05; f.x += f.drift.x * dt; f.z += f.drift.z * dt; f.m.position.x = f.x; f.m.position.z = f.z; if (water.level < 0.1) f.m.position.y = 0; }
      // the creature: sunk low in the water when it is not hunting you, and always leaving a wake
      if (B.object.visible) {
        B.update(dt, ctx); hunter.update(dt);
        const bp = B.object.position, inW = inWater(bp.x, bp.z), moving = B.anim.vel.lengthSq() > 0.04;
        const sinkTarget = inW && !['chase', 'attack', 'stunned'].includes(hunter.state) ? water.level * 0.45 : 0;
        bp.y += (-sinkTarget - bp.y) * (1 - Math.exp(-dt * 2));
        if (inW && moving) {
          wakeT -= dt; wadeT -= dt;
          if (wakeT <= 0) { wakeT = 0.18; water.ripple(bp.x + (Math.random() - 0.5) * 0.3, bp.z + (Math.random() - 0.5) * 0.3, 1.5); }
          if (wadeT <= 0) { wadeT = 0.8; sfx.wade(V(bp.x, 0.4, bp.z), { speed: Math.min(1, Math.sqrt(B.anim.vel.lengthSq()) / 3), dur: 0.9 }); }
        }
        player.shake = Math.max(player.shake, B.anim.shake);
      }
      lamp.update(dt);
      if (lift.userData.setDoors && !CH.liftShut && CH.wake && player.pos.z > 2) { CH.liftShut = true; }
      // emergency lights: one of them is failing
      for (const e of emerg) if (e.flick) e.l.intensity = e.base * (Math.random() < (e.flick === 2 ? 0.08 : 0.02) ? 0.1 : 0.85 + Math.sin(t * 7 + e.base) * 0.1);
      // the building settles; pipes groan; something knocks, far off
      ambT -= dt;
      if (ambT <= 0 && !hidden) {
        ambT = 16 + Math.random() * 24;
        const a = Math.random() * 6.28, r = 8 + Math.random() * 8, at = V(player.pos.x + Math.cos(a) * r, 1.2, player.pos.z + Math.sin(a) * r);
        const k = Math.random();
        if (k < 0.35) sfx.pipeGroan(at, { dur: 2 + Math.random() * 2 });
        else if (k < 0.6) sfx.metalImpact(at, 0.2);
        else if (k < 0.85 && (!B.object.visible || hunter.anim.distToPlayer() > 12)) { sfx.splash(at, 0.6); if (inWater(at.x, at.z)) water.ripple(at.x, at.z, 1.2); }
        else sfx.valveHiss(at, { dur: 1.5, strength: 0.3 });
      }
      // throttled shadows for the station lights
      shadowFrame++;
      for (const p of pumps) if (p.sp.intensity > 0 && (shadowFrame + p.i) % 3 === 0) p.sp.shadow.needsUpdate = true;
      const dd = B.object.visible ? hunter.anim.distToPlayer() : 99;
      game.fear = Math.max(0, 1 - dd / 9) * (hunter.state === 'chase' ? 1 : 0.6);
      sfx.heartbeat(dd < 6 && B.object.visible ? 70 + (6 - dd) * 12 : 0);
    },
    dispose() { sfx.setTension(0); sfx.heartbeat(0); for (const p of pumps) p.sound.stop?.(0.3); },
  };
}
