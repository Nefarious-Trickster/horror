// Player settings, saved locally. Storage may be unavailable; defaults still work.
const KEY = 'the-tall-one/settings/v1';
const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
export const QUALITIES = ['low', 'medium', 'high', 'ultra'];
const DEFAULTS = { sens: 1.0, invertY: false, fov: 72, quality: touch ? 'low' : 'high', showFps: false, volume: 0.85, dynamicRes: true };

function load() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; } catch { return { ...DEFAULTS }; }
}
const listeners = new Set();
export const settings = {
  ...load(),
  set(k, v) {
    this[k] = v;
    try { const { set, on, ...data } = this; localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* not persisted */ }
    for (const f of listeners) f(k, v);
  },
  on(f) { listeners.add(f); return () => listeners.delete(f); },
};
