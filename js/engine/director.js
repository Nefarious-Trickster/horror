// Story scripting helpers driven by the game clock (so pausing pauses the story).
//   await d.wait(2); await d.until(() => flags.badged); d.every(dt => ...)
export class Director {
  constructor() { this.t = 0; this.waiters = []; this.tickers = new Set(); this.cancelled = false; }
  update(dt) {
    this.t += dt;
    for (const f of [...this.tickers]) f(dt, this.t);
    const still = [];
    for (const w of this.waiters) {
      let done = false;
      try { done = w.test(); } catch (e) { console.error(e); done = true; }
      if (done) w.res(); else still.push(w);
    }
    this.waiters = still;
  }
  until(test) { return new Promise((res, rej) => { if (this.cancelled) return rej(CANCEL); this.waiters.push({ test: () => { if (this.cancelled) { rej(CANCEL); return true; } return test(); }, res }); }); }
  wait(sec) { const end = this.t + sec; return this.until(() => this.t >= end); }
  every(fn) { this.tickers.add(fn); return () => this.tickers.delete(fn); }
  // resolves on the next update with the game-time step since the call
  frame() { const t0 = this.t; return this.until(() => this.t > t0).then(() => this.t - t0); }
  cancel() { this.cancelled = true; this.tickers.clear(); for (const w of this.waiters) w.test(); this.waiters = []; }
}
export const CANCEL = Symbol('cancelled');
