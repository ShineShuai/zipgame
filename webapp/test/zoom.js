// Tests of the zoom of the play board: the camera math (view/camera.js), the router that decides
// who gets the fingers (apps/play/gesture.js), and what the board markup does with the camera.
// The page itself (apps/play/zoom.js, grid-input.js) needs a browser and is not run here.
// Registered by tests.js: zoomTests(t, ok, eq).
import { makePuzzle } from '../src/core/model.js';
import { runSync } from '../src/core/run.js';
import { generatePentagon } from '../src/core/gen/pentagon.js';
import { cellAtPoint } from '../src/view/geometry.js';
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
} from '../src/view/camera.js';
import { COMMIT_SLOP, createRouter } from '../src/apps/play/gesture.js';
import { CELL, boardSvg, boardView } from '../src/apps/play/board.js';
import {
  pentagonBoardSvg, pentagonCellAt, pentagonPoint, pentagonView,
} from '../src/apps/play/pentagon-board.js';
import { cellPoint, fullViewOf } from '../src/apps/play/puzzle-kit.js';
import { EN, ZH } from '../src/ui/i18n.js';

const FULL = { x: 0, y: 0, w: 960, h: 960 }; // a 16x16 board
const BOX = { left: 20, top: 100, width: 350, height: 350 }; // the svg on a phone
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const nearAll = (a, b, eps = 1e-6) => a.every((v, i) => near(v, b[i], eps));
const nearCam = (a, b) => nearAll([a.s, a.cx, a.cy], [b.s, b.cx, b.cy]);
const state = (p, extra = {}) => ({
  puzzle: p, path: [], paths: [[], []], hintCell: null, hintWrongCell: null, ...extra,
});

export function zoomTests(t, ok, eq) {
  t('camera: fit shows the whole picture; the viewBox of s = 1 is the full view box', () => {
    const cam = fitCamera(FULL);
    eq(cam, { s: 1, cx: 480, cy: 480 });
    eq(viewOf(FULL, cam), FULL);
    eq(viewBoxAttr(viewOf(FULL, cam)), '0 0 960 960');
    eq(isZoomed(cam), false);
    eq(isZoomed({ s: 2, cx: 480, cy: 480 }), true);
    const wrap = { x: -24, y: -24, w: 528, h: 528 };
    eq(viewBoxAttr(viewOf(wrap, fitCamera(wrap))), '-24 -24 528 528');
  });

  t('camera: clamp keeps s in [1, smax] and the view inside the picture', () => {
    eq(clampCamera(FULL, { s: 0.5, cx: 0, cy: 0 }, 4), { s: 1, cx: 480, cy: 480 });
    eq(clampCamera(FULL, { s: 9, cx: 480, cy: 480 }, 4).s, 4);
    const corner = clampCamera(FULL, { s: 2, cx: -100, cy: 5000 }, 4);
    eq(viewOf(FULL, corner), { x: 0, y: 480, w: 480, h: 480 });
    for (const s of [1, 1.3, 2, 3.7]) {
      for (const [cx, cy] of [[0, 0], [960, 960], [480, 100], [333, 777]]) {
        const v = viewOf(FULL, clampCamera(FULL, { s, cx, cy }, 6));
        ok(v.x >= -1e-9 && v.y >= -1e-9 && v.x + v.w <= 960 + 1e-9 && v.y + v.h <= 960 + 1e-9);
      }
    }
  });

  t('camera: the limit is a cell of about 110 px, within [2, 6]', () => {
    eq([MIN_MAX_ZOOM, MAX_ZOOM_CAP], [2, 6]);
    eq(maxZoom(22), 5); // 16x16 on a phone
    eq(maxZoom(60), 2); // a cell that is big already
    eq(maxZoom(5), 6);
    eq(maxZoom(0), 2);
    eq(maxZoom(NaN), 2);
  });

  t('camera: boardRect is the svg box at s = 1, and maps every pixel to the cell the old code found', () => {
    eq(boardRect(BOX, FULL, fitCamera(FULL)), { left: 20, top: 100, width: 350, height: 350 });
    const n = 16;
    for (const cam of [
      { s: 1, cx: 480, cy: 480 }, { s: 2, cx: 300, cy: 700 }, { s: 3.3, cx: 100, cy: 100 },
      { s: 5, cx: 900, cy: 50 },
    ]) {
      const c = clampCamera(FULL, cam, 6);
      const rect = boardRect(BOX, FULL, c);
      for (let x = BOX.left; x < BOX.left + BOX.width; x += 13.7) {
        for (let y = BOX.top; y < BOX.top + BOX.height; y += 17.3) {
          const [bx, by] = boardPoint(BOX, FULL, c, x, y);
          const want = Math.floor(by / CELL) * n + Math.floor(bx / CELL);
          const got = cellAtPoint(n, x - rect.left, y - rect.top, rect.width, rect.height, 0, false);
          eq(got, want, `s=${c.s} ${x},${y}`);
        }
      }
    }
  });

  t('camera: zoomAt keeps the spot at (fx, fy) of the box still, and the limits hold', () => {
    const cam = { s: 1.7, cx: 400, cy: 600 };
    for (const [fx, fy] of [[0.5, 0.5], [0.2, 0.8], [0.9, 0.1]]) {
      const x = BOX.left + fx * BOX.width;
      const y = BOX.top + fy * BOX.height;
      const before = boardPoint(BOX, FULL, cam, x, y);
      const next = zoomAt(FULL, cam, 1.5, 6, fx, fy);
      ok(near(next.s, 2.55));
      ok(nearAll(boardPoint(BOX, FULL, next, x, y), before, 1e-6), `${fx},${fy}`);
    }
    eq(zoomAt(FULL, { s: 5, cx: 480, cy: 480 }, 3, 6).s, 6);
    eq(zoomAt(FULL, { s: 1.2, cx: 480, cy: 480 }, 0.1, 6), fitCamera(FULL));
    eq(ZOOM_STEP, 1.5);
  });

  t('camera: panBy drags the picture with the finger (the point under it stays under it)', () => {
    const cam = clampCamera(FULL, { s: 3, cx: 500, cy: 500 }, 6);
    const [x, y] = [BOX.left + 100, BOX.top + 120];
    const before = boardPoint(BOX, FULL, cam, x, y);
    const next = panBy(FULL, cam, 6, BOX, 40, -25);
    ok(nearAll(boardPoint(BOX, FULL, next, x + 40, y - 25), before));
    eq(panBy(FULL, fitCamera(FULL), 6, BOX, 80, 80), fitCamera(FULL)); // not zoomed: nowhere to go
    const edge = panBy(FULL, cam, 6, BOX, 1e6, 1e6);
    eq([viewOf(FULL, edge).x, viewOf(FULL, edge).y], [0, 0]);
  });

  t('camera: a pinch zooms by the ratio of the finger gaps and keeps the spot between the fingers', () => {
    const cam0 = fitCamera(FULL);
    const a0 = [BOX.left + 100, BOX.top + 150];
    const b0 = [BOX.left + 200, BOX.top + 150];
    const mid0 = [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2];
    const spot = boardPoint(BOX, FULL, cam0, mid0[0], mid0[1]);
    // apart by 1.6x, the middle moved by (30, -20)
    const a1 = [mid0[0] + 30 - 80, mid0[1] - 20];
    const b1 = [mid0[0] + 30 + 80, mid0[1] - 20];
    const next = pinchCamera(FULL, cam0, 6, BOX, [a0, b0], [a1, b1]);
    ok(near(next.s, 1.6));
    ok(nearAll(boardPoint(BOX, FULL, next, mid0[0] + 30, mid0[1] - 20), spot, 1e-6));
    ok(nearCam(pinchCamera(FULL, cam0, 6, BOX, [a0, b0], [a0, b0]), cam0), 'no move: no change');
    eq(pinchCamera(FULL, cam0, 6, BOX, [a0, b0], [[0, 0], [1000, 0]]).s, 6); // the limit
    eq(pinchCamera(FULL, { s: 2, cx: 300, cy: 300 }, 6, BOX, [a0, b0], [a0, [a0[0] + 1, a0[1]]]).s, 1);
    // two fingers on one spot at the start: no zoom, no NaN
    const same = pinchCamera(FULL, cam0, 6, BOX, [a0, a0], [a1, b1]);
    ok(Number.isFinite(same.cx) && same.s === 1);
  });

  t('camera: keepInView moves the view the least that puts the head inside the middle', () => {
    const cam = clampCamera(FULL, { s: 3, cx: 480, cy: 480 }, 6); // the view is 320 wide
    ok(nearCam(keepInView(FULL, cam, 6, [480, 480]), cam), 'already there: no change');
    const right = keepInView(FULL, cam, 6, [600, 480], 0.2);
    const view = viewOf(FULL, right);
    ok(near(view.x + 0.8 * view.w, 600), 'the head is at the inner edge');
    eq(right.cy, cam.cy);
    const far = keepInView(FULL, cam, 6, [959, 959], 0.2);
    ok(viewOf(FULL, far).x + viewOf(FULL, far).w <= 960 + 1e-9, 'still inside the picture');
    const left = keepInView(FULL, cam, 6, [10, 480], 0.2);
    eq(viewOf(FULL, left).x, 0);
  });

  t('camera: the edge band scrolls: zero in the middle, signed at the edges, growing to the speed', () => {
    const mid = [BOX.left + BOX.width / 2, BOX.top + BOX.height / 2];
    eq(edgeVelocity(mid[0], mid[1], BOX), [0, 0]);
    const band = EDGE_BAND * BOX.width;
    eq(edgeVelocity(BOX.left + band + 1, mid[1], BOX), [0, 0]);
    const [vx] = edgeVelocity(BOX.left + band / 2, mid[1], BOX);
    ok(near(vx, -EDGE_SPEED / 2), 'half way into the left band');
    eq(edgeVelocity(BOX.left - 50, mid[1], BOX)[0], -EDGE_SPEED);
    eq(edgeVelocity(BOX.left + BOX.width + 50, mid[1], BOX)[0], EDGE_SPEED);
    eq(edgeVelocity(mid[0], BOX.top + 1, BOX)[1] < 0, true);
    eq(edgeVelocity(mid[0], BOX.top + BOX.height - 1, BOX)[1] > 0, true);
    const cam = clampCamera(FULL, { s: 2, cx: 480, cy: 480 }, 6);
    const moved = drift(FULL, cam, 6, [0.5, 0], 0.5); // a quarter of the view (480 wide) = 120
    ok(near(moved.cx, 600) && moved.cy === 480);
    eq(drift(FULL, cam, 6, [100, 0], 1).cx, 720); // never past the picture
  });

  t('camera: blend goes from one camera to the other, evenly in s', () => {
    const a = { s: 1, cx: 480, cy: 480 };
    const b = { s: 4, cx: 200, cy: 300 };
    eq(blend(a, b, 0), a);
    ok(near(blend(a, b, 1).s, 4) && near(blend(a, b, 1).cx, 200));
    ok(near(blend(a, b, 0.5).s, 2), 'half way is the geometric mean');
  });

  t('zoom board: no camera = the same picture as before; a camera writes its part into the viewBox', () => {
    const p = makePuzzle(5);
    p.cp[0] = 1;
    p.cp[24] = 2;
    const plain = boardSvg(state(p));
    ok(plain.startsWith('<svg viewBox="0 0 300 300" class="zip-svg'), plain.slice(0, 60));
    ok(!plain.includes('zoomed'));
    eq(boardSvg(state(p, { cam: fitCamera(boardView(p)) })), plain);
    const zoomed = boardSvg(state(p, { cam: { s: 2, cx: 75, cy: 75 } }));
    ok(zoomed.startsWith('<svg viewBox="0 0 150 150" class="zip-svg zoomed'), zoomed.slice(0, 70));
    eq(boardView(p), { x: 0, y: 0, w: 300, h: 300 });
    p.wrap = true;
    const wrapped = boardView(p);
    ok(near(wrapped.x, -24) && near(wrapped.w, 348), JSON.stringify(wrapped));
  });

  t('zoom board: a pentagon board is zoomed the same way; the pointer maps through boardRect', () => {
    const p = runSync(generatePentagon(6, 3));
    const full = pentagonView(p);
    eq(fullViewOf(p), full);
    ok(pentagonBoardSvg(state(p)).includes(`viewBox="${viewBoxAttr(full)}"`));
    const cam = clampCamera(full, { s: 2.4, cx: full.x + 0.3 * full.w, cy: full.y + 0.6 * full.h }, 6);
    const svg = pentagonBoardSvg(state(p, { cam }));
    ok(svg.includes(`viewBox="${viewBoxAttr(viewOf(full, cam))}"`) && svg.includes(' zoomed"'));
    const box = { left: 10, top: 20, width: 300, height: (300 * full.h) / full.w };
    const rect = boardRect(box, full, cam);
    for (let x = box.left; x < box.left + box.width; x += 21) {
      for (let y = box.top; y < box.top + box.height; y += 19) {
        const viaRect = pentagonPoint(p, rect, x, y);
        ok(nearAll(viaRect, boardPoint(box, full, cam, x, y), 1e-6), `${x},${y}`);
        eq(pentagonCellAt(p, ...viaRect), pentagonCellAt(p, ...boardPoint(box, full, cam, x, y)));
      }
    }
    const c = cellPoint(p, 0);
    ok(c.length === 2 && Number.isFinite(c[0]));
  });

  t('zoom board: the centre of a cell of a square board', () => {
    const p = makePuzzle(7);
    eq(cellPoint(p, 0), [30, 30]);
    eq(cellPoint(p, 8), [90, 90]);
  });

  t('zoom texts: English and Chinese have the same keys', () => {
    for (const key of ['zoom.in', 'zoom.out', 'zoom.fit', 'zoom.hint']) {
      ok(typeof EN[key] === 'string' && typeof ZH[key] === 'string', key);
    }
  });

  // ---------------- the router ----------------
  const ev = (id, type, x, y, extra = {}) => ({ id, type, x, y, button: 0, ...extra });
  const kinds = list => list.map(a => a.do);

  t('gesture: a mouse or pen draws at once; another button pans', () => {
    const r = createRouter();
    eq(r.down(ev(1, 'mouse', 5, 6)), [{ do: 'draw-start', x: 5, y: 6 }]);
    eq(r.move(ev(1, 'mouse', 9, 9)), [{ do: 'draw-move', x: 9, y: 9 }]);
    eq(r.up(ev(1, 'mouse', 9, 9)), [{ do: 'draw-end' }]);
    eq(r.mode(), 'idle');
    eq(r.move(ev(1, 'mouse', 9, 9)), [], 'a hover is nothing');
    eq(kinds(r.down(ev(2, 'pen', 1, 1))), ['draw-start']);
    r.up(ev(2, 'pen', 1, 1));
    eq(r.down(ev(3, 'mouse', 10, 10, { button: 2 })), [{ do: 'pan-start' }]);
    eq(r.move(ev(3, 'mouse', 14, 7)), [{ do: 'pan-move', dx: 4, dy: -3 }]);
    eq(r.move(ev(3, 'mouse', 15, 7)), [{ do: 'pan-move', dx: 1, dy: 0 }]);
    eq(r.up(ev(3, 'mouse', 15, 7)), [{ do: 'pan-end' }]);
    eq(r.mode(), 'idle');
  });

  t('gesture: a touch waits; a tap draws its step when lifted', () => {
    const r = createRouter();
    eq(r.down(ev(1, 'touch', 50, 60)), [{ do: 'timer', ms: 70 }]);
    eq(r.mode(), 'pending');
    eq(r.up(ev(1, 'touch', 50, 60)), [
      { do: 'timer-clear' }, { do: 'draw-start', x: 50, y: 60 }, { do: 'draw-end' },
    ]);
    eq(r.mode(), 'idle');
  });

  t('gesture: a touch that moves past the slop draws from where it went down', () => {
    const r = createRouter();
    r.down(ev(1, 'touch', 50, 60));
    eq(r.move(ev(1, 'touch', 50 + COMMIT_SLOP, 60)), [], 'within the slop');
    eq(r.move(ev(1, 'touch', 50, 60 + COMMIT_SLOP + 1)), [
      { do: 'timer-clear' },
      { do: 'draw-start', x: 50, y: 60 },
      { do: 'draw-move', x: 50, y: 65 },
    ]);
    eq(r.move(ev(1, 'touch', 52, 70)), [{ do: 'draw-move', x: 52, y: 70 }]);
    eq(r.timeout(), [], 'the timer is of no use any more');
    eq(r.up(ev(1, 'touch', 52, 70)), [{ do: 'draw-end' }]);
  });

  t('gesture: a touch that stays put draws when the timer runs out', () => {
    const r = createRouter();
    r.down(ev(1, 'touch', 7, 8));
    eq(r.timeout(), [{ do: 'timer-clear' }, { do: 'draw-start', x: 7, y: 8 }]);
    eq(r.mode(), 'draw');
    eq(r.move(ev(1, 'touch', 9, 8)), [{ do: 'draw-move', x: 9, y: 8 }]);
    eq(kinds(r.up(ev(1, 'touch', 9, 8))), ['draw-end']);
  });

  t('gesture: a second finger before the commit is a pinch, and nothing was drawn', () => {
    const r = createRouter();
    r.down(ev(1, 'touch', 100, 100));
    eq(r.down(ev(2, 'touch', 200, 100)), [
      { do: 'timer-clear' }, { do: 'gesture-start', a: [100, 100], b: [200, 100] },
    ]);
    eq(r.mode(), 'gesture');
    eq(r.move(ev(1, 'touch', 80, 100)), [{ do: 'gesture-move', a: [80, 100], b: [200, 100] }]);
    eq(r.move(ev(2, 'touch', 230, 110)), [{ do: 'gesture-move', a: [80, 100], b: [230, 110] }]);
    eq(r.timeout(), []);
    eq(r.up(ev(1, 'touch', 80, 100)), [{ do: 'gesture-end' }]);
    eq(r.mode(), 'spent');
    eq(r.move(ev(2, 'touch', 231, 111)), [], 'the finger left over draws nothing');
    eq(r.up(ev(2, 'touch', 231, 111)), []);
    eq(r.mode(), 'idle');
    eq(r.down(ev(3, 'touch', 1, 1)), [{ do: 'timer', ms: 70 }], 'and a new press starts afresh');
  });

  t('gesture: a second finger while the first draws is ignored; the drawing goes on', () => {
    const r = createRouter();
    r.down(ev(1, 'touch', 10, 10));
    r.move(ev(1, 'touch', 30, 10));
    eq(r.mode(), 'draw');
    eq(r.down(ev(2, 'touch', 200, 200)), []);
    eq(r.move(ev(2, 'touch', 210, 200)), []);
    eq(r.move(ev(1, 'touch', 40, 10)), [{ do: 'draw-move', x: 40, y: 10 }]);
    eq(r.up(ev(1, 'touch', 40, 10)), [{ do: 'draw-end' }]);
    eq(r.mode(), 'spent');
    eq(r.move(ev(2, 'touch', 220, 200)), []);
    r.up(ev(2, 'touch', 220, 200));
    eq(r.mode(), 'idle');
  });

  t('gesture: a cancelled touch draws nothing; a third finger and repeated events change nothing', () => {
    const r = createRouter();
    r.down(ev(1, 'touch', 10, 10));
    eq(r.up(ev(1, 'touch', 10, 10, { cancel: true })), [{ do: 'timer-clear' }]);
    eq(r.mode(), 'idle');
    r.down(ev(1, 'touch', 10, 10));
    r.down(ev(2, 'touch', 50, 10));
    eq(r.down(ev(3, 'touch', 90, 10)), [], 'a third finger');
    eq(r.down(ev(2, 'touch', 50, 10)), [], 'the same pointer twice');
    eq(r.up(ev(9, 'touch', 0, 0)), [], 'a pointer that was never down');
    eq(kinds(r.move(ev(3, 'touch', 95, 10))), [], 'not one of the two');
    r.up(ev(1, 'touch', 10, 10));
    r.up(ev(2, 'touch', 50, 10));
    eq(r.mode(), 'spent');
    r.up(ev(3, 'touch', 90, 10));
    eq(r.mode(), 'idle');
  });

  t('gesture: a touch while a mouse button is down is ignored', () => {
    const r = createRouter();
    r.down(ev(1, 'mouse', 10, 10));
    eq(r.down(ev(2, 'touch', 50, 50)), []);
    eq(r.move(ev(1, 'mouse', 12, 10)), [{ do: 'draw-move', x: 12, y: 10 }]);
  });
}
