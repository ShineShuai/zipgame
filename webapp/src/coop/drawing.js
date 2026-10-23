import { canStep, isSolved } from '../core/rules.js';
import { cellCount, endCell, startCell } from '../core/model.js';
import { isPentagon } from '../core/pentagon.js';

// Free drawing: the lines a player draws are a set of edges between neighbouring cells, in any
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
// A Cutout puzzle (holes) needs no rule of its own: canStep() already refuses a hole.
// Under these rules a drawing is solved exactly when it has cells - 1 edges: it is then one path
// that covers the board, holds every number in order and has cell 1 and the last number as its
// ends. solved() still hands the path to isSolved(), the rule of the single-player game.

export const REASONS = ['blocked', 'present', 'degree', 'cycle', 'order', 'gap', 'steps'];

// null when Free draw can play `puzzle`, else a message. Standard, Cutout and Exact puzzles so far
// (variants.js): the board drawing and the rules above know no arrows, portals, wrap-around,
// loops, two paths or pentagons.
export function unsupported(puzzle) {
  if (isPentagon(puzzle)) {
    return 'Free draw does not play Pentagon puzzles (yet).';
  }
  const extra = ['arrows', 'wrap', 'loop', 'split', 'portals'];
  const found = extra.find(name => puzzle[name]);
  return found ? `Free draw does not play ${found} puzzles (yet).` : null;
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
  const total = puzzle.n * puzzle.n;
  const start = startCell(puzzle);
  const end = endCell(puzzle);
  const links = Array.from({ length: total }, () => []);
  const stamps = new Map(); // edge key -> the order in which the edges were drawn
  const owners = new Map(); // edge key -> the player (0, 1) who drew it
  let counter = 0;

  const key = (a, b) => (a < b ? a * total + b : b * total + a);
  const capacity = cell => (cell === start || cell === end ? 1 : 2);
  const has = (a, b) => stamps.has(key(a, b));

  // The cells met when walking from `from` through its neighbour `via`, to the end of the piece.
  function walk(from, via) {
    const cells = [];
    let previous = from;
    let current = via;
    while (current !== undefined) {
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

  // null when the edge a-b may be drawn now, else the reason (see REASONS).
  function check(a, b) {
    if (a === b || !canStep(puzzle, a, b)) {
      return 'blocked';
    }
    if (has(a, b)) {
      return 'present';
    }
    if (links[a].length >= capacity(a) || links[b].length >= capacity(b)) {
      return 'degree';
    }
    if (links[a].length > 0 && links[b].length > 0 && fragmentOf(a).includes(b)) {
      return 'cycle';
    }
    links[a].push(b);
    links[b].push(a);
    const piece = fragmentOf(a);
    const problem = puzzle.exact
      ? stepsProblem(piece.map(cell => puzzle.cp[cell] || 0), cellCount(puzzle))
      : numberProblem(numbersOf(piece));
    links[a].pop();
    links[b].pop();
    return problem;
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

  // The path from cell 1 along the drawn lines (cell 1 only, when none leaves it).
  const path = () => fragmentOf(start);

  function solved() {
    return stamps.size === cellCount(puzzle) - 1 && isSolved(puzzle, path());
  }

  return {
    puzzle,
    key,
    has,
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
