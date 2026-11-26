import * as THREE from 'three';

const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

// First-person controller: walk/run/crouch, AABB + circle collision, head bob, footsteps,
// and scripted camera control for story moments.
export class Player {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.eye = 1.66; this.eyeCur = 1.66;
    this.crouch = false;
    this.bob = 0; this.stepDist = 0;
    this.frozen = false;        // no movement (cutscenes, menus)
    this.lookLocked = false;    // no mouse look
    this.colliders = [];        // [{minX,maxX,minZ,maxZ}]
    this.blockers = () => [];   // dynamic circles [{x,z,r}]
    this.onStep = null;         // (pos, run) => void
    this.radius = 0.28;
    this.scriptLook = null;     // { yaw, pitch, rate }
    this.shake = 0;
    this.sens = 0.0022;
    this.speedScale = 1;
  }
  place(x, z, yaw = 0, pitch = 0) { this.pos.set(x, 0, z); this.yaw = yaw; this.pitch = pitch; this.vel.set(0, 0, 0); }
  // smoothly turn the view toward a world point (used by scripted moments)
  lookAt(p, rate = 3) {
    const e = this.camera.position;
    const d = new THREE.Vector3().subVectors(p, e);
    this.scriptLook = { yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)), rate };
  }
  releaseLook() { this.scriptLook = null; }

  collide(p) {
    const r = this.radius;
    for (let pass = 0; pass < 2; pass++) {
      for (const c of this.colliders) {
        if (c.disabled) continue;
        const cx = clamp(p.x, c.minX, c.maxX), cz = clamp(p.z, c.minZ, c.maxZ);
        const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
        if (d < r) {
          if (d > 1e-6) { p.x = cx + (dx / d) * r; p.z = cz + (dz / d) * r; }
          else { // inside the box: push out along the shallowest axis
            const ox = Math.min(p.x - c.minX, c.maxX - p.x), oz = Math.min(p.z - c.minZ, c.maxZ - p.z);
            if (ox < oz) p.x = p.x - c.minX < c.maxX - p.x ? c.minX - r : c.maxX + r; else p.z = p.z - c.minZ < c.maxZ - p.z ? c.minZ - r : c.maxZ + r;
          }
        }
      }
      for (const b of this.blockers()) {
        const dx = p.x - b.x, dz = p.z - b.z, d = Math.hypot(dx, dz), R = b.r + r * 0.5;
        if (d < R && d > 1e-5) { p.x = b.x + (dx / d) * R; p.z = b.z + (dz / d) * R; }
      }
    }
  }

  update(dt, input, time) {
    // look
    if (this.scriptLook) {
      const s = this.scriptLook, k = 1 - Math.exp(-s.rate * dt);
      this.yaw += wrap(s.yaw - this.yaw) * k; this.pitch += (s.pitch - this.pitch) * k;
      input.takeLook();
    } else if (!this.lookLocked) {
      const [dx, dy] = input.takeLook();
      this.yaw -= dx * this.sens; this.pitch = clamp(this.pitch - dy * this.sens * (this.invertY ? -1 : 1), -1.45, 1.45);
    } else input.takeLook();

    // move
    if (input.wasPressed('KeyC', 'ControlLeft')) this.crouch = !this.crouch;
    const a = this.frozen ? { x: 0, z: 0 } : input.moveAxes();
    const run = !this.crouch && (input.isDown('ShiftLeft') || input.isDown('ShiftRight'));
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const want = new THREE.Vector3().addScaledVector(fwd, a.z).addScaledVector(right, a.x);
    if (want.lengthSq() > 1) want.normalize();
    want.multiplyScalar((this.crouch ? 0.7 : run ? 2.7 : 1.4) * this.speedScale);
    this.vel.lerp(want, 1 - Math.exp(-dt * 9));
    const step = this.vel.clone().multiplyScalar(dt);
    this.pos.add(step);
    if (!this.frozen) this.collide(this.pos); // frozen: scripted placement (hiding spots) wins
    const speed = this.vel.length();
    this.running = run && speed > 2;

    // head bob + footsteps
    this.bob += dt * speed * (this.crouch ? 4 : 5.2);
    this.stepDist += speed * dt;
    const stride = this.crouch ? 0.55 : run ? 1.1 : 0.75;
    if (this.stepDist > stride) { this.stepDist = 0; this.onStep?.(this.pos, run); }
    this.eye = this.eyeOverride ?? (this.crouch ? 1.12 : 1.66);
    this.eyeCur += (this.eye - this.eyeCur) * (1 - Math.exp(-dt * 8));
    const k = Math.min(speed, 1.6);
    const bobY = Math.sin(this.bob * 2) * 0.022 * k, bobX = Math.cos(this.bob) * 0.014 * k;
    const cam = this.camera;
    cam.position.set(this.pos.x, this.eyeCur + bobY + Math.sin(time * 0.7) * 0.004, this.pos.z).addScaledVector(right, bobX);
    cam.rotation.order = 'YXZ';
    cam.rotation.set(this.pitch + Math.sin(time * 0.5) * 0.003, this.yaw, Math.cos(this.bob) * 0.004 * speed);
    if (this.shake > 0.01) {
      const s = Math.min(this.shake, 1.5);
      cam.position.x += (Math.random() - 0.5) * 0.03 * s; cam.position.y += (Math.random() - 0.5) * 0.03 * s;
      cam.rotation.z += (Math.random() - 0.5) * 0.02 * s;
    }
    this.shake *= Math.exp(-dt * 4);
    cam.updateMatrixWorld();
  }

  forward(out = new THREE.Vector3()) { return this.camera.getWorldDirection(out); }
}

// Hand-held flashlight: lags behind the view with a slight tremor.
export class Flashlight {
  constructor(scene, cookie, { intensity = 40, shadowSize = 2048 } = {}) {
    this.light = new THREE.SpotLight(0xfff0d8, 0, 30, 0.42, 0.55, 2);
    if (cookie) this.light.map = cookie;
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(shadowSize, shadowSize);
    this.light.shadow.bias = -0.0003; this.light.shadow.normalBias = 0.015;
    this.light.shadow.camera.near = 0.08; this.light.shadow.camera.far = 25;
    this.rig = new THREE.Object3D();
    this.rig.add(this.light, this.light.target);
    this.light.position.set(0.17, -0.2, 0.05);
    this.light.target.position.set(0.04, -0.85, -4); // a touch below the eye line, so the floor ahead is lit
    scene.add(this.rig);
    this.on = false; this.base = intensity; this.flicker = 1; this.available = true;
  }
  toggle() { if (this.available) this.on = !this.on; return this.on; }
  update(dt, camera, time) {
    this.rig.position.copy(camera.position);
    this.rig.quaternion.slerp(camera.quaternion, 1 - Math.exp(-dt * 14));
    this.rig.rotateX(Math.sin(time * 1.7) * 0.0015); this.rig.rotateY(Math.cos(time * 1.3) * 0.0015);
    this.flicker = Math.random() < 0.003 ? 0.35 : this.flicker + (1 - this.flicker) * (1 - Math.exp(-dt * 20));
    this.light.intensity = this.on ? this.base * this.flicker : 0;
    this.rig.updateMatrixWorld(true);
  }
  get intensityFactor() { return this.on ? this.flicker : 0; }
}
