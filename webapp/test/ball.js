// Tests of the ball boards: the generated catalog (core/solid/ball-catalog.js), the graph built
// from it (topology.js), which boards can be played, and puzzles on them. Registered by tests.js:
// ballTests(t, ok, eq). Regenerating the catalog: node tools/ball-catalog.mjs --check
import { BALL_CATALOG } from '../src/core/solid/ball-catalog.js';
import { registerBalls } from '../src/core/solid/ball-registry.js';
import {
  ballsByComposition,
  compositionLabel,
  pickBall,
  playableBalls,
  PLAY_MAX_CELLS,
  PLAY_MIN_CELLS,
} from '../src/core/solid/balls.js';
import {
  BALL_KIND,
  SLOTS,
  ballEntry,
  surfaceCellCount,
  surfaceTopology,
} from '../src/core/surface/topology.js';
import {
  isSolved,
  makeSurfacePuzzle,
  parseSurface,
  serializeSurface,
  validateSurface,
  wallEdges,
} from '../src/core/surface/puzzle.js';
import { solveSurface, countHamiltonianPaths } from '../src/core/surface/solve.js';
import { kRange } from '../src/core/gen/pick-k.js';
import {
  GEN_CFG,
  generateSurface,
  randomHamiltonianPath,
} from '../src/core/surface/gen.js';
import { makeRng } from '../src/core/rng.js';
import { congruentByType, kis, meshOf, seeds } from '../tools/polyhedra.mjs';

const threw = f => {
  try {
    f();
    return false;
  } catch {
    return true;
  }
};

const fnv = text => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
};

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

registerBalls(BALL_CATALOG);

// a copy of the registry module that has not been given the catalog
const fresh = await import('../src/core/solid/ball-registry.js?fresh');

export function ballTests(t, ok, eq) {
  t('ball catalog: ids, hashes and the shape of every entry', () => {
    ok(BALL_CATALOG.length >= 35, 'the catalog is not empty');
    eq(new Set(BALL_CATALOG.map(entry => entry.id)).size, BALL_CATALOG.length, 'ids are unique');
    for (const entry of BALL_CATALOG) {
      const where = entry.id;
      ok(/^[a-z][a-z0-9-]*$/.test(entry.id), `${where}: id fits a puzzle file line`);
      eq(entry.h, fnv(JSON.stringify(entry.r)), `${where}: hash of the rings`);
      const counts = [3, 4, 5].map(k => entry.r.filter(ring => ring.length === k).length);
      eq(entry.f, counts, `${where}: f counts the faces by number of sides`);
      eq(counts[0] + counts[1] + counts[2], entry.r.length, `${where}: only 3, 4 and 5 sides`);
      ok(entry.r.length >= 4, `${where}: at least 4 cells`);
      ok(entry.ok === true || (entry.ok === false && entry.why), `${where}: ok, or why not`);
      for (const p of entry.v) {
        ok(Math.abs(Math.hypot(...p) - 1) < 1e-5, `${where}: corners are unit vectors`);
      }
    }
  });

  t('ball catalog: closed, convex, counter-clockwise, Euler and the corner formula', () => {
    for (const entry of BALL_CATALOG) {
      const where = entry.id;
      const top = surfaceTopology(BALL_KIND, entry.id);
      eq(top.T, entry.r.length, `${where}: cells`);
      eq(top.V, entry.v.length, `${where}: corners`);
      eq(top.V - top.E + top.T, 2, `${where}: Euler`);
      let sides = 0;
      for (let cell = 0; cell < top.T; cell++) {
        eq(top.deg[cell], entry.r[cell].length, `${where}: neighbours = sides`);
        sides += top.deg[cell];
        for (let k = 0; k < top.deg[cell]; k++) {
          const other = top.nb[cell * SLOTS + k];
          eq(top.nb[other * SLOTS + top.rev[cell * SLOTS + k]], cell, `${where}: neighbours agree`);
        }
        const ring = entry.r[cell].map(i => entry.v[i]);
        let centre = [0, 0, 0];
        ring.forEach((p, k) => {
          const before = ring[(k + ring.length - 1) % ring.length];
          const turn = dot(cross(before, p), ring[(k + 1) % ring.length]);
          ok(turn > 1e-6, `${where}: cell ${cell} turns left at every corner (convex, outward)`);
          centre = [centre[0] + p[0], centre[1] + p[1], centre[2] + p[2]];
        });
        const normal = cross(
          [ring[1][0] - ring[0][0], ring[1][1] - ring[0][1], ring[1][2] - ring[0][2]],
          [ring[2][0] - ring[0][0], ring[2][1] - ring[0][1], ring[2][2] - ring[0][2]],
        );
        ok(dot(normal, centre) > 0, `${where}: cell ${cell} is counter-clockwise from outside`);
      }
      eq(sides, 2 * top.E);
      // 3 f3 + 2 f4 + f5 = 12 + 2 * sum over corners of (cells at the corner - 3)
      const at = new Array(entry.v.length).fill(0);
      for (const ring of entry.r) {
        ring.forEach(v => at[v]++);
      }
      ok(at.every(n => n >= 3), `${where}: three or more cells at every corner`);
      const excess = at.reduce((sum, n) => sum + n - 3, 0);
      eq(3 * entry.f[0] + 2 * entry.f[1] + entry.f[2], 12 + 2 * excess, `${where}: corner formula`);
      eq(surfaceTopology(BALL_KIND, entry.id) === top, true, `${where}: built once`);
      eq(surfaceCellCount(BALL_KIND, entry.id), top.T);
    }
    ok(threw(() => surfaceTopology(BALL_KIND, 'nope')));
    ok(threw(() => surfaceTopology(BALL_KIND, 12)));
    ok(threw(() => ballEntry('')));
  });

  t('ball catalog: the solids named in the design, and what no puzzle can be played on', () => {
    const f = id => ballEntry(id).f;
    eq(f('dodeca'), [0, 0, 12], '12 pentagons');
    eq(f('prism5'), [0, 5, 2], '5 squares + 2 pentagons');
    eq(f('snub-dodeca'), [80, 0, 12], '80 triangles + 12 pentagons');
    eq(f('snub-cube'), [32, 6, 0]);
    eq(f('cuboct'), [8, 6, 0], '8 triangles + 6 squares');
    eq(f('icosidodeca'), [20, 0, 12], '20 triangles + 12 pentagons');
    // the numbers of triangles on offer: cells of one type are congruent, so no free-form solid
    const flat = BALL_CATALOG.filter(e => e.f[1] + e.f[2] === 0 && e.ok);
    const triangles = [...new Set(flat.map(e => e.f[0]))].sort((a, b) => a - b);
    eq(triangles, [4, 6, 8, 10, 12, 14, 16, 20, 24, 48, 60]);
    // a bipartite board can only be covered by a path when its colour classes are almost equal
    for (const id of ['cuboct', 'icosidodeca', 'rhombicuboct', 'rhombicosidodeca']) {
      const top = surfaceTopology(BALL_KIND, id);
      ok(top.bipartite, `${id}: an even number of cells at every corner`);
      ok(Math.abs(top.classes[0] - top.classes[1]) > 1, `${id}: classes ${top.classes}`);
      eq(ballEntry(id).ok, false, `${id}: cannot be played`);
      ok(/bipartite/.test(ballEntry(id).why));
    }
    eq(surfaceTopology(BALL_KIND, 'cuboct').classes.slice().sort(), [6, 8]);
    eq(surfaceTopology(BALL_KIND, 'icosidodeca').classes.slice().sort(), [12, 20]);
    // the oracle: no path through all 14 cells of the cuboctahedron, whatever the start
    eq(countHamiltonianPaths(surfaceTopology(BALL_KIND, 'cuboct')).count, 0);
    const octa = surfaceTopology(BALL_KIND, 'octa');
    ok(countHamiltonianPaths(octa).count > 0, 'the octahedron has paths');
  });

  t('ball catalog: every entry marked ok has a path through all its cells', () => {
    for (const entry of BALL_CATALOG) {
      if (!entry.ok) {
        continue;
      }
      const top = surfaceTopology(BALL_KIND, entry.id);
      const cfg = { ...GEN_CFG, pathNodeCap: 50000, pathTries: 400 };
      const path = randomHamiltonianPath(top, makeRng(1), cfg);
      ok(path && path.length === top.T && new Set(path).size === top.T, `${entry.id}: a path`);
      for (let i = 0; i + 1 < path.length; i++) {
        let next = false;
        for (let k = 0; k < top.deg[path[i]]; k++) {
          next = next || top.nb[path[i] * SLOTS + k] === path[i + 1];
        }
        ok(next, `${entry.id}: steps go to a neighbour`);
      }
    }
  });

  t('balls: play window, selector groups, labels', () => {
    const list = playableBalls();
    ok(list.length >= 25, `${list.length} balls in the play window`);
    for (const entry of list) {
      ok(entry.ok && entry.r.length >= PLAY_MIN_CELLS && entry.r.length <= PLAY_MAX_CELLS);
    }
    eq(PLAY_MIN_CELLS, 8);
    eq(PLAY_MAX_CELLS, 100);
    ok(list.some(e => e.id === 'octa') && !list.some(e => e.id === 'cube'), '8 cells in, 6 out');
    ok(list.every(e => e.id !== 'cuboct'), 'unplayable boards are left out');
    eq(playableBalls(0, 1000).length, BALL_CATALOG.filter(e => e.ok).length);
    const rnd = makeRng(7);
    const picked = new Set();
    for (let i = 0; i < 400; i++) {
      picked.add(pickBall(rnd).id);
    }
    ok(picked.size > list.length / 2, 'random picks spread over the list');
    eq(pickBall(() => 0.999999).id, list[list.length - 1].id);
    eq(compositionLabel([80, 0, 12]), '80 triangles + 12 pentagons');
    eq(compositionLabel([0, 0, 12]), '12 pentagons');
    eq(compositionLabel([1, 1, 1]), '1 triangle + 1 square + 1 pentagon');
    const groups = ballsByComposition();
    eq(groups.reduce((sum, g) => sum + g.balls.length, 0), BALL_CATALOG.length);
    for (let i = 1; i < groups.length; i++) {
      ok(groups[i - 1].balls[0].r.length <= groups[i].balls[0].r.length, 'fewest cells first');
    }
    const eighty = groups.find(g => g.label === '80 triangles + 12 pentagons');
    eq(eighty.balls.map(e => e.id), ['snub-dodeca']);
  });

  t('ball catalog: the cells of a type are congruent; uneven balls are not offered', () => {
    for (const entry of BALL_CATALOG) {
      ok(congruentByType(entry.v, entry.r), `${entry.id}: congruent triangles, squares, pentagons`);
    }
    // a pyramid on every face of a square pyramid has two kinds of triangles
    const pyramid = seeds().find(([id]) => id === 'pyramid4');
    const uneven = kis(meshOf(pyramid[2]));
    const corners = uneven.verts.map(p => p.map(x => x / Math.hypot(...p)));
    eq(congruentByType(corners, uneven.faces), false, 'kis pyramid4 is uneven');
    ok(!BALL_CATALOG.some(entry => entry.id === 'kis-pyramid4' || entry.id.startsWith('spread')));
    // the Catalan and Archimedean solids stay
    for (const id of ['snub-dodeca', 'dual-snub-dodeca', 'kis-dodeca', 'antiprism5']) {
      ok(BALL_CATALOG.some(entry => entry.id === id), id);
    }
  });

  t('ball catalog: the registry is empty until it is given the catalog', () => {
    eq(fresh.ballsLoaded(), false);
    ok(threw(() => fresh.ballEntry('tetra')), 'not loaded');
    fresh.registerBalls(BALL_CATALOG);
    eq(fresh.ballsLoaded(), true);
    eq(fresh.ballEntry('tetra').id, 'tetra');
    eq(fresh.ballList().length, BALL_CATALOG.length);
    ok(threw(() => fresh.ballEntry('nope')));
  });

  t('ball puzzles: generated, unique, solvable, and the text format round-trips', () => {
    for (const [id, seed] of [['octa', 1], ['dodeca', 2], ['prism5', 3], ['snub-cube', 4],
      ['dual-snub-cube', 5], ['kis-cube', 6], ['bipyramid6', 7], ['snub-dodeca', 8]]) {
      const top = surfaceTopology(BALL_KIND, id);
      const made = generateSurface(BALL_KIND, id, seed);
      const p = made.puzzle;
      eq(p.kind, BALL_KIND);
      eq(p.n, id);
      const [kMin, kMax] = kRange(top.T);
      ok(made.K >= kMin && made.K <= Math.min(kMax, top.T), `${id}: checkpoints ${made.K}`);
      eq(validateSurface(p).ok, true, `${id}: valid`);
      const solved = solveSurface(p, { limit: 2 });
      eq(solved.count, 1, `${id}: exactly one solution`);
      ok(isSolved(p, made.path), `${id}: the path it was made from solves it`);
      ok(wallEdges(p).length <= top.E);
      const text = serializeSurface(p);
      ok(text.includes(`surface ball ${id}\n`), `${id}: header`);
      const back = parseSurface(text);
      eq(back.n, id);
      eq(Array.from(back.cp), Array.from(p.cp), `${id}: numbers round-trip`);
      eq(Array.from(back.walls), Array.from(p.walls), `${id}: walls round-trip`);
      const again = generateSurface(BALL_KIND, id, seed);
      eq(Array.from(again.puzzle.cp), Array.from(p.cp), `${id}: same seed, same puzzle`);
    }
    ok(threw(() => makeSurfacePuzzle(BALL_KIND, 'nope')));
    ok(threw(() => parseSurface('surface ball nope\n')));
    ok(threw(() => parseSurface('surface ball\n')));
    ok(threw(() => generateSurface(BALL_KIND, 'cuboct', 1)), 'no puzzle on an unplayable board');
  });
}
