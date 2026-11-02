// Tests of what the design app needs for the Cutout puzzle type (boards with holes): the hole tool
// (apps/design/holes.js), the board drawing (apps/design/board.js, on a recording stand-in for the page),
// the random path / unique generator on a board of the designer's own (gen/generate.js o.holes), scatter on
// such a board, the play-mode overlays (core/connectivity.js), the text format, and what design.html
// offers. Registered by tests.js: designCutoutTests(t, ok, eq).
import { readFileSync } from 'node:fs';
import { makePuzzle, validate, cellCount, maxNumber } from '../src/core/model.js';
import { edgeCells, setWallId, hasWallId, wallIds } from '../src/core/edges.js';
import { serialize, parse } from '../src/core/format.js';
import { isSolved } from '../src/core/rules.js';
import { solve } from '../src/core/solver/solve.js';
import { runSync } from '../src/core/run.js';
import { makeRng } from '../src/core/rng.js';
import { randomPathPuzzle, generateUnique } from '../src/core/gen/generate.js';
import { scatter } from '../src/core/gen/checkpoints.js';
import { shapeIsViable, shapeProblem, adjacency, colourCounts, isBalanced } from '../src/core/gen/shapes.js';
import { boardConnectivity, boardPropagation, boardLegCollide } from '../src/core/connectivity.js';
import { toggleHole, holeCount, boardProblem } from '../src/apps/design/holes.js';
import { renderBoard } from '../src/apps/design/board.js';

const html = readFileSync(new URL('../design.html', import.meta.url), 'utf8');

// A board of n x n with these [row, col] cells cut out.
function holed(n, cells) {
  const p = makePuzzle(n);
  p.holes = new Uint8Array(n * n);
  for (const [r, c] of cells) p.holes[r * n + c] = 1;
  return p;
}
const DONUT6 = [[2, 2], [2, 3], [3, 2], [3, 3]];
const wallsAtHoles = p => wallIds(p).filter(e => edgeCells(p.n, e).some(c => p.holes[c]));

// What renderBoard asks of the page, recorded: elements with a class name, style, data and children.
function fakePage() {
  const el = () => {
    const classes = new Set();
    const node = {
      className: '', style: { setProperty() {} }, dataset: {}, children: [], attrs: {}, textContent: '',
      appendChild(child) { node.children.push(child); return child; },
      setAttribute(k, v) { node.attrs[k] = v; },
      classList: { toggle(name, on) { if (on === undefined ? !classes.has(name) : on) classes.add(name); else classes.delete(name); }, has: name => classes.has(name) },
    };
    Object.defineProperty(node, 'innerHTML', { set() { node.children = []; }, get: () => '' });
    return node;
  };
  return { createElement: el, createElementNS: el };
}
function draw(p, mode) {
  const saved = globalThis.document;
  globalThis.document = fakePage();
  try {
    const board = globalThis.document.createElement('div'), stage = globalThis.document.createElement('div');
    renderBoard(board, stage, {
      P: p, cellSize: 40, mode, selected: -1, pending: -1, buffer: '', numColour: 0, playMode: false,
      playPath: [], preview: null, previewVisible: true, solutions: [], solVisible: [], dragSrc: -1,
    });
    return board;
  } finally {
    globalThis.document = saved;
  }
}

export function designCutoutTests(t, ok, eq) {
  t('design-cutout: toggleHole cuts and fills, takes the walls on the cell\'s four sides with it, refuses a numbered cell', () => {
    const p = holed(5, []);
    const mid = 2 * 5 + 2;
    for (const e of [mid * 2, mid * 2 + 1, (mid - 1) * 2, (mid - 5) * 2 + 1, (mid + 1) * 2]) setWallId(p.walls, e, true);
    eq(toggleHole(p, mid), { hole: true, walls: 4 });
    eq(wallIds(p), [(mid + 1) * 2], 'the wall between the two cells on the right stays');
    eq(holeCount(p), 1);
    eq(toggleHole(p, mid), { hole: false, walls: 0 });
    eq(holeCount(p), 0);
    p.cp[0] = 1;
    eq(toggleHole(p, 0), null, 'a checkpoint stays');
    eq(holeCount(p), 0);
    // a corner and an edge cell have fewer sides: nothing to take outside the board
    eq(toggleHole(p, 24), { hole: true, walls: 0 });
    eq(holeCount(makePuzzle(5)), 0, 'no holes array: none');
  });

  t('design-cutout: shapeProblem says why a board has no path; shapeIsViable is its yes / no', () => {
    eq(shapeProblem(6, holed(6, DONUT6).holes), null);
    eq(shapeProblem(6, holed(6, [[0, 0], [1, 1]]).holes) !== null, true);
    ok(/Checkerboard rule: 16 cells of one colour against 18/.test(shapeProblem(6, holed(6, [[0, 0], [1, 1]]).holes)), shapeProblem(6, holed(6, [[0, 0], [1, 1]]).holes));
    // a column of holes cuts the board in two pieces (balanced: 3 + 3 of each colour per piece)
    ok(/one piece/.test(shapeProblem(6, holed(6, [0, 1, 2, 3, 4, 5].map(r => [r, 2])).holes)));
    // a cell whose three neighbours are holes
    ok(/no neighbour/.test(shapeProblem(4, holed(4, [[0, 1], [1, 0], [2, 2], [3, 3]]).holes)));
    ok(/Fewer than 4/.test(shapeProblem(2, holed(2, [[0, 0], [0, 1]]).holes)));
    eq(boardProblem(makePuzzle(5)), null, 'a board without holes is not checked');
    // the old yes / no, written out again: balanced, every cell has a neighbour, at most two cells hang on one,
    // at least 4 cells, one piece
    const reference = (n, holes) => {
      if (!isBalanced(n, holes)) return false;
      const adj = adjacency(n, holes);
      const cells = [...holes.keys()].filter(i => !holes[i]);
      if (cells.length < 4 || cells.some(i => adj[i].length === 0) || cells.filter(i => adj[i].length === 1).length > 2) return false;
      const seen = new Set([cells[0]]), stack = [cells[0]];
      while (stack.length) for (const v of adj[stack.pop()]) if (!seen.has(v)) { seen.add(v); stack.push(v); }
      return seen.size === cells.length;
    };
    const rnd = makeRng(5);
    let yes = 0;
    for (let k = 0; k < 400; k++) {
      const holes = new Uint8Array(25);
      for (let i = 0; i < 25; i++) holes[i] = rnd() < 0.18 ? 1 : 0;
      eq(shapeIsViable(5, holes), reference(5, holes), `mask ${[...holes].join('')}`);
      yes += shapeIsViable(5, holes) ? 1 : 0;
    }
    ok(yes > 20 && yes < 380, `the masks cover both answers (${yes} yes)`);
  });

  t('design-cutout: scatter on a board with holes numbers cells that are left only; without holes it is as before', () => {
    const p = holed(6, DONUT6);
    for (let seed = 1; seed <= 10; seed++) {
      const cp = scatter(p, 9, makeRng(seed));
      const numbered = [...cp].map((v, i) => [v, i]).filter(([v]) => v);
      eq(numbered.length, 9);
      eq(numbered.map(([v]) => v).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
      ok(numbered.every(([, i]) => !p.holes[i]), `seed ${seed}: a number on a hole`);
    }
    eq([...scatter(p, 99, makeRng(1))].filter(Boolean).length, cellCount(p), 'at most one number per cell that is left');
    // the same call on a puzzle with no holes array gives the shuffle it always gave
    const plain = makePuzzle(6);
    eq([...scatter(plain, 7, makeRng(3))], [...scatter({ ...plain, holes: new Uint8Array(36) }, 7, makeRng(3))]);
  });

  t('design-cutout: randomPathPuzzle on a holed board — a path over the cells left, the holes kept; the reason when there is none', () => {
    for (const [n, cells] of [[6, DONUT6], [7, [[3, 3]]], [5, [[2, 2]]], [6, [[0, 0], [0, 1], [1, 0], [1, 1]]]]) {
      const board = holed(n, cells);
      for (let seed = 1; seed <= 4; seed++) {
        const p = randomPathPuzzle(n, 6, makeRng(seed), false, false, 0, false, board.holes);
        const tag = `n=${n} seed=${seed}`;
        eq(p.path.length, cellCount(board), tag);
        ok(p.path.every(c => !board.holes[c]), `${tag}: the path keeps off the holes`);
        eq([...p.holes], [...board.holes], tag);
        ok(p.holes !== board.holes, 'a copy');
        ok(validate(p).ok && isSolved(p, p.path), `${tag}: ${validate(p).msg}`);
        eq(maxNumber(p), 6);
      }
    }
    let message = '';
    try {
      randomPathPuzzle(6, 6, makeRng(1), false, false, 0, false, holed(6, [[0, 0], [1, 1]]).holes);
    } catch (e) {
      message = e.message;
    }
    ok(/Checkerboard rule/.test(message), message);
    // K counts the cells left, not n * n
    eq(maxNumber(randomPathPuzzle(4, 99, makeRng(2), false, false, 0, false, holed(4, [[1, 1], [1, 2]]).holes)), 14);
  });

  t('design-cutout: generateUnique on a holed board — one solution, holes kept, no wall at a hole; refused where there is no path', () => {
    for (const [n, cells] of [[6, DONUT6], [7, [[3, 3]]], [5, [[2, 2]]]]) {
      const board = holed(n, cells);
      const r = runSync(generateUnique(n, n, makeRng(n * 7), { maxWalls: 12, tries: 30, holes: board.holes }));
      ok(r.unique, `n=${n}: unique`);
      eq([...r.puzzle.holes], [...board.holes]);
      eq(wallsAtHoles(r.puzzle), [], `n=${n}: no wall touches a hole`);
      eq(solve(r.puzzle, { limit: 2, nodeCap: 1e6, prop: true }).count, 1, `n=${n}: one solution`);
      ok(r.walls <= 12, `n=${n}: ${r.walls} walls`);
    }
    // the hardest-of-all-tries mode and the build / minimize / score flags work as on a plain board
    const board = holed(6, DONUT6);
    const hard = runSync(generateUnique(6, 6, makeRng(4), { maxWalls: 12, tries: 4, hardest: true, holes: board.holes }));
    ok(hard.unique && hard.nodes > 0);
    for (const bad of [{ holes: holed(6, [[0, 0], [1, 1]]).holes }, { holes: board.holes, wrap: true }, { holes: board.holes, loop: true }]) {
      let failed = false;
      try {
        runSync(generateUnique(6, 6, makeRng(1), bad));
      } catch {
        failed = true;
      }
      ok(failed, 'refused');
    }
    // without o.holes nothing changes: the same puzzle for the same seed
    const a = runSync(generateUnique(5, 5, makeRng(9), { maxWalls: 8, tries: 10 }));
    const b = runSync(generateUnique(5, 5, makeRng(9), { maxWalls: 8, tries: 10, holes: null }));
    eq(serialize(a.puzzle), serialize(b.puzzle));
    ok(!('holes' in a.puzzle));
  });

  t('design-cutout: the solver flags the design app offers agree on a holed board', () => {
    const flags = [{}, { prop: true }, { prop: true, pocket: true, parity: true, prune2: true, seg: 'all', legCollide: true }];
    for (const [n, cells] of [[6, DONUT6], [7, [[3, 3], [0, 0]]]]) {
      const p = randomPathPuzzle(n, 5, makeRng(n), false, false, 0, false, holed(n, cells).holes);
      const runs = flags.map(f => solve(p, { limit: 3, nodeCap: 5e6, capture: true, ...f }));
      for (const r of runs) eq([r.count, r.paths], [runs[0].count, runs[0].paths], `n=${n}`);
      ok(runs[0].count >= 1, 'the generated path solves it');
    }
  });

  t('design-cutout: play-mode overlays on a holed board — holes are neither unreachable nor dead, no prefix of the solution is stuck', () => {
    const board = holed(6, DONUT6);
    const q = runSync(generateUnique(6, 6, makeRng(3), { maxWalls: 10, tries: 30, holes: board.holes })).puzzle;
    const path = solve(q, { limit: 2, nodeCap: 1e6, capture: true, prop: true }).paths[0];
    const holes = new Set([...q.holes.keys()].filter(i => q.holes[i]));
    eq(holes.size, 4);
    for (let len = 1; len < path.length; len++) {
      const prefix = path.slice(0, len);
      const conn = boardConnectivity(q, prefix);
      ok(conn.connOk, `prefix ${len}: connected`);
      eq(conn.reachable.size, cellCount(q) - len, `prefix ${len}: every cell left can be reached`);
      for (const h of holes) ok(!conn.unreachable.has(h) && !conn.deadEnd.has(h) && !conn.reachable.has(h), `prefix ${len}: hole ${h}`);
      ok(!boardPropagation(q, prefix).infeasible, `prefix ${len}: propagation`);
      ok(!boardLegCollide(q, prefix).infeasible, `prefix ${len}: legs`);
    }
  });

  t('design-cutout: export and import keep the holes, the walls, the numbers and a path; a checkpoint on a hole is refused', () => {
    const board = holed(6, DONUT6);
    const q = runSync(generateUnique(6, 6, makeRng(8), { maxWalls: 10, tries: 30, holes: board.holes })).puzzle;
    const path = solve(q, { limit: 2, nodeCap: 1e6, capture: true, prop: true }).paths[0];
    const text = serialize(q, { path });
    ok(/^holes 2,2 2,3 3,2 3,3$/m.test(text), text);
    const back = parse(text);
    eq([...back.holes], [...q.holes]);
    eq([...back.cp], [...q.cp]);
    eq(wallIds(back), wallIds(q));
    eq(back.path, path);
    let msg = '';
    try {
      parse('size 4\ncheckpoints 1,1=1 0,0=2\nwalls\nholes 1,1');
    } catch (e) {
      msg = e.message;
    }
    ok(/hole/.test(msg), msg);
    // a design board with no hole yet exports as a plain puzzle
    const empty = holed(5, []);
    ok(!/^holes/m.test(serialize(empty)));
    eq(colourCounts(5, empty.holes), [13, 12]);
  });

  t('design-cutout: renderBoard draws a hole as a cell of its own kind, without wall handles; the Holes tool shows it', () => {
    const p = holed(4, [[1, 1]]); // cell 5
    p.cp[0] = 1;
    const board = draw(p, 'number');
    const cells = board.children.filter(c => c.className.startsWith('cell'));
    eq(cells.length, 16);
    eq(cells.filter(c => c.className.includes('hole')).map(c => +c.dataset.idx), [5]);
    ok(cells.every(c => c.className.includes('hole') !== c.className.includes('editable')), 'a hole is not editable');
    const handles = board.children.filter(c => c.className.startsWith('wallhit'));
    eq(handles.length, 24 - 4, 'the four edges of the hole have no handle');
    const edges = handles.map(h => +h.dataset.edge);
    for (const gone of [3, 8, 10, 11]) ok(!edges.includes(gone), `edge ${gone}`);
    ok(!board.classList.has('holemode'));
    ok(draw(p, 'hole').classList.has('holemode'));
    // a board without holes draws what it always drew
    const plain = draw(makePuzzle(4), 'number');
    eq(plain.children.filter(c => c.className.startsWith('wallhit')).length, 24);
    ok(plain.children.filter(c => c.className.startsWith('cell')).every(c => c.className.includes('editable')));
  });

  t('design-cutout: design.html offers the type and the Holes tool, in the groups of the types with walls and numbers', () => {
    ok(html.includes('<option value="cutout">Cutout</option>'), 'the type option');
    for (const id of ['modeHole', 'holeModeTag', 'randCutout', 'cutoutShape', 'cutoutInterior', 'cutoutGrade', 'cutoutSecs', 'clearHoles']) {
      ok(html.includes(`id="${id}"`), id);
    }
    const lists = [...html.matchAll(/data-variants="([^"]*)"/g)].map(m => m[1].split(' '));
    // every group that holds several types and has Teleport has Cutout (both are a board of numbers and walls) ...
    // ... but the Reproduce Play group: the Play app cannot rebuild a Cutout puzzle from a seed
    const without = lists.filter(l => l.length > 1 && l.includes('teleport') && !l.includes('cutout'));
    eq(without.length, 1);
    ok(html.indexOf(without[0].join(' ')) < html.indexOf('id="reproducePlay"'));
    // the groups that are not for it stay without it: the A/B comparison, the target grades, the diagnostics
    ok(lists.some(l => l.join(' ') === 'standard wrap exact loop'), 'compare group unchanged');
    ok(lists.some(l => l.join(' ') === 'standard exact'), 'target grade group unchanged');
    eq(lists.filter(l => l.length === 1 && l[0] === 'cutout').length, 2, 'the Holes tool and the generator');
  });
}
