// All on-screen UI, built in the DOM so it stays crisp at any resolution.
const CSS = /* css */`
#ui { position: fixed; inset: 0; pointer-events: none; z-index: 10; font-family: var(--ui-font); color: var(--ui-fg); }
#ui * { box-sizing: border-box; }
#ui .objective { position: absolute; left: calc(22px + env(safe-area-inset-left, 0px)); top: calc(20px + env(safe-area-inset-top, 0px)); max-width: min(420px, 70vw); transition: opacity 0.6s; }
#ui .objective .lbl { font: 600 10px/1 var(--ui-mono); letter-spacing: 0.28em; color: var(--ui-accent); margin-bottom: 6px; }
#ui .objective .txt { font-size: 15px; line-height: 1.35; text-shadow: 0 1px 3px rgba(0,0,0,0.8); }
#ui .objective.flash .txt { animation: objflash 1.2s ease-out; }
@keyframes objflash { 0% { color: var(--ui-accent); transform: translateX(6px); } 100% { color: var(--ui-fg); transform: none; } }
#ui .subs { position: absolute; left: 50%; bottom: calc(9vh + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); width: min(760px, calc(100vw - 32px)); text-align: center; font-size: clamp(15px, 2.1vw, 19px); line-height: 1.45; text-shadow: 0 1px 4px rgba(0,0,0,0.95), 0 0 2px #000; transition: opacity 0.35s; }
#ui .subs .who { font: 600 11px/1 var(--ui-mono); letter-spacing: 0.22em; color: var(--ui-accent); display: block; margin-bottom: 6px; }
#ui .prompt { position: absolute; left: 50%; top: 58%; transform: translateX(-50%); font: 500 13px/1 var(--ui-mono); letter-spacing: 0.12em; padding: 8px 12px; background: rgba(6,10,12,0.55); border: 1px solid rgba(160,220,220,0.25); transition: opacity 0.2s; white-space: nowrap; }
#ui .prompt b { color: var(--ui-accent); font-weight: 600; margin-right: 8px; }
#ui .dot { position: absolute; left: 50%; top: 50%; width: 4px; height: 4px; margin: -2px; border-radius: 50%; background: rgba(255,255,255,0.55); transition: opacity 0.3s, transform 0.2s; }
#ui .dot.hot { transform: scale(1.8); background: var(--ui-accent); }
#ui .fade { position: absolute; inset: 0; background: #000; opacity: 0; }
#ui .flashov { position: absolute; inset: 0; background: #f4f8ff; opacity: 0; mix-blend-mode: screen; }
#ui .redov { position: absolute; inset: 0; background: radial-gradient(ellipse at center, rgba(120,0,0,0) 40%, rgba(120,0,0,0.75) 100%); opacity: 0; transition: opacity 0.4s; }
#ui .card { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; opacity: 0; transition: opacity 1.2s; padding: 16px; }
#ui .card .t1 { font: 300 clamp(26px, 5vw, 46px)/1.15 var(--ui-font); letter-spacing: 0.32em; }
#ui .card .t2 { font: 500 12px/1.8 var(--ui-mono); letter-spacing: 0.3em; color: var(--ui-dim); margin-top: 14px; }
#ui .toast { position: absolute; left: 50%; top: calc(18px + env(safe-area-inset-top, 0px)); transform: translateX(-50%); font: 500 12px/1 var(--ui-mono); letter-spacing: 0.16em; padding: 9px 14px; background: rgba(6,10,12,0.6); border-left: 2px solid var(--ui-accent); opacity: 0; transition: opacity 0.4s; white-space: nowrap; }
#ui .lamp { position: absolute; right: calc(24px + env(safe-area-inset-right, 0px)); bottom: calc(22px + env(safe-area-inset-bottom, 0px)); display: none; font: 600 10px/1 var(--ui-mono); letter-spacing: 0.22em; color: var(--ui-dim); text-align: right; }
#ui .lamp .bar { display: flex; gap: 3px; margin-top: 7px; justify-content: flex-end; }
#ui .lamp .bar i { width: 18px; height: 6px; background: rgba(255,255,255,0.12); }
#ui .lamp .bar i.on { background: var(--ui-accent); box-shadow: 0 0 6px var(--ui-accent); }
#ui .doc { position: absolute; inset: 0; display: none; place-items: center; background: rgba(2,4,5,0.72); pointer-events: auto; padding: 16px; }
#ui .doc .paper { width: min(640px, 100%); max-height: 86vh; overflow: auto; background: #eef1f1; color: #1b2224; padding: 34px 38px 26px; box-shadow: 0 20px 60px rgba(0,0,0,0.6); font: 14px/1.6 var(--ui-font); }
#ui .doc .head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #1f8a8a; padding-bottom: 10px; margin-bottom: 16px; gap: 12px; flex-wrap: wrap; }
#ui .doc .brand { font: 700 12px/1 var(--ui-mono); letter-spacing: 0.3em; color: #1f8a8a; }
#ui .doc .ref { font: 500 11px/1 var(--ui-mono); letter-spacing: 0.12em; color: #5b6568; }
#ui .doc h2 { font: 600 19px/1.3 var(--ui-font); margin: 0 0 14px; text-wrap: balance; }
#ui .doc .body p { margin: 0 0 11px; }
#ui .doc .body .redact { background: #1b2224; color: #1b2224; padding: 0 2px; }
#ui .doc .foot { margin-top: 18px; font: 500 11px/1 var(--ui-mono); letter-spacing: 0.14em; color: #5b6568; text-align: right; }
#ui .death { position: absolute; inset: 0; display: none; place-items: center; text-align: center; background: rgba(0,0,0,0.92); pointer-events: auto; padding: 16px; }
#ui .death .t1 { font: 300 clamp(24px, 4vw, 38px)/1.2 var(--ui-font); letter-spacing: 0.3em; color: #c9c2bb; }
#ui .death .t2 { font: 500 12px/1.7 var(--ui-mono); letter-spacing: 0.16em; color: #7d7570; margin: 14px 0 26px; }
#ui button.btn { pointer-events: auto; font: 500 12px/1 var(--ui-mono); letter-spacing: 0.26em; color: var(--ui-fg); background: rgba(8,12,14,0.6); border: 1px solid rgba(160,220,220,0.3); padding: 13px 26px; cursor: pointer; }
#ui button.btn:hover, #ui button.btn:focus-visible { border-color: var(--ui-accent); outline: none; color: #fff; }
#ui .touchbtns { position: absolute; right: calc(16px + env(safe-area-inset-right, 0px)); bottom: calc(70px + env(safe-area-inset-bottom, 0px)); display: none; flex-direction: column; gap: 10px; pointer-events: auto; }
#ui .touchbtns button { font: 600 11px/1 var(--ui-mono); letter-spacing: 0.14em; color: var(--ui-fg); background: rgba(8,12,14,0.55); border: 1px solid rgba(160,220,220,0.3); width: 74px; height: 46px; }
body.touch #ui .touchbtns { display: flex; }
`;

export class UI {
  constructor() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const root = document.createElement('div'); root.id = 'ui';
    root.innerHTML = `
      <div class="objective" style="opacity:0"><div class="lbl">OBJECTIVE</div><div class="txt"></div></div>
      <div class="dot"></div>
      <div class="prompt" style="opacity:0"></div>
      <div class="subs" style="opacity:0"></div>
      <div class="toast"></div>
      <div class="lamp">HALIDE LAMP<div class="bar"></div></div>
      <div class="redov"></div>
      <div class="flashov"></div>
      <div class="card"><div><div class="t1"></div><div class="t2"></div></div></div>
      <div class="fade"></div>
      <div class="doc" role="dialog" aria-modal="true"><div class="paper"><div class="head"><span class="brand">HALVERSEN</span><span class="ref"></span></div><h2></h2><div class="body"></div><div class="foot">[E] / CLICK TO CLOSE</div></div></div>
      <div class="death"><div><div class="t1"></div><div class="t2"></div><button class="btn" type="button">TRY AGAIN</button></div></div>
      <div class="touchbtns"><button type="button" data-k="KeyE">USE</button><button type="button" data-k="Mouse2">FLASH</button><button type="button" data-k="KeyF">LIGHT</button><button type="button" data-k="KeyC">CROUCH</button></div>`;
    document.body.appendChild(root);
    this.root = root;
    const $ = (s) => root.querySelector(s);
    this.el = { obj: $('.objective'), objTxt: $('.objective .txt'), dot: $('.dot'), prompt: $('.prompt'), subs: $('.subs'), toast: $('.toast'), lamp: $('.lamp'), lampBar: $('.lamp .bar'), red: $('.redov'), flash: $('.flashov'), card: $('.card'), fade: $('.fade'), doc: $('.doc'), death: $('.death') };
    this.fadeA = 0; this.fadeTarget = 0; this.fadeSpeed = 1; this.flashA = 0;
    this.subQueue = Promise.resolve();
    this.docOpen = false;
    this.ts = 1; // debug time scale (real-time timers run faster too)
  }
  bindTouch(input) {
    for (const b of this.root.querySelectorAll('.touchbtns button')) b.addEventListener('click', () => input.tap(b.dataset.k));
  }

  update(dt) {
    if (this.fadeA !== this.fadeTarget) {
      const s = this.fadeSpeed * dt;
      this.fadeA = this.fadeA < this.fadeTarget ? Math.min(this.fadeTarget, this.fadeA + s) : Math.max(this.fadeTarget, this.fadeA - s);
      this.el.fade.style.opacity = this.fadeA;
    }
    if (this.flashA > 0) { this.flashA = Math.max(0, this.flashA - dt * 3.2); this.el.flash.style.opacity = this.flashA; }
  }

  objective(text) {
    const o = this.el.obj;
    if (!text) { o.style.opacity = 0; return; }
    this.el.objTxt.textContent = text;
    o.style.opacity = 1; o.classList.remove('flash'); void o.offsetWidth; o.classList.add('flash');
  }
  prompt(text) {
    if (text) { this.el.prompt.innerHTML = text; this.el.prompt.style.opacity = 1; this.el.dot.classList.add('hot'); }
    else { this.el.prompt.style.opacity = 0; this.el.dot.classList.remove('hot'); }
  }
  crosshair(on) { this.el.dot.style.opacity = on ? 1 : 0; }
  // queued subtitle line; resolves when it has finished showing
  say(who, text, dur) {
    dur ??= Math.max(2.2, text.length * 0.058 + 0.8);
    const run = () => new Promise((res) => {
      this.el.subs.innerHTML = (who ? `<span class="who">${who.toUpperCase()}</span>` : '') + text;
      this.el.subs.style.opacity = 1;
      this.onLine?.(who, dur);
      setTimeout(() => { this.el.subs.style.opacity = 0; setTimeout(res, 380 / this.ts); }, dur * 1000 / this.ts);
    });
    this.subQueue = this.subQueue.then(run);
    return this.subQueue;
  }
  toast(text, dur = 3) {
    const t = this.el.toast; t.textContent = text; t.style.opacity = 1;
    clearTimeout(this._tt); this._tt = setTimeout(() => { t.style.opacity = 0; }, dur * 1000);
  }
  fadeTo(a, seconds = 1) {
    this.fadeTarget = a; this.fadeSpeed = Math.abs(a - this.fadeA) / Math.max(0.01, seconds);
    return new Promise((res) => setTimeout(res, seconds * 1000 / this.ts));
  }
  setFade(a) { this.fadeA = this.fadeTarget = a; this.el.fade.style.opacity = a; }
  whiteFlash(a = 1) { this.flashA = Math.max(this.flashA, a); this.el.flash.style.opacity = this.flashA; }
  red(on) { this.el.red.style.opacity = on ? 1 : 0; }
  async card(t1, t2 = '', hold = 3) {
    const c = this.el.card;
    c.querySelector('.t1').textContent = t1; c.querySelector('.t2').innerHTML = t2;
    c.style.opacity = 1;
    await new Promise((r) => setTimeout(r, hold * 1000 / this.ts));
    c.style.opacity = 0;
    await new Promise((r) => setTimeout(r, 1200 / this.ts));
  }
  lampMeter(show, charge = 1, cells = 4) {
    const l = this.el.lamp; l.style.display = show ? 'block' : 'none';
    if (!show) return;
    if (this.el.lampBar.children.length !== cells) this.el.lampBar.innerHTML = '<i></i>'.repeat(cells);
    [...this.el.lampBar.children].forEach((c, i) => c.classList.toggle('on', charge * cells >= i + 0.999));
  }
  // document overlay; resolves on close
  readDoc({ ref = '', title = '', body = '' }, input) {
    return new Promise((res) => {
      const d = this.el.doc;
      d.querySelector('.ref').textContent = ref; d.querySelector('h2').textContent = title;
      d.querySelector('.body').innerHTML = body;
      d.style.display = 'grid'; this.docOpen = true;
      input.unlock(); input.enabled = false;
      const close = () => {
        d.style.display = 'none'; this.docOpen = false; removeEventListener('keydown', key); d.removeEventListener('click', close);
        input.enabled = true; input.lock(); res();
      };
      const key = (e) => { if (['KeyE', 'Escape', 'Space', 'Enter'].includes(e.code)) close(); };
      setTimeout(() => { addEventListener('keydown', key); d.addEventListener('click', close); }, 250);
    });
  }
  death(t1, t2, input) {
    return new Promise((res) => {
      const d = this.el.death; d.querySelector('.t1').textContent = t1; d.querySelector('.t2').textContent = t2;
      d.style.display = 'grid'; input.unlock(); input.enabled = false;
      const b = d.querySelector('button');
      b.onclick = () => { d.style.display = 'none'; input.enabled = true; input.lock(); res(); };
      setTimeout(() => b.focus(), 100);
    });
  }
}
