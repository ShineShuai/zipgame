import { maxNumber } from '../core/model.js';
import { isSurfacePuzzle } from '../core/surface/puzzle.js';
import { bridgeCells } from '../core/twopaths.js';
import { PLAYED_SURFACES, modelOf } from './model.js';

// Patchworking: the lines a player draws are a set of edges between neighbouring cells, in any
// order and from anywhere (the pen may be lifted). Pure: no DOM, no storage.
//
// The rules are those of a single-player game, applied to the drawn edges E instead of to a path
// that grows from cell 1:
//   blocked  the cells are not neighbours, or a wall, a hole or the border is between them
//   degree   a cell gets more than 2 lines (cell 1 and the last number: more than 1)
//   cycle    the line would close a loop
//   order    the numbers on the connected piece (a "fragment") would not rise or fall steadily
//   gap      the piece would hold two numbers but not all the numbers between them
//   steps    Exact puzzle, instead of order and gap: a number is the step of its cell, so along a
//            piece the numbers must differ by exactly the cells between them, and the piece must
//            fit between step 1 and the last step
//   direction  One way arrows puzzle: the arrows, the numbers and the two ends (cell 1 first, the
//            last number last) must allow at least one way along the piece
//   colours  Two paths puzzle: a piece would hold a red number and a blue one
// Loop puzzle: the drawing is a ring, so no cell is an end (every cell holds up to 2 lines), the
// numbers of a piece are consecutive round the ring (K is followed by 1), and the one line that
// may close a loop is the last of a piece that covers the board. Two paths puzzle: the numbers 1,
// k, k + 1 and K begin or end a path (1 line at most), and a piece holds the numbers of one colour
// (red 1..k, blue k + 1..K).
// A Cutout puzzle (holes) needs no rule of its own: canStep() already refuses a hole.
// Under these rules a drawing is solved exactly when it has cells - 1 edges: it is then one path
// that covers the board, holds every number in order and has cell 1 and the last number as its
// ends (a Loop puzzle: cells edges, one ring; Two paths: cells - 2 edges, two paths). solved()
// still hands the path to isSolved(), the rule of the single-player game.

export const REASONS = [
  'blocked', 'present', 'degree', 'cycle', 'order', 'gap', 'steps', 'direction', 'colours',
];

// null when Patchwork can play `puzzle`, else a message: every flat puzzle, and the surface kinds
// of model.js PLAYED_SURFACES. Wrap-around and Teleport need no rule of their own: an edge across
// a seam or between two portals is an edge like any other, and canStep() knows them.
export function unsupported(puzzle) {
  if (isSurfacePuzzle(puzzle)) {
    return PLAYED_SURFACES.includes(puzzle.kind)
      ? null : `Patchwork does not play ${puzzle.kind} puzzles (yet).`;
  }
  return null;
}

// The numbers of one fragment, in order along it: null when fine, else 'order' or 'gap'.
function numberProblem(numbers) {
  if (numbers.length < 2) {
    return null;
  }
  const rising = numbers.every((value, i) => i === 0 || value > numbers[i - 1]);
  const falling = numbers.every((value, i) => i === 0 || value < numbers[i - 1]);
  if (!rising && !falling) {
    return 'order';
  }
  const span = Math.abs(numbers[numbers.length - 1] - numbers[0]) + 1;
  return span === numbers.length ? null : 'gap';
}

// Loop puzzle: the numbers 1..K of a piece, in order along it, must be consecutive round the ring,
// one way or the other (K is followed by 1). null when fine, else 'gap' (a number is skipped).
function ringProblem(numbers, count) {
  if (numbers.length < 2) {
    return null;
  }
  const step = (from, to) => (to - from + count) % count;
  const up = numbers.every((value, i) => i === 0 || step(numbers[i - 1], value) === 1);
  const down = numbers.every((value, i) => i === 0 || step(value, numbers[i - 1]) === 1);
  return up || down ? null : 'gap';
}

// Two paths puzzle: the numbers of a piece must be those of one colour (red 1..k, blue above k),
// and rise or fall steadily like any piece's. null when fine, else 'colours', 'order' or 'gap'.
function coloursProblem(numbers, split) {
  const reds = numbers.filter(value => value <= split).length;
  return reds > 0 && reds < numbers.length ? 'colours' : numberProblem(numbers);
}

// Exact puzzle: `numbers` are the numbers of the cells of one piece, in order along it (0: none).
// The piece is the steps first .. first + (length - 1) of the path, one way or the other, so the
// number of each cell must be that step. null when it can be, else 'steps'.
function stepsProblem(numbers, total) {
  const marked = numbers.map((value, index) => [index, value]).filter(([, value]) => value);
  if (marked.length === 0) {
    return null;
  }
  const [index0, value0] = marked[0];
  const last = numbers.length - 1;
  const fits = sign => {
    const first = value0 - sign * index0;
    const end = first + sign * last;
    return first >= 1 && first <= total && end >= 1 && end <= total
      && marked.every(([index, value]) => value === first + sign * index);
  };
  return fits(1) || fits(-1) ? null : 'steps';
}

export function createDrawing(puzzle) {
  const model = modelOf(puzzle);
  const { total, start, end, ends } = model;
  const count = maxNumber(puzzle);
  const links = Array.from({ length: total }, () => []);
  const stamps = new Map(); // edge key -> the order in which the edges were drawn
  const owners = new Map(); // edge key -> the player (0, 1) who drew it
  let counter = 0;

  const key = (a, b) => (a < b ? a * total + b : b * total + a);
  const capacity = cell => (ends.has(cell) ? 1 : 2);
  // A line has no direction here, so a one-way edge is open when it may be walked either way.
  const open = (a, b) => model.canStep(a, b) || model.canStep(b, a);
  // May a line run between these two cells at all, walls and arrows aside: do they touch (across a
  // seam too), or are they the two ends of a portal pair?
  const linked = model.linked;

  // One way arrows: may the cells of a piece, in order along it, be walked first to last, or last
  // to first? Every step must be allowed in that direction, the numbers must rise that way, cell 1
  // must come first and the last number last. null when at least one way is possible.
  function directionProblem(cells) {
    const first = cells[0];
    const last = cells[cells.length - 1];
    let forward = true;
    let backward = true;
    for (let i = 1; i < cells.length; i++) {
      forward = forward && model.canStep(cells[i - 1], cells[i]);
      backward = backward && model.canStep(cells[i], cells[i - 1]);
    }
    const numbers = numbersOf(cells);
    if (numbers.length > 1) {
      forward = forward && numbers[1] > numbers[0];
      backward = backward && numbers[1] < numbers[0];
    }
    if (cells.includes(start)) {
      forward = forward && first === start;
      backward = backward && last === start;
    }
    if (cells.includes(end)) {
      forward = forward && last === end;
      backward = backward && first === end;
    }
    return forward || backward ? null : 'direction';
  }
  const has = (a, b) => stamps.has(key(a, b));

  // The cells met when walking from `from` through its neighbour `via`, to the end of the piece.
  function walk(from, via) {
    const cells = [];
    let previous = from;
    let current = via;
    while (current !== undefined && current !== from) {
      cells.push(current);
      const next = links[current].find(cell => cell !== previous);
      previous = current;
      current = next;
    }
    return cells;
  }

  // The piece (fragment) of drawn lines through `cell`, in order along it; [cell] if it has none.
  function fragmentOf(cell) {
    const [first, second] = links[cell];
    if (first === undefined) {
      return [cell];
    }
    const ahead = walk(cell, first);
    const behind = second === undefined ? [] : walk(cell, second);
    return [...behind.reverse(), cell, ...ahead];
  }

  const numbersOf = cells => cells.map(cell => puzzle.cp[cell]).filter(Boolean);

  // The numbers of a piece against the rules of its type: null, or the reason.
  function numbersProblem(piece) {
    if (puzzle.exact) {
      return stepsProblem(piece.map(cell => puzzle.cp[cell] || 0), model.cells);
    }
    const numbers = numbersOf(piece);
    if (puzzle.loop) {
      return ringProblem(numbers, count);
    }
    return puzzle.split ? coloursProblem(numbers, puzzle.split) : numberProblem(numbers);
  }

  // null when the edge a-b may be drawn now, else the reason (see REASONS).
  function check(a, b) {
    if (a === b || !open(a, b)) {
      return 'blocked';
    }
    if (has(a, b)) {
      return 'present';
    }
    if (links[a].length >= capacity(a) || links[b].length >= capacity(b)) {
      return 'degree';
    }
    if (links[a].length > 0 && links[b].length > 0 && fragmentOf(a).includes(b)) {
      // a Loop ring is closed by the line between the two ends of a piece that covers the board
      return puzzle.loop && fragmentOf(a).length === model.cells ? null : 'cycle';
    }
    links[a].push(b);
    links[b].push(a);
    const piece = fragmentOf(a);
    const problem = numbersProblem(piece);
    const wrongWay = !problem && puzzle.arrows ? directionProblem(piece) : null;
    links[a].pop();
    links[b].pop();
    return problem ?? wrongWay;
  }

  // Draws the edge a-b for `owner` when the rules allow it: null, else the reason it was refused.
  // Who drew a line makes no difference to the rules; it only gives the line its colour.
  function add(a, b, owner = 0) {
    const reason = check(a, b);
    if (reason) {
      return reason;
    }
    links[a].push(b);
    links[b].push(a);
    stamps.set(key(a, b), counter++);
    owners.set(key(a, b), owner);
    return null;
  }

  // Erases the edge a-b: true when it was there.
  function remove(a, b) {
    if (!has(a, b)) {
      return false;
    }
    links[a] = links[a].filter(cell => cell !== b);
    links[b] = links[b].filter(cell => cell !== a);
    stamps.delete(key(a, b));
    owners.delete(key(a, b));
    return true;
  }

  function clear() {
    links.forEach((list, cell) => {
      links[cell] = [];
    });
    stamps.clear();
    owners.clear();
  }

  // The drawn edges [a, b] (a < b), in the order they were drawn.
  function edges() {
    return [...stamps]
      .sort((x, y) => x[1] - y[1])
      .map(([id]) => [Math.floor(id / total), id % total]);
  }

  // The paths the lines make, as the rule of the single-player game wants them (isSolved): a path
  // from cell 1 along the lines (cell 1 only, when none leaves it). A ring has two ways round, so
  // two candidates; Two paths: the red path followed by the blue one, which starts on number k + 1.
  function candidates() {
    if (puzzle.loop) {
      const ways = links[start].map(via => [start, ...walk(start, via)]);
      return ways.length ? ways : [[start]];
    }
    if (puzzle.split) {
      return [[...fragmentOf(start), ...fragmentOf(bridgeCells(puzzle)[1])]];
    }
    return [fragmentOf(start)];
  }

  const path = () => candidates()[0];

  function solved() {
    const wanted = model.cells - (puzzle.loop ? 0 : puzzle.split ? 2 : 1);
    const bridge = puzzle.split ? fragmentOf(start).length : -1; // where the blue path begins
    return stamps.size === wanted && candidates().some(along => (
      along.every((cell, i) => i === 0 || i === bridge || model.canStep(along[i - 1], cell))
      && model.solved(along)
    ));
  }

  return {
    puzzle,
    key,
    has,
    linked,
    check,
    add,
    remove,
    clear,
    edges,
    fragmentOf,
    path,
    solved,
    ownerOf: (a, b) => owners.get(key(a, b)) ?? 0,
    degree: cell => links[cell].length,
    count: () => stamps.size,
  };
}
