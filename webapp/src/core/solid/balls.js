// The ball boards the apps offer (the data is in ball-catalog.js, the graph in topology.js).
import { ballList, ballsLoaded, registerBalls } from './ball-registry.js';

export { ballsLoaded, registerBalls };

// The cells of the boards the play app draws from: any ball in this range that can be played.
export const PLAY_MIN_CELLS = 8;
export const PLAY_MAX_CELLS = 100;

let loading = null;

// Loads the catalog (a module of its own, imported on first use) and registers it. Every other
// function here, and surfaceTopology('ball', id), needs it loaded.
export function loadBalls() {
  if (ballsLoaded()) {
    return Promise.resolve();
  }
  if (!loading) {
    loading = import('./ball-catalog.js').then(({ BALL_CATALOG }) => registerBalls(BALL_CATALOG));
  }
  return loading;
}

export const ballCells = entry => entry.r.length;

// The balls that can be played with min <= cells <= max, in catalog order.
export const playableBalls = (min = PLAY_MIN_CELLS, max = PLAY_MAX_CELLS) =>
  ballList().filter(entry => entry.ok && ballCells(entry) >= min && ballCells(entry) <= max);

// A random playable ball; rnd() is a number in [0, 1).
export function pickBall(rnd, min = PLAY_MIN_CELLS, max = PLAY_MAX_CELLS) {
  const list = playableBalls(min, max);
  return list[Math.min(Math.floor(rnd() * list.length), list.length - 1)];
}

const SHAPES = [['triangle', 'triangles'], ['square', 'squares'], ['pentagon', 'pentagons']];

// '80 triangles + 12 pentagons', from [triangles, squares, pentagons].
export const compositionLabel = f =>
  f
    .map((count, i) => (count ? `${count} ${SHAPES[i][count === 1 ? 0 : 1]}` : null))
    .filter(Boolean)
    .join(' + ');

// The balls by composition, for a selector: [{ f, label, balls }], the compositions with the
// fewest cells first, balls with the fewest cells first. Boards that cannot be played are
// included (a selector shows them disabled, with their `why`).
export function ballsByComposition() {
  const groups = new Map();
  for (const entry of ballList()) {
    const key = entry.f.join(',');
    if (!groups.has(key)) {
      groups.set(key, { f: entry.f, label: compositionLabel(entry.f), balls: [] });
    }
    groups.get(key).balls.push(entry);
  }
  return [...groups.values()].sort((a, b) =>
    ballCells(a.balls[0]) - ballCells(b.balls[0]) || a.label.localeCompare(b.label));
}
