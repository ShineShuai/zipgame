import { neighbourCell } from '../geom.js';

// Randomised Warnsdorff walk (legacy generator; rnd consumption order is part of the seeded contract). Returns null on dead end.
// wrap: walk on the wrap-around board (core/geom.js); the grid walk is unchanged by it.
export function warnsdorff(n, rnd, wrap = false) {
  const T = n * n, vis = new Uint8Array(T), order = [];
  const deg = (r, c) => {
    let k = 0;
    for (let d = 0; d < 4; d++) {
      const v = neighbourCell(n, wrap, r * n + c, d);
      if (v >= 0 && !vis[v]) k++;
    }
    return k;
  };
  let r = Math.floor(rnd() * n), c = Math.floor(rnd() * n);
  vis[r * n + c] = 1; order.push(r * n + c);
  for (let step = 1; step < T; step++) {
    const cands = [];
    for (let d = 0; d < 4; d++) {
      const v = neighbourCell(n, wrap, r * n + c, d);
      if (v >= 0 && !vis[v]) cands.push([(v / n) | 0, v % n, deg((v / n) | 0, v % n)]);
    }
    if (!cands.length) return null;
    cands.sort((a, b) => a[2] - b[2]);
    const best = cands.filter(x => x[2] === cands[0][2]);
    [r, c] = best[Math.floor(rnd() * best.length)];
    vis[r * n + c] = 1; order.push(r * n + c);
  }
  return order;
}

// Backbite: start from a serpentine path, apply random end-reversals. Never fails.
// wrap: on the wrap-around board the reversals may also use the seams (the serpentine is a
// path there too).
export function backbite(n, rnd, wrap = false) {
  const T = n * n, path = [];
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) path.push(r * n + (r % 2 ? n - 1 - k : k));
  const pos = new Int32Array(T); path.forEach((v, i) => pos[v] = i);
  // up, down, left, right (the order the grid version always had)
  const nbrs = i => [3, 2, 1, 0].map(d => neighbourCell(n, wrap, i, d)).filter(v => v >= 0);
  const rev = (a, b) => { while (a < b) { const t = path[a]; path[a] = path[b]; path[b] = t; pos[path[a]] = a; pos[path[b]] = b; a++; b--; } };
  for (let it = 0; it < T * 24; it++) {
    if (rnd() < 0.5) { const c = nbrs(path[T - 1]).filter(v => pos[v] < T - 2); if (c.length) rev(pos[c[(rnd() * c.length) | 0]] + 1, T - 1); }
    else { const c = nbrs(path[0]).filter(v => pos[v] > 1); if (c.length) rev(0, pos[c[(rnd() * c.length) | 0]] - 1); }
  }
  return path;
}
