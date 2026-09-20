// Seeded LCG — legacy-compatible on purpose: same seed => same puzzle as before the refactor.
export const makeRng = seed => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
export const shuffle = (a, rnd) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// FNV-1a over (day, n, index[, algoVersion>1]); day = UTC day number.
export function dailySeed(day, n, index, ver = 1) {
  let h = 0x811c9dc5 >>> 0;
  for (const v of ver > 1 ? [day, n, index, ver] : [day, n, index]) { h ^= v >>> 0; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
export function hashStr(s) { let h = 0x811c9dc5 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }
