// CHAPTER FIVE: LIGHTS OUT
// The purge has cut the hoist at Level 200. Climb out through the central core while the purge controller
// sheds power section by section and gas rises up the shaft behind you. B is desperate now: it rode the roof
// of your cage, it climbs the walls of the core, and it gets to the surface lift before you do.
// What you carry decides the ending: the lure, the overcharge, or the last dose of LANTERN-0.
import * as THREE from 'three';
import { Creature } from '../creature.js';
import { loadCreatureModel, creatureBlockers, creatureCtx, applyDebugCamera } from './common.js';
import { sfx } from '../engine/game.js';
import { save } from '../save.js';
import { NavGrid } from '../ai/navgrid.js';
import { Hunter } from '../ai/hunter.js';
import { HalideLamp } from '../engine/lamp.js';
import { pbr } from '../engine/assets.js';
import { buildRooms, placer, paintedMaterial } from './rooms.js';
import { Parts, Bulbs, hiding, Exposure, Respirator, Gas, mmss, rng } from './mine.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const OK = 'Dr. Okafor (radio)', HALR = 'Halloran (radio)', B_VOICE = '—';
const R = { N: 0, S: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 };
const Y1 = 13.5; // Level 100

// ------------------------------------------------------------------ plan: A (Level 200, y 0), the core, C (Level 100), D fan house, E lift lobby
const ROOMS = {
  car: { x0: -1.25, x1: 1.25, z0: -2.6, z1: -0.05, h: 2.8, floor: 'steel' },
  plant: { x0: -9, x1: 9, z0: 0, z1: 14, h: 5 },
  mcc: { x0: -16, x1: -9, z0: 7, z1: 13, h: 3.2 },
  filters: { x0: -16, x1: -9, z0: 0.5, z1: 6, h: 3 },
  core: { x0: -8, x1: 8, z0: 14, z1: 30, h: 22, ceiling: true },
  gallery: { x0: 8, x1: 34, z0: 14, z1: 16.6, h: Y1 + 3, base: Y1 },
  switch: { x0: 14, x1: 30, z0: 16.6, z1: 28, h: Y1 + 4, base: Y1 },
  battery: { x0: 30, x1: 34, z0: 16.6, z1: 26, h: Y1 + 3, base: Y1 },
  control: { x0: 20, x1: 28, z0: 6, z1: 14, h: Y1 + 3, base: Y1 },
  fan: { x0: 34, x1: 46, z0: 10, z1: 30, h: Y1 + 9, base: Y1 },
  duct: { x0: 38.8, x1: 41.2, z0: 30, z1: 44, h: Y1 + 1.5, base: Y1 },
  lobby: { x0: 34, x1: 48, z0: 44, z1: 56, h: Y1 + 4.5, base: Y1 },
  car2: { x0: 39.8, x1: 42.2, z0: 56, z1: 58.6, h: Y1 + 2.8, base: Y1 },
};
const DOORS = [
  { x0: -1.25, x1: 1.25, z0: -0.3, z1: 0.25, top: 2.7 },
  { x0: -9.3, x1: -8.7, z0: 9, z1: 11 }, { x0: -9.3, x1: -8.7, z0: 2, z1: 4 },
  { x0: -1.5, x1: 1.5, z0: 13.7, z1: 14.3, top: 3 }, // the core door
  { x0: 7.7, x1: 8.3, z0: 14.4, z1: 16.4, top: Y1 + 2.4, lo: Y1 }, // core landing 3 -> gallery
  { x0: 16, x1: 18, z0: 16.3, z1: 16.9, top: Y1 + 2.4, lo: Y1 }, { x0: 26, x1: 28, z0: 16.3, z1: 16.9, top: Y1 + 2.4, lo: Y1 },
  { x0: 29.7, x1: 30.3, z0: 20, z1: 22, top: Y1 + 2.4, lo: Y1 }, { x0: 23, x1: 25, z0: 13.7, z1: 14.3, top: Y1 + 2.4, lo: Y1 },
  { x0: 33.7, x1: 34.3, z0: 14.4, z1: 16.4, top: Y1 + 2.4, lo: Y1 }, // fan house door
  { x0: 38.8, x1: 41.2, z0: 29.7, z1: 30.3, top: Y1 + 1.5, lo: Y1 }, { x0: 38.8, x1: 41.2, z0: 43.7, z1: 44.3, top: Y1 + 1.5, lo: Y1 },
  { x0: 39.8, x1: 42.2, z0: 55.7, z1: 56.3, top: Y1 + 2.7, lo: Y1 },
];
// the core stair: three flights round the walls, rising 4.5 m each, then the door at landing 3
const F = { w: 2.4, rise: 4.5 };
const SURF = [
  { r: { x0: -8, x1: 8, z0: 14, z1: 30 }, h: () => 0 }, // the floor of the core
  { r: { x0: -8, x1: -5.6, z0: 16.6, z1: 27.6 }, h: (x, z) => ((z - 16.6) / 11) * F.rise },
  { r: { x0: -8, x1: -5.6, z0: 27.6, z1: 30 }, h: () => F.rise },
  { r: { x0: -5.6, x1: 5.6, z0: 27.6, z1: 30 }, h: (x) => F.rise + ((x + 5.6) / 11.2) * F.rise },
  { r: { x0: 5.6, x1: 8, z0: 27.6, z1: 30 }, h: () => F.rise * 2 },
  { r: { x0: 5.6, x1: 8, z0: 16.6, z1: 27.6 }, h: (x, z) => F.rise * 2 + ((27.6 - z) / 11) * F.rise },
  { r: { x0: 5.6, x1: 8, z0: 14, z1: 16.6 }, h: () => Y1 },
];
for (const k of ['gallery', 'switch', 'battery', 'control', 'fan', 'duct', 'lobby', 'car2']) SURF.push({ r: ROOMS[k], h: () => Y1 });
const inRect = (r, x, z, m = 0) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;
const upper = (x, z = 20) => x >= 8 && !(z < 14 && x < 9.5); // Level 100 and beyond

const DOCS = {
  purge: {
    ref: 'MOTOR CONTROL ROOM · PRINTOUT ON THE FLOOR', title: 'Purge sequence · Wing D · below',
    body: `<p><b>AUTHORISED: I. OKAFOR · 03:52</b></p>
<p>1. Isolate hoist (Level 200 stop). 2. Seal core door (hydraulic interlock). 3. Shed Level 200, core, Level 100 by section. 4. Fan 1 to full. 5. Agent release at all levels. 6. <b>Hold for 6 hours.</b></p>
<p>Handwritten under it, pressed so hard the pen went through: <i>“ROOK IS STILL DOWN THERE.”</i> And under that, in different ink: <i>“Proceed.”</i></p>`,
  },
  order: {
    ref: 'PURGE CONTROLLER · CONTROL ROOM', title: 'Instruction from Halversen',
    body: `<p>From the board, to the Director, Site 41, by fax:</p>
<p><i>“Specimen C-14B and all records of LANTERN are to be destroyed in place. Personnel below Level 100 are to be considered lost. The Director will personally confirm the purge. The Director's own position will be reviewed afterwards.”</i></p>
<p>Okafor has initialled it. Beside her initials she has drawn a small, careful lantern.</p>`,
  },
};

export async function chapter5(game, opts = {}) {
  const { scene, player, ui, director: d, interact, renderer } = game;
  const say = (who, text, dur) => ui.say(who, text, dur);
  renderer.toneMappingExposure = 1.1;
  scene.background = new THREE.Color(0x020202);
  scene.fog = new THREE.FogExp2(0x050505, 0.045);

  const S = save.all();
  const CH = Object.assign({
    stage: 'cage', plan: S.plan || 'overcharge', mask: S.mask ?? true, maskOn: false, filters: S.filters ?? 1, filter: S.filter ?? 1,
    exposure: S.exposure || 0, valve: false, door: 0, iso: [], fanOff: false, docs: [], cells: [], finaleDeaths: 0, deaths: 0,
    gasA: 0, gasCore: 0, gasC: 0, lureSet: false, done: false, ending: null, gotMask: false,
  }, opts.state || {});
  const checkpoint = () => save.set('ch5', JSON.parse(JSON.stringify({ ...CH, dead: false, exposure: expo.value, filter: resp.filter, filters: resp.filters })));
  let busy = false, pumpBusy = false, fanSpin = 1, liftHere = false, clingT = 0, lowWarned = false;

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
  const kit = (name, args = [], fb = null) => { try { if (typeof K[name] === 'function') return K[name](...args); } catch (e) { console.warn('kit', name, e); } const g = new THREE.Group(); if (fb) { const m = new THREE.Mesh(new THREE.BoxGeometry(...fb), fbMat); m.position.y = fb[1] / 2; g.add(m); g.userData.collider = { w: fb[0], d: fb[2] }; } return g; };
  const model = (id, o) => { try { return K.model?.(id, o) || new THREE.Group(); } catch { return new THREE.Group(); } };
  const sign = (t, o) => (P.sign ? P.sign(t, o) : new THREE.Group());
  const tex = (n) => { try { return pbr(n); } catch { return {}; } };
  const conc = tex('Concrete036');
  const wallMat = paintedMaterial(conc, { upper: 0x8c8a82, lower: 0x3f4a44, dado: 1.2 });
  const floorMat = M.slab || new THREE.MeshStandardMaterial({ color: 0x77736b, roughness: 0.95 });
  const steelFloor = new THREE.MeshStandardMaterial({ ...tex('DiamondPlate008C'), color: 0x6b6d70, metalness: 0.7, roughness: 0.6 }); steelFloor.userData.tile = 1.2;
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0x5c5a55, roughness: 0.95 });
  const steel = M.steelDark || new THREE.MeshStandardMaterial({ color: 0x3c3d40, metalness: 0.8, roughness: 0.6 });
  const paintY = new THREE.MeshStandardMaterial({ color: 0xc9a222, roughness: 0.6 });
  const cabMat = new THREE.MeshStandardMaterial({ color: 0x6e7570, roughness: 0.55, metalness: 0.3 });

  // ---------------------------------------------------------------- structure (Level 100 rooms are built at y = 0 and lifted)
  const lower = {}, up = {};
  for (const [k, r] of Object.entries(ROOMS)) (r.base ? up : lower)[k] = r.base ? { ...r, h: r.h - r.base } : r;
  const bl = buildRooms(scene, lower, DOORS.filter((dd) => !dd.lo || dd === DOORS[4]), { wallMat, floorMats: { default: floorMat, steel: steelFloor }, ceilMat, worldUV: K.worldUV, thickness: 0.4 });
  const upDoors = DOORS.filter((dd) => dd.lo).map((dd) => ({ ...dd, top: dd.top - Y1, lo: undefined }));
  // the gallery's west wall is shared with the core: let the landing door through
  const g2 = new THREE.Group(); scene.add(g2);
  const wallMatUp = paintedMaterial(conc, { upper: 0x8c8a82, lower: 0x3f4a44, dado: Y1 + 1.2 });
  const bu = buildRooms(g2, up, upDoors, { wallMat: wallMatUp, floorMats: { default: floorMat }, ceilMat, worldUV: K.worldUV, thickness: 0.4 });
  g2.position.y = Y1;
  const colliders = [...bl.colliders.map((c) => ({ y0: -1, y1: 99, ...c })), ...bu.colliders.map((c) => ({ ...c, y0: Y1 - 1, y1: 99 }))];
  // the core's walls run the whole height: a box spanning both levels where Level 100 meets it (x = 8 wall above y 4)
  const sightBlockers = [...bl.sightBlockers, ...bu.sightBlockers];
  const place = placer(scene, colliders);
  const placeUp = (obj, x, z, rot = 0) => { const n = colliders.length; const o = place(obj, x, z, rot, Y1); for (let i = n; i < colliders.length; i++) { colliders[i].y0 = Y1 - 1; colliders[i].y1 = 99; } if (obj.userData?.collider) { const c = obj.userData.collider, sw = Math.abs(Math.sin(rot)) > 0.5, w = sw ? c.d : c.w, dd = sw ? c.w : c.d; colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - dd / 2, maxZ: z + dd / 2, y0: Y1 - 1, y1: 99 }); } return o; };
  const parts = new Parts();

  // ---------------------------------------------------------------- the core: flights, landings, rails, the floor far below
  {
    const stepsAlong = (axis, from, to, c0, c1, h0, h1) => {
      const n = 15, L = to - from;
      for (let i = 0; i < n; i++) {
        const a = from + (L * i) / n, b = from + (L * (i + 1)) / n, top = h0 + ((h1 - h0) * (i + 1)) / n;
        if (axis === 'z') parts.box(floorMat, (c0 + c1) / 2, top / 2 + (h0 > 0 ? h0 / 2 - h0 / 2 : 0), (a + b) / 2, c1 - c0, Math.max(0.05, top - Math.max(0, h0 - 0.3)), Math.abs(b - a), 0, 0, 0);
        else parts.box(floorMat, (a + b) / 2, top / 2, (c0 + c1) / 2, Math.abs(b - a), Math.max(0.05, top - Math.max(0, h0 - 0.3)), c1 - c0);
      }
    };
    // flight treads as stacked boxes (solid underneath, so the climb reads as a mass of concrete)
    const flight = (axis, from, to, c0, c1, h0, h1) => {
      const n = 15, L = to - from;
      for (let i = 0; i < n; i++) {
        const a = from + (L * i) / n, b = from + (L * (i + 1)) / n, top = h0 + ((h1 - h0) * (i + 1)) / n, bot = Math.max(0, top - 0.9);
        if (axis === 'z') parts.box(floorMat, (c0 + c1) / 2, (top + bot) / 2, (a + b) / 2, c1 - c0, top - bot, Math.abs(b - a));
        else parts.box(floorMat, (a + b) / 2, (top + bot) / 2, (c0 + c1) / 2, Math.abs(b - a), top - bot, c1 - c0);
      }
    };
    void stepsAlong;
    flight('z', 16.6, 27.6, -8, -5.6, 0, F.rise);
    parts.box(floorMat, -6.8, F.rise - 0.25, 28.8, 2.4, 0.5, 2.4);
    flight('x', -5.6, 5.6, 27.6, 30, F.rise, F.rise * 2);
    parts.box(floorMat, 6.8, F.rise * 2 - 0.25, 28.8, 2.4, 0.5, 2.4);
    flight('z', 27.6, 16.6, 5.6, 8, F.rise * 2, Y1);
    parts.box(floorMat, 6.8, Y1 - 0.25, 15.3, 2.4, 0.5, 2.6);
    // rails on the open side of every flight and landing
    const rail = (ax, az, bx, bz, ha, hb) => {
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 1.2);
      for (let i = 0; i <= n; i++) { const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t, h = ha + (hb - ha) * t; parts.cyl(steel, V(x, h, z), V(x, h + 1.05, z), 0.025, 6); }
      parts.cyl(paintY, V(ax, ha + 1.05, az), V(bx, hb + 1.05, bz), 0.03, 6); parts.cyl(steel, V(ax, ha + 0.55, az), V(bx, hb + 0.55, bz), 0.018, 6);
    };
    rail(-5.6, 16.6, -5.6, 27.6, 0, F.rise); rail(-5.6, 27.6, 5.6, 27.6, F.rise, F.rise * 2); rail(5.6, 27.6, 5.6, 16.6, F.rise * 2, Y1); rail(5.6, 16.6, 5.6, 14.2, Y1, Y1);
    // rails stop you at every height; under-stair blockers stop you walking beneath the low end of flight 1
    colliders.push({ minX: -5.65, maxX: -5.55, minZ: 16.6, maxZ: 27.6, y0: 0.6, y1: 99 }, { minX: -5.6, maxX: 5.6, minZ: 27.55, maxZ: 27.65, y0: 0.6, y1: 99 }, { minX: 5.55, maxX: 5.65, minZ: 14, maxZ: 27.6, y0: -1, y1: 99 });
    colliders.push({ minX: -8, maxX: -5.6, minZ: 18.4, maxZ: 27.6, y0: -1, y1: 0.85 });
    // the core's wall above Level 100's floor is part of the gallery wall; below it, a solid wall on x = 8
    // conduits and pipes up the walls, and a ladder in the corner nobody uses
    for (const x of [-7.6, -7.3]) parts.cyl(steel, V(x, 0, 29.6), V(x, 21.5, 29.6), 0.05, 8);
    for (const z of [14.5, 29.5]) parts.cyl(M.rust || steel, V(7.6, 0, z), V(7.6, 21.5, z), 0.12, 10);
  }
  // Level 100 furniture: switchboard rows (a maze), batteries, the purge controller
  const SB = [];
  for (const [x0, z0, len, ax] of [[15.5, 18.5, 6, 'x'], [23, 18.5, 6, 'x'], [15.5, 21.2, 9, 'x'], [26.5, 21.2, 2.6, 'x'], [17, 24, 5, 'x'], [24, 24, 5.5, 'x'], [15.5, 26.6, 4, 'x']]) {
    const w = ax === 'x' ? len : 0.7, dd = ax === 'x' ? 0.7 : len;
    parts.box(cabMat, x0 + w / 2, Y1 + 1.1, z0, w, 2.2, dd);
    for (let k = 0; k < len / 0.8; k++) parts.box(steel, x0 + 0.4 + k * 0.8, Y1 + 1.4, z0 - 0.36, 0.05, 1.6, 0.02);
    const b = { minX: x0, maxX: x0 + w, minZ: z0 - dd / 2, maxZ: z0 + dd / 2, y0: Y1 - 1, y1: 99 }; colliders.push(b); sightBlockers.push(b); SB.push(b);
  }
  const battMat = new THREE.MeshStandardMaterial({ color: 0x223a2a, roughness: 0.5 });
  for (let k = 0; k < 5; k++) for (const z of [17.4, 25.2]) parts.box(battMat, 30.6 + k * 0.62, Y1 + 0.45, z, 0.5, 0.9, 0.5);
  colliders.push({ minX: 30.3, maxX: 33.4, minZ: 17.1, maxZ: 17.7, y0: Y1 - 1, y1: 99 }, { minX: 30.3, maxX: 33.4, minZ: 24.9, maxZ: 25.5, y0: Y1 - 1, y1: 99 });
  parts.box(cabMat, 24, Y1 + 1, 6.6, 5, 2, 0.8); colliders.push({ minX: 21.5, maxX: 26.5, minZ: 6.2, maxZ: 7.0, y0: Y1 - 1, y1: 99 });
  // Level 200: pump sets, pipes along the walls
  for (const [x, z, r] of [[-5.5, 4.5, 0], [-5.5, 9.5, 0], [5.5, 4.5, Math.PI], [5.5, 9.5, Math.PI]]) { try { place(PP.pumpStation({ label: 'L200' }), x, z, r); } catch { /* optional */ } }
  for (const y of [3.6, 4.1]) parts.cyl(M.rust || steel, V(-8.6, y, 0.5), V(-8.6, y, 13.5), 0.14, 10);
  parts.cyl(M.rust || steel, V(8.6, 3.8, 0.5), V(8.6, 3.8, 13.5), 0.2, 12);
  parts.build(scene, { worldUV: K.worldUV, tile: 1.4 });

  // ---------------------------------------------------------------- doors and machines
  const liftObj = place(kit('freightLift', [{ w: 2.4, d: 2.2, h: 2.7, wall: 0.3 }], [2.6, 2.8, 0.4]), 0, 0, 0);
  liftObj.userData.dynamic = true; liftObj.userData.setDoors?.(0);
  const cageDoor = { minX: -1.3, maxX: 1.3, minZ: -0.14, maxZ: 0.02, y0: -1, y1: 5 }; colliders.push(cageDoor);
  const cageLight = new THREE.PointLight(0xfff0d0, 1.4, 4, 1.8); cageLight.position.set(0, 2.5, -1.4); scene.add(cageLight);
  // the core door: a heavy leaf that a hydraulic ram lifts
  const coreDoor = new THREE.Mesh(new THREE.BoxGeometry(3.0, 3.0, 0.25), new THREE.MeshStandardMaterial({ ...tex('Metal055A'), color: 0x8a8a80, metalness: 0.6, roughness: 0.7 }));
  coreDoor.position.set(0, 1.5, 14); coreDoor.castShadow = true; coreDoor.userData.dynamic = true; scene.add(coreDoor);
  const coreBox = { minX: -1.5, maxX: 1.5, minZ: 13.8, maxZ: 14.2, y0: -1, y1: 5 }; colliders.push(coreBox);
  { const s = sign('CORE · PURGE INTERLOCK', { w: 1.2, h: 0.2, style: 'warning' }); s.position.set(0, 3.3, 13.78); s.rotation.y = R.S; scene.add(s); }
  const pumpHandle = new THREE.Group();
  { const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 0.3), paintY); b.position.y = 0.3; pumpHandle.add(b); const h = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 6), steel); h.position.set(0, 0.75, 0.25); h.rotation.x = -0.6; pumpHandle.add(h); pumpHandle.userData.lever = h; }
  pumpHandle.position.set(2.3, 0, 13.4); pumpHandle.userData.dynamic = true; scene.add(pumpHandle); colliders.push({ minX: 2.1, maxX: 2.5, minZ: 13.2, maxZ: 13.6, y0: -1, y1: 5 });
  const valve = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.03, 8, 20), new THREE.MeshStandardMaterial({ color: 0xa02020, roughness: 0.5 })); valve.position.set(-15.7, 1.3, 10); valve.rotation.y = Math.PI / 2; valve.userData.dynamic = true; scene.add(valve);
  { const s = sign('HYDRAULIC BYPASS · CORE DOOR', { w: 0.9, h: 0.16 }); s.position.set(-15.75, 1.8, 10); s.rotation.y = R.E; scene.add(s); }
  // isolators in the switch room and battery room, the fan house door, the fan
  const ISO = [V(14.4, Y1 + 1.3, 27.5), V(29.6, Y1 + 1.3, 17.4), V(33.6, Y1 + 1.3, 21)];
  const isoObjs = ISO.map((p, i) => { const b = kit('breakerPanel', [{ label: `ISOLATOR I-${i + 1}` }], [0.5, 0.7, 0.2]); b.position.copy(p); b.position.y -= 0; b.rotation.y = i === 0 ? R.S : i === 1 ? R.S : R.W; b.userData.dynamic = true; scene.add(b); b.userData.setOn?.(true); return b; });
  const fanDoor = PP.pressureDoor({ w: 1.6, h: 2.1 }); fanDoor.position.set(34, Y1, 15.4); fanDoor.rotation.y = R.E; fanDoor.userData.dynamic = true; scene.add(fanDoor);
  const fanDoorBox = { minX: 33.8, maxX: 34.2, minZ: 14.4, maxZ: 16.4, y0: Y1 - 1, y1: 99 }; colliders.push(fanDoorBox);
  const fanLamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshStandardMaterial({ color: 0x300, emissive: 0xff2010, emissiveIntensity: 2 })); fanLamp.position.set(33.7, Y1 + 2.4, 16.8); fanLamp.userData.dynamic = true; scene.add(fanLamp);
  const fan = new THREE.Group();
  {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.9, 0.22, 10, 40), steel); fan.add(ring);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.8, 18), steel); hub.rotation.x = Math.PI / 2; fan.add(hub);
    const blades = new THREE.Group();
    for (let k = 0; k < 6; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.75, 2.3, 0.06), M.steelPaint || steel); b.position.y = 1.65; b.rotation.y = 0.45; const p = new THREE.Group(); p.rotation.z = (k / 6) * Math.PI * 2; p.add(b); blades.add(p); }
    fan.add(blades); fan.userData.blades = blades;
  }
  fan.position.set(40, Y1 + 3.1, 29.6); fan.userData.dynamic = true; scene.add(fan);
  const fanBox = { minX: 37, maxX: 43, minZ: 29.2, maxZ: 30.0, y0: Y1 - 1, y1: 99 }; colliders.push(fanBox);
  // the surface lift
  const lift2 = kit('freightLift', [{ w: 2.4, d: 2.2, h: 2.7, wall: 0.3 }], [2.6, 2.8, 0.4]);
  lift2.position.set(41, Y1, 56); lift2.rotation.y = R.S; lift2.userData.dynamic = true; scene.add(lift2); lift2.userData.setDoors?.(0);
  for (const c of lift2.userData.colliders || []) { const p = [[c.minX, c.minZ], [c.maxX, c.maxZ]].map(([lx, lz]) => [41 - lx, 56 - lz]); colliders.push({ minX: Math.min(p[0][0], p[1][0]), maxX: Math.max(p[0][0], p[1][0]), minZ: Math.min(p[0][1], p[1][1]), maxZ: Math.max(p[0][1], p[1][1]), y0: Y1 - 1, y1: 99 }); }
  const liftDoorBox = { minX: 39.7, maxX: 42.3, minZ: 55.98, maxZ: 56.14, y0: Y1 - 1, y1: 99 }; colliders.push(liftDoorBox);
  const liftCar = { minX: 39.8, maxX: 42.2, z0: 56.3, z1: 58.5 };
  const liftLight = new THREE.PointLight(0xfff0d0, 0, 4, 1.8); liftLight.position.set(41, Y1 + 2.5, 57.4); scene.add(liftLight);
  const callPanel = P.keypad ? P.keypad() : new THREE.Group(); callPanel.position.set(43, Y1 + 1.3, 55.85); callPanel.rotation.y = R.S; scene.add(callPanel);
  // lockers
  const lockers = [];
  for (const [x, z, r, y] of [[-15.6, 1.5, R.E, 0], [8.6, 12.8, R.W, 0], [29.6, 27.6, R.S, Y1], [9, 16.2, R.N, Y1], [34.6, 52, R.E, Y1], [47.4, 47, R.W, Y1]]) {
    const l = kit('lockerHide', [], [0.55, 2, 0.55]); if (y) placeUp(l, x, z, r); else place(l, x, z, r); l.userData.dynamic = true; lockers.push(l);
  }
  // respirator (if you came without one) and filters
  const maskObj = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshStandardMaterial({ color: 0x1a1b1c, roughness: 0.7 })); maskObj.position.set(-15.7, 1.5, 4.2); maskObj.userData.dynamic = true; scene.add(maskObj);
  const filterObj = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.07, 12), new THREE.MeshStandardMaterial({ color: 0x6b6f3a, roughness: 0.6 })); filterObj.position.set(-15.7, 1.2, 3.6); filterObj.rotation.z = Math.PI / 2; filterObj.userData.dynamic = true; scene.add(filterObj);
  if (CH.mask) maskObj.visible = false;
  if (CH.gotFilters) filterObj.visible = false;
  const cellSpots = [V(-15.6, 1.0, 2.6), V(25, Y1 + 1.0, 7.0), V(31.4, Y1 + 0.95, 25.2)];
  const cellMeshes = cellSpots.map((p, i) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.08), new THREE.MeshStandardMaterial({ color: 0x23272a, roughness: 0.5, metalness: 0.4 })));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.162, 0.025, 0.082), new THREE.MeshStandardMaterial({ color: 0xe0b020, emissive: 0x3a2a00, roughness: 0.4 })));
    g.position.copy(p).add(V(0, 0.05, 0)); g.userData.dynamic = true; scene.add(g); if (CH.cells.includes(i)) g.visible = false; return g;
  });
  const paper = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.005, 0.22), M.paper || fbMat); paper.position.set(-12, 0.005, 10.5); paper.rotation.y = 0.4; scene.add(paper);
  const faxPaper = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.005, 0.3), M.paper || fbMat); faxPaper.position.set(24.4, Y1 + 2.01, 6.6); scene.add(faxPaper);
  // signs
  for (const [t, x, y, z, r] of [['LEVEL 200 · PLANT', 0, 3.6, 0.25, R.N], ['LEVEL 100 · ELECTRICAL', 9, Y1 + 2.5, 14.25, R.N], ['FAN HOUSE', 33.7, Y1 + 2.6, 15.4, R.W], ['SURFACE HOIST', 41, Y1 + 3.3, 55.75, R.S]]) { const s = sign(t, { w: 1.4, h: 0.22 }); s.position.set(x, y, z); s.rotation.y = r; scene.add(s); }

  // ---------------------------------------------------------------- light: sections the purge sheds one after another
  const hemi = new THREE.HemisphereLight(0x50565e, 0x0c0a08, game.params.has('bright') ? 6 : 0.55); scene.add(hemi);
  game.flashlight.base = 105; game.flashlight.light.angle = 0.5; game.flashlight.light.distance = 30;
  const SECT = {};
  const sect = (name, list) => { SECT[name] = list.map(([x, y, z, c, i, dd]) => { const l = new THREE.PointLight(c, i, dd, 1.7); l.position.set(x, y, z); scene.add(l); let b = null; if (PP.emergencyLight) { b = PP.emergencyLight(); b.position.set(x, y + 0.15, z); b.userData.dynamic = true; scene.add(b); } return { l, base: i, b, on: true }; }); };
  sect('plant', [[-4, 4.4, 7, 0xffa060, 12, 14], [4, 4.4, 7, 0xffa060, 10, 14], [-12.5, 2.8, 10, 0xff3020, 5, 8], [-12.5, 2.7, 3, 0xe8f0ff, 6, 8]]);
  sect('core', [[-6.8, 3, 15.5, 0xff3020, 8, 13], [-6.8, F.rise + 2.6, 28.8, 0xffa060, 14, 18], [6.8, F.rise * 2 + 2.6, 28.8, 0xffa060, 14, 18], [6.8, Y1 + 2.5, 15.3, 0xff3020, 7, 12]]);
  sect('gallery', [[12, Y1 + 2.6, 15.3, 0xffa060, 7, 11], [24, Y1 + 2.6, 15.3, 0xffa060, 7, 11], [24, Y1 + 2.6, 10, 0xe8f0ff, 6, 9]]);
  sect('switch', [[18, Y1 + 3.6, 22.5, 0xe8eeff, 9, 13], [26, Y1 + 3.6, 22.5, 0xe8eeff, 8, 13]]);
  sect('battery', [[32, Y1 + 2.6, 21, 0x60ff90, 5, 8]]);
  sect('fan', [[36, Y1 + 6, 20, 0xffa060, 12, 18]]);
  sect('lobby', [[41, Y1 + 3.8, 48, 0xff3020, 7, 14]]);
  const shed = (name) => { for (const s of SECT[name] || []) { s.on = false; s.l.intensity = 0; s.b?.traverse?.((o) => { if (o.material?.emissiveIntensity) o.material.emissiveIntensity = 0; }); } sfx.powerDown(); sfx.metalImpact(game.camera.position.clone().add(V(0, 3, 0)), 0.3); };
  const flick = (name, amt = 0.02) => { for (const s of SECT[name] || []) if (s.on) s.l.intensity = s.base * (Math.random() < amt ? 0.1 : 1); };
  // a few LEDs that stay on after the switch room goes dark: enough to light a face from below
  const ledLight = new THREE.PointLight(0xff2a10, 0, 3, 2); ledLight.position.set(21.5, Y1 + 1.2, 19.4); scene.add(ledLight);

  // gas: Level 200, up the core, Level 100
  const gasA = new Gas(scene, { x0: -16, x1: 9, z0: -2.6, z1: 14 }, { level: 0 });
  const gasCore = new Gas(scene, { x0: -8, x1: 8, z0: 14, z1: 30 }, { level: 0, opacity: 0.2 });
  const gasC = new Gas(scene, { x0: 8, x1: 48, z0: 6, z1: 56 }, { level: 0 });
  const expo = new Exposure(game, CH.exposure);
  const resp = new Respirator(game, { filter: CH.filter, filters: CH.filters });
  if (CH.mask && CH.maskOn) resp.wear(true);

  // ---------------------------------------------------------------- height: stacked surfaces, the one under your feet
  const groundAt = (x, z) => {
    const cur = player.groundY ?? 0;
    let best = -1;
    for (const s of SURF) { if (!inRect(s.r, x, z)) continue; const h = s.h(x, z); if (h <= cur + 0.6 && h > best) best = h; }
    return best < 0 ? cur : best;
  };
  player.groundAt = groundAt;
  player.colliders = colliders;

  // ---------------------------------------------------------------- navigation (two separate floors; it never paths through the core)
  const grid = new NavGrid({ x0: -17, x1: 49, z0: -3, z1: 59 }, 0.5);
  function rebuildGrid() {
    grid.blocked.fill(0); grid.opaque.fill(0);
    grid.carve([ROOMS.plant, ROOMS.mcc, ROOMS.filters, ROOMS.gallery, ROOMS.switch, ROOMS.battery, ROOMS.control, ROOMS.fan, ROOMS.lobby, ...(CH.fanOff ? [ROOMS.duct] : []), ...DOORS.slice(1).filter((dd) => dd !== DOORS[3] && dd !== DOORS[4])]);
    for (const c of colliders) if (!c.disabled && !(c.y0 === 0.6) && !(c.y1 === 0.85)) grid.addBox(c, { pad: 0.12, opaque: false });
    for (const s of sightBlockers) grid.addBox(s, { block: false, opaque: true });
  }
  rebuildGrid();
  const PATROL = {
    A: [{ x: -4, z: 2 }, { x: 0, z: 7, look: true }, { x: 4, z: 12 }, { x: -12.5, z: 10 }, { x: -12.5, z: 3 }, { x: 7, z: 2 }, { x: -7, z: 12, look: true }],
    C: [{ x: 11, z: 15.3 }, { x: 20, z: 15.3 }, { x: 31, z: 15.3, look: true }, { x: 15, z: 20 }, { x: 22, z: 22.6 }, { x: 28.5, z: 19.8 }, { x: 20, z: 25.3, look: true }, { x: 28.5, z: 27 }, { x: 32, z: 21 }, { x: 24, z: 10, look: true }],
    E: [{ x: 41, z: 48 }, { x: 36, z: 54 }, { x: 46, z: 46 }, { x: 41, z: 52, look: true }],
  };

  // ---------------------------------------------------------------- performance
  game.batch(scene);

  // ---------------------------------------------------------------- the creature
  const gltf = await loadCreatureModel((p) => game.onProgress?.(p));
  const B = Creature.spawn(gltf); B.object.scale.setScalar(0.93);
  B.object.position.set(0, 0, -30); scene.add(B.object); B.object.updateMatrixWorld(true);
  B.attach({ colliders: [], bounds: { min: V(-16, 0, -2.5), max: V(48, 0, 58.5) } });
  const blockB = creatureBlockers(B);
  player.blockers = () => (B.object.visible && Math.abs(B.object.position.y - player.groundY) < 1.5 ? blockB() : []);
  const hunter = new Hunter({ creature: B, grid, game, patrol: PATROL.A, isLit: () => false, onKill: () => die(), hunt: 0.55 });
  hunter.script(true); hunter.aggression = 1.15;
  B.object.visible = false;
  let clinging = false;
  // a pose for the walls: crawl a few steps out of sight, then freeze the skeleton and stick it to a surface
  function cling(pos, normal, up = V(0, 1, 0), spread = 0) {
    hunter.script(true); clinging = false; B.object.visible = false;
    B.object.rotation.set(0, 0, 0); B.object.position.set(-14, 0, 1.5); B.anim.heading = 0;
    B.anim.play('follow', { path: [{ x: -14, z: 5.5 }], mode: 'crawl', speed: 0.8 });
    const ctx = creatureCtx(game);
    for (let i = 0; i < 80 + spread; i++) B.update(1 / 60, ctx);
    const y = normal.clone().normalize(), z = up.clone().addScaledVector(y, -up.dot(y)).normalize(), x = new THREE.Vector3().crossVectors(y, z);
    B.object.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    B.object.position.copy(pos); B.object.updateMatrixWorld(true);
    B.object.visible = true; clinging = true;
  }
  function uncling() { clinging = false; B.object.quaternion.identity(); B.object.rotation.set(0, B.anim.heading, 0); B.object.visible = false; }
  const toZone = (zone, x, z) => { uncling(); B.object.position.set(x, zone === 'A' ? 0 : Y1, z); B.object.rotation.set(0, 0, 0); hunter.patrol = PATROL[zone]; B.anim.gait.reset({ limbs: ['L', 'R'], home: { L: [0.15, 0], R: [-0.165, -0.075] } }); };

  // ---------------------------------------------------------------- the lamp
  const lampModel = P.halideLamp ? P.halideLamp() : new THREE.Group();
  const lamp = new HalideLamp(game, lampModel, { cells: 3, recharge: 11 });
  lamp.give();
  lamp.overcharge = CH.plan === 'overcharge';
  let finaleFlash = false;
  lamp.targets.push({
    point: () => B.bone.upperChest.getWorldPosition(V(0, 0, 0)),
    onFlash: (dist) => { finaleFlash = true; if (B.object.visible && !clinging) hunter.flashHit(dist); },
    onOvercharge: (dist) => { if (B.object.visible && !clinging) overchargeHit(dist); },
  });
  lamp.onFlash = () => { finaleFlash = true; };
  game.flashlight.on = true;
  player.onStep = (p, run) => {
    sfx.footstep(undefined, player.groundY > 0.2 ? 'metal' : 'concrete', { run, player: true });
    hunter.noise(p, run ? 15 : player.crouch ? 1.4 : 4.5);
  };

  // ---------------------------------------------------------------- hiding
  lockers.forEach((l) => l.updateMatrixWorld(true));
  const hide = hiding(game, {
    hunter, lampModel,
    spots: lockers.map((l) => ({ at: l.localToWorld((l.userData.inside || V(0, 1.5, -0.03)).clone()), yaw: l.rotation.y + Math.PI, out: V(Math.sin(l.rotation.y) * 0.8, 0, Math.cos(l.rotation.y) * 0.8).add(l.position), near: l.position.clone().add(V(0, 1.3, 0)), label: 'Hide in the locker', onEnter: () => { l.userData.setOpen?.(1); sfx.metalImpact(l.position, 0.3); setTimeout(() => l.userData.setOpen?.(0), 400); }, onExit: () => { l.userData.setOpen?.(1); setTimeout(() => l.userData.setOpen?.(0), 600); } })),
  });

  // ---------------------------------------------------------------- objectives
  function objectiveText() {
    switch (CH.stage) {
      case 'cage': return cageReady ? 'Get out of the cage.' : null;
      case 'plant': {
        const a = [];
        if (!CH.valve) a.push('Close the hydraulic bypass in the motor control room (west)');
        a.push(CH.valve ? `Pump the core door open (${Math.round(CH.door * 100)}%)` : 'then pump the core door open');
        if (!CH.mask) a.push('find a respirator: the gas is coming up');
        return a.join(' · ');
      }
      case 'core': return 'Climb the core.';
      case 'gallery': return `The fan house door is locked by the purge. Pull the three isolators (${CH.iso.length}/3): two in the switch room, one in the battery room.`;
      case 'fan': return CH.fanOff ? 'Go through the fan.' : 'Isolate Fan 1 (the breaker on the west wall), then go through it.';
      case 'duct': return 'Follow the duct to the surface hoist.';
      case 'finale': return finaleText();
      default: return null;
    }
  }
  function finaleText() {
    if (CH.plan === 'lure') return !liftHere ? 'Bring the hoist down (the call panel), and stay alive.' : !CH.lureSet ? 'Break the lure open in the hoist car.' : 'When it is inside, close the gate (the lever by the doors).';
    if (CH.plan === 'lantern') return 'Don\'t use the light. Turn off the torch, get down, and let it come to you.';
    return lamp.charge >= 0.999 ? 'Hold the lamp trigger to overcharge. It has to be close: under four metres, and in the chest.' : 'The lamp is recharging. Stay alive until it is full.';
  }
  let objT = 0;
  const refreshObjective = () => ui.objective(objectiveText());

  // ---------------------------------------------------------------- interactions
  const read = async (k) => { if (!CH.docs.includes(k)) CH.docs.push(k); await ui.readDoc(DOCS[k], game.input); checkpoint(); };
  interact.add({ position: () => V(0, 1.4, 0.3), reach: 2.2, size: 0.9, label: 'Force the cage doors', enabled: () => CH.stage === 'cage' && cageReady && !busy, onUse: () => game.run(forceDoors) });
  interact.add({ position: () => valve.position, reach: 2, size: 0.4, label: 'Close the hydraulic bypass', enabled: () => !CH.valve && !busy, onUse: () => game.run(closeValve) });
  interact.add({ position: () => pumpHandle.position.clone().add(V(0, 0.9, 0.2)), reach: 2.2, size: 0.45, label: () => (CH.valve ? `Pump the handle (door ${Math.round(CH.door * 100)}%)` : 'Hydraulic pump (the bypass is open: nothing happens)'), enabled: () => CH.door < 1 && !pumpBusy, onUse: () => game.run(pump) });
  interact.add({ position: () => paper.position.clone().add(V(0, 0.2, 0)), reach: 2, size: 0.4, label: 'Pick up the printout', onUse: () => read('purge') });
  interact.add({ position: () => faxPaper.position.clone().add(V(0, 0.1, 0)), reach: 2, size: 0.4, label: 'Read the fax on the controller', onUse: () => read('order') });
  interact.add({ position: () => maskObj.position, reach: 2, size: 0.3, label: 'Take the respirator', enabled: () => !CH.mask, onUse: () => { CH.mask = true; maskObj.visible = false; ui.toast('RESPIRATOR · M TO WEAR', 3); checkpoint(); refreshObjective(); } });
  interact.add({ position: () => filterObj.position, reach: 2, size: 0.3, label: 'Take the spare filters', enabled: () => !CH.gotFilters, onUse: () => { CH.gotFilters = true; filterObj.visible = false; resp.filters += 2; ui.toast('2 FILTERS', 2.5); checkpoint(); } });
  ISO.forEach((p, i) => interact.add({ position: p, reach: 2.2, size: 0.45, label: `Pull isolator I-${i + 1}`, enabled: () => CH.stage === 'gallery' && !CH.iso.includes(i) && !busy, onUse: () => game.run(() => pullIso(i)) }));
  interact.add({ position: V(34.4, Y1 + 1.5, 22), reach: 2.2, size: 0.5, label: 'Isolate Fan 1', enabled: () => CH.stage === 'fan' && !CH.fanOff && !busy, onUse: () => game.run(stopFan) });
  interact.add({ position: () => callPanel.position, reach: 2, size: 0.35, label: 'Call the hoist', enabled: () => CH.stage === 'finale' && CH.plan === 'lure' && !liftCalled, onUse: () => game.run(callLift) });
  interact.add({ position: V(41, Y1 + 0.5, 57.3), reach: 2.4, size: 0.6, label: 'Break the lure open in the car', enabled: () => CH.stage === 'finale' && CH.plan === 'lure' && liftHere && !CH.lureSet, onUse: () => game.run(setLure) });
  interact.add({ position: V(43, Y1 + 1.1, 55.85), reach: 2.2, size: 0.4, label: 'Pull the gate lever', enabled: () => CH.stage === 'finale' && CH.plan === 'lure' && CH.lureSet && !gateClosed, onUse: () => game.run(closeGate) });
  interact.add({ position: () => B.bone.head.getWorldPosition(V(0, 0, 0)), reach: 2.2, size: 0.8, label: 'Give it the dose', enabled: () => lanternReady, onUse: () => game.run(giveDose) });
  cellMeshes.forEach((m, i) => interact.add({ position: () => m.position, label: 'Take halide cell', reach: 1.8, size: 0.25, enabled: () => m.visible, onUse: () => { m.visible = false; CH.cells.push(i); lamp.refill(); ui.toast('HALIDE CELL · LAMP RECHARGED', 2.5); } }));

  // ---------------------------------------------------------------- Level 200
  let cageReady = false;
  async function arrival() {
    player.place(0, -1.45, Math.PI, 0); player.frozen = true;
    sfx.setAmbience('purge', 0.5, 2); sfx.setReverb('large');
    const cage = sfx.loop('cage', V(0, 2.8, -1.4), 0.8);
    await ui.card('CHAPTER FIVE', 'LIGHTS OUT', 4);
    ui.fadeTo(0, 2.5);
    const shake = d.every(() => { player.shake = Math.max(player.shake, 0.12); });
    await d.wait(3);
    // the hoist dies
    shake(); cage.set(0, 0.15); sfx.metalImpact(V(0, 2.4, -1.4), 1.4); player.shake = 1.5; sfx.powerDown(); cageLight.intensity = 0;
    setTimeout(() => cage.stop(0.5), 800);
    await d.wait(2.5);
    cageLight.intensity = 0.5;
    ui.toast('LEVEL 200 · HOIST POWER LOST', 3);
    await say(OK, 'Rook? ...Rook, the purge has cut the hoist. You\'re stopped at two hundred. I can\'t restart it from here.', 5);
    await say(OK, 'You\'ll have to climb the core. There\'s a stair all the way up to one hundred. The surface hoist is past the fan house.', 5);
    await d.wait(1);
    // and then the roof
    sfx.creatureDrag(V(0.3, 2.9, -1.2), { dur: 1.6 }); await d.wait(1.8);
    sfx.metalImpact(V(-0.4, 2.9, -1.8), 0.7); player.shake = 0.5; cageLight.intensity = 0.15;
    await d.wait(0.4); cageLight.intensity = 0.5;
    await d.wait(1.5);
    sfx.creatureBreath(V(0, 3.0, -1.4), { intensity: 0.8 });
    await say(OK, 'What was that? Rook, what\'s on the line?', 3);
    player.frozen = false; cageReady = true;
    refreshObjective();
  }
  async function forceDoors() {
    busy = true;
    sfx.doorSlide(liftObj.position, { heavy: true }); sfx.metalImpact(V(0, 1.2, 0), 0.6);
    const T0 = d.t; await d.until(() => { const k = Math.min(1, (d.t - T0) / 1.6); liftObj.userData.setDoors?.(k * 0.8); return k >= 1; });
    cageDoor.disabled = true; busy = false;
    await d.until(() => player.pos.z > 1.8);
    // behind you, it drops through the roof hatch into the car you just left
    sfx.metalImpact(V(0, 1, -1.4), 1.6); sfx.creatureScream(V(0, 2, -1.4), { dur: 1.4 }); player.shake = 1;
    toZone('A', 0, -1.4); B.object.visible = true; B.anim.heading = 0; B.anim.play('idle', { stare: true }); hunter.script(true);
    cageLight.intensity = 1.6;
    await d.wait(1.6);
    cageLight.intensity = 0; shed('plant'); sfx.powerDown();
    await d.wait(1.2);
    B.object.position.set(0, 0, -1.4);
    for (const s of SECT.plant) { s.on = true; s.l.intensity = s.base * 0.7; }
    B.object.visible = false;
    await d.wait(2);
    B.object.position.set(-12.5, 0, 3); B.object.visible = true; hunter.script(false); hunter.set('idle');
    CH.stage = 'plant'; checkpoint(); refreshObjective();
    await say(OK, 'The core door is on the purge interlock. Close the hydraulic bypass in the motor control room, west side. Then pump it open by hand.', 5.4);
    if (!CH.mask) await say(OK, 'And Rook: the agent is coming up through the floor drains. There are respirators in the filter store.', 4.4);
    gasStart = d.t;
  }
  let gasStart = -1;
  async function closeValve() {
    busy = true;
    sfx.pipeGroan(valve.position, { dur: 3, depth: 1 }); sfx.valveHiss(valve.position, { dur: 2, strength: 0.6 }); hunter.noise(valve.position, 22);
    const T0 = d.t; await d.until(() => { const k = Math.min(1, (d.t - T0) / 3); valve.rotation.x = k * 8; return k >= 1; });
    CH.valve = true; busy = false; checkpoint(); refreshObjective();
  }
  async function pump() {
    if (!CH.valve) { sfx.metalImpact(pumpHandle.position, 0.15); sfx.valveHiss(pumpHandle.position, { dur: 0.6, strength: 0.4 }); return; }
    pumpBusy = true;
    const lv = pumpHandle.userData.lever;
    sfx.metalImpact(pumpHandle.position.clone().add(V(0, 0.9, 0)), 0.45); hunter.noise(pumpHandle.position, 18);
    const T0 = d.t; await d.until(() => { const k = Math.min(1, (d.t - T0) / 0.7); lv.rotation.x = -0.6 + Math.sin(k * Math.PI) * 1.1; return k >= 1; });
    CH.door = Math.min(1, CH.door + 1 / 8);
    coreDoor.position.y = 1.5 + CH.door * 2.1; sfx.pipeGroan(V(0, 2, 14), { dur: 0.8, depth: 0.6 });
    if (CH.door >= 0.75 && !coreBox.disabled) { coreBox.disabled = true; }
    pumpBusy = false; refreshObjective();
    if (CH.door >= 0.75 && CH.stage === 'plant') game.run(enterCore);
  }

  // ---------------------------------------------------------------- the core
  async function enterCore() {
    await d.until(() => player.pos.z > 15 && player.groundY < 1);
    if (CH.stage !== 'plant') return;
    CH.stage = 'core'; checkpoint(); refreshObjective();
    // the door drops shut behind you; it is on the other side of it
    hunter.script(true); B.object.visible = false;
    coreDoor.position.y = 1.5; coreBox.disabled = false; sfx.metalImpact(V(0, 1, 14), 1.6); player.shake = 0.8;
    await d.wait(1.5);
    sfx.knock(V(0, 1.4, 13.6), { n: 4, gap: 0.5, hard: 1 });
    await d.wait(3);
    gasCoreStart = d.t;
    // landing 1: across the void, on the far wall, something is holding on
    await d.until(() => player.groundY > F.rise - 0.3);
    shed('core'); for (const s of SECT.core) { if (s.l.position.y > 4) { s.on = true; s.l.intensity = s.base; } }
    SECT.core[0].on = false;
    cling(V(7.96, 7.5, 22), V(-1, 0, 0));
    sfx.creatureClick(V(7.9, 7.5, 22));
    await d.until(() => { const c = game.camera, f = c.getWorldDirection(V(0, 0, 0)), p = B.object.position.clone().sub(c.position).normalize(); return f.dot(p) > 0.9 || d.t - clingT > 12; });
    await d.wait(1.6);
    // the lights flicker; every time they come back it is somewhere else
    for (const [p, n] of [[V(7.96, 9.6, 24.5), V(-1, 0, 0)], [V(3, 12.5, 29.96), V(0, 0, -1)], [V(-3, 15, 29.96), V(0, 0, -1)]]) {
      for (const s of SECT.core) s.l.intensity = 0; B.object.visible = false; sfx.creatureMove(p, { speed: 0.6 });
      await d.wait(0.5 + Math.random() * 0.4);
      cling(p, n);
      for (const s of SECT.core) if (s.on) s.l.intensity = s.base;
      await d.wait(1.8 + Math.random());
    }
    uncling(); sfx.creatureDrag(V(0, 16, 29), { dur: 1.2 });
    // landing 2: a long scrape across the wall above you, and dust
    await d.until(() => player.groundY > F.rise * 2 - 0.3);
    SECT.core[1].on = false; SECT.core[1].l.intensity = 0; sfx.powerDown();
    sfx.creatureDrag(V(4, Y1 + 4, 22), { dur: 2.2 }); sfx.rockfall(V(5, Y1 + 3, 24), 0.4);
    await d.wait(2.5);
    cling(V(0, 21.96, 22), V(0, -1, 0), V(0, 0, -1), 20);
    await d.wait(2.2);
    uncling();
    await d.until(() => player.groundY > Y1 - 0.3);
    SECT.core[2].on = false; SECT.core[2].l.intensity = 0; sfx.powerDown();
    CH.stage = 'gallery'; checkpoint(); refreshObjective();
    game.run(level100);
  }
  let gasCoreStart = -1;

  // ---------------------------------------------------------------- Level 100
  async function level100() {
    await d.until(() => player.pos.x > 9);
    await say(OK, 'You\'re on one hundred. Good. Listen: the purge controller has locked the fan house. I can\'t override it from here.', 5);
    await say(OK, 'The isolators can. Three of them. Every one you pull, the controller sheds something else to compensate. It\'s going to get dark, Rook.', 5.4);
    if (save.get('halloran') === 'saved') { await d.wait(1); await say(HALR, 'Doctor, it\'s Halloran. I\'m at the top of the hoist. I\'ve got the car up here. Say the word and it comes down to you.', 5.6); }
    else if (save.get('halloran') === 'left') { await d.wait(3); sfx.radio(2, { speaker: HALR }); await say(HALR, '...', 2); }
    await d.wait(6);
    // it comes up behind you, out of the core
    toZone('C', 11, 15.3); B.object.visible = true; hunter.script(false); hunter.set('idle');
    sfx.metalImpact(V(8, Y1 + 1, 15.3), 1.2); sfx.creatureScream(V(9, Y1 + 2, 15.3), { dur: 1.2 });
    gasCStart = d.t;
  }
  let gasCStart = -1;
  async function pullIso(i) {
    busy = true;
    const o = isoObjs[i];
    sfx.metalImpact(ISO[i], 0.9); sfx.powerDown(); hunter.noise(ISO[i], 26);
    o.userData.setOn?.(false);
    CH.iso.push(i); busy = false; checkpoint(); refreshObjective();
    await d.wait(1.2);
    if (CH.iso.length === 1) {
      shed('gallery'); await say(OK, 'That\'s one. The gallery lights just went. I can see it on the board.', 3.6);
      // then the radio, in her voice, saying something she would not say
      game.run(async () => { await d.wait(9); await say('Radio', 'Rook. Come back down to the core, Rook.', 3); await d.wait(1.2); await say('Radio', 'Rook. Come back down to the core, Rook.', 3); await d.wait(2); await say(OK, '...Rook? That wasn\'t me. Whatever you just heard, that wasn\'t me.', 4); });
    }
    else if (CH.iso.length === 2) {
      shed('switch'); ledLight.intensity = 0;
      // in the dark between the cabinets, lit from below by a panel of red LEDs, it stands and waits
      if (hunter.state !== 'chase' && hunter.state !== 'attack') {
        hunter.script(true); B.object.position.set(21.5, Y1, 19.9); B.anim.heading = Math.atan2(player.pos.x - 21.5, player.pos.z - 19.9); B.anim.play('idle', { stare: true }); B.object.visible = true;
        ledLight.intensity = 1.6; sfx.heartbeat(100);
        const T0 = d.t;
        await d.until(() => { const c = game.camera, f = c.getWorldDirection(V(0, 0, 0)), p = B.bone.head.getWorldPosition(V(0, 0, 0)).sub(c.position); const dist = p.length(); return (game.flashlight.on && dist < 11 && f.dot(p.normalize()) > 0.94) || d.t - T0 > 14; });
        sfx.creatureScream(B.bone.head.getWorldPosition(V(0, 0, 0)), { dur: 0.8 });
        B.anim.play('follow', { path: [{ x: 21.5, z: 21.2 }, { x: 14.8, z: 22.6 }], mode: 'crawl', speed: 2.4, gaze: 'forward' });
        await d.wait(1.6); ledLight.intensity = 0.4; sfx.heartbeat(0);
        hunter.script(false); hunter.set('idle');
      }
    } else {
      shed('battery'); fanLamp.material.emissive.set(0x10ff40); sfx.beep('ok');
      fanDoor.userData.setOpen?.(0.9); fanDoorBox.disabled = true; rebuildGrid();
      await say(OK, 'The fan house door is open. The agent is in the Level 100 ducts now, Rook. You have minutes.', 4.4);
      gasCRate = 0.012;
      CH.stage = 'fan'; checkpoint(); refreshObjective();
      sfx.setAmbience('purge', 0.9, 3);
    }
  }
  let gasCRate = 0.004;

  // ---------------------------------------------------------------- the fan house
  const fanLoop = sfx.loop('fan', V(40, Y1 + 3, 29), 1);
  async function stopFan() {
    busy = true; CH.fanOff = true;
    sfx.metalImpact(V(34.4, Y1 + 1.5, 22), 1.0); sfx.powerDown();
    // it winds down; in the silence, something breathing right behind you
    const T0 = d.t; await d.until(() => { const k = Math.min(1, (d.t - T0) / 11); fanSpin = 1 - k; fanLoop.set(1 - k, 0.3); return k >= 1; });
    fanLoop.stop(1); fanBox.disabled = true; rebuildGrid(); busy = false; refreshObjective();
    const back = player.forward(V(0, 0, 0)); back.y = 0; back.normalize().multiplyScalar(-2.3);
    const at = player.pos.clone().add(back);
    if (inRect(ROOMS.fan, at.x, at.z, -0.5)) {
      hunter.script(true); toZone('C', at.x, at.z); B.object.visible = true; B.anim.heading = Math.atan2(player.pos.x - at.x, player.pos.z - at.z); B.anim.play('idle', { stare: true });
      sfx.creatureBreath(B.bone.head.getWorldPosition(V(0, 0, 0)), { intensity: 0.9 });
      await d.wait(2.2);
      sfx.creatureBreath(B.bone.head.getWorldPosition(V(0, 0, 0)), { intensity: 1 });
      hunter.script(false); hunter.suspicion = 1.2; hunter.lastSeen = V(player.pos.x, player.pos.z); hunter.chase();
    }
    checkpoint();
    await d.until(() => player.pos.z > 30.5);
    // into the duct: it does not follow. You hear it going another way, overhead
    CH.stage = 'duct'; refreshObjective(); checkpoint();
    hunter.script(true); B.object.visible = false;
    await d.wait(2);
    // it is on top of the duct, keeping pace with you, a hand's width above your head
    sfx.creatureDrag(V(40, Y1 + 1.8, 33), { dur: 2.5 });
    await d.until(() => player.pos.z > 34);
    sfx.knock(V(40, Y1 + 1.6, player.pos.z + 1), { n: 3, gap: 0.6, hard: 1 }); player.shake = 0.4;
    await d.until(() => player.pos.z > 38);
    sfx.creatureBreath(V(40, Y1 + 1.8, player.pos.z), { intensity: 0.7 }); sfx.metalImpact(V(40, Y1 + 1.6, player.pos.z), 0.5);
    await d.wait(1.5);
    sfx.creatureDrag(V(40, Y1 + 1.8, 44), { dur: 2.2 });
    await d.until(() => player.pos.z > 44.5);
    await finale();
  }

  // ---------------------------------------------------------------- the finale
  let liftCalled = false, gateClosed = false, lanternReady = false, lanternState = 'wait', calmT = 0;
  async function finale() {
    CH.stage = 'finale'; checkpoint(); refreshObjective();
    sfx.setTension(0.5);
    // it is already here, standing at the hoist doors with its back to you, as if it is waiting to go up
    toZone('E', 41, 54.6); B.object.visible = true; B.anim.heading = 0; B.anim.play('faceWall', { yaw: 0 }); hunter.script(true);
    await d.wait(1);
    await say(OK, 'Rook. It\'s at the hoist, isn\'t it. ...Of course it is. It wants to go home.', 4);
    if (save.get('halloran') === 'saved' && CH.plan !== 'lure') await say(HALR, 'Doctor, I can see it on the hoist camera. Say the word. I can bring the car down.', 4.2);
    await d.wait(1);
    if (CH.plan === 'overcharge') {
      await say(OK, 'You armed the lamp. Hold the trigger. Close, Rook, closer than you want to be. In the chest.', 4.6);
      await d.wait(2);
      B.anim.play('idle', { stare: true }); sfx.creatureGrowl(B.bone.head.getWorldPosition(V(0, 0, 0)), 1.5);
      await d.wait(1.5);
      hunter.patrol = PATROL.E; hunter.script(false); hunter.suspicion = 1.2; hunter.lastSeen = V(player.pos.x, player.pos.z); hunter.stalk(); hunter.aggression = 1.4;
    } else if (CH.plan === 'lure') {
      await say(OK, 'You have the lure. Bring the car down, break it open inside, and let it go in after it. Then close the gate.', 5);
      await d.wait(1.5);
      B.anim.play('idle', { stare: true }); await d.wait(1);
      hunter.patrol = PATROL.E; hunter.script(false); hunter.hunt = 0.95; hunter.lastSeen = V(player.pos.x, player.pos.z); hunter.suspicion = 0.9; hunter.stalk();
    } else {
      await d.wait(2);
      await say('You', 'Don\'t use the light on me. Sit in the dark and let me come to you.', 3.6);
      if (save.get('files') === 'uploaded') await say(OK, 'Rook. What are you doing? ...Rook, answer me.', 3);
      game.run(lanternLoop);
    }
  }
  function overchargeHit(dist) {
    if (CH.stage !== 'finale' || CH.plan !== 'overcharge') { hunter.flashHit(1); hunter.retreatFrom(game.camera.position, 12); sfx.creatureScream(B.bone.head.getWorldPosition(V(0, 0, 0)), { dur: 2 }); return; }
    game.run(mercyKill);
  }
  async function mercyKill() {
    hunter.script(true); CH.done = true;
    sfx.creatureScream(B.bone.head.getWorldPosition(V(0, 0, 0)), { dur: 2.6 }); player.shake = 1.2;
    B.anim.play('convulse', {});
    await d.wait(3.5);
    B.anim.play('crouch', {});
    await d.wait(3);
    const truth = save.get('truth', 0) || 0;
    if (truth >= 8 || save.get('files') === 'uploaded') { await d.wait(1); await say('Lind', 'Avery.', 2.6); }
    await d.wait(2);
    B.anim.play('idle', {}); B.anim.shake = 0;
    await ending('mercy');
  }
  async function callLift() {
    liftCalled = true; sfx.beep('ok');
    const T = save.get('halloran') === 'saved' ? 12 : 35;
    if (save.get('halloran') === 'saved') await say(HALR, 'Coming down. Twelve seconds. Hold on, Doctor.', 3);
    else ui.toast(`HOIST CALLED · ${T}s`, 3);
    const loop = sfx.loop('cage', V(41, Y1 + 6, 57.4), 0.7);
    await d.wait(T);
    loop.set(0, 0.3); setTimeout(() => loop.stop(0.6), 1200); sfx.metalImpact(V(41, Y1 + 0.3, 57.4), 1);
    liftLight.intensity = 1.6; sfx.doorSlide(lift2.position, { heavy: true });
    const T0 = d.t; await d.until(() => { const k = Math.min(1, (d.t - T0) / 2); lift2.userData.setDoors?.(k); return k >= 1; });
    liftDoorBox.disabled = true; liftHere = true; refreshObjective();
  }
  async function setLure() {
    CH.lureSet = true; sfx.glassShatter(V(41, Y1 + 0.2, 57.6)); refreshObjective();
    ui.toast('THE LURE IS OPEN · GET CLEAR', 2.5);
    await d.until(() => player.pos.z < 54.5);
    // it can't help itself: it goes in, folds down over the broken canister, and stays
    hunter.script(true);
    const path = hunter.pathTo(41, 55.2) || [{ x: 41, z: 55.2 }];
    B.anim.play('follow', { path: [...path, { x: 41, z: 57.4 }], mode: 'crawl', speed: 1.4, gaze: 'forward', onArrive: () => B.anim.play('crouch', { yaw: 0 }) });
  }
  async function closeGate() {
    const inside = B.object.position.z > 56.4;
    gateClosed = true; sfx.metalImpact(V(43, Y1 + 1.1, 55.85), 0.6);
    sfx.doorSlide(lift2.position, { heavy: true });
    const T0 = d.t; await d.until(() => { const k = Math.min(1, (d.t - T0) / 1.4); lift2.userData.setDoors?.(1 - k); return k >= 1; });
    liftDoorBox.disabled = false;
    if (!inside) { gateClosed = false; sfx.beep('deny'); ui.toast('IT WASN\'T INSIDE', 2.5); liftDoorBox.disabled = true; lift2.userData.setDoors?.(1); return; }
    CH.done = true;
    sfx.creatureScream(V(41, Y1 + 1.6, 57.4), { dur: 2.2 }); sfx.knock(V(41, Y1 + 1.4, 56.1), { n: 6, gap: 0.35, hard: 1.4 }); player.shake = 0.8;
    await d.wait(2);
    const loop = sfx.loop('cage', V(41, Y1 + 2, 57.4), 0.9);
    B.object.visible = false;
    await say(HALR, save.get('halloran') === 'saved' ? 'Got it. It\'s coming up. God help me, it\'s coming up.' : '...', 3);
    await d.wait(3); loop.stop(1);
    await ending('recaptured');
  }
  async function lanternLoop() {
    // keep it calm: no torch, no lamp, no running. It comes closer each time you hold still.
    lanternState = 'approach';
    hunter.script(true);
    B.anim.play('idle', { stare: true });
    const start = B.object.position.clone();
    let k = 0;
    while (!CH.done) {
      const frame = await d.frame();
      const dist = B.anim.distToPlayer();
      const bad = (game.flashlight.on && dist < 7.5) || finaleFlash || (player.running && dist < 9);
      finaleFlash = false;
      if (bad && lanternState !== 'feral') {
        lanternState = 'feral'; lanternReady = false; calmT = 0;
        sfx.creatureScream(B.bone.head.getWorldPosition(V(0, 0, 0)), { dur: 1.6 });
        hunter.script(false); hunter.suspicion = 1.2; hunter.lastSeen = V(player.pos.x, player.pos.z); hunter.chase();
        ui.toast('NOT THE LIGHT', 2.5);
        continue;
      }
      if (lanternState === 'feral') {
        // it calms if it loses you for long enough
        if (hunter.state !== 'chase' && hunter.state !== 'attack' && !game.flashlight.on) calmT += frame; else calmT = 0;
        if (calmT > 10) { lanternState = 'approach'; hunter.script(true); B.anim.play('idle', { stare: true }); ui.toast('STAY STILL. LIGHTS OFF.', 3); }
        continue;
      }
      const still = player.vel.length() < 0.15;
      if (lanternState === 'approach') {
        if (still && !game.flashlight.on && dist > 1.25) {
          k += frame;
          if (!B.anim.actionName || B.anim.actionName !== 'follow') B.anim.play('follow', { path: [{ x: player.pos.x, z: player.pos.z }], mode: 'creep', speed: 0.42, stopAt: 1.1, gaze: 'player' });
        } else if (!still && B.anim.actionName === 'follow') B.anim.play('idle', { stare: true });
        if (dist <= 1.35) { lanternState = 'close'; B.anim.play('crouch', { yaw: B.anim.yawTo(player.pos.x, player.pos.z) }); sfx.creatureBreath(B.bone.head.getWorldPosition(V(0, 0, 0)), { intensity: 0.2 }); await d.wait(2.5); lanternReady = true; refreshObjective(); ui.toast('[E] GIVE IT THE DOSE', 4); }
      }
    }
    void start; void k;
  }
  async function giveDose() {
    lanternReady = false; CH.done = true; hunter.script(true);
    sfx.valveHiss(B.bone.upperChest.getWorldPosition(V(0, 0, 0)), { dur: 1, strength: 0.4 }); player.shake = 0.3;
    B.anim.play('convulse', {});
    await d.wait(2.8);
    B.anim.play('crouch', {});
    await d.wait(3);
    const trueEnd = save.get('files') === 'uploaded' && save.get('halloran') === 'saved' && expo.value < 40;
    if (trueEnd) {
      await d.wait(1.5);
      B.anim.play('idle', {});
      await d.wait(2.5);
      await say('Lind', '...Rook.', 2.4);
      // it lets you lead it out
      game.run(callLiftQuiet);
      await d.until(() => liftHere);
      B.anim.play('follow', { path: [{ x: 41, z: 55.4 }, { x: 41, z: 57.6 }], mode: 'walk', speed: 0.5, gaze: 'forward', onArrive: () => B.anim.play('faceWall', { yaw: Math.PI }) });
      await d.wait(6);
      await ending('lantern');
    } else {
      await d.wait(4);
      await ending('quiet');
    }
  }
  async function callLiftQuiet() {
    await say(HALR, 'Doctor? I\'m bringing the car down.', 2.6);
    await d.wait(8);
    sfx.metalImpact(V(41, Y1 + 0.3, 57.4), 1); liftLight.intensity = 1.6; sfx.doorSlide(lift2.position, { heavy: true });
    const T0 = d.t; await d.until(() => { const k = Math.min(1, (d.t - T0) / 2); lift2.userData.setDoors?.(k); return k >= 1; });
    liftDoorBox.disabled = true; liftHere = true;
  }

  // ---------------------------------------------------------------- endings
  const ENDINGS = {
    recaptured: ['RECAPTURED', [
      'The hoist brings it up folded into a corner of the car, holding the broken lure against its chest like something precious.',
      'Okafor thanks you on the record. The board names you lead on C-14.',
      'Your first morning in Lind\'s old office, someone has put the chairs in rows. In Cell B, the lights flicker when you look at it.',
    ]],
    quiet: ['RECAPTURED', [
      'It sits down in the hoist car and does not move again.',
      'Okafor\'s team takes it from you at the top. It doesn\'t resist. Whatever was left of Teodor Lind, the dose found it too late.',
      'They let you keep his badge. Nobody asks why you want it.',
    ]],
    mercy: ['THE LAMP\'S MERCY', [
      'It takes a long time to stop moving. You stay with it until it does.',
      'They bury what is left of it in the hillside above the mine, on a grey morning, in a hole the response team digs and then leaves.',
      'Nobody else comes. You stand there until the vans have gone, and then a while longer.',
    ]],
    lantern: ['LANTERN', [
      'It does not become Lind again. But at the top of the shaft it stops in the door of the car, and looks back at the dark, and then at you, and lets you lead it out into the morning.',
      'The hearings take a year. The LANTERN files are read into the record page by page. Okafor is taken out of the building in handcuffs. Site 41 is closed.',
      'In the empty lab, nobody has switched off the camera in Cell A. On the last night of the recording, its occupant turns its head toward the lens.',
    ]],
    longdark: ['THE LONG DARK', [
      'It goes up the shaft without you.',
      'Months later, a local news report: three hikers missing in the hills above an old mine. Search teams. A photograph from one of their phones.',
      'At the edge of the picture, in the trees, a tall shape is standing with its back to the camera.',
    ]],
    replacement: ['REPLACEMENT', [
      'You make it out. Okafor is waiting at the top of the shaft with two orderlies and a blanket. “You did well, Rook,” she says, and looks at your hands for a long time.',
      'Your hands ache. Your fingers feel too long.',
      'Weeks later, from inside Cell B, you watch a new researcher read your name off the label on the glass.',
    ]],
  };
  async function ending(kind) {
    CH.done = true; CH.stage = 'end';
    const exposure = expo.value, ob = save.get('obedience', 0) || 0;
    if (kind !== 'longdark' && exposure >= 70 && save.get('files') === 'burned' && save.get('halloran') !== 'saved') kind = 'replacement';
    void ob;
    CH.ending = kind; save.set('ending', kind); save.set('ch5', null);
    ui.objective(null); sfx.setTension(0); sfx.heartbeat(0);
    player.frozen = true;
    await ui.fadeTo(1, 3);
    hunter.script(true); B.object.visible = false; fanLoop.stop?.(0.5);
    sfx.setAmbience('none', 0, 3);
    const [title, lines] = ENDINGS[kind];
    await d.wait(1);
    for (const l of lines) await ui.card('', l, Math.max(4.5, l.length * 0.055));
    await ui.card(title, 'an ending', 4.5);
    await ui.card('THE TALL ONE', 'thank you for playing', 4);
    location.href = location.pathname;
  }

  // ---------------------------------------------------------------- death
  async function die(reason) {
    if (CH.dead) return; CH.dead = true;
    sfx.creatureScream(game.camera.position, { dur: 1.2 }); sfx.stinger('hit');
    ui.red(true); ui.setFade(1); player.frozen = true;
    await new Promise((r) => setTimeout(r, 900));
    ui.red(false); if (hide.current) ui.hiding(false);
    const st = save.get('ch5') || {};
    st.deaths = (st.deaths || 0) + 1;
    if (CH.stage === 'finale') {
      st.finaleDeaths = (st.finaleDeaths || 0) + 1;
      if (st.finaleDeaths >= 3) { save.set('ch5', st); CH.dead = false; ui.setFade(1); return ending('longdark'); }
    }
    save.set('ch5', st);
    await ui.death(reason === 'gas' ? 'THE PURGE' : 'YOU WERE TAKEN', reason === 'gas' ? 'The agent reached you. Keep your respirator on, and keep moving up.' : CH.stage === 'finale' ? `It is desperate now. (${3 - st.finaleDeaths} more and it goes up without you.)` : 'It is desperate now. It will not wait at the edge of anything.', game.input);
    game.load(chapter5, { state: { ...st, dead: false }, restart: true });
  }

  // ---------------------------------------------------------------- restore and start
  if (CH.valve) valve.rotation.x = 8;
  if (CH.iso.length) CH.iso.forEach((i) => isoObjs[i].userData.setOn?.(false));
  if (CH.iso.length >= 1) shed('gallery');
  if (CH.iso.length >= 2) shed('switch');
  if (CH.iso.length >= 3) { shed('battery'); fanDoor.userData.setOpen?.(0.9); fanDoorBox.disabled = true; fanLamp.material.emissive.set(0x10ff40); }
  if (CH.fanOff) { fanSpin = 0; fanLoop.stop(0); fanBox.disabled = true; }
  rebuildGrid();
  window.__ch5 = { CH, hunter, B, player, interact, grid, hide, expo, resp, lamp, groundAt, cling, use: (re) => { const it = interact.items.find((i) => i.enabled() && re.test(typeof i.label === 'function' ? i.label() : i.label)); if (it) it.onUse(it); return !!it; } };

  async function opening() {
    if (!opts.restart) { await arrival(); return; }
    ui.setFade(1);
    liftObj.userData.setDoors?.(0.8); cageDoor.disabled = true;
    sfx.setAmbience('purge', 0.6, 2); sfx.setReverb('large');
    const at = { cage: [0, 3, 0, 0], plant: [0, 3, 0, 0], core: [0, 16, 0, 0], gallery: [11, 15.3, Y1, -Math.PI / 2], fan: [33, 15.3, Y1, -Math.PI / 2], duct: [40, 31, Y1, Math.PI], finale: [40, 45, Y1, Math.PI] }[CH.stage] || [0, 3, 0, 0];
    if (CH.stage === 'core') { CH.stage = 'plant'; CH.door = 0.75; coreDoor.position.y = 1.5 + 0.75 * 2.1; coreBox.disabled = true; at[1] = 12; }
    if (CH.stage === 'cage') CH.stage = 'plant';
    player.groundY = at[2]; player.place(at[0], at[1], at[3], 0); player.groundY = at[2];
    ui.fadeTo(0, 1.5);
    refreshObjective();
    if (CH.stage === 'plant') { toZone('A', -12.5, 3); B.object.visible = true; hunter.script(false); hunter.set('idle'); gasStart = d.t - 30; if (CH.door >= 0.75) game.run(enterCore); }
    if (CH.stage === 'gallery') { toZone('C', 30, 15.3); B.object.visible = true; hunter.script(false); hunter.set('idle'); gasCStart = d.t; }
    if (CH.stage === 'fan') { toZone('C', 24, 22.6); B.object.visible = true; hunter.script(false); hunter.set('idle'); gasCStart = d.t - 60; gasCRate = 0.008; if (CH.fanOff) game.run(async () => { await d.until(() => player.pos.z > 30.5); CH.stage = 'duct'; hunter.script(true); B.object.visible = false; await d.until(() => player.pos.z > 44.5); await finale(); }); }
    if (CH.stage === 'duct') { game.run(async () => { await d.until(() => player.pos.z > 44.5); await finale(); }); }
    if (CH.stage === 'finale') { CH.stage = 'duct'; player.place(40, 42, Math.PI, 0); game.run(async () => { await d.until(() => player.pos.z > 44.5); await finale(); }); }
  }
  const cp = opts.checkpoint || game.params.get('cp');
  if (cp && cp !== 'still' && !opts.restart && !opts.state) {
    const stage = { core: 'core', gallery: 'gallery', fan: 'fan', finale: 'finale' }[cp] || 'plant';
    Object.assign(CH, { stage, valve: true, mask: true });
    if (['gallery', 'fan', 'finale'].includes(stage)) CH.door = 1;
    if (['fan', 'finale'].includes(stage)) CH.iso = [0, 1, 2];
    if (stage === 'finale') CH.fanOff = true;
    if (game.params.has('plan')) CH.plan = game.params.get('plan');
    lamp.overcharge = CH.plan === 'overcharge';
    if (CH.iso.length >= 3) { shed('gallery'); shed('switch'); shed('battery'); fanDoor.userData.setOpen?.(0.9); fanDoorBox.disabled = true; }
    if (CH.fanOff) { fanSpin = 0; fanLoop.stop(0); fanBox.disabled = true; }
    rebuildGrid();
    opts.restart = true;
  }
  if (game.params.get('cp') === 'still') { ui.setFade(0); applyDebugCamera(game); if (game.params.has('y')) player.groundY = parseFloat(game.params.get('y')); }
  else game.run(opening);

  // ---------------------------------------------------------------- frame
  return {
    look: 'horror', ownFade: true,
    update(dt, t) {
      const ctx = creatureCtx(game);
      if (B.object.visible && !clinging) {
        B.object.position.y = upper(B.object.position.x, B.object.position.z) ? Y1 : 0;
        B.update(dt, ctx); if (hunter.enabled) hunter.update(dt); player.shake = Math.max(player.shake, B.anim.shake);
      }
      if (clinging) clingT = clingT || d.t; else clingT = 0;
      lamp.update(dt);
      if (inRect(ROOMS.duct, player.pos.x, player.pos.z, 0.1) && player.groundY > 10 && !player.frozen && !player.crouch) { player.crouch = true; if (!lowWarned) { lowWarned = true; ui.toast('TOO LOW TO STAND', 2); } }
      // the fan
      fan.userData.blades.rotation.z -= dt * 14 * fanSpin;
      // gas rising: Level 200 after the doors, the core behind you, Level 100
      if (gasStart >= 0) gasA.setLevel(Math.min(2.4, (d.t - gasStart) * 0.0045));
      if (gasCoreStart >= 0) gasCore.setLevel(Math.min(Y1 - 2, (d.t - gasCoreStart) * 0.06));
      if (gasCStart >= 0) gasC.setLevel(Y1 + Math.min(2.2, (d.t - gasCStart) * gasCRate));
      for (const g of [gasA, gasCore, gasC]) g.update(dt, t);
      const px = player.pos.x, pz = player.pos.z, eyeY = player.groundY + player.eyeCur;
      const zoneGas = upper(px, pz) ? gasC : inRect(ROOMS.core, px, pz) ? gasCore : gasA;
      const inGas = zoneGas.layers[0].visible && zoneGas.level > eyeY - 0.25;
      const nearGas = zoneGas.layers[0].visible && zoneGas.level > eyeY - 1.2;
      if (game.input.wasPressed('KeyM') && CH.mask && !hide.current) { CH.maskOn = !CH.maskOn; resp.wear(CH.maskOn); }
      const ok = resp.update(dt, nearGas, game.fear);
      if (inGas && !ok) { expo.add(dt * 4); player.shake = Math.max(player.shake, 0.25); if (!CH.dead && expo.value >= 100) die('gas'); }
      else if (nearGas && !ok) expo.add(dt * 0.6);
      expo.update(dt);
      // the lights stutter as the controller sheds load
      for (const n of ['plant', 'gallery', 'switch', 'battery', 'fan', 'lobby']) flick(n, 0.012);
      objT -= dt; if (objT <= 0) { objT = 0.5; if (CH.stage !== 'end') refreshObjective(); }
      const dd = B.object.visible && !clinging ? B.anim.distToPlayer() : 99;
      game.fear = hunter.enabled && hunter.state !== 'scripted' ? Math.max(0, 1 - dd / 9) * (hunter.state === 'chase' ? 1 : 0.6) : clinging ? 0.5 : Math.max(0, 1 - dd / 10) * 0.5;
      sfx.heartbeat(hunter.enabled && hunter.state !== 'scripted' && dd < 6 && B.object.visible ? 70 + (6 - dd) * 12 : lanternState === 'close' || lanternState === 'approach' ? 60 + Math.max(0, 6 - dd) * 8 : 0);
    },
    dispose() { sfx.setTension(0); sfx.heartbeat(0); fanLoop.stop?.(0.2); expo.dispose(); resp.dispose(); },
  };
}
