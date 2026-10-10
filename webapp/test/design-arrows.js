// Tests of what the design app needs for One way arrows: the text format (core/format.js), the
// minimize helper (gen/arrows.js), the arrow geometry (view/geometry.js) and the board previews.
// Registered by tests.js: designArrowsTests(t, ok, eq).
import { makePuzzle, validate } from '../src/core/model.js';
import {
  edgeId, setArrowId, setWallId, arrowIds, arrowDirId, arrowCount,
} from '../src/core/edges.js';
import { serialize, parse } from '../src/core/format.js';
import { solve } from '../src/core/solver/solve.js';
import { runSync } from '../src/core/run.js';
import { makeRng } from '../src/core/rng.js';
import { generateArrows, minimizeArrowsFully } from '../src/core/gen/arrows.js';
import { arrowMarkPoints, arrowMarks } from '../src/view/geometry.js';
import { miniPreviewSvg } from '../src/apps/design/board.js';

// 3x3: 1 top left, 2 bottom right, arrows 4 -> 5 (right) and 7 -> 4 (up).
function hand() {
  const p = makePuzzle(3);
  p.cp[0] = 1;
  p.cp[8] = 2;
  p.arrows = new Uint8Array(9);
  setArrowId(p.arrows, edgeId(3, 4, 5), 1);
  setArrowId(p.arrows, edgeId(3, 4, 7), -1);
  return p;
}

const text = lines => lines.join('\n');

export function designArrowsTests(t, ok, eq) {
  t('format: an arrows puzzle serializes as "r,c>r,c" moves and parses back', () => {
    const p = hand();
    const out = serialize(p);
    ok(out.includes('arrows 1,1>1,2 2,1>1,1'), out);
    ok(out.split('\n').some(l => l.startsWith('# arrows ')), 'a header comment explains the line');
    const q = parse(out);
    eq([[...q.arrows], [...q.cp], [...q.walls]], [[...p.arrows], [...p.cp], [...p.walls]]);
    eq(serialize(q), out);
    ok(validate(q).ok);
    eq(arrowCount(q), 2);
  });

  t('format: no arrows line for a standard puzzle; an empty one keeps the variant', () => {
    const plain = makePuzzle(3);
    plain.cp[0] = 1;
    plain.cp[8] = 2;
    ok(!/^arrows/m.test(serialize(plain)) && parse(serialize(plain)).arrows === undefined);
    const empty = parse(text(['size 3', 'checkpoints 0,0=1 2,2=2', 'walls', 'arrows']));
    ok(empty.arrows instanceof Uint8Array && arrowCount(empty) === 0);
    ok(/^arrows$/m.test(serialize(empty)));
    eq(parse(serialize(empty)).arrows.length, 9);
  });

  t('format: arrows go either way on the page; bad ones are refused with a message', () => {
    const base = ['size 3', 'checkpoints 0,0=1 2,2=2'];
    const withArrows = tokens => parse(text([...base, 'arrows ' + tokens]));
    eq(arrowDirId(withArrows('1,2>1,1').arrows, edgeId(3, 4, 5)), -1, 'left = to the lower cell');
    eq(arrowDirId(withArrows('1,1>2,1').arrows, edgeId(3, 4, 7)), 1, 'down = to the higher cell');
    const refused = (tokens, pattern, extra = []) => {
      let message = '';
      try {
        parse(text([...base, ...extra, 'arrows ' + tokens]));
      } catch (e) {
        message = e.message;
      }
      ok(pattern.test(message), `"${tokens}" -> "${message}"`);
    };
    refused('1,1-1,2', /Invalid arrow/);
    refused('1,1>1', /Invalid arrow/);
    refused('3,0>2,0', /out of range/);
    refused('0,0>1,1', /not neighbours/);
    refused('1,1>1,2 1,2>1,1', /Two arrows on one edge/);
    refused('1,1>1,2 1,1>1,2', /Two arrows on one edge/);
    refused('0,0>0,1', /on a wall/, ['walls V,0,0']);
    refused('1,1>1,2', /hole/, ['holes 1,2']);
  });

  t('format: a path that walks against an arrow is refused, one that follows it is kept', () => {
    const lines = ['size 3', 'checkpoints 0,0=1 2,2=2', 'arrows 0,1>0,0'];
    let message = '';
    try {
      parse(text([...lines, 'path 0,0 0,1']));
    } catch (e) {
      message = e.message;
    }
    ok(/crosses a wall/.test(message) || /step/.test(message), message);
    const follows = ['size 3', 'checkpoints 0,0=1 2,2=2', 'arrows 0,0>0,1', 'path 0,0 0,1'];
    const good = parse(text(follows));
    eq(good.path, [0, 1]);
  });

  t('format: a generated arrows puzzle survives export and import', () => {
    const p = runSync(generateArrows(6, 71, { candidates: 2, refineNodes: 0 }));
    const q = parse(serialize(p, { times: { generateMs: 12.5 } }));
    eq([[...q.arrows], [...q.cp]], [[...p.arrows], [...p.cp]]);
    eq(solve(q, { limit: 2, nodeCap: 5e6 }).count, 1);
  });

  t('minimizeArrowsFully: drops spare arrows, keeps the needed ones, stays unique', () => {
    const p = runSync(generateArrows(6, 72, { candidates: 2, refineNodes: 0 }));
    const needed = arrowIds(p);
    const rnd = makeRng(5);
    // add spare arrows on edges the solution does not use (they keep it unique)
    const onPath = new Set();
    for (let i = 1; i < p.path.length; i++) onPath.add(edgeId(6, p.path[i - 1], p.path[i]));
    let added = 0;
    for (let e = 0; e < 2 * 36 && added < 5; e++) {
      const exists = e & 1 ? (e >> 1) + 6 < 36 : ((e >> 1) % 6) + 1 < 6;
      if (!exists || onPath.has(e) || arrowDirId(p.arrows, e) !== 0) continue;
      setArrowId(p.arrows, e, rnd() < 0.5 ? 1 : -1);
      added++;
    }
    eq(solve(p, { limit: 2, nodeCap: 5e6 }).count, 1);
    const events = [];
    const r = runSync(minimizeArrowsFully(p, arrowIds(p), rnd, 200000, 4, { refineBudget: 1e6 }),
      ev => events.push(ev));
    eq(r.uncertain, []);
    ok(r.removed >= 1 && r.kept === arrowCount(p), `${r.removed} removed, ${r.kept} kept`);
    eq(solve(p, { limit: 2, nodeCap: 5e6 }).count, 1);
    for (const e of needed) ok(arrowDirId(p.arrows, e) !== 0, 'a needed arrow was removed');
    ok(events.length >= added, 'one event per checked arrow');
  });

  t('geometry: the arrow triangle sits mid-edge, pointing the allowed way', () => {
    const point = s => s.split(' ').map(q => q.split(',').map(Number));
    const [tip] = point(arrowMarkPoints(3, 4, 5));
    eq(tip, [2 + 0.2, 1.5], 'cell 4 -> 5 points right, from the middle (2, 1.5)');
    const [up] = point(arrowMarkPoints(3, 7, 4));
    eq(up, [1.5, 2 - 0.2], '7 -> 4 points up');
    const back = point(arrowMarkPoints(3, 4, 5)).slice(1);
    ok(back.every(([x]) => x < 2), 'the base is behind the middle');
    eq(point(arrowMarkPoints(3, 4, 5, 10))[0], [22, 15], 'scaled');
    const marks = arrowMarks(hand());
    eq(marks.map(m => [m.from, m.to]), [[4, 5], [7, 4]]);
    eq(arrowMarks(makePuzzle(3)), []);
  });

  t('design board: the compare preview draws the arrows of a puzzle', () => {
    const withArrows = miniPreviewSvg(hand(), null, '#fff');
    eq((withArrows.match(/<polygon /g) || []).length, 2);
    const plain = makePuzzle(3);
    plain.cp[0] = 1;
    plain.cp[8] = 2;
    ok(!miniPreviewSvg(plain, null, '#fff').includes('<polygon'));
    setWallId(plain.walls, edgeId(3, 0, 1), true);
    ok(miniPreviewSvg(plain, null, '#fff').includes('<line'));
  });
}
