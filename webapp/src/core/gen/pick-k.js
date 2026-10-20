// How many checkpoints a puzzle gets, the same rule on every board (square, Pentagon, 3D).

// K ~ Normal(mean = Kmin + 0.3 * (Kmax - Kmin), sd = range / 6), sampled with Box-Muller and clamped
// to [Kmin, Kmax]. Favors small K. Always consumes exactly 2 rnd() values.
export function pickK(Kmin, Kmax, rnd) {
  const range = Kmax - Kmin;
  const u = 1 - rnd();
  const v = rnd();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  const k = Math.round(Kmin + 0.3 * range + (range / 6) * z);
  return Math.min(Kmax, Math.max(Kmin, k));
}

// The range of the number of checkpoints on a board with that many cells: from the square root of
// the cells (the side of a square board, at least 4) to a quarter of the cells. [min, max].
export function kRange(cells) {
  const min = Math.max(4, Math.round(Math.sqrt(cells)));
  return [min, Math.max(min + 1, Math.round(cells / 4))];
}
