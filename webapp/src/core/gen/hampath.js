const DR = [0, 0, 1, -1], DC = [1, -1, 0, 0];

// Randomised Warnsdorff walk (legacy generator; rnd consumption order is part of the seeded contract). Returns null on dead end.
export function warnsdorff(n, rnd) {
  const T = n * n, vis = new Uint8Array(T), order = [];
  const deg = (r, c) => { let k = 0; for (let d = 0; d < 4; d++) { const rr = r + DR[d], cc = c + DC[d]; if (rr >= 0 && rr < n && cc >= 0 && cc < n && !vis[rr * n + cc]) k++; } return k; };
  let r = Math.floor(rnd() * n), c = Math.floor(rnd() * n);
  vis[r * n + c] = 1; order.push(r * n + c);
  for (let step = 1; step < T; step++) {
    const cands = [];
    for (let d = 0; d < 4; d++) { const rr = r + DR[d], cc = c + DC[d]; if (rr >= 0 && rr < n && cc >= 0 && cc < n && !vis[rr * n + cc]) cands.push([rr, cc, deg(rr, cc)]); }
    if (!cands.length) return null;
    cands.sort((a, b) => a[2] - b[2]);
    const best = cands.filter(x => x[2] === cands[0][2]);
    [r, c] = best[Math.floor(rnd() * best.length)];
    vis[r * n + c] = 1; order.push(r * n + c);
  }
  return order;
}

// Backbite: start from a serpentine path, apply random end-reversals. Never fails.
export function backbite(n, rnd) {
  const T = n * n, path = [];
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) path.push(r * n + (r % 2 ? n - 1 - k : k));
  const pos = new Int32Array(T); path.forEach((v, i) => pos[v] = i);
  const nbrs = i => { const r = (i / n) | 0, c = i % n, o = []; if (r > 0) o.push(i - n); if (r < n - 1) o.push(i + n); if (c > 0) o.push(i - 1); if (c < n - 1) o.push(i + 1); return o; };
  const rev = (a, b) => { while (a < b) { const t = path[a]; path[a] = path[b]; path[b] = t; pos[path[a]] = a; pos[path[b]] = b; a++; b--; } };
  for (let it = 0; it < T * 24; it++) {
    if (rnd() < 0.5) { const c = nbrs(path[T - 1]).filter(v => pos[v] < T - 2); if (c.length) rev(pos[c[(rnd() * c.length) | 0]] + 1, T - 1); }
    else { const c = nbrs(path[0]).filter(v => pos[v] > 1); if (c.length) rev(0, pos[c[(rnd() * c.length) | 0]] - 1); }
  }
  return path;
}
