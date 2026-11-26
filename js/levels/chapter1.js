// CHAPTER ONE: THE BUILD-OUT
// Wing D, an abandoned construction floor. Get the freight lift running before B reaches it:
// find diesel, start the generator, close three zone breakers (each one lights a zone it will
// not enter), find Lind's lift key in his site office, then survive the wait for the lift.
import * as THREE from 'three';
import { Creature } from '../creature.js';
import { loadCreatureModel, creatureBlockers, creatureCtx, applyDebugCamera } from './common.js';
import { sfx } from '../engine/game.js';
import { save } from '../save.js';
import { NavGrid } from '../ai/navgrid.js';
import { Hunter } from '../ai/hunter.js';
import { HalideLamp } from '../engine/lamp.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const OK = 'Dr. Okafor', LIND = 'Lind (recording)', UNKNOWN = 'Unknown voice';
const H = 3.4; // slab-to-deck height

// ------------------------------------------------------------------ floor plan
const PLAN = {
  corridor: { x0: -15, x1: -7, z0: -5.2, z1: -2.8 },
  floor: { x0: -51, x1: -15, z0: -20, z1: 14 },
  rooms: {
    office: { x0: -24, x1: -15, z0: 6, z1: 14 },     // Lind's site office
    store: { x0: -32, x1: -24, z0: 6, z1: 14 },      // contractors' store
    electrical: { x0: -40, x1: -32, z0: 6, z1: 14 },
    west: { x0: -51, x1: -40, z0: -6, z1: 14 },       // freight lift lobby
    bay: { x0: -51, x1: -40, z0: -20, z1: -6 },       // loading bay + generator
    south: { x0: -40, x1: -15, z0: -20, z1: -12 },    // south corridor
    open: { x0: -40, x1: -15, z0: -12, z1: 6 },       // the open floor
  },
};
// what each powered zone lights (the creature will not enter these)
const ZONES = {
  bay: [PLAN.rooms.bay],
  electrical: [PLAN.rooms.electrical, PLAN.rooms.store],
  south: [PLAN.rooms.south],
  west: [PLAN.rooms.west],
};

const DOCS = {
  memo: {
    ref: 'SITE INSTRUCTION 14 · WING D', title: 'Build-out suspended',
    body: `<p>To all trades. Effective immediately, the Wing D fit-out is <b>suspended</b>. Remove personal tools by Friday. Plant stays on site.</p>
<p>Do not remove the temporary supply. Do not disconnect the freight lift. Sublevel deliveries continue under cost code <b>LANTERN-D</b> and are not to be signed for by trade staff.</p>
<p>Anyone found below D-1 without escort will be removed from the contract.</p>
<p style="text-align:right">— M. Varga, Site Manager, for Halversen Estates</p>`,
  },
  note: {
    ref: 'HANDWRITTEN · DESK DRAWER', title: 'A note in Lind’s handwriting',
    body: `<p><i>Imani. If you are reading this in my office, then either it worked and I am standing behind you, or it did not and you are looking for the key.</i></p>
<p><i>The key is in the drawer. It always was. I never locked anything in my life.</i></p>
<p><i>LANTERN-0 is where we agreed. Do not let them move it. If I come back wrong, I will still know the way there. Something in me will.</i></p>
<p><i>— T.</i></p>`,
  },
  calendar: {
    ref: 'WALL CALENDAR · SITE OFFICE', title: 'Eight months, crossed out',
    body: `<p>Every day since March is crossed out in the same blue pen. The crosses get harder as they go, until they tear the paper.</p>
<p>One date is circled twice: <b>the 14th</b>, eight months ago. Under it, in small capitals: <b>EXPOSURE · DAY 0</b>.</p>
<p>The last week has no crosses at all.</p>`,
  },
};

const TAPE = [
  [LIND, 'Site log. Teodor Lind. Fourteenth of March.', 3.4],
  [LIND, 'Exposure tomorrow, oh-six-hundred. Imani wants it done before the auditors are back.', 4.6],
  [LIND, 'For the record: I volunteered. Nobody made me. Write that down somewhere they can\'t shred it.', 5.2],
  [LIND, 'Counter-agent is prepared. One dose. If it fails, they won\'t make another.', 4.6],
  [LIND, '...If this works, I\'ll be the first person to come back.', 3.8],
  [LIND, 'If it doesn\'t—', 1.8],
  [LIND, '(a long breath)', 2.2],
  [LIND, 'If it doesn\'t, Imani, don\'t let them put me next to it. Not in the same room. Please.', 5.2],
];

// ------------------------------------------------------------------ the level
export async function chapter1(game, opts = {}) {
  const { scene, player, ui, director: d, interact, renderer } = game;
  const say = (who, text, dur) => ui.say(who, text, dur);
  renderer.toneMappingExposure = 1.2;
  scene.background = new THREE.Color(0x020203);
  scene.fog = new THREE.FogExp2(0x030405, 0.04);
  game.surface = 'concrete';

  // state that survives a death (restored from the last checkpoint)
  const CH = Object.assign({ fuel: false, refuelled: false, gen: false, breakers: { electrical: false, south: false, west: false }, key: false, tape: false, cells: [], docs: [], lift: false, glimpse: false }, opts.state || {});
  const checkpoint = () => save.set('ch1', JSON.parse(JSON.stringify(CH)));

  // ---------------------------------------------------------------- assets
  const [kitMod, P] = await Promise.all([
    import('../wingd/kit.js').catch((e) => { console.warn('wing D kit unavailable', e); return null; }),
    import('../lab/props.js').catch(() => ({})),
  ]);
  if (kitMod?.loadKit) await kitMod.loadKit((a, b) => game.onProgress?.(a / b)).catch((e) => console.warn(e));
  const K = kitMod?.KIT || {};
  const fbMat = new THREE.MeshStandardMaterial({ color: 0x6b6862, roughness: 0.9 });
  const fallback = (w, h, dd) => { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), fbMat); m.position.y = h / 2; m.castShadow = m.receiveShadow = true; g.add(m); g.userData.collider = { w, d: dd }; return g; };
  const kit = (name, args = [], fb) => { try { if (typeof K[name] === 'function') return K[name](...args); } catch (e) { console.warn('kit', name, e); } return fb ? fallback(...fb) : new THREE.Group(); };
  const model = (id, fb) => { try { if (K.model) { const m = K.model(id); if (m) return m; } } catch (e) { console.warn('model', id, e); } return fb ? fallback(...fb) : new THREE.Group(); };
  const M = K.materials || {};
  const mat = (k, color) => M[k] || new THREE.MeshStandardMaterial({ color, roughness: 0.9 });

  // ---------------------------------------------------------------- structure
  const colliders = [];
  const parts = new Map();
  const MATKEY = { slab: 'slab', deck: 'soffit', wall: 'concreteWall' };
  const box = (mk, x0, x1, y0, y1, z0, z1, collide = true) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    if (K.worldUV) K.worldUV(g, M[MATKEY[mk]]?.userData?.tile || 2.4);
    if (!parts.has(mk)) parts.set(mk, []); parts.get(mk).push(g);
    if (collide && y0 < 1.5) colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 });
  };
  const F = PLAN.floor, C = PLAN.corridor;
  // slab + deck (the kit's baked slab and beamed soffit; plain boxes if the kit is missing)
  const slab = kit('floorSlab', [{ w: F.x1 - F.x0, d: F.z1 - F.z0, seed: 4, joints: 6 }], null);
  if (slab.children.length) { slab.position.set((F.x0 + F.x1) / 2, 0, (F.z0 + F.z1) / 2); scene.add(slab); } else box('slab', F.x0, F.x1, -0.2, 0, F.z0, F.z1, false);
  const deckObj = kit('deck', [{ w: F.x1 - F.x0, d: F.z1 - F.z0, h: H - 0.35, beamEvery: 6, beamD: 0.35, seed: 6 }], null);
  if (deckObj.children.length) { deckObj.position.set((F.x0 + F.x1) / 2, 0, (F.z0 + F.z1) / 2); scene.add(deckObj); } else box('deck', F.x0, F.x1, H, H + 0.3, F.z0, F.z1, false);
  box('slab', C.x0, C.x1, -0.2, 0, C.z0, C.z1, false); box('deck', C.x0, C.x1, 2.9, 3.2, C.z0, C.z1, false);
  box('deck', F.x0, F.x1, H, H + 0.25, F.z0, F.z1, false); // backing above the soffit (light leaks)
  // perimeter walls (concrete), with the corridor opening on the east
  const T = 0.3;
  box('wall', F.x0 - T, F.x1 + T, 0, H, F.z1, F.z1 + T); box('wall', F.x0 - T, F.x1 + T, 0, H, F.z0 - T, F.z0);
  const LIFT = { z: 4, w: 2.6, h: 2.8 };
  box('wall', F.x0 - T, F.x0, 0, H, F.z0, LIFT.z - LIFT.w / 2); box('wall', F.x0 - T, F.x0, 0, H, LIFT.z + LIFT.w / 2, F.z1);
  box('wall', F.x0 - T, F.x0, LIFT.h, H, LIFT.z - LIFT.w / 2, LIFT.z + LIFT.w / 2, false);
  box('wall', F.x1, F.x1 + T, 0, H, F.z0, C.z0); box('wall', F.x1, F.x1 + T, 0, H, C.z1, F.z1); box('wall', F.x1, F.x1 + T, 2.9, H, C.z0, C.z1, false);
  box('wall', C.x0, C.x1, 0, 3.2, C.z0 - T, C.z0); box('wall', C.x0, C.x1, 0, 3.2, C.z1, C.z1 + T); box('wall', C.x1, C.x1 + T, 0, 3.2, C.z0, C.z1);
  // concrete upstand + lift shaft wall around the freight lift
  for (const [mk, m] of [['slab', mat('slab', 0x58564f)], ['deck', mat('soffit', 0x4c4a45)], ['wall', mat('concreteWall', 0x5b5953)]]) {
    const geos = parts.get(mk); if (!geos) continue;
    const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
    const mesh = new THREE.Mesh(mergeGeometries(geos), m); mesh.receiveShadow = true; mesh.castShadow = mk === 'wall'; scene.add(mesh);
  }

  // placement helpers
  const place = (obj, x, z, rot = 0, y = 0) => {
    obj.position.set(x, y, z); obj.rotation.y = rot; scene.add(obj);
    const sw = Math.abs(Math.sin(rot)) > 0.5;
    const addLocal = (b) => {
      // local box -> world (rotations are multiples of 90 degrees)
      const corners = [[b.minX, b.minZ], [b.maxX, b.maxZ]].map(([lx, lz]) => { const c = Math.cos(rot), s = Math.sin(rot); return [x + lx * c + lz * s, z - lx * s + lz * c]; });
      colliders.push({ minX: Math.min(corners[0][0], corners[1][0]), maxX: Math.max(corners[0][0], corners[1][0]), minZ: Math.min(corners[0][1], corners[1][1]), maxZ: Math.max(corners[0][1], corners[1][1]) });
    };
    if (Array.isArray(obj.userData?.colliders)) obj.userData.colliders.forEach(addLocal);
    else if (obj.userData?.collider && y === 0) { const c = obj.userData.collider; const w = sw ? c.d : c.w, dd = sw ? c.w : c.d; colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - dd / 2, maxZ: z + dd / 2 }); }
    return obj;
  };
  const R = { N: 0, S: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 }; // the way the front (+Z) faces: east = +X, north = +Z
  // stud partitions: from (x0,z0) to (x1,z1), axis-aligned; openings as distances along the wall
  const sightBlockers = [];
  function partition(x0, z0, x1, z1, { boards = 0.5, openings = [], seed = 1, opaque = true } = {}) {
    const along = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const len = along ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
    const w = kit('studWall', [{ length: len, height: 2.9, boards, openings, seed }], null);
    if (!w.children.length) { // fallback: solid boards with gaps for openings
      let prev = 0;
      for (const o of [...openings, { at: len + 0.5, width: 0 }]) { const a = prev, b = o.at - o.width / 2; if (b > a) { const m = new THREE.Mesh(new THREE.BoxGeometry(b - a, 2.9, 0.12), fbMat); m.position.set((a + b) / 2 - len / 2, 1.45, 0); m.castShadow = m.receiveShadow = true; w.add(m); } prev = o.at + o.width / 2; }
    }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    w.position.set(along ? Math.min(x0, x1) + len / 2 : cx, 0, along ? cz : Math.min(z0, z1) + len / 2); w.rotation.y = along ? 0 : -Math.PI / 2; // local +X runs along +Z so openings line up with their gaps
    if (!w.userData.colliders && !w.userData.collider) w.userData.collider = null;
    scene.add(w);
    // collision + sight: the wall minus its openings
    let prev = 0;
    for (const o of [...openings, { at: len + 0.5, width: 0 }]) {
      const a = prev, b = Math.min(len, o.at - o.width / 2);
      if (b > a) {
        const s0 = (along ? Math.min(x0, x1) : Math.min(z0, z1)) + a, s1 = (along ? Math.min(x0, x1) : Math.min(z0, z1)) + b;
        const bx = along ? { minX: s0, maxX: s1, minZ: cz - 0.08, maxZ: cz + 0.08, thin: true } : { minX: cx - 0.08, maxX: cx + 0.08, minZ: s0, maxZ: s1, thin: true };
        colliders.push(bx); if (opaque && boards > 0.25) sightBlockers.push(bx);
      }
      prev = o.at + o.width / 2;
    }
    return w;
  }
  const RM = PLAN.rooms;
  // office row (north): front wall with three doors, dividing walls
  partition(-40, 6, -15, 6, { boards: 0.85, openings: [{ at: 4, width: 1.3 }, { at: 12, width: 1.3 }, { at: 21.5, width: 1.3 }], seed: 2 });
  partition(-24, 6, -24, 14, { boards: 0.9, seed: 3 });
  partition(-32, 6, -32, 14, { boards: 0.7, seed: 4 });
  partition(-40, 6, -40, 14, { boards: 0.6, seed: 5 });
  // west wing divider (with a wide gap) and loading-bay wall
  partition(-40, -6, -40, 6, { boards: 0.35, openings: [{ at: 6, width: 3.2 }], seed: 6 });
  partition(-51, -6, -40, -6, { boards: 0.5, openings: [{ at: 8.5, width: 2.6 }], seed: 7 });
  partition(-40, -20, -40, -6, { boards: 0.6, openings: [{ at: 9, width: 1.7 }], seed: 8 });
  // south corridor wall
  partition(-40, -12, -15, -12, { boards: 0.55, openings: [{ at: 6, width: 1.4 }, { at: 19, width: 1.4 }], seed: 9 });

  // columns on a 6 m grid through the open floor
  for (const x of [-21, -27, -33]) for (const z of [-8, -2, 4]) {
    const c = place(kit('column', [{ h: H, w: 0.5 }], [0.5, H, 0.5]), x, z);
    colliders.push({ minX: x - 0.25, maxX: x + 0.25, minZ: z - 0.25, maxZ: z + 0.25 });
    sightBlockers.push({ minX: x - 0.25, maxX: x + 0.25, minZ: z - 0.25, maxZ: z + 0.25 });
  }
  // plastic sheeting curtains (block sight, not movement)
  const sheets = [];
  for (const [x, z, rot, w] of [[-24, -5, R.W, 3], [-30, 1, 0, 3.4], [-37, -2.5, R.W, 2.8], [-28, -16, R.W, 3], [-22, -16, R.W, 3], [-42.5, -6, 0, 2.6], [-43, 2, R.W, 3]]) {
    const s = kit('sheeting', [{ w, h: 2.9 }], null);
    s.position.set(x, 0, z); s.rotation.y = rot; s.userData.dynamic = true; scene.add(s); sheets.push(s);
    const half = w / 2;
    sightBlockers.push(Math.abs(Math.sin(rot)) > 0.5 ? { minX: x - 0.05, maxX: x + 0.05, minZ: z - half, maxZ: z + half } : { minX: x - half, maxX: x + half, minZ: z - 0.05, maxZ: z + 0.05 });
  }

  // ---------------------------------------------------------------- dressing
  // open floor: scaffold, pallets, materials, ladders, a dead work light
  place(kit('scaffold', [{ w: 2.6, d: 1.2, h: 3.2, levels: 2 }], [2.6, 3.2, 1.2]), -30, -6.2, 0);
  place(kit('pallet', [{ load: 'drywall', seed: 1 }], [1.2, 0.6, 1.0]), -25.5, 1.8, 0.2);
  place(kit('pallet', [{ load: 'cement', seed: 2 }], [1.2, 0.7, 1.0]), -35.5, 2.4, -0.3);
  place(kit('pallet', [{ load: 'blocks', seed: 3 }], [1.2, 0.8, 1.0]), -19, -9.8, 0.1);
  place(kit('pallet', [{ load: 'pipes', seed: 4 }], [1.2, 0.5, 2.4]), -37.5, -10, R.W);
  place(kit('drywallStack', [], [1.2, 0.4, 2.4]), -22.5, 3.6, R.W);
  place(kit('rebarBundle', [], [0.4, 0.3, 3]), -33.5, -3.2, 0.3);
  place(kit('sawhorse', [], [1, 0.8, 0.4]), -28.6, 2.6, 0.5);
  place(kit('barrier', [], [2, 1, 0.4]), -17.5, -3.9, R.W);
  place(model('metal_tool_chest', [0.7, 0.65, 0.4]), -31.5, -3.5, 0.8);
  place(model('cement_bag', [0.5, 0.15, 0.8]), -34.7, 3.2, 1.2);
  place(model('cardboard_box_01', [0.5, 0.5, 0.5]), -20.2, 2.2, 0.4);
  place(model('plastic_crate_03', [0.5, 0.3, 0.3]), -38.4, -0.6, 0.2);
  place(model('trashbag', null), -38.6, 4.9, 0.7); place(model('trashbag', null), -37.9, 5.3, 2.1);
  { const lad = model('ladder_sectioned_01', null); lad.rotation.x = -0.28; const lg = new THREE.Group(); lg.add(lad); lad.position.z = 0.35; place(lg, -26.75, -8, R.E); }
  place(model('plastic_jerrycan', null), -16.5, -2.4, 0.6);
  place(model('wooden_broom', null), -15.4, 1.5, R.W);
  place(kit('debris', [{ w: 24, d: 17, seed: 3 }], null), -27.5, -3);
  place(kit('debris', [{ w: 10, d: 14, seed: 5 }], null), -45.5, 4);
  place(kit('debris', [{ w: 10, d: 13, seed: 7 }], null), -45.5, -13);
  place(kit('debris', [{ w: 24, d: 7, seed: 9 }], null), -27.5, -16);
  for (const [x, y, z, w, sd] of [[-27.5, 2.86, -6, 24, 2], [-27.5, 2.86, 2, 24, 5]]) { const dr = kit('ductRun', [{ length: w, rise: H - y, seed: sd }], null); dr.position.set(x, y, z); scene.add(dr); }
  for (const z of [-15.5, 9.5]) { const pr = kit('pipeRun', [{ length: 34, rise: H - 2.98 }], null); pr.position.set(-33, 2.98, z); scene.add(pr); }
  const hc = kit('hangingCables', [{ w: 20, d: 14, count: 14 }], null); hc.position.set(-28, H, -3); scene.add(hc);
  // tape across the dangerous bits
  scene.add(kit('cautionTape', [V(-34.7, 1.0, -12), V(-33.3, 1.0, -12), { sag: 0.06 }], null));
  scene.add(kit('cautionTape', [V(-40, 1.05, -11.8), V(-40, 1.0, -10.2), { torn: true }], null)); // it went through here
  scene.add(kit('cautionTape', [V(-40, 1.0, -1.6), V(-40, 1.05, 1.6), { torn: true, seed: 4 }], null));
  // spray marks
  for (const [txt, x, y, z, rot] of [['ZONE 1', -15.2, 1.8, -8, R.W], ['NO ACCESS BELOW D-1', -50.97, 1.9, 7.6, R.E], ['GEN →', -39.9, 1.6, -9, R.E], ['LIFT ←', -39.9, 1.6, -3.5, R.E], ['D4', -27.27, 1.6, -2, R.W], ['IT HEARS YOU', -32.1, 1.3, 11.5, R.E]]) {
    const m = kit('sprayMark', [txt, { w: txt.length > 10 ? 1.8 : 1.1, h: 0.34, color: txt === 'IT HEARS YOU' ? '#8a1a12' : '#d9d4c8' }], null); m.position.set(x, y, z); m.rotation.y = rot; scene.add(m);
  }

  // store room (fuel, a spare cell, the memo)
  // shelving, stocked with whatever the trades left behind
  let shelfSeed = 7;
  const srand = () => { shelfSeed = (shelfSeed * 16807) % 2147483647; return shelfSeed / 2147483647; };
  const STOCK = [['cardboard_box_01', 0.52, Math.PI / 2], ['plastic_crate_03', 0.5, 0], ['spray_paint_bottles', 0.2, 0], ['plastic_jerrycan', 0.3, Math.PI / 2], ['Drill_01', 0.2, 0.3], ['binder_notebook', 0.6, 0]];
  function shelf(x, z, rot, empty = []) {
    const sh = model('steel_frame_shelves_01', [1.1, 2.1, 0.5]);
    const g = new THREE.Group(); g.add(sh);
    [0.115, 0.625, 1.135, 1.635].forEach((y, lv) => {
      if (empty.includes(lv)) return;
      let u = -0.5;
      while (u < 0.45) {
        const [id, w, r0] = STOCK[Math.floor(srand() * STOCK.length)];
        if (u + w > 0.52) break;
        if (srand() < 0.25) { u += 0.15; continue; }
        const m = model(id, null); m.position.set(u + w / 2, y, (srand() - 0.5) * 0.06); m.rotation.y = r0 + (srand() - 0.5) * 0.25; g.add(m);
        u += w + 0.03;
      }
    });
    g.userData.collider = { w: 1.1, d: 0.5 };
    return place(g, x, z, rot);
  }
  shelf(-28, 13.7, R.S); shelf(-29.2, 13.7, R.S, [2]);
  shelf(-31.68, 10, R.E, [1]); shelf(-31.68, 11.2, R.E);
  place(model('metal_tool_chest', [0.7, 0.65, 0.4]), -26.0, 13.5, R.S);
  place(model('propane_tank', null), -24.6, 13.5, 0);
  place(model('plastic_crate_03', [0.6, 0.35, 0.4]), -25, 7.2, 0.4);
  const fuelCan = place(kit('fuelCan', [], [0.35, 0.45, 0.17]), -29.3, 7.3, 0.6);
  fuelCan.userData.dynamic = true;
  const memo = place(model('clipboard', [0.25, 0.02, 0.33]), -25.2, 13.3, R.S, 0.9);
  // electrical room: breaker for zones 2+3 side
  // site office (Lind)
  const office = place(kit('siteOffice', [], null), -19.5, 10, R.S);
  const officePts = office.userData.points || {};
  const opt = (k, dflt) => (officePts[k] ? office.localToWorld(officePts[k].clone()) : dflt);
  office.updateMatrixWorld(true);
  // west wing: lockers, compressor, the lift
  place(kit('pallet', [{ load: 'cement', seed: 8 }], [1.2, 0.7, 1.0]), -47, 12.8, 0.05);
  place(model('hand_truck', null), -45.4, 13.2, 0.3);
  const lift = place(kit('freightLift', [{ w: LIFT.w, d: 2.4, h: LIFT.h, wall: T }], [2.8, 2.9, 0.4]), F.x0, LIFT.z, R.E);
  lift.userData.dynamic = true;
  // the landing doors block the car until they open (local box -> world; the lift faces east)
  const dcl = lift.userData.doorCollider || { minX: -1.3, maxX: 1.3, minZ: -0.12, maxZ: 0 };
  const liftDoorBox = { minX: F.x0 + dcl.minZ, maxX: F.x0 + dcl.maxZ, minZ: LIFT.z - dcl.maxX, maxZ: LIFT.z - dcl.minX };
  const liftDoorClosed = { ...liftDoorBox };
  colliders.push(liftDoorBox);
  // loading bay: generator, fuel drums, the roller door
  const gen = place(kit('generator', [], [2.2, 1.4, 1.0]), -46.5, -14, 0.1);
  gen.userData.dynamic = true;
  place(model('propane_tank', [0.4, 1.2, 0.4]), -49.8, -18.7, 0);
  place(model('hand_truck', [0.5, 1.2, 0.5]), -43, -18.8, 0.4);
  place(model('cardboard_box_01', null), -49.5, -8.5, 0.1); place(model('cardboard_box_01', null), -49.1, -7.9, 0.9);
  place(model('trashbag', null), -41.2, -7.2, 0);
  place(model('steel_frame_shelves_01', null), -44, -19.5, R.N);
  // lockers to hide in
  const lockers = [];
  for (const [x, z, rot] of [[-38.9, 13.6, R.S], [-50.65, 12.4, R.E], [-30.5, -19.65, R.N], [-40.4, -15, R.W], [-15.4, 8.4, R.W]]) {
    const l = place(kit('lockerHide', [], [0.55, 2, 0.55]), x, z, rot); l.userData.dynamic = true; lockers.push(l);
  }
  // breaker panels on walls
  const breakers = {
    electrical: { pos: V(-36, 1.4, 14), rot: R.S, label: 'ZONE 2 · NORTH' },
    south: { pos: V(-15, 1.4, -16), rot: R.W, label: 'ZONE 3 · SOUTH' },
    west: { pos: V(-51, 1.4, 9.5), rot: R.E, label: 'ZONE 4 · LIFT' },
  };
  for (const b of Object.values(breakers)) {
    const o = kit('breakerPanel', [{ label: b.label }], [0.5, 0.7, 0.2]);
    o.position.copy(b.pos); o.rotation.y = b.rot; scene.add(o); o.userData.dynamic = true;
    b.obj = o; b.use = b.pos.clone().add(V(Math.sin(b.rot), 0, Math.cos(b.rot)).multiplyScalar(0.2));
  }
  // spare lamp cells
  place(model('cardboard_box_01', null), -34.2, 7.4, 0.3);
  const cellSpots = [V(-26.1, 0.7, 13.45), V(-34.2, 0.395, 7.4), V(-49.45, 0.395, -8.45)]; // on the tool chest, a box, the boxes in the bay
  const cellMeshes = cellSpots.map((p, i) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.08), new THREE.MeshStandardMaterial({ color: 0x23272a, roughness: 0.5, metalness: 0.4 }));
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.162, 0.025, 0.082), new THREE.MeshStandardMaterial({ color: 0xe0b020, emissive: 0x3a2a00, roughness: 0.4 }));
    g.add(body, band); g.position.copy(p); g.rotation.y = i; g.userData.dynamic = true; scene.add(g);
    if (CH.cells.includes(i)) g.visible = false;
    return g;
  });

  // ---------------------------------------------------------------- lighting
  const hemi = new THREE.HemisphereLight(0x4a5870, 0x14100c, game.params.has('bright') ? 3 : 0.22); scene.add(hemi);
  game.flashlight.base = 230; game.flashlight.light.angle = 0.5; game.flashlight.light.distance = 34;
  const redA = new THREE.PointLight(0xff2010, 2.2, 10, 1.8); redA.position.set(-12, 2.7, -4); scene.add(redA);
  const redB = new THREE.PointLight(0xff1c0c, 2.6, 14, 1.8); redB.position.set(-27, 3.0, -2); scene.add(redB);
  // per-zone work lights (stands + spotlights); off until powered
  const zoneLights = {};
  function workLight(zone, x, z, tx, tz, shadow) {
    const stand = place(kit('workLight', [{ on: false }], [0.6, 1.8, 0.6]), x, z, Math.atan2(tx - x, tz - z));
    stand.userData.dynamic = true;
    const sp = new THREE.SpotLight(0xffe2bc, 0, 26, 0.9, 0.5, 1.7);
    sp.position.set(x, 1.9, z); sp.target.position.set(tx, 0, tz);
    if (shadow) { sp.castShadow = true; sp.shadow.mapSize.set(1024, 1024); sp.shadow.bias = -0.0006; sp.shadow.normalBias = 0.03; sp.shadow.camera.near = 0.3; sp.shadow.autoUpdate = false; }
    scene.add(sp, sp.target);
    (zoneLights[zone] ??= []).push({ stand, light: sp, base: 190 });
  }
  workLight('bay', -42, -9, -47, -15, true); workLight('bay', -50, -19, -45, -11, false);
  workLight('electrical', -33, 13.2, -37, 8, true); workLight('electrical', -24.8, 6.8, -29, 12, false);
  workLight('south', -16, -19, -26, -14, true); workLight('south', -39, -13, -30, -18, false);
  workLight('west', -41, 13.2, -47, 6, true); workLight('west', -41, -5, -48, 2, false);
  // the site office has its own desk lamp on a battery (always on: a pool of light to find)
  const deskLamp = new THREE.PointLight(0xffc88a, 7, 7, 1.7); deskLamp.position.copy(opt('desk', V(-19.5, 1.2, 11.5))).add(V(0, 0.45, 0)); scene.add(deskLamp);
  // a bare bulb on the temporary supply, hanging over the column by the bay door; it comes on with the generator
  const bulbAt = V(-34.0, H - 0.95, -7.7);
  const bulbCord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, H - bulbAt.y, 5), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7 }));
  bulbCord.position.set(bulbAt.x, (H + bulbAt.y) / 2, bulbAt.z);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), M.bulbOff || new THREE.MeshStandardMaterial({ color: 0xcfc8b8 }));
  bulb.position.copy(bulbAt); bulb.userData.dynamic = true; scene.add(bulbCord, bulb);
  const bulbLight = new THREE.PointLight(0xffc27a, 0, 9, 1.8); bulbLight.position.copy(bulbAt).add(V(0, -0.08, 0)); scene.add(bulbLight);
  let bulbOn = !!CH.gen;
  const lit = new Set();
  function setZone(zone, on, flicker = false) {
    if (on) lit.add(zone); else lit.delete(zone);
    for (const z of zoneLights[zone] || []) { z.light.intensity = on ? z.base : 0; z.stand.userData.setOn?.(on); if (z.light.castShadow) z.light.shadow.needsUpdate = true; }
    if (flicker && on) game.run(async () => { for (let i = 0; i < 6; i++) { for (const z of zoneLights[zone]) z.light.intensity = Math.random() < 0.5 ? 0 : z.base; await d.wait(0.06 + Math.random() * 0.12); } for (const z of zoneLights[zone]) z.light.intensity = z.base; });
  }
  const isLit = (x, z) => { for (const zone of lit) for (const r of ZONES[zone]) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return true; return false; };

  // ---------------------------------------------------------------- navigation for the creature
  const grid = new NavGrid({ x0: -52, x1: -6, z0: -21, z1: 15 }, 0.5);
  grid.carve([PLAN.floor, PLAN.corridor]);
  for (const c of colliders) grid.addBox(c, { pad: c.thin ? 0.08 : 0.3, opaque: false }); // it squeezes through doorways
  for (const s of sightBlockers) grid.addBox(s, { block: false, opaque: true });
  const patrol = [
    { x: -27, z: -3, look: true }, { x: -36, z: -9 }, { x: -28, z: -14, mode: 'crawl' }, { x: -18, z: -16 }, { x: -20, z: 2 },
    { x: -28, z: 10, look: true }, { x: -36, z: 9 }, { x: -45, z: 2, look: true }, { x: -46, z: -12, mode: 'crawl' }, { x: -33, z: 0 },
  ];

  // ---------------------------------------------------------------- performance
  game.batch(scene);
  for (const zl of Object.values(zoneLights)) for (const z of zl) if (z.light.castShadow) z.light.shadow.needsUpdate = true;
  let shadowFrame = 0;

  // ---------------------------------------------------------------- the creature
  const gltf = await loadCreatureModel((p) => game.onProgress?.(p));
  const B = Creature.spawn(gltf); B.object.scale.setScalar(0.93);
  B.object.position.set(-45, 0, -2); scene.add(B.object); B.object.updateMatrixWorld(true);
  B.attach({ colliders: [], bounds: { min: V(PLAN.floor.x0 + 0.4, 0, PLAN.floor.z0 + 0.4), max: V(PLAN.corridor.x1 - 0.4, 0, PLAN.floor.z1 - 0.4) } });
  const blockB = creatureBlockers(B);
  player.colliders = colliders;
  player.blockers = () => (B.object.visible ? blockB() : []);
  const hunter = new Hunter({ creature: B, grid, game, patrol, isLit, onKill: () => die() });
  hunter.script(true);
  hunter.aggression = 0.7; // it is cautious at first; every zone you light makes it bolder
  B.object.visible = false;
  window.__ch1 = { CH, hunter, B, setZone, player, interact, grid, use: (re) => { const it = interact.items.find((i) => i.enabled() && re.test(typeof i.label === 'function' ? i.label() : i.label)); if (it) it.onUse(it); return !!it; } };

  // ---------------------------------------------------------------- the lamp
  const lampModel = P.halideLamp ? P.halideLamp() : new THREE.Group();
  const lamp = new HalideLamp(game, lampModel, { cells: 4, recharge: 6.5 });
  lamp.give();
  lamp.targets.push({ point: () => B.bone.upperChest.getWorldPosition(V(0, 0, 0)), onFlash: (dist) => { if (B.object.visible && hunter.flashHit(dist)) { CH.flashes = (CH.flashes || 0) + 1; } } });
  game.flashlight.on = true;

  // noise from the player: running is loud, crouching is nearly silent
  player.onStep = (p, run) => {
    sfx.footstep(undefined, 'concrete', { run, player: true });
    hunter.noise(p, run ? 13 : player.crouch ? 1.3 : 4.2);
  };

  // ---------------------------------------------------------------- hiding
  let hidden = null;
  function hide(l) {
    const enteringSeen = hunter.state === 'chase' && hunter.playerVisibility() > 0;
    hidden = { locker: l, from: player.pos.clone(), yaw: player.yaw };
    const inside = l.userData.inside ? l.localToWorld(l.userData.inside.clone()) : l.position.clone().add(V(0, 1.6, 0));
    l.userData.setOpen?.(1); sfx.metalImpact(l.position, 0.3);
    player.frozen = true; player.pos.set(inside.x, 0, inside.z); player.eyeOverride = inside.y;
    player.yaw = l.rotation.y + Math.PI; player.pitch = -0.05; player.lookLocked = false;
    hunter.playerHidden = true; hunter.sawHide = enteringSeen;
    game.flashlight.on = false; ui.hiding(true); lampModel.visible = false;
    setTimeout(() => l.userData.setOpen?.(0), 400);
  }
  function unhide() {
    const l = hidden.locker;
    l.userData.setOpen?.(1); setTimeout(() => l.userData.setOpen?.(0), 600);
    const front = V(0, 0, 0.8).applyAxisAngle(V(0, 1, 0), l.rotation.y).add(l.position);
    player.pos.set(front.x, 0, front.z); player.eyeOverride = null; player.frozen = false;
    hunter.playerHidden = false; hunter.sawHide = false; ui.hiding(false); hidden = null; lampModel.visible = true;
  }
  for (const l of lockers) {
    interact.add({ position: () => l.position.clone().add(V(0, 1.3, 0)), label: () => (hidden ? 'Leave locker' : 'Hide in locker'), reach: 1.8, size: 0.5, onUse: () => (hidden ? unhide() : hide(l)), enabled: () => !hidden || hidden.locker === l });
  }

  // ---------------------------------------------------------------- objectives
  function objectiveText() {
    if (!CH.lift) {
      if (!CH.seenLift) return 'Find the freight lift on the west side of the floor.';
      const parts2 = [];
      if (!CH.gen) parts2.push(CH.fuel ? 'Refuel and start the generator in the loading bay' : 'Find diesel for the generator');
      else { const n = Object.values(CH.breakers).filter(Boolean).length; if (n < 3) parts2.push(`Close the zone breakers (${n}/3)`); }
      if (!CH.key) parts2.push('Find Lind’s lift key');
      if (!parts2.length) return 'Call the freight lift.';
      return parts2.join(' · ');
    }
    return 'Get into the lift.';
  }
  const refreshObjective = () => ui.objective(objectiveText());

  // interactions
  interact.add({ position: () => fuelCan.position.clone().add(V(0, 0.3, 0)), label: 'Take diesel can', enabled: () => !CH.fuel && CH.seenLift, onUse: () => { CH.fuel = true; fuelCan.visible = false; sfx.metalImpact(fuelCan.position, 0.2); ui.toast('DIESEL · 20 L', 2.5); refreshObjective(); checkpoint(); } });
  interact.add({ position: () => fuelCan.position.clone().add(V(0, 0.3, 0)), label: 'Diesel can (find the lift first)', enabled: () => !CH.fuel && !CH.seenLift, onUse: () => {} });
  interact.add({ position: () => gen.position.clone().add(V(0, 0.9, 0)), label: () => (!CH.refuelled ? 'Refuel generator' : 'Pull the starter cord'), reach: 2.2, size: 0.8, enabled: () => CH.fuel && !CH.gen && !busy, onUse: () => game.run(useGenerator) });
  for (const [k, b] of Object.entries(breakers)) {
    interact.add({ position: b.use, label: `Close breaker · ${b.label}`, reach: 1.9, size: 0.4, enabled: () => CH.gen && !CH.breakers[k], onUse: () => closeBreaker(k) });
    interact.add({ position: b.use, label: 'Breaker (no supply · start the generator)', reach: 1.9, size: 0.4, enabled: () => !CH.gen, onUse: () => sfx.beep('deny') });
  }
  interact.add({ position: () => opt('desk', V(-19.5, 0.9, 11.5)), label: 'Search the desk', reach: 1.9, size: 0.5, enabled: () => !CH.key, onUse: async () => { CH.key = true; CH.docs.push('note'); ui.toast('LIFT KEY · T. LIND', 3); sfx.beep('click'); await ui.readDoc(DOCS.note, game.input); refreshObjective(); checkpoint(); keyFound(); } });
  interact.add({ position: () => opt('recorder', V(-20.2, 0.9, 11.5)), label: 'Play the recorder', reach: 1.9, size: 0.3, enabled: () => !CH.tapePlaying, onUse: () => game.run(playTape) });
  interact.add({ position: () => opt('calendar', V(-17, 1.6, 13.8)), label: 'Read the calendar', reach: 2.0, size: 0.5, onUse: () => { if (!CH.docs.includes('calendar')) CH.docs.push('calendar'); ui.readDoc(DOCS.calendar, game.input); } });
  interact.add({ position: () => memo.position.clone().add(V(0, 0.1, 0)), label: 'Read the clipboard', reach: 1.8, size: 0.35, onUse: () => { if (!CH.docs.includes('memo')) CH.docs.push('memo'); ui.readDoc(DOCS.memo, game.input); } });
  cellMeshes.forEach((m, i) => interact.add({ position: () => m.position, label: 'Take halide cell', reach: 1.8, size: 0.25, enabled: () => m.visible, onUse: () => { m.visible = false; CH.cells.push(i); lamp.refill(); ui.toast('HALIDE CELL · LAMP RECHARGED', 2.5); } }));
  interact.add({ position: () => lift.localToWorld((lift.userData.callButton?.position || V(1.6, 1.2, 0.1)).clone()), label: () => (CH.key ? (liftCalled ? 'Lift is coming…' : 'Call the lift (key)') : 'Call the lift (needs a key)'), reach: 2.0, size: 0.4, enabled: () => CH.seenLift && !CH.lift, onUse: () => { if (!CH.key || !CH.gen || Object.values(CH.breakers).some((b) => !b)) { sfx.beep('deny'); if (CH.key && !CH.gen) say(OK, 'No power to the car. Generator first.'); return; } if (!liftCalled) game.run(callLift); } });

  let busy = false, liftCalled = false;

  // ---------------------------------------------------------------- set pieces
  async function useGenerator() {
    busy = true;
    if (!CH.refuelled) {
      player.frozen = true; ui.toast('REFUELLING…', 3.5);
      for (let i = 0; i < 4; i++) { sfx.debris(gen.position); hunter.noise(gen.position, 9); await d.wait(0.9); }
      CH.refuelled = true; player.frozen = false; busy = false; refreshObjective();
      await say(OK, 'Tank\'s got something in it. Now the cord. It\'ll be loud.');
      return;
    }
    CH.pulls = (CH.pulls || 0) + 1;
    sfx.metalImpact(gen.position, 0.6); hunter.noise(gen.position, 22);
    if (CH.pulls < 3) { await d.wait(0.7); busy = false; if (CH.pulls === 1) ui.toast('IT COUGHS. AGAIN.', 2); else ui.toast('ALMOST…', 2); return; }
    // it catches
    CH.gen = true; gen.userData.setRunning?.(true); sfx.powerUp();
    setZone('bay', true, true);
    checkpoint(); refreshObjective();
    await d.wait(1.2);
    await generatorReveal();
    busy = false;
  }
  async function generatorReveal() {
    // the power comes on everywhere at once. Through the bay door, out on the open floor, a bare bulb on the
    // temporary supply stutters on over the column, and it is standing under it with its back to you.
    hunter.script(true);
    const RV = V(-34.2, 0, -8.5);
    B.object.visible = true; B.object.position.copy(RV); B.anim.heading = Math.atan2(RV.x - gen.position.x, RV.z - gen.position.z); // facing away from you
    B.anim.gait.reset({ limbs: ['L', 'R'], home: { L: [0.15, 0], R: [-0.165, -0.075] } });
    B.anim.play('faceWall', { yaw: B.anim.heading });
    sfx.stinger('reveal'); sfx.setTension(0.55);
    bulbOn = true;
    player.lookAt(V(RV.x, 1.6, RV.z), 1.4);
    await say(OK, 'That\'s it. I\'m seeing load on the temporary supply.');
    player.releaseLook();
    await d.wait(1.5);
    // it turns its head all the way round
    B.anim.play('idle', { stare: true });
    await d.wait(2.6);
    await say(OK, 'Rook... is that it? On my feed, by the column. It\'s just—', 3.4);
    B.anim.play('follow', { path: [{ x: -30, z: 4 }, { x: -34, z: 7.5 }], mode: 'walk', gaze: 'player' });
    await d.wait(2.4);
    await say(OK, 'It walked away. It looked straight at you and it walked away.');
    await say(OK, 'Breakers. Three zones. Each one gives you light, and light is the one thing it won\'t walk into.');
    hunter.script(false); hunter.set('idle');
    sfx.setTension(0.3);
  }
  function closeBreaker(k) {
    const b = breakers[k];
    CH.breakers[k] = true; b.obj.userData.setOn?.(true);
    sfx.metalImpact(b.pos, 0.4); sfx.powerUp(); hunter.noise(b.pos, 10);
    setZone(k, true, true);
    refreshObjective(); checkpoint();
    const n = Object.values(CH.breakers).filter(Boolean).length;
    hunter.aggression = 0.8 + n * 0.15;
    game.run(async () => {
      if (n === 1) { await say(OK, 'Zone\'s live. Stay in the light when you can. Move when you have to.'); }
      if (n === 2) {
        await d.wait(1.5);
        await say(UNKNOWN, '—anyone on this channel— ...pump level, the water\'s still— ...it was down here, I saw it—', 5);
        await say(OK, 'Ignore that.', 2.2);
        await say(OK, '...That\'s an old channel. It\'s an echo off the repeater. Ignore it.');
      }
      if (n === 3) { await say(OK, 'All three. The lift has power.'); if (!CH.key) await say(OK, 'It still needs a supervisor key. Teodor\'s office. North side, the one with a door that still shuts.'); }
    });
  }
  function keyFound() {
    game.run(async () => {
      await d.wait(0.6);
      await say(OK, '...He kept it in the drawer.', 2.6);
      await say(OK, 'Of course he did. He never locked anything in his life.');
    });
  }
  async function playTape() {
    CH.tapePlaying = true; CH.tape = true;
    sfx.beep('click');
    for (const [who, line, dur] of TAPE) await say(who, line, dur);
    await say(OK, '...', 2.2);
    await say(OK, 'Turn that off, Rook.', 2.4);
    CH.tapePlaying = false;
  }
  async function callLift() {
    liftCalled = true; sfx.beep('ok'); lift.userData.setButtonLit?.(true);
    ui.objective('Survive until the lift arrives.');
    await say(OK, 'It\'s coming up from D-3. Forty seconds, maybe less. Don\'t stand still.');
    // it comes for the lift: it cuts the power to this zone and hunts you in the dark
    await d.wait(6);
    hunter.script(true);
    B.object.visible = true;
    const sp = grid.nearestWalkable(-41.5, -4);
    B.object.position.set(sp.x, 0, sp.z);
    for (let i = 0; i < 5; i++) { setZone('west', i % 2 === 1); await d.wait(0.1 + Math.random() * 0.15); }
    setZone('west', false); sfx.powerDown();
    await say(OK, 'I just lost zone four. It\'s pulling the feed. Rook, it knows where you\'re going.');
    hunter.script(false); hunter.aggression = 1.8; hunter.lastSeen = V(player.pos.x, 0, player.pos.z); hunter.suspicion = 0.9; hunter.stalk();
    sfx.setTension(0.85);
    const T0 = d.t;
    await d.until(() => {
      const left = Math.max(0, 34 - (d.t - T0));
      drawLiftFloor(left);
      return left <= 0;
    });
    // the lift arrives
    sfx.beep('ok'); lift.userData.setDoors && openLiftDoors(true);
    CH.lift = true; refreshObjective();
    await d.until(() => inLiftCar());
    // inside: the doors close, it hits them, and you go down
    hunter.script(true); openLiftDoors(false);
    const door = lift.position.clone().add(V(1.6, 0, 0));
    B.object.position.set(door.x + 2.2, 0, door.z); B.anim.play('attack', {});
    player.frozen = true; player.lookAt(V(door.x + 1.5, 1.6, door.z), 3);
    await d.wait(0.7); sfx.doorBang(door, 1.4); player.shake = 1.5; sfx.creatureScream(door, { dur: 2.2 });
    await d.wait(1.6);
    sfx.setTension(0.2); sfx.powerUp();
    await ui.fadeTo(1, 2.5);
    save.set('chapter', 2); save.set('ch1', null);
    save.set('truth', (save.get('truth', 0) || 0) + (CH.tape ? 1 : 0) + CH.docs.length);
    await say(OK, 'You\'re moving. You\'re in the car. Rook—it didn\'t follow. It went into the shaft. It\'s climbing down.', 6);
    await ui.card('CHAPTER TWO', 'PUMP LEVEL<br><br>in development', 5);
    location.href = location.pathname;
  }
  let liftDoors = 0, liftDoorsTarget = 0;
  function openLiftDoors(on) { liftDoorsTarget = on ? 1 : 0; sfx.doorSlide(lift.position, { heavy: true }); }
  function inLiftCar() { const p = player.pos; return p.x < F.x0 - 0.6 && Math.abs(p.z - LIFT.z) < 1.15; }
  let lastFloor = -1;
  function drawLiftFloor(sec) {
    const s = lift.userData.screens?.[0]; if (!s) return;
    const floor = Math.max(0, Math.ceil(sec / 12));
    if (floor === lastFloor) return; lastFloor = floor;
    const { ctx, canvas, texture } = s;
    ctx.fillStyle = '#050605'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ff9a2a'; ctx.font = `bold ${canvas.height * 0.6}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(floor === 0 ? 'D' : `D-${floor}`, canvas.width / 2, canvas.height / 2);
    texture.needsUpdate = true;
  }

  // ---------------------------------------------------------------- death
  async function die() {
    if (CH.dead) return; CH.dead = true;
    sfx.creatureScream(game.camera.position, { dur: 1.2 }); sfx.stinger('hit');
    ui.red(true); ui.setFade(1); player.frozen = true;
    await new Promise((r) => setTimeout(r, 900));
    ui.red(false); if (hidden) ui.hiding(false);
    const msg = hunter.sawHide ? 'It saw where you went.' : hunter.isLit && lit.size ? 'Keep to the light. Flash it when it comes close.' : 'Stay low and quiet. Flash it when it comes close.';
    await ui.death('YOU WERE TAKEN', msg, game.input);
    const st = save.get('ch1') || {};
    game.load(chapter1, { state: { ...st, dead: false }, restart: true });
  }

  // ---------------------------------------------------------------- the script
  async function opening() {
    if (!(opts.restart && CH.seenLift)) player.place(-9.0, -4.0, Math.PI / 2, 0); // facing west, into the build-out
    ui.setFade(1);
    sfx.setAmbience('construction', 0.9, 3); sfx.setReverb('large');
    if (!opts.restart) {
      await ui.card('CHAPTER ONE', 'THE BUILD-OUT', 4);
      ui.fadeTo(0, 3);
      await d.wait(1.5);
      await say(OK, 'Rook? You\'re breaking up already.', 3.0);
      await say(OK, 'It\'s the slab. Concrete and rebar, and nobody finished the repeaters.');
      await say(OK, 'Listen. That floor runs off its own temporary supply. Generator in the loading bay, breakers by zone. Right now, nothing in there is live.');
      await say(OK, 'There\'s one way down from D: the freight lift, west side. If B wants out, that shaft is how it goes.');
      await say(OK, 'Get to the lift before it does.');
    } else ui.fadeTo(0, 1.5);
    refreshObjective();
  }
  async function firstGlimpse() {
    // the first time you step onto the open floor: something crosses the far end, low and fast
    await d.until(() => player.pos.x < -17.5);
    if (CH.glimpse) return; CH.glimpse = true;
    B.object.visible = true; B.object.position.set(-36, 0, -10.5);
    B.anim.gait.reset({ limbs: ['L', 'R'], home: { L: [0.15, 0], R: [-0.165, -0.075] } });
    B.anim.play('goto', { x: -38.5, z: 4.5, speed: 1.9, crawl: true });
    sfx.creatureClick(V(-36, 0, -8)); sfx.stinger('low');
    await d.wait(3.2);
    B.object.visible = false;
    await say(OK, 'Was that—? I can\'t see anything past the first bay. Rook, talk to me. Tap your mic.', 4);
    await d.wait(0.5);
    await say(OK, '...Okay. Okay. I\'ll take that as a yes.');
  }
  async function findLift() {
    await d.until(() => player.pos.x < -40 && player.pos.z > -6);
    if (!CH.seenLift) {
      CH.seenLift = true; checkpoint(); refreshObjective();
      await say(OK, 'Dead? Of course it\'s dead.');
      await say(OK, 'The lift runs off the temporary supply. Generator first. If it\'s dry, and it will be, the contractors kept diesel in their store, north side.');
      await say(OK, 'And the car needs a supervisor key on that floor. Teodor had one. His site office is the only room in there with a door that still shuts.');
      // from here on, it hunts
      B.object.visible = true; hunter.script(false); hunter.set('idle');
      const sp = grid.nearestWalkable(-30, 10); B.object.position.set(sp.x, 0, sp.z);
    }
  }

  // restore a checkpoint
  if (CH.gen) { gen.userData.setRunning?.(true); setZone('bay', true); }
  for (const [k, on] of Object.entries(CH.breakers)) if (on) { setZone(k, true); breakers[k].obj.userData.setOn?.(true); }
  if (CH.fuel) fuelCan.visible = false;
  if (CH.seenLift) { B.object.visible = true; hunter.script(false); hunter.set('idle'); const sp = grid.nearestWalkable(-30, 10); B.object.position.set(sp.x, 0, sp.z); }
  if (opts.restart && CH.seenLift) player.place(CH.gen ? -44 : -42, CH.gen ? -10 : 2, Math.PI / 2, 0);

  if (game.params.get('cp') === 'still') { ui.setFade(0); applyDebugCamera(game); if (game.params.has('lit')) for (const z of Object.keys(ZONES)) setZone(z, true); }
  else game.run(async () => { await opening(); if (!CH.glimpse && !CH.seenLift) game.run(firstGlimpse); await findLift(); });

  let ambT = 25;
  return {
    look: 'horror', ownFade: true,
    update(dt, t) {
      const ctx = creatureCtx(game);
      if (B.object.visible) { B.update(dt, ctx); hunter.update(dt); player.shake = Math.max(player.shake, B.anim.shake); }
      lamp.update(dt);
      for (const s of sheets) s.userData.update?.(t, 0.6 + Math.sin(t * 0.3) * 0.4);
      gen.userData.update?.(t);
      // lift doors
      if (Math.abs(liftDoors - liftDoorsTarget) > 0.001) { liftDoors += Math.sign(liftDoorsTarget - liftDoors) * Math.min(Math.abs(liftDoorsTarget - liftDoors), dt * 0.6); lift.userData.setDoors?.(liftDoors); Object.assign(liftDoorBox, liftDoors > 0.75 ? { minX: 1e6, maxX: 1e6 } : liftDoorClosed); }
      // the building is never quiet: settling, dripping, something moving a long way off
      ambT -= dt;
      if (ambT <= 0 && !hidden) {
        ambT = 18 + Math.random() * 26;
        const a = Math.random() * Math.PI * 2, r = 9 + Math.random() * 7, at = V(player.pos.x + Math.cos(a) * r, 0.5, player.pos.z + Math.sin(a) * r);
        const far = !B.object.visible || hunter.anim.distToPlayer() > 12;
        const k = Math.random();
        if (k < 0.3) sfx.debris(at);
        else if (k < 0.5) sfx.metalImpact(at, 0.15);
        else if (k < 0.75 && far) { sfx.creatureClick(at); if (Math.random() < 0.5) setTimeout(() => sfx.creatureClick(at.clone().add(V(1.2, 0, 0.6))), 700); }
        else if (far) sfx.creatureCrack(at);
      }
      // the bare bulb: on with the generator, never steady
      if (bulbOn) { const f = Math.random() < 0.04 ? 0.15 : 0.85 + Math.sin(t * 13.7) * 0.08 + Math.sin(t * 31.1) * 0.05; bulbLight.intensity = 16 * f; bulb.material = f > 0.5 ? (M.bulbOn || bulb.material) : (M.bulbOff || bulb.material); }
      // emergency light flicker
      redB.intensity = 2.6 * (0.75 + 0.25 * Math.sin(t * 9.1) * Math.sin(t * 2.3)) * (Math.random() < 0.01 ? 0.2 : 1);
      // throttled shadows: lit zones only, a few times a second
      shadowFrame++;
      let k = 0;
      for (const zl of Object.values(zoneLights)) for (const z of zl) if (z.light.castShadow && z.light.intensity > 0 && (shadowFrame + k++) % 3 === 0) z.light.shadow.needsUpdate = true;
      // fear: how close and how aware it is
      const dd = B.object.visible ? hunter.anim.distToPlayer() : 99;
      game.fear = Math.max(0, 1 - dd / 9) * (hunter.state === 'chase' ? 1 : 0.6);
      sfx.heartbeat(dd < 6 && B.object.visible ? 70 + (6 - dd) * 12 : 0);
    },
    dispose() { sfx.setTension(0); sfx.heartbeat(0); },
  };
}
