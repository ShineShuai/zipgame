import { neighbourCell, portalPartner } from '../geom.js';

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

// A random Hamiltonian cycle of the n x n grid (n even; a Loop puzzle's ring), as the list of its
// cells: the last cell touches the first. Backbite moves from a fixed cycle (the first column is
// the way back of a snake over the others), and the first state after enough moves in which the
// two ends touch is the ring. When that does not happen within the move budget (it always has so
// far), the fixed cycle is the answer, so it never fails.
export const RING_MOVES_PER_CELL = 24;
export const RING_EXTRA_MOVES_PER_CELL = 400;
export function ringPath(n, rnd) {
  if (n % 2) throw new Error('A ring needs an even board');
  const T = n * n;
  const path = [0];
  for (let r = 0; r < n; r++) {
    for (let k = 1; k < n; k++) path.push(r * n + (r % 2 ? n - k : k));
  }
  for (let r = n - 1; r >= 1; r--) path.push(r * n);
  const base = path.slice();
  const pos = new Int32Array(T);
  path.forEach((cell, i) => {
    pos[cell] = i;
  });
  const reverse = (from, to) => {
    for (let a = from, b = to; a < b; a++, b--) {
      const cell = path[a];
      path[a] = path[b];
      path[b] = cell;
      pos[path[a]] = a;
      pos[path[b]] = b;
    }
  };
  const neighbours = cell => [3, 2, 1, 0].map(d => neighbourCell(n, false, cell, d)).filter(v => v >= 0);
  const closed = () => neighbours(path[0]).includes(path[T - 1]);
  const moves = T * RING_MOVES_PER_CELL;
  for (let move = 0; move < moves + T * RING_EXTRA_MOVES_PER_CELL; move++) {
    if (move >= moves && closed()) return path;
    if (rnd() < 0.5) {
      const options = neighbours(path[T - 1]).filter(v => pos[v] < T - 2);
      if (options.length) reverse(pos[options[(rnd() * options.length) | 0]] + 1, T - 1);
    } else {
      const options = neighbours(path[0]).filter(v => pos[v] > 1);
      if (options.length) reverse(0, pos[options[(rnd() * options.length) | 0]] - 1);
    }
  }
  return base;
}

// Backbite on the grid plus portal edges (a Teleport board, core/geom.js): the same end reversals
// as
// backbite(), with two changes that make a path through every portal likely instead of a third of
// all
// paths per pair: a path end may also join the cell its portal links it to, and takes that edge
// half of the
// time it can; and a reversal that would remove a portal edge from the path is not made, so a
// portal that is
// in stays in. Starts from the serpentine, which uses no portal. The caller still checks the
// result
// (gen/teleport.js teleportPath). Never fails. Its own function, so that backbite() above keeps
// its random
// stream: the seeded generators of the other variants depend on it.
export const PORTAL_TAKE = 0.5;
export function backbitePortals(n, rnd, portals) {
  const T = n * n, path = [];
  for (let r = 0; r < n; r++) {
    for (let k = 0; k < n; k++) path.push(r * n + (r % 2 ? n - 1 - k : k));
  }
  const pos = new Int32Array(T);
  path.forEach((v, i) => { pos[v] = i; });
  // up, down, left, right
  const nbrs = i => [3, 2, 1, 0].map(d => neighbourCell(n, false, i, d)).filter(v => v >= 0);
  const portal = (a, b) => portalPartner(portals, a) === b;
  const rev = (a, b) => {
    for (; a < b; a++, b--) {
      [path[a], path[b]] = [path[b], path[a]];
      pos[path[a]] = a;
      pos[path[b]] = b;
    }
  };
  // the cell to join: the end's portal partner when allowed (half the time), else a random one of
  // `c`
  const pick = (end, c, partner) => {
    if (partner >= 0 && c.includes(partner) && rnd() < PORTAL_TAKE) return partner;
    return c[(rnd() * c.length) | 0];
  };
  for (let it = 0; it < T * 24; it++) {
    if (rnd() < 0.5) {
      // tail joins v: the edge v - next(v) leaves the path
      const tail = path[T - 1];
      const partner = portalPartner(portals, tail);
      const c = nbrs(tail).concat(partner >= 0 ? [partner] : [])
        .filter(v => pos[v] < T - 2 && !portal(v, path[pos[v] + 1]));
      if (c.length) rev(pos[pick(tail, c, partner)] + 1, T - 1);
    } else {
      // head joins v: the edge prev(v) - v leaves the path
      const head = path[0];
      const partner = portalPartner(portals, head);
      const c = nbrs(head).concat(partner >= 0 ? [partner] : [])
        .filter(v => pos[v] > 1 && !portal(v, path[pos[v] - 1]));
      if (c.length) rev(0, pos[pick(head, c, partner)] - 1);
    }
  }
  return path;
}
