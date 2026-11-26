// CHAPTER FOUR: THE NEST
// Level 400 of the old mine, four hundred metres down. The station, the main drift, the 2019 survey camp,
// the return airway, and Chamber Five: the containment chamber Halversen built where they found A, which B
// has made into a copy of Lind's office. Some of the missing staff are there, under lab coats, breathing.
// Okafor starts the purge. You choose how this ends: the lure, the overcharge, or (if you followed Lind's
// trail all the way) the last dose of LANTERN-0.
import * as THREE from 'three';
import { Creature } from '../creature.js';
import { loadCreatureModel, creatureBlockers, creatureCtx, applyDebugCamera } from './common.js';
import { sfx } from '../engine/game.js';
import { save } from '../save.js';
import { NavGrid } from '../ai/navgrid.js';
import { Hunter } from '../ai/hunter.js';
import { HalideLamp } from '../engine/lamp.js';
import { buildRooms, placer } from './rooms.js';
import { mineMaterials, rockDeform, Parts, timberSets, rails, Bulbs, labCoat, sleeper, hiding, Exposure, Respirator, Gas, StepEcho, mmss, rng } from './mine.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const OK = 'Dr. Okafor', OKP = 'Dr. Okafor (phone)', OKA = 'Dr. Okafor (PA)', TAPE = 'Lind (tape)', RADIO = 'Radio', HALR = 'Halloran (radio)';
const R = { N: 0, S: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 };
const CODE = '741';
const PURGE = 20 * 60;

// ------------------------------------------------------------------ plan (x east, z north)
const ROOMS = {
  car: { x0: -1.25, x1: 1.25, z0: -2.6, z1: -0.05, h: 2.8, floor: 'concrete' },
  station: { x0: -7, x1: 7, z0: 0, z1: 10, h: 4.2, floor: 'concrete' },
  lamproom: { x0: -14, x1: -7, z0: 1.5, z1: 8.5, h: 3.0, floor: 'concrete' },
  refuge: { x0: 7, x1: 13, z0: 2, z1: 8, h: 2.8, floor: 'concrete' },
  drift: { x0: -1.7, x1: 1.7, z0: 10, z1: 60, h: 3.3 },
  subst: { x0: 1.7, x1: 7.5, z0: 27, z1: 33, h: 3.0, floor: 'concrete' },
  xcut: { x0: -14, x1: -1.7, z0: 40, z1: 42.6, h: 2.9 },
  camp: { x0: -28, x1: -14, z0: 34, z1: 50, h: 5.2 },
  junction: { x0: -7, x1: 7, z0: 60, z1: 68, h: 4.2 },
  low1: { x0: -6.4, x1: -4.6, z0: 68, z1: 80.4, h: 1.5 },
  low2: { x0: -4.6, x1: 9, z0: 78.6, z1: 80.4, h: 1.5 },
  lock: { x0: 7, x1: 9, z0: 62.6, z1: 65.4, h: 2.6, floor: 'concrete' },
  ante: { x0: 9, x1: 21, z0: 60, z1: 70, h: 3.2, floor: 'concrete' },
  chamber: { x0: 9, x1: 27, z0: 70, z1: 88, h: 5.5, floor: 'concrete' },
  store: { x0: 27, x1: 33, z0: 76, z1: 84, h: 2.8, floor: 'concrete' },
};
const DOORS = [
  { x0: -1.25, x1: 1.25, z0: -0.3, z1: 0.25, top: 2.7 }, // the cage
  { x0: -7.3, x1: -6.7, z0: 3.8, z1: 5.6 }, { x0: 6.7, x1: 7.3, z0: 4, z1: 5.6 },
  { x0: -1.7, x1: 1.7, z0: 9.7, z1: 10.3, top: 3.2 },
  { x0: 1.4, x1: 2.0, z0: 28.5, z1: 31.5, top: 2.6 },
  { x0: -2.0, x1: -1.4, z0: 40, z1: 42.6, top: 2.6 }, { x0: -14.3, x1: -13.7, z0: 40, z1: 42.6, top: 2.7 },
  { x0: -1.7, x1: 1.7, z0: 59.7, z1: 60.3, top: 3.2 },
  { x0: -6.4, x1: -4.6, z0: 67.7, z1: 68.3, top: 1.5 }, { x0: -4.9, x1: -4.3, z0: 78.6, z1: 80.4, top: 1.5 },
  { x0: 8.7, x1: 9.3, z0: 78.6, z1: 80.4, top: 1.3 }, // the vent into the chamber
  { x0: 6.7, x1: 7.3, z0: 63, z1: 65, top: 2.3 }, { x0: 8.7, x1: 9.3, z0: 63, z1: 65, top: 2.3 }, // the bulkhead
  { x0: 13, x1: 15, z0: 69.7, z1: 70.3, top: 2.3 },
  { x0: 16, x1: 20, z0: 69.7, z1: 70.3, top: 2.3, nav: false }, // observation window (sill and glass added)
  { x0: 26.7, x1: 27.3, z0: 79, z1: 81, top: 2.3 },
];
const BUILT = ['car', 'station', 'lamproom', 'refuge', 'subst', 'lock', 'ante', 'chamber', 'store'].map((k) => ROOMS[k]);
const LOW = [ROOMS.low1, ROOMS.low2];
const inRect = (r, x, z, m = 0) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;
const NEST = [ROOMS.chamber, ROOMS.store, ROOMS.ante, { x0: -4.6, x1: 9, z0: 78.6, z1: 80.4 }];
const MISSING = [['M. ASANTE', 'Asante, M.', 'C-14 technician'], ['J. KERR', 'Kerr, J.', 'security'], ['P. VARGA', 'Varga, P.', 'survey'], ['S. ODUYA', 'Oduya, S.', 'catering']];

const DOCS = {
  board: {
    ref: 'STATION · SIGNING BOARD · LEVEL 400', title: 'Signed down. Never signed up.',
    body: `<p>Brass tallies on hooks, one per person below ground. Most hooks are empty and dusty. Four tallies are still hanging, from three months ago:</p>
<p><b>ASANTE, M.</b> (C-14 technician) · <b>KERR, J.</b> (security) · <b>VARGA, P.</b> (survey) · <b>ODUYA, S.</b> (catering)</p>
<p>Under them, a memo in Okafor's hand: <i>“Transferred off-site. Do not query.”</i> Catering staff were never cleared for Level 400.</p>`,
  },
  charger: {
    ref: 'LAMP ROOM · CARD ON THE CHARGER', title: 'Halide lamp: overcharge',
    body: `<p>Seated on this bench, the lamp's cells can be bridged. Holding the trigger past a full charge then discharges <b>every cell at once</b>.</p>
<p>At under four metres this is lethal to C-14 tissue. It leaves the lamp empty, and you with it.</p>
<p><b>Not for use without the Director's written authorisation.</b> — I.O.</p>`,
  },
  map: {
    ref: '2019 SURVEY · LEVEL 400 EAST · PINNED TO A BOARD', title: 'Where we found it',
    body: `<p>A hand-drawn plan. The main drift runs north from the station to a junction. Off the junction to the east: a chamber circled again and again in red, labelled <b>CHAMBER 5 · CONTAINMENT (BUILT JUL 19)</b>.</p>
<p>The chamber has one door, a pressure bulkhead from the junction. A dotted line loops north and round: <i>“return airway · 1.5 m · crawl · comes out at the chamber vent”</i>.</p>
<p>In the margin: <i>“If the bulkhead's shut from inside, the wheel is on the inside. Use the airway.”</i></p>`,
  },
  photos: {
    ref: 'CAMP · FIELD TABLE · PHOTOGRAPHS, 2019', title: 'Recovery of C-14A',
    body: `<p>A dozen prints, curling with damp. A tall shape at the back of a chamber, always facing the rock, never the camera. A team in hard hats in a line, grinning. Lind is in the middle, younger, an arm round Okafor.</p>
<p>On the back of the last one: <i>“14 June. It's been standing like that for eleven days. Imani won't let me name it. — T.”</i></p>`,
  },
  log: {
    ref: 'CHAMBER 5 · OBSERVATION LOG · 2019', title: 'Containment, day one',
    body: `<p><b>03 JUL 2019.</b> Bulkhead closed 04:10. Subject does not react to sound. Reacts violently to light above 2,000 lux.</p>
<p><b>05 JUL.</b> Survey staff report headaches after shifts in the chamber. Respirators issued.</p>
<p><b>09 JUL.</b> Varga (survey, first rotation) complains her hands ache. Says her fingers feel “too long”. Sent up.</p>
<p><b>11 JUL.</b> Respirators mandatory. Recommend the chamber is never entered without one again. — T.L.</p>`,
  },
  sleeper: {
    ref: 'UNDER THE COATS', title: 'Asante, M.',
    body: `<p>A lab coat has been laid over her like a blanket and tucked in, carefully, all the way round. The name tag says ASANTE.</p>
<p>She is breathing, slowly, about four times a minute. Under the edge of the coat her hand is grey, and much too long, and the fingers have one joint too many.</p>
<p>She is warm.</p>`,
  },
};
const TAPES = [
  { key: 'tape1', lines: [[TAPE, 'Day seventeen. I came down on my own. I have the last dose of LANTERN-0 in a cold box, and about four days of being myself left.', 6], [TAPE, 'I\'m going to forget things. I\'ve already forgotten my mother\'s name. So, a trail. Like breadcrumbs. For me, after.', 5.5], [TAPE, 'The first number is seven.', 3]] },
  { key: 'tape2', lines: [[TAPE, 'Day nineteen. I built the office again. I don\'t know why. The chairs have to be in rows. Imani always sat in the third row.', 6], [TAPE, 'The dose is in the old sample store. I\'ve locked it with my badge, so only I can get at it.', 4.6], [TAPE, 'Four. The second number is four.', 3.2]] },
  { key: 'tape3', lines: [[TAPE, '...I don\'t know what day it is. If you\'re hearing this, you\'re not me. Good. That\'s good.', 5], [TAPE, 'Drawer five. My badge, then the three numbers. When I come for it, I won\'t know what it\'s for.', 5], [TAPE, 'So don\'t use the light on me. Sit in the dark and let me come to you. Then do it.', 5], [TAPE, 'One. Seven, four, one.', 3]] },
];

// ------------------------------------------------------------------ the level
export async function chapter4(game, opts = {}) {
  const { scene, player, ui, director: d, interact, renderer } = game;
  const say = (who, text, dur) => ui.say(who, text, dur);
  renderer.toneMappingExposure = 1.12;
  scene.background = new THREE.Color(0x020202);
  scene.fog = new THREE.FogExp2(0x040403, 0.05);

  const CH = Object.assign({
    stage: 'descent', phone: false, mask: false, maskOn: false, filters: 1, filter: 1, lights: false, tapes: [], docs: [], cells: [],
    bulkhead: false, visited: false, hid: false, purge: false, purgeLeft: PURGE, plan: null, vial: false, charged: false,
    cage: false, grabs: 0, exposure: save.get('exposure', 0) || 0, sleeperGone: false, sat: false, done: false,
  }, opts.state || {});
  let ringing = false, turning = false, charging = false, cageWait = 90, nestT = 0, airWarned = false;
  const checkpoint = () => save.set('ch4', JSON.parse(JSON.stringify({ ...CH, dead: false, exposure: expo.value, filter: resp.filter, filters: resp.filters })));
  const hasBadge = !!save.get('badge');

  // ---------------------------------------------------------------- assets
  const [kitMod, P, AP, PP] = await Promise.all([
    import('../wingd/kit.js').catch((e) => { console.warn('kit unavailable', e); return null; }),
    import('../lab/props.js').catch(() => ({})),
    import('../archive/props.js'),
    import('../pump/props.js'),
  ]);
  if (kitMod?.loadKit) await kitMod.loadKit((a, b) => game.onProgress?.(a / b)).catch((e) => console.warn(e));
  const K = kitMod?.KIT || {};
  const M = K.materials || {};
  AP.useArchiveMaterials(M); PP.usePumpMaterials(M);
  const MM = mineMaterials(M);
  const fbMat = new THREE.MeshStandardMaterial({ color: 0x6b6862, roughness: 0.9 });
  const kit = (name, args = [], fb = null) => { try { if (typeof K[name] === 'function') return K[name](...args); } catch (e) { console.warn('kit', name, e); } const g = new THREE.Group(); if (fb) { const m = new THREE.Mesh(new THREE.BoxGeometry(...fb), fbMat); m.position.y = fb[1] / 2; g.add(m); g.userData.collider = { w: fb[0], d: fb[2] }; } return g; };
  const model = (id, o) => { try { return K.model?.(id, o) || new THREE.Group(); } catch { return new THREE.Group(); } };
  const sign = (t, o) => (P.sign ? P.sign(t, o) : new THREE.Group());

  // the rock is one material; inside the built rooms it is shotcrete, painted, with a darker band below
  const rock = MM.rock;
  {
    const R4 = BUILT.map((r) => new THREE.Vector4(r.x0, r.z0, r.x1, r.z1));
    while (R4.length < 10) R4.push(new THREE.Vector4(1e5, 1e5, 1e5, 1e5));
    rock.onBeforeCompile = (sh) => {
      sh.uniforms.uBuilt = { value: R4 };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vMineW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvMineW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vMineW; uniform vec4 uBuilt[10];')
        .replace('#include <map_fragment>', `#include <map_fragment>
          float built = 0.0;
          for (int i = 0; i < 10; i++) { vec4 r = uBuilt[i]; vec2 q = vMineW.xz; built = max(built, step(r.x - 0.05, q.x) * step(q.x, r.z + 0.05) * step(r.y - 0.05, q.y) * step(q.y, r.w + 0.05)); }
          float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
          vec3 paint = vec3(0.6, 0.6, 0.56) * (0.7 + lum * 0.7);
          paint *= mix(1.0, 0.5, step(vMineW.y, 1.15)) * (1.0 - smoothstep(0.15, 0.0, vMineW.y) * 0.4);
          paint *= 1.0 - 0.25 * smoothstep(1.2, 1.1, vMineW.y) * smoothstep(1.05, 1.1, vMineW.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, paint, built);`);
    };
    rock.customProgramCacheKey = () => 'mine-shotcrete';
  }
  const deformRock = rockDeform(0.24);
  const deform = (g, kind) => {
    // built rooms are lined: much smoother
    const p = g.attributes.position, before = p.array.slice();
    deformRock(g, kind);
    for (let i = 0; i < p.count; i++) {
      const x = before[i * 3], z = before[i * 3 + 2];
      if (BUILT.some((r) => inRect(r, x, z, -0.01))) { const k = 0.18; p.setXYZ(i, x + (p.getX(i) - x) * k, before[i * 3 + 1] + (p.getY(i) - before[i * 3 + 1]) * k, z + (p.getZ(i) - z) * k); }
    }
    p.needsUpdate = true; g.computeVertexNormals();
  };

  // ---------------------------------------------------------------- structure
  const built = buildRooms(scene, ROOMS, DOORS, { wallMat: rock, floorMats: { default: MM.gravel, gravel: MM.gravel, concrete: MM.concrete }, ceilMat: rock, worldUV: K.worldUV, thickness: 0.4, segment: 0.45, deform });
  const colliders = built.colliders, sightBlockers = built.sightBlockers;
  const place = placer(scene, colliders);
  const parts = new Parts();
  // timber sets and rails down the drift; sets in the crosscut and the airway
  const setsZ = timberSets(parts, MM.timber, { axis: 'z', c: 0, from: 10.4, to: 59.6, w: 3.4, h: 2.95, every: 2.4, skip: (s) => (s > 27.6 && s < 32.4) || (s > 39.6 && s < 43), colliders });
  timberSets(parts, MM.timber, { axis: 'x', c: 41.3, from: -13.6, to: -2.2, w: 2.6, h: 2.6, every: 2.6 });
  timberSets(parts, MM.timber, { axis: 'z', c: -5.5, from: 68.2, to: 78.4, w: 1.8, h: 1.35, every: 2.0 });
  timberSets(parts, MM.timber, { axis: 'x', c: 79.5, from: -4.4, to: 8.6, w: 1.8, h: 1.35, every: 2.0 });
  rails(parts, MM.steel, MM.timber, { axis: 'z', c: 0, from: 1, to: 64 });
  rails(parts, MM.steel, MM.timber, { axis: 'x', c: 41.3, from: -14, to: -1.7 });
  // the observation window's sill and glass
  parts.box(MM.concrete, 18, 0.5, 70, 4, 1.0, 0.3); colliders.push({ minX: 16, maxX: 20, minZ: 69.75, maxZ: 70.25 });
  parts.build(scene, { worldUV: K.worldUV, tile: 1.2 });
  {
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.3), new THREE.MeshStandardMaterial({ color: 0x8c9a96, transparent: true, opacity: 0.16, roughness: 0.15, defines: { GLOSSY: '' } }));
    glass.position.set(18, 1.65, 70); glass.userData.dynamic = true; scene.add(glass);
    // cracked from the inside: a few scratch lines on it
    const c = document.createElement('canvas'); c.width = 512; c.height = 170; const x = c.getContext('2d');
    x.strokeStyle = 'rgba(220,230,225,0.5)'; x.lineWidth = 1.2;
    for (let k = 0; k < 9; k++) { x.beginPath(); let px = 180 + Math.random() * 160, py = 40 + Math.random() * 90; x.moveTo(px, py); for (let s = 0; s < 6; s++) { px += (Math.random() - 0.5) * 90; py += (Math.random() - 0.5) * 50; x.lineTo(px, py); } x.stroke(); }
    const t = new THREE.CanvasTexture(c);
    const cr = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.3), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false })); cr.position.set(18, 1.65, 70.01); cr.userData.dynamic = true; scene.add(cr);
  }

  // ---------------------------------------------------------------- the cage
  const liftObj = place(kit('freightLift', [{ w: 2.4, d: 2.2, h: 2.7, wall: 0.3 }], [2.6, 2.8, 0.4]), 0, 0, 0);
  liftObj.userData.dynamic = true; liftObj.userData.setDoors?.(0);
  const cageDoor = { minX: -1.3, maxX: 1.3, minZ: -0.14, maxZ: 0.02 }; colliders.push(cageDoor);
  const cageLight = new THREE.PointLight(0xfff0d0, 0, 4, 1.8); cageLight.position.set(0, 2.5, -1.4); scene.add(cageLight);
  const passing = new THREE.PointLight(0xffb070, 0, 6, 1.6); passing.position.set(0, -5, 0.6); scene.add(passing); // levels sliding past the gate

  // ---------------------------------------------------------------- the station, lamp room, refuge
  const phone = P.wallPhone ? P.wallPhone() : new THREE.Group(); phone.position.set(-3, 1.45, 9.78); phone.rotation.y = R.S; phone.userData.dynamic = true; scene.add(phone);
  const board = new THREE.Group();
  {
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 0.04), M.timber || fbMat); board.add(back);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 10; c++) { const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 4), MM.steel); hook.rotation.x = Math.PI / 2; hook.position.set(-0.6 + c * 0.13, 0.3 - r * 0.2, 0.04); board.add(hook); }
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08a40, metalness: 1, roughness: 0.4 });
    for (const [c, r] of [[2, 1], [5, 1], [3, 2], [8, 3]]) { const tg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.006, 12), brass); tg.rotation.x = Math.PI / 2; tg.position.set(-0.6 + c * 0.13, 0.26 - r * 0.2, 0.05); board.add(tg); }
    board.position.set(3.5, 1.6, 9.76); board.rotation.y = R.S; scene.add(board);
    const s = sign('LEVEL 400 · STATION', { w: 1.6, h: 0.25 }); s.position.set(0, 3.2, 9.75); s.rotation.y = R.S; scene.add(s);
  }
  for (const [x, z] of [[-5, 2], [5, 2]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.45, 0.45), M.timber || fbMat); b.position.set(x, 0.225, z); b.castShadow = true; scene.add(b); colliders.push({ minX: x - 1.1, maxX: x + 1.1, minZ: z - 0.23, maxZ: z + 0.23 }); }
  place(model('metal_tool_chest'), 6.2, 8.8, R.W);
  place(model('plastic_crate_03'), -6.1, 9.2, 0.3);
  // lamp room: cap lamp racks along the walls, the charger bench, two lockers
  const lampParts = new Parts();
  const capMat = new THREE.MeshStandardMaterial({ color: 0xc9a316, roughness: 0.6 }), capDark = new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.6 });
  for (const z of [1.75, 8.25]) for (let k = 0; k < 14; k++) for (let r = 0; r < 2; r++) {
    const x = -13.6 + k * 0.42, y = 1.1 + r * 0.55;
    if (Math.random() < 0.25) continue;
    lampParts.box(capDark, x, y, z + (z < 5 ? 0.12 : -0.12), 0.11, 0.18, 0.08); lampParts.cyl(capMat, V(x, y + 0.12, z + (z < 5 ? 0.16 : -0.16)), V(x, y + 0.12, z + (z < 5 ? 0.24 : -0.24)), 0.045, 10);
  }
  for (const z of [1.75, 8.25]) lampParts.box(MM.steel, -10.7, 1.4, z + (z < 5 ? 0.05 : -0.05), 6.4, 0.04, 0.12);
  lampParts.build(scene, { shadow: false });
  const charger = new THREE.Group();
  {
    const cp = new Parts();
    cp.box(MM.steel, 0, 0.45, 0, 2.2, 0.9, 0.7); cp.box(M.steelPaint || fbMat, 0, 0.92, 0, 2.3, 0.05, 0.78);
    cp.box(capDark, 0.6, 1.25, -0.25, 0.7, 0.6, 0.25); for (let k = 0; k < 6; k++) cp.box(capDark, -0.9 + k * 0.22, 1.0, 0.1, 0.12, 0.12, 0.2);
    cp.build(charger);
    const ledMat = new THREE.MeshStandardMaterial({ color: 0x0a200a, emissive: 0x30ff60, emissiveIntensity: 0.15 });
    const leds = []; for (let k = 0; k < 6; k++) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.01), ledMat.clone()); l.position.set(-0.9 + k * 0.22, 1.08, 0.205); charger.add(l); leds.push(l); }
    charger.userData.leds = leds;
    const card = sign('OVERCHARGE · DIRECTOR AUTH ONLY', { w: 0.7, h: 0.12, style: 'warning' }); card.position.set(0.6, 1.62, -0.12); charger.add(card);
  }
  place(charger, -10.5, 6.6, R.S); colliders.push({ minX: -11.7, maxX: -9.3, minZ: 6.2, maxZ: 7.0 }); charger.userData.dynamic = true;
  const chargerGlow = new THREE.PointLight(0x50ff80, 0.25, 3, 2); chargerGlow.position.set(-10.5, 1.3, 6.0); scene.add(chargerGlow);
  const lockers = [place(kit('lockerHide', [], [0.55, 2, 0.55]), -13.6, 3.2, R.E), place(kit('lockerHide', [], [0.55, 2, 0.55]), -13.6, 4.0, R.E)];
  lockers.forEach((l) => { l.userData.dynamic = true; });
  // refuge chamber: a steel box with benches, masks on hooks, first aid
  const refugeDoor = P.door ? P.door({ w: 1.2, h: 2.1, type: 'heavy', label: 'REFUGE' }) : new THREE.Group(); refugeDoor.position.set(7.15, 0, 4.8); refugeDoor.rotation.y = R.W; scene.add(refugeDoor);
  {
    const b = new THREE.Mesh(new THREE.BoxGeometry(5, 0.45, 0.5), M.steelPaint || fbMat); b.position.set(10.3, 0.225, 7.6); scene.add(b); colliders.push({ minX: 7.8, maxX: 12.8, minZ: 7.35, maxZ: 7.85 });
    const s = sign('REFUGE CHAMBER · 6 PERSONS · 36 H', { w: 1.4, h: 0.22 }); s.position.set(12.95, 2.0, 5); s.rotation.y = R.W; scene.add(s);
    if (P.firstAidBox) { const f = P.firstAidBox(); f.position.set(12.9, 1.4, 3.2); f.rotation.y = R.W; scene.add(f); }
  }
  const maskObj = new THREE.Group();
  {
    const rub = new THREE.MeshStandardMaterial({ color: 0x1a1b1c, roughness: 0.7 }), lens = new THREE.MeshStandardMaterial({ color: 0x334044, roughness: 0.1, metalness: 0.2, defines: { GLOSSY: '' } });
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), rub); face.rotation.x = Math.PI / 2; face.scale.set(1, 1, 1.3); maskObj.add(face);
    for (const s of [-1, 1]) { const l = new THREE.Mesh(new THREE.CircleGeometry(0.035, 14), lens); l.position.set(s * 0.045, 0.03, 0.105); maskObj.add(l); }
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 14), new THREE.MeshStandardMaterial({ color: 0x6b6f3a, roughness: 0.6 })); can.rotation.x = Math.PI / 2; can.position.set(0, -0.06, 0.13); maskObj.add(can);
    maskObj.position.set(12.85, 1.55, 6.4); maskObj.rotation.y = R.W; maskObj.userData.dynamic = true; scene.add(maskObj);
    for (let k = 0; k < 3; k++) { const m = maskObj.clone(); m.position.set(12.85, 1.55, 3.9 + k * 0.5); m.visible = k === 0; scene.add(m); }
  }
  if (CH.mask) maskObj.visible = false;

  // ---------------------------------------------------------------- the drift: coats on the timbers, bulbs on a cable
  const bulbs = new Bulbs(scene, { color: 0xffc58a, intensity: 9, distance: 11 });
  const driftBulbs = [];
  for (let z = 13; z < 59; z += 5.8) driftBulbs.push(bulbs.add(0, 3.0, z, { light: driftBulbs.length % 2 === 0 || z > 50, drop: 0.25 }));
  const stationBulbs = [bulbs.add(-3.5, 3.9, 5, { drop: 0.3 }), bulbs.add(3.5, 3.9, 5, { drop: 0.3, light: false })];
  stationBulbs.forEach((i) => bulbs.set(i, 0.35));
  const coats = [];
  {
    const r = rng(9);
    for (const z of setsZ) {
      if (z < 16) continue;
      for (const s of [-1, 1]) {
        if (r() < 0.25) continue;
        const c = labCoat({ seed: z * 3 + s }); c.position.set(s * 1.5, 1.95, z + 0.16); c.rotation.y = Math.PI + s * 0.55 + (r() - 0.5) * 0.3; c.rotation.z = (r() - 0.5) * 0.08; scene.add(c); coats.push(c);
      }
    }
  }
  // substation: a knife switch for the drift lighting
  const subPanel = kit('breakerPanel', [{ label: 'DRIFT LIGHTING · CCT A' }], [0.5, 0.7, 0.2]);
  subPanel.position.set(7.3, 1.4, 30); subPanel.rotation.y = R.W; subPanel.userData.dynamic = true; scene.add(subPanel);
  subPanel.userData.setOn?.(CH.lights);
  { const tb = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, 1.0), M.steelPaint || fbMat); tb.position.set(6.6, 0.8, 28.0); tb.castShadow = true; scene.add(tb); colliders.push({ minX: 6.0, maxX: 7.2, minZ: 27.5, maxZ: 28.5 }); const s = sign('DANGER 3.3 kV', { w: 0.5, h: 0.14, style: 'warning' }); s.position.set(6.0, 1.3, 28.0); s.rotation.y = R.W; scene.add(s); }

  // ---------------------------------------------------------------- the 2019 camp
  function tent(seed) {
    const g = new THREE.Group(), r = rng(seed);
    const can = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x7a5a30).offsetHSL(0, 0, (r() - 0.5) * 0.06), roughness: 0.95, side: THREE.DoubleSide });
    const L = 2.4, W = 1.9, H = 1.45;
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(L, Math.hypot(W / 2, H)), can); p.rotation.set(0, Math.PI / 2, 0); p.rotateX(s * (Math.PI / 2 - Math.atan2(H, W / 2))); p.position.set(s * W / 4, H / 2, 0); p.castShadow = p.receiveShadow = true; g.add(p); }
    const back = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([V(-W / 2, 0, -L / 2), V(W / 2, 0, -L / 2), V(0, H, -L / 2)]), can); back.geometry.computeVertexNormals(); g.add(back);
    const flap = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([V(-W / 2, 0, L / 2), V(-0.05, 0, L / 2 + 0.25), V(0, H, L / 2)]), can); flap.geometry.computeVertexNormals(); g.add(flap);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, H, 6), MM.steel); pole.position.set(0, H / 2, L / 2); g.add(pole);
    g.userData.collider = { w: W, d: L };
    return g;
  }
  const tents = [place(tent(1), -24.5, 46.5, 0.15), place(tent(2), -26.0, 39.5, Math.PI / 2 + 0.1)];
  const campParts = new Parts();
  campParts.box(M.plank || fbMat, -19.5, 0.78, 44.5, 2.2, 0.05, 0.9); for (const [dx, dz] of [[-1, -0.4], [1, -0.4], [-1, 0.4], [1, 0.4]]) campParts.box(MM.steel, -19.5 + dx, 0.39, 44.5 + dz, 0.04, 0.78, 0.04);
  campParts.box(M.timber || fbMat, -15.0, 1.4, 45.0, 0.05, 1.2, 1.8); // map board
  campParts.build(scene, { worldUV: K.worldUV });
  colliders.push({ minX: -20.6, maxX: -18.4, minZ: 44.0, maxZ: 45.0 });
  {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512; const x = c.getContext('2d');
    x.fillStyle = '#dcd2b6'; x.fillRect(0, 0, 512, 512); x.strokeStyle = '#3a3226'; x.lineWidth = 6;
    x.beginPath(); x.moveTo(256, 500); x.lineTo(256, 120); x.lineTo(340, 120); x.moveTo(256, 300); x.lineTo(110, 300); x.stroke();
    x.strokeStyle = '#a01010'; x.lineWidth = 4; for (let k = 0; k < 4; k++) { x.beginPath(); x.ellipse(400, 100, 60 + k * 4, 46 + k * 3, 0.1 * k, 0, Math.PI * 2); x.stroke(); }
    x.setLineDash([8, 8]); x.strokeStyle = '#3a3226'; x.lineWidth = 3; x.beginPath(); x.moveTo(240, 120); x.lineTo(240, 40); x.lineTo(380, 40); x.stroke();
    x.fillStyle = '#3a3226'; x.font = 'bold 22px monospace'; x.fillText('CHAMBER 5', 350, 180); x.font = '18px monospace'; x.fillText('CAMP', 80, 290); x.fillText('STATION', 220, 495);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 })); m.position.set(-14.97, 1.45, 45); m.rotation.y = R.W; scene.add(m);
  }
  const photosObj = new THREE.Group();
  { const pm = new THREE.MeshStandardMaterial({ color: 0xcfc8b4, roughness: 0.8 }); for (let k = 0; k < 7; k++) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.002, 0.1), pm); p.position.set(-20.2 + k * 0.17, 0.81, 44.4 + (k % 2) * 0.12); p.rotation.y = (Math.random() - 0.5) * 0.5; photosObj.add(p); } scene.add(photosObj); }
  const recorder1 = place(model('portable_cassette_player'), -18.9, 44.6, 0.3, 0.805); recorder1.userData.dynamic = true;
  // the 2019 recapture kit: a flight case with the lure canister and the injector pole
  const kitCase = new THREE.Group();
  {
    const cp = new Parts(), shell = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.5, metalness: 0.3 }), alu = new THREE.MeshStandardMaterial({ color: 0xaeb2b6, metalness: 1, roughness: 0.35 });
    cp.box(shell, 0, 0.22, 0, 1.6, 0.44, 0.6); cp.box(alu, 0, 0.44, 0, 1.62, 0.02, 0.62);
    cp.build(kitCase);
    const lure = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.32, 14), new THREE.MeshStandardMaterial({ color: 0xc8c070, roughness: 0.3, emissive: 0x202000, emissiveIntensity: 0.3 })); lure.rotation.z = Math.PI / 2; lure.position.set(-0.4, 0.52, 0); kitCase.add(lure);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 8), alu); pole.rotation.z = Math.PI / 2; pole.position.set(0.05, 0.5, 0.15); kitCase.add(pole);
    kitCase.userData.lure = lure; kitCase.userData.pole = pole;
    const s = sign('C-14 RECAPTURE KIT · 2019', { w: 0.7, h: 0.12, style: 'warning' }); s.position.set(0, 0.3, 0.305); kitCase.add(s);
  }
  place(kitCase, -16.2, 37.0, 0); colliders.push({ minX: -17, maxX: -15.4, minZ: 36.7, maxZ: 37.3 }); kitCase.userData.dynamic = true;
  for (const [x, z, r] of [[-22, 36, 0.2], [-22.8, 36.4, 1.1], [-27.2, 44, 0.5], [-15.2, 48.8, 0]]) place(model('plastic_crate_03'), x, z, r);
  const campLight = kit('workLight', [{ on: true }], [0.4, 1.6, 0.4]); place(campLight, -20.5, 42, 0.6); campLight.userData.dynamic = true;
  const campLamp = new THREE.PointLight(0xfff0d8, 7, 11, 1.7); campLamp.position.set(-20.3, 1.9, 42.6); scene.add(campLamp);
  let campLit = true;

  // ---------------------------------------------------------------- junction: ore car, the bulkhead, the airway
  const oreCar = new THREE.Group();
  {
    const cp = new Parts();
    const g = new THREE.CylinderGeometry(0.85, 0.65, 0.8, 4, 1, true); g.rotateY(Math.PI / 4); g.scale(1, 1, 1.45); g.translate(0, 0.75, 0);
    cp.add(MM.rust, g); cp.box(MM.rust, 0, 0.36, 0, 0.9, 0.04, 1.3);
    for (const [x, z] of [[-0.35, -0.5], [0.35, -0.5], [-0.35, 0.5], [0.35, 0.5]]) cp.cyl(MM.steel, V(x - 0.04, 0.2, z), V(x + 0.04, 0.2, z), 0.18, 12);
    cp.build(oreCar);
    oreCar.children.forEach((m) => { m.material = m.material.clone(); m.material.side = THREE.DoubleSide; });
  }
  place(oreCar, 0, 62.5, 0); colliders.push({ minX: -0.7, maxX: 0.7, minZ: 61.5, maxZ: 63.5 });
  const bulk = PP.pressureDoor({ w: 1.6, h: 2.1 });
  bulk.position.set(7.0, 0, 64); bulk.rotation.y = R.E; bulk.userData.dynamic = true; scene.add(bulk);
  const bulkBox = { minX: 6.8, maxX: 7.2, minZ: 63, maxZ: 65 }; colliders.push(bulkBox);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.025, 8, 24), MM.steel); wheel.position.set(7.35, 1.2, 64); wheel.rotation.y = Math.PI / 2; wheel.userData.dynamic = true; scene.add(wheel);
  { const s = sign('RETURN AIR · 2019 · CRAWL', { w: 0.9, h: 0.16, style: 'warning' }); s.position.set(-5.5, 1.75, 67.75); s.rotation.y = R.S; scene.add(s); }
  { const s = sign('CHAMBER 5 · NO ENTRY WITHOUT RESPIRATOR', { w: 1.3, h: 0.2, style: 'warning' }); s.position.set(6.75, 2.5, 64); s.rotation.y = R.W; scene.add(s); }
  // the airway: a coat dragged across the floor halfway along
  { const c = labCoat({ seed: 77 }); c.position.set(-5.4, 0.18, 73); c.rotation.set(-Math.PI / 2 + 0.1, 0.3, 0); scene.add(c); }

  // ---------------------------------------------------------------- the ante-room
  const antePA = P.wallPhone ? sign('PA', { w: 0.3, h: 0.14 }) : new THREE.Group(); antePA.position.set(15, 2.8, 60.3); scene.add(antePA);
  place(model('metal_office_desk'), 17.5, 68.8, R.N);
  const logbook = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.22), new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.8 })); logbook.position.set(17.2, 0.78, 68.6); scene.add(logbook);
  const anteLight = new THREE.PointLight(0xff3020, 1.2, 9, 1.8); anteLight.position.set(15, 2.9, 64); scene.add(anteLight);
  if (P.emergencyBeacon) { const b = P.emergencyBeacon(); b.position.set(15, 3.1, 64); scene.add(b); }

  // ---------------------------------------------------------------- Chamber Five: the nest
  // the office it remembers: a desk of crates and a door, a lamp, papers squared up, chairs in rows facing a
  // window scratched into the wall, coats on rock bolts, photographs everywhere, and the sleepers.
  const desk = new THREE.Group();
  {
    const cp = new Parts();
    cp.box(M.plank || fbMat, 0, 0.74, 0, 1.9, 0.05, 0.85);
    cp.build(desk, { worldUV: K.worldUV });
    for (const x of [-0.7, 0.7]) { const c = model('plastic_crate_03'); c.scale.set(1, 1.6, 1); c.position.set(x, 0, 0); desk.add(c); }
    const pm = M.paper || fbMat;
    for (let k = 0; k < 5; k++) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.02 + k * 0.012, 0.29), pm); p.position.set(-0.75 + k * 0.25, 0.77 + k * 0.006, -0.2); desk.add(p); }
  }
  place(desk, 13.8, 81, R.W); colliders.push({ minX: 13.35, maxX: 14.25, minZ: 80.0, maxZ: 82.0 });
  const deskLamp = AP.bankersLamp(); deskLamp.position.set(13.7, 0.77, 81.6); deskLamp.rotation.y = R.W; scene.add(deskLamp);
  const deskLight = new THREE.PointLight(0xffc070, 3.5, 7, 1.8); deskLight.position.set(13.5, 1.15, 81.6); scene.add(deskLight);
  const recorder2 = place(model('portable_cassette_player'), 13.9, 80.5, 0.2, 0.765); recorder2.userData.dynamic = true;
  const chairs = [];
  for (let row = 0; row < 4; row++) for (let k = 0; k < 5; k++) {
    if (row === 2 && k === 2) continue; // her chair is empty, so it is not here
    const c = P.officeChair ? P.officeChair({ seed: row * 5 + k }) : model('plastic_monobloc_chair_01');
    place(c, 16.5 + row * 1.6, 76 + k * 2.1, R.W);
    chairs.push(c);
  }
  // photographs: hundreds, pinned in a grid on the north wall, every face scratched out
  {
    const c = document.createElement('canvas'); c.width = 2048; c.height = 640; const x = c.getContext('2d');
    x.fillStyle = '#1a1816'; x.fillRect(0, 0, 2048, 640);
    const r = rng(5);
    for (let row = 0; row < 7; row++) for (let col = 0; col < 26; col++) {
      if (r() < 0.06) continue;
      const px = 18 + col * 78 + (r() - 0.5) * 6, py = 14 + row * 88 + (r() - 0.5) * 6, w = 64, h = 76;
      x.save(); x.translate(px + w / 2, py + h / 2); x.rotate((r() - 0.5) * 0.05);
      x.fillStyle = '#e8e2d2'; x.fillRect(-w / 2, -h / 2, w, h);
      const tone = 90 + r() * 70; x.fillStyle = `rgb(${tone},${tone * 0.95},${tone * 0.85})`; x.fillRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 20);
      x.fillStyle = `rgb(${tone * 0.5},${tone * 0.45},${tone * 0.4})`; x.beginPath(); x.ellipse(0, -h / 2 + 26, 11, 14, 0, 0, Math.PI * 2); x.fill(); x.fillRect(-16, -h / 2 + 40, 32, 18);
      x.strokeStyle = 'rgba(20,10,8,0.95)'; x.lineWidth = 1.6; for (let s = 0; s < 9; s++) { x.beginPath(); x.moveTo(-12 + r() * 6, -h / 2 + 12 + r() * 4); x.lineTo(10 + r() * 6, -h / 2 + 36 + r() * 6); x.stroke(); }
      x.fillStyle = '#b02020'; x.beginPath(); x.arc(0, -h / 2 + 3, 2.5, 0, Math.PI * 2); x.fill();
      x.restore();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(14, 4.4), new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 })); m.position.set(18, 2.6, 87.72); m.rotation.y = Math.PI; scene.add(m);
  }
  // the window it scratched into the west wall: a frame, blinds, a sky that is just more lines
  {
    const c = document.createElement('canvas'); c.width = 512; c.height = 384; const x = c.getContext('2d');
    x.clearRect(0, 0, 512, 384); x.strokeStyle = 'rgba(225,220,205,0.75)'; x.lineWidth = 3;
    x.strokeRect(20, 20, 472, 344); x.beginPath(); x.moveTo(256, 20); x.lineTo(256, 364); x.stroke();
    x.lineWidth = 1.5; for (let k = 0; k < 16; k++) { x.beginPath(); x.moveTo(24, 30 + k * 12 + Math.random() * 2); x.lineTo(488, 30 + k * 12 + Math.random() * 3); x.stroke(); }
    x.lineWidth = 1; for (let k = 0; k < 60; k++) { x.beginPath(); const a = 30 + Math.random() * 450, b = 230 + Math.random() * 120; x.moveTo(a, b); x.lineTo(a + Math.random() * 20, b + Math.random() * 10); x.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.4), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.9, depthWrite: false })); m.position.set(9.26, 2.2, 84); m.rotation.y = R.E; m.userData.dynamic = true; scene.add(m);
  }
  // coats on rock bolts down the east wall
  const nestCoats = [];
  for (let z = 71.2; z < 87.5; z += 0.62) { if (z > 78.6 && z < 81.4) continue; const c = labCoat({ seed: z * 5 }); c.position.set(26.55, 2.05, z); c.rotation.y = R.W + (Math.random() - 0.5) * 0.3; scene.add(c); nestCoats.push(c); }
  for (let x = 10.5; x < 12.6; x += 0.62) { const c = labCoat({ seed: x * 9 }); c.position.set(x, 2.05, 87.55); c.rotation.y = Math.PI; scene.add(c); }
  // the sleepers, in a row, heads to the east, tucked in
  const sleepers = MISSING.map(([tag], i) => {
    const s = sleeper({ seed: i + 3, hand: i !== 2 }); s.position.set(22.6, 0, 72.0 + i * 1.05); s.rotation.y = 0; scene.add(s); s.userData.dynamic = true;
    s.userData.tag = tag; return s;
  });
  colliders.push({ minX: 21.5, maxX: 23.5, minZ: 71.4, maxZ: 75.8 });
  const nestLight = new THREE.PointLight(0x9fb4c0, 3.2, 15, 1.6); nestLight.position.set(22, 4.5, 74); scene.add(nestLight);
  // one bare bulb from the 2019 install still burns over the chairs, on a long flex
  const nestBulb = bulbs.add(19, 3.4, 80.5, { drop: 1.9 }); bulbs.set(nestBulb, 1.0);
  // the 2019 sample store: six numbered steel drawers, one with a badge reader and a dial
  const drawers = new THREE.Group();
  {
    const cp = new Parts(), st = M.steelPaint || fbMat;
    for (let k = 0; k < 6; k++) { cp.box(st, 0, 0.35 + Math.floor(k / 2) * 0.62, (k % 2 ? 0.48 : -0.48), 0.6, 0.58, 0.92); }
    cp.build(drawers, { worldUV: K.worldUV });
    for (let k = 0; k < 6; k++) { const s = sign(String(k + 1), { w: 0.16, h: 0.16 }); s.position.set(-0.31, 0.5 + Math.floor(k / 2) * 0.62, (k % 2 ? 0.48 : -0.48)); s.rotation.y = R.W; drawers.add(s); }
    const reader = P.badgeReader ? P.badgeReader() : new THREE.Group(); reader.position.set(-0.31, 1.7, 0.84); reader.rotation.y = R.W; drawers.add(reader); drawers.userData.reader = reader;
  }
  place(drawers, 32.6, 80, 0); colliders.push({ minX: 32.3, maxX: 33, minZ: 79, maxZ: 81 });
  const coldLight = new THREE.PointLight(0x9cc8ff, 1.3, 7, 1.8); coldLight.position.set(30.5, 2.5, 80); scene.add(coldLight);
  const recorder3 = place(model('portable_cassette_player'), 31.9, 81.6, R.W, 0); recorder3.userData.dynamic = true;
  const vialObj = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.07, 10), new THREE.MeshStandardMaterial({ color: 0x80d0ff, emissive: 0x2070a0, emissiveIntensity: 0.6, roughness: 0.1 }));
  vialObj.position.set(32.2, 1.62, 80.48); vialObj.visible = false; vialObj.userData.dynamic = true; scene.add(vialObj);

  // halide cells: refuge, camp, ante
  const cellSpots = [V(12.6, 0.48, 7.5), V(-19.0, 0.8, 44.2), V(18.0, 0.78, 68.5)];
  const cellMeshes = cellSpots.map((p, i) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.08), new THREE.MeshStandardMaterial({ color: 0x23272a, roughness: 0.5, metalness: 0.4 })));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.162, 0.025, 0.082), new THREE.MeshStandardMaterial({ color: 0xe0b020, emissive: 0x3a2a00, roughness: 0.4 })));
    g.position.copy(p).add(V(0, 0.05, 0)); g.userData.dynamic = true; scene.add(g); if (CH.cells.includes(i)) g.visible = false; return g;
  });

  // ---------------------------------------------------------------- light and air
  const hemi = new THREE.HemisphereLight(0x4a5058, 0x0c0a08, game.params.has('bright') ? 6 : 0.5); scene.add(hemi);
  game.flashlight.base = 105; game.flashlight.light.angle = 0.5; game.flashlight.light.distance = 30;
  const refugeLight = new THREE.PointLight(0xe8f0ff, 3.0, 8, 1.8); refugeLight.position.set(10, 2.5, 5); scene.add(refugeLight);
  const lampRoomLight = new THREE.PointLight(0xffd8a0, 1.2, 7, 1.8); lampRoomLight.position.set(-10.5, 2.7, 4.5); scene.add(lampRoomLight);
  let refugeLit = true;
  const LIT = { refuge: ROOMS.refuge, camp: { x0: -23, x1: -17.5, z0: 39, z1: 45.5 } };
  const isLit = (x, z) => (refugeLit && inRect(LIT.refuge, x, z)) || (campLit && inRect(LIT.camp, x, z));
  const gas = new Gas(scene, { x0: -28, x1: 33, z0: -2.6, z1: 88 }, { level: 0 });
  const expo = new Exposure(game, CH.exposure);
  const resp = new Respirator(game, { filter: CH.filter, filters: CH.filters });
  if (CH.mask) resp.wear(!!CH.maskOn);

  // ---------------------------------------------------------------- navigation
  const grid = new NavGrid({ x0: -29, x1: 34, z0: -3, z1: 89 }, 0.5);
  function rebuildGrid() {
    grid.blocked.fill(0); grid.opaque.fill(0);
    grid.carve([...Object.values(ROOMS).filter((r) => r !== ROOMS.car), ...DOORS.filter((dd) => dd.nav !== false && dd !== DOORS[0])]);
    for (const c of colliders) if (!c.disabled) grid.addBox(c, { pad: 0.12, opaque: false });
    for (const s of sightBlockers) grid.addBox(s, { block: false, opaque: true });
  }
  rebuildGrid();
  const patrol = [
    { x: 0, z: 20 }, { x: 0, z: 36, look: true }, { x: 4.5, z: 30 }, { x: 0, z: 52 }, { x: -8, z: 41.3 }, { x: -24, z: 37, look: true }, { x: -17, z: 47 }, { x: -25, z: 44 },
    { x: -4, z: 64 }, { x: 4, z: 66, look: true }, { x: -5.5, z: 74, mode: 'crawl' }, { x: 2, z: 79.5, mode: 'crawl' }, { x: 12, z: 76 }, { x: 20, z: 85, look: true }, { x: 18.5, z: 79 }, { x: 29.5, z: 78 },
    { x: 15, z: 64 }, { x: 0, z: 8 }, { x: -10, z: 4, look: true },
  ];

  // ---------------------------------------------------------------- performance
  game.batch(scene);

  // ---------------------------------------------------------------- the creature
  const gltf = await loadCreatureModel((p) => game.onProgress?.(p));
  const B = Creature.spawn(gltf); B.object.scale.setScalar(0.93);
  B.object.position.set(-24, 0, 46); scene.add(B.object); B.object.updateMatrixWorld(true);
  B.attach({ colliders: [], bounds: { min: V(-28.5, 0, -2.5), max: V(33, 0, 88) } });
  const blockB = creatureBlockers(B);
  player.colliders = colliders;
  player.blockers = () => (B.object.visible ? blockB() : []);
  const hunter = new Hunter({ creature: B, grid, game, patrol, isLit, onKill: () => caught(), hunt: 0.45 });
  hunter.script(true); hunter.aggression = 1.0;
  B.object.visible = false;
  // in the airway it has to go on all fours, however fast it is going
  const follow0 = hunter.follow.bind(hunter);
  hunter.follow = (path, mode, extra = {}) => {
    if (path?.some((p) => LOW.some((r) => inRect(r, p.x, p.z, 0.3)))) { if (mode === 'run') extra = { ...extra, speed: 1.7 }; mode = 'crawl'; }
    follow0(path, mode, extra);
  };

  // ---------------------------------------------------------------- the lamp
  const lampModel = P.halideLamp ? P.halideLamp() : new THREE.Group();
  const lamp = new HalideLamp(game, lampModel, { cells: 3, recharge: 11 });
  lamp.give();
  lamp.targets.push({ point: () => B.bone.upperChest.getWorldPosition(V(0, 0, 0)), onFlash: (dist) => { if (B.object.visible) hunter.flashHit(dist); } });
  game.flashlight.on = true;
  const echo = new StepEcho('concrete');
  player.onStep = (p, run) => {
    sfx.footstep(undefined, 'concrete', { run, player: true });
    hunter.noise(p, run ? 14 : player.crouch ? 1.4 : 4.2);
    const f = player.forward(V(0, 0, 0)); f.y = 0; f.normalize();
    echo.step(p, f, game.time);
  };

  // ---------------------------------------------------------------- hiding
  const lockerSpot = (l) => ({ at: l.localToWorld((l.userData.inside || V(0, 1.5, -0.03)).clone()), yaw: l.rotation.y + Math.PI, out: V(Math.sin(l.rotation.y) * 0.8, 0, Math.cos(l.rotation.y) * 0.8).add(l.position), near: l.position.clone().add(V(0, 1.3, 0)), label: 'Hide in the locker', onEnter: () => { l.userData.setOpen?.(1); sfx.metalImpact(l.position, 0.3); setTimeout(() => l.userData.setOpen?.(0), 400); }, onExit: () => { l.userData.setOpen?.(1); setTimeout(() => l.userData.setOpen?.(0), 600); } });
  lockers.forEach((l) => l.updateMatrixWorld(true));
  const SPOTS = {
    coatsA: { at: V(26.25, 1.35, 75.0), yaw: R.E, out: V(25.2, 0, 75.0), near: V(26.2, 1.3, 75.0), label: 'Stand among the coats', size: 0.7 },
    coatsB: { at: V(26.25, 1.35, 84.5), yaw: R.E, out: V(25.2, 0, 84.5), near: V(26.2, 1.3, 84.5), label: 'Stand among the coats', size: 0.7 },
    desk: { at: V(13.75, 0.62, 81.0), yaw: R.W, pitch: -0.1, out: V(15.0, 0, 81.0), near: V(14.6, 0.6, 81.0), label: 'Get under the desk', size: 0.5 },
    tent1: { at: V(-24.5, 0.75, 46.3), yaw: R.N + Math.PI, pitch: -0.05, out: V(-24.4, 0, 48.4), near: V(-24.4, 0.8, 47.6), label: 'Crawl into the tent', size: 0.6 },
    tent2: { at: V(-25.8, 0.75, 39.5), yaw: R.W, pitch: -0.05, out: V(-23.8, 0, 39.7), near: V(-24.6, 0.8, 39.6), label: 'Crawl into the tent', size: 0.6 },
    ore: { at: V(0, 0.95, 62.5), yaw: R.N, pitch: -0.1, out: V(1.3, 0, 62.5), near: V(0.7, 0.9, 62.5), label: 'Climb into the ore car', size: 0.6 },
  };
  const hide = hiding(game, {
    hunter, lampModel,
    spots: [...lockers.map(lockerSpot), ...Object.values(SPOTS)],
    onHide: () => { if (CH.maskOn) resp.el.style.opacity = 0.6; },
    onLeave: () => { if (CH.maskOn) resp.el.style.opacity = 1; },
  });
  // the airway is too low to stand in
  let lowWarned = false;

  // ---------------------------------------------------------------- objectives
  function objectiveText() {
    const p = CH.purge && !CH.done ? `<b>PURGE ${mmss(CH.purgeLeft)}</b> · ` : '';
    if (CH.cage) return p + 'Get in the cage.';
    switch (CH.stage) {
      case 'descent': return null;
      case 'station': return CH.phone ? 'Take a respirator from the refuge chamber, then follow the drift north. The lights are switched at the substation.' : 'The phone is ringing.';
      case 'drift': return CH.lights ? 'Find a way into Chamber 5, at the north end of the drift.' : 'Switch on the drift lighting at the substation, halfway down.';
      case 'airway': return 'Chamber 5 is sealed from inside. Find the return airway (the 2019 survey camp has a map).';
      case 'nest': return 'Chamber 5. Find out what it is doing down here.';
      case 'hide': return '<b>Hide.</b>';
      case 'choose': return p + planText();
      case 'charging': return p + 'Stay at the charger until the overcharge is armed.';
      case 'return': return p + 'Go back to the station and call Okafor on the phone.';
      case 'wait': return p + `Survive until the cage comes down (${Math.max(0, Math.ceil(cageWait))}s).`;
      default: return null;
    }
  }
  function planText() {
    const a = ['<b>Choose how this ends.</b>', 'Lure: the recapture kit at the camp', 'Overcharge: the charger in the lamp room'];
    if (CH.vial) a.push('LANTERN-0: load the dose into the injector at the camp');
    else if (CH.tapes.length === 3 && hasBadge) a.push('LANTERN-0: drawer 5, in the sample store');
    return a.join(' · ');
  }
  let objT = 0;
  const refreshObjective = () => ui.objective(objectiveText());

  // ---------------------------------------------------------------- interactions
  const addDoc = (k) => { if (!CH.docs.includes(k)) CH.docs.push(k); };
  const read = async (k) => { addDoc(k); await ui.readDoc(DOCS[k], game.input); checkpoint(); };
  let tapePlaying = false;
  async function playTape(i) {
    const T = TAPES[i];
    if (tapePlaying) return;
    tapePlaying = true; sfx.beep('click');
    if (!CH.tapes.includes(T.key)) CH.tapes.push(T.key);
    checkpoint();
    for (const [who, text, dur] of T.lines) await say(who, text, dur);
    sfx.beep('click'); tapePlaying = false; refreshObjective();
    if (i === 1) game.run(nestReturn);
  }
  interact.add({ position: () => phone.position, reach: 2, size: 0.4, label: () => (ringing ? 'Answer the phone' : CH.stage === 'return' ? 'Call Okafor' : 'Phone (dead air)'), enabled: () => ringing || CH.stage === 'return', onUse: () => game.run(ringing ? answerPhone : callCage) });
  interact.add({ position: V(3.5, 1.6, 9.6), reach: 2, size: 0.6, label: 'Read the signing board', onUse: () => read('board') });
  interact.add({ position: V(-10.5, 1.2, 6.0), reach: 2.2, size: 0.6, label: () => (CH.stage === 'choose' ? 'Seat the lamp and arm the overcharge' : 'Lamp charger'), enabled: () => !CH.plan && !charging, onUse: () => { if (CH.stage === 'choose') game.run(armOvercharge); else read('charger'); } });
  interact.add({ position: () => maskObj.position, reach: 2, size: 0.35, label: 'Take a respirator and filters', enabled: () => !CH.mask, onUse: () => { CH.mask = true; maskObj.visible = false; resp.filters = 2; sfx.debris(maskObj.position, { amount: 0.1 }); ui.toast('RESPIRATOR · M TO WEAR · 2 SPARE FILTERS', 4); checkpoint(); refreshObjective(); } });
  interact.add({ position: V(7.3, 1.4, 30), reach: 2, size: 0.4, label: 'Throw the switch · DRIFT LIGHTING', enabled: () => !CH.lights && CH.phone, onUse: () => game.run(driftLights) });
  interact.add({ position: V(-15.0, 1.45, 45), reach: 2.2, size: 0.6, label: 'Read the survey map', onUse: () => { read('map'); if (CH.stage === 'drift' && CH.lights) { CH.stage = 'airway'; refreshObjective(); } } });
  interact.add({ position: V(-19.6, 0.85, 44.5), reach: 2, size: 0.5, label: 'Look at the photographs', onUse: () => read('photos') });
  interact.add({ position: () => recorder1.position.clone().add(V(0, 0.1, 0)), reach: 2, size: 0.3, label: () => (CH.tapes.includes('tape1') ? 'Play the tape again' : 'A tape recorder: play it'), enabled: () => !tapePlaying, onUse: () => game.run(() => playTape(0)) });
  interact.add({ position: () => recorder2.position.clone().add(V(0, 0.1, 0)), reach: 2, size: 0.3, label: () => (CH.tapes.includes('tape2') ? 'Play the tape again' : 'A tape recorder: play it'), enabled: () => !tapePlaying && CH.stage !== 'hide', onUse: () => game.run(() => playTape(1)) });
  interact.add({ position: () => recorder3.position.clone().add(V(0, 0.1, 0)), reach: 2, size: 0.3, label: () => (CH.tapes.includes('tape3') ? 'Play the tape again' : 'A tape recorder: play it'), enabled: () => !tapePlaying, onUse: () => game.run(() => playTape(2)) });
  interact.add({ position: () => logbook.position, reach: 2, size: 0.35, label: 'Read the observation log', onUse: () => read('log') });
  interact.add({ position: V(22.6, 0.4, 72.0), reach: 2, size: 0.45, label: 'Lift the edge of the coat', enabled: () => !CH.docs.includes('sleeper'), onUse: async () => { expo.add(4); sfx.whisper(V(22.6, 0.3, 72), { dur: 1.2, level: 0.4 }); await read('sleeper'); } });
  interact.add({ position: V(7.4, 1.2, 64), reach: 2.2, size: 0.45, label: () => (CH.bulkhead ? 'The bulkhead is open' : 'Turn the wheel (open the bulkhead)'), enabled: () => !CH.bulkhead && !turning && player.pos.x > 7, onUse: () => game.run(openBulkhead) });
  interact.add({ position: V(6.6, 1.2, 64), reach: 2, size: 0.45, label: 'The bulkhead: the wheel is on the other side', enabled: () => !CH.bulkhead && player.pos.x < 7, onUse: () => { sfx.knock(V(7, 1.2, 64), { n: 2, gap: 0.4, hard: 0.5 }); if (CH.stage === 'drift' || CH.stage === 'station') { CH.stage = 'airway'; refreshObjective(); } } });
  interact.add({ position: V(32.25, 1.65, 80.5), reach: 2, size: 0.4, label: () => (CH.vial ? 'Drawer 5 (empty)' : 'Drawer 5: badge reader and dial'), enabled: () => !CH.vial && !CH.plan, onUse: () => game.run(openDrawer) });
  interact.add({ position: () => kitCase.userData.lure.getWorldPosition(V(0, 0, 0)), reach: 2.2, size: 0.4, label: () => (CH.stage === 'choose' ? 'Take the lure (C-14A secretion, 2019)' : 'Recapture kit: a lure canister and an injector pole'), enabled: () => !CH.plan, onUse: () => { if (CH.stage === 'choose') game.run(takeLure); else ui.toast('A LURE CANISTER AND AN INJECTOR POLE · 2019', 3); } });
  interact.add({ position: () => kitCase.userData.pole.getWorldPosition(V(0, 0, 0)), reach: 2.2, size: 0.4, label: 'Load LANTERN-0 into the injector pole', enabled: () => CH.vial && !CH.plan, onUse: () => game.run(loadInjector) });
  cellMeshes.forEach((m, i) => interact.add({ position: () => m.position, label: 'Take halide cell', reach: 1.8, size: 0.25, enabled: () => m.visible, onUse: () => { m.visible = false; CH.cells.push(i); lamp.refill(); ui.toast('HALIDE CELL · LAMP RECHARGED', 2.5); } }));
  interact.add({ position: () => V(0, 1.4, 0.35), reach: 2.2, size: 0.8, label: 'Get in the cage', enabled: () => CH.cage && !CH.done, onUse: () => game.run(leave) });

  // ---------------------------------------------------------------- beats
  async function descent() {
    player.place(0, -1.45, Math.PI, 0); player.frozen = true; game.flashlight.on = false;
    cageLight.intensity = 1.6;
    const cage = sfx.loop('cage', V(0, 2.8, -1.4), 0.8);
    sfx.setAmbience('mine', 0.0, 1);
    await ui.card('CHAPTER FOUR', 'THE NEST', 4);
    ui.fadeTo(0, 3);
    let run = true;
    game.run(async () => { while (run) { passing.position.y = -3; passing.intensity = 2.2; const T0 = d.t; await d.until(() => { passing.position.y = -3 + (d.t - T0) * 9; return d.t - T0 > 0.9 || !run; }); passing.intensity = 0; await d.wait(2.5 + Math.random() * 3); } });
    const shake = d.every((dt) => { player.shake = Math.max(player.shake, 0.12); cageLight.intensity = 1.6 * (Math.random() < 0.02 ? 0.3 : 1); });
    await d.wait(2);
    await say(OK, 'Four hundred metres. The 2019 team called it Level 400. It\'s a long way down, Rook. Talk to me if you need to.', 5);
    await d.wait(3);
    await say(OK, 'When the cage stops you\'ll be at the old station. The containment chamber is at the far end of the main drift. Chamber Five.', 5.5);
    await d.wait(4);
    sfx.radio(1.2, { speaker: OK });
    await say(OK, 'Rook, the signal is going to... (static)', 3);
    await d.wait(5);
    // it stops early. The light goes. Something knocks on the side of the car, three times, slowly.
    run = false; shake(); cage.set(0, 0.2); sfx.metalImpact(V(0, 2.5, -1.4), 1.2); player.shake = 1.4;
    cageLight.intensity = 0; sfx.powerDown();
    await d.wait(3.5);
    sfx.knock(V(1.35, 1.4, -1.6), { n: 3, gap: 0.9, hard: 0.6 });
    sfx.setTension(0.3);
    await d.wait(5);
    cageLight.intensity = 0.8; sfx.powerUp();
    cage.set(0.5, 0.3); await d.wait(2.5); cage.set(0, 0.4); sfx.metalImpact(V(0, 0.2, -1.4), 0.8); player.shake = 0.6;
    await d.wait(1.2); cage.stop(1);
    sfx.doorSlide(liftObj.position, { heavy: true });
    const T0 = d.t; await d.until(() => { const k = Math.min(1, (d.t - T0) / 2.5); liftObj.userData.setDoors?.(k); return k >= 1; });
    cageDoor.disabled = true; player.frozen = false; game.flashlight.on = true; sfx.setTension(0.1);
    sfx.setAmbience('mine', 0.9, 4); sfx.setReverb('large');
    ui.toast('NO SIGNAL', 3);
    CH.stage = 'station'; checkpoint(); refreshObjective();
    await d.wait(4);
    ringing = true; refreshObjective();
    while (ringing) { sfx.phoneRing(phone.position); await d.wait(4); }
  }
  async function answerPhone() {
    ringing = false; sfx.beep('click'); CH.phone = true;
    await say(OKP, 'Rook. It\'s Okafor. Good. The old station line still works. I wasn\'t sure it would.', 4.6);
    await say(OKP, 'The containment chamber is at the end of the main drift. We built it in 2019, round the spot where we found A.', 5);
    await say(OKP, 'The drift lights are switched at the substation, halfway along. And there are respirators in the refuge chamber, to your right. Take one.', 5.4);
    await say(OKP, 'The 2019 team had headaches down there. Then they had worse.', 3.6);
    await say(OKP, 'Find out what it\'s doing, Rook. Then call me from this phone.', 3.6);
    sfx.beep('click'); refreshObjective(); checkpoint();
    // footsteps that keep pace with yours, a few metres back, until the substation
    echo.on = true;
  }
  async function driftLights() {
    CH.lights = true; CH.stage = 'drift'; echo.on = false; subPanel.userData.setOn?.(true);
    sfx.metalImpact(V(7.3, 1.4, 30), 0.7); sfx.powerUp(); refreshObjective(); checkpoint();
    // they come on one after another, all the way down: coats on every set, like people lining a road
    for (const i of driftBulbs) { bulbs.set(i, 1, { flicker: 0.3 }); sfx.beep('click'); await d.wait(0.28); }
    // and at the far end, in the middle of the drift, facing you
    hunter.script(true); B.object.visible = true; B.object.position.set(0, 0, 56.5); B.anim.heading = Math.PI; B.anim.play('idle', { stare: true });
    sfx.setTension(0.5);
    await d.wait(4.5);
    sfx.creatureBreath(V(0, 2, 56), { intensity: 0.6 });
    await d.wait(1.5);
    // then they go, far end first, coming toward you
    for (const i of [...driftBulbs].reverse()) {
      bulbs.set(i, 0); sfx.glassKnock?.(bulbs.items[i].pos); sfx.metalImpact(bulbs.items[i].pos, 0.08);
      if (bulbs.items[i].pos.z < 52) B.object.visible = false;
      await d.wait(0.35);
    }
    await d.wait(2.5);
    for (const [k, i] of driftBulbs.entries()) if (k % 2 === 0) bulbs.set(i, 0.55, { flicker: 1.5 });
    sfx.setTension(0.2);
    // it is somewhere else now, and listening
    B.object.position.set(-24, 0, 46); B.object.visible = true; hunter.script(false); hunter.set('idle');
    await d.wait(14);
    // the radio has had no signal since the cage. It clicks on anyway.
    await say(RADIO, 'Rook?', 1.6);
    await d.wait(2);
    await say(RADIO, 'Rook. Come back to the station, Rook.', 3);
    await d.wait(1.5);
    await say(RADIO, 'Rook. Come back to the station, Rook.', 3);
    await d.wait(2.5);
    await say(RADIO, '...Imani. Turn the light off.', 3);
    sfx.whisper(null, { dur: 1.6, level: 0.5 });
  }
  async function openBulkhead() {
    turning = true;
    sfx.pipeGroan(V(7, 1.2, 64), { dur: 4, depth: 1.2 }); hunter.noise(V(7, 0, 64), 30);
    const T0 = d.t; await d.until(() => { const k = Math.min(1, (d.t - T0) / 4.5); wheel.rotation.x = k * 9; bulk.userData.setOpen?.(k * 0.9); return k >= 1; });
    sfx.metalImpact(V(7, 1, 64), 0.9);
    CH.bulkhead = true; bulkBox.disabled = true; rebuildGrid(); turning = false; checkpoint();
  }
  // B comes home while you are in the nest
  async function nestReturn() {
    if (CH.visited) return;
    CH.visited = true;
    await d.wait(1.5);
    sfx.creatureDrag(V(-2, 0.5, 79.5), { dur: 1.2 }); sfx.knock(V(3, 0.6, 79.5), { n: 1, hard: 0.3 });
    await d.wait(2.5);
    sfx.creatureBreath(V(4, 0.6, 79.5), { intensity: 0.4 });
    CH.stage = 'hide'; refreshObjective(); sfx.setTension(0.55);
    hunter.script(true); B.object.visible = false;
    const T0 = d.t;
    await d.until(() => hide.current || d.t - T0 > 18);
    await d.wait(hide.current ? 3 : 0);
    // out of the vent on all fours, then up
    B.object.visible = true; B.object.position.set(7.4, 0, 79.5); B.anim.heading = Math.PI / 2;
    B.anim.gait.reset({ limbs: ['L', 'R', 'hL', 'hR'], home: { L: [0.2, -0.12], R: [-0.2, -0.12], hL: [0.36, 1.12], hR: [-0.36, 1.12] } });
    let blown = false;
    const watch = d.every(() => { if (!hide.current && hunter.playerVisibility() > 0.15) blown = true; });
    const walk = (path, mode = 'walk', speed) => new Promise((res) => B.anim.play('follow', { path, mode, speed, gaze: 'forward', onArrive: res }));
    const step = async (fn) => { if (blown) return; await Promise.race([fn(), d.until(() => blown)]); };
    await step(() => walk([{ x: 10.5, z: 79.5 }], 'crawl', 0.7));
    await step(async () => { await walk([{ x: 12.5, z: 81 }], 'walk', 0.6); B.anim.play('idle', {}); deskLight.intensity = 0.8; await d.wait(0.4); deskLight.intensity = 3.5; await d.wait(2); });
    await step(async () => { await walk([{ x: 16.0, z: 82.0 }, { x: 19.5, z: 77.5 }], 'walk', 0.55); sfx.metalImpact(V(19.2, 0.5, 78.1), 0.1); await d.wait(1.8); });
    await step(async () => { await walk([{ x: 21.2, z: 73.6 }], 'walk', 0.55); B.anim.play('crouch', { yaw: Math.PI / 2 }); await d.wait(3.5); sfx.whisper(V(22, 0.4, 73.5), { dur: 2, level: 0.45 }); await d.wait(2.5); });
    // the coats: it walks the row, and stops in front of you
    const spot = hide.current && (hide.current === SPOTS.coatsA || hide.current === SPOTS.coatsB || hide.current === SPOTS.desk) ? hide.current : null;
    if (spot) {
      await step(async () => {
        const front = spot === SPOTS.desk ? { x: 15.2, z: 81 } : { x: 25.0, z: spot.at.z };
        await walk([{ x: 24.6, z: 76 }, front], 'stalk', 0.45);
        B.anim.play('idle', { stare: true }); sfx.setTension(0.85); sfx.heartbeat(110);
        await d.wait(1.5); sfx.creatureSniff(V(front.x, 1.8, front.z));
        await d.wait(2); sfx.creatureBreath(V(front.x, 1.7, front.z), { intensity: 0.3 });
        await d.wait(3.5);
        sfx.heartbeat(0);
      });
    } else await step(async () => { await walk([{ x: 24.6, z: 76 }, { x: 25, z: 84 }], 'walk', 0.55); await d.wait(1.5); });
    // out through the ante-room, and it opens the bulkhead from inside
    await step(async () => { await walk([{ x: 18, z: 78 }, { x: 14, z: 71.5 }, { x: 14, z: 67 }, { x: 9.6, z: 64 }], 'walk', 0.85); });
    watch();
    if (blown) { CH.stage = 'nest'; sfx.heartbeat(0); hunter.script(false); hunter.suspicion = 1.2; hunter.lastSeen = V(player.pos.x, player.pos.z); hunter.chase(); refreshObjective(); await d.until(() => hunter.state !== 'chase' && hunter.state !== 'attack'); return purgeAnnounce(); }
    if (!CH.bulkhead) { sfx.pipeGroan(V(7, 1.2, 64), { dur: 3.5, depth: 1.2 }); const T1 = d.t; await d.until(() => { const k = Math.min(1, (d.t - T1) / 3.5); wheel.rotation.x = k * 9; bulk.userData.setOpen?.(k * 0.9); return k >= 1; }); CH.bulkhead = true; bulkBox.disabled = true; rebuildGrid(); }
    await walk([{ x: 5, z: 64 }, { x: 0, z: 58 }], 'walk', 1.0);
    B.object.visible = false; sfx.setTension(0.2);
    CH.hid = true;
    await d.wait(4);
    await purgeAnnounce();
  }
  async function purgeAnnounce() {
    if (CH.purge) return;
    CH.purge = true; CH.purgeLeft = PURGE; CH.stage = 'choose'; checkpoint();
    sfx.pa('chime'); await d.wait(1.5);
    await say(OKA, 'Rook. If you can hear this... I\'m sorry. Halversen has instructed me to purge Wing D and everything below it.', 5.4);
    await say(OKA, 'It runs through the main fan in twenty minutes. Nothing that breathes will be left down there.', 4.6);
    await say(OKA, 'End it, or bring it back to me. Then come to the station and call. I\'ll send the cage.', 4.6);
    refreshObjective();
    // it comes back for you now
    await d.wait(8);
    B.object.position.set(-24, 0, 46); B.object.visible = true; hunter.script(false); hunter.set('idle'); hunter.hunt = 0.55;
  }
  async function openDrawer() {
    if (!hasBadge) { sfx.beep('deny'); ui.toast('THE READER WANTS A BADGE · T. LIND', 3); return; }
    sfx.beep('ok');
    if (CH.tapes.length < 3) { await d.wait(0.6); sfx.beep('deny'); ui.toast('BADGE ACCEPTED · THE DIAL WANTS THREE NUMBERS', 3.5); return; }
    for (const ch of CODE) { sfx.beep('click'); await d.wait(0.35); }
    sfx.metalImpact(V(32.3, 1.6, 80.5), 0.3); sfx.valveHiss(V(32.3, 1.6, 80.5), { dur: 1.5, strength: 0.4 });
    vialObj.visible = true; await d.wait(1); vialObj.visible = false;
    CH.vial = true; checkpoint(); refreshObjective();
    ui.toast('LANTERN-0 · ONE DOSE · STILL COLD', 3.5);
    await d.wait(1.5);
    if (CH.stage !== 'choose') await say('You', 'It needs something to deliver it. The 2019 kit at the camp had an injector.', 4);
  }
  async function choose(plan) {
    CH.plan = plan; save.set('plan', plan); CH.stage = 'return'; checkpoint(); refreshObjective();
  }
  async function takeLure() {
    kitCase.userData.lure.visible = false; sfx.debris(kitCase.position, { amount: 0.2 });
    ui.toast('THE LURE · IT WILL SMELL THIS ON YOU', 3.5);
    hunter.hunt = 0.85; save.set('mercy', (save.get('mercy', 0) || 0) + 1);
    await choose('lure');
    sfx.creatureScream(V(0, 2, 50), { dur: 1.6 });
  }
  async function loadInjector() {
    kitCase.userData.pole.visible = false; sfx.metalImpact(kitCase.position, 0.2); sfx.beep('ok');
    ui.toast('LANTERN-0 LOADED · DON\'T USE THE LIGHT ON IT', 4);
    save.set('mercy', (save.get('mercy', 0) || 0) + 1);
    await choose('lantern');
  }
  async function armOvercharge() {
    charging = true; CH.stage = 'charging'; refreshObjective();
    sfx.strobeCharge(3); sfx.setTension(0.6);
    let k = 0, noiseT = 0;
    await d.until(() => {
      const dt = d.t - (armOvercharge.last ?? d.t); armOvercharge.last = d.t;
      const near = Math.hypot(player.pos.x + 10.5, player.pos.z - 5.8) < 2.6;
      if (near) k += dt / 25;
      noiseT -= dt; if (noiseT <= 0) { noiseT = 3; hunter.noise(V(-10.5, 0, 6), 34); sfx.beep(near ? 'click' : 'deny'); }
      charger.userData.leds.forEach((l, i) => { l.material.emissiveIntensity = k * 6 > i ? 3 : 0.15; });
      chargerGlow.intensity = 0.25 + k * 2;
      return k >= 1;
    });
    armOvercharge.last = undefined;
    charging = false; sfx.strobeFlash(); ui.whiteFlash(0.4);
    CH.charged = true; save.set('overcharge', true); save.set('obedience', (save.get('obedience', 0) || 0) + 1);
    ui.toast('OVERCHARGE ARMED · HOLD THE LAMP TRIGGER TO DISCHARGE ALL CELLS', 4.5);
    sfx.setTension(0.3);
    await choose('overcharge');
  }
  async function callCage() {
    sfx.beep('click');
    await say(OKP, 'Rook.', 1.4);
    if (CH.plan === 'overcharge') await say(OKP, 'You armed it. ...Good. That\'s the right thing. I\'ll send the cage down.', 4);
    else if (CH.plan === 'lure') await say(OKP, 'A lure. You want to bring it back up. ...All right. All right. I\'ll send the cage.', 4.6);
    else await say(OKP, 'What did you choose, Rook? ...You don\'t have to tell me. I\'ll send the cage.', 4.4);
    await say(OKP, 'Ninety seconds. The purge is already shedding power down there. Stay alive.', 4);
    CH.stage = 'wait'; cageWait = 90; checkpoint(); refreshObjective();
    // the lights go: the refuge too
    refugeLit = false; refugeLight.intensity = 0; lampRoomLight.intensity = 0.3; sfx.powerDown();
    stationBulbs.forEach((i) => bulbs.set(i, 0.15, { flicker: 3 }));
    sfx.alarm(true, 'klaxon'); sfx.setAmbience('purge', 0.7, 4);
    hunter.hunt = 0.95; hunter.aggression = 1.3;
    if (!B.object.visible) { B.object.visible = true; hunter.script(false); }
    B.object.position.set(0, 0, 40); hunter.lastSeen = V(player.pos.x, player.pos.z); hunter.suspicion = 0.9; hunter.stalk();
    const cage = sfx.loop('cage', V(0, 6, -1.4), 0.7);
    await d.until(() => cageWait <= 0);
    cage.set(0, 0.5); sfx.metalImpact(V(0, 0.3, -1.4), 1.0); setTimeout(() => cage.stop(1), 1500);
    sfx.doorSlide(liftObj.position, { heavy: true });
    cageDoor.disabled = false; cageLight.intensity = 1.4;
    liftObj.userData.setDoors?.(0);
    const T0 = d.t; await d.until(() => { const k = Math.min(1, (d.t - T0) / 2.2); liftObj.userData.setDoors?.(k); return k >= 1; });
    cageDoor.disabled = true; CH.cage = true; refreshObjective();
  }
  async function leave() {
    CH.done = true; refreshObjective();
    player.frozen = true; player.place(0, -1.4, 0, 0); player.lookAt(V(0, 1.5, 4), 2);
    sfx.alarm(false);
    sfx.doorSlide(liftObj.position, { heavy: true });
    // it is coming across the station floor as the doors close
    hunter.script(true); B.object.visible = true; B.object.position.set(0.5, 0, 8); B.anim.play('follow', { path: [{ x: 0.2, z: 1.2 }], mode: 'run', speed: 3.6, gaze: 'player' });
    const T0 = d.t; await d.until(() => { const k = Math.min(1, (d.t - T0) / 1.6); liftObj.userData.setDoors?.(1 - k); return k >= 1; });
    cageDoor.disabled = false;
    sfx.doorBang?.(V(0, 1.4, 0), 1.4); player.shake = 1.2; B.object.visible = false;
    sfx.creatureScream(V(0, 1.6, 0.6), { dur: 1.4 });
    const cage = sfx.loop('cage', V(0, 2.8, -1.4), 0.9);
    const shake = d.every(() => { player.shake = Math.max(player.shake, 0.15); });
    await d.wait(5);
    // a weight lands on the roof of the car
    sfx.metalImpact(V(0, 2.9, -1.4), 1.5); player.shake = 1.5; cageLight.intensity = 0.2;
    await d.wait(0.6); cageLight.intensity = 1.0;
    await d.wait(1.4);
    sfx.creatureDrag(V(0.4, 2.9, -1.2), { dur: 1.5 });
    await d.wait(2);
    sfx.knock(V(0, 2.9, -1.4), { n: 3, gap: 0.8, hard: 0.9 });
    await d.wait(3);
    if (save.get('halloran') === 'saved') await say(HALR, 'Doctor? ...Doctor, it\'s Halloran. You\'re on the hoist? There\'s something on the roof of your car.', 4.6);
    await ui.fadeTo(1, 2);
    shake(); cage.stop(1);
    save.set('chapter', 5); save.set('ch4', null);
    save.set('exposure', Math.round(expo.value)); save.set('mask', CH.mask); save.set('filters', resp.filters); save.set('filter', resp.filter);
    save.set('truth', (save.get('truth', 0) || 0) + CH.docs.length + CH.tapes.length);
    save.set('trail', CH.tapes.length);
    const { chapter5 } = await import('./chapter5.js');
    await game.load(chapter5, {});
    game.ui.fadeTo(0, 1.2);
  }

  // ---------------------------------------------------------------- caught: the first time it only holds you
  async function caught() {
    if (CH.dead) return;
    if (CH.grabs >= 1 || CH.stage === 'wait' || expo.value > 70) return die();
    CH.grabs++;
    hunter.script(true);
    player.frozen = true; ui.red(true); player.shake = 1.6; sfx.stinger('hit');
    if (hide.current) hide.leave();
    const cam = game.camera.position, f = player.forward(V(0, 0, 0)); f.y = 0; f.normalize();
    B.object.position.set(cam.x + f.x * 0.75, 0, cam.z + f.z * 0.75); B.anim.heading = Math.atan2(-f.x, -f.z);
    B.anim.play('idle', { stare: true });
    player.lookAt(B.bone.head.getWorldPosition(V(0, 0, 0)), 6);
    game.flashlight.on = true;
    await d.wait(0.5); ui.red(false);
    sfx.creatureBreath(B.bone.head.getWorldPosition(V(0, 0, 0)), { intensity: 0.9 });
    await d.wait(2.2);
    sfx.whisper(B.bone.head.getWorldPosition(V(0, 0, 0)), { dur: 1.8, level: 0.9 });
    expo.add(30); ui.toast('EXPOSURE', 2);
    await d.wait(2.2);
    player.releaseLook(); player.frozen = false;
    hunter.script(false); hunter.retreatFrom(cam, 10);
    ui.toast('IT LET YOU GO', 2.5);
    checkpoint();
  }
  async function die(reason) {
    if (CH.dead) return; CH.dead = true;
    sfx.creatureScream(game.camera.position, { dur: 1.2 }); sfx.stinger('hit');
    ui.red(true); ui.setFade(1); player.frozen = true;
    await new Promise((r) => setTimeout(r, 900));
    ui.red(false); if (hide.current) ui.hiding(false);
    sfx.alarm(false);
    await ui.death(reason === 'gas' ? 'THE PURGE' : 'YOU WERE TAKEN', reason === 'gas' ? 'The gas reached you. Choose sooner.' : CH.grabs ? 'It let you go once. It will not do it twice.' : 'It hears more than you think.', game.input);
    const st = save.get('ch4') || {};
    if (st.purge) st.purgeLeft = Math.max(st.purgeLeft || 0, 6 * 60);
    if (st.stage === 'wait') st.stage = 'return';
    game.load(chapter4, { state: { ...st, dead: false }, restart: true });
  }

  // ---------------------------------------------------------------- restore and start
  if (CH.lights) { subPanel.userData.setOn?.(true); for (const [k, i] of driftBulbs.entries()) if (k % 2 === 0) bulbs.set(i, 0.55); }
  if (CH.bulkhead) { bulkBox.disabled = true; bulk.userData.setOpen?.(0.9); wheel.rotation.x = 9; rebuildGrid(); }
  if (CH.vial || CH.plan === 'lantern') vialObj.visible = false;
  if (CH.plan === 'lure') kitCase.userData.lure.visible = false;
  if (CH.plan === 'lantern') kitCase.userData.pole.visible = false;
  if (CH.charged) charger.userData.leds.forEach((l) => { l.material.emissiveIntensity = 3; });
  if (CH.sleeperGone) sleepers[1].visible = false;
  window.__ch4 = { CH, hunter, B, player, interact, grid, hide, expo, resp, bulbs, sleepers, SPOTS, rebuildGrid, use: (re) => { const it = interact.items.find((i) => i.enabled() && re.test(typeof i.label === 'function' ? i.label() : i.label)); if (it) it.onUse(it); return !!it; } };

  async function opening() {
    if (opts.restart || CH.stage !== 'descent') {
      ui.setFade(1);
      player.place(0, 4, 0, 0);
      if (['nest', 'hide'].includes(CH.stage)) { player.place(12, 77, R.E, 0); CH.stage = 'nest'; }
      if (['choose', 'charging', 'return'].includes(CH.stage) && CH.stage === 'charging') CH.stage = 'choose';
      liftObj.userData.setDoors?.(1); cageDoor.disabled = true; cageLight.intensity = 0.8;
      sfx.setAmbience('mine', 0.9, 2); sfx.setReverb('large');
      ui.fadeTo(0, 1.5);
      refreshObjective();
      if (CH.phone) echo.on = !CH.lights;
      if (CH.stage === 'station' && !CH.phone) { ringing = true; game.run(async () => { while (ringing) { sfx.phoneRing(phone.position); await d.wait(4); } }); }
      if (CH.lights && !['nest', 'hide'].includes(CH.stage)) { B.object.visible = true; hunter.script(false); hunter.set('idle'); }
      if (CH.purge) { B.object.visible = true; hunter.script(false); hunter.set('idle'); hunter.hunt = CH.plan === 'lure' ? 0.85 : 0.55; }
      if (CH.stage === 'nest' && CH.tapes.includes('tape2') && !CH.visited) game.run(nestReturn);
      return;
    }
    await descent();
  }
  const cp = opts.checkpoint || game.params.get('cp');
  if (cp && cp !== 'still' && !opts.restart && !opts.state) {
    // debug entry points
    Object.assign(CH, { stage: 'station', phone: true, mask: true });
    if (['drift', 'nest', 'choose', 'return'].includes(cp)) Object.assign(CH, { stage: 'drift', lights: true });
    if (['nest', 'choose', 'return'].includes(cp)) Object.assign(CH, { stage: 'nest', tapes: ['tape1'] });
    if (['choose', 'return'].includes(cp)) Object.assign(CH, { stage: 'choose', tapes: ['tape1', 'tape2', 'tape3'], visited: true, hid: true, bulkhead: true, purge: true });
    if (cp === 'return') Object.assign(CH, { stage: 'return', plan: 'overcharge', charged: true });
    if (CH.mask) maskObj.visible = false;
    opts.restart = true;
  }
  if (game.params.get('cp') === 'still') { ui.setFade(0); applyDebugCamera(game); if (game.params.has('lights')) driftBulbs.forEach((i) => bulbs.set(i, 1)); }
  else game.run(async () => { await opening(); });

  // ---------------------------------------------------------------- frame
  let t0 = 0;
  return {
    look: 'horror', ownFade: true,
    update(dt, t) {
      const ctx = creatureCtx(game);
      if (B.object.visible) { B.update(dt, ctx); if (hunter.enabled) hunter.update(dt); player.shake = Math.max(player.shake, B.anim.shake); }
      lamp.update(dt); bulbs.update(dt); echo.update(game.time); gas.update(dt, t);
      for (const s of sleepers) s.userData.update?.(t);
      const px = player.pos.x, pz = player.pos.z;
      // the airway
      if (LOW.some((r) => inRect(r, px, pz, 0.1)) && !player.frozen) { if (!player.crouch) { player.crouch = true; if (!lowWarned) { lowWarned = true; ui.toast('TOO LOW TO STAND', 2); } } }
      // respirator and air
      if (game.input.wasPressed('KeyM') && CH.mask && !hide.current) { CH.maskOn = !CH.maskOn; resp.wear(CH.maskOn); }
      const inNest = NEST.some((r) => inRect(r, px, pz));
      const gassed = gas.level > 0.6;
      const protectedAir = resp.update(dt, inNest || gassed, game.fear);
      if (inNest && !protectedAir) { expo.add(dt * 0.35); if (!airWarned) { airWarned = true; ui.toast(CH.mask ? 'THE AIR IS THICK HERE · M: RESPIRATOR' : 'THE AIR IS THICK HERE · YOUR HEAD ACHES', 4); } }
      if (gassed && !protectedAir) { expo.add(dt * 2.5); player.shake = Math.max(player.shake, 0.2); if (expo.value >= 100) die('gas'); }
      expo.update(dt);
      // the purge clock
      if (CH.purge && !CH.done && !CH.dead) {
        CH.purgeLeft -= dt;
        if (CH.purgeLeft < 60) gas.setLevel(Math.min(1.6, (60 - CH.purgeLeft) / 30));
        if (CH.purgeLeft <= 0) die('gas');
      }
      if (CH.stage === 'wait' && cageWait > 0) cageWait -= dt;
      if (['station', 'drift', 'airway'].includes(CH.stage) && CH.phone && inRect(ROOMS.chamber, px, pz)) { CH.stage = 'nest'; refreshObjective(); checkpoint(); sfx.setTension(0.25); ui.toast('CHAMBER 5', 2.5); }
      if (CH.stage === 'nest' && !CH.visited && inRect(ROOMS.chamber, px, pz) && !tapePlaying) { nestT += dt; if (nestT > 80) game.run(nestReturn); }
      objT -= dt; if (objT <= 0) { objT = 0.5; refreshObjective(); }
      // the sleeper sits up as you pass, and its head follows you
      if (CH.purge && !CH.sat && Math.hypot(px - 22.6, pz - 73) < 5) { CH.sat = true; sfx.creatureCrack(V(22.6, 0.3, 73.05)); sfx.whisper(V(22.6, 0.6, 73), { dur: 2, level: 0.4 }); }
      const s1 = sleepers[1];
      if (CH.sat && s1.visible) {
        s1.userData.sitK = Math.min(1, (s1.userData.sitK || 0) + dt * 0.25); s1.userData.sit(s1.userData.sitK);
        const hp = s1.userData.parts.headPivot.getWorldPosition(V(0, 0, 0));
        const yaw = Math.atan2(-(pz - hp.z), px - hp.x);
        s1.userData.headYaw = (s1.userData.headYaw || 0) + (Math.max(-1.2, Math.min(1.2, yaw)) - (s1.userData.headYaw || 0)) * (1 - Math.exp(-dt * 1.2));
        s1.userData.head(s1.userData.headYaw * 0.8, 0);
        if (!CH.sleeperGone && Math.hypot(px - 22.6, pz - 73) > 14) { CH.sleeperGone = true; s1.visible = false; }
      }
      // footsteps of something keeping pace, and the camp light that dies when it gets close
      if (campLit && B.object.visible && Math.hypot(B.object.position.x + 20.3, B.object.position.z - 42.6) < 6 && hunter.state === 'chase') { campLit = false; campLamp.intensity = 0; campLight.userData.setOn?.(false); sfx.glassShatter(V(-20.3, 1.9, 42.6)); rebuildGrid(); }
      const dd = B.object.visible ? B.anim.distToPlayer() : 99;
      game.fear = hunter.enabled && hunter.state !== 'scripted' ? Math.max(0, 1 - dd / 9) * (hunter.state === 'chase' ? 1 : 0.6) : Math.max(0, 1 - dd / 12) * 0.5;
      sfx.heartbeat(hunter.enabled && hunter.state !== 'scripted' && dd < 6 && B.object.visible ? 70 + (6 - dd) * 12 : 0);
      t0 += dt;
    },
    dispose() { sfx.setTension(0); sfx.heartbeat(0); sfx.alarm(false); expo.dispose(); resp.dispose(); },
  };
}
