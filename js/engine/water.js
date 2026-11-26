import * as THREE from 'three';

// Standing water: a dark, glossy, murky surface over a set of floor rectangles, with expanding ripple
// rings (footsteps, drips, something moving through it). The surface hides whatever is under it.
//   const w = new Water(scene, rects, { level: 0.5 });
//   w.ripple(x, z, strength); w.update(t); w.setLevel(y)
const MAX = 32;

export class Water {
  constructor(scene, rects, { level = 0.5, color = 0x18201a, opacity = 0.86 } = {}) {
    const geos = rects.map((r) => {
      const g = new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0, 1, 1);
      g.rotateX(-Math.PI / 2); g.translate((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2);
      return g;
    });
    const geo = mergeSimple(geos);
    this.ripples = Array.from({ length: MAX }, () => new THREE.Vector4(0, 0, -99, 0));
    this.next = 0; this.time = 0;
    const uniforms = { uTime: { value: 0 }, uRip: { value: this.ripples } };
    this.uniforms = uniforms;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.2, metalness: 0.0, transparent: true, opacity, depthWrite: false, envMapIntensity: 0.6 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uniforms.uTime; sh.uniforms.uRip = uniforms.uRip;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vWPos; uniform float uTime; uniform vec4 uRip[${MAX}];`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 p = vWPos.xz; vec2 grad = vec2(0.0);
          // slow swell and fine chop so the surface is never quite still
          grad += vec2(cos(p.x * 1.3 + uTime * 0.45), cos(p.y * 1.1 - uTime * 0.38)) * 0.018;
          grad += vec2(cos((p.x + p.y) * 3.7 + uTime * 1.2), cos((p.x - p.y) * 3.1 - uTime * 0.9)) * 0.008;
          grad += vec2(cos(p.x * 9.0 - p.y * 4.0 + uTime * 2.1), cos(p.y * 8.0 + p.x * 3.0 - uTime * 1.7)) * 0.003;
          for (int i = 0; i < ${MAX}; i++) {
            vec4 r = uRip[i];
            float age = uTime - r.z;
            if (r.w <= 0.0 || age < 0.0 || age > 5.0) continue;
            vec2 d = p - r.xy; float dist = length(d) + 1e-4;
            float w = dist - age * 0.9;
            float env = exp(-w * w * 6.0) * r.w * exp(-age * 0.8) / (1.0 + dist * 1.2);
            grad += (d / dist) * cos(w * 22.0) * env * 0.35;
          }
          vec3 nW = normalize(vec3(-grad.x, 1.0, -grad.y));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        }`)
        // grazing angles reflect more and show less of what is underneath
        .replace('#include <opaque_fragment>', `
          float fres = pow(1.0 - clamp(dot(normalize(vViewPosition), -normal) * -1.0, 0.0, 1.0), 3.0);
          diffuseColor.a = clamp(diffuseColor.a + fres * 0.08, 0.0, 1.0);
          #include <opaque_fragment>`);
    };
    mat.defines = { GLOSSY: '' }; // exempt from the global roughness floor
    mat.customProgramCacheKey = () => 'water-v2';
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 3; this.mesh.receiveShadow = true;
    this.mesh.userData.dynamic = true;
    this.mesh.position.y = level; this.level = level;
    scene.add(this.mesh);
  }
  ripple(x, z, strength = 1) {
    const r = this.ripples[this.next]; this.next = (this.next + 1) % MAX;
    r.set(x, z, this.time, strength);
  }
  setLevel(y) { this.level = y; this.mesh.position.y = y; this.mesh.visible = y > 0.015; }
  update(t) { this.time = t; this.uniforms.uTime.value = t; }
  // is (x, z) standing in water, and how deep
  depthAt() { return this.mesh.visible ? this.level : 0; }
}

function mergeSimple(geos) {
  let n = 0, ni = 0;
  for (const g of geos) { n += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = new Uint32Array(ni);
  let o = 0, oi = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); uv.set(g.attributes.uv.array, o * 2);
    const gi = g.index.array; for (let k = 0; k < gi.length; k++) idx[oi + k] = gi[k] + o;
    o += g.attributes.position.count; oi += gi.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
