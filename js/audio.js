// audio.js — fully procedural sound for the game. No audio files: every sound is
// synthesized live with the Web Audio API.
//
// Structure
//   master ── highpass ── compressor ── safety soft-clip ── destination
//   buses: sfx (positional one-shots), amb (ambience beds), music (tension,
//   stingers, heartbeat), ui (beeps, radio, PA). Every voice also feeds a shared
//   reverb send (two ConvolverNodes with procedurally generated impulse
//   responses, crossfaded when the preset changes).
//
//   One-shots are "voices": a small node graph with an output gain, an optional
//   HRTF PannerNode and a reverb send. Voices are capped per category and
//   globally (oldest is faded out and stolen) and are disconnected as soon as
//   they finish. Loops (ambience, tension, alarm, light buzz) are long-lived
//   voices driven by a lookahead event scheduler that runs from update().
//
// Everything fails silently: without Web Audio every method is a no-op.

import * as THREE from 'three';

// ---------------------------------------------------------------- utilities
const rand = (a, b) => a + Math.random() * (b - a);
const irand = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const chance = (p) => Math.random() < p;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const cents = (st) => st * 100;

// Percussive envelope: ~linear attack, exponential decay. `decay` is the time to
// fall to about -40 dB.
function perc(p, t, peak, decay, att = 0.0015) {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + att);
  p.setTargetAtTime(0, t + att, Math.max(0.0005, decay / 4.6));
  return t + att + decay * 1.5;
}

// Attack / hold / exponential release.
function ahr(p, t, a, peak, hold, rel) {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setValueAtTime(peak, t + a + hold);
  p.setTargetAtTime(0, t + a + hold, Math.max(0.001, rel / 4.6));
  return t + a + hold + rel * 1.4;
}

// Piecewise-linear envelope from [[dt, value], ...] (dt relative to t).
function pts(p, t, list) {
  p.setValueAtTime(list[0][1], t + list[0][0]);
  for (let i = 1; i < list.length; i++) p.linearRampToValueAtTime(list[i][1], t + list[i][0]);
  return t + list[list.length - 1][0];
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

function setPannerPos(pn, p) {
  if (pn.positionX) {
    pn.positionX.value = p.x; pn.positionY.value = p.y; pn.positionZ.value = p.z;
  } else if (pn.setPosition) pn.setPosition(p.x, p.y, p.z);
}

// Vowel formants (F1, F2, F3) for an adult male vocal tract.
const VOWELS = {
  a: [730, 1090, 2440], ae: [660, 1720, 2410], e: [530, 1840, 2480], i: [270, 2290, 3010],
  ih: [390, 1990, 2550], o: [570, 840, 2410], u: [300, 870, 2240], uh: [520, 1190, 2390],
  er: [490, 1350, 1690], aw: [640, 1000, 2500],
};
const VOWEL_KEYS = Object.keys(VOWELS);

// Voice caps per category and globally.
const CAPS = {
  foot: 8, cbreath: 2, cscream: 2, cgrowl: 2, cclick: 6, ccrack: 4, cmove: 6, csniff: 2, cdrag: 2,
  door: 4, glass: 5, metal: 6, debris: 4, ui: 6, radio: 1, fx: 6, amb: 10, stinger: 3, heart: 3,
  power: 2, decon: 1, strobe: 2,
};
const MAX_VOICES = 32;     // live (sounding) voices
const MAX_DYING = 16;      // voices allowed to be fading out at once

// Reverb presets. rt = RT60 (s); bright/dark = tail lowpass at start/end.
const REVERBS = {
  lab:      { rt: 1.35, len: 1.9, pre: 0.007, bright: 9500, dark: 2600, hp: 160, early: 16, erSpan: 0.05, wet: 0.3 },
  corridor: { rt: 1.8, len: 2.5, pre: 0.005, bright: 7000, dark: 1700, hp: 140, early: 8, erSpan: 0.03, wet: 0.34, flutter: 0.0105 },
  large:    { rt: 3.9, len: 5.0, pre: 0.03, bright: 5200, dark: 800, hp: 70, early: 10, erSpan: 0.14, wet: 0.42 },
  small:    { rt: 0.32, len: 0.55, pre: 0.0015, bright: 6500, dark: 2200, hp: 220, early: 10, erSpan: 0.012, wet: 0.22 },
  outside:  { rt: 0.7, len: 2.0, pre: 0.015, bright: 6000, dark: 1400, hp: 120, early: 2, erSpan: 0.02, wet: 0.15, density: 0.25,
              echoes: [[0.14, 0.22], [0.33, 0.14], [0.57, 0.07], [0.81, 0.035]] },
};

// ------------------------------------------------------- buffer generators
// Fast xorshift PRNG for per-sample noise (much cheaper than Math.random).
let _seed = ((Math.random() * 4294967296) >>> 0) || 0x9e3779b9;
function rnd() {
  _seed ^= _seed << 13; _seed ^= _seed >>> 17; _seed ^= _seed << 5;
  return (_seed >>> 0) / 4294967296;
}
function seamless(d, n, fade) {
  // d has n + fade samples; crossfade the overhang into the head so it loops.
  for (let i = 0; i < fade; i++) {
    const a = i / fade;
    d[i] = d[i] * Math.sqrt(a) + d[n + i] * Math.sqrt(1 - a);
  }
}

function normalizeRms(d, n, target) {
  let s = 0;
  for (let i = 0; i < n; i++) s += d[i] * d[i];
  const k = target / Math.sqrt(s / n + 1e-12);
  for (let i = 0; i < n; i++) d[i] = clamp(d[i] * k, -1, 1);
}

function normalizePeak(d, n, target) {
  let m = 1e-9;
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(d[i]));
  const k = target / m;
  for (let i = 0; i < n; i++) d[i] *= k;
}

function genNoise(ctx, kind, secs, channels = 1) {
  const sr = ctx.sampleRate, n = Math.floor(sr * secs), fade = Math.floor(sr * 0.05);
  const buf = ctx.createBuffer(channels, n, sr);
  for (let c = 0; c < channels; c++) {
    const d = new Float32Array(n + fade);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
    for (let i = 0; i < n + fade; i++) {
      const w = rnd() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
      } else { // brown (leaky integrator)
        br = (br + 0.02 * w) / 1.02;
        d[i] = br;
      }
    }
    if (kind === 'brown') { // remove the slow DC wander
      let m = 0;
      for (let i = 0; i < n + fade; i++) { m = m * 0.9995 + d[i] * 0.0005; d[i] -= m; }
    }
    seamless(d, n, fade);
    normalizeRms(d, n, 0.25);
    buf.getChannelData(c).set(d.subarray(0, n));
  }
  return buf;
}

// Wet rattle: irregular train of short damped "pops" at 18-45 Hz.
function genRattle(ctx, secs) {
  const sr = ctx.sampleRate, n = Math.floor(sr * secs), fade = Math.floor(sr * 0.03);
  const d = new Float32Array(n + fade + sr);
  let t = 0;
  const ph = rnd() * 6;
  while (t < n + fade) {
    const s = t / sr;
    const rate = 30 + 11 * Math.sin(s * 2.3 + ph) + 6 * Math.sin(s * 7.1 + ph * 2) + rand(-5, 5);
    const f = rand(150, 560), dec = rand(0.0025, 0.009) * sr;
    let amp = Math.pow(rnd(), 1.6) * (0.6 + 0.4 * Math.sin(s * 5.3 + ph));
    if (chance(0.08)) amp *= 2.2; // a bigger wet pop now and then
    const len = Math.min(Math.floor(dec * 5), d.length - t);
    const w = 2 * Math.PI * f / sr, r = Math.exp(-1 / dec), c = 2 * r * Math.cos(w), q = r * r, rn = Math.exp(-4 / dec);
    const phase = rnd() * 6.28;
    let y1 = amp * 0.75 * Math.sin(phase - w) * r, y0 = amp * 0.75 * Math.sin(phase), ne = amp * 0.35;
    for (let k = 0; k < len; k++) {
      d[t + k] += y0 + ne * (rnd() * 2 - 1);
      const y = c * y0 - q * y1; y1 = y0; y0 = y; ne *= rn;
    }
    if (chance(0.25)) t += Math.floor(rand(0.002, 0.006) * sr); // double pop
    else t += Math.floor((sr / rate) * rand(0.55, 1.45));
  }
  seamless(d, n, fade);
  normalizePeak(d, n, 0.9);
  const buf = ctx.createBuffer(1, n, sr);
  buf.getChannelData(0).set(d.subarray(0, n));
  return buf;
}

// Stick-slip pulse train (creaks, vocal fry). Rate wanders between lo and hi.
// gated=true gives creaks that start and stop; otherwise a continuous fry.
function genPulses(ctx, secs, lo, hi, gated) {
  const sr = ctx.sampleRate, n = Math.floor(sr * secs), fade = Math.floor(sr * 0.04);
  const d = new Float32Array(n + fade);
  let phase = 0, rate = rand(lo, hi), target = rate, y = 0, gate = 1, gateT = gated ? rand(0.1, 0.5) : 0;
  for (let i = 0; i < n + fade; i++) {
    if ((i & 127) === 0) {
      if (chance(0.03)) target = rand(lo, hi);
      rate += (target - rate) * 0.06;
      if (gated) {
        gateT -= 128 / sr;
        if (gateT <= 0) { gate = gate > 0.5 ? 0 : 1; gateT = gate ? rand(0.15, 0.7) : rand(0.05, 0.35); }
      }
    }
    phase += rate / sr;
    let x = 0;
    if (phase >= 1) {
      phase -= 1 + rand(-0.18, 0.18);
      if (phase < 0) phase = 0;
      x = rand(0.4, 1) * (gated ? 1 : rand(0.6, 1));
    }
    y = x + 0.55 * y;
    d[i] = y * (gated ? gate : 1);
  }
  // DC removal
  let m = 0;
  for (let i = 0; i < n + fade; i++) { m = m * 0.999 + d[i] * 0.001; d[i] -= m; }
  seamless(d, n, fade);
  normalizePeak(d, n, 0.9);
  const buf = ctx.createBuffer(1, n, sr);
  buf.getChannelData(0).set(d.subarray(0, n));
  return buf;
}

// Sparse impulsive crackle (grit, plastic, splinters).
function genCrackle(ctx, secs, density) {
  const sr = ctx.sampleRate, n = Math.floor(sr * secs), fade = Math.floor(sr * 0.02);
  const d = new Float32Array(n + fade + 400);
  const p = density / sr;
  for (let i = 0; i < n + fade; i++) {
    if (rnd() < p) {
      const amp = Math.pow(rnd(), 2.5) * (chance(0.5) ? 1 : -1);
      const len = irand(2, 60), dec = len / 3;
      for (let k = 0; k < len; k++) d[i + k] += amp * Math.exp(-k / dec) * (rnd() * 2 - 1);
    }
  }
  seamless(d, n, fade);
  normalizePeak(d, n, 0.95);
  const buf = ctx.createBuffer(1, n, sr);
  buf.getChannelData(0).set(d.subarray(0, n));
  return buf;
}

// Damped two-partial "ping" via recursive resonators (cheap: no sin/exp per sample).
function addPing(d, sr, at, f, dec, amp) {
  const i0 = Math.floor(at * sr);
  const decN = dec * sr, len = Math.min(Math.floor(decN * 4.5), d.length - i0);
  const r1 = Math.exp(-1 / decN), r2 = Math.exp(-2 / decN);
  const w1 = 2 * Math.PI * f / sr, w2 = 2 * Math.PI * f * rand(1.45, 2.8) / sr;
  const c1 = 2 * r1 * Math.cos(w1), c2 = 2 * r2 * Math.cos(w2), q1 = r1 * r1, q2 = r2 * r2;
  let a1 = 0, b1 = amp * Math.sin(w1), a2 = 0, b2 = 0.5 * amp * Math.sin(w2);
  for (let k = 0; k < len; k++) {
    const y1 = c1 * b1 - q1 * a1, y2 = c2 * b2 - q2 * a2;
    a1 = b1; b1 = y1; a2 = b2; b2 = y2;
    d[i0 + k] += y1 + y2 + (k < 30 ? (rnd() * 2 - 1) * (30 - k) * 0.027 * amp : 0);
  }
}

// Glass shards: dense shatter, then falling/bouncing shards tinkling.
function genShards(ctx, secs) {
  const sr = ctx.sampleRate, n = Math.floor(sr * secs);
  const d = new Float32Array(n + sr);
  // initial burst
  const N1 = irand(160, 260);
  for (let i = 0; i < N1; i++) {
    const at = 0.003 + Math.pow(rnd(), 2.2) * 0.45;
    addPing(d, sr, at, rand(1800, 9500), rand(0.004, 0.03), rand(0.15, 1) * (1 - at));
  }
  // falling shards: bounce sequences
  const M = irand(28, 46);
  for (let k = 0; k < M; k++) {
    let at = 0.25 + Math.pow(rnd(), 1.6) * (secs - 0.6);
    const f = rand(2200, 8500), bounces = irand(1, 4);
    let amp = rand(0.15, 0.6) * (1 - at / secs * 0.7), gap = rand(0.05, 0.12);
    for (let b = 0; b < bounces && at < secs - 0.1; b++) {
      addPing(d, sr, at, f * rand(0.97, 1.03), rand(0.01, 0.05), amp);
      at += gap; gap *= rand(0.5, 0.7); amp *= rand(0.35, 0.6);
    }
  }
  normalizePeak(d, n, 0.9);
  const buf = ctx.createBuffer(1, n, sr);
  buf.getChannelData(0).set(d.subarray(0, n));
  return buf;
}

// Wood splintering: crack events thickening then thinning out.
function genSplinter(ctx, secs) {
  const sr = ctx.sampleRate, n = Math.floor(sr * secs);
  const d = new Float32Array(n + sr);
  const N = irand(90, 150);
  for (let i = 0; i < N; i++) {
    const at = Math.pow(rnd(), 2.4) * secs * 0.85;
    const amp = rand(0.2, 1) * Math.exp(-at * 2.2);
    const i0 = Math.floor(at * sr), f = rand(350, 3200), dec = rand(0.002, 0.016) * sr;
    const nl = irand(20, 300), len = Math.min(Math.max(Math.floor(dec * 4.5), nl), d.length - i0), w = 2 * Math.PI * f / sr;
    const r = Math.exp(-1 / dec), c = 2 * r * Math.cos(w), q = r * r;
    let a = 0, b = 0.6 * amp * Math.sin(w);
    for (let k = 0; k < len; k++) {
      const y = c * b - q * a; a = b; b = y;
      d[i0 + k] += y + (k < nl ? amp * (rnd() * 2 - 1) * (1 - k / nl) : 0);
    }
  }
  normalizePeak(d, n, 0.9);
  const buf = ctx.createBuffer(1, n, sr);
  buf.getChannelData(0).set(d.subarray(0, n));
  return buf;
}

// Procedural impulse response: early reflections + filtered decaying noise tail.
function genIR(ctx, p) {
  const sr = ctx.sampleRate, N = Math.floor(p.len * sr);
  const buf = ctx.createBuffer(2, N, sr);
  const decay = 6.91 / p.rt;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const preN = Math.floor(p.pre * sr);
    let lp = 0, a = 0, gk = 0, env = 1;
    const density = p.density ?? 1, envStep = Math.exp(-decay / sr), buildT = 0.015 + p.erSpan * 0.6;
    for (let i = preN; i < N; i++) {
      const t = (i - preN) / sr;
      if (((i - preN) & 31) === 0) {
        const fc = p.dark + (p.bright - p.dark) * Math.exp(-t * 2.5 / p.rt);
        a = Math.exp(-2 * Math.PI * fc / sr);
        gk = 0.5 / Math.sqrt((1 - a) / (1 + a)) * Math.min(1, t / buildT); // keep level while darkening
      }
      let x = rnd() * 2 - 1;
      if (density < 1 && rnd() > density) x = 0;
      lp = (1 - a) * x + a * lp;
      d[i] = lp * gk * env;
      env *= envStep;
    }
    // early reflections
    for (let k = 0; k < p.early; k++) {
      const t = p.pre + Math.pow(rnd(), 0.8) * p.erSpan;
      const i = Math.floor(t * sr);
      if (i < N) d[i] += (chance(0.5) ? 1 : -1) * rand(0.3, 0.9) * Math.exp(-t * 8) * (1 - k / (p.early + 1));
    }
    if (p.flutter) { // parallel-wall flutter echo (corridor)
      let t = p.pre + p.flutter * (ch ? 1.03 : 0.97), a = 0.5;
      while (t < 0.45 && a > 0.01) {
        const i = Math.floor(t * sr);
        if (i < N) { d[i] += a * (chance(0.5) ? 1 : -1); if (i + 1 < N) d[i + 1] += a * 0.5; }
        t += p.flutter * rand(0.98, 1.02); a *= 0.84;
      }
    }
    if (p.echoes) for (const [et, ea] of p.echoes) { // discrete slapback echoes (outside)
      const i0 = Math.floor((et + (ch ? rand(0.005, 0.02) : 0)) * sr);
      for (let k = 0; k < 220 && i0 + k < N; k++) d[i0 + k] += ea * (rnd() * 2 - 1) * Math.exp(-k / 45);
    }
    // highpass (keep low mud out of the tail) + end fade
    let xp = 0, yp = 0;
    const r = Math.exp(-2 * Math.PI * p.hp / sr);
    for (let i = 0; i < N; i++) { const y = d[i] - xp + r * yp; xp = d[i]; yp = y; d[i] = y; }
    const fadeN = Math.floor(0.05 * sr);
    for (let i = 0; i < fadeN; i++) d[N - 1 - i] *= i / fadeN;
    // normalize: sum of squares = 1
    let s = 0;
    for (let i = 0; i < N; i++) s += d[i] * d[i];
    const k = 1 / Math.sqrt(s + 1e-12);
    for (let i = 0; i < N; i++) d[i] *= k;
  }
  return buf;
}

// ------------------------------------------------------------------- Voice
class Voice {
  constructor(eng, cat, o = {}) {
    const ctx = eng.ctx;
    this.eng = eng; this.ctx = ctx; this.cat = cat;
    this.nodes = []; this.srcs = [];
    this.start = o.t ?? ctx.currentTime;
    this.end = o.loop ? Infinity : this.start + 0.05;
    this.dead = false; this.dying = false; this.onDispose = null;
    const out = this.out = ctx.createGain();
    out.gain.value = o.gain ?? 1;
    this.nodes.push(out);
    const bus = eng.bus[o.bus || 'sfx'];
    let send = o.send ?? 0.25;
    if (o.pos) {
      const p = o.pos, L = eng._lp;
      const dx = p.x - L.x, dy = p.y - L.y, dz = p.z - L.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let node = out;
      if (d > 4) { // air absorption
        const lp = this.filter('lowpass', clamp(22000 / (1 + (d - 4) * 0.13), 1800, 20000), 0.5);
        out.connect(lp); node = lp;
      }
      const pn = this.panner = ctx.createPanner();
      pn.panningModel = eng.hrtf ? 'HRTF' : 'equalpower';
      pn.distanceModel = 'inverse';
      pn.refDistance = 1.5; pn.rolloffFactor = 1.2; pn.maxDistance = 40;
      setPannerPos(pn, p);
      this.nodes.push(pn);
      node.connect(pn); pn.connect(bus);
      send *= 1 / (1 + 0.07 * Math.max(0, d - 1.5));
    } else if (o.pan != null && ctx.createStereoPanner) {
      const sp = this.stereo = ctx.createStereoPanner();
      sp.pan.value = clamp(o.pan, -1, 1);
      this.nodes.push(sp);
      out.connect(sp); sp.connect(bus);
    } else out.connect(bus);
    if (send > 0.001) {
      const sg = this.sendGain = ctx.createGain();
      sg.gain.value = send;
      this.nodes.push(sg);
      out.connect(sg); sg.connect(eng.revIn);
    }
  }

  _src(s, t1) {
    this.srcs.push(s); this.nodes.push(s);
    if (t1 != null && t1 > this.end) this.end = t1;
    return s;
  }
  until(t) { if (t > this.end) this.end = t; }
  osc(type, freq, t0, t1) {
    const o = this.ctx.createOscillator();
    if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
    o.frequency.value = freq;
    o.start(t0); if (t1 != null) o.stop(t1);
    return this._src(o, t1);
  }
  noise(kind, t0, t1, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.eng.buf[kind];
    s.loop = true; s.playbackRate.value = rate;
    s.start(t0, Math.random() * s.buffer.duration * 0.95);
    if (t1 != null) s.stop(t1);
    return this._src(s, t1);
  }
  buffer(buf, t0, t1, rate = 1, loop = false, offset = 0) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf; s.loop = loop; s.playbackRate.value = rate;
    s.start(t0, offset);
    if (t1 != null) s.stop(t1);
    else if (!loop) this.until(t0 + buf.duration / rate + 0.05);
    return this._src(s, t1);
  }
  constant(value, t0, t1) {
    const c = this.ctx.createConstantSource();
    c.offset.value = value;
    c.start(t0); if (t1 != null) c.stop(t1);
    return this._src(c, t1);
  }
  filter(type, f, Q = 1, g = 0) {
    const b = this.ctx.createBiquadFilter();
    b.type = type; b.frequency.value = f; b.Q.value = Q; b.gain.value = g;
    this.nodes.push(b);
    return b;
  }
  gain(v = 1) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    this.nodes.push(g);
    return g;
  }
  shaper(drive = 2, os = '2x') {
    const w = this.ctx.createWaveShaper();
    w.curve = this.eng._curve(drive);
    w.oversample = os;
    this.nodes.push(w);
    return w;
  }
  delay(t, max = 1) {
    const d = this.ctx.createDelay(max);
    d.delayTime.value = t;
    this.nodes.push(d);
    return d;
  }
  // Connect a chain of nodes, return the last.
  chain(...ns) {
    for (let i = 0; i < ns.length - 1; i++) ns[i].connect(ns[i + 1]);
    return ns[ns.length - 1];
  }
  // Parallel vowel formant bank. Returns { out, set(vowel, t, tc) }.
  formants(input, scale = 1, vowel = 'a', Q = [6, 8, 10], amps = [1, 0.6, 0.3]) {
    const out = this.gain(1);
    const f = VOWELS[vowel] || VOWELS.a;
    const bps = [];
    for (let i = 0; i < 3; i++) {
      const bp = this.filter('bandpass', f[i] * scale, Q[i]);
      const g = this.gain(amps[i] * Math.sqrt(Q[i]));
      input.connect(bp); bp.connect(g); g.connect(out);
      bps.push(bp);
    }
    return {
      out, bps,
      set(vw, t, tc = 0.04) {
        const ff = VOWELS[vw] || VOWELS.a;
        for (let i = 0; i < 3; i++) bps[i].frequency.setTargetAtTime(ff[i] * scale, t, tc);
      },
    };
  }
  // Inharmonic modal ring (metal, glass). Sines with exponential decays.
  modes(t, freqs, decays, amps, dest, att = 0.001) {
    for (let i = 0; i < freqs.length; i++) {
      const o = this.osc('sine', freqs[i], t, t + decays[i] * 1.6 + 0.02);
      const g = this.gain(0);
      perc(g.gain, t, amps[i], decays[i], att);
      o.connect(g); g.connect(dest);
    }
  }
  setPosition(p) { if (this.panner && p) setPannerPos(this.panner, p); }

  kill(fade = 0.04) {
    if (this.dead || this.dying) return;
    const now = this.ctx.currentTime;
    // not sounding yet (scheduled in the lookahead / same tick): drop it outright
    if (this.start >= now + 0.003) { this.dispose(); return; }
    this.dying = true;
    const g = this.out.gain;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now); else { g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); }
    g.setTargetAtTime(0, now, fade / 4);
    for (const s of this.srcs) { try { s.stop(now + fade * 1.5 + 0.02); } catch (e) { /* already stopped */ } }
    this.end = now + fade * 1.5 + 0.05;
  }
  dispose() {
    if (this.dead) return;
    this.dead = true;
    for (const s of this.srcs) { try { s.stop(); } catch (e) { /* ok */ } }
    for (const n of this.nodes) { try { n.disconnect(); } catch (e) { /* ok */ } }
    this.nodes.length = 0; this.srcs.length = 0;
    if (this.onDispose) { const f = this.onDispose; this.onDispose = null; f(); }
  }
}

const NOOP_HANDLE = Object.freeze({ stop() {}, set() {}, setOn() {}, setPosition() {}, get active() { return false; } });

// ------------------------------------------------------------------ Engine
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ok = false;
    this.hrtf = true;
    this.debug = false;
    this._camera = null;
    this._lp = { x: 0, y: 0, z: 0 };
    this.voices = [];
    this._tickers = new Set();
    this._loops = new Set();      // lightBuzz handles
    this._beds = [];              // fading-out ambience beds
    this._bed = null;
    this._tension = null;
    this._alarm = null;
    this._heart = null;
    this._charge = null;
    this._footSide = 1;
    this._lastUpdate = 0;
    this._state = { volume: 0.85, reverb: 'lab', amb: null, tension: 0, heart: 0, alarm: null };
    this._v3 = null; this._q = null;
  }

  // ------------------------------------------------------------ lifecycle
  init(opts = {}) {
    try {
      if (this.ctx) {
        if (!this._offline && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
        return this.ctx;
      }
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!opts.context && !AC) return null;
      const ctx = opts.context || new AC({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this._offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
      this._build();
      this.ok = true;
      if (!this._offline) {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        this._interval = setInterval(() => {
          if (performance.now() - this._lastUpdate > 300) this.update(0);
        }, 200);
      }
      // apply state requested before init
      const s = this._state;
      this.setMasterVolume(s.volume);
      this.setReverb(s.reverb, 0);
      if (s.amb) this.setAmbience(s.amb.name, s.amb.level, s.amb.fade);
      if (s.tension) this.setTension(s.tension);
      if (s.heart) this.heartbeat(s.heart);
      if (s.alarm) this.alarm(true, s.alarm);
      for (const h of this._loops) h._build();
      if (!this._offline) { // prepare buffers, reverbs and break-up buffers off the critical path
        this._bufKeys.forEach((k, i) => setTimeout(() => { try { void this.buf[k]; } catch (e) { this._err(e); } }, 60 + i * 70));
        Object.keys(REVERBS).forEach((k, i) => setTimeout(() => {
          try { if (this.ctx) this._revSlot(k); } catch (e) { this._err(e); }
        }, 900 + i * 250));
        setTimeout(() => { try { this._pool.shards.push(genShards(ctx, 3.6)); this._pool.splinter.push(genSplinter(ctx, 1.8)); } catch (e) { this._err(e); } }, 2300);
      }
      return ctx;
    } catch (e) {
      this._err(e);
      this.ok = false;
      this.ctx = null;
      return null;
    }
  }

  get ready() {
    return !!this.ctx && this.ok && (this._offline || this.ctx.state === 'running');
  }

  get voiceCount() { return this.voices.length; }

  _err(e) { if (this.debug) console.warn('[audio]', e); }

  _build() {
    const ctx = this.ctx;
    // Shared buffers, built lazily on first use; an idle-time prefill after init builds
    // the rest so the first creature sound doesn't pay for them.
    const gens = {
      white: () => genNoise(ctx, 'white', 3),
      pink: () => genNoise(ctx, 'pink', 3),
      brown: () => genNoise(ctx, 'brown', 3),
      pinkSt: () => genNoise(ctx, 'pink', 5, 2),
      brownSt: () => genNoise(ctx, 'brown', 5, 2),
      rattle: () => [genRattle(ctx, 2.2), genRattle(ctx, 2.2), genRattle(ctx, 2.2)],
      fry: () => [genPulses(ctx, 2.5, 34, 62, false), genPulses(ctx, 2.5, 30, 55, false)],
      creak: () => [genPulses(ctx, 2, 12, 90, true), genPulses(ctx, 2, 25, 140, true), genPulses(ctx, 2, 8, 60, true)],
      crackle: () => genCrackle(ctx, 2.5, 380),
      grit: () => genCrackle(ctx, 2.0, 2200),
    };
    this.buf = {};
    for (const k of Object.keys(gens)) {
      Object.defineProperty(this.buf, k, {
        configurable: true, enumerable: true,
        get: () => { const v = gens[k](); Object.defineProperty(this.buf, k, { value: v, enumerable: true }); return v; },
      });
    }
    this._bufKeys = Object.keys(gens);
    this._curves = new Map();
    this._waves = new Map();
    this._irs = new Map();

    // master chain
    const master = this.master = ctx.createGain();
    master.gain.value = this._state.volume;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 22; hp.Q.value = 0.6;
    const comp = this.comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 5;
    comp.attack.value = 0.003; comp.release.value = 0.25;
    const pre = ctx.createGain(); pre.gain.value = 0.5;
    const clip = ctx.createWaveShaper();
    const N = 4096, cv = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const u = (i / (N - 1) * 2 - 1) * 2, a = Math.abs(u);
      cv[i] = Math.sign(u) * (a < 0.7 ? a : 0.7 + 0.28 * Math.tanh((a - 0.7) / 0.28));
    }
    clip.curve = cv;
    master.connect(hp); hp.connect(comp); comp.connect(pre); pre.connect(clip); clip.connect(ctx.destination);
    this.output = clip;

    this.bus = {};
    const busGain = { sfx: 1, amb: 0.55, music: 0.6, ui: 0.8 };
    for (const k of Object.keys(busGain)) {
      const g = ctx.createGain(); g.gain.value = busGain[k]; g.connect(master); this.bus[k] = g;
    }

    // reverb: send -> highpass -> two convolvers (crossfade) -> master
    this.revIn = ctx.createGain();
    const rhp = ctx.createBiquadFilter(); rhp.type = 'highpass'; rhp.frequency.value = 120; rhp.Q.value = 0.5;
    this.revIn.connect(rhp);
    this._revHP = rhp;
    this.revOut = ctx.createGain(); this.revOut.gain.value = REVERBS.lab.wet;
    this.revOut.connect(master);
    this._rev = {};          // preset -> { conv, gain, connected }
    this._revActive = null;
    this._pool = { shards: [], splinter: [] };
  }

  // One ConvolverNode per preset. Assigning .buffer runs the FFT setup
  // synchronously, so this is done at idle time after init, not on switch.
  _revSlot(preset) {
    let r = this._rev[preset];
    if (r) return r;
    let ir = this._irs.get(preset);
    if (!ir) { ir = genIR(this.ctx, REVERBS[preset]); this._irs.set(preset, ir); }
    const conv = this.ctx.createConvolver();
    conv.normalize = false;
    conv.buffer = ir;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    conv.connect(gain); gain.connect(this.revOut);
    r = this._rev[preset] = { conv, gain, connected: false, unhookAt: 0 };
    return r;
  }

  _poolTake(kind) {
    const pool = this._pool[kind];
    const gen = kind === 'shards' ? () => genShards(this.ctx, 3.6) : () => genSplinter(this.ctx, 1.8);
    this._lastBuf = this._lastBuf || {};
    const now = this.ctx.currentTime, lb = this._lastBuf[kind];
    // pool empty and one was just made: reuse it (played at another rate) instead of stalling the frame
    const b = pool.length ? pool.shift() : (lb && now - lb.t < 1.5 ? lb.b : gen());
    this._lastBuf[kind] = { b, t: now };
    if (!this._offline) setTimeout(() => { try { while (this.ctx && pool.length < 2) pool.push(gen()); } catch (e) { this._err(e); } }, 600);
    return b;
  }

  _curve(drive) {
    const key = Math.round(drive * 10);
    let c = this._curves.get(key);
    if (!c) {
      const n = 2048; c = new Float32Array(n);
      const k = key / 10, norm = Math.tanh(k);
      for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / norm; }
      this._curves.set(key, c);
    }
    return c;
  }

  _wave(name) {
    let w = this._waves.get(name);
    if (w) return w;
    const H = 64, re = new Float32Array(H), im = new Float32Array(H);
    if (name === 'glottal') for (let n = 1; n < H; n++) im[n] = Math.pow(n, -1.35) * (n % 2 ? 1 : 0.85);
    else if (name === 'hum') { // mains transformer hum on a 60 Hz fundamental
      const a = [0, 0.45, 1, 0.3, 0.55, 0.12, 0.3, 0.06, 0.16, 0.04, 0.09, 0.03, 0.06, 0.02, 0.04, 0.015, 0.03];
      for (let n = 1; n < a.length; n++) im[n] = a[n];
    } else if (name === 'buzz') { // ballast buzz on 120 Hz, harsh upper harmonics
      for (let n = 1; n < H; n++) im[n] = (n % 2 ? 1 : 0.5) * Math.pow(n, -0.75) * (0.6 + 0.4 * Math.sin(n * 1.7));
    } else if (name === 'pulse') { // 25% duty pulse
      for (let n = 1; n < H; n++) re[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * 0.25);
    } else if (name === 'reed') { // klaxon horn reed
      for (let n = 1; n < H; n++) im[n] = Math.pow(n, -0.9) * (n % 2 ? 1 : 0.35);
    }
    w = this.ctx.createPeriodicWave(re, im);
    this._waves.set(name, w);
    return w;
  }

  _now() { return this.ctx.currentTime + (this._offline ? 0 : 0.012); }

  // Small control handle for longer one-shots (follow a moving creature, cut early).
  _handle(v) {
    return {
      setPosition: (p) => { if (p && !v.dead) v.setPosition(p); },
      stop: (fade = 0.08) => { if (!v.dead) v.kill(fade); },
      get active() { return !v.dead && v.end > v.ctx.currentTime; },
    };
  }

  // Create a one-shot voice, stealing per category / globally if needed.
  _voice(cat, o = {}) {
    const t = o.t ?? this._now();
    this._sweep();
    const live = [], same = [];
    let dying = 0;
    for (const v of this.voices) {
      if (v.dead) continue;
      if (v.dying) { dying++; continue; }
      if (v.end > t) { live.push(v); if (v.cat === cat) same.push(v); }
    }
    const cap = CAPS[cat] ?? 6;
    if (same.length >= cap) { const k = same[0]; k.kill(); if (live[0] === k) live.shift(); }
    else if (live.length >= MAX_VOICES) live[0].kill();
    if (dying >= MAX_DYING) { // too many fades in flight (spam): cut the oldest ones now
      for (const v of this.voices) { if (v.dying && !v.dead) { v.dispose(); if (--dying < MAX_DYING / 2) break; } }
    }
    const v = new Voice(this, cat, { ...o, t });
    this.voices.push(v);
    return v;
  }

  _sweep() {
    const now = this.ctx.currentTime;
    let w = 0;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      if (v.dead) continue;
      if (v.end + 0.1 < now) v.dispose();
      else this.voices[w++] = v;
    }
    this.voices.length = w;
  }

  // Lookahead event scheduler.
  _addTicker(next, fn) {
    const tk = { next, fn };
    this._tickers.add(tk);
    return tk;
  }

  _schedule(until) {
    const now = this.ctx.currentTime;
    for (const tk of this._tickers) {
      if (tk.next < now - 0.25) tk.next = now + 0.02; // recover from stalls
      let guard = 0;
      while (tk.next < until && guard++ < 200) {
        const n = tk.fn(tk.next);
        if (n == null) { this._tickers.delete(tk); break; }
        tk.next = Math.max(n, tk.next + 0.005);
      }
    }
  }

  // For offline rendering / tests: schedule all ticker events up to `until` s.
  _pump(until) { if (this.ctx) this._schedule(until); }

  // --------------------------------------------------------------- frame
  setListener(camera) { this._camera = camera; }

  update(dt = 0) {
    if (!this.ctx) return;
    try {
      this._lastUpdate = performance.now();
      const ctx = this.ctx, now = ctx.currentTime;
      const cam = this._camera;
      if (cam && cam.matrixWorld) {
        if (!this._v3) { this._v3 = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._f = new THREE.Vector3(); this._u = new THREE.Vector3(); }
        cam.getWorldPosition(this._v3);
        cam.getWorldQuaternion(this._q);
        const p = this._v3, f = this._f.set(0, 0, -1).applyQuaternion(this._q), u = this._u.set(0, 1, 0).applyQuaternion(this._q);
        this._lp.x = p.x; this._lp.y = p.y; this._lp.z = p.z;
        const L = ctx.listener;
        if (L.positionX) {
          L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
          L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z;
          L.upX.value = u.x; L.upY.value = u.y; L.upZ.value = u.z;
        } else {
          L.setPosition(p.x, p.y, p.z);
          L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
        }
      }
      this._sweep();
      // dispose faded-out beds / tension
      for (let i = this._beds.length - 1; i >= 0; i--) {
        const b = this._beds[i];
        if (now > b.killAt) { this._disposeBed(b); this._beds.splice(i, 1); }
      }
      if (this._tension && this._tension.offAt && now > this._tension.offAt) {
        this._disposeBed(this._tension); this._tension = null;
      }
      for (const k in this._rev) { // unhook faded-out convolvers so they stop processing
        const r = this._rev[k];
        if (r.connected && r.unhookAt && now > r.unhookAt) {
          try { this._revHP.disconnect(r.conv); } catch (e) { /* ok */ }
          r.connected = false; r.unhookAt = 0;
        }
      }
      if (ctx.state === 'running' || this._offline) this._schedule(now + 0.3);
    } catch (e) { this._err(e); }
  }

  setMasterVolume(v) {
    this._state.volume = clamp(+v || 0, 0, 1);
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this._state.volume, this.ctx.currentTime, 0.05);
  }

  // ----------------------------------------------------------------- reverb
  setReverb(preset, fade = 1.5) {
    if (!REVERBS[preset]) preset = 'lab';
    this._state.reverb = preset;
    if (!this.ctx) return;
    if (this._revActive === preset) return;
    const now = this.ctx.currentTime, tc = Math.max(0.01, fade / 3);
    const nxt = this._revSlot(preset);
    if (!nxt.connected) { this._revHP.connect(nxt.conv); nxt.connected = true; }
    nxt.unhookAt = 0;
    nxt.gain.gain.cancelScheduledValues(now);
    nxt.gain.gain.setTargetAtTime(1, now, tc);
    for (const k in this._rev) {
      if (k === preset) continue;
      const r = this._rev[k];
      if (!r.connected) continue;
      r.gain.gain.cancelScheduledValues(now);
      r.gain.gain.setTargetAtTime(0, now, tc);
      r.unhookAt = now + fade * 2 + REVERBS[k].len + 0.5;
    }
    this.revOut.gain.setTargetAtTime(REVERBS[preset].wet, now, tc);
    this._revActive = preset;
  }

  // -------------------------------------------------------------- ambience
  setAmbience(name, level = 1, fade = 2) {
    if (!['lab', 'labDark', 'construction', 'flooded', 'mine', 'purge', 'none'].includes(name)) name = 'none';
    this._state.amb = name === 'none' ? null : { name, level, fade };
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const tc = Math.max(0.01, fade / 3);
    if (this._bed && this._bed.name === name) {
      this._bed.out.gain.cancelScheduledValues(now);
      this._bed.out.gain.setTargetAtTime(level, now, tc);
      return;
    }
    if (this._bed) this._fadeBed(this._bed, fade);
    this._bed = null;
    if (name === 'none') return;
    const v = new Voice(this, 'bed', { bus: 'amb', loop: true, gain: 0, send: 0.12 });
    const bed = { name, v, out: v.out, tickers: [] };
    const t = now + 0.02;
    if (name === 'lab') this._bedLab(bed, t);
    else if (name === 'labDark') this._bedLabDark(bed, t);
    else if (name === 'flooded') this._bedFlooded(bed, t);
    else if (name === 'mine') this._bedMine(bed, t);
    else if (name === 'purge') this._bedPurge(bed, t);
    else this._bedConstruction(bed, t);
    v.out.gain.setValueAtTime(0, now);
    v.out.gain.setTargetAtTime(level, now, tc);
    this._bed = bed;
  }

  _fadeBed(bed, fade) {
    const now = this.ctx.currentTime;
    bed.out.gain.cancelScheduledValues(now);
    bed.out.gain.setValueAtTime(bed.out.gain.value, now);
    bed.out.gain.setTargetAtTime(0, now, Math.max(0.01, fade / 4));
    for (const tk of bed.tickers) this._tickers.delete(tk);
    bed.tickers.length = 0;
    bed.killAt = now + fade * 1.6 + 0.2;
    this._beds.push(bed);
  }

  _disposeBed(bed) {
    for (const tk of bed.tickers || []) this._tickers.delete(tk);
    bed.v.dispose();
  }

  _bedTicker(bed, first, fn) { bed.tickers.push(this._addTicker(first, fn)); }

  _bedLab(bed, t) {
    const v = bed.v, o = v.out;
    // HVAC: low duct rumble + broadband supply air + diffuser hiss
    const rum = v.noise('brownSt', t), rlp = v.filter('lowpass', 260, 0.6), rg = v.gain(0.1);
    v.chain(rum, rlp, rg, o);
    const air = v.noise('pinkSt', t), abp = v.filter('bandpass', 850, 0.55), ag = v.gain(0.035);
    v.chain(air, abp, ag, o);
    const hiss = v.noise('pinkSt', t), hhp = v.filter('highpass', 4200, 0.7), hg = v.gain(0.007);
    v.chain(hiss, hhp, hg, o);
    // slow airflow flutter
    const lfo = v.osc('sine', 0.11, t), lg = v.gain(0.009);
    lfo.connect(lg); lg.connect(ag.gain);
    // fan blade-pass whine
    const fan = v.osc('triangle', 173, t), fg = v.gain(0.0012), fw = v.osc('sine', 0.23, t), fwg = v.gain(1.6);
    fw.connect(fwg); fwg.connect(fan.frequency);
    v.chain(fan, fg, o);
    // mains hum (60 Hz + harmonics, 120 Hz dominant)
    const hum = v.osc(this._wave('hum'), 60, t), hlp = v.filter('lowpass', 1100, 0.7), hmg = v.gain(0.009);
    v.chain(hum, hlp, hmg, o);
    const hum2 = v.osc(this._wave('hum'), 60.07, t), hm2 = v.gain(0.45); // slow beating between two transformers
    v.chain(hum2, hm2, hlp);
    bed.hvac = { ag, rg, abp };
    // airflow variation
    this._bedTicker(bed, t + rand(2, 5), (tt) => {
      abp.frequency.setTargetAtTime(rand(650, 1100), tt, 2);
      rg.gain.setTargetAtTime(rand(0.08, 0.12), tt, 2.5);
      return tt + rand(3, 8);
    });
    // distant equipment ticks / relays / beeps / duct tinks
    this._bedTicker(bed, t + rand(1.5, 4), (tt) => {
      const r = Math.random();
      if (r < 0.35) this._ambRelay(tt, rand(-0.9, 0.9), rand(0.05, 0.12));
      else if (r < 0.65) this._ambTink(tt, rand(-1, 1), rand(0.04, 0.09));
      else if (r < 0.85) this._ambBeep(tt, rand(-1, 1));
      else this._ambWhirr(tt, rand(-1, 1));
      return tt + rand(2.5, 8);
    });
  }

  _bedLabDark(bed, t) {
    const v = bed.v, o = v.out;
    // near silence: very low room tone
    const rum = v.noise('brownSt', t), rlp = v.filter('lowpass', 95, 0.5), rg = v.gain(0.04);
    v.chain(rum, rlp, rg, o);
    const air = v.noise('pinkSt', t), abp = v.filter('bandpass', 420, 0.4), ag = v.gain(0.004);
    v.chain(air, abp, ag, o);
    // two leaks with their own rhythm and place
    for (let k = 0; k < 2; k++) {
      const period = rand(1.6, 3.8), pan = rand(-0.9, 0.9), f = rand(700, 1500), lvl = rand(0.05, 0.1);
      this._bedTicker(bed, t + rand(0.5, 3), (tt) => {
        this._drip(tt, pan, f * rand(0.96, 1.04), lvl * rand(0.7, 1.1), chance(0.6));
        return tt + period * rand(0.9, 1.12) + (chance(0.08) ? period : 0);
      });
    }
    // settling creaks
    this._bedTicker(bed, t + rand(3, 7), (tt) => {
      this._ambCreak(tt, rand(-1, 1), rand(0.06, 0.16), chance(0.5) ? 'wood' : 'metal');
      return tt + rand(5, 16);
    });
    // cooling ticks
    this._bedTicker(bed, t + rand(2, 5), (tt) => {
      const n = chance(0.3) ? irand(2, 3) : 1;
      for (let i = 0; i < n; i++) this._ambTink(tt + i * rand(0.15, 0.6), rand(-1, 1), rand(0.02, 0.05), true);
      return tt + rand(3, 11);
    });
    // something far away
    this._bedTicker(bed, t + rand(25, 50), (tt) => {
      this._ambThud(tt, rand(-1, 1), rand(0.08, 0.16));
      return tt + rand(35, 90);
    });
  }

  _bedConstruction(bed, t) {
    const v = bed.v, o = v.out;
    // wind body
    const w1 = v.noise('brownSt', t), wlp = v.filter('lowpass', 320, 0.7), wg = v.gain(0.1);
    v.chain(w1, wlp, wg, o);
    // wind through openings
    const w2 = v.noise('pinkSt', t), wbp = v.filter('bandpass', 650, 0.8), wbg = v.gain(0.03);
    v.chain(w2, wbp, wbg, o);
    // a faint whistle through a gap
    const w3 = v.noise('pink', t), wh = v.filter('bandpass', 880, 28), whg = v.gain(0.0);
    v.chain(w3, wh, whg, o);
    const whl = v.osc('sine', 0.17, t), whlg = v.gain(25);
    whl.connect(whlg); whlg.connect(wh.frequency);
    // plastic sheeting flutter: highpassed noise amplitude-modulated at 9-16 Hz
    const pl = v.noise('pinkSt', t), php = v.filter('highpass', 1600, 0.6), pbp = v.filter('peaking', 3500, 1, 4);
    const pam = v.gain(0), plg = v.gain(0.0);
    const flut = v.osc('sawtooth', 12, t), fdepth = v.gain(0.5), fjit = v.noise('brown', t, undefined, 0.05), fjg = v.gain(8);
    v.chain(fjit, fjg, flut.frequency);
    flut.connect(fdepth); fdepth.connect(pam.gain);
    pam.gain.value = 0.5;
    v.chain(pl, php, pbp, pam, plg, o);
    bed.wind = { wg, wbg, whg, plg, wlp, wbp };
    // gusts
    this._bedTicker(bed, t + 0.1, (tt) => {
      const g = Math.pow(Math.random(), 0.8), tc = rand(0.6, 1.8);
      bed.gust = g;
      wg.gain.setTargetAtTime(0.06 + 0.1 * g, tt, tc);
      wlp.frequency.setTargetAtTime(220 + 380 * g, tt, tc);
      wbg.gain.setTargetAtTime(0.012 + 0.045 * g, tt, tc);
      wbp.frequency.setTargetAtTime(450 + 600 * g, tt, tc);
      whg.gain.setTargetAtTime(g > 0.6 ? 0.012 * (g - 0.6) / 0.4 : 0, tt, tc);
      plg.gain.setTargetAtTime(0.002 + 0.016 * g * g, tt, tc * 0.7);
      return tt + rand(1.2, 4);
    });
    // tarp flaps
    this._bedTicker(bed, t + rand(2, 5), (tt) => {
      const g = bed.gust ?? 0.5;
      if (g > 0.35 || chance(0.3)) this._tarpFlap(tt, rand(-1, 1), 0.05 + 0.12 * g);
      return tt + rand(2.5, 9) * (1.3 - g * 0.6);
    });
    // distant metal creaks / scaffold clanks
    this._bedTicker(bed, t + rand(5, 10), (tt) => {
      if (chance(0.75)) this._ambCreak(tt, rand(-1, 1), rand(0.06, 0.13), 'metal', true);
      else this._ambClank(tt, rand(-1, 1), rand(0.05, 0.1));
      return tt + rand(7, 20);
    });
    // dripping into puddles
    for (let k = 0; k < 2; k++) {
      const period = rand(1.2, 3.2), pan = rand(-0.9, 0.9), f = rand(500, 1100), lvl = rand(0.05, 0.09);
      this._bedTicker(bed, t + rand(0.5, 3), (tt) => {
        this._drip(tt, pan, f * rand(0.95, 1.05), lvl * rand(0.7, 1.1), true);
        return tt + period * rand(0.85, 1.15);
      });
    }
  }

  // --- ambience event voices (non-positional, panned, mostly reverb)
  _drip(t, pan, f, lvl, bubble) {
    const v = this._voice('amb', { t, bus: 'amb', pan, gain: lvl, send: 0.7 });
    // impact tick
    const n = v.noise('white', t, t + 0.03), hp = v.filter('highpass', 2500, 0.7), g = v.gain(0);
    perc(g.gain, t, 0.35, 0.006);
    v.chain(n, hp, g, v.out);
    if (bubble) { // the resonant "plip": a bubble whose pitch rises as it closes
      const o = v.osc('sine', f, t + 0.002, t + 0.15), og = v.gain(0);
      o.frequency.setValueAtTime(f, t + 0.002);
      o.frequency.exponentialRampToValueAtTime(f * rand(1.6, 2.6), t + rand(0.03, 0.07));
      perc(og.gain, t + 0.002, 0.9, rand(0.04, 0.08), 0.003);
      v.chain(o, og, v.out);
    } else { // drip on hard surface: short bright plink
      const o = v.osc('sine', f * 2.6, t, t + 0.08), og = v.gain(0);
      perc(og.gain, t, 0.4, 0.03);
      v.chain(o, og, v.out);
    }
  }

  _ambRelay(t, pan, lvl) {
    const v = this._voice('amb', { t, bus: 'amb', pan, gain: lvl, send: 0.6 });
    const n = v.noise('white', t, t + 0.06), bp = v.filter('bandpass', rand(1800, 3200), 1.5), g = v.gain(0);
    v.chain(n, bp, g, v.out);
    perc(g.gain, t, 1, 0.008);
    const b = t + rand(0.004, 0.009);
    g.gain.setValueAtTime(0, b); g.gain.linearRampToValueAtTime(0.5, b + 0.001); g.gain.setTargetAtTime(0, b + 0.001, 0.002);
    const o = v.osc('sine', rand(350, 600), t, t + 0.05), og = v.gain(0);
    perc(og.gain, t, 0.4, 0.02);
    v.chain(o, og, v.out);
  }

  _ambTink(t, pan, lvl, cool) {
    const v = this._voice('amb', { t, bus: 'amb', pan, gain: lvl, send: 0.65 });
    const f = cool ? rand(2500, 4500) : rand(1200, 2600);
    v.modes(t, [f, f * rand(2.3, 2.9), f * rand(4.1, 5.3)], [cool ? 0.06 : 0.25, 0.12, 0.06], [0.6, 0.3, 0.15], v.out);
    const n = v.noise('white', t, t + 0.02), g = v.gain(0);
    perc(g.gain, t, 0.3, 0.004);
    v.chain(n, g, v.out);
  }

  _ambBeep(t, pan) {
    const v = this._voice('amb', { t, bus: 'amb', pan, gain: 0.015, send: 0.8 });
    const f = pick([2400, 2800, 3200, 1900]), n = irand(1, 3), lp = v.filter('lowpass', 4000, 0.7);
    lp.connect(v.out);
    for (let i = 0; i < n; i++) {
      const s = t + i * 0.22, o = v.osc('sine', f, s, s + 0.14), g = v.gain(0);
      ahr(g.gain, s, 0.005, 1, 0.08, 0.02);
      v.chain(o, g, lp);
    }
  }

  _ambWhirr(t, pan) { // distant centrifuge / pump spinning up and down
    const D = rand(4, 7);
    const v = this._voice('amb', { t, bus: 'amb', pan, gain: 0.03, send: 0.6 });
    const o = v.osc('triangle', 80, t, t + D), lp = v.filter('lowpass', 900, 0.8), g = v.gain(0), top = rand(300, 480);
    o.frequency.setValueAtTime(60, t);
    o.frequency.exponentialRampToValueAtTime(top, t + D * 0.45);
    o.frequency.setValueAtTime(top, t + D * 0.55);
    o.frequency.exponentialRampToValueAtTime(70, t + D);
    pts(g.gain, t, [[0, 0], [D * 0.3, 1], [D * 0.6, 0.8], [D, 0]]);
    v.chain(o, lp, g, v.out);
  }

  _ambCreak(t, pan, lvl, mat, far) {
    const D = rand(0.6, 1.6);
    const v = this._voice('amb', { t, bus: 'amb', pan, gain: lvl, send: far ? 0.9 : 0.6 });
    const s = v.buffer(pick(this.buf.creak), t, t + D, mat === 'metal' ? rand(0.5, 0.9) : rand(0.8, 1.4), true, rand(0, 1.2));
    const g = v.gain(0);
    let dest = v.out;
    if (far) { dest = v.filter('lowpass', 1500, 0.7); dest.connect(v.out); }
    pts(g.gain, t, [[0, 0], [D * 0.25, 1], [D * 0.75, 0.8], [D, 0]]);
    s.connect(g);
    if (mat === 'metal') {
      const f = rand(170, 380);
      for (const [r, q, a] of [[1, 18, 1], [2.27, 22, 0.6], [3.9, 25, 0.35]]) {
        const bp = v.filter('bandpass', f * r, q), bg = v.gain(a * 3);
        v.chain(g, bp, bg, dest);
      }
    } else {
      const f = rand(300, 700);
      for (const [r, q, a] of [[1, 6, 1], [2.1, 8, 0.5]]) {
        const bp = v.filter('bandpass', f * r, q), bg = v.gain(a * 2);
        v.chain(g, bp, bg, dest);
      }
    }
  }

  _ambThud(t, pan, lvl) { // far away impact — something heavy, somewhere else
    const v = this._voice('amb', { t, bus: 'amb', pan, gain: lvl, send: 0.9 });
    const o = v.osc('sine', 60, t, t + 0.8), g = v.gain(0);
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    perc(g.gain, t, 1, 0.45, 0.004);
    v.chain(o, g, v.out);
    const n = v.noise('brown', t, t + 0.6), lp = v.filter('lowpass', 300, 0.7), ng = v.gain(0);
    perc(ng.gain, t, 1.2, 0.3, 0.004);
    v.chain(n, lp, ng, v.out);
    if (chance(0.5)) { // a second blow
      const t2 = t + rand(0.5, 1.1);
      const o2 = v.osc('sine', 60, t2, t2 + 0.8), g2 = v.gain(0);
      o2.frequency.setValueAtTime(65, t2); o2.frequency.exponentialRampToValueAtTime(38, t2 + 0.2);
      perc(g2.gain, t2, 0.7, 0.4, 0.004);
      v.chain(o2, g2, v.out);
    }
  }

  _ambClank(t, pan, lvl) {
    const v = this._voice('amb', { t, bus: 'amb', pan, gain: lvl, send: 0.9 });
    const f = rand(180, 320), lp = v.filter('lowpass', 2500, 0.7);
    lp.connect(v.out);
    v.modes(t, [f, f * 1.59, f * 2.14, f * 2.92, f * 4.15], [1.2, 0.9, 0.7, 0.5, 0.3], [0.6, 0.4, 0.3, 0.2, 0.1], lp);
    const n = v.noise('white', t, t + 0.05), bp = v.filter('bandpass', 2000, 1), g = v.gain(0);
    perc(g.gain, t, 0.6, 0.02);
    v.chain(n, bp, g, lp);
  }

  _tarpFlap(t, pan, lvl) {
    const v = this._voice('amb', { t, bus: 'amb', pan, gain: lvl, send: 0.4 });
    const n = v.noise('white', t, t + 1.5), bp = v.filter('bandpass', rand(500, 900), 0.8), g = v.gain(0);
    const c = v.buffer(this.buf.crackle, t, t + 1.5, rand(0.8, 1.3), true, rand(0, 2)), chp = v.filter('highpass', 2200, 0.7), cg = v.gain(0);
    v.chain(n, bp, g, v.out);
    v.chain(c, chp, cg, v.out);
    let s = t;
    const k = irand(2, 6);
    for (let i = 0; i < k; i++) {
      const a = rand(0.4, 1) * (i === 0 ? 1 : 0.7);
      perc(g.gain, s, a, rand(0.03, 0.07), 0.002);
      perc(cg.gain, s, a * 0.4, rand(0.05, 0.1), 0.002);
      s += rand(0.07, 0.2);
    }
    v.until(s + 0.2);
  }

  // ---------------------------------------------------------------- music
  setTension(x) {
    x = clamp(+x || 0, 0, 1);
    this._state.tension = x;
    if (!this.ctx) return;
    if (x > 0.001 && !this._tension) this._tension = this._buildTension();
    const T = this._tension;
    if (!T) return;
    const t = this.ctx.currentTime, tc = 1.3;
    if (T.lastSet != null && Math.abs(x - T.x) < 0.005 && (x > 0.001) === (T.x > 0.001) && t - T.lastSet < 0.25) return; // per-frame callers
    T.lastSet = t;
    T.x = x;
    T.offAt = x <= 0.001 ? t + 9 : 0;
    if (x > 0.001 && T.out.gain.value < 0.999) { // restore after stopAll()
      T.out.gain.cancelScheduledValues(t); T.out.gain.setValueAtTime(T.out.gain.value, t); T.out.gain.setTargetAtTime(1, t, 0.3);
    }
    T.gDrone.gain.setTargetAtTime(0.04 * smooth(0, 0.25, x) * (0.6 + 0.4 * x), t, tc);
    T.droneLP.frequency.setTargetAtTime(80 + 520 * x * x, t, tc);
    T.gCluster.gain.setTargetAtTime(0.017 * smooth(0.12, 0.6, x) + 0.013 * smooth(0.6, 1, x), t, tc);
    T.clusterLP.frequency.setTargetAtTime(350 + 3200 * Math.pow(x, 1.6), t, tc);
    T.gHigh.gain.setTargetAtTime(0.004 * smooth(0.55, 1, x), t, tc);
    T.gAir.gain.setTargetAtTime(0.02 * smooth(0.2, 0.9, x), t, tc);
    T.vib.gain.setTargetAtTime(6 + 22 * x, t, tc);
  }

  _buildTension() {
    const v = new Voice(this, 'tension', { bus: 'music', loop: true, gain: 1, send: 0.45 });
    const t = this.ctx.currentTime + 0.02;
    const T = { v, out: v.out, tickers: [], x: 0, offAt: 0 };
    // shared slow vibrato (cents) for all bowed voices
    const vibO = v.osc('sine', 4.7, t), vib = T.vib = v.gain(6);
    vibO.connect(vib);
    // low drone: E1 against F1 (minor second), saws through a resonant lowpass
    const droneLP = T.droneLP = v.filter('lowpass', 80, 2.5), gDrone = T.gDrone = v.gain(0);
    for (const f of [41.2, 43.65, 41.2 * 0.5]) {
      for (const dt of [-6, 7]) {
        if (f < 30 && dt > 0) continue;
        const o = v.osc(f < 30 ? 'triangle' : 'sawtooth', f, t);
        o.detune.value = dt;
        o.connect(droneLP);
      }
    }
    const dl = v.osc('sine', 0.07, t), dlg = v.gain(40);
    dl.connect(dlg); dlg.connect(droneLP.frequency);
    v.chain(droneLP, gDrone, v.out);
    // string-like cluster: B2 C3 F3 F#3 C4, two detuned saws each, slow swells
    const clusterLP = T.clusterLP = v.filter('lowpass', 350, 0.9);
    const body1 = v.filter('peaking', 320, 1.2, 4), body2 = v.filter('peaking', 1100, 1.5, 3), shelf = v.filter('highshelf', 4500, 0.7, -9);
    const gCluster = T.gCluster = v.gain(0);
    v.chain(clusterLP, body1, body2, shelf, gCluster, v.out);
    for (const f of [123.47, 130.81, 174.61, 185.0, 261.63]) {
      const ng = v.gain(0.5);
      const swell = v.osc('sine', rand(0.03, 0.11), t), sg = v.gain(0.45);
      swell.connect(sg); sg.connect(ng.gain);
      for (const dt of [-8, 9]) {
        const o = v.osc('sawtooth', f, t);
        o.detune.value = dt + rand(-3, 3);
        vib.connect(o.detune);
        o.connect(ng);
      }
      ng.connect(clusterLP);
    }
    // high sul-ponticello minor second with bowed tremolo
    const hHP = v.filter('highpass', 900, 0.7), hLP = v.filter('lowpass', 4200, 0.7), trem = v.gain(0.5), gHigh = T.gHigh = v.gain(0);
    const tr = v.osc('sine', 11, t), trg = v.gain(0.5);
    tr.connect(trg); trg.connect(trem.gain);
    for (const f of [1318.5, 1396.9]) {
      const o = v.osc('sawtooth', f, t);
      vib.connect(o.detune);
      o.connect(hHP);
    }
    v.chain(hHP, hLP, trem, gHigh, v.out);
    // airy noise bed
    const air = v.noise('pinkSt', t), abp = v.filter('bandpass', 260, 0.9), gAir = T.gAir = v.gain(0);
    v.chain(air, abp, gAir, v.out);
    // sub pulses
    T.tickers.push(this._addTicker(t + 1, (tt) => {
      const x = T.x;
      if (x > 0.35) this._subPulse(tt, 0.3 * smooth(0.35, 1, x));
      return tt + (x > 0.35 ? 2.6 - 1.8 * x : 1) * rand(0.95, 1.05);
    }));
    // col legno ticks and bow scrapes at high tension
    T.tickers.push(this._addTicker(t + 2, (tt) => {
      const x = T.x;
      if (x > 0.6) {
        if (chance(0.75)) this._colLegno(tt, irand(1, 4), 0.25 * smooth(0.6, 1, x));
        else this._bowScrape(tt, 0.08 * smooth(0.6, 1, x));
      }
      return tt + rand(0.8, 3.2) * (1.6 - x);
    }));
    return T;
  }

  _subPulse(t, lvl) {
    const v = this._voice('stinger', { t, bus: 'music', gain: lvl, send: 0.1 });
    const o = v.osc('sine', 50, t, t + 0.9), g = v.gain(0);
    o.frequency.setValueAtTime(62, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.35);
    perc(g.gain, t, 1, 0.55, 0.01);
    v.chain(o, g, v.out);
  }

  _colLegno(t, n, lvl) {
    const v = this._voice('stinger', { t, bus: 'music', pan: rand(-0.7, 0.7), gain: lvl, send: 0.5 });
    const src = v.noise('white', t, t + n * 0.2 + 0.2), bp = v.filter('bandpass', 2000, 9), g = v.gain(0);
    const o = v.osc('triangle', 600, t, t + n * 0.2 + 0.2), og = v.gain(0);
    v.chain(src, bp, g, v.out);
    v.chain(o, og, v.out);
    let s = t;
    for (let i = 0; i < n; i++) {
      const f = rand(1200, 3200);
      bp.frequency.setValueAtTime(f, s);
      o.frequency.setValueAtTime(f / rand(2.5, 4), s);
      perc(g.gain, s, rand(1.5, 3), 0.03, 0.001);
      perc(og.gain, s, 0.3, 0.04, 0.001);
      s += rand(0.06, 0.18);
    }
    v.until(s + 0.1);
  }

  _bowScrape(t, lvl) {
    const D = rand(0.8, 1.8);
    const v = this._voice('stinger', { t, bus: 'music', pan: rand(-0.6, 0.6), gain: lvl, send: 0.6 });
    const n = v.noise('white', t, t + D), bp = v.filter('bandpass', rand(700, 1600), 3), am = v.gain(0.5), g = v.gain(0);
    const r = v.osc('sawtooth', rand(25, 45), t, t + D), rg = v.gain(0.5);
    r.connect(rg); rg.connect(am.gain);
    pts(g.gain, t, [[0, 0], [D * 0.3, 1], [D * 0.8, 0.7], [D, 0]]);
    v.chain(n, bp, am, g, v.out);
  }

  stinger(kind = 'hit') {
    const t = this._now();
    if (kind === 'reveal') {
      const D = 2.6;
      const v = this._voice('stinger', { t, bus: 'music', gain: 0.55, send: 0.6 });
      const lp = v.filter('lowpass', 300, 1.5), g = v.gain(0), sh = v.shaper(1.8);
      lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(6000, t + D);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + D - 0.02);
      g.gain.linearRampToValueAtTime(0, t + D + 0.012);
      v.chain(lp, sh, g, v.out);
      for (const f of [220, 233.1, 311.1, 329.6, 466.2, 493.9]) {
        const o = v.osc('sawtooth', f, t, t + D + 0.05);
        o.detune.setValueAtTime(rand(-10, 10), t);
        o.detune.linearRampToValueAtTime(cents(rand(1, 4)), t + D);
        o.connect(lp);
      }
      const n = v.noise('white', t, t + D + 0.05), nbp = v.filter('bandpass', 400, 1.5), ng = v.gain(0.5);
      nbp.frequency.setValueAtTime(400, t); nbp.frequency.exponentialRampToValueAtTime(9000, t + D);
      v.chain(n, nbp, ng, g);
      const sub = v.osc('sine', 40, t, t + D + 0.05), sg = v.gain(0.8);
      sub.frequency.setValueAtTime(38, t); sub.frequency.linearRampToValueAtTime(58, t + D);
      v.chain(sub, sg, g);
      return;
    }
    if (kind === 'low') {
      const v = this._voice('stinger', { t, bus: 'music', gain: 0.7, send: 0.4 });
      const o = v.osc('sine', 58, t, t + 4), g = v.gain(0), sh = v.shaper(2.2), lp = v.filter('lowpass', 400, 0.7);
      o.frequency.setValueAtTime(62, t); o.frequency.exponentialRampToValueAtTime(26, t + 1.8);
      perc(g.gain, t, 1, 3, 0.01);
      v.chain(o, g, sh, lp, v.out);
      const n = v.noise('brown', t, t + 3.5), nlp = v.filter('lowpass', 140, 0.7), ng = v.gain(0);
      perc(ng.gain, t, 1.2, 2.6, 0.02);
      v.chain(n, nlp, ng, v.out);
      return;
    }
    // 'hit': impact + screech
    const v = this._voice('stinger', { t, bus: 'music', gain: 0.75, send: 0.5 });
    const o = v.osc('sine', 70, t, t + 2), og = v.gain(0);
    o.frequency.setValueAtTime(75, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.4);
    perc(og.gain, t, 0.9, 1.1, 0.003);
    v.chain(o, og, v.out);
    const nb = v.noise('brown', t, t + 1), nlp = v.filter('lowpass', 450, 0.7), nbg = v.gain(0);
    perc(nbg.gain, t, 1, 0.35, 0.002);
    v.chain(nb, nlp, nbg, v.out);
    const nw = v.noise('white', t, t + 0.3), nhp = v.filter('highpass', 2000, 0.7), nwg = v.gain(0);
    perc(nwg.gain, t, 0.4, 0.09, 0.001);
    v.chain(nw, nhp, nwg, v.out);
    // screech: high saws gliding down, fast vibrato, bandpassed and driven
    const lfo = v.osc('sine', 13, t, t + 2.2), lg = v.gain(35);
    lfo.connect(lg);
    const bp = v.filter('bandpass', 2400, 0.8), hp = v.filter('highpass', 700, 0.7), sh = v.shaper(2.5), sg = v.gain(0);
    perc(sg.gain, t + 0.005, 0.22, 1.7, 0.01);
    v.chain(bp, hp, sh, sg, v.out);
    for (let i = 0; i < 5; i++) {
      const f = rand(1100, 2900), s = v.osc('sawtooth', f, t, t + 2.2);
      s.frequency.setValueAtTime(f, t); s.frequency.exponentialRampToValueAtTime(f * rand(0.88, 0.95), t + 1.6);
      lg.connect(s.detune);
      s.connect(bp);
    }
    const nm = v.noise('white', t, t + 1.6), mg = v.gain(0);
    perc(mg.gain, t, 0.35, 1.2, 0.005);
    nm.connect(mg);
    for (const f of [2100, 3300, 4700]) { const b = v.filter('bandpass', f * rand(0.95, 1.05), 30), bg = v.gain(2); v.chain(mg, b, bg, v.out); }
  }

  heartbeat(rate = 0) {
    rate = clamp(+rate || 0, 0, 220);
    this._state.heart = rate;
    if (!this.ctx) return;
    if (rate <= 0) { if (this._heart) { this._tickers.delete(this._heart); this._heart = null; } return; }
    this._heartRate = rate;
    if (this._heart) return;
    this._heart = this._addTicker(this.ctx.currentTime + 0.05, (tt) => {
      const r = this._heartRate;
      if (!r) return null;
      this._beat(tt, r);
      return tt + (60 / r) * rand(0.97, 1.03);
    });
  }

  _beat(t, rate) {
    const lvl = 0.25 + 0.2 * smooth(60, 160, rate);
    const v = this._voice('heart', { t, bus: 'music', gain: lvl, send: 0.02 });
    const lp = v.filter('lowpass', 140, 0.7), body = v.filter('peaking', 55, 1.5, 6);
    v.chain(lp, body, v.out);
    const gap = clamp(18 / rate, 0.12, 0.3);
    for (const [s, f, a] of [[t, 58, 1], [t + gap, 68, 0.6]]) {
      const o = v.osc('sine', f, s, s + 0.35), g = v.gain(0);
      o.frequency.setValueAtTime(f * 1.3, s); o.frequency.exponentialRampToValueAtTime(f * 0.7, s + 0.08);
      perc(g.gain, s, a, 0.16, 0.006);
      v.chain(o, g, lp);
      const n = v.noise('brown', s, s + 0.2), ng = v.gain(0);
      perc(ng.gain, s, a * 0.9, 0.08, 0.004);
      v.chain(n, ng, lp);
    }
  }

  // --------------------------------------------------------------- facility
  alarm(on, kind = 'klaxon') {
    kind = kind === 'breach' ? 'breach' : 'klaxon';
    this._state.alarm = on ? kind : null;
    if (!this.ctx) return;
    if (this._alarm && (!on || this._alarm.kind !== kind)) {
      const A = this._alarm;
      this._tickers.delete(A.tk);
      A.v.kill(0.35);
      this.voices.push(A.v); // let the sweeper dispose it
      this._alarm = null;
    }
    if (!on || this._alarm) return;
    const t = this.ctx.currentTime + 0.02;
    const v = new Voice(this, 'alarm', { bus: 'sfx', loop: true, gain: 0.1, send: 0.75 });
    const A = { kind, v };
    const o1 = v.osc(this._wave('reed'), 400, t), o2 = v.osc('square', 400, t);
    o2.detune.value = 9;
    const o2g = v.gain(0.35);
    o2.connect(o2g);
    const bp = v.filter('bandpass', kind === 'breach' ? 1500 : 950, 0.9), pk = v.filter('peaking', 2300, 2, 5);
    const sh = v.shaper(2.5), gate = v.gain(0), lp = v.filter('lowpass', 5000, 0.7);
    o1.connect(bp); o2g.connect(bp);
    v.chain(bp, pk, sh, gate, lp, v.out);
    // a second, distant horn elsewhere in the building
    const dl = v.delay(kind === 'breach' ? 0.17 : 0.12), dlg = v.gain(0.35), dlp = v.filter('lowpass', 1800, 0.7);
    v.chain(lp, dl, dlp, dlg, v.out);
    A.tk = this._addTicker(t, (tt) => {
      if (kind === 'klaxon') {
        const P = 2.1;
        for (const o of [o1, o2]) {
          o.frequency.setValueAtTime(300, tt);
          o.frequency.exponentialRampToValueAtTime(820, tt + 1.35);
          o.frequency.setValueAtTime(820, tt + 1.6);
          o.frequency.exponentialRampToValueAtTime(700, tt + 1.85);
        }
        pts(gate.gain, tt, [[0, 0], [0.06, 1], [1.55, 1], [1.85, 0]]);
        return tt + P;
      }
      // breach: urgent two-tone hi-lo
      const step = 0.27;
      for (let i = 0; i < 2; i++) {
        const s = tt + i * step, f = i ? 740 : 960;
        for (const o of [o1, o2]) o.frequency.setValueAtTime(f, s);
        pts(gate.gain, s, [[0, 0], [0.012, 1], [step - 0.02, 1], [step - 0.004, 0]]);
      }
      return tt + step * 2;
    });
    this._alarm = A;
  }

  pa(kind = 'chime') {
    const t = this._now();
    const seq = kind === 'chimeUp' ? [523.25, 659.25, 783.99] : kind === 'chimeDown' ? [783.99, 659.25, 523.25] : [659.25, 523.25];
    const v = this._voice('ui', { t, bus: 'ui', gain: 0.2, send: 0.7 });
    // ceiling PA speaker colouration
    const hp = v.filter('highpass', 280, 0.7), lp = v.filter('lowpass', 5200, 0.7), pk = v.filter('peaking', 1800, 1.2, 4), sh = v.shaper(1.4);
    v.chain(hp, pk, sh, lp, v.out);
    seq.forEach((f, i) => {
      const s = t + i * 0.62;
      v.modes(s, [f, f * 2.0, f * 3.0, f * 4.16, f * 5.4], [2.0, 1.2, 0.6, 0.35, 0.2], [1, 0.32, 0.12, 0.06, 0.03], hp, 0.004);
    });
  }

  // Radio / intercom transmission: squelch, garbled voice babble, squelch tail.
  radio(durationSec = 2, { speaker = 'supervisor' } = {}) {
    const D = Math.max(0.4, +durationSec || 2);
    const t = this._now();
    const h = hashStr(String(speaker));
    const intercom = /intercom|pa\b|speaker/i.test(speaker);
    const f0 = speaker === 'supervisor' ? 104 : 90 + h * 110;
    const fscale = speaker === 'supervisor' ? 1 : 0.95 + h * 0.2;
    // kill an older transmission (resolves its promise)
    const v = this._voice('radio', { t, bus: 'ui', gain: 0.36, send: intercom ? 0.6 : 0.08 });
    const vStart = t + 0.09, vEnd = t + D - 0.16;

    // --- radio channel: band-limit, presence peak, distortion
    const chIn = v.gain(1);
    const hp1 = v.filter('highpass', 380, 0.7), hp2 = v.filter('highpass', 380, 0.7);
    const lp1 = v.filter('lowpass', 2900, 0.7), lp2 = v.filter('lowpass', 2900, 0.7);
    const pk = v.filter('peaking', 1700, 1.1, 6), sh = v.shaper(4), drop = v.gain(1);
    v.chain(chIn, hp1, hp2, pk, sh, lp1, lp2, drop, v.out);

    // --- squelch on: click + noise burst + carrier
    const sq = v.noise('white', t, t + 0.12), sqbp = v.filter('bandpass', 2500, 0.6), sqg = v.gain(0);
    pts(sqg.gain, t, [[0, 0], [0.002, 0.9], [0.03, 0.4], [0.075, 0]]);
    v.chain(sq, sqbp, sqg, v.out);
    const clk = v.osc('square', 60, t, t + 0.012), cg = v.gain(0);
    perc(cg.gain, t, 0.5, 0.008, 0.0005);
    v.chain(clk, cg, chIn);

    // background hiss & static crackle over the whole transmission
    const hiss = v.noise('white', t + 0.05, vEnd + 0.05), hbp = v.filter('bandpass', 2000, 0.5), hg = v.gain(0);
    pts(hg.gain, t + 0.05, [[0, 0], [0.02, 0.06], [D - 0.24, 0.06], [D - 0.2, 0]]);
    v.chain(hiss, hbp, hg, chIn);
    const cr = v.buffer(this.buf.crackle, t + 0.05, vEnd + 0.05, rand(0.7, 1.2), true, rand(0, 2)), crg = v.gain(0);
    pts(crg.gain, t + 0.05, [[0, 0], [0.02, 0.14], [D - 0.24, 0.14], [D - 0.2, 0]]);
    v.chain(cr, crg, chIn);

    // --- voice: glottal source + aspiration -> syllable envelope -> formants
    const src = v.osc(this._wave('glottal'), f0, vStart, vEnd + 0.05);
    const jit = v.noise('brown', vStart, vEnd + 0.05, 0.3), jg = v.gain(60);
    v.chain(jit, jg, src.detune);
    const asp = v.noise('white', vStart, vEnd + 0.05), aspf = v.filter('bandpass', 1600, 0.7), aspg = v.gain(0.18);
    v.chain(asp, aspf, aspg);
    const env = v.gain(0);
    src.connect(env); aspg.connect(env);
    const F = v.formants(env, fscale, 'uh', [7, 9, 11], [1, 0.7, 0.4]);
    const fg = v.gain(0.9);
    v.chain(F.out, fg, chIn);
    // fricatives / plosives (bypass formants)
    const fr = v.noise('white', vStart, vEnd + 0.05), frbp = v.filter('bandpass', 5000, 1.5), frg = v.gain(0);
    v.chain(fr, frbp, frg, chIn);

    let s = vStart, phrase = 0;
    const E = env.gain;
    E.setValueAtTime(0, s);
    while (s < vEnd - 0.12) {
      const nsyl = irand(1, 3);
      for (let k = 0; k < nsyl && s < vEnd - 0.12; k++) {
        const sd = rand(0.1, 0.23);
        const vowel = pick(VOWEL_KEYS);
        const cons = Math.random();
        let vs = s;
        if (cons < 0.3) { // plosive
          frbp.frequency.setValueAtTime(rand(1500, 3500), s);
          perc(frg.gain, s, rand(0.3, 0.6), 0.025, 0.001);
          vs = s + 0.025;
        } else if (cons < 0.55) { // fricative s / sh / f
          frbp.frequency.setValueAtTime(pick([5500, 3200, 6500]), s);
          pts(frg.gain, s, [[0, 0], [0.04, rand(0.2, 0.4)], [0.07, 0]]);
          vs = s + 0.065;
        } else if (cons < 0.75) { // nasal / liquid onset: start from a closed vowel
          F.set(pick(['u', 'i', 'er']), s, 0.015);
        }
        const pk2 = rand(0.55, 1);
        const sylEnd = vs + sd;
        // intonation: declination across phrase + accent on first syllable
        const fNow = f0 * (1.12 - 0.18 * phrase) * (k === 0 ? rand(1.04, 1.15) : rand(0.92, 1.03));
        src.frequency.setTargetAtTime(fNow, vs, 0.04);
        F.set(vowel, vs + 0.01, 0.035);
        E.linearRampToValueAtTime(pk2, vs + 0.03);
        E.linearRampToValueAtTime(pk2 * 0.7, sylEnd - 0.03);
        E.linearRampToValueAtTime(k === nsyl - 1 ? 0 : 0.12, sylEnd);
        s = sylEnd;
        phrase = Math.min(1, phrase + 0.08);
      }
      // word gap / phrase pause
      if (chance(0.18)) { s += rand(0.22, 0.42); phrase = 0; } else s += rand(0.03, 0.1);
      E.setValueAtTime(0, s);
    }
    E.setValueAtTime(0, vEnd);
    // garble: a few signal dropouts / fades
    const nd = Math.floor(D / 1.5), drops = [];
    for (let i = 0; i < nd; i++) drops.push(rand(vStart + 0.2, Math.max(vStart + 0.25, vEnd - 0.2)));
    drops.sort((a, b) => a - b);
    let lastDrop = 0;
    for (const ds of drops) {
      if (ds < lastDrop + 0.15) continue;
      pts(drop.gain, ds, [[0, 1], [0.01, rand(0.1, 0.4)], [rand(0.04, 0.09), rand(0.1, 0.4)], [0.1, 1]]);
      lastDrop = ds;
    }
    // --- squelch off: "kssht" tail
    const te = t + D - 0.15;
    const so = v.noise('white', te, te + 0.2), sobp = v.filter('bandpass', 3000, 0.5), sog = v.gain(0);
    pts(sog.gain, te, [[0, 0], [0.004, 0.55], [0.09, 0.3], [0.14, 0]]);
    v.chain(so, sobp, sog, v.out);
    v.until(t + D);
    return new Promise((resolve) => {
      let done = false;
      const fin = () => { if (!done) { done = true; resolve(); } };
      v.onDispose = fin;
      so.onended = fin;
      if (!this._offline) setTimeout(fin, (D + 0.6) * 1000);
    });
  }

  beep(kind = 'click') {
    const t = this._now();
    const v = this._voice('ui', { t, bus: 'ui', gain: 0.3, send: 0.12 });
    const tone = (f, s, d, a = 1, type = 'sine', dest = v.out) => {
      const o = v.osc(type, f, s, s + d + 0.05), g = v.gain(0);
      ahr(g.gain, s, 0.004, a, d - 0.01, 0.02);
      v.chain(o, g, dest);
      return o;
    };
    if (kind === 'ok') {
      const lp = v.filter('lowpass', 6000, 0.7);
      lp.connect(v.out);
      tone(1318.5, t, 0.08, 0.7, 'triangle', lp);
      tone(1975.5, t + 0.1, 0.13, 0.7, 'triangle', lp);
    } else if (kind === 'deny') {
      const lp = v.filter('lowpass', 1400, 0.8);
      lp.connect(v.out);
      for (let i = 0; i < 2; i++) {
        tone(180, t + i * 0.2, 0.15, 0.6, 'square', lp);
        tone(191, t + i * 0.2, 0.15, 0.5, 'sawtooth', lp);
      }
    } else if (kind === 'terminal') {
      tone(rand(2100, 2300), t, 0.04, 0.5);
    } else if (kind === 'console') {
      const n = irand(3, 5);
      for (let i = 0; i < n; i++) tone(pick([880, 1174.7, 1318.5, 1568, 1760, 2093]), t + i * 0.075, 0.06, 0.45, 'square');
      v.out.gain.value = 0.12;
    } else if (kind === 'charge') {
      const o = tone(400, t, 0.8, 0.4, 'triangle');
      o.frequency.setValueAtTime(400, t); o.frequency.exponentialRampToValueAtTime(2000, t + 0.75);
      tone(2637, t + 0.82, 0.12, 0.5);
    } else { // click: a mechanical button / switch
      v.out.gain.value = 0.9;
      const n = v.noise('white', t, t + 0.04), bp = v.filter('bandpass', 3200, 1.2), g = v.gain(0);
      perc(g.gain, t, 1, 0.006, 0.0005);
      v.chain(n, bp, g, v.out);
      const o = v.osc('sine', 1100, t, t + 0.04), og = v.gain(0);
      perc(og.gain, t, 0.3, 0.012);
      v.chain(o, og, v.out);
    }
  }

  _relays(v, t0, span, n, dest, lvl = 1) {
    const sp = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    const n0 = v.noise('white', t0, t0 + span + 0.2), bp = v.filter('bandpass', 2600, 1.4), g = v.gain(0);
    const th = v.osc('sine', 420, t0, t0 + span + 0.2), thg = v.gain(0);
    v.chain(n0, bp, g); v.chain(th, thg);
    if (sp) { v.nodes.push(sp); g.connect(sp); thg.connect(sp); sp.connect(dest); } else { g.connect(dest); thg.connect(dest); }
    const times = [];
    for (let i = 0; i < n; i++) times.push(t0 + rand(0, span));
    times.sort((a, b) => a - b);
    let last = -1;
    for (let s of times) {
      if (s < last + 0.03) s = last + 0.03;
      last = s;
      if (sp) sp.pan.setValueAtTime(rand(-0.9, 0.9), s - 0.002);
      bp.frequency.setValueAtTime(rand(1800, 3800), s);
      const a = rand(0.4, 1) * lvl;
      perc(g.gain, s, a, 0.006, 0.0005);
      const b = s + rand(0.004, 0.008); // contact bounce
      g.gain.setValueAtTime(0, b); g.gain.linearRampToValueAtTime(a * 0.5, b + 0.0008); g.gain.setTargetAtTime(0, b + 0.0008, 0.0015);
      perc(thg.gain, s, a * 0.35, 0.02, 0.001);
    }
  }

  _clunk(v, t, dest, lvl = 1) { // contactor / transformer clunk
    const o = v.osc('sine', 55, t, t + 0.8), og = v.gain(0);
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    perc(og.gain, t, 0.9 * lvl, 0.4, 0.002);
    v.chain(o, og, dest);
    const n = v.noise('brown', t, t + 0.5), lp = v.filter('lowpass', 500, 0.7), ng = v.gain(0);
    perc(ng.gain, t, 1.0 * lvl, 0.15, 0.001);
    v.chain(n, lp, ng, dest);
    const f = rand(180, 240);
    v.modes(t, [f, f * 2.21, f * 3.73, f * 5.3], [0.5, 0.3, 0.2, 0.12], [0.25 * lvl, 0.18 * lvl, 0.1 * lvl, 0.06 * lvl], dest);
  }

  powerDown() {
    const t = this._now();
    const v = this._voice('power', { t, bus: 'sfx', gain: 0.8, send: 0.5 });
    this._clunk(v, t, v.out, 1);
    // hum winding down
    const hum = v.osc(this._wave('hum'), 60, t, t + 3.6), hlp = v.filter('lowpass', 1500, 0.7), hg = v.gain(0);
    hum.frequency.setValueAtTime(60, t);
    hum.frequency.exponentialRampToValueAtTime(11, t + 3.3);
    pts(hg.gain, t, [[0, 0.22], [0.4, 0.17], [2.4, 0.06], [3.4, 0]]);
    v.chain(hum, hlp, hg, v.out);
    // fans spinning down
    const fan = v.osc('triangle', 700, t, t + 4.2), fg = v.gain(0), flp = v.filter('lowpass', 2500, 0.7);
    fan.frequency.setValueAtTime(700, t); fan.frequency.exponentialRampToValueAtTime(60, t + 4);
    pts(fg.gain, t, [[0, 0.03], [3, 0.012], [4.1, 0]]);
    v.chain(fan, flp, fg, v.out);
    const air = v.noise('pink', t, t + 3.5), abp = v.filter('bandpass', 900, 0.6), ag = v.gain(0);
    abp.frequency.setValueAtTime(900, t); abp.frequency.exponentialRampToValueAtTime(200, t + 3.2);
    pts(ag.gain, t, [[0, 0.25], [3.3, 0]]);
    v.chain(air, abp, ag, v.out);
    // relays dropping out across the wing
    this._relays(v, t + 0.08, 1.7, irand(6, 10), v.out, 0.45);
    // electrical arc/zap at the cutoff
    const z = v.noise('white', t, t + 0.12), zhp = v.filter('highpass', 3000, 0.7), zg = v.gain(0), zam = v.osc('square', 120, t, t + 0.12), zamg = v.gain(0.5);
    zam.connect(zamg); zamg.connect(zg.gain);
    pts(zg.gain, t, [[0, 0], [0.003, 0.3], [0.1, 0]]);
    v.chain(z, zhp, zg, v.out);
    v.until(t + 4.3);
  }

  powerUp() {
    const t = this._now();
    const v = this._voice('power', { t, bus: 'sfx', gain: 0.8, send: 0.5 });
    this._clunk(v, t, v.out, 0.9);
    this._relays(v, t + 0.05, 1.2, irand(5, 8), v.out, 0.45);
    const hum = v.osc(this._wave('hum'), 15, t + 0.1, t + 3.5), hlp = v.filter('lowpass', 1500, 0.7), hg = v.gain(0);
    hum.frequency.setValueAtTime(15, t + 0.1);
    hum.frequency.exponentialRampToValueAtTime(60, t + 1.3);
    pts(hg.gain, t + 0.1, [[0, 0], [1.2, 0.2], [2.2, 0.12], [3.3, 0]]);
    v.chain(hum, hlp, hg, v.out);
    const fan = v.osc('triangle', 60, t + 0.2, t + 3.5), fg = v.gain(0);
    fan.frequency.setValueAtTime(60, t + 0.2); fan.frequency.exponentialRampToValueAtTime(700, t + 2.8);
    pts(fg.gain, t + 0.2, [[0, 0], [1.5, 0.02], [3.2, 0]]);
    v.chain(fan, fg, v.out);
    // fluorescent tubes striking: starter tink + a few buzz flickers each
    const buzz = v.osc(this._wave('buzz'), 120, t, t + 3.2), bhp = v.filter('highpass', 300, 0.7), bg = v.gain(0);
    v.chain(buzz, bhp, bg, v.out);
    const tubes = irand(3, 5);
    for (let k = 0; k < tubes; k++) {
      let s = t + 0.4 + k * rand(0.18, 0.45) + rand(0, 0.2);
      const f = rand(3000, 5200);
      v.modes(s, [f, f * 1.51, f * 2.3], [0.08, 0.05, 0.03], [0.08, 0.05, 0.03], v.out);
      const fl = irand(2, 4);
      for (let i = 0; i < fl; i++) {
        s += rand(0.06, 0.16);
        const d = rand(0.03, 0.09);
        pts(bg.gain, s, [[0, 0], [0.004, 0.06], [d, 0.05], [d + 0.008, 0]]);
        s += d;
      }
    }
    v.until(t + 3.5);
  }

  // ------------------------------------------------------------ positional
  doorSlide(pos, { heavy = false } = {}) {
    const t = this._now();
    if (!heavy) {
      const D = rand(0.7, 0.95);
      const v = this._voice('door', { t, pos, gain: 0.75, send: 0.3 });
      // pneumatic hiss
      const n = v.noise('white', t, t + D + 0.5), hp = v.filter('highpass', 2200, 0.7), bp = v.filter('bandpass', rand(4500, 6000), 0.8), g = v.gain(0);
      bp.frequency.setValueAtTime(bp.frequency.value, t); bp.frequency.exponentialRampToValueAtTime(2600, t + D + 0.3);
      pts(g.gain, t, [[0, 0], [0.015, 0.5], [0.12, 0.28], [D * 0.8, 0.16], [D + 0.35, 0]]);
      v.chain(n, hp, bp, g, v.out);
      // motor + rumble
      const m = v.osc('sawtooth', 90, t, t + D + 0.1), ml = v.filter('lowpass', 380, 1.4), mg = v.gain(0);
      m.frequency.setValueAtTime(70, t); m.frequency.linearRampToValueAtTime(rand(95, 110), t + 0.15); m.frequency.linearRampToValueAtTime(80, t + D);
      pts(mg.gain, t, [[0, 0], [0.08, 0.12], [D - 0.1, 0.1], [D, 0]]);
      v.chain(m, ml, mg, v.out);
      const r = v.noise('brown', t, t + D + 0.1), rl = v.filter('lowpass', 220, 0.7), rg = v.gain(0);
      pts(rg.gain, t, [[0, 0], [0.06, 0.45], [D - 0.05, 0.35], [D, 0]]);
      v.chain(r, rl, rg, v.out);
      // track rattle
      const c = v.buffer(this.buf.grit, t, t + D, rand(0.6, 0.9), true, rand(0, 1.5)), cbp = v.filter('bandpass', 1500, 1.2), cg = v.gain(0);
      pts(cg.gain, t, [[0, 0], [0.1, 0.08], [D - 0.1, 0.06], [D, 0]]);
      v.chain(c, cbp, cg, v.out);
      // stop: rubber seal thump
      const e = v.osc('sine', 90, t + D, t + D + 0.3), eg = v.gain(0);
      e.frequency.setValueAtTime(95, t + D); e.frequency.exponentialRampToValueAtTime(55, t + D + 0.1);
      perc(eg.gain, t + D, 0.5, 0.14, 0.003);
      v.chain(e, eg, v.out);
      const en = v.noise('pink', t + D, t + D + 0.15), enl = v.filter('lowpass', 900, 0.7), eng = v.gain(0);
      perc(eng.gain, t + D, 0.5, 0.06, 0.002);
      v.chain(en, enl, eng, v.out);
      return;
    }
    // heavy containment door
    const D = rand(2.6, 3.2);
    const v = this._voice('door', { t, pos, gain: 1, send: 0.45 });
    // pressure seal release
    const n = v.noise('white', t, t + 1.3), bp = v.filter('bandpass', 1800, 0.5), hp = v.filter('highpass', 500, 0.7), g = v.gain(0);
    pts(g.gain, t, [[0, 0], [0.01, 0.6], [0.2, 0.3], [1.1, 0]]);
    v.chain(n, bp, hp, g, v.out);
    // servo motor: spin up, run, spin down
    const tm = t + 0.25;
    const s1 = v.osc('sawtooth', 40, tm, tm + D), s2 = v.osc('square', 80, tm, tm + D);
    for (const [o, k] of [[s1, 1], [s2, 2]]) {
      o.frequency.setValueAtTime(20 * k, tm);
      o.frequency.exponentialRampToValueAtTime(52 * k, tm + 0.45);
      o.frequency.setValueAtTime(52 * k, tm + D - 0.4);
      o.frequency.exponentialRampToValueAtTime(30 * k, tm + D);
    }
    const s2g = v.gain(0.3), slp = v.filter('lowpass', 320, 3), sg = v.gain(0);
    s2.connect(s2g); s1.connect(slp); s2g.connect(slp);
    pts(sg.gain, tm, [[0, 0], [0.3, 0.32], [D - 0.3, 0.3], [D, 0]]);
    v.chain(slp, sg, v.out);
    // gear whine with tooth modulation
    const gw = v.osc('sine', 380, tm, tm + D), gwg = v.gain(0), gam = v.osc('square', 37, tm, tm + D), gamg = v.gain(0.012);
    gw.frequency.setValueAtTime(300, tm); gw.frequency.exponentialRampToValueAtTime(520, tm + 0.45); gw.frequency.setValueAtTime(520, tm + D - 0.4); gw.frequency.exponentialRampToValueAtTime(330, tm + D);
    gam.connect(gamg); gamg.connect(gwg.gain);
    pts(gwg.gain, tm, [[0, 0], [0.4, 0.035], [D - 0.3, 0.03], [D, 0]]);
    v.chain(gw, gwg, v.out);
    // heavy rumble and rollers grinding
    const r = v.noise('brown', tm, tm + D), rl = v.filter('lowpass', 170, 0.7), rg = v.gain(0);
    pts(rg.gain, tm, [[0, 0], [0.4, 0.7], [D - 0.2, 0.6], [D, 0]]);
    v.chain(r, rl, rg, v.out);
    const c = v.buffer(this.buf.grit, tm, tm + D, rand(0.35, 0.5), true, rand(0, 1)), cbp = v.filter('bandpass', 900, 2), cg = v.gain(0);
    pts(cg.gain, tm, [[0, 0], [0.4, 0.12], [D - 0.2, 0.1], [D, 0]]);
    v.chain(c, cbp, cg, v.out);
    // end clunk + locking bolts
    const te = tm + D;
    this._clunk(v, te, v.out, 1.3);
    for (const [dt, a] of [[0.14, 0.5], [0.24, 0.35]]) {
      const b = v.noise('white', te + dt, te + dt + 0.08), bb = v.filter('bandpass', rand(2000, 2800), 2), bg = v.gain(0);
      perc(bg.gain, te + dt, a, 0.04);
      v.chain(b, bb, bg, v.out);
      const f = rand(900, 1300);
      v.modes(te + dt, [f, f * 2.4], [0.15, 0.08], [a * 0.2, a * 0.1], v.out);
    }
  }

  doorBang(pos, strength = 1) {
    const s = clamp(+strength || 1, 0.2, 2);
    const t = this._now();
    const v = this._voice('door', { t, pos, gain: 0.9 * Math.pow(s, 0.7), send: 0.38 });
    const sh = v.shaper(1.4), mix = v.gain(1);
    v.chain(mix, sh, v.out);
    // deep thud of the forearm hitting the door
    const f = rand(52, 70), o = v.osc('sine', f, t, t + 0.8), og = v.gain(0);
    o.frequency.setValueAtTime(f * 1.4, t); o.frequency.exponentialRampToValueAtTime(f * 0.62, t + 0.14);
    perc(og.gain, t, 0.85, 0.38, 0.002);
    v.chain(o, og, mix);
    const b = v.noise('brown', t, t + 0.5), bl = v.filter('lowpass', 380, 0.7), bg = v.gain(0);
    perc(bg.gain, t, 1.1, 0.18, 0.0015);
    v.chain(b, bl, bg, mix);
    const w = v.noise('white', t, t + 0.12), wl = v.filter('lowpass', 1600, 0.7), wg = v.gain(0);
    perc(wg.gain, t, 0.35, 0.04, 0.001);
    v.chain(w, wl, wg, mix);
    // steel panel modes
    const p = rand(85, 110), ratios = [1, 1.58, 2.34, 3.7, 5.1, 7.3];
    v.modes(t, ratios.map((r) => p * r * rand(0.97, 1.03)), [0.55, 0.42, 0.3, 0.2, 0.12, 0.08].map((d) => d * (0.8 + 0.3 * s)),
      [0.4, 0.3, 0.22, 0.14, 0.09, 0.05], mix);
    // door rattling in its frame
    const rn = v.noise('white', t, t + 0.5), rbp = v.filter('bandpass', rand(1800, 2600), 2), rgn = v.gain(0);
    v.chain(rn, rbp, rgn, mix);
    let rt = t + 0.012, gap = rand(0.025, 0.04), a = 0.35 * s;
    const k = Math.round(4 + s * 4);
    for (let i = 0; i < k; i++) {
      perc(rgn.gain, rt, a, 0.012, 0.0005);
      rt += gap; gap *= rand(0.78, 0.95); a *= 0.78;
    }
    const lf = rand(2600, 3600);
    v.modes(t + 0.015, [lf, lf * 1.37], [0.09, 0.06], [0.06 * s, 0.04 * s], mix);
    v.until(t + 1);
  }

  doorSmash(pos) {
    const t = this._now();
    const v = this._voice('door', { t, pos, gain: 1, send: 0.45 });
    const sh = v.shaper(1.8), mix = v.gain(1);
    v.chain(mix, sh, v.out);
    // the blow
    const o = v.osc('sine', 60, t, t + 1), og = v.gain(0);
    o.frequency.setValueAtTime(85, t); o.frequency.exponentialRampToValueAtTime(36, t + 0.25);
    perc(og.gain, t, 1, 0.5, 0.002);
    v.chain(o, og, mix);
    const b = v.noise('brown', t, t + 0.6), bl = v.filter('lowpass', 600, 0.7), bg = v.gain(0);
    perc(bg.gain, t, 1.2, 0.25, 0.001);
    v.chain(b, bl, bg, mix);
    // splintering wood / tearing panel
    const sp = v.buffer(this._poolTake('splinter'), t + 0.004, null, rand(0.9, 1.1));
    const sph = v.filter('highpass', 350, 0.7), spk = v.filter('peaking', 1800, 1, 4), spg = v.gain(1.1);
    v.chain(sp, sph, spk, spg, mix);
    // broadband crash
    const c = v.noise('white', t, t + 0.6), cbp = v.filter('bandpass', 2500, 0.5), cg = v.gain(0);
    perc(cg.gain, t, 0.5, 0.3, 0.001);
    v.chain(c, cbp, cg, mix);
    // frame / hinge metal
    const f = rand(160, 230);
    v.modes(t + 0.01, [f, f * 1.59, f * 2.14, f * 2.92, f * 4.15], [0.8, 0.6, 0.4, 0.3, 0.2], [0.18, 0.14, 0.1, 0.07, 0.05], mix);
    v.until(t + 2);
    this.debris(pos, { t: t + 0.12, amount: 1.3 });
  }

  glassKnock(pos) {
    const t = this._now();
    const v = this._voice('glass', { t, pos, gain: 0.8, send: 0.3 });
    const n = irand(2, 4);
    const times = [t];
    for (let i = 1; i < n; i++) times.push(times[i - 1] + (chance(0.3) ? rand(0.35, 0.6) : rand(0.11, 0.22)));
    const T = times[n - 1] + 0.4;
    // claw tip on glass
    const c = v.noise('white', t, T), chp = v.filter('highpass', 3500, 0.7), cbp = v.filter('bandpass', rand(5000, 7000), 1.2), cg = v.gain(0);
    v.chain(c, chp, cbp, cg, v.out);
    // thick pane resonance + low pane thump
    const pf = rand(620, 760), mfs = [pf, pf * 1.73, pf * 2.71, pf * 3.9], md = [0.1, 0.07, 0.05, 0.035];
    const mg = mfs.map((f, i) => { const o = v.osc('sine', f, t, T), g = v.gain(0); v.chain(o, g, v.out); return g; });
    const th = v.osc('sine', 170, t, T), thg = v.gain(0);
    v.chain(th, thg, v.out);
    for (const s of times) {
      const a = rand(0.7, 1);
      perc(cg.gain, s, a * 1.2, rand(0.004, 0.008), 0.0004);
      mg.forEach((g, i) => perc(g.gain, s, a * [0.25, 0.15, 0.1, 0.06][i], md[i] * rand(0.8, 1.2), 0.0008));
      perc(thg.gain, s, a * 0.3, 0.05, 0.002);
    }
    v.until(T);
  }

  glassCrack(pos) {
    const t = this._now();
    const v = this._voice('glass', { t, pos, gain: 1.4, send: 0.35 });
    // main crack
    const c = v.noise('white', t, t + 0.2), chp = v.filter('highpass', 1500, 0.7), cg = v.gain(0);
    perc(cg.gain, t, 1, 0.03, 0.0003);
    v.chain(c, chp, cg, v.out);
    const o = v.osc('sine', 140, t, t + 0.5), og = v.gain(0);
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.15);
    perc(og.gain, t, 0.45, 0.16, 0.001);
    v.chain(o, og, v.out);
    // fracture propagating through the laminate
    const p = v.buffer(this.buf.crackle, t + 0.005, t + 0.9, rand(1.2, 1.6), true, rand(0, 2)), php = v.filter('highpass', 2500, 0.7), pbp = v.filter('peaking', 5000, 1, 5), pg = v.gain(0);
    pts(pg.gain, t + 0.005, [[0, 0], [0.01, 0.8], [0.15, 0.35], [0.85, 0]]);
    v.chain(p, php, pbp, pg, v.out);
    // stress ticks
    const k = v.noise('white', t, t + 1.5), kbp = v.filter('bandpass', 4000, 3), kg = v.gain(0);
    v.chain(k, kbp, kg, v.out);
    let s = t + rand(0.08, 0.2);
    const nticks = irand(3, 7);
    for (let i = 0; i < nticks && s < t + 1.3; i++) {
      kbp.frequency.setValueAtTime(rand(3000, 7000), s);
      perc(kg.gain, s, rand(0.3, 0.8), 0.008, 0.0003);
      s += rand(0.05, 0.3);
    }
    // creaking glass under load
    const cr = v.buffer(pick(this.buf.creak), t + 0.1, t + 1.5, rand(2, 3), true, rand(0, 1)), crg = v.gain(0);
    pts(crg.gain, t + 0.1, [[0, 0], [0.3, 0.6], [1.0, 0.4], [1.35, 0]]);
    cr.connect(crg);
    for (const [f, q, a] of [[rand(1600, 2000), 6, 1], [rand(2900, 3400), 8, 0.6]]) { const b = v.filter('bandpass', f, q), g = v.gain(a * 2.5); v.chain(crg, b, g, v.out); }
    // the pane ringing after the crack
    const rf = rand(1700, 2100);
    v.modes(t, [rf, rf * 1.67, rf * 2.32], [0.25, 0.18, 0.12], [0.12, 0.08, 0.05], v.out);
    v.until(t + 1.6);
  }

  glassShatter(pos) {
    const t = this._now();
    const v = this._voice('glass', { t, pos, gain: 1, send: 0.4 });
    // impact
    const o = v.osc('sine', 90, t, t + 0.6), og = v.gain(0);
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.2);
    perc(og.gain, t, 0.6, 0.25, 0.001);
    v.chain(o, og, v.out);
    const c = v.noise('white', t, t + 0.6), chp = v.filter('highpass', 900, 0.7), cg = v.gain(0);
    perc(cg.gain, t, 0.9, 0.18, 0.0005);
    v.chain(c, chp, cg, v.out);
    const k = v.noise('white', t, t + 0.9), kbp = v.filter('bandpass', 3500, 0.5), kg = v.gain(0);
    pts(kg.gain, t, [[0, 0], [0.01, 0.5], [0.12, 0.3], [0.6, 0]]);
    v.chain(k, kbp, kg, v.out);
    // shards: the burst and then falling, bouncing pieces
    const sh = v.buffer(this._poolTake('shards'), t + 0.002, null, rand(0.92, 1.08));
    const shp = v.filter('highpass', 1400, 0.7), sg = v.gain(0.95);
    v.chain(sh, shp, sg, v.out);
  }

  metalImpact(pos, size = 1) {
    const s = clamp(+size || 1, 0.2, 4);
    const t = this._now();
    const v = this._voice('metal', { t, pos, gain: 1.1 * Math.pow(s, 0.4), send: 0.35 });
    const f0 = rand(260, 340) / Math.pow(s, 0.8);
    const ratios = [1, 1.59, 2.14, 2.3, 2.65, 2.92, 3.5, 4.15];
    const base = 0.3 + 0.55 * s;
    const fr = [], dc = [], am = [];
    ratios.forEach((r, i) => {
      fr.push(f0 * r * rand(0.97, 1.03));
      dc.push(base * rand(0.7, 1.2) / (1 + 0.35 * i));
      am.push(rand(0.3, 1) / (1 + 0.3 * i) * 0.25);
    });
    fr.push(f0 * 1.004); dc.push(base); am.push(0.15); // beating partner
    v.modes(t, fr, dc, am, v.out);
    const n = v.noise('white', t, t + 0.05), bp = v.filter('bandpass', rand(2000, 4000), 0.8), g = v.gain(0);
    perc(g.gain, t, 0.6, 0.012, 0.0005);
    v.chain(n, bp, g, v.out);
    const th = v.osc('sine', f0 * 0.5, t, t + 0.2), thg = v.gain(0);
    perc(thg.gain, t, 0.35, 0.08, 0.001);
    v.chain(th, thg, v.out);
  }

  debris(pos, { t: tAt, amount = 1 } = {}) {
    const t = tAt ?? this._now();
    const D = rand(1.0, 1.7) * Math.sqrt(amount);
    const v = this._voice('debris', { t, pos, gain: 0.75, send: 0.35 });
    const n = v.noise('white', t, t + D + 0.3), bp = v.filter('bandpass', 1500, 1.5), g = v.gain(0);
    v.chain(n, bp, g, v.out);
    const b = v.noise('brown', t, t + D + 0.3), bl = v.filter('lowpass', 320, 0.7), bg = v.gain(0);
    v.chain(b, bl, bg, v.out);
    const p = v.osc('sine', 2000, t, t + D + 0.3), pg = v.gain(0);
    v.chain(p, pg, v.out);
    const N = Math.round(irand(8, 15) * amount);
    let last = t - 1;
    for (let i = 0; i < N; i++) {
      let s = t + D * Math.pow(i / N, 1.5) + rand(0, 0.05);
      if (s < last + 0.012) s = last + 0.012;
      last = s;
      const a = rand(0.3, 1) * (1 - 0.6 * i / N);
      bp.frequency.setValueAtTime(rand(400, 3500), s);
      bp.Q.setValueAtTime(rand(1, 3), s);
      perc(g.gain, s, a * 2, rand(0.01, 0.05), 0.0008);
      if (chance(0.35)) perc(bg.gain, s, a * 1.5, rand(0.05, 0.12), 0.002);
      if (chance(0.2)) { p.frequency.setValueAtTime(rand(1500, 4000), s); perc(pg.gain, s, a * 0.12, 0.03, 0.001); }
    }
    // dust and grit trickling
    const d = v.buffer(this.buf.grit, t, t + D + 0.4, rand(0.8, 1.2), true, rand(0, 1.5)), dhp = v.filter('highpass', 2000, 0.7), dg = v.gain(0);
    pts(dg.gain, t, [[0, 0], [0.05, 0.25], [D * 0.5, 0.12], [D + 0.4, 0]]);
    v.chain(d, dhp, dg, v.out);
  }

  footstep(pos, surface = 'tile', { run = false, player = true } = {}) {
    const t = this._now();
    const lvl = (player ? 0.5 : 0.9) * (run ? 1.4 : 1) * rand(0.8, 1.1);
    let o;
    if (player && !pos) { this._footSide = -this._footSide; o = { t, gain: lvl, send: 0.15, pan: 0.12 * this._footSide }; }
    else o = { t, pos, gain: lvl, send: 0.2 };
    const v = this._voice('foot', o);
    const out = v.out;
    const toe = t + (run ? rand(0.02, 0.04) : rand(0.045, 0.085));
    // body weight thud
    const f = rand(55, 85), th = v.osc('sine', f, t, t + 0.25), thg = v.gain(0);
    th.frequency.setValueAtTime(f * 1.3, t); th.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.06);
    perc(thg.gain, t, (run ? 0.6 : 0.4) * (surface === 'metal' ? 1.3 : 1), 0.07, 0.003);
    v.chain(th, thg, out);
    const bn = v.noise('brown', t, t + 0.2), bnl = v.filter('lowpass', 260, 0.7), bng = v.gain(0);
    perc(bng.gain, t, 0.5, 0.05, 0.002);
    v.chain(bn, bnl, bng, out);
    const heelA = rand(0.8, 1), toeA = rand(0.35, 0.6);
    if (surface === 'concrete') {
      const n = v.noise('white', t, t + 0.3), bp = v.filter('bandpass', rand(900, 1500), 0.7), g = v.gain(0);
      perc(g.gain, t, heelA * 0.6, 0.025, 0.001); perc(g.gain, toe, toeA * 0.5, 0.02, 0.001);
      v.chain(n, bp, g, out);
      const gr = v.buffer(this.buf.grit, t, t + 0.25, rand(0.8, 1.2), true, rand(0, 1.5)), ghp = v.filter('highpass', 2200, 0.7), gg = v.gain(0);
      pts(gg.gain, t, [[0, 0], [0.01, 0.3], [toe - t + 0.03, 0.25], [toe - t + (run ? 0.08 : 0.15), 0]]);
      v.chain(gr, ghp, gg, out);
    } else if (surface === 'metal') {
      const n = v.noise('white', t, t + 0.1), bp = v.filter('bandpass', rand(2000, 3000), 1), g = v.gain(0);
      perc(g.gain, t, heelA * 0.5, 0.01, 0.0005); perc(g.gain, toe, toeA * 0.4, 0.008, 0.0005);
      v.chain(n, bp, g, out);
      const mf = rand(330, 450);
      v.modes(t, [mf, mf * 2.32, mf * 3.9, mf * 5.4], [0.25, 0.15, 0.1, 0.07], [0.12, 0.08, 0.05, 0.03].map((a) => a * heelA), out);
      v.modes(toe, [mf * 1.1, mf * 2.6], [0.12, 0.08], [0.05 * toeA, 0.03 * toeA], out);
      const hb = v.osc('sine', rand(100, 130), t, t + 0.3), hbg = v.gain(0);
      perc(hbg.gain, t, 0.3, 0.15, 0.002);
      v.chain(hb, hbg, out);
    } else if (surface === 'plastic') {
      const cr = v.buffer(this.buf.crackle, t, t + 0.35, rand(1.1, 1.6), true, rand(0, 2)), chp = v.filter('highpass', 2500, 0.7), cg = v.gain(0);
      pts(cg.gain, t, [[0, 0], [0.01, 0.9], [0.08, 0.5], [run ? 0.18 : 0.3, 0]]);
      v.chain(cr, chp, cg, out);
      const n = v.noise('white', t, t + 0.3), bp = v.filter('bandpass', 4000, 0.8), g = v.gain(0);
      pts(g.gain, t, [[0, 0], [0.01, 0.15], [0.12, 0.05], [0.2, 0]]);
      v.chain(n, bp, g, out);
    } else if (surface === 'water') {
      const n = v.noise('white', t, t + 0.5), bp = v.filter('bandpass', rand(1200, 1900), 0.6), g = v.gain(0);
      pts(g.gain, t, [[0, 0], [0.006, 0.7], [0.05, 0.4], [run ? 0.2 : 0.28, 0]]);
      v.chain(n, bp, g, out);
      const sl = v.noise('pink', t, t + 0.5), sll = v.filter('lowpass', 600, 0.8), slg = v.gain(0);
      pts(slg.gain, t, [[0, 0], [0.03, 0.5], [0.3, 0]]);
      v.chain(sl, sll, slg, out);
      const nb = irand(2, 5);
      for (let i = 0; i < nb; i++) {
        const s = t + rand(0.02, 0.2), bf = rand(600, 1600), bo = v.osc('sine', bf, s, s + 0.08), bg = v.gain(0);
        bo.frequency.setValueAtTime(bf, s); bo.frequency.exponentialRampToValueAtTime(bf * rand(1.5, 2.2), s + 0.04);
        perc(bg.gain, s, rand(0.1, 0.25), 0.05, 0.002);
        v.chain(bo, bg, out);
      }
    } else { // tile: hard click, short tile ring
      const n = v.noise('white', t, t + 0.12), bp = v.filter('bandpass', rand(2200, 3400), 1.1), g = v.gain(0);
      perc(g.gain, t, heelA * 0.8, 0.012, 0.0005); perc(g.gain, toe, toeA * 0.6, 0.01, 0.0005);
      v.chain(n, bp, g, out);
      const tf = rand(1300, 2000);
      v.modes(t, [tf, tf * 2.7], [0.05, 0.03], [0.05 * heelA, 0.025 * heelA], out);
      const ho = v.noise('pink', t, t + 0.1), hob = v.filter('bandpass', rand(600, 800), 2), hog = v.gain(0);
      perc(hog.gain, t, 0.35, 0.025, 0.001);
      v.chain(ho, hob, hog, out);
      if (chance(0.06)) { // rubber sole squeak
        const sf = rand(700, 1100), sq = v.osc('sawtooth', sf, toe, toe + 0.1), sqb = v.filter('bandpass', 2500, 3), sqg = v.gain(0);
        sq.frequency.setValueAtTime(sf, toe);
        sq.frequency.linearRampToValueAtTime(sf * 1.3, toe + 0.08);
        pts(sqg.gain, toe, [[0, 0], [0.02, 0.06], [0.08, 0]]);
        v.chain(sq, sqb, sqg, out);
      }
    }
    v.until(t + 0.5);
  }

  deconSpray(durationSec = 4) {
    const D = Math.max(0.6, +durationSec || 4);
    const t = this._now();
    const v = this._voice('decon', { t, gain: 0.55, send: 0.3 });
    const T = t + D;
    this._clunk(v, t, v.out, 0.3);
    // pressurisation burst
    const pb = v.noise('white', t, t + 0.5), pbh = v.filter('highpass', 1500, 0.7), pbg = v.gain(0);
    pts(pbg.gain, t, [[0, 0], [0.01, 0.6], [0.35, 0]]);
    v.chain(pb, pbh, pbg, v.out);
    // two banks of nozzles left/right, pulsing out of phase
    for (const side of [-1, 1]) {
      const sp = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : v.gain(1);
      if (sp.pan) sp.pan.value = 0.7 * side;
      v.nodes.push(sp);
      sp.connect(v.out);
      const n = v.noise('white', t + 0.1, T + 0.6), hp = v.filter('highpass', 2500, 0.7), bp = v.filter('bandpass', rand(5500, 7000), 0.5), g = v.gain(0);
      v.chain(n, hp, bp, g, sp);
      g.gain.setValueAtTime(0, t + 0.1);
      let s = t + 0.1 + (side > 0 ? 0.4 : 0);
      while (s < T - 0.2) {
        const w = rand(0.45, 0.6);
        g.gain.setValueAtTime(0.25, s);
        g.gain.linearRampToValueAtTime(0.6, s + 0.08);
        g.gain.linearRampToValueAtTime(0.5, s + w);
        g.gain.linearRampToValueAtTime(0.25, s + w + 0.15);
        s += w + rand(0.25, 0.35);
      }
      g.gain.setValueAtTime(0.25, Math.max(s, T - 0.2));
      g.gain.linearRampToValueAtTime(0, T + 0.5);
      // droplets spattering
      const dr = v.buffer(this.buf.grit, t + 0.1, T + 0.6, rand(1.3, 1.7), true, rand(0, 1.5)), dhp = v.filter('highpass', 5000, 0.7), dg = v.gain(0);
      pts(dg.gain, t + 0.1, [[0, 0], [0.3, 0.12], [D - 0.1, 0.12], [D + 0.5, 0]]);
      v.chain(dr, dhp, dg, sp);
    }
    // air handling rumble
    const r = v.noise('brown', t, T + 1), rl = v.filter('lowpass', 250, 0.7), rg = v.gain(0);
    pts(rg.gain, t, [[0, 0], [0.4, 0.4], [D, 0.4], [D + 0.9, 0]]);
    v.chain(r, rl, rg, v.out);
    // valve closes
    this._clunk(v, T + 0.5, v.out, 0.25);
    v.until(T + 1.2);
    return { stop: () => v.kill(0.25) };
  }

  strobeCharge(dur = 1.4) {
    const D = Math.max(0.3, +dur || 1.4);
    const t = this._now();
    if (this._charge && !this._charge.dead) this._charge.kill(0.02);
    const v = this._charge = this._voice('strobe', { t, gain: 0.18, send: 0.05, pan: 0.15 });
    const o = v.osc('triangle', 500, t, t + D + 1.6), o2 = v.osc('sine', 1000, t, t + D + 1.6);
    for (const [osc, k] of [[o, 1], [o2, 2]]) {
      osc.frequency.setValueAtTime(500 * k, t);
      osc.frequency.setTargetAtTime(7000 * k, t, D / 2.6);
    }
    const o2g = v.gain(0.15), g = v.gain(0), rip = v.osc('sine', 120, t, t + D + 1.6), ripg = v.gain(0.15);
    rip.connect(ripg); ripg.connect(g.gain);
    o2.connect(o2g);
    const lp = v.filter('lowpass', 9000, 0.7);
    o.connect(g); o2g.connect(g);
    v.chain(g, lp, v.out);
    pts(g.gain, t, [[0, 0], [0.08, 0.5], [D, 0.75], [D + 0.4, 0.3], [D + 1.5, 0]]);
    // ready blip
    const b = v.osc('sine', 2637, t + D, t + D + 0.12), bg = v.gain(0);
    ahr(bg.gain, t + D, 0.004, 0.25, 0.05, 0.03);
    v.chain(b, bg, v.out);
    return { stop: () => v.kill(0.05) };
  }

  strobeFlash() {
    const t = this._now();
    if (this._charge && !this._charge.dead) { this._charge.kill(0.01); this._charge = null; }
    const v = this._voice('strobe', { t, gain: 0.6, send: 0.3, pan: 0.15 });
    // electrical snap
    const n = v.noise('white', t, t + 0.1), hp = v.filter('highpass', 2500, 0.7), g = v.gain(0);
    perc(g.gain, t, 1, 0.012, 0.0002);
    v.chain(n, hp, g, v.out);
    const pp = v.noise('white', t, t + 0.1), pbp = v.filter('bandpass', 3000, 1), pg = v.gain(0);
    perc(pg.gain, t + 0.002, 0.5, 0.025, 0.0005);
    v.chain(pp, pbp, pg, v.out);
    // thump
    const o = v.osc('sine', 80, t, t + 0.4), og = v.gain(0);
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    perc(og.gain, t, 0.7, 0.16, 0.001);
    v.chain(o, og, v.out);
    // whine decaying as the capacitor drains
    const w = v.osc('sine', 6000, t, t + 0.9), wg = v.gain(0);
    w.frequency.setValueAtTime(6200, t); w.frequency.exponentialRampToValueAtTime(700, t + 0.7);
    pts(wg.gain, t, [[0, 0], [0.01, 0.12], [0.7, 0]]);
    v.chain(w, wg, v.out);
    // sizzle
    const z = v.buffer(this.buf.grit, t + 0.01, t + 0.35, 1.4, true, rand(0, 1.5)), zh = v.filter('highpass', 4000, 0.7), zg = v.gain(0);
    pts(zg.gain, t + 0.01, [[0, 0.25], [0.3, 0]]);
    v.chain(z, zh, zg, v.out);
  }

  lightBuzz(pos, on = true) {
    const eng = this;
    const h = {
      pos: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
      on: !!on, v: null, tk: null, stopped: false,
      get active() { return !h.stopped; },
      _build() {
        if (h.v || h.stopped || !eng.ctx) return;
        const ctx = eng.ctx, t = ctx.currentTime + 0.02;
        const v = h.v = new Voice(eng, 'loop', { pos: h.pos, gain: 0, loop: true, send: 0.15 });
        const b = v.osc(eng._wave('buzz'), 120 * rand(0.998, 1.002), t), hp = v.filter('highpass', 200, 0.7), bp = v.filter('peaking', rand(1800, 3200), 1.2, 6);
        const flick = h.flick = v.gain(1), lvl = v.gain(0.05);
        v.chain(b, hp, bp, flick, lvl, v.out);
        const hm = v.osc('sine', 120, t), hmg = v.gain(0.04);
        v.chain(hm, hmg, flick);
        const ns = v.noise('pink', t), nhp = v.filter('highpass', 5000, 0.7), ng = v.gain(0.015);
        v.chain(ns, nhp, ng, flick);
        h.bp = bp;
        v.out.gain.setValueAtTime(0, t);
        v.out.gain.setTargetAtTime(h.on ? 1 : 0.0, t, 0.05);
        h.tk = eng._addTicker(t + rand(0.2, 1), (tt) => {
          if (h.stopped) return null;
          if (!h.on) {
            if (chance(0.25)) eng._starterTick(tt, h.pos);
            return tt + rand(1, 4);
          }
          // sputter: a burst of dropouts and brightening, with ballast ticks
          const k = irand(1, 6);
          let s = tt;
          for (let i = 0; i < k; i++) {
            const d = rand(0.02, 0.12);
            flick.gain.setValueAtTime(1, s);
            flick.gain.linearRampToValueAtTime(rand(0.0, 0.35), s + 0.006);
            flick.gain.setValueAtTime(flick.gain.value, s + d);
            flick.gain.linearRampToValueAtTime(rand(0.9, 1.5), s + d + 0.006);
            bp.frequency.setValueAtTime(rand(1500, 4500), s + d);
            if (chance(0.4)) eng._starterTick(s + d, h.pos, 0.4);
            s += d + rand(0.02, 0.2);
          }
          flick.gain.setValueAtTime(flick.gain.value, s);
          flick.gain.linearRampToValueAtTime(1, s + 0.01);
          return s + rand(0.4, 3.5);
        });
      },
      stop(fade = 0.15) {
        if (h.stopped) return;
        h.stopped = true;
        eng._loops.delete(h);
        if (h.tk) eng._tickers.delete(h.tk);
        if (h.v) { h.v.kill(fade); eng.voices.push(h.v); }
      },
      set(v) {
        h.on = !!v;
        if (h.v) { const t = eng.ctx.currentTime; h.v.out.gain.cancelScheduledValues(t); h.v.out.gain.setTargetAtTime(h.on ? 1 : 0, t, 0.03); if (h.on) eng._starterTick(t, h.pos, 0.8); }
      },
      setOn(v) { h.set(v); },
      setPosition(p) { if (p) { h.pos = { x: p.x, y: p.y, z: p.z }; if (h.v) h.v.setPosition(h.pos); } },
    };
    this._loops.add(h);
    if (this.ctx) h._build();
    return h;
  }

  _starterTick(t, pos, lvl = 1) {
    const v = this._voice('fx', { t, pos, gain: 0.12 * lvl, send: 0.2 });
    const n = v.noise('white', t, t + 0.03), bp = v.filter('bandpass', rand(3000, 5000), 2), g = v.gain(0);
    perc(g.gain, t, 1, 0.006, 0.0003);
    v.chain(n, bp, g, v.out);
    const f = rand(3500, 5500);
    v.modes(t, [f], [0.04], [0.15], v.out);
  }

  // ------------------------------------------------------------- creature
  creatureBreath(pos, { intensity = 0.5 } = {}) {
    const I = clamp(+intensity || 0, 0, 1);
    const t = this._now();
    const sp = 1.25 - 0.55 * I;
    const inD = rand(0.6, 0.95) * sp, gap = rand(0.04, 0.18) * sp, exD = rand(0.85, 1.3) * sp;
    const tEx = t + inD + gap, tEnd = tEx + exD;
    const v = this._voice('cbreath', { t, pos, gain: 0.55 + 0.55 * I, send: 0.3 });
    const mix = v.gain(1), sh = v.shaper(1.6);
    v.chain(mix, sh, v.out);

    // --- air through a ruined throat and nasal cavity
    const air = v.noise('pink', t, tEnd + 0.1);
    const bpA = v.filter('bandpass', 1400, 1.1), bpB = v.filter('bandpass', 2700, 3.5);
    const gA = v.gain(1.2), gB = v.gain(0.8), airEnv = v.gain(0), trem = v.gain(1);
    air.connect(bpA); air.connect(bpB);
    v.chain(bpA, gA, airEnv); v.chain(bpB, gB, airEnv);
    v.chain(airEnv, trem, mix);
    const tr = v.osc('sine', rand(5, 9), t, tEnd + 0.1), trg = v.gain(0.12 + 0.15 * I);
    v.chain(tr, trg, trem.gain);
    bpA.frequency.setValueAtTime(1200, t); bpA.frequency.linearRampToValueAtTime(rand(1800, 2300), t + inD);
    bpA.frequency.setValueAtTime(1100, tEx); bpA.frequency.exponentialRampToValueAtTime(600, tEnd);
    bpB.frequency.setValueAtTime(2500, t); bpB.frequency.linearRampToValueAtTime(3300, t + inD);
    bpB.frequency.setValueAtTime(1600, tEx); bpB.frequency.exponentialRampToValueAtTime(950, tEnd);
    // ragged inhale: catches in the throat, abrupt stop
    const P = airEnv.gain;
    P.setValueAtTime(0, t);
    const catches = irand(1, 2 + Math.round(I * 2));
    let lvl = 0.25 + 0.2 * I, cur = t + inD * 0.15;
    P.linearRampToValueAtTime(lvl, cur);
    const span = (inD * 0.8 - 0.05) / catches;
    for (let k = 0; k < catches; k++) {
      const dip = cur + span * rand(0.45, 0.75);
      P.linearRampToValueAtTime(lvl * rand(1, 1.25), Math.max(cur + 0.005, dip - 0.025));
      P.linearRampToValueAtTime(lvl * rand(0.05, 0.25), dip);
      lvl = Math.min(1, lvl * rand(1.15, 1.45));
      cur = Math.min(dip + rand(0.03, 0.06), t + inD - 0.05);
      P.linearRampToValueAtTime(lvl, cur);
    }
    P.linearRampToValueAtTime(lvl, Math.max(cur + 0.005, t + inD - 0.04));
    P.linearRampToValueAtTime(0, t + inD);
    // exhale: fast push, long shuddering decay
    P.setValueAtTime(0, tEx);
    P.linearRampToValueAtTime(0.7 + 0.3 * I, tEx + 0.07);
    P.linearRampToValueAtTime(0.45, tEx + exD * 0.5);
    P.linearRampToValueAtTime(0, tEnd);
    // inhale whistle through the nasal holes
    const wbp = v.filter('bandpass', rand(1800, 2500), 22), wg = v.gain(0);
    wbp.frequency.setValueAtTime(wbp.frequency.value, t); wbp.frequency.linearRampToValueAtTime(wbp.frequency.value * 1.15, t + inD);
    pts(wg.gain, t, [[0, 0], [inD * 0.5, 0.8 + 0.8 * I], [inD - 0.02, 1.2], [inD, 0]]);
    v.chain(air, wbp, wg, mix);

    // --- wet rattle (mucus in the airway)
    const rt = v.buffer(pick(this.buf.rattle), t, tEnd + 0.1, rand(0.8, 1.2) * (0.9 + 0.3 * I), true, rand(0, 2));
    const rbp = v.filter('bandpass', rand(380, 520), 1.1), rlp = v.filter('lowpass', 1500, 0.7), rg = v.gain(0);
    v.chain(rt, rbp, rlp, rg, mix);
    const ra = 0.5 + 0.7 * I;
    pts(rg.gain, t, [[0, 0], [inD * 0.4, 0.3 * ra], [inD, 0.4 * ra], [inD + gap, 0.15 * ra],
      [inD + gap + 0.1, 0.9 * ra], [inD + gap + exD * 0.6, 0.8 * ra], [inD + gap + exD, 0]]);
    // gurgle bubbles on the exhale
    const nb = Math.round(rand(0, 2 + 3 * I));
    for (let i = 0; i < nb; i++) {
      const s = tEx + rand(0.05, exD * 0.8), bf = rand(170, 380), bo = v.osc('sine', bf, s, s + 0.08), bg = v.gain(0);
      bo.frequency.setValueAtTime(bf, s); bo.frequency.exponentialRampToValueAtTime(bf * rand(1.6, 2.4), s + 0.05);
      perc(bg.gain, s, rand(0.1, 0.25), 0.05, 0.003);
      v.chain(bo, bg, mix);
    }

    // --- vocal-fold creak on the exhale (fry + a groan at high intensity)
    const fry = v.buffer(pick(this.buf.fry), tEx, tEnd + 0.1, rand(0.8, 1.25), true, rand(0, 2));
    const fIn = v.gain(1);
    fry.connect(fIn);
    if (I > 0.45) {
      const gf = rand(68, 92), go = v.osc('sawtooth', gf, tEx, tEnd + 0.1), gj = v.noise('brown', tEx, tEnd + 0.1, 0.4), gjg = v.gain(80), gog = v.gain(0.35 * (I - 0.4));
      go.frequency.setValueAtTime(gf, tEx); go.frequency.linearRampToValueAtTime(gf * 0.8, tEnd);
      v.chain(gj, gjg, go.detune);
      v.chain(go, gog, fIn);
    }
    const F = v.formants(fIn, 0.72, 'uh', [5, 7, 9], [1, 0.6, 0.3]);
    F.set('o', tEx + exD * 0.5, 0.2);
    const fg = v.gain(0);
    pts(fg.gain, tEx, [[0, 0], [0.12, 0.35 + 0.5 * I], [exD * 0.7, 0.3 + 0.45 * I], [exD, 0]]);
    v.chain(F.out, fg, mix);
    v.until(tEnd + 0.1);
    return this._handle(v);
  }

  creatureClick(pos) {
    const t = this._now();
    const v = this._voice('cclick', { t, pos, gain: 1.1, send: 0.25 });
    const n = irand(2, 5);
    const T = t + n * 0.13 + 0.15;
    const c = v.noise('white', t, T), hp = v.filter('highpass', 2500, 0.7), bp = v.filter('bandpass', 4500, 1.5), cg = v.gain(0);
    v.chain(c, hp, bp, cg, v.out);
    const r1 = v.osc('sine', 2600, t, T), r2 = v.osc('sine', 4600, t, T), rg = v.gain(0), r2g = v.gain(0.5);
    r1.connect(rg); v.chain(r2, r2g, rg); rg.connect(v.out);
    const k = v.osc('sine', 1100, t, T), kg = v.gain(0);
    v.chain(k, kg, v.out);
    let s = t;
    for (let i = 0; i < n; i++) {
      const a = rand(0.5, 1);
      bp.frequency.setValueAtTime(rand(3500, 6000), s);
      r1.frequency.setValueAtTime(rand(2300, 3100), s);
      r2.frequency.setValueAtTime(rand(4200, 5600), s);
      k.frequency.setValueAtTime(rand(900, 1300), s);
      perc(cg.gain, s, a * 1.4, rand(0.004, 0.009), 0.0003);
      perc(rg.gain, s, a * 0.12, 0.04, 0.0005);
      perc(kg.gain, s, a * 0.18, 0.012, 0.0005);
      s += rand(0.035, 0.12);
    }
    v.until(T);
  }

  creatureCrack(pos) {
    const t = this._now();
    const v = this._voice('ccrack', { t, pos, gain: 0.8, send: 0.25 });
    let s = t;
    // tendon creak building up before the joints give
    if (chance(0.55)) {
      const d = rand(0.18, 0.4);
      const cr = v.buffer(pick(this.buf.creak), t, t + d + 0.05, rand(0.4, 0.7), true, rand(0, 1)), cb = v.filter('bandpass', rand(250, 400), 4), cg = v.gain(0);
      pts(cg.gain, t, [[0, 0], [d * 0.7, 0.9], [d, 0]]);
      v.chain(cr, cb, cg, v.out);
      s = t + d;
    }
    const n = irand(2, 6), T = s + n * 0.12 + 0.2;
    const pop = v.noise('white', t, T), pbp = v.filter('bandpass', 2500, 1), pg = v.gain(0);
    v.chain(pop, pbp, pg, v.out);
    const body = v.osc('sine', 200, t, T), bg = v.gain(0);
    v.chain(body, bg, v.out);
    const cru = v.buffer(this.buf.crackle, t, T, rand(0.8, 1.2), true, rand(0, 2)), chp = v.filter('highpass', 1000, 0.7), crg = v.gain(0);
    v.chain(cru, chp, crg, v.out);
    // wet squelch of the joint capsule
    const sq = v.noise('brown', t, T), sqb = v.filter('bandpass', 260, 2), sqg = v.gain(0);
    pts(sqg.gain, s, [[0, 0], [0.05, 0.5], [n * 0.08 + 0.1, 0]]);
    v.chain(sq, sqb, sqg, v.out);
    let gap = rand(0.06, 0.15);
    for (let i = 0; i < n; i++) {
      const a = rand(0.6, 1) * (i === 0 ? 1 : 0.8);
      pbp.frequency.setValueAtTime(rand(1500, 3500), s);
      body.frequency.setValueAtTime(rand(140, 260), s);
      perc(pg.gain, s, a * 1.6, rand(0.008, 0.02), 0.0003);
      perc(bg.gain, s, a * 0.5, 0.025, 0.0005);
      perc(crg.gain, s, a * 0.6, rand(0.02, 0.06), 0.001);
      s += gap; gap *= rand(0.6, 0.95);
      if (gap < 0.02) gap = 0.02;
    }
    v.until(T);
  }

  creatureGrowl(pos, dur = 1.5) {
    const D = clamp(+dur || 1.5, 0.3, 8);
    const t = this._now(), T = t + D;
    const v = this._voice('cgrowl', { t, pos, gain: 0.9, send: 0.3 });
    // pitch contour shared by all oscillators
    const f0 = v.constant(0, t, T + 0.1), fb = rand(55, 70);
    f0.offset.setValueAtTime(fb * 0.85, t);
    f0.offset.linearRampToValueAtTime(fb * 1.15, t + D * 0.25);
    f0.offset.linearRampToValueAtTime(fb * rand(0.9, 1.05), t + D * 0.6);
    f0.offset.linearRampToValueAtTime(fb * 0.7, T);
    const src = v.gain(1);
    const jit = v.noise('brown', t, T + 0.1, 0.5), jg = v.gain(140);
    jit.connect(jg);
    for (const [type, ratio, a, dt] of [['sawtooth', 1, 0.6, -8], ['sawtooth', 1, 0.5, 10], ['square', 0.5, 0.35, 0]]) {
      const o = v.osc(type, 0, t, T + 0.1), r = v.gain(ratio), g = v.gain(a);
      o.detune.value = dt;
      v.chain(f0, r, o.frequency);
      jg.connect(o.detune);
      v.chain(o, g, src);
    }
    // fry pulses: the croak
    const fry = v.buffer(pick(this.buf.fry), t, T + 0.1, rand(0.7, 1.0), true, rand(0, 2)), fryg = v.gain(0);
    pts(fryg.gain, t, [[0, 0.3], [D * 0.5, 0.25], [D * 0.75, 0.6], [D, 0.8]]);
    v.chain(fry, fryg, src);
    // turbulence
    const turb = v.noise('pink', t, T + 0.1), tg = v.gain(0.3);
    v.chain(turb, tg, src);
    const F = v.formants(src, 0.65, 'o', [5, 6, 8], [1, 0.7, 0.35]);
    F.set('uh', t + D * 0.3, 0.15); F.set('a', t + D * 0.55, 0.2); F.set('o', t + D * 0.85, 0.15);
    // roughness: irregular amplitude modulation
    const am = v.gain(0.75), amn = v.noise('brown', t, T + 0.1, 1.5), amg = v.gain(1.2);
    v.chain(amn, amg, am.gain);
    const env = v.gain(0), sh = v.shaper(3), lp = v.filter('lowpass', 2400, 0.7), hp = v.filter('highpass', 45, 0.7);
    pts(env.gain, t, [[0, 0], [D * 0.18, 0.9], [D * 0.5, 0.75], [D * 0.8, 0.85], [D, 0]]);
    v.chain(F.out, am, env, sh, lp, hp, v.out);
    // wet throat
    const rt = v.buffer(pick(this.buf.rattle), t, T + 0.1, rand(0.7, 1), true, rand(0, 2)), rbp = v.filter('bandpass', 420, 1.2), rg = v.gain(0);
    pts(rg.gain, t, [[0, 0], [D * 0.2, 0.5], [D, 0]]);
    v.chain(rt, rbp, rg, v.out);
    v.until(T + 0.1);
    return this._handle(v);
  }

  creatureScream(pos, { dur = 2.2 } = {}) {
    const D = clamp(+dur || 2.2, 0.6, 6);
    const t = this._now(), T = t + D;
    const v = this._voice('cscream', { t, pos, gain: 0.85, send: 0.45 });
    // ---- pitch contour: gasp, sudden rise, waver, crack, falling off
    const fb = rand(430, 520);
    const f0 = v.constant(0, t, T + 0.1), F0 = f0.offset;
    F0.setValueAtTime(170, t);
    F0.linearRampToValueAtTime(280, t + 0.07);
    F0.exponentialRampToValueAtTime(fb * 2, t + 0.19);
    let s = t + 0.19;
    const tCrack = t + D * rand(0.45, 0.6);
    while (s < tCrack - 0.15) { s += rand(0.1, 0.2); F0.linearRampToValueAtTime(fb * 2 * rand(0.9, 1.08), s); }
    F0.setValueAtTime(fb * 2.8, tCrack);                        // voice cracks upward
    F0.linearRampToValueAtTime(fb * 2.95, tCrack + 0.12);
    F0.linearRampToValueAtTime(fb * 1.85, tCrack + 0.2);
    F0.linearRampToValueAtTime(fb * rand(1.7, 1.9), t + D * 0.75);
    F0.exponentialRampToValueAtTime(fb * 0.9, T);
    // vibrato + jitter (cents)
    const vib = v.osc('sine', rand(7.5, 10), t, T + 0.1), vibg = v.gain(45);
    vibg.gain.setValueAtTime(15, t); vibg.gain.linearRampToValueAtTime(70, T);
    vib.connect(vibg);
    const jit = v.noise('brown', t, T + 0.1, 0.8), jitg = v.gain(90);
    jit.connect(jitg);
    const src = v.gain(1);
    for (const [type, ratio, a, dt] of [['sawtooth', 1, 0.45, 0], ['sawtooth', 1, 0.35, 14], ['sawtooth', 1, 0.35, -13], ['pulse', 1, 0.3, 5]]) {
      const o = v.osc(type === 'pulse' ? this._wave('pulse') : type, 0, t, T + 0.1), r = v.gain(ratio), g = v.gain(a);
      o.detune.value = dt;
      v.chain(f0, r, o.frequency);
      vibg.connect(o.detune); jitg.connect(o.detune);
      v.chain(o, g, src);
    }
    // ---- moving formants (shrill, open vowel -> 'i' -> 'a' -> 'o')
    const F = v.formants(src, 1.12, 'a', [5, 7, 9], [1, 0.8, 0.5]);
    F.set('ae', t + 0.15, 0.05); F.set('i', t + D * 0.35, 0.12); F.set('ae', tCrack, 0.03); F.set('a', t + D * 0.7, 0.1); F.set('aw', t + D * 0.88, 0.1);
    const hi = v.filter('bandpass', 3800, 3), hig = v.gain(0.7); // screech resonance
    v.chain(src, hi, hig);
    const mix = v.gain(1);
    F.out.connect(mix); hig.connect(mix);
    // ---- subharmonic growl underneath (roughness), swelling at the crack
    const sub = v.osc('sawtooth', 0, t, T + 0.1), subr = v.gain(0.5), sublp = v.filter('lowpass', 1300, 0.8), subg = v.gain(0);
    v.chain(f0, subr, sub.frequency);
    jitg.connect(sub.detune);
    pts(subg.gain, t, [[0, 0.5], [0.15, 0.15], [tCrack - t - 0.05, 0.2], [tCrack - t + 0.05, 0.55], [D, 0.4]]);
    v.chain(sub, sublp, subg, mix);
    const gr = v.osc('sawtooth', rand(70, 90), t, T + 0.1), grj = v.gain(150), grlp = v.filter('lowpass', 700, 1), grg = v.gain(0);
    jit.connect(grj); grj.connect(gr.detune);
    pts(grg.gain, t, [[0, 0.6], [0.12, 0.15], [D * 0.7, 0.15], [D, 0.5]]);
    v.chain(gr, grlp, grg, mix);
    // ---- breath noise / rasp layer
    const br = v.noise('white', t, T + 0.1), brbp = v.filter('bandpass', 2600, 0.8), brg = v.gain(0.4);
    v.chain(br, brbp, brg, mix);
    const ra = v.noise('white', t, T + 0.1), rag = v.gain(0), rabp = v.filter('bandpass', 1800, 1), raout = v.gain(0.45);
    sub.connect(rag.gain); // noise ring-modulated by the subharmonic: pitched rasp
    v.chain(ra, rag, rabp, raout, mix);
    // ---- ring modulation for inhuman overtones (parallel)
    const rmf = rand(190, 280), ring = v.gain(0), rmo = v.osc('sine', rmf, t, T + 0.1), rmg = v.gain(1);
    rmo.frequency.setValueAtTime(rmf, t);
    rmo.frequency.linearRampToValueAtTime(rmf * rand(1.2, 1.5), T);
    v.chain(rmo, rmg, ring.gain);
    const ringOut = v.gain(0.4);
    v.chain(F.out, ring, ringOut, mix);
    // ---- drive, tone, amplitude envelope
    const sh = v.shaper(2.6, '4x'), pk = v.filter('peaking', 3000, 1, 4), lp = v.filter('lowpass', 9500, 0.7), hp = v.filter('highpass', 90, 0.7);
    const env = v.gain(0), flutter = v.gain(0.85), fl = v.osc('sine', rand(11, 15), t, T + 0.1), flg = v.gain(0.15);
    v.chain(fl, flg, flutter.gain);
    pts(env.gain, t, [[0, 0], [0.06, 0.25], [0.09, 0.15], [0.2, 1], [D * 0.45, 0.85], [tCrack - t, 0.8],
      [tCrack - t + 0.02, 1.05], [D * 0.68, 0.8], [D * 0.9, 0.35], [D, 0]]);
    v.chain(mix, sh, pk, lp, hp, env, flutter, v.out);
    v.until(T + 0.1);
    return this._handle(v);
  }

  creatureMove(pos, { speed = 0.5 } = {}) {
    const s = clamp(+speed || 0, 0, 1);
    const t = this._now();
    const v = this._voice('cmove', { t, pos, gain: 0.5 + 0.6 * s, send: 0.25 });
    // weight
    const f = rand(60, 78), o = v.osc('sine', f, t, t + 0.35), og = v.gain(0);
    o.frequency.setValueAtTime(f * 1.3, t); o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.09);
    perc(og.gain, t, 0.7, 0.12 + 0.05 * s, 0.003);
    v.chain(o, og, v.out);
    const b = v.noise('brown', t, t + 0.3), bl = v.filter('lowpass', 200, 0.7), bg = v.gain(0);
    perc(bg.gain, t, 0.8, 0.08, 0.002);
    v.chain(b, bl, bg, v.out);
    // bare skin slap on the floor
    const sl = v.noise('white', t, t + 0.15), slb = v.filter('bandpass', rand(900, 1400), 0.8), sll = v.filter('lowpass', 3000, 0.7), slg = v.gain(0);
    perc(slg.gain, t + 0.003, 0.7 + 0.3 * s, rand(0.025, 0.045), 0.001);
    v.chain(sl, slb, sll, slg, v.out);
    // sticky peel-off of the sole
    const pe = v.buffer(this.buf.crackle, t + 0.06, t + 0.25, rand(0.6, 0.9), true, rand(0, 2)), peb = v.filter('bandpass', 1800, 1), peg = v.gain(0);
    pts(peg.gain, t + 0.06, [[0, 0], [0.03, 0.25], [0.15, 0]]);
    v.chain(pe, peb, peg, v.out);
    // claw ticks as the toes come down
    const k = v.noise('white', t, t + 0.3), kbp = v.filter('bandpass', 4000, 3), kg = v.gain(0);
    const r = v.osc('sine', 2800, t, t + 0.3), rg = v.gain(0);
    v.chain(k, kbp, kg, v.out); v.chain(r, rg, v.out);
    let ct = t + rand(0.02, 0.05);
    for (let i = 0; i < irand(1, 3); i++) {
      kbp.frequency.setValueAtTime(rand(3000, 5500), ct);
      r.frequency.setValueAtTime(rand(2300, 3300), ct);
      perc(kg.gain, ct, rand(1, 2), 0.006, 0.0003);
      perc(rg.gain, ct, 0.08, 0.03, 0.0005);
      ct += rand(0.025, 0.07);
    }
    v.until(t + 0.4);
    // knuckles dragging now and then when it moves slowly
    if (s < 0.6 && chance(0.25)) this.creatureDrag(pos, { dur: rand(0.3, 0.7), t: t + rand(0.08, 0.2) });
  }

  // Extra: knuckles/claws dragged along the floor.
  creatureDrag(pos, { dur = 0.6, t: tAt } = {}) {
    const D = clamp(+dur || 0.6, 0.15, 3);
    const t = tAt ?? this._now();
    const v = this._voice('cdrag', { t, pos, gain: 1.6, send: 0.25 });
    const n = v.noise('white', t, t + D + 0.1), bp = v.filter('bandpass', rand(1000, 1600), 1.2), am = v.gain(0.4), g = v.gain(0);
    const gr = v.buffer(this.buf.grit, t, t + D + 0.1, rand(0.5, 0.8), true, rand(0, 1.5)), grg = v.gain(1.2);
    v.chain(gr, grg, am.gain);
    pts(g.gain, t, [[0, 0], [0.05, 0.6], [D * 0.7, 0.5], [D, 0]]);
    v.chain(n, bp, am, g, v.out);
    const sc = v.noise('white', t, t + D + 0.1), sch = v.filter('bandpass', 4200, 3), scg = v.gain(0);
    pts(scg.gain, t, [[0, 0], [0.04, 0.2], [D, 0]]);
    v.chain(sc, sch, scg, v.out);
    return this._handle(v);
  }

  creatureSniff(pos) {
    const t = this._now();
    const v = this._voice('csniff', { t, pos, gain: 0.75, send: 0.25 });
    const n = irand(2, 4);
    const T = t + n * 0.3 + 0.6;
    const air = v.noise('pink', t, T), bp1 = v.filter('bandpass', 2200, 2.5), bp2 = v.filter('bandpass', 900, 1.5), g1 = v.gain(1.2), g2 = v.gain(0.6), env = v.gain(0);
    air.connect(bp1); air.connect(bp2);
    v.chain(bp1, g1, env); v.chain(bp2, g2, env);
    env.connect(v.out);
    const sn = v.buffer(pick(this.buf.rattle), t, T, rand(0.5, 0.7), true, rand(0, 2)), snl = v.filter('lowpass', 700, 0.7), sng = v.gain(0);
    v.chain(sn, snl, sng, v.out);
    let s = t;
    for (let i = 0; i < n; i++) {
      const d = rand(0.09, 0.16) * (i === n - 1 ? 1.4 : 1), a = rand(0.6, 1);
      bp1.frequency.setValueAtTime(1600, s); bp1.frequency.linearRampToValueAtTime(rand(2600, 3200), s + d);
      pts(env.gain, s, [[0, 0], [d * 0.6, a], [d, a * 0.9], [d + 0.02, 0]]);
      if (chance(0.4)) pts(sng.gain, s, [[0, 0], [d * 0.5, 0.5], [d + 0.02, 0]]);
      s += d + rand(0.06, 0.13);
    }
    // a short wet huff out
    s += rand(0.05, 0.2);
    bp1.frequency.setValueAtTime(1200, s); bp1.frequency.linearRampToValueAtTime(700, s + 0.25);
    pts(env.gain, s, [[0, 0], [0.03, 0.55], [0.25, 0]]);
    pts(sng.gain, s, [[0, 0], [0.03, 0.4], [0.25, 0]]);
    v.until(s + 0.3);
    return this._handle(v);
  }

  // ------------------------------------------------------------- water (Chapter Two)
  // something heavy moving through or dropping into knee-deep water. size 0.2 (a hand) .. 2 (a body)
  splash(pos, size = 1) {
    const s = clamp(+size || 1, 0.1, 3);
    const t = this._now();
    const D = 0.35 + 0.5 * s;
    const v = this._voice('splash', { t, pos, gain: 0.9 * Math.pow(s, 0.5), send: 0.4 });
    const n = v.noise('white', t, t + D + 0.2), bp = v.filter('bandpass', rand(900, 1600) / Math.pow(s, 0.3), 0.5), g = v.gain(0);
    pts(g.gain, t, [[0, 0], [0.01, 0.9], [0.08 * s + 0.04, 0.55], [D, 0]]);
    v.chain(n, bp, g, v.out);
    const lo = v.noise('brown', t, t + D + 0.2), lol = v.filter('lowpass', 380, 0.8), log = v.gain(0);
    pts(log.gain, t, [[0, 0], [0.02, 0.8 * s], [D * 0.8, 0]]);
    v.chain(lo, lol, log, v.out);
    const nb = Math.round(irand(4, 9) * Math.sqrt(s));
    for (let i = 0; i < nb; i++) { // droplets falling back
      const st = t + rand(0.08, D), bf = rand(700, 2200), bo = v.osc('sine', bf, st, st + 0.07), bg = v.gain(0);
      bo.frequency.setValueAtTime(bf, st); bo.frequency.exponentialRampToValueAtTime(bf * rand(1.4, 2.3), st + 0.04);
      perc(bg.gain, st, rand(0.05, 0.16), 0.04, 0.002);
      v.chain(bo, bg, v.out);
    }
    v.until(t + D + 0.3);
  }

  // a long body pushing through water: a slow wash with a bow-wave hiss
  wade(pos, { speed = 0.5, dur = 0.9 } = {}) {
    const t = this._now(), sp = clamp(+speed || 0.5, 0, 1), D = clamp(+dur || 0.9, 0.2, 3);
    const v = this._voice('wade', { t, pos, gain: 0.5 + 0.6 * sp, send: 0.35 });
    const n = v.noise('pink', t, t + D + 0.1), bp = v.filter('bandpass', 500 + 700 * sp, 0.6), g = v.gain(0);
    pts(g.gain, t, [[0, 0], [D * 0.3, 0.7], [D * 0.75, 0.5], [D, 0]]);
    v.chain(n, bp, g, v.out);
    const h = v.noise('white', t, t + D + 0.1), hp = v.filter('highpass', 3000, 0.7), hg = v.gain(0);
    pts(hg.gain, t, [[0, 0], [D * 0.4, 0.12 * sp], [D, 0]]);
    v.chain(h, hp, hg, v.out);
    const nb = irand(1, 4);
    for (let i = 0; i < nb; i++) {
      const st = t + rand(0, D), bf = rand(250, 600), bo = v.osc('sine', bf, st, st + 0.12), bg = v.gain(0);
      bo.frequency.setValueAtTime(bf, st); bo.frequency.exponentialRampToValueAtTime(bf * 1.8, st + 0.08);
      perc(bg.gain, st, 0.2, 0.08, 0.004);
      v.chain(bo, bg, v.out);
    }
    v.until(t + D + 0.2);
  }

  // pressure escaping from a valve or a bleed screw. dur in seconds; strength 0..1
  valveHiss(pos, { dur = 1.2, strength = 0.7 } = {}) {
    const t = this._now(), D = clamp(+dur || 1.2, 0.1, 6), k = clamp(+strength || 0.7, 0.05, 1);
    const v = this._voice('hiss', { t, pos, gain: 0.7 * k, send: 0.3 });
    const n = v.noise('white', t, t + D + 0.2), hp = v.filter('highpass', 1800, 0.7), pk = v.filter('peaking', rand(3500, 6000), 2, 8), g = v.gain(0);
    pts(g.gain, t, [[0, 0], [0.03, 0.6], [D * 0.8, 0.45], [D, 0]]);
    v.chain(n, hp, pk, g, v.out);
    const wh = v.osc('sine', rand(900, 1400), t, t + D), whg = v.gain(0);
    wh.frequency.linearRampToValueAtTime(rand(600, 900), t + D);
    pts(whg.gain, t, [[0, 0], [0.1, 0.03 * k], [D, 0]]);
    v.chain(wh, whg, v.out);
    v.until(t + D + 0.3);
  }

  // a long pipe flexing under pressure: low metallic groan with a creak on top
  pipeGroan(pos, { dur = 2.2, depth = 1 } = {}) {
    const t = this._now(), D = clamp(+dur || 2.2, 0.4, 6);
    const v = this._voice('groan', { t, pos, gain: 0.8 * clamp(+depth || 1, 0.2, 2), send: 0.6 });
    const f = rand(48, 75), o = v.osc('sawtooth', f, t, t + D + 0.1), lp = v.filter('lowpass', 260, 4), g = v.gain(0);
    o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * rand(0.8, 1.25), t + D);
    pts(g.gain, t, [[0, 0], [D * 0.25, 0.35], [D * 0.6, 0.25], [D, 0]]);
    v.chain(o, lp, g, v.out);
    const cf = rand(180, 320), cr = v.osc('square', cf, t + D * 0.2, t + D), crb = v.filter('bandpass', cf * 3, 6), crg = v.gain(0), am = v.osc('square', rand(9, 18), t, t + D), amg = v.gain(0.5);
    am.connect(amg); amg.connect(crg.gain);
    pts(crg.gain, t + D * 0.2, [[0, 0], [D * 0.2, 0.05], [D * 0.6, 0]]);
    v.chain(cr, crb, crg, v.out);
    v.until(t + D + 0.3);
  }

  // a running pump: motor whine, impeller thrum, water rushing. Returns a handle: set(on), stop()
  pumpLoop(pos, on = true) {
    const eng = this;
    const h = {
      pos: pos ? { x: pos.x, y: pos.y, z: pos.z } : null, on: !!on, v: null, stopped: false,
      get active() { return !h.stopped; },
      _build() {
        if (h.v || h.stopped || !eng.ctx) return;
        const t = eng.ctx.currentTime + 0.02;
        const v = h.v = new Voice(eng, 'loop', { pos: h.pos, gain: 0, loop: true, send: 0.3 });
        const m = v.osc('sawtooth', 98, t), ml = v.filter('lowpass', 600, 1.5), mg = v.gain(0.06);
        v.chain(m, ml, mg, v.out);
        const w = v.osc('sine', 392, t), wg = v.gain(0.012);
        v.chain(w, wg, v.out);
        const thr = v.osc('sine', 24, t), thg = v.gain(0.18), am = v.gain(0.6), lfo = v.osc('sine', 6, t), lfg = v.gain(0.4);
        lfo.connect(lfg); lfg.connect(am.gain);
        v.chain(thr, am, thg, v.out);
        const r = v.noise('pinkSt', t), rb = v.filter('bandpass', 700, 0.5), rg = v.gain(0.05);
        v.chain(r, rb, rg, v.out);
        h.parts = { m, w };
        v.out.gain.setValueAtTime(0, t);
        if (h.on) h._spin(t, true);
      },
      _spin(t, up) {
        const { m, w } = h.parts;
        h.v.out.gain.cancelScheduledValues(t);
        h.v.out.gain.setTargetAtTime(up ? 1 : 0, t, up ? 0.8 : 1.2);
        for (const [o, f] of [[m, 98], [w, 392]]) { o.frequency.cancelScheduledValues(t); o.frequency.setValueAtTime(up ? f * 0.3 : f, t); o.frequency.setTargetAtTime(up ? f : f * 0.25, t, up ? 1.0 : 1.4); }
      },
      set(v) { h.on = !!v; if (h.v) h._spin(eng.ctx.currentTime, h.on); },
      setOn(v) { h.set(v); },
      stop(fade = 0.5) { if (h.stopped) return; h.stopped = true; eng._loops.delete(h); if (h.v) { h.v.kill(fade); eng.voices.push(h.v); } },
      setPosition(p) { if (p) { h.pos = { x: p.x, y: p.y, z: p.z }; if (h.v) h.v.setPosition(h.pos); } },
    };
    this._loops.add(h);
    if (this.ctx) h._build();
    return h;
  }

  // Long-running sources with an intensity: 'fan' (a huge ventilation fan), 'gas' (a vent hissing),
  // 'cage' (a mine cage hoisting: motor, rope, rattle), 'mask' (your own breathing in a respirator).
  // Returns a handle: set(level 0..1), stop(), setPosition(p)
  loop(kind, pos, level = 1) {
    const eng = this;
    const h = {
      pos: pos ? { x: pos.x, y: pos.y, z: pos.z } : null, level: clamp(+level || 0, 0, 1), v: null, stopped: false, kind,
      get active() { return !h.stopped; },
      _build() {
        if (h.v || h.stopped || !eng.ctx) return;
        const t = eng.ctx.currentTime + 0.02;
        const v = h.v = new Voice(eng, 'loop', { pos: h.pos, bus: h.pos ? undefined : 'ui', gain: 0, loop: true, send: kind === 'mask' ? 0.02 : 0.35 });
        if (kind === 'fan') {
          const r = v.noise('brownSt', t), rl = v.filter('lowpass', 180, 0.8), rg = v.gain(0.5);
          v.chain(r, rl, rg, v.out);
          const a = v.noise('pinkSt', t), ab = v.filter('bandpass', 420, 0.7), am = v.gain(0.5), ag = v.gain(0.16);
          const bl = v.osc('sine', 11, t), blg = v.gain(0.45); bl.connect(blg); blg.connect(am.gain); // blade pass
          v.chain(a, ab, am, ag, v.out);
          const hum = v.osc('sawtooth', 50, t), hl = v.filter('lowpass', 220, 2), hg = v.gain(0.05);
          v.chain(hum, hl, hg, v.out);
          h.parts = { bl, hum, rl };
        } else if (kind === 'gas') {
          const n = v.noise('white', t), hp = v.filter('highpass', 1500, 0.6), pk = v.filter('peaking', 4200, 1.5, 6), g = v.gain(0.22);
          v.chain(n, hp, pk, g, v.out);
          const l = v.noise('pinkSt', t), lb = v.filter('bandpass', 600, 0.7), lg = v.gain(0.08);
          v.chain(l, lb, lg, v.out);
          const sp = v.osc('sine', 0.3, t), spg = v.gain(0.06); sp.connect(spg); spg.connect(g.gain);
        } else if (kind === 'cage') {
          const m = v.osc('sawtooth', 62, t), ml = v.filter('lowpass', 500, 1.2), mg = v.gain(0.12);
          v.chain(m, ml, mg, v.out);
          const rope = v.noise('pinkSt', t), rb = v.filter('bandpass', 1300, 1.2), rg = v.gain(0.05);
          v.chain(rope, rb, rg, v.out);
          const rat = v.noise('white', t), rbp = v.filter('bandpass', 2600, 3), ram = v.gain(0), rag = v.gain(0.14);
          const ro = v.osc('square', 13, t), rog = v.gain(0.5); ro.connect(rog); rog.connect(ram.gain);
          v.chain(rat, rbp, ram, rag, v.out);
          const thud = v.osc('sine', 1.3, t), thg = v.gain(0.08), th = v.osc('sine', 40, t), tam = v.gain(0);
          thud.connect(thg); thg.connect(tam.gain); v.chain(th, tam, v.out);
          h.parts = { m };
        } else if (kind === 'mask') {
          // valve click and rubber-muffled breath, about 16 a minute, faster when afraid
          const n = v.noise('pink', t), bp = v.filter('bandpass', 900, 0.9), lp = v.filter('lowpass', 2200, 0.7), env = v.gain(0), g = v.gain(0.55);
          v.chain(n, bp, lp, env, g, v.out);
          h.parts = { env, bp };
          let next = t + 0.3, inhale = true;
          h.tick = eng._addTicker(next, (tt) => {
            if (h.stopped) return null;
            const rate = 0.75 + h.level * 0.9, D = (inhale ? 1.4 : 1.7) / rate;
            const e = env.gain;
            e.cancelScheduledValues(tt); e.setValueAtTime(0, tt);
            e.linearRampToValueAtTime(inhale ? 0.55 : 0.8, tt + D * 0.25); e.linearRampToValueAtTime(inhale ? 0.4 : 0.3, tt + D * 0.7); e.linearRampToValueAtTime(0, tt + D);
            bp.frequency.setValueAtTime(inhale ? 1200 : 700, tt); bp.frequency.linearRampToValueAtTime(inhale ? 1700 : 500, tt + D);
            const c = v.osc('square', inhale ? 1800 : 1200, tt + (inhale ? 0 : D * 0.05), tt + 0.02 + (inhale ? 0 : D * 0.05)), cg = v.gain(0.02);
            v.chain(c, cg, v.out);
            inhale = !inhale;
            return tt + D + (inhale ? rand(0.2, 0.6) / rate : 0.08);
          });
        }
        v.out.gain.setValueAtTime(0, t);
        h._apply(t, 1.2);
      },
      _apply(t, tc) {
        if (!h.v) return;
        const L = h.level;
        h.v.out.gain.cancelScheduledValues(t);
        h.v.out.gain.setTargetAtTime(kind === 'mask' ? (L > 0 ? 0.5 : 0) : L, t, tc);
        if (h.parts?.bl) { h.parts.bl.frequency.setTargetAtTime(2 + 9 * L, t, tc * 2); h.parts.hum.frequency.setTargetAtTime(20 + 30 * L, t, tc * 2); h.parts.rl.frequency.setTargetAtTime(90 + 120 * L, t, tc); }
        if (h.parts?.m) h.parts.m.frequency.setTargetAtTime(30 + 34 * L, t, tc);
      },
      set(l, tc = 0.8) { h.level = clamp(+l || 0, 0, 1); if (h.v) h._apply(eng.ctx.currentTime, tc); },
      stop(fade = 0.6) { if (h.stopped) return; h.stopped = true; eng._loops.delete(h); if (h.tick) eng._tickers.delete(h.tick); if (h.v) { h.v.kill(fade); eng.voices.push(h.v); } },
      setPosition(p) { if (p) { h.pos = { x: p.x, y: p.y, z: p.z }; if (h.v) h.v.setPosition(h.pos); } },
    };
    this._loops.add(h);
    if (this.ctx) h._build();
    return h;
  }

  // breath shaped into words you can't make out, very close. pos null = inside your head
  whisper(pos, { dur = 1.6, level = 0.6 } = {}) {
    const t = this._now(), D = clamp(+dur || 1.6, 0.4, 5);
    const v = this._voice('whisper', { t, pos, bus: pos ? undefined : 'ui', gain: 0.5 * clamp(+level || 0.6, 0, 1.5), send: 0.25, pan: pos ? undefined : rand(-0.8, 0.8) });
    const n = v.noise('pink', t, t + D + 0.1), hp = v.filter('highpass', 700, 0.7), env = v.gain(0);
    const f1 = v.filter('bandpass', 700, 6), f2 = v.filter('bandpass', 1500, 8), f3 = v.filter('bandpass', 2900, 9), mix = v.gain(1.6);
    v.chain(n, hp, env); env.connect(f1); env.connect(f2); env.connect(f3); f1.connect(mix); f2.connect(mix); f3.connect(mix); mix.connect(v.out);
    let s = t;
    const vowels = [[300, 2300, 3000], [700, 1200, 2600], [500, 900, 2400], [400, 1900, 2600], [650, 1700, 2700]];
    while (s < t + D) { // syllables
      const L = rand(0.12, 0.3), [a, b, c] = pick(vowels);
      f1.frequency.setTargetAtTime(a, s, 0.03); f2.frequency.setTargetAtTime(b, s, 0.03); f3.frequency.setTargetAtTime(c, s, 0.03);
      env.gain.setTargetAtTime(rand(0.5, 1), s, 0.02); env.gain.setTargetAtTime(chance(0.3) ? 0.05 : 0.25, s + L * 0.7, 0.03);
      s += L + (chance(0.2) ? rand(0.1, 0.3) : 0);
    }
    env.gain.setTargetAtTime(0, t + D, 0.05);
    const sib = v.noise('white', t, t + D), shp = v.filter('highpass', 5000, 0.7), sg = v.gain(0);
    for (let k = 0; k < 3; k++) { const st = t + rand(0, D); perc(sg.gain, st, 0.12, 0.12, 0.02); }
    v.chain(sib, shp, sg, v.out);
    v.until(t + D + 0.3);
  }

  // stone letting go: a crack, then rubble pouring
  rockfall(pos, size = 1) {
    const t = this._now(), s = clamp(+size || 1, 0.2, 3), D = 0.8 + s * 1.2;
    const v = this._voice('rock', { t, pos, gain: 0.8 * Math.sqrt(s), send: 0.6 });
    const cr = v.noise('white', t, t + 0.08), cb = v.filter('bandpass', 1800, 0.8), cg = v.gain(0);
    perc(cg.gain, t, 0.9, 0.05, 0.001); v.chain(cr, cb, cg, v.out);
    const b = v.osc('sine', 55, t, t + 0.6), bg = v.gain(0); b.frequency.exponentialRampToValueAtTime(32, t + 0.4); perc(bg.gain, t, 0.8 * s, 0.4, 0.003); v.chain(b, bg, v.out);
    const r = v.noise('brown', t + 0.05, t + D), rl = v.filter('lowpass', 900, 0.6), rg = v.gain(0);
    pts(rg.gain, t + 0.05, [[0, 0], [0.1, 0.7], [D * 0.6, 0.4], [D - 0.05, 0]]); v.chain(r, rl, rg, v.out);
    for (let i = 0; i < 10 * s; i++) { const st = t + rand(0.05, D), f = rand(400, 1600); v.modes(st, [f, f * 2.3], [0.05, 0.03], [0.12, 0.05], v.out); }
    v.until(t + D + 0.3);
  }

  // knuckles (or something harder) on sheet metal: n knocks, evenly, deliberately
  knock(pos, { n = 3, gap = 0.55, hard = 0.7 } = {}) {
    const t = this._now(), N = clamp(n | 0, 1, 12);
    const v = this._voice('knock', { t, pos, gain: 0.7 * clamp(+hard || 0.7, 0.1, 1.5), send: 0.45 });
    const f = rand(140, 220);
    for (let i = 0; i < N; i++) {
      const st = t + i * gap * rand(0.97, 1.03);
      v.modes(st, [f, f * 1.7, f * 2.6, f * 3.9], [0.35, 0.25, 0.15, 0.1], [0.7, 0.4, 0.25, 0.12], v.out);
      const nn = v.noise('white', st, st + 0.03), nb = v.filter('bandpass', 1400, 1), ng = v.gain(0);
      perc(ng.gain, st, 0.5, 0.012, 0.001); v.chain(nn, nb, ng, v.out);
    }
    v.until(t + N * gap + 1);
  }

  // the old workings: deep, close stone; drips in pools; rock ticking as it settles; air moving in far shafts
  _bedMine(bed, t) {
    const v = bed.v, o = v.out;
    const room = v.noise('brownSt', t), rl = v.filter('lowpass', 70, 0.7), rg = v.gain(0.16);
    v.chain(room, rl, rg, o);
    const air = v.noise('pinkSt', t), ab = v.filter('bandpass', 260, 0.6), ag = v.gain(0.025);
    v.chain(air, ab, ag, o);
    const moan = v.noise('pinkSt', t), mb = v.filter('bandpass', 180, 12), mg = v.gain(0);
    v.chain(moan, mb, mg, o);
    this._bedTicker(bed, t + 3, (tt) => { const on = chance(0.4); mg.gain.setTargetAtTime(on ? rand(0.05, 0.12) : 0, tt, 3); mb.frequency.setTargetAtTime(rand(120, 260), tt, 4); return tt + rand(6, 16); });
    for (let k = 0; k < 3; k++) {
      const period = rand(1.4, 4.5), pan = rand(-0.9, 0.9), f = rand(500, 1300), lvl = rand(0.04, 0.09);
      this._bedTicker(bed, t + rand(0.5, 4), (tt) => { this._drip(tt, pan, f * rand(0.95, 1.05), lvl * rand(0.6, 1.1), chance(0.7)); return tt + period * rand(0.85, 1.2); });
    }
    this._bedTicker(bed, t + rand(2, 6), (tt) => { const n = chance(0.3) ? irand(2, 4) : 1; for (let i = 0; i < n; i++) this._ambTink(tt + i * rand(0.1, 0.4), rand(-1, 1), rand(0.015, 0.035), false); return tt + rand(4, 13); });
    this._bedTicker(bed, t + rand(10, 25), (tt) => { if (chance(0.6)) this._ambThud(tt, rand(-1, 1), rand(0.05, 0.12)); else this._ambCreak(tt, rand(-1, 1), rand(0.05, 0.1), 'wood', true); return tt + rand(14, 40); });
  }

  // the purge: every fan in the site running at once, a klaxon somewhere far, gas in the ducts
  _bedPurge(bed, t) {
    const v = bed.v, o = v.out;
    const r = v.noise('brownSt', t), rl = v.filter('lowpass', 140, 0.7), rg = v.gain(0.22);
    v.chain(r, rl, rg, o);
    const d = v.noise('pinkSt', t), db = v.filter('bandpass', 520, 0.5), dg = v.gain(0.05);
    v.chain(d, db, dg, o);
    const hiss = v.noise('pinkSt', t), hh = v.filter('highpass', 3500, 0.6), hg = v.gain(0.012);
    v.chain(hiss, hh, hg, o);
    this._bedTicker(bed, t + rand(2, 5), (tt) => {
      const vv = this._voice('amb', { t: tt, bus: 'amb', pan: rand(-1, 1), gain: 0.02, send: 0.95 });
      const f = 520; for (let i = 0; i < 3; i++) { const st = tt + i * 0.9, ko = vv.osc('square', f, st, st + 0.6), kl = vv.filter('lowpass', 1200, 0.7), kg = vv.gain(0); pts(kg.gain, st, [[0, 0], [0.05, 1], [0.5, 1], [0.6, 0]]); ko.frequency.setValueAtTime(f, st); ko.frequency.linearRampToValueAtTime(f * 0.8, st + 0.6); vv.chain(ko, kl, kg, vv.out); }
      vv.until(tt + 3);
      return tt + rand(9, 18);
    });
    this._bedTicker(bed, t + rand(4, 9), (tt) => { if (chance(0.6)) this._ambCreak(tt, rand(-1, 1), rand(0.06, 0.12), 'metal', true); else this._ambClank(tt, rand(-1, 1), rand(0.05, 0.1)); return tt + rand(6, 15); });
  }

  // an old electromechanical phone bell: two strikes-trains, the second shorter
  phoneRing(pos) {
    const t = this._now();
    const v = this._voice('ring', { t, pos, gain: 0.5, send: 0.5 });
    const f = 1150;
    for (const [s0, D] of [[0, 0.9], [1.25, 0.9]]) {
      for (let k = 0; k < D * 20; k++) {
        const st = t + s0 + k / 20;
        v.modes(st, [f, f * 1.48, f * 2.71, f * 0.51], [0.25, 0.18, 0.1, 0.3], [0.3, 0.2, 0.1, 0.15], v.out);
      }
    }
    v.until(t + 2.6);
  }

  // flooded sublevel bed: lapping water, drips into deep water, distant pipe groans, a far-off rush
  _bedFlooded(bed, t) {
    const v = bed.v, o = v.out;
    const lap = v.noise('pinkSt', t), lapl = v.filter('lowpass', 420, 0.8), lapAm = v.gain(0.5), lapg = v.gain(0.09);
    const lfo = v.osc('sine', 0.37, t), lfg = v.gain(0.35);
    lfo.connect(lfg); lfg.connect(lapAm.gain);
    v.chain(lap, lapl, lapAm, lapg, o);
    const room = v.noise('brownSt', t), rl = v.filter('lowpass', 120, 0.7), rg = v.gain(0.12);
    v.chain(room, rl, rg, o);
    const rush = v.noise('pinkSt', t), rbp = v.filter('bandpass', 900, 0.6), rug = v.gain(0.0);
    v.chain(rush, rbp, rug, o);
    this._bedTicker(bed, t + 2, (tt) => { rug.gain.setTargetAtTime(chance(0.5) ? rand(0.004, 0.02) : 0, tt, 2.5); return tt + rand(5, 14); });
    for (let k = 0; k < 3; k++) {
      const period = rand(0.9, 2.6), pan = rand(-0.9, 0.9), f = rand(350, 800), lvl = rand(0.05, 0.1);
      this._bedTicker(bed, t + rand(0.3, 3), (tt) => { this._drip(tt, pan, f * rand(0.92, 1.08), lvl * rand(0.6, 1.1), true); return tt + period * rand(0.8, 1.2); });
    }
    this._bedTicker(bed, t + rand(6, 12), (tt) => {
      if (chance(0.6)) this._ambCreak(tt, rand(-1, 1), rand(0.06, 0.12), 'metal', true);
      else this._ambClank(tt, rand(-1, 1), rand(0.04, 0.09));
      return tt + rand(9, 22);
    });
  }

  // Stop everything (e.g. on game over / pause menu).
  stopAll(fade = 0.3) {
    if (!this.ctx) return;
    for (const v of this.voices) v.kill(fade);
    this.setAmbience('none', 0, fade);
    this.setTension(0);
    if (this._tension) {
      const g = this._tension.out.gain, n = this.ctx.currentTime;
      g.cancelScheduledValues(n); g.setValueAtTime(g.value, n); g.setTargetAtTime(0, n, fade / 4);
      this._tension.offAt = n + fade * 2 + 0.2;
    }
    this.heartbeat(0);
    this.alarm(false);
    for (const h of [...this._loops]) h.stop(fade);
  }
}

// --- fail-silent wrappers: one-shots no-op unless the context is running;
//     everything is wrapped in try/catch.
const ONE_SHOTS = ['stinger', 'pa', 'radio', 'beep', 'powerDown', 'powerUp', 'doorSlide', 'doorBang', 'doorSmash',
  'glassKnock', 'glassCrack', 'glassShatter', 'metalImpact', 'debris', 'footstep', 'deconSpray', 'strobeCharge',
  'strobeFlash', 'creatureBreath', 'creatureClick', 'creatureCrack', 'creatureGrowl', 'creatureScream',
  'creatureMove', 'creatureDrag', 'creatureSniff', 'splash', 'wade', 'valveHiss', 'pipeGroan', 'whisper', 'rockfall', 'knock', 'phoneRing'];
const STATEFUL = ['setListener', 'setMasterVolume', 'setReverb', 'setAmbience', 'setTension', 'heartbeat', 'alarm', 'lightBuzz', 'pumpLoop', 'loop', 'stopAll'];
const FALLBACK = {
  radio: (a) => new Promise((r) => setTimeout(r, Math.max(0, +a[0] || 0) * 1000)),
  creatureBreath: () => NOOP_HANDLE, creatureGrowl: () => NOOP_HANDLE, creatureScream: () => NOOP_HANDLE,
  creatureDrag: () => NOOP_HANDLE, creatureSniff: () => NOOP_HANDLE,
  deconSpray: () => NOOP_HANDLE,
  strobeCharge: () => NOOP_HANDLE,
  lightBuzz: () => NOOP_HANDLE,
  loop: () => NOOP_HANDLE,
  pumpLoop: () => NOOP_HANDLE,
};
for (const name of ONE_SHOTS) {
  const fn = AudioEngine.prototype[name];
  AudioEngine.prototype[name] = function (...a) {
    if (!this.ready) return FALLBACK[name] ? FALLBACK[name](a) : undefined;
    try { return fn.apply(this, a); } catch (e) { this._err(e); return FALLBACK[name] ? FALLBACK[name](a) : undefined; }
  };
}
for (const name of STATEFUL) {
  const fn = AudioEngine.prototype[name];
  AudioEngine.prototype[name] = function (...a) {
    try { return fn.apply(this, a); } catch (e) { this._err(e); return FALLBACK[name] ? FALLBACK[name](a) : undefined; }
  };
}

export const audio = new AudioEngine();
