import * as THREE from 'three';
import { Renderer, QUALITY } from './engine/renderer.js';
import { Audio } from './engine/audio.js';
import { generateAll, makeDecals, makeFlashlightCookie } from './gfx/textures.js';
import { Materials } from './gfx/materials.js';
import { Level } from './world/level.js';
import { Lights } from './world/lights.js';
import { Kit, bottle as bottleModel } from './world/props.js';
import * as Props from './world/props.js';
import { buildWorld } from './world/dressing.js';
import { Player } from './entities/player.js';
import { Monster } from './entities/monster.js';
import { Story, NOTES } from './game/story.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------- HUD
class HUD {
  constructor() {
    this.el = { hud: $('hud'), prompt: $('prompt'), cross: $('crosshair'), obj: $('objective'), sub: $('subtitle'), pick: $('pickup'), inv: $('inventory'), bat: $('battery-meter'), breath: $('breath-meter'), flash: $('flash'), black: $('blackout'), slats: $('locker-slats') };
    this.subQueue = []; this.subT = 0; this.objT = 0; this.pickT = 0; this.flashV = 0;
    this.game = null;
  }
  setPrompt(text) {
    if (text) { this.el.prompt.innerHTML = `<kbd>E</kbd>${text}`; this.el.cross.classList.add('active'); }
    else { this.el.prompt.innerHTML = ''; this.el.cross.classList.remove('active'); }
  }
  objective(text) {
    this.el.obj.innerHTML = `<small>OBJECTIVE</small>${text}`;
    this.el.obj.classList.add('show'); this.objT = 6;
  }
  subtitle(text, dur = 4) {
    this.el.sub.innerHTML = text; this.el.sub.classList.add('show'); this.subT = dur;
  }
  pickup(text) { this.el.pick.innerHTML = text; this.el.pick.classList.add('show'); this.pickT = 4; }
  inventory() {
    const g = this.game, f = g.story.f, P = g.player;
    const lines = [];
    if (P.bottles) lines.push(`BOTTLES ×${P.bottles}`);
    if (f.fusesHeld) lines.push(`FUSES ×${f.fusesHeld}`);
    if (f.keycard) lines.push('KEYCARD — I. VARGA');
    this.el.inv.innerHTML = lines.join('<br/>');
    this.el.inv.classList.toggle('show', lines.length > 0);
  }
  dim(v) { this.el.black.style.opacity = v; }
  flash(v = 0.9) { this.flashV = v; }
  update(dt, P) {
    if (this.subT > 0 && (this.subT -= dt) <= 0) this.el.sub.classList.remove('show');
    if (this.objT > 0 && (this.objT -= dt) <= 0) this.el.obj.classList.remove('show');
    if (this.pickT > 0 && (this.pickT -= dt) <= 0) this.el.pick.classList.remove('show');
    this.flashV = Math.max(0, this.flashV - dt * 5);
    this.el.flash.style.opacity = this.flashV;
    const b = this.el.bat;
    b.querySelector('b').style.width = `${P.battery * 100}%`;
    b.classList.toggle('show', P.battery < 0.5 || this.batShow > 0);
    b.classList.toggle('low', P.battery < 0.2);
    this.batShow = Math.max(0, (this.batShow || 0) - dt);
    this.el.breath.querySelector('b').style.width = `${P.breath * 100}%`;
    this.el.breath.classList.toggle('show', !!P.hidden);
    this.el.slats.classList.toggle('hidden', !P.hidden);
  }
}

// ---------------------------------------------------------------- Game
class Game {
  constructor() {
    this.time = 0;
    this.state = 'title';
    this.hud = new HUD(); this.hud.game = this;
    this.audio = new Audio();
    this.interactables = [];
    this.anims = [];
    this.projectiles = [];
    this.sparkSystems = [];
    this.settings = { quality: 'high', bright: 1, sens: 1, vol: 0.85 };
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem('pc-settings') || '{}')); } catch { /* */ }
    this.ambT = 4;
  }

  async load(quality) {
    const setBar = (p, text) => { $('load-bar').firstElementChild.style.width = `${Math.round(p * 100)}%`; if (text) $('load-text').textContent = text; };
    this.renderer = new Renderer($('app'), quality);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.FogExp2(0x040505, 0.07);
    setBar(0.02, 'Synthesising surfaces…');
    const tex = await generateAll(quality, this.renderer.renderer, (p, name) => setBar(0.05 + p * 0.7, `Synthesising surfaces… ${name}`));
    setBar(0.78, 'Building Block 13…');
    await frame();
    this.decals = makeDecals();
    this.cookie = makeFlashlightCookie();
    this.mats = new Materials(tex, this.decals);
    this.kit = new Kit(this.mats);
    this.level = new Level();
    this.scene.add(this.level.buildGeometry(this.mats));
    this.lights = new Lights(this.scene, QUALITY[quality].lights);
    this.player = new Player(this);
    this.renderer.setup(this.scene, this.player.camera);
    this.audio.occlusionFn = (x, z) => this.level.los(this.player.pos.x, this.player.pos.z, x, z);
    setBar(0.84, 'Furnishing the wards…');
    await frame();
    this.world = buildWorld(this);
    this.monster = new Monster(this);
    this.story = new Story(this);
    this.story.init();
    // environment reflections: a dim, dirty room
    const pm = new THREE.PMREMGenerator(this.renderer.renderer);
    const envScene = new THREE.Scene();
    const room = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 10), new THREE.MeshBasicMaterial({ color: 0x1b1d1b, side: THREE.BackSide }));
    envScene.add(room);
    for (const [x, z] of [[-2, 0], [2, 0]]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 1.2), new THREE.MeshBasicMaterial({ color: 0x9aa4a0 })); s.position.set(x, 1.95, z); envScene.add(s); }
    this.scene.environment = pm.fromScene(envScene, 0.04).texture;
    this.scene.environmentIntensity = 0.5;
    this.hemi = new THREE.HemisphereLight(0x2a3438, 0x0a0908, 0.5);
    this.scene.add(this.hemi);
    // persistent effect light (sparks, jump-scare key light). Added once so the light count never changes.
    this.fxLight = new THREE.PointLight(0xffffff, 0, 5, 2);
    this.scene.add(this.fxLight);
    this.sparkMat = new THREE.PointsMaterial({ color: 0xffc070, size: 0.04, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    const warm = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, -10, 0], 3)), this.sparkMat);
    this.scene.add(warm); // keeps the program compiled
    // spawn
    const sp = this.world.special.spawn;
    this.player.pos.set(sp.x, 0, sp.z); this.player.yaw = sp.yaw;
    this.story.saveCheckpoint();
    this.applySettings();
    setBar(0.95, 'Compiling shaders…');
    await frame();
    // warm up shaders
    this.renderer.renderer.compile(this.scene, this.player.camera);
    this.player.update(0.016);
    this.renderer.render(0.016);
    setBar(1, 'Ready.');
    this.lastT = performance.now();
    this.hud.inventory();
    this.debugSetup();
    requestAnimationFrame((t) => this.loop(t));
  }

  applySettings() {
    const s = this.settings;
    if (this.renderer) { this.renderer.renderer.toneMappingExposure = 1.15 * s.bright; this.renderer.fx.uniforms.uGamma.value = 0.9 + (s.bright - 1) * 0.35; }
    if (this.player) this.player.sensitivity = s.sens;
    this.audio.setVolume(s.vol);
    try { localStorage.setItem('pc-settings', JSON.stringify(s)); } catch { /* */ }
  }

  // ---------------------------------------------------------- systems used by entities
  emitNoise(x, z, radius, kind) { this.monster?.hear(x, z, radius, kind); }
  surfaceAt(x, z) {
    const zn = this.level.zoneAt(x, z);
    return { B: 'tile', M: 'tile', H: 'water', G: 'concrete', A: 'concrete', P: 'concrete', E: 'metal' }[zn] || 'linoleum';
  }
  addInteract(o) { this.interactables.push(o); return o; }
  anim(fn) { this.anims.push({ fn, t: 0 }); }
  sparks(pos) {
    const n = 60;
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3), v = [];
    for (let i = 0; i < n; i++) { p[i * 3] = pos.x; p[i * 3 + 1] = pos.y; p[i * 3 + 2] = pos.z; v.push(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, Math.random() * 2.5)); }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const mat = this.sparkMat.clone();
    const pts = new THREE.Points(geo, mat);
    this.scene.add(pts);
    const light = this.fxLight; light.color.set(0xffb060); light.distance = 5; light.position.copy(pos);
    this.sparkSystems.push({ pts, v, t: 0, light });
  }

  // ---------------------------------------------------------- UI flows
  openNote(id) {
    const n = NOTES[id];
    if (!n) return;
    $('note-title').textContent = n.title;
    $('note-body').innerHTML = n.body;
    $('note').classList.remove('hidden');
    this.audio.ui('paper');
    this.state = 'note';
    document.exitPointerLock?.();
  }
  closeNote() {
    $('note').classList.add('hidden');
    this.audio.ui('paper');
    this.state = 'playing';
    this.lock();
  }
  openKeypad() {
    this.kp = '';
    $('kp-display').textContent = '____'; $('kp-display').classList.remove('err');
    $('keypad').classList.remove('hidden');
    this.state = 'keypad';
    document.exitPointerLock?.();
  }
  closeKeypad() { $('keypad').classList.add('hidden'); this.state = 'playing'; this.lock(); }
  keypadPress(k) {
    if (k === 'clr') { this.kp = ''; }
    else if (k === 'ok') {
      const ok = this.story.submitCode(this.kp || '0');
      if (ok) { $('kp-display').textContent = 'OPEN'; setTimeout(() => this.closeKeypad(), 700); return; }
      $('kp-display').textContent = 'ERR'; $('kp-display').classList.add('err');
      this.kp = '';
      setTimeout(() => { $('kp-display').classList.remove('err'); $('kp-display').textContent = '____'; }, 900);
      return;
    } else if (this.kp.length < 4) { this.kp += k; this.audio.ui('click'); }
    $('kp-display').textContent = (this.kp + '____').slice(0, 4);
  }

  lock() {
    if (this.state !== 'playing') return;
    try { const r = this.renderer.canvas.requestPointerLock?.(); if (r && r.catch) r.catch(() => {}); } catch { /* needs a gesture */ }
  }

  enterLocker(lk) {
    const P = this.player, m = this.monster;
    if (P.hidden) return;
    // seen going in?
    if (m.active && (m.state === 'chase' || m.awareness > 0.6) && this.level.los(m.pos.x, m.pos.z, P.pos.x, P.pos.z) && m.pos.distanceTo(P.pos) < 16) m.knownLocker = lk;
    lk.target = 1;
    this.audio.doorOpen(lk.pos.clone().setY(1), false);
    this.emitNoise(lk.pos.x, lk.pos.z, 4, 'locker');
    P.frozen = true;
    setTimeout(() => {
      P.hidden = lk; P.yaw = lk.yaw; P.pitch = -0.05; P.vel.set(0, 0, 0);
      P.pos.copy(lk.pos);
      lk.target = 0; P.frozen = false; P.holdingBreath = false;
      this.audio.ui('click');
    }, 280);
  }
  exitLocker() {
    const P = this.player, lk = P.hidden;
    if (!lk) return;
    lk.target = 1;
    this.audio.doorOpen(lk.pos.clone().setY(1), false);
    this.emitNoise(lk.pos.x, lk.pos.z, 4, 'locker');
    P.hidden = null; P.pos.copy(lk.front); P.yaw = lk.yaw;
    setTimeout(() => { lk.target = 0; }, 450);
  }

  throwBottle() {
    const P = this.player;
    if (P.bottles <= 0 || P.hidden || P.frozen) return;
    P.bottles--; this.hud.inventory();
    const b = bottleModel(this.kit, 0);
    const f = P.forward(new THREE.Vector3());
    b.position.copy(P.camera.position).addScaledVector(f, 0.4);
    this.scene.add(b);
    this.projectiles.push({ obj: b, vel: f.multiplyScalar(11).add(new THREE.Vector3(0, 2.2, 0)), spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, 0) });
    this.audio.breath(0.6, false);
  }

  onLockerSniff(lk) {
    if (this.player.hidden === lk) {
      this.hud.subtitle('<i>It is right outside.</i> Hold your breath — <kbd>Space</kbd> / <kbd>RMB</kbd>', 3.5);
      this.audio.heartbeat(0.9);
    }
  }

  onCaught(monster, fromLocker) {
    if (this.dying) return;
    this.dying = true;
    const P = this.player;
    P.frozen = true;
    const cam = P.camera;
    const f = P.forward(new THREE.Vector3()); f.y = 0; f.normalize();
    if (fromLocker && P.hidden) { P.hidden.ripping = true; P.hidden.target = 1; }
    const mx = cam.position.x + f.x * 1.05, mz = cam.position.z + f.z * 1.05;
    monster.teleport(mx, mz, Math.atan2(-f.x, -f.z));
    monster.mode = 'attack';
    monster.root.visible = true;
    const faceLight = this.fxLight;
    faceLight.color.set(0xff9a80); faceLight.intensity = 4; faceLight.distance = 4;
    faceLight.position.copy(cam.position).add(new THREE.Vector3(0, 0.3, 0)).addScaledVector(f, 0.3);
    this.hud.flash(0.8);
    this.audio.stinger('jumpscare');
    P.shake = 1.4;
    P.fear = 1;
    this.deathFx = 1;
    const head = new THREE.Vector3();
    this.anim((t) => { monster.model.head.getWorldPosition(head); P.lookTarget = head; return t < 1.4; });
    setTimeout(() => { this.hud.dim(1); }, 1250);
    setTimeout(() => {
      faceLight.intensity = 0;
      this.state = 'dead';
      document.exitPointerLock?.();
      const lines = ['Resident 42 has been counted.', 'One. Two. Three…', 'It adds one. It always adds one.', 'The census is complete.'];
      $('death-sub').textContent = lines[Math.floor(Math.random() * lines.length)];
      $('death').classList.remove('hidden');
    }, 2100);
  }

  retry() {
    const P = this.player, m = this.monster, cp = this.story.checkpoint;
    $('death').classList.add('hidden');
    this.hud.dim(0);
    this.dying = false; this.deathFx = 0;
    if (P.hidden) { P.hidden.ripping = false; P.hidden.target = 0; P.hidden = null; }
    P.pos.set(cp.x, 0, cp.z); P.yaw = cp.yaw; P.pitch = 0; P.frozen = false; P.lookTarget = null; P.stamina = 1; P.fear = 0;
    if (m.active || m.state === 'attack') {
      m.active = true; m.puppet = false;
      const far = m.farPoint(20);
      m.teleport(far.x, far.z);
      m.awareness = 0; m.menace = 0.1; m.sinceEncounter = 0; m.knownLocker = null; m.grace = 15;
      m.setState('patrol');
    }
    this.state = 'playing';
    this.lock();
  }

  endGame() {
    this.state = 'ending';
    this.hud.dim(1);
    document.exitPointerLock?.();
    setTimeout(() => {
      $('hud').classList.add('hidden');
      const form = $('ending-form');
      form.innerHTML = `
        <h3>MUNICIPAL CENSUS · FORM 13-B</h3>
        <div style="font-size:11px;color:#555;margin-bottom:18px">Decennial enumeration of institutional residents</div>
        <div class="row"><span>Premises</span><span class="hand">Block 13, Meridian Reservoir Sanitarium</span></div>
        <div class="row"><span>Date of enumeration</span><span class="hand">31 Oct 1997</span></div>
        <div class="row"><span>Residents on register</span><span class="hand">41</span></div>
        <div class="row"><span>Residents counted</span><span class="hand" id="end-count"></span></div>
        <div class="row"><span>Enumerator</span><span class="hand" id="end-name"></span></div>
        <div style="margin-top:26px;font-family:'Special Elite',serif;font-size:16px;color:#333" id="end-line"></div>
        <div class="end-hint" id="end-hint"></div>`;
      $('ending').classList.remove('hidden');
      requestAnimationFrame(() => form.classList.add('on'));
      setTimeout(() => { $('end-count').innerHTML = '<s>41</s>'; }, 3000);
      setTimeout(() => { $('end-count').innerHTML = '<s>41</s> <span class="blood">42</span>'; this.audio.stinger('low', 0.8); }, 4800);
      setTimeout(() => { $('end-name').innerHTML = '<span class="blood">—</span>'; }, 6200);
      setTimeout(() => { $('end-line').textContent = 'The lift is still rising. You have stopped counting the floors.'; }, 7600);
      setTimeout(() => { $('end-hint').innerHTML = 'THANK YOU FOR PLAYING · <a href="" style="color:#555">PLAY AGAIN</a>'; }, 10000);
    }, 2500);
  }

  // ---------------------------------------------------------- loop
  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    let dt = Math.min(0.05, (t - this.lastT) / 1000);
    this.lastT = t;
    if (this.state === 'title' || this.state === 'intro') { this.renderer.render(dt * 0.2); return; }
    const running = this.state === 'playing' || this.state === 'dead-anim' || (this.state === 'ending');
    if (this.state === 'paused' || this.state === 'note' || this.state === 'keypad' || this.state === 'dead') {
      this.renderer.render(0);
      return;
    }
    if (!running) return;
    this.time += dt;
    const P = this.player;
    P.update(dt);
    this.audio.updateListener(P.camera);
    for (const d of this.world.doorList) d.update(dt);
    for (const f of this.world.animated) f(dt);
    for (let i = this.anims.length - 1; i >= 0; i--) { const a = this.anims[i]; a.t += dt; if (a.fn(a.t, dt) === false) this.anims.splice(i, 1); }
    this.monster.update(dt);
    this.story.update(dt);
    // monster disturbs nearby lights
    const m = this.monster;
    for (const fx of this.lights.fixtures) {
      if (m.active && fx.pos.distanceTo(m.pos) < 7 && fx.power !== 'always') fx.override = Math.random() < 0.15 ? 0.05 : null;
      else if (fx.override === 0.05) fx.override = null;
    }
    this.lights.update(dt, P.camera.position);
    this.updateProjectiles(dt);
    this.updateSparks(dt);
    this.updateInteract();
    this.ambience(dt);
    // water ripples & curtains
    const wn = this.mats.get('water').normalMap;
    wn.offset.x += dt * 0.012; wn.offset.y += dt * 0.007;
    Props.curtainTime.value += dt;
    // fear & post fx
    const toM = m.active ? m.pos.distanceTo(P.pos) : 99;
    const chase = m.active && m.state === 'chase';
    const fearT = Math.max(chase ? 1 : 0, m.active ? THREE.MathUtils.clamp(1 - toM / 12, 0, 1) * 0.8 : 0);
    P.fear += (Math.max(fearT, P.fear * 0.99) - P.fear) * Math.min(1, dt * 2);
    P.fear = Math.max(0, P.fear - dt * 0.05);
    const fx = this.renderer.fx.uniforms;
    fx.uFear.value = P.fear;
    fx.uScan.value = m.active ? THREE.MathUtils.clamp(1 - toM / 8, 0, 1) * 0.8 + (this.deathFx || 0) : (this.deathFx || 0);
    fx.uRed.value = (this.deathFx || 0) * 0.5 + (chase ? 0.08 : 0);
    fx.uWarp.value = P.fear * 0.6 + (1 - P.stamina) * 0.3;
    fx.uGrain.value = 0.055 + P.fear * 0.04;
    this.audio.setTension(Math.max(P.fear, this.story.f.power ? 0.15 : 0.05), chase ? 1 : m.active ? THREE.MathUtils.clamp(1 - toM / 15, 0, 1) : 0);
    // heartbeat when close
    this.hbT = (this.hbT || 0) - dt;
    if (P.fear > 0.45 && this.hbT <= 0) { this.audio.heartbeat(0.3 + P.fear * 0.5); this.hbT = 1.15 - P.fear * 0.6; }
    this.hud.update(dt, P);
    this.renderer.render(dt);
    if (this.debug) this.debugUpdate(dt);
  }

  updateInteract() {
    const P = this.player;
    if (P.frozen || this.dying) { this.hud.setPrompt(null); this.hover = null; return; }
    const ray = new THREE.Ray(P.camera.position.clone(), P.forward(new THREE.Vector3()));
    let best = null, bd = 2.3;
    const hit = new THREE.Vector3();
    for (const it of this.interactables) {
      if (P.hidden && !it.always) continue;
      if (P.hidden && it.always && P.hidden.pos.distanceTo(it.box.getCenter(hit)) > 0.5) continue;
      if (P.hidden) { best = it; bd = 0; break; }
      if (it.item?.taken) continue;
      if (!ray.intersectBox(it.box, hit)) continue;
      const d = hit.distanceTo(ray.origin);
      if (d < bd) {
        // walls in between?
        if (!this.level.los(P.pos.x, P.pos.z, hit.x - ray.direction.x * 0.1, hit.z - ray.direction.z * 0.1)) continue;
        bd = d; best = it;
      }
    }
    const text = best?.prompt?.();
    this.hover = text ? best : null;
    this.hud.setPrompt(text);
  }
  interact() { if (this.hover && this.state === 'playing') this.hover.use(); }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.vel.y -= 9.8 * dt;
      const o = p.obj;
      o.position.addScaledVector(p.vel, dt);
      o.rotation.x += p.spin.x * dt; o.rotation.y += p.spin.y * dt;
      const solid = this.level.solidCell(Math.floor(o.position.x), Math.floor(o.position.z));
      const ceil = this.level.ceilingAt(o.position.x, o.position.z);
      if (o.position.y < 0.05 || solid || o.position.y > ceil - 0.05) {
        if (solid) o.position.addScaledVector(p.vel, -dt);
        this.audio.shatter(o.position.clone());
        this.emitNoise(o.position.x, o.position.z, 24, 'bottle');
        this.scene.remove(o);
        this.projectiles.splice(i, 1);
      }
    }
  }
  updateSparks(dt) {
    for (let i = this.sparkSystems.length - 1; i >= 0; i--) {
      const s = this.sparkSystems[i];
      s.t += dt;
      const pa = s.pts.geometry.attributes.position;
      for (let k = 0; k < s.v.length; k++) {
        s.v[k].y -= 9.8 * dt;
        pa.setXYZ(k, pa.getX(k) + s.v[k].x * dt, Math.max(0.01, pa.getY(k) + s.v[k].y * dt), pa.getZ(k) + s.v[k].z * dt);
      }
      pa.needsUpdate = true;
      s.pts.material.opacity = Math.max(0, 1 - s.t / 1.2);
      s.light.intensity = Math.max(0, 3 - s.t * 6) * (Math.random() < 0.5 ? 1 : 0.3);
      if (s.t > 1.3) { this.scene.remove(s.pts); s.light.intensity = 0; this.sparkSystems.splice(i, 1); }
    }
  }

  // contextual ambient sound: drips, groaning pressure, the fluorescent hum
  ambience(dt) {
    const P = this.player, A = this.audio;
    this.ambT -= dt;
    if (this.ambT <= 0) {
      this.ambT = 2.5 + Math.random() * 6;
      const r = Math.random();
      const ang = Math.random() * Math.PI * 2, dist = 3 + Math.random() * 9;
      const pos = new THREE.Vector3(P.pos.x + Math.cos(ang) * dist, 2.5, P.pos.z + Math.sin(ang) * dist);
      if (r < 0.45) { for (let i = 0; i < 1 + Math.floor(Math.random() * 3); i++) setTimeout(() => A.drip(pos), i * 350 + Math.random() * 200); }
      else if (r < 0.7) A.creak(pos, Math.random() < 0.2);
      else if (r < 0.8) A.bang(pos.clone().multiplyScalar(1).add(new THREE.Vector3(10, 0, 10)), 0.25);
      else if (r < 0.86 && this.story.f.power) A.intercom(pos, 1.5 + Math.random() * 2);
    }
    // hum follows the nearest lit tube
    this.humT = (this.humT || 0) - dt;
    if (this.humT <= 0) {
      this.humT = 0.4;
      const fx = this.lights.nearestLit(P.camera.position, 8);
      if (!this.hum) this.hum = A.loop('hum', new THREE.Vector3(0, 3, 0), { gain: 0 });
      if (fx) { this.hum.pos(fx.pos); this.hum.set(0.5 * fx.level, 0.1); } else this.hum.set(0, 0.3);
    }
    if (!this.waterLoop) this.waterLoop = A.loop('water', new THREE.Vector3(11.2, 1, 35.4), { gain: 0.8, ref: 2 });
  }

  // ---------------------------------------------------------- debug helpers (url params)
  debugSetup() {
    if (params.has('power')) { const f = this.story.f; f.knowsGen = f.knowsFuses = true; f.fusesIn = 2; this.story.startGenerator(); }
    if (params.has('gate')) { this.story.f.gateOpen = true; const gt = this.world.doors.get('gate'); gt.locked = false; gt.open(14, 5, false, true); gt.open01 = 1; this.monster.restrictZones = null; }
    if (params.has('tp')) { const [x, z, yaw] = params.get('tp').split(',').map(Number); this.player.pos.set(x, 0, z); if (!isNaN(yaw)) this.player.yaw = yaw; }
    if (params.has('pitch')) this.player.pitch = Number(params.get('pitch'));
    if (params.has('flash')) this.player.flashOn = params.get('flash') !== '0';
    if (params.has('monster')) { const [x, z, h] = params.get('monster').split(',').map(Number); this.monster.puppet = true; this.monster.root.visible = true; this.monster.teleport(x, z, h || 0); this.monster.puppetMode = params.get('mmode') || 'still'; }
    if (params.has('lit')) { this.hemi.intensity = Number(params.get('lit')) || 3; this.hemi.color.set(0xffffff); this.hemi.groundColor.set(0x888888); }
    if (params.has('debug')) { this.debug = true; const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:50;color:#8f8;font:11px monospace;background:rgba(0,0,0,.5);padding:4px 6px;white-space:pre'; document.body.appendChild(d); this.dbgEl = d; this.fpsAcc = 0; this.fpsN = 0; }
    window.game = this;
  }
  debugUpdate(dt) {
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) {
      const r = this.renderer.renderer.info.render;
      const m = this.monster;
      this.dbgEl.textContent = `fps ${(this.fpsN / this.fpsAcc).toFixed(0)}  calls ${r.calls}  tris ${(r.triangles / 1000).toFixed(0)}k\npos ${this.player.pos.x.toFixed(1)},${this.player.pos.z.toFixed(1)}  monster ${m.state} ${m.pos.x.toFixed(1)},${m.pos.z.toFixed(1)} aw ${m.awareness.toFixed(2)} men ${m.menace.toFixed(2)}`;
      this.fpsAcc = 0; this.fpsN = 0;
    }
  }
}

function frame() { return new Promise((r) => requestAnimationFrame(() => r())); }

// ---------------------------------------------------------------- boot & input wiring
const game = new Game();
window.game = game;
const S = game.settings;
if (params.has('quality')) S.quality = params.get('quality');
$('opt-quality').value = S.quality;
for (const [a, b, key] of [['opt-bright', 'opt-bright2', 'bright'], ['opt-sens', 'opt-sens2', 'sens'], ['opt-vol', 'opt-vol2', 'vol']]) {
  $(a).value = S[key]; $(b).value = S[key];
  for (const id of [a, b]) $(id).addEventListener('input', (e) => { S[key] = parseFloat(e.target.value); $(a).value = S[key]; $(b).value = S[key]; game.applySettings(); });
}
$('opt-quality').addEventListener('change', (e) => { S.quality = e.target.value; game.applySettings(); });
$('load-wrap').classList.add('hidden');
$('menu').classList.remove('hidden');

const INTRO = [
  'October 31st, 1997.',
  'The city register still lists forty-one residents in Block 13 — a sanitarium wing sealed beneath the Meridian reservoir in 1987.',
  'Nobody has seen them in ten years.',
  'You are the enumerator. You are here to count them.',
  'The service lift stopped between floors. You pried the doors open and dropped into the dark.',
];

async function begin() {
  $('menu').classList.add('hidden');
  $('load-wrap').classList.remove('hidden');
  game.audio.init();
  game.applySettings();
  try {
    await game.load(S.quality);
  } catch (e) {
    console.error(e);
    $('load-text').textContent = 'Failed to start: ' + e.message;
    return;
  }
  if (params.has('skip')) { startPlaying(); return; }
  $('title').classList.add('hidden');
  $('intro').classList.remove('hidden');
  game.state = 'intro';
  const el = $('intro-text');
  el.innerHTML = INTRO.map((l) => `<span>${l}</span>`).join('\n\n');
  const spans = [...el.querySelectorAll('span')];
  spans.forEach((s, i) => setTimeout(() => s.classList.add('on'), 600 + i * 2200));
  game.audio.stinger('low', 0.6);
  let ready = false;
  setTimeout(() => (ready = true), 1500);
  $('intro').onclick = () => { if (ready) startPlaying(); };
}

function startPlaying() {
  $('title').classList.add('hidden');
  $('intro').classList.add('hidden');
  $('hud').classList.remove('hidden');
  game.state = 'playing';
  game.lastT = performance.now();
  game.lock();
}

$('btn-start').addEventListener('click', begin);
$('btn-resume').addEventListener('click', () => { $('pause').classList.add('hidden'); game.state = 'playing'; game.lock(); });
$('btn-retry').addEventListener('click', () => game.retry());
$('note').addEventListener('click', () => game.state === 'note' && game.closeNote());
document.querySelectorAll('.kp-grid button').forEach((b) => b.addEventListener('click', () => game.keypadPress(b.dataset.k || b.textContent)));

document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && game.state === 'playing') {
    game.state = 'paused';
    const f = game.story?.f;
    $('pause-notes').innerHTML = f && f.notes.size ? '<b>Documents found</b><br/>' + [...f.notes].map((n) => NOTES[n].title).join('<br/>') : '';
    $('pause').classList.remove('hidden');
  }
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement && game.state === 'playing') game.player.onMouse(e.movementX, e.movementY);
});
document.addEventListener('mousedown', (e) => {
  if (game.state !== 'playing') return;
  if (!document.pointerLockElement) { game.lock(); return; }
  if (e.button === 0) game.throwBottle();
  if (e.button === 2 && game.player.hidden) game.player.holdingBreath = game.player.breath > 0.05;
});
document.addEventListener('mouseup', (e) => { if (e.button === 2 && game.player) game.player.holdingBreath = false; });
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('keydown', (e) => {
  if (game.state === 'keypad') {
    if (/^Digit\d$/.test(e.code) || /^Numpad\d$/.test(e.code)) game.keypadPress(e.code.slice(-1));
    else if (e.code === 'Enter' || e.code === 'NumpadEnter') game.keypadPress('ok');
    else if (e.code === 'Backspace') game.keypadPress('clr');
    else if (e.code === 'Escape') game.closeKeypad();
    e.preventDefault();
    return;
  }
  if (game.state === 'note') { if (e.code === 'KeyE' || e.code === 'Escape' || e.code === 'Space') { game.closeNote(); e.preventDefault(); } return; }
  if (game.state !== 'playing') return;
  const P = game.player;
  if (e.code === 'Tab') { e.preventDefault(); game.story.refreshObjective(true); return; }
  if (e.repeat) return;
  P.keys.add(e.code);
  if (e.code === 'KeyE') game.interact();
  if (e.code === 'KeyF' && !P.hidden) { P.flashOn = !P.flashOn; game.audio.ui('click'); game.hud.batShow = 2; }
  if (e.code === 'KeyC' || e.code === 'ControlLeft') P.crouch = !P.crouch;
  if (e.code === 'Space' && P.hidden) P.holdingBreath = P.breath > 0.05;
});
document.addEventListener('keyup', (e) => {
  if (!game.player) return;
  game.player.keys.delete(e.code);
  if (e.code === 'Space') game.player.holdingBreath = false;
});
window.addEventListener('blur', () => game.player?.keys.clear());

if (params.has('autostart')) begin();
