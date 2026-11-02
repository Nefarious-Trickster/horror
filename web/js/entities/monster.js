import * as THREE from 'three';
import { MonsterModel } from './monsterModel.js';

const SPEED = { patrol: 1.25, investigate: 2.2, search: 1.1, chase: 3.85, retreat: 2.0, checkLocker: 1.6 };

export class Monster {
  constructor(game) {
    this.game = game;
    this.model = new MonsterModel(game.mats);
    this.root = this.model.root;
    this.root.visible = false;
    game.scene.add(this.root);
    this.pos = new THREE.Vector3(0, 0, 0);
    this.heading = 0;
    this.active = false;
    this.state = 'dormant';
    this.stateTime = 0;
    this.path = null; this.pathIdx = 0; this.pathTarget = null; this.repath = 0;
    this.awareness = 0;
    this.lastKnown = new THREE.Vector3();
    this.lastSeenTime = -99;
    this.searchCenter = new THREE.Vector3();
    this.speed = 0;
    this.stepDist = 0;
    this.vocalTimer = 3;
    this.emf = 0;
    this.knownLocker = null;
    this.lockerTarget = null;
    this.doorWait = 0;
    this.menace = 0;
    this.sinceEncounter = 0;
    this.chaseTime = 0;
    this.restrictZones = null;   // e.g. ['C','W','H','G','B','L'] before the gate opens
    this.mode = 'idle';          // animation mode
    this.puppet = false;         // scripted control
    this.seenByPlayer = 0;
    this.scaleBoost = 0;
  }

  activate(x, z, state = 'patrol') {
    this.active = true; this.puppet = false;
    this.root.visible = true;
    this.pos.set(x, 0, z);
    this.setState(state);
  }
  deactivate() { this.active = false; this.root.visible = false; this.state = 'dormant'; }

  teleport(x, z, heading = this.heading) {
    this.pos.set(x, 0, z); this.heading = heading;
    this.root.position.copy(this.pos); this.root.rotation.y = heading;
    this.model.footInit = false;
  }

  setState(s, info) {
    this.state = s; this.stateTime = 0; this.path = null; this.repath = 0;
    const a = this.game.audio;
    if (s === 'chase') { a.screech(this.headPos(), 1.6, 0.9); this.chaseTime = 0; this.game.onChaseStart?.(); }
    if (s === 'search') { this.searchCenter.copy(info || this.pos); this.searchTarget = null; this.searchLeft = 9 + Math.random() * 6; }
    if (s === 'investigate' && info) { this.investigateTarget = info.clone(); }
    if (s === 'retreat') { this.retreatTarget = this.farPoint(22); }
  }

  headPos() { return new THREE.Vector3(this.pos.x, 2.1, this.pos.z); }

  // noise from the world (footsteps, doors, bottles, alarms)
  hear(x, z, radius, kind) {
    if (!this.active || this.puppet || this.grace > 0) return;
    if (kind === 'slam') return; // its own door-bashing
    const d = Math.hypot(x - this.pos.x, z - this.pos.z);
    const lvl = this.game.level;
    const clear = lvl.los(this.pos.x, this.pos.z, x, z);
    const eff = radius * (clear ? 1 : 0.65);
    if (d > eff) return;
    const p = new THREE.Vector3(x, 0, z);
    if (this.state === 'chase') { if (kind !== 'bottle') this.lastKnown.copy(p); return; }
    if (this.state === 'checkLocker' && (kind === 'breath' || kind === 'gasp')) { this.heardInLocker = (this.heardInLocker || 0) + (kind === 'gasp' ? 5 : 1); return; }
    if (this.state === 'attack') return;
    // loud or close → go look
    this.awareness = Math.max(this.awareness, kind === 'step' ? 0.3 : 0.45);
    if (this.state !== 'investigate' || p.distanceTo(this.investigateTarget || p) > 2) {
      this.game.audio.clicks(this.headPos(), 4);
      this.setState('investigate', p);
    }
  }

  canSeePlayer() {
    const g = this.game, P = g.player;
    if (P.hidden) return 0;
    const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 26) return 0;
    if (!g.level.los(this.pos.x, this.pos.z, P.pos.x, P.pos.z)) return 0;
    if (d < 1.4) return 1;
    const fwdx = Math.sin(this.heading), fwdz = Math.cos(this.heading);
    const dot = (fwdx * dx + fwdz * dz) / d;
    // flashlight beam pointing at the creature: it sees the light from anywhere
    const flashOn = P.flashOn && P.battery > 0 && P.spot.intensity > 1;
    let beam = 0;
    if (flashOn) {
      const f = P.forward(new THREE.Vector3());
      const tm = new THREE.Vector3(this.pos.x - P.camera.position.x, 1.7 - P.camera.position.y, this.pos.z - P.camera.position.z);
      const td = tm.length(); tm.normalize();
      const ang = Math.acos(THREE.MathUtils.clamp(f.dot(tm), -1, 1));
      if (ang < 0.55 && td < 20) beam = 1 - ang / 0.55;
    }
    if (dot < Math.cos(1.15) && beam < 0.2) return 0;
    const illum = Math.min(1, g.lights.illumination(P.pos.clone().setY(1)) * 0.8);
    let lit = flashOn ? 0.75 : illum;
    if (P.crouch && !flashOn) lit *= 0.5;
    const range = 3.5 + 16 * lit + beam * 6;
    if (d > range && beam < 0.3) return 0;
    return Math.max(1 - d / range, beam * 1.4) * (dot > 0 ? 1 : 0.4 + beam);
  }

  update(dt) {
    const g = this.game;
    if (!this.active) { this.emf = 0; if (this.puppet) this.animate(dt); return; }
    this.stateTime += dt;
    this.grace = Math.max(0, (this.grace || 0) - dt);
    const graced = this.grace > 0;
    const P = g.player;
    const toP = Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
    this.emf = THREE.MathUtils.clamp(1 - toP / 11, 0, 1);

    // ---------- perception
    const see = this.state === 'attack' || graced ? 0 : this.canSeePlayer();
    if (see > 0) {
      const gain = this.state === 'chase' ? 10 : (this.state === 'investigate' || this.state === 'search' ? 2.2 : 1.4);
      this.awareness = Math.min(1.2, this.awareness + see * gain * dt);
      if (this.awareness > 0.35 || this.state === 'chase') { this.lastKnown.copy(P.pos); this.lastSeenTime = g.time; }
    } else {
      this.awareness = Math.max(0, this.awareness - dt * (this.state === 'chase' ? 0.05 : 0.08));
    }
    if (see > 0 && this.awareness >= 1 && this.state !== 'chase' && this.state !== 'attack') this.setState('chase');
    else if (see > 0 && this.awareness > 0.4 && (this.state === 'patrol' || this.state === 'retreat')) {
      this.game.audio.clicks(this.headPos(), 7);
      this.setState('investigate', P.pos.clone());
    }

    // ---------- director / menace
    const close = toP < 12;
    this.menace = THREE.MathUtils.clamp(this.menace + (this.state === 'chase' ? 0.08 : close ? 0.03 : -0.015) * dt * 4, 0, 1);
    this.sinceEncounter = close ? 0 : this.sinceEncounter + dt;

    // ---------- states
    let targetSpeed = SPEED[this.state] ?? 0;
    this.mode = 'walk';
    switch (this.state) {
      case 'patrol': {
        if (!this.path || this.pathDone()) {
          if (this.idleLeft == null) { this.idleLeft = 1.5 + Math.random() * 3.5; if (Math.random() < 0.5) g.audio.clicks(this.headPos(), 5); }
          this.idleLeft -= dt; targetSpeed = 0; this.mode = 'search';
          if (this.idleLeft <= 0) { this.idleLeft = null; this.goTo(this.patrolPoint()); }
        }
        break;
      }
      case 'investigate': {
        if (!this.path) this.goTo(this.investigateTarget);
        if (this.pathDone() || this.stateTime > 25) this.setState('search', this.investigateTarget || this.pos);
        break;
      }
      case 'search': {
        this.mode = 'search';
        this.searchLeft -= dt;
        if (!this.path || this.pathDone()) {
          if (this.pauseLeft == null) this.pauseLeft = 0.8 + Math.random() * 2;
          this.pauseLeft -= dt; targetSpeed = 0;
          if (this.pauseLeft <= 0) {
            this.pauseLeft = null;
            // maybe check a nearby locker
            const lk = this.nearbyLocker(5.5);
            if (lk && (lk === this.knownLocker || (Math.random() < 0.35 && !lk.checkedRecently))) { this.lockerTarget = lk; this.setState('checkLocker'); break; }
            const pt = this.randomNear(this.searchCenter, 5);
            if (pt) this.goTo(pt);
          }
        }
        if (this.searchLeft <= 0) { this.setState(this.menace > 0.6 ? 'retreat' : 'patrol'); }
        break;
      }
      case 'checkLocker': {
        const lk = this.lockerTarget;
        const front = lk.front;
        if (!this.path) this.goTo(front);
        if (this.pathDone() || this.pos.distanceTo(front) < 0.5) {
          targetSpeed = 0; this.mode = 'search';
          this.faceTo(lk.pos.x, lk.pos.z, dt, 6);
          if (this.listenTime == null) { this.listenTime = 0; this.heardInLocker = 0; g.audio.clicks(this.headPos(), 8); g.onLockerSniff?.(lk); }
          this.listenTime += dt;
          const occupied = P.hidden === lk;
          const known = this.knownLocker === lk;
          if (occupied && !P.holdingBreath) this.heardInLocker += dt * 0.9;
          if (occupied && (known && this.listenTime > 1.2 || this.heardInLocker > 1.6)) { this.listenTime = null; this.attack(true); break; }
          if (this.listenTime > (known ? 2 : 5 + Math.random())) {
            if (!occupied) { lk.peek?.(); }
            lk.checkedRecently = true; setTimeout(() => (lk.checkedRecently = false), 40000);
            this.listenTime = null; this.knownLocker = null;
            this.setState('search', this.pos.clone());
          }
        }
        break;
      }
      case 'chase': {
        this.mode = 'run';
        this.chaseTime += dt;
        targetSpeed = THREE.MathUtils.lerp(3.2, 4.15, Math.min(1, this.chaseTime / 6));
        const sinceSeen = g.time - this.lastSeenTime;
        if (P.hidden && sinceSeen < 0.6 && !this.knownLocker) this.knownLocker = P.hidden;
        this.repath -= dt;
        if (this.repath <= 0) { this.goTo(this.lastKnown); this.repath = 0.35; }
        // growl
        if (Math.random() < dt * 0.5) g.audio.growl(this.headPos(), 0.8, 0.5);
        if (toP < 1.25 && see > 0) { this.attack(false); break; }
        if (P.hidden && this.knownLocker === P.hidden && this.pos.distanceTo(P.hidden.front) < 0.8) { this.attack(true); break; }
        if (sinceSeen > 3.2 && (this.pathDone() || !this.path)) {
          if (this.knownLocker) { this.lockerTarget = this.knownLocker; this.setState('checkLocker'); }
          else this.setState('search', this.lastKnown.clone());
          this.awareness = 0.5;
        }
        if (this.chaseTime > 45 && sinceSeen > 1.5) { this.setState('retreat'); this.awareness = 0; }
        break;
      }
      case 'retreat': {
        if (!this.path) this.goTo(this.retreatTarget);
        if (this.pathDone() || this.stateTime > 30) { this.menace = 0.2; this.setState('patrol'); }
        break;
      }
      case 'attack': {
        targetSpeed = 0; this.mode = 'attack';
        break;
      }
    }

    // ---------- movement along path
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * (this.state === 'chase' ? 3 : 4));
    if (this.state !== 'attack') this.follow(dt);
    this.animate(dt);

    // ---------- vocal ambience
    this.vocalTimer -= dt;
    if (this.vocalTimer <= 0) {
      const r = Math.random();
      if (this.state === 'patrol') { if (r < 0.4) g.audio.clicks(this.headPos(), 5); else if (r < 0.6) g.audio.whisperCount(this.headPos(), 3 + Math.floor(Math.random() * 3)); else if (r < 0.7) g.audio.growl(this.headPos(), 1.6, 0.35); }
      if (this.state === 'search') { if (r < 0.5) g.audio.clicks(this.headPos(), 9); else g.audio.whisperCount(this.headPos(), 4); }
      this.vocalTimer = this.state === 'search' ? 2.5 + Math.random() * 3 : 5 + Math.random() * 7;
    }
  }

  attack(fromLocker) {
    this.setState('attack');
    this.game.onCaught(this, fromLocker);
  }

  // --------------------------------------------------------------- navigation
  goTo(target) {
    if (!target) return;
    const p = this.game.level.path(this.pos.x, this.pos.z, target.x, target.z);
    this.path = p; this.pathIdx = 1; this.pathTarget = target.clone ? target.clone() : target;
  }
  pathDone() { return !this.path || this.pathIdx >= this.path.length; }

  follow(dt) {
    const lvl = this.game.level;
    if (this.doorWait > 0) { this.doorWait -= dt; this.speed = 0; if (this.doorWait <= 0 && this.pendingDoor) { this.pendingDoor.open(this.pos.x, this.pos.z, true); this.pendingDoor = null; } return; }
    if (this.pathDone()) { return; }
    const tgt = this.path[this.pathIdx];
    const dx = tgt[0] - this.pos.x, dz = tgt[1] - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.35) { this.pathIdx++; return; }
    // door ahead?
    const ahead = 0.8;
    const ax = this.pos.x + (dx / d) * ahead, az = this.pos.z + (dz / d) * ahead;
    const door = lvl.doorCells.get(Math.floor(ax) + ',' + Math.floor(az));
    if (door && door.kind === 'door' && !door.isOpen() && door.target === 0) {
      this.pendingDoor = door; this.doorWait = this.state === 'chase' ? 0.25 : 0.7; this.speed = 0;
      if (this.state !== 'chase') this.game.audio.clicks(this.headPos(), 3);
      return;
    }
    if (door && !door.monsterPassable()) { this.path = null; return; }
    const desired = Math.atan2(dx, dz);
    this.faceTo(this.pos.x + dx, this.pos.z + dz, dt, this.state === 'chase' ? 8 : 4);
    let diff = Math.abs(angleDiff(desired, this.heading));
    const step = this.speed * dt * (diff > 1.2 ? 0.3 : 1);
    let nx = this.pos.x + Math.sin(this.heading) * step, nz = this.pos.z + Math.cos(this.heading) * step;
    // pull toward the path to avoid orbiting
    nx += (dx / d) * step * 0.35; nz += (dz / d) * step * 0.35;
    [nx, nz] = lvl.collide(nx, nz, 0.32, { monster: true, ignoreProps: true });
    const moved = Math.hypot(nx - this.pos.x, nz - this.pos.z);
    this.pos.x = nx; this.pos.z = nz;
    this.stepDist += moved;
    const stride = this.state === 'chase' ? 0.8 : 0.45;
    if (this.stepDist > stride) {
      this.stepDist = 0;
      const surf = this.game.surfaceAt(this.pos.x, this.pos.z);
      this.game.audio.footstep(surf, this.state === 'chase' ? 1.3 : 0.75, new THREE.Vector3(this.pos.x, 0.1, this.pos.z), true);
    }
  }

  faceTo(x, z, dt, rate) {
    const desired = Math.atan2(x - this.pos.x, z - this.pos.z);
    const diff = angleDiff(desired, this.heading);
    this.heading += THREE.MathUtils.clamp(diff, -rate * dt, rate * dt);
  }

  animate(dt) {
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading;
    // look toward the player when aware
    const P = this.game.player;
    const look = this.model.pose.look;
    if (this.active && (this.state === 'chase' || this.awareness > 0.3)) {
      const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z;
      const rel = angleDiff(Math.atan2(dx, dz), this.heading);
      look.x += (THREE.MathUtils.clamp(rel, -1, 1) - look.x) * Math.min(1, dt * 6);
    } else look.x *= 1 - Math.min(1, dt * 3);
    this.model.update(dt, this.speed, this.puppet ? this.puppetMode || 'still' : this.mode, this.root);
  }

  // --------------------------------------------------------------- helpers
  nearbyLocker(r) {
    let best = null, bd = r;
    for (const lk of this.game.world.lockers) {
      const d = lk.front.distanceTo(this.pos);
      if (d < bd) { bd = d; best = lk; }
    }
    return best;
  }
  randomNear(c, r) {
    const lvl = this.game.level;
    for (let i = 0; i < 20; i++) {
      const x = c.x + (Math.random() * 2 - 1) * r, z = c.z + (Math.random() * 2 - 1) * r;
      if (lvl.walkable(Math.floor(x), Math.floor(z)) && this.allowed(x, z) && lvl.cell(Math.floor(x), Math.floor(z)) !== 'D') return new THREE.Vector3(Math.floor(x) + 0.5, 0, Math.floor(z) + 0.5);
    }
    return null;
  }
  allowed(x, z) {
    if (!this.restrictZones) return true;
    const zn = this.game.level.zoneAt(x, z);
    return zn && this.restrictZones.includes(zn);
  }
  patrolPoint() {
    const g = this.game, P = g.player, lvl = g.level;
    // director: drift toward the player when it's been quiet, away after a scare
    const towardPlayer = this.menace < 0.35 && this.sinceEncounter > 25;
    for (let i = 0; i < 60; i++) {
      const p = lvl.randomOpenCell(this.restrictZones);
      if (!p) continue;
      const d = Math.hypot(p[0] - P.pos.x, p[1] - P.pos.z);
      if (towardPlayer ? (d > 6 && d < 15) : (d > 10)) return new THREE.Vector3(p[0], 0, p[1]);
    }
    const p = lvl.randomOpenCell(this.restrictZones);
    return p ? new THREE.Vector3(p[0], 0, p[1]) : this.pos.clone();
  }
  farPoint(minD) {
    const g = this.game, P = g.player, lvl = g.level;
    for (let i = 0; i < 80; i++) {
      const p = lvl.randomOpenCell(this.restrictZones);
      if (p && Math.hypot(p[0] - P.pos.x, p[1] - P.pos.z) > minD && !lvl.los(p[0], p[1], P.pos.x, P.pos.z)) return new THREE.Vector3(p[0], 0, p[1]);
    }
    return this.patrolPoint();
  }
}

export function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
