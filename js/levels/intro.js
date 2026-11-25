// PROLOGUE: INTAKE
// Badge in, decontaminate, read the overnight notes, observe C-14A and C-14B, run the response
// battery, fetch the sealant kit, survive the breach, drive A back into its cell, and follow B
// to the Wing D door.
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { Creature } from '../creature.js';
import { buildLab, LAB } from '../lab/architecture.js';
import { loadEnvironment } from '../engine/assets.js';
import { loadCreatureModel, creatureBlockers, creatureCtx, applyDebugCamera } from './common.js';
import { sfx } from '../engine/game.js';
import { save } from '../save.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);

// ------------------------------------------------------------------ props (with plain fallbacks)
let P = {};
async function loadProps() { try { P = await import('../lab/props.js'); } catch (e) { console.warn('lab props unavailable, using placeholders', e); P = {}; } }
const fbMat = new THREE.MeshStandardMaterial({ color: 0xdfe4e4, roughness: 0.5 });
function fallback(w, h, d) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), fbMat); m.position.y = h / 2; m.castShadow = m.receiveShadow = true;
  g.add(m); g.userData.collider = { w, d }; return g;
}
function make(name, opts, fb) {
  try {
    if (typeof P[name] === 'function') return (name === 'sign' || name === 'floorDecal') ? P[name](opts.text, opts) : P[name](opts);
  } catch (e) { console.warn('prop', name, e); }
  return fb ? fallback(...fb) : new THREE.Group();
}

// ------------------------------------------------------------------ dialogue
const OK = 'Dr. Okafor', PA = 'PA';
const DOSSIER = {
  ref: 'C-14 / OVERNIGHT / 06:11', title: 'C-14A and C-14B: overnight observation summary',
  body: `
<p><b>Both specimens stable.</b> C-14A held its standing posture facing the north wall of Cell A for 9 h 40 min, unchanged from the previous 211 nights.</p>
<p>C-14B paced the glass between 02:10 and 04:55, then crouched in the north-east corner of Cell B. B repeatedly touched the glass at roughly the height of a standing adult's face. Each contact lasted three to four seconds. The pattern resembles reading.</p>
<p><b>Photosensitivity.</b> Both specimens retreat from sustained light above 1,500 lux. The strobe remains the most reliable deterrent (Halide Protocol 4). A handheld halide lamp is kept charged in Storage at all times.</p>
<p><b>Today's battery</b>, run from the observation console: LIGHT, TONE (18 kHz), STROBE. Do not run STROBE twice in one session.</p>
<p><b>Reminders.</b> Do not address B by name. Do not speak near the intercom while B is at the glass. B intake details: <span class="redact">████████████ eight months ago, see LANTERN annex</span> (restricted).</p>`,
};

export async function intro(game, opts = {}) {
  const { scene, player, ui, director: d, interact, renderer } = game;
  const say = (who, text, dur) => ui.say(who, text, dur);
  RectAreaLightUniformsLib.init();
  renderer.toneMappingExposure = 1.0;
  scene.background = new THREE.Color(0x0b0d0e);
  game.surface = 'tile';

  const [env] = await Promise.all([loadEnvironment(renderer).catch(() => null), loadProps()]);
  if (env) { scene.environment = env; scene.environmentIntensity = 0.3; }

  // ---------------------------------------------------------------- building
  const lab = buildLab(scene);
  const colliders = [...lab.colliders];
  const propColliders = [];
  function place(obj, x, z, rot = 0, y = 0) {
    obj.position.set(x, y, z); obj.rotation.y = rot; scene.add(obj);
    const c = obj.userData?.collider;
    if (c && y === 0) {
      const sw = Math.abs(Math.sin(rot)) > 0.5;
      const w = sw ? c.d : c.w, dd = sw ? c.w : c.d;
      const box = { minX: x - w / 2, maxX: x + w / 2, minZ: z - dd / 2, maxZ: z + dd / 2 };
      colliders.push(box); propColliders.push(box);
    }
    return obj;
  }
  const wallObj = (obj, x, y, z, rot) => { obj.position.set(x, y, z); obj.rotation.y = rot; scene.add(obj); return obj; };
  const R = { S: Math.PI, E: -Math.PI / 2, W: Math.PI / 2, N: 0 }; // facing direction of the prop's front

  // doors
  class Door {
    constructor(spec, type, opts2 = {}) {
      this.spec = spec; this.type = type; this.open01 = 0; this.target = 0; this.locked = !!opts2.locked;
      const g = make('door', { w: spec.w, h: 2.25, type }, null);
      if (!g.userData.leaf) { // fallback: a plain sliding slab
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(spec.w, 2.25, 0.06), new THREE.MeshStandardMaterial({ color: type === 'heavy' ? 0x8a9396 : 0xd9dfdf, metalness: type === 'heavy' ? 0.6 : 0.1, roughness: 0.4 }));
        leaf.position.y = 1.125; leaf.castShadow = true; g.add(leaf); g.userData.leaf = leaf;
      }
      g.position.set(spec.x, 0, spec.z); g.rotation.y = spec.axis === 'z' ? Math.PI / 2 : 0;
      scene.add(g);
      this.group = g; this.leaf = g.userData.leaf; this.home = this.leaf.position.clone();
      const h = spec.w / 2;
      this.collider = spec.axis === 'z' ? { minX: spec.x - 0.12, maxX: spec.x + 0.12, minZ: spec.z - h, maxZ: spec.z + h } : { minX: spec.x - h, maxX: spec.x + h, minZ: spec.z - 0.12, maxZ: spec.z + 0.12 };
      colliders.push(this.collider);
      this.pos = V(spec.x, 1.2, spec.z);
    }
    open() { if (this.target !== 1) { this.target = 1; sfx.doorSlide(this.pos, { heavy: this.type === 'heavy' }); } }
    close() { if (this.target !== 0) { this.target = 0; sfx.doorSlide(this.pos, { heavy: this.type === 'heavy' }); } }
    update(dt) {
      if (this.broken) return;
      const sp = this.type === 'heavy' ? 0.45 : 1.1;
      this.open01 += clamp(this.target - this.open01, -sp * dt, sp * dt);
      if (this.type === 'heavy') this.leaf.position.y = this.home.y + 2.3 * this.open01;
      else this.leaf.position.x = this.home.x + (this.spec.w + 0.05) * this.open01;
      this.collider.disabled = this.open01 > 0.8;
    }
  }
  const doors = {
    outer: new Door(LAB.doors.outer, 'slide'), inner: new Door(LAB.doors.inner, 'slide'),
    storage: new Door(LAB.doors.storage, 'slide'), wingD: new Door(LAB.doors.wingD, 'heavy'),
    cellA: new Door(LAB.doors.cellA, 'heavy'), cellB: new Door(LAB.doors.cellB, 'heavy'),
  };

  // ---------------------------------------------------------------- furnishing
  const L = LAB.lab;
  const consoleObj = place(make('controlConsole', {}, [2.6, 1.0, 1.0]), 0, -3.4, R.N);
  const ws1 = place(make('workstation', { monitors: 2, seed: 1 }, [1.6, 0.76, 0.8]), -6.45, 2.6, R.W);
  place(make('workstation', { monitors: 1, seed: 2 }, [1.6, 0.76, 0.8]), -6.45, 0.4, R.W);
  place(make('officeChair', {}, [0.6, 1.0, 0.6]), -5.6, 2.5, -Math.PI / 2 + 0.3);
  place(make('officeChair', {}, [0.6, 1.0, 0.6]), -5.7, 0.2, -Math.PI / 2 - 0.4);
  place(make('officeChair', {}, [0.6, 1.0, 0.6]), 0.7, -2.4, Math.PI + 0.2);
  place(make('labBench', { length: 3 }, [3, 0.92, 0.9]), 1.8, 2.0, R.N);
  place(make('stool', {}, [0.4, 0.7, 0.4]), 1.0, 2.9, 0); place(make('stool', {}, [0.4, 0.7, 0.4]), 2.5, 3.0, 0);
  place(make('fumeHood', {}, [1.5, 2.3, 0.9]), -4.6, 5.5, R.S);
  place(make('specimenShelf', {}, [1.2, 1.9, 0.45]), -2.4, 5.7, R.S);
  place(make('surgicalTable', {}, [2.0, 0.9, 0.8]), 4.4, -0.6, R.N);
  const sl = make('surgicalLight', { length: 1.1 }, null); sl.position.set(4.4, LAB.H, -0.6); scene.add(sl);
  place(make('instrumentTray', {}, [0.7, 0.9, 0.45]), 5.6, 0.4, R.W);
  place(make('lockerBank', { count: 4, ajar: 2 }, [2.0, 2.0, 0.5]), 6.68, -3.7, R.E);
  place(make('serverRack', {}, [0.6, 2.0, 1.0]), 6.5, 4.8, R.E);
  place(make('gurney', {}, [2.0, 0.9, 0.7]), 4.6, 3.6, R.N + 0.15);
  place(make('cart', {}, [0.9, 0.9, 0.5]), -3.2, -4.6, 0.2);
  place(make('biohazardBin', {}, [0.4, 0.7, 0.4]), 6.6, 2.3, R.E);
  place(make('gasCylinders', {}, [0.9, 1.5, 0.35]), -6.7, 4.8, R.W);
  place(make('analyzer', {}, null), 0.4, 2.05, 0, 0.92);
  place(make('centrifuge', {}, null), 3.0, 2.05, 0, 0.92);
  place(make('microscope', {}, null), 2.1, 1.85, 0, 0.92);
  // wall items
  wallObj(make('eyewashStation', {}, null), 6.92, 1.0, 3.4, R.E);
  wallObj(make('fireExtinguisher', {}, null), -6.92, 0.5, -1.4, R.W);
  wallObj(make('wallPhone', {}, null), -6.92, 1.45, 1.5, R.W);
  wallObj(make('firstAidBox', {}, null), 6.92, 1.5, -1.6, R.E);
  wallObj(make('glovesDispenser', {}, null), -6.92, 1.3, 3.6, R.W);
  wallObj(make('hazmatRack', {}, null), -1.8, 0.0, 5.92, R.S);
  wallObj(make('wallCabinet', {}, null), 3.6, 1.6, 5.92, R.S);
  wallObj(make('securityCamera', {}, null), 6.85, 2.95, 5.8, R.E - 0.6);
  wallObj(make('securityCamera', {}, null), -6.85, 2.95, -5.6, R.W - 0.6);
  wallObj(make('sign', { text: 'C-14 OBSERVATION', w: 1.4, h: 0.3, style: 'room', sub: 'WING C · LAB 3' }, null), 0, 2.45, L.z0 + 0.16, 0);
  wallObj(make('sign', { text: 'CELL A', w: 0.7, h: 0.25, style: 'room', sub: 'C-14A' }, null), -1.45, 2.45, L.z0 + 0.32, 0);
  wallObj(make('sign', { text: 'CELL B', w: 0.7, h: 0.25, style: 'room', sub: 'C-14B' }, null), 1.45, 2.45, L.z0 + 0.32, 0);
  wallObj(make('sign', { text: 'BIOHAZARD', w: 0.5, h: 0.6, style: 'biohazard', sub: 'CONTAINMENT LEVEL 4' }, null), -0.4, 1.6, L.z0 + 0.16, 0);
  wallObj(make('sign', { text: 'WING D · CONSTRUCTION', w: 1.1, h: 0.35, style: 'warning', sub: 'NO ACCESS' }, null), -6.92, 2.5, -4.0, R.W);
  wallObj(make('sign', { text: 'STORAGE', w: 0.7, h: 0.25, style: 'room', sub: 'C-STR-02' }, null), 6.92, 2.45, 1.0, R.E);
  wallObj(make('sign', { text: 'DECONTAMINATION', w: 1.0, h: 0.25, style: 'info', sub: 'WAIT FOR GREEN' }, null), 0, 2.45, L.z1 - 0.1, R.S);
  for (const sgn of [-1, 1]) {
    const dec = make('floorDecal', { text: 'KEEP CLEAR', w: 1.6, h: 0.9, style: 'hazard' }, null);
    dec.position.set(sgn * 1.45, 0.004, -5.25); scene.add(dec);
  }
  // entrance corridor
  const badge = wallObj(make('badgeReader', {}, [0.12, 0.18, 0.04]), 0.95, 1.25, LAB.doors.outer.z + 0.09, 0);
  wallObj(make('sign', { text: 'WING C', w: 0.9, h: 0.3, style: 'room', sub: 'AUTHORISED PERSONNEL ONLY' }, null), 0, 2.4, LAB.doors.outer.z + 0.09, 0);
  wallObj(make('sign', { text: 'BIOHAZARD', w: 0.45, h: 0.55, style: 'biohazard', sub: 'RESTRICTED' }, null), -1.0, 1.55, LAB.doors.outer.z + 0.09, 0);
  wallObj(make('fireExtinguisher', {}, null), -1.52, 0.5, 13.5, R.W);
  // ceiling: cable trays, vents
  for (const z of [-1.5, 3.5]) { const ct = make('cableTray', { length: 13 }, null); ct.position.set(0, LAB.H - 0.18, z); scene.add(ct); }
  for (const [x, z] of [[-3, 0], [3, 3], [0, 4.5]]) { const v = make('ventGrille', { w: 0.6, h: 0.6 }, null); v.position.set(x, LAB.H - 0.005, z); v.rotation.x = Math.PI / 2; scene.add(v); }

  // storage
  // (storage room bounds: LAB.storage)
  place(make('lockerBank', { count: 2 }, [1.0, 2.0, 0.5]), 10.3, 2.6, R.E);
  place(make('cart', {}, [0.9, 0.9, 0.5]), 8.0, 3.1, R.S);
  const shelfS = place(make('specimenShelf', {}, [1.2, 1.9, 0.45]), 9.6, -1.35, R.N);
  const cctvDesk = place(fallback(1.2, 0.76, 0.6), 10.25, 0.4, R.E);
  const lampRack = wallObj(make('wallCabinet', {}, [0.6, 0.4, 0.25]), 7.6, 1.2, -1.5, R.N);

  // sealant kit (a small white case) and the halide lamp on its charging rack
  const kit = new THREE.Group();
  const kitBox = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.3), new THREE.MeshStandardMaterial({ color: 0xe9ecec, roughness: 0.4 }));
  const kitStripe = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.03, 0.31), new THREE.MeshStandardMaterial({ color: 0x1f8a8a, roughness: 0.4 }));
  kit.add(kitBox, kitStripe); kitBox.castShadow = true;
  kit.position.set(9.5, 0.98, -1.3); scene.add(kit);
  const lampModel = make('halideLamp', {}, null);
  if (!lampModel.children.length) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.3, 16).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a2e30, metalness: 0.5, roughness: 0.4 })); lampModel.add(m); }
  const lampOnRack = lampModel.clone(true);
  lampOnRack.position.set(7.6, 1.55, -1.32); lampOnRack.rotation.y = Math.PI / 2; scene.add(lampOnRack);

  // wing D beyond the door: unfinished, sheeting, red light
  const D = LAB.wingD;
  const sheetMat = new THREE.MeshStandardMaterial({ color: 0xd8dccc, roughness: 0.6, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  for (const x of [-9.5, -12.5]) { const sh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.9, 12, 12), sheetMat); sh.position.set(x, 1.45, -4); sh.rotation.y = Math.PI / 2; const p = sh.geometry.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getY(i) * 3 + p.getX(i) * 2) * 0.05); sh.geometry.computeVertexNormals(); scene.add(sh); }
  const redD = new THREE.PointLight(0xff2010, 0, 9, 2); redD.position.set(-13.5, 2.4, -4); scene.add(redD);
  for (let i = 0; i < 6; i++) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.9, 0.04), new THREE.MeshStandardMaterial({ color: 0x8a8f92, metalness: 0.7, roughness: 0.5 })); st.position.set(-8 - i * 1.1, 1.45, -5.1); scene.add(st); }

  // ---------------------------------------------------------------- lighting
  const rects = [];
  const addRect = (x, y, z, w, h, I = 9, color = 0xf3f7ff) => { const r = new THREE.RectAreaLight(color, I, w, h); r.position.set(x, y, z); r.lookAt(x, 0, z); r.userData.base = I; scene.add(r); rects.push(r); return r; };
  for (const x of [-3.5, 3.5]) for (const z of [-3, 3]) addRect(x, LAB.H - 0.02, z, 5, 4.2, 1.5);
  addRect(0, 2.68, 12.5, 2.2, 5, 1.6); addRect(0, 2.58, 7.5, 2.2, 2.2, 1.8); addRect(8.8, 2.78, 1.0, 2.8, 3.6, 1.4);
  const cellSpots = {};
  for (const [k, c] of [['A', LAB.cellA], ['B', LAB.cellB]]) {
    const sp = new THREE.SpotLight(0xf6fbff, 9, 0, 1.05, 0.6, 2);
    sp.position.set((c.x0 + c.x1) / 2, LAB.H - 0.1, (c.z0 + c.z1) / 2 + 0.5); sp.target.position.set((c.x0 + c.x1) / 2, 0, (c.z0 + c.z1) / 2);
    sp.castShadow = true; sp.shadow.mapSize.set(1024, 1024); sp.shadow.bias = -0.0005; sp.shadow.normalBias = 0.02;
    sp.userData.base = 9; scene.add(sp, sp.target); cellSpots[k] = sp;
    addRect((c.x0 + c.x1) / 2, LAB.H - 0.02, (c.z0 + c.z1) / 2, 4, 3, 1.3);
  }
  const keySpot = new THREE.SpotLight(0xf3f7ff, 7, 0, 1.2, 0.8, 2);
  keySpot.position.set(0.5, LAB.H - 0.1, 0.5); keySpot.target.position.set(0, 0, -1);
  keySpot.castShadow = true; keySpot.shadow.mapSize.set(2048, 2048); keySpot.shadow.bias = -0.0004; keySpot.shadow.normalBias = 0.02; keySpot.userData.base = 7;
  scene.add(keySpot, keySpot.target);
  // troffers
  const troffers = [];
  const addTroffer = (x, z, y = LAB.H, w = 1.2, dd = 0.6) => {
    let t = make('ceilingLightPanel', { w, d: dd }, null);
    if (!t.userData.setLevel) {
      t = new THREE.Mesh(new THREE.PlaneGeometry(w, dd), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xf4f8ff, emissiveIntensity: 2.2 }));
      t.rotation.x = Math.PI / 2; t.userData.setLevel = (v) => { t.material.emissiveIntensity = 2.2 * v; };
    }
    t.position.set(x, y - 0.002, z); scene.add(t); troffers.push(t);
  };
  for (const x of [-4.8, -1.6, 1.6, 4.8]) for (const z of [-4.2, -1.2, 1.8, 4.6]) addTroffer(x, z);
  for (const z of [10.5, 12.5, 14.5]) addTroffer(0, z, 2.7);
  addTroffer(8.8, 1.0, 2.8); addTroffer(0, 7.5, 2.6, 1.2, 0.6);
  for (const c of [LAB.cellA, LAB.cellB]) for (const dx of [-1.4, 1.4]) addTroffer((c.x0 + c.x1) / 2 + dx, (c.z0 + c.z1) / 2, LAB.H, 0.6, 1.2);
  // emergency lighting (off until the power fails)
  const beacons = [];
  for (const [x, y, z, rot] of [[0, 2.85, L.z1 - 0.12, R.S], [6.88, 2.6, -1.5, R.E], [-6.88, 2.6, 1.0, R.W]]) {
    const bcn = wallObj(make('emergencyBeacon', {}, null), x, y, z, rot);
    const sp = new THREE.SpotLight(0xff1a0a, 0, 14, 0.5, 0.6, 1.5); sp.position.set(x, y - 0.1, z);
    scene.add(sp, sp.target); beacons.push({ obj: bcn, light: sp, base: { x, y, z } });
  }
  const redFill = new THREE.PointLight(0xff2a14, 0, 18, 1.6); redFill.position.set(0, 2.6, 0); scene.add(redFill);
  const storageEmergency = new THREE.SpotLight(0xffe2b8, 0, 9, 0.9, 0.7, 1.8);
  storageEmergency.position.set(10.4, 2.5, 3.3); storageEmergency.target.position.set(8.5, 0, 0); storageEmergency.castShadow = true; storageEmergency.shadow.mapSize.set(1024, 1024);
  scene.add(storageEmergency, storageEmergency.target);

  let power = true;
  function setPower(on) {
    power = on;
    for (const r of rects) r.intensity = on ? r.userData.base : 0;
    for (const s of [keySpot, cellSpots.A, cellSpots.B]) s.intensity = on ? s.userData.base : 0;
    for (const t of troffers) t.userData.setLevel?.(on ? 1 : 0);
    scene.environmentIntensity = on ? 0.3 : 0.02;
    lab.M.ceiling.emissiveIntensity = on ? 0.22 : 0;
    for (const b of beacons) { b.obj.userData.setOn?.(!on); b.light.intensity = on ? 0 : 22; }
    redFill.intensity = on ? 0 : 0.9;
    storageEmergency.intensity = on ? 0 : 6;
    redD.intensity = on ? 0 : 3;
  }
  setPower(true);

  // ---------------------------------------------------------------- CCTV monitor (storage)
  const cctvRT = new THREE.WebGLRenderTarget(512, 320, { colorSpace: THREE.SRGBColorSpace });
  const cctvCam = new THREE.PerspectiveCamera(70, 512 / 320, 0.1, 40);
  cctvCam.position.set(-6.6, 2.95, -0.2); cctvCam.lookAt(-2.0, 0.6, -5.0);
  const cctvMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: cctvRT.texture }, uTime: { value: 0 }, uOn: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D map; uniform float uTime, uOn; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){
        vec2 uv = vUv; uv.x += sin(uv.y * 300.0 + uTime * 40.0) * 0.0008;
        vec3 c = texture2D(map, uv).rgb; float l = dot(c, vec3(0.3,0.59,0.11));
        l = pow(l, 0.75) * 1.5 + (h(uv * 400.0 + uTime) - 0.5) * 0.12;
        l *= 0.85 + 0.15 * sin(uv.y * 640.0); l *= smoothstep(0.75, 0.2, length(vUv - 0.5));
        vec3 col = vec3(0.55, 1.0, 0.7) * l;
        float rec = step(0.5, fract(uTime * 0.8)) * step(length(vUv - vec2(0.08, 0.9)), 0.015);
        col = mix(col, vec3(1.0, 0.1, 0.1), rec);
        gl_FragColor = vec4(col * uOn, 1.0);
      }`,
  });
  const monitor = new THREE.Group();
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.44, 0.06), new THREE.MeshStandardMaterial({ color: 0x1b1e20, roughness: 0.5 }));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.375), cctvMat); screen.position.z = 0.031;
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), bezel.material); stand.position.y = -0.33;
  monitor.add(bezel, screen, stand); monitor.position.set(10.25, 0.76 + 0.48, 0.4); monitor.rotation.y = -Math.PI / 2;
  scene.add(monitor);
  let cctvFrame = 0;
  function renderCCTV() {
    if (cctvMat.uniforms.uOn.value <= 0 || game.skipRender) return;
    if (cctvFrame++ % 3) return;
    const vis = monitor.visible; monitor.visible = false;
    renderer.setRenderTarget(cctvRT); renderer.render(scene, cctvCam); renderer.setRenderTarget(null);
    monitor.visible = vis;
  }

  // ---------------------------------------------------------------- decon mist
  const mistN = 900, mistPos = new Float32Array(mistN * 3), mistSeed = new Float32Array(mistN);
  for (let i = 0; i < mistN; i++) { mistPos[i * 3] = (Math.random() - 0.5) * 2.6; mistPos[i * 3 + 1] = Math.random() * 2.5; mistPos[i * 3 + 2] = 6.1 + Math.random() * 2.8; mistSeed[i] = Math.random(); }
  const mistGeo = new THREE.BufferGeometry(); mistGeo.setAttribute('position', new THREE.BufferAttribute(mistPos, 3)); mistGeo.setAttribute('seed', new THREE.BufferAttribute(mistSeed, 1));
  const mistMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uT: { value: 0 }, uA: { value: 0 } },
    vertexShader: `attribute float seed; uniform float uT; varying float vS;
      void main(){ vec3 p = position; p.y = mod(p.y - uT * (0.6 + seed), 2.5); p.x += sin(uT * 2.0 + seed * 30.0) * 0.12; vS = seed;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = (30.0 + seed * 60.0) / -mv.z; }`,
    fragmentShader: `uniform float uA; varying float vS; void main(){ float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)); gl_FragColor = vec4(vec3(0.85, 0.92, 1.0) * a * uA * 0.12, 1.0); }`,
  });
  const mist = new THREE.Points(mistGeo, mistMat); mist.frustumCulled = false; scene.add(mist);

  // ---------------------------------------------------------------- glass crack overlay (cell B)
  const crackCanvas = document.createElement('canvas'); crackCanvas.width = crackCanvas.height = 1024;
  const crackTex = new THREE.CanvasTexture(crackCanvas); crackTex.colorSpace = THREE.SRGBColorSpace;
  const crackMat = new THREE.MeshBasicMaterial({ map: crackTex, transparent: true, depthWrite: false, opacity: 0 });
  const crack = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), crackMat);
  crack.position.set(4.1, 1.55, L.z0 + 0.03); crack.renderOrder = 3; scene.add(crack);
  function drawCrack() {
    const g = crackCanvas.getContext('2d'); g.clearRect(0, 0, 1024, 1024);
    g.strokeStyle = 'rgba(235,245,250,0.85)'; g.lineCap = 'round';
    const cx = 512, cy = 480;
    for (let i = 0; i < 22; i++) { // radial cracks
      let x = cx, y = cy, a = (i / 22) * Math.PI * 2 + Math.random() * 0.2, len = 160 + Math.random() * 330;
      g.lineWidth = 2.2; g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < len; s += 18) { a += (Math.random() - 0.5) * 0.35; x += Math.cos(a) * 18; y += Math.sin(a) * 18; g.lineTo(x, y); g.lineWidth *= 0.97; }
      g.stroke();
    }
    for (let r = 40; r < 240; r += 38 + Math.random() * 30) { // concentric fractures
      g.lineWidth = 1.4; g.beginPath();
      for (let a = 0; a < Math.PI * 2; a += 0.22) { const rr = r * (0.85 + Math.random() * 0.3); const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; a === 0 ? g.moveTo(x, y) : g.lineTo(x, y); }
      g.closePath(); g.stroke();
    }
    const grd = g.createRadialGradient(cx, cy, 0, cx, cy, 70); grd.addColorStop(0, 'rgba(255,255,255,0.75)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, 70, 0, 7); g.fill();
    crackTex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- creatures
  const gltf = await loadCreatureModel((p) => game.onProgress?.(p));
  const cellWorld = (c) => ({ colliders: [], bounds: { min: V(c.x0 + 0.45, 0, c.z0 + 0.45), max: V(c.x1 - 0.45, 0, L.z0 - 0.4) } });
  const labWorld = { colliders: propColliders, bounds: { min: V(LAB.wingD.x0 + 1, 0, LAB.cellA.z0), max: V(L.x1, 0, L.z1) } };
  const A = Creature.spawn(gltf), B = Creature.spawn(gltf);
  B.object.scale.setScalar(0.93); // the younger one
  for (const [c, x, z, yaw, cell] of [[A, -3.7, -9.6, Math.PI, LAB.cellA], [B, 5.5, -10.0, -0.7, LAB.cellB]]) {
    c.object.position.set(x, 0, z); c.object.rotation.y = yaw; scene.add(c.object); c.object.updateMatrixWorld(true);
    c.attach(cellWorld(cell));
  }
  A.anim.play('faceWall', { yaw: Math.PI });
  B.anim.play('crouch', { yaw: -0.5 });
  const blockA = creatureBlockers(A), blockB = creatureBlockers(B);
  let bActive = true;
  player.colliders = colliders;
  player.blockers = () => [...blockA(), ...(bActive ? blockB() : [])];
  window.__A = A; window.__B = B;

  // ---------------------------------------------------------------- the halide lamp
  const lamp = { has: false, charge: 1, cells: 4, cool: 0, view: null, light: null };
  lamp.light = new THREE.SpotLight(0xf2f6ff, 0, 22, 0.75, 0.3, 1.2);
  lamp.light.position.set(0.15, -0.15, 0); lamp.light.target.position.set(0, 0, -5);
  game.camera.add(lamp.light, lamp.light.target);
  function giveLamp() {
    lamp.has = true; lampOnRack.visible = false;
    lamp.view = lampModel; lamp.view.position.set(0.24, -0.25, -0.42); lamp.view.rotation.set(0.05, 0.08, 0);
    lamp.view.traverse((o) => { o.castShadow = false; });
    game.camera.add(lamp.view);
    ui.lampMeter(true, lamp.charge, lamp.cells);
  }
  const onFlashHit = new Set();
  function flash() {
    if (!lamp.has || lamp.cool > 0) return;
    if (lamp.charge < 1 / lamp.cells - 1e-3) { sfx.beep('deny'); return; }
    lamp.charge -= 1 / lamp.cells; lamp.cool = 0.6;
    sfx.strobeFlash(); ui.whiteFlash(0.85); lamp.light.intensity = 900;
    lamp.view?.userData.flash && (lamp.view.userData.flash.material.emissiveIntensity = 8);
    const cam = game.camera, fwd = cam.getWorldDirection(V(0, 0, 0));
    for (const c of [A, B]) {
      if (!c.object.visible) continue;
      const chest = c.bone.upperChest.getWorldPosition(V(0, 0, 0));
      const to = chest.sub(cam.position); const dist = to.length();
      if (dist < 9.5 && to.normalize().dot(fwd) > Math.cos(0.42)) for (const f of onFlashHit) f(c, dist);
    }
  }
  function updateLamp(dt) {
    if (!lamp.has) return;
    lamp.cool = Math.max(0, lamp.cool - dt);
    const before = Math.floor(lamp.charge * lamp.cells + 1e-6);
    lamp.charge = Math.min(1, lamp.charge + dt / (lamp.cells * 3.2));
    if (Math.floor(lamp.charge * lamp.cells + 1e-6) > before) sfx.strobeCharge();
    lamp.light.intensity *= Math.exp(-dt * 22);
    if (lamp.view?.userData.flash) lamp.view.userData.flash.material.emissiveIntensity = Math.max(0.6, lamp.view.userData.flash.material.emissiveIntensity * Math.exp(-dt * 10));
    lamp.view?.userData.setCharge?.(lamp.charge);
    ui.lampMeter(true, lamp.charge, lamp.cells);
    if (game.input.wasPressed('Mouse2', 'KeyQ')) flash();
    // view model sway
    const t = game.time; lamp.view.position.y = -0.25 + Math.sin(t * 1.6) * 0.004 + Math.sin(player.bob * 2) * 0.006;
  }

  // ---------------------------------------------------------------- state & helpers
  const S = { stage: 'start', observed: { A: 0, B: 0 }, tests: false, deaths: 0 };
  const inRect = (p, r, pad = 0) => p.x > r.x0 - pad && p.x < r.x1 + pad && p.z > r.z0 - pad && p.z < r.z1 + pad;
  function lookingAt(c, maxD = 8, ang = 0.22) {
    const head = c.bone.head.getWorldPosition(V(0, 0, 0)), cam = game.camera.position;
    const to = head.sub(cam); const dd = to.length();
    return dd < maxD && to.normalize().dot(game.camera.getWorldDirection(V(0, 0, 0))) > Math.cos(ang);
  }
  let strobing = 0, strobeT = 0, cellBoost = 1;

  const doorFront = (dname, off = 0.9) => { const s = LAB.doors[dname]; return s.axis === 'z' ? V(s.x + off, 1.2, s.z) : V(s.x, 1.2, s.z + off); };

  // ---------------------------------------------------------------- interactions
  interact.add({ position: badge.position.clone().add(V(0, 0, 0.05)), label: 'Badge in', enabled: () => S.stage === 'badge', onUse: () => { badge.userData.setState?.('ok'); sfx.beep('ok'); S.badged = true; } });
  interact.add({ position: () => ws1.userData.screens?.[0]?.mesh ? ws1.userData.screens[0].mesh.getWorldPosition(V(0, 0, 0)) : V(-6.4, 1.2, 2.6), label: 'Log in · overnight notes', reach: 2.2, size: 0.5, enabled: () => S.stage === 'login', onUse: async () => { sfx.beep('terminal'); await ui.readDoc(DOSSIER, game.input); S.readNotes = true; } });
  interact.add({ position: V(0, 1.05, -3.2), label: () => (S.stage === 'seal' ? 'Seal Cell A' : 'Run response battery'), reach: 2.0, size: 0.7, enabled: () => S.stage === 'console' || S.stage === 'seal', onUse: () => { sfx.beep('console'); S.consoleUsed = true; } });
  interact.add({ position: kit.position, label: 'Take sealant kit', reach: 2.0, enabled: () => S.stage === 'kit', onUse: () => { kit.visible = false; S.kit = true; } });
  interact.add({ position: V(10.0, 1.24, 0.4), label: 'Watch CCTV', reach: 2.0, size: 0.4, enabled: () => S.stage === 'cctv', onUse: () => { S.cctv = true; } });
  interact.add({ position: V(7.6, 1.55, -1.3), label: 'Take halide lamp', reach: 2.0, enabled: () => S.stage === 'lamp', onUse: () => { giveLamp(); S.lamp = true; } });

  // ---------------------------------------------------------------- per-frame
  let deadPending = false;
  function updateCreature(c, dt) {
    if (!c.object.visible) return;
    c.update(dt, creatureCtx(game));
    player.shake = Math.max(player.shake, c.anim.shake);
  }

  // ---------------------------------------------------------------- the script
  async function opening() {
    S.stage = 'intro';
    player.place(0, 15.8, 0, -0.05); player.frozen = true;
    ui.setFade(1);
    sfx.setAmbience('lab', 0.8, 4); sfx.setReverb('corridor');
    await ui.card('HALVERSEN BIOCONTAINMENT', 'SITE 41 · WING C<br>06:12 · C-14 ROTATION', 3.6);
    ui.fadeTo(0, 2.5); player.frozen = false;
    await d.wait(1.5);
    await say(OK, 'Morning, Rook. You\'re on C-14 today. Lind\'s old rotation.');
    await say(OK, 'Badge in, go through decon, then log in. Overnight notes are on your terminal.');
    S.stage = 'badge'; ui.objective('Badge in at the security door.');
    await d.until(() => S.badged);
    doors.outer.open(); ui.objective('Step into the decontamination airlock.');
    await d.until(() => inRect(player.pos, LAB.airlock, -0.25));
    await d.wait(0.6); doors.outer.close(); sfx.setReverb('small');
    ui.objective(null);
    await d.wait(1.6);
    // decontamination cycle
    sfx.deconSpray(4.6);
    const stopMist = d.every((dt) => { mistMat.uniforms.uT.value += dt; mistMat.uniforms.uA.value = Math.min(1, mistMat.uniforms.uA.value + dt * 1.5); });
    await d.wait(4.6); stopMist();
    d.every((dt) => { mistMat.uniforms.uT.value += dt; mistMat.uniforms.uA.value = Math.max(0, mistMat.uniforms.uA.value - dt * 0.5); });
    sfx.beep('ok'); await d.wait(0.5);
    doors.inner.open(); sfx.setReverb('lab');
    await d.until(() => player.pos.z < LAB.lab.z1 - 0.6);
    doors.inner.close();
    await say(OK, 'Your terminal\'s on the west wall. Read the notes before you go near the glass.');
    S.stage = 'login'; ui.objective('Log in at your workstation and read the overnight notes.');
    await d.until(() => S.readNotes);
    await say(OK, 'Good. Go and look at them. Take your time.');
    await observe();
  }

  async function observe() {
    S.stage = 'observe';
    ui.objective('Observe the specimens (0/2).');
    let saidA = false, saidB = false;
    await d.until(() => {
      const dt = 1 / 60;
      if (lookingAt(A, 9)) S.observed.A += dt; if (lookingAt(B, 9)) S.observed.B += dt;
      const n = (S.observed.A > 2) + (S.observed.B > 2);
      ui.el.objTxt.textContent = `Observe the specimens (${n}/2).`;
      if (S.observed.A > 2 && !saidA) { saidA = true; say(OK, 'A hasn\'t moved since Tuesday. Two hundred and eleven nights, facing that wall.'); }
      if (S.observed.B > 2 && !saidB) {
        saidB = true;
        // B notices you. It gets up, slowly, walks to the glass and looks at you.
        B.anim.play('goto', { x: clamp(player.pos.x, 2.6, 6.0), z: -6.55, speed: 0.55, face: 0, then: ['idle', { stare: true }], lookAtPlayer: true });
        (async () => { await say(OK, 'B\'s up. It does that when somebody new comes on shift.'); await say(OK, 'Don\'t stand at the glass too long. It reads faces.'); })();
      }
      return n >= 2;
    });
    await d.wait(3.5);
    await say(OK, 'All right. Response battery. Observation console, centre of the room.');
    S.stage = 'console'; ui.objective('Run the response battery at the observation console.');
    await d.until(() => S.consoleUsed); S.consoleUsed = false;
    await battery();
  }

  async function battery() {
    S.stage = 'battery'; ui.objective('Response battery in progress.');
    player.lookAt(V(0, 1.6, -8.5), 1.5); await d.wait(1.0); player.releaseLook();
    // 1. LIGHT
    await say(OK, 'Test one. Light, two thousand lux.');
    cellBoost = 3.2; sfx.beep('console');
    B.anim.play('shield', { from: V(4.2, 0, -9), dur: 4.5 });
    await say(OK, 'B shields. A ignores it. Same as every morning.');
    await d.wait(1.5); cellBoost = 1;
    B.anim.play('idle', { stare: true });
    await d.wait(1.2);
    // 2. TONE (above human hearing)
    await say(OK, 'Test two. Eighteen kilohertz. You won\'t hear it. They will.');
    ui.toast('TONE · 18 kHz · RUNNING', 3);
    B.anim.play('convulse');
    await d.wait(1.0);
    A.anim.play('idle', { stare: true }); // for the first time, A turns its head toward you
    await say(OK, '...');
    await say(OK, 'A turned its head. That\'s new. Note it.');
    await d.wait(1.5);
    A.anim.play('faceWall', { yaw: Math.PI });
    await d.wait(1.2);
    // 3. STROBE
    await say(OK, 'Last one. Strobe, twelve hertz, three seconds.');
    strobing = 3.0; sfx.beep('console');
    B.anim.play('recoil', { from: V(4.2, 1, -7), dur: 1.0, then: ['leap', { to: V(4.2, 0, -6.6), onImpact: glassHit, then: ['idle', { stare: true }] }] });
    await d.until(() => S.glassHit);
    await d.wait(0.8);
    sfx.alarm(true, 'breach'); await d.wait(1.4); sfx.alarm(false);
    await say(OK, 'Abort. Abort the battery. Rook, step back from the glass.');
    await d.wait(1.0);
    await say(OK, 'It\'s laminated, it\'ll hold. A didn\'t even move. Look at it.');
    await say(OK, 'I want that pane sealed before shift change. There\'s a sealant kit in Storage, east wall.');
    S.stage = 'kit'; ui.objective('Get the sealant kit from Storage.');
    doors.storage.open();
    await d.until(() => S.kit);
    await breach();
  }
  function glassHit() {
    S.glassHit = true; drawCrack(); crackMat.opacity = 1;
    sfx.glassCrack(V(4.1, 1.6, L.z0)); sfx.stinger('hit'); player.shake = 1.0;
  }

  async function breach() {
    S.stage = 'breach'; ui.objective(null);
    doors.storage.close();
    await d.wait(1.2);
    // the power dies
    for (let i = 0; i < 3; i++) { setPower(false); await d.wait(0.08 + Math.random() * 0.1); setPower(true); await d.wait(0.12 + Math.random() * 0.2); }
    setPower(false); sfx.powerDown(); sfx.setAmbience('labDark', 1, 1.5);
    await d.wait(2.2);
    doors.cellA.open(); doors.cellB.open();
    A.anim.world = labWorld; B.anim.world = labWorld;
    sfx.alarm(true, 'breach'); sfx.setTension(0.45);
    sfx.pa('chime'); await say(PA, 'Containment breach. Wing C. Containment breach. Wing C.');
    await say(OK, 'Rook. Rook, are you there?');
    await say(OK, 'The cell locks are on the main bus. When it dropped, they opened. Both of them.');
    await say(OK, 'Don\'t open that door. There\'s a CCTV terminal in there with you. Look.');
    cctvMat.uniforms.uOn.value = 1;
    S.stage = 'cctv'; ui.objective('Check the CCTV terminal.');
    await d.until(() => S.cctv);
    await cctv();
  }

  async function cctv() {
    S.stage = 'watching'; ui.objective(null);
    player.frozen = true; player.lookAt(V(10.25, 1.24, 0.4), 4);
    // B goes for the Wing D door; A comes out into the lab and stops in the middle of it
    B.anim.play('goto', { x: -2.2, z: -4.6, speed: 1.6, crawl: true, then: ['breakDoor'] });
    A.anim.play('goto', { x: 0.5, z: 0.2, speed: 0.5, then: ['idle'] });
    sfx.setTension(0.65);
    await d.until(() => B.anim.actionName === 'idle' && S.doorDGone || B.anim.actionName === 'lookAround');
    await d.wait(0.8);
    B.anim.play('goto', { x: -12.5, z: -4, speed: 1.4, crawl: true, then: ['idle'] });
    await say(OK, 'B\'s gone into D. God.');
    await d.until(() => B.object.position.x < -10.5);
    B.object.visible = false; bActive = false;
    player.frozen = false; player.releaseLook();
    await say(OK, 'A\'s still in the lab. It\'s just standing there.');
    await say(OK, 'There\'s a halide lamp on the rack behind you. Take it.');
    S.stage = 'lamp'; ui.objective('Take the halide lamp.');
    await d.until(() => S.lamp);
    save.set('prologue', 'lamp');
    await recapture();
  }

  async function recapture() {
    ui.toast('RIGHT MOUSE / Q · FLASH', 6);
    await say(OK, 'A full flash drives them back. A hates it more than B does.');
    await say(OK, 'Get A back into its cell, then seal it from the console. I\'m opening your door.');
    sfx.setTension(0.75);
    doors.storage.open();
    S.stage = 'recapture'; ui.objective('Drive C-14A back into Cell A with the halide lamp.');
    // C-14A: stalks you; a flash drives it back along the path to its cell
    const path = [V(-1.45, 0, -4.4), V(-1.45, 0, -6.9), V(-3.6, 0, -8.6)];
    let pi = 0, close = 0, inCell = false;
    A.anim.play('stalk');
    onFlashHit.add((c, dist) => {
      if (c !== A || inCell || S.dead) return;
      sfx.creatureScream(c.bone.head.getWorldPosition(V(0, 0, 0)), { dur: 1.4 });
      // next point along the path that is further from you than it is
      const ap = A.object.position;
      while (pi < path.length - 1 && ap.distanceTo(path[pi]) < 1.0) pi++;
      const target = path[pi];
      const dir = target.clone().sub(ap); const len = Math.min(dir.length(), 2.8); dir.setLength(len);
      const to = ap.clone().add(dir);
      A.anim.play('recoil', { from: game.camera.position.clone(), dur: 0.9, then: ['retreat', { x: to.x, z: to.z, speed: 1.1, then: ['stalk'] }] });
      close = 0;
    });
    await d.until(() => {
      if (S.dead) return false;
      const ap = A.object.position;
      if (!inCell && ap.z < LAB.cellA.z1 - 0.6 && ap.x < LAB.cellA.x1 && ap.x > LAB.cellA.x0) {
        inCell = true; A.anim.world = cellWorld(LAB.cellA);
        A.anim.play('goto', { x: -3.7, z: -9.6, speed: 0.6, face: Math.PI, then: ['faceWall', { yaw: Math.PI }] });
      }
      if (inCell) return true;
      // too close for too long: it kills you
      const dd = A.anim.distToPlayer();
      if (dd < 2.45 && A.anim.actionName === 'stalk') close += 1 / 60; else close = Math.max(0, close - 1 / 60);
      if (close > 2.2) { die(); }
      return false;
    });
    await say(OK, 'It\'s in. It\'s going back to its wall. Seal it. Now.');
    S.stage = 'seal'; ui.objective('Seal Cell A from the observation console.');
    await d.until(() => S.consoleUsed);
    doors.cellA.close(); sfx.alarm(false); sfx.setTension(0.3);
    await d.until(() => doors.cellA.open01 < 0.02);
    save.set('prologue', 'sealed');
    await ending();
  }

  async function die() {
    if (S.dead) return; S.dead = true;
    A.anim.play('attack', { onHit: async () => {
      sfx.creatureScream(game.camera.position, { dur: 1.2 }); sfx.stinger('hit');
      ui.red(true); ui.setFade(1); player.frozen = true;
      await new Promise((r) => setTimeout(r, 900));
      ui.red(false);
      S.deaths++;
      await ui.death('YOU WERE TAKEN', 'It was close for too long. Keep the light on it.', game.input);
      restartFromLamp();
    } });
    player.lookAt(A.bone.head.getWorldPosition(V(0, 0, 0)), 8);
  }
  function restartFromLamp() {
    game.load(intro, { checkpoint: 'lamp', deaths: S.deaths });
  }

  async function ending() {
    S.stage = 'end';
    await d.wait(1.2);
    await say(OK, '...Thank you.');
    await say(OK, 'B went through the Wing D door. The construction side. Half-finished, no cameras past the first section.');
    await say(OK, 'Lockdown has sealed the site. Response team is forty minutes out.');
    await say(OK, 'You\'re the only one in Wing C cleared for C-14. You know them better than anyone alive.');
    await say(OK, 'Find it. Bring it back.');
    await say(OK, 'If you can\'t bring it back, the lamp has a setting for that.');
    ui.objective('Go to the Wing D door.');
    await d.until(() => player.pos.distanceTo(V(LAB.doors.wingD.x + 0.4, 0, LAB.doors.wingD.z)) < 1.6);
    player.frozen = true; player.lookAt(V(-12, 1.4, -4), 1.2);
    sfx.setTension(0.5); await d.wait(2.0);
    await ui.fadeTo(1, 2.5);
    save.set('chapter', 1); save.set('prologue', 'done');
    sfx.setAmbience('none', 0, 2); sfx.setTension(0); sfx.alarm(false);
    await ui.card('CHAPTER ONE', 'THE BUILD-OUT<br><br>in development', 5);
    location.href = location.pathname + (location.search.includes('meta') ? location.search : '');
  }

  // ---------------------------------------------------------------- wing D door can be smashed by B
  const dDoor = doors.wingD;
  const doorD = {
    position: V(LAB.doors.wingD.x, 0, LAB.doors.wingD.z), normal: V(1, 0, 0), broken: false,
    hit(n) { dDoor.shakeV = (dDoor.shakeV || 0) + 2 + n; sfx.doorBang(dDoor.pos, 0.7 + n * 0.3); },
    smash(dir) {
      doorD.broken = true; dDoor.broken = true; dDoor.collider.disabled = true; S.doorDGone = true;
      sfx.doorSmash(dDoor.pos);
      dDoor.fly = { v: V(-4.5, 1.5, (Math.random() - 0.5)), w: V(0.5, 3, 1.2) };
    },
    reset() {},
  };
  A.anim.world.door = doorD; B.anim.world.door = doorD; labWorld.door = doorD;
  function updateDoorD(dt) {
    const leaf = dDoor.leaf;
    if (dDoor.fly) {
      const f = dDoor.fly; f.v.y -= 9.8 * dt;
      const wp = leaf.getWorldPosition(V(0, 0, 0)).addScaledVector(f.v, dt);
      if (wp.y < 0.3) { wp.y = 0.3; f.v.multiplyScalar(0.3); f.v.y = Math.abs(f.v.y) * 0.2; f.w.multiplyScalar(0.4); }
      leaf.parent.worldToLocal(wp); leaf.position.copy(wp);
      leaf.rotation.x += f.w.x * dt; leaf.rotation.y += f.w.y * dt; leaf.rotation.z += f.w.z * dt;
      if (f.v.lengthSq() < 0.01) dDoor.fly = null;
    } else if (dDoor.shakeV) {
      dDoor.shakeX = (dDoor.shakeX || 0); dDoor.shakeV += (-dDoor.shakeX * 700 - dDoor.shakeV * 14) * dt; dDoor.shakeX += dDoor.shakeV * dt;
      leaf.position.z = dDoor.home.z + dDoor.shakeX * 0.01;
    }
  }

  // ---------------------------------------------------------------- checkpoints
  const cp = opts.checkpoint || game.params.get('cp');
  S.deaths = opts.deaths || 0;
  if (cp === 'lamp') {
    // after the breach: power out, B gone, A in the lab, you in Storage with the lamp
    setPower(false); doors.cellA.target = doors.cellA.open01 = 1; doors.cellB.target = doors.cellB.open01 = 1;
    drawCrack(); crackMat.opacity = 1;
    B.object.visible = false; bActive = false;
    dDoor.broken = true; dDoor.collider.disabled = true; dDoor.leaf.position.set(-2.2, 0.3, 0.6); dDoor.leaf.rotation.set(1.5, 0.4, 0.2);
    A.object.position.set(0.5, 0, 0.2); A.anim.world = labWorld; A.anim.home = { x: 0.5, z: 0.2, heading: 1.5 }; A.anim.reset(); A.anim.world = labWorld;
    A.anim.play('idle');
    player.place(8.9, 0.2, Math.PI / 2, 0);
    kit.visible = false; cctvMat.uniforms.uOn.value = 1;
    giveLamp(); game.flashlight.on = true;
    sfx.setAmbience('labDark', 1, 1); sfx.alarm(true, 'breach');
    game.run(async () => { ui.setFade(1); await ui.fadeTo(0, 1.5); await recapture(); });
  } else if (cp === 'tests') {
    player.place(0, -2.2, 0, 0); S.readNotes = true;
    game.run(async () => { ui.setFade(1); ui.fadeTo(0, 1); S.observed = { A: 3, B: 3 }; await observe(); });
  } else if (cp === 'still') {
    ui.setFade(0); // static scene for screenshots
    if (game.params.has('dark')) setPower(false);
    applyDebugCamera(game);
  } else {
    game.run(opening);
  }

  window.__intro = { S, doors, A, B, lamp, setPower, flash, player, giveLamp };
  return {
    look: 'clinical', ownFade: true,
    update(dt, t) {
      for (const dr of Object.values(doors)) dr.update(dt);
      updateDoorD(dt);
      updateCreature(A, dt); updateCreature(B, dt);
      updateLamp(dt);
      // cell lights: boosted for the light test, strobing for the strobe test
      if (power) {
        if (strobing > 0) { strobing -= dt; strobeT += dt; const on = Math.sin(strobeT * Math.PI * 2 * 12) > 0; for (const k of ['A', 'B']) cellSpots[k].intensity = on ? 60 : 0; }
        else for (const k of ['A', 'B']) cellSpots[k].intensity += (cellSpots[k].userData.base * cellBoost - cellSpots[k].intensity) * (1 - Math.exp(-dt * 6));
      }
      // emergency beacons rotate
      if (!power) for (const [i, b] of beacons.entries()) { const a = t * 3.2 + i * 2; b.light.target.position.set(b.base.x + Math.cos(a) * 4, 0.2, b.base.z + Math.sin(a) * 4); b.light.target.updateMatrixWorld(); }
      cctvMat.uniforms.uTime.value = t; renderCCTV();
      // where you are decides how footsteps and the room sound
      const p = player.pos;
      game.surface = inRect(p, LAB.airlock) ? 'metal' : 'tile';
      game.fear = power ? 0 : Math.max(0.2, 1 - Math.min(1, A.anim.distToPlayer() / 6)) * (A.object.visible ? 1 : 0.3);
      // creature breathing when close
      for (const c of [A, B]) {
        if (!c.object.visible) continue;
        c._br = (c._br || 0) - dt;
        if (c._br < 0 && c.anim.distToPlayer() < 7) { c._br = 2.4 + Math.random(); sfx.creatureBreath(c.bone.head.getWorldPosition(V(0, 0, 0)), { intensity: power ? 0.3 : 0.7 }); }
      }
    },
    dispose() { cctvRT.dispose(); sfx.alarm(false); sfx.setTension(0); },
  };
}
