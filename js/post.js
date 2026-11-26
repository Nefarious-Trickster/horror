import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

// Film look: lens aberration, grade, vignette, animated grain, and a gentle sharpen so the
// image stays crisp at reduced render resolution.
const FilmShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uFear: { value: 0 },
    uVig: { value: 1 }, uGrain: { value: 1 }, uSat: { value: 0.8 }, uCA: { value: 1 }, uWarm: { value: 1 }, uSharp: { value: 0.25 }, uExpo: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uFear, uVig, uGrain, uSat, uCA, uWarm, uSharp, uExpo; uniform vec2 uRes; varying vec2 vUv;
    float h(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      float ca = (0.0012 + r2 * 0.006) * uCA + r2 * uFear * 0.02;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv - c * ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv + c * ca * 1.3).b;
      // contrast-adaptive sharpen (cheap 4-tap)
      vec2 px = 1.0 / uRes;
      vec3 nb = texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb;
      col = max(col + (col - nb * 0.25) * uSharp, 0.0);
      if (uExpo > 0.01) {
        // exposure: the image doubles and drifts, colour drains toward a sick grey-green, the edges close in
        float e = uExpo, wob = sin(uTime * 0.7) * 0.5 + sin(uTime * 1.9) * 0.3;
        vec2 o = vec2(wob * 0.012, cos(uTime * 0.53) * 0.006) * e;
        vec3 ghost = texture2D(tDiffuse, vUv + o).rgb;
        col = mix(col, max(col, ghost), 0.45 * e);
        float lg = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(col, vec3(lg) * vec3(0.86, 1.0, 0.82), 0.5 * e);
        float pulse = 0.5 + 0.5 * sin(uTime * (1.1 + e));
        col *= mix(1.0, smoothstep(0.85 - 0.35 * e - 0.05 * pulse, 0.15, length(c * vec2(1.0, 1.3))), e * 0.85);
      }
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSat);
      col *= mix(vec3(1.0), mix(vec3(0.86, 1.0, 1.02), vec3(1.04, 1.0, 0.88), smoothstep(0.0, 0.5, l)), uWarm);
      col = max(col - 0.004, 0.0) * 1.02;
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.18); // gentle S-curve for contrast
      float vig = smoothstep(0.95, 0.25, length(c * vec2(1.0, 1.25)));
      col *= mix(1.0 - 0.85 * uVig, 1.0, vig);
      float g = h(vUv * uRes + fract(uTime * 7.31) * 913.0) + h(vUv * uRes * 0.5 + fract(uTime * 3.7) * 311.0) - 1.0;
      col += g * (0.035 + 0.04 * (1.0 - l)) * uGrain;
      col += (h(vec2(uTime, vUv.y * 0.1)) - 0.5) * 0.004;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// quality: 'low' | 'medium' | 'high' | 'ultra'
export function createPost(renderer, scene, camera, { quality = 'high', ao = true } = {}) {
  const size = renderer.getSize(new THREE.Vector2());
  const Q = { low: 0, medium: 1, high: 2, ultra: 3 }[quality] ?? 2;
  // MSAA on the main scene render (high/ultra); SMAA afterwards everywhere but low
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: Q >= 2 ? 4 : 0 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  let gtao = null;
  if (ao && Q >= 2) {
    gtao = new GTAOPass(scene, camera, size.x, size.y);
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.blendIntensity = 0.85;
    gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1.2, scale: 1.0, samples: Q >= 3 ? 16 : 8 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: Q >= 3 ? 12 : 6 });
    composer.addPass(gtao);
  }
  // safety net: a stray NaN/Inf pixel (bad normal, degenerate geometry) would be smeared over the whole
  // frame by the bloom blur and black out the screen. Zero them before bloom.
  const sanitize = new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
      void main() { vec4 c = texture2D(tDiffuse, vUv);
        if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
        float m = max(max(c.r, c.g), c.b);
        if (m > 2.2) c.rgb *= 2.2 / m; // no highlight brighter than this: keeps hot specks from blooming into suns
        gl_FragColor = c; }`,
  });
  sanitize.enabled = Q >= 1;
  composer.addPass(sanitize);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.45, 0.7, 0.82);
  bloom.enabled = Q >= 1;
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  let smaa = null;
  if (Q >= 1) { smaa = new SMAAPass(size.x, size.y); composer.addPass(smaa); }
  const film = new ShaderPass(FilmShader);
  composer.addPass(film);
  let look = 'horror';
  return {
    composer, film, gtao, bloom, quality,
    setSize(w, h, pr) { composer.setPixelRatio(pr); composer.setSize(w, h); film.uniforms.uRes.value.set(w * pr, h * pr); film.uniforms.uSharp.value = pr < 1 ? 0.45 : 0.22; },
    // grade presets: 'horror' (default) or 'clinical' (clean, cool, light vignette)
    setLook(name) {
      look = name;
      const u = film.uniforms;
      const L = name === 'clinical' ? { uVig: 0.4, uGrain: 0.3, uSat: 0.95, uCA: 0.45, uWarm: 0.2 } : { uVig: 1, uGrain: 1, uSat: 0.82, uCA: 1, uWarm: 1 };
      for (const [k, v] of Object.entries(L)) u[k].value = v;
      bloom.strength = name === 'clinical' ? 0.12 : 0.28; bloom.threshold = name === 'clinical' ? 1.0 : 0.95;
    },
    get look() { return look; },
    render(t, fear, expo = 0) { film.uniforms.uTime.value = t; film.uniforms.uFear.value = fear; film.uniforms.uExpo.value = expo; composer.render(); },
    dispose() { composer.dispose?.(); rt.dispose(); gtao?.dispose?.(); },
  };
}
