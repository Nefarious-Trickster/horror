import * as THREE from 'three';
import { Creature } from '../creature.js';
import { ACTION_LIST } from '../anim.js';
import { buildRoom, ROOM, CREATURE_SPOT } from '../room.js';
import { loadCreatureModel, creatureBlockers, creatureCtx } from './common.js';

// The creature study room: one ruined basement room and a panel that makes the creature perform.
export async function testRoom(game) {
  const { scene, player, params, ui } = game;
  scene.background = new THREE.Color(0x020203);
  scene.fog = new THREE.FogExp2(0x030304, 0.07);
  game.renderer.toneMappingExposure = 1.15;
  game.surface = 'concrete';
  const room = buildRoom(scene);
  player.colliders = room.colliders.concat([
    { minX: ROOM.min.x - 1, maxX: ROOM.min.x, minZ: ROOM.min.z - 1, maxZ: ROOM.max.z + 1 },
    { minX: ROOM.max.x, maxX: ROOM.max.x + 1, minZ: ROOM.min.z - 1, maxZ: ROOM.max.z + 1 },
    { minX: ROOM.min.x - 1, maxX: ROOM.max.x + 1, minZ: ROOM.min.z - 1, maxZ: ROOM.min.z },
    { minX: ROOM.min.x - 1, maxX: ROOM.max.x + 1, minZ: ROOM.max.z, maxZ: ROOM.max.z + 1 },
  ]);

  // inspection light
  const workKey = new THREE.DirectionalLight(0xffffff, 0);
  workKey.castShadow = true; workKey.shadow.mapSize.set(2048, 2048);
  Object.assign(workKey.shadow.camera, { left: -3, right: 3, top: 4, bottom: -3, near: 0.5, far: 16 });
  workKey.shadow.bias = -0.0004;
  const workFill = new THREE.HemisphereLight(0xdde4ff, 0x2a2420, 0);
  scene.add(workKey, workKey.target, workFill);
  let workOn = params.has('work');

  // player start, facing the corner
  player.place(0.2, 3.2, 0, 0.02);
  const look = (x, y, z) => { const d = new THREE.Vector3(x, y, z).sub(new THREE.Vector3(player.pos.x, player.eye, player.pos.z)); player.yaw = Math.atan2(-d.x, -d.z); player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)); };
  look(CREATURE_SPOT.x, 1.6, CREATURE_SPOT.z); player.yaw += 0.12;
  if (params.has('cam')) { const [x, y, z] = params.get('cam').split(',').map(Number); player.pos.set(x, 0, z); player.eye = player.eyeCur = y; player.eyeOverride = y; }
  if (params.has('look')) look(...params.get('look').split(',').map(Number));
  game.flashlight.on = !params.has('noflash');

  const gltf = await loadCreatureModel((p) => game.onProgress?.(p));
  const c = Creature.spawn(gltf);
  c.object.position.set(CREATURE_SPOT.x, 0, CREATURE_SPOT.z);
  c.object.rotation.y = Math.atan2(0.2 - CREATURE_SPOT.x, 3.2 - CREATURE_SPOT.z) * 0.85;
  scene.add(c.object); c.object.updateMatrixWorld(true);
  const anim = c.attach({ colliders: room.colliders, bounds: ROOM, door: room.door });
  window.__creature = c;
  player.blockers = creatureBlockers(c);

  // action panel
  const panel = document.createElement('div'); panel.id = 'actions';
  panel.innerHTML = '<div class="title">CREATURE</div>';
  document.body.appendChild(panel);
  const play = (name) => { c.frozen = false; anim.play(name); };
  for (const [name, label, key] of ACTION_LIST) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.action = name; b.innerHTML = `<kbd>${key}</kbd>${label}`;
    b.addEventListener('click', (e) => { e.stopPropagation(); play(name); b.blur(); });
    panel.appendChild(b);
  }
  anim.onAction = (n) => { for (const b of panel.querySelectorAll('button')) b.classList.toggle('on', b.dataset.action === n); };
  anim.onAction('idle');
  if (params.has('noui')) panel.hidden = true;
  ui.objective('Creature study: use the panel (or keys 1–0, R) to make it perform. F flashlight · L inspection light · P freeze.');
  setTimeout(() => ui.objective(null), 12000);

  if (params.has('act')) anim.play(params.get('act'));
  if (params.has('t')) { const T = parseFloat(params.get('t')); for (let i = 0; i < T * 30; i++) { c.update(1 / 30, creatureCtx(game)); room.door.update(1 / 30, 0); } }
  if (params.has('freeze')) c.frozen = true;

  return {
    look: 'horror',
    update(dt, t) {
      const inp = game.input;
      if (inp.wasPressed('KeyL')) workOn = !workOn;
      if (inp.wasPressed('KeyP')) c.frozen = !c.frozen;
      for (const [name, , key] of ACTION_LIST) if (inp.wasPressed(/\d/.test(key) ? 'Digit' + key : 'Key' + key)) play(name);
      const cp = c.object.position;
      workKey.intensity = workOn ? 2.6 : 0; workFill.intensity = workOn ? 0.55 : 0;
      workKey.target.position.set(cp.x, 1.4, cp.z); workKey.position.set(cp.x - 3.4, 3, cp.z + 6.4);
      const r = c.update(dt, creatureCtx(game));
      game.fear = r.near;
      player.shake = Math.max(player.shake, anim.shake);
      const fp = game.flashlight.light.getWorldPosition(new THREE.Vector3());
      const fd = game.flashlight.light.target.getWorldPosition(new THREE.Vector3()).sub(fp).normalize();
      room.update(dt, t, { position: fp, dir: fd, angle: game.flashlight.light.angle, on: game.flashlight.on ? game.flashlight.flicker : 0 });
    },
    dispose() { panel.remove(); },
  };
}
