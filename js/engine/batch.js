import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Static batching: merge every non-moving mesh that shares a material (and the same set of
// vertex attributes and shadow flags) into one mesh, baking world transforms into the
// geometry. A furnished room goes from thousands of draw calls to a few hundred, which
// matters even more because every shadow-casting light renders the scene again.
//
// Objects (and their descendants) are skipped when they, or an ancestor, have
// userData.dynamic = true, or are skinned/instanced/points/lines, or are transparent.
// Zero-length or non-finite normals turn into NaN in the lighting on real GPUs, and one NaN pixel
// is smeared across the whole frame by the bloom blur (a black screen). Repair them in place.
export function repairNormals(geo) {
  const n = geo.attributes?.normal;
  if (!n || n.isInterleavedBufferAttribute) return 0;
  let fixed = 0;
  for (let i = 0; i < n.count; i++) {
    const x = n.getX(i), y = n.getY(i), z = n.getZ(i), l = x * x + y * y + z * z;
    if (!(l > 1e-12) || !Number.isFinite(l)) { n.setXYZ(i, 0, 1, 0); fixed++; }
  }
  if (fixed) n.needsUpdate = true;
  return fixed;
}

export function staticBatch(root, { keepNames = false } = {}) {
  root.updateMatrixWorld(true);
  const seen = new Set();
  root.traverse((o) => { if ((o.isMesh || o.isSkinnedMesh) && o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); repairNormals(o.geometry); } });
  const groups = new Map();
  const isDynamic = (o) => { for (let p = o; p; p = p.parent) if (p.userData?.dynamic) return true; return false; };
  const candidates = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh) return;
    if (!o.visible || Array.isArray(o.material) || o.material.transparent || o.morphTargetInfluences) return;
    if (o.geometry.morphAttributes && Object.keys(o.geometry.morphAttributes).length) return;
    if (isDynamic(o)) return;
    candidates.push(o);
  });
  for (const o of candidates) {
    const g = o.geometry;
    const attrs = Object.keys(g.attributes).sort().join(',');
    const key = `${o.material.uuid}|${attrs}|${g.index ? 'i' : 'n'}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}|${o.renderOrder}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }
  let before = 0, after = 0;
  for (const list of groups.values()) {
    before += list.length;
    if (list.length < 2) { after++; continue; }
    const geos = list.map((o) => {
      const g = o.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (g.attributes[k].isInterleavedBufferAttribute) g.setAttribute(k, g.attributes[k].clone());
      g.applyMatrix4(o.matrixWorld);
      if (o.matrixWorld.determinant() < 0 && g.index) { // mirrored: flip winding
        const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
      }
      return g;
    });
    let merged = null;
    try { merged = mergeGeometries(geos, false); } catch { merged = null; }
    if (!merged) { after += list.length; continue; }
    const m = new THREE.Mesh(merged, list[0].material);
    m.castShadow = list[0].castShadow; m.receiveShadow = list[0].receiveShadow; m.renderOrder = list[0].renderOrder;
    m.name = 'batch'; m.matrixAutoUpdate = false; m.updateMatrix();
    root.add(m);
    for (const o of list) o.removeFromParent();
    after++;
  }
  return { before, after };
}
