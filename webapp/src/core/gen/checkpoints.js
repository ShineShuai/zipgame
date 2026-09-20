import { hasWall } from '../edges.js';
import { shuffle } from '../rng.js';

// Choose K path positions (sorted; includes first and last) so consecutive checkpoints sit ~targetGap apart in grid distance.
// Deterministic (no rnd). Returns null if no feasible placement.
export function gapCheckpoints(n, path, K) {
  const man = (a, b) => Math.abs(((a / n) | 0) - ((b / n) | 0)) + Math.abs(a % n - b % n);
  const target = 0.65 * (path.length - 1) / (K - 1);
  const idx = [0, path.length - 1], chosen = new Set(idx);
  while (idx.length < K) {
    let bestP = -1, bestS = Infinity, bestAt = -1;
    for (let p = 0; p < path.length; p++) {
      if (chosen.has(p)) continue;
      let lo = 0; while (lo < idx.length && idx[lo] < p) lo++;
      const pr = idx[lo - 1], sc = idx[lo], mp = man(path[pr], path[p]), ms = man(path[p], path[sc]);
      if (mp > p - pr || ms > sc - p) continue;
      const s = (mp - target) ** 2 + (ms - target) ** 2;
      if (s < bestS) { bestS = s; bestP = p; bestAt = lo; }
    }
    if (bestP < 0) return null;
    idx.splice(bestAt, 0, bestP); chosen.add(bestP);
  }
  return idx;
}

// K path positions chosen uniformly at random (plus both ends).
export function randomCheckpoints(len, K, rnd) {
  const mid = []; for (let i = 1; i < len - 1; i++) mid.push(i);
  return [0, ...shuffle(mid, rnd).slice(0, K - 2).sort((a, b) => a - b), len - 1];
}

// Scatter K random checkpoints, ordered by nearest-next (wall-aware BFS distance). Returns a new cp array.
export function scatter(p, K, rnd) {
  const n = p.n, T = n * n;
  K = Math.max(2, Math.min(K, T));
  const bfs = (src, dst) => {
    if (src === dst) return 0;
    const seen = new Uint8Array(T); let fr = [src], d = 0; seen[src] = 1;
    while (fr.length) {
      d++; const nx = [];
      for (const u of fr) for (const v of [u - n, u + n, u - 1, u + 1]) {
        if (v < 0 || v >= T || seen[v]) continue;
        if (Math.abs(v - u) === 1 && ((v / n) | 0) !== ((u / n) | 0)) continue;
        if (hasWall(p, u, v)) continue;
        if (v === dst) return d; seen[v] = 1; nx.push(v);
      }
      fr = nx;
    }
    return Infinity;
  };
  const cells = shuffle([...Array(T).keys()], rnd).slice(0, K), rest = cells.slice(1), order = [cells[0]];
  let cur = cells[0];
  while (rest.length) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < rest.length; i++) { const d = bfs(cur, rest[i]); if (d < bd) { bd = d; bi = i; } }
    cur = rest[bi]; order.push(cur); rest.splice(bi, 1);
  }
  const cp = new Uint16Array(T); order.forEach((c, i) => { cp[c] = i + 1; });
  return cp;
}
