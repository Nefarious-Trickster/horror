import * as THREE from 'three';

// Things you can use: look at them within reach and press E.
// item: { position: Vector3 | () => Vector3, label, reach = 1.8, size = 0.35, enabled = () => true, onUse }
export class Interactions {
  constructor() { this.items = []; this.current = null; }
  add(item) { this.items.push({ reach: 1.9, size: 0.35, enabled: () => true, ...item }); return item; }
  remove(item) { this.items = this.items.filter((i) => i !== item && i.ref !== item); }
  clear() { this.items = []; this.current = null; }
  update(camera, input, ui) {
    const o = camera.position, d = camera.getWorldDirection(new THREE.Vector3());
    let best = null, bestScore = Infinity;
    const p = new THREE.Vector3();
    for (const it of this.items) {
      if (!it.enabled()) continue;
      p.copy(typeof it.position === 'function' ? it.position() : it.position);
      const v = p.clone().sub(o);
      const along = v.dot(d);
      if (along < 0.1 || along > it.reach) continue;
      const perp = v.addScaledVector(d, -along).length();
      if (perp > it.size + along * 0.06) continue;
      const score = perp + along * 0.1;
      if (score < bestScore) { bestScore = score; best = it; }
    }
    this.current = best;
    ui.prompt(best ? `<b>[E]</b>${typeof best.label === 'function' ? best.label() : best.label}` : null);
    if (best && input.wasPressed('KeyE')) best.onUse(best);
  }
}
