// Helpers that more than one unit test file uses: a fake storage and clock, random puzzles, a sample of
// unique puzzles (made once per process).
import { makePuzzle } from '../../src/core/model.js';
import { allEdges, setWallId } from '../../src/core/edges.js';
import { makeRng, shuffle } from '../../src/core/rng.js';
import { generateUnique } from '../../src/core/gen/generate.js';
import { runSync } from '../../src/core/run.js';
import { ok } from '../harness.js';

export const randPuzzle = (seed, n, K, wallFrac) => {
  const rnd = makeRng(seed), p = makePuzzle(n), T = n * n, cells = shuffle([...Array(T).keys()], rnd).slice(0, K);
  cells.forEach((c, i) => { p.cp[c] = i + 1; });
  allEdges(n).forEach(e => { if (rnd() < wallFrac) setWallId(p.walls, e, true); });
  return p;
};
export function sampleUniquePuzzles() {
  const cases = [[7, 6, 11], [9, 8, 22], [11, 10, 33]]; // [n, K, seed]
  const out = [];
  for (const [n, K, seed] of cases) {
    const r = runSync(generateUnique(n, K, makeRng(seed), { tries: 20 }));
    if (r.unique) out.push(r.puzzle);
  }
  ok(out.length > 0, 'expected at least one unique sample puzzle to test against');
  return out;
}

let sampleCache = null; export const cachedSamples = () => sampleCache ??= sampleUniquePuzzles(); // generate once, share across tests

export const fakeStorage = (quota = Infinity) => { const m = new Map(), size = () => [...m].reduce((a, [k, v]) => a + k.length + v.length, 0); return { data: m, async get(k) { return m.has(k) ? { value: m.get(k) } : null; }, async set(k, v) { const old = m.has(k) ? k.length + m.get(k).length : 0; if (size() - old + k.length + v.length > quota) return false; m.set(k, v); return true; }, async remove(k) { m.delete(k); }, async keys(p = '') { return [...m.keys()].filter(k => k.startsWith(p)); } }; };
export const atDay = d => () => new Date(Date.UTC(2026, 8, d, 12));
