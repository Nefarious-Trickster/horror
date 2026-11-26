import * as THREE from 'three';
import { sfx } from './game.js';

// The halide strobe lamp: a first-person viewmodel, a charge in cells that recovers slowly,
// and a flash that hits creatures inside its cone. model: an Object3D (props.halideLamp()).
export class HalideLamp {
  constructor(game, model, { cells = 4, recharge = 3.2 } = {}) {
    this.game = game; this.model = model; this.cells = cells; this.recharge = recharge;
    this.has = false; this.charge = 1; this.cool = 0; this.targets = []; this.onHit = null;
    this.light = new THREE.SpotLight(0xf2f6ff, 0, 22, 0.75, 0.3, 1.2);
    this.light.position.set(0.15, -0.15, 0); this.light.target.position.set(0, 0, -5);
    game.camera.add(this.light, this.light.target);
  }
  give() {
    this.has = true;
    const m = this.model;
    m.position.set(0.27, -0.29, -0.5); m.scale.setScalar(0.85); m.rotation.set(0.05, 0.1, 0);
    m.traverse((o) => { o.castShadow = false; o.frustumCulled = false; });
    m.userData.dynamic = true;
    this.game.camera.add(m);
    // the torch beam comes out of the lamp's head, not from inside the viewmodel (which it would blow out)
    this.game.flashlight?.light.position.set(0.2, -0.2, -0.85);
    // a faint fill so the lamp in your hand reads in the dark
    const fill = new THREE.PointLight(0xffe2c0, 0.35, 0.9, 2); fill.position.set(0.05, 0.05, -0.2);
    this.game.camera.add(fill);
    this.game.ui.lampMeter(true, this.charge, this.cells);
  }
  refill() { this.charge = 1; sfx.strobeCharge(); this.game.ui.lampMeter(true, this.charge, this.cells); }
  // creatures: [{ object3D for the chest, onFlash(dist) }]
  flash() {
    if (!this.has || this.cool > 0) return;
    if (this.charge < 1 / this.cells - 1e-3) { sfx.beep('deny'); return; }
    this.charge -= 1 / this.cells; this.cool = 0.6;
    sfx.strobeFlash(); this.game.ui.whiteFlash(0.85); this.light.intensity = 900;
    const f = this.model.userData.flash; if (f) f.material.emissiveIntensity = 8;
    const cam = this.game.camera, fwd = cam.getWorldDirection(new THREE.Vector3());
    for (const t of this.targets) {
      const p = t.point().clone().sub(cam.position), d = p.length();
      if (d < 10.5 && p.normalize().dot(fwd) > Math.cos(0.42)) t.onFlash(d);
    }
    this.onFlash?.();
  }
  update(dt) {
    if (!this.has) return;
    this.cool = Math.max(0, this.cool - dt);
    const before = Math.floor(this.charge * this.cells + 1e-6);
    this.charge = Math.min(1, this.charge + dt / (this.cells * this.recharge));
    if (Math.floor(this.charge * this.cells + 1e-6) > before) sfx.strobeCharge();
    this.light.intensity *= Math.exp(-dt * 22);
    const f = this.model.userData.flash; if (f) f.material.emissiveIntensity = Math.max(0.6, f.material.emissiveIntensity * Math.exp(-dt * 10));
    this.model.userData.setCharge?.(this.charge);
    this.game.ui.lampMeter(true, this.charge, this.cells);
    if (this.game.input.wasPressed('Mouse2', 'KeyQ')) this.flash();
    const p = this.game.player;
    this.model.position.y = -0.29 + Math.sin(this.game.time * 1.6) * 0.004 + Math.sin(p.bob * 2) * 0.006;
  }
}
