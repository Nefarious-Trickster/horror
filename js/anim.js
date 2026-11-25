// Procedural animation for the creature.
//
// Layers, evaluated every frame:
//   1. the current ACTION writes a target pose (bone angles, hip height, gait, gaze, jaw...)
//   2. targets are smoothed per bone, so switching actions blends instead of popping
//   3. a GAIT planner plants feet (and hands, when crawling) on the floor and steps them,
//      and two-bone IK bends the limbs to reach them: no foot sliding at any speed
//   4. GAZE aims neck and head at the viewer (or wherever the action says), with
//      unnatural holds and snaps; twitches, tremble and breathing ride on top
import * as THREE from 'three';

const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const rand = (a, b) => a + Math.random() * (b - a);
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const ease = (t) => t * t * (3 - 2 * t);
function vnoise(t, seed = 0) {
  const i = Math.floor(t), f = t - i;
  const h = (n) => { const s = Math.sin((n + seed * 57.13) * 127.1) * 43758.5453; return s - Math.floor(s); };
  const u = f * f * (3 - 2 * f);
  return (h(i) * (1 - u) + h(i + 1) * u) * 2 - 1;
}
class Spring {
  constructor(x = 0) { this.x = x; this.v = 0; }
  update(target, freq, dt) {
    const w = freq * TAU, f = 1 + 2 * dt * w, oo = w * w, hoo = dt * oo, hhoo = dt * hoo, det = 1 / (f + hhoo);
    const x = det * (f * this.x + dt * this.v + hhoo * target);
    this.v = det * (this.v + hoo * (target - this.x)); this.x = x; return x;
  }
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _e = new THREE.Euler(), _m = new THREE.Matrix4();
const Q_ID = new THREE.Quaternion();
const Q_HEAD_BIND_INV = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.12);

function setWorldQuat(bone, qWorld) {
  bone.parent.getWorldQuaternion(_q3);
  bone.quaternion.copy(_q3.invert().multiply(qWorld));
  bone.updateMatrixWorld(true);
}

// Two-bone IK in the parent's local Y-Z plane (bones are axis-aligned in the bind pose).
// bend: +1 bends the middle joint forward (knees), -1 backward (elbows).
function solveTwoBone(A, B, end, target, bend) {
  A.parent.updateWorldMatrix(true, false);
  const t = A.parent.worldToLocal(_v.copy(target)).sub(A.position);
  const v1 = B.position, v2 = end;
  const l1 = Math.hypot(v1.y, v1.z), l2 = Math.hypot(v2.y, v2.z);
  const a1b = Math.atan2(v1.z, -v1.y), a2b = Math.atan2(v2.z, -v2.y);
  const D = clamp(Math.hypot(t.y, t.z), Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.9995);
  const at = Math.atan2(t.z, -t.y);
  const th1 = at + bend * Math.acos(clamp((l1 * l1 + D * D - l2 * l2) / (2 * l1 * D), -1, 1));
  const kz = l1 * Math.sin(th1), ky = -l1 * Math.cos(th1);
  const th2 = Math.atan2(D * Math.sin(at) - kz, -(-D * Math.cos(at) - ky));
  const rA = -(th1 - a1b), rB = -(th2 - a2b) - rA;
  A.rotation.set(rA, 0, 0, 'XYZ');
  B.rotation.set(rB, 0, 0, 'XYZ');
  A.updateMatrixWorld(true);
}

// ------------------------------------------------------------------ gaits
// home: where each limb rests, in creature space [x, z]; groups: limbs that may swing together
const GAITS = {
  stand: { limbs: ['L', 'R'], home: { L: [0.15, 0.0], R: [-0.165, -0.075] }, groups: { L: 0, R: 1 }, stride: 0.4, stepTime: 0.45, height: 0.07, trigger: 0.16, lead: 0 },
  walk: { limbs: ['L', 'R'], home: { L: [0.14, -0.03], R: [-0.14, -0.03] }, groups: { L: 0, R: 1 }, stride: 0.82, stepTime: 0.42, height: 0.1, trigger: 0.36, lead: 0.05 },
  stalk: { limbs: ['L', 'R'], home: { L: [0.19, 0.0], R: [-0.19, -0.04] }, groups: { L: 0, R: 1 }, stride: 0.5, stepTime: 0.6, height: 0.07, trigger: 0.22, lead: 0.05 },
  run: { limbs: ['L', 'R'], home: { L: [0.13, -0.05], R: [-0.13, -0.05] }, groups: { L: 0, R: 1 }, stride: 1.7, stepTime: 0.23, height: 0.24, trigger: 0.55, lead: 0.1 },
  crawl: {
    limbs: ['L', 'R', 'hL', 'hR'], home: { L: [0.2, -0.12], R: [-0.2, -0.12], hL: [0.36, 1.12], hR: [-0.36, 1.12] },
    groups: { L: 0, hR: 0, R: 1, hL: 1 }, stride: 0.62, stepTime: 0.36, height: 0.11, trigger: 0.27, lead: 0.05,
  },
};

class Gait {
  constructor(anim) {
    this.a = anim;
    this.limbs = {};
    for (const k of ['L', 'R', 'hL', 'hR']) this.limbs[k] = { plant: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), pos: new THREE.Vector3(), t: 0, dur: 0.4, stepping: false, lift: 0, active: false };
    this.phase = 0; this.lastGroup = -1;
  }
  home(k, g, out) { const h = g.home[k]; return this.a.root.localToWorld(out.set(h[0], 0, h[1])).setY(0); }
  reset(g) {
    for (const k of Object.keys(this.limbs)) {
      const L = this.limbs[k];
      L.active = g.limbs.includes(k); L.stepping = false; L.lift = 0;
      if (L.active) { this.home(k, g, L.plant); L.pos.copy(L.plant); }
    }
  }
  update(dt, g, vel) {
    const speed = Math.hypot(vel.x, vel.z);
    this.phase += (speed * dt) / g.stride;
    for (const k of Object.keys(this.limbs)) {
      const L = this.limbs[k];
      if (!g.limbs.includes(k)) { L.active = false; continue; }
      if (!L.active) { // limb just joined the gait (e.g. hands going down to crawl): start from where it is
        L.active = true;
        const eff = k[0] === 'h' ? this.a.B['hand' + k[1]] : this.a.B['foot' + k];
        eff.getWorldPosition(L.plant).setY(0); L.pos.copy(L.plant); L.stepping = false;
      }
    }
    const stepping = (grp) => g.limbs.some((k) => this.limbs[k].stepping && g.groups[k] === grp);
    const home = new THREE.Vector3(), pred = new THREE.Vector3();
    for (const k of g.limbs) {
      const L = this.limbs[k];
      this.home(k, g, home);
      if (L.stepping) {
        L.t += dt / L.dur;
        const t = Math.min(L.t, 1);
        // keep re-aiming the landing point while the body moves
        L.to.copy(home).addScaledVector(vel, (1 - t) * L.dur + g.lead);
        if (speed > 0.05) L.to.addScaledVector(_v2.set(vel.x, 0, vel.z).normalize(), g.stride * 0.32);
        L.pos.lerpVectors(L.from, L.to, ease(t));
        L.lift = Math.sin(Math.PI * t) * g.height * (k[0] === 'h' ? 1.5 : 1);
        if (L.t >= 1) { L.stepping = false; L.plant.copy(L.to); L.pos.copy(L.plant); L.lift = 0; }
        continue;
      }
      pred.copy(home).addScaledVector(vel, g.lead);
      const err = Math.hypot(L.plant.x - pred.x, L.plant.z - pred.z);
      const grp = g.groups[k];
      const otherBusy = stepping(1 - grp);
      const myTurn = this.lastGroup !== grp || err > g.trigger * 2.2;
      if (err > g.trigger && !otherBusy && myTurn) {
        L.stepping = true; L.t = 0; L.dur = g.stepTime * (speed < 0.05 ? 1.2 : 1); L.from.copy(L.plant);
        L.to.copy(home); this.lastGroup = grp;
      }
    }
  }
}

// ------------------------------------------------------------------ the animator
export class Animator {
  constructor(creature, world) {
    this.c = creature; this.B = creature.bone; this.root = creature.object; this.world = world;
    this.t = 0;
    this.cur = {}; this.restPos = {};
    for (const [n, b] of Object.entries(this.B)) { this.cur[n] = [0, 0, 0]; this.restPos[n] = b.position.clone(); }
    this.hipsCur = new THREE.Vector3();
    this.ext = { // limb end offsets (bind), in the middle bone's space
      L: this.B.footL.position.clone(), R: this.B.footR.position.clone(),
      hL: this.B.handL.position.clone(), hR: this.B.handR.position.clone(),
    };
    this.ankleH = this.c.extras.bones.footL[1];
    this.gait = new Gait(this);
    this.vel = new THREE.Vector3(); this.prevPos = this.root.position.clone();
    this.gaze = { yaw: new Spring(this.root.rotation.y), pitch: new Spring(0), tYaw: this.root.rotation.y, tPitch: 0, freq: 3, next: 0, roll: new Spring(0), tRoll: 0, nextRoll: 4 };
    this.jaw = new Spring(0.02); this.tJaw = 0.02; this.nextJaw = 6;
    this.open = 0; this.breath = 0; this.twitch = []; this.shake = 0; this.tremble = 0;
    this.footFwd = { L: 0, R: 0 };
    this.home = { x: this.root.position.x, z: this.root.position.z, heading: this.root.rotation.y };
    this.action = null; this.play('idle');
    this.gait.reset(GAITS.stand);
  }

  get heading() { return this.root.rotation.y; }
  set heading(h) { this.root.rotation.y = wrap(h); }
  playerPos(out) { return out.copy(this.ctx.camera.position); }
  distToPlayer() { const p = this.ctx.camera.position, r = this.root.position; return Math.hypot(p.x - r.x, p.z - r.z); }
  yawTo(x, z) { const r = this.root.position; return Math.atan2(x - r.x, z - r.z); }
  turnTo(yaw, rate, dt) { const e = wrap(yaw - this.heading); this.heading += clamp(e, -rate * dt, rate * dt); return Math.abs(e); }

  // steer toward a point around furniture and walls; returns remaining distance
  moveToward(tx, tz, speed, dt, turnRate = 2, stopAt = 0) {
    const p = this.root.position;
    let dx = tx - p.x, dz = tz - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= stopAt + 1e-3) return dist;
    dx /= dist; dz /= dist;
    for (const c of this.world.colliders) {
      const cx = clamp(p.x, c.minX, c.maxX), cz = clamp(p.z, c.minZ, c.maxZ);
      const ox = p.x - cx, oz = p.z - cz, d = Math.hypot(ox, oz) || 1e-3, Rr = 1.1;
      if (d < Rr) { const w = (1 - d / Rr) * 2.2; dx += (ox / d) * w; dz += (oz / d) * w; }
    }
    const { min, max } = this.world.bounds, m = 0.8;
    if (p.x < min.x + m) dx += (1 - (p.x - min.x) / m) * 1.5;
    if (p.x > max.x - m) dx -= (1 - (max.x - p.x) / m) * 1.5;
    if (p.z < min.z + m) dz += (1 - (p.z - min.z) / m) * 1.5;
    if (p.z > max.z - m) dz -= (1 - (max.z - p.z) / m) * 1.5;
    const err = wrap(Math.atan2(dx, dz) - this.heading);
    this.heading += clamp(err, -turnRate * dt, turnRate * dt);
    const step = Math.min(speed * Math.max(0.2, Math.cos(err)) * dt, Math.max(0, dist - stopAt));
    p.x += Math.sin(this.heading) * step; p.z += Math.cos(this.heading) * step;
    p.x = clamp(p.x, min.x + 0.35, max.x - 0.35); p.z = clamp(p.z, min.z + 0.35, max.z - 0.35);
    return dist - step;
  }

  kick(bone, axis, amount, dur = rand(0.08, 0.2)) { this.twitch.push({ bone, axis, amount, t: 0, dur }); }
  twitchVal(bone, axis) {
    let s = 0;
    for (const k of this.twitch) if (k.bone === bone && k.axis === axis) s += k.amount * (k.t < k.dur ? Math.sin((k.t / k.dur) * Math.PI * 0.5) : Math.exp(-(k.t - k.dur) * 9));
    return s;
  }

  play(name) {
    const A = ACTIONS[name];
    if (!A) return;
    if (name === 'reset') { this.reset(); return; }
    this.actionName = name;
    this.action = new A(this);
    this.onAction?.(name);
  }
  reset() {
    this.root.position.set(this.home.x, 0, this.home.z);
    this.heading = this.home.heading;
    this.prevPos.copy(this.root.position); this.vel.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
    this.gait.reset(GAITS.stand);
    this.world.door?.reset();
    this.play('idle');
  }

  update(dt, ctx) {
    this.ctx = ctx; this.t += dt;
    const t = this.t, B = this.B;
    const P = { rot: {}, hips: [0, 0, 0], rate: 5, armRate: null, look: 1, lookAt: null, scan: null, lookFreq: null, jaw: null, open: 0, gait: GAITS.stand, feet: null, tremble: 0, breathe: 1, twitchiness: 1 };
    P.near = 1 - smooth(1.1, 3.6, this.distToPlayer());
    const res = this.action.update(dt, this, P);
    if (res && typeof res === 'string') this.play(res);

    // velocity of the body over the floor
    if (dt > 0) this.vel.copy(this.root.position).sub(this.prevPos).divideScalar(dt);
    this.prevPos.copy(this.root.position);
    this.root.updateMatrixWorld(true);

    // ---- pose targets -> smoothed bone angles
    this.breath += dt * (0.2 + P.near * 0.35 + P.breathe * 0.1) * (1 + 0.35 * vnoise(t * 0.3, 3)) * TAU;
    const br = Math.pow(Math.sin(this.breath) * 0.5 + 0.5, 1.6) * P.breathe;
    this.tremble = damp(this.tremble, P.tremble, 6, dt);
    if (Math.random() < dt * (0.25 + P.near * 1.2) * P.twitchiness) {
      const r = Math.random();
      if (r < 0.4) this.kick('head', ['x', 'y', 'z'][Math.random() * 3 | 0], rand(-0.16, 0.16));
      else if (r < 0.55) this.kick('neck2', 'y', rand(-0.1, 0.1));
      else this.kick(`f${Math.random() < 0.5 ? 'L' : 'R'}${Math.random() * 4 | 0}_${1 + (Math.random() * 3 | 0)}`, 'z', rand(-0.5, 0.5));
    }
    this.twitch = this.twitch.filter((k) => (k.t += dt) < k.dur + 0.5);

    const skip = new Set(['thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR', 'root']);
    if (P.gait?.limbs.includes('hL')) for (const n of ['upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR']) skip.add(n);
    const armBones = /^(clavicle|upperArm|forearm|hand)/;
    for (const n of Object.keys(B)) {
      if (skip.has(n) || /^(f[LR]\d|thumb)/.test(n) || n === 'jaw') continue;
      const tgt = P.rot[n] || ZERO3, c = this.cur[n];
      const rate = P.armRate && armBones.test(n) ? P.armRate : P.rate;
      for (let i = 0; i < 3; i++) c[i] = damp(c[i], tgt[i], rate, dt);
      let x = c[0], y = c[1], z = c[2];
      if (this.tremble > 0.01 && TREMBLE.has(n)) {
        const k = this.tremble * TREMBLE.get(n);
        x += vnoise(t * 23, n.length * 3.1) * k; y += vnoise(t * 19, n.length * 5.7) * k; z += vnoise(t * 21, n.length * 7.3) * k;
      }
      B[n].rotation.set(x, y, z, 'XYZ');
    }
    // breathing rides on the ribcage and shoulders
    B.ribcage.scale.set(1 + br * 0.035, 1 + br * 0.015, 1 + br * 0.05);
    B.upperChest.rotation.x -= br * 0.012;
    // hips height / offset (crouching, crawling, flight)
    this.hipsCur.set(damp(this.hipsCur.x, P.hips[0], P.rate, dt), damp(this.hipsCur.y, P.hips[1], P.rate, dt), damp(this.hipsCur.z, P.hips[2], P.rate, dt));
    B.hips.position.copy(this.restPos.hips).add(this.hipsCur);

    // fingers: open/clench, idle fidget, twitches
    this.open = damp(this.open, P.open, 4, dt);
    for (const [L, s] of [['L', 1], ['R', -1]]) {
      for (let i = 0; i < 4; i++) for (let j = 1; j <= 3; j++) {
        const n = `f${L}${i}_${j}`;
        const curl = vnoise(t * 0.4 + i * 1.7 + j, s * 9 + i) * 0.08 - this.open * 0.35 * (j === 1 ? 0.6 : 1) + this.twitchVal(n, 'z');
        B[n].rotation.set(0, 0, -s * curl);
      }
      B[`thumb${L}_2`].rotation.set(0, 0, -s * (vnoise(t * 0.3, s * 13) * 0.08 - this.open * 0.25));
    }
    this.root.updateMatrixWorld(true);

    // ---- feet and hands: gait planner + IK
    const g = P.gait;
    if (g) this.gait.update(dt, g, this.vel);
    for (const k of ['L', 'R']) {
      const target = _v2;
      if (P.feet?.[k]) target.copy(P.feet[k]);
      else { const L = this.gait.limbs[k]; target.copy(L.pos); target.y = this.ankleH + L.lift; }
      solveTwoBone(B['thigh' + k], B['shin' + k], this.ext[k], target, 1);
      // keep the foot level with the floor, toes lifting through the swing
      const L = this.gait.limbs[k];
      const pitch = P.feet ? (P.footPitch ?? 0.5) : -L.lift * 2.5;
      this.root.getWorldQuaternion(_q);
      _q2.setFromEuler(_e.set(pitch, (k === 'L' ? 0.08 : -0.12), 0, 'YXZ'));
      setWorldQuat(B['foot' + k], _q.multiply(_q2));
      // how far forward this foot is, for arm swing
      this.footFwd[k] = this.root.worldToLocal(B['foot' + k].getWorldPosition(_v)).z - (g?.home[k]?.[1] ?? 0);
    }
    if (g?.limbs.includes('hL')) {
      for (const [k, s] of [['hL', 1], ['hR', -1]]) {
        const L = this.gait.limbs[k];
        const target = _v2.copy(L.pos); target.y = 0.045 + L.lift;
        solveTwoBone(B['upperArm' + k[1]], B['forearm' + k[1]], this.ext[k], target, -1);
        // hand flat on the floor, long fingers splayed forward
        this.root.getWorldQuaternion(_q);
        _q2.setFromAxisAngle(_v.set(0, 1, 0), s * 0.35 + L.lift * 2 * s);
        _q.multiply(_q2);
        _q2.setFromAxisAngle(_v.set(0, 0, 1), s * Math.PI / 2); _q.multiply(_q2);
        _q2.setFromAxisAngle(_v.set(1, 0, 0), -Math.PI / 2 + L.lift * 3); _q.multiply(_q2);
        setWorldQuat(B['hand' + k[1]], _q);
      }
      // remember where the IK put the arms, so standing back up blends from here instead of snapping
      for (const n of ['upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR']) {
        _e.setFromQuaternion(B[n].quaternion, 'XYZ'); this.cur[n][0] = _e.x; this.cur[n][1] = _e.y; this.cur[n][2] = _e.z;
      }
    }

    // ---- gaze
    this.updateGaze(dt, P);

    // ---- jaw
    if (t > this.nextJaw) { this.tJaw = this.tJaw > 0.1 ? 0.02 : rand(0.15, 0.4); this.nextJaw = t + (this.tJaw > 0.1 ? rand(1.5, 4) : rand(5, 12)); }
    const jt = P.jaw ?? Math.max(this.tJaw + 0.1, P.near * 0.55);
    const jaw = this.jaw.update(jt, P.jaw != null ? 3 : 0.5 + P.near, dt) + Math.sin(t * 37) * 0.006 * (0.3 + clamp(this.jaw.x / 0.5, 0, 1)) + this.tremble * vnoise(t * 30, 2) * 0.05;
    B.jaw.rotation.set(jaw, 0, Math.sin(t * 1.3) * 0.015 * jaw);

    this.shake = damp(this.shake, 0, 4, dt);
    this.root.updateMatrixWorld(true);
    return { near: P.near };
  }

  updateGaze(dt, P) {
    const G = this.gaze, B = this.B, t = this.t;
    const headPos = B.head.getWorldPosition(_v);
    let yawW, pitchW;
    if (P.scan) { yawW = this.heading + P.scan.yaw; pitchW = P.scan.pitch; }
    else {
      const tp = P.lookAt || this.ctx.camera.position;
      yawW = Math.atan2(tp.x - headPos.x, tp.z - headPos.z);
      pitchW = Math.atan2(tp.y - headPos.y, Math.hypot(tp.x - headPos.x, tp.z - headPos.z));
    }
    // unnatural holds, then a snap (or a slow, creeping turn)
    if (t > G.next || P.scan || P.lookFreq) {
      G.tYaw = G.yaw.x + wrap(yawW - G.yaw.x); G.tPitch = pitchW;
      if (P.lookFreq || P.scan) G.freq = P.lookFreq || 2.5;
      else {
        const snap = Math.random() < 0.55 + P.near * 0.4;
        G.freq = snap ? rand(5, 9) : rand(0.25, 0.6);
        G.next = t + (snap ? rand(0.6, 2.8) : rand(2.5, 4.5)) * (1 - P.near * 0.8);
        if (snap && Math.random() < 0.5) this.kick('head', 'z', rand(-0.18, 0.18));
      }
    }
    const yaw = G.yaw.update(G.tYaw, G.freq, dt);
    const pitch = G.pitch.update(clamp(G.tPitch, -1.1, 1.0), G.freq, dt);
    if (t > G.nextRoll) { G.tRoll = G.tRoll !== 0 && Math.random() < 0.6 ? 0 : rand(0.35, 0.75) * (Math.random() < 0.5 ? -1 : 1); G.nextRoll = t + rand(3, 9) * (1 - P.near * 0.5); }
    const roll = G.roll.update(P.roll ?? (G.tRoll + P.near * 0.25 * Math.sign(G.tRoll || 1)), 0.8, dt);

    // desired world orientation of the head
    const qd = _q.setFromEuler(_e.set(-pitch, yaw, 0, 'YXZ'));
    qd.multiply(_q2.setFromAxisAngle(_v2.set(0, 0, 1), roll)).multiply(Q_HEAD_BIND_INV);
    const w = clamp(P.look, 0, 1);
    // spread the turn down the neck; the head takes whatever is left (it can turn much further than a person's)
    for (const [n, frac] of [['neck', 0.22], ['neck2', 0.4], ['head', 1]]) {
      const bone = B[n];
      const qh = B.head.getWorldQuaternion(new THREE.Quaternion());
      const delta = qd.clone().multiply(qh.invert()); // world rotation still needed at the head
      const ang = 2 * Math.acos(clamp(Math.abs(delta.w), 0, 1));
      const lim = ang > 2.7 ? 2.7 / ang : 1;
      const step = new THREE.Quaternion().slerp(delta, w * frac * lim);
      const qb = bone.getWorldQuaternion(new THREE.Quaternion());
      setWorldQuat(bone, step.multiply(qb));
    }
    // twitches on top
    const tw = _q2.setFromEuler(_e.set(this.twitchVal('head', 'x'), this.twitchVal('head', 'y'), this.twitchVal('head', 'z')));
    B.head.quaternion.multiply(tw);
    B.neck2.quaternion.multiply(_q2.setFromEuler(_e.set(0, this.twitchVal('neck2', 'y'), 0)));
  }
}
const ZERO3 = [0, 0, 0];
const TREMBLE = new Map([['spine', 0.03], ['chest', 0.04], ['upperChest', 0.05], ['neck', 0.06], ['neck2', 0.07], ['head', 0.08], ['clavicleL', 0.06], ['clavicleR', 0.06], ['upperArmL', 0.08], ['upperArmR', 0.08], ['forearmL', 0.1], ['forearmR', 0.1], ['handL', 0.15], ['handR', 0.15], ['hips', 0.02]]);

// ------------------------------------------------------------------ pose helpers
function armsHang(P, reach = 0, sway = 0) {
  for (const [L, s] of [['L', 1], ['R', -1]]) {
    P.rot['clavicle' + L] = [0, 0, s * 0.05 * reach + (s < 0 ? 0.06 : 0)];
    P.rot['upperArm' + L] = [-0.32 * reach + sway * s, 0, s * (0.02 + 0.06 * reach)];
    P.rot['forearm' + L] = [-0.38 * reach + sway * 0.5 * s, 0, 0];
    P.rot['hand' + L] = [0.1 * reach, 0, -s * 0.1 * reach];
  }
}
function armsSwing(P, a, amt, base = 0, bend = -0.15, out = 0.04) {
  for (const [L, s] of [['L', 1], ['R', -1]]) {
    const f = a.footFwd[L === 'L' ? 'R' : 'L']; // arms swing with the opposite leg
    P.rot['clavicle' + L] = [0, 0, s < 0 ? 0.06 : 0];
    P.rot['upperArm' + L] = [base - f * amt, 0, s * out];
    P.rot['forearm' + L] = [bend - f * amt * 0.6, 0, 0];
    P.rot['hand' + L] = [0.1, 0, 0];
  }
}
const PATROL = [[2.4, -4.4], [2.9, -1.2], [2.4, 2.4], [-0.6, 3.1], [-1.4, 0.1], [-0.9, -4.6]];
function nearestIndex(a, pts) {
  let best = 0, bd = Infinity; const p = a.root.position;
  pts.forEach(([x, z], i) => { const d = Math.hypot(x - p.x, z - p.z); if (d < bd) { bd = d; best = i; } });
  return best;
}

// ------------------------------------------------------------------ actions
class Idle {
  update(dt, a, P) {
    const reach = smooth(0.35, 0.9, P.near);
    P.rot.hips = [0, vnoise(a.t * 0.2, 1) * 0.02, 0.035 + vnoise(a.t * 0.17, 2) * 0.012];
    P.rot.spine = [0.03 * P.near, 0, 0]; P.rot.chest = [0.05 * P.near, 0, 0]; P.rot.upperChest = [0.08 * P.near, 0, 0];
    armsHang(P, reach, vnoise(a.t * 0.35, 5) * 0.03);
    P.open = smooth(0.2, 0.8, P.near);
    P.rate = 2.5;
  }
}

class Walk {
  constructor(a, crawl = false) { this.i = nearestIndex(a, PATROL); this.crawl = crawl; }
  update(dt, a, P) {
    const [x, z] = PATROL[this.i];
    const speed = this.crawl ? 0.75 : 0.9;
    if (a.moveToward(x, z, speed, dt, this.crawl ? 1.1 : 1.7) < 0.6) this.i = (this.i + 1) % PATROL.length;
    const ph = a.gait.phase * TAU;
    if (this.crawl) crawlPose(a, P, ph); else walkPose(a, P);
  }
}

function crawlPose(a, P, ph) {
  // a long-limbed thing on all fours: hips high, back nearly level, head craned up at you
  P.gait = GAITS.crawl;
  P.hips = [0, -0.36 - 0.015 * Math.abs(Math.cos(ph)), 0];
  P.rot.hips = [1.22, 0.07 * Math.sin(ph), 0.05 * Math.sin(ph)];
  P.rot.spine = [0.16, -0.06 * Math.sin(ph), 0];
  P.rot.chest = [0.1, -0.06 * Math.sin(ph), 0];
  P.rot.upperChest = [0.06, -0.05 * Math.sin(ph), 0];
  P.rot.neck = [-0.8, 0, 0]; P.rot.neck2 = [-0.5, 0, 0]; P.rot.head = [-0.3, 0, 0];
  P.rot.clavicleL = [0.1, 0, 0.22]; P.rot.clavicleR = [0.1, 0, -0.22];
  P.open = 1.2; P.rate = 5;
}

class Crawl extends Walk { constructor(a) { super(a, true); } }

class Stalk {
  update(dt, a, P) {
    const p = a.ctx.camera.position;
    const d = a.moveToward(p.x, p.z, 0.5, dt, 1.2, 2.2);
    if (d <= 2.25) a.turnTo(a.yawTo(p.x, p.z), 1.2, dt);
    P.gait = GAITS.stalk;
    const ph = a.gait.phase * TAU;
    P.hips = [0, -0.27 - 0.015 * Math.abs(Math.cos(ph)), 0];
    P.rot.hips = [0.32, 0.05 * Math.sin(ph), 0.04 * Math.sin(ph)];
    P.rot.spine = [0.18, 0, 0]; P.rot.chest = [0.12, 0, 0]; P.rot.upperChest = [0.12, 0, 0];
    P.rot.neck = [-0.25, 0, 0];
    for (const [L, s] of [['L', 1], ['R', -1]]) {
      const f = a.footFwd[L === 'L' ? 'R' : 'L'];
      P.rot['clavicle' + L] = [0, 0, s * 0.12];
      P.rot['upperArm' + L] = [-0.55 - f * 0.4, 0, s * 0.18];
      P.rot['forearm' + L] = [-0.7, 0, 0];
      P.rot['hand' + L] = [0.35, 0, -s * 0.2];
    }
    P.open = 1; P.rate = 4; P.lookFreq = 6; P.twitchiness = 2.5;
  }
}

class Chase {
  constructor() { this.t = 0; this.phase = 'run'; }
  update(dt, a, P) {
    this.t += dt;
    const p = a.ctx.camera.position;
    if (this.phase === 'run') {
      const d = a.moveToward(p.x, p.z, Math.min(3.8, 1 + this.t * 4), dt, 3.2, 1.25);
      P.gait = GAITS.run;
      const ph = a.gait.phase * TAU;
      P.hips = [0, -0.14 - 0.05 * Math.abs(Math.cos(ph)), 0];
      P.rot.hips = [0.3, 0.12 * Math.sin(ph), 0.05 * Math.sin(ph)];
      P.rot.spine = [0.22, -0.1 * Math.sin(ph), 0]; P.rot.chest = [0.16, -0.1 * Math.sin(ph), 0]; P.rot.upperChest = [0.12, -0.08 * Math.sin(ph), 0];
      P.rot.neck = [-0.35, 0, 0];
      armsSwing(P, a, 2.2, -0.35, -0.7, 0.3);
      P.rate = 10; P.armRate = 7; P.open = 1; P.jaw = 0.55; P.lookFreq = 12; P.tremble = 0.3;
      if (d <= 1.3) { this.phase = 'lunge'; this.t = 0; a.shake += 0.6; }
    } else {
      a.turnTo(a.yawTo(p.x, p.z), 6, dt);
      P.gait = GAITS.stand;
      P.hips = [0, -0.12, 0.08];
      P.rot.hips = [0.25, 0, 0]; P.rot.spine = [0.3, 0, 0]; P.rot.chest = [0.2, 0, 0]; P.rot.upperChest = [0.2, 0, 0];
      for (const [L, s] of [['L', 1], ['R', -1]]) {
        P.rot['clavicle' + L] = [0, 0, s * 0.25];
        P.rot['upperArm' + L] = [-1.45, 0, s * 0.35];
        P.rot['forearm' + L] = [-0.25, 0, 0];
        P.rot['hand' + L] = [0.4, 0, 0];
      }
      P.open = 1.3; P.jaw = 1.0; P.rate = 14; P.lookFreq = 14; P.tremble = 0.5;
      if (this.t > 0.7) return 'scream';
    }
  }
}

class Leap {
  constructor() { this.t = 0; this.phase = 'crouch'; }
  aim(a) {
    const p = a.ctx.camera.position, r = a.root.position;
    const d = Math.hypot(p.x - r.x, p.z - r.z);
    const yaw = d > 0.5 ? a.yawTo(p.x, p.z) : a.heading;
    const L = clamp(d - 1.4, 1.2, 4.2);
    this.yaw = yaw;
    this.from = r.clone();
    const { min, max } = a.world.bounds;
    this.to = new THREE.Vector3(clamp(r.x + Math.sin(yaw) * L, min.x + 0.6, max.x - 0.6), 0, clamp(r.z + Math.cos(yaw) * L, min.z + 0.6, max.z - 0.6));
  }
  update(dt, a, P) {
    if (!this.to) this.aim(a);
    this.t += dt;
    const crouch = (P2, amt) => {
      P2.hips = [0, -0.42 * amt, -0.05 * amt];
      P2.rot.hips = [0.45 * amt, 0, 0]; P2.rot.spine = [0.25 * amt, 0, 0]; P2.rot.chest = [0.15 * amt, 0, 0]; P2.rot.upperChest = [0.1 * amt, 0, 0];
      P2.rot.neck = [-0.45 * amt, 0, 0];
    };
    if (this.phase === 'crouch') {
      a.turnTo(this.yaw, 5, dt);
      crouch(P, 1);
      for (const [L, s] of [['L', 1], ['R', -1]]) {
        P.rot['upperArm' + L] = [0.75, 0, s * 0.3]; P.rot['forearm' + L] = [-0.6, 0, 0]; P.rot['hand' + L] = [0.4, 0, 0];
        P.rot['clavicle' + L] = [0, 0, s * 0.1];
      }
      P.rate = 6; P.open = 1; P.tremble = 0.25 + this.t * 0.4; P.lookFreq = 10;
      if (this.t > 0.7) { this.phase = 'fly'; this.t = 0; this.dur = 0.36 + this.from.distanceTo(this.to) * 0.08; }
    } else if (this.phase === 'fly') {
      const u = Math.min(this.t / this.dur, 1);
      a.root.position.lerpVectors(this.from, this.to, u);
      const lift = 4 * u * (1 - u) * (0.45 + this.from.distanceTo(this.to) * 0.04);
      // a flat, diving pounce: body level, claws reaching for you, legs streaming behind
      P.hips = [0, -0.25 + lift, 0];
      P.rot.hips = [1.05, 0, 0]; P.rot.spine = [0.25, 0, 0]; P.rot.chest = [0.1, 0, 0]; P.rot.upperChest = [0.05, 0, 0];
      P.rot.neck = [-0.95, 0, 0]; P.rot.neck2 = [-0.4, 0, 0];
      for (const [L, s] of [['L', 1], ['R', -1]]) {
        P.rot['clavicle' + L] = [0, 0, s * 0.3];
        P.rot['upperArm' + L] = [-0.6, 0, s * 0.55]; P.rot['forearm' + L] = [-0.35, 0, 0]; P.rot['hand' + L] = [0.6, 0, -s * 0.2];
      }
      // legs trail behind the body
      a.root.updateMatrixWorld(true);
      const hp = a.B.hips.getWorldPosition(new THREE.Vector3());
      const fwd = new THREE.Vector3(Math.sin(a.heading), 0, Math.cos(a.heading)), side = new THREE.Vector3(Math.cos(a.heading), 0, -Math.sin(a.heading));
      P.feet = {
        L: hp.clone().addScaledVector(side, 0.16).addScaledVector(fwd, -1.0 + 0.25 * u).add(new THREE.Vector3(0, -0.35 - 0.25 * u, 0)),
        R: hp.clone().addScaledVector(side, -0.16).addScaledVector(fwd, -0.85 + 0.35 * u).add(new THREE.Vector3(0, -0.45 - 0.25 * u, 0)),
      };
      P.footPitch = 1.4; P.rate = 12; P.open = 1.4; P.jaw = 0.95; P.lookFreq = 14; P.tremble = 0.2;
      if (u >= 1) { this.phase = 'land'; this.t = 0; a.gait.reset(GAITS.stand); a.shake += 1.2; a.hipsCur.y = -0.5; }
    } else if (this.phase === 'land') {
      crouch(P, this.t < 0.35 ? 1.1 : 0.5);
      for (const [L, s] of [['L', 1], ['R', -1]]) {
        P.rot['upperArm' + L] = [-0.9, 0, s * 0.45]; P.rot['forearm' + L] = [-0.5, 0, 0]; P.rot['clavicle' + L] = [0, 0, s * 0.2];
      }
      P.rate = this.t < 0.35 ? 14 : 3; P.open = 1.2; P.jaw = 0.6; P.lookFreq = 10;
      if (this.t > 1.4) return 'idle';
    }
  }
}

class LookAround {
  constructor() {
    this.t = 0; this.i = 0; this.hold = 0;
    this.seq = [[0, 0.1], [-1.5, -0.1], [-1.65, 0.25], [0.3, 0.05], [1.8, -0.15], [2.75, 0.1], [0.8, -0.35], [-0.2, 0.3], [0, 0]];
  }
  update(dt, a, P) {
    this.t += dt; this.hold -= dt;
    if (this.hold <= 0) { this.i++; this.hold = rand(0.6, 1.4); this.fast = Math.random() < 0.6; }
    if (this.i >= this.seq.length) return 'idle';
    const [yaw, pitch] = this.seq[this.i];
    P.scan = { yaw, pitch };
    P.lookFreq = this.fast ? 7 : 0.9;
    // sniffing: small rapid head pecks
    P.roll = Math.sin(this.t * 1.3) * 0.3;
    if (Math.random() < dt * 3) a.kick('head', 'x', rand(-0.06, 0.04), 0.06);
    P.rot.hips = [0.05, 0, 0.035];
    P.rot.upperChest = [0.1, yaw * 0.18, 0]; P.rot.chest = [0.05, yaw * 0.1, 0];
    armsHang(P, 0.15, vnoise(a.t * 0.5, 5) * 0.04);
    P.open = 0.5; P.rate = 3; P.twitchiness = 2;
  }
}

class Scream {
  constructor() { this.t = 0; }
  update(dt, a, P) {
    this.t += dt;
    const p = a.ctx.camera.position;
    a.turnTo(a.yawTo(p.x, p.z), 4, dt);
    const build = smooth(0, 0.5, this.t), up = this.t < 0.8;
    // threat display: rears back for the intake, then thrusts its head and chest at you, claws spread wide and low
    const thrust = smooth(0.6, 1.0, this.t);
    P.hips = [0, -0.14 * thrust, 0.04 * thrust];
    P.rot.hips = [0.12 * thrust - 0.08 * (1 - thrust), 0, 0];
    P.rot.spine = [(0.22 * thrust - 0.2 * (1 - thrust)) * build, 0, 0];
    P.rot.chest = [(0.12 * thrust - 0.15 * (1 - thrust)) * build, 0, 0];
    P.rot.upperChest = [(0.16 * thrust - 0.12 * (1 - thrust)) * build, 0, 0];
    for (const [L, s] of [['L', 1], ['R', -1]]) {
      P.rot['clavicle' + L] = [0, 0, s * 0.3 * build];
      P.rot['upperArm' + L] = [(-0.75 * thrust - 0.2) * build, 0, s * (0.95 - 0.15 * thrust) * build];
      P.rot['forearm' + L] = [-0.95 * build, 0, 0];
      P.rot['hand' + L] = [0.6 * build, 0, -s * 0.3 * build];
    }
    if (up) { P.scan = { yaw: 0, pitch: 0.8 }; P.lookFreq = 2; } else P.lookFreq = 10;
    P.roll = 0; P.open = 1.5; P.jaw = 1.0 * build; P.tremble = 1.2 * build; P.rate = 6;
    if (this.t > 0.8) a.shake = Math.max(a.shake, 0.8 * (1 - smooth(2.6, 3.4, this.t)) * (1 - smooth(2, 7, a.distToPlayer())) + 0.15);
    if (this.t > 3.4) return 'idle';
  }
}

class Convulse {
  constructor() { this.t = 0; this.next = 0; this.k = {}; }
  update(dt, a, P) {
    this.t += dt;
    if (this.t > this.next) {
      this.next = this.t + rand(0.05, 0.22);
      const J = (r) => rand(-r, r);
      this.k = {
        spine: [J(0.35), J(0.4), J(0.25)], chest: [J(0.3), J(0.3), J(0.3)], upperChest: [J(0.4), J(0.4), J(0.3)],
        neck: [J(0.6), J(0.7), J(0.5)], neck2: [J(0.6), J(0.8), J(0.6)],
        upperArmL: [J(1.6), 0, rand(0, 1.2)], upperArmR: [J(1.6), 0, -rand(0, 1.2)], forearmL: [-rand(0, 1.8), 0, 0], forearmR: [-rand(0, 1.8), 0, 0],
        handL: [J(0.8), 0, J(0.6)], handR: [J(0.8), 0, J(0.6)], hips: [J(0.15), J(0.2), J(0.15)],
      };
      a.kick('head', ['x', 'y', 'z'][Math.random() * 3 | 0], J(0.9), 0.06);
      if (Math.random() < 0.3) a.shake += 0.1;
    }
    Object.assign(P.rot, this.k);
    P.hips = [0, -0.12 + Math.sin(this.t * 17) * 0.03, 0];
    P.look = 0.35; P.open = Math.random() < 0.5 ? 1.5 : -0.6; P.jaw = rand(0.2, 1.0); P.rate = 22; P.tremble = 0.8; P.twitchiness = 6;
    if (this.t > 3.8) return 'idle';
  }
}

class BreakDoor {
  constructor(a) {
    this.phase = 'approach'; this.t = 0; this.hits = 0;
    const d = a.world.door;
    this.spot = { x: d.position.x, z: d.position.z + 0.85 };
    this.face = Math.atan2(-d.normal.x, -d.normal.z);
  }
  update(dt, a, P) {
    const door = a.world.door;
    this.t += dt;
    if (this.phase === 'approach') {
      const d = a.moveToward(this.spot.x, this.spot.z, 0.95, dt, 1.8);
      walkPose(a, P);
      if (d < 0.12) { this.phase = 'face'; this.t = 0; }
      return;
    }
    P.lookAt = door.position.clone().setY(1.6);
    if (this.phase === 'face') {
      const err = a.turnTo(this.face, 2.2, dt);
      P.rot.hips = [0.05, 0, 0]; armsHang(P, 0.2); P.rate = 4;
      if (err < 0.05 && this.t > 0.6) {
        if (door.broken) return 'lookAround';
        this.phase = 'windup'; this.t = 0;
      }
      return;
    }
    // overhead hammer blows with both forearms
    const strike = (amt) => {
      for (const [L, s] of [['L', 1], ['R', -1]]) {
        P.rot['clavicle' + L] = [0, 0, s * (0.35 - amt * 0.25)];
        P.rot['upperArm' + L] = [-2.75 + amt * 1.95, 0, s * (0.35 - amt * 0.15)];
        P.rot['forearm' + L] = [-0.9 + amt * 0.75, 0, 0];
        P.rot['hand' + L] = [0.3, 0, 0];
      }
      P.rot.hips = [-0.05 + amt * 0.2, 0, 0];
      P.rot.spine = [-0.15 + amt * 0.4, 0, 0]; P.rot.chest = [-0.12 + amt * 0.3, 0, 0]; P.rot.upperChest = [-0.1 + amt * 0.3, 0, 0];
      P.hips = [0, -0.05 - amt * 0.12, 0];
    };
    if (this.phase === 'windup') {
      strike(0); P.rate = 7; P.open = -0.6; P.jaw = 0.5; P.tremble = 0.3;
      if (this.t > (this.hits === 0 ? 0.8 : 0.5)) { this.phase = 'strike'; this.t = 0; }
    } else if (this.phase === 'strike') {
      strike(1); P.rate = 26; P.open = -0.6; P.jaw = 0.8;
      if (this.t > 0.13) {
        this.hits++;
        a.shake += 0.5 + this.hits * 0.25;
        if (this.hits >= 3) { door.smash(new THREE.Vector3(Math.sin(a.heading), 0.15, Math.cos(a.heading))); this.phase = 'roar'; this.t = 0; }
        else { door.hit(this.hits); this.phase = 'recover'; this.t = 0; }
      }
    } else if (this.phase === 'recover') {
      strike(0.8); P.rate = 5; P.open = -0.4; P.jaw = 0.4;
      if (this.t > 0.4) { this.phase = 'windup'; this.t = 0; }
    } else if (this.phase === 'roar') {
      strike(0.85 - smooth(0, 1, this.t) * 0.85); P.rate = 4;
      P.jaw = 1.0; P.tremble = 0.9; P.open = 1.4; P.scan = { yaw: 0, pitch: 0.55 }; P.lookFreq = 3;
      if (this.t > 1.8) return 'idle';
    }
  }
}
function walkPose(a, P) {
  const ph = a.gait.phase * TAU;
  P.gait = GAITS.walk;
  P.hips = [0, -0.06 - 0.02 * Math.abs(Math.cos(ph)), 0];
  P.rot.hips = [0.1, 0.06 * Math.sin(ph), 0.035 + 0.04 * Math.sin(ph)];
  P.rot.spine = [0.08, -0.04 * Math.sin(ph), 0]; P.rot.chest = [0.06, -0.05 * Math.sin(ph), 0]; P.rot.upperChest = [0.05, -0.04 * Math.sin(ph), 0];
  armsSwing(P, a, 0.9, 0.02, -0.12);
  P.rate = 6; P.armRate = 3.5; P.open = 0.1;
}

const ACTIONS = {
  idle: Idle, walk: Walk, stalk: Stalk, crawl: Crawl, chase: Chase, leap: Leap,
  lookAround: LookAround, breakDoor: BreakDoor, scream: Scream, convulse: Convulse, reset: Idle,
};
export const ACTION_LIST = [
  ['idle', 'Idle', '1'], ['walk', 'Walk', '2'], ['stalk', 'Stalk', '3'], ['crawl', 'Crawl', '4'], ['chase', 'Chase', '5'],
  ['leap', 'Leap', '6'], ['lookAround', 'Look around', '7'], ['breakDoor', 'Break door', '8'], ['scream', 'Scream', '9'],
  ['convulse', 'Convulse', '0'], ['reset', 'Reset', 'R'],
];
