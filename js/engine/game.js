import * as THREE from 'three';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Player, Flashlight } from './player.js';
import { Interactions } from './interact.js';
import { Director, CANCEL } from './director.js';
import { setAnisotropy } from './assets.js';
import { createPost } from '../post.js';
import { settings } from './settings.js';
import { staticBatch } from './batch.js';

// A roughness floor for every lit material: a torch held a metre from polished metal or gloss paint
// otherwise produces pinpoint highlights hundreds of times brighter than anything else in the frame.
// Materials that really are mirror-like (water, glass) opt out with defines.GLOSSY.
if (!THREE.ShaderChunk.roughnessmap_fragment.includes('GLOSSY')) {
  THREE.ShaderChunk.roughnessmap_fragment += '\n#ifndef GLOSSY\n\troughnessFactor = max( roughnessFactor, 0.26 );\n#endif\n';
}
// A spotlight's projected texture (a torch cookie, a film projector) should be the whole of its light:
// three.js leaves any part of the cone outside the texture's frame at full brightness. Make it dark.
THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin.replace(
  'directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;',
  'directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : vec3( 0.0 );');

// resolution cap and shadow detail per quality tier
const TIERS = {
  low: { pr: 0.75, shadow: 1024, soft: false },
  medium: { pr: 1.0, shadow: 1024, soft: true },
  high: { pr: 1.25, shadow: 2048, soft: true },
  ultra: { pr: 2.0, shadow: 4096, soft: true },
};
import { flashlightCookie } from '../room.js';

const params = new URLSearchParams(location.search);

// Sound: the engine lives in ../audio.js. Calls are forwarded once it has loaded and are
// silent no-ops before that (or if it is missing), so gameplay code never has to check.
let audioMod = null;
import('../audio.js').then((m) => { audioMod = m.audio; }).catch(() => {});
export const sfx = new Proxy({}, {
  get(_, name) {
    return (...args) => {
      const a = audioMod;
      if (!a || typeof a[name] !== 'function') return name === 'radio' ? Promise.resolve() : undefined;
      try { return a[name](...args); } catch (e) { console.warn('audio', name, e); return undefined; }
    };
  },
});

export class Game {
  constructor() {
    this.params = params;
    this.isTouch = matchMedia('(pointer: coarse)').matches;
    if (this.isTouch) document.body.classList.add('touch');
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.settings = settings;
    if (params.has('q')) settings.quality = params.get('q'); // test override, not saved
    this.tier = TIERS[settings.quality] || TIERS.high;
    this.resScale = 1;
    this.pixelRatio = this.targetPixelRatio();
    r.setPixelRatio(this.pixelRatio); r.setSize(innerWidth, innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true; r.shadowMap.type = this.tier.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    setAnisotropy(Math.min(8, r.capabilities.getMaxAnisotropy()));
    r.domElement.classList.add('game');
    document.body.prepend(r.domElement);

    this.camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.02, 80);
    this.input = new Input(r.domElement);
    this.ui = new UI(); this.ui.bindTouch(this.input);
    if (params.has('noui')) this.ui.root.style.display = 'none';
    if (params.has('ts')) this.ui.ts = parseFloat(params.get('ts'));
    this.ui.onLine = (who, dur) => { if (who && who !== 'You') sfx.radio(dur, { speaker: who }); };
    this.player = new Player(this.camera);
    this.applySettings();
    settings.on((k) => this.applySettings(k));
    this.frameMs = 16.7; this.resTimer = 0; this.fpsTimer = 0; this.fpsFrames = 0;
    this.batch = staticBatch;
    this.setupPause();
    this.player.onStep = (p, run) => sfx.footstep(undefined, this.surface || 'tile', { run, player: true });
    this.interact = new Interactions();
    this.cookie = flashlightCookie();
    this.clock = new THREE.Clock();
    this.time = 0; this.paused = false;
    this.timeScale = params.has('ts') ? parseFloat(params.get('ts')) : 1; // debug: speed up the clock
    this.skipRender = params.has('norender'); // debug: run logic only (automated playthroughs)
    this.level = null; this.fear = 0;
    addEventListener('resize', () => this.resize());
    this.audioStarted = false;
    // Web Audio may only start from a user gesture: try on every gesture until the engine is up
    const startAudio = () => { if (this.audioStarted || !audioMod) return; sfx.init(); sfx.setListener(this.camera); this.audioStarted = !!audioMod.ready; };
    addEventListener('pointerdown', startAudio, { once: false }); addEventListener('keydown', startAudio, { once: false });
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  targetPixelRatio() {
    const cap = params.has('pr') ? parseFloat(params.get('pr')) : Math.min(devicePixelRatio || 1, this.tier.pr);
    return Math.max(0.5, cap * (settings.dynamicRes ? this.resScale : 1));
  }
  resize() {
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    this.pixelRatio = this.targetPixelRatio();
    this.renderer.setPixelRatio(this.pixelRatio); this.renderer.setSize(innerWidth, innerHeight);
    this.post?.setSize(innerWidth, innerHeight, this.pixelRatio);
  }
  applySettings(key) {
    this.player.sens = 0.0022 * settings.sens;
    this.player.invertY = settings.invertY;
    this.camera.fov = settings.fov; this.camera.updateProjectionMatrix();
    sfx.setMasterVolume(settings.volume);
    if (!settings.showFps) this.ui?.fps(null);
    if (key === 'quality') {
      this.tier = TIERS[settings.quality] || TIERS.high;
      this.renderer.shadowMap.type = this.tier.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
      if (this.scene) {
        const look = this.post.look; this.post.dispose();
        this.post = createPost(this.renderer, this.scene, this.camera, { quality: settings.quality, ao: !params.has('noao') });
        this.post.setLook(look);
        this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
        const fl = this.flashlight.light.shadow; fl.map?.dispose(); fl.map = null; fl.mapSize.set(this.tier.shadow, this.tier.shadow);
      }
      this.resScale = 1; this.resize();
    }
    if (key === 'dynamicRes') { this.resScale = 1; this.resize(); }
  }
  // Esc / losing the mouse pauses the game while a level is being played
  setupPause() {
    this.playing = false;
    const open = () => {
      if (!this.playing || this.paused || this.ui.docOpen || !this.input.enabled) return;
      this.paused = true; this.input.unlock();
      this.ui.showPause(true, {
        resume: () => this.resume(),
        settings: async () => { this.ui.showPause(false); await this.ui.openSettings(settings); this.ui.showPause(true, this._pauseHandlers); },
        menu: () => { location.href = location.pathname; },
      });
      this._pauseHandlers = { resume: () => this.resume(), settings: async () => { this.ui.showPause(false); await this.ui.openSettings(settings); this.ui.showPause(true, this._pauseHandlers); }, menu: () => { location.href = location.pathname; } };
    };
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && !this.input.isTouch) setTimeout(open, 60); });
    addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' && e.code !== 'KeyP') return;
      if (this.ui.settingsOpen) return;
      if (this.paused && this.ui.pauseOpen) this.resume(); else if (!this.input.locked) open();
    });
  }
  resume() { this.ui.showPause(false); this.paused = false; this.clock.getDelta(); this.input.lock(); }

  // Build a fresh scene for a level. levelFn(game) -> { update(dt, t), dispose(), look }
  async load(levelFn, opts = {}) {
    if (this.level) { this.director.cancel(); this.level.dispose?.(); }
    this.interact.clear();
    this.scene = new THREE.Scene();
    for (const c of [...this.camera.children]) this.camera.remove(c); // level viewmodels / lamp lights
    this.scene.add(this.camera);
    this.director = new Director();
    this.player.colliders = []; this.player.blockers = () => []; this.player.groundAt = null; this.player.groundY = 0; this.player.frozen = false; this.player.lookLocked = false; this.player.releaseLook();
    this.flashlight = new Flashlight(this.scene, this.cookie, { shadowSize: this.tier.shadow });
    this.post?.dispose?.();
    this.post = createPost(this.renderer, this.scene, this.camera, { quality: settings.quality, ao: !params.has('noao') });
    this.post.setSize(innerWidth, innerHeight, this.pixelRatio);
    this.ui.objective(null); this.ui.lampMeter(false);
    this.level = await levelFn(this, opts);
    this.post.setLook(this.level.look || 'horror');
    this.playing = true;
    return this.level;
  }

  // run a story script; a cancelled script (level change, restart) stops silently
  run(script) { return script().catch((e) => { if (e !== CANCEL) console.error(e); }); }

  loop() {
    requestAnimationFrame(this.loop);
    const raw = this.clock.getDelta();
    const dt = Math.min(raw, 0.05) * (this.timeScale ?? 1);
    if (!this.scene) return;
    this.trackPerformance(raw);
    if (!this.paused) {
      this.time += dt;
      const t = this.time;
      if (this.input.wasPressed('KeyF') && this.flashlight.available) { this.flashlight.toggle(); sfx.beep('click'); }
      this.player.update(dt, this.input, t);
      this.flashlight.update(dt, this.camera, t);
      this.director.update(dt);
      this.level?.update?.(dt, t);
      this.interact.update(this.camera, this.input, this.ui);
      sfx.update(dt);
    }
    this.ui.update(dt);
    if (!this.skipRender) this.post.render(this.time, this.fear);
    this.input.endFrame();
  }

  // adaptive resolution: lower the render resolution when frames run long, raise it back
  // slowly when there is headroom; plus the optional FPS readout
  trackPerformance(raw) {
    if (raw <= 0 || raw > 0.5) return;
    this.frameMs += (raw * 1000 - this.frameMs) * 0.08;
    this.fpsFrames++; this.fpsTimer += raw;
    if (this.fpsTimer > 0.5) {
      if (settings.showFps) this.ui.fps(`${Math.round(this.fpsFrames / this.fpsTimer)} FPS · ${Math.round(this.pixelRatio * 100)}% RES`);
      this.fpsFrames = 0; this.fpsTimer = 0;
    }
    if (!settings.dynamicRes || this.paused || params.has('pr')) return;
    this.resTimer += raw;
    if (this.resTimer < 1.2) return;
    this.resTimer = 0;
    const prev = this.resScale;
    if (this.frameMs > 19.5) this.resScale = Math.max(0.55, this.resScale * (this.frameMs > 28 ? 0.82 : 0.92));
    else if (this.frameMs < 16.2 * 1.05 && this.resScale < 1) this.resScale = Math.min(1, this.resScale + 0.05);
    if (Math.abs(prev - this.resScale) > 0.001) this.resize();
  }
}
