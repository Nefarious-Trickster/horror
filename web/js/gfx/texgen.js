// Procedural PBR texture synthesis. Pure JS (no DOM) so it can run inside workers.
// Every recipe returns tileable albedo (sRGB), tangent-space normal, and ORM
// (R = ambient occlusion, G = roughness, B = metalness) maps.
// Coordinate convention: pixel row y=0 is v=0 (bottom), matching DataTexture with flipY=false.

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const fract = (x) => x - Math.floor(x);

// ---------- tileable gradient noise ----------
function makeNoise(seed) {
  const rnd = mulberry(seed);
  const perm = new Uint16Array(512);
  const p = new Uint16Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const gx = new Float32Array(256), gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const a = rnd() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }

  // periodic perlin noise, period px/py in lattice units
  function noise(x, y, px, py) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py;
    const x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
    const h00 = perm[perm[x0 & 255] + (y0 & 255)];
    const h10 = perm[perm[x1 & 255] + (y0 & 255)];
    const h01 = perm[perm[x0 & 255] + (y1 & 255)];
    const h11 = perm[perm[x1 & 255] + (y1 & 255)];
    const d00 = gx[h00] * xf + gy[h00] * yf;
    const d10 = gx[h10] * (xf - 1) + gy[h10] * yf;
    const d01 = gx[h01] * xf + gy[h01] * (yf - 1);
    const d11 = gx[h11] * (xf - 1) + gy[h11] * (yf - 1);
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    return 1.41 * mix(mix(d00, d10, u), mix(d01, d11, u), v);
  }
  // fbm over [0,1)^2, integer base frequencies keep it tileable
  function fbm(u, v, fx, fy = fx, oct = 5, gain = 0.5) {
    let s = 0, a = 0.5, n = 0;
    for (let o = 0; o < oct; o++) {
      s += a * noise(u * fx, v * fy, fx, fy);
      n += a; a *= gain; fx *= 2; fy *= 2;
    }
    return s / n;
  }
  function ridged(u, v, f, oct = 4) {
    let s = 0, a = 0.5, n = 0;
    for (let o = 0; o < oct; o++) {
      s += a * (1 - Math.abs(noise(u * f, v * f, f, f)));
      n += a; a *= 0.5; f *= 2;
    }
    return s / n;
  }
  // tileable worley: returns [F1, F2, cellHash]
  const wout = [0, 0, 0];
  function worley(u, v, n, s = 1) {
    const x = u * n, y = v * n;
    const xi = Math.floor(x), yi = Math.floor(y);
    let f1 = 9, f2 = 9, id = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = xi + i, cy = yi + j;
      const wx = ((cx % n) + n) % n, wy = ((cy % n) + n) % n;
      const px = cx + hash2(wx, wy, s), py = cy + hash2(wx, wy, s + 17);
      const dx = px - x, dy = py - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) { f2 = f1; f1 = d; id = hash2(wx, wy, s + 31); } else if (d < f2) f2 = d;
    }
    wout[0] = f1; wout[1] = f2; wout[2] = id;
    return wout;
  }
  return { noise, fbm, ridged, worley };
}

// ---------- surface buffer ----------
class Surface {
  constructor(size) {
    this.size = size;
    const n = size * size;
    this.r = new Float32Array(n); this.g = new Float32Array(n); this.b = new Float32Array(n);
    this.h = new Float32Array(n).fill(0.5);
    this.rough = new Float32Array(n).fill(0.8);
    this.metal = new Float32Array(n);
    this.ao = new Float32Array(n).fill(1);
  }
  each(fn) {
    const s = this.size;
    for (let y = 0; y < s; y++) {
      const v = (y + 0.5) / s;
      for (let x = 0; x < s; x++) fn((x + 0.5) / s, v, y * s + x, x, y);
    }
  }
  set(i, c) { this.r[i] = c[0]; this.g[i] = c[1]; this.b[i] = c[2]; }
  pack(normalStrength = 2, cavity = 0.6) {
    const s = this.size, n = s * s, H = this.h;
    // cavity AO from blurred height
    const blur = boxBlur(boxBlur(H, s, Math.max(2, s >> 7)), s, Math.max(2, s >> 7));
    const albedo = new Uint8ClampedArray(n * 4);
    const normal = new Uint8ClampedArray(n * 4);
    const orm = new Uint8ClampedArray(n * 4);
    const k = normalStrength * s / 512;
    for (let y = 0; y < s; y++) {
      const yu = ((y + 1) % s) * s, yd = ((y - 1 + s) % s) * s, yr = y * s;
      for (let x = 0; x < s; x++) {
        const i = yr + x;
        const xr = (x + 1) % s, xl = (x - 1 + s) % s;
        const dx = (H[yr + xr] - H[yr + xl]) * k;
        const dy = (H[yu + x] - H[yd + x]) * k;
        let nx = -dx, ny = -dy, nz = 1;
        const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx *= l; ny *= l; nz *= l;
        const occ = clamp(1 - Math.max(0, blur[i] - H[i]) * 6 * cavity) * this.ao[i];
        const o4 = i * 4;
        albedo[o4] = clamp(this.r[i] * (0.55 + 0.45 * occ)) * 255;
        albedo[o4 + 1] = clamp(this.g[i] * (0.55 + 0.45 * occ)) * 255;
        albedo[o4 + 2] = clamp(this.b[i] * (0.55 + 0.45 * occ)) * 255;
        albedo[o4 + 3] = 255;
        normal[o4] = (nx * 0.5 + 0.5) * 255;
        normal[o4 + 1] = (ny * 0.5 + 0.5) * 255;
        normal[o4 + 2] = (nz * 0.5 + 0.5) * 255;
        normal[o4 + 3] = 255;
        orm[o4] = occ * 255;
        orm[o4 + 1] = clamp(this.rough[i], 0.02, 1) * 255;
        orm[o4 + 2] = clamp(this.metal[i]) * 255;
        orm[o4 + 3] = 255;
      }
    }
    return { size: s, albedo, normal, orm };
  }
}

function boxBlur(src, s, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const w = 2 * r + 1;
  for (let y = 0; y < s; y++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[y * s + ((k + s) % s)];
    for (let x = 0; x < s; x++) {
      tmp[y * s + x] = acc / w;
      acc += src[y * s + ((x + r + 1) % s)] - src[y * s + ((x - r + s) % s)];
    }
  }
  for (let x = 0; x < s; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[((k + s) % s) * s + x];
    for (let y = 0; y < s; y++) {
      out[y * s + x] = acc / w;
      acc += tmp[((y + r + 1) % s) * s + x] - tmp[((y - r + s) % s) * s + x];
    }
  }
  return out;
}

const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const lerp3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

// common weathering layer: water streaks running down from the top, grime gathering low
function weather(N, u, v, c, o) {
  const streakN = N.fbm(u, v, 48, 2, 4);
  const streakMask = smooth(0.0, 0.35, N.fbm(u + 0.37, 0.5, 5, 1, 3) + 0.1);
  const streak = smooth(0.05, 0.45, streakN) * streakMask * (0.35 + 0.65 * v) * (o.streak ?? 1);
  c = lerp3(c, mul3(lerp3(c, hex(0x6b5233), 0.65), 0.8), streak * 0.75);
  const low = 1 - smooth(0.0, o.lowBand ?? 0.12, v);
  const grime = clamp(0.5 + N.fbm(u, v, 6, 6, 5) * 0.9);
  c = mul3(c, 1 - (0.12 * grime + low * 0.45 * grime) * (o.grime ?? 1));
  return { c, streak, low, grime };
}

// =============== recipes ===============
const recipes = {
  // Institutional two-tone painted plaster. 1 tile = 3m x 3m (v covers full wall height).
  wallPaint(S, N, opt) {
    const lower = hex(opt.lower ?? 0x55695c), upper = hex(opt.upper ?? 0xb8b199), rail = hex(opt.rail ?? 0x3b3a2c);
    const plaster = hex(0x9d978a);
    S.each((u, v, i) => {
      const fine = N.fbm(u, v, 96, 96, 3);
      let c = v < 0.36 ? lower : upper;
      let h = 0.6 + fine * 0.01;
      let r = 0.55 + fine * 0.1;
      const railT = smooth(0.355, 0.36, v) * (1 - smooth(0.385, 0.39, v));
      if (railT > 0) { c = lerp3(c, rail, railT); h += railT * 0.08; r = mix(r, 0.35, railT); }
      // peeling paint
      const pn = N.fbm(u, v, 5, 5, 6) + 0.25 * N.fbm(u, v, 40, 40, 3) + (v < 0.4 ? 0.06 : 0) + (v > 0.85 ? 0.08 : 0);
      const peel = smooth(0.28, 0.31, pn);
      const edge = smooth(0.25, 0.28, pn) - peel;
      if (peel > 0) {
        const pl = mul3(plaster, 0.85 + 0.2 * N.fbm(u, v, 30, 30, 3));
        c = lerp3(c, pl, peel); h -= 0.12 * peel; r = mix(r, 0.92, peel);
      }
      c = lerp3(c, mul3(c, 1.12), edge * 0.8); h += edge * 0.05;
      // hairline cracks
      const cr = N.ridged(u, v, 3, 5);
      const crack = smooth(0.93, 0.975, cr) * smooth(0.0, 0.3, N.fbm(u, v, 4, 4, 2) + 0.1);
      c = mul3(c, 1 - crack * 0.6); h -= crack * 0.1;
      const w = weather(N, u, v, c, { lowBand: 0.14 });
      c = w.c; r = mix(r, 0.28, w.streak * 0.8);
      // mold creeping up from the floor
      const mold = smooth(0.55, 0.8, N.fbm(u, v, 24, 24, 5) * 0.7 + (0.28 - v) * 1.6 + 0.35);
      c = lerp3(c, hex(0x1d2418), mold * 0.85); r = mix(r, 0.95, mold); h += mold * 0.02;
      S.set(i, c); S.h[i] = h; S.rough[i] = r;
    });
    return S.pack(2.2);
  },

  // Glazed ceramic wall tiles, grout, cracked & missing tiles. 1 tile = 3m.
  tilesWall(S, N, opt) {
    const n = opt.n ?? 20;
    const base = hex(opt.base ?? 0xd9d6cb), accent = hex(opt.accent ?? 0x3f6b68);
    const accentRows = opt.accentRows ?? [7];
    const grout = hex(0x5a574e), adhesive = hex(0x8c887c);
    S.each((u, v, i) => {
      const fx = u * n, fy = v * n;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const lx = fx - ix, ly = fy - iy;
      const rnd = hash2(ix, iy, 3), rnd2 = hash2(ix, iy, 9);
      const d = Math.min(lx, 1 - lx, ly, 1 - ly);
      const g = 0.045;
      const tileMask = smooth(g, g + 0.03, d);
      let c = accentRows.includes(iy) ? accent : base;
      c = mul3(c, 0.93 + rnd * 0.1);
      let h = 0.45 + tileMask * 0.2 + tileMask * (0.02 * Math.sin(lx * 3.14) * Math.sin(ly * 3.14));
      let r = 0.1 + 0.08 * rnd2;
      // crazing on glaze
      const craze = smooth(0.965, 0.99, N.ridged(u, v, 40, 2));
      c = mul3(c, 1 - craze * 0.15 * tileMask);
      // missing tiles
      const missing = rnd2 > 0.975;
      if (missing) {
        const comb = 0.5 + 0.5 * Math.sin((u * n * 14 + N.fbm(u, v, 30, 30, 2) * 2) * 6.28);
        c = mul3(adhesive, 0.75 + 0.25 * comb); h = 0.3 + comb * 0.04; r = 0.95;
      } else {
        c = lerp3(grout, c, tileMask);
        r = mix(0.9, r, tileMask);
        // cracked tile
        if (rnd > 0.84) {
          const ang = rnd2 * 6.28, ca = Math.cos(ang), sa = Math.sin(ang);
          const dist = Math.abs((lx - 0.5) * ca + (ly - 0.5) * sa + N.noise(lx * 6 + ix, ly * 6, 256, 256) * 0.12);
          const crack = 1 - smooth(0.005, 0.02, dist);
          c = mul3(c, 1 - crack * 0.7); h -= crack * 0.12; r = mix(r, 0.8, crack);
        }
      }
      const w = weather(N, u, v, c, { lowBand: 0.1, streak: 1.3 });
      c = w.c; r = mix(r, 0.6, w.grime * 0.2 + w.low * 0.4);
      // rust bleed from fixtures
      const rust = smooth(0.62, 0.8, N.fbm(u, v, 7, 3, 5) + w.streak * 0.3);
      c = lerp3(c, hex(0x6e3a1c), rust * 0.55);
      S.set(i, c); S.h[i] = h; S.rough[i] = r;
    });
    return S.pack(2.5);
  },

  // Small mosaic floor tiles with standing water. 1 tile = 2m.
  floorTiles(S, N, opt) {
    const n = opt.n ?? 20;
    const a = hex(opt.a ?? 0xc7c4b8), b = hex(opt.b ?? 0x6f7774), grout = hex(0x3c3a35);
    S.each((u, v, i) => {
      const fx = u * n, fy = v * n, ix = Math.floor(fx), iy = Math.floor(fy);
      const lx = fx - ix, ly = fy - iy;
      const rnd = hash2(ix, iy, 5);
      const d = Math.min(lx, 1 - lx, ly, 1 - ly);
      const tm = smooth(0.05, 0.09, d);
      const pat = ((ix + iy) % 2 === 0) !== ((Math.floor(ix / 4) + Math.floor(iy / 4)) % 2 === 0);
      let c = mul3(pat ? b : a, 0.9 + rnd * 0.15);
      c = lerp3(grout, c, tm);
      let h = 0.4 + tm * 0.15;
      let r = mix(0.85, 0.3 + rnd * 0.15, tm);
      const dirt = clamp(0.5 + N.fbm(u, v, 5, 5, 6));
      c = mul3(c, 0.72 + 0.3 * (1 - dirt));
      c = lerp3(c, hex(0x3d3426), smooth(0.55, 0.9, dirt) * 0.6);
      // puddles
      const wet = smooth(0.12, 0.2, N.fbm(u + 0.3, v + 0.7, 3, 3, 5));
      c = mul3(c, 1 - wet * 0.35); r = mix(r, 0.04, wet); h = mix(h, 0.56, wet);
      S.set(i, c); S.h[i] = h; S.rough[i] = r;
    });
    return S.pack(2);
  },

  // Worn checker linoleum. 1 tile = 3m (10 x 30cm tiles)
  linoleum(S, N, opt) {
    const n = 10, a = hex(opt.a ?? 0x8b917f), b = hex(opt.b ?? 0xa89c80);
    S.each((u, v, i) => {
      const fx = u * n, fy = v * n, ix = Math.floor(fx), iy = Math.floor(fy);
      const lx = fx - ix, ly = fy - iy, rnd = hash2(ix, iy, 7);
      const d = Math.min(lx, 1 - lx, ly, 1 - ly);
      const seam = 1 - smooth(0.004, 0.012, d);
      let c = mul3((ix + iy) % 2 ? a : b, 0.92 + rnd * 0.1);
      // flecks
      const fl = N.noise(u * 900, v * 900, 900, 900);
      c = lerp3(c, fl > 0.55 ? hex(0x2a2a26) : (fl < -0.6 ? hex(0xe6e0d0) : c), 0.6);
      let r = 0.42 + 0.1 * N.fbm(u, v, 12, 12, 3);
      // scuff marks (heel streaks)
      const sc = N.fbm(u, v, 30, 4, 4);
      const scuff = smooth(0.32, 0.4, sc) * smooth(0.1, 0.4, N.fbm(u, v, 6, 6, 3));
      c = mul3(c, 1 - scuff * 0.55); r = mix(r, 0.7, scuff);
      const wear = clamp(0.5 + N.fbm(u, v, 4, 4, 5));
      c = lerp3(c, hex(0x4e4636), smooth(0.6, 1.0, wear) * 0.6);
      c = mul3(c, 1 - seam * 0.6);
      const wet = smooth(0.2, 0.26, N.fbm(u + 0.5, v, 2, 2, 5));
      r = mix(r, 0.05, wet); c = mul3(c, 1 - wet * 0.25);
      S.set(i, c); S.h[i] = 0.5 - seam * 0.2 + scuff * 0.01; S.rough[i] = r;
    });
    return S.pack(1.4);
  },

  concrete(S, N, opt) {
    const base = hex(opt.base ?? 0x7a7770);
    S.each((u, v, i) => {
      const n1 = N.fbm(u, v, 3, 3, 6), n2 = N.fbm(u, v, 24, 24, 4);
      let c = mul3(base, 0.8 + n1 * 0.35 + n2 * 0.12);
      let h = 0.5 + n2 * 0.06;
      let r = 0.82 + n2 * 0.1;
      const w = N.worley(u, v, 64, 2);
      const pit = 1 - smooth(0.06, 0.14, w[0]);
      c = mul3(c, 1 - pit * 0.45); h -= pit * 0.12;
      const wc = N.worley(u, v, 5, 4);
      const crack = (1 - smooth(0.0, 0.025, wc[1] - wc[0])) * smooth(0.1, 0.3, N.fbm(u, v, 3, 3, 3));
      c = mul3(c, 1 - crack * 0.7); h -= crack * 0.15;
      const stain = smooth(0.15, 0.45, N.fbm(u + 0.2, v, 4, 4, 5));
      c = lerp3(c, mul3(hex(0x3e3a30), 0.9), stain * 0.55); r = mix(r, 0.35, stain * (opt.wet ?? 0.6));
      const w2 = weather(N, u, v, c, { lowBand: 0.08, streak: opt.streak ?? 0.7, grime: 0.6 });
      c = w2.c; r = mix(r, 0.3, w2.streak * 0.6);
      S.set(i, c); S.h[i] = h; S.rough[i] = r;
    });
    return S.pack(2.4);
  },

  // Painted cinderblock. 1 tile = 2.4m (6 x 12 blocks, running bond)
  cinder(S, N, opt) {
    const paint = hex(opt.paint ?? 0x7f8a86), mortar = hex(0x6b6960);
    S.each((u, v, i) => {
      const row = Math.floor(v * 12);
      const off = row % 2 ? 0.5 : 0;
      const fx = u * 6 + off, bx = Math.floor(fx);
      const lx = fx - bx, ly = v * 12 - row;
      const dx = Math.min(lx, 1 - lx) * 0.4, dy = Math.min(ly, 1 - ly) * 0.2; // meters
      const d = Math.min(dx, dy);
      const block = smooth(0.004, 0.009, d);
      const rnd = hash2(bx % 6, row, 11);
      const por = N.fbm(u, v, 128, 128, 2);
      let c = mul3(paint, 0.92 + rnd * 0.08 + por * 0.08);
      c = lerp3(mortar, c, block);
      let h = 0.4 + block * 0.12 + por * 0.03 * block - (1 - smooth(0, 0.03, d)) * 0.02;
      let r = 0.7 + por * 0.1;
      const peel = smooth(0.3, 0.33, N.fbm(u, v, 4, 4, 6));
      c = lerp3(c, mul3(hex(0x6c6a62), 0.9 + por * 0.2), peel); r = mix(r, 0.95, peel); h -= peel * 0.03;
      const w = weather(N, u, v, c, { lowBand: 0.1, streak: 1.4 });
      c = w.c; r = mix(r, 0.3, w.streak * 0.7);
      const mold = smooth(0.6, 0.8, N.fbm(u, v, 20, 20, 5) * 0.7 + (0.25 - v) * 1.4 + 0.35);
      c = lerp3(c, hex(0x1f241a), mold * 0.8);
      S.set(i, c); S.h[i] = h; S.rough[i] = r;
    });
    return S.pack(2.6);
  },

  // Acoustic drop ceiling, 4x4 tiles of 60cm + T-bar grid
  ceiling(S, N) {
    const tile = hex(0xc4bfae), bar = hex(0xb7b3a6);
    S.each((u, v, i) => {
      const fx = u * 4, fy = v * 4, ix = Math.floor(fx), iy = Math.floor(fy);
      const lx = fx - ix, ly = fy - iy, rnd = hash2(ix, iy, 13), rnd2 = hash2(ix, iy, 21);
      const d = Math.min(lx, 1 - lx, ly, 1 - ly);
      const barM = 1 - smooth(0.018, 0.024, d);
      let c, r = 0.95, h = 0.5, metal = 0;
      if (rnd2 > 0.94) { // missing tile: void
        c = hex(0x0b0a09); h = 0.0; r = 1;
      } else {
        const fis = N.noise(u * 500, v * 500, 500, 500);
        c = mul3(tile, 0.88 + rnd * 0.1 + (fis > 0.45 ? -0.25 : 0));
        h = 0.45 + (fis > 0.45 ? -0.06 : 0) + N.fbm(u, v, 60, 60, 2) * 0.03;
        // water damage rings
        if (rnd > 0.6) {
          const cx = 0.3 + hash2(ix, iy, 31) * 0.4, cy = 0.3 + hash2(ix, iy, 41) * 0.4;
          const rr = 0.18 + hash2(ix, iy, 51) * 0.3;
          const dd = Math.hypot(lx - cx, ly - cy) + N.fbm(u, v, 16, 16, 3) * 0.08;
          const inside = 1 - smooth(rr - 0.03, rr, dd);
          const ring = Math.exp(-Math.pow((dd - rr) / 0.012, 2));
          c = lerp3(c, hex(0x8a6e45), inside * 0.4); c = lerp3(c, hex(0x5b4224), ring * 0.8);
        }
        c = mul3(c, 0.8 + 0.25 * clamp(0.5 + N.fbm(u, v, 3, 3, 4)));
      }
      if (barM > 0) { c = lerp3(c, mul3(bar, 0.8 + rnd * 0.1), barM); h = mix(h, 0.62, barM); r = mix(r, 0.45, barM); metal = barM * 0.4; }
      S.set(i, c); S.h[i] = h; S.rough[i] = r; S.metal[i] = metal;
    });
    return S.pack(2.2);
  },

  // Chipped painted steel with rust. 1 tile ~ 1.5m
  metalPaint(S, N, opt) {
    const paint = hex(opt.paint ?? 0x56645e), steel = hex(0x8a8c8c), rustC = hex(0x6b3418);
    S.each((u, v, i) => {
      const n1 = N.fbm(u, v, 6, 6, 6) + N.fbm(u, v, 48, 48, 3) * 0.25;
      let c = mul3(paint, 0.94 + N.fbm(u, v, 3, 3, 3) * 0.12);
      let r = 0.48 + N.fbm(u, v, 20, 20, 3) * 0.1, m = 0, h = 0.6;
      const chip = smooth(0.26 - (opt.wear ?? 0) * 0.1, 0.28 - (opt.wear ?? 0) * 0.1, n1);
      const rustZone = smooth(0.2, 0.3, n1 + N.fbm(u, v, 30, 30, 3) * 0.15);
      // scratches
      const scr = smooth(0.985, 0.995, N.ridged(u * 0.2, v, 18, 2) * (0.5 + 0.5 * N.noise(u * 7, v * 7, 7, 7)));
      c = lerp3(c, steel, scr * 0.7); m = Math.max(m, scr * 0.8); r = mix(r, 0.3, scr);
      c = lerp3(c, mul3(rustC, 0.9 + N.fbm(u, v, 60, 60, 2) * 0.3), rustZone * 0.65 * (opt.rust ?? 1)); r = mix(r, 0.9, rustZone * 0.6);
      if (chip > 0) {
        const rr = smooth(0.0, 0.2, N.fbm(u, v, 40, 40, 3) + 0.1);
        c = lerp3(c, lerp3(steel, rustC, rr), chip); m = mix(m, 1 - rr, chip); r = mix(r, mix(0.35, 0.85, rr), chip); h -= chip * 0.12;
      }
      const w = weather(N, u, v, c, { lowBand: 0.06, streak: 0.8 });
      c = w.c;
      S.set(i, c); S.h[i] = h; S.rough[i] = r; S.metal[i] = m;
    });
    return S.pack(1.8);
  },

  stainless(S, N) {
    S.each((u, v, i) => {
      const brush = N.fbm(u, v, 2, 300, 3);
      const smudge = clamp(0.5 + N.fbm(u, v, 5, 5, 5));
      let c = mul3(hex(0xb4b6b8), 0.9 + brush * 0.12);
      let r = 0.22 + brush * 0.06 + smooth(0.55, 0.85, smudge) * 0.3;
      const stain = smooth(0.62, 0.9, clamp(0.5 + N.fbm(u + 0.5, v, 4, 4, 5)));
      c = lerp3(c, hex(0x5a4e3c), stain * 0.35); r = mix(r, 0.6, stain * 0.5);
      S.set(i, c); S.h[i] = 0.5 + brush * 0.02; S.rough[i] = r; S.metal[i] = 1 - stain * 0.3;
    });
    return S.pack(0.6);
  },

  wood(S, N, opt) {
    const dark = hex(opt.dark ?? 0x3a2416), light = hex(opt.light ?? 0x7a5234);
    S.each((u, v, i) => {
      const warp = N.fbm(u, v, 2, 8, 4) * 3;
      const ring = 0.5 + 0.5 * Math.sin((v * 40 + warp * 4 + N.fbm(u, v, 1, 30, 3)) * 6.28);
      const fib = N.fbm(u, v, 1, 160, 3);
      let c = lerp3(dark, light, Math.pow(ring, 2.2) * 0.8 + fib * 0.2 + 0.1);
      let r = 0.42 + ring * 0.12;
      const wear = smooth(0.2, 0.5, N.fbm(u, v, 5, 5, 5));
      c = lerp3(c, mul3(light, 1.1), wear * 0.25); r = mix(r, 0.75, wear);
      const w = weather(N, u, v, c, { lowBand: 0.02, streak: 0.3, grime: 0.6 });
      S.set(i, w.c); S.h[i] = 0.5 + fib * 0.04 - ring * 0.02; S.rough[i] = r;
    });
    return S.pack(1.2);
  },

  fabric(S, N, opt) {
    const base = hex(opt.base ?? 0xd6d1c1);
    const stripe = opt.stripe != null ? hex(opt.stripe) : null;
    S.each((u, v, i) => {
      const wx = Math.sin(u * 6.28 * 220), wy = Math.sin(v * 6.28 * 220);
      const weave = (wx * 0.5 + 0.5) * (wy > 0 ? 1 : 0.6) + (wy * 0.5 + 0.5) * (wx > 0 ? 0.6 : 1);
      let c = mul3(base, 0.9 + weave * 0.06 + N.fbm(u, v, 6, 6, 4) * 0.08);
      if (stripe && Math.floor(u * 24) % 3 === 0) c = lerp3(c, stripe, 0.75);
      // yellowed sweat / body stains
      const st = N.worley(u, v, 4, 7);
      const stain = (1 - smooth(0.15, 0.4, st[0] + N.fbm(u, v, 12, 12, 3) * 0.2)) * (st[2] > 0.5 ? 1 : 0);
      const ring = Math.exp(-Math.pow((st[0] + N.fbm(u, v, 12, 12, 3) * 0.2 - 0.4) / 0.02, 2)) * (st[2] > 0.5 ? 1 : 0);
      c = lerp3(c, hex(0xa58f55), stain * 0.35); c = lerp3(c, hex(0x7a6036), ring * 0.4);
      // old blood
      const bl = smooth(0.42, 0.5, N.fbm(u + 0.33, v + 0.1, 3, 3, 6)) * (opt.blood ?? 0.6);
      c = lerp3(c, hex(0x4a0f0b), bl * 0.85);
      const dirt = clamp(0.5 + N.fbm(u, v, 3, 3, 5));
      c = mul3(c, 0.8 + 0.2 * (1 - dirt));
      S.set(i, c); S.h[i] = 0.5 + weave * 0.05; S.rough[i] = 0.92 - bl * 0.3;
    });
    return S.pack(1.0, 0.3);
  },

  skin(S, N) {
    const base = hex(0x9c9a8e);
    S.each((u, v, i) => {
      const m1 = N.fbm(u, v, 4, 4, 5), m2 = N.fbm(u + 0.4, v, 9, 9, 4);
      let c = mul3(base, 0.85 + m1 * 0.25);
      c = lerp3(c, hex(0x7d6a78), smooth(0.0, 0.5, m2) * 0.45);  // bruise purple
      c = lerp3(c, hex(0xa49a6a), smooth(0.1, 0.6, -m2) * 0.35); // jaundice
      const vein1 = Math.pow(N.ridged(u, v, 6, 3), 9);
      const vein2 = Math.pow(N.ridged(u + 0.21, v + 0.6, 14, 2), 12) * 0.8;
      const vein = clamp(vein1 + vein2);
      c = lerp3(c, hex(0x2f2a4a), vein * 0.75);
      const pore = N.noise(u * 400, v * 400, 400, 400);
      const wr = N.fbm(u, v, 3, 40, 3);
      const wrinkle = smooth(0.15, 0.35, Math.abs(wr));
      c = mul3(c, 0.95 + pore * 0.05 - (1 - wrinkle) * 0.1);
      // dried blood around seams
      const bl = smooth(0.38, 0.55, N.fbm(u, v + 0.7, 5, 5, 6));
      c = lerp3(c, hex(0x3a0d0a), bl * 0.7);
      S.set(i, c);
      S.h[i] = 0.5 + vein * 0.12 + pore * 0.01 - (1 - wrinkle) * 0.05;
      S.rough[i] = 0.32 + clamp(0.5 + m1) * 0.3 + bl * 0.2;
    });
    return S.pack(2.4, 0.5);
  },

  rust(S, N) {
    S.each((u, v, i) => {
      const n1 = N.fbm(u, v, 6, 6, 6), n2 = N.fbm(u, v, 40, 40, 4);
      let c = lerp3(hex(0x4a2310), hex(0x8a4a1f), clamp(0.5 + n1));
      c = lerp3(c, hex(0x2a1a12), smooth(0.1, 0.4, n2) * 0.6);
      const flake = smooth(0.2, 0.25, n2 + n1 * 0.3);
      S.set(i, mul3(c, 0.85 + flake * 0.2));
      S.h[i] = 0.5 + flake * 0.15 + n2 * 0.05; S.rough[i] = 0.85 + n2 * 0.1; S.metal[i] = 0.25 * (1 - flake);
    });
    return S.pack(2.8);
  },

  cardboard(S, N) {
    S.each((u, v, i) => {
      const f = N.fbm(u, v, 2, 60, 3);
      let c = mul3(hex(0x8f7550), 0.85 + f * 0.15 + N.fbm(u, v, 5, 5, 4) * 0.15);
      const wet = smooth(0.15, 0.4, N.fbm(u, v, 3, 3, 5) - v * 0.5 + 0.2);
      c = lerp3(c, hex(0x4e3c24), wet * 0.6);
      S.set(i, c); S.h[i] = 0.5 + f * 0.03; S.rough[i] = 0.9;
    });
    return S.pack(0.8);
  },
};

export function generateTexture(job) {
  const { recipe, size, seed = 1, opt = {} } = job;
  const S = new Surface(size);
  const N = makeNoise(seed);
  return recipes[recipe](S, N, opt);
}
