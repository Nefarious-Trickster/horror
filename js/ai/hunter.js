import * as THREE from 'three';
import { sfx } from '../engine/game.js';

const rand = (a, b) => a + Math.random() * (b - a);
const V = (x, z) => new THREE.Vector3(x, 0, z);

// The creature as a hunter. It patrols the dark, listens, notices, investigates, searches,
// stalks, chases, and backs off from the halide strobe. It will not step into lit areas:
// it waits at their edge instead. Everything it does is deliberate: it stops, looks, then moves.
//
// opts: { creature, grid (NavGrid), game, patrol: [{x,z}], isLit(x,z) -> bool, onKill() }
export class Hunter {
  constructor(o) {
    Object.assign(this, o);
    this.c = o.creature; this.anim = this.c.anim;
    this.state = 'idle'; this.t = 0; this.stateT = 0;
    this.suspicion = 0; this.lastSeen = null; this.seenT = 0; this.lostT = 0;
    this.patrolI = 0; this.replanT = 0; this.stuns = []; this.enabled = true;
    this.noiseQ = null; this.moveSoundT = 0; this.breathT = 0;
    this.playerHidden = false; this.sawHide = false;
    this.aggression = o.aggression ?? 1;
    this.flashRange = o.flashRange ?? 7; this.enraged = 0;
    this.hunt = o.hunt ?? 0.35; // how strongly its wandering drifts toward where you are (it hears more than you think)
  }
  get pos() { return this.c.object.position; }
  set(state, data = {}) { this.state = state; this.stateT = 0; this.data = data; this.onState?.(state); }
  follow(path, mode, extra = {}) { this.anim.play('follow', { path, mode, ...extra }); }
  pathTo(x, z, opts) {
    return this.grid.findPath(this.pos, { x, z }, { cost: (cx, cz) => (this.isLit?.(cx, cz) && this.enraged <= 0 ? 40 : 0), ...opts });
  }

  // ---------------------------------------------------------------- senses
  playerVisibility() {
    if (this.playerHidden) return 0;
    const g = this.game, cam = g.camera.position, p = this.pos;
    const dx = cam.x - p.x, dz = cam.z - p.z, d = Math.hypot(dx, dz);
    let range = 7;
    if (g.flashlight.on) range += 7;
    if (this.isLit?.(cam.x, cam.z)) range += 10;
    if (g.player.crouch) range *= 0.55;
    const ang = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - this.anim.heading), Math.cos(Math.atan2(dx, dz) - this.anim.heading)));
    if (ang > 1.3) range *= d < 2.5 ? 0.8 : 0.22; // mostly blind behind itself, but it can feel you right at its back
    if (d > range) return 0;
    if (!this.grid.lineOfSight({ x: p.x, z: p.z }, { x: cam.x, z: cam.z })) return 0;
    return 1 - d / range;
  }
  // called by the level for sounds the player (or the world) makes
  noise(pos, radius) {
    if (!this.enabled || this.state === 'scripted') return;
    const d = Math.hypot(pos.x - this.pos.x, pos.z - this.pos.z);
    if (d > radius) return;
    if (['chase', 'stunned', 'retreat', 'attack'].includes(this.state)) return;
    this.noiseQ = { x: pos.x, z: pos.z, loud: radius };
  }
  // The halide lamp hit it. It is not a "go away" button:
  //  - from too far it only squints, and now it knows exactly where you are;
  //  - the first flash in a while staggers it and it backs off into the dark, but not for long;
  //  - the second comes as less of a surprise: a short flinch, then it circles back at once;
  //  - by the third it has learned: it shields its eyes and comes straight through the light.
  flashHit(dist) {
    if (!this.enabled || this.state === 'scripted' || this.state === 'attack') return false;
    const cam = this.game.camera.position;
    this.lastSeen = V(cam.x, cam.z);
    if (dist > this.flashRange) {
      sfx.creatureGrowl?.(this.headPos(), 0.8);
      this.suspicion = 1.2;
      if (!['chase', 'stalk', 'shielding'].includes(this.state)) this.stalk();
      return false;
    }
    const now = this.t;
    this.stuns = this.stuns.filter((t) => now - t < 50);
    const n = this.stuns.length;
    this.stuns.push(now);
    if (n >= 2) {
      sfx.creatureGrowl?.(this.headPos(), 1.2);
      this.anim.play('shield', { from: cam.clone(), dur: 0.9 });
      this.set('shielding');
      this.enraged = 9;
      return false;
    }
    sfx.creatureScream(this.headPos(), { dur: n ? 0.8 : 1.3 });
    this.anim.play('recoil', { from: cam.clone(), dur: n ? 0.55 : 1.0 });
    this.set('stunned', { dur: n ? 0.6 : 1.2, second: n === 1 });
    return true;
  }
  headPos() { return this.c.bone.head.getWorldPosition(new THREE.Vector3()); }

  // ---------------------------------------------------------------- brain
  update(dt) {
    this.t += dt; this.stateT += dt;
    this.enraged = Math.max(0, this.enraged - dt);
    if (!this.enabled || this.state === 'scripted') return;
    const g = this.game, cam = g.camera.position;
    const vis = this.playerVisibility();
    const dPlayer = Math.hypot(cam.x - this.pos.x, cam.z - this.pos.z);
    if (vis > 0) { this.suspicion = Math.min(1.2, this.suspicion + dt * (0.35 + vis * 2.2) * this.aggression); this.lastSeen = V(cam.x, cam.z); this.lostT = 0; }
    else { this.suspicion = Math.max(0, this.suspicion - dt * 0.12); this.lostT += dt; }
    this.sounds(dt, dPlayer);

    switch (this.state) {
      case 'idle': this.nextPatrol(); break;
      case 'patrol':
        if (this.suspicion > 0.3) { this.notice(); break; }
        if (this.noiseQ) { this.investigate(); break; }
        if (this.data.arrived && this.stateT > (this.data.wait ?? 0)) this.nextPatrol();
        break;
      case 'notice': // it stops and stares toward where it thinks you are
        if (this.suspicion >= 1) { this.engage(dPlayer); break; }
        if (this.suspicion < 0.12 && this.stateT > 2.5) { this.anim.play('lookAround'); this.set('search', { until: 5 }); break; }
        if (this.noiseQ && this.stateT > 1) this.investigate();
        break;
      case 'investigate':
        if (this.suspicion >= 1) { this.engage(dPlayer); break; }
        if (this.noiseQ && this.stateT > 0.8) this.investigate();
        if (this.data.arrived) { sfx.creatureSniff(this.headPos()); this.anim.play('lookAround'); this.set('search', { until: rand(5, 8) }); }
        break;
      case 'search':
        if (this.suspicion >= 1) { this.engage(dPlayer); break; }
        if (this.suspicion > 0.45) { this.notice(); break; }
        if (this.noiseQ) { this.investigate(); break; }
        if (this.stateT > this.data.until) this.nextPatrol();
        break;
      case 'stalk':
        this.replanT -= dt;
        if (vis <= 0 && this.lostT > 5) { this.investigateAt(this.lastSeen); break; }
        if (dPlayer < 4.5 || g.player.running || (vis > 0.65 && this.stateT > 4)) { this.chase(); break; }
        if (this.replanT <= 0) { this.replanT = 1.2; const p = this.pathTo(cam.x, cam.z); if (p) this.follow(p, 'stalk', { gaze: 'player', stopAt: 3.5 }); }
        break;
      case 'chase': {
        this.replanT -= dt;
        if (vis <= 0 && this.lostT > 3.5 && !this.sawHide) { this.investigateAt(this.lastSeen, 'walk'); break; }
        if (this.isLit?.(cam.x, cam.z) && this.enraged <= 0) { this.lurk(); break; }
        if (dPlayer < 1.45 && !this.playerHidden) { this.attack(); break; }
        if (this.playerHidden && this.sawHide && dPlayer < 1.6) { this.attack(); break; }
        if (this.replanT <= 0) {
          this.replanT = 0.45;
          const tgt = (this.sawHide || vis > 0 ? cam : this.lastSeen) || cam;
          const p = this.pathTo(tgt.x, tgt.z);
          if (p) this.follow(p, 'run', { gaze: 'player', lookFreq: 3, speed: this.enraged > 0 ? 4.1 : 3.4 });
        }
        break;
      }
      case 'lurk': // at the edge of the light: it waits, and watches you
        if (!this.isLit?.(cam.x, cam.z) && this.stateT > 1.5) { this.chase(); break; }
        if (this.stateT > this.data.until) { this.investigateAt(this.lastSeen || V(cam.x, cam.z)); }
        break;
      case 'stunned':
        if (this.stateT > (this.data.dur ?? 1)) {
          if (this.data.second) { this.suspicion = 1.0; this.stalk(); } // it does not go far the second time
          else this.retreatFrom(cam, rand(6, 9));
        }
        break;
      case 'shielding': // eyes covered, it pushes through the light
        if (this.stateT > 0.85) this.chase();
        break;
      case 'retreat':
        // it backs into the dark, waits, and comes back the way it went
        if (this.data.arrived || this.stateT > 7) {
          if (!this.data.holdT) { this.data.holdT = this.stateT; this.anim.play('idle', { stare: true }); }
          if (this.stateT - this.data.holdT > rand(1.5, 3.5)) { this.suspicion = 0.8; this.stalk(); }
        }
        break;
      case 'attack': break;
      default: break;
    }
  }

  sounds(dt, dPlayer) {
    const moving = this.anim.vel.lengthSq() > 0.04;
    this.moveSoundT -= dt;
    if (moving && this.moveSoundT <= 0) {
      const sp = Math.sqrt(this.anim.vel.lengthSq());
      this.moveSoundT = sp > 2 ? 0.28 : 0.62;
      sfx.creatureMove(this.pos, { speed: Math.min(1, sp / 3.3) });
      if (Math.random() < 0.15) sfx.creatureClick(this.pos);
    }
    this.breathT -= dt;
    if (this.breathT <= 0 && dPlayer < 9) { this.breathT = rand(2.6, 4.2); sfx.creatureBreath(this.headPos(), { intensity: this.state === 'chase' ? 1 : 0.45 }); }
    if (Math.random() < dt * 0.04 && dPlayer < 14) sfx.creatureCrack(this.pos);
  }

  nextPatrol() {
    const pts = this.patrol;
    let tries = 0, p;
    const cam = this.game.camera.position;
    if (Math.random() < this.hunt) {
      // it drifts toward where it last heard you, or simply toward you: the nearest patrol points to the player
      const ref = this.lastSeen && Math.random() < 0.5 ? this.lastSeen : cam;
      const near = pts.map((q, i) => [Math.hypot(q.x - ref.x, q.z - ref.z) + Math.random() * 6, i]).filter(([, i]) => !this.isLit?.(pts[i].x, pts[i].z)).sort((a, b) => a[0] - b[0]);
      if (near.length) { this.patrolI = near[0][1]; p = pts[this.patrolI]; }
    }
    if (!p) do { this.patrolI = (this.patrolI + 1 + (Math.random() < 0.3 ? 1 : 0)) % pts.length; p = pts[this.patrolI]; } while (this.isLit?.(p.x, p.z) && tries++ < pts.length);
    const path = this.pathTo(p.x, p.z);
    if (!path) { this.set('patrol', { arrived: true, wait: 1 }); return; }
    const mode = p.mode || (Math.random() < 0.25 ? 'crawl' : 'walk');
    const st = { arrived: false, wait: p.wait ?? rand(1, 2.6) };
    this.set('patrol', st);
    this.follow(path, mode, { gaze: 'forward', onArrive: () => { st.arrived = true; if (p.look) this.anim.play('lookAround'); } });
  }
  notice() {
    this.set('notice');
    this.anim.play('idle', { stare: true });
  }
  engage(d) { if (d > 7) this.stalk(); else this.chase(); }
  stalk() { this.set('stalk'); this.replanT = 0; }
  chase() {
    if (this.state !== 'chase') { sfx.creatureScream(this.headPos(), { dur: 1.8 }); sfx.stinger('hit'); this.onChase?.(); }
    this.set('chase'); this.replanT = 0;
  }
  investigate() { const n = this.noiseQ; this.noiseQ = null; this.investigateAt(V(n.x, n.z), n.loud > 12 ? 'walk' : 'walk'); }
  investigateAt(p, mode = 'walk') {
    if (!p) { this.nextPatrol(); return; }
    const path = this.pathTo(p.x, p.z);
    const st = { arrived: !path };
    this.set('investigate', st);
    if (path) this.follow(path, mode, { onArrive: () => { st.arrived = true; } });
  }
  lurk() {
    // stop at the last dark point and watch
    this.set('lurk', { until: rand(8, 14) });
    this.anim.play('idle', { stare: true });
  }
  retreatFrom(from, dist) {
    const p = this.pos, dx = p.x - from.x, dz = p.z - from.z, d = Math.hypot(dx, dz) || 1;
    let best = null;
    for (let k = 0; k < 10 && !best; k++) {
      const a = Math.atan2(dx, dz) + rand(-0.9, 0.9);
      const q = this.grid.nearestWalkable(p.x + Math.sin(a) * dist, p.z + Math.cos(a) * dist, 6);
      if (q && !this.isLit?.(q.x, q.z)) best = q;
    }
    const path = best && this.pathTo(best.x, best.z);
    const st = { arrived: !path };
    this.set('retreat', st);
    this.suspicion = 0.2;
    if (path) this.follow(path, 'crawl', { speed: 1.6, onArrive: () => { st.arrived = true; } });
  }
  attack() {
    this.set('attack');
    this.anim.play('attack', { onHit: () => this.onKill?.() });
  }
  // the level takes over (set pieces)
  script(on) { this.set(on ? 'scripted' : 'idle'); }
}
