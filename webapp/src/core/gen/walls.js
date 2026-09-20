import { solve } from '../solver/solve.js';
import { allEdges, hasWallId, setWallId, pathEdgeIds } from '../edges.js';
import { shuffle } from '../rng.js';

// Generators (function*) so callers can drive them synchronously (tests) or time-sliced (UI). Yielded values are progress events.

// Add walls to p (checkpoints set, no walls) until it has exactly one solution. `path` is the anchor solution: none of its edges is ever walled.
// cfg: { nodeCap, wallBudget (null = all edges), seedFraction, K, prop (opt-in solver propagation) }. Returns wall insertion order (array of edge ids) or null.
export function* makeUnique(p, path, rnd, cfg) {
  const n = p.n, { nodeCap, seedFraction, K } = cfg, all = allEdges(n);
  const maxWalls = cfg.wallBudget == null ? all.length : cfg.wallBudget;
  const anchor = new Uint8Array(n * n * 2); pathEdgeIds(n, path).forEach(e => { anchor[e] = 1; });
  const pool = shuffle(all.filter(e => !anchor[e]), rnd), order = [];
  const add = e => { setWallId(p.walls, e, true); order.push(e); };
  const S = (cap, capture) => solve(p, { limit: 2, nodeCap: cap, capture, prop: cfg.prop });
  let gwi = 0;
  const seedCount = seedFraction > 0 ? Math.min(Math.floor(pool.length * seedFraction), pool.length, maxWalls) : 0;
  for (let i = 0; i < seedCount; i++) add(pool[i]);
  gwi = seedCount;
  if (seedCount > 0) yield { frac: null, walls: order.length, K };
  const PROBE = Math.min(nodeCap, 4000);
  let probe = S(PROBE, false); // cheap probe: keep walling while even a small search budget is exceeded
  while (probe.exceeded && gwi < pool.length && order.length < maxWalls) { add(pool[gwi++]); probe = S(PROBE, false); yield { frac: null, walls: order.length, K }; }
  let res = S(nodeCap, true);
  while ((res.count > 1 || res.exceeded) && order.length < maxWalls) {
    if (res.count === 0) return null;
    let wall = null;
    if (res.exceeded) {
      while (gwi < pool.length && hasWallId(p.walls, pool[gwi])) gwi++;
      if (gwi < pool.length) wall = pool[gwi++];
    } else {
      const [A, B] = res.paths, eA = pathEdgeIds(n, A), eB = pathEdgeIds(n, B), inA = new Uint8Array(n * n * 2), inB = new Uint8Array(n * n * 2);
      eA.forEach(e => { inA[e] = 1; }); eB.forEach(e => { inB[e] = 1; });
      let diff = eA.filter(e => !inB[e] && !anchor[e]);
      if (!diff.length) diff = eB.filter(e => !inA[e] && !anchor[e]);
      if (diff.length) wall = diff[Math.floor(rnd() * diff.length)];
    }
    if (wall === null) return null;
    add(wall); res = S(nodeCap, true); yield { frac: null, walls: order.length, K };
  }
  return res.count !== 1 || res.exceeded ? null : order;
}

// Remove every wall (random order, once) whose removal keeps the solution unique. Mutates p.walls. Returns { removed, kept }.
export function* minimizeWalls(p, order, rnd, checkCap, K, prop) {
  const list = shuffle([...order], rnd); let kept = list.length;
  for (const w of list) {
    setWallId(p.walls, w, false);
    const c = solve(p, { limit: 2, nodeCap: checkCap, prop });
    if (c.count !== 1 || c.exceeded) setWallId(p.walls, w, true); else kept--;
    yield { frac: null, walls: kept, K };
  }
  return { removed: list.length - kept, kept };
}
