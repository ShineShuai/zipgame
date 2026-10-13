import { canStep } from '../core/rules.js';

// What an Exact puzzle's player can count, and the game says so (Assist). Everything here is a
// necessary condition: when it says the line cannot be completed, no completion exists; when it
// says nothing, the line may still be a dead end (the checks do not see dead ends or split
// regions, only the numbers and the steps).

// The numbers that are already wrong on this path: Map(cell -> 'wrong' | 'missed').
//   wrong   the cell is on the path, but not at the step its number says
//   missed  the cell is not on the path, and the step of its number has passed
// Always on for an Exact puzzle (it is the number's own step, no look ahead).
export function numberStates(p, path) {
  const states = new Map();
  if (!p.exact) return states;
  const at = new Map();
  path.forEach((cell, i) => at.set(cell, i));
  for (let cell = 0; cell < p.cp.length; cell++) {
    const number = p.cp[cell];
    if (!number) continue;
    if (at.has(cell)) {
      if (at.get(cell) !== number - 1) states.set(cell, 'wrong');
    } else if (number <= path.length) {
      states.set(cell, 'missed');
    }
  }
  return states;
}

const neighbours = (n, cell) => {
  const row = (cell / n) | 0;
  const col = cell % n;
  const out = [];
  if (row > 0) out.push(cell - n);
  if (row < n - 1) out.push(cell + n);
  if (col > 0) out.push(cell - 1);
  if (col < n - 1) out.push(cell + 1);
  return out;
};

// Steps from the head of the path to `target` through the cells the path has not used, null when
// there is no way. Other numbered cells are closed: before the next number none can be entered
// (a number is entered on its own step, and every other one comes after this one).
export function routeLength(p, path, target) {
  const head = path[path.length - 1];
  const used = new Uint8Array(p.n * p.n);
  for (const cell of path) used[cell] = 1;
  const dist = new Int32Array(p.n * p.n).fill(-1);
  dist[head] = 0;
  const queue = [head];
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i];
    if (cell === target) return dist[cell];
    for (const next of neighbours(p.n, cell)) {
      if (dist[next] >= 0 || !canStep(p, cell, next)) continue;
      if (next !== target && (used[next] || p.cp[next])) continue;
      dist[next] = dist[cell] + 1;
      queue.push(next);
    }
  }
  return null;
}

// The state of the line, for the Assist readout:
//   { status: 'idle' }
//       nothing to say (no path yet, or every number is passed)
//   { status: 'ok', step, next, nextCell, steps, away, slack }
//       the head is on `step`; the next number `next` is `steps` steps ahead and `away` cells of
//       route (slack = steps - away >= 0 is the detour it may still take)
//   { status: 'doomed', step, next, nextCell, steps, away, slack }
//       the same, but away > steps, or away and slack null (cut off): it cannot be reached in time
//   { status: 'missed', step, missed, cell }
//       a number is wrong or missed (the smallest one, and its cell)
export function assistState(p, path) {
  const step = path.length;
  if (!p.exact || step === 0) return { status: 'idle' };
  const states = numberStates(p, path);
  if (states.size) {
    let cell = -1;
    for (const bad of states.keys()) {
      if (cell < 0 || p.cp[bad] < p.cp[cell]) cell = bad;
    }
    return { status: 'missed', step, missed: p.cp[cell], cell };
  }
  let nextCell = -1;
  for (let cell = 0; cell < p.cp.length; cell++) {
    const number = p.cp[cell];
    if (number > step && (nextCell < 0 || number < p.cp[nextCell])) nextCell = cell;
  }
  if (nextCell < 0) return { status: 'idle', step };
  const next = p.cp[nextCell];
  const steps = next - step;
  const away = routeLength(p, path, nextCell);
  const slack = away === null ? null : steps - away;
  const status = slack === null || slack < 0 ? 'doomed' : 'ok';
  return { status, step, next, nextCell, steps, away, slack };
}
