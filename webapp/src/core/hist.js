// Game-of-Day time histogram: constants and pure math. Backends only store counts; all interpretation lives here.
// Bin k covers [T0_MS * RATIO^k, T0_MS * RATIO^(k+1)) ms; k is clamped to 0..NB-1 (1 s .. ~2048 s, ~10 % wide).
export const NB = 80, T0_MS = 1000, RATIO = 1.1, TOP_K = 10, MIN_MS = 500, MAX_MS = 3600000;
export const binOf = ms => (ms > T0_MS ? Math.min(NB - 1, Math.floor(Math.log(ms / T0_MS) / Math.log(RATIO))) : 0);

const isCount = x => Number.isInteger(x) && x >= 0;

// r = backend reply { n: players, sum: total ms, below: players in faster bins, cnt: players in my bin (incl. me), best: fastest <= TOP_K ms }.
// Returns { n, mean (s), top (s | null), pct (0..100 | null) } or null when r is malformed.
//   mean = sum / n                                   (exact)
//   top  = mean of the TOP_K fastest, only when n > TOP_K (else it equals the overall mean)
//   pct  = share of the OTHER players I beat: slower bins count fully, my own bin counts half.
export function summarize(r) {
  if (!r || !Number.isInteger(r.n) || r.n < 1 || !isCount(r.sum) || !isCount(r.below) || !Number.isInteger(r.cnt) || r.cnt < 1 ||
      r.below + r.cnt > r.n || !Array.isArray(r.best) || r.best.length > TOP_K || !r.best.every(isCount)) return null;
  const top = r.n > TOP_K && r.best.length === TOP_K ? r.best.reduce((a, b) => a + b, 0) / TOP_K / 1000 : null;
  const pct = r.n > 1 ? Math.round(100 * ((r.n - r.below - r.cnt) + (r.cnt - 1) / 2) / (r.n - 1)) : null;
  return { n: r.n, mean: r.sum / r.n / 1000, top, pct };
}

// detail = true (hold "v") also shows the player count.
export function statsLine(s, detail = false) {
  const sec = x => x.toFixed(1) + 's';
  const parts = [`Everyone: ${sec(s.mean)} avg${detail ? ` (${s.n} player${s.n === 1 ? '' : 's'})` : ''}`];
  if (s.top != null) parts.push(`Top ${TOP_K}: ${sec(s.top)} avg`);
  if (s.pct != null) parts.push(`You beat ${s.pct}%`);
  return parts.join(' · ');
}
