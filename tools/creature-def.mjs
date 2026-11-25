// Anatomy of "the Tall One": a gaunt, too-tall humanoid built from ~250 SDF primitives.
// Design units are metres for a ~2.0 m figure; the build script scales it up (default x1.2 => ~2.4 m).
// Coordinate system: +Y up, creature faces +Z, its left side is +X.

import {
  Field, Sphere, RoundCone, Ellipsoid, Frame,
  v3, add, sub, mul, norm, lerp3, cross, dot, len,
  rotX, rotY, rotZ, mmul, IDENT, smoothstep,
} from './sdf.mjs';

// deterministic RNG so the model is reproducible
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function basis(xAxis, yAxis, zAxis) {
  // columns -> row-major 3x3
  return [xAxis[0], yAxis[0], zAxis[0], xAxis[1], yAxis[1], zAxis[1], xAxis[2], yAxis[2], zAxis[2]];
}
function alignY(dir) {
  const y = norm(dir);
  let x = cross(y, [0, 0, 1]);
  if (len(x) < 1e-3) x = cross(y, [1, 0, 0]);
  x = norm(x);
  const z = cross(x, y);
  return basis(x, y, z);
}

function surfaceAlong(field, p, dir, maxT = 0.35, step = 0.0015) {
  for (let t = 0; t < maxT; t += step) {
    const q = add(p, mul(dir, t));
    if (field.eval(q[0], q[1], q[2]) > 0) return q;
  }
  return add(p, mul(dir, maxT));
}

function surfaceFromOutside(field, p, dir, maxT, step = 0.001) {
  for (let t = maxT; t > 0; t -= step) {
    const q = add(p, mul(dir, t));
    if (field.eval(q[0], q[1], q[2]) < 0) return q;
  }
  return p;
}

export function defineCreature() {
  const R = rng(1337);
  const bones = [];
  const bone = (name, parent, pos) => { bones.push({ name, parent, pos }); return pos; };

  // ------------------------------------------------------------------ frames
  const chest = new Frame([0, 1.49, -0.02], rotX(0.52));
  const head = new Frame([0, 1.80, 0.345], rotX(0.12));

  // ------------------------------------------------------------------ skeleton
  bone('root', null, [0, 0, 0]);
  bone('hips', 'root', [0, 1.06, -0.02]);
  bone('spine', 'hips', [0, 1.26, -0.04]);
  bone('chest', 'spine', [0, 1.43, -0.035]);
  bone('ribcage', 'chest', chest.p(0, 0.0, 0.0));
  bone('upperChest', 'chest', chest.p(0, 0.12, 0.0));
  bone('neck', 'upperChest', chest.p(0, 0.2, 0.03));
  bone('neck2', 'neck', [0, 1.745, 0.205]);
  const headPivot = bone('head', 'neck2', head.p(0, -0.038, -0.062));
  const tmj = bone('jaw', 'head', head.p(0, -0.032, -0.008));

  const arms = {}, legs = {};
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R';
    const S = chest.p(s * 0.178, 0.155, 0.0);
    const E = add(S, [s * 0.062, -0.46, -0.008]);
    const W = add(E, [s * 0.026, -0.45, 0.06]);
    bone('clavicle' + L, 'upperChest', chest.p(s * 0.03, 0.16, 0.07));
    bone('upperArm' + L, 'clavicle' + L, S);
    bone('forearm' + L, 'upperArm' + L, E);
    bone('hand' + L, 'forearm' + L, W);
    arms[L] = { s, S, E, W };

    const Hj = [s * 0.093, 1.03, -0.015];
    const Kn = [s * 0.112, 0.585, 0.10];
    const A = [s * 0.118, 0.095, -0.03];
    const B = [s * 0.12, 0.026, 0.115];
    bone('thigh' + L, 'hips', Hj);
    bone('shin' + L, 'thigh' + L, Kn);
    bone('foot' + L, 'shin' + L, A);
    bone('toes' + L, 'foot' + L, B);
    legs[L] = { s, Hj, Kn, A, B };
  }

  // ------------------------------------------------------------------ groups
  const groups = [{ name: 'core', k: 0.022 }];
  for (const L of ['L', 'R']) {
    groups.push({ name: 'arm' + L, k: 0.02, joins: [{ c: arms[L].S, r: 0.13, k: 0.045 }] });
    groups.push({ name: 'leg' + L, k: 0.022, joins: [{ c: legs[L].Hj, r: 0.16, k: 0.06 }] });
  }
  const field = new Field(groups);
  const P = (p) => field.addPrim(p);

  // ------------------------------------------------------------------ torso
  P(new Ellipsoid(chest.p(0, 0.02, 0), [0.122, 0.165, 0.09], chest.R, { bone: 'ribcage', k: 0.03 }));
  // hunched upper back
  P(new Ellipsoid(chest.p(0, 0.105, -0.03), [0.112, 0.085, 0.066], chest.R, { bone: 'upperChest', k: 0.05 }));
  // abdomen: sunken, thin waist
  P(new Ellipsoid([0, 1.285, -0.045], [0.068, 0.125, 0.046], rotX(0.15), { bone: 'spine', k: 0.05 }));
  // spinal column mass at the back of the waist (keeps the back from collapsing)
  P(new RoundCone([0, 1.10, -0.06], [0, 1.40, -0.075], 0.035, 0.035, { bone: 'spine', k: 0.04 }));
  // pelvis + jutting hip bones
  P(new Ellipsoid([0, 1.075, -0.03], [0.1, 0.068, 0.072], IDENT, { bone: 'hips', k: 0.045 }));
  for (const s of [1, -1]) {
    P(new Ellipsoid([s * 0.098, 1.125, -0.004], [0.03, 0.022, 0.058], rotY(s * 0.45), { bone: 'hips', k: 0.016 }));
    // sunken groin hollow, gives the pelvis a skeletal shape
    P(new Ellipsoid([s * 0.06, 1.02, 0.04], [0.04, 0.03, 0.03], IDENT, { bone: 'hips', k: 0.04 }));
  }

  // ribs: 9 pairs of thin arcs wrapped around the ribcage ellipsoid
  const rc = { a: 0.122, b: 0.09, ry: 0.165, cy: 0.02 };
  for (let i = 0; i < 9; i++) {
    const h = 0.125 - i * 0.031;
    const thEnd = i < 6 ? 0.86 : i < 8 ? 0.70 : 0.52;
    for (const s of [1, -1]) {
      const pts = [];
      const N = 7;
      for (let j = 0; j <= N; j++) {
        const th = Math.PI * (0.1 + (thEnd - 0.1) * (j / N));
        const y = h - 0.05 * Math.pow(th / Math.PI, 1.3) + (i < 6 && th > 0.75 * Math.PI ? 0.02 * (th / Math.PI - 0.75) : 0);
        const e = Math.sqrt(Math.max(0.05, 1 - ((y - rc.cy) / rc.ry) ** 2));
        const ax = rc.a * e + 0.002, bz = rc.b * e + 0.002;
        pts.push(chest.p(s * ax * Math.sin(th), y, -bz * Math.cos(th)));
      }
      for (let j = 0; j < N; j++) {
        const r1 = 0.0088 - 0.0025 * (j / N), r2 = 0.0088 - 0.0025 * ((j + 1) / N);
        P(new RoundCone(pts[j], pts[j + 1], r1, r2, { bone: 'ribcage', k: 0.007, tag: 'rib' }));
      }
    }
  }
  // sternum
  P(new RoundCone(chest.p(0, 0.15, 0.084), chest.p(0, -0.055, 0.094), 0.012, 0.009, { bone: 'ribcage', k: 0.014 }));
  // shoulder blades
  for (const s of [1, -1]) {
    P(new Ellipsoid(chest.p(s * 0.072, 0.075, -0.088), [0.045, 0.062, 0.012], mmul(chest.R, mmul(rotY(-s * 0.55), rotZ(s * 0.25))), { bone: 'upperChest', k: 0.02 }));
  }
  // collarbones + trapezius (hunched, sloping shoulders)
  for (const L of ['L', 'R']) {
    const { s, S } = arms[L];
    P(new RoundCone(chest.p(s * 0.016, 0.165, 0.078), add(S, [-s * 0.025, 0.012, 0.012]), 0.0095, 0.012, { bone: 'clavicle' + L, k: 0.012 }));
    P(new RoundCone(chest.p(s * 0.03, 0.24, 0.0), add(S, [-s * 0.04, 0.012, -0.02]), 0.03, 0.02, { bone: 'upperChest', k: 0.035 }));
  }

  // ------------------------------------------------------------------ neck
  P(new RoundCone(chest.p(0, 0.17, 0.02), [0, 1.745, 0.205], 0.05, 0.036, { bone: 'neck', k: 0.04 }));
  P(new RoundCone([0, 1.745, 0.205], head.p(0, -0.04, -0.05), 0.036, 0.033, { bone: 'neck2', k: 0.03 }));
  P(new Sphere([0, 1.715, 0.245], 0.013, { bone: 'neck', k: 0.02 })); // larynx
  for (const s of [1, -1]) {
    // sternocleidomastoid tendons, split so they skin across two bones
    // routed along the neck surface: behind the jaw -> side of the throat -> top of the sternum
    const top = head.p(s * 0.046, -0.052, -0.04), bot = chest.p(s * 0.014, 0.168, 0.084);
    const mid = add([0, 1.745, 0.205], [s * 0.026, -0.012, 0.022]);
    P(new RoundCone(top, mid, 0.0078, 0.0072, { bone: 'neck2', k: 0.02 }));
    P(new RoundCone(mid, bot, 0.0072, 0.0068, { bone: 'neck', k: 0.02 }));
  }

  // ------------------------------------------------------------------ head
  P(new Ellipsoid(head.p(0, 0.03, -0.045), [0.07, 0.086, 0.112], mmul(head.R, rotX(-0.08)), { bone: 'head', k: 0.02 }));
  P(new Ellipsoid(head.p(0, 0.022, 0.04), [0.056, 0.042, 0.05], mmul(head.R, rotX(0.25)), { bone: 'head', k: 0.045 }));
  for (const s of [1, -1]) {
    P(new RoundCone(head.p(0, 0.027, 0.091), head.p(s * 0.055, 0.022, 0.068), 0.012, 0.009, { bone: 'head', k: 0.018 })); // brow ridge
    P(new RoundCone(head.p(s * 0.045, -0.016, 0.076), head.p(s * 0.059, -0.01, 0.004), 0.0075, 0.0065, { bone: 'head', k: 0.01 })); // cheekbone
  }
  P(new Ellipsoid(head.p(0, -0.036, 0.056), [0.04, 0.026, 0.039], head.R, { bone: 'head', k: 0.02 })); // maxilla
  // mandible (jaw bone)
  for (const s of [1, -1]) {
    const angle = head.p(s * 0.044, -0.072, 0.01);
    P(new RoundCone(head.p(s * 0.048, -0.033, -0.012), angle, 0.008, 0.009, { bone: 'jaw', k: 0.01 }));
    P(new RoundCone(angle, head.p(s * 0.015, -0.092, 0.08), 0.0105, 0.012, { bone: 'jaw', k: 0.012 }));
  }
  P(new Ellipsoid(head.p(0, -0.091, 0.083), [0.017, 0.014, 0.014], head.R, { bone: 'jaw', k: 0.012 }));
  P(new Ellipsoid(head.p(0, -0.076, 0.048), [0.031, 0.014, 0.032], head.R, { bone: 'jaw', k: 0.016 }));


  // carved features (global subtractions, applied after everything)
  const post = (p, k) => field.addPost(p, k);
  const sockets = [], mouth = [];
  for (const s of [1, -1]) {
    post(new Sphere(head.p(s * 0.082, 0.0, 0.03), 0.021, {}), 0.03); // sunken temples
    post(new Ellipsoid(head.p(s * 0.056, -0.04, 0.044), [0.026, 0.032, 0.042], head.R, {}), 0.028); // hollow cheeks
    sockets.push(post(new Ellipsoid(head.p(s * 0.031, 0.002, 0.094), [0.021, 0.0185, 0.036], mmul(head.R, rotY(s * 0.22)), {}), 0.01));

    post(new Sphere(head.p(s * 0.077, -0.016, -0.022), 0.0075, {}), 0.006); // ear holes
  }
  post(new Ellipsoid(head.p(0, -0.019, 0.104), [0.0105, 0.0165, 0.024], head.R, {}), 0.005); // nasal cavity, no nose
  post(new Ellipsoid(head.p(0, -0.031, 0.104), [0.006, 0.006, 0.02], head.R, {}), 0.004);
  // the lipless mouth: a wide slit that curls up and back toward where ears should be
  const mouthY = (xAbs) => -0.056 - 0.002 * Math.pow(Math.min(xAbs / 0.06, 1.2), 2);
  mouth.push(post(new Ellipsoid(head.p(0, -0.056, 0.072), [0.038, 0.0058, 0.07], head.R, {}), 0.003));
  for (const s of [1, -1]) {
    mouth.push(post(new Ellipsoid(head.p(s * 0.034, -0.057, 0.045), [0.028, 0.0052, 0.04], mmul(head.R, mmul(rotY(s * 0.62), rotZ(-s * 0.05))), {}), 0.003));
  }

  // ------------------------------------------------------------------ arms & hands
  const claws = [], tips = [];
  for (const L of ['L', 'R']) {
    const { s, S, E, W } = arms[L];
    const g = 'arm' + L;
    P(new RoundCone(S, E, 0.034, 0.025, { bone: 'upperArm' + L, group: g }));
    P(new Ellipsoid(add(S, [s * 0.01, -0.04, 0.002]), [0.03, 0.058, 0.032], alignY(sub(E, S)), { bone: 'upperArm' + L, group: g, k: 0.03 }));
    P(new Sphere(add(S, [s * 0.004, 0.022, 0.006]), 0.014, { bone: 'clavicle' + L, group: g, k: 0.012 })); // acromion
    P(new Ellipsoid(add(lerp3(S, E, 0.45), [0, 0, 0.01]), [0.02, 0.08, 0.022], alignY(sub(E, S)), { bone: 'upperArm' + L, group: g, k: 0.03 }));
    for (const o of [1, -1]) P(new Sphere(add(E, [o * 0.019, 0.004, -0.004]), 0.016, { bone: 'upperArm' + L, group: g, k: 0.015 }));
    P(new Sphere(add(E, [0, 0.006, -0.022]), 0.022, { bone: 'forearm' + L, group: g, k: 0.015 })); // olecranon
    // radius + ulna: two thin bones, visible as separate ridges near the wrist
    P(new RoundCone(add(E, [s * 0.012, -0.01, 0.0]), add(W, [s * 0.011, 0.004, -0.006]), 0.023, 0.013, { bone: 'forearm' + L, group: g, k: 0.012 }));
    P(new RoundCone(add(E, [-s * 0.008, -0.012, -0.012]), add(W, [-s * 0.008, 0.004, 0.009]), 0.021, 0.0135, { bone: 'forearm' + L, group: g, k: 0.012 }));
    P(new Ellipsoid(lerp3(E, W, 0.22), [0.029, 0.085, 0.028], alignY(sub(W, E)), { bone: 'forearm' + L, group: g, k: 0.03 }));
    P(new Sphere(add(W, [s * 0.013, 0.002, -0.005]), 0.0135, { bone: 'forearm' + L, group: g, k: 0.01 }));
    P(new Sphere(add(W, [-s * 0.01, 0.002, 0.009]), 0.0125, { bone: 'forearm' + L, group: g, k: 0.01 }));

    // hand frame: palm faces the body
    const down = norm([s * 0.02, -1, 0.17]);
    let n = [-s, 0, 0];
    n = norm(sub(n, mul(down, dot(n, down))));
    const across = mul(cross(n, down), s); // ~ +Z (forward)
    const Rh = basis(n, down, across);
    P(new Ellipsoid(add(W, mul(down, 0.062)), [0.0125, 0.062, 0.037], Rh, { bone: 'hand' + L, group: g, k: 0.02 }));
    P(new Ellipsoid(add(W, mul(down, 0.02)), [0.014, 0.025, 0.026], Rh, { bone: 'hand' + L, group: g, k: 0.02 })); // carpals

    const lengths = [[0.085, 0.07, 0.058], [0.096, 0.079, 0.062], [0.089, 0.073, 0.058], [0.072, 0.058, 0.048]];
    for (let i = 0; i < 4; i++) {
      const off = (1.5 - i) * 0.0275; // index finger forward
      const K = add(add(add(W, mul(down, 0.119)), mul(across, off)), mul(n, -0.003));
      // metacarpal ridge on the back of the hand
      P(new RoundCone(add(add(W, mul(down, 0.03)), add(mul(across, off * 0.45), mul(n, -0.009))), add(K, mul(n, -0.004)), 0.0075, 0.009, { bone: 'hand' + L, group: g, k: 0.012 }));
      const fg = `finger${L}${i}`;
      field.groups.push({ name: fg, k: 0.009, joins: [{ c: K, r: 0.03, k: 0.014 }] });
      field.gIndex.set(fg, field.groups.length - 1);
      const spread = (1.5 - i) * 0.11 + (R() - 0.5) * 0.05;
      const base = norm(add(down, mul(across, spread)));
      const curls = [0.18 + R() * 0.1, 0.55 + R() * 0.15, 0.95 + R() * 0.2];
      const rs = i === 3 ? 0.9 : 1;
      let p = K;
      bone(`f${L}${i}_1`, 'hand' + L, K);
      P(new Sphere(K, 0.0118 * rs, { bone: `f${L}${i}_1`, group: fg }));
      let dir;
      for (let j = 0; j < 3; j++) {
        dir = norm(add(mul(base, Math.cos(curls[j])), mul(n, Math.sin(curls[j]))));
        const q = add(p, mul(dir, lengths[i][j]));
        const r1 = [0.0102, 0.0092, 0.0084][j] * rs, r2 = [0.0092, 0.0084, 0.0068][j] * rs;
        P(new RoundCone(p, q, r1, r2, { bone: `f${L}${i}_${j + 1}`, group: fg }));
        if (j < 2) {
          P(new Sphere(q, 0.0104 * rs, { bone: `f${L}${i}_${j + 2}`, group: fg, k: 0.006 }));
          bone(`f${L}${i}_${j + 2}`, `f${L}${i}_${j + 1}`, q);
        }
        p = q;
      }
      claws.push({ pos: p, dir, bone: `f${L}${i}_3`, len: 0.034 + R() * 0.01, r: 0.0062 * rs, curl: n });
      tips.push(p);
    }
    // thumb, pointing forward-down
    {
      const fg = `thumb${L}`;
      const T0 = add(add(W, mul(down, 0.022)), add(mul(across, 0.022), mul(n, 0.004)));
      field.groups.push({ name: fg, k: 0.01, joins: [{ c: T0, r: 0.05, k: 0.02 }] });
      field.gIndex.set(fg, field.groups.length - 1);
      const base = norm(add(add(mul(down, 0.62), mul(across, 0.72)), mul(n, 0.3)));
      const ls = [0.05, 0.058, 0.048], curls = [0.0, 0.25, 0.6];
      let p = T0, dir;
      bone(`thumb${L}_1`, 'hand' + L, T0);
      for (let j = 0; j < 3; j++) {
        dir = norm(add(mul(base, Math.cos(curls[j])), mul(n, Math.sin(curls[j]))));
        const q = add(p, mul(dir, ls[j]));
        P(new RoundCone(p, q, [0.013, 0.0105, 0.0094][j], [0.0105, 0.0094, 0.0075][j], { bone: `thumb${L}_${j + 1}`, group: fg }));
        if (j < 2) {
          P(new Sphere(q, 0.011, { bone: `thumb${L}_${j + 2}`, group: fg, k: 0.006 }));
          bone(`thumb${L}_${j + 2}`, `thumb${L}_${j + 1}`, q);
        }
        p = q;
      }
      claws.push({ pos: p, dir, bone: `thumb${L}_3`, len: 0.03, r: 0.0068, curl: n });
      tips.push(p);
    }
  }

  // ------------------------------------------------------------------ legs & feet
  for (const L of ['L', 'R']) {
    const { s, Hj, Kn, A, B } = legs[L];
    const g = 'leg' + L;
    P(new RoundCone(Hj, Kn, 0.052, 0.034, { bone: 'thigh' + L, group: g }));
    P(new Ellipsoid(add(lerp3(Hj, Kn, 0.38), [0, 0, 0.01]), [0.036, 0.15, 0.038], alignY(sub(Kn, Hj)), { bone: 'thigh' + L, group: g, k: 0.04 }));
    P(new Sphere(add(Hj, [s * 0.052, -0.045, -0.005]), 0.026, { bone: 'thigh' + L, group: g, k: 0.03 })); // trochanter
    for (const o of [1, -1]) P(new Sphere(add(Kn, [o * 0.022, 0.012, -0.004]), 0.029, { bone: 'thigh' + L, group: g, k: 0.02 }));
    P(new Sphere(add(Kn, [0, 0.008, 0.034]), 0.025, { bone: 'shin' + L, group: g, k: 0.012 })); // kneecap
    P(new Sphere(add(Kn, [0, -0.036, 0.008]), 0.033, { bone: 'shin' + L, group: g, k: 0.02 }));
    P(new RoundCone(add(Kn, [0, -0.03, 0]), A, 0.029, 0.018, { bone: 'shin' + L, group: g }));
    P(new RoundCone(add(Kn, [0, -0.06, 0.03]), add(A, [0, 0.06, 0.016]), 0.012, 0.0085, { bone: 'shin' + L, group: g, k: 0.014 })); // tibia ridge
    P(new Ellipsoid(add(lerp3(Kn, A, 0.27), [0, 0, -0.02]), [0.024, 0.09, 0.026], alignY(sub(A, Kn)), { bone: 'shin' + L, group: g, k: 0.03 }));
    for (const o of [1, -1]) P(new Sphere(add(A, [o * 0.021, 0.002, 0]), 0.017, { bone: 'foot' + L, group: g, k: 0.012 }));
    // foot
    const heel = add(A, [0, -0.062, -0.034]);
    P(new Sphere(heel, 0.029, { bone: 'foot' + L, group: g, k: 0.02 }));
    P(new RoundCone(heel, B, 0.027, 0.021, { bone: 'foot' + L, group: g, k: 0.02 }));
    P(new Ellipsoid(add(lerp3(A, B, 0.5), [0, -0.022, 0]), [0.032, 0.02, 0.068], rotX(0.45), { bone: 'foot' + L, group: g, k: 0.025 }));
    for (let t = 0; t < 4; t++) {
      const x0 = s * (0.097 + t * 0.0205);
      const bx = [x0, 0.024, 0.112 - t * 0.008];
      const fg = `toe${L}${t}`;
      field.groups.push({ name: fg, k: 0.008, joins: [{ c: bx, r: 0.026, k: 0.012 }] });
      field.gIndex.set(fg, field.groups.length - 1);
      const sc = t === 0 ? 1.25 : 1 - t * 0.06;
      const ln = (t === 0 ? 0.05 : 0.046 - t * 0.004);
      const mx = [x0 + s * (t - 1) * 0.003, 0.021, bx[2] + ln];
      const tip = [x0 + s * (t - 1) * 0.006, 0.0075, mx[2] + ln * 0.75];
      P(new Sphere(bx, 0.0115 * sc, { bone: 'toes' + L, group: fg }));
      P(new RoundCone(bx, mx, 0.0105 * sc, 0.0092 * sc, { bone: 'toes' + L, group: fg }));
      P(new RoundCone(mx, tip, 0.0092 * sc, 0.0068 * sc, { bone: 'toes' + L, group: fg }));
      claws.push({ pos: tip, dir: norm(sub(tip, mx)), bone: 'toes' + L, len: 0.022 + R() * 0.008, r: 0.0058 * sc, curl: [0, -1, 0] });
      tips.push(tip);
    }
  }

  // ------------------------------------------------------------------ vertebrae
  // snapped onto the surface of what we have so far, so they poke through the skin of the back
  field.build();
  const spinePts = [];
  const spineStarts = [];
  for (let i = 0; i < 7; i++) { const y = 1.07 + i * 0.045; spineStarts.push({ start: [0, y, -0.03], dir: norm([0, 0.05 + i * 0.03, -1]), y }); }
  for (let i = 0; i < 10; i++) { const h = -0.14 + i * 0.038; spineStarts.push({ start: chest.p(0, h, 0), dir: norm(chest.d(0, 0.1, -1)), y: chest.p(0, h, 0)[1] }); }
  for (let i = 0; i < 3; i++) { const q = lerp3(chest.p(0, 0.25, 0.02), [0, 1.745, 0.205], i / 3); spineStarts.push({ start: q, dir: norm([0, 0.75, -0.66]), y: q[1] + 0.2 }); }
  for (const { start, dir, y } of spineStarts) {
    const sp = surfaceAlong(field, start, dir);
    spinePts.push({ p: add(sp, mul(dir, -0.0045)), y });
  }
  for (const { p, y } of spinePts) {
    const r = y > 1.75 ? 0.0128 : 0.0105;
    P(new Sphere(p, r, { bone: y < 1.2 ? 'hips' : y < 1.38 ? 'spine' : y < 1.6 ? 'chest' : 'upperChest', k: 0.008, tag: 'spine' }));
  }

  field.build();

  // ------------------------------------------------------------------ teeth
  // rays from inside the mouth, outward along the dental arch, find the face surface
  const teeth = [];
  const rows = [
    { name: 'upper', bone: 'head', count: 24, yRoot: +0.0068, yTip: -0.0035, inset: 0.0055 },
    { name: 'lower', bone: 'jaw', count: 22, yRoot: -0.0072, yTip: +0.0036, inset: 0.0045 },
  ];
  for (const row of rows) {
    for (let i = 0; i < row.count; i++) {
      const u = (i + 0.5) / row.count;
      const phi = (u - 0.5) * 2 * 1.32;
      if (R() < 0.06) continue; // missing tooth
      const dirL = [Math.sin(phi), 0, Math.cos(phi)];
      const xGuess = Math.abs(Math.sin(phi)) * 0.05;
      const yc = mouthY(xGuess);
      const yRootL = yc + row.yRoot;
      const startL = [0, yRootL, 0.035];
      const surf = surfaceFromOutside(field, head.p(...startL), head.d(...dirL), 0.14, 0.0008);
      const root = add(surf, head.d(...mul(dirL, -row.inset)));
      const lenT = Math.abs(row.yRoot - row.yTip) * (0.85 + R() * 0.5) * (R() < 0.08 ? 1.6 : 1);
      const dir = head.d(0, row.name === 'upper' ? -1 : 1, 0);
      const jitter = head.d((R() - 0.5) * 0.35, 0, (R() - 0.5) * 0.35 + 0.15);
      teeth.push({
        pos: root, dir: norm(add(dir, jitter)), len: lenT + 0.004,
        w: (0.0026 + R() * 0.0011) * (1 - 0.35 * Math.abs(u - 0.5) * 2),
        bone: row.bone, row: row.name, broken: R() < 0.12,
      });
    }
  }

  const eyes = [1, -1].map((s) => ({ pos: head.p(s * 0.03, -0.001, 0.064), r: 0.0062, bone: 'head', fwd: head.d(s * 0.06, 0, 1) }));

  return {
    field, bones, head, chest, mouth, sockets, mouthY,
    anchors: { eyes, teeth, claws, tips, headForward: head.d(0, 0, 1), headUp: head.d(0, 1, 0) },
  };
}
