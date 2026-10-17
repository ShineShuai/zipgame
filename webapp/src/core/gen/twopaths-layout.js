import { backbite } from './hampath.js';
import { gapCheckpoints, randomCheckpoints } from './checkpoints.js';
import { gridDist } from '../geom.js';

// The board layout of a Two paths puzzle (see gen/twopaths.js): a Hamiltonian path cut in two, each
// piece turned at random, numbers along each piece. Pure; no import of generate.js, which uses it.

// Where the cut may fall, as a share of the cells the red piece gets.
export const CUT_SHARE = [0.35, 0.65];
// How often the cut (and the turns) are drawn again when the ends keep touching, before giving up.
const LAYOUT_TRIES = 20;

// How many of the K numbers the red path takes: its share of the cells, at least 2 for each colour.
export const redNumbers = (K, redCells, cells) => Math.max(2, Math.min(K - 2, Math.round((K * redCells) / cells)));

// The board's cells as { path, positions, split }: path = the red piece followed by the blue one,
// each turned at random; positions = the K path positions of the numbers 1..K (the red ones first);
// split = how many numbers are red. null when no layout was found (the caller tries again).
// cps: 'gap' (default; numbers spread along each piece, gapCheckpoints) or 'random'.
export function twoPathsLayout(n, K, rnd, cps = 'gap') {
  const cells = n * n;
  if (K < 4) return null;
  for (let attempt = 0; attempt < LAYOUT_TRIES; attempt++) {
    const base = backbite(n, rnd);
    const [lo, hi] = CUT_SHARE;
    const cut = Math.max(2, Math.min(cells - 2, Math.round(cells * (lo + (hi - lo) * rnd()))));
    const first = base.slice(0, cut);
    const second = base.slice(cut);
    // the turns that leave the bridge cells apart: [turn red, turn blue]
    const turns = [[false, false], [true, false], [false, true], [true, true]].filter(([a, b]) => {
      const redEnd = a ? first[0] : first[cut - 1];
      const blueStart = b ? second[second.length - 1] : second[0];
      return gridDist(n, false, redEnd, blueStart) > 1;
    });
    if (!turns.length) continue;
    const [turnRed, turnBlue] = turns[Math.floor(rnd() * turns.length)];
    const red = turnRed ? first.slice().reverse() : first;
    const blue = turnBlue ? second.slice().reverse() : second;
    const split = redNumbers(K, red.length, cells);
    const place = (piece, count) => (cps === 'random' ? randomCheckpoints(piece.length, count, rnd)
      : gapCheckpoints(n, piece, count));
    const redPositions = place(red, split);
    const bluePositions = place(blue, K - split);
    if (!redPositions || !bluePositions) continue;
    return {
      path: [...red, ...blue],
      positions: [...redPositions, ...bluePositions.map(q => q + red.length)],
      split,
    };
  }
  return null;
}
