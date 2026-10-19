// Tests of the ball view (view/ball.js) and its drawing (apps/design/surface-board.js): the
// outlines of the cells tile the disc of the ball in every view, a point of the picture is in the
// cell the exact test gives, marks and routes stay in front, and the markup is complete.
// Registered by tests.js: ballViewTests(t, ok, eq).
import { BALL_CATALOG } from '../src/core/surface/ball-catalog.js';
import { registerBalls } from '../src/core/surface/ball-registry.js';
import { BALL_KIND, SLOTS, surfaceTopology } from '../src/core/surface/topology.js';
import { makeSurfacePuzzle } from '../src/core/surface/puzzle.js';
import { generateSurface } from '../src/core/surface/gen.js';
import { behind, buildBallView, directionCell, frontOf } from '../src/view/ball.js';
import { IDENTITY, cellDirection, orbit, overview, turn } from '../src/view/proj.js';
import { surfaceSvg } from '../src/apps/design/surface-board.js';
import { makeRng } from '../src/core/rng.js';

const area = poly => poly.reduce((sum, [x, y], i) => {
  const [nx, ny] = poly[(i + 1) % poly.length];
  return sum + (x * ny - nx * y) / 2;
}, 0);

const inside = ([x, y], poly) => {
  let in_ = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      in_ = !in_;
    }
  }
  return in_;
};

const distanceToEdges = ([x, y], poly) => {
  let nearest = Infinity;
  poly.forEach(([ax, ay], i) => {
    const [bx, by] = poly[(i + 1) % poly.length];
    const dx = bx - ax;
    const dy = by - ay;
    const reach = dx || dy ? ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy) : 0;
    const along = Math.max(0, Math.min(1, reach));
    nearest = Math.min(nearest, Math.hypot(x - ax - along * dx, y - ay - along * dy));
  });
  return nearest;
};

const transpose = R => [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];

// A few views of a board: the first view of the app, then turned about in both directions.
const viewsOf = top => {
  const out = [];
  let R = overview(top);
  for (let i = 0; i < 5; i++) {
    R = orbit(R, 0.37 + i * 0.5, 0.21 + i * 0.3);
    out.push(R);
  }
  return [overview(top), IDENTITY, ...out];
};

registerBalls(BALL_CATALOG);

export function ballViewTests(t, ok, eq) {
  t('ball view: the outlines tile the disc of the ball, in every view of every ball', () => {
    for (const entry of BALL_CATALOG) {
      const top = surfaceTopology(BALL_KIND, entry.id);
      for (const R of viewsOf(top)) {
        const view = buildBallView(top, R);
        let total = 0;
        for (let cell = 0; cell < top.T; cell++) {
          const outline = view.outlines[cell];
          if (view.drawn[cell]) {
            ok(area(outline) > 0, `${entry.id}: cell ${cell} is counter-clockwise`);
            for (const [x, y] of outline) {
              ok(Math.hypot(x, y) < 1 + 1e-9, `${entry.id}: cell ${cell} stays in the disc`);
            }
          }
          total += outline.length >= 3 ? Math.max(0, area(outline)) : 0;
          // a cell whose centre faces the viewer is drawn and marked
          eq(view.hidden[cell], view.depth[cell] > 0.08 ? 0 : 1, `${entry.id}: hidden`);
          if (!view.hidden[cell]) {
            ok(view.drawn[cell] === 1, `${entry.id}: cell ${cell} is seen, so it is drawn`);
          }
        }
        // the polygons are inscribed in the arcs: the disc is covered up to a small margin
        ok(Math.abs(total / Math.PI - 1) < 0.01, `${entry.id}: area ${total / Math.PI}`);
      }
    }
  });

  t('ball view: a point of the picture is in the cell the exact test finds', () => {
    const rnd = makeRng(11);
    for (const id of ['tetra', 'cube', 'snub-cube', 'snub-dodeca', 'dual-snub-cube', 'bipyramid7']) {
      const top = surfaceTopology(BALL_KIND, id);
      for (const R of viewsOf(top).slice(0, 4)) {
        const view = buildBallView(top, R);
        const back = transpose(R);
        for (let i = 0; i < 400; i++) {
          const x = rnd() * 2 - 1;
          const y = rnd() * 2 - 1;
          const r2 = x * x + y * y;
          if (r2 > 0.98) {
            continue;
          }
          const cell = directionCell(top, turn(back, [x, y, Math.sqrt(1 - r2)]));
          ok(cell >= 0, `${id}: a cell for every point`);
          const hits = [];
          view.outlines.forEach((outline, k) => {
            if (outline.length >= 3 && inside([x, y], outline)) {
              hits.push(k);
            }
          });
          if (!hits.includes(cell)) {
            // only along a side, where the arc and its chord differ
            const near = distanceToEdges([x, y], view.outlines[cell]);
            ok(near < 0.012, `${id}: point ${x}, ${y} is in ${cell}, drawn in ${hits} (${near})`);
          }
        }
      }
    }
    for (const entry of BALL_CATALOG) {
      const top = surfaceTopology(BALL_KIND, entry.id);
      for (let cell = 0; cell < top.T; cell++) {
        eq(directionCell(top, cellDirection(top, cell)), cell, `${entry.id}: centre of ${cell}`);
      }
    }
  });

  t('ball view: the far side, the middle of a side, picking a side, marks', () => {
    for (const id of ['snub-cube', 'kis-dodeca', 'prism5', 'dual-antiprism5']) {
      const top = surfaceTopology(BALL_KIND, id);
      const R = orbit(overview(top), 0.6, 0.35);
      const front = buildBallView(top, R);
      const far = buildBallView(top, behind(R));
      for (let cell = 0; cell < top.T; cell++) {
        ok(Math.abs(front.depth[cell] + far.depth[cell]) < 1e-9, `${id}: opposite depths`);
        ok(front.markRadius(cell) > 0 && front.markRadius(cell) <= 0.085 + 1e-12);
        for (let slot = 0; slot < top.deg[cell]; slot++) {
          const other = top.nb[cell * SLOTS + slot];
          const back = top.rev[cell * SLOTS + slot];
          const [ax, ay] = front.sideMid(cell, slot);
          const [bx, by] = front.sideMid(other, back);
          ok(Math.hypot(ax - bx, ay - by) < 1e-9, `${id}: both cells share the middle of a side`);
        }
        if (front.depth[cell] > 0.6) {
          // a point just inside the middle of a side that is in front picks that side
          for (let slot = 0; slot < top.deg[cell]; slot++) {
            const ends = [slot, (slot + 1) % top.deg[cell]].map(k => {
              const id = top.ring[cell * SLOTS + k];
              return [0, 1, 2].map(axis => top.verts[id * 3 + axis]);
            });
            const mid = [0, 1, 2].map(axis => ends[0][axis] + ends[1][axis]);
            if (turn(R, mid)[2] / Math.hypot(...mid) < 0.3) {
              continue;
            }
            const [mx, my] = front.sideMid(cell, slot);
            const [cx, cy] = front.centers[cell];
            const point = [mx + (cx - mx) * 0.1, my + (cy - my) * 0.1];
            eq(front.pickSide(cell, ...point), slot, `${id}: side ${slot} of ${cell}`);
          }
        }
      }
      // every corner is in front or behind; the front part of a closed outline is one run
      const ring = [[0, 0, 1], [0.2, 0, 1], [0.2, 0.2, 1]];
      eq(frontOf(ring).length, 3);
      eq(frontOf([[0, 0, -1], [1, 0, -1], [0, 1, -1]]).length, 0);
    }
  });

  t('ball view: a route and the markup', () => {
    const made = generateSurface(BALL_KIND, 'snub-cube', 5, { K: 8 });
    const top = surfaceTopology(BALL_KIND, 'snub-cube');
    const puzzle = made.puzzle;
    const R = orbit(overview(top), 0.4, 0.2);
    const view = buildBallView(top, R);
    const pieces = view.routePieces(made.path);
    ok(pieces.length >= 1);
    for (const piece of pieces) {
      ok(piece.length > 1);
      for (const [x, y] of piece) {
        ok(Math.hypot(x, y) <= 1 + 1e-9, 'a route is drawn in front');
      }
    }
    // the near half and the far half of the route together cover every step
    const flat = view.routePieces(made.path).flat();
    const seen = new Set(flat.map(p => p.map(v => v.toFixed(4)).join()));
    ok(seen.size > made.path.length, 'many points in front');
    const base = {
      P: puzzle,
      selected: -1,
      buffer: '',
      playing: false,
      path: [],
      template: made.path,
      solutions: [],
      visible: [],
      idSuffix: '7',
    };
    const picture = surfaceSvg(view, base);
    ok(!picture.markup.includes('NaN'), 'no NaN in the markup');
    ok(picture.markup.includes('class="sf-disc"') && picture.markup.includes('sfGloss7'));
    const polygons = picture.markup.match(/<polygon class="sf-cell/g) || [];
    const inFront = view.drawn.reduce((sum, drawn) => sum + drawn, 0);
    eq(polygons.length, inFront, 'a polygon per cell in front');
    const numbered = [];
    for (let cell = 0; cell < top.T; cell++) {
      if (puzzle.cp[cell] && !view.hidden[cell]) {
        numbered.push(cell);
      }
    }
    eq((picture.markup.match(/class="sf-badge/g) || []).length, numbered.length, 'badges');
    ok(/<polyline class="sf-path"/.test(picture.markup), 'the template path');
    const walls = makeSurfacePuzzle(BALL_KIND, 'snub-cube');
    walls.walls.fill(1);
    const walled = surfaceSvg(view, { ...base, P: walls, template: null });
    ok((walled.markup.match(/<polyline class="sf-wall"/g) || []).length > 20, 'walls are curved');
    const playing = surfaceSvg(view, { ...base, playing: true, path: made.path.slice(0, 10) });
    ok(playing.markup.includes('class="sf-head"') || view.hidden[made.path[9]] === 1, 'the head');
    // two balls on a page (the Map view) are 300 px wide at most
    const small = buildBallView(top, R, { maxWidth: 300 });
    const pair = surfaceSvg(small, base).frame;
    ok(pair.width <= 300 + 2 * 60 && pair.width < picture.frame.width, `pair ${pair.width}`);
  });
}
