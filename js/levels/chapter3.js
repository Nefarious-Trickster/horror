// CHAPTER THREE: THE ARCHIVE
// Records vault and the old observation theatre. Find the mine lift code (on microfiche, filed in the
// vault's restricted cage), restore power from the projection booth, and learn what LANTERN was.
// The trial reel can be projected; B comes to watch it. Then: upload the files, or burn them.
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

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const OK = 'Dr. Okafor', LINDF = 'Lind (film)', OKF = 'Okafor (film)', HALR = 'Halloran (radio)';
const R = { N: 0, S: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 };
const CODE = '7319';

// ------------------------------------------------------------------ plan (x east, z north)
const ROOMS = {
  stair: { x0: -2, x1: 2, z0: -5, z1: 0, h: 3.2, floor: 'concrete' },
  corr: { x0: -1.6, x1: 1.6, z0: 0, z1: 6, h: 3.0, floor: 'tile' },
  office: { x0: -8, x1: 8, z0: 6, z1: 14, h: 3.2, floor: 'tile' },
  reading: { x0: 8, x1: 15, z0: 6, z1: 14, h: 3.0, floor: 'tile' },
  liftlobby: { x0: 15, x1: 21, z0: 8, z1: 13, h: 3.2, floor: 'concrete' },
  vault: { x0: -30, x1: -8, z0: 2, z1: 26, h: 3.6, floor: 'concrete' },
  ncorr: { x0: -1.5, x1: 1.5, z0: 14, z1: 18, h: 3.0, floor: 'tile' },
  theatre: { x0: -8, x1: 10, z0: 18, z1: 42, h: 8, floor: 'wood' },
};
const DOORS = [
  { x0: -1.2, x1: 1.2, z0: -0.3, z1: 0.3 }, { x0: -1.2, x1: 1.2, z0: 5.7, z1: 6.3 },
  { x0: 7.7, x1: 8.3, z0: 9, z1: 11 }, { x0: 14.7, x1: 15.3, z0: 9.5, z1: 11.5 },
  { x0: -8.3, x1: -7.7, z0: 9, z1: 11 }, { x0: -1.2, x1: 1.2, z0: 13.7, z1: 14.3 },
  { x0: -1.2, x1: 1.2, z0: 17.7, z1: 18.3 }, { x0: -8.3, x1: -7.7, z0: 20, z1: 21.8 }, // theatre pit fire door into the vault
  { x0: 20.7, x1: 21.3, z0: 9.3, z1: 11.7, top: 2.7 }, // the mine lift's landing doors
];
const TIER = { z0: 25, rows: 10, depth: 1, rise: 0.3 }; // stepped seating, then the booth platform
const TOP = TIER.rows * TIER.rise;
const groundAt = (x, z) => {
  if (x < -8 || x > 10 || z < TIER.z0 || z > 42) return 0;
  if (z < TIER.z0 + TIER.rows * TIER.depth) return TIER.rise * Math.min(TIER.rows, Math.floor((z - TIER.z0) / TIER.depth) + 1);
  return TOP;
};
// Cage 4: seven mobile shelving carriages on rails, one movable aisle
const CAGE = { x0: -28.6, x1: -22.4, z0: 16.6, unit: 0.9, aisle: 1.3, n: 7, target: 4 }; // carriage 5

const DOCS = {
  index: {
    ref: 'CARD INDEX · DRAWER L', title: 'Two cards, filed together',
    body: `<p><b>SITE 41 · ACCESS · CURRENT FICHE</b><br>Mine lift, adit lifts, cold store. Superseded monthly.<br>→ <b>CAGE 4 · CARRIAGE 5 · SOUTH FACE</b></p>
<p><b>LANTERN</b><br>Trial records, consent, film. Restricted: I. Okafor only.<br>→ <b>CAGE 4 · CARRIAGE 5 · SOUTH FACE</b></p>
<p>Behind them, a third card has been torn out. Only the corner is left, in Lind's handwriting: <i>“…if I forget, it's in 5.”</i></p>`,
  },
  consent: {
    ref: 'LANTERN · FORM L-1 · SIGNED', title: 'Informed consent',
    body: `<p>I, <b>Teodor Lind</b>, consent to controlled exposure to secretion sample C-14A/S-3, under conditions of total darkness, for a period not exceeding <b>thirty days</b>, followed by administration of counter-agent <b>LANTERN-0</b>.</p>
<p>I understand that the transition is not reversible by any established means. I understand that if LANTERN-0 fails, I will be classified as a specimen and contained.</p>
<p>Signed: <i>T. Lind</i>. Witnessed: <i>I. Okafor</i>.</p>
<p>In the margin, in pencil, Lind has added: <i>“Contained. Not destroyed. You promised.”</i></p>`,
  },
  memo: {
    ref: 'LANTERN · DIRECTOR\'S NOTE · DAY 32', title: 'Reclassification',
    body: `<p>LANTERN-0 administered day 30. No measurable response. Subject non-verbal from day 26.</p>
<p>Subject to be recorded as <b>C-14B</b>, “a second individual recovered from the same site”. Trial records to be withdrawn from the general archive and held in Cage 4 pending destruction.</p>
<p>One dose of LANTERN-0 remains. Lind hid it before day 20. He will not say where. He no longer says anything.</p>
<p>— I.O.</p>`,
  },
  fiche: {
    ref: 'MICROFICHE · SITE 41 ACCESS · CURRENT', title: 'Mine lift',
    body: `<p>ADIT LIFT (MINE), CAGE CONTROL: <b>${CODE.split('').join(' ')}</b></p>
<p>COLD STORE (ADIT 2): <i>key only · I. Okafor</i></p>
<p>The frame after it is a delivery index for cost code LANTERN-D. Every line is a container. The last line, from the week of the breach, says: <b>“RETURNED: 1. CONTENTS: AWAKE.”</b></p>`,
  },
  badge: {
    ref: 'ID BADGE · LEFT ON THE FLOOR', title: 'Lind, T.',
    body: `<p>Teodor Lind's site badge, on its blue lanyard. The photograph has been scratched out, carefully, again and again, as if with a single long nail.</p>
<p>It was put down here. Not dropped. Put down, face up, square to the edge of the step.</p>`,
  },
};

// ------------------------------------------------------------------ the level
export async function chapter3(game, opts = {}) {
  const { scene, player, ui, director: d, interact, renderer } = game;
  const say = (who, text, dur) => ui.say(who, text, dur);
  renderer.toneMappingExposure = 1.05;
  scene.background = new THREE.Color(0x030304);
  scene.fog = new THREE.FogExp2(0x050505, 0.035);

  const CH = Object.assign({ index: false, aisle: 2, box: false, breaker: false, film: false, seen: false, fiche: false, files: null, badge: false, cells: [], docs: [], done: false }, opts.state || {});
  const checkpoint = () => save.set('ch3', JSON.parse(JSON.stringify({ ...CH, dead: false })));

  // ---------------------------------------------------------------- assets
  const [kitMod, P, AP] = await Promise.all([
    import('../wingd/kit.js').catch((e) => { console.warn('kit unavailable', e); return null; }),
    import('../lab/props.js').catch(() => ({})),
    import('../archive/props.js'),
  ]);
  if (kitMod?.loadKit) await kitMod.loadKit((a, b) => game.onProgress?.(a / b)).catch((e) => console.warn(e));
  const K = kitMod?.KIT || {};
  const M = K.materials || {};
  AP.useArchiveMaterials(M);
  const fbMat = new THREE.MeshStandardMaterial({ color: 0x6b6862, roughness: 0.9 });
  const kit = (name, args = [], fb = null) => { try { if (typeof K[name] === 'function') return K[name](...args); } catch (e) { console.warn('kit', name, e); } const g = new THREE.Group(); if (fb) { const m = new THREE.Mesh(new THREE.BoxGeometry(...fb), fbMat); m.position.y = fb[1] / 2; g.add(m); g.userData.collider = { w: fb[0], d: fb[2] }; } return g; };
  const model = (id) => { try { return K.model?.(id) || new THREE.Group(); } catch { return new THREE.Group(); } };

  // materials: painted plaster walls (two-tone), vinyl tile, wood boards in the theatre
  const plaster = (() => { try { return pbr('Plaster001'); } catch { return {}; } })();
  const wallMat = paintedMaterial(plaster, { upper: 0xb3ae98, lower: 0x48574a, dado: 1.2 });
  const theatreWall = paintedMaterial(plaster, { upper: 0x5a2a24, lower: 0x2a1c18, dado: 1.0 });
  const tiles = (() => { try { return pbr('Tiles107'); } catch { return {}; } })();
  const tileMat = new THREE.MeshStandardMaterial({ ...tiles, color: 0x9a978a, roughness: 1 }); tileMat.userData.tile = 1.2;
  const floorMats = { default: tileMat, tile: tileMat, concrete: M.slab || fbMat, wood: M.plank || fbMat };
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0x9c988c, roughness: 0.95 });

  // ---------------------------------------------------------------- structure
  const built = buildRooms(scene, ROOMS, DOORS, { wallMat, floorMats, ceilMat, worldUV: K.worldUV });
  const colliders = built.colliders, sightBlockers = built.sightBlockers;
  const place = placer(scene, colliders);
  const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
  // the theatre's walls are a different paint: overdraw its inner faces with thin panels
  {
    const T = ROOMS.theatre, g = [];
    for (const [x0, x1, z0, z1] of [[T.x0 + 0.15, T.x0 + 0.17, T.z0, T.z1], [T.x1 - 0.17, T.x1 - 0.15, T.z0, T.z1], [T.x0, T.x1, T.z1 - 0.17, T.z1 - 0.15]]) {
      const b = new THREE.BoxGeometry(x1 - x0, T.h, z1 - z0); b.translate((x0 + x1) / 2, T.h / 2, (z0 + z1) / 2); K.worldUV?.(b, 2.4); g.push(b);
    }
    const m = new THREE.Mesh(mergeGeometries(g), theatreWall); m.receiveShadow = true; scene.add(m);
  }
  // tiers and the booth platform
  {
    const g = [];
    for (let k = 0; k < TIER.rows; k++) { const b = new THREE.BoxGeometry(17.7, TIER.rise * (k + 1), TIER.depth); b.translate(1, TIER.rise * (k + 1) / 2, TIER.z0 + (k + 0.5) * TIER.depth); K.worldUV?.(b, 1.4); g.push(b); }
    const pl = new THREE.BoxGeometry(17.7, TOP, 42 - (TIER.z0 + TIER.rows)); pl.translate(1, TOP / 2, (TIER.z0 + TIER.rows + 42) / 2); K.worldUV?.(pl, 1.4); g.push(pl);
    const m = new THREE.Mesh(mergeGeometries(g), M.plank || fbMat); m.castShadow = m.receiveShadow = true; scene.add(m);
    for (let k = 0; k < TIER.rows; k++) {
      const z = TIER.z0 + k * TIER.depth + 0.45, y = TIER.rise * (k + 1);
      for (const [cx, len] of [[-3.5, 7.2], [5.5, 7.2]]) {
        const row = AP.seatRow({ length: len, seed: k * 3 + cx, broken: 0.15 }); row.position.set(cx, y, z); scene.add(row);
        colliders.push({ minX: cx - len / 2, maxX: cx + len / 2, minZ: z - 0.3, maxZ: z + 0.1 });
      }
    }
    // a rail along the front of the platform, except at the aisle
    const rail = new THREE.Mesh(new THREE.BoxGeometry(17.4, 0.05, 0.05), M.steelDark || fbMat); rail.position.set(1, TOP + 0.95, TIER.z0 + TIER.rows + 0.05); scene.add(rail);
  }
  // the projection booth: low front wall with a glazed opening, a roof, the projector
  const BOOTH = { x0: -3, x1: 5, z0: 38.5, z1: 42 };
  {
    const g = [];
    const box = (x0, x1, y0, y1, z0, z1, col = true) => { const b = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); b.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); K.worldUV?.(b, 2.4); g.push(b); if (col && y0 < TOP + 1.5) colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 }); };
    box(BOOTH.x0, 3.9, TOP, TOP + 1.0, BOOTH.z0 - 0.1, BOOTH.z0 + 0.1); box(4.9, BOOTH.x1, TOP, TOP + 2.6, BOOTH.z0 - 0.1, BOOTH.z0 + 0.1);
    box(BOOTH.x0, BOOTH.x1, TOP + 2.2, TOP + 2.6, BOOTH.z0 - 0.1, BOOTH.z0 + 0.1, false);
    box(BOOTH.x0 - 0.1, BOOTH.x0 + 0.1, TOP, TOP + 2.6, BOOTH.z0, BOOTH.z1); box(BOOTH.x1 - 0.1, BOOTH.x1 + 0.1, TOP, TOP + 2.6, BOOTH.z0, BOOTH.z1);
    box(BOOTH.x0 - 0.1, BOOTH.x1 + 0.1, TOP + 2.6, TOP + 2.8, BOOTH.z0 - 0.1, BOOTH.z1, false);
    const m = new THREE.Mesh(mergeGeometries(g), wallMat); m.castShadow = m.receiveShadow = true; scene.add(m);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(6.9, 1.2), new THREE.MeshStandardMaterial({ color: 0x9fb0b0, transparent: true, opacity: 0.12, roughness: 0.05, defines: { GLOSSY: '' } }));
    glass.position.set(0.45, TOP + 1.6, BOOTH.z0); glass.userData.dynamic = true; scene.add(glass);
  }
  const proj = place(AP.projector(), 1, 39.6, 0, TOP); proj.userData.dynamic = true;
  colliders.push({ minX: 0.6, maxX: 1.4, minZ: 39.2, maxZ: 40.0 });
  const boothBreaker = kit('breakerPanel', [{ label: 'THEATRE · READING RM' }], [0.5, 0.7, 0.2]);
  boothBreaker.position.set(3.6, TOP + 1.4, 41.85); boothBreaker.rotation.y = R.S; boothBreaker.userData.dynamic = true; scene.add(boothBreaker);
  boothBreaker.userData.setOn?.(CH.breaker);

  // the screen, and the 2019 observation cage in the pit below it
  const SCREEN = { x: 1, y: 4.65, z: 18.2, w: 7.2, h: 4.05 };
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.w, SCREEN.h), new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.95 }));
  screen.position.set(SCREEN.x, SCREEN.y, SCREEN.z); scene.add(screen);
  {
    const g = [];
    const frame = (x0, x1, y0, y1) => { const b = new THREE.BoxGeometry(x1 - x0, y1 - y0, 0.12); b.translate((x0 + x1) / 2, (y0 + y1) / 2, SCREEN.z + 0.02); g.push(b); };
    frame(SCREEN.x - SCREEN.w / 2 - 0.25, SCREEN.x + SCREEN.w / 2 + 0.25, SCREEN.y + SCREEN.h / 2, SCREEN.y + SCREEN.h / 2 + 0.25);
    frame(SCREEN.x - SCREEN.w / 2 - 0.25, SCREEN.x + SCREEN.w / 2 + 0.25, SCREEN.y - SCREEN.h / 2 - 0.25, SCREEN.y - SCREEN.h / 2);
    frame(SCREEN.x - SCREEN.w / 2 - 0.25, SCREEN.x - SCREEN.w / 2, SCREEN.y - SCREEN.h / 2, SCREEN.y + SCREEN.h / 2);
    frame(SCREEN.x + SCREEN.w / 2, SCREEN.x + SCREEN.w / 2 + 0.25, SCREEN.y - SCREEN.h / 2, SCREEN.y + SCREEN.h / 2);
    const m = new THREE.Mesh(mergeGeometries(g), new THREE.MeshStandardMaterial({ color: 0x120a08, roughness: 0.9 })); scene.add(m);
  }
  {
    // the old cage: bars on three sides, door hanging open, a chair bolted to the floor inside
    const g = [], bars = M.rust || fbMat;
    const cx0 = 3.5, cx1 = 7.5, cz0 = 19.2, cz1 = 22.4, h = 2.8;
    for (let x = cx0; x <= cx1 + 1e-3; x += 0.18) for (const z of [cz1]) { if (x > 5 && x < 6) continue; const c = new THREE.CylinderGeometry(0.018, 0.018, h, 6); c.translate(x, h / 2, z); g.push(c); }
    for (let z = cz0; z <= cz1 + 1e-3; z += 0.18) for (const x of [cx0, cx1]) { const c = new THREE.CylinderGeometry(0.018, 0.018, h, 6); c.translate(x, h / 2, z); g.push(c); }
    for (const y of [0.05, h]) { for (const [a, b] of [[[cx0, cz1], [cx1, cz1]], [[cx0, cz0], [cx0, cz1]], [[cx1, cz0], [cx1, cz1]]]) { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const bx = new THREE.BoxGeometry(Math.abs(b[0] - a[0]) || 0.06, 0.06, Math.abs(b[1] - a[1]) || 0.06); bx.translate((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2); g.push(bx); } }
    const m = new THREE.Mesh(mergeGeometries(g.map((x) => (x.index ? x.toNonIndexed() : x)).map((x) => { for (const k of Object.keys(x.attributes)) if (!['position', 'normal'].includes(k)) x.deleteAttribute(k); return x; })), bars); m.castShadow = true; scene.add(m);
    colliders.push({ minX: cx0 - 0.05, maxX: 5, minZ: cz1 - 0.05, maxZ: cz1 + 0.05 }, { minX: 6, maxX: cx1 + 0.05, minZ: cz1 - 0.05, maxZ: cz1 + 0.05 }, { minX: cx0 - 0.05, maxX: cx0 + 0.05, minZ: cz0, maxZ: cz1 }, { minX: cx1 - 0.05, maxX: cx1 + 0.05, minZ: cz0, maxZ: cz1 });
    const chair = model('plastic_monobloc_chair_01'); chair.position.set(5.5, 0, 20.2); chair.rotation.y = 0.2; scene.add(chair);
    const sign = P.sign ? P.sign('C-14A · OBSERVATION · 2019', { w: 1.6, h: 0.25 }) : new THREE.Group(); sign.position.set(5.5, 2.95, cz1 + 0.06); scene.add(sign);
  }

  // ---------------------------------------------------------------- office, reading room, lift lobby
  const counter = new THREE.Group();
  {
    const g = []; const b = (x0, x1, y0, y1, z0, z1) => { const q = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); q.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); K.worldUV?.(q, 1.2); g.push(q); };
    b(-7.8, -2.2, 0, 1.05, 8.4, 9.0); b(-7.85, -2.15, 1.05, 1.1, 8.35, 9.1); b(2.2, 7.8, 0, 1.05, 8.4, 9.0); b(2.15, 7.85, 1.05, 1.1, 8.35, 9.1);
    counter.add(new THREE.Mesh(mergeGeometries(g), M.timber || fbMat)); scene.add(counter);
    colliders.push({ minX: -7.8, maxX: -2.2, minZ: 8.4, maxZ: 9.0 }, { minX: 2.2, maxX: 7.8, minZ: 8.4, maxZ: 9.0 });
  }
  const catalogue = place(AP.cardCatalogue({ cols: 7, rows: 9 }), -4.5, 13.45, R.S);
  const cat2 = place(AP.cardCatalogue({ cols: 7, rows: 9 }), -3.3, 13.45, R.S);
  place(model('metal_office_desk'), 4.5, 12.6, R.S);
  place(model('plastic_monobloc_chair_01'), 4.2, 11.7, 0.4);
  const relay = P.workstation ? place(P.workstation({ monitors: 1 }), 7.35, 11.2, R.W) : place(new THREE.Group(), 7.35, 11.2, R.W);
  relay.userData.dynamic = true;
  const relayScreen = relay.userData.screens?.[0];
  const chute = new THREE.Group();
  {
    const steel = M.steelPaint || fbMat;
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.15), steel); f.position.y = 1.2; chute.add(f);
    const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.05), M.steelDark || fbMat); hatch.position.set(0, 1.25, 0.09); chute.add(hatch);
    const lbl = P.sign ? P.sign('INCINERATOR · CONFIDENTIAL WASTE', { w: 0.9, h: 0.16 }) : new THREE.Group(); lbl.position.set(0, 1.78, 0.08); chute.add(lbl);
    chute.position.set(-7.83, 0, 12.4); chute.rotation.y = R.E; scene.add(chute);
  }
  const fire = new THREE.PointLight(0xff7a2a, 0, 5, 2); fire.position.set(-7.4, 1.25, 12.4); scene.add(fire);
  const reader = place(AP.ficheReader(), 11.5, 13.3, R.S); reader.userData.dynamic = true;
  const rscr = reader.userData.screen;
  const banker = AP.bankersLamp(); banker.position.set(12.5, 0.76, 13.1); banker.rotation.y = 0.4; scene.add(banker);
  const readLamp = new THREE.PointLight(0xffd9a0, 0, 5, 1.8); readLamp.position.set(12.5, 1.2, 12.9); scene.add(readLamp);
  place(AP.shelfUnit({ length: 3, double: false, seed: 31, fill: 0.7 }), 11.5, 6.4, 0);
  const liftObj = place(kit('freightLift', [{ w: 2.4, d: 2.2, h: 2.7, wall: 0.3 }], [2.6, 2.8, 0.4]), 21, 10.5, R.W);
  liftObj.userData.dynamic = true;
  const liftDoorBox = { minX: 20.85, maxX: 21.2, minZ: 9.3, maxZ: 11.7 }; colliders.push(liftDoorBox);
  const keypad = P.keypad ? P.keypad() : new THREE.Group(); keypad.position.set(20.85, 1.3, 12.3); keypad.rotation.y = R.W; scene.add(keypad);
  const lobbyLight = new THREE.PointLight(0xff2a14, 1.6, 7, 2); lobbyLight.position.set(18, 2.8, 10.5); scene.add(lobbyLight);

  // ---------------------------------------------------------------- the vault: static stacks, Cage 4
  const VA = ROOMS.vault;
  let seed = 1;
  for (const [cx, z] of [[-25.5, 3.4], [-25.5, 5.9], [-25.5, 8.4], [-25.5, 12.6], [-13, 3.4], [-13, 5.9], [-13, 8.4], [-13, 12.6], [-13, 15.1], [-13, 17.6], [-13, 20.1], [-13, 22.6], [-13, 25.0]]) {
    const u = place(AP.shelfUnit({ length: 8, seed: seed++, mess: cx > -20 && z > 14 ? 0.25 : 0.04 }), cx, z, 0);
    sightBlockers.push({ minX: cx - 4, maxX: cx + 4, minZ: z - 0.45, maxZ: z + 0.45 });
  }
  // cage walls (chain link) with the gate torn off its hinges
  for (const [x, z, rot, len] of [[-25.3, 16.2, 0, 9.4], [-20.6, 18.0, R.E, 3.6], [-20.6, 24.2, R.E, 3.6]]) {
    const c = AP.cagePanel({ length: len, h: 2.8 }); c.position.set(x, 0, z); c.rotation.y = rot; scene.add(c);
    const sw = Math.abs(Math.sin(rot)) > 0.5;
    colliders.push(sw ? { minX: x - 0.05, maxX: x + 0.05, minZ: z - len / 2, maxZ: z + len / 2 } : { minX: x - len / 2, maxX: x + len / 2, minZ: z - 0.05, maxZ: z + 0.05 });
  }
  { const gate = AP.cagePanel({ length: 2.2, h: 2.4 }); gate.position.set(-19.6, 0.05, 21.4); gate.rotation.set(-1.45, 0.4, 0); scene.add(gate); }
  const cageSign = P.sign ? P.sign('CAGE 4 · RESTRICTED · I.O.', { w: 1.4, h: 0.22, style: 'warning' }) : new THREE.Group(); cageSign.position.set(-20.55, 2.4, 18.0); cageSign.rotation.y = R.E; scene.add(cageSign);
  // the mobile carriages
  const units = [];
  const unitZ = (i, g) => CAGE.z0 + CAGE.unit / 2 + i * CAGE.unit + (i >= g ? CAGE.aisle : 0);
  for (let i = 0; i < CAGE.n; i++) {
    const u = AP.mobileUnit({ length: CAGE.x1 - CAGE.x0, seed: 50 + i });
    u.position.set((CAGE.x0 + CAGE.x1) / 2, 0, unitZ(i, CH.aisle)); u.userData.dynamic = true; scene.add(u);
    AP.labelTag(u.userData.tag, String(i + 1), i === CAGE.target ? 'LANTERN / ACCESS' : ['PERSONNEL', 'C-14 LOGS', 'ESTATES', 'SURVEY', 'PROCUREMENT', '', 'INCIDENTS'][i]);
    const box = { minX: CAGE.x0, maxX: CAGE.x1 + 0.1, minZ: 0, maxZ: 0 };
    colliders.push(box);
    units.push({ obj: u, box, z: u.position.z });
  }
  const syncUnits = () => { for (const u of units) { u.box.minZ = u.obj.position.z - 0.45; u.box.maxZ = u.obj.position.z + 0.45; } };
  syncUnits();
  // the LANTERN box on carriage 5's south face (only reachable with the aisle open there)
  const lanternBox = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.38), new THREE.MeshStandardMaterial({ color: 0x6e6a60, roughness: 0.8 }));
  const lanternLbl = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.16), new THREE.MeshStandardMaterial({ map: (() => { const c = document.createElement('canvas'); c.width = 256; c.height = 128; const x = c.getContext('2d'); x.fillStyle = '#efe9d6'; x.fillRect(0, 0, 256, 128); x.fillStyle = '#7a1010'; x.font = 'bold 44px monospace'; x.textAlign = 'center'; x.fillText('LANTERN', 128, 58); x.font = '20px monospace'; x.fillStyle = '#222'; x.fillText('DO NOT REMOVE · I.O.', 128, 100); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })() }));
  lanternLbl.position.set(0, 0, -0.192); lanternLbl.rotation.y = Math.PI; lanternBox.add(lanternLbl);
  lanternBox.position.set(-23.6, 1.13, 0); lanternBox.userData.dynamic = true; scene.add(lanternBox);
  const placeBox = () => { lanternBox.position.z = units[CAGE.target].obj.position.z - 0.47 + 0.19; };
  placeBox();
  if (CH.box) lanternBox.visible = false;
  // what it did in here: files laid out on the floor in neat rows
  {
    const g = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 9; c++) { if (Math.random() < 0.12) continue; const q = new THREE.BoxGeometry(0.24, 0.01, 0.32); q.rotateY((Math.random() - 0.5) * 0.04); q.translate(-19.8 + c * 0.34, 0.005, 9.6 + r * 0.42); g.push(q); }
    const m = new THREE.Mesh(mergeGeometries(g), M.paper || fbMat); m.receiveShadow = true; scene.add(m);
    for (let k = 0; k < 6; k++) { const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.09, 12), M.plasticWhite || fbMat); mug.position.set(-19.8 + k * 0.5, 0.045, 11.5); scene.add(mug); }
  }
  // lockers
  const lockers = [];
  for (const [x, z, rot] of [[-7.6, 6.5, R.E], [7.6, 6.5, R.W], [-29.6, 10.2, R.E], [-8.4, 24.5, R.W], [9.6, 19, R.W]]) { const l = place(kit('lockerHide', [], [0.55, 2, 0.55]), x, z, rot); l.userData.dynamic = true; lockers.push(l); }
  // halide cells
  const cellSpots = [V(4.8, 0.84, 12.4), V(-17.6, 0.12, 20.6), V(-2.2, TOP + 0.05, 40.6)];
  const cellMeshes = cellSpots.map((p, i) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.08), new THREE.MeshStandardMaterial({ color: 0x23272a, roughness: 0.5, metalness: 0.4 })));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.162, 0.025, 0.082), new THREE.MeshStandardMaterial({ color: 0xe0b020, emissive: 0x3a2a00, roughness: 0.4 })));
    g.position.copy(p).add(V(0, 0.05, 0)); g.userData.dynamic = true; scene.add(g); if (CH.cells.includes(i)) g.visible = false; return g;
  });
  const badge = AP.idBadge(); badge.visible = false; badge.userData.dynamic = true; scene.add(badge);

  // ---------------------------------------------------------------- lighting
  const hemi = new THREE.HemisphereLight(0x4a5262, 0x100c0a, game.params.has('bright') ? 3 : 0.7); scene.add(hemi);
  game.flashlight.base = 105; game.flashlight.light.angle = 0.5; game.flashlight.light.distance = 34;
  const lights = [];
  const addLight = (x, y, z, color, inten, dist, flick = 0, panel = true) => {
    const l = new THREE.PointLight(color, inten, dist, 1.7); l.position.set(x, y, z); scene.add(l);
    if (panel && P.ceilingLightPanel) { const p = P.ceilingLightPanel({ w: 1.2, d: 0.3, level: inten > 0 ? 0.6 : 0 }); p.position.set(x, y + 0.25, z); p.userData.dynamic = true; scene.add(p); }
    lights.push({ l, base: inten, flick }); return l;
  };
  addLight(-4, 2.9, 10, 0xe8eeff, 3.2, 9, 0); addLight(4, 2.9, 10.5, 0xe8eeff, 2.6, 9, 2); addLight(0, 2.7, 3, 0xe8eeff, 1.5, 6, 1);
  addLight(-19, 3.2, 10, 0xffc488, 3.5, 10, 0, false); addLight(-19, 3.2, 21, 0xffc488, 2.2, 9, 1, false); addLight(-12, 3.2, 4, 0xffc488, 1.4, 7, 0, false);
  // the theatre's house lights (off until the breaker) and its green exit signs
  const house = [];
  for (const [x, z] of [[-7.7, 22], [9.7, 22], [-7.7, 30], [9.7, 30], [-7.7, 38], [9.7, 38]]) { const l = new THREE.PointLight(0xffb070, 0, 7, 1.8); l.position.set(x + (x < 0 ? 0.3 : -0.3), 3 + groundAt(x, z) * 0.7, z); scene.add(l); house.push(l); }
  for (const [x, z, rot] of [[-7.8, 20.9, R.E], [0, 18.3, R.N]]) { const s = P.sign ? P.sign('EXIT', { w: 0.5, h: 0.2, style: 'exit' }) : new THREE.Group(); s.position.set(x, 2.5, z); s.rotation.y = rot; scene.add(s); const l = new THREE.PointLight(0x30ff70, 0.7, 4, 2); l.position.copy(s.position).add(V(Math.sin(rot) * 0.3, -0.2, Math.cos(rot) * 0.3)); scene.add(l); }
  const boothLight = new THREE.PointLight(0xffd8a0, 0, 5, 1.8); boothLight.position.set(1, TOP + 2.3, 40.5); scene.add(boothLight);
  // the projector: a spotlight that projects the footage canvas onto the screen (and onto anything in front of it)
  const film = document.createElement('canvas'); film.width = 512; film.height = 288;
  const fctx = film.getContext('2d');
  const filmTex = new THREE.CanvasTexture(film); filmTex.colorSpace = THREE.SRGBColorSpace;
  const lensPos = V(1, TOP + 1.18, 38.88);
  // the light cone circumscribes the screen; `focus` narrows the projected image (16:9) to exactly fill it
  const throwD = lensPos.distanceTo(V(SCREEN.x, SCREEN.y, SCREEN.z));
  const halfV = Math.atan((SCREEN.h / 2) / throwD), halfDiag = Math.atan(Math.hypot(SCREEN.w / 2, SCREEN.h / 2) / throwD) * 1.03;
  const beam = new THREE.SpotLight(0xfff4e0, 0, 34, halfDiag, 0, 1.2);
  beam.position.copy(lensPos); beam.target.position.set(SCREEN.x, SCREEN.y, SCREEN.z); beam.map = filmTex;
  beam.castShadow = true; beam.shadow.mapSize.set(1024, 576); beam.shadow.focus = halfV / halfDiag; beam.shadow.bias = -0.0005; beam.shadow.camera.near = 1;
  scene.add(beam, beam.target);
  // dust hanging in the throw: a faint additive pyramid from the lens to the screen's edges, fading toward the screen
  const cone = (() => {
    const L = lensPos, c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => V(SCREEN.x + a * SCREEN.w / 2, SCREEN.y + b * SCREEN.h / 2, SCREEN.z + 0.05));
    const pos = [], t = [];
    for (let k = 0; k < 4; k++) { const p = c[k], q = c[(k + 1) % 4]; pos.push(L.x, L.y, L.z, p.x, p.y, p.z, q.x, q.y, q.z); t.push(0, 1, 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('t', new THREE.Float32BufferAttribute(t, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: 'attribute float t; varying float vT; void main() { vT = t; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uOpacity; varying float vT; void main() { float a = uOpacity * smoothstep(0.02, 0.2, vT) * (1.0 - vT * 0.85) * (1.0 - vT * 0.85); gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * a, 1.0); }',
    });
    const mesh = new THREE.Mesh(g, m); mesh.userData.dynamic = true; mesh.frustumCulled = false; scene.add(mesh);
    return { mesh, set opacity(v) { m.uniforms.uOpacity.value = v; }, get opacity() { return m.uniforms.uOpacity.value; } };
  })();
  const bounce = new THREE.PointLight(0xfff0dc, 0, 14, 1.6); bounce.position.set(SCREEN.x, SCREEN.y - 1.2, SCREEN.z + 1.4); scene.add(bounce);
  // spill from the throw, catching its shoulders from behind (only while it stands there watching)
  const rim = new THREE.PointLight(0xffe8c8, 0, 5, 1.8); rim.position.set(0.8, 3.0, 23.4); scene.add(rim);
  const lit = new Set();
  const ZONES = { reading: [ROOMS.reading], booth: [{ x0: BOOTH.x0, x1: BOOTH.x1, z0: BOOTH.z0, z1: BOOTH.z1 }] };
  const isLit = (x, z) => { for (const zn of lit) for (const r of ZONES[zn]) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return true; return false; };

  // ---------------------------------------------------------------- navigation (it does not climb the tiers)
  const grid = new NavGrid({ x0: -31, x1: 22, z0: -6, z1: 43 }, 0.5);
  const navRects = () => [ROOMS.corr, ROOMS.office, ROOMS.reading, ROOMS.liftlobby, ROOMS.vault, ROOMS.ncorr, { x0: -8, x1: 10, z0: 18, z1: TIER.z0 - 0.2 }, ...DOORS];
  function rebuildGrid() {
    grid.blocked.fill(0); grid.opaque.fill(0);
    grid.carve(navRects());
    for (const c of colliders) grid.addBox(c, { pad: 0.15, opaque: false });
    for (const s of sightBlockers) grid.addBox(s, { block: false, opaque: true });
    for (const u of units) grid.addBox(u.box, { block: false, opaque: true });
  }
  rebuildGrid();
  const patrol = [
    { x: -19, z: 4 }, { x: -19, z: 14, look: true }, { x: -19, z: 24 }, { x: -25, z: 10.4, mode: 'crawl' }, { x: -13, z: 10.4 }, { x: -13, z: 18.8, mode: 'crawl' },
    { x: -25, z: 14.4 }, { x: -4, z: 11, look: true }, { x: 0, z: 3 }, { x: 0, z: 16 }, { x: 1, z: 22, look: true }, { x: 11.5, z: 9 }, { x: -10, z: 23.6 },
  ];

  // ---------------------------------------------------------------- performance
  game.batch(scene);
  beam.shadow.needsUpdate = true;

  // ---------------------------------------------------------------- the creature
  const gltf = await loadCreatureModel((p) => game.onProgress?.(p));
  const B = Creature.spawn(gltf); B.object.scale.setScalar(0.93);
  B.object.position.set(-19, 0, 22); scene.add(B.object); B.object.updateMatrixWorld(true);
  B.attach({ colliders: [], bounds: { min: V(-30, 0, -5), max: V(21, 0, 42) } });
  const blockB = creatureBlockers(B);
  player.colliders = colliders;
  player.groundAt = groundAt;
  player.blockers = () => (B.object.visible ? blockB() : []);
  const hunter = new Hunter({ creature: B, grid, game, patrol, isLit, onKill: () => die(), hunt: 0.4 });
  hunter.script(true); hunter.aggression = 1.0;
  B.object.visible = false;

  // ---------------------------------------------------------------- the lamp
  const lampModel = P.halideLamp ? P.halideLamp() : new THREE.Group();
  const lamp = new HalideLamp(game, lampModel, { cells: 3, recharge: 11 });
  lamp.give();
  lamp.targets.push({ point: () => B.bone.upperChest.getWorldPosition(V(0, 0, 0)), onFlash: (dist) => { if (B.object.visible) hunter.flashHit(dist); } });
  game.flashlight.on = true;
  player.onStep = (p, run) => {
    const onWood = p.x > -8 && p.x < 10 && p.z > 18;
    sfx.footstep(undefined, onWood ? 'metal' : 'tile', { run, player: true });
    hunter.noise(p, run ? 14 : player.crouch ? 1.4 : 4.2);
  };

  // ---------------------------------------------------------------- hiding
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
    const f = V(Math.sin(l.rotation.y) * 0.8, 0, Math.cos(l.rotation.y) * 0.8).add(l.position);
    player.pos.set(f.x, 0, f.z); player.eyeOverride = null; player.frozen = false;
    hunter.playerHidden = false; hunter.sawHide = false; ui.hiding(false); hidden = null; lampModel.visible = true;
  }
  for (const l of lockers) interact.add({ position: () => l.position.clone().add(V(0, 1.3, 0)), label: () => (hidden ? 'Leave locker' : 'Hide in locker'), reach: 1.8, size: 0.5, onUse: () => (hidden ? unhide() : hide(l)), enabled: () => !hidden || hidden.locker === l });

  // ---------------------------------------------------------------- objectives
  function objectiveText() {
    if (CH.done) return 'Take the mine lift down.';
    if (!CH.box) return CH.index ? 'Cage 4 · carriage 5 · south face. Crank the shelving open.' : 'Find the current access fiche. The card index is behind the counter.';
    if (!CH.breaker) return 'Restore power to the reading room: the breaker is in the projection booth.';
    if (!CH.fiche) return 'Read the fiche in the reading room.';
    let t = `Enter the code at the mine lift (${CODE})`;
    if (!CH.files) t += ' · the LANTERN files: burn them, or upload them';
    return t;
  }
  const refreshObjective = () => ui.objective(objectiveText());

  // ---------------------------------------------------------------- the shelving: crank an aisle open (slow, loud)
  let cranking = false;
  async function crankTo(i) {
    if (cranking || CH.aisle === i) return;
    cranking = true;
    const from = units.map((u) => u.obj.position.z), to = units.map((_, k) => unitZ(k, i));
    const wheel = units[i].obj.userData.wheel;
    const moving = units.filter((_, k) => Math.abs(from[k] - to[k]) > 0.01);
    sfx.doorSlide(V(-25, 1, 20), { heavy: true }); sfx.pipeGroan(V(-25, 1, 20), { dur: 3, depth: 0.8 });
    hunter.noise(V(-24, 0, 20), 26);
    if (!CH.toldCrank) { CH.toldCrank = true; game.run(() => say(OK, 'That\'s going to carry, Rook. Every carriage you move.', 3)); }
    const T0 = d.t, dur = 2.2 + moving.length * 0.5;
    await d.until(() => {
      const k = Math.min(1, (d.t - T0) / dur), e = k * k * (3 - 2 * k);
      units.forEach((u, n) => { u.obj.position.z = from[n] + (to[n] - from[n]) * e; });
      wheel.rotation.x -= 0.25; syncUnits(); placeBox();
      if (Math.random() < 0.06) sfx.metalImpact(V(-25, 0.5, units[i].obj.position.z), 0.15);
      return k >= 1;
    });
    sfx.metalImpact(V(-25, 0.5, units[i].obj.position.z), 0.6);
    CH.aisle = i; rebuildGrid(); cranking = false;
    checkpoint();
  }
  units.forEach((u, i) => interact.add({
    position: () => V(CAGE.x1 + 0.12, 1.15, u.obj.position.z), reach: 1.9, size: 0.35,
    label: () => (CH.aisle === i ? `Carriage ${i + 1}: aisle open` : `Crank carriage ${i + 1} (open the aisle here)`),
    enabled: () => !cranking && CH.aisle !== i, onUse: () => game.run(() => crankTo(i)),
  }));

  // ---------------------------------------------------------------- interactions
  interact.add({ position: () => catalogue.position.clone().add(V(0, 1.2, -0.3)), reach: 2, size: 0.6, label: 'Search the card index', onUse: async () => { CH.index = true; if (!CH.docs.includes('index')) CH.docs.push('index'); await ui.readDoc(DOCS.index, game.input); refreshObjective(); checkpoint(); if (!CH.toldIndex) { CH.toldIndex = true; game.run(async () => { await say(OK, 'Cage 4.', 1.6); await say(OK, '...Take the fiche, Rook. Only the fiche. Leave the rest where it is.'); }); } } });
  interact.add({ position: () => lanternBox.position, reach: 1.9, size: 0.4, label: 'Take the box marked LANTERN', enabled: () => !CH.box && CH.aisle === CAGE.target, onUse: () => game.run(takeBox) });
  interact.add({ position: V(3.6, TOP + 1.4, 41.65), reach: 2, size: 0.4, label: () => (CH.breaker ? 'Breaker closed' : 'Close the breaker · THEATRE / READING RM'), enabled: () => !CH.breaker, onUse: () => game.run(closeBreaker) });
  interact.add({ position: () => proj.position.clone().add(V(0, 1.7, 0.1)), reach: 2.2, size: 0.6, label: () => (!CH.box ? 'Projector (no film)' : !CH.breaker ? 'Projector (no power)' : 'Thread the LANTERN reel and run it'), enabled: () => !CH.film && !filmPlaying, onUse: () => { if (!CH.box || !CH.breaker) { sfx.beep('deny'); return; } game.run(playFilm); } });
  interact.add({ position: V(11.5, 1.1, 12.9), reach: 2, size: 0.5, label: () => (!CH.breaker ? 'Microfiche reader (no power)' : !CH.box ? 'Microfiche reader (no fiche)' : 'Read the fiche'), onUse: async () => { if (!CH.breaker || !CH.box) { sfx.beep('deny'); if (!CH.breaker && !CH.toldPower) { CH.toldPower = true; await say(OK, 'Dead? The reading room\'s on the old theatre circuit. The breaker\'s up in the projection booth.'); } return; } drawFiche(); await ui.readDoc(DOCS.fiche, game.input); if (!CH.fiche) { CH.fiche = true; if (!CH.docs.includes('fiche')) CH.docs.push('fiche'); refreshObjective(); checkpoint(); game.run(afterFiche); } } });
  interact.add({ position: V(-7.6, 1.25, 12.4), reach: 2, size: 0.5, label: 'Burn the LANTERN files', enabled: () => CH.box && !CH.files && !uploading, onUse: () => game.run(burnFiles) });
  interact.add({ position: () => relay.position.clone().add(V(-0.3, 1.1, 0)), reach: 2, size: 0.6, label: 'Upload the LANTERN files to the audit relay', enabled: () => CH.box && !CH.files && !uploading, onUse: () => game.run(uploadFiles) });
  interact.add({ position: () => badge.position, reach: 1.8, size: 0.3, label: 'Pick up the badge', enabled: () => badge.visible, onUse: () => { badge.visible = false; CH.badge = true; if (!CH.docs.includes('badge')) CH.docs.push('badge'); ui.readDoc(DOCS.badge, game.input); checkpoint(); } });
  interact.add({ position: () => keypad.position, reach: 2, size: 0.35, label: () => (CH.fiche ? 'Enter the code' : 'Keypad (you need the code)'), enabled: () => !CH.done, onUse: () => { if (!CH.fiche) { sfx.beep('deny'); return; } game.run(enterCode); } });
  interact.add({ position: V(-1, 1.6, 0.3), reach: 2.4, size: 0.5, label: 'Read the consent form', enabled: () => false, onUse: () => {} });
  cellMeshes.forEach((m, i) => interact.add({ position: () => m.position, label: 'Take halide cell', reach: 1.8, size: 0.25, enabled: () => m.visible, onUse: () => { m.visible = false; CH.cells.push(i); lamp.refill(); ui.toast('HALIDE CELL · LAMP RECHARGED', 2.5); } }));

  // ---------------------------------------------------------------- beats
  async function takeBox() {
    CH.box = true; lanternBox.visible = false; sfx.debris(lanternBox.position, { amount: 0.3 });
    for (const k of ['consent', 'memo']) if (!CH.docs.includes(k)) CH.docs.push(k);
    refreshObjective(); checkpoint();
    ui.toast('LANTERN BOX · FICHE, FORMS, ONE REEL OF FILM', 3.5);
    await ui.readDoc(DOCS.consent, game.input);
    await ui.readDoc(DOCS.memo, game.input);
    await say(OK, 'Rook.', 1.4);
    await say(OK, 'I asked you to take the fiche.', 2.6);
    await d.wait(1.5);
    await say(OK, 'The reader runs off the old theatre circuit. The breaker\'s in the projection booth, top of the seating.');
  }
  async function closeBreaker() {
    CH.breaker = true; boothBreaker.userData.setOn?.(true);
    sfx.metalImpact(V(3.6, TOP + 1.4, 41.8), 0.5); sfx.powerUp();
    lit.add('reading'); lit.add('booth');
    readLamp.intensity = 2.2; boothLight.intensity = 2.4;
    for (const [i, l] of house.entries()) setTimeout(() => { l.intensity = 2.2; }, 300 + i * 220);
    rscr.mat.emissiveIntensity = 0.6; drawReaderIdle();
    proj.userData.lens.material.emissiveIntensity = 0.3;
    refreshObjective(); checkpoint();
    await say(OK, 'There. The reader should have power.');
    if (CH.box) await say(OK, 'Leave the projector alone, Rook.', 2.6);
  }
  function drawReaderIdle() { const c = rscr.ctx; c.fillStyle = '#0d1410'; c.fillRect(0, 0, 512, 400); c.fillStyle = '#b8d8c0'; c.font = '22px monospace'; c.fillText('INSERT FICHE', 170, 200); rscr.tex.needsUpdate = true; }
  function drawFiche() {
    const c = rscr.ctx; c.fillStyle = '#e8ecd8'; c.fillRect(0, 0, 512, 400);
    c.fillStyle = '#1a1a1a'; c.font = 'bold 22px monospace'; c.fillText('SITE 41 · ACCESS · CURRENT', 30, 50);
    c.font = '18px monospace'; c.fillText('ADIT LIFT (MINE) CAGE CONTROL', 30, 110); c.font = 'bold 54px monospace'; c.fillText(CODE.split('').join(' '), 60, 180);
    c.font = '16px monospace'; for (let i = 0; i < 9; i++) c.fillText(`LANTERN-D · ${String(1904 + i * 7).padStart(5, '0')} · CONTAINER ${i + 1} · ${i === 8 ? 'RETURNED: 1 · AWAKE' : 'DELIVERED'}`, 30, 230 + i * 18);
    rscr.tex.needsUpdate = true;
  }
  async function afterFiche() {
    await d.wait(1);
    await say(OK, 'That\'s the lift. Good.');
    if (!CH.files) { await d.wait(0.8); await say(OK, 'Now the box. There\'s an incinerator chute in the office. All of it goes in, Rook. The film, the forms. All of it.'); }
  }

  // ---------------------------------------------------------------- the film (projected; B comes to watch)
  let filmPlaying = false, filmT = -1;
  const LINES = [
    [7.0, LINDF, 'Teodor Lind. Fourteenth of March. I\'m doing this of my own free will.', 4.2],
    [12.5, LINDF, 'Imani. If you\'re watching this later... it was worth trying. Whatever it looks like.', 5],
    [21.5, LINDF, 'Day nine. Can\'t keep anything down. The light hurts. Everything is so loud.', 4.6],
    [27.5, LINDF, 'I keep counting the chairs in here. I\'ve put them in rows. It helps.', 4.4],
    [36.5, OKF, 'Teodor? Teodor, can you hear me?', 3],
    [41.5, LINDF, '...Imani. Turn the light off.', 3.2],
    [50.5, OKF, 'Day thirty-one. LANTERN-0 administered. No response.', 4],
    [56, OKF, 'Log it as C-14B. A second individual recovered from the same site.', 4.4],
  ];
  async function playFilm() {
    filmPlaying = true; CH.film = true; checkpoint();
    proj.userData.reels.forEach((r) => { r.visible = true; });
    sfx.beep('click'); sfx.doorSlide(proj.position, { heavy: false });
    game.run(async () => { await say(OK, 'Rook. Don\'t.', 2.2); });
    hunter.script(true);
    // it comes up through the fire door and stands in the pit, in the beam, watching
    B.object.visible = true; B.object.position.set(-9.5, 0, 20.9); B.anim.heading = Math.PI / 2;
    B.anim.gait.reset({ limbs: ['L', 'R'], home: { L: [0.15, 0], R: [-0.165, -0.075] } });
    B.anim.play('follow', { path: [{ x: -6, z: 20.9 }, { x: -1, z: 21.5 }, { x: 0.8, z: 21.2 }], mode: 'walk', speed: 0.6, gaze: 'forward', onArrive: () => B.anim.play('faceWall', { yaw: Math.PI }) });
    filmT = 0;
    beam.intensity = 1700; cone.opacity = 0.009; proj.userData.lens.material.emissiveIntensity = 2.5;
    for (const l of house) l.intensity = 0.25;
    sfx.setTension(0.4);
    for (const [at, who, text, dur] of LINES) { await d.until(() => filmT >= at); game.run(() => say(who, text, dur)); }
    await d.until(() => filmT >= 66);
    // white-out, the film burns through, then the tail flapping on the reel
    await d.until(() => filmT >= 70);
    beam.intensity = 0; cone.opacity = 0; filmPlaying = false; filmT = -1; bounce.intensity = 0; rim.intensity = 0.9;
    sfx.powerDown(); for (const l of house) l.intensity = 0.6;
    await d.wait(1.5);
    await watchedScene();
  }
  function drawFilm(t) {
    const c = fctx, W = 512, H = 288;
    const flick = 0.85 + Math.random() * 0.15;
    c.globalAlpha = 1;
    const sky = (v) => `rgb(${(v * flick) | 0},${(v * flick * 0.97) | 0},${(v * flick * 0.92) | 0})`;
    if (t < 6) { // countdown leader
      c.fillStyle = sky(150); c.fillRect(0, 0, W, H);
      c.strokeStyle = '#222'; c.lineWidth = 6; c.beginPath(); c.arc(W / 2, H / 2, 100, 0, Math.PI * 2); c.stroke(); c.beginPath(); c.arc(W / 2, H / 2, 80, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(W / 2, 0); c.lineTo(W / 2, H); c.moveTo(0, H / 2); c.lineTo(W, H / 2); c.stroke();
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.moveTo(W / 2, H / 2); c.arc(W / 2, H / 2, 110, -Math.PI / 2, -Math.PI / 2 + (t % 1) * Math.PI * 2); c.fill();
      c.fillStyle = '#111'; c.font = 'bold 90px serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(Math.max(2, 7 - Math.ceil(t))), W / 2, H / 2 + 4);
    } else if (t < 48) {
      const day = t < 20 ? 0 : t < 34 ? 9 : 23;
      const ir = day === 23;
      const base = ir ? 80 : day === 9 ? 95 : 130;
      c.fillStyle = sky(base); c.fillRect(0, 0, W, H);
      c.fillStyle = sky(base * 0.6); c.fillRect(0, H * 0.72, W, H * 0.28); // floor
      c.fillStyle = sky(base * 0.8); for (let x = 30; x < W; x += 90) c.fillRect(x, H * 0.2, 4, H * 0.52); // wall panels
      // chairs in rows at the back (more of them each time)
      const nch = day === 0 ? 2 : day === 9 ? 6 : 9;
      c.fillStyle = sky(base * 0.45);
      for (let k = 0; k < nch; k++) { const x = 40 + (k % 5) * 34, y = H * 0.6 - Math.floor(k / 5) * 12; c.fillRect(x, y, 18, 4); c.fillRect(x, y - 16, 3, 16); c.fillRect(x + 14, y, 3, 14); }
      const cx = W * 0.58, fy = H * 0.72;
      c.fillStyle = sky(base * 0.25);
      if (day < 23) {
        // seated man; by day 9 hunched and thinner, arms too long
        const hunch = day === 9 ? 18 : 0, armL = day === 9 ? 62 : 40;
        c.fillRect(cx - 34, fy - 50, 68, 8); c.fillRect(cx - 30, fy - 50, 5, 50); c.fillRect(cx + 25, fy - 50, 5, 50); // chair
        c.beginPath(); c.moveTo(cx - 26, fy - 52); c.lineTo(cx + 26, fy - 52); c.lineTo(cx + 20 + hunch * 0.4, fy - 118 + hunch); c.lineTo(cx - 20 + hunch * 0.4, fy - 118 + hunch); c.fill();
        c.beginPath(); c.arc(cx + hunch * 0.8, fy - 132 + hunch * 1.4, 15, 0, Math.PI * 2); c.fill();
        c.fillRect(cx - 30, fy - 110 + hunch, 7, armL); c.fillRect(cx + 23, fy - 110 + hunch, 7, armL);
        if (day === 0) { c.fillStyle = sky(base * 1.4); c.fillRect(cx - 16, fy - 82, 26, 18); } // the clipboard on his knee
      } else {
        // standing. Too tall. The head goes over at an angle no neck allows.
        const sway = Math.sin(t * 1.3) * 3;
        c.fillRect(cx - 14 + sway, fy - 170, 28, 120); c.fillRect(cx - 12, fy - 52, 8, 52); c.fillRect(cx + 4, fy - 52, 8, 52);
        c.fillRect(cx - 26 + sway, fy - 165, 7, 120); c.fillRect(cx + 19 + sway, fy - 165, 7, 120);
        c.save(); c.translate(cx + sway, fy - 176); c.rotate(t > 41 ? 1.9 : 0.5); c.beginPath(); c.ellipse(0, -14, 12, 17, 0, 0, Math.PI * 2); c.fill(); c.restore();
        if (t > 41) { c.fillStyle = '#e8f0e0'; c.fillRect(cx + sway + 10, fy - 186, 3, 3); c.fillRect(cx + sway + 16, fy - 182, 3, 3); }
      }
      if (ir) { c.fillStyle = 'rgba(80,120,80,0.25)'; c.fillRect(0, 0, W, H); }
      c.fillStyle = 'rgba(255,255,255,0.85)'; c.font = '16px monospace'; c.textAlign = 'left'; c.textBaseline = 'top';
      c.fillText(`LANTERN · SUBJECT T. LIND · DAY ${day}${ir ? ' · IR' : ''}`, 12, 10);
      c.fillText(`03/${String(14 + day).padStart(2, '0')}  ${String(6 + ((t * 7) | 0) % 18).padStart(2, '0')}:${String(((t * 37) | 0) % 60).padStart(2, '0')}`, W - 140, 10);
    } else if (t < 66) {
      // day 31: the chair is empty. Up in the corner, two points of light.
      c.fillStyle = sky(55); c.fillRect(0, 0, W, H); c.fillStyle = sky(35); c.fillRect(0, H * 0.72, W, H * 0.28);
      c.fillStyle = sky(20); c.fillRect(W * 0.58 - 34, H * 0.72 - 50, 68, 8);
      c.fillStyle = 'rgba(80,120,80,0.25)'; c.fillRect(0, 0, W, H);
      const k = t > 61 ? (t - 61) / 5 : 0; // at the end it comes at the camera
      if (k > 0) { c.fillStyle = sky(10); c.beginPath(); c.ellipse(W * (0.85 - k * 0.35), H * (0.2 + k * 0.3), 30 + k * 260, 60 + k * 300, 0, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = '#eef4e6'; const ex = W * (0.86 - k * 0.35), ey = H * (0.16 + k * 0.25), s = 2 + k * 14;
      c.fillRect(ex, ey, s, s); c.fillRect(ex + 8 + k * 30, ey + 3, s, s);
      c.fillStyle = 'rgba(255,255,255,0.85)'; c.font = '16px monospace'; c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText('LANTERN · SUBJECT C-14B · DAY 31 · IR', 12, 10);
    } else {
      // the film burns through
      const k = Math.min(1, (t - 66) / 2.5);
      c.fillStyle = `rgb(${255 * (1 - k * 0.3)},${245 * (1 - k * 0.5)},${220 * (1 - k * 0.8)})`; c.fillRect(0, 0, W, H);
      c.fillStyle = 'rgba(90,40,10,0.8)'; for (let i = 0; i < 14 * k; i++) { c.beginPath(); c.arc(W / 2 + Math.sin(i * 2.3) * 120 * k, H / 2 + Math.cos(i * 1.7) * 80 * k, 20 + 60 * k, 0, Math.PI * 2); c.fill(); }
    }
    // grain, scratches, dust
    for (let i = 0; i < 220; i++) { c.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.18)'; c.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5); }
    if (Math.random() < 0.5) { c.fillStyle = 'rgba(255,255,255,0.2)'; c.fillRect(Math.random() * W, 0, 1, H); }
    if (Math.random() < 0.15) { c.fillStyle = 'rgba(0,0,0,0.5)'; c.beginPath(); c.arc(Math.random() * W, Math.random() * H, 2 + Math.random() * 5, 0, Math.PI * 2); c.fill(); }
    // a black frame: outside the image the projector's texture lookup clamps to the edge, so keep the edge dark
    c.strokeStyle = '#000'; c.lineWidth = 6; c.strokeRect(0, 0, W, H);
    filmTex.needsUpdate = true;
  }

  // B watched itself. Now it turns round, finds you, and leaves something behind.
  async function watchedScene() {
    if (CH.seen) return;
    CH.seen = true;
    if (!B.object.visible) {
      // the reel was never run: it is standing in the pit anyway, facing the blank screen
      hunter.script(true); B.object.visible = true; B.object.position.set(0.8, 0, 21.2);
      B.anim.play('faceWall', { yaw: Math.PI });
    }
    sfx.setTension(0.6); sfx.heartbeat(80);
    await d.wait(2.5);
    B.anim.play('idle', { stare: true });
    await d.wait(5.5);
    sfx.creatureBreath(B.object.position.clone().add(V(0, 2, 0)), { intensity: 0.2 });
    await d.wait(2);
    const at = B.object.position.clone();
    badge.position.set(at.x + 0.3, 0.005, at.z + 0.6); badge.rotation.y = 0;
    B.anim.play('crouch', { dur: 1.6 }); await d.wait(1.8);
    badge.visible = true; sfx.beep('click');
    B.anim.play('follow', { path: [{ x: -4, z: 21.2 }, { x: -7.6, z: 20.9 }, { x: -10, z: 20.9 }], mode: 'walk', speed: 0.7, gaze: 'forward' });
    await d.until(() => B.object.position.x < -9.2);
    B.object.visible = false; hunter.enabled = false; rim.intensity = 0;
    sfx.heartbeat(0); sfx.setTension(0.15);
    checkpoint(); refreshObjective();
    await d.wait(2);
    await say(OK, '...', 2);
    if (CH.film) await say(OK, 'Burn the box, Rook.', 2.6);
    else await say(OK, 'It\'s going down. Toward the mine. Get the code, Rook.');
    if (save.get('halloran') === 'saved') { await d.wait(3); await say(HALR, 'Doctor? Halloran. It just went past the landing. Didn\'t even slow down. Like it\'s going home.'); }
  }

  // ---------------------------------------------------------------- the choice
  let uploading = false;
  async function burnFiles() {
    CH.files = 'burned'; save.set('files', 'burned'); save.set('obedience', (save.get('obedience', 0) || 0) + 1);
    sfx.metalImpact(V(-7.6, 1.2, 12.4), 0.5); sfx.debris(V(-7.6, 1.2, 12.4), { amount: 0.4 });
    const T0 = d.t; game.run(async () => { await d.until(() => { const k = d.t - T0; fire.intensity = k < 8 ? (2 + Math.random() * 1.2) * Math.min(1, k) : Math.max(0, 3 - (k - 8)); return k > 11; }); fire.intensity = 0; });
    refreshObjective(); checkpoint();
    await d.wait(2);
    await say(OK, 'Thank you, Rook.', 2.2);
    await say(OK, 'I mean that. Whatever you think of me now. Thank you.');
  }
  async function uploadFiles() {
    uploading = true;
    const total = 32; const T0 = d.t;
    sfx.beep('ok');
    const lines = [[3, 'Rook? What\'s that noise?'], [9, 'Is that the relay? Rook. Stop it.'], [16, 'You don\'t understand what happens when that goes out. To the site. To you. To him.'], [24, 'Rook, I am asking you.']];
    let li = 0;
    await d.until(() => {
      const k = Math.min(1, (d.t - T0) / total);
      if (relayScreen?.ctx) { const c = relayScreen.ctx, w = relayScreen.canvas.width, h = relayScreen.canvas.height; c.fillStyle = '#071018'; c.fillRect(0, 0, w, h); c.fillStyle = '#8fd0ff'; c.font = `${Math.round(h * 0.07)}px monospace`; c.fillText('HALVERSEN ESTATES · AUDIT RELAY', w * 0.06, h * 0.18); c.fillText(`LANTERN · ${Math.round(k * 214)} / 214 PAGES · REEL 1`, w * 0.06, h * 0.35); c.strokeStyle = '#8fd0ff'; c.strokeRect(w * 0.06, h * 0.5, w * 0.88, h * 0.12); c.fillRect(w * 0.06, h * 0.5, w * 0.88 * k, h * 0.12); relayScreen.texture.needsUpdate = true; }
      if (Math.random() < 0.05) sfx.beep('click');
      if (li < lines.length && d.t - T0 > lines[li][0]) { game.run(() => say(OK, lines[li][1])); li++; }
      return k >= 1;
    });
    uploading = false;
    CH.files = 'uploaded'; save.set('files', 'uploaded'); save.set('truth', (save.get('truth', 0) || 0) + 2);
    sfx.beep('ok'); refreshObjective(); checkpoint();
    await d.wait(3);
    await say(OK, '...', 2.5);
    await say(OK, 'I see.', 2.4);
  }
  async function enterCode() {
    for (const ch of CODE) { sfx.beep('click'); await d.wait(0.25); }
    sfx.beep('ok'); CH.done = true; refreshObjective(); checkpoint();
    if (!CH.files) await say(OK, 'And the box? ...Fine. Leave it. Nobody comes down here anyway.', 4);
    sfx.doorSlide(liftObj.position, { heavy: true });
    const T0 = d.t; await d.until(() => { const k = Math.min(1, (d.t - T0) / 3); liftObj.userData.setDoors?.(k); return k >= 1; });
    Object.assign(liftDoorBox, { minX: 1e6, maxX: 1e6 });
    await d.until(() => player.pos.x > 21.6);
    player.frozen = true; player.lookAt(V(17, 1.6, 10.5), 1.5);
    await ui.fadeTo(1, 2.5);
    save.set('chapter', 4); save.set('ch3', null);
    save.set('truth', (save.get('truth', 0) || 0) + CH.docs.length);
    if (CH.badge) save.set('badge', true);
    await say(OK, 'The adit lift goes down four hundred metres. The radio won\'t follow you all the way.', 4.4);
    await say(OK, 'Rook. Whatever you find down there. It isn\'t him any more.', 4);
    const { chapter4 } = await import('./chapter4.js');
    await game.load(chapter4, {});
  }

  // ---------------------------------------------------------------- death
  async function die() {
    if (CH.dead) return; CH.dead = true;
    sfx.creatureScream(game.camera.position, { dur: 1.2 }); sfx.stinger('hit');
    ui.red(true); ui.setFade(1); player.frozen = true;
    await new Promise((r) => setTimeout(r, 900));
    ui.red(false); if (hidden) ui.hiding(false);
    await ui.death('YOU WERE TAKEN', hunter.sawHide ? 'It saw where you went.' : 'It hears the shelving from anywhere in the vault. Crank, then move.', game.input);
    const st = save.get('ch3') || {};
    game.load(chapter3, { state: { ...st, dead: false }, restart: true });
  }

  // ---------------------------------------------------------------- script
  async function opening() {
    if (!opts.restart) player.place(0, -3.5, Math.PI, 0);
    else player.place(0, 4, Math.PI, 0);
    ui.setFade(1);
    sfx.setAmbience('labDark', 0.7, 3); sfx.setReverb('large');
    if (!opts.restart) {
      await ui.card('CHAPTER THREE', 'THE ARCHIVE', 4);
      ui.fadeTo(0, 3);
      await d.wait(2);
      await say(OK, 'You\'re in the archive level. Records, and the old theatre. Nobody\'s used either since the move.');
      await say(OK, 'The mine lift is at the far end, east. It takes a code. Halversen changes it every month and files it on microfiche, because of course they do.');
      await say(OK, 'The card index is behind the counter. Find the current fiche, read it, and go.');
      await d.wait(1);
      await say(OK, 'It came up the stair ahead of you. It\'s in there somewhere, Rook. Quietly.');
    } else ui.fadeTo(0, 1.5);
    refreshObjective();
    if (!CH.seen) { B.object.visible = true; hunter.script(false); hunter.set('idle'); }
  }
  async function watchPit() {
    // if the reel is never run, the encounter still happens: in the pit, after the power is back
    await d.until(() => CH.breaker && !CH.film && !CH.seen && player.groundY < 0.1 && player.pos.z > 18.5 && player.pos.z < 24 && player.pos.x > -8 && player.pos.x < 10);
    if (CH.film || CH.seen) return;
    hunter.script(true); B.object.visible = true; B.object.position.set(0.8, 0, 19.4); B.anim.play('faceWall', { yaw: Math.PI });
    await watchedScene();
  }

  // restore
  if (CH.breaker) { lit.add('reading'); lit.add('booth'); readLamp.intensity = 2.2; boothLight.intensity = 2.4; for (const l of house) l.intensity = 2.2; rscr.mat.emissiveIntensity = 0.6; drawReaderIdle(); }
  if (CH.box) proj.userData.reels.forEach((r) => { r.visible = CH.film; });
  if (CH.seen) { hunter.enabled = false; B.object.visible = false; if (!CH.badge) { badge.position.set(1.1, 0.005, 21.8); badge.visible = true; } }
  if (CH.fiche) drawFiche();
  window.__ch3 = { CH, hunter, B, player, interact, grid, units, crankTo, use: (re) => { const it = interact.items.find((i) => i.enabled() && re.test(typeof i.label === 'function' ? i.label() : i.label)); if (it) it.onUse(it); return !!it; } };

  if (game.params.get('cp') === 'still') { ui.setFade(0); applyDebugCamera(game); if (game.params.has('lit')) { for (const l of house) l.intensity = 2.2; readLamp.intensity = 2.2; boothLight.intensity = 2.4; } if (game.params.has('film')) { filmT = 24; beam.intensity = 1700; cone.opacity = 0.009; bounce.intensity = 2; rim.intensity = 1.6; B.object.visible = true; B.object.position.set(0.8, 0, 21.2); B.anim.play('faceWall', { yaw: Math.PI }); } }
  else game.run(async () => { await opening(); game.run(watchPit); });

  let shadowFrame = 0, filmFrame = 0;
  return {
    look: 'horror', ownFade: true,
    update(dt, t) {
      const ctx = creatureCtx(game);
      if (B.object.visible) { B.update(dt, ctx); if (hunter.enabled) hunter.update(dt); player.shake = Math.max(player.shake, B.anim.shake); }
      lamp.update(dt);
      if (filmT >= 0) {
        filmT += dt; filmFrame += dt;
        if (filmFrame > 1 / 18) { filmFrame = 0; drawFilm(filmT); }
        beam.intensity = 1700 * (0.9 + Math.random() * 0.1) * (filmT > 66 ? 1.3 : 1);
        rim.intensity = B.object.visible && B.object.position.z > 19.5 ? 1.6 : 0;
        bounce.intensity = (filmT < 6 ? 1.8 : filmT < 48 ? (filmT < 34 ? 2.2 : 1.4) : filmT < 66 ? 0.7 : 3.2) * (0.85 + Math.random() * 0.15);
        proj.userData.reels.forEach((r, i) => { r.rotation.x -= dt * (i ? 2.2 : 1.6); });
        if ((shadowFrame++ % 2) === 0) beam.shadow.needsUpdate = true;
        if (Math.random() < dt * 8) sfx.beep('click');
      } else if (game.params.has('film') && game.params.get('cp') === 'still') { filmFrame += dt; if (filmFrame > 1 / 18) { filmFrame = 0; drawFilm(24 + (t % 20)); } beam.shadow.needsUpdate = true; }
      for (const L of lights) if (L.flick) L.l.intensity = L.base * (Math.random() < (L.flick === 2 ? 0.06 : 0.015) ? 0.1 : 1);
      const dd = B.object.visible ? B.anim.distToPlayer() : 99;
      game.fear = hunter.enabled ? Math.max(0, 1 - dd / 9) * (hunter.state === 'chase' ? 1 : 0.6) : Math.max(0, 1 - dd / 14) * 0.4;
      sfx.heartbeat(hunter.enabled && dd < 6 && B.object.visible ? 70 + (6 - dd) * 12 : 0);
    },
    dispose() { sfx.setTension(0); sfx.heartbeat(0); },
  };
}
