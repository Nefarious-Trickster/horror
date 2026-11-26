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
  // a deliberate four-beat creep: one limb at a time (hind, then the fore on that side), each hand
  // lifted clear, carried forward and set down with care before the next limb goes
  crawl: {
    limbs: ['L', 'R', 'hL', 'hR'], home: { L: [0.2, -0.12], R: [-0.2, -0.12], hL: [0.36, 1.12], hR: [-0.36, 1.12] },
    groups: { L: 0, hR: 0, R: 1, hL: 1 }, seq: ['R', 'hR', 'L', 'hL'], overlap: 0.62,
    stride: 0.7, stepTime: 0.34, handTime: 0.52, height: 0.1, handHeight: 0.24, trigger: 0.22, lead: 0.05,
  },
  // the old diagonal trot, for when it has to cover ground on all fours
  crawlFast: {
    limbs: ['L', 'R', 'hL', 'hR'], home: { L: [0.2, -0.12], R: [-0.2, -0.12], hL: [0.36, 1.12], hR: [-0.36, 1.12] },
    groups: { L: 0, hR: 0, R: 1, hL: 1 }, stride: 0.95, stepTime: 0.26, height: 0.11, trigger: 0.36, lead: 0.05,
  },
};

class Gait {
  constructor(anim) {
    this.a = anim;
    this.limbs = {};
    for (const k of ['L', 'R', 'hL', 'hR']) this.limbs[k] = { plant: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), pos: new THREE.Vector3(), t: 0, dur: 0.4, stepping: false, lift: 0, active: false };
    this.phase = 0; this.lastGroup = -1; this.seqI = 0;
  }
  home(k, g, out) { const h = g.home[k]; return this.a.root.localToWorld(out.set(h[0], 0, h[1])).setY(this.a.root.position.y); }
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
        eff.getWorldPosition(L.plant).setY(this.a.root.position.y); L.pos.copy(L.plant); L.stepping = false;
      }
    }
    const stepping = (grp) => g.limbs.some((k) => this.limbs[k].stepping && g.groups[k] === grp);
    const home = new THREE.Vector3(), pred = new THREE.Vector3();
    for (const k of g.limbs) {
      const L = this.limbs[k];
      this.home(k, g, home);
      if (L.stepping) {
        L.t += dt / L.dur;
        const t = Math.min(L.t, 1), hand = k[0] === 'h';
        // keep re-aiming the landing point while the body moves
        L.to.copy(home).addScaledVector(vel, (1 - t) * L.dur + g.lead);
        if (speed > 0.05) L.to.addScaledVector(_v2.set(vel.x, 0, vel.z).normalize(), g.stride * 0.32);
        if (hand && g.handHeight) {
          // lift first, carry it forward high, then lower it straight down onto the spot
          L.pos.lerpVectors(L.from, L.to, smooth(0.16, 0.86, t));
          L.lift = Math.sin(Math.PI * Math.pow(t, 0.72)) * g.handHeight;
        } else {
          L.pos.lerpVectors(L.from, L.to, ease(t));
          L.lift = Math.sin(Math.PI * t) * g.height * (hand ? 1.5 : 1);
        }
        if (L.t >= 1) { L.stepping = false; L.plant.copy(L.to); L.pos.copy(L.plant); L.lift = 0; L.planted = 0; }
        continue;
      }
      L.planted = (L.planted ?? 1) + dt;
      if (g.seq) continue;
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
    if (g.seq) this.sequence(g, speed, vel, home, pred);
  }
  // one limb after another in a fixed order; the next may lift only once the last is well into its swing
  sequence(g, speed, vel, home, pred) {
    const busy = g.limbs.filter((k) => this.limbs[k].stepping);
    if (busy.length > 1 || !busy.every((k) => this.limbs[k].t > g.overlap)) return;
    const n = g.seq.length;
    for (let j = 0; j < (speed > 0.05 ? 1 : n); j++) {
      const idx = (this.seqI + j) % n, k = g.seq[idx], L = this.limbs[k];
      if (L.stepping) continue;
      this.home(k, g, home); pred.copy(home).addScaledVector(vel, g.lead);
      const err = Math.hypot(L.plant.x - pred.x, L.plant.z - pred.z);
      if (err > (speed > 0.05 ? g.trigger * 0.35 : g.trigger)) {
        const hand = k[0] === 'h';
        L.stepping = true; L.t = 0; L.dur = (hand ? g.handTime ?? g.stepTime : g.stepTime) * (speed < 0.05 ? 1.25 : 1);
        L.from.copy(L.plant); L.to.copy(home);
        this.seqI = (idx + 1) % n;
        return;
      }
      if (speed > 0.05) this.seqI = (idx + 1) % n; // nothing to do for this one: move on
    }
  }
  // 0..1: how far into its swing a limb is (0 when planted)
  swing(k) { const L = this.limbs[k]; return L.stepping ? Math.min(1, L.t) : 0; }
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
    this.reach = { L: 0, R: 0 }; this.openH = { L: 0, R: 0 }; this.surge = 1; this.dt = 0;
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

  play(name, opts = {}) {
    const A = ACTIONS[name];
    if (!A) return;
    if (name === 'reset') { this.reset(); return; }
    this.actionName = name;
    this.action = new A(this, opts);
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
    this.ctx = ctx; this.t += dt; this.dt = dt;
    const t = this.t, B = this.B;
    const P = { rot: {}, hips: [0, 0, 0], rate: 5, armRate: null, look: 1, gaze: 'forward', lookAt: null, scan: null, lookFreq: null, pitchBias: 0, jaw: null, open: 0, gait: GAITS.stand, feet: null, tremble: 0, breathe: 1, twitchiness: 0 };
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
    if (Math.random() < dt * P.twitchiness) {
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
    const crawling = P.gait?.limbs.includes('hL');
    for (const [L, s] of [['L', 1], ['R', -1]]) {
      this.openH[L] = damp(this.openH[L], P.openH?.[L] ?? P.open, 3, dt);
      const op = this.openH[L];
      // a crawling hand draws its fingers in as it lifts and spreads them as it is set down
      const air = crawling ? this.gait.limbs['h' + L].lift / ((P.gait.handHeight || 0.16)) : 0;
      for (let i = 0; i < 4; i++) for (let j = 1; j <= 3; j++) {
        const n = `f${L}${i}_${j}`;
        const curl = vnoise(t * 0.4 + i * 1.7 + j, s * 9 + i) * 0.08 - op * 0.35 * (j === 1 ? 0.6 : 1) + air * (0.35 + j * 0.12) + this.twitchVal(n, 'z');
        B[n].rotation.set(0, 0, -s * curl);
      }
      B[`thumb${L}_2`].rotation.set(0, 0, -s * (vnoise(t * 0.3, s * 13) * 0.08 - op * 0.25 + air * 0.3));
    }
    this.root.updateMatrixWorld(true);

    // ---- feet and hands: gait planner + IK
    const g = P.gait;
    if (g) this.gait.update(dt, g, this.vel);
    for (const k of ['L', 'R']) {
      const target = _v2;
      if (P.feet?.[k]) target.copy(P.feet[k]);
      else { const L = this.gait.limbs[k]; target.copy(L.pos); target.y = this.root.position.y + this.ankleH + L.lift; }
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
        const target = _v2.copy(L.pos); target.y = this.root.position.y + 0.045 + L.lift;
        const sw = this.gait.swing(k), trail = sw > 0 ? Math.sin(Math.PI * Math.min(1, sw * 1.6)) * (1 - sw) * 1.6 : 0;
        solveTwoBone(B['upperArm' + k[1]], B['forearm' + k[1]], this.ext[k], target, -1);
        // hand flat on the floor, long fingers splayed forward
        this.root.getWorldQuaternion(_q);
        _q2.setFromAxisAngle(_v.set(0, 1, 0), s * 0.35 + L.lift * 2 * s);
        _q.multiply(_q2);
        _q2.setFromAxisAngle(_v.set(0, 0, 1), s * Math.PI / 2); _q.multiply(_q2);
        _q2.setFromAxisAngle(_v.set(1, 0, 0), -Math.PI / 2 + L.lift * 1.6 + trail * 0.9); _q.multiply(_q2);
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

  // Where it looks is a decision, not a reflex. Modes:
  //   'forward' (default) — where it is going; 'player' — locks onto you, deliberately;
  //   'point' — P.lookAt; 'wander' — idle: slow looks around the room, now and then a long stare at you.
  updateGaze(dt, P) {
    const G = this.gaze, B = this.B, t = this.t;
    const headPos = B.head.getWorldPosition(_v);
    const cam = this.ctx.camera.position;
    let yawW = this.heading, pitchW = -0.12 + P.pitchBias, mode = P.gaze;
    if (mode === 'wander') {
      if (t > (G.nextWander ?? 0)) {
        const d = this.distToPlayer();
        const facing = Math.abs(wrap(this.yawTo(cam.x, cam.z) - this.heading)) < 1.6;
        if (d < 6 && facing && Math.random() < 0.3) { G.wPlayer = true; G.nextWander = t + rand(3, 6); }
        else { G.wPlayer = false; G.wYaw = rand(-1.15, 1.15); G.wPitch = rand(-0.35, 0.12); G.nextWander = t + rand(3, 7); }
        G.tRoll = Math.random() < 0.3 ? rand(0.25, 0.55) * (Math.random() < 0.5 ? -1 : 1) : 0;
      }
      mode = G.wPlayer ? 'player' : 'offset';
    }
    if (P.scan) { yawW = this.heading + P.scan.yaw; pitchW = P.scan.pitch; }
    else if (mode === 'offset') { yawW = this.heading + G.wYaw; pitchW = G.wPitch; }
    else if (mode === 'player' || mode === 'point') {
      const tp = mode === 'point' && P.lookAt ? P.lookAt : cam;
      yawW = Math.atan2(tp.x - headPos.x, tp.z - headPos.z);
      pitchW = Math.atan2(tp.y - headPos.y, Math.hypot(tp.x - headPos.x, tp.z - headPos.z));
    }
    this.eyesOnPlayer = mode === 'player';
    // slow, deliberate turns of the head (actions may ask for a faster one)
    G.tYaw = G.yaw.x + wrap(yawW - G.yaw.x); G.tPitch = pitchW;
    G.freq = damp(G.freq, P.lookFreq ?? 0.55, 3, dt);
    const yaw = G.yaw.update(G.tYaw, G.freq, dt);
    const pitch = G.pitch.update(clamp(G.tPitch, -1.1, 1.0), G.freq, dt);
    const roll = G.roll.update(P.roll ?? (P.gaze === 'wander' ? G.tRoll : 0), 0.35, dt);

    // desired world orientation of the head
    const qd = _q.setFromEuler(_e.set(-pitch, yaw, 0, 'YXZ'));
    qd.multiply(_q2.setFromAxisAngle(_v2.set(0, 0, 1), roll)).multiply(Q_HEAD_BIND_INV);
    const w = clamp(P.look, 0, 1);
    // spread the turn down the neck; the head takes whatever is left (it can turn much further than a person's)
    for (const [n, frac] of [['neck', 0.22], ['neck2', 0.4], ['head', 1]]) {
      const bone = B[n];
      const qh = B.head.getWorldQuaternion(new THREE.Quaternion());
      const delta = qd.clone().multiply(qh.invert());
      const ang = 2 * Math.acos(clamp(Math.abs(delta.w), 0, 1));
      const lim = ang > 2.7 ? 2.7 / ang : 1;
      const step = new THREE.Quaternion().slerp(delta, w * frac * lim);
      const qb = bone.getWorldQuaternion(new THREE.Quaternion());
      setWorldQuat(bone, step.multiply(qb));
    }
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
  constructor(a, opts = {}) { this.o = opts; }
  update(dt, a, P) {
    const reach = smooth(0.35, 0.9, P.near);
    P.rot.hips = [0, vnoise(a.t * 0.2, 1) * 0.02, 0.035 + vnoise(a.t * 0.17, 2) * 0.012];
    P.rot.spine = [0.03 * P.near, 0, 0]; P.rot.chest = [0.05 * P.near, 0, 0]; P.rot.upperChest = [0.08 * P.near, 0, 0];
    armsHang(P, reach, vnoise(a.t * 0.35, 5) * 0.03);
    P.open = smooth(0.2, 0.8, P.near);
    P.rate = 1.6; P.gaze = this.o.stare ? 'player' : 'wander'; P.lookFreq = this.o.stare ? 0.45 : undefined; P.twitchiness = 0.08;
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
  const sp = Math.hypot(a.vel.x, a.vel.z);
  P.gait = sp > 1.15 ? GAITS.crawlFast : GAITS.crawl;
  P.hips = [0, -0.36 - 0.015 * Math.abs(Math.cos(ph)), 0];
  P.rot.hips = [1.22, 0.07 * Math.sin(ph), 0.05 * Math.sin(ph)];
  P.rot.spine = [0.16, -0.06 * Math.sin(ph), 0];
  P.rot.chest = [0.1, -0.06 * Math.sin(ph), 0];
  P.rot.upperChest = [0.06, -0.05 * Math.sin(ph), 0];
  P.rot.neck = [-0.8, 0, 0]; P.rot.neck2 = [-0.5, 0, 0]; P.rot.head = [-0.3, 0, 0];
  P.rot.clavicleL = [0.1, 0, 0.22]; P.rot.clavicleR = [0.1, 0, -0.22];
  if (P.gait === GAITS.crawl) {
    // each hand is a decision: the shoulder rises with it, the chest leans onto the other side,
    // and the head stays dead level while the body moves under it
    const sl = Math.sin(Math.PI * a.gait.swing('hL')), sr = Math.sin(Math.PI * a.gait.swing('hR'));
    const pl = Math.sin(Math.PI * a.gait.swing('L')), pr = Math.sin(Math.PI * a.gait.swing('R'));
    const shift = sr - sl;
    P.rot.clavicleL = [0.1 - sl * 0.12, 0, 0.22 + sl * 0.16]; P.rot.clavicleR = [0.1 - sr * 0.12, 0, -0.22 - sr * 0.16];
    P.rot.upperChest = [0.06 + (sl + sr) * 0.04, -0.05 * shift, 0.08 * shift];
    P.rot.chest = [0.1, -0.04 * shift, 0.05 * shift];
    P.rot.hips = [1.22, 0.05 * (pr - pl), 0.06 * (pr - pl)];
    P.rot.head = [-0.3 - (sl + sr) * 0.05, 0.04 * shift, -0.1 * shift];
    P.hips = [0.03 * (pl - pr), -0.36 - 0.02 * (pl + pr), 0];
    P.rate = 7;
  } else P.rate = 5;
  P.open = 1.2; P.pitchBias = 0.1;
}

class Crawl extends Walk { constructor(a) { super(a, true); } }

class Stalk {
  // A hunter's approach: it moves in single deliberate steps and freezes between them,
  // body slung low, hands raised and open, head locked on you and perfectly still.
  constructor() { this.t = 0; this.phase = 'hold'; this.hold = 0.8; this.reached = false; }
  update(dt, a, P) {
    this.t += dt;
    const p = a.ctx.camera.position;
    const d = a.distToPlayer();
    if (this.phase === 'hold') {
      a.turnTo(a.yawTo(p.x, p.z), 0.5, dt);
      if (this.t > this.hold && d > 2.3) { this.phase = 'step'; this.t = 0; }
    } else {
      const u = Math.min(this.t / 0.95, 1);
      a.moveToward(p.x, p.z, 0.75 * Math.sin(Math.PI * u), dt, 0.8, 2.2);
      if (u >= 1) { this.phase = 'hold'; this.t = 0; this.hold = rand(0.7, 1.6); }
    }
    this.reached = d <= 2.35;
    P.gait = GAITS.stalk;
    const settle = this.phase === 'hold' ? smooth(0, 0.5, this.t) : 0;
    P.hips = [0, -0.34 - 0.03 * settle, -0.02];
    P.rot.hips = [0.42, 0, 0.02];
    P.rot.spine = [0.22, 0, 0]; P.rot.chest = [0.14, 0, 0]; P.rot.upperChest = [0.1, 0, 0];
    P.open = 1.1; P.rate = 2.2;
    stalkArms(a, P, this.reached ? 0.25 : 0);
    P.gaze = 'player'; P.lookFreq = 0.45;
    P.jaw = this.reached ? 0.35 : 0.12; P.breathe = 0.6;
  }
}

class Chase {
  // Three beats: it turns and drops into a low stance (you see it decide), it runs at you
  // with long, heavy, efficient strides (no flailing: arms tucked, head dead level), and
  // when it reaches you it slowly rises to its full height over you before it strikes.
  constructor() { this.t = 0; this.phase = 'turn'; }
  update(dt, a, P) {
    this.t += dt;
    const p = a.ctx.camera.position;
    P.gaze = 'player';
    if (this.phase === 'turn') {
      const err = a.turnTo(a.yawTo(p.x, p.z), 1.6, dt);
      P.hips = [0, -0.2 * smooth(0.2, 0.9, this.t), 0];
      P.rot.hips = [0.3 * smooth(0.2, 0.9, this.t), 0, 0]; P.rot.spine = [0.15, 0, 0]; P.rot.chest = [0.1, 0, 0];
      armsHang(P, 0.1);
      P.rate = 3; P.lookFreq = 0.9; P.open = 0.6;
      if (this.t > 1.1 && err < 0.15) { this.phase = 'run'; this.t = 0; }
      return;
    }
    if (this.phase === 'run') {
      const d = a.moveToward(p.x, p.z, Math.min(3.4, 0.6 + this.t * 3.2), dt, 2.2, 1.5);
      P.gait = GAITS.run;
      const ph = a.gait.phase * TAU;
      P.hips = [0, -0.2 - 0.035 * Math.abs(Math.cos(ph)), 0];
      P.rot.hips = [0.32, 0.05 * Math.sin(ph), 0.02 * Math.sin(ph)];
      P.rot.spine = [0.2, -0.04 * Math.sin(ph), 0]; P.rot.chest = [0.12, -0.04 * Math.sin(ph), 0]; P.rot.upperChest = [0.08, 0, 0];
      for (const [L, s] of [['L', 1], ['R', -1]]) {
        const f = a.footFwd[L === 'L' ? 'R' : 'L'];
        P.rot['clavicle' + L] = [0, 0, s * 0.05];
        P.rot['upperArm' + L] = [0.15 - f * 0.45, 0, s * 0.1];
        P.rot['forearm' + L] = [-1.05 - f * 0.2, 0, 0];
        P.rot['hand' + L] = [0.25, 0, 0];
      }
      P.rate = 7; P.armRate = 5; P.open = 0.5; P.jaw = 0.25; P.lookFreq = 2.5;
      if (d <= 1.55) { this.phase = 'loom'; this.t = 0; }
      return;
    }
    if (this.phase === 'loom') {
      // it stops dead, then unfolds upward and leans its face down toward yours
      a.turnTo(a.yawTo(p.x, p.z), 1.2, dt);
      const u = smooth(0.2, 1.8, this.t);
      P.hips = [0, -0.2 * (1 - u), 0.04 * u];
      P.rot.hips = [0.32 * (1 - u) + 0.08 * u, 0, 0];
      P.rot.spine = [0.2 * (1 - u) + 0.1 * u, 0, 0]; P.rot.chest = [0.1 * u, 0, 0]; P.rot.upperChest = [0.22 * u, 0, 0];
      for (const [L, s] of [['L', 1], ['R', -1]]) {
        P.rot['clavicle' + L] = [0, 0, s * 0.12 * u];
        P.rot['upperArm' + L] = [-0.35 * u, 0, s * 0.28 * u];
        P.rot['forearm' + L] = [-0.6 * u, 0, 0];
        P.rot['hand' + L] = [0.35 * u, 0, -s * 0.2 * u];
      }
      P.rate = 2.4; P.open = 1.2 * u; P.jaw = 0.15 + 0.75 * smooth(1.2, 2.6, this.t); P.lookFreq = 0.6; P.breathe = 1.5;
      if (this.t > 3.0) { this.phase = 'strike'; this.t = 0; a.shake += 0.4; }
      return;
    }
    // strike: one arm comes down at you, then it holds there
    a.turnTo(a.yawTo(p.x, p.z), 2, dt);
    const u = smooth(0, 0.18, this.t);
    P.rot.hips = [0.15, 0, 0]; P.rot.spine = [0.25 * u, 0, 0]; P.rot.chest = [0.15, 0, 0]; P.rot.upperChest = [0.25, 0, 0];
    P.rot.clavicleL = [0, 0, 0.3]; P.rot.upperArmL = [-2.4 + 1.5 * u, 0, 0.35]; P.rot.forearmL = [-0.5 + 0.3 * u, 0, 0]; P.rot.handL = [0.4, 0, 0];
    P.rot.clavicleR = [0, 0, -0.12]; P.rot.upperArmR = [-0.4, 0, -0.3]; P.rot.forearmR = [-0.7, 0, 0];
    P.rate = this.t < 0.18 ? 16 : 2; P.open = 1.4; P.jaw = 0.95; P.lookFreq = 1.5;
    if (this.t > 0.15 && this.t - dt <= 0.15) a.shake += 0.9;
    if (this.t > 2.2) return 'idle';
  }
}

class Leap {
  // Readable from across the room: it squares up to you, sinks into a deep coil and holds
  // perfectly still, then explodes into a flat ballistic pounce, lands heavily on all four
  // limbs, and takes its time rising, eyes on you the whole way.
  constructor(a, opts = {}) { this.t = 0; this.phase = 'turn'; this.opts = opts; }
  aim(a) {
    const p = this.opts.to || a.ctx.camera.position, r = a.root.position;
    const d = Math.hypot(p.x - r.x, p.z - r.z);
    this.yaw = d > 0.5 ? a.yawTo(p.x, p.z) : a.heading;
    const L = this.opts.to ? d : clamp(d - 1.3, 1.2, 4.6);
    const { min, max } = a.world.bounds;
    this.from = r.clone();
    this.to = new THREE.Vector3(clamp(r.x + Math.sin(this.yaw) * L, min.x + 0.6, max.x - 0.6), 0, clamp(r.z + Math.cos(this.yaw) * L, min.z + 0.6, max.z - 0.6));
    this.dist = this.from.distanceTo(this.to);
    this.T = 0.5 + this.dist * 0.045;          // flight time
    this.apex = 9.8 * this.T * this.T / 8;     // height of a true ballistic arc for that time
  }
  update(dt, a, P) {
    if (!this.to) this.aim(a);
    this.t += dt;
    P.gaze = 'player';
    const coil = (P2, amt) => {
      P2.hips = [0, -0.5 * amt, -0.08 * amt];
      P2.rot.hips = [0.62 * amt, 0, 0]; P2.rot.spine = [0.28 * amt, 0, 0]; P2.rot.chest = [0.14 * amt, 0, 0]; P2.rot.upperChest = [0.08 * amt, 0, 0];
      for (const [L, s] of [['L', 1], ['R', -1]]) {
        P2.rot['clavicle' + L] = [0, 0, s * 0.08 * amt];
        P2.rot['upperArm' + L] = [0.55 * amt, 0, s * 0.22 * amt];
        P2.rot['forearm' + L] = [-0.35 * amt, 0, 0];
        P2.rot['hand' + L] = [0.5 * amt, 0, 0];
      }
    };
    if (this.phase === 'turn') {
      const err = a.turnTo(this.yaw, 1.4, dt);
      armsHang(P, 0); P.rate = 3; P.lookFreq = 0.8;
      if (err < 0.06 && this.t > 0.5) { this.phase = 'coil'; this.t = 0; }
    } else if (this.phase === 'coil') {
      coil(P, smooth(0, 1.1, this.t));
      P.rate = 2.6; P.open = 1; P.lookFreq = 1.2; P.breathe = 1.6;
      if (this.t > 1.1) { this.phase = 'hold'; this.t = 0; }
    } else if (this.phase === 'hold') {
      coil(P, 1.05); P.rate = 3; P.open = 1.1; P.breathe = 0.2; P.lookFreq = 2; // it stops breathing
      if (this.t > 0.7) { this.phase = 'fly'; this.t = 0; }
    } else if (this.phase === 'fly') {
      const u = Math.min(this.t / this.T, 1);
      a.root.position.lerpVectors(this.from, this.to, u);
      const lift = 4 * this.apex * u * (1 - u);
      // a flat, diving pounce: body level, claws reaching for you, legs streaming behind
      P.hips = [0, -0.25 + lift, 0];
      P.rot.hips = [1.05, 0, 0]; P.rot.spine = [0.25, 0, 0]; P.rot.chest = [0.1, 0, 0]; P.rot.upperChest = [0.05, 0, 0];
      P.rot.neck = [-0.95, 0, 0]; P.rot.neck2 = [-0.4, 0, 0];
      for (const [L, s] of [['L', 1], ['R', -1]]) {
        P.rot['clavicle' + L] = [0, 0, s * 0.3];
        P.rot['upperArm' + L] = [-0.6 - 0.5 * u, 0, s * 0.45]; P.rot['forearm' + L] = [-0.25, 0, 0]; P.rot['hand' + L] = [0.6, 0, -s * 0.2];
      }
      a.root.updateMatrixWorld(true);
      const hp = a.B.hips.getWorldPosition(new THREE.Vector3());
      const fwd = new THREE.Vector3(Math.sin(a.heading), 0, Math.cos(a.heading)), side = new THREE.Vector3(Math.cos(a.heading), 0, -Math.sin(a.heading));
      P.feet = {
        L: hp.clone().addScaledVector(side, 0.16).addScaledVector(fwd, -1.0 + 0.45 * u).add(new THREE.Vector3(0, -0.35 - 0.45 * u, 0)),
        R: hp.clone().addScaledVector(side, -0.16).addScaledVector(fwd, -0.85 + 0.45 * u).add(new THREE.Vector3(0, -0.45 - 0.4 * u, 0)),
      };
      P.footPitch = 1.4 - u; P.rate = this.t < 0.08 ? 22 : 9; P.open = 1.4; P.jaw = 0.85; P.lookFreq = 3;
      if (u >= 1) { this.phase = 'land'; this.t = 0; a.gait.reset(GAITS.stand); a.shake += 1.2; a.hipsCur.y = -0.6; this.opts.onImpact?.(); }
    } else if (this.phase === 'land') {
      // absorbs the impact deep, palms down on the floor in front of it
      coil(P, 1.15);
      for (const [L, s] of [['L', 1], ['R', -1]]) {
        P.rot['upperArm' + L] = [-0.75, 0, s * 0.35]; P.rot['forearm' + L] = [-0.35, 0, 0]; P.rot['hand' + L] = [0.9, 0, 0];
      }
      P.rate = this.t < 0.12 ? 18 : 3; P.open = 1.3; P.jaw = 0.5; P.lookFreq = 1;
      if (this.t > 0.9) { this.phase = 'rise'; this.t = 0; }
    } else {
      coil(P, 1 - smooth(0, 1.6, this.t));
      P.rate = 1.8; P.open = 0.8; P.lookFreq = 0.6; P.breathe = 1.4;
      if (this.t > 2.2) { if (this.opts.then) { a.play(...[].concat(this.opts.then)); return; } return 'idle'; }
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
    P.open = 0.5; P.rate = 2.5; P.twitchiness = 0;
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
    if (up) { P.scan = { yaw: 0, pitch: 0.8 }; P.lookFreq = 1.2; } else { P.gaze = 'player'; P.lookFreq = 1.6; }
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
    P.look = 0.35; P.open = Math.random() < 0.5 ? 1.5 : -0.6; P.jaw = rand(0.2, 1.0); P.rate = 22; P.tremble = 0.8; P.twitchiness = 6; P.lookFreq = 6;
    if (this.t > 3.8) return 'idle';
  }
}

class BreakDoor {
  constructor(a) {
    this.phase = 'approach'; this.t = 0; this.hits = 0;
    const d = a.world.door;
    this.spot = { x: d.position.x + d.normal.x * 0.85, z: d.position.z + d.normal.z * 0.85 };
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
    P.lookAt = door.position.clone().setY(1.6); P.gaze = 'point';
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

// ------------------------------------------------------------------ story actions
// Stands with its face to the wall, perfectly still, head bowed. (opts.yaw = direction to face)
class FaceWall {
  constructor(a, opts = {}) { this.yaw = opts.yaw ?? a.heading; this.t = 0; }
  update(dt, a, P) {
    this.t += dt;
    a.turnTo(this.yaw, 0.7, dt);
    P.rot.hips = [0.02, 0, 0.03]; P.rot.spine = [0.06, 0, 0]; P.rot.upperChest = [0.12, 0, 0];
    armsHang(P, 0);
    P.scan = { yaw: 0, pitch: -0.55 }; P.lookFreq = 0.35; P.rate = 1.2; P.breathe = 0.5; P.jaw = 0.06;
  }
}
// Hunkered low in a corner, arms folded down in front of it.
class Crouch {
  constructor(a, opts = {}) { this.yaw = opts.yaw; }
  update(dt, a, P) {
    if (this.yaw != null) a.turnTo(this.yaw, 0.8, dt);
    P.gait = GAITS.stalk;
    P.hips = [0, -0.62, -0.05];
    P.rot.hips = [0.75, 0, 0]; P.rot.spine = [0.3, 0, 0]; P.rot.chest = [0.15, 0, 0]; P.rot.upperChest = [0.1, 0, 0];
    for (const [L, s] of [['L', 1], ['R', -1]]) {
      P.rot['clavicle' + L] = [0, 0, s * 0.05];
      P.rot['upperArm' + L] = [-0.55, 0, s * 0.12]; P.rot['forearm' + L] = [-0.9, 0, 0]; P.rot['hand' + L] = [0.6, 0, 0];
    }
    P.open = 0.4; P.rate = 1.5; P.gaze = 'wander'; P.breathe = 0.8;
  }
}
// Walks (or crawls) to a point, then optionally turns and hands over to another action.
// opts: { x, z, speed, crawl, face (yaw), then: ['name', opts] | 'name' }
class Goto {
  constructor(a, opts) { this.o = opts; this.done = false; this.t = 0; }
  update(dt, a, P) {
    const o = this.o;
    if (!this.done) {
      const d = a.moveToward(o.x, o.z, o.speed ?? (o.crawl ? 0.8 : 0.9), dt, o.crawl ? 1.4 : 1.8);
      if (d < 0.15) this.done = true;
    } else {
      this.t += dt;
      const err = o.face != null ? a.turnTo(o.face, 1.4, dt) : 0;
      if (err < 0.05 && this.t > 0.4 && o.then) { a.play(...[].concat(o.then)); return; }
    }
    if (o.crawl) crawlPose(a, P, a.gait.phase * TAU); else walkPose(a, P);
    if (this.done && !o.crawl) { P.gait = GAITS.stand; armsHang(P, 0); P.rot.hips = [0.05, 0, 0.03]; }
    if (o.lookAtPlayer) P.gaze = 'player';
    if (o.crawl && o.speed > 1.2) P.gait = { ...GAITS.crawl, stepTime: 0.24, stride: 0.95, trigger: 0.4 };
  }
}
// Turns away from a harsh light with a forearm thrown over its eyes, backing off a little.
class Shield {
  constructor(a, opts = {}) { this.t = 0; this.from = opts.from; this.dur = opts.dur ?? 4; }
  update(dt, a, P) {
    this.t += dt;
    const u = smooth(0, 0.6, this.t);
    if (this.from && this.t < 1.6) { const away = Math.atan2(a.root.position.x - this.from.x, a.root.position.z - this.from.z); a.moveToward(a.root.position.x + Math.sin(away) * 0.6, a.root.position.z + Math.cos(away) * 0.6, 0.45, dt, 1.2); }
    P.hips = [0, -0.18 * u, -0.04 * u];
    P.rot.hips = [0.15 * u, 0.25 * u, 0]; P.rot.spine = [0.2 * u, 0.2 * u, 0]; P.rot.upperChest = [0.15 * u, 0.2 * u, 0];
    P.rot.clavicleR = [0, 0, -0.25 * u]; P.rot.upperArmR = [-2.0 * u, 0.3 * u, -0.5 * u]; P.rot.forearmR = [-1.7 * u, 0, 0]; P.rot.handR = [0.4 * u, 0, 0.3 * u];
    P.rot.clavicleL = [0, 0, 0.05]; P.rot.upperArmL = [-0.25 * u, 0, 0.15]; P.rot.forearmL = [-0.5 * u, 0, 0];
    P.scan = { yaw: -0.9 * u, pitch: -0.5 * u }; P.lookFreq = 1.2; P.rate = 4; P.open = 0.9; P.jaw = 0.3 * u; P.tremble = 0.25 * u;
    if (this.t > this.dur) return 'idle';
  }
}
// Hit by the strobe: a violent flinch, then it staggers back a step.
class Recoil {
  constructor(a, opts = {}) { this.t = 0; this.o = opts; a.shake += 0.2; }
  update(dt, a, P) {
    this.t += dt;
    const p = this.o.from || a.ctx.camera.position;
    const away = Math.atan2(a.root.position.x - p.x, a.root.position.z - p.z);
    if (this.t < 0.6) { const r = a.root.position; r.x += Math.sin(away) * 1.2 * dt; r.z += Math.cos(away) * 1.2 * dt; }
    const hit = 1 - smooth(0.0, 0.9, this.t) * 0.6;
    P.hips = [0, -0.22 * hit, -0.1 * hit];
    P.rot.hips = [-0.2 * hit, 0, 0]; P.rot.spine = [-0.25 * hit, 0, 0]; P.rot.upperChest = [-0.2 * hit, 0, 0];
    for (const [L, s] of [['L', 1], ['R', -1]]) {
      P.rot['clavicle' + L] = [0, 0, s * 0.3 * hit];
      P.rot['upperArm' + L] = [-1.7 * hit, 0, s * 0.4 * hit]; P.rot['forearm' + L] = [-1.6 * hit, 0, 0]; P.rot['hand' + L] = [0.4, 0, 0];
    }
    P.scan = { yaw: 0.6 * Math.sign(Math.sin(this.t * 9)), pitch: -0.45 }; P.lookFreq = 3;
    P.rate = this.t < 0.12 ? 25 : 5; P.open = 1.4; P.jaw = 0.8 * hit; P.tremble = 0.9 * hit;
    if (this.t > (this.o.dur ?? 1.1)) { if (this.o.then) { a.play(...[].concat(this.o.then)); return; } return 'idle'; }
  }
}
// Backs away to a point while keeping its face toward you.
class Retreat {
  constructor(a, opts) { this.o = opts; this.t = 0; }
  update(dt, a, P) {
    this.t += dt;
    const o = this.o, r = a.root.position;
    const dx = o.x - r.x, dz = o.z - r.z, d = Math.hypot(dx, dz);
    if (d > 0.08) { const st = Math.min(d, (o.speed ?? 0.85) * dt); r.x += dx / d * st; r.z += dz / d * st; }
    const p = a.ctx.camera.position;
    a.turnTo(o.face ?? a.yawTo(p.x, p.z), 1.2, dt);
    P.gait = GAITS.stalk;
    P.hips = [0, -0.25, 0]; P.rot.hips = [0.3, 0, 0]; P.rot.spine = [0.15, 0, 0]; P.rot.upperChest = [0.1, 0, 0];
    for (const [L, s] of [['L', 1], ['R', -1]]) { P.rot['upperArm' + L] = [-0.5, 0, s * 0.25]; P.rot['forearm' + L] = [-0.7, 0, 0]; P.rot['hand' + L] = [0.4, 0, 0]; }
    P.gaze = 'player'; P.lookFreq = 0.8; P.rate = 3; P.open = 1; P.jaw = 0.3;
    if (d <= 0.08 && this.t > 0.3) { if (o.then) { a.play(...[].concat(o.then)); return; } return 'idle'; }
  }
}
// The kill: rears up and drives both claws down at you. opts.onHit fires on contact.
class Attack {
  constructor(a, opts = {}) { this.t = 0; this.o = opts; this.hit = false; }
  update(dt, a, P) {
    this.t += dt;
    const p = a.ctx.camera.position;
    a.turnTo(a.yawTo(p.x, p.z), 4, dt);
    const rear = smooth(0, 0.45, this.t), strike = smooth(0.5, 0.68, this.t);
    if (this.t > 0.5 && this.t < 0.7) a.moveToward(p.x, p.z, 2.2, dt, 4, 0.55);
    P.hips = [0, -0.1 * rear + 0.08, 0.05 * strike];
    P.rot.hips = [0.1 + 0.25 * strike, 0, 0]; P.rot.spine = [-0.2 * rear + 0.45 * strike, 0, 0]; P.rot.upperChest = [-0.15 * rear + 0.35 * strike, 0, 0];
    for (const [L, s] of [['L', 1], ['R', -1]]) {
      P.rot['clavicle' + L] = [0, 0, s * 0.35 * rear];
      P.rot['upperArm' + L] = [-2.6 * rear + 2.0 * strike, 0, s * (0.4 - 0.2 * strike)]; P.rot['forearm' + L] = [-0.6 + 0.4 * strike, 0, 0]; P.rot['hand' + L] = [0.4, 0, 0];
    }
    P.gaze = 'player'; P.lookFreq = 4; P.rate = this.t > 0.5 ? 20 : 5; P.open = 1.5; P.jaw = 1; P.tremble = 0.4;
    if (!this.hit && this.t > 0.66) { this.hit = true; a.shake += 1.5; this.o.onHit?.(); }
    if (this.t > 2) return 'idle';
  }
}

// Stalking arms: they are never idle and never swing. As one foot steps, the opposite arm reaches
// slowly out ahead of the body, fingers spreading; it holds there after the foot lands, then draws
// back in with the fingers closing, one arm at a time, like something feeling its way toward you.
function stalkArms(a, P, raise = 0) {
  const dt = a.dt, G = a.gait.limbs;
  for (const [L, s, foot] of [['L', 1, 'R'], ['R', -1, 'L']]) {
    const F = G[foot];
    const out = F.stepping || (F.planted ?? 9) < 0.7;
    a.reach[L] = damp(a.reach[L], out ? 1 : 0, out ? 2.4 : 1.1, dt);
    const r = a.reach[L];
    P.rot['clavicle' + L] = [-0.08 * r, 0, s * (0.12 + 0.1 * r + raise * 0.3)];
    P.rot['upperArm' + L] = [-0.5 - 0.62 * r - raise, 0, s * (0.22 - 0.1 * r)];
    P.rot['forearm' + L] = [-1.0 + 0.62 * r + raise * 0.4, 0, 0];
    P.rot['hand' + L] = [0.55 - 0.45 * r, 0, -s * (0.22 - 0.1 * r)];
    if (!P.openH) P.openH = {};
    P.openH[L] = 0.35 + 1.0 * r;
  }
  const tw = a.reach.R - a.reach.L;
  P.rot.upperChest = [(P.rot.upperChest?.[0] ?? 0.1), 0.07 * tw, 0.03 * tw];
  P.armRate = 4.5;
}

// ------------------------------------------------------------------ path following (used by the hunter AI)
function stalkPose(a, P) {
  P.gait = GAITS.stalk;
  const ph = a.gait.phase * TAU;
  P.hips = [0, -0.32 - 0.015 * Math.abs(Math.cos(ph)), -0.02];
  P.rot.hips = [0.42, 0.03 * Math.sin(ph), 0.02];
  P.rot.spine = [0.22, 0, 0]; P.rot.chest = [0.14, 0, 0]; P.rot.upperChest = [0.1, 0, 0];
  P.open = 1.1; P.rate = 2.4; P.breathe = 0.6;
  stalkArms(a, P);
}
function runPose(a, P) {
  P.gait = GAITS.run;
  const ph = a.gait.phase * TAU;
  P.hips = [0, -0.2 - 0.035 * Math.abs(Math.cos(ph)), 0];
  P.rot.hips = [0.32, 0.05 * Math.sin(ph), 0.02 * Math.sin(ph)];
  P.rot.spine = [0.2, -0.04 * Math.sin(ph), 0]; P.rot.chest = [0.12, -0.04 * Math.sin(ph), 0]; P.rot.upperChest = [0.08, 0, 0];
  for (const [L, s] of [['L', 1], ['R', -1]]) {
    const f = a.footFwd[L === 'L' ? 'R' : 'L'];
    P.rot['clavicle' + L] = [0, 0, s * 0.05];
    P.rot['upperArm' + L] = [0.15 - f * 0.45, 0, s * 0.1]; P.rot['forearm' + L] = [-1.05 - f * 0.2, 0, 0]; P.rot['hand' + L] = [0.25, 0, 0];
  }
  P.rate = 7; P.armRate = 5; P.open = 0.5; P.jaw = 0.25;
}
const SPEEDS = { walk: 0.95, crawl: 0.85, stalk: 0.55, run: 3.3, creep: 0.4 };
// Follows a list of points. opts: { path: [{x,z}], mode: 'walk'|'crawl'|'stalk'|'run'|'creep', speed, stopAt,
// gaze: 'forward'|'player'|'wander', onArrive }
class Follow {
  constructor(a, o) { this.o = o; this.i = 0; this.arrived = false; this.t = 0; }
  update(dt, a, P) {
    const o = this.o, pts = o.path || [], mode = o.mode || 'walk';
    this.t += dt;
    if (this.i < pts.length) {
      const p = pts[this.i], last = this.i === pts.length - 1;
      let ramp = mode === 'run' ? Math.min(1, 0.35 + this.t * 1.2) : 1;
      if (mode === 'crawl' && !(o.speed > 1.15)) {
        const G = a.gait.limbs; a.surge = damp(a.surge, G.L.stepping || G.R.stepping ? 1.4 : 0.55, 7, dt); ramp *= a.surge;
      }
      const d = a.moveToward(p.x, p.z, (o.speed ?? SPEEDS[mode]) * ramp, dt, mode === 'run' ? 3.0 : 1.7, last ? (o.stopAt || 0) : 0);
      if (d < (last ? (o.stopAt || 0) + 0.12 : 0.5)) this.i++;
    } else if (!this.arrived) { this.arrived = true; o.onArrive?.(); }
    const moving = !this.arrived;
    if (mode === 'crawl') crawlPose(a, P, a.gait.phase * TAU);
    else if (mode === 'run' && moving) runPose(a, P);
    else if (mode === 'stalk' || mode === 'creep') stalkPose(a, P);
    else walkPose(a, P);
    if (!moving && mode !== 'crawl' && mode !== 'stalk' && mode !== 'creep') { P.gait = GAITS.stand; armsHang(P, 0.1); P.rot.hips = [0.05, 0, 0.03]; P.hips = [0, 0, 0]; }
    P.gaze = o.gaze || 'forward';
    if (P.gaze === 'player') P.lookFreq = o.lookFreq ?? 0.8;
  }
}

const ACTIONS = {
  idle: Idle, walk: Walk, stalk: Stalk, crawl: Crawl, chase: Chase, leap: Leap,
  lookAround: LookAround, breakDoor: BreakDoor, scream: Scream, convulse: Convulse, reset: Idle,
  faceWall: FaceWall, crouch: Crouch, goto: Goto, shield: Shield, recoil: Recoil, retreat: Retreat, attack: Attack,
  follow: Follow,
};
export const ACTION_LIST = [
  ['idle', 'Idle', '1'], ['walk', 'Walk', '2'], ['stalk', 'Stalk', '3'], ['crawl', 'Crawl', '4'], ['chase', 'Chase', '5'],
  ['leap', 'Leap', '6'], ['lookAround', 'Look around', '7'], ['breakDoor', 'Break door', '8'], ['scream', 'Scream', '9'],
  ['convulse', 'Convulse', '0'], ['reset', 'Reset', 'R'],
];
