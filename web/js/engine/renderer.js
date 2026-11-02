import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

export const QUALITY = {
  low: { pixelRatio: 0.75, shadow: 512, msaa: 0, gtao: false, bloom: true, lights: 4 },
  medium: { pixelRatio: 1, shadow: 1024, msaa: 2, gtao: false, bloom: true, lights: 6 },
  high: { pixelRatio: 1, shadow: 2048, msaa: 4, gtao: true, bloom: true, lights: 8 },
  ultra: { pixelRatio: 1.5, shadow: 2048, msaa: 4, gtao: true, bloom: true, lights: 10 },
};

const HorrorShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uGrain: { value: 0.06 },
    uAberr: { value: 0.0012 },
    uVignette: { value: 1.0 },
    uFear: { value: 0 },
    uRed: { value: 0 },
    uWarp: { value: 0 },
    uGamma: { value: 1 },
    uScan: { value: 0 },
    uDesat: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uAberr, uVignette, uFear, uRed, uWarp, uGamma, uScan, uDesat;
    uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 uv = 0.5 + c * (1.0 - 0.035 * r2 - uWarp * 0.12 * r2);
      // interference tearing when the creature is near
      float band = step(0.985 - uScan * 0.05, hash(vec2(floor(uv.y * 90.0), floor(uTime * 14.0))));
      uv.x += band * (hash(vec2(uTime, uv.y)) - 0.5) * 0.03 * uScan;
      uv.x += sin(uv.y * 30.0 + uTime * 3.0) * 0.0015 * uWarp;
      vec2 dir = c * (uAberr + uFear * 0.007 + uScan * 0.004);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir * 1.2).b;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // grade: desaturate, cool shadows, sickly mids
      col = mix(vec3(l), col, 0.78 - uFear * 0.25 - uDesat);
      col *= vec3(0.97, 1.0, 0.97);
      col += vec3(-0.004, 0.004, 0.009) * (1.0 - smoothstep(0.0, 0.25, l));
      col = mix(col, col * vec3(1.35, 0.55, 0.5), uRed);
      col = pow(max(col, 0.0), vec3(1.0 / uGamma));
      float vig = smoothstep(0.95, 0.25, length(c * vec2(1.0, 0.8)) * (1.0 + uFear * 0.45));
      col *= mix(1.0, vig, uVignette);
      float n = hash(vUv * uRes + fract(uTime * 7.13) * 91.0) - 0.5;
      col += n * (uGrain + uScan * 0.08) * (0.55 + 0.45 * (1.0 - l));
      col *= 1.0 - uScan * 0.07 * (0.5 + 0.5 * sin(vUv.y * uRes.y * 1.3 + uTime * 40.0));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Renderer {
  constructor(container, quality = 'high') {
    this.qName = quality;
    this.q = QUALITY[quality];
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.pixelRatio * (window.devicePixelRatio > 1 ? 1.25 : 1)));
    r.setSize(window.innerWidth, window.innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(r.domElement);
    this.canvas = r.domElement;
  }

  setup(scene, camera) {
    this.scene = scene; this.camera = camera;
    const r = this.renderer, q = this.q;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.msaa });
    const comp = this.composer = new EffectComposer(r, rt);
    comp.addPass(new RenderPass(scene, camera));
    if (q.gtao) {
      const ao = this.gtao = new GTAOPass(scene, camera, size.x, size.y);
      ao.output = GTAOPass.OUTPUT.Default;
      ao.blendIntensity = 0.85;
      ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.5, thickness: 1.5, scale: 1.0, samples: 12, distanceFallOff: 1.0 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      comp.addPass(ao);
    }
    if (q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.4, 0.55, 0.95);
      comp.addPass(this.bloom);
    }
    comp.addPass(new OutputPass());
    this.fx = new ShaderPass(HorrorShader);
    comp.addPass(this.fx);
    this.fx.uniforms.uRes.value.set(size.x, size.y);
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.fx.uniforms.uRes.value.set(size.x, size.y);
  }

  render(dt) {
    this.fx.uniforms.uTime.value += dt;
    this.composer.render(dt);
  }
}
