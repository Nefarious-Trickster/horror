import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

// Planar floor reflections for polished floors. A Reflector renders the mirrored scene at
// reduced resolution; the floor material blends it in by Fresnel and blurs it by distance,
// with the floor's normal map breaking it up. Every `every` frames only.
export function addFloorReflection(scene, renderer, floorMaterials, { y = 0, size = 60, scale = 0.5, strength = 0.35, every = 1 } = {}) {
  const v = renderer.getSize(new THREE.Vector2());
  const pr = renderer.getPixelRatio();
  const refl = new Reflector(new THREE.PlaneGeometry(size, size), {
    textureWidth: Math.round(v.x * pr * scale), textureHeight: Math.round(v.y * pr * scale), clipBias: 0.003, multisample: 0,
  });
  refl.rotation.x = -Math.PI / 2; refl.position.y = y - 0.001;
  // the reflector itself draws nothing; it only fills its render target
  refl.material.colorWrite = false; refl.material.depthWrite = false;
  refl.renderOrder = -10;
  refl.userData.dynamic = true;
  const rt = refl.getRenderTarget();
  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); blank.needsUpdate = true;
  const uniforms = { tRefl: { value: rt.texture }, reflMatrix: { value: refl.material.uniforms.textureMatrix.value }, reflStrength: { value: strength } };
  const render = refl.onBeforeRender;
  let frame = 0;
  // the floor must not sample the reflection while the reflection itself is being drawn
  refl.onBeforeRender = function (...args) {
    if (frame++ % every !== 0) return;
    uniforms.tRefl.value = blank; render.apply(this, args); uniforms.tRefl.value = rt.texture;
  };
  scene.add(refl);
  for (const m of floorMaterials) {
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
      prev?.(sh, r);
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 reflMatrix; varying vec4 vReflUv;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvReflUv = reflMatrix * modelMatrix * vec4(transformed, 1.0);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tRefl; uniform float reflStrength; varying vec4 vReflUv;')
        .replace('#include <opaque_fragment>', `
          {
            vec2 ruv = vReflUv.xy / vReflUv.w + normal.xy * 0.012;
            float blur = 0.0025 + roughnessFactor * 0.01;
            vec3 rc = texture2D(tRefl, ruv).rgb * 0.4
              + texture2D(tRefl, ruv + vec2(blur, 0.0)).rgb * 0.15 + texture2D(tRefl, ruv - vec2(blur, 0.0)).rgb * 0.15
              + texture2D(tRefl, ruv + vec2(0.0, blur * 2.0)).rgb * 0.15 + texture2D(tRefl, ruv - vec2(0.0, blur * 2.0)).rgb * 0.15;
            float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
            outgoingLight += rc * reflStrength * mix(0.35, 1.0, fres); // the clear coat is what shines
          }
          #include <opaque_fragment>`);
    };
    m.customProgramCacheKey = () => 'reflfloor';
    m.needsUpdate = true;
  }
  return { reflector: refl, uniforms, dispose() { refl.removeFromParent(); refl.dispose(); } };
}
