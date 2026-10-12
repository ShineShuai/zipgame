import { serialize, parse } from '../core/format.js';
import { validate } from '../core/model.js';

// The standard local puzzle of each size that was made last, kept in storage under its seed. "Play local" opens the current game of a size again
// after a reload or a trip to the menu, and the Play app's generator (core/gen/play.js) takes seconds at the larger sizes: without this each of
// those would search again. The seed (core/rng.js dailySeed: day, size, game index, ALGO_VERSION) is the key, so a new day, a new game or a new
// ALGO_VERSION never finds an old puzzle, and a puzzle is kept for the one game it was made for. The solution path is stored with it.
// Anything unreadable (corrupt value, another size, a puzzle that does not validate) is a miss; storage failures never throw.
export const PUZZLE_CACHE_PREFIX = 'zip_pz_';

export function createPuzzleCache(storage) {
  const key = n => PUZZLE_CACHE_PREFIX + n;
  return {
    async get(n, seed) {
      try {
        const r = await storage.get(key(n));
        const v = r && JSON.parse(r.value);
        if (!v || v.seed !== seed || typeof v.text !== 'string') return null;
        const p = parse(v.text);
        if (p.n !== n || p.holes || p.arrows || !validate(p).ok) return null;
        p.seed = seed;
        return p;
      } catch { return null; }
    },
    async set(n, seed, puzzle) {
      try { await storage.set(key(n), JSON.stringify({ seed, text: serialize(puzzle, { path: puzzle.path }) })); } catch { /* ignore */ }
    },
  };
}
