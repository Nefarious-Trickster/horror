import * as THREE from 'three';
import { Creature } from './creature.js';
import { ACTION_LIST } from './anim.js';
import { buildRoom, flashlightCookie, ROOM, CREATURE_SPOT } from './room.js';
import { createPost } from './post.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches;

// ------------------------------------------------------------------ renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
const pixelRatio = Math.min(devicePixelRatio, params.has('pr') ? parseFloat(params.get('pr')) : isTouch ? 1 : 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020203);
scene.fog = new THREE.FogExp2(0x030304, 0.07);

const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.02, 60);
scene.add(camera);

const room = buildRoom(scene);
if (params.has('nolampshadow')) room.lamp.castShadow = false;

// ------------------------------------------------------------------ flashlight (lags behind your view, like a hand)
const flash = new THREE.SpotLight(0xfff0d8, 40, 30, 0.42, 0.55, 2);
flash.map = flashlightCookie();
flash.castShadow = true;
flash.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
flash.shadow.bias = -0.0003; flash.shadow.normalBias = 0.015;
flash.shadow.camera.near = 0.08; flash.shadow.camera.far = 25;
const flashRig = new THREE.Object3D();
flashRig.add(flash, flash.target);
flash.position.set(0.17, -0.2, 0.05);
flash.target.position.set(0.02, -0.05, -4);
scene.add(flashRig);
let flashOn = !params.has('noflash');
let flashFlicker = 1;

// inspection light, for looking at the model in detail
const work = new THREE.Group();
const workKey = new THREE.DirectionalLight(0xffffff, 0);
workKey.position.set(-1.5, 3, 2.5); workKey.target.position.set(CREATURE_SPOT.x, 1.4, CREATURE_SPOT.z);
workKey.castShadow = true; workKey.shadow.mapSize.set(2048, 2048);
Object.assign(workKey.shadow.camera, { left: -3, right: 3, top: 4, bottom: -3, near: 0.5, far: 16 });
workKey.shadow.bias = -0.0004;
const workFill = new THREE.HemisphereLight(0xdde4ff, 0x2a2420, 0);
work.add(workKey, workKey.target, workFill);
work.position.set(0, 0, 0);
scene.add(work);
let workOn = params.has('work');

// ------------------------------------------------------------------ player
const player = {
  pos: new THREE.Vector3(0.2, 0, 3.2), yaw: 0.0, pitch: 0.02,
  vel: new THREE.Vector3(), bob: 0, eye: 1.66,
};
if (params.has('cam')) { const [x, y, z] = params.get('cam').split(',').map(Number); player.pos.set(x, 0, z); player.eye = y; }
if (params.has('look')) {
  const [x, y, z] = params.get('look').split(',').map(Number);
  const d = new THREE.Vector3(x, y, z).sub(new THREE.Vector3(player.pos.x, player.eye, player.pos.z));
  player.yaw = Math.atan2(-d.x, -d.z); player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
} else {
  const d = new THREE.Vector3(CREATURE_SPOT.x, 1.6, CREATURE_SPOT.z).sub(new THREE.Vector3(player.pos.x, player.eye, player.pos.z));
  player.yaw = Math.atan2(-d.x, -d.z) + 0.12;
}
const keys = new Set();
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyF') toggleFlash();
  if (e.code === 'KeyL') toggleWork();
  if (e.code === 'KeyH') $('hud').classList.toggle('hidden');
  if (e.code === 'KeyP' && creature) creature.frozen = !creature.frozen;
  const act = ACTION_LIST.find(([, , key]) => e.code === (/\d/.test(key) ? 'Digit' + key : 'Key' + key));
  if (act) playAction(act[0]);
});
addEventListener('keyup', (e) => keys.delete(e.code));
function toggleFlash() { flashOn = !flashOn; click(); }
function toggleWork() { workOn = !workOn; }

// mouse look: pointer lock where allowed, click-drag otherwise
let locked = false, dragging = false, lastX = 0, lastY = 0;
const look = (dx, dy, s = 0.0022) => {
  player.yaw -= dx * s; player.pitch = THREE.MathUtils.clamp(player.pitch - dy * s, -1.45, 1.45);
};
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === renderer.domElement; });
addEventListener('mousemove', (e) => { if (locked) look(e.movementX, e.movementY); else if (dragging) { look(e.clientX - lastX, e.clientY - lastY, 0.004); lastX = e.clientX; lastY = e.clientY; } });
renderer.domElement.addEventListener('mousedown', (e) => {
  if (isTouch) return;
  dragging = true; lastX = e.clientX; lastY = e.clientY;
  if (!locked) lockPointer();
});
addEventListener('mouseup', () => { dragging = false; });
// some embeds (sandboxed iframes) refuse pointer lock; click-drag look still works there
function lockPointer() {
  try { const r = renderer.domElement.requestPointerLock?.(); r?.catch?.(() => {}); } catch { /* not allowed here */ }
}

// touch: left half = move stick, right half = look
const touch = { move: null, look: null, mx: 0, my: 0 };
if (isTouch) {
  document.body.classList.add('touch');
  const el = renderer.domElement;
  el.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth * 0.45 && !touch.move) { touch.move = { id: t.identifier, x: t.clientX, y: t.clientY }; showStick(t.clientX, t.clientY); }
      else if (!touch.look) touch.look = { id: t.identifier, x: t.clientX, y: t.clientY };
    }
    e.preventDefault();
  }, { passive: false });
  el.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (touch.move?.id === t.identifier) {
        const dx = t.clientX - touch.move.x, dy = t.clientY - touch.move.y, l = Math.min(Math.hypot(dx, dy), 50) / 50, a = Math.atan2(dy, dx);
        touch.mx = Math.cos(a) * l; touch.my = Math.sin(a) * l; moveKnob(touch.mx, touch.my);
      } else if (touch.look?.id === t.identifier) {
        look(t.clientX - touch.look.x, t.clientY - touch.look.y, 0.005); touch.look.x = t.clientX; touch.look.y = t.clientY;
      }
    }
    e.preventDefault();
  }, { passive: false });
  const end = (e) => { for (const t of e.changedTouches) { if (touch.move?.id === t.identifier) { touch.move = null; touch.mx = touch.my = 0; hideStick(); } if (touch.look?.id === t.identifier) touch.look = null; } };
  el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
  $('btnFlash').addEventListener('click', toggleFlash);
  $('btnWork').addEventListener('click', toggleWork);
}
function showStick(x, y) { const s = $('stick'); s.style.left = x + 'px'; s.style.top = y + 'px'; s.classList.add('on'); }
function moveKnob(x, y) { $('knob').style.transform = `translate(${x * 40}px, ${y * 40}px)`; }
function hideStick() { $('stick').classList.remove('on'); $('knob').style.transform = ''; }

// collision: room bounds, props, and the creature itself
function collide(p) {
  const r = 0.28;
  p.x = THREE.MathUtils.clamp(p.x, ROOM.min.x + r, ROOM.max.x - r);
  p.z = THREE.MathUtils.clamp(p.z, ROOM.min.z + r, ROOM.max.z - r);
  for (const c of room.colliders) {
    const cx = THREE.MathUtils.clamp(p.x, c.minX, c.maxX), cz = THREE.MathUtils.clamp(p.z, c.minZ, c.maxZ);
    const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
    if (d < r) { if (d > 1e-5) { p.x = cx + (dx / d) * r; p.z = cz + (dz / d) * r; } }
  }
  // the creature's body: its feet, hips and chest (which reach far forward when it crawls)
  if (creature) for (const [b, R] of creatureBlockers) {
    const q = b.getWorldPosition(_cb);
    const dx = p.x - q.x, dz = p.z - q.z, d = Math.hypot(dx, dz);
    if (d < R && d > 1e-5) { p.x = q.x + (dx / d) * R; p.z = q.z + (dz / d) * R; }
  }
}

// ------------------------------------------------------------------ audio (tiny: flashlight click only)
let actx = null;
function click() {
  try {
    actx ??= new AudioContext();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'square'; o.frequency.value = 2400;
    g.gain.setValueAtTime(0.05, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.03);
    o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.04);
  } catch { /* audio optional */ }
}

// ------------------------------------------------------------------ post
const post = createPost(renderer, scene, camera, { ao: !params.has('noao') && !isTouch });
post.setSize(innerWidth, innerHeight, pixelRatio);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); post.setSize(innerWidth, innerHeight, pixelRatio);
});

// ------------------------------------------------------------------ load creature
let creature = null;
let creatureBlockers = [];
const _cb = new THREE.Vector3();

// action panel: buttons (and number keys) that make the creature perform
function playAction(name) {
  if (!creature) return;
  creature.frozen = false;
  creature.anim.play(name);
}
function buildActionPanel() {
  const panel = $('actions');
  for (const [name, label, key] of ACTION_LIST) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.action = name;
    b.innerHTML = `<kbd>${key}</kbd>${label}`;
    b.addEventListener('click', (e) => { e.stopPropagation(); playAction(name); b.blur(); });
    panel.appendChild(b);
  }
}
function markAction(name) {
  for (const b of $('actions').children) b.classList.toggle('on', b.dataset.action === name);
}
const bar = $('bar');
// a page may point at another copy of the model (e.g. the JSON .gltf form) with <meta name="creature-model">
const modelMeta = document.querySelector('meta[name="creature-model"]')?.content;
const modelUrl = modelMeta ? new URL(modelMeta, document.baseURI).href : new URL('../assets/creature.glb', import.meta.url).href;
Creature.load(modelUrl, (p) => { bar.style.width = (p * 100).toFixed(0) + '%'; })
  .then((c) => {
    creature = c;
    window.__creature = c; // handy for poking at it from the devtools console
    c.object.position.set(CREATURE_SPOT.x, 0, CREATURE_SPOT.z);
    c.object.rotation.y = Math.atan2(0.2 - CREATURE_SPOT.x, 3.2 - CREATURE_SPOT.z) * 0.85;
    scene.add(c.object);
    c.object.updateMatrixWorld(true);
    const anim = c.attach({ colliders: room.colliders, bounds: ROOM, door: room.door });
    anim.onAction = markAction;
    buildActionPanel(); markAction('idle');
    creatureBlockers = [[c.bone.root, 0.45], [c.bone.hips, 0.5], [c.bone.upperChest, 0.45], [c.bone.head, 0.3]];
    if (params.has('act')) c.anim.play(params.get('act'));
    if (params.has('t')) { const T = parseFloat(params.get('t')); for (let i = 0; i < T * 30; i++) { c.update(1 / 30, ctx()); room.door.update(1 / 30, 0); } }
    if (params.has('freeze')) c.frozen = true;
    $('loading').classList.add('done');
    $('enter').classList.add('ready');
    window.__ready = true;
  })
  .catch((e) => { console.error(e); $('status').textContent = 'Failed to load the creature: ' + e.message; });

$('enter').addEventListener('click', () => {
  $('intro').classList.add('gone');
  if (!isTouch) lockPointer();
  click();
  setTimeout(() => $('hud').classList.add('faded'), 9000);
});
if (params.has('noui')) { $('intro').classList.add('gone'); $('hud').classList.add('hidden'); $('actions').hidden = true; }

// ------------------------------------------------------------------ loop
const clock = new THREE.Clock();
let time = 0;
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), lagQ = new THREE.Quaternion();
const ctx = () => ({ camera, flashlight: flash, flashlightOn: flashOn, flashlightIntensity: flashFlicker });

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;

  // movement
  const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
  let mx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  let mz = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  if (touch.move) { mx = touch.mx; mz = -touch.my; }
  fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  const want = new THREE.Vector3().addScaledVector(fwd, mz).addScaledVector(right, mx);
  if (want.lengthSq() > 1) want.normalize();
  want.multiplyScalar(run ? 2.6 : 1.35);
  player.vel.lerp(want, 1 - Math.exp(-dt * 8));
  player.pos.addScaledVector(player.vel, dt);
  collide(player.pos);
  const speed = player.vel.length();
  player.bob += dt * speed * 5.2;
  const bobY = Math.sin(player.bob * 2) * 0.022 * Math.min(speed, 1.5);
  const bobX = Math.cos(player.bob) * 0.014 * Math.min(speed, 1.5);
  const sway = Math.sin(time * 0.7) * 0.004;

  camera.position.set(player.pos.x, player.eye + bobY + sway, player.pos.z).addScaledVector(right, bobX);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(player.pitch + Math.sin(time * 0.5) * 0.003, player.yaw, Math.cos(player.bob) * 0.004 * speed);
  // impacts, landings and screams shake the view
  const shake = creature ? Math.min(creature.anim.shake, 1.5) : 0;
  if (shake > 0.01) {
    camera.position.x += (Math.random() - 0.5) * 0.03 * shake; camera.position.y += (Math.random() - 0.5) * 0.03 * shake;
    camera.rotation.z += (Math.random() - 0.5) * 0.02 * shake;
  }
  camera.updateMatrixWorld();

  // flashlight follows the view with a little lag and tremor
  flashRig.position.copy(camera.position);
  lagQ.copy(camera.quaternion);
  flashRig.quaternion.slerp(lagQ, 1 - Math.exp(-dt * 14));
  flashRig.rotateX(Math.sin(time * 1.7) * 0.0015); flashRig.rotateY(Math.cos(time * 1.3) * 0.0015);
  flashFlicker = Math.random() < 0.004 ? 0.35 : THREE.MathUtils.lerp(flashFlicker, 1, 1 - Math.exp(-dt * 20));
  flash.intensity = flashOn ? 40 * flashFlicker : 0;
  flashRig.updateMatrixWorld(true);

  workKey.intensity = workOn ? 2.6 : 0;
  if (creature) { const cp = creature.object.position; workKey.target.position.set(cp.x, 1.4, cp.z); workKey.position.set(cp.x - 3.4, 3, cp.z + 6.4); }
  workFill.intensity = workOn ? 0.55 : 0;

  let near = 0;
  if (creature) near = creature.update(dt, ctx()).near;

  const fp = flash.getWorldPosition(new THREE.Vector3());
  const fd = flash.target.getWorldPosition(new THREE.Vector3()).sub(fp).normalize();
  room.update(dt, time, { position: fp, dir: fd, angle: flash.angle, on: flashOn ? flashFlicker : 0 });

  post.render(time, near);
}
frame();
