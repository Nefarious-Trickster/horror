// Procedural, spatialised sound. Nothing is sampled: every sound is synthesised so the
// game ships with zero audio assets. Occlusion is approximated by low-passing sources
// the listener can't see.

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.volume = 0.85;
    this.tension = 0;
    this.occlusionFn = null; // (x,z) => boolean visible
  }

  init() {
    if (this.ctx) return;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);

    // reverb bus
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.6);
    this.reverbGain = ctx.createGain(); this.reverbGain.gain.value = 0.55;
    this.reverb.connect(this.reverbGain).connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master); this.sfx.connect(this.reverb);
    this.dry = ctx.createGain(); this.dry.connect(this.master);  // UI / non-reverb

    this.white = this.noiseBuffer('white', 3);
    this.brown = this.noiseBuffer('brown', 6);
    this.pink = this.noiseBuffer('pink', 4);
    this.distCurve = this.makeDist(30);

    this.startAmbience();
    this.enabled = true;
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1); }
  get now() { return this.ctx.currentTime; }

  impulse(sec, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // early reflections cluster + diffuse tail
        const er = i < ctx.sampleRate * 0.08 && Math.random() < 0.004 ? (Math.random() * 2 - 1) * 0.8 : 0;
        d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - t, decay) + er) * 0.6;
      }
    }
    return b;
  }
  noiseBuffer(type, sec) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0, b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (type === 'white') d[i] = w;
      else if (type === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      }
    }
    return b;
  }
  makeDist(k) {
    const n = 2048, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / n) * 2 - 1; c[i] = ((3 + k) * x * 20 * Math.PI / 180) / (Math.PI + k * Math.abs(x)); }
    return c;
  }

  // ---------------------------------------------------------------- routing
  // returns an input node; if pos is given, spatialises + occludes
  out(pos, opt = {}) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = opt.gain ?? 1;
    if (!pos) { g.connect(opt.dry ? this.dry : this.sfx); return g; }
    const p = ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
    p.refDistance = opt.ref ?? 1.2; p.rolloffFactor = opt.rolloff ?? 1.3; p.maxDistance = 60;
    p.positionX.value = pos.x; p.positionY.value = pos.y ?? 1; p.positionZ.value = pos.z;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    const visible = this.occlusionFn ? this.occlusionFn(pos.x, pos.z) : true;
    f.frequency.value = visible ? 18000 : (opt.occludedCutoff ?? 700);
    if (!visible) g.gain.value *= 0.6;
    g.connect(f).connect(p).connect(this.sfx);
    g._panner = p; g._filter = f;
    return g;
  }

  env(param, t0, a, peak, d, end = 0.0001) {
    param.cancelScheduledValues(t0);
    param.setValueAtTime(0.0001, t0);
    param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    param.exponentialRampToValueAtTime(Math.max(0.0001, end), t0 + a + d);
  }
  noise(buf = this.white, loop = true) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf; s.loop = loop;
    s.loopStart = 0; s.playbackRate.value = 1;
    return s;
  }
  osc(type, f) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; }
  bq(type, f, Q = 1) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = Q; return b; }

  // ---------------------------------------------------------------- ambience
  startAmbience() {
    const ctx = this.ctx, t = ctx.currentTime;
    // sub drone
    this.amb = ctx.createGain(); this.amb.gain.value = 0; this.amb.connect(this.sfx);
    this.amb.gain.setTargetAtTime(1, t, 3);
    const lp = this.bq('lowpass', 140, 0.7); lp.connect(this.amb);
    for (const [f, det] of [[41.2, 0], [55.1, 7], [61.7, -9]]) {
      const o = this.osc('sawtooth', f); o.detune.value = det;
      const g = ctx.createGain(); g.gain.value = 0.018;
      o.connect(g).connect(lp); o.start();
    }
    const lfo = this.osc('sine', 0.05); const lg = ctx.createGain(); lg.gain.value = 60;
    lfo.connect(lg).connect(lp.frequency); lfo.start();
    // pressure rumble: water mass overhead
    const rn = this.noise(this.brown); const rf = this.bq('lowpass', 180, 0.5);
    const rg = ctx.createGain(); rg.gain.value = 0.11;
    rn.connect(rf).connect(rg).connect(this.amb); rn.start();
    const rl = this.osc('sine', 0.031); const rlg = ctx.createGain(); rlg.gain.value = 0.06;
    rl.connect(rlg).connect(rg.gain); rl.start();
    // air / room tone
    const an = this.noise(this.pink); const af = this.bq('bandpass', 900, 0.4); const ag = ctx.createGain(); ag.gain.value = 0.012;
    an.connect(af).connect(ag).connect(this.amb); an.start();
    // tension strings: high dissonant cluster, gain follows tension
    this.tensionGain = ctx.createGain(); this.tensionGain.gain.value = 0;
    const tf = this.bq('bandpass', 1400, 0.8);
    this.tensionGain.connect(tf).connect(this.sfx);
    for (const f of [1108, 1175, 1245, 1661, 1760]) {
      const o = this.osc('sawtooth', f);
      const g = ctx.createGain(); g.gain.value = 0.006;
      const trem = this.osc('sine', 4 + Math.random() * 3); const tg = ctx.createGain(); tg.gain.value = 0.004;
      trem.connect(tg).connect(g.gain); trem.start();
      o.detune.value = (Math.random() - 0.5) * 30;
      o.connect(g).connect(this.tensionGain); o.start();
    }
    // low "heartbeat-ish" pulse layer for danger
    this.dangerGain = ctx.createGain(); this.dangerGain.gain.value = 0;
    const dOsc = this.osc('sine', 46);
    const dLfo = this.osc('square', 1.4); const dlg = ctx.createGain(); dlg.gain.value = 0.5;
    const dAmt = ctx.createGain(); dAmt.gain.value = 0.5;
    dLfo.connect(dlg).connect(dAmt.gain);
    dOsc.connect(dAmt).connect(this.dangerGain).connect(this.sfx);
    dOsc.start(); dLfo.start();
    this.dangerLfo = dLfo;
  }

  setTension(v, danger = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tensionGain.gain.setTargetAtTime(Math.min(1, v) * 0.9, t, 0.8);
    this.dangerGain.gain.setTargetAtTime(Math.min(1, danger) * 0.5, t, 0.4);
    this.dangerLfo.frequency.setTargetAtTime(1.1 + danger * 1.4, t, 0.5);
  }

  // continuous positional loops (machinery, hum). returns controller
  loop(kind, pos, opt = {}) {
    const ctx = this.ctx;
    const g = this.out(pos, { gain: 0, ref: opt.ref ?? 1.5, rolloff: opt.rolloff ?? 1.2 });
    const nodes = [];
    const level = opt.gain ?? 1;
    if (kind === 'hum') { // fluorescent ballast hum + buzz
      const o1 = this.osc('sawtooth', 120); const f = this.bq('bandpass', 240, 3);
      const o2 = this.osc('square', 60); const g2 = ctx.createGain(); g2.gain.value = 0.15;
      o1.connect(f); o2.connect(g2).connect(f);
      const og = ctx.createGain(); og.gain.value = 0.05; f.connect(og).connect(g);
      o1.start(); o2.start(); nodes.push(o1, o2);
    } else if (kind === 'generator') {
      const o = this.osc('sawtooth', 28); const f = this.bq('lowpass', 220, 4);
      const am = this.osc('square', 14); const amg = ctx.createGain(); amg.gain.value = 0.4;
      const og = ctx.createGain(); og.gain.value = 0.35;
      am.connect(amg).connect(og.gain);
      o.connect(f).connect(og).connect(g);
      const n = this.noise(this.brown); const nf = this.bq('bandpass', 400, 1); const ng = ctx.createGain(); ng.gain.value = 0.25;
      n.connect(nf).connect(ng).connect(g);
      const rattle = this.noise(this.white); const rf = this.bq('bandpass', 3000, 2); const rg = ctx.createGain(); rg.gain.value = 0.03;
      rattle.connect(rf).connect(rg).connect(g);
      o.start(); am.start(); n.start(); rattle.start(); nodes.push(o, am, n, rattle);
    } else if (kind === 'pump') {
      const n = this.noise(this.brown); const f = this.bq('lowpass', 300, 2); const ng = ctx.createGain(); ng.gain.value = 0.5;
      const o = this.osc('triangle', 49); const og = ctx.createGain(); og.gain.value = 0.2;
      const w = this.noise(this.pink); const wf = this.bq('bandpass', 700, 0.6); const wg = ctx.createGain(); wg.gain.value = 0.25;
      n.connect(f).connect(ng).connect(g); o.connect(og).connect(g); w.connect(wf).connect(wg).connect(g);
      n.start(); o.start(); w.start(); nodes.push(n, o, w);
    } else if (kind === 'water') { // trickling stream
      const n = this.noise(this.white); const f = this.bq('bandpass', 1800, 0.9); const ng = ctx.createGain(); ng.gain.value = 0.08;
      const l = this.osc('sine', 7.3); const lg = ctx.createGain(); lg.gain.value = 600;
      l.connect(lg).connect(f.frequency);
      n.connect(f).connect(ng).connect(g); n.start(); l.start(); nodes.push(n, l);
    } else if (kind === 'lift') {
      const o = this.osc('sawtooth', 70); const f = this.bq('lowpass', 300, 2); const og = ctx.createGain(); og.gain.value = 0.2;
      const n = this.noise(this.brown); const ng = ctx.createGain(); ng.gain.value = 0.3;
      o.connect(f).connect(og).connect(g); n.connect(ng).connect(g); o.start(); n.start(); nodes.push(o, n);
    }
    g.gain.setTargetAtTime(level, ctx.currentTime, opt.fade ?? 0.5);
    return {
      set: (v, tc = 0.3) => g.gain.setTargetAtTime(v, ctx.currentTime, tc),
      stop: (tc = 0.5) => {
        g.gain.setTargetAtTime(0, ctx.currentTime, tc);
        setTimeout(() => nodes.forEach((n) => { try { n.stop(); } catch { /* */ } }), tc * 6000);
      },
      pos: (p) => { if (g._panner) { g._panner.positionX.value = p.x; g._panner.positionZ.value = p.z; } },
      occlude: (visible) => { if (g._filter) g._filter.frequency.setTargetAtTime(visible ? 18000 : 700, ctx.currentTime, 0.15); },
    };
  }

  // ---------------------------------------------------------------- one-shots
  drip(pos) {
    const t = this.now, o = this.osc('sine', 1400 + Math.random() * 1600);
    o.frequency.exponentialRampToValueAtTime(400 + Math.random() * 300, t + 0.07);
    const g = this.out(pos, { gain: 0.25, ref: 1.5 });
    const e = this.ctx.createGain(); this.env(e.gain, t, 0.002, 1, 0.09);
    o.connect(e).connect(g); o.start(t); o.stop(t + 0.15);
  }

  creak(pos, big = false) {
    // groaning steel under pressure
    const t = this.now, dur = big ? 3.5 : 1.6 + Math.random();
    const o = this.osc('sawtooth', big ? 38 : 70 + Math.random() * 60);
    o.frequency.setValueAtTime(o.frequency.value, t);
    o.frequency.linearRampToValueAtTime(o.frequency.value * (0.7 + Math.random() * 0.6), t + dur);
    const fm = this.osc('sine', 9 + Math.random() * 14); const fmg = this.ctx.createGain(); fmg.gain.value = 18;
    fm.connect(fmg).connect(o.frequency);
    const bp = this.bq('bandpass', big ? 300 : 600 + Math.random() * 500, 6);
    const bp2 = this.bq('bandpass', 1300, 9);
    const e = this.ctx.createGain(); this.env(e.gain, t, dur * 0.3, 1, dur * 0.7);
    const g = this.out(pos, { gain: big ? 0.9 : 0.35, ref: 4, rolloff: 0.6 });
    o.connect(bp).connect(e); o.connect(bp2).connect(e); e.connect(g);
    o.start(t); fm.start(t); o.stop(t + dur + 0.1); fm.stop(t + dur + 0.1);
  }

  bang(pos, gain = 1) {
    const t = this.now;
    const n = this.noise(this.white, false); const f = this.bq('lowpass', 900, 1);
    const e = this.ctx.createGain(); this.env(e.gain, t, 0.002, 1, 0.5);
    const o = this.osc('sine', 75); o.frequency.exponentialRampToValueAtTime(38, t + 0.4);
    const oe = this.ctx.createGain(); this.env(oe.gain, t, 0.002, 1.2, 0.6);
    // metallic ring
    const r = this.osc('triangle', 312); const r2 = this.osc('triangle', 471);
    const re = this.ctx.createGain(); this.env(re.gain, t, 0.002, 0.15, 1.6);
    const g = this.out(pos, { gain: 0.8 * gain, ref: 3, rolloff: 0.7 });
    n.connect(f).connect(e).connect(g); o.connect(oe).connect(g); r.connect(re); r2.connect(re); re.connect(g);
    n.start(t); o.start(t); r.start(t); r2.start(t);
    n.stop(t + 0.6); o.stop(t + 0.7); r.stop(t + 1.7); r2.stop(t + 1.7);
  }

  footstep(surface, intensity, pos = null, heavy = false) {
    const t = this.now;
    const ctx = this.ctx;
    const g = this.out(pos, { gain: (heavy ? 1.0 : 0.45) * intensity, ref: heavy ? 2 : 1 });
    // heel thump
    const o = this.osc('sine', heavy ? 55 : 95); o.frequency.exponentialRampToValueAtTime(heavy ? 30 : 50, t + 0.08);
    const oe = ctx.createGain(); this.env(oe.gain, t, 0.003, heavy ? 1.2 : 0.6, 0.12);
    o.connect(oe).connect(g); o.start(t); o.stop(t + 0.2);
    // surface layer
    const n = this.noise(this.white, false);
    n.playbackRate.value = 0.8 + Math.random() * 0.4;
    let f, dur = 0.06;
    if (surface === 'water') { f = this.bq('lowpass', 1800, 0.8); f.frequency.exponentialRampToValueAtTime(500, t + 0.25); dur = 0.25; }
    else if (surface === 'metal') { f = this.bq('bandpass', 2400, 4); dur = 0.05; }
    else if (surface === 'tile') { f = this.bq('bandpass', 3200, 1.5); dur = 0.035; }
    else if (surface === 'concrete') { f = this.bq('bandpass', 1500, 1.2); dur = 0.05; }
    else { f = this.bq('bandpass', 1100, 1.0); dur = 0.05; } // linoleum: softer squeak
    const ne = ctx.createGain(); this.env(ne.gain, t + 0.01, 0.003, heavy ? 0.6 : 0.5, dur);
    n.connect(f).connect(ne).connect(g); n.start(t); n.stop(t + dur + 0.1);
    if (surface === 'metal') {
      const r = this.osc('triangle', 820 + Math.random() * 300); const re = ctx.createGain(); this.env(re.gain, t, 0.002, 0.08, 0.3);
      r.connect(re).connect(g); r.start(t); r.stop(t + 0.35);
    }
    if (surface === 'linoleum' && !heavy && Math.random() < 0.15) {
      const s = this.osc('sine', 1800 + Math.random() * 900); const se = ctx.createGain(); this.env(se.gain, t + 0.04, 0.01, 0.04, 0.07);
      s.frequency.linearRampToValueAtTime(s.frequency.value * 1.2, t + 0.1);
      s.connect(se).connect(g); s.start(t); s.stop(t + 0.2);
    }
    if (heavy) { // claws clicking
      for (let i = 0; i < 3; i++) {
        const c = this.noise(this.white, false); const cf = this.bq('highpass', 4000, 1); const ce = ctx.createGain();
        const tt = t + 0.05 + i * 0.03 + Math.random() * 0.02;
        this.env(ce.gain, tt, 0.001, 0.5, 0.015);
        c.connect(cf).connect(ce).connect(g); c.start(tt); c.stop(tt + 0.05);
      }
    }
  }

  doorOpen(pos, slam = false) {
    const t = this.now, ctx = this.ctx;
    const g = this.out(pos, { gain: slam ? 1 : 0.5, ref: 2 });
    // latch click
    const c = this.noise(this.white, false); const cf = this.bq('bandpass', 3500, 3); const ce = ctx.createGain();
    this.env(ce.gain, t, 0.001, 0.8, 0.03);
    c.connect(cf).connect(ce).connect(g); c.start(t); c.stop(t + 0.06);
    // hinge creak
    const o = this.osc('sawtooth', slam ? 220 : 160 + Math.random() * 120);
    o.frequency.linearRampToValueAtTime(o.frequency.value * (slam ? 0.7 : 1.6), t + (slam ? 0.3 : 0.9));
    const fm = this.osc('square', 30 + Math.random() * 20); const fmg = ctx.createGain(); fmg.gain.value = 25;
    fm.connect(fmg).connect(o.frequency);
    const bp = this.bq('bandpass', 1200, 8); const oe = ctx.createGain();
    this.env(oe.gain, t + 0.05, 0.1, slam ? 0.4 : 0.6, slam ? 0.3 : 0.9);
    o.connect(bp).connect(oe).connect(g); o.start(t); fm.start(t); o.stop(t + 1.2); fm.stop(t + 1.2);
    if (slam) setTimeout(() => this.bang(pos, 0.9), 220);
  }

  gateRattle(pos, dur = 3) {
    const t = this.now, ctx = this.ctx;
    const g = this.out(pos, { gain: 0.7, ref: 3 });
    const n = this.noise(this.white); const f = this.bq('bandpass', 2200, 2);
    const am = this.osc('square', 22); const amg = ctx.createGain(); amg.gain.value = 0.5;
    const e = ctx.createGain(); e.gain.value = 0.5; am.connect(amg).connect(e.gain);
    const m = this.osc('sawtooth', 50); const mf = this.bq('lowpass', 200); const me = ctx.createGain(); me.gain.value = 0.4;
    n.connect(f).connect(e).connect(g); m.connect(mf).connect(me).connect(g);
    g.gain.setValueAtTime(0.7, t + dur - 0.2); g.gain.linearRampToValueAtTime(0, t + dur);
    n.start(t); am.start(t); m.start(t); n.stop(t + dur); am.stop(t + dur); m.stop(t + dur);
    setTimeout(() => this.bang(pos, 0.7), dur * 1000);
  }

  spark(pos) {
    const t = this.now, ctx = this.ctx;
    const g = this.out(pos, { gain: 0.35 });
    for (let i = 0; i < 6; i++) {
      const tt = t + Math.random() * 0.25;
      const n = this.noise(this.white, false); const f = this.bq('highpass', 2500); const e = ctx.createGain();
      this.env(e.gain, tt, 0.001, 0.6, 0.02 + Math.random() * 0.04);
      n.connect(f).connect(e).connect(g); n.start(tt); n.stop(tt + 0.1);
    }
  }

  buzz(pos, dur = 0.3) {
    const t = this.now, ctx = this.ctx;
    const o = this.osc('sawtooth', 120); const f = this.bq('bandpass', 1800, 2);
    const e = ctx.createGain(); this.env(e.gain, t, 0.01, 0.25, dur);
    const g = this.out(pos, { gain: 0.5 });
    o.connect(f).connect(e).connect(g); o.start(t); o.stop(t + dur + 0.1);
  }

  shatter(pos) {
    const t = this.now, ctx = this.ctx;
    const g = this.out(pos, { gain: 0.9, ref: 2.5 });
    const n = this.noise(this.white, false); const f = this.bq('highpass', 2500, 0.7); const e = ctx.createGain();
    this.env(e.gain, t, 0.002, 1, 0.25);
    n.connect(f).connect(e).connect(g); n.start(t); n.stop(t + 0.4);
    for (let i = 0; i < 14; i++) {
      const tt = t + 0.02 + Math.random() * 0.5;
      const o = this.osc('sine', 2500 + Math.random() * 5000); const oe = ctx.createGain();
      this.env(oe.gain, tt, 0.001, 0.12, 0.05 + Math.random() * 0.1);
      o.connect(oe).connect(g); o.start(tt); o.stop(tt + 0.2);
    }
  }

  ui(kind = 'pickup') {
    const t = this.now, ctx = this.ctx;
    const g = this.out(null, { gain: 0.3, dry: true });
    if (kind === 'pickup') {
      const n = this.noise(this.white, false); const f = this.bq('bandpass', 2000, 2); const e = ctx.createGain();
      this.env(e.gain, t, 0.005, 0.5, 0.12);
      n.connect(f).connect(e).connect(g); n.start(t); n.stop(t + 0.2);
      const o = this.osc('sine', 180); const oe = ctx.createGain(); this.env(oe.gain, t, 0.005, 0.4, 0.15);
      o.connect(oe).connect(g); o.start(t); o.stop(t + 0.2);
    } else if (kind === 'paper') {
      for (let i = 0; i < 4; i++) {
        const tt = t + i * 0.05 + Math.random() * 0.03;
        const n = this.noise(this.white, false); const f = this.bq('bandpass', 3000 + Math.random() * 3000, 0.8); const e = ctx.createGain();
        this.env(e.gain, tt, 0.01, 0.3, 0.08);
        n.connect(f).connect(e).connect(g); n.start(tt); n.stop(tt + 0.15);
      }
    } else if (kind === 'beep' || kind === 'error') {
      const o = this.osc('square', kind === 'beep' ? 1500 : 220); const e = ctx.createGain();
      this.env(e.gain, t, 0.002, 0.15, kind === 'beep' ? 0.08 : 0.4);
      o.connect(e).connect(g); o.start(t); o.stop(t + 0.5);
    } else if (kind === 'click') {
      const n = this.noise(this.white, false); const f = this.bq('bandpass', 4000, 3); const e = ctx.createGain();
      this.env(e.gain, t, 0.001, 0.6, 0.02);
      n.connect(f).connect(e).connect(g); n.start(t); n.stop(t + 0.05);
    } else if (kind === 'locked') {
      for (let i = 0; i < 3; i++) {
        const tt = t + i * 0.09;
        const n = this.noise(this.white, false); const f = this.bq('bandpass', 1800, 4); const e = ctx.createGain();
        this.env(e.gain, tt, 0.001, 0.7, 0.04);
        n.connect(f).connect(e).connect(g); n.start(tt); n.stop(tt + 0.08);
      }
    }
  }

  // player's own breathing (non-spatial); rate 0..1
  breath(intensity = 0.5, inhale = true) {
    const t = this.now, ctx = this.ctx;
    const g = this.out(null, { gain: 0.16 * intensity, dry: true });
    const n = this.noise(this.pink, false); n.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = this.bq('bandpass', inhale ? 1300 : 900, 1.2);
    const dur = inhale ? 0.45 : 0.55;
    const e = ctx.createGain(); this.env(e.gain, t, dur * 0.4, 1, dur * 0.6);
    n.connect(f).connect(e).connect(g); n.start(t); n.stop(t + dur + 0.1);
  }

  heartbeat(gain = 0.6) {
    const t = this.now, ctx = this.ctx;
    const g = this.out(null, { gain, dry: true });
    for (const [dt, a] of [[0, 1], [0.16, 0.7]]) {
      const o = this.osc('sine', 52); o.frequency.exponentialRampToValueAtTime(34, t + dt + 0.12);
      const e = ctx.createGain(); this.env(e.gain, t + dt, 0.008, a, 0.14);
      o.connect(e).connect(g); o.start(t + dt); o.stop(t + dt + 0.25);
    }
  }

  // ---------------------------------------------------------------- the creature
  clicks(pos, n = 6) {
    const t = this.now, ctx = this.ctx;
    const g = this.out(pos, { gain: 0.55, ref: 2 });
    let tt = t;
    for (let i = 0; i < n; i++) {
      tt += 0.04 + Math.random() * 0.09;
      const c = this.noise(this.white, false); const f = this.bq('bandpass', 2200 + Math.random() * 1600, 6); const e = ctx.createGain();
      this.env(e.gain, tt, 0.001, 0.9, 0.012);
      c.connect(f).connect(e).connect(g); c.start(tt); c.stop(tt + 0.04);
      const o = this.osc('sine', 600 + Math.random() * 200); const oe = ctx.createGain(); this.env(oe.gain, tt, 0.001, 0.2, 0.02);
      o.connect(oe).connect(g); o.start(tt); o.stop(tt + 0.05);
    }
  }

  growl(pos, dur = 1.5, gain = 0.6) {
    const t = this.now, ctx = this.ctx;
    const g = this.out(pos, { gain, ref: 2 });
    const o = this.osc('sawtooth', 62); o.frequency.linearRampToValueAtTime(48, t + dur);
    const o2 = this.osc('sawtooth', 93); o2.detune.value = 20;
    const am = this.osc('sine', 23); const amg = ctx.createGain(); amg.gain.value = 0.6;
    const v = ctx.createGain(); v.gain.value = 0.5; am.connect(amg).connect(v.gain);
    const ws = ctx.createWaveShaper(); ws.curve = this.distCurve;
    const f1 = this.bq('bandpass', 400, 4), f2 = this.bq('bandpass', 900, 5);
    const n = this.noise(this.brown); const nf = this.bq('bandpass', 300, 1);
    const e = ctx.createGain(); this.env(e.gain, t, 0.2, 1, dur);
    o.connect(v); o2.connect(v); n.connect(nf).connect(v);
    v.connect(ws); ws.connect(f1).connect(e); ws.connect(f2).connect(e); e.connect(g);
    for (const s of [o, o2, am, n]) { s.start(t); s.stop(t + dur + 0.3); }
  }

  screech(pos, dur = 1.8, gain = 1) {
    const t = this.now, ctx = this.ctx;
    const g = pos ? this.out(pos, { gain: gain, ref: 4, rolloff: 0.5 }) : this.out(null, { gain: gain, dry: true });
    const ws = ctx.createWaveShaper(); ws.curve = this.distCurve;
    const sum = ctx.createGain(); sum.gain.value = 0.25;
    const base = 380 + Math.random() * 80;
    const oscs = [];
    for (const r of [1, 1.06, 1.49, 2.02, 2.9]) {
      const o = this.osc('sawtooth', base * r);
      o.frequency.setValueAtTime(base * r * 0.7, t);
      o.frequency.exponentialRampToValueAtTime(base * r * 1.35, t + 0.25);
      o.frequency.exponentialRampToValueAtTime(base * r * 0.9, t + dur);
      const vib = this.osc('sine', 9 + Math.random() * 6); const vg = ctx.createGain(); vg.gain.value = base * r * 0.04;
      vib.connect(vg).connect(o.frequency);
      o.connect(sum); oscs.push(o, vib);
    }
    const n = this.noise(this.white); const nf = this.bq('bandpass', 3000, 0.8); const ng = ctx.createGain(); ng.gain.value = 0.8;
    n.connect(nf).connect(ng).connect(sum); oscs.push(n);
    const f1 = this.bq('bandpass', 1200, 2), f2 = this.bq('bandpass', 2600, 3), f3 = this.bq('peaking', 800, 1); f3.gain.value = 6;
    const e = ctx.createGain(); this.env(e.gain, t, 0.04, 1, dur, 0.001);
    sum.connect(ws); ws.connect(f1).connect(e); ws.connect(f2).connect(e); e.connect(g);
    for (const s of oscs) { s.start(t); s.stop(t + dur + 0.2); }
  }

  // breathy whispered "counting": rhythmic shaped noise syllables
  whisperCount(pos, n = 5) {
    const t = this.now, ctx = this.ctx;
    const g = this.out(pos, { gain: 0.5, ref: 1.5 });
    for (let i = 0; i < n; i++) {
      const tt = t + i * 0.62 + Math.random() * 0.08;
      for (const [off, fq, len] of [[0, 2600, 0.06], [0.07, 900 + Math.random() * 600, 0.18], [0.27, 4200, 0.05]]) {
        const s = this.noise(this.white, false); const f = this.bq('bandpass', fq, 4 + Math.random() * 3); const e = ctx.createGain();
        this.env(e.gain, tt + off, 0.02, 0.6, len);
        s.connect(f).connect(e).connect(g); s.start(tt + off); s.stop(tt + off + len + 0.1);
      }
    }
  }

  scratch(pos, dur = 1.2) {
    const t = this.now, ctx = this.ctx;
    const g = this.out(pos, { gain: 0.5, ref: 1.5 });
    const strokes = Math.floor(dur / 0.25);
    for (let i = 0; i < strokes; i++) {
      const tt = t + i * 0.25 + Math.random() * 0.05;
      const n = this.noise(this.white, false); const f = this.bq('bandpass', 2500 + Math.random() * 2000, 5); const e = ctx.createGain();
      f.frequency.linearRampToValueAtTime(1500, tt + 0.15);
      this.env(e.gain, tt, 0.01, 0.5, 0.15);
      n.connect(f).connect(e).connect(g); n.start(tt); n.stop(tt + 0.25);
    }
  }

  // ---------------------------------------------------------------- stingers
  stinger(kind = 'reveal', gain = 1) {
    const t = this.now, ctx = this.ctx;
    const g = this.out(null, { gain: 0.5 * gain });
    if (kind === 'reveal') {
      // string-like cluster stab + sub hit
      for (const f of [146.8, 155.6, 207.7, 220, 311.1, 329.6, 659.3, 698.5]) {
        const o = this.osc('sawtooth', f); const lp = this.bq('lowpass', 3000, 0.5);
        const e = ctx.createGain(); this.env(e.gain, t, 0.01, 0.12, 2.5);
        o.detune.value = (Math.random() - 0.5) * 25;
        o.connect(lp).connect(e).connect(g); o.start(t); o.stop(t + 2.7);
      }
      const s = this.osc('sine', 60); s.frequency.exponentialRampToValueAtTime(25, t + 1.2);
      const se = ctx.createGain(); this.env(se.gain, t, 0.005, 1.4, 1.4);
      s.connect(se).connect(g); s.start(t); s.stop(t + 1.5);
      const n = this.noise(this.white, false); const nf = this.bq('highpass', 3000); const ne = ctx.createGain(); this.env(ne.gain, t, 0.002, 0.5, 0.6);
      n.connect(nf).connect(ne).connect(g); n.start(t); n.stop(t + 0.8);
    } else if (kind === 'swell') {
      // rising dread, ends abruptly
      const dur = 3.2;
      for (const f of [98, 103.8, 196, 207.7, 392, 415.3]) {
        const o = this.osc('sawtooth', f); o.frequency.exponentialRampToValueAtTime(f * 1.06, t + dur);
        const lp = this.bq('lowpass', 400); lp.frequency.exponentialRampToValueAtTime(5000, t + dur);
        const e = ctx.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(0.1, t + dur); e.gain.setValueAtTime(0.0001, t + dur + 0.01);
        o.connect(lp).connect(e).connect(g); o.start(t); o.stop(t + dur + 0.05);
      }
    } else if (kind === 'low') {
      const o = this.osc('sine', 38); const e = ctx.createGain(); this.env(e.gain, t, 0.5, 1.2, 3);
      const o2 = this.osc('sawtooth', 76.5); const lp = this.bq('lowpass', 200); const e2 = ctx.createGain(); this.env(e2.gain, t, 0.8, 0.2, 3);
      o.connect(e).connect(g); o2.connect(lp).connect(e2).connect(g);
      o.start(t); o2.start(t); o.stop(t + 4); o2.stop(t + 4);
    } else if (kind === 'jumpscare') {
      this.screech(null, 1.4, 1.6);
      const n = this.noise(this.white, false); const ne = ctx.createGain(); this.env(ne.gain, t, 0.002, 1, 1.2);
      n.connect(ne).connect(g); n.start(t); n.stop(t + 1.3);
      const s = this.osc('square', 55); const se = ctx.createGain(); this.env(se.gain, t, 0.002, 1, 1.2);
      const ws = ctx.createWaveShaper(); ws.curve = this.distCurve;
      s.connect(ws).connect(se).connect(g); s.start(t); s.stop(t + 1.3);
    }
  }

  // intercom/PA crackle with a distorted voice-like formant
  intercom(pos, dur = 2.5) {
    const t = this.now, ctx = this.ctx;
    const g = this.out(pos, { gain: 0.5, ref: 3, rolloff: 0.8 });
    const n = this.noise(this.white); const f = this.bq('bandpass', 1500, 1.5);
    const am = this.osc('square', 7); const amg = ctx.createGain(); amg.gain.value = 0.4;
    const e = ctx.createGain(); e.gain.value = 0.3; am.connect(amg).connect(e.gain);
    const v = this.osc('sawtooth', 110); const vf = this.bq('bandpass', 700, 6); const vf2 = this.bq('bandpass', 1200, 8);
    const vl = this.osc('sine', 3.3); const vlg = ctx.createGain(); vlg.gain.value = 300; vl.connect(vlg).connect(vf.frequency);
    const ve = ctx.createGain(); ve.gain.value = 0.25;
    n.connect(f).connect(e).connect(g);
    v.connect(vf).connect(ve); v.connect(vf2).connect(ve); ve.connect(e);
    g.gain.setValueAtTime(0.5, t + dur - 0.1); g.gain.linearRampToValueAtTime(0, t + dur);
    for (const s of [n, am, v, vl]) { s.start(t); s.stop(t + dur); }
  }

  updateListener(cam) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const p = cam.position;
    const f = cam.getWorldDirection(this._v || (this._v = new (cam.position.constructor)()));
    if (L.positionX) {
      const t = this.ctx.currentTime;
      L.positionX.setTargetAtTime(p.x, t, 0.02); L.positionY.setTargetAtTime(p.y, t, 0.02); L.positionZ.setTargetAtTime(p.z, t, 0.02);
      L.forwardX.setTargetAtTime(f.x, t, 0.02); L.forwardY.setTargetAtTime(f.y, t, 0.02); L.forwardZ.setTargetAtTime(f.z, t, 0.02);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0);
    }
  }
}
