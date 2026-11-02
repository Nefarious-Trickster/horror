import { generateTexture } from './texgen.js';

self.onmessage = (e) => {
  const job = e.data;
  const out = generateTexture(job);
  self.postMessage({ id: job.id, ...out }, [out.albedo.buffer, out.normal.buffer, out.orm.buffer]);
};
