import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// "The Tallyman" — emaciated, digitigrade, eyeless, with a jaw that opens far too wide.
// Built from deformed lathes/spheres on an Object3D rig, animated procedurally with foot IK.

function noise3(x, y, z) {
  return Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 0.5 + Math.sin(x * 4.1 + z * 5.3) * 0.3 + Math.sin(y * 7.7 + x * 2.3) * 0.2;
}

// a tapered limb along -Y from the origin, with joint knobs, sinew and asymmetry
function limbGeo(len, r0, r1, opt = {}) {
  const pts = [];
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let r = THREE.MathUtils.lerp(r0, r1, t);
    r *= 1 + (opt.belly ?? 0.25) * Math.sin(Math.PI * Math.min(1, t * 1.3)) * (1 - t);   // muscle belly near top
    r += (opt.knob ?? 0.012) * Math.exp(-Math.pow((t - 1) / 0.07, 2));                  // joint knob at the end
    r += (opt.knob ?? 0.012) * 0.8 * Math.exp(-Math.pow(t / 0.06, 2));
    pts.push(new THREE.Vector2(Math.max(0.004, r), -t * len));
  }
  pts.unshift(new THREE.Vector2(0.001, 0.002));
  pts.push(new THREE.Vector2(0.001, -len - 0.004));
  const g = new THREE.LatheGeometry(pts, opt.seg ?? 16);
  const p = g.attributes.position;
  const seed = opt.seed ?? 1;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const rad = Math.hypot(x, z);
    // sinew ridges & lumps
    const k = 1 + 0.12 * Math.sin(a * 3 + seed) * Math.sin((y / len) * 9 + seed) + 0.06 * noise3(x * 30, y * 10, z * 30 + seed)
      + (opt.flatten ?? 0) * (Math.abs(Math.sin(a)) - 0.5);
    p.setX(i, Math.cos(a) * rad * k * (opt.sx ?? 1));
    p.setZ(i, Math.sin(a) * rad * k * (opt.sz ?? 1));
  }
  g.computeVertexNormals();
  return g;
}

function torsoGeo() {
  // pelvis (y=0) to shoulders (y=0.78); flattened front-back, with ribs and sternum
  const prof = [];
  const rad = (y) => {
    if (y < 0.12) return 0.125 - y * 0.2;                                   // pelvis
    if (y < 0.3) return 0.1 - Math.sin(((y - 0.12) / 0.18) * Math.PI) * 0.025; // starved waist
    if (y < 0.64) return 0.09 + Math.pow((y - 0.3) / 0.34, 0.8) * 0.1;      // ribcage widening upward
    return 0.19 - Math.pow((y - 0.64) / 0.18, 1.5) * 0.14;                  // shoulder slope to neck
  };
  for (let i = 0; i <= 40; i++) { const y = i / 40 * 0.82; prof.push(new THREE.Vector2(Math.max(0.03, rad(y)), y)); }
  prof.unshift(new THREE.Vector2(0.001, 0)); prof.push(new THREE.Vector2(0.001, 0.82));
  const g = new THREE.LatheGeometry(prof, 36);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const front = Math.max(0, Math.sin(a));   // +z side
    const back = Math.max(0, -Math.sin(a));
    let k = 1;
    // ribs: ridges on the front & sides of the cage, sunken gaps between
    if (y > 0.32 && y < 0.66) {
      const rib = Math.sin((y - 0.32) * 62 + Math.abs(Math.cos(a)) * 2.6);
      k += (rib > 0 ? rib * 0.035 : rib * 0.045) * (0.25 + front * 0.75) * (1 - back * 0.9);
      k -= 0.05 * Math.exp(-Math.pow(Math.cos(a) / 0.12, 2)) * front; // sternum groove
    }
    // abdomen sucked in under ribs
    if (y > 0.18 && y < 0.34) k -= 0.12 * front * Math.sin(((y - 0.18) / 0.16) * Math.PI);
    // shoulder blades jut out at the back
    k += 0.18 * back * Math.exp(-Math.pow((y - 0.64) / 0.07, 2)) * Math.exp(-Math.pow((Math.abs(Math.cos(a)) - 0.55) / 0.2, 2));
    // spine valley
    k -= 0.06 * back * Math.exp(-Math.pow(Math.cos(a) / 0.1, 2)) * (y > 0.1 && y < 0.72 ? 1 : 0);
    k += 0.03 * noise3(x * 20, y * 20, z * 20);
    x *= k * 1.3; z *= k * 0.62;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

function skullGeo() {
  const g = new THREE.SphereGeometry(0.13, 48, 36);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const nx = x / 0.13, ny = y / 0.13, nz = z / 0.13;
    // long, back-swept cranium; narrow forward face
    z *= nz > 0 ? 1.45 : 1.9;
    y *= ny > 0 ? 1.0 : 0.8;
    y += Math.max(0, -nz) * 0.045 * (1 + ny);           // cranium sweeps up and back
    x *= 0.8 - Math.max(0, nz) * 0.28;
    // brow ridge
    y += 0.014 * Math.exp(-Math.pow((ny - 0.22) / 0.1, 2)) * Math.max(0, nz);
    // eye sockets: skin stretched over empty orbits
    for (const s of [-1, 1]) {
      const d = Math.pow(nx - s * 0.4, 2) / 0.035 + Math.pow(ny - 0.05, 2) / 0.025;
      const dent = Math.exp(-d) * Math.max(0, nz) * 0.05;
      z -= dent; x -= s * dent * 0.4;
    }
    // cheekbones
    for (const s of [-1, 1]) x += s * 0.01 * Math.exp(-(Math.pow(ny + 0.1, 2) / 0.02 + Math.pow(nz - 0.4, 2) / 0.05)) * Math.max(0, s * nx);
    // temple hollows
    for (const s of [-1, 1]) x -= s * 0.012 * Math.exp(-(Math.pow(ny - 0.15, 2) / 0.05 + Math.pow(nz - 0.2, 2) / 0.05)) * Math.max(0, s * nx);
    // flatten underside where the mouth sits
    if (ny < -0.2 && nz > 0) y = Math.max(y, -0.07);
    const n = noise3(nx * 3, ny * 3, nz * 3);
    x *= 1 + n * 0.02; y *= 1 + n * 0.02;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

// U-shaped jaw arc, used for upper maxilla & lower mandible
function jawArc(width, depth, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * 2 - 1; // -1..1
    pts.push(new THREE.Vector3(t * width, 0, depth * (1 - t * t)));
  }
  return pts;
}

function teethGeo(arc, len, inward, down, seed) {
  const geos = [];
  let s = seed;
  const R = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let row = 0; row < 2; row++) {
    for (let i = 1; i < arc.length - 1; i++) {
      const p = arc[i];
      const l = len * (0.55 + R() * 0.7) * (row ? 0.6 : 1);
      const c = new THREE.ConeGeometry(0.0045 + R() * 0.002, l, 6);
      c.translate(0, -l / 2, 0);
      c.rotateX(inward * (0.25 + R() * 0.3) * (row ? 1.6 : 1));
      c.rotateZ((R() - 0.5) * 0.3);
      if (!down) c.rotateX(Math.PI);
      // face along the arc normal
      const prev = arc[i - 1], next = arc[i + 1];
      const tang = new THREE.Vector3().subVectors(next, prev).normalize();
      const ang = Math.atan2(tang.x, tang.z);
      c.rotateY(ang - Math.PI / 2);
      c.translate(p.x * (1 - row * 0.12), 0, p.z * (1 - row * 0.12) - row * 0.008);
      geos.push(c);
    }
  }
  return mergeGeometries(geos);
}

export class MonsterModel {
  constructor(mats) {
    this.mats = mats;
    this.root = new THREE.Group();
    this.root.name = 'tallyman';
    const skin = mats.get('monsterSkin');
    this.skin = skin;
    const mk = (geo, mat = skin) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m; };
    const J = (name, parent, x, y, z) => { const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); parent.add(o); return o; };

    // ---------- rig ----------
    this.hips = J('hips', this.root, 0, 1.3, 0);
    this.abdomen = J('abdomen', this.hips, 0, 0.0, 0);
    this.chest = J('chest', this.abdomen, 0, 0.32, 0);
    this.neck = J('neck', this.chest, 0, 0.48, 0.03);
    this.head = J('head', this.neck, 0, 0.3, 0.02);
    this.head.scale.setScalar(1.25);
    this.jaw = J('jaw', this.head, 0, -0.035, -0.02);

    // torso: one mesh on abdomen (bends at chest via second mesh piece)
    const torso = torsoGeo();
    // whole torso rides the chest bone (abdomen bending still moves it); avoids seams
    torso.translate(0, -0.32, 0);
    this.chest.add(mk(torso));
    // vertebrae bumps along the back
    const vert = [];
    for (let i = 0; i < 12; i++) {
      const y = 0.05 + i * 0.06;
      const s = new THREE.SphereGeometry(0.022, 8, 6); s.scale(1, 0.7, 1.2);
      s.translate(0, y, -0.085 - Math.sin(y * 3) * 0.02);
      vert.push(s);
    }
    const vAll = mergeGeometries(vert);
    vAll.translate(0, -0.32, 0.02);
    this.chest.add(mk(vAll));
    // pelvis crests
    for (const s of [-1, 1]) {
      const c = new THREE.SphereGeometry(0.05, 12, 8); c.scale(0.8, 0.6, 1.2); c.translate(s * 0.12, 0.06 - 0.32, 0.02);
      this.chest.add(mk(c));
    }
    // collarbones
    for (const s of [-1, 1]) {
      const cb = limbGeo(0.2, 0.018, 0.014, { knob: 0.01, belly: 0 });
      cb.rotateZ(s * -1.45); cb.translate(s * 0.02, 0.42, 0.06);
      this.chest.add(mk(cb));
    }

    // neck with tendons
    const ng = limbGeo(0.34, 0.055, 0.065, { belly: -0.15, knob: 0.0 });
    ng.rotateX(Math.PI); ng.translate(0, -0.04, 0);
    this.neck.add(mk(ng));
    for (const s of [-1, 1]) {
      const t = limbGeo(0.36, 0.012, 0.01, { belly: 0, knob: 0 });
      t.rotateX(Math.PI); t.rotateZ(s * 0.12); t.translate(s * 0.03, -0.05, 0.03);
      this.neck.add(mk(t));
    }

    // ---------- head ----------
    const skull = skullGeo();
    skull.translate(0, 0.07, 0.03);
    this.head.add(mk(skull));
    // upper maxilla
    const maxA = jawArc(0.075, 0.17, 24);
    const maxTube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(maxA), 40, 0.018, 8);
    maxTube.translate(0, -0.012, -0.02);
    this.head.add(mk(maxTube));
    const lip = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(jawArc(0.082, 0.18, 24)), 40, 0.01, 6);
    lip.translate(0, -0.03, -0.02);
    this.head.add(mk(lip, mats.get('gums')));
    const maxPalate = new THREE.SphereGeometry(0.1, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    maxPalate.scale(0.75, 0.25, 1.1); maxPalate.translate(0, 0.0, 0.05);
    this.head.add(mk(maxPalate, mats.get('gums')));
    const upperTeeth = teethGeo(maxA, 0.06, 1, true, 7);
    upperTeeth.translate(0, -0.02, -0.02);
    this.head.add(mk(upperTeeth, mats.get('teeth')));
    // lips pulled back: thin ring around the maxilla
    // lower jaw
    const manA = jawArc(0.07, 0.18, 24);
    const manTube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(manA), 40, 0.02, 8);
    this.jaw.add(mk(manTube));
    const chin = new THREE.SphereGeometry(0.1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    chin.scale(0.7, -0.35, 1.05); chin.translate(0, -0.005, 0.07);
    this.jaw.add(mk(chin));
    const tongue = new THREE.SphereGeometry(0.05, 16, 10); tongue.scale(0.8, 0.25, 1.6); tongue.translate(0, 0.008, 0.07);
    this.jaw.add(mk(tongue, mats.get('gums')));
    const lowerTeeth = teethGeo(manA, 0.055, -1, false, 13);
    lowerTeeth.translate(0, 0.012, 0);
    this.jaw.add(mk(lowerTeeth, mats.get('teeth')));
    this.cheeks = [];

    // ---------- arms ----------
    this.arms = [];
    for (const s of [-1, 1]) {
      const sh = J('shoulder', this.chest, s * 0.23, 0.4, -0.01);
      const ua = J('upperArm', sh, 0, 0, 0);
      ua.add(mk(limbGeo(0.62, 0.042, 0.03, { seed: s * 3, knob: 0.016, belly: 0.35 })));
      const sb = new THREE.SphereGeometry(0.045, 14, 10); sb.scale(1, 0.8, 1.1); sb.translate(0, -0.02, 0);
      ua.add(mk(sb));
      const fa = J('foreArm', ua, 0, -0.62, 0);
      fa.add(mk(limbGeo(0.6, 0.032, 0.022, { seed: s * 5, knob: 0.013, belly: 0.2, flatten: 0.15 })));
      const hand = J('hand', fa, 0, -0.6, 0);
      const palm = new THREE.SphereGeometry(0.05, 14, 10); palm.scale(0.9, 1.5, 0.35); palm.translate(0, -0.06, 0);
      hand.add(mk(palm));
      const fingers = [];
      for (let f = 0; f < 5; f++) {
        const thumb = f === 4;
        const base = J('finger', hand, thumb ? s * -0.045 : (f - 1.5) * 0.026 * s, thumb ? -0.05 : -0.13, thumb ? 0.02 : 0);
        base.rotation.z = thumb ? s * 0.5 : (f - 1.5) * 0.06 * s;
        const segs = [];
        let parent = base;
        const lens = thumb ? [0.07, 0.06] : [0.12, 0.11, 0.09];
        lens.forEach((L, k) => {
          const seg = J('phalanx', parent, 0, k === 0 ? 0 : -lens[k - 1], 0);
          seg.add(mk(limbGeo(L, 0.011 - k * 0.002, 0.008 - k * 0.0015, { knob: 0.005, belly: 0, seg: 8, seed: f + k })));
          if (k === lens.length - 1) {
            const claw = new THREE.ConeGeometry(0.006, 0.05, 6); claw.translate(0, -0.025, 0); claw.rotateX(0.35); claw.translate(0, -L, 0.002);
            seg.add(mk(claw, mats.get('nail')));
          }
          segs.push(seg); parent = seg;
        });
        fingers.push({ base, segs, thumb });
      }
      this.arms.push({ side: s, shoulder: sh, upper: ua, fore: fa, hand, fingers });
    }

    // ---------- legs (digitigrade) ----------
    this.legs = [];
    this.L1 = 0.6; this.L2 = 0.64; this.L3 = 0.4;
    for (const s of [-1, 1]) {
      const hipJ = J('hip', this.hips, s * 0.13, -0.02, 0);
      const thigh = J('thigh', hipJ, 0, 0, 0);
      thigh.add(mk(limbGeo(this.L1, 0.06, 0.04, { seed: s * 7, knob: 0.02, belly: 0.4 })));
      const shin = J('shin', thigh, 0, -this.L1, 0);
      shin.add(mk(limbGeo(this.L2, 0.04, 0.026, { seed: s * 9, knob: 0.014, belly: 0.25, flatten: 0.2 })));
      const meta = J('meta', shin, 0, -this.L2, 0);
      meta.add(mk(limbGeo(this.L3, 0.026, 0.02, { seed: s * 11, knob: 0.014, belly: 0.1 })));
      const toes = J('toes', meta, 0, -this.L3, 0);
      for (let t = 0; t < 3; t++) {
        const tg = limbGeo(0.16, 0.013, 0.008, { knob: 0.006, belly: 0, seg: 8, seed: t });
        tg.rotateX(-Math.PI / 2 - 0.1); tg.rotateY((t - 1) * 0.35);
        toes.add(mk(tg));
        const claw = new THREE.ConeGeometry(0.007, 0.05, 6); claw.rotateX(Math.PI / 2 + 0.3); claw.translate(0, -0.012, 0.18); claw.rotateY((t - 1) * 0.35);
        toes.add(mk(claw, mats.get('nail')));
      }
      this.legs.push({ side: s, hip: hipJ, thigh, shin, meta, toes });
    }

    // ---------- tattered gown ----------
    this.gown = this.makeGown(mats);
    this.chest.add(this.gown);

    this.root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    this.meshCount = 0; this.root.traverse((o) => { if (o.isMesh) this.meshCount++; });

    // animation state
    this.t = 0;
    this.phase = 0;
    this.feet = [new THREE.Vector3(), new THREE.Vector3()];
    this.footInit = false;
    this.twitch = new THREE.Euler();
    this.twitchTarget = new THREE.Euler();
    this.twitchTimer = 0;
    this.jawOpen = 0.1;
    this.pose = { lean: 0.35, reach: 0, scream: 0, crouch: 0, look: new THREE.Vector2(), armsUp: 0 };
  }

  makeGown(mats) {
    // torn hospital gown hanging off the shoulders (front + back panels)
    const c = document.createElement('canvas'); c.width = 128; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 256);
    g.fillStyle = '#000';
    // torn hem
    g.beginPath(); g.moveTo(0, 256);
    for (let x = 0; x <= 128; x += 6) g.lineTo(x, 150 + Math.random() * 90);
    g.lineTo(128, 256); g.fill();
    for (let i = 0; i < 9; i++) { g.beginPath(); g.ellipse(Math.random() * 128, 40 + Math.random() * 150, 4 + Math.random() * 10, 6 + Math.random() * 18, Math.random(), 0, 7); g.fill(); }
    const alpha = new THREE.CanvasTexture(c);
    const mat = mats.get('gown').clone();
    mat.alphaMap = alpha; mat.alphaTest = 0.5; mat.side = THREE.DoubleSide; mat.transparent = false;
    const grp = new THREE.Group();
    for (const s of [-1]) {
      const geo = new THREE.PlaneGeometry(0.34, 0.7, 10, 16);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i);
        const t = (0.35 - y) / 0.7;
        p.setZ(i, Math.sin(x * 22) * 0.015 * t + t * t * 0.05 * s);
        p.setX(i, x * (1 + t * 0.25));
      }
      geo.computeVertexNormals();
      geo.translate(0, -0.35, 0);
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.position.set(0.0, 0.46, s * 0.1 - 0.02);
      m.rotation.x = s * -0.15;
      grp.add(m);
    }
    return grp;
  }

  // --------------------------------------------------------------------------
  // procedural animation
  // speed: current ground speed (m/s); mode: idle|walk|run|search|scream|attack|still
  update(dt, speed, mode, worldRoot) {
    this.t += dt;
    const P = this.pose;
    const run = mode === 'run';
    const target = {
      lean: mode === 'attack' ? 1.0 : run ? 0.75 : mode === 'search' ? 0.5 : mode === 'still' ? 0.25 : 0.4,
      reach: run ? 1 : mode === 'attack' ? 1.4 : 0,
      scream: mode === 'scream' ? 1 : 0,
      crouch: mode === 'attack' ? 0.45 : mode === 'search' ? 0.15 : run ? 0.12 : 0,
      armsUp: mode === 'attack' ? 1 : 0,
    };
    const k = 1 - Math.exp(-dt * (mode === 'attack' ? 14 : 5));
    for (const key of ['lean', 'reach', 'scream', 'crouch', 'armsUp']) P[key] += (target[key] - P[key]) * k;

    // gait phase
    const stride = run ? 1.6 : 0.85;
    const cadence = speed > 0.05 ? speed / stride : 0;
    this.phase = (this.phase + cadence * dt) % 1;

    // twitches: sudden head snaps
    this.twitchTimer -= dt;
    if (this.twitchTimer <= 0) {
      const big = Math.random() < (mode === 'search' || mode === 'still' ? 0.4 : 0.15);
      this.twitchTarget.set((Math.random() - 0.5) * (big ? 0.7 : 0.15), (Math.random() - 0.5) * (big ? 1.4 : 0.25), (Math.random() - 0.5) * (big ? 1.1 : 0.2));
      this.twitchTimer = big ? 0.3 + Math.random() * 1.2 : 0.08 + Math.random() * 0.5;
    }
    const tk = 1 - Math.exp(-dt * 30);
    this.twitch.x += (this.twitchTarget.x - this.twitch.x) * tk;
    this.twitch.y += (this.twitchTarget.y - this.twitch.y) * tk;
    this.twitch.z += (this.twitchTarget.z - this.twitch.z) * tk;

    const ph = this.phase * Math.PI * 2;
    const moving = cadence > 0;
    const bob = moving ? Math.abs(Math.sin(ph)) : 0;
    this.hips.position.y = 1.3 - P.crouch * 0.4 - bob * (run ? 0.08 : 0.05) + Math.sin(this.t * 1.7) * 0.01;
    this.hips.position.x = moving ? Math.sin(ph) * 0.05 : Math.sin(this.t * 0.8) * 0.02;
    this.hips.rotation.y = moving ? Math.sin(ph) * 0.18 : 0;
    this.hips.rotation.z = moving ? Math.sin(ph) * 0.06 : 0;

    // spine: hunched, heaving breaths, scream arches back
    const breath = Math.sin(this.t * (run ? 5 : 2.2)) * 0.03;
    this.abdomen.rotation.x = P.lean * 0.5 - P.scream * 0.35 + breath;
    this.chest.rotation.x = P.lean * 0.7 - P.scream * 0.45 + breath * 0.5;
    this.chest.rotation.y = moving ? -Math.sin(ph) * 0.22 : Math.sin(this.t * 0.6) * 0.05;
    this.chest.rotation.z = moving ? -Math.sin(ph) * 0.05 : 0;
    // neck counter-rotates so the head looks ahead / at target
    this.neck.rotation.x = -P.lean * 0.9 + P.scream * 0.3 + P.look.y * 0.5 + P.armsUp * 0.35;
    this.neck.rotation.y = P.look.x * 0.5;
    this.head.rotation.x = -P.lean * 0.45 + this.twitch.x * (1 - P.armsUp) - P.scream * 0.5 + P.look.y * 0.5 + P.armsUp * 0.35;
    this.head.rotation.y = this.twitch.y * (mode === 'run' ? 0.3 : 1) + P.look.x * 0.5;
    this.head.rotation.z = this.twitch.z * (mode === 'run' ? 0.3 : 1) + (mode === 'search' ? Math.sin(this.t * 0.9) * 0.6 : 0);

    // jaw: chatter, gape when running, unhinge on scream/attack
    const chatter = (Math.sin(this.t * 37) > 0.6 ? 0.08 : 0) * (mode === 'search' ? 1 : 0.4);
    const jawT = 0.12 + chatter + (run ? 0.35 : 0) + P.scream * 1.05 + P.armsUp * 1.1;
    this.jawOpen += (jawT - this.jawOpen) * (1 - Math.exp(-dt * 12));
    this.jaw.rotation.x = this.jawOpen;
    for (const c of this.cheeks) c.scale.y = 1 + this.jawOpen * 3;

    // arms: dangle & swing with lag; reach forward when hunting
    for (const a of this.arms) {
      const s = a.side;
      const swing = moving ? Math.sin(ph + (s > 0 ? 0 : Math.PI)) * (run ? 0.6 : 0.35) : Math.sin(this.t * 0.7 + s) * 0.05;
      a.shoulder.rotation.z = s * (0.12 + P.scream * 0.9 + P.armsUp * 0.25);
      a.upper.rotation.x = -P.lean * 0.6 + swing - P.reach * 0.9 - P.armsUp * 0.9 - P.scream * 0.2;
      a.upper.rotation.z = s * (0.1 + P.reach * 0.15 + P.armsUp * 0.25);
      a.fore.rotation.x = -0.25 - (run ? 0.35 : 0.1) - P.reach * 0.2 + Math.max(0, swing) * 0.3;
      a.hand.rotation.x = -0.2 + Math.sin(this.t * 3 + s) * 0.05;
      // fingers: slow creeping flex, splay when attacking/screaming
      const curl = 0.25 + Math.sin(this.t * 1.6 + s * 2) * 0.12 - P.scream * 0.3 - P.armsUp * 0.25;
      a.fingers.forEach((f, i) => {
        f.segs.forEach((sg, j) => { sg.rotation.x = -curl * (0.6 + j * 0.35) - Math.sin(this.t * 6 + i * 1.3) * 0.04; });
        if (!f.thumb) f.base.rotation.z = (i - 1.5) * (0.06 + P.scream * 0.12 + P.armsUp * 0.12) * s;
      });
    }

    // legs: IK toward planted feet
    this.solveLegs(dt, speed, moving, ph, run, worldRoot);
  }

  solveLegs(dt, speed, moving, ph, run, worldRoot) {
    const root = worldRoot || this.root;
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
    fwd.y = 0; fwd.normalize();
    const stride = run ? 1.5 : 0.8;
    for (let i = 0; i < 2; i++) {
      const leg = this.legs[i];
      const s = leg.side;
      const homeLocal = new THREE.Vector3(s * 0.17, 0.0, 0.05);
      const homeWorld = homeLocal.clone().applyMatrix4(root.matrixWorld);
      if (!this.footInit) this.feet[i].copy(homeWorld);
      let footLocal;
      if (moving) {
        // phase per leg; stance first 60%
        const lp = (this.phase + (i ? 0.5 : 0)) % 1;
        if (lp < 0.6) {
          // stance: keep planted, but drag if it falls too far behind
          const loc = this.feet[i].clone().applyMatrix4(inv);
          if (loc.distanceTo(homeLocal) > stride * 1.1) this.feet[i].copy(homeWorld);
          footLocal = this.feet[i].clone().applyMatrix4(inv);
          footLocal.y = 0;
        } else {
          const t = (lp - 0.6) / 0.4;
          const landing = homeWorld.clone().addScaledVector(fwd, stride * 0.45);
          const start = this.feet[i]._swingStart || this.feet[i].clone();
          if (!this.feet[i]._swingStart || this.feet[i]._swingT > t) this.feet[i]._swingStart = this.feet[i].clone();
          this.feet[i]._swingT = t;
          const p = start.clone().lerp(landing, t * t * (3 - 2 * t));
          p.y = Math.sin(t * Math.PI) * (run ? 0.22 : 0.13);
          if (t > 0.95) { this.feet[i].copy(landing); this.feet[i].y = 0; this.feet[i]._swingStart = null; }
          footLocal = p.applyMatrix4(inv);
        }
      } else {
        // idle: ease feet toward home positions
        this.feet[i].lerp(homeWorld, 1 - Math.exp(-dt * 4));
        this.feet[i].y = 0;
        footLocal = this.feet[i].clone().applyMatrix4(inv);
      }
      this.ik(leg, footLocal);
    }
    this.footInit = true;
  }

  // footLocal: target of the toe joint (ball of foot) in root space
  ik(leg, footLocal) {
    const L1 = this.L1, L2 = this.L2, L3 = this.L3;
    const metaAbs = -0.28; // metatarsal tilted down-forward
    const ball = footLocal.clone(); ball.y += 0.035;
    const hock = ball.clone().add(new THREE.Vector3(0, Math.cos(metaAbs) * L3, Math.sin(metaAbs) * L3));
    // hip joint in root space
    const hipPos = new THREE.Vector3();
    leg.hip.getWorldPosition(hipPos);
    this.root.worldToLocal(hipPos);
    const dz = hock.z - hipPos.z, dy = hock.y - hipPos.y, dx = hock.x - hipPos.x;
    let d = Math.hypot(dz, dy);
    d = Math.min(d, (L1 + L2) * 0.999);
    const phi = Math.atan2(dz, -dy);
    const alpha = Math.acos(THREE.MathUtils.clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const beta = Math.acos(THREE.MathUtils.clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
    // undo the hips' own pitch/roll contribution (small) by working in hips frame for x rotation
    const thighAbs = -(phi + alpha);
    const shinAbs = thighAbs + (Math.PI - beta);
    leg.thigh.rotation.set(thighAbs - this.hips.rotation.x, 0, Math.atan2(dx, -dy) * 0.8 - this.hips.rotation.z);
    leg.shin.rotation.set(Math.PI - beta, 0, 0);
    leg.meta.rotation.set(metaAbs - shinAbs, 0, -leg.thigh.rotation.z * 0.8);
    leg.toes.rotation.set(-metaAbs * 0.5, 0, 0);
  }
}

function clipY(geo, y0, y1) {
  // collapse vertices outside [y0,y1] onto the boundary (cheap split for overlapping parts)
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < y0) p.setY(i, y0);
    if (y > y1) p.setY(i, y1);
  }
  geo.computeVertexNormals();
}
