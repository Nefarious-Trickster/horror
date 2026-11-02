import * as THREE from 'three';

// Many emissive fixtures, few real lights: each frame the nearest/brightest fixtures borrow
// a pooled PointLight. Fixture brightness is simulated even when it has no light, so the
// emissive tubes flicker convincingly everywhere.

function flickerNoise(t, seed) {
  return Math.sin(t * 13.1 + seed) * Math.sin(t * 7.3 + seed * 2.1) * Math.sin(t * 2.9 + seed * 0.7);
}

export class Lights {
  constructor(scene, poolSize) {
    this.scene = scene;
    this.fixtures = [];
    this.pool = [];
    for (let i = 0; i < poolSize; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 8, 2);
      l.castShadow = false;
      l.userData.fixture = null;
      scene.add(l);
      this.pool.push(l);
    }
    // one shadow-casting point light reserved for the closest strong fixture (high quality only)
    this.time = 0;
    this.power = false;
    this.blackout = 0; // seconds remaining of forced darkness
    this.zoneKill = new Set(); // zones whose grid lights are cut
    this.onFlickerZap = null;
  }

  add(f) {
    const fx = {
      pos: f.pos.clone(), color: new THREE.Color(f.color ?? 0xdfeeff), intensity: f.intensity ?? 4, distance: f.distance ?? 9,
      mats: f.mats || [], baseEmissive: f.baseEmissive ?? (f.mats?.[0]?.emissiveIntensity ?? 2),
      mode: f.mode ?? 'steady', power: f.power ?? 'grid', zone: f.zone ?? null,
      seed: Math.random() * 100, level: 0, on: true, override: null, hum: f.hum ?? false,
      state: 1, nextFlick: Math.random() * 3,
    };
    this.fixtures.push(fx);
    return fx;
  }

  levelFor(fx, dt) {
    if (fx.override != null) return fx.override;
    if (!fx.on) return 0;
    if (this.blackout > 0 && fx.power !== 'always') return 0;
    let powered = true;
    if (fx.power === 'grid') powered = this.power && !this.zoneKill.has(fx.zone);
    if (fx.power === 'emergency') powered = !this.power;
    if (!powered) return 0;
    if (fx.mode === 'dead') return 0;
    if (fx.mode === 'flicker') {
      fx.nextFlick -= dt;
      if (fx.nextFlick <= 0) {
        // bursts of stuttering, then holds
        if (fx.state === 1) { fx.state = 0; fx.nextFlick = 0.04 + Math.random() * 0.25; }
        else { fx.state = 1; fx.nextFlick = Math.random() < 0.3 ? 0.03 + Math.random() * 0.1 : 0.6 + Math.random() * 4; if (fx.nextFlick > 0.5) this.onFlickerZap?.(fx); }
      }
      return fx.state ? 0.85 + 0.15 * flickerNoise(this.time, fx.seed) : 0.03;
    }
    if (fx.mode === 'dying') return 0.35 + 0.25 * (0.5 + 0.5 * flickerNoise(this.time * 0.5, fx.seed));
    if (fx.mode === 'pulse') return 0.55 + 0.45 * Math.sin(this.time * 2.2 + fx.seed);
    return 1;
  }

  update(dt, camPos) {
    this.time += dt;
    if (this.blackout > 0) this.blackout -= dt;
    for (const fx of this.fixtures) {
      const target = this.levelFor(fx, dt);
      // tubes strike up with a little lag; cut off instantly
      fx.level = target < fx.level ? target : fx.level + (target - fx.level) * Math.min(1, dt * 18);
      const e = fx.baseEmissive * fx.level;
      for (const m of fx.mats) m.emissiveIntensity = e;
    }
    // choose fixtures for the pool
    const cand = [];
    for (const fx of this.fixtures) {
      if (fx.level < 0.02) continue;
      const d = fx.pos.distanceTo(camPos);
      if (d > fx.distance + 14) continue;
      cand.push([d - fx.intensity * 0.3, fx]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    const chosen = new Set(cand.slice(0, this.pool.length).map((c) => c[1]));
    // keep existing assignments stable
    const free = [];
    for (const l of this.pool) {
      if (l.userData.fixture && chosen.has(l.userData.fixture)) chosen.delete(l.userData.fixture);
      else { l.userData.fixture = null; free.push(l); }
    }
    for (const fx of chosen) { const l = free.pop(); if (!l) break; l.userData.fixture = fx; }
    for (const l of this.pool) {
      const fx = l.userData.fixture;
      // never toggle .visible: changing the light count recompiles every shader
      if (!fx) { l.intensity = 0; continue; }
      l.position.copy(fx.pos);
      l.color.copy(fx.color);
      l.distance = fx.distance;
      l.intensity = fx.intensity * fx.level;
    }
  }

  nearestLit(pos, maxD = 12) {
    let best = null, bd = maxD;
    for (const fx of this.fixtures) {
      if (fx.level < 0.1 || !fx.hum) continue;
      const d = fx.pos.distanceTo(pos);
      if (d < bd) { bd = d; best = fx; }
    }
    return best;
  }

  // how lit is a point (for monster vision of the player)
  illumination(pos) {
    let s = 0;
    for (const fx of this.fixtures) {
      if (fx.level < 0.05) continue;
      const d = fx.pos.distanceTo(pos);
      if (d > fx.distance) continue;
      s += fx.intensity * fx.level / (1 + d * d) * (1 - d / fx.distance);
    }
    return s;
  }
}
