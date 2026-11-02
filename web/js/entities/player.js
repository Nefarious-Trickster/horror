import * as THREE from 'three';

const EYE = 1.62, CROUCH_EYE = 1.0, RADIUS = 0.28;

export class Player {
  constructor(game) {
    this.game = game;
    const cam = this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.03, 80);
    cam.rotation.order = 'YXZ';
    this.pos = new THREE.Vector3(7.5, 0, 3.6);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI; this.pitch = 0;
    this.eye = EYE;
    this.crouch = false;
    this.running = false;
    this.stamina = 1; this.exhausted = false;
    this.bob = 0; this.bobAmt = 0; this.lastStepSign = 1;
    this.sensitivity = 1;
    this.keys = new Set();
    this.mouseDX = 0; this.mouseDY = 0;
    this.battery = 1;
    this.flashOn = true;
    this.bottles = 0;
    this.hidden = null;       // locker object
    this.holdingBreath = false;
    this.breath = 1;
    this.breathTimer = 0;
    this.noiseLevel = 0;      // for HUD/AI
    this.frozen = false;      // cutscenes
    this.shake = 0;
    this.fear = 0;
    this.lookTarget = null;   // forced look (cutscenes)
    this.lean = 0;
    this.mouseLagX = 0;
    this.vmOffset = new THREE.Vector3();
    this.buildFlashlight();
  }

  buildFlashlight() {
    const g = this.game;
    // the light itself lags behind the view for a physical feel
    this.flashRig = new THREE.Object3D();
    g.scene.add(this.flashRig);
    const spot = this.spot = new THREE.SpotLight(0xfff1dc, 60, 28, 0.52, 0.75, 1.45);
    spot.castShadow = true;
    spot.shadow.mapSize.set(g.renderer.q.shadow, g.renderer.q.shadow);
    spot.shadow.camera.near = 0.15; spot.shadow.camera.far = 26;
    spot.shadow.bias = -0.0004; spot.shadow.normalBias = 0.025;
    spot.map = g.cookie;
    spot.position.set(0, 0, 0);
    this.flashRig.add(spot);
    spot.target.position.set(0, 0, -1);
    this.flashRig.add(spot.target);
    // faint fill so the area right in front of you isn't pitch black around the beam
    this.fill = new THREE.PointLight(0xffe8cc, 0.25, 3.5, 2);
    this.flashRig.add(this.fill);
    this.flashQuat = new THREE.Quaternion();

    // volumetric beam cone (additive, fades with distance and view angle)
    const len = 7;
    const cone = new THREE.CylinderGeometry(0.02, Math.tan(0.42) * len, len, 32, 12, true);
    cone.translate(0, -len / 2, 0);
    cone.rotateX(Math.PI / 2);
    this.beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uLen: { value: len }, uI: { value: 0.05 } },
      vertexShader: `
        varying float vD; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){
          vD = -position.z;
          vP = (modelMatrix * vec4(position,1.0)).xyz;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uTime, uLen, uI; varying float vD; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
        float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
        void main(){
          float t = vD / uLen;
          float fall = pow(1.0 - t, 2.0) * smoothstep(0.04, 0.3, t);
          float edge = pow(abs(dot(vN, vV)), 1.6);
          float dust = 0.55 + 0.45 * n3(vP * 2.5 + vec3(0.0, uTime*0.08, uTime*0.05));
          gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * fall * edge * dust * uI, 1.0);
        }`,
    });
    this.beam = new THREE.Mesh(cone, this.beamMat);
    this.beam.frustumCulled = false;
    this.beam.renderOrder = 5;
    this.flashRig.add(this.beam);

    // dust motes floating around the player, only visible inside the beam
    const N = 900;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) { pos[i * 3] = Math.random() * 8 - 4; pos[i * 3 + 1] = Math.random() * 3; pos[i * 3 + 2] = Math.random() * 8 - 4; seed[i] = Math.random(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.dustMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uLightPos: { value: new THREE.Vector3() }, uLightDir: { value: new THREE.Vector3(0, 0, -1) }, uOn: { value: 1 } },
      vertexShader: `
        attribute float seed; uniform float uTime; uniform vec3 uCenter, uLightPos, uLightDir; uniform float uOn;
        varying float vA;
        void main(){
          vec3 p = position;
          p.x += sin(uTime*0.3 + seed*40.0)*0.3; p.y += sin(uTime*0.2 + seed*17.0)*0.2 - uTime*0.02*seed; p.z += cos(uTime*0.25 + seed*23.0)*0.3;
          p = mod(p - uCenter + vec3(4.0, 0.0, 4.0), vec3(8.0, 3.0, 8.0)) + uCenter - vec3(4.0, 0.0, 4.0);
          p.y = mod(p.y, 3.0);
          vec3 L = p - uLightPos; float d = length(L);
          float inBeam = smoothstep(0.82, 0.95, dot(normalize(L), uLightDir)) * smoothstep(7.0, 0.5, d);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vA = inBeam * uOn * (0.4 + 0.6*fract(seed*7.0)) * smoothstep(0.35, 0.8, -mv.z);
          gl_PointSize = clamp((0.6 + seed*1.2) * (2.2 / -mv.z), 0.5, 3.5);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying float vA; void main(){ vec2 c = gl_PointCoord-0.5; float a = smoothstep(0.5,0.0,length(c)); gl_FragColor = vec4(vec3(1.0,0.95,0.85)*a*vA*0.6, 1.0); }`,
    });
    this.dust = new THREE.Points(geo, this.dustMat);
    this.dust.frustumCulled = false;
    g.scene.add(this.dust);

    // viewmodel: a battered steel flashlight, lower right
    const K = g.kit;
    const vm = this.viewmodel = new THREE.Group();
    const torch = new THREE.Group();
    torch.add(K.cyl(0.017, 0.017, 0.2, 'genMetal', 0, 0, 0.02, Math.PI / 2, 0, 0, 20));
    for (let i = 0; i < 5; i++) torch.add(K.cyl(0.0178, 0.0178, 0.004, 'blackPlastic', 0, 0, 0.05 + i * 0.014, Math.PI / 2, 0, 0, 20));
    torch.add(K.cyl(0.027, 0.0175, 0.05, 'genMetal', 0, 0, -0.105, Math.PI / 2, 0, 0, 24));
    torch.add(K.cyl(0.0285, 0.0285, 0.012, 'chrome', 0, 0, -0.135, Math.PI / 2, 0, 0, 24));
    this.lensMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0d0, emissiveIntensity: 3 });
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.024, 24), this.lensMat);
    lens.position.z = -0.142; lens.rotation.y = Math.PI; torch.add(lens);
    torch.add(K.box(0.01, 0.008, 0.022, 'binderRed', 0, 0.018, 0.03));
    torch.rotation.set(0.04, 0.1, 0);
    vm.add(torch);
    vm.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    this.camera.add(vm);
    g.scene.add(this.camera);
  }

  get eyePos() { return this.camera.position; }
  forward(out = new THREE.Vector3()) { return this.camera.getWorldDirection(out); }

  onMouse(dx, dy) { this.mouseDX += dx; this.mouseDY += dy; }

  update(dt) {
    const g = this.game, lvl = g.level;
    // --- look
    const sens = 0.0022 * this.sensitivity;
    if (!this.frozen || this.hidden) {
      this.yaw -= this.mouseDX * sens;
      this.pitch -= this.mouseDY * sens;
    }
    this.mouseDX = this.mouseDY = 0;
    if (this.hidden) {
      const base = this.hidden.yaw;
      let d = ((this.yaw - base + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      d = THREE.MathUtils.clamp(d, -0.55, 0.55);
      this.yaw = base + d;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -0.35, 0.3);
    }
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.45, 1.45);
    if (this.lookTarget) {
      const tp = this.lookTarget;
      const dx = tp.x - this.camera.position.x, dz = tp.z - this.camera.position.z, dy = tp.y - this.camera.position.y;
      const ty = Math.atan2(-dx, -dz), tpi = Math.atan2(dy, Math.hypot(dx, dz));
      let dyaw = ((ty - this.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      const k = 1 - Math.exp(-dt * 10);
      this.yaw += dyaw * k; this.pitch += (tpi - this.pitch) * k;
    }

    // --- movement
    let mx = 0, mz = 0;
    if (!this.frozen && !this.hidden) {
      if (this.keys.has('KeyW')) mz -= 1;
      if (this.keys.has('KeyS')) mz += 1;
      if (this.keys.has('KeyA')) mx -= 1;
      if (this.keys.has('KeyD')) mx += 1;
    }
    const wantsRun = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && mz < 0 && !this.crouch;
    this.running = wantsRun && !this.exhausted && (mx || mz);
    const speed = this.crouch ? 1.15 : this.running ? 4.4 : 2.15;
    const len = Math.hypot(mx, mz) || 1;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const wx = (mx * cy + mz * sy) / len, wz = (-mx * sy + mz * cy) / len;
    const accel = (mx || mz) ? 12 : 10;
    this.vel.x += (wx * speed * (mx || mz ? 1 : 0) - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wz * speed * (mx || mz ? 1 : 0) - this.vel.z) * Math.min(1, accel * dt);
    if (!this.hidden) {
      let nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
      [nx, nz] = lvl.collide(nx, nz, RADIUS);
      const moved = Math.hypot(nx - this.pos.x, nz - this.pos.z);
      this.pos.x = nx; this.pos.z = nz;
      this.stepAdvance(moved, dt);
    }

    // stamina
    if (this.running) { this.stamina -= dt / 6.5; if (this.stamina <= 0) { this.stamina = 0; this.exhausted = true; g.audio.breath(1, true); } }
    else this.stamina = Math.min(1, this.stamina + dt / (this.crouch ? 4 : 6));
    if (this.exhausted && this.stamina > 0.35) this.exhausted = false;
    // heavy breathing when tired
    this.breathTimer -= dt;
    if (this.breathTimer <= 0 && !this.holdingBreath) {
      const tired = 1 - this.stamina;
      const intensity = Math.max(tired, this.fear * 0.7);
      if (intensity > 0.25) { g.audio.breath(intensity, (this._inh = !this._inh)); this.breathTimer = 0.9 - intensity * 0.45; }
      else this.breathTimer = 1;
      if (this.hidden && intensity > 0.25) g.emitNoise(this.pos.x, this.pos.z, 1.6 * intensity, 'breath');
    }
    // hold breath while hiding
    if (this.hidden && this.holdingBreath) {
      this.breath -= dt / 9;
      if (this.breath <= 0) { this.breath = 0; this.holdingBreath = false; g.audio.breath(1.6, true); g.emitNoise(this.pos.x, this.pos.z, 5, 'gasp'); this.breathTimer = 0.5; }
    } else this.breath = Math.min(1, this.breath + dt / 5);

    // crouch height
    const targetEye = this.hidden ? 1.55 : this.crouch ? CROUCH_EYE : EYE;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 9);

    // camera placement with bob
    const bobV = Math.sin(this.bob * 2) * 0.032 * this.bobAmt;
    const bobH = Math.cos(this.bob) * 0.025 * this.bobAmt;
    const cam = this.camera;
    const shakeX = (Math.random() - 0.5) * this.shake * 0.04, shakeY = (Math.random() - 0.5) * this.shake * 0.04;
    if (this.hidden) cam.position.copy(this.hidden.eye);
    else cam.position.set(this.pos.x + bobH * cy, this.eye + bobV, this.pos.z - bobH * sy);
    cam.rotation.set(this.pitch + shakeY + Math.sin(this.bob * 2) * 0.004 * this.bobAmt, this.yaw + shakeX, Math.cos(this.bob) * 0.006 * this.bobAmt + this.lean);
    this.shake = Math.max(0, this.shake - dt * 2);
    cam.updateMatrixWorld();

    // flashlight rig follows with lag; the light sits at the torch lens
    const vm0 = this.viewmodel.position;
    const camQ = cam.quaternion;
    this.flashQuat.slerp(camQ, 1 - Math.exp(-dt * (this.running ? 9 : 14)));
    const off = this.vmOffset.set(vm0.x + 0.005, vm0.y + 0.012, vm0.z - 0.15).applyQuaternion(camQ);
    this.flashRig.position.copy(cam.position).add(off);
    this.flashRig.quaternion.copy(this.flashQuat);
    // battery & flicker
    const on = this.flashOn && !this.hidden && this.battery > 0;
    if (on) this.battery = Math.max(0, this.battery - dt / 600);
    let flick = 1;
    if (this.battery < 0.2) flick *= Math.random() < 0.04 + (0.2 - this.battery) * 0.3 ? 0.15 : 1;
    if (g.monster?.emf > 0) flick *= Math.random() < g.monster.emf * 0.25 ? Math.random() * 0.3 : 1;
    if (this.flickerOverride != null) flick *= this.flickerOverride;
    const bat = 0.55 + 0.45 * Math.min(1, this.battery * 3);
    const I = on ? bat * flick : 0;
    this.spot.intensity = 60 * I;
    this.fill.intensity = 0.25 * I;
    this.beamMat.uniforms.uI.value = 0.045 * I;
    this.lensMat.emissiveIntensity = 3 * I + 0.02;
    this.beamMat.uniforms.uTime.value += dt;
    // dust
    this.dustMat.uniforms.uTime.value += dt;
    this.dustMat.uniforms.uCenter.value.copy(cam.position);
    this.dustMat.uniforms.uLightPos.value.copy(this.flashRig.position);
    this.dustMat.uniforms.uLightDir.value.set(0, 0, -1).applyQuaternion(this.flashQuat);
    this.dustMat.uniforms.uOn.value = I;

    // viewmodel sway
    const vm = this.viewmodel;
    vm.visible = !this.hidden;
    const t = performance.now() / 1000;
    vm.position.set(0.21 + Math.cos(this.bob) * 0.008 * this.bobAmt + this.mouseLagX, -0.2 + Math.abs(Math.sin(this.bob)) * 0.01 * this.bobAmt + Math.sin(t * 1.3) * 0.002 - (this.running ? 0.03 : 0), -0.42);
    vm.rotation.set(0.02 + (this.running ? 0.25 : 0), 0.0, 0);
    this.mouseLagX *= 0.9;
  }

  stepAdvance(moved, dt) {
    const g = this.game;
    const speedNow = moved / Math.max(dt, 1e-4);
    const target = Math.min(1, speedNow / 2.2) * (this.crouch ? 0.6 : 1);
    this.bobAmt += (target - this.bobAmt) * Math.min(1, dt * 8);
    if (moved < 1e-4) return;
    const stepLen = this.running ? 0.85 : this.crouch ? 0.5 : 0.68;
    this.bob += (moved / stepLen) * Math.PI;
    const s = Math.sign(Math.sin(this.bob));
    if (s !== this.lastStepSign) {
      this.lastStepSign = s;
      const surf = g.surfaceAt(this.pos.x, this.pos.z);
      const intensity = this.running ? 1 : this.crouch ? 0.25 : 0.55;
      g.audio.footstep(surf, intensity);
      const radius = this.running ? 14 : this.crouch ? 1.2 : 5;
      g.emitNoise(this.pos.x, this.pos.z, radius * (surf === 'water' || surf === 'metal' ? 1.4 : 1), 'step');
      this.noiseLevel = radius;
    }
  }
}
