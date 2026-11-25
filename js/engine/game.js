import * as THREE from 'three';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Player, Flashlight } from './player.js';
import { Interactions } from './interact.js';
import { Director, CANCEL } from './director.js';
import { setAnisotropy } from './assets.js';
import { createPost } from '../post.js';
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
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.pixelRatio = Math.min(devicePixelRatio, params.has('pr') ? parseFloat(params.get('pr')) : this.isTouch ? 1 : 1.5);
    r.setPixelRatio(this.pixelRatio); r.setSize(innerWidth, innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    setAnisotropy(Math.min(8, r.capabilities.getMaxAnisotropy()));
    r.domElement.classList.add('game');
    document.body.prepend(r.domElement);

    this.camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.02, 80);
    this.input = new Input(r.domElement);
    this.ui = new UI(); this.ui.bindTouch(this.input);
    if (params.has('noui')) this.ui.root.style.display = 'none';
    if (params.has('ts')) this.ui.ts = parseFloat(params.get('ts'));
    this.ui.onLine = (who, dur) => { if (who && who !== 'You') sfx.radio(dur, { speaker: who }); };
    this.player = new Player(this.camera);
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

  resize() {
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.post?.setSize(innerWidth, innerHeight, this.pixelRatio);
  }

  // Build a fresh scene for a level. levelFn(game) -> { update(dt, t), dispose(), look }
  async load(levelFn, opts = {}) {
    if (this.level) { this.director.cancel(); this.level.dispose?.(); }
    this.interact.clear();
    this.scene = new THREE.Scene();
    this.scene.add(this.camera);
    this.director = new Director();
    this.player.colliders = []; this.player.blockers = () => []; this.player.frozen = false; this.player.lookLocked = false; this.player.releaseLook();
    this.flashlight = new Flashlight(this.scene, this.cookie, { shadowSize: this.isTouch ? 1024 : 2048 });
    this.post = createPost(this.renderer, this.scene, this.camera, { ao: !params.has('noao') && !this.isTouch });
    this.post.setSize(innerWidth, innerHeight, this.pixelRatio);
    this.ui.objective(null); this.ui.lampMeter(false);
    this.level = await levelFn(this, opts);
    this.post.setLook(this.level.look || 'horror');
    return this.level;
  }

  // run a story script; a cancelled script (level change, restart) stops silently
  run(script) { return script().catch((e) => { if (e !== CANCEL) console.error(e); }); }

  loop() {
    requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05) * (this.timeScale ?? 1);
    if (!this.scene) return;
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
}
