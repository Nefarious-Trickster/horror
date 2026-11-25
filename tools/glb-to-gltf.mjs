// Converts a .glb into a self-contained .gltf (JSON with the binary buffer embedded as base64).
// Useful for hosts that serve JSON but not binary glTF.
//   node tools/glb-to-gltf.mjs assets/creature.glb out/creature.gltf.json
import fs from 'node:fs';

const [src, dst] = process.argv.slice(2);
if (!src || !dst) { console.error('usage: node tools/glb-to-gltf.mjs in.glb out.gltf'); process.exit(1); }
const buf = fs.readFileSync(src);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB file');
let off = 12, json = null, bin = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
  const chunk = buf.subarray(off + 8, off + 8 + len);
  if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
  else if (type === 0x004e4942) bin = chunk;
  off += 8 + len;
}
json.buffers = [{ byteLength: bin.length, uri: 'data:application/octet-stream;base64,' + bin.toString('base64') }];
fs.writeFileSync(dst, JSON.stringify(json));
console.log(`wrote ${dst} (${(fs.statSync(dst).size / 1e6).toFixed(1)} MB)`);
