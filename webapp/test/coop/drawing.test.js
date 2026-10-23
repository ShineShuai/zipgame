import test from 'node:test';
import assert from 'node:assert/strict';
import { generateArrows } from '../../src/core/gen/arrows.js';
import { generateCutout, CUTOUT_MAX_MS } from '../../src/core/gen/cutout.js';
import { generateExact } from '../../src/core/gen/exact.js';
import { generate } from '../../src/core/gen/generate.js';
import { generatePentagon } from '../../src/core/gen/pentagon.js';
import { generateTeleport } from '../../src/core/gen/teleport.js';
import { runSync } from '../../src/core/run.js';
import { makeRng, shuffle } from '../../src/core/rng.js';
import { cellCount, makePuzzle } from '../../src/core/model.js';
import { SLOTS } from '../../src/core/surface/topology.js';
import { isSurfacePuzzle, makeSurfacePuzzle, topologyOf } from '../../src/core/surface/puzzle.js';
import { isSolved } from '../../src/core/rules.js';
import { solutionOf } from '../../src/features/hints.js';
import { neighbourCell } from '../../src/core/geom.js';
import { arrowDirId, edgeId, setArrowId } from '../../src/core/edges.js';
import { createDrawing, unsupported } from '../../src/coop/drawing.js';

// A 4x4 board with numbers 1 (cell 0), 2 (cell 5), 3 (cell 10), 4 (cell 15) and no walls.
function board() {
  const puzzle = makePuzzle(4);
  [0, 5, 10, 15].forEach((cell, i) => {
    puzzle.cp[cell] = i + 1;
  });
  return puzzle;
}

const solutionEdges = path => path.slice(1).map((cell, i) => [path[i], cell]);

test('refuses edges that are not open: not neighbours, a wall, the border', () => {
  const puzzle = board();
  puzzle.walls[1] |= 1; // wall between cell 1 and cell 2
  const drawing = createDrawing(puzzle);
  assert.equal(drawing.add(0, 5), 'blocked'); // diagonal
  assert.equal(drawing.add(1, 2), 'blocked'); // wall
  assert.equal(drawing.add(3, 4), 'blocked'); // end of a row, start of the next: not neighbours
  assert.equal(drawing.add(0, 0), 'blocked');
  assert.equal(drawing.add(0, 1), null);
  assert.equal(drawing.add(1, 0), 'present');
});

test('a cell holds 2 lines, cell 1 and the last number 1', () => {
  const drawing = createDrawing(board());
  assert.equal(drawing.add(1, 2), null);
  assert.equal(drawing.add(2, 3), null);
  assert.equal(drawing.add(2, 6), 'degree'); // 2 already has two lines
  assert.equal(drawing.add(0, 1), null); // cell 1 gets its only line
  assert.equal(drawing.add(0, 4), 'degree');
  assert.equal(drawing.add(14, 15), null);
  assert.equal(drawing.add(11, 15), 'degree'); // the last number has one line at most
});

test('refuses a line that closes a loop', () => {
  const drawing = createDrawing(board());
  assert.equal(drawing.add(1, 2), null);
  assert.equal(drawing.add(2, 6), null);
  assert.equal(drawing.add(6, 5), null);
  assert.equal(drawing.add(5, 1), 'cycle');
});

test('numbers on one piece must rise or fall steadily, without gaps', () => {
  const puzzle = board();
  const drawing = createDrawing(puzzle);
  // 2 (cell 5) - 6 - 10 (number 3): fine, 2 and 3 are next to each other
  assert.equal(drawing.add(5, 6), null);
  assert.equal(drawing.add(6, 10), null);
  // joining cell 15 (number 4) to the piece through 11, 14: 2, 3, 4 in order along it
  assert.equal(drawing.add(10, 11), null);
  assert.equal(drawing.add(11, 15), null);
  // cell 0 (number 1) joined to cell 5 would give 1, 2, 3, 4 in order: allowed
  assert.equal(drawing.add(0, 4), null);
  assert.equal(drawing.add(4, 5), null);
  assert.deepEqual(drawing.path().map(cell => puzzle.cp[cell]).filter(Boolean), [1, 2, 3, 4]);
});

test('refuses a piece with numbers out of order, or with a number skipped', () => {
  const puzzle = board();
  const order = createDrawing(puzzle);
  // 2 (cell 5) - 6 - 10 (number 3) - 9 - 8 - 4, then cell 0 (number 1) joined to 4: 1, 3, 2
  assert.equal(order.add(10, 6), null);
  assert.equal(order.add(6, 5), null);
  assert.equal(order.add(10, 9), null);
  assert.equal(order.add(9, 8), null);
  assert.equal(order.add(8, 4), null);
  assert.equal(order.add(4, 0), 'order'); // reading from cell 0: 1, 3, 2
  const gap = createDrawing(puzzle);
  // 1 (cell 0) - 1 - 2 - 3 - 7 - 11 - 15 (number 4): skips 2 and 3
  [[0, 1], [1, 2], [2, 3], [3, 7], [7, 11]].forEach(([a, b]) => assert.equal(gap.add(a, b), null));
  assert.equal(gap.add(11, 15), 'gap');
});

test('a descending piece is as good as an ascending one', () => {
  const puzzle = board();
  const drawing = createDrawing(puzzle);
  // 4 (cell 15) - 14 - 10 (number 3) - 6 - 5 (number 2): 4, 3, 2 read from cell 15
  [[15, 14], [14, 10], [10, 6], [6, 5]].forEach(([a, b]) => assert.equal(drawing.add(a, b), null));
  assert.equal(drawing.add(5, 1), null);
  assert.equal(drawing.add(1, 0), null); // 4, 3, 2, 1: falling, no gap
});

test('erasing a line frees its cells and splits the piece', () => {
  const drawing = createDrawing(board());
  drawing.add(1, 2);
  drawing.add(2, 3);
  assert.equal(drawing.remove(1, 2), true);
  assert.equal(drawing.remove(1, 2), false);
  assert.equal(drawing.degree(2), 1);
  assert.deepEqual(drawing.fragmentOf(1), [1]);
  assert.deepEqual(drawing.fragmentOf(2).sort(), [2, 3]);
  assert.equal(drawing.add(2, 6), null);
  drawing.clear();
  assert.equal(drawing.count(), 0);
});

test('edges() lists the lines in the order they were drawn, smaller cell first', () => {
  const drawing = createDrawing(board());
  drawing.add(2, 1);
  drawing.add(5, 6);
  drawing.add(3, 2);
  assert.deepEqual(drawing.edges(), [[1, 2], [5, 6], [2, 3]]);
});

test('only Loop, Two paths and the solids are refused', () => {
  const puzzle = board();
  assert.equal(unsupported(puzzle), null);
  assert.equal(unsupported({ ...puzzle, holes: new Uint8Array(16) }), null);
  assert.equal(unsupported({ ...puzzle, exact: true }), null);
  assert.equal(unsupported({ ...puzzle, arrows: new Uint8Array(16) }), null);
  assert.equal(unsupported({ ...puzzle, wrap: true }), null);
  assert.equal(unsupported({ ...puzzle, portals: [[1, 14]] }), null);
  for (const name of ['loop', 'split']) {
    assert.match(unsupported({ ...puzzle, [name]: true }), new RegExp(name));
  }
  assert.equal(unsupported(makeSurfacePuzzle('pentagon', 6)), null);
  assert.match(unsupported(makeSurfacePuzzle('cube', 2)), /cube/);
});

const PUZZLES = [5, 6, 7, 8].flatMap(
  n => [1, 2, 3, 4, 5, 6].map(seed => runSync(generate(n, seed))),
);

test('soundness: any part of the solution can be drawn, in any order, from anywhere', () => {
  const rnd = makeRng(2024);
  for (const puzzle of PUZZLES) {
    const edges = solutionEdges(solutionOf(puzzle));
    for (let round = 0; round < 6; round++) {
      const drawing = createDrawing(puzzle);
      const part = shuffle(edges.filter(() => rnd() < 0.3 + 0.12 * round), rnd);
      for (const [a, b] of part) {
        assert.equal(drawing.add(a, b), null, `n=${puzzle.n}: ${a}-${b} of the solution refused`);
      }
    }
  }
});

test('the whole solution drawn in any order is solved, one edge short of it is not', () => {
  const rnd = makeRng(7);
  for (const puzzle of PUZZLES) {
    const edges = solutionEdges(solutionOf(puzzle));
    const drawing = createDrawing(puzzle);
    const order = shuffle(edges.slice(), rnd);
    order.forEach(([a, b], i) => {
      drawing.add(a, b);
      assert.equal(drawing.solved(), i === order.length - 1);
    });
    assert.equal(isSolved(puzzle, drawing.path()), true);
    const [a, b] = order[0];
    drawing.remove(a, b);
    assert.equal(drawing.solved(), false);
  }
});

test('with every rule kept, solved means cells - 1 lines (random maximal drawings)', () => {
  const rnd = makeRng(99);
  for (const puzzle of PUZZLES.filter(p => p.n <= 7)) {
    const cells = puzzle.n * puzzle.n;
    const every = [];
    for (let cell = 0; cell < cells; cell++) {
      for (const d of [0, 2]) {
        const other = neighbourCell(puzzle.n, false, cell, d);
        if (other >= 0) {
          every.push([cell, other]);
        }
      }
    }
    for (let round = 0; round < 8; round++) {
      const drawing = createDrawing(puzzle);
      for (const [a, b] of shuffle(every.slice(), rnd)) {
        drawing.add(a, b);
      }
      const full = drawing.count() === cells - 1;
      assert.equal(drawing.solved(), isSolved(puzzle, drawing.path()) && full);
      assert.equal(isSolved(puzzle, drawing.path()), full);
    }
  }
});

test('every line has an owner; the owner makes no difference to the rules', () => {
  const drawing = createDrawing(board());
  assert.equal(drawing.add(1, 2, 1), null);
  assert.equal(drawing.add(2, 3), null); // the owner defaults to player 0
  assert.equal(drawing.ownerOf(1, 2), 1);
  assert.equal(drawing.ownerOf(3, 2), 0);
  assert.equal(drawing.add(2, 6, 0), 'degree'); // the other player's lines count as well
  assert.equal(drawing.add(6, 7, 1), null);
  assert.equal(drawing.add(7, 3, 1), null);
  assert.equal(drawing.add(3, 2, 1), 'present');
  drawing.remove(1, 2);
  assert.equal(drawing.ownerOf(1, 2), 0); // gone: back to the default
  drawing.clear();
  assert.equal(drawing.add(1, 2, 1), null);
  assert.equal(drawing.ownerOf(1, 2), 1);
});

test('Cutout: a hole is not entered, a line may not run to or from it', () => {
  const puzzle = board();
  puzzle.holes = new Uint8Array(16);
  puzzle.holes[1] = 1;
  const drawing = createDrawing(puzzle);
  assert.equal(drawing.add(0, 1), 'blocked');
  assert.equal(drawing.add(1, 2), 'blocked');
  assert.equal(drawing.add(0, 4), null);
});

// A 4x4 Exact board: cell 0 is step 1, cell 15 step 16, the numbers are steps.
function exactBoard(extra) {
  const puzzle = makePuzzle(4);
  puzzle.exact = true;
  puzzle.cp[0] = 1;
  puzzle.cp[15] = 16;
  Object.entries(extra).forEach(([cell, step]) => {
    puzzle.cp[cell] = step;
  });
  return puzzle;
}

test('Exact: along a piece the numbers must differ by the cells between them', () => {
  const drawing = createDrawing(exactBoard({ 1: 3, 2: 4, 3: 7 }));
  assert.equal(drawing.add(1, 2), null); // 3, 4: next to each other
  assert.equal(drawing.add(2, 3), 'steps'); // 3, 4, 7: 7 would be the 5th step, not the 6th
  assert.equal(drawing.add(2, 6), null); // an unnumbered cell goes on the piece
  assert.equal(drawing.add(6, 7), null);
  assert.equal(drawing.add(7, 3), null); // 3 4 _ _ 7: exactly the steps 3 to 7
});

test('Exact: a piece must fit between the first and the last step, either way round', () => {
  const drawing = createDrawing(exactBoard({ 6: 2 }));
  assert.equal(drawing.add(4, 5), null);
  assert.equal(drawing.add(5, 6), null);
  assert.equal(drawing.add(6, 7), null); // 2 is the 4th cell, steps 5 4 3 2 ... 1: fits
  assert.equal(drawing.add(7, 11), 'steps'); // five cells with 2 in the middle: no step 0
});

const CUTOUTS = [5, 6].flatMap(
  n => [1, 2, 3].map(seed => runSync(generateCutout(n, seed, { maxMs: CUTOUT_MAX_MS }))),
);
const EXACTS = [5, 6, 7, 8].flatMap(n => [1, 2].map(seed => runSync(generateExact(n, seed))));
const WRAPS = [4, 5, 6].flatMap(
  n => [1, 2, 3].map(seed => runSync(generate(n, seed, { wrap: true }))),
);
const TELEPORTS = [5, 6, 7, 8].flatMap(n => [1, 2].map(seed => runSync(generateTeleport(n, seed))));
const PENTAGONS = [4, 6, 8].flatMap(n => [1, 2].map(seed => runSync(generatePentagon(n, seed))));
const ARROWS = [5, 6, 7, 8].flatMap(n => [1, 2, 3].map(seed => runSync(generateArrows(n, seed))));

// Every pair of cells that a line may join, once each.
function allEdges(puzzle) {
  const every = [];
  if (isSurfacePuzzle(puzzle)) {
    const top = topologyOf(puzzle);
    for (let cell = 0; cell < top.T; cell++) {
      for (let k = 0; k < top.deg[cell]; k++) {
        const other = top.nb[cell * SLOTS + k];
        if (other > cell) {
          every.push([cell, other]);
        }
      }
    }
    return every;
  }
  for (let cell = 0; cell < puzzle.n * puzzle.n; cell++) {
    for (const d of [0, 2]) {
      const other = neighbourCell(puzzle.n, Boolean(puzzle.wrap), cell, d);
      if (other >= 0) {
        every.push([cell, other]);
      }
    }
  }
  return every.concat(puzzle.portals ?? []);
}

const SETS = [
  ['Cutout', CUTOUTS], ['Exact', EXACTS], ['Arrows', ARROWS], ['Wrap-around', WRAPS],
  ['Teleport', TELEPORTS], ['Pentagon', PENTAGONS],
];
for (const [label, puzzles] of SETS) {
  test(`${label}: any part of the solution can be drawn in any order; the whole is solved`, () => {
    const rnd = makeRng(31);
    for (const puzzle of puzzles) {
      assert.equal(unsupported(puzzle), null);
      const edges = solutionEdges(solutionOf(puzzle));
      for (let round = 0; round < 6; round++) {
        const drawing = createDrawing(puzzle);
        const part = shuffle(edges.filter(() => rnd() < 0.3 + 0.12 * round), rnd);
        for (const [a, b] of part) {
          assert.equal(drawing.add(a, b), null, `n=${puzzle.n}: ${a}-${b} of the solution refused`);
        }
      }
      const drawing = createDrawing(puzzle);
      const order = shuffle(edges.slice(), rnd);
      order.forEach(([a, b], i) => {
        drawing.add(a, b);
        assert.equal(drawing.solved(), i === order.length - 1);
      });
    }
  });

  test(`${label}: with every rule kept, solved means cells - 1 lines`, () => {
    const rnd = makeRng(5);
    for (const puzzle of puzzles) {
      const every = allEdges(puzzle);
      for (let round = 0; round < 8; round++) {
        const drawing = createDrawing(puzzle);
        for (const [a, b] of shuffle(every.slice(), rnd)) {
          drawing.add(a, b);
        }
        const full = drawing.count() === cellCount(puzzle) - 1;
        assert.equal(isSolved(puzzle, drawing.path()), full);
      }
    }
  });
}

// The 4x4 board() with one-way arrows: each [from, to] allows that step only.
function arrowBoard(...moves) {
  const puzzle = board();
  puzzle.arrows = new Uint8Array(16);
  for (const [from, to] of moves) {
    setArrowId(puzzle.arrows, edgeId(4, from, to), from < to ? 1 : -1);
  }
  return puzzle;
}

test('Arrows: a line may be drawn from either end; the arrow only counts along the piece', () => {
  assert.equal(createDrawing(arrowBoard([1, 2])).add(1, 2), null);
  assert.equal(createDrawing(arrowBoard([1, 2])).add(2, 1), null);
  assert.equal(createDrawing(arrowBoard([1, 2])).add(0, 5), 'blocked'); // not neighbours
});

test('Arrows: the arrows along one piece must all point the same way', () => {
  const drawing = createDrawing(arrowBoard([1, 2], [3, 2], [2, 3]));
  assert.equal(drawing.add(1, 2), null);
  assert.equal(drawing.add(2, 3), null); // 1 > 2 > 3: both arrows run the same way
  const clash = createDrawing(arrowBoard([1, 2], [3, 2]));
  assert.equal(clash.add(1, 2), null);
  assert.equal(clash.add(2, 3), 'direction'); // 1 > 2 < 3: cell 2 would be entered twice
  assert.equal(clash.add(3, 7), null); // a piece apart from it may run either way
});

test('Arrows: a cell with two arrows leaving it holds only one of their lines', () => {
  const drawing = createDrawing(arrowBoard([6, 5], [6, 10]));
  assert.equal(drawing.add(5, 6), null);
  assert.equal(drawing.add(6, 10), 'direction');
});

test('Arrows: cell 1 comes first, so no arrow may point into it', () => {
  assert.equal(createDrawing(arrowBoard([1, 0])).add(0, 1), 'direction');
  assert.equal(createDrawing(arrowBoard([0, 1])).add(0, 1), null);
  assert.equal(createDrawing(arrowBoard([15, 14])).add(14, 15), 'direction'); // the last number
});

test('Arrows: the numbers choose the way along a piece, and the arrows must agree', () => {
  const drawing = createDrawing(arrowBoard([6, 5]));
  assert.equal(drawing.add(5, 6), null); // number 2 alone: either way, the arrow picks 6 > 5
  assert.equal(drawing.add(6, 10), 'direction'); // 2, then 3 further on: runs 5 > 6 > 10
});

test('Arrows: an arrow turned against the solution refuses that line, as a direction', () => {
  const puzzle = runSync(generateArrows(5, 1));
  const path = solutionOf(puzzle);
  const at = path.findIndex((cell, i) => i > 0
    && arrowDirId(puzzle.arrows, edgeId(5, path[i - 1], cell)) !== 0);
  assert.ok(at > 0, 'the puzzle has an arrow on its solution');
  const edge = edgeId(5, path[at - 1], path[at]);
  setArrowId(puzzle.arrows, edge, -arrowDirId(puzzle.arrows, edge));
  const drawing = createDrawing(puzzle);
  const refused = [];
  solutionEdges(path).forEach(([a, b]) => {
    const reason = drawing.add(a, b);
    if (reason) {
      refused.push([a, b, reason]);
    }
  });
  assert.deepEqual(refused, [[path[at - 1], path[at], 'direction']]);
  assert.equal(drawing.solved(), false);
});

test('Wrap-around: the cells on opposite borders touch, so a line may run across the seam', () => {
  const plain = createDrawing(board());
  assert.equal(plain.add(0, 3), 'blocked');
  assert.equal(plain.add(1, 13), 'blocked');
  const puzzle = board();
  puzzle.wrap = true;
  const drawing = createDrawing(puzzle);
  assert.equal(drawing.linked(0, 3), true);
  assert.equal(drawing.linked(0, 5), false);
  assert.equal(drawing.add(3, 0), null); // across the right seam
  assert.equal(drawing.add(1, 13), null); // across the bottom seam
  assert.equal(drawing.add(13, 9), null);
  assert.equal(drawing.add(9, 5), null);
  assert.equal(drawing.add(5, 1), 'cycle'); // 1 > 13 > 9 > 5 > 1: once round the torus
});

test('Teleport: the two portals of a pair are linked by a line, anywhere on the board', () => {
  const plain = createDrawing(board());
  assert.equal(plain.add(1, 14), 'blocked');
  const puzzle = board();
  puzzle.portals = [[1, 14]];
  const drawing = createDrawing(puzzle);
  assert.equal(drawing.linked(1, 14), true);
  assert.equal(drawing.linked(1, 13), false);
  assert.equal(drawing.add(14, 1), null);
  assert.equal(drawing.add(1, 14), 'present');
  assert.equal(drawing.add(14, 10), null); // goes on from the other portal
  assert.equal(drawing.add(1, 13), 'blocked'); // not a neighbour, not the partner
});
