import * as THREE from 'three';

// Hinged doors, the powered roller gate, keycard doors and the freight lift doors.
export class Door {
  constructor({ level, cells, kind, id, pivot, axis, center, audio, noise }) {
    this.level = level; this.cells = cells; this.kind = kind; this.id = id;
    this.pivot = pivot; this.axis = axis; this.center = center;
    this.audio = audio; this.noise = noise;
    this.open01 = 0; this.target = 0; this.sign = 1;
    this.locked = kind === 'keycard' || kind === 'gate' || kind === 'lift';
    this.jammed = false;
    this.panels = null; this.grille = null;
    for (const [x, y] of cells) level.doorCells.set(x + ',' + y, this);
    this.closeTimer = 0;
  }
  isOpen() { return this.open01 > 0.75; }
  monsterPassable() {
    if (this.kind === 'door') return !this.jammed;
    if (this.kind === 'keycard') return !this.locked;
    if (this.kind === 'gate') return this.open01 > 0.9;
    if (this.kind === 'lift') return false;
    return true;
  }
  // which side is a position on (+1/-1 along the passage axis)
  sideOf(x, z) { return this.axis === 'x' ? Math.sign(z - this.center.z) || 1 : Math.sign(x - this.center.x) || 1; }

  open(fromX, fromZ, slam = false, silent = false) {
    if (this.target === 1) return;
    if (this.kind === 'door' || this.kind === 'keycard') {
      // swing away from whoever opens it
      this.sign = -this.sideOf(fromX, fromZ);
      if (!silent) this.audio?.doorOpen(this.center, slam);
      this.noise?.(this.center.x, this.center.z, slam ? 18 : 7, slam ? 'slam' : 'door');
    }
    if (this.kind === 'gate' && !silent) this.audio?.gateRattle(this.center, 3.2);
    this.target = 1;
  }
  close(silent = false) {
    if (this.target === 0) return;
    this.target = 0;
    if (!silent && this.kind === 'door') { this.audio?.doorOpen(this.center, false); this.noise?.(this.center.x, this.center.z, 6, 'door'); }
  }
  toggle(fx, fz) { if (this.target) this.close(); else this.open(fx, fz); }

  update(dt) {
    const speed = this.kind === 'gate' ? 0.32 : this.kind === 'lift' ? 0.35 : (this.slamming ? 6 : 2.2);
    if (this.open01 !== this.target) {
      const d = this.target - this.open01;
      this.open01 += Math.sign(d) * Math.min(Math.abs(d), dt * speed);
    }
    if (this.kind === 'door' || this.kind === 'keycard') {
      const e = this.open01 * this.open01 * (3 - 2 * this.open01);
      this.pivot.rotation.y = this.baseRot + this.sign * e * 1.75;
    } else if (this.kind === 'gate' && this.grille) {
      this.grille.position.y = this.open01 * 2.5;
    } else if (this.kind === 'lift' && this.panels) {
      for (const p of this.panels) p.position.x = p.userData.closedX + p.userData.side * this.open01 * 1.9;
    }
  }
}
