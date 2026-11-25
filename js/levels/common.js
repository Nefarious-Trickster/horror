import { Creature } from '../creature.js';

// The page may point at another copy of the model (e.g. the JSON .gltf form) with <meta name="creature-model">.
export function creatureModelUrl() {
  const meta = document.querySelector('meta[name="creature-model"]')?.content;
  return meta ? new URL(meta, document.baseURI).href : new URL('../../assets/creature.glb', import.meta.url).href;
}
export function loadCreatureModel(onProgress) { return Creature.loadShared(creatureModelUrl(), onProgress); }

// circles the player collides with, following the creature's body as it moves (and crawls)
export function creatureBlockers(c) {
  const parts = [[c.bone.root, 0.45], [c.bone.hips, 0.5], [c.bone.upperChest, 0.45], [c.bone.head, 0.3]];
  const v = { x: 0, z: 0 };
  return () => parts.map(([b, r]) => { const p = b.getWorldPosition(b.position.clone()); return { x: p.x, z: p.z, r }; });
}

// context object the creature needs each frame
export function creatureCtx(game) {
  return { camera: game.camera, flashlight: game.flashlight.light, flashlightOn: game.flashlight.on, flashlightIntensity: game.flashlight.intensityFactor };
}

// ?cam=x,y,z&look=x,y,z places the camera (used for screenshots and debugging)
export function applyDebugCamera(game) {
  const { params, player } = game;
  if (params.has('cam')) { const [x, y, z] = params.get('cam').split(',').map(Number); player.pos.set(x, 0, z); player.eye = player.eyeCur = y; player.eyeOverride = y; }
  if (params.has('look')) {
    const [x, y, z] = params.get('look').split(',').map(Number);
    const dx = x - player.pos.x, dy = y - player.eye, dz = z - player.pos.z;
    player.yaw = Math.atan2(-dx, -dz); player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }
}
