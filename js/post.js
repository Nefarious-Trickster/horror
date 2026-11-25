import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Film look: lens aberration, sickly grade, heavy vignette, animated grain.
const FilmShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uFear: { value: 0 }, uVig: { value: 1 }, uGrain: { value: 1 }, uSat: { value: 0.8 }, uCA: { value: 1 }, uWarm: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uFear, uVig, uGrain, uSat, uCA, uWarm; uniform vec2 uRes; varying vec2 vUv;
    float h(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      float ca = (0.0012 + r2 * 0.006) * uCA + r2 * uFear * 0.02;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv - c * ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv + c * ca * 1.3).b;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSat);
      col *= mix(vec3(1.0), mix(vec3(0.86, 1.0, 1.02), vec3(1.04, 1.0, 0.88), smoothstep(0.0, 0.5, l)), uWarm);
      col = max(col - 0.004, 0.0) * 1.02;
      float vig = smoothstep(0.95, 0.25, length(c * vec2(1.0, 1.25)));
      col *= mix(1.0 - 0.85 * uVig, 1.0, vig);
      float g = h(vUv * uRes + fract(uTime * 7.31) * 913.0) + h(vUv * uRes * 0.5 + fract(uTime * 3.7) * 311.0) - 1.0;
      col += g * (0.035 + 0.04 * (1.0 - l)) * uGrain;
      col += (h(vec2(uTime, vUv.y * 0.1)) - 0.5) * 0.004; // subtle line flicker
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createPost(renderer, scene, camera, { ao = true } = {}) {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  let gtao = null;
  if (ao) {
    gtao = new GTAOPass(scene, camera, size.x, size.y);
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.blendIntensity = 0.85;
    gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1.2, scale: 1.0, samples: 12 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    composer.addPass(gtao);
  }
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.45, 0.7, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const film = new ShaderPass(FilmShader);
  composer.addPass(film);
  return {
    composer, film, gtao, bloom,
    setSize(w, h, pr) { composer.setPixelRatio(pr); composer.setSize(w, h); film.uniforms.uRes.value.set(w * pr, h * pr); },
    // grade presets: 'horror' (default) or 'clinical' (clean, cool, light vignette)
    setLook(name) {
      const u = film.uniforms;
      const L = name === 'clinical' ? { uVig: 0.45, uGrain: 0.35, uSat: 0.92, uCA: 0.5, uWarm: 0.25 } : { uVig: 1, uGrain: 1, uSat: 0.8, uCA: 1, uWarm: 1 };
      for (const [k, v] of Object.entries(L)) u[k].value = v;
      bloom.strength = name === 'clinical' ? 0.12 : 0.45; bloom.threshold = name === 'clinical' ? 0.96 : 0.82;
    },
    render(t, fear) { film.uniforms.uTime.value = t; film.uniforms.uFear.value = fear; composer.render(); },
  };
}
