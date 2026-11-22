// Tests of the zoom of the play board: the camera math (view/camera.js), the router that decides
// who gets the fingers (apps/play/gesture.js), and what the board markup does with the camera.
// The page itself (apps/play/zoom.js, grid-input.js) needs a browser and is not run here.
import '../setup-balls.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makePuzzle } from '../../src/core/model.js';
import { runSync } from '../../src/core/run.js';
import { generatePentagon } from '../../src/core/gen/pentagon.js';
import { cellAtPoint } from '../../src/view/geometry.js';
import {
  EDGE_BAND,
  EDGE_SPEED,
  MAX_ZOOM_CAP,
  MIN_MAX_ZOOM,
  ZOOM_STEP,
  blend,
  boardPoint,
  boardRect,
  clampCamera,
  drift,
  edgeVelocity,
  fitCamera,
  isZoomed,
  keepInView,
  maxZoom,
  panBy,
  pinchCamera,
  viewBoxAttr,
  viewOf,
  zoomAt,
} from '../../src/view/camera.js';
import {
  ANCHOR_MOVE,
  COMMIT_SLOP,
  FINGER_MOVED,
  classifyPair,
  createRouter,
} from '../../src/apps/play/gesture.js';
import { SLOTS, surfaceTopology } from '../../src/core/surface/topology.js';
import { IDENTITY, buildView, orbit } from '../../src/view/proj.js';
import { headTurnedAway } from '../../src/view/solid-nav.js';
import { CELL, boardSvg, boardView } from '../../src/apps/play/board.js';
import {
  pentagonBoardSvg,
  pentagonCellAt,
  pentagonPoint,
  pentagonView,
} from '../../src/apps/play/pentagon-board.js';
import { cellPoint, fullViewOf } from '../../src/apps/play/puzzle-kit.js';
import { EN, ZH } from '../../src/ui/i18n.js';
import { MAP_PX, zoomMapHtml } from '../../src/apps/play/zoom-map.js';

const FULL = { x: 0, y: 0, w: 960, h: 960 }; // a 16x16 board
const BOX = { left: 20, top: 100, width: 350, height: 350 }; // the svg on a phone
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const nearAll = (a, b, eps = 1e-6) => a.every((v, i) => near(v, b[i], eps));
const nearCam = (a, b) => nearAll([a.s, a.cx, a.cy], [b.s, b.cx, b.cy]);
const state = (p, extra = {}) => ({
  puzzle: p,
  path: [],
  paths: [[], []],
  hintCell: null,
  hintWrongCell: null,
  ...extra,
});

test('camera: fit shows the whole picture; the viewBox of s = 1 is the full view box', () => {
  const cam = fitCamera(FULL);
  assert.deepStrictEqual(cam, { s: 1, cx: 480, cy: 480 });
  assert.deepStrictEqual(viewOf(FULL, cam), FULL);
  assert.deepStrictEqual(viewBoxAttr(viewOf(FULL, cam)), '0 0 960 960');
  assert.deepStrictEqual(isZoomed(cam), false);
  assert.deepStrictEqual(isZoomed({ s: 2, cx: 480, cy: 480 }), true);
  const wrap = { x: -24, y: -24, w: 528, h: 528 };
  assert.deepStrictEqual(viewBoxAttr(viewOf(wrap, fitCamera(wrap))), '-24 -24 528 528');
});

test('camera: clamp keeps s in [1, smax] and the view inside the picture', () => {
  assert.deepStrictEqual(clampCamera(FULL, { s: 0.5, cx: 0, cy: 0 }, 4), {
    s: 1,
    cx: 480,
    cy: 480,
  });
  assert.deepStrictEqual(clampCamera(FULL, { s: 9, cx: 480, cy: 480 }, 4).s, 4);
  const corner = clampCamera(FULL, { s: 2, cx: -100, cy: 5000 }, 4);
  assert.deepStrictEqual(viewOf(FULL, corner), { x: 0, y: 480, w: 480, h: 480 });
  for (const s of [1, 1.3, 2, 3.7]) {
    for (const [cx, cy] of [
      [0, 0],
      [960, 960],
      [480, 100],
      [333, 777],
    ]) {
      const v = viewOf(FULL, clampCamera(FULL, { s, cx, cy }, 6));
      assert.ok(
        v.x >= -1e-9 && v.y >= -1e-9 && v.x + v.w <= 960 + 1e-9 && v.y + v.h <= 960 + 1e-9,
      );
    }
  }
});

test('camera: the limit is a cell of about 110 px, within [2, 6]', () => {
  assert.ok(1 < MIN_MAX_ZOOM && MIN_MAX_ZOOM <= MAX_ZOOM_CAP);
  assert.deepStrictEqual(maxZoom(22), 5); // 16x16 on a phone
  assert.deepStrictEqual(maxZoom(60), 2); // a cell that is big already
  assert.deepStrictEqual(maxZoom(5), 6);
  assert.deepStrictEqual(maxZoom(0), 2);
  assert.deepStrictEqual(maxZoom(NaN), 2);
});

test('camera: boardRect is the svg box at s = 1, and maps every pixel to the cell the old code found', () => {
  assert.deepStrictEqual(boardRect(BOX, FULL, fitCamera(FULL)), {
    left: 20,
    top: 100,
    width: 350,
    height: 350,
  });
  const n = 16;
  for (const cam of [
    { s: 1, cx: 480, cy: 480 },
    { s: 2, cx: 300, cy: 700 },
    { s: 3.3, cx: 100, cy: 100 },
    { s: 5, cx: 900, cy: 50 },
  ]) {
    const c = clampCamera(FULL, cam, 6);
    const rect = boardRect(BOX, FULL, c);
    for (let x = BOX.left; x < BOX.left + BOX.width; x += 13.7) {
      for (let y = BOX.top; y < BOX.top + BOX.height; y += 17.3) {
        const [bx, by] = boardPoint(BOX, FULL, c, x, y);
        const want = Math.floor(by / CELL) * n + Math.floor(bx / CELL);
        const got = cellAtPoint(n, x - rect.left, y - rect.top, rect.width, rect.height, 0, false);
        assert.deepStrictEqual(got, want, `s=${c.s} ${x},${y}`);
      }
    }
  }
});

test('camera: zoomAt keeps the spot at (fx, fy) of the box still, and the limits hold', () => {
  const cam = { s: 1.7, cx: 400, cy: 600 };
  for (const [fx, fy] of [
    [0.5, 0.5],
    [0.2, 0.8],
    [0.9, 0.1],
  ]) {
    const x = BOX.left + fx * BOX.width;
    const y = BOX.top + fy * BOX.height;
    const before = boardPoint(BOX, FULL, cam, x, y);
    const next = zoomAt(FULL, cam, 1.5, 6, fx, fy);
    assert.ok(near(next.s, 2.55));
    assert.ok(nearAll(boardPoint(BOX, FULL, next, x, y), before, 1e-6), `${fx},${fy}`);
  }
  assert.deepStrictEqual(zoomAt(FULL, { s: 5, cx: 480, cy: 480 }, 3, 6).s, 6);
  assert.deepStrictEqual(zoomAt(FULL, { s: 1.2, cx: 480, cy: 480 }, 0.1, 6), fitCamera(FULL));
  assert.ok(ZOOM_STEP > 1, 'a zoom step magnifies');
});

test('camera: panBy drags the picture with the finger (the point under it stays under it)', () => {
  const cam = clampCamera(FULL, { s: 3, cx: 500, cy: 500 }, 6);
  const [x, y] = [BOX.left + 100, BOX.top + 120];
  const before = boardPoint(BOX, FULL, cam, x, y);
  const next = panBy(FULL, cam, 6, BOX, 40, -25);
  assert.ok(nearAll(boardPoint(BOX, FULL, next, x + 40, y - 25), before));
  assert.deepStrictEqual(panBy(FULL, fitCamera(FULL), 6, BOX, 80, 80), fitCamera(FULL)); // not zoomed: nowhere to go
  const edge = panBy(FULL, cam, 6, BOX, 1e6, 1e6);
  assert.deepStrictEqual([viewOf(FULL, edge).x, viewOf(FULL, edge).y], [0, 0]);
});

test('camera: a pinch zooms by the ratio of the finger gaps and keeps the spot between the fingers', () => {
  const cam0 = fitCamera(FULL);
  const a0 = [BOX.left + 100, BOX.top + 150];
  const b0 = [BOX.left + 200, BOX.top + 150];
  const mid0 = [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2];
  const spot = boardPoint(BOX, FULL, cam0, mid0[0], mid0[1]);
  // apart by 1.6x, the middle moved by (30, -20)
  const a1 = [mid0[0] + 30 - 80, mid0[1] - 20];
  const b1 = [mid0[0] + 30 + 80, mid0[1] - 20];
  const next = pinchCamera(FULL, cam0, 6, BOX, [a0, b0], [a1, b1]);
  assert.ok(near(next.s, 1.6));
  assert.ok(nearAll(boardPoint(BOX, FULL, next, mid0[0] + 30, mid0[1] - 20), spot, 1e-6));
  assert.ok(
    nearCam(pinchCamera(FULL, cam0, 6, BOX, [a0, b0], [a0, b0]), cam0),
    'no move: no change',
  );
  assert.deepStrictEqual(
    pinchCamera(
      FULL,
      cam0,
      6,
      BOX,
      [a0, b0],
      [
        [0, 0],
        [1000, 0],
      ],
    ).s,
    6,
  ); // the limit
  assert.deepStrictEqual(
    pinchCamera(FULL, { s: 2, cx: 300, cy: 300 }, 6, BOX, [a0, b0], [a0, [a0[0] + 1, a0[1]]]).s,
    1,
  );
  // two fingers on one spot at the start: no zoom, no NaN
  const same = pinchCamera(FULL, cam0, 6, BOX, [a0, a0], [a1, b1]);
  assert.ok(Number.isFinite(same.cx) && same.s === 1);
});

test('camera: keepInView moves the view the least that puts the head inside the middle', () => {
  const cam = clampCamera(FULL, { s: 3, cx: 480, cy: 480 }, 6); // the view is 320 wide
  assert.ok(nearCam(keepInView(FULL, cam, 6, [480, 480]), cam), 'already there: no change');
  const right = keepInView(FULL, cam, 6, [600, 480], 0.2);
  const view = viewOf(FULL, right);
  assert.ok(near(view.x + 0.8 * view.w, 600), 'the head is at the inner edge');
  assert.deepStrictEqual(right.cy, cam.cy);
  const far = keepInView(FULL, cam, 6, [959, 959], 0.2);
  assert.ok(viewOf(FULL, far).x + viewOf(FULL, far).w <= 960 + 1e-9, 'still inside the picture');
  const left = keepInView(FULL, cam, 6, [10, 480], 0.2);
  assert.deepStrictEqual(viewOf(FULL, left).x, 0);
});

test('camera: the edge band scrolls: zero in the middle, signed at the edges, growing to the speed', () => {
  const mid = [BOX.left + BOX.width / 2, BOX.top + BOX.height / 2];
  assert.deepStrictEqual(edgeVelocity(mid[0], mid[1], BOX), [0, 0]);
  const band = EDGE_BAND * BOX.width;
  assert.deepStrictEqual(edgeVelocity(BOX.left + band + 1, mid[1], BOX), [0, 0]);
  const [vx] = edgeVelocity(BOX.left + band / 2, mid[1], BOX);
  assert.ok(near(vx, -EDGE_SPEED / 2), 'half way into the left band');
  assert.deepStrictEqual(edgeVelocity(BOX.left - 50, mid[1], BOX)[0], -EDGE_SPEED);
  assert.deepStrictEqual(edgeVelocity(BOX.left + BOX.width + 50, mid[1], BOX)[0], EDGE_SPEED);
  assert.deepStrictEqual(edgeVelocity(mid[0], BOX.top + 1, BOX)[1] < 0, true);
  assert.deepStrictEqual(edgeVelocity(mid[0], BOX.top + BOX.height - 1, BOX)[1] > 0, true);
  const cam = clampCamera(FULL, { s: 2, cx: 480, cy: 480 }, 6);
  const moved = drift(FULL, cam, 6, [0.5, 0], 0.5); // a quarter of the view (480 wide) = 120
  assert.ok(near(moved.cx, 600) && moved.cy === 480);
  assert.deepStrictEqual(drift(FULL, cam, 6, [100, 0], 1).cx, 720); // never past the picture
});

test('camera: blend goes from one camera to the other, evenly in s', () => {
  const a = { s: 1, cx: 480, cy: 480 };
  const b = { s: 4, cx: 200, cy: 300 };
  assert.deepStrictEqual(blend(a, b, 0), a);
  assert.ok(near(blend(a, b, 1).s, 4) && near(blend(a, b, 1).cx, 200));
  assert.ok(near(blend(a, b, 0.5).s, 2), 'half way is the geometric mean');
});

test('zoom board: no camera = the same picture as before; a camera writes its part into the viewBox', () => {
  const p = makePuzzle(5);
  p.cp[0] = 1;
  p.cp[24] = 2;
  const plain = boardSvg(state(p));
  assert.ok(plain.startsWith('<svg viewBox="0 0 300 300" class="zip-svg'), plain.slice(0, 60));
  assert.ok(!plain.includes('zoomed'));
  assert.deepStrictEqual(boardSvg(state(p, { cam: fitCamera(boardView(p)) })), plain);
  const zoomed = boardSvg(state(p, { cam: { s: 2, cx: 75, cy: 75 } }));
  assert.ok(
    zoomed.startsWith('<svg viewBox="0 0 150 150" class="zip-svg zoomed'),
    zoomed.slice(0, 70),
  );
  assert.deepStrictEqual(boardView(p), { x: 0, y: 0, w: 300, h: 300 });
  p.wrap = true;
  const wrapped = boardView(p);
  assert.ok(near(wrapped.x, -24) && near(wrapped.w, 348), JSON.stringify(wrapped));
});

test('zoom board: a pentagon board is zoomed the same way; the pointer maps through boardRect', () => {
  const p = runSync(generatePentagon(6, 3));
  const full = pentagonView(p);
  assert.deepStrictEqual(fullViewOf(p), full);
  assert.ok(pentagonBoardSvg(state(p)).includes(`viewBox="${viewBoxAttr(full)}"`));
  const cam = clampCamera(
    full,
    { s: 2.4, cx: full.x + 0.3 * full.w, cy: full.y + 0.6 * full.h },
    6,
  );
  const svg = pentagonBoardSvg(state(p, { cam }));
  assert.ok(
    svg.includes(`viewBox="${viewBoxAttr(viewOf(full, cam))}"`) && svg.includes(' zoomed"'),
  );
  const box = { left: 10, top: 20, width: 300, height: (300 * full.h) / full.w };
  const rect = boardRect(box, full, cam);
  for (let x = box.left; x < box.left + box.width; x += 21) {
    for (let y = box.top; y < box.top + box.height; y += 19) {
      const viaRect = pentagonPoint(p, rect, x, y);
      assert.ok(nearAll(viaRect, boardPoint(box, full, cam, x, y), 1e-6), `${x},${y}`);
      assert.deepStrictEqual(
        pentagonCellAt(p, ...viaRect),
        pentagonCellAt(p, ...boardPoint(box, full, cam, x, y)),
      );
    }
  }
  const c = cellPoint(p, 0);
  assert.ok(c.length === 2 && Number.isFinite(c[0]));
});

test('zoom board: the centre of a cell of a square board', () => {
  const p = makePuzzle(7);
  assert.deepStrictEqual(cellPoint(p, 0), [30, 30]);
  assert.deepStrictEqual(cellPoint(p, 8), [90, 90]);
});

test('zoom map: the overview has the whole picture, a dot per checkpoint and the paths', () => {
  const p = makePuzzle(12);
  p.cp[0] = 1;
  p.cp[50] = 2;
  p.cp[143] = 3;
  const html = zoomMapHtml(state(p, { path: [0, 1, 2, 14], finished: false }));
  assert.ok(html.includes('id="zoomMap" hidden'), 'drawn hidden');
  assert.ok(html.includes('viewBox="0 0 720 720"'), 'the whole picture');
  assert.deepStrictEqual((html.match(/<circle /g) ?? []).length, 3, 'a dot per checkpoint');
  assert.ok(
    html.includes('<path data-colour="0" d="M30 30'),
    'the path starts at the middle of cell 0',
  );
  assert.ok(html.includes(`width:${MAP_PX}px`), 'its size');
  const none = zoomMapHtml(state(p, { path: [], finished: false }));
  assert.ok(none.includes('d=""'), 'no path, no line');
  const two = makePuzzle(8);
  two.split = true;
  two.cp[0] = 1;
  const both = zoomMapHtml(
    state(two, {
      path: [],
      paths: [
        [0, 1],
        [9, 10],
      ],
      finished: false,
    }),
  );
  assert.deepStrictEqual(
    (both.match(/<path data-colour=/g) ?? []).length,
    2,
    'one line per colour',
  );
});

test('zoom texts: English and Chinese have the same keys', () => {
  for (const key of ['zoom.in', 'zoom.out', 'zoom.fit', 'zoom.pan', 'zoom.map', 'zoom.hint']) {
    assert.ok(typeof EN[key] === 'string' && typeof ZH[key] === 'string', key);
  }
});

test('zoom solid: a head, or a cell it can step to, that is out of the zoomed view counts as turned away', () => {
  const top = surfaceTopology('cube', 3);
  const layout = buildView(top, orbit(IDENTITY, 0.6, 0.5));
  const heads = [...Array(top.T).keys()].filter(c => !headTurnedAway(top, layout, [c], false));
  assert.ok(heads.length > 0, 'a corner view has cells that see only visible cells');
  const head = heads[0];
  const next = [...Array(top.deg[head]).keys()].map(k => top.nb[head * SLOTS + k]);
  const far = [...Array(top.T).keys()].find(c => c !== head && !next.includes(c));
  assert.deepStrictEqual(
    headTurnedAway(top, layout, [head], false, () => false),
    false,
    'no zoom: as before',
  );
  assert.deepStrictEqual(
    headTurnedAway(top, layout, [head], false, c => c === head),
    true,
    'the head is out',
  );
  assert.deepStrictEqual(
    headTurnedAway(top, layout, [head], false, c => c === next[0]),
    true,
    'a next cell is out',
  );
  assert.deepStrictEqual(
    headTurnedAway(top, layout, [head], false, c => c === far),
    false,
    'a far cell is not asked',
  );
  assert.deepStrictEqual(
    headTurnedAway(top, layout, [head, next[0]], false, c => c === head),
    false,
    'passed cells',
  );
});

// ---------------- the router ----------------
const ev = (id, type, x, y, extra = {}) => ({ id, type, x, y, button: 0, ...extra });
const kinds = list => list.map(a => a.do);

test('gesture: a mouse or pen draws at once; another button pans', () => {
  const r = createRouter();
  assert.deepStrictEqual(r.down(ev(1, 'mouse', 5, 6)), [{ do: 'draw-start', x: 5, y: 6 }]);
  assert.deepStrictEqual(r.move(ev(1, 'mouse', 9, 9)), [{ do: 'draw-move', x: 9, y: 9 }]);
  assert.deepStrictEqual(r.up(ev(1, 'mouse', 9, 9)), [{ do: 'draw-end' }]);
  assert.deepStrictEqual(r.mode(), 'idle');
  assert.deepStrictEqual(r.move(ev(1, 'mouse', 9, 9)), [], 'a hover is nothing');
  assert.deepStrictEqual(kinds(r.down(ev(2, 'pen', 1, 1))), ['draw-start']);
  r.up(ev(2, 'pen', 1, 1));
  assert.deepStrictEqual(r.down(ev(3, 'mouse', 10, 10, { button: 2 })), [{ do: 'pan-start' }]);
  assert.deepStrictEqual(r.move(ev(3, 'mouse', 14, 7)), [{ do: 'pan-move', dx: 4, dy: -3 }]);
  assert.deepStrictEqual(r.move(ev(3, 'mouse', 15, 7)), [{ do: 'pan-move', dx: 1, dy: 0 }]);
  assert.deepStrictEqual(r.up(ev(3, 'mouse', 15, 7)), [{ do: 'pan-end' }]);
  assert.deepStrictEqual(r.mode(), 'idle');
});

test('gesture: a touch waits; a tap draws its step when lifted', () => {
  const r = createRouter();
  assert.deepStrictEqual(r.down(ev(1, 'touch', 50, 60)), [{ do: 'timer', ms: 70 }]);
  assert.deepStrictEqual(r.mode(), 'pending');
  assert.deepStrictEqual(r.up(ev(1, 'touch', 50, 60)), [
    { do: 'timer-clear' },
    { do: 'draw-start', x: 50, y: 60 },
    { do: 'draw-end' },
  ]);
  assert.deepStrictEqual(r.mode(), 'idle');
});

test('gesture: a touch that moves past the slop draws from where it went down', () => {
  const r = createRouter();
  r.down(ev(1, 'touch', 50, 60));
  assert.deepStrictEqual(r.move(ev(1, 'touch', 50 + COMMIT_SLOP, 60)), [], 'within the slop');
  assert.deepStrictEqual(r.move(ev(1, 'touch', 50, 60 + COMMIT_SLOP + 1)), [
    { do: 'timer-clear' },
    { do: 'draw-start', x: 50, y: 60 },
    { do: 'draw-move', x: 50, y: 65 },
  ]);
  assert.deepStrictEqual(r.move(ev(1, 'touch', 52, 70)), [{ do: 'draw-move', x: 52, y: 70 }]);
  assert.deepStrictEqual(r.timeout(), [], 'the timer is of no use any more');
  assert.deepStrictEqual(r.up(ev(1, 'touch', 52, 70)), [{ do: 'draw-end' }]);
});

test('gesture: a touch that stays put draws when the timer runs out', () => {
  const r = createRouter();
  r.down(ev(1, 'touch', 7, 8));
  assert.deepStrictEqual(r.timeout(), [{ do: 'timer-clear' }, { do: 'draw-start', x: 7, y: 8 }]);
  assert.deepStrictEqual(r.mode(), 'draw');
  assert.deepStrictEqual(r.move(ev(1, 'touch', 9, 8)), [{ do: 'draw-move', x: 9, y: 8 }]);
  assert.deepStrictEqual(kinds(r.up(ev(1, 'touch', 9, 8))), ['draw-end']);
});

test('gesture: a second finger before the commit is a pinch, and nothing was drawn', () => {
  const r = createRouter();
  r.down(ev(1, 'touch', 100, 100));
  assert.deepStrictEqual(r.down(ev(2, 'touch', 200, 100)), [
    { do: 'timer-clear' },
    { do: 'gesture-start', a: [100, 100], b: [200, 100] },
  ]);
  assert.deepStrictEqual(r.mode(), 'gesture');
  assert.deepStrictEqual(r.move(ev(1, 'touch', 80, 100)), [
    { do: 'gesture-move', a: [80, 100], b: [200, 100] },
  ]);
  assert.deepStrictEqual(r.move(ev(2, 'touch', 230, 110)), [
    { do: 'gesture-move', a: [80, 100], b: [230, 110] },
  ]);
  assert.deepStrictEqual(r.timeout(), []);
  assert.deepStrictEqual(r.up(ev(1, 'touch', 80, 100)), [{ do: 'gesture-end' }]);
  assert.deepStrictEqual(r.mode(), 'spent');
  assert.deepStrictEqual(
    r.move(ev(2, 'touch', 231, 111)),
    [],
    'the finger left over draws nothing',
  );
  assert.deepStrictEqual(r.up(ev(2, 'touch', 231, 111)), []);
  assert.deepStrictEqual(r.mode(), 'idle');
  assert.deepStrictEqual(
    r.down(ev(3, 'touch', 1, 1)),
    [{ do: 'timer', ms: 70 }],
    'and a new press starts afresh',
  );
});

test('gesture: a second finger while the first draws is ignored; the drawing goes on', () => {
  const r = createRouter();
  r.down(ev(1, 'touch', 10, 10));
  r.move(ev(1, 'touch', 30, 10));
  assert.deepStrictEqual(r.mode(), 'draw');
  assert.deepStrictEqual(r.down(ev(2, 'touch', 200, 200)), []);
  assert.deepStrictEqual(r.move(ev(2, 'touch', 210, 200)), []);
  assert.deepStrictEqual(r.move(ev(1, 'touch', 40, 10)), [{ do: 'draw-move', x: 40, y: 10 }]);
  assert.deepStrictEqual(r.up(ev(1, 'touch', 40, 10)), [{ do: 'draw-end' }]);
  assert.deepStrictEqual(r.mode(), 'spent');
  assert.deepStrictEqual(r.move(ev(2, 'touch', 220, 200)), []);
  r.up(ev(2, 'touch', 220, 200));
  assert.deepStrictEqual(r.mode(), 'idle');
});

test('gesture: a cancelled touch draws nothing; a third finger and repeated events change nothing', () => {
  const r = createRouter();
  r.down(ev(1, 'touch', 10, 10));
  assert.deepStrictEqual(r.up(ev(1, 'touch', 10, 10, { cancel: true })), [{ do: 'timer-clear' }]);
  assert.deepStrictEqual(r.mode(), 'idle');
  r.down(ev(1, 'touch', 10, 10));
  r.down(ev(2, 'touch', 50, 10));
  assert.deepStrictEqual(r.down(ev(3, 'touch', 90, 10)), [], 'a third finger');
  assert.deepStrictEqual(r.down(ev(2, 'touch', 50, 10)), [], 'the same pointer twice');
  assert.deepStrictEqual(r.up(ev(9, 'touch', 0, 0)), [], 'a pointer that was never down');
  assert.deepStrictEqual(kinds(r.move(ev(3, 'touch', 95, 10))), [], 'not one of the two');
  r.up(ev(1, 'touch', 10, 10));
  r.up(ev(2, 'touch', 50, 10));
  assert.deepStrictEqual(r.mode(), 'spent');
  r.up(ev(3, 'touch', 90, 10));
  assert.deepStrictEqual(r.mode(), 'idle');
});

test('gesture: in pan mode every press pans (a mouse, a finger); a second finger pinches', () => {
  let panning = true;
  const r = createRouter({ pan: () => panning });
  assert.deepStrictEqual(r.down(ev(1, 'mouse', 10, 10)), [{ do: 'pan-start' }]);
  assert.deepStrictEqual(r.move(ev(1, 'mouse', 13, 14)), [{ do: 'pan-move', dx: 3, dy: 4 }]);
  assert.deepStrictEqual(r.up(ev(1, 'mouse', 13, 14)), [{ do: 'pan-end' }]);
  assert.deepStrictEqual(
    r.down(ev(2, 'touch', 50, 50)),
    [{ do: 'pan-start' }],
    'no wait for a touch',
  );
  assert.deepStrictEqual(r.move(ev(2, 'touch', 40, 50)), [{ do: 'pan-move', dx: -10, dy: 0 }]);
  assert.deepStrictEqual(r.down(ev(3, 'touch', 150, 50)), [
    { do: 'pan-end' },
    { do: 'gesture-start', a: [40, 50], b: [150, 50] },
  ]);
  assert.deepStrictEqual(r.move(ev(3, 'touch', 170, 50)), [
    { do: 'gesture-move', a: [40, 50], b: [170, 50] },
  ]);
  r.up(ev(2, 'touch', 40, 50));
  r.up(ev(3, 'touch', 170, 50));
  assert.deepStrictEqual(r.mode(), 'idle');
  panning = false;
  assert.deepStrictEqual(
    r.down(ev(4, 'touch', 1, 1)),
    [{ do: 'timer', ms: 70 }],
    'out of pan mode a touch waits',
  );
});

test('gesture: two fingers on a solid are a pinch or a drag together, called once both have moved', () => {
  const start = [
    [100, 100],
    [160, 100],
  ];
  // the events come one finger at a time: a lone finger that moved is not yet a pinch
  assert.deepStrictEqual(
    classifyPair(start, [
      [100, 100],
      [160, 100],
    ]),
    null,
    'nothing moved',
  );
  assert.deepStrictEqual(
    classifyPair(start, [
      [120, 100],
      [160, 100],
    ]),
    null,
    'one finger, a little',
  );
  assert.deepStrictEqual(FINGER_MOVED < ANCHOR_MOVE, true);
  // together to the right (one finger ahead of the other)
  assert.deepStrictEqual(
    classifyPair(start, [
      [120, 100],
      [165, 100],
    ]),
    'turn',
  );
  assert.deepStrictEqual(
    classifyPair(start, [
      [120, 108],
      [180, 108],
    ]),
    'turn',
  );
  // apart / together
  assert.deepStrictEqual(
    classifyPair(start, [
      [90, 100],
      [170, 100],
    ]),
    'zoom',
  );
  assert.deepStrictEqual(
    classifyPair(start, [
      [110, 100],
      [150, 100],
    ]),
    'zoom',
  );
  // a pinch about a finger that stays: once the other has gone far
  assert.deepStrictEqual(
    classifyPair(start, [
      [100, 100],
      [180, 100],
    ]),
    null,
  );
  assert.deepStrictEqual(
    classifyPair(start, [
      [100, 100],
      [160 + ANCHOR_MOVE, 100],
    ]),
    'zoom',
  );
  // across each other (a twist): nothing until it is clear
  assert.deepStrictEqual(
    classifyPair(start, [
      [100, 104],
      [160, 96],
    ]),
    null,
  );
});

test('gesture: a touch while a mouse button is down is ignored', () => {
  const r = createRouter();
  r.down(ev(1, 'mouse', 10, 10));
  assert.deepStrictEqual(r.down(ev(2, 'touch', 50, 50)), []);
  assert.deepStrictEqual(r.move(ev(1, 'mouse', 12, 10)), [{ do: 'draw-move', x: 12, y: 10 }]);
});
