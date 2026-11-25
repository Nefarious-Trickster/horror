// Local save data (progress, story choices). Storage can be unavailable (private mode,
// blocked site data), so every access is guarded and the game works without it.
const KEY = 'the-tall-one/save/v1';
function read() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
function write(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* not persisted */ } }
export const save = {
  get(k, dflt = null) { const d = read(); return k in d ? d[k] : dflt; },
  set(k, v) { const d = read(); d[k] = v; write(d); },
  all() { return read(); },
  clear() { write({}); },
};
