import * as THREE from 'three';

const CACHE_VERSION = 3;

// ---------------- IndexedDB cache ----------------
function openDB() {
  return new Promise((res) => {
    try {
      const r = indexedDB.open('pressure-census-tex', CACHE_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        for (const n of [...db.objectStoreNames]) db.deleteObjectStore(n);
        db.createObjectStore('tex');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
      r.onblocked = () => res(null);
    } catch { res(null); }
  });
}
function idbGet(db, key) {
  return new Promise((res) => {
    if (!db) return res(null);
    try {
      const q = db.transaction('tex').objectStore('tex').get(key);
      q.onsuccess = () => res(q.result || null); q.onerror = () => res(null);
    } catch { res(null); }
  });
}
function idbPut(db, key, val) {
  if (new URLSearchParams(location.search).has('nocache')) return;
  if (!db) return;
  try { db.transaction('tex', 'readwrite').objectStore('tex').put(val, key); } catch { /* ignore */ }
}

// ---------------- job list ----------------
export function textureJobs(quality) {
  const hi = quality === 'high' || quality === 'ultra' ? 1024 : 512;
  const lo = quality === 'ultra' ? 1024 : 512;
  return [
    ['paint', 'wallPaint', hi, 11, {}],
    ['paintWard', 'wallPaint', hi, 12, { lower: 0x5b716c, upper: 0xbdb59c, rail: 0x2e3b36 }],
    ['paintLobby', 'wallPaint', hi, 13, { lower: 0x6a5646, upper: 0xb3a88e, rail: 0x3a2a20 }],
    ['tiles', 'tilesWall', hi, 14, {}],
    ['tilesMorgue', 'tilesWall', hi, 15, { base: 0xc6cbc6, accent: 0x31404d, accentRows: [6, 7] }],
    ['floorTiles', 'floorTiles', hi, 16, {}],
    ['floorTilesMorgue', 'floorTiles', hi, 17, { a: 0xb4b9b4, b: 0x3a4246 }],
    ['linoleum', 'linoleum', hi, 18, {}],
    ['concrete', 'concrete', hi, 19, {}],
    ['concreteWall', 'concrete', hi, 20, { base: 0x6c6a63, streak: 1.6, wet: 0.8 }],
    ['concreteCeil', 'concrete', lo, 21, { base: 0x55534d, streak: 0.4 }],
    ['cinder', 'cinder', hi, 22, {}],
    ['cinderRecords', 'cinder', hi, 23, { paint: 0x8b8572 }],
    ['ceiling', 'ceiling', hi, 24, {}],
    ['skin', 'skin', hi, 25, {}],
    ['metalLocker', 'metalPaint', lo, 31, { paint: 0x4f5f5a }],
    ['metalDoor', 'metalPaint', lo, 32, { paint: 0x4c5a4d, wear: 0.4 }],
    ['metalCabinet', 'metalPaint', lo, 33, { paint: 0x8a867a }],
    ['metalGen', 'metalPaint', lo, 34, { paint: 0x3b4836, wear: 0.6 }],
    ['metalElev', 'metalPaint', lo, 35, { paint: 0x5c6062, wear: 0.8 }],
    ['metalRed', 'metalPaint', lo, 36, { paint: 0x7a2620 }],
    ['metalYellow', 'metalPaint', lo, 37, { paint: 0x9c7a1e, wear: 0.5 }],
    ['metalWhite', 'metalPaint', lo, 38, { paint: 0xb5b2a6, rust: 0.6 }],
    ['steelFloor', 'metalPaint', lo, 39, { paint: 0x4a4d4f, wear: 1.2 }],
    ['stainless', 'stainless', lo, 41, {}],
    ['wood', 'wood', lo, 42, {}],
    ['fabric', 'fabric', lo, 43, {}],
    ['fabricCurtain', 'fabric', lo, 44, { base: 0x8a9e90, blood: 0.25 }],
    ['fabricMattress', 'fabric', lo, 45, { base: 0xc6c1ae, stripe: 0x5a6f86, blood: 0.8 }],
    ['fabricGown', 'fabric', lo, 46, { base: 0x9fb0b4, blood: 1.0 }],
    ['rust', 'rust', lo, 47, {}],
    ['cardboard', 'cardboard', lo, 48, {}],
  ];
}

function makeDataTex(data, size, srgb, aniso) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

export async function generateAll(quality, renderer, onProgress) {
  const jobs = textureJobs(quality);
  const aniso = Math.min(renderer.capabilities.getMaxAnisotropy(), quality === 'low' ? 2 : 8);
  const db = await openDB();
  const out = {};
  let done = 0;
  const finish = (name, r) => {
    out[name] = {
      map: makeDataTex(r.albedo, r.size, true, aniso),
      normalMap: makeDataTex(r.normal, r.size, false, aniso),
      orm: makeDataTex(r.orm, r.size, false, aniso),
    };
    done++;
    onProgress?.(done / jobs.length, name);
  };

  const pending = [];
  for (const [name, recipe, size, seed, opt] of jobs) {
    const key = `${recipe}|${size}|${seed}|${JSON.stringify(opt)}`;
    const cached = await idbGet(db, key);
    if (cached && cached.albedo) {
      finish(name, {
        size: cached.size,
        albedo: new Uint8Array(cached.albedo), normal: new Uint8Array(cached.normal), orm: new Uint8Array(cached.orm),
      });
    } else pending.push({ name, recipe, size, seed, opt, key });
  }
  if (!pending.length) return out;

  const nWorkers = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1, pending.length));
  // biggest first for better packing
  pending.sort((a, b) => b.size - a.size);
  await new Promise((resolve, reject) => {
    let next = 0, active = 0;
    const workers = [];
    const launch = (w) => {
      if (next >= pending.length) { w.terminate(); if (--active === 0) resolve(); return; }
      const job = pending[next];
      w._job = job;
      w.postMessage({ id: next++, recipe: job.recipe, size: job.size, seed: job.seed, opt: job.opt });
    };
    for (let i = 0; i < nWorkers; i++) {
      const w = new Worker(new URL('./texworker.js', import.meta.url), { type: 'module' });
      workers.push(w); active++;
      w.onmessage = (e) => {
        const r = e.data, job = w._job;
        const albedo = new Uint8Array(r.albedo.buffer), normal = new Uint8Array(r.normal.buffer), orm = new Uint8Array(r.orm.buffer);
        idbPut(db, job.key, { size: r.size, albedo: albedo.slice().buffer, normal: normal.slice().buffer, orm: orm.slice().buffer });
        finish(job.name, { size: r.size, albedo, normal, orm });
        launch(w);
      };
      w.onerror = (e) => reject(e);
      launch(w);
    }
  });
  return out;
}

// ---------------- canvas-drawn textures ----------------
function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function canvasTex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function smoothstepJS(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

function bloodColor(r, a = 1) {
  const d = 0.55 + r * 0.45;
  return `rgba(${(70 * d) | 0},${(8 * d) | 0},${(6 * d) | 0},${a})`;
}

export function makeDecals() {
  const D = {};
  // blood splatter
  {
    const [c, g] = canvas(512); const R = rng(7);
    for (let i = 0; i < 1; i++) {
      g.fillStyle = bloodColor(0.6, 0.95);
      g.beginPath(); g.ellipse(256, 256, 70, 58, 0.3, 0, 7); g.fill();
      for (let k = 0; k < 140; k++) {
        const a = R() * 6.28, d = 60 + Math.pow(R(), 1.6) * 190, r = (1 - d / 260) * 12 * R() + 1;
        g.fillStyle = bloodColor(R(), 0.8 + R() * 0.2);
        g.beginPath(); g.arc(256 + Math.cos(a) * d, 256 + Math.sin(a) * d, r, 0, 7); g.fill();
        if (R() > 0.6) { // tail
          g.strokeStyle = bloodColor(R(), 0.7); g.lineWidth = r * 0.7; g.lineCap = 'round';
          g.beginPath(); g.moveTo(256 + Math.cos(a) * (d - 20), 256 + Math.sin(a) * (d - 20)); g.lineTo(256 + Math.cos(a) * d, 256 + Math.sin(a) * d); g.stroke();
        }
      }
    }
    D.splatter = canvasTex(c);
  }
  // smear (drag mark)
  {
    const [c, g] = canvas(512, 256); const R = rng(11);
    for (let s = 0; s < 26; s++) {
      g.strokeStyle = bloodColor(R(), 0.08 + R() * 0.15);
      g.lineWidth = 6 + R() * 22; g.lineCap = 'round';
      g.beginPath();
      let y = 128 + (R() - 0.5) * 80;
      g.moveTo(20 + R() * 40, y);
      for (let x = 60; x < 500; x += 40) { y += (R() - 0.5) * 14; g.lineTo(x, y + Math.sin(x * 0.02) * 6); }
      g.stroke();
    }
    D.smear = canvasTex(c);
  }
  // handprint
  {
    const [c, g] = canvas(256); const R = rng(5);
    const hand = (ox, oy, rot, a) => {
      g.save(); g.translate(ox, oy); g.rotate(rot);
      g.fillStyle = bloodColor(0.5, a);
      g.beginPath(); g.ellipse(0, 20, 34, 40, 0, 0, 7); g.fill();
      const fingers = [[-30, -30, -0.35, 44], [-11, -48, -0.1, 56], [8, -50, 0.05, 58], [26, -40, 0.22, 50], [42, 8, 0.9, 38]];
      for (const [fx, fy, fr, fl] of fingers) {
        g.save(); g.translate(fx, fy); g.rotate(fr);
        g.beginPath(); g.ellipse(0, 0, 8.5, fl / 2, 0, 0, 7); g.fill();
        g.restore();
      }
      g.restore();
      // smudge streaks going down
      for (let k = 0; k < 8; k++) {
        g.strokeStyle = bloodColor(R(), 0.25 * a); g.lineWidth = 3 + R() * 6;
        const sx = ox - 30 + R() * 60;
        g.beginPath(); g.moveTo(sx, oy + 30); g.lineTo(sx + (R() - 0.5) * 8, oy + 60 + R() * 70); g.stroke();
      }
    };
    hand(128, 120, -0.15, 0.9);
    // erode with noise
    g.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(0,0,0,${R() * 0.6})`; g.fillRect(R() * 256, R() * 256, 2 + R() * 3, 2 + R() * 3); }
    D.hand = canvasTex(c);
  }
  // drips running down
  {
    const [c, g] = canvas(256, 512); const R = rng(17);
    for (let k = 0; k < 12; k++) {
      const x = 20 + R() * 216, len = 80 + R() * 400, w = 2 + R() * 6;
      const grd = g.createLinearGradient(0, 0, 0, len);
      grd.addColorStop(0, bloodColor(R(), 0.9)); grd.addColorStop(1, bloodColor(R(), 0.5));
      g.fillStyle = grd;
      g.fillRect(x - w / 2, 0, w, len);
      g.beginPath(); g.arc(x, len, w * 0.9, 0, 7); g.fill();
    }
    g.fillStyle = bloodColor(0.7, 0.9); g.fillRect(0, 0, 256, 18);
    D.drip = canvasTex(c);
  }
  // scratched tally marks (the creature's count)
  {
    const [c, g] = canvas(1024, 512); const R = rng(23);
    g.lineCap = 'round';
    let gx = 40, gy = 70;
    for (let grp = 0; grp < 28; grp++) {
      for (let i = 0; i < 5; i++) {
        const scratch = (x0, y0, x1, y1) => {
          for (let p = 0; p < 3; p++) {
            g.strokeStyle = p === 0 ? 'rgba(18,10,8,0.9)' : `rgba(${60 + R() * 30},${12},${8},${0.5})`;
            g.lineWidth = p === 0 ? 4.5 : 1.5;
            g.beginPath();
            g.moveTo(x0 + (R() - 0.5) * 3, y0 + (R() - 0.5) * 3);
            g.quadraticCurveTo((x0 + x1) / 2 + (R() - 0.5) * 6, (y0 + y1) / 2, x1 + (R() - 0.5) * 3, y1 + (R() - 0.5) * 3);
            g.stroke();
          }
        };
        if (i < 4) scratch(gx + i * 14, gy, gx + i * 14 + (R() - 0.5) * 6, gy + 80 + (R() - 0.5) * 10);
        else scratch(gx - 8, gy + 70, gx + 52, gy + 10);
      }
      gx += 90 + R() * 20;
      if (gx > 960) { gx = 30 + R() * 30; gy += 120; }
      if (gy > 440) break;
    }
    D.tally = canvasTex(c);
  }
  // wet footprints
  {
    const [c, g] = canvas(256, 512);
    g.fillStyle = 'rgba(20,16,12,0.55)';
    const foot = (x, y, flip) => {
      g.save(); g.translate(x, y); g.scale(flip ? -1 : 1, 1);
      g.beginPath(); g.ellipse(0, 0, 18, 34, 0.08, 0, 7); g.fill();
      g.beginPath(); g.ellipse(2, 54, 14, 18, 0, 0, 7); g.fill();
      for (let t = 0; t < 5; t++) { g.beginPath(); g.arc(-14 + t * 7, -38 - Math.sin(t * 0.7) * 6, 5 - t * 0.5, 0, 7); g.fill(); }
      g.restore();
    };
    foot(90, 100, false); foot(170, 260, true); foot(90, 420, false);
    D.footprints = canvasTex(c);
  }
  // water stain puddle
  {
    const [c, g] = canvas(512); const R = rng(31);
    for (let k = 0; k < 40; k++) {
      const x = 256 + (R() - 0.5) * 200, y = 256 + (R() - 0.5) * 200, r = 40 + R() * 100;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(10,9,7,0.12)'); grd.addColorStop(0.8, 'rgba(10,9,7,0.08)'); grd.addColorStop(1, 'rgba(10,9,7,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    D.puddle = canvasTex(c);
  }
  return D;
}

export function makeGraffiti(text, w = 1024, h = 256, opt = {}) {
  const [c, g] = canvas(w, h); const R = rng(text.length * 77 + 3);
  const size = opt.size ?? h * 0.55;
  g.font = `${size}px 'Special Elite', 'Courier New', serif`;
  g.textBaseline = 'middle';
  let x = opt.x ?? 30;
  for (const ch of text) {
    g.save();
    g.translate(x, h * 0.5 + (R() - 0.5) * size * 0.12);
    g.rotate((R() - 0.5) * 0.18);
    g.fillStyle = opt.color ?? bloodColor(R(), 0.88);
    g.fillText(ch, 0, 0);
    // drip
    if (R() > 0.55 && ch !== ' ') {
      const dx = size * 0.2 + R() * size * 0.2, len = 20 + R() * h * 0.4;
      g.fillRect(dx, size * 0.25, 3 + R() * 3, len);
    }
    g.restore();
    x += g.measureText(ch).width * (0.92 + R() * 0.12);
  }
  return canvasTex(c);
}

export function makeSign(lines, w = 512, h = 160, opt = {}) {
  const [c, g] = canvas(w, h); const R = rng(lines.join('').length * 13);
  g.fillStyle = opt.bg ?? '#d9d3c0'; g.fillRect(0, 0, w, h);
  g.strokeStyle = opt.fg ?? '#1f2a28'; g.lineWidth = 6; g.strokeRect(10, 10, w - 20, h - 20);
  g.fillStyle = opt.fg ?? '#1f2a28'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const n = lines.length;
  lines.forEach((l, i) => {
    const big = i === 0;
    g.font = `${big ? 600 : 400} ${big ? h * 0.3 / Math.max(1, n * 0.7) : h * 0.14}px 'IBM Plex Mono', monospace`;
    g.fillText(l, w / 2, h * (n === 1 ? 0.5 : 0.36 + (i * 0.5) / n));
  });
  // age: dirt, scratches, rust spots
  for (let k = 0; k < 300; k++) { g.fillStyle = `rgba(60,45,25,${R() * 0.12})`; g.beginPath(); g.arc(R() * w, R() * h, R() * 18, 0, 7); g.fill(); }
  for (let k = 0; k < 30; k++) { g.strokeStyle = `rgba(255,255,255,${R() * 0.2})`; g.lineWidth = 1; g.beginPath(); const x = R() * w, y = R() * h; g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 60, y + (R() - 0.5) * 20); g.stroke(); }
  const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(70,40,10,0.35)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  return canvasTex(c);
}

// flashlight cookie: hot core, falloff, ring artifacts from the reflector, dust/scratches on the lens
export function makeFlashlightCookie() {
  const [c, g] = canvas(512); const R = rng(91);
  const img = g.createImageData(512, 512);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const dx = (x - 256) / 256, dy = (y - 256) / 256;
    const r = Math.sqrt(dx * dx + dy * dy);
    let v = Math.pow(Math.max(0, 1 - r), 0.6) * 0.55;
    v += Math.exp(-r * r * 28) * 0.7;                          // hotspot
    v += 0.12 * Math.exp(-Math.pow((r - 0.42) / 0.035, 2));     // reflector ring
    v += 0.08 * Math.exp(-Math.pow((r - 0.68) / 0.05, 2));
    v -= 0.06 * Math.exp(-Math.pow((r - 0.2) / 0.03, 2));       // dark ring
    v *= 1 - smoothstepJS(0.5, 1.0, r);
    v += 0.04 * (1 - smoothstepJS(0.6, 1.0, r));
    const i = (y * 512 + x) * 4;
    const cv = Math.max(0, Math.min(1, v));
    img.data[i] = cv * 255; img.data[i + 1] = cv * 248; img.data[i + 2] = cv * 228; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // lens grime
  for (let k = 0; k < 70; k++) {
    g.fillStyle = `rgba(0,0,0,${0.05 + R() * 0.12})`;
    g.beginPath(); g.arc(80 + R() * 352, 80 + R() * 352, 2 + R() * 14, 0, 7); g.fill();
  }
  g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2;
  for (let k = 0; k < 6; k++) { g.beginPath(); const x = 120 + R() * 270, y = 120 + R() * 270; g.moveTo(x, y); g.lineTo(x + (R() - .5) * 140, y + (R() - .5) * 140); g.stroke(); }
  const t = canvasTex(c, false); // linear: mid-beam values must not be crushed by sRGB decoding
  return t;
}

export function makeGauge(label = 'PSI') {
  const [c, g] = canvas(256);
  g.fillStyle = '#d8d2bf'; g.beginPath(); g.arc(128, 128, 120, 0, 7); g.fill();
  g.strokeStyle = '#222'; g.lineWidth = 3;
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * (0.75 + i * 0.15);
    g.beginPath(); g.moveTo(128 + Math.cos(a) * 95, 128 + Math.sin(a) * 95); g.lineTo(128 + Math.cos(a) * 110, 128 + Math.sin(a) * 110); g.stroke();
  }
  g.strokeStyle = '#8a1a14'; g.lineWidth = 8; g.beginPath(); g.arc(128, 128, 103, Math.PI * 2.0, Math.PI * 2.25); g.stroke();
  g.fillStyle = '#222'; g.font = '600 26px IBM Plex Mono, monospace'; g.textAlign = 'center'; g.fillText(label, 128, 190);
  const grd = g.createRadialGradient(100, 90, 10, 128, 128, 130); grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(1, 'rgba(80,60,30,0.45)');
  g.fillStyle = grd; g.beginPath(); g.arc(128, 128, 120, 0, 7); g.fill();
  return canvasTex(c);
}

export function makeClockFace() {
  const [c, g] = canvas(256);
  g.fillStyle = '#e2dccb'; g.beginPath(); g.arc(128, 128, 124, 0, 7); g.fill();
  g.fillStyle = '#111'; g.font = '600 26px IBM Plex Mono'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 1; i <= 12; i++) { const a = i / 12 * Math.PI * 2 - Math.PI / 2; g.fillText(String(i), 128 + Math.cos(a) * 96, 128 + Math.sin(a) * 96); }
  // stopped at 3:17
  const hand = (a, l, w) => { g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.cos(a) * l, 128 + Math.sin(a) * l); g.stroke(); };
  g.strokeStyle = '#111';
  hand((3 + 17 / 60) / 12 * Math.PI * 2 - Math.PI / 2, 55, 7);
  hand(17 / 60 * Math.PI * 2 - Math.PI / 2, 85, 4);
  const grd = g.createRadialGradient(128, 128, 30, 128, 128, 128); grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(90,60,20,0.5)');
  g.fillStyle = grd; g.beginPath(); g.arc(128, 128, 124, 0, 7); g.fill();
  return canvasTex(c);
}

export function makePaper(kind = 'lines') {
  const [c, g] = canvas(256, 340); const R = rng(kind.length * 31 + 7);
  g.fillStyle = '#d6cdb4'; g.fillRect(0, 0, 256, 340);
  g.strokeStyle = 'rgba(70,80,120,0.35)'; g.lineWidth = 1;
  for (let y = 40; y < 330; y += 14) { g.beginPath(); g.moveTo(16, y); g.lineTo(240, y); g.stroke(); }
  g.strokeStyle = 'rgba(40,35,30,0.7)'; g.lineWidth = 1.4;
  for (let y = 44; y < 320; y += 14) {
    let x = 22; const end = 120 + R() * 110;
    g.beginPath(); g.moveTo(x, y);
    while (x < end) { x += 3 + R() * 5; g.lineTo(x, y - 3 + R() * 4); }
    g.stroke();
  }
  if (kind === 'census') {
    g.fillStyle = 'rgba(30,30,30,0.85)'; g.font = '600 15px IBM Plex Mono'; g.fillText('CENSUS FORM 13-B', 20, 26);
  }
  for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(110,80,30,${R() * 0.12})`; g.beginPath(); g.arc(R() * 256, R() * 340, R() * 40, 0, 7); g.fill(); }
  return canvasTex(c);
}

export function makeChildDrawing() {
  const [c, g] = canvas(256, 340);
  g.fillStyle = '#e4dccb'; g.fillRect(0, 0, 256, 340);
  g.lineCap = 'round'; g.lineJoin = 'round';
  // crayon stick figures in a row, and one tall one
  g.strokeStyle = '#2b3b8a'; g.lineWidth = 4;
  for (let i = 0; i < 5; i++) {
    const x = 30 + i * 36, y = 250;
    g.beginPath(); g.arc(x, y - 50, 10, 0, 7); g.moveTo(x, y - 40); g.lineTo(x, y - 10); g.moveTo(x - 12, y - 30); g.lineTo(x + 12, y - 30);
    g.moveTo(x, y - 10); g.lineTo(x - 9, y + 10); g.moveTo(x, y - 10); g.lineTo(x + 9, y + 10); g.stroke();
  }
  g.strokeStyle = '#111'; g.lineWidth = 6;
  const x = 215;
  g.beginPath(); g.ellipse(x, 70, 12, 22, 0, 0, 7); g.moveTo(x, 92); g.lineTo(x, 200);
  g.moveTo(x, 110); g.lineTo(x - 40, 230); g.moveTo(x, 110); g.lineTo(x + 18, 240);
  g.moveTo(x, 200); g.lineTo(x - 14, 300); g.moveTo(x, 200); g.lineTo(x + 14, 300); g.stroke();
  g.fillStyle = '#8a1010'; g.font = '28px Special Elite, cursive'; g.fillText('1 2 3 4 5   6?', 14, 40);
  g.fillStyle = 'rgba(120,80,20,0.15)'; g.fillRect(0, 0, 256, 340);
  return canvasTex(c);
}

export function makeLabel(text, w = 256, h = 64, bg = '#d7d0bc', fg = '#151515') {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.font = `600 ${h * 0.5}px IBM Plex Mono, monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2);
  g.fillStyle = 'rgba(80,50,20,0.25)'; g.fillRect(0, h * 0.7, w, h * 0.3);
  return canvasTex(c);
}
