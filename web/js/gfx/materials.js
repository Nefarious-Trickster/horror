import * as THREE from 'three';

// Shared material library. Static props are merged per material, so share aggressively.
export class Materials {
  constructor(tex, decals) {
    this.tex = tex;
    this.decals = decals;
    this.lib = {};
    this.flicker = []; // emissive materials that animate
    this.build();
  }

  pbr(name, texName, opt = {}) {
    const t = this.tex[texName];
    const m = new THREE.MeshStandardMaterial({
      map: t.map, normalMap: t.normalMap,
      roughnessMap: t.orm, metalnessMap: t.orm, aoMap: t.orm,
      roughness: opt.roughness ?? 1, metalness: opt.metalness ?? 1,
      color: opt.color ?? 0xffffff,
      envMapIntensity: opt.env ?? 0.35,
      side: opt.side ?? THREE.FrontSide,
    });
    m.normalScale.set(opt.normal ?? 1, opt.normal ?? 1);
    m.name = name;
    this.lib[name] = m;
    return m;
  }

  build() {
    // architecture
    for (const n of ['paint', 'paintWard', 'paintLobby', 'tiles', 'tilesMorgue', 'floorTiles', 'floorTilesMorgue',
      'linoleum', 'concrete', 'concreteWall', 'concreteCeil', 'cinder', 'cinderRecords', 'ceiling', 'steelFloor']) {
      this.pbr(n, n, { env: n.startsWith('tiles') || n.startsWith('floor') ? 0.6 : 0.3 });
    }
    this.lib.steelWall = this.pbr('steelWall', 'metalElev');
    // prop surfaces
    this.pbr('locker', 'metalLocker');
    this.pbr('door', 'metalDoor');
    this.pbr('cabinet', 'metalCabinet');
    this.pbr('genMetal', 'metalGen');
    this.pbr('elevator', 'metalElev');
    this.pbr('redMetal', 'metalRed');
    this.pbr('yellowMetal', 'metalYellow');
    this.pbr('whiteMetal', 'metalWhite');
    this.pbr('stainless', 'stainless', { env: 0.9 });
    this.pbr('wood', 'wood');
    this.pbr('sheet', 'fabric', { side: THREE.DoubleSide, normal: 0.6 });
    this.pbr('curtain', 'fabricCurtain', { side: THREE.DoubleSide, normal: 0.6 });
    this.pbr('mattress', 'fabricMattress');
    this.pbr('gown', 'fabricGown', { side: THREE.DoubleSide });
    this.pbr('rust', 'rust');
    this.pbr('cardboard', 'cardboard');
    this.pbr('pipe', 'metalCabinet', { color: 0x9a9a92 });
    this.pbr('darkPipe', 'rust', { color: 0x777777 });
    this.pbr('bareConcrete', 'concrete');

    const L = this.lib;
    L.rubber = new THREE.MeshStandardMaterial({ color: 0x151514, roughness: 0.85, metalness: 0 });
    L.baseboard = new THREE.MeshStandardMaterial({ color: 0x1d1f1c, roughness: 0.6, metalness: 0 });
    L.blackPlastic = new THREE.MeshStandardMaterial({ color: 0x1a1a19, roughness: 0.45, metalness: 0 });
    L.beigePlastic = new THREE.MeshStandardMaterial({ color: 0xa69f88, roughness: 0.55, metalness: 0 });
    L.chrome = new THREE.MeshStandardMaterial({ color: 0xcfd2d4, roughness: 0.18, metalness: 1, envMapIntensity: 1.2 });
    L.brass = new THREE.MeshStandardMaterial({ color: 0x8a6a34, roughness: 0.35, metalness: 1 });
    L.ceramic = new THREE.MeshPhysicalMaterial({ color: 0xe1ddd2, roughness: 0.12, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.1, envMapIntensity: 0.9 });
    L.porcelainDirty = new THREE.MeshPhysicalMaterial({ map: this.tex.tiles.map, color: 0xdedbd0, roughness: 0.2, clearcoat: 0.5, envMapIntensity: 0.9 });
    L.void = new THREE.MeshBasicMaterial({ color: 0x000000 });
    L.leather = new THREE.MeshStandardMaterial({ color: 0x3b2618, roughness: 0.55, metalness: 0 });
    L.paperProp = new THREE.MeshStandardMaterial({ color: 0xcfc6ae, roughness: 0.9, side: THREE.DoubleSide });
    L.binder = new THREE.MeshStandardMaterial({ color: 0x2d3a4c, roughness: 0.6 });
    L.binderRed = new THREE.MeshStandardMaterial({ color: 0x5c1f1a, roughness: 0.6 });
    L.binderGreen = new THREE.MeshStandardMaterial({ color: 0x2f4a33, roughness: 0.6 });
    L.soil = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 1 });
    L.deadPlant = new THREE.MeshStandardMaterial({ color: 0x3d3324, roughness: 0.9 });
    L.terracotta = new THREE.MeshStandardMaterial({ color: 0x7b4a33, roughness: 0.8 });
    L.cork = new THREE.MeshStandardMaterial({ color: 0x8b6a45, roughness: 0.95 });
    L.cable = new THREE.MeshStandardMaterial({ color: 0x0e0e0e, roughness: 0.5 });
    L.copper = new THREE.MeshStandardMaterial({ color: 0xa0603a, roughness: 0.35, metalness: 1 });
    L.bodyBag = new THREE.MeshPhysicalMaterial({ color: 0x1b1f1c, roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.4 });
    L.ivBag = new THREE.MeshPhysicalMaterial({ color: 0xd8e0d0, roughness: 0.2, transmission: 0.0, transparent: true, opacity: 0.55, depthWrite: false });
    L.glass = new THREE.MeshPhysicalMaterial({ color: 0x9fb3ad, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, envMapIntensity: 1.5 });
    L.wireGlass = new THREE.MeshPhysicalMaterial({ color: 0x8aa39c, roughness: 0.15, transparent: true, opacity: 0.35, depthWrite: false, envMapIntensity: 1.2 });
    L.bottleGreen = new THREE.MeshPhysicalMaterial({ color: 0x2b4a26, roughness: 0.1, transparent: true, opacity: 0.8, envMapIntensity: 1.4 });
    L.bottleBrown = new THREE.MeshPhysicalMaterial({ color: 0x4a2a12, roughness: 0.1, transparent: true, opacity: 0.85, envMapIntensity: 1.4 });
    L.crtScreen = new THREE.MeshPhysicalMaterial({ color: 0x0c110e, roughness: 0.05, clearcoat: 1, envMapIntensity: 1.4, emissive: 0x001100, emissiveIntensity: 0 });
    L.meat = new THREE.MeshPhysicalMaterial({ color: 0x4a1210, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2 });
    L.corpseSkin = new THREE.MeshStandardMaterial({ map: this.tex.skin.map, normalMap: this.tex.skin.normalMap, color: 0xb7a99a, roughness: 0.55 });
    L.denim = new THREE.MeshStandardMaterial({ map: this.tex.fabric.map, color: 0x34405a, roughness: 0.9 });
    L.coat = new THREE.MeshStandardMaterial({ map: this.tex.fabric.map, color: 0x6d6250, roughness: 0.9, side: THREE.DoubleSide });
    L.labcoat = new THREE.MeshStandardMaterial({ map: this.tex.fabric.map, color: 0xe0dccc, roughness: 0.9, side: THREE.DoubleSide });

    // monster
    L.monsterSkin = new THREE.MeshPhysicalMaterial({
      map: this.tex.skin.map, normalMap: this.tex.skin.normalMap, roughnessMap: this.tex.skin.orm,
      roughness: 1, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.45, sheen: 0.3, sheenColor: new THREE.Color(0x553333),
      color: 0xa39a90,
    });
    L.monsterSkin.normalScale.set(1.6, 1.6);
    L.teeth = new THREE.MeshPhysicalMaterial({ color: 0xcfc4a2, roughness: 0.25, clearcoat: 0.9, clearcoatRoughness: 0.15 });
    L.gums = new THREE.MeshPhysicalMaterial({ color: 0x3a0909, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 });
    L.nail = new THREE.MeshPhysicalMaterial({ color: 0x2b2620, roughness: 0.3, clearcoat: 0.7 });

    // water
    L.water = new THREE.MeshPhysicalMaterial({
      color: 0x0a0c0a, roughness: 0.04, metalness: 0.1, normalMap: makeRippleNormal(), envMapIntensity: 1.6,
      transparent: true, opacity: 0.92,
    });
    L.water.normalMap.wrapS = L.water.normalMap.wrapT = THREE.RepeatWrapping;
    L.water.normalScale.set(0.35, 0.35);
    L.murk = L.water.clone(); L.murk.color.set(0x14120c); L.murk.opacity = 0.97;

    // emissives (templates, cloned per fixture)
    L.tube = new THREE.MeshStandardMaterial({ color: 0xe9f0ec, emissive: 0xdff2ff, emissiveIntensity: 2.2, roughness: 0.3 });
    L.tubeOff = new THREE.MeshStandardMaterial({ color: 0x8f938f, roughness: 0.3 });
    L.emergency = new THREE.MeshStandardMaterial({ color: 0x501010, emissive: 0xff2a10, emissiveIntensity: 2.0, roughness: 0.3 });
    L.amber = new THREE.MeshStandardMaterial({ color: 0x503010, emissive: 0xffa040, emissiveIntensity: 2.0, roughness: 0.3 });
    L.ledRed = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1a0a, emissiveIntensity: 3 });
    L.ledGreen = new THREE.MeshStandardMaterial({ color: 0x003000, emissive: 0x30ff40, emissiveIntensity: 3 });
    L.ledOff = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.4 });
    L.bulb = new THREE.MeshStandardMaterial({ color: 0xffe9c0, emissive: 0xffd9a0, emissiveIntensity: 3 });
  }

  decal(name, tex, opt = {}) {
    const m = new THREE.MeshStandardMaterial({
      map: tex, transparent: true, depthWrite: false, roughness: opt.roughness ?? 0.35, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.FrontSide,
      color: opt.color ?? 0xffffff, opacity: opt.opacity ?? 1,
    });
    this.lib[name] = m;
    return m;
  }
  get(n) { return this.lib[n]; }
}

function makeRippleNormal() {
  const s = 256;
  const data = new Uint8Array(s * s * 4);
  const waves = [];
  for (let i = 0; i < 18; i++) {
    const a = Math.random() * Math.PI * 2, f = 1 + Math.floor(Math.random() * 6);
    waves.push([Math.cos(a) * f, Math.sin(a) * f, Math.random() * 6.28, 1 / f]);
  }
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    let dx = 0, dy = 0;
    for (const [kx, ky, p, amp] of waves) {
      const kxi = Math.round(kx), kyi = Math.round(ky);
      const ph = (x / s) * kxi * 6.28 + (y / s) * kyi * 6.28 + p;
      const c = Math.cos(ph) * amp;
      dx += c * kxi; dy += c * kyi;
    }
    const nx = -dx * 0.08, ny = -dy * 0.08, l = 1 / Math.hypot(nx, ny, 1);
    const i = (y * s + x) * 4;
    data[i] = (nx * l * 0.5 + 0.5) * 255; data[i + 1] = (ny * l * 0.5 + 0.5) * 255; data[i + 2] = (l * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, s, s);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
