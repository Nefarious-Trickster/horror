import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import * as P from './props.js';
import { DOORS, ZONES } from './map.js';
import { Door } from './doors.js';
import { DOOR_H, doorAxis, doorZone } from './level.js';
import { makeSign, makeGraffiti, makeGauge, makeClockFace, makePaper, makeChildDrawing, makeLabel } from '../gfx/textures.js';
import { MonsterModel } from '../entities/monsterModel.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const PI = Math.PI, HP = Math.PI / 2;

export function buildWorld(game) {
  const { scene, kit: K, mats: M, level: L, lights: LT, audio: A } = game;
  P.srand(1337);
  const S = new THREE.Group(); S.name = 'static';
  const D = new THREE.Group(); D.name = 'dynamic';
  scene.add(D);
  const W = {
    doors: new Map(), doorList: [], lockers: [], items: [], fixtures: {}, special: {}, animated: [], emitters: [],
  };
  const box3 = new THREE.Box3();

  const put = (obj, x, z, ry = 0, y = 0, parent = S) => { obj.position.set(x, y, z); obj.rotation.y = ry; parent.add(obj); return obj; };
  const col = (x0, z0, x1, z1, opt = {}) => L.addCollider(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), opt);
  const colAround = (obj, pad = 0, opt = {}) => {
    obj.updateMatrixWorld(true);
    box3.setFromObject(obj);
    return col(box3.min.x - pad, box3.min.z - pad, box3.max.x + pad, box3.max.z + pad, { maxY: box3.max.y, ...opt });
  };
  const decalMats = {
    splatter: M.decal('dSplatter', game.decals.splatter),
    smear: M.decal('dSmear', game.decals.smear, { opacity: 0.9 }),
    hand: M.decal('dHand', game.decals.hand),
    drip: M.decal('dDrip', game.decals.drip),
    tally: M.decal('dTally', game.decals.tally, { roughness: 0.8 }),
    foot: M.decal('dFoot', game.decals.footprints, { roughness: 0.1 }),
    puddle: M.decal('dPuddle', game.decals.puddle, { roughness: 0.05 }),
  };
  const floorDecal = (kind, x, z, w, h, rot = 0) => {
    const m = P.decalPlane(decalMats[kind], w, h);
    m.rotation.set(-HP, 0, rot); m.position.set(x, 0.004 + Math.random() * 0.002, z);
    S.add(m); return m;
  };
  // wall decal: nx,nz = wall normal (pointing into the room)
  const wallDecal = (mat, x, y, z, nx, nz, w, h, rot = 0) => {
    const m = P.decalPlane(typeof mat === 'string' ? decalMats[mat] : mat, w, h);
    m.position.set(x + nx * 0.006, y, z + nz * 0.006);
    m.rotation.set(0, Math.atan2(nx, nz), rot);
    S.add(m); return m;
  };
  const graffiti = (text, x, y, z, nx, nz, w, h, opt) => {
    const t = makeGraffiti(text, 1024, 256, opt);
    const m = new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -4 });
    return wallDecal(m, x, y, z, nx, nz, w, h);
  };
  const signAt = (lines, x, y, z, nx, nz, w = 0.9, h = 0.28, opt) => {
    const s = P.sign(K, makeSign(lines, 512, Math.round(512 * h / w), opt), w, h);
    s.position.set(x, y, z); s.rotation.y = Math.atan2(nx, nz); S.add(s); return s;
  };

  // ------------------------------------------------------------------ lights
  const tube = (x, z, zone, opt = {}) => {
    const h = ZONES[zone].h;
    const hang = opt.hang ?? 0;
    const f = P.fluorescent(K, { hang });
    put(f.group, x, z, opt.rot ?? 0, h - hang, S);
    const fx = LT.add({ pos: V(x, h - hang - 0.25, z), mats: [f.tubeMat], baseEmissive: 2.4, color: 0xdbe8f0, intensity: opt.int ?? 3.6, distance: opt.dist ?? 9, mode: opt.mode ?? 'steady', power: opt.power ?? 'grid', zone, hum: true });
    if (opt.mode === 'dead') f.tubeMat.emissiveIntensity = 0;
    return fx;
  };
  const emergency = (x, y, z, nx, nz, zone, opt = {}) => {
    const c = P.cageLamp(K, opt.amber ? 'amber' : 'emergency');
    c.group.position.set(x, y, z); c.group.rotation.y = Math.atan2(nx, nz); S.add(c.group);
    return LT.add({ pos: V(x + nx * 0.2, y, z + nz * 0.2), mats: [c.mat], baseEmissive: 2, color: opt.amber ? 0xff9a40 : 0xff2a14, intensity: opt.int ?? 1.1, distance: 6.5, mode: opt.mode ?? 'steady', power: opt.power ?? 'emergency', zone });
  };
  const dome = (x, z, zone, drop = 1.2, opt = {}) => {
    const h = ZONES[zone].h;
    const d = P.domeLamp(K, drop);
    put(d.group, x, z, 0, h, S);
    return LT.add({ pos: V(x, h - drop - 0.2, z), mats: [d.mat], baseEmissive: 3, color: 0xffd7a0, intensity: opt.int ?? 4, distance: opt.dist ?? 9, mode: opt.mode ?? 'steady', power: opt.power ?? 'grid', zone, hum: false });
  };

  // ------------------------------------------------------------------ doors
  const groups = new Map();
  for (const [x, y, kind, id] of DOORS) {
    if (!groups.has(id)) groups.set(id, { kind, cells: [] });
    groups.get(id).cells.push([x, y]);
  }
  for (const [id, { kind, cells }] of groups) {
    const axis = doorAxis(L.grid, cells[0][0], cells[0][1]);
    const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
    const cx = (Math.min(...xs) + Math.max(...xs) + 1) / 2, cz = (Math.min(...ys) + Math.max(...ys) + 1) / 2;
    const h = DOOR_H[kind];
    const zone = doorZone(L.grid, cells[0][0], cells[0][1]);
    const frameRot = axis === 'x' ? 0 : HP;
    let pivot = null, door;
    if (kind === 'door' || kind === 'keycard') {
      const fr = P.doorFrame(K, h, kind === 'keycard' ? 'yellowMetal' : 'door');
      put(fr, cx, cz, frameRot, 0, S);
      pivot = new THREE.Group();
      const plate = id === 'pump' ? makeLabel('PUMP STATION', 256, 72, '#c9a227', '#111') : null;
      const leaf = P.doorLeaf(K, { mat: kind === 'keycard' ? 'yellowMetal' : 'door', window: kind !== 'keycard', plateTex: plate });
      leaf.position.x = 0.02;
      P.compact(leaf);
      pivot.add(leaf);
      // hinge at -x edge of the opening (in frame local), door plane at the centre of the cell
      const hx = -0.47;
      pivot.position.set(cx + (axis === 'x' ? hx : 0), 0, cz + (axis === 'x' ? 0 : -hx));
      pivot.rotation.y = frameRot;
      D.add(pivot);
      door = new Door({ level: L, cells, kind, id, pivot, axis, center: V(cx, 1.2, cz), audio: A, noise: (x, z, r, k) => game.emitNoise(x, z, r, k) });
      door.baseRot = frameRot;
    } else if (kind === 'gate') {
      const width = cells.length;
      const g = P.rollerGate(K, width - 0.1, h);
      put(g.housing, cx, cz, frameRot, 0, S);
      const grille = P.compact(g.grille);
      const holder = new THREE.Group(); holder.add(grille);
      put(holder, cx, cz, frameRot, 0, D);
      door = new Door({ level: L, cells, kind, id, pivot: holder, axis, center: V(cx, 1.2, cz), audio: A, noise: (x, z, r, k) => game.emitNoise(x, z, r, k) });
      door.grille = grille;
    } else if (kind === 'lift') {
      const width = cells.length;
      const ld = P.liftDoors(K, width - 0.1, h);
      for (const p of ld.panels) P.compact(p);
      put(ld.group, cx, cz, frameRot, 0, D);
      door = new Door({ level: L, cells, kind, id, pivot: ld.group, axis, center: V(cx, 1.2, cz), audio: A, noise: (x, z, r, k) => game.emitNoise(x, z, r, k) });
      door.panels = ld.panels;
    }
    door.zone = zone;
    W.doors.set(id, door); W.doorList.push(door);
  }
  // doors that are locked/jammed at start
  W.doors.get('lobby_west').locked = false;

  // ------------------------------------------------------------------ hide lockers
  let lockerNo = 13;
  const lockerBank = (x, z, ry, n, hideIdx = -1, zone) => {
    const fwd = V(Math.sin(ry), 0, Math.cos(ry)), right = V(Math.cos(ry), 0, -Math.sin(ry));
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * 0.52;
      const lx = x + right.x * off, lz = z + right.z * off;
      const label = makeLabel(String(lockerNo++), 128, 48);
      const { body, door } = P.locker(K, { label });
      P.compact(body); P.compact(door);
      const grp = new THREE.Group(); grp.add(body); grp.add(door);
      const hide = i === hideIdx;
      put(grp, lx, lz, ry, 0, hide ? D : S);
      colAround(body, 0.0, { occlude: false });
      if (hide) {
        const lk = {
          pos: V(lx, 0, lz), front: V(lx + fwd.x * 0.85, 0, lz + fwd.z * 0.85), yaw: ry + PI,
          eye: V(lx + fwd.x * 0.05, 1.55, lz + fwd.z * 0.05), door, open01: 0, target: 0, zone, group: grp,
          anim(dt) {
            const sp = this.ripping ? 8 : 4;
            this.open01 += THREE.MathUtils.clamp(this.target - this.open01, -dt * sp, dt * sp);
            door.rotation.y = -this.open01 * (this.ripping ? 2.3 : 1.7);
          },
          peek() { this.target = 1; this.ripping = true; A.bang(this.pos, 0.6); setTimeout(() => { this.target = 0; this.ripping = false; }, 1800); },
        };
        W.lockers.push(lk);
        W.animated.push((dt) => lk.anim(dt));
      } else if (Math.random() < 0.25) door.rotation.y = -0.2 - Math.random() * 0.5;
    }
  };

  // ------------------------------------------------------------------ pickups
  const item = (kind, obj, x, y, z, opt = {}) => {
    obj.rotation.order = 'YXZ';
    obj.position.set(x, y, z); obj.rotation.y = opt.ry ?? Math.random() * PI * 2;
    if (opt.rx) obj.rotation.x = opt.rx;
    D.add(obj);
    const it = { kind, obj, id: opt.id ?? kind, taken: false, noteId: opt.noteId, label: opt.label };
    W.items.push(it);
    return it;
  };
  const bottleItem = (x, y, z, lying = true) => item('bottle', P.bottle(K, Math.random() < 0.5 ? 1 : 0), x, y + (lying ? 0.037 : 0), z, { rx: lying ? HP : 0 });
  const batteryItem = (x, y, z) => item('battery', P.battery(K), x, y + 0.017, z);
  const noteItem = (noteId, x, y, z, ry = 0, kind = 'lines') => {
    const n = P.noteProp(K, makePaper(kind));
    return item('note', n, x, y + 0.004, z, { noteId, ry, id: 'note_' + noteId });
  };

  // ==================================================================
  // INTAKE LOBBY  X[1,15] Z[1(alcove),12]
  // ==================================================================
  {
    const be = P.brokenElevator(K);
    put(be, 7.5, 2.05, 0, 0);
    // fill the alcove around the elevator frame
    S.add(K.box(0.62, 3.0, 0.3, 'elevator', 6.28, 1.5, 1.88));
    S.add(K.box(0.62, 3.0, 0.3, 'elevator', 8.72, 1.5, 1.88));
    S.add(K.box(1.4, 0.4, 0.3, 'elevator', 7.5, 2.8, 1.88));
    col(6, 1, 9, 2.1);
    signAt(['SERVICE LIFT 2', 'OUT OF ORDER'], 7.5, 2.85, 2.06, 0, 1, 0.8, 0.22, { bg: '#c9a227' });
    W.special.elevatorSpark = V(7.5, 2.2, 2.2);

    const ctr = P.counter(K, 3.2); put(ctr, 11.5, 7.5, -HP); colAround(ctr);
    const dsk = P.desk(K, { w: 1.4, lamp: true }); put(dsk, 13.0, 7.5, HP); colAround(dsk);
    const ch = P.officeChair(K); put(ch, 13.9, 7.2, -HP + 0.4);
    for (const z of [9.6, 10.15]) { const fc = P.filingCabinet(K, { open: z > 10 ? 2 : -1 }); put(fc, 14.68, z, -HP); colAround(fc); }
    for (const x of [3.0, 5.0]) { const wc = P.waitingChairs(K, 4); put(wc, x, 7.2, HP); colAround(wc); }
    const wc2 = P.waitingChairs(K, 3); put(wc2, 2.0, 10.6, HP); colAround(wc2);
    for (const [x, z] of [[1.5, 2.5], [14.4, 2.6], [1.5, 11.4]]) { const pl = P.plant(K); put(pl, x, z); colAround(pl); }
    const nb = P.noticeBoard(K, [makePaper('lines'), makePaper('census'), makePaper('memo'), makeChildDrawing(), makePaper('x'), makePaper('yy')]);
    nb.position.set(1.0, 1.6, 5.2); nb.rotation.y = HP; S.add(nb);
    const clk = P.wallClock(K, makeClockFace()); clk.position.set(11.0, 2.45, 2.0); S.add(clk);
    const wch = P.wheelchair(K); wch.rotation.set(0, 0.7, HP); wch.position.set(10.5, 0.3, 10.6); S.add(wch); col(10.1, 10.1, 11.0, 11.2);
    signAt(['RECORDS · MORGUE · PUMP STATION', 'STAFF ONLY BEYOND THIS POINT'], 14.98, 2.85, 5.5, -1, 0, 1.4, 0.2);
    signAt(['WARD C  ·  HYDROTHERAPY ↓'], 7.5, 2.6, 11.98, 0, -1, 1.0, 0.22);
    signAt(['BLOCK 13', 'MERIDIAN RESERVOIR SANITARIUM'], 4.2, 2.3, 2.02, 0, 1, 1.6, 0.4, { bg: '#2c3833', fg: '#d6cfba' });
    // gate control box
    const gp = P.cardReader(K); gp.group.position.set(14.97, 1.35, 3.45); gp.group.rotation.y = -HP; S.add(gp.group);
    W.special.gatePanel = { pos: V(14.85, 1.35, 3.45), led: gp.led };
    const gb = K.rbox(0.22, 0.3, 0.08, 0.01, 'genMetal', 14.96, 1.35, 3.1); S.add(gb);
    // lights
    W.fixtures.lobby = [
      tube(4.5, 5.5, 'L'), tube(10.5, 5.5, 'L', { mode: 'flicker' }), tube(4.5, 9.5, 'L', { mode: 'dead' }), tube(10.5, 9.5, 'L'),
    ];
    emergency(14.96, 2.55, 6.6, -1, 0, 'L');
    emergency(7.5, 2.55, 11.97, 0, -1, 'L');
    emergency(2.5, 2.6, 2.03, 0, 1, 'L', { mode: 'dying' });
    // dressing
    for (let i = 0; i < 14; i++) { const p = P.noteProp(K, makePaper('lines')); p.position.set(3 + Math.random() * 10, 0.006, 3 + Math.random() * 8); p.rotation.z = Math.random() * 6; p.rotation.x = -HP; S.add(p); }
    floorDecal('smear', 7.5, 4.6, 1.8, 0.8, HP + 0.2);
    floorDecal('smear', 7.8, 7.0, 2.4, 0.9, HP - 0.1);
    floorDecal('smear', 7.4, 9.8, 2.2, 0.8, HP + 0.15);
    floorDecal('hand', 7.6, 11.3, 0.5, 0.5, 0.4);
    floorDecal('puddle', 4, 4, 3, 3);
    wallDecal('hand', 7.0, 1.2, 11.99, 0, -1, 0.45, 0.45, 0.3);
    wallDecal('drip', 12.5, 2.2, 2.01, 0, 1, 0.6, 1.2);
    noteItem('intake', 11.4, 1.105, 7.1, 0.3, 'memo');
    bottleItem(3.3, 0, 9.3);
    batteryItem(13.1, 0.76, 7.85);
    W.special.spawn = { x: 7.5, z: 3.7, yaw: PI };
  }

  // ==================================================================
  // WEST CORRIDOR X[6,9] Z[13,28]
  // ==================================================================
  {
    W.fixtures.westCorr = [tube(7.5, 15, 'C', { rot: 0 }), tube(7.5, 19.5, 'C'), tube(7.5, 24, 'C', { mode: 'flicker' })];
    emergency(7.5, 2.55, 27.97, 0, -1, 'C');
    S.add(P.pipeRun(K, [[8.72, 2.72, 13], [8.72, 2.72, 28]], 0.065, 'pipe', { hangTo: 3.0 }));
    S.add(P.pipeRun(K, [[8.45, 2.84, 13], [8.45, 2.84, 27.2], [8.45, 2.84, 27.6], [6.4, 2.84, 27.6]], 0.035, 'darkPipe', { hangTo: 3.0 }));
    S.add(P.pipeRun(K, [[6.15, 2.8, 13], [6.15, 2.8, 28]], 0.04, 'rust', { hangTo: 3.0 }));
    const gn = P.gurney(K, { pad: true }); put(gn, 6.45, 21.0, 0.03); colAround(gn);
    const wc = P.wheelchair(K); put(wc, 8.3, 26.4, 2.5); colAround(wc, -0.05);
    lockerBank(6.27, 25.0, HP, 3, 1, 'C');
    signAt(['WASHROOM'], 6.02, 2.0, 19.6, 1, 0, 0.5, 0.16);
    signAt(['WARD C', 'RESIDENTIAL — 12 BEDS'], 8.98, 2.0, 15.9, -1, 0, 0.7, 0.24);
    signAt(['HYDROTHERAPY'], 7.5, 2.45, 27.98, 0, -1, 0.8, 0.18);
    wallDecal('tally', 6.01, 1.4, 15.6, 1, 0, 2.2, 1.1);
    wallDecal('hand', 8.99, 1.3, 21.5, -1, 0, 0.45, 0.45, -0.3);
    wallDecal('drip', 8.99, 2.3, 20.3, -1, 0, 0.6, 1.4);
    floorDecal('puddle', 7.5, 22, 2.5, 3.5);
    floorDecal('foot', 7.2, 17.5, 0.5, 1.0, 0.05);
    floorDecal('foot', 7.6, 19.0, 0.5, 1.0, -0.05);
    bottleItem(8.6, 0, 14.2);
  }

  // ==================================================================
  // WASHROOM X[1,5] Z[15,22]
  // ==================================================================
  {
    for (const z of [15.9, 17.1, 18.3]) { const s = P.sinkUnit(K); put(s, 1.25, z, HP); colAround(s, 0.02); }
    // mirror
    const mirGeo = new THREE.PlaneGeometry(2.8, 1.0);
    const q = game.renderer.q;
    const mirror = new Reflector(mirGeo, { clipBias: 0.003, textureWidth: q.shadow >= 2048 ? 1024 : 512, textureHeight: q.shadow >= 2048 ? 512 : 256, color: 0x7a8580 });
    mirror.position.set(1.02, 1.65, 17.1); mirror.rotation.y = HP;
    mirror.camera.layers.enable(1);
    D.add(mirror);
    S.add(K.box(0.03, 1.06, 2.86, 'stainless', 1.005, 1.65, 17.1));
    wallDecal('hand', 1.03, 1.55, 16.4, 1, 0, 0.35, 0.35, 0.5);
    wallDecal('drip', 1.03, 1.85, 18.2, 1, 0, 0.4, 0.8);
    W.special.mirror = { obj: mirror, center: V(1.0, 1.65, 17.1) };
    // mirror-only ghost
    const ghost = new MonsterModel(M);
    ghost.root.traverse((o) => o.layers.set(1));
    ghost.root.position.set(4.4, 0, 17.1); ghost.root.rotation.y = -HP;
    ghost.root.visible = false;
    scene.add(ghost.root);
    W.special.mirrorGhost = ghost;
    for (const x of [1.65, 2.95]) { const st = P.stall(K, 1.3, 1.6); put(st, x, 21.2, PI); }
    col(1, 20.38, 3.7, 20.42); // stall fronts are open (doors ajar) – partitions only
    col(2.28, 20.4, 2.32, 22);
    for (const x of [1.65, 2.95]) { const t = P.toilet(K); put(t, x, 21.65, PI); }
    const bm = P.bucketMop(K); put(bm, 4.5, 16.0); colAround(bm);
    W.fixtures.washroom = [tube(3.0, 17.5, 'B', { mode: 'flicker', rot: 0 })];
    floorDecal('puddle', 3, 18, 3, 3);
    floorDecal('splatter', 1.6, 16.6, 0.9, 0.9);
    noteItem('washroom', 2.95, 0, 21.0, 2.2);
  }

  // ==================================================================
  // WARD C X[10,30] Z[15,26]
  // ==================================================================
  {
    const beds = [];
    const north = [12, 15, 18, 21, 24, 27], south = [12, 15, 18, 21, 27];
    const nightstands = {};
    north.forEach((x, i) => {
      const b = P.bed(K, { seed: i, restraints: i % 2 === 0, railSide: i % 2 ? 1 : -1, bare: i === 4 });
      put(b, x, 16.1, 0); colAround(b, 0.02);
      const ns = P.nightstand(K); put(ns.group, x + 0.78, 15.25, 0); ns.group.add(ns.drawer); colAround(ns.group);
      beds.push(b); nightstands['n' + x] = ns;
    });
    south.forEach((x, i) => {
      const b = P.bed(K, { seed: 10 + i, restraints: i % 2 === 1, railSide: i % 2 ? -1 : 1, body: x === 15 });
      put(b, x, 24.9, PI); colAround(b, 0.02);
      const ns = P.nightstand(K);
      if (x === 27) {
        // fuse drawer: drawer is dynamic
        put(ns.group, x - 0.78, 25.75, PI); colAround(ns.group);
        const dr = ns.drawer;
        const holder = new THREE.Group(); holder.add(dr);
        put(holder, x - 0.78, 25.75, PI, 0, D);
        W.special.fuseDrawer = { drawer: dr, pos: V(x - 0.78, 0.6, 25.4), open: 0 };
      } else { put(ns.group, x - 0.78, 25.75, PI); ns.group.add(ns.drawer); colAround(ns.group); }
    });
    // curtains: partial dividers + the enclosed bed at x=21
    const curtainRail = (pts) => S.add(K.tube(pts, 0.012, 'chrome', false, 6, 0.08));
    for (const x of [13.5, 19.5, 25.5]) {
      curtainRail([[x, 2.35, 15.05], [x, 2.35, 17.3]]);
      const c = P.curtain(K, 1.4, 2.0, {}); c.group.position.set(x, 2.35, 15.75); c.group.rotation.y = HP; D.add(c.group);
      W.animated.push(() => {});
    }
    // scare bed enclosure (north bed at x=21)
    curtainRail([[20.25, 2.35, 15.05], [20.25, 2.35, 17.4], [21.75, 2.35, 17.4], [21.75, 2.35, 15.05]]);
    for (const [x, z, w, ry] of [[20.25, 16.2, 2.3, HP], [21.75, 16.2, 2.3, HP]]) {
      const c = P.curtain(K, w, 2.0, {}); c.group.position.set(x, 2.35, z); c.group.rotation.y = ry; D.add(c.group);
    }
    // front panel: glowing silhouette from a lamp inside
    {
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
      const g = cv.getContext('2d');
      const grd = g.createRadialGradient(128, 110, 10, 128, 120, 150);
      grd.addColorStop(0, 'rgba(255,190,120,1)'); grd.addColorStop(1, 'rgba(40,20,10,1)');
      g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
      g.fillStyle = '#000'; g.filter = 'blur(6px)';
      g.beginPath(); g.ellipse(140, 52, 13, 20, 0.2, 0, 7); g.fill();
      g.beginPath(); g.moveTo(128, 70); g.lineTo(152, 70); g.lineTo(160, 160); g.lineTo(150, 230); g.lineTo(132, 230); g.lineTo(122, 160); g.fill();
      g.lineWidth = 7; g.strokeStyle = '#000'; g.lineCap = 'round';
      g.beginPath(); g.moveTo(130, 80); g.quadraticCurveTo(100, 150, 96, 228); g.moveTo(150, 80); g.quadraticCurveTo(178, 150, 188, 235); g.stroke();
      g.lineWidth = 3;
      for (const [x0, y0] of [[96, 228], [188, 235]]) for (let f = -2; f <= 2; f++) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + f * 5, y0 + 22); g.stroke(); }
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const c = P.curtain(K, 1.5, 2.0, {});
      c.mat.emissiveMap = tex; c.mat.emissive = new THREE.Color(0xffb070); c.mat.emissiveIntensity = 0.0;
      c.group.position.set(21.0, 2.35, 17.4); D.add(c.group);
      W.special.curtainBed = { mat: c.mat, group: c.group, pos: V(21, 1.2, 16.5), glow: 0 };
    }
    // aisle props
    const tr = P.trolley(K); put(tr, 18.2, 20.4, 0.4); colAround(tr);
    for (const [x, z] of [[13.2, 17.3], [22.6, 23.7], [16.4, 17.2]]) { const iv = P.ivStand(K); put(iv, x, z, Math.random() * 6); col(x - 0.15, z - 0.15, x + 0.15, z + 0.15); }
    const wc = P.wheelchair(K); put(wc, 25.8, 20.2, -2.2); colAround(wc, -0.05);
    const oc = P.officeChair(K); oc.rotation.set(HP, 0.3, 0); oc.position.set(14.2, 0.25, 20.8); S.add(oc);
    const gn = P.gurney(K, { sheetBody: true, seed: 5 }); put(gn, 28.9, 20.5, 0.05); colAround(gn);
    W.fixtures.ward = [
      tube(13, 18.6, 'W'), tube(19, 18.6, 'W', { mode: 'dead' }), tube(25, 18.6, 'W', { mode: 'flicker' }),
      tube(13, 22.4, 'W', { mode: 'dead' }), tube(19, 22.4, 'W'), tube(25, 22.4, 'W', { mode: 'dying' }),
    ];
    emergency(24.5, 2.5, 25.96, 0, -1, 'W');
    emergency(10.04, 2.55, 20.5, 1, 0, 'W', { mode: 'dying' });
    // walls: the count
    wallDecal('tally', 29.98, 1.35, 18.2, -1, 0, 3.2, 1.6);
    wallDecal('tally', 29.98, 1.35, 21.4, -1, 0, 3.2, 1.6, PI);
    graffiti('IT COUNTS AT NIGHT', 29.97, 2.35, 19.8, -1, 0, 3.6, 0.9);
    const cd = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.4), new THREE.MeshStandardMaterial({ map: makeChildDrawing(), roughness: 0.9 }));
    cd.position.set(10.02, 1.45, 20.8); cd.rotation.y = HP; cd.rotation.z = 0.06; S.add(cd);
    floorDecal('splatter', 15.2, 23.4, 1.2, 1.2);
    floorDecal('smear', 15.5, 21.5, 2.6, 0.9, 1.3);
    floorDecal('puddle', 21, 20.5, 4, 3);
    floorDecal('foot', 21.0, 18.6, 0.5, 1.0, PI);
    noteItem('ward', 18.0, 0.935, 20.25, 0.9);
    bottleItem(24.2, 0, 21.4); bottleItem(11.2, 0, 19.0);
    W.special.nightstands = nightstands;
  }

  // ==================================================================
  // HYDROTHERAPY X[1,18] Z[29,41] (h 4.4)
  // ==================================================================
  {
    const tubs = [30.6, 32.9, 35.2, 37.5, 39.8];
    tubs.forEach((z, i) => {
      const fuseTub = i === 3;
      const t = P.tub(K, { cover: !fuseTub, water: fuseTub || i === 1, waterLevel: 0.72 });
      put(t.group, 2.35, z, HP); colAround(t.group, 0.02);
      if (fuseTub) W.special.fuseTub = { pos: V(2.35, 0.7, z), water: t.water };
      if (t.water) W.emitters.push({ water: t.water });
    });
    const tk = P.tank(K, 4.2, 6.2, 1.15);
    put(tk.group, 11.2, 35.4, 0); col(9.1, 32.3, 13.3, 38.5, { maxY: 1.2 });
    W.special.tankWater = tk.water;
    W.emitters.push({ water: tk.water });
    // hose station & valves on the east wall
    S.add(P.pipeRun(K, [[17.85, 0.4, 30.0], [17.85, 3.9, 30.0], [17.85, 3.9, 40.5]], 0.07, 'pipe', { hangTo: 4.4 }));
    S.add(P.pipeRun(K, [[17.8, 1.4, 31], [17.8, 1.4, 33.2]], 0.045, 'pipe'));
    for (const z of [31.5, 32.6]) { const v = P.valveWheel(K, 0.12, 'redMetal'); v.position.set(17.65, 1.4, z); v.rotation.y = HP; S.add(v); }
    const gauges = [makeGauge('PSI'), makeGauge('°C')];
    for (const [z, i] of [[31.2, 0], [32.9, 1]]) { const ga = P.gauge(K, gauges[i]); ga.group.position.set(17.98, 1.9, z); ga.group.rotation.y = -HP; S.add(ga.group); }
    S.add(K.tube([[17.7, 1.2, 33.2], [17.2, 0.6, 33.4], [16.6, 0.03, 33.0], [15.8, 0.03, 32.1], [16.4, 0.03, 31.2], [17.3, 0.03, 31.6]], 0.035, 'blackPlastic', false, 8, 0.4));
    S.add(P.pipeRun(K, [[1.15, 3.9, 29.5], [1.15, 3.9, 40.6]], 0.08, 'rust', { hangTo: 4.4 }));
    for (const z of tubs) S.add(P.pipeRun(K, [[1.15, 3.9, z - 0.5], [1.15, 1.1, z - 0.5], [1.5, 0.9, z - 0.9]], 0.025, 'pipe'));
    // chains over the tank
    for (const [x, z, l] of [[10.4, 34.0, 2.2], [12.1, 36.5, 2.6], [11.0, 37.6, 1.6]]) { const c = P.chain(K, l); c.position.set(x, 4.4, z); S.add(c); }
    const gr = P.gurney(K, { pad: true }); put(gr, 15.6, 38.9, HP); colAround(gr);
    const wc = P.wheelchair(K); put(wc, 6.2, 39.9, 0.4); colAround(wc, -0.05);
    signAt(['HYDROTHERAPY SUITE', 'CONTINUOUS IMMERSION — DO NOT DISTURB'], 9.0, 2.6, 29.02, 0, 1, 1.4, 0.3);
    W.fixtures.hydro = [dome(6, 31.8, 'H', 1.5), dome(6, 38.4, 'H', 1.5, { mode: 'flicker' }), dome(14.8, 31.8, 'H', 1.5, { mode: 'dead' }), dome(14.8, 38.4, 'H', 1.5)];
    emergency(7.5, 2.5, 29.03, 0, 1, 'H');
    emergency(17.97, 2.5, 35.5, -1, 0, 'H', { mode: 'dying' });
    for (const [x, z] of [[5.5, 33], [8, 39], [14.5, 30.5], [12, 40]]) floorDecal('puddle', x, z, 3, 3, Math.random() * 6);
    floorDecal('foot', 8.4, 33.5, 0.5, 1.0, 0.6);
    floorDecal('foot', 8.0, 31.6, 0.5, 1.0, 0.2);
    floorDecal('smear', 6.0, 35.5, 2.2, 0.8, 0.9);
    const cb = P.clipboard(K); cb.position.set(17.94, 1.5, 36.6); cb.rotation.set(0, -HP, HP); S.add(cb);
    noteItem('hydro', 15.6, 0.94, 38.9, 1.2);
    bottleItem(13.9, 0, 32.0);
    W.special.hydroWaterPos = V(11.2, 1.0, 35.4);
  }

  // ==================================================================
  // GENERATOR HALL X[19,30] Z[27,41] (h 4.2)
  // ==================================================================
  {
    const gauges = [makeGauge('VOLTS'), makeGauge('RPM'), makeGauge('OIL')];
    const gen = P.generator(K, gauges);
    P.compact(gen.group, [gen.parts.panel]);
    P.compact(gen.parts.panel, [gen.parts.lever, ...gen.parts.sockets, ...gen.parts.lamps, ...gen.parts.gauges]);
    put(gen.group, 24.6, 35.1, PI, 0, D);
    col(22.4, 34.15, 26.75, 36.05, { occlude: false });
    col(24.3, 33.7, 25.95, 34.15, { maxY: 1.7 }); // panel stand
    W.special.generator = { ...gen.parts, group: gen.group, panelPos: V(25.2, 1.3, 33.85), fusesIn: 0 };
    const ft = P.fuelTank(K); put(ft, 28.9, 38.6, HP); colAround(ft);
    const wb = P.workbench(K); put(wb, 22.3, 40.55, PI); colAround(wb);
    for (const [x, z, m] of [[29.4, 29.3, 'redMetal'], [28.75, 29.5, 'yellowMetal'], [29.4, 30.0, 'genMetal']]) { const b = P.barrel(K, m); put(b, x, z, Math.random() * 3); colAround(b); }
    const cp = P.corpse(K); put(cp, 19.45, 38.6, HP);
    col(19.1, 38.3, 20.7, 39.1, { maxY: 0.5, nav: false });
    floorDecal('splatter', 19.9, 38.6, 1.4, 1.4);
    wallDecal('drip', 19.01, 1.2, 38.6, 1, 0, 0.8, 1.2);
    wallDecal('smear', 19.01, 0.8, 38.6, 1, 0, 1.2, 0.5, HP);
    const clp = P.clipboard(K); clp.position.set(20.5, 0.01, 39.3); clp.rotation.y = 0.6; S.add(clp);
    for (const [x, z] of [[19.03, 31], [19.03, 37]]) { const bp = P.breakerPanel(K); bp.position.set(x, 1.5, z); bp.rotation.y = HP; S.add(bp); }
    { const bp = P.breakerPanel(K); bp.position.set(29.97, 1.5, 34); bp.rotation.y = -HP; S.add(bp); }
    const ct = P.cableTray(K, 11); ct.position.set(24.5, 3.6, 29.2); S.add(ct);
    const ct2 = P.cableTray(K, 12); ct2.position.set(29.5, 3.6, 34.5); ct2.rotation.y = HP; S.add(ct2);
    S.add(P.pipeRun(K, [[19.3, 3.8, 28.3], [29.6, 3.8, 28.3], [29.6, 3.8, 40.7]], 0.09, 'darkPipe', { hangTo: 4.2 }));
    lockerBank(29.74, 32.0, -HP, 2, 0, 'G');
    W.fixtures.gen = [
      tube(22, 31, 'G', { hang: 0.9 }), tube(27.5, 31, 'G', { hang: 0.9, mode: 'flicker' }),
      tube(22, 38.6, 'G', { hang: 0.9 }), tube(27.5, 38.6, 'G', { hang: 0.9, mode: 'dead' }),
    ];
    emergency(24.5, 2.5, 28.03, 0, 1, 'G');
    emergency(19.03, 2.5, 34.5, 1, 0, 'G');
    signAt(['GENERATOR B13', 'DANGER — HIGH VOLTAGE'], 21.0, 2.4, 28.02, 0, 1, 1.0, 0.32, { bg: '#c9a227' });
    graffiti('DONT START IT', 29.96, 2.2, 31.5, -1, 0, 2.6, 0.65);
    floorDecal('puddle', 26, 31, 4, 3);
    batteryItem(20.6, 0, 39.7);
    noteItem('enumerator', 20.2, 0.0, 38.1, 0.4, 'census');
  }

  // ==================================================================
  // EAST CORRIDOR X[16,59] Z[3,7]
  // ==================================================================
  {
    W.fixtures.eastCorr = [];
    for (const x of [18.5, 24, 29.5, 35, 40.5, 46, 51.5, 57]) W.fixtures.eastCorr.push(tube(x, 5, 'C', { rot: HP, mode: x === 35 ? 'flicker' : x === 46 ? 'dead' : 'steady', zone: 'C' }));
    S.add(P.pipeRun(K, [[16, 2.72, 3.3], [59, 2.72, 3.3]], 0.07, 'pipe', { hangTo: 3.0 }));
    S.add(P.pipeRun(K, [[16, 2.82, 3.6], [58.6, 2.82, 3.6], [58.6, 2.82, 42]], 0.04, 'rust', { hangTo: 3.0 }));
    const g1 = P.gurney(K, { bodyBag: true }); put(g1, 33.2, 3.45, HP); colAround(g1);
    lockerBank(45.0, 3.27, 0, 3, 1, 'C');
    emergency(16.03, 2.5, 5, 1, 0, 'C');
    emergency(58.97, 2.5, 5, -1, 0, 'C');
    signAt(['RECORDS ARCHIVE'], 40.5, 2.45, 6.98, 0, -1, 0.9, 0.2);
    signAt(['DR. I. VARGA — DIRECTOR'], 22.5, 2.45, 6.98, 0, -1, 0.9, 0.2);
    signAt(['FREIGHT LIFT  ·  PUMP STATION  ·  MORGUE  →'], 52, 2.45, 3.02, 0, 1, 1.6, 0.2);
    wallDecal('tally', 27, 1.4, 3.01, 0, 1, 3.4, 1.7);
    graffiti('COUNT YOURSELF', 50.5, 1.55, 3.01, 0, 1, 3.2, 0.8);
    wallDecal('hand', 37.0, 1.3, 6.99, 0, -1, 0.45, 0.45, 0.2);
    wallDecal('hand', 37.4, 1.1, 6.99, 0, -1, 0.45, 0.45, -0.3);
    floorDecal('smear', 30, 5, 3, 1, 0.05);
    floorDecal('puddle', 48, 5, 4, 3);
    bottleItem(55.5, 0, 6.4);
  }

  // ==================================================================
  // OFFICE X[18,29] Z[8,13]
  // ==================================================================
  {
    const dsk = P.desk(K, { w: 1.6, lamp: true, crtOn: false }); put(dsk, 24.0, 11.4, 0); colAround(dsk);
    const ch = P.officeChair(K); put(ch, 24.1, 12.25, PI + 0.3);
    for (const z of [9.2, 10.6]) { const bc = P.bookcase(K, 1.3); put(bc, 28.83, z, -HP); colAround(bc); }
    for (const [z, open] of [[8.6, -1], [9.1, 1]]) { const fc = P.filingCabinet(K, { open }); put(fc, 18.3, z, HP); colAround(fc); }
    const cot = P.bed(K, { bare: true, rail: false }); put(cot, 20.3, 11.9, HP); colAround(cot);
    // reel-to-reel tape recorder on the desk
    const tape = new THREE.Group();
    tape.add(K.rbox(0.42, 0.12, 0.3, 0.01, 'wood', 0, 0.06, 0));
    tape.add(K.box(0.4, 0.01, 0.28, 'blackPlastic', 0, 0.125, 0));
    const reels = [];
    for (const x of [-0.1, 0.1]) { const r = K.cyl(0.075, 0.075, 0.012, 'chrome', x, 0.14, -0.03, 0, 0, 0, 24); tape.add(r); reels.push(r); tape.add(K.cyl(0.03, 0.03, 0.016, 'binderRed', x, 0.141, -0.03, 0, 0, 0, 12)); }
    for (let i = 0; i < 5; i++) tape.add(K.box(0.03, 0.015, 0.02, 'chrome', -0.1 + i * 0.05, 0.13, 0.11));
    put(tape, 24.55, 11.15, 0.1, 0.76, D);
    W.special.tape = { group: tape, reels, pos: V(24.55, 0.85, 11.15), played: false };
    noteItem('varga', 23.6, 0.765, 11.25, -0.2, 'memo');
    const clk = P.wallClock(K, makeClockFace()); clk.position.set(24, 2.4, 8.0); S.add(clk);
    const cert = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.33), new THREE.MeshStandardMaterial({ map: makeSign(['CERTIFICATE', 'I. VARGA, M.D.'], 512, 380, { bg: '#e6dcc0' }), roughness: 0.6 }));
    cert.position.set(18.02, 1.7, 11.0); cert.rotation.y = HP; S.add(cert);
    W.fixtures.office = [tube(21, 10.5, 'O', { mode: 'flicker' }), tube(26.5, 10.5, 'O')];
    // warm desk lamp
    W.fixtures.deskLamp = LT.add({ pos: V(24.6, 1.3, 11.2), mats: [], color: 0xffc080, intensity: 1.6, distance: 5, mode: 'steady', power: 'grid', zone: 'O' });
    emergency(22.5, 2.5, 8.03, 0, 1, 'O', { amber: true, mode: 'dying' });
    floorDecal('puddle', 21, 10, 2.5, 2.5);
    batteryItem(18.4, 1.33, 9.1);
  }

  // ==================================================================
  // RECORDS ARCHIVE X[31,54] Z[8,23] (h 3.6)
  // ==================================================================
  {
    const rows = [10.3, 12.7, 17.9, 20.3];
    const segs = [[32.2, 36.4], [39.2, 43.4], [46.4, 52.9]];
    for (const z of rows) for (const [x0, x1] of segs) {
      const len = x1 - x0;
      const sh = P.shelving(K, len, { h: 2.5 });
      put(sh, (x0 + x1) / 2, z, 0);
      col(x0, z - 0.29, x1, z + 0.29, { occlude: true });
    }
    const tbl = P.desk(K, { w: 1.6, crt: false, papers: true }); put(tbl, 34.2, 15.5, 0); colAround(tbl);
    const ch = P.officeChair(K); put(ch, 34.3, 16.3, PI - 0.4);
    const lamp = P.deskLamp(K, 33.7, 0.76, 15.3); S.add(lamp);
    for (let i = 0; i < 18; i++) { const p = P.noteProp(K, makePaper('lines')); p.position.set(37.5 + Math.random() * 8, 0.006, 14 + Math.random() * 3); p.rotation.set(-HP, 0, Math.random() * 6); S.add(p); }
    const tr = P.trolley(K); put(tr, 45.0, 15.0, 1.2); colAround(tr);
    wallDecal('tally', 31.01, 1.4, 11.5, 1, 0, 3.4, 1.7);
    wallDecal('tally', 31.01, 1.4, 15.0, 1, 0, 3.4, 1.7, 0.02);
    wallDecal('tally', 31.01, 1.4, 18.5, 1, 0, 3.4, 1.7, -0.02);
    graffiti('IT ADDS ONE', 31.02, 2.75, 15.0, 1, 0, 3.2, 0.8);
    graffiti('41', 53.98, 1.6, 11.5, -1, 0, 1.2, 0.6, { size: 200, x: 380 });
    lockerBank(53.74, 19.6, -HP, 3, 1, 'A');
    W.fixtures.archive = [
      tube(35, 15.5, 'A', { hang: 0.5, rot: HP }), tube(42, 15.5, 'A', { hang: 0.5, rot: HP, mode: 'flicker' }), tube(49, 15.5, 'A', { hang: 0.5, rot: HP }),
      tube(35, 8.9, 'A', { hang: 0.5, rot: HP, mode: 'dead' }), tube(49, 8.9, 'A', { hang: 0.5, rot: HP }), tube(42, 22.0, 'A', { hang: 0.5, rot: HP, mode: 'dying' }),
    ];
    emergency(40.5, 2.45, 8.03, 0, 1, 'A');
    emergency(53.97, 2.45, 15.5, -1, 0, 'A');
    floorDecal('puddle', 50, 15.5, 4, 2.5);
    noteItem('ledger', 34.6, 0.765, 15.35, 0.15, 'census');
    noteItem('archive', 47.5, 0, 22.4, 1.2);
    bottleItem(38.0, 0, 15.8);
    batteryItem(52.3, 0, 8.6);
  }

  // ==================================================================
  // MORGUE X[31,45] Z[24,37] (h 3.2)
  // ==================================================================
  {
    const labels = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) labels[r * 5 + c] = makeLabel(String((2 - r) * 5 + c + 1), 128, 48);
    const bank = P.drawerBank(K, 5, 3, labels);
    for (const d of bank.doors) P.compact(d);
    P.compact(bank.group, bank.doors);
    put(bank.group, 31.1, 30.5, HP, 0, D);
    col(31, 28.7, 31.25, 32.3);
    // drawer 7: row 1 (middle), col 1
    const d7 = bank.doors[1 * 5 + 1];
    const tray = new THREE.Group();
    tray.add(K.box(0.6, 0.03, 1.9, 'stainless', 0, 0, -0.95));
    tray.add(P.sheetDrape(K, { w: 0.95, l: 1.85, top: 0.03, half: 0.28, body: true, seed: 77 }).translateZ(-0.95));
    // feet sticking out with a toe tag
    const feet = new THREE.Group();
    for (const x of [-0.09, 0.09]) feet.add(K.sph(0.05, 'corpseSkin', x, 0.08, 0, 0.8, 1.6, 0.7));
    const tag = K.box(0.05, 0.002, 0.08, 'paperProp', 0.09, 0.03, 0.08, 0.3, 0, 0, 0);
    feet.add(tag);
    feet.position.set(0, 0.0, -0.02);
    tray.add(feet);
    tray.position.set(d7.position.x + (bank.dw - 0.05) / 2, d7.position.y - 0.2, 0);
    tray.visible = false;
    bank.group.add(tray);
    W.special.drawer7 = { door: d7, tray, pos: V(31.4, 1.11, 31.18), open: 0 };
    // other doors that will rattle
    W.special.drawer12 = { door: bank.doors[0 * 5 + 1], pos: V(31.4, 0.49, 31.18) };
    const t1 = P.autopsyTable(K); put(t1, 36.2, 30.4, 0); colAround(t1);
    const t2 = P.autopsyTable(K); put(t2, 41.0, 30.4, 0); colAround(t2);
    const sl1 = P.surgicalLamp(K, 1.0); put(sl1.group, 36.2, 30.2, 0, 3.2);
    const sl2 = P.surgicalLamp(K, 1.0); put(sl2.group, 41.0, 30.2, 0, 3.2);
    W.fixtures.surgical = [
      LT.add({ pos: V(36.2, 2.0, 30.2), mats: [sl1.mat], baseEmissive: 3, color: 0xf2f6ff, intensity: 5, distance: 6, mode: 'dead', power: 'grid', zone: 'M' }),
      LT.add({ pos: V(41.0, 2.0, 30.2), mats: [sl2.mat], baseEmissive: 3, color: 0xf2f6ff, intensity: 5, distance: 6, mode: 'steady', power: 'grid', zone: 'M' }),
    ];
    const body2 = P.sheetDrape(K, { w: 1.1, l: 1.9, top: 0.92, half: 0.36, body: true, seed: 31 }); put(body2, 41.0, 30.4, 0);
    const g1 = P.gurney(K, { bodyBag: true }); put(g1, 34.0, 35.6, HP); colAround(g1);
    const g2 = P.gurney(K, { sheetBody: true, seed: 13 }); put(g2, 42.4, 35.6, HP); colAround(g2);
    const tr = P.trolley(K); put(tr, 38.6, 28.0, 0.2); colAround(tr);
    { const s = P.sinkUnit(K); put(s, 44.75, 27.0, -HP); colAround(s); }
    { const s = P.sinkUnit(K); put(s, 44.75, 28.2, -HP); colAround(s); }
    lockerBank(44.74, 33.0, -HP, 2, 0, 'M');
    W.fixtures.morgue = [tube(34, 27, 'M'), tube(41, 27, 'M', { mode: 'flicker' }), tube(34, 33.6, 'M', { mode: 'dead' }), tube(41, 33.6, 'M')];
    emergency(37.5, 2.5, 24.03, 0, 1, 'M');
    emergency(38.5, 2.5, 36.97, 0, -1, 'M');
    signAt(['MORGUE · COLD STORAGE', 'DRAWERS 1–15'], 31.02, 2.5, 30.5, 1, 0, 1.2, 0.3);
    floorDecal('splatter', 36.4, 31.8, 1.4, 1.4);
    floorDecal('smear', 37.5, 33.5, 2.8, 1.0, 0.4);
    floorDecal('puddle', 39, 29, 4, 3);
    for (const [x, z] of [[38.5, 30.4], [36.2, 33]]) { const dr = new THREE.Mesh(new THREE.CircleGeometry(0.12, 20), M.get('stainless')); dr.rotation.x = -HP; dr.position.set(x, 0.006, z); S.add(dr); }
    noteItem('autopsy', 40.6, 0.935, 27.9, 0.4);
    bottleItem(43.5, 0, 25.0);
  }

  // ==================================================================
  // PUMP STATION X[46,54] Z[24,37] (h 5)
  // ==================================================================
  {
    const pg = makeGauge('BAR');
    const p1 = P.pump(K, pg); put(p1.group, 50.4, 27.6, 0); col(48.8, 27.1, 51.7, 28.1);
    const p2 = P.pump(K, pg); put(p2.group, 50.4, 32.4, 0); col(48.8, 31.9, 51.7, 32.9);
    W.special.pumpNeedles = [p1.needle, p2.needle];
    for (const z of [27.6, 32.4]) S.add(P.pipeRun(K, [[48.8, 0.72, z], [46.2, 0.72, z], [46.2, 4.9, z]], 0.17, 'darkPipe'));
    // sump tank whose water drains
    const sump = P.tank(K, 3.0, 2.2, 0.9);
    put(sump.group, 50.2, 35.3, 0); col(48.7, 34.2, 51.7, 36.4, { maxY: 1 });
    W.special.sumpWater = sump.water;
    W.emitters.push({ water: sump.water });
    // control console with keypad (north wall)
    const con = new THREE.Group();
    con.add(K.rbox(1.6, 1.0, 0.35, 0.02, 'genMetal', 0, 1.1, 0));
    con.add(K.box(1.6, 0.6, 0.5, 'genMetal', 0, 0.3, 0.05));
    for (let i = 0; i < 3; i++) { const ga = P.gauge(K, pg); ga.group.position.set(-0.5 + i * 0.35, 1.38, 0.18); con.add(ga.group); }
    const kp = P.keypadBox(K); kp.group.position.set(0.55, 1.15, 0.18); con.add(kp.group);
    con.add(K.box(0.5, 0.12, 0.002, 'yellowMetal', -0.2, 0.92, 0.176, 0, 0, 0, 0));
    put(con, 50.6, 24.2, 0, 0, S); col(49.8, 24, 51.4, 24.5);
    W.special.keypad = { pos: V(51.15, 1.15, 24.45), led: kp.led };
    signAt(['LIFT PIT DRAINAGE', 'INTERLOCK: NIGHT COUNT REQUIRED'], 48.4, 2.0, 24.02, 0, 1, 1.2, 0.3, { bg: '#c9a227' });
    W.fixtures.pump = [dome(48.5, 30.0, 'P', 2.2, { int: 5 }), dome(52.3, 30.0, 'P', 2.2, { int: 5, mode: 'flicker' })];
    emergency(53.97, 2.5, 29.0, -1, 0, 'P');
    for (const [x, z] of [[47.5, 26], [52, 30], [48, 34]]) floorDecal('puddle', x, z, 3, 3);
    noteItem('pump', 47.2, 0.0, 30.4, 2.0);
    wallDecal('tally', 46.01, 1.6, 30.0, 1, 0, 3, 1.5);
  }

  // ==================================================================
  // EAST SERVICE CORRIDOR X[55,59] Z[7,42] + SOUTH CORRIDOR X[33,55] Z[38,42]
  // ==================================================================
  {
    W.fixtures.serviceCorr = [];
    for (const z of [9.5, 14, 24, 29, 34, 39.5]) W.fixtures.serviceCorr.push(tube(57, z, 'C', { mode: z === 29 ? 'flicker' : z === 34 ? 'dead' : 'steady' }));
    W.fixtures.southCorr = [];
    for (const x of [36, 41, 46, 51]) W.fixtures.southCorr.push(tube(x, 40, 'C', { rot: HP, mode: x === 41 ? 'dead' : x === 46 ? 'flicker' : 'steady' }));
    // freight lift lobby: amber beacons
    W.fixtures.liftBeacon = [emergency(58.97, 2.7, 16.4, -1, 0, 'C', { amber: true, power: 'always', mode: 'dead' }), emergency(58.97, 2.7, 21.6, -1, 0, 'C', { amber: true, power: 'always', mode: 'dead' })];
    const cp = P.callPanel(K); cp.group.position.set(58.98, 1.3, 16.5); cp.group.rotation.y = -HP; S.add(cp.group);
    W.special.liftPanel = { pos: V(58.85, 1.3, 16.5), button: cp.button };
    signAt(['FREIGHT LIFT B13', 'TO SURFACE · MAX 2000 KG'], 58.98, 2.9, 19.0, -1, 0, 1.6, 0.18, { bg: '#c9a227' });
    // lift car interior
    const car = new THREE.Group();
    car.add(K.box(0.05, 1.0, 1.4, 'stainless', 64.95, 1.0, 19.0));
    for (let z = 16.2; z < 22; z += 0.6) car.add(K.box(0.03, 2.8, 0.06, 'stainless', 64.97, 1.4, z));
    const lp = P.callPanel(K); lp.group.position.set(64.96, 1.3, 17.5); lp.group.rotation.y = -HP; car.add(lp.group);
    S.add(car);
    W.special.carPanel = { pos: V(64.8, 1.3, 17.5), button: lp.button };
    W.fixtures.car = [tube(62.5, 19, 'E', { power: 'grid', mode: 'steady' })];
    lockerBank(55.27, 24.5, HP, 3, 1, 'C');
    lockerBank(55.27, 36.5, HP, 2, 0, 'C');
    const g = P.gurney(K, { sheetBody: true, seed: 3 }); put(g, 58.4, 31.0, 0.1); colAround(g);
    const wc = P.wheelchair(K); put(wc, 45.0, 41.3, 1.8); colAround(wc, -0.05);
    const bb = P.gurney(K, { bodyBag: true }); put(bb, 50.0, 41.3, HP); colAround(bb);
    lockerBank(33.27, 40.0, HP, 2, 1, 'C');
    emergency(55.03, 2.5, 40, 1, 0, 'C');
    emergency(33.03, 2.5, 39.2, 1, 0, 'C');
    wallDecal('tally', 47, 1.4, 41.99, 0, -1, 3.4, 1.7);
    graffiti('42', 40.0, 1.6, 41.98, 0, -1, 1.2, 0.6, { size: 220, x: 360 });
    graffiti('NOT ONE MORE', 58.98, 1.6, 34.5, -1, 0, 2.8, 0.7);
    for (const [x, z] of [[57, 26], [57, 37], [44, 40], [52, 39.5]]) floorDecal('puddle', x, z, 3, 3);
    floorDecal('smear', 57, 18.6, 2.8, 1.0, HP);
    wallDecal('hand', 58.98, 1.3, 20.6, -1, 0, 0.45, 0.45, 0.3);
    bottleItem(56.5, 0, 33.2); batteryItem(34.2, 0, 41.5);
    S.add(P.pipeRun(K, [[33, 2.72, 41.6], [55, 2.72, 41.6]], 0.06, 'pipe', { hangTo: 3.0 }));
  }

  // ------------------------------------------------------------------ bake static geometry
  bake(S, scene);
  return W;
}

// merge static meshes per material & 12m chunk; keeps draw calls low
function bake(root, scene) {
  root.updateMatrixWorld(true);
  const buckets = new Map();
  const keep = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.layers.mask !== 1) { keep.push(o); return; }
    const mat = o.material;
    let g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    g.computeBoundingBox();
    const c = g.boundingBox.getCenter(new THREE.Vector3());
    const key = mat.uuid + '|' + Math.floor(c.x / 12) + '|' + Math.floor(c.z / 12) + '|' + (o.castShadow ? 1 : 0) + '|' + o.renderOrder;
    if (!buckets.has(key)) buckets.set(key, { mat, geos: [], cast: o.castShadow, order: o.renderOrder });
    buckets.get(key).geos.push(g);
  });
  for (const { mat, geos, cast, order } of buckets.values()) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    merged.computeBoundingSphere();
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = cast && !mat.transparent; m.receiveShadow = true; m.renderOrder = order;
    m.matrixAutoUpdate = false;
    scene.add(m);
  }
  for (const o of keep) scene.attach(o);
}
