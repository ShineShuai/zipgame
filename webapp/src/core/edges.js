// Edge id e = cell*2 + t.  t=0: edge between cell and cell+1 (text "V,r,c").  t=1: between cell and cell+n ("H,r,c").
export const edgeId = (n, a, b) => a < b ? a * 2 + (b - a === 1 ? 0 : 1) : b * 2 + (a - b === 1 ? 0 : 1);
export const edgeCells = (n, e) => { const a = e >> 1; return [a, e & 1 ? a + n : a + 1]; };
export const hasWallId = (w, e) => (w[e >> 1] >> (e & 1)) & 1;
export const setWallId = (w, e, on) => { if (on) w[e >> 1] |= 1 << (e & 1); else w[e >> 1] &= ~(1 << (e & 1)); };
export const hasWall = (p, a, b) => hasWallId(p.walls, edgeId(p.n, a, b));
// All grid edges, in the legacy order (row-major; right edge before down edge).
export function allEdges(n) {
  const out = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const i = r * n + c;
    if (c + 1 < n) out.push(i * 2);
    if (r + 1 < n) out.push(i * 2 + 1);
  }
  return out;
}
export const wallIds = p => { const o = []; for (let i = 0; i < p.n * p.n; i++) for (let t = 0; t < 2; t++) if ((p.walls[i] >> t) & 1) o.push(i * 2 + t); return o; };
export const wallCount = p => wallIds(p).length;
export const edgeToKey = (n, e) => `${e & 1 ? 'H' : 'V'},${((e >> 1) / n) | 0},${(e >> 1) % n}`;
export const keyToEdge = (n, k) => { const [t, r, c] = k.split(','); return (+r * n + +c) * 2 + (t === 'H' ? 1 : 0); };
export const pathEdgeIds = (n, path) => { const o = []; for (let i = 1; i < path.length; i++) o.push(edgeId(n, path[i - 1], path[i])); return o; };
