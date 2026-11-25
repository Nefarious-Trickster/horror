// Keyboard, mouse (pointer lock with click-drag fallback) and touch input.
// Gameplay code reads continuous state (down, look deltas, move axes) and one-shot presses.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();
    this.lookDX = 0; this.lookDY = 0;
    this.locked = false; this.dragging = false;
    this.enabled = true;   // gameplay input (UI overlays switch this off)
    this.isTouch = matchMedia('(pointer: coarse)').matches;
    this.touchMove = { x: 0, y: 0, id: null, ox: 0, oy: 0 };
    this.touchLook = { id: null, x: 0, y: 0 };
    this.listeners = [];

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.down.add(e.code); this.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
    addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked) { this.lookDX += e.movementX; this.lookDY += e.movementY; }
      else if (this.dragging) { this.lookDX += (e.clientX - this.lx) * 1.8; this.lookDY += (e.clientY - this.ly) * 1.8; this.lx = e.clientX; this.ly = e.clientY; }
    });
    canvas.addEventListener('mousedown', (e) => {
      if (this.isTouch || !this.enabled) return;
      if (e.button === 2) { this.pressed.add('Mouse2'); this.down.add('Mouse2'); return; }
      if (e.button === 0) { this.pressed.add('Mouse0'); }
      this.dragging = true; this.lx = e.clientX; this.ly = e.clientY;
      if (!this.locked) this.lock();
    });
    addEventListener('mouseup', (e) => { this.dragging = false; if (e.button === 2) this.down.delete('Mouse2'); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    if (this.isTouch) this.setupTouch();
  }

  lock() {
    try { const r = this.canvas.requestPointerLock?.(); r?.catch?.(() => {}); } catch { /* sandboxed: drag-look still works */ }
  }
  unlock() { try { document.exitPointerLock?.(); } catch { /* ignore */ } }

  setupTouch() {
    const el = this.canvas;
    el.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.45 && this.touchMove.id === null) Object.assign(this.touchMove, { id: t.identifier, ox: t.clientX, oy: t.clientY, x: 0, y: 0 });
        else if (this.touchLook.id === null) Object.assign(this.touchLook, { id: t.identifier, x: t.clientX, y: t.clientY });
      }
      e.preventDefault();
    }, { passive: false });
    el.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touchMove.id) {
          const dx = t.clientX - this.touchMove.ox, dy = t.clientY - this.touchMove.oy, l = Math.min(Math.hypot(dx, dy), 50) / 50, a = Math.atan2(dy, dx);
          this.touchMove.x = Math.cos(a) * l; this.touchMove.y = Math.sin(a) * l;
        } else if (t.identifier === this.touchLook.id) {
          this.lookDX += (t.clientX - this.touchLook.x) * 2.2; this.lookDY += (t.clientY - this.touchLook.y) * 2.2;
          this.touchLook.x = t.clientX; this.touchLook.y = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touchMove.id) Object.assign(this.touchMove, { id: null, x: 0, y: 0 });
        if (t.identifier === this.touchLook.id) this.touchLook.id = null;
      }
    };
    el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
  }

  // virtual buttons (touch UI) call this
  tap(code) { this.pressed.add(code); }

  isDown(code) { return this.enabled && this.down.has(code); }
  wasPressed(...codes) { return this.enabled && codes.some((c) => this.pressed.has(c)); }
  moveAxes() {
    if (!this.enabled) return { x: 0, z: 0 };
    if (this.touchMove.id !== null) return { x: this.touchMove.x, z: -this.touchMove.y };
    const d = this.down;
    return {
      x: (d.has('KeyD') || d.has('ArrowRight') ? 1 : 0) - (d.has('KeyA') || d.has('ArrowLeft') ? 1 : 0),
      z: (d.has('KeyW') || d.has('ArrowUp') ? 1 : 0) - (d.has('KeyS') || d.has('ArrowDown') ? 1 : 0),
    };
  }
  takeLook() { const r = [this.lookDX, this.lookDY]; this.lookDX = this.lookDY = 0; return this.enabled ? r : [0, 0]; }
  endFrame() { this.pressed.clear(); }
}
