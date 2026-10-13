// Tests of Exact Assist: features/assist.js (number states, route length, the readout), the board
// markup that shows it (board.js) and its texts. Registered by tests.js: exactAssistTests(t, ok,
// eq).
import { makePuzzle } from '../src/core/model.js';
import { solve } from '../src/core/solver/solve.js';
import { canStep } from '../src/core/rules.js';
import { runSync } from '../src/core/run.js';
import { makeRng } from '../src/core/rng.js';
import { generateExact } from '../src/core/gen/exact.js';
import { assistState, numberStates, routeLength } from '../src/features/assist.js';
import { boardSvg, assistRing, badgeColors, COLORS } from '../src/apps/play/board.js';
import { EN, ZH } from '../src/ui/i18n.js';

// An Exact puzzle with `numbers` = { cell: step }.
function exactPuzzle(n, numbers) {
  const p = makePuzzle(n);
  p.exact = true;
  for (const [cell, number] of Object.entries(numbers)) {
    p.cp[+cell] = number;
  }
  return p;
}

// The 5x5 example (1 at (2,4), 12 at (3,2), 20 at (2,1), 25 at (3,1)) and a line that goes wrong
// at step 5 (the solution goes down to (1,3) there) and is out of reach of 12 from step 11 on.
const EXAMPLE = exactPuzzle(5, { 14: 1, 17: 12, 11: 20, 16: 25 });
const WRONG_LINE = [14, 9, 4, 3, 2, 1, 0, 5, 6, 7, 8];

const board = (puzzle, path, assist) => boardSvg({
  puzzle, path, hintCell: null, hintWrongCell: null, assist,
});

export function exactAssistTests(t, ok, eq) {
  t('assist: number states: wrong (off its step), missed (its step passed), none yet', () => {
    const p = exactPuzzle(3, { 0: 1, 2: 3, 8: 9 });
    const states = path => [...numberStates(p, path)];
    eq(states([0, 1, 2]), [], 'on its step');
    eq(states([0, 1]), [], 'its step has not come');
    eq(states([0, 3, 4, 1, 2]), [[2, 'wrong']], 'number 3 on step 5');
    eq(states([0, 1, 4]), [[2, 'missed']], 'step 3 went to another cell');
    eq(states([0, 1, 4, 3, 6, 7]), [[2, 'missed']], 'it stays missed');
    eq(states([0, 1, 4, 3, 6, 7, 8]), [[2, 'missed'], [8, 'wrong']], 'and the end is on step 7');
    eq(states([2, 1, 0]), [[0, 'wrong'], [2, 'wrong']], 'start and number 3 reversed');
    const standard = makePuzzle(3);
    standard.cp[0] = 1;
    standard.cp[8] = 2;
    eq(states([0, 1, 4]), states([0, 1, 4]));
    eq([...numberStates(standard, [0, 1, 4])], [], 'a standard puzzle has no steps');
  });

  t('assist: route length goes around the line and the numbered cells, null when cut off', () => {
    const p = exactPuzzle(5, { 14: 1, 17: 12, 11: 20, 16: 25 });
    eq(routeLength(p, [14], 17), 3, 'straight');
    // (2,1) holds 20, a number that must wait: the way from (1,1) to 12 at (3,2) goes round it
    eq(routeLength(p, [14, 9, 4, 3, 2, 1, 0, 5, 6], 17), 3);
    // 20 sits between the head and the next number 9: it cannot be crossed before its own step
    const between = exactPuzzle(5, { 10: 1, 11: 20, 12: 9, 24: 25 });
    eq(routeLength(between, [10], 12), 4, 'round the number, not through it');
    const q = exactPuzzle(3, { 5: 1, 2: 8, 8: 9 });
    eq(routeLength(q, [5, 4, 1, 0, 3, 6], 2), null, 'cell (0,2) is closed in by the line');
    const walled = exactPuzzle(3, { 0: 1, 2: 5, 8: 9 });
    eq(routeLength(walled, [0, 1], 2), 1);
    walled.holes = new Uint8Array(9);
    walled.holes[5] = 1;
    eq(routeLength(walled, [3], 2), 3, 'round the hole at (1,2): (1,1), (0,1), (0,2)');
    walled.holes[1] = 1;
    eq(routeLength(walled, [3], 2), null, 'holes on both sides: cut off');
  });

  t('assist: the 5x5 example: slack shrinks to 0, then the next number is out of reach', () => {
    const slack = [];
    for (let length = 1; length <= WRONG_LINE.length; length++) {
      const s = assistState(EXAMPLE, WRONG_LINE.slice(0, length));
      eq([s.step, s.next, s.steps], [length, 12, 12 - length]);
      slack.push(s.status === 'idle' ? null : s.slack);
      if (length < 11) eq(s.status, 'ok', `step ${length}`);
    }
    eq(slack, [8, 6, 4, 4, 4, 2, 0, 0, 0, 0, -2]);
    const last = assistState(EXAMPLE, WRONG_LINE);
    eq([last.status, last.steps, last.away, last.slack, last.nextCell], ['doomed', 1, 3, -2, 17]);
    const solution = [14, 9, 4, 3, 8, 13, 18, 19, 24, 23, 22, 17];
    for (let length = 1; length < 12; length++) {
      eq(assistState(EXAMPLE, solution.slice(0, length)).status, 'ok', `solution, step ${length}`);
    }
  });

  t('assist: cut off, missed, and nothing to say', () => {
    const q = exactPuzzle(3, { 5: 1, 2: 8, 8: 9 });
    const cut = assistState(q, [5, 4, 1, 0, 3, 6]);
    eq([cut.status, cut.away, cut.slack, cut.next], ['doomed', null, null, 8]);
    const p = exactPuzzle(3, { 0: 1, 2: 3, 8: 9 });
    const missed = assistState(p, [0, 1, 4]);
    eq([missed.status, missed.missed, missed.cell], ['missed', 3, 2]);
    const early = assistState(p, [0, 3, 4, 1, 2]);
    eq([early.status, early.missed], ['missed', 3]);
    eq(assistState(p, []).status, 'idle', 'no line yet');
    const done = [0, 1, 2, 5, 4, 3, 6, 7, 8];
    eq(assistState(p, done).status, 'idle', 'every number passed');
    const standard = makePuzzle(3);
    standard.cp[0] = 1;
    standard.cp[8] = 2;
    eq(assistState(standard, [0, 1]).status, 'idle', 'a standard puzzle');
  });

  t('assist: never wrong: doomed or missed lines cannot be completed, the solution is fine', () => {
    const rnd = makeRng(5);
    let flagged = 0;
    let checked = 0;
    for (const [n, seed] of [[5, 1], [6, 2], [6, 3], [7, 4]]) {
      const p = runSync(generateExact(n, seed, { candidates: 1, refineNodes: 0 }));
      for (let length = 1; length <= p.path.length; length++) {
        const status = assistState(p, p.path.slice(0, length)).status;
        ok(status === 'ok' || status === 'idle', `${n}x${n} solution step ${length}: ${status}`);
      }
      for (let trial = 0; trial < 40; trial++) {
        // the solution up to a random step, a wrong turn, then random moves
        const line = p.path.slice(0, 1 + Math.floor(rnd() * (p.path.length - 2)));
        for (let moves = 1 + Math.floor(rnd() * 6); moves > 0; moves--) {
          const head = line[line.length - 1];
          const options = [];
          for (let cell = 0; cell < n * n; cell++) {
            if (canStep(p, head, cell) && !line.includes(cell)) options.push(cell);
          }
          if (!options.length) break;
          line.push(options[Math.floor(rnd() * options.length)]);
        }
        checked++;
        const status = assistState(p, line).status;
        if (status !== 'doomed' && status !== 'missed') continue;
        flagged++;
        const r = solve(p, { limit: 1, nodeCap: 2e6, forced: line, prop: true, parity: true });
        const tag = `${n}x${n} seed ${seed}: ${line.join()} is ${status}`;
        eq([r.count, r.exceeded], [0, false], tag);
      }
    }
    ok(flagged >= 40, `${flagged} of ${checked} lines were flagged`);
  });

  t('assist: the ring only with Assist on and a line out of reach; missed numbers are red', () => {
    const doomed = board(EXAMPLE, WRONG_LINE, true);
    ok(doomed.includes('data-role="assist"'), 'ring on the number out of reach');
    ok(!board(EXAMPLE, WRONG_LINE, false).includes('data-role="assist"'), 'Assist off');
    const reachable = board(EXAMPLE, WRONG_LINE.slice(0, 5), true);
    ok(!reachable.includes('data-role="assist"'), 'still reachable');
    ok(!board(EXAMPLE, [], true).includes('data-role="assist"'), 'no line');
    const cx = (14 % 5) * 60 + 30;
    ok(!doomed.includes('assist-ring" cx="' + cx), 'the ring is on cell 17, not the start');
    const ring = `assist-ring" cx="${(17 % 5) * 60 + 30}" cy="${((17 / 5) | 0) * 60 + 30}"`;
    ok(doomed.includes(ring));
    const standard = makePuzzle(3);
    standard.cp[0] = 1;
    standard.cp[8] = 2;
    ok(!board(standard, [0, 1], true).includes('data-role="assist"'), 'a standard puzzle');
    const p = exactPuzzle(3, { 0: 1, 2: 3, 8: 9 });
    const badge = (svg, cell) => svg.match(
      new RegExp(`data-num-cell="${cell}"><circle[^>]*fill="([^"]+)" stroke="([^"]+)"`),
    ).slice(1);
    const red = COLORS.numberWrong;
    eq(badge(board(p, [0, 1, 4]), 2), [COLORS.numberFill, red], 'missed: white, red ring');
    eq(badge(board(p, [0, 3, 4, 1, 2]), 2), [red, red], 'wrong step: filled red');
    eq(badge(board(p, [0, 1, 2]), 2), [COLORS.number, COLORS.number], 'on its step: blue');
    eq(badgeColors(false, false, true).stroke, COLORS.numberWrong);
    eq(badgeColors(true, false, true).fill, COLORS.number, 'a visited number is never "missed"');
    eq(assistRing(EXAMPLE, { status: 'ok' }), '');
  });

  t('assist: the texts, both languages, plural and singular', () => {
    for (const dict of [EN, ZH]) {
      for (const key of ['assist.on', 'assist.off', 'assist.tip']) {
        ok(typeof dict[key] === 'string', key);
      }
      const lines = [
        dict['assist.next'](20, 8, 5), dict['assist.far'](12, 1, 3),
        dict['assist.cut'](8), dict['assist.missed'](3),
      ];
      ok(lines.every(line => typeof line === 'string' && line.length > 3), lines.join(' | '));
    }
    eq(EN['assist.next'](20, 8, 5), 'Next 20: 8 steps, 5 away');
    eq(EN['assist.next'](20, 1, 1), 'Next 20: 1 step, 1 away');
    eq(EN['assist.far'](12, 1, 3), 'Too far: 12 is 3 away, 1 step left');
    ok(ZH['assist.far'](12, 1, 3).includes('12') && ZH['assist.next'](20, 8, 5).includes('8'));
  });
}
