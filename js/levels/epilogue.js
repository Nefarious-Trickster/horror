// EPILOGUE: one for each ending, played, not read.
//   recaptured  your first morning as lead on C-14, in Wing C. Someone has put the chairs in rows.
//   quiet       the same morning; it has not moved in nine days.
//   mercy       dawn on the hillside above the mine: the burial nobody else attends.
//   longdark    months later, at dusk, with a search team: three hikers are missing.
//   lantern     you lead it out into the morning; then, much later, the camera in Cell A.
//   replacement weeks later, from inside Cell B.
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { Creature } from '../creature.js';
import { buildLab, LAB } from '../lab/architecture.js';
import { loadEnvironment, pbr } from '../engine/assets.js';
import { loadCreatureModel, creatureCtx } from './common.js';
import { sfx } from '../engine/game.js';
import { save } from '../save.js';
import { labCoat, noise3, rng } from './mine.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const TITLES = { recaptured: 'RECAPTURED', quiet: 'RECAPTURED', mercy: 'THE LAMP\'S MERCY', longdark: 'THE LONG DARK', lantern: 'LANTERN', replacement: 'REPLACEMENT' };

export async function epilogue(game, opts = {}) {
  const ending = opts.ending || game.params.get('ending') || save.get('ending') || 'recaptured';
  const part = opts.part || +(game.params.get('part') || 1);
  game.flashlight.on = false;
  const outdoors = ending === 'mercy' || ending === 'longdark' || (ending === 'lantern' && part === 1);
  window.__epi = { game, ending, part, use: (re) => { const it = game.interact.items.find((i) => i.enabled() && re.test(typeof i.label === 'function' ? i.label() : i.label)); if (it) it.onUse(it); return !!it; } };
  const level = outdoors ? await hillside(game, ending) : await wingC(game, ending, part);
  return { look: ending === 'recaptured' || ending === 'quiet' ? 'clinical' : 'horror', ownFade: true, ...level };
}

// ------------------------------------------------------------------ shared
function narrator() {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;z-index:30;display:grid;place-items:center;pointer-events:none;opacity:0;transition:opacity 1.4s;padding:16px';
  el.innerHTML = '<div style="max-width:min(640px,92vw);text-align:center;font:300 clamp(17px,2.4vw,22px)/1.7 \'IBM Plex Sans\',system-ui,sans-serif;color:#dfe6e6;letter-spacing:0.02em;text-shadow:0 0 12px #000"></div>';
  document.body.appendChild(el);
  const t = el.firstChild;
  return {
    async show(text, hold) { hold ??= Math.max(4, text.length * 0.06); t.textContent = text; el.style.opacity = 1; await new Promise((r) => setTimeout(r, hold * 1000)); el.style.opacity = 0; await new Promise((r) => setTimeout(r, 1500)); },
    dispose() { el.remove(); },
  };
}
async function finish(game, ending, narr) {
  const { ui } = game;
  save.set('epilogueSeen', ending);
  await ui.fadeTo(1, 3);
  sfx.setAmbience('none', 0, 3); sfx.setTension(0); sfx.heartbeat(0);
  await ui.card(TITLES[ending] || '', 'an ending', 5);
  await ui.card('THE TALL ONE', 'thank you for playing', 4.5);
  narr?.dispose();
  location.href = location.pathname;
}
// a person, plainly: trousers, a lab coat, hands, a head. Walks with userData.walk(speed, dt).
function person({ seed = 3, coat = true } = {}) {
  const r = rng(seed);
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(0xc89c7c).offsetHSL(0, 0, (r() - 0.5) * 0.2), roughness: 0.6 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 0.8 });
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.1, 0.9, 0); g.add(hip);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.86, 10), cloth); leg.position.y = -0.43; hip.add(leg);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.26), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 })); shoe.position.set(0, -0.87, 0.05); hip.add(shoe);
    legs.push(hip);
  }
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.6, 12), cloth); torso.scale.z = 0.45; torso.position.y = 1.2; g.add(torso);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.12, 8), skin); neck.position.y = 1.55; g.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), skin); head.scale.set(0.9, 1.1, 1); head.position.y = 1.7; g.add(head);
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair); hairCap.position.copy(head.position).add(V(0, 0.015, -0.01)); hairCap.scale.set(0.92, 1.1, 1.04); g.add(hairCap);
  if (coat) { const c = labCoat({ seed }); c.position.set(0, 1.5, 0); c.children[0].rotation.set(0, 0, 0); g.add(c); }
  for (const s of [-1, 1]) { const h = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), skin); h.position.set(s * 0.23, 0.82, 0.02); h.scale.set(0.8, 1.3, 0.6); g.add(h); }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  let ph = 0;
  g.userData.walk = (speed, dt) => { ph += dt * speed * 5.5; const a = Math.sin(ph) * 0.45 * clamp(speed, 0, 1); legs[0].rotation.x = a; legs[1].rotation.x = -a; g.children.forEach((c) => { if (c !== legs[0] && c !== legs[1]) c.position.y += 0; }); };
  g.userData.head = head;
  g.userData.dynamic = true;
  return g;
}
// walks a group along points at a speed; resolves on arrival
function walkTo(d, obj, pts, speed = 1.2, face = true) {
  let i = 0;
  return d.until(() => {
    const dt = d.dtLast ?? 1 / 60;
    if (i >= pts.length) { obj.userData.walk?.(0, dt); return true; }
    const [x, z] = pts[i], p = obj.position, dx = x - p.x, dz = z - p.z, dd = Math.hypot(dx, dz);
    if (dd < 0.08) { i++; return false; }
    const st = Math.min(dd, speed * dt);
    p.x += (dx / dd) * st; p.z += (dz / dd) * st;
    if (face) obj.rotation.y += ((Math.atan2(dx, dz) - obj.rotation.y + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 5);
    obj.userData.walk?.(speed, dt);
    obj.userData.onMove?.();
    return false;
  });
}

// ------------------------------------------------------------------ the hillside above the mine
async function hillside(game, ending) {
  const { scene, player, ui, director: d, interact, renderer } = game;
  const say = (who, text, dur) => ui.say(who, text, dur);
  const narr = narrator();
  const night = ending === 'longdark';
  d.every((dt) => { d.dtLast = dt; });
  renderer.toneMappingExposure = night ? 1.25 : 1.1;
  game.camera.far = 600; game.camera.updateProjectionMatrix(); // the sky and the far hills

  // terrain: the hill climbs north to a ridge, the valley falls away south toward the road
  const H = (x, z) => {
    let h = z * 0.13 + Math.sin(x * 0.045) * 1.6 + Math.cos(z * 0.035 + x * 0.02) * 2.2;
    h += noise3(x * 0.07, 0.3, z * 0.07) * 1.3 + noise3(x * 0.23, 1.7, z * 0.23) * 0.25;
    return h - Math.max(0, 9 - Math.hypot(x, z + 2)) * 0.12; // the yard round the headframe is levelled
  };
  const terrain = new THREE.PlaneGeometry(300, 300, 150, 150); terrain.rotateX(-Math.PI / 2);
  { const p = terrain.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, H(p.getX(i), p.getZ(i))); terrain.computeVertexNormals(); }
  const grass = (() => { try { return pbr('aerial_grass_rock', { repeat: [55, 55] }); } catch { return {}; } })();
  const groundMat = new THREE.MeshStandardMaterial({ ...grass, color: night ? 0x56605a : 0x8f9583, roughness: 1 });
  const ground = new THREE.Mesh(terrain, groundMat); ground.receiveShadow = true; scene.add(ground);

  // paths: the track down the valley, and the footpath up to the ridge
  const TRACK = [[2, -4], [6, -16], [12, -34], [16, -60], [18, -110]];
  const PATH = [[0, 4], [-3, 14], [-4, 24], [-2, 38], [2, 48], [3, 58]];
  const distTo = (x, z, pl) => { let m = 1e9; for (let i = 0; i < pl.length - 1; i++) { const [ax, az] = pl[i], [bx, bz] = pl[i + 1]; const vx = bx - ax, vz = bz - az, t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1); m = Math.min(m, Math.hypot(x - ax - vx * t, z - az - vz * t)); } return m; };
  {
    const strip = (pl, w, color) => {
      const pos = [];
      for (let i = 0; i < pl.length - 1; i++) {
        const [ax, az] = pl[i], [bx, bz] = pl[i + 1], n = Math.ceil(Math.hypot(bx - ax, bz - az) / 1.5);
        const nx = -(bz - az), nz = bx - ax, nl = Math.hypot(nx, nz);
        for (let k = 0; k < n; k++) {
          const t0 = k / n, t1 = (k + 1) / n, P = (t) => [ax + (bx - ax) * t, az + (bz - az) * t];
          const [x0, z0] = P(t0), [x1, z1] = P(t1), ox = (nx / nl) * w / 2, oz = (nz / nl) * w / 2;
          const q = [[x0 - ox, z0 - oz], [x0 + ox, z0 + oz], [x1 + ox, z1 + oz], [x1 - ox, z1 - oz]].map(([x, z]) => [x, H(x, z) + 0.04, z]);
          pos.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]);
        }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 })); m.receiveShadow = true; scene.add(m);
    };
    strip(TRACK, 3.6, night ? 0x2e2c28 : 0x6e665a); strip(PATH, 1.1, night ? 0x2b2722 : 0x5e5446);
  }
  const GRAVE = [-6.2, 24.5], TENT = [-4.6, 39.5];
  const clear = (x, z) => distTo(x, z, TRACK) < 6 || distTo(x, z, PATH) < 4 || Math.hypot(x, z + 1) < 13 || Math.hypot(x, z + 15) < 7 || Math.hypot(x - GRAVE[0], z - GRAVE[1]) < 7 || Math.hypot(x - TENT[0], z - TENT[1]) < 8;
  // pines: dense forest down the slopes, thinning toward the ridge; the treeline closes in at night
  {
    const r = rng(night ? 7 : 3);
    const fol = mergeCones(), trunkG = new THREE.CylinderGeometry(0.12, 0.2, 2.2, 6); trunkG.translate(0, 1.1, 0);
    const N = 900, folM = new THREE.MeshStandardMaterial({ color: night ? 0x0f1812 : 0x22301f, roughness: 0.95 }), trM = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 1 });
    const fi = new THREE.InstancedMesh(fol, folM, N), ti = new THREE.InstancedMesh(trunkG, trM, N);
    fi.castShadow = ti.castShadow = true; fi.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    let n = 0;
    for (let tries = 0; tries < 9000 && n < N; tries++) {
      const x = (r() - 0.5) * 240, z = (r() - 0.5) * 240;
      if (clear(x, z)) continue;
      const dens = z > 52 ? 0.15 : 0.8 + (Math.abs(x) > 20 ? 0.2 : 0);
      if (r() > dens) continue;
      const k = 0.7 + r() * 0.8;
      q.setFromAxisAngle(V(0, 1, 0), r() * 6.28); s.set(k, k * (0.9 + r() * 0.4), k);
      m.compose(V(x, H(x, z) - 0.2, z), q, s); fi.setMatrixAt(n, m); ti.setMatrixAt(n, m);
      if (Math.hypot(x, z - 20) < 45) player.colliders.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3 });
      n++;
    }
    fi.count = ti.count = n; fi.userData.dynamic = ti.userData.dynamic = true;
    scene.add(fi, ti);
  }
  // rocks
  { const rm = new THREE.MeshStandardMaterial({ color: 0x5c5a55, roughness: 1 }); const r = rng(11); for (let k = 0; k < 40; k++) { const x = (r() - 0.5) * 80, z = (r() - 0.3) * 90; if (distTo(x, z, PATH) < 2 || distTo(x, z, TRACK) < 3) continue; const g = new THREE.DodecahedronGeometry(0.4 + r() * 1.1, 0); const o = new THREE.Mesh(g, rm); o.position.set(x, H(x, z), z); o.scale.y = 0.5 + r() * 0.4; o.rotation.set(r(), r() * 6, r()); o.castShadow = o.receiveShadow = true; scene.add(o); } }
  // the headframe over the shaft, and the hoist house you come out of
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a3c3e, metalness: 0.7, roughness: 0.7 }), rust = new THREE.MeshStandardMaterial({ color: 0x5a3a26, metalness: 0.4, roughness: 0.9 });
  const HH = { x0: -3.5, x1: 3.5, z0: -9.5, z1: -3, h: 3.4 };
  let y0 = -1e9; for (let x = HH.x0; x <= HH.x1; x += 0.5) for (let z = HH.z0; z <= HH.z1; z += 0.5) y0 = Math.max(y0, H(x, z)); y0 += 0.03;
  player.groundAt = (x, z) => (x > HH.x0 && x < HH.x1 && z > HH.z0 && z < HH.z1 + 0.25 ? y0 : H(x, z));
  {
    const g = new THREE.Group(); g.position.set(0, H(0, -15), -15); scene.add(g);
    const leg = (a, b, rad = 0.12, mat = steel) => { const dd = new THREE.Vector3().subVectors(b, a), L = dd.length(); const c = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, L, 8), mat); c.position.copy(a).add(b).multiplyScalar(0.5); c.quaternion.setFromUnitVectors(V(0, 1, 0), dd.normalize()); c.castShadow = true; g.add(c); };
    const top = 15;
    for (const [x, z] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) leg(V(x, 0, z), V(x * 0.35, top, z * 0.35));
    for (let y = 3; y < top; y += 3) { const k = 1 - (y / top) * 0.65; for (const [a, b] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) leg(V(a[0] * 2.2 * k, y, a[1] * 2.2 * k), V(b[0] * 2.2 * k, y, b[1] * 2.2 * k), 0.06, rust); }
    leg(V(0, 0, -9), V(0, top - 1, -0.8), 0.18); leg(V(-1.5, 0, -9), V(-0.5, top - 1, -0.8), 0.1, rust);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.12, 8, 30), steel); wheel.position.set(0, top + 0.6, 0); wheel.rotation.y = Math.PI / 2; wheel.castShadow = true; g.add(wheel);
  }
  // hoist house: a concrete box with a door on its north side
  {
    const g = []; const yb = y0 - 1.4;
    const wall = (x0, x1, z0, z1, h = HH.h + 1.4) => { const b = new THREE.BoxGeometry(x1 - x0, h, z1 - z0); b.translate((x0 + x1) / 2, yb + h / 2, (z0 + z1) / 2); g.push(b); player.colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 }); };
    wall(HH.x0, HH.x1, HH.z0 - 0.2, HH.z0); wall(HH.x0 - 0.2, HH.x0, HH.z0, HH.z1); wall(HH.x1, HH.x1 + 0.2, HH.z0, HH.z1);
    wall(HH.x0, -0.8, HH.z1, HH.z1 + 0.2); wall(0.8, HH.x1, HH.z1, HH.z1 + 0.2);
    const roof = new THREE.BoxGeometry(7.6, 0.3, 7); roof.translate(0, y0 + HH.h + 0.15, -6.25); g.push(roof);
    const lint = new THREE.BoxGeometry(1.6, 0.8, 0.2); lint.translate(0, y0 + 3.0, HH.z1 + 0.1); g.push(lint);
    const fl = new THREE.BoxGeometry(7, 1.4, 6.5); fl.translate(0, y0 - 0.7, -6.25); g.push(fl);
    const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
    void 0;
    const conc = (() => { try { return pbr('Concrete036', { repeat: [2, 2] }); } catch { return {}; } })();
    const m = new THREE.Mesh(mergeGeometries(g.map((x) => x.toNonIndexed())), new THREE.MeshStandardMaterial({ ...conc, color: 0x8a867c, roughness: 1 })); m.castShadow = m.receiveShadow = true; scene.add(m);
    // the hoist doors on the south wall, inside
    const doorM = new THREE.MeshStandardMaterial({ color: 0x5a5e60, metalness: 0.5, roughness: 0.6 });
    for (const s of [-1, 1]) { const dd = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.6, 0.06), doorM); dd.position.set(s * 1.25, y0 + 1.3, HH.z0 + 0.06); scene.add(dd); }
    const inside = new THREE.PointLight(0xfff0d8, night ? 0 : 3, 8, 1.8); inside.position.set(0, y0 + 3, -6.5); scene.add(inside);
  }

  // sky dome
  const sun = V(0.8, 0.12, -0.25).normalize();
  const skyU = {
    uTop: { value: new THREE.Color(night ? 0x020309 : 0x1d2c4c) }, uHor: { value: new THREE.Color(night ? 0x1c2840 : 0xd08a5e) },
    uGround: { value: new THREE.Color(night ? 0x020203 : 0x2a2420) }, uSun: { value: sun.clone() }, uSunCol: { value: new THREE.Color(night ? 0x000000 : 0xffb070) },
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(380, 32, 16), new THREE.ShaderMaterial({
    uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vD; void main() { vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uTop, uHor, uGround, uSun, uSunCol; varying vec3 vD;
      void main() { float y = vD.y; vec3 c = mix(uHor, uTop, smoothstep(0.0, 0.45, y)); c = mix(uGround, c, smoothstep(-0.12, 0.02, y));
        float s = max(dot(normalize(vD), normalize(uSun)), 0.0); c += uSunCol * (pow(s, 900.0) * 6.0 + pow(s, 10.0) * 0.45);
        gl_FragColor = vec4(c, 1.0); }`,
  }));
  sky.userData.dynamic = true; sky.renderOrder = -1; scene.add(sky);
  if (night) { // stars
    const n = 900, pos = new Float32Array(n * 3); const r = rng(5);
    for (let i = 0; i < n; i++) { const a = r() * 6.28, b = Math.acos(r() * 0.9); pos.set([Math.cos(a) * Math.sin(b) * 360, Math.cos(b) * 360, Math.sin(a) * Math.sin(b) * 360], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const st = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8090a0, size: 1.2, sizeAttenuation: false, fog: false })); st.userData.dynamic = true; sky.add(st);
  }
  scene.background = null;
  scene.fog = new THREE.FogExp2(night ? 0x070a10 : 0x9a8a84, night ? 0.03 : 0.009);
  const hemi = new THREE.HemisphereLight(night ? 0x2c3a56 : 0x9aa6c4, night ? 0x080808 : 0x4a3e30, night ? 0.5 : 1.6); scene.add(hemi);
  const sunL = new THREE.DirectionalLight(night ? 0x7080a8 : 0xffb47a, night ? 0.25 : 1.4);
  sunL.castShadow = true; sunL.shadow.mapSize.set(2048, 2048); Object.assign(sunL.shadow.camera, { left: -35, right: 35, top: 35, bottom: -35, near: 1, far: 200 }); sunL.shadow.bias = -0.0006;
  scene.add(sunL, sunL.target);
  game.flashlight.base = 105; game.flashlight.light.distance = 30;
  game.batch(scene);
  sfx.setAmbience('construction', night ? 0.5 : 0.7, 3); sfx.setReverb('outside');

  const gltf = await loadCreatureModel((p) => game.onProgress?.(p));
  const B = Creature.spawn(gltf); B.object.scale.setScalar(0.93); scene.add(B.object);
  B.attach({ colliders: [], bounds: { min: V(-140, 0, -140), max: V(140, 0, 140) } });
  B.object.visible = false;
  const groundB = () => { B.object.position.y = H(B.object.position.x, B.object.position.z); };

  let sunRise = 0;
  const update = (dt, t) => {
    sky.position.copy(game.camera.position);
    if (!night) { sunRise = Math.min(1, sunRise + dt / 240); sun.set(0.8, 0.12 + sunRise * 0.18, -0.25).normalize(); skyU.uSun.value.copy(sun); skyU.uHor.value.setHex(0xd08a5e).lerp(new THREE.Color(0xe0b08a), sunRise); sunL.intensity = 2.0 + sunRise * 1.6; }
    sunL.position.copy(player.pos).addScaledVector(night ? V(-0.3, 0.8, 0.4).normalize() : sun, 80); sunL.target.position.copy(player.pos);
    if (B.object.visible) { groundB(); B.update(dt, creatureCtx(game)); }
    game.fear = 0;
  };

  // ---------------------------------------------------------------- the scripts
  if (ending === 'mercy') {
    // the response team's vans on the track, the grave dug on the hillside, nobody else
    const vanM = new THREE.MeshStandardMaterial({ color: 0xd8d8d2, roughness: 0.5 }), dark = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.4 });
    const vans = [[5.5, -13], [9.5, -24]].map(([x, z]) => {
      const g = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.1, 5), vanM); body.position.y = 1.35; g.add(body);
      const win = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 0.1), dark); win.position.set(0, 1.9, 2.5); g.add(win);
      for (const [a, b] of [[-0.95, 1.6], [0.95, 1.6], [-0.95, -1.6], [0.95, -1.6]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.25, 14), dark); w.rotation.z = Math.PI / 2; w.position.set(a, 0.36, b); g.add(w); }
      const tl = new THREE.PointLight(0xff2010, 0.8, 5, 2); tl.position.set(0, 0.9, -2.7); g.add(tl);
      g.position.set(x, H(x, z), z); g.rotation.y = Math.atan2(TRACK[3][0] - x, TRACK[3][1] - z); g.userData.dynamic = true; scene.add(g); g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      player.colliders.push({ minX: x - 1.6, maxX: x + 1.6, minZ: z - 2.8, maxZ: z + 2.8, van: true });
      return g;
    });
    // the grave: a mound of turned earth, a spade left in it, a stake with his badge if you kept it
    const earth = new THREE.MeshStandardMaterial({ color: 0x3a2c20, roughness: 1 });
    const mound = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), earth); mound.scale.set(1.1, 0.35, 2.4); mound.position.set(GRAVE[0], H(...GRAVE), GRAVE[1]); mound.rotation.y = 0.3; mound.receiveShadow = mound.castShadow = true; scene.add(mound);
    const spade = new THREE.Group(); { const h = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 6), new THREE.MeshStandardMaterial({ color: 0x5a4028 })); h.position.y = 0.55; spade.add(h); const bl = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.28, 0.02), steel); bl.position.y = -0.05; spade.add(bl); }
    spade.position.set(GRAVE[0] + 1.3, H(GRAVE[0] + 1.3, GRAVE[1] - 1.2) + 0.05, GRAVE[1] - 1.2); spade.rotation.z = 0.25; scene.add(spade);
    const stake = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 0.06), new THREE.MeshStandardMaterial({ color: 0x6a5238, roughness: 1 })); stake.position.set(GRAVE[0], H(GRAVE[0], GRAVE[1] + 2.6) + 0.5, GRAVE[1] + 2.6); scene.add(stake);
    player.colliders.push({ minX: GRAVE[0] - 1, maxX: GRAVE[0] + 1, minZ: GRAVE[1] - 2.2, maxZ: GRAVE[1] + 2.2 });
    const hasBadge = !!save.get('badge');
    let badgeLeft = false, stayed = false;
    const badgeObj = new THREE.Group(); { const c = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.005), new THREE.MeshStandardMaterial({ color: 0xe8e4d8 })); const l = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.004, 4, 12), new THREE.MeshStandardMaterial({ color: 0x2850a0 })); l.position.y = 0.07; badgeObj.add(c, l); }
    badgeObj.position.copy(stake.position).add(V(0, 0.38, 0.04)); badgeObj.visible = false; scene.add(badgeObj);
    interact.add({ position: () => stake.position.clone().add(V(0, 0.3, 0)), reach: 2.2, size: 0.5, label: 'Hang his badge on the stake', enabled: () => hasBadge && !badgeLeft, onUse: () => { badgeLeft = true; badgeObj.visible = true; sfx.beep('click'); } });
    interact.add({ position: () => mound.position.clone().add(V(0, 0.4, 0)), reach: 3, size: 1.2, label: 'Stay a while longer', enabled: () => !stayed && atGrave, onUse: () => { stayed = true; } });
    let atGrave = false;
    const run = async () => {
      player.place(4.6, -9.0, Math.PI * 0.85, 0); ui.setFade(1);
      await narr.show('It takes a long time to stop moving. You stay with it until it does.', 5);
      ui.fadeTo(0, 4);
      await d.wait(2);
      await say('Response lead', 'We\'re done here, Doctor. The site\'s sealed. You coming down with us?', 4);
      await d.wait(1.5);
      await say('Response lead', '...Suit yourself. Someone\'ll be back for you at noon.', 3.4);
      ui.objective('Walk up the hill to the grave.');
      // the vans go, one after the other, down the valley and out of sight
      game.run(async () => {
        for (const [i, v] of vans.entries()) {
          await d.wait(i ? 3 : 1.5);
          const eng = sfx.loop('cage', v.position, 0.35);
          const box = player.colliders.find((c) => c.van && Math.abs((c.minX + c.maxX) / 2 - v.position.x) < 0.5); if (box) box.disabled = true;
          v.userData.onMove = () => { v.position.y = H(v.position.x, v.position.z); eng.setPosition(v.position); };
          await walkTo(d, v, TRACK.slice(i ? 3 : 2), 6);
          eng.stop(2); v.visible = false;
        }
      });
      await d.until(() => Math.hypot(player.pos.x - GRAVE[0], player.pos.z - GRAVE[1]) < 4.5);
      atGrave = true;
      ui.objective(hasBadge && !badgeLeft ? 'Stay a while. (His badge is in your pocket.)' : 'Stay a while.');
      await d.until(() => stayed);
      ui.objective(null);
      player.frozen = true; player.eyeOverride = 0.9; player.lookAt(V(GRAVE[0] + 30, H(...GRAVE) + 2, GRAVE[1] - 8), 0.6);
      sunRise = Math.max(sunRise, 0.4);
      await d.wait(4);
      await narr.show('They bury what is left of it in the hillside above the mine, in a hole the response team digs and then leaves.', 6);
      await d.wait(2);
      if (badgeLeft) await narr.show('The badge turns slowly on its lanyard. T. LIND. The photograph is scratched out, so it could be anyone.', 6);
      await narr.show('Nobody else comes. You stand there until the vans have gone, and then a while longer.', 6);
      await d.wait(5);
      await finish(game, ending, narr);
    };
    game.run(run);
    return { update, dispose: () => narr.dispose() };
  }

  if (ending === 'longdark') {
    // months later, at dusk: a search team on the hill. A tent with nobody in it. A phone in the grass.
    game.flashlight.on = true;
    const can = new THREE.MeshStandardMaterial({ color: 0x2e5a3a, roughness: 0.9, side: THREE.DoubleSide });
    const tent = new THREE.Group();
    { const L = 2.2, W = 1.8, Ht = 1.2; for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(L, Math.hypot(W / 2, Ht)), can); p.rotation.set(0, Math.PI / 2, 0); p.rotateX(s * (Math.PI / 2 - Math.atan2(Ht, W / 2))); p.position.set(s * W / 4, Ht / 2, 0); tent.add(p); } }
    tent.position.set(TENT[0], H(...TENT), TENT[1]); tent.rotation.set(0.15, 0.6, 0.1); scene.add(tent);
    player.colliders.push({ minX: TENT[0] - 1.1, maxX: TENT[0] + 1.1, minZ: TENT[1] - 1.1, maxZ: TENT[1] + 1.1 });
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 0.25), new THREE.MeshStandardMaterial({ color: 0x7a2a1a, roughness: 0.8 })); pack.position.set(TENT[0] + 1.6, H(TENT[0] + 1.6, TENT[1] - 0.4) + 0.2, TENT[1] - 0.4); pack.rotation.set(1.3, 0.4, 0); scene.add(pack);
    const phonePos = V(TENT[0] + 0.6, H(TENT[0] + 0.6, TENT[1] - 2.1) + 0.03, TENT[1] - 2.1);
    const phone = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.008, 0.15), new THREE.MeshStandardMaterial({ color: 0x0a0a0c, emissive: 0x6080a0, emissiveIntensity: 0.6, roughness: 0.2 })); phone.position.copy(phonePos); phone.rotation.y = 0.7; phone.userData.dynamic = true; scene.add(phone);
    const glow = new THREE.PointLight(0x8aa0c0, 0.4, 1.5, 2); glow.position.copy(phonePos).add(V(0, 0.1, 0)); scene.add(glow);
    // the photograph on the phone, taken from by the tent, looking up the hill to the treeline
    const photoCam = new THREE.PerspectiveCamera(55, 16 / 9, 0.05, 200);
    const shapeAt = V(TENT[0] + 9, 0, TENT[1] + 17); shapeAt.y = H(shapeAt.x, shapeAt.z);
    photoCam.position.set(TENT[0] + 0.5, H(...TENT) + 1.4, TENT[1] - 1.5); photoCam.lookAt(shapeAt.clone().add(V(-3, 1.6, 0)));
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:25;display:none;place-items:center;background:rgba(0,0,0,0.75)';
    overlay.innerHTML = '<div style="width:min(92vw,58vh);aspect-ratio:9/16;background:#050608;border-radius:26px;border:2px solid #1c1e22;display:grid;grid-template-rows:auto 1fr auto;padding:14px 10px;box-shadow:0 0 40px #000"><div style="font:500 11px/1 \'IBM Plex Mono\',monospace;color:#9aa;letter-spacing:.15em;padding:4px 8px">IMG_2207 · 21:14 · 3 SEP</div><canvas style="width:100%;align-self:center;filter:contrast(1.15) saturate(.7) brightness(1.25)"></canvas><div style="font:500 11px/1.4 \'IBM Plex Mono\',monospace;color:#9aa;letter-spacing:.08em;padding:6px 8px">LAST PHOTO TAKEN ON THIS DEVICE<br>[E] PUT IT DOWN</div></div>';
    document.body.appendChild(overlay);
    const shot = overlay.querySelector('canvas'); shot.width = 480; shot.height = 270;
    function takePhoto() {
      const rt = new THREE.WebGLRenderTarget(480, 270); const was = [B.object.visible, B.object.position.clone(), B.object.rotation.y, game.flashlight.on];
      B.object.position.copy(shapeAt); B.object.rotation.y = Math.atan2(photoCam.position.x - shapeAt.x, photoCam.position.z - shapeAt.z) + Math.PI; B.object.visible = true; B.anim.play('faceWall', { yaw: B.object.rotation.y }); for (let i = 0; i < 40; i++) B.update(1 / 30, creatureCtx(game));
      const flashL = new THREE.PointLight(0xffffff, 40, 30, 1.6); flashL.position.copy(photoCam.position); scene.add(flashL); game.flashlight.on = false; game.flashlight.update(0, game.camera, 0);
      renderer.setRenderTarget(rt); renderer.render(scene, photoCam); renderer.setRenderTarget(null);
      const px = new Uint8Array(480 * 270 * 4); renderer.readRenderTargetPixels(rt, 0, 0, 480, 270, px);
      const img = shot.getContext('2d').createImageData(480, 270);
      for (let y = 0; y < 270; y++) for (let x = 0; x < 480; x++) { const s = ((269 - y) * 480 + x) * 4, t2 = (y * 480 + x) * 4; for (let c = 0; c < 3; c++) img.data[t2 + c] = Math.min(255, Math.pow(px[s + c] / 255, 1 / 2.2) * 255 * 1.1 + (Math.random() - 0.5) * 18); img.data[t2 + 3] = 255; }
      shot.getContext('2d').putImageData(img, 0, 0);
      scene.remove(flashL); rt.dispose();
      [B.object.visible] = was; B.object.position.copy(was[1]); B.object.rotation.y = was[2]; game.flashlight.on = was[3];
    }
    let reading = false, picked = false;
    interact.add({ position: () => phone.position, reach: 1.9, size: 0.35, label: 'Pick up the phone', enabled: () => !picked, onUse: () => { picked = true; phone.visible = false; glow.intensity = 0; takePhoto(); overlay.style.display = 'grid'; reading = true; game.input.unlock(); } });
    addEventListener('keydown', (e) => { if (reading && ['KeyE', 'Escape', 'Space', 'Enter'].includes(e.code)) { reading = false; overlay.style.display = 'none'; game.input.lock(); } });
    overlay.addEventListener('click', () => { if (reading) { reading = false; overlay.style.display = 'none'; game.input.lock(); } });
    const run = async () => {
      player.place(1.5, 6, Math.PI, 0); ui.setFade(1);
      await narr.show('It goes up the shaft without you.', 4);
      await narr.show('Months later.', 3);
      ui.fadeTo(0, 3);
      await d.wait(1.5);
      await say('Search radio', 'Team two, check in.', 2.4);
      await say('Search radio', 'Team two. Nothing yet. We\'re above the old mine fence, following the footpath up.', 4.2);
      await say('Search radio', 'Copy. Three of them, remember. Two men and a woman, tent was green. Mind the shafts up there.', 4.8);
      ui.objective('Follow the footpath up the hill. Look for a green tent.');
      await d.until(() => Math.hypot(player.pos.x - TENT[0], player.pos.z - TENT[1]) < 7);
      sfx.setTension(0.25);
      await say('You', 'Team two. I\'ve got the tent. ...Nobody here.', 3);
      await say('Search radio', 'Anything else?', 2);
      ui.objective('Search the campsite.');
      await d.until(() => picked && !reading);
      ui.objective(null);
      await d.wait(1.5);
      await say('Search radio', 'Team two? You went quiet.', 2.6);
      // behind you, now, in the trees
      const f = player.forward(V(0, 0, 0)); f.y = 0; f.normalize();
      const at = player.pos.clone().addScaledVector(f, -14); at.y = H(at.x, at.z);
      B.object.position.copy(at); B.object.rotation.y = Math.atan2(f.x, f.z); B.anim.play('faceWall', { yaw: B.object.rotation.y }); B.object.visible = true;
      sfx.creatureCrack(at.clone().add(V(0, 1, 0)));
      await d.wait(1.2); sfx.creatureCrack(at.clone().add(V(0, 0.5, 0)));
      await d.until(() => { const p = B.object.position.clone().add(V(0, 1.6, 0)).sub(game.camera.position).normalize(); return game.camera.getWorldDirection(V(0, 0, 0)).dot(p) > 0.93; });
      sfx.setTension(0.6); sfx.heartbeat(90);
      await d.wait(3.5);
      game.flashlight.flicker = 0.1; await d.wait(0.3); game.flashlight.on = false; sfx.powerDown();
      await d.wait(2.5);
      B.object.visible = false; game.flashlight.on = true; sfx.heartbeat(0);
      await d.wait(1.6);
      await narr.show('At the edge of the picture, in the trees, a tall shape is standing with its back to the camera.', 6);
      await finish(game, ending, narr);
    };
    game.run(run);
    return { update, dispose: () => { narr.dispose(); overlay.remove(); } };
  }

  // lantern, part one: out of the hoist house into the morning, with it beside you
  const run = async () => {
    player.place(0, -7.5, Math.PI, 0); ui.setFade(1);
    B.object.position.set(1.4, y0, -8.6); B.anim.heading = Math.PI; B.object.visible = true; B.anim.play('idle', {});
    await narr.show('It does not become Lind again.', 4);
    ui.fadeTo(0, 3);
    await d.wait(2);
    await say('Halloran (radio)', 'Doctor? I\'m at the gate. You\'re... both of you? Christ. Okay. Okay. Take your time.', 5);
    ui.objective('Lead it out. Up the footpath to the ridge.');
    // it follows, a few steps behind, looking at the ground, at the trees, at you
    let lastT = 0;
    const tick = d.every((dt) => {
      lastT -= dt;
      const p = B.object.position, dd = Math.hypot(player.pos.x - p.x, player.pos.z - p.z);
      if (lastT <= 0 && dd > 3.4) { lastT = 0.8; const back = player.forward(V(0, 0, 0)); back.y = 0; back.normalize(); B.anim.play('follow', { path: [{ x: player.pos.x - back.x * 2.4, z: player.pos.z - back.z * 2.4 }], mode: 'walk', speed: Math.min(1.5, 0.7 + dd * 0.12), gaze: Math.random() < 0.5 ? 'player' : 'wander' }); }
    });
    await d.until(() => player.pos.z > 4);
    sfx.creatureBreath(B.bone.head.getWorldPosition(V(0, 0, 0)), { intensity: 0.15 });
    await d.until(() => player.pos.z > 22);
    await say('Halloran (radio)', 'There are police at the gate, Doctor. A lot of police. They\'ve got Dr. Okafor in the back of a car.', 5);
    await d.until(() => player.pos.z > 50);
    ui.objective(null);
    tick();
    // at the ridge it stops. The sun is coming up. It turns its face away from it, and then, slowly, looks at you
    B.anim.play('follow', { path: [{ x: player.pos.x + 1.6, z: player.pos.z + 0.6 }], mode: 'walk', speed: 0.7, gaze: 'forward', onArrive: () => B.anim.play('shield', { from: player.pos.clone().add(V(30, 0, -8)), dur: 30 }) });
    player.lookAt(V(player.pos.x + 30, H(player.pos.x, player.pos.z) + 3, player.pos.z - 8), 0.5);
    sunRise = Math.max(sunRise, 0.5);
    await d.wait(8); player.releaseLook();
    B.anim.play('idle', { stare: true });
    await d.wait(4);
    await say('Lind', '...Rook.', 2.6);
    await d.wait(2);
    await narr.show('At the top of the shaft it stopped in the door of the car, and looked back at the dark, and then at you, and let you lead it out into the morning.', 7);
    await ui.fadeTo(1, 3);
    await narr.show('The hearings take a year. The LANTERN files are read into the record, page by page.', 5.5);
    await narr.show('Imani Okafor is taken out of the building in handcuffs. Site 41 is closed.', 5);
    await narr.show('Nobody remembers to switch off the camera in Cell A.', 4.5);
    narr.dispose();
    await game.load(epilogue, { ending: 'lantern', part: 2 });
  };
  game.run(run);
  return { update, dispose: () => narr.dispose() };
}
function mergeCones() {
  const parts = [[1.6, 2.6, 1.6], [1.25, 2.2, 3.0], [0.85, 1.8, 4.2]].map(([r, h, y]) => { const c = new THREE.ConeGeometry(r, h, 7); c.translate(0, y, 0); return c.toNonIndexed(); });
  const n = parts.reduce((a, g) => a + g.attributes.position.count, 0), pos = new Float32Array(n * 3); let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o); o += g.attributes.position.array.length; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
}

// ------------------------------------------------------------------ Wing C
async function wingC(game, ending, part) {
  const { scene, player, ui, director: d, interact, renderer } = game;
  const say = (who, text, dur) => ui.say(who, text, dur);
  const narr = narrator();
  d.every((dt) => { d.dtLast = dt; });
  game.camera.far = 80; game.camera.updateProjectionMatrix();
  RectAreaLightUniformsLib.init();
  const cctv = ending === 'lantern';
  renderer.toneMappingExposure = cctv ? 1.3 : 1.0;
  scene.background = new THREE.Color(0x0b0d0e);
  game.surface = 'tile';
  let P = {};
  const [env] = await Promise.all([loadEnvironment(renderer).catch(() => null), import('../lab/props.js').then((m) => { P = m; }).catch(() => {})]);
  if (env) { scene.environment = env; scene.environmentIntensity = cctv ? 0.03 : 0.3; }
  const lab = buildLab(scene);
  const colliders = [...lab.colliders];
  const make = (name, o = {}) => { try { if (typeof P[name] === 'function') return (name === 'sign' || name === 'floorDecal') ? P[name](o.text, o) : P[name](o); } catch (e) { console.warn(e); } return new THREE.Group(); };
  const place = (obj, x, z, rot = 0, y = 0) => { obj.position.set(x, y, z); obj.rotation.y = rot; scene.add(obj); const c = obj.userData?.collider; if (c && y === 0) { const sw = Math.abs(Math.sin(rot)) > 0.5, w = sw ? c.d : c.w, dd = sw ? c.w : c.d; colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - dd / 2, maxZ: z + dd / 2 }); } return obj; };
  const wallObj = (obj, x, y, z, rot) => { obj.position.set(x, y, z); obj.rotation.y = rot; scene.add(obj); return obj; };
  const R = { S: Math.PI, E: -Math.PI / 2, W: Math.PI / 2, N: 0 };
  const L = LAB.lab;
  // the cell doors are shut; everything else stands open
  for (const k of ['cellA', 'cellB']) { const s = LAB.doors[k]; const g = make('door', { w: s.w, h: 2.25, type: 'heavy' }); g.position.set(s.x, 0, s.z); scene.add(g); colliders.push({ minX: s.x - s.w / 2, maxX: s.x + s.w / 2, minZ: s.z - 0.12, maxZ: s.z + 0.12 }); }
  const consoleObj = place(make('controlConsole'), 0, -3.4, R.N);
  place(make('workstation', { monitors: 2, seed: 1 }), -6.45, 2.6, R.W); place(make('workstation', { monitors: 1, seed: 2 }), -6.45, 0.4, R.W);
  place(make('labBench', { length: 3 }), 1.8, 2.0, R.N); place(make('fumeHood'), -4.6, 5.5, R.S); place(make('specimenShelf'), -2.4, 5.7, R.S);
  place(make('surgicalTable'), 4.4, -0.6, R.N); place(make('lockerBank', { count: 4 }), 6.68, -3.7, R.E); place(make('serverRack'), 6.5, 4.8, R.E);
  place(make('officeChair'), 0.7, -2.4, Math.PI + 0.2);
  for (const [t, x, y, z, rot, o] of [['C-14 OBSERVATION', 0, 2.45, L.z0 + 0.16, 0, { w: 1.4, h: 0.3, style: 'room', sub: 'WING C · LAB 3' }], ['CELL A', -1.45, 2.45, L.z0 + 0.32, 0, { w: 0.7, h: 0.25, style: 'room', sub: 'C-14A' }],
    ['CELL B', 1.45, 2.45, L.z0 + 0.32, 0, { w: 0.7, h: 0.25, style: 'room', sub: ending === 'replacement' ? 'C-14C · A. ROOK' : 'C-14B' }], ['C-14 LEAD', 6.92, 2.45, 1.0, R.E, { w: 0.7, h: 0.25, style: 'room', sub: 'DR. A. ROOK' }]]) wallObj(make('sign', { text: t, ...o }), x, y, z, rot);
  wallObj(make('securityCamera'), 6.85, 2.95, 5.8, R.E - 0.6);
  // the lead's office (it was storage): a desk, and three chairs set out in a row, facing the wall
  const desk = place(make('workstation', { monitors: 1, seed: 7 }), 10.2, 0.6, R.E);
  const officeChairs = [[8.0, -0.9], [8.0, 0.2], [8.0, 1.3]].map(([x, z]) => place(make('officeChair', { seed: x + z }), x, z, R.W));
  const note = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.004, 0.3), new THREE.MeshStandardMaterial({ color: 0xf0ede4, roughness: 0.9 })); note.position.set(9.9, 0.78, 0.0); scene.add(note);
  // light: the lab's ceiling panels, the cell spots
  const rects = [];
  const addRect = (x, y, z, w, h, I) => { const r = new THREE.RectAreaLight(0xf3f7ff, I, w, h); r.position.set(x, y, z); r.lookAt(x, 0, z); r.userData.base = I; scene.add(r); rects.push(r); return r; };
  if (!cctv) { for (const x of [-3.5, 3.5]) for (const z of [-3, 3]) addRect(x, LAB.H - 0.02, z, 5, 4.2, 1.5); addRect(0, 2.68, 12.5, 2.2, 5, 1.6); addRect(0, 2.58, 7.5, 2.2, 2.2, 1.8); addRect(8.8, 2.78, 1.0, 2.8, 3.6, 1.4); }
  const cellSpots = {};
  for (const [k, c] of [['A', LAB.cellA], ['B', LAB.cellB]]) {
    const base = cctv ? (k === 'A' ? 1.6 : 0) : 9;
    const sp = new THREE.SpotLight(0xf6fbff, base, 0, 1.05, 0.6, 2); sp.position.set((c.x0 + c.x1) / 2, LAB.H - 0.1, (c.z0 + c.z1) / 2 + 0.5); sp.target.position.set((c.x0 + c.x1) / 2, 0, (c.z0 + c.z1) / 2);
    sp.castShadow = true; sp.shadow.mapSize.set(1024, 1024); sp.shadow.bias = -0.0005; sp.userData.base = base; scene.add(sp, sp.target); cellSpots[k] = sp;
    if (!cctv) addRect((c.x0 + c.x1) / 2, LAB.H - 0.02, (c.z0 + c.z1) / 2, 4, 3, 1.3);
  }
  const troffers = [];
  for (const x of [-4.8, -1.6, 1.6, 4.8]) for (const z of [-4.2, -1.2, 1.8, 4.6]) { const t = make('ceilingLightPanel', { w: 1.2, d: 0.6 }); t.position.set(x, LAB.H - 0.002, z); scene.add(t); t.userData.setLevel?.(cctv ? 0 : 1); troffers.push(t); }
  const cellTroffers = { A: [], B: [] };
  for (const [k, c] of [['A', LAB.cellA], ['B', LAB.cellB]]) for (const dx of [-1.4, 1.4]) { const t = make('ceilingLightPanel', { w: 0.6, d: 1.2 }); t.position.set((c.x0 + c.x1) / 2 + dx, LAB.H - 0.002, (c.z0 + c.z1) / 2); scene.add(t); t.userData.setLevel?.(cctv && k === 'B' ? 0 : cctv ? 0.25 : 1); cellTroffers[k].push(t); }
  if (cctv) { const night = new THREE.PointLight(0x40ff80, 0.6, 9, 2); night.position.set(0, 2.6, 0); scene.add(night); lab.M.ceiling && (lab.M.ceiling.emissiveIntensity = 0); }
  const setCell = (k, v) => { cellSpots[k].intensity = cellSpots[k].userData.base * v; cellTroffers[k].forEach((t) => t.userData.setLevel?.(v)); };
  game.batch(scene);
  player.colliders = colliders;
  sfx.setAmbience(cctv ? 'labDark' : 'lab', 0.8, 2); sfx.setReverb('lab');

  const gltf = await loadCreatureModel((p) => game.onProgress?.(p));
  const cellWorld = (c) => ({ colliders: [], bounds: { min: V(c.x0 + 0.45, 0, c.z0 + 0.45), max: V(c.x1 - 0.45, 0, L.z0 - 0.4) } });
  const A = Creature.spawn(gltf); A.object.position.set(-3.7, 0, -9.6); A.object.rotation.y = Math.PI; scene.add(A.object); A.attach(cellWorld(LAB.cellA)); A.anim.play('faceWall', { yaw: Math.PI });
  const creatures = [A];
  let B = null;
  if (ending !== 'replacement' && !cctv) { B = Creature.spawn(gltf); B.object.scale.setScalar(0.93); B.object.position.set(5.6, 0, -10.0); B.object.rotation.y = -0.7; scene.add(B.object); B.attach(cellWorld(LAB.cellB)); B.anim.play('crouch', { yaw: ending === 'quiet' ? Math.PI * 0.75 : -0.6 }); creatures.push(B); }
  const update0 = (dt) => { for (const c of creatures) c.update(dt, creatureCtx(game)); };

  // ---------------------------------------------------------------- the camera in Cell A
  if (cctv) {
    const hud = document.createElement('div');
    hud.style.cssText = 'position:fixed;inset:0;z-index:9;pointer-events:none;font:500 13px/1.5 "IBM Plex Mono",monospace;color:#cfe;letter-spacing:.12em;text-shadow:0 0 4px #000';
    hud.innerHTML = '<div style="position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(0,0,0,.28) 0 2px,transparent 2px 4px)"></div><div style="position:absolute;left:24px;top:20px">CAM 03 · WING C · LAB 3 · CELL A<br><span class="ts"></span></div><div style="position:absolute;right:24px;top:20px"><span class="rec" style="color:#f44">●</span> REC</div><div style="position:absolute;left:24px;bottom:20px">SITE 41 · DECOMMISSIONED · RECORDING CONTINUES</div>';
    document.body.appendChild(hud);
    const ts = hud.querySelector('.ts'), rec = hud.querySelector('.rec');
    let grain = 2.4;
    player.frozen = true; player.lookLocked = true; player.place(6.3, 5.4, 0, 0); player.eyeOverride = 2.75;
    player.lookAt(V(-3.7, 1.0, -9.4), 50);
    ui.crosshair(false); game.flashlight.on = false;
    let clock = 3 * 3600 + 11 * 60;
    const run = async () => {
      ui.setFade(1); ui.fadeTo(0, 2.5);
      await d.wait(14);
      // it turns its head. Not toward the door, not toward the dark. Toward the lens.
      A.anim.play('idle', { stare: true });
      sfx.creatureCrack(V(-3.7, 2.2, -9.4));
      await d.wait(9);
      for (let i = 0; i < 6; i++) { grain = 12; await d.wait(0.08); grain = 2.4; await d.wait(0.12); }
      ui.setFade(1); hud.remove();
      await d.wait(1.5);
      await finish(game, ending, narr);
    };
    game.run(run);
    return {
      update(dt) { const u = game.post.film.uniforms; u.uSat.value = 0; u.uGrain.value = grain; u.uVig.value = 1.4; update0(dt); clock += dt; const h = Math.floor(clock / 3600), m = Math.floor(clock / 60) % 60, s = Math.floor(clock) % 60; ts.textContent = `14 NOV · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; rec.style.opacity = Math.floor(clock * 1.2) % 2 ? 1 : 0.2; },
      dispose() { narr.dispose(); hud.remove(); },
    };
  }

  // ---------------------------------------------------------------- weeks later, from inside Cell B
  if (ending === 'replacement') {
    // your hands, at the bottom of the view: grey, and much too long
    const hands = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0x8b8984, roughness: 0.55 });
    for (const s of [-1, 1]) {
      const h = new THREE.Group(); h.position.set(s * 0.21, -0.27, -0.56); h.rotation.set(-0.35, s * 0.3, s * 0.15);
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.032, 0.36, 8), skin); fore.rotation.x = Math.PI / 2; fore.position.z = 0.12; h.add(fore);
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.018, 0.08), skin); palm.position.z = -0.08; h.add(palm);
      for (let f = 0; f < 4; f++) { const L2 = 0.2 + (f === 1 || f === 2 ? 0.05 : 0); const fg = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.008, L2, 5), skin); fg.rotation.x = Math.PI / 2 - 0.25; fg.position.set((f - 1.5) * 0.017, -0.02, -0.12 - L2 / 2); h.add(fg); }
      hands.add(h);
    }
    hands.traverse((o) => { o.frustumCulled = false; }); game.camera.add(hands);
    const fill = new THREE.PointLight(0xffffff, 0.3, 1, 2); fill.position.set(0, 0, -0.3); game.camera.add(fill);
    let raise = 0;
    const researcher = person({ seed: 21 }); researcher.position.set(0, 0, 15); researcher.rotation.y = Math.PI; scene.add(researcher);
    // the observation glass is one-way: from in here it is mostly your own reflection, and the lab behind it
    lab.glass.B.material = lab.glass.B.material.clone(); lab.glass.B.material.opacity = 0.32; lab.glass.B.material.color.set(0x9aa4a6);
    player.place(3.7, -8.6, Math.PI, 0); // facing the glass (south)
    let touched = false;
    interact.add({ position: V(3.7, 1.6, -6.05), reach: 1.6, size: 1.5, label: 'Put your hand on the glass', enabled: () => !touched && atGlass, onUse: () => { touched = true; } });
    let atGlass = false;
    const run = async () => {
      ui.setFade(1); game.expo = 0.55;
      await narr.show('You make it out. Okafor is waiting at the top of the shaft with two orderlies and a blanket.', 5.5);
      await narr.show('“You did well, Rook,” she says, and looks at your hands for a long time.', 5);
      await narr.show('Weeks later.', 3);
      ui.fadeTo(0, 3);
      await d.wait(4);
      ui.objective(null);
      sfx.doorSlide(V(0, 1.2, 9), { heavy: false });
      await walkTo(d, researcher, [[0, 9], [0, 2], [0.4, -2.2]], 1.1);
      await d.wait(2);
      await say('Researcher', 'Morning. ...Morning, sorry. First day. Where do I—', 3.4);
      await say('Dr. Okafor (intercom)', 'Read the label. Then run the battery. Light, tone, strobe. Don\'t run the strobe twice.', 4.6);
      await walkTo(d, researcher, [[2.6, -4.8]], 0.9);
      researcher.rotation.y = Math.PI;
      await d.wait(1.5);
      await say('Researcher', 'C-14C.', 1.8);
      await d.wait(1);
      await say('Researcher', '...Rook. A. Rook.', 2.6);
      await say('Dr. Okafor (intercom)', 'Don\'t use its name. It doesn\'t help it, and it doesn\'t help you.', 4);
      await say('Researcher', 'Was it— was this one of us?', 2.8);
      await say('Dr. Okafor (intercom)', '...Light first, please.', 2.4);
      ui.objective('...');
      await walkTo(d, researcher, [[0.4, -2.4]], 0.9); researcher.rotation.y = Math.PI;
      // the light: it is unbearable
      sfx.beep('console'); setCell('B', 3.5); ui.whiteFlash(0.9); player.shake = 0.8; raise = 1;
      await d.wait(4); setCell('B', 1); raise = 0;
      await d.wait(2);
      ui.objective('Go to the glass.');
      await d.until(() => player.pos.z > -7.0);
      atGlass = true;
      await d.until(() => touched || player.pos.z > -6.4);
      ui.objective(null);
      raise = 0.35; sfx.glassKnock(V(3.7, 1.6, -6.05));
      // it steps back from the glass. You can see its hands shaking.
      await walkTo(d, researcher, [[0.4, -1.0]], 0.7, false);
      await say('Researcher', 'It— it\'s looking at me.', 2.4);
      await say('Dr. Okafor (intercom)', 'They do that. Strobe, please.', 2.6);
      await d.wait(1.5);
      for (let i = 0; i < 7; i++) { setCell('B', 4); ui.whiteFlash(1); sfx.strobeFlash(); player.shake = 1; raise = 1; await d.wait(0.12); setCell('B', 0.05); await d.wait(0.25); }
      ui.setFade(1); setCell('B', 1);
      await d.wait(2);
      await finish(game, ending, narr);
    };
    game.run(run);
    return {
      update(dt, t) {
        update0(dt); researcher.userData.walk(0, dt);
        hands.position.y = (Math.sin(t * 1.3) * 0.006) + raise * 0.32; hands.rotation.x = raise * 0.9; hands.position.z = -raise * 0.05;
        game.expo = 0.55; game.fear = 0.15;
      },
      dispose() { narr.dispose(); game.expo = 0; },
    };
  }

  // ---------------------------------------------------------------- your first morning as lead
  const quiet = ending === 'quiet';
  let lookAway = true, flickT = 0, docRead = false, observed = false, badgeLeft = false;
  const hasBadge = !!save.get('badge');
  interact.add({ position: () => note.position, reach: 1.9, size: 0.35, label: 'Read the letter on the desk', onUse: async () => {
    docRead = true;
    await ui.readDoc({ ref: 'HALVERSEN · OFFICE OF THE DIRECTOR', title: 'C-14: lead appointment', body: `<p>Dr. Rook,</p><p>The board has confirmed your appointment as lead on C-14, effective today. I have asked Facilities to move your things into this office. Some of Dr. Lind's things are still in the drawers. Do as you see fit with them.</p><p>${quiet ? 'C-14B has not moved since its return. Observe it anyway. Observation is what we do.' : 'C-14B came back changed. Calmer. It watches the door. I would like to know what it is waiting for.'}</p><p>Thank you. I meant it then and I mean it now.</p><p>— I.O.</p><p style="margin-top:1.2em;color:#777">In the bottom drawer, under a box of pens: a nameplate. DR. T. LIND, LEAD, C-14.</p>` }, game.input);
  } });
  interact.add({ position: () => consoleObj.position.clone().add(V(0, 1.1, 0.3)), reach: 2.2, size: 0.8, label: () => (observed ? 'Observation running' : 'Run the morning observation · LIGHT'), enabled: () => docRead && !observed, onUse: () => { observed = true; } });
  interact.add({ position: () => consoleObj.position.clone().add(V(0.9, 1.0, 0.4)), reach: 2.2, size: 0.4, label: 'Leave Lind\'s badge on the console, facing the glass', enabled: () => hasBadge && !badgeLeft && docRead, onUse: () => { badgeLeft = true; sfx.beep('click'); } });
  const lookingAtB = () => { const c = game.camera, f = c.getWorldDirection(V(0, 0, 0)), p = V(4.6, 1.2, -9).sub(c.position).normalize(); return f.dot(p) > 0.88 && c.position.z > -6; };
  const run = async () => {
    player.place(0, 15.2, 0, 0); ui.setFade(1);
    await narr.show(quiet ? 'It sits down in the hoist car and does not move again. Okafor\'s team takes it from you at the top. It doesn\'t resist.' : 'The hoist brings it up folded into a corner of the car, holding the broken lure against its chest like something precious.', 6);
    await narr.show(quiet ? 'Whatever was left of Teodor Lind, the dose found it too late.' : 'Okafor thanks you on the record. The board names you lead on C-14.', 5);
    await narr.show('Your first morning.', 3);
    ui.fadeTo(0, 2.5);
    await d.wait(1.5);
    sfx.pa('chime'); await d.wait(1.2);
    await say('Dr. Okafor (PA)', 'Good morning, Dr. Rook. Congratulations. Your office is the old storage room, off the lab. I had it cleared for you.', 5.4);
    ui.objective('Go to your office (east side of the lab).');
    await d.until(() => player.pos.x > 7.4);
    sfx.setTension(0.15);
    await d.wait(0.8);
    await say('You', '...', 1.5);
    ui.objective('Someone has put the chairs in rows. There is a letter on the desk.');
    await d.until(() => docRead && !ui.docOpen);
    ui.objective('Run the morning observation from the console.');
    await d.until(() => observed);
    ui.objective(null);
    sfx.beep('console'); setCell('B', 2.4); setCell('A', 2.4);
    await d.wait(2);
    if (!quiet) {
      // it gets up, comes to the glass, and puts its hand flat against it at the height of your face
      B.anim.play('follow', { path: [{ x: 4.4, z: -8 }, { x: 3.0, z: -6.75 }], mode: 'walk', speed: 0.6, gaze: 'player', onArrive: () => B.anim.play('idle', { stare: true }) });
      await d.until(() => B.object.position.z > -6.9);
      await d.wait(1.5);
      sfx.glassKnock(V(3, 1.8, -6.05));
      await d.wait(5);
      if (badgeLeft) { await d.wait(1); B.anim.play('crouch', { yaw: Math.PI }); await d.wait(4); B.anim.play('idle', { stare: true }); }
      await say('Dr. Okafor (PA)', 'Rook? Everything all right down there?', 2.6);
      // the cell lights stutter and go; when they come back it is in its corner, as if it never moved
      for (let i = 0; i < 4; i++) { setCell('B', 0.1); await d.wait(0.1); setCell('B', 1); await d.wait(0.18); }
      setCell('B', 0); await d.wait(1.6);
      B.object.position.set(5.6, 0, -10.0); B.anim.play('crouch', { yaw: -0.6 });
      setCell('B', 1);
      await d.wait(2);
      await say('You', 'Fine. Everything\'s fine.', 2.2);
      await d.wait(3);
      await narr.show('In Cell B, the lights flicker when you look at it.', 4.5);
    } else {
      await d.wait(3);
      await say('Dr. Okafor (PA)', 'Nine days now. It hasn\'t moved, it hasn\'t eaten. Observe it anyway, Rook.', 4.4);
      await d.wait(2);
      if (badgeLeft) { B.anim.play('idle', { stare: true }); await d.wait(6); await narr.show('It turns its head, slowly, toward the console. Toward the badge.', 4.5); }
      else { await d.wait(5); await narr.show('They let you keep his badge. Nobody asks why you want it.', 4.5); }
    }
    await finish(game, ending, narr);
  };
  game.run(run);
  return {
    update(dt) {
      update0(dt);
      // Cell B's lights flicker whenever you look straight at it
      if (B && !observed && lookingAtB()) { if (lookAway) { lookAway = false; flickT = 0.9; } } else lookAway = true;
      if (flickT > 0) { flickT -= dt; setCell('B', Math.random() < 0.5 ? 0.15 : 1); if (flickT <= 0) setCell('B', 1); }
      game.fear = 0;
    },
    dispose() { narr.dispose(); },
  };
}
